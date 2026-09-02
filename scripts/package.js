'use strict';

/**
 * 一键打包 → dist/
 *   windows/         Windows 主机绿版（自带 node.exe，双击 启动.bat）
 *   mac/             macOS 主机分发包（需本机 Node ≥18）
 *   android/         安卓加入端 APK
 *   client-windows/  轻量纯客户端（仅 www + 启动.bat，无 Node）
 *   client-mac/      同上（Mac）
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tar = require('tar');
const {
  copyVendoredCloudflaredTo,
  vendoredCloudflaredFilesFor,
} = require('../server/tunnel');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const TOOLS_DIR = path.join(ROOT, '.tools');
const DIR_WIN = path.join(DIST, 'windows');
const DIR_MAC = path.join(DIST, 'mac');
const DIR_ANDROID = path.join(DIST, 'android');
const DIR_CLIENT_WIN = path.join(DIST, 'client-windows');
const DIR_CLIENT_MAC = path.join(DIST, 'client-mac');
const DEFAULT_PORT = '39200';
const CLIENT_DEFAULT_PORT = '39199';
const MOBILE_WWW = path.join(ROOT, 'mobile', 'www');

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cpDir(src, dst, opts = {}) {
  if (!fs.existsSync(src)) return;
  const skipNames = new Set(opts.skipNames || []);
  ensureDir(dst);
  for (const name of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipNames.has(name.name)) continue;
    const s = path.join(src, name.name);
    const d = path.join(dst, name.name);
    if (name.isDirectory()) {
      cpDir(s, d, opts);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function copyFile(src, dst) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  return true;
}

function getSizeMB(p) {
  try {
    return (fs.statSync(p).size / 1024 / 1024).toFixed(1);
  } catch {
    return '?';
  }
}

function removeFile(file) {
  if (!fs.existsSync(file)) return;
  fs.rmSync(file, { force: true });
}

async function archiveMacTarGz(sourceDir, outputName) {
  const outFile = path.join(DIST, outputName);
  const entryName = path.basename(sourceDir);
  console.log(`  打包 ${entryName} → ${outputName}（保留 Unix 执行权限）...`);
  await tar.create({
    gzip: true,
    file: outFile,
    cwd: DIST,
    portable: true,
    onWriteEntry(entry) {
      const name = (entry.path || '').replace(/\\/g, '/');
      if (name.endsWith('.command') || /\/\.tools\/cloudflared/.test(name)) {
        entry.stat.mode = 0o755;
      } else if (entry.type === 'Directory') {
        entry.stat.mode = 0o755;
      } else {
        entry.stat.mode = 0o644;
      }
    },
  }, [entryName]);
  console.log(`  => ${outputName} (${getSizeMB(outFile)} MB)`);
}

function writeUtf8(file, text) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text, { encoding: 'utf8' });
}

function writeMinimalPackageJson(destDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const minimal = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    main: pkg.main,
    scripts: {
      start: 'node server/index.js',
    },
    engines: pkg.engines || { node: '>=18' },
    dependencies: pkg.dependencies || {},
  };
  writeUtf8(path.join(destDir, 'package.json'), JSON.stringify(minimal, null, 2) + '\n');
}

function copyAppSources(destDir) {
  writeMinimalPackageJson(destDir);
  for (const dir of ['server', 'public', 'docs']) {
    const src = path.join(ROOT, dir);
    if (!fs.existsSync(src)) continue;
    cpDir(src, path.join(destDir, dir));
    console.log(`    ${dir}/`);
  }
  copyFile(path.join(ROOT, 'mqtt.channel'), path.join(destDir, 'mqtt.channel'));
  console.log('  copy node_modules...');
  cpDir(path.join(ROOT, 'node_modules'), path.join(destDir, 'node_modules'), {
    skipNames: ['.cache'],
  });
}

function bundleCloudflaredTools(destDir, platform) {
  const destTools = path.join(destDir, '.tools');
  const expected = vendoredCloudflaredFilesFor(platform);
  const copied = copyVendoredCloudflaredTo(destTools, {
    quiet: true,
    platform,
  });
  const missing = expected.filter((n) => !copied.includes(n));
  if (missing.length) {
    console.warn(
      '  warn: cloudflared 不完整，请在项目根执行 npm run fetch-cloudflared；缺少: ' +
        missing.join(', ')
    );
  } else {
    console.log('  .tools/ (' + copied.join(', ') + ')');
  }
}

function buildWindowsPack() {
  console.log('\n[windows] portable pack...');
  ensureDir(DIR_WIN);
  copyAppSources(DIR_WIN);

  const nodeExe = process.execPath;
  const nodeExeName = path.basename(nodeExe);
  if (process.platform !== 'win32') {
    console.warn(
      '  warn: 当前不是 Windows，无法打入本机 node.exe；windows 包请在 Windows 上打包'
    );
  } else {
    fs.copyFileSync(nodeExe, path.join(DIR_WIN, nodeExeName));
    console.log(`  ${nodeExeName} (${getSizeMB(nodeExe)} MB)`);
  }

  console.log('  bundle cloudflared...');
  bundleCloudflaredTools(DIR_WIN, 'win32');

  if (process.platform === 'win32') {
    writeWindowsLauncher(DIR_WIN, nodeExeName);
    writeUtf8(path.join(DIR_WIN, 'README.txt'), windowsReadme(nodeExeName));
    return Promise.resolve();
  }
  writeWindowsLauncher(DIR_WIN, 'node.exe');
  writeUtf8(path.join(DIR_WIN, 'README.txt'), windowsReadme('node.exe'));
  return Promise.resolve();
}

function writeWindowsLauncher(destDir, nodeExeName) {
  const bat =
    '@echo off\r\n' +
    'setlocal\r\n' +
    'cd /d "%~dp0"\r\n' +
    `set PORT=${DEFAULT_PORT}\r\n` +
    'set OPEN_BROWSER=1\r\n' +
    'echo Starting lianji server...\r\n' +
    `if not exist "%~dp0${nodeExeName}" (\r\n` +
    `  echo [ERROR] missing ${nodeExeName}\r\n` +
    '  pause\r\n' +
    '  exit /b 1\r\n' +
    ')\r\n' +
    `"%~dp0${nodeExeName}" "%~dp0server\\index.js"\r\n` +
    'echo.\r\n' +
    'pause\r\n';
  writeUtf8(path.join(destDir, '启动.bat'), bat);
}

function windowsReadme(nodeExeName) {
  return (
    '联机大厅 · Windows 绿色版\n' +
    '========================\n' +
    '不需要安装 Node.js，双击即可运行。\n\n' +
    '用法\n' +
    '----\n' +
    '1. 双击「启动.bat」\n' +
    `2. 浏览器打开 http://localhost:${DEFAULT_PORT}\n` +
    '3. 建房后把公网地址发给朋友，或让对方用安卓 App / 浏览器加入\n\n' +
    '目录\n' +
    '----\n' +
    `- ${nodeExeName}  Node 运行时\n` +
    '- server/       服务端\n' +
    '- public/       前端\n' +
    '- node_modules/ 依赖\n' +
    '- .tools/       Cloudflare 隧道（cloudflared.exe）\n' +
    '- 启动.bat      一键启动\n'
  );
}

async function buildMacPack() {
  console.log('\n[mac] portable pack...');
  ensureDir(DIR_MAC);
  copyAppSources(DIR_MAC);
  console.log('  bundle cloudflared...');
  bundleCloudflaredTools(DIR_MAC, 'darwin');

  const cmd = fs.readFileSync(path.join(ROOT, '启动.command'), 'utf8');
  writeUtf8(path.join(DIR_MAC, '启动.command'), cmd);
  writeUtf8(path.join(DIR_MAC, 'README.txt'), macReadme());
  console.log('  启动.command');

  await archiveMacTarGz(DIR_MAC, 'lianji-mac.tar.gz');
}

function macReadme() {
  return (
    '联机大厅 · macOS 分发包\n' +
    '======================\n' +
    '本包已含运行依赖。需要本机安装 Node.js 18+（官网或 brew install node）。\n\n' +
    '用法\n' +
    '----\n' +
    '1. 解压 lianji-mac.tar.gz，进入 mac/ 文件夹\n' +
    '2. 双击「启动.command」\n' +
    '3. 首次若提示“无法验证开发者”：\n' +
    '   · 前往“系统设置 → 隐私与安全性”点击“仍要打开”\n' +
    '   · 或按住 Control 键点击文件，选择“打开”\n' +
    '4. 之后可直接双击运行\n' +
    `5. 浏览器打开 http://localhost:${DEFAULT_PORT}\n\n` +
    '说明\n' +
    '----\n' +
    '· tar.gz 已保留文件执行权限，无需再执行 chmod +x\n' +
    '· .tools/ 已含 macOS 版 cloudflared（Intel + Apple Silicon）\n' +
    '- 建房仍在本机；手机请用 android 文件夹里的 APK 加入\n'
  );
}

function findExistingApk() {
  const candidates = [
    path.join(ROOT, 'mobile', 'dist', 'lianji-android.apk'),
    path.join(
      ROOT,
      'mobile',
      'android',
      'app',
      'build',
      'outputs',
      'apk',
      'release',
      'app-release.apk'
    ),
    path.join(ROOT, 'mobile', 'dist', 'lianji-android-debug.apk'),
    path.join(
      ROOT,
      'mobile',
      'android',
      'app',
      'build',
      'outputs',
      'apk',
      'debug',
      'app-debug.apk'
    ),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function buildAndroidApk() {
  const skip = String(process.env.SKIP_ANDROID_BUILD || '') === '1';
  if (skip) {
    const apk = findExistingApk();
    if (apk) {
      console.log(`  SKIP_ANDROID_BUILD=1, reuse: ${path.relative(ROOT, apk)}`);
      return apk;
    }
    console.warn('  SKIP_ANDROID_BUILD=1 and no APK found');
    return '';
  }

  if (process.platform !== 'win32') {
    const apk = findExistingApk();
    if (apk) {
      console.warn('  non-Windows: reuse existing APK');
      return apk;
    }
    console.warn('  skip APK build (please build on a machine with Android SDK)');
    return '';
  }

  const mobileDir = path.join(ROOT, 'mobile');
  const androidDir = path.join(mobileDir, 'android');
  const gradlew = path.join(androidDir, 'gradlew.bat');
  if (!fs.existsSync(gradlew)) {
    console.warn('  mobile/android 不存在，跳过 APK 编译');
    return '';
  }

  const env = { ...process.env };
  if (!env.JAVA_HOME) {
    const guess = 'D:\\androidtool';
    if (fs.existsSync(path.join(guess, 'bin', 'java.exe'))) {
      env.JAVA_HOME = guess;
    }
  }
  if (!env.ANDROID_HOME && env.LOCALAPPDATA) {
    const sdk = path.join(env.LOCALAPPDATA, 'Android', 'Sdk');
    if (fs.existsSync(sdk)) {
      env.ANDROID_HOME = sdk;
      env.ANDROID_SDK_ROOT = sdk;
    }
  }
  // Gradle 默认缓存到 C 盘用户目录，空间不足会导致 APK 编不出来；改到项目盘
  if (!env.GRADLE_USER_HOME) {
    env.GRADLE_USER_HOME = path.join(ROOT, '.gradle-home');
  }
  ensureDir(env.GRADLE_USER_HOME);
  // Java/Gradle 临时文件也改到 D 盘，避免 C 盘满导致「磁盘空间不足」
  const buildTmp = path.join(ROOT, '.build-tmp');
  ensureDir(buildTmp);
  env.TEMP = buildTmp;
  env.TMP = buildTmp;

  // 打包前：public/* → mobile/www，再 cap sync 进 android 工程
  console.log('  sync shared js → mobile/www...');
  const syncJs = spawnSync('npm', ['run', 'sync:js'], {
    cwd: mobileDir,
    env,
    stdio: 'inherit',
    shell: true,
  });
  if (syncJs.status !== 0) {
    throw new Error('[android] sync:js 失败，无法继续编译 APK');
  }

  console.log('  cap sync android...');
  const sync = spawnSync('npx', ['cap', 'sync', 'android'], {
    cwd: mobileDir,
    env,
    stdio: 'inherit',
    shell: true,
  });
  if (sync.status !== 0) {
    throw new Error('[android] cap sync 失败，无法继续编译 APK');
  }

  console.log('  gradle assembleRelease (signed)...');
  const r = spawnSync(
    'cmd',
    ['/c', 'gradlew.bat', 'assembleRelease', '--no-daemon'],
    {
      cwd: androidDir,
      env,
      stdio: 'inherit',
    }
  );
  if (r.status !== 0) {
    console.error('  APK build failed (gradle exit ' + r.status + ')');
    console.error(
      '  常见原因：C 盘或 Gradle 缓存盘空间不足。已尝试使用项目目录 .gradle-home'
    );
    return '';
  }

  const built = path.join(
    androidDir,
    'app',
    'build',
    'outputs',
    'apk',
    'release',
    'app-release.apk'
  );
  if (!fs.existsSync(built)) {
    console.error('  gradle 成功但未找到 app-release.apk');
    return '';
  }
  ensureDir(path.join(ROOT, 'mobile', 'dist'));
  const cached = path.join(ROOT, 'mobile', 'dist', 'lianji-android.apk');
  fs.copyFileSync(built, cached);
  console.log(`  rebuilt ${path.relative(ROOT, built)} (${getSizeMB(built)} MB)`);
  return built;
}

function buildAndroidPack() {
  console.log('\n[android] client APK...');
  ensureDir(DIR_ANDROID);
  const apk = buildAndroidApk();
  if (apk && fs.existsSync(apk)) {
    const dest = path.join(DIR_ANDROID, 'lianji.apk');
    fs.copyFileSync(apk, dest);
    console.log(`  lianji.apk (${getSizeMB(dest)} MB)`);
  } else {
    writeUtf8(path.join(DIR_ANDROID, '安装说明.txt'), androidReadme(false));
    throw new Error(
      '[android] 未生成 lianji.apk。请释放磁盘空间（尤其 C 盘）后运行 打包.bat 选 4，或 mobile 目录下 npm run build:apk'
    );
  }
  writeUtf8(path.join(DIR_ANDROID, '安装说明.txt'), androidReadme(true));
}

function copyClientWww(destWww) {
  // 打包前先把 public/ 的最新共享资源同步到 mobile/www（防止 i18n、游戏面板等遗漏）
  const syncJs = spawnSync('node', [path.join(ROOT, 'mobile', 'scripts', 'sync-shared-js.js')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (syncJs.status !== 0) {
    console.warn('  sync-shared-js.js failed, continuing with existing mobile/www');
  }

  if (!fs.existsSync(MOBILE_WWW)) {
    throw new Error('missing mobile/www');
  }
  if (!fs.existsSync(path.join(MOBILE_WWW, 'vendor', 'mqtt.min.js'))) {
    throw new Error('missing mobile/www/vendor/mqtt.min.js (run npm install in mobile/)');
  }
  if (!fs.existsSync(path.join(MOBILE_WWW, 'vendor', 'socket.io.min.js'))) {
    throw new Error(
      'missing mobile/www/vendor/socket.io.min.js (run: cd mobile && npm run sync:js)'
    );
  }
  if (!fs.existsSync(path.join(MOBILE_WWW, 'js', 'client.js'))) {
    throw new Error(
      'missing mobile/www/js/client.js (run: cd mobile && npm run sync:js)'
    );
  }
  if (!fs.existsSync(path.join(MOBILE_WWW, 'play.html'))) {
    throw new Error(
      'missing mobile/www/play.html (run: cd mobile && npm run sync:js)'
    );
  }
  if (!fs.existsSync(path.join(MOBILE_WWW, 'games-info.json'))) {
    throw new Error(
      'missing mobile/www/games-info.json (run: cd mobile && npm run sync:js)'
    );
  }
  if (!fs.existsSync(path.join(MOBILE_WWW, 'games', 'lasidao', 'panel.html'))) {
    throw new Error(
      'missing mobile/www/games (run: cd mobile && npm run sync:js)'
    );
  }
  rmDir(destWww);
  cpDir(MOBILE_WWW, destWww);
}

function copyClientStaticServer(destPath) {
  copyFile(path.join(ROOT, 'scripts', 'client-static-server.js'), destPath);
}

function writeClientWindowsLauncher(destDir) {
  const bat =
    '@echo off\r\n' +
    'setlocal EnableExtensions\r\n' +
    'cd /d "%~dp0"\r\n' +
    'call "%~dp0_ensure-node.bat"\r\n' +
    'if errorlevel 1 goto FAIL\r\n' +
    'if not exist "%~dp0www\\index.html" (\r\n' +
    '  echo [ERROR] missing www\\index.html\r\n' +
    '  goto FAIL\r\n' +
    ')\r\n' +
    `set "PORT=${CLIENT_DEFAULT_PORT}"\r\n` +
    'set "OPEN_BROWSER=1"\r\n' +
    'echo Checking port %PORT% ...\r\n' +
    'call :free_listen %PORT%\r\n' +
    'echo Starting client http://127.0.0.1:%PORT%/ ...\r\n' +
    'echo Close this window to stop the client server.\r\n' +
    'echo.\r\n' +
    'node "%~dp0client-server.js"\r\n' +
    'echo.\r\n' +
    'if errorlevel 1 echo Start failed\r\n' +
    'pause\r\n' +
    'exit /b 0\r\n' +
    '\r\n' +
    ':FAIL\r\n' +
    'pause\r\n' +
    'exit /b 1\r\n' +
    '\r\n' +
    ':free_listen\r\n' +
    'set "_p=%~1"\r\n' +
    'for /f "tokens=5" %%a in (\'netstat -ano ^| findstr /R /C:":%_p% .*LISTENING"\') do (\r\n' +
    '  echo Port %_p% LISTENING by PID %%a, killing...\r\n' +
    '  taskkill /F /PID %%a >nul 2>nul\r\n' +
    ')\r\n' +
    'timeout /t 1 /nobreak >nul\r\n' +
    'exit /b 0\r\n';
  writeUtf8(path.join(destDir, '启动.bat'), bat);
}

/** 轻量纯客户端：www + 本地静态服务（默认 39199，保留命令行窗口） */
function buildClientWindowsPack() {
  console.log('\n[client-windows] join client (local server)...');
  ensureDir(DIR_CLIENT_WIN);
  copyClientWww(path.join(DIR_CLIENT_WIN, 'www'));
  copyClientStaticServer(path.join(DIR_CLIENT_WIN, 'client-server.js'));
  copyFile(path.join(ROOT, '_ensure-node.bat'), path.join(DIR_CLIENT_WIN, '_ensure-node.bat'));
  copyFile(
    path.join(ROOT, '_install-node.ps1'),
    path.join(DIR_CLIENT_WIN, '_install-node.ps1')
  );
  writeClientWindowsLauncher(DIR_CLIENT_WIN);
  writeUtf8(
    path.join(DIR_CLIENT_WIN, 'README.txt'),
    '联机大厅 · Windows 纯客户端（轻量 / 仅加入）\n' +
      '==========================================\n' +
      '双击「启动.bat」在本机 http://127.0.0.1:' +
      CLIENT_DEFAULT_PORT +
      ' 打开加入端大厅（需 Node.js 18+，首次可自动下载）。\n' +
      '关闭黑色命令行窗口即停止服务。\n' +
      '不能创建房间；进房后从房主电脑加载游戏资源。\n'
  );
  console.log(`  启动.bat + www/ + client-server.js (port ${CLIENT_DEFAULT_PORT})`);
}

