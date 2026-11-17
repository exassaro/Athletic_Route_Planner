"""Solver entry point: RouteRequest in, SolveResult out."""

import time

from athlete_engine import geodesy
from athlete_engine.valhalla import Valhalla

from .engine import Engine, NoRoute, ValhallaEngine
from .models import Flag, RouteRequest, SolveResult
from .out_and_back import solve_out_and_back
from .p2p import (SECTOR_DEG, Infeasible, bearing_tail, build_conflict, check_snapping, disconnected_conflict,
                  make_candidate, minimum_route, truncate)

from .scoring import annotate, diversify

BEARING_OK_DEG = 30.0  # section 16: endpoint bearing within 30 degrees where the network permits


def finish(req: RouteRequest, eng, pairs) -> tuple[list, list[str]]:
    """Measure and score every candidate, drop hard-rule failures, then apply the diversity filter."""
    scored, rejected = [], []
    for cand, edges in pairs:
        cand, fails = annotate(eng, req, cand, edges)
        if fails:
            rejected.append(f"{cand.label}: " + "; ".join(fails))
            continue
        scored.append((cand, {e.key for e in edges if e.use != "ferry"}))
    return diversify(scored, req.alternatives), rejected


def _engine(engine) -> Engine:
    """The Valhalla adapter for a client; test fakes already implement the Engine protocol."""
    if isinstance(engine, Valhalla):
        return ValhallaEngine(engine)
    if hasattr(engine, "route") and hasattr(engine, "matrix"):
        return engine
    raise TypeError("engine must be a Valhalla client or an Engine")


def _unsupported(req, graph_build, message, flags=None, facts=None) -> SolveResult:
    return SolveResult(outcome="unsupported", request=req, graph_build=graph_build,
                       flags=(flags or []) + [Flag(code="preference_unsupported", message=message)], facts=facts or {})


def _preference_flags(req: RouteRequest) -> list[Flag]:
    flags = []
    if req.preferences.hills != "any":
        flags.append(Flag(code="preference_unsupported", message="hill preference is not supported in the MVP"))
    if req.preferences.surface != "any":
        flags.append(Flag(code="preference_unsupported",
                          message="surface preference is not supported: surface tags are too sparse"))
    if req.preferences.quiet_roads > 0:
        flags.append(Flag(code="preference_unsupported",
                          message="fewer-main-roads alternative is pending the Phase 3 spike decision"))
    return flags


def solve(request: RouteRequest, engine=None, graph_build: str = "unknown") -> SolveResult:
    t0 = time.perf_counter()
    owned = engine is None
    client = Valhalla() if owned else engine
    try:
        result = _solve(request, client, graph_build)
    finally:
        if owned:
            client.close()
    result.elapsed_ms = (time.perf_counter() - t0) * 1000
    return result


