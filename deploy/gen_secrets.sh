#!/usr/bin/env bash
# Writes deploy/.env.prod from deploy/.env.prod.example with a random Postgres password (chmod 600, gitignored).
# Refuses to overwrite an existing file: the Postgres data directory keeps the password it was created with.
#   deploy/gen_secrets.sh            # once, on the VM
#   deploy/gen_secrets.sh --force    # only for a fresh data/postgres (see RUNBOOK, "Change the database password")
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"

if [ -f "$ENV_FILE" ] && [ "${1:-}" != "--force" ]; then
	die "$ENV_FILE already exists; not overwriting it (pass --force only for a new, empty database)."
fi

umask 077
password=$(openssl rand -hex 32)
sed "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$password/" "$DEPLOY_DIR/.env.prod.example" >"$ENV_FILE"
chmod 600 "$ENV_FILE"
grep -q "^POSTGRES_PASSWORD=$password\$" "$ENV_FILE" || die "the password was not written"
say "Wrote $ENV_FILE (mode 600). Keep a copy somewhere safe: the database cannot be opened without it."
