"""Shared state and request dependencies: services, the calling client, its IP, rate limits."""

import hashlib
from dataclasses import dataclass

import httpx
from fastapi import Depends, Header, Request
from redis.asyncio import Redis
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.sql import func

from . import ratelimit
from .config import Settings
from .db import Client
from .errors import ApiError

TOKEN_HEADER = "X-Client-Token"


@dataclass
class Services:
    settings: Settings
    db_engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    redis: Redis
    http: httpx.AsyncClient


def services(request: Request) -> Services:
    return request.app.state.services


def token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def client_ip(request: Request, svc: Services = Depends(services)) -> str:
    if svc.settings.trust_forwarded_for:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def current_client(x_client_token: str | None = Header(None, description="Token from POST /v1/session"),
                         svc: Services = Depends(services)) -> Client:
    if not x_client_token:
        raise ApiError(401, "client_required", f"Send the token from POST /v1/session in the {TOKEN_HEADER} header.")
    async with svc.sessions() as db:
        client = (await db.execute(
            update(Client).where(Client.token_hash == token_hash(x_client_token))
            .values(last_seen_at=func.now()).returning(Client))).scalar_one_or_none()
        await db.commit()
    if client is None:
        raise ApiError(401, "client_required", "Unknown client token. Get a new one from POST /v1/session.")
    return client


def limited(bucket: str):
    """Dependency: count the request against the per-client and per-IP limits of `bucket` ("solve" or "read")."""

    async def check(client: Client = Depends(current_client), ip: str = Depends(client_ip),
                    svc: Services = Depends(services)) -> Client:
        s = svc.settings
        if bucket == "solve":
            rules = [(ratelimit.Limit("solve", "client", s.rate_solve_per_client_min, 60), str(client.id)),
                     (ratelimit.Limit("solve", "ip", s.rate_solve_per_ip_min, 60), ip)]
        else:
            rules = [(ratelimit.Limit("read", "client", s.rate_read_per_client_min, 60), str(client.id))]
        for rule, ident in rules:
            await ratelimit.hit(svc.redis, rule, ident)
        return client

    return check
