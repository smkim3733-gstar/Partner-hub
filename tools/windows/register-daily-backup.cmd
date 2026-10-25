@echo off
rem Double-click to register the 09:00 daily backup task for the current user.
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-daily-backup.ps1"
echo.
pause
