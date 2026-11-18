"""Place search through the API against the live Photon (Phase 4 step 8). Needs Photon, Postgres and Redis."""

import httpx
import pytest
from fastapi.testclient import TestClient

from athlete_api.config import Settings
from athlete_api.main import create_app

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def api():
    settings = Settings()
    try:
        httpx.get(f"{settings.photon_url}/status", timeout=3).raise_for_status()
    except httpx.HTTPError:
        pytest.skip("Photon not running: docker compose --profile geocode up -d photon")
    with TestClient(create_app(settings)) as client:
        client.headers["X-Client-Token"] = client.post("/v1/session").json()["token"]
        yield client


def test_kadalundi_is_found_in_kerala_and_left_to_a_picker(api):
    out = api.get("/v1/places/search", params={"q": "Kadalundi", "lat": 11.1209333, "lon": 75.8460689}).json()
    assert out["ambiguous"] is True and len(out["candidates"]) > 1
    assert all(c["state"] == "Kerala" for c in out["candidates"])
    assert any(c["label"] == "Kadalundi" and c["county"] == "Kozhikode" for c in out["candidates"])


def test_reverse_at_the_a01_start(api):
    out = api.get("/v1/places/reverse", params={"lat": 11.1209333, "lon": 75.8460689}).json()
    assert out["place"]["place_id"] == "osm:node/1770460252"
