"""Point-to-point solving (blueprint section 8 steps 1 to 8 and 11, as amended after Phase 2).

Every length used for a decision that the user sees is a measured foot length
of a routed geometry. The matrix only ranks checkpoint orders.
"""

import math
from dataclasses import dataclass

from athlete_engine import geodesy

from .engine import Engine, NoRoute, Routed
from .models import (Candidate, Conflict, EndPoint, Fix, Flag, RouteRequest, Saving, StopOnRoute)
from .ordering import k_best_orders, preferred_orders

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


# ------------------------------------------------------------------ checks

def check_snapping(engine: Engine, req: RouteRequest) -> None:
    named = [("start", req.start)] + [(c.label, c) for c in req.checkpoints]
    if req.direction and req.direction.kind == "towards_place":
        named.append((req.direction.place.label or "target", req.direction.place))
    snapped = engine.locate([p.lonlat for _, p in named])
    for (label, p), s in zip(named, snapped):
        off = None if s is None else geodesy.distance_m(p.lonlat, s)
        if off is None or off > SNAP_LIMIT_M:
            raise Infeasible(Conflict(
                kind="snap_too_far", pair=[label],
                message=(f"{label} is {off:.0f} m from the nearest walkable path (limit {SNAP_LIMIT_M:.0f} m)"
                         if off is not None else f"{label} is not near any walkable path"),
                fixes=[Fix(action="drop_checkpoint", label=label)] if label in {c.label for c in req.checkpoints} else []))


def disconnected_conflict(labels: list[str], matrix, matrix_with_ferries=None) -> Conflict:
    """Name the first disconnected pair, and whether allowing ferries would connect everything."""
    pair = []
    for i, row in enumerate(matrix):
        for j, cell in enumerate(row):
            if i != j and cell is None:
                pair = [labels[i], labels[j]]
                break
        if pair:
            break
    blocking = None
    if matrix_with_ferries is not None and all(c is not None for row in matrix_with_ferries for c in row):
        blocking = "ferries"
    msg = f"There is no walking route between {pair[0]} and {pair[1]}" if pair else "Some points are not connected"
    if blocking:
        msg += " with ferries excluded"
    return Conflict(kind="disconnected", message=msg, pair=pair, blocking_preference=blocking,
                    fixes=[Fix(action="allow", preference="ferries")] if blocking else [])


# ------------------------------------------------------------------ base route and gate

def route_order(engine: Engine, start: LonLat, stops: list[LonLat], order: list[int]) -> Routed:
    return engine.route([start, *(stops[i] for i in order)])


def minimum_route(engine: Engine, start: LonLat, stops: list[LonLat], target: LonLat | None,
                  fixed: bool, upper_m: float | None = None) -> Base | None:
    """The base route through all stops: matrix-ranked orders, the best few routed and measured."""
    if not stops:
        return Base(order=[], routed=None, foot_m=0.0)
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


def build_conflict(req: RouteRequest, engine: Engine, ferry_engine: Engine | None, base: Base,
                   start: LonLat, stops: list[LonLat], target: LonLat | None) -> Conflict:
    upper = req.target_distance_m * (1 + req.tolerance_pct / 100)
    fixed = req.checkpoint_order == "fixed"
    savings: list[Saving] = []
    for i, cp in enumerate(req.checkpoints):
        rest = [p for j, p in enumerate(stops) if j != i]
        alt = minimum_route(engine, start, rest, target, fixed)
        if alt is not None:
            savings.append(Saving(action="drop_checkpoint", label=cp.label, saves_m=round(base.foot_m - alt.foot_m, 1),
                                  fits=alt.foot_m <= upper))
    if ferry_engine is not None:
        alt = minimum_route(ferry_engine, start, stops, target, fixed)
        if alt is not None and alt.foot_m < base.foot_m:
            savings.append(Saving(action="allow", preference="ferries", saves_m=round(base.foot_m - alt.foot_m, 1),
                                  fits=alt.foot_m <= upper))
    value = math.ceil(base.foot_m / 100.0) * 100.0
    fixes = [Fix(action="set_distance", value_m=value)]
    for s in savings:
        if s.fits and s.action == "drop_checkpoint":
            fixes += [Fix(action="drop_checkpoint", label=s.label), Fix(action="make_optional", label=s.label)]
        elif s.fits and s.action == "allow":
            fixes.append(Fix(action="allow", preference="ferries"))
    names = [req.checkpoints[i].label for i in base.order]
    over = base.foot_m - req.target_distance_m
    return Conflict(
        kind="checkpoints_exceed_distance", requested_m=req.target_distance_m, minimum_m=round(base.foot_m, 1),
        overshoot_m=round(over, 1), order=names, savings=savings, fixes=fixes,
        message=(f"These {len(names)} stops need at least {base.foot_m / 1000:.1f} km on foot, "
                 f"{over / 1000:.1f} km over the {req.target_distance_m / 1000:.1f} km requested."))


