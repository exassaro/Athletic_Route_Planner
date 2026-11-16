# Phase 3: KPI report

Graph build 2026-11-15T00:15:25Z (pinned extract). 60 active fixtures; 4 not yet in scope (S01: later_loops, S02: later_loops, S12: phase_4, S14: later_loops). Measured on the development laptop.

Every number below is measured by the harness from the candidate geometry, independently of the solver's own figures. Conflict objects are checked against brute-force reference values (`tests/kpi/reference.py`).

Pedestrian access is judged twice: the geometry must map-match onto Valhalla pedestrian edges over its whole length (within 1% or 30 m), and no matched OSM way may be unwalkable by its tags in the pinned extract. `edge_walk` exact matching alone is not used as a test: it fails on some of Valhalla's own unmodified pedestrian routes.

**Overall: FAIL**

| KPI | Target | Measured | Pass |
| --- | --- | --- | --- |
| Fixtures solved without error | all | 60 / 60 | yes |
| Outcome classification (ok / infeasible / Case A or B) | 100% | 60 / 60 | yes |
| Distance accuracy, point-to-point | median < 0.5%, p95 < 1.5% | median 0.08%, p95 0.44% (n=53) | yes |
| Reported length matches re-measured geometry | every route, 0.1% / 2 m | 63 / 63 | yes |
| Length consistency (engine vs sphere) | every route, 0.1% / 2 m | 62 / 63 | **no** |
| Feasibility: access violations or unrequested ferry | 0 | 0 | yes |
| (info) Geometries that pedestrian edge_walk cannot follow exactly | info only | 11 / 63 (map-matched instead; see method) | yes |
| Infeasibility handling: correct conflict objects | 100% | 7 / 7 | yes |
| Latency per solve | p50 < 2 s, p95 < 5 s | p50 929 ms, p95 1972 ms | yes |
| Duplication (repeated edges), excluding out-and-back | median < 2%, none > 10% | median 0.0%, max 13.1% | **no** |
| (proposed) Duplication beyond what the mandatory stops force | median < 2%, none > 10% | median 0.0%, max 3.5% | yes |
| Direction adherence (share moving away from target, after last stop) | every route < 15% | max 3.5%, 36 / 36 under | yes |
| Endpoint bearing (bearing-only requests; continue-past-target direction) | within 30° | 19 / 20 within; 1 beyond 30° where an exhaustive search finds nothing closer (network does not permit) | yes |
| Checkpoint compliance (snapped point within 50 m) | 100% | 63 / 63 | yes |
| Alternative diversity (edge overlap) | < 60% | n/a: one alternative until the spike decision | yes |
| Edit invariants (scenarios 9, 10) | all hold | 2 / 2 | yes |

## Fixtures

