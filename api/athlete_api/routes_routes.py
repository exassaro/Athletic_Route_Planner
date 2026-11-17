"""Routes: GeoJSON, elevation, GPX, save; saved routes; public share (blueprint section 12).

A route is readable by the client that owns its plan; anyone else gets 404. Share slugs are public and
read-only, rate-limited per IP.
"""

import re
import secrets
import uuid

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select

from . import explain, gpx, ratelimit
from .db import Client, Plan, PlanVersion, Route, SavedRoute
from .deps import Services, client_ip, limited, services
from .errors import ApiError, responses
from .schemas import ElevationOut, LineStringZ, RouteFeature, SavedOut, SavedRouteOut, SaveIn, SharedRouteOut
from .store import candidate_of, geometry_of

router = APIRouter(prefix="/v1", tags=["routes"])
GPX_TYPE = "application/gpx+xml"


async def _owned(svc: Services, route_id: uuid.UUID, client_id: uuid.UUID) -> tuple[Route, PlanVersion]:
    async with svc.sessions() as db:
        row = (await db.execute(
            select(Route, PlanVersion).join(PlanVersion, Route.plan_version_id == PlanVersion.id)
            .join(Plan, PlanVersion.plan_id == Plan.id)
            .where(Route.id == route_id, Plan.client_id == client_id))).first()
    if row is None:
        raise ApiError(404, "not_found", f"No route {route_id} for this client.")
    return row[0], row[1]


def feature(route: Route, version: PlanVersion) -> RouteFeature:
    geometry, heights = geometry_of(route)
    props = candidate_of(route).model_dump(mode="json", exclude={"geometry", "edge_ids"})
    props.update(route_id=str(route.id), plan_id=str(version.plan_id), version=version.version_no)
    return RouteFeature(id=route.id, properties=props,
                        geometry=LineStringZ(coordinates=[(lon, lat, z) for (lon, lat), z in zip(geometry, heights)]))


def gpx_response(route: Route, title: str | None) -> Response:
    cand = candidate_of(route)
    _, heights = geometry_of(route)
    body = gpx.build(cand, heights, title=title)
    slug = re.sub(r"[^a-z0-9]+", "-", gpx.course_name(cand, title).lower()).strip("-")
    return Response(content=body, media_type=GPX_TYPE,
                    headers={"Content-Disposition": f'attachment; filename="{slug or "route"}.gpx"'})


def summary(route: Route) -> str:
    cand = candidate_of(route)
    return " ".join([explain.describe(cand), *explain.notes(cand)])


@router.get("/routes/{route_id}", response_model=RouteFeature, responses=responses(401, 404, 429),
            summary="One route as GeoJSON")
async def get_route(route_id: uuid.UUID, client: Client = Depends(limited("read")),
                    svc: Services = Depends(services)) -> RouteFeature:
    route, version = await _owned(svc, route_id, client.id)
    return feature(route, version)


@router.get("/routes/{route_id}/elevation", response_model=ElevationOut, responses=responses(401, 404, 429),
            summary="Elevation profile")
async def get_elevation(route_id: uuid.UUID, client: Client = Depends(limited("read")),
                        svc: Services = Depends(services)) -> ElevationOut:
    route, _ = await _owned(svc, route_id, client.id)
    return ElevationOut(route_id=route.id, step_m=30.0, profile=[tuple(p) for p in route.elevation or []],
                        gain_m=route.gain_m, loss_m=route.loss_m)


@router.get("/routes/{route_id}/gpx", response_class=Response, responses={
    200: {"content": {GPX_TYPE: {}}, "description": "GPX 1.1 course"}, **responses(401, 404, 429)},
    summary="GPX 1.1 course")
async def get_gpx(route_id: uuid.UUID, client: Client = Depends(limited("read")),
                  svc: Services = Depends(services)) -> Response:
    """A track with elevation and waypoints for the start, each checkpoint and the end. No timestamps: import
    it as a course (Garmin Connect) or a route (Strava)."""
    route, _ = await _owned(svc, route_id, client.id)
    async with svc.sessions() as db:
        name = (await db.execute(select(SavedRoute.name).where(SavedRoute.route_id == route.id,
                                                               SavedRoute.client_id == client.id))).scalar()
    return gpx_response(route, name)


