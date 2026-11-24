#!/usr/bin/env bash
# Local check of engine/caddy/Caddyfile.prod, no certificate and no real server: runs caddy:2.10.2 on
# http://127.0.0.1:18080 with a small fake basemap and a stand-in "api" (a few lines of Python on :8000), then
# shows the headers and runs deploy/health.sh's basemap checks against it. Removes everything it started.
#   bash deploy/test_caddy.sh        (Docker must be running; works in Git Bash on Windows)
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"

IMAGE=caddy:2.10.2
# the API image's own base (api/Dockerfile), for a stand-in API
STUB_IMAGE=python@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
NET=gatho-caddy-test
WORK="$(mktemp -d)"
# a host path Docker understands (Git Bash on Windows needs C:/..., not /c/...)
hostpath() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
# Git Bash would rewrite container paths such as /etc/caddy: not for docker
dk() { MSYS_NO_PATHCONV=1 docker "$@"; }
cleanup() {
	dk rm -f gatho-caddy-test gatho-api-stub >/dev/null 2>&1 || true
	dk network rm "$NET" >/dev/null 2>&1 || true
	rm -rf "$WORK"
}
trap cleanup EXIT

say "caddy validate"
dk run --rm -e API_SITE=api.gatho.shahinsha.xyz \
	-v "$(hostpath "$ROOT/engine/caddy/Caddyfile.prod"):/etc/caddy/Caddyfile:ro" \
	"$IMAGE" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

say "Fake basemap: a 200 kB file that starts with the PMTiles magic, one font range, one sprite JSON"
mkdir -p "$WORK/basemap/fonts/Noto Sans Regular" "$WORK/basemap/sprites/v4" "$WORK/logs"
{
	printf 'PMTiles\003'
	head -c 200000 /dev/urandom
} >"$WORK/basemap/kerala.pmtiles"
head -c 3000 /dev/urandom >"$WORK/basemap/fonts/Noto Sans Regular/0-255.pbf"
"$(pick_python)" -c 'import json;print(json.dumps({f"icon{i}": {"x": i, "y": 0, "width": 16, "height": 16, "pixelRatio": 1} for i in range(200)}))' \
	>"$WORK/basemap/sprites/v4/light.json"
# The stand-in API reads every request body (as uvicorn does), so Caddy's body limit can be seen.
cat >"$WORK/stub.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def _answer(self):
        n = int(self.headers.get("Content-Length") or 0)
        while n > 0:
            got = self.rfile.read(min(n, 65536))
            if not got:
                break
            n -= len(got)
        body = b'{"status":"ok","services":{"stub":{"ok":true}}}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    do_GET = do_POST = _answer
HTTPServer(("0.0.0.0", 8000), H).serve_forever()
PY

# leftovers of an interrupted run
dk rm -f gatho-caddy-test gatho-api-stub >/dev/null 2>&1 || true
dk network rm "$NET" >/dev/null 2>&1 || true
dk network create "$NET" >/dev/null
dk run -d --name gatho-api-stub --network "$NET" --network-alias api \
	-v "$(hostpath "$WORK/stub.py"):/stub.py:ro" "$STUB_IMAGE" python /stub.py >/dev/null
dk run -d --name gatho-caddy-test --network "$NET" -p 127.0.0.1:18080:18080 \
	-e API_SITE=http://:18080 -e WEB_ORIGIN=https://gatho.shahinsha.xyz \
	-v "$(hostpath "$ROOT/engine/caddy/Caddyfile.prod"):/etc/caddy/Caddyfile:ro" \
	-v "$(hostpath "$WORK/basemap"):/srv/basemap:ro" \
	-v "$(hostpath "$WORK/logs"):/var/log/caddy" \
	"$IMAGE" >/dev/null
for _ in $(seq 1 30); do
	if curl -s -m 2 -o /dev/null http://127.0.0.1:18080/; then break; fi
	sleep 1
done

B=http://127.0.0.1:18080
O="Origin: https://gatho.shahinsha.xyz"
show() {
	echo
	echo "\$ $*"
	"$@" 2>&1 | tr -d '\r'
}
say "Headers"
show curl -sS -m 20 -o /dev/null -D - -H "$O" -H "Range: bytes=0-126" -H "Accept-Encoding: gzip, zstd" "$B/basemap/kerala.pmtiles"
show curl -sS -m 20 -o /dev/null -D - -X OPTIONS -H "$O" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: range" "$B/basemap/kerala.pmtiles"
show curl -sS -m 20 -o /dev/null -D - -H "$O" "$B/basemap/fonts/Noto%20Sans%20Regular/0-255.pbf"
show curl -sS -m 20 -o /dev/null -D - -H "$O" -H "Accept-Encoding: gzip" "$B/basemap/sprites/v4/light.json"
show curl -sS -m 20 -o /dev/null -D - -H "Range: bytes=999999-" "$B/basemap/kerala.pmtiles"
show curl -sS -m 20 -D - "$B/v1/health"
show curl -sS -m 20 -o /dev/null -D - "$B/something-else"
head -c 2000000 /dev/zero >"$WORK/big.json"
show curl -sS -m 20 -o /dev/null -w 'POST 2 MB to /v1/plans -> HTTP %{http_code}\n' -X POST -H 'Content-Type: application/json' --data-binary "@$WORK/big.json" "$B/v1/plans"
echo
echo "access log lines written: $(wc -l <"$WORK/logs/access.log" 2>/dev/null || echo 0)"

say "deploy/health.sh against it"
# SKIP_API: the stand-in is not FastAPI, so the API's own CORS cannot be checked here
PUBLIC_URL=$B WEB_URL=https://gatho.shahinsha.xyz SKIP_API=1 bash "$DEPLOY_DIR/health.sh"
