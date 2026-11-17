"""POST /v1/session: an anonymous client token (Phase 4 amendment 7)."""

import secrets
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import ratelimit
from .db import Client
from .deps import TOKEN_HEADER, Services, client_ip, services, token_hash
from .errors import responses

router = APIRouter(prefix="/v1", tags=["session"])


class SessionOut(BaseModel):
    client_id: uuid.UUID
    token: str
    header: str = TOKEN_HEADER


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
