"""Shared helpers for the Phase 3b rules spike (08a, 08b). Not part of the solver.

Generator: GraphHopper profile `foot_rules` (hard rules only) plus a per-request
priority model. Yardstick: Valhalla pedestrian matching for road classes, edge
identity, repetition and spurs; WGS84 ellipsoid length of the geometry for distance.
"""

import json
import os
import time
from pathlib import Path

import httpx

from athlete_engine import geodesy
from athlete_engine.measure import Edge, edges_for_shape
from athlete_engine.valhalla import Valhalla

ROOT = Path(__file__).resolve().parents[2]
PBF = ROOT / "data" / "osm" / "kerala.osm.pbf"
GH_URL = os.environ.get("GRAPHHOPPER_URL", "http://localhost:8989")
NO_FERRY = {"exclude_ferries": True}

# Valhalla edge.use values that amendment 2(d) puts last: footways, paths, tracks, steps
# (and their near relatives). A pedestrian crossing is part of crossing a road, not a path.
PATH_USES = {"footway", "sidewalk", "path", "steps", "track", "cycleway", "mountain_bike",
             "bridleway", "elevator", "escalator"}
HIGHWAY_CLASSES = {"motorway", "trunk"}

# GraphHopper road_class groups for the per-request model.
GH_PATHS = "road_class == FOOTWAY || road_class == PATH || road_class == STEPS || road_class == TRACK " \
           "|| road_class == CYCLEWAY || road_class == BRIDLEWAY"
GH_HIGHWAY = "road_class == TRUNK || road_class == MOTORWAY"
GH_PRIMARY = "road_class == PRIMARY"


def priority_model(primary: float, trunk: float, paths: float) -> dict:
    """Amendment 2 as GraphHopper priorities: ordinary roads 1.0, the rest multiplied down."""
    rules = []
    if primary < 1:
        rules.append({"if": GH_PRIMARY, "multiply_by": str(primary)})
    if trunk < 1:
        rules.append({"if": GH_HIGHWAY, "multiply_by": str(trunk)})
    if paths < 1:
        rules.append({"if": GH_PATHS, "multiply_by": str(paths)})
    return {"priority": rules}


# Candidate models for the tuning run. Names are used in the report.
MODELS = {
    "R1 mild":   priority_model(primary=0.8, trunk=0.3, paths=0.15),
    "R2 medium": priority_model(primary=0.6, trunk=0.2, paths=0.10),
    "R3 strong": priority_model(primary=0.5, trunk=0.1, paths=0.05),
    "R4 paths-hard": priority_model(primary=0.6, trunk=0.2, paths=0.02),
    "R5 trunk-last": priority_model(primary=0.6, trunk=0.1, paths=0.10),
}


class GH:
    def __init__(self, base_url: str = GH_URL):
        self.client = httpx.Client(base_url=base_url, timeout=60)
        self.client.get("/health").raise_for_status()
        self.calls = 0

    def route(self, points, model: dict | None, profile: str = "foot_rules", pass_through: bool = False):
        """Route through points [(lon, lat), ...]. Returns (shape, elapsed ms, engine distance m)."""
        body = {"points": [list(p) for p in points], "profile": profile, "points_encoded": False,
                "instructions": False, "calc_points": True, "pass_through": pass_through}
        if model:
            body["custom_model"] = model
        start = time.perf_counter()
        resp = self.client.post("/route", json=body)
        ms = (time.perf_counter() - start) * 1000
        self.calls += 1
        if resp.status_code != 200:
            raise RuntimeError(resp.json().get("message", resp.text)[:200])
        path = resp.json()["paths"][0]
        return [tuple(c[:2]) for c in path["points"]["coordinates"]], ms, path["distance"]

    def close(self):
        self.client.close()


def assess(v: Valhalla, shape) -> dict:
    """Match a geometry onto Valhalla pedestrian edges and measure it."""
    edges, exact = edges_for_shape(v, shape, NO_FERRY)
    length = geodesy.line_length_m(shape)
    snap = v.trace_attributes(shape, shape_match="map_snap", costing_options=NO_FERRY, attributes=["edge.length"])
    covered = sum(e["length"] for e in snap.get("edges", [])) * 1000
    return {
        "length": length,
        "edges": edges,
        "exact": exact,
        "highway_m": sum(e.length_m for e in edges if e.road_class in HIGHWAY_CLASSES),
        "primary_m": sum(e.length_m for e in edges if e.road_class == "primary"),
        "path_m": sum(e.length_m for e in edges if e.use in PATH_USES),
        "ferry_m": sum(e.length_m for e in edges if e.use == "ferry"),
        "covered": covered,
        "walk_ok": abs(covered - length) <= max(0.01 * length, 30.0),
        "ways": {e.way_id for e in edges if e.way_id},
        "highway_ways": {e.way_id for e in edges if e.way_id and e.road_class in HIGHWAY_CLASSES},
        "keys": {e.key for e in edges},
    }


def to_feature(shape, **props) -> dict:
    return {"type": "Feature", "properties": props,
            "geometry": {"type": "LineString", "coordinates": [list(p) for p in shape]}}


def write_geojson(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")


def pct(xs, q):
    xs = sorted(xs)
    return xs[int(q * (len(xs) - 1))] if xs else float("nan")


__all__ = ["Edge", "GH", "MODELS", "NO_FERRY", "PATH_USES", "assess", "priority_model", "to_feature",
           "write_geojson", "pct", "ROOT", "PBF"]
