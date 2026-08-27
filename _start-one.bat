@echo off
cd /d "%~dp0"
call "%~dp0_ensure-node.bat"
if errorlevel 1 (
  pause
  exit /b 1
)
set "PORT=%~1"
if "%PORT%"=="" set "PORT=3000"
set "OPEN_BROWSER=1"
echo [lianji] PORT=%PORT%
call npm start
echo.
pause
