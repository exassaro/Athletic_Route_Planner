import httpx
import pytest

from athlete_api import main as api_main
from athlete_engine.valhalla import DEFAULT_URL, Valhalla
from devguard import check_database, check_redis


def _valhalla_up() -> bool:
    try:
        return httpx.get(f"{DEFAULT_URL}/status", timeout=3).status_code == 200
    except httpx.HTTPError:
        return False


def pytest_collection_modifyitems(config, items):
    if not any("integration" in item.keywords for item in items) or _valhalla_up():
        return
    skip = pytest.mark.skip(reason=f"Valhalla not reachable at {DEFAULT_URL}")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session", autouse=True)
def no_development_data():
    """Every app a test starts is checked where its lifespan opens the database and Redis (tests/devguard.py)."""
    make_engine, redis_class = api_main.make_engine, api_main.Redis

    class TestRedis(redis_class):
        @classmethod
        def from_url(cls, url, **kwargs):
            return redis_class.from_url(check_redis(url), **kwargs)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(api_main, "make_engine", lambda url: make_engine(check_database(url)))
        patch.setattr(api_main, "Redis", TestRedis)
        yield


@pytest.fixture(scope="session")
def engine():
    with Valhalla() as client:
        yield client
