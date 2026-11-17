# api

The Phase 4 backend: FastAPI over the solver (blueprint Phase 4 amendments, sections 11 and 12).

- `athlete_api/` the app: `config` (settings), `db` (tables), `deps` (services, client token, rate limits),
  `ratelimit`, `builds` (engine build ids, solver hash), `errors`, `routes_*` (endpoints), `main` (app factory).
- `alembic/` migrations (the schema's authority): `uv run alembic -c api/alembic.ini upgrade head`.
- `scripts/` measurement scripts (`measure_memory.py`).

Run: `uv run uvicorn athlete_api.main:app --port 8000`, docs at http://localhost:8000/docs.
