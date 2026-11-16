"""Phase 3 spike: how to build the "fewer main roads" alternative.

Usage:  docker compose up -d valhalla
        docker compose --profile spike up -d graphhopper
        uv run python engine/experiments/07_quieter_spike.py

Options compared against the Valhalla pedestrian default (ferries hard-excluded everywhere):
  (a) Valhalla bicycle costing, use_roads 0, re-checked as walkable with pedestrian costing
  (b) GraphHopper foot profile with a custom model penalising trunk and primary (priority x0.2)
Also routed: GraphHopper's plain foot profile, as a cross-engine length check.

One yardstick for all: every geometry is matched onto Valhalla pedestrian edges
(trace_attributes) to get road classes and edge identities; lengths are WGS84
ellipsoid lengths of the geometry. Pedestrian access is judged twice: whether
Valhalla's pedestrian costing can walk the geometry edge by edge, and the OSM
tags of every matched way read from the pinned extract.
Writes docs/reports/phase3/quieter_spike_measurements.md (the decision write-up is quieter_spike.md).
"""

import json
import os
import statistics
import sys
import time
from pathlib import Path

import httpx

from athlete_engine import geodesy
from athlete_engine.measure import edges_for_shape
from athlete_engine.osm import is_walkable, way_tags
from athlete_engine.valhalla import Valhalla, ValhallaError, route_shape

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "reports" / "phase3"
PBF = ROOT / "data" / "osm" / "kerala.osm.pbf"
PLACES = json.loads((ROOT / "tests" / "fixtures" / "places.json").read_text(encoding="utf-8"))["places"]
PAIRS = json.loads((ROOT / "tests" / "fixtures" / "od_pairs.json").read_text(encoding="utf-8"))
GH_URL = os.environ.get("GRAPHHOPPER_URL", "http://localhost:8989")

NO_FERRY = {"exclude_ferries": True}
MAIN = ("trunk", "primary")
NAMED = [("start_south_of_kadalundi", "kozhikode"), ("beypore", "kozhikode"),
         ("feroke", "kozhikode"), ("chaliyam", "beypore"), ("kozhikode", "thamarassery")]


def pt(name):
    return (PLACES[name]["lon"], PLACES[name]["lat"])


def all_pairs():
    out = [(f"pair {p['id']}", (p["from"]["lon"], p["from"]["lat"]), (p["to"]["lon"], p["to"]["lat"]))
           for p in PAIRS["pairs"]]
    out += [(f"{a} to {b}", pt(a), pt(b)) for a, b in NAMED]
    return out


# ------------------------------------------------------------------ variants

def valhalla_pedestrian(v: Valhalla, a, b):
    resp = v.route([a, b], costing_options=NO_FERRY)
    return route_shape(resp), v.last_elapsed_ms


def valhalla_bicycle(v: Valhalla, a, b):
    resp = v.route([a, b], costing="bicycle",
                   costing_options={**NO_FERRY, "use_roads": 0.0, "bicycle_type": "Hybrid"})
    return route_shape(resp), v.last_elapsed_ms


def graphhopper(client: httpx.Client, profile: str, a, b):
    start = time.perf_counter()
    resp = client.get("/route", params=[("point", f"{a[1]},{a[0]}"), ("point", f"{b[1]},{b[0]}"),
                                        ("profile", profile), ("points_encoded", "false"),
                                        ("instructions", "false"), ("calc_points", "true")])
    ms = (time.perf_counter() - start) * 1000
    if resp.status_code != 200:
        raise RuntimeError(resp.json().get("message", resp.text))
    coords = resp.json()["paths"][0]["points"]["coordinates"]
    return [(c[0], c[1]) for c in coords], ms


# ------------------------------------------------------------------ yardstick

