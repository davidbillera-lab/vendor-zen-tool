@echo off
setlocal enabledelayedexpansion
title DOA Listing Agent

:: ============================================================
::  DOA Listing Agent -- Drop Folder Launcher
::
::  HOW TO USE EVERY TIME:
::    1. Open the DROP-HERE folder
::    2. Drop in your CSV (from Vendor-Zen-Tool)
::    3. Drop in your image ZIP file
::    4. Open START-URL.txt -- paste the first lot's URL
::       and save it (replace the placeholder line)
::    5. Double-click this file (or the desktop shortcut)
::
::  DESCRIPTIONS-ONLY MODE (patch a previous run):
::    1. Drop in the SAME CSV and ZIP used last time
::    2. Update START-URL.txt with the first lot's URL again
::    3. Create an empty file called DESCRIPTIONS-ONLY.txt
::       in the DROP-HERE folder
::    4. Double-click this file -- only descriptions are filled,
::       titles and images are left untouched
::
::  The agent finds everything automatically, runs all lots,
::  then moves your files to the archive folder when done.
:: ============================================================

set AGENT_DIR=%~dp0
set DROP_DIR=%~dp0DROP-HERE
set ARCHIVE_DIR=%~dp0archive

:: -- Make sure DROP-HERE and archive folders exist ---------
if not exist "%DROP_DIR%" mkdir "%DROP_DIR%"
if not exist "%ARCHIVE_DIR%" mkdir "%ARCHIVE_DIR%"

echo.
echo  ====================================================
echo   DOA Listing Agent
echo  ====================================================
echo.

:: -- Check for DESCRIPTIONS-ONLY mode flag -----------------
set DESC_ONLY_FLAG=
set DESC_ONLY_FILE=%DROP_DIR%\DESCRIPTIONS-ONLY.txt
if exist "%DESC_ONLY_FILE%" (
    set DESC_ONLY_FLAG=--descriptions-only
    echo  MODE: DESCRIPTIONS-ONLY ^(patching descriptions only^)
    echo.
)

:: -- Find the CSV file in DROP-HERE ------------------------
set CSV_FILE=
set CSV_PATH=
for %%f in ("%DROP_DIR%\*.csv") do (
    set CSV_FILE=%%~nxf
    set CSV_PATH=%%~f
)

:: -- Find the ZIP file in DROP-HERE ------------------------
set ZIP_FILE=
set ZIP_PATH=
for %%f in ("%DROP_DIR%\*.zip") do (
    set ZIP_FILE=%%~nxf
    set ZIP_PATH=%%~f
)

:: -- Read the START URL from START-URL.txt -----------------
set START_URL=
set URL_PATH=%DROP_DIR%\START-URL.txt
if exist "%URL_PATH%" (
    for /f "usebackq tokens=* delims=" %%L in ("%URL_PATH%") do (
        set LINE=%%L
        :: Skip comment/instruction lines (those that don't start with http)
        if "!LINE:~0,4!"=="http" (
            set START_URL=!LINE!
        )
    )
)

:: -- Check we found all three required items ---------------
if "%CSV_FILE%"=="" (
    echo  ERROR: No CSV file found in DROP-HERE.
    echo.
    echo  Drop your CSV ^(from Vendor-Zen-Tool^) into:
    echo  %DROP_DIR%
    echo.
    echo  Opening DROP-HERE now...
    explorer "%DROP_DIR%"
    pause
    exit /b 1
)

if "%ZIP_FILE%"=="" (
    echo  ERROR: No ZIP file found in DROP-HERE.
    echo.
    echo  Drop your image ZIP into:
    echo  %DROP_DIR%
    echo.
    echo  Opening DROP-HERE now...
    explorer "%DROP_DIR%"
    pause
    exit /b 1
)

if "%START_URL%"=="" (
    echo  ERROR: No start URL found in START-URL.txt.
    echo.
    echo  Open the START-URL.txt file in DROP-HERE,
    echo  paste the first lot's URL ^(from DOA sub-admin^),
    echo  and save it. Then run this again.
    echo.
    echo  Opening DROP-HERE now...
    explorer "%DROP_DIR%"
    pause
    exit /b 1
)

:: -- Check .env has login credentials ----------------------
if not exist "%AGENT_DIR%.env" (
    echo  ERROR: No .env file found.
    echo.
    echo  Create a .env file in the doa-listing-agent folder:
    echo    DOA_EMAIL=your-email@example.com
    echo    DOA_PASSWORD=your-password
    echo.
    echo  ^(DOA_FIRST_LOT_URL is no longer needed in .env --
    echo   it is read from DROP-HERE\START-URL.txt instead^)
    echo.
    pause
    exit /b 1
)

:: -- Show what we found ------------------------------------
echo  Found CSV:  %CSV_FILE%
echo  Found ZIP:  %ZIP_FILE%
echo  Start URL:  %START_URL%
if not "%DESC_ONLY_FLAG%"=="" (
    echo  Mode:       DESCRIPTIONS-ONLY
)
echo.
echo  Starting agent... Chrome will open automatically.
echo  Do NOT click inside the browser window while it runs.
echo.
echo  ====================================================
echo.

:: -- Copy files to agent root for processing ---------------
copy /Y "%CSV_PATH%" "%AGENT_DIR%%CSV_FILE%" >nul
copy /Y "%ZIP_PATH%" "%AGENT_DIR%%ZIP_FILE%" >nul

:: -- Run the agent -----------------------------------------
cd /d "%AGENT_DIR%"
node agent.js --csv "%CSV_FILE%" --zip "%ZIP_FILE%" --url "%START_URL%" --force %DESC_ONLY_FLAG%
set AGENT_EXIT=%ERRORLEVEL%

:: -- Clean up copied files from agent root -----------------
del /f /q "%AGENT_DIR%%CSV_FILE%" >nul 2>&1
del /f /q "%AGENT_DIR%%ZIP_FILE%" >nul 2>&1

:: -- Archive or report -------------------------------------
echo.
if %AGENT_EXIT% EQU 0 (
    echo  ====================================================
    echo   All lots completed successfully!
    echo  ====================================================
    echo.
    echo  Moving files to archive...

    :: Create timestamped archive subfolder using PowerShell (wmic removed in Win11)
    for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmm"') do set TIMESTAMP=%%T
    set ARCHIVE_SUBDIR=%ARCHIVE_DIR%\%TIMESTAMP%
    mkdir "%ARCHIVE_SUBDIR%" >nul 2>&1

    move /Y "%CSV_PATH%"  "%ARCHIVE_SUBDIR%\" >nul
    move /Y "%ZIP_PATH%"  "%ARCHIVE_SUBDIR%\" >nul

    :: Remove the DESCRIPTIONS-ONLY flag file if present
    if exist "%DESC_ONLY_FILE%" del /f /q "%DESC_ONLY_FILE%" >nul 2>&1

    :: Reset START-URL.txt to template for next batch
    (
        echo PASTE YOUR FIRST LOT URL BELOW THIS LINE -- DELETE THIS LINE FIRST
        echo https://denveronlineauctions.com/sub-admin/EditAuction?id=XXXXXXX^&PartyId=115
    ) > "%URL_PATH%"

    echo  Archived to: archive\%TIMESTAMP%\
    echo.
    echo  DROP-HERE is reset and ready for the next batch.
    echo  Just drop in new files and update START-URL.txt.
) else (
    echo  ====================================================
    echo   Some lots failed. Check the output above.
    echo   Files left in DROP-HERE -- re-run to retry.
    echo   Completed lots are skipped automatically.
    echo  ====================================================
)
echo.
pause
