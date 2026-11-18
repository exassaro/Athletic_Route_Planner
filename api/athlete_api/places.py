"""Place search and reverse lookup through Photon, Kerala only (Phase 4 amendments 8 and 17).

- Results are biased to a given point (Photon's lat/lon), in English (Latin script, Phase 2 amendment 4).
- Kerala only: Photon's bbox pre-filter on the pinned extract's own bounding box (as GraphHopper's /info
  reported it on 2026-11-18), then only results whose `state` is "Kerala". A result without a state is dropped.
- Never picks: every result is returned, ranked as Photon ranked it. `ambiguous` is true, with reasons, when
  results share a name (also across districts or taluks: Photon's `county` holds either), or when there are
  several results and none is named exactly as asked. Photon returns no score, so "close in score" cannot be
  measured; this name rule is the whole test.
- Photon down: 503 geocoder_unavailable. Coordinates are never taken from anywhere else (no cache, no fallback).
Coordinates in results are Photon's, which come from OSM, with the OSM id as place_id ("osm:node/123").
"""

import re
import unicodedata
from typing import Any

import httpx

from .errors import ApiError

# The pinned Kerala extract's bounding box (min lon, min lat, max lon, max lat), as GraphHopper's /info
# reported it for the graph imported from engine/osm_pin.json (2026-11-18). A pre-filter only.
KERALA_BBOX = (72.192418, 8.269256, 77.413636, 12.859547)
STATE = "Kerala"
OSM_TYPES = {"N": "node", "W": "way", "R": "relation"}


def search_params(q: str, lon: float | None, lat: float | None, limit: int) -> dict[str, Any]:
    params: dict[str, Any] = {"q": q, "limit": limit, "lang": "en", "bbox": ",".join(str(v) for v in KERALA_BBOX)}
    if lon is not None and lat is not None:
        params.update(lon=lon, lat=lat)
    return params


def normalise(name: str | None) -> str:
    text = unicodedata.normalize("NFKC", name or "").casefold()
    return re.sub(r"[\W_]+", " ", text).strip()


def place(feature: dict) -> dict | None:
    """A Photon feature as the API's place, or None if it is not in Kerala."""
    p = feature.get("properties", {})
    if p.get("state") != STATE or not p.get("name"):
        return None
    lon, lat = feature["geometry"]["coordinates"][:2]
    osm_type = OSM_TYPES.get(p.get("osm_type"), "unknown")
    return {
        "place_id": f"osm:{osm_type}/{p.get('osm_id')}", "label": p["name"],
        "kind": f"{p.get('osm_key')}={p.get('osm_value')}", "county": p.get("county"), "city": p.get("city"),
        "street": p.get("street"), "state": p.get("state"), "lon": lon, "lat": lat,
        "extent": p.get("extent"),
    }


def ambiguity(query: str, places: list[dict]) -> tuple[bool, list[dict]]:
    reasons = []
    groups: dict[str, list[dict]] = {}
    for pl in places:
        groups.setdefault(normalise(pl["label"]), []).append(pl)
    for members in groups.values():
        if len(members) > 1:
            counties = sorted({m["county"] or "unknown" for m in members})
            reasons.append({"reason": "same_name_different_areas" if len(counties) > 1 else "same_name",
                            "name": members[0]["label"], "count": len(members), "counties": counties})
    if len(places) > 1 and normalise(query) not in groups:
        reasons.append({"reason": "no_exact_match", "name": query})
    return bool(reasons), reasons


class Photon:
    def __init__(self, base_url: str, http: httpx.AsyncClient):
        self.base_url, self.http = base_url.rstrip("/"), http

    async def _get(self, path: str, params: dict) -> dict:
        try:
            resp = await self.http.get(f"{self.base_url}{path}", params=params)
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPError, ValueError) as err:
            raise ApiError(503, "geocoder_unavailable",
                           "Place search is unavailable: the geocoder (Photon) is not answering. Enter or pick "
                           "places again when it is back; the API does not guess coordinates from elsewhere.",
                           {"reason": f"{type(err).__name__}: {err}"[:200]}) from None

    async def search(self, q: str, lon: float | None, lat: float | None, limit: int) -> dict:
        raw = await self._get("/api", search_params(q, lon, lat, limit))
        places = [p for p in (place(f) for f in raw.get("features", [])) if p is not None]
        ambiguous, reasons = ambiguity(q, places)
        return {"query": q, "source": "photon", "ambiguous": ambiguous, "reasons": reasons, "candidates": places}

    async def reverse(self, lon: float, lat: float) -> dict:
        raw = await self._get("/reverse", {"lon": lon, "lat": lat, "limit": 1, "lang": "en"})
        places = [p for p in (place(f) for f in raw.get("features", [])) if p is not None]
        return {"source": "photon", "place": places[0] if places else None}
