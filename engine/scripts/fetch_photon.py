"""Download and unpack the prebuilt Photon index for India.

Usage:  uv run python engine/scripts/fetch_photon.py [--force]

The index is built by GraphHopper from OSM (about 610 MB compressed). It is not
built from our Kerala extract, so its OSM date differs from the routing graph;
both dates are recorded in data/manifest.json.
Unpacks to data/photon/photon_data.
"""

import argparse
import hashlib
import json
import shutil
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path

import httpx

URL = "https://download1.graphhopper.com/public/asia/india/photon-db-india-1.0-latest.tar.bz2"

ROOT = Path(__file__).resolve().parents[2]
PHOTON_DIR = ROOT / "data" / "photon"
ARCHIVE = PHOTON_DIR / "photon-db-india.tar.bz2"
DATA_DIR = PHOTON_DIR / "photon_data"
MANIFEST = ROOT / "data" / "manifest.json"
HEADERS = {"User-Agent": "athlete-router-dev/0.1 (phase 2 experiments)"}


def md5_of(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="download and unpack again")
    args = parser.parse_args()
    PHOTON_DIR.mkdir(parents=True, exist_ok=True)

    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=120) as client:
        expected_md5 = client.get(f"{URL}.md5").raise_for_status().text.split()[0]
        have = ARCHIVE.exists() and not args.force and md5_of(ARCHIVE) == expected_md5
        last_modified = None
        if have:
            print("Archive already downloaded and matches the published md5.")
        else:
            print(f"Downloading {URL}")
            part = ARCHIVE.with_suffix(".part")
            with client.stream("GET", URL) as resp:
                resp.raise_for_status()
                last_modified = resp.headers.get("last-modified")
                total = int(resp.headers.get("content-length", 0))
                done = next_report = 0
                with part.open("wb") as fh:
                    for chunk in resp.iter_bytes(1 << 20):
                        fh.write(chunk)
                        done += len(chunk)
                        if total and done >= next_report:
                            print(f"  {done / 1e6:7.1f} / {total / 1e6:.1f} MB", flush=True)
                            next_report += total // 10
            part.replace(ARCHIVE)

    actual_md5 = md5_of(ARCHIVE)
    if actual_md5 != expected_md5:
        print(f"MD5 MISMATCH: expected {expected_md5}, got {actual_md5}", file=sys.stderr)
        return 1

    if DATA_DIR.exists() and (args.force or not have):
        shutil.rmtree(DATA_DIR)   # never unpack over an old index (Photon README)
    if not DATA_DIR.exists():
        print("Unpacking (a few minutes)...", flush=True)
        with tarfile.open(ARCHIVE, "r:bz2") as tar:
            tar.extractall(PHOTON_DIR, filter="data")
    if not DATA_DIR.exists():
        print("Archive did not contain a photon_data directory.", file=sys.stderr)
        return 1

    size = sum(f.stat().st_size for f in DATA_DIR.rglob("*") if f.is_file())
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    previous = manifest.get("photon", {})
    manifest["photon"] = {
        "url": URL, "md5": actual_md5, "archive_bytes": ARCHIVE.stat().st_size,
        "archive_last_modified": last_modified or previous.get("archive_last_modified"),
        "unpacked_bytes": size,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"MD5:      {actual_md5}  OK (matches published)")
    print(f"Index:    {DATA_DIR.relative_to(ROOT).as_posix()}  ({size / 1e6:.0f} MB unpacked)")
    print(f"Built:    {manifest['photon']['archive_last_modified']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
