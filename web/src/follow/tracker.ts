/**
 * Progress along the route from position fixes (blueprint Phase 5d amendment 8): the snapped distance, never a sum
 * of GPS steps, and never backwards.
 *
 * - Tracking: the window ahead. Passes that tie go to the one nearest the expected progress.
 * - After a gap (no match for over NEAR_S: a lock, a pause, no signal) the window is 5 m/s x T + 100 m. One pass
 *   that fits is taken at once. Several are held until the direction of the next fixes decides; expected pace
 *   never decides. A pass the runner could have walked back to counts as one of them, but never lowers progress.
 * - Off the route the window grows by the same formula. A rejoin beyond the normal window needs REJOIN_ADVANCE_M
 *   along the route, so merely crossing a later part of it moves nothing.
 *
 * Pure: a state and a fix give a new state.
 */
import { closest, hitsBetween, nearestOnRoute, type Hit, type Line, type XY } from "./line";

export const WINDOW_M = 100;          // the window ahead
export const GAP_SPEED_MPS = 5;       // it grows this fast while nothing matches
export const NEAR_S = 10;             // without a match for longer, it is a gap
export const ON_LINE_M = 40;          // within this of the line is on it (amendment 9's threshold)
export const GOOD_ACCURACY_M = 30;
export const USABLE_ACCURACY_M = 50;  // worse fixes only move the dot
export const TIE_M = 15;
export const SAME_PASS_M = 50;        // positions closer along the route than this are one pass
export const CATCH_UP_FIXES = 3;      // good fixes before the window is back to normal
export const DECIDE_MOVE_M = 20;      // moved this far before direction decides between passes...
export const DECIDE_ACCURACY = 2.5;   // ...or this many times the fix's accuracy, when that is more
export const ASTRAY_FIXES = 3;        // good fixes unmatched before a rejoin has to be confirmed
export const JUMP_M = 30;             // past the expected progress: a jump to another pass
export const SAME_POSITION_M = 5;     // two followed passes this close are one
export const REJOIN_ADVANCE_M = 40;   // along the route, before a rejoin further ahead counts
export const ARRIVE_M = 15;           // this close to the end is the end
const EXPECTED_MPS = 2.8;             // until the runner's own speed is known

export type Fix = { xy: XY; at: number; accuracy: number };

/**
 * route: progress follows. held: waiting for direction. elsewhere: on the line, but not where progress can move to.
 * off: not on the line. weak: too inaccurate to use.
 */
export type Status = "route" | "held" | "elsewhere" | "off" | "weak";

type Pass = { fromM: number; m: number; offs: number[] };
export type Held = { passes: Pass[]; seen: XY[]; at: number };

export type Track = {
  doneM: number;
  matchedAt: number;
  speed: number;
  status: Status;
  arrived: boolean;
  /** Good fixes unmatched since the last match. From ASTRAY_FIXES it left the route (as against not being seen). */
  astray: number;
  /** Progress once jumped over a part after leaving the route: the summary says so. */
  skipped: boolean;
  catchUp: { untilM: number; good: number } | null;
  held: Held | null;
};

export function startTrack(at: number): Track {
  return { doneM: 0, matchedAt: at, speed: EXPECTED_MPS, status: "route", arrived: false, astray: 0, skipped: false,
    catchUp: null, held: null };
}

