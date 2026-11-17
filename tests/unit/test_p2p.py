"""Point-to-point solver logic on the in-memory fake engine (no network).

Expected values are computed from the fake graph's own geometry, never typed in.
"""

import itertools

import pytest

from athlete_engine import geodesy
from athlete_solver.models import RouteRequest
from athlete_solver.solve import solve

from fake_engine import FakeEngine, FakeGraph, GEdge, ladder

LADDER = ladder()
N = LADDER.nodes


def req(start, distance, target=None, checkpoints=(), must_reach=False, **kw):
    body = {"route_type": "point_to_point", "start": {"lon": start[0], "lat": start[1], "label": "start"},
            "target_distance_m": distance,
            "direction": {"kind": "towards_place", "place": {"lon": target[0], "lat": target[1], "label": "T"}},
            "checkpoints": [{"lon": p[0], "lat": p[1], "label": name, "must_reach": must_reach}
                            for name, p in checkpoints]}
    body.update(kw)
    return RouteRequest.model_validate(body)


def run(r, graph=LADDER):
    return solve(r, engine=FakeEngine(graph), graph_build="fake")


def test_case_a_cut_lands_on_the_budget():
    main_road = [N[f"m{i}"] for i in range(41)]
    budget = geodesy.line_length_m(main_road) * 0.55   # a budget that ends part-way along the road
    res = run(req(N["m0"], budget, target=N["m40"]))
    assert res.outcome == "ok"
    c = res.candidates[0]
    assert abs(c.foot_m - budget) <= max(0.005 * budget, 2.0)
    assert c.foot_m == pytest.approx(geodesy.line_length_m(c.geometry))
    assert res.facts["case"] == "A"


def test_cut_snaps_to_a_junction_inside_the_window():
    main_road = [N[f"m{i}"] for i in range(41)]
    cum = geodesy.cumulative_m(main_road)
    budget = cum[20] + 0.002 * cum[-1]       # just past junction m20, inside a 0.5% window
    res = run(req(N["m0"], budget, target=N["m40"]))
    c = res.candidates[0]
    assert c.end.kind == "junction"
    assert geodesy.distance_m((c.end.lon, c.end.lat), N["m20"]) < 1.0


def test_over_budget_returns_full_route_cut_and_brute_force_conflict():
    stops = [("A", N["s30"]), ("B", N["s5"]), ("C", N["s20"])]
    eng = FakeEngine(LADDER)
    lengths = {}
    for perm in itertools.permutations(stops):
        r = eng.route([N["m0"], *(p for _, p in perm)])
        lengths[tuple(n for n, _ in perm)] = r.foot_m
    minimum = min(lengths.values())
    budget = minimum * 0.6
    res = run(req(N["m0"], budget, target=N["m40"], checkpoints=stops, must_reach=True))
    assert res.outcome == "over_budget"
    full, cut = res.candidates
    assert (full.option, cut.option) == ("full_route", "cut_at_target")
    assert full.label == cut.label == "recommended"   # the fake serves both alternatives; shortest overlaps 100%
    assert full.foot_m == pytest.approx(minimum, abs=0.5)
    assert abs(cut.foot_m - budget) <= res.request.tolerance_m
    assert res.facts["overshoot_m"] == pytest.approx(minimum - budget, abs=0.5)
    # the cut keeps only the stops it reaches, in the same order
    full_order = [s.label for s in full.stops if s.role == "checkpoint"]
    cut_order = [s.label for s in cut.stops if s.role == "checkpoint"]
    assert cut_order == full_order[:len(cut_order)] and len(cut_order) < len(full_order)
    c = res.conflict
    assert c.minimum_m == pytest.approx(minimum, abs=0.5)
    assert c.overshoot_m == pytest.approx(minimum - budget, abs=0.5)
    # dropping the farthest stop is the only saving that can matter most
    drop = {s.label: s for s in c.savings if s.action == "drop_checkpoint"}
    for name in "ABC":
        rest = [p for n, p in stops if n != name]
        best_rest = min(eng.route([N["m0"], *perm]).foot_m for perm in itertools.permutations(rest))
        assert drop[name].saves_m == pytest.approx(minimum - best_rest, abs=0.5)
    fix = next(f for f in c.fixes if f.action == "set_distance")
    assert fix.value_m + res.request.tolerance_m >= minimum and fix.value_m <= minimum + 100


def test_ferry_is_never_used_even_when_it_is_the_only_link():
    """A ferry is the only connection: the solver reports a disconnected pair, with no ferry fix."""
    nodes = {"a": (75.80, 11.10), "b": (75.81, 11.10), "c": (75.83, 11.10), "d": (75.84, 11.10)}
    g = FakeGraph(nodes, [GEdge("a", "b"), GEdge("b", "c", ferry=True), GEdge("c", "d")])
    res = run(req(nodes["a"], 5000, target=nodes["d"]), g)
    assert res.outcome == "disconnected"
    assert set(res.conflict.pair) == {"start", "T"}
    assert res.conflict.fixes == []


