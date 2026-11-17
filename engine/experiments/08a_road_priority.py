"""Phase 3b rules spike, part A: tune the GraphHopper priorities for amendment 2.

Usage:  docker compose up -d valhalla
        docker compose --profile spike up -d graphhopper
        uv run python engine/experiments/08a_road_priority.py

Routes: the 59 Phase 3 spike pairs (54 fixed pairs + 5 named) plus the acceptance
corridor, leg by leg and end to end (tests/fixtures/rules_places.json).
Variants: the candidate priority models in _rules.MODELS on profile `foot_rules`,
the Phase 3 "fewer main roads" profile for reference, and Valhalla pedestrian
("shortest") as the baseline.

Every geometry is measured with one yardstick (see _rules.assess). For every
route that uses footways or paths, the same model is re-run with paths blocked:
if no route exists, or the detour is large, the path was "the only connection".
Writes docs/reports/phase3b/road_priority.md and road_priority_data.json.
"""

import json
import statistics
import sys
from pathlib import Path

import httpx

from _rules import GH, MODELS, NO_FERRY, PBF, ROOT, assess, pct, priority_model, to_feature, write_geojson
from athlete_engine.osm import is_walkable, way_tags
from athlete_engine.valhalla import Valhalla, ValhallaError, route_shape

OUT = ROOT / "docs" / "reports" / "phase3b"
PLACES3 = json.loads((ROOT / "tests" / "fixtures" / "places.json").read_text(encoding="utf-8"))["places"]
RULES = json.loads((ROOT / "tests" / "fixtures" / "rules_places.json").read_text(encoding="utf-8"))["places"]
PAIRS = json.loads((ROOT / "tests" / "fixtures" / "od_pairs.json").read_text(encoding="utf-8"))
NAMED = [("start_south_of_kadalundi", "kozhikode"), ("beypore", "kozhikode"),
         ("feroke", "kozhikode"), ("chaliyam", "beypore"), ("kozhikode", "thamarassery")]
CORRIDOR = ["athanikkal", "kottakkadavu", "kadalundi", "chaliyam", "karuvanthuruthy_bridge",
            "beypore", "kallai", "kozhikode"]
PATH_DETOUR_LIMIT = 0.25   # a path is "the only connection" if avoiding it costs more than 25% extra


def routes():
    def p3(n):
        return (PLACES3[n]["lon"], PLACES3[n]["lat"])

    def pr(n):
        return (RULES[n]["lon"], RULES[n]["lat"])

    out = [(f"pair {p['id']}", (p["from"]["lon"], p["from"]["lat"]), (p["to"]["lon"], p["to"]["lat"]), "spike")
           for p in PAIRS["pairs"]]
    out += [(f"{a} to {b}", p3(a), p3(b), "spike") for a, b in NAMED]
    out += [(f"{a} to {b}", pr(a), pr(b), "corridor") for a, b in zip(CORRIDOR, CORRIDOR[1:])]
    out += [("athanikkal to kozhikode", pr("athanikkal"), pr("kozhikode"), "corridor")]
    return out


def run_variant(v, gh, name, a, b):
    if name == "shortest":
        resp = v.route([a, b], costing_options=NO_FERRY)
        shape, ms = route_shape(resp), v.last_elapsed_ms
    elif name == "P3 fewer-main-roads":
        shape, ms, _ = gh.route([a, b], None, profile="foot_quiet")
    else:
        shape, ms, _ = gh.route([a, b], MODELS[name])
    r = assess(v, shape)
    r["ms"] = ms
    r["shape"] = shape
    return r


