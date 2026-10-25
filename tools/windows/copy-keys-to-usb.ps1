# 파트너 허브 복구 키를 USB(이동식 디스크)에 복사한다. 사용자가 USB를 꽂고 copy-keys-to-usb.cmd 로 직접 실행한다.
# 기존 USB 파일은 지우지 않고, 새로 생긴 키만 추가한다. 키 내용은 화면에 표시하지 않는다.
$ErrorActionPreference = 'Stop'
$src = Join-Path $env:USERPROFILE 'PartnerHubRecoveryKeys'
$usb = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 }
Write-Host ''
if (-not (Test-Path $src)) {
  Write-Host "❌ 복구 키 폴더가 없습니다: $src (이 PC에서 백업을 한 번도 실행하지 않았을 수 있습니다)" -ForegroundColor Red
  exit 1
}
if (-not $usb) {
  Write-Host '❌ USB가 보이지 않습니다. USB를 꽂고 몇 초 뒤 다시 실행해 주세요.' -ForegroundColor Red
  exit 1
}
if (@($usb).Count -gt 1) {
  Write-Host '❌ USB가 2개 이상 꽂혀 있습니다. 키를 보관할 USB 하나만 꽂고 다시 실행해 주세요.' -ForegroundColor Red
  exit 1
}
$dstRoot = Join-Path ($usb.DeviceID + '\') 'PartnerHubRecoveryKeys'
New-Item -ItemType Directory -Force $dstRoot | Out-Null
$added = 0
Get-ChildItem $src -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($src.Length).TrimStart('\')
  $dst = Join-Path $dstRoot $rel
  if (-not (Test-Path $dst)) {
    New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
    Copy-Item $_.FullName $dst
    if ((Get-FileHash $_.FullName).Hash -ne (Get-FileHash $dst).Hash) { throw "복사 확인 실패: $rel" }
    $added++
  }
}
$total = (Get-ChildItem $dstRoot -Recurse -File).Count
Write-Host "✅ USB($($usb.DeviceID))에 복구 키를 복사했습니다. 새로 추가 $added개, USB 안 전체 $total개." -ForegroundColor Green
Write-Host '   USB를 안전하게 제거한 뒤, PC와 떨어진 곳(서랍·금고 등)에 보관하세요.'
Write-Host '   한 달에 한 번 정도 다시 꽂고 이 파일을 실행하면 새 키가 추가됩니다.'
