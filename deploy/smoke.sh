#!/usr/bin/env bash
# One real journey through the public URLs: a session, the A01 plan (Athanikkal towards Kozhikode, 25 km, six
# checkpoints; coordinates from OSM, api/athlete_api/examples/request_A01.json), save, GPX, the share API and
# the share page on the front end. The saved route is deleted at the end (soft delete), so no public link is
# left behind; KEEP=1 keeps it.
#   bash deploy/smoke.sh          # from the VM or the laptop (needs curl and python)
# Uses one of the 60 new sessions an IP may open per hour. Sends the health key when it has one (health.sh).
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"

PY="$(pick_python)"
CURL=(curl -sS --max-time 60 -H "Origin: $WEB_URL")
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# get <json file> <key> [<key>...]: a value from a JSON file (integers index lists)
get() {
	"$PY" -c '
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
for k in sys.argv[2:]:
    d = d[int(k)] if isinstance(d, list) else d[k]
print(d)' "$@"
}
expect() { # expect <step> <want> <got> <body file>
	if [ "$2" != "$3" ]; then
		echo "FAIL  $1: HTTP $3 (want $2)"
		head -c 600 "$4" 2>/dev/null
		echo
		exit 1
	fi
}

echo "Smoke test against $PUBLIC_URL and $WEB_URL"

KEY="$(health_key)"
if [ -n "$KEY" ]; then
	code=$("${CURL[@]}" -H "X-Health-Key: $KEY" -o "$TMP/health.json" -w '%{http_code}' "$PUBLIC_URL/v1/health")
	expect "health (with the key)" 200 "$code" "$TMP/health.json"
	grep -q '"services"' "$TMP/health.json" || {
		echo "FAIL  the health key did not unlock the detail"
		exit 1
	}
	echo "ok    health, detail with the key"
else
	code=$("${CURL[@]}" -o "$TMP/health.json" -w '%{http_code}' "$PUBLIC_URL/v1/health")
	expect "health" 200 "$code" "$TMP/health.json"
	echo "ok    health (public body; no ATHLETE_HEALTH_KEY here)"
fi

code=$("${CURL[@]}" -o "$TMP/session.json" -D "$TMP/session.h" -w '%{http_code}' -X POST "$PUBLIC_URL/v1/session")
expect "session" 201 "$code" "$TMP/session.json"
grep -qi "^access-control-allow-origin: $WEB_URL" "$TMP/session.h" || {
	echo "FAIL  the API does not allow $WEB_URL (ATHLETE_CORS_ORIGINS)"
	exit 1
}
TOKEN=$(get "$TMP/session.json" token)
echo "ok    session (CORS allows $WEB_URL)"
AUTH=(-H "X-Client-Token: $TOKEN")

"$PY" -c '
import json, sys
v = json.load(open(sys.argv[1], encoding="utf-8"))["value"]
json.dump(v, open(sys.argv[2], "w", encoding="utf-8"))' "$ROOT/api/athlete_api/examples/request_A01.json" "$TMP/request.json"
t0=$(date +%s)
code=$("${CURL[@]}" "${AUTH[@]}" -o "$TMP/plan.json" -w '%{http_code}' -X POST "$PUBLIC_URL/v1/plans" \
	-H "Content-Type: application/json" --data-binary "@$TMP/request.json")
expect "plan A01" 201 "$code" "$TMP/plan.json"
ROUTE=$(get "$TMP/plan.json" candidates 0 route_id)
echo "ok    plan A01 in $(($(date +%s) - t0)) s: outcome $(get "$TMP/plan.json" outcome)," \
	"$(get "$TMP/plan.json" candidates 0 label) $(get "$TMP/plan.json" candidates 0 length_m) m, cached $(get "$TMP/plan.json" cached)"

code=$("${CURL[@]}" "${AUTH[@]}" -o "$TMP/saved.json" -w '%{http_code}' -X POST "$PUBLIC_URL/v1/routes/$ROUTE/save" \
	-H "Content-Type: application/json" --data '{"name": "Smoke test", "as_new": true}')
expect "save" 201 "$code" "$TMP/saved.json"
SLUG=$(get "$TMP/saved.json" share_slug)
SAVED=$(get "$TMP/saved.json" saved_id)
echo "ok    saved, share slug $SLUG, share_url $(get "$TMP/saved.json" share_url)"

code=$("${CURL[@]}" "${AUTH[@]}" -o "$TMP/route.gpx" -w '%{http_code}' "$PUBLIC_URL/v1/routes/$ROUTE/gpx")
expect "GPX" 200 "$code" "$TMP/route.gpx"
if ! grep -q '<gpx' "$TMP/route.gpx" || ! grep -q 'creator="GATHO"' "$TMP/route.gpx"; then
	echo "FAIL  the GPX is not a GATHO GPX"
	exit 1
fi
echo "ok    GPX, $(grep -c '<trkpt' "$TMP/route.gpx") track points"

code=$("${CURL[@]}" -o "$TMP/share.json" -w '%{http_code}' "$PUBLIC_URL/v1/share/$SLUG")
expect "share API" 200 "$code" "$TMP/share.json"
echo "ok    share API (no token)"

code=$(curl -sS --max-time 60 -o "$TMP/share.html" -w '%{http_code}' "$WEB_URL/s/$SLUG")
expect "share page" 200 "$code" "$TMP/share.html"
grep -q 'GATHO' "$TMP/share.html" || {
	echo "FAIL  the share page does not mention GATHO"
	exit 1
}
echo "ok    share page $WEB_URL/s/$SLUG (rendered by the front end through the API)"

if [ "${KEEP:-0}" != 1 ]; then
	code=$("${CURL[@]}" "${AUTH[@]}" -o /dev/null -w '%{http_code}' -X DELETE "$PUBLIC_URL/v1/me/routes/$SAVED")
	expect "delete" 204 "$code" /dev/null
	code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$PUBLIC_URL/v1/share/$SLUG")
	expect "share after delete" 404 "$code" /dev/null
	echo "ok    deleted again; the link answers 404"
fi
echo "Smoke test passed."
