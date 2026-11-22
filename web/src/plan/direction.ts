/**
 * Directions in words (blueprint Phase 5b amendment 18). The request keeps the API's values (degrees, or a place);
 * everything here is a label.
 *
 * `bearingToPlace` is the one exception to Phase 5 amendment 4: the UI works out which way a place lies from the
 * start, only to say "Heading south-east, towards Beypore". It is never sent, stored or used for anything else.
 */
import type { RouteRequest } from "./edits";

export const DIRECTIONS = [
  { degrees: 0, name: "North" },
  { degrees: 45, name: "North-east" },
  { degrees: 90, name: "East" },
  { degrees: 135, name: "South-east" },
  { degrees: 180, name: "South" },
  { degrees: 225, name: "South-west" },
  { degrees: 270, name: "West" },
  { degrees: 315, name: "North-west" },
] as const;

const ON_SCREEN = ["up", "up and right", "right", "down and right", "down", "down and left", "left", "up and left"] as const;

/** The nearest of the eight points, 0 (north) to 7 (north-west). */
export function eighth(degrees: number): number {
  return ((Math.round(degrees / 45) % 8) + 8) % 8;
}

/** Where a direction lies on the map as it is turned now (`mapBearing`: what is at the top of the screen). */
export function onMap(degrees: number, mapBearing = 0): string {
  return `${ON_SCREEN[eighth(degrees - mapBearing)]} on the map`;
}

type At = { lon: number; lat: number };

/** For a label only (see the top of this file): the initial bearing from one point to another, in degrees. */
export function bearingToPlace(from: At, to: At): number | null {
  if (from.lon === to.lon && from.lat === to.lat) return null;
  const rad = Math.PI / 180;
  const dLon = (to.lon - from.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dLon);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

type Directed = { start?: At | null; direction?: RouteRequest["direction"] };

/** The way the request points: its own degrees, or the label-only bearing to its place. */
export function pointing({ start, direction }: Directed): number | null {
  if (!direction) return null;
  if (direction.kind === "bearing") return direction.degrees;
  return start ? bearingToPlace(start, direction.place) : null;
}

/** "Heading south-east, towards Beypore", "Heading south-east", or null with no direction. */
export function directionText(request: Directed): string | null {
  const d = request.direction;
  if (!d) return null;
  const place = d.kind === "towards_place" ? d.place.label : null;
  const degrees = pointing(request);
  if (degrees === null) return `Towards ${place ?? "a point"}`;
  const heading = `Heading ${DIRECTIONS[eighth(degrees)]!.name.toLowerCase()}`;
  return place ? `${heading}, towards ${place}` : heading;
}
