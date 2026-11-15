@echo off
setlocal EnableExtensions
title Elgo Lab - change the master admin password

rem ===========================================================================
rem  Changes ONLY the Elgo Lab master administrator password.
rem  The password is typed hidden, hashed on this PC with salted PBKDF2, and only the
rem  hash is saved as the Cloudflare Pages secret ADMIN_PASSWORD_HASH (through your
rem  existing Wrangler login). Student and co-admin passwords are never touched.
rem  The new password takes effect with the next deployment (deploy.bat).
rem  Guide: README.md, section "Deploying to Cloudflare Pages".
rem ===========================================================================

cd /d "%~dp0"
where node >nul 2>&1 || (echo Node.js is not installed. Install the LTS version from https://nodejs.org and try again. & pause & exit /b 1)

node tools\admin-password.js
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo  The password was NOT changed. Read the message above.
pause
exit /b %RESULT%
