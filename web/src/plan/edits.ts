/**
 * Every control edits the current RouteRequest, and every edit is a JSON Patch sent to PATCH /v1/plans/{id}
 * (blueprint Phase 5 amendment 4). These functions turn one user action into its patch. They never compute a
 * route, a distance or an endpoint: the numbers they write are the user's own (distance, bearing, pace is
 * elsewhere) or come from the API (places, OSM items, fix patches).
 *
 * The request they read is the one the API returned (every field present, defaults filled in), so list
 * positions are known. Index-based removals carry a `test` on the label first: a stale tap fails with 409
 * instead of removing the wrong item.
 */
import type { Schemas } from "@/api/client";

export type RouteRequest = Schemas["RouteRequest"];
export type PatchOp = Schemas["PatchOp"];
export type Point = Schemas["Point"];
export type Checkpoint = Schemas["Checkpoint"];
export type Via = Schemas["Via"];
export type MustUse = Schemas["MustUse"];
export type AvoidItem = Schemas["AvoidItem"];
export type RouteType = RouteRequest["route_type"];
export type ListName = "checkpoints" | "via" | "must_use" | "avoid";

/** The solver's limits (solver/athlete_solver/models.py), so the UI can disable a control before a 422. */
export const LIMITS = { maxStops: 8, maxMustUse: 4, maxAvoid: 20, maxDistanceM: 100_000 } as const;

export type Edit =
  | { kind: "distance"; meters: number }
  | { kind: "route_type"; value: RouteType }
  | { kind: "start"; point: Point }
  | { kind: "towards_place"; place: Point }
  | { kind: "bearing"; degrees: number }
  | { kind: "no_direction" }
  | { kind: "add"; list: "checkpoints"; item: Checkpoint }
  | { kind: "add"; list: "via"; item: Via }
  | { kind: "add"; list: "must_use"; item: MustUse }
  | { kind: "add"; list: "avoid"; item: AvoidItem }
  | { kind: "remove"; list: ListName; index: number; label: string | null | undefined }
  | { kind: "replace_checkpoint"; index: number; label: string; item: Checkpoint }
  | { kind: "must_reach_on"; index: number; label: string }
  | { kind: "move_checkpoint"; from: number; to: number; label: string }
  | { kind: "checkpoint_order"; value: "auto" | "fixed" }
  | { kind: "paths"; value: "avoid" | "allow" }
  | { kind: "restore"; request: RouteRequest };

function guard(list: ListName, index: number, label: string | null | undefined): PatchOp[] {
  return label == null ? [] : [{ op: "test", path: `/${list}/${index}/label`, value: label }];
}

/** The patch for one edit of `request` (the version the API last returned). */
export function patchFor(request: RouteRequest, edit: Edit): PatchOp[] {
  switch (edit.kind) {
    case "distance":
      return [{ op: "replace", path: "/target_distance_m", value: edit.meters }];
    case "route_type":
      return [{ op: "replace", path: "/route_type", value: edit.value }];
    case "start":
      return [{ op: "replace", path: "/start", value: edit.point }];
    case "towards_place":
      return [{ op: "replace", path: "/direction", value: { kind: "towards_place", place: edit.place } }];
    case "bearing":
      return [{ op: "replace", path: "/direction", value: { kind: "bearing", degrees: normalBearing(edit.degrees) } }];
    case "no_direction":
      return [{ op: "replace", path: "/direction", value: null }];
    case "add":
      return [{ op: "add", path: `/${edit.list}/-`, value: edit.item }];
    case "remove":
      return [...guard(edit.list, edit.index, edit.label), { op: "remove", path: `/${edit.list}/${edit.index}` }];
    case "replace_checkpoint":
      return [...guard("checkpoints", edit.index, edit.label),
        { op: "replace", path: `/checkpoints/${edit.index}`, value: edit.item }];
    case "must_reach_on":
      // A must-reach stop does not use the boundary fallback (as the fixtures build it). Going back to pass-near
      // needs the boundary again: that is a replace_checkpoint with a fresh item from /v1/features/item.
      return [...guard("checkpoints", edit.index, edit.label),
        { op: "replace", path: `/checkpoints/${edit.index}/must_reach`, value: true },
        { op: "replace", path: `/checkpoints/${edit.index}/boundary`, value: null }];
    case "move_checkpoint": {
      const ops: PatchOp[] = [...guard("checkpoints", edit.from, edit.label)];
      if (edit.from !== edit.to) ops.push({ op: "move", from: `/checkpoints/${edit.from}`, path: `/checkpoints/${edit.to}` });
      // Reordering by hand means "my order" (section 13 stops panel).
      if (request.checkpoint_order !== "fixed") ops.push({ op: "replace", path: "/checkpoint_order", value: "fixed" });
      return ops;
    }
    case "checkpoint_order":
      return [{ op: "replace", path: "/checkpoint_order", value: edit.value }];
    case "paths":
      return [{ op: "replace", path: "/preferences/paths", value: edit.value }];
    case "restore":
      // Undo and redo: replace the whole request with an earlier version's (Phase 4 amendment 19).
      return [{ op: "replace", path: "", value: edit.request }];
  }
}

