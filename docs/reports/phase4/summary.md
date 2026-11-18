# Phase 4 status: the backend API

The API in `api/` exposes the solver over HTTP (blueprint Phase 4 amendments 1 to 25, sections 11 and 12). Measured on the development laptop (not the target server) on 2026-11-18, on the pinned Kerala extract (2026-11-15). Engines: Valhalla 3.9.2 and GraphHopper 11.1. Also running: Photon 1.3.0, PostgreSQL 16.4 with PostGIS 3.4, and Redis 7.4.12. The API image is `athlete-api:0.4.0` (Python 3.12.16, FastAPI 0.163, SQLAlchemy 2.1, Pydantic 2.14).

**The solver is unchanged**:
- `git diff` shows no change under `solver/` or `engine/athlete_engine/` since Phase 3c (solver hash `6408f21418d9dd58`).
- The KPI harness gives the same result on every row and every fixture as in Phase 3c, apart from solve times ([solver_kpi.md](solver_kpi.md)).

Detailed reports:
- [latency.md](latency.md) (raw: `latency_data.json`);
- [memory.md](memory.md);
- `stack_memory_data.json`;
- [solver_kpi.md](solver_kpi.md);
- GPX samples in [gpx/](gpx/).

## Acceptance

| Criterion (section 15, updated) | Target | Measured | Pass |
| --- | --- | --- | --- |
| Create, point-to-point, through the API | p95 < 5 s | p50 611 ms, p95 1,302 ms (78 fixtures) | yes |
| Patch, point-to-point, through the API | p95 < 5 s | p50 577 ms, p95 1,432 ms (78 fixtures) | yes |
| Cache hit | < 100 ms | create: p95 49.7 ms, max 58.9 ms. Patch: p95 51.0 ms, max 80.8 ms | yes |
| GPX valid against the GPX 1.1 schema | every file | every candidate of A01 and A02 in unit tests, every download in the API and live tests | yes |
| GPX imports into Garmin Connect and Strava | by hand | **not yet checked**: the files are in [gpx/](gpx/) | developer |
| All tests pass | all | 272 tests: 193 unit and API (no engines), 79 integration (live stack: the 72 solver tests from Phase 3c and 7 API tests) | yes |
| Solver KPIs unchanged | identical | identical apart from solve times; overall PASS | yes |

Latency was measured through the containerised API (`docker compose --profile api`), one request at a time:
- **Cache:** flushed first.
- **Rate limits:** raised for the run, since one client sent 376 create and patch requests.
- **Fixtures:** all 110 active ones (78 point-to-point and out-and-back, 32 loops).
- **Outcomes:** 99 `ok`, 9 `over_budget`, 2 `infeasible`.
- **Failures:** none.

## Endpoints

| Method and path | Token | Rate bucket | Notes |
| --- | --- | --- | --- |
| `POST /v1/session` | no | 10 an hour per IP | Issues an anonymous token for `X-Client-Token` |
| `GET /v1/places/search` | yes | read | Photon, Kerala only, never picks; `ambiguous` with reasons |
| `GET /v1/places/reverse` | yes | read | |
| `POST /v1/plans` | yes | solve | Version 1 |
| `PATCH /v1/plans/{id}` | yes | solve | RFC 6902 patch, diff, undo; `If-Match` |
| `GET /v1/plans/{id}` | yes | read | Latest version, version list, status `ready`, `solving` or `failed` |
| `GET /v1/plans/{id}/versions/{n}` | yes | read | |
| `GET /v1/routes/{id}` | yes | read | GeoJSON with Z |
| `GET /v1/routes/{id}/elevation` | yes | read | 30 m profile, the solver's gain and loss |
| `GET /v1/routes/{id}/gpx` | yes | read | GPX 1.1 course |
| `POST /v1/routes/{id}/save` | yes | read | Share slug; saving again renames |
| `GET /v1/me/routes` | yes | read | |
| `GET /v1/share/{slug}` | no | per IP | Public; the plan id stays private |
| `GET /v1/share/{slug}/gpx` | no | per IP | Added so a share page can offer the download |
| `GET /v1/health` | no | none | Five services, both engine build ids, OSM pin, solver hash |

