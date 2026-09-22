#!/usr/bin/env bash
set -euo pipefail

stamp="${1:?release timestamp is required}"
archive="/tmp/runflow-release-${stamp}.tar.gz"
current="/var/www/runflow"
next="/var/www/runflow.new-${stamp}"
previous="/var/www/runflow.prev-${stamp}"
backup_dir="/var/backups/runflow"

test -f "$archive"
test -f "$current/.env.production"
test ! -e "$next"
test ! -e "$previous"

mkdir -p "$backup_dir" "$next"
tar \
  --exclude='runflow/node_modules' \
  --exclude='runflow/.next' \
  --exclude='runflow/.env.production' \
  -czf "$backup_dir/runflow-${stamp}.tar.gz" \
  -C /var/www runflow

tar -xzf "$archive" -C "$next"
cp "$current/.env.production" "$next/.env.production"
chmod 600 "$next/.env.production"
chown -R runflow:runflow "$next"

sudo -u runflow -H bash -lc "cd '$next' && npm ci && npm run build"

mv "$current" "$previous"
mv "$next" "$current"

if ! sudo -u runflow -H bash -lc "cd '$current' && pm2 restart runflow --update-env"; then
  mv "$current" "/var/www/runflow.failed-${stamp}"
  mv "$previous" "$current"
  sudo -u runflow -H bash -lc "cd '$current' && pm2 restart runflow --update-env"
  exit 1
fi

echo "DEPLOYED=$stamp"
echo "PREVIOUS=$previous"
echo "BACKUP=$backup_dir/runflow-${stamp}.tar.gz"
