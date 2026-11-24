"""Serving follow data (blueprint Phase 5d amendment 6, A15): worker threads, cache, and the fallback.

Follow must start without Valhalla, so this never answers 503: when Valhalla is down, slow or cannot match, the
cues come from the geometry alone, with no names (`cue_source: "geometry"`). Only matched cues are cached, by
route and Valhalla build, as long as a solve.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Callable
from dataclasses import asdict

import httpx
from athlete_engine.policy import pedestrian_options
from athlete_engine.valhalla import Valhalla, ValhallaError

from . import builds, follow
from .deps import Services
from .engine_work import CALL_TIMEOUT_S, EngineWork
from .errors import ApiError
from .schemas import FollowCue, FollowOut

log = logging.getLogger("athlete_api.follow")

PREFIX = "follow:v1:"     # raise the version when the rule in follow.py or the response changes
WAIT_S = 10.0             # what one request waits before it takes the geometry-only cues
LENGTH_SLACK_M = 0.5      # the line's end against the solver's stored length (0.0000 m on 638 stored routes)
# Valhalla failing, as against a bug of ours (which is a 500)
NO_MATCH = (httpx.HTTPError, ValhallaError, json.JSONDecodeError, TimeoutError)

# Line -> Match. Runs in a worker thread.
MatchPort = Callable[[follow.Line], follow.Match]


def real_port(valhalla_url: str) -> MatchPort:
    def run(line: follow.Line) -> follow.Match:
        with Valhalla(valhalla_url, timeout=CALL_TIMEOUT_S) as client:
            return line.match(lambda piece: client.trace_attributes(
                piece, shape_match=follow.TRACE_MATCH, costing_options=pedestrian_options(),
                attributes=follow.TRACE_ATTRIBUTES))

    return run


def follow_out(route_id: uuid.UUID, line: follow.Line, match: follow.Match | None) -> FollowOut:
    def rounded(step: dict) -> dict:
        return step | {"at_m": round(step["at_m"], 1)}

    found = [asdict(cue) for cue in follow.cues(line, match)]
    return FollowOut(route_id=route_id, points=line.geometry, along_m=[round(d, 1) for d in line.along_m],
                     cue_source="geometry" if match is None else "junctions",
                     cues=[FollowCue(**rounded(c) | {"then": [rounded(s) for s in c["then"]]}) for c in found])


class FollowService:
    def __init__(self, svc: Services, port: MatchPort, wait_s: float = WAIT_S):
        self.svc, self.port, self.wait_s = svc, port, wait_s
        self._work = EngineWork("follow")

    async def valhalla_build(self) -> str:
        return await builds.fetch_valhalla_build(self.svc.http, self.svc.settings.valhalla_url)

    async def get(self, route_id: uuid.UUID, geometry: list, length_m: float) -> FollowOut:
        try:
            key = f"{PREFIX}{route_id}:{await self.valhalla_build()}"
            if self.svc.settings.cache_enabled and (blob := await self.svc.redis.get(key)) is not None:
                return FollowOut.model_validate_json(blob)
            return await self._work.shared(key, lambda: self._matched(key, route_id, geometry, length_m), self.wait_s)
        except NO_MATCH as err:
            log.warning("follow cues from the geometry alone: %s", type(err).__name__)
            # not in the engine threads: they may be the ones that are stuck
            return await asyncio.to_thread(lambda: follow_out(route_id, checked_line(geometry, length_m), None))

    async def _matched(self, key: str, route_id: uuid.UUID, geometry: list, length_m: float) -> FollowOut:
        def work() -> FollowOut:
            line = checked_line(geometry, length_m)
            return follow_out(route_id, line, self.port(line))

        try:
            out = await self._work.in_thread(work)
        except (ApiError, *NO_MATCH):
            raise
        except Exception as err:
            raise ApiError(500, "follow_failed", "The follow data could not be worked out.",
                           {"reason": type(err).__name__}) from err
        if self.svc.settings.cache_enabled:
            await self.svc.redis.set(key, out.model_dump_json(), ex=self.svc.settings.cache_ttl_s)
        return out

    async def close(self) -> None:
        await self._work.close()


def checked_line(geometry: list, length_m: float) -> follow.Line:
    line = follow.Line(geometry)
    if abs(line.length_m - length_m) > LENGTH_SLACK_M:
        # as the elevation profile's check: metres along the route must end at the solver's length
        raise ApiError(500, "follow_mismatch", "The stored geometry does not measure the route's length.")
    return line
