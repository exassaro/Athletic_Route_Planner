"""Expand the section 16 scenarios into fixtures and compute reference values on the pinned graph.

Usage:  uv run python tests/kpi/build_scenarios.py      (Valhalla must be running)

Reads tests/fixtures/scenarios/base.json and tests/fixtures/places.json and
writes tests/fixtures/scenarios/scenarios.json: one RouteRequest per fixture
plus the reference values from tests/kpi/reference.py. Nothing here is typed
in by hand except the requests themselves.
"""

import copy
import json
import random
import sys
from pathlib import Path

from athlete_engine.osm import sample_way_points
from athlete_engine.valhalla import Valhalla

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reference import loop_gate_reference, reference_for  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures"
PLACES_DOC = json.loads((FIXTURES / "places.json").read_text(encoding="utf-8"))
PLACES = PLACES_DOC["places"]
BASE = json.loads((FIXTURES / "scenarios" / "base.json").read_text(encoding="utf-8"))
OUT = FIXTURES / "scenarios" / "scenarios.json"
PBF = ROOT / "data" / "osm" / "kerala.osm.pbf"
MANIFEST = ROOT / "data" / "manifest.json"
PIN = json.loads((ROOT / "engine" / "osm_pin.json").read_text(encoding="utf-8"))


RULES = json.loads((FIXTURES / "rules_places.json").read_text(encoding="utf-8"))["places"]


def point(key: str) -> dict:
    """A place from places.json, or from rules_places.json with the prefix "r:" (both pinned by OSM id)."""
    if key.startswith("r:"):
        p = RULES[key[2:]]
        out = {"lon": p["lon"], "lat": p["lat"], "label": p.get("name") or key[2:], "place_id": f"osm:{p['osm_id']}"}
        if p.get("kind") == "bridge" or p["osm_id"].startswith("way/"):
            out["way_ids"] = [int(p["osm_id"].split("/")[1])]
            out["lines"] = [p["coords"]]
        return out
    p = PLACES[key]
    label = p.get("name") or key
    out = {"lon": p["lon"], "lat": p["lat"], "label": label}
    if "osm_id" in p:
        out["place_id"] = f"osm:{p['osm_id']}"
    return out


def own_boundary(key: str) -> dict | None:
    """The most local OSM boundary named after the place (pass-near fallback, Phase 3 amendment 3)."""
    if not key.startswith("r:"):
        return None
    p = RULES[key[2:]]
    word = (p.get("name") or "").lower().split()[0] if p.get("name") else ""
    for b in p.get("boundaries", []):          # most local first
        if word and word in (b.get("name") or "").lower():
            return b["geometry"]
    return None


def item(spec, defaults: dict | None = None) -> dict:
    """A stop, via, must_use or avoid entry: a key string, or {"place": key, ...extra fields}."""
    if isinstance(spec, str):
        spec = {"place": spec}
    out = dict(defaults or {})
    if "place" in spec:
        key = spec["place"]
        out.update(point(key))
        out["label"] = (RULES[key[2:]].get("name") if key.startswith("r:") else PLACES[key].get("name")) or key
        kind = spec.get("kind", "place")
        if kind == "place" and not spec.get("must_reach", out.get("must_reach", False)):
            b = own_boundary(key)
            if b is not None and spec.get("boundary", True):
                out["boundary"] = b
        if kind not in ("bridge", "road"):
            out.pop("way_ids", None)
            out.pop("lines", None)
    out.update({k: v for k, v in spec.items() if k not in ("place", "boundary")})
    return out


def resolve(req: dict) -> dict:
    """Replace place keys with coordinates (and OSM ways and boundaries) from the pinned fixtures."""
    req = copy.deepcopy(req)
    if isinstance(req["start"], str):
        req["start"] = point(req["start"])
    d = req.get("direction")
    if d and d["kind"] == "towards_place" and isinstance(d["place"], str):
        d["place"] = point(d["place"])
    if isinstance(req.get("end"), str):
        req["end"] = {"kind": "fixed", "point": point(req["end"])}
    defaults = req.pop("checkpoint_defaults", {})
    req["checkpoints"] = [item(c, defaults) for c in req.get("checkpoints", [])]
    for key in ("via", "must_use"):
        if key in req:
            req[key] = [item(v) for v in req[key]]
    if "avoid" in req:
        out = []
        for a in req["avoid"]:
            x = item(a)
            x.pop("place_id", None)
            if x.get("kind") == "road":
                x.pop("lon", None)
                x.pop("lat", None)
            out.append(x)
        req["avoid"] = out
    return req


