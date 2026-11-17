"""GraphHopper as the route generator for the "recommended" alternative (Phase 3 amendments 1, 2, 10).

GraphHopper only proposes the path. Everything measured goes through the one
yardstick, Valhalla: edges, road classes and junctions come from matching the
GraphHopper geometry onto Valhalla pedestrian edges, and lengths come from
the geometry. Ordering (matrix), snapping (locate), contours and heights are
Valhalla's too (decision 13).

Profile `foot_rules` (engine/graphhopper/custom_models/rules_base.json) holds the
hard rules: pedestrian access (foot=no, motorways), ferries, difficult trails.
The road priorities (model R5) are sent with every request.
"""

import os

import httpx

from athlete_engine import geodesy
from athlete_engine.policy import GRAPHHOPPER_RADIUS_M

from .engine import NoRoute, Routed, ValhallaEngine, check_consistency
from .models import Preferences

GH_URL = os.environ.get("GRAPHHOPPER_URL", "http://127.0.0.1:8989")
PROFILE = "foot_rules"

PATH_CLASSES = ("FOOTWAY", "PATH", "STEPS", "TRACK", "CYCLEWAY", "BRIDLEWAY")


def priority_model(prefs: Preferences) -> dict:
    """Model R5 (decision 10): ordinary roads 1.0, primary x0.6, trunk/motorway x0.1, paths x0.1."""
    rules = [
        {"if": "road_class == PRIMARY", "multiply_by": "0.6"},
        {"if": "road_class == TRUNK || road_class == MOTORWAY", "multiply_by": "0.1"},
    ]
    if prefs.paths == "avoid":
        rules.append({"if": " || ".join(f"road_class == {c}" for c in PATH_CLASSES), "multiply_by": "0.1"})
    return {"priority": rules}


class GraphHopperUnavailable(RuntimeError):
    pass


class GraphHopperEngine:
    """Engine protocol with GraphHopper paths and Valhalla measurement."""

    engine_name = "graphhopper"

    def __init__(self, yardstick: ValhallaEngine, prefs: Preferences, base_url: str = GH_URL,
                 client: httpx.Client | None = None):
        self.yard = yardstick
        self.model = priority_model(prefs)
        self._own = client is None
        self.http = client or httpx.Client(base_url=base_url, timeout=60)
        self.gh_calls = 0

    @property
    def calls(self) -> int:
        return self.gh_calls + self.yard.calls

    def close(self) -> None:
        if self._own:
            self.http.close()

    def check(self) -> None:
        try:
            self.http.get("/health").raise_for_status()
        except httpx.HTTPError as err:
            raise GraphHopperUnavailable(f"GraphHopper is not reachable: {err}") from err

    # Valhalla does the ordering, snapping, contours and heights.
    def matrix(self, points):
        return self.yard.matrix(points)

    def locate(self, points):
        return self.yard.locate(points)

    def distances_from(self, origin, targets):
        return self.yard.distances_from(origin, targets)

    def isodistance_ring(self, origin, km):
        return self.yard.isodistance_ring(origin, km)

    def heights(self, points):
        return self.yard.heights(points)

    def route(self, points, through: set[int] | None = None, detail: bool = False) -> Routed:
        """Route through points in one request. With any through via, U-turns at vias are avoided
        (`pass_through`); GraphHopper relaxes this where a stop needs one (decision 14)."""
        body = {"points": [[p[0], p[1]] for p in points], "profile": PROFILE, "points_encoded": False,
                "instructions": False, "calc_points": True, "pass_through": bool(through),
                "custom_model": self.model}
        self.gh_calls += 1
        try:
            resp = self.http.post("/route", json=body)
        except httpx.HTTPError as err:
            raise GraphHopperUnavailable(str(err)) from err
        if resp.status_code != 200:
            try:
                message = resp.json().get("message", resp.text)
            except ValueError:
                message = resp.text
            raise NoRoute(message[:300])
        path = resp.json()["paths"][0]
        shape = [(c[0], c[1]) for c in path["points"]["coordinates"]]
        legs = split_at_waypoints(shape, [(w[0], w[1]) for w in path["snapped_waypoints"]["coordinates"]])
        routed = Routed(legs=legs, leg_foot_m=[geodesy.line_length_m(leg) for leg in legs],
                        engine_m=path["distance"], duration_s=path["time"] / 1000.0,
                        engine="graphhopper", radius_m=GRAPHHOPPER_RADIUS_M)
        if detail:
            self.yard._add_edges(routed)
            check_consistency(routed)
        return routed


def split_at_waypoints(shape, waypoints) -> list[list[tuple[float, float]]]:
    """Split a route shape into legs at its snapped waypoints (exact shape vertices), searching forward."""
    cuts, at = [0], 0
    for w in waypoints[1:-1]:
        j = next((i for i in range(at, len(shape)) if shape[i] == w), None)
        if j is None:   # fall back to the nearest vertex ahead
            j = min(range(at, len(shape)), key=lambda i: geodesy.distance_m(shape[i], w))
        cuts.append(j)
        at = j
    cuts.append(len(shape) - 1)
    legs = [shape[a:b + 1] for a, b in zip(cuts, cuts[1:])]
    return [leg if len(leg) >= 2 else [leg[0], leg[0]] for leg in legs]
