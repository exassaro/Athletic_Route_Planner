"""The patch behind each fix and saving (Phase 5 A4), on A02's real over_budget conflict."""

import sys
from pathlib import Path

import jsonpatch
from athlete_solver.models import Conflict, Fix, RouteRequest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "api"))
from api_fixtures import fixture_request, report_result  # noqa: E402

from athlete_api.fixes import conflict_out  # noqa: E402

A02 = RouteRequest.model_validate({**fixture_request("A01"), "target_distance_m": 20000})
RESULT = report_result("A02", A02)


def dumped(ops):
    return [op.model_dump(mode="json") for op in ops]


def test_every_saving_drops_its_own_checkpoint():
    out = conflict_out(RESULT.conflict, A02)
    base = A02.model_dump(mode="json")
    assert len(out.savings) == len(RESULT.conflict.savings)
    for s in out.savings:
        after = jsonpatch.apply_patch(base, dumped(s.patch))
        assert [c["label"] for c in after["checkpoints"]] == [c.label for c in A02.checkpoints if c.label != s.label]


def test_set_distance_uses_the_solvers_value_unchanged():
    out = conflict_out(RESULT.conflict, A02)
    for f in out.fixes:
        if f.action == "set_distance":
            assert dumped(f.patch) == [{"op": "replace", "path": "/target_distance_m", "value": f.value_m}]
        elif f.action == "make_optional":
            assert f.patch is None          # the solver does not read `mandatory` yet
    assert out.model_dump(exclude={"fixes", "savings"}) == RESULT.conflict.model_dump(exclude={"fixes", "savings"})


def test_ambiguous_or_unknown_labels_get_no_patch():
    twice = A02.model_copy(update={"checkpoints": [*A02.checkpoints, A02.checkpoints[0]]})
    c = Conflict(kind="checkpoints_exceed_distance", message="test",
                 fixes=[Fix(action="drop_checkpoint", label=A02.checkpoints[0].label),
                        Fix(action="drop_checkpoint", label="Nowhere"), Fix(action="drop_checkpoint")])
    assert [f.patch for f in conflict_out(c, twice).fixes] == [None, None, None]
    assert conflict_out(None, A02) is None
