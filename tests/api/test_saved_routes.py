"""Managing saved routes (Phase 5c): rename, re-point, delete, restore, purge, and what the share link shows."""

import uuid

import psycopg
import pytest

from athlete_api import purge_deleted
from athlete_api.deps import limited
from api_fixtures import FakeSolver, fixture_request
from dbutil import admin_dsn

A01 = fixture_request("A01")


@pytest.fixture
def api(make_client):
    return make_client(solver=FakeSolver())


def new_client(api) -> dict:
    return {"X-Client-Token": api.post("/v1/session").json()["token"]}


@pytest.fixture
def owner(api):
    h = new_client(api)
    v1 = api.post("/v1/plans", json={"request": A01}, headers=h).json()
    saved = api.post(f"/v1/routes/{v1['candidates'][0]['route_id']}/save", json={"name": "Coast"}, headers=h).json()
    return h, v1, saved


def url(saved) -> str:
    return f"/v1/me/routes/{saved['saved_id']}"


def listed(api, h) -> list[str]:
    return [r["saved_id"] for r in api.get("/v1/me/routes", headers=h).json()]


def test_delete_is_idempotent_hides_everywhere_and_restore_brings_back(api, owner):
    h, _, saved = owner
    share = f"/v1/share/{saved['share_slug']}"
    for _ in range(2):
        resp = api.delete(url(saved), headers=h)
        assert resp.status_code == 204 and resp.content == b""
    assert listed(api, h) == []
    unknown = api.get("/v1/share/no-such-slug")
    for path in (share, f"{share}/gpx", f"{share}/gpx?ele=false"):
        for headers in ({}, h):                       # the owner learns nothing more than a stranger
            gone = api.get(path, headers=headers)
            assert gone.status_code == 404 and gone.content == unknown.content
            assert gone.headers["cache-control"] == "no-store"

    back = api.post(f"{url(saved)}/restore", headers=h)
    assert back.status_code == 200 and back.json() == saved          # same slug, name and updated_at
    assert listed(api, h) == [saved["saved_id"]]
    assert api.get(share).status_code == 200 and api.get(f"{share}/gpx").status_code == 200
    assert api.post(f"{url(saved)}/restore", headers=h).status_code == 200


def test_another_client_always_gets_404(api, owner):
    h, v1, saved = owner
    other = new_client(api)
    missing = {"saved_id": str(uuid.uuid4())}
    calls = [("DELETE", "", None), ("POST", "/restore", None), ("PATCH", "", {"name": "Mine"}),
             ("PATCH", "", {"route_id": v1["candidates"][0]["route_id"]}), ("PATCH", "", {})]

    def all_404():
        for method, tail, body in calls:
            theirs = api.request(method, url(saved) + tail, json=body, headers=other)
            nobodys = api.request(method, url(missing) + tail, json=body, headers=other)
            assert theirs.status_code == nobodys.status_code == 404, (method, tail)
            assert theirs.json()["message"].replace(saved["saved_id"], "?") == nobodys.json()["message"].replace(
                missing["saved_id"], "?")

    all_404()
    assert listed(api, h) == [saved["saved_id"]]
    api.delete(url(saved), headers=h)
    all_404()                                         # and no different once deleted
    assert api.delete(url(saved)).status_code == 401


@pytest.mark.parametrize("sent, stored", [("  Morning coast  ", "Morning coast"), ("", None), ("   ", None),
                                          (None, None), ("x" * 80, "x" * 80), (f"  {'x' * 80}  ", "x" * 80),
                                          ("\U0001f45f" * 80, "\U0001f45f" * 80)])
def test_rename_trims_and_empty_is_null(api, owner, sent, stored):
    h, _, saved = owner
    resp = api.patch(url(saved), json={"name": sent}, headers=h)
    assert resp.status_code == 200 and resp.json()["name"] == stored
    assert resp.json()["updated_at"] > saved["updated_at"]


@pytest.mark.parametrize("body", [{"name": "x" * 81}, {"route_id": None}, {"route_id": "no-uuid"}, {"slug": "mine"}])
def test_bad_patches_are_422(api, owner, body):
    h, _, saved = owner
    assert api.patch(url(saved), json=body, headers=h).status_code == 422
    assert api.get("/v1/me/routes", headers=h).json()[0]["name"] == "Coast"


def test_patch_of_a_deleted_route_is_404(api, owner):
    h, _, saved = owner
    api.delete(url(saved), headers=h)
    assert api.patch(url(saved), json={"name": "Back"}, headers=h).status_code == 404


def test_an_empty_patch_changes_nothing(api, owner):
    h, _, saved = owner
    assert api.patch(url(saved), json={}, headers=h).json() == saved


