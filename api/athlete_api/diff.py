"""The diff between two versions of a plan (Phase 4 amendment 6, blueprint section 12).

- changed: JSON pointers that differ between the two requests, whatever patch produced them. A list whose
  length changed is reported as one pointer (the list).
- candidates: each alternative paired by label, using its primary option (main, full_route,
  continue_past_target, out_and_back, else its first). Deltas are differences of the solver's stored values,
  never re-measured. duration_delta_s is a walking-time delta (amendment 11), null if either side has none.
- end_changed: the end's coordinates, kind or label differ.
- stops added or removed: checkpoints, via and must_use items, keyed by place_id (or role and label).
The top-level length, duration and end fields repeat the first paired alternative (in the new version's order).
"""

from typing import Any

from athlete_solver.models import Candidate, RouteRequest, SolveResult

PRIMARY = ("main", "full_route", "continue_past_target", "out_and_back", "short_loop")


def changed_pointers(old: Any, new: Any, path: str = "") -> list[str]:
    if isinstance(old, dict) and isinstance(new, dict):
        out = []
        for key in sorted(set(old) | set(new)):
            ptr = f"{path}/{str(key).replace('~', '~0').replace('/', '~1')}"
            if key not in old or key not in new:
                out.append(ptr)
            else:
                out.extend(changed_pointers(old[key], new[key], ptr))
        return out
    if isinstance(old, list) and isinstance(new, list) and len(old) == len(new):
        out = []
        for i, (a, b) in enumerate(zip(old, new)):
            out.extend(changed_pointers(a, b, f"{path}/{i}"))
        return out
    return [] if old == new else [path]


def primary(cands: list[Candidate]) -> dict[str, Candidate]:
    out: dict[str, Candidate] = {}
    for label in dict.fromkeys(c.label for c in cands):
        mine = [c for c in cands if c.label == label]
        out[label] = next((c for opt in PRIMARY for c in mine if c.option == opt), mine[0])
    return out


def end_changed(a: Candidate, b: Candidate) -> bool:
    return (a.end.lon, a.end.lat, a.end.kind, a.end.label) != (b.end.lon, b.end.lat, b.end.kind, b.end.label)


def stop_keys(request: dict) -> dict[str, dict]:
    req = RouteRequest.model_validate(request)
    out = {}
    for role, items in (("checkpoint", req.checkpoints), ("via", req.via), ("must_use", req.must_use)):
        for k, item in enumerate(items):
            label = item.label or f"{role} {k + 1}"
            key = item.place_id or f"{role}:{label}"
            out[key] = {"role": role, "label": label, "place_id": item.place_id}
    return out


def diff(previous, request: RouteRequest, result: SolveResult) -> dict:
    """previous: the stored PlanVersionOut being replaced; request/result: the new version."""
    old_req = previous.request.model_dump(mode="json")
    new_req = request.model_dump(mode="json")
    old_c, new_c = primary(previous.candidates), primary(result.candidates)
    pairs = []
    for label, new in new_c.items():
        old = old_c.get(label)
        if old is None:
            continue
        pairs.append({
            "label": label, "from_option": old.option, "to_option": new.option,
            "from_length_m": old.foot_m, "to_length_m": new.foot_m,
            "length_delta_m": round(new.foot_m - old.foot_m, 1),
            "duration_delta_s": None if old.duration_s is None or new.duration_s is None
            else round(new.duration_s - old.duration_s, 1),
            "end_changed": end_changed(old, new),
        })
    old_stops, new_stops = stop_keys(old_req), stop_keys(new_req)
    head = pairs[0] if pairs else {}
    return {
        "from_version": previous.version,
        "changed": changed_pointers(old_req, new_req),
        "outcome": {"from": previous.outcome, "to": result.outcome},
        "length_delta_m": head.get("length_delta_m"),
        "duration_delta_s": head.get("duration_delta_s"),
        "end_changed": head.get("end_changed"),
        "candidates": pairs,
        "candidates_added": [f"{c.label}/{c.option}" for c in result.candidates
                             if c.label not in old_c],
        "candidates_removed": [f"{label}/{c.option}" for label, c in old_c.items() if label not in new_c],
        "stops_added": [v for k, v in new_stops.items() if k not in old_stops],
        "stops_removed": [v for k, v in old_stops.items() if k not in new_stops],
    }
