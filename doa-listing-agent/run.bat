@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: run.bat — DOA Listing Agent for Windows
:: Double-click this file to run the agent.
:: ─────────────────────────────────────────────────────────────────────────────

setlocal
cd /d "%~dp0"

echo.
echo  DOA Listing Agent
echo  ─────────────────────────────────────────────────────────────
echo.

:: Check that Node.js is installed
where node >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js is not installed or not in PATH.
    echo  Download it from: https://nodejs.org  (use the LTS version)
    echo.
    pause
    exit /b 1
)

:: Check that the CSV file exists
set CSV_FILE=denver-auctions-DAO.csv
if not exist "%CSV_FILE%" (
    echo  ERROR: CSV file not found: %CSV_FILE%
    echo.
    echo  Make sure your lots CSV file is in the same folder as this bat file.
    echo  It should be named: denver-auctions-DAO.csv
    echo  Or edit this bat file and change CSV_FILE= to your filename.
    echo.
    pause
    exit /b 1
)

:: Check that .env exists
if not exist ".env" (
    echo  ERROR: .env file not found.
    echo.
    echo  Copy .env.example to .env and fill in your DOA credentials:
    echo    DOA_EMAIL=your-email@example.com
    echo    DOA_PASSWORD=your-password
    echo    DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=...
    echo.
    pause
    exit /b 1
)

:: Check that node_modules is installed
if not exist "node_modules" (
    echo  First-time setup: installing dependencies...
    echo  (This only happens once)
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo  ERROR: npm install failed. Check your internet connection.
        pause
        exit /b 1
    )
    echo.
)

:: ── Run the agent ─────────────────────────────────────────────────────────────
:: Remove --force below if you want a confirmation prompt before starting
node agent.js --csv "%CSV_FILE%" --force

:: ── Show result ───────────────────────────────────────────────────────────────
if errorlevel 1 (
    echo.
    echo  ─────────────────────────────────────────────────────────────
    echo  Some lots failed. Check the output above for details.
    echo  Re-run this file to retry only the failed lots.
    echo  Completed lots are automatically skipped.
    echo  ─────────────────────────────────────────────────────────────
) else (
    echo.
    echo  ─────────────────────────────────────────────────────────────
    echo  All lots completed successfully!
    echo  ─────────────────────────────────────────────────────────────
)

echo.
pause
