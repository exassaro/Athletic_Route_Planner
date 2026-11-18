"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { basemapStyle, KOZHIKODE } from "./basemap";

type Props = {
  onReady?: (map: MapLibreMap) => void;
  className?: string;
};

/** Full-size MapLibre map on the self-hosted basemap. MapLibre loads only in the browser. */
export function MapView({ onReady, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: MapLibreMap | null = null;
    let cancelled = false;
    (async () => {
      const [maplibregl, { Protocol }] = await Promise.all([import("maplibre-gl"), import("pmtiles")]);
      if (cancelled || !box.current) return;
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); // copied by scripts/copy-maplibre-worker.mjs
      const protocol = new Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);
      const m = new maplibregl.Map({
        container: box.current,
        style: basemapStyle(window.location.origin),
        center: KOZHIKODE,
        zoom: 12,
        attributionControl: false,
      });
      // OSM attribution always visible (Phase 5 amendment 3): never collapsed.
      m.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");
      m.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
      m.on("load", () => onReady?.(m));
      map = m;
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [onReady]);
  return <div ref={box} className={className} style={{ position: "absolute", inset: 0 }} data-testid="map" />;
}
