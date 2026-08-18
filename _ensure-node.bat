@echo off
:: Ensure Node.js >= 18 is available on PATH for this session.
:: If missing/too old: download official LTS zip into .tools\node (no admin).
setlocal EnableExtensions
cd /d "%~dp0"

call :refresh_path
call :node_ok
if errorlevel 1 goto INSTALL
goto READY

:INSTALL
echo.
echo [lianji] Node.js ^>=18 not found. Downloading LTS...
echo          Target: "%~dp0.tools\node"
echo          (no admin required; first run may take 1-2 min)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_install-node.ps1" -TargetDir "%~dp0.tools\node"
if errorlevel 1 goto FAIL_INSTALL

call :refresh_path
call :node_ok
if errorlevel 1 goto FAIL_VERIFY

:READY
for /f "delims=" %%v in ('node -v 2^>nul') do echo [lianji] Node.js %%v ready
:: Export PATH to caller (must not be inside parentheses)
endlocal & set "PATH=%PATH%" & exit /b 0

:FAIL_INSTALL
echo.
echo [ERROR] Auto-install failed. Install manually: https://nodejs.org/
endlocal
exit /b 1

:FAIL_VERIFY
echo [ERROR] Install finished but node still unavailable. Re-open this window or install from https://nodejs.org/
endlocal
exit /b 1

:refresh_path
if exist "%~dp0.tools\node\node.exe" (
  set "PATH=%~dp0.tools\node;%PATH%"
)
exit /b 0

:node_ok
where node >nul 2>nul
if errorlevel 1 exit /b 1
node -e "process.exit(Number(process.versions.node.split('.')[0])>=18?0:1)" 2>nul
exit /b %ERRORLEVEL%
