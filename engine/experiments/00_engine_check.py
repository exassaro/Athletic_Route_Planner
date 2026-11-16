"""Step 3 check: is Valhalla up, on which data, and is elevation loaded?

Usage:  uv run python engine/experiments/00_engine_check.py
"""

import json
import sys
from pathlib import Path

from athlete_engine.valhalla import Valhalla

ROOT = Path(__file__).resolve().parents[2]
PLACES = json.loads((ROOT / "tests" / "fixtures" / "places.json").read_text(encoding="utf-8"))["places"]


def main() -> int:
    with Valhalla() as engine:
        status = engine.status()
        print(f"Valhalla version: {status.get('version')}")
        print(f"Tileset last modified (unix): {status.get('tileset_last_modified')}")

        names = ["beypore", "kozhikode", "vythiri"]
        heights = engine.height([(PLACES[n]["lon"], PLACES[n]["lat"]) for n in names])
        for name, h in zip(names, heights):
            print(f"Elevation at {name:10s} ({PLACES[name]['osm_id']}): {h} m")

    ok = all(h is not None for h in heights) and heights[2] > heights[0] and heights[2] > heights[1]
    print("PASS: elevation loaded, Wayanad point is higher than the coast" if ok
          else "FAIL: elevation missing or implausible")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
