"""Request items from the pinned extract's OSM ways and boundaries (blueprint Phase 5 amendment 7, A6).

See osm_features.py for the rules. Both endpoints read Postgres only (no engine, no Photon).
"""

from fastapi import APIRouter, Depends, Query

from . import osm_features
from .db import Client
from .deps import Services, limited, services
from .errors import responses
from .schemas import FeatureItemOut, NearbyOut, NearbyWay

router = APIRouter(prefix="/v1/features", tags=["places"])


@router.get("/item", response_model=FeatureItemOut, responses=responses(401, 404, 422, 429, 503),
            summary="A request item (checkpoint, via, must-use, avoid) for an OSM place or way")
async def item(place_id: str = Query(..., description='"osm:node/N", "osm:way/N" or "osm:relation/N" (Photon '
                                                      "results, or /v1/features/nearby)"),
               role: osm_features.Role = Query(..., description="Which request list the item is for"),
               kind: osm_features.Kind = Query("place", description="place: a point (pass-near or reach); bridge: "
                                                                     "the way itself; road: the named road it "
                                                                     "belongs to"),
               lon: float | None = Query(None, ge=-180, le=180, description="A place's point (from the search)"),
               lat: float | None = Query(None, ge=-90, le=90),
               label: str | None = Query(None, max_length=200, description="Name to show; default the OSM name"),
               must_reach: bool = Query(False, description="Checkpoint must be reached (no boundary fallback)"),
               radius_m: float = Query(300.0, gt=0, le=5000, description="Avoided place: circle radius"),
               client: Client = Depends(limited("read")), svc: Services = Depends(services)) -> FeatureItemOut:
    """Builds the item with the fixtures' rules: a pass-near checkpoint carries its own OSM boundary (the
    fallback), a bridge its way, a road all its connected ways with that name. 503 `osm_features_missing` when
    the tables are not loaded."""
    async with svc.sessions() as db:
        stamp = await osm_features.extract(db)
        built = await osm_features.build_item(db, role, kind, place_id, lon, lat, label, must_reach, radius_m)
    return FeatureItemOut(role=role, extract=stamp, **{role: built})


@router.get("/nearby", response_model=NearbyOut, responses=responses(401, 422, 429, 503),
            summary="Bridges and roads near a point (tap to pick)")
async def nearby(lon: float = Query(..., ge=-180, le=180), lat: float = Query(..., ge=-90, le=90),
                 radius_m: float = Query(40.0, gt=0, le=200), limit: int = Query(8, ge=1, le=20),
                 client: Client = Depends(limited("read")), svc: Services = Depends(services)) -> NearbyOut:
    """Highway ways within `radius_m` of the point, nearest first, for a picker. The straight-line distance only
    orders them; it is not returned."""
    async with svc.sessions() as db:
        stamp = await osm_features.extract(db)
        ways = await osm_features.nearby(db, lon, lat, radius_m, limit)
    return NearbyOut(ways=[NearbyWay(**w) for w in ways], extract=stamp)
