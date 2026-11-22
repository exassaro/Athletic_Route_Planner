"use client";
/**
 * First-time setup (blueprint Phase 5b amendment 8): one question per step, big touch targets, the optional ones
 * skippable. Start, distance, shape, towards (optional; needed for an out-and-back), stops (optional). Every
 * answer is an Edit applied to the draft request, as the old form did; "Plan my run" sends the draft. After the
 * first route every change goes through the chips.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { NewRouteRequest } from "@/api/client";
import { directionText } from "@/plan/direction";
import { blocked, type Edit, type Point, type RouteRequest, type RouteType } from "@/plan/edits";
import { km } from "@/plan/format";
import type { IconName } from "@/brand/icons";
import { DirectionPicker, DistanceStepper } from "../Controls";
import { PlaceSearch } from "../PlaceSearch";
import { Mascot } from "../Mascot";
import { featureItem } from "../StopsPanel";
import { Button, Chip, Icon, IconButton } from "../ui";

/** The planner's draft: a new request (the API fills every field left out) whose start may still be missing. */
type Draft = Omit<NewRouteRequest, "start"> & { start: Point | null };

type Props = {
  draft: Draft;
  onEdit: (e: Edit) => void;
  startControls: ReactNode;
  near: [number, number] | null;
  map?: MapLibreMap | null;
  /** True while the direction step is showing (the compass then marks the direction). */
  onDirectionStep?: (showing: boolean) => void;
  solving: boolean;
  canPlan: boolean;
  onPlan: () => void;
};

const STEPS = ["Where do you start?", "How far?", "What shape?", "Which way?", "Any stops on the way?"];
const PICKS_KM = [5, 10, 15, 21.1, 25];
const SHAPES: { value: RouteType; label: string; sub: string; icon: IconName }[] = [
  { value: "point_to_point", label: "Point to point", sub: "Start here, finish somewhere else", icon: "pointToPoint" },
  { value: "out_and_back", label: "Out and back", sub: "Turn round halfway, finish at the start", icon: "outAndBack" },
  { value: "loop", label: "Loop", sub: "Come back to the start another way", icon: "loop" },
];

