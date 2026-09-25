param(
  [int]$Attempts = 60,
  [int]$DelaySeconds = 20
)

$ErrorActionPreference = 'Stop'
$key = 'C:/Users/1/.ssh/id_ed25519_runflow'
$hostName = 'root@103.117.139.225'
$sshOptions = @(
  '-i', $key,
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=10',
  '-o', 'ServerAliveInterval=10',
  '-o', 'ServerAliveCountMax=3'
)
$statusFile = '/tmp/runflow-auth-isolation.status'
$lockFile = '/tmp/runflow-auth-isolation.lock'
$logFile = '/tmp/runflow-auth-isolation.log'

$launch = @'
status=/tmp/runflow-auth-isolation.status
lock=/tmp/runflow-auth-isolation.lock
log=/tmp/runflow-auth-isolation.log
if test -s "$status"; then cat "$status"; exit 0; fi
if test -e "$lock"; then printf 'RUNNING\n'; exit 0; fi
: > "$lock"
nohup bash -lc 'set +e; bash /var/www/runflow.new-20260924-auth-isolation/deploy/activate-auth-isolation-release.sh 20260924-auth-isolation > /tmp/runflow-auth-isolation.log 2>&1; code=$?; printf "EXIT=%s\n" "$code" > /tmp/runflow-auth-isolation.status; rm -f /tmp/runflow-auth-isolation.lock' </dev/null >/dev/null 2>&1 &
printf 'STARTED\n'
'@

$check = @'
status=/tmp/runflow-auth-isolation.status
if test -s "$status"; then cat "$status"; exit 0; fi
if test -e /tmp/runflow-auth-isolation.lock; then printf 'RUNNING\n'; exit 0; fi
printf 'NOT_STARTED\n'
'@

for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
  $state = & ssh @sshOptions $hostName $check 2>$null
  if ($LASTEXITCODE -eq 0) {
    $stateText = ($state | Out-String).Trim()
    if ($stateText -eq 'NOT_STARTED') {
      $state = & ssh @sshOptions $hostName $launch 2>$null
      $stateText = ($state | Out-String).Trim()
    }
    Write-Output "attempt=$attempt state=$stateText"
    if ($stateText -match '^EXIT=(\d+)$') {
      $exitCode = [int]$Matches[1]
      & ssh @sshOptions $hostName "cat $logFile"
      exit $exitCode
    }
  } else {
    Write-Output "attempt=$attempt state=SSH_UNAVAILABLE"
  }
  Start-Sleep -Seconds $DelaySeconds
}

throw "SSH did not recover after $Attempts attempts"
