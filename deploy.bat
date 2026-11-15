@echo off
setlocal EnableExtensions
title Elgo Lab - deploy to Cloudflare Pages

rem ===========================================================================
rem  Elgo Lab one-click deployment.
rem  Double-click this file. It builds the secure public\ folder, checks it, and
rem  deploys it to the Cloudflare Pages project configured in wrangler.toml after you confirm.
rem  It never deploys the project root and never contains credentials: it uses the
rem  Wrangler login already stored on this PC (run "npx wrangler login" once).
rem  Full guide: README.md
rem ===========================================================================

rem Always work from the folder this file lives in, wherever it was started from.
cd /d "%~dp0"
set "PROJECT=elgo-lab"
set "DB=elgo_lab_db"
for /f "tokens=1,2 delims=," %%a in ('node -e "const t=require('./tools/admin-password').resolveWranglerTarget(); console.log(t.project + ',' + t.db)" 2^>nul') do (
  if not "%%a"=="" set "PROJECT=%%a"
  if not "%%b"=="" set "DB=%%b"
)
set "WRANGLER=npx --yes wrangler@4.159.0"

echo.
echo  ELGO LAB DEPLOYMENT
echo  Project folder: %CD%
echo  Pages project : %PROJECT%
echo.

echo [1/7] Checking Node.js ...
where node >nul 2>&1 || (echo   FAIL  Node.js is not installed. Install the LTS version from https://nodejs.org and try again. & goto :fail)
for /f "delims=" %%v in ('node --version') do echo   OK    Node.js %%v

echo [2/7] Checking npm / npx ...
where npx >nul 2>&1 || (echo   FAIL  npx was not found. It ships with Node.js; reinstall Node.js. & goto :fail)
echo   OK    npx found

echo [3/7] Checking Wrangler and your Cloudflare login ...
call %WRANGLER% --version >"%TEMP%\elgo-wrangler.txt" 2>&1 || (type "%TEMP%\elgo-wrangler.txt" & echo   FAIL  Wrangler could not start. Check your internet connection. & goto :fail)
call %WRANGLER% whoami >"%TEMP%\elgo-whoami.txt" 2>&1
findstr /C:"You are logged in" "%TEMP%\elgo-whoami.txt" >nul || (echo   FAIL  You are not logged in to Cloudflare. Run:  npx wrangler login  and try again. & goto :fail)
echo   OK    Wrangler is installed and logged in

echo [4/7] Checking the database migrations ...
call %WRANGLER% d1 migrations list %DB% --remote >"%TEMP%\elgo-migrations.txt" 2>&1
findstr /C:"No migrations to apply" "%TEMP%\elgo-migrations.txt" >nul
if errorlevel 1 (
  type "%TEMP%\elgo-migrations.txt"
  echo   FAIL  The production database has migrations that are not applied yet.
  echo         This version of the backend needs them. See README.md for Cloudflare D1 migrations.
  goto :fail
)
echo   OK    Production database is up to date

echo [5/7] Running tests, building public\ and scanning it ...
node tools\predeploy-check.js
if errorlevel 1 goto :fail

echo.
echo [6/7] Ready to publish public\ to https://%PROJECT%.pages.dev
echo       This replaces the live site for every student.
set "CONFIRM="
set /p "CONFIRM=      Type DEPLOY and press Enter to continue (anything else cancels): "
if /i not "%CONFIRM%"=="DEPLOY" (
  echo.
  echo   Cancelled. Nothing was deployed.
  goto :end
)

echo.
echo [7/7] Deploying ...
call %WRANGLER% pages deploy public --project-name %PROJECT%
if errorlevel 1 (
  echo.
  echo   FAIL  Wrangler reported an error. The live site was not changed by this run.
  goto :fail
)

echo.
echo  DEPLOYED. Check the site:  https://%PROJECT%.pages.dev
echo  Quick safety probes to open in a browser (all must say "not found" or 401):
echo    https://%PROJECT%.pages.dev/backend/answer-key.js
echo    https://%PROJECT%.pages.dev/wrangler.toml
echo    https://%PROJECT%.pages.dev/api/admin/users
echo.
goto :end

:fail
echo.
echo  DEPLOYMENT STOPPED. Fix the problem above and run deploy.bat again.
echo.
pause
exit /b 1

:end
echo.
pause
exit /b 0
