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
		sed -n 's/^ATHLETE_HEALTH_KEY=//p' "$ENV_FILE" | tail -1 | tr -d ''
	fi
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