def assess(v: Valhalla, shape):
    """Match onto Valhalla pedestrian edges. Returns (length, main metres, edge keys, walkable_exact, ways, recheck ms)."""
    start = time.perf_counter()
    edges, exact = edges_for_shape(v, shape, NO_FERRY)
    ms = (time.perf_counter() - start) * 1000
    length = geodesy.line_length_m(shape)
    main = sum(e.length_m for e in edges if e.road_class in MAIN and e.use != "ferry")
    ways = {e.way_id for e in edges if e.way_id}
    # Access re-check: pedestrian map_snap only matches edges pedestrians may use, so a route over a
    # foot=no edge leaves part of the geometry uncovered. (edge_walk does not check access.)
    start = time.perf_counter()
    snap = v.trace_attributes(shape, shape_match="map_snap", costing_options=NO_FERRY, attributes=["edge.length"])
    ms += (time.perf_counter() - start) * 1000
    covered = sum(e["length"] for e in snap.get("edges", [])) * 1000
    walk_ok = abs(covered - length) <= max(0.01 * length, 30.0)
    return {"length": length, "main": main, "keys": {e.key for e in edges}, "exact": exact, "walk_ok": walk_ok,
            "covered": covered, "ways": ways, "matched": sum(e.length_m for e in edges), "recheck_ms": ms}


