"""A14 on live Valhalla: the endpoint gives what was measured (docs/reports/phase5d/overview_data.json).

A fake solver stores A01's real result, so GraphHopper is not needed; the overview points come from Valhalla.
"""

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from athlete_api.config import Settings
from athlete_api.main import create_app

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "api"))
from api_fixtures import BUILDS, FakeSolver, fixture_request  # noqa: E402

pytestmark = pytest.mark.integration
MEASURED = json.loads((ROOT / "docs/reports/phase5d/overview_data.json").read_text(encoding="utf-8"))


def test_the_endpoints_give_what_was_measured(live_database, live_redis):
    app = create_app(Settings(database_url=live_database, redis_url=live_redis), solver=FakeSolver())
    with TestClient(app) as api:
        async def fixed():
            return BUILDS

        app.state.planner.current_builds = fixed
        h = {"X-Client-Token": api.post("/v1/session").json()["token"]}
        plan = api.post("/v1/plans", json={"request": fixture_request("A01")}, headers=h).json()
        route_id = plan["candidates"][0]["route_id"]
        slug = api.post(f"/v1/routes/{route_id}/save", headers=h).json()["share_slug"]
        rows = {r["n"]: r["smart"] for r in MEASURED["tracks"]["A01 recommended"]["rows"]}
        for n in (3, 9):
            got = api.get(f"/v1/routes/{route_id}/overview-points", params={"max": n}, headers=h)
            assert got.status_code == 200, got.json()
            body = got.json()
            assert [p["at_m"] for p in body["points"]] == rows[n]["at_m"]
            assert body["max_deviation_m"] == rows[n]["max_deviation_m"]
            assert round(rows[n]["overlap_by_leg_pct"] - body["overlap_pct"], 1) in (0.0, 0.1)     # rounded down here
            assert api.get(f"/v1/share/{slug}/overview-points", params={"max": n}).json() == body
