"""Managing saved routes (blueprint Phase 5c amendments 1 to 6): list, rename or re-point, soft delete, restore.

Owner only: another client's saved_id, a deleted one (except to delete it again or restore it) and an unknown one
all answer the same 404, never 403. Routes and plan versions are never deleted here.
"""

import uuid

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import Client, Plan, PlanVersion, Route, SavedRoute
from .deps import Services, limited, services
from .errors import ApiError, responses
from .examples import content, examples
from .schemas import SavedOut, SavedPatch, SavedRouteOut

router = APIRouter(prefix="/v1/me/routes", tags=["saved routes"])


def saved_out(saved: SavedRoute, request: Request) -> dict:
    return dict(saved_id=saved.id, route_id=saved.route_id, name=saved.name, share_slug=saved.share_slug,
                share_url=str(request.url_for("get_shared", slug=saved.share_slug)), created_at=saved.created_at,
                updated_at=saved.updated_at)


def newest_saved(client_id: uuid.UUID, route_id: uuid.UUID):
    """The live saved route a save renames and a GPX takes its name from: several may point at one route."""
    return (select(SavedRoute)
            .where(SavedRoute.client_id == client_id, SavedRoute.route_id == route_id, SavedRoute.deleted_at.is_(None))
            .order_by(SavedRoute.updated_at.desc(), SavedRoute.id).limit(1))


async def _own(db: AsyncSession, saved_id: uuid.UUID, client_id: uuid.UUID, *, deleted_too: bool = False) -> SavedRoute:
    query = select(SavedRoute).where(SavedRoute.id == saved_id, SavedRoute.client_id == client_id)
    if not deleted_too:
        query = query.where(SavedRoute.deleted_at.is_(None))
    saved = (await db.execute(query.with_for_update())).scalar_one_or_none()
    if saved is None:
        raise ApiError(404, "not_found", f"No saved route {saved_id} for this client.")
    return saved


@router.get("", response_model=list[SavedRouteOut], responses={200: content("my_routes_A01"), **responses(401, 429)},
            summary="This client's saved routes")
async def my_routes(request: Request, client: Client = Depends(limited("read")),
                    svc: Services = Depends(services)) -> list[SavedRouteOut]:
    """Deleted ones are left out. The most recently renamed or updated first."""
    async with svc.sessions() as db:
        rows = (await db.execute(
            select(SavedRoute, Route, PlanVersion).join(Route, SavedRoute.route_id == Route.id)
            .join(PlanVersion, Route.plan_version_id == PlanVersion.id)
            .where(SavedRoute.client_id == client.id, SavedRoute.deleted_at.is_(None))
            .order_by(SavedRoute.updated_at.desc(), SavedRoute.id))).all()
    return [SavedRouteOut(**saved_out(s, request), plan_id=v.plan_id, version=v.version_no, plan_version=v.version_no,
                          label=r.label, option=r.option, foot_m=r.foot_m, end_label=r.end_label) for s, r, v in rows]


@router.patch("/{saved_id}", response_model=SavedOut,
              responses={200: content("saved_renamed_A01"), **responses(401, 404, 422, 429)},
              openapi_extra={"requestBody": {"content": {"application/json": {
                  "examples": examples("saved_rename", "saved_repoint")}}}},
              summary="Rename a saved route, or point it at another route")
async def patch_saved(saved_id: uuid.UUID, body: SavedPatch, request: Request,
                      client: Client = Depends(limited("write")), svc: Services = Depends(services)) -> SavedOut:
    """Only the fields sent change. `name` is trimmed, at most 80 characters, empty becomes null. `route_id` must
    be a route of this client's (else 404); the share slug, the name and created_at stay, and the share link then
    shows the new route. Either change sets updated_at."""
    async with svc.sessions() as db, db.begin():
        saved = await _own(db, saved_id, client.id)
        if body.route_id is not None:
            owned = (await db.execute(
                select(Route.id).join(PlanVersion, Route.plan_version_id == PlanVersion.id)
                .join(Plan, PlanVersion.plan_id == Plan.id)
                .where(Route.id == body.route_id, Plan.client_id == client.id))).scalar_one_or_none()
            if owned is None:
                raise ApiError(404, "not_found", f"No route {body.route_id} for this client.")
            saved.route_id = owned
        if "name" in body.model_fields_set:
            saved.name = body.name
        if body.model_fields_set:
            saved.updated_at = func.now()
        await db.flush()
        await db.refresh(saved)
        return SavedOut(**saved_out(saved, request))


@router.delete("/{saved_id}", status_code=204, response_class=Response, responses=responses(401, 404, 429),
               summary="Delete a saved route (it can be restored)")
async def delete_saved(saved_id: uuid.UUID, client: Client = Depends(limited("write")),
                       svc: Services = Depends(services)) -> Response:
    """A soft delete: the route leaves the list and its share link answers 404 until it is restored. Deleting again
    is 204 too, until the row is purged (athlete_api.purge_deleted); after that it is 404."""
    async with svc.sessions() as db, db.begin():
        saved = await _own(db, saved_id, client.id, deleted_too=True)
        if saved.deleted_at is None:
            saved.deleted_at = func.now()
    return Response(status_code=204)


@router.post("/{saved_id}/restore", response_model=SavedOut,
             responses={200: content("saved_A01"), **responses(401, 404, 429)}, summary="Undo a delete")
async def restore_saved(saved_id: uuid.UUID, request: Request, client: Client = Depends(limited("write")),
                        svc: Services = Depends(services)) -> SavedOut:
    """Back in the list where it was, with its share link working again. 404 once it has been purged."""
    async with svc.sessions() as db, db.begin():
        saved = await _own(db, saved_id, client.id, deleted_too=True)
        saved.deleted_at = None
        await db.flush()
        await db.refresh(saved)
        return SavedOut(**saved_out(saved, request))
