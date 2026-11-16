"""Read place coordinates from the pinned OSM extract into tests/fixtures/places.json.

Usage:  uv run python engine/scripts/build_fixtures.py

Coordinates are never typed in by hand: each fixture is an OSM `place=*` node
with its node id. When a name matches several nodes, the one with the highest
place rank is chosen and every candidate is listed under `candidates`, so an
ambiguous pick is visible rather than silent.

The one exception is `start_south_of_kadalundi`, which is the developer-supplied
coordinate from the blueprint's section 4 sample request.
"""

import json
import sys
from pathlib import Path

import osmium

ROOT = Path(__file__).resolve().parents[2]
PBF = ROOT / "data" / "osm" / "kerala.osm.pbf"
MANIFEST = ROOT / "data" / "manifest.json"
OUT = ROOT / "tests" / "fixtures" / "places.json"

# key -> names accepted in name / name:en
WANTED = {
    "kadalundi": {"Kadalundi"},
    "chaliyam": {"Chaliyam"},
    "beypore": {"Beypore"},
    "kozhikode": {"Kozhikode", "Calicut"},
    "feroke": {"Feroke", "Farook", "Ferok"},
    "parappanangadi": {"Parappanangadi"},
    "kannur": {"Kannur"},
    "vythiri": {"Vythiri"},  # Wayanad, above the ghat road: the hilly control point
    "thamarassery": {"Thamarassery"},  # foot of the Thamarassery ghat road
    "adivaram": {"Adivaram"},
    "mananchira": {"Mananchira"},
}

# Objects pinned by OSM id because the name is ambiguous or is not a place node.
# For a way, the fixture is the way's middle node.
BY_ID = {
    "lakkidi_wayanad": ("node", 3922194996),   # Lakkidi, Wayanad (top of the ghat); another Lakkidi is in Palakkad
    "calicut_beach": ("node", 10240443491),    # tourism=attraction
    "beach_road": ("way", 174513251),          # Beach Road, Kozhikode (highway=secondary)
}
PLACE_RANK = ["city", "town", "suburb", "village", "neighbourhood", "quarter", "hamlet", "locality"]

DEVELOPER_SUPPLIED = {
    "start_south_of_kadalundi": {
        "lon": 75.86,
        "lat": 11.05,
        "source": "developer-supplied: blueprint section 4 sample request",
    }
}


def rank(place: str) -> int:
    return PLACE_RANK.index(place) if place in PLACE_RANK else len(PLACE_RANK)


def main() -> int:
    if not PBF.exists():
        print("Extract missing. Run engine/scripts/fetch_extract.py first.", file=sys.stderr)
        return 1

    found: dict[str, list[dict]] = {key: [] for key in WANTED}
    processor = osmium.FileProcessor(str(PBF), osmium.osm.NODE).with_filter(osmium.filter.KeyFilter("place"))
    for node in processor:
        names = {node.tags.get("name"), node.tags.get("name:en")}
        for key, accepted in WANTED.items():
            if names & accepted:
                found[key].append({
                    "osm_id": f"node/{node.id}",
                    "lon": node.location.lon,
                    "lat": node.location.lat,
                    "name": node.tags.get("name"),
                    "name_en": node.tags.get("name:en"),
                    "name_ml": node.tags.get("name:ml"),
                    "place": node.tags.get("place"),
                })

    node_ids = {oid: key for key, (kind, oid) in BY_ID.items() if kind == "node"}
    way_ids = {oid: key for key, (kind, oid) in BY_ID.items() if kind == "way"}
    by_id: dict[str, dict] = {}
    for obj in osmium.FileProcessor(str(PBF)).with_locations():
        if obj.is_node() and obj.id in node_ids:
            by_id[node_ids[obj.id]] = {"osm_id": f"node/{obj.id}", "lon": obj.location.lon, "lat": obj.location.lat,
                                       "name": obj.tags.get("name"), "source": "osm node pinned by id"}
        elif obj.is_way() and obj.id in way_ids:
            nodes = [n for n in obj.nodes if n.location.valid()]
            mid = nodes[len(nodes) // 2]
            by_id[way_ids[obj.id]] = {"osm_id": f"node/{mid.ref}", "lon": mid.lon, "lat": mid.lat,
                                      "name": obj.tags.get("name"), "highway": obj.tags.get("highway"),
                                      "source": f"middle node of way/{obj.id}, pinned by id"}

    places: dict[str, dict] = dict(DEVELOPER_SUPPLIED)
    missing_ids = [k for k in BY_ID if k not in by_id]
    places.update(by_id)
    missing = []
    for key, candidates in found.items():
        if not candidates:
            missing.append(key)
            continue
        candidates.sort(key=lambda c: rank(c["place"]))
        chosen = dict(candidates[0])
        chosen["source"] = "osm place node"
        if len(candidates) > 1:
            chosen["candidates"] = candidates
        places[key] = chosen

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    out = {
        "osm_timestamp": manifest.get("extract", {}).get("osm_timestamp"),
        "coordinate_order": "lon, lat (WGS84)",
        "places": places,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for key, p in places.items():
        extra = f"  ({len(p['candidates'])} candidates)" if "candidates" in p else ""
        print(f"{key:26s} {p['lat']:.6f}, {p['lon']:.6f}  {p.get('place', '-'):10s} {p.get('osm_id', p['source'])}{extra}")
    if missing or missing_ids:
        print("NOT FOUND:", ", ".join(missing + missing_ids))
    print(f"Wrote {OUT.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
