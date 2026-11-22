/**
 * This client's saved routes (blueprint Phase 5c A10 and A12). Every call carries the client token and throws an
 * ApiFailure on an error answer or no answer at all (status 0: offline), so a caller has one thing to catch.
 * A 204 has no body: success is the response's status, never whether there is data.
 */
import type { Schemas } from "@/api/client";
import { ApiFailure, type PlanClient, type PlanVersion } from "@/plan/planClient";

export type SavedRow = Schemas["SavedRouteOut"];
export type Saved = Schemas["SavedOut"];

type Result = { data?: unknown; error?: unknown; response: Response };

async function call<T>(send: () => Promise<Result>): Promise<T> {
  let result: Result;
  try {
    result = await send();
  } catch (e) {
    if (e instanceof ApiFailure) throw e;
    throw new ApiFailure(0, "network", "No answer from GATHO. Check your connection.");
  }
  const { data, error, response } = result;
  if (response.ok) return data as T;
  const body = (error ?? {}) as Partial<Schemas["ErrorBody"]>;
  throw new ApiFailure(response.status, body.error ?? `http_${response.status}`, body.message ?? `The API answered ${response.status}.`);
}

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
