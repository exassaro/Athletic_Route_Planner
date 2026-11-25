"use client";
/**
 * The planner's state: the plan, the version on screen, and what the API is doing. The current RouteRequest is
 * always `version.request`, as the API returned it (Phase 5 amendment 4); edits become patches on top of it.
 *
 * - Edits made while a solve runs are queued; the queue is coalesced (only the last edit of a kind is kept, so
 *   tapping + five times sends one distance) and sent when the solve ends.
 * - Undo and redo walk the versions the API stored, by replacing the request with an earlier one (a new version
 *   each time, Phase 4 amendment 19). The diff shown is always the API's.
 * - A saved route can be opened for editing (Phase 5c amendment 2): its own version becomes the one on screen,
 *   `editing` remembers it, and the first edit is based on that version, which may not be the plan's latest.
 * - A plan can be opened again by its pointer after a refresh or Back (Phase 5e amendments 1 and 2): a read of
 *   that version, never a solve, and treated as an opened one for the same reason.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/api/client";
import { openSaved, type Saved } from "@/saved/api";
import { patchFor, type Edit } from "./edits";
import { ApiFailure, apiSaid, browserStorage, call, CANCELLED, PlanClient, TOKEN_KEY, type NewRouteRequest, type PatchOp, type PlanVersion,
  type RouteRequest, type Status } from "./planClient";

export type Busy = { kind: "idle" } | Status | { kind: "error"; error: ApiFailure };

/** key: edits with the same key replace each other while queued; null: never replaced (list edits, fixes). */
type Pending = { key: string | null; ops: (request: RouteRequest) => PatchOp[] };

/** The saved route being edited: what is saved now, and that route as it was loaded or last updated. */
export type Editing = { saved: Saved; request: RouteRequest; route: PlanVersion["candidates"][number] };
export type Opening = "loading" | "gone" | "failed" | null;
export type History = { versions: number[]; at: number };
/** What is opened: a saved route's own version, or a plan's version by its pointer. */
export type Target =
  | { kind: "edit"; id: string }
  | { kind: "plan"; plan: string; version: number; edit: string | null; history: History | null };
/** What "Plan a new run" takes away, for its Undo. */
export type Kept = { version: PlanVersion | null; editing: Editing | null; history: History; opened: boolean; target: Target | null };

/** What a failed create or patch leaves on screen: nothing after a Cancel, else the failure (the plan stays). */
function failed(e: unknown): Busy {
  if (e instanceof ApiFailure && e.code === CANCELLED) return { kind: "idle" };
  return { kind: "error", error: e instanceof ApiFailure ? e : new ApiFailure(0, "network", String(e)) };
}

let shared: PlanClient | null = null;
const listeners = new Set<(s: Status) => void>();

/** One client per page (one token); status updates go to whoever subscribed. */
export function planClient(): PlanClient {
  shared ??= new PlanClient({ baseUrl: API_BASE, storage: browserStorage(), onStatus: (s) => listeners.forEach((l) => l(s)) });
  return shared;
}

const SINGLE_VALUE: Partial<Record<Edit["kind"], string>> = {
  distance: "distance", route_type: "route_type", start: "start", paths: "paths", checkpoint_order: "order",
  towards_place: "direction", bearing: "direction", no_direction: "direction",
};

function editKey(e: Edit): string | null {
  return SINGLE_VALUE[e.kind] ?? null;
}

