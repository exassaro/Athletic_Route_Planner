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
import { useRouteLayers } from "@/map/useRouteLayers";
import { useTheme } from "@/theme/useTheme";
import { pointing } from "@/plan/direction";
import { preferredCandidate } from "@/saved/preferred";
import { applyToDraft, blocked, patchFor, type Edit, type Point, type RouteRequest } from "@/plan/edits";
import { pace as formatPace, parsePace, signedKm } from "@/plan/format";
import { usePace } from "@/plan/pace";
import type { Place } from "@/plan/places";
import { planClient, usePlan, type Busy, type Opening } from "@/plan/usePlan";
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
import { Button, Snackbar } from "./ui";
import { TopBar, type PlaceAction } from "./TopBar";
import { featureItem } from "./StopsPanel";
import { SetupFlow } from "./setup/SetupFlow";
import { SneakerCycle } from "./Sprite";

/** The form before the first solve: the API fills every field left out with its default. */
type Draft = Omit<NewRouteRequest, "start"> & { start: Point | null };

const NEW_DRAFT: Draft = { route_type: "point_to_point", start: null, target_distance_m: 10000, direction: null };

function placePoint(p: Place): Point {
  return { lon: p.lon, lat: p.lat, label: p.label, place_id: p.place_id };
}

export function Planner({ editSavedId = null }: { editSavedId?: string | null }) {
  const plan = usePlan(editSavedId);
  const [pace, setPace] = usePace();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [picked, setPicked] = useState<{ key: string; index: number } | null>(null);
  const [sheet, setSheet] = useState<Snap>("half");
  const [picking, setPicking] = useState<null | "start">(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const v = plan.version;
  const request: Draft = v ? v.request : draft;
  const solving = plan.busy.kind === "solving" || plan.busy.kind === "busy" || plan.busy.kind === "waiting";
  const candidates = useMemo(() => v?.candidates ?? [], [v]);

  // A new version starts at its first card; while a saved route is edited, at the saved route's own alternative.
  const versionKey = v ? `${v.plan_id}/${v.version}` : "";
  const selected = useMemo(() => {
    if (picked?.key === versionKey) return picked.index;
    return preferredCandidate(candidates, plan.editing?.route ?? null);
  }, [candidates, picked, plan.editing, versionKey]);
  const setSelected = (index: number) => setPicked({ key: versionKey, index });
  const [theme] = useTheme();
  // The start pin faces the way the route leaves: towards the API's first km mark (from the elevation response),
  // or along the first geometry segment until that has arrived. Coordinates compared, nothing measured.
  const [firstKm, setFirstKm] = useState<{ routeId: string; lon: number } | null>(null);
  const cand = candidates[selected];
  const startLon = cand?.stops?.find((s) => s.role === "start")?.snapped_lon;
  const facingWest = !!cand && (firstKm?.routeId === cand.route_id && startLon != null
    ? firstKm.lon < startLon
    : cand.geometry.length > 1 && cand.geometry[1]![0] < cand.geometry[0]![0]);
  useRouteLayers(map, candidates, selected, solving, v ? `${v.plan_id}/${v.version}` : null, request, theme, facingWest);

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
    // It stays until the next change or until dismissed (no timer: it must be readable and its Undo reachable).
    setToast(parts.join(", ") || fallback); // eslint-disable-line react-hooks/set-state-in-effect
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
    onEdit({ kind: "start", point });
    if (!map) return;
    // into the part of the map the sheet (or the desktop panel) leaves free, or its hops are never seen
    const covered = document.querySelector(".sheet")?.getBoundingClientRect();
    const wide = window.matchMedia("(min-width: 900px)").matches;
    const offset: [number, number] = !covered ? [0, 0]
      : wide ? [covered.right / 2, 0] : [0, (64 + covered.top - window.innerHeight) / 2 + 22];   // 22: half the pin
    map.easeTo({ center: [point.lon, point.lat], zoom: Math.max(map.getZoom(), 13), offset });
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
      // Over plain http (other than localhost) browsers report PERMISSION_DENIED, so check the context first.
      (err) => setLocError(!window.isSecureContext ? "Location needs a secure page: open the planner over https://." :
        err.code === err.PERMISSION_DENIED ? "Location permission was refused." :
        "Your location could not be found. On a laptop it is often approximate: search for the place or pick it on the map."),
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
  const [directionStep, setDirectionStep] = useState(false);
  const pickingDirection = v ? editor === "direction" : directionStep;
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

  // A place found from the top bar: start there, run towards it, add it as a stop, or just look at it.
  const onPlace = async (p: Place, action: PlaceAction) => {
    const point = placePoint(p);
    if (action === "start") setStart(point);
    else if (action === "towards") onEdit({ kind: "towards_place", place: point });
    else if (action === "show") map?.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 14) });
    else {
      try {
        const out = await featureItem("checkpoint", "place", p.place_id, p);
        const e: Edit = { kind: "add", list: "checkpoints", item: out.checkpoint! };
        const why = blocked(request as RouteRequest, e);
        if (why) setToast(why);
        else onEdit(e);
      } catch (x) {
        setToast(String((x as Error).message));
      }
    }
  };

  const menu = (
    <>
      {v && (
        <section className="menu-section" aria-labelledby="menu-versions">
          <h3 id="menu-versions" className="t-heading">Versions</h3>
          <p className="t-body-s muted">This is version {v.version} of the plan.</p>
          <div className="row">
            <Button icon="undo" onClick={plan.undo} disabled={!plan.canUndo || solving} data-testid="menu-undo">Undo</Button>
            <Button icon="redo" onClick={plan.redo} disabled={!plan.canRedo || solving} data-testid="menu-redo">Redo</Button>
          </div>
        </section>
      )}
      <nav className="menu-section menu-links" aria-label="Pages">
        <Link className="btn btn-block" href="/routes">Saved routes</Link>
        <Link className="btn btn-block" href="/about">About GATHO</Link>
      </nav>
      <section className="menu-section" aria-label="Pace"><PaceSetting pace={pace} onChange={setPace} /></section>
      <section className="menu-section" aria-label="Theme"><ThemeToggle /></section>
      <section className="menu-section" aria-labelledby="menu-roads">
        <h3 id="menu-roads" className="t-heading">Roads and paths</h3>
        <PathsToggle request={request as RouteRequest} onEdit={onEdit} near={near} live={!!v} />
      </section>
      <p className="t-meta muted">Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · basemap by Protomaps</p>
    </>
  );

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
      <MapView onReady={setMap} theme={theme} pointing={pickingDirection ? pointing(request) : null} />
      <TopBar setupMode={!v} near={near} canAddStop={!!v} onPlace={onPlace} menu={menu} />
      <BottomSheet snap={sheet} onSnap={setSheet} label="Plan your run" halfRatio={v ? 0.5 : 0.64}
        banner={toast && (
          <Snackbar testId="diff-toast" onDismiss={() => setToast(null)}
            actionLabel={v && plan.canUndo && !solving ? "Undo" : undefined} actionIcon="undo" onAction={plan.undo}>
            {toast}
          </Snackbar>
        )}>
          {/* what a peeked sheet shows first */}
          <StatusLine busy={plan.busy} onDismiss={plan.clearError} />
          {plan.opening && <OpeningNote state={plan.opening} onRetry={plan.retryOpening} />}
          {v && candidates[selected] && <PeekBar cand={candidates[selected]!} pace={pace} />}
          <HealthBanner trigger={plan.busy.kind === "error" ? plan.busy.error.code : null} />
          {v && <PlanChips request={v.request} attention={attention} onOpen={openChip} />}
          {/* the version number, for screen readers and the end-to-end tests; undo and redo are in the menu */}
          {v && <p className="history sr-only">Version {v.version}</p>}
          {v && (
            <>
              <OutcomePanel version={v} onPatch={plan.applyPatch} disabled={solving} />
              <RouteCards candidates={candidates} selected={selected} onSelect={setSelected} pace={pace}
                target={v.request.target_distance_m} explanation={v.explanation} versionKey={`${v.plan_id}/${v.version}`} />
              <StopsPanel request={v.request} version={v} selected={candidates[selected] ?? null} onEdit={onEdit} near={near} map={map}
                onMapPick={mapPick} />
              {candidates[selected] && <RouteDetail map={map} cand={candidates[selected]!} index={selected}
                onFirstKm={(routeId, [lon]) => setFirstKm({ routeId, lon })} />}
              {candidates[selected] && <SaveShare cand={candidates[selected]!} />}
            </>
          )}
          {/* Before the first route: the five setup steps. After it, every change goes through the chips. */}
          {!v && plan.opening !== "loading" && (
            <SetupFlow draft={draft} onEdit={onEdit} startControls={startControls} near={near} map={map} onDirectionStep={setDirectionStep} solving={solving}
              canPlan={canPlan} onPlan={() => draft.start && plan.create(draft as NewRouteRequest)} />
          )}
      </BottomSheet>
      {v && (
        <EditorDialog open={editor !== null} title={editor ? EDITOR_TITLE[editor] ?? "" : ""} onClose={() => setEditor(null)}
          testId="chip-editor">
          {editor === "start" && startControls}
          {editor === "distance" && <DistanceStepper request={v.request} onEdit={onEdit} near={near} live />}
          {editor === "type" && <RouteTypePicker request={v.request} onEdit={onEdit} near={near} live />}
          {editor === "direction" && <DirectionPicker request={v.request} onEdit={onEdit} near={near} map={map} live />}
          {editor === "paths" && <PathsToggle request={v.request} onEdit={onEdit} near={near} live />}
        </EditorDialog>
      )}
    </div>
  );
}

