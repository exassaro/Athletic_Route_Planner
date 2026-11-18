"""OpenAPI examples, generated from real solver output by api/scripts/build_examples.py (never written by hand)."""

import json
from functools import lru_cache
from pathlib import Path

DIR = Path(__file__).resolve().parent / "examples"


@lru_cache
def load(name: str) -> dict:
    path = DIR / f"{name}.json"
    if not path.exists():      # examples are documentation: a missing file must not stop the app
        return {"summary": f"{name} (not generated)", "value": None}
    return json.loads(path.read_text(encoding="utf-8"))


def examples(*names: str) -> dict:
    """{name: {summary, description, value}} for Body(openapi_examples=...)."""
    return {n: load(n) for n in names}


def content(*names: str, media: str = "application/json") -> dict:
    """{"content": {media: {"examples": ...}}} for a `responses` entry."""
    return {"content": {media: {"examples": examples(*names)}}}


def plan_wrapped(name: str) -> dict:
    """A plan read (GET /v1/plans/{id}) around a stored version example."""
    ex = load(name)
    v = ex["value"] or {}
    return {"summary": ex["summary"], "description": ex.get("description", ""),
            "value": {"plan_id": v.get("plan_id"), "status": "ready", "versions": list(range(1, v.get("version", 1) + 1)),
                      "latest": v, "error": None}}
