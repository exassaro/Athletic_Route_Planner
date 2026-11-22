/** The banner's timing (Phase 5d amendment 9). */
import { describe, expect, it } from "vitest";
import { offRoute, ON_ROUTE, type OffRoute } from "./offRoute";

type Fix = [second: number, offM: number, accuracy?: number];
const after = (...fixes: Fix[]): OffRoute =>
  fixes.reduce((s, [second, offM, accuracy = 8]) => offRoute(s, { at: second * 1000, offM, accuracy }), ON_ROUTE);
const every = (from: number, to: number, offM: number, accuracy = 8): Fix[] =>
  Array.from({ length: to - from + 1 }, (_, i) => [from + i, offM, accuracy]);

describe("the off-route banner", () => {
  it("shows at 10 s off the line, not before", () => {
    expect(after(...every(0, 9, 60)).shown).toBe(false);
    expect(after(...every(0, 10, 60)).shown).toBe(true);
  });

  it("needs more than 40 m", () => {
    expect(after(...every(0, 60, 40)).shown).toBe(false);
    expect(after(...every(0, 10, 40.1)).shown).toBe(true);
  });

  it("needs two fixes, however long ago the first was", () => {
    expect(after([0, 60]).shown).toBe(false);
    expect(after([0, 60], [15, 60]).shown).toBe(true);
  });

  it("guesses nothing from fixes of 30 m accuracy or worse", () => {
    expect(after(...every(0, 60, 80, 30)).shown).toBe(false);
    expect(after(...every(0, 10, 80, 29.9)).shown).toBe(true);
  });

  it("needs the two to be consecutive: a weak one between starts the two again", () => {
    expect(after([0, 60], [5, 60, 45], [11, 60]).shown).toBe(false);
    expect(after([0, 60], [5, 60, 45], [11, 60], [12, 60]).shown).toBe(true);
  });

  it("one good fix on the line starts the 10 s again", () => {
    expect(after(...every(0, 8, 60), [9, 10], ...every(10, 19, 60)).shown).toBe(false);
    expect(after(...every(0, 8, 60), [9, 10], ...every(10, 20, 60)).shown).toBe(true);
  });

  it("clears on a good fix on the line, not on a weak one", () => {
    expect(after(...every(0, 11, 60), [12, 5, 60]).shown).toBe(true);
    expect(after(...every(0, 11, 60), [12, 5]).shown).toBe(false);
  });
});
