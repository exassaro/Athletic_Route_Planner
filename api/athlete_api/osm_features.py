"""Request items from OSM data in the pinned extract (blueprint Phase 5 amendment 7, A6).

The front end picks a place (Photon) or taps a way on the map; this module turns it into the request item the
solver expects, with the same rules the scenario fixtures use (tests/kpi/build_scenarios.py), so a request built
in the UI equals the fixture request built from the same OSM objects:

- A pass-near checkpoint at a place gets the place's own boundary: of the boundaries containing the point
  (admin_level 8 to 10), most local first, the first whose name contains the first word of the place's name.
  None when no boundary matches. A `must_reach` checkpoint gets none (it does not use the fallback).
- A bridge is the OSM way picked: way_ids [id], lines [its coordinates], and the point at its middle vertex
  (coordinates[len // 2]), as the fixtures.
- A named road is every way with the same name connected to the one picked (sharing a point), within about
  20 km of it; its point is the middle vertex of the way picked.
- An avoided place is a circle (radius_m) round the point; an avoided road is its ways, without a point.

Every coordinate comes from the extract or from the client's Photon result. Straight-line distance is used only
to find ways near a tap (a pre-filter, never shown as a route distance).
"""

import json
import re
from typing import Literal

from athlete_solver.models import AvoidItem, Checkpoint, MustUse, Via
from shapely import STRtree, wkb
from shapely.geometry import mapping
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .errors import ApiError

Role = Literal["checkpoint", "via", "must_use", "avoid"]
Kind = Literal["place", "bridge", "road"]
PLACE_ID = re.compile(r"^osm:(node|way|relation)/(\d+)$")
ROAD_REACH_DEG = 0.2        # named-road search box round the way picked (about 20 km)
ROAD_MAX_WAYS = 400


def parse_place_id(place_id: str) -> tuple[str, int]:
    m = PLACE_ID.match(place_id or "")
    if not m:
        raise ApiError(422, "invalid_place_id", f'Expected "osm:node/N", "osm:way/N" or "osm:relation/N", '
                                                f"got {place_id!r}.")
    return m.group(1), int(m.group(2))


def _json(geom) -> dict:
    """GeoJSON with lists, as the fixtures store it (json round trip of shapely's mapping)."""
    return json.loads(json.dumps(mapping(geom)))


async def extract(db: AsyncSession) -> str:
    rows = dict((await db.execute(text("SELECT key, value FROM osm_features_meta"))).all())
    if "osm_timestamp" not in rows:
        raise ApiError(503, "osm_features_missing", "OSM ways and boundaries are not loaded. Run "
                                                    "api/scripts/load_osm_features.py.")
    return rows["osm_timestamp"]


async def own_boundary(db: AsyncSession, lon: float, lat: float, name: str) -> dict | None:
    word = name.lower().split()[0] if name and name.split() else ""
    if not word:
        return None
    rows = (await db.execute(text(
        "SELECT name, ST_AsBinary(geom) FROM osm_boundaries "
        "WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)) ORDER BY admin_level DESC, id"),
        {"lon": lon, "lat": lat})).all()
    for bname, geom in rows:
        if word in (bname or "").lower():
            return _json(wkb.loads(bytes(geom)))
    return None


async def _way(db: AsyncSession, way_id: int) -> dict:
    row = (await db.execute(text("SELECT id, name, highway, bridge, ST_AsBinary(geom) FROM osm_ways WHERE id = :id"),
                            {"id": way_id})).first()
    if row is None:
        raise ApiError(404, "not_found", f"No highway way {way_id} in the pinned extract.")
    coords = [list(c) for c in wkb.loads(bytes(row[4])).coords]
    return {"id": row[0], "name": row[1], "highway": row[2], "bridge": row[3], "coords": coords}


