#!/usr/bin/env bash
# Shared local transport. Config is parsed as data, never executed as shell code.
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

read_deploy_config() {
  local line key value
  [[ -f "$ROOT/.deploy.config" ]] || die 'Missing .deploy.config'
  SERVER_HOST= SERVER_USER= SERVER_PORT=22 SERVER_PATH= PM2_NAME= PRESERVE_PATHS=
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" == *=* ]] || die 'Config must use KEY=value (no shell commands).'
    key="${line%%=*}"; value="${line#*=}"
    case "$key" in
      SERVER_HOST|SERVER_USER|SERVER_PORT|SERVER_PATH|PM2_NAME|PRESERVE_PATHS) printf -v "$key" '%s' "$value" ;;
      *) die "Unknown config key: $key" ;;
    esac
  done < "$ROOT/.deploy.config"
  [[ "$SERVER_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die 'Set SERVER_HOST to a hostname, IPv4 address or SSH alias.'
  [[ "$SERVER_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || die 'Set SERVER_USER.'
  [[ "$SERVER_PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$SERVER_PORT > 0 && 10#$SERVER_PORT <= 65535)) || die 'Invalid SERVER_PORT.'
  [[ "$SERVER_PATH" =~ ^/[a-zA-Z0-9_/-]+$ && "$SERVER_PATH" != */ && "$SERVER_PATH" != *//* && "$SERVER_PATH" != *'/../'* ]] || die 'SERVER_PATH must be a safe absolute path without spaces.'
  [[ "$PM2_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || die 'Invalid PM2_NAME.'
  [[ "$PRESERVE_PATHS" =~ ^[a-zA-Z0-9_./,-]*$ ]] || die 'Invalid PRESERVE_PATHS.'
}

run_deployment() {
  local mode="$1" command_name remote_command token
  # EXIT traps also run after Bash unwinds a failed function's local scope.
  deploy_remote_archive='' deploy_upload_done=0
  read_deploy_config
  cd -- "$ROOT"
  for command_name in ssh scp tar; do command -v "$command_name" >/dev/null || die "Missing $command_name. On Windows use Git Bash."; done
  deploy_ssh_options=(-p "$SERVER_PORT" -o BatchMode=yes -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
  deploy_target="$SERVER_USER@$SERVER_HOST"
  printf 'Checking SSH key authentication...\n'
  ssh "${deploy_ssh_options[@]}" "$deploy_target" 'true'
  # mkdir is also portable to Git Bash. Never remove somebody else's lock.
  mkdir "$ROOT/.deploy-local.lock" 2>/dev/null || die 'Another local deployment is active (.deploy-local.lock).'
  cleanup_local() {
    local code=$?
    trap - EXIT
    if ((deploy_upload_done)); then ssh "${deploy_ssh_options[@]}" "$deploy_target" "rm -f -- '$deploy_remote_archive'" </dev/null >/dev/null 2>&1 || true; fi
    rm -f -- "$ROOT/.deploy-local.lock/package.tar.gz"
    rmdir "$ROOT/.deploy-local.lock" 2>/dev/null || true
    exit "$code"
  }
  trap cleanup_local EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if [[ "$mode" == deploy ]]; then
    printf 'Packing local source...\n'
    local -a extra_excludes=() configured_paths=()
    local preserved_path
    IFS=',' read -r -a configured_paths <<< "$PRESERVE_PATHS"
    for preserved_path in "${configured_paths[@]}"; do
      [[ -z "$preserved_path" ]] || extra_excludes+=("--exclude=./$preserved_path")
    done
    # Historical archives, local state and credentials must never reach production.
    tar -czf .deploy-local.lock/package.tar.gz \
      --exclude='node_modules' --exclude='.git' --exclude='.env*' \
      --exclude='.next' --exclude='dist' --exclude='out' --exclude='.cache' \
      --exclude='.turbo' --exclude='coverage' --exclude='test-results' \
      --exclude='*.log' --exclude='*.tsbuildinfo' --exclude='*.tar.gz' \
      --exclude='*.tgz' --exclude='*.zip' --exclude='.deploy*' \
      --exclude='.npmrc' --exclude='.ssh' --exclude='*.pem' --exclude='*.key' \
      --exclude='./data' --exclude='./uploads' --exclude='./storage' --exclude='./logs' \
      --exclude='./public/uploads' \
      "${extra_excludes[@]}" \
      -C "$ROOT" .
    mv -f -- "$ROOT/.deploy-local.lock/package.tar.gz" "$ROOT/deploy-package.tar.gz"
    token="$(date +%Y%m%d_%H%M%S)_$$_$RANDOM"
    deploy_remote_archive="/tmp/runflow-deploy-$token.tar.gz"
    deploy_upload_done=1
    printf 'Uploading deploy-package.tar.gz to %s...\n' "$deploy_remote_archive"
    scp -P "$SERVER_PORT" -o BatchMode=yes -o PreferredAuthentications=publickey \
      -o PasswordAuthentication=no -o StrictHostKeyChecking=yes -o ConnectTimeout=10 \
      ./deploy-package.tar.gz "$deploy_target:$deploy_remote_archive"
  fi
  # Validated values contain no quotes or shell metacharacters.
  remote_command="bash -s -- '$mode' '$SERVER_PATH' '$PM2_NAME' '$deploy_remote_archive' '$PRESERVE_PATHS'"
  ssh "${deploy_ssh_options[@]}" "$deploy_target" "$remote_command" < "$ROOT/deploy/remote-deploy.sh"
  exit 0
}
