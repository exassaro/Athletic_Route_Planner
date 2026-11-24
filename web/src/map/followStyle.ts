/**
 * The Follow map's style (blueprint Phase 5d amendment 7): the basemap's own layers, with the two things that
 * would ask the server as the camera moves taken out.
 *
 * - Tiles come from the corridor in memory (corridor.ts), never from the archive.
 * - There is no `glyphs` URL. MapLibre then draws every label's glyphs on the device; with one, it fetches a font
 *   file whenever new characters come into view, which says where the camera is.
 */
import type { StyleSpecification } from "maplibre-gl";
import type { Theme } from "@/theme/theme";
import { BASEMAP_SOURCE, basemapStyle } from "./basemap";
import { MAX_ZOOM, MIN_ZOOM } from "./corridor";

export const CORRIDOR_PROTOCOL = "corridor";

/** `load` changes when the corridor has (re)loaded, so MapLibre asks memory again. */
export function corridorTileUrl(load: number): string {
  return `${CORRIDOR_PROTOCOL}://tiles/{z}/{x}/{y}?${load}`;
}

/**
 * `sprite`: whose sprite is named, when it is not the theme's. Battery saver darkens the layers during a run, and
 * a new sprite address would be a request in the middle of one (and fail without a signal).
 */
export function followStyle(origin: string, theme: Theme, load: number, sprite: Theme = theme): StyleSpecification {
  const style = basemapStyle(origin, theme);
  return {
    version: style.version,
    sprite: basemapStyle(origin, sprite).sprite,          // one file for each theme, fetched with the style
    sources: { [BASEMAP_SOURCE]: { type: "vector", tiles: [corridorTileUrl(load)], minzoom: MIN_ZOOM, maxzoom: MAX_ZOOM } },
    layers: style.layers,
  };
}