def test_repoint_keeps_slug_name_and_created_at(api, owner):
    h, v1, saved = owner
    v2 = api.patch(f"/v1/plans/{v1['plan_id']}", headers=h,
                   json=[{"op": "replace", "path": "/target_distance_m", "value": 20000}]).json()
    new = v2["candidates"][0]
    resp = api.patch(url(saved), json={"route_id": new["route_id"]}, headers=h)
    assert resp.status_code == 200
    out = resp.json()
    assert out["route_id"] == new["route_id"]
    for key in ("saved_id", "share_slug", "share_url", "name", "created_at"):
        assert out[key] == saved[key], key
    assert out["updated_at"] > saved["updated_at"]

    shared = api.get(f"/v1/share/{saved['share_slug']}").json()
    assert shared["route"]["properties"]["foot_m"] == new["foot_m"] != v1["candidates"][0]["foot_m"]
    assert shared["updated_at"] == out["updated_at"]
    row = api.get("/v1/me/routes", headers=h).json()[0]
    assert (row["plan_id"], row["plan_version"], row["version"]) == (v1["plan_id"], 2, 2)
    assert row["foot_m"] == new["foot_m"] and row["updated_at"] == out["updated_at"]


def test_repoint_at_a_route_not_owned_is_404_and_changes_nothing(api, owner):
    h, _, saved = owner
    other = new_client(api)
    theirs = api.post("/v1/plans", json={"request": A01}, headers=other).json()["candidates"][0]["route_id"]
    for route_id in (theirs, str(uuid.uuid4())):
        assert api.patch(url(saved), json={"name": "Changed", "route_id": route_id}, headers=h).status_code == 404
    assert api.get("/v1/me/routes", headers=h).json()[0]["updated_at"] == saved["updated_at"]
    assert api.get("/v1/me/routes", headers=h).json()[0]["name"] == "Coast"


def test_list_is_newest_update_first_and_delete_does_not_reorder(api, owner):
    h, v1, first = owner
    second = api.post(f"/v1/routes/{v1['candidates'][1]['route_id']}/save", json={"name": "Two"}, headers=h).json()
    assert listed(api, h) == [second["saved_id"], first["saved_id"]]
    api.patch(url(first), json={"name": "One"}, headers=h)
    assert listed(api, h) == [first["saved_id"], second["saved_id"]]
    api.delete(url(second), headers=h)
    api.post(f"{url(second)}/restore", headers=h)
    assert listed(api, h) == [first["saved_id"], second["saved_id"]]


def test_save_renames_as_before_and_as_new_makes_another(api, owner):
    h, v1, saved = owner
    save = f"/v1/routes/{v1['candidates'][0]['route_id']}/save"
    again = api.post(save, json={"name": "Coast 2"}, headers=h)
    assert again.status_code == 200 and again.json()["saved_id"] == saved["saved_id"]
    new = api.post(save, json={"name": "Copy", "as_new": True}, headers=h)
    assert new.status_code == 201 and new.json()["share_slug"] != saved["share_slug"]
    assert len(listed(api, h)) == 2
    renamed = api.post(save, json={"name": "Copy 2"}, headers=h)          # two rows on one route: the newest
    assert renamed.status_code == 200 and renamed.json()["saved_id"] == new.json()["saved_id"]
    assert b"Copy 2" in api.get(save.replace("/save", "/gpx"), headers=h).content


def test_two_saved_routes_repointed_at_one_route_still_save(api, owner):
    h, v1, first = owner
    other_route = v1["candidates"][1]["route_id"]
    second = api.post(f"/v1/routes/{other_route}/save", json={"name": "Two"}, headers=h).json()
    api.patch(url(second), json={"route_id": first["route_id"]}, headers=h)
    resp = api.post(f"/v1/routes/{first['route_id']}/save", json={"name": "Renamed"}, headers=h)
    assert resp.status_code == 200 and resp.json()["saved_id"] == second["saved_id"]


def test_save_never_revives_a_deleted_row_or_its_slug(api, owner):
    h, v1, saved = owner
    api.delete(url(saved), headers=h)
    route_id = v1["candidates"][0]["route_id"]
    assert b"Coast</name>" not in api.get(f"/v1/routes/{route_id}/gpx", headers=h).content
    new = api.post(f"/v1/routes/{route_id}/save", json={"name": "Coast"}, headers=h)
    assert new.status_code == 201 and new.json()["share_slug"] != saved["share_slug"]
    assert api.get(f"/v1/share/{saved['share_slug']}").status_code == 404


