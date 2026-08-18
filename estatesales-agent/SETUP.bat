@echo off
setlocal enabledelayedexpansion
title EstateSales Upload Agent -- First-Time Setup

:: ============================================================
::  EstateSales Upload Agent -- First-Time Setup
::
::  Double-click this ONCE on a new computer. It:
::    1. Checks Node.js is installed (v20 or newer)
::    2. Checks Google Chrome is installed (the agent drives the
::       real Chrome -- that is what EstateSales.net accepts)
::    3. Installs the agent's dependencies
::    4. Creates your private login file (if missing) and opens it
::    5. Reminds you to run SIGN-IN-ONCE.bat
::
::  Safe to run again after David sends you an updated folder.
::  It never touches your login file or Chrome profile once they exist.
:: ============================================================

set AGENT_DIR=%~dp0
set ENV_NAME=.estatesales-test.env
cd /d "%AGENT_DIR%"

echo.
echo  ====================================================
echo   EstateSales Upload Agent -- Setup
echo  ====================================================
echo.

:: -- 1. Node.js -----------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js is not installed.
    echo.
    echo  Install the LTS version from:  https://nodejs.org
    echo  Then close this window and double-click SETUP.bat again.
    echo.
    pause
    exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if !NODE_MAJOR! LSS 20 (
    echo  ERROR: Node.js is too old ^(found major version !NODE_MAJOR!, need 20 or newer^).
    echo  Install the LTS version from:  https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo  Node.js: %%v  [OK]

:: -- 2. Google Chrome -----------------------------------------
set CHROME_FOUND=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe"      set CHROME_FOUND=1
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME_FOUND=1
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe"      set CHROME_FOUND=1
if not defined CHROME_FOUND (
    echo  ERROR: Google Chrome is not installed.
    echo.
    echo  The agent drives your real Chrome ^(Edge does not work here^).
    echo  Install it from:  https://www.google.com/chrome
    echo  Then close this window and double-click SETUP.bat again.
    echo.
    pause
    exit /b 1
)
echo  Google Chrome: [OK]

:: -- 3. Dependencies ------------------------------------------
echo.
echo  Installing agent dependencies ^(this can take a minute^)...
call npm ci --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo  ERROR: npm ci failed. Check your internet connection and try again.
    echo  If it keeps failing, send David a screenshot of this window.
    pause
    exit /b 1
)
echo  Dependencies: [OK]

:: -- 4. Login file --------------------------------------------
echo.
if exist "%AGENT_DIR%%ENV_NAME%" (
    echo  %ENV_NAME% already exists -- leaving your login details untouched.  [OK]
) else (
    copy /Y "%AGENT_DIR%%ENV_NAME%.example" "%AGENT_DIR%%ENV_NAME%" >nul
    echo  Created %ENV_NAME% from the template.
    echo.
    echo  ACTION NEEDED: Notepad will open your login file.
    echo    - ESTATESALES_EMAIL=  and ESTATESALES_PASSWORD=  : your estatesales.net login
    echo    - DOA_EMAIL=  and DOA_PASSWORD=  : your DOA login ^(the launcher checks
    echo      these are filled in, even though the agent reads the public DOA page^)
    echo    - Leave DOA_URL, ESTATESALES_URL and the SUPABASE lines alone --
    echo      the launcher asks for the URLs each run and Supabase is not used locally
    echo    - Save and close Notepad
    echo.
    echo  NEVER send your %ENV_NAME% to anyone. It contains your passwords.
    echo.
    pause
    start /wait notepad "%AGENT_DIR%%ENV_NAME%"
    findstr /R /C:"^ESTATESALES_EMAIL=$" "%AGENT_DIR%%ENV_NAME%" >nul
    if not errorlevel 1 (
        echo.
        echo  WARNING: %ENV_NAME% still has the example login. The agent cannot sign in
        echo  until you open %ENV_NAME% in Notepad and put in your real details.
    )
)

echo.
echo  ====================================================
echo   Setup complete.
echo.
echo   Next: double-click SIGN-IN-ONCE.bat and sign into
echo   EstateSales.net by hand in the Chrome window that opens.
echo   You only do that once. Then read SETUP-GUIDE.txt.
echo  ====================================================
echo.
pause
