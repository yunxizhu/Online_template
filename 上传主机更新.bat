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
echo   Need remote "gitee" with push permission (SSH recommended):
echo     git remote add gitee git@gitee.com:xiyunzhu/online_template.git
echo   Or convert existing HTTPS remote:
echo     git remote set-url gitee git@gitee.com:xiyunzhu/online_template.git
echo.

set "LIANJI_OTA_NOTES="
set /p LIANJI_OTA_NOTES=Update notes (optional): 

set "LIANJI_OTA_BUMP=patch"
set /p LIANJI_OTA_BUMP=Bump version? [patch]/ empty=patch, or minor/major/no: 
if /I "%LIANJI_OTA_BUMP%"=="no" set "LIANJI_OTA_BUMP="

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
