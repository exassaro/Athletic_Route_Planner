"""Request, candidate, conflict and result models.

RouteRequest follows blueprint section 4, with the Phase 2 and Phase 3 amendments:
- ferries are always excluded (Phase 3 amendment 4); ferry metres are still measured, as a check;
- the solver takes coordinates: geocoding happens before it (Phase 4).

All distances are metres. A Candidate's lengths are measured from its geometry
on the WGS84 ellipsoid; the engine's own length is kept only for the
consistency check.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_CHECKPOINTS = 8
MAX_STOPS = 10     # checkpoints + via + must_use, ordered together by exact DP
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


LineCoords = list[tuple[Lon, Lat]]


class Checkpoint(Point):
    """A stop on the run (Phase 3 amendment 3, decisions 11, 16, 17).

    kind "place" (default): the route passes within 1 km on foot of the point, without a spur; with
    must_reach it reaches the point itself (a break location, within 50 m of where it meets the network).
    kind "junction": the route passes through the point. kind "bridge" / "road": the route uses one of the
    OSM ways in `way_ids` (geometry in `lines`, from OSM). The point (lon, lat) is the item's middle and is
    used for ordering. `boundary` is the place's OSM boundary polygon (GeoJSON), for the fallback.
    """

    label: str
    mandatory: bool = True
    kind: Literal["place", "junction", "bridge", "road"] = "place"
    # "checkpoint": a named stop (reported, can be dropped when over budget). The solver also turns the
    # request's `via` items (shaping only) and `must_use` items into stops with these roles.
    role: Literal["checkpoint", "via", "must_use"] = "checkpoint"
    must_reach: bool = False
    way_ids: list[int] = Field(default_factory=list)
    lines: list[LineCoords] = Field(default_factory=list)
    boundary: dict | None = None

    @model_validator(mode="after")
    def _kind_rules(self) -> "Checkpoint":
        if self.kind in ("bridge", "road") and (not self.way_ids or not self.lines):
            raise ValueError(f"{self.kind} checkpoint {self.label!r} needs its OSM way_ids and lines")
        if self.must_reach and self.kind != "place":
            raise ValueError("must_reach applies to place checkpoints")
        if self.boundary is not None and self.boundary.get("type") not in ("Polygon", "MultiPolygon"):
            raise ValueError("boundary must be a GeoJSON Polygon or MultiPolygon")
        return self

    @property
    def pass_near(self) -> bool:
        return self.kind == "place" and not self.must_reach


class Via(Strict):
    """Shaping only (Phase 3 amendment 7): pass near a point, or use a named road. Never dropped, not a stop."""

    kind: Literal["place", "road"] = "place"
    lon: Lon
    lat: Lat
    label: str | None = None
    place_id: str | None = None
    way_ids: list[int] = Field(default_factory=list)       # road: its OSM ways
    lines: list[LineCoords] = Field(default_factory=list)  # road: their geometry (from OSM)

    @model_validator(mode="after")
    def _road(self) -> "Via":
        if self.kind == "road" and (not self.way_ids or not self.lines):
            raise ValueError("a road via needs its OSM way_ids and lines")
        return self


class MustUse(Strict):
    """A named bridge or road the route must use (Phase 3 amendment 7). Never dropped."""

    kind: Literal["bridge", "road"]
    lon: Lon                  # the item's middle (ordering)
    lat: Lat
    label: str
    place_id: str | None = None
    way_ids: list[int] = Field(min_length=1)
    lines: list[LineCoords] = Field(min_length=1)


class AvoidItem(Strict):
    """Something the route must not use (Phase 3 amendment 7): a place, a road or an area.

    place: `polygon` (its OSM boundary) or a circle of `radius_m` round (lon, lat). area: `polygon`.
    road: its OSM `way_ids` (and `lines`, for the shortest alternative's engine).
    """

    kind: Literal["place", "road", "area"]
    label: str
    lon: Lon | None = None
    lat: Lat | None = None
    radius_m: Annotated[float, Field(gt=0, le=5000)] = 300.0
    polygon: dict | None = None
    way_ids: list[int] = Field(default_factory=list)
    lines: list[LineCoords] = Field(default_factory=list)

    @model_validator(mode="after")
    def _shape(self) -> "AvoidItem":
        if self.polygon is not None and self.polygon.get("type") not in ("Polygon", "MultiPolygon"):
            raise ValueError("polygon must be a GeoJSON Polygon or MultiPolygon")
        if self.kind == "area" and self.polygon is None:
            raise ValueError(f"area {self.label!r} needs a polygon")
        if self.kind == "place" and self.polygon is None and (self.lon is None or self.lat is None):
            raise ValueError(f"place {self.label!r} needs a polygon or a point")
        if self.kind == "road" and (not self.way_ids or not self.lines):
            raise ValueError(f"road {self.label!r} needs its OSM way_ids and lines")
        return self


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


class Preferences(Strict):
    hills: Literal["any", "minimise"] = "any"            # unsupported in the MVP (amendment 3)
    surface: Literal["any", "paved"] = "any"             # unsupported: surface tags too sparse
    # Phase 3 amendment 2(d): footways, paths, tracks and steps only when nothing else connects,
    # unless the user asks for them.
    paths: Literal["avoid", "allow"] = "avoid"


class RouteRequest(Strict):
    activity: Literal["run"] = "run"
    route_type: Literal["point_to_point", "out_and_back", "loop"]
    start: Point
    target_distance_m: Annotated[float, Field(gt=0, le=MAX_DISTANCE_M)]
    tolerance_m: Annotated[float, Field(gt=0, le=5000)] = 500.0   # Phase 3 amendment 5: +-500 m
    direction: Annotated[TowardsPlace | Bearing, Field(discriminator="kind")] | None = None
    end: Annotated[AutoEnd | FixedEnd, Field(discriminator="kind")] = Field(default_factory=AutoEnd)
    checkpoints: list[Checkpoint] = Field(default_factory=list, max_length=MAX_CHECKPOINTS)
    checkpoint_order: Literal["auto", "fixed"] = "auto"
    via: list[Via] = Field(default_factory=list, max_length=MAX_CHECKPOINTS)
    must_use: list[MustUse] = Field(default_factory=list, max_length=4)
    avoid: list[AvoidItem] = Field(default_factory=list, max_length=20)
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
        if self.route_type == "out_and_back" and (self.checkpoints or self.via or self.must_use):
            raise ValueError("out_and_back does not take checkpoints, via or must_use yet")
        if len(self.checkpoints) + len(self.via) + len(self.must_use) > MAX_STOPS:
            raise ValueError(f"at most {MAX_STOPS} checkpoints, via and must_use items together")
        labels = [c.label for c in self.checkpoints] + [m.label for m in self.must_use]
        if len(set(labels)) != len(labels):
            raise ValueError("checkpoint and must_use labels must be distinct")
        if any(c.role != "checkpoint" for c in self.checkpoints):
            raise ValueError("checkpoint roles are set by the solver; use via and must_use")
        if self.route_type == "out_and_back" and self.direction is None:
            raise ValueError("out_and_back needs a direction (towards_place or bearing)")
        if self.end.kind == "fixed" and self.route_type != "point_to_point":
            raise ValueError("a fixed end only applies to point_to_point")
        return self

    def stops(self) -> list[Checkpoint]:
        """Checkpoints, then via and must_use items as stops with their roles (one list for ordering)."""
        out = list(self.checkpoints)
        if any(c.role != "checkpoint" for c in out):   # already expanded (the solver's working copy)
            return out
        for k, v in enumerate(self.via, start=1):
            out.append(Checkpoint(lon=v.lon, lat=v.lat, label=v.label or f"via {k}", kind=v.kind, role="via",
                                  way_ids=v.way_ids, lines=v.lines))
        for m in self.must_use:
            out.append(Checkpoint(lon=m.lon, lat=m.lat, label=m.label, kind=m.kind, role="must_use",
                                  way_ids=m.way_ids, lines=m.lines))
        return out

    @property
    def upper_m(self) -> float:
        """The longest run that still counts as the requested distance."""
        return self.target_distance_m + self.tolerance_m


# ---------------------------------------------------------------- results


FlagCode = Literal[
    "engine_warning",           # carried from the engine response (amendment 6)
    "engine_length_mismatch",   # engine vs spherical measurement over 0.1% / 2 m + 0.2 m per edge
    "endpoint_mid_road",        # no junction within the snap window; ends at the exact distance
    "preference_unsupported",   # e.g. hills, surface in the MVP
    "checkpoint_far_from_network",
    "reroute_mismatch",         # re-routed candidate differs from the cut geometry beyond tolerance
    "uses_national_highway",    # 200 m or more of trunk/motorway in one stretch (decision 12)
    "crosses_national_highway", # shorter trunk/motorway use: a crossing (decision 12)
    "short_of_budget",          # Case B "end at target": the run is shorter than requested
    "direction_limited",        # no walking endpoint lies within 30 degrees of the requested bearing
    "repeated_edges",           # more than 10% walked twice (rejected only beyond what must_reach stops force)
    "spur",                     # dead-end excursion over 100 m
    "alternative_unavailable",  # an alternative could not be produced (engine down, no route)
    "alternative_over_budget",  # this alternative's own route through the stops exceeds the budget
    "pass_near_boundary",       # no spur-free pass point within 1 km on foot: passes inside the OSM boundary
    "pass_near_spur",           # no spur-free pass point at all: the stop is reached with a spur
    "avoid_unmet",              # the route still touches something the request asked to avoid
    "detour_eased",             # "recommended" was over 30% longer than "shortest": road penalties eased
    "lengthened",               # section 8 step 10: one via added on the longest leg to reach the distance
    "direction_ignored",        # a fixed end was given, so the requested direction is not used
    "loop_not_found",           # no loop shape came within tolerance and no out-and-back either
    "loop_fallback",            # fewer than two loop shapes fit: an out-and-back is offered (section 8)
]


class Flag(Strict):
    code: FlagCode
    message: str
    data: dict = Field(default_factory=dict)


class StopOnRoute(Strict):
    role: Literal["start", "checkpoint", "via", "must_use", "end"]   # via: shaping only, not shown as a stop
    label: str | None = None
    requested: Point
    snapped_lon: float       # where the route passes the stop (pass-near: the pass point on the route)
    snapped_lat: float
    offset_m: float          # requested point to that point (straight line)
    at_m: float              # distance on foot along the route to this stop
    kind: Literal["place", "junction", "bridge", "road"] | None = None
    must_reach: bool = False
    pass_walk_m: float | None = None   # pass-near: walking distance from the place to the route (Valhalla)
    how: Literal["reached", "on_route", "via", "boundary", "spur", "uses"] | None = None


class EndPoint(Strict):
    lon: float
    lat: float
    label: str | None = None
    kind: Literal["junction", "mid_road", "target", "fixed", "last_checkpoint", "start"]  # "start": out-and-back


Alternative = Literal["recommended", "shortest",   # Phase 3 amendment 9 (point-to-point, out-and-back)
                      "loop_1", "loop_2", "loop_3", "loop_4"]   # amendment 23: loops, best first
Option = Literal[
    "main",                    # the run as requested
    "end_at_target",           # Case B: stop at the target and report the shortfall
    "continue_past_target",    # Case B: carry on past the target for the rest of the budget
    "detour_to_target",        # Case B: end at the target with a detour on an earlier leg (section 8 step 10)
    "full_route",              # over budget: the whole route through the stops (Phase 3 amendment 6)
    "cut_at_target",           # over budget: the same route cut at the requested distance
    "out_and_back",            # a loop request on a sparse network: out and back instead (flag loop_fallback)
    "short_loop",              # a loop through the stops that no detour could lengthen (flag short_of_budget)
]


class Candidate(Strict):
    label: Alternative          # which alternative: "recommended" (GraphHopper, rules) or "shortest" (Valhalla)
    option: Option = "main"
    geometry: list[tuple[float, float]]
    length_m: float          # ellipsoid geometry length, foot + ferry
    foot_m: float            # what the budget counts
    ferry_m: float = 0.0
    engine_length_m: float
    sphere_length_m: float   # spherical measurement on the engine's own earth radius
    engine: Literal["valhalla", "graphhopper"] = "valhalla"
    edge_count: int = 0      # edges the route uses (for the per-edge rounding allowance)
    deviation_m: float       # foot_m - target
    duration_s: float | None = None
    gain_m: float | None = None
    loss_m: float | None = None
    stops: list[StopOnRoute]
    end: EndPoint
    road_class_m: dict[str, float] = Field(default_factory=dict)
    # [from_m, to_m] along the route of each bridge: its heights are bridged in the climb (Phase 5 amendment 13)
    bridges_m: list[tuple[float, float]] = Field(default_factory=list)
    repeat_share: float | None = None
    backtrack_share: float | None = None
    score: float | None = None
    edge_ids: list[int] = Field(default_factory=list, repr=False)
    flags: list[Flag] = Field(default_factory=list)

    @property
    def deviation_pct(self) -> float:
        return abs(self.deviation_m) / (self.foot_m - self.deviation_m) * 100.0


class Saving(Strict):
    action: Literal["drop_checkpoint"]
    label: str | None = None          # checkpoint label
    saves_m: float                    # measured: minimum length now minus minimum length with the change
    fits: bool                        # whether the request fits the budget with this change alone


class Fix(Strict):
    action: Literal["set_distance", "drop_checkpoint", "make_optional"]
    value_m: float | None = None
    label: str | None = None


class Conflict(Strict):
    kind: Literal["checkpoints_exceed_distance", "disconnected", "snap_too_far", "inside_avoided",
                  "loop_stop_too_far"]   # a loop cannot reach a stop and come back within the distance
    # checkpoints_exceed_distance comes with outcome "over_budget" and the full and cut candidates
    message: str
    requested_m: float | None = None
    minimum_m: float | None = None    # measured foot metres of the shortest route through all stops
    overshoot_m: float | None = None  # minimum_m - requested budget upper bound
    order: list[str] = Field(default_factory=list)
    pair: list[str] = Field(default_factory=list)          # disconnected: the two points
    savings: list[Saving] = Field(default_factory=list)
    fixes: list[Fix] = Field(default_factory=list)


class SolveResult(Strict):
    # over_budget: the stops alone exceed the budget; candidates are the full route and a cut at the target.
    # infeasible: a point cannot be reached at all (snap too far). disconnected: no walking route.
    outcome: Literal["ok", "over_budget", "infeasible", "disconnected", "unsupported"]
    request: RouteRequest
    candidates: list[Candidate] = Field(default_factory=list)
    conflict: Conflict | None = None
    facts: dict = Field(default_factory=dict)   # numbers for the explanation layer
    flags: list[Flag] = Field(default_factory=list)
    graph_build: str
    engine_calls: int = 0
    elapsed_ms: float | None = None
