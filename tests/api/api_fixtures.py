"""Real solver output for API tests without engines: the A01 acceptance run from the Phase 3b report.

docs/reports/phase3b/acceptance_A01.json holds the result without geometry; acceptance_A01.geojson holds the
geometry of each candidate. Joined, they give the SolveResult the solver returned on 2026-11-17.
"""

import json
import threading
import time

from athlete_engine import geodesy
from athlete_solver.models import Candidate, RouteRequest, SolveResult

from athlete_api.cache import BuildIds
from athlete_api.config import ROOT
from athlete_api.elevation import PROFILE_STEP_M, Elevation

REPORT = ROOT / "docs" / "reports" / "phase3b"
# The build ids the planner sees in API tests (no engines).
BUILDS = BuildIds(osm="2026-11-15T00:15:25Z", valhalla="valhalla test tiles 1", graphhopper="graphhopper test import 1",
                  solver="test-solver")
FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "scenarios" / "scenarios.json").read_text(encoding="utf-8"))["fixtures"]


def fixture_request(fid: str) -> dict:
    return next(f for f in FIXTURES if f["id"] == fid)["request"]


def report_candidates(name: str) -> list[Candidate]:
    result = json.loads((REPORT / f"acceptance_{name}.json").read_text(encoding="utf-8"))
    shapes = {(f["properties"]["label"], f["properties"]["option"]): f["geometry"]["coordinates"]
              for f in json.loads((REPORT / f"acceptance_{name}.geojson").read_text(encoding="utf-8"))["features"]
              if f["geometry"]["type"] == "LineString"}
    return [Candidate.model_validate({**c, "geometry": shapes[(c["label"], c["option"])]})
            for c in result["candidates"]]


def a01_candidates() -> list[Candidate]:
    return report_candidates("A01")


def report_result(name: str, request: RouteRequest) -> SolveResult:
    """A01 (ok, 25 km) or A02 (over_budget, the same stops at 20 km), as the solver returned them."""
    raw = json.loads((REPORT / f"acceptance_{name}.json").read_text(encoding="utf-8"))
    return SolveResult(outcome=raw["outcome"], request=request, candidates=report_candidates(name),
                       conflict=raw["conflict"], facts=raw["facts"], flags=raw["flags"], graph_build=raw["graph_build"],
                       engine_calls=raw["engine_calls"], elapsed_ms=raw["elapsed_ms"])


def a01_result(request: RouteRequest) -> SolveResult:
    return report_result("A01", request)


def flat_elevation(result: SolveResult, height: float = 12.0) -> list[Elevation]:
    """Test placeholder heights (never a length): every vertex and every profile sample at `height`. The profile's
    distances are the real 30 m sampling of the geometry, as the API stores them."""
    return [Elevation(heights=[height] * len(c.geometry),
                      profile=[[round(d, 1), height] for _, d in geodesy.sample_every(c.geometry, PROFILE_STEP_M)])
            for c in result.candidates]


class FakeSolver:
    """A SolverPort returning real solver output: A02's (over budget) for a 20 km request, A01's for any other.
    Counts calls; can sleep or fail."""

    def __init__(self, delay_s: float = 0.0, error: Exception | None = None, flags: list | None = None):
        self.delay_s, self.error, self.flags = delay_s, error, flags
        self.calls = 0
        self.running = 0
        self.peak = 0
        self._lock = threading.Lock()

    def __call__(self, request: RouteRequest, graph_build: str):
        with self._lock:
            self.calls += 1
            self.running += 1
            self.peak = max(self.peak, self.running)
        try:
            if self.delay_s:
                time.sleep(self.delay_s)
            if self.error is not None:
                raise self.error
            result = report_result("A02" if request.target_distance_m == 20_000 else "A01", request)
            if self.flags:
                result.flags = self.flags
            return result, flat_elevation(result)
        finally:
            with self._lock:
                self.running -= 1
