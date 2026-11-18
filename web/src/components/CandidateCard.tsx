"use client";
/**
 * One candidate route (section 13 route comparison card). Every number is the API's, formatted: foot distance,
 * deviation from the target, climb; the time is that foot distance at the runner's own pace.
 */
import type { Schemas } from "@/api/client";
import { flagText } from "@/plan/flags";
import { km, metres, runningTime, signedKm } from "@/plan/format";
import { lineStyle, svgDash } from "@/plan/routeStyle";
import { Num } from "./Num";

type Candidate = Schemas["CandidateOut"];

const ROAD_CLASS: Record<string, { name: string; color: string }> = {
  motorway: { name: "Motorway", color: "#8b1a1a" },
  trunk: { name: "Trunk (national highway)", color: "#c0392b" },
  primary: { name: "Primary", color: "#e67e22" },
  secondary: { name: "Secondary", color: "#f1c40f" },
  tertiary: { name: "Tertiary", color: "#9bc53d" },
  unclassified: { name: "Minor road", color: "#5dade2" },
  residential: { name: "Residential", color: "#48a37a" },
  service_other: { name: "Service road", color: "#95a5a6" },
  service: { name: "Service road", color: "#95a5a6" },
};

export function Swatch({ label, option, index }: { label: string; option: string; index: number }) {
  const s = lineStyle(label, option, index);
  return (
    <svg width="36" height="10" aria-hidden="true" className="swatch">
      <line x1="2" y1="5" x2="34" y2="5" stroke={s.color} strokeWidth="4" strokeLinecap="butt"
        strokeDasharray={svgDash(s.dash, 4)} />
    </svg>
  );
}

export function RoadClassBar({ classes }: { classes: Record<string, number> }) {
  const entries = Object.entries(classes).filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((t, [, m]) => t + m, 0) || 1;
  return (
    <div className="roadbar-wrap">
      <div className="roadbar" role="img"
        aria-label={`Road mix: ${entries.map(([c, m]) => `${ROAD_CLASS[c]?.name ?? c} ${km(m)}`).join(", ")}`}>
        {entries.map(([c, m]) => (
          <span key={c} style={{ width: `${(m / total) * 100}%`, background: ROAD_CLASS[c]?.color ?? "#bbb" }} />
        ))}
      </div>
      <ul className="roadbar-legend">
        {entries.map(([c, m]) => (
          <li key={c}>
            <i style={{ background: ROAD_CLASS[c]?.color ?? "#bbb" }} />
            {ROAD_CLASS[c]?.name ?? c} <Num value={m} format={(v) => km(v)} field={`road_class_m.${c}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}

type Props = {
  cand: Candidate;
  index: number;
  selected: boolean;
  pace: number;
  onSelect: () => void;
  detailed?: boolean;
};

export function CandidateCard({ cand, index, selected, pace, onSelect, detailed }: Props) {
  const s = lineStyle(cand.label, cand.option, index);
  const flags = (cand.flags ?? []).map(flagText);
  const endAuto = cand.end.kind !== "fixed" && cand.end.kind !== "start";
  return (
    <article className={`card${selected ? " selected" : ""}`} data-testid={`card-${cand.label}-${cand.option}`}
      data-route-id={cand.route_id}>
      <button type="button" className="card-head" onClick={onSelect} aria-pressed={selected}>
        <Swatch label={cand.label} option={cand.option} index={index} />
        <span className="card-title">{s.name}{s.optionName && <span className="muted"> · {s.optionName}</span>}</span>
      </button>
      <dl className="stats">
        <div>
          <dt>Distance</dt>
          <dd>
            <Num value={cand.foot_m} format={(v) => km(v)} field="foot_m" className="big" />{" "}
            <span className="muted">(<Num value={cand.deviation_m} format={(v) => signedKm(v)} field="deviation_m" />)</span>
          </dd>
        </div>
        <div>
          <dt>Time at your pace</dt>
          <dd><span data-value={cand.foot_m} data-field="foot_m" data-pace={pace}>{runningTime(cand.foot_m, pace)}</span></dd>
        </div>
        <div>
          <dt>Climb</dt>
          <dd>
            {cand.gain_m == null ? "not known" : (
              <>
                +<Num value={cand.gain_m} format={metres} field="gain_m" /> / −
                <Num value={cand.loss_m ?? 0} format={metres} field="loss_m" />
                {cand.climb_approximate && <abbr className="approx" title="From a satellite surface model that includes trees and buildings; on flat coastal ground much of this may not be real climbing.">approx.</abbr>}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>End</dt>
          <dd data-field="end.label">{cand.end.label ?? "Unnamed road"}{endAuto && <span className="muted"> (auto)</span>}</dd>
        </div>
      </dl>
      {cand.climb_approximate && detailed && (
        <p className="note">Climb is approximate: the elevation data is a satellite surface model that includes trees and
          buildings, so on flat coastal ground much of it may not be real climbing.</p>
      )}
      <RoadClassBar classes={cand.road_class_m ?? {}} />
      {flags.length > 0 && (
        <ul className="flags">
          {flags.map((f, i) => (
            <li key={i} className={f.tone}>
              <strong>{f.title}</strong>{f.detail && <span className="muted"> {f.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
