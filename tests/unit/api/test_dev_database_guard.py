"""An app started by a test never reaches the development database or Redis db 0 (tests/devguard.py)."""

import pytest
from fastapi.testclient import TestClient

from athlete_api.config import Settings
from athlete_api.main import create_app

DEV_DB = "postgresql+asyncpg://athlete:athlete@localhost:5433/athlete"
TEST_DB = "postgresql+asyncpg://athlete:athlete@localhost:5433/athlete_test"


@pytest.mark.parametrize("database_url, redis_url, refused", [
    (DEV_DB, "redis://localhost:6379/15", "database"),
    (TEST_DB, "redis://localhost:6379/0", "Redis"),
    (TEST_DB, "redis://localhost:6379", "Redis"),
])
def test_an_app_on_development_data_does_not_start(database_url, redis_url, refused):
    # Starting opens no connection, so this writes nothing even where the guard is missing.
    app = create_app(Settings(database_url=database_url, redis_url=redis_url))
    with pytest.raises(RuntimeError, match=refused):
        with TestClient(app):
            pass
