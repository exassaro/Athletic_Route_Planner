# Phase 2: Valhalla build on the Kerala extract

Measured on the development laptop (Windows 11, Intel i5 10th gen, Docker Desktop on WSL2 reporting 7.7 GiB and 8 CPUs to containers), 2026-11-16.

| Item | Value | How it was measured |
| --- | --- | --- |
| Valhalla version | 3.9.2-2dc688aa7 | `/status` |
| Image | `ghcr.io/valhalla/valhalla-scripted@sha256:6e3a8a6d…180843` | `docker image inspect` |
| OSM data | Kerala extract, 178.9 MB, OSM timestamp 2026-11-15T00:15:25Z | `data/manifest.json` |
| Build threads | 2 | container log (`server_threads=2`) |
| Total time, container start to serving | about 6 min 35 s | first log line 12:01:01 UTC to "Tile extract successfully loaded" 12:07:36 UTC |
| of which tile set build | 225 s | log line `build_tile_set took 225s` |
| Peak container memory during build | 386 MiB | `docker stats` sampled about every 10 s, so short spikes can be missed |
| Container memory when idle after build | 53 MiB | `docker stats`, before any routing request |
| Graph tiles | 165 files, 186 MB (plus a 107 MB tar of the same tiles) | file sizes in `data/valhalla` |
| Elevation tiles | 15 files, 371 MB | file sizes in `data/valhalla/elevation_data` |
| Elevation check | Beypore 13 m, Kozhikode 13 m, Vythiri (Wayanad) 745 m | `/height` at the OSM place nodes in `tests/fixtures/places.json` |

Notes:

- Admin and time-zone databases were not built (`build_admins=False`, `build_time_zones=False`); neither is needed for pedestrian routing in one country.
- `service_limits.allow_hard_exclusions` is switched on by `engine/scripts/configure_valhalla.py` so that `exclude_ferries` can be tested.
- Answer to the blueprint's open question on memory and build time: for Kerala alone, both are small. A South India graph was not built; the Southern Zone extract is about three times larger (533 MB against 179 MB).
