# Phase 3 status: point-to-point solver

Valhalla 3.9.2 on the pinned Kerala extract (2026-11-15), measured on the development laptop on 2026-11-16. Full KPI table: [kpi.md](kpi.md). Spike: [quieter_spike.md](quieter_spike.md).

## Where things stand

Scope items 1 to 6 are built. "Direct" works for point-to-point (Case A, Case B, bearing-only) and out-and-back. The second alternative waits on the spike decision; loops wait on the KPIs below.

| # | Scope item | Status |
| --- | --- | --- |
| 1 | Models (`RouteRequest`, `Candidate`, `Conflict`) | Done |
| 2 | Fixtures and KPI harness | Done: 60 active fixtures, brute-force reference values, independent re-measurement |
| 3 | Point-to-point: matrix, connectivity, exact DP ordering, L_min, feasibility gate with full conflict object, remainder, exact cut snapped to a junction, verification | Done |
| 4 | Case B and bearing-only endpoints | Done |
| 5 | Out-and-back | Done |
| 6 | Scoring, hard rules, diversity filter | Done for "direct"; diversity is untested until a second alternative exists |
| 7 | Loops | Not started (gated on KPIs) |
| – | "Fewer main roads" alternative | Spike done; waiting for your decision |

## KPIs on the 60 fixtures (section 16, point-to-point)

| KPI | Target | Measured | Pass |
| --- | --- | --- | --- |
| Outcome classification (ok / infeasible / Case A or B) | 100% | 60 / 60 | yes |
| Distance accuracy | median < 0.5%, p95 < 1.5% | median 0.08%, p95 0.44% | yes |
| Reported length matches re-measured geometry | every route | 63 / 63 | yes |
| Length consistency (engine against spherical measurement) | 0.1% / 2 m, every route | 62 / 63 | **no** (decision 2) |
| Access violations or unrequested ferry | 0 | 0 | yes |
| Infeasible fixtures with a correct conflict object | 100% | 7 / 7 | yes |
| Latency per solve | p50 < 2 s, p95 < 5 s | p50 1.3 s, p95 2.4 s | yes |
| Duplication, excluding out-and-back | median < 2%, none > 10% | max 13.1% | **no** (decision 1) |
| Direction adherence | every route < 15% | max 3.5% | yes |
| Endpoint bearing | within 30° where the network permits | 19 / 20; the other is 39° off where an exhaustive search finds nothing closer | yes |
| Checkpoint compliance | 100% | 63 / 63 | yes |
| Edit invariants (scenarios 9, 10) | all hold | 2 / 2 | yes |

## Decisions needed

### 1. Repeated edges forced by a checkpoint

With ferries excluded, Chaliyam is a dead end: a route reaches it and leaves along the same road. Every scenario 5 route therefore repeats 10.6% of its length before the endpoint is even chosen, against the blueprint's hard limit of 10%. As written, the rule would reject the scenario the blueprint uses as its showcase.

What the solver does now: measures repetition raw and "beyond what the stops force", reports it as a `repeated_edges` flag, and does **not** reject. The KPI table keeps the blueprint's raw definition, which fails.

**Proposal:** apply the 10% limit (and the < 2% median) to repetition beyond what the mandatory stops force. Measured that way: median 0.0%, max 3.5%.

### 2. Engine consistency threshold on routes with many short edges

On one out-and-back (S03-n2), the engine's length is 10 m short of the spherical measurement on 10 km. Edge by edge, the cause is Valhalla storing edge lengths in whole metres: the outward leg has 55 edges, which accumulate 5.6 m (0.11%). Nothing is wrong with the route.

**Proposal:** keep 0.1% / 2 m and add a rounding allowance of 0.2 m per edge. Or raise the threshold to 0.15%.

### 3. The second alternative

See [quieter_spike.md](quieter_spike.md). Recommendation: GraphHopper foot with the custom model (option b).

## Findings worth knowing

- **Pedestrian `edge_walk` is not an access check.** It walked a bicycle route over the Feroke Old Bridge (`foot=no`). It also fails on some unmodified Valhalla pedestrian routes. The harness judges access by map-match coverage plus the OSM tags of every way used.
- **Coastal climb figures are noise.** The flat 28 km coastal route reports 115 m of gain after smoothing and a 3 m threshold. The Wayanad ghat route reports 835 m of descent over 15 km, which is plausible. Gain should be shown with care until the elevation source or the smoothing is revisited.
- **Bearing-only requests need a larger contour.** Contour vertices are often far nearer by route than the contour value. The solver samples contours at 1.3× and 2× the remaining distance and cuts each routed sample exactly.
- **The Kerala extract cannot be re-downloaded.** It is pinned in `engine/osm_pin.json`, but the GitHub release backup still has to be uploaded (see README).

## Engine use per solve

7 to 13 engine calls for most requests, about 25 for infeasible ones (each saving is routed and measured), and 20 to 30 for bearing-only requests (contour samples).
