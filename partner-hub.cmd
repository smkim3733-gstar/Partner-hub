@echo off
setlocal
cd /d "%~dp0"

rem Use the bundled tools when available; do not change the system PATH.
set "PARTNER_HUB_RUNTIME=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies"
if exist "%PARTNER_HUB_RUNTIME%\node\bin\node.exe" set "PATH=%PARTNER_HUB_RUNTIME%\node\bin;%PATH%"
if exist "%PARTNER_HUB_RUNTIME%\bin\fallback\pnpm.cmd" set "PATH=%PARTNER_HUB_RUNTIME%\bin\fallback;%PATH%"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required. Node.js 24 is recommended.
  exit /b 1
)
where pnpm.cmd >nul 2>nul
if errorlevel 1 (
  echo pnpm is required. Install pnpm and run this command again.
  exit /b 1
)

rem Wrangler state stays in this ignored workspace directory.
set "WRANGLER_SEND_METRICS=false"
set "WRANGLER_WRITE_LOGS=false"
set "WRANGLER_LOG_PATH=%CD%\.wrangler\logs"
set "MINIFLARE_REGISTRY_PATH=%CD%\.wrangler\registry"

if "%~1"=="" (
  call pnpm.cmd dev --host localhost
) else (
  call pnpm.cmd %*
)
exit /b %ERRORLEVEL%
