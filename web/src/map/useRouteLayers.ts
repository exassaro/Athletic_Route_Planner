"use client";
/**
 * Draws the version's candidates on the map (section 13; Phase 5b amendments 4 and 6): the selected route on top
 * and thicker, the others thinner and muted, each with its colour and dash (routeStyle), over a casing. Markers for
 * the selected route: the hopping sneaker at the start (mirrored when the route starts westward), the stop discs
 * where the route meets each stop (grouped when they overlap on screen), the place's own point for a pass-near stop
 * the route passes at a distance (a diamond, joined by a dotted line), and the end flag. Geometry and positions are
 * the API's; nothing is measured here. The hop pauses while the map moves and while a solve runs.
 */
import { useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { Schemas } from "@/api/client";
import { km } from "@/plan/format";
import { lineStyle, ROUTE_COLORS } from "@/plan/routeStyle";
import type { Theme } from "@/theme/theme";
import { endFlag, groupByScreen, placePoint, startPin, stopPin } from "./markers";

type Candidate = Schemas["CandidateOut"];
type StopOnRoute = NonNullable<Candidate["stops"]>[number];
const PREFIX = "cand-";
const LINKS = "pin-links";
/** A place point is drawn when it is at least this far from where the route passes, on screen. */
const PLACE_GAP_PX = 16;

type Requested = { start: { lon: number; lat: number; label?: string | null } | null;
  checkpoints?: { lon: number; lat: number; label: string; must_reach?: boolean | null }[] | null };

type Line = [[number, number], [number, number]];

function setLinks(map: MapLibreMap, lines: Line[], color: string) {
  const data = { type: "FeatureCollection" as const,
    features: lines.map((l) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: l } })) };
  const src = map.getSource(LINKS) as GeoJSONSource | undefined;
  if (src) src.setData(data);
  else {
    map.addSource(LINKS, { type: "geojson", data });
    map.addLayer({ id: LINKS, type: "line", source: LINKS, paint: { "line-color": color, "line-width": 1.5, "line-dasharray": [2, 2] } });
  }
  map.setPaintProperty(LINKS, "line-color", color);
}

