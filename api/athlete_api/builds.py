"""Build ids: what produced a result (Phase 4 amendments 5 and 14).

- Valhalla: version plus the tile set's modification time (`/status`).
- GraphHopper: version plus its import time (`/info`); `data_date` is the OSM extract it imported.
- OSM pin: the extract timestamp in data/manifest.json (what the solver reports as graph_build).
- Solver: a hash of the solver's and athlete_engine's source, so a code change invalidates the cache.
"""

import hashlib
import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import athlete_engine
import athlete_solver
import httpx


@lru_cache
def solver_hash() -> str:
    """sha256 over every .py file of athlete_solver and athlete_engine (path and content, newlines normalised)."""
    h = hashlib.sha256()
    for pkg in (athlete_solver, athlete_engine):
        base = Path(pkg.__file__).resolve().parent
        for path in sorted(base.rglob("*.py")):
            h.update(f"{pkg.__name__}/{path.relative_to(base).as_posix()}\n".encode())
            h.update(path.read_bytes().replace(b"\r\n", b"\n"))
    return h.hexdigest()[:16]


def osm_pin(manifest: Path) -> str:
    if manifest.exists():
        return json.loads(manifest.read_text(encoding="utf-8"))["extract"]["osm_timestamp"]
    return "unknown"


def valhalla_build(status: dict) -> str:
    stamp = status.get("tileset_last_modified")
    when = datetime.fromtimestamp(stamp, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if stamp else "unknown"
    return f"valhalla {status.get('version', 'unknown')} tiles {when}"


def graphhopper_build(info: dict) -> str:
    return f"graphhopper {info.get('version', 'unknown')} import {info.get('import_date', 'unknown')}"


async def fetch_valhalla_build(http: httpx.AsyncClient, base_url: str) -> str:
    resp = await http.get(f"{base_url}/status")
    resp.raise_for_status()
    return valhalla_build(resp.json())


async def fetch_graphhopper_info(http: httpx.AsyncClient, base_url: str) -> dict:
    resp = await http.get(f"{base_url}/info")
    resp.raise_for_status()
    return resp.json()
