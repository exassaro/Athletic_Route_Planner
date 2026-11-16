# Athlete Router

A running route planner: distance-budgeted, direction-aware routes with mandatory checkpoints. `docs/blueprint.md` is the source of truth for architecture and algorithm decisions. Read it before making design choices.

## Working rules

- **Blueprint first.** If you disagree with something in the blueprint, say why and wait. Do not quietly do something else.
- **Phase by phase**, following blueprint section 15. Current phase: **Phase 3** (core route-generation solver as a pure Python library in `solver/` with a command-line runner). No FastAPI, no frontend, no LLM. Loops only after point-to-point, Case B, bearing-only, out-and-back and scoring meet their KPIs.
- **Plan first.** Give a plan and wait for approval before writing code.
- **Small steps.** Each step ends in something the developer can run and check. Commit after each step.
- **No invented distances.** Never hardcode or estimate a distance. Every distance comes from the routing engine or from measuring geometry (`athlete_engine.geodesy`). The leg distances in the blueprint's section 8 worked example are made up: never use them as test expectations. Straight-line distance is allowed only for snap distances and pre-filters and must never be presented as a route distance.
- **Coordinates come from data.** Place coordinates are read from OSM (with their OSM ids) or supplied by the developer, not typed from memory.
- Reports state where numbers were measured (this laptop, not the target server).

## Decisions from Phase 2 (also at the top of docs/blueprint.md)

1. **Ferries are hard-excluded by default** with `exclude_ferries: true`. Never rely on `use_ferry: 0`. Ferries are opt-in. When allowed, ferry metres are reported separately and do not count toward the distance budget: **the budget is distance on foot.**
2. **Every distance shown and every cut uses ellipsoid geometry length.** The engine consistency check compares engine length with a spherical measurement of the same geometry: threshold 0.1%, floor 2 m.
3. **MVP alternatives: "direct" and "fewer main roads".** The second waits for the quieter spike (`docs/reports/phase3/quieter_spike.md`) and the developer's decision.
4. **Geocoding is Latin script only** for the MVP.
5. **Checkpoints are `break` locations**; `through` is only for shaping vias. Checkpoint compliance is measured against the snapped point.
6. **Engine warnings** (e.g. code 401, relaxed restrictions) are carried into results as flags.

Also agreed: conflict savings are routed and measured, not matrix sums; ordering by exact DP (no OR-Tools); cut snaps to a junction only within 0.5% of the target; every truncated candidate is re-routed as one engine request; via-point lengthening (section 8 step 10) comes after the point-to-point KPIs, before loops.

## Pinned graph

`engine/osm_pin.json` names the extract every fixture was measured on (Kerala, 2026-11-15). The upstream file changes daily. Expected values in fixtures come from running the engine on this pin, and the KPI harness refuses to run if `data/manifest.json` has a different timestamp. Backup: GitHub release `osm-kerala-2026-11-15` (restore with `fetch_extract.py --from-backup`).

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
- `solver/athlete_solver/` Phase 3 solver package (models, engine adapter, ordering, gate, truncation, scoring) with a CLI (`python -m athlete_solver`). It calls the engine only through `athlete_engine`.
- `tests/fixtures/scenarios/` solver scenarios (section 16); `docs/reports/phase3/` KPI report and the quieter spike.
- `api/`, `web/` are placeholders for later phases.

## Commands

```
uv sync                                  # create .venv and install dependencies
uv run pytest tests/unit                 # unit tests, no services needed
uv run pytest -m integration             # needs Valhalla on localhost:8002
uv run python engine/scripts/fetch_extract.py   # verify local extract against engine/osm_pin.json, write data/manifest.json
uv run python engine/scripts/fetch_extract.py --from-backup   # restore the pinned extract from the GitHub release
uv run python engine/scripts/<name>.py   # other data scripts
uv run python engine/experiments/<name>.py
```

Valhalla (Docker Desktop must be running; serves on http://localhost:8002):

```
docker compose up -d valhalla            # first run builds tiles + elevation, about 7 min
docker compose logs -f valhalla
uv run python engine/scripts/configure_valhalla.py   # apply engine/valhalla/overrides.json
docker compose restart valhalla          # needed after changing overrides
docker compose down
uv run python engine/scripts/build_fixtures.py       # place nodes -> tests/fixtures/places.json
uv run python engine/experiments/00_engine_check.py  # version + elevation sanity check
```

Experiments (reports go to `docs/reports/phase2/`):

```
uv run python engine/scripts/build_pairs.py             # regenerate tests/fixtures/od_pairs.json (seeded)
uv run python engine/experiments/01_primitives.py
uv run python engine/experiments/02_length_check.py
uv run python engine/experiments/03_latency.py          # restart valhalla first for a true cold call
uv run python engine/experiments/04_tag_coverage.py     # no engine needed
uv run python engine/experiments/05_worked_example.py
uv run python engine/experiments/05b_quieter_probe.py
```

Solver and KPI harness (Phase 3; Valhalla must be running):

```
uv run python -m athlete_solver solve request.json [--geojson out.geojson]
uv run python tests/kpi/build_scenarios.py   # fixtures + brute-force reference values -> tests/fixtures/scenarios/scenarios.json
uv run python tests/kpi/run_kpi.py [--only S05,S15]   # -> docs/reports/phase3/kpi.md, exit 0 only if every KPI passes
```

Scenario requests live in `tests/fixtures/scenarios/base.json`. Never edit `scenarios.json` by hand: its reference values come from `tests/kpi/reference.py` (every stop order routed and measured, no matrix, no DP), kept independent of the solver.

Photon (profile `geocode`, http://localhost:2322):

```
uv run python engine/scripts/fetch_photon.py
docker compose --profile geocode up -d photon
uv run python engine/experiments/06_photon_smoke.py
docker compose --profile geocode stop photon
```

`data/valhalla/valhalla.json` is generated by the container. Never edit it by hand; change `engine/valhalla/overrides.json` and re-run the configure script. To rebuild the graph, delete `data/valhalla/`.

## Engine facts measured in Phase 2 (see docs/reports/phase2/summary.md)

- **Lengths shown to users come from geometry, not the engine summary.** Valhalla measures on a sphere; at this latitude its lengths run 0.1 to 0.5% above the WGS84 geodesic length of the same shape, more for north-south routes. Use `geodesy.line_length_m(route_shape(resp))`.
- **Exclude ferries with `exclude_ferries: true`, never with `use_ferry: 0` alone.** `use_ferry: 0` still routes over a ferry when combined with `shortest` or `use_lit`. Hard exclusions need `service_limits.allow_hard_exclusions` (set in `engine/valhalla/overrides.json`). Verify with `trace_attributes` (`edge.use == "ferry"`).
- Valhalla's default pedestrian costing (`use_ferry: 0.5`) takes the Chaliyam–Beypore ferry.
- Pedestrian costing has no option that penalises trunk or primary roads.
- OSM place nodes are not on roads (snap offsets of 2 to 54 m seen). Measure checkpoint compliance against the snapped point.
- Polyline shapes are precision 6. Edge attributes for a route shape: `trace_attributes` with `shape_match: edge_walk`.
