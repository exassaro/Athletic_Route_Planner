"use client";
/**
 * The shared route on the self-hosted basemap, read-only (Phase 5b amendment 6): the same markers as the planner,
 * with the start pin resting (it hops when tapped, amendment 13). Geometry and positions from the API.
 */
import { useEffect, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import type { Schemas } from "@/api/client";
import { km } from "@/plan/format";
import { ROUTE_COLORS } from "@/plan/routeStyle";
import { endFlag, flagPointsLeft, startPin, stopPin } from "@/map/markers";
import { MapView } from "@/map/MapView";
import { useTheme } from "@/theme/useTheme";

export function ShareMap({ route }: { route: Schemas["RouteFeature"] }) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [theme] = useTheme();
  useEffect(() => {
    if (!map) return;
    const markers: Marker[] = [];
    let live = true;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (!live) return;
      const c = ROUTE_COLORS[theme];
      const coords = route.geometry.coordinates.map((p) => [p[0], p[1]] as [number, number]);
      if (!map.getSource("shared")) {
        map.addSource("shared", { type: "geojson", data: { type: "Feature", properties: {},
          geometry: { type: "LineString", coordinates: coords } } });
        map.addLayer({ id: "shared-casing", type: "line", source: "shared", paint: { "line-color": c.casing, "line-width": 10 },
          layout: { "line-join": "round", "line-cap": "round" } });
        map.addLayer({ id: "shared", type: "line", source: "shared", paint: { "line-color": c.primary, "line-width": 6 },
          layout: { "line-join": "round", "line-cap": "round" } });
        const b = new maplibregl.LngLatBounds();
        coords.forEach((p) => b.extend(p));
        map.fitBounds(b, { padding: 40, duration: 0 });
      }
      map.setPaintProperty("shared-casing", "line-color", c.casing);
      map.setPaintProperty("shared", "line-color", c.primary);
      const props = route.properties as Schemas["CandidateOut"];
      // Facing: the first segment's direction (the share response carries no km marks).
      const west = coords.length > 1 && coords[1]![0] < coords[0]![0];
      let n = 0;
      for (const s of props.stops ?? []) {
        if (s.role === "start") {
          const pin = startPin(s.label ?? "the start", west);
          markers.push(new maplibregl.Marker({ element: pin.el, anchor: "bottom", offset: pin.offset }).setLngLat([s.snapped_lon, s.snapped_lat]).addTo(map));
        } else if (s.role === "checkpoint") {
          n += 1;
          markers.push(new maplibregl.Marker({ element: stopPin(String(n), `Stop ${n}: ${s.label ?? "a stop"}, at ${km(s.at_m)}`, { must: s.must_reach }) })
            .setLngLat([s.snapped_lon, s.snapped_lat]).addTo(map));
        }
      }
      if (props.end && props.end.kind !== "start") {
        const flag = endFlag(`End: ${props.end.label ?? "unnamed road"}`,
          flagPointsLeft(map.project([props.end.lon, props.end.lat]), coords.map((p) => map.project(p))));
        markers.push(new maplibregl.Marker({ element: flag.el, anchor: flag.anchor, offset: flag.offset })
          .setLngLat([props.end.lon, props.end.lat]).addTo(map));
      }
    })();
    return () => {
      live = false;
      markers.forEach((m) => m.remove());
    };
  }, [map, route, theme]);
  return <MapView onReady={setMap} theme={theme} />;
}