def main() -> int:
    variants = ["baseline", "a_bicycle", "b_gh_quiet", "gh_foot"]
    rows = []
    with Valhalla() as v, httpx.Client(base_url=GH_URL, timeout=60) as gh:
        gh.get("/health").raise_for_status()
        for label, a, b in all_pairs():
            row = {"pair": label}
            for name in variants:
                try:
                    if name == "baseline":
                        shape, ms = valhalla_pedestrian(v, a, b)
                    elif name == "a_bicycle":
                        shape, ms = valhalla_bicycle(v, a, b)
                    elif name == "b_gh_quiet":
                        shape, ms = graphhopper(gh, "foot_quiet", a, b)
                    else:
                        shape, ms = graphhopper(gh, "foot_direct", a, b)
                    r = assess(v, shape)
                    r["ms"] = ms
                    row[name] = r
                except (ValhallaError, RuntimeError, httpx.HTTPError) as err:
                    row[name] = {"error": str(err)[:120]}
            rows.append(row)
            base = row["baseline"]
            if "error" not in base:
                print(f"{label:34s} base {base['length']:7.0f} m main {base['main']:6.0f}  " + "  ".join(
                    f"{n} " + ("ERR" if "error" in row[n] else f"{row[n]['length']:7.0f}/{row[n]['main']:6.0f}")
                    for n in variants[1:]), flush=True)

    # OSM tag judgement on every way any variant used
    used = set().union(*(r[n]["ways"] for r in rows for n in variants if "error" not in r[n]))
    tags = way_tags(PBF, used)
    bad_ways = {w for w, t in tags.items() if not is_walkable(t) and t.get("route") != "ferry"}

    def summary(name):
        ok = [r for r in rows if "error" not in r[name] and "error" not in r["baseline"] and r["baseline"]["length"] > 0]
        if not ok:
            return None
        main_share = [r[name]["main"] / r[name]["length"] * 100 for r in ok]
        base_main = [r["baseline"]["main"] for r in ok]
        extra = [(r[name]["length"] - r["baseline"]["length"]) / r["baseline"]["length"] * 100 for r in ok]
        cut = [(r["baseline"]["main"] - r[name]["main"]) for r in ok]
        overlap = [len(r[name]["keys"] & r["baseline"]["keys"]) / len(r[name]["keys"] | r["baseline"]["keys"]) * 100
                   for r in ok if r[name]["keys"] | r["baseline"]["keys"]]
        ms = [r[name]["ms"] + (r[name]["recheck_ms"] if name == "a_bicycle" else 0) for r in ok]
        inexact = [r for r in ok if not r[name]["exact"]]
        not_walk = [r for r in ok if not r[name]["walk_ok"]]
        tag_bad = [r for r in ok if r[name]["ways"] & bad_ways]
        with_main = [r for r in ok if r["baseline"]["main"] > 200]
        return {
            "n": len(ok), "errors": sum(1 for r in rows if "error" in r[name]),
            "main_share_median": statistics.median(main_share),
            "main_m_total": sum(r[name]["main"] for r in ok), "base_main_m_total": sum(base_main),
            "main_cut_pct_total": (1 - sum(r[name]["main"] for r in ok) / sum(base_main)) * 100 if sum(base_main) else 0,
            "extra_median": statistics.median(extra), "extra_p90": sorted(extra)[int(0.9 * (len(extra) - 1))],
            "extra_max": max(extra),
            "routes_with_main": len(with_main),
            "routes_main_halved": sum(1 for r in with_main if r[name]["main"] <= 0.5 * r["baseline"]["main"]),
            "overlap_median": statistics.median(overlap) if overlap else None,
            "under_60": sum(1 for o in overlap if o < 60),
            "inexact": len(inexact), "not_walk": len(not_walk), "tag_bad": len(tag_bad),
            "tag_bad_examples": sorted({w for r in tag_bad for w in r[name]["ways"] & bad_ways})[:8],
            "ms_p50": statistics.median(ms), "ms_p95": sorted(ms)[int(0.95 * (len(ms) - 1))],
            "cut_median": statistics.median(cut),
        }

    S = {n: summary(n) for n in variants}
    # Cross-engine: GraphHopper plain foot vs Valhalla pedestrian length
    cross = [abs(r["gh_foot"]["length"] - r["baseline"]["length"]) / r["baseline"]["length"] * 100
             for r in rows if "error" not in r["gh_foot"] and "error" not in r["baseline"] and r["baseline"]["length"] > 0]

    OUT.mkdir(parents=True, exist_ok=True)
    md = [
        "# Phase 3 spike: building the \"fewer main roads\" alternative", "",
        "Pinned Kerala extract (2026-11-15). Valhalla 3.9.2 and GraphHopper 11.1, both on that file. Ferries are "
        "excluded in every variant. Measured on the development laptop, Valhalla and GraphHopper running together.", "",
        f"Routes: the {len(PAIRS['pairs'])} fixed origin/destination pairs from Phase 2 plus {len(NAMED)} named pairs "
        "(worked-example legs and the Thamarassery road).", "",
        "**Yardstick.** Every geometry is matched onto Valhalla's pedestrian edges (`trace_attributes`, `edge_walk`, "
        "falling back to map matching), which gives road class and edge identity. Main-road metres are the ellipsoid "
        "length of matched trunk and primary edges. Lengths are ellipsoid lengths of each variant's own geometry.", "",
        "**Pedestrian access** is judged twice: (1) Valhalla pedestrian `map_snap` matching must cover the whole "
        "geometry (within 1% or 30 m); map_snap only uses edges pedestrians may use, so a route over a `foot=no` "
        "edge leaves a gap; and (2) no matched OSM way may be unwalkable by its tags in the pinned extract "
        "(`foot=no/private`, `access=no/private` without a foot override, or a highway type that is not for "
        "walking). `edge_walk` is NOT an access check: tested on the Feroke Old Bridge (`foot=no`), pedestrian "
        "`edge_walk` accepted a bicycle route across it while pedestrian `map_snap` left 302 m of it unmatched.", "",
        "## Summary", "",
        "| | Valhalla pedestrian (baseline) | (a) Valhalla bicycle, use_roads 0 | (b) GraphHopper foot, trunk/primary x0.2 |",
        "| --- | --- | --- | --- |",
    ]

    def cell(name, fn):
        s = S[name]
        return "-" if s is None else fn(s)

    lines = [
        ("Routes compared", lambda s: f"{s['n']} ({s['errors']} without a route)"),
        ("Trunk + primary share, median route", lambda s: f"{s['main_share_median']:.1f}%"),
        ("Trunk + primary metres, all routes", lambda s: f"{s['main_m_total'] / 1000:.1f} km ({-s['main_cut_pct_total']:+.0f}% vs baseline)"),
        ("Routes where baseline has > 200 m of main road: main-road metres at least halved",
         lambda s: f"{s['routes_main_halved']} of {s['routes_with_main']}"),
        ("Extra length vs baseline, median / p90 / max", lambda s: f"{s['extra_median']:+.1f}% / {s['extra_p90']:+.1f}% / {s['extra_max']:+.1f}%"),
        ("Edge overlap with baseline, median (alternatives kept below 60%)",
         lambda s: "-" if s["overlap_median"] is None else f"{s['overlap_median']:.0f}% ({s['under_60']} routes under 60%)"),
        ("Pedestrian map_snap covers less than the geometry (1% / 30 m): likely access violation",
         lambda s: f"{s['not_walk']} routes"),
        ("(info) pedestrian edge_walk cannot follow the geometry exactly", lambda s: f"{s['inexact']} routes"),
        ("Uses an OSM way that is unwalkable by its tags", lambda s: f"{s['tag_bad']} routes"),
        ("Latency p50 / p95 (a: bicycle route + pedestrian re-check)", lambda s: f"{s['ms_p50']:.0f} / {s['ms_p95']:.0f} ms"),
    ]
    for title, fn in lines:
        md.append(f"| {title} | " + " | ".join(cell(n, fn) for n in ("baseline", "a_bicycle", "b_gh_quiet")) + " |")

    md += ["", "## Cross-engine length check (GraphHopper plain foot against Valhalla pedestrian)", "",
           f"Over {len(cross)} routes, the GraphHopper route length differs from Valhalla's by a median "
           f"{statistics.median(cross):.1f}% (p90 {sorted(cross)[int(0.9 * (len(cross) - 1))]:.1f}%, max {max(cross):.1f}%). "
           "Both lengths are ellipsoid lengths of each engine's geometry; differences are path choices, not "
           "measurement. This is the blueprint's deferred 50-pair cross-check, done on the same graph.", "",
           f"GraphHopper plain foot: trunk + primary {cell('gh_foot', lambda s: f'{s['main_share_median']:.1f}%')} median share; "
           f"{cell('gh_foot', lambda s: str(s['not_walk']))} routes with a map_snap coverage gap, "
           f"{cell('gh_foot', lambda s: str(s['tag_bad']))} using a tag-unwalkable way.", ""]

    for name, title in (("a_bicycle", "(a)"), ("b_gh_quiet", "(b)"), ("gh_foot", "GraphHopper plain foot")):
        s = S[name]
        if s and s["tag_bad_examples"]:
            md += [f"Tag-unwalkable ways used by {title}: " + ", ".join(
                f"[{w}](https://www.openstreetmap.org/way/{w}) (`highway={tags[w].get('highway')}`"
                + "".join(f", `{k}={tags[w][k]}`" for k in ("foot", "access") if k in tags[w]) + ")"
                for w in s["tag_bad_examples"]), ""]

    md += ["## Every route", "",
           "| Pair | Baseline (m) | main (m) | (a) length (m) | main (m) | walkable | (b) length (m) | main (m) | walkable | GH foot (m) |",
           "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]

    def c(r, n, key):
        x = r[n]
        if "error" in x:
            return "no route"
        if key == "walk":
            return ("yes" if x["walk_ok"] else f"**no** ({x['covered']:.0f} m covered)") +                 (" **tags**" if x["ways"] & bad_ways else "")
        return f"{x[key]:.0f}"

    for r in rows:
        md.append(f"| {r['pair']} | {c(r, 'baseline', 'length')} | {c(r, 'baseline', 'main')} | "
                  f"{c(r, 'a_bicycle', 'length')} | {c(r, 'a_bicycle', 'main')} | {c(r, 'a_bicycle', 'walk')} | "
                  f"{c(r, 'b_gh_quiet', 'length')} | {c(r, 'b_gh_quiet', 'main')} | {c(r, 'b_gh_quiet', 'walk')} | "
                  f"{c(r, 'gh_foot', 'length')} |")
    md.append("")
    (OUT / "quieter_spike_data.json").write_text(json.dumps(
        {"summary": S, "cross_engine_pct": cross}, indent=1, default=list), encoding="utf-8")
    report = OUT / "quieter_spike_measurements.md"
    report.write_text("\n".join(md), encoding="utf-8")
    for n in variants:
        s = S[n]
        if s:
            print(f"{n:11s} main share med {s['main_share_median']:5.1f}%  main total {s['main_m_total'] / 1000:6.1f} km  "
                  f"extra med {s['extra_median']:+5.1f}%  snap-gap {s['not_walk']}  tag-bad {s['tag_bad']}  "
                  f"p50 {s['ms_p50']:.0f} ms  p95 {s['ms_p95']:.0f} ms")
    print(f"Report: {report.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
