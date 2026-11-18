/**
 * web/brand/sprites.json (read by the build) is exactly the approved art in docs/reports/phase5b/sprites.md, every
 * sprite is a clean grid in its own palette, and src/brand/sprites.ts is what scripts/gen-sprites.mjs makes from it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs build script, no types
import { render } from "../../scripts/gen-sprites.mjs";
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
    expect(sprites.runner.rows).toEqual(blocks[1]);
    expect(sprites.runCycle.frames).toEqual(Object.values(blocks[2]));
  });

  it("are clean grids in their palettes", () => {
    grid(sprites.sneaker.rows, sprites.sneaker.palette, 31, 17);
    grid(sprites.runner.rows, sprites.runner.palette, 28, 25);
    expect(sprites.runCycle.frames).toHaveLength(4);
    for (const f of sprites.runCycle.frames) grid(f, sprites.runner.palette, 28, 25);
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
