"""Template explanations, no LLM (Phase 4 amendments 10 and 16).

Every number in an explanation is a value already in the SolveResult (its facts, its conflict, or a
candidate's measured stats), only formatted: kilometres to one decimal ("25.0 km"), or whole metres under
1 km. Nothing is computed here. Counts are avoided ("6 stops"), because a count is not in the result. Names
(stops, roads, places) are copied from the result. Flag messages are not copied: they may hold numbers.
tests/unit/api/test_api_explain.py checks every number of every template against the result.
"""

from athlete_solver.models import Candidate, SolveResult

LABELS = {"recommended": "The recommended route", "shortest": "The shortest route"}
FLAG_NOTES = {
    "uses_national_highway": "uses a national highway; running there may be prohibited",
    "crosses_national_highway": "crosses a national highway",
    "avoid_unmet": "still touches something you asked to avoid",
    "pass_near_spur": "reaches a stop with a short out-and-back",
    "pass_near_boundary": "passes a stop inside its boundary rather than near its centre",
    "detour_eased": "eases the road rules to avoid a long detour",
}


def dist(m: float) -> str:
    m = abs(m)
    return f"{m / 1000:.1f} km" if m >= 1000 else f"{m:.0f} m"


def name(label: str) -> str:
    if label in LABELS:
        return LABELS[label]
    if label.startswith("loop_"):
        return f"Loop {label.split('_')[1]}"
    return label


def ending(c: Candidate) -> str:
    return f", ending at {c.end.label}" if c.end.label else ""


def describe(c: Candidate) -> str:
    who = name(c.label)
    match c.option:
        case "main":
            return f"{who} is {dist(c.foot_m)}{ending(c)}."
        case "end_at_target":
            short = f", {dist(c.deviation_m)} short of the distance" if c.deviation_m < 0 else ""
            return f"{who} reaches the target in {dist(c.foot_m)}{short}."
        case "continue_past_target":
            return f"{who} can carry on past the target: {dist(c.foot_m)}{ending(c)}."
        case "detour_to_target":
            return f"{who} can end at the target with a detour on the way: {dist(c.foot_m)}."
        case "full_route":
            return f"{who} through every stop is {dist(c.foot_m)}{ending(c)}."
        case "cut_at_target":
            return f"{who} cut at the requested distance is {dist(c.foot_m)}{ending(c)}."
        case "out_and_back":
            return f"{who}: an out-and-back of {dist(c.foot_m)} instead of a loop."
        case "short_loop":
            return f"{who} through the stops is {dist(c.foot_m)}; no detour could lengthen it."
    return f"{who} is {dist(c.foot_m)}."


def notes(c: Candidate) -> list[str]:
    seen, out = set(), []
    for f in c.flags:
        if f.code in FLAG_NOTES and f.code not in seen:
            seen.add(f.code)
            out.append(f"{name(c.label)} {FLAG_NOTES[f.code]}.")
    return out


def over_budget(result: SolveResult) -> list[str]:
    cf = result.conflict
    out = []
    if cf.minimum_m is not None and cf.requested_m is not None:
        over = f", {dist(cf.overshoot_m)} over" if cf.overshoot_m is not None else ""
        out.append(f"The stops need at least {dist(cf.minimum_m)} on foot{over} the {dist(cf.requested_m)} requested.")
    for s in cf.savings:
        if s.saves_m <= 0:
            out.append(f"Dropping {s.label} does not shorten the run.")
        else:
            fits = "then it fits" if s.fits else "still over"
            out.append(f"Dropping {s.label} saves {dist(s.saves_m)} ({fits}).")
    return out


def conflict_only(result: SolveResult) -> list[str]:
    cf = result.conflict
    if cf is None:
        return ["No route could be made for this request."]
    match cf.kind:
        case "disconnected":
            pair = " and ".join(cf.pair) if cf.pair else "two of the points"
            return [f"There is no walking route between {pair}."]
        case "snap_too_far":
            return ["A point is too far from any walkable road."]
        case "inside_avoided":
            return ["A point lies inside something you asked to avoid."]
        case "loop_stop_too_far":
            need = f" It needs at least {dist(cf.minimum_m)}." if cf.minimum_m is not None else ""
            return [f"A loop cannot reach a stop and come back within the distance.{need}"]
    return ["No route could be made for this request."]


def explain(result: SolveResult) -> str:
    parts: list[str] = []
    if result.outcome == "over_budget" and result.conflict is not None:
        parts += over_budget(result)
    elif result.outcome != "ok" and not result.candidates:
        parts += conflict_only(result)
    order = result.facts.get("order")
    if order and result.outcome in ("ok", "over_budget"):
        parts.append(f"Stops in order: {', '.join(order)}.")
    for c in result.candidates:
        parts.append(describe(c))
    for c in result.candidates:
        parts += [n for n in notes(c) if n not in parts]
    if any(f.code == "alternative_unavailable" for f in result.flags):
        parts.append("The recommended route is unavailable right now; only the shortest route is shown.")
    return " ".join(parts)
