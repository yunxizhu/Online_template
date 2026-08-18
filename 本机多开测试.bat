@echo off
cd /d "%~dp0"

call "%~dp0_ensure-node.bat"
if errorlevel 1 (
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed
    pause
    exit /b 1
  )
)

if not exist "%~dp0_start-one.bat" (
  echo [ERROR] missing _start-one.bat
  pause
  exit /b 1
)

echo.
echo ==============================
echo   Lianji multi-instance
echo   Ports start at 39200
echo ==============================
echo.
set "COUNT="
set /p "COUNT=How many instances? (2-8): "

if "%COUNT%"=="" (
  echo Empty input.
  pause
  exit /b 1
)

echo %COUNT%| findstr /R "^[2-8]$" >nul
if errorlevel 1 (
  echo Invalid number. Please enter 2 to 8.
  pause
  exit /b 1
)

set /a BASE_PORT=39200
set /a LAST=%BASE_PORT%+%COUNT%-1

echo.
echo Starting %COUNT% instances on ports %BASE_PORT%-%LAST% ...
echo.

set /a i=0
:loop
if %i% geq %COUNT% goto done
set /a PORT=%BASE_PORT%+%i%
call :free_listen %PORT%
start "lianji-%PORT%" cmd /k "cd /d %~dp0& call _start-one.bat %PORT%"
echo   [%i%] http://localhost:%PORT%
set /a i+=1
if %i% lss %COUNT% timeout /t 1 /nobreak >nul
goto loop

:done
echo.
echo Opened %COUNT% windows. Close each black window to stop that instance.
pause
exit /b 0

:free_listen
set "_p=%~1"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%_p% .*LISTENING"') do (
  echo Port %_p% LISTENING by PID %%a, killing...
  taskkill /F /PID %%a >nul 2>nul
)
timeout /t 1 /nobreak >nul
exit /b 0
