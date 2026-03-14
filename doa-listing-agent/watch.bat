@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: watch.bat — DOA Listing Agent: Auto Watch Mode
::
:: HOW TO USE:
::   1. Double-click this file to start the watcher
::   2. Drop any auction CSV into:
::        doa-listing-agent\incoming\
::   3. The agent picks it up automatically within 30 seconds
::   4. Walk away — the agent handles everything
::
:: FOLDER STRUCTURE (auto-created on first run):
::   incoming\           ← DROP YOUR CSV FILES HERE
::   incoming\processing\ ← Agent moves CSV here while working (do not touch)
::   incoming\done\      ← Finished CSVs moved here with date folder
::   incoming\failed\    ← Failed CSVs moved here with error notes
::
:: CSV FORMAT (one row per lot):
::   lot_number, title, description, images, starting_bid
::   images = pipe-separated URLs: https://img1.jpg|https://img2.jpg
::
:: NOTES:
::   - Set DOA_FIRST_LOT_URL in .env before running
::   - Or add a doa_first_lot_url column to your CSV (first row only)
::   - Completed lots are skipped automatically on retry
::   - Leave this window open — press Ctrl+C to stop watching
:: ─────────────────────────────────────────────────────────────────────────────

setlocal
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════════════════════════════╗
echo  ║         DOA Listing Agent — WATCH MODE ACTIVE               ║
echo  ╚══════════════════════════════════════════════════════════════╝
echo.
echo  DROP FOLDER:
echo  %~dp0incoming\
echo.
echo  Drop a CSV file into the folder above.
echo  The agent will pick it up within 30 seconds and run automatically.
echo.
echo  Press Ctrl+C to stop watching.
echo  ─────────────────────────────────────────────────────────────────
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js is not installed or not in PATH.
    echo  Download from: https://nodejs.org  (LTS version)
    echo.
    pause
    exit /b 1
)

:: Check .env
if not exist ".env" (
    echo  ERROR: .env file not found.
    echo.
    echo  Copy .env.example to .env and fill in:
    echo    DOA_EMAIL=your-email@example.com
    echo    DOA_PASSWORD=your-password
    echo    DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=...
    echo.
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo  First-time setup: installing dependencies...
    call npm install
    if errorlevel 1 (
        echo  ERROR: npm install failed. Check your internet connection.
        pause
        exit /b 1
    )
    echo.
)

:: Start watch mode — polls ./incoming/ every 30 seconds
node agent.js --watch --dir ./incoming --force

echo.
echo  Watch mode stopped.
pause
