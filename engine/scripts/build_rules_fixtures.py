"""Read the Phase 3b acceptance places from the pinned OSM extract into tests/fixtures/rules_places.json.

Usage:  uv run python engine/scripts/build_rules_fixtures.py

Every object is pinned by OSM id. The ids were chosen by searching the extract and
Photon for each name on 2026-11-17 (rules spike, docs/reports/phase3b/rules_spike.md):
- Athanikkal: several places in Kerala share the name; this is the only one on the
  Kadalundi corridor (the others are near Malappuram, West Hill and Ernakulam).
- Kallayi: OSM spells it "Kallai" (a suburb of Kozhikode); a second Kallayi is near Thalassery.
- "Karuvanthuruthy bridge" is not in OSM under any spelling. The developer chose way
  389396419 ("Chaliyam - Feroke Road", bridge=yes), about 200 m from the Karuvanthiruthy mosque.

For each point the script also records the OSM boundaries (administrative or
local_authority, admin_level 8 to 10) that contain it: the pass-near fallback
(Phase 3 amendment 3) needs "the place's OSM boundary where one exists".
"""

import json
import sys
from pathlib import Path

import osmium
import osmium.geom
from shapely import wkb
from shapely.geometry import Point, mapping

ROOT = Path(__file__).resolve().parents[2]
PBF = ROOT / "data" / "osm" / "kerala.osm.pbf"
MANIFEST = ROOT / "data" / "manifest.json"
OUT = ROOT / "tests" / "fixtures" / "rules_places.json"

NODES = {
    "athanikkal": 1770460252,
    "kottakkadavu": 3027581412,
    "kadalundi": 7728008448,
    "chaliyam": 1683145417,
    "beypore": 1683149581,
    "kallai": 3797752730,
    "kozhikode": 1348192542,
    # Chaliyam's harbour at the tip of the spit ("Chaliyam Fish Harber"): a true dead end with
    # ferries excluded, used to test a must_reach stop at a dead end.
    "chaliyam_harbour": 2713992338,
}
WAYS = {
    "karuvanthuruthy_bridge": 389396419,
}
BOUNDARY_TYPES = {"administrative", "local_authority"}
ADMIN_LEVELS = {"8", "9", "10"}


def main() -> int:
    if not PBF.exists():
        print("Extract missing. Run engine/scripts/fetch_extract.py first.", file=sys.stderr)
        return 1
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    places: dict[str, dict] = {}
    node_ids = set(NODES.values())
    way_ids = set(WAYS.values())
    key_of_node = {v: k for k, v in NODES.items()}
    key_of_way = {v: k for k, v in WAYS.items()}

    proc = osmium.FileProcessor(str(PBF)).with_locations()
    for obj in proc:
        if obj.is_node() and obj.id in node_ids:
            places[key_of_node[obj.id]] = {
                "osm_id": f"node/{obj.id}", "kind": "place",
                "lon": obj.location.lon, "lat": obj.location.lat,
                "name": obj.tags.get("name"), "place": obj.tags.get("place"),
            }
        elif obj.is_way() and obj.id in way_ids:
            coords = [(n.lon, n.lat) for n in obj.nodes]
            mid = coords[len(coords) // 2]
            places[key_of_way[obj.id]] = {
                "osm_id": f"way/{obj.id}", "kind": "bridge",
                "lon": mid[0], "lat": mid[1], "coords": coords,
                "name": obj.tags.get("name"), "highway": obj.tags.get("highway"),
                "bridge": obj.tags.get("bridge"), "foot": obj.tags.get("foot"),
            }
    missing = (set(NODES) | set(WAYS)) - set(places)
    if missing:
        print(f"Not found in the extract: {sorted(missing)}", file=sys.stderr)
        return 1

    # Boundaries containing each point (areas assembled from boundary relations)
    points = {k: Point(p["lon"], p["lat"]) for k, p in places.items()}
    for p in places.values():
        p["boundaries"] = []
    factory = osmium.geom.WKBFactory()
    areas = osmium.FileProcessor(str(PBF)).with_areas(osmium.filter.KeyFilter("boundary"))
    for obj in areas:
        if not obj.is_area() or obj.from_way():
            continue
        tags = obj.tags
        if tags.get("boundary") not in BOUNDARY_TYPES or tags.get("admin_level") not in ADMIN_LEVELS:
            continue
        try:
            geom = wkb.loads(factory.create_multipolygon(obj), hex=True)
        except RuntimeError:
            continue
        for key, pt in points.items():
            if geom.contains(pt):
                places[key]["boundaries"].append({
                    "osm_id": f"relation/{obj.orig_id()}", "name": tags.get("name"),
                    "boundary": tags.get("boundary"), "admin_level": tags.get("admin_level"),
                    "geometry": mapping(geom),
                })
    for p in places.values():
        p["boundaries"].sort(key=lambda b: -int(b["admin_level"]))  # most local first

    OUT.write_text(json.dumps({
        "extract": {k: manifest["extract"][k] for k in ("name", "md5", "osm_timestamp")},
        "places": places,
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    for key, p in places.items():
        b = ", ".join(f"{x['name']} ({x['osm_id']}, L{x['admin_level']})" for x in p["boundaries"]) or "none"
        print(f"{key:24s} {p['osm_id']:18s} {p['lon']:.6f},{p['lat']:.6f}  {p['name']!r}  boundaries: {b}")
    print(f"Wrote {OUT.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
