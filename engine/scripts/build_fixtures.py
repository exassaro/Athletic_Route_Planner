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

    places: dict[str, dict] = dict(DEVELOPER_SUPPLIED)
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
    if missing:
        print("NOT FOUND:", ", ".join(missing))
    print(f"Wrote {OUT.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
