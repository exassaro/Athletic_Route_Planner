"""Request items from OSM ways and boundaries (Phase 5 A6), on athlete_test seeded from rules_places.json.

rules_places.json holds A01's places with every boundary that contains them, and the Karuvanthuruthy bridge way,
all read from the pinned extract. Seeding the tables with exactly those objects lets the rules be checked against
the fixture request (tests/fixtures/scenarios/scenarios.json), with no extract and no engine.
"""

import json
from pathlib import Path

import psycopg
import pytest
import shapely
from athlete_solver.models import Checkpoint
from shapely.geometry import LineString, shape

from athlete_api.config import sync_database_url
from api_fixtures import FakeSolver

ROOT = Path(__file__).resolve().parents[2]
RULES = json.loads((ROOT / "tests/fixtures/rules_places.json").read_text(encoding="utf-8"))
A01 = next(f for f in json.loads((ROOT / "tests/fixtures/scenarios/scenarios.json").read_text(encoding="utf-8"))
           ["fixtures"] if f["id"] == "A01")["request"]
BRIDGE = RULES["places"]["karuvanthuruthy_bridge"]
STAMP = RULES["extract"]["osm_timestamp"]


def ewkb(geom) -> str:
    return shapely.to_wkb(shapely.set_srid(geom, 4326), hex=True, include_srid=True)


def seed(database_url: str, with_meta: bool = True) -> None:
    dsn = sync_database_url(database_url).replace("postgresql+psycopg://", "postgresql://")
    bounds = {}
    for p in RULES["places"].values():
        for b in p.get("boundaries", []):
            bounds[int(b["osm_id"].split("/")[1])] = b
    coords = BRIDGE["coords"]
    half = len(coords) // 2
    with psycopg.connect(dsn) as conn:
        conn.execute("TRUNCATE osm_ways, osm_boundaries, osm_features_meta")
        for rid, b in bounds.items():
            conn.execute("INSERT INTO osm_boundaries VALUES (%s, %s, %s, %s, %s)",
                         (rid, b["name"], b["boundary"], int(b["admin_level"]), ewkb(shape(b["geometry"]))))
        way_id = int(BRIDGE["osm_id"].split("/")[1])
        ways = [(way_id, BRIDGE["name"], BRIDGE["highway"], True, LineString(coords)),
                # Test-only ways cut from the bridge's own geometry: a road of the same name joined at one end,
                # and one of the same name that does not touch it.
                (1, BRIDGE["name"], "secondary", False, LineString([coords[-1], coords[0]])),
                (2, BRIDGE["name"], "secondary", False,
                 LineString([(x + 0.01, y) for x, y in coords[:half + 1]])),
                (3, None, "residential", False, LineString([(x, y + 0.002) for x, y in coords]))]
        for wid, name, hw, br, geom in ways:
            conn.execute("INSERT INTO osm_ways VALUES (%s, %s, %s, %s, %s, %s)",
                         (wid, name, hw, br, json.dumps({"highway": hw}), ewkb(geom)))
        if with_meta:
            conn.execute("INSERT INTO osm_features_meta VALUES ('osm_timestamp', %s)", (STAMP,))


@pytest.fixture
def api(make_client, database_url):
    seed(database_url)
    client = make_client(solver=FakeSolver())
    client.headers["X-Client-Token"] = client.post("/v1/session").json()["token"]
    return client


def item(api, **params):
    resp = api.get("/v1/features/item", params=params)
    assert resp.status_code == 200, resp.json()
    return resp.json()


def test_a01_checkpoints_equal_the_fixture_request(api):
    """Built from the place search's point and id (or the way), every A01 checkpoint equals the fixture's."""
    for want in A01["checkpoints"]:
        kind = want.get("kind", "place")
        params = {"role": "checkpoint", "kind": kind, "place_id": want["place_id"], "label": want["label"]}
        if kind == "place":
            params |= {"lon": want["lon"], "lat": want["lat"]}
        got = item(api, **params)
        assert got["extract"] == STAMP and got["role"] == "checkpoint" and got["via"] is None
        assert Checkpoint.model_validate(got["checkpoint"]) == Checkpoint.model_validate(want), want["label"]


