"""Phase 4 step 1: memory with every service up, with and without Photon.

Usage:  uv run python api/scripts/measure_memory.py [--keep-photon]

Phases:
  1. idle: Valhalla, GraphHopper, Postgres, Redis (Photon stopped);
  2. the A01 acceptance solve on the host, docker stats sampled throughout;
  3. Photon started, a few searches, idle again;
  4. the A01 solve again with Photon up.
Photon is stopped again at the end unless --keep-photon is given.

Records per-container usage (docker stats), the WSL VM's own view (`free` inside a
container), free physical memory on Windows, the solver process's peak working set,
and whether any container was OOM-killed. Writes docs/reports/phase4/memory_data.json
and docs/reports/phase4/memory.md. Measured on this laptop, not the target server.
"""

import argparse
import ctypes
import json
import platform
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from athlete_solver.__main__ import graph_build
from athlete_solver.models import RouteRequest
from athlete_solver.solve import solve

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "reports" / "phase4"
CONTAINERS = ["athlete-valhalla", "athlete-graphhopper", "athlete-postgres", "athlete-redis", "athlete-photon"]
PHOTON_URL = "http://localhost:2322"
PHOTON_QUERIES = ["Kadalundi", "Chaliyam", "Beypore", "Kozhikode", "Mananchira"]
PHOTON_LOAD_ROUNDS = 20   # every fixture place name searched and reversed this many times: lets the JVM heap grow

UNITS = {"B": 1, "KiB": 1024, "MiB": 1024 ** 2, "GiB": 1024 ** 3, "kB": 1000, "MB": 1000 ** 2, "GB": 1000 ** 3}


def mib(text: str) -> float:
    text = text.strip()
    for unit in sorted(UNITS, key=len, reverse=True):
        if text.endswith(unit):
            return float(text[: -len(unit)]) * UNITS[unit] / 1024 ** 2
    return float(text) / 1024 ** 2


def docker_stats() -> dict[str, dict]:
    out = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{json .}}"],
                         capture_output=True, text=True, check=True).stdout
    stats = {}
    for line in out.splitlines():
        row = json.loads(line)
        used, limit = row["MemUsage"].split(" / ")
        stats[row["Name"]] = {"used_mib": round(mib(used), 1), "limit_mib": round(mib(limit), 1),
                              "cpu_pct": float(row["CPUPerc"].rstrip("%"))}
    return stats


def vm_free() -> dict:
    """The WSL VM's memory as seen from inside a container (busybox free, MiB)."""
    out = subprocess.run(["docker", "exec", "athlete-redis", "free", "-m"], capture_output=True, text=True,
                         check=True).stdout.split("\n")
    head = out[0].split()
    mem = out[1].split()[1:]
    swap = out[2].split()[1:] if len(out) > 2 and out[2].startswith("Swap") else []
    row = dict(zip(head, map(int, mem)))
    if swap:
        row["swap_used"] = int(swap[1])
        row["swap_total"] = int(swap[0])
    return row


def host_memory() -> dict:
    """Windows physical memory (MiB)."""
    cmd = ("$o = Get-CimInstance Win32_OperatingSystem; "
           "\"$($o.TotalVisibleMemorySize) $($o.FreePhysicalMemory)\"")
    out = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True,
                         check=True).stdout.split()
    total, free = (int(v) / 1024 for v in out)
    return {"total_mib": round(total), "free_mib": round(free)}


class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
    _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]


def own_memory_mib() -> dict:
    if platform.system() != "Windows":
        return {}
    c = PROCESS_MEMORY_COUNTERS()
    c.cb = ctypes.sizeof(c)
    kernel32, psapi = ctypes.windll.kernel32, ctypes.windll.psapi
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(PROCESS_MEMORY_COUNTERS), ctypes.c_ulong]
    psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(c), c.cb)
    return {"working_set_mib": round(c.WorkingSetSize / 1024 ** 2, 1),
            "peak_working_set_mib": round(c.PeakWorkingSetSize / 1024 ** 2, 1)}


def oom_killed() -> dict[str, bool]:
    out = {}
    for name in CONTAINERS:
        res = subprocess.run(["docker", "inspect", "-f", "{{.State.OOMKilled}} {{.State.Status}}", name],
                             capture_output=True, text=True)
        if res.returncode == 0:
            killed, status = res.stdout.split()
            out[name] = {"oom_killed": killed == "true", "status": status}
    return out


def snapshot(label: str) -> dict:
    return {"label": label, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "containers": docker_stats(), "vm": vm_free(), "host": host_memory()}


