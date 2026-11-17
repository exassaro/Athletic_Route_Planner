"""Lengthening a run with one via-point (blueprint section 8 step 10).

Used when the end of the run is fixed (a pinned end, or Case B's "detour on an earlier leg")
and the run is short of the budget by X metres. The longest leg A to B gets one extra
through via V:

1. candidates on ellipses with foci A and B whose straight-line sums are the needed leg
   length divided by a few circuity guesses (straight line is used only to place candidates);
2. candidates that snap further than 150 m from a path (water, empty land) are dropped;
3. two walking-distance calls give d(A, V) + d(V, B) for every candidate; the closest to the
   needed leg length is chosen (matrix values only rank, they are never shown);
4. the whole run is routed with V as a through via (no U-turn at V) and measured from its
   geometry; V then moves along the ray from the leg's midpoint through V (secant steps)
   until the measured run is within the accuracy goal. A few distinct rays are tried.

Every length that decides the result is a measured foot length of a routed geometry.
"""

import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from athlete_engine import geodesy

from .engine import Engine, NoRoute, Routed

LonLat = tuple[float, float]

CIRCUITY_GUESSES = (1.05, 1.2, 1.4, 1.7)   # straight-line sum = needed leg length / guess
ANGLES = 12                                # candidates per ellipse (none on the major axis)
SNAP_LIMIT_M = 150.0
RAYS = 4                                   # distinct candidate directions tried
RAY_SEPARATION_DEG = 25.0
REFINE_STEPS = 4                           # routed refinements per ray after the first route
RETRACE_OK_M = 100.0                       # an attempt may retrace less than a spur (scoring.SPUR_MIN_M)


@dataclass
class Lengthened:
    routed: Routed                 # the run with the via, routed with edge detail
    points: list[LonLat]           # the run's points with the via inserted
    through: set[int]
    via_index: int                 # index of the via in points
    leg: int                       # index (in the original points) of the leg's first point
    tries: list[dict] = field(default_factory=list)   # every routed attempt: ray, offset, foot metres


def accuracy_m(target_m: float, tolerance_m: float) -> float:
    """How close a lengthened run should land: 0.5% of the target (at least 50 m), never above tolerance."""
    return min(tolerance_m, max(50.0, 0.005 * target_m))


def leg_lengths(routed: Routed, points: list[LonLat]) -> list[float]:
    """Measured foot length of each leg between consecutive points (positions found along the geometry)."""
    from .p2p import positions_along   # noqa: PLC0415  (p2p imports this module)

    scale = routed.foot_m / (routed.geom_m or 1.0)
    at = [a * scale for a, _ in positions_along(routed.shape, points)]
    at[0], at[-1] = 0.0, routed.foot_m
    return [max(0.0, at[k + 1] - at[k]) for k in range(len(points) - 1)]


def ellipse_points(a: LonLat, b: LonLat, need_m: float) -> list[LonLat]:
    """Candidate vias on ellipses around foci a and b (straight-line placement only, never a distance)."""
    half = geodesy.distance_m(a, b) / 2.0
    axis = geodesy.bearing_deg(a, b) if half > 0 else 0.0
    mid = geodesy.destination(a, axis, half) if half > 0 else a
    out = []
    for guess in CIRCUITY_GUESSES:
        semi_major = need_m / guess / 2.0
        if semi_major <= half * 1.02:
            continue
        semi_minor = math.sqrt(semi_major ** 2 - half ** 2)
        for k in range(ANGLES):
            theta = 2 * math.pi * (k + 0.5) / ANGLES
            x, y = semi_major * math.cos(theta), semi_minor * math.sin(theta)
            out.append(geodesy.destination(mid, axis + math.degrees(math.atan2(y, x)), math.hypot(x, y)))
    return out


