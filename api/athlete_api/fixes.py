"""The JSON Patch behind each fix and saving (blueprint Phase 5 amendment 7, A4).

The solver's Conflict names its fixes by action and checkpoint label. The front end must send a patch for a
one-tap fix, and must not work out for itself which checkpoint a label means, so the API attaches the patch:

- set_distance: replace /target_distance_m with the fix's value (the solver's number, unchanged).
- drop_checkpoint: test that /checkpoints/i still has that label, then remove it. Null when no checkpoint, or
  more than one, has the label: the API does not guess.
- make_optional: always null. The solver does not read `Checkpoint.mandatory` (optional stops are Phase 7), so
  the patch would change nothing in the result.

The `test` operation makes a stale button fail with 409 `patch_test_failed` instead of dropping the wrong stop.
"""

from athlete_solver.models import Conflict, RouteRequest

from .schemas import ConflictOut, FixOut, PatchOp, SavingOut


def _checkpoint_index(request: RouteRequest, label: str | None) -> int | None:
    hits = [i for i, c in enumerate(request.checkpoints) if label is not None and c.label == label]
    return hits[0] if len(hits) == 1 else None


def _drop(request: RouteRequest, label: str | None) -> list[PatchOp] | None:
    i = _checkpoint_index(request, label)
    if i is None:
        return None
    return [PatchOp(op="test", path=f"/checkpoints/{i}/label", value=label),
            PatchOp(op="remove", path=f"/checkpoints/{i}")]


def fix_patch(action: str, value_m: float | None, label: str | None, request: RouteRequest) -> list[PatchOp] | None:
    if action == "set_distance" and value_m is not None:
        return [PatchOp(op="replace", path="/target_distance_m", value=value_m)]
    if action == "drop_checkpoint":
        return _drop(request, label)
    return None


def conflict_out(conflict: Conflict | dict | None, request: RouteRequest) -> ConflictOut | None:
    if conflict is None:
        return None
    c = conflict if isinstance(conflict, Conflict) else Conflict.model_validate(conflict)
    data = c.model_dump(exclude={"fixes", "savings"})
    return ConflictOut(
        **data,
        fixes=[FixOut(**f.model_dump(), patch=fix_patch(f.action, f.value_m, f.label, request)) for f in c.fixes],
        savings=[SavingOut(**s.model_dump(), patch=fix_patch(s.action, None, s.label, request)) for s in c.savings])
