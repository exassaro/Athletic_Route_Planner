"""Follow cues (Phase 5d A15) on recorded Valhalla traces, and on made-up lines for the definitions. No network.

tests/fixtures/follow/traces.json is written by api/scripts/measure_cues.py from live Valhalla.
"""

import json
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest
from athlete_engine import geodesy, polyline

from athlete_api import follow

ROOT = Path(__file__).resolve().parents[3]
TRACES = json.loads((ROOT / "tests/fixtures/follow/traces.json").read_text(encoding="utf-8"))["tracks"]
MEASURED = json.loads((ROOT / "docs/reports/phase5d/cues_data.json").read_text(encoding="utf-8"))["tracks"]


def track(name: str) -> follow.Line:
    file = "S02_loop_1.gpx" if name == "S02 loop" else "A01_recommended.gpx"
    root = ET.parse(ROOT / "docs/reports/phase4/gpx" / file)
    line = [(float(p.get("lon")), float(p.get("lat")))
            for p in root.iter("{http://www.topografix.com/GPX/1/1}trkpt")]
    if "out and back" in name:
        half = geodesy.cut_at(line, geodesy.line_length_m(line) / 2)
        line = half + half[-2::-1]
    return follow.Line(line)


def cued(name: str) -> tuple[follow.Line, follow.Match, list[follow.Cue]]:
    line, answers = track(name), iter(TRACES[name])
    match = line.match(lambda piece: next(answers))
    return line, match, follow.cues(line, match)


def flat(cues: list[follow.Cue]) -> list[follow.Step]:
    return [s for c in cues for s in (c, *c.then)]


@pytest.mark.parametrize("name", list(TRACES))
def test_cues_are_exactly_the_measured_ones(name):
    _, _, got = cued(name)
    expected = MEASURED[name]["cues"]
    assert len(got) == len(expected)
    for cue, want in zip(got, expected):
        assert cue.at_m == pytest.approx(want["at_m"], abs=0.1)
        assert (cue.turn, cue.road) == (want["turn"], want["road"])
        assert [(s.turn, s.road) for s in cue.then] == [(s["turn"], s["road"]) for s in want["then"]]


@pytest.mark.parametrize(("name", "count", "bare"), [("A01 recommended", 35, 45), ("S02 loop", 37, 39)])
def test_cue_counts_with_and_without_valhalla(name, count, bare):
    line, _, got = cued(name)
    assert len(got) == count
    without = follow.cues(line, None)
    assert len(without) == bare and all(s.road is None for s in flat(without))
    assert len(flat(got)) < len(flat(without))      # bends that are not junctions are gone


@pytest.mark.parametrize("name", list(TRACES))
def test_cues_are_in_order_on_the_route_and_not_under_50_m_apart(name):
    line, match, got = cued(name)
    at = [s.at_m for s in flat(got)]
    assert at == sorted(at) and all(0 < x < line.length_m for x in at)
    for a, b in zip(got, got[1:]):
        assert b.at_m - (a.then[-1].at_m if a.then else a.at_m) >= follow.MERGE_M
    assert match.unmatched == []
    for step in flat(got):
        assert step.road is None or step.road.upper() not in follow.CLASS_ONLY


@pytest.mark.parametrize("name", list(TRACES))
def test_metres_along_end_at_the_geometrys_length(name):
    line = track(name)
    assert line.along_m[0] == 0 and line.along_m == sorted(line.along_m)
    assert line.length_m == pytest.approx(geodesy.line_length_m(line.geometry), abs=1e-5)


def test_road_names_on_a01():
    _, _, got = cued("A01 recommended")
    assert next(c for c in got if abs(c.at_m - 3821.3) < 1).road == "Chaliyam Road"


def test_an_out_and_back_turns_around_once_and_is_matched_in_two_pieces():
    line, _, got = cued("A01 half, out and back")
    around = [s for s in flat(got) if s.turn == "around"]
    assert len(around) == 1 and around[0].at_m == pytest.approx(line.length_m / 2, abs=0.1)
    assert len(line.pieces()) == 2


def test_a01s_164_degree_corner_is_a_turn_and_not_a_turnaround():
    line, _, got = cued("A01 recommended")
    assert line.turnarounds() == []
    assert next(c for c in got if abs(c.at_m - 11938.2) < 1).turn == "left"


# ---------------------------------------------------------------- made-up lines, for the definitions

A = (75.85, 11.10)


