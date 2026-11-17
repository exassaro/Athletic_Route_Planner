"""API tests: the real app on a throwaway database (athlete_test) and Redis db 15. No engines.

Needs `docker compose up -d postgres redis`; skipped otherwise. Engine URLs point at a closed port, so
anything that would reach Valhalla, GraphHopper or Photon fails fast instead of using the live engines.
"""

import psycopg
import pytest
import redis
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from athlete_api.config import ROOT, Settings, sync_database_url
from athlete_api.main import create_app

DEV_URL = Settings().database_url
TEST_DB = "athlete_test"
TEST_URL = DEV_URL.rsplit("/", 1)[0] + f"/{TEST_DB}"
TEST_REDIS = "redis://localhost:6379/15"
DEAD = "http://127.0.0.1:9"   # discard port: connection refused


def _admin_dsn() -> str:
    return sync_database_url(DEV_URL).replace("postgresql+psycopg://", "postgresql://")


def _services_up() -> bool:
    try:
        with psycopg.connect(_admin_dsn(), connect_timeout=3):
            pass
        redis.Redis.from_url(TEST_REDIS, socket_connect_timeout=3).ping()
        return True
    except Exception:  # noqa: BLE001
        return False


def pytest_collection_modifyitems(config, items):
    for item in items:
        if "tests/api/" in item.nodeid.replace("\\", "/"):
            item.add_marker(pytest.mark.api)
    if _services_up():
        return
    skip = pytest.mark.skip(reason="Postgres (port 5433) or Redis (6379) not reachable: docker compose up -d postgres redis")
    for item in items:
        if "api" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def database_url() -> str:
    """A fresh athlete_test database, migrated to head by Alembic (the migrations are what is tested)."""
    with psycopg.connect(_admin_dsn(), autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        conn.execute(f"CREATE DATABASE {TEST_DB}")
    cfg = Config(str(ROOT / "api" / "alembic.ini"))
    cfg.attributes["database_url"] = TEST_URL
    command.upgrade(cfg, "head")
    return TEST_URL


@pytest.fixture
def settings(database_url) -> Settings:
    redis.Redis.from_url(TEST_REDIS).flushdb()
    return Settings(database_url=database_url, redis_url=TEST_REDIS, valhalla_url=DEAD, graphhopper_url=DEAD,
                    photon_url=DEAD, health_timeout_s=1.0)


@pytest.fixture
def make_client(settings):
    """make_client(**overrides) -> TestClient on an app with those settings changed."""
    opened = []

    def make(app_hook=None, **overrides) -> TestClient:
        app = create_app(settings.model_copy(update=overrides))
        if app_hook:
            app_hook(app)
        client = TestClient(app)
        client.__enter__()
        opened.append(client)
        return client

    yield make
    for client in opened:
        client.__exit__(None, None, None)