const mean = (xs: readonly number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const middle = (xs: readonly XY[]): XY => [mean(xs.map((p) => p[0])), mean(xs.map((p) => p[1]))];
const reach = (seconds: number) => GAP_SPEED_MPS * seconds + WINDOW_M;

/**
 * The passes among some hits: the closest, then each next closest that is not along the same stretch. Chaining
 * neighbours instead would make one pass of the two sides of a turnaround.
 */
function passesOf(hits: readonly Hit[]): Hit[] {
  const out: Hit[] = [];
  for (const hit of [...hits].sort((a, b) => a.offM - b.offM)) {
    if (out.every((kept) => Math.abs(kept.m - hit.m) > SAME_PASS_M)) out.push(hit);
  }
  return out;
}

function unmatched(line: Line, s: Track, fix: Fix, left = false): Track {
  const status: Status = nearestOnRoute(line, fix.xy).offM <= ON_LINE_M ? "elsewhere" : "off";
  const astray = left ? ASTRAY_FIXES : s.astray + (fix.accuracy < GOOD_ACCURACY_M ? 1 : 0);
  return { ...s, held: null, astray, status };
}

function matched(line: Line, s: Track, fix: Fix, m: number): Track {
  const seconds = (fix.at - s.matchedAt) / 1000;
  const arrived = s.arrived || line.totalM - m <= ARRIVE_M;
  const doneM = arrived ? line.totalM : Math.max(s.doneM, m);
  let { speed, catchUp } = s;
  if (seconds > NEAR_S) {
    catchUp = { untilM: s.doneM + reach(seconds), good: 0 };
  } else if (seconds > 0) {
    const now = Math.min((doneM - s.doneM) / seconds, GAP_SPEED_MPS);
    speed += 0.2 * (now - speed);
  }
  if (catchUp && fix.accuracy < GOOD_ACCURACY_M) {
    const good = catchUp.good + 1;
    catchUp = good >= CATCH_UP_FIXES ? null : { ...catchUp, good };
  }
  // after a lock the runner covered the ground; after leaving the route, they skipped it
  const skipped = s.skipped || (s.astray >= ASTRAY_FIXES && m - s.doneM > WINDOW_M);
  return { doneM, matchedAt: fix.at, speed, status: "route", arrived, astray: 0, skipped, catchUp, held: null };
}

function decide(line: Line, s: Track, held: Held, fix: Fix): Track {
  const seconds = Math.max(0, (fix.at - held.at) / 1000);
  const followed = held.passes.map((pass): Pass => {
    // forward only, with a little slack for noise
    const hit = closest(hitsBetween(line, fix.xy, pass.m - TIE_M / 2, pass.m + GAP_SPEED_MPS * seconds + ON_LINE_M));
    return hit
      ? { ...pass, m: Math.max(pass.m, hit.m), offs: [...pass.offs, hit.offM].slice(-3) }
      : { ...pass, offs: [...pass.offs, Infinity].slice(-3) };
  });
  // two that run into each other were one pass all along: left apart, they would tie for ever
  const passes: Pass[] = [];
  for (const pass of [...followed].sort((a, b) => b.fromM - a.fromM)) {
    if (passes.every((kept) => Math.abs(kept.m - pass.m) >= SAME_POSITION_M)) passes.push(pass);
  }
  const seen = [...held.seen, fix.xy];
  // the first three and the last three are all that is needed
  const kept = seen.length > 6 ? [...seen.slice(0, 3), ...seen.slice(-3)] : seen;
  const waiting: Track = { ...s, status: "held", held: { passes, seen: kept, at: fix.at } };

  const ranked = passes.map((pass) => ({ pass, off: mean(pass.offs) })).sort((a, b) => a.off - b.off);
  const { pass: best, off } = ranked[0]!;
  if (off > ON_LINE_M) return unmatched(line, s, fix);
  if (seen.length < 3) return waiting;
  const margin = Math.max(TIE_M, fix.accuracy);

  const behind = best.m < s.doneM - ON_LINE_M;
  if (passes.length === 1) {
    if (behind) return unmatched(line, s, fix, true);
    if (off > margin) return unmatched(line, s, fix, true);        // a crossing: moving away from it again
    return best.m - best.fromM >= REJOIN_ADVANCE_M ? matched(line, s, fix, best.m) : waiting;
  }
  if (ranked[1]!.off - off < margin) return waiting;
  const move = Math.max(DECIDE_MOVE_M, DECIDE_ACCURACY * fix.accuracy);
  if (best.m - best.fromM < move) return waiting;
  const [from, to] = [middle(kept.slice(0, 3)), middle(kept.slice(-3))];
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) < move) return waiting;      // standing: noise is not direction
  return behind ? unmatched(line, s, fix, true) : matched(line, s, fix, best.m);
}

