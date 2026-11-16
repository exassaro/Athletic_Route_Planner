"""Solver entry point. Implemented step by step in Phase 3."""

from athlete_engine.valhalla import Valhalla

from .models import RouteRequest, SolveResult


def solve(request: RouteRequest, engine: Valhalla | None = None, graph_build: str = "unknown") -> SolveResult:
    raise NotImplementedError("solver not implemented yet")
