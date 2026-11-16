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


def test_s15_is_infeasible_and_allowing_ferries_fits(engine):
    res = run(engine, "S15")
    ref = FIX["S15"]["reference"]
    assert res.outcome == "infeasible"
    assert res.conflict.minimum_m == pytest.approx(ref["minimum_m"], abs=max(10, 0.002 * ref["minimum_m"]))
    ferries = next(s for s in res.conflict.savings if s.action == "allow")
    assert ferries.fits
    assert any(f.action == "allow" and f.preference == "ferries" for f in res.conflict.fixes)


def test_s06_counts_ferry_metres_separately(engine):
    res = run(engine, "S06")
    c = res.candidates[0]
    assert c.ferry_m > 0
    assert c.foot_m == pytest.approx(c.length_m - c.ferry_m, abs=0.5)
    assert abs(c.foot_m - res.request.target_distance_m) <= res.request.tolerance_m
    assert any(f.code == "ferry_used" for f in c.flags)


def test_case_b_offers_both_options(engine):
    res = run(engine, "S11")
    assert [c.label for c in res.candidates] == ["continue_past_target", "end_at_target"]
