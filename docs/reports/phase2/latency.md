# Phase 2: latency

Valhalla 3.9.2-2dc688aa7, pedestrian costing, 2 server threads, OSM data 2026-11-15T00:15:25Z.

**Where measured:** the development laptop (Intel i5 10th gen, Docker Desktop on WSL2), requests sent one at a time from the host. This is not the target server named in the acceptance criterion, and timings include Docker Desktop's port forwarding.

## Pedestrian routes of 24 to 26 km

Routes were selected because the engine reported their length inside that window. 30 consecutive requests each.

| Route | Engine length (m) | p50 (ms) | p95 (ms) | max (ms) |
| --- | --- | --- | --- | --- |
| start_south_of_kadalundi -> kozhikode | 25242 | 71 | 85 | 88 |
| pair 38 | 24802 | 56 | 62 | 63 |
| pair 40 | 25234 | 53 | 56 | 57 |
| pair 41 | 24882 | 58 | 61 | 61 |
| **All 120 requests** | | 57 | 80 | 88 |

First routing request of this run (start_south_of_kadalundi -> kozhikode, 25242 m): 314 ms. This is a cold-start figure only if the container was restarted just before the run.

**PASS**: p95 80 ms against the 300 ms target.

## Other primitives

| Call | p50 (ms) | p95 (ms) | max (ms) |
| --- | --- | --- | --- |
| Matrix 5 x 5 (worked-example points) | 89 | 105 | 162 |
| Isodistance 5 km from Beypore | 76 | 87 | 87 |
| Isodistance 12.5 km from Beypore | 82 | 135 | 135 |
| trace_attributes (edge_walk) on the 25.2 km route, 595 shape points | 48 | 49 | 49 |

## Memory

Container memory (`docker stats`): 52.85MiB / 7.676GiB before the run, 109.7MiB / 7.676GiB after it.
