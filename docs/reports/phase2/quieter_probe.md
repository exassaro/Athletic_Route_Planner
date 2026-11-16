# Phase 2: can pedestrian costing produce a "quieter" route?

OSM data 2026-11-15T00:15:25Z. Ferries hard-excluded (`exclude_ferries: true`) in every variant.

For each pair, the default pedestrian route is compared with routes under other option sets. "Trunk + primary" is metres on those road classes from `trace_attributes` edge lengths. "Overlap" is the Jaccard overlap of edge ids with the default route; the blueprint keeps an alternative only below 0.60. "Raw climb" sums every rise between consecutive shape points from the elevation service with no smoothing, so it overstates real climbing and is useful only for comparing rows.

## start_south_of_kadalundi to kozhikode

| Variant | Costing options | Geometry (m) | vs default (m) | Ferry (m) | Trunk + primary (m) | Share (%) | Raw climb (m) | Overlap with default |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| default | `{}` | 29154 | +0 | 0 | 9828 | 33.7 | 307 | 1.00 |
| shortest | `{"shortest": true}` | 29143 | -11 | 0 | 9226 | 31.7 | 306 | 0.89 |
| prefer paths and living streets | `{"walkway_factor": 0.5, "use_living_streets": 1.0, "use_tracks": 1.0, "alley_factor": 1.0}` | 29154 | +0 | 0 | 9828 | 33.7 | 307 | 1.00 |
| prefer sidewalks | `{"sidewalk_factor": 0.3}` | 29154 | +0 | 0 | 9828 | 33.7 | 307 | 1.00 |
| avoid hills | `{"use_hills": 0.0}` | 29154 | +0 | 0 | 9828 | 33.7 | 307 | 1.00 |
| prefer lit | `{"use_lit": 1.0}` | 29144 | -11 | 0 | 9226 | 31.7 | 305 | 0.92 |
| bicycle costing, avoid roads (proxy) | `{"use_roads": 0.0, "bicycle_type": "Hybrid"}` | 29133 | -21 | 0 | 4361 | 15.0 | 351 | 0.40 |

## beypore to kozhikode

| Variant | Costing options | Geometry (m) | vs default (m) | Ferry (m) | Trunk + primary (m) | Share (%) | Raw climb (m) | Overlap with default |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| default | `{}` | 9206 | +0 | 0 | 2983 | 32.4 | 77 | 1.00 |
| shortest | `{"shortest": true}` | 9204 | -2 | 0 | 2391 | 26.0 | 78 | 0.78 |
| prefer paths and living streets | `{"walkway_factor": 0.5, "use_living_streets": 1.0, "use_tracks": 1.0, "alley_factor": 1.0}` | 9463 | +257 | 0 | 0 | 0.0 | 87 | 0.29 |
| prefer sidewalks | `{"sidewalk_factor": 0.3}` | 9206 | +0 | 0 | 2983 | 32.4 | 77 | 1.00 |
| avoid hills | `{"use_hills": 0.0}` | 9206 | +0 | 0 | 2983 | 32.4 | 77 | 1.00 |
| prefer lit | `{"use_lit": 1.0}` | 9204 | -2 | 0 | 2391 | 26.0 | 77 | 0.86 |
| bicycle costing, avoid roads (proxy) | `{"use_roads": 0.0, "bicycle_type": "Hybrid"}` | 10782 | +1576 | 0 | 0 | 0.0 | 99 | 0.07 |

## feroke to kozhikode

| Variant | Costing options | Geometry (m) | vs default (m) | Ferry (m) | Trunk + primary (m) | Share (%) | Raw climb (m) | Overlap with default |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| default | `{}` | 11018 | +0 | 0 | 9138 | 82.9 | 122 | 1.00 |
| shortest | `{"shortest": true}` | 11007 | -11 | 0 | 8536 | 77.6 | 121 | 0.77 |
| prefer paths and living streets | `{"walkway_factor": 0.5, "use_living_streets": 1.0, "use_tracks": 1.0, "alley_factor": 1.0}` | 11018 | +0 | 0 | 9138 | 82.9 | 122 | 1.00 |
| prefer sidewalks | `{"sidewalk_factor": 0.3}` | 11018 | +0 | 0 | 9138 | 82.9 | 122 | 1.00 |
| avoid hills | `{"use_hills": 0.0}` | 11083 | +65 | 0 | 9176 | 82.8 | 120 | 0.95 |
| prefer lit | `{"use_lit": 1.0}` | 11008 | -11 | 0 | 8536 | 77.5 | 120 | 0.84 |
| bicycle costing, avoid roads (proxy) | `{"use_roads": 0.0, "bicycle_type": "Hybrid"}` | 11556 | +538 | 0 | 4354 | 37.7 | 154 | 0.29 |

## Ferry leak check

start_south_of_kadalundi to kozhikode, comparing the soft `use_ferry: 0` with the hard `exclude_ferries: true` when combined with other options.

| Costing options | Geometry (m) | Ferry (m) |
| --- | --- | --- |
| `{"use_ferry": 0.0}` | 29154 | 0 |
| `{"exclude_ferries": true}` | 29154 | 0 |
| `{"use_ferry": 0.0, "shortest": true}` | 25126 | 340 |
| `{"exclude_ferries": true, "shortest": true}` | 29143 | 0 |
| `{"use_ferry": 0.0, "use_lit": 1.0}` | 25126 | 340 |
| `{"exclude_ferries": true, "use_lit": 1.0}` | 29144 | 0 |
