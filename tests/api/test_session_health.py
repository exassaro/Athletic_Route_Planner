"""POST /v1/session, the client token check, rate limits and /v1/health (Phase 4 step 3)."""

import hashlib

import psycopg
from fastapi import Depends

from athlete_api.config import sync_database_url
from athlete_api.db import Client
from athlete_api.deps import current_client, limited


def _probe(app):
    """Test-only routes that exercise the dependencies the real endpoints will use."""

    @app.get("/probe/me")
    async def me(client: Client = Depends(current_client)):
        return {"client_id": str(client.id)}

    @app.get("/probe/read")
    async def read(client: Client = Depends(limited("read"))):
        return {"ok": True}

    @app.get("/probe/solve")
    async def solve(client: Client = Depends(limited("solve"))):
        return {"ok": True}


def test_session_issues_a_token_that_identifies_the_client(make_client, database_url):
    api = make_client(_probe)
    resp = api.post("/v1/session")
    assert resp.status_code == 201
    body = resp.json()
    assert body["header"] == "X-Client-Token" and len(body["token"]) >= 40
    me = api.get("/probe/me", headers={"X-Client-Token": body["token"]})
    assert me.status_code == 200 and me.json()["client_id"] == body["client_id"]
    # Only the hash is stored.
    dsn = sync_database_url(database_url).replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(dsn) as conn:
        stored, seen = conn.execute("SELECT token_hash, last_seen_at FROM clients WHERE id = %s",
                                    (body["client_id"],)).fetchone()
    assert bytes(stored) == hashlib.sha256(body["token"].encode()).digest()
    assert seen is not None


def test_missing_or_unknown_token_is_401(make_client):
    api = make_client(_probe)
    for headers in ({}, {"X-Client-Token": "not-a-token"}):
        resp = api.get("/probe/me", headers=headers)
        assert resp.status_code == 401
        assert resp.json()["error"] == "client_required"


def test_session_creation_is_limited_per_ip(make_client):
    api = make_client(rate_session_per_ip_hour=2)
    assert [api.post("/v1/session").status_code for _ in range(2)] == [201, 201]
    resp = api.post("/v1/session")
    assert resp.status_code == 429
    assert resp.json()["error"] == "rate_limited" and int(resp.headers["Retry-After"]) > 0


def test_solve_limit_per_client_and_per_ip(make_client):
    api = make_client(_probe, rate_solve_per_client_min=2, rate_solve_per_ip_min=3)
    a = {"X-Client-Token": api.post("/v1/session").json()["token"]}
    b = {"X-Client-Token": api.post("/v1/session").json()["token"]}
    assert [api.get("/probe/solve", headers=a).status_code for _ in range(3)] == [200, 200, 429]
    # a's third was refused by its client limit before the IP was counted, so the shared IP has used 2 of 3.
    # Client b has its own allowance: its first request takes the IP's last one, its second hits the IP limit.
    assert api.get("/probe/solve", headers=b).status_code == 200
    second_b = api.get("/probe/solve", headers=b)
    assert second_b.status_code == 429 and second_b.json()["detail"]["scope"] == "ip"


def test_read_limit_is_separate_from_solve(make_client):
    api = make_client(_probe, rate_read_per_client_min=1, rate_solve_per_client_min=5)
    h = {"X-Client-Token": api.post("/v1/session").json()["token"]}
    assert api.get("/probe/read", headers=h).status_code == 200
    assert api.get("/probe/read", headers=h).status_code == 429
    assert api.get("/probe/solve", headers=h).status_code == 200


def test_health_without_engines_is_503_and_names_what_is_down(make_client):
    resp = make_client().get("/v1/health")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "down"
    assert not body["services"]["valhalla"]["ok"] and body["services"]["valhalla"]["detail"]
    assert body["services"]["postgres"]["ok"] and "postgis" in body["services"]["postgres"]["build"]
    assert body["services"]["redis"]["ok"]
    assert body["builds"]["valhalla"] is None and body["builds"]["graphhopper"] is None
    assert len(body["builds"]["solver"]) == 16


def test_errors_have_one_shape(make_client):
    resp = make_client().get("/v1/nowhere")
    assert resp.status_code == 404
    assert set(resp.json()) == {"error", "message", "detail"} and resp.json()["error"] == "not_found"
