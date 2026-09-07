@echo off
:: 安装两大依赖：Node.js 18+、解压 .tools\cloudflared.rar
:: 双击运行；也可由启动脚本以  setup.bat /nopause  自动调用。
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ================================
echo   联机大厅 · 依赖安装
echo ================================
echo.
echo   将处理以下依赖（已存在则跳过）：
echo     1. Node.js 18+     下载到 .tools\node（无需管理员）
echo     2. cloudflared.exe 解压自 .tools\cloudflared.rar
echo.

echo -------- [1/2] Node.js --------
call "%~dp0_ensure-node.bat"
if errorlevel 1 goto FAIL

echo.
echo -------- [2/2] cloudflared --------
if exist "%~dp0.tools\cloudflared.exe" (
  echo [setup] 已存在 .tools\cloudflared.exe，跳过解压
  goto DONE
)

if not exist "%~dp0.tools\cloudflared.rar" (
  echo [ERROR] 缺少 .tools\cloudflared.rar，无法解压 cloudflared.exe
  echo         请把 cloudflared.rar 放到 .tools 目录后重新运行 setup.bat
  goto FAIL
)

echo [setup] 正在解压 .tools\cloudflared.rar ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_extract-cloudflared.ps1"
if errorlevel 1 goto FAIL

if not exist "%~dp0.tools\cloudflared.exe" (
  echo [ERROR] 解压完成但仍未找到 .tools\cloudflared.exe
  goto FAIL
)
echo [setup] cloudflared.exe 已就绪

:DONE
echo.
echo ================================
echo   依赖安装完成，可以启动了
echo ================================
echo.
if /i "%~1"=="/nopause" goto EXIT_OK
pause
:EXIT_OK
endlocal & set "PATH=%PATH%" & exit /b 0

:FAIL
echo.
echo [ERROR] 依赖安装失败，无法启动。
echo.
if /i not "%~1"=="/nopause" pause
endlocal
exit /b 1
