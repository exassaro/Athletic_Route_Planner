#!/usr/bin/env bash
# Dumps the database to /home/ubuntu/backups/athlete-YYYY-MM-DD.dump (pg_dump custom format) and keeps the 7
# newest. Run it daily from cron (RUNBOOK, "Backup"); a second run on one day replaces that day's file.
#   bash deploy/backup.sh
#
# The rows of osm_ways, osm_boundaries and osm_features_meta are left out: they come from the pinned extract and
# deploy/restore.sh loads them again. Everything users made (clients, plans, versions, routes, saved routes) is in.
#
# Copy the newest dump to the laptop (run this on the laptop, in PowerShell or Git Bash):
#   scp -i <path-to-key>.pem ubuntu@54.252.91.95:/home/ubuntu/backups/athlete-<date>.dump .
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"
need_env

BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups}"
KEEP="${KEEP:-7}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
out="$BACKUP_DIR/athlete-$(date -u +%F).dump"

dc exec -T postgres pg_dump -U athlete -d athlete -Fc \
	--exclude-table-data=osm_ways --exclude-table-data=osm_boundaries --exclude-table-data=osm_features_meta \
	>"$out.part"
[ -s "$out.part" ] || die "the dump is empty"
mv "$out.part" "$out"
chmod 600 "$out"
echo "$(date -u +%FT%TZ) wrote $out ($(du -h "$out" | cut -f1))"

# keep the newest $KEEP
find "$BACKUP_DIR" -maxdepth 1 -name 'athlete-*.dump' -printf '%f\n' | sort -r | tail -n +"$((KEEP + 1))" |
	while read -r old; do
		rm -f "$BACKUP_DIR/$old"
		echo "removed $old"
	done
