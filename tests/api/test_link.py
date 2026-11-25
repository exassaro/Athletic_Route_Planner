"""Step 9, "Use on another device": POST /v1/session/link and /v1/session/claim, and tokens from client_tokens."""

import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest
import redis

from athlete_api.config import sync_database_url
from api_fixtures import FakeSolver, fixture_request
from conftest import TEST_REDIS

A01 = fixture_request("A01")


@pytest.fixture
def api(make_client):
    return make_client(solver=FakeSolver())


def session(api) -> tuple[dict, str]:
    body = api.post("/v1/session").json()
    return {"X-Client-Token": body["token"]}, body["client_id"]


def code_for(api, h) -> str:
    resp = api.post("/v1/session/link", headers=h)
    assert resp.status_code == 201, resp.text
    return resp.json()["code"]


def saved_ids(api, h) -> list[str]:
    resp = api.get("/v1/me/routes", headers=h)
    assert resp.status_code == 200, resp.text
    return [r["saved_id"] for r in resp.json()]


def test_link_then_claim_gives_a_second_token_for_the_same_client(api, database_url):
    a, client_id = session(api)
    v1 = api.post("/v1/plans", json={"request": A01}, headers=a).json()
    saved = api.post(f"/v1/routes/{v1['candidates'][0]['route_id']}/save", json={"name": "Coast"}, headers=a).json()

    link = api.post("/v1/session/link", headers=a)
    assert link.status_code == 201
    body = link.json()
    assert set(body) == {"code", "expires_in_s"} and body["expires_in_s"] == 300
    assert len(body["code"]) >= 22                       # >= 128 bits in URL-safe base64 (this is 192)
    assert a["X-Client-Token"] not in link.text          # never the token

    claimed = api.post("/v1/session/claim", json={"code": body["code"]})
    assert claimed.status_code == 201
    out = claimed.json()
    assert out["client_id"] == client_id and out["token"] != a["X-Client-Token"]
    b = {"X-Client-Token": out["token"]}

    # B sees A's saved route and can use it; A's own token still works.
    assert saved_ids(api, b) == [saved["saved_id"]] == saved_ids(api, a)
    assert api.patch(f"/v1/me/routes/{saved['saved_id']}", json={"name": "From B"}, headers=b).status_code == 200
    assert api.get("/v1/me/routes", headers=a).json()[0]["name"] == "From B"
    # Share links and GPX are what they were.
    assert api.get(f"/v1/share/{saved['share_slug']}").status_code == 200
    assert api.get(f"/v1/routes/{saved['route_id']}/gpx", headers=b).status_code == 200

    # Only hashes are stored: the new token in client_tokens, the first one still in clients.
    dsn = sync_database_url(database_url).replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(dsn) as conn:
        rows = conn.execute("SELECT token_hash, label FROM client_tokens WHERE client_id = %s", (client_id,)).fetchall()
        first = conn.execute("SELECT token_hash FROM clients WHERE id = %s", (client_id,)).fetchone()[0]
    assert [(bytes(h), label) for h, label in rows] == [(hashlib.sha256(out["token"].encode()).digest(), "linked")]
    assert bytes(first) == hashlib.sha256(a["X-Client-Token"].encode()).digest()


def test_link_needs_a_token(api):
    for headers in ({}, {"X-Client-Token": "not-a-token"}):
        resp = api.post("/v1/session/link", headers=headers)
        assert resp.status_code == 401 and resp.json()["error"] == "client_required"


def test_a_code_works_once_and_bad_codes_all_look_the_same(api):
    a, _ = session(api)
    code = code_for(api, a)
    assert api.post("/v1/session/claim", json={"code": code}).status_code == 201
    used = api.post("/v1/session/claim", json={"code": code})
    unknown = api.post("/v1/session/claim", json={"code": "x" * 32})
    assert used.status_code == unknown.status_code == 404
    assert used.json() == unknown.json() and used.json()["error"] == "link_invalid"


