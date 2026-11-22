# api

The Phase 4 backend: FastAPI over the solver (blueprint Phase 4 amendments, sections 11 and 12).

- `athlete_api/` the app:
  - `config` (settings), `db` (tables), `store` (Candidate <-> routes row), `schemas` (response models wrapping
    the solver's), `deps` (services, client token, rate limits), `ratelimit`, `builds` (engine build ids, solver
    hash), `errors`;
  - `solving` (solve slots, worker thread, shared in-flight solves), `elevation` (Valhalla /height for Z and the
    profile), `cache` (Redis, 24 h), `planning` (build ids -> cache -> solve -> store a version; 429/504),
    `overview` (A14's algorithm, pure), `overviewing` (its cache and errors),
    `follow` (A15's cue rule, pure), `following` (its cache and fallback), `engine_work` (their worker threads),
    `diff` (version diff), `explain` (template explanations, numbers only from the SolveResult);
  - `routes_*` (endpoints; `routes_saved` manages saved routes, Phase 5c), `purge_deleted` (CLI: removes saved routes soft-deleted more than N days ago), `main` (app factory; `create_app(solver=...)` takes a fake solver in tests).
- `alembic/` migrations (the schema's authority): `uv run alembic -c api/alembic.ini upgrade head`.
- `athlete_api/examples/` OpenAPI examples, generated from real solver output by `scripts/build_examples.py`.
- `scripts/` `measure_memory.py`, `export_sample_gpx.py`, `record_photon_fixtures.py`, `build_examples.py`.

Run: `uv run uvicorn athlete_api.main:app --port 8000`, docs at http://localhost:8000/docs.

Phase 5 changes (blueprint Phase 5 amendment 7):
- **CORS (A1):** `ATHLETE_CORS_ORIGINS`, comma-separated, default `http://localhost:3000,http://127.0.0.1:3000` (the `next dev` server). Allowed headers: `Content-Type`, `X-Client-Token`, `If-Match`; exposed: `Retry-After`, `Content-Disposition`, `Location`. Set it to an empty string to turn CORS off (one origin behind Caddy).
- **GPX (A2):** a loop's or out-and-back's end waypoint is "<start> finish"; `?ele=false` on both GPX endpoints leaves out `<ele>`.
- **Typed diff (A3):** `PlanVersionOut.diff` is `DiffOut` (same JSON as before).
- **Fix patches (A4, `fixes.py`):** every `conflict.fixes[]` and `conflict.savings[]` carries `patch`, the RFC 6902 operations a one-tap button sends to `PATCH /v1/plans/{id}` unchanged. Dropping a checkpoint is `test` its label + `remove`, so a stale button gets 409 instead of dropping another stop. `null` when the label matches no checkpoint or several, and always for `make_optional` (the solver does not read `Checkpoint.mandatory`; optional stops are Phase 7).
- **Positions along the route (A5):** `GET /v1/routes/{id}/elevation` adds `points` (the [lon, lat] of each 30 m profile sample) and `km_marks` (every whole km), from `geodesy.sample_every` on the stored geometry; checked against the stored profile distances (500 `profile_mismatch` otherwise; 0 of 2,088 stored routes on 2026-11-18).
- `scripts/measure_climb.py [--bridges]`: the elevation measurements behind `docs/reports/phase5/elevation.md`.
- **OSM features (A6, `osm_features.py`, `routes_features.py`):** `GET /v1/features/item` turns a picked place (Photon id and point) or way into a ready request item (checkpoint, via, must-use, avoid) with the fixtures' rules: a pass-near checkpoint carries its own OSM boundary, a bridge its way, a road its connected ways of that name. `GET /v1/features/nearby` lists highway ways near a tapped point (bridges have no Photon entry: "Karuvanthuruthy bridge" is not in OSM by name). Data: `osm_ways` (every highway way) and `osm_boundaries` (admin_level 8 to 10), loaded from the pinned extract by `uv run python api/scripts/load_osm_features.py [--dsn ...]` (about 3 minutes; 497,563 ways and 13,509 boundaries on 2026-11-18). `/v1/health` reports it as `osm_features`. Built from Photon's ids and points, A01's six checkpoints equal the fixture request exactly (tested).
- **Climb (Phase 5 amendments 13 to 15):** the solver bridges bridge edges before smoothing (`Candidate.bridges_m`, stored in `routes.bridges_m`, migration 0004). The elevation response adds `smoothed` (the solver's own series) and `climb_approximate` (median DEM height < 20 m), which every candidate also carries.
- `scripts/compare_routes.py`: fresh solves against stored routes, to show a solver change leaves the routes alone.

Phase 5d changes (blueprint Phase 5d amendments):
- **Overview points (A14):** `GET /v1/routes/{id}/overview-points?max=N` and `GET /v1/share/{slug}/overview-points?max=N`: at most N (1 to 9) waypoints for a Google Maps walking link, with the worst deviation and the overlap, both leg by leg against Valhalla's path. A miss makes at most 2N + 1 engine calls, two computations at a time, cached 24 h by route, N and Valhalla build. Any 503 means: use evenly spaced km marks and show no estimate.
- **Follow data (A15):** `GET /v1/routes/{id}/follow` and `GET /v1/share/{slug}/follow`: the vertices, the metres along the route at each, and the turn cues with OSM road names. One Valhalla trace per piece between turnarounds, cached 24 h by route and Valhalla build. Without Valhalla still 200, `cue_source: "geometry"`, not cached.
- `scripts/measure_cues.py`: the cues against Valhalla's own turn instructions (`docs/reports/phase5d/cues.md`), and the recorded traces for the unit tests (`tests/fixtures/follow/traces.json`, never edited by hand).
- `scripts/measure_overview.py`: smart against even spacing (`docs/reports/phase5d/overview_data.json`), and the recorded Valhalla paths for the unit tests (`tests/fixtures/overview/legs.json`, never edited by hand).
- `scripts/export_follow_fixtures.py [--check]`: A15 responses from the recorded traces for the web's Follow tests and simulation (`tests/fixtures/follow/routes.json`, never edited by hand; needs no services).
