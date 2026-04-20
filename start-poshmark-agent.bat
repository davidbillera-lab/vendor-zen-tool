@echo off
cd /d "%~dp0"
echo Starting Poshmark agent...
node doa-listing-agent/poshmark-agent/agent.js
pause
