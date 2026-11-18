"""OpenAPI examples from real solver output (Phase 4 step 9).

Usage:  uv run python api/scripts/build_examples.py

Runs the app in-process against the live stack (Valhalla, GraphHopper, Photon, Postgres, Redis) with the real
solver, on fixtures from tests/fixtures/scenarios/scenarios.json:
  A01 (ok, six stops), A01 patched to 20 km (over_budget, with a diff), S11 (Case B options),
  S02 (a loop), G01 (a loop stop out of reach: a conflict, no routes),
plus a route, its elevation, a share and a place search. Writes api/athlete_api/examples/*.json.
Each example keeps every value as the API returned it, except long lists (geometry, profile, places),
shortened for the docs page; the description says so.
"""

import json
import sys
from datetime import date
from pathlib import Path

from fastapi.testclient import TestClient

from athlete_api.config import Settings
from athlete_api.main import create_app

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "api" / "athlete_api" / "examples"
FIXTURES = {f["id"]: f for f in json.loads((ROOT / "tests/fixtures/scenarios/scenarios.json")
                                           .read_text(encoding="utf-8"))["fixtures"]}
KEEP_HEAD, KEEP_TAIL = 3, 2
TODAY = date.today().isoformat()


def shorten(points: list) -> list:
    return points if len(points) <= KEEP_HEAD + KEEP_TAIL else points[:KEEP_HEAD] + points[-KEEP_TAIL:]


def shorten_version(v: dict) -> dict:
    v = json.loads(json.dumps(v))
    for c in v.get("candidates", []):
        c["geometry"] = shorten(c["geometry"])
    return v


def write(name: str, summary: str, description: str, value) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps({"summary": summary, "description": description, "value": value},
                                                 indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{name}: {summary}")


def note(fid: str, extra: str = "") -> str:
    return (f"Real output of the solver through the API for fixture {fid} ({FIXTURES[fid]['title']}), measured on "
            f"the development laptop on {TODAY}. Geometry shortened to its first {KEEP_HEAD} and last {KEEP_TAIL} "
            f"points for this page; the API returns every point.{extra}")


def main() -> int:
    with TestClient(create_app(Settings())) as api:
        h = {"X-Client-Token": api.post("/v1/session").json()["token"]}

        def create(fid: str) -> dict:
            resp = api.post("/v1/plans", json={"request": FIXTURES[fid]["request"], "source": "form"}, headers=h)
            resp.raise_for_status()
            return resp.json()

        for fid in ("A01", "S11", "S02", "G01"):
            write(f"request_{fid}", FIXTURES[fid]["title"], f"Request of fixture {fid}, coordinates from OSM.",
                  {"request": FIXTURES[fid]["request"], "source": "form"})

        a01 = create("A01")
        write("plan_A01", "ok: point to point past six stops", note("A01"), shorten_version(a01))
        patched = api.patch(f"/v1/plans/{a01['plan_id']}", headers={**h, "Content-Type": "application/json-patch+json"},
                            content=json.dumps([{"op": "replace", "path": "/target_distance_m", "value": 20000}]))
        patched.raise_for_status()
        write("plan_A01_20km", "over_budget: the same stops at 20 km, with the diff",
              note("A01", " Version 2, after PATCH target_distance_m 25000 -> 20000."), shorten_version(patched.json()))
        write("patch_distance", "Change the distance", "RFC 6902 patch on the stored request.",
              [{"op": "replace", "path": "/target_distance_m", "value": 20000}])
        write("patch_undo", "Undo: replace the whole request with an earlier one",
              "The value is an earlier version's `request` (shortened here to its first fields).",
              [{"op": "replace", "path": "", "value": {k: a01["request"][k] for k in
                                                         ("activity", "route_type", "start", "target_distance_m")}}])
        write("plan_S11", "ok, Case B: the target is nearer than the distance", note("S11"), shorten_version(create("S11")))
        write("plan_S02", "ok: a loop", note("S02"), shorten_version(create("S02")))
        write("plan_G01", "infeasible: a loop cannot reach a stop and return within the distance", note("G01"),
              shorten_version(create("G01")))

        rid = a01["candidates"][0]["route_id"]
        feat = api.get(f"/v1/routes/{rid}", headers=h).json()
        feat["geometry"]["coordinates"] = shorten(feat["geometry"]["coordinates"])
        write("route_A01", "A01's recommended route as GeoJSON", note("A01"), feat)
        elev = api.get(f"/v1/routes/{rid}/elevation", headers=h).json()
        elev["profile"] = shorten(elev["profile"])
        elev["points"] = shorten(elev["points"])
        elev["km_marks"] = shorten(elev["km_marks"])
        write("elevation_A01", "A01's recommended route: elevation profile",
              note("A01").replace("Geometry shortened", "Profile, points and km marks shortened"), elev)
        saved = api.post(f"/v1/routes/{rid}/save", json={"name": "Coast to Kozhikode"}, headers=h).json()
        write("saved_A01", "Saved, with its share link", note("A01"), saved)
        shared = api.get(f"/v1/share/{saved['share_slug']}").json()
        shared["route"]["geometry"]["coordinates"] = shorten(shared["route"]["geometry"]["coordinates"])
        write("share_A01", "A shared route (public)", note("A01"), shared)

        places = api.get("/v1/places/search", params={"q": "Kunnamangalam", "lat": 11.25, "lon": 75.78}, headers=h)
        places.raise_for_status()
        p = places.json()
        p["candidates"] = p["candidates"][:3]
        write("places_kunnamangalam", "A name in two areas: shown in a picker",
              f"Real Photon output through the API on {TODAY}; candidates shortened to the first 3.", p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
