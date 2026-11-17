# Phase 3b: KPI report (step 4: ±500 m, over_budget, repetition and consistency rules)

Graph build 2026-11-15T00:15:25Z (pinned extract). 54 active fixtures; 4 not yet in scope (S01: later_loops, S02: later_loops, S12: phase_4, S14: later_loops). Measured on the development laptop.

Every number below is measured by the harness from the candidate geometry, independently of the solver's own figures. Conflict objects are checked against brute-force reference values (`tests/kpi/reference.py`).

Pedestrian access is judged twice: the geometry must map-match onto Valhalla pedestrian edges over its whole length (within 1% or 30 m), and no matched OSM way may be unwalkable by its tags in the pinned extract. `edge_walk` exact matching alone is not used as a test: it fails on some of Valhalla's own unmodified pedestrian routes.

**Overall: PASS**

| KPI | Target | Measured | Pass |
| --- | --- | --- | --- |
| Fixtures solved without error | all | 54 / 54 | yes |
| Outcome classification (ok / over_budget / Case A or B) | 100% | 54 / 54 | yes |
| Distance accuracy, point-to-point | median < 0.5%, p95 < 1.5% | median 0.09%, p95 0.35% (n=54) | yes |
| Reported length matches re-measured geometry | every route, 0.1% / 2 m | 68 / 68 | yes |
| Length consistency (engine vs sphere on its own radius) | every route, 0.1% / 2 m + 0.2 m per edge | 68 / 68 | yes |
| Feasibility: access violations or any ferry | 0 | 0 | yes |
| (info) Geometries that pedestrian edge_walk cannot follow exactly | info only | 8 / 68 (map-matched instead; see method) | yes |
| Over-budget handling: correct conflict objects and candidates | 100% | 6 / 6 | yes |
| Latency per solve | p50 < 2 s, p95 < 5 s | p50 1235 ms, p95 2283 ms | yes |
| Duplication beyond what must_reach stops force, excluding out-and-back | median < 2%, none > 10% | median 0.0%, max 2.9% | yes |
| (info) Raw duplication, including what the stops force | info only | median 0.0%, max 14.9% | yes |
| Direction adherence (share moving away from target, after last stop) | every route < 15% | max 0.0%, 31 / 31 under | yes |
| Endpoint bearing (bearing-only requests; continue-past-target direction) | within 30° | 17 / 18 within; 1 beyond 30° where an exhaustive search finds nothing closer (network does not permit) | yes |
| Checkpoint compliance (snapped point within 50 m) | 100% | 68 / 68 | yes |
| Alternative diversity (edge overlap) | < 60% | n/a: one alternative until the spike decision | yes |
| Edit invariants (scenarios 9, 10) | all hold | 2 / 2 | yes |

## Fixtures

