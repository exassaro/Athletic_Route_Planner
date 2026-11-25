"use client";
/**
 * The planner (section 13, Phase 5 amendments 4 to 6): a full-screen map with a bottom sheet on a phone and a
 * side panel on a desktop. Before the first solve the controls fill a draft; "Plan my run" creates the plan, and
 * from then on every control sends a patch and the screen shows what the API returns.
 *
 * It survives a refresh and Back (Phase 5e amendments 1 to 3): the address points at the plan, this tab keeps
 * the rest (src/restore), and only "Plan a new run" or closing the tab starts clean.
 */
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { KOZHIKODE } from "@/map/basemap";
import { MapView } from "@/map/MapView";
import { useRouteLayers } from "@/map/useRouteLayers";
import { useTheme } from "@/theme/useTheme";
import { pointing } from "@/plan/direction";
import { preferredCandidate } from "@/saved/preferred";
import { applyToDraft, blocked, patchFor, type Edit, type Point, type RouteRequest } from "@/plan/edits";
import { pace as formatPace, parsePace, signedKm } from "@/plan/format";
import { usePace } from "@/plan/pace";
import type { Place } from "@/plan/places";
import { mapIdsOf, olderMap, type MapIds } from "@/plan/mapIds";
import { MAX_TRIES } from "@/plan/planClient";
import { planClient, usePlan, type Busy, type Editing, type Kept, type Opening } from "@/plan/usePlan";
import { RESTORING } from "@/restore/boot";
import { MY_LOCATION, rebuildItems, serialise, type Draft, type RunPointer, type View } from "@/restore/draft";
import { clearTab, planAddress, readAddress, readTab, runText, storeRun, tabWriter } from "@/restore/tab";
import { patchSaved } from "@/saved/api";
import { ClearedMessage } from "./ClearedMessage";
import { EditingSave } from "./EditingSave";
import type { NewRouteRequest, Schemas } from "@/api/client";
import { Num } from "./Num";
import { PeekBar } from "./PeekBar";
import { RouteCards } from "./RouteCards";
import { DirectionPicker, DistanceStepper, PathsToggle, RouteTypePicker } from "./Controls";
import { OutcomePanel } from "./OutcomePanel";
import { PlaceSearch } from "./PlaceSearch";
import { LazyRouteDetail } from "./LazyRouteDetail";
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
const NEW_DRAFT: Draft = { route_type: "point_to_point", start: null, target_distance_m: 10000, direction: null };

function placePoint(p: Place): Point {
  return { lon: p.lon, lat: p.lat, label: p.label, place_id: p.place_id };
}

const NEW_VIEW: View = { center: KOZHIKODE, zoom: 12 };

/** Everything "Plan a new run" takes away. */
type Cleared = { plan: Kept; draft: Draft; step: number; seq: number; sheet: Snap; view: View | null; rebuild: boolean;
  /** A run in Follow mode. */ run: string | null };

