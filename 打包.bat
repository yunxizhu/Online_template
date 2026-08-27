@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ================================
echo   LianJi pack menu
echo ================================
echo.
echo   1  All packs
echo      - dist\windows         host (Node + start.bat)
echo      - dist\mac             host (deps + start.command)
echo      - dist\android         APK join client
echo      - dist\client-windows  lightweight PC client (no Node)
echo      - dist\client-mac      lightweight Mac client (no Node)
echo.
echo   2  Windows host only
echo      - Rebuild dist\windows (can create rooms)
echo.
echo   3  Mac host only
echo      - Rebuild dist\mac (can create rooms)
echo.
echo   4  Android APK only
echo      - Rebuild APK into dist\android\lianji.apk
echo.
echo   5  Windows pure client only
echo      - Rebuild dist\client-windows (www + start.bat only)
echo      - Open www\index.html in browser (no Node, ~few MB)
echo      - Join host over MQTT / room code / URL
echo.
echo   6  Mac pure client only
echo      - Rebuild dist\client-mac (www + start.command only)
echo      - Same join-only lobby as 5 (no Node)
echo.
echo   Tip: combine, e.g. 25 = Windows host + Win client
echo        56 = both pure clients
echo ================================
echo.
set "CHOICE="
set /p CHOICE=Enter choice (default 1): 
if "%CHOICE%"=="" set "CHOICE=1"

echo.
echo [Pack] choice=%CHOICE%
echo %CHOICE%| findstr "1" >nul
if not errorlevel 1 (
  echo [Pack] will run: windows mac android client-windows client-mac
  goto AFTER_HINT
)
set "HINT="
echo %CHOICE%| findstr "2" >nul
if not errorlevel 1 set "HINT=%HINT% windows"
echo %CHOICE%| findstr "3" >nul
if not errorlevel 1 set "HINT=%HINT% mac"
echo %CHOICE%| findstr "4" >nul
if not errorlevel 1 set "HINT=%HINT% android"
echo %CHOICE%| findstr "5" >nul
if not errorlevel 1 set "HINT=%HINT% client-windows"
echo %CHOICE%| findstr "6" >nul
if not errorlevel 1 set "HINT=%HINT% client-mac"
if defined HINT (
  echo [Pack] will run:%HINT%
) else (
  echo [Pack] invalid choice, script will exit
)
:AFTER_HINT
echo.

if not exist "node_modules\" (
  echo [Pack] Running npm install ...
  call npm install
  if errorlevel 1 (
    echo npm install failed
    pause
    exit /b 1
  )
)

call node scripts\package.js %CHOICE%
echo.
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo Build succeeded.
pause