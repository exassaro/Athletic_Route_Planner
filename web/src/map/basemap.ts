/**
 * The self-hosted basemap (blueprint Phase 5 amendments 3 and 12): Protomaps vector tiles for Kerala from one
 * PMTiles file, with fonts and sprites served from the same origin. No API key, no per-load fee.
 * Files: web/public/basemap/, written by engine/scripts/fetch_basemap.py (pin: engine/basemap_pin.json).
 *
 * Phase 5b (amendments 4 and 5): a light and a dark style from the same tiles, Protomaps' own flavours with the land
 * and water quietened to the GATHO palette, so the route line is the strongest thing on the map.
 */
import { layers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";
import type { Theme } from "@/theme/theme";

export const BASEMAP_SOURCE = "protomaps";

/** Given to the attribution control, not to the source: a source that fails to load would take the credit with it. */
export const ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>' +
  ' · <a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a>';

/** Kozhikode city node (osm:node/1348192542, from the pinned extract): where the map opens without a location. */
export const KOZHIKODE: [number, number] = [75.7754716, 11.2450558];

/** The palette's map colours over Protomaps' flavours (tokens map-land, map-water in docs/reports/phase5b). */
export const QUIET: Record<Theme, Partial<Flavor>> = {
  light: { background: "#E4E0D8", earth: "#ECE9E3", water: "#CFDDE1" },
  dark: { background: "#16181C", earth: "#1B1E22", water: "#1F3138" },
};

export function flavor(theme: Theme): Flavor {
  return { ...namedFlavor(theme), ...QUIET[theme] };
}

export function basemapUrl(origin: string): string {
  return `${origin}/basemap/kerala.pmtiles`;
}

export function basemapStyle(origin: string, theme: Theme = "light"): StyleSpecification {
  return {
    version: 8,
    glyphs: `${origin}/basemap/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/basemap/sprites/${theme}`,
    sources: {
      [BASEMAP_SOURCE]: {
        type: "vector",
        url: `pmtiles://${basemapUrl(origin)}`,
      },
    },
    layers: layers(BASEMAP_SOURCE, flavor(theme), { lang: "en" }),
  } as StyleSpecification;
}

/**
 * Switching themes swaps the basemap's layers but keeps everything the planner drew (routes, km marks, the chart
 * cursor): those sources and layers are carried from the old style into the new one.
 */
export function keepDrawn(prev: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  if (!prev) return next;
  const ids = new Set(next.layers.map((l) => l.id));
  const sources = { ...next.sources };
  for (const [k, v] of Object.entries(prev.sources)) if (!(k in sources)) sources[k] = v;
  return { ...next, sources, layers: [...next.layers, ...prev.layers.filter((l) => !ids.has(l.id))] };
}
