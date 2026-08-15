@echo off
setlocal enabledelayedexpansion
title EstateSales Photo Upload Agent

rem ============================================================
rem  EstateSales.net Photo Upload Agent -- local launcher
rem
rem  Lives in the repo on purpose: a launcher parked on the
rem  desktop dies with the next machine reset. Put a SHORTCUT
rem  to this file on the desktop instead of a copy.
rem
rem  Entry point is test-local.js, NOT agent.js. agent.js refuses
rem  to start without a JOB_ID from the Supabase job runner --
rem  that guard stops it writing orphaned rows into the production
rem  dedup ledger. test-local.js is the supported local path: it
rem  injects a fake JOB_ID and sets AGENT_TEST_MODE=true.
rem
rem  Neither script takes command-line arguments -- everything is
rem  read from the environment, which is why the prompts below are
rem  exported as env vars. Real env vars win over the env file.
rem ============================================================

set AGENT_DIR=%~dp0
set ENV_NAME=.estatesales-test.env

echo.
echo  ================================================
echo    EstateSales Photo Upload Agent - JSG Liquidators
echo  ================================================
echo.

if not exist "%AGENT_DIR%test-local.js" (
    echo  ERROR: test-local.js not found in:
    echo    %AGENT_DIR%
    echo.
    pause
    exit /b 1
)

if not exist "%AGENT_DIR%agent.js" (
    echo  ERROR: agent.js not found in:
    echo    %AGENT_DIR%
    echo.
    pause
    exit /b 1
)

if not exist "%AGENT_DIR%%ENV_NAME%" (
    echo  ERROR: credentials file not found:
    echo    %AGENT_DIR%%ENV_NAME%
    echo.
    echo  Copy .estatesales-test.env.example to %ENV_NAME%
    echo  and fill in your DOA + EstateSales logins.
    echo.
    pause
    exit /b 1
)

if not exist "%AGENT_DIR%node_modules" (
    echo  ERROR: node_modules missing. Run this once in:
    echo    %AGENT_DIR%
    echo      npm install
    echo.
    pause
    exit /b 1
)

echo  DOA URL must be the PUBLIC auction page - the grid of lots:
echo    https://denveronlineauctions.com/auction/^<auction-slug^>
echo.
echo  NOT an admin sub-admin/EditAuction link. The agent reads the public
echo  grid, needs no DOA login, and never writes to DOA.
echo.

set "DOA_URL="
set "ESTATESALES_URL="
set /p "DOA_URL=Paste DOA first-lot admin URL: "
echo.
set /p "ESTATESALES_URL=Paste estatesales.net listing editor URL: "
echo.

if "!DOA_URL!"=="" (
    echo  ERROR: No DOA auction URL entered.
    echo.
    pause
    exit /b 1
)

rem Reject an admin EditAuction link. The agent reads the public grid; an admin
rem URL has no grid to read and would scrape nothing.
rem Substring test, NOT `echo !VAR! | findstr`: piping spawns a child cmd that
rem re-parses the line, and the & in a DOA URL splits it there.
set "URL_CHECK=!DOA_URL!"
if not "!URL_CHECK!"=="!URL_CHECK:EditAuction=!" goto :bad_url
if not "!URL_CHECK!"=="!URL_CHECK:editauction=!" goto :bad_url
if "!URL_CHECK!"=="!URL_CHECK:/auction/=!" goto :bad_url
goto :url_ok

:bad_url
echo  ERROR: That is not the public DOA auction page.
echo.
echo  You pasted:
echo    !DOA_URL!
echo.
echo  Open the auction on denveronlineauctions.com as a normal visitor --
echo  the page showing the grid of all lots -- and copy the address bar:
echo    https://denveronlineauctions.com/auction/^<auction-slug^>
echo.
echo  An admin sub-admin/EditAuction link is a single lot's edit form. It
echo  has no grid, so the agent would find nothing to upload.
echo.
pause
exit /b 1

:url_ok

if "!ESTATESALES_URL!"=="" (
    echo  ERROR: No estatesales.net listing URL entered.
    echo.
    pause
    exit /b 1
)

echo.
echo  How many lots should the agent upload?
echo    2  = quick smoke test  ^(recommended for a first run^)
echo    0  = ALL lots in the sale
echo.
set "MAX_LOTS="
set /p "MAX_LOTS=Number of lots [2]: "
if "!MAX_LOTS!"=="" set "MAX_LOTS=2"

rem Reject typos -- a stray letter would parse to 0 and silently upload EVERY lot
echo !MAX_LOTS!| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 (
    echo.
    echo  ERROR: "!MAX_LOTS!" is not a number. Enter 2, 0, or a lot count.
    echo.
    pause
    exit /b 1
)

echo.
rem !VAR! not %VAR% -- the ampersands in these URLs would split the echo command
echo  DOA auction:  !DOA_URL!
echo  ES listing:   !ESTATESALES_URL!
if "!MAX_LOTS!"=="0" (
    echo  Lots:         ALL
) else (
    echo  Lots:         !MAX_LOTS!
)
echo.
echo  NOTE: local runs have the dedup ledger DISABLED. Photos upload
echo        for real, but re-running will upload them again. Do one
echo        clean pass rather than repeated retries.
echo.
echo  Starting agent... Chrome will open automatically.
echo  Do NOT click inside the browser window while it runs.
echo.
echo  ================================================
echo.

cd /d "%AGENT_DIR%"
node test-local.js
set AGENT_EXIT=!ERRORLEVEL!

echo.
if !AGENT_EXIT! EQU 0 (
    echo  ================================================
    echo    Agent finished successfully.
    echo  ================================================
) else (
    echo  ================================================
    echo    Agent exited with error code !AGENT_EXIT!
    echo    Scroll up for the failure. Screenshots of the
    echo    browser at failure are in: screenshots\
    echo  ================================================
)
echo.
pause
