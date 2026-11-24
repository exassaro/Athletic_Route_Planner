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

/**
 * Where /basemap/ (PMTiles, fonts, sprites) is served. NEXT_PUBLIC_BASEMAP_ORIGIN (read at build time) when the web
 * app and the basemap are on different origins (front end on Vercel, basemap on the VM); unset, the page's own
 * origin, as in development and behind the LAN Caddy. The basemap's server must then answer CORS, Range included
 * (web/README.md, "Split origin").
 */
export function basemapOrigin(configured: string | undefined = process.env.NEXT_PUBLIC_BASEMAP_ORIGIN): string {
  return configured ? configured.replace(/\/+$/, "") : window.location.origin;
}

export function basemapUrl(origin: string): string {
  return `${origin}/basemap/kerala.pmtiles`;
}

/**
 * Place names give way to the markers (amendment 14): Protomaps pins a name to its point from zoom 8, so one under
 * the end flag could only be covered or hidden. These may step aside instead, and sit on the point when it is free.
 */
const PLACE_NAME_LAYERS = ["places_locality", "places_subplace"];
// On the point, else beside it, else diagonally, else a step further out (offsets in ems: [right, down]). In A01 the
// flag and stop 6 take every side of Kozhikode's point except the diagonal above right.
const STEP_ASIDE = {
  "text-variable-anchor-offset": ["center", [0, 0], "top", [0, 1.2], "bottom", [0, -1.2], "right", [-1.2, 0], "left", [1.2, 0],
    "bottom-left", [1, -1], "top-left", [1, 1], "bottom-right", [-1, -1], "top-right", [-1, 1],
    "left", [2.6, 0], "bottom", [0, -2.6], "right", [-2.6, 0], "top", [0, 2.6]],
  "text-justify": "auto",
};

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
    layers: layers(BASEMAP_SOURCE, flavor(theme), { lang: "en" })
      .map((l) => (PLACE_NAME_LAYERS.includes(l.id) ? { ...l, layout: { ...l.layout, ...STEP_ASIDE } } : l)),
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
