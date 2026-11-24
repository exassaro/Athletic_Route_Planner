"""The FastAPI app (Phase 4).

Run:  uv run uvicorn athlete_api.main:app --port 8000      (one worker: Phase 4 amendment 20)
Docs: http://localhost:8000/docs
"""

from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from . import (errors, routes_features, routes_health, routes_places, routes_plans, routes_routes, routes_saved,
               routes_session)
from .config import Settings, get_settings
from .db import make_engine, make_sessionmaker
from .deps import Services
from .following import FollowService
from .following import real_port as follow_port
from .overviewing import OverviewService, real_port
from .places import Photon
from .planning import Planner
from .solving import SolveRunner, SolverPort, real_solver

DESCRIPTION = """Distance-budgeted running routes in Kerala.

Requests and results are the solver's own models (blueprint Phase 4 amendment 1). Every length is measured
from route geometry on the WGS84 ellipsoid by the solver; the API stores and returns those values unchanged.
Send the token from `POST /v1/session` in the `X-Client-Token` header.
"""


def create_app(settings: Settings | None = None, solver: SolverPort | None = None) -> FastAPI:
    """`solver` replaces the real solver (tests use a fake: no engines needed)."""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db_engine = make_engine(settings.database_url)
        redis = Redis.from_url(settings.redis_url, decode_responses=False)
        http = httpx.AsyncClient(timeout=settings.health_timeout_s)
        svc = Services(settings=settings, db_engine=db_engine, sessions=make_sessionmaker(db_engine), redis=redis,
                       http=http)
        app.state.services = svc
        app.state.photon = Photon(settings.photon_url, http)
        app.state.planner = Planner(svc, SolveRunner(solver or real_solver(settings), settings.solve_slots,
                                                     settings.slot_wait_s))
        app.state.overview = OverviewService(svc, real_port(settings.valhalla_url))
        app.state.follow = FollowService(svc, follow_port(settings.valhalla_url))
        try:
            yield
        finally:
            await app.state.planner.close()
            await app.state.overview.close()
            await app.state.follow.close()
            await http.aclose()
            await redis.aclose()
            await db_engine.dispose()

    app = FastAPI(title="Athlete Router API", version="0.4.0", description=DESCRIPTION, lifespan=lifespan)
    errors.install(app)
    if settings.cors_origin_list:   # Phase 5 A1
        app.add_middleware(
            CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False,
            allow_methods=["GET", "POST", "PATCH", "DELETE"],
            allow_headers=["Content-Type", "X-Client-Token", "If-Match"],
            # Retry-After for 429 backoff, Content-Disposition for the GPX file name.
            expose_headers=["Retry-After", "Content-Disposition", "Location"],
            max_age=600)
    app.include_router(routes_session.router)
    app.include_router(routes_places.router)
    app.include_router(routes_features.router)
    app.include_router(routes_plans.router)
    app.include_router(routes_routes.router)
    app.include_router(routes_saved.router)
    app.include_router(routes_health.router)
    return app


app = create_app()
