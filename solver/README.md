# solver

Route-generation library (blueprint section 8, amended after Phase 2). Phase 3.

| Module | Contents |
| --- | --- |
| `athlete_solver/models.py` | `RouteRequest` (section 4), `Candidate`, `Conflict`, `SolveResult` |
| `athlete_solver/engine.py` | The only door to the routing engine: ferry policy, foot vs ferry metres, junctions, consistency check, warnings as flags |
| `athlete_solver/ordering.py` | Exact checkpoint ordering (Held-Karp, K best) and the towards-target tie-break |
| `athlete_solver/p2p.py` | Snapping and connectivity checks, minimum route, feasibility gate and conflict object, truncation |
| `athlete_solver/solve.py` | `solve(request, engine)` entry point |
| `athlete_solver/__main__.py` | CLI: `uv run python -m athlete_solver solve request.json` |

The solver calls the routing engine only through `engine/athlete_engine` and never computes a road distance itself. Unit tests run it on an in-memory graph (`tests/unit/fake_engine.py`); the KPI harness (`tests/kpi/run_kpi.py`) runs it against Valhalla on the pinned graph.
