"""Point-to-point solving (blueprint section 8 steps 1 to 8 and 11, as amended after Phases 2 and 3).

Every length used for a decision that the user sees is a measured foot length
of a routed geometry. The matrix only ranks checkpoint orders.

The run's stops become route points (passnear.plan_stops): must_reach places are
break locations; pass-near places, junctions, bridges and roads are through vias.
Stop positions along a run are measured on its geometry, because an engine does
not split legs at through vias.
"""

import math
from dataclasses import dataclass, field

from athlete_engine import geodesy

from .engine import Engine, NoRoute, Routed
from .models import (Candidate, Conflict, EndPoint, Fix, Flag, RouteRequest, Saving, StopOnRoute)
from .ordering import k_best_orders, preferred_orders
from .passnear import PASS_NEAR_M, plan_stops

LonLat = tuple[float, float]
SNAP_LIMIT_M = 150.0          # section 8 step 1
SNAP_WINDOW_FRACTION = 0.005  # amendment: snap the cut to a junction only within 0.5% of the target
ORDERS_TO_ROUTE = 2           # matrix-ranked orders routed and measured before choosing


class Infeasible(Exception):
    def __init__(self, conflict: Conflict):
        super().__init__(conflict.message)
        self.conflict = conflict


@dataclass
class Base:
    order: list[int]            # indices into request.checkpoints
    routed: Routed | None       # None when there are no checkpoints
    foot_m: float
    points: list[LonLat] = field(default_factory=list)       # start + every via, in order
    through: set[int] = field(default_factory=set)            # indices of through vias in points
    stop_at: dict[int, int] = field(default_factory=dict)     # checkpoint index -> index in points
    picks: dict[int, dict] = field(default_factory=dict)      # checkpoint index -> how it is passed
    flags: list[Flag] = field(default_factory=list)

    @property
    def stop_points(self) -> dict[int, LonLat]:
        return {i: self.points[j] for i, j in self.stop_at.items()}


# ------------------------------------------------------------------ checks

def check_snapping(engine: Engine, req: RouteRequest) -> None:
    """Every point must be near the network: 150 m for points the route goes through, 1 km for a pass-near place."""
    named = [("start", req.start, SNAP_LIMIT_M)]
    for c in req.checkpoints:
        limit = PASS_NEAR_M if c.pass_near else SNAP_LIMIT_M
        point = c.lonlat if c.kind not in ("bridge", "road") else tuple(c.lines[0][0])
        named.append((c.label, point, limit))
    if req.direction and req.direction.kind == "towards_place":
        named.append((req.direction.place.label or "target", req.direction.place.lonlat, SNAP_LIMIT_M))
    snapped = engine.locate([p if isinstance(p, tuple) else p.lonlat for _, p, _ in named])
    for (label, p, limit), s in zip(named, snapped):
        p = p if isinstance(p, tuple) else p.lonlat
        off = None if s is None else geodesy.distance_m(p, s)
        if off is None or off > limit:
            raise Infeasible(Conflict(
                kind="snap_too_far", pair=[label],
                message=(f"{label} is {off:.0f} m from the nearest walkable path (limit {limit:.0f} m)"
                         if off is not None else f"{label} is not near any walkable path"),
                fixes=[Fix(action="drop_checkpoint", label=label)] if label in {c.label for c in req.checkpoints} else []))


def disconnected_conflict(labels: list[str], matrix) -> Conflict:
    """Name the first disconnected pair (ferries are always excluded)."""
    pair = []
    for i, row in enumerate(matrix):
        for j, cell in enumerate(row):
            if i != j and cell is None:
                pair = [labels[i], labels[j]]
                break
        if pair:
            break
    msg = f"There is no walking route between {pair[0]} and {pair[1]}" if pair else "Some points are not connected"
    return Conflict(kind="disconnected", message=msg, pair=pair)


# ------------------------------------------------------------------ base route and gate

def route_order(engine: Engine, start: LonLat, stops: list[LonLat], order: list[int]) -> Routed:
    return engine.route([start, *(stops[i] for i in order)])