def main() -> int:
    variants = ["shortest", "P3 fewer-main-roads", *MODELS]
    rows = []
    v = Valhalla()
    gh = GH()
    try:
        for label, a, b, group in routes():
            row = {"route": label, "group": group}
            for name in variants:
                try:
                    row[name] = run_variant(v, gh, name, a, b)
                except (ValhallaError, RuntimeError, httpx.HTTPError) as err:
                    row[name] = {"error": str(err)[:160]}
            # Path check: re-run each candidate model with paths blocked where the route uses paths
            for name in MODELS:
                r = row[name]
                if "error" in r or r["path_m"] < 50:
                    continue
                m = json.loads(json.dumps(MODELS[name]))
                m = {"priority": [x for x in m["priority"] if "FOOTWAY" not in x["if"]]
                     + [{"if": "road_class == FOOTWAY || road_class == PATH || road_class == STEPS || "
                               "road_class == TRACK || road_class == CYCLEWAY || road_class == BRIDLEWAY",
                         "multiply_by": "0"}]}
                try:
                    shape, _, _ = gh.route([a, b], m)
                    alt = assess(v, shape)
                    r["no_paths"] = {"length": alt["length"], "path_m": alt["path_m"]}
                except (RuntimeError, httpx.HTTPError) as err:
                    r["no_paths"] = {"error": str(err)[:160]}
            rows.append(row)
            base = row["shortest"]
            print(f"{label:42s} " + "  ".join(
                f"{n.split()[0]} " + ("ERR" if "error" in row[n] else
                                      f"{row[n]['length']:6.0f}/h{row[n]['highway_m']:4.0f}/p{row[n]['primary_m']:4.0f}"
                                      f"/f{row[n]['path_m']:4.0f}")
                for n in variants), flush=True)
    finally:
        gh.close()
        v.close()

    # OSM tags for every way used: access check and national-highway naming
    used = set().union(*(r[n]["ways"] for r in rows for n in variants if "error" not in r[n]))
    tags = way_tags(PBF, used)
    bad_ways = {w for w, t in tags.items() if not is_walkable(t)}

    def nh(t):
        return (t.get("ref") or "").replace(" ", "").upper().startswith("NH")

    def summary(name):
        ok = [r for r in rows if "error" not in r[name] and "error" not in r["shortest"]]
        base = {r["route"]: r["shortest"] for r in ok}
        extra = [(r[name]["length"] - base[r["route"]]["length"]) / base[r["route"]]["length"] * 100 for r in ok]
        share = lambda key: [r[name][key] / r[name]["length"] * 100 for r in ok if r[name]["length"] > 0]
        path_rows = [r for r in ok if r[name]["path_m"] >= 50]
        only_conn, avoidable = [], []
        for r in path_rows:
            np_ = r[name].get("no_paths")
            if np_ is None:
                continue
            if "error" in np_:
                only_conn.append(r["route"])
            else:
                detour = (np_["length"] - r[name]["length"]) / r[name]["length"]
                (only_conn if detour > PATH_DETOUR_LIMIT else avoidable).append(
                    (r["route"], r[name]["path_m"], detour * 100))
        overlap = [len(r[name]["keys"] & base[r["route"]]["keys"]) / len(r[name]["keys"] | base[r["route"]]["keys"]) * 100
                   for r in ok if r[name]["keys"] | base[r["route"]]["keys"]]
        hw_routes = [r for r in ok if r[name]["highway_m"] > 0]
        hw_ways = set().union(*(r[name]["highway_ways"] for r in ok)) if ok else set()
        return {
            "n": len(ok), "errors": [r["route"] for r in rows if "error" in r[name]],
            "highway_km": sum(r[name]["highway_m"] for r in ok) / 1000,
            "primary_km": sum(r[name]["primary_m"] for r in ok) / 1000,
            "path_km": sum(r[name]["path_m"] for r in ok) / 1000,
            "highway_share_med": statistics.median(share("highway_m")),
            "primary_share_med": statistics.median(share("primary_m")),
            "path_share_med": statistics.median(share("path_m")),
            "path_share_p90": pct(share("path_m"), 0.9),
            "routes_highway": len(hw_routes),
            "highway_ways_without_nh": len([w for w in hw_ways if w in tags and not nh(tags[w])]),
            "highway_ways": len(hw_ways),
            "routes_with_paths": len(path_rows),
            "paths_only_connection": only_conn, "paths_avoidable": avoidable,
            "extra_med": statistics.median(extra), "extra_p90": pct(extra, 0.9), "extra_max": max(extra),
            "overlap_med": statistics.median(overlap) if overlap else None,
            "under_60": sum(1 for o in overlap if o < 60),
            "snap_gap": sum(1 for r in ok if not r[name]["walk_ok"]),
            "tag_bad": sum(1 for r in ok if r[name]["ways"] & bad_ways),
            "tag_bad_ways": sorted({w for r in ok for w in r[name]["ways"] & bad_ways})[:10],
            "ferry_m": sum(r[name]["ferry_m"] for r in ok),
            "ms_p50": statistics.median(r[name]["ms"] for r in ok), "ms_p95": pct([r[name]["ms"] for r in ok], 0.95),
        }

    S = {n: summary(n) for n in variants}
    # Primary roads tagged as NH (would be missed by a trunk-only flag)
    primary_nh = sorted({w for w, t in tags.items() if t.get("highway") in ("primary", "primary_link") and nh(t)})

    OUT.mkdir(parents=True, exist_ok=True)
    features = []
    for r in rows:
        if r["group"] != "corridor":
            continue
        for n in variants:
            if "error" not in r[n]:
                features.append(to_feature(r[n]["shape"], route=r["route"], variant=n,
                                           length_m=round(r[n]["length"]), path_m=round(r[n]["path_m"]),
                                           highway_m=round(r[n]["highway_m"]), primary_m=round(r[n]["primary_m"])))
    write_geojson(OUT / "road_priority_corridor.geojson", features)

    md = ["# Rules spike A: road priority (GraphHopper `foot_rules` + per-request model)", "",
          "Pinned Kerala extract (2026-11-15). Valhalla 3.9.2 and GraphHopper 11.1 running together on the development "
          "laptop, 2026-11-17. Ferries excluded everywhere. Lengths are ellipsoid lengths of each geometry; road "
          "classes come from matching onto Valhalla pedestrian edges.", "",
          f"{len(rows)} routes: {sum(1 for r in rows if r['group'] == 'spike')} Phase 3 spike pairs and "
          f"{sum(1 for r in rows if r['group'] == 'corridor')} acceptance-corridor routes (7 legs and end to end).", "",
          "Models (GraphHopper priority multipliers; ordinary roads 1.0):", ""]
    for n, m in MODELS.items():
        md.append(f"- **{n}**: " + "; ".join(f"`{x['if']}` x{x['multiply_by']}" for x in m["priority"]))
    md += ["- **P3 fewer-main-roads**: Phase 3 spike profile (stock foot priority, trunk and primary x0.2), reference.",
           "- **shortest**: Valhalla pedestrian, the baseline and the future \"shortest\" alternative.", "",
           "## Summary", "", "| | " + " | ".join(variants) + " |", "| --- |" + " --- |" * len(variants)]

    def line(title, fn):
        md.append(f"| {title} | " + " | ".join("-" if S[n] is None else fn(S[n]) for n in variants) + " |")

    line("Routes (without a route)", lambda s: f"{s['n']} ({len(s['errors'])})")
    line("Trunk/motorway km, all routes", lambda s: f"{s['highway_km']:.1f}")
    line("Routes using trunk/motorway (would carry the NH flag)", lambda s: str(s["routes_highway"]))
    line("Primary km, all routes", lambda s: f"{s['primary_km']:.1f}")
    line("Footway/path/track/steps km, all routes", lambda s: f"{s['path_km']:.1f}")
    line("Path share, median / p90", lambda s: f"{s['path_share_med']:.1f}% / {s['path_share_p90']:.1f}%")
    line("Routes with >= 50 m of paths", lambda s: str(s["routes_with_paths"]))
    line(f"... of which paths are the only connection (blocked: no route or > {PATH_DETOUR_LIMIT:.0%} longer)",
         lambda s: str(len(s["paths_only_connection"])) if s["routes_with_paths"] else "-")
    line("Extra length vs shortest, median / p90 / max",
         lambda s: f"{s['extra_med']:+.1f}% / {s['extra_p90']:+.1f}% / {s['extra_max']:+.1f}%")
    line("Edge overlap with shortest, median (routes under 60%)",
         lambda s: "-" if s["overlap_med"] is None else f"{s['overlap_med']:.0f}% ({s['under_60']})")
    line("map_snap coverage gap (likely access violation)", lambda s: str(s["snap_gap"]))
    line("Uses a tag-unwalkable way", lambda s: str(s["tag_bad"]))
    line("Ferry metres", lambda s: f"{s['ferry_m']:.0f}")
    line("GraphHopper / Valhalla latency p50 / p95", lambda s: f"{s['ms_p50']:.0f} / {s['ms_p95']:.0f} ms")
    md += ["", "## National-highway flag: trunk versus `ref=NH*`", ""]
    for n in MODELS:
        s = S[n]
        md.append(f"- {n}: {s['highway_ways']} trunk/motorway ways used, {s['highway_ways_without_nh']} of them without "
                  "an NH ref.")
    md += [f"- Primary ways with an NH ref among all ways used by any variant: {len(primary_nh)}"
           + (": " + ", ".join(f"[{w}](https://www.openstreetmap.org/way/{w}) ({tags[w].get('ref')})"
                               for w in primary_nh[:10]) if primary_nh else "") + ".", ""]
    md += ["## Paths used, per model", ""]
    for n in MODELS:
        s = S[n]
        md.append(f"**{n}.** Only connection: " + (", ".join(
            f"{x[0]} ({x[1]:.0f} m, blocked {x[2]:+.0f}%)" if isinstance(x, tuple) else f"{x} (no route)"
            for x in s["paths_only_connection"]) or "none") + ". Avoidable at under "
                  f"{PATH_DETOUR_LIMIT:.0%} extra: " + (", ".join(f"{x[0]} ({x[1]:.0f} m, blocked {x[2]:+.0f}%)"
                                                                for x in s["paths_avoidable"]) or "none") + ".")
        md.append("")
    for n in variants:
        if S[n]["tag_bad_ways"]:
            md.append(f"Tag-unwalkable ways used by {n}: " + ", ".join(
                f"[{w}](https://www.openstreetmap.org/way/{w}) (`highway={tags[w].get('highway')}`"
                + "".join(f", `{k}={tags[w][k]}`" for k in ("foot", "access") if k in tags[w]) + ")"
                for w in S[n]["tag_bad_ways"]))
            md.append("")
    md += ["## Every route (length m / trunk+motorway m / primary m / paths m)", "",
           "| Route | " + " | ".join(variants) + " |", "| --- |" + " --- |" * len(variants)]
    for r in rows:
        md.append(f"| {r['route']} | " + " | ".join(
            "no route" if "error" in r[n] else
            f"{r[n]['length']:.0f} / {r[n]['highway_m']:.0f} / {r[n]['primary_m']:.0f} / {r[n]['path_m']:.0f}"
            for n in variants) + " |")
    md.append("")
    (OUT / "road_priority.md").write_text("\n".join(md), encoding="utf-8")
    (OUT / "road_priority_data.json").write_text(json.dumps(
        {"summary": S, "primary_nh_ways": primary_nh}, indent=1, default=list), encoding="utf-8")
    for n in variants:
        s = S[n]
        print(f"{n:22s} hw {s['highway_km']:5.1f} km ({s['routes_highway']} routes)  primary {s['primary_km']:5.1f} km  "
              f"paths {s['path_km']:5.1f} km  extra med {s['extra_med']:+5.1f}% p90 {s['extra_p90']:+5.1f}%  "
              f"snap-gap {s['snap_gap']} tag-bad {s['tag_bad']}  p50 {s['ms_p50']:.0f} ms")
    print("Report: docs/reports/phase3b/road_priority.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
