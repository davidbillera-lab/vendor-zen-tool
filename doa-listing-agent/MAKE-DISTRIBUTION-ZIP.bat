@echo off
setlocal enabledelayedexpansion
title DOA Listing Agent -- Make Distribution Zip

:: ============================================================
::  Builds a clean zip of this folder to send to a colleague.
::
::  Double-click it. The zip lands on your Desktop as
::    doa-listing-agent-YYYYMMDD.zip
::  (or pass a folder as the first argument to put it elsewhere).
::
::  It EXCLUDES everything private or machine-specific:
::    .env (your password), node_modules, logs, temp, archive,
::    screenshots, ebay-agent, real CSV/ZIP/progress files,
::    shortcuts. DROP-HERE ships empty with a fresh START-URL.txt.
::  It then re-opens the zip and REFUSES to finish if a .env
::  somehow made it in. Do not hand-zip this folder -- use this.
:: ============================================================

set AGENT_DIR=%~dp0
set AGENT_DIR=%AGENT_DIR:~0,-1%
set OUT_DIR=%~1
if "%OUT_DIR%"=="" set OUT_DIR=%USERPROFILE%\Desktop
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set STAMP=%%T
set STAGE_ROOT=%TEMP%\doa-dist-%RANDOM%
set STAGE=%STAGE_ROOT%\doa-listing-agent
set ZIP=%OUT_DIR%\doa-listing-agent-%STAMP%.zip

echo.
echo  Staging a clean copy...
mkdir "%STAGE%" >nul 2>&1

:: robocopy: /E all subdirs, /XD exclude dirs, /XF exclude files. Exit codes < 8 = success.
robocopy "%AGENT_DIR%" "%STAGE%" /E /NFL /NDL /NJH /NJS /NP ^
  /XD node_modules logs temp archive screenshots ebay-agent .git ^
  /XF .env *.zip *.ZIP *.progress.json *.lnk *.log *.out ^
      "denver-auctions-*.csv" *.local
if errorlevel 8 (
    echo  ERROR: copying files failed ^(robocopy exit %ERRORLEVEL%^).
    rmdir /s /q "%STAGE_ROOT%" >nul 2>&1
    pause
    exit /b 1
)

:: Ship every non-sample CSV out; keep sample-lots.csv as the format example.
for %%f in ("%STAGE%\*.csv") do if /i not "%%~nxf"=="sample-lots.csv" del /f /q "%%~f"

:: DROP-HERE ships empty except for a fresh instruction-only START-URL.txt.
if exist "%STAGE%\DROP-HERE" rmdir /s /q "%STAGE%\DROP-HERE"
mkdir "%STAGE%\DROP-HERE"
(echo PASTE YOUR FIRST LOT URL BELOW THIS LINE -- DELETE THIS LINE FIRST) > "%STAGE%\DROP-HERE\START-URL.txt"
mkdir "%STAGE%\archive" >nul 2>&1

:: Belt and braces: the staged copy must not contain a .env.
if exist "%STAGE%\.env" (
    echo  ERROR: .env found in the staged copy -- refusing to build the zip.
    rmdir /s /q "%STAGE_ROOT%" >nul 2>&1
    pause
    exit /b 1
)

echo  Zipping...
if exist "%ZIP%" del /f /q "%ZIP%"
powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%' -DestinationPath '%ZIP%' -CompressionLevel Optimal"
if errorlevel 1 (
    echo  ERROR: zip failed.
    rmdir /s /q "%STAGE_ROOT%" >nul 2>&1
    pause
    exit /b 1
)
rmdir /s /q "%STAGE_ROOT%" >nul 2>&1

:: Re-open the finished zip and refuse if any entry is a .env or a real data file.
:: Fails CLOSED: unreadable zip, suspiciously few files, or any private entry = exit 1.
powershell -NoProfile -Command ^
  "$ErrorActionPreference='Stop';" ^
  "try {" ^
  "  Add-Type -AssemblyName System.IO.Compression.FileSystem;" ^
  "  $z=[IO.Compression.ZipFile]::OpenRead('%ZIP%');" ^
  "  $names=@($z.Entries | ForEach-Object { $_.FullName }); $z.Dispose();" ^
  "} catch { Write-Host ('  ERROR: could not read the zip: ' + $_.Exception.Message); exit 1 }" ^
  "$bad=@($names | Where-Object { $_ -match '(^|[\\/])\.env$' -or $_ -match '[\\/]node_modules[\\/]' -or $_ -like '*.progress.json' -or $_ -match '[\\/]denver-auctions-[^\\/]*\.csv$' -or $_ -match '[\\/]logs[\\/]' });" ^
  "if ($bad.Count -gt 0) { Write-Host ('  ERROR: private files inside the zip: ' + ($bad -join ', ')); exit 1 }" ^
  "if ($names.Count -lt 15) { Write-Host ('  ERROR: only ' + $names.Count + ' files in the zip -- something went wrong staging.'); exit 1 }" ^
  "Write-Host ('  Verified: ' + $names.Count + ' files, no .env / node_modules / logs / real data.'); exit 0"
if errorlevel 1 (
    del /f /q "%ZIP%" >nul 2>&1
    echo  The zip was deleted. Send David a screenshot of this window.
    pause
    exit /b 1
)

echo.
echo  ====================================================
echo   Done:  %ZIP%
echo.
echo   Send this zip to your colleague along with SETUP-GUIDE.txt
echo   ^(it's inside the zip too^). They unzip it, then double-click
echo   SETUP.bat once.
echo  ====================================================
echo.
pause