def minimum_route(engine: Engine, start: LonLat, stops: list[LonLat], target: LonLat | None,
                  fixed: bool, upper_m: float | None = None, route: bool = True) -> Base | None:
    """The base route through all stops: matrix-ranked orders, the best few routed and measured.

    route=False only ranks: it returns the preferred order from the walking matrix, unrouted (foot_m 0).
    """
    if not stops:
        return Base(order=[], routed=None, foot_m=0.0)
    if fixed and not route:
        return Base(order=list(range(len(stops))), routed=None, foot_m=0.0)
    if fixed:
        try:
            r = route_order(engine, start, stops, list(range(len(stops))))
        except NoRoute:
            return None
        return Base(order=list(range(len(stops))), routed=r, foot_m=r.foot_m)

    pts = [start, *stops] + ([target] if target else [])
    m = engine.matrix(pts)
    idx = list(range(1, len(stops) + 1))
    orders = preferred_orders(m, idx, 0, len(pts) - 1 if target else None)
    if not orders:
        return None
    if not route:
        return Base(order=[i - 1 for i in orders[0]], routed=None, foot_m=0.0)
    cheapest = k_best_orders(m, idx, 0, k=1)[0][1]
    to_route = []
    for o in [orders[0], cheapest] + orders[1:]:
        if o not in to_route:
            to_route.append(o)
        if len(to_route) >= ORDERS_TO_ROUTE:
            break
    measured = []
    for o in to_route:
        order = [i - 1 for i in o]
        try:
            r = route_order(engine, start, stops, order)
        except NoRoute:
            continue
        measured.append(Base(order=order, routed=r, foot_m=r.foot_m))
    if not measured:
        return None
    shortest = min(measured, key=lambda b: b.foot_m)
    preferred = measured[0]
    # Prefer the towards-target order only if it fits and costs at most 2% more on foot.
    if preferred is not shortest and preferred.foot_m <= shortest.foot_m * 1.02 and \
            (upper_m is None or preferred.foot_m <= upper_m):
        return preferred
    return shortest


def all_must_reach(req: RouteRequest) -> bool:
    return all(c.kind == "place" and c.must_reach for c in req.checkpoints)


def anchors(req: RouteRequest) -> list[LonLat]:
    """One point per checkpoint for ordering (bridges and roads: their middle)."""
    return [c.lonlat for c in req.checkpoints]


def planned_base(req: RouteRequest, engine: Engine, start: LonLat, target: LonLat | None,
                 upper_m: float | None, order: list[int] | None = None) -> Base | None:
    """The run's minimum route through every stop, in the chosen order, as this engine walks it.

    All must_reach places: matrix-ranked orders routed and measured (Phase 3 behaviour). Otherwise the order
    comes from the walking matrix over the stops' anchor points, then each stop is planned (pass near, bridge,
    road, junction) with this engine and the run through the planned points is routed and measured.
    """
    stops = anchors(req)
    if not stops:
        return Base(order=[], routed=None, foot_m=0.0, points=[start])
    if all_must_reach(req):
        base = minimum_route(engine, start, stops, target, req.checkpoint_order == "fixed", upper_m) \
            if order is None else _routed_order(engine, start, stops, order)
        if base is not None:
            base.points = [start, *(stops[i] for i in base.order)]
            base.stop_at = {i: k + 1 for k, i in enumerate(base.order)}
            base.picks = {i: {"how": "reached", "point": stops[i]} for i in base.order}
        return base
    if order is None:
        ranked = minimum_route(engine, start, stops, target, req.checkpoint_order == "fixed", upper_m, route=False)
        if ranked is None:
            return None
        order = ranked.order
    plan = plan_stops(req, engine, order, start, target)
    routed = engine.route(plan.points, through=plan.through)
    return Base(order=order, routed=routed, foot_m=routed.foot_m, points=plan.points, through=plan.through,
                stop_at=plan.stop_at, picks=plan.picks, flags=plan.flags)


