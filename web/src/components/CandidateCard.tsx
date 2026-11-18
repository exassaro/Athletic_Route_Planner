"use client";
/**
 * One candidate route (blueprint Phase 5b amendment 8): the big numbers (distance, time at your pace, climb) in
 * the pixel font, the deviation from the target, the end, the road mix as a bar with words, and the flags as short
 * badges whose tap shows the API's own detail. Every number is the API's, formatted; the selected card has the hard
 * shadow. The template explanation sits behind "Why this route?" (RouteCards).
 */
import { useState } from "react";
import type { Schemas } from "@/api/client";
import { flagText } from "@/plan/flags";
import { km, signedKm } from "@/plan/format";
import { lineStyle, svgDash } from "@/plan/routeStyle";
import { useTheme } from "@/theme/useTheme";
import { Badge, Button } from "./ui";
import { Num } from "./Num";
import { StatNumber } from "./StatNumber";

type Candidate = Schemas["CandidateOut"];

const ROAD_CLASS: Record<string, string> = {
  motorway: "Motorway", trunk: "National highway", primary: "Primary", secondary: "Secondary", tertiary: "Tertiary",
  unclassified: "Minor road", residential: "Residential", service_other: "Service road", service: "Service road",
};
const ROAD_VAR: Record<string, string> = {
  motorway: "--road-motorway", trunk: "--road-trunk", primary: "--road-primary", secondary: "--road-secondary",
  tertiary: "--road-tertiary", unclassified: "--road-minor", residential: "--road-residential",
  service_other: "--road-service", service: "--road-service",
};

export function Swatch({ label, option, index }: { label: string; option: string; index: number }) {
  const [theme] = useTheme();
  const s = lineStyle(label, option, index, theme);
  return (
    <svg width="32" height="10" aria-hidden="true" className="swatch">
      <line x1="2" y1="5" x2="30" y2="5" stroke={s.color} strokeWidth="4" strokeLinecap="butt" strokeDasharray={svgDash(s.dash, 4)} />
    </svg>
  );
}

/** The road mix: a bar (decoration) and the three longest classes in words with their lengths (the information). */
export function RoadClassBar({ classes }: { classes: Record<string, number> }) {
  const entries = Object.entries(classes).filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((t, [, m]) => t + m, 0) || 1;
  const name = (c: string) => ROAD_CLASS[c] ?? c.replace(/_/g, " ");
  return (
    <div className="roadmix">
      <div className="roadbar" aria-hidden="true">
        {entries.map(([c, m]) => (
          <span key={c} style={{ width: `${(m / total) * 100}%`, background: `var(${ROAD_VAR[c] ?? "--road-service"})` }} />
        ))}
      </div>
      <p className="roadmix-text t-meta muted">
        <span className="sr-only">Road mix: </span>
        {entries.map(([c, m], i) => (
          <span key={c} className={i > 2 ? "sr-only" : undefined}>
            {i > 0 && " · "}{name(c)} <Num value={m} format={(v) => km(v)} field={`road_class_m.${c}`} />
          </span>
        ))}
      </p>
    </div>
  );
}

type Props = {
  cand: Candidate;
  index: number;
  total: number;
  selected: boolean;
  pace: number;
  target: number;
  onSelect: () => void;
  onWhy?: () => void;
  whyOpen?: boolean;
};

export function CandidateCard({ cand, index, total, selected, pace, target, onSelect, onWhy, whyOpen }: Props) {
  const s = lineStyle(cand.label, cand.option, index);
  const flags = (cand.flags ?? []).map(flagText);
  const [open, setOpen] = useState<number | null>(null);
  const endAuto = cand.end.kind !== "fixed" && cand.end.kind !== "start";
  return (
    <article className={`route-card${selected ? " selected" : ""}`} data-testid={`card-${cand.label}-${cand.option}`}
      data-route-id={cand.route_id} aria-label={`${s.name}${s.optionName ? `, ${s.optionName}` : ""}`}>
      <button type="button" className="route-card-head" onClick={onSelect} aria-pressed={selected}>
        <Swatch label={cand.label} option={cand.option} index={index} />
        <span className="route-card-name">{s.name}</span>
        <span className="t-meta muted route-card-pos">{index + 1} of {total}</span>
      </button>
      {s.optionName && <p className="t-meta muted route-card-option">{s.optionName}</p>}
      <div className="route-card-stats">
        <div>
          <StatNumber kind="km" value={cand.foot_m} field="foot_m" size="m" />
          <span className="t-meta muted">distance</span>
        </div>
        <div>
          <StatNumber kind="time" value={cand.foot_m} field="foot_m" pace={pace} size="m" />
          <span className="t-meta muted">at your pace</span>
        </div>
        <div>
          {cand.gain_m == null ? <span className="t-body-s">not known</span> : (
            <span className="climb"><span className="t-stat-m" aria-hidden="true">+</span><span className="sr-only">plus </span>
              <StatNumber kind="m" value={cand.gain_m} field="gain_m" size="m" /></span>
          )}
          <span className="t-meta muted">climb{cand.climb_approximate ? ", approx." : ""}</span>
        </div>
      </div>
      <p className="t-body-s route-card-line">
        <strong><Num value={cand.deviation_m} format={(v) => signedKm(v)} field="deviation_m" /></strong>{" "}
        <span className="muted">vs your <Num value={target} format={(v) => km(v)} field="target_distance_m" /></span>
      </p>
      <p className="t-body-s route-card-line route-card-end">
        Ends at <span data-field="end.label">{cand.end.label ?? "an unnamed road"}</span>
        {endAuto && <span className="muted"> (auto)</span>}
      </p>
      <RoadClassBar classes={cand.road_class_m ?? {}} />
      <div className="route-card-foot">
        {flags.length > 0 && (
          <ul className="route-card-flags" aria-label="Notes">
            {flags.map((f, i) => (
              <li key={i}>
                <Badge tone={f.tone} onClick={f.detail ? () => setOpen(open === i ? null : i) : undefined} expanded={open === i}>
                  {f.short}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {onWhy && (
          <Button variant="quiet" icon={whyOpen ? "chevronUp" : "chevronDown"} onClick={onWhy} aria-expanded={!!whyOpen}
            aria-controls={whyOpen ? "why-this-route" : undefined} className="route-card-why">
            Why this route?
          </Button>
        )}
      </div>
      {open !== null && flags[open] && (
        <p className="t-body-s route-card-detail">{flags[open]!.title}. <span className="muted">{flags[open]!.detail}</span></p>
      )}
    </article>
  );
}