export function normalBearing(degrees: number): number {
  const d = ((degrees % 360) + 360) % 360;
  return Math.round(d);
}

/** Why a control is unavailable for this request, or null. Mirrors the solver's request rules. */
export function blocked(request: RouteRequest, edit: Edit): string | null {
  const stops = (request.checkpoints?.length ?? 0) + (request.via?.length ?? 0) + (request.must_use?.length ?? 0);
  if (edit.kind === "route_type" && edit.value === "out_and_back") {
    if (stops > 0) return "An out-and-back can't have stops yet. Remove the stops first.";
  }
  if (edit.kind === "add" && edit.list !== "avoid") {
    if (request.route_type === "out_and_back") return "An out-and-back can't have stops yet.";
    if (stops >= LIMITS.maxStops) return `At most ${LIMITS.maxStops} stops, vias and must-use roads together.`;
    if (edit.list === "must_use" && (request.must_use?.length ?? 0) >= LIMITS.maxMustUse)
      return `At most ${LIMITS.maxMustUse} must-use roads or bridges.`;
    const label = edit.item.label;
    if ((edit.list === "checkpoints" || edit.list === "must_use") && label &&
      [...(request.checkpoints ?? []), ...(request.must_use ?? [])].some((c) => c.label === label))
      return `"${label}" is already a stop. Each stop needs its own name.`;
  }
  if (edit.kind === "add" && edit.list === "avoid" && (request.avoid?.length ?? 0) >= LIMITS.maxAvoid)
    return `At most ${LIMITS.maxAvoid} things to avoid.`;
  if (edit.kind === "distance" && (edit.meters <= 0 || edit.meters > LIMITS.maxDistanceM))
    return `Pick a distance up to ${LIMITS.maxDistanceM / 1000} km.`;
  if (edit.kind === "no_direction" && request.route_type === "out_and_back")
    return "An out-and-back needs a direction.";
  return null;
}

/**
 * Applies a patch to the draft form before the first solve (nothing has been sent yet, so there is no version
 * to patch). After the first solve every edit goes to the API and the screen shows the request it returns.
 * RFC 6902 add, remove, replace, move and test, on plain JSON.
 */
export function applyToDraft<T>(doc: T, ops: PatchOp[]): T {
  let root: unknown = structuredClone(doc);
  const parse = (p: string) => (p === "" ? [] : p.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~")));
  type Node = Record<string, unknown> | unknown[];
  const walk = (path: string[]): [Node, string] => {
    let cur = root as Node;
    for (const k of path.slice(0, -1)) cur = (cur as Record<string, unknown>)[k] as Node;
    return [cur, path[path.length - 1]!];
  };
  const get = (path: string[]) => path.reduce<unknown>((cur, k) => (cur as Record<string, unknown>)[k], root);
  const put = (path: string[], value: unknown, insert: boolean) => {
    const [p, k] = walk(path);
    if (Array.isArray(p)) {
      if (k === "-") p.push(value);
      else p.splice(Number(k), insert ? 0 : 1, value);
    } else (p as Record<string, unknown>)[k] = value;
  };
  const del = (path: string[]) => {
    const [p, k] = walk(path);
    if (Array.isArray(p)) p.splice(Number(k), 1);
    else delete (p as Record<string, unknown>)[k];
  };
  for (const op of ops) {
    const path = parse(op.path);
    if (op.op === "test") {
      if (JSON.stringify(get(path)) !== JSON.stringify(op.value)) throw new Error(`test failed at ${op.path}`);
    } else if (path.length === 0) {
      root = structuredClone(op.value);
    } else if (op.op === "remove") {
      del(path);
    } else if (op.op === "move") {
      const from = parse(op.from!);
      const v = get(from);
      del(from);
      put(path, v, true);
    } else {
      put(path, structuredClone(op.value), op.op === "add");
    }
  }
  return root as T;
}