def _routed_order(engine: Engine, start: LonLat, stops: list[LonLat], order: list[int]) -> Base | None:
    try:
        r = route_order(engine, start, stops, order)
    except NoRoute:
        return None
    return Base(order=order, routed=r, foot_m=r.foot_m)


def build_conflict(req: RouteRequest, engine: Engine, base: Base,
                   start: LonLat, stops: list[LonLat], target: LonLat | None) -> Conflict:
    upper = req.upper_m
    fixed = req.checkpoint_order == "fixed"
    savings: list[Saving] = []
    for i, cp in enumerate(req.checkpoints):
        if cp.role != "checkpoint":
            continue   # via and must_use items are never dropped
        if all_must_reach(req):
            rest = [p for j, p in enumerate(stops) if j != i]
            alt = minimum_route(engine, start, rest, target, fixed)
            alt_m = None if alt is None else alt.foot_m
        else:
            alt_m = without_stop(engine, base, i)
        if alt_m is not None:
            savings.append(Saving(action="drop_checkpoint", label=cp.label, saves_m=round(base.foot_m - alt_m, 1),
                                  fits=alt_m <= upper))
    value = math.ceil(base.foot_m / 100.0) * 100.0
    fixes = [Fix(action="set_distance", value_m=value)]
    for s in savings:
        if s.fits:
            fixes += [Fix(action="drop_checkpoint", label=s.label), Fix(action="make_optional", label=s.label)]
    names = [req.checkpoints[i].label for i in base.order if req.checkpoints[i].role == "checkpoint"]
    over = base.foot_m - req.target_distance_m
    return Conflict(
        kind="checkpoints_exceed_distance", requested_m=req.target_distance_m, minimum_m=round(base.foot_m, 1),
        overshoot_m=round(over, 1), order=names, savings=savings, fixes=fixes,
        message=(f"These {len(names)} stops need at least {base.foot_m / 1000:.1f} km on foot, "
                 f"{over / 1000:.1f} km over the {req.target_distance_m / 1000:.1f} km requested."))


def without_stop(engine: Engine, base: Base, i: int) -> float | None:
    """Routed length of the run through the same planned points without checkpoint i's points."""
    first = base.stop_at[i]
    k = base.order.index(i)
    prev_end = base.stop_at[base.order[k - 1]] if k > 0 else 0
    drop = set(range(prev_end + 1, first + 1))
    keep = [j for j in range(len(base.points)) if j not in drop]
    if len(keep) < 2:
        return 0.0
    try:
        r = engine.route([base.points[j] for j in keep],
                         through={n for n, j in enumerate(keep) if j in base.through})
    except NoRoute:
        return None
    return r.foot_m


# ------------------------------------------------------------------ candidate assembly

def end_label(routed: Routed) -> str | None:
    for e in reversed(routed.edges):
        if e.names:
            return e.names[0]
    return None


def positions_along(shape: list[LonLat], points: list[LonLat]) -> list[tuple[float, int]]:
    """(distance along the shape, vertex index) of each point, in order: nearest vertex searching forward."""
    cum = geodesy.cumulative_m(shape)
    out, at = [], 0
    for p in points:
        j = min(range(at, len(shape)), key=lambda k: geodesy.distance_m(shape[k], p)) if at < len(shape) else len(shape) - 1
        out.append((cum[j], j))
        at = j
    return out


