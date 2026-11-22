/**
 * A Google Maps walking link for a route (blueprint Phase 5b amendment 20). Every point in it is the API's: the
 * route's two ends and some of its km marks, chosen by their order alone. Nothing is measured or placed here, and
 * Google may draw a different path between the points.
 * URL format and limits: https://developers.google.com/maps/documentation/urls/get-started
 */

export type LonLat = readonly [number, number];
export type RoutePoints = { start: LonLat; end: LonLat; kmMarks: readonly { lon: number; lat: number }[] };

/** Google takes 3 waypoints in mobile browsers and 9 elsewhere; we use at most 8 (amendment 20). */
export const WAYPOINTS = { mobile: 3, other: 8 } as const;

type Browser = { userAgent: string; maxTouchPoints?: number };

export function waypointLimit({ userAgent, maxTouchPoints = 0 }: Browser): number {
  // an iPad asks for desktop pages, as a Macintosh with a touch screen
  const mobile = /Android|iPhone|iPad|iPod|Mobi/.test(userAgent) || (userAgent.includes("Macintosh") && maxTouchPoints > 1);
  return mobile ? WAYPOINTS.mobile : WAYPOINTS.other;
}

/** Up to `max` of the items, evenly spaced by their order, neither end preferred. */
export function pickEvenly<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  return Array.from({ length: max }, (_, i) => items[Math.round(((i + 1) * (items.length + 1)) / (max + 1)) - 1]!);
}

// Google wants latitude first; six decimals is about 10 cm
const latLon = ([lon, lat]: LonLat) => `${lat.toFixed(6)},${lon.toFixed(6)}`;

export function googleMapsUrl({ start, end, kmMarks }: RoutePoints, max: number): string {
  const query = new URLSearchParams({ api: "1", travelmode: "walking", origin: latLon(start), destination: latLon(end) });
  const via = pickEvenly(kmMarks, max);
  if (via.length) query.set("waypoints", via.map((m) => latLon([m.lon, m.lat])).join("|"));
  return `https://www.google.com/maps/dir/?${query.toString()}`;
}
