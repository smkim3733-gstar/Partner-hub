@echo off
rem Partner Hub daily backup + local restore verification (run by Windows Task Scheduler).
rem Secrets are read only from the repository's .env.local. Keep this file ASCII-only.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0daily-backup.ps1"
exit /b %ERRORLEVEL%
