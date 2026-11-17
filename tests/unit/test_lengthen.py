"""Via-point lengthening (section 8 step 10) and fixed ends, on the in-memory fake engine.

Expected values come from the fake graph's own geometry, never typed in.
"""

import pytest

from athlete_engine import geodesy
from athlete_solver.lengthen import _next_offset, accuracy_m, ellipse_points, retraced_m, CIRCUITY_GUESSES
from athlete_solver.models import RouteRequest
from athlete_solver.solve import solve

from fake_engine import FakeEngine, FakeGraph, GEdge


def grid(n: int = 12, step_deg: float = 0.003, lon0: float = 75.80, lat0: float = 11.20) -> FakeGraph:
    nodes, edges = {}, []
    for i in range(n):
        for j in range(n):
            nodes[f"{i},{j}"] = (lon0 + i * step_deg, lat0 + j * step_deg)
            if i:
                edges.append(GEdge(f"{i - 1},{j}", f"{i},{j}", name=f"Row {j}"))
            if j:
                edges.append(GEdge(f"{i},{j - 1}", f"{i},{j}", name=f"Column {i}"))
    return FakeGraph(nodes, edges)


GRID = grid()
G = GRID.nodes


def fixed_req(start, end, distance, checkpoints=()):
    return RouteRequest.model_validate({
        "route_type": "point_to_point", "start": {"lon": start[0], "lat": start[1], "label": "start"},
        "target_distance_m": distance, "end": {"kind": "fixed", "point": {"lon": end[0], "lat": end[1], "label": "E"}},
        "checkpoints": [{"lon": p[0], "lat": p[1], "label": name} for name, p in checkpoints]})


def direct_m(a, b) -> float:
    return FakeEngine(GRID).route([a, b]).foot_m


def test_ellipse_candidates_have_the_guessed_straight_line_sum():
    a, b = G["2,2"], G["8,2"]
    need = 3.0 * geodesy.distance_m(a, b)
    pts = ellipse_points(a, b, need)
    assert pts
    expected = [need / g for g in CIRCUITY_GUESSES]
    assert len(pts) == 12 * len(expected)
    for p in pts:
        s = geodesy.distance_m(a, p) + geodesy.distance_m(p, b)
        assert min(abs(s - e) / e for e in expected) < 0.01


def test_next_offset_interpolates_inside_a_bracket_and_steps_otherwise():
    assert _next_offset([(0.0, 1000.0), (100.0, 2000.0), (200.0, 4000.0)], 3000.0) == pytest.approx(150.0)
    assert _next_offset([(0.0, 1000.0), (100.0, 2000.0)], 3000.0) == pytest.approx(200.0)
    assert _next_offset([(0.0, 1000.0), (100.0, 900.0)], 3000.0) is None


def test_retraced_counts_road_walked_twice():
    out = [G["0,0"], G["0,1"], G["0,2"]]
    back = [G["0,1"], G["0,0"]]
    assert retraced_m(out + back) == pytest.approx(geodesy.line_length_m(out))
    assert retraced_m(out) == 0.0


def test_accuracy_goal():
    assert accuracy_m(20000, 500) == pytest.approx(100.0)
    assert accuracy_m(5000, 500) == pytest.approx(50.0)
    assert accuracy_m(200000, 500) == pytest.approx(500.0)


def test_fixed_end_is_lengthened_to_the_budget_and_ends_at_the_end():
    start, end = G["1,1"], G["6,1"]
    budget = 2.2 * direct_m(start, end)
    res = solve(fixed_req(start, end, budget), engine=FakeEngine(GRID), graph_build="fake")
    assert res.outcome == "ok"
    c = res.candidates[0]
    assert c.option == "main" and c.end.kind == "fixed"
    assert abs(c.foot_m - budget) <= 500.0
    assert c.foot_m == pytest.approx(geodesy.line_length_m(c.geometry))
    assert geodesy.distance_m(c.geometry[-1], end) < 1.0
    assert any(f.code == "lengthened" for f in c.flags)
    facts = res.facts["by_alternative"]["shortest"]
    assert facts["case"] == "fixed_end" and facts["lengthen"]["found"]


def test_fixed_end_close_to_the_budget_is_not_lengthened():
    start, end = G["1,1"], G["9,4"]
    budget = direct_m(start, end)
    res = solve(fixed_req(start, end, budget), engine=FakeEngine(GRID), graph_build="fake")
    c = res.candidates[0]
    assert res.outcome == "ok" and c.option == "main"
    assert c.foot_m == pytest.approx(budget, abs=1.0)
    assert not any(f.code == "lengthened" for f in c.flags)


def test_fixed_end_beyond_the_budget_is_over_budget():
    start, end = G["0,0"], G["11,11"]
    budget = 0.6 * direct_m(start, end)
    res = solve(fixed_req(start, end, budget), engine=FakeEngine(GRID), graph_build="fake")
    assert res.outcome == "over_budget"
    assert res.conflict.minimum_m == pytest.approx(direct_m(start, end), abs=1.0)
    full = next(c for c in res.candidates if c.option == "full_route")
    assert full.end.kind == "fixed" and geodesy.distance_m(full.geometry[-1], end) < 1.0
    assert "fixed end" in res.conflict.message


def test_fixed_end_keeps_checkpoints_after_lengthening():
    start, end = G["1,1"], G["9,1"]
    stop = G["5,1"]
    budget = 2.0 * direct_m(start, end)
    res = solve(fixed_req(start, end, budget, checkpoints=[("S", stop)]), engine=FakeEngine(GRID), graph_build="fake")
    c = res.candidates[0]
    assert res.outcome == "ok"
    assert [s.label for s in c.stops if s.role == "checkpoint"] == ["S"]
    assert abs(c.foot_m - budget) <= 500.0
