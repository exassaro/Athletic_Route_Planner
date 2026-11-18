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
import { pace as formatPace, parsePace, signedKm } from "@/plan/format";
import { usePace } from "@/plan/pace";
import type { Place } from "@/plan/places";
import { planClient, usePlan, type Busy } from "@/plan/usePlan";
import type { NewRouteRequest } from "@/api/client";
import { PeekBar } from "./PeekBar";
import { RouteCards } from "./RouteCards";
import { DirectionPicker, DistanceStepper, PathsToggle, RouteTypePicker } from "./Controls";
import { OutcomePanel } from "./OutcomePanel";
import { PlaceSearch } from "./PlaceSearch";
import { RouteDetail } from "./RouteDetail";
import { SaveShare } from "./SaveShare";
import { StopsPanel } from "./StopsPanel";
import { HealthBanner } from "./HealthBanner";
import { ThemeToggle } from "@/theme/ThemeToggle";
import { BottomSheet, type Snap } from "./sheet/BottomSheet";
import { EditorDialog } from "./EditorDialog";
import { PlanChips, type ChipKey } from "./PlanChips";
import { Button } from "./ui";
import { SetupFlow } from "./setup/SetupFlow";
import { RunCycle } from "./Sprite";

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
    else setDraft((d) => {
      // The draft starts without the lists (the API fills its defaults); the first stop added before planning makes one.
      const base = e.kind === "add" && !(d as Record<string, unknown>)[e.list] ? { ...d, [e.list]: [] } : d;
      return applyToDraft(base, patchFor(base as RouteRequest, e));
    });
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

  // Chips: each opens its editor; the stop-like ones go to the stops list.
  const [editor, setEditor] = useState<ChipKey | null>(null);
  const goToStops = () => {
    setSheet("full");
    setTimeout(() => {
      const el = document.getElementById("stops-panel");
      el?.scrollIntoView({ block: "start" });
      el?.focus({ preventScroll: true });
    }, 260);
  };
  const openChip = (k: ChipKey) => (k === "stops" || k === "via" || k === "must_use" || k === "avoid" ? goToStops() : setEditor(k));
  const attention: ChipKey[] = v && (v.outcome === "over_budget"
    || ["checkpoints_exceed_distance", "loop_stop_too_far"].includes(v.conflict?.kind ?? "")) ? ["distance"] : [];
  const EDITOR_TITLE: Partial<Record<ChipKey, string>> = { start: "Start", distance: "Distance", type: "Route shape",
    direction: "Direction", paths: "Roads and paths" };

  const startControls = (
    <div className="start-field">
      {!v && request.start && (
        <p className="current" data-testid="start-current">Start: <strong>{request.start.label ?? "a point"}</strong></p>
      )}
      <PlaceSearch label={request.start ? "Change the start" : "Start"} near={near}
        onPick={(p) => { setStart(placePoint(p)); setEditor(null); }} testId="start-search" />
      <div className="row">
        <Button icon="gps" onClick={locate}>My location</Button>
        <Button icon="mapPin" onClick={() => { setEditor(null); setPicking("start"); }} aria-pressed={picking === "start"}>
          {picking === "start" ? "Tap the map…" : "Pick on the map"}
        </Button>
      </div>
      {locError && <p role="alert" className="error-text">{locError}</p>}
    </div>
  );

  return (
    <div className={`planner sheet-${sheet}${v ? "" : " setup-mode"}`}>
      <MapView onReady={setMap} />
      <BottomSheet snap={sheet} onSnap={setSheet} label="Plan your run" halfRatio={v ? 0.5 : 0.64}>
          {/* what a peeked sheet shows first (step 4 replaces it with the peek bar) */}
          <StatusLine busy={plan.busy} onDismiss={plan.clearError} />
          {toast && <p className="toast" role="status" data-testid="diff-toast">{toast}</p>}
          {v && candidates[selected] && <PeekBar cand={candidates[selected]!} pace={pace} />}
          <p className="saved-link"><Link href="/routes">Saved routes</Link> · <Link href="/about">About</Link></p>
          <HealthBanner trigger={plan.busy.kind === "error" ? plan.busy.error.code : null} />
          {v && <PlanChips request={v.request} attention={attention} onOpen={openChip} />}
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
              <RouteCards candidates={candidates} selected={selected} onSelect={setSelected} pace={pace}
                target={v.request.target_distance_m} explanation={v.explanation} versionKey={`${v.plan_id}/${v.version}`} />
              <StopsPanel request={v.request} version={v} selected={candidates[selected] ?? null} onEdit={onEdit} near={near} map={map}
                onMapPick={mapPick} />
              {candidates[selected] && <RouteDetail map={map} cand={candidates[selected]!} index={selected} />}
              {candidates[selected] && <SaveShare cand={candidates[selected]!} />}
            </>
          )}
          {/* Before the first route: the five setup steps. After it, every change goes through the chips. */}
          {!v && (
            <SetupFlow draft={draft} onEdit={onEdit} startControls={startControls} near={near} solving={solving}
              canPlan={canPlan} onPlan={() => draft.start && plan.create(draft as NewRouteRequest)} />
          )}
          {/* pace and theme move to the menu in step 8 */}
          <section className="settings" aria-label="Settings">
            <h2 className="t-heading">Settings</h2>
            <PaceSetting pace={pace} onChange={setPace} />
            <ThemeToggle />
          </section>
      </BottomSheet>
      {v && (
        <EditorDialog open={editor !== null} title={editor ? EDITOR_TITLE[editor] ?? "" : ""} onClose={() => setEditor(null)}
          testId="chip-editor">
          {editor === "start" && startControls}
          {editor === "distance" && <DistanceStepper request={v.request} onEdit={onEdit} near={near} live />}
          {editor === "type" && <RouteTypePicker request={v.request} onEdit={onEdit} near={near} live />}
          {editor === "direction" && <DirectionPicker request={v.request} onEdit={onEdit} near={near} live />}
          {editor === "paths" && <PathsToggle request={v.request} onEdit={onEdit} near={near} live />}
        </EditorDialog>
      )}
    </div>
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
      {text && <p className="progress"><RunCycle scale={1} />{text}</p>}
      {busy.kind === "error" && (
        <div role="alert" className="error-box" data-error={busy.error.code}>
          <p>{busy.error.message}</p>
          <button type="button" onClick={onDismiss}>OK</button>
        </div>
      )}
    </div>
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
