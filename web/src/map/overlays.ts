/**
 * What is drawn over the route lines, and in which order (blueprint Phase 5b amendment 14): the dotted links, the km
 * marks and their labels, the chart's cursor, and on top the obstacles. MapLibre places labels from the top layer
 * down, so an invisible icon under each DOM marker takes its space first, and any label that would overlap the
 * marker moves or hides.
 */
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

export const OBSTACLES = "pin-obstacles";
/** Bottom to top. */
export const OVERLAYS = ["pin-links", "km-marks", "km-labels", "chart-cursor", OBSTACLES] as const;
export type Overlay = (typeof OVERLAYS)[number];

/** The layer a new one goes beneath: the lowest overlay above it that exists. No argument: a route line, below all. */
export function layerAbove(map: Pick<MapLibreMap, "getLayer">, layer?: Overlay): string | undefined {
  const from = layer ? OVERLAYS.indexOf(layer) + 1 : 0;
  return OVERLAYS.slice(from).find((id) => map.getLayer(id));
}

export type Anchor = "center" | "bottom" | "bottom-left" | "bottom-right";
/** The screen box a marker covers: its size in px and the corner or edge that sits on the point. */
export type Obstacle = { at: [number, number]; w: number; h: number; anchor: Anchor };

export function setObstacles(map: MapLibreMap, boxes: Obstacle[]) {
  const features = boxes.map(({ at, w, h, anchor }) => {
    const image = `clear-${w}x${h}`;
    if (!map.hasImage(image)) map.addImage(image, { width: w, height: h, data: new Uint8Array(w * h * 4) });
    return { type: "Feature" as const, properties: { image, anchor }, geometry: { type: "Point" as const, coordinates: at } };
  });
  const data = { type: "FeatureCollection" as const, features };
  const source = map.getSource<GeoJSONSource>(OBSTACLES);
  if (source) return void source.setData(data);
  map.addSource(OBSTACLES, { type: "geojson", data });
  map.addLayer({ id: OBSTACLES, type: "symbol", source: OBSTACLES,
    layout: { "icon-image": ["get", "image"], "icon-anchor": ["get", "anchor"], "icon-allow-overlap": true, "icon-padding": 2 } });
}
