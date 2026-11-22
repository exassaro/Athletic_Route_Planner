"""Follow data (blueprint Phase 5d amendment 6, A15): metres along the route at each vertex, and the turn cues.

- A bend is a bearing change over 35 degrees within 20 m, found in the geometry.
- It becomes a cue at a junction: a node where Valhalla, matching our line, has another walkable edge.
- A turnaround is always a cue, junction or not.
- The road is the name of the edge after the turn, left out when it is the road the runner is already on.
- Cues under 50 m apart are merged: the later turns follow in `then`, none is dropped.
- Without Valhalla the cues come from the geometry alone, with no names. So do those of a stretch that
  Valhalla could not match: a turn is never lost because the match was.

Distances along the route are measured on the ellipsoid. The local plane is for bearings and for placing matched
nodes on our line only. The module is pure: the trace responses are handed to it.
"""

import bisect
import math
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from athlete_engine import geodesy, polyline

LonLat = tuple[float, float]
Turn = Literal["left", "right", "around"]
Trace = Callable[[list[LonLat]], dict]       # Valhalla trace_attributes for one piece of the line
# map_snap always: walk_or_snap answers without matched points when the line is exactly Valhalla's own
TRACE_MATCH = "map_snap"
TRACE_ATTRIBUTES = ("edge.names", "edge.begin_shape_index", "edge.end_shape_index",
                    "node.intersecting_edge.walkability", "node.intersecting_edge.use", "matched.point",
                    "matched.type", "matched.edge_index", "matched.distance_from_trace_point", "shape")

BEND_DEG = 35.0
BEND_WINDOW_M = 20.0      # bearing of the 10 m before against the 10 m after
BEND_STEP_M = 2.0
TURNAROUND_PROBE_M = 5.0  # this far either side of a vertex...
TURNAROUND_GAP_M = 0.5    # ...the line is back on itself. A01 has a 164 degree corner (1.6 m): a turn, not this
JUNCTION_REACH_M = 15.0   # a bend's junction is at most this far along the line from it
NODE_OFF_M = 15.0         # a matched node further than this from our line is not ours
NAME_AFTER_M = 15.0       # the road's name is read here, past the connectors inside a junction
MERGE_M = 50.0
# OSM `ref` values that are only a class of road: "turn left onto MDR" says nothing. "NH 66" stays.
CLASS_ONLY = frozenset({"MDR", "ODR", "NH", "SH", "VR"})


def road_name(names: list[str]) -> str | None:
    return next((n for n in names if n.strip() and n.strip().upper() not in CLASS_ONLY), None)


def same_road(a: str | None, b: str | None) -> bool:
    """OSM spells one road "Railway Station Road" and "Railway Station Road." """
    return (a or "").strip(" .").casefold() == (b or "").strip(" .").casefold()


def side_deg(before: float, after: float) -> float:
    """Signed change of bearing, -180 to 180: positive is to the right."""
    return (after - before + 180.0) % 360.0 - 180.0


@dataclass(frozen=True)
class Bend:
    at_m: float
    turn: Turn


@dataclass(frozen=True)
class Step:
    at_m: float
    turn: Turn
    road: str | None = None


@dataclass(frozen=True)
class Cue(Step):
    then: list[Step] = field(default_factory=list)


@dataclass
class Match:
    """What Valhalla knows along our line: where the junctions are, and where each road's name starts."""

    junctions: list[float] = field(default_factory=list)
    name_from: list[tuple[float, str | None]] = field(default_factory=list)
    unmatched: list[tuple[float, float]] = field(default_factory=list)      # stretches Valhalla did not match

    def is_unmatched(self, at_m: float) -> bool:
        return any(a <= at_m <= b for a, b in self.unmatched)

    def name_at(self, at_m: float) -> str | None:
        i = bisect.bisect_right(self.name_from, at_m, key=lambda x: x[0]) - 1
        return self.name_from[i][1] if i >= 0 else None

    def junction_near(self, at_m: float, reach_m: float = JUNCTION_REACH_M) -> float | None:
        i = bisect.bisect_left(self.junctions, at_m)
        near = [j for j in self.junctions[max(i - 1, 0):i + 1] if abs(j - at_m) <= reach_m]
        return min(near, key=lambda j: abs(j - at_m)) if near else None


