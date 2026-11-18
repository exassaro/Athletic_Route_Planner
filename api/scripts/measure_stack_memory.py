"""Memory of the whole stack with the API container up, during six simultaneous solves through it (Phase 4 step 11).

Usage:  uv run python api/scripts/measure_stack_memory.py [--api http://localhost:8000]

Needs every service up, Photon included, and the API container started with raised solve limits (see
measure_latency.py). Samples docker stats for every container while six different point-to-point requests are
sent at once, and records the peak per container, the VM's used memory, and each request's status.
Writes docs/reports/phase4/stack_memory_data.json.
"""

import argparse
import json
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import redis

sys.path.insert(0, str(Path(__file__).resolve().parent))
from measure_memory import docker_stats, vm_free  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SIX = ["S08", "A01", "S13", "X03", "X07", "F02"]   # the heavier point-to-point fixtures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8000")
    args = parser.parse_args()
    fixtures = {f["id"]: f for f in json.loads((ROOT / "tests/fixtures/scenarios/scenarios.json")
                                               .read_text(encoding="utf-8"))["fixtures"]}
    redis.Redis.from_url("redis://localhost:6379/0").flushdb()
    idle = {"containers": docker_stats(), "vm": vm_free()}
    samples, stop = [], threading.Event()

    def sampler():
        while not stop.is_set():
            samples.append({"containers": docker_stats(), "vm": vm_free()})

    thread = threading.Thread(target=sampler, daemon=True)
    thread.start()
    with httpx.Client(base_url=args.api, timeout=120) as http:
        http.headers["X-Client-Token"] = http.post("/v1/session").json()["token"]

        def post(fid):
            t0 = time.perf_counter()
            r = http.post("/v1/plans", json={"request": fixtures[fid]["request"]})
            return {"fixture": fid, "status": r.status_code, "seconds": round(time.perf_counter() - t0, 2),
                    "error": None if r.status_code < 300 else r.json().get("error")}

        t0 = time.perf_counter()
        with ThreadPoolExecutor(len(SIX)) as pool:
            requests = list(pool.map(post, SIX))
        wall = time.perf_counter() - t0
    time.sleep(2)
    stop.set()
    thread.join()
    peak = {}
    for s in samples:
        for name, row in s["containers"].items():
            peak[name] = max(peak.get(name, 0), row["used_mib"])
    data = {"measured_on": "development laptop (not the target server)", "requests": requests,
            "wall_s": round(wall, 1), "idle": idle, "peak_mib": peak, "samples": len(samples),
            "peak_vm_used_mib": max(s["vm"]["used"] for s in samples),
            "min_vm_available_mib": min(s["vm"].get("available", s["vm"]["free"]) for s in samples)}
    (ROOT / "docs/reports/phase4/stack_memory_data.json").write_text(json.dumps(data, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in data.items() if k != "idle"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
