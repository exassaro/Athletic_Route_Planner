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


def req(start, distance, target=None, checkpoints=(), **kw):
    body = {"route_type": "point_to_point", "start": {"lon": start[0], "lat": start[1], "label": "start"},
            "target_distance_m": distance,
            "direction": {"kind": "towards_place", "place": {"lon": target[0], "lat": target[1], "label": "T"}},
            "checkpoints": [{"lon": p[0], "lat": p[1], "label": name} for name, p in checkpoints]}
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


def test_infeasible_conflict_matches_brute_force():
    stops = [("A", N["s30"]), ("B", N["s5"]), ("C", N["s20"])]
    eng = FakeEngine(LADDER)
    lengths = {}
    for perm in itertools.permutations(stops):
        r = eng.route([N["m0"], *(p for _, p in perm)])
        lengths[tuple(n for n, _ in perm)] = r.foot_m
    minimum = min(lengths.values())
    res = run(req(N["m0"], minimum * 0.6, target=N["m40"], checkpoints=stops))
    assert res.outcome == "infeasible"
    c = res.conflict
    assert c.minimum_m == pytest.approx(minimum, abs=0.5)
    assert c.overshoot_m == pytest.approx(minimum - minimum * 0.6, abs=0.5)
    # dropping the farthest stop is the only saving that can matter most
    drop = {s.label: s for s in c.savings if s.action == "drop_checkpoint"}
    for name in "ABC":
        rest = [p for n, p in stops if n != name]
        best_rest = min(eng.route([N["m0"], *perm]).foot_m for perm in itertools.permutations(rest))
        assert drop[name].saves_m == pytest.approx(minimum - best_rest, abs=0.5)
    fix = next(f for f in c.fixes if f.action == "set_distance")
    assert fix.value_m * 1.02 >= minimum and fix.value_m <= minimum + 100


def ferry_graph() -> FakeGraph:
    """A U-shaped road around an estuary, with a ferry straight across the mouth."""
    nodes = {"a": (75.80, 11.10), "b": (75.80, 11.15), "c": (75.85, 11.15), "d": (75.85, 11.10),
             "e": (75.85, 11.05), "x": (75.81, 11.10), "y": (75.84, 11.10)}
    edges = [GEdge("a", "x"), GEdge("a", "b"), GEdge("b", "c"), GEdge("c", "d"), GEdge("d", "y"), GEdge("d", "e"),
             GEdge("x", "y", ferry=True, name="Ferry")]
    return FakeGraph(nodes, edges)


def test_ferries_excluded_by_default_and_budget_counts_foot_only():
    g = ferry_graph()
    start, stop, target = g.nodes["a"], g.nodes["y"], g.nodes["e"]
    off = run(req(start, 40000, target=target, checkpoints=[("Y", stop)]), g)
    on = run(req(start, 40000, target=target, checkpoints=[("Y", stop)], preferences={"avoid": []}), g)
    assert off.facts["l_min_m"] > on.facts["l_min_m"]          # the ferry shortens the walk
    assert on.facts["l_min_ferry_m"] > 0
    across = geodesy.distance_m(g.nodes["x"], g.nodes["y"])
    assert on.facts["l_min_ferry_m"] == pytest.approx(across, abs=0.1)   # facts are rounded to 0.1 m
    # with ferries allowed the walk is the two short road pieces, not including the crossing
    assert on.facts["l_min_m"] == pytest.approx(geodesy.distance_m(start, g.nodes["x"]), abs=0.1)


def test_disconnected_names_the_blocking_preference():
    nodes = {"a": (75.80, 11.10), "b": (75.81, 11.10), "c": (75.83, 11.10), "d": (75.84, 11.10)}
    g = FakeGraph(nodes, [GEdge("a", "b"), GEdge("b", "c", ferry=True), GEdge("c", "d")])
    res = run(req(nodes["a"], 5000, target=nodes["d"]), g)
    assert res.outcome == "disconnected"
    assert res.conflict.blocking_preference == "ferries"
    assert any(f.action == "allow" for f in res.conflict.fixes)


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
    labels = [c.label for c in res.candidates]
    assert labels == ["continue_past_target", "end_at_target"]
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
