"""Phase 5d step 3: how good are the Follow cues? (blueprint Phase 5d amendment 6, A15)

    uv run python api/scripts/measure_cues.py      # needs Valhalla -> docs/reports/phase5d/cues_data.json
                                                   #               and tests/fixtures/follow/traces.json

The cues of athlete_api.follow against Valhalla's own turn instructions, which are made independently of them:
/route maneuvers on the seeded OD pairs, /trace_route maneuvers on the four tracks of measure_overview.py.

- recall: Valhalla's left, right and sharp turns with a step of the same side within 30 m;
- precision: steps with any turn-like Valhalla maneuver within 30 m.

A step is a cue or one of the turns merged into it. The traces of A01, S02 and the out-and-back are recorded
for the unit tests.
"""

import json
from dataclasses import asdict
from pathlib import Path

from athlete_api import follow
from athlete_engine import polyline
from athlete_engine.policy import pedestrian_options
from athlete_engine.valhalla import Valhalla, loc, route_shape

from measure_overview import tracks

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "reports" / "phase5d" / "cues_data.json"
FIXTURE = ROOT / "tests" / "fixtures" / "follow" / "traces.json"
RECORDED = ("A01 recommended", "S02 loop", "A01 half, out and back")
REACHES = (5.0, 10.0, 15.0, 20.0, 25.0)
NEAR_M = 30.0
# Valhalla maneuver types: 10 right, 11 sharp right, 14 sharp left, 15 left
TURN = {10: "right", 11: "right", 14: "left", 15: "left"}
# also slight turns, U-turns, ramps, exits, stay left or right, merges, roundabouts
TURN_LIKE = {9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 23, 24, 25, 26, 27, 37, 38}


def maneuvers(line: follow.Line, response: dict, first: int = 0) -> list[tuple[float, int]]:
    """(metres along our line, type), placed forward only so that repeated road stays in order."""
    found, start = [], first
    for leg in response["trip"]["legs"]:
        shape = polyline.decode(leg["shape"], precision=6)
        for man in leg["maneuvers"]:
            point = shape[man["begin_shape_index"]]
            best = None
            for i in range(start, len(line.geometry) - 1):
                off, at = line.project(point, i, i + 1)
                if best is None or off < best[0] - 1e-6:
                    best = (off, at, i)
                if best[0] < 3.0 and line.along_m[i] - best[1] > 80.0:
                    break
            if best and best[0] < 20.0:
                found.append((best[1], man["type"]))
                start = best[2]
    return found


def score(cases: list[tuple], reach_m: float | None) -> dict:
    """reach_m None: geometry only, as without Valhalla."""
    out = dict(cues=0, steps=0, turns=0, turns_found=0, steps_confirmed=0)
    metres = 0.0
    for line, match, reference in cases:
        found = follow.cues(line, None) if reach_m is None else follow.cues(line, match, reach_m)
        steps = [s for cue in found for s in (cue, *cue.then)]
        metres += line.length_m
        out["cues"] += len(found)
        out["steps"] += len(steps)
        for at, kind in reference:
            if kind in TURN:
                out["turns"] += 1
                out["turns_found"] += any(abs(s.at_m - at) <= NEAR_M and s.turn == TURN[kind] for s in steps)
        out["steps_confirmed"] += sum(any(abs(s.at_m - at) <= NEAR_M and kind in TURN_LIKE for at, kind in reference)
                                      for s in steps)
    out["cues_per_km"] = round(out["cues"] / (metres / 1000.0), 1)
    out["recall_pct"] = round(100 * out["turns_found"] / max(out["turns"], 1), 1)
    out["precision_pct"] = round(100 * out["steps_confirmed"] / max(out["steps"], 1), 1)
    return out


def scores(cases: list[tuple]) -> dict:
    return {"geometry_only": score(cases, None),
            **{f"junction_{reach:g}m": score(cases, reach) for reach in REACHES}}


def main() -> None:
    options = pedestrian_options()
    data = {"measured_on": "the development laptop, Valhalla in Docker called from the host",
            "chosen": f"junction_{follow.JUNCTION_REACH_M:g}m", "tracks": {}}
    recorded = {}
    with Valhalla() as client:
        status = client.status()
        data["valhalla"] = {k: status[k] for k in ("version", "tileset_last_modified")}

        def trace(piece):
            return client.trace_attributes(piece, shape_match=follow.TRACE_MATCH, costing_options=options,
                                           attributes=follow.TRACE_ATTRIBUTES)

        for name, geometry in tracks().items():
            line = follow.Line(geometry)
            responses = []
            match = line.match(lambda piece: responses.append(trace(piece)) or responses[-1])
            reference = []
            for first, last in line.pieces():
                reference += maneuvers(line, client._post("/trace_route", {
                    "encoded_polyline": polyline.encode(geometry[first:last + 1]), "costing": "pedestrian",
                    "shape_match": "walk_or_snap", "costing_options": {"pedestrian": options}}), first)
            data["tracks"][name] = {"length_m": round(line.length_m, 1),
                                    "scores": scores([(line, match, reference)]),
                                    "cues": [asdict(c) | {"at_m": round(c.at_m, 1)} for c in follow.cues(line, match)]}
            if name in RECORDED:
                recorded[name] = responses

        cases = []
        pairs = json.loads((ROOT / "tests/fixtures/od_pairs.json").read_text(encoding="utf-8"))["pairs"]
        for pair in pairs:
            ends = [loc((pair[k]["lon"], pair[k]["lat"])) for k in ("from", "to")]
            response = client.route(ends, costing_options=options)
            geometry = route_shape(response)
            if len(geometry) < 3:
                continue
            line = follow.Line(geometry)
            cases.append((line, line.match(trace), maneuvers(line, response)))
        data["od_pairs"] = {"routes": len(cases), "scores": scores(cases)}

    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps({"source": "api/scripts/measure_cues.py: real Valhalla answers, never edit by hand",
                                   "valhalla": data["valhalla"], "tracks": recorded},
                                  separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    for name, got in [*data["tracks"].items(), ("OD pairs", data["od_pairs"])]:
        print(f"\n{name}")
        for rule, s in got["scores"].items():
            print(f"  {rule:15} {s['cues']:5} cues {s['cues_per_km']:4}/km  "
                  f"recall {s['turns_found']}/{s['turns']} = {s['recall_pct']}%  "
                  f"precision {s['steps_confirmed']}/{s['steps']} = {s['precision_pct']}%")
        for c in got.get("cues", []) if name in RECORDED[:2] else []:
            print(f"    {c['at_m']:8.1f} " + ", then ".join(
                s["turn"] + (f" onto {s['road']}" if s["road"] else "") for s in [c, *c["then"]]))


if __name__ == "__main__":
    main()
