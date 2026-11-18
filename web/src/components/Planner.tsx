"use client";
/**
 * The planner (section 13, Phase 5 amendments 4 to 6): a full-screen map with a bottom sheet on a phone and a
 * side panel on a desktop. Before the first solve the controls fill a draft; "Plan my run" creates the plan, and
 * from then on every control sends a patch and the screen shows what the API returns.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { MapView } from "@/map/MapView";
import { setPoint, useRouteLayers } from "@/map/useRouteLayers";
import { applyToDraft, patchFor, type Edit, type Point, type RouteRequest } from "@/plan/edits";
import { km, pace as formatPace, parsePace, runningTime, signedKm } from "@/plan/format";
import { usePace } from "@/plan/pace";
import type { Place } from "@/plan/places";
import { planClient, usePlan, type Busy } from "@/plan/usePlan";
import type { NewRouteRequest, Schemas } from "@/api/client";
import { CandidateCard } from "./CandidateCard";
import { DirectionPicker, DistanceStepper, PathsToggle, RouteTypePicker } from "./Controls";
import { Num } from "./Num";
import { OutcomePanel } from "./OutcomePanel";
import { PlaceSearch } from "./PlaceSearch";
import { RouteDetail } from "./RouteDetail";
import { SaveShare } from "./SaveShare";
import { StopsPanel } from "./StopsPanel";
import { HealthBanner } from "./HealthBanner";
import { ThemeToggle } from "@/theme/ThemeToggle";
import { BottomSheet, type Snap } from "./sheet/BottomSheet";

/** The form before the first solve: the API fills every field left out with its default. */
type Draft = Omit<NewRouteRequest, "start"> & { start: Point | null };

const NEW_DRAFT: Draft = { route_type: "point_to_point", start: null, target_distance_m: 10000, direction: null };

function placePoint(p: Place): Point {
  return { lon: p.lon, lat: p.lat, label: p.label, place_id: p.place_id };
}

