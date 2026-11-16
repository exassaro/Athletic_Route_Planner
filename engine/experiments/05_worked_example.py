"""Step 8: measured network distances for the blueprint's section 8 worked example.

Usage:  uv run python engine/experiments/05_worked_example.py

Start (11.05, 75.86) -> Kadalundi -> Chaliyam -> Beypore -> Kozhikode, pedestrian
costing, under four ferry settings. Nothing here is compared with the
illustrative numbers in the blueprint; this report replaces them.

Lengths: "engine" is the engine's summary length; "geometry" is the geodesic
length of the returned shape on the WGS84 ellipsoid. Ferry and bridge metres
come from trace_attributes edge lengths.
Writes docs/reports/phase2/worked_example.md and one GeoJSON per setting.
"""

import itertools
import json
import sys
from pathlib import Path

from athlete_engine import geodesy
from athlete_engine.valhalla import Valhalla, ValhallaError, loc, route_length_m, route_shape

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "reports" / "phase2"
FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "places.json").read_text(encoding="utf-8"))
PLACES = FIXTURES["places"]

START = "start_south_of_kadalundi"
STOPS = ["kadalundi", "chaliyam", "beypore"]
TARGET = "kozhikode"
ALL = [START, *STOPS, TARGET]
LABEL = {START: "Start", "kadalundi": "Kadalundi", "chaliyam": "Chaliyam", "beypore": "Beypore", TARGET: "Kozhikode"}
BUDGET_M = 25_000.0

SETTINGS = [
    ("ferry_allowed", "Ferry allowed (`use_ferry: 1`)", {"use_ferry": 1.0}),
    ("default", "Valhalla default (`use_ferry: 0.5`)", {}),
    ("ferry_avoided", "Ferry avoided by cost (`use_ferry: 0`)", {"use_ferry": 0.0}),
    ("ferry_excluded", "Ferry hard-excluded (`exclude_ferries: true`)", {"exclude_ferries": True}),
]
EDGE_ATTRIBUTES = ["edge.id", "edge.way_id", "edge.length", "edge.use", "edge.road_class", "edge.bridge", "edge.names"]


def pt(name: str) -> tuple[float, float]:
    return (PLACES[name]["lon"], PLACES[name]["lat"])


def warnings_of(resp: dict) -> list:
    return list(resp.get("warnings", [])) + list(resp.get("trip", {}).get("warnings", []))


def measure_leg(engine: Valhalla, a: str, b: str, options: dict) -> dict:
    try:
        resp = engine.route([pt(a), pt(b)], costing_options=options)
    except ValhallaError as err:
        return {"from": a, "to": b, "error": err.body.get("error", str(err.body)) if isinstance(err.body, dict) else str(err.body)}
    shape = route_shape(resp)
    edges = engine.trace_attributes(shape, shape_match="edge_walk", costing_options=options,
                                    attributes=EDGE_ATTRIBUTES).get("edges", [])
    ferry_edges = [e for e in edges if e.get("use") == "ferry"]
    by_class: dict[str, float] = {}
    for e in edges:
        by_class[e["road_class"]] = by_class.get(e["road_class"], 0.0) + e["length"] * 1000
    return {
        "from": a, "to": b, "shape": shape,
        "engine_m": route_length_m(resp), "geom_m": geodesy.line_length_m(shape),
        "snap_from_m": geodesy.distance_m(pt(a), shape[0]), "snap_to_m": geodesy.distance_m(pt(b), shape[-1]),
        "ferry_m": sum(e["length"] for e in ferry_edges) * 1000,
        "ferry_ways": sorted({e["way_id"] for e in ferry_edges}),
        "bridge_m": sum(e["length"] for e in edges if e.get("bridge")) * 1000,
        "by_class": by_class, "edge_ids": [e["id"] for e in edges], "warnings": warnings_of(resp),
    }


def run_setting(engine: Valhalla, options: dict) -> dict:
    legs = [measure_leg(engine, a, b, options) for a, b in zip(ALL, ALL[1:])]

    # L_min as section 8 step 5 defines it: one routed request through the stops, in the given order.
    base = None
    try:
        resp = engine.route([loc(pt(n), type="break") for n in [START, *STOPS]], costing_options=options)
        shape = route_shape(resp)
        base = {"engine_m": route_length_m(resp), "geom_m": geodesy.line_length_m(shape), "shape": shape,
                "warnings": warnings_of(resp)}
    except ValhallaError as err:
        base = {"error": str(err.body)}

    matrix = None
    try:
        cells = engine.matrix([pt(n) for n in ALL], [pt(n) for n in ALL], costing_options=options)["sources_to_targets"]
        matrix = [[c.get("distance") for c in row] for row in cells]
    except ValhallaError as err:
        matrix = {"error": str(err.body)}
    return {"legs": legs, "base": base, "matrix": matrix}


