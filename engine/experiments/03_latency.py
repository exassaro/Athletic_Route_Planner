"""Step 6: latency of a ~25 km pedestrian route, and of the other primitives.

Usage:  docker compose restart valhalla      # optional: makes the first call a true cold call
        uv run python engine/experiments/03_latency.py

Routes are chosen by their *routed* length (24 to 26 km as reported by the
engine), never by an assumed distance. Timing is wall-clock per HTTP request
from this machine, so it includes Docker Desktop's port forwarding.
Acceptance (blueprint section 15): a 25 km pedestrian route in under 300 ms.
Writes docs/reports/phase2/latency.md.
"""

import json
import statistics
import subprocess
import sys
import time
from pathlib import Path

import httpx

from athlete_engine.valhalla import DEFAULT_URL, Valhalla, ValhallaError, route_length_m, route_shape

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "reports" / "phase2"
PLACES = json.loads((ROOT / "tests" / "fixtures" / "places.json").read_text(encoding="utf-8"))["places"]
PAIRS = json.loads((ROOT / "tests" / "fixtures" / "od_pairs.json").read_text(encoding="utf-8"))

TARGET_MS = 300.0
LENGTH_WINDOW_M = (24_000.0, 26_000.0)
WARM_RUNS = 30
MAX_ROUTES = 6
CONTAINER = "athlete-valhalla"


def pt(name: str) -> tuple[float, float]:
    return (PLACES[name]["lon"], PLACES[name]["lat"])


def wait_until_up(timeout_s: float = 120) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            if httpx.get(f"{DEFAULT_URL}/status", timeout=3).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(1)
    raise SystemExit(f"Valhalla not reachable at {DEFAULT_URL}")


def summarise(samples: list[float]) -> dict[str, float]:
    ordered = sorted(samples)
    p95 = ordered[min(len(ordered) - 1, round(0.95 * (len(ordered) - 1)))]
    return {"p50": statistics.median(ordered), "p95": p95, "max": ordered[-1], "min": ordered[0]}


def timed(engine: Valhalla, call, runs: int) -> list[float]:
    samples = []
    for _ in range(runs):
        call()
        samples.append(engine.last_elapsed_ms)
    return samples


def container_memory() -> str:
    try:
        out = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", CONTAINER],
                             capture_output=True, text=True, timeout=30)
        return out.stdout.strip() or "unavailable"
    except (OSError, subprocess.SubprocessError):
        return "unavailable"


def fmt(s: dict[str, float]) -> str:
    return f"{s['p50']:.0f} | {s['p95']:.0f} | {s['max']:.0f}"


