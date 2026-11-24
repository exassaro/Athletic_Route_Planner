/** Test helpers for Follow: the fixture routes (real A15 responses) and a simulated phone with seeded noise. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Schemas } from "@/api/client";
import { createLine, pointAt, type Line, type LonLat, type XY } from "./line";
import { reduceRun, startRun, type Run, type RunEvent } from "./run";

type Follow = Schemas["FollowOut"];
export const ROUTES: Record<"A01" | "S02" | "out_and_back", Follow> = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "tests", "fixtures", "follow", "routes.json"), "utf8")).routes;

export const lineOf = (name: keyof typeof ROUTES): Line => createLine(ROUTES[name].points, ROUTES[name].along_m);

/** A route from legs of [east, north] metres off one corner near Kozhikode, its metres as the API would give them. */
export function made(...legs: XY[]): Line {
  const start: LonLat = [75.84, 11.15];
  const unit = createLine([start, [start[0] + 0.01, start[1] + 0.01]], [0, 1]).flat[1]!;
  const points: LonLat[] = [start];
  const along = [0];
  let x = 0;
  let y = 0;
  for (const [dx, dy] of legs) {
    x += dx;
    y += dy;
    points.push([start[0] + (0.01 * x) / unit[0], start[1] + (0.01 * y) / unit[1]]);
    along.push(along[along.length - 1]! + Math.hypot(dx, dy));
  }
  return createLine(points, along);
}

export function seeded(seed: number) {
  let a = seed;
  const next = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  return () => Math.sqrt(-2 * Math.log(next())) * Math.cos(2 * Math.PI * next());
}

export class Phone {
  run: Run;
  private gauss: () => number;
  private metre: XY;

  constructor(readonly line: Line, doneM = 0, seed = 12345) {
    const run = startRun(0);
    this.run = { ...run, track: { ...run.track, doneM } };
    this.gauss = seeded(seed);
    const [lon, lat] = line.points[0]!;
    this.metre = [line.toXY([lon + 1, lat])[0], line.toXY([lon, lat + 1])[1]];
  }

  send(event: RunEvent): Run {
    this.run = reduceRun(this.line, this.run, event);
    return this.run;
  }

  /** A fix at a place on the plane, `seconds` into the run. */
  at(seconds: number, xy: XY, o: { sigma?: number; accuracy?: number; now?: number } = {}): Run {
    const sigma = o.sigma ?? 0;
    const [lon, lat] = this.line.points[0]!;
    const point: LonLat = [lon + (xy[0] + sigma * this.gauss()) / this.metre[0], lat + (xy[1] + sigma * this.gauss()) / this.metre[1]];
    const at = seconds * 1000;
    return this.send({ type: "fix", point, accuracy: o.accuracy ?? Math.max(5, 1.5 * sigma), at, now: o.now ?? at });
  }

  /** A fix at `m` along the route, `side` metres to its east. */
  on(seconds: number, m: number, o: { sigma?: number; accuracy?: number; now?: number; side?: number } = {}): Run {
    const [x, y] = this.line.toXY(pointAt(this.line, m));
    return this.at(seconds, [x + (o.side ?? 0), y], o);
  }

  hide(seconds: number) {
    return this.send({ type: "hidden", at: seconds * 1000 });
  }

  show(seconds: number) {
    return this.send({ type: "visible", at: seconds * 1000 });
  }
}
