"""The solver's only door to the routing engine.

Wraps athlete_engine with the agreed policy: ferries always excluded (ferry metres
still measured, as a check), ellipsoid lengths for everything shown, the spherical
consistency check, and engine warnings carried as flags. The solver's
algorithms depend on the `Engine` protocol, so unit tests can use a fake.
"""

from dataclasses import dataclass, field
from typing import Protocol

from athlete_engine import geodesy, polyline
from athlete_engine.measure import Edge, edges_for_shape
from athlete_engine.policy import VALHALLA_RADIUS_M, consistency_tolerance_m, pedestrian_options
from athlete_engine.valhalla import Valhalla, ValhallaError, loc

from .models import Flag

LonLat = tuple[float, float]


@dataclass
class Junction:
    at_m: float            # foot metres from the start of the route
    point: LonLat
    names: list[str]       # names of the edge arriving at the junction


@dataclass
class Routed:
    legs: list[list[LonLat]]
    leg_foot_m: list[float]
    engine_m: float
    duration_s: float | None
    ferry_m: float = 0.0
    edges: list[Edge] = field(default_factory=list)
    junctions: list[Junction] = field(default_factory=list)
    flags: list[Flag] = field(default_factory=list)
    engine: str = "valhalla"
    radius_m: float = VALHALLA_RADIUS_M     # the engine's own earth radius (consistency check)

    @property
    def shape(self) -> list[LonLat]:
        out: list[LonLat] = []
        for leg in self.legs:
            out.extend(leg[1:] if out and leg and out[-1] == leg[0] else leg)
        return out

    @property
    def geom_m(self) -> float:
        return sum(geodesy.line_length_m(leg) for leg in self.legs)

    @property
    def foot_m(self) -> float:
        return self.geom_m - self.ferry_m

    @property
    def sphere_m(self) -> float:
        return geodesy.sphere_line_length_m(self.shape, radius_m=self.radius_m)

    def point_at_foot(self, foot_m: float) -> LonLat:
        """The point reached after foot_m metres on foot along the route (ferry edges are skipped over)."""
        if not any(e.use == "ferry" for e in self.edges):
            return geodesy.point_at(self.shape, foot_m)[0]
        run = 0.0
        for e in self.edges:
            if e.use == "ferry":
                continue
            if run + e.length_m >= foot_m:
                return geodesy.point_at(e.shape, foot_m - run)[0]
            run += e.length_m
        return self.shape[-1]


def check_consistency(routed: Routed) -> None:
    """Flag an engine length that disagrees with the spherical measurement (needs the route's edges)."""
    sphere = routed.sphere_m
    if abs(routed.engine_m - sphere) > consistency_tolerance_m(sphere, len(routed.edges)):
        routed.flags.append(Flag(code="engine_length_mismatch",
                                 message=f"engine length {routed.engine_m:.0f} m against spherical "
                                         f"measurement {sphere:.0f} m ({len(routed.edges)} edges)",
                                 data={"engine_m": routed.engine_m, "sphere_m": sphere, "edges": len(routed.edges)}))


class NoRoute(Exception):
    def __init__(self, message: str):
        super().__init__(message)


class Engine(Protocol):
    calls: int

    def matrix(self, points: list[LonLat]) -> list[list[float | None]]: ...
    def distances_from(self, origin: LonLat, targets: list[LonLat]) -> list[float | None]: ...
    def route(self, points: list[LonLat], through: set[int] | None = None, detail: bool = False) -> Routed: ...
    def locate(self, points: list[LonLat]) -> list[LonLat | None]: ...
    def isodistance_ring(self, origin: LonLat, km: float) -> list[LonLat]: ...
    def heights(self, points: list[LonLat]) -> list[float | None]: ...


