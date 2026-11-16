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


def test_point_at_and_cut_measure_back_to_the_requested_distance():
    line = [(75.86, 11.05), (75.83, 11.13), (75.78, 11.25)]
    total = geodesy.line_length_m(line)
    for at in (0.0, 1234.5, total / 2, total - 1.0):
        head = geodesy.cut_at(line, at)
        assert geodesy.line_length_m(head) == pytest.approx(at, abs=1e-3)
    assert geodesy.cut_at(line, total * 2) == line  # clamped


def test_cumulative_ends_at_total_length():
    line = [(75.86, 11.05), (75.83, 11.13), (75.78, 11.25)]
    assert geodesy.cumulative_m(line)[-1] == pytest.approx(geodesy.line_length_m(line), abs=1e-6)


def test_sample_every_includes_both_ends():
    line = [(75.86, 11.05), (75.83, 11.13)]
    samples = geodesy.sample_every(line, 1000)
    assert samples[0][1] == 0 and samples[-1][1] == pytest.approx(geodesy.line_length_m(line))
    assert all(b[1] - a[1] <= 1000 + 1e-6 for a, b in zip(samples, samples[1:]))


def test_bearings():
    assert geodesy.bearing_deg((75.0, 11.0), (75.0, 11.1)) == pytest.approx(0.0, abs=1e-6)
    assert geodesy.bearing_deg((75.0, 11.0), (74.9, 11.0)) == pytest.approx(270.0, abs=0.1)
    assert geodesy.angle_between_deg(350, 10) == pytest.approx(20)
