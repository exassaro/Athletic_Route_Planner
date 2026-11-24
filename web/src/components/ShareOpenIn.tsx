"use client";
/** "Open in..." on the share page (Phase 5b amendment 22, Phase 5d amendment 3): public, so no client token. */
import { API_BASE, api, type Schemas } from "@/api/client";
import { fileName, GPX_MIME } from "@/export/gpxFile";
import type { LonLat, Overview, RoutePoints } from "@/export/googleMaps";
import { ApiFailure, answer, apiFailure, call } from "@/plan/planClient";
import { OpenIn } from "./OpenIn";

type Props = { slug: string; routeId: string; footM: number; start: LonLat; end: LonLat; kmMarks: Schemas["KmMark"][] };

/**
 * The owner can point the link at another route while this page is open. What was fetched from the link after that
 * is the new route's, so it must not be mixed with this page's ends: asked after each fetch.
 */
async function assertSameRoute(slug: string, routeId: string) {
  const now = await call<Schemas["SharedRouteOut"]>(() =>
    api.GET("/v1/share/{slug}", { params: { path: { slug } }, cache: "no-store" }));
  if (now.route.id !== routeId) {
    throw new ApiFailure(409, "link_updated", "This link now has a new route. Reload the page to see it.");
  }
}

export function ShareOpenIn({ slug, routeId, footM, start, end, kmMarks }: Props) {
  const loadGpx = async (ele: boolean) => {
    const response = await answer(() => fetch(`${API_BASE}/v1/share/${slug}/gpx${ele ? "" : "?ele=false"}`));
    if (!response.ok) throw apiFailure(response.status, await response.json().catch(() => null));
    const file = new File([await response.blob()], fileName(response), { type: GPX_MIME });
    await assertSameRoute(slug, routeId);
    return file;
  };
  const loadPoints = async (): Promise<RoutePoints> => ({ start, end, kmMarks });
  const loadOverview = async (max: number) => {
    const overview = await call<Overview>(() =>
      api.GET("/v1/share/{slug}/overview-points", { params: { path: { slug }, query: { max } }, cache: "no-store" }));
    await assertSameRoute(slug, routeId);
    return overview;
  };
  return <OpenIn footM={footM} loadPoints={loadPoints} loadOverview={loadOverview} loadGpx={loadGpx} />;
}
