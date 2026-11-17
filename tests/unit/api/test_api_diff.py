"""The version diff (Phase 4 amendment 6) on the solver's real A01 -> A02 results (25 km -> 20 km)."""

import sys
from pathlib import Path
from types import SimpleNamespace

from athlete_solver.models import RouteRequest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "api"))
from api_fixtures import fixture_request, report_result  # noqa: E402

from athlete_api.diff import changed_pointers, diff  # noqa: E402


def version(name: str, request: dict, no: int = 1):
    req = RouteRequest.model_validate(request)
    res = report_result(name, req)
    return SimpleNamespace(version=no, request=req, candidates=res.candidates, outcome=res.outcome), req, res


def test_changed_pointers():
    assert changed_pointers({"a": 1, "b": {"c": 2}}, {"a": 1, "b": {"c": 3}}) == ["/b/c"]
    assert changed_pointers({"l": [1, 2]}, {"l": [1, 2, 3]}) == ["/l"]
    assert changed_pointers({"l": [{"x": 1}]}, {"l": [{"x": 2}]}) == ["/l/0/x"]
    assert changed_pointers({"a/b": 1}, {"a/b": 2}) == ["/a~1b"]
    assert changed_pointers({"a": 1}, {"a": 1, "b": None}) == ["/b"]
    assert changed_pointers({"a": 1}, {"a": 1}) == []


def test_distance_edit_to_over_budget():
    prev, _, a01 = version("A01", fixture_request("A01"))
    _, req, a02 = version("A02", fixture_request("A02"), 2)
    d = diff(prev, req, a02)
    assert d["from_version"] == 1
    assert d["changed"] == ["/target_distance_m"]
    assert d["outcome"] == {"from": "ok", "to": "over_budget"}
    rec = next(p for p in d["candidates"] if p["label"] == "recommended")
    old = next(c for c in a01.candidates if c.label == "recommended" and c.option == "main")
    new = next(c for c in a02.candidates if c.label == "recommended" and c.option == "full_route")
    assert (rec["from_option"], rec["to_option"]) == ("main", "full_route")
    assert rec["length_delta_m"] == round(new.foot_m - old.foot_m, 1)
    assert rec["duration_delta_s"] == round(new.duration_s - old.duration_s, 1)
    assert rec["end_changed"] is True
    assert d["length_delta_m"] == rec["length_delta_m"]       # the first alternative is the headline
    short = next(p for p in d["candidates"] if p["label"] == "shortest")
    assert (short["from_option"], short["to_option"]) == ("continue_past_target", "full_route")
    assert d["stops_added"] == [] and d["stops_removed"] == []


def test_stops_added_and_removed():
    req = fixture_request("A01")
    prev, _, a01 = version("A01", req)
    fewer = {**req, "checkpoints": req["checkpoints"][:-1]}
    d = diff(prev, RouteRequest.model_validate(fewer), a01)
    assert [s["label"] for s in d["stops_removed"]] == ["Kallai"] and d["stops_added"] == []
    assert d["changed"] == ["/checkpoints"]
    assert d["length_delta_m"] == 0.0 and d["end_changed"] is False
