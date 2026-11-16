# Phase 2: engine length versus geometry length

Valhalla 3.9.2-2dc688aa7, pedestrian costing, OSM data 2026-11-15T00:15:25Z. 54 fixed pairs (seed 20261116) sampled from walkable OSM ways around Kozhikode.

Engine length is `trip.summary.length`. Geometry length is the geodesic length on the WGS84 ellipsoid (pyproj) of the route shape decoded at polyline precision 6.

## Summary

- Routes measured: 54; no route found: 0
- Largest gap: 0.487%; 95th percentile: 0.452%; median: 0.329%
- Routes over the 0.5% limit: 0
- Largest absolute difference: 212.9 m

**PASS** against the 0.5% rule.

## By routed length

| Engine length band (km) | Routes | Max gap (%) | Median gap (%) | Max abs difference (m) |
| --- | --- | --- | --- | --- |
| 0 to 1 | 2 | 0.343 | 0.291 | 3.3 |
| 1 to 5 | 13 | 0.365 | 0.311 | 13.9 |
| 5 to 15 | 12 | 0.482 | 0.326 | 61.2 |
| 15 to 30 | 17 | 0.487 | 0.324 | 122.4 |
| over 30 | 10 | 0.445 | 0.420 | 212.9 |

## Diagnostic: sphere versus ellipsoid

The same shapes measured on a sphere of radius 6,378,137 m (the WGS84 semi-major axis). If the engine measures on a sphere, its length should match this closely and the gap to the ellipsoid should grow with how north-south a route runs.

- Engine longer than ellipsoid geometry on 54 of 54 routes
- Engine versus sphere length: max gap 0.087%, median 0.017%
- Engine versus ellipsoid length: max gap 0.487%, median 0.329%

| North-south share of route | Routes | Median gap to ellipsoid (%) | Median gap to sphere (%) |
| --- | --- | --- | --- |
| 0.00 to 0.35 | 6 | 0.112 | 0.017 |
| 0.35 to 0.50 | 14 | 0.276 | 0.031 |
| 0.50 to 0.65 | 31 | 0.405 | 0.013 |
| 0.65 to 1.00 | 3 | 0.482 | 0.025 |

**Reading.** The gap is not noise. The engine is longer than the ellipsoid measurement on every route, agrees closely with a spherical measurement, and the gap rises with the north-south share. That pattern is what a spherical earth model produces at this latitude (about 11° N), where a degree of latitude is shorter on the ellipsoid than on a sphere of equatorial radius. Consequences for Phase 3: (1) take the route length from the geometry on the ellipsoid, not from the engine summary, when cutting a route at an exact distance; (2) the 0.5% consistency rule leaves almost no headroom here and a route running due north-south could exceed it with nothing wrong; (3) matrix distances carry the same bias, which is harmless for ordering stops but matters when a feasibility decision is within about 0.5% of the budget.

## Every route

