# Phase 3 spike: building the "fewer main roads" alternative

Pinned Kerala extract (2026-11-15). Valhalla 3.9.2 and GraphHopper 11.1, both on that file. Ferries are excluded in every variant. Measured on the development laptop, Valhalla and GraphHopper running together.

Routes: the 54 fixed origin/destination pairs from Phase 2 plus 5 named pairs (worked-example legs and the Thamarassery road).

**Yardstick.** Every geometry is matched onto Valhalla's pedestrian edges (`trace_attributes`, `edge_walk`, falling back to map matching), which gives road class and edge identity. Main-road metres are the ellipsoid length of matched trunk and primary edges. Lengths are ellipsoid lengths of each variant's own geometry.

**Pedestrian access** is judged twice: (1) Valhalla pedestrian `map_snap` matching must cover the whole geometry (within 1% or 30 m); map_snap only uses edges pedestrians may use, so a route over a `foot=no` edge leaves a gap; and (2) no matched OSM way may be unwalkable by its tags in the pinned extract (`foot=no/private`, `access=no/private` without a foot override, or a highway type that is not for walking). `edge_walk` is NOT an access check: tested on the Feroke Old Bridge (`foot=no`), pedestrian `edge_walk` accepted a bicycle route across it while pedestrian `map_snap` left 302 m of it unmatched.

## Summary

| | Valhalla pedestrian (baseline) | (a) Valhalla bicycle, use_roads 0 | (b) GraphHopper foot, trunk/primary x0.2 |
| --- | --- | --- | --- |
| Routes compared | 59 (0 without a route) | 59 (0 without a route) | 59 (0 without a route) |
| Trunk + primary share, median route | 14.9% | 2.0% | 0.0% |
| Trunk + primary metres, all routes | 244.0 km (-0% vs baseline) | 81.5 km (-67% vs baseline) | 5.8 km (-98% vs baseline) |
| Routes where baseline has > 200 m of main road: main-road metres at least halved | 0 of 42 | 28 of 42 | 41 of 42 |
| Extra length vs baseline, median / p90 / max | +0.0% / +0.0% / +0.0% | +5.7% / +16.8% / +48.7% | +6.8% / +24.5% / +51.0% |
| Edge overlap with baseline, median (alternatives kept below 60%) | 100% (0 routes under 60%) | 37% (44 routes under 60%) | 18% (46 routes under 60%) |
| Pedestrian map_snap covers less than the geometry (1% / 30 m): likely access violation | 3 routes | 4 routes | 0 routes |
| (info) pedestrian edge_walk cannot follow the geometry exactly | 0 routes | 0 routes | 59 routes |
| Uses an OSM way that is unwalkable by its tags | 0 routes | 2 routes | 0 routes |
| Latency p50 / p95 (a: bicycle route + pedestrian re-check) | 53 / 89 ms | 176 / 231 ms | 13 / 42 ms |

## Cross-engine length check (GraphHopper plain foot against Valhalla pedestrian)

Over 59 routes, the GraphHopper route length differs from Valhalla's by a median 5.1% (p90 17.6%, max 38.2%). Both lengths are ellipsoid lengths of each engine's geometry; differences are path choices, not measurement. This is the blueprint's deferred 50-pair cross-check, done on the same graph.

GraphHopper plain foot: trunk + primary 0.5% median share; 0 routes with a map_snap coverage gap, 0 using a tag-unwalkable way.

