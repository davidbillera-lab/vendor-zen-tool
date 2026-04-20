@echo off
cd /d "%~dp0"
echo Starting Mercari agent...
node doa-listing-agent/mercari-agent/agent.js
pause
