"""Write the API's OpenAPI schema for the front end (blueprint Phase 5 amendment 2).

Usage:  uv run python api/scripts/export_openapi.py [--check]

Writes web/src/api/openapi.json (keys sorted, so the file only changes when the schema does). The web app
generates its TypeScript types from it (`npm run gen:api` in web/). With --check, writes nothing and exits 1 if
the file is stale: CI runs this, then regenerates the types and fails on any difference.
No services are needed: the schema comes from the app object.
"""

import json
import sys
from pathlib import Path

from athlete_api.main import app

OUT = Path(__file__).resolve().parents[2] / "web" / "src" / "api" / "openapi.json"


def render() -> str:
    return json.dumps(app.openapi(), indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    text = render()
    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print(f"{OUT} is stale: run uv run python api/scripts/export_openapi.py, then npm run gen:api in web/",
                  file=sys.stderr)
            return 1
        print("openapi.json is current")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote {OUT} ({len(text) // 1024} KiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
