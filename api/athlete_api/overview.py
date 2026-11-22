"""Overview points (blueprint Phase 5d amendment 2, A14): the few points that keep a Google Maps walking link
closest to our route.

Google cannot be asked, so Valhalla pedestrian stands in for it: it draws a path between neighbouring points and
that path is compared with our geometry. Start and end are fixed. The rule is greedy: in the leg that deviates
most, add our point farthest from that leg's path, until N points are used or every leg is under 30 m.

Deviation and overlap are straight-line proximities taken leg by leg, never route distances. Leg by leg matters:
against the whole path, an out-and-back's return covers for an outward pass that the path never makes.

The module is pure apart from the `route` it is given (tests pass recorded Valhalla paths).
"""

import math
from collections.abc import Callable
from dataclasses import dataclass

from athlete_engine import geodesy
from shapely.geometry import LineString, Point
from shapely.geometry.base import BaseGeometry

LonLat = tuple[float, float]
RoutePath = Callable[[LonLat, LonLat], list[LonLat]]   # the pedestrian path between two points

SAMPLE_M = 25.0      # our line and the path are compared every 25 m
NEAR_M = 30.0        # within this of the path: the same road
SAME_POINT_M = 1.0   # a loop's start and end: there is nothing to route


@dataclass(frozen=True)
class Leg:
    path: list[LonLat]
    off_m: list[float]    # each of our samples in the leg: straight line to the path
    worst_m: float        # the larger of ours to the path and the path to ours
    farthest: int         # our sample farthest from the path


def _shape(flat: list[tuple[float, float]]) -> BaseGeometry:
    return LineString(flat) if len(set(flat)) > 1 else Point(flat[0])


class Fidelity:
    """How closely Valhalla's path through some of a route's points follows the route. Points are sample indices."""

    def __init__(self, geometry: list[LonLat], route: RoutePath):
        self._route = route
        self._legs: dict[tuple[int, int], Leg] = {}
        lon, lat = self._origin = geometry[0]
        # metres on a local plane, for proximity only
        self._kx = geodesy.distance_m(self._origin, (lon + 0.01, lat)) / 0.01
        self._ky = geodesy.distance_m(self._origin, (lon, lat + 0.01)) / 0.01
        samples = geodesy.sample_every(geometry, SAMPLE_M)
        self.points = [p for p, _ in samples]
        self.at_m = [d for _, d in samples]
        self.flat = [self.xy(p) for p in self.points]

    def xy(self, p: LonLat) -> tuple[float, float]:
        return ((p[0] - self._origin[0]) * self._kx, (p[1] - self._origin[1]) * self._ky)

    def stops(self, via: list[int]) -> list[tuple[int, int]]:
        """The legs through `via`: pairs of neighbours, the fixed ends included."""
        stops = [0, *via, len(self.points) - 1]
        return list(zip(stops, stops[1:]))

    def leg(self, a: int, b: int) -> Leg:
        if (a, b) not in self._legs:
            start, end = self.points[a], self.points[b]
            path = [start] if geodesy.distance_m(start, end) < SAME_POINT_M else self._route(start, end)
            line, ours = _shape([self.xy(p) for p in path]), _shape(self.flat[a:b + 1])
            off = [line.distance(Point(p)) for p in self.flat[a:b + 1]]
            back = [ours.distance(Point(self.xy(p))) for p, _ in geodesy.sample_every(path, SAMPLE_M)] \
                if len(path) > 1 else [0.0]
            self._legs[a, b] = Leg(path=path, off_m=off, worst_m=max(max(off), max(back)),
                                   farthest=a + max(range(len(off)), key=off.__getitem__))
        return self._legs[a, b]

    def greedy(self, limit: int) -> list[int]:
        via: list[int] = []
        while len(via) < limit:
            worst_first = sorted(self.stops(via), key=lambda ab: self.leg(*ab).worst_m, reverse=True)
            # a leg whose farthest point is one of its ends cannot be split there: try the next worst
            added = next((leg.farthest for a, b in worst_first
                          if (leg := self.leg(a, b)).worst_m >= NEAR_M and a < leg.farthest < b), None)
            if added is None:
                break
            via = sorted([*via, added])
        return via

    def max_deviation_m(self, via: list[int]) -> float:
        return max(self.leg(a, b).worst_m for a, b in self.stops(via))

    def overlap_pct(self, via: list[int]) -> float:
        """The share of our length within 30 m of its own leg's path."""
        near = total = 0.0
        for a, b in self.stops(via):
            off = self.leg(a, b).off_m
            for k in range(a, b):
                weight = self.at_m[k + 1] - self.at_m[k]
                total += weight
                near += weight * (off[k - a] <= NEAR_M)
        return 100.0 * near / total if total else 100.0


@dataclass(frozen=True)
class Overview:
    points: list[tuple[float, float, float]]   # lon, lat, metres along the route
    max_deviation_m: float
    overlap_pct: float


def overview(geometry: list[LonLat], limit: int, route: RoutePath) -> Overview:
    fidelity = Fidelity(geometry, route)
    via = fidelity.greedy(limit)
    return Overview(
        points=[(round(fidelity.points[k][0], 7), round(fidelity.points[k][1], 7), round(fidelity.at_m[k], 1))
                for k in via],
        max_deviation_m=round(fidelity.max_deviation_m(via), 1),
        # rounded down: never 100 % while part of the route is off the path
        overlap_pct=math.floor(fidelity.overlap_pct(via) * 10 + 1e-6) / 10)
