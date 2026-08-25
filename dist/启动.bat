@echo off
setlocal
set PORT=3000
set OPEN_BROWSER=1
echo Starting lianji server...
"%~dp0node.exe" "%~dp0server\index.js"
pause
