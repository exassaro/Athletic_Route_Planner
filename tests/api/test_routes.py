"""Route reads, GPX, save, saved routes and share links (Phase 4 step 7). Fake solver: A01's real result."""

from pathlib import Path

from lxml import etree

from api_fixtures import FakeSolver, fixture_request

XSD = etree.XMLSchema(etree.parse(str(Path(__file__).resolve().parents[1] / "fixtures" / "gpx" / "gpx.xsd")))
A01 = fixture_request("A01")


def setup(make_client):
    api = make_client(solver=FakeSolver())
    h = {"X-Client-Token": api.post("/v1/session").json()["token"]}
    v1 = api.post("/v1/plans", json={"request": A01}, headers=h).json()
    return api, h, v1


def test_route_geojson_and_elevation(make_client):
    api, h, v1 = setup(make_client)
    cand = v1["candidates"][0]
    feat = api.get(f"/v1/routes/{cand['route_id']}", headers=h).json()
    assert feat["type"] == "Feature" and feat["geometry"]["type"] == "LineString"
    assert [c[:2] for c in feat["geometry"]["coordinates"]] == cand["geometry"]
    assert all(c[2] == 12.0 for c in feat["geometry"]["coordinates"])       # the fake's placeholder height
    props = feat["properties"]
    assert props["length_m"] == cand["length_m"] and props["foot_m"] == cand["foot_m"]
    assert props["stops"] == cand["stops"] and props["plan_id"] == v1["plan_id"] and props["version"] == 1
    assert "geometry" not in props and "edge_ids" not in props

    elev = api.get(f"/v1/routes/{cand['route_id']}/elevation", headers=h).json()
    assert elev["step_m"] == 30.0 and elev["gain_m"] == cand["gain_m"] and elev["loss_m"] == cand["loss_m"]
    assert elev["profile"] == [[0.0, 12.0], [round(cand["length_m"], 1), 12.0]]


def test_gpx_download_is_valid(make_client):
    api, h, v1 = setup(make_client)
    for cand in v1["candidates"]:
        resp = api.get(f"/v1/routes/{cand['route_id']}/gpx", headers=h)
        assert resp.status_code == 200 and resp.headers["content-type"].startswith("application/gpx+xml")
        assert resp.headers["content-disposition"].startswith('attachment; filename="') and ".gpx" in \
            resp.headers["content-disposition"]
        doc = etree.fromstring(resp.content)
        XSD.assertValid(doc)
        assert len(doc.findall(".//{*}trkpt")) == len(cand["geometry"])
        assert len(doc.findall(".//{*}trkpt/{*}ele")) == len(cand["geometry"])
    bare = api.get(f"/v1/routes/{v1['candidates'][0]['route_id']}/gpx", params={"ele": "false"}, headers=h)
    doc = etree.fromstring(bare.content)
    XSD.assertValid(doc)
    assert doc.find(".//{*}trkpt/{*}ele") is None                      # Phase 5 A2


def test_cors_allows_the_front_end_origin_only(make_client):
    """Phase 5 A1: the dev front end may call the API; other origins get no CORS headers."""
    api = make_client(cors_origins="http://localhost:3000, https://planner.example")
    pre = api.options("/v1/plans", headers={"Origin": "http://localhost:3000",
                                            "Access-Control-Request-Method": "PATCH",
                                            "Access-Control-Request-Headers": "x-client-token,if-match,content-type"})
    assert pre.status_code == 200
    assert pre.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "PATCH" in pre.headers["access-control-allow-methods"]
    allowed = pre.headers["access-control-allow-headers"].lower()
    assert "x-client-token" in allowed and "if-match" in allowed
    got = api.get("/v1/health", headers={"Origin": "https://planner.example"})
    assert got.headers["access-control-allow-origin"] == "https://planner.example"
    assert "retry-after" in got.headers["access-control-expose-headers"].lower()
    other = api.get("/v1/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in other.headers


def test_save_list_share(make_client):
    api, h, v1 = setup(make_client)
    rid = v1["candidates"][0]["route_id"]
    first = api.post(f"/v1/routes/{rid}/save", json={"name": "Coast run"}, headers=h)
    assert first.status_code == 201
    saved = first.json()
    again = api.post(f"/v1/routes/{rid}/save", json={"name": "Coast run, take 2"}, headers=h)
    assert again.status_code == 200 and again.json()["share_slug"] == saved["share_slug"]
    other_route = v1["candidates"][1]["route_id"]
    assert api.post(f"/v1/routes/{other_route}/save", headers=h).status_code == 201     # no body: no name

    mine = api.get("/v1/me/routes", headers=h).json()
    assert len(mine) == 2
    coast = next(m for m in mine if m["route_id"] == rid)
    assert coast["name"] == "Coast run, take 2" and coast["foot_m"] == v1["candidates"][0]["foot_m"]
    assert coast["plan_id"] == v1["plan_id"] and coast["version"] == 1 and coast["label"] == "recommended"

    shared = api.get(f"/v1/share/{saved['share_slug']}")                       # no token
    assert shared.status_code == 200
    body = shared.json()
    assert body["name"] == "Coast run, take 2" and "plan_id" not in body["route"]["properties"]
    assert body["route"]["properties"]["foot_m"] == v1["candidates"][0]["foot_m"]
    assert body["summary"].startswith("The recommended route is 25.0 km")
    assert saved["share_url"].endswith(f"/v1/share/{saved['share_slug']}")
    gpx = api.get(f"/v1/share/{saved['share_slug']}/gpx")
    XSD.assertValid(etree.fromstring(gpx.content))
    assert b"Coast run, take 2" in gpx.content


def test_routes_are_private_and_slugs_unguessable(make_client):
    api, _, v1 = setup(make_client)
    other = {"X-Client-Token": api.post("/v1/session").json()["token"]}
    rid = v1["candidates"][0]["route_id"]
    for path in (f"/v1/routes/{rid}", f"/v1/routes/{rid}/elevation", f"/v1/routes/{rid}/gpx"):
        assert api.get(path, headers=other).status_code == 404
    assert api.post(f"/v1/routes/{rid}/save", headers=other).status_code == 404
    assert api.get("/v1/me/routes", headers=other).json() == []
    assert api.get("/v1/share/not-a-slug").status_code == 404
    assert api.get(f"/v1/routes/{rid}").status_code == 401