Tag-unwalkable ways used by (a): [155988679](https://www.openstreetmap.org/way/155988679) (`highway=secondary`, `foot=no`)

## Every route

| Pair | Baseline (m) | main (m) | (a) length (m) | main (m) | walkable | (b) length (m) | main (m) | walkable | GH foot (m) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pair 0 | 1209 | 0 | 1278 | 0 | yes | 1209 | 0 | yes | 1209 |
| pair 1 | 1222 | 0 | 1222 | 0 | yes | 1221 | 0 | yes | 1221 |
| pair 2 | 971 | 0 | 971 | 0 | yes | 968 | 0 | yes | 968 |
| pair 3 | 1564 | 0 | 1564 | 0 | yes | 1564 | 0 | yes | 1564 |
| pair 4 | 819 | 0 | 819 | 0 | yes | 819 | 0 | yes | 819 |
| pair 5 | 1311 | 0 | 1317 | 0 | yes | 1311 | 0 | yes | 1311 |
| pair 6 | 1207 | 0 | 1249 | 0 | yes | 1208 | 0 | yes | 1208 |
| pair 7 | 1403 | 0 | 1587 | 29 | **no** (1676 m covered) | 1402 | 0 | yes | 1402 |
| pair 8 | 1323 | 822 | 1323 | 822 | yes | 961 | 26 | yes | 961 |
| pair 9 | 2053 | 689 | 2113 | 413 | yes | 2836 | 0 | yes | 2836 |
| pair 10 | 5841 | 2026 | 6867 | 207 | yes | 6734 | 111 | yes | 6867 |
| pair 11 | 4022 | 2174 | 5398 | 0 | yes | 5376 | 0 | yes | 5376 |
| pair 12 | 7108 | 0 | 7108 | 0 | yes | 7107 | 0 | yes | 7107 |
| pair 13 | 2254 | 0 | 2254 | 0 | yes | 2253 | 0 | yes | 2253 |
| pair 14 | 5154 | 2177 | 6521 | 1502 | yes | 7170 | 696 | yes | 7093 |
| pair 15 | 6624 | 1660 | 7416 | 0 | yes | 6125 | 0 | yes | 6125 |
| pair 16 | 2856 | 0 | 4246 | 0 | yes | 2819 | 0 | yes | 2819 |
| pair 17 | 8423 | 0 | 9172 | 0 | yes | 8423 | 0 | yes | 8423 |
| pair 18 | 3619 | 0 | 3821 | 0 | yes | 3648 | 0 | yes | 3648 |
| pair 19 | 5706 | 0 | 5706 | 0 | yes | 5705 | 0 | yes | 5705 |
| pair 20 | 4751 | 0 | 5539 | 0 | yes | 4717 | 0 | yes | 4717 |
| pair 21 | 6594 | 2619 | 6862 | 1026 | yes | 8597 | 16 | yes | 7532 |
| pair 22 | 19081 | 7856 | 20609 | 2362 | **no** (20877 m covered) | 19930 | 85 | yes | 19165 |
| pair 23 | 15831 | 0 | 16860 | 0 | yes | 15903 | 0 | yes | 15903 |
| pair 24 | 9997 | 616 | 12462 | 230 | yes | 11728 | 28 | yes | 10197 |
| pair 25 | 18975 | 597 | 19617 | 597 | yes | 19930 | 4 | yes | 19336 |
| pair 26 | 9970 | 1484 | 11092 | 0 | yes | 10234 | 0 | yes | 10234 |
| pair 27 | 16673 | 0 | 17156 | 0 | yes | 16972 | 0 | yes | 16972 |
| pair 28 | 13345 | 7428 | 14717 | 412 | yes | 14589 | 27 | yes | 14589 |
| pair 29 | 19693 | 5361 | 20256 | 4897 | yes | 24056 | 443 | yes | 20652 |
| pair 30 | 14615 | 5344 | 14770 | 5036 | yes | 15869 | 21 | yes | 15776 |
| pair 31 | 14869 | 1520 | 17346 | 2636 | yes | 18248 | 5 | yes | 15264 |
| pair 32 | 17744 | 4779 | 18697 | 1581 | yes | 18340 | 27 | yes | 18340 |
| pair 33 | 17275 | 3669 | 18276 | 5 | yes | 19821 | 24 | yes | 19510 |
| pair 34 | 23314 | 12074 | 23323 | 909 | yes | 23621 | 257 | yes | 23621 |
| pair 35 | 26296 | 9081 | 27141 | 486 | yes | 30498 | 4 | yes | 28780 |
| pair 36 | 25972 | 593 | 27613 | 711 | **no** (27926 m covered) | 26655 | 0 | yes | 27660 |
| pair 37 | 35433 | 17647 | 40471 | 813 | yes | 36849 | 129 | yes | 32746 |
| pair 38 | 24771 | 8845 | 26130 | 5 | yes | 26854 | 5 | yes | 26854 |
| pair 39 | 18438 | 5076 | 19987 | 486 | yes | 20499 | 81 | yes | 20444 |
| pair 40 | 25112 | 257 | 25191 | 257 | yes | 26490 | 4 | yes | 25120 |
| pair 41 | 24770 | 4633 | 27425 | 6245 | yes | 29399 | 5 | yes | 26021 |
| pair 42 | 22735 | 14483 | 26078 | 8500 | yes | 30404 | 34 | yes | 29459 |
| pair 43 | 21933 | 5093 | 23150 | 2192 | yes | 25274 | 42 | yes | 22990 |
| pair 44 | 50185 | 4504 | 57061 | 385 | yes | 56696 | 4 | yes | 54548 |
| pair 45 | 43777 | 2548 | 51119 | 1045 | yes | 50486 | 0 | yes | 48337 |
| pair 46 | 32793 | 2874 | 36360 | 1281 | yes | 36801 | 180 | yes | 34803 |
| pair 47 | 49712 | 20234 | 52472 | 3424 | yes | 58335 | 61 | yes | 55360 |
| pair 48 | 38779 | 5095 | 44579 | 958 | yes | 43529 | 163 | yes | 42009 |
| pair 49 | 41361 | 26909 | 45489 | 14687 | yes | 62455 | 827 | yes | 49127 |
| pair 50 | 29508 | 1192 | 30919 | 1192 | yes | 30734 | 59 | yes | 30734 |
| pair 51 | 38312 | 7815 | 42515 | 1536 | yes | 42790 | 163 | yes | 41383 |
| pair 52 | 32193 | 10220 | 36052 | 3438 | yes | 34380 | 70 | yes | 34646 |
| pair 53 | 33125 | 257 | 33882 | 818 | yes | 35189 | 4 | yes | 33820 |
| start_south_of_kadalundi to kozhikode | 29154 | 9795 | 29133 | 4347 | yes **tags** | 35190 | 748 | yes | 34019 |
| beypore to kozhikode | 9206 | 2970 | 10782 | 0 | yes | 10647 | 0 | yes | 10647 |
| feroke to kozhikode | 11018 | 9107 | 11556 | 4342 | yes | 13714 | 644 | yes | 12638 |
| chaliyam to beypore | 9369 | 1262 | 7558 | 0 | **no** (7269 m covered) **tags** | 10386 | 644 | yes | 10386 |
| kozhikode to thamarassery | 31723 | 10593 | 34522 | 1720 | yes | 37493 | 206 | yes | 35367 |