export function track(line: Line, s: Track, fix: Fix): Track {
  if (s.arrived) return { ...s, status: nearestOnRoute(line, fix.xy).offM <= ON_LINE_M ? "route" : "off" };
  if (fix.accuracy > USABLE_ACCURACY_M) return { ...s, status: "weak" };
  // a second gap while held starts again from the last match
  if (s.held && (fix.at - s.held.at) / 1000 <= NEAR_S) return decide(line, s, s.held, fix);

  const seconds = Math.max(0, (fix.at - s.matchedAt) / 1000);
  const good = fix.accuracy < GOOD_ACCURACY_M;
  const nearTo = s.doneM + reach(Math.min(seconds, NEAR_S));

  if (seconds <= NEAR_S) {
    let hits = hitsBetween(line, fix.xy, s.doneM, nearTo).filter((h) => h.offM <= ON_LINE_M);
    if (!hits.length && s.catchUp) {
      hits = hitsBetween(line, fix.xy, s.doneM, s.catchUp.untilM).filter((h) => h.offM <= ON_LINE_M);
      if (passesOf(hits).length > 1) hits = [];       // the widened window never guesses between passes
    }
    const best = closest(hits);
    if (!best) return unmatched(line, s, fix);
    const expected = s.doneM + s.speed * seconds;
    let chosen = best;
    for (const hit of hits) {
      if (hit.offM <= best.offM + TIE_M && Math.abs(hit.m - expected) < Math.abs(chosen.m - expected)) chosen = hit;
    }
    if (chosen.m > expected + JUMP_M) {
      // standing, or a step back, just before a turnaround: the pass it is on explains it, so nothing jumps
      const here = closest(hitsBetween(line, fix.xy, s.doneM - ON_LINE_M, s.doneM));
      if (here && here.offM <= best.offM + TIE_M && here.offM <= ON_LINE_M) return matched(line, s, fix, s.doneM);
    }
    return matched(line, s, fix, chosen.m);
  }

  // a gap, or off the route for a while: the window has grown, and as far back as could have been walked
  const span = reach(seconds);
  const fitting = passesOf(hitsBetween(line, fix.xy, s.doneM - span, s.doneM + span)
    .filter((h) => h.offM <= ON_LINE_M + fix.accuracy));
  const best = closest(fitting);
  if (!best || best.offM > ON_LINE_M) return unmatched(line, { ...s, held: null }, fix);
  // a rival pass counts as far as both positions' noise reaches: at a loop's start the finish must not win alone
  const band = best.offM + Math.max(TIE_M, 2 * fix.accuracy);
  const passes = fitting.filter((h) => h.offM <= band)
    .map((h): Pass => {
      const from = h.m < s.doneM - ON_LINE_M ? h.m : Math.max(h.m, s.doneM);
      return { fromM: from, m: from, offs: [h.offM] };
    });
  const ahead = passes.filter((p) => p.m >= s.doneM);
  if (!ahead.length) return unmatched(line, { ...s, held: null }, fix);

  if (passes.length === 1) {
    const only = ahead[0]!;
    if (only.m <= nearTo) return matched(line, { ...s, held: null }, fix, only.m);
    if (!good) return { ...s, held: null, status: "weak" };          // a jump needs a good fix
    if (s.astray < ASTRAY_FIXES) return matched(line, { ...s, held: null }, fix, only.m);
  } else if (!good) {
    return { ...s, held: null, status: "weak" };
  }
  return { ...s, status: "held", held: { passes, seen: [fix.xy], at: fix.at } };
}
