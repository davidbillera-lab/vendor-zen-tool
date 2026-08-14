@echo off
setlocal enabledelayedexpansion
title DOA Listing Agent

:: ============================================================
::  DOA Listing Agent -- Drop Folder Launcher
::
::  NORMAL RUN (every auction):
::    1. Drop your CSV and image ZIP into DROP-HERE
::    2. Paste the first lot URL into START-URL.txt
::    3. Double-click this file
::
::  DESCRIPTIONS-ONLY (patch a previous run):
::    1. Drop the SAME CSV and ZIP back into DROP-HERE
::    2. Paste the first lot URL into START-URL.txt
::    3. Create an empty file called DESCRIPTIONS-ONLY.txt
::       in DROP-HERE  (right-click -> New -> Text Document,
::       name it DESCRIPTIONS-ONLY.txt)
::    4. Double-click this file
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

:: -- Read the START URL from START-URL.txt -----------------
set START_URL=
set URL_PATH=%DROP_DIR%\START-URL.txt
if exist "%URL_PATH%" (
    rem tokens=* with default delims strips leading spaces/tabs from a pasted URL
    for /f "usebackq tokens=*" %%L in ("%URL_PATH%") do (
        set LINE=%%L
        if "!LINE:~0,4!"=="http" set START_URL=!LINE!
    )
)

:: -- Check we found all three required items ---------------
if "%CSV_FILE%"=="" (
    echo  ERROR: No CSV file found in DROP-HERE.
    echo  Drop your CSV into: %DROP_DIR%
    echo.
    pause
    explorer "%DROP_DIR%"
    exit /b 1
)

if "%ZIP_FILE%"=="" (
    echo  ERROR: No ZIP file found in DROP-HERE.
    echo  Drop your image ZIP into: %DROP_DIR%
    echo.
    pause
    explorer "%DROP_DIR%"
    exit /b 1
)

if "%START_URL%"=="" (
    echo  ERROR: No start URL found in START-URL.txt.
    echo  Open START-URL.txt in DROP-HERE and paste the first lot URL.
    echo.
    pause
    explorer "%DROP_DIR%"
    exit /b 1
)

:: -- Check .env has login credentials ----------------------
if not exist "%AGENT_DIR%.env" (
    echo  ERROR: No .env file found.
    echo  Create doa-listing-agent\.env with:
    echo    DOA_EMAIL=your-email@example.com
    echo    DOA_PASSWORD=your-password
    echo.
    pause
    exit /b 1
)

:: -- Check for DESCRIPTIONS-ONLY flag AFTER showing files --
:: (Checked here so user can see what was found first)
set DESC_ONLY_FLAG=
set DESC_ONLY_FILE=%DROP_DIR%\DESCRIPTIONS-ONLY.txt
if exist "%DESC_ONLY_FILE%" (
    set DESC_ONLY_FLAG=--descriptions-only
)

:: -- Show what we found ------------------------------------
echo  Found CSV:  %CSV_FILE%
echo  Found ZIP:  %ZIP_FILE%
rem !START_URL! not %START_URL% -- the & in the URL would split the echo command
echo  Start URL:  !START_URL!
if not "%DESC_ONLY_FLAG%"=="" (
    echo  Mode:       DESCRIPTIONS-ONLY  ^(patching descriptions only^)
) else (
    echo  Mode:       FULL RUN
)
echo.
echo  Starting agent... Chrome will open automatically.
echo  Do NOT click inside the browser window while it runs.
echo.
echo  ====================================================
echo.

:: -- Copy CSV + ZIP + progress file to agent root ----------
copy /Y "%CSV_PATH%" "%AGENT_DIR%%CSV_FILE%" >nul

:: Copy the .progress.json sidecar if it exists (enables skip-completed on rerun)
set PROGRESS_PATH=%DROP_DIR%\%CSV_FILE:.csv=%.progress.json
if exist "%PROGRESS_PATH%" (
    copy /Y "%PROGRESS_PATH%" "%AGENT_DIR%%CSV_FILE:.csv=%.progress.json" >nul
)

copy /Y "%ZIP_PATH%" "%AGENT_DIR%%ZIP_FILE%" >nul

:: -- Run the agent -----------------------------------------
cd /d "%AGENT_DIR%"
node agent.js --csv "%CSV_FILE%" --zip "%ZIP_FILE%" --url "%START_URL%" --force %DESC_ONLY_FLAG%
set AGENT_EXIT=%ERRORLEVEL%

:: -- Copy progress file back to DROP-HERE (so reruns work) -
set AGENT_PROGRESS=%AGENT_DIR%%CSV_FILE:.csv=%.progress.json
if exist "%AGENT_PROGRESS%" (
    copy /Y "%AGENT_PROGRESS%" "%DROP_DIR%\" >nul
)

:: -- Clean up copied files from agent root -----------------
del /f /q "%AGENT_DIR%%CSV_FILE%" >nul 2>&1
del /f /q "%AGENT_DIR%%ZIP_FILE%" >nul 2>&1
del /f /q "%AGENT_PROGRESS%" >nul 2>&1

:: -- Archive on success or report failure ------------------
echo.
if %AGENT_EXIT% EQU 0 (
    echo  ====================================================
    echo   All lots completed successfully!
    echo  ====================================================
    echo.
    echo  Moving files to archive...

    for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmm"') do set TIMESTAMP=%%T
    set ARCHIVE_SUBDIR=%ARCHIVE_DIR%\!TIMESTAMP!
    mkdir "!ARCHIVE_SUBDIR!" >nul 2>&1

    move /Y "%CSV_PATH%"  "!ARCHIVE_SUBDIR!\" >nul
    move /Y "%ZIP_PATH%"  "!ARCHIVE_SUBDIR!\" >nul
    if exist "%PROGRESS_PATH%" move /Y "%PROGRESS_PATH%" "!ARCHIVE_SUBDIR!\" >nul

    rem Remove DESCRIPTIONS-ONLY flag file if present
    if exist "%DESC_ONLY_FILE%" del /f /q "%DESC_ONLY_FILE%" >nul 2>&1

    rem Reset START-URL.txt -- instruction only, no placeholder URL.
    rem A placeholder starting with "http" passes validation and would
    rem drive the agent to a nonexistent auction on the next run.
    (echo PASTE YOUR FIRST LOT URL BELOW THIS LINE -- DELETE THIS LINE FIRST) > "%URL_PATH%"

    echo  Archived to: archive\!TIMESTAMP!\
    echo.
    echo  DROP-HERE is reset and ready for the next batch.
) else (
    echo  ====================================================
    echo   Some lots failed. Check the output above.
    echo   Files left in DROP-HERE -- re-run to retry.
    echo   Completed lots are skipped automatically.
    echo  ====================================================
)
echo.
pause
