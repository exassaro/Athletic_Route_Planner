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
    busy_retry_after_s: int = Field(5, ge=1)   # Retry-After on 429 solver_busy

    cache_ttl_s: int = 24 * 3600   # amendment 5
    cache_enabled: bool = True     # off only for tests and diagnosis (fresh solves, nothing read or written)

    # Amendment 22: rate limits (fixed windows).
    rate_solve_per_client_min: int = 20
    rate_solve_per_ip_min: int = 40
    rate_read_per_client_min: int = 300
    rate_write_per_client_min: int = 60   # Phase 5c amendment 10; none per IP (behind the proxy all share one)
    rate_session_per_ip_hour: int = 10
    # Step 9: "Use on another device". A link code lives this long in Redis; link is counted per client, claim
    # per IP (every attempt, wrong codes included).
    link_ttl_s: int = Field(300, ge=30)
    rate_link_per_client_hour: int = 10
    rate_claim_per_ip_min: int = 10
    trust_forwarded_for: bool = False   # take the client IP from X-Forwarded-For (behind a proxy only)

    health_timeout_s: float = 3.0

    # Phase 5 A1: browser origins allowed to call the API (comma-separated). In production the web app, the
    # API and the tiles share one origin behind Caddy, so this matters for development (next dev on :3000).
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]


def sync_database_url(url: str) -> str:
    """The same database through psycopg (synchronous), for Alembic and test setup."""
    return url.replace("+asyncpg", "+psycopg", 1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
