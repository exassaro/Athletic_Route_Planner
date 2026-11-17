"""Independent reference values for the KPI harness.

Deliberately naive and separate from the solver: it routes EVERY order of the
checkpoints, one full engine route per order, and measures each result from its
geometry (WGS84 ellipsoid). Ferries are always excluded. No matrix, no dynamic
programming, no cutting. The solver's conflict numbers are checked
against what this produces on the pinned graph.
"""

import itertools
from dataclasses import dataclass

from athlete_engine import geodesy
from athlete_engine.measure import leg_shapes
from athlete_engine.policy import pedestrian_options
from athlete_engine.valhalla import Valhalla, ValhallaError, loc

LonLat = tuple[float, float]


@dataclass
class Measured:
    foot_m: float


def measure_route(engine: Valhalla, points: list[LonLat]) -> Measured | None:
    """Route through points (all break locations) and measure the geometry."""
    try:
        resp = engine.route([loc(p, type="break") for p in points], costing_options=pedestrian_options())
    except ValhallaError:
        return None
    return Measured(foot_m=sum(geodesy.line_length_m(s) for s in leg_shapes(resp)))


def minimum_through(engine: Valhalla, start: LonLat, stops: dict[str, LonLat],
                    fixed_order: bool, end: LonLat | None = None) -> tuple[list[str], Measured] | None:
    """Shortest (foot metres) route from start through all stops (then to a fixed end, if given),
    trying every order unless fixed."""
    names = list(stops)
    orders = [names] if fixed_order else [list(p) for p in itertools.permutations(names)]
    best = None
    for order in orders:
        m = measure_route(engine, [start, *(stops[n] for n in order), *([end] if end else [])])
        if m is not None and (best is None or m.foot_m < best[1].foot_m):
            best = (order, m)
    return best


def reference_for(engine: Valhalla, start: LonLat, stops: dict[str, LonLat], target: LonLat | None,
                  budget_m: float, tolerance_m: float, fixed_order: bool, fixed_end: LonLat | None = None) -> dict:
    upper = budget_m + tolerance_m
    out: dict = {"budget_upper_m": upper}
    if stops or fixed_end:
        best = minimum_through(engine, start, stops, fixed_order, fixed_end)
        if best is None:
            return {**out, "outcome": "disconnected"}
        order, m = best
        out.update(order=order, minimum_m=round(m.foot_m, 1))
    else:
        order, out["minimum_m"] = [], 0.0

    if out["minimum_m"] > upper:
        savings = []
        for name in stops:
            rest = {k: v for k, v in stops.items() if k != name}
            alt = minimum_through(engine, start, rest, fixed_order, fixed_end) if rest or fixed_end else None
            alt_m = alt[1].foot_m if alt else 0.0
            savings.append({"action": "drop_checkpoint", "label": name,
                            "saves_m": round(out["minimum_m"] - alt_m, 1), "fits": alt_m <= upper})
        out.update(outcome="over_budget", savings=savings)
        return out

    out["outcome"] = "ok"
    if fixed_end is not None:
        out.update(case="fixed_end", short_by_m=round(budget_m - out["minimum_m"], 1))
        return out
    if target is not None:
        last = stops[order[-1]] if order else start
        tail = measure_route(engine, [last, target])
        if tail is None:
            out["outcome"] = "disconnected"
            return out
        remainder = budget_m - out["minimum_m"]
        out.update(remainder_m=round(remainder, 1), tail_foot_m=round(tail.foot_m, 1),
                   case="A" if tail.foot_m >= remainder else "B")
    return out


def loop_gate_reference(engine: Valhalla, start: LonLat, stops: list[tuple[str, LonLat, bool]],
                        budget_m: float, tolerance_m: float) -> dict:
    """Loops with stops: the first stop a loop cannot reach and come back from within the budget.

    `stops` are (label, point, passed_near). The way there is routed and measured; reaching needs twice that,
    passing near (within 1 km on foot) twice (that - 1 km). Outcome "loop_stop_too_far" or "loop_stops".
    """
    upper = budget_m + tolerance_m
    for label, point, near in stops:
        m = measure_route(engine, [start, point])
        if m is None:
            return {"outcome": "disconnected", "label": label}
        least = 2 * (m.foot_m - 1000.0) if near else 2 * m.foot_m
        if least > upper:
            return {"outcome": "loop_stop_too_far", "label": label, "minimum_m": round(least, 1),
                    "there_m": round(m.foot_m, 1)}
    return {"outcome": "loop_stops"}
