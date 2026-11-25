#!/usr/bin/env bash
# shellcheck disable=SC2015 # `cond && ok || bad` is safe here: ok always succeeds
# Checks the public API and basemap the way the front end uses them, plus disk and memory when run on the VM.
#   bash deploy/health.sh                                   # production (from the VM or the laptop)
#   PUBLIC_URL=http://127.0.0.1:18080 SKIP_API=1 bash deploy/health.sh# the basemap rules only (test_caddy.sh)
# Exit 0 only if every check passes.
set -uo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"

PY="$(pick_python)"
CURL=(curl -sS --max-time 20)
[ "${INSECURE:-0}" = 1 ] && CURL+=(-k)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0
ok() { printf '  \033[32mok\033[0m    %s\n' "$*"; }
bad() {
	printf '  \033[31mFAIL\033[0m  %s\n' "$*"
	FAILED=1
}
# header <file> <name>: the value of a response header, trimmed (case-insensitive name)
header() { grep -i "^$2:" "$1" | tail -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//;s/ *$//'; }
status() { head -1 "$1" | awk '{print $2}'; }

echo "Checking $PUBLIC_URL (front end $WEB_URL)"

if [ "${SKIP_API:-0}" != 1 ]; then
	# The detail (services, builds) needs the key (Step 9): ATHLETE_HEALTH_KEY, or deploy/.env.prod when readable.
	KEY="$(health_key)"
	KEY_HEADER=()
	[ -n "$KEY" ] && KEY_HEADER=(-H "X-Health-Key: $KEY")
	code=$("${CURL[@]}" "${KEY_HEADER[@]}" -o "$TMP/health.json" -w '%{http_code}' "$PUBLIC_URL/v1/health" || echo 000)
	summary=$("$PY" -c '
import json, sys
d = json.load(open(sys.argv[1]))
if "services" in d:
    print("detail", d["status"], ", ".join(k + ("" if v["ok"] else " DOWN") for k, v in d["services"].items()))
else:
    print("public", d["status"], ", ".join(k + ("" if v else " DOWN") for k, v in d["features"].items()))
' "$TMP/health.json" 2>/dev/null || echo "unreadable")
	if [ "$code" = 200 ]; then
		ok "/v1/health 200: ${summary#* }"
	else
		bad "/v1/health answered $code: $(head -c 300 "$TMP/health.json" 2>/dev/null)"
	fi
	if [ -n "$KEY" ]; then
		[ "${summary%% *}" = detail ] && ok "the health key unlocks the detail" ||
			bad "the health key did not unlock the detail (ATHLETE_HEALTH_KEY differs from the API's?)"
	else
		warn "no ATHLETE_HEALTH_KEY here: only the public health body was checked"
	fi
	# without the key: the public body only, and no interactive docs
	"${CURL[@]}" -o "$TMP/public.json" "$PUBLIC_URL/v1/health" || true
	if grep -q '"services"' "$TMP/public.json" 2>/dev/null; then
		bad "/v1/health gives its detail without the key"
	else
		ok "/v1/health without the key: public body only"
	fi
	docs=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$PUBLIC_URL/docs" || echo 000)
	[ "$docs" = 404 ] && ok "/docs is off (404)" || bad "/docs answered $docs (want 404: ATHLETE_DOCS=false)"

	# the API's own CORS for the front end (ATHLETE_CORS_ORIGINS)
	"${CURL[@]}" -o /dev/null -D "$TMP/api_pre" -X OPTIONS "$PUBLIC_URL/v1/plans" \
		-H "Origin: $WEB_URL" -H "Access-Control-Request-Method: POST" \
		-H "Access-Control-Request-Headers: content-type,x-client-token" || true
	acao=$(header "$TMP/api_pre" Access-Control-Allow-Origin)
	if [ "$(status "$TMP/api_pre")" = 200 ] && [ "$acao" = "$WEB_URL" ]; then
		ok "API CORS preflight from $WEB_URL: 200, Allow-Origin $acao"
	else
		bad "API CORS preflight: status $(status "$TMP/api_pre"), Allow-Origin '${acao}' (ATHLETE_CORS_ORIGINS?)"
	fi
fi

# the archive, as pmtiles reads it: a cross-origin Range request
PM="$PUBLIC_URL/basemap/kerala.pmtiles"
"${CURL[@]}" -o "$TMP/head.bin" -D "$TMP/range" -H "Origin: $WEB_URL" -H "Range: bytes=0-126" \
	-H "Accept-Encoding: gzip, zstd" "$PM" || true
st=$(status "$TMP/range")
[ "$st" = 206 ] && ok "Range request on kerala.pmtiles: 206, $(header "$TMP/range" Content-Range)" ||
	bad "Range request on kerala.pmtiles answered '$st' (want 206)"
[ "$(head -c 7 "$TMP/head.bin" 2>/dev/null)" = PMTiles ] && ok "the body starts with the PMTiles magic" ||
	bad "the body does not start with PMTiles"
[ "$(header "$TMP/range" Access-Control-Allow-Origin)" = "$WEB_URL" ] && ok "Allow-Origin $WEB_URL" ||
	bad "Allow-Origin is '$(header "$TMP/range" Access-Control-Allow-Origin)'"
[ "$(header "$TMP/range" Cache-Control)" = no-store ] && ok "Cache-Control: no-store" ||
	bad "Cache-Control is '$(header "$TMP/range" Cache-Control)' (want no-store: Phase 5b amendment 12)"
expose=$(header "$TMP/range" Access-Control-Expose-Headers)
for h in ETag Content-Range Content-Length; do
	echo "$expose" | grep -qi "$h" && ok "exposes $h" || bad "does not expose $h ('$expose')"
done
[ -n "$(header "$TMP/range" ETag)" ] && ok "ETag present" || bad "no ETag"
[ -z "$(header "$TMP/range" Content-Encoding)" ] && ok "not compressed" ||
	bad "compressed ($(header "$TMP/range" Content-Encoding)): .pmtiles must never be"

"${CURL[@]}" -o /dev/null -D "$TMP/pre" -X OPTIONS "$PM" -H "Origin: $WEB_URL" \
	-H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: range" || true
if [ "$(status "$TMP/pre")" = 204 ] && header "$TMP/pre" Access-Control-Allow-Headers | grep -qi range &&
	[ "$(header "$TMP/pre" Access-Control-Allow-Origin)" = "$WEB_URL" ]; then
	ok "basemap preflight: 204, Allow-Headers $(header "$TMP/pre" Access-Control-Allow-Headers), Allow-Methods $(header "$TMP/pre" Access-Control-Allow-Methods)"
else
	bad "basemap preflight: status $(status "$TMP/pre"), Allow-Headers '$(header "$TMP/pre" Access-Control-Allow-Headers)'"
fi

FONT="$PUBLIC_URL/basemap/fonts/Noto%20Sans%20Regular/0-255.pbf"
"${CURL[@]}" -o /dev/null -D "$TMP/font" -H "Origin: $WEB_URL" "$FONT" || true
cc=$(header "$TMP/font" Cache-Control)
[ "$(status "$TMP/font")" = 200 ] && echo "$cc" | grep -q max-age && ok "font glyphs: 200, Cache-Control $cc" ||
	bad "font glyphs: status $(status "$TMP/font"), Cache-Control '$cc'"

# on the VM: disk, memory, containers
if command -v docker >/dev/null && docker ps >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q '^athlete-prod-'; then
	echo
	use=$(df --output=pcent / | tail -1 | tr -dc 0-9)
	[ "$use" -lt 85 ] && ok "disk / is ${use}% used" || bad "disk / is ${use}% used (RUNBOOK, \"Disk full\")"
	df -h / | sed 's/^/        /'
	free -m | sed 's/^/        /'
	docker ps --format '{{.Names}}\t{{.Status}}' | grep '^athlete-prod-' | sed 's/^/        /'
	docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' | grep '^athlete-prod-' | sed 's/^/        /'
	for c in $(docker ps -a --format '{{.Names}}' | grep '^athlete-prod-'); do
		h=$(health_of "$c")
		[ "$h" = unhealthy ] && bad "$c is unhealthy"
	done
fi

echo
[ "$FAILED" = 0 ] && echo "All checks passed." || echo "Some checks FAILED."
exit "$FAILED"
