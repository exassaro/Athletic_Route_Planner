"""Loops without stops (section 8; amendments 21 to 23) on the in-memory fake engine.

Expected values come from the fake graph's own geometry, never typed in.
"""

import math

import pytest

from athlete_engine import geodesy
from athlete_solver.loop import (Shape, goal_m, perimeter_per_scale, shapes_for, stub_bases, unstub, via_points)
from athlete_solver.models import RouteRequest
from athlete_solver.solve import solve

from fake_engine import FakeEngine
from test_lengthen import GRID, G


def loop_req(start, distance, direction=None):
    body = {"route_type": "loop", "start": {"lon": start[0], "lat": start[1], "label": "start"},
            "target_distance_m": distance}
    if direction is not None:
        body["direction"] = direction
    return RouteRequest.model_validate(body)


def test_circle_perimeter_and_vias_lie_on_the_shape():
    assert perimeter_per_scale(1.0) == pytest.approx(2 * math.pi)
    start, scale = G["5,5"], 1000.0
    shape = Shape(lean_deg=45.0, aspect=1.0)
    centre = geodesy.destination(start, 45.0, scale)
    for v in via_points(start, shape, scale):
        assert geodesy.distance_m(centre, v) == pytest.approx(scale, rel=0.001)


def test_oval_is_longer_along_the_lean():
    start = G["5,5"]
    v1, v2, v3 = via_points(start, Shape(lean_deg=0.0, aspect=1.8), 1000.0)
    across = geodesy.distance_m(v1, v3)
    along = geodesy.distance_m(start, v2)
    assert along > across


def test_shapes_lean_around_the_requested_bearing():
    req = loop_req(G["5,5"], 5000, {"kind": "bearing", "degrees": 90})
    leans = {round(s.lean_deg) for s in shapes_for(req)}
    assert 90 in leans
    assert all(geodesy.angle_between_deg(x, 90) <= 60 for x in leans)
    free = shapes_for(loop_req(G["5,5"], 5000))
    assert len({round(s.lean_deg) for s in free if s.aspect == 1.0}) == 6


def test_goal_is_the_smaller_of_tolerance_and_three_percent():
    assert goal_m(loop_req(G["5,5"], 5000)) == pytest.approx(150.0)
    assert goal_m(loop_req(G["5,5"], 30000)) == pytest.approx(500.0)


def test_stub_bases_and_unstub():
    a, b, c, d = G["0,0"], G["0,1"], G["0,2"], G["1,1"]
    shape = [a, b, c, b, d]               # walks to c and back to b, then on to d
    assert stub_bases(shape) == [(c, b)]
    assert unstub([c], shape) == [b]
    assert unstub([d], [a, b, d]) is None


def test_loop_on_a_grid_is_closed_and_near_the_distance():
    start = G["5,5"]
    budget = 4000.0
    res = solve(loop_req(start, budget), engine=FakeEngine(GRID), graph_build="fake")
    assert res.outcome == "ok"
    assert [c.label for c in res.candidates][:1] == ["loop_1"]
    for c in res.candidates:
        assert abs(c.foot_m - budget) <= 500.0
        assert geodesy.distance_m(c.geometry[0], c.geometry[-1]) < 1.0
        assert c.foot_m == pytest.approx(geodesy.line_length_m(c.geometry))
        assert c.end.kind == "start"


def test_loop_with_stops_is_not_built_yet():
    body = {"route_type": "loop", "start": {"lon": G["5,5"][0], "lat": G["5,5"][1]}, "target_distance_m": 4000,
            "checkpoints": [{"lon": G["7,7"][0], "lat": G["7,7"][1], "label": "S"}]}
    res = solve(RouteRequest.model_validate(body), engine=FakeEngine(GRID), graph_build="fake")
    assert res.outcome == "unsupported"
