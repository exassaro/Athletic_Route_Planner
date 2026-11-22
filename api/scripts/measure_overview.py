"""Phase 5d step 1: do smart overview points beat even spacing? (blueprint Phase 5d amendment 2, A14)

    uv run python api/scripts/measure_overview.py      # needs Valhalla -> docs/reports/phase5d/overview_data.json

A measurement, not the endpoint. For N = 1 to 9 waypoints between a route's fixed ends, Valhalla pedestrian
(ferries excluded, each waypoint a break, as a stop is in a Google Maps link) draws the path, and that path is
compared with our geometry:

- even: the km marks the web app picks today (web/src/export/googleMaps.ts, pickEvenly);
- smart: amendment 2's rule, greedy. In the leg that deviates most, add our point farthest from that leg's path.

Deviation is measured leg by leg, both ways, sampled every 25 m. It is a straight-line proximity, never a route
distance. Overlap is given two ways: against the whole path (the amendment's wording) and leg by leg, which
does not credit a pass that another leg happens to cover. Path lengths are measured from the geometry.
"""

import json
import math
import time
from pathlib import Path
from xml.etree import ElementTree as ET

from athlete_engine import geodesy
from athlete_engine.valhalla import Valhalla
from athlete_solver.engine import ValhallaEngine
from shapely.geometry import LineString, Point

ROOT = Path(__file__).resolve().parents[2]
GPX = ROOT / "docs" / "reports" / "phase4" / "gpx"
OUT = ROOT / "docs" / "reports" / "phase5d" / "overview_data.json"
STEP_M = 25.0
NEAR_M = 30.0
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


class Track:
    def __init__(self, geometry, engine: ValhallaEngine):
        self.engine = engine
        self.legs: dict[tuple[int, int], dict] = {}
        self.origin = geometry[0]
        lon, lat = self.origin
        self.kx = geodesy.distance_m(self.origin, (lon + 0.01, lat)) / 0.01
        self.ky = geodesy.distance_m(self.origin, (lon, lat + 0.01)) / 0.01
        samples = geodesy.sample_every(geometry, STEP_M)
        self.points = [p for p, _ in samples]
        self.at = [d for _, d in samples]
        self.flat = [self.xy(p) for p in self.points]
        self.length_m = self.at[-1]

    def xy(self, p) -> tuple[float, float]:
        """Metres on a local plane, for proximity only."""
        return ((p[0] - self.origin[0]) * self.kx, (p[1] - self.origin[1]) * self.ky)

    @staticmethod
    def shape(points):
        return LineString(points) if len(set(points)) > 1 else Point(points[0])

    def leg(self, a: int, b: int) -> dict:
        if (a, b) not in self.legs:
            start, end = self.points[a], self.points[b]
            # a loop with no waypoint asks for a route from the start to itself: the path is that point
            path = [start] if geodesy.distance_m(start, end) < 1.0 else self.engine.route([start, end]).shape
            line = self.shape([self.xy(p) for p in path])
            ours = self.shape(self.flat[a:b + 1])
            off = [line.distance(Point(p)) for p in self.flat[a:b + 1]]
            back = [ours.distance(Point(self.xy(p))) for p, _ in geodesy.sample_every(path, STEP_M)] \
                if len(path) > 1 else [0.0]
            self.legs[a, b] = {"path": path, "off": off, "worst": max(max(off), max(back)),
                               "farthest": a + max(range(len(off)), key=off.__getitem__),
                               "length_m": geodesy.line_length_m(path)}
        return self.legs[a, b]

    def measure(self, via: list[int]) -> dict:
        stops = [0, *via, len(self.points) - 1]
        legs = [self.leg(a, b) for a, b in zip(stops, stops[1:])]
        whole = self.shape([self.xy(p) for leg in legs for p in leg["path"]])
        by_leg = total = near_path = 0.0
        for a, b, leg in zip(stops, stops[1:], legs):
            for k in range(a, b):
                weight = self.at[k + 1] - self.at[k]
                total += weight
                by_leg += weight * (leg["off"][k - a] <= NEAR_M)
                near_path += weight * (whole.distance(Point(self.flat[k])) <= NEAR_M)
        return {"used": len(via), "at_m": [round(self.at[k], 1) for k in via],
                "max_deviation_m": round(max(leg["worst"] for leg in legs), 1),
                "overlap_pct": round(100 * near_path / total, 1),
                "overlap_by_leg_pct": round(100 * by_leg / total, 1),
                "path_length_m": round(sum(leg["length_m"] for leg in legs), 1)}

    def even(self, n: int) -> list[int]:
        marks = [round(km * 1000 / STEP_M) for km in range(1, math.ceil(self.length_m / 1000))]
        if len(marks) <= n:
            return marks
        return [marks[math.floor((i + 1) * (len(marks) + 1) / (n + 1) + 0.5) - 1] for i in range(n)]

    def smart(self, n: int) -> list[int]:
        via: list[int] = []
        while len(via) < n:
            stops = [0, *via, len(self.points) - 1]
            ranked = sorted(zip(stops, stops[1:]), key=lambda ab: self.leg(*ab)["worst"], reverse=True)
            added = next((self.leg(a, b)["farthest"] for a, b in ranked
                          if self.leg(a, b)["worst"] >= NEAR_M and a < self.leg(a, b)["farthest"] < b), None)
            if added is None:
                break
            via = sorted([*via, added])
        return via


def main() -> None:
    out = {"measured_on": "the development laptop, Valhalla in Docker called from the host",
           "step_m": STEP_M, "near_m": NEAR_M, "tracks": {}}
    with Valhalla() as client:
        out["valhalla"] = {k: client.status()[k] for k in ("version", "tileset_last_modified")}
        for name, geometry in tracks().items():
            engine = ValhallaEngine(client)
            track = Track(geometry, engine)
            started, rows = time.perf_counter(), []
            smart = {n: track.smart(n) for n in range(1, MAX_N + 1)}
            smart_s, smart_calls = time.perf_counter() - started, engine.calls
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
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"\n{OUT.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
