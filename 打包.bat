@echo off
echo [Pack] Building portable package...
node scripts/package.js node20-win-x64
echo.
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
echo Build succeeded. Check dist/ and dist.zip .
explorer dist
pause
