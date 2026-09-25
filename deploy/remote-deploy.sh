#!/usr/bin/env bash
# Runs on Linux via SSH stdin. No database commands or environment updates.
set -Eeuo pipefail
umask 077
mode="${1:?}"; current="${2:?}"; app="${3:?}"; archive="${4:-}"; extra="${5:-}"
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$mode" == deploy || "$mode" == rollback ]] || fail 'Invalid action.'
[[ "$current" =~ ^/[a-zA-Z0-9_/-]+$ && "$current" != */ && "$current" != *//* ]] || fail 'Invalid server path.'
[[ "$app" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || fail 'Invalid PM2 name.'
[[ -d "$current" && ! -L "$current" && -f "$current/package.json" ]] || fail 'SERVER_PATH must be an existing application directory, not a symlink.'
parent="$(dirname -- "$current")"
[[ "$parent" != / && "$parent" != /var && "$parent" != /usr && "$parent" != /etc ]] || fail 'Unsafe server directory.'
backup_root="$parent/backup"
[[ "$current" != "$backup_root" && "$current" != "$backup_root/"* ]] || fail 'Application cannot be inside backup directory.'
for tool in tar cp mv stat flock curl node npm pm2 awk cmp readlink; do command -v "$tool" >/dev/null || fail "Missing server tool: $tool"; done
[[ ! -L "$backup_root" ]] || fail 'Backup directory must not be a symlink.'
if [[ ! -d "$backup_root" ]]; then mkdir -m 711 -- "$backup_root"; fi
exec 9>"$parent/.${app}-deploy.lock"
flock -n 9 || fail 'A deployment/rollback is already running.'
owner="$(stat -c %U "$current")"
as_app() {
  if [[ "$(id -un)" == "$owner" ]]; then "$@"; else sudo -n -u "$owner" -H -- "$@"; fi
}
[[ "$(id -un)" == "$owner" || "$(id -u)" == 0 ]] || fail 'Use the app owner or root as SERVER_USER.'
as_app node -e 'const v=+process.versions.node.split(".")[0]; if(v<20||v>=23) process.exit(1)' || fail 'Server requires Node.js 20-22 (recommended: 22).'
as_app test -x "$backup_root" || fail 'App owner needs traverse permission on backup directory.'
stage='' backup='' committed=0
show_logs() { as_app pm2 status || true; as_app pm2 logs "$app" --lines 100 --nostream || true; }
healthy() {
  as_app pm2 jlist | as_app node -e '
    let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{
      try {const a=JSON.parse(s).filter(p=>p.name===process.argv[1]);
        process.exit(a.length===1 && a[0].pm2_env.status==="online" && a[0].pid>0 && a[0].pm2_env.pm_cwd===process.argv[2]?0:1);
      } catch {process.exit(1)}
    });' "$app" "$current" || return 1
  curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3000/login >/dev/null
}
wait_healthy() {
  local attempt consecutive=0
  for ((attempt=0; attempt<30; attempt++)); do
    if healthy; then consecutive=$((consecutive+1)); else consecutive=0; fi
    ((consecutive >= 3)) && return 0
    sleep 2
  done
  return 1
}
finish() {
  local code=$?
  trap - EXIT HUP INT TERM
  if ((code != 0)); then
    printf 'Deployment/rollback failed. Showing PM2 diagnostics...\n' >&2
    show_logs
    # Filesystem evidence handles failure between either of the two renames.
    if [[ -n "$backup" && -d "$backup/live" && "$committed" == 0 ]]; then
      printf 'Restoring the previous running version...\n' >&2
      if [[ -e "$current" ]]; then
        mv -- "$current" "$backup/failed" || { printf 'RESTORE FAILED: cannot move new version; old version is at %s/live\n' "$backup" >&2; exit 1; }
      fi
      if mv -- "$backup/live" "$current" && as_app pm2 restart "$app" && wait_healthy && as_app pm2 save; then
        printf 'Previous version restored and healthy.\n' >&2
      else
        printf 'RESTORE NEEDS ATTENTION: inspect %s and %s\n' "$current" "$backup" >&2
        show_logs
      fi
    else
      printf 'The running application directory was not replaced.\n' >&2
    fi
  fi
  # Failed builds/backups stay available for diagnosis; no broad rm -rf.
  exit "$code"
}
trap finish EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

cd -- "$current"
if [[ "$mode" == deploy ]]; then
  healthy || fail 'Existing PM2 app must be online at SERVER_PATH and /login must return HTTP 2xx before deployment.'
else
  as_app pm2 describe "$app" >/dev/null || fail 'Existing PM2 app is missing.'
fi
source_release=''
if [[ "$mode" == rollback ]]; then
  # Only complete, successfully activated transactions are rollback candidates.
  shopt -s nullglob
  candidates=("$backup_root/${app}_"*)
  for ((i=${#candidates[@]}-1; i>=0; i--)); do
    candidate="${candidates[i]}"
    if [[ -f "$candidate/.ready" && -d "$candidate/live" && ! -L "$candidate/live" ]]; then
      source_release="$candidate/live"; break
    fi
  done
  [[ -n "$source_release" ]] || fail 'No completed backup is available.'
  [[ -s "$source_release/.next/BUILD_ID" && -d "$source_release/node_modules" ]] || fail 'Latest backup is incomplete; refusing to guess an older version.'
  printf 'Rollback source: %s\n' "$source_release"
else
  [[ "$archive" =~ ^/tmp/runflow-deploy-[a-zA-Z0-9_-]+\.tar\.gz$ && -f "$archive" && ! -L "$archive" ]] || fail 'Invalid deployment archive.'
fi

stamp="$(date +%Y%m%d_%H%M%S)_$(date +%N)_$$"
backup="$backup_root/${app}_$stamp"
stage="$parent/.${app}-stage-$stamp"
mkdir -- "$backup" "$stage"
if [[ "$(id -u)" == 0 ]]; then chown "$owner:$(stat -c %G "$current")" "$backup"; fi
printf 'Backing up current version to %s/snapshot...\n' "$backup"
cp -a -- "$current" "$backup/snapshot"
if [[ "$mode" == deploy ]]; then
  # Local tar excludes secrets. Reject unexpected paths and all symlinks before extraction.
  tar -tzf "$archive" | node -e '
    let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{
      for(const raw of s.trim().split("\n")){const p=raw.replace(/^\.\//,"");
        if(p.startsWith("/")||p.split("/").includes("..")||p.split("/").some(x=>/^\.env/.test(x)||[".ssh",".npmrc",".deploy.config"].includes(x)))process.exit(1);
      }
    });' || fail 'Unsafe archive entry.'
  if tar -tvzf "$archive" | awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {bad=1} END {exit !bad}'; then fail 'Archive must contain only regular files and directories.'; fi
  tar --no-same-owner -xzf "$archive" -C "$stage"
else
  cp -a -- "$source_release/." "$stage/"
fi
[[ -f "$stage/package.json" ]] || fail 'Release has no package.json.'

# Preserve server-owned config contents and modes; resolve links when copying.
# Runtime data stays in the old live directory; links retain ongoing writes.
configs=(.env .env.local .env.production .env.production.local .npmrc ecosystem.config.cjs ecosystem.config.js)
shopt -s nullglob
for env_file in "$current"/.env* "$stage"/.env*; do configs+=("${env_file##*/}"); done
data_paths=(data uploads storage logs public/uploads)
IFS=',' read -r -a extra_paths <<< "$extra"
for p in "${extra_paths[@]}"; do
  [[ -n "$p" ]] || continue
  [[ "$p" =~ ^[a-zA-Z0-9_.-]+(/[a-zA-Z0-9_.-]+)*$ && "$p" != *..* && "$p" != .* && "$p" != node_modules && "$p" != .next ]] || fail "Unsafe preserved path: $p"
  data_paths+=("$p")
done
copy_configs() {
  local p
  for p in "${configs[@]}"; do
    # Never let a rollback bring back old values when the current file is absent.
    [[ ! -d "$stage/$p" ]] || fail "Config must be a file: $p"
    rm -f -- "$stage/$p"
    if [[ -e "$current/$p" || -L "$current/$p" ]]; then
      # Dereference config links so relative links do not break after switching.
      cp -pL -- "$current/$p" "$stage/$p"
    fi
  done
}
copy_configs
if [[ "$(id -u)" == 0 ]]; then chown -R "$owner:$(stat -c %G "$current")" "$stage"; fi
if [[ "$mode" == deploy ]]; then
  printf 'Installing and building in %s (live version stays in place)...\n' "$stage"
  # The existing project has no lifecycle/database migration hooks.
  (cd -- "$stage"; as_app npm install --include=dev --no-audit --no-fund; as_app npm run build)
else
  # Rebuild against current server env so NEXT_PUBLIC_* never rolls back silently.
  (cd -- "$stage"; as_app npm run build)
fi
[[ -s "$stage/.next/BUILD_ID" ]] || fail 'Next.js build output is missing.'
# Do not publish a build with env different from the currently configured server.
for p in "${configs[@]}"; do
  if [[ -e "$current/$p" ]]; then cmp -s "$current/$p" "$stage/$p" || fail "Server config changed during build: $p; retry deployment.";
  else [[ ! -e "$stage/$p" ]] || fail "Server config removed during build: $p"; fi
done
for p in "${data_paths[@]}"; do
  if [[ -e "$current/$p" || -L "$current/$p" ]]; then
    # Refuse packaged files at reserved data locations, rather than deleting data.
    if [[ -e "$stage/$p" && ! -L "$stage/$p" ]]; then
      [[ "$mode" == rollback ]] || fail "Package includes reserved server data: $p"
      mkdir -p -- "$backup/staged-data/$(dirname -- "$p")"
      mv -- "$stage/$p" "$backup/staged-data/$p"
    else rm -f -- "$stage/$p"; fi
    mkdir -p -- "$(dirname -- "$stage/$p")"
    data_target="$(readlink -f -- "$current/$p")"
    [[ -n "$data_target" && -e "$data_target" ]] || fail "Broken server data link: $p"
    if [[ "$data_target" == "$current/"* ]]; then data_target="$backup/live/${data_target#"$current/"}"; fi
    ln -s -- "$data_target" "$stage/$p"
  elif [[ -e "$stage/$p" || -L "$stage/$p" ]]; then
    # A rollback must not resurrect user data that was intentionally removed.
    mkdir -p -- "$backup/staged-data/$(dirname -- "$p")"
    mv -- "$stage/$p" "$backup/staged-data/$p"
  fi
done
if [[ "$(id -u)" == 0 ]]; then chown -hR "$owner:$(stat -c %G "$current")" "$stage"; fi
cd -- "$parent"
printf 'Activating release...\n'
mv -- "$current" "$backup/live"
mv -- "$stage" "$current"
as_app pm2 restart "$app"
wait_healthy || fail 'New process or HTTP health check failed.'
as_app pm2 status
as_app pm2 save
touch "$backup/.ready"
committed=1
printf '%s succeeded. Backup: %s\n' "$mode" "$backup"
