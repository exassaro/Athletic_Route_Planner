"""Loops without stops (blueprint section 8 "Loops and out-and-back"; Phase 3 amendments 21 to 23).

Three through vias on a closed shape through the start: a circle or an oval whose
straight-line perimeter is D divided by a circuity factor (1.3), leaning towards
the requested direction. The run start, V1, V2, V3, start is routed by the
generator (GraphHopper R5, amendment 23) and measured from its geometry; the
shape is then scaled (secant / bracketing on the measured length) up to 5 times
until the loop is within min(500 m, 3% of D) of the target (amendment 22).
Several rotations and shapes run in parallel; the best-scored loops that differ
are kept.

Straight-line geometry only places the vias; every length that decides anything
is a measured foot length of a routed geometry.
"""

import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from athlete_engine import geodesy

from .engine import Engine, NoRoute, Routed
from .lengthen import RETRACE_OK_M, _next_offset, retraced_m
from .models import RouteRequest

LonLat = tuple[float, float]

CIRCUITY = 1.3                 # section 8: first guess of route length over straight-line perimeter
SNAP_LIMIT_M = 400.0           # a via further than this from a path lies in water or empty land (shaping only)
FREE_ROTATIONS = 6             # no direction: shapes leaning every 60 degrees
LEAN_OFFSETS = (0.0, -30.0, 30.0, -60.0, 60.0)   # with a direction: around the requested bearing
OVAL_ASPECT = 1.8              # an oval is this much longer (along the lean) than wide
VIA_ANGLES = (90.0, 0.0, -90.0)   # positions on the shape, seen from its centre; the start is at 180
TO_DETAIL = 4                  # best shapes routed again with edge detail and scored


@dataclass
class Shape:
    lean_deg: float            # bearing from the start towards the shape's centre
    aspect: float              # 1.0 circle; > 1 oval stretched along the lean

    @property
    def name(self) -> str:
        return f"{'circle' if self.aspect == 1.0 else 'oval'} {self.lean_deg % 360:.0f}"


@dataclass
class LoopTry:
    shape: Shape
    scale_m: float
    points: list[LonLat]
    foot_m: float | None
    retraced_m: float = 0.0
    reason: str | None = None   # why this size could not be routed


@dataclass
class ShapeResult:
    shape: Shape
    tries: list[LoopTry] = field(default_factory=list)
    best: LoopTry | None = None


def goal_m(req: RouteRequest) -> float:
    """Amendment 22: iterate until within the smaller of the tolerance and 3% of the target."""
    return min(req.tolerance_m, 0.03 * req.target_distance_m)


def lean_bearing(req: RouteRequest) -> float | None:
    d = req.direction
    if d is None:
        return None
    if d.kind == "bearing":
        return d.degrees
    return geodesy.bearing_deg(req.start.lonlat, d.place.lonlat)


def shapes_for(req: RouteRequest) -> list[Shape]:
    lean = lean_bearing(req)
    if lean is None:
        circles = [Shape((k * 360.0 / FREE_ROTATIONS) % 360, 1.0) for k in range(FREE_ROTATIONS)]
        ovals = [Shape((k * 360.0 / FREE_ROTATIONS + 30.0) % 360, OVAL_ASPECT) for k in range(0, FREE_ROTATIONS, 3)]
        return circles + ovals
    return [Shape((lean + o) % 360, 1.0) for o in LEAN_OFFSETS] + \
           [Shape(lean % 360, OVAL_ASPECT), Shape((lean - 30.0) % 360, OVAL_ASPECT), Shape((lean + 30.0) % 360, OVAL_ASPECT)]


def _axes(aspect: float) -> tuple[float, float]:
    return math.sqrt(aspect), 1.0 / math.sqrt(aspect)


def perimeter_per_scale(aspect: float) -> float:
    """Straight-line perimeter of the shape at scale 1 m (Ramanujan's ellipse approximation)."""
    a, b = _axes(aspect)
    return math.pi * (3 * (a + b) - math.sqrt((3 * a + b) * (a + 3 * b)))


