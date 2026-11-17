# Phase 3b: KPI report (step 5: GraphHopper "recommended" + Valhalla "shortest")

Graph build 2026-11-15T00:15:25Z (pinned extract). 54 active fixtures; 4 not yet in scope (S01: later_loops, S02: later_loops, S12: phase_4, S14: later_loops). Measured on the development laptop.

Every number below is measured by the harness from the candidate geometry, independently of the solver's own figures. Conflict objects are checked against brute-force reference values (`tests/kpi/reference.py`).

Pedestrian access is judged twice: the geometry must map-match onto Valhalla pedestrian edges over its whole length (within 1% or 30 m), and no matched OSM way may be unwalkable by its tags in the pinned extract. `edge_walk` exact matching alone is not used as a test: it fails on some of Valhalla's own unmodified pedestrian routes.

**Overall: FAIL**

| KPI | Target | Measured | Pass |
| --- | --- | --- | --- |
| Fixtures solved without error | all | 54 / 54 | yes |
| Outcome classification (ok / over_budget / Case A or B) | 100% | 54 / 54 | yes |
| Distance accuracy, point-to-point | median < 0.5%, p95 < 1.5% | median 0.00%, p95 0.33% (n=89) | yes |
| Reported length matches re-measured geometry | every route, 0.1% / 2 m | 109 / 109 | yes |
| Length consistency (engine vs sphere on its own radius) | every route, 0.1% / 2 m + 0.2 m per edge | 109 / 109 | yes |
| Feasibility: access violations or any ferry | 0 | 0 | yes |
| (info) Geometries that pedestrian edge_walk cannot follow exactly | info only | 73 / 109 (map-matched instead; see method) | yes |
| Over-budget handling: correct conflict objects and candidates | 100% | 6 / 6 | yes |
| Latency per solve | p50 < 2 s, p95 < 5 s | p50 1473 ms, p95 3374 ms | yes |
| Duplication beyond what must_reach stops force, excluding out-and-back | median < 2%, none > 10% | median 0.0%, max 2.9% | yes |
| (info) Raw duplication, including what the stops force | info only | median 0.0%, max 14.8% | yes |
| Direction adherence (share moving away from target, after last stop) | every route < 15% | max 21.9%, 43 / 49 under | **no** |
| Endpoint bearing (bearing-only requests; continue-past-target direction) | within 30° | 28 / 30 within; 2 beyond 30° where an exhaustive search finds nothing closer (network does not permit) | yes |
| Checkpoint compliance (snapped point within 50 m) | 100% | 109 / 109 | yes |
| Alternative diversity (edge overlap, recommended vs shortest) | < 60% | max 59% (n=35) | yes |
| (info) Fixtures returning both alternatives | info only | 35 / 54 (the rest: shortest overlaps recommended by 60% or more) | yes |
| Road suitability, recommended (trunk + primary + motorway share) | < 10% (section 16) | median 3.8%, max 16.5%; 10 over 10% | **no** |
| (info) Trunk/motorway share, recommended | info only | median 0.0%, max 14.3% | yes |
| National-highway flag matches the measured trunk stretch (>= 200 m) | every route | 109 / 109 | yes |
| Edit invariants (scenarios 9, 10) | all hold | 2 / 2 | yes |

## Fixtures

