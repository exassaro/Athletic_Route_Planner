"""Turn checkpoints into route points (Phase 3 amendment 3; decisions 11, 14, 16, 17).

For each checkpoint, in the chosen order, with A the last point placed so far and B
the next stop (or the target):
- place, must_reach: the point itself, a break location (U-turns allowed).
- place, pass near (default): the route must pass within 1 km ON FOOT of the place point
  (Valhalla walking distance; a straight kilometre is met from the far bank of a river)
  without a spur to reach it.
    1. If the route A -> B already passes within 1 km on foot, the nearest such point on it
       becomes a through via (adds nothing).
    2. Otherwise candidates are network points within 1 km on foot (a ring grid snapped to
       the network); the best few by straight-line A-P-B (a pre-filter only) are routed
       A -> P -> B with P as a through via, and the shortest routed one without a spur wins.
    3. If none qualifies and the checkpoint carries its OSM boundary, the same is done with
       candidates inside the boundary (flagged). Otherwise the shortest candidate is used
       even with a spur (flagged).
- junction: the point itself as a through via.
- bridge: both bridge ends as through vias, the nearer end (by route) first.
- road: the point on the road with the least added routed distance, as a through via.
Every length used to choose is a routed length from the alternative's own engine.
"""

import math
from dataclasses import dataclass, field

from shapely.geometry import Point as SPoint
from shapely.geometry import shape as as_shape

from athlete_engine import geodesy

from .engine import Engine, NoRoute
from .models import Checkpoint, Flag, RouteRequest
from .scoring import spurs

LonLat = tuple[float, float]
PASS_NEAR_M = 1000.0          # Phase 3 amendment 3
SAMPLE_STEP_M = 100.0         # decision 11: sample points every 100 m along the route
RINGS_M = (0.0, 200.0, 400.0, 600.0, 800.0, 950.0)
BEARINGS = 16
DEDUPE_M = 30.0
PREFILTER = 6                 # candidates routed per stop
SPUR_CHECKS = 3               # candidates measured for spurs per stop (shortest first)
ROAD_SAMPLE_M = 200.0
BOUNDARY_STEP_DEG = 0.0025    # about 270 m


@dataclass
class Plan:
    points: list[LonLat]                          # the start, then every via, in order (not the target)
    through: set[int] = field(default_factory=set)
    stop_at: dict[int, int] = field(default_factory=dict)   # checkpoint index -> index in points
    picks: dict[int, dict] = field(default_factory=dict)     # checkpoint index -> how it is passed
    flags: list[Flag] = field(default_factory=list)


def anchor(cp: Checkpoint) -> LonLat:
    return cp.lonlat


def plan_stops(req: RouteRequest, eng: Engine, order: list[int], start: LonLat, target: LonLat | None) -> Plan:
    plan = Plan(points=[start])
    for k, i in enumerate(order):
        cp = req.checkpoints[i]
        nxt = anchor(req.checkpoints[order[k + 1]]) if k + 1 < len(order) else target
        a = plan.points[-1]
        if cp.kind == "place" and cp.must_reach:
            _add(plan, i, cp.lonlat, through=False, pick={"how": "reached"})
        elif cp.kind == "junction":
            _add(plan, i, cp.lonlat, through=True, pick={"how": "via"})
        elif cp.kind == "bridge":
            first, second = bridge_ends(eng, cp, a)
            plan.points.append(first)
            plan.through.add(len(plan.points) - 1)
            _add(plan, i, second, through=True, pick={"how": "uses", "ends": [first, second]})
        elif cp.kind == "road":
            p = road_point(eng, cp, a, nxt)
            _add(plan, i, p, through=True, pick={"how": "uses"})
        else:
            pick = pass_point(eng, cp, a, nxt)
            _add(plan, i, pick["point"], through=True, pick=pick)
            if pick["how"] == "boundary":
                plan.flags.append(Flag(code="pass_near_boundary",
                                       message=f"no route passes within 1 km of {cp.label} on foot without a spur; "
                                               f"it passes inside {cp.label}'s boundary instead",
                                       data={"label": cp.label}))
            elif pick["how"] == "spur":
                plan.flags.append(Flag(code="pass_near_spur",
                                       message=f"no route passes near {cp.label} without a spur; it reaches it with one",
                                       data={"label": cp.label}))
    return plan


def _add(plan: Plan, i: int, p: LonLat, through: bool, pick: dict) -> None:
    plan.points.append(p)
    idx = len(plan.points) - 1
    if through:
        plan.through.add(idx)
    plan.stop_at[i] = idx
    plan.picks[i] = {**pick, "point": p}


# ------------------------------------------------------------------ pass near a place

def _route_len(eng: Engine, pts: list[LonLat]) -> float | None:
    try:
        return eng.route(pts, through=set(range(1, len(pts) - 1))).foot_m
    except NoRoute:
        return None


