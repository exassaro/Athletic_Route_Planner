#!/usr/bin/env bash
# Restores a dump from deploy/backup.sh into the running Postgres, then loads the OSM tables again.
# Replaces every row users made since the dump. The API is stopped while it runs (a few minutes).
#   bash deploy/restore.sh /home/ubuntu/backups/athlete-2026-11-24.dump
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"
cd "$ROOT"
need_env
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

dump="${1:-}"
[ -f "$dump" ] || die "usage: deploy/restore.sh <file.dump>"
read -r -p "Replace the database with $dump? Type yes: " answer
[ "$answer" = yes ] || die "not restored"

say "Safety copy of the current database first"
safety="${BACKUP_DIR:-/home/ubuntu/backups}/before-restore-$(date -u +%Y%m%dT%H%M%S).dump"
mkdir -p "$(dirname "$safety")"
dc exec -T postgres pg_dump -U athlete -d athlete -Fc \
	--exclude-table-data=osm_ways --exclude-table-data=osm_boundaries --exclude-table-data=osm_features_meta \
	>"$safety"
chmod 600 "$safety"
echo "   $safety (not rotated by backup.sh: delete it by hand once the restore is checked)"

say "Stop the API"
dc stop api

say "Restore"
dc exec -T postgres pg_restore -U athlete -d athlete --clean --if-exists --no-owner <"$dump"

say "OSM ways and boundaries (left out of the dump)"
docker run --rm --network athlete-prod_default \
	-v "$ROOT/data/osm:/app/data/osm:ro" \
	-v "$ROOT/data/manifest.json:/app/data/manifest.json:ro" \
	-v "$ROOT/engine/osm_pin.json:/app/engine/osm_pin.json:ro" \
	athlete-api:prod python api/scripts/load_osm_features.py \
	--dsn "postgresql://athlete:${POSTGRES_PASSWORD}@postgres:5432/athlete"

say "Start the API (it runs any newer migrations on start)"
dc up -d --no-deps --no-build api
wait_healthy athlete-prod-api 180 || die "the API is not healthy: docker logs athlete-prod-api"
say "Restored $dump"
