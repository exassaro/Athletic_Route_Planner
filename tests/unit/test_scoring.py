import pytest

from athlete_engine import geodesy
from athlete_engine.measure import Edge
from athlete_solver.scoring import climb, diversify, jaccard, repetition, spurs


def chain(points, use="road"):
    """Edges along consecutive points."""
    return [Edge(id=i, way_id=i + 1, use=use, road_class="residential", names=[], shape=[p, q],
                 length_m=geodesy.distance_m(p, q)) for i, (p, q) in enumerate(zip(points, points[1:]))]


LINE = [(75.80, 11.00 + i * 0.001) for i in range(11)]   # ten edges of about 110 m


def test_no_repetition_on_a_simple_path():
    rep, forced = repetition(chain(LINE), forced_until_m=0)
    assert rep == 0 and forced == 0


def test_in_and_out_to_a_checkpoint_is_forced_repetition():
    out = chain(LINE[:6])
    back = [Edge(id=e.id, way_id=e.way_id, use=e.use, road_class=e.road_class, names=[],
                 shape=list(reversed(e.shape)), length_m=e.length_m) for e in reversed(out)]
    edges = out + back
    total = sum(e.length_m for e in edges)
    rep, forced = repetition(edges, forced_until_m=total)   # the whole thing is the route to the stops
    assert rep == pytest.approx(1.0)
    assert forced == pytest.approx(1.0)
    rep2, forced2 = repetition(edges, forced_until_m=0)
    assert rep2 == pytest.approx(1.0) and forced2 == 0


def test_spur_detected_unless_at_a_checkpoint():
    out = chain(LINE[:4])                                    # about 330 m out
    back = [Edge(id=e.id, way_id=e.way_id, use=e.use, road_class=e.road_class, names=[],
                 shape=list(reversed(e.shape)), length_m=e.length_m) for e in reversed(out)]
    edges = out + back
    turn_at = sum(e.length_m for e in out)
    assert len(spurs(edges, allowed_turns_m=[])) == 1
    assert spurs(edges, allowed_turns_m=[turn_at]) == []


class Heights:
    def __init__(self, f):
        self.f = f

    def heights(self, points):
        return [self.f(p) for p in points]


def test_climb_ignores_noise_below_threshold():
    # +-1 m noise on flat ground: no gain
    flat = Heights(lambda p: 10.0 + (1.0 if round(p[1] * 1e4) % 2 else -1.0))
    gain, loss = climb(flat, LINE)
    assert gain == 0 and loss == 0


def test_climb_counts_a_steady_rise():
    # 1 m per 10 m of distance north: the 1.1 km line rises about 111 m
    rise = Heights(lambda p: (p[1] - 11.0) * 111_000 / 10)
    gain, loss = climb(rise, LINE)
    total = geodesy.line_length_m(LINE) / 10
    assert gain == pytest.approx(total, rel=0.1)
    assert loss == 0


class C:
    def __init__(self, label, option, score):
        self.label, self.option, self.score = label, option, score


def test_diversity_keeps_only_distinct_alternatives():
    a, b, c = {1, 2, 3, 4, 5}, {1, 2, 3, 4, 6}, {7, 8, 9, 1, 2}
    assert jaccard(a, b) >= 0.6 and jaccard(a, c) < 0.6
    same = diversify([("recommended", [(C("recommended", "main", 1.0), a)]),
                      ("shortest", [(C("shortest", "main", 0.5), b)])], 2)
    assert [k.label for k in same] == ["recommended"]          # shortest overlaps 80%: dropped
    distinct = diversify([("recommended", [(C("recommended", "main", 1.0), a)]),
                          ("shortest", [(C("shortest", "main", 0.5), c)])], 2)
    assert [k.label for k in distinct] == ["recommended", "shortest"]


def test_options_of_one_alternative_stay_together_in_a_fixed_order():
    a = {1, 2, 3}
    kept = diversify([("recommended", [(C("recommended", "end_at_target", 1.0), a),
                                       (C("recommended", "continue_past_target", 2.0), a)])], 2)
    assert [k.option for k in kept] == ["continue_past_target", "end_at_target"]
    kept = diversify([("recommended", [(C("recommended", "cut_at_target", 0.1), a),
                                       (C("recommended", "full_route", 9.0), a)])], 2)
    assert [k.option for k in kept] == ["full_route", "cut_at_target"]


def test_national_highway_flag_needs_a_200_m_stretch():
    from athlete_solver.scoring import highway_flag
    short = chain(LINE[:2]) + chain(LINE[1:4])        # 110 m residential then about 330 m ...
    for e in short[1:]:
        e.road_class = "trunk"
        e.names = ["NH66"]
    flag = highway_flag(short)
    assert flag.code == "uses_national_highway" and "NH66" in flag.message
    crossing = chain(LINE[:3])
    crossing[1].road_class = "trunk"                  # one 110 m edge of trunk
    assert highway_flag(crossing).code == "crosses_national_highway"
    assert highway_flag(chain(LINE)) is None
