# 파트너 허브 일일 백업 + 로컬 복원 검증. daily-backup.cmd 가 실행한다(Windows 작업 스케줄러).
# 저장소 위치는 이 파일 위치에서 자동으로 찾는다: <저장소>\tools\windows\daily-backup.ps1
# 성공하면
#  - 암호화된 백업 파일(.phbackup)만 OneDrive\PartnerHubBackupCopies 에 복사 (복구 키는 넣지 않음)
#  - 복구 키만 Google Drive(내 드라이브)\PartnerHubRecoveryKeys 에 복사 (백업 파일은 넣지 않음)
# 서로 다른 회사의 저장소에 나눠 두어 한쪽만으로는 복원할 수 없게 한다.
# PostgreSQL 17 도구 위치: 환경변수 PARTNER_HUB_PG_BIN, 없으면 아래 후보에서 pg_dump.exe 를 찾는다.
$ErrorActionPreference = 'Continue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir = Join-Path $repo 'work\backup-logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("backup-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))

$pgBin = $env:PARTNER_HUB_PG_BIN
if (-not $pgBin) {
  $candidates = @(
    (Join-Path (Split-Path $repo -Parent) 'tools'),
    (Join-Path $env:LOCALAPPDATA 'PartnerHubTools')
  ) | Where-Object { Test-Path $_ } | ForEach-Object {
    Get-ChildItem $_ -Directory -Filter 'postgresql-17*' -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName 'pgsql\bin' }
  }
  $pgBin = $candidates | Where-Object { Test-Path (Join-Path $_ 'pg_dump.exe') } | Select-Object -First 1
}
if (-not $pgBin) {
  "PostgreSQL 17 tools not found. Set PARTNER_HUB_PG_BIN or unzip postgresql-17.x next to the repo under ..\tools" | Set-Content $log
  $code = 2
} else {
  Set-Location $repo
  & node --env-file-if-exists=.env.local scripts\supabase-backup-scheduled.mjs run --pg-bin $pgBin *> $log
  $code = $LASTEXITCODE
}
$warnings = @()
$backupRoot = Join-Path $env:USERPROFILE 'PartnerHubBackups'
$keyRoot = Join-Path $env:USERPROFILE 'PartnerHubRecoveryKeys'

function Copy-NewFiles($srcRoot, $dstRoot) {
  $added = 0
  Get-ChildItem $srcRoot -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($srcRoot.Length).TrimStart('\')
    $dst = Join-Path $dstRoot $rel
    if (-not (Test-Path $dst)) {
      New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
      Copy-Item $_.FullName $dst
      if ((Get-FileHash $_.FullName).Hash -ne (Get-FileHash $dst).Hash) { throw "copy hash mismatch: $rel" }
      $added++
    }
  }
  return $added
}

if ($code -eq 0) {
  # 1) 암호화된 백업 파일 -> OneDrive
  try {
    if (-not $env:OneDrive) { throw 'OneDrive is not set up on this PC' }
    $copyDir = Join-Path $env:OneDrive 'PartnerHubBackupCopies'
    New-Item -ItemType Directory -Force $copyDir | Out-Null
    $copied = 0
    Get-ChildItem $backupRoot -Directory -Filter 'backup-*' | ForEach-Object {
      $src = Join-Path $_.FullName 'partner-hub.phbackup'
      if (Test-Path $src) {
        $dst = Join-Path $copyDir ("{0}_{1}.phbackup" -f $_.LastWriteTime.ToString('yyyy-MM-dd'), $_.Name)
        if (-not (Test-Path $dst) -or (Get-FileHash $src).Hash -ne (Get-FileHash $dst).Hash) { Copy-Item $src $dst -Force; $copied++ }
      }
    }
    Add-Content $log "OneDrive copy: $copied new file(s) -> $copyDir"
  } catch { $warnings += "OneDrive 복사 실패"; Add-Content $log "OneDrive copy FAILED: $($_.Exception.Message)" }

  # 2) 복구 키 -> Google Drive (내 드라이브)
  try {
    $myDrive = Get-PSDrive -PSProvider FileSystem | ForEach-Object {
      @((Join-Path $_.Root '내 드라이브'), (Join-Path $_.Root 'My Drive'))
    } | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $myDrive) { throw 'Google Drive (My Drive) is not available' }
    $added = Copy-NewFiles $keyRoot (Join-Path $myDrive 'PartnerHubRecoveryKeys')
    Add-Content $log "Google Drive key copy: $added new file(s)"
  } catch { $warnings += "Google Drive 키 복사 실패 (Google Drive가 실행·로그인되어 있는지 확인)"; Add-Content $log "Google Drive key copy FAILED: $($_.Exception.Message)" }
}

if ($code -ne 0 -or $warnings.Count -gt 0) {
  Add-Type -AssemblyName PresentationFramework
  $msg = if ($code -ne 0) { "파트너 허브 일일 백업이 실패했습니다." } else { "백업은 성공했지만 PC 밖 복사에 문제가 있습니다:`n- " + ($warnings -join "`n- ") }
  [System.Windows.MessageBox]::Show("$msg`nClaude에게 이 내용을 알려 주세요.`n`n로그: $log", '파트너 허브 백업') | Out-Null
}
exit $code
