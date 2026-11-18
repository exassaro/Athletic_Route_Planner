"use client";
/**
 * Route detail (section 13): the elevation chart linked to a cursor on the map, km marks, and the stops with
 * their distance marks. The chart draws the API's profile: the series the solver counts the climb on
 * (`smoothed`, Phase 5 amendment 14) over the raw DEM heights. The cursor's map position is the API's position for
 * that sample (`points`, A5); km marks are the API's (`km_marks`). Nothing is measured here.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Schemas } from "@/api/client";
import { km, metres } from "@/plan/format";
import { lineStyle } from "@/plan/routeStyle";
import { planClient } from "@/plan/usePlan";
import { Num } from "./Num";

type Candidate = Schemas["CandidateOut"];
type Elevation = Schemas["ElevationOut"];

const W = 600;
const H = 150;
const PAD = { l: 34, r: 8, t: 10, b: 22 };

export function RouteDetail({ map, cand, index }: { map: MapLibreMap | null; cand: Candidate; index: number }) {
  const [elev, setElev] = useState<Elevation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const titleId = useId();

  useEffect(() => {
    let live = true;
    setElev(null); // eslint-disable-line react-hooks/set-state-in-effect
    planClient().api.GET("/v1/routes/{route_id}/elevation", { params: { path: { route_id: cand.route_id } } })
      .then(({ data }) => {
        if (!live) return;
        if (data) setElev(data as Elevation);
        else setError("Elevation is not available for this route.");
      });
    return () => {
      live = false;
    };
  }, [cand.route_id]);

  // km marks on the map (every 1 km from the API; labels on every 5th)
  useEffect(() => {
    if (!map || !elev) return;
    const data = { type: "FeatureCollection" as const, features: elev.km_marks.map((m) => ({
      type: "Feature" as const, properties: { km: m.km, major: m.km % 5 === 0 },
      geometry: { type: "Point" as const, coordinates: [m.lon, m.lat] } })) };
    const src = map.getSource("km-marks") as GeoJSONSource | undefined;
    if (src) src.setData(data);
    else {
      map.addSource("km-marks", { type: "geojson", data });
      map.addLayer({ id: "km-marks", type: "circle", source: "km-marks",
        paint: { "circle-radius": ["case", ["get", "major"], 9, 3], "circle-color": "#ffffff",
          "circle-stroke-color": "#16201c", "circle-stroke-width": 1.5 } });
      map.addLayer({ id: "km-labels", type: "symbol", source: "km-marks", filter: ["get", "major"],
        layout: { "text-field": ["to-string", ["get", "km"]], "text-size": 10, "text-font": ["Noto Sans Medium"],
          "text-allow-overlap": true } });
    }
  }, [map, elev]);

  // Leaving this route (another route, or none): take its km marks and cursor off the map.
  useEffect(() => () => {
    if (!map) return;
    const empty = { type: "FeatureCollection" as const, features: [] };
    (map.getSource("km-marks") as GeoJSONSource | undefined)?.setData(empty);
    (map.getSource("chart-cursor") as GeoJSONSource | undefined)?.setData(empty);
  }, [map, cand.route_id]);

  // the cursor on the map
  useEffect(() => {
    if (!map || !elev) return;
    const at = cursor === null ? null : elev.points[cursor];
    const data = at ? { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: at } }
      : { type: "FeatureCollection" as const, features: [] };
    const src = map.getSource("chart-cursor") as GeoJSONSource | undefined;
    if (src) src.setData(data);
    else {
      map.addSource("chart-cursor", { type: "geojson", data });
      map.addLayer({ id: "chart-cursor", type: "circle", source: "chart-cursor",
        paint: { "circle-radius": 8, "circle-color": lineStyle(cand.label, cand.option, index).color,
          "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
    }
  }, [map, elev, cursor, cand.label, cand.option, index]);

  const chart = useMemo(() => {
    if (!elev || elev.profile.length < 2) return null;
    const d = elev.profile.map((p) => p[0]);
    const raw = elev.profile.map((p) => p[1]);
    const smooth = elev.smoothed.length === raw.length ? elev.smoothed : raw;
    const lo = Math.floor(Math.min(...raw, ...smooth) / 10) * 10;
    const hi = Math.max(lo + 20, Math.ceil(Math.max(...raw, ...smooth) / 10) * 10);
    const end = d[d.length - 1]!;
    const x = (m: number) => PAD.l + (m / end) * (W - PAD.l - PAD.r);
    const y = (h: number) => PAD.t + (1 - (h - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const path = (hs: number[]) => hs.map((h, i) => `${i ? "L" : "M"}${x(d[i]!).toFixed(1)},${y(h).toFixed(1)}`).join("");
    return { d, raw, smooth, lo, hi, end, x, y, rawPath: path(raw), smoothPath: path(smooth) };
  }, [elev]);

  const onMove = (clientX: number) => {
    if (!chart || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    const m = ((clientX - r.left) / r.width * W - PAD.l) / (W - PAD.l - PAD.r) * chart.end;
    // the nearest API sample (no interpolation: the dot sits where the API says that sample is)
    let best = 0;
    for (let i = 1; i < chart.d.length; i++) if (Math.abs(chart.d[i]! - m) < Math.abs(chart.d[best]! - m)) best = i;
    setCursor(best);
  };

  const stops = (cand.stops ?? []).filter((s) => s.role === "checkpoint");
  return (
    <section className="detail" aria-label="Route detail" data-testid="route-detail">
      <h2>Elevation</h2>
      {error && <p className="muted">{error}</p>}
      {!elev && !error && <p className="muted">Loading the profile…</p>}
      {chart && elev && (
        <>
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-labelledby={titleId}
            onPointerMove={(e) => onMove(e.clientX)} onPointerLeave={() => setCursor(null)} data-testid="elevation-chart">
            <title id={titleId}>{`Elevation along ${km(chart.end)}: climb ${elev.gain_m ?? "unknown"} m${elev.climb_approximate ? " (approximate)" : ""}`}</title>
            {[chart.lo, chart.hi].map((h) => (
              <g key={h}>
                <line x1={PAD.l} x2={W - PAD.r} y1={chart.y(h)} y2={chart.y(h)} className="grid" />
                <text x={PAD.l - 4} y={chart.y(h) + 4} textAnchor="end" className="axis">{h} m</text>
              </g>
            ))}
            {elev.km_marks.filter((m) => m.km % 5 === 0).map((m) => (
              <text key={m.km} x={chart.x(m.at_m)} y={H - 6} textAnchor="middle" className="axis">{m.km} km</text>
            ))}
            {stops.map((s, i) => (
              <g key={i}>
                <line x1={chart.x(s.at_m)} x2={chart.x(s.at_m)} y1={PAD.t} y2={H - PAD.b} className="stop-tick" />
                <text x={chart.x(s.at_m)} y={PAD.t + 8} textAnchor="middle" className="stop-tick-label">{i + 1}</text>
              </g>
            ))}
            <path d={chart.rawPath} className="raw" />
            <path d={chart.smoothPath} className="smooth" />
            {cursor !== null && (
              <line x1={chart.x(chart.d[cursor]!)} x2={chart.x(chart.d[cursor]!)} y1={PAD.t} y2={H - PAD.b} className="cursor" />
            )}
          </svg>
          <p className="muted small">
            {cursor !== null ? <>At <Num value={chart.d[cursor]!} format={(m) => km(m, 2)} field="profile.distance" />:{" "}
              <Num value={chart.smooth[cursor]!} format={metres} field="smoothed" /></> : "Move along the chart to see the point on the map."}
            {" "}Darker line: the heights the climb is counted on (bridges levelled); light line: raw elevation data.
          </p>
        </>
      )}
      {/* the stops and their distance marks are in the stops timeline (Phase 5b step 7) */}
    </section>
  );
}
