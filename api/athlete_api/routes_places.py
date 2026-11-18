"""Place search and reverse lookup through Photon (Phase 4 amendment 8). See places.py for the rules."""

from fastapi import APIRouter, Depends, Query, Request

from .db import Client
from .deps import limited
from .errors import responses
from .examples import content
from .places import Photon
from .schemas import PlaceSearchOut, ReverseOut

router = APIRouter(prefix="/v1/places", tags=["places"])


def photon(request: Request) -> Photon:
    return request.app.state.photon


@router.get("/search", response_model=PlaceSearchOut,
            responses={200: content("places_kunnamangalam"), **responses(401, 422, 429, 503)},
            summary="Find places in Kerala (never picks one)")
async def search(q: str = Query(..., min_length=2, max_length=200, description="Place name, Latin script"),
                 lat: float | None = Query(None, ge=-90, le=90, description="Bias results towards this point"),
                 lon: float | None = Query(None, ge=-180, le=180),
                 limit: int = Query(10, ge=1, le=20),
                 client: Client = Depends(limited("read")), geo: Photon = Depends(photon)) -> PlaceSearchOut:
    """Kerala results in Photon's order. When `ambiguous` is true (names shared, also across districts or
    taluks, or no exact match), show every candidate in a picker. 503 `geocoder_unavailable` when Photon is
    down: no coordinates are taken from anywhere else."""
    return PlaceSearchOut(**await geo.search(q, lon, lat, limit))


@router.get("/reverse", response_model=ReverseOut, responses=responses(401, 422, 429, 503),
            summary="Name the place at a point")
async def reverse(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
                  client: Client = Depends(limited("read")), geo: Photon = Depends(photon)) -> ReverseOut:
    return ReverseOut(**await geo.reverse(lon, lat))
