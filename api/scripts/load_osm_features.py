"""Load OSM ways and boundaries from the pinned extract into Postgres (blueprint Phase 5 amendment 7, A6).

Usage:  uv run python api/scripts/load_osm_features.py [--dsn postgresql://athlete:athlete@localhost:5433/athlete]

- Refuses to run unless data/manifest.json matches engine/osm_pin.json (the extract every fixture was measured on).
- osm_ways: every way with a highway tag, its node coordinates as osmium reads them (the same doubles as
  engine/scripts/build_rules_fixtures.py), name, highway, bridge (any bridge tag other than "no") and a few tags.
- osm_boundaries: areas from boundary relations with boundary=administrative or local_authority and admin_level
  8 to 10, exactly the filter of build_rules_fixtures.py.
- Replaces both tables in one transaction and records the extract in osm_features_meta.

Run it once per database after `alembic upgrade head` (the API's database; the live tests' athlete_live).
"""

import argparse
import io
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import osmium
import osmium.geom
import psycopg
import shapely
from shapely import wkb
from shapely.geometry import LineString

ROOT = Path(__file__).resolve().parents[2]
PBF = ROOT / "data" / "osm" / "kerala.osm.pbf"
MANIFEST = ROOT / "data" / "manifest.json"
PIN = ROOT / "engine" / "osm_pin.json"
BOUNDARY_TYPES = {"administrative", "local_authority"}
ADMIN_LEVELS = {"8", "9", "10"}
KEEP_TAGS = ("name", "name:en", "highway", "bridge", "ref", "foot", "access", "layer", "bridge:name")


def ewkb_hex(geom) -> str:
    return shapely.to_wkb(shapely.set_srid(geom, 4326), hex=True, include_srid=True)


def copy_text(value) -> str:
    if value is None:
        return r"\N"
    return str(value).replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default="postgresql://athlete:athlete@localhost:5433/athlete")
    args = ap.parse_args()
    if not PBF.exists():
        print("Extract missing. Run engine/scripts/fetch_extract.py first.", file=sys.stderr)
        return 1
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))["extract"]
    pin = json.loads(PIN.read_text(encoding="utf-8"))
    if (manifest["osm_timestamp"], manifest["md5"]) != (pin["osm_timestamp"], pin["md5"]):
        print(f"data/manifest.json is {manifest['osm_timestamp']} ({manifest['md5']}), the pin is "
              f"{pin['osm_timestamp']} ({pin['md5']}). Restore the pinned extract first "
              "(fetch_extract.py --from-backup).", file=sys.stderr)
        return 1

    t0 = time.perf_counter()
    ways = io.StringIO()
    n_ways = 0
    for obj in osmium.FileProcessor(str(PBF)).with_locations().with_filter(osmium.filter.KeyFilter("highway")):
        if not obj.is_way():
            continue
        try:
            coords = [(n.lon, n.lat) for n in obj.nodes]
        except osmium.InvalidLocationError:
            continue
        if len(coords) < 2:
            continue
        tags = {k: obj.tags.get(k) for k in KEEP_TAGS if obj.tags.get(k) is not None}
        bridge = obj.tags.get("bridge") not in (None, "no")
        ways.write("\t".join([str(obj.id), copy_text(obj.tags.get("name")), copy_text(obj.tags.get("highway")),
                              "t" if bridge else "f", copy_text(json.dumps(tags, ensure_ascii=False)),
                              ewkb_hex(LineString(coords))]) + "\n")
        n_ways += 1
    t_ways = time.perf_counter() - t0

    bounds = io.StringIO()
    n_bounds = 0
    factory = osmium.geom.WKBFactory()
    for obj in osmium.FileProcessor(str(PBF)).with_areas(osmium.filter.KeyFilter("boundary")):
        if not obj.is_area() or obj.from_way():
            continue
        tags = obj.tags
        if tags.get("boundary") not in BOUNDARY_TYPES or tags.get("admin_level") not in ADMIN_LEVELS:
            continue
        try:
            geom = wkb.loads(factory.create_multipolygon(obj), hex=True)
        except RuntimeError:
            continue
        bounds.write("\t".join([str(obj.orig_id()), copy_text(tags.get("name")), copy_text(tags.get("boundary")),
                                str(int(tags.get("admin_level"))), ewkb_hex(geom)]) + "\n")
        n_bounds += 1
    t_read = time.perf_counter() - t0

    meta = {"name": manifest["name"], "md5": manifest["md5"], "osm_timestamp": manifest["osm_timestamp"],
            "loaded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "ways": str(n_ways), "boundaries": str(n_bounds)}
    with psycopg.connect(args.dsn) as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE osm_ways, osm_boundaries, osm_features_meta")
        with cur.copy("COPY osm_ways (id, name, highway, bridge, tags, geom) FROM STDIN") as cp:
            cp.write(ways.getvalue())
        with cur.copy("COPY osm_boundaries (id, name, boundary, admin_level, geom) FROM STDIN") as cp:
            cp.write(bounds.getvalue())
        cur.executemany("INSERT INTO osm_features_meta (key, value) VALUES (%s, %s)", list(meta.items()))
        conn.commit()
        cur.execute("ANALYZE osm_ways")
        cur.execute("ANALYZE osm_boundaries")
    print(f"{n_ways} highway ways ({t_ways:.0f} s), {n_bounds} boundaries (admin_level 8 to 10; read "
          f"{t_read:.0f} s, total {time.perf_counter() - t0:.0f} s) from {manifest['name']} "
          f"{manifest['osm_timestamp']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