export function usePlan() {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [opening, setOpening] = useState<Opening>(null);
  const [target, setTarget] = useState<Target | null>(null);
  /** The version that was opened by a pointer, so made by whatever map the engines had then. */
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const generation = useRef(0);          // counts clears: an answer from before one is dropped
  const [openError, setOpenError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const opened = useRef(false);          // the version on screen was opened, and may not be the plan's latest
  const [version, setVersion] = useState<PlanVersion | null>(null);
  const [busy, setBusy] = useState<Busy>({ kind: "idle" });
  const [history, setHistory] = useState<History>({ versions: [], at: -1 });
  const queue = useRef<Pending[]>([]);
  const running = useRef(false);
  const current = useRef<PlanVersion | null>(null);
  const client = useMemo(() => planClient(), []);
  useEffect(() => {
    const listen = (s: Status) => setBusy(s);
    listeners.add(listen);
    return () => void listeners.delete(listen);
  }, []);

  const adopt = useCallback((v: PlanVersion, move: "new" | "undo" | "redo") => {
    current.current = v;
    opened.current = false;
    setVersion(v);
    setHistory((h) => {
      if (move === "new") {
        const kept = h.versions.slice(0, h.at + 1);
        return { versions: [...kept, v.version], at: kept.length };
      }
      // undo/redo: the API made a new version with the earlier request; the pointer moves, the list keeps the
      // version numbers the user can step to.
      const at = move === "undo" ? h.at - 1 : h.at + 1;
      const versions = [...h.versions];
      versions[at] = v.version;
      return { versions, at };
    });
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length && current.current) {
        const next = queue.current.shift()!;
        const base = current.current;
        const ops = next.ops(base.request);
        const asked = generation.current;
        try {
          const v = await client.patch(base.plan_id, ops, base.version, opened.current);
          if (asked === generation.current) adopt(v, "new");
          setBusy({ kind: "idle" });
        } catch (e) {
          if (asked !== generation.current) {
            setBusy({ kind: "idle" });
            continue;
          }
          queue.current = [];
          setBusy(failed(e));
        }
      }
    } finally {
      running.current = false;
    }
  }, [adopt, client]);

  const enqueue = useCallback((key: string | null, ops: (r: RouteRequest) => PatchOp[]) => {
    queue.current = [...queue.current.filter((p) => key === null || p.key !== key), { key, ops }];
    void drain();
  }, [drain]);

  const create = useCallback(async (request: NewRouteRequest) => {
    queue.current = [];
    const asked = generation.current;
    try {
      const v = await client.create(request);
      if (asked !== generation.current) {
        setBusy({ kind: "idle" });
        return null;
      }
      setTarget(null);          // planning again replaces whatever could not be opened
      setOpening(null);
      setRestoredKey(null);
      setHistory({ versions: [], at: -1 });
      adopt(v, "new");
      setBusy({ kind: "idle" });
      return v;
    } catch (e) {
      if (asked !== generation.current) {
        setBusy({ kind: "idle" });
        return null;
      }
      setBusy(failed(e));
      return null;
    }
  }, [adopt, client]);

  useEffect(() => {
    if (!target) return;
    let live = true;
    const failed = (e: ApiFailure) => {
      if (!live) return;
      // 401: the token is unknown, so nothing here is its own
      setOpening(apiSaid(e, 401, 404, 422) ? "gone" : "failed");
      setOpenError(e.message);
    };
    if (target.kind === "plan") {
      (async () => {
        // a copied address must not make a session for whoever opens it
        if (!browserStorage().getItem(TOKEN_KEY)) throw new ApiFailure(404, "not_found", "No such plan here.");
        const [read, saved] = await Promise.all([
          call<PlanVersion>(() => client.api.GET("/v1/plans/{plan_id}/versions/{n}",
            { params: { path: { plan_id: target.plan, n: target.version } } })),
          // the edited saved route gone: the plan still opens, no longer editing it
          target.edit === null ? null : openSaved(client, target.edit).catch((e: unknown) => {
            if (apiSaid(e, 404, 422)) return null;
            throw e;
          }),
        ]);
        if (!live) return;
        const v = { ...read, diff: null };
        queue.current = [];
        current.current = v;
        opened.current = true;
        setVersion(v);
        const h = target.history;
        setHistory(h && h.versions[h.at] === v.version ? h : { versions: [v.version], at: 0 });
        setEditing(saved && { saved: saved.saved, request: saved.version.request,
          route: saved.version.candidates.find((c) => c.route_id === saved.saved.route_id)! });
        setRestoredKey(`${v.plan_id}/${v.version}`);
        setOpening(null);
        setBusy({ kind: "idle" });
      })().catch(failed);
      return () => { live = false; };
    }
    openSaved(client, target.id).then(({ saved, version: v }) => {
      if (!live) return;
      queue.current = [];
      current.current = v;
      opened.current = true;
      setVersion(v);
      setHistory({ versions: [v.version], at: 0 });
      setEditing({ saved, request: v.request, route: v.candidates.find((c) => c.route_id === saved.route_id)! });
      setOpening(null);
      setBusy({ kind: "idle" });
    }, failed);
    return () => { live = false; };
  }, [attempt, client, target]);

  const open = useCallback((next: Target) => {
    setTarget(next);
    setOpening("loading");
  }, []);

  /** "Plan a new run": forgets it all and hands it back for Undo. An answer still on its way is dropped. */
  const clear = useCallback((): Kept => {
    const kept = { version: current.current, editing, history, opened: opened.current, target };
    generation.current++;
    queue.current = [];
    current.current = null;
    opened.current = false;
    setTarget(null);
    setOpening(null);
    setVersion(null);
    setEditing(null);
    setRestoredKey(null);
    setHistory({ versions: [], at: -1 });
    setBusy({ kind: "idle" });
    return kept;
  }, [editing, history, target]);

  const putBack = useCallback((kept: Kept) => {
    generation.current++;
    if (!kept.version) {
      if (kept.target) open(kept.target);
      return;
    }
    const v = { ...kept.version, diff: null };
    current.current = v;
    opened.current = kept.opened;
    setTarget(null);
    setOpening(null);
    setVersion(v);
    setEditing(kept.editing);
    setHistory(kept.history);
  }, [open]);

  /** A control's edit: its patch is built from the request current when it is sent. */
  const edit = useCallback((e: Edit) => enqueue(editKey(e), (r) => patchFor(r, e)), [enqueue]);

  /** A patch the API supplied (fix and saving buttons): sent unchanged. */
  const applyPatch = useCallback((ops: PatchOp[]) => enqueue(null, () => ops), [enqueue]);

  const step = useCallback(async (dir: "undo" | "redo") => {
    const v = current.current;
    if (!v || running.current) return;
    const target = dir === "undo" ? history.versions[history.at - 1] : history.versions[history.at + 1];
    if (target === undefined) return;
    running.current = true;
    const asked = generation.current;
    try {
      let earlier: RouteRequest;
      try {
        earlier = (await call<PlanVersion>(() => client.api.GET("/v1/plans/{plan_id}/versions/{n}",
          { params: { path: { plan_id: v.plan_id, n: target } } }))).request;
      } catch (e) {
        throw apiSaid(e, 404) ? new ApiFailure(404, "not_found", "That version is gone.") : e;
      }
      const next = await client.patch(v.plan_id, patchFor(v.request, { kind: "restore", request: earlier }), v.version, opened.current);
      if (asked === generation.current) adopt(next, dir);
      setBusy({ kind: "idle" });
    } catch (e) {
      setBusy(failed(e));
    } finally {
      running.current = false;
      void drain();
    }
  }, [adopt, client, drain, history]);

  return {
    client, version, busy, create, edit, applyPatch,
    history, target, open, clear, putBack, restoredKey,
    editing, setEditing, opening, openError, editingSavedId: editing?.saved.saved_id ?? null,
    retryOpening: () => { setOpening("loading"); setAttempt((n) => n + 1); },
    undo: () => step("undo"), redo: () => step("redo"),
    canUndo: history.at > 0, canRedo: history.at >= 0 && history.at < history.versions.length - 1,
    clearError: () => setBusy({ kind: "idle" }),
    /** Stops waiting for a busy solver; the edit or plan that waited is not sent (Step 9 amendment 7). */
    cancelWaiting: () => client.cancelWaiting(),
  };
}
