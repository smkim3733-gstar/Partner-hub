@echo off
rem Double-click: saves the Supabase secret key and DB password into the repository's .env.local (input hidden).
chcp 65001 >nul
node "%~dp0save-production-keys.mjs"
echo.
pause
