"""Download the Kerala OSM extract, verify it, and pin it in data/manifest.json.

Usage:  uv run python engine/scripts/fetch_extract.py [--force]

The manifest's `osm_timestamp` is the graph build id used by later steps, so
every measured number can be traced to the data it was measured on.
"""

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
import osmium

BASE_URL = "https://download.openstreetmap.fr/extracts/asia/india"
NAME = "kerala"

ROOT = Path(__file__).resolve().parents[2]
OSM_DIR = ROOT / "data" / "osm"
PBF = OSM_DIR / f"{NAME}.osm.pbf"
MANIFEST = ROOT / "data" / "manifest.json"
HEADERS = {"User-Agent": "athlete-router-dev/0.1 (phase 2 experiments)"}


def md5_of(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(client: httpx.Client, url: str, dest: Path) -> None:
    part = dest.with_suffix(dest.suffix + ".part")
    with client.stream("GET", url) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        done = 0
        next_report = 0
        with part.open("wb") as fh:
            for chunk in resp.iter_bytes(1 << 20):
                fh.write(chunk)
                done += len(chunk)
                if total and done >= next_report:
                    print(f"  {done / 1e6:7.1f} / {total / 1e6:.1f} MB", flush=True)
                    next_report += total // 10
    part.replace(dest)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="download even if a verified file exists")
    args = parser.parse_args()

    OSM_DIR.mkdir(parents=True, exist_ok=True)
    pbf_url = f"{BASE_URL}/{NAME}.osm.pbf"

    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=60) as client:
        expected_md5 = client.get(f"{pbf_url}.md5").raise_for_status().text.split()[0]
        state_txt = client.get(f"{BASE_URL}/{NAME}.state.txt").raise_for_status().text

        if PBF.exists() and not args.force and md5_of(PBF) == expected_md5:
            print(f"Already have {PBF.name} matching the published md5; not downloading.")
        else:
            print(f"Downloading {pbf_url}")
            download(client, pbf_url, PBF)

    actual_md5 = md5_of(PBF)
    if actual_md5 != expected_md5:
        print(f"MD5 MISMATCH: expected {expected_md5}, got {actual_md5}", file=sys.stderr)
        return 1

    reader = osmium.io.Reader(str(PBF))
    header = reader.header()
    box = header.box()
    osm_timestamp = header.get("osmosis_replication_timestamp") or header.get("timestamp")
    reader.close()

    manifest = {
        "extract": {
            "name": NAME,
            "url": pbf_url,
            "file": str(PBF.relative_to(ROOT).as_posix()),
            "size_bytes": PBF.stat().st_size,
            "md5": actual_md5,
            "osm_timestamp": osm_timestamp,
            "bbox": {
                "min_lon": box.bottom_left.lon,
                "min_lat": box.bottom_left.lat,
                "max_lon": box.top_right.lon,
                "max_lat": box.top_right.lat,
            } if box.valid() else None,
            "state_txt": state_txt,
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    }
    existing = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    existing.update(manifest)
    MANIFEST.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")

    e = manifest["extract"]
    print(f"File:          {e['file']}")
    print(f"Size:          {e['size_bytes'] / 1e6:.1f} MB")
    print(f"MD5:           {e['md5']}  OK (matches published)")
    print(f"OSM timestamp: {e['osm_timestamp']}")
    print(f"Bbox:          {e['bbox'] or 'not present in the file header (polygon extract)'}")
    print(f"Manifest:      {MANIFEST.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
