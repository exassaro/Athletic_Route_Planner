# Athlete Router

A running route planner: distance-budgeted, direction-aware routes with mandatory checkpoints. `docs/blueprint.md` is the source of truth for architecture and algorithm decisions. Read it before making design choices.

## Working rules

- **Blueprint first.** If you disagree with something in the blueprint, say why and wait. Do not quietly do something else.
- **Phase by phase**, following blueprint section 15. Current phase: **Phase 2** (geospatial data and routing engine experiments). No FastAPI, no frontend, no LLM, no solver yet.
- **Plan first.** Give a plan and wait for approval before writing code.
- **Small steps.** Each step ends in something the developer can run and check. Commit after each step.
- **No invented distances.** Never hardcode or estimate a distance. Every distance comes from the routing engine or from measuring geometry (`athlete_engine.geodesy`). The leg distances in the blueprint's section 8 worked example are made up: never use them as test expectations. Straight-line distance is allowed only for snap distances and pre-filters and must never be presented as a route distance.
- **Coordinates come from data.** Place coordinates are read from OSM (with their OSM ids) or supplied by the developer, not typed from memory.
- Reports state where numbers were measured (this laptop, not the target server).

## Developer and machine

Solo developer, comfortable with Python and Next.js. Windows 11, 8 GB RAM, Intel i5 10th gen, Docker Desktop (WSL2, about 4 GB available to containers). Keep memory in mind: do not run the Valhalla tile build and Photon at the same time. Test region: Kozhikode, Kerala.

## Stack (Phase 2)

- Routing engine: Valhalla in Docker (`ghcr.io/valhalla/valhalla-scripted`), pedestrian costing, elevation tiles.
- Data: Kerala OSM extract from download.openstreetmap.fr, pinned in `data/manifest.json`.
- Geocoder: Photon with the prebuilt India index (Compose profile `geocode`).
- Python 3.12 managed by uv: httpx, pyproj, shapely, osmium (pyosmium), pytest.
- Later phases (not yet): FastAPI, PostgreSQL/PostGIS, Redis, Next.js, MapLibre.

## Layout

- `engine/athlete_engine/` Python package: engine client, polyline codec, geodesic measurement. Coordinates are `(lon, lat)` everywhere.
- `engine/scripts/` data fetch and fixture scripts. `engine/experiments/` numbered Phase 2 experiments.
- `engine/valhalla/`, `engine/photon/` container configuration.
- `docs/reports/phase2/` generated reports and GeoJSON.
- `tests/unit/` no network. `tests/integration/` needs Valhalla running. `tests/fixtures/` coordinates with OSM ids.
- `data/` is gitignored (extract, tiles, index).
- `solver/`, `api/`, `web/` are placeholders for later phases.

## Commands

```
uv sync                                  # create .venv and install dependencies
uv run pytest tests/unit                 # unit tests, no services needed
uv run pytest -m integration             # needs Valhalla on localhost:8002
uv run python engine/scripts/<name>.py   # data scripts
uv run python engine/experiments/<name>.py
```

Commands for Docker services are added to this file as each step introduces them.
