"""/v1/health against the live stack: every service up and both engine build ids reported (Phase 4 step 3).

Needs Valhalla, GraphHopper, Photon, Postgres and Redis running. The app runs on athlete_live. The record of the
loaded OSM features is read from the development database over a read-only connection and copied there, so this
still fails when that database's features are missing or from another extract.
"""

import psycopg
import pytest
from fastapi.testclient import TestClient

from athlete_api.builds import osm_pin
from athlete_api.config import Settings
from athlete_api.main import create_app
from dbutil import admin_dsn

pytestmark = pytest.mark.integration


@pytest.fixture
def loaded_features(live_database):
    with psycopg.connect(admin_dsn(), options="-c default_transaction_read_only=on") as dev:
        rows = dev.execute("SELECT key, value FROM osm_features_meta").fetchall()
    live = live_database.replace("+asyncpg", "")
    with psycopg.connect(live, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM osm_features_meta")
        cur.executemany("INSERT INTO osm_features_meta (key, value) VALUES (%s, %s)", rows)
    yield
    with psycopg.connect(live, autocommit=True) as conn:
        conn.execute("DELETE FROM osm_features_meta")


def test_health_reports_every_service_and_both_builds(live_database, live_redis, loaded_features):
    settings = Settings(database_url=live_database, redis_url=live_redis, health_key="live-check-key")
    with TestClient(create_app(settings)) as api:
        resp = api.get("/v1/health", headers={"X-Health-Key": "live-check-key"})
    body = resp.json()
    assert resp.status_code == 200, body
    assert body["status"] == "ok", {k: v["detail"] for k, v in body["services"].items() if not v["ok"]}
    builds = body["builds"]
    assert builds["valhalla"].startswith("valhalla ") and " tiles " in builds["valhalla"]
    assert builds["graphhopper"].startswith("graphhopper ") and " import " in builds["graphhopper"]
    # Both engines run on the pinned extract.
    assert builds["osm"] == osm_pin(settings.manifest_path) == builds["graphhopper_data"]
