// @vitest-environment node
/** The logo's grids, the generated module and the icons (blueprint Phase 5b amendments 23 to 28). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs build script, no types
import { iconCells, iconPixels, render, spec, WORDMARK, wordmarkCells } from "../../scripts/make-brand.mjs";

const web = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(web, ...p), "utf8").replaceAll("\r\n", "\n");
const sorted = (cells: number[][]) => cells.map(String).sort();

describe("logo", () => {
  it("five letters, each 5 x 7, as in sprites.md", () => {
    expect(spec.word).toBe("GATHO");
    expect(Object.keys(spec.letters)).toEqual([...spec.word]);
    for (const grid of Object.values(spec.letters) as string[][]) {
      expect(grid).toHaveLength(7);
      for (const row of grid) expect(row).toMatch(/^[01]{5}$/);
    }
    const blocks = [...read("..", "docs", "reports", "phase5b", "sprites.md").matchAll(/```json\n([\s\S]*?)\n```/g)];
    expect(spec.letters).toEqual(JSON.parse(blocks[2]![1]!));
  });

  it("only the O's centre cell (column 2, row 3) is orange", () => {
    expect(spec.letters.O[3][2]).toBe("0");                 // the hole, where the dot goes
    expect(wordmarkCells().dot).toEqual([[1 + 4 * 6 + 2, 1 + 3]]);
    expect(iconCells(9, true).dot).toEqual([[4, 4]]);
    expect(spec.icon.dot).toBe("#E8673A");
  });

  it("one blank column between letters and a margin of one cell", () => {
    expect(WORDMARK).toEqual({ w: 31, h: 9 });
    const all: number[][] = Object.values(wordmarkCells() as Record<string, number[][]>).flat();
    for (const [x, y] of all) {
      expect([0, 6, 12, 18, 24, 30]).not.toContain(x);
      expect([0, 8]).not.toContain(y);
    }
  });

  it("the icon: the O at column 2, row 1, on a tile with its corners cut by one cell", () => {
    const { tile, o } = iconCells(9, true);
    const want: number[][] = [];
    (spec.letters.O as string[]).forEach((r, y) => [...r].forEach((c, x) => { if (c === "1") want.push([x + 2, y + 1]); }));
    expect(sorted(o)).toEqual(sorted(want));
    expect(tile).toHaveLength(77);
    expect(sorted(tile)).not.toContain("0,0");
  });

  it("the maskable O is inside the 80 % safe circle", () => {
    const n = spec.icon.maskableGrid;
    for (const [x, y] of iconCells(n, false).o as number[][]) {
      for (const dx of [0, 1]) for (const dy of [0, 1]) expect(Math.hypot(x! + dx - n / 2, y! + dy - n / 2)).toBeLessThanOrEqual(0.4 * n);
    }
  });

  it("PNGs are nearest-neighbour: only the three brand colours, and clear corners", () => {
    for (const size of [16, 32, 512]) {
      const px: Uint8Array = iconPixels(size, 9, true);
      const colours = new Set<string>();
      for (let i = 0; i < px.length; i += 4) colours.add(px.slice(i, i + 4).join(","));
      expect(colours, String(size)).toEqual(new Set(["0,0,0,0", "29,158,117,255", "247,245,238,255", "232,103,58,255"]));
    }
  });

  it("the generated module is up to date", () => {
    expect(read("src", "brand", "logo.ts")).toBe(render());
  });
});
