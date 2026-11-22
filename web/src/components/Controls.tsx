"use client";
/**
 * The request controls (section 13 planner): distance stepper, route type, direction. They do not change the
 * request themselves: each one reports an Edit, which the planner sends as a patch (or, before the first solve,
 * applies to the draft form).
 */
import { useEffect, useId, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useBearing } from "@/map/useBearing";
import { DIRECTIONS, directionText, onMap, pointing } from "@/plan/direction";
import { blocked, type Edit, type RouteRequest, type RouteType } from "@/plan/edits";
import type { Place } from "@/plan/places";
import { DirectionDial } from "./DirectionDial";
import { PlaceSearch } from "./PlaceSearch";

type Props = { request: RouteRequest; onEdit: (e: Edit) => void; near: [number, number] | null; live: boolean };

export function DistanceStepper({ request, onEdit, live }: Props) {
  const id = useId();
  const [km, setKm] = useState(request.target_distance_m / 1000);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sent = useRef<number | null>(null);      // the value already on its way: not sent again while it solves
  useEffect(() => {
    setKm(request.target_distance_m / 1000); // eslint-disable-line react-hooks/set-state-in-effect
    sent.current = null;
  }, [request.target_distance_m]);
  const send = (value: number) => {
    const v = Math.round(value * 10) / 10;
    setKm(v);
    const e: Edit = { kind: "distance", meters: Math.round(v * 1000) };
    if (blocked(request, e)) return;
    // Leaving the box without changing it sends nothing (a blur must not undo a fix applied meanwhile), and Enter
    // followed by a blur (tapping Done) sends the value once, even before the API has answered the first.
    if (e.meters === sent.current && timer.current === null) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (e.meters === request.target_distance_m) return;
    // After a solve exists, taps are collected for a moment so + + + sends one patch.
    timer.current = setTimeout(() => {
      timer.current = null;
      sent.current = e.meters;
      onEdit(e);
    }, live ? 700 : 0);
  };
  const error = blocked(request, { kind: "distance", meters: Math.round(km * 1000) });
  return (
    <div className="stepper">
      <label htmlFor={id} className="field-label">Distance</label>
      <div className="stepper-row">
        <button type="button" onClick={() => send(Math.max(1, Math.floor(km - 1)))} aria-label="1 km less">−</button>
        <input id={id} type="number" inputMode="decimal" min={1} max={100} step={0.5} value={km}
          onChange={(e) => setKm(Number(e.target.value))} onBlur={() => send(km)}
          onKeyDown={(e) => e.key === "Enter" && send(km)} data-testid="distance-input" />
        <span>km</span>
        <button type="button" onClick={() => send(Math.min(100, Math.floor(km) + 1))} aria-label="1 km more">+</button>
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
    </div>
  );
}

const TYPES: { value: RouteType; label: string }[] = [
  { value: "point_to_point", label: "Point to point" },
  { value: "out_and_back", label: "Out and back" },
  { value: "loop", label: "Loop" },
];

export function RouteTypePicker({ request, onEdit }: Props) {
  return (
    <fieldset className="segmented">
      <legend className="field-label">Route type</legend>
      {TYPES.map((t) => {
        const e: Edit = { kind: "route_type", value: t.value };
        const why = request.route_type === t.value ? null : blocked(request, e);
        return (
          <label key={t.value} className={request.route_type === t.value ? "on" : ""} title={why ?? undefined}>
            <input type="radio" name="route_type" value={t.value} checked={request.route_type === t.value}
              disabled={!!why} onChange={() => onEdit(e)} />
            {t.label}
          </label>
        );
      })}
    </fieldset>
  );
}

/** Reading order of the rose: three rows, the dial in the middle (amendment 18). */
const ROSE = [7, 0, 1, 6, null, 2, 5, 4, 3] as const;

export function DirectionPicker({ request, onEdit, near, map = null }: Props & { map?: MapLibreMap | null }) {
  const d = request.direction;
  const turned = useBearing(map);
  const [mode, setMode] = useState<"place" | "bearing">(d?.kind === "bearing" ? "bearing" : "place");
  const needed = request.route_type === "out_and_back";
  const toPoint = (p: Place) => ({ lon: p.lon, lat: p.lat, label: p.label, place_id: p.place_id });
  return (
    <div className="direction">
      <span className="field-label">Towards{needed ? "" : " (optional)"}</span>
      {d && (
        <p className="current" data-testid="direction-current">
          <span>{directionText(request)}</span>
          {!needed && <button type="button" className="link" onClick={() => onEdit({ kind: "no_direction" })}>Clear</button>}
        </p>
      )}
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "place"} onClick={() => setMode("place")}>A place</button>
        <button type="button" role="tab" aria-selected={mode === "bearing"} onClick={() => setMode("bearing")}>A direction</button>
      </div>
      {mode === "place" ? (
        <PlaceSearch label="Towards place" near={near} testId="towards-search"
          onPick={(p) => onEdit({ kind: "towards_place", place: toPoint(p) })} />
      ) : (
        <div className="direction-rose" role="group" aria-label="Direction">
          {ROSE.map((i) => {
            if (i === null) return <DirectionDial key="dial" degrees={pointing(request)} />;
            const { name, degrees } = DIRECTIONS[i];
            const hint = onMap(degrees, turned);
            return (
              <button key={name} type="button" className="direction-option" aria-label={`${name}, ${hint}`}
                aria-pressed={d?.kind === "bearing" && d.degrees === degrees} onClick={() => onEdit({ kind: "bearing", degrees })}>
                <span className="direction-name">{name}</span>
                <span className="direction-hint">{hint}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PathsToggle({ request, onEdit }: Props) {
  const allow = request.preferences?.paths === "allow";
  return (
    <label className="toggle">
      <input type="checkbox" checked={allow} onChange={() => onEdit({ kind: "paths", value: allow ? "avoid" : "allow" })} />
      Use footpaths and tracks freely <span className="muted">(otherwise only when nothing else connects)</span>
    </label>
  );
}
