/**
 * The peek bar (blueprint Phase 5b amendment 8): what a peeked sheet shows of the selected route. Distance, time at
 * the runner's pace and climb, each the API's number (time = the API's foot length times the pace).
 */
import type { Schemas } from "@/api/client";
import { pace as formatPace } from "@/plan/format";
import { StatNumber } from "./StatNumber";

export function PeekBar({ cand, pace }: { cand: Schemas["CandidateOut"]; pace: number }) {
  return (
    <div className="peek-bar" data-testid="summary" role="group" aria-label="Selected route">
      <div className="peek-stat">
        <StatNumber kind="km" value={cand.foot_m} field="foot_m" size="xl" />
        <span className="t-meta muted">distance</span>
      </div>
      <div className="peek-stat">
        <StatNumber kind="time" value={cand.foot_m} field="foot_m" pace={pace} size="xl" />
        <span className="t-meta muted">at {formatPace(pace)}</span>
      </div>
      <div className="peek-stat">
        {cand.gain_m == null ? <span className="t-body-s">not known</span> : (
          <span className="climb"><span className="t-stat-xl" aria-hidden="true">+</span><span className="sr-only">plus </span>
            <StatNumber kind="m" value={cand.gain_m} field="gain_m" size="xl" /></span>
        )}
        <span className="t-meta muted">climb{cand.climb_approximate ? ", approx." : ""}</span>
      </div>
    </div>
  );
}
