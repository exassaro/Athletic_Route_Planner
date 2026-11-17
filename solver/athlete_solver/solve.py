"""Solver entry point: RouteRequest in, SolveResult out.

Two alternatives (Phase 3 amendment 9), each produced by its own engine and measured
by the same yardstick (Valhalla matching, ellipsoid geometry length):
- "recommended": GraphHopper foot with the road-priority rules (model R5);
- "shortest": Valhalla pedestrian.
Snapping, connectivity and the outcome come from the shortest alternative, because
"the stops alone exceed the budget" is a statement about the shortest way through
them. The alternatives run in parallel.
"""

import time
from concurrent.futures import ThreadPoolExecutor

from athlete_engine import geodesy
from athlete_engine.valhalla import Valhalla

from .avoid import inside, valhalla_extra
from .engine import Engine, NoRoute, ValhallaEngine
from .graphhopper import GraphHopperEngine, GraphHopperUnavailable
from .models import Conflict, Flag, RouteRequest, SolveResult
from .out_and_back import solve_out_and_back
from .p2p import (SECTOR_DEG, Infeasible, all_must_reach, anchors, bearing_tail, build_conflict, check_snapping,
                  cut_at_target, disconnected_conflict, make_candidate, minimum_route, planned_base, truncate)
from .scoring import annotate, diversify

BEARING_OK_DEG = 30.0  # section 16: endpoint bearing within 30 degrees where the network permits
ALTERNATIVES = ("recommended", "shortest")


def solve(request: RouteRequest, engine=None, graph_build: str = "unknown", generator=None) -> SolveResult:
    """Solve one request.

    `engine` is a Valhalla client (default: a new one on VALHALLA_URL) or an Engine (unit-test fakes).
    `generator` is the Engine for "recommended"; by default GraphHopper on GRAPHHOPPER_URL, measured by
    Valhalla. With a fake `engine` and no generator, the fake serves both alternatives.
    """
    t0 = time.perf_counter()
    owned = engine is None
    client = Valhalla() if owned else engine
    engines, closers, flags = _engines(request, client, generator)
    try:
        result = _solve(request, engines, graph_build, flags)
    finally:
        for close in closers:
            close()
        if owned:
            client.close()
    result.elapsed_ms = (time.perf_counter() - t0) * 1000
    return result


def _engines(req: RouteRequest, client, generator) -> tuple[dict[str, Engine], list, list[Flag]]:
    closers, flags = [], []
    if isinstance(client, Valhalla):
        shortest = ValhallaEngine(client, extra=valhalla_extra(req))
    elif hasattr(client, "route") and hasattr(client, "matrix"):
        shortest = client
    else:
        raise TypeError("engine must be a Valhalla client or an Engine")
    if generator is not None:
        recommended = generator
    elif isinstance(client, Valhalla):
        recommended = GraphHopperEngine(ValhallaEngine(client), req.preferences, request=req)
        closers.append(recommended.close)
        try:
            recommended.check()
        except GraphHopperUnavailable as err:
            flags.append(Flag(code="alternative_unavailable", message=f"recommended route unavailable: {err}"))
            recommended = None
    else:
        recommended = shortest
    engines = {"recommended": recommended, "shortest": shortest}
    return {k: v for k, v in engines.items() if v is not None}, closers, flags


def _calls(engines: dict[str, Engine]) -> int:
    seen, total = set(), 0
    for e in engines.values():
        if id(e) not in seen:
            seen.add(id(e))
            total += e.calls
    return total


def _preference_flags(req: RouteRequest) -> list[Flag]:
    flags = []
    if req.preferences.hills != "any":
        flags.append(Flag(code="preference_unsupported", message="hill preference is not supported in the MVP"))
    if req.preferences.surface != "any":
        flags.append(Flag(code="preference_unsupported",
                          message="surface preference is not supported: surface tags are too sparse"))
    return flags


def _run_alternatives(engines: dict[str, Engine], fn) -> dict[str, tuple]:
    """Run fn(alternative, engine) for every alternative, in parallel when the engines differ."""
    names = list(engines)
    if len(names) == 1 or engines[names[0]] is engines[names[-1]]:
        return {n: fn(n, engines[n]) for n in names}
    with ThreadPoolExecutor(max_workers=len(names)) as pool:
        futures = {n: pool.submit(fn, n, engines[n]) for n in names}
        return {n: f.result() for n, f in futures.items()}


