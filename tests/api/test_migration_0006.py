"""Migration 0006 (Step 9): client_tokens is added beside clients.token_hash, which keeps working unchanged."""

import uuid

import psycopg
import pytest
from alembic import command
from alembic.config import Config

from athlete_api.config import ROOT
from dbutil import admin_dsn, fresh_database

DB = "athlete_test_0006"


@pytest.fixture
def migrated():
    url = fresh_database(DB)
    cfg = Config(str(ROOT / "api" / "alembic.ini"))
    cfg.attributes["database_url"] = url
    command.downgrade(cfg, "0005")
    with psycopg.connect(admin_dsn().rsplit("/", 1)[0] + f"/{DB}", autocommit=True) as db:
        yield cfg, db
    with psycopg.connect(admin_dsn(), autocommit=True) as admin:
        admin.execute(f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)")


def tables(db) -> set[str]:
    return {r[0] for r in db.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'").fetchall()}


def test_upgrade_adds_client_tokens_without_touching_clients_and_downgrade_drops_it(migrated):
    cfg, db = migrated
    assert "client_tokens" not in tables(db)
    old = uuid.uuid4()
    db.execute("INSERT INTO clients (id, token_hash) VALUES (%s, %s)", (old, b"first-device-hash"))
    before = db.execute("SELECT id, token_hash, created_at, last_seen_at FROM clients").fetchall()

    command.upgrade(cfg, "0006")
    assert "client_tokens" in tables(db)
    assert db.execute("SELECT id, token_hash, created_at, last_seen_at FROM clients").fetchall() == before
    db.execute("INSERT INTO client_tokens (token_hash, client_id) VALUES (%s, %s)", (b"second-device-hash", old))
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        db.execute("INSERT INTO client_tokens (token_hash, client_id) VALUES (%s, %s)", (b"orphan", uuid.uuid4()))
    with pytest.raises(psycopg.errors.UniqueViolation):
        db.execute("INSERT INTO client_tokens (token_hash, client_id) VALUES (%s, %s)", (b"second-device-hash", old))

    command.downgrade(cfg, "0005")
    assert "client_tokens" not in tables(db)
    assert db.execute("SELECT id, token_hash, created_at, last_seen_at FROM clients").fetchall() == before
    command.upgrade(cfg, "head")                         # and up again
    assert "client_tokens" in tables(db)