export function SetupFlow({ draft, onEdit, startControls, near, map, onDirectionStep, solving, canPlan, onPlan }: Props) {
  const [step, setStep] = useState(1);
  const title = useRef<HTMLHeadingElement>(null);
  const hadStart = useRef(!!draft.start);

  // Choosing the start (search, location or map) moves on to the distance.
  useEffect(() => {
    if (draft.start && !hadStart.current && step === 1) setStep(2);
    hadStart.current = !!draft.start;
  }, [draft.start, step]);
  useEffect(() => {
    onDirectionStep?.(step === 4);
    return () => onDirectionStep?.(false);
  }, [step, onDirectionStep]);
  // Each new question gets the focus, so a screen reader hears it.
  useEffect(() => {
    if (step > 1) title.current?.focus();
  }, [step]);

  const shape = SHAPES.find((s) => s.value === draft.route_type)!;
  const d = draft.direction;
  const answers = [draft.start?.label ?? (draft.start ? "a point" : null), step > 2 ? km(draft.target_distance_m) : null,
    step > 3 ? shape.label : null, step > 4 && d ? directionText(draft) : null]
    .filter(Boolean).join(" · ");
  const needsDirection = draft.route_type === "out_and_back" && !d;
  const next = () => setStep((s) => Math.min(5, s + 1));

  return (
    <section className="setup" aria-label="Plan your run" data-step={step}>
      <div className="setup-head">
        {step > 1
          ? <IconButton icon="chevronLeft" label="Back" onClick={() => setStep(step - 1)} />
          : <span className="setup-head-gap" aria-hidden="true" />}
        <div className="setup-progress" aria-hidden="true">
          {STEPS.map((_, i) => <span key={i} className={i < step ? "on" : undefined} />)}
        </div>
        <span className="t-meta muted">Step {step} of 5</span>
      </div>
      {answers && <p className="t-body-s muted setup-answers">{answers}</p>}
      <div className="setup-title-row">
        <h2 ref={title} tabIndex={-1} className="t-title setup-title">
          {STEPS[step - 1]}{step >= 4 && <span className="t-body-s muted"> {needsDirection ? "(needed for out and back)" : "(optional)"}</span>}
        </h2>
        {step === 1 && <Mascot />}
      </div>

      <div className="setup-body">
        {step === 1 && startControls}

        {step === 2 && (
          <>
            <DistanceStepper request={draft as RouteRequest} onEdit={onEdit} near={near} live={false} />
            <div className="setup-picks" role="group" aria-label="Quick picks">
              {PICKS_KM.map((k) => (
                <Chip key={k} aria-pressed={draft.target_distance_m === k * 1000}
                  onClick={() => onEdit({ kind: "distance", meters: k * 1000 })}>{k} km</Chip>
              ))}
            </div>
            <p className="t-body-s muted">Routes are planned to within 500 m of this.</p>
          </>
        )}

        {step === 3 && (
          <fieldset className="shape-tiles">
            <legend className="sr-only">Route shape</legend>
            {SHAPES.map((s) => {
              const e: Edit = { kind: "route_type", value: s.value };
              const why = draft.route_type === s.value ? null : blocked(draft as RouteRequest, e);
              const on = draft.route_type === s.value;
              return (
                <label key={s.value} className={`shape-tile${on ? " on" : ""}`} title={why ?? undefined}>
                  <input type="radio" name="setup-shape" value={s.value} checked={on} disabled={!!why} onChange={() => onEdit(e)} />
                  <Icon name={s.icon} />
                  <span className="shape-tile-text"><span className="shape-tile-label">{s.label}</span><span className="t-meta muted">{s.sub}</span></span>
                  {on && <Icon name="check" className="shape-tile-check" />}
                </label>
              );
            })}
          </fieldset>
        )}

        {step === 4 && <DirectionPicker request={draft as RouteRequest} onEdit={onEdit} near={near} map={map} live={false} />}

        {step === 5 && <StopsStep draft={draft} onEdit={onEdit} near={near} />}
      </div>

      <div className="setup-foot">
        {step === 1 && draft.start && <Button variant="primary" size="lg" block onClick={next} data-testid="setup-next">Next</Button>}
        {(step === 2 || step === 3) && <Button variant="primary" size="lg" block onClick={next} data-testid="setup-next">Next</Button>}
        {step === 4 && (
          <>
            {!needsDirection && !d && <Button size="lg" onClick={next} data-testid="setup-skip">Skip</Button>}
            <Button variant="primary" size="lg" block onClick={next} disabled={needsDirection} data-testid="setup-next">Next</Button>
          </>
        )}
        {step === 5 && (
          <Button variant="primary" size="lg" block disabled={!canPlan || solving} onClick={onPlan} data-testid="plan-button">
            {solving ? "Planning…" : "Plan my run"}
          </Button>
        )}
      </div>
    </section>
  );
}

/** Step 5: stops before the first route, built by the API from OSM like every other stop. */
function StopsStep({ draft, onEdit, near }: { draft: Draft; onEdit: (e: Edit) => void; near: [number, number] | null }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const stops = draft.checkpoints ?? [];
  const add = async (p: { place_id: string; lon: number; lat: number; label: string }) => {
    setError(null);
    setPending(p.label);
    try {
      const out = await featureItem("checkpoint", "place", p.place_id, p);
      const e: Edit = { kind: "add", list: "checkpoints", item: out.checkpoint! };
      const why = blocked(draft as RouteRequest, e);
      if (why) setError(why);
      else onEdit(e);
    } catch (x) {
      setError(String((x as Error).message));
    } finally {
      setPending(null);
    }
  };
  return (
    <>
      <PlaceSearch label="Add a place to pass" near={near} onPick={(p) => add(p)} testId="setup-stop-search" />
      {pending && <p role="status" className="t-body-s muted">Adding {pending}…</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
      {stops.length > 0 && (
        <ol className="setup-stops" aria-label="Stops so far">
          {stops.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <span className="setup-stop-num">{i + 1}</span>
              <span className="setup-stop-name">{s.label}</span>
              <IconButton icon="close" label={`Remove ${s.label}`} onClick={() => onEdit({ kind: "remove", list: "checkpoints", index: i, label: s.label })} />
            </li>
          ))}
        </ol>
      )}
      <p className="t-body-s muted">Bridges and roads can be added after planning: tap them on the map from the stops list.</p>
    </>
  );
}