def test_expired_code_is_the_same_404(api):
    a, client_id = session(api)
    code = code_for(api, a)
    r = redis.Redis.from_url(TEST_REDIS)
    key = "link:" + hashlib.sha256(code.encode()).hexdigest()
    assert 0 < r.ttl(key) <= 300                          # the code's hash only, with its expiry
    assert r.get(key).decode() == client_id
    assert not any(code.encode() in k for k in r.keys("*"))
    r.delete(key)                                         # what expiry does
    resp = api.post("/v1/session/claim", json={"code": code})
    assert resp.status_code == 404 and resp.json()["error"] == "link_invalid"


def test_ttl_is_a_setting(make_client):
    api = make_client(link_ttl_s=60)
    a, _ = session(api)
    assert api.post("/v1/session/link", headers=a).json()["expires_in_s"] == 60


def test_simultaneous_claims_only_one_wins(api):
    a, client_id = session(api)
    code = code_for(api, a)
    with ThreadPoolExecutor(max_workers=8) as pool:
        answers = list(pool.map(lambda _: api.post("/v1/session/claim", json={"code": code}), range(8)))
    statuses = sorted(r.status_code for r in answers)
    assert statuses == [201] + [404] * 7
    assert next(r for r in answers if r.status_code == 201).json()["client_id"] == client_id


def test_link_is_limited_per_client(make_client):
    api = make_client(rate_link_per_client_hour=2)
    a, _ = session(api)
    b, _ = session(api)
    assert [api.post("/v1/session/link", headers=a).status_code for _ in range(3)] == [201, 201, 429]
    assert api.post("/v1/session/link", headers=b).status_code == 201       # another client has its own
    over = api.post("/v1/session/link", headers=a)
    assert over.json()["detail"]["bucket"] == "link" and int(over.headers["Retry-After"]) > 0


def test_claim_is_limited_per_ip_and_wrong_codes_count(make_client):
    api = make_client(rate_claim_per_ip_min=3)
    a, _ = session(api)
    code = code_for(api, a)
    wrong = [api.post("/v1/session/claim", json={"code": f"guess-{k}"}).status_code for k in range(3)]
    assert wrong == [404, 404, 404]
    blocked = api.post("/v1/session/claim", json={"code": code})          # right code, but the IP is out
    assert blocked.status_code == 429 and blocked.json()["detail"]["bucket"] == "claim"
    # The code was not used up by the refused attempt.
    assert redis.Redis.from_url(TEST_REDIS).exists("link:" + hashlib.sha256(code.encode()).hexdigest())


def test_a_linked_token_of_a_deleted_client_is_rejected(api, database_url):
    a, client_id = session(api)
    b = {"X-Client-Token": api.post("/v1/session/claim", json={"code": code_for(api, a)}).json()["token"]}
    dsn = sync_database_url(database_url).replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM clients WHERE id = %s", (client_id,))   # client_tokens rows go with it (cascade)
        assert conn.execute("SELECT count(*) FROM client_tokens WHERE client_id = %s", (client_id,)).fetchone()[0] == 0
    assert api.get("/v1/me/routes", headers=b).status_code == 401


def test_a_code_whose_client_is_gone_is_link_invalid(api, database_url):
    a, client_id = session(api)
    code = code_for(api, a)
    dsn = sync_database_url(database_url).replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM clients WHERE id = %s", (client_id,))
    assert api.post("/v1/session/claim", json={"code": code}).json()["error"] == "link_invalid"


def test_no_token_or_code_is_logged(api, caplog):
    caplog.set_level(logging.DEBUG)
    a, _ = session(api)
    code = code_for(api, a)
    token = api.post("/v1/session/claim", json={"code": code}).json()["token"]
    api.get("/v1/me/routes", headers={"X-Client-Token": token})
    text = "\n".join(r.getMessage() for r in caplog.records)
    for secret in (a["X-Client-Token"], code, token):
        assert secret not in text


def test_claim_validates_the_body(api):
    for body in ({}, {"code": ""}, {"code": "x" * 201}):
        resp = api.post("/v1/session/claim", json=body)
        assert resp.status_code == 422 and resp.json()["error"] == "invalid_request"