def _saved_out(saved: SavedRoute, request: Request) -> dict:
    return dict(saved_id=saved.id, route_id=saved.route_id, name=saved.name, share_slug=saved.share_slug,
                share_url=str(request.url_for("get_shared", slug=saved.share_slug)), created_at=saved.created_at)


@router.post("/routes/{route_id}/save", response_model=SavedOut, status_code=201,
             responses={200: {"model": SavedOut, "description": "Already saved: name updated"},
                        **responses(401, 404, 422, 429)}, summary="Save a route and get its share link")
async def save_route(route_id: uuid.UUID, request: Request, response: Response, body: SaveIn | None = None,
                     client: Client = Depends(limited("read")), svc: Services = Depends(services)) -> SavedOut:
    """Saving the same route again updates its name and keeps its share slug (200)."""
    route, _ = await _owned(svc, route_id, client.id)
    body = body or SaveIn()
    async with svc.sessions() as db:
        saved = (await db.execute(select(SavedRoute).where(SavedRoute.route_id == route.id,
                                                           SavedRoute.client_id == client.id))).scalar_one_or_none()
        if saved is None:
            saved = SavedRoute(id=uuid.uuid4(), client_id=client.id, route_id=route.id, name=body.name,
                               share_slug=secrets.token_urlsafe(9))
            db.add(saved)
        else:
            saved.name = body.name
            response.status_code = 200
        await db.commit()
        await db.refresh(saved)
    return SavedOut(**_saved_out(saved, request))


@router.get("/me/routes", response_model=list[SavedRouteOut], responses=responses(401, 429),
            summary="This client's saved routes")
async def my_routes(request: Request, client: Client = Depends(limited("read")),
                    svc: Services = Depends(services)) -> list[SavedRouteOut]:
    async with svc.sessions() as db:
        rows = (await db.execute(
            select(SavedRoute, Route, PlanVersion).join(Route, SavedRoute.route_id == Route.id)
            .join(PlanVersion, Route.plan_version_id == PlanVersion.id)
            .where(SavedRoute.client_id == client.id).order_by(SavedRoute.created_at.desc()))).all()
    return [SavedRouteOut(**_saved_out(s, request), plan_id=v.plan_id, version=v.version_no, label=r.label,
                          option=r.option, foot_m=r.foot_m, end_label=r.end_label) for s, r, v in rows]


async def _shared(svc: Services, slug: str, ip: str) -> tuple[SavedRoute, Route, PlanVersion]:
    await ratelimit.hit(svc.redis, ratelimit.Limit("share", "ip", svc.settings.rate_read_per_client_min, 60), ip)
    async with svc.sessions() as db:
        row = (await db.execute(
            select(SavedRoute, Route, PlanVersion).join(Route, SavedRoute.route_id == Route.id)
            .join(PlanVersion, Route.plan_version_id == PlanVersion.id)
            .where(SavedRoute.share_slug == slug))).first()
    if row is None:
        raise ApiError(404, "not_found", "No shared route with this link.")
    return row[0], row[1], row[2]


@router.get("/share/{slug}", response_model=SharedRouteOut, responses=responses(404, 429), tags=["share"],
            summary="A shared route (public, no token)")
async def get_shared(slug: str, request: Request, ip: str = Depends(client_ip),
                     svc: Services = Depends(services)) -> SharedRouteOut:
    saved, route, version = await _shared(svc, slug, ip)
    feat = feature(route, version)
    feat.properties.pop("plan_id", None)        # the plan stays private
    return SharedRouteOut(name=saved.name, shared_at=saved.created_at, summary=summary(route), route=feat,
                          gpx_url=str(request.url_for("get_shared_gpx", slug=slug)))


@router.get("/share/{slug}/gpx", response_class=Response, responses={
    200: {"content": {GPX_TYPE: {}}, "description": "GPX 1.1 course"}, **responses(404, 429)}, tags=["share"],
    summary="A shared route as GPX (public, no token)")
async def get_shared_gpx(slug: str, ip: str = Depends(client_ip), svc: Services = Depends(services)) -> Response:
    saved, route, _ = await _shared(svc, slug, ip)
    return gpx_response(route, saved.name)