def _finish(req: RouteRequest, engines, by_alt: dict[str, tuple[list, dict, list[Flag]]]):
    """Annotate every candidate, drop hard-rule failures, then keep alternatives that differ (overlap < 60%)."""
    groups, rejected = [], []
    for alt in ALTERNATIVES:
        if alt not in by_alt:
            continue
        pairs = by_alt[alt][0]
        kept = []
        for cand, edges in pairs:
            cand, fails = annotate(engines[alt], req, cand, edges)
            if fails:
                rejected.append(f"{alt} {cand.option}: " + "; ".join(fails))
                continue
            kept.append((cand, {e.key for e in edges if e.use != "ferry"}))
        if kept:
            groups.append((alt, kept))
    return diversify(groups, req.alternatives), rejected


def _solve(req: RouteRequest, engines: dict[str, Engine], graph_build: str, flags: list[Flag]) -> SolveResult:
    flags = flags + _preference_flags(req)
    given = req
    yard = engines["shortest"]

    def done(outcome: str, by_alt=None, facts=None, conflict=None, extra_flags=None) -> SolveResult:
        all_flags = flags + (extra_flags or [])
        facts = dict(facts or {})
        candidates = []
        if by_alt is not None:
            for alt, (_, alt_facts, alt_flags) in by_alt.items():
                facts.setdefault("by_alternative", {})[alt] = alt_facts
                all_flags += [f for f in alt_flags if f not in all_flags]
            candidates, rejected = _finish(req, engines, by_alt)
            if rejected:
                facts["rejected"] = rejected
            if not candidates and outcome in ("ok", "over_budget"):
                outcome = "unsupported"
                all_flags.append(Flag(code="preference_unsupported",
                                      message="every candidate broke a hard rule: " + "; ".join(rejected)))
        return SolveResult(outcome=outcome, request=given, graph_build=graph_build, candidates=candidates,
                           conflict=conflict, facts=facts, flags=all_flags, engine_calls=_calls(engines))

    if req.route_type == "out_and_back":
        try:
            check_snapping(yard, req)
        except Infeasible as inf:
            return done("infeasible", conflict=inf.conflict)
        by_alt = _run_alternatives(engines, lambda alt, eng: _guard(alt, lambda: solve_out_and_back(req, eng, alt)))
        ok = any(pairs for pairs, _, _ in by_alt.values())
        return done("ok" if ok else "unsupported", by_alt=by_alt, facts=by_alt.get("recommended", by_alt["shortest"])[1])
    if req.route_type != "point_to_point":
        return done("unsupported", extra_flags=[Flag(code="preference_unsupported",
                                                     message=f"{req.route_type} is not implemented yet")])
    if req.end.kind == "fixed":
        return done("unsupported", extra_flags=[Flag(
            code="preference_unsupported",
            message="a fixed end needs via-point lengthening (section 8 step 10), not built yet")])
    if req.direction is None:
        return done("unsupported", extra_flags=[Flag(
            code="preference_unsupported", message="point_to_point needs a direction (towards a place or a bearing)")])

    # From here on the solver works on one list of stops: checkpoints, then via and must_use items with their
    # roles (Phase 3 amendment 7). The result still carries the request as given.
    req = req.model_copy(update={"checkpoints": req.stops()})
    start = req.start.lonlat
    stops = anchors(req)
    target = req.direction.place.lonlat if req.direction.kind == "towards_place" else None
    named = [(req.start.label or "start", start), *((c.label, c.lonlat) for c in req.checkpoints)]
    if target:
        named.append((req.direction.place.label or "target", target))
    for label, point in named:
        area = inside(req, point)
        if area is not None:
            return done("infeasible", conflict=Conflict(
                kind="inside_avoided", pair=[label, area],
                message=f"{label} lies inside {area}, which the request asks to avoid"))

    try:
        check_snapping(yard, req)
    except Infeasible as inf:
        return done("infeasible", conflict=inf.conflict)

    # Connectivity (section 8 step 3): one walking matrix over every point.
    pts = [start, *stops] + ([target] if target else [])
    labels = [req.start.label or "start", *(c.label for c in req.checkpoints)] + \
             ([req.direction.place.label or "target"] if target else [])
    matrix = yard.matrix(pts)
    if any(c is None for row in matrix for c in row):
        return done("disconnected", conflict=disconnected_conflict(labels, matrix))

    # Order the stops once on the walking matrix, then plan every alternative's way through them (in
    # parallel). A pass-near plan depends on the engine, so neither alternative is the minimum by definition:
    # the stops alone exceed the budget only if EVERY alternative's way through them does.
    try:
        ranked = planned_base(req, yard, start, target, req.upper_m) if all_must_reach(req) else \
            minimum_route(yard, start, stops, target, req.checkpoint_order == "fixed", req.upper_m, route=False)
    except NoRoute:
        ranked = None
    if ranked is None:
        return done("disconnected", conflict=disconnected_conflict(labels, matrix))
    order = ranked.order

    def plan(alt, eng):
        if alt == "shortest" and all_must_reach(req):
            return ranked
        try:
            return planned_base(req, eng, start, target, req.upper_m, order=order)
        except (NoRoute, GraphHopperUnavailable):
            return None

    bases = {alt: b for alt, b in _run_alternatives(engines, plan).items() if b is not None}
    if not bases:
        return done("disconnected", conflict=disconnected_conflict(labels, matrix))
    best_alt = min(bases, key=lambda a: bases[a].foot_m)
    best = bases[best_alt]
    facts = {"order": [req.checkpoints[i].label for i in order], "l_min_m": round(best.foot_m, 1),
             "l_min_by_alternative": {a: round(b.foot_m, 1) for a, b in bases.items()},
             "budget_m": req.target_distance_m, "tolerance_m": req.tolerance_m,
             "stops": {req.checkpoints[i].label: _pick_facts(best.picks.get(i, {})) for i in order}}
    lost = [Flag(code="alternative_unavailable", message=f"{a} route unavailable: no route through the stops")
            for a in engines if a not in bases]
    run = {a: e for a, e in engines.items() if a in bases}

    if best.foot_m > req.upper_m:
        conflict = build_conflict(req, engines[best_alt], best, start, stops, target)
        facts["overshoot_m"] = round(best.foot_m - req.target_distance_m, 1)
        by_alt = _run_alternatives(run, lambda alt, eng: _guard(
            alt, lambda: _over_budget(req, eng, alt, bases[alt])))
        return done("over_budget", by_alt=by_alt, facts=facts, conflict=conflict, extra_flags=lost)

    by_alt = _run_alternatives(run, lambda alt, eng: _guard(
        alt, lambda: _alternative(req, eng, alt, start, target, bases[alt])))
    first = by_alt.get("recommended") or by_alt["shortest"]
    facts.update({k: v for k, v in first[1].items() if k not in facts})
    return done("ok", by_alt=by_alt, facts=facts, extra_flags=lost)