Adjust = tuple[float, float]       # per via: (factor towards the shape's centre, degrees moved along the shape)
NO_ADJUST: Adjust = (1.0, 0.0)
PULL_IN = (0.75, 0.5)              # a via in water or empty land is pulled towards the centre
SPUR_MOVES: tuple[Adjust, ...] = ((0.75, 0.0), (1.0, 20.0), (1.0, -20.0))   # a via that makes a spur is moved
SPUR_VIA_NEAR_M = 400.0            # the via nearest a retraced stretch (within this) is blamed for it
MAX_ROUTES = 7                     # routed tries per shape: sizes plus spur moves


def via_points(start: LonLat, shape: Shape, scale_m: float, adjust: list[Adjust] | None = None) -> list[LonLat]:
    """The three vias on the shape through the start (placement only, never a distance)."""
    a, b = _axes(shape.aspect)
    a, b = a * scale_m, b * scale_m
    centre = geodesy.destination(start, shape.lean_deg, a)
    out = []
    for k, phi in enumerate(VIA_ANGLES):
        f, dphi = (adjust or [NO_ADJUST] * 3)[k]
        x, y = a * math.cos(math.radians(phi + dphi)), b * math.sin(math.radians(phi + dphi))
        out.append(geodesy.destination(centre, shape.lean_deg + math.degrees(math.atan2(y, x)), f * math.hypot(x, y)))
    return out


def retraced_points(shape: list[LonLat]) -> list[LonLat]:
    """Midpoints of the segments walked a second time (see lengthen.retraced_m)."""
    seen: set = set()
    out = []
    for p, q in zip(shape, shape[1:]):
        a, b = (round(p[0], 6), round(p[1], 6)), (round(q[0], 6), round(q[1], 6))
        if a == b:
            continue
        key = (a, b) if a < b else (b, a)
        if key in seen:
            out.append(((p[0] + q[0]) / 2, (p[1] + q[1]) / 2))
        else:
            seen.add(key)
    return out


STUB_VIA_NEAR_M = 150.0            # a turn-round this close to a via is the via's dead-end stub


def stub_bases(shape: list[LonLat]) -> list[tuple[LonLat, LonLat]]:
    """(tip, base) of every turn-round in the geometry: the route walks to the tip and back the same way to
    the base, where it left the road it came along."""
    key = [(round(p[0], 6), round(p[1], 6)) for p in shape]
    out = []
    for i in range(1, len(key) - 1):
        if key[i - 1] != key[i + 1] or key[i] == key[i - 1]:
            continue
        k = 1
        while i - k - 1 >= 0 and i + k + 1 < len(key) and key[i - k - 1] == key[i + k + 1]:
            k += 1
        out.append((shape[i], shape[i - k]))
    return out


def unstub(snapped: list[LonLat], shape: list[LonLat]) -> list[LonLat] | None:
    """Vias moved to the base of their dead-end stub (None if no via has one)."""
    tips = stub_bases(shape)
    moved = list(snapped)
    for k, v in enumerate(snapped):
        near = [(geodesy.distance_m(v, tip), base) for tip, base in tips]
        near = [x for x in near if x[0] <= STUB_VIA_NEAR_M]
        if near:
            moved[k] = min(near)[1]
    return moved if moved != list(snapped) else None


def _rank(t: LoopTry, target_m: float, goal: float) -> tuple:
    miss = abs(target_m - t.foot_m)
    return (0 if miss <= goal and t.retraced_m < RETRACE_OK_M else 1, round(miss + t.retraced_m, 1))


def _snap_vias(engine: Engine, start: LonLat, shape: Shape, scale: float,
               adjust: list[Adjust]) -> tuple[list[LonLat] | None, list[Adjust], str | None]:
    """Snap the vias; a via that is not near a path is pulled towards the centre (PULL_IN) until it is."""
    adjust = list(adjust)
    raw = via_points(start, shape, scale, adjust)
    snapped = engine.locate(raw)
    for k in range(3):
        if snapped[k] is not None and geodesy.distance_m(raw[k], snapped[k]) <= SNAP_LIMIT_M:
            continue
        for f in PULL_IN:
            adjust[k] = (f * adjust[k][0], adjust[k][1])
            p = via_points(start, shape, scale, adjust)[k]
            s = engine.locate([p])[0]
            if s is not None and geodesy.distance_m(p, s) <= SNAP_LIMIT_M:
                snapped[k] = s
                break
            adjust[k] = (adjust[k][0] / f, adjust[k][1])
        else:
            return None, adjust, f"via {k + 1} is not near a path"
    return snapped, adjust, None


