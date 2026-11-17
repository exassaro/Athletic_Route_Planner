"""Fixed-window rate limits (Phase 4 amendment 22), on an in-memory Redis."""

import asyncio

import pytest
from fakeredis import FakeAsyncRedis

from athlete_api.errors import ApiError
from athlete_api.ratelimit import Limit, hit

RULE = Limit("solve", "client", limit=3, window_s=60)


def run(coro):
    return asyncio.run(coro)


def test_allows_up_to_the_limit_then_429_with_retry_after():
    async def go():
        redis = FakeAsyncRedis()
        for _ in range(3):
            await hit(redis, RULE, "c1", now=1_000_020.0)
        with pytest.raises(ApiError) as err:
            await hit(redis, RULE, "c1", now=1_000_030.0)
        return err.value

    err = run(go())
    assert err.status == 429 and err.error == "rate_limited"
    # the window holding t = 1_000_030 runs from 1_000_020 to 1_000_080: 50 s left
    assert err.headers["Retry-After"] == "50"
    assert err.detail["limit"] == 3 and err.detail["scope"] == "client"


def test_counts_are_per_identity_and_per_window():
    async def go():
        redis = FakeAsyncRedis()
        for _ in range(3):
            await hit(redis, RULE, "c1", now=1_000_020.0)
        await hit(redis, RULE, "c2", now=1_000_020.0)            # another client: own counter
        await hit(redis, RULE, "c1", now=1_000_080.0)            # next window: counter starts again
        other = Limit("read", "client", limit=3, window_s=60)
        await hit(redis, other, "c1", now=1_000_020.0)           # another bucket: own counter

    run(go())


def test_keys_expire_with_their_window():
    async def go():
        redis = FakeAsyncRedis()
        await hit(redis, RULE, "c1", now=1_000_020.0)
        keys = await redis.keys("rl:*")
        return await redis.ttl(keys[0])

    assert 0 < run(go()) <= 61
