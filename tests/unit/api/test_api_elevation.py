"""Smoothed profile and the approximate-climb rule (Phase 5 amendments 14 and 15)."""

from athlete_solver.scoring import smoothed_heights

from athlete_api.elevation import LOWLAND_MEDIAN_M, climb_approximate, smoothed


def test_smoothed_is_the_solvers_series_bridges_included():
    profile = [[30.0 * i, 10.0 if not 19 <= i <= 21 else 1.0] for i in range(40)]
    bridges = [[570.0, 630.0]]
    assert smoothed(profile, bridges) == [10.0] * 40
    raw = smoothed(profile, None)
    assert raw == [round(h, 1) for h in smoothed_heights([p[0] for p in profile], [p[1] for p in profile])]
    assert min(raw) < 7.0
    assert smoothed(None, None) == []


def test_approximate_below_a_20_m_median():
    assert LOWLAND_MEDIAN_M == 20.0
    assert climb_approximate([[0, 5.0], [30, 19.0], [60, 300.0]]) is True       # median 19
    assert climb_approximate([[0, 5.0], [30, 20.0], [60, 300.0]]) is False      # median 20
    assert climb_approximate([[0, 10.0], [30, 30.0]]) is False                  # median 20
    assert climb_approximate([]) is False and climb_approximate(None) is False
