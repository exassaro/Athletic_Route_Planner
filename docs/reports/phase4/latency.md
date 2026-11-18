# Phase 4: latency through the API

Measured on the development laptop (not the target server), 2026-11-18T02:32:53+00:00, through the containerised API at http://localhost:8000, one request at a time, on 110 active fixtures. Raw data: [latency_data.json](latency_data.json).

| Endpoint | n | p50 (ms) | p95 (ms) | max (ms) |
| --- | --- | --- | --- | --- |
| loop: create | 32 | 468.5 | 1771.4 | 2655.0 |
| loop: create, cache hit | 32 | 30.0 | 50.7 | 51.7 |
| places: search | 20 | 22.5 | 31.3 | 39.8 |
| point_to_point: create | 78 | 611.1 | 1302.1 | 2656.2 |
| point_to_point: create, cache hit | 78 | 31.6 | 49.7 | 58.9 |
| point_to_point: patch | 78 | 577.2 | 1432.4 | 2120.8 |
| point_to_point: patch, cache hit | 78 | 36.1 | 51.0 | 80.8 |
| read: GET elevation | 78 | 9.9 | 14.2 | 15.8 |
| read: GET gpx | 78 | 15.4 | 23.9 | 31.9 |
| read: GET health | 20 | 13.8 | 17.7 | 19.8 |
| read: GET plan | 78 | 15.7 | 25.2 | 72.6 |
| read: GET route (GeoJSON) | 78 | 10.5 | 16.7 | 57.5 |
| read: GET version | 78 | 14.4 | 23.6 | 80.2 |

Solver time inside those requests (the solver's own `elapsed_ms`):

| Kind | n | p50 (ms) | p95 (ms) | max (ms) |
| --- | --- | --- | --- | --- |
| point_to_point | 78 | 514.7 | 1116.2 | 2502.7 |
| loop | 32 | 375.8 | 1640.4 | 2567.6 |

API container memory (docker stats, 32 samples): median 117.8 MiB, max 123.0 MiB.

Failures: 0.
