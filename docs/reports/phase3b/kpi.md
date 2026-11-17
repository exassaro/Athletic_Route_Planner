# Phase 3b: KPI report (step 3: ferry opt-in removed)

Graph build 2026-11-15T00:15:25Z (pinned extract). 54 active fixtures; 4 not yet in scope (S01: later_loops, S02: later_loops, S12: phase_4, S14: later_loops). Measured on the development laptop.

Every number below is measured by the harness from the candidate geometry, independently of the solver's own figures. Conflict objects are checked against brute-force reference values (`tests/kpi/reference.py`).

Pedestrian access is judged twice: the geometry must map-match onto Valhalla pedestrian edges over its whole length (within 1% or 30 m), and no matched OSM way may be unwalkable by its tags in the pinned extract. `edge_walk` exact matching alone is not used as a test: it fails on some of Valhalla's own unmodified pedestrian routes.

**Overall: FAIL**

| KPI | Target | Measured | Pass |
| --- | --- | --- | --- |
| Fixtures solved without error | all | 54 / 54 | yes |
| Outcome classification (ok / infeasible / Case A or B) | 100% | 54 / 54 | yes |
| Distance accuracy, point-to-point | median < 0.5%, p95 < 1.5% | median 0.09%, p95 0.44% (n=48) | yes |
| Reported length matches re-measured geometry | every route, 0.1% / 2 m | 56 / 56 | yes |
| Length consistency (engine vs sphere) | every route, 0.1% / 2 m | 55 / 56 | **no** |
| Feasibility: access violations or any ferry | 0 | 0 | yes |
| (info) Geometries that pedestrian edge_walk cannot follow exactly | info only | 8 / 56 (map-matched instead; see method) | yes |
| Infeasibility handling: correct conflict objects | 100% | 6 / 6 | yes |
| Latency per solve | p50 < 2 s, p95 < 5 s | p50 1204 ms, p95 2221 ms | yes |
| Duplication (repeated edges), excluding out-and-back | median < 2%, none > 10% | median 0.0%, max 13.1% | **no** |
| (proposed) Duplication beyond what the mandatory stops force | median < 2%, none > 10% | median 0.0%, max 1.2% | yes |
| Direction adherence (share moving away from target, after last stop) | every route < 15% | max 0.0%, 31 / 31 under | yes |
| Endpoint bearing (bearing-only requests; continue-past-target direction) | within 30° | 17 / 18 within; 1 beyond 30° where an exhaustive search finds nothing closer (network does not permit) | yes |
| Checkpoint compliance (snapped point within 50 m) | 100% | 56 / 56 | yes |
| Alternative diversity (edge overlap) | < 60% | n/a: one alternative until the spike decision | yes |
| Edit invariants (scenarios 9, 10) | all hold | 2 / 2 | yes |

## Fixtures

