"""Serving overview points (blueprint Phase 5d amendment 2, A14): worker threads, cache, failures.

Key: route, N and Valhalla's build, kept as long as a solve. A stored route's geometry never changes, and a saved
route that is updated points at another route, so nothing here goes stale. The share endpoint is public and a
miss costs up to 19 engine calls, so identical misses in flight share one computation and only two run at once,
away from the solve slots.

Every failure is a 503 in the usual shape: the web app then uses evenly spaced km marks.
"""

import asyncio
import logging
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

import httpx
from athlete_engine.valhalla import Valhalla, ValhallaError
from athlete_solver.engine import NoRoute, ValhallaEngine

from . import builds
from .deps import Services
from .errors import ApiError
from .overview import LonLat, Overview, overview
from .schemas import OverviewPoint, OverviewPointsOut

log = logging.getLogger("athlete_api.overview")

PREFIX = "overview:v1:"   # raise the version when the rule in overview.py changes
WORKERS = 2
WAIT_S = 10.0             # what one request waits; the computation carries on and is cached
CALL_TIMEOUT_S = 5.0      # one engine call

# (geometry, N) -> Overview. Runs in a worker thread.
OverviewPort = Callable[[list[LonLat], int], Overview]


def real_port(valhalla_url: str) -> OverviewPort:
    def run(geometry: list[LonLat], limit: int) -> Overview:
        with Valhalla(valhalla_url, timeout=CALL_TIMEOUT_S) as client:
            engine = ValhallaEngine(client)     # the solver's own client: pedestrian, ferries excluded
            return overview(geometry, limit, lambda a, b: engine.route([a, b]).shape)

    return run


def unavailable(reason: object) -> ApiError:
    return ApiError(503, "engine_unavailable", "Valhalla is not answering, so overview points can't be worked out.",
                    {"engine": "valhalla", "reason": str(reason)[:200]})


def overview_error(err: Exception) -> ApiError:
    if isinstance(err, httpx.TransportError):
        return unavailable(f"{type(err).__name__}: {err}")
    if isinstance(err, NoRoute):
        # the engine adapter reports every HTTP error as NoRoute; a 5xx is the engine failing, not a missing path
        cause = err.__cause__
        if isinstance(cause, ValhallaError) and cause.status >= 500:
            return unavailable(cause)
        return ApiError(503, "overview_unavailable", "No walking path joins some of this route's points.",
                        {"reason": str(err)[:200]})
    return ApiError(500, "overview_failed", "The overview points could not be worked out.",
                    {"reason": f"{type(err).__name__}: {err}"[:200]})


class OverviewService:
    def __init__(self, svc: Services, port: OverviewPort, wait_s: float = WAIT_S):
        self.svc, self.port, self.wait_s = svc, port, wait_s
        self._pool = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="overview")
        self._inflight: dict[str, asyncio.Task] = {}

    async def valhalla_build(self) -> str:
        try:
            return await builds.fetch_valhalla_build(self.svc.http, self.svc.settings.valhalla_url)
        except (httpx.HTTPError, ValueError) as err:
            raise unavailable(err) from None

    async def get(self, route_id: uuid.UUID, geometry: list[LonLat], limit: int) -> OverviewPointsOut:
        key = f"{PREFIX}{route_id}:{limit}:{await self.valhalla_build()}"
        if self.svc.settings.cache_enabled and (blob := await self.svc.redis.get(key)) is not None:
            return OverviewPointsOut.model_validate_json(blob)
        task = self._inflight.get(key)
        if task is None:
            task = self._inflight[key] = asyncio.create_task(self._compute(key, geometry, limit))
            task.add_done_callback(lambda t: self._done(key, t))
        try:
            return await asyncio.wait_for(asyncio.shield(task), self.wait_s)
        except TimeoutError:
            raise ApiError(503, "overview_timeout",
                           f"Working out the overview points took longer than {self.wait_s:g} s. Try again shortly.",
                           {"wait_s": self.wait_s}) from None

    async def _compute(self, key: str, geometry: list[LonLat], limit: int) -> OverviewPointsOut:
        try:
            found = await asyncio.get_running_loop().run_in_executor(self._pool, self.port, geometry, limit)
        except Exception as err:
            raise overview_error(err) from err
        out = OverviewPointsOut(points=[OverviewPoint(lon=lon, lat=lat, at_m=at) for lon, lat, at in found.points],
                                max_deviation_m=found.max_deviation_m, overlap_pct=found.overlap_pct)
        if self.svc.settings.cache_enabled:
            await self.svc.redis.set(key, out.model_dump_json(), ex=self.svc.settings.cache_ttl_s)
        return out

    def _done(self, key: str, task: asyncio.Task) -> None:
        self._inflight.pop(key, None)
        if not task.cancelled() and (err := task.exception()) is not None:
            # every waiter may have timed out: the error is read here. No coordinates are logged.
            log.warning("overview points failed: %r", err)

    async def close(self) -> None:
        for task in list(self._inflight.values()):
            task.cancel()
        self._pool.shutdown(wait=False, cancel_futures=True)
