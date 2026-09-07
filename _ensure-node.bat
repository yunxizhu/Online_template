@echo off
:: Ensure Node.js >= 18 is available on PATH for this session.
:: If missing/too old: download official LTS zip into .tools\node (no admin).
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

call :refresh_path
call :node_ok
if errorlevel 1 goto INSTALL
goto READY

:INSTALL
echo.
echo [lianji] 未找到 Node.js 18+，开始下载官方 LTS...
echo          安装目录: "%~dp0.tools\node"
echo          （无需管理员权限，首次大约 1–2 分钟）
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_install-node.ps1" -TargetDir "%~dp0.tools\node"
if errorlevel 1 goto FAIL_INSTALL

call :refresh_path
call :node_ok
if errorlevel 1 goto FAIL_VERIFY

:READY
for /f "delims=" %%v in ('node -v 2^>nul') do echo [lianji] Node.js %%v 已安装
:: Export PATH to caller (must not be inside parentheses)
endlocal & set "PATH=%PATH%" & exit /b 0

:FAIL_INSTALL
echo.
echo [ERROR] Node.js 自动安装失败。请手动安装: https://nodejs.org/
endlocal
exit /b 1

:FAIL_VERIFY
echo [ERROR] 安装结束但仍无法使用 node。请重新打开本窗口，或从 https://nodejs.org/ 安装
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
