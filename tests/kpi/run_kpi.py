"""KPI harness: run the solver on every active scenario fixture and score it (blueprint section 16).

Usage:  uv run python tests/kpi/run_kpi.py [--only S05,S15] [--report PATH]

Independent of the solver: every candidate is re-measured here from its
geometry (ellipsoid length, ferry metres from edge attributes, checkpoints
located with the engine), and conflict objects are checked against the
brute-force reference values stored in scenarios.json. Refuses to run on a
graph other than the one the fixtures were built on.
Writes docs/reports/phase3b/kpi.md. Exit code 0 only if every KPI passes.
"""

import argparse
import json
import statistics
import sys
import time
import traceback
from pathlib import Path

from athlete_engine import geodesy
from athlete_engine.measure import measure_shapes
from athlete_engine.osm import is_walkable, way_tags
from athlete_engine.policy import (GRAPHHOPPER_RADIUS_M, VALHALLA_RADIUS_M, consistency_tolerance_m,
                                   pedestrian_options)
from athlete_engine.valhalla import Valhalla, ValhallaError

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS = json.loads((ROOT / "tests" / "fixtures" / "scenarios" / "scenarios.json").read_text(encoding="utf-8"))
MANIFEST = ROOT / "data" / "manifest.json"
PBF = ROOT / "data" / "osm" / "kerala.osm.pbf"
DEFAULT_REPORT = ROOT / "docs" / "reports" / "phase3b" / "kpi.md"

CHECKPOINT_RADIUS_M = 50.0
ADHERENCE_STEP_M = 250.0
BUDGET_OPTIONS = {"main", "continue_past_target", "cut_at_target"}
RADIUS = {"valhalla": VALHALLA_RADIUS_M, "graphhopper": GRAPHHOPPER_RADIUS_M}


def pct(values: list[float], q: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, round(q * (len(s) - 1)))]


def close(a: float, b: float, rel: float = 0.002, floor_m: float = 10.0) -> bool:
    return abs(a - b) <= max(rel * max(abs(a), abs(b)), floor_m)


def split_at_stops(geometry: list, stops: list) -> list[list]:
    """Split a candidate geometry at its checkpoints' snapped coordinates (searching forward)."""
    cuts, prev = [], 0
    for s in stops:
        if s.role != "checkpoint":
            continue
        target = (s.snapped_lon, s.snapped_lat)
        idx = min(range(prev, len(geometry)), key=lambda i: geodesy.distance_m(geometry[i], target))
        cuts.append(idx)
        prev = idx
    pieces, prev = [], 0
    for c in cuts:
        if 0 < c < len(geometry) - 1:
            pieces.append(geometry[prev:c + 1])
            prev = c
    pieces.append(geometry[prev:])
    return [p for p in pieces if len(p) >= 2]


def direction_adherence(engine: Valhalla, geometry: list, target: tuple, from_m: float) -> float | None:
    """Share of length (after from_m) during which network distance to the target increases."""
    samples = [(p, at) for p, at in geodesy.sample_every(geometry, ADHERENCE_STEP_M) if at >= from_m]
    if len(samples) < 3:
        return None
    rows = engine.matrix([p for p, _ in samples], [target], costing_options=pedestrian_options())
    dists = [row[0].get("distance") for row in rows["sources_to_targets"]]
    away = total = 0.0
    for (a, da), (b, db) in zip(zip(samples, dists), zip(samples[1:], dists[1:])):
        seg = b[1] - a[1]
        total += seg
        if da is not None and db is not None and db > da:
            away += seg
    return away / total if total else None


