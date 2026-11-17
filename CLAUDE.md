# Athlete Router

A running route planner: distance-budgeted, direction-aware routes with mandatory checkpoints. `docs/blueprint.md` is the source of truth for architecture and algorithm decisions. Read it before making design choices.

## Working rules

- **Blueprint first.** If you disagree with something in the blueprint, say why and wait. Do not quietly do something else.
- **Phase by phase**, following blueprint section 15. Current phase: **Phase 3b** (routing-rule changes from the product owner, still solver only, in `solver/`). No FastAPI, no frontend, no LLM. First a rules spike (`docs/reports/phase3b/rules_spike.md`, at most 2 days), then wait for the developer's decision before changing the solver. Loops only after the point-to-point KPIs pass under the Phase 3 amendments.
- **Plan first.** Give a plan and wait for approval before writing code.
- **Small steps.** Each step ends in something the developer can run and check. Commit after each step.
- **No invented distances.** Never hardcode or estimate a distance. Every distance comes from the routing engine or from measuring geometry (`athlete_engine.geodesy`). The leg distances in the blueprint's section 8 worked example are made up: never use them as test expectations. Straight-line distance is allowed only for snap distances and pre-filters and must never be presented as a route distance.
- **Coordinates come from data.** Place coordinates are read from OSM (with their OSM ids) or supplied by the developer, not typed from memory.
- Reports state where numbers were measured (this laptop, not the target server).

## Phase 3 amendments (2026-11-17, full text at the top of docs/blueprint.md; they win over Phase 2)

1. **Generator: GraphHopper foot + custom model** ("recommended"). **Valhalla is the single yardstick**: road classes, checkpoint checks and the access check (map_snap coverage + OSM tags) go through Valhalla matching; lengths come from geometry.
2. **Road priority (preference, not a hard rule):** ordinary drivable roads (incl. service roads beside highways) > primary (mild penalty) > trunk/motorway (last) > footway/path/track/steps (only when nothing else connects, or `paths: "allow"`). One-way ignored. Trunk/motorway use → flag "uses a national highway; running there may be prohibited" (name from `ref`). `foot=no` is a hard exclusion; motorways stay unwalkable unless tagged `foot=yes`.
3. **Checkpoints are "pass near" by default.** The route passes within 1 km of the place point, measured as straight-line proximity to the Valhalla-matched route, with no spur (dead-end excursion > 100 m). Fallback: inside the place's OSM boundary, flagged. `must_reach` keeps the old `break` behaviour (50 m of the snapped point). Bridge and named-road checkpoints mean the route uses them (same as `must_use`).
4. **Ferries always excluded.** No opt-in, no ferry fixtures.
5. **Tolerance ±500 m** (replaces 2%). Distance-accuracy KPI unchanged.
6. **`over_budget` outcome** when the stops alone exceed D + 500 m: the full route (ends at the last stop), the overshoot in metres, a "cut at target" candidate, and the savings list. Disconnected and snap-too-far stay conflicts.
7. **Request fields `via`, `avoid`, `must_use`.** A `via` is shaping only: never dropped, not a listed stop. Edits hold the distance by moving the endpoint.
8. **Repetition limit applies beyond what `must_reach` stops force. Consistency check: 0.1% / 2 m plus 0.2 m per edge.**
9. **Alternatives: "recommended" (GraphHopper, rules above) and "shortest" (Valhalla pedestrian).** "Fewer main roads" is dropped.

After the rules spike (`docs/reports/phase3b/rules_spike.md`, accepted 2026-11-17):

10. **Model R5**: primary ×0.6, trunk/motorway ×0.1, paths ×0.1 (1.0 with `paths: "allow"`), on GraphHopper profile `foot_rules`.
11. **Pass-near = walking distance ≤ 1 km** (Valhalla matrix to sample points every 100 m on the route); straight-line only as a pre-filter.
12. **NH flag at ≥ 200 m of trunk/motorway in one stretch**; shorter = "crosses a national highway" note.
13. **Order on the Valhalla matrix.** 14. **One request per run** (GraphHopper relaxes `pass_through` at dead ends).
15. **Consistency check uses the engine's own radius** (GraphHopper 6,371,000 m) plus 0.2 m per edge.
16. **Boundary fallback** when a checkpoint carries its OSM boundary; otherwise least-added candidate with a spur, flagged.
17. **Junction** = through via at the junction; **bridge / named road / must_use** = route uses one of the item's OSM ways.