def stem_vertices(shape: list[LonLat]) -> int:
    """Vertices of the loop's stem: the stretch from the start that the loop also walks back at its end (a start
    on a lane gives every loop this "lollipop" stem; it is not a spur)."""
    key = [(round(p[0], 6), round(p[1], 6)) for p in shape]
    k = 0
    while k < len(key) // 2 and key[k] == key[-1 - k]:
        k += 1
    return k


def loop_retrace(shape: list[LonLat]) -> tuple[float, list[LonLat]]:
    """Road walked twice on the loop without its stem: (metres, midpoints of those stretches)."""
    k = stem_vertices(shape)
    inner = shape[max(0, k - 1):len(shape) - max(0, k - 1)] if k > 1 else shape
    return retraced_m(inner), retraced_points(inner)


def search_shape(engine: Engine, start: LonLat, shape: Shape, target_m: float, goal: float) -> ShapeResult:
    """Scale one shape until its routed loop is within the goal; move a via that makes a spur."""
    out = ShapeResult(shape=shape)
    scale = target_m / CIRCUITY / perimeter_per_scale(shape.aspect)
    first_scale = scale
    seen = [(0.0, 0.0)]          # scale 0: no loop
    adjust: list[Adjust] = [NO_ADJUST] * 3
    moves: dict[int, int] = {}   # via index -> spur moves used
    for _ in range(MAX_ROUTES):
        snapped, adjust, reason = _snap_vias(engine, start, shape, scale, adjust)
        if snapped is None:
            out.tries.append(LoopTry(shape, scale, [], None, reason=reason))
            break
        points = [start, *snapped, start]
        try:
            r = engine.route(points, through={1, 2, 3})
        except NoRoute as err:
            out.tries.append(LoopTry(shape, scale, points, None, reason=str(err)))
            break
        cleaner = unstub(snapped, r.shape)
        if cleaner is not None:
            # The route turns round at a via on a dead-end stub: put the via where the route left the road.
            try:
                r2 = engine.route([start, *cleaner, start], through={1, 2, 3})
                if loop_retrace(r2.shape)[0] <= loop_retrace(r.shape)[0]:
                    snapped, points, r = cleaner, [start, *cleaner, start], r2
            except NoRoute:
                pass
        again_m, again = loop_retrace(r.shape)
        t = LoopTry(shape, scale, points, r.foot_m, again_m)
        repeat = any(x.foot_m is not None and abs(x.foot_m - t.foot_m) < 1.0 for x in out.tries)
        out.tries.append(t)
        if out.best is None or _rank(t, target_m, goal) < _rank(out.best, target_m, goal):
            out.best = t
        if t.retraced_m >= RETRACE_OK_M and again:
            # A spur: move the via nearest the retraced stretch and route the same size again. A move that
            # leaves the route unchanged (the via snapped back to the same road) is followed by the next move.
            near = [(min(geodesy.distance_m(v, q) for q in again), k) for k, v in enumerate(snapped)]
            dist, k = min(near)
            if dist <= SPUR_VIA_NEAR_M and moves.get(k, 0) < len(SPUR_MOVES):
                f0, d0 = SPUR_MOVES[moves.get(k, 0)]
                adjust[k] = (f0, d0)
                moves[k] = moves.get(k, 0) + 1
                continue
        if repeat:
            break    # the vias snapped back onto the same roads: nothing new to try for this shape
        if abs(target_m - r.foot_m) <= goal:
            break
        seen.append((scale, r.foot_m))
        nxt = _next_offset(seen, target_m)
        if nxt is None:
            break
        nxt = min(max(nxt, 0.3 * first_scale), 3.0 * first_scale)
        if any(abs(nxt - s) < 1.0 for s, _ in seen):
            break
        scale = nxt
    return out


