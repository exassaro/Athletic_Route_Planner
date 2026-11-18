"""The acceptance flow through the API on the live stack (Phase 4 step 10).

POST A01 and compare with the solver's own result; PATCH to 20 km (over_budget, savings, a cut at the target);
PATCH back to 25 km (equal to the original, through the cache and again with the cache off); save, share, GPX.
"""

import asyncio
import json
from pathlib import Path

import pytest
from athlete_solver.models import RouteRequest
from athlete_solver.solve import solve
from lxml import etree
from sqlalchemy import text

from athlete_api.builds import osm_pin
from athlete_api.config import Settings
from athlete_api.db import make_engine

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[2]
A01 = next(f for f in json.loads((ROOT / "tests/fixtures/scenarios/scenarios.json").read_text(encoding="utf-8"))
           ["fixtures"] if f["id"] == "A01")["request"]
XSD = etree.XMLSchema(etree.parse(str(ROOT / "tests" / "fixtures" / "gpx" / "gpx.xsd")))
PATCH = {"Content-Type": "application/json-patch+json"}
SAME = ("outcome", "conflict", "facts", "flags")       # plus candidates; elapsed_ms, engine_calls differ (amendment 23)


def distance(api, plan_id, metres):
    resp = api.patch(f"/v1/plans/{plan_id}", headers=PATCH,
                     content=json.dumps([{"op": "replace", "path": "/target_distance_m", "value": metres}]))
    assert resp.status_code == 200, resp.json()
    return resp.json()


def candidates(version: dict) -> list[dict]:
    return [{k: v for k, v in c.items() if k != "route_id"} for c in version["candidates"]]


def assert_same(a: dict, b: dict) -> None:
    for key in SAME:
        assert a[key] == b[key], key
    assert candidates(a) == candidates(b)


@pytest.fixture(scope="module")
def solver_a01() -> dict:
    """The solver's own result for A01, run directly (no API), as the API would serialise it."""
    result = solve(RouteRequest.model_validate(A01), graph_build=osm_pin(Settings().manifest_path))
    out = result.model_dump(mode="json", exclude={"candidates": {"__all__": {"edge_ids"}}})
    return out


def test_a01_round_trip(live_app, solver_a01):
    api = live_app()
    v1 = api.post("/v1/plans", json={"request": A01, "source": "form"})
    assert v1.status_code == 201, v1.json()
    v1 = v1.json()
    assert v1["cached"] is False

    # 1. The API's result is the solver's own result.
    for key in SAME:
        assert v1[key] == solver_a01[key], key
    assert candidates(v1) == solver_a01["candidates"]
    assert v1["builds"]["osm"] == solver_a01["graph_build"]

    # 2. 20 km: over budget, with the savings and a cut at the target.
    v2 = distance(api, v1["plan_id"], 20_000)
    assert v2["outcome"] == "over_budget"
    cf = v2["conflict"]
    assert cf["kind"] == "checkpoints_exceed_distance" and cf["minimum_m"] > 20_500 and cf["savings"]
    cuts = [c for c in v2["candidates"] if c["option"] == "cut_at_target"]
    fulls = [c for c in v2["candidates"] if c["option"] == "full_route"]
    assert cuts and fulls
    assert all(abs(c["foot_m"] - 20_000) <= v2["request"]["tolerance_m"] for c in cuts)
    for s in cf["savings"]:
        if s["saves_m"] == 0:
            assert f"Dropping {s['label']} does not shorten the run." in v2["explanation"]
    assert v2["diff"]["changed"] == ["/target_distance_m"] and v2["diff"]["outcome"] == {"from": "ok", "to": "over_budget"}

    # 3. Back to 25 km: equal to the original (a cache hit).
    v3 = distance(api, v1["plan_id"], 25_000)
    assert v3["cached"] is True
    assert_same(v3, v1)

    # 4. Save, share, GPX.
    rid = v3["candidates"][0]["route_id"]
    saved = api.post(f"/v1/routes/{rid}/save", json={"name": "A01 acceptance"})
    assert saved.status_code == 201
    slug = saved.json()["share_slug"]
    shared = api.get(f"/v1/share/{slug}", headers={"X-Client-Token": ""})
    assert shared.status_code == 200 and shared.json()["route"]["properties"]["foot_m"] == v3["candidates"][0]["foot_m"]
    for path in (f"/v1/routes/{rid}/gpx", f"/v1/share/{slug}/gpx"):
        gpx = api.get(path)
        assert gpx.status_code == 200
        doc = etree.fromstring(gpx.content)
        XSD.assertValid(doc)
        assert len(doc.findall(".//{*}trkpt")) == len(v3["candidates"][0]["geometry"])
    assert [m["route_id"] for m in api.get("/v1/me/routes").json()] == [rid]


def test_a01_round_trip_without_the_cache_is_the_same(live_app, solver_a01):
    """The same flow with the cache off: version 3 is a fresh solve and must still equal version 1."""
    api = live_app(cache_enabled=False)
    v1 = api.post("/v1/plans", json={"request": A01}).json()
    v2 = distance(api, v1["plan_id"], 20_000)
    v3 = distance(api, v1["plan_id"], 25_000)
    assert not (v1["cached"] or v2["cached"] or v3["cached"])
    assert v2["outcome"] == "over_budget"
    assert_same(v3, v1)
    assert candidates(v1) == solver_a01["candidates"]


def test_stored_lengths_cross_check_with_postgis(live_app, live_database):
    """ST_Length on the stored 2D line agrees with the solver's length for every stored live route."""
    api = live_app()
    api.post("/v1/plans", json={"request": A01})

    async def lengths():
        engine = make_engine(live_database)
        async with engine.connect() as conn:
            rows = (await conn.execute(text(
                "SELECT length_m, ST_Length(ST_Force2D(geom::geometry)::geography), ST_Length(geom) FROM routes"))).all()
        await engine.dispose()
        return rows

    rows = asyncio.run(lengths())
    assert rows
    for solver_m, postgis_2d, postgis_3d in rows:
        assert abs(postgis_2d - solver_m) <= 1e-6 * solver_m
        assert postgis_3d >= postgis_2d             # real DEM heights: the 3D length is longer
