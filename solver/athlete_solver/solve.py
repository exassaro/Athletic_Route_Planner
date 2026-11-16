"""Solver entry point: RouteRequest in, SolveResult out."""

import time

from athlete_engine.valhalla import Valhalla

from .engine import Engine, NoRoute, ValhallaEngine
from .models import Flag, RouteRequest, SolveResult
from .p2p import (Infeasible, build_conflict, check_snapping, disconnected_conflict, make_candidate,
                  minimum_route, truncate)


def _engines(engine, ferries_allowed: bool) -> tuple[Engine, Engine | None]:
    """The request's engine, plus a ferries-allowed one for explaining conflicts when ferries are excluded."""
    if isinstance(engine, Valhalla):
        main = ValhallaEngine(engine, ferries_allowed)
        other = None if ferries_allowed else ValhallaEngine(engine, True)
        return main, other
    if hasattr(engine, "with_ferries"):  # test fakes
        return engine.with_ferries(ferries_allowed), (None if ferries_allowed else engine.with_ferries(True))
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
    eng, ferry_eng = _engines(client, req.preferences.ferries_allowed)
    pref_flags = _preference_flags(req)

    def done(**kw) -> SolveResult:
        kw.setdefault("flags", [])
        kw["flags"] = pref_flags + kw["flags"]
        return SolveResult(request=req, graph_build=graph_build,
                           engine_calls=eng.calls + (ferry_eng.calls if ferry_eng else 0), **kw)

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
        m2 = ferry_eng.matrix(pts) if ferry_eng else None
        return done(outcome="disconnected", conflict=disconnected_conflict(labels, matrix, m2))

    base = minimum_route(eng, start, stops, target, req.checkpoint_order == "fixed", upper)
    if base is None:
        return done(outcome="disconnected", conflict=disconnected_conflict(labels, matrix))

    facts = {"order": [req.checkpoints[i].label for i in base.order], "l_min_m": round(base.foot_m, 1),
             "budget_m": req.target_distance_m, "tolerance_m": req.tolerance_m}
    if base.routed is not None:
        facts["l_min_ferry_m"] = round(base.routed.ferry_m, 1)

    # Feasibility gate (section 8 step 6).
    if base.foot_m > upper:
        return done(outcome="infeasible", facts=facts,
                    conflict=build_conflict(req, eng, ferry_eng, base, start, stops, target))

    remainder = req.target_distance_m - base.foot_m
    facts["remainder_m"] = round(remainder, 1)
    last = stops[base.order[-1]] if base.order else start

    if target is None:
        return done(outcome="unsupported", facts=facts,
                    flags=[Flag(code="preference_unsupported", message="bearing-only endpoints are not implemented yet")])

    try:
        tail = eng.route([last, target], detail=True)
    except NoRoute:
        return done(outcome="disconnected", conflict=disconnected_conflict(labels, matrix))
    facts["tail_to_target_m"] = round(tail.foot_m, 1)

    if tail.foot_m < remainder:
        facts["case"] = "B"
        return done(outcome="unsupported", facts=facts,
                    flags=[Flag(code="preference_unsupported",
                                message="target nearer than the budget (Case B) is not implemented yet")])

    facts["case"] = "A"
    routed, kind, flags, cut_facts = truncate(req, eng, start, stops, base, tail, remainder)
    facts.update(cut_facts)
    cand = make_candidate(req, routed, "direct", kind, base.order, flags)
    facts["end_label"] = cand.end.label
    facts["deviation_m"] = round(cand.deviation_m, 1)
    return done(outcome="ok", candidates=[cand], facts=facts)