| Fixture | Outcome | ms | Candidates (foot km, error %) | Problems |
| --- | --- | --- | --- | --- |
| S03 | ok | 1060 | direct 10.05 (0.46%) | - |
| S04 | ok | 928 | direct 25.00 (0.00%) | - |
| S05 | ok | 1135 | direct 28.02 (0.08%), repeat 11.6% | - |
| S07 | infeasible | 957 |  | - |
| S08 | ok | 2882 | direct 50.03 (0.07%) | - |
| S09 | ok | 1919 | continue_past_target 24.93 (0.29%), repeat 1.2%, bearing off 3°; end_at_target 18.33 | - |
| S10 | ok | 1368 | direct 32.07 (0.22%), repeat 10.2% | - |
| S11 | ok | 1879 | continue_past_target 25.00 (0.01%), bearing off 3°; end_at_target 12.60 | - |
| S13 | ok | 629 | direct 15.07 (0.44%) | - |
| S15 | infeasible | 1066 |  | - |
| B01 | ok | 1741 | direct 20.00 (0.00%), bearing off 3° | - |
| B02 | ok | 1420 | direct 12.03 (0.23%), bearing off 5° | - |
| S04-n1 | ok | 887 | direct 25.04 (0.17%) | - |
| S04-n2 | ok | 1118 | direct 25.03 (0.14%) | - |
| S04-n3 | ok | 752 | direct 25.00 (0.00%) | - |
| S04-n4 | ok | 695 | direct 24.99 (0.05%) | - |
| S05-n1 | ok | 1143 | direct 28.03 (0.10%), repeat 11.6% | - |
| S05-n2 | ok | 1275 | direct 28.07 (0.25%), repeat 11.6% | - |
| S05-n3 | ok | 1412 | direct 27.91 (0.32%), repeat 11.7% | - |
| S05-n4 | ok | 1186 | direct 28.06 (0.20%), repeat 11.6% | - |
| S07-n1 | infeasible | 901 |  | - |
| S07-n2 | infeasible | 1022 |  | - |
| S08-n1 | ok | 2100 | direct 50.02 (0.04%) | - |
| S08-n2 | ok | 2221 | direct 49.99 (0.01%) | - |
| S11-n1 | ok | 1814 | continue_past_target 24.98 (0.09%), bearing off 3°; end_at_target 13.77 | - |
| S11-n2 | ok | 1902 | continue_past_target 25.05 (0.20%), bearing off 2°; end_at_target 11.29 | - |
| S11-n3 | ok | 1828 | continue_past_target 24.97 (0.12%), bearing off 4°; end_at_target 12.51 | - |
| S13-n1 | ok | 671 | direct 15.07 (0.46%) | - |
| S13-n2 | ok | 530 | direct 15.00 (0.00%) | - |
| S13-n3 | ok | 585 | direct 14.95 (0.35%) | - |
| S15-n1 | infeasible | 1019 |  | - |
| S15-n2 | ok | 1187 | direct 24.98 (0.10%), repeat 13.1% | - |
| S15-n3 | infeasible | 1045 |  | - |
| S03-n1 | ok | 1043 | direct 10.00 (0.00%) | direct: engine 10036 m vs sphere 10049 m |
| S03-n2 | ok | 1051 | direct 9.97 (0.32%) | - |
| S03-n3 | ok | 999 | direct 10.00 (0.00%) | - |
| B01-n1 | ok | 1500 | direct 20.00 (0.00%), bearing off 1° | - |
| B01-n2 | ok | 1949 | direct 20.00 (0.00%), bearing off 5° | - |
| B01-n3 | ok | 1787 | direct 19.94 (0.31%), bearing off 4° | - |
| S04-d15 | ok | 519 | direct 14.99 (0.07%) | - |
| S04-d20 | ok | 626 | direct 20.03 (0.14%) | - |
| S04-d30 | ok | 2798 | continue_past_target 30.00 (0.01%), repeat 0.8%, bearing off 6°; end_at_target 29.15 | - |
| S05-d30 | ok | 1252 | direct 30.06 (0.19%), repeat 10.9% | - |
| S05-d35 | ok | 1505 | direct 35.00 (0.00%), repeat 9.3% | - |
| S11-d20 | ok | 2527 | continue_past_target 19.96 (0.19%), bearing off 23°; end_at_target 12.60 | - |
| S13-d8 | ok | 379 | direct 8.00 (0.00%) | - |
| S13-d25 | ok | 1962 | continue_past_target 24.92 (0.33%), bearing off 4°; end_at_target 17.55 | - |
| S03-d5 | ok | 905 | direct 5.00 (0.00%) | - |
| S03-d16 | ok | 1222 | direct 16.00 (0.00%) | - |
| B-kzk-000 | ok | 1292 | direct 12.00 (0.00%), bearing off 8° | - |
| B-kzk-045 | ok | 1333 | direct 12.03 (0.21%), bearing off 5° | - |
| B-kzk-135 | ok | 1383 | direct 12.00 (0.00%), bearing off 1° | - |
| B-kzk-180 | ok | 2140 | direct 12.00 (0.00%), bearing off 39° (best possible 39°) | - |
| B-kzk-315 | ok | 2072 | direct 11.99 (0.05%), bearing off 25° | - |

## Edit invariants

| Fixture | Edit of | Problems |
| --- | --- | --- |
| S09 | S04 | - |
| S10 | S05 | - |