export function useRouteLayers(map: MapLibreMap | null, candidates: Candidate[], selected: number, dimmed: boolean,
  fitKey: string | null, request: Requested | null = null, theme: Theme = "light", facingWest = false) {
  const markers = useRef<Marker[]>([]);
  const drawn = useRef(0);

  // The route lines
  useEffect(() => {
    if (!map) return;
    const style = map.getStyle();
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
    const casing = ROUTE_COLORS[theme].casing;
    for (const i of order) {
      const c = candidates[i]!;
      const s = lineStyle(c.label, c.option, i, theme);
      const on = i === selected;
      const opacity = (on ? 1 : 0.6) * (dimmed ? 0.4 : 1);
      map.addLayer({ id: `${PREFIX}${i}-casing`, type: "line", source: `${PREFIX}${i}`,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": casing, "line-width": on ? 10 : 5, "line-opacity": opacity } });
      map.addLayer({ id: `${PREFIX}${i}`, type: "line", source: `${PREFIX}${i}`,
        layout: { "line-join": "round", "line-cap": s.dash ? "butt" : "round" },
        paint: { "line-color": s.color, "line-width": on ? 6 : 3, "line-opacity": opacity,
          ...(s.dash ? { "line-dasharray": s.dash } : {}) } });
    }
    drawn.current = candidates.length;
  }, [map, candidates, selected, dimmed, theme]);

  // The markers, regrouped at every zoom (overlap is a matter of screen distance)
  useEffect(() => {
    if (!map) return;
    let live = true;
    const draw = async () => {
      const maplibregl = await import("maplibre-gl");
      if (!live) return;
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      const add = (el: HTMLElement, at: [number, number], opts: { anchor?: "center" | "bottom" | "bottom-left"; offset?: [number, number] } = {}) =>
        markers.current.push(new maplibregl.Marker({ element: el, anchor: opts.anchor ?? "center", offset: opts.offset })
          .setLngLat(at).addTo(map));
      const links: Line[] = [];
      const c = candidates[selected];
      if (!c) {
        // No route (setup, or a conflict): the start and the stops as asked, never a blank map.
        if (request?.start) {
          const pin = startPin(request.start.label ?? "the start", false);
          add(pin.el, [request.start.lon, request.start.lat], { anchor: "bottom", offset: pin.offset });
        }
        (request?.checkpoints ?? []).forEach((cp, k) => add(stopPin(String(k + 1), `${k + 1}. ${cp.label}, as asked`,
          { asked: true, must: !!cp.must_reach }), [cp.lon, cp.lat]));
        setLinks(map, [], ROUTE_COLORS[theme].link);
        return;
      }
      const stops = c.stops ?? [];
      const start = stops.find((s) => s.role === "start");
      if (start) {
        const pin = startPin(start.label ?? "the start", facingWest);
        add(pin.el, [start.snapped_lon, start.snapped_lat], { anchor: "bottom", offset: pin.offset });
      }
      const cps = stops.filter((s) => s.role === "checkpoint");
      const groups = groupByScreen(cps.map((s, k) => {
        const p = map.project([s.snapped_lon, s.snapped_lat]);
        return { x: p.x, y: p.y, item: { s, n: k + 1 } };
      }));
      for (const g of groups) {
        const first = g.items[0]!.s;
        const text = g.items.map((i) => String(i.n)).join("·");
        const label = g.items.map((i) => `Stop ${i.n}: ${i.s.label ?? "a stop"}, at ${km(i.s.at_m)}`).join("; ");
        add(stopPin(text, label, { must: g.items.every((i) => i.s.must_reach) }), [first.snapped_lon, first.snapped_lat]);
      }
      for (const s of cps as StopOnRoute[]) {
        const req = s.requested;
        if (!req || s.must_reach || (s.kind && s.kind !== "place")) continue;
        const a = map.project([req.lon, req.lat]);
        const b = map.project([s.snapped_lon, s.snapped_lat]);
        if (Math.hypot(a.x - b.x, a.y - b.y) < PLACE_GAP_PX) continue;
        add(placePoint(s.label ?? "the place"), [req.lon, req.lat]);
        links.push([[req.lon, req.lat], [s.snapped_lon, s.snapped_lat]]);
      }
      if (c.end.kind !== "start") {
        const auto = c.end.kind !== "fixed";
        add(endFlag(`${auto ? "End (auto)" : "End"}: ${c.end.label ?? "unnamed road"}`), [c.end.lon, c.end.lat], { anchor: "bottom-left" });
      }
      setLinks(map, links, ROUTE_COLORS[theme].link);
    };
    draw();
    const onZoom = () => { draw(); };
    map.on("zoomend", onZoom);
    return () => {
      live = false;
      map.off("zoomend", onZoom);
    };
  }, [map, candidates, selected, request, theme, facingWest]);

  // The start pin's hop pauses while the map moves and while a solve runs (CSS reads these classes).
  useEffect(() => {
    if (!map) return;
    const box = map.getContainer();
    const on = () => box.classList.add("map-moving");
    const off = () => box.classList.remove("map-moving");
    map.on("movestart", on);
    map.on("moveend", off);
    return () => {
      map.off("movestart", on);
      map.off("moveend", off);
    };
  }, [map]);
  useEffect(() => {
    map?.getContainer().classList.toggle("map-solving", dimmed);
  }, [map, dimmed]);

  // Fit the view when a new version arrives (not when only the selection changes)
  useEffect(() => {
    if (!map || !fitKey) return;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      const b = new maplibregl.LngLatBounds();
      for (const c of candidates) for (const p of c.geometry) b.extend(p as [number, number]);
      if (candidates.length === 0) {
        // no route: show the start and the stops as asked
        if (request?.start) b.extend([request.start.lon, request.start.lat]);
        for (const cp of request?.checkpoints ?? []) b.extend([cp.lon, cp.lat]);
      }
      if (b.isEmpty()) return;
      // keep the route out from under the sheet (phone) or the panel (desktop): measure it; 88 px clears the top bar
      const wide = window.matchMedia("(min-width: 900px)").matches;
      const sheet = document.querySelector(".sheet")?.getBoundingClientRect();
      const under = sheet ? (wide ? sheet.right : Math.max(0, window.innerHeight - sheet.top)) : 0;
      map.fitBounds(b, { padding: wide ? { top: 40, bottom: 40, left: under + 40, right: 60 }
        : { top: 88, bottom: under + 30, left: 30, right: 50 }, duration: 600, maxZoom: 15 });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
}
