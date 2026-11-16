# Phase 2: engine primitives

Valhalla 3.9.2-2dc688aa7, pedestrian costing, OSM data 2026-11-15T00:15:25Z. Measured on the development laptop.

## 1. Route with via points

Start (11.05, 75.86) to Chaliyam via Kadalundi, once with a `through` via and once with a `break` via.

| Via type | Legs | Engine length (m) | Geometry length (m) | Gap (%) | Via point to route (m) | Latency (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| through | 1 | 17411 | 17347.1 | 0.368 | 39.1 | 224 |
| break | 2 | 16581 | 16521.1 | 0.363 | 39.2 | 19 |

Geometry: `docs/reports/phase2/primitive_route.geojson`

**PASS**

## 2. Many-to-many matrix

5 x 5 pedestrian matrix, engine distances in km. Latency 326 ms.

| From \ To | start_south_of_kadalundi | kadalundi | chaliyam | beypore | kozhikode |
| --- | --- | --- | --- | --- | --- |
| start_south_of_kadalundi | 0.000 | 12.651 | 13.729 | 16.822 | 25.242 |
| kadalundi | 12.651 | 0.000 | 3.927 | 7.020 | 15.440 |
| chaliyam | 13.729 | 3.927 | 0.000 | 3.092 | 11.512 |
| beypore | 16.703 | 6.901 | 2.973 | 0.000 | 9.248 |
| kozhikode | 25.242 | 15.440 | 11.512 | 9.248 | 0.000 |

**PASS**

## 3. Isodistance contour

5 km pedestrian contour from Beypore. Latency 88 ms.

Outer ring has 368 vertices. Routed distance from the origin to 8 of them:

| Ring vertex | Routed length (m) | Share of contour distance (%) |
| --- | --- | --- |
| 0 | 5048 | 101.0 |
| 46 | 1678 | 33.6 |
| 92 | 4557 | 91.1 |
| 138 | 5038 | 100.8 |
| 184 | 2930 | 58.6 |
| 230 | 4935 | 98.7 |
| 276 | 3482 | 69.6 |
| 322 | 4665 | 93.3 |

Geometry: `docs/reports/phase2/primitive_isodistance.geojson`

**PASS**

## 4. Edge attributes (trace_attributes)

Chaliyam to Beypore route (default pedestrian costing) fed back through `trace_attributes` with `shape_match=edge_walk`. Latency 48 ms.

- Edges returned: 28, unique edge ids: 28
- Route length from `/route`: 3092 m; sum of edge lengths: 3092 m
- Length by road class (m): {"secondary": 763, "service_other": 125, "primary": 622, "residential": 1571, "unclassified": 11}
- Length by use (m): {"road": 2345, "service_road": 125, "ferry": 622}
- Length by surface (m): {"paved_smooth": 2954, "paved": 138}
- Edges flagged as bridge: 0
- Attribute keys on the first edge: begin_shape_index, bridge, end_shape_index, id, length, mean_elevation, names, road_class, sidewalk, source_percent_along, surface, use, way_id, weighted_grade

**PASS**
