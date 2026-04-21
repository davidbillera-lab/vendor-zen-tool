@echo off
title eBay CSV Queue Agent (Run Once)
color 0A

echo.
echo  ==========================================
echo   eBay CSV Queue Agent — Run Once
echo  ==========================================
echo.

:: Move to the ebay-agent folder
cd /d "%~dp0doa-listing-agent\ebay-agent"

:: Check Node.js is installed
where node >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Node.js is not installed or not in PATH.
  echo  Download it at https://nodejs.org
  pause
  exit /b 1
)

:: Check .env exists
if not exist ".env" (
  echo  ERROR: .env file not found in doa-listing-agent\ebay-agent\
  echo.
  echo  Steps to fix:
  echo    1. Copy .env.example to .env
  echo    2. Fill in your EBAY_EMAIL, EBAY_PASSWORD, and EBAY_CSV_QUEUE_DIR
  echo.
  pause
  exit /b 1
)

:: Install dependencies if node_modules is missing
if not exist "node_modules" (
  echo  Installing dependencies (first run only)...
  call npm install
  if errorlevel 1 (
    echo  ERROR: npm install failed.
    pause
    exit /b 1
  )
  echo.
  echo  Installing Playwright browsers...
  call npx playwright install chromium
  echo.
)

:: Check for --dry-run flag passed to this bat file
set DRY_RUN_FLAG=
if /i "%~1"=="--dry-run" set DRY_RUN_FLAG=--dry-run
if /i "%~1"=="-n"         set DRY_RUN_FLAG=--dry-run

if defined DRY_RUN_FLAG (
  echo  DRY RUN mode — no files will be uploaded
  echo.
)

echo  Processing pending CSVs now...
echo.

node agent.js %DRY_RUN_FLAG%

echo.
echo  Done. Check the ebay-agent\logs\ folder for details.
pause
