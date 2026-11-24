/**
 * A Google Maps walking link for a route: an overview, never the exact route, which is the GPX (blueprint Phase 5d
 * amendments 1 and 2). Every point in it is the API's: the route's two ends and either its overview points (A14)
 * or, until those arrive or without them, some of its km marks, chosen by their order alone. Nothing is measured or
 * placed here, and Google may draw a different path between the points. Walking always: driving is road-only and
 * obeys one-ways.
 * URL format and limits: https://developers.google.com/maps/documentation/urls/get-started
 */

import type { Schemas } from "@/api/client";

export type LonLat = readonly [number, number];
type Position = { lon: number; lat: number };
export type RoutePoints = { start: LonLat; end: LonLat; kmMarks: readonly Position[] };
export type Overview = Schemas["OverviewPointsOut"];

/** Google takes 3 waypoints in mobile browsers and 9 elsewhere (Phase 5d amendment 1). */
export const WAYPOINTS = { mobile: 3, other: 9 } as const;
/** Narrower than this is narrow: the width where the app itself stops showing its desktop panel. */
export const NARROW_PX = 900;

export type Device = { userAgent: string; maxTouchPoints: number; coarsePointer: boolean; width: number };

/**
 * A mobile browser by its user agent, or by a coarse pointer on a narrow screen: a phone set to "Desktop site"
 * sends a desktop user agent.
 */
export function isMobileBrowser({ userAgent, maxTouchPoints, coarsePointer, width }: Device): boolean {
  if (/Android|iPhone|iPad|iPod|Mobi/.test(userAgent)) return true;
  // an iPad asks for desktop pages, as a Macintosh with a touch screen
  if (userAgent.includes("Macintosh") && maxTouchPoints > 1) return true;
  return coarsePointer && width < NARROW_PX;
}

export function waypointLimit(device: Device): number {
  return isMobileBrowser(device) ? WAYPOINTS.mobile : WAYPOINTS.other;
}

export function thisDevice(): Device {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
    // "Desktop site" widens the viewport to about 980 px, not the screen
    width: Math.min(window.innerWidth, window.screen.width || window.innerWidth),
  };
}

/** Up to `max` of the items, evenly spaced by their order, neither end preferred. */
export function pickEvenly<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  return Array.from({ length: max }, (_, i) => items[Math.round(((i + 1) * (items.length + 1)) / (max + 1)) - 1]!);
}

// Google wants latitude first; six decimals is about 10 cm
const latLon = ([lon, lat]: LonLat) => `${lat.toFixed(6)},${lon.toFixed(6)}`;

/** `overview`: the API's overview points for this limit; without them, evenly spaced km marks. */
export function googleMapsUrl({ start, end, kmMarks }: RoutePoints, max: number, overview?: readonly Position[]): string {
  const query = new URLSearchParams({ api: "1", travelmode: "walking", origin: latLon(start), destination: latLon(end) });
  const via = overview && overview.length <= max ? overview : pickEvenly(kmMarks, max);
  if (via.length) query.set("waypoints", via.map((m) => latLon([m.lon, m.lat])).join("|"));
  return `https://www.google.com/maps/dir/?${query.toString()}`;
}
