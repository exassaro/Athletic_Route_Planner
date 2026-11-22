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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/api/client";
import { openSaved, type Saved } from "@/saved/api";
import { patchFor, type Edit } from "./edits";
import { ApiFailure, apiSaid, browserStorage, call, PlanClient, type NewRouteRequest, type PatchOp, type PlanVersion, type RouteRequest,
  type Status } from "./planClient";

export type Busy = { kind: "idle" } | Status | { kind: "error"; error: ApiFailure };

/** key: edits with the same key replace each other while queued; null: never replaced (list edits, fixes). */
type Pending = { key: string | null; ops: (request: RouteRequest) => PatchOp[] };

/** The saved route being edited: what is saved now, and that route as it was loaded or last updated. */
export type Editing = { saved: Saved; request: RouteRequest; route: PlanVersion["candidates"][number] };
export type Opening = "loading" | "gone" | "failed" | null;

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

export function usePlan(editSavedId: string | null = null) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [opening, setOpening] = useState<Opening>(editSavedId ? "loading" : null);
  const [openError, setOpenError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const opened = useRef(false);          // the version on screen was opened, and may not be the plan's latest
  const [version, setVersion] = useState<PlanVersion | null>(null);
  const [busy, setBusy] = useState<Busy>({ kind: "idle" });
  const [history, setHistory] = useState<{ versions: number[]; at: number }>({ versions: [], at: -1 });
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
        try {
          const v = await client.patch(base.plan_id, ops, base.version, opened.current);
          adopt(v, "new");
          setBusy({ kind: "idle" });
        } catch (e) {
          queue.current = [];
          setBusy({ kind: "error", error: e instanceof ApiFailure ? e : new ApiFailure(0, "network", String(e)) });
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
    try {
      const v = await client.create(request);
      setHistory({ versions: [], at: -1 });
      adopt(v, "new");
      setBusy({ kind: "idle" });
      return v;
    } catch (e) {
      setBusy({ kind: "error", error: e instanceof ApiFailure ? e : new ApiFailure(0, "network", String(e)) });
      return null;
    }
  }, [adopt, client]);

  useEffect(() => {
    if (!editSavedId) return;
    let live = true;
    openSaved(client, editSavedId).then(({ saved, version: v }) => {
      if (!live) return;
      queue.current = [];
      current.current = v;
      opened.current = true;
      setVersion(v);
      setHistory({ versions: [v.version], at: 0 });
      setEditing({ saved, request: v.request, route: v.candidates.find((c) => c.route_id === saved.route_id)! });
      setOpening(null);
      setBusy({ kind: "idle" });
    }, (e: ApiFailure) => {
      if (!live) return;
      // 401: the token is unknown, so nothing saved here is its own
      setOpening(apiSaid(e, 401, 404, 422) ? "gone" : "failed");
      setOpenError(e.message);
    });
    return () => { live = false; };
  }, [attempt, client, editSavedId]);

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
    try {
      let earlier: RouteRequest;
      try {
        earlier = (await call<PlanVersion>(() => client.api.GET("/v1/plans/{plan_id}/versions/{n}",
          { params: { path: { plan_id: v.plan_id, n: target } } }))).request;
      } catch (e) {
        throw apiSaid(e, 404) ? new ApiFailure(404, "not_found", "That version is gone.") : e;
      }
      const next = await client.patch(v.plan_id, patchFor(v.request, { kind: "restore", request: earlier }), v.version, opened.current);
      adopt(next, dir);
      setBusy({ kind: "idle" });
    } catch (e) {
      setBusy({ kind: "error", error: e instanceof ApiFailure ? e : new ApiFailure(0, "network", String(e)) });
    } finally {
      running.current = false;
      void drain();
    }
  }, [adopt, client, drain, history]);

  return {
    client, version, busy, create, edit, applyPatch,
    editing, setEditing, opening, openError, editingSavedId: editing?.saved.saved_id ?? null,
    retryOpening: () => { setOpening("loading"); setAttempt((n) => n + 1); },
    undo: () => step("undo"), redo: () => step("redo"),
    canUndo: history.at > 0, canRedo: history.at >= 0 && history.at < history.versions.length - 1,
    clearError: () => setBusy({ kind: "idle" }),
  };
}
