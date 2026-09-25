#!/usr/bin/env bash
set -euo pipefail

stamp="${1:?release stamp is required}"
archive="/tmp/runflow-${stamp}.tar.gz"
current="/var/www/runflow"
next="/var/www/runflow.new-${stamp}"
code_backup="/var/backups/runflow/runflow-${stamp}.tar.gz"
data_backup="/var/backups/runflow/data-${stamp}.json"

case "$stamp" in (*[!a-zA-Z0-9_-]*|'') echo 'Invalid release stamp' >&2; exit 2;; esac
test -f "$archive"
test -d "$current"
test -f "$current/.env.production"
test ! -e "$next"
test ! -e "$code_backup"
test ! -e "$data_backup"

mkdir -p /var/backups/runflow "$next"
tar --exclude='runflow/node_modules' --exclude='runflow/.next' --exclude='runflow/.env*' \
  -czf "$code_backup" -C /var/www runflow
tar -xzf "$archive" -C "$next"
cp -p "$current/.env.production" "$next/.env.production"
chmod 600 "$next/.env.production"
chown -R runflow:runflow "$next"

sudo -u runflow -H bash -lc "cd '$next' && npm ci && npm run build"
cmp "$current/.env.production" "$next/.env.production"
test -s "$next/.next/BUILD_ID"

cd "$current"
node "$next/deploy/backup-production-data.mjs" "$data_backup"
chmod 600 "$data_backup" "$code_backup"
printf 'BUILD_READY=%s\nCODE_BACKUP=%s\nDATA_BACKUP=%s\n' "$next" "$code_backup" "$data_backup"
