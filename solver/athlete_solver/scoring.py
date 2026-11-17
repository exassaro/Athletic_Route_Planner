"""Scoring, hard rules and the diversity filter (blueprint section 8 table, amended after Phase 2).

Every measure comes from the candidate's geometry and the engine's edge data.
A hard-rule failure removes a candidate; a penalty only lowers its score.

Repeated edges: the blueprint makes more than 10% repetition a hard reject.
Phase 3 measured that a mandatory checkpoint on a dead-end (Chaliyam, with
ferries excluded) forces more than that on its own. Until the developer
decides, repetition is measured both raw and beyond what the stops force,
reported as a flag, and NOT used to reject (see docs/reports/phase3/kpi.md).
"""

from dataclasses import dataclass, field

from athlete_engine import geodesy
from athlete_engine.measure import Edge

from .engine import Engine
from .models import Candidate, Flag, RouteRequest

ELEVATION_STEP_M = 30.0       # section 9: sample every 25 to 50 m
SMOOTH_WINDOW = 5             # moving average over samples
CLIMB_THRESHOLD_M = 3.0       # count gain only above a 2 to 3 m threshold
SPUR_MIN_M = 100.0
REPEAT_LIMIT = 0.10           # section 8: hard above 10% unless out-and-back (see module note)
DIVERSITY_LIMIT = 0.60
MAIN_CLASSES = ("trunk", "primary")


@dataclass
class Measures:
    repeat_share: float
    forced_repeat_share: float
    spur_m: list[float] = field(default_factory=list)
    main_share: float = 0.0
    gain_m: float | None = None
    loss_m: float | None = None
    keys: set = field(default_factory=set)


# ------------------------------------------------------------------ measures

def repetition(edges: list[Edge], forced_until_m: float) -> tuple[float, float]:
    """(share of length on edges walked more than once, share of that already forced by the stops).

    Forced repetition is repetition among edges before `forced_until_m` (the route through the
    mandatory stops), which no endpoint choice can avoid.
    """
    total = sum(e.length_m for e in edges if e.use != "ferry") or 1.0
    counts: dict = {}
    for e in edges:
        counts[e.key] = counts.get(e.key, 0) + 1
    repeated = sum(e.length_m for e in edges if counts[e.key] > 1 and e.use != "ferry")
    run, base_counts, base_edges = 0.0, {}, []
    for e in edges:
        if run >= forced_until_m - 1.0:
            break
        base_edges.append(e)
        base_counts[e.key] = base_counts.get(e.key, 0) + 1
        if e.use != "ferry":
            run += e.length_m
    forced = sum(e.length_m for e in base_edges if base_counts[e.key] > 1 and e.use != "ferry")
    return repeated / total, min(forced, repeated) / total


def spurs(edges: list[Edge], allowed_turns_m: list[float]) -> list[float]:
    """Lengths of dead-end excursions: runs walked out and straight back on the same edges.

    A turn-round within 60 m of a checkpoint (or the out-and-back turnaround) is required by the
    request and not counted.
    """
    out = []
    keys = [e.key for e in edges]
    at, run = [], 0.0
    for e in edges:
        at.append(run)
        run += e.length_m if e.use != "ferry" else 0.0
    i = 1
    while i < len(keys):
        if keys[i] == keys[i - 1]:
            # mirrored run around the turn between i-1 and i
            n = 0
            while i - 1 - n >= 0 and i + n < len(keys) and keys[i - 1 - n] == keys[i + n]:
                n += 1
            length = sum(edges[i + t].length_m for t in range(n))
            turn_at = at[i]
            if length >= SPUR_MIN_M and not any(abs(turn_at - a) <= 60.0 for a in allowed_turns_m):
                out.append(length)
            i += max(n, 1)
        else:
            i += 1
    return out


def climb(engine: Engine, geometry: list) -> tuple[float, float] | tuple[None, None]:
    """Smoothed gain and loss: sample every 30 m, moving average, count changes above 3 m (hysteresis)."""
    samples = [p for p, _ in geodesy.sample_every(geometry, ELEVATION_STEP_M)]
    heights = engine.heights(samples)
    if not heights or any(h is None for h in heights):
        return None, None
    k = SMOOTH_WINDOW // 2
    smooth = [sum(heights[max(0, i - k):i + k + 1]) / len(heights[max(0, i - k):i + k + 1]) for i in range(len(heights))]
    gain = loss = 0.0
    anchor = smooth[0]
    for h in smooth[1:]:
        if h - anchor >= CLIMB_THRESHOLD_M:
            gain += h - anchor
            anchor = h
        elif anchor - h >= CLIMB_THRESHOLD_M:
            loss += anchor - h
            anchor = h
    return gain, loss


