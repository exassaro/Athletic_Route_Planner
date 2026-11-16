"""Command-line runner.

Usage:
  uv run python -m athlete_solver solve request.json [--geojson out.geojson]

Reads a RouteRequest as JSON, solves it against Valhalla (VALHALLA_URL,
default http://localhost:8002) and prints the SolveResult as JSON.
"""

import argparse
import json
import sys
from pathlib import Path

from athlete_engine.valhalla import Valhalla

from .models import RouteRequest
from .solve import solve

ROOT = Path(__file__).resolve().parents[2]


def graph_build() -> str:
    manifest = ROOT / "data" / "manifest.json"
    if manifest.exists():
        return json.loads(manifest.read_text(encoding="utf-8"))["extract"]["osm_timestamp"]
    return "unknown"


def to_geojson(result) -> dict:
    features = []
    for c in result.candidates:
        props = {k: v for k, v in c.model_dump().items() if k not in ("geometry", "edge_ids", "stops")}
        features.append({"type": "Feature", "properties": props,
                         "geometry": {"type": "LineString", "coordinates": c.geometry}})
        for s in c.stops:
            features.append({"type": "Feature", "properties": {"candidate": c.label, "role": s.role, "label": s.label,
                                                               "at_m": s.at_m},
                             "geometry": {"type": "Point", "coordinates": [s.snapped_lon, s.snapped_lat]}})
    return {"type": "FeatureCollection", "features": features}


def main() -> int:
    parser = argparse.ArgumentParser(prog="athlete_solver", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p_solve = sub.add_parser("solve", help="solve one request")
    p_solve.add_argument("request", type=Path)
    p_solve.add_argument("--geojson", type=Path, help="also write candidates as GeoJSON")
    args = parser.parse_args()

    request = RouteRequest.model_validate_json(args.request.read_text(encoding="utf-8"))
    with Valhalla() as engine:
        result = solve(request, engine=engine, graph_build=graph_build())
    print(result.model_dump_json(indent=2, exclude={"candidates": {"__all__": {"edge_ids"}}}))
    if args.geojson:
        args.geojson.write_text(json.dumps(to_geojson(result)), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
