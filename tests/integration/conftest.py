"""Live API tests: the real app and solver on a throwaway database (athlete_live) and Redis db 14.

Needs Valhalla, GraphHopper, Postgres and Redis (Photon for place tests). Skipped by the root conftest when
Valhalla is down.
"""

import pytest
import redis
from fastapi.testclient import TestClient

from athlete_api.config import Settings
from athlete_api.main import create_app
from dbutil import fresh_database

LIVE_DB = "athlete_live"
LIVE_REDIS = "redis://localhost:6379/14"


@pytest.fixture(scope="session")
def live_database() -> str:
    return fresh_database(LIVE_DB)


@pytest.fixture(scope="session")
def live_redis() -> str:
    redis.Redis.from_url(LIVE_REDIS).flushdb()
    return LIVE_REDIS


@pytest.fixture
def live_app(live_database):
    """live_app(**settings) -> TestClient with a session token, on the live engines and a flushed cache."""
    redis.Redis.from_url(LIVE_REDIS).flushdb()
    opened = []

    def make(**overrides) -> TestClient:
        settings = Settings(database_url=live_database, redis_url=LIVE_REDIS).model_copy(update=overrides)
        client = TestClient(create_app(settings))
        client.__enter__()
        client.headers["X-Client-Token"] = client.post("/v1/session").json()["token"]
        opened.append(client)
        return client

    yield make
    for client in opened:
        client.__exit__(None, None, None)