| Fixture | Outcome | ms | Candidates (foot km, error %) | Problems |
| --- | --- | --- | --- | --- |
| S03 | ok | 862 | direct 10.05 (0.46%) | - |
| S04 | ok | 354 | direct 25.00 (0.00%) | - |
| S05 | ok | 598 | direct 28.02 (0.08%), repeat 11.6% | - |
| S06 | ok | 921 | direct 27.96 (0.16%), repeat 7.8%, ferry 618 m | - |
| S07a | infeasible | 1409 |  | - |
| S07b | infeasible | 1801 |  | - |
| S08 | ok | 553 | direct 50.03 (0.07%) | - |
| S09 | ok | 1220 | continue_past_target 24.93 (0.29%), repeat 1.2%, bearing off 3°; end_at_target 18.33 | - |
| S10 | ok | 705 | direct 32.07 (0.22%), repeat 10.2% | - |
| S11 | ok | 1257 | continue_past_target 25.00 (0.01%), bearing off 3°; end_at_target 12.60 | - |
| S13 | ok | 323 | direct 15.07 (0.44%) | - |
| S15 | infeasible | 1412 |  | - |
| B01 | ok | 1102 | direct 20.00 (0.00%), bearing off 3° | - |
| B02 | ok | 1013 | direct 12.03 (0.23%), bearing off 5° | - |
| S04-n1 | ok | 355 | direct 25.04 (0.17%) | - |
| S04-n2 | ok | 303 | direct 25.03 (0.14%) | - |
| S04-n3 | ok | 294 | direct 25.00 (0.00%) | - |
| S04-n4 | ok | 316 | direct 24.99 (0.05%) | - |
| S05-n1 | ok | 674 | direct 28.03 (0.10%), repeat 11.6% | - |
| S05-n2 | ok | 646 | direct 28.07 (0.25%), repeat 11.6% | - |
| S05-n3 | ok | 761 | direct 27.91 (0.32%), repeat 11.7% | - |
| S05-n4 | ok | 675 | direct 28.06 (0.20%), repeat 11.6% | - |
| S06-n1 | ok | 969 | direct 28.02 (0.07%), repeat 7.8%, ferry 618 m | - |
| S06-n2 | ok | 949 | direct 27.99 (0.03%), repeat 7.8%, ferry 618 m, away 4% | - |
| S06-n3 | ok | 1945 | continue_past_target 28.03 (0.09%), repeat 8.2%, ferry 618 m, bearing off 1°; end_at_target 26.69, repeat 8.1%, ferry 618 m | - |
| S07a-n1 | infeasible | 1379 |  | - |
| S07a-n2 | infeasible | 1424 |  | - |
| S08-n1 | ok | 546 | direct 49.93 (0.13%) | - |
| S08-n2 | ok | 583 | direct 50.04 (0.08%) | - |
| S11-n1 | ok | 1247 | continue_past_target 24.88 (0.46%), repeat 3.5%, bearing off 5°; end_at_target 13.35 | - |
| S11-n2 | ok | 1369 | continue_past_target 24.96 (0.15%), bearing off 2°; end_at_target 12.91 | - |
| S11-n3 | ok | 2164 | continue_past_target 25.03 (0.11%), bearing off 9°; end_at_target 15.14 | - |
| S13-n1 | ok | 343 | direct 15.03 (0.17%) | - |
| S13-n2 | ok | 284 | direct 15.00 (0.00%) | - |
| S13-n3 | ok | 572 | direct 15.00 (0.00%) | - |
| S15-n1 | infeasible | 1555 |  | - |
| S15-n2 | infeasible | 1520 |  | - |
| S15-n3 | ok | 808 | direct 24.98 (0.07%), repeat 13.1% | - |
| S03-n1 | ok | 898 | direct 10.00 (0.00%) | - |
| S03-n2 | ok | 905 | direct 10.00 (0.00%) | direct: engine 10040 m vs sphere 10050 m |
| S03-n3 | ok | 915 | direct 10.05 (0.49%) | - |
| B01-n1 | ok | 1134 | direct 20.00 (0.00%), bearing off 0° | - |
| B01-n2 | ok | 1209 | direct 20.00 (0.00%), bearing off 4° | - |
| B01-n3 | ok | 1209 | direct 19.91 (0.44%), bearing off 1° | - |
| S04-d15 | ok | 322 | direct 14.99 (0.07%) | - |
| S04-d20 | ok | 284 | direct 20.03 (0.14%) | - |
| S04-d30 | ok | 1198 | continue_past_target 30.00 (0.01%), repeat 0.8%, bearing off 6°; end_at_target 29.15 | - |
| S05-d30 | ok | 664 | direct 30.06 (0.19%), repeat 10.9% | - |
| S05-d35 | ok | 667 | direct 35.00 (0.00%), repeat 9.3% | - |
| S06-d32 | ok | 2003 | continue_past_target 31.87 (0.39%), repeat 7.3%, ferry 618 m, bearing off 7°; end_at_target 28.18, repeat 7.7%, ferry 618 m | - |
| S11-d20 | ok | 1972 | continue_past_target 19.96 (0.19%), bearing off 23°; end_at_target 12.60 | - |
| S13-d8 | ok | 302 | direct 8.00 (0.00%) | - |
| S13-d25 | ok | 1200 | continue_past_target 24.92 (0.33%), bearing off 4°; end_at_target 17.55 | - |
| S03-d5 | ok | 870 | direct 5.00 (0.00%) | - |
| S03-d16 | ok | 936 | direct 16.00 (0.00%) | - |
| B-kzk-000 | ok | 992 | direct 12.00 (0.00%), bearing off 8° | - |
| B-kzk-045 | ok | 1033 | direct 12.03 (0.21%), bearing off 5° | - |
| B-kzk-135 | ok | 1004 | direct 12.00 (0.00%), bearing off 1° | - |
| B-kzk-180 | ok | 1974 | direct 12.00 (0.00%), bearing off 39° (best possible 39°) | - |
| B-kzk-315 | ok | 1939 | direct 11.99 (0.05%), bearing off 25° | - |

## Edit invariants

| Fixture | Edit of | Problems |
| --- | --- | --- |
| S09 | S04 | - |
| S10 | S05 | - |
