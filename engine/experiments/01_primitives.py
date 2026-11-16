"""Step 4: exercise the four engine primitives the section 8 solver needs.

Usage:  uv run python engine/experiments/01_primitives.py

Pedestrian costing throughout. Writes docs/reports/phase2/primitives.md plus
GeoJSON files to open in QGIS or geojson.io. Every distance printed comes from
the engine response or from measuring returned geometry.
"""

import json
import sys
from pathlib import Path

from shapely.geometry import LineString, Point
from shapely.ops import nearest_points

from athlete_engine import geodesy
from athlete_engine.valhalla import Valhalla, ValhallaError, loc, route_length_m, route_shape

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "reports" / "phase2"
FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "places.json").read_text(encoding="utf-8"))
PLACES = FIXTURES["places"]

ORDER = ["start_south_of_kadalundi", "kadalundi", "chaliyam", "beypore", "kozhikode"]
ISO_KM = 5.0
EDGE_ATTRIBUTES = [
    "edge.id", "edge.way_id", "edge.length", "edge.use", "edge.road_class", "edge.surface",
    "edge.names", "edge.bridge", "edge.sidewalk", "edge.begin_shape_index", "edge.end_shape_index",
    "edge.mean_elevation", "edge.weighted_grade",
]


def pt(name: str) -> tuple[float, float]:
    return (PLACES[name]["lon"], PLACES[name]["lat"])


def offset_from_line_m(point: tuple[float, float], shape: list[tuple[float, float]]) -> float:
    """Geodesic distance from a point to the closest position on a route geometry."""
    on_line, _ = nearest_points(LineString(shape), Point(point))
    return geodesy.distance_m(point, (on_line.x, on_line.y))


def feature(geometry: dict, **props) -> dict:
    return {"type": "Feature", "geometry": geometry, "properties": props}


def write_geojson(name: str, features: list[dict]) -> str:
    path = OUT / name
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
    return path.relative_to(ROOT).as_posix()


