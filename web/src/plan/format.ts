/**
 * Formatting of numbers the API returned. Nothing here measures: a distance shown is the API's metres divided
 * by 1000 and rounded; a time is the API's foot length times the runner's own pace (Phase 5 amendment 5).
 * Every number on screen goes through these, and the element carries the raw API value in data-value so the
 * end-to-end test can check it against the response.
 */

export function km(meters: number, digits = 1): string {
  const text = (meters / 1000).toFixed(digits);
  return `${Number(text) === 0 ? (0).toFixed(digits) : text} km`;   // never "-0.0 km"
}

/** Signed deviation from the target: "+0.1 km", "−0.9 km", "±0.0 km". */
export function signedKm(meters: number, digits = 1): string {
  const v = Number((meters / 1000).toFixed(digits));
  if (v === 0) return `±${(0).toFixed(digits)} km`;
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)} km`;
}

export function metres(meters: number): string {
  return `${Math.round(meters)} m`;
}

/** Pace in seconds per km -> "6:00 /km". */
export function pace(secondsPerKm: number): string {
  const s = Math.round(secondsPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} /km`;
}

/** "5:45" or "345" or "5.45" -> seconds per km, or null. */
export function parsePace(text: string): number | null {
  const t = text.trim();
  const m = /^(\d{1,2})[:.](\d{1,2})$/.exec(t);
  if (m) {
    const [min, sec] = [Number(m[1]), Number(m[2])];
    if (sec < 60 && min * 60 + sec >= 120 && min * 60 + sec <= 1200) return min * 60 + sec;
    return null;
  }
  return null;
}

/** Running time at the runner's pace: the API's foot length (m) times seconds per km. "2 h 30 min", "48 min". */
export function runningTime(footMeters: number, secondsPerKm: number): string {
  const totalMin = Math.round((footMeters / 1000) * secondsPerKm / 60);
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return h > 0 ? `${h} h ${String(min).padStart(2, "0")} min` : `${min} min`;
}
