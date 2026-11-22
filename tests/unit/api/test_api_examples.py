"""The OpenAPI examples (real solver output, api/scripts/build_examples.py) still fit the API's models."""

import pytest

from athlete_api import examples
from athlete_api.main import create_app
from athlete_api.schemas import (ElevationOut, PlaceSearchOut, PlanCreate, PlanOut,
                                 PlanVersionOut, RouteFeature, SavedOut, SavedPatch, SavedRouteOut, SharedRouteOut)

MODELS = {
    "request_A01": PlanCreate, "request_S11": PlanCreate, "request_S02": PlanCreate, "request_G01": PlanCreate,
    "plan_A01": PlanVersionOut, "plan_A01_20km": PlanVersionOut, "plan_S11": PlanVersionOut,
    "plan_S02": PlanVersionOut, "plan_G01": PlanVersionOut, "route_A01": RouteFeature, "elevation_A01": ElevationOut,
    "saved_A01": SavedOut, "share_A01": SharedRouteOut, "places_kunnamangalam": PlaceSearchOut,
}


@pytest.mark.parametrize("name", list(MODELS))
def test_example_fits_its_model(name):
    ex = examples.load(name)
    assert ex["value"] is not None, f"{name} not generated: run api/scripts/build_examples.py"
    MODELS[name].model_validate(ex["value"])
    assert "Real" in ex.get("description", "") or name.startswith("request_")


def test_saved_route_examples_fit():
    SavedOut.model_validate(examples.load("saved_renamed_A01")["value"])
    for name in ("saved_rename", "saved_repoint"):
        SavedPatch.model_validate(examples.load(name)["value"])
    rows = examples.load("my_routes_A01")["value"]
    assert rows and all(SavedRouteOut.model_validate(r) for r in rows)


def test_plan_read_example_fits():
    PlanOut.model_validate(examples.plan_wrapped("plan_A01")["value"])


def test_examples_cover_every_outcome_shape():
    outcomes = {examples.load(n)["value"]["outcome"] for n in MODELS if n.startswith("plan_")}
    assert outcomes == {"ok", "over_budget", "infeasible"}
    options = {c["option"] for c in examples.load("plan_S11")["value"]["candidates"]}
    assert {"continue_past_target", "end_at_target", "detour_to_target"} <= options
    assert examples.load("plan_A01_20km")["value"]["diff"]["changed"] == ["/target_distance_m"]
    assert examples.load("plan_S02")["value"]["candidates"][0]["label"] == "loop_1"


def test_openapi_shows_them():
    spec = create_app().openapi()
    post = spec["paths"]["/v1/plans"]["post"]
    assert set(post["requestBody"]["content"]["application/json"]["examples"]) == {
        "request_A01", "request_S11", "request_S02", "request_G01"}
    assert "plan_A01" in post["responses"]["201"]["content"]["application/json"]["examples"]
    patch = spec["paths"]["/v1/plans/{plan_id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"]
    assert set(patch["examples"]) == {"patch_distance", "patch_undo"}
    saved = spec["paths"]["/v1/me/routes/{saved_id}"]
    assert set(saved) == {"patch", "delete"}
    body = saved["patch"]["requestBody"]["content"]["application/json"]
    assert set(body["examples"]) == {"saved_rename", "saved_repoint"} and "SavedPatch" in body["schema"]["$ref"]
