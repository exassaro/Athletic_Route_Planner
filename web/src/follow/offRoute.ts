/**
 * The off-route banner's timing (blueprint Phase 5d amendment 9): more than 40 m from the line for 10 s AND two
 * consecutive fresh fixes with accuracy under 30 m. With worse accuracy nothing is guessed.
 */
import { GOOD_ACCURACY_M, ON_LINE_M } from "./tracker";

export const OFF_FOR_MS = 10_000;
export const OFF_FIXES = 2;

export type OffRoute = {
  /** When the first good fix off the line came; null while on it. */
  since: number | null;
  inARow: number;
  shown: boolean;
};

export const ON_ROUTE: OffRoute = { since: null, inARow: 0, shown: false };

/** `offM`: straight line to the nearest place on the whole route, so another pass of it is never "off". */
export function offRoute(s: OffRoute, fix: { at: number; accuracy: number; offM: number }): OffRoute {
  if (fix.accuracy >= GOOD_ACCURACY_M) return { ...s, inARow: 0 };     // neither on nor off
  if (fix.offM <= ON_LINE_M) return ON_ROUTE;
  const since = s.since ?? fix.at;
  const inARow = s.inARow + 1;
  return { since, inARow, shown: s.shown || (inARow >= OFF_FIXES && fix.at - since >= OFF_FOR_MS) };
}
