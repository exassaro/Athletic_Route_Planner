"""GET /v1/health: every service, both engine build ids, the OSM pin and the solver hash.

200 when the solve path is up (Valhalla, Postgres, Redis). GraphHopper down only costs the
"recommended" alternative (the solver flags it) and Photon down only costs search, so neither fails health.
"""

import asyncio
import time
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text

from . import builds
from .deps import Services, services

router = APIRouter(prefix="/v1", tags=["health"])
REQUIRED = ("valhalla", "postgres", "redis")


class ServiceStatus(BaseModel):
    ok: bool
    ms: float | None = None
    build: str | None = None
    detail: str | None = None


class Builds(BaseModel):
    osm: str
    valhalla: str | None
    graphhopper: str | None
    graphhopper_data: str | None    # the OSM extract GraphHopper imported; should equal `osm`
    solver: str


class HealthOut(BaseModel):
    status: Literal["ok", "degraded", "down"]
    services: dict[str, ServiceStatus]
    builds: Builds


async def _timed(coro, timeout: float) -> ServiceStatus:
    t0 = time.perf_counter()
    try:
        build = await asyncio.wait_for(coro, timeout)
        return ServiceStatus(ok=True, ms=round((time.perf_counter() - t0) * 1000, 1), build=build)
    except Exception as err:  # noqa: BLE001 - any failure means the service is not usable
        return ServiceStatus(ok=False, ms=round((time.perf_counter() - t0) * 1000, 1),
                             detail=f"{type(err).__name__}: {err}"[:300])


@router.get("/health", response_model=HealthOut, responses={503: {"model": HealthOut}},
            summary="Service status and build ids")
async def health(svc: Services = Depends(services)):
    s = svc.settings
    gh_info: dict = {}

    async def valhalla():
        return await builds.fetch_valhalla_build(svc.http, s.valhalla_url)

    async def graphhopper():
        gh_info.update(await builds.fetch_graphhopper_info(svc.http, s.graphhopper_url))
        return builds.graphhopper_build(gh_info)

    async def photon():
        resp = await svc.http.get(f"{s.photon_url}/status")
        resp.raise_for_status()
        body = resp.json()
        return f"photon {body.get('version', 'unknown')} index {body.get('import_date', 'unknown')}"

    async def postgres():
        async with svc.db_engine.connect() as conn:
            pg = (await conn.execute(text("SHOW server_version"))).scalar_one()
            gis = (await conn.execute(text("SELECT postgis_lib_version()"))).scalar_one()
        return f"postgres {pg} postgis {gis}"

    async def redis():
        await svc.redis.ping()
        info = await svc.redis.info("server")
        return f"redis {info.get('redis_version', 'unknown')}"

    async def osm_features():
        """Phase 5 A6: the OSM ways and boundaries are loaded, from the pinned extract."""
        async with svc.db_engine.connect() as conn:
            meta = dict((await conn.execute(text("SELECT key, value FROM osm_features_meta"))).all())
        pin = builds.osm_pin(s.manifest_path)
        if "osm_timestamp" not in meta:
            raise RuntimeError("not loaded: run api/scripts/load_osm_features.py")
        if pin != "unknown" and meta["osm_timestamp"] != pin:
            raise RuntimeError(f"loaded from {meta['osm_timestamp']}, the pin is {pin}: load again")
        return f"osm {meta['osm_timestamp']} ({meta.get('ways', '?')} ways, {meta.get('boundaries', '?')} boundaries)"

    names = ("valhalla", "graphhopper", "photon", "postgres", "redis", "osm_features")
    results = await asyncio.gather(*(_timed(f(), s.health_timeout_s)
                                     for f in (valhalla, graphhopper, photon, postgres, redis, osm_features)))
    status = dict(zip(names, results))
    up = all(status[n].ok for n in REQUIRED)
    overall = "ok" if up and all(r.ok for r in results) else ("degraded" if up else "down")
    body = HealthOut(status=overall, services=status, builds=Builds(
        osm=builds.osm_pin(s.manifest_path), valhalla=status["valhalla"].build,
        graphhopper=status["graphhopper"].build, graphhopper_data=gh_info.get("data_date"),
        solver=builds.solver_hash()))
    return JSONResponse(status_code=200 if up else 503, content=body.model_dump(mode="json"))
