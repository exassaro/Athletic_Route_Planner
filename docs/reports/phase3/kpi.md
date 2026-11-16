# Phase 3: KPI report

Graph build 2026-11-15T00:15:25Z (pinned extract). 60 active fixtures; 4 not yet in scope (S01: later_loops, S02: later_loops, S12: phase_4, S14: later_loops). Measured on the development laptop.

Every number below is measured by the harness from the candidate geometry, independently of the solver's own figures. Conflict objects are checked against brute-force reference values (`tests/kpi/reference.py`).

**Overall: FAIL**

| KPI | Target | Measured | Pass |
| --- | --- | --- | --- |
| Fixtures solved without error | all | 0 / 60 | **no** |
| Outcome classification (ok / infeasible / Case A or B) | 100% | 0 / 60 | **no** |
| Distance accuracy, point-to-point | median < 0.5%, p95 < 1.5% | no routes | **no** |
| Reported length matches re-measured geometry | every route, 0.1% / 2 m | 0 / 0 | **no** |
| Length consistency (engine vs sphere) | every route, 0.1% / 2 m | 0 / 0 | **no** |
| Feasibility: access violations or unrequested ferry | 0 | 0 | **no** |
| Infeasibility handling: correct conflict objects | 100% | 0 / 7 | **no** |
| Latency per solve | p50 < 2 s, p95 < 5 s | no solves | **no** |
| Duplication (repeated edges), excluding out-and-back | median < 2%, none > 10% | no routes | **no** |
| Direction adherence (share moving away from target, after last stop) | every route < 15% | no routes | **no** |
| Endpoint bearing (bearing-only requests) | within 30° | no routes | **no** |
| Checkpoint compliance (snapped point within 50 m) | 100% | 0 / 0 | **no** |
| Alternative diversity (edge overlap) | < 60% | n/a: one alternative until the spike decision | yes |
| Edit invariants (scenarios 9, 10) | all hold | 0 / 2 | **no** |

## Fixtures

| Fixture | Outcome | ms | Candidates (foot km, error %) | Problems |
| --- | --- | --- | --- | --- |
| S03 | error | | | not implemented: solver not implemented yet |
| S04 | error | | | not implemented: solver not implemented yet |
| S05 | error | | | not implemented: solver not implemented yet |
| S06 | error | | | not implemented: solver not implemented yet |
| S07a | error | | | not implemented: solver not implemented yet |
| S07b | error | | | not implemented: solver not implemented yet |
| S08 | error | | | not implemented: solver not implemented yet |
| S09 | error | | | not implemented: solver not implemented yet |
| S10 | error | | | not implemented: solver not implemented yet |
| S11 | error | | | not implemented: solver not implemented yet |
| S13 | error | | | not implemented: solver not implemented yet |
| S15 | error | | | not implemented: solver not implemented yet |
| B01 | error | | | not implemented: solver not implemented yet |
| B02 | error | | | not implemented: solver not implemented yet |
| S04-n1 | error | | | not implemented: solver not implemented yet |
| S04-n2 | error | | | not implemented: solver not implemented yet |
| S04-n3 | error | | | not implemented: solver not implemented yet |
| S04-n4 | error | | | not implemented: solver not implemented yet |
| S05-n1 | error | | | not implemented: solver not implemented yet |
| S05-n2 | error | | | not implemented: solver not implemented yet |
| S05-n3 | error | | | not implemented: solver not implemented yet |
| S05-n4 | error | | | not implemented: solver not implemented yet |
| S06-n1 | error | | | not implemented: solver not implemented yet |
| S06-n2 | error | | | not implemented: solver not implemented yet |
| S06-n3 | error | | | not implemented: solver not implemented yet |
| S07a-n1 | error | | | not implemented: solver not implemented yet |
| S07a-n2 | error | | | not implemented: solver not implemented yet |
| S08-n1 | error | | | not implemented: solver not implemented yet |
| S08-n2 | error | | | not implemented: solver not implemented yet |
| S11-n1 | error | | | not implemented: solver not implemented yet |
| S11-n2 | error | | | not implemented: solver not implemented yet |
| S11-n3 | error | | | not implemented: solver not implemented yet |
| S13-n1 | error | | | not implemented: solver not implemented yet |
| S13-n2 | error | | | not implemented: solver not implemented yet |
| S13-n3 | error | | | not implemented: solver not implemented yet |
| S15-n1 | error | | | not implemented: solver not implemented yet |
| S15-n2 | error | | | not implemented: solver not implemented yet |
| S15-n3 | error | | | not implemented: solver not implemented yet |
| S03-n1 | error | | | not implemented: solver not implemented yet |
| S03-n2 | error | | | not implemented: solver not implemented yet |
| S03-n3 | error | | | not implemented: solver not implemented yet |
| B01-n1 | error | | | not implemented: solver not implemented yet |
| B01-n2 | error | | | not implemented: solver not implemented yet |
| B01-n3 | error | | | not implemented: solver not implemented yet |
| S04-d15 | error | | | not implemented: solver not implemented yet |
| S04-d20 | error | | | not implemented: solver not implemented yet |
| S04-d30 | error | | | not implemented: solver not implemented yet |
| S05-d30 | error | | | not implemented: solver not implemented yet |
| S05-d35 | error | | | not implemented: solver not implemented yet |
| S06-d32 | error | | | not implemented: solver not implemented yet |
| S11-d20 | error | | | not implemented: solver not implemented yet |
| S13-d8 | error | | | not implemented: solver not implemented yet |
| S13-d25 | error | | | not implemented: solver not implemented yet |
| S03-d5 | error | | | not implemented: solver not implemented yet |
| S03-d16 | error | | | not implemented: solver not implemented yet |
| B-kzk-000 | error | | | not implemented: solver not implemented yet |
| B-kzk-045 | error | | | not implemented: solver not implemented yet |
| B-kzk-135 | error | | | not implemented: solver not implemented yet |
| B-kzk-180 | error | | | not implemented: solver not implemented yet |
| B-kzk-315 | error | | | not implemented: solver not implemented yet |

## Edit invariants

| Fixture | Edit of | Problems |
| --- | --- | --- |
| S09 | S04 | missing results |
| S10 | S05 | missing results |
