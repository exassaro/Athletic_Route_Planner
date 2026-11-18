/**
 * web/brand/sprites.json (read by the build) is exactly the approved art in docs/reports/phase5b/sprites.md, and
 * every sprite is a clean grid in its own palette.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
    // rows 8 and 9: the shaft; the head widens to rows 6 to 11 at its tip
    const shaft = sprites.sneaker.rows.slice(8, 10).map((r: string) => r.slice(5, 13));
    expect(shaft).toEqual(["RRRRRRRR", "RRRRRRRR"]);
  });
});
