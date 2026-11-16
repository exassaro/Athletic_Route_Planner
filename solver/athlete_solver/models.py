"""Request, candidate, conflict and result models.

RouteRequest follows blueprint section 4, with the Phase 2 amendments:
- ferries are excluded unless `preferences.avoid` drops "ferries";
- the distance budget is distance on foot; ferry metres are reported separately;
- the solver takes coordinates: geocoding happens before it (Phase 4).

All distances are metres. A Candidate's lengths are measured from its geometry
on the WGS84 ellipsoid; the engine's own length is kept only for the
consistency check.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_CHECKPOINTS = 8
MAX_DISTANCE_M = 100_000.0  # Valhalla's pedestrian max_distance default


class Strict(BaseModel):
    """Unknown fields are errors: a misspelt preference must not be silently ignored."""

    model_config = ConfigDict(extra="forbid")


Lon = Annotated[float, Field(ge=-180, le=180)]
Lat = Annotated[float, Field(ge=-90, le=90)]


class Point(Strict):
    lon: Lon
    lat: Lat
    label: str | None = None
    place_id: str | None = None  # e.g. "osm:node/1683149581"

    @property
    def lonlat(self) -> tuple[float, float]:
        return (self.lon, self.lat)


class Checkpoint(Point):
    label: str
    mandatory: bool = True


class TowardsPlace(Strict):
    kind: Literal["towards_place"] = "towards_place"
    place: Point


class Bearing(Strict):
    kind: Literal["bearing"] = "bearing"
    degrees: Annotated[float, Field(ge=0, lt=360)]


class AutoEnd(Strict):
    kind: Literal["auto"] = "auto"


class FixedEnd(Strict):
    kind: Literal["fixed"] = "fixed"
    point: Point


Avoid = Literal["ferries", "highways"]


class Preferences(Strict):
    # "ferries" in avoid (the default) means a hard exclusion. "highways" is accepted for
    # compatibility with section 4; motorways are never walkable, so it changes nothing.
    avoid: list[Avoid] = Field(default_factory=lambda: ["ferries"])
    hills: Literal["any", "minimise"] = "any"            # unsupported in the MVP (amendment 3)
    quiet_roads: Annotated[float, Field(ge=0, le=1)] = 0.0
    surface: Literal["any", "paved"] = "any"             # unsupported: surface tags too sparse

    @property
    def ferries_allowed(self) -> bool:
        return "ferries" not in self.avoid


class RouteRequest(Strict):
    activity: Literal["run"] = "run"
    route_type: Literal["point_to_point", "out_and_back", "loop"]
    start: Point
    target_distance_m: Annotated[float, Field(gt=0, le=MAX_DISTANCE_M)]
    tolerance_pct: Annotated[float, Field(gt=0, le=10)] = 2.0
    direction: Annotated[TowardsPlace | Bearing, Field(discriminator="kind")] | None = None
    end: Annotated[AutoEnd | FixedEnd, Field(discriminator="kind")] = Field(default_factory=AutoEnd)
    checkpoints: list[Checkpoint] = Field(default_factory=list, max_length=MAX_CHECKPOINTS)
    checkpoint_order: Literal["auto", "fixed"] = "auto"
    preferences: Preferences = Field(default_factory=Preferences)
    alternatives: Annotated[int, Field(ge=1, le=4)] = 2

    @field_validator("checkpoints")
    @classmethod
    def _distinct_checkpoints(cls, value: list[Checkpoint]) -> list[Checkpoint]:
        seen = set()
        for cp in value:
            key = (round(cp.lon, 6), round(cp.lat, 6))
            if key in seen:
                raise ValueError(f"checkpoint {cp.label!r} repeats an earlier checkpoint's coordinates")
            seen.add(key)
        return value

    @model_validator(mode="after")
    def _type_rules(self) -> "RouteRequest":
        if self.route_type == "out_and_back" and self.checkpoints:
            raise ValueError("out_and_back does not take checkpoints yet")
        if self.route_type == "out_and_back" and self.direction is None:
            raise ValueError("out_and_back needs a direction (towards_place or bearing)")
        if self.end.kind == "fixed" and self.route_type != "point_to_point":
            raise ValueError("a fixed end only applies to point_to_point")
        return self

    @property
    def tolerance_m(self) -> float:
        return self.target_distance_m * self.tolerance_pct / 100.0


# ---------------------------------------------------------------- results


FlagCode = Literal[
    "engine_warning",           # carried from the engine response (amendment 6)
    "ferry_used",               # ferries were allowed and the route uses one
    "engine_length_mismatch",   # engine vs spherical measurement over 0.1% / 2 m
    "endpoint_mid_road",        # no junction within the snap window; ends at the exact distance
    "preference_unsupported",   # e.g. hills, surface in the MVP
    "checkpoint_far_from_network",
    "reroute_mismatch",         # re-routed candidate differs from the cut geometry beyond tolerance
    "unavoidable_main_road",
    "short_of_budget",
    "direction_limited",
    "repeated_edges",           # more than 10% walked twice (reported, not rejected; pending decision)
    "spur",                     # dead-end excursion over 100 m        # no walking endpoint lies within 30 degrees of the requested bearing          # Case B "end at target": the run is shorter than requested
]


class Flag(Strict):
    code: FlagCode
    message: str
    data: dict = Field(default_factory=dict)


class StopOnRoute(Strict):
    role: Literal["start", "checkpoint", "end"]
    label: str | None = None
    requested: Point
    snapped_lon: float
    snapped_lat: float
    offset_m: float          # requested point to where the route meets the network (straight line)
    at_m: float              # distance on foot along the route to this stop


class EndPoint(Strict):
    lon: float
    lat: float
    label: str | None = None
    kind: Literal["junction", "mid_road", "target", "fixed", "last_checkpoint", "start"]  # "start": out-and-back


class Candidate(Strict):
    label: Literal["direct", "fewer_main_roads", "end_at_target", "continue_past_target"]
    geometry: list[tuple[float, float]]
    length_m: float          # ellipsoid geometry length, foot + ferry
    foot_m: float            # what the budget counts
    ferry_m: float = 0.0
    engine_length_m: float
    sphere_length_m: float
    deviation_m: float       # foot_m - target
    duration_s: float | None = None
    gain_m: float | None = None
    loss_m: float | None = None
    stops: list[StopOnRoute]
    end: EndPoint
    road_class_m: dict[str, float] = Field(default_factory=dict)
    repeat_share: float | None = None
    backtrack_share: float | None = None
    score: float | None = None
    edge_ids: list[int] = Field(default_factory=list, repr=False)
    flags: list[Flag] = Field(default_factory=list)

    @property
    def deviation_pct(self) -> float:
        return abs(self.deviation_m) / (self.foot_m - self.deviation_m) * 100.0


class Saving(Strict):
    action: Literal["drop_checkpoint", "allow"]
    label: str | None = None          # checkpoint label for drop_checkpoint
    preference: Literal["ferries"] | None = None
    saves_m: float                    # measured: minimum length now minus minimum length with the change
    fits: bool                        # whether the request fits the budget with this change alone


class Fix(Strict):
    action: Literal["set_distance", "drop_checkpoint", "make_optional", "allow"]
    value_m: float | None = None
    label: str | None = None
    preference: Literal["ferries"] | None = None


class Conflict(Strict):
    kind: Literal["checkpoints_exceed_distance", "disconnected", "snap_too_far"]
    message: str
    requested_m: float | None = None
    minimum_m: float | None = None    # measured foot metres of the shortest route through all stops
    overshoot_m: float | None = None  # minimum_m - requested budget upper bound
    order: list[str] = Field(default_factory=list)
    pair: list[str] = Field(default_factory=list)          # disconnected: the two points
    blocking_preference: Literal["ferries"] | None = None  # disconnected: the cause, if known
    savings: list[Saving] = Field(default_factory=list)
    fixes: list[Fix] = Field(default_factory=list)


class SolveResult(Strict):
    outcome: Literal["ok", "infeasible", "disconnected", "unsupported"]
    request: RouteRequest
    candidates: list[Candidate] = Field(default_factory=list)
    conflict: Conflict | None = None
    facts: dict = Field(default_factory=dict)   # numbers for the explanation layer
    flags: list[Flag] = Field(default_factory=list)
    graph_build: str
    engine_calls: int = 0
    elapsed_ms: float | None = None
