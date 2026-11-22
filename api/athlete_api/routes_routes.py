"""Routes: GeoJSON, elevation, GPX, save; public share (blueprint section 12). Managing saved routes is
routes_saved.

A route is readable by the client that owns its plan; anyone else gets 404. Share slugs are public and
read-only, rate-limited per IP. A soft-deleted slug answers exactly as an unknown one (Phase 5c amendment 1).
"""

import re
import secrets
import uuid

from athlete_engine import geodesy
from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import func, select

from . import explain, gpx, ratelimit
from .db import Client, Plan, PlanVersion, Route, SavedRoute
from .deps import Services, client_id_if_known, client_ip, limited, services
from .elevation import PROFILE_STEP_M, climb_approximate, smoothed
from .errors import ApiError, responses
from .examples import content
from .overviewing import OverviewService
from .routes_saved import newest_saved, saved_out
from .schemas import (ElevationOut, KmMark, LineStringZ, OverviewPointsOut, RouteFeature, SavedOut, SaveIn,
                      SharedRouteOut)
from .store import candidate_of, geometry_of

router = APIRouter(prefix="/v1", tags=["routes"])
GPX_TYPE = "application/gpx+xml"
# A deleted link must stop working at once and work again after Undo (a 404 is cacheable too).
NO_STORE = {"Cache-Control": "no-store"}
ELE = Query(True, description="Include each track point's DEM height as <ele>. false: leave it out, so the "
                               "importing app uses its own elevation data")
MAX_POINTS = Query(..., alias="max", ge=1, le=9,
                   description="At most this many waypoints: Google takes 3 in a mobile browser and 9 elsewhere")


def overviews(request: Request) -> OverviewService:
    return request.app.state.overview


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
    props.update(route_id=str(route.id), plan_id=str(version.plan_id), version=version.version_no,
                 climb_approximate=climb_approximate(route.elevation))   # Phase 5 amendment 15
    return RouteFeature(id=route.id, properties=props,
                        geometry=LineStringZ(coordinates=[(lon, lat, z) for (lon, lat), z in zip(geometry, heights)]))


def gpx_response(route: Route, title: str | None, ele: bool = True) -> Response:
    cand = candidate_of(route)
    _, heights = geometry_of(route)
    body = gpx.build(cand, heights, title=title, ele=ele)
    slug = re.sub(r"[^a-z0-9]+", "-", gpx.course_name(cand, title).lower()).strip("-")
    return Response(content=body, media_type=GPX_TYPE,
                    headers={"Content-Disposition": f'attachment; filename="{slug or "route"}.gpx"'})


def summary(route: Route) -> str:
    cand = candidate_of(route)
    return " ".join([explain.describe(cand), *explain.notes(cand)])


@router.get("/routes/{route_id}", response_model=RouteFeature,
            responses={200: content("route_A01"), **responses(401, 404, 429)},
            summary="One route as GeoJSON")
async def get_route(route_id: uuid.UUID, client: Client = Depends(limited("read")),
                    svc: Services = Depends(services)) -> RouteFeature:
    route, version = await _owned(svc, route_id, client.id)
    return feature(route, version)


@router.get("/routes/{route_id}/elevation", response_model=ElevationOut,
            responses={200: content("elevation_A01"), **responses(401, 404, 429)},
            summary="Elevation profile")
async def get_elevation(route_id: uuid.UUID, client: Client = Depends(limited("read")),
                        svc: Services = Depends(services)) -> ElevationOut:
    route, _ = await _owned(svc, route_id, client.id)
    return elevation_out(route)


def km_marks(geometry: list) -> list[KmMark]:
    """Where each whole kilometre lies on the stored geometry, the end excluded: the elevation response's
    (Phase 5 A5) and the share response's (Phase 5b A9)."""
    samples = geodesy.sample_every(geometry, 1000.0)
    total = samples[-1][1]
    return [KmMark(km=round(d / 1000.0), at_m=round(d, 1), lon=round(pt[0], 7), lat=round(pt[1], 7))
            for pt, d in samples[1:] if 0.0 < d < total]


def elevation_out(route: Route) -> ElevationOut:
    """The stored profile, plus where each sample and each whole kilometre lies (Phase 5 A5).

    Positions come from sampling the stored geometry again with the same function and step, so they line up
    with the stored distances (checked). Positions are rounded to 7 decimals (about 1 cm). The front end never
    measures the geometry."""
    geometry, _ = geometry_of(route)
    profile = [tuple(p) for p in route.elevation or []]
    samples = geodesy.sample_every(geometry, PROFILE_STEP_M)
    if len(samples) != len(profile) or any(abs(round(d, 1) - p[0]) > 0.05 for (_, d), p in zip(samples, profile)):
        raise ApiError(500, "profile_mismatch", "The stored profile does not match the route geometry.")
    return ElevationOut(route_id=route.id, step_m=PROFILE_STEP_M, profile=profile,
                        points=[(round(pt[0], 7), round(pt[1], 7)) for pt, _ in samples],
                        km_marks=km_marks(geometry),
                        smoothed=smoothed(route.elevation, route.bridges_m),
                        climb_approximate=climb_approximate(route.elevation),
                        gain_m=route.gain_m, loss_m=route.loss_m)


@router.get("/routes/{route_id}/overview-points", response_model=OverviewPointsOut,
            responses=responses(401, 404, 422, 429, 503), summary="Waypoints for a Google Maps overview link")