def best_order(matrix: list[list[float | None]]) -> tuple[list[str], float] | None:
    """Shortest open path from the start through all stops, by matrix distance (km)."""
    index = {name: i for i, name in enumerate(ALL)}
    best = None
    for perm in itertools.permutations(STOPS):
        seq = [START, *perm]
        cells = [matrix[index[a]][index[b]] for a, b in zip(seq, seq[1:])]
        if any(c is None for c in cells):
            continue
        total = sum(cells)
        if best is None or total < best[1]:
            best = (list(perm), total)
    return best


def km(metres: float) -> str:
    return f"{metres / 1000:.2f}"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    with Valhalla() as engine:
        version = engine.status().get("version")
        results = {key: run_setting(engine, options) for key, _, options in SETTINGS}

    md = [
        "# Phase 2: measured distances for the section 8 worked example", "",
        f"Valhalla {version}, pedestrian costing, OSM data {FIXTURES['osm_timestamp']}.", "",
        "Request: 25 km towards Kozhikode from the start at 11.05, 75.86, via Kadalundi, Chaliyam and Beypore "
        "in that order. Stop coordinates are OSM place nodes (`tests/fixtures/places.json`).", "",
        "Two lengths are given for each route. **Engine** is the engine's own summary. **Geometry** is the "
        "geodesic length of the returned shape on the WGS84 ellipsoid, which is the figure the product should "
        "show (see `length_check.md`: the engine runs up to about 0.5% long at this latitude).", "",
        "## Summary", "",
        "| | " + " | ".join(title for _, title, _ in SETTINGS) + " |",
        "| --- |" + " --- |" * len(SETTINGS),
    ]

    def row(label, fn):
        return f"| {label} | " + " | ".join(fn(results[key]) for key, _, _ in SETTINGS) + " |"

    def leg_cell(i):
        def cell(res):
            leg = res["legs"][i]
            if "error" in leg:
                return f"no route: {leg['error']}"
            ferry = f" (ferry {leg['ferry_m']:.0f} m)" if leg["ferry_m"] else ""
            return f"{km(leg['geom_m'])} km{ferry}"
        return cell

    for i, (a, b) in enumerate(zip(ALL, ALL[1:])):
        md.append(row(f"{LABEL[a]} to {LABEL[b]}, geometry", leg_cell(i)))

    def base_geom(res):
        return None if "error" in res["base"] else res["base"]["geom_m"]

    def tail_geom(res):
        leg = res["legs"][-1]
        return None if "error" in leg else leg["geom_m"]

    def lmin_cell(res):
        b = res["base"]
        return f"no route: {b['error']}" if "error" in b else f"**{km(b['geom_m'])} km** (engine {km(b['engine_m'])})"

    def remainder_cell(res):
        l_min = base_geom(res)
        return "-" if l_min is None else f"{km(BUDGET_M - l_min)} km"

    def case_cell(res):
        l_min, tail = base_geom(res), tail_geom(res)
        if l_min is None or tail is None:
            return "-"
        remainder = BUDGET_M - l_min
        if remainder < 0:
            return f"Infeasible: stops alone exceed 25 km by {km(-remainder)} km"
        if tail >= remainder:
            return f"Case A: cut {km(remainder)} km along the {km(tail)} km path to Kozhikode"
        return f"Case B: Kozhikode is only {km(tail)} km on, {km(remainder - tail)} km short of the budget"

    def ferry_cell(res):
        legs = [leg for leg in res["legs"][:3] if "error" not in leg]
        ways = sorted({w for leg in legs for w in leg["ferry_ways"]})
        metres = sum(leg["ferry_m"] for leg in legs)
        return f"{metres:.0f} m on way(s) {', '.join(map(str, ways))}" if ways else "none"

    md += [
        row("**L_min**: one route Start, Kadalundi, Chaliyam, Beypore", lmin_cell),
        row("Remainder R at 25 km (25 km minus L_min geometry)", remainder_cell),
        row("Section 8 step 8 outcome", case_cell),
        row("Ferry edges used up to Beypore", ferry_cell),
        "",
        "Notes on the tables below: the engine classes ferry edges as `primary`, so the \"Trunk + primary\" "
        "column includes ferry metres. \"Snap\" is the straight-line offset between the requested point and "
        "where the route actually starts or ends; OSM place nodes are not on a road.",
        "",
    ]

    for key, title, options in SETTINGS:
        res = results[key]
        md += [f"## {title}", "", f"Costing options: `{json.dumps(options) if options else '{}'}`", "",
               "| Leg | Engine (m) | Geometry (m) | Ferry (m) | Ferry OSM ways | Bridge (m) | Trunk + primary (m) | Snap at start / end (m) |",
               "| --- | --- | --- | --- | --- | --- | --- | --- |"]
        for leg in res["legs"]:
            name = f"{LABEL[leg['from']]} to {LABEL[leg['to']]}"
            if "error" in leg:
                md.append(f"| {name} | no route: {leg['error']} | | | | | | |")
                continue
            major = leg["by_class"].get("trunk", 0) + leg["by_class"].get("primary", 0)
            md.append(f"| {name} | {leg['engine_m']:.0f} | {leg['geom_m']:.0f} | {leg['ferry_m']:.0f} | "
                      f"{', '.join(map(str, leg['ferry_ways'])) or '-'} | {leg['bridge_m']:.0f} | {major:.0f} | "
                      f"{leg['snap_from_m']:.0f} / {leg['snap_to_m']:.0f} |")
        good = [leg for leg in res["legs"][:3] if "error" not in leg]
        if len(good) == 3 and "error" not in res["base"]:
            md += ["", f"Sum of the three separately routed legs to Beypore: {sum(l['geom_m'] for l in good):.0f} m geometry; "
                       f"single multi-stop route: {res['base']['geom_m']:.0f} m geometry."]
        warnings = [w for leg in res["legs"] if "error" not in leg for w in leg["warnings"]]
        if "error" not in res["base"]:
            warnings += res["base"]["warnings"]
        if warnings:
            md += ["", f"Engine warnings: `{json.dumps(warnings[:3])}`"]

        matrix = res["matrix"]
        md += ["", "Matrix for the same five points (engine km):", ""]
        if isinstance(matrix, dict):
            md += [f"Matrix request failed: `{matrix['error']}`", ""]
        else:
            md += ["| From \\ To | " + " | ".join(LABEL[n] for n in ALL) + " |", "| --- |" + " --- |" * len(ALL)]
            for name, cells in zip(ALL, matrix):
                md.append(f"| {LABEL[name]} | " + " | ".join("**none**" if c is None else f"{c:.3f}" for c in cells) + " |")
            gaps = sum(1 for r in matrix for c in r if c is None)
            order = best_order(matrix)
            chain = sum(matrix[ALL.index(a)][ALL.index(b)] or 0 for a, b in zip([START, *STOPS], STOPS))
            md += ["", f"- Missing cells (no path): {gaps}",
                   f"- Matrix sum along the requested order to Beypore: {chain:.3f} km"]
            if order:
                same = order[0] == STOPS
                md.append(f"- Shortest order by matrix: {', '.join(LABEL[n] for n in order[0])} ({order[1]:.3f} km)"
                          + (", the requested order" if same else ", which differs from the requested order"))
        md.append("")

        if "error" not in res["base"]:
            features = [{"type": "Feature", "properties": {"setting": key, "part": "start to Beypore",
                                                           "geometry_length_m": round(res["base"]["geom_m"], 1)},
                         "geometry": {"type": "LineString", "coordinates": res["base"]["shape"]}}]
            tail = res["legs"][-1]
            if "error" not in tail:
                features.append({"type": "Feature", "properties": {"setting": key, "part": "Beypore to Kozhikode",
                                                                   "geometry_length_m": round(tail["geom_m"], 1)},
                                 "geometry": {"type": "LineString", "coordinates": tail["shape"]}})
            features += [{"type": "Feature", "properties": {"name": LABEL[n]},
                          "geometry": {"type": "Point", "coordinates": pt(n)}} for n in ALL]
            (OUT / f"worked_example_{key}.geojson").write_text(
                json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")

    report = OUT / "worked_example.md"
    report.write_text("\n".join(md), encoding="utf-8")

    for key, title, _ in SETTINGS:
        res = results[key]
        legs = "  ".join("n/a" if "error" in leg else km(leg["geom_m"]) for leg in res["legs"])
        l_min = base_geom(res)
        print(f"{key:15s} legs km: {legs}   L_min {km(l_min) if l_min else 'n/a'} km   ferry: {ferry_cell(res)}")
    print(f"Report: {report.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
