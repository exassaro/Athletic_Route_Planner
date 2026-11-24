/**
 * What a tab keeps of a run, so that a refresh does not lose it (blueprint Phase 5e amendment 6): the metres done,
 * the start time and the pauses. No coordinates, no time of the last fix, no gaps. Pure: text in, text out.
 */
import { stopClock, type Clock } from "./clock";
import type { Line } from "./line";
import { startRun, type Run } from "./run";
import { GAP_SPEED_MPS, WINDOW_M } from "./tracker";

const SCHEMA = 1;
export const RUN_MAX_AGE_MS = 12 * 3600_000;

type Kept = {
  schema: number;
  /** Only so the metres are never applied to another route. */
  route: string;
  doneM: number;
  startedAt: number;
  pausedMs: number;
  /** The open pause. A stopped run's last pause begins at the stop. */
  pausedAt: number | null;
  stopped: boolean;
};

export function keepRun(route: string, { track, clock, phase }: Pick<Run, "track" | "clock" | "phase">): string {
  const kept: Kept = { schema: SCHEMA, route, doneM: track.doneM, startedAt: clock.startedAt, pausedMs: clock.pausedMs,
    pausedAt: clock.endedAt ?? clock.pausedAt, stopped: phase === "stopped" };
  return JSON.stringify(kept);
}

/** The run as kept, or null for none, another route's, too old or unreadable. Never throws. */
export function resumeRun(line: Line, route: string, text: string | null, now: number): Run | null {
  if (!text) return null;
  try {
    const k = JSON.parse(text) as Kept;
    if (k.schema !== SCHEMA || k.route !== route || typeof k.stopped !== "boolean") return null;
    if (!(k.startedAt <= now && now - k.startedAt < RUN_MAX_AGE_MS)) return null;
    if (typeof k.doneM !== "number" || !(k.doneM >= 0 && k.doneM <= line.totalM)) return null;
    if (typeof k.pausedMs !== "number" || !(k.pausedMs >= 0)) return null;
    if (k.pausedAt !== null && !(k.pausedAt >= k.startedAt && k.pausedAt <= now)) return null;
    if (k.stopped && k.pausedAt === null) return null;

    const fresh = startRun(k.startedAt);
    const clock: Clock = { ...fresh.clock, pausedMs: k.pausedMs, pausedAt: k.pausedAt };
    // the earliest those metres can have been reached, so the window is not too small (simulated, follow.md)
    const matchedAt = Math.min(now, k.startedAt + (Math.max(0, k.doneM - WINDOW_M) / GAP_SPEED_MPS) * 1000);
    return {
      ...fresh,
      phase: k.stopped ? "stopped" : k.pausedAt !== null ? "paused" : "running",
      clock: k.stopped ? stopClock(clock, now) : clock,
      track: { ...fresh.track, doneM: k.doneM, matchedAt, arrived: k.doneM === line.totalM },
      finding: !k.stopped && k.pausedAt === null,
      resumed: true,
    };
  } catch {
    return null;
  }
}
