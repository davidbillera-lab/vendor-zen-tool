@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: inspect-form.bat — Run ONCE before your first production batch
:: Opens the DOA lot form and prints all field names so you can verify
:: the agent is targeting the right inputs.
:: ─────────────────────────────────────────────────────────────────────────────

setlocal
cd /d "%~dp0"

echo.
echo  DOA Form Inspector
echo  ─────────────────────────────────────────────────────────────
echo  Run this once before your first batch to verify the agent
echo  is targeting the correct form fields on DOA.
echo  ─────────────────────────────────────────────────────────────
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js is not installed. Get it from https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  Installing dependencies first...
    call npm install
)

node inspect-form.js

echo.
pause
