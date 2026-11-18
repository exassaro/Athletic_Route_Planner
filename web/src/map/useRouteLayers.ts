"use client";
/**
 * Draws the version's candidates on the map (section 13: selected 6 px, others 3 px and muted; a colour and a
 * dash pattern per candidate), numbered stop pins where the selected route meets them, the start, and the end
 * ("End (auto)"). Geometry and positions are the API's; nothing is measured here.
 */
import { useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { Schemas } from "@/api/client";
import { km } from "@/plan/format";
import { lineStyle } from "@/plan/routeStyle";

type Candidate = Schemas["CandidateOut"];
const PREFIX = "cand-";

function pin(text: string, cls: string, title: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `pin ${cls}`;
  el.textContent = text;
  el.title = title;
  el.setAttribute("aria-label", title);
  return el;
}

type Requested = { start: { lon: number; lat: number; label?: string | null } | null;
  checkpoints?: { lon: number; lat: number; label: string }[] | null };

export function useRouteLayers(map: MapLibreMap | null, candidates: Candidate[], selected: number, dimmed: boolean,
  fitKey: string | null, request: Requested | null = null) {
  const markers = useRef<Marker[]>([]);
  const drawn = useRef(0);

  useEffect(() => {
    if (!map) return;
    const style = map.getStyle();
    // remove what an earlier version drew
    for (const l of style.layers ?? []) if (l.id.startsWith(PREFIX)) map.removeLayer(l.id);
    for (let i = 0; i < drawn.current; i++) if (map.getSource(`${PREFIX}${i}`)) map.removeSource(`${PREFIX}${i}`);
    const order = candidates.map((_, i) => i).filter((i) => i !== selected);
    if (selected >= 0 && selected < candidates.length) order.push(selected);       // selected on top
    candidates.forEach((c, i) => {
      map.addSource(`${PREFIX}${i}`, {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c.geometry } },
      });
    });
    for (const i of order) {
      const c = candidates[i]!;
      const s = lineStyle(c.label, c.option, i);
      const on = i === selected;
      const opacity = (on ? 1 : 0.55) * (dimmed ? 0.4 : 1);
      map.addLayer({ id: `${PREFIX}${i}-casing`, type: "line", source: `${PREFIX}${i}`,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": on ? 9 : 5, "line-opacity": opacity } });
      map.addLayer({ id: `${PREFIX}${i}`, type: "line", source: `${PREFIX}${i}`,
        layout: { "line-join": "round", "line-cap": s.dash ? "butt" : "round" },
        paint: { "line-color": s.color, "line-width": on ? 6 : 3, "line-opacity": opacity,
          ...(s.dash ? { "line-dasharray": s.dash } : {}) } });
    }
    drawn.current = candidates.length;
  }, [map, candidates, selected, dimmed]);

  // Pins for the selected route
  useEffect(() => {
    if (!map) return;
    let live = true;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (!live) return;
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      const c = candidates[selected];
      if (!c) {
        // No route (a conflict, or before the first solve): the start and the stops as asked, never a blank map.
        if (request?.start) markers.current.push(new maplibregl.Marker({
          element: pin("S", "start", `Start: ${request.start.label ?? ""}`) }).setLngLat([request.start.lon, request.start.lat]).addTo(map));
        (request?.checkpoints ?? []).forEach((cp, k) => markers.current.push(new maplibregl.Marker({
          element: pin(String(k + 1), "stop asked", `${k + 1}. ${cp.label}`) }).setLngLat([cp.lon, cp.lat]).addTo(map)));
        return;
      }
      let n = 0;
      for (const stop of c.stops ?? []) {
        if (stop.role === "start") {
          markers.current.push(new maplibregl.Marker({ element: pin("S", "start", `Start: ${stop.label ?? ""}`) })
            .setLngLat([stop.snapped_lon, stop.snapped_lat]).addTo(map));
        } else if (stop.role === "checkpoint") {
          n += 1;
          markers.current.push(new maplibregl.Marker({
            element: pin(String(n), "stop", `${n}. ${stop.label ?? "Stop"} at ${km(stop.at_m)}`),
          }).setLngLat([stop.snapped_lon, stop.snapped_lat]).addTo(map));
        }
      }
      const auto = c.end.kind !== "fixed" && c.end.kind !== "start";
      if (c.end.kind !== "start") {
        markers.current.push(new maplibregl.Marker({
          element: pin("⚑", "end", `${auto ? "End (auto)" : "End"}: ${c.end.label ?? "unnamed road"}`),
        }).setLngLat([c.end.lon, c.end.lat]).addTo(map));
      }
    })();
    return () => {
      live = false;
    };
  }, [map, candidates, selected, request]);

  // Fit the view when a new version arrives (not when only the selection changes)
  useEffect(() => {
    if (!map || !fitKey || candidates.length === 0) return;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      const b = new maplibregl.LngLatBounds();
      for (const c of candidates) for (const p of c.geometry) b.extend(p as [number, number]);
      const wide = window.matchMedia("(min-width: 900px)").matches;
      map.fitBounds(b, { padding: wide ? { top: 40, bottom: 40, left: 460, right: 60 } : { top: 60, bottom: 300, left: 30, right: 30 },
        duration: 600, maxZoom: 15 });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
}

export function setPoint(map: MapLibreMap, id: string, lonlat: [number, number] | null) {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  const data = lonlat ? { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: lonlat } }
    : { type: "FeatureCollection" as const, features: [] };
  if (src) src.setData(data);
  else {
    map.addSource(id, { type: "geojson", data });
    map.addLayer({ id, type: "circle", source: id,
      paint: { "circle-radius": 7, "circle-color": "#d1495b", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
  }
}