def test_route_around_an_estuary_never_takes_the_ferry():
    """A U-shaped road round an estuary with a ferry across its mouth: the run walks round."""
    nodes = {"a": (75.80, 11.10), "b": (75.80, 11.15), "c": (75.85, 11.15), "d": (75.85, 11.10),
             "e": (75.85, 11.05), "x": (75.81, 11.10), "y": (75.84, 11.10)}
    edges = [GEdge("a", "x"), GEdge("a", "b"), GEdge("b", "c"), GEdge("c", "d"), GEdge("d", "y"), GEdge("d", "e"),
             GEdge("x", "y", ferry=True, name="Ferry")]
    g = FakeGraph(nodes, edges)
    res = run(req(nodes["a"], 40000, target=nodes["e"], checkpoints=[("Y", nodes["y"])], must_reach=True), g)
    round_the_estuary = geodesy.line_length_m([nodes[k] for k in "abcdy"])
    assert res.facts["l_min_m"] == pytest.approx(round_the_estuary, abs=0.1)
    assert all(c.ferry_m == 0 for c in res.candidates)


def test_far_checkpoint_is_rejected_before_routing():
    res = run(req(N["m0"], 10000, target=N["m40"], checkpoints=[("Far", (75.90, 11.05))]))
    assert res.outcome == "infeasible"
    assert res.conflict.kind == "snap_too_far"


def test_unsupported_preferences_are_flagged_not_ignored():
    res = run(req(N["m0"], 5000, target=N["m40"], preferences={"hills": "minimise"}))
    assert any(f.code == "preference_unsupported" for f in res.flags)


def test_case_b_offers_both_options_and_continue_meets_the_budget():
    # Target m10 is much nearer than the budget; the ladder continues north past it.
    near = geodesy.line_length_m([N[f"m{i}"] for i in range(11)])
    budget = near * 2.5
    res = run(req(N["m0"], budget, target=N["m10"]))
    assert res.outcome == "ok" and res.facts["case"] == "B"
    options = [c.option for c in res.candidates]
    assert options == ["continue_past_target", "end_at_target"]
    cont, short = res.candidates
    assert abs(cont.foot_m - budget) <= max(0.005 * budget, 2.0)
    assert short.foot_m == pytest.approx(near, abs=1.0)
    assert any(f.code == "short_of_budget" for f in short.flags)


def test_bearing_only_heads_the_right_way():
    budget = geodesy.line_length_m([N[f"m{i}"] for i in range(21)])
    res = run(RouteRequest.model_validate({
        "route_type": "point_to_point", "start": {"lon": N["m5"][0], "lat": N["m5"][1]},
        "target_distance_m": budget, "direction": {"kind": "bearing", "degrees": 0}}))
    assert res.outcome == "ok"
    c = res.candidates[0]
    assert abs(c.foot_m - budget) <= max(0.005 * budget, 2.0)
    assert res.facts["bearing_error_deg"] <= 30
    assert c.end.lat > N["m5"][1]


def test_out_and_back_is_exact_and_retraces_itself():
    budget = geodesy.line_length_m([N[f"m{i}"] for i in range(21)]) * 1.3
    res = run(RouteRequest.model_validate({
        "route_type": "out_and_back", "start": {"lon": N["m2"][0], "lat": N["m2"][1]},
        "target_distance_m": budget, "direction": {"kind": "bearing", "degrees": 0}}))
    assert res.outcome == "ok"
    c = res.candidates[0]
    assert abs(c.foot_m - budget) <= max(0.005 * budget, 2.0)
    assert c.geometry[0] == c.geometry[-1]
    half = len(c.geometry) // 2
    assert c.geometry[:half + 1] == list(reversed(c.geometry[half:]))
    assert c.end.kind == "start"


# ------------------------------------------------------------------ pass near (Phase 3 amendment 3)

def test_pass_near_adds_nothing_when_the_route_already_passes_within_1_km():
    # A side street end 220 m east of the main road: passing along the main road is within 1 km on foot.
    stop = N["s10"]
    res = run(req(N["m0"], geodesy.line_length_m([N[f"m{i}"] for i in range(31)]), target=N["m40"],
                  checkpoints=[("Side 10", stop)]))
    assert res.outcome == "ok"
    c = res.candidates[0]
    cp = next(s for s in c.stops if s.role == "checkpoint")
    assert cp.how == "on_route" and cp.pass_walk_m <= 1000
    assert res.facts["stops"]["Side 10"]["added_m"] == 0.0
    # it did not walk the side street (no spur): no repeated edges at all
    assert c.repeat_share == 0


