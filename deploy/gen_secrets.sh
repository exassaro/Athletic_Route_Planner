#!/usr/bin/env bash
# Writes deploy/.env.prod from deploy/.env.prod.example with a random Postgres password and a random health key
# (chmod 600, gitignored). Refuses to overwrite an existing file: the Postgres data directory keeps the password it
# was created with.
#   deploy/gen_secrets.sh                   # once, on the VM
#   deploy/gen_secrets.sh --add-health-key  # an existing .env.prod without ATHLETE_HEALTH_KEY: adds one, nothing else
#   deploy/gen_secrets.sh --force           # only for a fresh data/postgres (see RUNBOOK, "Change the database password")
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"

umask 077
health_key=$(openssl rand -hex 32)

if [ "${1:-}" = "--add-health-key" ]; then
	need_env
	if grep -q '^ATHLETE_HEALTH_KEY=..*' "$ENV_FILE"; then
		say "$ENV_FILE already has an ATHLETE_HEALTH_KEY; left as it is."
		exit 0
	fi
	tmp="$ENV_FILE.tmp"
	grep -v '^ATHLETE_HEALTH_KEY=' "$ENV_FILE" >"$tmp" || true
	printf '
# /v1/health detail for health.sh and smoke.sh (Step 9)
ATHLETE_HEALTH_KEY=%s
' "$health_key" >>"$tmp"
	chmod 600 "$tmp"
	mv "$tmp" "$ENV_FILE"
	grep -q "^ATHLETE_HEALTH_KEY=$health_key\$" "$ENV_FILE" || die "the health key was not written"
	say "Added ATHLETE_HEALTH_KEY to $ENV_FILE. Restart the API to use it: source deploy/lib.sh; dc up -d --no-deps api"
	exit 0
fi

if [ -f "$ENV_FILE" ] && [ "${1:-}" != "--force" ]; then
	die "$ENV_FILE already exists; not overwriting it (pass --force only for a new, empty database)."
fi

password=$(openssl rand -hex 32)
sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$password/" -e "s/^ATHLETE_HEALTH_KEY=.*/ATHLETE_HEALTH_KEY=$health_key/" 	"$DEPLOY_DIR/.env.prod.example" >"$ENV_FILE"
chmod 600 "$ENV_FILE"
grep -q "^POSTGRES_PASSWORD=$password\$" "$ENV_FILE" || die "the password was not written"
grep -q "^ATHLETE_HEALTH_KEY=$health_key\$" "$ENV_FILE" || die "the health key was not written"
say "Wrote $ENV_FILE (mode 600). Keep a copy somewhere safe: the database cannot be opened without it."
