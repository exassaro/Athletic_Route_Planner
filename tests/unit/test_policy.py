import pytest

from athlete_engine import geodesy
from athlete_engine.policy import GRAPHHOPPER_RADIUS_M, VALHALLA_RADIUS_M, consistency_tolerance_m, pedestrian_options


def test_ferries_are_always_hard_excluded():
    assert pedestrian_options() == {"exclude_ferries": True}


def test_consistency_tolerance_floor_percentage_and_per_edge_allowance():
    assert consistency_tolerance_m(500) == pytest.approx(2.0)            # floor
    assert consistency_tolerance_m(10_000) == pytest.approx(10.0)        # 0.1%
    assert consistency_tolerance_m(10_000, edges=55) == pytest.approx(10.0 + 11.0)   # + 0.2 m per edge


def test_spherical_length_scales_with_the_engine_radius():
    line = [(75.80, 11.00), (75.80, 11.20)]
    v = geodesy.sphere_line_length_m(line, radius_m=VALHALLA_RADIUS_M)
    g = geodesy.sphere_line_length_m(line, radius_m=GRAPHHOPPER_RADIUS_M)
    assert g / v == pytest.approx(GRAPHHOPPER_RADIUS_M / VALHALLA_RADIUS_M)