def pass_point(eng: Engine, cp: Checkpoint, a: LonLat, b: LonLat | None) -> dict:
    centre = cp.lonlat
    end = b if b is not None else centre
    base = eng.route([a, end])
    base_m = base.foot_m

    # 1. Already passing within 1 km on foot?
    samples = [p for p, _ in geodesy.sample_every(base.shape, SAMPLE_STEP_M) if geodesy.distance_m(centre, p) <= PASS_NEAR_M]
    if samples:
        walk = eng.distances_from(centre, samples)
        near = [(w, j) for j, w in enumerate(walk) if w is not None and w <= PASS_NEAR_M]
        if near:
            # Heading on to a next point: the nearest point on foot. Last stop with no target: the earliest
            # point on the way (the run continues from there).
            w, j = min(near) if b is not None else min(near, key=lambda t: t[1])
            return {"how": "on_route", "point": samples[j], "walk_m": round(w, 1), "added_m": 0.0}

    # 2. Candidates within 1 km on foot.
    cands = ring_candidates(eng, centre)
    walk = eng.distances_from(centre, cands) if cands else []
    within = [(c, w) for c, w in zip(cands, walk) if w is not None and w <= PASS_NEAR_M]
    best = best_candidate(eng, [c for c, _ in within], a, b, base_m, require_no_spur=True)
    if best is not None:
        best["walk_m"] = round(dict(within)[best["point"]], 1)
        return {"how": "via", **best}

    # 3. Inside the place's OSM boundary, flagged.
    if cp.boundary is not None:
        inside = boundary_candidates(eng, cp.boundary, centre)
        best = best_candidate(eng, inside, a, b, base_m, require_no_spur=True)
        if best is not None:
            return {"how": "boundary", **best}

    # 4. Last resort: the shortest candidate within 1 km on foot, even with a spur (flagged).
    best = best_candidate(eng, [c for c, _ in within], a, b, base_m, require_no_spur=False)
    if best is not None:
        best["walk_m"] = round(dict(within)[best["point"]], 1)
        return {"how": "spur", **best}
    raise NoRoute(f"no walking route passes within {PASS_NEAR_M:.0f} m of {cp.label}")


def best_candidate(eng: Engine, cands: list[LonLat], a: LonLat, b: LonLat | None, base_m: float,
                   require_no_spur: bool) -> dict | None:
    """Route the best few candidates (straight-line pre-filter) and keep the shortest without a spur."""
    if not cands:
        return None

    def straight(c):
        return geodesy.distance_m(a, c) + (geodesy.distance_m(c, b) if b is not None else 0.0)

    routed = []
    for c in sorted(cands, key=straight)[:PREFILTER]:
        pts = [a, c] + ([b] if b is not None else [])
        length = _route_len(eng, pts)
        if length is not None:
            routed.append((length, c))
    routed.sort()
    for length, c in routed[:SPUR_CHECKS if require_no_spur else 1]:
        if require_no_spur:
            pts = [a, c] + ([b] if b is not None else [])
            try:
                r = eng.route(pts, through=set(range(1, len(pts) - 1)), detail=True)
            except NoRoute:
                continue
            if spurs(r.edges, []):
                continue
        return {"point": c, "added_m": round(length - base_m, 1)}
    return None


def offset(p: LonLat, dist_m: float, bearing_deg: float) -> LonLat:
    """A point at a straight-line offset (candidate grid only; never a distance)."""
    lat = math.radians(p[1])
    dy = dist_m * math.cos(math.radians(bearing_deg)) / 111_320.0
    dx = dist_m * math.sin(math.radians(bearing_deg)) / (111_320.0 * max(math.cos(lat), 1e-6))
    return (p[0] + dx, p[1] + dy)


def _snap_dedupe(eng: Engine, grid: list[LonLat], keep) -> list[LonLat]:
    out: list[LonLat] = []
    snapped = []
    for i in range(0, len(grid), 100):
        snapped += eng.locate(grid[i:i + 100])
    for s in snapped:
        if s is None or not keep(s):
            continue
        s = (s[0], s[1])
        if all(geodesy.distance_m(s, o) > DEDUPE_M for o in out):
            out.append(s)
    return out


def ring_candidates(eng: Engine, centre: LonLat) -> list[LonLat]:
    grid = [centre] + [offset(centre, r, b) for r in RINGS_M[1:] for b in range(0, 360, 360 // BEARINGS)]
    return _snap_dedupe(eng, grid, lambda s: geodesy.distance_m(centre, s) <= PASS_NEAR_M)


def boundary_candidates(eng: Engine, boundary: dict, centre: LonLat) -> list[LonLat]:
    poly = as_shape(boundary)
    minx, miny, maxx, maxy = poly.bounds
    nx = int((maxx - minx) / BOUNDARY_STEP_DEG) + 1
    ny = int((maxy - miny) / BOUNDARY_STEP_DEG) + 1
    grid = [(minx + i * BOUNDARY_STEP_DEG, miny + j * BOUNDARY_STEP_DEG) for i in range(nx) for j in range(ny)]
    grid = [g for g in grid if poly.contains(SPoint(g))] or [centre]
    return _snap_dedupe(eng, grid, lambda s: poly.contains(SPoint(s)))


# ------------------------------------------------------------------ bridges and roads

def bridge_ends(eng: Engine, cp: Checkpoint, a: LonLat) -> tuple[LonLat, LonLat]:
    """The two ends of the bridge (farthest-apart line ends), the one nearer to A by route first."""
    ends = [tuple(line[0]) for line in cp.lines] + [tuple(line[-1]) for line in cp.lines]
    p, q = max(((u, v) for u in ends for v in ends), key=lambda uv: geodesy.distance_m(uv[0], uv[1]))
    dp, dq = _route_len(eng, [a, p]), _route_len(eng, [a, q])
    if dp is None and dq is None:
        raise NoRoute(f"no walking route to the bridge {cp.label}")
    if dq is not None and (dp is None or dq < dp):
        p, q = q, p
    return (p[0], p[1]), (q[0], q[1])


def road_point(eng: Engine, cp: Checkpoint, a: LonLat, b: LonLat | None) -> LonLat:
    """The point on the road with the least added routed distance between A and B."""
    samples = []
    for line in cp.lines:
        samples += [p for p, _ in geodesy.sample_every([tuple(x) for x in line], ROAD_SAMPLE_M)]
    best = best_candidate(eng, samples, a, b, 0.0, require_no_spur=False)
    if best is None:
        raise NoRoute(f"no walking route uses {cp.label}")
    return best["point"]
