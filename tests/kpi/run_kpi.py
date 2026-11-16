"""KPI harness: run the solver on every active scenario fixture and score it (blueprint section 16).

Usage:  uv run python tests/kpi/run_kpi.py [--only S05,S15] [--report PATH]

Independent of the solver: every candidate is re-measured here from its
geometry (ellipsoid length, ferry metres from edge attributes, checkpoints
located with the engine), and conflict objects are checked against the
brute-force reference values stored in scenarios.json. Refuses to run on a
graph other than the one the fixtures were built on.
Writes docs/reports/phase3/kpi.md. Exit code 0 only if every KPI passes.
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
from athlete_engine.policy import consistency_tolerance_m, pedestrian_options
from athlete_engine.valhalla import Valhalla, ValhallaError

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS = json.loads((ROOT / "tests" / "fixtures" / "scenarios" / "scenarios.json").read_text(encoding="utf-8"))
MANIFEST = ROOT / "data" / "manifest.json"
DEFAULT_REPORT = ROOT / "docs" / "reports" / "phase3" / "kpi.md"

CHECKPOINT_RADIUS_M = 50.0
ADHERENCE_STEP_M = 250.0
BUDGET_LABELS = {"direct", "fewer_main_roads", "continue_past_target"}


def pct(values: list[float], q: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, round(q * (len(s) - 1)))]


def close(a: float, b: float, rel: float = 0.002, floor_m: float = 10.0) -> bool:
    return abs(a - b) <= max(rel * max(abs(a), abs(b)), floor_m)


def split_at_stops(geometry: list, stops: list) -> list[list]:
    """Split a candidate geometry at its checkpoint positions so each piece can be edge-walked."""
    cum = geodesy.cumulative_m(geometry)
    cuts = sorted({min(range(len(cum)), key=lambda i: abs(cum[i] - s.at_m))
                   for s in stops if s.role == "checkpoint"})
    pieces, prev = [], 0
    for c in cuts:
        if 0 < c < len(geometry) - 1:
            pieces.append(geometry[prev:c + 1])
            prev = c
    pieces.append(geometry[prev:])
    return [p for p in pieces if len(p) >= 2]


def direction_adherence(engine: Valhalla, geometry: list, target: tuple, from_m: float, ferries: bool) -> float | None:
    """Share of length (after from_m) during which network distance to the target increases."""
    samples = [(p, at) for p, at in geodesy.sample_every(geometry, ADHERENCE_STEP_M) if at >= from_m]
    if len(samples) < 3:
        return None
    rows = engine.matrix([p for p, _ in samples], [target], costing_options=pedestrian_options(ferries))
    dists = [row[0].get("distance") for row in rows["sources_to_targets"]]
    away = total = 0.0
    for (a, da), (b, db) in zip(zip(samples, dists), zip(samples[1:], dists[1:])):
        seg = b[1] - a[1]
        total += seg
        if da is not None and db is not None and db > da:
            away += seg
    return away / total if total else None


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
    got = {(s.action, s.label or s.preference): s for s in c.savings}
    for s in ref["savings"]:
        key = (s["action"], s.get("label") or s.get("preference"))
        if key not in got:
            problems.append(f"missing saving {key}")
            continue
        if not close(got[key].saves_m, s["saves_m"], floor_m=25.0):
            problems.append(f"saving {key}: {got[key].saves_m:.0f} vs reference {s['saves_m']:.0f}")
        if got[key].fits != s["fits"]:
            problems.append(f"saving {key}: fits {got[key].fits} vs reference {s['fits']}")
    upper = 1 + req.tolerance_pct / 100
    set_d = [f for f in c.fixes if f.action == "set_distance"]
    if not set_d or set_d[0].value_m * upper < ref["minimum_m"] or set_d[0].value_m > ref["minimum_m"] + 100:
        problems.append("set_distance fix missing or does not make the request fit")
    for s in ref["savings"]:
        if s["fits"]:
            want = ("drop_checkpoint", s.get("label")) if s["action"] == "drop_checkpoint" else ("allow", s.get("preference"))
            if not any((f.action, f.label or f.preference) == want for f in c.fixes):
                problems.append(f"missing fix {want}")
    return problems


def evaluate(engine: Valhalla, fixture: dict, result, elapsed_ms: float) -> dict:
    from athlete_solver.models import RouteRequest  # noqa: PLC0415

    req = RouteRequest.model_validate(fixture["request"])
    ref = fixture["reference"]
    row: dict = {"id": fixture["id"], "ms": elapsed_ms, "problems": [], "candidates": []}
    ferries = req.preferences.ferries_allowed

    # Outcome classification
    if ref["outcome"] == "infeasible":
        if result.outcome != "infeasible":
            row["problems"].append(f"expected infeasible, got {result.outcome}")
        else:
            row["conflict_problems"] = check_conflict(result, ref, req)
            row["problems"] += row["conflict_problems"]
        return row
    if result.outcome != "ok":
        row["problems"].append(f"expected ok, got {result.outcome}")
        return row
    if not result.candidates:
        row["problems"].append("ok outcome with no candidates")
        return row
    labels = {c.label for c in result.candidates}
    margin = req.tolerance_m
    if ref.get("case") == "A" and ref["tail_foot_m"] - ref["remainder_m"] > margin and "direct" not in labels:
        row["problems"].append(f"reference case A but labels {sorted(labels)}")
    if ref.get("case") == "B" and ref["remainder_m"] - ref["tail_foot_m"] > margin and "end_at_target" not in labels:
        row["problems"].append(f"reference case B but labels {sorted(labels)}")

    target = None
    if req.direction and req.direction.kind == "towards_place":
        target = req.direction.place.lonlat
    located = engine.locate([c.lonlat for c in req.checkpoints], costing_options=pedestrian_options(ferries)) \
        if req.checkpoints else []

    edge_sets = {}
    for cand in result.candidates:
        cr: dict = {"label": cand.label}
        geom = [tuple(p) for p in cand.geometry]
        m = measure_shapes(engine, split_at_stops(geom, cand.stops))
        cr["foot_m"], cr["ferry_m"] = m.foot_m, m.ferry_m
        cr["access_ok"] = m.matched_exactly
        if not m.matched_exactly:
            row["problems"].append(f"{cand.label}: geometry does not follow pedestrian edges exactly")
        if m.ferry_m > 0 and not ferries:
            row["problems"].append(f"{cand.label}: {m.ferry_m:.0f} m of ferry with ferries excluded")
        cr["unrequested_ferry"] = m.ferry_m > 0 and not ferries

        if not close(cand.foot_m, m.foot_m, rel=0.001, floor_m=2.0):
            row["problems"].append(f"{cand.label}: reported foot {cand.foot_m:.0f} m, measured {m.foot_m:.0f} m")
        cr["reported_ok"] = close(cand.foot_m, m.foot_m, rel=0.001, floor_m=2.0)

        sphere = geodesy.sphere_line_length_m(geom)
        cr["consistency_ok"] = abs(cand.engine_length_m - sphere) <= consistency_tolerance_m(sphere)
        if not cr["consistency_ok"]:
            row["problems"].append(f"{cand.label}: engine {cand.engine_length_m:.0f} m vs sphere {sphere:.0f} m")

        if cand.label in BUDGET_LABELS:
            cr["dist_err_pct"] = abs(m.foot_m - req.target_distance_m) / req.target_distance_m * 100

        for cp, snap in zip(req.checkpoints, located):
            if snap is None:
                row["problems"].append(f"{cand.label}: checkpoint {cp.label} could not be located")
                continue
            from shapely.geometry import LineString, Point  # noqa: PLC0415
            from shapely.ops import nearest_points  # noqa: PLC0415
            on_line, _ = nearest_points(LineString(geom), Point(snap))
            off = geodesy.distance_m(snap, (on_line.x, on_line.y))
            if off > CHECKPOINT_RADIUS_M:
                row["problems"].append(f"{cand.label}: misses checkpoint {cp.label} by {off:.0f} m")
        cr["checkpoints_ok"] = not any("misses checkpoint" in p or "could not be located" in p for p in row["problems"])

        keys = [e.key for e in m.edges]
        counts: dict = {}
        for e in m.edges:
            counts[e.key] = counts.get(e.key, 0) + 1
        repeated = sum(e.length_m for e in m.edges if counts[e.key] > 1)
        total = sum(e.length_m for e in m.edges) or 1.0
        if req.route_type != "out_and_back":
            cr["repeat_share"] = repeated / total
        edge_sets[cand.label] = set(keys)

        if target is not None and cand.label in BUDGET_LABELS:
            last_cp = max((s.at_m for s in cand.stops if s.role == "checkpoint"), default=0.0)
            cr["backtrack"] = direction_adherence(engine, geom, target, last_cp, ferries)
        if req.direction and req.direction.kind == "bearing" and req.route_type == "point_to_point":
            cr["bearing_err"] = geodesy.angle_between_deg(geodesy.bearing_deg(geom[0], geom[-1]),
                                                          req.direction.degrees)
        row["candidates"].append(cr)

    alt = [k for k in edge_sets if k in ("direct", "fewer_main_roads")]
    if len(alt) == 2:
        a, b = edge_sets[alt[0]], edge_sets[alt[1]]
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
    back = [c["backtrack"] * 100 for c in cands if c.get("backtrack") is not None]
    bear = [c["bearing_err"] for c in cands if "bearing_err" in c]
    overlaps = [r["overlap"] * 100 for r in rows if "overlap" in r]
    infeasible = [f for f in fixtures if f["reference"]["outcome"] == "infeasible"]
    inf_ok = [r for r in rows if r["id"] in {f["id"] for f in infeasible} and "error" not in r and not r["problems"]]
    classified = [r for r in rows if "error" not in r and not any(p.startswith(("expected", "reference case")) for p in r["problems"])]

    def kpi(name, target, measured, passed):
        return (name, target, measured, passed)

    have = bool(cands)
    kpis = [
        kpi("Fixtures solved without error", "all", f"{len(rows) - len(errors)} / {len(rows)}", not errors),
        kpi("Outcome classification (ok / infeasible / Case A or B)", "100%",
            f"{len(classified)} / {len(rows)}", len(classified) == len(rows)),
        kpi("Distance accuracy, point-to-point", "median < 0.5%, p95 < 1.5%",
            f"median {statistics.median(dist):.2f}%, p95 {pct(dist, .95):.2f}% (n={len(dist)})" if dist else "no routes",
            bool(dist) and statistics.median(dist) < 0.5 and pct(dist, .95) < 1.5),
        kpi("Reported length matches re-measured geometry", "every route, 0.1% / 2 m",
            f"{sum(c['reported_ok'] for c in cands)} / {len(cands)}", have and all(c["reported_ok"] for c in cands)),
        kpi("Length consistency (engine vs sphere)", "every route, 0.1% / 2 m",
            f"{sum(c['consistency_ok'] for c in cands)} / {len(cands)}", have and all(c["consistency_ok"] for c in cands)),
        kpi("Feasibility: access violations or unrequested ferry", "0",
            f"{sum((not c['access_ok']) or c['unrequested_ferry'] for c in cands)}",
            have and not any((not c["access_ok"]) or c["unrequested_ferry"] for c in cands)),
        kpi("Infeasibility handling: correct conflict objects", "100%",
            f"{len(inf_ok)} / {len(infeasible)}", len(inf_ok) == len(infeasible)),
        kpi("Latency per solve", "p50 < 2 s, p95 < 5 s",
            f"p50 {statistics.median(lat):.0f} ms, p95 {pct(lat, .95):.0f} ms" if lat else "no solves",
            bool(lat) and statistics.median(lat) < 2000 and pct(lat, .95) < 5000),
        kpi("Duplication (repeated edges), excluding out-and-back", "median < 2%, none > 10%",
            f"median {statistics.median(reps):.1f}%, max {max(reps):.1f}%" if reps else "no routes",
            bool(reps) and statistics.median(reps) < 2 and max(reps) <= 10),
        kpi("Direction adherence (share moving away from target, after last stop)", "every route < 15%",
            f"max {max(back):.1f}%, {sum(b < 15 for b in back)} / {len(back)} under" if back else "no routes",
            bool(back) and all(b < 15 for b in back)),
        kpi("Endpoint bearing (bearing-only requests)", "within 30°",
            f"max {max(bear):.0f}°, {sum(b <= 30 for b in bear)} / {len(bear)} within" if bear else "no routes",
            bool(bear) and all(b <= 30 for b in bear)),
        kpi("Checkpoint compliance (snapped point within 50 m)", "100%",
            f"{sum(c['checkpoints_ok'] for c in cands)} / {len(cands)}", have and all(c["checkpoints_ok"] for c in cands)),
        kpi("Alternative diversity (edge overlap)", "< 60%",
            f"max {max(overlaps):.0f}% (n={len(overlaps)})" if overlaps else "n/a: one alternative until the spike decision",
            not overlaps or max(overlaps) < 60),
        kpi("Edit invariants (scenarios 9, 10)", "all hold",
            f"{sum(not p for _, _, p in invariant_rows)} / {len(invariant_rows)}",
            all(not p for _, _, p in invariant_rows) and bool(invariant_rows)),
    ]
    passed = all(k[3] for k in kpis)

    md = [
        "# Phase 3: KPI report", "",
        f"Graph build {SCENARIOS['graph_build']} (pinned extract). {len(fixtures)} active fixtures"
        f"{' (filtered)' if only else ''}; {len(skipped)} not yet in scope "
        f"({', '.join(f['id'] + ': ' + f['status'] for f in skipped)}). Measured on the development laptop.", "",
        "Every number below is measured by the harness from the candidate geometry, independently of the "
        "solver's own figures. Conflict objects are checked against brute-force reference values "
        "(`tests/kpi/reference.py`).", "",
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
        cs = "; ".join(f"{c['label']} {c['foot_m'] / 1000:.2f}" + (f" ({c['dist_err_pct']:.2f}%)" if "dist_err_pct" in c else "")
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