def _solve(req: RouteRequest, client, graph_build: str) -> SolveResult:
    eng = _engine(client)
    pref_flags = _preference_flags(req)

    def done(**kw) -> SolveResult:
        kw.setdefault("flags", [])
        kw["flags"] = pref_flags + kw["flags"]
        pairs = kw.pop("pairs", None)
        if pairs is not None:
            kept, rejected = finish(req, eng, pairs)
            kw["candidates"] = kept
            if rejected:
                kw.setdefault("facts", {})["rejected"] = rejected
            if not kept and kw.get("outcome") == "ok":
                kw["outcome"] = "unsupported"
                kw["flags"].append(Flag(code="preference_unsupported",
                                        message="every candidate broke a hard rule: " + "; ".join(rejected)))
        return SolveResult(request=req, graph_build=graph_build, engine_calls=eng.calls, **kw)

    if req.route_type == "out_and_back":
        try:
            check_snapping(eng, req)
        except Infeasible as inf:
            return done(outcome="infeasible", conflict=inf.conflict)
        pairs, facts, flags = solve_out_and_back(req, eng)
        return done(outcome="ok" if pairs else "unsupported", pairs=pairs, facts=facts, flags=flags)
    if req.route_type != "point_to_point":
        return _unsupported(req, graph_build, f"{req.route_type} is not implemented yet")
    if req.end.kind == "fixed":
        return _unsupported(req, graph_build, "a fixed end needs via-point lengthening (section 8 step 10), not built yet")
    if req.direction is None:
        return _unsupported(req, graph_build, "point_to_point needs a direction (towards a place or a bearing)")

    start = req.start.lonlat
    stops = [c.lonlat for c in req.checkpoints]
    target = req.direction.place.lonlat if req.direction.kind == "towards_place" else None
    upper = req.target_distance_m * (1 + req.tolerance_pct / 100)

    try:
        check_snapping(eng, req)
    except Infeasible as inf:
        return done(outcome="infeasible", conflict=inf.conflict)

    # Connectivity (section 8 step 3): one matrix over every point.
    pts = [start, *stops] + ([target] if target else [])
    labels = [req.start.label or "start", *(c.label for c in req.checkpoints)] + \
             ([req.direction.place.label or "target"] if target else [])
    matrix = eng.matrix(pts)
    if any(c is None for row in matrix for c in row):
        return done(outcome="disconnected", conflict=disconnected_conflict(labels, matrix))

    base = minimum_route(eng, start, stops, target, req.checkpoint_order == "fixed", upper)
    if base is None:
        return done(outcome="disconnected", conflict=disconnected_conflict(labels, matrix))

    facts = {"order": [req.checkpoints[i].label for i in base.order], "l_min_m": round(base.foot_m, 1),
             "budget_m": req.target_distance_m, "tolerance_m": req.tolerance_m}

    # Feasibility gate (section 8 step 6).
    if base.foot_m > upper:
        return done(outcome="infeasible", facts=facts,
                    conflict=build_conflict(req, eng, base, start, stops, target))

    remainder = req.target_distance_m - base.foot_m
    facts["remainder_m"] = round(remainder, 1)
    last = stops[base.order[-1]] if base.order else start
    prefix = [start, *(stops[i] for i in base.order)]

    # Budget already used up by the stops (within tolerance): the run ends at the last checkpoint.
    if base.routed is not None and remainder <= 1.0:
        routed = eng.route(prefix, detail=True)
        cand = make_candidate(req, routed, "direct", "last_checkpoint", base.order, [])
        facts.update(case="ends_at_last_checkpoint", deviation_m=round(cand.deviation_m, 1))
        return done(outcome="ok", pairs=[(cand, routed.edges)], facts=facts)

    if target is None:
        return _bearing(req, eng, done, facts, prefix, base, remainder)

    try:
        tail = eng.route([last, target], detail=True)
    except NoRoute:
        return done(outcome="disconnected", conflict=disconnected_conflict(labels, matrix))
    facts["tail_to_target_m"] = round(tail.foot_m, 1)

    if tail.foot_m >= remainder:
        facts["case"] = "A"
        routed, kind, flags, cut_facts = truncate(req, eng, prefix, tail, remainder)
        facts.update(cut_facts)
        cand = make_candidate(req, routed, "direct", kind, base.order, flags)
        facts["end_label"] = cand.end.label
        facts["deviation_m"] = round(cand.deviation_m, 1)
        return done(outcome="ok", pairs=[(cand, routed.edges)], facts=facts)

    # Case B (section 8 step 8): the target is nearer than the budget allows.
    facts["case"] = "B"
    shortfall = remainder - tail.foot_m
    facts["shortfall_m"] = round(shortfall, 1)
    target_label = req.direction.place.label or "the target"
    candidates = []

    # Option 1: carry on past the target in the same direction for the rest of the budget.
    heading = geodesy.bearing_deg(last if last != target else start, target)
    beyond = bearing_tail(eng, target, heading, shortfall, measure_from=target)
    if beyond is not None:
        routed, kind, flags, cut_facts = truncate(req, eng, [*prefix, target], beyond.tail, shortfall)
        cand = make_candidate(req, routed, "continue_past_target", kind, base.order, flags)
        facts["continue_bearing_error_deg"] = round(beyond.bearing_error, 1)
        candidates.append((cand, routed.edges))

    # Option 2: end at the target and report the shortfall.
    at_target = eng.route([*prefix, target], detail=True)
    short = make_candidate(req, at_target, "end_at_target", "target", base.order, [
        Flag(code="short_of_budget",
             message=(f"{target_label} is {at_target.foot_m / 1000:.1f} km away by this route, "
                      f"{(req.target_distance_m - at_target.foot_m) / 1000:.1f} km short of the "
                      f"{req.target_distance_m / 1000:.1f} km requested. Adding a detour on an earlier leg "
                      "is not supported yet."),
             data={"short_by_m": round(req.target_distance_m - at_target.foot_m, 1)})])
    short.end.label = target_label
    candidates.append((short, at_target.edges))
    return done(outcome="ok", pairs=candidates, facts=facts)


def _bearing(req, eng, done, facts, prefix, base, remainder) -> SolveResult:
    """Bearing-only endpoint (section 8 step 8): sample the isodistance contour inside the sector, cut exactly."""
    facts["case"] = "bearing"
    origin = prefix[-1]
    found = bearing_tail(eng, origin, req.direction.degrees, remainder, measure_from=prefix[0])
    if found is None:
        return done(outcome="unsupported", facts=facts, flags=[Flag(
            code="preference_unsupported",
            message=f"no walkable endpoint found within {SECTOR_DEG:.0f} degrees of bearing {req.direction.degrees:.0f}")])
    routed, kind, flags, cut_facts = truncate(req, eng, prefix, found.tail, remainder)
    facts.update(cut_facts)
    if found.bearing_error > BEARING_OK_DEG:
        flags.append(Flag(code="direction_limited",
                          message=(f"no walking route of this length ends within {BEARING_OK_DEG:.0f} degrees of "
                                   f"bearing {req.direction.degrees:.0f}; the closest found is "
                                   f"{found.bearing_error:.0f} degrees off"),
                          data={"bearing_error_deg": round(found.bearing_error, 1)}))
    cand = make_candidate(req, routed, "direct", kind, base.order, flags)
    end = (cand.end.lon, cand.end.lat)
    facts.update(bearing_error_deg=round(geodesy.angle_between_deg(geodesy.bearing_deg(prefix[0], end),
                                                                    req.direction.degrees), 1),
                 end_label=cand.end.label, deviation_m=round(cand.deviation_m, 1))
    return done(outcome="ok", pairs=[(cand, routed.edges)], facts=facts)
