"""Overview points (Phase 5d A14) on recorded Valhalla paths: A01 and S02, no network.

tests/fixtures/overview/legs.json is written by api/scripts/measure_overview.py from live Valhalla.
"""

import json
import math
from pathlib import Path
from xml.etree import ElementTree as ET

import httpx
import pytest
from athlete_engine import geodesy, polyline
from athlete_engine.valhalla import Valhalla, ValhallaError
from athlete_solver.engine import NoRoute, ValhallaEngine

from athlete_api import overview, overviewing

ROOT = Path(__file__).resolve().parents[3]
RECORDED = json.loads((ROOT / "tests/fixtures/overview/legs.json").read_text(encoding="utf-8"))["tracks"]
GPX = {"A01 recommended": "A01_recommended.gpx", "S02 loop": "S02_loop_1.gpx"}
TRACKS = list(GPX)
MATCH_M = 0.05          # recorded ends are rounded to 7 decimals (about 1 cm)


def geometry(track: str) -> list:
    points = ET.parse(ROOT / "docs/reports/phase4/gpx" / GPX[track]).iter("{http://www.topografix.com/GPX/1/1}trkpt")
    return [(float(p.get("lon")), float(p.get("lat"))) for p in points]


def recorded(track: str):
    """Valhalla's own answer for each pair of points; a pair that was not recorded fails the test."""
    legs = RECORDED[track]

    def route(a, b):
        for leg in legs:
            if geodesy.distance_m(a, leg["from"]) < MATCH_M and geodesy.distance_m(b, leg["to"]) < MATCH_M:
                route.calls += 1
                return polyline.decode(leg["shape"], precision=6)
        raise AssertionError(f"{track}: no recorded path from {a} to {b}: run api/scripts/measure_overview.py")

    route.calls = 0
    return route


def evenly(fidelity: overview.Fidelity, n: int) -> list[int]:
    """The web app's fallback (googleMaps.ts, pickEvenly), as sample indices: km k is sample 40 k."""
    marks = [round(km * 1000 / overview.SAMPLE_M) for km in range(1, math.ceil(fidelity.at_m[-1] / 1000))]
    if len(marks) <= n:
        return marks
    return [marks[math.floor((i + 1) * (len(marks) + 1) / (n + 1) + 0.5) - 1] for i in range(n)]


@pytest.mark.parametrize("track", TRACKS)
@pytest.mark.parametrize("n", [3, 9])
def test_smart_deviates_less_than_even_spacing_at_the_apps_two_limits(track, n):
    fidelity = overview.Fidelity(geometry(track), recorded(track))
    smart, even = fidelity.greedy(n), evenly(fidelity, n)
    assert fidelity.max_deviation_m(smart) < fidelity.max_deviation_m(even)
    assert fidelity.overlap_pct(smart) > fidelity.overlap_pct(even)


@pytest.mark.parametrize("track", TRACKS)
@pytest.mark.parametrize("n", range(1, 10))
def test_points_are_on_the_route_in_order_and_at_most_n(track, n):
    line, route = geometry(track), recorded(track)
    got = overview.overview(line, n, route)
    at = [p[2] for p in got.points]
    assert len(at) <= n and at == sorted(set(at))
    assert all(0 < x < geodesy.line_length_m(line) for x in at)
    for lon, lat, along in got.points:
        assert geodesy.distance_m((lon, lat), geodesy.point_at(line, along)[0]) < 0.2    # at_m has one decimal
    assert 0 <= got.overlap_pct <= 100
    assert len(at) == n or got.max_deviation_m < overview.NEAR_M    # fewer only when it is close enough
    assert route.calls <= 2 * n + 1                                 # each point added costs two engine calls


@pytest.mark.parametrize(("track", "used"), [("A01 recommended", 7), ("S02 loop", 8)])
def test_stops_early_once_every_leg_is_under_30_m(track, used):
    got = overview.overview(geometry(track), 9, recorded(track))
    assert len(got.points) == used and got.max_deviation_m < 30


def test_a_loop_never_asks_for_a_route_from_the_start_to_itself():
    route = recorded("S02 loop")

    def checked(a, b):
        assert geodesy.distance_m(a, b) >= overview.SAME_POINT_M
        return route(a, b)

    assert len(overview.overview(geometry("S02 loop"), 3, checked).points) == 3


# ---------------------------------------------------------------- made-up lines, for the definitions

A = (75.85, 11.10)
B = geodesy.destination(A, 0.0, 2000.0)


def straight(a, b):
    return [a, b]


def test_overlap_is_leg_by_leg_so_the_return_does_not_cover_for_the_way_out():
    def missing_way_out(a, b):
        return [a] if a == A else [a, b]        # a path for the return only

    fidelity = overview.Fidelity([A, B, A], missing_way_out)
    turn = min(range(len(fidelity.at_m)), key=lambda k: abs(fidelity.at_m[k] - fidelity.at_m[-1] / 2))
    # every point of the way out lies on the return's path, so against the whole path this would be 100 %
    assert fidelity.overlap_pct([turn]) == pytest.approx(51, abs=2)


def test_an_out_and_back_is_anchored_at_its_turn():
    got = overview.overview([A, B, A], 3, straight)
    assert len(got.points) == 1 and got.points[0][2] == pytest.approx(2000, abs=25)
    assert got.overlap_pct == 100.0 and got.max_deviation_m < 1


def test_no_points_when_the_direct_path_already_follows_the_route():
    got = overview.overview([A, B], 9, straight)
    assert got.points == [] and got.overlap_pct == 100.0


def test_a_detour_in_the_path_counts_as_deviation_though_every_point_of_ours_is_on_it():
    side = geodesy.destination(A, 90.0, 400.0)
    fidelity = overview.Fidelity([A, B], lambda a, b: [a, side, a, b])
    assert fidelity.max_deviation_m([]) > 300 and fidelity.overlap_pct([]) == 100.0


def test_overlap_is_rounded_down(monkeypatch):
    monkeypatch.setattr(overview.Fidelity, "overlap_pct", lambda self, via: 99.97)
    assert overview.overview([A, B], 3, straight).overlap_pct == 99.9


# ---------------------------------------------------------------- failures, through the solver's own client


def failure(handler) -> overviewing.ApiError:
    client = Valhalla("http://valhalla.test")
    client._http = httpx.Client(base_url="http://valhalla.test", transport=httpx.MockTransport(handler))
    with client:
        try:
            ValhallaEngine(client).route([A, B])
        except (NoRoute, ValhallaError, httpx.TransportError) as err:
            return overviewing.overview_error(err)
    raise AssertionError("the engine did not fail")


def test_engine_failures_are_engine_unavailable_and_a_missing_path_is_not():
    def refused(request):
        raise httpx.ConnectError("refused", request=request)

    def slow(request):
        raise httpx.ReadTimeout("too slow", request=request)

    for handler in (refused, slow, lambda request: httpx.Response(500, json={"error": "broken"}),
                    lambda request: httpx.Response(503, text="starting")):
        err = failure(handler)
        assert (err.status, err.error) == (503, "engine_unavailable")
    err = failure(lambda request: httpx.Response(400, json={"error_code": 442, "error": "No path could be found"}))
    assert (err.status, err.error) == (503, "overview_unavailable")
