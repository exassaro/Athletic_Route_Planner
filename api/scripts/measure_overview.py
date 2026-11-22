"""Phase 5d step 1: do smart overview points beat even spacing? (blueprint Phase 5d amendment 2, A14)

    uv run python api/scripts/measure_overview.py      # needs Valhalla -> docs/reports/phase5d/overview_data.json
                                                       #               and tests/fixtures/overview/legs.json

For N = 1 to 9 waypoints between a route's fixed ends, Valhalla pedestrian (ferries excluded, each waypoint a
break, as a stop is in a Google Maps link) draws the path, and that path is compared with our geometry:

- even: the km marks the web app falls back to (web/src/export/googleMaps.ts, pickEvenly);
- smart: the endpoint's own rule and measurement (athlete_api.overview).

Overlap is also given against the whole path, to show what leg by leg avoids. Path lengths are measured from the
geometry. The Valhalla paths behind A01 and S02 are recorded for the unit tests.
"""

import json
import math
import time
from pathlib import Path
from xml.etree import ElementTree as ET

from athlete_api import overview
from athlete_engine import geodesy, polyline
from athlete_engine.valhalla import Valhalla
from athlete_solver.engine import ValhallaEngine
from shapely.geometry import LineString, Point

ROOT = Path(__file__).resolve().parents[2]
GPX = ROOT / "docs" / "reports" / "phase4" / "gpx"
OUT = ROOT / "docs" / "reports" / "phase5d" / "overview_data.json"
FIXTURE = ROOT / "tests" / "fixtures" / "overview" / "legs.json"
RECORDED = ("A01 recommended", "S02 loop")
MAX_N = 9


def gpx_track(name: str) -> list[tuple[float, float]]:
    points = ET.parse(GPX / name).iter("{http://www.topografix.com/GPX/1/1}trkpt")
    return [(float(p.get("lon")), float(p.get("lat"))) for p in points]


def tracks() -> dict[str, list[tuple[float, float]]]:
    a01 = gpx_track("A01_recommended.gpx")
    features = json.loads((ROOT / "docs/reports/phase3b/acceptance_A01.geojson").read_text(encoding="utf-8"))["features"]
    shortest = next(f["geometry"]["coordinates"] for f in features if f["geometry"]["type"] == "LineString"
                    and f["properties"]["label"] == "shortest")
    half = geodesy.cut_at(a01, geodesy.line_length_m(a01) / 2)
    return {"A01 recommended": a01, "S02 loop": gpx_track("S02_loop_1.gpx"),
            "A01 shortest": [(p[0], p[1]) for p in shortest], "A01 half, out and back": half + half[-2::-1]}


class Track(overview.Fidelity):
    def __init__(self, geometry, engine: ValhallaEngine):
        self.calls: list[tuple] = []

        def route(a, b):
            path = engine.route([a, b]).shape
            self.calls.append((a, b, path))
            return path

        super().__init__(geometry, route)
        self.length_m = self.at_m[-1]

    def measure(self, via: list[int]) -> dict:
        legs = [(a, b, self.leg(a, b)) for a, b in self.stops(via)]
        flat = [self.xy(p) for _, _, leg in legs for p in leg.path]
        whole = LineString(flat) if len(set(flat)) > 1 else Point(flat[0])
        near_path = sum(self.at_m[k + 1] - self.at_m[k] for a, b, _ in legs for k in range(a, b)
                        if whole.distance(Point(self.flat[k])) <= overview.NEAR_M)
        return {"used": len(via), "at_m": [round(self.at_m[k], 1) for k in via],
                "max_deviation_m": round(self.max_deviation_m(via), 1),
                "overlap_pct": round(100 * near_path / self.length_m, 1),
                "overlap_by_leg_pct": round(self.overlap_pct(via), 1),
                "path_length_m": round(sum(geodesy.line_length_m(leg.path) for _, _, leg in legs), 1)}

    def even(self, n: int) -> list[int]:
        marks = [round(km * 1000 / overview.SAMPLE_M) for km in range(1, math.ceil(self.length_m / 1000))]
        if len(marks) <= n:
            return marks
        return [marks[math.floor((i + 1) * (len(marks) + 1) / (n + 1) + 0.5) - 1] for i in range(n)]


def main() -> None:
    out = {"measured_on": "the development laptop, Valhalla in Docker called from the host",
           "step_m": overview.SAMPLE_M, "near_m": overview.NEAR_M, "tracks": {}}
    recorded = {}
    with Valhalla() as client:
        out["valhalla"] = {k: client.status()[k] for k in ("version", "tileset_last_modified")}
        for name, geometry in tracks().items():
            engine = ValhallaEngine(client)
            track = Track(geometry, engine)
            started, rows = time.perf_counter(), []
            calls_for_test = []
            smart = {n: track.greedy(n) for n in range(1, MAX_N + 1)}
            smart_s, smart_calls = time.perf_counter() - started, engine.calls
            for n in (3, MAX_N):     # the unit tests compare with even spacing at the app's two limits
                track.max_deviation_m(track.even(n))
            calls_for_test.extend(track.calls)
            print(f"\n{name}: {track.length_m:.1f} m; smart N=1..{MAX_N}: {smart_calls} calls, {smart_s:.2f} s")
            print(" N | deviation m    | overlap %     | by leg %      | path - ours, m")
            print("   |  even   smart  |  even  smart  |  even  smart  |  even   smart")
            for n, via in smart.items():
                e, s = track.measure(track.even(n)), track.measure(via)
                rows.append({"n": n, "even": e, "smart": s})
                print(f"{n:2} | {e['max_deviation_m']:6.0f} {s['max_deviation_m']:6.0f}  |"
                      f" {e['overlap_pct']:5.1f} {s['overlap_pct']:6.1f}  |"
                      f" {e['overlap_by_leg_pct']:5.1f} {s['overlap_by_leg_pct']:6.1f}  |"
                      f" {e['path_length_m'] - track.length_m:+6.0f} {s['path_length_m'] - track.length_m:+6.0f}")
            out["tracks"][name] = {"length_m": round(track.length_m, 1), "smart_calls": smart_calls,
                                   "smart_s": round(smart_s, 2), "rows": rows}
            if name in RECORDED:
                recorded[name] = [{"from": [round(v, 7) for v in a], "to": [round(v, 7) for v in b],
                                   "shape": polyline.encode(path)} for a, b, path in calls_for_test]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8", newline="\n")
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps({"source": "api/scripts/measure_overview.py: real Valhalla paths, "
                                             "never edit by hand", "valhalla": out["valhalla"],
                                   "tracks": recorded}, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"\n{OUT.relative_to(ROOT).as_posix()}, {FIXTURE.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