export function Planner() {
  const plan = usePlan();
  const [pace, setPace] = usePace();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [selected, setSelected] = useState(0);
  const [sheet, setSheet] = useState<Snap>("half");
  const [picking, setPicking] = useState<null | "start">(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const v = plan.version;
  const request: Draft = v ? v.request : draft;
  const solving = plan.busy.kind === "solving" || plan.busy.kind === "busy" || plan.busy.kind === "waiting";
  const candidates = useMemo(() => v?.candidates ?? [], [v]);

  useEffect(() => setSelected(0), [v?.version]); // eslint-disable-line react-hooks/set-state-in-effect
  useRouteLayers(map, candidates, selected, solving, v ? `${v.plan_id}/${v.version}` : null, request);

  // The diff after every edit, as the API reports it ("+3.0 km, new end: X").
  useEffect(() => {
    if (!v?.diff) return;
    const d = v.diff;
    const parts: string[] = [];
    if (d.length_delta_m != null) parts.push(signedKm(d.length_delta_m));
    if (d.end_changed) parts.push(`new end: ${v.candidates[0]?.end.label ?? "unnamed road"}`);
    if (d.outcome.from !== d.outcome.to) parts.push(d.outcome.to === "ok" ? "route found" : d.outcome.to.replace(/_/g, " "));
    d.stops_added.forEach((s) => parts.push(`added ${s.label}`));
    d.stops_removed.forEach((s) => parts.push(`removed ${s.label}`));
    const fallback = v.candidates.length === 0 ? "Still no route: see what to change below" : "No change to the route";
    setToast(parts.join(", ") || fallback); // eslint-disable-line react-hooks/set-state-in-effect
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [v]);

  const onEdit = useCallback((e: Edit) => {
    if (plan.version) plan.edit(e);
    else setDraft((d) => applyToDraft(d, patchFor(d as RouteRequest, e)));
  }, [plan]);

  const setStart = useCallback((point: Point) => {
    if (map) setPoint(map, "draft-start", [point.lon, point.lat]);
    onEdit({ kind: "start", point });
    map?.easeTo({ center: [point.lon, point.lat], zoom: Math.max(map.getZoom(), 13) });
  }, [map, onEdit]);

  // Tap on the map to set the start: the point is the runner's own; the name comes from the place lookup.
  useEffect(() => {
    if (!map || picking !== "start") return;
    map.getCanvas().style.cursor = "crosshair";
    const onClick = async (e: MapMouseEvent) => {
      setPicking(null);
      setSheet("half");
      map.getCanvas().style.cursor = "";
      const { lng, lat } = e.lngLat;
      const { data } = await planClient().api.GET("/v1/places/reverse", { params: { query: { lon: lng, lat } } });
      const near = data?.place?.label;
      setStart({ lon: lng, lat, label: near ? `Near ${near}` : "Point on the map", place_id: null });
    };
    map.once("click", onClick);
    return () => {
      map.off("click", onClick);
      map.getCanvas().style.cursor = "";
    };
  }, [map, picking, setStart]);

  const locate = () => {
    setLocError(null);
    if (!navigator.geolocation) return setLocError("This browser cannot share its location.");
    navigator.geolocation.getCurrentPosition(
      (pos) => setStart({ lon: pos.coords.longitude, lat: pos.coords.latitude, label: "My location", place_id: null }),
      (err) => setLocError(err.code === err.PERMISSION_DENIED ? "Location permission was refused." :
        "Location is not available (a phone needs HTTPS for this)."),
      { enableHighAccuracy: true, timeout: 15000 });
  };

  const mapPick = useCallback((active: boolean) => setSheet(active ? "peek" : "half"), []);
  useEffect(() => {
    if (picking) setSheet("peek"); // eslint-disable-line react-hooks/set-state-in-effect
  }, [picking]);

  const near: [number, number] | null = request.start ? [request.start.lon, request.start.lat] : null;
  const canPlan = !v && !!draft.start && (draft.route_type !== "out_and_back" || !!draft.direction);

  return (
    <div className={`planner sheet-${sheet}`}>
      <MapView onReady={setMap} />
      <BottomSheet snap={sheet} onSnap={setSheet} label="Plan your run">
          {/* what a peeked sheet shows first (step 4 replaces it with the peek bar) */}
          <StatusLine busy={plan.busy} onDismiss={plan.clearError} />
          {toast && <p className="toast" role="status" data-testid="diff-toast">{toast}</p>}
          {v && candidates[selected] && <Summary cand={candidates[selected]!} pace={pace} />}
          <p className="saved-link"><Link href="/routes">Saved routes</Link> · <Link href="/about">About</Link></p>
          <HealthBanner trigger={plan.busy.kind === "error" ? plan.busy.error.code : null} />
          <Chips request={request} />
          {v && (
            <div className="history" role="group" aria-label="Versions">
              <button type="button" onClick={plan.undo} disabled={!plan.canUndo || solving}>Undo</button>
              <button type="button" onClick={plan.redo} disabled={!plan.canRedo || solving}>Redo</button>
              <span className="muted">Version {v.version}</span>
            </div>
          )}
          {v && (
            <>
              <OutcomePanel version={v} onPatch={plan.applyPatch} disabled={solving} />
              {v.explanation && <p className="explanation" data-testid="explanation">{v.explanation}</p>}
              <div className="cards" role="list">
                {candidates.map((c, i) => (
                  <div role="listitem" key={c.route_id}>
                    <CandidateCard cand={c} index={i} selected={i === selected} pace={pace} onSelect={() => setSelected(i)} />
                  </div>
                ))}
              </div>
              <StopsPanel request={v.request} version={v} selected={candidates[selected] ?? null} onEdit={onEdit} near={near} map={map}
                onMapPick={mapPick} />
              {candidates[selected] && <RouteDetail map={map} cand={candidates[selected]!} index={selected} />}
              {candidates[selected] && <SaveShare cand={candidates[selected]!} />}
            </>
          )}
          <section className={v ? "adjust" : "plan-form"} aria-label={v ? "Adjust the plan" : "Your run"}>
            {v && <h2>Adjust</h2>}
            <div className="start-field">
              {request.start && (
                <p className="current" data-testid="start-current">Start: <strong>{request.start.label ?? "a point"}</strong></p>
              )}
              <PlaceSearch label={request.start ? "Change the start" : "Start"} near={near}
                onPick={(p) => setStart(placePoint(p))} testId="start-search" />
              <div className="row">
                <button type="button" onClick={locate}>Use my location</button>
                <button type="button" onClick={() => setPicking("start")} aria-pressed={picking === "start"}>
                  {picking === "start" ? "Tap the map…" : "Pick on map"}
                </button>
              </div>
              {locError && <p role="alert" className="error-text">{locError}</p>}
            </div>
            <DistanceStepper request={request as RouteRequest} onEdit={onEdit} near={near} live={!!v} />
            <RouteTypePicker request={request as RouteRequest} onEdit={onEdit} near={near} live={!!v} />
            <DirectionPicker request={request as RouteRequest} onEdit={onEdit} near={near} live={!!v} />
            {v && <PathsToggle request={v.request} onEdit={onEdit} near={near} live />}
            {!v && (
              <button type="button" className="primary" disabled={!canPlan || solving} data-testid="plan-button"
                onClick={() => draft.start && plan.create(draft as NewRouteRequest)}>
                {solving ? "Planning…" : "Plan my run"}
              </button>
            )}
            <PaceSetting pace={pace} onChange={setPace} />
            <ThemeToggle />
          </section>
      </BottomSheet>
    </div>
  );
}

/** The one-line summary of the selected route (visible with the sheet collapsed). */
function Summary({ cand, pace }: { cand: Schemas["CandidateOut"]; pace: number }) {
  return (
    <p className="summary" data-testid="summary">
      <Num value={cand.foot_m} format={(m) => km(m)} field="foot_m" /> ·{" "}
      <span data-value={cand.foot_m} data-field="foot_m" data-pace={pace}>{runningTime(cand.foot_m, pace)}</span> at your pace · ends at{" "}
      <span data-field="end.label">{cand.end.label ?? "an unnamed road"}</span>
    </p>
  );
}

function StatusLine({ busy, onDismiss }: { busy: Busy; onDismiss: () => void }) {
  let text: string | null = null;
  if (busy.kind === "solving") text = "Finding your route…";
  if (busy.kind === "busy") text = busy.reason === "solver_busy"
    ? `Many runs are being planned right now. Trying again in ${busy.retryInS} s (attempt ${busy.attempt}).`
    : `Too many requests for a moment. Trying again in ${busy.retryInS} s.`;
  if (busy.kind === "waiting") text = busy.reason === "solve_timeout"
    ? "This one is taking longer than usual. It is still being worked on…"
    : "Finishing the previous change first…";
  return (
    <div aria-live="polite" className="status" data-testid="status" data-state={busy.kind}>
      {text && <p className="progress"><span className="spinner" aria-hidden="true" />{text}</p>}
      {busy.kind === "error" && (
        <div role="alert" className="error-box" data-error={busy.error.code}>
          <p>{busy.error.message}</p>
          <button type="button" onClick={onDismiss}>OK</button>
        </div>
      )}
    </div>
  );
}

function Chips({ request }: { request: Draft }) {
  const chips: { key: string; text: string }[] = [{ key: "activity", text: "Run" }];
  chips.push({ key: "distance", text: km(request.target_distance_m) });
  chips.push({ key: "type", text: { point_to_point: "Point to point", out_and_back: "Out and back", loop: "Loop" }[request.route_type] });
  const d = request.direction;
  if (d) chips.push({ key: "direction", text: d.kind === "towards_place" ? `Towards ${d.place.label ?? "a point"}` : `Heading ${d.degrees}°` });
  const n = request.checkpoints?.length ?? 0;
  if (n) chips.push({ key: "stops", text: `${n} stop${n > 1 ? "s" : ""}${request.checkpoint_order === "fixed" ? " (my order)" : ""}` });
  if (request.via?.length) chips.push({ key: "via", text: `via ${request.via.map((x) => x.label ?? "a point").join(", ")}` });
  if (request.must_use?.length) chips.push({ key: "must_use", text: `uses ${request.must_use.map((x) => x.label).join(", ")}` });
  if (request.avoid?.length) chips.push({ key: "avoid", text: `avoids ${request.avoid.map((x) => x.label).join(", ")}` });
  chips.push({ key: "paths", text: request.preferences?.paths === "allow" ? "Paths allowed" : "Roads first" });
  return (
    <ul className="chips" aria-label="Your constraints" data-testid="chips">
      {chips.map((c) => (
        <li key={c.key} data-chip={c.key}>
          {c.key === "distance" ? <Num value={request.target_distance_m} format={(m) => km(m)} field="target_distance_m" /> : c.text}
        </li>
      ))}
    </ul>
  );
}

function PaceSetting({ pace, onChange }: { pace: number; onChange: (s: number) => void }) {
  const [text, setText] = useState(formatPace(pace).replace(" /km", ""));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(formatPace(pace).replace(" /km", "")), [pace]); // eslint-disable-line react-hooks/set-state-in-effect
  const commit = () => {
    const s = parsePace(text);
    setBad(s === null);
    if (s !== null) onChange(s);
  };
  return (
    <div className="pace">
      <label htmlFor="pace" className="field-label">Your pace (min:sec per km, kept on this device)</label>
      <input id="pace" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()} inputMode="numeric" aria-invalid={bad} />
      {bad && <p role="alert" className="error-text">Write a pace like 5:45.</p>}
    </div>
  );
}