class Line:
    def __init__(self, geometry: list[LonLat]):
        self.geometry = geometry
        self.along_m = geodesy.cumulative_m(geometry)
        self.length_m = self.along_m[-1]
        lon, lat = self._origin = geometry[0]
        self._kx = geodesy.distance_m(self._origin, (lon + 0.01, lat)) / 0.01
        self._ky = geodesy.distance_m(self._origin, (lon, lat + 0.01)) / 0.01
        self.flat = [self.xy(p) for p in geometry]

    def xy(self, p: LonLat) -> tuple[float, float]:
        return ((p[0] - self._origin[0]) * self._kx, (p[1] - self._origin[1]) * self._ky)

    def at(self, along: float) -> tuple[float, float]:
        along = min(max(along, 0.0), self.length_m)
        i = min(max(bisect.bisect_right(self.along_m, along) - 1, 0), len(self.flat) - 2)
        t = (along - self.along_m[i]) / ((self.along_m[i + 1] - self.along_m[i]) or 1.0)
        (ax, ay), (bx, by) = self.flat[i], self.flat[i + 1]
        return ax + t * (bx - ax), ay + t * (by - ay)

    def turnarounds(self) -> list[int]:
        """Vertices where the line goes back the way it came."""
        out: list[int] = []
        probe = TURNAROUND_PROBE_M
        for i, at in enumerate(self.along_m):
            if not probe <= at <= self.length_m - probe:
                continue
            if math.dist(self.at(at - probe), self.at(at + probe)) >= TURNAROUND_GAP_M:
                continue
            if not out or at - self.along_m[out[-1]] > BEND_WINDOW_M:
                out.append(i)
        return out

    def bends(self) -> list[Bend]:
        around = [self.along_m[i] for i in self.turnarounds()]
        half = BEND_WINDOW_M / 2
        groups: list[list[tuple[float, float]]] = []    # (at, signed change), one group for each bend
        at = half
        while at <= self.length_m - half:
            a, b, c = self.at(at - half), self.at(at), self.at(at + half)
            if a != b != c and not any(abs(at - t) <= half for t in around):      # the window straddles a reversal
                change = side_deg(math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])),
                                  math.degrees(math.atan2(c[0] - b[0], c[1] - b[1])))
                if abs(change) > BEND_DEG:
                    same = groups and at - groups[-1][-1][0] <= half and (groups[-1][-1][1] > 0) == (change > 0)
                    if same:
                        groups[-1].append((at, change))
                    else:
                        groups.append([(at, change)])
            at += BEND_STEP_M
        found = [Bend(t, "around") for t in around]
        for group in groups:
            peak_at, change = max(group, key=lambda x: abs(x[1]))
            found.append(Bend(peak_at, "right" if change > 0 else "left"))
        return sorted(found, key=lambda b: b.at_m)

    def pieces(self) -> list[tuple[int, int]]:
        """Vertex ranges between turnarounds: matched as one trace, a U-turn overshoots to the end of its edge."""
        cuts = [0, *self.turnarounds(), len(self.geometry) - 1]
        return [(a, b) for a, b in zip(cuts, cuts[1:]) if b > a]

    def project(self, p: LonLat, first: int, last: int) -> tuple[float, float]:
        """(straight-line distance, metres along) of p on the segments between two vertices."""
        x, y = self.xy(p)
        best = (math.dist((x, y), self.flat[first]), self.along_m[first])
        for i in range(first, last):
            (ax, ay), (bx, by) = self.flat[i], self.flat[i + 1]
            dx, dy = bx - ax, by - ay
            t = min(max(((x - ax) * dx + (y - ay) * dy) / ((dx * dx + dy * dy) or 1.0), 0.0), 1.0)
            off = math.dist((x, y), (ax + t * dx, ay + t * dy))
            if off < best[0]:
                best = (off, self.along_m[i] + t * (self.along_m[i + 1] - self.along_m[i]))
        return best

    def match(self, trace: Trace) -> Match:
        out = Match()
        for first, last in self.pieces():
            self._read(trace(self.geometry[first:last + 1]), first, last, out)
        out.junctions.sort()
        out.name_from.sort(key=lambda x: x[0])
        return out

    def _read(self, response: dict, first: int, last: int, out: Match) -> None:
        """Each matched edge's end node, placed on our line between the vertices matched either side of it."""
        edges = response.get("edges") or []
        if not edges or not response.get("shape"):
            out.unmatched.append((self.along_m[first], self.along_m[last]))
            return
        shape = polyline.decode(response["shape"], precision=6)
        vertices, edge_of = [], []
        good: set[int] = set()
        for k, p in enumerate(response.get("matched_points") or []):
            e = p.get("edge_index")
            # unmatched points carry no index, or a huge sentinel
            if e is not None and e < len(edges) and first + k <= last and (not edge_of or e >= edge_of[-1]):
                vertices.append(first + k)
                edge_of.append(e)
                if p.get("type") != "unmatched" and p.get("distance_from_trace_point", 0.0) <= NODE_OFF_M:
                    good.add(first + k)
        for i in range(first, last + 1):
            if i not in good:       # both segments at a vertex that was not matched
                out.unmatched.append((self.along_m[max(i - 1, first)], self.along_m[min(i + 1, last)]))
        if not vertices:
            return
        out.name_from.append((self.along_m[first], road_name(edges[0].get("names", []))))
        for i, edge in enumerate(edges[:-1]):
            k = bisect.bisect_right(edge_of, i)
            lo = vertices[k - 1] if k else first
            hi = vertices[k] if k < len(vertices) else last
            off, at = self.project(shape[edge["end_shape_index"]], lo, hi)
            if off > NODE_OFF_M:
                continue
            out.name_from.append((at, road_name(edges[i + 1].get("names", []))))
            others = edge.get("end_node", {}).get("intersecting_edges", [])
            # Valhalla leaves walkability out only when it was not asked for it
            if any(x.get("walkability") in (None, "both", "forward", "backward") for x in others):
                out.junctions.append(at)


