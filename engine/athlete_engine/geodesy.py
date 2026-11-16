"""Geodesic measurement on the WGS84 ellipsoid (pyproj).

This is the independent length check from blueprint section 16: it measures the
geometry the engine returned. It is never a substitute for a network distance.
"""

from collections.abc import Sequence

from pyproj import Geod

_GEOD = Geod(ellps="WGS84")


def line_length_m(points: Sequence[Sequence[float]]) -> float:
    """Length in metres of a polyline given as (lon, lat) points."""
    if len(points) < 2:
        return 0.0
    lons = [p[0] for p in points]
    lats = [p[1] for p in points]
    return _GEOD.line_length(lons, lats)


def sphere_line_length_m(points: Sequence[Sequence[float]], radius_m: float = 6378137.0) -> float:
    """Length of a (lon, lat) polyline on a sphere. Diagnostic only.

    Used to test whether a routing engine measures on a sphere instead of the
    ellipsoid. Product numbers always use line_length_m.
    """
    if len(points) < 2:
        return 0.0
    sphere = Geod(a=radius_m, b=radius_m)
    return sphere.line_length([p[0] for p in points], [p[1] for p in points])


def distance_m(a: Sequence[float], b: Sequence[float]) -> float:
    """Straight-line (geodesic) distance in metres between two (lon, lat) points.

    Use only for snap distances, pre-filters and checks. Not a route distance.
    """
    _, _, dist = _GEOD.inv(a[0], a[1], b[0], b[1])
    return dist


def percent_gap(engine_m: float, geometry_m: float) -> float:
    """Absolute gap between engine-reported and geometry length, as % of geometry length."""
    if geometry_m == 0:
        return 0.0 if engine_m == 0 else float("inf")
    return abs(engine_m - geometry_m) / geometry_m * 100.0
