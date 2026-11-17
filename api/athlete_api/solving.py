"""Solve slots and the worker thread (Phase 4 amendments 3, 12, 13, 20).

The solver is synchronous and runs its own thread pools, so each solve runs in a worker thread, never on the
event loop. At most `slots` solves run at once in this process (one uvicorn worker). A request waits up to
`wait_s` for a slot, then gets 429 solver_busy. Identical requests (same cache key) already in flight share one
solve. A slot is released only when the worker thread really finishes, even if the request that started it
has already been answered with a 504: a Python thread cannot be stopped, and releasing early would let more
than `slots` solves run.
"""

import asyncio
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from athlete_engine.valhalla import Valhalla
from athlete_solver.models import RouteRequest, SolveResult
from athlete_solver.solve import solve

from . import elevation
from .config import Settings

# (request, graph_build) -> (SolveResult, one Elevation per candidate). Runs in a worker thread.
SolverPort = Callable[[RouteRequest, str], tuple[SolveResult, list[elevation.Elevation]]]


def real_solver(settings: Settings) -> SolverPort:
    """The solver against the live engines, then one /height pass for the candidates' elevation."""

    def run(request: RouteRequest, graph_build: str):
        with Valhalla(settings.valhalla_url) as client:
            result = solve(request, engine=client, graph_build=graph_build)
            elev = elevation.for_candidates(client, result.candidates) if result.candidates else []
        return result, elev

    return run


class Busy(Exception):
    """No slot within the wait."""


class SolveRunner:
    def __init__(self, port: SolverPort, slots: int, wait_s: float):
        self.port, self.slots, self.wait_s = port, slots, wait_s
        self._sem = asyncio.Semaphore(slots)
        self._pool = ThreadPoolExecutor(max_workers=slots, thread_name_prefix="solve")
        self._inflight: dict[str, asyncio.Task] = {}
        self.running = 0          # worker threads busy now
        self.peak_running = 0     # the most ever busy at once (tests, report)
        self.started = 0          # solves actually run (not shared, not cached)

    async def task_for(self, cache_key: str, request: RouteRequest, graph_build: str) -> asyncio.Task:
        """A task resolving to (SolveResult, elevations, solve seconds): shared if the same key is in flight,
        otherwise started once a slot is free. Raises Busy if no slot frees up within wait_s."""
        shared = self._inflight.get(cache_key)
        if shared is not None:
            return shared
        try:
            await asyncio.wait_for(self._sem.acquire(), self.wait_s)
        except TimeoutError:
            raise Busy from None
        shared = self._inflight.get(cache_key)      # started by someone else while this request waited
        if shared is not None:
            self._sem.release()
            return shared
        task = asyncio.create_task(self._run(request, graph_build), name=f"solve {cache_key[-12:]}")
        self._inflight[cache_key] = task
        task.add_done_callback(lambda _: self._inflight.pop(cache_key, None))
        return task

    async def _run(self, request: RouteRequest, graph_build: str):
        self.running += 1
        self.started += 1
        self.peak_running = max(self.peak_running, self.running)
        loop = asyncio.get_running_loop()
        t0 = time.perf_counter()
        future = loop.run_in_executor(self._pool, self.port, request, graph_build)
        try:
            result, elev = await asyncio.shield(future)
        finally:
            if future.done():
                self._release()
            else:   # cancelled (shutdown) while the thread still runs: the slot stays taken until it ends
                future.add_done_callback(lambda _: self._release())
        return result, elev, time.perf_counter() - t0

    def _release(self) -> None:
        self.running -= 1
        self._sem.release()

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