async function buildClientMacPack() {
  console.log('\n[client-mac] join client (local server)...');
  ensureDir(DIR_CLIENT_MAC);
  copyClientWww(path.join(DIR_CLIENT_MAC, 'www'));
  copyClientStaticServer(path.join(DIR_CLIENT_MAC, 'client-server.js'));

  const cmd =
    '#!/bin/bash\n' +
    'cd "$(dirname "$0")"\n' +
    'if [ ! -f "./www/index.html" ]; then\n' +
    '  echo "[ERROR] missing www/index.html"\n' +
    '  read -r -p "Press Enter..." _\n' +
    '  exit 1\n' +
    'fi\n' +
    'if ! command -v node >/dev/null 2>&1; then\n' +
    '  echo "[ERROR] Node.js 18+ required: https://nodejs.org/"\n' +
    '  read -r -p "Press Enter..." _\n' +
    '  exit 1\n' +
    'fi\n' +
    `export PORT="${CLIENT_DEFAULT_PORT}"\n` +
    'export OPEN_BROWSER=1\n' +
    'echo "[lianji-client] checking port ${PORT}..."\n' +
    'if command -v lsof >/dev/null 2>&1; then\n' +
    '  pids="$(lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null || true)"\n' +
    '  if [ -n "$pids" ]; then\n' +
    '    echo "[lianji-client] killing: ${pids}"\n' +
    '    kill -9 $pids 2>/dev/null || true\n' +
    '    sleep 1\n' +
    '  fi\n' +
    'fi\n' +
    'echo "[lianji-client] http://127.0.0.1:${PORT}/ (close window to stop)"\n' +
    'node "./client-server.js"\n' +
    'code=$?\n' +
    'echo\n' +
    'read -r -p "Press Enter..." _\n' +
    'exit "$code"\n';
  writeUtf8(path.join(DIR_CLIENT_MAC, '启动.command'), cmd);
  writeUtf8(
    path.join(DIR_CLIENT_MAC, 'README.txt'),
    '联机大厅 · macOS 纯客户端（轻量 / 仅加入）\n' +
      '========================================\n' +
      '需要 Node.js 18+。\n' +
      `双击「启动.command」在本机 http://127.0.0.1:${CLIENT_DEFAULT_PORT} 打开加入端大厅。\n` +
      '关闭终端窗口即停止服务。\n' +
      '首次若提示“无法验证开发者”：\n' +
      '  前往“系统设置 → 隐私与安全性”点击“仍要打开”\n' +
      '  或按住 Control 键点击文件，选择“打开”\n\n' +
      '不能创建房间；进房后从房主电脑加载游戏资源。\n'
  );
  console.log(`  启动.command + www/ + client-server.js (port ${CLIENT_DEFAULT_PORT})`);

  await archiveMacTarGz(DIR_CLIENT_MAC, 'lianji-client-mac.tar.gz');
}

