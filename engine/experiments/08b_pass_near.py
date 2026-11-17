"""Phase 3b rules spike, part B: pass-near checkpoints, must_use bridge, over_budget, ordering.

Usage:  docker compose up -d valhalla
        docker compose --profile spike up -d graphhopper
        uv run python engine/experiments/08b_pass_near.py [--model "R2 medium"]

Prototype of Phase 3 amendments 3, 6 and 7 (not solver code):
- Pass-near: the route must pass within 1 km of each place point, with no spur.
  If the route from the previous anchor to the next stop already passes within
  1 km, its nearest point becomes a through via. Otherwise candidates are network
  points within 1 km of the place (a grid snapped with Valhalla locate),
  pre-filtered by straight-line added distance (pre-filter only), then routed
  A -> P -> B with through vias. The candidate with the least added routed
  distance and no spur wins. If none qualifies, candidates inside the place's
  OSM boundary are tried and the stop is flagged.
- must_use bridge: both bridge ends become through vias, nearer end first.
- Budget: L_min is the routed length through all stops. Above D + 500 m the result
  is over_budget, with the overshoot and a "cut at target" candidate re-routed as one
  request; otherwise the tail towards the target is cut at the remainder and the
  whole run re-routed as one request.
Every length is the ellipsoid length of a returned geometry. Proximity (1 km) is the
straight-line distance from the place point to the Valhalla-matched route: a
proximity, never a route distance.
Writes docs/reports/phase3b/pass_near_<mode>_data.json and pass_near_<mode>.geojson (mode = --proximity).
Set PASS_NEAR_M and ONLY=<case id> in the environment to force the boundary fallback on one case.
"""

import argparse
import os
import itertools
import json
import math
import sys
import time

from pyproj import Transformer
from shapely.geometry import LineString, Point, shape as shp

from _rules import GH, MODELS, NO_FERRY, ROOT, assess, to_feature, write_geojson
from athlete_engine import geodesy
from athlete_engine.valhalla import Valhalla, ValhallaError, loc, route_shape
from athlete_solver.scoring import repetition, spurs

OUT = ROOT / "docs" / "reports" / "phase3b"
RULES = json.loads((ROOT / "tests" / "fixtures" / "rules_places.json").read_text(encoding="utf-8"))["places"]
PLACES3 = json.loads((ROOT / "tests" / "fixtures" / "places.json").read_text(encoding="utf-8"))["places"]
PASS_NEAR_M = float(os.environ.get("PASS_NEAR_M", "1000"))
TOLERANCE_M = 500.0
PREFILTER_K = 8
GRID_RINGS_M = (0, 200, 400, 600, 800, 950)
GRID_BEARINGS = 16

TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)   # UTM 43N covers Kerala


def utm(p):
    return TO_UTM.transform(p[0], p[1])


def proximity_m(point, line) -> float:
    """Straight-line distance from a point to a line (proximity check only)."""
    return LineString([utm(q) for q in line]).distance(Point(utm(point)))


def nearest_on(line, point):
    ls = LineString([utm(q) for q in line])
    d = ls.project(Point(utm(point)))
    x, y = ls.interpolate(d).coords[0]
    lon, lat = TO_UTM.transform(x, y, direction="INVERSE")
    return (lon, lat), d


def offset(p, dist_m, bearing_deg):
    """Point at a straight-line offset (candidate grid only)."""
    lat = math.radians(p[1])
    dy = dist_m * math.cos(math.radians(bearing_deg)) / 111_320.0
    dx = dist_m * math.sin(math.radians(bearing_deg)) / (111_320.0 * math.cos(lat))
    return (p[0] + dx, p[1] + dy)


# ------------------------------------------------------------------ engines

