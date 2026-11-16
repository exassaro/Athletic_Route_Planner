"""Step 9: smoke test of the local Photon geocoder.

Usage:  docker compose --profile geocode up -d photon
        uv run python engine/experiments/06_photon_smoke.py

Searches the worked-example place names (including the Calicut alias and the
Malayalam spelling) with and without a location bias at the start point, and
checks where the OSM place node we route to appears in the results.
Distances here are straight-line offsets between two coordinates for the same
place; they are a geocoder check, not route distances.
Writes docs/reports/phase2/photon.md.
"""

import json
import os
import sys
import time
from pathlib import Path

import httpx

from athlete_engine import geodesy

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "reports" / "phase2"
FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "places.json").read_text(encoding="utf-8"))
PLACES = FIXTURES["places"]
MANIFEST = json.loads((ROOT / "data" / "manifest.json").read_text(encoding="utf-8"))
PHOTON_URL = os.environ.get("PHOTON_URL", "http://localhost:2322")

# (query, fixture key holding the OSM place node we expect)
QUERIES = [
    ("Kadalundi", "kadalundi"), ("Chaliyam", "chaliyam"), ("Beypore", "beypore"),
    ("Kozhikode", "kozhikode"), ("Calicut", "kozhikode"), ("കോഴിക്കോട്", "kozhikode"),
    ("Feroke", "feroke"), ("Parappanangadi", "parappanangadi"), ("Vythiri", "vythiri"),
    ("Lakkidi", None),  # two places with this name in Kerala: the ambiguity case
]
LIMIT = 5
NEAR_M = 1000.0


def search(client: httpx.Client, query: str, bias: tuple[float, float] | None) -> tuple[list[dict], float]:
    params: dict[str, str | float | int] = {"q": query, "limit": LIMIT}
    if bias:
        params.update({"lon": bias[0], "lat": bias[1]})
    start = time.perf_counter()
    resp = client.get("/api", params=params)
    elapsed = (time.perf_counter() - start) * 1000
    resp.raise_for_status()
    return resp.json().get("features", []), elapsed


def describe(feature: dict) -> str:
    p = feature["properties"]
    where = ", ".join(str(p[k]) for k in ("county", "state") if p.get(k))
    return f"{p.get('name', '?')} ({p.get('osm_key')}={p.get('osm_value')}; {where})"


def osm_ref(feature: dict) -> str:
    p = feature["properties"]
    kind = {"N": "node", "W": "way", "R": "relation"}.get(p.get("osm_type"), "?")
    return f"{kind}/{p.get('osm_id')}"


def main() -> int:
    bias = (PLACES["start_south_of_kadalundi"]["lon"], PLACES["start_south_of_kadalundi"]["lat"])
    rows, details, latencies = [], [], []
    with httpx.Client(base_url=PHOTON_URL, timeout=30) as client:
        for query, key in QUERIES:
            cells = []
            for label, b in (("biased", bias), ("unbiased", None)):
                features, ms = search(client, query, b)
                latencies.append(ms)
                rank = same_id = None
                offset = None
                if key:
                    target = (PLACES[key]["lon"], PLACES[key]["lat"])
                    for i, f in enumerate(features, start=1):
                        d = geodesy.distance_m(target, f["geometry"]["coordinates"])
                        if osm_ref(f) == PLACES[key]["osm_id"] or d <= NEAR_M:
                            rank, offset, same_id = i, d, osm_ref(f) == PLACES[key]["osm_id"]
                            break
                cells.append((label, features, rank, offset, same_id))
                details.append((query, label, features))
            rows.append((query, key, cells))

    def cell(c):
        _, features, rank, offset, same_id = c
        if not features:
            return "no results"
        if rank is None:
            return f"not in top {LIMIT}; first: {describe(features[0])}"
        return f"rank {rank}, {offset:.0f} m from our node" + (" (same OSM node)" if same_id else "")

    expected = [(q, k, cells) for q, k, cells in rows if k]
    hits = sum(1 for _, _, cells in expected if cells[0][2] == 1)
    photon = MANIFEST.get("photon", {})
    md = [
        "# Phase 2: Photon geocoder smoke test", "",
        f"Photon 1.3.0 with the prebuilt India index (archive dated {photon.get('archive_last_modified')}, "
        f"{photon.get('unpacked_bytes', 0) / 1e6:.0f} MB unpacked). The routing graph uses OSM data "
        f"{FIXTURES['osm_timestamp']}, so the two are not the same snapshot.", "",
        f"Each name is searched with a location bias at the start point (11.05, 75.86) and without. A result "
        f"counts as a match when it is the OSM place node we route to, or lies within {NEAR_M:.0f} m of it "
        "(straight-line offset between the two coordinates, a geocoder check and not a route distance).", "",
        f"**{hits} of {len(expected)}** expected places are the first result with the bias. "
        f"Request latency: median {sorted(latencies)[len(latencies) // 2]:.0f} ms, max {max(latencies):.0f} ms "
        "(development laptop).", "",
        "| Query | Expected place | With bias | Without bias |", "| --- | --- | --- | --- |",
    ]
    for query, key, cells in rows:
        expect = f"{key} ({PLACES[key]['osm_id']})" if key else "ambiguous on purpose"
        if key:
            md.append(f"| {query} | {expect} | {cell(cells[0])} | {cell(cells[1])} |")
        else:
            md.append(f"| {query} | {expect} | {len(cells[0][1])} results | {len(cells[1][1])} results |")
    md += ["", "## Results in full (with bias)", ""]
    for query, label, features in details:
        if label != "biased":
            continue
        md += [f"**{query}**", ""]
        md += [f"{i}. {describe(f)}, {osm_ref(f)}, at {f['geometry']['coordinates'][1]:.5f}, {f['geometry']['coordinates'][0]:.5f}"
               for i, f in enumerate(features, start=1)] or ["(no results)"]
        md.append("")

    OUT.mkdir(parents=True, exist_ok=True)
    report = OUT / "photon.md"
    report.write_text("\n".join(md), encoding="utf-8")
    for query, key, cells in rows:
        shown = cell(cells[0]) if key else f"{len(cells[0][1])} results"
        print(f"{query.encode('ascii', 'replace').decode():16s} {shown.encode('ascii', 'replace').decode()}")
    print(f"{hits}/{len(expected)} expected places ranked first with bias")
    print(f"Report: {report.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