def loop_centroid_bearing(start: LonLat, shape: list[LonLat]) -> float:
    """Bearing from the start to the mean of the loop's vertices sampled every 100 m (the loop's lean)."""
    pts = [p for p, _ in geodesy.sample_every(shape, 100.0)] or shape
    lon = sum(p[0] for p in pts) / len(pts)
    lat = sum(p[1] for p in pts) / len(pts)
    return geodesy.bearing_deg(start, (lon, lat))


def search_loops(req: RouteRequest, engine: Engine) -> tuple[list[tuple[ShapeResult, Routed]], dict]:
    """Every shape in parallel; the best few within tolerance are routed again with edge detail.

    Returns [(shape result, detailed route)] best first, and facts about every shape tried.
    """
    start = req.start.lonlat
    target, goal = req.target_distance_m, goal_m(req)
    shapes = shapes_for(req)
    with ThreadPoolExecutor(max_workers=len(shapes)) as pool:
        results = list(pool.map(lambda s: search_shape(engine, start, s, target, goal), shapes))
    facts = {"goal_m": round(goal, 1), "circuity": CIRCUITY, "shapes": [
        {"shape": r.shape.name, "tries": [{"scale_m": round(t.scale_m, 1),
                                           "foot_m": None if t.foot_m is None else round(t.foot_m, 1),
                                           "retraced_m": round(t.retraced_m, 1), **({"reason": t.reason} if t.reason else {})}
                                          for t in r.tries]} for r in results]}
    usable = [r for r in results if r.best is not None and abs(r.best.foot_m - target) <= req.tolerance_m]
    facts["shapes_within_tolerance"] = len(usable)
    usable.sort(key=lambda r: _rank(r.best, target, goal))
    picked = usable[:TO_DETAIL]

    def detail(r: ShapeResult):
        try:
            return r, engine.route(r.best.points, through={1, 2, 3}, detail=True)
        except NoRoute:
            return None

    with ThreadPoolExecutor(max_workers=max(1, len(picked))) as pool:
        routed = [x for x in pool.map(detail, picked) if x is not None]
    return routed, facts


LEAN_WEIGHT = 0.02             # score points per degree between the loop's lean and the requested direction


def solve_loop(req: RouteRequest, engine: Engine) -> tuple[list, dict, list]:
    """Loops for a request without stops: (candidates best first, labelled loop_1.., facts, rejections)."""
    from .p2p import make_candidate          # noqa: PLC0415  (p2p imports lengthen, which loop imports)
    from .scoring import annotate, diversify  # noqa: PLC0415

    routed, facts = search_loops(req, engine)
    lean = lean_bearing(req)
    start = req.start.lonlat
    scored, rejected = [], []
    for r, rt in routed:
        cand = make_candidate(req, rt, "main", "start", None, [], "loop_1")
        cand, fails = annotate(engine, req, cand, rt.edges)
        if fails:
            rejected.append(f"{r.shape.name}: " + "; ".join(fails))
            continue
        if lean is not None:
            err = geodesy.angle_between_deg(loop_centroid_bearing(start, cand.geometry), lean)
            cand.score = round((cand.score or 0.0) + LEAN_WEIGHT * err, 3)
            facts.setdefault("lean_error_deg", {})[r.shape.name] = round(err, 1)
        scored.append((r.shape.name, cand, {e.key for e in rt.edges if e.use != "ferry"}))
    scored.sort(key=lambda x: x[1].score)
    facts["shapes_valid"] = len(scored)
    # Amendment 22: loops land within min(500 m, 3% of D). One beyond that goal (but within the tolerance) is
    # offered only when no loop reaches the goal.
    goal = goal_m(req)
    on_goal = [x for x in scored if abs(x[1].deviation_m) <= goal]
    if on_goal and len(on_goal) < len(scored):
        facts["beyond_goal_not_offered"] = [name for name, cand, _ in scored if abs(cand.deviation_m) > goal]
    kept = diversify([(name, [(cand, keys)]) for name, cand, keys in (on_goal or scored)], req.alternatives)
    names = {id(cand): name for name, cand, _ in scored}
    facts["kept"] = []
    for k, cand in enumerate(kept, start=1):
        cand.label = f"loop_{k}"
        facts["kept"].append(names[id(cand)])
    if rejected:
        facts["rejected"] = rejected
    return kept, facts, rejected
