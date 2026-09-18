'use strict';

/**
 * Windows 绿版启动脚本 / README（打包与 OTA 共用，保证内容一致）。
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = '39200';
const PACK_SUFFIX = 'carastan';

/** OTA / 打包都会带上的根目录启动相关文件 */
const PACK_LAUNCHER_FILES = [
  '启动.bat',
  '_start-one.bat',
  '本机多开测试.bat',
  'README.txt',
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeUtf8(file, text) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text, { encoding: 'utf8' });
}

function buildStartBat(nodeExeName = 'node.exe', port = DEFAULT_PORT) {
  return (
    '@echo off\r\n' +
    'setlocal\r\n' +
    'cd /d "%~dp0"\r\n' +
    `set PORT=${port}\r\n` +
    'set OPEN_BROWSER=1\r\n' +
    'set LIANJI_UPDATE_RESTART=\r\n' +
    `if not exist "%~dp0${nodeExeName}" (\r\n` +
    `  echo [ERROR] missing ${nodeExeName}\r\n` +
    '  pause\r\n' +
    '  exit /b 1\r\n' +
    ')\r\n' +
    'echo.\r\n' +
    'echo [update] 启动前检查并自动升级（无需确认）...\r\n' +
    `if exist "%~dp0scripts\\check-host-update.js" (\r\n` +
    `  "%~dp0${nodeExeName}" "%~dp0scripts\\check-host-update.js"\r\n` +
    ')\r\n' +
    'echo.\r\n' +
    'echo [update] 启动中...\r\n' +
    ':run\r\n' +
    `"%~dp0${nodeExeName}" "%~dp0server\\index.js"\r\n` +
    'if exist "%~dp0.update\\restart.flag" (\r\n' +
    '  del /f /q "%~dp0.update\\restart.flag" >nul 2>nul\r\n' +
    '  set OPEN_BROWSER=\r\n' +
    '  set LIANJI_UPDATE_RESTART=1\r\n' +
    '  echo.\r\n' +
    '  echo [update] 升级后重启中...\r\n' +
    '  timeout /t 1 /nobreak >nul\r\n' +
    '  goto run\r\n' +
    ')\r\n' +
    'echo.\r\n' +
    'pause\r\n'
  );
}

function buildStartOneBat(nodeExeName = 'node.exe', port = DEFAULT_PORT) {
  return (
    '@echo off\r\n' +
    'setlocal\r\n' +
    'cd /d "%~dp0"\r\n' +
    'set "PORT=%~1"\r\n' +
    `if "%PORT%"=="" set "PORT=${port}"\r\n` +
    'set "OPEN_BROWSER=1"\r\n' +
    `if not exist "%~dp0${nodeExeName}" (\r\n` +
    `  echo [ERROR] missing ${nodeExeName}\r\n` +
    '  pause\r\n' +
    '  exit /b 1\r\n' +
    ')\r\n' +
    'echo [lianji] PORT=%PORT%\r\n' +
    `"%~dp0${nodeExeName}" "%~dp0server\\index.js"\r\n` +
    'echo.\r\n' +
    'pause\r\n'
  );
}

function buildMultiInstanceBat(port = DEFAULT_PORT, nodeExeName = 'node.exe') {
  return (
    '@echo off\r\n' +
    'cd /d "%~dp0"\r\n' +
    '\r\n' +
    `if not exist "%~dp0${nodeExeName}" (\r\n` +
    `  echo [ERROR] missing ${nodeExeName}\r\n` +
    '  pause\r\n' +
    '  exit /b 1\r\n' +
    ')\r\n' +
    'if not exist "%~dp0_start-one.bat" (\r\n' +
    '  echo [ERROR] missing _start-one.bat\r\n' +
    '  pause\r\n' +
    '  exit /b 1\r\n' +
    ')\r\n' +
    '\r\n' +
    'echo.\r\n' +
    'echo ==============================\r\n' +
    'echo   Lianji multi-instance\r\n' +
    `echo   Ports start at ${port}\r\n` +
    'echo ==============================\r\n' +
    'echo.\r\n' +
    'set "COUNT="\r\n' +
    'set /p "COUNT=How many instances? (2-8): "\r\n' +
    '\r\n' +
    'if "%COUNT%"=="" (\r\n' +
    '  echo Empty input.\r\n' +
    '  pause\r\n' +
    '  exit /b 1\r\n' +
    ')\r\n' +
    '\r\n' +
    'echo %COUNT%| findstr /R "^[2-8]$" >nul\r\n' +
    'if errorlevel 1 (\r\n' +
    '  echo Invalid number. Please enter 2 to 8.\r\n' +
    '  pause\r\n' +
    '  exit /b 1\r\n' +
    ')\r\n' +
    '\r\n' +
    'echo.\r\n' +
    'echo [update] 多开前检查并自动升级（仅一次）...\r\n' +
    `if exist "%~dp0scripts\\check-host-update.js" (\r\n` +
    `  "%~dp0${nodeExeName}" "%~dp0scripts\\check-host-update.js"\r\n` +
    ')\r\n' +
    '\r\n' +
    `set /a BASE_PORT=${port}\r\n` +
    'set /a LAST=%BASE_PORT%+%COUNT%-1\r\n' +
    '\r\n' +
    'echo.\r\n' +
    'echo Starting %COUNT% instances on ports %BASE_PORT%-%LAST% ...\r\n' +
    'echo.\r\n' +
    '\r\n' +
    'set /a i=0\r\n' +
    ':loop\r\n' +
    'if %i% geq %COUNT% goto done\r\n' +
    'set /a PORT=%BASE_PORT%+%i%\r\n' +
    'call :free_listen %PORT%\r\n' +
    'start "lianji-%PORT%" cmd /k "cd /d %~dp0& call _start-one.bat %PORT%"\r\n' +
    'echo   [%i%] http://localhost:%PORT%\r\n' +
    'set /a i+=1\r\n' +
    'if %i% lss %COUNT% timeout /t 1 /nobreak >nul\r\n' +
    'goto loop\r\n' +
    '\r\n' +
    ':done\r\n' +
    'echo.\r\n' +
    'echo Opened %COUNT% windows. Close each black window to stop that instance.\r\n' +
    'pause\r\n' +
    'exit /b 0\r\n' +
    '\r\n' +
    ':free_listen\r\n' +
    'set "_p=%~1"\r\n' +
    'for /f "tokens=5" %%a in (\'netstat -ano ^| findstr /R /C:":%_p% .*LISTENING"\') do (\r\n' +
    '  echo Port %_p% LISTENING by PID %%a, killing...\r\n' +
    '  taskkill /F /PID %%a >nul 2>nul\r\n' +
    ')\r\n' +
    'timeout /t 1 /nobreak >nul\r\n' +
    'exit /b 0\r\n'
  );
}

