#!/usr/bin/env bash
set -euo pipefail

stamp="${1:?release stamp is required}"
case "$stamp" in (*[!a-zA-Z0-9_-]*|'') echo 'Invalid release stamp' >&2; exit 2;; esac
current="/var/www/runflow"
next="/var/www/runflow.new-${stamp}"
previous="/var/www/runflow.prev-${stamp}"
data_backup="/var/backups/runflow/data-${stamp}-cutover.json"
backup_timer_was_active=false
sport_timer_was_active=false
activated=false

test -d "$current"
test -d "$next"
test -s "$next/.next/BUILD_ID"
test -f "$next/.env.production"
test ! -e "$previous"
test ! -e "$data_backup"

if systemctl is-active --quiet runflow-backup.timer; then backup_timer_was_active=true; fi
if systemctl is-active --quiet runflow-sport-world.timer; then sport_timer_was_active=true; fi
resume_timers() {
  if [ "$backup_timer_was_active" = true ]; then systemctl start runflow-backup.timer; fi
  if [ "$sport_timer_was_active" = true ]; then systemctl start runflow-sport-world.timer; fi
}
rollback() {
  if [ "$activated" = true ] && [ -d "$previous" ]; then
    failed="/var/www/runflow.failed-${stamp}"
    if [ -e "$failed" ]; then failed="${failed}-$(date +%s)"; fi
    mv "$current" "$failed"
    mv "$previous" "$current"
    sudo -u runflow -H bash -lc "cd '$current' && pm2 restart runflow --update-env" || true
  fi
  resume_timers
}
trap rollback ERR

systemctl stop runflow-backup.timer 2>/dev/null || true
systemctl stop runflow-sport-world.timer 2>/dev/null || true
cd "$current"
node "$next/deploy/backup-production-data.mjs" "$data_backup"
cd "$next"
node deploy/preflight-user-isolation.mjs
cmp "$current/.env.production" "$next/.env.production"

mv "$current" "$previous"
mv "$next" "$current"
activated=true
sudo -u runflow -H bash -lc "cd '$current' && pm2 restart runflow --update-env"

healthy=false
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3000/login >/dev/null; then healthy=true; break; fi
  sleep 1
done
test "$healthy" = true
cd "$current"
node deploy/preflight-user-isolation.mjs
curl --fail --silent --head https://xuehuayd.top/login >/dev/null
resume_timers
trap - ERR
printf 'DEPLOYED=%s\nPREVIOUS=%s\nCUTOVER_DATA_BACKUP=%s\n' "$stamp" "$previous" "$data_backup"
