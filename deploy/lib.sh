# Shared helpers for the deploy scripts. Sourced, not run.
# shellcheck shell=bash

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.prod.yml"
ENV_FILE="$DEPLOY_DIR/.env.prod"
PUBLIC_URL="${PUBLIC_URL:-https://api.gatho.shahinsha.xyz}"
WEB_URL="${WEB_URL:-https://gatho.shahinsha.xyz}"
export DEPLOY_DIR ROOT COMPOSE_FILE ENV_FILE PUBLIC_URL WEB_URL

# docker compose on the production file with the production settings
dc() {
	docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# a Python that runs (on Windows, `python3` can be the Microsoft Store stub)
pick_python() {
	local p
	for p in python3 python; do
		if command -v "$p" >/dev/null && "$p" -c '' 2>/dev/null; then
			echo "$p"
			return 0
		fi
	done
	die "no python found"
}

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33mWARNING: %s\033[0m\n' "$*" >&2; }
die() {
	printf '\033[31mERROR: %s\033[0m\n' "$*" >&2
	exit 1
}

# The key that unlocks /v1/health's detail (ATHLETE_HEALTH_KEY): from the environment, else from .env.prod when
# this user can read it. Empty when neither: the public body only.
health_key() {
	if [ -n "${ATHLETE_HEALTH_KEY:-}" ]; then
		printf '%s' "$ATHLETE_HEALTH_KEY"
	elif [ -r "$ENV_FILE" ]; then
		sed -n 's/^ATHLETE_HEALTH_KEY=//p' "$ENV_FILE" | tail -1 | tr -d '
'
	fi
}

# --- Caddy's bind mounts (Step 9) -------------------------------------------------------------------------------
# A running container keeps the files it was started with: replacing web/public/basemap (fetch_basemap.py) or
# Caddyfile.prod (git pull) on the host leaves Caddy on the old ones, which gave a 404 map after first_run.
CADDY=athlete-prod-caddy
PMTILES_HOST="$ROOT/web/public/basemap/kerala.pmtiles"

# What differs between the host and the running Caddy, one reason a line; empty when Caddy is current.
caddy_stale() {
	local host_cf box_cf host_pm box_pm
	host_cf=$(sha256sum "$ROOT/engine/caddy/Caddyfile.prod" | cut -d' ' -f1)
	box_cf=$(docker exec "$CADDY" sha256sum /etc/caddy/Caddyfile 2>/dev/null | cut -d' ' -f1)
	[ "$host_cf" = "$box_cf" ] || echo "Caddyfile.prod differs from the one Caddy runs"
	host_pm=$(stat -c '%s %Y' "$PMTILES_HOST" 2>/dev/null || echo missing)
	box_pm=$(docker exec "$CADDY" stat -c '%s %Y' /srv/basemap/kerala.pmtiles 2>/dev/null || echo missing)
	[ "$host_pm" = "$box_pm" ] || echo "kerala.pmtiles: host '$host_pm', Caddy sees '$box_pm'"
}

# Fails loudly unless Caddy serves the same basemap and Caddyfile as the host.
check_caddy_mounts() {
	local stale
	docker exec "$CADDY" ls /srv/basemap/kerala.pmtiles >/dev/null 2>&1 ||
		die "Caddy does not see /srv/basemap/kerala.pmtiles (docker exec $CADDY ls /srv/basemap): the map would be a 404"
	stale=$(caddy_stale)
	[ -z "$stale" ] || die "Caddy is not serving the current files: $stale"
	echo "   Caddy sees /srv/basemap/kerala.pmtiles ($(docker exec "$CADDY" stat -c '%s' /srv/basemap/kerala.pmtiles) bytes) and the current Caddyfile"
}

# Recreates Caddy when it is stale (or always, with "force"), then checks. Only Caddy: --no-deps.
refresh_caddy() {
	local why
	why=$(caddy_stale)
	if [ "${1:-}" = force ] || [ -n "$why" ]; then
		[ -n "$why" ] && echo "   recreating Caddy: $why"
		dc up -d --no-deps --force-recreate caddy
		local _
		for _ in $(seq 1 15); do
			docker exec "$CADDY" ls /srv/basemap >/dev/null 2>&1 && break
			sleep 2
		done
	fi
	check_caddy_mounts
}

need_env() {
	[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing. Run deploy/gen_secrets.sh first."
}

# Health as Docker sees it: healthy, unhealthy, starting, or none (no healthcheck / not running).
health_of() {
	docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo none
}

# wait_healthy <container> <timeout seconds>
wait_healthy() {
	local name="$1" limit="$2" start now status
	start=$(date +%s)
	while true; do
		status=$(health_of "$name")
		[ "$status" = healthy ] && return 0
		now=$(date +%s)
		if [ $((now - start)) -ge "$limit" ]; then
			warn "$name is still '$status' after ${limit}s"
			return 1
		fi
		if [ $(((now - start) % 60)) -lt 10 ]; then
			printf '   ... %s: %s (%dm%02ds)\n' "$name" "$status" $(((now - start) / 60)) $(((now - start) % 60))
		fi
		sleep 10
	done
}
