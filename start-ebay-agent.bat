@echo off
title eBay CSV Queue Agent (Scheduled)
color 0B

echo.
echo  ==========================================
echo   eBay CSV Queue Agent — Scheduled Mode
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

echo  Starting scheduled daemon...
echo  (Cron schedule is set by SCHEDULE_TIME in .env)
echo  (Press Ctrl+C to stop)
echo.

node agent.js --schedule

pause
