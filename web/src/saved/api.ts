/**
 * This client's saved routes (blueprint Phase 5c A10 and A12). Every call carries the client token and goes
 * through `call`, so a caller has one thing to catch: an ApiFailure.
 */
import type { Schemas } from "@/api/client";
import { ApiFailure, call, type PlanClient, type PlanVersion } from "@/plan/planClient";

export type SavedRow = Schemas["SavedRouteOut"];
export type Saved = Schemas["SavedOut"];

export function listSaved(client: PlanClient) {
  return call<SavedRow[]>(() => client.api.GET("/v1/me/routes"));
}

export function patchSaved(client: PlanClient, savedId: string, change: Schemas["SavedPatch"]) {
  return call<Saved>(() => client.api.PATCH("/v1/me/routes/{saved_id}", { params: { path: { saved_id: savedId } }, body: change }));
}

export function deleteSaved(client: PlanClient, savedId: string) {
  return call<void>(() => client.api.DELETE("/v1/me/routes/{saved_id}", { params: { path: { saved_id: savedId } } }));
}

export function restoreSaved(client: PlanClient, savedId: string) {
  return call<Saved>(() => client.api.POST("/v1/me/routes/{saved_id}/restore", { params: { path: { saved_id: savedId } } }));
}

export function saveRoute(client: PlanClient, routeId: string, name: string | null, asNew = false) {
  return call<Saved>(() => client.api.POST("/v1/routes/{route_id}/save", {
    params: { path: { route_id: routeId } }, body: asNew ? { name, as_new: true } : { name } }));
}

/**
 * A saved route as the planner opens it: its own plan version, shown as a fresh result (no diff, so no "what
 * changed" message). 404 when the saved route, or its plan, is not this client's or is gone.
 */
export async function openSaved(client: PlanClient, savedId: string): Promise<{ saved: SavedRow; version: PlanVersion }> {
  const saved = (await listSaved(client)).find((r) => r.saved_id === savedId);
  if (!saved) throw new ApiFailure(404, "not_found", "No such saved route.");
  const version = await call<PlanVersion>(() => client.api.GET("/v1/plans/{plan_id}/versions/{n}", {
    params: { path: { plan_id: saved.plan_id, n: saved.plan_version } } }));
  if (!version.candidates.some((c) => c.route_id === saved.route_id)) {
    throw new ApiFailure(404, "not_found", "The saved route is not in its plan version.");
  }
  return { saved, version: { ...version, diff: null } };
}
