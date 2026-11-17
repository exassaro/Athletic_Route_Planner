# Phase 3b: KPI report (detour cap; direction adherence judged on shortest)

Graph build 2026-11-15T00:15:25Z (pinned extract). 74 active fixtures; 4 not yet in scope (S01: later_loops, S02: later_loops, S12: phase_4, S14: later_loops). Measured on the development laptop.

Every number below is measured by the harness from the candidate geometry, independently of the solver's own figures. Conflict objects are checked against brute-force reference values (`tests/kpi/reference.py`).

Pedestrian access is judged twice: the geometry must map-match onto Valhalla pedestrian edges over its whole length (within 1% or 30 m), and no matched OSM way may be unwalkable by its tags in the pinned extract. `edge_walk` exact matching alone is not used as a test: it fails on some of Valhalla's own unmodified pedestrian routes.

**Overall: PASS**

| KPI | Target | Measured | Pass |
| --- | --- | --- | --- |
| Fixtures solved without error | all | 74 / 74 | yes |
| Outcome classification (ok / over_budget / Case A or B) | 100% | 74 / 74 | yes |
| Distance accuracy, point-to-point | median < 0.5%, p95 < 1.5% | median 0.00%, p95 0.35% (n=131) | yes |
| Reported length matches re-measured geometry | every route, 0.1% / 2 m | 161 / 161 | yes |
| Length consistency (engine vs sphere on its own radius) | every route, 0.1% / 2 m + 0.2 m per edge | 161 / 161 | yes |
| Feasibility: access violations or any ferry | 0 | 0 | yes |
| (info) Geometries that pedestrian edge_walk cannot follow exactly | info only | 100 / 161 (map-matched instead; see method) | yes |
| Over-budget handling: correct conflict objects and candidates | 100% | 2 / 2 | yes |
| Latency per solve | p50 < 2 s, p95 < 5 s | p50 1929 ms, p95 3936 ms | yes |
| Duplication beyond what must_reach stops force, excluding out-and-back | median < 2%, none > 10% | median 0.0%, max 2.9% | yes |
| (info) Raw duplication, including what the stops force | info only | median 0.0%, max 14.8% | yes |
| Direction adherence, shortest (share moving away from target, after last stop) | every route < 15% | max 12.0%, 37 / 37 under | yes |
| (info) Direction adherence, recommended | info only | max 25.9%, 45 / 46 under 15% | yes |
| Endpoint bearing (bearing-only requests; continue-past-target direction) | within 30° | 35 / 37 within; 2 beyond 30° where an exhaustive search finds nothing closer (network does not permit) | yes |
| (info) Pass-near walking distance to the route | info only | median 606 m, max 984 m (n=143) | yes |
| No spur to reach a pass-near stop (unless flagged) | 0 | 0 | yes |
| Checkpoint compliance (must_reach 50 m; pass near 1 km on foot; bridge/road used) | 100% | 161 / 161 | yes |
| Recommended alternative returned (GraphHopper, the default) | every solved fixture | 74 / 74 | yes |
| Alternative diversity (edge overlap, recommended vs shortest) | < 60% | max 59% (n=58) | yes |
| (info) Fixtures returning both alternatives | info only | 58 / 74 (the rest: shortest overlaps recommended by 60% or more) | yes |
| Road suitability, recommended (trunk + motorway share) | < 10%, or flagged as a national highway | median 0.0%, max 46.1%; 0 over 10% without the flag | yes |
| (info) Main-road share, recommended (trunk + primary + motorway) | info only | median 4.4%, max 46.1% | yes |
| National-highway flag matches the measured trunk stretch (>= 200 m) | every route | 161 / 161 | yes |
| Avoid list respected (no avoided way, place or area) | every route | 161 / 161 | yes |
| Expected stop order (acceptance) | every route | 5 / 5 | yes |
| Edit invariants (scenarios 9, 10; via, avoid, must_use edits hold the distance) | all hold | 5 / 5 | yes |

## Fixtures

