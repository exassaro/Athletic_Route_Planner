/**
 * What Follow draws (blueprint Phase 5d amendment 12): the route, the part done dimmed, and the live dot with its
 * accuracy ring. Everything is local data handed to MapLibre; none of it is fetched.
 */
import type { FilterSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { splitAt, type Line, type LonLat } from "@/follow/line";
import { ROUTE_COLORS } from "@/plan/routeStyle";
import type { Theme } from "@/theme/theme";

const ROUTE = "follow-route";
const ME = "follow-me";
/**
 * The part done: the route's colour taken towards the land, and opaque. A see-through line doubles up where it
 * overlaps itself, at every sharp corner, and the spots read as stops.
 */
export const DONE_COLORS: Record<Theme, { line: string; casing: string }> = {
  light: { line: "#93B9AE", casing: "#F0EEE9" },
  dark: { line: "#2A5A50", casing: "#15171A" },
};
const RING_POINTS = 32;

type Here = { point: LonLat; accuracy: number };
type Feature = {
  type: "Feature";
  properties: { part: "done" | "left" | "ring" | "dot" };
  geometry: { type: "Point"; coordinates: number[] } | { type: "LineString"; coordinates: number[][] }
    | { type: "Polygon"; coordinates: number[][][] };
};

const part = (name: Feature["properties"]["part"]): FilterSpecification => ["==", ["get", "part"], name];
const collection = (features: Feature[]) => ({ type: "FeatureCollection" as const, features });

/** The accuracy ring, as a polygon in metres round the fix. */
export function ring(line: Line, { point: [lon, lat], accuracy }: Here): number[][] {
  const [x0, y0] = line.toXY([lon, lat]);
  const kx = line.toXY([lon + 0.01, lat])[0] - x0;
  const ky = line.toXY([lon, lat + 0.01])[1] - y0;
  return Array.from({ length: RING_POINTS + 1 }, (_, i) => {
    const a = (2 * Math.PI * (i % RING_POINTS)) / RING_POINTS;
    return [lon + (0.01 * accuracy * Math.cos(a)) / kx, lat + (0.01 * accuracy * Math.sin(a)) / ky];
  });
}

export function routeFeatures(line: Line, doneM: number): Feature[] {
  const { done, left } = splitAt(line, doneM);
  const feature = (name: "done" | "left", points: LonLat[]): Feature =>
    ({ type: "Feature", properties: { part: name }, geometry: { type: "LineString", coordinates: points.map((p) => [...p]) } });
  return [...(doneM > 0 ? [feature("done", done)] : []), ...(doneM < line.totalM ? [feature("left", left)] : [])];
}

export function meFeatures(line: Line, here: Here | null): Feature[] {
  if (!here) return [];
  return [
    { type: "Feature", properties: { part: "ring" }, geometry: { type: "Polygon", coordinates: [ring(line, here)] } },
    { type: "Feature", properties: { part: "dot" }, geometry: { type: "Point", coordinates: [...here.point] } },
  ];
}

/** Adds the layers, bottom to top: the part done under the part left, which is under the dot. */
export function addFollowLayers(map: MapLibreMap) {
  if (map.getSource(ROUTE)) return;
  map.addSource(ROUTE, { type: "geojson", data: collection([]) });
  map.addSource(ME, { type: "geojson", data: collection([]) });
  const round = { "line-join": "round", "line-cap": "round" } as const;
  for (const name of ["done", "left"] as const) {
    map.addLayer({ id: `follow-${name}-casing`, type: "line", source: ROUTE, filter: part(name), layout: round,
      paint: { "line-width": 10 } });
    map.addLayer({ id: `follow-${name}`, type: "line", source: ROUTE, filter: part(name), layout: round,
      paint: { "line-width": 6 } });
  }
  map.addLayer({ id: "follow-ring", type: "fill", source: ME, filter: part("ring"), paint: { "fill-opacity": 0.14 } });
  map.addLayer({ id: "follow-dot", type: "circle", source: ME, filter: part("dot"),
    paint: { "circle-radius": 9, "circle-stroke-width": 3 } });
}

export function paintFollowLayers(map: MapLibreMap, theme: Theme) {
  if (!map.getSource(ROUTE)) return;
  const colours = ROUTE_COLORS[theme];
  map.setPaintProperty("follow-done-casing", "line-color", DONE_COLORS[theme].casing);
  map.setPaintProperty("follow-done", "line-color", DONE_COLORS[theme].line);
  map.setPaintProperty("follow-left-casing", "line-color", colours.casing);
  map.setPaintProperty("follow-left", "line-color", colours.primary);
  map.setPaintProperty("follow-ring", "fill-color", colours.second);
  map.setPaintProperty("follow-dot", "circle-color", colours.second);
  map.setPaintProperty("follow-dot", "circle-stroke-color", colours.casing);
}

export function setProgress(map: MapLibreMap, line: Line, doneM: number) {
  map.getSource<GeoJSONSource>(ROUTE)?.setData(collection(routeFeatures(line, doneM)));
}

export function setHere(map: MapLibreMap, line: Line, here: Here | null) {
  map.getSource<GeoJSONSource>(ME)?.setData(collection(meFeatures(line, here)));
}
