"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Theme } from "@/theme/theme";
import { basemapStyle, keepDrawn, KOZHIKODE } from "./basemap";

type Props = {
  onReady?: (map: MapLibreMap) => void;
  className?: string;
  interactive?: boolean;
  center?: [number, number];
  zoom?: number;
  theme?: Theme;
};

/**
 * Full-size MapLibre map on the self-hosted basemap. MapLibre loads only in the browser. A theme change swaps the
 * basemap (light or dark flavour) and keeps what was drawn on it.
 */
export function MapView({ onReady, className, interactive = true, center = KOZHIKODE, zoom = 12, theme = "light" }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const shown = useRef<Theme>(theme);
  useEffect(() => {
    let m: MapLibreMap | null = null;
    let cancelled = false;
    (async () => {
      const [maplibregl, { Protocol }] = await Promise.all([import("maplibre-gl"), import("pmtiles")]);
      if (cancelled || !box.current) return;
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); // copied by scripts/copy-maplibre-worker.mjs
      const protocol = new Protocol();
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
      m.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");
      if (interactive) m.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
      const ready = m;
      m.on("load", () => { setMap(ready); onReady?.(ready); });
      // The end-to-end tests tap the map at OSM coordinates through this (map.project): main map only.
      if (interactive) (window as unknown as { athleteMap?: MapLibreMap }).athleteMap = m;
    })();
    return () => {
      cancelled = true;
      m?.remove();
    };
    // The map is made once; later prop changes are applied by the caller through the map object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!map || shown.current === theme) return;
    shown.current = theme;
    map.setStyle(basemapStyle(window.location.origin, theme), { transformStyle: keepDrawn });
  }, [map, theme]);
  return <div ref={box} className={className} style={{ position: "absolute", inset: 0 }} data-testid="map" />;
}
