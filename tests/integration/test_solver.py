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


def test_s15_fits_when_the_stops_are_passed_near(engine):
    """Phase 3 amendment 3: passing near Chaliyam avoids the dead-end, so the 25 km request fits."""
    res = run(engine, "S15")
    assert res.outcome == "ok"
    rec = next(c for c in res.candidates if c.label == "recommended")
    assert abs(rec.foot_m - res.request.target_distance_m) <= res.request.tolerance_m
    assert all(s.pass_walk_m is not None and s.pass_walk_m <= 1000 for s in rec.stops if s.role == "checkpoint")


def test_acceptance_corridor_in_order_without_ferry_or_spur(engine):
    res = run(engine, "A01")
    rec = next(c for c in res.candidates if c.label == "recommended")
    order = [s.label for s in rec.stops if s.role in ("checkpoint", "must_use")]
    assert order == FIX["A01"]["expect_order"]
    assert rec.ferry_m == 0 and (rec.repeat_share or 0) < 0.02
    assert not any(f.code in ("spur", "pass_near_spur") for f in rec.flags)
    assert abs(rec.foot_m - 25000) <= res.request.tolerance_m


def test_s15m_is_over_budget_with_measured_savings(engine):
    res = run(engine, "S15m")
    ref = FIX["S15m"]["reference"]
    assert res.outcome == "over_budget"
    assert [c.option for c in res.candidates if c.label == "recommended"] == ["full_route", "cut_at_target"]
    cut = next(c for c in res.candidates if c.option == "cut_at_target")
    assert abs(cut.foot_m - res.request.target_distance_m) <= res.request.tolerance_m
    assert res.conflict.minimum_m == pytest.approx(ref["minimum_m"], abs=max(10, 0.002 * ref["minimum_m"]))
    assert {s.label for s in res.conflict.savings} == set(ref["order"])
    assert all(s.action == "drop_checkpoint" for s in res.conflict.savings)


def test_case_b_offers_all_three_options(engine):
    res = run(engine, "S11")
    assert [c.option for c in res.candidates if c.label == "recommended"] ==         ["continue_past_target", "end_at_target", "detour_to_target"]
    detour = next(c for c in res.candidates if c.option == "detour_to_target")
    assert abs(detour.deviation_m) <= 500.0
    assert detour.foot_m == pytest.approx(geodesy.line_length_m(detour.geometry), abs=1.0)


def test_recommended_comes_from_graphhopper_and_is_measured_by_valhalla(engine):
    res = run(engine, "S04")
    rec = next(c for c in res.candidates if c.label == "recommended")
    assert rec.engine == "graphhopper"
    assert rec.road_class_m                      # road classes from Valhalla matching
    assert rec.foot_m == pytest.approx(geodesy.line_length_m(rec.geometry), abs=1.0)


def test_long_detour_is_capped_by_easing_the_road_penalties(engine):
    """Phase 3 amendment 20: on the Wayanad ghat, R5 alone is 56% longer than shortest; eased, within 30%."""
    res = run(engine, "S13")
    rec = res.facts["by_alternative"]["recommended"]
    short = res.facts["by_alternative"]["shortest"]
    to_target = rec["l_min_m"] + rec["tail_to_target_m"]
    assert to_target <= 1.30 * (short["l_min_m"] + short["tail_to_target_m"])
    assert rec["eased"]["from_m"] > 1.30 * rec["eased"]["shortest_m"]
    assert any(f.code == "detour_eased" for f in res.flags)


def test_loop_is_closed_from_graphhopper_and_near_the_distance(engine):
    res = run(engine, "S02")
    assert res.outcome == "ok"
    loops = [c for c in res.candidates if c.option == "main"]
    assert loops and loops[0].label == "loop_1"
    for c in loops:
        assert c.engine == "graphhopper"
        assert abs(c.deviation_m) <= min(500.0, 0.03 * 10000)
        assert geodesy.distance_m(c.geometry[0], c.geometry[-1]) < 1.0


def test_sparse_network_offers_an_out_and_back(engine):
    res = run(engine, "S14")
    assert any(f.code == "loop_fallback" for f in res.flags)
    oab = next(c for c in res.candidates if c.option == "out_and_back")
    assert abs(oab.deviation_m) <= 500.0
