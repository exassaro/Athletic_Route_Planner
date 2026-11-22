/** The Google Maps link (amendment 20), on the API's own A01 elevation example. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { googleMapsUrl, pickEvenly, waypointLimit, type RoutePoints } from "./googleMaps";

const elev = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "api", "athlete_api", "examples", "elevation_A01.json"), "utf8")).value;
const A01: RoutePoints = { start: elev.points[0], end: elev.points.at(-1), kmMarks: elev.km_marks };
const text = ([lon, lat]: readonly [number, number]) => `${lat.toFixed(6)},${lon.toFixed(6)}`;
const params = (url: string) => new URL(url).searchParams;

describe("googleMapsUrl", () => {
  it("a walking link between the route's own ends", () => {
    const url = new URL(googleMapsUrl(A01, 8));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("travelmode")).toBe("walking");
    expect(url.searchParams.get("origin")).toBe(text(A01.start));
    expect(url.searchParams.get("destination")).toBe(text(A01.end));
  });

  for (const max of [3, 8]) {
    it(`never more than ${max} waypoints, each one of the API's km marks, in route order`, () => {
      const marks = A01.kmMarks.map((m) => text([m.lon, m.lat]));
      const some = { ...A01, kmMarks: Array.from({ length: 24 }, (_, i) => A01.kmMarks[i % A01.kmMarks.length]!) };
      expect(params(googleMapsUrl(some, max)).get("waypoints")!.split("|")).toHaveLength(max);
      const got = params(googleMapsUrl(A01, max)).get("waypoints")!.split("|");
      expect(got).toHaveLength(Math.min(max, marks.length));
      const at = got.map((p) => marks.indexOf(p));
      expect(at).not.toContain(-1);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    });
  }

  it("encodes commas and pipes, and stays under Google's 2048 characters", () => {
    const url = googleMapsUrl(A01, 8);
    expect(url).toContain("%2C");
    expect(url).not.toMatch(/[|, ]/);
    if (A01.kmMarks.length > 1) expect(url).toContain("%7C");
    expect(url.length).toBeLessThan(2048);
  });

  it("a closed loop keeps its shape: same origin and destination, waypoints between", () => {
    const q = params(googleMapsUrl({ ...A01, end: A01.start }, 3));
    expect(q.get("destination")).toBe(q.get("origin"));
    expect(q.get("waypoints")).toBeTruthy();
  });

  it("a route under 1 km has no waypoints", () => {
    expect(params(googleMapsUrl({ ...A01, kmMarks: [] }, 3)).has("waypoints")).toBe(false);
  });
});

describe("pickEvenly", () => {
  it("spreads by order", () => {
    const km = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
    expect(pickEvenly(km(9), 3)).toEqual([3, 5, 8]);       // the middle mark of a 10 km out-and-back is its turn
    expect(pickEvenly(km(24), 3)).toEqual([6, 13, 19]);
    expect(pickEvenly(km(2), 3)).toEqual([1, 2]);
    expect(new Set(pickEvenly(km(9), 8)).size).toBe(8);
  });
});

describe("waypointLimit", () => {
  it("3 in mobile browsers, 8 elsewhere", () => {
    expect(waypointLimit({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36" })).toBe(3);
    expect(waypointLimit({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Safari/604.1" })).toBe(3);
    expect(waypointLimit({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1", maxTouchPoints: 5 })).toBe(3);
    expect(waypointLimit({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36" })).toBe(8);
  });
});
