"""Step 8b: can pedestrian costing knobs produce a "quieter" alternative?

Usage:  uv run python engine/experiments/05b_quieter_probe.py

The blueprint wants direct / flatter / quieter alternatives and assumes a
penalty on trunk and primary roads. Valhalla's pedestrian costing has no such
option. This probe routes the same pairs under several option sets and
measures what actually changes: geometry length, metres on trunk and primary
(from trace_attributes, ferry edges excluded), climb, and edge overlap with
the default route (Jaccard, as in the blueprint's diversity rule).
Writes docs/reports/phase2/quieter_probe.md.
"""

import json
import sys
from pathlib import Path

from athlete_engine import geodesy
from athlete_engine.valhalla import Valhalla, ValhallaError, route_length_m, route_shape

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "reports" / "phase2"
FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "places.json").read_text(encoding="utf-8"))
PLACES = FIXTURES["places"]

PAIRS = [("start_south_of_kadalundi", "kozhikode"), ("beypore", "kozhikode"), ("feroke", "kozhikode")]
NO_FERRY = {"exclude_ferries": True}   # hard exclusion; needs allow_hard_exclusions in the server config
VARIANTS = [
    ("default", "pedestrian", {}),
    ("shortest", "pedestrian", {"shortest": True}),
    ("prefer paths and living streets", "pedestrian",
     {"walkway_factor": 0.5, "use_living_streets": 1.0, "use_tracks": 1.0, "alley_factor": 1.0}),
    ("prefer sidewalks", "pedestrian", {"sidewalk_factor": 0.3}),
    ("avoid hills", "pedestrian", {"use_hills": 0.0}),
    ("prefer lit", "pedestrian", {"use_lit": 1.0}),
    ("bicycle costing, avoid roads (proxy)", "bicycle", {"use_roads": 0.0, "bicycle_type": "Hybrid"}),
]
MAJOR = ("trunk", "primary")
ATTRS = ["edge.id", "edge.length", "edge.use", "edge.road_class", "edge.weighted_grade"]


def pt(name: str) -> tuple[float, float]:
    return (PLACES[name]["lon"], PLACES[name]["lat"])


def measure(engine: Valhalla, a: str, b: str, costing: str, options: dict) -> dict:
    opts = {**NO_FERRY, **options}
    resp = engine.route([pt(a), pt(b)], costing=costing, costing_options=opts)
    shape = route_shape(resp)
    # Attributes are always read with pedestrian costing so every variant is judged the same way.
    edges = engine.trace_attributes(shape, shape_match="map_snap", costing_options=NO_FERRY, attributes=ATTRS)["edges"]
    heights = engine.height(shape)
    climb = sum(max(0.0, h2 - h1) for h1, h2 in zip(heights, heights[1:]) if h1 is not None and h2 is not None)
    road_edges = [e for e in edges if e.get("use") != "ferry"]
    return {
        "geom_m": geodesy.line_length_m(shape), "engine_m": route_length_m(resp),
        "major_m": sum(e["length"] for e in road_edges if e["road_class"] in MAJOR) * 1000,
        "ferry_m": sum(e["length"] for e in edges if e.get("use") == "ferry") * 1000,
        "raw_climb_m": climb, "edge_ids": {e["id"] for e in edges},
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    md = [
        "# Phase 2: can pedestrian costing produce a \"quieter\" route?", "",
        f"OSM data {FIXTURES['osm_timestamp']}. Ferries hard-excluded (`exclude_ferries: true`) in every variant.", "",
        "For each pair, the default pedestrian route is compared with routes under other option sets. "
        "\"Trunk + primary\" is metres on those road classes from `trace_attributes` edge lengths. "
        "\"Overlap\" is the Jaccard overlap of edge ids with the default route; the blueprint keeps an "
        "alternative only below 0.60. \"Raw climb\" sums every rise between consecutive shape points from the "
        "elevation service with no smoothing, so it overstates real climbing and is useful only for comparing rows.", "",
    ]
    with Valhalla() as engine:
        for a, b in PAIRS:
            md += [f"## {a} to {b}", "",
                   "| Variant | Costing options | Geometry (m) | vs default (m) | Ferry (m) | Trunk + primary (m) | Share (%) | Raw climb (m) | Overlap with default |",
                   "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
            base = None
            for label, costing, options in VARIANTS:
                try:
                    r = measure(engine, a, b, costing, options)
                except ValhallaError as err:
                    md.append(f"| {label} | `{json.dumps(options)}` | failed: {err.body} | | | | | | |")
                    continue
                if base is None:
                    base = r
                union = r["edge_ids"] | base["edge_ids"]
                overlap = len(r["edge_ids"] & base["edge_ids"]) / len(union) if union else 1.0
                md.append(f"| {label} | `{json.dumps(options) if options else '{}'}` | {r['geom_m']:.0f} | "
                          f"{r['geom_m'] - base['geom_m']:+.0f} | {r['ferry_m']:.0f} | {r['major_m']:.0f} | "
                          f"{r['major_m'] / r['geom_m'] * 100:.1f} | {r['raw_climb_m']:.0f} | {overlap:.2f} |")
                print(f"{a[:8]:8s}->{b[:9]:9s} {label[:34]:34s} {r['geom_m']:7.0f} m  major {r['major_m']:6.0f} m  ferry {r['ferry_m']:4.0f} m  overlap {overlap:.2f}")
            md.append("")

        # Does `use_ferry: 0` keep ferries out once other options change the cost model?
        a, b = PAIRS[0]
        md += ["## Ferry leak check", "",
               f"{a} to {b}, comparing the soft `use_ferry: 0` with the hard `exclude_ferries: true` "
               "when combined with other options.", "",
               "| Costing options | Geometry (m) | Ferry (m) |", "| --- | --- | --- |"]
        for extra in ({}, {"shortest": True}, {"use_lit": 1.0}):
            for ferry_opts in ({"use_ferry": 0.0}, {"exclude_ferries": True}):
                opts = {**ferry_opts, **extra}
                resp = engine.route([pt(a), pt(b)], costing_options=opts)
                shape = route_shape(resp)
                edges = engine.trace_attributes(shape, shape_match="edge_walk", costing_options=opts,
                                                attributes=ATTRS)["edges"]
                ferry_m = sum(e["length"] for e in edges if e.get("use") == "ferry") * 1000
                md.append(f"| `{json.dumps(opts)}` | {geodesy.line_length_m(shape):.0f} | {ferry_m:.0f} |")
                print(f"leak check {json.dumps(opts):50s} ferry {ferry_m:4.0f} m")
        md.append("")
    report = OUT / "quieter_probe.md"
    report.write_text("\n".join(md), encoding="utf-8")
    print(f"Report: {report.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
