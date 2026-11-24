"""A15 on live Valhalla: the endpoint gives what was measured (docs/reports/phase5d/cues_data.json).

A fake solver stores A01's real result, so GraphHopper is not needed; the cues come from Valhalla.
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
MEASURED = json.loads((ROOT / "docs/reports/phase5d/cues_data.json").read_text(encoding="utf-8"))["tracks"]


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
        body = api.get(f"/v1/routes/{route_id}/follow", headers=h).json()
        assert body["cue_source"] == "junctions"
        want = MEASURED["A01 recommended"]["cues"]
        assert [(c["at_m"], c["turn"], c["road"]) for c in body["cues"]] == [(c["at_m"], c["turn"], c["road"]) for c in want]
        assert [[s["road"] for s in c["then"]] for c in body["cues"]] == [[s["road"] for s in c["then"]] for c in want]
        assert api.get(f"/v1/share/{slug}/follow").json() == body
