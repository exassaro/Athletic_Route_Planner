"use client";
/** "Open in..." on the share page (Phase 5b amendment 22, Phase 5d amendment 3): public, so no client token. */
import { API_BASE, api, type Schemas } from "@/api/client";
import { fileName, GPX_MIME } from "@/export/gpxFile";
import type { LonLat, Overview, RoutePoints } from "@/export/googleMaps";
import { answer, apiFailure, call } from "@/plan/planClient";
import { OpenIn } from "./OpenIn";

type Props = { slug: string; footM: number; start: LonLat; end: LonLat; kmMarks: Schemas["KmMark"][] };

export function ShareOpenIn({ slug, footM, start, end, kmMarks }: Props) {
  const loadGpx = async (ele: boolean) => {
    const response = await answer(() => fetch(`${API_BASE}/v1/share/${slug}/gpx${ele ? "" : "?ele=false"}`));
    if (!response.ok) throw apiFailure(response.status, await response.json().catch(() => null));
    return new File([await response.blob()], fileName(response), { type: GPX_MIME });
  };
  const loadPoints = async (): Promise<RoutePoints> => ({ start, end, kmMarks });
  const loadOverview = (max: number) => call<Overview>(() =>
    api.GET("/v1/share/{slug}/overview-points", { params: { path: { slug }, query: { max } }, cache: "no-store" }));
  return <OpenIn footM={footM} loadPoints={loadPoints} loadOverview={loadOverview} loadGpx={loadGpx} />;
}
