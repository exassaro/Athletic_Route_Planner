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
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer, model_validator
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
    """The diff against the version the edit was based on (`from_version`): the previous one, unless the PATCH
    named an earlier one (Phase 4 amendment 6; typed in Phase 5, A3; Phase 5c A11)."""

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


class OverviewPoint(BaseModel):
    lon: float
    lat: float
    at_m: float = Field(description="Distance along the route, measured from the geometry")


class OverviewPointsOut(BaseModel):
    """Waypoints for a Google Maps overview link (Phase 5d A14). Valhalla stands in for Google."""

    points: list[OverviewPoint] = Field(description="The waypoints in route order, at most `max`. The route's start "
                                                    "and end are fixed and not among them")
    max_deviation_m: float = Field(description="The worst straight-line distance between our line and Valhalla's "
                                               "walking path through the points, leg by leg. Never a route distance")
    overlap_pct: float = Field(description="The share of our length within 30 m of that path, leg by leg, rounded "
                                           "down. An estimate: tested with our router, not with Google")


class FollowStep(BaseModel):
    at_m: float = Field(description="Distance along the route to the turn, measured from the geometry")
    turn: Literal["left", "right", "around"]
    road: str | None = Field(description="The road turned onto, from OSM. Null: unnamed, the road the runner is "
                                         "already on, or no Valhalla")


class FollowCue(FollowStep):
    then: list[FollowStep] = Field(description='Turns that follow under 50 m apart, in order: "turn right, then left"')


class FollowOut(BaseModel):
    """Everything Follow mode needs of the route, fetched once before the run (Phase 5d A15)."""

    route_id: uuid.UUID
    points: list[tuple[float, float]] = Field(description="[lon, lat] of every vertex: the stored geometry")
    along_m: list[float] = Field(description="Distance along the route at each of `points`, measured from the "
                                             "geometry. The last is the route's length")
    cue_source: Literal["junctions", "geometry"] = Field(
        description='"geometry": Valhalla could not be asked, so every bend over 35 degrees is a cue and none has '
                    "a road name")
    cues: list[FollowCue]


class SaveIn(BaseModel):
    name: str | None = Field(None, max_length=200)
    as_new: bool | None = Field(None, description="true: always a new saved route with a new share link. Otherwise "
                                                  "the most recently updated saved route of this route is renamed "
                                                  "(Phase 5c A12)")


class SavedPatch(BaseModel):
    """What to change on a saved route; fields left out stay (Phase 5c amendments 2 and 3)."""

    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, max_length=80, description="Trimmed; at most 80 characters; empty becomes null")
    route_id: uuid.UUID | None = Field(None, description="One of this client's routes: the saved route then shows "
                                                         "it, under the same share link")

    @field_validator("name", mode="before")
    @classmethod
    def trimmed(cls, value: Any) -> Any:
        return (value.strip() or None) if isinstance(value, str) else value

    @model_validator(mode="after")
    def route_not_cleared(self):
        if "route_id" in self.model_fields_set and self.route_id is None:
            raise ValueError("route_id cannot be null")
        return self


class SavedOut(BaseModel):
    saved_id: uuid.UUID
    route_id: uuid.UUID
    name: str | None
    share_slug: str
    share_url: str
    created_at: datetime
    updated_at: datetime = Field(description="The last rename or update (not a delete or restore)")


class SavedRouteOut(SavedOut):
    plan_id: uuid.UUID
    version: int
    plan_version: int = Field(description="The plan version this route belongs to, to edit from (the same as `version`)")
    label: str
    option: str
    foot_m: float
    end_label: str | None


class SharedRouteOut(BaseModel):
    name: str | None
    shared_at: datetime
    summary: str = Field(description="Template text for this route; numbers from the solver's result only")
    route: RouteFeature
    updated_at: datetime = Field(description="When the saved route was last renamed or updated (Phase 5c A13)")
    is_owner: bool = Field(description="True only when the request's X-Client-Token owns this saved route")
    km_marks: list[KmMark] = Field(description="The position of every whole kilometre along the route, as in the "
                                               "elevation response (Phase 5b A9)")
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
