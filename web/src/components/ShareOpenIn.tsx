"use client";
/** "Open in..." on the share page (Phase 5b amendments 20 and 22): public, so no client token. */
import { API_BASE, type Schemas } from "@/api/client";
import { fileName, GPX_MIME } from "@/export/gpxFile";
import type { LonLat, RoutePoints } from "@/export/googleMaps";
import { OpenIn } from "./OpenIn";

type Props = { slug: string; start: LonLat; end: LonLat; kmMarks: Schemas["KmMark"][] };

export function ShareOpenIn({ slug, start, end, kmMarks }: Props) {
  const loadGpx = async (ele: boolean) => {
    const response = await fetch(`${API_BASE}/v1/share/${slug}/gpx${ele ? "" : "?ele=false"}`);
    if (!response.ok) throw new Error(`GPX download failed (${response.status}).`);
    return new File([await response.blob()], fileName(response), { type: GPX_MIME });
  };
  const loadPoints = async (): Promise<RoutePoints> => ({ start, end, kmMarks });
  return <OpenIn loadPoints={loadPoints} loadGpx={loadGpx} />;
}
