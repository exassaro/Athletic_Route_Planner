"""Does a solver change leave the routes alone? Fresh solves against the routes stored by an earlier solver.

Usage:  uv run python api/scripts/compare_routes.py [--only A01,S02] [--dsn ...] [--out report.json]

For every active fixture in tests/fixtures/scenarios/scenarios.json that the API database holds a version of
(the Phase 4 latency run stored all 110), solves the request again with the current solver (Valhalla and
GraphHopper must be running) and compares it with the newest stored version of the same request:
outcome, conflict, and for every candidate its label, option, geometry (exactly), lengths, stops, end, road
classes, repetition, score and flags (numbers within 1e-6 m: the stored routes were solved in the Linux
container, and Windows rounds the last bits of a geodesic sum differently). Gain and loss are reported separately (Phase 5 amendment 13 changes them on purpose).
"""

import argparse
import json
import sys
from pathlib import Path

import psycopg
from athlete_engine.valhalla import Valhalla
from athlete_solver.__main__ import graph_build
from athlete_solver.models import RouteRequest
from athlete_solver.solve import solve
from shapely import wkb

ROOT = Path(__file__).resolve().parents[2]
SAME = ("label", "option", "length_m", "foot_m", "ferry_m", "deviation_m", "repeat_share", "backtrack_share",
        "score", "end_label")


TOL_M = 1e-6     # last-bit differences: the stored routes were solved in the Linux container, these on the host


def close(a, b) -> bool:
    """Equal, with floats within TOL_M (recursively through lists and dicts)."""
    if isinstance(a, float) or isinstance(b, float):
        return a is not None and b is not None and abs(a - b) <= TOL_M
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(close(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(close(a[k], b[k]) for k in a)
    return a == b


def stored(conn, request: dict):
    row = conn.execute("SELECT id, outcome, conflict FROM plan_versions WHERE request = %s::jsonb "
                       "ORDER BY created_at DESC LIMIT 1", (json.dumps(request),)).fetchone()
    if row is None:
        return None
    routes = conn.execute("SELECT label, option, length_m, foot_m, ferry_m, deviation_m, repeat_share, "
                          "backtrack_share, score, end_label, ST_AsBinary(geom), stops, end_point, road_class_m, "
                          "flags, gain_m, loss_m FROM routes WHERE plan_version_id = %s ORDER BY seq",
                          (row[0],)).fetchall()
    return row[1], row[2], routes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--dsn", default="postgresql://athlete:athlete@localhost:5433/athlete")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    fixtures = json.loads((ROOT / "tests/fixtures/scenarios/scenarios.json").read_text(encoding="utf-8"))["fixtures"]
    only = set(args.only.split(",")) if args.only else None
    conn = psycopg.connect(args.dsn)
    report, differ = [], 0
    with Valhalla() as engine:
        for f in fixtures:
            if (only and f["id"] not in only) or not f.get("request") or f.get("status", "active") != "active":
                continue
            try:
                req = RouteRequest.model_validate(f["request"])
            except Exception:  # noqa: BLE001 - fixtures for later phases
                continue
            old = stored(conn, req.model_dump(mode="json"))
            if old is None:
                continue
            res = solve(req, engine=engine, graph_build=graph_build())
            problems = []
            if res.outcome != old[0]:
                problems.append(f"outcome {old[0]} -> {res.outcome}")
            new_conflict = res.conflict.model_dump(mode="json") if res.conflict else None
            if not close(new_conflict, old[1]):
                problems.append("conflict differs")
            if len(res.candidates) != len(old[2]):
                problems.append(f"{len(old[2])} -> {len(res.candidates)} candidates")
            gains = []
            for c, r in zip(res.candidates, old[2]):
                for k, name in enumerate(SAME):
                    mine = c.end.label if name == "end_label" else getattr(c, name)
                    if not close(mine, r[k]):
                        problems.append(f"{c.label}/{c.option} {name} {r[k]} -> {mine}")
                if [list(p) for p in c.geometry] != [list(p[:2]) for p in wkb.loads(bytes(r[10])).coords]:  # exact
                    problems.append(f"{c.label}/{c.option} geometry differs")
                if not close([s.model_dump(mode="json") for s in c.stops], r[11]):
                    problems.append(f"{c.label}/{c.option} stops differ")
                if not close(c.end.model_dump(mode="json"), r[12]) or not close(c.road_class_m, r[13]):
                    problems.append(f"{c.label}/{c.option} end or road classes differ")
                if not close([x.model_dump(mode="json") for x in c.flags], r[14]):
                    problems.append(f"{c.label}/{c.option} flags differ")
                gains.append({"candidate": f"{c.label}/{c.option}", "gain_before": r[15], "gain_after": c.gain_m,
                              "loss_before": r[16], "loss_after": c.loss_m, "bridges": len(getattr(c, "bridges_m", []))})
            differ += bool(problems)
            report.append({"id": f["id"], "same": not problems, "problems": problems, "gains": gains})
            print(f"{f['id']:6s} {'same' if not problems else 'DIFFERENT: ' + '; '.join(problems[:3])}", flush=True)
    print(f"{len(report)} fixtures compared, {differ} different")
    if args.out:
        args.out.write_text(json.dumps(report, indent=1), encoding="utf-8")
    return 0 if differ == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