Acceptance test: Athanikkal towards Kozhikode, 25 km, passing near Kottakadavu, Kadalundi, Chaliyam, Karuvanthuruthy bridge, Beypore and Kallayi. It must follow that order, take no spur into Chaliyam's beach end, use no ferry, and repeat under 2% of its road. Report the measured length; if it is over 25 km, show `over_budget`. Names come from OSM or Photon. If one can't be found, stop and ask. Plus 10 fixtures outside Kozhikode (Kochi, Thiruvananthapuram, Thrissur, Kannur, Wayanad).

## Decisions from Phase 2 (also in docs/blueprint.md; amended above where they conflict)

1. **Ferries are hard-excluded** with `exclude_ferries: true`. Never rely on `use_ferry: 0`. (Phase 3 amendment 4 removed the opt-in.)
2. **Every distance shown and every cut uses ellipsoid geometry length.** The engine consistency check compares engine length with a spherical measurement of the same geometry: threshold 0.1%, floor 2 m.
3. ~~MVP alternatives "direct" and "fewer main roads"~~: replaced by Phase 3 amendment 9.
4. **Geocoding is Latin script only** for the MVP.
5. **`must_reach` checkpoints are `break` locations**; `through` is for shaping vias and pass-near points. `must_reach` compliance is measured against the snapped point.
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
- `tests/fixtures/scenarios/` solver scenarios (section 16); `docs/reports/phase3/` Phase 3 KPI report and the quieter spike; `docs/reports/phase3b/` Phase 3b KPI report and the rules spike.
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
uv run python tests/kpi/run_kpi.py [--only S05,S15]   # -> docs/reports/phase3b/kpi.md, exit 0 only if every KPI passes
```

Scenario requests live in `tests/fixtures/scenarios/base.json`. Never edit `scenarios.json` by hand: its reference values come from `tests/kpi/reference.py` (every stop order routed and measured, no matrix, no DP), kept independent of the solver.

GraphHopper (profile `spike`, http://localhost:8989; the Phase 3b generator, still started with the spike profile until it is wired into the solver). It runs alongside Valhalla (about 1.9 GiB), so stop Photon first:

```
docker compose --profile spike up -d graphhopper   # imports the pinned extract, about 3 min, about 2 GB RAM
uv run python engine/experiments/07_quieter_spike.py
uv run python engine/scripts/build_rules_fixtures.py     # Phase 3b acceptance places by OSM id -> tests/fixtures/rules_places.json
uv run python engine/experiments/08a_road_priority.py    # Phase 3b: priority models (profile foot_rules) -> docs/reports/phase3b/
uv run python engine/experiments/08b_pass_near.py --model "R5 trunk-last" --proximity network   # pass-near prototype
docker compose --profile spike stop graphhopper
```

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
- **`edge_walk` is not an access check**: pedestrian `edge_walk` accepts a bicycle route over a `foot=no` bridge, and fails on some unmodified pedestrian routes. Judge pedestrian access by `map_snap` coverage plus OSM tags (`athlete_engine.osm.is_walkable`).
- Valhalla stores edge lengths in whole metres: routes with many short edges drift from the spherical measurement by about 0.1 m per edge.
- Isodistance contours are outlines: vertices are often far nearer by route than the contour value. Route and measure every sample.

## Phase 3b implementation (steps 3 to 9 of the plan)

Spike questions are settled by decisions 10 to 17 above. Order: (3) remove the ferry opt-in; (4) ±500 m tolerance, `over_budget`, repetition and consistency rules; (5) GraphHopper generator, "recommended" and "shortest", NH flag; (6) pass-near checkpoints; (7) `via`, `avoid`, `must_use`; (8) acceptance fixture and 10 fixtures outside Kozhikode; (9) report. Loops wait until the point-to-point KPIs pass.
