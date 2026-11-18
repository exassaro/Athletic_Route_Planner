# The Phase 4 API: FastAPI over the solver, one uvicorn worker (Phase 4 amendment 20).
# Build from the repository root:  docker compose --profile api build api
# Python 3.12.16: python:3.12-slim on 2026-11-18, pinned by digest
FROM python@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
COPY --from=ghcr.io/astral-sh/uv:0.13.8 /uv /uvx /bin/

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1

# Dependencies first (cached while only the code changes), from the lock file.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY engine/athlete_engine engine/athlete_engine
COPY solver/athlete_solver solver/athlete_solver
COPY api api
RUN uv sync --frozen --no-dev

ENV PATH=/app/.venv/bin:$PATH
EXPOSE 8000
# Migrate, then serve. data/manifest.json (the OSM pin) is mounted read-only by docker-compose.
CMD ["sh", "-c", "alembic -c api/alembic.ini upgrade head && exec uvicorn athlete_api.main:app --host 0.0.0.0 --port 8000 --workers 1"]
