"""Schema (blueprint section 11): A01's candidates stored and read back unchanged; ST_Length only as a cross-check.

The candidates come from the Phase 3b acceptance run (docs/reports/phase3b/acceptance_A01.json for the stats and
stops, acceptance_A01.geojson for the geometry), so no engine is needed. Z is a test placeholder: elevation is
added by the API in step 5 and never feeds a length.
"""

import asyncio
import json
import uuid

import pytest
from geoalchemy2 import Geography
from athlete_solver.models import Candidate
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from athlete_api.config import ROOT
from athlete_api.db import Client, Plan, PlanVersion, Route, SavedRoute, make_engine, make_sessionmaker
from athlete_api.store import candidate_of, geometry_of, route_row

REPORT = ROOT / "docs" / "reports" / "phase3b"
# geography ST_Length (PostGIS, spheroid) against the solver's ellipsoid length (pyproj Geod). Both are WGS84
# geodesics, so they should agree to well under a millimetre per kilometre.
CROSS_CHECK_REL = 1e-6


def length_2d(geom):
    """ST_Length on the 2D line. On a geography LINESTRING Z, PostGIS 3.4's ST_Length includes the Z changes
    (measured: 109.29 m flat, 148.13 m with a 100 m rise), so Z must be dropped before measuring."""
    return func.ST_Length(func.ST_Force2D(func.geometry(geom)).cast(Geography))


def a01_candidates() -> list[Candidate]:
    result = json.loads((REPORT / "acceptance_A01.json").read_text(encoding="utf-8"))
    shapes = {(f["properties"]["label"], f["properties"]["option"]): f["geometry"]["coordinates"]
              for f in json.loads((REPORT / "acceptance_A01.geojson").read_text(encoding="utf-8"))["features"]
              if f["geometry"]["type"] == "LineString"}
    return [Candidate.model_validate({**c, "geometry": shapes[(c["label"], c["option"])]})
            for c in result["candidates"]]


def version_row(plan_id, **over) -> PlanVersion:
    row = dict(id=uuid.uuid4(), plan_id=plan_id, version_no=1, request={"route_type": "point_to_point"}, source="form",
               outcome="ok", facts={}, flags=[], explanation="", graph_build="2026-11-15T00:15:25Z",
               valhalla_build="test", graphhopper_build="test", solver_hash="test", cache_key="test", from_cache=False)
    row.update(over)
    return PlanVersion(**row)


@pytest.fixture
def db(database_url):
    engine = make_engine(database_url)
    sessions = make_sessionmaker(engine)
    runner = asyncio.Runner()
    yield runner, sessions
    runner.run(engine.dispose())
    runner.close()


async def _store_a01(sessions):
    cands = a01_candidates()
    client, plan = Client(id=uuid.uuid4(), token_hash=uuid.uuid4().bytes), None
    async with sessions() as s:
        s.add(client)
        await s.flush()
        plan = Plan(id=uuid.uuid4(), client_id=client.id)
        s.add(plan)
        await s.flush()
        version = version_row(plan.id)
        s.add(version)
        await s.flush()
        for seq, c in enumerate(cands):
            heights = [float(k % 7) for k in range(len(c.geometry))]
            s.add(route_row(c, version_id=version.id, seq=seq, heights=heights, elevation=[[0.0, 1.0]]))
        await s.commit()
    return cands, client, plan, version


def test_a01_candidates_read_back_unchanged(db):
    runner, sessions = db

    async def go():
        cands, _, _, version = await _store_a01(sessions)
        async with sessions() as s:
            rows = (await s.execute(select(Route).where(Route.plan_version_id == version.id).order_by(Route.seq))).scalars().all()
            return cands, [candidate_of(r) for r in rows], [geometry_of(r)[1] for r in rows]

    cands, back, zs = runner.run(go())
    assert len(back) == len(cands) == 3
    for original, stored, z in zip(cands, back, zs):
        assert stored.model_dump(exclude={"edge_ids"}) == original.model_dump(exclude={"edge_ids"})
        assert stored.geometry == [tuple(p) for p in original.geometry]     # exact floats, every vertex
        assert z == [float(k % 7) for k in range(len(original.geometry))]


def test_st_length_cross_check_agrees_with_the_solver(db):
    runner, sessions = db

    async def go():
        _, _, _, version = await _store_a01(sessions)
        async with sessions() as s:
            return (await s.execute(select(Route.label, Route.option, Route.length_m, length_2d(Route.geom),
                                           func.ST_Length(Route.geom))
                                    .where(Route.plan_version_id == version.id))).all()

    rows = runner.run(go())
    assert len(rows) == 3
    for label, option, solver_m, postgis_m, with_z_m in rows:
        assert abs(postgis_m - solver_m) <= CROSS_CHECK_REL * solver_m, (label, option, solver_m, postgis_m)
        assert with_z_m > postgis_m   # the trap: Z counts in ST_Length on a geography LINESTRING Z


def test_constraints_and_cascade(db):
    runner, sessions = db

    async def bad_outcome():
        _, _, plan, _ = await _store_a01(sessions)
        async with sessions() as s:
            s.add(version_row(plan.id, version_no=2, outcome="maybe"))
            await s.commit()

    with pytest.raises(IntegrityError):
        runner.run(bad_outcome())

    async def duplicate_version_and_cascade():
        _, client, plan, version = await _store_a01(sessions)
        async with sessions() as s:
            s.add(version_row(plan.id, version_no=1))
            with pytest.raises(IntegrityError):
                await s.commit()
        async with sessions() as s:
            route_id = (await s.execute(select(Route.id).where(Route.plan_version_id == version.id))).scalars().first()
            s.add(SavedRoute(id=uuid.uuid4(), client_id=client.id, route_id=route_id, share_slug=uuid.uuid4().hex))
            await s.commit()
            await s.execute(delete(SavedRoute).where(SavedRoute.route_id == route_id))
            await s.execute(delete(Plan).where(Plan.id == plan.id))
            await s.commit()
            left = (await s.execute(select(func.count()).select_from(Route)
                                    .where(Route.plan_version_id == version.id))).scalar_one()
        assert left == 0

    runner.run(duplicate_version_and_cascade())