| Fixture | Outcome | ms | Candidates (foot km, error %) | Problems |
| --- | --- | --- | --- | --- |
| S03 | ok | 1412 | recommended/main 10.00 (0.00%); shortest/main 10.05 (0.46%), main road 27% | - |
| S04 | ok | 685 | recommended/main 25.00 (0.00%), main road 5%, away 3%; shortest/main 25.00 (0.00%), main road 29% | - |
| S05 | ok | 3681 | recommended/main 28.00 (0.00%), repeat 1.3%; shortest/main 28.00 (0.00%), main road 7% | - |
| S07 | over_budget | 3604 | recommended/full_route 22.47, repeat 1.6%, main road 6%; recommended/cut_at_target 15.00 (0.00%), repeat 2.3% | - |
| S08 | ok | 1312 | recommended/main 50.00 (0.00%), main road 13%, trunk stretch 18 m, away 4%; shortest/main 50.03 (0.07%), main road 89%, trunk stretch 27753 m | - |
| S09 | ok | 2097 | recommended/continue_past_target 25.00 (0.00%), repeat 1.2%, main road 6%, bearing off 2°; recommended/end_at_target 18.33 | - |
| S10 | ok | 3895 | recommended/main 32.00 (0.00%), repeat 1.1%; shortest/main 32.00 (0.00%), main road 6% | - |
| S11 | ok | 3732 | recommended/continue_past_target 25.00 (0.00%), main road 5%, bearing off 10°; recommended/end_at_target 12.60, main road 5%; shortest/continue_past_target 25.00 (0.01%), main road 22%, bearing off 3°; shortest/end_at_target 12.60, main road 5% | - |
| S13 | ok | 1325 | recommended/main 15.00 (0.00%), main road 32%, trunk stretch 3081 m, away 5%; shortest/main 15.07 (0.44%), main road 66%, trunk stretch 8343 m | - |
| S15 | ok | 3936 | recommended/main 25.00 (0.00%), repeat 1.4%, main road 5% | - |
| S05m | ok | 2073 | recommended/main 28.00 (0.00%), repeat 11.6% | - |
| S07m | over_budget | 2346 | recommended/full_route 26.07, repeat 11.4%, main road 5%; recommended/cut_at_target 15.00 (0.00%), repeat 14.8% | - |
| S15m | over_budget | 2359 | recommended/full_route 26.07, repeat 11.4%, main road 5%; recommended/cut_at_target 25.00 (0.00%), repeat 11.9%, main road 5% | - |
| B01 | ok | 3741 | recommended/main 20.00 (0.00%), main road 8%, bearing off 11°; shortest/main 20.00 (0.00%), trunk stretch 22 m, bearing off 3° | - |
| B02 | ok | 1816 | recommended/main 12.00 (0.00%), bearing off 5° | - |
| E01 | ok | 1163 | recommended/main 25.00 (0.00%), main road 5%, away 3%; shortest/main 25.00 (0.00%), main road 29% | - |
| E02 | ok | 641 | recommended/main 25.00 (0.00%), trunk stretch 475 m, away 15%; shortest/main 24.93 (0.27%), main road 14%, trunk stretch 2843 m, away 12% | - |
| E03 | ok | 1299 | recommended/main 25.00 (0.00%), main road 5%, away 3%; shortest/main 25.00 (0.00%), main road 29% | - |
| A01 | ok | 3936 | recommended/main 25.00 (0.00%), main road 6%; shortest/continue_past_target 25.05 (0.21%), repeat 0.6%, main road 17%, bearing off 21°; shortest/end_at_target 24.07, main road 18% | - |
| A02 | over_budget | 3917 | recommended/full_route 22.26; recommended/cut_at_target 20.00 (0.00%); shortest/full_route 21.74, main road 17%; shortest/cut_at_target 20.00 (0.00%), main road 9% | - |
| X01 | ok | 1178 | recommended/main 12.00 (0.00%), main road 24%, away 3%; shortest/main 12.00 (0.02%), main road 45%, trunk stretch 129 m | - |
| X02 | ok | 3092 | recommended/full_route 13.13, main road 11%, trunk stretch 105 m; recommended/cut_at_target 10.00 (0.00%), main road 11%, trunk stretch 105 m; shortest/main 10.10 (1.00%), main road 42%, trunk stretch 2754 m | - |
| X03 | ok | 2430 | recommended/main 25.00 (0.00%), away 7%; shortest/main 25.00 (0.01%), main road 71%, trunk stretch 6568 m | - |
| X04 | ok | 2037 | recommended/main 12.00 (0.00%), bearing off 2°; shortest/main 12.00 (0.00%), main road 98%, bearing off 1° | - |
| X05 | ok | 688 | recommended/main 15.00 (0.00%), main road 5%, away 3%; shortest/main 15.07 (0.48%), main road 68% | - |
| X06 | ok | 3576 | recommended/end_at_target 6.80 | - |
| X07 | ok | 2615 | recommended/main 22.00 (0.00%), main road 7%, trunk stretch 57 m; shortest/continue_past_target 22.00 (0.00%), repeat 0.7%, main road 95%, trunk stretch 14137 m, bearing off 17°; shortest/end_at_target 21.45, main road 97%, trunk stretch 14137 m | - |
| X08 | ok | 1527 | recommended/main 10.00 (0.00%); shortest/main 10.04 (0.44%), main road 65%, trunk stretch 3271 m | - |
| X09 | ok | 1536 | recommended/full_route 23.44, trunk stretch 75 m; recommended/cut_at_target 15.00 (0.00%); shortest/main 15.00 (0.00%), main road 100%, trunk stretch 12503 m | - |
| X10 | ok | 1088 | recommended/main 20.00 (0.00%), main road 6%, away 26%; shortest/main 19.98 (0.08%), main road 47% | - |
| S04-n1 | ok | 680 | recommended/main 25.00 (0.00%), away 4%; shortest/main 25.04 (0.17%), main road 26% | - |
| S04-n2 | ok | 679 | recommended/main 25.00 (0.00%), away 2%; shortest/main 25.03 (0.14%), main road 24% | - |
| S04-n3 | ok | 646 | recommended/main 25.00 (0.00%), away 4%; shortest/main 25.00 (0.00%), main road 32% | - |
| S04-n4 | ok | 638 | recommended/main 25.00 (0.00%), away 5%; shortest/main 24.99 (0.05%), main road 29% | - |
| S05-n1 | ok | 4050 | recommended/main 28.00 (0.00%), repeat 1.3%; shortest/main 28.00 (0.00%), repeat 2.9% | - |
| S05-n2 | ok | 3971 | recommended/main 28.00 (0.00%), repeat 1.3%; shortest/main 28.00 (0.00%) | - |
| S05-n3 | ok | 3795 | recommended/main 28.00 (0.00%), repeat 1.3%, main road 8%; shortest/main 28.00 (0.00%), main road 13% | - |
| S05-n4 | ok | 3844 | recommended/main 28.00 (0.00%), repeat 1.3%; shortest/main 28.00 (0.00%) | - |
| S07-n1 | over_budget | 3709 | recommended/full_route 22.77, repeat 1.5%; recommended/cut_at_target 15.00 (0.00%), repeat 2.3% | - |
| S07-n2 | over_budget | 3480 | recommended/full_route 26.41, repeat 1.3%; recommended/cut_at_target 15.00 (0.00%); shortest/full_route 28.36, main road 15%; shortest/cut_at_target 15.00 (0.00%), main road 20% | - |
| S08-n1 | ok | 1208 | recommended/main 50.00 (0.00%), main road 15%, trunk stretch 18 m, away 4%; shortest/main 50.02 (0.04%), main road 96%, trunk stretch 27753 m | - |
| S08-n2 | ok | 1117 | recommended/main 50.00 (0.00%), main road 11%, trunk stretch 18 m, away 6%; shortest/main 49.99 (0.01%), main road 80%, trunk stretch 27753 m | - |
| S11-n1 | ok | 2055 | recommended/continue_past_target 25.00 (0.00%), bearing off 7°; recommended/end_at_target 14.28; shortest/continue_past_target 24.98 (0.09%), main road 15%, bearing off 3°; shortest/end_at_target 13.77 | - |
| S11-n2 | ok | 2171 | recommended/continue_past_target 25.00 (0.00%), bearing off 7°; recommended/end_at_target 11.29; shortest/continue_past_target 25.05 (0.20%), main road 25%, bearing off 2°; shortest/end_at_target 11.29 | - |
| S11-n3 | ok | 3640 | recommended/continue_past_target 25.00 (0.00%), bearing off 11°; recommended/end_at_target 12.51; shortest/continue_past_target 24.97 (0.12%), main road 20%, bearing off 4°; shortest/end_at_target 12.51 | - |
| S13-n1 | ok | 1306 | recommended/main 15.00 (0.00%), main road 32%, trunk stretch 2349 m, away 3%; shortest/main 15.07 (0.46%), main road 66%, trunk stretch 7614 m | - |
| S13-n2 | ok | 1305 | recommended/main 15.00 (0.00%), main road 26%, trunk stretch 2411 m, away 5%; shortest/main 15.00 (0.00%), main road 60%, trunk stretch 6637 m | - |
| S13-n3 | ok | 1349 | recommended/main 15.00 (0.00%), main road 30%, trunk stretch 3750 m, away 3%; shortest/main 14.95 (0.35%), main road 64%, trunk stretch 5752 m | - |
| S15-n1 | ok | 3825 | recommended/main 25.00 (0.00%), repeat 1.4% | - |
| S15-n2 | ok | 3790 | recommended/main 25.00 (0.00%), repeat 1.4%; shortest/main 25.00 (0.00%), main road 5% | - |
| S15-n3 | over_budget | 3660 | recommended/full_route 26.38, repeat 1.3%; recommended/cut_at_target 25.00 (0.00%), repeat 1.4%; shortest/full_route 28.33, main road 15%; shortest/cut_at_target 25.00 (0.00%), main road 16% | - |
| S03-n1 | ok | 1570 | recommended/main 10.00 (0.00%), main road 10%; shortest/main 10.00 (0.00%), main road 89% | - |
| S03-n2 | ok | 1542 | recommended/main 10.00 (0.00%), main road 5%; shortest/main 9.97 (0.32%), main road 32% | - |
| S03-n3 | ok | 1577 | recommended/main 10.00 (0.00%); shortest/main 10.00 (0.00%), main road 27% | - |
| B01-n1 | ok | 1930 | recommended/main 20.05 (0.23%), trunk stretch 372 m, bearing off 2°; shortest/main 20.00 (0.00%), trunk stretch 917 m, bearing off 1° | - |
| B01-n2 | ok | 1928 | recommended/main 20.00 (0.00%), bearing off 6°; shortest/main 20.00 (0.00%), trunk stretch 22 m, bearing off 5° | - |
| B01-n3 | ok | 1908 | recommended/main 20.00 (0.00%), bearing off 5°; shortest/main 19.94 (0.31%), main road 6%, bearing off 4° | - |
| S15m-n1 | ok | 1816 | recommended/main 25.00 (0.00%), repeat 13.0% | - |
| S15m-n2 | ok | 1710 | recommended/main 25.00 (0.00%), repeat 13.0% | - |
| S04-d15 | ok | 627 | recommended/main 15.00 (0.00%) | - |
| S04-d20 | ok | 618 | recommended/main 20.00 (0.00%), main road 7% | - |
| S04-d30 | ok | 1368 | recommended/main 30.00 (0.00%), away 3%; shortest/continue_past_target 30.00 (0.01%), repeat 0.8%, main road 33%, bearing off 6°; shortest/end_at_target 29.15, main road 34% | - |
| S05-d30 | ok | 3811 | recommended/main 29.99 (0.02%), repeat 1.2%; shortest/main 30.00 (0.00%), main road 7% | - |
| S05-d35 | ok | 5264 | recommended/continue_past_target 35.00 (0.00%), repeat 1.8%, bearing off 7°; recommended/end_at_target 32.19, repeat 1.1%; shortest/continue_past_target 35.01 (0.03%), repeat 0.4%, main road 6%, bearing off 19°; shortest/end_at_target 34.72, main road 6% | - |
| S11-d20 | ok | 3271 | recommended/continue_past_target 20.00 (0.00%), bearing off 21°; recommended/end_at_target 12.60, main road 5% | - |
| S13-d8 | ok | 1275 | recommended/main 8.00 (0.00%), main road 21%, trunk stretch 1611 m, away 6%; shortest/main 8.00 (0.00%), main road 36%, trunk stretch 1611 m | - |
| S13-d25 | ok | 5803 | recommended/continue_past_target 25.00 (0.00%), main road 36%, trunk stretch 7412 m, bearing off 12°; recommended/end_at_target 18.98, main road 46%, trunk stretch 7059 m, away 4%; shortest/continue_past_target 24.92 (0.33%), main road 72%, trunk stretch 16398 m, bearing off 4°; shortest/end_at_target 17.55, main road 71%, trunk stretch 10826 m | - |
| S03-d5 | ok | 1435 | recommended/main 5.00 (0.00%); shortest/main 5.00 (0.00%), main road 31% | - |
| S03-d16 | ok | 2800 | recommended/main 16.00 (0.00%); shortest/main 16.00 (0.00%), main road 22%, trunk stretch 799 m | - |
| B-kzk-000 | ok | 1839 | recommended/main 12.00 (0.00%), main road 16%, bearing off 8° | - |
| B-kzk-045 | ok | 1819 | recommended/main 12.00 (0.00%), bearing off 7°; shortest/main 12.03 (0.21%), main road 20%, bearing off 5° | - |
| B-kzk-135 | ok | 1701 | recommended/main 12.00 (0.00%), bearing off 2°; shortest/main 12.00 (0.00%), main road 76%, bearing off 1° | - |
| B-kzk-180 | ok | 3066 | recommended/main 12.00 (0.00%), bearing off 42° (best possible 39°); shortest/main 12.00 (0.00%), main road 76%, bearing off 39° (best possible 39°) | - |
| B-kzk-315 | ok | 3164 | recommended/main 12.00 (0.00%), main road 12%, bearing off 24°; shortest/main 11.99 (0.05%), main road 83%, bearing off 25° | - |

## Edit invariants

| Fixture | Edit of | Problems |
| --- | --- | --- |
| S09 | S04 | - |
| S10 | S05 | - |
| E01 | S04 | - |
| E02 | S04 | - |
| E03 | S04 | - |
