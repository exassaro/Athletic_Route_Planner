"""Alembic environment: runs migrations synchronously with psycopg, on the API's database URL."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from athlete_api.config import get_settings, sync_database_url
from athlete_api.db import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

URL = sync_database_url(config.attributes.get("database_url") or get_settings().database_url)


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    """Compare only the API's own tables: the postgis image also installs the TIGER geocoder and topology."""
    if type_ == "table":
        return name in Base.metadata.tables
    table = getattr(obj, "table", None)
    return table is None or table.name in Base.metadata.tables


def run_migrations_offline() -> None:
    context.configure(url=URL, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(URL, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
