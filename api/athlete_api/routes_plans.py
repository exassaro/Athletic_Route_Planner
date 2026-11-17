"""Plans: create, read, read a version (blueprint section 12). PATCH comes in step 6."""

import uuid

from fastapi import APIRouter, Depends, Path, Request

from .db import Client
from .deps import limited
from .errors import responses
from .planning import Planner
from .schemas import PlanCreate, PlanOut, PlanVersionOut

router = APIRouter(prefix="/v1/plans", tags=["plans"])


def planner(request: Request) -> Planner:
    return request.app.state.planner


@router.post("", response_model=PlanVersionOut, status_code=201,
             responses=responses(401, 422, 429, 500, 502, 503, 504), summary="Create a plan from a route request")
async def create_plan(body: PlanCreate, client: Client = Depends(limited("solve")),
                      plans: Planner = Depends(planner)) -> PlanVersionOut:
    """Solves the request and stores it as version 1.

    Lengths are the solver's measurements from route geometry. `duration_s` is the engine's walking time.
    429 `solver_busy`: no solve slot within 10 s (see Retry-After). 504 `solve_timeout`: over the 15 s budget; the
    solve carries on and the version appears at `GET /v1/plans/{id}` (the id is in the error's detail).
    """
    plan_id = await plans.new_plan(client.id)
    return await plans.solve_into(plan_id, body.request, body.source)


@router.get("/{plan_id}", response_model=PlanOut, responses=responses(401, 404, 429), summary="A plan's latest version")
async def get_plan(plan_id: uuid.UUID, client: Client = Depends(limited("read")),
                   plans: Planner = Depends(planner)) -> PlanOut:
    """The latest version, every version number, and `status`: `solving` while a solve for it is running,
    `failed` if the last one failed (with the error), else `ready`."""
    await plans.owned_plan(plan_id, client.id)
    return await plans.plan_out(plan_id)


@router.get("/{plan_id}/versions/{n}", response_model=PlanVersionOut, responses=responses(401, 404, 429),
            summary="Any version of a plan")
async def get_version(plan_id: uuid.UUID, n: int = Path(ge=1), client: Client = Depends(limited("read")),
                      plans: Planner = Depends(planner)) -> PlanVersionOut:
    await plans.owned_plan(plan_id, client.id)
    return await plans.version_out(plan_id, n)