def ranked_vias(engine: Engine, a: LonLat, b: LonLat, need_m: float) -> list[tuple[LonLat, float]]:
    """Snapped candidates ranked by |d(a, v) + d(v, b) - need| on the walking matrix."""
    cands = ellipse_points(a, b, need_m)
    if not cands:
        return []
    snapped = engine.locate(cands)
    kept = [s for c, s in zip(cands, snapped) if s is not None and geodesy.distance_m(c, s) <= SNAP_LIMIT_M]
    if not kept:
        return []
    da = engine.distances_from(a, kept)
    db = engine.distances_from(b, kept)
    ranked = [(v, abs(x + y - need_m)) for v, x, y in zip(kept, da, db) if x is not None and y is not None]
    return sorted(ranked, key=lambda r: r[1])


def _distinct_rays(mid: LonLat, ranked: list[tuple[LonLat, float]]) -> list[LonLat]:
    rays: list[LonLat] = []
    for v, _ in ranked:
        if geodesy.distance_m(mid, v) < 1.0:
            continue
        brg = geodesy.bearing_deg(mid, v)
        if all(geodesy.angle_between_deg(brg, geodesy.bearing_deg(mid, r)) >= RAY_SEPARATION_DEG for r in rays):
            rays.append(v)
        if len(rays) >= RAYS:
            break
    return rays


def retraced_m(shape: list[LonLat]) -> float:
    """Metres of the geometry that run over a segment already walked (either direction), measured on the
    geometry itself. An engine retraces a road with the same vertices, so this catches spurs and doubling
    back without an edge-attribute call."""
    seen: set = set()
    out = 0.0
    for p, q in zip(shape, shape[1:]):
        a, b = (round(p[0], 6), round(p[1], 6)), (round(q[0], 6), round(q[1], 6))
        if a == b:
            continue
        key = (a, b) if a < b else (b, a)
        if key in seen:
            out += geodesy.distance_m(p, q)
        else:
            seen.add(key)
    return out


def _next_offset(seen: list[tuple[float, float]], goal_m: float) -> float | None:
    """Next offset along the ray: interpolate inside the tightest bracket around the goal (one try short,
    one long) if there is one, else a secant step from the last two tries. None if the length does not
    grow with the offset."""
    below = [s for s in seen if s[1] < goal_m]
    above = [s for s in seen if s[1] >= goal_m]
    if below and above:
        lo = min(below, key=lambda s: goal_m - s[1])
        hi = min(above, key=lambda s: s[1] - goal_m)
        if lo[0] < hi[0]:
            return lo[0] + (goal_m - lo[1]) * (hi[0] - lo[0]) / (hi[1] - lo[1])
        return (lo[0] + hi[0]) / 2.0   # the length does not grow monotonically here: bisect
    (t0, l0), (t1, l1) = seen[-2], seen[-1]
    if t1 == t0 or (l1 - l0) / (t1 - t0) <= 0:
        return None
    return t1 + (goal_m - l1) * (t1 - t0) / (l1 - l0)


def lengthen(engine: Engine, points: list[LonLat], through: set[int], routed: Routed,
             goal_m: float, accuracy: float, max_retrace_m: float | None = None,
             tolerance_m: float | None = None) -> Lengthened | None:
    """The single best lengthening (see lengthen_options)."""
    found = lengthen_options(engine, points, through, routed, goal_m, accuracy, max_retrace_m, keep=1,
                             tolerance_m=tolerance_m)
    return found[0] if found else None


