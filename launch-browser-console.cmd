@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Run setup-sdr-extreme.cmd first.
  pause
  exit /b 1
)
powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:17890/api/state' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  set ELECTRON_RUN_AS_NODE=1
  start "SDR Extreme service" /min "node_modules\electron\dist\electron.exe" "server.mjs"
  timeout /t 2 /nobreak >nul
)
start "" "http://127.0.0.1:17890"
