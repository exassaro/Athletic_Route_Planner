"""Engine work outside the solve slots, for overview points and follow data (blueprint Phase 5d, A14 and A15).

Each has its own two worker threads, so a public share link cannot starve the solves. Identical requests in
flight share one task. A caller may stop waiting; the task carries on and caches what it finds.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

log = logging.getLogger("athlete_api.engine_work")

WORKERS = 2
CALL_TIMEOUT_S = 5.0      # one engine call


class EngineWork:
    def __init__(self, name: str, workers: int = WORKERS):
        self.name = name
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix=name)
        self._inflight: dict[str, asyncio.Task] = {}

    async def in_thread(self, fn: Callable[..., Any], *args: Any) -> Any:
        return await asyncio.get_running_loop().run_in_executor(self._pool, fn, *args)

    async def shared(self, key: str, make: Callable[[], Awaitable[Any]], wait_s: float) -> Any:
        """The result of `make()`, shared by everyone asking for `key`. TimeoutError after wait_s."""
        task = self._inflight.get(key)
        if task is None:
            task = self._inflight[key] = asyncio.create_task(make())
            task.add_done_callback(lambda t: self._done(key, t))
        return await asyncio.wait_for(asyncio.shield(task), wait_s)

    def _done(self, key: str, task: asyncio.Task) -> None:
        self._inflight.pop(key, None)
        if not task.cancelled() and (err := task.exception()) is not None:
            # every waiter may have timed out: the error is read here. No coordinates are logged.
            log.warning("%s failed: %r", self.name, err)

    async def close(self) -> None:
        for task in list(self._inflight.values()):
            task.cancel()
        self._pool.shutdown(wait=False, cancel_futures=True)