async def road_ways(db: AsyncSession, way: dict) -> list[dict]:
    """The named road: ways with the same name connected to `way` (sharing a point), in id order."""
    if not way["name"]:
        return [way]
    rows = (await db.execute(text(
        "SELECT w.id, ST_AsBinary(w.geom) FROM osm_ways w, osm_ways p WHERE p.id = :id AND w.name = p.name "
        "AND w.geom && ST_Expand(p.geom, :reach)"), {"id": way["id"], "reach": ROAD_REACH_DEG})).all()
    ids = [r[0] for r in rows]
    geoms = [wkb.loads(bytes(r[1])) for r in rows]
    tree = STRtree(geoms)
    seen = {ids.index(way["id"])}
    todo = list(seen)
    while todo and len(seen) < ROAD_MAX_WAYS:
        k = todo.pop()
        for j in tree.query(geoms[k], predicate="intersects"):
            if int(j) not in seen:
                seen.add(int(j))
                todo.append(int(j))
    return [{"id": ids[k], "coords": [list(c) for c in geoms[k].coords]} for k in sorted(seen, key=lambda k: ids[k])]


async def build_item(db: AsyncSession, role: Role, kind: Kind, place_id: str, lon: float | None,
                     lat: float | None, label: str | None, must_reach: bool = False, radius_m: float = 300.0):
    """The request item for `role`, as the solver's own model."""
    osm_type, osm_id = parse_place_id(place_id)
    if kind == "place":
        if lon is None or lat is None or not label:
            raise ApiError(422, "missing_point", "A place needs lon, lat and label (from the place search).")
        if role == "checkpoint":
            boundary = None if must_reach else await own_boundary(db, lon, lat, label)
            return Checkpoint(lon=lon, lat=lat, label=label, place_id=place_id, must_reach=must_reach,
                              boundary=boundary)
        if role == "via":
            return Via(kind="place", lon=lon, lat=lat, label=label, place_id=place_id)
        if role == "avoid":
            return AvoidItem(kind="place", label=label, lon=lon, lat=lat, radius_m=radius_m)
        raise ApiError(422, "unsupported_kind", "must_use takes a bridge or a road, not a place.")

    if osm_type != "way":
        raise ApiError(422, "unsupported_kind", f"A {kind} is an OSM way; {place_id} is a {osm_type}.")
    way = await _way(db, osm_id)
    name = label or way["name"] or (f"Unnamed {way['highway']} bridge" if way["bridge"] else
                                    f"Unnamed {way['highway']}")
    mid = way["coords"][len(way["coords"]) // 2]
    if kind == "bridge":
        ways = [way]
    else:
        ways = await road_ways(db, way)
    way_ids = [w["id"] for w in ways]
    lines = [w["coords"] for w in ways]
    if role == "checkpoint":
        return Checkpoint(lon=mid[0], lat=mid[1], label=name, place_id=place_id, kind=kind, way_ids=way_ids,
                          lines=lines)
    if role == "must_use":
        return MustUse(kind=kind, lon=mid[0], lat=mid[1], label=name, place_id=place_id, way_ids=way_ids,
                       lines=lines)
    if role == "via":
        return Via(kind="road", lon=mid[0], lat=mid[1], label=name, place_id=place_id, way_ids=way_ids,
                   lines=lines)
    return AvoidItem(kind="road", label=name, way_ids=way_ids, lines=lines)


async def nearby(db: AsyncSession, lon: float, lat: float, radius_m: float, limit: int = 8) -> list[dict]:
    """Highway ways within radius_m of a tap, nearest first. The distance orders them and is not returned."""
    pad = radius_m / 100_000.0          # degrees, generous at this latitude (the geography test decides)
    rows = (await db.execute(text(
        "WITH pt AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS g) "
        "SELECT w.id, w.name, w.highway, w.bridge FROM osm_ways w, pt "
        "WHERE w.geom && ST_Expand(pt.g, :pad) AND ST_DWithin(w.geom::geography, pt.g::geography, :r) "
        "ORDER BY ST_Distance(w.geom::geography, pt.g::geography), w.id LIMIT :limit"),
        {"lon": lon, "lat": lat, "pad": pad, "r": radius_m, "limit": limit})).all()
    return [{"place_id": f"osm:way/{r[0]}", "name": r[1], "highway": r[2], "bridge": r[3],
             "label": r[1] or (f"Unnamed {r[2]} bridge" if r[3] else f"Unnamed {r[2]}")} for r in rows]
