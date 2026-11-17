"""Elevation for stored routes (Phase 4 amendment 15).

The solver's geometry is two-dimensional. After a solve, Valhalla's /height (the elevation tiles it already
serves) gives the height of every vertex (the Z of routes.geom, used by GPX) and of points every 30 m along the
line, the solver's own sampling step, for the profile. Distances along the line come from measuring the
geometry (athlete_engine.geodesy). The heights are raw DEM values; the gain and loss shown are always the
solver's smoothed figures, never recomputed from these.

A missing height is an error, never filled in: measured on 99 routes (25,673 vertices, 42,961 samples) on
2026-11-18, Valhalla returned none.
"""

from dataclasses import dataclass

from athlete_engine import geodesy
from athlete_engine.valhalla import Valhalla
from athlete_solver.models import Candidate

PROFILE_STEP_M = 30.0     # the solver's ELEVATION_STEP_M (scoring.py)
CHUNK = 2000              # points per /height call


class ElevationMissing(RuntimeError):
    pass


@dataclass
class Elevation:
    heights: list[float]                 # one per geometry vertex
    profile: list[list[float]]           # [[distance_m, height_m], ...] every 30 m, both ends included

    def to_json(self) -> dict:
        return {"heights": self.heights, "profile": self.profile}

    @classmethod
    def from_json(cls, data: dict) -> "Elevation":
        return cls(heights=data["heights"], profile=data["profile"])


def for_candidates(valhalla: Valhalla, candidates: list[Candidate]) -> list[Elevation]:
    """Heights for every candidate's vertices and profile samples, in as few /height calls as possible."""
    plans = []
    points: list[tuple[float, float]] = []
    for cand in candidates:
        samples = geodesy.sample_every(cand.geometry, PROFILE_STEP_M)
        plans.append((len(points), len(cand.geometry), [d for _, d in samples]))
        points.extend((p[0], p[1]) for p in cand.geometry)
        points.extend(p for p, _ in samples)
    heights: list[float | None] = []
    for i in range(0, len(points), CHUNK):
        heights.extend(valhalla.height(points[i:i + CHUNK]))
    if len(heights) != len(points):
        raise ElevationMissing(f"Valhalla returned {len(heights)} heights for {len(points)} points")
    missing = sum(h is None for h in heights)
    if missing:
        raise ElevationMissing(f"Valhalla has no height for {missing} of {len(points)} points")
    out = []
    for start, n_vertices, distances in plans:
        vertex_h = [float(h) for h in heights[start:start + n_vertices]]
        sample_h = heights[start + n_vertices:start + n_vertices + len(distances)]
        out.append(Elevation(heights=vertex_h,
                             profile=[[round(d, 1), float(h)] for d, h in zip(distances, sample_h)]))
    return out
