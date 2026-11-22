/**
 * What Follow needs of the route, fetched once before the run (blueprint Phase 5d amendments 4, 6 and 7). Nothing
 * here knows a position, and a visitor never gets a session: without a token only a share link can be followed.
 */
import { api, API_BASE, type Schemas } from "@/api/client";
import { ApiFailure, apiSaid, browserStorage, call, PlanClient, TOKEN_KEY } from "@/plan/planClient";
import { listSaved } from "@/saved/api";
import type { Target } from "./target";

export type Followed = { route: Schemas["FollowOut"]; name: string | null };

const gone = () => new ApiFailure(404, "not_found", "That route is no longer available.");

export async function loadFollow(target: Target | null): Promise<Followed> {
  if (!target) throw gone();
  if (target.kind === "share") {
    const route = await call<Schemas["FollowOut"]>(() =>
      api.GET("/v1/share/{slug}/follow", { params: { path: { slug: target.id } }, cache: "no-store" }));
    return { route, name: null };
  }
  const storage = browserStorage();
  // asking the client for a token would make a session
  if (!storage.getItem(TOKEN_KEY)) throw gone();
  const client = new PlanClient({ baseUrl: API_BASE, storage });

  let routeId = target.id;
  let name: string | null = null;
  if (target.kind === "saved") {
    const row = (await listSaved(client)).find((r) => r.saved_id === target.id);
    if (!row) throw gone();
    routeId = row.route_id;
    name = row.name;
  }
  const route = await call<Schemas["FollowOut"]>(() =>
    client.api.GET("/v1/routes/{route_id}/follow", { params: { path: { route_id: routeId } } }));
  return { route, name };
}

/** The route is not there for this browser, as against a failure worth trying again. */
export function isGone(e: unknown): boolean {
  return apiSaid(e, 401, 404, 422);
}
