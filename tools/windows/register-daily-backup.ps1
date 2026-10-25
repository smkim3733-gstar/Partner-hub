# 파트너 허브 매일 백업을 Windows 작업 스케줄러에 등록한다 (사용자가 register-daily-backup.cmd 로 직접 실행).
# - 매일 오전 9시, 그 시각에 PC가 꺼져 있었으면 켜진 뒤 바로 실행
# - 현재 로그인한 사용자 권한으로만 실행 (관리자 권한·비밀번호 저장 없음)
# - 실행 내용: 이 폴더의 daily-backup.cmd (저장소를 옮기면 다시 등록한다)
$ErrorActionPreference = 'Stop'
$name = 'PartnerHub Daily Backup'
$cmd = Join-Path $PSScriptRoot 'daily-backup.cmd'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cmd`""
$trigger = New-ScheduledTaskTrigger -Daily -At '09:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Description '파트너 허브 Supabase 일일 백업 + 로컬 복원 검증' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host ''
Write-Host '✅ 매일 오전 9시 자동 백업을 등록했습니다.' -ForegroundColor Green
Write-Host "   실행 파일: $cmd"
Write-Host "   다음 실행: $((Get-ScheduledTaskInfo -TaskName $name).NextRunTime)"
Write-Host '   이 창을 닫고 Claude에게 "등록 완료"라고 알려 주세요.'
