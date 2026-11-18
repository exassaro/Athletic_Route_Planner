"""Solve a request for a plan and store the result as a new version (Phase 4 amendments 3 to 5, 12 to 14).

Order of work for one request:
1. Build ids: Valhalla /status (required: down means 503) and GraphHopper /info (optional).
2. Cache lookup by the canonical request and the build ids. A hit needs no slot and no engine.
3. Otherwise a solve: shared with an identical request already in flight, or started once a slot is free
   (wait up to 10 s, then 429 solver_busy).
4. A background task stores the version once the solve finishes and caches the result. The request waits
   for it for up to the 15 s budget; over that it gets 504 with the plan id, and the task carries on: the
   version appears at GET /v1/plans/{id} when the solve ends.
Responses are always built from the stored rows, so what the API returns is what it stored.
"""

import asyncio
import json
import logging
import time
import uuid
from collections import Counter

import httpx
from athlete_solver.models import RouteRequest
from sqlalchemy import func, select

from . import builds as build_ids
from . import cache, explain
from .diff import diff as version_diff
from .db import Plan, PlanVersion, Route
from .deps import Services
from .elevation import ElevationMissing
from .errors import ApiError
from .schemas import BuildsOut, CandidateOut, PlanOut, PlanVersionOut
from .solving import Busy, SolveRunner
from .store import candidate_of, route_row

log = logging.getLogger("athlete_api.planning")
ERROR_TTL_S = 3600


