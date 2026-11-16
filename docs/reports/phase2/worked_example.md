# Phase 2: measured distances for the section 8 worked example

Valhalla 3.9.2-2dc688aa7, pedestrian costing, OSM data 2026-11-15T00:15:25Z.

Request: 25 km towards Kozhikode from the start at 11.05, 75.86, via Kadalundi, Chaliyam and Beypore in that order. Stop coordinates are OSM place nodes (`tests/fixtures/places.json`).

Two lengths are given for each route. **Engine** is the engine's own summary. **Geometry** is the geodesic length of the returned shape on the WGS84 ellipsoid, which is the figure the product should show (see `length_check.md`: the engine runs up to about 0.5% long at this latitude).

## Summary

| | Ferry allowed (`use_ferry: 1`) | Valhalla default (`use_ferry: 0.5`) | Ferry avoided by cost (`use_ferry: 0`) | Ferry hard-excluded (`exclude_ferries: true`) |
| --- | --- | --- | --- | --- |
| Start to Kadalundi, geometry | 12.60 km | 12.60 km | 12.60 km | 12.60 km |
| Kadalundi to Chaliyam, geometry | 3.92 km | 3.92 km | 3.92 km | 3.92 km |
| Chaliyam to Beypore, geometry | 3.08 km (ferry 622 m) | 3.08 km (ferry 622 m) | 9.37 km | 9.37 km |
| Beypore to Kozhikode, geometry | 9.21 km | 9.21 km | 9.21 km | 9.21 km |
| **L_min**: one route Start, Kadalundi, Chaliyam, Beypore | **19.60 km** (engine 19.67) | **19.60 km** (engine 19.67) | **25.89 km** (engine 25.98) | **25.89 km** (engine 25.98) |
| Remainder R at 25 km (25 km minus L_min geometry) | 5.40 km | 5.40 km | -0.89 km | -0.89 km |
| Section 8 step 8 outcome | Case A: cut 5.40 km along the 9.21 km path to Kozhikode | Case A: cut 5.40 km along the 9.21 km path to Kozhikode | Infeasible: stops alone exceed 25 km by 0.89 km | Infeasible: stops alone exceed 25 km by 0.89 km |
| Ferry edges used up to Beypore | 622 m on way(s) 173426286 | 622 m on way(s) 173426286 | none | none |

Notes on the tables below: the engine classes ferry edges as `primary`, so the "Trunk + primary" column includes ferry metres. "Snap" is the straight-line offset between the requested point and where the route actually starts or ends; OSM place nodes are not on a road.

## Ferry allowed (`use_ferry: 1`)

Costing options: `{"use_ferry": 1.0}`

| Leg | Engine (m) | Geometry (m) | Ferry (m) | Ferry OSM ways | Bridge (m) | Trunk + primary (m) | Snap at start / end (m) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Start to Kadalundi | 12652 | 12604 | 0 | - | 791 | 690 | 29 / 39 |
| Kadalundi to Chaliyam | 3928 | 3918 | 0 | - | 0 | 0 | 39 / 54 |
| Chaliyam to Beypore | 3092 | 3076 | 622 | 173426286 | 0 | 622 | 54 / 2 |
| Beypore to Kozhikode | 9249 | 9206 | 0 | - | 710 | 2983 | 2 / 6 |

Sum of the three separately routed legs to Beypore: 19597 m geometry; single multi-stop route: 19597 m geometry.

Engine warnings: `[{"code": 401, "text": "Routing failed on first pass, retrying with relaxed restrictions"}, {"code": 401, "text": "Routing failed on first pass, retrying with relaxed restrictions"}]`

Matrix for the same five points (engine km):

| From \ To | Start | Kadalundi | Chaliyam | Beypore | Kozhikode |
| --- | --- | --- | --- | --- | --- |
| Start | 0.000 | 12.651 | 13.729 | 16.822 | 25.242 |
| Kadalundi | 12.651 | 0.000 | 3.927 | 7.020 | 15.440 |
| Chaliyam | 13.729 | 3.927 | 0.000 | 3.092 | 11.512 |
| Beypore | 16.703 | 6.901 | 2.973 | 0.000 | 9.248 |
| Kozhikode | 25.242 | 15.440 | 11.512 | 9.248 | 0.000 |

- Missing cells (no path): 0
- Matrix sum along the requested order to Beypore: 19.670 km
- Shortest order by matrix: Kadalundi, Chaliyam, Beypore (19.670 km), the requested order

## Valhalla default (`use_ferry: 0.5`)

Costing options: `{}`

| Leg | Engine (m) | Geometry (m) | Ferry (m) | Ferry OSM ways | Bridge (m) | Trunk + primary (m) | Snap at start / end (m) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Start to Kadalundi | 12652 | 12604 | 0 | - | 791 | 690 | 29 / 39 |
| Kadalundi to Chaliyam | 3928 | 3918 | 0 | - | 0 | 0 | 39 / 54 |
| Chaliyam to Beypore | 3092 | 3076 | 622 | 173426286 | 0 | 622 | 54 / 2 |
| Beypore to Kozhikode | 9249 | 9206 | 0 | - | 710 | 2983 | 2 / 6 |

