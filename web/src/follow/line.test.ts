/** The route as Follow measures against it (Phase 5d amendment 5). */
import { describe, expect, it } from "vitest";
import { bearingXY, createLine, hitsBetween, nearestOnRoute, pointAt, segmentAt, splitAt } from "./line";
import { lineOf, made, ROUTES } from "./testing";

describe("the line", () => {
  for (const name of ["A01", "S02", "out_and_back"] as const) {
    it(`${name}: its length is the API's, and the plane agrees with the API's metres on every segment`, () => {
      const line = lineOf(name);
      expect(line.totalM).toBe(ROUTES[name].along_m.at(-1));
      for (let i = 0; i + 1 < line.flat.length; i++) {
        const [a, b] = [line.flat[i]!, line.flat[i + 1]!];
        const planned = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const measured = line.alongM[i + 1]! - line.alongM[i]!;      // rounded to 0.1 m by the API
        expect(Math.abs(planned - measured), `segment ${i}`).toBeLessThan(0.11 + measured * 0.002);
      }
    });
  }

  it("interpolates between the API's metres and never measures", () => {
    const line = createLine([[75.8, 11.1], [75.81, 11.1]], [0, 5000]);     // metres deliberately not the geometry's
    expect(pointAt(line, 2500)[0]).toBeCloseTo(75.805, 9);
    expect(nearestOnRoute(line, line.toXY([75.805, 11.1])).m).toBeCloseTo(2500, 6);
  });

  it("needs the metres of every vertex", () => {
    expect(() => createLine([[75.8, 11.1], [75.81, 11.1]], [0])).toThrow();
    expect(() => createLine([[75.8, 11.1]], [0])).toThrow();
  });

  it("finds the segment, also at both ends and over a repeated vertex", () => {
    const line = made([0, 100], [0, 0], [0, 100]);
    expect(segmentAt(line, 0)).toBe(0);
    expect(segmentAt(line, 99.9)).toBe(0);
    expect(segmentAt(line, 150)).toBe(2);
    expect(segmentAt(line, 999)).toBe(2);
    expect(nearestOnRoute(line, [3, 150]).offM).toBeCloseTo(3, 1);
  });

  it("looks only between the two distances given", () => {
    const hits = hitsBetween(made([0, 1000]), [10, 800], 100, 300);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.m).toBeCloseTo(300, 1);
    expect(hits[0]!.offM).toBeCloseTo(Math.hypot(10, 500), 0);
  });

  it("splits into the part done and the part left, sharing the point between", () => {
    const line = made([0, 100], [100, 0]);
    const { done, left } = splitAt(line, 150);
    expect(done).toHaveLength(3);
    expect(left).toHaveLength(2);
    expect(done.at(-1)).toEqual(left[0]);
  });

  it("gives the bearing from north, and none to the same place", () => {
    expect(bearingXY([0, 0], [0, 10])).toBe(0);
    expect(bearingXY([0, 0], [10, 0])).toBe(90);
    expect(bearingXY([0, 0], [-10, 0])).toBe(270);
    expect(bearingXY([5, 5], [5, 5])).toBeNull();
  });
});
