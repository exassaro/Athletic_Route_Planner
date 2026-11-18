"""POST /v1/plans, GET /v1/plans/{id}, GET /v1/plans/{id}/versions/{n} with a fake solver (Phase 4 step 5).

The fake returns the solver's real A01 result (Phase 3b report) for any request, so these tests check the API's
own behaviour: storage, cache, slots, the 15 s budget, errors, ownership.
"""

import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from athlete_solver.models import Flag

from api_fixtures import BUILDS, FakeSolver, a01_result, fixture_request
from athlete_api.elevation import ElevationMissing
from athlete_solver.models import RouteRequest

A01 = fixture_request("A01")


def body(distance_m: float | None = None) -> dict:
    req = dict(A01)
    if distance_m is not None:
        req["target_distance_m"] = distance_m
    return {"request": req, "source": "form"}


def session(api) -> dict:
    return {"X-Client-Token": api.post("/v1/session").json()["token"]}


def strip(c: dict) -> dict:
    """The solver's candidate: drop what the API adds (route id; climb_approximate, Phase 5 amendment 15)."""
    c = dict(c)
    c.pop("route_id")
    assert isinstance(c.pop("climb_approximate"), bool)
    return c


def test_create_stores_version_1_with_the_solver_result(make_client):
    fake = FakeSolver()
    api = make_client(solver=fake)
    h = session(api)
    resp = api.post("/v1/plans", json=body(), headers=h)
    assert resp.status_code == 201, resp.json()
    out = resp.json()
    expected = a01_result(RouteRequest.model_validate(A01))
    assert out["version"] == 1 and out["cached"] is False and out["diff"] is None
    assert out["outcome"] == expected.outcome
    assert out["facts"] == expected.model_dump(mode="json")["facts"]
    assert [strip(c) for c in out["candidates"]] == \
        expected.model_dump(mode="json", exclude={"candidates": {"__all__": {"edge_ids"}}})["candidates"]
    assert all("edge_ids" not in c for c in out["candidates"])
    assert out["request"] == RouteRequest.model_validate(A01).model_dump(mode="json")
    assert out["builds"]["valhalla"] == "valhalla test tiles 1" and out["builds"]["osm"] == expected.graph_build

    plan = api.get(f"/v1/plans/{out['plan_id']}", headers=h).json()
    assert plan["status"] == "ready" and plan["versions"] == [1] and plan["latest"] == out
    assert api.get(f"/v1/plans/{out['plan_id']}/versions/1", headers=h).json() == out
    missing = api.get(f"/v1/plans/{out['plan_id']}/versions/2", headers=h)
    assert missing.status_code == 404 and missing.json()["error"] == "not_found"


def test_identical_request_is_a_cache_hit(make_client):
    fake = FakeSolver()
    api = make_client(solver=fake)
    h = session(api)
    first = api.post("/v1/plans", json=body(), headers=h).json()
    second = api.post("/v1/plans", json=body(), headers=h).json()
    assert fake.calls == 1
    assert second["cached"] is True and second["plan_id"] != first["plan_id"]
    assert [strip(c) for c in second["candidates"]] == [strip(c) for c in first["candidates"]]
    assert second["elapsed_ms"] == first["elapsed_ms"]          # the original solve's time
    other = api.post("/v1/plans", json=body(20_000), headers=h).json()
    assert other["cached"] is False and fake.calls == 2


def test_a_new_engine_build_misses_the_cache(make_client):
    fake = FakeSolver()
    builds = [BUILDS]
    api = make_client(solver=fake)

    async def current():
        return builds[0]

    api.app.state.planner.current_builds = current
    h = session(api)
    api.post("/v1/plans", json=body(), headers=h)
    builds[0] = BUILDS.__class__(**{**BUILDS.__dict__, "graphhopper": "graphhopper test import 2"})
    assert api.post("/v1/plans", json=body(), headers=h).json()["cached"] is False
    builds[0] = BUILDS.__class__(**{**BUILDS.__dict__, "solver": "changed"})
    assert api.post("/v1/plans", json=body(), headers=h).json()["cached"] is False
    assert fake.calls == 3


def test_degraded_results_are_not_cached(make_client):
    flag = Flag(code="alternative_unavailable", message="recommended route unavailable: test")
    fake = FakeSolver(flags=[flag])
    api = make_client(solver=fake)
    h = session(api)
    api.post("/v1/plans", json=body(), headers=h)
    again = api.post("/v1/plans", json=body(), headers=h).json()
    assert again["cached"] is False and fake.calls == 2


def test_plans_belong_to_their_client(make_client):
    api = make_client(solver=FakeSolver())
    plan_id = api.post("/v1/plans", json=body(), headers=session(api)).json()["plan_id"]
    other = session(api)
    for path in (f"/v1/plans/{plan_id}", f"/v1/plans/{plan_id}/versions/1"):
        resp = api.get(path, headers=other)
        assert resp.status_code == 404 and resp.json()["error"] == "not_found"
    assert api.post("/v1/plans", json=body()).status_code == 401