def test_route_with_vias(engine: Valhalla, md: list[str]) -> bool:
    start, via, end = pt("start_south_of_kadalundi"), pt("kadalundi"), pt("chaliyam")
    results = {}
    for via_type in ("through", "break"):
        resp = engine.route([loc(start, type="break"), loc(via, type=via_type), loc(end, type="break")])
        shape = route_shape(resp)
        results[via_type] = {
            "legs": len(resp["trip"]["legs"]),
            "engine_m": route_length_m(resp),
            "geom_m": geodesy.line_length_m(shape),
            "via_offset_m": offset_from_line_m(via, shape),
            "ms": engine.last_elapsed_ms,
            "shape": shape,
        }
    through, brk = results["through"], results["break"]
    ok = (
        through["legs"] == 1 and brk["legs"] == 2
        and through["engine_m"] > 0 and brk["engine_m"] > 0
        and all(geodesy.percent_gap(r["engine_m"], r["geom_m"]) <= 0.5 for r in results.values())
    )
    geo = write_geojson("primitive_route.geojson", [
        feature({"type": "LineString", "coordinates": through["shape"]}, via_type="through",
                engine_length_m=through["engine_m"]),
        feature({"type": "Point", "coordinates": start}, role="start"),
        feature({"type": "Point", "coordinates": via}, role="via", name="Kadalundi"),
        feature({"type": "Point", "coordinates": end}, role="end", name="Chaliyam"),
    ])
    md += [
        "## 1. Route with via points", "",
        "Start (11.05, 75.86) to Chaliyam via Kadalundi, once with a `through` via and once with a `break` via.", "",
        "| Via type | Legs | Engine length (m) | Geometry length (m) | Gap (%) | Via point to route (m) | Latency (ms) |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for via_type, r in results.items():
        md.append(f"| {via_type} | {r['legs']} | {r['engine_m']:.0f} | {r['geom_m']:.1f} | "
                  f"{geodesy.percent_gap(r['engine_m'], r['geom_m']):.3f} | {r['via_offset_m']:.1f} | {r['ms']:.0f} |")
    md += ["", f"Geometry: `{geo}`", "", f"**{'PASS' if ok else 'FAIL'}**", ""]
    return ok


def test_matrix(engine: Valhalla, md: list[str]) -> bool:
    points = [pt(n) for n in ORDER]
    resp = engine.matrix(points, points)
    rows = resp["sources_to_targets"]
    cells = [[cell.get("distance") for cell in row] for row in rows]
    ok = (
        len(cells) == len(ORDER) and all(len(r) == len(ORDER) for r in cells)
        and all(c is not None for r in cells for c in r)
        and all(cells[i][i] == 0 for i in range(len(ORDER)))
    )
    md += [
        "## 2. Many-to-many matrix", "",
        f"{len(ORDER)} x {len(ORDER)} pedestrian matrix, engine distances in km. Latency {engine.last_elapsed_ms:.0f} ms.", "",
        "| From \\ To | " + " | ".join(ORDER) + " |",
        "| --- |" + " --- |" * len(ORDER),
    ]
    for name, row in zip(ORDER, cells):
        md.append(f"| {name} | " + " | ".join("null" if c is None else f"{c:.3f}" for c in row) + " |")
    md += ["", f"**{'PASS' if ok else 'FAIL'}**", ""]
    return ok


def test_isodistance(engine: Valhalla, md: list[str]) -> bool:
    origin = pt("beypore")
    resp = engine.isodistance(origin, [ISO_KM])
    latency = engine.last_elapsed_ms
    features = resp.get("features", [])
    ok = bool(features) and features[0]["geometry"]["type"] in ("Polygon", "MultiPolygon")
    md += ["## 3. Isodistance contour", "",
           f"{ISO_KM:g} km pedestrian contour from Beypore. Latency {latency:.0f} ms.", ""]
    if ok:
        geom = features[0]["geometry"]
        ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]
        geo = write_geojson("primitive_isodistance.geojson",
                            features + [feature({"type": "Point", "coordinates": origin}, role="origin")])
        # How far, by network, are points on the contour? Informs the bearing-only case in section 8.
        step = max(1, len(ring) // 8)
        md += [f"Outer ring has {len(ring)} vertices. Routed distance from the origin to 8 of them:", "",
               "| Ring vertex | Routed length (m) | Share of contour distance (%) |", "| --- | --- | --- |"]
        for idx in range(0, len(ring) - 1, step)[:8]:
            try:
                length = route_length_m(engine.route([origin, tuple(ring[idx])]))
                md.append(f"| {idx} | {length:.0f} | {length / (ISO_KM * 1000) * 100:.1f} |")
            except ValhallaError as err:
                md.append(f"| {idx} | no route ({err.body.get('error', err.body) if isinstance(err.body, dict) else err.body}) | - |")
        md += ["", f"Geometry: `{geo}`"]
    md += ["", f"**{'PASS' if ok else 'FAIL'}**", ""]
    return ok


def test_trace_attributes(engine: Valhalla, md: list[str]) -> bool:
    resp = engine.route([pt("chaliyam"), pt("beypore")])
    shape = route_shape(resp)
    engine_m = route_length_m(resp)
    match = "edge_walk"
    try:
        attrs = engine.trace_attributes(shape, shape_match=match, attributes=EDGE_ATTRIBUTES)
    except ValhallaError:
        match = "map_snap"
        attrs = engine.trace_attributes(shape, shape_match=match, attributes=EDGE_ATTRIBUTES)
    latency = engine.last_elapsed_ms
    edges = attrs.get("edges", [])
    required = ("id", "length", "use", "road_class")
    ok = bool(edges) and all(all(k in e for k in required) for e in edges)
    edge_sum_m = sum(e["length"] for e in edges) * 1000.0
    by_class: dict[str, float] = {}
    by_use: dict[str, float] = {}
    by_surface: dict[str, float] = {}
    for e in edges:
        by_class[e["road_class"]] = by_class.get(e["road_class"], 0) + e["length"] * 1000
        by_use[e["use"]] = by_use.get(e["use"], 0) + e["length"] * 1000
        by_surface[e.get("surface", "(none)")] = by_surface.get(e.get("surface", "(none)"), 0) + e["length"] * 1000
    md += [
        "## 4. Edge attributes (trace_attributes)", "",
        f"Chaliyam to Beypore route (default pedestrian costing) fed back through `trace_attributes` "
        f"with `shape_match={match}`. Latency {latency:.0f} ms.", "",
        f"- Edges returned: {len(edges)}, unique edge ids: {len({e['id'] for e in edges})}",
        f"- Route length from `/route`: {engine_m:.0f} m; sum of edge lengths: {edge_sum_m:.0f} m",
        f"- Length by road class (m): {json.dumps({k: round(v) for k, v in by_class.items()})}",
        f"- Length by use (m): {json.dumps({k: round(v) for k, v in by_use.items()})}",
        f"- Length by surface (m): {json.dumps({k: round(v) for k, v in by_surface.items()})}",
        f"- Edges flagged as bridge: {sum(1 for e in edges if e.get('bridge'))}",
        f"- Attribute keys on the first edge: {', '.join(sorted(edges[0])) if edges else '-'}",
        "", f"**{'PASS' if ok else 'FAIL'}**", "",
    ]
    return ok


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    md = ["# Phase 2: engine primitives", ""]
    results = {}
    with Valhalla() as engine:
        version = engine.status().get("version")
        md += [f"Valhalla {version}, pedestrian costing, OSM data {FIXTURES['osm_timestamp']}. "
               "Measured on the development laptop.", ""]
        tests = [("route with vias", test_route_with_vias), ("matrix", test_matrix),
                 ("isodistance", test_isodistance), ("trace_attributes", test_trace_attributes)]
        for name, fn in tests:
            try:
                results[name] = fn(engine, md)
            except Exception as err:  # report the failure, keep testing the other primitives
                results[name] = False
                md += [f"**FAIL** ({name}): `{err}`", ""]
            print(f"{'PASS' if results[name] else 'FAIL'}  {name}")
    report = OUT / "primitives.md"
    report.write_text("\n".join(md), encoding="utf-8")
    print(f"Report: {report.relative_to(ROOT).as_posix()}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
