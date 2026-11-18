# api

The Phase 4 backend: FastAPI over the solver (blueprint Phase 4 amendments, sections 11 and 12).

- `athlete_api/` the app:
  - `config` (settings), `db` (tables), `store` (Candidate <-> routes row), `schemas` (response models wrapping
    the solver's), `deps` (services, client token, rate limits), `ratelimit`, `builds` (engine build ids, solver
    hash), `errors`;
  - `solving` (solve slots, worker thread, shared in-flight solves), `elevation` (Valhalla /height for Z and the
    profile), `cache` (Redis, 24 h), `planning` (build ids -> cache -> solve -> store a version; 429/504),
    `diff` (version diff), `explain` (template explanations, numbers only from the SolveResult);
  - `routes_*` (endpoints), `main` (app factory; `create_app(solver=...)` takes a fake solver in tests).
- `alembic/` migrations (the schema's authority): `uv run alembic -c api/alembic.ini upgrade head`.
- `athlete_api/examples/` OpenAPI examples, generated from real solver output by `scripts/build_examples.py`.
- `scripts/` `measure_memory.py`, `export_sample_gpx.py`, `record_photon_fixtures.py`, `build_examples.py`.

Run: `uv run uvicorn athlete_api.main:app --port 8000`, docs at http://localhost:8000/docs.

Phase 5 changes (blueprint Phase 5 amendment 7):
- **CORS (A1):** `ATHLETE_CORS_ORIGINS`, comma-separated, default `http://localhost:3000,http://127.0.0.1:3000` (the `next dev` server). Allowed headers: `Content-Type`, `X-Client-Token`, `If-Match`; exposed: `Retry-After`, `Content-Disposition`, `Location`. Set it to an empty string to turn CORS off (one origin behind Caddy).
- **GPX (A2):** a loop's or out-and-back's end waypoint is "<start> finish"; `?ele=false` on both GPX endpoints leaves out `<ele>`.