def make_candidate(req: RouteRequest, routed: Routed, option: str, end_kind: str, base: Base | None,
                   extra_flags: list[Flag], alternative: str, keep: list[int] | None = None) -> Candidate:
    """Assemble a candidate. `keep` limits the stops (over budget: the ones before the cut)."""
    shape = routed.shape
    stops = [StopOnRoute(role="start", label=req.start.label, requested=req.start,
                         snapped_lon=shape[0][0], snapped_lat=shape[0][1],
                         offset_m=geodesy.distance_m(req.start.lonlat, shape[0]), at_m=0.0)]
    order = [] if base is None else [i for i in base.order if keep is None or i in keep]
    at = positions_along(shape, [base.stop_points[i] for i in order]) if order else []
    foot_over_geom = routed.foot_m / (routed.geom_m or 1.0)
    for i, (at_m, j) in zip(order, at):
        cp = req.checkpoints[i]
        p = shape[j]    # where the route passes the stop
        pick = base.picks.get(i, {})
        stops.append(StopOnRoute(role=cp.role, label=cp.label, requested=cp, snapped_lon=p[0], snapped_lat=p[1],
                                 offset_m=round(geodesy.distance_m(cp.lonlat, p), 1),
                                 at_m=round(at_m * foot_over_geom, 1), kind=cp.kind, must_reach=cp.must_reach,
                                 pass_walk_m=pick.get("walk_m"), how=pick.get("how")))
    end = shape[-1]
    stops.append(StopOnRoute(role="end", label=end_label(routed), requested={"lon": end[0], "lat": end[1]},
                             snapped_lon=end[0], snapped_lat=end[1], offset_m=0.0, at_m=round(routed.foot_m, 1)))
    road_m: dict[str, float] = {}
    for e in routed.edges:
        if e.use != "ferry":
            road_m[e.road_class] = road_m.get(e.road_class, 0.0) + e.length_m
    flags = list(routed.flags) + ([] if base is None else [f for f in base.flags if keep is None or
                                                           f.data.get("label") in {req.checkpoints[i].label for i in order}])
    return Candidate(
        label=alternative, option=option, geometry=shape, length_m=routed.geom_m, foot_m=routed.foot_m,
        ferry_m=routed.ferry_m, engine_length_m=routed.engine_m, sphere_length_m=routed.sphere_m,
        engine=routed.engine, edge_count=len(routed.edges),
        deviation_m=routed.foot_m - req.target_distance_m, duration_s=routed.duration_s, stops=stops,
        end=EndPoint(lon=end[0], lat=end[1], label=end_label(routed), kind=end_kind),
        road_class_m={k: round(v, 1) for k, v in road_m.items()},
        edge_ids=[e.id for e in routed.edges], flags=flags + extra_flags)


# ------------------------------------------------------------------ over budget: cut the full route at the target

def cut_at_target(req: RouteRequest, engine: Engine, base: Base, full: Routed
                  ) -> tuple[Routed, list[int], str, list[Flag], dict]:
    """The full route through the stops cut at the requested distance (Phase 3 amendment 6).

    Keeps the points reached before the cut, cuts the next stretch at the remainder (snapped to a junction
    inside the window) and re-routes the run as one request. Returns (routed, kept checkpoints, end kind,
    flags, facts).
    """
    budget = req.target_distance_m
    shape = full.shape
    scale = full.foot_m / (full.geom_m or 1.0)
    at = [a * scale for a, _ in positions_along(shape, base.points)]
    last = max(j for j in range(len(base.points)) if at[j] <= budget)
    if last >= len(base.points) - 1:
        raise NoRoute("the route through the stops fits the budget; nothing to cut")
    prefix = base.points[:last + 1]
    through = {j for j in base.through if j <= last}
    # Cut the full route's own geometry (its edges and junctions are measured from the start): routing the
    # next stretch separately could begin with a U-turn at a through via that the one-request re-route
    # cannot repeat.
    routed, kind, flags, facts = truncate(req, engine, prefix, full, budget, through=through)
    kept = [i for i in base.order if base.stop_at[i] <= last]
    facts["dropped"] = [req.checkpoints[i].label for i in base.order if i not in kept]
    return routed, kept, kind, flags, facts


# ------------------------------------------------------------------ case A: truncation

def cut_point(tail: Routed, remainder_m: float, target_m: float) -> tuple[LonLat, str, float]:
    """Where to end on the tail: the nearest junction within the snap window, else the exact distance."""
    window = SNAP_WINDOW_FRACTION * target_m
    near = [j for j in tail.junctions if abs(j.at_m - remainder_m) <= window and 0 < j.at_m < tail.foot_m]
    if near:
        j = min(near, key=lambda j: abs(j.at_m - remainder_m))
        return j.point, "junction", j.at_m
    return tail.point_at_foot(remainder_m), "mid_road", remainder_m