function StatusLine({ busy, onDismiss }: { busy: Busy; onDismiss: () => void }) {
  let text: string | null = null;
  if (busy.kind === "solving") text = "GATHO is planning...";
  if (busy.kind === "busy") text = busy.reason === "solver_busy"
    ? `Many runs are being planned right now. Trying again in ${busy.retryInS} s (attempt ${busy.attempt}).`
    : `Too many requests for a moment. Trying again in ${busy.retryInS} s.`;
  if (busy.kind === "waiting") text = busy.reason === "solve_timeout"
    ? "This one is taking longer than usual. It is still being worked on…"
    : "Finishing the previous change first…";
  return (
    <div aria-live="polite" className="status" data-testid="status" data-state={busy.kind}>
      {text && <p className="progress"><SneakerCycle />{text}</p>}
      {busy.kind === "error" && (
        <div role="alert" className="error-box" data-error={busy.error.code}>
          <p>{busy.error.message}</p>
          <button type="button" onClick={onDismiss}>OK</button>
        </div>
      )}
    </div>
  );
}

function OpeningNote({ state, onRetry }: { state: NonNullable<Opening>; onRetry: () => void }) {
  if (state === "loading") {
    return <p className="opening" role="status" data-testid="opening"><SneakerCycle />Opening your saved route…</p>;
  }
  return (
    <div className="opening-note" role="status" data-testid="opening-note" data-state={state}>
      {state === "gone" ? (
        <p className="t-body-s">That saved route can&apos;t be opened here. It may have been deleted, or saved on another device. You can plan a new run below.</p>
      ) : (
        <p className="t-body-s">That saved route didn&apos;t load. Check your connection.</p>
      )}
      <div className="row">
        {state === "failed" && <Button icon="redo" onClick={onRetry}>Try again</Button>}
        <Link className="btn btn-secondary" href="/routes">Saved routes</Link>
      </div>
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
