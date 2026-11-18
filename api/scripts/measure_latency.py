"""Latency through the API, per endpoint (Phase 4 step 11).

Usage:  uv run python api/scripts/measure_latency.py [--api http://localhost:8000] [--only S04,A01]

Run against the containerised API (docker compose --profile api up -d api) with the rate limits raised, since
one client makes far more than 20 solves a minute here:
  ATHLETE_RATE_SOLVE_PER_CLIENT_MIN=100000 ATHLETE_RATE_SOLVE_PER_IP_MIN=100000 \
  ATHLETE_RATE_READ_PER_CLIENT_MIN=100000 docker compose --profile api up -d api
The solve cache (Redis db 0, the API's) is flushed first. Requests run one at a time.

For every active point-to-point and out-and-back fixture: create (cold), create again (cache hit), PATCH +1 km
(cold), PATCH back (a cache hit through PATCH), GET plan, GET version, GET route, elevation, GPX. For loops:
create (cold) and create again (hit). The API container's memory is sampled throughout (docker stats).
Writes docs/reports/phase4/latency_data.json and latency.md. Measured on this machine, not the target server.
"""

import argparse
import json
import math
import statistics
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import redis

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "reports" / "phase4"
PATCH = {"Content-Type": "application/json-patch+json"}


def p(values: list[float], q: float) -> float:
    s = sorted(values)
    return s[max(0, math.ceil(q * len(s)) - 1)]


def summarise(values: list[float]) -> dict:
    if not values:
        return {"n": 0}
    return {"n": len(values), "p50_ms": round(p(values, 0.5) * 1000, 1), "p95_ms": round(p(values, 0.95) * 1000, 1),
            "max_ms": round(max(values) * 1000, 1), "mean_ms": round(statistics.fmean(values) * 1000, 1)}