The rate limits are 20 solves a minute per client and 40 per IP, and 300 reads a minute. A request over a limit gets 429 `rate_limited`; no free solve slot within 10 s gives 429 `solver_busy`. OpenAPI (`/docs`) shows every model, with examples generated from real solver output (A01, A01 at 20 km, S11, S02, G01).

## Latency per endpoint (containerised API)

| Endpoint | n | p50 (ms) | p95 (ms) | max (ms) |
| --- | --- | --- | --- | --- |
| Create, point-to-point (cold) | 78 | 611.1 | 1,302.1 | 2,656.2 |
| Create, point-to-point, cache hit | 78 | 31.6 | 49.7 | 58.9 |
| Patch, point-to-point (+1 km, cold) | 78 | 577.2 | 1,432.4 | 2,120.8 |
| Patch back, cache hit | 78 | 36.1 | 51.0 | 80.8 |
| Create, loop (cold) | 32 | 468.5 | 1,771.4 | 2,655.0 |
| Create, loop, cache hit | 32 | 30.0 | 50.7 | 51.7 |
| GET plan | 78 | 15.7 | 25.2 | 72.6 |
| GET version | 78 | 14.4 | 23.6 | 80.2 |
| GET route (GeoJSON) | 78 | 10.5 | 16.7 | 57.5 |
| GET elevation | 78 | 9.9 | 14.2 | 15.8 |
| GET gpx | 78 | 15.4 | 23.9 | 31.9 |
| GET health | 20 | 13.8 | 17.7 | 19.8 |
| Places search | 20 | 22.5 | 31.3 | 39.8 |

**Solves are about three times faster inside Docker than from the host.**
- In the container, the solver's own time is p50 515 ms and p95 1.12 s for point-to-point.
- The KPI harness, which runs on the host, measures 1.80 s and 4.10 s for the same fixtures.
- A solve makes 12 to 150 engine calls, and from the host each one crosses Docker Desktop's port forwarding.

The API's own cost is the difference between request time and solver time: about 100 ms at p50 on a cold create, mostly for elevation and storage.

**Cache hits were over the target in the first run** (p95 116 ms create, 117 ms patch). Profiling a hit showed two costs:
- **A read-back:** the response was read back from Postgres after storing, so every geometry was parsed again.
- **Double validation:** FastAPI validated the large response a second time.

Since then:
- create and patch build the response from the objects they have just stored (the GET endpoints still read the rows, and tests check that both agree);
- the response is serialised once;
- the cache is decoded with pydantic's JSON parser;
- the PATCH path reads only the base request, and the diff reads only the routes' lengths, durations and ends.

The second run's memory sampler also ran every 3 s instead of continuously, which took CPU contention off the machine, so not all of the improvement is the code.

## Concurrency (amendment 3)

**Six different point-to-point requests at once** (`tests/integration/test_api_concurrency_live.py`, in-process, 2 slots):
- at most 2 solves ran at the same time, and the other four waited;
- all six returned 201 in 5.9 s of wall time;
- no errors, no engine timeouts, and GraphHopper answered every request.

No request waited 10 s, so the live run gave no 429. The 429 `solver_busy` and 504 `solve_timeout` paths are tested with a slow fake solver: the 504 returns the plan id, the solve keeps its slot until it ends, and the version then appears.

**Through the container, six heavier requests at once** (S08, A01, S13, X03, X07, F02): all returned 201, in 3.5 s of wall time.

## Memory

| Container | Idle | Peak, six concurrent solves through the API |
| --- | --- | --- |
| GraphHopper | 2,089 MiB | 2,113 MiB |
| Valhalla | 510 MiB | 541 MiB |
| Photon | 478 MiB | 523 MiB |
| Postgres | 22 MiB | 133 MiB |
| API | 103 MiB | 125 MiB (123 MiB max over the whole latency run) |
| Redis | 3 MiB | 5 MiB |
| Docker VM, used / available | 3,660 / 4,010 MiB (without the API) | 3,909 / 3,669 MiB |

Everything, Photon included, fits in the 7.7 GiB VM with no swap. Windows itself had 1.2 to 2.2 GiB free (see [memory.md](memory.md)). The API container's limit is 1 GiB.