def cues(line: Line, match: Match | None, reach_m: float = JUNCTION_REACH_M) -> list[Cue]:
    """`match` None: Valhalla could not be asked, so every bend is a cue and none has a name."""
    turns: list[Step] = []
    for bend in line.bends():
        if match is None or bend.turn == "around":
            turns.append(Step(bend.at_m, bend.turn))
            continue
        junction = match.junction_near(bend.at_m, reach_m)
        if junction is None:
            if match.is_unmatched(bend.at_m):
                turns.append(Step(bend.at_m, bend.turn))
            continue
        if turns and turns[-1].at_m == junction and turns[-1].turn == bend.turn:
            continue        # two bends of one turn at the same junction
        turns.append(Step(junction, bend.turn))
    turns.sort(key=lambda s: s.at_m)

    steps: list[Step] = []
    for i, turn in enumerate(turns):
        road = None
        if match is not None and turn.turn != "around":
            since = turns[i - 1].at_m if i else 0.0
            until = turns[i + 1].at_m if i + 1 < len(turns) else line.length_m
            # never read past the next turn: in "right, then left onto X" X is the second turn's road
            before = match.name_at(turn.at_m - min(NAME_AFTER_M, (turn.at_m - since) / 2 + 0.01))
            after = match.name_at(turn.at_m + min(NAME_AFTER_M, (until - turn.at_m) / 2))
            road = after if not same_road(after, before) else None
        steps.append(Step(turn.at_m, turn.turn, road))

    merged: list[list[Step]] = []
    for step in steps:
        if merged and step.at_m - merged[-1][-1].at_m < MERGE_M:
            said = next((s.road for s in reversed(merged[-1]) if s.road), None)
            if step.road and same_road(step.road, said):
                step = Step(step.at_m, step.turn)       # not "right onto X, then left onto X"
            merged[-1].append(step)
        else:
            merged.append([step])
    return [Cue(group[0].at_m, group[0].turn, group[0].road, group[1:]) for group in merged]
