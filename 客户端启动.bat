@echo off
setlocal EnableExtensions
cd /d "%~dp0"

call "%~dp0_ensure-node.bat"
if errorlevel 1 goto FAIL

if not exist "mobile\www\index.html" (
  echo [ERROR] missing mobile\www\index.html
  goto FAIL
)

set "PORT=39199"
set "OPEN_BROWSER=1"

echo Checking port %PORT% ...
call :free_listen %PORT%

echo Starting client http://127.0.0.1:%PORT%/ ...
echo Close this window to stop the client server.
echo.
node scripts\client-static-server.js
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