def truncate(req: RouteRequest, engine: Engine, prefix: list[LonLat], tail: Routed,
             remainder_m: float, goal_m: float | None = None,
             through: set[int] | None = None) -> tuple[Routed, str, list[Flag], dict]:
    """Cut the tail at the remainder and re-route the whole run (prefix points, then the cut) as one request.

    `prefix` is the start followed by every point the run must pass, in order; the tail begins at its last
    point. `goal_m` is the foot length the re-routed run should have (default: the request's budget; an
    out-and-back passes half of it).
    """
    goal = req.target_distance_m if goal_m is None else goal_m
    tolerance = req.tolerance_m * goal / req.target_distance_m
    point, kind, at = cut_point(tail, remainder_m, goal)
    flags: list[Flag] = []
    seq = [*prefix, point]
    through = through or set()
    routed = engine.route(seq, through=through, detail=True)
    facts = {"cut_at_m": round(at, 1), "end_kind": kind}
    # One correction if the re-route lands off target (e.g. the end snapped to a neighbouring edge).
    miss = goal - routed.foot_m
    if abs(miss) > tolerance / 2 and 0 < remainder_m + miss < tail.foot_m:
        point = tail.point_at_foot(remainder_m + miss)
        kind = "mid_road"
        retry = engine.route([*seq[:-1], point], through=through, detail=True)
        if abs(goal - retry.foot_m) < abs(miss):
            routed = retry
            facts["corrected_m"] = round(miss, 1)
    if abs(goal - routed.foot_m) > tolerance:
        flags.append(Flag(code="reroute_mismatch",
                          message=f"re-routed run is {routed.foot_m:.0f} m on foot against {goal:.0f} m requested",
                          data={"foot_m": routed.foot_m}))
    if kind == "mid_road":
        flags.append(Flag(code="endpoint_mid_road",
                          message="no junction within the snap window; the run ends at the exact distance"))
    return routed, kind, flags, facts


# ------------------------------------------------------------------ bearing-only endpoints

SECTOR_DEG = 45.0          # section 8 step 8: sample the contour within 45 degrees of the bearing
CONTOUR_FACTORS = (1.3, 2.0)
SAMPLES = 7
GOOD_ENOUGH_DEG = 10.0     # stop searching once an endpoint is this close to the bearing


@dataclass
class BearingTail:
    tail: Routed
    bearing_error: float


def bearing_tail(engine: Engine, origin: LonLat, bearing: float, distance_m: float,
                 measure_from: LonLat) -> BearingTail | None:
    """A routed path from origin, at least distance_m on foot, ending as close as possible to the bearing.

    Samples isodistance contours larger than the distance (contour vertices are often much nearer by
    route than the contour value), keeps vertices within the sector, routes to each, and keeps routes
    long enough to be cut at exactly distance_m. The bearing error is judged from `measure_from`
    (the start of the run) to the point where the cut will land. The best over all contours wins.
    """
    best: BearingTail | None = None
    for factor in CONTOUR_FACTORS:
        ring = engine.isodistance_ring(origin, distance_m * factor / 1000.0)
        in_sector = [p for p in ring
                     if geodesy.angle_between_deg(geodesy.bearing_deg(origin, p), bearing) <= SECTOR_DEG]
        if not in_sector:
            continue
        in_sector.sort(key=lambda p: geodesy.angle_between_deg(geodesy.bearing_deg(origin, p), bearing))
        step = max(1, len(in_sector) // SAMPLES)
        for p in in_sector[::step][:SAMPLES]:
            try:
                tail = engine.route([origin, p], detail=True)
            except NoRoute:
                continue
            if tail.foot_m < distance_m:
                continue
            end = tail.point_at_foot(distance_m)
            err = geodesy.angle_between_deg(geodesy.bearing_deg(measure_from, end), bearing)
            if best is None or err < best.bearing_error:
                best = BearingTail(tail=tail, bearing_error=err)
        if best is not None and best.bearing_error <= GOOD_ENOUGH_DEG:
            break
    return best
