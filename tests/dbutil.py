"""A fresh, migrated Postgres database for tests (the API's Alembic migrations are what gets tested)."""

import psycopg
from alembic import command
from alembic.config import Config

from athlete_api.config import ROOT, Settings, sync_database_url


def admin_dsn() -> str:
    return sync_database_url(Settings().database_url).replace("postgresql+psycopg://", "postgresql://")


def fresh_database(name: str) -> str:
    """Drop and create database `name`, migrate it to head; return its app (asyncpg) URL."""
    with psycopg.connect(admin_dsn(), autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        conn.execute(f"CREATE DATABASE {name}")
    url = Settings().database_url.rsplit("/", 1)[0] + f"/{name}"
    cfg = Config(str(ROOT / "api" / "alembic.ini"))
    cfg.attributes["database_url"] = url
    command.upgrade(cfg, "head")
    return url