class ValhallaEngine:
    """Engine backed by a running Valhalla."""

    def __init__(self, client: Valhalla, extra: dict | None = None):
        self.client = client
        self.options = pedestrian_options()
        self.extra = extra or {}     # extra /route fields, e.g. exclude_polygons for the request's avoid list
        self.calls = 0

    def matrix(self, points: list[LonLat]) -> list[list[float | None]]:
        """Engine distances in metres. For ordering decisions only; never shown."""
        self.calls += 1
        rows = self.client.matrix(points, points, costing_options=self.options)["sources_to_targets"]
        return [[None if c.get("distance") is None else c["distance"] * 1000.0 for c in row] for row in rows]

    def locate(self, points: list[LonLat]) -> list[LonLat | None]:
        self.calls += 1
        return self.client.locate(points, costing_options=self.options)

    def distances_from(self, origin: LonLat, targets: list[LonLat]) -> list[float | None]:
        """Walking distance (engine metres) from one point to many. Decisions only (pass-near); never shown."""
        out: list[float | None] = []
        for i in range(0, len(targets), 50):
            self.calls += 1
            row = self.client.matrix([origin], targets[i:i + 50], costing_options=self.options)["sources_to_targets"][0]
            out += [None if c.get("distance") is None else c["distance"] * 1000.0 for c in row]
        return out

    def heights(self, points: list[LonLat]) -> list[float | None]:
        """Terrain height in metres at each point (Valhalla's elevation tiles)."""
        out: list[float | None] = []
        for i in range(0, len(points), 2000):
            self.calls += 1
            out += self.client.height(points[i:i + 2000])
        return out

    def isodistance_ring(self, origin: LonLat, km: float) -> list[LonLat]:
        """Outer ring of the walking isodistance contour (candidate endpoints only; never a distance)."""
        self.calls += 1
        try:
            features = self.client.isodistance(origin, [km], costing_options=self.options)["features"]
        except ValhallaError:
            return []
        if not features:
            return []
        g = features[0]["geometry"]
        ring = g["coordinates"][0] if g["type"] == "Polygon" else max((poly[0] for poly in g["coordinates"]), key=len)
        return [(c[0], c[1]) for c in ring]

    def route(self, points: list[LonLat], through: set[int] | None = None, detail: bool = False) -> Routed:
        """Route through points; index i in `through` is a shaping via, every other point is a break.

        detail=True also fetches edge attributes (road class, edge identity, junctions, ferry metres).
        """
        through = through or set()
        locations = [loc(p, type="through" if i in through else "break") for i, p in enumerate(points)]
        self.calls += 1
        try:
            resp = self.client.route(locations, costing_options=self.options, **self.extra)
        except ValhallaError as err:
            body = err.body if isinstance(err.body, dict) else {}
            raise NoRoute(body.get("error", str(err))) from err
        legs = [polyline.decode(leg["shape"], precision=6) for leg in resp["trip"]["legs"]]
        summary = resp["trip"]["summary"]
        routed = Routed(legs=legs, leg_foot_m=[geodesy.line_length_m(leg) for leg in legs],
                        engine_m=summary["length"] * 1000.0, duration_s=summary.get("time"))

        for w in list(resp.get("warnings", [])) + list(resp["trip"].get("warnings", [])):
            routed.flags.append(Flag(code="engine_warning", message=w.get("text", str(w)), data=w))

        if detail:
            self._add_edges(routed)
            check_consistency(routed)
        return routed

    def _add_edges(self, routed: Routed) -> None:
        run_foot = 0.0
        for i, leg in enumerate(routed.legs):
            if len(leg) < 2:
                continue
            self.calls += 1
            edges, ends = self._edges_with_junctions(leg)
            ferry = sum(e.length_m for e in edges if e.use == "ferry")
            routed.ferry_m += ferry
            routed.leg_foot_m[i] -= ferry
            routed.edges += edges
            for e, is_junction in zip(edges, ends):
                if e.use != "ferry":
                    run_foot += e.length_m
                if is_junction:
                    routed.junctions.append(Junction(at_m=run_foot, point=e.shape[-1], names=list(e.names)))

    def _edges_with_junctions(self, shape: list[LonLat]) -> tuple[list[Edge], list[bool]]:
        attrs = ["edge.id", "edge.way_id", "edge.use", "edge.road_class", "edge.names",
                 "edge.begin_shape_index", "edge.end_shape_index", "node.type", "node.intersecting_edge.walkability",
                 "shape"]
        try:
            resp = self.client.trace_attributes(shape, shape_match="edge_walk", costing_options=self.options,
                                                attributes=attrs)
        except ValhallaError:
            edges, _ = edges_for_shape(self.client, shape, self.options)
            return edges, [False] * len(edges)
        matched = polyline.decode(resp["shape"], precision=6) if resp.get("shape") else shape
        edges, ends = [], []
        for e in resp.get("edges", []):
            part = matched[e["begin_shape_index"]:e["end_shape_index"] + 1]
            if len(part) < 2:
                continue
            edges.append(Edge(id=e["id"], way_id=e.get("way_id"), use=e.get("use", ""),
                              road_class=e.get("road_class", ""), names=e.get("names", []),
                              shape=part, length_m=geodesy.line_length_m(part)))
            crossing = [x for x in e.get("end_node", {}).get("intersecting_edges", [])
                        if x.get("walkability") in (None, "both", "forward", "backward")]
            ends.append(bool(crossing))
        return edges, ends
