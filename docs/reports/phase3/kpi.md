# Phase 3: KPI report

Graph build 2026-11-15T00:15:25Z (pinned extract). 12 active fixtures (filtered); 4 not yet in scope (S01: later_loops, S02: later_loops, S12: phase_4, S14: later_loops). Measured on the development laptop.

Every number below is measured by the harness from the candidate geometry, independently of the solver's own figures. Conflict objects are checked against brute-force reference values (`tests/kpi/reference.py`).

Pedestrian access is judged twice: the geometry must map-match onto Valhalla pedestrian edges over its whole length (within 1% or 30 m), and no matched OSM way may be unwalkable by its tags in the pinned extract. `edge_walk` exact matching alone is not used as a test: it fails on some of Valhalla's own unmodified pedestrian routes.

**Overall: FAIL**

| KPI | Target | Measured | Pass |
| --- | --- | --- | --- |
| Fixtures solved without error | all | 12 / 12 | yes |
| Outcome classification (ok / infeasible / Case A or B) | 100% | 12 / 12 | yes |
| Distance accuracy, point-to-point | median < 0.5%, p95 < 1.5% | median 0.19%, p95 0.32% (n=9) | yes |
| Reported length matches re-measured geometry | every route, 0.1% / 2 m | 9 / 9 | yes |
| Length consistency (engine vs sphere) | every route, 0.1% / 2 m | 9 / 9 | yes |
| Feasibility: access violations or unrequested ferry | 0 | 0 | yes |
| (info) Geometries that pedestrian edge_walk cannot follow exactly | info only | 0 / 9 (map-matched instead; see method) | yes |
| Infeasibility handling: correct conflict objects | 100% | 3 / 3 | yes |
| Latency per solve | p50 < 2 s, p95 < 5 s | p50 743 ms, p95 1587 ms | yes |
| Duplication (repeated edges), excluding out-and-back | median < 2%, none > 10% | median 11.6%, max 13.1% | **no** |
| (proposed) Duplication beyond what the mandatory stops force | median < 2%, none > 10% | median 1.0%, max 1.1% | yes |
| Direction adherence (share moving away from target, after last stop) | every route < 15% | max 0.0%, 8 / 8 under | yes |
| Endpoint bearing (bearing-only requests) | within 30° | no routes | **no** |
| Checkpoint compliance (snapped point within 50 m) | 100% | 9 / 9 | yes |
| Alternative diversity (edge overlap) | < 60% | n/a: one alternative until the spike decision | yes |
| Edit invariants (scenarios 9, 10) | all hold | 1 / 1 | yes |

## Fixtures

| Fixture | Outcome | ms | Candidates (foot km, error %) | Problems |
| --- | --- | --- | --- | --- |
| S05 | ok | 716 | direct 28.02 (0.08%), repeat 11.6% | - |
| S10 | ok | 765 | direct 32.07 (0.22%), repeat 10.2% | - |
| S15 | infeasible | 1586 |  | - |
| S05-n1 | ok | 711 | direct 28.03 (0.10%), repeat 11.6% | - |
| S05-n2 | ok | 697 | direct 28.07 (0.25%), repeat 11.6% | - |
| S05-n3 | ok | 744 | direct 27.91 (0.32%), repeat 11.7% | - |
| S05-n4 | ok | 724 | direct 28.06 (0.20%), repeat 11.6% | - |
| S15-n1 | infeasible | 1679 |  | - |
| S15-n2 | infeasible | 1587 |  | - |
| S15-n3 | ok | 782 | direct 24.98 (0.07%), repeat 13.1% | - |
| S05-d30 | ok | 743 | direct 30.06 (0.19%), repeat 10.9% | - |
| S05-d35 | ok | 723 | direct 35.00 (0.00%), repeat 9.3% | - |

## Edit invariants

| Fixture | Edit of | Problems |
| --- | --- | --- |
| S10 | S05 | - |