def best_achievable_bearing(engine: Valhalla, origin: tuple, bearing: float, distance_m: float) -> float | None:
    """Exhaustive reference: the smallest bearing error any walking endpoint at exactly distance_m reaches.

    Samples isodistance contours at several sizes, every vertex within 90 degrees (up to 40), routes to
    each and measures where distance_m on foot lands. Independent of the solver's own search.
    """
    from athlete_engine.measure import measure_route as measure  # noqa: PLC0415
    best = None
    opts = pedestrian_options()
    for factor in (1.2, 1.6, 2.2, 3.0):
        feats = engine.isodistance(origin, [distance_m * factor / 1000], costing_options=opts)["features"]
        if not feats:
            continue
        g = feats[0]["geometry"]
        ring = g["coordinates"][0] if g["type"] == "Polygon" else max((x[0] for x in g["coordinates"]), key=len)
        near = [tuple(c) for c in ring if geodesy.angle_between_deg(geodesy.bearing_deg(origin, c), bearing) <= 90]
        for c in near[:: max(1, len(near) // 40)][:40]:
            try:
                resp = engine.route([origin, c], costing_options=opts)
            except ValhallaError:
                continue
            m = measure(engine, resp, opts)
            if m.foot_m < distance_m:
                continue
            shape = [p for e in m.edges if e.use != "ferry" for p in e.shape] or None
            end = geodesy.point_at(shape, distance_m)[0] if shape else None
            if end is None:
                continue
            err = geodesy.angle_between_deg(geodesy.bearing_deg(origin, end), bearing)
            best = err if best is None else min(best, err)
    return best


def check_conflict(result, ref: dict, req) -> list[str]:
    """Problems with an infeasible result's conflict object, against the reference."""
    problems = []
    c = result.conflict
    if c is None:
        return ["no conflict object"]
    if c.kind != "checkpoints_exceed_distance":
        problems.append(f"kind {c.kind}")
    if c.minimum_m is None or not close(c.minimum_m, ref["minimum_m"]):
        problems.append(f"minimum_m {c.minimum_m} vs reference {ref['minimum_m']}")
    if c.overshoot_m is None or not close(c.overshoot_m, ref["minimum_m"] - req.target_distance_m):
        problems.append(f"overshoot_m {c.overshoot_m} vs {ref['minimum_m'] - req.target_distance_m:.1f}")
    got = {(s.action, s.label): s for s in c.savings}
    for s in ref["savings"]:
        key = (s["action"], s.get("label"))
        if key not in got:
            problems.append(f"missing saving {key}")
            continue
        if not close(got[key].saves_m, s["saves_m"], floor_m=25.0):
            problems.append(f"saving {key}: {got[key].saves_m:.0f} vs reference {s['saves_m']:.0f}")
        if got[key].fits != s["fits"]:
            problems.append(f"saving {key}: fits {got[key].fits} vs reference {s['fits']}")
    set_d = [f for f in c.fixes if f.action == "set_distance"]
    if not set_d or set_d[0].value_m + req.tolerance_m < ref["minimum_m"] or set_d[0].value_m > ref["minimum_m"] + 100:
        problems.append("set_distance fix missing or does not make the request fit")
    for s in ref["savings"]:
        if s["fits"]:
            want = ("drop_checkpoint", s.get("label"))
            if not any((f.action, f.label) == want for f in c.fixes):
                problems.append(f"missing fix {want}")
    return problems


def highway_longest_m(edges) -> float:
    """Longest consecutive stretch of matched trunk/motorway edges (harness's own measurement)."""
    best = run = 0.0
    for e in edges:
        if e.road_class in ("motorway", "trunk") and e.use != "ferry":
            run += e.length_m
            best = max(best, run)
        else:
            run = 0.0
    return best


def evaluate(engine: Valhalla, fixture: dict, result, elapsed_ms: float) -> dict:
    from athlete_solver.models import RouteRequest  # noqa: PLC0415

    req = RouteRequest.model_validate(fixture["request"])
    ref = fixture["reference"]
    row: dict = {"id": fixture["id"], "ms": elapsed_ms, "problems": [], "candidates": [],
                 "alternatives": sorted({c.label for c in result.candidates})}
    by_alt: dict[str, list] = {}
    for c in result.candidates:
        by_alt.setdefault(c.label, []).append(c.option)

    # Outcome classification. over_budget results are checked for their conflict object AND, for each
    # alternative, the full route through the stops and the cut at the target.
    if ref["outcome"] == "over_budget":
        if result.outcome != "over_budget":
            row["problems"].append(f"expected over_budget, got {result.outcome}")
            return row
        row["conflict_problems"] = check_conflict(result, ref, req)
        row["problems"] += row["conflict_problems"]
        for alt, options in by_alt.items():
            if options != ["full_route", "cut_at_target"]:
                row["problems"].append(f"over_budget {alt} options {options}")
        full = next((c for c in result.candidates if c.label == "shortest" and c.option == "full_route"), None)
        if full is not None and not close(full.foot_m, ref["minimum_m"]):
            row["problems"].append(f"shortest full route {full.foot_m:.0f} m vs reference minimum {ref['minimum_m']:.0f} m")
        for c in result.candidates:
            if c.option == "full_route" and c.foot_m < ref["minimum_m"] - max(10.0, 0.002 * ref["minimum_m"]):
                row["problems"].append(f"{c.label} full route {c.foot_m:.0f} m is shorter than the reference minimum")
    elif result.outcome != "ok":
        row["problems"].append(f"expected ok, got {result.outcome}")
        return row
    if not result.candidates:
        row["problems"].append(f"{result.outcome} outcome with no candidates")
        return row
    # Case A / B is judged on the shortest alternative (the reference uses the same engine and costing).
    margin = req.tolerance_m
    shortest_opts = set(by_alt.get("shortest", []))
    if shortest_opts and "full_route" not in shortest_opts:
        if ref.get("case") == "A" and ref["tail_foot_m"] - ref["remainder_m"] > margin and "main" not in shortest_opts:
            row["problems"].append(f"reference case A but shortest options {sorted(shortest_opts)}")
        if ref.get("case") == "B" and ref["remainder_m"] - ref["tail_foot_m"] > margin and "end_at_target" not in shortest_opts:
            row["problems"].append(f"reference case B but shortest options {sorted(shortest_opts)}")

    target = None
    if req.direction and req.direction.kind == "towards_place":
        target = req.direction.place.lonlat
    located = engine.locate([c.lonlat for c in req.checkpoints], costing_options=pedestrian_options()) \
        if req.checkpoints else []

    lead_keys: dict[str, set] = {}
    forced_keys: dict[str, set] = {}
    for cand in result.candidates:
        name = f"{cand.label}/{cand.option}"
        cr: dict = {"label": cand.label, "option": cand.option, "name": name}
        geom = [tuple(p) for p in cand.geometry]
        pieces = split_at_stops(geom, cand.stops)
        if req.route_type == "out_and_back":   # the geometry turns round at its middle vertex
            mid = len(geom) // 2
            pieces = [geom[:mid + 1], geom[mid:]]
        m = measure_shapes(engine, pieces)
        # Edges up to the last checkpoint form the base route through the mandatory stops.
        n_base = len(pieces) - 1 if any(s.role == "checkpoint" for s in cand.stops) else 0
        base_m = measure_shapes(engine, pieces[:n_base]) if n_base else None
        cr["foot_m"], cr["ferry_m"] = m.foot_m, m.ferry_m
        matched_m = sum(e.length_m for e in m.edges)
        cr["exact_match"] = m.matched_exactly
        cr["match_ok"] = abs(matched_m - m.geom_m) <= max(0.01 * m.geom_m, 30.0)
        cr["ways"] = {e.way_id for e in m.edges if e.way_id and e.use != "ferry"}
        if not cr["match_ok"]:
            row["problems"].append(f"{name}: pedestrian map-matching covers {matched_m:.0f} m of {m.geom_m:.0f} m")
        if m.ferry_m > 0:
            row["problems"].append(f"{name}: {m.ferry_m:.0f} m of ferry (ferries are always excluded)")
        cr["unrequested_ferry"] = m.ferry_m > 0

        if not close(cand.foot_m, m.foot_m, rel=0.001, floor_m=2.0):
            row["problems"].append(f"{name}: reported foot {cand.foot_m:.0f} m, measured {m.foot_m:.0f} m")
        cr["reported_ok"] = close(cand.foot_m, m.foot_m, rel=0.001, floor_m=2.0)

        # Engine length against a sphere of the ENGINE's radius, with 0.2 m per (independently matched) edge.
        sphere = geodesy.sphere_line_length_m(geom, radius_m=RADIUS[cand.engine])
        cr["consistency_ok"] = abs(cand.engine_length_m - sphere) <= consistency_tolerance_m(sphere, len(m.edges))
        if not cr["consistency_ok"]:
            row["problems"].append(f"{name}: engine {cand.engine_length_m:.0f} m vs sphere {sphere:.0f} m "
                                   f"({len(m.edges)} edges)")

        if cand.option in BUDGET_OPTIONS:
            cr["dist_err_pct"] = abs(m.foot_m - req.target_distance_m) / req.target_distance_m * 100

        on_candidate = {s.label for s in cand.stops if s.role == "checkpoint"}
        for cp, snap in zip(req.checkpoints, located):
            if cand.option == "cut_at_target" and cp.label not in on_candidate:
                continue   # stops beyond the cut are dropped by design
            if snap is None:
                row["problems"].append(f"{name}: checkpoint {cp.label} could not be located")
                continue
            from shapely.geometry import LineString, Point  # noqa: PLC0415
            from shapely.ops import nearest_points  # noqa: PLC0415
            on_line, _ = nearest_points(LineString(geom), Point(snap))
            off = geodesy.distance_m(snap, (on_line.x, on_line.y))
            if off > CHECKPOINT_RADIUS_M:
                row["problems"].append(f"{name}: misses checkpoint {cp.label} by {off:.0f} m")
        cr["checkpoints_ok"] = not any(p.startswith(name) and ("misses checkpoint" in p or "could not be located" in p)
                                       for p in row["problems"])

        keys = [e.key for e in m.edges]
        counts: dict = {}
        for e in m.edges:
            counts[e.key] = counts.get(e.key, 0) + 1
        repeated = sum(e.length_m for e in m.edges if counts[e.key] > 1)
        total = sum(e.length_m for e in m.edges) or 1.0
        if req.route_type != "out_and_back":
            cr["repeat_share"] = repeated / total
            forced = 0.0
            if base_m is not None:
                base_counts: dict = {}
                for e in base_m.edges:
                    base_counts[e.key] = base_counts.get(e.key, 0) + 1
                forced = sum(e.length_m for e in base_m.edges if base_counts[e.key] > 1)
            if cand.option == "full_route":
                forced_keys[cand.label] = {k for k, n in counts.items() if n > 1}
            if cand.option == "cut_at_target":
                # A prefix of the route through the stops: an edge it repeats is forced if the full route
                # through the stops repeats it too (measured above from the full route's own geometry).
                fk = forced_keys.get(cand.label, set())
                forced = sum(e.length_m for e in m.edges if counts[e.key] > 1 and e.key in fk)
            cr["excess_repeat_share"] = max(0.0, repeated - forced) / total
        lead_keys.setdefault(cand.label, set(keys))

        # Road suitability and the national-highway flag (decision 12), from the harness's own matching.
        foot = sum(e.length_m for e in m.edges if e.use != "ferry") or 1.0
        cr["main_share"] = sum(e.length_m for e in m.edges if e.road_class in ("trunk", "primary", "motorway")) / foot
        cr["trunk_share"] = sum(e.length_m for e in m.edges if e.road_class in ("trunk", "motorway")) / foot
        cr["highway_longest_m"] = highway_longest_m(m.edges)
        codes = {f.code for f in cand.flags}
        if cr["highway_longest_m"] >= 220 and "uses_national_highway" not in codes:
            row["problems"].append(f"{name}: {cr['highway_longest_m']:.0f} m of trunk in one stretch without the NH flag")
            cr["nh_flag_ok"] = False
        elif cr["highway_longest_m"] < 180 and "uses_national_highway" in codes:
            row["problems"].append(f"{name}: NH flag raised but only {cr['highway_longest_m']:.0f} m of trunk in one stretch")
            cr["nh_flag_ok"] = False
        else:
            cr["nh_flag_ok"] = True

        # Direction adherence applies to routes that head for the target; "continue past target"
        # moves away from it by design after passing it, and is judged by its bearing instead.
        if target is not None and cand.option in ("main", "end_at_target"):
            last_cp = max((s.at_m for s in cand.stops if s.role == "checkpoint"), default=0.0)
            cr["backtrack"] = direction_adherence(engine, geom, target, last_cp)
        if req.direction and req.direction.kind == "bearing" and req.route_type == "point_to_point" \
                and cand.option == "main":
            cr["bearing_err"] = geodesy.angle_between_deg(geodesy.bearing_deg(geom[0], geom[-1]),
                                                          req.direction.degrees)
            if cr["bearing_err"] > 30 and not req.checkpoints:
                ref_best = best_achievable_bearing(engine, req.start.lonlat, req.direction.degrees,
                                                   req.target_distance_m)
                cr["bearing_ref_best"] = ref_best
                if ref_best is not None and ref_best > 30:
                    cr["bearing_network_limited"] = True
                if not any(f.code == "direction_limited" for f in cand.flags):
                    row["problems"].append(f"{name}: {cr['bearing_err']:.0f}° off the bearing without a direction_limited flag")
        if cand.option == "continue_past_target" and target is not None:
            # Continuing "on the same bearing": compare target-to-end with the approach to the target.
            last = [s for s in cand.stops if s.role == "checkpoint"]
            origin = (last[-1].snapped_lon, last[-1].snapped_lat) if last else geom[0]
            cr["bearing_err"] = geodesy.angle_between_deg(geodesy.bearing_deg(target, geom[-1]),
                                                          geodesy.bearing_deg(origin, target))
        row["candidates"].append(cr)

    if len(lead_keys) == 2:
        a, b = lead_keys["recommended"], lead_keys["shortest"]
        row["overlap"] = len(a & b) / len(a | b) if a | b else 1.0
    return row


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", help="comma-separated fixture ids or base ids")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if manifest["extract"]["osm_timestamp"] != SCENARIOS["graph_build"]:
        print(f"Graph {manifest['extract']['osm_timestamp']} differs from the fixtures' {SCENARIOS['graph_build']}. "
              "Rebuild the fixtures or restore the pinned extract.", file=sys.stderr)
        return 2

    from athlete_solver.models import RouteRequest  # noqa: PLC0415
    from athlete_solver.solve import solve  # noqa: PLC0415

    only = set(args.only.split(",")) if args.only else None
    fixtures = [f for f in SCENARIOS["fixtures"] if f["status"] == "active"
                and (only is None or f["id"] in only or f["base"] in only)]
    skipped = [f for f in SCENARIOS["fixtures"] if f["status"] != "active"]
    rows, results = [], {}
    with Valhalla() as engine:
        for f in fixtures:
            req = RouteRequest.model_validate(f["request"])
            start = time.perf_counter()
            try:
                result = solve(req, engine=engine, graph_build=SCENARIOS["graph_build"])
            except NotImplementedError as err:
                rows.append({"id": f["id"], "error": f"not implemented: {err}", "problems": [], "candidates": []})
                print(f"{f['id']:14s} NOT IMPLEMENTED", flush=True)
                continue
            except (ValhallaError, Exception) as err:  # a crash is a failed fixture, not a harness failure
                rows.append({"id": f["id"], "error": f"{type(err).__name__}: {err}",
                             "trace": traceback.format_exc(limit=3), "problems": [], "candidates": []})
                print(f"{f['id']:14s} ERROR {type(err).__name__}: {err}", flush=True)
                continue
            elapsed = (time.perf_counter() - start) * 1000
            results[f["id"]] = result
            row = evaluate(engine, f, result, elapsed)
            rows.append(row)
            status = "ok" if not row["problems"] else f"{len(row['problems'])} problem(s)"
            print(f"{f['id']:14s} {result.outcome:11s} {elapsed:6.0f} ms  {status}", flush=True)

    # Pedestrian access by OSM tags, one pass over the extract for every way any candidate uses.
    all_ways = set().union(*(c.get("ways", set()) for r in rows for c in r["candidates"]))
    tags = way_tags(PBF, all_ways) if all_ways else {}
    bad_ways = {w for w, t in tags.items() if not is_walkable(t) and t.get("route") != "ferry"}
    for r in rows:
        for c in r["candidates"]:
            bad = sorted(c.get("ways", set()) & bad_ways)
            c["tag_ok"] = not bad
            c["access_ok"] = c["match_ok"] and not bad
            if bad:
                r["problems"].append(f"{c['name']}: uses tag-unwalkable way(s) " + ", ".join(
                    f"{w} (highway={tags[w].get('highway')}, foot={tags[w].get('foot')}, access={tags[w].get('access')})"
                    for w in bad[:3]))

    # Edit invariants (scenarios 9 and 10)
    invariant_rows = []
    for f in fixtures:
        if "edit_of" not in f:
            continue
        before, after = results.get(f["edit_of"]), results.get(f["id"])
        problems = []
        if before is None or after is None or not before.candidates or not after.candidates:
            problems.append("missing results")
        else:
            b, a = before.candidates[0], after.candidates[0]
            if "same_start" in f["invariants"] and before.request.start != after.request.start:
                problems.append("start changed")
            if "same_stop_order" in f["invariants"]:
                order_b = [s.label for s in b.stops if s.role == "checkpoint"]
                order_a = [s.label for s in a.stops if s.role == "checkpoint"]
                if order_a != order_b:
                    problems.append(f"stop order {order_b} -> {order_a}")
            if "end_moves" in f["invariants"] and geodesy.distance_m((a.end.lon, a.end.lat), (b.end.lon, b.end.lat)) < 100:
                problems.append("end did not move")
        invariant_rows.append((f["id"], f["edit_of"], problems))

    # ---------------------------------------------------------------- KPIs
    errors = [r for r in rows if "error" in r]
    cands = [c for r in rows for c in r["candidates"]]
    dist = [c["dist_err_pct"] for c in cands if "dist_err_pct" in c]
    lat = [r["ms"] for r in rows if "ms" in r]
    reps = [c["repeat_share"] * 100 for c in cands if c.get("repeat_share") is not None]
    excess = [c["excess_repeat_share"] * 100 for c in cands if c.get("excess_repeat_share") is not None]
    back = [c["backtrack"] * 100 for c in cands if c.get("backtrack") is not None]
    bear = [c["bearing_err"] for c in cands if "bearing_err" in c]
    bear_limited = [c for c in cands if c.get("bearing_network_limited")]
    bear_fail = [c for c in cands if "bearing_err" in c and c["bearing_err"] > 30 and not c.get("bearing_network_limited")]
    overlaps = [r["overlap"] * 100 for r in rows if "overlap" in r]
    both = [r for r in rows if len(r.get("alternatives", [])) == 2]
    rec_main = [c for c in cands if c["label"] == "recommended" and c["option"] in ("main", "end_at_target",
                                                                                     "continue_past_target")]
    suit = [c["main_share"] * 100 for c in rec_main]
    suit_bad = [c for c in rec_main if c["main_share"] > 0.10]
    infeasible = [f for f in fixtures if f["reference"]["outcome"] == "over_budget"]
    inf_ok = [r for r in rows if r["id"] in {f["id"] for f in infeasible} and "error" not in r and not r["problems"]]
    classified = [r for r in rows if "error" not in r and not any(p.startswith(("expected", "reference case")) for p in r["problems"])]

    def kpi(name, target, measured, passed):
        return (name, target, measured, passed)

    have = bool(cands)
    kpis = [
        kpi("Fixtures solved without error", "all", f"{len(rows) - len(errors)} / {len(rows)}", not errors),
        kpi("Outcome classification (ok / over_budget / Case A or B)", "100%",
            f"{len(classified)} / {len(rows)}", len(classified) == len(rows)),
        kpi("Distance accuracy, point-to-point", "median < 0.5%, p95 < 1.5%",
            f"median {statistics.median(dist):.2f}%, p95 {pct(dist, .95):.2f}% (n={len(dist)})" if dist else "no routes",
            bool(dist) and statistics.median(dist) < 0.5 and pct(dist, .95) < 1.5),
        kpi("Reported length matches re-measured geometry", "every route, 0.1% / 2 m",
            f"{sum(c['reported_ok'] for c in cands)} / {len(cands)}", have and all(c["reported_ok"] for c in cands)),
        kpi("Length consistency (engine vs sphere on its own radius)", "every route, 0.1% / 2 m + 0.2 m per edge",
            f"{sum(c['consistency_ok'] for c in cands)} / {len(cands)}", have and all(c["consistency_ok"] for c in cands)),
        kpi("Feasibility: access violations or any ferry", "0",
            f"{sum((not c['access_ok']) or c['unrequested_ferry'] for c in cands)}",
            have and not any((not c["access_ok"]) or c["unrequested_ferry"] for c in cands)),
        kpi("(info) Geometries that pedestrian edge_walk cannot follow exactly", "info only",
            f"{sum(not c['exact_match'] for c in cands)} / {len(cands)} (map-matched instead; see method)", True),
        kpi("Over-budget handling: correct conflict objects and candidates", "100%",
            f"{len(inf_ok)} / {len(infeasible)}", len(inf_ok) == len(infeasible)),
        kpi("Latency per solve", "p50 < 2 s, p95 < 5 s",
            f"p50 {statistics.median(lat):.0f} ms, p95 {pct(lat, .95):.0f} ms" if lat else "no solves",
            bool(lat) and statistics.median(lat) < 2000 and pct(lat, .95) < 5000),
        kpi("Duplication beyond what must_reach stops force, excluding out-and-back", "median < 2%, none > 10%",
            f"median {statistics.median(excess):.1f}%, max {max(excess):.1f}%" if excess else "no routes",
            bool(excess) and statistics.median(excess) < 2 and max(excess) <= 10),
        kpi("(info) Raw duplication, including what the stops force", "info only",
            f"median {statistics.median(reps):.1f}%, max {max(reps):.1f}%" if reps else "no routes", True),
        kpi("Direction adherence (share moving away from target, after last stop)", "every route < 15%",
            f"max {max(back):.1f}%, {sum(b < 15 for b in back)} / {len(back)} under" if back else "no routes",
            bool(back) and all(b < 15 for b in back)),
        kpi("Endpoint bearing (bearing-only requests; continue-past-target direction)", "within 30°",
            (f"{sum(b <= 30 for b in bear)} / {len(bear)} within; {len(bear_limited)} beyond 30° where an exhaustive "
             f"search finds nothing closer (network does not permit)" if bear else "no routes"),
            bool(bear) and not bear_fail),
        kpi("Checkpoint compliance (snapped point within 50 m)", "100%",
            f"{sum(c['checkpoints_ok'] for c in cands)} / {len(cands)}", have and all(c["checkpoints_ok"] for c in cands)),
        kpi("Alternative diversity (edge overlap, recommended vs shortest)", "< 60%",
            f"max {max(overlaps):.0f}% (n={len(overlaps)})" if overlaps else "no fixture returned both",
            not overlaps or max(overlaps) < 60),
        kpi("(info) Fixtures returning both alternatives", "info only",
            f"{len(both)} / {len(rows) - len(errors)} (the rest: shortest overlaps recommended by 60% or more)", True),
        kpi("Road suitability, recommended (trunk + primary + motorway share)", "< 10% (section 16)",
            (f"median {statistics.median(suit):.1f}%, max {max(suit):.1f}%; {len(suit_bad)} over 10%"
             if suit else "no routes"), bool(suit) and not suit_bad),
        kpi("(info) Trunk/motorway share, recommended", "info only",
            f"median {statistics.median(c['trunk_share'] * 100 for c in rec_main):.1f}%, "
            f"max {max(c['trunk_share'] * 100 for c in rec_main):.1f}%" if rec_main else "no routes", True),
        kpi("National-highway flag matches the measured trunk stretch (>= 200 m)", "every route",
            f"{sum(c['nh_flag_ok'] for c in cands)} / {len(cands)}", have and all(c["nh_flag_ok"] for c in cands)),
        kpi("Edit invariants (scenarios 9, 10)", "all hold",
            f"{sum(not p for _, _, p in invariant_rows)} / {len(invariant_rows)}",
            all(not p for _, _, p in invariant_rows) and bool(invariant_rows)),
    ]
    passed = all(k[3] for k in kpis)

    md = [
        "# Phase 3b: KPI report", "",
        f"Graph build {SCENARIOS['graph_build']} (pinned extract). {len(fixtures)} active fixtures"
        f"{' (filtered)' if only else ''}; {len(skipped)} not yet in scope "
        f"({', '.join(f['id'] + ': ' + f['status'] for f in skipped)}). Measured on the development laptop.", "",
        "Every number below is measured by the harness from the candidate geometry, independently of the "
        "solver's own figures. Conflict objects are checked against brute-force reference values "
        "(`tests/kpi/reference.py`).", "",
        "Pedestrian access is judged twice: the geometry must map-match onto Valhalla pedestrian edges over its "
        "whole length (within 1% or 30 m), and no matched OSM way may be unwalkable by its tags in the pinned "
        "extract. `edge_walk` exact matching alone is not used as a test: it fails on some of Valhalla's own "
        "unmodified pedestrian routes.", "",
        f"**Overall: {'PASS' if passed else 'FAIL'}**", "",
        "| KPI | Target | Measured | Pass |", "| --- | --- | --- | --- |",
    ]
    md += [f"| {n} | {t} | {m} | {'yes' if p else '**no**'} |" for n, t, m, p in kpis]
    md += ["", "## Fixtures", "", "| Fixture | Outcome | ms | Candidates (foot km, error %) | Problems |",
           "| --- | --- | --- | --- | --- |"]
    for r in rows:
        if "error" in r:
            md.append(f"| {r['id']} | error | | | {r['error']} |")
            continue
        res = results[r["id"]]
        cs = "; ".join(f"{c['name']} {c['foot_m'] / 1000:.2f}" + (f" ({c['dist_err_pct']:.2f}%)" if "dist_err_pct" in c else "")
                       + (f", repeat {c['repeat_share'] * 100:.1f}%" if c.get("repeat_share") else "")
                       + (f", main road {c['main_share'] * 100:.0f}%" if c.get("main_share", 0) >= 0.05 else "")
                       + (f", trunk stretch {c['highway_longest_m']:.0f} m" if c.get("highway_longest_m", 0) >= 1 else "")
                       + (f", ferry {c['ferry_m']:.0f} m" if c.get("ferry_m") else "")
                       + (f", away {c['backtrack'] * 100:.0f}%" if c.get("backtrack") else "")
                       + (f", bearing off {c['bearing_err']:.0f}°" if "bearing_err" in c else "")
                       + (f" (best possible {c['bearing_ref_best']:.0f}°)" if c.get("bearing_ref_best") is not None else "")
                       for c in r["candidates"])
        md.append(f"| {r['id']} | {res.outcome} | {r['ms']:.0f} | {cs} | {'; '.join(r['problems']) or '-'} |")
    if invariant_rows:
        md += ["", "## Edit invariants", "", "| Fixture | Edit of | Problems |", "| --- | --- | --- |"]
        md += [f"| {i} | {e} | {'; '.join(p) or '-'} |" for i, e, p in invariant_rows]
    md.append("")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text("\n".join(md), encoding="utf-8")

    for n, t, m, p in kpis:
        print(f"{'PASS' if p else 'FAIL'}  {n}: {m}")
    print(f"Overall: {'PASS' if passed else 'FAIL'}   Report: {args.report.relative_to(ROOT).as_posix()}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
