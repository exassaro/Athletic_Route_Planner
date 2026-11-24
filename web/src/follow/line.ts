/**
 * The route as Follow mode measures against it (blueprint Phase 5d amendment 5).
 *
 * Distances along the route are the API's metres at each vertex (A15), interpolated within a segment; none is
 * measured here. The local plane is for what the amendment allows the UI: which segment a position is on, the
 * straight line back to it and that line's bearing. Pure: no DOM, no network, no storage.
 */

export type LonLat = readonly [number, number];
export type XY = readonly [number, number];

export type Line = {
  points: readonly LonLat[];
  alongM: readonly number[];
  totalM: number;
  flat: readonly XY[];
  toXY(point: LonLat): XY;
};

/** A position on the route: metres along it, and the straight line to it. */
export type Hit = { m: number; offM: number; xy: XY };

// WGS84
const A = 6378137;
const E2 = 0.00669437999014;
const RAD = Math.PI / 180;

export function createLine(points: readonly LonLat[], alongM: readonly number[]): Line {
  if (points.length < 2 || points.length !== alongM.length) throw new Error("A route needs its metres at every vertex.");
  const [lon0, lat0] = points[0]!;
  const w = 1 - E2 * Math.sin(lat0 * RAD) ** 2;
  const kx = RAD * (A / Math.sqrt(w)) * Math.cos(lat0 * RAD);
  const ky = RAD * ((A * (1 - E2)) / w ** 1.5);
  const toXY = ([lon, lat]: LonLat): XY => [(lon - lon0) * kx, (lat - lat0) * ky];
  return { points, alongM, totalM: alongM[alongM.length - 1]!, flat: points.map(toXY), toXY };
}

/** The index of the segment that holds `m`. */
export function segmentAt(line: Line, m: number): number {
  let lo = 0;
  let hi = line.alongM.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (line.alongM[mid]! <= m) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The closest position to `p` on each segment between fromM and toM along the route, in route order. */
export function hitsBetween(line: Line, p: XY, fromM: number, toM: number): Hit[] {
  const from = Math.min(Math.max(fromM, 0), line.totalM);
  const to = Math.min(Math.max(toM, from), line.totalM);
  const out: Hit[] = [];
  for (let i = segmentAt(line, from); i < line.alongM.length - 1; i++) {
    const a = line.alongM[i]!;
    const b = line.alongM[i + 1]!;
    if (a > to) break;
    const [ax, ay] = line.flat[i]!;
    const dx = line.flat[i + 1]![0] - ax;
    const dy = line.flat[i + 1]![1] - ay;
    const span = b - a;
    const lowest = span ? Math.max(0, (from - a) / span) : 0;
    const highest = span ? Math.min(1, (to - a) / span) : 0;
    if (lowest > highest) continue;
    const squared = dx * dx + dy * dy;
    const nearest = squared ? ((p[0] - ax) * dx + (p[1] - ay) * dy) / squared : 0;
    const t = Math.min(Math.max(nearest, lowest), highest);
    const xy: XY = [ax + t * dx, ay + t * dy];
    out.push({ m: a + t * span, offM: Math.hypot(p[0] - xy[0], p[1] - xy[1]), xy });
  }
  return out;
}

export function closest(hits: readonly Hit[]): Hit | null {
  let best: Hit | null = null;
  for (const hit of hits) if (!best || hit.offM < best.offM) best = hit;
  return best;
}

/** The nearest place on the whole route, whatever the progress: what "off the route" is judged by. */
export function nearestOnRoute(line: Line, p: XY): Hit {
  return closest(hitsBetween(line, p, 0, line.totalM))!;
}

/** Where `m` along the route is, as [lon, lat]: where the part done ends on the map. */
export function pointAt(line: Line, m: number): LonLat {
  const at = Math.min(Math.max(m, 0), line.totalM);
  const i = segmentAt(line, at);
  const a = line.alongM[i]!;
  const span = line.alongM[i + 1]! - a;
  const t = span ? (at - a) / span : 0;
  const [p, q] = [line.points[i]!, line.points[i + 1]!];
  return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
}

/** The route's two parts at `m`: what is done (drawn dimmed) and what is left. */
export function splitAt(line: Line, m: number): { done: LonLat[]; left: LonLat[] } {
  const at = pointAt(line, m);
  const i = segmentAt(line, Math.min(Math.max(m, 0), line.totalM));
  return { done: [...line.points.slice(0, i + 1), at], left: [at, ...line.points.slice(i + 1)] };
}

/** The bearing from one position on the plane to another, 0 to 360 from north; null when they are the same. */
export function bearingXY(from: XY, to: XY): number | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.hypot(dx, dy) < 0.01) return null;
  return (Math.atan2(dx, dy) / RAD + 360) % 360;
}
