/**
 * The self-hosted basemap (blueprint Phase 5 amendments 3 and 12): Protomaps vector tiles for Kerala from one
 * PMTiles file, with fonts and sprites served from the same origin. No API key, no per-load fee.
 * Files: web/public/basemap/, written by engine/scripts/fetch_basemap.py (pin: engine/basemap_pin.json).
 */
import { layers, namedFlavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";

export const ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>' +
  ' · <a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a>';

/** Kozhikode city node (osm:node/1348192542, from the pinned extract): where the map opens without a location. */
export const KOZHIKODE: [number, number] = [75.7754716, 11.2450558];

export function basemapStyle(origin: string): StyleSpecification {
  return {
    version: 8,
    glyphs: `${origin}/basemap/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/basemap/sprites/light`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${origin}/basemap/kerala.pmtiles`,
        attribution: ATTRIBUTION,
      },
    },
    layers: layers("protomaps", namedFlavor("light"), { lang: "en" }),
  } as StyleSpecification;
}
