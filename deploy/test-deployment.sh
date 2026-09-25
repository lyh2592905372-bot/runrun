#!/usr/bin/env bash
# Isolated filesystem tests. SSH, PM2, npm, curl and flock are simulated.
# No production network connection, database, package install or real PM2 process.
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/runflow-deployment-test-XXXXXX)"
REAL_NODE="$(command -v node)"
export TEST_ROOT REAL_NODE
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/www/runflow" "$TEST_ROOT/source" "$TEST_ROOT/local/deploy"
export PATH="$TEST_ROOT/bin:$PATH"
export MSYS2_ARG_CONV_EXCL='*'
export MSYS='winsymlinks'
export TEST_CURRENT="$TEST_ROOT/www/runflow"
trap 'printf "Test artifacts: %s\n" "$TEST_ROOT"' EXIT

cat > "$TEST_ROOT/bin/node" <<'SH'
#!/usr/bin/env bash
if [[ "${2:-}" == *process.versions.node* ]]; then exit 0; fi
exec "$REAL_NODE" "$@"
SH
cat > "$TEST_ROOT/bin/stat" <<'SH'
#!/usr/bin/env bash
case "$2" in %U) id -un;; %G) id -gn;; *) /usr/bin/stat "$@";; esac
SH
cat > "$TEST_ROOT/bin/flock" <<'SH'
#!/usr/bin/env bash
[[ ! -f "$TEST_ROOT/locked" ]]
SH
if [[ "$(uname -s)" == MINGW* ]]; then
  # NTFS does not implement Linux mode bits; Linux permission checks need a VPS.
  cat > "$TEST_ROOT/bin/mkdir" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == -m ]]; then shift 2; fi
exec /usr/bin/mkdir "$@"
SH
fi
cat > "$TEST_ROOT/bin/npm" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_ROOT/npm.calls"
if [[ "$1" == install ]]; then
  [[ ! -f "$TEST_ROOT/fail-install" ]] || exit 1
  mkdir -p node_modules
elif [[ "$1 $2" == 'run build' ]]; then
  [[ ! -f "$TEST_ROOT/fail-build" ]] || exit 1
  mkdir -p .next
  cp version .next/BUILD_ID
else exit 2; fi
SH
cat > "$TEST_ROOT/bin/pm2" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_ROOT/pm2.calls"
case "$1" in
  jlist)
    state=online
    if [[ -f "$TEST_ROOT/fail-status" && "$(cat "$TEST_CURRENT/version")" == v3 ]]; then state=errored; fi
    printf '[{"name":"runflow","pid":123,"pm2_env":{"status":"%s","pm_cwd":"%s"}}]\n' "$state" "$TEST_CURRENT";;
  restart) [[ ! -f "$TEST_ROOT/fail-restart" || "$(cat "$TEST_CURRENT/version")" != v3 ]];;
  save) [[ ! -f "$TEST_ROOT/fail-save" || "$(cat "$TEST_CURRENT/version")" != v3 ]];;
  status|logs|describe) exit 0;;
  *) exit 2;;
esac
SH
cat > "$TEST_ROOT/bin/curl" <<'SH'
#!/usr/bin/env bash
[[ ! -f "$TEST_ROOT/fail-health" || "$(cat "$TEST_CURRENT/version")" != v3 ]]
SH
cat > "$TEST_ROOT/bin/sleep" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat > "$TEST_ROOT/bin/ssh" <<'SH'
#!/usr/bin/env bash
[[ ! -f "$TEST_ROOT/fail-ssh" ]] || exit 255
cmd="${@: -1}"
if [[ "$cmd" == 'bash -s '* ]]; then
  cat > "$TEST_ROOT/received-script"
  printf '%s\n' "$cmd" > "$TEST_ROOT/received-command"
else bash -c "$cmd"; fi
SH
cat > "$TEST_ROOT/bin/scp" <<'SH'
#!/usr/bin/env bash
[[ ! -f "$TEST_ROOT/fail-scp" ]] || exit 1
src="${@: -2:1}"; dst="${@: -1}"
cp "$src" "${dst#*:}"
SH
chmod +x "$TEST_ROOT/bin/"*
printf '{"scripts":{"build":"next build"}}\n' > "$TEST_CURRENT/package.json"
printf 'v1\n' > "$TEST_CURRENT/version"
printf 'server-secret-v1\n' > "$TEST_CURRENT/.env.production"
chmod 600 "$TEST_CURRENT/.env.production"
mkdir -p "$TEST_CURRENT/node_modules" "$TEST_CURRENT/.next" "$TEST_CURRENT/uploads" "$TEST_CURRENT/public/uploads"
printf v1 > "$TEST_CURRENT/.next/BUILD_ID"
printf 'user-data\n' > "$TEST_CURRENT/uploads/item"
printf 'public-data\n' > "$TEST_CURRENT/public/uploads/item"
printf 'old-only\n' > "$TEST_CURRENT/obsolete-code"
cp "$TEST_CURRENT/package.json" "$TEST_ROOT/source/"
printf v2 > "$TEST_ROOT/source/version"
TEST_ARCHIVE="/tmp/runflow-deploy-test-$$_$RANDOM.tar.gz"
tar -czf "$TEST_ARCHIVE" -C "$TEST_ROOT/source" .
run_remote() { bash "$ROOT/deploy/remote-deploy.sh" "$1" "$TEST_CURRENT" runflow "${2:-$TEST_ARCHIVE}" > "$TEST_ROOT/last.log" 2>&1; }
expect_version() { [[ "$(cat "$TEST_CURRENT/version")" == "$1" ]] || { cat "$TEST_ROOT/last.log"; exit 1; }; }
expect_fail() { if "$@"; then printf 'Expected failure: %s\n' "$*"; exit 1; fi; }

