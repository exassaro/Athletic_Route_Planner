"use client";
/**
 * The shared route on the self-hosted basemap, read-only (Phase 5b amendments 13, 14, 21 and 22): the planner's own
 * layers and markers, so the stops are grouped the same way, the pin faces the same way and follows the same hop
 * rule. Geometry, positions and km marks from the API.
 */
import { useMemo, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Schemas } from "@/api/client";
import { MapView } from "@/map/MapView";
import { useRouteLayers } from "@/map/useRouteLayers";
import { useTheme } from "@/theme/useTheme";

type Props = { slug: string; route: Schemas["RouteFeature"]; kmMarks: Schemas["KmMark"][]; covering?: string };

export function ShareMap({ slug, route, kmMarks, covering }: Props) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [theme] = useTheme();
  const candidates = useMemo(() => [{ ...(route.properties as Schemas["CandidateOut"]),
    geometry: route.geometry.coordinates.map((p) => [p[0], p[1]] as [number, number]) }], [route]);
  const cand = candidates[0]!;
  // Facing, as in the planner: towards the API's first km mark; the first segment on a route under 1 km.
  const startLon = cand.stops?.find((s) => s.role === "start")?.snapped_lon;
  const west = kmMarks[0] && startLon != null
    ? kmMarks[0].lon < startLon
    : cand.geometry.length > 1 && cand.geometry[1]![0] < cand.geometry[0]![0];
  useRouteLayers(map, candidates, 0, false, slug, null, theme, west, covering);
  return <MapView onReady={setMap} theme={theme} />;
}
