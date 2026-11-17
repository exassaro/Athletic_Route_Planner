"""API request and response models (blueprint section 12).

They wrap the solver's own models unchanged (Phase 4 amendment 1): RouteRequest, Candidate, Conflict and Flag
are imported from athlete_solver, not copied. A candidate gains only its stored `route_id`; its internal
`edge_ids` are not part of the API.
"""

import uuid
from datetime import datetime
from typing import Any, Literal

from athlete_solver.models import Candidate, Conflict, Flag, RouteRequest
from pydantic import BaseModel, Field
from pydantic.json_schema import SkipJsonSchema

Source = Literal["form", "chat", "drag"]


class PlanCreate(BaseModel):
    request: RouteRequest
    source: Source = "form"


class CandidateOut(Candidate):
    """The solver's Candidate as stored, plus its route id. `duration_s` is the engine's walking time."""

    route_id: uuid.UUID
    edge_ids: SkipJsonSchema[list[int]] = Field(default_factory=list, exclude=True)


class BuildsOut(BaseModel):
    osm: str = Field(description="The pinned OSM extract the solver reported (graph_build)")
    valhalla: str
    graphhopper: str | None = Field(description="Null when GraphHopper was down: only 'shortest' was produced")
    solver: str = Field(description="Hash of the solver and athlete_engine source")


class PlanVersionOut(BaseModel):
    plan_id: uuid.UUID
    version: int
    source: Source
    created_at: datetime
    outcome: Literal["ok", "over_budget", "infeasible", "disconnected", "unsupported"]
    request: RouteRequest
    candidates: list[CandidateOut]
    conflict: Conflict | None
    facts: dict[str, Any] = Field(description="The solver's facts object, unchanged")
    flags: list[Flag]
    explanation: str
    diff: dict[str, Any] | None = Field(description="Against the previous version; null for version 1")
    builds: BuildsOut
    cached: bool = Field(description="The solve came from the cache (same request and builds within 24 h)")
    elapsed_ms: float | None = Field(description="The solver's own time; on a cache hit, that of the original solve")
    engine_calls: int | None


class PlanOut(BaseModel):
    plan_id: uuid.UUID
    status: Literal["ready", "solving", "failed"]
    versions: list[int]
    latest: PlanVersionOut | None
    error: dict[str, Any] | None = Field(None, description="Why the last solve failed, when status is 'failed'")
