@echo off
setlocal EnableExtensions
cd /d "%~dp0"

call "%~dp0_ensure-deps.bat"
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Publish Windows host OTA (Gitee)
echo ========================================
echo.
echo   Scans server/ + public/ + package.json
echo   Uploads new blobs to Gitee branch "ota"
echo   Updates host-update.json for other hosts
echo.
echo   Need remote "gitee" with push permission:
echo     git remote add gitee https://gitee.com/yunxizhu/Online_template.git
echo.

set "LIANJI_OTA_NOTES="
set /p LIANJI_OTA_NOTES=Update notes (optional): 

set "LIANJI_OTA_BUMP="
set /p LIANJI_OTA_BUMP=Bump version? empty=no, or patch/minor/major: 

echo.
echo Running publish...
call node scripts\publish-host-update.js
echo.
if errorlevel 1 (
  echo Publish failed.
  pause
  exit /b 1
)
echo Done.
pause
exit /b 0