function androidReadme(hasApk) {
  return (
    '联机大厅 · 安卓加入端\n' +
    '====================\n' +
    (hasApk
      ? '安装本目录的 lianji.apk（正式签名，包名 com.lianji.join）。\n\n'
      : '本目录暂无 APK。请在开发机执行：\n' +
        '  cd mobile && npx cap sync android\n' +
        '  cd android && gradlew.bat assembleRelease\n' +
        '然后重新运行打包。\n\n') +
    '用法\n' +
    '----\n' +
    '1. 把 APK 拷到手机「下载」或「文档」本地目录（不要在微信/网盘里直接点开装）\n' +
    '2. 手机允许安装未知来源应用\n' +
    '3. 用文件管理打开 APK 安装；桌面图标名「联机大厅」\n' +
    '4. 电脑先用 windows/ 或 mac/ 开房，手机再加入\n\n' +
    '若一直转圈「正在安装」且无法取消（华为机常见）\n' +
    '----------------------------------------------\n' +
    '1. 划掉安装界面；设置 → 应用 → 搜「软件包安装程序/应用安装器」→ 强行停止 → 清除缓存\n' +
    '2. 设置 → 应用，搜「联机大厅」以及旧包 com.lianji.client，有则卸载\n' +
    '3. 关闭「纯净模式 / 外部来源应用检查」后再装本包\n' +
    '4. 本包已换新包名 + 正式签名，与旧 debug 包互不覆盖，相当于全新安装\n\n' +
    '若提示「解析包出错」或文件很小（几 KB）\n' +
    '--------------------------------\n' +
    '说明 APK 未编译成功（常见：电脑 C 盘空间不足）。请在本机释放空间后重新运行 打包.bat 选 4，\n' +
    '确认 dist\\android\\lianji.apk 约 3MB 以上再拷到手机安装。\n\n' +
    '说明：手机端不能建房开服，只负责加入。\n'
  );
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    console.error('[ERROR] 请先在项目根目录执行 npm install');
    process.exit(1);
  }

  const choiceArg = process.argv.slice(2).join('') || '1';
  const targets = parsePackChoice(choiceArg);
  const any =
    targets.windows ||
    targets.mac ||
    targets.android ||
    targets.clientWindows ||
    targets.clientMac;
  if (!any) {
    console.error(
      '[ERROR] 无效选项。1=全部  2=Windows主机  3=Mac主机  4=Android  5=Win纯客户端  6=Mac纯客户端'
    );
    process.exit(1);
  }

  const bits = [];
  if (targets.windows) bits.push('windows');
  if (targets.mac) bits.push('mac');
  if (targets.android) bits.push('android');
  if (targets.clientWindows) bits.push('client-windows');
  if (targets.clientMac) bits.push('client-mac');
  console.log(`[Pack] targets: ${bits.join(', ')} (choice=${choiceArg})`);

  ensureDir(DIST);
  removeFile(path.join(ROOT, 'dist.zip'));

  let step = 0;
  const total = bits.length;

  if (targets.windows) {
    step += 1;
    console.log(`\n[${step}/${total}] Build windows/ ...`);
    rmDir(DIR_WIN);
    await buildWindowsPack();
  }
  if (targets.mac) {
    step += 1;
    console.log(`\n[${step}/${total}] Build mac/ ...`);
    rmDir(DIR_MAC);
    await buildMacPack();
  }
  if (targets.android) {
    step += 1;
    console.log(`\n[${step}/${total}] Build android/ ...`);
    rmDir(DIR_ANDROID);
    buildAndroidPack();
  }
  if (targets.clientWindows) {
    step += 1;
    console.log(`\n[${step}/${total}] Build client-windows/ ...`);
    rmDir(DIR_CLIENT_WIN);
    buildClientWindowsPack();
  }
  if (targets.clientMac) {
    step += 1;
    console.log(`\n[${step}/${total}] Build client-mac/ ...`);
    rmDir(DIR_CLIENT_MAC);
    await buildClientMacPack();
  }

  console.log('\nDone! Output paths:');
  if (targets.windows && fs.existsSync(DIR_WIN)) console.log(`  ${DIR_WIN}`);
  if (targets.mac && fs.existsSync(DIR_MAC)) console.log(`  ${DIR_MAC}`);
  if (targets.android && fs.existsSync(DIR_ANDROID)) {
    console.log(`  ${DIR_ANDROID}`);
    const apkOut = path.join(DIR_ANDROID, 'lianji.apk');
    if (fs.existsSync(apkOut)) console.log(`  ${apkOut}`);
  }
  if (targets.clientWindows && fs.existsSync(DIR_CLIENT_WIN)) {
    console.log(`  ${DIR_CLIENT_WIN}`);
  }
  if (targets.clientMac && fs.existsSync(DIR_CLIENT_MAC)) {
    console.log(`  ${DIR_CLIENT_MAC}`);
  }
}

/** 1=全部；2=Win主机；3=Mac主机；4=Android；5=Win纯客户端；6=Mac纯客户端。可组合 */
function parsePackChoice(raw) {
  const s = String(raw || '')
    .replace(/\s+/g, '')
    .toLowerCase();
  if (!s || s === '1' || s === 'all' || s.includes('1')) {
    return {
      windows: true,
      mac: true,
      android: true,
      clientWindows: true,
      clientMac: true,
    };
  }
  return {
    windows: s.includes('2'),
    mac: s.includes('3'),
    android: s.includes('4'),
    clientWindows: s.includes('5'),
    clientMac: s.includes('6'),
  };
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
