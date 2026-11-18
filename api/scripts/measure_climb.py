"""How noisy is the climb? Gain under the solver's smoothing and under alternatives (Phase 5 plan, step 3).

Reads every distinct route the API has stored (the Phase 4 latency run left all 110 fixtures there): its raw
DEM profile, sampled every 30 m by the API (the same `geodesy.sample_every` step as the solver), and the
solver's own gain. Recomputes gain with the solver's algorithm (moving average over `window` samples, count a
change only when it reaches `threshold` m from the last anchor) for several settings. No engine calls.

The first check: window 5 and threshold 3 m (the solver's settings) must reproduce the stored gain exactly,
otherwise the comparison is not with the solver's figure.

With --bridges (needs Valhalla): each route's bridge edges come from Valhalla trace_attributes (map_snap,
`edge.bridge`). The DEM is a surface model, so on a bridge it gives the water or the river bed, not the deck.
"Bridges bridged" replaces the heights of the samples on a bridge (plus one sample either side) with a straight
line between the heights just outside it, then applies the same smoothing. Bridge positions along the route
come from Valhalla's edge lengths, scaled to the route's measured length (positions to about one sample).

    uv run python api/scripts/measure_climb.py [--bridges] [--dsn postgresql://athlete:athlete@localhost:5433/athlete]
    -> docs/reports/phase5/climb_data.json (the tables in elevation.md are written from it)
"""

import argparse
import hashlib
import json
import statistics
from pathlib import Path

import psycopg
from shapely import wkb as shapely_wkb

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "reports" / "phase5" / "climb_data.json"
WINDOWS = (1, 5, 9, 13, 17)            # samples (x 30 m): 30, 150, 270, 390, 510 m
THRESHOLDS = (0.0, 3.0, 5.0, 8.0, 10.0)
LOWLAND_MEDIAN_M = 20.0


def smooth(h: list[float], window: int) -> list[float]:
    k = window // 2
    return [sum(h[max(0, i - k):i + k + 1]) / len(h[max(0, i - k):i + k + 1]) for i in range(len(h))]


def gain_loss(h: list[float], window: int, threshold: float) -> tuple[float, float]:
    """The solver's climb() arithmetic (scoring.py), with the window and threshold as parameters."""
    s = smooth(h, window)
    gain = loss = 0.0
    anchor = s[0]
    for x in s[1:]:
        if x - anchor >= threshold and x != anchor:
            gain += x - anchor
            anchor = x
        elif anchor - x >= threshold and x != anchor:
            loss += anchor - x
            anchor = x
    return gain, loss


def bridge_spans(valhalla, coords: list, foot_m: float) -> list[tuple[float, float]]:
    """[(from_m, to_m)] of the route's bridge edges, along the route."""
    resp = valhalla.trace_attributes(coords, attributes=["edge.bridge", "edge.length"])
    edges = resp.get("edges", [])
    total = sum(e.get("length", 0.0) for e in edges) * 1000.0
    if total <= 0:
        return []
    scale, at, spans = foot_m / total, 0.0, []
    for e in edges:
        n = e.get("length", 0.0) * 1000.0 * scale
        if e.get("bridge"):
            if spans and abs(spans[-1][1] - at) < 1.0:
                spans[-1] = (spans[-1][0], at + n)
            else:
                spans.append((at, at + n))
        at += n
    return spans


def bridged(profile: list[list[float]], spans: list[tuple[float, float]], pad_m: float = 30.0) -> list[float]:
    d = [p[0] for p in profile]
    h = [float(p[1]) for p in profile]
    for a, b in spans:
        idx = [i for i, x in enumerate(d) if a - pad_m <= x <= b + pad_m]
        if not idx:
            continue
        i0, i1 = max(idx[0] - 1, 0), min(idx[-1] + 1, len(h) - 1)
        for i in range(i0 + 1, i1):
            t = (d[i] - d[i0]) / (d[i1] - d[i0]) if d[i1] > d[i0] else 0.0
            h[i] = h[i0] + t * (h[i1] - h[i0])
    return h


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default="postgresql://athlete:athlete@localhost:5433/athlete")
    ap.add_argument("--bridges", action="store_true", help="also measure gain with bridges bridged (Valhalla)")
    args = ap.parse_args()
    valhalla = None
    if args.bridges:
        from athlete_engine.valhalla import Valhalla
        valhalla = Valhalla()
    rows = psycopg.connect(args.dsn).execute("""
        SELECT r.elevation, r.gain_m, r.loss_m, r.foot_m, r.label, r.option, ST_AsBinary(r.geom),
               pv.request->'start'->>'label', pv.request->>'route_type', (pv.request->>'target_distance_m')::float
        FROM routes r JOIN plan_versions pv ON pv.id = r.plan_version_id
        WHERE r.elevation IS NOT NULL AND r.gain_m IS NOT NULL""").fetchall()
    seen, routes = set(), []
    for elev, gain, loss, foot, label, option, wkb, start, rtype, target in rows:
        key = hashlib.sha1(bytes(wkb)).hexdigest()
        if key in seen:
            continue
        seen.add(key)
        h = [float(p[1]) for p in elev]
        if len(h) < 3:
            continue
        mine_g, mine_l = gain_loss(h, 5, 3.0)
        r = {"start": start, "route_type": rtype, "target_m": target, "label": label, "option": option,
             "foot_m": foot, "solver_gain_m": gain, "solver_loss_m": loss,
             "reproduced": abs(round(mine_g, 1) - gain) <= 0.05 and abs(round(mine_l, 1) - loss) <= 0.05,
             "median_m": statistics.median(h), "min_m": min(h), "max_m": max(h),
             # jitter: spread of the raw heights around a 270 m moving average
             "jitter_sd_m": statistics.pstdev([a - b for a, b in zip(h, smooth(h, 9))]),
             "gain": {f"w{w}_t{t:g}": round(gain_loss(h, w, t)[0], 1) for w in WINDOWS for t in THRESHOLDS}}
        r["lowland"] = r["median_m"] < LOWLAND_MEDIAN_M
        if valhalla is not None:
            coords = [c[:2] for c in shapely_wkb.loads(bytes(wkb)).coords]
            spans = bridge_spans(valhalla, coords, foot)
            hb = bridged(elev, spans)
            r["bridges"] = len(spans)
            r["bridge_m"] = round(sum(b - a for a, b in spans), 1)
            r["gain_bridged"] = {f"w{w}_t{t:g}": round(gain_loss(hb, w, t)[0], 1)
                                 for w in WINDOWS for t in THRESHOLDS}
        routes.append(r)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"lowland_median_m": LOWLAND_MEDIAN_M, "routes": routes}, indent=1))
    bad = [r for r in routes if not r["reproduced"]]
    print(f"{len(routes)} distinct routes; solver gain reproduced on {len(routes) - len(bad)}")
    for r in bad[:5]:
        print("  not reproduced:", r["start"], r["label"], r["option"], r["solver_gain_m"], r["gain"]["w5_t3"])
    return 0 if not bad else 1


if __name__ == "__main__":
    raise SystemExit(main())
