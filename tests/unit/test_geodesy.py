"""Checks against properties of the WGS84 ellipsoid itself (not road distances)."""

import math

import pytest

from athlete_engine import geodesy

WGS84_A = 6378137.0  # semi-major axis, metres


def test_one_degree_along_equator_is_an_arc_of_the_semi_major_axis():
    expected = WGS84_A * math.pi / 180
    assert geodesy.line_length_m([(75.0, 0.0), (76.0, 0.0)]) == pytest.approx(expected, abs=1e-3)


def test_length_is_sum_of_segments():
    a, b, c = (75.86, 11.05), (75.83, 11.13), (75.78, 11.25)
    total = geodesy.line_length_m([a, b, c])
    assert total == pytest.approx(geodesy.distance_m(a, b) + geodesy.distance_m(b, c), abs=1e-6)


def test_degenerate_lines_have_zero_length():
    assert geodesy.line_length_m([]) == 0.0
    assert geodesy.line_length_m([(75.86, 11.05)]) == 0.0


def test_percent_gap():
    assert geodesy.percent_gap(1005.0, 1000.0) == pytest.approx(0.5)
    assert geodesy.percent_gap(995.0, 1000.0) == pytest.approx(0.5)
    assert geodesy.percent_gap(0.0, 0.0) == 0.0