def walk(*legs: tuple[float, float]) -> follow.Line:
    """A line from A of (bearing, metres) legs."""
    points = [A]
    for bearing, metres in legs:
        points.append(geodesy.destination(points[-1], bearing, metres))
    return follow.Line(points)


def junctions(*at: float, names: list | None = None) -> follow.Match:
    return follow.Match(junctions=sorted(at), name_from=names or [])


def test_right_and_left():
    assert [c.turn for c in follow.cues(walk((0, 200), (90, 200)), None)] == ["right"]
    assert [c.turn for c in follow.cues(walk((0, 200), (270, 200)), None)] == ["left"]
    assert [c.turn for c in follow.cues(walk((350, 200), (80, 200)), None)] == ["right"]     # across north


@pytest.mark.parametrize(("degrees", "found"), [(30, 0), (34, 0), (36, 1), (90, 1), (170, 1)])
def test_only_a_change_over_35_degrees_is_a_bend(degrees, found):
    assert len(walk((0, 200), (degrees, 200)).bends()) == found


def test_a_curve_slower_than_35_degrees_in_20_m_is_no_bend():
    assert walk((0, 100), *[(d, 30) for d in range(20, 100, 20)], (100, 100)).bends() == []


def test_a_bend_is_a_cue_only_at_a_junction():
    line = walk((0, 200), (90, 200))
    assert follow.cues(line, junctions()) == []
    assert follow.cues(line, junctions(230.0)) == []
    assert [c.at_m for c in follow.cues(line, junctions(208.0))] == [208.0]


def test_a_junction_without_a_bend_is_no_cue():
    assert follow.cues(walk((0, 400)), junctions(100.0, 200.0)) == []


def test_a_turnaround_is_a_cue_without_a_junction():
    line = walk((0, 300), (180, 300))
    got = follow.cues(line, junctions())
    assert [c.turn for c in got] == ["around"] and got[0].at_m == pytest.approx(300, abs=0.1)


def test_a_short_spur_keeps_the_turns_either_side_of_it():
    got = flat(follow.cues(walk((0, 200), (90, 17), (270, 17), (0, 200)), None))
    assert [s.turn for s in got] == ["right", "around", "right"]


def test_turns_under_50_m_apart_are_merged_and_none_is_dropped():
    line = walk((0, 200), (90, 30), (0, 30), (90, 200), (0, 200))
    got = follow.cues(line, None)
    assert [(c.turn, [s.turn for s in c.then]) for c in got] == [("right", ["left", "right"]), ("left", [])]


def test_the_name_is_the_road_after_the_turn():
    line = walk((0, 200), (90, 200))
    got = follow.cues(line, junctions(200.0, names=[(0, "North Road"), (200, "East Road")]))
    assert got[0].road == "East Road"


def test_no_name_for_the_road_the_runner_is_already_on():
    line = walk((0, 200), (90, 200))
    assert follow.cues(line, junctions(200.0, names=[(0, "Station Road"), (200, "Station Road.")]))[0].road is None


def test_a_name_is_never_borrowed_from_after_the_next_turn():
    line = walk((0, 200), (90, 20), (0, 200))
    got = follow.cues(line, junctions(200.0, 220.0, names=[(0, "First"), (200, None), (220, "Third")]))
    assert (got[0].road, got[0].then[0].road) == (None, "Third")


def test_a_class_of_road_is_not_a_name():
    assert follow.road_name(["MDR"]) is None and follow.road_name([]) is None
    assert follow.road_name(["MDR", "Beach Road"]) == "Beach Road"
    assert follow.road_name(["NH 66"]) == "NH 66"


def test_a_stretch_valhalla_did_not_match_keeps_its_turns():
    line = walk((0, 200), (90, 200))
    for answer in ({}, {"edges": [{"begin_shape_index": 0, "end_shape_index": 2}],
                        "shape": polyline.encode(line.geometry),
                        "matched_points": [{"type": "matched", "edge_index": 0}, {"type": "unmatched"},
                                           {"type": "matched", "edge_index": 0}]}):
        got = follow.cues(line, line.match(lambda piece: answer))
        assert [(c.turn, c.road) for c in got] == [("right", None)]


def test_a_matched_stretch_drops_a_bend_that_is_not_a_junction():
    line = walk((0, 200), (90, 200))
    answer = {"edges": [{"begin_shape_index": 0, "end_shape_index": 2}], "shape": polyline.encode(line.geometry),
              "matched_points": [{"type": "matched", "edge_index": 0}] * 3}
    assert follow.cues(line, line.match(lambda piece: answer)) == []