def lengthen_options(engine: Engine, points: list[LonLat], through: set[int], routed: Routed,
                     goal_m: float, accuracy: float, max_retrace_m: float | None = None,
                     keep: int = 1, leg: int | None = None, tolerance_m: float | None = None) -> list[Lengthened]:
    """Insert one through via into the run's longest leg so the measured run is goal_m on foot.

    `routed` is the run through `points` as it is now (shorter than the goal). Returns the attempt closest
    to the goal (the caller judges it against the tolerance); with `keep` > 1 the best attempt of each of
    that many rays (different vias), best first. Empty if no candidate could be routed.
    With `max_retrace_m`, attempts that walk that much road twice (a spur at the via) are not kept.
    `leg` picks another leg than the longest (index of its first point). With `tolerance_m`, an attempt within
    it ranks above any attempt outside it.
    """
    legs = leg_lengths(routed, points)
    if leg is None:
        leg = max(range(len(legs)), key=lambda k: legs[k])
    a, b = points[leg], points[leg + 1]
    short = goal_m - routed.foot_m
    need = legs[leg] + short
    half = geodesy.distance_m(a, b) / 2.0
    mid = geodesy.destination(a, geodesy.bearing_deg(a, b), half) if half > 0 else a

    ranked = ranked_vias(engine, a, b, need)
    rays = _distinct_rays(mid, ranked)
    seq_through = {i if i <= leg else i + 1 for i in through} | {leg + 1}
    base_retrace = retraced_m(routed.shape)

    def attempt(v: LonLat, ray: int, t: float, out: list) -> float | None:
        seq = [*points[:leg + 1], v, *points[leg + 1:]]
        try:
            r = engine.route(seq, through=seq_through)
        except NoRoute:
            out.append((None, seq, {"ray": ray, "offset_m": round(t, 1), "foot_m": None}))
            return None
        miss = abs(goal_m - r.foot_m)
        extra = max(0.0, retraced_m(r.shape) - base_retrace)
        # Within accuracy and without doubling back first; then the smallest miss plus doubling back.
        # Then within the tolerance (the hard rule) before outside it, then the smallest miss plus doubling back.
        rank = (0 if miss <= accuracy and extra < RETRACE_OK_M else 1,
                0 if tolerance_m is None or miss <= tolerance_m else 1, round(miss + extra, 1), ray)
        out.append((rank, seq, {"ray": ray, "offset_m": round(t, 1), "foot_m": round(r.foot_m, 1),
                                "retraced_m": round(extra, 1)}))
        return r.foot_m

    def search_ray(ray: int, v: LonLat) -> list:
        """Route along one ray: the candidate, then bracketing/secant steps on its offset from the midpoint."""
        out: list = []
        bearing = geodesy.bearing_deg(mid, v)
        t1 = geodesy.distance_m(mid, v)
        first = attempt(v, ray, t1, out)
        if first is None:
            return out
        seen = [(0.0, routed.foot_m), (t1, first)]     # offset 0: no via, the run as it is
        for _ in range(REFINE_STEPS):
            t_now, l_now = seen[-1]
            if abs(goal_m - l_now) <= accuracy:
                break
            t = _next_offset(seen, goal_m)
            if t is None:
                break
            t = min(max(t, 0.1 * t1), 3.0 * t1)
            if min(abs(t - s) for s, _ in seen) < 5.0:
                break
            # The via must sit on the yardstick's walkable network (an unsnapped point lets the generator
            # snap it to a road the pedestrian check does not cover).
            raw = geodesy.destination(mid, bearing, t)
            snapped = engine.locate([raw])[0]
            if snapped is None or geodesy.distance_m(raw, snapped) > SNAP_LIMIT_M:
                break
            length = attempt(snapped, ray, t, out)
            if length is None:
                break
            if any(abs(length - l) < 1.0 for _, l in seen[1:]):
                break    # the via snapped to the same road as before: the route no longer changes
            seen.append((t, length))
        return out

    # Rays are independent: route them in parallel (every ray runs fully, so the result is deterministic).
    if len(rays) > 1:
        with ThreadPoolExecutor(max_workers=len(rays)) as pool:
            results = list(pool.map(lambda rv: search_ray(*rv), enumerate(rays)))
    else:
        results = [search_ray(0, v) for v in rays]
    attempts = [a for res in results for a in res]
    tries = [t for _, _, t in attempts]
    routed_ok = [(rank, seq) for rank, seq, t in attempts if rank is not None
                 and (max_retrace_m is None or t["retraced_m"] < max_retrace_m)]
    if not routed_ok:
        return []
    # The best attempt of each ray (rank ends with the ray index), best rays first.
    best_of: dict[int, tuple] = {}
    for rank, seq in sorted(routed_ok, key=lambda x: x[0]):
        best_of.setdefault(rank[-1], (rank, seq))
    picks = sorted(best_of.values(), key=lambda x: x[0])[:keep]
    out = []
    for _, seq in picks:
        final = engine.route(seq, through=seq_through, detail=True)
        out.append(Lengthened(routed=final, points=seq, through=seq_through, via_index=leg + 1, leg=leg,
                              tries=tries))
    return out
