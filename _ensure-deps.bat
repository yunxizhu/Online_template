@echo off
:: 启动前检查 Node.js 与 .tools\cloudflared.exe；缺失则自动运行 setup.bat。
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo [lianji] 正在检查依赖（Node.js / cloudflared.exe）...

call :refresh_path

set "NEED_SETUP="

call :node_ok
if errorlevel 1 (
  echo [lianji] 未找到 Node.js 18+，需要安装
  set "NEED_SETUP=1"
) else (
  for /f "delims=" %%v in ('node -v 2^>nul') do echo [lianji] Node.js %%v  已就绪
)

if exist "%~dp0.tools\cloudflared.exe" (
  echo [lianji] .tools\cloudflared.exe  已就绪
) else (
  echo [lianji] 未找到 .tools\cloudflared.exe，需要解压
  set "NEED_SETUP=1"
)

if not defined NEED_SETUP goto READY

echo.
echo [lianji] 缺少依赖，正在运行 setup.bat（下载 / 解压）...
echo.
call "%~dp0setup.bat" /nopause
if errorlevel 1 goto FAIL

call :refresh_path
call :node_ok
if errorlevel 1 (
  echo [ERROR] setup 结束后仍无法使用 Node.js
  goto FAIL
)
if not exist "%~dp0.tools\cloudflared.exe" (
  echo [ERROR] setup 结束后仍未找到 .tools\cloudflared.exe
  goto FAIL
)

echo.
echo [lianji] 依赖已就绪，开始启动...
goto READY

:READY
endlocal & set "PATH=%PATH%" & exit /b 0

:FAIL
echo [ERROR] 依赖未就绪，已取消启动。
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
