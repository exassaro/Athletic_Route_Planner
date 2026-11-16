"""Independent reference values for the KPI harness.

Deliberately naive and separate from the solver: it routes EVERY order of the
checkpoints, one full engine route per order, and measures each result from its
geometry (WGS84 ellipsoid) minus ferry metres from edge attributes. No matrix,
no dynamic programming, no cutting. The solver's conflict numbers are checked
against what this produces on the pinned graph.
"""

import itertools
from dataclasses import dataclass

from athlete_engine import geodesy
from athlete_engine.measure import leg_shapes
from athlete_engine.measure import measure_route as measure
from athlete_engine.policy import pedestrian_options
from athlete_engine.valhalla import Valhalla, ValhallaError, loc

LonLat = tuple[float, float]


@dataclass
class Measured:
    foot_m: float
    ferry_m: float
    geom_m: float


def measure_route(engine: Valhalla, points: list[LonLat], ferries_allowed: bool) -> Measured | None:
    """Route through points (all break locations); foot metres = geometry length minus ferry edges."""
    options = pedestrian_options(ferries_allowed)
    try:
        resp = engine.route([loc(p, type="break") for p in points], costing_options=options)
    except ValhallaError:
        return None
    if not ferries_allowed:
        geom_m = sum(geodesy.line_length_m(s) for s in leg_shapes(resp))
        return Measured(foot_m=geom_m, ferry_m=0.0, geom_m=geom_m)
    m = measure(engine, resp)
    return Measured(foot_m=m.foot_m, ferry_m=m.ferry_m, geom_m=m.geom_m)


def minimum_through(engine: Valhalla, start: LonLat, stops: dict[str, LonLat], ferries_allowed: bool,
                    fixed_order: bool) -> tuple[list[str], Measured] | None:
    """Shortest (foot metres) route from start through all stops, trying every order unless fixed."""
    names = list(stops)
    orders = [names] if fixed_order else [list(p) for p in itertools.permutations(names)]
    best = None
    for order in orders:
        m = measure_route(engine, [start, *(stops[n] for n in order)], ferries_allowed)
        if m is not None and (best is None or m.foot_m < best[1].foot_m):
            best = (order, m)
    return best


def reference_for(engine: Valhalla, start: LonLat, stops: dict[str, LonLat], target: LonLat | None,
                  budget_m: float, tolerance_pct: float, ferries_allowed: bool, fixed_order: bool) -> dict:
    upper = budget_m * (1 + tolerance_pct / 100)
    out: dict = {"budget_upper_m": upper}
    if stops:
        best = minimum_through(engine, start, stops, ferries_allowed, fixed_order)
        if best is None:
            return {**out, "outcome": "disconnected"}
        order, m = best
        out.update(order=order, minimum_m=round(m.foot_m, 1), minimum_ferry_m=round(m.ferry_m, 1))
    else:
        order, out["minimum_m"] = [], 0.0

    if out["minimum_m"] > upper:
        savings = []
        for name in stops:
            rest = {k: v for k, v in stops.items() if k != name}
            alt = minimum_through(engine, start, rest, ferries_allowed, fixed_order) if rest else None
            alt_m = alt[1].foot_m if alt else 0.0
            savings.append({"action": "drop_checkpoint", "label": name,
                            "saves_m": round(out["minimum_m"] - alt_m, 1), "fits": alt_m <= upper})
        if not ferries_allowed:
            alt = minimum_through(engine, start, stops, True, fixed_order)
            if alt is not None:
                savings.append({"action": "allow", "preference": "ferries",
                                "saves_m": round(out["minimum_m"] - alt[1].foot_m, 1),
                                "fits": alt[1].foot_m <= upper})
        out.update(outcome="infeasible", savings=savings)
        return out

    out["outcome"] = "ok"
    if target is not None:
        last = stops[order[-1]] if order else start
        tail = measure_route(engine, [last, target], ferries_allowed)
        if tail is None:
            out["outcome"] = "disconnected"
            return out
        remainder = budget_m - out["minimum_m"]
        out.update(remainder_m=round(remainder, 1), tail_foot_m=round(tail.foot_m, 1),
                   case="A" if tail.foot_m >= remainder else "B")
    return out
