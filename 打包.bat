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
echo      - Gradle cache: project .gradle-home (~500MB+)
echo.
echo   5  Windows pure client only
echo      - Rebuild dist\client-windows (www + start.bat)
echo      - Local server http://127.0.0.1:39199 (keep cmd window open)
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
set "NEED_ANDROID="
echo %CHOICE%| findstr "1" >nul
if not errorlevel 1 (
  echo [Pack] will run: windows mac android client-windows client-mac
  set "NEED_ANDROID=1"
  goto AFTER_HINT
)
set "HINT="
echo %CHOICE%| findstr "2" >nul
if not errorlevel 1 set "HINT=%HINT% windows"
echo %CHOICE%| findstr "3" >nul
if not errorlevel 1 set "HINT=%HINT% mac"
echo %CHOICE%| findstr "4" >nul
if not errorlevel 1 (
  set "HINT=%HINT% android"
  set "NEED_ANDROID=1"
)
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

if not defined NEED_ANDROID goto AFTER_ANDROID_PREP
echo [Android] 编译加入端 APK -^> dist\android\lianji.apk
echo [Android] 若失败，请先释放 C 盘空间（Gradle 需约 500MB+）
echo.
set "GRADLE_USER_HOME=%~dp0.gradle-home"
if not exist "%GRADLE_USER_HOME%" mkdir "%GRADLE_USER_HOME%"
:AFTER_ANDROID_PREP

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
if errorlevel 1 goto FAIL

if not defined NEED_ANDROID goto SUCCESS
if not exist "dist\android\lianji.apk" (
  echo [ERROR] dist\android\lianji.apk 不存在
  goto FAIL
)
for %%F in ("dist\android\lianji.apk") do set SIZE=%%~zF
if %SIZE% LSS 1000000 (
  echo [ERROR] lianji.apk 过小 ^(%SIZE% bytes^)，可能不是有效安装包
  goto FAIL
)
echo OK: dist\android\lianji.apk ^(%SIZE% bytes^)
echo 请拷到手机「下载」目录后用文件管理安装，勿在微信里直接点。
echo.

:SUCCESS
echo Build succeeded.
pause
exit /b 0

:FAIL
echo Build failed.
pause
exit /b 1
