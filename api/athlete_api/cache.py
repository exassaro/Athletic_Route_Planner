"""Solve cache in Redis (Phase 4 amendments 5 and 14).

Key: sha256 of the canonical RouteRequest (validated, defaults filled in, keys sorted) with the Valhalla build,
the GraphHopper build and the solver source hash. A rebuild of either engine or a solver code change gives a
new key. Value: the SolveResult (without the candidates' internal edge_ids) and each candidate's elevation, so a
hit needs no engine call. Kept 24 h. Results made without an engine (flag alternative_unavailable) are not cached.
"""

import hashlib
import json
import zlib
from dataclasses import dataclass

from athlete_solver.models import RouteRequest, SolveResult
from redis.asyncio import Redis

from .elevation import Elevation

PREFIX = "solve:v1:"
NOT_CACHED_FLAGS = {"alternative_unavailable"}
RESULT_EXCLUDE = {"candidates": {"__all__": {"edge_ids"}}}


@dataclass(frozen=True)
class BuildIds:
    osm: str
    valhalla: str
    graphhopper: str | None
    solver: str


@dataclass
class Solved:
    """A SolveResult with each candidate's elevation, and where it came from."""

    result: SolveResult
    elevation: list[Elevation]
    builds: BuildIds
    from_cache: bool = False


def canonical(request: RouteRequest) -> str:
    return json.dumps(request.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def key(request: RouteRequest, builds: BuildIds) -> str:
    material = "\n".join([canonical(request), builds.valhalla, builds.graphhopper or "graphhopper:none", builds.solver])
    return PREFIX + hashlib.sha256(material.encode()).hexdigest()


def cacheable(result: SolveResult) -> bool:
    return not any(f.code in NOT_CACHED_FLAGS for f in result.flags)


def encode(solved: Solved) -> bytes:
    body = {"result": solved.result.model_dump(mode="json", exclude=RESULT_EXCLUDE),
            "elevation": [e.to_json() for e in solved.elevation]}
    return zlib.compress(json.dumps(body, separators=(",", ":")).encode(), 6)


def decode(blob: bytes, builds: BuildIds) -> Solved:
    body = json.loads(zlib.decompress(blob))
    return Solved(result=SolveResult.model_validate(body["result"]),
                  elevation=[Elevation.from_json(e) for e in body["elevation"]], builds=builds, from_cache=True)


async def get(redis: Redis, cache_key: str, builds: BuildIds) -> Solved | None:
    blob = await redis.get(cache_key)
    return None if blob is None else decode(blob, builds)


async def put(redis: Redis, cache_key: str, solved: Solved, ttl_s: int) -> bool:
    if not cacheable(solved.result):
        return False
    await redis.set(cache_key, encode(solved), ex=ttl_s)
    return True