def test_is_owner_only_for_the_owners_token(api, owner):
    h, _, saved = owner
    share = f"/v1/share/{saved['share_slug']}"
    for headers, expected in (({}, False), (h, True), (new_client(api), False), ({"X-Client-Token": "junk"}, False),
                              ({"X-Client-Token": ""}, False)):
        resp = api.get(share, headers=headers)
        assert resp.status_code == 200 and resp.json()["is_owner"] is expected
        assert resp.headers["cache-control"] == "no-store"
        assert "plan_id" not in resp.json()["route"]["properties"]


def test_writes_have_their_own_limit(make_client):
    api = make_client(solver=FakeSolver(), rate_write_per_client_min=2)
    h, other = new_client(api), new_client(api)
    missing = f"/v1/me/routes/{uuid.uuid4()}"
    assert [api.delete(missing, headers=h).status_code for _ in range(3)] == [404, 404, 429]
    assert api.delete(missing, headers=other).status_code == 404            # per client, not per IP
    assert api.get("/v1/me/routes", headers=h).status_code == 200           # reads are not counted


def test_an_unknown_bucket_is_refused():
    with pytest.raises(ValueError):
        limited("wrte")


def test_cors_allows_delete_and_patch(api):
    for method in ("DELETE", "PATCH"):
        resp = api.options("/v1/me/routes/x", headers={"Origin": "http://localhost:3000",
                                                       "Access-Control-Request-Method": method,
                                                       "Access-Control-Request-Headers": "x-client-token"})
        assert resp.status_code == 200, method


def test_patch_from_an_older_version(api, owner):
    h, v1, _ = owner
    plan = f"/v1/plans/{v1['plan_id']}"
    assert v1["request"]["checkpoints"]
    api.patch(plan, json=[{"op": "replace", "path": "/checkpoints", "value": []}], headers=h)
    distance = [{"op": "replace", "path": "/target_distance_m", "value": 20000}]

    v3 = api.patch(f"{plan}?from_version=1", json=distance, headers=h).json()
    assert v3["version"] == 3
    assert v3["request"] == {**v1["request"], "target_distance_m": 20000}       # v1's six stops, not v2's none
    assert v3["diff"]["from_version"] == 1 and v3["diff"]["changed"] == ["/target_distance_m"]
    assert v3["diff"]["stops_added"] == v3["diff"]["stops_removed"] == []
    assert api.get(f"{plan}/versions/3", headers=h).json()["diff"] == v3["diff"]

    assert api.patch(f"{plan}?from_version=9", json=distance, headers=h).status_code == 404
    assert api.patch(f"{plan}?from_version=0", json=distance, headers=h).status_code == 422
    assert api.patch(f"{plan}?from_version=1", json=distance, headers=new_client(api)).status_code == 404
    stale = api.patch(f"{plan}?from_version=1", json=distance, headers={**h, "If-Match": '"v1"'})
    assert stale.status_code == 412                   # If-Match still means "the latest is"


def test_purge_removes_only_rows_deleted_more_than_n_days_ago(api, owner, database_url, capsys):
    h, v1, _ = owner
    route_id = v1["candidates"][0]["route_id"]
    rows = {days: api.post(f"/v1/routes/{route_id}/save", json={"name": f"{days}", "as_new": True}, headers=h).json()
            for days in (None, 1, 29, 31, 90)}
    dsn = admin_dsn().rsplit("/", 1)[0] + "/" + database_url.rsplit("/", 1)[1]
    with psycopg.connect(dsn, autocommit=True) as db:
        db.execute("DELETE FROM saved_routes WHERE deleted_at < now() - interval '2 days'")   # other tests' leftovers
        for days, row in rows.items():
            if days is not None:
                db.execute("UPDATE saved_routes SET deleted_at = now() - make_interval(days => %s) WHERE id = %s",
                           (days, row["saved_id"]))

    assert purge_deleted.main(["--days", "30"], database_url=database_url) == 0
    assert "Purged 2 saved routes deleted more than 30 days ago." in capsys.readouterr().out

    with psycopg.connect(dsn) as db:
        left = {str(r[0]) for r in db.execute("SELECT id FROM saved_routes")}
        assert db.execute("SELECT count(*) FROM routes WHERE id = %s", (route_id,)).fetchone()[0] == 1
    assert [rows[d]["saved_id"] in left for d in (None, 1, 29, 31, 90)] == [True, True, True, False, False]
    assert api.post(f"{url(rows[31])}/restore", headers=h).status_code == 404
    assert api.delete(url(rows[31]), headers=h).status_code == 404
    assert api.post(f"{url(rows[29])}/restore", headers=h).status_code == 200


def test_purge_refuses_negative_days(database_url):
    with pytest.raises(SystemExit):
        purge_deleted.main(["--days", "-1"], database_url=database_url)
