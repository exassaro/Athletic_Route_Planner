"""Fetch the self-hosted basemap (blueprint Phase 5 amendments 3 and 12) as engine/basemap_pin.json names it.

Usage:  uv run python engine/scripts/fetch_basemap.py

1. The pmtiles CLI (pinned version, checked by sha256) into data/tools/.
2. `pmtiles extract` of the Protomaps build of the pin's day for the pinned bounding box into data/basemap/,
   checked by size and sha256 (fails loudly if the source changed).
3. Fonts and sprites from protomaps/basemaps-assets at the pinned commit (sparse clone) into data/basemap/assets.
4. Copies all of it into web/public/basemap/ (gitignored), where the Next.js server and Caddy serve it.
No API key, no per-load fee; OSM attribution comes with the style.

The Protomaps daily build is deleted upstream after a few days (20261115 answered 404 on 2026-11-24). Then copy
data/basemap/<pin file> from a machine that has it (deploy/RUNBOOK.md); the script checks it against the pin and
skips the extract.
"""

import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PIN = json.loads((ROOT / "engine" / "basemap_pin.json").read_text(encoding="utf-8"))
DATA = ROOT / "data" / "basemap"
PUBLIC = ROOT / "web" / "public" / "basemap"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cli() -> Path:
    """The pinned pmtiles CLI for this platform (Windows on the laptop, Linux on the VM), checked by sha256."""
    c = PIN["pmtiles_cli"]
    linux = sys.platform.startswith("linux")
    url, digest = (c["linux_url"], c["linux_sha256"]) if linux else (c["url"], c["sha256"])
    folder = ROOT / "data" / "tools" / f"pmtiles-{c['version']}"
    exe = folder / "bin" / ("pmtiles" if linux else "pmtiles.exe")
    if exe.exists():
        return exe
    folder.mkdir(parents=True, exist_ok=True)
    archive = folder / Path(url).name
    urllib.request.urlretrieve(url, archive)
    if sha256(archive) != digest:
        sys.exit(f"{archive} does not match the pinned sha256")
    if linux:
        with tarfile.open(archive) as t:
            t.extractall(folder / "bin", filter="data")
        exe.chmod(0o755)
    else:
        with zipfile.ZipFile(archive) as z:
            z.extractall(folder / "bin")
    return exe


def tiles() -> Path:
    out = DATA / PIN["file"]
    if not (out.exists() and out.stat().st_size == PIN["size_bytes"] and sha256(out) == PIN["sha256"]):
        DATA.mkdir(parents=True, exist_ok=True)
        exe = cli()   # only when the extract must be made: a copied file that matches the pin needs no CLI
        bbox = ",".join(str(x) for x in PIN["bbox"])
        subprocess.run([str(exe), "extract", PIN["source_url"], str(out), f"--bbox={bbox}"], check=True)
        if out.stat().st_size != PIN["size_bytes"] or sha256(out) != PIN["sha256"]:
            sys.exit(f"{out} differs from the pin (size {out.stat().st_size}, sha256 {sha256(out)}): the source "
                     "build changed or is gone. Do not update the pin silently.")
    return out


def assets() -> Path:
    a = PIN["assets"]
    src = DATA / "assets-src"
    if not (src / ".git").exists():
        subprocess.run(["git", "clone", "-q", "--filter=blob:none", "--sparse", "--no-checkout", a["repo"], str(src)],
                       check=True)
    subprocess.run(["git", "-C", str(src), "sparse-checkout", "set", *a["paths"]], check=True)
    subprocess.run(["git", "-C", str(src), "fetch", "-q", "--depth", "1", "origin", a["commit"]], check=True)
    subprocess.run(["git", "-C", str(src), "checkout", "-q", a["commit"]], check=True)
    return src


def main() -> int:
    pm = tiles()
    src = assets()
    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    (PUBLIC / "fonts").mkdir(parents=True)
    try:
        (PUBLIC / "kerala.pmtiles").hardlink_to(pm)        # same disk: no second 226 MB copy
    except OSError:
        shutil.copy2(pm, PUBLIC / "kerala.pmtiles")
    shutil.copytree(src / "sprites" / "v4", PUBLIC / "sprites")
    for p in PIN["assets"]["paths"]:
        if p.startswith("fonts/"):
            shutil.copytree(src / p, PUBLIC / p)
    (PUBLIC / "pin.json").write_text(json.dumps({k: PIN[k] for k in ("build", "osm_replication_time", "sha256")}),
                                     encoding="utf-8")
    print(f"Basemap {PIN['build']} ({pm.stat().st_size // 1_000_000} MB) and assets -> {PUBLIC.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
