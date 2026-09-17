@echo off
setlocal EnableExtensions
cd /d "%~dp0"

call "%~dp0_ensure-deps.bat"
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
set "LIANJI_UPDATE_RESTART="

echo Checking port %PORT% ...
call :free_listen %PORT%

:run
echo Starting http://localhost:%PORT% ...
if defined LIANJI_UPDATE_RESTART (
  set "OPEN_BROWSER="
)
call npm start
if exist "%~dp0.update\restart.flag" (
  del /f /q "%~dp0.update\restart.flag" >nul 2>nul
  set "LIANJI_UPDATE_RESTART=1"
  echo.
  echo [update] restarting after OTA...
  timeout /t 1 /nobreak >nul
  call :free_listen %PORT%
  goto run
)

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
