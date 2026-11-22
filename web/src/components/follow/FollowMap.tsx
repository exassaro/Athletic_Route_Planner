"use client";
/**
 * The Follow map (blueprint Phase 5d amendments 7, 12 and 14). It is its own component, not MapView, so that no
 * path in it can reach the tile archive once a run moves the camera: the corridor is fetched by the route alone
 * as soon as the route is known, and the map is served from that memory.
 *
 * The sneaker stands still; the dot is the runner. The camera follows the dot until the runner drags the map.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker, VectorTileSource } from "maplibre-gl";
import { IconButton, Button } from "@/components/ui";
import type { Line } from "@/follow/line";
import type { Run } from "@/follow/run";
import { Compass } from "@/map/Compass";
import { ATTRIBUTION, BASEMAP_SOURCE, basemapUrl, keepDrawn } from "@/map/basemap";
import { corridorTiles, loadCorridor, MIN_ZOOM, tileFromMemory } from "@/map/corridor";
import { addFollowLayers, paintFollowLayers, setHere, setProgress } from "@/map/followLayers";
import { CORRIDOR_PROTOCOL, corridorTileUrl, followStyle } from "@/map/followStyle";
import { endFlag, flagPointsLeft, stillStartPin } from "@/map/markers";
import { setObstacles, type Obstacle } from "@/map/overlays";
import type { Theme } from "@/theme/theme";

const RUN_ZOOM = 16;
const RETRY_MS = 500;
const SAME_PLACE_M = 5;
// the room the labels leave for each marker (Phase 5b amendment 14)
const PIN_BOX = { w: 52, h: 44, anchor: "bottom" } as const;
const FLAG_BOX = { w: 30, h: 38 } as const;

type Props = {
  line: Line;
  doneM: number;
  here: Run["here"];
  following: boolean;
  theme: Theme;
  /** Battery saver (amendment 14): the dark map, and nothing on it animates. */
  saver: boolean;
};
type Corridor = { state: "loading" | "ready" | "failed"; tiles: number };

/** The middle of the part of the map the sheet and the top bar leave free, as an offset from the screen's. */
function freeMiddle(): [number, number] {
  const sheet = document.querySelector(".follow .sheet")?.getBoundingClientRect();
  if (!sheet) return [0, 0];
  if (window.matchMedia("(min-width: 900px)").matches) return [sheet.width / 2, 0];
  return [0, (64 + sheet.top) / 2 - window.innerHeight / 2];
}

