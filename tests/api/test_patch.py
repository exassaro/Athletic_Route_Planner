"""PATCH /v1/plans/{id}: JSON Patch edits, versions, the diff, undo (Phase 4 step 6).

The fake solver returns the solver's real A02 result for a 20 km request and A01's otherwise.
"""

from api_fixtures import FakeSolver, fixture_request

A01 = fixture_request("A01")
PATCH = {"Content-Type": "application/json-patch+json"}


def setup(make_client):
    fake = FakeSolver()
    api = make_client(solver=fake)
    h = {"X-Client-Token": api.post("/v1/session").json()["token"]}
    v1 = api.post("/v1/plans", json={"request": A01}, headers=h).json()
    return api, fake, h, v1


def patch(api, h, plan_id, ops, **headers):
    import json
    return api.patch(f"/v1/plans/{plan_id}", content=json.dumps(ops), headers={**h, **PATCH, **headers})


def strip(cands):
    return [{k: v for k, v in c.items() if k != "route_id"} for c in cands]


def test_distance_down_then_back_then_undo(make_client):
    api, fake, h, v1 = setup(make_client)
    pid = v1["plan_id"]
    assert v1["explanation"].startswith("Stops in order:")

    v2 = patch(api, h, pid, [{"op": "replace", "path": "/target_distance_m", "value": 20000}])
    assert v2.status_code == 200, v2.json()
    v2 = v2.json()
    assert v2["version"] == 2 and v2["outcome"] == "over_budget"
    assert v2["conflict"]["kind"] == "checkpoints_exceed_distance" and v2["conflict"]["savings"]
    assert {c["option"] for c in v2["candidates"]} == {"full_route", "cut_at_target"}
    d = v2["diff"]
    assert d["from_version"] == 1 and d["changed"] == ["/target_distance_m"]
    assert d["outcome"] == {"from": "ok", "to": "over_budget"} and d["end_changed"] is True
    assert d["length_delta_m"] is not None and d["duration_delta_s"] is not None
    assert "Dropping Kottakkadavu does not shorten the run." in v2["explanation"]

    v3 = patch(api, h, pid, [{"op": "replace", "path": "/target_distance_m", "value": 25000}]).json()
    assert v3["version"] == 3 and v3["cached"] is True and fake.calls == 2
    assert strip(v3["candidates"]) == strip(v1["candidates"]) and v3["outcome"] == v1["outcome"]
    assert v3["diff"]["length_delta_m"] == -d["length_delta_m"]

    undo = patch(api, h, pid, [{"op": "replace", "path": "", "value": v2["request"]}]).json()
    assert undo["version"] == 4 and undo["request"] == v2["request"] and undo["outcome"] == "over_budget"
    assert strip(undo["candidates"]) == strip(v2["candidates"])

    plan = api.get(f"/v1/plans/{pid}", headers=h).json()
    assert plan["versions"] == [1, 2, 3, 4] and plan["latest"]["version"] == 4
    assert api.get(f"/v1/plans/{pid}/versions/2", headers=h).json() == v2


def test_removing_a_checkpoint_is_reported(make_client):
    api, _, h, v1 = setup(make_client)
    out = patch(api, h, v1["plan_id"], [{"op": "remove", "path": "/checkpoints/5"}]).json()
    assert [s["label"] for s in out["diff"]["stops_removed"]] == ["Kallai"]
    assert out["diff"]["changed"] == ["/checkpoints"]


def test_plain_json_content_type_is_accepted(make_client):
    api, _, h, v1 = setup(make_client)
    resp = api.patch(f"/v1/plans/{v1['plan_id']}", json=[{"op": "replace", "path": "/tolerance_m", "value": 400}],
                     headers=h)
    assert resp.status_code == 200 and resp.json()["diff"]["changed"] == ["/tolerance_m"]


def test_patch_errors(make_client):
    api, fake, h, v1 = setup(make_client)
    pid = v1["plan_id"]
    calls = fake.calls

    failed = patch(api, h, pid, [{"op": "test", "path": "/target_distance_m", "value": 1}])
    assert failed.status_code == 409 and failed.json()["error"] == "patch_test_failed"

    for ops in ([{"op": "replace", "path": "/nowhere/deep", "value": 1}], [{"op": "jump", "path": "/x"}],
                [{"path": "/x"}]):
        bad = patch(api, h, pid, ops)
        assert bad.status_code == 422 and bad.json()["error"] == "invalid_patch", (ops, bad.json())

    invalid = patch(api, h, pid, [{"op": "replace", "path": "/target_distance_m", "value": -1}])
    assert invalid.status_code == 422 and invalid.json()["error"] == "invalid_request"
    assert invalid.json()["detail"][0]["loc"][-1] == "target_distance_m"

    unknown = patch(api, h, pid, [{"op": "add", "path": "/pace", "value": 300}])
    assert unknown.status_code == 422 and unknown.json()["error"] == "invalid_request"
    assert fake.calls == calls                      # nothing was solved

    stale = patch(api, h, pid, [{"op": "replace", "path": "/tolerance_m", "value": 400}], **{"If-Match": '"v0"'})
    assert stale.status_code == 412 and stale.json()["detail"]["latest"] == 1
    fresh = patch(api, h, pid, [{"op": "replace", "path": "/tolerance_m", "value": 400}], **{"If-Match": '"v1"'})
    assert fresh.status_code == 200 and fresh.json()["version"] == 2


def test_patch_needs_the_owner(make_client):
    api, _, _, v1 = setup(make_client)
    other = {"X-Client-Token": api.post("/v1/session").json()["token"]}
    resp = patch(api, other, v1["plan_id"], [{"op": "replace", "path": "/tolerance_m", "value": 400}])
    assert resp.status_code == 404
