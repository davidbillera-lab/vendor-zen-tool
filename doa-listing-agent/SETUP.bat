@echo off
setlocal enabledelayedexpansion
title DOA Listing Agent -- First-Time Setup

:: ============================================================
::  DOA Listing Agent -- First-Time Setup
::
::  Double-click this ONCE on a new computer. It:
::    1. Checks Node.js is installed (v20 or newer)
::    2. Installs the agent's dependencies
::    3. Installs the browser the agent drives
::    4. Creates your private .env login file (if missing)
::    5. Creates the DROP-HERE and archive folders
::
::  Safe to run again after David sends you an updated folder.
::  It never touches your .env once it exists.
:: ============================================================

set AGENT_DIR=%~dp0
cd /d "%AGENT_DIR%"

echo.
echo  ====================================================
echo   DOA Listing Agent -- Setup
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

:: -- 2. Dependencies ------------------------------------------
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

:: -- 3. Browser -----------------------------------------------
echo.
echo  Installing the browser the agent uses ^(one-time download^)...
call npx playwright install chromium
if errorlevel 1 (
    echo.
    echo  ERROR: Browser install failed. Check your internet connection and try again.
    pause
    exit /b 1
)
echo  Browser: [OK]

:: -- 4. .env login file ---------------------------------------
echo.
if exist "%AGENT_DIR%.env" (
    echo  .env already exists -- leaving your login details untouched.  [OK]
) else (
    copy /Y "%AGENT_DIR%.env.example" "%AGENT_DIR%.env" >nul
    echo  Created .env from the template.
    echo.
    echo  ACTION NEEDED: Notepad will open your .env file.
    echo    - Put your DOA login after DOA_EMAIL=  and DOA_PASSWORD=
    echo    - Leave everything else alone
    echo    - Save and close Notepad
    echo.
    echo  NEVER send your .env to anyone. It contains your password.
    echo.
    pause
    start /wait notepad "%AGENT_DIR%.env"
    findstr /C:"DOA_EMAIL=your-email@example.com" "%AGENT_DIR%.env" >nul
    if not errorlevel 1 (
        echo.
        echo  WARNING: .env still has the example login. The agent cannot log in
        echo  until you open .env in Notepad and put in your DOA email + password.
    )
)

:: -- 5. Folders -----------------------------------------------
if not exist "%AGENT_DIR%DROP-HERE" mkdir "%AGENT_DIR%DROP-HERE"
if not exist "%AGENT_DIR%archive"   mkdir "%AGENT_DIR%archive"
if not exist "%AGENT_DIR%DROP-HERE\START-URL.txt" (
    (echo PASTE YOUR FIRST LOT URL BELOW THIS LINE -- DELETE THIS LINE FIRST) > "%AGENT_DIR%DROP-HERE\START-URL.txt"
)
echo  Folders: [OK]

echo.
echo  ====================================================
echo   Setup complete.
echo.
echo   Next: open SETUP-GUIDE.txt and follow "EVERY AUCTION".
echo  ====================================================
echo.
pause
