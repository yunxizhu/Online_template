@echo off
setlocal EnableExtensions
cd /d "%~dp0"

call "%~dp0_ensure-deps.bat"
if errorlevel 1 (
  pause
  exit /b 1
)

for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "PACK_VER=%%V"
if "%PACK_VER%"=="" set "PACK_VER=1.0.1"
set "PACK_SUFFIX=carastan"
set "DIR_WIN=dist\%PACK_VER%-windows-%PACK_SUFFIX%"
set "DIR_ANDROID=dist\%PACK_VER%-android-%PACK_SUFFIX%"
set "DIR_CLIENT=dist\%PACK_VER%-client-windows-%PACK_SUFFIX%"
set "APK_NAME=%PACK_VER%-lianji-%PACK_SUFFIX%.apk"
set "APK_PATH=%DIR_ANDROID%\%APK_NAME%"

echo.
echo ================================
echo   LianJi pack menu
echo   version %PACK_VER%  suffix %PACK_SUFFIX%
echo ================================
echo.
echo   1  All packs
echo      - %DIR_WIN%         host (Node + start.bat)
echo      - %DIR_ANDROID%         APK join client
echo      - %DIR_CLIENT%  lightweight PC client (no Node)
echo.
echo   2  Windows host only
echo      - Rebuild %DIR_WIN% (can create rooms)
echo.
echo   3  Android APK only
echo      - Rebuild APK into %APK_PATH%
echo      - Gradle cache: project .gradle-home (~500MB+)
echo.
echo   4  Windows pure client only
echo      - Rebuild %DIR_CLIENT% (www + start.bat)
echo      - Local server http://127.0.0.1:39199 (keep cmd window open)
echo      - Join host over MQTT / room code / URL
echo.
echo   Tip: combine, e.g. 24 = Windows host + Win client
echo ================================
echo.
set "CHOICE="
set /p CHOICE=Enter choice (default 1): 
if "%CHOICE%"=="" set "CHOICE=1"

echo.
echo [Pack] choice=%CHOICE% version=%PACK_VER%
set "NEED_ANDROID="
echo %CHOICE%| findstr "1" >nul
if not errorlevel 1 (
  echo [Pack] will run: windows android client-windows
  set "NEED_ANDROID=1"
  goto AFTER_HINT
)
set "HINT="
echo %CHOICE%| findstr "2" >nul
if not errorlevel 1 set "HINT=%HINT% windows"
echo %CHOICE%| findstr "3" >nul
if not errorlevel 1 (
  set "HINT=%HINT% android"
  set "NEED_ANDROID=1"
)
echo %CHOICE%| findstr "4" >nul
if not errorlevel 1 set "HINT=%HINT% client-windows"
if defined HINT (
  echo [Pack] will run:%HINT%
) else (
  echo [Pack] invalid choice, script will exit
)
:AFTER_HINT
echo.

if not defined NEED_ANDROID goto AFTER_ANDROID_PREP
echo [Android] 编译加入端 APK -^> %APK_PATH%
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
if not exist "%APK_PATH%" (
  echo [ERROR] %APK_PATH% 不存在
  goto FAIL
)
for %%F in ("%APK_PATH%") do set SIZE=%%~zF
if %SIZE% LSS 1000000 (
  echo [ERROR] %APK_NAME% 过小 ^(%SIZE% bytes^)，可能不是有效安装包
  goto FAIL
)
echo OK: %APK_PATH% ^(%SIZE% bytes^)
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
