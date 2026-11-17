"""Scoring, hard rules and the diversity filter (blueprint section 8 table, amended after Phase 2).

Every measure comes from the candidate's geometry and the engine's edge data.
A hard-rule failure removes a candidate; a penalty only lowers its score.

Repeated edges (Phase 3 amendment 8): more than 10% repetition BEYOND what the
must_reach stops force is a hard reject. Raw repetition above 10% is still
reported as a flag, with the forced share, so a dead-end stop is explained.
"""

from dataclasses import dataclass, field

from athlete_engine import geodesy
from athlete_engine.measure import Edge

from .avoid import violations
from .engine import Engine
from .models import Candidate, Flag, RouteRequest

ELEVATION_STEP_M = 30.0       # section 9: sample every 25 to 50 m
SMOOTH_WINDOW = 5             # moving average over samples
CLIMB_THRESHOLD_M = 3.0       # count gain only above a 2 to 3 m threshold
SPUR_MIN_M = 100.0
TURN_NEAR_STOP_M = 60.0       # a turn-round this close to a stop that must be reached is required by it
REPEAT_LIMIT = 0.10           # section 8: hard above 10% unless out-and-back (see module note)
DIVERSITY_LIMIT = 0.60
MAIN_CLASSES = ("trunk", "primary")
HIGHWAY_CLASSES = ("motorway", "trunk")
NATIONAL_HIGHWAY_STRETCH_M = 200.0   # decision 12
# Options shown in a fixed order inside one alternative.
OPTION_ORDER = {"full_route": 0, "cut_at_target": 1, "continue_past_target": 0, "end_at_target": 1}
BUDGET_OPTIONS = ("main", "continue_past_target", "cut_at_target")


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

def repetition(edges: list[Edge], forced_until_m: float, turns_m: list[float] | None = None) -> tuple[float, float]:
    """(share of length on edges walked more than once, share of that forced by the stops).

    Forced repetition is (a) repetition among edges before `forced_until_m` (the route through the
    stops that must be reached), which no endpoint choice can avoid, and (b) the out-and-back run around
    a turn-round at one of those stops (`turns_m`: their positions along the route), which covers a
    dead-end stop even when it is the last one.
    """
    total = sum(e.length_m for e in edges if e.use != "ferry") or 1.0
    counts: dict = {}
    for e in edges:
        counts[e.key] = counts.get(e.key, 0) + 1
    repeated = sum(e.length_m for e in edges if counts[e.key] > 1 and e.use != "ferry")
    forced_idx: set[int] = set()
    run, base_counts, n_base = 0.0, {}, 0
    for e in edges:
        if run >= forced_until_m - 1.0:
            break
        base_counts[e.key] = base_counts.get(e.key, 0) + 1
        n_base += 1
        if e.use != "ferry":
            run += e.length_m
    forced_idx |= {k for k in range(n_base) if base_counts[edges[k].key] > 1}
    for lo, hi, turn_at in mirrored_runs(edges):
        if any(abs(turn_at - t) <= TURN_NEAR_STOP_M for t in (turns_m or [])):
            forced_idx |= set(range(lo, hi))
    forced = sum(edges[k].length_m for k in forced_idx if counts[edges[k].key] > 1 and edges[k].use != "ferry")
    return repeated / total, min(forced, repeated) / total


def mirrored_runs(edges: list[Edge]) -> list[tuple[int, int, float]]:
    """Runs walked out and straight back: (first edge index, end index, distance along at the turn)."""
    keys = [e.key for e in edges]
    at, run = [], 0.0
    for e in edges:
        at.append(run)
        run += e.length_m if e.use != "ferry" else 0.0
    out, i = [], 1
    while i < len(keys):
        if keys[i] == keys[i - 1]:
            n = 0
            while i - 1 - n >= 0 and i + n < len(keys) and keys[i - 1 - n] == keys[i + n]:
                n += 1
            out.append((i - n, i + n, at[i]))
            i += max(n, 1)
        else:
            i += 1
    return out


