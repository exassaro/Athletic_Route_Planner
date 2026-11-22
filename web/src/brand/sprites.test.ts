/**
 * web/brand/sprites.json (read by the build) is exactly the approved art in docs/reports/phase5b/sprites.md, every
 * sprite is a clean grid in its own palette, and src/brand/sprites.ts is what scripts/gen-sprites.mjs makes from it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs build script, no types
import { CYCLE_CANVAS, render, shifted } from "../../scripts/gen-sprites.mjs";
import { SPRITES } from "./sprites";

const web = join(__dirname, "..", "..");
const sprites = JSON.parse(readFileSync(join(web, "brand", "sprites.json"), "utf8"));
const md = readFileSync(join(web, "..", "docs", "reports", "phase5b", "sprites.md"), "utf8");
const blocks = [...md.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]!));

function grid(rows: string[], palette: Record<string, string>, w: number, h: number) {
  expect(rows).toHaveLength(h);
  for (const r of rows) {
    expect(r).toHaveLength(w);
    for (const ch of r) if (ch !== ".") expect(palette, `letter ${ch}`).toHaveProperty(ch);
  }
}

/** Every pixel of a sprite as "x,y" per colour, from the generated paths (each path is runs of h-wide rectangles). */
function pixels(d: string): Set<string> {
  const out = new Set<string>();
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) for (let i = 0; i < Number(m[3]); i++) out.add(`${Number(m[1]) + i},${m[2]}`);
  return out;
}

describe("sprites", () => {
  it("match the approved strings in sprites.md", () => {
    expect(sprites.sneaker.rows).toEqual(blocks[0]);
    expect(sprites.cycle).toEqual(blocks[1]);
    expect(Object.keys(sprites)).toEqual(["sneaker", "cycle"]);
  });

  it("are clean grids in their palettes", () => {
    grid(sprites.sneaker.rows, sprites.sneaker.palette, 31, 17);
  });

  it("the loading frames move whole columns of the approved sneaker and redraw nothing", () => {
    const { rows, palette } = sprites.sneaker;
    const column = (r: string[], x: number) => r.map((row) => row[x]).join("").replace(/^\.+|\.+$/g, "");
    const tops = (r: string[], x: number) => r.findIndex((row) => row[x] !== ".");
    const expected = [(_: number) => 0, (x: number) => -1 - Math.floor(x / 11), (_: number) => 0, (x: number) => -Math.floor((30 - x) / 11)];
    const dx = [0, 0, 3, 1];
    expect(sprites.cycle.frames).toHaveLength(4);
    sprites.cycle.frames.forEach((f: object, i: number) => {
      const frame: string[] = shifted(rows, sprites.cycle.step, f);
      grid(frame, palette, CYCLE_CANVAS.w, CYCLE_CANVAS.h);
      for (let x = 0; x < 31; x++) {
        if (tops(rows, x) < 0) continue;                 // the sprite's blank last column
        const at = CYCLE_CANVAS.shoeX + x + dx[i]!;
        expect(column(frame, at), `frame ${i + 1}, column ${x}`).toBe(column(rows, x));
        expect(tops(frame, at), `frame ${i + 1}, column ${x}`).toBe(CYCLE_CANVAS.shoeY + tops(rows, x) + expected[i]!(x));
      }
    });
  });

  it("keep the sneaker's mark an arrow pointing forward", () => {
    const shaft = sprites.sneaker.rows.slice(8, 10).map((r: string) => r.slice(5, 13));
    expect(shaft).toEqual(["RRRRRRRR", "RRRRRRRR"]);
  });

  it("the generated module is up to date and draws exactly the approved pixels", () => {
    expect(readFileSync(join(__dirname, "sprites.ts"), "utf8")).toBe(render());
    const rows: string[] = sprites.sneaker.rows;
    const drawn = new Set<string>();
    for (const l of SPRITES.sneaker.layers) for (const p of pixels(l.d)) drawn.add(p);
    const want = new Set<string>();
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== ".") want.add(`${x},${y}`); }));
    expect(drawn).toEqual(want);
  });
});