def test_must_reach_has_no_boundary_and_bridges_keep_their_middle(api):
    k = next(c for c in A01["checkpoints"] if c["label"] == "Chaliyam")
    got = item(api, role="checkpoint", place_id=k["place_id"], lon=k["lon"], lat=k["lat"], label="Chaliyam",
               must_reach="true")["checkpoint"]
    assert got["must_reach"] is True and got["boundary"] is None
    b = item(api, role="must_use", kind="bridge", place_id=BRIDGE["osm_id"].replace("way/", "osm:way/"))
    mu = b["must_use"]
    assert mu["label"] == "Chaliyam - Feroke Road" and mu["way_ids"] == [389396419]
    assert mu["lines"] == [BRIDGE["coords"]] and [mu["lon"], mu["lat"]] == BRIDGE["coords"][len(BRIDGE["coords"]) // 2]


def test_a_named_road_is_its_connected_ways(api):
    road = item(api, role="via", kind="road", place_id="osm:way/389396419")["via"]
    assert road["kind"] == "road" and road["way_ids"] == [1, 389396419]        # way 2 has the name but no contact
    avoid = item(api, role="avoid", kind="road", place_id="osm:way/389396419")["avoid"]
    assert avoid["way_ids"] == [1, 389396419] and avoid["lon"] is None
    unnamed = item(api, role="must_use", kind="road", place_id="osm:way/3")["must_use"]
    assert unnamed["way_ids"] == [3] and unnamed["label"] == "Unnamed residential"


def test_avoid_place_is_a_circle(api):
    got = item(api, role="avoid", place_id="osm:node/1683145417", lon=75.8095217, lat=11.1559577,
               label="Chaliyam", radius_m=500)["avoid"]
    assert got == {"kind": "place", "label": "Chaliyam", "lon": 75.8095217, "lat": 11.1559577, "radius_m": 500.0,
                   "polygon": None, "way_ids": [], "lines": []}


def test_errors(api, make_client, database_url):
    assert api.get("/v1/features/item", params={"role": "checkpoint", "place_id": "node/1"}).json()["error"] \
        == "invalid_place_id"
    bad = api.get("/v1/features/item", params={"role": "must_use", "kind": "bridge", "place_id": "osm:node/5"})
    assert bad.status_code == 422 and bad.json()["error"] == "unsupported_kind"
    gone = api.get("/v1/features/item", params={"role": "must_use", "kind": "bridge", "place_id": "osm:way/42"})
    assert gone.status_code == 404
    place = api.get("/v1/features/item", params={"role": "must_use", "place_id": "osm:node/5", "lon": 75.8,
                                                 "lat": 11.1, "label": "X"})
    assert place.status_code == 422
    seed(database_url, with_meta=False)
    empty = api.get("/v1/features/nearby", params={"lon": 75.8, "lat": 11.1})
    assert empty.status_code == 503 and empty.json()["error"] == "osm_features_missing"


def test_nearby_finds_the_bridge_at_a_tap(api):
    mid = BRIDGE["coords"][len(BRIDGE["coords"]) // 2]
    out = api.get("/v1/features/nearby", params={"lon": mid[0], "lat": mid[1], "radius_m": 20}).json()
    assert out["extract"] == STAMP
    assert out["ways"][0] == {"place_id": "osm:way/389396419", "label": "Chaliyam - Feroke Road",
                              "name": "Chaliyam - Feroke Road", "highway": "secondary", "bridge": True}
    far = api.get("/v1/features/nearby", params={"lon": mid[0] + 0.05, "lat": mid[1], "radius_m": 20}).json()
    assert far["ways"] == []


def test_needs_a_token(make_client, database_url):
    seed(database_url)
    assert make_client().get("/v1/features/nearby", params={"lon": 75.8, "lat": 11.1}).status_code == 401


def test_health_reports_the_loaded_extract(make_client, database_url):
    seed(database_url, with_meta=False)
    key = {"X-Health-Key": "k" * 32}
    assert "not loaded" in make_client(health_key="k" * 32).get("/v1/health", headers=key
                                                               ).json()["services"]["osm_features"]["detail"]
    seed(database_url)
    got = make_client(health_key="k" * 32).get("/v1/health", headers=key).json()["services"]["osm_features"]
    assert got["ok"] and got["build"].startswith(f"osm {STAMP}")