def spurs(edges: list[Edge], allowed_turns_m: list[float]) -> list[float]:
    """Lengths of dead-end excursions: runs walked out and straight back on the same edges.

    A turn-round within 60 m of a stop the run must reach (or the out-and-back turnaround) is required by
    the request and not counted.
    """
    out = []
    for lo, hi, turn_at in mirrored_runs(edges):
        length = sum(edges[k].length_m for k in range((lo + hi) // 2, hi))
        if length >= SPUR_MIN_M and not any(abs(turn_at - a) <= TURN_NEAR_STOP_M for a in allowed_turns_m):
            out.append(length)
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
    # Only stops the run must actually reach force repetition and allow a turn-round: must_reach places,
    # and pass-near places that could only be passed with a spur (flagged). Pass-near stops do not.
    checkpoints_at = [s.at_m for s in cand.stops
                      if s.role not in ("start", "end") and (s.must_reach or s.how in ("reached", "spur"))]
    forced_until = max(checkpoints_at, default=0.0)
    turns = list(checkpoints_at)
    if req.route_type == "out_and_back":
        turns.append(cand.foot_m / 2)
        forced_until = cand.foot_m  # all repetition is the point of an out-and-back
    if cand.option in ("full_route", "cut_at_target"):
        # Over budget: both runs are (a prefix of) the route through the stops, so the stops force all of it.
        forced_until = cand.foot_m
    rep, forced = repetition(edges, forced_until, turns)
    foot = sum(e.length_m for e in edges if e.use != "ferry") or 1.0
    main = sum(e.length_m for e in edges if e.road_class in MAIN_CLASSES and e.use != "ferry")
    gain, loss = climb(engine, cand.geometry)
    return Measures(repeat_share=rep, forced_repeat_share=forced, spur_m=spurs(edges, turns),
                    main_share=main / foot, gain_m=gain, loss_m=loss,
                    keys={e.key for e in edges if e.use != "ferry"})


# ------------------------------------------------------------------ rules and score

def hard_failures(req: RouteRequest, cand: Candidate, m: Measures, edges: list[Edge] | None = None) -> list[str]:
    fails = []
    if cand.option in BUDGET_OPTIONS and abs(cand.deviation_m) > req.tolerance_m:
        fails.append(f"distance off by {cand.deviation_m:+.0f} m, over the {req.tolerance_m:.0f} m tolerance")
    if cand.ferry_m > 0:
        fails.append(f"{cand.ferry_m:.0f} m on a ferry (ferries are always excluded)")
    for s in cand.stops:
        if s.role not in ("start", "end"):
            off = geodesy.distance_m((s.snapped_lon, s.snapped_lat), _nearest_on(cand.geometry, s))
            if off > 50.0:
                fails.append(f"misses checkpoint {s.label} by {off:.0f} m")
    if req.route_type != "out_and_back" and m.repeat_share - m.forced_repeat_share > REPEAT_LIMIT:
        fails.append(f"{(m.repeat_share - m.forced_repeat_share) * 100:.1f}% walked twice beyond what the stops force")
    fails += violations(req, cand.geometry, edges or [])
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
    return round(2.0 * dist + 0.5 * repeat + 1.0 * spur, 3)


def highway_stretches(edges: list[Edge]) -> list[tuple[float, list[str]]]:
    """Consecutive runs of trunk/motorway edges: (length in metres, road names and refs)."""
    out: list[tuple[float, list[str]]] = []
    run, names = 0.0, []
    for e in [*edges, None]:
        if e is not None and e.road_class in HIGHWAY_CLASSES and e.use != "ferry":
            run += e.length_m
            names += [n for n in e.names if n not in names]
        elif run > 0:
            out.append((run, names))
            run, names = 0.0, []
    return out


def highway_flag(edges: list[Edge]) -> Flag | None:
    """Decision 12: 200 m or more in one stretch uses a national highway; anything shorter is a crossing."""
    stretches = highway_stretches(edges)
    if not stretches:
        return None
    longest = max(stretches, key=lambda s: s[0])
    road = ", ".join(longest[1]) or "a trunk road"
    data = {"stretches_m": [round(s[0], 1) for s in stretches], "longest_m": round(longest[0], 1),
            "names": longest[1]}
    if longest[0] >= NATIONAL_HIGHWAY_STRETCH_M:
        return Flag(code="uses_national_highway",
                    message=f"uses a national highway ({road}, {longest[0]:.0f} m); running there may be prohibited",
                    data=data)
    return Flag(code="crosses_national_highway", message=f"crosses a national highway ({road})", data=data)


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
    nh = highway_flag(edges)
    if nh is not None:
        cand.flags.append(nh)
    cand.flags = _dedupe(cand.flags)
    return cand, hard_failures(req, cand, m, edges)


def _dedupe(flags: list[Flag]) -> list[Flag]:
    seen, out = set(), []
    for f in flags:
        key = (f.code, f.message)
        if key not in seen:
            seen.add(key)
            out.append(f)
    return out


def diversify(groups: list[tuple[str, list[tuple[Candidate, set]]]], limit: int) -> list[Candidate]:
    """Keep alternatives (in the given order, "recommended" first) whose routes differ.

    Each group is one alternative's options. Case B options ("continue past target", "end at target") and
    the over-budget pair ("full route", "cut at target") are choices about the same route, so they stay
    together in a fixed order. An alternative is kept only if its first option's edge overlap with every
    kept alternative's first option is below 60%, up to `limit` alternatives.
    """
    kept: list[list[tuple[Candidate, set]]] = []
    for _, options in groups:
        options = sorted(options, key=lambda ck: (OPTION_ORDER.get(ck[0].option, 0),
                                                  ck[0].score if ck[0].score is not None else 0.0))
        lead = options[0][1]
        if any(jaccard(lead, g[0][1]) >= DIVERSITY_LIMIT for g in kept):
            continue
        kept.append(options)
        if len(kept) >= limit:
            break
    return [c for g in kept for c, _ in g]


def jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a | b else 1.0