def pass_near_request(req: dict) -> bool:
    """True if the brute-force reference (every stop reached as a break) does not model the request: any stop
    passed near (the default), any bridge, road or junction, or any via, must_use or avoid item."""
    return any(c.get("kind", "place") != "place" or not c.get("must_reach", False) for c in req.get("checkpoints", []))         or bool(req.get("via") or req.get("must_use") or req.get("avoid"))


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    graph = manifest["extract"]["osm_timestamp"]
    if graph != PIN["osm_timestamp"] or manifest["extract"]["md5"] != PIN["md5"]:
        print(f"Local graph {graph} is not the pinned extract {PIN['osm_timestamp']}.", file=sys.stderr)
        return 1

    variants = BASE["variants"]
    rng = random.Random(variants["seed"])
    half = variants["nearby_start_half_box_deg"]
    fixtures = []
    by_id = {}

    for sc in BASE["scenarios"]:
        entry = {"id": sc["id"], "title": sc["title"], "base": sc["id"], "status": sc.get("status", "active")}
        for key in ("edit_of", "invariants", "expect_order"):
            if key in sc:
                entry[key] = sc[key]
        entry["request"] = resolve(sc["request"]) if sc.get("request") else None
        fixtures.append(entry)
        by_id[sc["id"]] = entry

    for base_id, count in variants["nearby_starts"].items():
        base = by_id[base_id]
        s = base["request"]["start"]
        pts = sample_way_points(PBF, count, rng.randrange(1 << 30),
                                (s["lon"] - half, s["lat"] - half, s["lon"] + half, s["lat"] + half))
        for i, p in enumerate(pts, start=1):
            req = copy.deepcopy(base["request"])
            req["start"] = {"lon": p["lon"], "lat": p["lat"], "label": f"near {s['label']} ({p['highway']})",
                            "place_id": f"osm:node/{p['osm_node']}"}
            fixtures.append({"id": f"{base_id}-n{i}", "title": f"{base['title']}; start {i} sampled nearby",
                             "base": base_id, "status": "active", "request": req})

    for base_id, budgets in variants["budgets"].items():
        base = by_id[base_id]
        for budget in budgets:
            req = copy.deepcopy(base["request"])
            req["target_distance_m"] = budget
            fixtures.append({"id": f"{base_id}-d{budget // 1000}", "title": f"{base['title']}; budget {budget} m",
                             "base": base_id, "status": "active", "request": req})

    bear = variants["bearings_from_kozhikode"]
    for deg in bear["degrees"]:
        fixtures.append({"id": f"B-kzk-{deg:03d}", "title": f"{bear['distance_m']} m bearing {deg} from Kozhikode",
                         "base": "B02", "status": "active",
                         "request": {"route_type": "point_to_point", "start": point("kozhikode"),
                                     "target_distance_m": bear["distance_m"],
                                     "direction": {"kind": "bearing", "degrees": deg}}})

    active = [f for f in fixtures if f["status"] == "active"]
    print(f"{len(fixtures)} fixtures, {len(active)} active; computing reference values...", flush=True)
    with Valhalla() as engine:
        for f in active:
            r = f["request"]
            target = r["direction"]["place"] if r.get("direction", {}).get("kind") == "towards_place" else None
            end = r.get("end", {}).get("point")
            fixed_end = (end["lon"], end["lat"]) if end else None
            f["reference"] = reference_for(
                engine,
                start=(r["start"]["lon"], r["start"]["lat"]),
                stops={c["label"]: (c["lon"], c["lat"]) for c in r.get("checkpoints", [])},
                target=(target["lon"], target["lat"]) if target else None,
                budget_m=r["target_distance_m"],
                tolerance_m=r.get("tolerance_m", 500.0),
                fixed_order=r.get("checkpoint_order") == "fixed",
                fixed_end=fixed_end,
            )
            if r["route_type"] == "loop" and r.get("checkpoints"):
                f["reference"] = loop_gate_reference(
                    engine, (r["start"]["lon"], r["start"]["lat"]),
                    [(c["label"], (c["lon"], c["lat"]),
                      c.get("kind", "place") == "place" and not c.get("must_reach", False))
                     for c in r["checkpoints"]],
                    r["target_distance_m"], r.get("tolerance_m", 500.0))
            elif pass_near_request(r):
                # The brute-force reference reaches every stop: for a pass-near request it is an upper bound
                # on the minimum, kept for comparison. The outcome itself is checked for consistency.
                f["reference"] = {**f["reference"], "reach_outcome": f["reference"]["outcome"],
                                  "outcome": "pass_near"}
            ref = f["reference"]
            extra = (f" min {ref['minimum_m'] / 1000:.2f} km" if ref.get("minimum_m") else "") + \
                    (f" case {ref['case']}" if "case" in ref else "")
            print(f"  {f['id']:14s} {ref['outcome']:12s}{extra}", flush=True)

    OUT.write_text(json.dumps({
        "graph_build": graph,
        "note": "Generated by tests/kpi/build_scenarios.py. Reference values come from tests/kpi/reference.py "
                "on the pinned graph. Do not edit by hand.",
        "fixtures": fixtures,
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
