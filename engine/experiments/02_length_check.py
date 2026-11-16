"""Step 5: does Valhalla's reported length agree with the geometry it returns?

Usage:  uv run python engine/experiments/02_length_check.py

For each fixed pair in tests/fixtures/od_pairs.json: pedestrian route, engine
summary length versus the WGS84 geodesic length of the decoded polyline6 shape.
Acceptance (blueprint sections 15 and 16): agreement within 0.5% on every route.
Writes docs/reports/phase2/length_check.md.
"""

import json
import statistics
import sys
from pathlib import Path

from athlete_engine import geodesy
from athlete_engine.valhalla import Valhalla, ValhallaError, route_length_m, route_shape

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "reports" / "phase2"
PAIRS = json.loads((ROOT / "tests" / "fixtures" / "od_pairs.json").read_text(encoding="utf-8"))
LIMIT_PCT = 0.5
BANDS_KM = [(0, 1), (1, 5), (5, 15), (15, 30), (30, 1000)]


def measure(engine: Valhalla, pair: dict) -> dict:
    a = (pair["from"]["lon"], pair["from"]["lat"])
    b = (pair["to"]["lon"], pair["to"]["lat"])
    try:
        resp = engine.route([a, b])
    except ValhallaError as err:
        return {"id": pair["id"], "error": str(err.body)}
    shape = route_shape(resp)
    engine_m = route_length_m(resp)
    geom_m = geodesy.line_length_m(shape)
    sphere_m = geodesy.sphere_line_length_m(shape)
    # 0 = route runs purely east-west, 1 = purely north-south (length-weighted, on the ellipsoid)
    ns_m = sum(geodesy.distance_m((p[0], p[1]), (p[0], q[1])) for p, q in zip(shape, shape[1:]))
    ew_m = sum(geodesy.distance_m((p[0], p[1]), (q[0], p[1])) for p, q in zip(shape, shape[1:]))
    return {"id": pair["id"], "engine_m": engine_m, "geom_m": geom_m, "diff_m": engine_m - geom_m,
            "gap_pct": geodesy.percent_gap(engine_m, geom_m), "points": len(shape),
            "sphere_m": sphere_m, "sphere_gap_pct": geodesy.percent_gap(engine_m, sphere_m),
            "ns_share": ns_m / (ns_m + ew_m) if ns_m + ew_m else 0.0,
            "ms": engine.last_elapsed_ms}


