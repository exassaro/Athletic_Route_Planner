"""Build ids (Phase 4 amendment 14). Payloads are the shapes the live engines returned on 2026-11-18."""

import json
import re

from athlete_api import builds


def test_valhalla_build_names_version_and_tile_time():
    status = {"version": "3.9.2-2dc688aa7", "tileset_last_modified": 1794830855, "available_actions": []}
    assert builds.valhalla_build(status) == "valhalla 3.9.2-2dc688aa7 tiles 2026-11-16T12:07:35Z"


def test_a_rebuild_changes_the_valhalla_build():
    a = builds.valhalla_build({"version": "3.9.2", "tileset_last_modified": 1794830855})
    b = builds.valhalla_build({"version": "3.9.2", "tileset_last_modified": 1794830856})
    assert a != b


def test_graphhopper_build_names_version_and_import():
    info = {"version": "11.1", "import_date": "2026-11-17T09:07:35Z", "data_date": "2026-11-15T00:15:25Z"}
    assert builds.graphhopper_build(info) == "graphhopper 11.1 import 2026-11-17T09:07:35Z"


def test_solver_hash_is_stable_hex():
    h = builds.solver_hash()
    assert re.fullmatch(r"[0-9a-f]{16}", h)
    builds.solver_hash.cache_clear()
    assert builds.solver_hash() == h


def test_osm_pin_reads_the_manifest(tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"extract": {"osm_timestamp": "2026-11-15T00:15:25Z"}}), encoding="utf-8")
    assert builds.osm_pin(manifest) == "2026-11-15T00:15:25Z"
    assert builds.osm_pin(tmp_path / "missing.json") == "unknown"