def measure(engine: Engine, req: RouteRequest, cand: Candidate, edges: list[Edge]) -> Measures:
    checkpoints_at = [s.at_m for s in cand.stops if s.role == "checkpoint"]
    forced_until = max(checkpoints_at, default=0.0)
    turns = list(checkpoints_at)
    if req.route_type == "out_and_back":
        turns.append(cand.foot_m / 2)
        forced_until = cand.foot_m  # all repetition is the point of an out-and-back
    rep, forced = repetition(edges, forced_until)
    foot = sum(e.length_m for e in edges if e.use != "ferry") or 1.0
    main = sum(e.length_m for e in edges if e.road_class in MAIN_CLASSES and e.use != "ferry")
    gain, loss = climb(engine, cand.geometry)
    return Measures(repeat_share=rep, forced_repeat_share=forced, spur_m=spurs(edges, turns),
                    main_share=main / foot, gain_m=gain, loss_m=loss,
                    keys={e.key for e in edges if e.use != "ferry"})


# ------------------------------------------------------------------ rules and score

def hard_failures(req: RouteRequest, cand: Candidate, m: Measures) -> list[str]:
    fails = []
    if cand.label in ("direct", "fewer_main_roads", "continue_past_target") and \
            abs(cand.deviation_m) > req.tolerance_m:
        fails.append(f"distance off by {cand.deviation_m:+.0f} m, over the {req.tolerance_m:.0f} m tolerance")
    if cand.ferry_m > 0:
        fails.append(f"{cand.ferry_m:.0f} m on a ferry (ferries are always excluded)")
    for s in cand.stops:
        if s.role == "checkpoint":
            off = geodesy.distance_m((s.snapped_lon, s.snapped_lat), _nearest_on(cand.geometry, s))
            if off > 50.0:
                fails.append(f"misses checkpoint {s.label} by {off:.0f} m")
    if req.route_type == "loop" and m.spur_m:
        fails.append(f"{len(m.spur_m)} spur(s) on a loop")
    return fails


def _nearest_on(geometry, stop) -> tuple[float, float]:
    target = (stop.snapped_lon, stop.snapped_lat)
    return min(geometry, key=lambda p: geodesy.distance_m(p, target))


def score(req: RouteRequest, cand: Candidate, m: Measures) -> float:
    """Lower is better. Weights are deliberately simple; only relative order within a request matters."""
    dist = abs(cand.deviation_m) / req.target_distance_m * 100            # percent
    repeat = 0.0 if req.route_type == "out_and_back" else (m.repeat_share - m.forced_repeat_share) * 100
    spur = sum(m.spur_m) / 1000.0
    quiet = req.preferences.quiet_roads * m.main_share * 100
    return round(2.0 * dist + 0.5 * repeat + 1.0 * spur + 0.2 * quiet, 3)


def annotate(engine: Engine, req: RouteRequest, cand: Candidate, edges: list[Edge]) -> tuple[Candidate, list[str]]:
    """Fill the candidate's measured fields and flags; return it with its hard-rule failures."""
    m = measure(engine, req, cand, edges)
    cand.repeat_share = round(m.repeat_share, 4)
    cand.gain_m = None if m.gain_m is None else round(m.gain_m, 1)
    cand.loss_m = None if m.loss_m is None else round(m.loss_m, 1)
    cand.score = score(req, cand, m)
    if req.route_type != "out_and_back" and m.repeat_share > REPEAT_LIMIT:
        cand.flags.append(Flag(
            code="repeated_edges",
            message=(f"{m.repeat_share * 100:.1f}% of the route is walked twice"
                     + (f", {m.forced_repeat_share * 100:.1f}% of it forced by the stops" if m.forced_repeat_share else "")),
            data={"repeat_share": round(m.repeat_share, 4), "forced_share": round(m.forced_repeat_share, 4)}))
    if m.spur_m:
        cand.flags.append(Flag(code="spur", message=f"{len(m.spur_m)} dead-end excursion(s) over {SPUR_MIN_M:.0f} m",
                               data={"spur_m": [round(x, 1) for x in m.spur_m]}))
    cand.flags = _dedupe(cand.flags)
    return cand, hard_failures(req, cand, m)


def _dedupe(flags: list[Flag]) -> list[Flag]:
    seen, out = set(), []
    for f in flags:
        key = (f.code, f.message)
        if key not in seen:
            seen.add(key)
            out.append(f)
    return out


def diversify(scored: list[tuple[Candidate, set]], limit: int) -> list[Candidate]:
    """Best-first; keep a candidate only if its edge overlap with every kept one is below 60%.

    Case B options ("continue past target" and "end at target") are choices about the same
    route rather than alternatives, so they are exempt.
    """
    kept: list[tuple[Candidate, set]] = []
    for cand, keys in sorted(scored, key=lambda ck: ck[0].score if ck[0].score is not None else 0.0):
        exempt = cand.label in ("continue_past_target", "end_at_target")
        if not exempt and any(jaccard(keys, k) >= DIVERSITY_LIMIT for c, k in kept
                              if c.label not in ("continue_past_target", "end_at_target")):
            continue
        kept.append((cand, keys))
        if len(kept) >= limit and not exempt:
            break
    return [c for c, _ in kept]


def jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a | b else 1.0