def test_must_reach_walks_into_the_side_street():
    stop = N["s10"]
    budget = geodesy.line_length_m([N[f"m{i}"] for i in range(31)])
    near = run(req(N["m0"], budget, target=N["m40"], checkpoints=[("Side 10", stop)]))
    reach = run(req(N["m0"], budget, target=N["m40"], checkpoints=[("Side 10", stop)], must_reach=True))
    assert reach.facts["l_min_m"] > near.facts["l_min_m"]
    cp = next(s for s in reach.candidates[0].stops if s.role == "checkpoint")
    assert cp.how == "reached" and cp.offset_m < 1.0


def test_pass_near_place_over_1_km_on_foot_is_detoured_to():
    # A point 1.5 km east of the main road at m20, reachable by a long side road: needs a via.
    g = ladder()
    far = (N["m20"][0] + 0.02, N["m20"][1])
    g.nodes["far"] = far
    g.nodes["mid"] = (N["m20"][0] + 0.011, N["m20"][1])
    g.edges += [GEdge("s20", "mid", name="Long Road"), GEdge("mid", "far", name="Long Road")]
    budget = geodesy.line_length_m([N[f"m{i}"] for i in range(41)]) + 4000
    res = run(req(N["m0"], budget, target=N["m40"], checkpoints=[("Far", far)]), g)
    assert res.outcome == "ok"
    cp = next(s for s in res.candidates[0].stops if s.role == "checkpoint")
    assert cp.how in ("via", "spur") and cp.pass_walk_m <= 1000


# ------------------------------------------------------------------ via, must_use, avoid (Phase 3 amendment 7)

def two_bridges() -> FakeGraph:
    """Two banks joined by a short bridge (b1) and a longer one upstream (b2)."""
    nodes = {"a": (75.80, 11.10), "s1": (75.80, 11.11), "n1": (75.80, 11.12), "t": (75.80, 11.15),
             "s2": (75.82, 11.11), "n2": (75.82, 11.12)}
    edges = [GEdge("a", "s1"), GEdge("s1", "n1", name="Short Bridge"), GEdge("n1", "t"),
             GEdge("s1", "s2"), GEdge("s2", "n2", name="Long Bridge"), GEdge("n2", "n1")]
    return FakeGraph(nodes, edges)


def test_must_use_bridge_is_crossed_even_when_another_is_shorter():
    g = two_bridges()
    long_bridge = g.edges.index(next(e for e in g.edges if e.name == "Long Bridge")) + 1   # the fake's way id
    mid = ((g.nodes["s2"][0] + g.nodes["n2"][0]) / 2, (g.nodes["s2"][1] + g.nodes["n2"][1]) / 2)
    r = req(g.nodes["a"], 9000, target=g.nodes["t"],
            must_use=[{"kind": "bridge", "label": "Long Bridge", "lon": mid[0], "lat": mid[1],
                       "way_ids": [long_bridge], "lines": [[g.nodes["s2"], g.nodes["n2"]]]}])
    res = run(r, g)
    assert res.outcome == "ok"
    c = res.candidates[0]
    assert any(s.role == "must_use" and s.label == "Long Bridge" for s in c.stops)
    shortest_way = geodesy.line_length_m([g.nodes[k] for k in ("a", "s1", "n1", "t")])
    assert res.facts["l_min_m"] > geodesy.distance_m(g.nodes["a"], g.nodes["s1"])   # it went round
    assert c.foot_m > shortest_way or res.facts.get("case") == "B"


def test_via_shapes_the_run_but_is_never_dropped_or_listed_as_a_checkpoint():
    stops = [("A", N["s30"])]
    full = FakeEngine(LADDER).route([N["m0"], N["s30"]]).foot_m
    r = req(N["m0"], full * 0.5, target=N["m40"], checkpoints=stops, must_reach=True,
            via=[{"lon": N["s10"][0], "lat": N["s10"][1], "label": "Side 10"}])
    res = run(r)
    assert res.outcome == "over_budget"
    assert [s.label for s in res.conflict.savings] == ["A"]               # the via is not offered as a saving
    roles = {s.label: s.role for s in res.candidates[0].stops}
    assert roles["Side 10"] == "via" and roles["A"] == "checkpoint"
    assert res.request.via and not any(c.role != "checkpoint" for c in res.request.checkpoints)  # request as given


def test_start_inside_an_avoided_area_is_a_conflict():
    r = req(N["m0"], 5000, target=N["m40"],
            avoid=[{"kind": "place", "label": "Market", "lon": N["m0"][0], "lat": N["m0"][1], "radius_m": 200}])
    res = run(r)
    assert res.outcome == "infeasible" and res.conflict.kind == "inside_avoided"


def test_a_route_through_an_avoided_area_breaks_a_hard_rule():
    # The fake engine ignores the avoid list, so the only way through is rejected by the hard rule.
    r = req(N["m0"], geodesy.line_length_m([N[f"m{i}"] for i in range(31)]), target=N["m40"],
            avoid=[{"kind": "place", "label": "Square", "lon": N["m15"][0], "lat": N["m15"][1], "radius_m": 100}])
    res = run(r)
    assert res.outcome == "unsupported"
    assert any("enters Square" in x for x in res.facts["rejected"])
