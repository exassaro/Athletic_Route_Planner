"""/v1/health against the live stack: every service up and both engine build ids reported (Phase 4 step 3).

Needs Valhalla, GraphHopper, Photon, Postgres and Redis running.
"""

import pytest
from fastapi.testclient import TestClient

from athlete_api.builds import osm_pin
from athlete_api.config import Settings
from athlete_api.main import create_app

pytestmark = pytest.mark.integration


def test_health_reports_every_service_and_both_builds():
    settings = Settings()
    with TestClient(create_app(settings)) as api:
        resp = api.get("/v1/health")
    body = resp.json()
    assert resp.status_code == 200, body
    assert body["status"] == "ok", {k: v["detail"] for k, v in body["services"].items() if not v["ok"]}
    builds = body["builds"]
    assert builds["valhalla"].startswith("valhalla ") and " tiles " in builds["valhalla"]
    assert builds["graphhopper"].startswith("graphhopper ") and " import " in builds["graphhopper"]
    # Both engines run on the pinned extract.
    assert builds["osm"] == osm_pin(settings.manifest_path) == builds["graphhopper_data"]