def test_invalid_request_is_422_with_the_solver_models_errors(make_client):
    api = make_client(solver=FakeSolver())
    h = session(api)
    bad = body()
    bad["request"] = {**bad["request"], "target_distance_m": -5, "pace": 300}
    resp = api.post("/v1/plans", json=bad, headers=h)
    assert resp.status_code == 422 and resp.json()["error"] == "invalid_request"
    locs = {tuple(e["loc"][-1:]) for e in resp.json()["detail"]}
    assert ("target_distance_m",) in locs and ("pace",) in locs     # extra fields are errors (Strict models)


def test_no_slot_within_the_wait_is_429_solver_busy(make_client):
    fake = FakeSolver(delay_s=1.5)
    api = make_client(solver=fake, solve_slots=1, slot_wait_s=0.3, busy_retry_after_s=7)
    h = session(api)
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(api.post, "/v1/plans", json=body(21_000), headers=h)
        time.sleep(0.3)
        second = pool.submit(api.post, "/v1/plans", json=body(22_000), headers=h)
        r1, r2 = first.result(), second.result()
    assert r1.status_code == 201
    assert r2.status_code == 429 and r2.json()["error"] == "solver_busy" and r2.headers["Retry-After"] == "7"
    assert fake.peak == 1


def test_identical_requests_in_flight_share_one_solve(make_client):
    fake = FakeSolver(delay_s=1.0)
    api = make_client(solver=fake, solve_slots=1, slot_wait_s=0.2)
    h = session(api)
    with ThreadPoolExecutor(3) as pool:
        results = list(pool.map(lambda _: api.post("/v1/plans", json=body(), headers=h), range(3)))
    assert [r.status_code for r in results] == [201, 201, 201]
    assert fake.calls == 1
    assert len({r.json()["plan_id"] for r in results}) == 3


def test_over_the_budget_is_504_and_the_version_appears_later(make_client):
    fake = FakeSolver(delay_s=1.5)
    api = make_client(solver=fake, solve_budget_s=0.4)
    h = session(api)
    resp = api.post("/v1/plans", json=body(), headers=h)
    assert resp.status_code == 504
    detail = resp.json()["detail"]
    assert resp.json()["error"] == "solve_timeout" and detail["status"] == "solving"
    plan = api.get(detail["poll"], headers=h).json()
    assert plan["status"] == "solving" and plan["versions"] == [] and plan["latest"] is None
    runner = api.app.state.planner.runner
    assert runner.running == 1                     # the slot is still held by the running thread
    deadline = time.time() + 5
    while api.get(detail["poll"], headers=h).json()["status"] == "solving" and time.time() < deadline:
        time.sleep(0.1)
    plan = api.get(detail["poll"], headers=h).json()
    assert plan["status"] == "ready" and plan["versions"] == [1] and runner.running == 0


@pytest.mark.parametrize("error, status, code", [
    (RuntimeError("boom"), 500, "solve_failed"),
    (httpx.ConnectError("refused"), 503, "engine_unavailable"),
    (ElevationMissing("no height for 3 of 900 points"), 502, "elevation_unavailable"),
])
def test_solver_failures_map_to_errors_and_are_remembered(make_client, error, status, code):
    api = make_client(solver=FakeSolver(error=error))
    h = session(api)
    resp = api.post("/v1/plans", json=body(), headers=h)
    assert resp.status_code == status and resp.json()["error"] == code
    plan_id = next(iter(api.app.state.planner.pending), None)
    assert plan_id is None                         # nothing left running
    assert api.app.state.planner.runner.running == 0


def test_failed_plan_reports_failed(make_client):
    api = make_client(solver=FakeSolver(error=RuntimeError("boom")), solve_budget_s=0.5)
    h = session(api)
    fake = api.app.state.planner.runner.port
    fake.delay_s = 1.0
    resp = api.post("/v1/plans", json=body(), headers=h)
    assert resp.status_code == 504
    poll = resp.json()["detail"]["poll"]
    deadline = time.time() + 5
    while api.get(poll, headers=h).json()["status"] == "solving" and time.time() < deadline:
        time.sleep(0.1)
    plan = api.get(poll, headers=h).json()
    assert plan["status"] == "failed" and plan["error"]["error"] == "solve_failed"


def test_valhalla_down_is_503_before_any_solve(make_client):
    fake = FakeSolver()
    api = make_client(solver=fake, builds=None)       # real build lookup against an unreachable Valhalla
    resp = api.post("/v1/plans", json=body(), headers=session(api))
    assert resp.status_code == 503 and resp.json()["error"] == "engine_unavailable"
    assert fake.calls == 0
