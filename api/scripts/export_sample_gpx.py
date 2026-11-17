"""Export sample GPX courses through the running API, for the manual Garmin Connect / Strava import check.

Usage:  uv run python api/scripts/export_sample_gpx.py [--api http://localhost:8000]

Creates plans for A01 (point to point) and S02 (a loop), saves the first candidate of each, downloads its GPX
and validates it against the GPX 1.1 schema. Writes docs/reports/phase4/gpx/<fixture>_<label>.gpx.
"""

import argparse
import json
import sys
from pathlib import Path

import httpx
from lxml import etree

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "reports" / "phase4" / "gpx"
XSD = etree.XMLSchema(etree.parse(str(ROOT / "tests" / "fixtures" / "gpx" / "gpx.xsd")))
SAMPLES = {"A01": "Athanikkal towards Kozhikode, six stops", "S02": "Loop from Mananchira"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8000")
    args = parser.parse_args()
    fixtures = {f["id"]: f for f in json.loads((ROOT / "tests/fixtures/scenarios/scenarios.json")
                                               .read_text(encoding="utf-8"))["fixtures"]}
    OUT.mkdir(parents=True, exist_ok=True)
    with httpx.Client(base_url=args.api, timeout=60) as http:
        h = {"X-Client-Token": http.post("/v1/session").json()["token"]}
        for fid, title in SAMPLES.items():
            plan = http.post("/v1/plans", json={"request": fixtures[fid]["request"]}, headers=h)
            plan.raise_for_status()
            cand = plan.json()["candidates"][0]
            http.post(f"/v1/routes/{cand['route_id']}/save", json={"name": f"{fid}: {title}"}, headers=h).raise_for_status()
            resp = http.get(f"/v1/routes/{cand['route_id']}/gpx", headers=h)
            resp.raise_for_status()
            XSD.assertValid(etree.fromstring(resp.content))
            path = OUT / f"{fid}_{cand['label']}.gpx"
            path.write_bytes(resp.content)
            doc = etree.fromstring(resp.content)
            n_pts = len(doc.findall(".//{*}trkpt"))
            eles = [float(e.text) for e in doc.findall(".//{*}trkpt/{*}ele")]
            print(f"{path.relative_to(ROOT)}: {cand['label']}/{cand['option']} {cand['foot_m']:.1f} m, "
                  f"{n_pts} track points, {len(doc.findall('{*}wpt'))} waypoints, "
                  f"heights {min(eles):.0f} to {max(eles):.0f} m, valid GPX 1.1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
