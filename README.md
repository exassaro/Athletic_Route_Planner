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

### Experiments

Each script writes a report to `docs/reports/phase2/`. Valhalla must be running, except for the tag audit.

```powershell
uv run python engine/scripts/build_pairs.py              # fixed origin/destination pairs (already in git)
uv run python engine/experiments/01_primitives.py        # route with vias, matrix, isodistance, edge attributes
uv run python engine/experiments/02_length_check.py      # engine length vs geodesic geometry length
docker compose restart valhalla                          # optional: makes the next first call a cold call
uv run python engine/experiments/03_latency.py           # ~25 km route latency
uv run python engine/experiments/04_tag_coverage.py      # sidewalk/surface/lit, ferries, bridges (no engine needed)
uv run python engine/experiments/05_worked_example.py    # section 8 example under four ferry settings
uv run python engine/experiments/05b_quieter_probe.py    # do costing options change the road mix?

uv run pytest                                            # unit + integration (integration skips if Valhalla is down)
```

The `.geojson` files in `docs/reports/phase2/` can be dragged into QGIS or geojson.io.

### Geocoder (Photon)

Photon runs from a prebuilt India index (about 610 MB download). It is under a Compose profile so it only starts when asked.

```powershell
uv run python engine/scripts/fetch_photon.py             # download, verify, unpack to data/photon/photon_data
docker compose --profile geocode up -d photon            # http://localhost:2322 (first start takes a minute)
uv run python engine/experiments/06_photon_smoke.py
docker compose --profile geocode stop photon
```

## Phase 2 results

Start with [docs/reports/phase2/summary.md](docs/reports/phase2/summary.md).

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
