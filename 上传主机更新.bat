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
echo   Scans Windows green-pack content:
echo     server/ public/ docs/ package.json
echo     scripts/check-host-update.js
echo     启动.bat / 本机多开测试.bat / _start-one.bat / README.txt
echo   (skips node_modules, node.exe, .tools)
echo   Uploads new blobs to Gitee branch "ota"
echo   Updates host-update.json for other hosts
echo   Notes are saved to public/changelog.json (merged with remote history)
echo   and shipped via OTA so every host shows the same announcements
echo   After push: download-check only NEWLY uploaded blobs
echo     (catches HTTP 451 content blocks before users upgrade)
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
echo Running publish (+ post-upload download verify)...
echo   Upload log will list each changed file path.
call node scripts\publish-host-update.js
echo.
if errorlevel 1 (
  echo Publish or download verify failed.
  echo Tip: fix blocked files, then re-run; or test only with:
  echo   node scripts\publish-host-update.js --verify-only
  pause
  exit /b 1
)
echo Done. Publish + download verify passed.
pause
exit /b 0
