"""GET /v1/places/search and /reverse (Phase 4 step 8), Photon replaced by its recorded responses."""

import json
from pathlib import Path

import httpx

from athlete_api.places import KERALA_BBOX, Photon

PHOTON = Path(__file__).resolve().parents[1] / "fixtures" / "photon"
RECORDED = {json.loads(p.read_text(encoding="utf-8"))["params"].get("q", "reverse"): json.loads(p.read_text(encoding="utf-8"))
            for p in PHOTON.glob("*.json")}


def photon_mock(seen: list):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        key = request.url.params.get("q", "reverse") if request.url.path == "/api" else "reverse"
        return httpx.Response(200, json=RECORDED[key]["response"])
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def client(make_client, seen=None):
    api = make_client()
    seen = [] if seen is None else seen
    api.app.state.photon = Photon("http://photon.test", photon_mock(seen))
    return api, {"X-Client-Token": api.post("/v1/session").json()["token"]}


def test_search_returns_every_candidate_and_never_picks(make_client):
    seen = []
    api, h = client(make_client, seen)
    resp = api.get("/v1/places/search", params={"q": "Chungam", "lat": 11.12, "lon": 75.85}, headers=h)
    assert resp.status_code == 200
    out = resp.json()
    assert out["source"] == "photon" and out["ambiguous"] is True
    assert len(out["candidates"]) == len(RECORDED["Chungam"]["response"]["features"])
    assert any(r["reason"] == "same_name_different_areas" and r["name"] == "Chungam" for r in out["reasons"])
    assert all(c["state"] == "Kerala" and c["place_id"].startswith("osm:") for c in out["candidates"])
    sent = seen[0].url.params
    assert sent["q"] == "Chungam" and sent["lat"] == "11.12" and sent["lon"] == "75.85" and sent["lang"] == "en"
    assert sent["bbox"] == ",".join(str(v) for v in KERALA_BBOX)


def test_reverse(make_client):
    api, h = client(make_client)
    out = api.get("/v1/places/reverse", params={"lat": 11.1209333, "lon": 75.8460689}, headers=h).json()
    assert out["place"]["place_id"] == "osm:node/1770460252" and out["place"]["label"] == "Athanikkal"


def test_photon_down_is_503_and_no_fallback(make_client):
    api = make_client()                                # Photon URL points at a closed port
    h = {"X-Client-Token": api.post("/v1/session").json()["token"]}
    for path, params in (("/v1/places/search", {"q": "Kadalundi"}), ("/v1/places/reverse", {"lat": 11.1, "lon": 75.8})):
        resp = api.get(path, params=params, headers=h)
        assert resp.status_code == 503
        body = resp.json()
        assert body["error"] == "geocoder_unavailable" and "Photon" in body["message"]
        assert "candidates" not in body and "place" not in body


def test_validation_and_token(make_client):
    api, h = client(make_client)
    assert api.get("/v1/places/search", params={"q": "K"}, headers=h).status_code == 422
    assert api.get("/v1/places/search", params={"q": "Kadalundi", "lat": 95}, headers=h).status_code == 422
    assert api.get("/v1/places/search", params={"q": "Kadalundi"}).status_code == 401
