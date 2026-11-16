"""Measure a route from its geometry: ellipsoid length, ferry metres, edges.

Measurement, not algorithm: the solver and the independent KPI harness both
use it. Lengths are WGS84 geodesic lengths of the shape (pyproj); edge data
comes from trace_attributes, leg by leg (edge_walk cannot follow a multi-leg
shape that turns back at a stop).
"""

from dataclasses import dataclass, field
from typing import Any

from . import geodesy, polyline
from .valhalla import Valhalla, ValhallaError

LonLat = tuple[float, float]
EDGE_ATTRIBUTES = [
    "edge.id", "edge.way_id", "edge.use", "edge.road_class", "edge.names", "edge.bridge",
    "edge.begin_shape_index", "edge.end_shape_index", "edge.length",
    "node.type", "matched.point", "shape",
]


@dataclass
class Edge:
    id: int
    way_id: int | None
    use: str
    road_class: str
    names: list[str]
    shape: list[LonLat]     # the part of the measured shape this edge covers
    length_m: float         # ellipsoid length of that part

    @property
    def key(self) -> tuple:
        """Direction-free identity: the same road walked both ways gives the same key."""
        a = (round(self.shape[0][0], 6), round(self.shape[0][1], 6))
        b = (round(self.shape[-1][0], 6), round(self.shape[-1][1], 6))
        return (self.way_id, frozenset((a, b)))


@dataclass
class Measurement:
    geom_m: float
    ferry_m: float
    edges: list[Edge] = field(default_factory=list)
    matched_exactly: bool = True   # False if any leg needed map-matching instead of edge_walk

    @property
    def foot_m(self) -> float:
        return self.geom_m - self.ferry_m


def edges_for_shape(engine: Valhalla, shape: list[LonLat],
                    costing_options: dict[str, Any] | None = None) -> tuple[list[Edge], bool]:
    """Edges along one leg's shape. Returns (edges, matched_exactly)."""
    attrs = ["edge.id", "edge.way_id", "edge.use", "edge.road_class", "edge.names",
             "edge.begin_shape_index", "edge.end_shape_index", "shape"]
    exact = True
    try:
        resp = engine.trace_attributes(shape, shape_match="edge_walk", costing_options=costing_options,
                                       attributes=attrs)
    except ValhallaError:
        exact = False
        resp = engine.trace_attributes(shape, shape_match="walk_or_snap", costing_options=costing_options,
                                       attributes=attrs)
    matched = polyline.decode(resp["shape"], precision=6) if resp.get("shape") else shape
    edges = []
    for e in resp.get("edges", []):
        part = matched[e["begin_shape_index"]:e["end_shape_index"] + 1]
        if len(part) < 2:
            continue
        edges.append(Edge(id=e["id"], way_id=e.get("way_id"), use=e.get("use", ""),
                          road_class=e.get("road_class", ""), names=e.get("names", []),
                          shape=part, length_m=geodesy.line_length_m(part)))
    return edges, exact


def leg_shapes(resp: dict) -> list[list[LonLat]]:
    return [polyline.decode(leg["shape"], precision=6) for leg in resp["trip"]["legs"]]


def measure_shapes(engine: Valhalla, shapes: list[list[LonLat]],
                   costing_options: dict[str, Any] | None = None) -> Measurement:
    """Measure one or more leg shapes. Ferry metres are the ellipsoid length of ferry edges."""
    geom = sum(geodesy.line_length_m(s) for s in shapes)
    edges: list[Edge] = []
    exact = True
    for s in shapes:
        if len(s) < 2:
            continue
        leg_edges, leg_exact = edges_for_shape(engine, s, costing_options)
        edges += leg_edges
        exact = exact and leg_exact
    ferry = sum(e.length_m for e in edges if e.use == "ferry")
    return Measurement(geom_m=geom, ferry_m=ferry, edges=edges, matched_exactly=exact)


def measure_route(engine: Valhalla, resp: dict, costing_options: dict[str, Any] | None = None) -> Measurement:
    return measure_shapes(engine, leg_shapes(resp), costing_options)
