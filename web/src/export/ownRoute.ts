/** A route of this browser's client, as "Open in..." needs it: both calls carry the client token. */
import type { Schemas } from "@/api/client";
import { planClient } from "@/plan/usePlan";
import type { RoutePoints } from "./googleMaps";
import { fileName, GPX_MIME } from "./gpxFile";

export async function ownRouteGpx(routeId: string, ele: boolean): Promise<File> {
  const { data, response } = await planClient().api.GET("/v1/routes/{route_id}/gpx", {
    params: { path: { route_id: routeId }, query: { ele } }, parseAs: "blob" });
  if (!data) throw new Error(`GPX download failed (${response.status}).`);
  return new File([data as Blob], fileName(response), { type: GPX_MIME });
}

/** The ends are the profile's first and last positions (the API samples both ends); the marks are the API's. */
export async function ownRoutePoints(routeId: string): Promise<RoutePoints> {
  const { data, response } = await planClient().api.GET("/v1/routes/{route_id}/elevation", {
    params: { path: { route_id: routeId } } });
  if (!data) throw new Error(`The route's points could not be loaded (${response.status}).`);
  const { points, km_marks } = data as Schemas["ElevationOut"];
  return { start: points[0]!, end: points[points.length - 1]!, kmMarks: km_marks };
}
