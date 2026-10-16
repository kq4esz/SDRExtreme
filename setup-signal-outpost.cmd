@echo off
setlocal
cd /d "%~dp0"
where npm.cmd >nul 2>nul
if not errorlevel 1 (
  call npm.cmd install
  if errorlevel 1 goto failed
  node node_modules\electron\install.js
  if errorlevel 1 goto failed
  goto complete
)
set "SIGNAL_OUTPOST_RUNTIME=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node"
if exist "%SIGNAL_OUTPOST_RUNTIME%\bin\node.exe" if exist "%SIGNAL_OUTPOST_RUNTIME%\node_modules\pnpm\bin\pnpm.cjs" (
  set "PATH=%SIGNAL_OUTPOST_RUNTIME%\bin;%PATH%"
  "%SIGNAL_OUTPOST_RUNTIME%\bin\node.exe" "%SIGNAL_OUTPOST_RUNTIME%\node_modules\pnpm\bin\pnpm.cjs" install --frozen-lockfile
  if errorlevel 1 goto failed
  "%SIGNAL_OUTPOST_RUNTIME%\bin\node.exe" node_modules\electron\install.js
  if errorlevel 1 goto failed
  goto complete
)
echo Install Node.js 22.12 or newer from https://nodejs.org/ and run setup again.
pause
exit /b 1
:complete
echo Signal Outpost desktop is ready. Open launch-signal-outpost.cmd.
exit /b 0
:failed
echo Setup failed. Review the message above, then run setup again.
pause
exit /b 1