| Pair | Engine (m) | Geometry, ellipsoid (m) | Engine minus geometry (m) | Gap (%) | Sphere (m) | Gap to sphere (%) | N-S share | Shape points | Latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | 821 | 819.0 | +2.0 | 0.239 | 821.7 | 0.087 | 0.52 | 29 | 47 |
| 2 | 974 | 970.7 | +3.3 | 0.343 | 974.2 | 0.018 | 0.57 | 88 | 50 |
| 6 | 1209 | 1207.0 | +2.0 | 0.165 | 1209.2 | 0.017 | 0.33 | 37 | 48 |
| 0 | 1213 | 1209.2 | +3.8 | 0.317 | 1212.1 | 0.074 | 0.42 | 42 | 48 |
| 1 | 1226 | 1221.5 | +4.5 | 0.365 | 1225.9 | 0.006 | 0.55 | 53 | 48 |
| 5 | 1315 | 1311.3 | +3.7 | 0.286 | 1314.1 | 0.068 | 0.39 | 54 | 47 |
| 8 | 1327 | 1322.8 | +4.2 | 0.316 | 1326.3 | 0.055 | 0.45 | 110 | 47 |
| 7 | 1406 | 1402.5 | +3.5 | 0.248 | 1406.6 | 0.041 | 0.46 | 39 | 48 |
| 3 | 1565 | 1563.5 | +1.5 | 0.094 | 1566.2 | 0.074 | 0.33 | 42 | 49 |
| 9 | 2059 | 2052.6 | +6.4 | 0.311 | 2058.3 | 0.036 | 0.46 | 44 | 49 |
| 13 | 2261 | 2253.6 | +7.4 | 0.330 | 2260.8 | 0.010 | 0.51 | 112 | 47 |
| 16 | 2865 | 2856.2 | +8.8 | 0.307 | 2866.4 | 0.049 | 0.55 | 84 | 50 |
| 18 | 3631 | 3619.0 | +12.0 | 0.331 | 3630.5 | 0.013 | 0.51 | 146 | 49 |
| 11 | 4036 | 4022.1 | +13.9 | 0.345 | 4038.4 | 0.060 | 0.60 | 166 | 51 |
| 20 | 4764 | 4751.0 | +13.0 | 0.273 | 4767.3 | 0.069 | 0.53 | 147 | 50 |
| 14 | 5179 | 5154.1 | +24.9 | 0.482 | 5179.5 | 0.009 | 0.69 | 111 | 49 |
| 19 | 5729 | 5705.9 | +23.1 | 0.405 | 5729.1 | 0.001 | 0.60 | 249 | 51 |
| 10 | 5867 | 5841.2 | +25.8 | 0.442 | 5866.4 | 0.011 | 0.63 | 129 | 49 |
| 21 | 6606 | 6594.5 | +11.5 | 0.175 | 6608.1 | 0.031 | 0.40 | 223 | 51 |
| 15 | 6644 | 6624.1 | +19.9 | 0.300 | 6641.9 | 0.032 | 0.46 | 158 | 48 |
| 12 | 7133 | 7108.0 | +25.0 | 0.352 | 7134.9 | 0.027 | 0.57 | 368 | 50 |
| 17 | 8446 | 8422.7 | +23.3 | 0.276 | 8447.0 | 0.012 | 0.47 | 178 | 49 |
| 26 | 9997 | 9969.8 | +27.2 | 0.273 | 10000.7 | 0.037 | 0.50 | 284 | 56 |
| 24 | 10038 | 9997.0 | +41.0 | 0.411 | 10036.2 | 0.018 | 0.59 | 323 | 50 |
| 28 | 13377 | 13344.6 | +32.4 | 0.243 | 13380.7 | 0.027 | 0.46 | 443 | 51 |
| 30 | 14630 | 14615.2 | +14.8 | 0.101 | 14632.3 | 0.016 | 0.28 | 366 | 58 |
| 31 | 14930 | 14868.8 | +61.2 | 0.412 | 14928.3 | 0.012 | 0.59 | 582 | 53 |
| 23 | 15881 | 15830.7 | +50.3 | 0.318 | 15886.4 | 0.034 | 0.54 | 438 | 51 |
| 27 | 16743 | 16673.3 | +69.7 | 0.418 | 16742.6 | 0.003 | 0.61 | 745 | 54 |
| 33 | 17311 | 17275.5 | +35.5 | 0.206 | 17309.4 | 0.009 | 0.37 | 617 | 59 |
| 32 | 17794 | 17743.7 | +50.3 | 0.284 | 17793.2 | 0.004 | 0.47 | 558 | 53 |
| 39 | 18461 | 18438.4 | +22.6 | 0.123 | 18464.1 | 0.017 | 0.32 | 464 | 59 |
| 25 | 19037 | 18974.8 | +62.2 | 0.328 | 19039.5 | 0.013 | 0.53 | 813 | 63 |
| 22 | 19143 | 19081.2 | +61.8 | 0.324 | 19146.5 | 0.018 | 0.53 | 573 | 57 |
| 29 | 19741 | 19692.7 | +48.3 | 0.245 | 19744.9 | 0.020 | 0.45 | 565 | 57 |
| 43 | 22024 | 21933.4 | +90.6 | 0.413 | 22024.8 | 0.004 | 0.61 | 770 | 59 |
| 42 | 22791 | 22734.7 | +56.3 | 0.248 | 22799.2 | 0.036 | 0.47 | 525 | 68 |
| 34 | 23418 | 23314.2 | +103.8 | 0.445 | 23424.0 | 0.026 | 0.67 | 438 | 54 |
| 38 | 24802 | 24771.1 | +30.9 | 0.125 | 24805.4 | 0.014 | 0.32 | 652 | 63 |
| 41 | 24882 | 24770.2 | +111.8 | 0.452 | 24881.8 | 0.001 | 0.64 | 960 | 63 |
| 40 | 25234 | 25111.6 | +122.4 | 0.487 | 25227.6 | 0.025 | 0.66 | 588 | 60 |
| 36 | 26091 | 25972.2 | +118.8 | 0.457 | 26085.3 | 0.022 | 0.63 | 841 | 55 |
| 35 | 26403 | 26296.0 | +107.0 | 0.407 | 26397.6 | 0.020 | 0.58 | 1074 | 62 |
| 50 | 29538 | 29507.9 | +30.1 | 0.102 | 29543.0 | 0.017 | 0.28 | 646 | 58 |
| 52 | 32323 | 32192.5 | +130.5 | 0.405 | 32319.8 | 0.010 | 0.59 | 1204 | 73 |
| 46 | 32935 | 32793.3 | +141.7 | 0.432 | 32938.5 | 0.011 | 0.64 | 1005 | 31 |
| 53 | 33273 | 33125.5 | +147.5 | 0.445 | 33268.2 | 0.014 | 0.63 | 942 | 69 |
| 37 | 35531 | 35433.3 | +97.7 | 0.276 | 35539.4 | 0.024 | 0.49 | 1370 | 62 |
| 51 | 38477 | 38311.6 | +165.4 | 0.432 | 38470.4 | 0.017 | 0.61 | 1353 | 74 |
| 48 | 38948 | 38778.6 | +169.4 | 0.437 | 38947.9 | 0.000 | 0.63 | 1168 | 23 |
| 49 | 41533 | 41360.8 | +172.2 | 0.416 | 41535.1 | 0.005 | 0.60 | 678 | 77 |
| 45 | 43952 | 43777.3 | +174.7 | 0.399 | 43956.5 | 0.010 | 0.60 | 1519 | 52 |
| 47 | 49879 | 49711.7 | +167.3 | 0.337 | 49879.5 | 0.001 | 0.52 | 1291 | 121 |
| 44 | 50398 | 50185.1 | +212.9 | 0.424 | 50398.2 | 0.000 | 0.62 | 1829 | 115 |
