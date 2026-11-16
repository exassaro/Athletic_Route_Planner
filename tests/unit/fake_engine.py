"""In-memory stand-in for the routing engine, for unit tests without a network.

A small graph of straight edges between (lon, lat) nodes. Points snap to the
nearest position on any usable edge; routes are Dijkstra shortest paths by
ellipsoid length. Every length it reports is measured from geometry, like the
real engine adapter, and its "engine length" is the spherical measurement
(as Valhalla's is), so the consistency check behaves as in production.
"""

import heapq
import math
from dataclasses import dataclass

from athlete_engine import geodesy
from athlete_engine.measure import Edge
from athlete_solver.engine import Junction, NoRoute, Routed

LonLat = tuple[float, float]


@dataclass
class GEdge:
    u: str
    v: str
    ferry: bool = False
    name: str = ""
    road_class: str = "residential"


class FakeGraph:
    def __init__(self, nodes: dict[str, LonLat], edges: list[GEdge]):
        self.nodes = nodes
        self.edges = edges


class FakeEngine:
    def __init__(self, graph: FakeGraph, ferries_allowed: bool = False):
        self.g = graph
        self.ferries_allowed = ferries_allowed
        self.calls = 0

    def with_ferries(self, allowed: bool) -> "FakeEngine":
        return FakeEngine(self.g, allowed)

    # ---------------------------------------------------------- graph helpers

    def _usable(self) -> list[tuple[int, GEdge]]:
        return [(i, e) for i, e in enumerate(self.g.edges) if self.ferries_allowed or not e.ferry]

    def _snap(self, p: LonLat):
        """Nearest position on a usable non-ferry edge: (offset_m, edge index, point)."""
        best = None
        k = math.cos(math.radians(p[1]))
        for i, e in self._usable():
            if e.ferry:
                continue
            a, b = self.g.nodes[e.u], self.g.nodes[e.v]
            ax, ay, bx, by, px, py = a[0] * k, a[1], b[0] * k, b[1], p[0] * k, p[1]
            dx, dy = bx - ax, by - ay
            t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
            q = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
            d = geodesy.distance_m(p, q)
            if best is None or d < best[0]:
                best = (d, i, q)
        return best

    def _adjacency(self, extra: dict[str, list[tuple[str, float, int | None]]]):
        adj: dict[str, list[tuple[str, float, int | None]]] = {}
        for i, e in self._usable():
            w = geodesy.distance_m(self.g.nodes[e.u], self.g.nodes[e.v])
            adj.setdefault(e.u, []).append((e.v, w, i))
            adj.setdefault(e.v, []).append((e.u, w, i))
        for n, links in extra.items():
            for m, w, i in links:
                adj.setdefault(n, []).append((m, w, i))
                adj.setdefault(m, []).append((n, w, i))
        return adj

    def _path(self, a: LonLat, b: LonLat):
        sa, sb = self._snap(a), self._snap(b)
        if sa is None or sb is None:
            raise NoRoute("no edge near point")
        coords = dict(self.g.nodes)
        coords["@A"], coords["@B"] = sa[2], sb[2]
        extra: dict = {"@A": [], "@B": []}
        for tag, (_, i, q) in (("@A", sa), ("@B", sb)):
            e = self.g.edges[i]
            for n in (e.u, e.v):
                extra[tag].append((n, geodesy.distance_m(q, coords[n]), i))
        if sa[1] == sb[1]:
            extra["@A"].append(("@B", geodesy.distance_m(sa[2], sb[2]), sa[1]))
        adj = self._adjacency(extra)
        dist, prev = {"@A": 0.0}, {}
        heap = [(0.0, "@A")]
        while heap:
            d, n = heapq.heappop(heap)
            if n == "@B":
                break
            if d > dist.get(n, math.inf):
                continue
            for m, w, i in adj.get(n, []):
                if d + w < dist.get(m, math.inf):
                    dist[m], prev[m] = d + w, (n, i)
                    heapq.heappush(heap, (d + w, m))
        if "@B" not in dist:
            raise NoRoute("no path")
        seq = ["@B"]
        steps = []
        while seq[-1] != "@A":
            n, i = prev[seq[-1]]
            steps.append(i)
            seq.append(n)
        seq.reverse()
        steps.reverse()
        return [coords[n] for n in seq], [self.g.edges[i] for i in steps], seq

    def _degree(self, node: str) -> int:
        return sum(1 for _, e in self._usable() if node in (e.u, e.v))

    # ---------------------------------------------------------- Engine protocol

    def locate(self, points):
        self.calls += 1
        return [None if (s := self._snap(p)) is None else s[2] for p in points]

    def isodistance_ring(self, origin, km):
        """Nodes reachable within km, standing in for a contour outline."""
        self.calls += 1
        out = []
        for name, q in self.g.nodes.items():
            try:
                shape, _, _ = self._path(origin, q)
            except NoRoute:
                continue
            if geodesy.line_length_m(shape) <= km * 1000:
                out.append(q)
        return out

    def matrix(self, points):
        self.calls += 1
        out = []
        for a in points:
            row = []
            for b in points:
                if a == b:
                    row.append(0.0)
                    continue
                try:
                    shape, _, _ = self._path(a, b)
                    row.append(geodesy.sphere_line_length_m(shape))
                except NoRoute:
                    row.append(None)
            out.append(row)
        return out

    def route(self, points, through=None, detail=False):
        self.calls += 1
        legs, leg_foot, edges, junctions = [], [], [], []
        ferry_total = 0.0
        run = 0.0
        for a, b in zip(points, points[1:]):
            shape, gedges, seq = self._path(a, b)
            leg_ferry = 0.0
            for (p, q), ge, n in zip(zip(shape, shape[1:]), gedges, seq[1:]):
                length = geodesy.distance_m(p, q)
                use = "ferry" if ge.ferry else "road"
                edges.append(Edge(id=hash((ge.u, ge.v)) & 0xFFFFFFF, way_id=self.g.edges.index(ge) + 1, use=use,
                                  road_class=ge.road_class, names=[ge.name] if ge.name else [], shape=[p, q],
                                  length_m=length))
                if ge.ferry:
                    leg_ferry += length
                else:
                    run += length
                if not n.startswith("@") and self._degree(n) >= 3:
                    junctions.append(Junction(at_m=run, point=q, names=[ge.name] if ge.name else []))
            legs.append(shape)
            leg_foot.append(geodesy.line_length_m(shape) - leg_ferry)
            ferry_total += leg_ferry
        r = Routed(legs=legs, leg_foot_m=leg_foot, engine_m=0.0, duration_s=None, ferry_m=ferry_total,
                   edges=edges, junctions=junctions)
        r.engine_m = r.sphere_m
        return r


def ladder(rungs: int = 40, step_deg: float = 0.005, lon: float = 75.85, lat0: float = 11.0) -> FakeGraph:
    """A north-south road with a short side street at every node (so every node is a junction)."""
    nodes, edges = {}, []
    for i in range(rungs + 1):
        nodes[f"m{i}"] = (lon, lat0 + i * step_deg)
        nodes[f"s{i}"] = (lon + 0.002, lat0 + i * step_deg)
        edges.append(GEdge(f"m{i}", f"s{i}", name=f"Side {i}"))
        if i:
            edges.append(GEdge(f"m{i - 1}", f"m{i}", name="Main Road", road_class="primary"))
    return FakeGraph(nodes, edges)
