"""GPX 1.1 courses (Phase 4 amendments 9 and 21), validated against the official schema.

Candidates are the solver's real A01 and A02 output (Phase 3b report). Heights are test placeholders.
"""

import sys
from pathlib import Path

import pytest
from athlete_engine import geodesy
from athlete_solver.models import RouteRequest
from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "api"))
from api_fixtures import fixture_request, report_result  # noqa: E402

from athlete_api import gpx  # noqa: E402

XSD = etree.XMLSchema(etree.parse(str(Path(__file__).resolve().parents[2] / "fixtures" / "gpx" / "gpx.xsd")))
NS = {"g": gpx.NS}


def candidates():
    out = []
    for name, fid in (("A01", "A01"), ("A02", "A02")):
        res = report_result(name, RouteRequest.model_validate(fixture_request(fid)))
        out += [(f"{name} {c.label}/{c.option}", c) for c in res.candidates]
    return out


CANDS = candidates()


def heights(c):
    return [5.0 + (k % 11) * 0.5 for k in range(len(c.geometry))]


@pytest.mark.parametrize("name, cand", CANDS, ids=[n for n, _ in CANDS])
def test_valid_against_the_gpx_11_schema(name, cand):
    doc = etree.fromstring(gpx.build(cand, heights(cand)))
    XSD.assertValid(doc)


@pytest.mark.parametrize("name, cand", CANDS[:2], ids=[n for n, _ in CANDS[:2]])
def test_track_is_exactly_the_solver_geometry(name, cand):
    doc = etree.fromstring(gpx.build(cand, heights(cand)))
    pts = doc.findall(".//g:trkseg/g:trkpt", NS)
    track = [(float(p.get("lon")), float(p.get("lat"))) for p in pts]
    assert track == [tuple(p) for p in cand.geometry]
    assert geodesy.line_length_m(track) == pytest.approx(cand.length_m, abs=1e-6)
    assert [float(p.find("g:ele", NS).text) for p in pts] == heights(cand)
    assert doc.find(".//g:trkpt/g:time", NS) is None              # a course, not an activity
    assert doc.find("g:trk/g:type", NS).text == "running"


def test_waypoints_start_checkpoints_end_but_no_vias():
    _, cand = CANDS[0]
    doc = etree.fromstring(gpx.build(cand, heights(cand), title="Saturday long run"))
    wpts = doc.findall("g:wpt", NS)
    kinds = [w.find("g:type", NS).text for w in wpts]
    names = [w.find("g:name", NS).text for w in wpts]
    assert kinds == ["start"] + ["checkpoint"] * 6 + ["end"]
    assert names[1:7] == ["Kottakkadavu", "Kadalundi", "Chaliyam", "Karuvanthuruthy bridge", "Beypore", "Kallai"]
    assert names[-1] == cand.end.label
    passes = [w.find("g:desc", NS).text for w in wpts[1:7]]
    assert passes[3] == "Uses Karuvanthuruthy bridge"
    assert doc.find("g:metadata/g:name", NS).text == "Saturday long run"
    with_via = cand.model_copy(update={"stops": [*cand.stops, cand.stops[1].model_copy(update={"role": "via"})]})
    assert len(etree.fromstring(gpx.build(with_via, heights(cand))).findall("g:wpt", NS)) == len(wpts)


def test_declaration_is_utf8_double_quoted():
    _, cand = CANDS[0]
    assert gpx.build(cand, heights(cand)).startswith(gpx.DECLARATION + b"<gpx ")
    assert gpx.DECLARATION == b'<?xml version="1.0" encoding="UTF-8"?>\n'


def test_heights_must_match_vertices():
    _, cand = CANDS[0]
    with pytest.raises(ValueError):
        gpx.build(cand, [0.0])
