"use client";
/** The shared route on the self-hosted basemap, read-only. Geometry from the API. */
import { useEffect, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Schemas } from "@/api/client";
import { MapView } from "@/map/MapView";

export function ShareMap({ route }: { route: Schemas["RouteFeature"] }) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  useEffect(() => {
    if (!map) return;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      const coords = route.geometry.coordinates.map((c) => [c[0], c[1]] as [number, number]);
      map.addSource("shared", { type: "geojson", data: { type: "Feature", properties: {},
        geometry: { type: "LineString", coordinates: coords } } });
      map.addLayer({ id: "shared-casing", type: "line", source: "shared", paint: { "line-color": "#fff", "line-width": 9 },
        layout: { "line-join": "round", "line-cap": "round" } });
      map.addLayer({ id: "shared", type: "line", source: "shared", paint: { "line-color": "#0f6b4f", "line-width": 6 },
        layout: { "line-join": "round", "line-cap": "round" } });
      const b = new maplibregl.LngLatBounds();
      coords.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: 40, duration: 0 });
      const props = route.properties as Schemas["CandidateOut"];
      let n = 0;
      for (const s of props.stops ?? []) {
        if (s.role !== "start" && s.role !== "checkpoint") continue;
        const el = document.createElement("div");
        el.className = `pin ${s.role === "start" ? "start" : "stop"}`;
        el.textContent = s.role === "start" ? "S" : String(++n);
        el.title = s.label ?? "";
        new maplibregl.Marker({ element: el }).setLngLat([s.snapped_lon, s.snapped_lat]).addTo(map);
      }
    })();
  }, [map, route]);
  return <MapView onReady={setMap} />;
}
