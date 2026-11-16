# Athlete Router

A running route planner that treats distance as the input: "25 km towards Kozhikode via three stops" returns a route of that length, or a clear reason why it cannot. The full design is in [docs/blueprint.md](docs/blueprint.md).

**Status:** Phase 2 of 8, routing engine experiments. There is no API or web app yet.

## Requirements

- Windows 10/11 (or Linux/macOS), 8 GB RAM, about 5 GB free disk
- [Docker Desktop](https://www.docker.com/products/docker-desktop/), running
- [uv](https://docs.astral.sh/uv/) (installs Python 3.12 for you)
- git

## Setup

```powershell
# 1. Install uv (once)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# 2. Install Python 3.12 and dependencies into .venv
uv sync

# 3. Run the unit tests (no services needed)
uv run pytest tests/unit
```

### Map data

```powershell
# 4. Download the Kerala OSM extract (about 180 MB) and verify its checksum
uv run python engine/scripts/fetch_extract.py
```

This writes `data/osm/kerala.osm.pbf` and `data/manifest.json`. The manifest's `osm_timestamp` identifies the data every later measurement was made on. Re-running skips the download when the local file still matches the published checksum; `--force` downloads again.

### Routing engine (Valhalla)

Start Docker Desktop first.

```powershell
# 5. Build the routing graph and start Valhalla on http://localhost:8002
#    First run downloads elevation tiles and builds tiles: about 7 minutes.
docker compose up -d valhalla
docker compose logs -f valhalla      # wait for "Tile extract successfully loaded", then Ctrl+C

# 6. Apply our config overrides (engine/valhalla/overrides.json), then restart
uv run python engine/scripts/configure_valhalla.py
docker compose restart valhalla

# 7. Read place coordinates from the extract into tests/fixtures/places.json
uv run python engine/scripts/build_fixtures.py

# 8. Check the engine is up and elevation is loaded
uv run python engine/experiments/00_engine_check.py
```

Later starts reuse the built tiles and take a few seconds. `docker compose down` stops the engine. To rebuild after downloading a newer extract, delete `data/valhalla/` and start again.

Steps for Photon are added here when that step lands.

## Repository layout

| Path | Contents |
| --- | --- |
| `engine/` | Routing engine containers, the `athlete_engine` Python package, data scripts and experiments |
| `solver/` | Route-generation library (Phase 3) |
| `api/` | FastAPI backend (Phase 4) |
| `web/` | Next.js front end (Phase 5) |
| `docs/` | Blueprint and generated reports |
| `tests/` | Unit tests, integration tests, fixtures |
| `data/` | Downloaded and built data, not in git |

## Ground rule

No distance in this project is hardcoded or estimated. Every distance comes from the routing engine or from measuring returned geometry on the WGS84 ellipsoid.

## Data and licence

Map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL).
