@echo off
setlocal enabledelayedexpansion
title EstateSales - Captions Only

rem ============================================================
rem  Use this when the PHOTOS ARE ALREADY UPLOADED and only the
rem  descriptions are missing.
rem
rem  It scrapes the DOA grid for titles, skips uploading entirely,
rem  and fills in each picture's description on EstateSales.
rem
rem  Why a separate launcher: local runs have the dedup ledger
rem  disabled, so re-running the normal agent would upload every
rem  photo a SECOND time.
rem ============================================================

set AGENT_DIR=%~dp0
set ENV_NAME=.estatesales-test.env

echo.
echo  ================================================
echo    EstateSales - Captions Only
echo  ================================================
echo.
echo  For a sale whose photos are ALREADY on EstateSales.
echo  Nothing is uploaded; only descriptions are filled in.
echo.

if not exist "%AGENT_DIR%test-local.js" (
    echo  ERROR: test-local.js not found in %AGENT_DIR%
    echo.
    pause
    exit /b 1
)
if not exist "%AGENT_DIR%%ENV_NAME%" (
    echo  ERROR: %ENV_NAME% not found in %AGENT_DIR%
    echo.
    pause
    exit /b 1
)

set "DOA_URL="
set "ESTATESALES_URL="
set /p "DOA_URL=Paste DOA public auction URL: "
echo.
set /p "ESTATESALES_URL=Paste estatesales.net pictures page URL: "
echo.

if "!DOA_URL!"=="" (
    echo  ERROR: No DOA auction URL entered.
    echo.
    pause
    exit /b 1
)
if "!ESTATESALES_URL!"=="" (
    echo  ERROR: No estatesales.net URL entered.
    echo.
    pause
    exit /b 1
)

rem Same guard as the main launcher: this reads the public grid, not admin.
set "URL_CHECK=!DOA_URL!"
if not "!URL_CHECK!"=="!URL_CHECK:EditAuction=!" goto :bad_url
if not "!URL_CHECK!"=="!URL_CHECK:editauction=!" goto :bad_url
if "!URL_CHECK!"=="!URL_CHECK:/auction/=!" goto :bad_url
goto :url_ok

:bad_url
echo  ERROR: That is not the public DOA auction page.
echo    https://denveronlineauctions.com/auction/^<auction-slug^>
echo.
pause
exit /b 1

:url_ok

echo  DOA auction:  !DOA_URL!
echo  ES pictures:  !ESTATESALES_URL!
echo  Mode:         CAPTIONS ONLY - no photos will be uploaded
echo.
echo  Titles are applied in grid order, so the photos on ES must be
echo  the ones this auction uploaded. An existing description is
echo  never overwritten.
echo.
echo  Starting... Chrome will open. Do NOT click inside it.
echo.
echo  ================================================
echo.

cd /d "%AGENT_DIR%"
set CAPTION_ONLY=true
set MAX_LOTS=0
node test-local.js
set AGENT_EXIT=!ERRORLEVEL!

echo.
if !AGENT_EXIT! EQU 0 (
    echo  ================================================
    echo    Captions finished.
    echo  ================================================
) else (
    echo  ================================================
    echo    Exited with error code !AGENT_EXIT!
    echo    Scroll up; screenshots are in: screenshots\
    echo  ================================================
)
echo.
pause
