# engine

Everything that touches the routing engine and the map data.

| Path | Contents |
| --- | --- |
| `athlete_engine/` | Python package: polyline codec, geodesic measurement, Valhalla client (step 3 onward) |
| `scripts/` | Data download and fixture generation |
| `experiments/` | Numbered Phase 2 experiments; each writes a report to `docs/reports/phase2/` |
| `valhalla/` | Valhalla container configuration |
| `photon/` | Photon container configuration |

Coordinates are `(lon, lat)` in WGS84 throughout.
