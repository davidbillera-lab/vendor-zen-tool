@echo off
setlocal enabledelayedexpansion
title DOA Listing Agent

:: ============================================================
::  DOA Listing Agent -- Drop Folder Launcher
::  
::  HOW TO USE:
::    1. Drop your CSV file into this folder
::    2. Drop your image ZIP file into this folder
::    3. Double-click this file
::
::  That's it. The agent finds the files automatically.
:: ============================================================

:: -- Find the CSV file in this folder -------------------------
set CSV_FILE=
for %%f in ("%~dp0*.csv") do (
    if /i not "%%~nxf"==".env.example" (
        set CSV_FILE=%%~nxf
    )
)

:: -- Find the ZIP file in this folder -------------------------
set ZIP_FILE=
for %%f in ("%~dp0*.zip") do (
    set ZIP_FILE=%%~nxf
)

:: -- Check we found both files --------------------------------
echo.
echo  ====================================================
echo   DOA Listing Agent
echo  ====================================================
echo.

if "%CSV_FILE%"=="" (
    echo  ERROR: No CSV file found in this folder.
    echo.
    echo  Please drop your CSV file ^(from Vendor-Zen-Tool^)
    echo  into this folder and try again.
    echo.
    pause
    exit /b 1
)

if "%ZIP_FILE%"=="" (
    echo  ERROR: No ZIP file found in this folder.
    echo.
    echo  Please drop your image ZIP file into this folder
    echo  and try again.
    echo.
    pause
    exit /b 1
)

:: -- Check .env has credentials --------------------------------
if not exist "%~dp0.env" (
    echo  ERROR: No .env file found.
    echo.
    echo  Please create a .env file in this folder with:
    echo    DOA_EMAIL=your-email@example.com
    echo    DOA_PASSWORD=your-password
    echo    DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=...
    echo.
    pause
    exit /b 1
)

:: -- Show what we found ----------------------------------------
echo  Found CSV:  %CSV_FILE%
echo  Found ZIP:  %ZIP_FILE%
echo.
echo  Starting agent... Chrome will open automatically.
echo  Do NOT click inside the browser window while it runs.
echo.
echo  ====================================================
echo.

:: -- Run the agent --------------------------------------------
cd /d "%~dp0"
node agent.js --csv "%CSV_FILE%" --zip "%ZIP_FILE%" --force

:: -- Done -----------------------------------------------------
echo.
if %ERRORLEVEL% EQU 0 (
    echo  ====================================================
    echo   All lots completed successfully!
    echo  ====================================================
) else (
    echo  ====================================================
    echo   Some lots failed. Check the output above.
    echo   Re-run this file -- completed lots are skipped.
    echo  ====================================================
)
echo.
pause
