#!/bin/sh
# Nightly backup on the droplet (cron, see deploy/DEPLOY.md): the dfresh database, /media originals and sizes,
# and private/brochures, into $BACKUP_DIR/<date>/. Keeps 14 days. Copy the folder off the droplet as well
# (DigitalOcean backups / Spaces / a dev machine): a backup on the same disk does not survive the disk.
# Needs ~/.my.cnf (chmod 600) with a user that can read dfresh, so no password is on the command line.
set -eu
APP_DIR=${APP_DIR:-/var/www/dfresh}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/dfresh}
KEEP_DAYS=${KEEP_DAYS:-14}
DAY=$(date +%Y-%m-%d)
OUT="$BACKUP_DIR/$DAY"

mkdir -p "$OUT"
mysqldump --single-transaction --routines --default-character-set=utf8mb4 dfresh | gzip > "$OUT/dfresh.sql.gz"
tar -czf "$OUT/media.tar.gz" -C "$APP_DIR" media
tar -czf "$OUT/brochures.tar.gz" -C "$APP_DIR" private/brochures
chmod -R go-rwx "$OUT"

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "dfresh backup $DAY: $(du -sh "$OUT" | cut -f1)"
