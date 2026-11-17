"""Explanations use only numbers already in the SolveResult (Phase 4 amendments 10 and 16).

Results: A01 (ok, Case B options) and A02 (over budget) as the solver returned them (Phase 3b report), plus
variants built from them for the other templates (loops, out-and-back, conflicts without candidates, flags).
"""

import re
import sys
from pathlib import Path

import pytest
from athlete_solver.models import Conflict, Flag, RouteRequest, SolveResult

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "api"))
from api_fixtures import fixture_request, report_result  # noqa: E402

from athlete_api.explain import explain  # noqa: E402

NUMBER = re.compile(r"\d+(?:\.\d+)?")


def numbers_in(value) -> list[float]:
    if isinstance(value, bool):
        return []
    if isinstance(value, (int, float)):
        return [float(value)]
    if isinstance(value, dict):
        return [n for v in value.values() for n in numbers_in(v)]
    if isinstance(value, (list, tuple)):
        return [n for v in value for n in numbers_in(v)]
    return []


def strings_in(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for k, v in value.items() for s in [str(k), *strings_in(v)]]
    if isinstance(value, (list, tuple)):
        return [s for v in value for s in strings_in(v)]
    return []


def allowed(result: SolveResult) -> set[str]:
    """Every number of the result, in each format the explainer uses."""
    data = result.model_dump(mode="json", include={"facts", "conflict"})
    data["candidates"] = [c.model_dump(mode="json", exclude={"geometry", "edge_ids", "stops"})
                          for c in result.candidates]
    out = set()
    for n in numbers_in(data):
        n = abs(n)
        out |= {f"{n / 1000:.1f}", f"{n:.0f}"}
    return out


def unexplained_numbers(result: SolveResult, text: str) -> list[str]:
    # Names copied from the result (roads, places) may hold digits ("NH 66"): remove them first.
    for s in sorted(set(strings_in(result.model_dump(mode="json", exclude={"request"}))), key=len, reverse=True):
        if len(s) > 1 and s in text:
            text = text.replace(s, " ")
    for loop_name in ("Loop 1", "Loop 2"):
        text = text.replace(loop_name, " ")
    ok = allowed(result)
    return [t for t in NUMBER.findall(text) if t not in ok]


def a01():
    return report_result("A01", RouteRequest.model_validate(fixture_request("A01")))


def a02():
    return report_result("A02", RouteRequest.model_validate(fixture_request("A02")))


def loops():
    r = a01()
    c1, c2 = r.candidates[0], r.candidates[1]
    r.candidates = [c1.model_copy(update={"label": "loop_1"}),
                    c2.model_copy(update={"label": "loop_2", "option": "out_and_back"})]
    return r


def flagged():
    r = a01()
    c = r.candidates[0]
    c.flags = [Flag(code="uses_national_highway", message="uses 314 m of NH 766", data={"metres": 314.0}),
               Flag(code="detour_eased", message="eased")]
    r.flags = [Flag(code="alternative_unavailable", message="recommended route unavailable")]
    return r


def disconnected():
    r = a01()
    r.outcome, r.candidates = "disconnected", []
    r.conflict = Conflict(kind="disconnected", message="No walking route", pair=["Athanikkal", "Kozhikode"])
    return r


def loop_stop_too_far():
    r = a01()
    r.outcome, r.candidates = "infeasible", []
    r.conflict = Conflict(kind="loop_stop_too_far", message="too far", minimum_m=22213.4)
    return r


CASES = {"A01 ok": a01, "A02 over budget": a02, "loops": loops, "flags": flagged, "disconnected": disconnected,
         "loop stop too far": loop_stop_too_far}


@pytest.mark.parametrize("case", list(CASES))
def test_every_number_comes_from_the_result(case):
    result = CASES[case]()
    text = explain(result)
    assert text
    assert unexplained_numbers(result, text) == [], text


def test_the_checker_catches_an_invented_number():
    result = a01()
    assert unexplained_numbers(result, explain(result) + " About 2 h 40 min at your pace.") == ["2", "40"]


def test_over_budget_names_zero_savings():
    text = explain(a02())
    for stop in ("Kottakkadavu", "Kadalundi", "Chaliyam", "Karuvanthuruthy bridge"):
        assert f"Dropping {stop} does not shorten the run." in text
    assert "Dropping Kallai saves 6.6 km (then it fits)." in text
    assert "The stops need at least 21.7 km on foot, 1.7 km over the 20.0 km requested." in text
    assert "cut at the requested distance is 20.0 km" in text


def test_ok_describes_each_option_and_the_order():
    text = explain(a01())
    assert text.startswith("Stops in order: Kottakkadavu, Kadalundi, Chaliyam, Karuvanthuruthy bridge, Beypore, Kallai.")
    assert "The recommended route is 25.0 km, ending at Francis Road." in text
    assert "The shortest route reaches the target in 24.1 km, 928 m short of the distance." in text
    assert "can carry on past the target: 25.1 km, ending at Beach Road." in text   # the 3b report has no detour option


def test_flags_and_degraded_results_are_explained_without_their_numbers():
    text = explain(flagged())
    assert "uses a national highway" in text and "314" not in text
    assert "only the shortest route is shown" in text
