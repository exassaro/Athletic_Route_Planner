"""Apply our overrides to the valhalla.json the container generated.

Usage:  uv run python engine/scripts/configure_valhalla.py
        docker compose restart valhalla      # if the service was already serving

Overrides live in engine/valhalla/overrides.json as {"dotted.path": value}.
The script fails if a path does not already exist, so a renamed Valhalla
setting is noticed instead of being silently added as a dead key.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "data" / "valhalla" / "valhalla.json"
OVERRIDES = ROOT / "engine" / "valhalla" / "overrides.json"


def main() -> int:
    if not CONFIG.exists():
        print("data/valhalla/valhalla.json not found. Start the container once first.", file=sys.stderr)
        return 1
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8"))

    changed = False
    for dotted, value in overrides.items():
        *parents, leaf = dotted.split(".")
        node = config
        for key in parents:
            node = node[key]
        if leaf not in node:
            print(f"Unknown setting: {dotted}", file=sys.stderr)
            return 1
        if node[leaf] != value:
            print(f"{dotted}: {node[leaf]!r} -> {value!r}")
            node[leaf] = value
            changed = True
        else:
            print(f"{dotted}: already {value!r}")

    if changed:
        CONFIG.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        print("Config updated. Restart Valhalla if it is already serving.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
