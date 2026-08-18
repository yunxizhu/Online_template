'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { ensureCloudflared } = require('../server/tunnel');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DIST_ZIP = path.join(ROOT, 'dist.zip');
const TOOLS_DIR = path.join(ROOT, '.tools');

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function cpDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, name.name);
    const d = path.join(dst, name.name);
    if (name.isDirectory()) {
      cpDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function copyFile(src, dst, quiet = false) {
  if (!fs.existsSync(src)) {
    if (!quiet) console.log(`  skip (not found) ${path.relative(ROOT, src)}`);
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
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

function findOnPath(cmd) {
  try {
    const out = String(execSync(`where ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
    if (!out) return '';
    return out.split(/\r?\n/)[0].trim();
  } catch {
    return '';
  }
}

function getWinRarExe() {
  const fromPath =
    findOnPath('WinRAR.exe') ||
    findOnPath('Rar.exe');
  if (fromPath) return fromPath;

  const candidates = [
    'C:\\Program Files\\WinRAR\\WinRAR.exe',
    'C:\\Program Files\\WinRAR\\Rar.exe',
    'C:\\Program Files (x86)\\WinRAR\\WinRAR.exe',
    'C:\\Program Files (x86)\\WinRAR\\Rar.exe',
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return '';
}

function zipDist() {
  removeFile(DIST_ZIP);
  if (process.platform !== 'win32') {
    console.log('  skip zip (current helper only supports Windows)');
    return;
  }
  const winRarExe = getWinRarExe();
  if (winRarExe) {
    console.log(`  using WinRAR: ${winRarExe}`);
    execFileSync(
      winRarExe,
      ['a', '-afzip', '-ep1', '-r', DIST_ZIP, path.join(DIST, '*')],
      { stdio: 'inherit' }
    );
    return;
  }
  console.log('  WinRAR not found, fallback to PowerShell Compress-Archive');
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Compress-Archive -Path '${DIST}\\*' -DestinationPath '${DIST_ZIP}' -Force`,
    ],
    { stdio: 'inherit' }
  );
}

async function main() {
  console.log('[1/7] Clean dist dir...');
  rmDir(DIST);
  fs.mkdirSync(DIST, { recursive: true });
  removeFile(DIST_ZIP);

  console.log('[2/7] Write minimal package.json...');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const minimal = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    main: pkg.main,
    dependencies: pkg.dependencies || {},
  };
  fs.writeFileSync(path.join(DIST, 'package.json'), JSON.stringify(minimal, null, 2));

  console.log('[3/7] Copy Node.js executable...');
  const nodeExe = process.execPath;
  const nodeExeName = path.basename(nodeExe);
  fs.copyFileSync(nodeExe, path.join(DIST, nodeExeName));
  console.log(`  ${nodeExeName} (${getSizeMB(nodeExe)} MB)`);

  console.log('[4/7] Copy node_modules...');
  cpDir(path.join(ROOT, 'node_modules'), path.join(DIST, 'node_modules'));

  console.log('[5/7] Copy source files...');
  const dirsToCopy = ['server', 'public', 'docs'];
  for (const dir of dirsToCopy) {
    const src = path.join(ROOT, dir);
    if (!fs.existsSync(src)) continue;
    cpDir(src, path.join(DIST, dir));
    console.log(`  ${dir}/`);
  }

  console.log('[6/7] Copy config files & resources...');
  console.log('  prepare cloudflared...');
  await ensureCloudflared();
  if (fs.existsSync(TOOLS_DIR)) {
    cpDir(TOOLS_DIR, path.join(DIST, '.tools'));
    console.log('  .tools/');
  }

  const bat =
    '@echo off\n' +
    'setlocal\n' +
    'set PORT=3000\n' +
    'set OPEN_BROWSER=1\n' +
    'echo Starting lianji server...\n' +
    '"%~dp0' + nodeExeName + '" "%~dp0server\\index.js"\n' +
    'pause\n';
  fs.writeFileSync(path.join(DIST, '启动.bat'), bat, { encoding: 'utf8' });

  const readme =
    'LianJi Portable Pack\n' +
    '====================\n' +
    '绿色版分发包，不需要安装 Node.js，双击即可运行。\n\n' +
    '目录说明\n' +
    '--------\n' +
    '- node.exe      : Node.js 运行时\n' +
    '- server/       : 服务端代码\n' +
    '- public/       : 前端页面\n' +
    '- node_modules/ : 运行依赖\n' +
    '- 启动.bat      : 双击启动服务器\n\n' +
    '运行方式\n' +
    '--------\n' +
    '直接双击 "启动.bat"，看到控制台输出后打开浏览器访问 http://localhost:3000\n\n' +
    '跨网联机\n' +
    '--------\n' +
    '跨网联机默认使用 MQTT 广播 + Cloudflare 隧道进房。\n';
  fs.writeFileSync(path.join(DIST, 'README.txt'), readme, { encoding: 'utf8' });

  console.log('[7/7] Create zip archive...');
  zipDist();

  console.log('\nDone! Output:');
  console.log(`  ${DIST}`);
  console.log(`  ${DIST_ZIP} (${getSizeMB(DIST_ZIP)} MB)`);
  console.log(`    ${nodeExeName} (${getSizeMB(path.join(DIST, nodeExeName))} MB)`);
  console.log('    server/ public/');
  console.log('    .tools/');
  console.log('    启动.bat');
  console.log('    README.txt');
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
