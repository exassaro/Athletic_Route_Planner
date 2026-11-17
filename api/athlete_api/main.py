"""The FastAPI app (Phase 4).

Run:  uv run uvicorn athlete_api.main:app --port 8000      (one worker: Phase 4 amendment 20)
Docs: http://localhost:8000/docs
"""

from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from redis.asyncio import Redis

from . import errors, routes_health, routes_session
from .config import Settings, get_settings
from .db import make_engine, make_sessionmaker
from .deps import Services

DESCRIPTION = """Distance-budgeted running routes in Kerala.

Requests and results are the solver's own models (blueprint Phase 4 amendment 1). Every length is measured
from route geometry on the WGS84 ellipsoid by the solver; the API stores and returns those values unchanged.
Send the token from `POST /v1/session` in the `X-Client-Token` header.
"""


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db_engine = make_engine(settings.database_url)
        redis = Redis.from_url(settings.redis_url, decode_responses=False)
        http = httpx.AsyncClient(timeout=settings.health_timeout_s)
        app.state.services = Services(settings=settings, db_engine=db_engine,
                                      sessions=make_sessionmaker(db_engine), redis=redis, http=http)
        try:
            yield
        finally:
            await http.aclose()
            await redis.aclose()
            await db_engine.dispose()

    app = FastAPI(title="Athlete Router API", version="0.4.0", description=DESCRIPTION, lifespan=lifespan)
    errors.install(app)
    app.include_router(routes_session.router)
    app.include_router(routes_health.router)
    return app


app = create_app()
