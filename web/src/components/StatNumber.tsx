/**
 * A big stat number (blueprint Phase 5b amendment 3): the API's value formatted exactly as elsewhere (format.ts),
 * with the digits in the pixel font and the units in the sans. The text content stays the formatted string
 * ("25.0 km", "2 h 30 min", "107 m") and the element carries data-value, so the end-to-end number check reads it
 * like any other number on screen.
 */
import { km, metres, runningTime } from "@/plan/format";

type Props = {
  value: number;
  field: string;
  kind: "km" | "time" | "m";
  pace?: number;
  size?: "xl" | "l" | "m";
};

export function formatStat(kind: Props["kind"], value: number, pace = 360): string {
  if (kind === "km") return km(value);
  if (kind === "m") return metres(value);
  return runningTime(value, pace);
}

export function StatNumber({ value, field, kind, pace, size = "l" }: Props) {
  const text = formatStat(kind, value, pace);
  const parts = text.split(/([\d.]+)/).filter((p) => p !== "");
  return (
    <span className="stat-number" data-value={value} data-field={field} data-pace={kind === "time" ? pace : undefined}>
      {parts.map((p, i) => (/^[\d.]+$/.test(p)
        ? <span key={i} className={`t-stat-${size}`}>{p}</span>
        : <span key={i} className="t-unit">{p}</span>))}
    </span>
  );
}
