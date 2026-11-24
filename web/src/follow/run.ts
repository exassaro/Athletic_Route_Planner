/**
 * One run in Follow mode (blueprint Phase 5d amendments 8 to 10): every event gives a new state, held in memory
 * (what a tab keeps of it: kept.ts). The screen sends what the browser says (a fix, hidden, visible) and what the runner taps (pause, resume,
 * stop), and draws the state. Nothing here reads the time, stores, logs or sends.
 */
import { pauseClock, resumeClock, startClock, stopClock, type Clock } from "./clock";
import { bearingXY, nearestOnRoute, type Line, type LonLat } from "./line";
import { offRoute, ON_ROUTE, type OffRoute } from "./offRoute";
import { GAP_SPEED_MPS, GOOD_ACCURACY_M, NEAR_S, ON_LINE_M, startTrack, track, WINDOW_M, type Track } from "./tracker";

export const FRESH_MS = 10_000;     // an older fix is discarded
export const GAP_NOTICE_MS = 30_000;

export type Phase = "running" | "paused" | "stopped";

export type RunEvent =
  /** `at`: the fix's own timestamp. `now`: when the browser delivered it. */
  | { type: "fix"; point: LonLat; accuracy: number; at: number; now: number }
  | { type: "hidden"; at: number }
  | { type: "visible"; at: number }
  | { type: "pause"; at: number }
  | { type: "resume"; at: number }
  | { type: "dismissGap" }
  /** `finished`: yes to "Did you finish the route?". */
  | { type: "stop"; at: number; finished?: boolean };

export type Run = {
  phase: Phase;
  clock: Clock;
  track: Track;
  off: OffRoute;
  /** Since when the screen has been hidden, and the progress then. */
  hidden: { at: number; doneM: number } | null;
  /** The gaps over 30 s, for the summary. */
  gaps: { at: number; ms: number }[];
  /** "You were away for ..." */
  away: number | null;
  /** "Finding you...": no fresh fix since the start, a wake or a resume. */
  finding: boolean;
  lastFixAt: number;
  here: { point: LonLat; accuracy: number } | null;
  /** The way back to the line: straight-line metres and a bearing. Never sent, stored or logged. */
  back: { offM: number; bearing: number | null } | null;
  /** Carried on from what the tab kept: the gaps and skipped parts from before are not known. */
  resumed: boolean;
};

export function startRun(at: number): Run {
  return { phase: "running", clock: startClock(at), track: startTrack(at), off: ON_ROUTE, hidden: null, gaps: [],
    away: null, finding: true, lastFixAt: -Infinity, here: null, back: null, resumed: false };
}

export function reduceRun(line: Line, s: Run, e: RunEvent): Run {
  if (s.phase === "stopped") return s;
  switch (e.type) {
    case "fix": {
      if (s.hidden) return s;
      if (e.now - e.at > FRESH_MS || e.at <= s.lastFixAt) return s;
      const here = { point: e.point, accuracy: e.accuracy };
      if (s.phase === "paused") return { ...s, here, lastFixAt: e.at };
      const xy = line.toXY(e.point);
      const nearest = nearestOnRoute(line, xy);
      return {
        ...s,
        here,
        lastFixAt: e.at,
        finding: false,
        track: track(line, s.track, { xy, at: e.at, accuracy: e.accuracy }),
        off: offRoute(s.off, { at: e.at, accuracy: e.accuracy, offM: nearest.offM }),
        back: { offM: nearest.offM, bearing: bearingXY(xy, nearest.xy) },
      };
    }
    case "hidden":
      return s.hidden ? s : { ...s, hidden: { at: e.at, doneM: s.track.doneM }, off: ON_ROUTE, away: null };
    case "visible": {
      if (!s.hidden) return s;
      if (s.phase === "paused") return { ...s, hidden: null };
      const ms = e.at - s.hidden.at;
      const long = ms > GAP_NOTICE_MS;
      return { ...s, hidden: null, finding: true, track: { ...s.track, held: null },
        gaps: long ? [...s.gaps, { at: s.hidden.at, ms }] : s.gaps, away: long ? ms : null };
    }
    case "pause":
      return s.phase === "paused" ? s
        : { ...s, phase: "paused", clock: pauseClock(s.clock, e.at), off: ON_ROUTE, finding: false, away: null };
    case "resume":
      return s.phase !== "paused" ? s
        : { ...s, phase: "running", clock: resumeClock(s.clock, e.at), finding: true, track: { ...s.track, held: null } };
    case "dismissGap":
      return { ...s, away: null };
    case "stop":
      return { ...s, phase: "stopped", clock: stopClock(s.clock, e.at), finding: false, hidden: null, off: ON_ROUTE,
        track: e.finished ? { ...s.track, doneM: line.totalM, arrived: true, status: "route", held: null } : s.track };
  }
}

/** What the HUD says in place of a cue, or null when the cue shows. */
export function signal(s: Run): "finding" | "weak" | "off" | "waiting" | null {
  if (s.phase !== "running") return null;
  if (s.finding) return "finding";
  if (s.off.shown) return "off";
  if (s.here && s.here.accuracy >= GOOD_ACCURACY_M) return "weak";
  if (s.track.status === "held") return "finding";
  // on the line elsewhere, or off it and not yet for long enough: no cue, no alarm
  return s.track.status === "route" ? null : "waiting";
}

/**
 * Whether Stop asks "Did you finish the route?": not matched for a gap whose window reaches the end, and at the
 * end or not found yet. A loop's finish cannot be told from standing at its start.
 */
export function mayHaveFinished(line: Line, s: Run, now: number): boolean {
  if (s.phase === "stopped" || s.track.arrived) return false;
  const seconds = (now - s.track.matchedAt) / 1000;
  if (seconds <= NEAR_S) return false;
  if (s.track.doneM + GAP_SPEED_MPS * seconds + WINDOW_M < line.totalM - ON_LINE_M) return false;
  if (s.finding || !s.here) return true;
  const [x, y] = line.toXY(s.here.point);
  const [endX, endY] = line.flat[line.flat.length - 1]!;
  return Math.hypot(x - endX, y - endY) <= ON_LINE_M + s.here.accuracy;
}

/** A cue is shown and spoken only while progress follows the route. */
export function cuesOn(s: Run): boolean {
  if (s.phase !== "running" || s.hidden || s.finding || s.off.shown || s.track.arrived) return false;
  return s.track.status === "route";
}

/** The banner has just appeared: the moment to vibrate. */
export function justLeft(before: Run, after: Run): boolean {
  return !before.off.shown && after.off.shown;
}
