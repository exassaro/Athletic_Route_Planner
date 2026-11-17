import pytest
from pydantic import ValidationError

from athlete_solver.models import Conflict, RouteRequest, SolveResult

START = {"lon": 75.86, "lat": 11.05}


def request(**overrides):
    body = {"route_type": "point_to_point", "start": START, "target_distance_m": 25000,
            "direction": {"kind": "towards_place", "place": {"lon": 75.78, "lat": 11.25, "label": "Kozhikode"}}}
    body.update(overrides)
    return RouteRequest.model_validate(body)


def test_section_4_shape_parses_with_defaults():
    req = request()
    assert req.end.kind == "auto"
    assert req.checkpoint_order == "auto"
    assert req.tolerance_m == pytest.approx(500)


def test_there_is_no_ferry_opt_in():
    with pytest.raises(ValidationError):
        request(preferences={"avoid": []})


def test_unknown_fields_are_rejected():
    with pytest.raises(ValidationError):
        request(preferences={"quiet": 0.8})
    with pytest.raises(ValidationError):
        request(colour="red")


def test_bearing_direction():
    req = request(direction={"kind": "bearing", "degrees": 10})
    assert req.direction.kind == "bearing"
    with pytest.raises(ValidationError):
        request(direction={"kind": "bearing", "degrees": 360})


@pytest.mark.parametrize("distance", [0, -5, 100_001])
def test_distance_bounds(distance):
    with pytest.raises(ValidationError):
        request(target_distance_m=distance)


def test_at_most_eight_checkpoints():
    cps = [{"lon": 75.80 + i / 100, "lat": 11.1, "label": f"S{i}"} for i in range(9)]
    with pytest.raises(ValidationError):
        request(checkpoints=cps)


def test_duplicate_checkpoint_coordinates_rejected():
    cp = {"lon": 75.83, "lat": 11.13, "label": "Kadalundi"}
    with pytest.raises(ValidationError):
        request(checkpoints=[cp, {**cp, "label": "again"}])


def test_out_and_back_rules():
    with pytest.raises(ValidationError):
        request(route_type="out_and_back", direction=None)
    with pytest.raises(ValidationError):
        request(route_type="out_and_back", checkpoints=[{"lon": 75.83, "lat": 11.13, "label": "K"}])


def test_fixed_end_only_point_to_point():
    with pytest.raises(ValidationError):
        request(route_type="loop", end={"kind": "fixed", "point": START})


def test_result_round_trips_through_json():
    conflict = Conflict(kind="checkpoints_exceed_distance", message="m", requested_m=25000, minimum_m=26000,
                        overshoot_m=500, savings=[{"action": "drop_checkpoint", "label": "Beypore", "saves_m": 6000, "fits": True}],
                        fixes=[{"action": "set_distance", "value_m": 26000}])
    result = SolveResult(outcome="infeasible", request=request(), conflict=conflict, graph_build="2026-11-15T00:15:25Z")
    again = SolveResult.model_validate_json(result.model_dump_json())
    assert again == result
