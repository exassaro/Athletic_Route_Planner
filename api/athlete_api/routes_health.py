"""GET /v1/health: every service, both engine build ids, the OSM pin and the solver hash.

Step 9 amendment 5: that detail goes only to a request whose X-Health-Key equals ATHLETE_HEALTH_KEY (constant-time
comparison; no key set: never). Everyone else gets the status, what works (features) and an opaque id of each
engine's map (sha256 of its build id, 16 hex), so the web can still tell that a reopened plan was made on an older
map without anyone learning the versions. The status codes are the same for both.

200 when the solve path is up (Valhalla, Postgres, Redis). GraphHopper down only costs the
"recommended" alternative (the solver flags it) and Photon down only costs search, so neither fails health.
"""

import asyncio
import hashlib
import hmac
import time
from typing import Literal

from fastapi import APIRouter, Depends, Header
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


class Features(BaseModel):
    planning: bool      # routes can be made (Valhalla, Postgres, Redis)
    search: bool        # place search (Photon)
    recommended: bool   # the "recommended" alternative (GraphHopper)


class MapIds(BaseModel):
    """sha256 of each build id, first 16 hex characters; null when that engine does not answer."""
    osm: str | None
    valhalla: str | None
    graphhopper: str | None


class PublicHealthOut(BaseModel):
    status: Literal["ok", "degraded", "down"]
    features: Features
    map: MapIds


def map_id(build: str | None) -> str | None:
    return hashlib.sha256(build.encode()).hexdigest()[:16] if build else None


def key_ok(given: str | None, expected: str) -> bool:
    """Constant time; an empty setting never matches."""
    return bool(expected) and given is not None and hmac.compare_digest(given.encode(), expected.encode())


async def _timed(coro, timeout: float) -> ServiceStatus:
    t0 = time.perf_counter()
    try:
        build = await asyncio.wait_for(coro, timeout)
        return ServiceStatus(ok=True, ms=round((time.perf_counter() - t0) * 1000, 1), build=build)
    except Exception as err:  # noqa: BLE001 - any failure means the service is not usable
        return ServiceStatus(ok=False, ms=round((time.perf_counter() - t0) * 1000, 1),
                             detail=f"{type(err).__name__}: {err}"[:300])


@router.get("/health", response_model=PublicHealthOut | HealthOut,
            responses={503: {"model": PublicHealthOut | HealthOut}}, summary="Service status")
async def health(svc: Services = Depends(services),
                 x_health_key: str | None = Header(None, include_in_schema=False)):
    """200 when routes can be made, 503 when not. The body is PublicHealthOut; HealthOut (services, build ids,
    errors) only with the operators' key."""
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
    osm = builds.osm_pin(s.manifest_path)
    code = 200 if up else 503
    if not key_ok(x_health_key, s.health_key):
        public = PublicHealthOut(
            status=overall,
            features=Features(planning=up, search=status["photon"].ok, recommended=status["graphhopper"].ok),
            map=MapIds(osm=map_id(osm), valhalla=map_id(status["valhalla"].build),
                       graphhopper=map_id(status["graphhopper"].build)))
        return JSONResponse(status_code=code, content=public.model_dump(mode="json"), headers={"Cache-Control": "no-store"})
    body = HealthOut(status=overall, services=status, builds=Builds(
        osm=osm, valhalla=status["valhalla"].build,
        graphhopper=status["graphhopper"].build, graphhopper_data=gh_info.get("data_date"),
        solver=builds.solver_hash()))
    return JSONResponse(status_code=code, content=body.model_dump(mode="json"), headers={"Cache-Control": "no-store"})