class Router:
    """One engine behind one call: route(points) -> shape, with intermediate points as through vias."""

    def __init__(self, name, v: Valhalla, gh: GH | None, model: dict | None):
        self.name, self.v, self.gh, self.model = name, v, gh, model
        self.calls = 0
        self.ms = 0.0

    def route(self, points):
        self.calls += 1
        start = time.perf_counter()
        try:
            if self.gh is not None:
                shape, _, _ = self.gh.route(points, self.model, pass_through=True)
            else:
                locs = [loc(p) if i in (0, len(points) - 1) else loc(p, type="through") for i, p in enumerate(points)]
                shape = route_shape(self.v.route(locs, costing_options=NO_FERRY))
        finally:
            self.ms += (time.perf_counter() - start) * 1000
        return shape


def candidates_near(v: Valhalla, centre, within_m=PASS_NEAR_M, polygon=None):
    """Network points near a place: a ring grid snapped with Valhalla locate, deduplicated within 30 m."""
    if polygon is None:
        grid = [centre] + [offset(centre, r, b) for r in GRID_RINGS_M[1:] for b in range(0, 360, 360 // GRID_BEARINGS)]
    else:
        minx, miny, maxx, maxy = polygon.bounds
        step = 0.0025   # about 270 m
        grid = [(minx + i * step, miny + j * step) for i in range(int((maxx - minx) / step) + 1)
                for j in range(int((maxy - miny) / step) + 1)]
        grid = [g for g in grid if polygon.contains(Point(g))] or [centre]
    snapped = []
    for i in range(0, len(grid), 50):
        snapped += v.locate(grid[i:i + 50], costing_options=NO_FERRY)
    out = []
    for s in snapped:
        if s is None:
            continue
        if polygon is None and geodesy.distance_m(centre, s) > within_m:
            continue
        if polygon is not None and not polygon.contains(Point(s)):
            continue
        if all(geodesy.distance_m(s, o) > 30 for o in out):
            out.append(s)
    return out


PROXIMITY = {"mode": "straight"}   # set from --proximity
V_FOR_CHECKS: list = []


def network_m(v: Valhalla, centre, pts) -> list[float]:
    """Walking distance (Valhalla pedestrian matrix, engine metres) from the place to each point."""
    out = []
    for i in range(0, len(pts), 40):
        chunk = pts[i:i + 40]
        row = v.matrix([centre], chunk, costing_options=NO_FERRY)["sources_to_targets"][0]
        out += [(c["distance"] * 1000) if c.get("distance") is not None else float("inf") for c in row]
    return out


def walk_near(v: Valhalla, centre, line):
    """Nearest point of a line by walking distance, among points within 1 km straight-line (pre-filter)."""
    samples = [p for p, _ in geodesy.sample_every(line, 100.0) if geodesy.distance_m(centre, p) <= PASS_NEAR_M]
    if not samples:
        return None, float("inf")
    d = network_m(v, centre, samples)
    j = min(range(len(d)), key=d.__getitem__)
    return samples[j], d[j]


def measured(v, shape):
    a = assess(v, shape)
    matched = [p for e in a["edges"] for p in e.shape] or shape
    a["matched"] = matched
    a["spurs"] = spurs(a["edges"], [])
    a["repeat"], _ = repetition(a["edges"], 0.0)
    return a


def pass_point(router: Router, v, stop_key, A, B):
    """Choose where the route passes stop_key between anchors A and B."""
    place = RULES.get(stop_key) or PLACES3[stop_key]
    centre = (place["lon"], place["lat"])
    base = router.route([A, B])
    base_len = geodesy.line_length_m(base)
    near = proximity_m(centre, base)
    walk = PROXIMITY["mode"] == "network"
    if walk:
        p, wd = walk_near(v, centre, base)
        if wd <= PASS_NEAR_M:
            return {"stop": stop_key, "kind": "on_route", "point": p, "added_m": 0.0, "proximity_m": near,
                    "walk_m": wd, "tried": 0}
    elif near <= PASS_NEAR_M:
        p, _ = nearest_on(base, centre)
        return {"stop": stop_key, "kind": "on_route", "point": p, "added_m": 0.0, "proximity_m": near, "tried": 0}

    def best_of(cands, kind):
        cands = sorted(cands, key=lambda c: geodesy.distance_m(A, c) + geodesy.distance_m(c, B))[:PREFILTER_K]
        tried, best = [], None
        for c in cands:
            try:
                sh = router.route([A, c, B])
            except (RuntimeError, ValhallaError):
                continue
            m = measured(v, sh)
            added = m["length"] - base_len
            tried.append({"point": c, "added_m": added, "spurs": m["spurs"],
                          "proximity_m": proximity_m(centre, m["matched"])})
            if not m["spurs"] and (kind == "boundary" or proximity_m(centre, m["matched"]) <= PASS_NEAR_M):
                if best is None or added < best["added_m"]:
                    best = {"stop": stop_key, "kind": kind, "point": c, "added_m": added,
                            "proximity_m": proximity_m(centre, m["matched"])}
        return best, tried

    cands = candidates_near(v, centre)
    if walk and cands:
        wd = network_m(v, centre, cands)
        cands = [c for c, d in zip(cands, wd) if d <= PASS_NEAR_M]
    best, tried = best_of(cands, "via")
    if best:
        best["tried"] = len(tried)
        best["rejected_spur"] = sum(1 for t in tried if t["spurs"])
        return best
    # Fallback: inside the place's own OSM boundary (most local boundary named after the place)
    for b in place.get("boundaries", []):
        if place["name"] and place["name"].lower().split()[0] in (b["name"] or "").lower():
            fb, tried_b = best_of(candidates_near(v, centre, polygon=shp(b["geometry"])), "boundary")
            if fb:
                fb.update(tried=len(tried) + len(tried_b), boundary=b["osm_id"], boundary_name=b["name"],
                          flag="passes inside the OSM boundary, not within 1 km without a spur")
                return fb
    return {"stop": stop_key, "kind": "none", "point": None, "added_m": None, "proximity_m": near,
            "tried": len(tried), "tried_detail": tried}


def bridge_ends(router: Router, key, A):
    coords = [tuple(c) for c in RULES[key]["coords"]]
    ends = [coords[0], coords[-1]]
    d = [geodesy.line_length_m(router.route([A, e])) for e in ends]
    return ends if d[0] <= d[1] else ends[::-1]


def solve_case(router: Router, v, case):
    """Pass-near prototype for one request. Returns the result dict."""
    t0 = time.perf_counter()
    calls0 = router.calls
    S = case["start"]
    T = case["target"]
    stops = case["stops"]
    vias, picks = [], []
    A = S
    for i, key in enumerate(stops):
        if RULES.get(key, {}).get("kind") == "bridge":
            ends = bridge_ends(router, key, A)
            vias += ends
            picks.append({"stop": key, "kind": "must_use", "point": ends, "added_m": None})
            A = ends[-1]
            continue
        nxt = stops[i + 1] if i + 1 < len(stops) else None
        if nxt is None:
            B = T
        elif RULES.get(nxt, {}).get("kind") == "bridge":
            B = tuple(RULES[nxt]["coords"][0])
        else:
            pl = RULES.get(nxt) or PLACES3[nxt]
            B = (pl["lon"], pl["lat"])
        pk = pass_point(router, v, key, A, B)
        picks.append(pk)
        if pk["point"] is None:
            return {"outcome": "conflict", "reason": f"no pass point for {key}", "picks": picks}
        vias.append(pk["point"])
        A = pk["point"]

    D = case["distance_m"]
    stops_shape = router.route([S, *vias])
    L_min = geodesy.line_length_m(stops_shape)
    res = {"L_min": L_min, "picks": picks, "vias": vias}
    if L_min > D + TOLERANCE_M:
        res["outcome"] = "over_budget"
        res["overshoot_m"] = L_min - D
        res["full"] = measured(v, stops_shape)
        res["full_shape"] = stops_shape
        # cut at target, re-routed as one request through the vias before the cut
        cut = geodesy.cut_at(stops_shape, D)
        end = cut[-1]
        cum = geodesy.cumulative_m(stops_shape)
        kept = [p for p in vias if nearest_on(stops_shape, p)[1] < nearest_on(stops_shape, end)[1] - 50]
        sh = router.route([S, *kept, end])
        res["cut"] = measured(v, sh)
        res["cut_shape"] = sh
        res["cut_dropped"] = [pk["stop"] for pk in picks
                              if pk["point"] is not None and pk["kind"] != "must_use" and pk["point"] not in kept]
        del cum
    else:
        R = D - L_min
        tail = router.route([vias[-1] if vias else S, T])
        tail_len = geodesy.line_length_m(tail)
        if tail_len >= R:
            end = geodesy.cut_at(tail, R)[-1]
            res["case"] = "A"
        else:
            end = T
            res["case"] = "B (target nearer than the remainder; shortfall reported)"
        sh = router.route([S, *vias, end])
        res["outcome"] = "ok"
        res["route"] = measured(v, sh)
        res["route_shape"] = sh
        res["deviation_m"] = res["route"]["length"] - D
    res["ms"] = (time.perf_counter() - t0) * 1000
    res["engine_calls"] = router.calls - calls0
    return res


def checks(case, m):
    """Order, proximity and bridge checks on a measured route (Valhalla-matched geometry)."""
    out = []
    positions = []
    for key in case["stops"]:
        place = RULES.get(key) or PLACES3[key]
        if place.get("kind") == "bridge":
            used = int(place["osm_id"].split("/")[1]) in m["ways"]
            out.append({"stop": key, "bridge_used": used})
            positions.append(nearest_on(m["matched"], (place["lon"], place["lat"]))[1])
            continue
        c = (place["lon"], place["lat"])
        prox = proximity_m(c, m["matched"])
        _, wd = walk_near(V_FOR_CHECKS[0], c, m["matched"])
        out.append({"stop": key, "proximity_m": prox, "within_1km": prox <= PASS_NEAR_M, "walk_m": wd,
                    "within_1km_walk": wd <= PASS_NEAR_M})
        positions.append(nearest_on(m["matched"], c)[1])
    in_order = all(a <= b for a, b in zip(positions, positions[1:]))
    return out, in_order


# ------------------------------------------------------------------ ordering

def best_orders(dist, n_stops):
    """Brute-force stop orders over a distance table (index 0 = start, last = target)."""
    idx = list(range(1, n_stops + 1))
    T = n_stops + 1
    open_best, to_t_best = None, None
    for perm in itertools.permutations(idx):
        path = [0, *perm]
        d = sum(dist[a][b] for a, b in zip(path, path[1:]))
        dt = d + dist[perm[-1]][T]
        if open_best is None or d < open_best[0]:
            open_best = (d, perm)
        if to_t_best is None or dt < to_t_best[0]:
            to_t_best = (dt, perm)
    return open_best[1], to_t_best[1]


def ordering(v: Valhalla, gh: GH, model, case):
    pts = [case["start"]]
    for key in case["stops"]:
        p = RULES.get(key) or PLACES3[key]
        pts.append((p["lon"], p["lat"]))
    pts.append(case["target"])
    n = len(case["stops"])
    mx = v.matrix(pts, pts, costing_options=NO_FERRY)["sources_to_targets"]
    vd = [[(c["distance"] or 1e9) * 1000 for c in row] for row in mx]
    gd = [[0.0] * len(pts) for _ in pts]
    calls = 0
    t0 = time.perf_counter()
    for i, j in itertools.permutations(range(len(pts)), 2):
        sh, _, _ = gh.route([pts[i], pts[j]], model)
        gd[i][j] = geodesy.line_length_m(sh)
        calls += 1
    gh_ms = (time.perf_counter() - t0) * 1000
    names = case["stops"]
    fmt = lambda perm: [names[k - 1] for k in perm]
    vo, vt = best_orders(vd, n)
    go, gt = best_orders(gd, n)
    return {"valhalla_open": fmt(vo), "valhalla_to_target": fmt(vt), "gh_open": fmt(go), "gh_to_target": fmt(gt),
            "requested": names, "gh_pairwise_calls": calls, "gh_pairwise_ms": gh_ms}


# ------------------------------------------------------------------ main

def pt(key):
    p = RULES.get(key) or PLACES3[key]
    return (p["lon"], p["lat"])


CASES = [
    {"id": "acceptance", "title": "Athanikkal towards Kozhikode, 25 km, six pass-near stops",
     "start": pt("athanikkal"), "target": pt("kozhikode"), "distance_m": 25000,
     "stops": ["kottakkadavu", "kadalundi", "chaliyam", "karuvanthuruthy_bridge", "beypore", "kallai"]},
    {"id": "acceptance-20km", "title": "Same request at 20 km: the stops alone exceed the budget (over_budget)",
     "start": pt("athanikkal"), "target": pt("kozhikode"), "distance_m": 20000,
     "stops": ["kottakkadavu", "kadalundi", "chaliyam", "karuvanthuruthy_bridge", "beypore", "kallai"]},
    {"id": "harbour-pass-near", "title": "Chaliyam harbour (tip of the spit) as a pass-near stop: exercises the fallback",
     "start": pt("athanikkal"), "target": pt("kozhikode"), "distance_m": 25000,
     "stops": ["chaliyam_harbour", "beypore"]},
    {"id": "S05-pass-near", "title": "Scenario 5 stops as pass-near: start south of Kadalundi, 28 km towards Kozhikode",
     "start": pt("start_south_of_kadalundi"), "target": pt("kozhikode"), "distance_m": 28000,
     "stops": ["kadalundi", "chaliyam", "beypore"]},
    {"id": "S15-pass-near", "title": "Scenario 15 stops as pass-near: same start, 25 km",
     "start": pt("start_south_of_kadalundi"), "target": pt("kozhikode"), "distance_m": 25000,
     "stops": ["kadalundi", "chaliyam", "beypore"]},
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="R2 medium", choices=list(MODELS))
    ap.add_argument("--proximity", default="straight", choices=["straight", "network"],
                    help="1 km measured straight-line to the route, or as walking distance (Valhalla matrix)")
    args = ap.parse_args()
    model = MODELS[args.model]
    PROXIMITY["mode"] = args.proximity
    tag = args.proximity + (f"_{os.environ['ONLY']}_{PASS_NEAR_M:.0f}m" if os.environ.get("ONLY") else "")

    v = Valhalla()
    V_FOR_CHECKS.append(v)
    gh = GH()
    results, features = {}, []
    try:
        for case in [c for c in CASES if not os.environ.get("ONLY") or c["id"] == os.environ["ONLY"]]:
            for rname, router in (("recommended", Router("recommended", v, gh, model)),
                                  ("shortest", Router("shortest", v, None, None))):
                r = solve_case(router, v, case)
                m = r.get("route") or r.get("full")
                if m:
                    r["checks"], r["in_order"] = checks(case, m)
                if r.get("cut"):
                    r["cut_checks"], _ = checks(case, r["cut"])
                results[(case["id"], rname)] = r
                shape = r.get("route_shape") or r.get("full_shape")
                if shape:
                    features.append(to_feature(shape, case=case["id"], alternative=rname, part="route" if
                                               "route_shape" in r else "full (over budget)",
                                               length_m=round(m["length"])))
                if r.get("cut_shape"):
                    features.append(to_feature(r["cut_shape"], case=case["id"], alternative=rname,
                                               part="cut at target", length_m=round(r["cut"]["length"])))
                for pk in r["picks"]:
                    pts_ = pk["point"] if pk["kind"] == "must_use" else [pk["point"]] if pk["point"] else []
                    for p in pts_:
                        features.append({"type": "Feature", "properties": {"case": case["id"], "alternative": rname,
                                                                          "stop": pk["stop"], "kind": pk["kind"]},
                                         "geometry": {"type": "Point", "coordinates": list(p)}})
                print(f"{case['id']:16s} {rname:12s} {r['outcome']:12s} L_min {r.get('L_min', 0):7.0f} m  "
                      + (f"length {m['length']:7.0f} m  spurs {m['spurs']}  repeat {m['repeat'] * 100:.1f}%  "
                         f"ferry {m['ferry_m']:.0f}  in order {r.get('in_order')}  calls {r['engine_calls']}  "
                         f"{r['ms']:.0f} ms" if m else r.get("reason", "")), flush=True)
                for pk in r["picks"]:
                    added = "-" if pk.get("added_m") is None else f"{pk['added_m']:.0f}"
                    print(f"     {pk['stop']:24s} {pk['kind']:9s} added {added} m"
                          f"  proximity {pk.get('proximity_m', 0) or 0:.0f} m  tried {pk.get('tried', '-')}")
        orders = {c["id"]: ordering(v, gh, model, c) for c in CASES[:2]}
        # GraphHopper pass_through with a must_reach stop at a dead end (Chaliyam harbour, tip of the spit):
        # one request with pass_through on, one with it off, and legs routed separately then joined.
        dead_end = {}
        a, h, b = pt("kadalundi"), pt("chaliyam_harbour"), pt("beypore")
        variants = {
            "one request, pass_through on": lambda: gh.route([a, h, b], model, pass_through=True)[0],
            "one request, pass_through off": lambda: gh.route([a, h, b], model, pass_through=False)[0],
            "two legs joined": lambda: gh.route([a, h], model)[0] + gh.route([h, b], model)[0][1:],
        }
        for label, fn in variants.items():
            try:
                sh = fn()
                mm = measured(v, sh)
                dead_end[label] = {"length": mm["length"], "spurs": mm["spurs"], "repeat": mm["repeat"],
                                   "harbour_proximity_m": proximity_m(h, mm["matched"])}
                features.append(to_feature(sh, case="dead-end must_reach", alternative="recommended", part=label,
                                           length_m=round(mm["length"])))
            except RuntimeError as err:
                dead_end[label] = {"error": str(err)}
    finally:
        gh.close()
        v.close()

    OUT.mkdir(parents=True, exist_ok=True)
    write_geojson(OUT / f"pass_near_{tag}.geojson", features)

    def slim(m):
        if not m:
            return None
        out = {k: (round(m[k], 1) if isinstance(m[k], float) else m[k]) for k in
               ("length", "highway_m", "primary_m", "path_m", "ferry_m", "spurs", "walk_ok")}
        out["repeat_pct"] = round(m["repeat"] * 100, 2)   # repetition as a percentage of the route length
        return out

    data = {f"{k[0]} / {k[1]}": {
        "outcome": r["outcome"], "L_min": r.get("L_min"), "overshoot_m": r.get("overshoot_m"),
        "deviation_m": r.get("deviation_m"),
        "case": r.get("case"), "route": slim(r.get("route")), "full": slim(r.get("full")), "cut": slim(r.get("cut")),
        "cut_dropped": r.get("cut_dropped"), "checks": r.get("checks"), "cut_checks": r.get("cut_checks"),
        "in_order": r.get("in_order"), "engine_calls": r.get("engine_calls"), "ms": r.get("ms"),
        "picks": [{k2: v2 for k2, v2 in pk.items() if k2 != "tried_detail"} for pk in r["picks"]],
    } for k, r in results.items()}
    (OUT / f"pass_near_{tag}_data.json").write_text(json.dumps(
        {"model": args.model, "results": data, "ordering": orders, "dead_end_pass_through": dead_end},
        indent=1, default=str), encoding="utf-8")
    print(json.dumps(orders, indent=1))
    print(json.dumps(dead_end, indent=1))
    print(f"Data: docs/reports/phase3b/pass_near_{tag}_data.json, map: pass_near_{tag}.geojson")
    return 0


if __name__ == "__main__":
    sys.exit(main())
