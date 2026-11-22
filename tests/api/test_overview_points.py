"""A14 overview points: ownership, share links, cache, limits, failures (Phase 5d amendment 2).

A fake port stands in for Valhalla; the algorithm is tested in tests/unit/api/test_api_overview.py.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from athlete_api.overview import Overview
from athlete_api.overviewing import unavailable
from api_fixtures import FakeSolver, fixture_request

A01 = fixture_request("A01")


class FakePort:
    def __init__(self, delay_s: float = 0.0, error: Exception | None = None):
        self.delay_s, self.error = delay_s, error
        self.calls: list[tuple[list, int]] = []
        self.running = self.peak = 0
        self._lock = threading.Lock()

    def __call__(self, geometry, limit):
        with self._lock:
            self.calls.append((geometry, limit))
            self.running += 1
            self.peak = max(self.peak, self.running)
        try:
            time.sleep(self.delay_s)
            if self.error:
                raise self.error
            lon, lat = geometry[len(geometry) // 2]
            return Overview(points=[(lon, lat, 12_000.0)], max_deviation_m=412.5, overlap_pct=87.3)
        finally:
            with self._lock:
                self.running -= 1


@pytest.fixture
def stack(make_client):
    def make(port=None, build="valhalla test tiles 1", **overrides):
        api = make_client(solver=FakeSolver(), **overrides)
        h = {"X-Client-Token": api.post("/v1/session").json()["token"]}
        cands = api.post("/v1/plans", json={"request": A01}, headers=h).json()["candidates"]
        service = api.app.state.overview
        port = port or FakePort()
        service.port = port

        async def fixed():
            return build

        if build:       # None: ask Valhalla, unreachable in these tests
            service.valhalla_build = fixed
        return api, h, cands, port

    return make


def path(route_id) -> str:
    return f"/v1/routes/{route_id}/overview-points"


def share(api, h, route_id) -> tuple[dict, str]:
    saved = api.post(f"/v1/routes/{route_id}/save", headers=h).json()
    return saved, f"/v1/share/{saved['share_slug']}/overview-points"


def test_the_owner_gets_the_points_of_the_stored_geometry(stack):
    api, h, cands, port = stack()
    got = api.get(path(cands[0]["route_id"]), params={"max": 3}, headers=h)
    assert got.status_code == 200
    body = got.json()
    assert set(body) == {"points", "max_deviation_m", "overlap_pct"}
    assert body["max_deviation_m"] == 412.5 and body["overlap_pct"] == 87.3
    assert set(body["points"][0]) == {"lon", "lat", "at_m"}
    geometry, limit = port.calls[0]
    assert limit == 3 and [list(p) for p in geometry] == cands[0]["geometry"]


def test_max_is_required_and_from_1_to_9(stack):
    api, h, cands, port = stack()
    url = path(cands[0]["route_id"])
    _, shared = share(api, h, cands[0]["route_id"])
    for params in ({}, {"max": 0}, {"max": 10}, {"max": "three"}):
        for got in (api.get(url, params=params, headers=h), api.get(shared, params=params)):
            assert got.status_code == 422 and got.json()["error"] == "invalid_request"
    assert port.calls == []
    for n in (1, 9):
        assert api.get(url, params={"max": n}, headers=h).status_code == 200


def test_a_route_is_private_even_when_cached(stack):
    api, h, cands, port = stack()
    url = path(cands[0]["route_id"])
    assert api.get(url, params={"max": 3}, headers=h).status_code == 200
    other = {"X-Client-Token": api.post("/v1/session").json()["token"]}
    hidden = api.get(url, params={"max": 3}, headers=other)
    assert hidden.status_code == 404 and hidden.json()["error"] == "not_found"
    assert api.get(url, params={"max": 3}).status_code == 401
    assert len(port.calls) == 1


def test_a_share_link_needs_no_token_and_is_never_stored_by_the_browser(stack):
    api, h, cands, _ = stack()
    _, url = share(api, h, cands[0]["route_id"])
    got = api.get(url, params={"max": 9})
    assert got.status_code == 200 and got.headers["cache-control"] == "no-store"
    assert got.json() == api.get(path(cands[0]["route_id"]), params={"max": 9}, headers=h).json()


def test_a_deleted_link_answers_as_an_unknown_one_even_when_cached(stack):
    api, h, cands, port = stack()
    saved, url = share(api, h, cands[0]["route_id"])
    assert api.get(url, params={"max": 3}).status_code == 200
    assert api.delete(f"/v1/me/routes/{saved['saved_id']}", headers=h).status_code == 204
    gone = api.get(url, params={"max": 3})
    unknown = api.get("/v1/share/not-a-slug/overview-points", params={"max": 3})
    assert gone.status_code == unknown.status_code == 404 and gone.content == unknown.content
    assert gone.headers["cache-control"] == unknown.headers["cache-control"] == "no-store"
    assert api.post(f"/v1/me/routes/{saved['saved_id']}/restore", headers=h).status_code == 200
    assert api.get(url, params={"max": 3}).status_code == 200
    assert len(port.calls) == 1


def test_an_updated_share_link_gives_the_new_routes_points(stack):
    api, h, cands, port = stack()
    saved, url = share(api, h, cands[0]["route_id"])
    assert api.get(url, params={"max": 3}).status_code == 200
    repointed = api.patch(f"/v1/me/routes/{saved['saved_id']}", json={"route_id": cands[1]["route_id"]}, headers=h)
    assert repointed.status_code == 200
    assert api.get(url, params={"max": 3}).status_code == 200
    assert [list(p) for p in port.calls[-1][0]] == cands[1]["geometry"]


def test_cached_by_route_n_and_valhalla_build(stack):
    api, h, cands, port = stack()
    url = path(cands[0]["route_id"])
    first = api.get(url, params={"max": 3}, headers=h).json()
    assert api.get(url, params={"max": 3}, headers=h).json() == first and len(port.calls) == 1
    api.get(url, params={"max": 9}, headers=h)
    assert len(port.calls) == 2
    api.get(path(cands[1]["route_id"]), params={"max": 3}, headers=h)
    assert len(port.calls) == 3

    async def rebuilt():
        return "valhalla test tiles 2"

    api.app.state.overview.valhalla_build = rebuilt
    api.get(url, params={"max": 3}, headers=h)
    assert len(port.calls) == 4


def test_cache_can_be_turned_off(stack):
    api, h, cands, port = stack(cache_enabled=False)
    for _ in range(2):
        assert api.get(path(cands[0]["route_id"]), params={"max": 3}, headers=h).status_code == 200
    assert len(port.calls) == 2


def test_counts_against_the_read_limit(stack):
    api, h, cands, _ = stack(rate_read_per_client_min=2)
    _, shared = share(api, h, cands[0]["route_id"])
    for url, headers in ((path(cands[0]["route_id"]), h), (shared, {})):
        codes = [api.get(url, params={"max": 3}, headers=headers) for _ in range(5)]     # 5: a window may turn over
        limited = [r for r in codes if r.status_code == 429]
        assert limited and limited[0].json()["error"] == "rate_limited" and "retry-after" in limited[0].headers


def test_valhalla_down_is_503_in_the_usual_shape(stack):
    api, h, cands, port = stack(build=None)
    _, shared = share(api, h, cands[0]["route_id"])
    for got in (api.get(path(cands[0]["route_id"]), params={"max": 3}, headers=h), api.get(shared, params={"max": 3})):
        assert got.status_code == 503 and set(got.json()) == {"error", "message", "detail"}
        assert got.json()["error"] == "engine_unavailable"
    assert port.calls == []


def test_a_failure_is_not_cached(stack):
    api, h, cands, port = stack(port=FakePort(error=RuntimeError("boom")))
    url = path(cands[0]["route_id"])
    failed = api.get(url, params={"max": 3}, headers=h)
    assert failed.status_code == 500 and failed.json()["error"] == "overview_failed"
    port.error = None
    assert api.get(url, params={"max": 3}, headers=h).status_code == 200


def test_valhalla_dying_after_the_status_check_is_503(stack):
    api, h, cands, _ = stack()
    from athlete_api.overviewing import real_port

    api.app.state.overview.port = real_port("http://127.0.0.1:9")     # the real client, connection refused
    got = api.get(path(cands[0]["route_id"]), params={"max": 3}, headers=h)
    assert got.status_code == 503 and got.json()["error"] == unavailable("x").error


def test_identical_misses_share_one_computation(stack):
    api, h, cands, port = stack(port=FakePort(delay_s=1.0))
    url = path(cands[0]["route_id"])
    with ThreadPoolExecutor(4) as pool:
        got = list(pool.map(lambda _: api.get(url, params={"max": 3}, headers=h), range(4)))
    assert [r.status_code for r in got] == [200] * 4 and len(port.calls) == 1


def test_only_two_computations_run_at_once(stack):
    api, h, cands, port = stack(port=FakePort(delay_s=0.4))
    url = path(cands[0]["route_id"])
    with ThreadPoolExecutor(6) as pool:
        got = list(pool.map(lambda n: api.get(url, params={"max": n}, headers=h), range(1, 7)))
    assert [r.status_code for r in got] == [200] * 6 and port.peak == 2


def test_a_slow_answer_is_503_then_cached_when_it_finishes(stack):
    api, h, cands, port = stack(port=FakePort(delay_s=0.8))
    api.app.state.overview.wait_s = 0.2
    url = path(cands[0]["route_id"])
    late = api.get(url, params={"max": 3}, headers=h)
    assert late.status_code == 503 and late.json()["error"] == "overview_timeout"
    time.sleep(1.5)
    assert api.get(url, params={"max": 3}, headers=h).status_code == 200
    assert len(port.calls) == 1


def test_openapi_has_both_endpoints(make_client):
    paths = make_client().get("/openapi.json").json()["paths"]
    for p in ("/v1/routes/{route_id}/overview-points", "/v1/share/{slug}/overview-points"):
        op = paths[p]["get"]
        limit = next(x for x in op["parameters"] if x["name"] == "max")
        assert limit["required"] and (limit["schema"]["minimum"], limit["schema"]["maximum"]) == (1, 9)
        assert "503" in op["responses"]
