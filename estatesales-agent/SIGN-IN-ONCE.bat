@echo off
setlocal
title EstateSales.net - one-time sign in

rem ============================================================
rem  Run this ONCE (or whenever EstateSales signs you out).
rem
rem  Opens the agent's own Chrome profile so you can sign in by
rem  hand. EstateSales guards its sign-in form with reCAPTCHA v3,
rem  which rejects an automated fill as "password was incorrect"
rem  even when the password is right. Signing in yourself stores
rem  the cookie in .chrome-profile, and the agent then skips the
rem  form completely on every run.
rem ============================================================

set AGENT_DIR=%~dp0

if not exist "%AGENT_DIR%sign-in-once.mjs" (
    echo.
    echo  ERROR: sign-in-once.mjs not found in:
    echo    %AGENT_DIR%
    echo.
    pause
    exit /b 1
)

cd /d "%AGENT_DIR%"
node sign-in-once.mjs
set RC=%ERRORLEVEL%

echo.
if %RC% EQU 0 (
    echo  ================================================
    echo   Done. Run RUN-ESTATESALES-AGENT next.
    echo  ================================================
) else (
    echo  ================================================
    echo   Sign-in not completed. Run this again.
    echo  ================================================
)
echo.
pause
