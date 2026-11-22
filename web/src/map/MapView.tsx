"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, VectorTileSource } from "maplibre-gl";
import { Button } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";
import type { Theme } from "@/theme/theme";
import { Compass } from "./Compass";
import { ATTRIBUTION, BASEMAP_SOURCE, basemapStyle, basemapUrl, keepDrawn, KOZHIKODE } from "./basemap";

type Props = {
  onReady?: (map: MapLibreMap) => void;
  className?: string;
  interactive?: boolean;
  center?: [number, number];
  zoom?: number;
  theme?: Theme;
  /** The direction being picked, for the compass to mark (amendment 19). */
  pointing?: number | null;
};

/**
 * Full-size MapLibre map on the self-hosted basemap. MapLibre loads only in the browser. A theme change swaps the
 * basemap (light or dark flavour) and keeps what was drawn on it. When the tiles fail after one retry it says so,
 * with "Reload map", instead of staying blank (Phase 5b amendment 12).
 */
export function MapView({ onReady, className, interactive = true, center = KOZHIKODE, zoom = 12, theme = "light", pointing = null }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const shown = useRef<Theme>(theme);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retryTiles = useRef<(() => void) | null>(null);
  useEffect(() => {
    let m: MapLibreMap | null = null;
    let stopWatching: (() => void) | null = null;
    let cancelled = false;
    // Phase 5b amendment 10 (performance): MapLibre is the heaviest work on the page (parsing about 1 MB, creating
    // the WebGL context, building the style). It starts after the page has loaded and painted, in an idle moment
    // (at most 2 s later), so the sheet and its controls come first. Until then the box shows the map's land colour.
    const whenIdle = (fn: () => void) => {
      const idle = () => {
        if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(fn, { timeout: 2000 });
        else setTimeout(fn, 200);    // Safari before 18.4 has no requestIdleCallback
      };
      if (document.readyState === "complete") idle();
      else window.addEventListener("load", idle, { once: true });
    };
    whenIdle(async () => {
      if (cancelled) return;
      const libraries = await Promise.all([import("maplibre-gl"), import("pmtiles"), import("./tiles")]).catch((e: unknown) => {
        console.error(e);
        return null;
      });
      if (cancelled || !box.current) return;
      if (!libraries) return setFailed(true);
      const [maplibregl, { Protocol }, { basemapArchive, watchBasemap }] = libraries;
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); // copied by scripts/copy-maplibre-worker.mjs
      const protocol = new Protocol();
      const url = basemapUrl(window.location.origin);
      protocol.add(basemapArchive(url));
      maplibregl.addProtocol("pmtiles", protocol.tile);
      m = new maplibregl.Map({
        container: box.current,
        style: basemapStyle(window.location.origin, shown.current),
        center,
        zoom,
        interactive,
        attributionControl: false,
      });
      // OSM attribution always visible (Phase 5 amendment 3): never collapsed.
      m.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: ATTRIBUTION }), "bottom-right");
      if (interactive) m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");   // the compass is ours
      const ready = m;
      const watch = watchBasemap(m, () => {
        protocol.add(basemapArchive(url)); // a new archive: the failed one keeps its failed header
        ready.getSource<VectorTileSource>(BASEMAP_SOURCE)?.setUrl(`pmtiles://${url}`);
      }, setFailed);
      stopWatching = watch.stop;
      retryTiles.current = watch.retry;
      m.on("load", () => { setMap(ready); onReady?.(ready); });
      // The end-to-end tests tap the map at OSM coordinates through this (map.project): main map only.
      if (interactive) (window as unknown as { athleteMap?: MapLibreMap }).athleteMap = m;
    });
    return () => {
      cancelled = true;
      stopWatching?.();
      retryTiles.current = null;
      m?.remove();
    };
    // The map is made once (again only if MapLibre itself failed to load); later prop changes are applied by the
    // caller through the map object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  useEffect(() => {
    if (!map || shown.current === theme) return;
    shown.current = theme;
    map.setStyle(basemapStyle(window.location.origin, theme), { transformStyle: keepDrawn });
  }, [map, theme]);
  const reload = () => {
    if (retryTiles.current) return retryTiles.current();
    setFailed(false);
    setAttempt((n) => n + 1);
  };
  return (
    <>
      <div ref={box} className={`map-box${className ? ` ${className}` : ""}`} style={{ position: "absolute", inset: 0 }} data-testid="map" />
      {interactive && <Compass map={map} pointing={pointing} />}
      {!map && !failed && <div className="map-splash" aria-hidden="true" data-testid="splash"><Wordmark height={35} /></div>}
      {failed && (
        <div className="map-notice" role="status" data-testid="map-failed">
          <p className="t-body-s">The map background didn&apos;t load.</p>
          <Button icon="map" onClick={reload} data-testid="map-reload">Reload map</Button>
        </div>
      )}
    </>
  );
}
