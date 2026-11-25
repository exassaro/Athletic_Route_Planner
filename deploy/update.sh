#!/usr/bin/env bash
# Deploys the latest main to the VM: git pull, rebuild the API image, migrate, restart the API only, health check.
# If the new API is not healthy within 3 minutes, the previous image is put back and started again.
#   bash deploy/update.sh
#
# Not rolled back: the code checkout (git) and database migrations. A migration that breaks the old code needs
# a manual step (RUNBOOK, "Update"). Caddy is recreated when Caddyfile.prod changed or it serves a stale basemap
# (Step 9). Changes to the compose file or the engines are not applied here (RUNBOOK).
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"
cd "$ROOT"
need_env

[ -z "$(git status --porcelain --untracked-files=no)" ] || die "the checkout has local changes; commit or stash them first"

prev_commit=$(git rev-parse --short HEAD)
have_old=0
if docker image inspect athlete-api:prod >/dev/null 2>&1; then
	docker tag athlete-api:prod athlete-api:rollback
	have_old=1
fi

say "git pull (was $prev_commit)"
git pull --ff-only
new_commit=$(git rev-parse --short HEAD)
git --no-pager log --oneline "$prev_commit..$new_commit" | sed 's/^/   /' || true
if ! git diff --quiet "$prev_commit" "$new_commit" -- deploy/docker-compose.prod.yml; then
	warn "the compose file changed: see RUNBOOK, \"Update\", for applying it."
fi
if ! git diff --quiet "$prev_commit" "$new_commit" -- engine/basemap_pin.json; then
	warn "engine/basemap_pin.json changed: run fetch_basemap.py (RUNBOOK, \"Update\"), then this script again."
fi

say "Build the API image"
dc build api

say "Migrations"
if ! dc run --rm --no-deps api alembic -c api/alembic.ini upgrade head; then
	[ "$have_old" = 1 ] && docker tag athlete-api:rollback athlete-api:prod
	die "migration failed; the running API was not touched (image restored). Code is at $new_commit, was $prev_commit."
fi

say "Restart the API"
dc up -d --no-deps --no-build api

if wait_healthy athlete-prod-api 180 && curl -fsS --max-time 10 -o /dev/null "$PUBLIC_URL/v1/health"; then
	say "Caddy (Caddyfile.prod and the basemap mount)"
	refresh_caddy
	say "Updated to $new_commit; $PUBLIC_URL/v1/health is ok"
	exit 0
fi

warn "the new API is not healthy. Last log lines:"
docker logs --tail 30 athlete-prod-api 2>&1 | sed 's/^/   /'
if [ "$have_old" = 1 ]; then
	say "Rolling back to the previous image"
	docker tag athlete-api:rollback athlete-api:prod
	dc up -d --no-deps --no-build --force-recreate api
	wait_healthy athlete-prod-api 180 || die "the previous image is not healthy either: docker logs athlete-prod-api"
	warn "Rolled back the API image. The code checkout is still at $new_commit: git checkout $prev_commit to match."
fi
exit 1