## The acceptance flow (live, `tests/integration/test_api_flow_live.py`)

1. **POST A01:** the response equals the solver's own result, run directly. Outcome, conflict, facts, flags and all four candidates match, to every vertex.
2. **PATCH to 20 km:**
   - The outcome is `over_budget`: the stops need at least 21.7 km, 1.7 km over.
   - Both alternatives return their full route and a cut at the target, each within 500 m of 20 km.
   - The diff names `/target_distance_m`, a change from `ok` to `over_budget`, and an end that changed.
   - The explanation says "Dropping X does not shorten the run" for each of the four stops that save 0 m. It gives Beypore 2.0 km and Kallai 6.6 km.
3. **PATCH back to 25 km:** equal to version 1, both through the cache and again as a fresh solve with the cache off. The solver is deterministic on this request.
4. **Save, share, GPX:** the share link works without a token, and both GPX downloads validate against the schema.
5. **PostGIS cross-check:** every stored route's 2D `ST_Length` agrees with the solver's length. A01 agrees to about 10⁻⁸ m.

## Choices made during the phase (say if any should change)

1. **`X-Client-Token`** is the header name, because it carries a secret.
2. **Postgres is on host port 5433.** A native Windows PostgreSQL already holds 5432.
3. **The app uses asyncpg**, because psycopg's async mode cannot run on the Windows Proactor event loop. Alembic uses psycopg.
4. **`ST_Length` on a geography `LINESTRING Z` counts the height changes.** A flat 109.29 m segment measured 148.13 m with a 100 m rise. Any SQL cross-check must drop Z: `ST_Length(ST_Force2D(geom::geometry)::geography)`.
5. **A missing height is an error** (502 `elevation_unavailable`), never filled in. No missing heights were found:
   - 99 saved routes (25,673 vertices);
   - all 110 fixtures created and 78 patched during the latency run.
6. **Photon returns no score**, so the ambiguity test is the name rule alone. Its `county` is a district or a taluk, so the API calls it `county`. OSM often holds a place several times (village, boundary, station), so most names come back `ambiguous`:
   - "Kadalundi" returns three in Kozhikode;
   - "Chungam" appears in 7 districts or taluks.
7. **The Kerala filter** is the pinned extract's bounding box as GraphHopper reports it (a pre-filter only), then `state == "Kerala"`.
8. **PATCH while a solve is running gives 409 `plan_solving`**, rather than patching a request that is about to change.
9. **Saving the same route again renames it** and keeps its share slug.
10. **`cache_enabled`** (default on) lets tests and diagnosis force fresh solves.
11. **GPX** has waypoints where the route passes each checkpoint. Shaping points (`via`) and `must_use` items are not waypoints. The XML declaration is double-quoted for fussy importers. There are no timestamps, so these are courses, not activities.
12. **The OpenAPI "no route" example is G01** (`loop_stop_too_far`). No fixture is `disconnected`, and none was invented for the docs.

## Left out

- **Done in later phases:**
  - `POST /v1/plans/{id}/messages` (Phase 6);
  - login (Phase 8);
  - pace-based running time (durations are the engine's walking time, amendment 11);
  - production deployment, TLS and backups (Phase 8).
- **Needs a solver change:** partial results on a 504 (amendment 12).
- **Deferred:**
  - **A solve limit shared by several API processes** (in Redis). One uvicorn worker holds it now (amendment 20).
  - **CORS.** Not configured: the Phase 5 front end will need its origin allowed.
- **Not measured:**
  - a live 429 `solver_busy` (the six concurrent solves never waited 10 s);
  - latency on the target server;
  - load beyond six simultaneous solves.
- **Developer:** importing the GPX files into Garmin Connect and Strava.
- **Scenario S12** ("ambiguous place name") is still marked `phase_4` in `tests/fixtures/scenarios/base.json`, with no request. The behaviour is covered by the place tests, which use recorded Photon output and the live index. The scenario file was left alone, since the KPI harness reads it.
- **The KPI harness crashes on its last print line** when `--report` is a relative path (`run_kpi.py`, `relative_to`). The report is written before it. An absolute path avoids the crash. The harness was not changed in this phase.

## Next

By blueprint section 15, the next phase is **Phase 5, the front end and map**.
