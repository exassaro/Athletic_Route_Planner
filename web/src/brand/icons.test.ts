/** src/brand/icons.ts is what scripts/gen-icons.mjs makes from the pinned pixelarticons: run `npm run gen:icons`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs build script, no types
import { render } from "../../scripts/gen-icons.mjs";

describe("icons", () => {
  it("are up to date with the pinned pixelarticons", () => {
    expect(readFileSync(join(__dirname, "icons.ts"), "utf8")).toBe(render());
  });
});
