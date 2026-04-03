@echo off
setlocal enabledelayedexpansion
title DOA Listing Agent

:: ============================================================
::  DOA Listing Agent -- Drop Folder Launcher
::
::  HOW TO USE EVERY TIME:
::    1. Drop your CSV file into the DROP-HERE folder
::    2. Drop your image ZIP file into the DROP-HERE folder
::    3. Double-click this file (or the desktop shortcut)
::
::  The agent finds the files automatically, runs, and moves
::  completed files to the archive folder when done.
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

:: -- Check we found both files ----------------------------
if "%CSV_FILE%"=="" (
    echo  ERROR: No CSV file found in the DROP-HERE folder.
    echo.
    echo  Steps:
    echo    1. Open the DROP-HERE folder ^(button below^)
    echo    2. Drop in your CSV from Vendor-Zen-Tool
    echo    3. Run this again
    echo.
    echo  Opening DROP-HERE folder now...
    explorer "%DROP_DIR%"
    pause
    exit /b 1
)

if "%ZIP_FILE%"=="" (
    echo  ERROR: No ZIP file found in the DROP-HERE folder.
    echo.
    echo  Steps:
    echo    1. Open the DROP-HERE folder ^(opening now^)
    echo    2. Drop in your image ZIP file
    echo    3. Run this again
    echo.
    echo  Opening DROP-HERE folder now...
    explorer "%DROP_DIR%"
    pause
    exit /b 1
)

:: -- Check .env has credentials ---------------------------
if not exist "%AGENT_DIR%.env" (
    echo  ERROR: No .env file found.
    echo.
    echo  Please create a .env file in the doa-listing-agent
    echo  folder with:
    echo    DOA_EMAIL=your-email@example.com
    echo    DOA_PASSWORD=your-password
    echo    DOA_FIRST_LOT_URL=https://denveronlineauctions.com/...
    echo.
    pause
    exit /b 1
)

:: -- Show what we found -----------------------------------
echo  Found CSV:  %CSV_FILE%
echo  Found ZIP:  %ZIP_FILE%
echo.
echo  Starting agent... Chrome will open automatically.
echo  Do NOT click inside the browser window while it runs.
echo.
echo  ====================================================
echo.

:: -- Copy files to agent root for processing --------------
copy /Y "%CSV_PATH%" "%AGENT_DIR%%CSV_FILE%" >nul
copy /Y "%ZIP_PATH%" "%AGENT_DIR%%ZIP_FILE%" >nul

:: -- Run the agent ----------------------------------------
cd /d "%AGENT_DIR%"
node agent.js --csv "%CSV_FILE%" --zip "%ZIP_FILE%" --force
set AGENT_EXIT=%ERRORLEVEL%

:: -- Clean up copied files from agent root ----------------
del /f /q "%AGENT_DIR%%CSV_FILE%" >nul 2>&1
del /f /q "%AGENT_DIR%%ZIP_FILE%" >nul 2>&1

:: -- Archive or report ------------------------------------
echo.
if %AGENT_EXIT% EQU 0 (
    echo  ====================================================
    echo   All lots completed successfully!
    echo  ====================================================
    echo.
    echo  Moving files to archive...

    :: Create timestamped archive subfolder
    for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set DATESTR=%%c-%%a-%%b
    for /f "tokens=1-2 delims=: " %%a in ('time /t') do set TIMESTR=%%a%%b
    set ARCHIVE_SUBDIR=%ARCHIVE_DIR%\%DATESTR%_%TIMESTR%
    mkdir "%ARCHIVE_SUBDIR%" >nul 2>&1

    move /Y "%CSV_PATH%" "%ARCHIVE_SUBDIR%\" >nul
    move /Y "%ZIP_PATH%" "%ARCHIVE_SUBDIR%\" >nul

    echo  Archived to: archive\%DATESTR%_%TIMESTR%\
    echo.
    echo  DROP-HERE is now empty and ready for the next batch.
) else (
    echo  ====================================================
    echo   Some lots failed. Check the output above.
    echo   Files left in DROP-HERE -- re-run to retry.
    echo   Completed lots are skipped automatically.
    echo  ====================================================
)
echo.
pause