def main() -> int:
    wait_until_up()
    mem_before = container_memory()
    with Valhalla() as engine:
        version = engine.status().get("version")

        # First routing request of this run. Only a true cold call if the container was just restarted.
        fixture_pair = ("start_south_of_kadalundi -> kozhikode", pt("start_south_of_kadalundi"), pt("kozhikode"))
        first = engine.route([fixture_pair[1], fixture_pair[2]])
        first_ms = engine.last_elapsed_ms
        first_len = route_length_m(first)

        candidates = [fixture_pair] + [
            (f"pair {p['id']}", (p["from"]["lon"], p["from"]["lat"]), (p["to"]["lon"], p["to"]["lat"]))
            for p in PAIRS["pairs"]
        ]
        chosen = []
        for label, a, b in candidates:
            try:
                resp = engine.route([a, b])
            except ValhallaError:
                continue
            length = route_length_m(resp)
            if LENGTH_WINDOW_M[0] <= length <= LENGTH_WINDOW_M[1]:
                chosen.append((label, a, b, length, route_shape(resp)))
            if len(chosen) == MAX_ROUTES:
                break
        if not chosen:
            raise SystemExit("No fixture pair has a routed length of 24 to 26 km; extend od_pairs.json.")

        route_rows = []
        all_samples: list[float] = []
        for label, a, b, length, shape in chosen:
            samples = timed(engine, lambda a=a, b=b: engine.route([a, b]), WARM_RUNS)
            all_samples += samples
            route_rows.append((label, length, summarise(samples)))
        overall = summarise(all_samples)

        five = [pt(n) for n in ["start_south_of_kadalundi", "kadalundi", "chaliyam", "beypore", "kozhikode"]]
        long_shape = chosen[0][4]
        others = [
            ("Matrix 5 x 5 (worked-example points)", summarise(timed(engine, lambda: engine.matrix(five, five), 20))),
            ("Isodistance 5 km from Beypore", summarise(timed(engine, lambda: engine.isodistance(pt("beypore"), [5.0]), 10))),
            ("Isodistance 12.5 km from Beypore", summarise(timed(engine, lambda: engine.isodistance(pt("beypore"), [12.5]), 10))),
            (f"trace_attributes (edge_walk) on the {chosen[0][3] / 1000:.1f} km route, {len(long_shape)} shape points",
             summarise(timed(engine, lambda: engine.trace_attributes(long_shape, shape_match="edge_walk",
                                                                     attributes=["edge.id", "edge.length", "edge.use", "edge.road_class"]), 10))),
        ]
    mem_after = container_memory()

    passed = overall["p95"] < TARGET_MS
    md = [
        "# Phase 2: latency", "",
        f"Valhalla {version}, pedestrian costing, 2 server threads, OSM data {PAIRS['osm_timestamp']}.", "",
        "**Where measured:** the development laptop (Intel i5 10th gen, Docker Desktop on WSL2), requests sent "
        "one at a time from the host. This is not the target server named in the acceptance criterion, and "
        "timings include Docker Desktop's port forwarding.", "",
        "## Pedestrian routes of 24 to 26 km", "",
        f"Routes were selected because the engine reported their length inside that window. {WARM_RUNS} consecutive "
        "requests each.", "",
        "| Route | Engine length (m) | p50 (ms) | p95 (ms) | max (ms) |", "| --- | --- | --- | --- | --- |",
    ]
    md += [f"| {label} | {length:.0f} | {fmt(s)} |" for label, length, s in route_rows]
    md += [f"| **All {len(all_samples)} requests** | | {fmt(overall)} |", "",
           f"First routing request of this run ({fixture_pair[0]}, {first_len:.0f} m): {first_ms:.0f} ms. "
           "This is a cold-start figure only if the container was restarted just before the run.", "",
           f"**{'PASS' if passed else 'FAIL'}**: p95 {overall['p95']:.0f} ms against the {TARGET_MS:.0f} ms target.", "",
           "## Other primitives", "", "| Call | p50 (ms) | p95 (ms) | max (ms) |", "| --- | --- | --- | --- |"]
    md += [f"| {label} | {fmt(s)} |" for label, s in others]
    md += ["", "## Memory", "",
           f"Container memory (`docker stats`): {mem_before} before the run, {mem_after} after it.", ""]

    OUT.mkdir(parents=True, exist_ok=True)
    report = OUT / "latency.md"
    report.write_text("\n".join(md), encoding="utf-8")
    print(f"First request: {first_ms:.0f} ms")
    for label, length, s in route_rows:
        print(f"{label:40s} {length / 1000:6.2f} km  p50 {s['p50']:.0f}  p95 {s['p95']:.0f}  max {s['max']:.0f} ms")
    print(f"Overall p95 {overall['p95']:.0f} ms -> {'PASS' if passed else 'FAIL'} (target {TARGET_MS:.0f} ms)")
    for label, s in others:
        print(f"{label[:60]:60s} p50 {s['p50']:.0f}  p95 {s['p95']:.0f} ms")
    print(f"Memory: {mem_before} -> {mem_after}")
    print(f"Report: {report.relative_to(ROOT).as_posix()}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
