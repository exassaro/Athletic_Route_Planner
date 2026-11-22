const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago", then "on 12 Nov 2026". */
export function relativeDate(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  const age = now - then;
  if (age < MINUTE) return "just now";
  if (age < HOUR) return ago(Math.floor(age / MINUTE), "minute");
  if (age < DAY) return ago(Math.floor(age / HOUR), "hour");
  if (age < 2 * DAY) return "yesterday";
  if (age < 7 * DAY) return ago(Math.floor(age / DAY), "day");
  return `on ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(then)}`;
}