export function FollowMap({ line, doneM, here, following, theme, saver }: Props) {
  const look: Theme = saver ? "dark" : theme;
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [broken, setBroken] = useState(false);
  const [corridor, setCorridor] = useState<Corridor>({ state: "loading", tiles: 0 });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [free, setFree] = useState(false);         // the runner moved the map: it stops following the dot
  const tiles = useRef<Map<string, Uint8Array>>(new Map());
  const load = useRef(0);
  const shown = useRef({ look, sprite: theme });
  const taken = useRef<Obstacle[]>([]);
  const zoomed = useRef(false);

  // The corridor: from the route alone, and never waiting for the map or the position
  useEffect(() => {
    const stop = new AbortController();
    (async () => {
      setCorridor({ state: "loading", tiles: 0 });
      const list = corridorTiles(line.points);
      for (let tries = 0; tries < 2; tries++) {
        try {
          const { basemapArchive } = await import("@/map/tiles");
          if (stop.signal.aborted) return;
          const got = await loadCorridor(basemapArchive(basemapUrl(window.location.origin)), list, stop.signal);
          tiles.current = got;
          load.current += 1;
          setCorridor({ state: "ready", tiles: got.size });
          return;
        } catch (e) {
          if (stop.signal.aborted) return;
          // one retry, as everywhere (Phase 5b amendment 12)
          if (tries === 0) await new Promise((r) => setTimeout(r, RETRY_MS));
          else {
            console.error("The route's map tiles didn't load.", (e as Error).name);
            setCorridor({ state: "failed", tiles: 0 });
          }
        }
      }
    })();
    return () => stop.abort();
  }, [line, loadAttempt]);

  // The map
  useEffect(() => {
    let cancelled = false;
    let m: MapLibreMap | null = null;
    const markers: Marker[] = [];
    let release: (() => void) | null = null;
    (async () => {
      const maplibregl = await import("maplibre-gl").catch(() => null);
      if (cancelled || !box.current) return;
      if (!maplibregl) return setBroken(true);
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); // copied by scripts/copy-maplibre-worker.mjs
      maplibregl.addProtocol(CORRIDOR_PROTOCOL, async (request) => ({ data: tileFromMemory(tiles.current, request.url) }));
      release = () => maplibregl.removeProtocol(CORRIDOR_PROTOCOL);
      const bounds = new maplibregl.LngLatBounds();
      for (const point of line.points) bounds.extend([point[0], point[1]]);
      let made: MapLibreMap;
      try {
        made = new maplibregl.Map({
          container: box.current,
          style: followStyle(window.location.origin, shown.current.look, load.current, shown.current.sprite),
          bounds,
          fitBoundsOptions: { padding: 48 },
          minZoom: MIN_ZOOM,
          dragRotate: false,
          attributionControl: false,
        });
      } catch {
        return setBroken(true);      // no WebGL: the numbers and cues still work
      }
      m = made;
      made.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: ATTRIBUTION }), "bottom-right");
      (window as unknown as { athleteMap?: MapLibreMap }).athleteMap = made;     // for the end-to-end tests, as MapView

      made.on("load", () => {
        if (cancelled) return;
        addFollowLayers(made);
        paintFollowLayers(made, shown.current.look);
        const first = line.points[0]!;
        const last = line.points[line.points.length - 1]!;
        const pin = stillStartPin("the start", line.points[1]![0] < first[0]);
        markers.push(new maplibregl.Marker({ element: pin.el, anchor: "bottom", offset: pin.offset })
          .setLngLat([first[0], first[1]]).addTo(made));
        taken.current = [{ at: [first[0], first[1]], ...PIN_BOX }];
        const [endX, endY] = line.flat[line.flat.length - 1]!;
        if (Math.hypot(endX, endY) > SAME_PLACE_M) {        // a loop's end is its start
          const at: [number, number] = [last[0], last[1]];
          const flag = endFlag("End", flagPointsLeft(made.project(at), line.points.map((p) => made.project([p[0], p[1]]))));
          markers.push(new maplibregl.Marker({ element: flag.el, anchor: flag.anchor, offset: flag.offset }).setLngLat(at).addTo(made));
          taken.current.push({ at, ...FLAG_BOX, anchor: flag.anchor });
        }
        setObstacles(made, taken.current);
        setMap(made);
      });
      made.on("dragstart", () => setFree(true));
    })();
    return () => {
      cancelled = true;
      markers.forEach((marker) => marker.remove());
      setMap(null);
      m?.remove();
      release?.();
    };
  }, [line, mapAttempt]);

  // Tiles that arrived after the map asked: ask memory again
  useEffect(() => {
    if (map && corridor.state === "ready") map.getSource<VectorTileSource>(BASEMAP_SOURCE)?.setTiles([corridorTileUrl(load.current)]);
  }, [map, corridor]);

  useEffect(() => {
    if (shown.current.look === look && shown.current.sprite === theme) return;
    shown.current = { look, sprite: theme };
    if (!map) return;
    map.setStyle(followStyle(window.location.origin, look, load.current, theme), { transformStyle: keepDrawn });
    paintFollowLayers(map, look);
    setObstacles(map, taken.current);      // their images belong to the style
  }, [map, theme, look]);

  useEffect(() => {
    if (map) setProgress(map, line, doneM);
  }, [map, line, doneM]);
  useEffect(() => {
    if (map) setHere(map, line, here);
  }, [map, line, here]);

  const fitRoute = useCallback(() => {
    if (!map) return;
    const lons = line.points.map((p) => p[0]);
    const lats = line.points.map((p) => p[1]);
    const sheet = document.querySelector(".follow .sheet")?.getBoundingClientRect();
    const wide = window.matchMedia("(min-width: 900px)").matches;
    const padding = !sheet ? 48 : wide
      ? { top: 48, bottom: 48, left: sheet.right + 48, right: 72 }
      : { top: 112, bottom: Math.max(0, window.innerHeight - sheet.top) + 36, left: 40, right: 64 };
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding, maxZoom: 15, duration: 0 });
  }, [map, line]);

  // The whole route before and after a run
  useEffect(() => {
    if (following) return;
    zoomed.current = false;
    // two frames, so the sheet of the new phase is laid out
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(fitRoute); });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [following, fitRoute]);

  // The camera follows the dot
  useEffect(() => {
    if (!map || !following || free || !here) return;
    const still = saver || !zoomed.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.easeTo({ center: [here.point[0], here.point[1]], offset: freeMiddle(), duration: still ? 0 : 400,
      ...(zoomed.current ? {} : { zoom: RUN_ZOOM }) });
    zoomed.current = true;
  }, [map, following, free, here, saver]);

  const centre = () => {
    zoomed.current = false;
    setFree(false);
  };
  const reload = () => {
    if (broken) {
      setBroken(false);
      setMapAttempt((n) => n + 1);
    }
    if (corridor.state === "failed") setLoadAttempt((n) => n + 1);
  };

  return (
    <>
      <div ref={box} className="map-box" style={{ position: "absolute", inset: 0 }} data-testid="map"
        data-corridor={corridor.state} data-corridor-tiles={corridor.tiles} data-drawn={map ? "yes" : "no"} />
      <Compass map={map} pointing={null} />
      {following && free && here && (
        <IconButton icon="gps" label="Centre on me" className="icon-btn follow-centre" onClick={centre} data-testid="centre" />
      )}
      {(broken || corridor.state === "failed") && (
        <div className="map-notice" role="status" data-testid="map-failed">
          <p className="t-body-s">The map background didn&apos;t load. Follow still works.</p>
          <Button icon="map" onClick={reload} data-testid="map-reload">Reload map</Button>
        </div>
      )}
    </>
  );
}
