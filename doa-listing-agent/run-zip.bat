@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: run-zip.bat — DOA Listing Agent (Zip Mode)
::
:: HOW TO USE:
::   1. Put your auction image zip file in the same folder as this bat file.
::   2. Edit the ZIP_FILE= line below to match your zip filename.
::   3. Double-click this file to run the agent.
::
:: IMAGE NAMING CONVENTION (inside the zip):
::   {lot}_{index}.{ext}
::   Examples: 101_01.jpg  101_02.jpg  102_01.jpg  102_02.jpg  102_03.png
::
:: The agent will:
::   - Open Chrome and log into DOA sub-admin
::   - For each lot: upload images → click "Insert AI title/description"
::     → select "Use first six images" → wait for AI → click "Save & Edit Next"
::   - Repeat until all lots are done
:: ─────────────────────────────────────────────────────────────────────────────

setlocal
cd /d "%~dp0"

echo.
echo  DOA Listing Agent — Zip Mode
echo  ─────────────────────────────────────────────────────────────
echo.

:: ── EDIT THIS LINE: set your zip filename ─────────────────────────────────────
set ZIP_FILE=auction-images.zip

:: Check that Node.js is installed
where node >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js is not installed or not in PATH.
    echo  Download it from: https://nodejs.org  (use the LTS version)
    echo.
    pause
    exit /b 1
)

:: Check that the zip file exists
if not exist "%ZIP_FILE%" (
    echo  ERROR: Zip file not found: %ZIP_FILE%
    echo.
    echo  Make sure your zip file is in the same folder as this bat file.
    echo  Then edit this bat file and change ZIP_FILE= to your filename.
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

:: Install dependencies if needed
if not exist "node_modules" (
    echo  First-time setup: installing dependencies...
    echo  (This only happens once — may take 1-2 minutes)
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
echo  Starting agent with zip file: %ZIP_FILE%
echo.
node agent.js --zip "%ZIP_FILE%" --force

:: ── Show result ───────────────────────────────────────────────────────────────
if errorlevel 1 (
    echo.
    echo  ─────────────────────────────────────────────────────────────
    echo  Some lots failed. Check the output above for details.
    echo  Re-run this file to retry only the failed lots.
    echo  ─────────────────────────────────────────────────────────────
) else (
    echo.
    echo  ─────────────────────────────────────────────────────────────
    echo  All lots completed successfully!
    echo  ─────────────────────────────────────────────────────────────
)

echo.
pause
