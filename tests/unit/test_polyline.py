import pytest

from athlete_engine import polyline


def test_decodes_reference_string_at_precision_5():
    # Reference example from the encoded polyline algorithm specification.
    pts = polyline.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@", precision=5)
    assert pts == [(-120.2, 38.5), (-120.95, 40.7), (-126.453, 43.252)]


def test_round_trip_at_precision_6():
    pts = [(75.86, 11.05), (75.833417, 11.128906), (75.780412, 11.258753), (75.78, 11.25)]
    assert polyline.decode(polyline.encode(pts)) == pts


def test_wrong_precision_moves_points_by_factor_of_ten():
    pts = [(75.86, 11.05), (75.87, 11.06)]
    wrong = polyline.decode(polyline.encode(pts, precision=6), precision=5)
    assert wrong[0] == pytest.approx((758.6, 110.5))


def test_truncated_input_raises():
    with pytest.raises(ValueError):
        polyline.decode(polyline.encode([(75.86, 11.05)])[:-1] + "\x7f")


def test_empty_string_is_empty_list():
    assert polyline.decode("") == []
