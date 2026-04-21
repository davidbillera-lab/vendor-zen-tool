@echo off
:: eBay CSV Agent — Task Scheduler version (no pause, exits cleanly)
cd /d "%~dp0doa-listing-agent\ebay-agent"
node agent.js >> "%~dp0doa-listing-agent\ebay-agent\logs\scheduler.log" 2>&1