async def get_overview_points(route_id: uuid.UUID, limit: int = MAX_POINTS, client: Client = Depends(limited("read")),
                              svc: Services = Depends(services),
                              over: OverviewService = Depends(overviews)) -> OverviewPointsOut:
    """The points that keep a walking link closest to this route, and how close that is with Valhalla standing in
    for Google (Phase 5d A14). An overview: the exact route is the GPX. 503 when Valhalla can't answer: use evenly
    spaced km marks and show no estimate."""
    route, _ = await _owned(svc, route_id, client.id)
    return await over.get(route.id, geometry_of(route)[0], limit)


@router.get("/routes/{route_id}/gpx", response_class=Response, responses={
    200: {"content": {GPX_TYPE: {}}, "description": "GPX 1.1 course"}, **responses(401, 404, 429)},
    summary="GPX 1.1 course")
async def get_gpx(route_id: uuid.UUID, ele: bool = ELE, client: Client = Depends(limited("read")),
                  svc: Services = Depends(services)) -> Response:
    """A track with elevation and waypoints for the start, each checkpoint and the end. No timestamps: import
    it as a course (Garmin Connect) or a route (Strava)."""
    route, _ = await _owned(svc, route_id, client.id)
    async with svc.sessions() as db:
        saved = (await db.execute(newest_saved(client.id, route.id))).scalar_one_or_none()
    return gpx_response(route, saved.name if saved else None, ele)


@router.post("/routes/{route_id}/save", response_model=SavedOut, status_code=201,
             responses={201: content("saved_A01"), 200: {"model": SavedOut, "description": "Already saved: name updated"},
                        **responses(401, 404, 422, 429)}, summary="Save a route and get its share link")
async def save_route(route_id: uuid.UUID, request: Request, response: Response, body: SaveIn | None = None,
                     client: Client = Depends(limited("write")), svc: Services = Depends(services)) -> SavedOut:
    """Saving the same route again updates the name of its most recently updated saved route and keeps that slug
    (200). `as_new`: always another saved route with its own slug (201). A deleted one is never revived."""
    route, _ = await _owned(svc, route_id, client.id)
    body = body or SaveIn()
    async with svc.sessions() as db:
        saved = None
        if not body.as_new:
            saved = (await db.execute(newest_saved(client.id, route.id).with_for_update())).scalar_one_or_none()
        if saved is None:
            saved = SavedRoute(id=uuid.uuid4(), client_id=client.id, route_id=route.id, name=body.name,
                               share_slug=secrets.token_urlsafe(9))
            db.add(saved)
        else:
            saved.name = body.name
            saved.updated_at = func.now()
            response.status_code = 200
        await db.commit()
        await db.refresh(saved)
    return SavedOut(**saved_out(saved, request))


async def _shared(svc: Services, slug: str, ip: str) -> tuple[SavedRoute, Route, PlanVersion]:
    await ratelimit.hit(svc.redis, ratelimit.Limit("share", "ip", svc.settings.rate_read_per_client_min, 60), ip)
    async with svc.sessions() as db:
        row = (await db.execute(
            select(SavedRoute, Route, PlanVersion).join(Route, SavedRoute.route_id == Route.id)
            .join(PlanVersion, Route.plan_version_id == PlanVersion.id)
            .where(SavedRoute.share_slug == slug, SavedRoute.deleted_at.is_(None)))).first()
    if row is None:
        raise ApiError(404, "not_found", "No shared route with this link.", headers=NO_STORE)
    return row[0], row[1], row[2]


@router.get("/share/{slug}", response_model=SharedRouteOut,
            responses={200: content("share_A01"), **responses(404, 429)}, tags=["share"],
            summary="A shared route (public, no token)")
async def get_shared(slug: str, request: Request, response: Response, ip: str = Depends(client_ip),
                     viewer: uuid.UUID | None = Depends(client_id_if_known),
                     svc: Services = Depends(services)) -> SharedRouteOut:
    """Public. With the owner's token `is_owner` is true; with none, or any other, false (never 401). A deleted
    link answers 404 exactly as an unknown one."""
    response.headers.update(NO_STORE)
    saved, route, version = await _shared(svc, slug, ip)
    feat = feature(route, version)
    feat.properties.pop("plan_id", None)        # the plan stays private
    return SharedRouteOut(name=saved.name, shared_at=saved.created_at, updated_at=saved.updated_at,
                          is_owner=viewer is not None and viewer == saved.client_id, summary=summary(route), route=feat,
                          km_marks=km_marks(geometry_of(route)[0]),
                          gpx_url=str(request.url_for("get_shared_gpx", slug=slug)))


@router.get("/share/{slug}/gpx", response_class=Response, responses={
    200: {"content": {GPX_TYPE: {}}, "description": "GPX 1.1 course"}, **responses(404, 429)}, tags=["share"],
    summary="A shared route as GPX (public, no token)")
async def get_shared_gpx(slug: str, ele: bool = ELE, ip: str = Depends(client_ip),
                         svc: Services = Depends(services)) -> Response:
    saved, route, _ = await _shared(svc, slug, ip)
    resp = gpx_response(route, saved.name, ele)
    resp.headers.update(NO_STORE)
    return resp


@router.get("/share/{slug}/overview-points", response_model=OverviewPointsOut,
            responses=responses(404, 422, 429, 503), tags=["share"],
            summary="Waypoints for a shared route's Google Maps overview link (public, no token)")
async def get_shared_overview_points(slug: str, response: Response, limit: int = MAX_POINTS,
                                     ip: str = Depends(client_ip), svc: Services = Depends(services),
                                     over: OverviewService = Depends(overviews)) -> OverviewPointsOut:
    """As the owner's, without a token. A deleted link answers 404 exactly as an unknown one, cached or not."""
    response.headers.update(NO_STORE)
    _, route, _ = await _shared(svc, slug, ip)
    return await over.get(route.id, geometry_of(route)[0], limit)