def _guard(alt: str, fn) -> tuple[list, dict, list[Flag]]:
    """Run one alternative; an engine failure removes that alternative with a flag instead of failing the solve."""
    try:
        return fn()
    except (GraphHopperUnavailable, NoRoute) as err:
        return [], {"error": str(err)}, [Flag(code="alternative_unavailable", message=f"{alt} route unavailable: {err}")]


def _pick_facts(pick: dict) -> dict:
    out = {k: v for k, v in pick.items() if k in ("how", "walk_m", "added_m")}
    if "point" in pick:
        out["point"] = [round(pick["point"][0], 6), round(pick["point"][1], 6)]
    return out


def _over_budget(req, eng, alt, base):
    """Over budget (Phase 3 amendment 6): the full route through the stops and the run cut at the target."""
    full = eng.route(base.points, through=base.through, detail=True)
    full_cand = make_candidate(req, full, "full_route", "last_checkpoint", base, [], alt)
    routed, kept, kind, flags, cut_facts = cut_at_target(req, eng, base, full)
    cut_cand = make_candidate(req, routed, "cut_at_target", kind, base, flags, alt, keep=kept)
    facts = {"order": [req.checkpoints[i].label for i in base.order], "l_min_m": round(base.foot_m, 1),
             "overshoot_m": round(base.foot_m - req.target_distance_m, 1), "cut": cut_facts,
             "stops": {req.checkpoints[i].label: _pick_facts(base.picks.get(i, {})) for i in base.order}}
    return [(full_cand, full.edges), (cut_cand, routed.edges)], facts, []