| Fixture | Outcome | ms | Candidates (foot km, error %) | Problems |
| --- | --- | --- | --- | --- |
| S03 | ok | 1440 | recommended/main 10.00 (0.00%); shortest/main 10.05 (0.46%), main road 27% | - |
| S04 | ok | 739 | recommended/main 25.00 (0.00%), main road 5%, away 3%; shortest/main 25.00 (0.00%), main road 29% | - |
| S05 | ok | 1840 | recommended/main 28.00 (0.00%), repeat 11.6% | - |
| S07 | over_budget | 2289 | recommended/full_route 26.07, repeat 11.4%, main road 5%; recommended/cut_at_target 15.00 (0.00%), repeat 14.8% | - |
| S08 | ok | 1008 | recommended/main 50.00 (0.00%), main road 13%, trunk stretch 18 m, away 4%; shortest/main 50.03 (0.07%), main road 89%, trunk stretch 27753 m | - |
| S09 | ok | 2170 | recommended/continue_past_target 25.00 (0.00%), repeat 1.2%, main road 6%, bearing off 2°; recommended/end_at_target 18.33 | - |
| S10 | ok | 1464 | recommended/main 32.00 (0.00%), repeat 10.2% | - |
| S11 | ok | 3636 | recommended/continue_past_target 25.00 (0.00%), main road 5%, bearing off 10°; recommended/end_at_target 12.60, main road 5%; shortest/continue_past_target 25.00 (0.01%), main road 22%, bearing off 3°; shortest/end_at_target 12.60, main road 5% | - |
| S13 | ok | 616 | recommended/main 15.00 (0.00%), main road 7%, trunk stretch 886 m, away 18%; shortest/main 15.07 (0.44%), main road 66%, trunk stretch 8343 m | - |
| S15 | over_budget | 2391 | recommended/full_route 26.07, repeat 11.4%, main road 5%; recommended/cut_at_target 25.00 (0.00%), repeat 11.9%, main road 5% | - |
| B01 | ok | 3497 | recommended/main 20.00 (0.00%), main road 8%, bearing off 11°; shortest/main 20.00 (0.00%), trunk stretch 22 m, bearing off 3° | - |
| B02 | ok | 1726 | recommended/main 12.00 (0.00%), bearing off 5° | - |
| S04-n1 | ok | 656 | recommended/main 25.00 (0.00%), away 4%; shortest/main 25.04 (0.17%), main road 26% | - |
| S04-n2 | ok | 622 | recommended/main 25.00 (0.00%), away 2%; shortest/main 25.03 (0.14%), main road 24% | - |
| S04-n3 | ok | 602 | recommended/main 25.00 (0.00%), away 4%; shortest/main 25.00 (0.00%), main road 32% | - |
| S04-n4 | ok | 625 | recommended/main 25.00 (0.00%), away 5%; shortest/main 24.99 (0.05%), main road 29% | - |
| S05-n1 | ok | 1413 | recommended/main 28.00 (0.00%), repeat 11.6% | - |
| S05-n2 | ok | 1433 | recommended/main 28.00 (0.00%), repeat 11.6% | - |
| S05-n3 | ok | 1869 | recommended/full_route 29.11, repeat 4.0%; recommended/cut_at_target 28.00 (0.00%), repeat 4.2%; shortest/main 27.91 (0.32%), repeat 11.7%, main road 13% | - |
| S05-n4 | ok | 1411 | recommended/main 28.00 (0.00%), repeat 11.6% | - |
| S07-n1 | over_budget | 2273 | recommended/full_route 26.38, repeat 11.3%; recommended/cut_at_target 15.00 (0.00%), repeat 14.8% | - |
| S07-n2 | over_budget | 2183 | recommended/full_route 30.02, repeat 9.9%; recommended/cut_at_target 15.00 (0.00%) | - |
| S08-n1 | ok | 943 | recommended/main 50.00 (0.00%), main road 15%, trunk stretch 18 m, away 4%; shortest/main 50.02 (0.04%), main road 96%, trunk stretch 27753 m | - |
| S08-n2 | ok | 984 | recommended/main 50.00 (0.00%), main road 11%, trunk stretch 18 m, away 6%; shortest/main 49.99 (0.01%), main road 80%, trunk stretch 27753 m | - |
| S11-n1 | ok | 2228 | recommended/continue_past_target 25.00 (0.00%), bearing off 7°; recommended/end_at_target 14.28; shortest/continue_past_target 24.98 (0.09%), main road 15%, bearing off 3°; shortest/end_at_target 13.77 | - |
| S11-n2 | ok | 2308 | recommended/continue_past_target 25.00 (0.00%), bearing off 7°; recommended/end_at_target 11.29; shortest/continue_past_target 25.05 (0.20%), main road 25%, bearing off 2°; shortest/end_at_target 11.29 | - |
| S11-n3 | ok | 3645 | recommended/continue_past_target 25.00 (0.00%), bearing off 11°; recommended/end_at_target 12.51; shortest/continue_past_target 24.97 (0.12%), main road 20%, bearing off 4°; shortest/end_at_target 12.51 | - |
| S13-n1 | ok | 637 | recommended/main 15.00 (0.00%), main road 11%, trunk stretch 886 m, away 18%; shortest/main 15.07 (0.46%), main road 66%, trunk stretch 7614 m | - |
| S13-n2 | ok | 602 | recommended/main 15.00 (0.00%), main road 12%, trunk stretch 886 m, away 18%; shortest/main 15.00 (0.00%), main road 60%, trunk stretch 6637 m | - |
| S13-n3 | ok | 617 | recommended/main 15.00 (0.00%), main road 14%, trunk stretch 886 m, away 20%; shortest/main 14.95 (0.35%), main road 64%, trunk stretch 5752 m | - |
| S15-n1 | over_budget | 2455 | recommended/full_route 27.69, repeat 4.2%; recommended/cut_at_target 25.00 (0.00%), repeat 4.7%; shortest/full_route 27.55, repeat 10.8%; shortest/cut_at_target 24.96 (0.14%), repeat 12.0%, main road 5% | - |
| S15-n2 | ok | 1399 | recommended/main 25.00 (0.00%), repeat 13.0% | - |
| S15-n3 | over_budget | 2488 | recommended/full_route 29.98, repeat 10.0%; recommended/cut_at_target 25.00 (0.00%), repeat 11.9% | - |
| S03-n1 | ok | 1456 | recommended/main 10.00 (0.00%), main road 10%; shortest/main 10.00 (0.00%), main road 89% | - |
| S03-n2 | ok | 1484 | recommended/main 10.00 (0.00%), main road 5%; shortest/main 9.97 (0.32%), main road 32% | - |
| S03-n3 | ok | 1482 | recommended/main 10.00 (0.00%); shortest/main 10.00 (0.00%), main road 27% | - |
| B01-n1 | ok | 1874 | recommended/main 20.05 (0.23%), trunk stretch 372 m, bearing off 2°; shortest/main 20.00 (0.00%), trunk stretch 917 m, bearing off 1° | - |
| B01-n2 | ok | 1860 | recommended/main 20.00 (0.00%), bearing off 6°; shortest/main 20.00 (0.00%), trunk stretch 22 m, bearing off 5° | - |
| B01-n3 | ok | 1821 | recommended/main 20.00 (0.00%), bearing off 5°; shortest/main 19.94 (0.31%), main road 6%, bearing off 4° | - |
| S04-d15 | ok | 630 | recommended/main 15.00 (0.00%) | - |
| S04-d20 | ok | 601 | recommended/main 20.00 (0.00%), main road 7% | - |
| S04-d30 | ok | 1436 | recommended/main 30.00 (0.00%), away 3%; shortest/continue_past_target 30.00 (0.01%), repeat 0.8%, main road 33%, bearing off 6°; shortest/end_at_target 29.15, main road 34% | - |
| S05-d30 | ok | 1394 | recommended/main 30.00 (0.00%), repeat 10.9% | - |
| S05-d35 | ok | 1410 | recommended/main 35.00 (0.00%), repeat 9.3% | - |
| S11-d20 | ok | 3374 | recommended/continue_past_target 20.00 (0.00%), bearing off 21°; recommended/end_at_target 12.60, main road 5% | - |
| S13-d8 | ok | 605 | recommended/main 8.00 (0.00%), main road 13%, trunk stretch 886 m, away 22%; shortest/main 8.00 (0.00%), main road 36%, trunk stretch 1611 m | - |
| S13-d25 | ok | 1462 | recommended/main 25.00 (0.00%), main road 5%, trunk stretch 886 m, away 20%; shortest/continue_past_target 24.92 (0.33%), main road 72%, trunk stretch 16398 m, bearing off 4°; shortest/end_at_target 17.55, main road 71%, trunk stretch 10826 m | - |
| S03-d5 | ok | 1366 | recommended/main 5.00 (0.00%); shortest/main 5.00 (0.00%), main road 31% | - |
| S03-d16 | ok | 2802 | recommended/main 16.00 (0.00%); shortest/main 16.00 (0.00%), main road 22%, trunk stretch 799 m | - |
| B-kzk-000 | ok | 1624 | recommended/main 12.00 (0.00%), main road 16%, bearing off 8° | - |
| B-kzk-045 | ok | 1710 | recommended/main 12.00 (0.00%), bearing off 7°; shortest/main 12.03 (0.21%), main road 20%, bearing off 5° | - |
| B-kzk-135 | ok | 1655 | recommended/main 12.00 (0.00%), bearing off 2°; shortest/main 12.00 (0.00%), main road 76%, bearing off 1° | - |
| B-kzk-180 | ok | 2897 | recommended/main 12.00 (0.00%), bearing off 42° (best possible 39°); shortest/main 12.00 (0.00%), main road 76%, bearing off 39° (best possible 39°) | - |
| B-kzk-315 | ok | 3021 | recommended/main 12.00 (0.00%), main road 12%, bearing off 24°; shortest/main 11.99 (0.05%), main road 83%, bearing off 25° | - |

## Edit invariants

| Fixture | Edit of | Problems |
| --- | --- | --- |
| S09 | S04 | - |
| S10 | S05 | - |
