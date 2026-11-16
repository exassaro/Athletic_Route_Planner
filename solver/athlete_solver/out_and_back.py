"""Out-and-back (blueprint section 8): half the budget out in the requested direction, then back the same way.

The outward half is built exactly like a point-to-point run (cut at D/2 on the
ellipsoid, snapped to a junction inside the window, re-routed as one request);
the return is the same geometry reversed, so its length is identical by
construction. Repeated edges are expected and are not penalised.
"""

from athlete_engine import geodesy
from athlete_engine.measure import Edge

from .engine import Engine, NoRoute, Routed
from .models import Flag, RouteRequest
from .p2p import bearing_tail, make_candidate, truncate


def mirrored(out: Routed) -> Routed:
    """The outward run followed by the same path walked back."""
    back = list(reversed(out.shape))
    back_edges = [Edge(id=e.id, way_id=e.way_id, use=e.use, road_class=e.road_class, names=e.names,
                       shape=list(reversed(e.shape)), length_m=e.length_m) for e in reversed(out.edges)]
    return Routed(legs=[out.shape, back], leg_foot_m=[out.foot_m, out.foot_m], engine_m=2 * out.engine_m,
                  duration_s=None if out.duration_s is None else 2 * out.duration_s, ferry_m=2 * out.ferry_m,
                  edges=out.edges + back_edges, junctions=[], flags=list(out.flags))


def solve_out_and_back(req: RouteRequest, eng: Engine) -> tuple[list, dict, list[Flag]]:
    """Returns (candidates, facts, flags). An empty candidate list means no outward route was found."""
    start = req.start.lonlat
    half = req.target_distance_m / 2
    facts: dict = {"half_m": half}
    if req.direction.kind == "towards_place":
        target = req.direction.place.lonlat
        try:
            tail = eng.route([start, target], detail=True)
        except NoRoute:
            return [], facts, [Flag(code="preference_unsupported", message="no walking route towards the place")]
        facts["to_target_m"] = round(tail.foot_m, 1)
        if tail.foot_m < half:
            # The place is nearer than the turnaround: turn at the place itself.
            out = eng.route([start, target], detail=True)
            flags = [Flag(code="short_of_budget",
                          message=f"the place is {tail.foot_m / 1000:.1f} km away, so the out-and-back is "
                                  f"{2 * tail.foot_m / 1000:.1f} km", data={"short_by_m": round(req.target_distance_m - 2 * tail.foot_m, 1)})]
            kind = "target"
        else:
            out, kind, flags, cut = truncate(req, eng, [start], tail, half, goal_m=half)
            facts.update(cut)
    else:
        found = bearing_tail(eng, start, req.direction.degrees, half, measure_from=start)
        if found is None:
            return [], facts, [Flag(code="preference_unsupported",
                                    message=f"no walkable turnaround found near bearing {req.direction.degrees:.0f}")]
        out, kind, flags, cut = truncate(req, eng, [start], found.tail, half, goal_m=half)
        facts.update(cut)

    turn = out.shape[-1]
    facts["turnaround"] = {"lon": turn[0], "lat": turn[1], "kind": kind,
                           "bearing_deg": round(geodesy.bearing_deg(start, turn), 1)}
    cand = make_candidate(req, mirrored(out), "direct", "start", [], flags)
    facts["deviation_m"] = round(cand.deviation_m, 1)
    return [cand], facts, []
