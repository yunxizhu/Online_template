@echo off
setlocal EnableExtensions
cd /d "%~dp0"

call "%~dp0_ensure-node.bat"
if errorlevel 1 goto FAIL

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed
    goto FAIL
  )
)

if not exist "mqtt.off" (
  echo Cross-net: MQTT bulletin enabled by default. Create mqtt.off to force LAN only.
)

set "PORT=39200"
set "OPEN_BROWSER=1"

echo Checking port %PORT% ...
call :free_listen %PORT%

echo Starting http://localhost:%PORT% ...
call npm start
echo.
if errorlevel 1 echo Start failed
pause
exit /b 0

:FAIL
pause
exit /b 1

:free_listen
set "_p=%~1"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%_p% .*LISTENING"') do (
  echo Port %_p% LISTENING by PID %%a, killing...
  taskkill /F /PID %%a >nul 2>nul
)
timeout /t 1 /nobreak >nul
exit /b 0

