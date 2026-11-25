"""Fixed-window rate limits in Redis, per client and per IP (Phase 4 amendment 22).

A key per (bucket, scope, id, window) is incremented and expires with its window. Over the limit:
429 `rate_limited` with Retry-After set to the seconds left in the window.
"""

import time
from dataclasses import dataclass

from redis.asyncio import Redis

from .errors import ApiError


@dataclass(frozen=True)
class Limit:
    bucket: str      # "solve", "read", "write", "session", "link", "claim"
    scope: str       # "client", "ip" or "all" (one count for everyone)
    limit: int
    window_s: int


async def hit(redis: Redis, rule: Limit, ident: str, now: float | None = None) -> None:
    """Count one request against `rule` for `ident`; raise ApiError(429) when the window is full."""
    now = time.time() if now is None else now
    window = int(now // rule.window_s)
    key = f"rl:{rule.bucket}:{rule.scope}:{ident}:{window}"
    async with redis.pipeline(transaction=True) as pipe:
        pipe.incr(key)
        pipe.expire(key, rule.window_s + 1, nx=True)
        count, _ = await pipe.execute()
    if count > rule.limit:
        retry = max(1, int((window + 1) * rule.window_s - now + 0.999))
        who = "from everyone at once" if rule.scope == "all" else f"for this {rule.scope}"
        raise ApiError(429, "rate_limited",
                       f"Too many {rule.bucket} requests {who}: at most {rule.limit} every {rule.window_s} s.",
                       {"bucket": rule.bucket, "scope": rule.scope, "limit": rule.limit, "window_s": rule.window_s,
                        "retry_after_s": retry},
                       headers={"Retry-After": str(retry)})
