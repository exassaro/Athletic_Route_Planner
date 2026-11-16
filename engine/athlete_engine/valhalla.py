"""Minimal synchronous Valhalla HTTP client for the Phase 2 experiments.

All lengths returned by helpers here are in metres and come straight from the
engine's response (Valhalla reports kilometres; we multiply by 1000, nothing else).
Locations are (lon, lat) tuples or ready-made Valhalla location dicts.
"""

import os
import time
from collections.abc import Sequence
from typing import Any

import httpx

from . import polyline

DEFAULT_URL = os.environ.get("VALHALLA_URL", "http://localhost:8002")

Location = Sequence[float] | dict[str, Any]


class ValhallaError(RuntimeError):
    def __init__(self, status: int, body: Any):
        super().__init__(f"Valhalla HTTP {status}: {body}")
        self.status = status
        self.body = body


def loc(point: Sequence[float], **extra: Any) -> dict[str, Any]:
    """Build a Valhalla location dict from a (lon, lat) point."""
    return {"lon": point[0], "lat": point[1], **extra}


def _as_loc(point: Location) -> dict[str, Any]:
    return dict(point) if isinstance(point, dict) else loc(point)


class Valhalla:
    def __init__(self, base_url: str = DEFAULT_URL, timeout: float = 60.0):
        self._http = httpx.Client(base_url=base_url, timeout=timeout)
        self.last_elapsed_ms: float | None = None

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "Valhalla":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        start = time.perf_counter()
        resp = self._http.post(path, json=body)
        self.last_elapsed_ms = (time.perf_counter() - start) * 1000
        if resp.status_code != 200:
            try:
                detail = resp.json()
            except ValueError:
                detail = resp.text
            raise ValhallaError(resp.status_code, detail)
        return resp.json()

    def status(self) -> dict[str, Any]:
        resp = self._http.get("/status")
        resp.raise_for_status()
        return resp.json()

    def route(
        self,
        locations: Sequence[Location],
        costing: str = "pedestrian",
        costing_options: dict[str, Any] | None = None,
        **extra: Any,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "locations": [_as_loc(p) for p in locations],
            "costing": costing,
            "units": "kilometers",
            **extra,
        }
        if costing_options:
            body["costing_options"] = {costing: costing_options}
        return self._post("/route", body)

    def matrix(
        self,
        sources: Sequence[Location],
        targets: Sequence[Location],
        costing: str = "pedestrian",
        costing_options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "sources": [_as_loc(p) for p in sources],
            "targets": [_as_loc(p) for p in targets],
            "costing": costing,
            "units": "kilometers",
        }
        if costing_options:
            body["costing_options"] = {costing: costing_options}
        return self._post("/sources_to_targets", body)

    def isodistance(
        self,
        origin: Location,
        distances_km: Sequence[float],
        costing: str = "pedestrian",
        costing_options: dict[str, Any] | None = None,
        polygons: bool = True,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "locations": [_as_loc(origin)],
            "costing": costing,
            "contours": [{"distance": d} for d in distances_km],
            "polygons": polygons,
        }
        if costing_options:
            body["costing_options"] = {costing: costing_options}
        return self._post("/isochrone", body)

    def trace_attributes(
        self,
        shape: Sequence[Sequence[float]],
        costing: str = "pedestrian",
        costing_options: dict[str, Any] | None = None,
        shape_match: str = "map_snap",
        attributes: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        """Edge attributes along a (lon, lat) shape, e.g. a decoded route geometry."""
        body: dict[str, Any] = {
            "encoded_polyline": polyline.encode(shape),
            "costing": costing,
            "shape_match": shape_match,
            "units": "kilometers",
        }
        if attributes:
            body["filters"] = {"attributes": list(attributes), "action": "include"}
        if costing_options:
            body["costing_options"] = {costing: costing_options}
        return self._post("/trace_attributes", body)

    def height(self, points: Sequence[Sequence[float]]) -> list[float | None]:
        body = {"shape": [{"lon": p[0], "lat": p[1]} for p in points]}
        return self._post("/height", body)["height"]


def route_length_m(response: dict[str, Any]) -> float:
    """Engine-reported total length of a /route response, in metres."""
    return response["trip"]["summary"]["length"] * 1000.0


def route_shape(response: dict[str, Any]) -> list[tuple[float, float]]:
    """Full route geometry as (lon, lat) points, legs joined without duplicate joints."""
    points: list[tuple[float, float]] = []
    for leg in response["trip"]["legs"]:
        leg_points = polyline.decode(leg["shape"], precision=6)
        if points and leg_points and points[-1] == leg_points[0]:
            leg_points = leg_points[1:]
        points.extend(leg_points)
    return points
