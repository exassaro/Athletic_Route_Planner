"""Build the fixed origin/destination pairs used by the length check and latency test.

Usage:  uv run python engine/scripts/build_pairs.py

Points are sampled (fixed seed) from walkable OSM ways in a box around the
Kozhikode place node, then paired so that straight-line separations cover
several bands. The straight-line figure is only a pre-filter to get a spread of
route lengths; it is never reported as a route distance.
Writes tests/fixtures/od_pairs.json.
"""

import json
import random
import sys
from pathlib import Path

from athlete_engine import geodesy
from athlete_engine.osm import sample_way_points

ROOT = Path(__file__).resolve().parents[2]
PBF = ROOT / "data" / "osm" / "kerala.osm.pbf"
FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "places.json").read_text(encoding="utf-8"))
OUT = ROOT / "tests" / "fixtures" / "od_pairs.json"

SEED = 20261116
HALF_BOX_DEG = 0.30          # box half-size around the Kozhikode node
SAMPLE_POINTS = 400
# straight-line pre-filter bands in km, and how many pairs to draw from each
BANDS = [((0.2, 1.0), 10), ((1.0, 5.0), 12), ((5.0, 15.0), 12), ((15.0, 22.0), 10), ((22.0, 45.0), 10)]


def main() -> int:
    if not PBF.exists():
        print("Extract missing. Run engine/scripts/fetch_extract.py first.", file=sys.stderr)
        return 1
    centre = FIXTURES["places"]["kozhikode"]
    bbox = (centre["lon"] - HALF_BOX_DEG, centre["lat"] - HALF_BOX_DEG,
            centre["lon"] + HALF_BOX_DEG, centre["lat"] + HALF_BOX_DEG)
    points = sample_way_points(PBF, SAMPLE_POINTS, SEED, bbox)
    print(f"Sampled {len(points)} points on walkable ways")

    rng = random.Random(SEED)
    pairs = []
    for (lo, hi), wanted in BANDS:
        got = 0
        attempts = 0
        while got < wanted and attempts < 200_000:
            attempts += 1
            a, b = rng.sample(points, 2)
            straight_km = geodesy.distance_m((a["lon"], a["lat"]), (b["lon"], b["lat"])) / 1000
            if lo <= straight_km < hi:
                pairs.append({"id": len(pairs), "prefilter_band_km": [lo, hi], "from": a, "to": b})
                got += 1
        print(f"  band {lo:g}-{hi:g} km straight-line: {got}/{wanted} pairs")

    OUT.write_text(json.dumps({
        "osm_timestamp": FIXTURES["osm_timestamp"], "seed": SEED, "bbox": bbox,
        "note": "prefilter_band_km is straight-line separation used to spread route lengths; not a route distance",
        "pairs": pairs,
    }, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(pairs)} pairs to {OUT.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
