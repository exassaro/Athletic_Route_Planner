"""Plans: create, edit (JSON Patch), read, read a version (blueprint section 12)."""

import uuid
from typing import Any

import jsonpatch
import jsonpointer
from athlete_solver.models import RouteRequest
from fastapi import APIRouter, Body, Depends, Header, Path, Query, Request, Response
from pydantic import ValidationError

from .db import Client
from .deps import limited
from .errors import ApiError, responses
from .examples import content, examples, plan_wrapped
from .planning import Planner
from .schemas import PlanCreate, PlanOut, PlanVersionOut, Source

router = APIRouter(prefix="/v1/plans", tags=["plans"])


def planner(request: Request) -> Planner:
    return request.app.state.planner


@router.post("", response_model=PlanVersionOut, status_code=201,
             responses={201: content("plan_A01", "plan_S11", "plan_S02", "plan_G01"),
                        **responses(401, 422, 429, 500, 502, 503, 504)}, summary="Create a plan from a route request")
async def create_plan(body: PlanCreate = Body(openapi_examples=examples("request_A01", "request_S11", "request_S02",
                                                                        "request_G01")),
                      client: Client = Depends(limited("solve")),
                      plans: Planner = Depends(planner)) -> PlanVersionOut:
    """Solves the request and stores it as version 1.

    Lengths are the solver's measurements from route geometry. `duration_s` is the engine's walking time.
    429 `solver_busy`: no solve slot within 10 s (see Retry-After). 504 `solve_timeout`: over the 15 s budget; the
    solve carries on and the version appears at `GET /v1/plans/{id}` (the id is in the error's detail).
    """
    plan_id = await plans.new_plan(client.id)
    return as_json(await plans.solve_into(plan_id, body.request, body.source), 201)


@router.patch("/{plan_id}", response_model=PlanVersionOut,
              responses={200: content("plan_A01_20km"), **responses(401, 404, 409, 412, 422, 429, 500, 502, 503, 504)},
              summary="Edit the request with a JSON Patch and re-solve")
async def patch_plan(plan_id: uuid.UUID,
                     ops: list[dict[str, Any]] = Body(..., media_type="application/json-patch+json",
                                                      openapi_examples=examples("patch_distance", "patch_undo")),
                     source: Source = Query("form", description="Where the edit came from"),
                     from_version: int | None = Query(None, ge=1, description="The version this edit applies to, "
                                                      "for editing one that is not the latest (Phase 5c A11). "
                                                      "Default: the latest"),
                     if_match: str | None = Header(None, description='Optional: "v<n>", the version this edit is '
                                                                     "based on; 412 if a newer one exists"),
                     client: Client = Depends(limited("solve")),
                     plans: Planner = Depends(planner)) -> PlanVersionOut:
    """Applies an RFC 6902 patch to a version's RouteRequest (the latest, or `from_version`), validates it,
    re-solves and stores the next version, with a diff against the version patched.

    The request it applies to is the stored one, with every default filled in (see that version's `request`).
    If-Match, when sent, always names the latest version. Undo: `[{"op": "replace", "path": "", "value": <an earlier version's request>}]`.
    409 `patch_test_failed` when a `test` operation fails; 409 `plan_solving` while a solve for this plan is
    still running; 422 `invalid_patch` when the patch cannot be applied, `invalid_request` when the result is
    not a valid RouteRequest.
    """
    await plans.owned_plan(plan_id, client.id)
    if plan_id in plans.pending:
        raise ApiError(409, "plan_solving", "A solve for this plan is still running. Try again when it is done.",
                       {"poll": f"/v1/plans/{plan_id}"})
    latest, base = await plans.latest_request(plan_id)
    if latest == 0:
        raise ApiError(409, "plan_solving", "This plan has no version to edit yet.", {"poll": f"/v1/plans/{plan_id}"})
    if if_match is not None and if_match.strip().strip('"').lstrip("W/").strip('"') != f"v{latest}":
        raise ApiError(412, "version_mismatch", f"The latest version is v{latest}.",
                       {"latest": latest, "if_match": if_match})
    if from_version is not None:
        base = await plans.version_request(plan_id, from_version)
    request = apply_patch(base, ops)
    return as_json(await plans.solve_into(plan_id, request, source, from_version), 200)


def as_json(out: PlanVersionOut, status: int) -> Response:
    """Serialise once: the version is built from validated solver models, so FastAPI's second validation of a
    large response is skipped (the response_model above still documents it)."""
    return Response(content=out.model_dump_json(), media_type="application/json", status_code=status)


def apply_patch(base: dict, ops: list[dict[str, Any]]) -> RouteRequest:
    try:
        patched = jsonpatch.JsonPatch(ops).apply(base)
    except jsonpatch.JsonPatchTestFailed as err:
        raise ApiError(409, "patch_test_failed", f"A test operation failed: {err}") from None
    except (jsonpatch.JsonPatchException, jsonpointer.JsonPointerException, TypeError, KeyError) as err:
        raise ApiError(422, "invalid_patch", f"The patch cannot be applied: {err}") from None
    try:
        return RouteRequest.model_validate(patched)
    except ValidationError as err:
        detail = [{k: v for k, v in e.items() if k in ("loc", "msg", "type")} for e in err.errors()]
        raise ApiError(422, "invalid_request", "The patched request is not valid.", detail) from None


@router.get("/{plan_id}", response_model=PlanOut,
            responses={200: {"content": {"application/json": {"examples": {"plan_A01": plan_wrapped("plan_A01")}}}},
                       **responses(401, 404, 429)}, summary="A plan's latest version")
async def get_plan(plan_id: uuid.UUID, client: Client = Depends(limited("read")),
                   plans: Planner = Depends(planner)) -> PlanOut:
    """The latest version, every version number, and `status`: `solving` while a solve for it is running,
    `failed` if the last one failed (with the error), else `ready`."""
    await plans.owned_plan(plan_id, client.id)
    return await plans.plan_out(plan_id)


@router.get("/{plan_id}/versions/{n}", response_model=PlanVersionOut,
            responses={200: content("plan_A01_20km"), **responses(401, 404, 429)},
            summary="Any version of a plan")
async def get_version(plan_id: uuid.UUID, n: int = Path(ge=1), client: Client = Depends(limited("read")),
                      plans: Planner = Depends(planner)) -> PlanVersionOut:
    await plans.owned_plan(plan_id, client.id)
    return await plans.version_out(plan_id, n)
