"""Kerala filter and ambiguity rule (Phase 4 amendments 8 and 17) on Photon responses recorded 2026-11-18."""

import json
from pathlib import Path

from athlete_api.places import ambiguity, normalise, place

PHOTON = Path(__file__).resolve().parents[2] / "fixtures" / "photon"


def recorded(name: str) -> tuple[str, list[dict]]:
    data = json.loads((PHOTON / f"{name}.json").read_text(encoding="utf-8"))
    places = [p for p in (place(f) for f in data["response"]["features"]) if p is not None]
    return data["params"].get("q"), places


def test_normalise():
    assert normalise("  Kadalundi ") == normalise("KADALUNDI") == "kadalundi"
    assert normalise("Puthiyangadi - Koothuparamba Road") == "puthiyangadi koothuparamba road"


def test_place_keeps_osm_id_and_coordinates():
    _, [p] = recorded("reverse_athanikkal")
    assert p["place_id"] == "osm:node/1770460252" and p["label"] == "Athanikkal"
    assert (p["lon"], p["lat"]) == (75.8460689, 11.1209333)      # the A01 start's own OSM coordinates
    assert p["kind"] == "place=village" and p["state"] == "Kerala"


def test_outside_kerala_and_unnamed_are_dropped():
    inside = {"geometry": {"coordinates": [75.8, 11.1]}, "properties": {"name": "X", "state": "Kerala", "osm_type": "N",
                                                                        "osm_id": 1}}
    assert place(inside)["place_id"] == "osm:node/1"
    assert place({**inside, "properties": {**inside["properties"], "state": "Tamil Nadu"}}) is None
    assert place({**inside, "properties": {**inside["properties"], "state": None}}) is None
    assert place({**inside, "properties": {**inside["properties"], "name": None}}) is None


def test_same_name_in_different_areas_is_ambiguous():
    q, places = recorded("search_chungam")
    ambiguous, reasons = ambiguity(q, places)
    chungam = next(r for r in reasons if r["name"] == "Chungam")
    assert ambiguous and chungam["reason"] == "same_name_different_areas"
    assert {"Kozhikode", "Palakkad"} <= set(chungam["counties"]) and chungam["count"] > 2

    q, places = recorded("search_kunnamangalam")
    ambiguous, reasons = ambiguity(q, places)
    assert ambiguous and reasons[0]["counties"] == ["Kozhikode", "Mananthavady"]


def test_same_name_in_one_district_is_still_ambiguous():
    q, places = recorded("search_kadalundi")
    ambiguous, reasons = ambiguity(q, places)
    kadalundi = next(r for r in reasons if r["name"] == "Kadalundi")
    assert ambiguous and kadalundi == {"reason": "same_name", "name": "Kadalundi", "count": 3, "counties": ["Kozhikode"]}


def test_one_exact_unique_result_is_not_ambiguous():
    _, places = recorded("search_kunnamangalam")
    one = [places[0]]
    assert ambiguity("Kunnamangalam", one) == (False, [])
    two_distinct = [places[0], {**places[0], "label": "Something else", "county": "Kozhikode"}]
    assert ambiguity("Kunnamangalam", two_distinct) == (False, [])
    assert ambiguity("Kunnamang", two_distinct)[1] == [{"reason": "no_exact_match", "name": "Kunnamang"}]


def test_nothing_found():
    q, places = recorded("search_nothing")
    assert places == [] and ambiguity(q, places) == (False, [])
