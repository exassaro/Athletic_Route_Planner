/** A route of this browser's client, as "Open in..." needs it: both calls carry the client token. */
import type { Schemas } from "@/api/client";
import { answer, apiFailure, call } from "@/plan/planClient";
import { planClient } from "@/plan/usePlan";
import type { Overview, RoutePoints } from "./googleMaps";
import { fileName, GPX_MIME } from "./gpxFile";

export async function ownRouteGpx(routeId: string, ele: boolean): Promise<File> {
  const { data, error, response } = await answer(() => planClient().api.GET("/v1/routes/{route_id}/gpx", {
    params: { path: { route_id: routeId }, query: { ele } }, parseAs: "blob" }));
  if (!data) throw apiFailure(response.status, error);
  return new File([data as Blob], fileName(response), { type: GPX_MIME });
}

export function ownRouteOverview(routeId: string, max: number): Promise<Overview> {
  return call<Overview>(() => planClient().api.GET("/v1/routes/{route_id}/overview-points", {
    params: { path: { route_id: routeId }, query: { max } } }));
}

/** The ends are the profile's first and last positions (the API samples both ends); the marks are the API's. */
export async function ownRoutePoints(routeId: string): Promise<RoutePoints> {
  const { points, km_marks } = await call<Schemas["ElevationOut"]>(() => planClient().api.GET("/v1/routes/{route_id}/elevation", {
    params: { path: { route_id: routeId } } }));
  return { start: points[0]!, end: points[points.length - 1]!, kmMarks: km_marks };
}
