#!/usr/bin/env bash
# First start of the whole stack on the VM, in the order that fits in memory. Resumable: every step checks what
# is already done, so after a failure fix the cause and run it again.
#   bash deploy/first_run.sh
#
# Order (deploy/docker-compose.prod.yml explains why): data (extract, basemap, Photon index) -> postgres, redis
# -> migrations -> OSM features -> Valhalla tile build -> our Valhalla overrides -> GraphHopper import -> Photon
# -> API -> Caddy -> health check. The Valhalla build never runs beside Photon or the GraphHopper import.
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"
cd "$ROOT"
need_env
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
[ -x "$UV" ] || die "uv not found. Run deploy/bootstrap_vm.sh."
docker ps >/dev/null 2>&1 || die "docker is not usable by $(id -un). Log out and in again after bootstrap_vm.sh."

T_ALL=$(date +%s)
STEP=0
step() {
	STEP=$((STEP + 1))
	local t0
	t0=$(date +%s)
	say "Step $STEP: $1"
	shift
	"$@"
	local s=$(($(date +%s) - t0))
	printf '   step %d done in %dm%02ds\n\n' "$STEP" $((s / 60)) $((s % 60))
}

preflight() {
	local free_gb ip dns
	free_gb=$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc 0-9)
	echo "   disk free: ${free_gb} GB (about 10 GB is needed)"
	[ "$free_gb" -ge 12 ] || die "less than 12 GB free on the disk"
	ip=$(curl -fsS --max-time 5 https://checkip.amazonaws.com || true)
	dns=$(getent ahostsv4 "${API_SITE}" | awk 'NR==1{print $1}' || true)
	echo "   this VM's public IP: ${ip:-unknown}; ${API_SITE} resolves to: ${dns:-nothing}"
	if [ -n "$ip" ] && [ "$ip" != "$dns" ]; then
		warn "DNS does not point at this VM yet: Caddy cannot get a certificate until it does."
	fi
}

python_deps() {
	"$UV" sync --frozen --no-dev
}

extract() {
	# The pinned file is already here (copied, or a re-run)? Otherwise the GitHub release backup. Never --latest:
	# upstream changes daily and would not match engine/osm_pin.json.
	if "$UV" run --no-dev python engine/scripts/fetch_extract.py; then
		return 0
	fi
	"$UV" run --no-dev python engine/scripts/fetch_extract.py --from-backup ||
		die "the pinned extract could not be fetched. Copy data/osm/kerala.osm.pbf from the laptop (RUNBOOK, step 6) and run this again."
}

basemap() {
	local pin_file
	pin_file=$(python3 -c 'import json;print(json.load(open("engine/basemap_pin.json"))["file"])')
	if [ ! -f "data/basemap/$pin_file" ]; then
		warn "data/basemap/$pin_file is missing. The Protomaps build it came from is deleted upstream, so copy it"
		warn "from the laptop (RUNBOOK, step 6):"
		warn "  scp -i <key>.pem data/basemap/$pin_file ubuntu@<ip>:~/athlete_router/data/basemap/"
		warn "Trying the extract anyway (works only while the build still exists)."
	fi
	"$UV" run --no-dev python engine/scripts/fetch_basemap.py ||
		die "basemap failed: copy data/basemap/$pin_file from the laptop and run this again."
	[ -f web/public/basemap/kerala.pmtiles ] || die "web/public/basemap/kerala.pmtiles was not written"
}

photon_data() {
	if [ -d data/photon/photon_data ] && [ -f data/photon/photon-db-india.tar.bz2 ]; then
		echo "   data/photon/photon_data exists; checking the archive against the published md5"
	fi
	"$UV" run --no-dev python engine/scripts/fetch_photon.py
}

images() {
	dc build api graphhopper photon
	dc pull postgres redis valhalla caddy
}

database() {
	mkdir -p data/postgres
	dc up -d postgres redis
	wait_healthy athlete-prod-postgres 180
	wait_healthy athlete-prod-redis 60
}

migrations() {
	dc run --rm --no-deps api alembic -c api/alembic.ini upgrade head
}