run_remote deploy || { cat "$TEST_ROOT/last.log"; exit 1; }
expect_version v2
[[ ! -e "$TEST_CURRENT/obsolete-code" ]]
[[ "$(cat "$TEST_CURRENT/.env.production")" == server-secret-v1 ]]
[[ "$(cat "$TEST_CURRENT/uploads/item")" == user-data ]]
printf 'new-user-data\n' > "$TEST_CURRENT/uploads/item"
printf 'server-secret-v2\n' > "$TEST_CURRENT/.env.production"
run_remote rollback
expect_version v1
[[ "$(cat "$TEST_CURRENT/.env.production")" == server-secret-v2 ]]
[[ "$(cat "$TEST_CURRENT/uploads/item")" == new-user-data ]]
[[ "$(cat "$TEST_CURRENT/public/uploads/item")" == public-data ]]
printf 'PASS: deploy, code removal, rollback, current config and user data preservation\n'

printf v3 > "$TEST_ROOT/source/version"
tar -czf "$TEST_ARCHIVE" -C "$TEST_ROOT/source" .
for failure in install build restart health status save; do
  touch "$TEST_ROOT/fail-$failure"
  expect_fail run_remote deploy
  expect_version v1
  [[ "$(cat "$TEST_CURRENT/.env.production")" == server-secret-v2 ]]
  [[ "$(cat "$TEST_CURRENT/uploads/item")" == new-user-data ]]
  [[ "$(cat "$TEST_CURRENT/.next/BUILD_ID")" == v1 ]]
  rm "$TEST_ROOT/fail-$failure"
  printf 'PASS: %s failure leaves/restores the previous release\n' "$failure"
done
touch "$TEST_ROOT/locked"
expect_fail run_remote deploy
rm "$TEST_ROOT/locked"
expect_version v1
printf 'PASS: server lock rejection\n'
touch "$TEST_ROOT/fail-build"
expect_fail run_remote rollback
rm "$TEST_ROOT/fail-build"
expect_version v1
printf 'PASS: failed rollback leaves the current release in place\n'
printf 'must-not-upload' > "$TEST_ROOT/source/.env.production"
tar -czf "$TEST_ARCHIVE" -C "$TEST_ROOT/source" .
expect_fail run_remote deploy
expect_version v1
rm "$TEST_ROOT/source/.env.production"
printf 'PASS: server rejects an archive containing environment files\n'
rm "$TEST_CURRENT/public/uploads"
run_remote rollback
expect_version v2
[[ ! -e "$TEST_CURRENT/public/uploads" && ! -L "$TEST_CURRENT/public/uploads" ]]
[[ "$(cat "$TEST_CURRENT/uploads/item")" == new-user-data ]]
[[ "$(cat "$TEST_CURRENT/.env.production")" == server-secret-v2 ]]
printf 'PASS: rollback does not resurrect removed data paths\n'

# Exercise the actual local entrypoint with transport mocks and inspect its tar.
cp "$ROOT/deploy.sh" "$ROOT/rollback.sh" "$TEST_ROOT/local/"
cp "$ROOT/deploy/local-deploy.sh" "$ROOT/deploy/remote-deploy.sh" "$TEST_ROOT/local/deploy/"
cp "$ROOT/package.json" "$TEST_ROOT/local/"
cat > "$TEST_ROOT/local/.deploy.config" <<'CFG'
SERVER_HOST=example.test
SERVER_USER=runflow
SERVER_PORT=22
SERVER_PATH=/var/www/runflow
PM2_NAME=runflow
PRESERVE_PATHS=private-files
CFG
for d in node_modules .git .next dist .cache logs uploads private-files .deploy-stage-old; do
  mkdir "$TEST_ROOT/local/$d"; printf secret > "$TEST_ROOT/local/$d/must-not-upload"
done
for f in .env .env.local old.tar.gz debug.log key.pem; do printf secret > "$TEST_ROOT/local/$f"; done
mkdir -p "$TEST_ROOT/local/app/logs" "$TEST_ROOT/local/components/logs"
printf 'business route' > "$TEST_ROOT/local/app/logs/page.tsx"
printf 'business component' > "$TEST_ROOT/local/components/logs/operation-logs.tsx"
bash "$TEST_ROOT/local/deploy.sh" > "$TEST_ROOT/local.log" 2>&1
tar -tzf "$TEST_ROOT/local/deploy-package.tar.gz" > "$TEST_ROOT/package-entries"
if grep -E 'must-not-upload|\.env|\.tar\.gz|\.log|\.pem|\.deploy.config' "$TEST_ROOT/package-entries"; then exit 1; fi
grep -q './package.json' "$TEST_ROOT/package-entries"
grep -q './app/logs/page.tsx' "$TEST_ROOT/package-entries"
grep -q './components/logs/operation-logs.tsx' "$TEST_ROOT/package-entries"
[[ ! -d "$TEST_ROOT/local/.deploy-local.lock" ]]
for failure in ssh scp; do
  touch "$TEST_ROOT/fail-$failure"
  expect_fail bash "$TEST_ROOT/local/deploy.sh"
  rm "$TEST_ROOT/fail-$failure"
  [[ ! -d "$TEST_ROOT/local/.deploy-local.lock" ]]
done
bash "$TEST_ROOT/local/rollback.sh" > "$TEST_ROOT/local.log" 2>&1
grep -q "'rollback'" "$TEST_ROOT/received-command"
[[ ! -d "$TEST_ROOT/local/.deploy-local.lock" ]]
rm -f "$TEST_ARCHIVE"
printf 'PASS: local deploy/rollback, package exclusions, SSH/upload failures, lock cleanup\n'
printf 'All deployment tests passed. No production server was contacted.\n'
