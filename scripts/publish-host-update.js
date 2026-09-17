'use strict';

/**
 * 一键发布 Windows 主机差分更新到 GitHub ota 分支。
 *
 * 用法：
 *   node scripts/publish-host-update.js
 *   node scripts/publish-host-update.js --notes "修复拉斯岛 bot"
 *   node scripts/publish-host-update.js --bump patch
 *   node scripts/publish-host-update.js --dry-run
 *   node scripts/publish-host-update.js --force
 *
 * 发布后他人检测地址（默认）：
 *   https://raw.githubusercontent.com/yunxizhu/Online_template/ota/host-update.json
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  isPathAllowed,
  sha256File,
  cmpSemver,
  fetchBuffer,
} = require('../server/updateChecker');

const ROOT = path.resolve(__dirname, '..');
const OTA_BRANCH = 'ota';
const SCAN_DIRS = ['server', 'public'];
const ROOT_FILES = ['package.json'];
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.update',
  '.update-prev',
  '.tools',
  'dist',
  '.gradle-home',
  '__pycache__',
]);
const SKIP_FILE_NAMES = new Set([
  'update.url',
  'update.off',
  'mqtt.channel',
  'mqtt.broker',
  'mqtt.off',
  '.DS_Store',
  'Thumbs.db',
]);

function parseArgs(argv) {
  const out = {
    notes: '',
    notesEn: '',
    bump: '',
    dryRun: false,
    force: false,
    noPush: false,
    minVersion: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--no-push') out.noPush = true;
    else if (a === '--notes') out.notes = String(argv[++i] || '');
    else if (a === '--notes-en') out.notesEn = String(argv[++i] || '');
    else if (a === '--bump') out.bump = String(argv[++i] || '');
    else if (a === '--min-version') out.minVersion = String(argv[++i] || '');
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

function writePkg(pkg) {
  fs.writeFileSync(
    path.join(ROOT, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  );
}

function bumpVersion(ver, kind) {
  const parts = String(ver || '0.0.0')
    .replace(/^v/i, '')
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  while (parts.length < 3) parts.push(0);
  if (kind === 'major') {
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
  } else if (kind === 'minor') {
    parts[1] += 1;
    parts[2] = 0;
  } else {
    parts[2] += 1;
  }
  return parts.join('.');
}

function walkFiles(dir, relBase, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(ent.name) || SKIP_FILE_NAMES.has(ent.name)) continue;
    if (ent.name.startsWith('.') && ent.name !== '.gitkeep') continue;
    const abs = path.join(dir, ent.name);
    const rel = (relBase ? relBase + '/' : '') + ent.name;
    if (ent.isDirectory()) {
      walkFiles(abs, rel.replace(/\\/g, '/'), out);
    } else if (ent.isFile()) {
      const norm = rel.replace(/\\/g, '/');
      if (!isPathAllowed(norm)) continue;
      // 跳过测试文件可选：保留，便于热修测试
      out.push(norm);
    }
  }
}

function collectHostFiles() {
  const list = [];
  for (const d of SCAN_DIRS) {
    walkFiles(path.join(ROOT, d), d, list);
  }
  for (const f of ROOT_FILES) {
    if (fs.existsSync(path.join(ROOT, f)) && isPathAllowed(f)) list.push(f);
  }
  list.sort();
  return list;
}

function blobRelPath(sha) {
  return 'blobs/' + sha.slice(0, 2) + '/' + sha;
}

function detectGithubRepo() {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (r.status !== 0) return { owner: 'yunxizhu', repo: 'Online_template' };
  const url = String(r.stdout || '').trim();
  let m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/i);
  if (m) return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
  return { owner: 'yunxizhu', repo: 'Online_template' };
}

function rawBlobUrl(owner, repo, sha) {
  return (
    'https://raw.githubusercontent.com/' +
    owner +
    '/' +
    repo +
    '/' +
    OTA_BRANCH +
    '/' +
    blobRelPath(sha)
  );
}

function runGit(args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    stdio: opts.stdio || ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim() || 'git failed';
    throw new Error('git ' + args.join(' ') + '\n' + err);
  }
  return String(r.stdout || '').trim();
}

function ensureOtaWorktree(worktreePath) {
  if (fs.existsSync(worktreePath)) {
    // 已有 worktree：拉最新
    try {
      runGit(['fetch', 'origin', OTA_BRANCH], { cwd: ROOT });
    } catch (_) {}
    try {
      runGit(['checkout', OTA_BRANCH], { cwd: worktreePath });
      try {
        runGit(['pull', '--ff-only', 'origin', OTA_BRANCH], {
          cwd: worktreePath,
        });
      } catch (_) {}
      return;
    } catch (_) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  }

  // 远端是否已有 ota
  let remoteHas = false;
  try {
    runGit(['fetch', 'origin', OTA_BRANCH]);
    remoteHas = true;
  } catch (_) {
    remoteHas = false;
  }

  if (remoteHas) {
    runGit(['worktree', 'add', worktreePath, 'origin/' + OTA_BRANCH]);
    // detached → 建本地分支
    try {
      runGit(['checkout', '-B', OTA_BRANCH], { cwd: worktreePath });
    } catch (_) {}
    return;
  }

  // 本地是否有 ota
  const branches = runGit(['branch', '--list', OTA_BRANCH]);
  if (branches) {
    runGit(['worktree', 'add', worktreePath, OTA_BRANCH]);
    return;
  }

  // 新建 orphan ota
  runGit(['worktree', 'add', '--detach', worktreePath, 'HEAD']);
  runGit(['checkout', '--orphan', OTA_BRANCH], { cwd: worktreePath });
  // 清空工作区
  try {
    runGit(['rm', '-rf', '.'], { cwd: worktreePath });
  } catch (_) {}
  fs.writeFileSync(
    path.join(worktreePath, 'README.md'),
    '# LianJi host OTA\n\nContent-addressed blobs + host-update.json\n'
  );
  runGit(['add', 'README.md'], { cwd: worktreePath });
  runGit(['commit', '-m', 'chore: init ota branch'], { cwd: worktreePath });
}

async function fetchRemoteManifest(url) {
  try {
    const bust = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
    const buf = await fetchBuffer(bust, { timeoutMs: 15000 });
    return JSON.parse(buf.toString('utf8'));
  } catch (_) {
    return null;
  }
}

function printHelp() {
  console.log(`发布 Windows 主机差分更新

  node scripts/publish-host-update.js [options]

选项:
  --notes "说明"       更新说明（中文）
  --notes-en "..."     英文说明
  --bump patch|minor|major  先 bump package.json 再发布
  --min-version x.y.z  低于此版本强制升级
  --force              manifest.force = true
  --dry-run            只生成 dist/ota-stage，不推送
  --no-push            写入 ota worktree 并 commit，但不 push

默认会把新 blob + host-update.json 推到 origin/${OTA_BRANCH}。
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.notes && process.env.LIANJI_OTA_NOTES) {
    args.notes = String(process.env.LIANJI_OTA_NOTES);
  }
  if (!args.notesEn && process.env.LIANJI_OTA_NOTES_EN) {
    args.notesEn = String(process.env.LIANJI_OTA_NOTES_EN);
  }
  if (!args.bump && process.env.LIANJI_OTA_BUMP) {
    args.bump = String(process.env.LIANJI_OTA_BUMP);
  }

  let pkg = readPkg();
  if (args.bump) {
    const kind = String(args.bump).toLowerCase();
    if (!['patch', 'minor', 'major'].includes(kind)) {
      throw new Error('--bump 只能是 patch / minor / major');
    }
    const next = bumpVersion(pkg.version, kind);
    pkg.version = next;
    writePkg(pkg);
    console.log('[publish] bumped package.json →', next);
    pkg = readPkg();
  }

  const version = String(pkg.version || '').trim();
  if (!version) throw new Error('package.json 缺少 version');

  const { owner, repo } = detectGithubRepo();
  const manifestUrl =
    'https://raw.githubusercontent.com/' +
    owner +
    '/' +
    repo +
    '/' +
    OTA_BRANCH +
    '/host-update.json';

  console.log('[publish] version =', version);
  console.log('[publish] repo =', owner + '/' + repo);
  console.log('[publish] manifest will be', manifestUrl);

  const remote = await fetchRemoteManifest(manifestUrl);
  if (remote && remote.version && cmpSemver(version, remote.version) < 0) {
    throw new Error(
      `本地版本 ${version} 低于线上 ${remote.version}，请先 --bump 或改 package.json`
    );
  }
  if (
    remote &&
    remote.version &&
    cmpSemver(version, remote.version) === 0 &&
    !args.force
  ) {
    console.warn(
      `[publish] 警告: 线上已是 ${version}。将覆盖同版本 manifest（仅上传变更 blob）。`
    );
  }

  const relFiles = collectHostFiles();
  console.log('[publish] scanning', relFiles.length, 'files…');

  const existingBlobs = new Set();
  if (remote && Array.isArray(remote.files)) {
    for (const f of remote.files) {
      if (f && f.sha256) existingBlobs.add(String(f.sha256).toLowerCase());
    }
  }

  const files = [];
  const newBlobs = [];
  let totalBytes = 0;
  for (const rel of relFiles) {
    const abs = path.join(ROOT, ...rel.split('/'));
    const st = fs.statSync(abs);
    const sha = sha256File(abs);
    const size = st.size;
    totalBytes += size;
    const entry = {
      path: rel,
      sha256: sha,
      size,
      url: rawBlobUrl(owner, repo, sha),
    };
    files.push(entry);
    if (!existingBlobs.has(sha)) {
      newBlobs.push({ sha, abs, size });
    }
  }

  const notes =
    args.notes ||
    (remote && remote.version === version
      ? String(remote.notes || '')
      : `主机更新 ${version}`);

  const manifest = {
    schema: 1,
    version,
    minVersion: args.minVersion || (remote && remote.minVersion) || '',
    force: Boolean(args.force),
    notes,
    notes_en: args.notesEn || '',
    publishedAt: new Date().toISOString(),
    fileCount: files.length,
    totalBytes,
    files,
  };

  const stageDir = path.join(ROOT, 'dist', 'ota-stage');
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  fs.writeFileSync(
    path.join(stageDir, 'host-update.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );

  // 也写一份便于人工检查的精简列表
  fs.writeFileSync(
    path.join(stageDir, 'CHANGED_BLOBS.txt'),
    newBlobs.map((b) => b.sha + '  ' + b.size + '\n').join('') || '(none)\n'
  );

  console.log(
    `[publish] files=${files.length} total=${(totalBytes / 1e6).toFixed(1)}MB newBlobs=${newBlobs.length}`
  );

  if (args.dryRun) {
    console.log('[publish] dry-run: staged at', stageDir);
    console.log('[publish] skip git push');
    return;
  }

  const worktreePath = path.join(ROOT, 'dist', 'ota-worktree');
  console.log('[publish] preparing worktree', worktreePath);
  ensureOtaWorktree(worktreePath);

  // 复制新 blob
  let copied = 0;
  for (const b of newBlobs) {
    const dest = path.join(worktreePath, ...blobRelPath(b.sha).split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(b.abs, dest);
      copied += 1;
    }
  }
  fs.copyFileSync(
    path.join(stageDir, 'host-update.json'),
    path.join(worktreePath, 'host-update.json')
  );
  console.log('[publish] copied new blobs:', copied);

  runGit(['add', '-A'], { cwd: worktreePath });
  const status = runGit(['status', '--porcelain'], { cwd: worktreePath });
  if (!status) {
    console.log('[publish] nothing to commit (already up to date)');
  } else {
    runGit(
      ['commit', '-m', `ota(host): ${version} (${newBlobs.length} new blobs)`],
      { cwd: worktreePath }
    );
  }

  if (args.noPush) {
    console.log('[publish] --no-push: committed locally on ota worktree');
    return;
  }

  console.log('[publish] pushing origin/' + OTA_BRANCH + ' …');
  runGit(['push', '-u', 'origin', OTA_BRANCH], { cwd: worktreePath });

  // 写默认 update.url 到 stage 提示
  fs.writeFileSync(
    path.join(stageDir, 'update.url.example'),
    manifestUrl + '\n'
  );

  console.log('');
  console.log('发布成功。');
  console.log('  Manifest:', manifestUrl);
  console.log('  其他人启动主机后会自动检测；也可在菜单点「检查更新」。');
  console.log('  若 raw.githubusercontent.com 较慢，可在主机目录放 update.url 指向镜像。');
  console.log('  jsDelivr 镜像示例:');
  console.log(
    '  https://cdn.jsdelivr.net/gh/' +
      owner +
      '/' +
      repo +
      '@' +
      OTA_BRANCH +
      '/host-update.json'
  );
}

main().catch((err) => {
  console.error('[publish] failed:', err && err.message ? err.message : err);
  process.exit(1);
});