# ------------------------------------------------------------------ candidate assembly

def end_label(routed: Routed) -> str | None:
    for e in reversed(routed.edges):
        if e.names:
            return e.names[0]
    return None


def make_candidate(req: RouteRequest, routed: Routed, label: str, end_kind: str,
                   checkpoint_order: list[int], extra_flags: list[Flag]) -> Candidate:
    stops = [StopOnRoute(role="start", label=req.start.label, requested=req.start,
                         snapped_lon=routed.legs[0][0][0], snapped_lat=routed.legs[0][0][1],
                         offset_m=geodesy.distance_m(req.start.lonlat, routed.legs[0][0]), at_m=0.0)]
    run = 0.0
    for leg_i, cp_i in enumerate(checkpoint_order):
        run += routed.leg_foot_m[leg_i]
        cp = req.checkpoints[cp_i]
        p = routed.legs[leg_i][-1]
        stops.append(StopOnRoute(role="checkpoint", label=cp.label, requested=cp, snapped_lon=p[0], snapped_lat=p[1],
                                 offset_m=geodesy.distance_m(cp.lonlat, p), at_m=round(run, 1)))
    shape = routed.shape
    end = shape[-1]
    stops.append(StopOnRoute(role="end", label=end_label(routed), requested={"lon": end[0], "lat": end[1]},
                             snapped_lon=end[0], snapped_lat=end[1], offset_m=0.0, at_m=round(routed.foot_m, 1)))
    road_m: dict[str, float] = {}
    for e in routed.edges:
        if e.use != "ferry":
            road_m[e.road_class] = road_m.get(e.road_class, 0.0) + e.length_m
    return Candidate(
        label=label, geometry=shape, length_m=routed.geom_m, foot_m=routed.foot_m, ferry_m=routed.ferry_m,
        engine_length_m=routed.engine_m, sphere_length_m=routed.sphere_m,
        deviation_m=routed.foot_m - req.target_distance_m, duration_s=routed.duration_s, stops=stops,
        end=EndPoint(lon=end[0], lat=end[1], label=end_label(routed), kind=end_kind),
        road_class_m={k: round(v, 1) for k, v in road_m.items()},
        edge_ids=[e.id for e in routed.edges], flags=routed.flags + extra_flags)


# ------------------------------------------------------------------ case A: truncation

def cut_point(tail: Routed, remainder_m: float, target_m: float) -> tuple[LonLat, str, float]:
    """Where to end on the tail: the nearest junction within the snap window, else the exact distance."""
    window = SNAP_WINDOW_FRACTION * target_m
    near = [j for j in tail.junctions if abs(j.at_m - remainder_m) <= window and 0 < j.at_m < tail.foot_m]
    if near:
        j = min(near, key=lambda j: abs(j.at_m - remainder_m))
        return j.point, "junction", j.at_m
    return tail.point_at_foot(remainder_m), "mid_road", remainder_m


def truncate(req: RouteRequest, engine: Engine, start: LonLat, stops: list[LonLat], base: Base,
             tail: Routed, remainder_m: float) -> tuple[Routed, str, list[Flag], dict]:
    """Cut the tail at the remainder and re-route the whole run as one engine request."""
    point, kind, at = cut_point(tail, remainder_m, req.target_distance_m)
    flags: list[Flag] = []
    seq = [start, *(stops[i] for i in base.order), point]
    routed = engine.route(seq, detail=True)
    facts = {"cut_at_m": round(at, 1), "end_kind": kind}
    # One correction if the re-route lands off target (e.g. the end snapped to a neighbouring edge).
    miss = req.target_distance_m - routed.foot_m
    if abs(miss) > req.tolerance_m / 2 and 0 < remainder_m + miss < tail.foot_m:
        point = tail.point_at_foot(remainder_m + miss)
        kind = "mid_road"
        retry = engine.route([*seq[:-1], point], detail=True)
        if abs(req.target_distance_m - retry.foot_m) < abs(miss):
            routed = retry
            facts["corrected_m"] = round(miss, 1)
    if abs(req.target_distance_m - routed.foot_m) > req.tolerance_m:
        flags.append(Flag(code="reroute_mismatch",
                          message=f"re-routed run is {routed.foot_m:.0f} m on foot against {req.target_distance_m:.0f} m requested",
                          data={"foot_m": routed.foot_m}))
    if kind == "mid_road":
        flags.append(Flag(code="endpoint_mid_road",
                          message="no junction within the snap window; the run ends at the exact distance"))
    return routed, kind, flags, facts
