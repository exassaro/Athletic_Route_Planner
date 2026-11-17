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


def bearing_deg(a: Sequence[float], b: Sequence[float]) -> float:
    """Forward azimuth from a to b on the ellipsoid, 0..360 degrees clockwise from north."""
    az, _, _ = _GEOD.inv(a[0], a[1], b[0], b[1])
    return az % 360.0


def angle_between_deg(a: float, b: float) -> float:
    """Smallest absolute difference between two bearings, 0..180."""
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def cumulative_m(points: Sequence[Sequence[float]]) -> list[float]:
    """Distance along the line (ellipsoid) at each vertex; first entry is 0."""
    out = [0.0]
    for p, q in zip(points, points[1:]):
        out.append(out[-1] + distance_m(p, q))
    return out


def point_at(points: Sequence[Sequence[float]], at_m: float) -> tuple[tuple[float, float], int]:
    """The point at distance at_m along the line (ellipsoid), and the index of the vertex before it.

    at_m is clamped to the line. Interpolation within a segment follows the geodesic.
    """
    if len(points) < 2 or at_m <= 0:
        return (points[0][0], points[0][1]), 0
    run = 0.0
    for i, (p, q) in enumerate(zip(points, points[1:])):
        seg = distance_m(p, q)
        if run + seg >= at_m:
            if seg == 0:
                return (q[0], q[1]), i
            az, _, _ = _GEOD.inv(p[0], p[1], q[0], q[1])
            lon, lat, _ = _GEOD.fwd(p[0], p[1], az, at_m - run)
            return (lon, lat), i
        run += seg
    last = points[-1]
    return (last[0], last[1]), len(points) - 2


def cut_at(points: Sequence[Sequence[float]], at_m: float) -> list[tuple[float, float]]:
    """The line from its start up to at_m metres along it (ellipsoid)."""
    pt, i = point_at(points, at_m)
    head = [(p[0], p[1]) for p in points[: i + 1]]
    if head[-1] != pt:
        head.append(pt)
    return head


def sample_every(points: Sequence[Sequence[float]], step_m: float) -> list[tuple[tuple[float, float], float]]:
    """Points every step_m along the line, with their distance along; always includes both ends."""
    out = []
    at = 0.0       # next sample position along the line
    run = 0.0      # distance along the line at the start of the current segment
    for p, q in zip(points, points[1:]):
        az, _, seg = _GEOD.inv(p[0], p[1], q[0], q[1])
        while at < run + seg:
            if seg == 0:
                break
            lon, lat, _ = _GEOD.fwd(p[0], p[1], az, at - run)
            out.append(((lon, lat), at))
            at += step_m
        run += seg
    if not out:
        out.append(((points[0][0], points[0][1]), 0.0))
    out.append(((points[-1][0], points[-1][1]), run))
    return out


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
