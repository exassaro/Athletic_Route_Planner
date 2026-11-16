"""Step 7: tag-coverage audit for Kozhikode district (no routing engine needed).

Usage:  uv run python engine/experiments/04_tag_coverage.py

Answers the blueprint's open questions: what share of walkable ways carry
sidewalk, surface and lit tags, and how ferries and bridges are tagged.
All lengths are geodesic lengths of the OSM way geometry (pyproj, WGS84).
Writes docs/reports/phase2/tag_coverage.md.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import osmium
import shapely.wkb
from shapely.geometry import Point
from shapely.prepared import prep

from athlete_engine import geodesy
from athlete_engine.osm import PATH_CLASSES, ROAD_CLASSES, is_walkable

ROOT = Path(__file__).resolve().parents[2]
PBF = ROOT / "data" / "osm" / "kerala.osm.pbf"
OUT = ROOT / "docs" / "reports" / "phase2"
FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "places.json").read_text(encoding="utf-8"))
PLACES = FIXTURES["places"]

DISTRICT_NAME = "Kozhikode"
DISTRICT_ADMIN_LEVEL = "5"

MAJOR = {"trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"}
LONG_BRIDGE_M = 100.0
FERRY_TAGS = ["name", "foot", "bicycle", "motor_vehicle", "motorcar", "access", "duration",
              "opening_hours", "operator", "fee", "ferry", "seasonal", "disused", "note"]
BRIDGE_TAGS = ["foot", "sidewalk", "access", "lit", "surface", "maxspeed", "lanes"]


def has_sidewalk_tag(tags) -> bool:
    return any(t.k == "sidewalk" or t.k.startswith("sidewalk:") for t in tags)


def find_district():
    level = osmium.filter.TagFilter(("admin_level", DISTRICT_ADMIN_LEVEL))
    matches = []
    for obj in osmium.FileProcessor(str(PBF)).with_areas(level).with_filter(level):
        if not obj.is_area() or obj.tags.get("boundary") != "administrative":
            continue
        if DISTRICT_NAME in (obj.tags.get("name"), obj.tags.get("name:en")):
            geom = shapely.wkb.loads(osmium.geom.WKBFactory().create_multipolygon(obj), hex=True)
            kind = "way" if obj.from_way() else "relation"
            matches.append((f"{kind}/{obj.orig_id()}", geom))
    if len(matches) != 1:
        raise SystemExit(f"Expected one admin_level={DISTRICT_ADMIN_LEVEL} boundary named "
                         f"{DISTRICT_NAME}, found {len(matches)}: {[m[0] for m in matches]}")
    return matches[0]


def way_points(way) -> list[tuple[float, float]]:
    return [(n.lon, n.lat) for n in way.nodes if n.location.valid()]


def pct(part: float, whole: float) -> str:
    return f"{part / whole * 100:.1f}" if whole else "-"


def main() -> int:
    if not PBF.exists():
        print("Extract missing. Run engine/scripts/fetch_extract.py first.", file=sys.stderr)
        return 1

    print("Pass 1: district boundary...", flush=True)
    district_id, district = find_district()
    inside = prep(district)
    min_lon, min_lat, max_lon, max_lat = district.bounds
    pad = 0.03  # degrees; ferries sit on water that may fall just outside the boundary polygon

    # stats[class] = {"n", "m", "sidewalk_n", "sidewalk_m", ...}
    stats: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    sidewalk_values: dict[str, float] = defaultdict(float)
    surface_values: dict[str, float] = defaultdict(float)
    lit_values: dict[str, float] = defaultdict(float)
    bridges_by_class: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    long_bridges: list[dict] = []
    ferries: list[dict] = []
    ferries_kerala = 0
    not_walkable: dict[str, float] = defaultdict(float)

    print("Pass 2: ways...", flush=True)
    wanted = osmium.filter.KeyFilter("highway", "route")
    for obj in osmium.FileProcessor(str(PBF)).with_locations().with_filter(wanted):
        if not obj.is_way():
            continue
        tags = obj.tags
        is_ferry = tags.get("route") == "ferry"
        if is_ferry:
            ferries_kerala += 1
        if not is_ferry and "highway" not in tags:
            continue
        pts = way_points(obj)
        if len(pts) < 2:
            continue
        mid = pts[len(pts) // 2]

        if is_ferry:
            if min_lon - pad <= mid[0] <= max_lon + pad and min_lat - pad <= mid[1] <= max_lat + pad:
                ferries.append({
                    "id": obj.id, "length_m": geodesy.line_length_m(pts), "from": pts[0], "to": pts[-1],
                    "mid": mid, "tags": {t.k: t.v for t in tags},
                })
            continue

        if not (min_lon <= mid[0] <= max_lon and min_lat <= mid[1] <= max_lat) or not inside.contains(Point(mid)):
            continue
        highway = tags.get("highway")
        length = geodesy.line_length_m(pts)
        if not is_walkable(tags):
            not_walkable[highway] += length
            continue

        s = stats[highway]
        s["n"] += 1
        s["m"] += length
        if has_sidewalk_tag(tags):
            s["sidewalk_n"] += 1
            s["sidewalk_m"] += length
            sidewalk_values[tags.get("sidewalk", "(sidewalk:* only)")] += length
        if "surface" in tags:
            s["surface_n"] += 1
            s["surface_m"] += length
            surface_values[tags.get("surface")] += length
        if "lit" in tags:
            s["lit_n"] += 1
            s["lit_m"] += length
            lit_values[tags.get("lit")] += length
        if "foot" in tags:
            s["foot_n"] += 1
            s["foot_m"] += length

        if tags.get("bridge") not in (None, "no"):
            b = bridges_by_class[highway]
            b["n"] += 1
            b["m"] += length
            for key in ("foot", "sidewalk", "lit"):
                if key in tags or (key == "sidewalk" and has_sidewalk_tag(tags)):
                    b[f"{key}_n"] += 1
            if highway in MAJOR and length >= LONG_BRIDGE_M:
                long_bridges.append({"id": obj.id, "highway": highway, "name": tags.get("name", ""),
                                     "length_m": length, "mid": mid,
                                     "tags": {k: tags.get(k) for k in BRIDGE_TAGS if k in tags}})

    # ---------- report ----------
    def total(classes, key):
        return sum(stats[c][key] for c in classes if c in stats)

    def coverage_row(label, classes):
        n, m = total(classes, "n"), total(classes, "m")
        cells = [label, f"{int(n)}", f"{m / 1000:.1f}"]
        for tag in ("sidewalk", "surface", "lit"):
            cells += [pct(total(classes, f"{tag}_n"), n), pct(total(classes, f"{tag}_m"), m)]
        return "| " + " | ".join(cells) + " |"

    all_classes = [c for c in ROAD_CLASSES + PATH_CLASSES if c in stats]
    road_classes = [c for c in ROAD_CLASSES if c in stats]
    md = [
        "# Phase 2: OSM tag coverage, Kozhikode district", "",
        f"OSM data {FIXTURES['osm_timestamp']} (Kerala extract). District boundary: OSM {district_id} "
        f"(`admin_level={DISTRICT_ADMIN_LEVEL}`, name {DISTRICT_NAME}).", "",
        "**Method.** A way is counted when its middle node lies inside the district boundary. "
        "\"Walkable\" means `highway` is one of the road or path classes below, and the way is not "
        "`foot=no/private` and not `access=no/private` (unless `foot` explicitly allows). This approximates, "
        "but is not identical to, Valhalla's pedestrian access rules. Lengths are geodesic lengths of the way "
        "geometry. A tag counts as present whatever its value, so `sidewalk=no` counts as tagged.", "",
        "## Coverage of sidewalk, surface and lit", "",
        "| Class | Ways | Length (km) | sidewalk % ways | sidewalk % km | surface % ways | surface % km | lit % ways | lit % km |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        coverage_row("**All walkable ways**", all_classes),
        coverage_row("**Roads only** (no footways, paths, tracks)", road_classes),
    ]
    md += [coverage_row(c, [c]) for c in all_classes]

    def value_table(title, values, denominator_m):
        rows = [f"### {title}", "", "| Value | Length (km) | Share of walkable km (%) |", "| --- | --- | --- |"]
        for value, m in sorted(values.items(), key=lambda kv: -kv[1])[:12]:
            rows.append(f"| `{value}` | {m / 1000:.1f} | {pct(m, denominator_m)} |")
        return rows + [""]

    walkable_m = total(all_classes, "m")
    md += ["", "## Tag values", ""]
    md += value_table("sidewalk", sidewalk_values, walkable_m)
    md += value_table("surface", surface_values, walkable_m)
    md += value_table("lit", lit_values, walkable_m)
    md += [f"Explicit `foot=*` tag present on {pct(total(all_classes, 'foot_m'), walkable_m)}% of walkable km.", ""]
    if not_walkable:
        md += ["Highway ways inside the district excluded as not walkable (km): "
               + ", ".join(f"`{k}` {v / 1000:.1f}" for k, v in sorted(not_walkable.items(), key=lambda kv: -kv[1])[:10]), ""]

    # ferries
    cb_mid = ((PLACES["chaliyam"]["lon"] + PLACES["beypore"]["lon"]) / 2,
              (PLACES["chaliyam"]["lat"] + PLACES["beypore"]["lat"]) / 2)
    md += ["## Ferries", "",
           f"`route=ferry` ways: {ferries_kerala} in the whole Kerala extract, {len(ferries)} in or within about "
           f"3 km of the district's bounding box.", "",
           "| OSM way | Name | Length (m) | From (lat, lon) | To (lat, lon) | Km from Chaliyam–Beypore midpoint | Tags |",
           "| --- | --- | --- | --- | --- | --- | --- |"]
    for f in sorted(ferries, key=lambda f: geodesy.distance_m(f["mid"], cb_mid)):
        shown = {k: v for k, v in f["tags"].items() if k in FERRY_TAGS and k != "name"}
        md.append(f"| [{f['id']}](https://www.openstreetmap.org/way/{f['id']}) | {f['tags'].get('name', '')} | "
                  f"{f['length_m']:.0f} | {f['from'][1]:.5f}, {f['from'][0]:.5f} | {f['to'][1]:.5f}, {f['to'][0]:.5f} | "
                  f"{geodesy.distance_m(f['mid'], cb_mid) / 1000:.1f} | "
                  f"{', '.join(f'`{k}={v}`' for k, v in shown.items()) or '(none of the access tags)'} |")
    md += ["", "The last-but-one column is a straight-line distance used only to sort the table; it is not a route distance.", ""]

    # bridges
    md += ["## Bridges", "",
           "| Class | Bridge ways | Length (km) | with foot=* | with sidewalk tag | with lit=* |",
           "| --- | --- | --- | --- | --- | --- |"]
    for c in [c for c in ROAD_CLASSES + PATH_CLASSES if c in bridges_by_class]:
        b = bridges_by_class[c]
        md.append(f"| {c} | {int(b['n'])} | {b['m'] / 1000:.2f} | {int(b['foot_n'])} | {int(b['sidewalk_n'])} | {int(b['lit_n'])} |")
    md += ["", f"### Bridge ways of {LONG_BRIDGE_M:.0f} m or more on trunk, primary and secondary roads", "",
           "These are the river crossings a route cannot avoid. A long bridge mapped as several ways appears as several rows.", "",
           "| OSM way | Class | Name | Length (m) | Middle (lat, lon) | Pedestrian-relevant tags |", "| --- | --- | --- | --- | --- | --- |"]
    for b in sorted(long_bridges, key=lambda b: -b["length_m"]):
        md.append(f"| [{b['id']}](https://www.openstreetmap.org/way/{b['id']}) | {b['highway']} | {b['name']} | "
                  f"{b['length_m']:.0f} | {b['mid'][1]:.5f}, {b['mid'][0]:.5f} | "
                  f"{', '.join(f'`{k}={v}`' for k, v in b['tags'].items()) or '(none)'} |")
    md.append("")

    OUT.mkdir(parents=True, exist_ok=True)
    report = OUT / "tag_coverage.md"
    report.write_text("\n".join(md), encoding="utf-8")

    n, m = total(all_classes, "n"), walkable_m
    print(f"District boundary: {district_id}")
    print(f"Walkable ways: {int(n)}, {m / 1000:.0f} km")
    for tag in ("sidewalk", "surface", "lit"):
        print(f"  {tag:9s} {pct(total(all_classes, f'{tag}_n'), n):>5s}% of ways  {pct(total(all_classes, f'{tag}_m'), m):>5s}% of km")
    print(f"Ferry ways near district: {len(ferries)}; long major-road bridge ways: {len(long_bridges)}")
    print(f"Report: {report.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
