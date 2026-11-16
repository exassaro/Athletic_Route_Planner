import httpx
import pytest

from athlete_engine.valhalla import DEFAULT_URL, Valhalla


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


@pytest.fixture(scope="session")
def engine():
    with Valhalla() as client:
        yield client
