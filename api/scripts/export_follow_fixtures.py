"""A15 responses for the web's Follow tests and simulation (blueprint Phase 5d step 5). No services needed.

    uv run python api/scripts/export_follow_fixtures.py [--check]      # -> tests/fixtures/follow/routes.json

A01, S02 and the out-and-back as `GET /v1/routes/{id}/follow` returns them, built by the API's own code from the
Valhalla traces recorded in tests/fixtures/follow/traces.json. Never edit the output by hand. --check exits 1 if it
is stale (a unit test runs the same comparison).
"""

import json
import sys
import uuid
from pathlib import Path
from xml.etree import ElementTree as ET

from athlete_api import follow
from athlete_api.following import follow_out
from athlete_engine import geodesy

ROOT = Path(__file__).resolve().parents[2]
GPX = ROOT / "docs" / "reports" / "phase4" / "gpx"
TRACES = ROOT / "tests" / "fixtures" / "follow" / "traces.json"
OUT = ROOT / "tests" / "fixtures" / "follow" / "routes.json"
TRACKS = {"A01": "A01 recommended", "S02": "S02 loop", "out_and_back": "A01 half, out and back"}


def geometry(name: str) -> list[tuple[float, float]]:
    file = "S02_loop_1.gpx" if name == "S02" else "A01_recommended.gpx"
    points = ET.parse(GPX / file).iter("{http://www.topografix.com/GPX/1/1}trkpt")
    line = [(float(p.get("lon")), float(p.get("lat"))) for p in points]
    if name == "out_and_back":
        half = geodesy.cut_at(line, geodesy.line_length_m(line) / 2)
        line = half + half[-2::-1]
        # the cut's point, rounded as the geometry's others are printed (the same on every platform)
        line = [(round(lon, 7), round(lat, 7)) for lon, lat in line]
    return line


def build() -> dict:
    traces = json.loads(TRACES.read_text(encoding="utf-8"))["tracks"]
    routes = {}
    for seq, (name, track) in enumerate(TRACKS.items(), start=1):
        line, answers = follow.Line(geometry(name)), iter(traces[track])
        out = follow_out(uuid.UUID(int=seq), line, line.match(lambda piece: next(answers)))
        routes[name] = out.model_dump(mode="json")
    return {"source": "api/scripts/export_follow_fixtures.py: the API's follow response, never edit by hand",
            "routes": routes}


def render() -> str:
    return json.dumps(build(), separators=(",", ":"), ensure_ascii=False) + "\n"


def main() -> int:
    text = render()
    if "--check" in sys.argv:
        if not OUT.exists() or json.loads(OUT.read_text(encoding="utf-8")) != json.loads(text):
            print(f"{OUT} is stale: run uv run python api/scripts/export_follow_fixtures.py", file=sys.stderr)
            return 1
        print("follow fixtures are current")
        return 0
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote {OUT.relative_to(ROOT).as_posix()} ({len(text) // 1024} KiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
