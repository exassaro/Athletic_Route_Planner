"use client";
import { runningTime } from "@/plan/format";
import { usePace } from "@/plan/pace";

/** The shared route's foot length at the viewer's own pace (their browser's setting, default 6:00 /km). */
export function ShareTime({ footM }: { footM: number }) {
  const [pace] = usePace();
  return <span data-value={footM} data-field="foot_m" data-pace={pace}>{runningTime(footM, pace)}</span>;
}