export function Planner() {
  const plan = usePlan();
  const [pace, setPace] = usePace();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [picked, setPicked] = useState<{ key: string; index: number } | null>(null);
  const [sheet, setSheet] = useState<Snap>("half");
  const [picking, setPicking] = useState<null | "start">(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; delta?: number } | null>(null);
  /** After an update or a save as new; `undo` is what the saved route showed before. */
  const [savedNote, setSavedNote] = useState<{ text: string; undo?: Editing } | null>(null);
  const v = plan.version;
  const request: Draft = v ? v.request : draft;
  const solving = plan.busy.kind === "solving" || plan.busy.kind === "busy" || plan.busy.kind === "waiting";
  const candidates = useMemo(() => v?.candidates ?? [], [v]);

  // A new version starts at its first card; while a saved route is edited, at the saved route's own alternative.
  const versionKey = v ? `${v.plan_id}/${v.version}` : "";
  const selected = useMemo(() => {
    if (picked?.key === versionKey && picked.index < candidates.length) return picked.index;
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
  /** The plan whose view came back with it, so it is not fitted again. */
  const [keptView, setKeptView] = useState<string | null>(null);
  useRouteLayers(map, candidates, selected, solving, v ? `${v.plan_id}/${v.version}` : null, request, theme, facingWest, "", keptView);

  // The diff after every edit, as the API reports it ("+3.0 km, new end: X").
  useEffect(() => {
    if (!v?.diff) return;
    const d = v.diff;
    const parts: string[] = [];
    if (d.end_changed) parts.push(`new end: ${v.candidates[0]?.end.label ?? "unnamed road"}`);
    if (d.outcome.from !== d.outcome.to) parts.push(d.outcome.to === "ok" ? "route found" : d.outcome.to.replace(/_/g, " "));
    d.stops_added.forEach((s) => parts.push(`added ${s.label}`));
    d.stops_removed.forEach((s) => parts.push(`removed ${s.label}`));
    const fallback = v.candidates.length === 0 ? "Still no route: see what to change below" : "No change to the route";
    // It stays until the next change or until dismissed (no timer: it must be readable and its Undo reachable).
    const delta = d.length_delta_m ?? undefined;
    setToast({ text: parts.join(", ") || (delta === undefined ? fallback : ""), delta }); // eslint-disable-line react-hooks/set-state-in-effect
    setSavedNote(null);
  }, [v]);

  const onEdit = useCallback((e: Edit) => {
    if (plan.version) plan.edit(e);
    else setDraft((d) => {
      // The draft starts without the lists (the API fills its defaults); the first stop added before planning makes one.
      const base = e.kind === "add" && !(d as Record<string, unknown>)[e.list] ? { ...d, [e.list]: [] } : d;
      return applyToDraft(base, patchFor(base as RouteRequest, e));
    });
  }, [plan]);

  /** The map is centred on the runner's location, so its view may not be kept (Phase 5e amendment 2). */
  const atLocation = useRef(false);
  const setStart = useCallback((point: Point) => {
    atLocation.current = point.label === MY_LOCATION && !point.place_id;
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
      // The name is a nicety: the tapped point is the start, with or without an answer.
      const answered = await planClient().api.GET("/v1/places/reverse", { params: { query: { lon: lng, lat } } }).catch(() => null);
      const near = answered?.data?.place?.label;
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
      (pos) => setStart({ lon: pos.coords.longitude, lat: pos.coords.latitude, label: MY_LOCATION, place_id: null }),
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
        if (why) setToast({ text: why });
        else onEdit(e);
      } catch (x) {
        setToast({ text: String((x as Error).message) });
      }
    }
  };

  // ------------------------------------------------------------- surviving a refresh and Back (Phase 5e)
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(1);
  const [flow, setFlow] = useState(0);             // a new number: the setup opens again, on `step`
  const [located, setLocated] = useState(false);   // the start was the runner's location, which is not kept
  const [rebuild, setRebuild] = useState(false);   // the stops came back without their geometry
  const [mapNow, setMapNow] = useState<MapIds | null>(null);
  const [mapMade, setMapMade] = useState<{ key: string; ids: MapIds | null } | null>(null);
  const [cleared, setCleared] = useState<Cleared | null>(null);
  const view = useRef<View | null>(null);
  const jumpTo = useRef<View | null>(null);
  const before = useRef<RunPointer | null>(null);
  const [writer] = useState(tabWriter);
  const { open } = plan;

  // Before paint: what the address names, else what this tab holds. A restore reads; it never solves.
  useLayoutEffect(() => {
    const at = readAddress(window.location.search);
    const stored = readTab(Date.now());
    before.current = stored?.run ?? null;
    if (at?.kind === "edit") {
      open({ kind: "edit", id: at.id });           // asked for by name, so not what was on screen
    } else {
      const same = at ? stored?.run?.plan === at.run.plan && stored.run.version === at.run.version : true;
      const kept = same ? stored : null;
      if (kept) {
        /* eslint-disable react-hooks/set-state-in-effect -- storage is readable only after hydration */
        setDraft(kept.draft);
        setStep(kept.draft.start ? kept.step : 1);
        setLocated(kept.located);
        atLocation.current = kept.located;
        setRebuild(["checkpoints", "via", "must_use", "avoid"].some((l) => ((kept.draft as Record<string, unknown>)[l] as unknown[] | undefined)?.length));
        setSheet(kept.sheet);
        if (kept.run) setEditor(kept.editor);
        view.current = jumpTo.current = kept.view;
        // the setup opens again on the restored step. Only then: a remount replaces the server's first paint,
        // which made the largest paint wait for the scripts (Lighthouse, Phase 5d step 9)
        setFlow((n) => n + 1);
        /* eslint-enable react-hooks/set-state-in-effect */
      }
      const run = at?.run ?? kept?.run;
      if (run) {
        const key = `${run.plan}/${run.version}`;
        if (run.seq !== null) setPicked({ key, index: run.seq });
        if (kept?.view) setKeptView(key);
        open({ kind: "plan", plan: run.plan, version: run.version, edit: run.edit, history: kept?.run?.history ?? null });
      }
    }
    setReady(true);
  }, [open]);

  useLayoutEffect(() => {
    if (!ready || !document.documentElement.hasAttribute(RESTORING)) return;
    void document.querySelector<HTMLElement>(".sheet")?.offsetHeight;      // placed first, so it does not slide
    document.documentElement.removeAttribute(RESTORING);
  }, [ready]);

  const pointer = useMemo<RunPointer | null>(() => (v
    ? { plan: v.plan_id, version: v.version, seq: selected, edit: plan.editingSavedId, history: plan.history }
    : null), [v, selected, plan.editingSavedId, plan.history]);

  // The address follows the plan, the version and the card, without a navigation
  useEffect(() => {
    if (!ready) return;
    const now = window.location.pathname + window.location.search;
    let next = now;
    if (pointer) next = planAddress(pointer);
    else if (!plan.target || (plan.target.kind === "plan" && plan.opening === "gone")) next = "/";
    if (next !== now) window.history.replaceState(null, "", next);
  }, [ready, pointer, plan.target, plan.opening]);

  const snapshot = useRef<() => string | null>(() => null);
  useEffect(() => {
    snapshot.current = () => {
      const { target, opening } = plan;
      // still opening, or failed to: the pointer is kept for Try again
      let run = pointer;
      if (!run && target?.kind === "plan" && opening !== "gone") {
        run = { plan: target.plan, version: target.version, seq: picked?.index ?? 0, edit: target.edit,
          history: target.history ?? { versions: [target.version], at: 0 } };
      }
      if (!run && target?.kind === "edit") run = before.current;
      if (!run && !draft.start && !draft.direction && step === 1 && !located
        && draft.target_distance_m === NEW_DRAFT.target_distance_m && draft.route_type === NEW_DRAFT.route_type
        && !draft.preferences) return null;
      return serialise({ run, draft: v ? (v.request as Draft) : draft, located, step, sheet: picking ? "half" : sheet,
        editor, view: atLocation.current ? null : view.current }, Date.now());
    };
    if (ready) writer.schedule(() => snapshot.current());
  }, [ready, writer, pointer, plan, picked, v, draft, step, located, sheet, picking, editor]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") writer.flush();
    };
    window.addEventListener("pagehide", writer.flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", writer.flush);
      document.removeEventListener("visibilitychange", onHide);
      writer.flush();                              // to another page of the app
    };
  }, [writer]);

  // The map: back where it was, with no animation, and its view kept at the end of each move
  useEffect(() => {
    if (!map) return;
    if (jumpTo.current) map.jumpTo(jumpTo.current);
    jumpTo.current = null;
    const onMoved = () => {
      const { lng, lat } = map.getCenter();
      view.current = { center: [Number(lng.toFixed(6)), Number(lat.toFixed(6))], zoom: Number(map.getZoom().toFixed(2)) };
      writer.schedule(() => snapshot.current());
    };
    map.on("moveend", onMoved);
    return () => {
      map.off("moveend", onMoved);
    };
  }, [map, writer]);

  const planIt = async () => {
    if (!draft.start) return;
    let send = draft;
    if (rebuild) {
      try {
        send = await rebuildItems(draft, featureItem);
      } catch (e) {
        return setToast({ text: `Your stops couldn't be loaded again, so nothing was planned. ${(e as Error).message}` });
      }
      setDraft(send);
      setRebuild(false);
    }
    setCleared(null);
    await plan.create(send as NewRouteRequest);
  };

  const planNewRun = () => {
    setCleared({ plan: plan.clear(), draft: v ? (v.request as Draft) : draft, step, seq: selected, sheet,
      view: view.current, rebuild: v ? false : rebuild, run: runText() });
    setDraft(NEW_DRAFT);
    setStep(1);
    setFlow((n) => n + 1);
    setPicked(null);
    setPicking(null);
    setEditor(null);
    setLocated(false);
    setRebuild(false);
    setKeptView(null);
    setToast(null);
    setSavedNote(null);
    setSheet("half");
    before.current = null;
    view.current = null;
    atLocation.current = false;
    map?.jumpTo(NEW_VIEW);
    clearTab();
    storeRun(null);
    // the button that had the focus is gone
    setTimeout(() => document.querySelector<HTMLElement>(".setup-title")?.focus({ preventScroll: true }));
  };

  const undoClear = (was: Cleared) => {
    setCleared(null);
    storeRun(was.run);
    setDraft(was.draft);
    setStep(was.step);
    setFlow((n) => n + 1);
    setRebuild(was.rebuild);
    setSheet(was.sheet);
    view.current = was.view;
    const kept = was.plan.version;
    if (kept) {
      const key = `${kept.plan_id}/${kept.version}`;
      setPicked({ key, index: was.seq });
      if (was.view) setKeptView(key);
    }
    if (was.view) map?.jumpTo(was.view);
    plan.putBack(was.plan);
  };

  const anythingPlanned = !!v || !!draft.start || step > 1 || !!plan.opening;
  const openingRun = plan.target?.kind === "plan";
  const restored = !!v && versionKey === plan.restoredKey;
  useEffect(() => {
    if (!restored || !v) return;
    let live = true;
    void mapIdsOf(v.builds).then((ids) => { if (live) setMapMade({ key: versionKey, ids }); });
    return () => { live = false; };
  }, [restored, v, versionKey]);
  const onOlderMap = restored && mapMade?.key === versionKey && olderMap(mapMade.ids, mapNow);

  const menu = (closeMenu: () => void) => (
    <>
      {anythingPlanned && (
        <Button block icon="plus" onClick={() => { closeMenu(); planNewRun(); }} data-testid="menu-new-run">Plan a new run</Button>
      )}
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
        <Link className="btn btn-block" href="/routes#another-device" data-testid="menu-link-device">Use on another device</Link>
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

  const { setEditing } = plan;
  const onUpdated = (next: Editing, previous: Editing) => {
    setEditing(next);
    setToast(null);
    setSavedNote({ text: `Updated ${next.saved.name ?? "this route"}.`, undo: previous });
  };
  const undoUpdate = async (previous: Editing) => {
    try {
      const out = await patchSaved(plan.client, previous.saved.saved_id, { route_id: previous.saved.route_id });
      setEditing({ ...previous, saved: out });
      setSavedNote({ text: "Update undone. The share link shows the earlier route again." });
    } catch {
      setSavedNote({ text: "Could not undo. Try again.", undo: previous });
    }
  };
  const onSavedAsNew = (next: Editing) => {
    setEditing(next);
    setToast(null);
    // the address follows what is edited, so a reload opens the new one
    setSavedNote({ text: `Saved ${next.saved.name ?? "it"} as a new route.` });
  };

  const startControls = (
    <div className="start-field">
      {!v && located && !request.start && (
        <p className="t-body-s muted" data-testid="start-not-kept">
          Your start was your location, which GATHO doesn&apos;t keep. Tap My location again.
        </p>
      )}
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
        action={v && <Button variant="secondary" icon="plus" onClick={planNewRun} data-testid="new-run">New run</Button>}
        banner={cleared ? (
          <ClearedMessage onUndo={() => undoClear(cleared)} onGone={() => setCleared(null)} />
        ) : savedNote ? (
          <Snackbar testId="saved-toast" onDismiss={() => setSavedNote(null)} actionIcon="undo"
            actionLabel={savedNote.undo ? "Undo" : undefined} onAction={() => savedNote.undo && undoUpdate(savedNote.undo)}>
            {savedNote.text}
          </Snackbar>
        ) : toast && (
          <Snackbar testId="diff-toast" onDismiss={() => setToast(null)}
            actionLabel={v && plan.canUndo && !solving ? "Undo" : undefined} actionIcon="undo" onAction={plan.undo}>
            {toast.delta !== undefined && <><Num value={toast.delta} format={(m) => signedKm(m)} field="length_delta_m" />{toast.text && ", "}</>}
            {toast.text}
          </Snackbar>
        )}>
          {/* what a peeked sheet shows first */}
          <StatusLine busy={plan.busy} onDismiss={plan.clearError} onCancel={plan.cancelWaiting} />
          {plan.opening && (openingRun
            ? <RestoringNote reason={plan.openError} state={plan.opening} onRetry={plan.retryOpening} />
            : <OpeningNote reason={plan.openError} state={plan.opening} onRetry={plan.retryOpening} />)}
          {v && candidates[selected] && <PeekBar cand={candidates[selected]!} pace={pace} />}
          <HealthBanner trigger={plan.busy.kind === "error" ? plan.busy.error.code : null} onMap={setMapNow} />
          {onOlderMap && (
            <p className="t-body-s older-map" role="status" data-testid="older-map">
              Built on an older map. Changing anything plans it again on the current one.
            </p>
          )}
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
              {candidates[selected] && <LazyRouteDetail map={map} cand={candidates[selected]!} index={selected}
                onFirstKm={(routeId, [lon]) => setFirstKm({ routeId, lon })} />}
              {candidates[selected] && <SaveShare cand={candidates[selected]!} control={plan.editing && (
                <EditingSave key={plan.editingSavedId} editing={plan.editing} request={v.request} cand={candidates[selected]!}
                  solving={solving} onUpdated={onUpdated} onSavedAsNew={onSavedAsNew} />
              )} />}
            </>
          )}
          {/* Before the first route: the five setup steps. After it, every change goes through the chips. */}
          {!v && plan.opening !== "loading" && (
            <SetupFlow key={flow} draft={draft} onEdit={onEdit} startControls={startControls} near={near} map={map}
              onDirectionStep={setDirectionStep} solving={solving} canPlan={canPlan} onPlan={planIt} initialStep={step}
              // not before the restore: the first mount would report step 1 over the restored one
              onStep={ready ? setStep : undefined} />
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

/** Seconds left until `until` (ms since the epoch), updated every second while there is one. */
function useSecondsLeft(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now()); // eslint-disable-line react-hooks/set-state-in-effect
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * What the API is doing, in words (Step 9 amendment 7): planning, a busy solver with a live countdown and Cancel,
 * a slow solve, or a failure with its reason. Never a blank screen: the plan and the form stay as they were.
 */
export function StatusLine({ busy, onDismiss, onCancel }: { busy: Busy; onDismiss: () => void; onCancel: () => void }) {
  const left = useSecondsLeft(busy.kind === "busy" ? busy.until : null);
  let text: string | null = null;
  if (busy.kind === "solving") text = "GATHO is planning...";
  if (busy.kind === "busy") {
    text = `Lots of runners planning right now. Retrying in ${left} second${left === 1 ? "" : "s"}` +
      (busy.attempt > 1 ? ` (try ${busy.attempt + 1} of ${MAX_TRIES}).` : ".");
  }
  if (busy.kind === "waiting") text = busy.reason === "solve_timeout"
    ? "This one is taking longer than usual. It is still being worked on…"
    : "Finishing the previous change first…";
  return (
    <div aria-live="polite" className="status" data-testid="status" data-state={busy.kind}>
      {text && <p className="progress"><SneakerCycle />{text}</p>}
      {busy.kind === "busy" && (
        <div className="row"><Button onClick={onCancel} data-testid="status-cancel">Cancel</Button></div>
      )}
      {busy.kind === "error" && (
        <div role="alert" className="error-box" data-error={busy.error.code}>
          <p>{busy.error.message}</p>
          <button type="button" onClick={onDismiss}>OK</button>
        </div>
      )}
    </div>
  );
}

function OpeningNote({ state, reason, onRetry }: { state: NonNullable<Opening>; reason: string; onRetry: () => void }) {
  if (state === "loading") {
    return <p className="opening" role="status" data-testid="opening"><SneakerCycle />Opening your saved route…</p>;
  }
  return (
    <div className="opening-note" role="status" data-testid="opening-note" data-state={state}>
      {state === "gone" ? (
        <p className="t-body-s">That saved route can&apos;t be opened here. It may have been deleted, or saved on another device. You can plan a new run below.</p>
      ) : (
        <p className="t-body-s">That saved route didn&apos;t load. {reason}</p>
      )}
      <div className="row">
        {state === "failed" && <Button icon="redo" onClick={onRetry}>Try again</Button>}
        <Link className="btn btn-secondary" href="/routes">Saved routes</Link>
      </div>
    </div>
  );
}

/** A plan being read back after a refresh or Back (Phase 5e amendment 2). */
function RestoringNote({ state, reason, onRetry }: { state: NonNullable<Opening>; reason: string; onRetry: () => void }) {
  if (state === "loading") {
    return (
      <div role="status" data-testid="restoring">
        <div className="peek-bar restoring-bar" aria-hidden="true">
          {["distance", "time", "climb"].map((label) => (
            <div key={label} className="peek-stat"><span className="skeleton" /><span className="t-meta muted">{label}</span></div>
          ))}
        </div>
        <p className="t-body-s muted">Getting your run back…</p>
      </div>
    );
  }
  return (
    <div className="opening-note" role="status" data-testid="restoring-note" data-state={state}>
      {state === "gone"
        ? <p className="t-body-s">That run is no longer available</p>
        : <p className="t-body-s">Your run didn&apos;t load. {reason}</p>}
      {state === "failed" && <div className="row"><Button icon="redo" onClick={onRetry}>Try again</Button></div>}
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
