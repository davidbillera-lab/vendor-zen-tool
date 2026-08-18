@echo off
setlocal enabledelayedexpansion
title EstateSales Upload Agent -- Make Distribution Zip

:: ============================================================
::  Builds a clean zip of this folder to send to a colleague.
::
::  Double-click it. The zip lands on your Desktop as
::    estatesales-agent-YYYYMMDD.zip
::  (or pass a folder as the first argument to put it elsewhere).
::
::  It EXCLUDES everything private or machine-specific:
::    .estatesales-test.env / .env (passwords), .chrome-profile
::    (your signed-in session), es-session.json / es-cookies.json,
::    node_modules, screenshots, downloaded-images, logs, run
::    outputs, David's local probe/diagnosis files.
::  It then re-opens the zip and REFUSES to finish if any of
::  those made it in. Do not hand-zip this folder -- use this.
:: ============================================================

set AGENT_DIR=%~dp0
set AGENT_DIR=%AGENT_DIR:~0,-1%
set OUT_DIR=%~1
if "%OUT_DIR%"=="" set OUT_DIR=%USERPROFILE%\Desktop
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set STAMP=%%T
set STAGE_ROOT=%TEMP%\es-dist-%RANDOM%
set STAGE=%STAGE_ROOT%\estatesales-agent
set ZIP=%OUT_DIR%\estatesales-agent-%STAMP%.zip

echo.
echo  Staging a clean copy...
mkdir "%STAGE%" >nul 2>&1

:: robocopy: /E all subdirs, /XD exclude dirs, /XF exclude files. Exit codes < 8 = success.
robocopy "%AGENT_DIR%" "%STAGE%" /E /NFL /NDL /NJH /NJS /NP ^
  /XD node_modules .chrome-profile screenshots downloaded-images logs .git ^
  /XF .estatesales-test.env .env es-session.json es-cookies.json ^
      *.log *.out *.zip *.lnk *.local ^
      LOGIN-DIAGNOSIS.md probe-editor-dom.mjs probe-editor-dialog.mjs ^
      capture-session.js convert-cookies.js verify-session.js
if errorlevel 8 (
    echo  ERROR: copying files failed ^(robocopy exit %ERRORLEVEL%^).
    rmdir /s /q "%STAGE_ROOT%" >nul 2>&1
    pause
    exit /b 1
)

:: Belt and braces: the staged copy must not contain a login file or profile.
if exist "%STAGE%\.estatesales-test.env" goto :leak
if exist "%STAGE%\.env"                  goto :leak
if exist "%STAGE%\.chrome-profile"       goto :leak
goto :zipit
:leak
echo  ERROR: private file/folder found in the staged copy -- refusing to build the zip.
rmdir /s /q "%STAGE_ROOT%" >nul 2>&1
pause
exit /b 1

:zipit
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

:: Re-open the finished zip and refuse if any private entry is inside.
:: Fails CLOSED: unreadable zip, suspiciously few files, or any private entry = exit 1.
powershell -NoProfile -Command ^
  "$ErrorActionPreference='Stop';" ^
  "try {" ^
  "  Add-Type -AssemblyName System.IO.Compression.FileSystem;" ^
  "  $z=[IO.Compression.ZipFile]::OpenRead('%ZIP%');" ^
  "  $names=@($z.Entries | ForEach-Object { $_.FullName }); $z.Dispose();" ^
  "} catch { Write-Host ('  ERROR: could not read the zip: ' + $_.Exception.Message); exit 1 }" ^
  "$bad=@($names | Where-Object { $_ -match '(^|[\\/])\.estatesales-test\.env$' -or $_ -match '(^|[\\/])\.env$' -or $_ -match '[\\/]\.chrome-profile[\\/]' -or $_ -match '(^|[\\/])es-(session|cookies)\.json$' -or $_ -match '[\\/]node_modules[\\/]' -or $_ -match '[\\/](screenshots|downloaded-images|logs)[\\/]' -or $_ -like '*.log' -or $_ -like '*.out' });" ^
  "if ($bad.Count -gt 0) { Write-Host ('  ERROR: private files inside the zip: ' + ($bad -join ', ')); exit 1 }" ^
  "if ($names.Count -lt 8) { Write-Host ('  ERROR: only ' + $names.Count + ' files in the zip -- something went wrong staging.'); exit 1 }" ^
  "Write-Host ('  Verified: ' + $names.Count + ' files, no login file / profile / session / node_modules / screenshots.'); exit 0"
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
echo   ^(it's inside the zip too^). They unzip it, double-click
echo   SETUP.bat once, then SIGN-IN-ONCE.bat once.
echo  ====================================================
echo.
pause
