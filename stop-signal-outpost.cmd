@echo off
powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:17890/api/shutdown' | Out-Null; Write-Host 'Signal Outpost stopped.' } catch { Write-Host 'The Signal Outpost service is not running.' }"
