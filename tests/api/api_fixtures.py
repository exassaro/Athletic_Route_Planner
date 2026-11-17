"""Real solver output for API tests without engines: the A01 acceptance run from the Phase 3b report.

docs/reports/phase3b/acceptance_A01.json holds the result without geometry; acceptance_A01.geojson holds the
geometry of each candidate. Joined, they give the SolveResult the solver returned on 2026-11-17.
"""

import json
import threading
import time

from athlete_solver.models import Candidate, RouteRequest, SolveResult

from athlete_api.config import ROOT
from athlete_api.elevation import Elevation

REPORT = ROOT / "docs" / "reports" / "phase3b"
FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "scenarios" / "scenarios.json").read_text(encoding="utf-8"))["fixtures"]


def fixture_request(fid: str) -> dict:
    return next(f for f in FIXTURES if f["id"] == fid)["request"]


def a01_candidates() -> list[Candidate]:
    result = json.loads((REPORT / "acceptance_A01.json").read_text(encoding="utf-8"))
    shapes = {(f["properties"]["label"], f["properties"]["option"]): f["geometry"]["coordinates"]
              for f in json.loads((REPORT / "acceptance_A01.geojson").read_text(encoding="utf-8"))["features"]
              if f["geometry"]["type"] == "LineString"}
    return [Candidate.model_validate({**c, "geometry": shapes[(c["label"], c["option"])]})
            for c in result["candidates"]]


def a01_result(request: RouteRequest) -> SolveResult:
    raw = json.loads((REPORT / "acceptance_A01.json").read_text(encoding="utf-8"))
    return SolveResult(outcome=raw["outcome"], request=request, candidates=a01_candidates(), conflict=raw["conflict"],
                       facts=raw["facts"], flags=raw["flags"], graph_build=raw["graph_build"],
                       engine_calls=raw["engine_calls"], elapsed_ms=raw["elapsed_ms"])


def flat_elevation(result: SolveResult, height: float = 12.0) -> list[Elevation]:
    """Test placeholder heights (never a length): every vertex at `height`, profile at both ends."""
    return [Elevation(heights=[height] * len(c.geometry), profile=[[0.0, height], [round(c.length_m, 1), height]])
            for c in result.candidates]


class FakeSolver:
    """A SolverPort returning A01's real result for any request. Counts calls; can sleep or fail."""

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
            result = a01_result(request)
            if self.flags:
                result.flags = self.flags
            return result, flat_elevation(result)
        finally:
            with self._lock:
                self.running -= 1
