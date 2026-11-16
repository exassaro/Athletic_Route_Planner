# Athlete Router

A running route planner that treats distance as the input: "25 km towards Kozhikode via three stops" returns a route of that length, or a clear reason why it cannot. The full design is in [docs/blueprint.md](docs/blueprint.md).

**Status:** Phase 2 of 8, routing engine experiments. There is no API or web app yet.

## Requirements

- Windows 10/11 (or Linux/macOS), 8 GB RAM, about 5 GB free disk
- [Docker Desktop](https://www.docker.com/products/docker-desktop/), running
- [uv](https://docs.astral.sh/uv/) (installs Python 3.12 for you)
- git

## Setup

```powershell
# 1. Install uv (once)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# 2. Install Python 3.12 and dependencies into .venv
uv sync

# 3. Run the unit tests (no services needed)
uv run pytest tests/unit
```

Steps for downloading the OSM extract and starting Valhalla and Photon are added here as each Phase 2 step lands.

## Repository layout

| Path | Contents |
| --- | --- |
| `engine/` | Routing engine containers, the `athlete_engine` Python package, data scripts and experiments |
| `solver/` | Route-generation library (Phase 3) |
| `api/` | FastAPI backend (Phase 4) |
| `web/` | Next.js front end (Phase 5) |
| `docs/` | Blueprint and generated reports |
| `tests/` | Unit tests, integration tests, fixtures |
| `data/` | Downloaded and built data, not in git |

## Ground rule

No distance in this project is hardcoded or estimated. Every distance comes from the routing engine or from measuring returned geometry on the WGS84 ellipsoid.

## Data and licence

Map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL).
