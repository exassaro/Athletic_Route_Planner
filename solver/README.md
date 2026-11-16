# solver

Route-generation library (blueprint section 8, amended after Phase 2). Phase 3.

| Module | Contents |
| --- | --- |
| `athlete_solver/models.py` | `RouteRequest` (section 4), `Candidate`, `Conflict`, `SolveResult` |

The solver calls the routing engine only through `engine/athlete_engine` and never computes a road distance itself.
