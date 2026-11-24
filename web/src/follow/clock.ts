/** The run's clock (blueprint Phase 5d amendment 10): from timestamps, never from a timer. */

export type Clock = {
  startedAt: number;
  pausedAt: number | null;
  pausedMs: number;
  endedAt: number | null;
};

export const PACE_FROM_M = 100;     // no pace before this much is done

export function startClock(at: number): Clock {
  return { startedAt: at, pausedAt: null, pausedMs: 0, endedAt: null };
}

export function pauseClock(c: Clock, at: number): Clock {
  return c.pausedAt !== null || c.endedAt !== null ? c : { ...c, pausedAt: at };
}

export function resumeClock(c: Clock, at: number): Clock {
  if (c.pausedAt === null || c.endedAt !== null) return c;
  return { ...c, pausedAt: null, pausedMs: c.pausedMs + Math.max(0, at - c.pausedAt) };
}

export function stopClock(c: Clock, at: number): Clock {
  // stopped while paused: the run ended when it was paused
  return c.endedAt !== null ? c : { ...c, endedAt: c.pausedAt ?? at };
}

/** Time since the start without the pauses. A lock is not a pause: its time counts. */
export function elapsedMs(c: Clock, now: number): number {
  return Math.max(0, (c.endedAt ?? c.pausedAt ?? now) - c.startedAt - c.pausedMs);
}

/** Seconds per km over the progress made; null until there is enough of it. */
export function paceSPerKm(elapsed: number, doneM: number): number | null {
  return doneM < PACE_FROM_M ? null : elapsed / doneM;       // ms per m is s per km
}

/** "5:07", "1:02:03". */
export function elapsedText(ms: number): string {
  const s = Math.floor(ms / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const min = Math.floor(s / 60) % 60;
  return h ? `${h}:${two(min)}:${two(s % 60)}` : `${min}:${two(s % 60)}`;
}

/** "45 s", "2 min 10 s", "1 h 2 min". */
export function gapText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
  const min = Math.round(s / 60);
  return min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`;
}
