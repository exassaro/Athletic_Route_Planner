"""API request and response models (blueprint section 12).

They wrap the solver's own models unchanged (Phase 4 amendment 1): RouteRequest, Candidate, Conflict and Flag
are imported from athlete_solver, not copied. A candidate gains only its stored `route_id`; its internal
`edge_ids` are not part of the API.
"""

import uuid
from datetime import datetime
from typing import Any, Literal

from athlete_solver.models import (AvoidItem, Candidate, Checkpoint, Conflict, Fix, Flag, MustUse, RouteRequest,
                                    Saving, Via)
from pydantic import BaseModel, ConfigDict, Field, model_serializer
from pydantic.json_schema import SkipJsonSchema

Source = Literal["form", "chat", "drag"]


class PlanCreate(BaseModel):
    request: RouteRequest
    source: Source = "form"


class CandidateOut(Candidate):
    """The solver's Candidate as stored, plus its route id. `duration_s` is the engine's walking time."""

    route_id: uuid.UUID
    edge_ids: SkipJsonSchema[list[int]] = Field(default_factory=list, exclude=True)
    climb_approximate: bool = Field(
        description="The route's median DEM height is under 20 m: on low ground the surface model's trees and "
                    "roofs are a large share of the climb, so show it as approximate (Phase 5 amendment 15)")


class BuildsOut(BaseModel):
    osm: str = Field(description="The pinned OSM extract the solver reported (graph_build)")
    valhalla: str
    graphhopper: str | None = Field(description="Null when GraphHopper was down: only 'shortest' was produced")
    solver: str = Field(description="Hash of the solver and athlete_engine source")


class PatchOp(BaseModel):
    """One RFC 6902 operation. Fields left unset are not sent (a `remove` has no `value`)."""

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)
    op: Literal["add", "remove", "replace", "move", "copy", "test"]
    path: str
    value: Any = None
    from_: str | None = Field(None, alias="from")

    @model_serializer(mode="wrap")
    def _only_set(self, handler):
        data = handler(self)
        keep = {"op", "path"} | {("from" if f == "from_" else f) for f in self.model_fields_set}
        return {k: v for k, v in data.items() if k in keep}


class FixOut(Fix):
    """The solver's fix, plus the patch that applies it (Phase 5 A4). Null: no unambiguous patch (the label
    matches no checkpoint or several), or the action has no effect in this version (`make_optional`)."""

    patch: list[PatchOp] | None


class SavingOut(Saving):
    """The solver's saving, plus the patch that drops that checkpoint (null when the label is ambiguous)."""

    patch: list[PatchOp] | None


class ConflictOut(Conflict):
    """The solver's Conflict, unchanged, with a patch on every fix and saving (Phase 5 A4)."""

    fixes: list[FixOut] = Field(default_factory=list)
    savings: list[SavingOut] = Field(default_factory=list)


class DiffOutcome(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)
    from_: str = Field(alias="from")
    to: str


class DiffCandidate(BaseModel):
    """One alternative in both versions, each at its primary option. Deltas are differences of stored values."""

    label: str
    from_option: str
    to_option: str
    from_length_m: float
    to_length_m: float
    length_delta_m: float
    duration_delta_s: float | None = Field(description="Walking-time delta (Phase 4 amendment 11)")
    end_changed: bool


class DiffStop(BaseModel):
    role: Literal["checkpoint", "via", "must_use"]
    label: str
    place_id: str | None


class DiffOut(BaseModel):
    """The diff against the previous version (Phase 4 amendment 6; typed in Phase 5, A3)."""

    from_version: int
    changed: list[str] = Field(description="JSON pointers that differ between the two requests")
    outcome: DiffOutcome
    length_delta_m: float | None = Field(description="The first paired alternative's foot-length delta")
    duration_delta_s: float | None
    end_changed: bool | None
    candidates: list[DiffCandidate]
    candidates_added: list[str] = Field(description='"label/option" of alternatives new in this version')
    candidates_removed: list[str]
    stops_added: list[DiffStop]
    stops_removed: list[DiffStop]


class PlanVersionOut(BaseModel):
    plan_id: uuid.UUID
    version: int
    source: Source
    created_at: datetime
    outcome: Literal["ok", "over_budget", "infeasible", "disconnected", "unsupported"]
    request: RouteRequest
    candidates: list[CandidateOut]
    conflict: ConflictOut | None
    facts: dict[str, Any] = Field(description="The solver's facts object, unchanged")
    flags: list[Flag]
    explanation: str
    diff: DiffOut | None = Field(description="Against the previous version; null for version 1")
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


