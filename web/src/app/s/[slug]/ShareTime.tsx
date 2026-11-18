"use client";
import { StatNumber } from "@/components/StatNumber";
import { usePace } from "@/plan/pace";

/** The shared route's foot length at the viewer's own pace (their browser's setting, default 6:00 /km). */
export function ShareTime({ footM }: { footM: number }) {
  const [pace] = usePace();
  return <StatNumber kind="time" value={footM} field="foot_m" pace={pace} />;
}
