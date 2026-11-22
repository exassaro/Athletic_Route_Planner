"""Remove saved routes soft-deleted more than N days ago (blueprint Phase 5c amendment 1). No scheduler runs it.

    uv run python -m athlete_api.purge_deleted --days 30
    docker compose exec api python -m athlete_api.purge_deleted --days 30

Only saved_routes rows go. Their routes and plan versions stay: other saves or the plan's history may use them.
A purged saved route cannot be restored. The database is ATHLETE_DATABASE_URL, as for the API.
"""

import argparse

from sqlalchemy import create_engine, delete, func, pool

from .config import get_settings, sync_database_url
from .db import SavedRoute

DEFAULT_DAYS = 30


def purge(database_url: str, days: int) -> int:
    """Deletes the rows; returns how many."""
    engine = create_engine(sync_database_url(database_url), poolclass=pool.NullPool)
    try:
        with engine.begin() as db:
            cutoff = func.now() - func.make_interval(0, 0, 0, days)
            return db.execute(delete(SavedRoute).where(SavedRoute.deleted_at < cutoff)).rowcount
    finally:
        engine.dispose()


def non_negative(text: str) -> int:
    value = int(text)
    if value < 0:
        raise argparse.ArgumentTypeError("must be 0 or more")
    return value


def main(argv: list[str] | None = None, database_url: str | None = None) -> int:
    parser = argparse.ArgumentParser(description="Remove saved routes soft-deleted more than --days days ago.")
    parser.add_argument("--days", type=non_negative, default=DEFAULT_DAYS, help=f"default {DEFAULT_DAYS}")
    args = parser.parse_args(argv)
    count = purge(database_url or get_settings().database_url, args.days)
    print(f"Purged {count} saved route{'' if count == 1 else 's'} deleted more than {args.days} days ago.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
