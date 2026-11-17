"""Solver against Valhalla on the pinned graph. Expected values come from scenarios.json
(brute-force reference) or from measuring the result itself; nothing is typed in."""

import json
from pathlib import Path

import pytest

from athlete_engine import geodesy
from athlete_solver.models import RouteRequest
from athlete_solver.solve import solve

pytestmark = pytest.mark.integration

SCEN = json.loads((Path(__file__).resolve().parents[1] / "fixtures" / "scenarios" / "scenarios.json")
                  .read_text(encoding="utf-8"))
FIX = {f["id"]: f for f in SCEN["fixtures"]}


def run(engine_client, fid):
    from athlete_engine.valhalla import Valhalla  # noqa: PLC0415
    assert isinstance(engine_client, Valhalla)
    return solve(RouteRequest.model_validate(FIX[fid]["request"]), engine=engine_client, graph_build=SCEN["graph_build"])


def test_s05_meets_the_budget_through_all_stops(engine):
    res = run(engine, "S05")
    assert res.outcome == "ok"
    c = res.candidates[0]
    req = res.request
    assert abs(c.foot_m - req.target_distance_m) <= req.tolerance_m
    assert c.foot_m == pytest.approx(geodesy.line_length_m(c.geometry), abs=1.0)  # no ferry: foot = geometry
    assert [s.label for s in c.stops if s.role == "checkpoint"] == FIX["S05"]["reference"]["order"]
    assert c.ferry_m == 0


def test_s15_is_over_budget_with_measured_savings(engine):
    res = run(engine, "S15")
    ref = FIX["S15"]["reference"]
    assert res.outcome == "over_budget"
    assert [c.label for c in res.candidates] == ["full_route", "cut_at_target"]
    assert abs(res.candidates[1].foot_m - res.request.target_distance_m) <= res.request.tolerance_m
    assert res.conflict.minimum_m == pytest.approx(ref["minimum_m"], abs=max(10, 0.002 * ref["minimum_m"]))
    assert {s.label for s in res.conflict.savings} == set(ref["order"])
    assert all(s.action == "drop_checkpoint" for s in res.conflict.savings)


def test_case_b_offers_both_options(engine):
    res = run(engine, "S11")
    assert [c.option for c in res.candidates if c.label == "recommended"] == ["continue_past_target", "end_at_target"]


def test_recommended_comes_from_graphhopper_and_is_measured_by_valhalla(engine):
    res = run(engine, "S04")
    rec = next(c for c in res.candidates if c.label == "recommended")
    assert rec.engine == "graphhopper"
    assert rec.road_class_m                      # road classes from Valhalla matching
    assert rec.foot_m == pytest.approx(geodesy.line_length_m(rec.geometry), abs=1.0)