def _alternative(req, eng, alt, start, target, base):
    """One alternative for a request whose stops fit the budget on at least one alternative's way."""
    if base.foot_m > req.upper_m:
        # This engine's way through the stops is longer than the budget although another alternative's fits.
        pairs, facts, _ = _over_budget(req, eng, alt, base)
        return pairs, facts, [Flag(code="alternative_over_budget",
                                   message=f"the {alt} route through the stops is {base.foot_m / 1000:.1f} km, "
                                           f"over the {req.target_distance_m / 1000:.1f} km requested")]
    facts = {"order": [req.checkpoints[i].label for i in base.order], "l_min_m": round(base.foot_m, 1),
             "stops": {req.checkpoints[i].label: _pick_facts(base.picks.get(i, {})) for i in base.order}}
    remainder = req.target_distance_m - base.foot_m
    facts["remainder_m"] = round(remainder, 1)
    prefix = base.points or [start]
    through = base.through
    last = prefix[-1]

    # Budget already used up by the stops (within tolerance): the run ends at the last checkpoint.
    if base.routed is not None and remainder <= 1.0:
        routed = eng.route(prefix, through=through, detail=True)
        cand = make_candidate(req, routed, "main", "last_checkpoint", base, [], alt)
        facts.update(case="ends_at_last_checkpoint", deviation_m=round(cand.deviation_m, 1))
        return [(cand, routed.edges)], facts, []

    if target is None:
        return _bearing(req, eng, alt, facts, prefix, base, remainder, through)

    # The whole run to the target in one request (through vias stay through vias), cut at the budget measured
    # from the start: routing the last stretch separately could begin with a U-turn at a through via.
    to_target = eng.route([*prefix, target], through=through, detail=True)
    tail_m = to_target.foot_m - base.foot_m
    facts["tail_to_target_m"] = round(tail_m, 1)

    if to_target.foot_m >= req.target_distance_m:
        facts["case"] = "A"
        routed, kind, flags, cut_facts = truncate(req, eng, prefix, to_target, req.target_distance_m, through=through)
        facts.update(cut_facts)
        cand = make_candidate(req, routed, "main", kind, base, flags, alt)
        facts["end_label"] = cand.end.label
        facts["deviation_m"] = round(cand.deviation_m, 1)
        return [(cand, routed.edges)], facts, []

    # Case B (section 8 step 8): the target is nearer than the budget allows.
    facts["case"] = "B"
    shortfall = req.target_distance_m - to_target.foot_m
    facts["shortfall_m"] = round(shortfall, 1)
    target_label = req.direction.place.label or "the target"
    candidates = []

    # Option 1: carry on past the target in the same direction for the rest of the budget.
    heading = geodesy.bearing_deg(last if last != target else start, target)
    beyond = bearing_tail(eng, target, heading, shortfall, measure_from=target)
    if beyond is not None:
        routed, kind, flags, cut_facts = truncate(req, eng, [*prefix, target], beyond.tail, shortfall,
                                                  through=through)
        cand = make_candidate(req, routed, "continue_past_target", kind, base, flags, alt)
        facts["continue_bearing_error_deg"] = round(beyond.bearing_error, 1)
        candidates.append((cand, routed.edges))

    # Option 2: end at the target and report the shortfall.
    at_target = to_target
    short = make_candidate(req, at_target, "end_at_target", "target", base, [
        Flag(code="short_of_budget",
             message=(f"{target_label} is {at_target.foot_m / 1000:.1f} km away by this route, "
                      f"{(req.target_distance_m - at_target.foot_m) / 1000:.1f} km short of the "
                      f"{req.target_distance_m / 1000:.1f} km requested. Adding a detour on an earlier leg "
                      "is not supported yet."),
             data={"short_by_m": round(req.target_distance_m - at_target.foot_m, 1)})], alt)
    short.end.label = target_label
    candidates.append((short, at_target.edges))
    return candidates, facts, []


def _bearing(req, eng, alt, facts, prefix, base, remainder, through):
    """Bearing-only endpoint (section 8 step 8): sample the isodistance contour inside the sector, cut exactly."""
    facts["case"] = "bearing"
    origin = prefix[-1]
    found = bearing_tail(eng, origin, req.direction.degrees, remainder, measure_from=prefix[0])
    if found is None:
        return [], facts, [Flag(
            code="preference_unsupported",
            message=f"no walkable endpoint found within {SECTOR_DEG:.0f} degrees of bearing {req.direction.degrees:.0f}")]
    routed, kind, flags, cut_facts = truncate(req, eng, prefix, found.tail, remainder, through=through)
    facts.update(cut_facts)
    if found.bearing_error > BEARING_OK_DEG:
        flags.append(Flag(code="direction_limited",
                          message=(f"no walking route of this length ends within {BEARING_OK_DEG:.0f} degrees of "
                                   f"bearing {req.direction.degrees:.0f}; the closest found is "
                                   f"{found.bearing_error:.0f} degrees off"),
                          data={"bearing_error_deg": round(found.bearing_error, 1)}))
    cand = make_candidate(req, routed, "main", kind, base, flags, alt)
    end = (cand.end.lon, cand.end.lat)
    facts.update(bearing_error_deg=round(geodesy.angle_between_deg(geodesy.bearing_deg(prefix[0], end),
                                                                    req.direction.degrees), 1),
                 end_label=cand.end.label, deviation_m=round(cand.deviation_m, 1))
    return [(cand, routed.edges)], facts, []
