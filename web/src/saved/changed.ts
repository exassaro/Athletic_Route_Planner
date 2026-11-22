import type { Schemas } from "@/api/client";
import type { Editing } from "@/plan/usePlan";

/** JSON with sorted keys, for comparing what the API sent at different times. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
}

/**
 * Whether the route on screen differs from the saved one (blueprint Phase 5c amendment 2): the request or the
 * geometry. Not the route id, which is new every time an undo returns to an earlier request.
 */
export function changed(editing: Pick<Editing, "request" | "route">, request: Schemas["RouteRequest"], cand: Schemas["CandidateOut"]): boolean {
  if (cand.route_id === editing.route.route_id) return false;
  return canonical(request) !== canonical(editing.request) || canonical(cand.geometry) !== canonical(editing.route.geometry);
}
