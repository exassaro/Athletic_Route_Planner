"""API settings, from the environment (prefix ATHLETE_) or a .env file.

The engine URLs use the same variables as the solver (VALHALLA_URL, GRAPHHOPPER_URL),
so the API and the solver it runs always talk to the same engines.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ATHLETE_", env_file=".env", extra="ignore")

    # asyncpg for the app; Alembic swaps in psycopg (sync) with sync_database_url().
    database_url: str = "postgresql+asyncpg://athlete:athlete@localhost:5433/athlete"
    redis_url: str = "redis://localhost:6379/0"
    valhalla_url: str = Field("http://localhost:8002", validation_alias=AliasChoices("VALHALLA_URL", "ATHLETE_VALHALLA_URL"))
    graphhopper_url: str = Field("http://127.0.0.1:8989",
                                 validation_alias=AliasChoices("GRAPHHOPPER_URL", "ATHLETE_GRAPHHOPPER_URL"))
    photon_url: str = "http://localhost:2322"
    manifest_path: Path = ROOT / "data" / "manifest.json"   # the pinned OSM extract (graph_build)

    # Phase 4 amendments 3, 12, 13: solve slots, queue wait, solve budget.
    solve_slots: int = Field(2, ge=1)
    slot_wait_s: float = Field(10.0, gt=0)
    solve_budget_s: float = Field(15.0, gt=0)

    cache_ttl_s: int = 24 * 3600   # amendment 5

    # Amendment 22: rate limits (fixed windows).
    rate_solve_per_client_min: int = 20
    rate_solve_per_ip_min: int = 40
    rate_read_per_client_min: int = 300
    rate_session_per_ip_hour: int = 10
    trust_forwarded_for: bool = False   # take the client IP from X-Forwarded-For (behind a proxy only)

    health_timeout_s: float = 3.0


def sync_database_url(url: str) -> str:
    """The same database through psycopg (synchronous), for Alembic and test setup."""
    return url.replace("+asyncpg", "+psycopg", 1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