# ---------------------------------------------------------------- routes, saved routes, share


class LineStringZ(BaseModel):
    type: Literal["LineString"] = "LineString"
    coordinates: list[tuple[float, float, float]] = Field(description="[lon, lat, height]: the solver's geometry, "
                                                                      "height from Valhalla's DEM")


class RouteFeature(BaseModel):
    """One route as a GeoJSON Feature. `properties` are the solver's Candidate fields (lengths, stops, end, road
    classes, flags) plus where it belongs."""

    type: Literal["Feature"] = "Feature"
    id: uuid.UUID
    geometry: LineStringZ
    properties: dict[str, Any]


class KmMark(BaseModel):
    km: int
    at_m: float = Field(description="Distance along the route, measured from the geometry")
    lon: float
    lat: float


class ElevationOut(BaseModel):
    route_id: uuid.UUID
    step_m: float = Field(description="Sampling step along the route")
    profile: list[tuple[float, float]] = Field(description="[distance along the route in m, height in m]. "
                                                           "Distances measured from the geometry, heights raw DEM")
    points: list[tuple[float, float]] = Field(description="[lon, lat] of each profile sample, same order "
                                                          "(Phase 5 A5): where a chart cursor sits on the map")
    km_marks: list[KmMark] = Field(description="The position of every whole kilometre along the route")
    smoothed: list[float] = Field(description="Heights as the solver smooths them for gain and loss (bridges "
                                              "bridged, moving average), one per profile sample: draw this "
                                              "(Phase 5 amendment 14)")
    climb_approximate: bool
    gain_m: float | None = Field(description="The solver's smoothed climb (not recomputed from the profile)")
    loss_m: float | None


class SaveIn(BaseModel):
    name: str | None = Field(None, max_length=200)


class SavedOut(BaseModel):
    saved_id: uuid.UUID
    route_id: uuid.UUID
    name: str | None
    share_slug: str
    share_url: str
    created_at: datetime


class SavedRouteOut(SavedOut):
    plan_id: uuid.UUID
    version: int
    label: str
    option: str
    foot_m: float
    end_label: str | None


class SharedRouteOut(BaseModel):
    name: str | None
    shared_at: datetime
    summary: str = Field(description="Template text for this route; numbers from the solver's result only")
    route: RouteFeature
    gpx_url: str


# ---------------------------------------------------------------- places


class PlaceOut(BaseModel):
    place_id: str = Field(description='OSM id, e.g. "osm:node/1770460252": use it with the coordinates in a request')
    label: str
    kind: str = Field(description="OSM key=value, e.g. place=village")
    county: str | None = Field(description="Photon's county: a district or a taluk")
    city: str | None
    street: str | None
    state: str
    lon: float
    lat: float
    extent: list[float] | None = Field(None, description="Bounding box of an area result (Photon)")


class AmbiguityReason(BaseModel):
    reason: Literal["same_name", "same_name_different_areas", "no_exact_match"]
    name: str
    count: int | None = None
    counties: list[str] | None = None


class PlaceSearchOut(BaseModel):
    query: str
    source: Literal["photon"]
    ambiguous: bool = Field(description="Show a picker: the API never picks a place")
    reasons: list[AmbiguityReason]
    candidates: list[PlaceOut] = Field(description="Every Kerala result, in Photon's order")


class ReverseOut(BaseModel):
    source: Literal["photon"]
    place: PlaceOut | None = Field(description="Null when Photon has nothing in Kerala at that point")


# ---------------------------------------------------------------- OSM features (Phase 5 A6)


class FeatureItemOut(BaseModel):
    """A request item built from OSM data in the pinned extract. Exactly one of the four is set, matching
    `role`; insert it into the request's list of that name (`avoid` for avoid) with a JSON Patch `add`."""

    role: Literal["checkpoint", "via", "must_use", "avoid"]
    checkpoint: Checkpoint | None = None
    via: Via | None = None
    must_use: MustUse | None = None
    avoid: AvoidItem | None = None
    extract: str = Field(description="The OSM extract's timestamp (the pin) the geometry comes from")


class NearbyWay(BaseModel):
    place_id: str = Field(description='"osm:way/N": pass it to /v1/features/item as a bridge or road')
    label: str = Field(description="The OSM name, or a description when the way has none")
    name: str | None
    highway: str
    bridge: bool


class NearbyOut(BaseModel):
    ways: list[NearbyWay] = Field(description="Highway ways near the point, nearest first")
    extract: str
