"""Migration 0005 (Phase 5c amendment 5): the backfill, and a downgrade that never republishes a deleted link."""

import uuid

import psycopg
import pytest
from alembic import command
from alembic.config import Config

from athlete_api.config import ROOT
from dbutil import admin_dsn, fresh_database

DB = "athlete_test_0005"


@pytest.fixture
def migrated():
    url = fresh_database(DB)
    cfg = Config(str(ROOT / "api" / "alembic.ini"))
    cfg.attributes["database_url"] = url
    command.downgrade(cfg, "0004")
    with psycopg.connect(admin_dsn().rsplit("/", 1)[0] + f"/{DB}", autocommit=True) as db:
        yield cfg, db
    with psycopg.connect(admin_dsn(), autocommit=True) as admin:
        admin.execute(f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)")


def two_saved_routes(db) -> list[uuid.UUID]:
    client, plan, version, route = (uuid.uuid4() for _ in range(4))
    db.execute("INSERT INTO clients (id, token_hash) VALUES (%s, %s)", (client, client.bytes))
    db.execute("INSERT INTO plans (id, client_id) VALUES (%s, %s)", (plan, client))
    db.execute("""INSERT INTO plan_versions (id, plan_id, version_no, request, source, outcome, facts, flags, explanation,
                      graph_build, valhalla_build, solver_hash, cache_key, from_cache)
                  VALUES (%s, %s, 1, '{}', 'form', 'ok', '{}', '[]', '', 'test', 'test', 'test', 'test', false)""",
               (version, plan))
    db.execute("""INSERT INTO routes (id, plan_version_id, seq, label, option, engine, geom, length_m, foot_m, ferry_m,
                      engine_length_m, sphere_length_m, edge_count, deviation_m, end_point, stops, road_class_m, flags)
                  VALUES (%s, %s, 0, 'recommended', 'main', 'test', 'SRID=4326;LINESTRINGZ(0 0 0, 0 0.001 0)'::geography,
                      1, 1, 0, 1, 1, 1, 0, '{}', '[]', '{}', '[]')""", (route, version))
    ids = [uuid.uuid4(), uuid.uuid4()]
    for k, sid in enumerate(ids):
        db.execute("""INSERT INTO saved_routes (id, client_id, route_id, share_slug, created_at)
                      VALUES (%s, %s, %s, %s, now() - %s * interval '1 day')""", (sid, client, route, sid.hex, k + 3))
    return ids


def test_upgrade_backfills_and_downgrade_drops_deleted_rows(migrated):
    cfg, db = migrated
    kept, deleted = two_saved_routes(db)

    command.upgrade(cfg, "0005")
    rows = db.execute("SELECT created_at, updated_at, deleted_at FROM saved_routes").fetchall()
    assert len(rows) == 2 and all(updated == created and gone is None for created, updated, gone in rows)
    assert db.execute("""SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_saved_routes_client_id_deleted_at'"""
                      ).fetchone()[0].endswith("(client_id, deleted_at)")

    db.execute("UPDATE saved_routes SET deleted_at = now() WHERE id = %s", (deleted,))
    command.downgrade(cfg, "0004")
    assert db.execute("SELECT id FROM saved_routes").fetchall() == [(kept,)]
    assert db.execute("SELECT count(*) FROM routes").fetchone()[0] == 1          # routes are never deleted
    columns = {r[0] for r in db.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'saved_routes'")}
    assert not columns & {"deleted_at", "updated_at"}

    command.upgrade(cfg, "0005")                                                 # and up again
    assert db.execute("SELECT count(*) FROM saved_routes WHERE deleted_at IS NULL").fetchone()[0] == 1