def main() -> int:
    with Valhalla() as engine:
        version = engine.status().get("version")
        rows = [measure(engine, pair) for pair in PAIRS["pairs"]]

    ok_rows = [r for r in rows if "error" not in r]
    failed = [r for r in rows if "error" in r]
    over = [r for r in ok_rows if r["gap_pct"] > LIMIT_PCT]
    gaps = sorted(r["gap_pct"] for r in ok_rows)
    p95 = gaps[min(len(gaps) - 1, int(round(0.95 * (len(gaps) - 1))))] if gaps else float("nan")

    md = [
        "# Phase 2: engine length versus geometry length", "",
        f"Valhalla {version}, pedestrian costing, OSM data {PAIRS['osm_timestamp']}. "
        f"{len(rows)} fixed pairs (seed {PAIRS['seed']}) sampled from walkable OSM ways around Kozhikode.", "",
        "Engine length is `trip.summary.length`. Geometry length is the geodesic length on the WGS84 "
        "ellipsoid (pyproj) of the route shape decoded at polyline precision 6.", "",
        "## Summary", "",
        f"- Routes measured: {len(ok_rows)}; no route found: {len(failed)}",
        f"- Largest gap: {max(gaps):.3f}%; 95th percentile: {p95:.3f}%; median: {statistics.median(gaps):.3f}%",
        f"- Routes over the {LIMIT_PCT}% limit: {len(over)}",
        f"- Largest absolute difference: {max(abs(r['diff_m']) for r in ok_rows):.1f} m", "",
        f"**{'PASS' if not over and ok_rows else 'FAIL'}** against the {LIMIT_PCT}% rule.", "",
        "## By routed length", "",
        "| Engine length band (km) | Routes | Max gap (%) | Median gap (%) | Max abs difference (m) |",
        "| --- | --- | --- | --- | --- |",
    ]
    for lo, hi in BANDS_KM:
        band = [r for r in ok_rows if lo * 1000 <= r["engine_m"] < hi * 1000]
        if band:
            label = f"{lo} to {hi}" if hi < 1000 else f"over {lo}"
            md.append(f"| {label} | {len(band)} | {max(r['gap_pct'] for r in band):.3f} | "
                      f"{statistics.median(r['gap_pct'] for r in band):.3f} | "
                      f"{max(abs(r['diff_m']) for r in band):.1f} |")
    sphere_gaps = sorted(r["sphere_gap_pct"] for r in ok_rows)
    longer = sum(1 for r in ok_rows if r["diff_m"] > 0)
    md += ["", "## Diagnostic: sphere versus ellipsoid", "",
           "The same shapes measured on a sphere of radius 6,378,137 m (the WGS84 semi-major axis). "
           "If the engine measures on a sphere, its length should match this closely and the gap to the "
           "ellipsoid should grow with how north-south a route runs.", "",
           f"- Engine longer than ellipsoid geometry on {longer} of {len(ok_rows)} routes",
           f"- Engine versus sphere length: max gap {max(sphere_gaps):.3f}%, median {statistics.median(sphere_gaps):.3f}%",
           f"- Engine versus ellipsoid length: max gap {max(gaps):.3f}%, median {statistics.median(gaps):.3f}%", "",
           "| North-south share of route | Routes | Median gap to ellipsoid (%) | Median gap to sphere (%) |",
           "| --- | --- | --- | --- |"]
    for lo, hi in [(0.0, 0.35), (0.35, 0.5), (0.5, 0.65), (0.65, 1.01)]:
        band = [r for r in ok_rows if lo <= r["ns_share"] < hi]
        if band:
            md.append(f"| {lo:.2f} to {min(hi, 1.0):.2f} | {len(band)} | "
                      f"{statistics.median(r['gap_pct'] for r in band):.3f} | "
                      f"{statistics.median(r['sphere_gap_pct'] for r in band):.3f} |")
    md += ["", "**Reading.** The gap is not noise. The engine is longer than the ellipsoid measurement on "
           "every route, agrees closely with a spherical measurement, and the gap rises with the north-south "
           "share. That pattern is what a spherical earth model produces at this latitude (about 11° N), "
           "where a degree of latitude is shorter on the ellipsoid than on a sphere of equatorial radius. "
           "Consequences for Phase 3: (1) take the route length from the geometry on the ellipsoid, not from "
           "the engine summary, when cutting a route at an exact distance; (2) the 0.5% consistency rule "
           "leaves almost no headroom here and a route running due north-south could exceed it with nothing "
           "wrong; (3) matrix distances carry the same bias, which is harmless for ordering stops but matters "
           "when a feasibility decision is within about 0.5% of the budget.", ""]
    md += ["## Every route", "",
           "| Pair | Engine (m) | Geometry, ellipsoid (m) | Engine minus geometry (m) | Gap (%) | Sphere (m) | "
           "Gap to sphere (%) | N-S share | Shape points | Latency (ms) |",
           "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in sorted(ok_rows, key=lambda r: r["engine_m"]):
        flag = " **over**" if r["gap_pct"] > LIMIT_PCT else ""
        md.append(f"| {r['id']} | {r['engine_m']:.0f} | {r['geom_m']:.1f} | {r['diff_m']:+.1f} | "
                  f"{r['gap_pct']:.3f}{flag} | {r['sphere_m']:.1f} | {r['sphere_gap_pct']:.3f} | "
                  f"{r['ns_share']:.2f} | {r['points']} | {r['ms']:.0f} |")
    if failed:
        md += ["", "## Pairs with no route", ""] + [f"- Pair {r['id']}: `{r['error']}`" for r in failed]
    md.append("")

    OUT.mkdir(parents=True, exist_ok=True)
    report = OUT / "length_check.md"
    report.write_text("\n".join(md), encoding="utf-8")
    print(f"Routes: {len(ok_rows)} measured, {len(failed)} without a route")
    print(f"Gap: max {max(gaps):.3f}%  p95 {p95:.3f}%  median {statistics.median(gaps):.3f}%")
    print(f"{'PASS' if not over else 'FAIL'}: {len(over)} routes over {LIMIT_PCT}%")
    print(f"Report: {report.relative_to(ROOT).as_posix()}")
    return 0 if not over and ok_rows else 1


if __name__ == "__main__":
    sys.exit(main())
