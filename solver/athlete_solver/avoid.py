"""What the route must not use (Phase 3 amendment 7): places, roads and areas.

Each engine gets the request in its own terms:
- GraphHopper ("recommended"): areas in the per-request custom model and a priority of 0 inside
  them; roads by OSM way id (`osm_way_id`), priority 0.
- Valhalla ("shortest"): `exclude_polygons` for places and areas; for roads, `exclude_locations`
  at the middle of every segment between consecutive OSM nodes. A side street joins a road at a
  node, so segment middles exclude the road without closing the streets that cross it.
The hard rule (scoring) checks the measured route itself: no avoided OSM way among its matched
edges and no stretch inside an avoided polygon.
"""

import math

from shapely.geometry import LineString, MultiPolygon, Polygon, mapping
from shapely.geometry import Point as SPoint
from shapely.geometry import shape as as_shape

from .models import AvoidItem, RouteRequest

CIRCLE_SIDES = 32


def circle(lon: float, lat: float, radius_m: float) -> Polygon:
    """A polygon approximating a circle of radius_m round a point (straight-line offsets; an area, not a distance)."""
    k = math.cos(math.radians(lat))
    pts = []
    for i in range(CIRCLE_SIDES):
        b = 2 * math.pi * i / CIRCLE_SIDES
        pts.append((lon + radius_m * math.sin(b) / (111_320.0 * k), lat + radius_m * math.cos(b) / 111_320.0))
    return Polygon(pts)


def polygon_of(item: AvoidItem):
    if item.polygon is not None:
        return as_shape(item.polygon)
    if item.kind == "place":
        return circle(item.lon, item.lat, item.radius_m)
    return None


def polygons(req: RouteRequest) -> list[tuple[str, object]]:
    return [(a.label, g) for a in req.avoid if (g := polygon_of(a)) is not None]


def way_ids(req: RouteRequest) -> dict[int, str]:
    return {w: a.label for a in req.avoid if a.kind == "road" for w in a.way_ids}


def _rings(geom) -> list[list[list[float]]]:
    polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    return [[[x, y] for x, y in p.exterior.coords] for p in polys]


def valhalla_extra(req: RouteRequest) -> dict:
    """Extra /route body fields for Valhalla."""
    extra: dict = {}
    rings = [r for _, g in polygons(req) for r in _rings(g)]
    if rings:
        extra["exclude_polygons"] = rings
    locations = []
    for a in req.avoid:
        if a.kind != "road":
            continue
        for line in a.lines:
            for p, q in zip(line, line[1:]):
                locations.append({"lon": (p[0] + q[0]) / 2, "lat": (p[1] + q[1]) / 2})
    if locations:
        extra["exclude_locations"] = locations
    return extra


def graphhopper_model(req: RouteRequest) -> tuple[dict | None, list[dict]]:
    """(areas FeatureCollection or None, priority rules) for the GraphHopper custom model."""
    features, rules = [], []
    for k, (_, g) in enumerate(polygons(req)):
        features.append({"type": "Feature", "id": f"avoid{k}", "properties": {}, "geometry": mapping(g)})
        rules.append({"if": f"in_avoid{k}", "multiply_by": "0"})
    ids = sorted(way_ids(req))
    if ids:
        rules.append({"if": " || ".join(f"osm_way_id == {w}" for w in ids), "multiply_by": "0"})
    areas = {"type": "FeatureCollection", "features": features} if features else None
    return areas, rules


def inside(req: RouteRequest, point: tuple[float, float]) -> str | None:
    """The label of the avoided place or area containing the point, if any."""
    for label, g in polygons(req):
        if g.contains(SPoint(point)):
            return label
    return None


def violations(req: RouteRequest, geometry, edges) -> list[str]:
    """What the measured route still touches: avoided OSM ways among its edges, stretches inside avoided areas."""
    out = []
    ways = way_ids(req)
    used = sorted({e.way_id for e in edges if e.way_id in ways})
    out += [f"uses {ways[w]} (OSM way {w})" for w in used]
    if len(geometry) >= 2:
        line = LineString(geometry)
        for label, g in polygons(req):
            if line.intersects(g):
                out.append(f"enters {label}")
    return out
