@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  call setup-signal-outpost.cmd
  if errorlevel 1 exit /b 1
)
set ELECTRON_RUN_AS_NODE=
start "Signal Outpost" "node_modules\electron\dist\electron.exe" "."
