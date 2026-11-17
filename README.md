# Athlete Router

A running route planner that treats distance as the input: "25 km towards Kozhikode via three stops" returns a route of that length, or a clear reason why it cannot. The full design is in [docs/blueprint.md](docs/blueprint.md).

**Status:** Phase 3b of 8, routing-rule changes to the route-generation solver (library and command line). The decisions are under "Phase 3 amendments" at the top of [docs/blueprint.md](docs/blueprint.md). There is no API or web app yet.

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
# 4. Get the pinned Kerala OSM extract (about 180 MB) from the project's GitHub release
uv run python engine/scripts/fetch_extract.py --from-backup
```

All measurements and test fixtures are tied to one OSM snapshot, named in [engine/osm_pin.json](engine/osm_pin.json) (Kerala, 2026-11-15). The upstream site overwrites its file daily, so the pinned copy lives in the GitHub release `osm-kerala-2026-11-15`. The script writes `data/osm/kerala.osm.pbf` and `data/manifest.json`, and verifies the checksum against the pin. Run without flags to just verify a local file. `--latest` deliberately moves to today's upstream data; fixtures must then be regenerated.

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

### Solver (Phase 3)

Valhalla must be running.

```powershell
uv run python -m athlete_solver solve request.json --geojson route.geojson   # one RouteRequest -> SolveResult JSON
uv run python tests/kpi/run_kpi.py                                           # all scenarios -> docs/reports/phase3/kpi.md
uv run python tests/kpi/run_kpi.py --only S05,S15                            # a subset
```

A request follows blueprint section 4, with coordinates on every point; `tests/fixtures/scenarios/scenarios.json` has 60 examples.

### Pinned extract backup

The pinned extract is a public asset of the GitHub release `osm-kerala-2026-11-15`. It was uploaded and restored with `--from-backup` on 2026-11-17, and the MD5 matched the pin. When the pin moves to a new extract, upload the new file the same way. In the browser: on the repository, open *Releases*, then *Draft a new release*, and attach `data/osm/kerala.osm.pbf`. Or with the GitHub CLI (`winget install --id GitHub.cli --source winget`, open a new terminal, then `gh auth login`):

```powershell
gh release create osm-kerala-2026-11-15 data/osm/kerala.osm.pbf --title "Pinned OSM extract: Kerala 2026-11-15" --notes "MD5 2d7b79f8c963d2a0b8304f1a732ba646, OSM timestamp 2026-11-15T00:15:25Z. Map data (c) OpenStreetMap contributors, ODbL."
```

### Quieter-route spike (Phase 3, optional)

```powershell
docker compose --profile spike up -d graphhopper      # imports Kerala, about 3 minutes, about 2 GB RAM
uv run python engine/experiments/07_quieter_spike.py
docker compose --profile spike stop graphhopper
```

## Phase 3 status

Start with [docs/reports/phase3/summary.md](docs/reports/phase3/summary.md).

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