| Fixture | Outcome | ms | Candidates (foot km, error %) | Problems |
| --- | --- | --- | --- | --- |
| S03 | ok | 1004 | direct 10.05 (0.46%) | - |
| S04 | ok | 710 | direct 25.00 (0.00%) | - |
| S05 | ok | 1097 | direct 28.02 (0.08%), repeat 11.6% | - |
| S07 | over_budget | 1883 | full_route 25.89, repeat 11.5%; cut_at_target 14.96 (0.27%), repeat 14.9% | - |
| S08 | ok | 1933 | direct 50.03 (0.07%) | - |
| S09 | ok | 1840 | continue_past_target 24.93 (0.29%), repeat 1.2%, bearing off 3°; end_at_target 18.33 | - |
| S10 | ok | 1339 | direct 32.07 (0.22%), repeat 10.2% | - |
| S11 | ok | 1762 | continue_past_target 25.00 (0.01%), bearing off 3°; end_at_target 12.60 | - |
| S13 | ok | 504 | direct 15.07 (0.44%) | - |
| S15 | over_budget | 2151 | full_route 25.89, repeat 11.5%; cut_at_target 24.98 (0.07%), repeat 11.9% | - |
| B01 | ok | 1444 | direct 20.00 (0.00%), bearing off 3° | - |
| B02 | ok | 1210 | direct 12.03 (0.23%), bearing off 5° | - |
| S04-n1 | ok | 681 | direct 25.04 (0.17%) | - |
| S04-n2 | ok | 845 | direct 25.03 (0.14%) | - |
| S04-n3 | ok | 643 | direct 25.00 (0.00%) | - |
| S04-n4 | ok | 810 | direct 24.99 (0.05%) | - |
| S05-n1 | ok | 1242 | direct 28.03 (0.10%), repeat 11.6% | - |
| S05-n2 | ok | 1373 | direct 28.07 (0.25%), repeat 11.6% | - |
| S05-n3 | ok | 1160 | direct 27.91 (0.32%), repeat 11.7% | - |
| S05-n4 | ok | 1154 | direct 28.06 (0.20%), repeat 11.6% | - |
| S07-n1 | over_budget | 1928 | full_route 26.20, repeat 11.4%; cut_at_target 14.95 (0.35%), repeat 14.9% | - |
| S07-n2 | over_budget | 1974 | full_route 28.23, repeat 10.6%; cut_at_target 15.00 (0.00%) | - |
| S08-n1 | ok | 2498 | direct 50.02 (0.04%) | - |
| S08-n2 | ok | 2059 | direct 49.99 (0.01%) | - |
| S11-n1 | ok | 1796 | continue_past_target 24.98 (0.09%), bearing off 3°; end_at_target 13.77 | - |
| S11-n2 | ok | 1856 | continue_past_target 25.05 (0.20%), bearing off 2°; end_at_target 11.29 | - |
| S11-n3 | ok | 1929 | continue_past_target 24.97 (0.12%), bearing off 4°; end_at_target 12.51 | - |
| S13-n1 | ok | 496 | direct 15.07 (0.46%) | - |
| S13-n2 | ok | 424 | direct 15.00 (0.00%) | - |
| S13-n3 | ok | 473 | direct 14.95 (0.35%) | - |
| S15-n1 | over_budget | 2283 | full_route 27.55, repeat 10.8%; cut_at_target 24.96 (0.14%), repeat 12.0% | - |
| S15-n2 | ok | 1062 | direct 24.98 (0.10%), repeat 13.1% | - |
| S15-n3 | over_budget | 2518 | full_route 28.19, repeat 10.6%; cut_at_target 24.99 (0.03%), repeat 11.9% | - |
| S03-n1 | ok | 1050 | direct 10.00 (0.00%) | - |
| S03-n2 | ok | 991 | direct 9.97 (0.32%) | - |
| S03-n3 | ok | 1050 | direct 10.00 (0.00%) | - |
| B01-n1 | ok | 1517 | direct 20.00 (0.00%), bearing off 1° | - |
| B01-n2 | ok | 1455 | direct 20.00 (0.00%), bearing off 5° | - |
| B01-n3 | ok | 1430 | direct 19.94 (0.31%), bearing off 4° | - |
| S04-d15 | ok | 500 | direct 14.99 (0.07%) | - |
| S04-d20 | ok | 538 | direct 20.03 (0.14%) | - |
| S04-d30 | ok | 2283 | continue_past_target 30.00 (0.01%), repeat 0.8%, bearing off 6°; end_at_target 29.15 | - |
| S05-d30 | ok | 1214 | direct 30.06 (0.19%), repeat 10.9% | - |
| S05-d35 | ok | 1362 | direct 35.00 (0.00%), repeat 9.3% | - |
| S11-d20 | ok | 2322 | continue_past_target 19.96 (0.19%), bearing off 23°; end_at_target 12.60 | - |
| S13-d8 | ok | 384 | direct 8.00 (0.00%) | - |
| S13-d25 | ok | 1977 | continue_past_target 24.92 (0.33%), bearing off 4°; end_at_target 17.55 | - |
| S03-d5 | ok | 983 | direct 5.00 (0.00%) | - |
| S03-d16 | ok | 1190 | direct 16.00 (0.00%) | - |
| B-kzk-000 | ok | 1176 | direct 12.00 (0.00%), bearing off 8° | - |
| B-kzk-045 | ok | 1229 | direct 12.03 (0.21%), bearing off 5° | - |
| B-kzk-135 | ok | 1171 | direct 12.00 (0.00%), bearing off 1° | - |
| B-kzk-180 | ok | 2067 | direct 12.00 (0.00%), bearing off 39° (best possible 39°) | - |
| B-kzk-315 | ok | 2063 | direct 11.99 (0.05%), bearing off 25° | - |

## Edit invariants

| Fixture | Edit of | Problems |
| --- | --- | --- |
| S09 | S04 | - |
| S10 | S05 | - |
