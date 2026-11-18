"""Six simultaneous solves through the API on the live stack (Phase 4 step 10, amendment 3).

Default settings: 2 slots, 10 s wait, 15 s budget. Expected: never more than 2 solves running, every request
201 or 429 solver_busy (with Retry-After), no other error, no engine timeout. The outcome of each request is
printed for the report (pytest -s).
"""

import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = {f["id"]: f for f in json.loads((ROOT / "tests/fixtures/scenarios/scenarios.json")
                                           .read_text(encoding="utf-8"))["fixtures"]}
# Six different point-to-point requests in four districts (distinct cache keys, so six real solves).
SIX = ["S04", "B01", "B02", "X04", "X05", "X09"]


def test_six_simultaneous_solves(live_app):
    api = live_app()
    runner = api.app.state.planner.runner
    assert runner.slots == 2

    def post(fid):
        t0 = time.perf_counter()
        resp = api.post("/v1/plans", json={"request": FIXTURES[fid]["request"]})
        return fid, resp, time.perf_counter() - t0

    t0 = time.perf_counter()
    with ThreadPoolExecutor(len(SIX)) as pool:
        results = list(pool.map(post, SIX))
    wall = time.perf_counter() - t0

    print(f"\nsix simultaneous solves, wall {wall:.1f} s, peak running {runner.peak_running}, solves run {runner.started}")
    for fid, resp, dt in results:
        body = resp.json()
        what = (f"{body['outcome']}, solver {body['elapsed_ms'] / 1000:.2f} s" if resp.status_code == 201
                else f"{body['error']} Retry-After {resp.headers.get('Retry-After')}")
        print(f"  {fid}: {resp.status_code} in {dt:.2f} s ({what})")

    assert runner.peak_running <= 2
    statuses = [resp.status_code for _, resp, _ in results]
    assert set(statuses) <= {201, 429}, statuses
    assert statuses.count(201) >= 2
    for _, resp, _ in results:
        if resp.status_code == 429:
            assert resp.json()["error"] == "solver_busy" and int(resp.headers["Retry-After"]) >= 1
        else:
            body = resp.json()
            assert body["candidates"], body["outcome"]
            assert not any(f["code"] == "alternative_unavailable" for f in body["flags"])   # GraphHopper answered
    assert runner.running == 0 and runner.started == statuses.count(201)
