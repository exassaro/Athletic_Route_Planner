# Phase 4 step 1: memory with every service up

Measured on the development laptop (not the target server) on 2026-11-18 with `api/scripts/measure_memory.py`. Raw data: [memory_data.json](memory_data.json).

The stack: Valhalla 3.9.2, GraphHopper 11.1, PostgreSQL 16.4 + PostGIS 3.4, Redis 7.4.12, and Photon 1.3.0 with the India index. The API itself does not exist yet. The solver ran on the host, as the API's worker thread will.

## The machine, measured

These figures differ from CLAUDE.md, which says 8 GB of RAM and about 4 GB for containers:
- **Windows** reports 16,221 MiB of physical memory.
- **Docker** (the WSL2 VM) has 7,860 MiB and 2,048 MiB of swap.
- **Free physical memory on Windows** was only 1.2 to 2.2 GiB throughout. The VM and the desktop applications hold the rest.

## Per container (`docker stats`, MiB)

| Container | Idle, Photon stopped | A01 solve, Photon stopped (peak) | Idle, Photon up | A01 solve, Photon up (peak) | Limit |
| --- | --- | --- | --- | --- | --- |
| GraphHopper | 2,089 | 2,089 | 2,089 | 2,089 | 4,096 |
| Valhalla | 508 | 511 | 510 | 511 | none |
| Photon | – | – | 478 | 478 | 3,072 |
| Postgres | 22 | 22 | 22 | 22 | 512 |
| Redis | 3 | 4 | 3 | 3 | 320 |
| Solver process (host, Windows working set) | – | 69 | – | 74 | – |

Photon was measured after 640 requests (20 rounds of a search and a reverse lookup for each named place in `tests/fixtures/places.json`), so that its heap had grown. It started in 8.6 s, and a search took 83 to 221 ms.

## The VM as a whole (`free -m` inside a container, MiB)

| State | Used | Available | Swap used |
| --- | --- | --- | --- |
| Idle, Photon stopped | 3,172 | 4,498 | 0 |
| A01 solve, Photon stopped | 3,173 (peak) | 4,496 (lowest) | 0 |
| Idle, Photon up | 3,660 | 4,010 | 0 |
| A01 solve, Photon up | 3,669 (peak) | 4,002 (lowest) | 0 |

No container was OOM-killed.

A01 gave the same four lengths with and without Photon (25,000.0, 25,052.7, 24,071.6 and 24,678.6 m). It took 4.55 s and 4.80 s respectively, a difference within run-to-run noise on this laptop.

## Answer: Photon can stay up during development

With every service and Photon running, the VM uses 3.7 GiB of its 7.7 GiB and keeps 4.0 GiB available, with no swap.

The worst case is still inside the VM. Photon's heap is capped at 1.5 GiB (about 1.9 GiB resident), against 0.48 GiB now. GraphHopper is already at its working size.

A stub geocoder is therefore not needed for development. The API's tests use a fake geocoder in any case. The memory that is tight is on Windows itself (1.2 GiB free at the lowest), not inside Docker.

## Not yet measured

- **The API container** (FastAPI, the solver's threads, two concurrent solves). The host solver process peaked at 74 MiB for one solve. The containerised API is measured in the Phase 4 report (step 11).