class Planner:
    def __init__(self, svc: Services, runner: SolveRunner):
        self.svc, self.runner = svc, runner
        self.pending: Counter[uuid.UUID] = Counter()   # plan id -> stores in progress
        self._tasks: set[asyncio.Task] = set()

    # ------------------------------------------------------------------ builds

    async def current_builds(self) -> cache.BuildIds:
        s = self.svc.settings
        try:
            valhalla = await build_ids.fetch_valhalla_build(self.svc.http, s.valhalla_url)
        except (httpx.HTTPError, ValueError) as err:
            raise ApiError(503, "engine_unavailable", "Valhalla is not answering, so no route can be made.",
                           {"engine": "valhalla", "reason": str(err)[:200]}) from None
        try:
            graphhopper = build_ids.graphhopper_build(await build_ids.fetch_graphhopper_info(self.svc.http,
                                                                                             s.graphhopper_url))
        except (httpx.HTTPError, ValueError):
            graphhopper = None   # the solver then returns "shortest" only, flagged alternative_unavailable
        return cache.BuildIds(osm=build_ids.osm_pin(s.manifest_path), valhalla=valhalla, graphhopper=graphhopper,
                              solver=build_ids.solver_hash())

    # ------------------------------------------------------------------ solve and store

    async def new_plan(self, client_id: uuid.UUID) -> uuid.UUID:
        plan = Plan(id=uuid.uuid4(), client_id=client_id)
        async with self.svc.sessions() as db:
            db.add(plan)
            await db.commit()
        return plan.id

    async def solve_into(self, plan_id: uuid.UUID, request: RouteRequest, source: str) -> PlanVersionOut:
        """Solve `request` and store it as the plan's next version, with its explanation and its diff against
        the version before it; return that version."""
        settings = self.svc.settings
        t_request = time.perf_counter()
        builds = await self.current_builds()
        key = cache.key(request, builds)
        solved = await cache.get(self.svc.redis, key, builds) if settings.cache_enabled else None
        task = None
        if solved is None:
            try:
                task = await self.runner.task_for(key, request, builds.osm)
            except Busy:
                retry = settings.busy_retry_after_s
                raise ApiError(429, "solver_busy",
                               f"All {self.runner.slots} solve slots stayed busy for {settings.slot_wait_s:g} s. "
                               "Try again shortly.", {"slots": self.runner.slots, "retry_after_s": retry},
                               headers={"Retry-After": str(retry)}) from None
        t_budget = time.perf_counter()
        store = asyncio.create_task(self._finish(plan_id, request, source, key, builds, solved, task))
        self._tasks.add(store)
        self.pending[plan_id] += 1
        store.add_done_callback(lambda t: self._stored(plan_id, t))
        try:
            version_no = await asyncio.wait_for(asyncio.shield(store), settings.solve_budget_s)
        except TimeoutError:
            elapsed = (time.perf_counter() - t_budget) * 1000
            raise ApiError(504, "solve_timeout",
                           f"The solve took longer than {settings.solve_budget_s:g} s. It carries on; the new "
                           f"version will appear at /v1/plans/{plan_id}.",
                           {"plan_id": str(plan_id), "status": "solving", "elapsed_ms": round(elapsed, 1),
                            "waited_for_slot_ms": round((t_budget - t_request) * 1000, 1),
                            "poll": f"/v1/plans/{plan_id}"}) from None
        return await self.version_out(plan_id, version_no)

    def _stored(self, plan_id: uuid.UUID, task: asyncio.Task) -> None:
        self._tasks.discard(task)
        self.pending[plan_id] -= 1
        if self.pending[plan_id] <= 0:
            del self.pending[plan_id]
        if not task.cancelled() and task.exception() is not None:
            log.warning("solve for plan %s failed: %r", plan_id, task.exception())

    async def _finish(self, plan_id, request, source, key, builds, solved, task) -> int:
        try:
            if solved is None:
                result, elev, _ = await task
                solved = cache.Solved(result=result, elevation=elev, builds=builds)
                if builds.graphhopper is not None and self.svc.settings.cache_enabled:
                    await cache.put(self.svc.redis, key, solved, self.svc.settings.cache_ttl_s)
            return await self._store(plan_id, request, source, key, solved)
        except ApiError as err:
            await self._remember_error(plan_id, err)
            raise
        except Exception as err:  # noqa: BLE001 - mapped to one error shape, remembered for pollers
            api_err = solve_error(err)
            await self._remember_error(plan_id, api_err)
            raise api_err from err

    async def _remember_error(self, plan_id: uuid.UUID, err: ApiError) -> None:
        body = {"error": err.error, "message": err.message, "detail": err.detail}
        await self.svc.redis.set(f"plan:{plan_id}:error", json.dumps(body, default=str), ex=ERROR_TTL_S)

    async def _store(self, plan_id, request, source, key, solved: cache.Solved) -> int:
        result = solved.result
        dumped = result.model_dump(mode="json", include={"conflict", "facts", "flags"})
        previous = None
        async with self.svc.sessions() as db, db.begin():
            await db.execute(select(Plan.id).where(Plan.id == plan_id).with_for_update())
            last = (await db.execute(select(func.coalesce(func.max(PlanVersion.version_no), 0))
                                     .where(PlanVersion.plan_id == plan_id))).scalar_one()
            if last:
                previous = await self._version_out(db, plan_id, last)
            version = PlanVersion(
                id=uuid.uuid4(), plan_id=plan_id, version_no=last + 1, request=request.model_dump(mode="json"),
                source=source, outcome=result.outcome, conflict=dumped["conflict"], facts=dumped["facts"],
                flags=dumped["flags"], explanation=explain.explain(result),
                diff=version_diff(previous, request, result) if previous else None,
                graph_build=result.graph_build, valhalla_build=solved.builds.valhalla,
                graphhopper_build=solved.builds.graphhopper, solver_hash=solved.builds.solver, cache_key=key,
                from_cache=solved.from_cache, elapsed_ms=result.elapsed_ms, engine_calls=result.engine_calls)
            db.add(version)
            await db.flush()
            for seq, (cand, elev) in enumerate(zip(result.candidates, solved.elevation, strict=True)):
                db.add(route_row(cand, version_id=version.id, seq=seq, heights=elev.heights, elevation=elev.profile))
        await self.svc.redis.delete(f"plan:{plan_id}:error")
        return last + 1

    # ------------------------------------------------------------------ reads

    async def version_out(self, plan_id: uuid.UUID, version_no: int) -> PlanVersionOut:
        async with self.svc.sessions() as db:
            out = await self._version_out(db, plan_id, version_no)
        if out is None:
            raise ApiError(404, "not_found", f"Plan {plan_id} has no version {version_no}.")
        return out

    async def _version_out(self, db, plan_id: uuid.UUID, version_no: int) -> PlanVersionOut | None:
        version = (await db.execute(select(PlanVersion).where(PlanVersion.plan_id == plan_id,
                                                              PlanVersion.version_no == version_no))).scalar_one_or_none()
        if version is None:
            return None
        routes = (await db.execute(select(Route).where(Route.plan_version_id == version.id)
                                   .order_by(Route.seq))).scalars().all()
        return PlanVersionOut(
            plan_id=plan_id, version=version.version_no, source=version.source, created_at=version.created_at,
            outcome=version.outcome, request=RouteRequest.model_validate(version.request),
            candidates=[CandidateOut(route_id=r.id, **candidate_of(r).model_dump()) for r in routes],
            conflict=version.conflict, facts=version.facts, flags=version.flags, explanation=version.explanation,
            diff=version.diff,
            builds=BuildsOut(osm=version.graph_build, valhalla=version.valhalla_build,
                             graphhopper=version.graphhopper_build, solver=version.solver_hash),
            cached=version.from_cache, elapsed_ms=version.elapsed_ms, engine_calls=version.engine_calls)

    async def owned_plan(self, plan_id: uuid.UUID, client_id: uuid.UUID) -> Plan:
        async with self.svc.sessions() as db:
            plan = await db.get(Plan, plan_id)
        if plan is None or plan.client_id != client_id:
            raise ApiError(404, "not_found", f"No plan {plan_id} for this client.")
        return plan

    async def latest_no(self, plan_id: uuid.UUID) -> int:
        async with self.svc.sessions() as db:
            return (await db.execute(select(func.coalesce(func.max(PlanVersion.version_no), 0))
                                     .where(PlanVersion.plan_id == plan_id))).scalar_one()

    async def plan_out(self, plan_id: uuid.UUID) -> PlanOut:
        async with self.svc.sessions() as db:
            numbers = (await db.execute(select(PlanVersion.version_no).where(PlanVersion.plan_id == plan_id)
                                        .order_by(PlanVersion.version_no))).scalars().all()
            latest = await self._version_out(db, plan_id, numbers[-1]) if numbers else None
        error = None
        if plan_id in self.pending:
            status = "solving"
        else:
            raw = await self.svc.redis.get(f"plan:{plan_id}:error")
            error = json.loads(raw) if raw else None
            status = "failed" if error else "ready"
        return PlanOut(plan_id=plan_id, status=status, versions=list(numbers), latest=latest, error=error)

    async def close(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        self.runner.shutdown()


def solve_error(err: Exception) -> ApiError:
    """A failure inside the solve, as one of the API's errors."""
    if isinstance(err, httpx.TransportError):
        return ApiError(503, "engine_unavailable", "A routing engine stopped answering during the solve.",
                        {"reason": f"{type(err).__name__}: {err}"[:300]})
    if isinstance(err, ElevationMissing):
        return ApiError(502, "elevation_unavailable", "The route was made but its elevation could not be read.",
                        {"reason": str(err)})
    return ApiError(500, "solve_failed", "The solver failed on this request.",
                    {"reason": f"{type(err).__name__}: {err}"[:300]})