osm_features() {
	local n
	n=$(dc exec -T postgres psql -U athlete -d athlete -tAc "SELECT count(*) FROM osm_features_meta" 2>/dev/null || echo 0)
	if [ "${n:-0}" -gt 0 ]; then
		echo "   osm_ways and osm_boundaries are loaded already"
		return 0
	fi
	# A one-off container on the project network, without the api service's 1 GiB limit.
	docker run --rm --network athlete-prod_default \
		-v "$ROOT/data/osm:/app/data/osm:ro" \
		-v "$ROOT/data/manifest.json:/app/data/manifest.json:ro" \
		-v "$ROOT/engine/osm_pin.json:/app/engine/osm_pin.json:ro" \
		athlete-api:prod python api/scripts/load_osm_features.py \
		--dsn "postgresql://athlete:${POSTGRES_PASSWORD}@postgres:5432/athlete"
}

valhalla() {
	dc stop photon graphhopper 2>/dev/null || true # nothing big beside the tile build
	mkdir -p data/valhalla
	local user image
	image=$(grep -m1 -o 'ghcr.io/valhalla/valhalla-scripted@sha256:[0-9a-f]*' "$COMPOSE_FILE")
	user=$(docker run --rm --entrypoint id "$image" -u 2>/dev/null || echo 0)
	if [ "$user" != 0 ]; then
		sudo chown -R "$user:$user" data/valhalla # the image does not run as root: it must write its tiles
	fi
	if [ -f data/valhalla/valhalla_tiles.tar ]; then
		echo "   tiles are built already; starting Valhalla"
	else
		echo "   building tiles and downloading elevation (tens of minutes on 2 vCPU); log: docker logs -f athlete-prod-valhalla"
	fi
	dc up -d --no-deps valhalla
	wait_healthy athlete-prod-valhalla 7200 || die "Valhalla did not become healthy: docker logs athlete-prod-valhalla"
	# engine/valhalla/overrides.json (hard exclusions for ferries, exclusion limits), then a restart
	local out
	out=$(docker run --rm \
		-v "$ROOT/data/valhalla:/app/data/valhalla" \
		-v "$ROOT/engine/valhalla:/app/engine/valhalla:ro" \
		-v "$ROOT/engine/scripts:/app/engine/scripts:ro" \
		athlete-api:prod python engine/scripts/configure_valhalla.py)
	while IFS= read -r line; do echo "   $line"; done <<<"$out"
	if echo "$out" | grep -q "Config updated"; then
		dc restart valhalla
		sleep 5
		wait_healthy athlete-prod-valhalla 600 || die "Valhalla did not come back after the configuration"
	fi
}

graphhopper() {
	[ -d data/graphhopper/graph-cache ] && echo "   graph-cache exists; starting" || echo "   importing Kerala (several minutes)"
	dc up -d --no-deps graphhopper
	wait_healthy athlete-prod-graphhopper 3600 || die "GraphHopper did not become healthy: docker logs athlete-prod-graphhopper"
}

photon() {
	dc up -d photon
	wait_healthy athlete-prod-photon 900 || die "Photon did not become healthy: docker logs athlete-prod-photon"
}

api() {
	dc up -d api
	wait_healthy athlete-prod-api 300 || die "the API did not become healthy: docker logs athlete-prod-api"
}

caddy() {
	mkdir -p data/caddy-prod/data data/caddy-prod/config data/logs/caddy
	dc up -d caddy
	echo "   waiting for the certificate (up to 2 minutes)"
	local _
	for _ in $(seq 1 24); do
		if curl -fsS --max-time 5 -o /dev/null "$PUBLIC_URL/v1/health"; then
			echo "   $PUBLIC_URL answers over HTTPS"
			return 0
		fi
		sleep 5
	done
	warn "$PUBLIC_URL does not answer yet: docker logs athlete-prod-caddy (DNS, ports 80/443 in the security group)"
}

step "Preflight (disk, DNS)" preflight
step "Python dependencies for the data scripts (uv)" python_deps
step "Pinned OSM extract (engine/osm_pin.json)" extract
step "Basemap (engine/basemap_pin.json) -> web/public/basemap" basemap
step "Photon index for India (download and unpack)" photon_data
step "Build and pull images" images
step "Postgres and Redis" database
step "Database migrations" migrations
step "OSM ways and boundaries (Phase 5 A6)" osm_features
step "Valhalla tiles, elevation and overrides" valhalla
step "GraphHopper import" graphhopper
step "Photon" photon
step "API" api
step "Caddy (HTTPS)" caddy
step "Health check" bash "$DEPLOY_DIR/health.sh"

T=$(($(date +%s) - T_ALL))
say "First run finished in $((T / 60))m$((T % 60))s. Next: bash deploy/smoke.sh"
