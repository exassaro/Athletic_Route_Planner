/**
 * The route's corridor of basemap tiles (blueprint Phase 5d amendment 7): all of them are fetched before they are
 * needed, chosen by the route alone, and the Follow map is served from memory only. So no tile request can depend
 * on where the runner is, and the map still draws without a signal.
 *
 * The tile grid is web mercator's; the 1 km either side only picks tiles and is never shown as a distance.
 */
import type { LonLat } from "@/follow/line";

export const MIN_ZOOM = 9;
export const MAX_ZOOM = 15;          // the archive's deepest: closer in, MapLibre overzooms it
const ROUTE_BOX_TO_ZOOM = 12;        // up to here the route's whole box, deeper only the corridor
const BOX_PAD_DEG = 0.03;
const BESIDE_DEG = 0.0092;           // about 1 km at this latitude
const STEP_DEG = 0.002;              // well inside a zoom 15 tile (0.011 degrees)
export const AT_ONCE = 6;

export type Tile = { z: number; x: number; y: number };
type Archive = { getZxy(z: number, x: number, y: number, signal?: AbortSignal): Promise<{ data: ArrayBuffer } | undefined> };

export function tileAt([lon, lat]: LonLat, z: number): Tile {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return { z, x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n) };
}

export const tileKey = ({ z, x, y }: Tile) => `${z}/${x}/${y}`;

/** The tiles for a route, coarsest first and then in route order: the same for every runner of that route. */
export function corridorTiles(points: readonly LonLat[]): Tile[] {
  const out = new Map<string, Tile>();
  const addBox = (west: number, south: number, east: number, north: number, z: number) => {
    const from = tileAt([west, north], z);
    const to = tileAt([east, south], z);
    for (let x = from.x; x <= to.x; x++) {
      for (let y = from.y; y <= to.y; y++) out.set(`${z}/${x}/${y}`, { z, x, y });
    }
  };
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const box = [Math.min(...lons) - BOX_PAD_DEG, Math.min(...lats) - BOX_PAD_DEG,
    Math.max(...lons) + BOX_PAD_DEG, Math.max(...lats) + BOX_PAD_DEG] as const;
  for (let z = MIN_ZOOM; z <= ROUTE_BOX_TO_ZOOM; z++) addBox(...box, z);
  for (let z = ROUTE_BOX_TO_ZOOM + 1; z <= MAX_ZOOM; z++) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1] ?? a;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / STEP_DEG));
      for (let k = 0; k <= steps; k++) {
        const lon = a[0] + ((b[0] - a[0]) * k) / steps;
        const lat = a[1] + ((b[1] - a[1]) * k) / steps;
        addBox(lon - BESIDE_DEG, lat - BESIDE_DEG, lon + BESIDE_DEG, lat + BESIDE_DEG, z);
      }
    }
  }
  return [...out.values()];
}

/** Every tile's bytes, by key. A tile the archive has none of is left out. Rejects on the first failure. */
export async function loadCorridor(archive: Archive, tiles: readonly Tile[], signal?: AbortSignal): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (next < tiles.length && !failed && !signal?.aborted) {
      const tile = tiles[next++]!;
      try {
        // never aborted one by one: aborted overlapping Range requests are what Chrome corrupts (5b amendment 12)
        const got = await archive.getZxy(tile.z, tile.x, tile.y);
        if (got) out.set(tileKey(tile), new Uint8Array(got.data));
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, tiles.length) }, worker));
  signal?.throwIfAborted();
  return out;
}

/** A tile for MapLibre, from memory. Outside the corridor it is empty: there is no fetching here, ever. */
export function tileFromMemory(tiles: ReadonlyMap<string, Uint8Array>, url: string): Uint8Array<ArrayBuffer> {
  const key = /(\d+\/\d+\/\d+)(?:\?.*)?$/.exec(url)?.[1];
  const tile = key === undefined ? undefined : tiles.get(key);
  // a copy: MapLibre hands the buffer to its worker, which takes it away
  return tile ? new Uint8Array(tile) : new Uint8Array();
}
