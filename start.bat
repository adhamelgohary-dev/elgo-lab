@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1 || (echo Node.js 22 or newer is required. & pause & exit /b 1)
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "for ($attempt=0; $attempt -lt 40; $attempt++) { try { $page=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4183/?flow=hub' -TimeoutSec 1; if ($page.StatusCode -eq 200) { Start-Process 'http://127.0.0.1:4183/?flow=hub'; break } } catch {}; Start-Sleep -Milliseconds 250 }"
node tools\dev-server.js
if errorlevel 1 pause