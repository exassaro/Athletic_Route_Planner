"""A15 follow data: ownership, share links, cache, limits, and the fallback that never fails (Phase 5d amendment 6).

A fake port stands in for Valhalla; the cue rule is tested in tests/unit/api/test_api_follow.py.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from athlete_engine import geodesy
from athlete_engine.valhalla import ValhallaError

from athlete_api import follow, following
from api_fixtures import FakeSolver, fixture_request

A01 = fixture_request("A01")


class FakePort:
    """Every bend is at a junction, on roads named by the hundred metres."""

    def __init__(self, delay_s: float = 0.0, error: Exception | None = None):
        self.delay_s, self.error = delay_s, error
        self.calls: list[list] = []
        self._lock = threading.Lock()

    def __call__(self, line):
        with self._lock:
            self.calls.append(line.geometry)
        time.sleep(self.delay_s)
        if self.error:
            raise self.error
        return follow.Match(junctions=[b.at_m for b in line.bends()],
                            name_from=[(m, f"Road {m // 100}") for m in range(0, int(line.length_m), 100)])


@pytest.fixture
def stack(make_client):
    def make(port=None, build="valhalla test tiles 1", **overrides):
        api = make_client(solver=FakeSolver(), **overrides)
        h = {"X-Client-Token": api.post("/v1/session").json()["token"]}
        cands = api.post("/v1/plans", json={"request": A01}, headers=h).json()["candidates"]
        port = port or FakePort()
        api.app.state.follow.port = port

        async def fixed():
            return build

        if build:       # None: ask Valhalla, unreachable in these tests
            api.app.state.follow.valhalla_build = fixed
        return api, h, cands, port

    return make


def path(route_id) -> str:
    return f"/v1/routes/{route_id}/follow"


def share(api, h, route_id) -> tuple[dict, str]:
    saved = api.post(f"/v1/routes/{route_id}/save", headers=h).json()
    return saved, f"/v1/share/{saved['share_slug']}/follow"


def test_metres_at_every_vertex_of_every_candidate(stack):
    api, h, cands, _ = stack()
    for cand in cands:
        body = api.get(path(cand["route_id"]), headers=h).json()
        assert set(body) == {"route_id", "points", "along_m", "cue_source", "cues"}
        assert body["route_id"] == cand["route_id"] and body["points"] == cand["geometry"]
        along = body["along_m"]
        assert along[0] == 0 and along == sorted(along) and len(along) == len(body["points"])
        assert along == [round(d, 1) for d in geodesy.cumulative_m(cand["geometry"])]
        assert along[-1] == pytest.approx(cand["length_m"], abs=0.06)


def test_cues_carry_turn_road_and_what_follows(stack):
    api, h, cands, _ = stack()
    body = api.get(path(cands[0]["route_id"]), headers=h).json()
    assert body["cue_source"] == "junctions" and body["cues"]
    for cue in body["cues"]:
        assert set(cue) == {"at_m", "turn", "road", "then"}
        assert all(set(s) == {"at_m", "turn", "road"} for s in cue["then"])
        assert cue["turn"] in ("left", "right", "around") and cue["at_m"] == round(cue["at_m"], 1)
    assert any(c["road"] for c in body["cues"]) and any(c["then"] for c in body["cues"])


def test_a_route_is_private_even_when_cached(stack):
    api, h, cands, port = stack()
    url = path(cands[0]["route_id"])
    assert api.get(url, headers=h).status_code == 200
    other = {"X-Client-Token": api.post("/v1/session").json()["token"]}
    hidden = api.get(url, headers=other)
    assert hidden.status_code == 404 and hidden.json()["error"] == "not_found"
    assert api.get(url).status_code == 401
    assert len(port.calls) == 1


def test_a_share_link_needs_no_token_and_is_never_stored_by_the_browser(stack):
    api, h, cands, _ = stack()
    _, url = share(api, h, cands[0]["route_id"])
    got = api.get(url)
    assert got.status_code == 200 and got.headers["cache-control"] == "no-store"
    assert got.json() == api.get(path(cands[0]["route_id"]), headers=h).json()


def test_a_deleted_link_answers_as_an_unknown_one_even_when_cached(stack):
    api, h, cands, _ = stack()
    saved, url = share(api, h, cands[0]["route_id"])
    assert api.get(url).status_code == 200
    assert api.delete(f"/v1/me/routes/{saved['saved_id']}", headers=h).status_code == 204
    gone, unknown = api.get(url), api.get("/v1/share/not-a-slug/follow")
    assert gone.status_code == unknown.status_code == 404 and gone.content == unknown.content
    assert gone.headers["cache-control"] == unknown.headers["cache-control"] == "no-store"
    assert api.post(f"/v1/me/routes/{saved['saved_id']}/restore", headers=h).status_code == 200
    assert api.get(url).status_code == 200


def test_an_updated_share_link_gives_the_new_routes_vertices_and_metres_together(stack):
    api, h, cands, _ = stack()
    saved, url = share(api, h, cands[0]["route_id"])
    assert api.get(url).json()["points"] == cands[0]["geometry"]
    repointed = api.patch(f"/v1/me/routes/{saved['saved_id']}", json={"route_id": cands[1]["route_id"]}, headers=h)
    assert repointed.status_code == 200
    body = api.get(url).json()
    assert body["route_id"] == cands[1]["route_id"] and body["points"] == cands[1]["geometry"]
    assert body["along_m"][-1] == pytest.approx(cands[1]["length_m"], abs=0.06)


def test_cached_by_route_and_valhalla_build(stack):
    api, h, cands, port = stack()
    url = path(cands[0]["route_id"])
    first = api.get(url, headers=h).json()
    assert api.get(url, headers=h).json() == first and len(port.calls) == 1
    api.get(path(cands[1]["route_id"]), headers=h)
    assert len(port.calls) == 2

    async def rebuilt():
        return "valhalla test tiles 2"

    api.app.state.follow.valhalla_build = rebuilt
    api.get(url, headers=h)
    assert len(port.calls) == 3


def test_cache_can_be_turned_off(stack):
    api, h, cands, port = stack(cache_enabled=False)
    for _ in range(2):
        assert api.get(path(cands[0]["route_id"]), headers=h).status_code == 200
    assert len(port.calls) == 2


def test_counts_against_the_read_limit(stack):
    api, h, cands, _ = stack(rate_read_per_client_min=2)
    _, shared = share(api, h, cands[0]["route_id"])
    for url, headers in ((path(cands[0]["route_id"]), h), (shared, {})):
        got = [api.get(url, headers=headers) for _ in range(5)]     # 5: a window may turn over
        limited = [r for r in got if r.status_code == 429]
        assert limited and limited[0].json()["error"] == "rate_limited" and "retry-after" in limited[0].headers


def assert_geometry_only(got):
    assert got.status_code == 200
    body = got.json()
    assert body["cue_source"] == "geometry" and body["cues"] and len(body["along_m"]) == len(body["points"])
    assert all(s["road"] is None for c in body["cues"] for s in (c, *c["then"]))


def test_valhalla_down_is_still_200_for_owner_and_visitor(stack):
    api, h, cands, port = stack(build=None)
    _, shared = share(api, h, cands[0]["route_id"])
    assert_geometry_only(api.get(path(cands[0]["route_id"]), headers=h))
    assert_geometry_only(api.get(shared))
    assert port.calls == []


@pytest.mark.parametrize("error", [httpx.ConnectError("refused"), httpx.ReadTimeout("slow"),
                                   ValhallaError(400, {"error": "no match"}), ValhallaError(500, "broken")])
def test_a_failed_match_falls_back_and_is_not_cached(stack, error):
    api, h, cands, port = stack(port=FakePort(error=error))
    url = path(cands[0]["route_id"])
    assert_geometry_only(api.get(url, headers=h))
    port.error = None
    assert api.get(url, headers=h).json()["cue_source"] == "junctions"


def test_valhalla_dying_after_the_status_check_is_still_200(stack):
    api, h, cands, _ = stack()
    api.app.state.follow.port = following.real_port("http://127.0.0.1:9")     # the real client, refused
    assert_geometry_only(api.get(path(cands[0]["route_id"]), headers=h))


@pytest.mark.parametrize("bug", [RuntimeError("boom"), ValueError("boom")])
def test_our_own_bug_is_not_passed_off_as_valhalla_being_down(stack, bug):
    api, h, cands, _ = stack(port=FakePort(error=bug))
    got = api.get(path(cands[0]["route_id"]), headers=h)
    assert got.status_code == 500 and set(got.json()) == {"error", "message", "detail"}
    assert got.json()["error"] == "follow_failed"


def test_a_slow_match_falls_back_then_is_cached_when_it_finishes(stack):
    api, h, cands, port = stack(port=FakePort(delay_s=0.8))
    api.app.state.follow.wait_s = 0.2
    url = path(cands[0]["route_id"])
    assert_geometry_only(api.get(url, headers=h))
    time.sleep(1.8)
    assert api.get(url, headers=h).json()["cue_source"] == "junctions"
    assert len(port.calls) == 1


def test_identical_misses_share_one_match(stack):
    api, h, cands, port = stack(port=FakePort(delay_s=1.0))
    url = path(cands[0]["route_id"])
    with ThreadPoolExecutor(4) as pool:
        got = list(pool.map(lambda _: api.get(url, headers=h), range(4)))
    assert [r.status_code for r in got] == [200] * 4 and len(port.calls) == 1


def test_metres_that_do_not_end_at_the_solvers_length_are_refused():
    line = [(75.85, 11.10), (75.86, 11.10)]
    with pytest.raises(following.ApiError) as err:
        following.checked_line(line, geodesy.line_length_m(line) + 1.0)
    assert (err.value.status, err.value.error) == (500, "follow_mismatch")


def test_openapi_has_both_endpoints_and_takes_no_position(make_client):
    paths = make_client().get("/openapi.json").json()["paths"]
    for p, only in (("/v1/routes/{route_id}/follow", {"route_id", "X-Client-Token"}),
                    ("/v1/share/{slug}/follow", {"slug"})):
        op = paths[p]["get"]
        assert {x["name"].lower() for x in op.get("parameters", [])} == {x.lower() for x in only}
        assert "requestBody" not in op
