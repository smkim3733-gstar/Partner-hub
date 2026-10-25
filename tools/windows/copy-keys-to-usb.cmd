@echo off
rem Double-click with one USB drive inserted: copies new recovery keys to <USB>\PartnerHubRecoveryKeys.
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0copy-keys-to-usb.ps1"
echo.
pause