function buildWindowsReadme({
  nodeExeName = 'node.exe',
  version = '0.0.0',
  port = DEFAULT_PORT,
  suffix = PACK_SUFFIX,
} = {}) {
  return (
    '联机大厅 · Windows 绿色版\n' +
    '========================\n' +
    `版本 ${version}（${suffix}）\n\n` +
    '不需要安装 Node.js，双击即可运行。\n\n' +
    '用法\n' +
    '----\n' +
    '1. 双击「启动.bat」\n' +
    `2. 浏览器打开 http://localhost:${port}\n` +
    '3. 建房后把公网地址发给朋友，或让对方用安卓 App / 浏览器加入\n\n' +
    '本机多开（测联机）\n' +
    '--------------\n' +
    '双击「本机多开测试.bat」，按提示输入 2～8；会先检查并自动升级（仅一次），再从端口 ' +
    `${port} 起依次开多个实例（各开一个黑窗口）。\n` +
    '关闭对应黑窗口即停止该实例。\n\n' +
    '目录\n' +
    '----\n' +
    `- ${nodeExeName}  Node 运行时\n` +
    '- server/       服务端\n' +
    '- public/       前端\n' +
    '- node_modules/ 依赖\n' +
    '- .tools/       Cloudflare 隧道（cloudflared.exe）\n' +
    '- 启动.bat      一键启动（支持 OTA 后自动重启）\n' +
    '- 本机多开测试.bat  本机多端口多开\n' +
    '- _start-one.bat    多开时单实例启动（一般不用手点）\n' +
    '\n' +
    '主机差分更新（默认 Gitee）\n' +
    '--------\n' +
    '双击启动时会在命令行自动检查并升级，完成后打开客户端。\n' +
    '也可在菜单点「检查更新」手动升级。\n' +
    '禁用：在目录下放 update.off\n' +
    '自定义清单地址：update.url（一行 URL）\n' +
    '默认：https://raw.giteeusercontent.com/xiyunzhu/online_template/raw/ota/host-update.json\n'
  );
}

/**
 * 写入绿版根目录启动相关文件。
 * @returns {string[]} 写入的相对路径
 */
function writeWindowsPackLaunchers(destDir, opts = {}) {
  const nodeExeName = opts.nodeExeName || 'node.exe';
  const port = opts.port || DEFAULT_PORT;
  const version = opts.version || '0.0.0';
  const suffix = opts.suffix || PACK_SUFFIX;

  writeUtf8(path.join(destDir, '启动.bat'), buildStartBat(nodeExeName, port));
  writeUtf8(
    path.join(destDir, '_start-one.bat'),
    buildStartOneBat(nodeExeName, port)
  );
  writeUtf8(
    path.join(destDir, '本机多开测试.bat'),
    buildMultiInstanceBat(port, nodeExeName)
  );
  writeUtf8(
    path.join(destDir, 'README.txt'),
    buildWindowsReadme({ nodeExeName, version, port, suffix })
  );
  return PACK_LAUNCHER_FILES.slice();
}

module.exports = {
  DEFAULT_PORT,
  PACK_SUFFIX,
  PACK_LAUNCHER_FILES,
  buildStartBat,
  buildStartOneBat,
  buildMultiInstanceBat,
  buildWindowsReadme,
  writeWindowsPackLaunchers,
};