def solve_sampled(label: str, request: RouteRequest) -> dict:
    """Solve A01 while sampling docker stats; keep the peak per container and the lowest free memory."""
    samples: list[dict] = []
    stop = threading.Event()

    def sampler():
        while not stop.is_set():
            samples.append({"containers": docker_stats(), "vm": vm_free(), "host": host_memory()})

    thread = threading.Thread(target=sampler, daemon=True)
    thread.start()
    t0 = time.perf_counter()
    result = solve(request, graph_build=graph_build())
    elapsed = time.perf_counter() - t0
    time.sleep(1.0)   # one more sample after the solve
    stop.set()
    thread.join()
    peak = {}
    for s in samples:
        for name, row in s["containers"].items():
            if row["used_mib"] > peak.get(name, {}).get("used_mib", -1):
                peak[name] = row
    return {"label": label, "elapsed_s": round(elapsed, 2), "outcome": result.outcome,
            "lengths_m": [round(c.foot_m, 1) for c in result.candidates],
            "samples": len(samples), "peak_containers": peak,
            "peak_vm_used_mib": max(s["vm"]["used"] for s in samples),
            "min_vm_available_mib": min(s["vm"].get("available", s["vm"]["free"]) for s in samples),
            "max_vm_swap_used_mib": max(s["vm"].get("swap_used", 0) for s in samples),
            "min_host_free_mib": min(s["host"]["free_mib"] for s in samples),
            "solver_process": own_memory_mib()}


def wait_photon(timeout_s: float = 300) -> float:
    t0 = time.perf_counter()
    while time.perf_counter() - t0 < timeout_s:
        try:
            if httpx.get(f"{PHOTON_URL}/api", params={"q": "Kozhikode", "limit": 1}, timeout=5).status_code == 200:
                return time.perf_counter() - t0
        except httpx.HTTPError:
            pass
        time.sleep(2)
    raise RuntimeError("Photon did not answer within the timeout")


def place_names(places) -> list[tuple[str, float, float]]:
    """(name, lon, lat) for every place in tests/fixtures/places.json, whatever its nesting."""
    out = []

    def walk(node):
        if isinstance(node, dict):
            name = node.get("label") or node.get("name")
            if isinstance(name, str) and isinstance(node.get("lon"), (int, float)) and isinstance(node.get("lat"), (int, float)):
                out.append((name, node["lon"], node["lat"]))
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(places)
    return out


def compose(*args: str) -> None:
    subprocess.run(["docker", "compose", *args], cwd=ROOT, check=True, capture_output=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep-photon", action="store_true")
    args = parser.parse_args()

    fixtures = json.loads((ROOT / "tests/fixtures/scenarios/scenarios.json").read_text(encoding="utf-8"))["fixtures"]
    a01 = RouteRequest.model_validate(next(f for f in fixtures if f["id"] == "A01")["request"])

    data = {"measured_on": "development laptop (not the target server)",
            "docker_mem_total_mib": round(int(subprocess.run(["docker", "info", "--format", "{{.MemTotal}}"],
                                                              capture_output=True, text=True).stdout) / 1024 ** 2),
            "steps": []}
    compose("--profile", "geocode", "stop", "photon")
    time.sleep(3)
    data["steps"].append(snapshot("idle, Photon stopped"))
    data["steps"].append(solve_sampled("A01 solve, Photon stopped", a01))

    compose("--profile", "geocode", "up", "-d", "photon")
    data["photon_start_s"] = round(wait_photon(), 1)
    times = []
    for q in PHOTON_QUERIES:
        t0 = time.perf_counter()
        httpx.get(f"{PHOTON_URL}/api", params={"q": q, "lat": 11.25, "lon": 75.78, "limit": 10}, timeout=30)
        times.append(round((time.perf_counter() - t0) * 1000, 1))
    data["photon_query_ms"] = times
    places = json.loads((ROOT / "tests/fixtures/places.json").read_text(encoding="utf-8"))
    names = place_names(places)
    t0 = time.perf_counter()
    count = 0
    with httpx.Client(base_url=PHOTON_URL, timeout=30) as http:
        for _ in range(PHOTON_LOAD_ROUNDS):
            for name, lon, lat in names:
                http.get("/api", params={"q": name, "lat": lat, "lon": lon, "limit": 10})
                http.get("/reverse", params={"lat": lat, "lon": lon})
                count += 2
    data["photon_load"] = {"requests": count, "seconds": round(time.perf_counter() - t0, 1)}
    time.sleep(5)
    data["steps"].append(snapshot("idle, Photon up"))
    data["steps"].append(solve_sampled("A01 solve, Photon up", a01))
    data["oom"] = oom_killed()
    if not args.keep_photon:
        compose("--profile", "geocode", "stop", "photon")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "memory_data.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(json.dumps(data, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
