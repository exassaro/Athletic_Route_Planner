"""Record real Photon responses for the API's place tests (no Photon needed when the tests run).

Usage:  uv run python api/scripts/record_photon_fixtures.py

Needs Photon up (docker compose --profile geocode up -d photon). Writes tests/fixtures/photon/<name>.json with
the exact query sent and Photon's response. The queries use the same parameters as athlete_api.places.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

from athlete_api.places import KERALA_BBOX, search_params

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "fixtures" / "photon"
PHOTON = "http://localhost:2322"
# Bias point: the A01 start (Athanikkal, osm:node/1770460252), from tests/fixtures/scenarios/scenarios.json.
fixtures = json.loads((ROOT / "tests/fixtures/scenarios/scenarios.json").read_text(encoding="utf-8"))["fixtures"]
START = next(f for f in fixtures if f["id"] == "A01")["request"]["start"]

SEARCHES = {
    "search_kadalundi": "Kadalundi",          # three exact "Kadalundi" in Kozhikode: village, boundary, station
    "search_chungam": "Chungam",              # the same name in several districts and taluks
    "search_kunnamangalam": "Kunnamangalam",  # Kozhikode and Mananthavady
    "search_mananchira": "Mananchira",
    "search_nothing": "Qzxjvw",
}
REVERSES = {"reverse_athanikkal": (START["lon"], START["lat"])}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    recorded = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with httpx.Client(base_url=PHOTON, timeout=30) as http:
        status = http.get("/status").json()
        for name, q in SEARCHES.items():
            params = search_params(q, START["lon"], START["lat"], 10)
            resp = http.get("/api", params=params)
            resp.raise_for_status()
            (OUT / f"{name}.json").write_text(json.dumps(
                {"recorded": recorded, "photon": status, "path": "/api", "params": params, "response": resp.json()},
                indent=1, ensure_ascii=False), encoding="utf-8")
            print(name, len(resp.json()["features"]), "features")
        for name, (lon, lat) in REVERSES.items():
            params = {"lon": lon, "lat": lat, "limit": 1, "lang": "en"}
            resp = http.get("/reverse", params=params)
            resp.raise_for_status()
            (OUT / f"{name}.json").write_text(json.dumps(
                {"recorded": recorded, "photon": status, "path": "/reverse", "params": params, "response": resp.json()},
                indent=1, ensure_ascii=False), encoding="utf-8")
            print(name, len(resp.json()["features"]), "features")
    print("bbox used:", KERALA_BBOX)
    return 0


if __name__ == "__main__":
    sys.exit(main())
