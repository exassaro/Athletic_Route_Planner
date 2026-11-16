"""Integration tests against a running Valhalla. No expected distance is hardcoded:
every assertion compares two measurements of the same response, or checks structure."""

import json
from pathlib import Path

import pytest

from athlete_engine import geodesy
from athlete_engine.valhalla import loc, route_length_m, route_shape

pytestmark = pytest.mark.integration

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
PLACES = json.loads((FIXTURES / "places.json").read_text(encoding="utf-8"))["places"]
PAIRS = json.loads((FIXTURES / "od_pairs.json").read_text(encoding="utf-8"))["pairs"]


def pt(name):
    return (PLACES[name]["lon"], PLACES[name]["lat"])


@pytest.mark.parametrize("pair", PAIRS, ids=lambda p: f"pair{p['id']}")
def test_engine_length_matches_geometry_within_half_percent(engine, pair):
    a = (pair["from"]["lon"], pair["from"]["lat"])
    b = (pair["to"]["lon"], pair["to"]["lat"])
    resp = engine.route([a, b])
    gap = geodesy.percent_gap(route_length_m(resp), geodesy.line_length_m(route_shape(resp)))
    assert gap <= 0.5


def test_through_via_keeps_one_leg_and_break_via_splits(engine):
    points = [pt("start_south_of_kadalundi"), pt("kadalundi"), pt("chaliyam")]
    through = engine.route([loc(points[0]), loc(points[1], type="through"), loc(points[2])])
    split = engine.route([loc(points[0]), loc(points[1], type="break"), loc(points[2])])
    assert len(through["trip"]["legs"]) == 1
    assert len(split["trip"]["legs"]) == 2


def test_matrix_is_complete_with_zero_diagonal(engine):
    names = ["start_south_of_kadalundi", "kadalundi", "chaliyam", "beypore", "kozhikode"]
    rows = engine.matrix([pt(n) for n in names], [pt(n) for n in names])["sources_to_targets"]
    assert len(rows) == len(names)
    for i, row in enumerate(rows):
        assert len(row) == len(names)
        assert all(cell["distance"] is not None for cell in row)
        assert row[i]["distance"] == 0


def test_isodistance_returns_a_polygon(engine):
    features = engine.isodistance(pt("beypore"), [5.0])["features"]
    assert features and features[0]["geometry"]["type"] in ("Polygon", "MultiPolygon")


def test_trace_attributes_returns_edges_for_a_route_shape(engine):
    shape = route_shape(engine.route([pt("chaliyam"), pt("beypore")]))
    edges = engine.trace_attributes(shape, shape_match="edge_walk",
                                    attributes=["edge.id", "edge.length", "edge.use", "edge.road_class"])["edges"]
    assert edges
    assert all({"id", "length", "use", "road_class"} <= set(edge) for edge in edges)


def test_elevation_is_loaded(engine):
    coast, hills = engine.height([pt("beypore"), pt("vythiri")])
    assert coast is not None and hills is not None
    assert hills > coast


def _ferry_edges(engine, a, b, options):
    shape = route_shape(engine.route([pt(a), pt(b)], costing_options=options))
    edges = engine.trace_attributes(shape, shape_match="edge_walk", costing_options=options,
                                    attributes=["edge.id", "edge.use"])["edges"]
    return [edge for edge in edges if edge.get("use") == "ferry"]


@pytest.mark.parametrize("extra", [{}, {"shortest": True}, {"use_lit": 1.0}], ids=["plain", "shortest", "lit"])
def test_exclude_ferries_keeps_ferry_edges_out(engine, extra):
    """Hard exclusion must hold whatever else is in the costing (use_ferry: 0 alone does not)."""
    options = {"exclude_ferries": True, **extra}
    assert _ferry_edges(engine, "chaliyam", "beypore", options) == []
    assert _ferry_edges(engine, "start_south_of_kadalundi", "kozhikode", options) == []


def test_ferry_is_used_between_chaliyam_and_beypore_when_allowed(engine):
    """Guards the fixture: if this stops holding, the OSM ferry tagging changed."""
    assert _ferry_edges(engine, "chaliyam", "beypore", {"use_ferry": 1.0})
