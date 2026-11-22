/** Route lines go below every overlay, and the obstacles stay on top (amendment 14). */
import { describe, expect, it } from "vitest";
import { layerAbove, OBSTACLES } from "./overlays";

const mapWith = (...ids: string[]) => ({ getLayer: (id: string) => (ids.includes(id) ? { id } : undefined) }) as never;

describe("layerAbove", () => {
  it("puts a route line below the lowest overlay there is", () => {
    expect(layerAbove(mapWith("km-labels", "km-marks", OBSTACLES))).toBe("km-marks");
    expect(layerAbove(mapWith())).toBeUndefined();
  });
  it("puts an overlay below those above it, whatever order they arrived in", () => {
    expect(layerAbove(mapWith(OBSTACLES), "km-labels")).toBe(OBSTACLES);
    expect(layerAbove(mapWith("km-labels", "chart-cursor"), "pin-links")).toBe("km-labels");
    expect(layerAbove(mapWith("km-marks"), OBSTACLES)).toBeUndefined();
  });
});
