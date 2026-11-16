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
| Latency per solve | p50 < 2 s, p95 < 5 s | p50 1314 ms, p95 2376 ms | yes |
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
| S03 | ok | 1016 | direct 10.05 (0.46%) | - |
| S04 | ok | 885 | direct 25.00 (0.00%) | - |
| S05 | ok | 1076 | direct 28.02 (0.08%), repeat 11.6% | - |
| S06 | ok | 1559 | direct 27.96 (0.16%), repeat 7.8%, ferry 618 m | - |
| S07a | infeasible | 1358 |  | - |
| S07b | infeasible | 1639 |  | - |
| S08 | ok | 2376 | direct 50.03 (0.07%) | - |
| S09 | ok | 1694 | continue_past_target 24.93 (0.29%), repeat 1.2%, bearing off 3°; end_at_target 18.33 | - |
| S10 | ok | 1316 | direct 32.07 (0.22%), repeat 10.2% | - |
| S11 | ok | 1766 | continue_past_target 25.00 (0.01%), bearing off 3°; end_at_target 12.60 | - |
| S13 | ok | 547 | direct 15.07 (0.44%) | - |
| S15 | infeasible | 1319 |  | - |
| B01 | ok | 1439 | direct 20.00 (0.00%), bearing off 3° | - |
| B02 | ok | 1193 | direct 12.03 (0.23%), bearing off 5° | - |
| S04-n1 | ok | 655 | direct 25.04 (0.17%) | - |
| S04-n2 | ok | 781 | direct 25.03 (0.14%) | - |
| S04-n3 | ok | 647 | direct 25.00 (0.00%) | - |
| S04-n4 | ok | 626 | direct 24.99 (0.05%) | - |
| S05-n1 | ok | 1003 | direct 28.03 (0.10%), repeat 11.6% | - |
| S05-n2 | ok | 1061 | direct 28.07 (0.25%), repeat 11.6% | - |
| S05-n3 | ok | 1128 | direct 27.91 (0.32%), repeat 11.7% | - |
| S05-n4 | ok | 1039 | direct 28.06 (0.20%), repeat 11.6% | - |
| S06-n1 | ok | 1349 | direct 28.02 (0.07%), repeat 7.8%, ferry 618 m | - |
| S06-n2 | ok | 1352 | direct 27.99 (0.03%), repeat 7.8%, ferry 618 m, away 4% | - |
| S06-n3 | ok | 2758 | continue_past_target 28.03 (0.09%), repeat 8.2%, ferry 618 m, bearing off 1°; end_at_target 26.69, repeat 8.1%, ferry 618 m | - |
| S07a-n1 | infeasible | 1338 |  | - |
| S07a-n2 | infeasible | 1320 |  | - |
| S08-n1 | ok | 1716 | direct 49.93 (0.13%) | - |
| S08-n2 | ok | 1634 | direct 50.04 (0.08%) | - |
| S11-n1 | ok | 1880 | continue_past_target 24.88 (0.46%), repeat 3.5%, bearing off 5°; end_at_target 13.35 | - |
| S11-n2 | ok | 1718 | continue_past_target 24.96 (0.15%), bearing off 2°; end_at_target 12.91 | - |
| S11-n3 | ok | 2531 | continue_past_target 25.03 (0.11%), bearing off 9°; end_at_target 15.14 | - |
| S13-n1 | ok | 524 | direct 15.03 (0.17%) | - |
| S13-n2 | ok | 501 | direct 15.00 (0.00%) | - |
| S13-n3 | ok | 763 | direct 15.00 (0.00%) | - |
| S15-n1 | infeasible | 1368 |  | - |
| S15-n2 | infeasible | 1460 |  | - |
| S15-n3 | ok | 944 | direct 24.98 (0.07%), repeat 13.1% | - |
| S03-n1 | ok | 995 | direct 10.00 (0.00%) | - |
| S03-n2 | ok | 1035 | direct 10.00 (0.00%) | direct: engine 10040 m vs sphere 10050 m |
| S03-n3 | ok | 975 | direct 10.05 (0.49%) | - |
| B01-n1 | ok | 1445 | direct 20.00 (0.00%), bearing off 0° | - |
| B01-n2 | ok | 1470 | direct 20.00 (0.00%), bearing off 4° | - |
| B01-n3 | ok | 1509 | direct 19.91 (0.44%), bearing off 1° | - |
| S04-d15 | ok | 462 | direct 14.99 (0.07%) | - |
| S04-d20 | ok | 542 | direct 20.03 (0.14%) | - |
| S04-d30 | ok | 2105 | continue_past_target 30.00 (0.01%), repeat 0.8%, bearing off 6°; end_at_target 29.15 | - |
| S05-d30 | ok | 1107 | direct 30.06 (0.19%), repeat 10.9% | - |
| S05-d35 | ok | 1312 | direct 35.00 (0.00%), repeat 9.3% | - |
| S06-d32 | ok | 2943 | continue_past_target 31.87 (0.39%), repeat 7.3%, ferry 618 m, bearing off 7°; end_at_target 28.18, repeat 7.7%, ferry 618 m | - |
| S11-d20 | ok | 2340 | continue_past_target 19.96 (0.19%), bearing off 23°; end_at_target 12.60 | - |
| S13-d8 | ok | 419 | direct 8.00 (0.00%) | - |
| S13-d25 | ok | 1779 | continue_past_target 24.92 (0.33%), bearing off 4°; end_at_target 17.55 | - |
| S03-d5 | ok | 904 | direct 5.00 (0.00%) | - |
| S03-d16 | ok | 1251 | direct 16.00 (0.00%) | - |
| B-kzk-000 | ok | 1276 | direct 12.00 (0.00%), bearing off 8° | - |
| B-kzk-045 | ok | 1188 | direct 12.03 (0.21%), bearing off 5° | - |
| B-kzk-135 | ok | 1186 | direct 12.00 (0.00%), bearing off 1° | - |
| B-kzk-180 | ok | 2254 | direct 12.00 (0.00%), bearing off 39° (best possible 39°) | - |
| B-kzk-315 | ok | 2138 | direct 11.99 (0.05%), bearing off 25° | - |

## Edit invariants

| Fixture | Edit of | Problems |
| --- | --- | --- |
| S09 | S04 | - |
| S10 | S05 | - |