class MemorySampler(threading.Thread):
    def __init__(self, container: str):
        super().__init__(daemon=True)
        self.container, self.samples, self.stop = container, [], threading.Event()

    def run(self):
        while not self.stop.is_set():
            out = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", self.container],
                                 capture_output=True, text=True).stdout.strip()
            if out:
                used = out.split(" / ")[0]
                unit = next(u for u in ("GiB", "MiB", "KiB", "B") if used.endswith(u))
                scale = {"GiB": 1024, "MiB": 1, "KiB": 1 / 1024, "B": 1 / 1024 ** 2}[unit]
                self.samples.append(float(used[: -len(unit)]) * scale)
            self.stop.wait(3.0)   # sparse sampling: docker stats itself costs CPU


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8000")
    parser.add_argument("--only", help="comma-separated fixture ids")
    args = parser.parse_args()
    fixtures = [f for f in json.loads((ROOT / "tests/fixtures/scenarios/scenarios.json").read_text(encoding="utf-8"))
                ["fixtures"] if f["status"] == "active" and f.get("request")]
    if args.only:
        wanted = set(args.only.split(","))
        fixtures = [f for f in fixtures if f["id"] in wanted]

    redis.Redis.from_url("redis://localhost:6379/0").flushdb()
    timings: dict[str, list[float]] = {}
    solver_s: dict[str, list[float]] = {"point_to_point": [], "loop": []}
    failures, rows = [], []
    sampler = MemorySampler("athlete-api")
    sampler.start()

    def timed(key: str, fid: str, method: str, url: str, expect_cached: bool | None = None, **kw):
        t0 = time.perf_counter()
        resp = http.request(method, url, **kw)
        dt = time.perf_counter() - t0
        ok = resp.status_code < 300
        if ok and expect_cached is not None and resp.json().get("cached") is not expect_cached:
            ok = False
            failures.append({"fixture": fid, "endpoint": key, "status": resp.status_code,
                             "error": f"cached is not {expect_cached}"})
        elif not ok:
            failures.append({"fixture": fid, "endpoint": key, "status": resp.status_code, "error": resp.text[:300]})
        if ok:
            timings.setdefault(key, []).append(dt)
        return resp, dt

    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with httpx.Client(base_url=args.api, timeout=120) as http:
        http.headers["X-Client-Token"] = http.post("/v1/session").json()["token"]
        for f in fixtures:
            kind = "loop" if f["request"]["route_type"] == "loop" else "point_to_point"
            body = {"request": f["request"], "source": "form"}
            created, dt_create = timed(f"{kind}: create", f["id"], "POST", "/v1/plans", False, json=body)
            if created.status_code != 201:
                continue
            v1 = created.json()
            if v1.get("elapsed_ms") is not None:
                solver_s[kind].append(v1["elapsed_ms"] / 1000)
            _, dt_hit = timed(f"{kind}: create, cache hit", f["id"], "POST", "/v1/plans", True, json=body)
            row = {"fixture": f["id"], "kind": kind, "outcome": v1["outcome"], "create_s": round(dt_create, 3),
                   "solver_s": None if v1["elapsed_ms"] is None else round(v1["elapsed_ms"] / 1000, 3),
                   "engine_calls": v1["engine_calls"], "hit_s": round(dt_hit, 3)}
            if kind == "point_to_point":
                pid, d = v1["plan_id"], f["request"]["target_distance_m"]
                patched, dt_patch = timed("point_to_point: patch", f["id"], "PATCH", f"/v1/plans/{pid}", False,
                                          headers=PATCH, content=json.dumps(
                                              [{"op": "replace", "path": "/target_distance_m", "value": d + 1000}]))
                _, dt_back = timed("point_to_point: patch, cache hit", f["id"], "PATCH", f"/v1/plans/{pid}", True,
                                   headers=PATCH, content=json.dumps(
                                       [{"op": "replace", "path": "/target_distance_m", "value": d}]))
                row.update(patch_s=round(dt_patch, 3), patch_hit_s=round(dt_back, 3),
                           patch_outcome=patched.json().get("outcome") if patched.status_code == 200 else None)
                timed("read: GET plan", f["id"], "GET", f"/v1/plans/{pid}")
                timed("read: GET version", f["id"], "GET", f"/v1/plans/{pid}/versions/1")
                if v1["candidates"]:
                    rid = v1["candidates"][0]["route_id"]
                    timed("read: GET route (GeoJSON)", f["id"], "GET", f"/v1/routes/{rid}")
                    timed("read: GET elevation", f["id"], "GET", f"/v1/routes/{rid}/elevation")
                    timed("read: GET gpx", f["id"], "GET", f"/v1/routes/{rid}/gpx")
            rows.append(row)
            print(json.dumps(row), flush=True)
        for _ in range(20):
            timed("read: GET health", "-", "GET", "/v1/health")
            timed("places: search", "-", "GET", "/v1/places/search", params={"q": "Kadalundi", "lat": 11.12, "lon": 75.85})
    sampler.stop.set()
    sampler.join(timeout=10)

    summary = {k: summarise(v) for k, v in sorted(timings.items())}
    data = {"measured_on": "development laptop (not the target server)", "started": started, "api": args.api,
            "fixtures": len(fixtures), "endpoints": summary,
            "solver_time": {k: summarise(v) for k, v in solver_s.items()},
            "api_memory_mib": {"samples": len(sampler.samples),
                               "max": round(max(sampler.samples), 1) if sampler.samples else None,
                               "median": round(statistics.median(sampler.samples), 1) if sampler.samples else None},
            "failures": failures, "rows": rows}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "latency_data.json").write_text(json.dumps(data, indent=1), encoding="utf-8")
    lines = ["# Phase 4: latency through the API", "",
             f"Measured on the development laptop (not the target server), {started}, through the containerised API "
             f"at {args.api}, one request at a time, on {len(fixtures)} active fixtures. Raw data: "
             "[latency_data.json](latency_data.json).", "",
             "| Endpoint | n | p50 (ms) | p95 (ms) | max (ms) |", "| --- | --- | --- | --- | --- |"]
    for k, s in summary.items():
        lines.append(f"| {k} | {s['n']} | {s['p50_ms']} | {s['p95_ms']} | {s['max_ms']} |")
    lines += ["", "Solver time inside those requests (the solver's own `elapsed_ms`):", "",
              "| Kind | n | p50 (ms) | p95 (ms) | max (ms) |", "| --- | --- | --- | --- | --- |"]
    for k, s in data["solver_time"].items():
        if s["n"]:
            lines.append(f"| {k} | {s['n']} | {s['p50_ms']} | {s['p95_ms']} | {s['max_ms']} |")
    lines += ["", f"API container memory (docker stats, {data['api_memory_mib']['samples']} samples): median "
              f"{data['api_memory_mib']['median']} MiB, max {data['api_memory_mib']['max']} MiB.", "",
              f"Failures: {len(failures)}."]
    lines += [f"- {x['fixture']} {x['endpoint']}: {x['status']} {x['error'][:120]}" for x in failures]
    (OUT / "latency.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