Sum of the three separately routed legs to Beypore: 19597 m geometry; single multi-stop route: 19597 m geometry.

Engine warnings: `[{"code": 401, "text": "Routing failed on first pass, retrying with relaxed restrictions"}, {"code": 401, "text": "Routing failed on first pass, retrying with relaxed restrictions"}]`

Matrix for the same five points (engine km):

| From \ To | Start | Kadalundi | Chaliyam | Beypore | Kozhikode |
| --- | --- | --- | --- | --- | --- |
| Start | 0.000 | 12.651 | 13.729 | 16.822 | 25.242 |
| Kadalundi | 12.651 | 0.000 | 3.927 | 7.020 | 15.440 |
| Chaliyam | 13.729 | 3.927 | 0.000 | 3.092 | 11.512 |
| Beypore | 16.703 | 6.901 | 2.973 | 0.000 | 9.248 |
| Kozhikode | 25.242 | 15.440 | 11.512 | 9.248 | 0.000 |

- Missing cells (no path): 0
- Matrix sum along the requested order to Beypore: 19.670 km
- Shortest order by matrix: Kadalundi, Chaliyam, Beypore (19.670 km), the requested order

## Ferry avoided by cost (`use_ferry: 0`)

Costing options: `{"use_ferry": 0.0}`

| Leg | Engine (m) | Geometry (m) | Ferry (m) | Ferry OSM ways | Bridge (m) | Trunk + primary (m) | Snap at start / end (m) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Start to Kadalundi | 12652 | 12604 | 0 | - | 791 | 690 | 29 / 39 |
| Kadalundi to Chaliyam | 3928 | 3918 | 0 | - | 0 | 0 | 39 / 54 |
| Chaliyam to Beypore | 9396 | 9369 | 0 | - | 541 | 1263 | 54 / 2 |
| Beypore to Kozhikode | 9249 | 9206 | 0 | - | 710 | 2983 | 2 / 6 |

Sum of the three separately routed legs to Beypore: 25890 m geometry; single multi-stop route: 25890 m geometry.

Matrix for the same five points (engine km):

| From \ To | Start | Kadalundi | Chaliyam | Beypore | Kozhikode |
| --- | --- | --- | --- | --- | --- |
| Start | 0.000 | 12.651 | 13.729 | 22.266 | 29.273 |
| Kadalundi | 12.651 | 0.000 | 3.927 | 11.434 | 18.441 |
| Chaliyam | 13.729 | 3.927 | 0.000 | 9.395 | 16.402 |
| Beypore | 22.266 | 11.434 | 9.395 | 0.000 | 9.248 |
| Kozhikode | 29.273 | 18.441 | 16.402 | 9.248 | 0.000 |

- Missing cells (no path): 0
- Matrix sum along the requested order to Beypore: 25.973 km
- Shortest order by matrix: Kadalundi, Chaliyam, Beypore (25.973 km), the requested order

## Ferry hard-excluded (`exclude_ferries: true`)

Costing options: `{"exclude_ferries": true}`

| Leg | Engine (m) | Geometry (m) | Ferry (m) | Ferry OSM ways | Bridge (m) | Trunk + primary (m) | Snap at start / end (m) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Start to Kadalundi | 12652 | 12604 | 0 | - | 791 | 690 | 29 / 39 |
| Kadalundi to Chaliyam | 3928 | 3918 | 0 | - | 0 | 0 | 39 / 54 |
| Chaliyam to Beypore | 9396 | 9369 | 0 | - | 541 | 1263 | 54 / 2 |
| Beypore to Kozhikode | 9249 | 9206 | 0 | - | 710 | 2983 | 2 / 6 |

Sum of the three separately routed legs to Beypore: 25890 m geometry; single multi-stop route: 25890 m geometry.

Matrix for the same five points (engine km):

| From \ To | Start | Kadalundi | Chaliyam | Beypore | Kozhikode |
| --- | --- | --- | --- | --- | --- |
| Start | 0.000 | 12.651 | 13.729 | 22.266 | 29.273 |
| Kadalundi | 12.651 | 0.000 | 3.927 | 11.434 | 18.441 |
| Chaliyam | 13.729 | 3.927 | 0.000 | 9.395 | 16.402 |
| Beypore | 22.266 | 11.434 | 9.395 | 0.000 | 9.248 |
| Kozhikode | 29.273 | 18.441 | 16.402 | 9.248 | 0.000 |

- Missing cells (no path): 0
- Matrix sum along the requested order to Beypore: 25.973 km
- Shortest order by matrix: Kadalundi, Chaliyam, Beypore (25.973 km), the requested order
