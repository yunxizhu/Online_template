@echo off
setlocal
REM ============================================================
REM  Fix-DNS.bat  (run as Administrator)
REM  The default DNS 114.114.114.114 sometimes fails to resolve
REM  *.trycloudflare.com, which makes joining rooms report
REM  "websocket error". This switches the active adapter to
REM  AliDNS (223.5.5.5) + DNSPod (119.29.29.29), which resolve
REM  these names correctly.
REM ============================================================

net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Please right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)

for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric,InterfaceMetric | Select-Object -First 1).InterfaceAlias"`) do set "IFACE=%%a"
if "%IFACE%"=="" set "IFACE=WLAN"

echo [INFO] Applying static DNS to adapter: %IFACE%
netsh interface ip set dns name="%IFACE%" static 223.5.5.5
if errorlevel 1 goto :fail
netsh interface ip add dns name="%IFACE%" 119.29.29.29 index=2
ipconfig /flushdns >nul

echo.
echo [OK] DNS is now 223.5.5.5 + 119.29.29.29
echo [OK] FULLY CLOSE your browser, reopen it, then retry joining the room.
echo.
echo [RESTORE] To go back to router DHCP DNS later, run:
echo     netsh interface ip set dns name="%IFACE%" dhcp
pause
exit /b 0

:fail
echo [ERROR] Failed to set DNS. Check the adapter name with: ipconfig /all
pause
exit /b 1