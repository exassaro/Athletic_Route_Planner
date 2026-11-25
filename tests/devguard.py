"""Tests never use development data: an app under test starts only on a test database and a test Redis db.

The root conftest puts these checks around what the app's lifespan calls, so a test that builds the app from
plain Settings() fails at startup instead of writing to the developer's database.
"""

from urllib.parse import urlsplit

TEST_DATABASES = frozenset({"athlete_test", "athlete_test_0005", "athlete_test_0006", "athlete_live"})
TEST_REDIS_DBS = frozenset({"14", "15"})


def check_database(url: str) -> str:
    name = urlsplit(url).path.lstrip("/")
    if name not in TEST_DATABASES:
        raise RuntimeError(f"tests may not use the database {name!r}: use one of {sorted(TEST_DATABASES)}")
    return url


def check_redis(url: str) -> str:
    db = urlsplit(url).path.lstrip("/") or "0"
    if db not in TEST_REDIS_DBS:
        raise RuntimeError(f"tests may not use Redis db {db}: use one of {sorted(TEST_REDIS_DBS)}")
    return url
