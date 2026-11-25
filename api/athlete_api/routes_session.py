"""POST /v1/session: an anonymous client token (Phase 4 amendment 7).

Step 9, "Use on another device": POST /v1/session/link gives the caller a one-time code; another browser sends it to
POST /v1/session/claim and gets a token of its own for the same client (table client_tokens, migration 0006).

The code is kept in Redis only, as its sha256 (the code itself is never stored), bound to the client id, for
`link_ttl_s`. Claim takes it with GETDEL, so it works once even when two claims arrive together. Unknown, expired
and used codes get the same answer. No token and no code is logged: neither is in a path or a query string.
"""

import hashlib
import secrets
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from . import ratelimit
from .db import Client, ClientToken
from .deps import TOKEN_HEADER, Services, client_ip, current_client, services, token_hash
from .errors import ApiError, responses

router = APIRouter(prefix="/v1", tags=["session"])

LINK_KEY = "link:"   # + sha256(code) hex -> client id


class SessionOut(BaseModel):
    client_id: uuid.UUID
    token: str
    header: str = TOKEN_HEADER


class LinkOut(BaseModel):
    code: str = Field(description="One-time code for POST /v1/session/claim. Never contains or reveals the token.")
    expires_in_s: int


class ClaimIn(BaseModel):
    code: str = Field(min_length=1, max_length=200)


def _link_key(code: str) -> str:
    return LINK_KEY + hashlib.sha256(code.encode()).hexdigest()


@router.post("/session", response_model=SessionOut, status_code=201, responses=responses(429),
             summary="Issue an anonymous client token")
async def create_session(ip: str = Depends(client_ip), svc: Services = Depends(services)) -> SessionOut:
    """Returns a random token. Send it in the `X-Client-Token` header on every other call (share and health
    excepted). Only its hash is stored, so a lost token cannot be recovered: ask for a new one."""
    await ratelimit.hit(svc.redis, ratelimit.Limit("session", "ip", svc.settings.rate_session_per_ip_hour, 3600), ip)
    token = secrets.token_urlsafe(32)
    client = Client(id=uuid.uuid4(), token_hash=token_hash(token))
    async with svc.sessions() as db:
        db.add(client)
        await db.commit()
    return SessionOut(client_id=client.id, token=token)


@router.post("/session/link", response_model=LinkOut, status_code=201, responses=responses(401, 429),
             summary="A one-time code to use this client on another device")
async def link(client: Client = Depends(current_client), svc: Services = Depends(services)) -> LinkOut:
    """The code (192 random bits, URL-safe) is valid once, for 5 minutes. Another browser sends it to
    `POST /v1/session/claim` and gets its own token for this same client: the same saved routes and plans.
    Asking again gives a new code; earlier ones stay valid until they expire or are used."""
    s = svc.settings
    await ratelimit.hit(svc.redis, ratelimit.Limit("link", "client", s.rate_link_per_client_hour, 3600), str(client.id))
    code = secrets.token_urlsafe(24)
    await svc.redis.set(_link_key(code), str(client.id), ex=s.link_ttl_s)
    return LinkOut(code=code, expires_in_s=s.link_ttl_s)


@router.post("/session/claim", response_model=SessionOut, status_code=201, responses=responses(404, 429),
             summary="Join the client behind a link code")
async def claim(body: ClaimIn, ip: str = Depends(client_ip), svc: Services = Depends(services)) -> SessionOut:
    """Uses the code up (once only) and returns a new token for the client that asked for it. Needs no token.
    An unknown, expired or used code answers 404 `link_invalid`, the same in each case. Every attempt counts
    against a limit per IP."""
    await ratelimit.hit(svc.redis, ratelimit.Limit("claim", "ip", svc.settings.rate_claim_per_ip_min, 60), ip)
    raw = await svc.redis.getdel(_link_key(body.code))
    client_id = uuid.UUID(raw.decode() if isinstance(raw, bytes) else raw) if raw else None
    if client_id is not None:
        token = secrets.token_urlsafe(32)
        async with svc.sessions() as db:
            if await db.get(Client, client_id) is not None:
                db.add(ClientToken(token_hash=token_hash(token), client_id=client_id, label="linked"))
                await db.commit()
                return SessionOut(client_id=client_id, token=token)
    raise ApiError(404, "link_invalid", "This link code is not valid any more. Ask for a new one on your other "
                   "device.")
