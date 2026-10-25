@echo off
rem Double-click: resets the production admin password (asks for confirmation; input hidden).
chcp 65001 >nul
node "%~dp0reset-admin-password.mjs"
echo.
pause
