"""Candidate <-> routes row (blueprint section 11, Phase 4 amendment 4).

Every number is copied from the solver's Candidate and comes back unchanged: lengths are double
precision columns and the geometry travels as WKB (float64), so a stored candidate reads back equal to the
one the solver returned. Nothing here measures anything. Z is the DEM height at each vertex (amendment 15),
used for GPX and the profile only; it never feeds a length.
"""

import uuid
from typing import Any

from athlete_solver.models import Candidate, EndPoint
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import LineString

from .db import Route

# Candidate fields stored in a column of the same name.
SCALARS = ("label", "option", "engine", "length_m", "foot_m", "ferry_m", "engine_length_m", "sphere_length_m",
           "edge_count", "deviation_m", "duration_s", "gain_m", "loss_m", "repeat_share", "backtrack_share", "score")
# Not stored: edge_ids (internal to the solver, amendment 23 / section 11 notes).
NOT_STORED = {"edge_ids"}


def line_z(geometry: list[tuple[float, float]], heights: list[float]) -> LineString:
    if len(heights) != len(geometry):
        raise ValueError(f"{len(heights)} heights for {len(geometry)} vertices")
    return LineString([(lon, lat, z) for (lon, lat), z in zip(geometry, heights)])


def route_row(cand: Candidate, *, version_id: uuid.UUID, seq: int, heights: list[float],
              elevation: list[list[float]] | None, route_id: uuid.UUID | None = None) -> Route:
    dumped = cand.model_dump(mode="json", exclude=NOT_STORED | {"geometry"})
    return Route(
        id=route_id or uuid.uuid4(), plan_version_id=version_id, seq=seq,
        geom=from_shape(line_z(cand.geometry, heights), srid=4326),
        end_label=cand.end.label, end_point=dumped["end"], stops=dumped["stops"],
        road_class_m=dumped["road_class_m"], flags=dumped["flags"], elevation=elevation,
        bridges_m=dumped["bridges_m"],
        **{k: getattr(cand, k) for k in SCALARS},
    )


def geometry_of(route: Route) -> tuple[list[tuple[float, float]], list[float]]:
    """(lon, lat) vertices as the solver gave them, and the Z of each."""
    coords = list(to_shape(route.geom).coords)
    return [(c[0], c[1]) for c in coords], [c[2] for c in coords]


def candidate_of(route: Route) -> Candidate:
    """The solver's Candidate, rebuilt from its row (edge_ids are not kept)."""
    geometry, _ = geometry_of(route)
    data: dict[str, Any] = {k: getattr(route, k) for k in SCALARS}
    data.update(geometry=geometry, stops=route.stops, end=EndPoint.model_validate(route.end_point),
                road_class_m=route.road_class_m, flags=route.flags, bridges_m=route.bridges_m or [])
    return Candidate.model_validate(data)
