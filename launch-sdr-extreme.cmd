@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  call setup-sdr-extreme.cmd
  if errorlevel 1 exit /b 1
)
set ELECTRON_RUN_AS_NODE=
start "SDR Extreme" "node_modules\electron\dist\electron.exe" "."
