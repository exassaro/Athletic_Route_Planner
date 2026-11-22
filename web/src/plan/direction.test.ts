/** Direction labels (amendment 18). The places' coordinates are the API's own examples. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bearingToPlace, DIRECTIONS, directionText, eighth, onMap, pointing } from "./direction";
import type { RouteRequest } from "./edits";

const A01: RouteRequest = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "api", "athlete_api", "examples", "plan_A01.json"), "utf8")).value.request;
const heading = (degrees: number) => directionText({ start: A01.start, direction: { kind: "bearing", degrees } });

describe("direction labels", () => {
  it("eight full words, on the API's unchanged degrees", () => {
    expect(DIRECTIONS.map((d) => [d.degrees, d.name])).toEqual([[0, "North"], [45, "North-east"], [90, "East"],
      [135, "South-east"], [180, "South"], [225, "South-west"], [270, "West"], [315, "North-west"]]);
  });

  it("any bearing reads as the nearest of the eight", () => {
    expect([0, 22, 23, 135, 337, 338, 359.9].map(eighth)).toEqual([0, 0, 1, 3, 7, 0, 0]);
    expect(eighth(-45)).toBe(7);
  });

  it("says where it lies on the map, as turned", () => {
    expect(DIRECTIONS.map((d) => onMap(d.degrees))).toEqual(["up", "up and right", "right", "down and right", "down",
      "down and left", "left", "up and left"].map((w) => `${w} on the map`));
    expect(onMap(90, 90)).toBe("up on the map");
    expect(onMap(0, 90)).toBe("left on the map");
    expect(onMap(180, -180)).toBe("up on the map");
  });

  it("a sentence, with the place when it is known", () => {
    expect(heading(135)).toBe("Heading south-east");
    expect(directionText(A01)).toBe("Heading north-west, towards Kozhikode");
    const unnamed = { kind: "towards_place" as const, place: { lon: A01.start.lon, lat: A01.start.lat - 0.1, label: null, place_id: null } };
    expect(directionText({ start: A01.start, direction: unnamed })).toBe("Heading south");
    expect(directionText({ start: A01.start, direction: null })).toBeNull();
    expect(directionText({ start: null, direction: A01.direction })).toBe("Towards Kozhikode");
  });

  it("the bearing to a place: the four quarters, and none to the same point", () => {
    const at = { lon: 75.8, lat: 11.2 };
    const to = (lon: number, lat: number) => bearingToPlace(at, { lon: at.lon + lon, lat: at.lat + lat })!;
    expect([to(0, 0.1), to(0.1, 0), to(0, -0.1), to(-0.1, 0)].map(eighth)).toEqual([0, 2, 4, 6]);
    expect(bearingToPlace(at, at)).toBeNull();
    expect(pointing({ start: at, direction: { kind: "bearing", degrees: 225 } })).toBe(225);
  });
});
