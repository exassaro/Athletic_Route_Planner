/** The route's corridor and the Follow map's style (Phase 5d amendment 7): nothing asks by position. */
import { describe, expect, it, vi } from "vitest";
import { lineOf } from "@/follow/testing";
import { corridorTiles, loadCorridor, MAX_ZOOM, MIN_ZOOM, tileAt, tileFromMemory, tileKey, type Tile } from "./corridor";
import { meFeatures, routeFeatures } from "./followLayers";
import { followStyle } from "./followStyle";

describe("the corridor", () => {
  for (const name of ["A01", "S02", "out_and_back"] as const) {
    it(`${name}: every zoom has the tile under every vertex and 500 m either side`, () => {
      const line = lineOf(name);
      const keys = new Set(corridorTiles(line.points).map(tileKey));
      for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
        for (const [lon, lat] of line.points) {
          for (const [dx, dy] of [[0, 0], [0.0045, 0], [-0.0045, 0], [0, 0.0045], [0, -0.0045]] as const) {
            expect(keys.has(tileKey(tileAt([lon + dx, lat + dy], z))), `${z}: ${lon},${lat}`).toBe(true);
          }
        }
      }
    });

    it(`${name}: is small enough to fetch before a run`, () => {
      expect(corridorTiles(lineOf(name).points).length).toBeLessThan(160);
    });
  }

  it("covers a long straight segment between two vertices", () => {
    const keys = new Set(corridorTiles([[75.7, 11.1], [75.9, 11.3]]).map(tileKey));
    for (let k = 0; k <= 50; k++) expect(keys.has(tileKey(tileAt([75.7 + 0.004 * k, 11.1 + 0.004 * k], 15)))).toBe(true);
  });

  it("depends on the route alone: the same list, in the same order", () => {
    const { points } = lineOf("S02");
    expect(corridorTiles(points)).toEqual(corridorTiles([...points]));
  });
});

describe("loading it", () => {
  const tiles: Tile[] = Array.from({ length: 20 }, (_, i) => ({ z: 15, x: i, y: 1 }));

  it("asks for each tile once, six at a time at most", async () => {
    let now = 0;
    let most = 0;
    const getZxy = vi.fn(async (_z: number, x: number) => {
      most = Math.max(most, ++now);
      await new Promise((r) => setTimeout(r, 1));
      now--;
      return x === 3 ? undefined : { data: new Uint8Array([x]).buffer as ArrayBuffer };
    });
    const got = await loadCorridor({ getZxy }, tiles);
    expect(getZxy).toHaveBeenCalledTimes(20);
    expect(most).toBe(6);
    expect(got.size).toBe(19);          // one the archive has none of
  });

  it("rejects when a tile fails", async () => {
    const getZxy = async () => { throw new Error("offline"); };
    await expect(loadCorridor({ getZxy }, tiles)).rejects.toThrow("offline");
  });
});

describe("serving it", () => {
  it("only ever from memory: outside the corridor a tile is empty", () => {
    const memory = new Map([["15/23280/15356", new Uint8Array([1, 2, 3])]]);
    expect([...tileFromMemory(memory, "corridor://tiles/15/23280/15356?2")]).toEqual([1, 2, 3]);
    expect(tileFromMemory(memory, "corridor://tiles/15/1/1?2")).toHaveLength(0);
  });

  it("hands MapLibre a copy, because its worker takes the buffer away", () => {
    const kept = new Uint8Array([7]);
    expect(tileFromMemory(new Map([["9/1/1", kept]]), "corridor://tiles/9/1/1?0").buffer).not.toBe(kept.buffer);
  });
});

describe("the Follow style", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme}: no fonts URL and no tile address on the server`, () => {
      const style = followStyle("https://gatho.test", theme, 1);
      expect(style.glyphs).toBeUndefined();
      expect(Object.keys(style.sources)).toHaveLength(1);
      expect(JSON.stringify(style.sources)).not.toMatch(/https?:|pmtiles/);
      expect(style.sprite).toBe(`https://gatho.test/basemap/sprites/${theme}`);
      expect(style.layers.length).toBeGreaterThan(20);
    });
  }
});

describe("battery saver's style", () => {
  it("darkens the layers and keeps the sprite, so nothing is fetched during the run", () => {
    const saver = followStyle("https://gatho.test", "dark", 1, "light");
    expect(saver.sprite).toBe("https://gatho.test/basemap/sprites/light");
    expect(saver.layers).toEqual(followStyle("https://gatho.test", "dark", 1).layers);
  });
});

describe("what is drawn", () => {
  const line = lineOf("S02");
  const parts = (features: { properties: { part: string } }[]) => features.map((f) => f.properties.part);

  it("the part done and the part left", () => {
    expect(parts(routeFeatures(line, 0))).toEqual(["left"]);
    expect(parts(routeFeatures(line, 5000))).toEqual(["done", "left"]);
    expect(parts(routeFeatures(line, line.totalM))).toEqual(["done"]);
  });

  it("the dot and a ring of the fix's accuracy in metres", () => {
    expect(meFeatures(line, null)).toEqual([]);
    const point = line.points[10]!;
    const [circle, dot] = meFeatures(line, { point, accuracy: 25 });
    expect(dot!.geometry.coordinates).toEqual([...point]);
    const [x, y] = line.toXY(point);
    for (const [lon, lat] of (circle!.geometry.coordinates as number[][][])[0]!) {
      const [px, py] = line.toXY([lon!, lat!]);
      expect(Math.hypot(px - x, py - y)).toBeCloseTo(25, 1);
    }
  });
});
