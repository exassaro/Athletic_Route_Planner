/**
 * The next cue (blueprint Phase 5d amendment 6): "In 300 m: turn left onto <road>". The turns and their names are
 * the API's (A15); here they are only counted down against progress. Merged cues say their next two turns, so a
 * long chain is told as it is run.
 */
import type { Schemas } from "@/api/client";

export const PASSED_M = 10;     // a turn this far behind is done
export const NOW_M = 15;        // this close, it is "Now"

type Step = Schemas["FollowStep"];
export type Turn = Pick<Step, "at_m" | "turn" | "road"> & { group: number };
export type NextCue = { distanceM: number; turns: Turn[] };

export function turnsOf(cues: readonly Schemas["FollowCue"][]): Turn[] {
  return cues.flatMap((cue, group) => [cue, ...cue.then].map(({ at_m, turn, road }) => ({ at_m, turn, road, group })));
}

export function nextCue(turns: readonly Turn[], doneM: number): NextCue | null {
  const i = turns.findIndex((t) => t.at_m >= doneM - PASSED_M);
  if (i < 0) return null;
  const first = turns[i]!;
  const second = turns[i + 1];
  return {
    distanceM: Math.max(0, first.at_m - doneM),
    turns: second && second.group === first.group ? [first, second] : [first],
  };
}

/** To the nearest 10 m; from 1 km, to the nearest 0.1 km. */
export function cueDistance(m: number): string {
  const tens = Math.round(m / 10) * 10;
  return tens < 1000 ? `${tens} m` : `${(tens / 1000).toFixed(1)} km`;
}

function words({ turn, road }: Pick<Turn, "turn" | "road">): string {
  return road ? `${turn} onto ${road}` : turn;
}

/** "turn left onto Beach Road", "turn right, then left". */
export function cueAction(turns: readonly Turn[]): string {
  return `turn ${turns.map(words).join(", then ")}`;
}

export function cueText({ distanceM, turns }: NextCue): string {
  const when = distanceM < NOW_M ? "Now" : `In ${cueDistance(distanceM)}`;
  return `${when}: ${cueAction(turns)}`;
}
