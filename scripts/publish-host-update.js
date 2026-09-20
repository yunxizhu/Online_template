'use strict';

/**
 * 一键发布 Windows 主机差分更新到 Gitee ota 分支。
 * 扫描范围与绿版打包内容对齐（不含 node_modules / node.exe / .tools）。
 *
 * 用法：
 *   node scripts/publish-host-update.js
 *   node scripts/publish-host-update.js --notes "修复拉斯岛 bot"
 *   node scripts/publish-host-update.js --bump patch
 *   node scripts/publish-host-update.js --dry-run
 *   node scripts/publish-host-update.js --force
 *
 * 首次请添加 Gitee 远程（推荐 SSH，免每次登录）：
 *   git remote add gitee git@gitee.com:xiyunzhu/online_template.git
 * 若已是 HTTPS，可改成 SSH：
 *   git remote set-url gitee git@gitee.com:xiyunzhu/online_template.git
 *
 * 发布后他人检测地址（默认）：
 *   https://raw.giteeusercontent.com/xiyunzhu/online_template/raw/ota/host-update.json
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  isPathAllowed,
  sha256Buffer,
  cmpSemver,
  fetchManifestObject,
  fetchBuffer,
  readOtaBytes,
  isOtaTextPath,
  normalizeTextBuffer,
} = require('../server/updateChecker');
const {
  DEFAULT_PORT,
  PACK_SUFFIX,
  PACK_LAUNCHER_FILES,
  writeWindowsPackLaunchers,
} = require('./windows-pack-launchers');

const ROOT = path.resolve(__dirname, '..');
const OTA_BRANCH = 'ota';
const DEFAULT_OWNER = 'xiyunzhu';
const DEFAULT_REPO = 'online_template';
/** 推送 OTA 的 git remote 名；可用环境变量 LIANJI_OTA_REMOTE 覆盖 */
const OTA_REMOTE =
  String(process.env.LIANJI_OTA_REMOTE || 'gitee').trim() || 'gitee';
/** 与 Windows 绿版打包同源（排除 node_modules / node.exe / .tools） */
const SCAN_DIRS = ['server', 'public', 'docs'];
const ROOT_FILES = ['package.json'];
const PACK_EXTRA_FILES = ['scripts/check-host-update.js'];
const OTA_PACK_STAGE = path.join(ROOT, 'dist', 'ota-pack-files');
const CHANGELOG_PATH = path.join(ROOT, 'public', 'changelog.json');
const CHANGELOG_MOBILE_PATH = path.join(ROOT, 'mobile', 'www', 'changelog.json');
/** 公告保留条数；过短会导致旧说明在多次发版后被挤掉 */
const CHANGELOG_MAX = 50;
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
    skipVerify: false,
    verifyOnly: false,
    minVersion: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--no-push') out.noPush = true;
    else if (a === '--skip-verify') out.skipVerify = true;
    else if (a === '--verify-only') out.verifyOnly = true;
    else if (a === '--notes') out.notes = String(argv[++i] || '');
    else if (a === '--notes-en') out.notesEn = String(argv[++i] || '');
    else if (a === '--bump') out.bump = String(argv[++i] || '');
    else if (a === '--min-version') out.minVersion = String(argv[++i] || '');
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 逐个从 Gitee raw CDN 拉取并校验 sha256，确认用户侧可正常下载。
 * 用于发现 HTTP 451 内容审核拦截等「清单能读、blob 下不了」的问题。
 */
async function verifyRemoteFileDownloads(files, opts = {}) {
  const concurrency = Math.max(1, Number(opts.concurrency) || 8);
  const retries = Math.max(1, Number(opts.retries) || 2);
  const retryDelayMs = Math.max(0, Number(opts.retryDelayMs) || 2500);
  const label = opts.label || 'verify';
  const list = Array.isArray(files) ? files : [];
  const failed = [];
  let next = 0;
  let ok = 0;
  let done = 0;

  async function checkOne(file) {
    const buf = await fetchBuffer(file.url, { timeoutMs: 120000 });
    const body = isOtaTextPath(file.path) ? normalizeTextBuffer(buf) : buf;
    const got = sha256Buffer(body);
    if (got !== String(file.sha256 || '').toLowerCase()) {
      throw new Error(
        '校验失败（期望 ' +
          String(file.sha256).slice(0, 8) +
          '… 实际 ' +
          got.slice(0, 8) +
          '…）'
      );
    }
  }

  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= list.length) return;
      const f = list[idx];
      let lastErr = null;
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          await checkOne(f);
          lastErr = null;
          ok += 1;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < retries) await sleep(retryDelayMs);
        }
      }
      if (lastErr) {
        failed.push({
          path: f.path,
          url: f.url,
          error: lastErr && lastErr.message ? lastErr.message : String(lastErr),
        });
      }
      done += 1;
      if (done === list.length || done % 25 === 0) {
        console.log(
          '[' +
            label +
            '] 进度 ' +
            done +
            '/' +
            list.length +
            '（通过 ' +
            ok +
            ' / 失败 ' +
            failed.length +
            '）'
        );
      }
    }
  }

  const n = Math.min(concurrency, Math.max(1, list.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return { ok, failed, total: list.length };
}

async function runDownloadVerify(files, opts = {}) {
  const waitMs = opts.waitMs == null ? 8000 : opts.waitMs;
  if (waitMs > 0) {
    console.log('');
    console.log(
      '[publish] 等待 CDN 同步（' + Math.round(waitMs / 1000) + ' 秒）后开始下载检测…'
    );
    await sleep(waitMs);
  }
  console.log(
    '[publish] 下载检测：共 ' + files.length + ' 个文件（模拟客户端拉取 + sha256 校验）…'
  );
  const result = await verifyRemoteFileDownloads(files, {
    concurrency: 8,
    retries: 2,
    retryDelayMs: 2500,
    label: 'verify',
  });
  if (result.failed.length) {
    console.error('');
    console.error(
      '[publish] 下载检测失败：' +
        result.failed.length +
        '/' +
        result.total +
        ' 个文件无法正常下载'
    );
    const show = result.failed.slice(0, 40);
    for (const f of show) {
      console.error('  ✗ ' + f.path);
      console.error('    ' + f.error);
    }
    if (result.failed.length > show.length) {
      console.error('  … 另有 ' + (result.failed.length - show.length) + ' 个失败');
    }
    console.error(
      '[publish] 常见原因：Gitee raw CDN 返回 HTTP 451（内容可能含违规信息）'
    );
    console.error('[publish] 请处理拦截文件后再让用户升级。');
    throw new Error(
      'OTA 下载检测未通过（' + result.failed.length + ' 个文件失败）'
    );
  }
  console.log(
    '[publish] 下载检测通过：' + result.ok + '/' + result.total + ' 个文件均可下载且校验一致'
  );
  return result;
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

/**
 * 按版本合并多份公告列表。同版本优先保留非空 notes，publishedAt 取较新者。
 */
function mergeChangelogEntries(...lists) {
  const byVer = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!raw || raw.version == null || raw.version === '') continue;
      const version = String(raw.version);
      const notes = String(raw.notes || '').trim();
      const notesEn = String(raw.notesEn || raw.notes_en || '').trim();
      const publishedAt = String(raw.publishedAt || '').trim();
      const prev = byVer.get(version);
      if (!prev) {
        byVer.set(version, { version, notes, notesEn, publishedAt });
        continue;
      }
      const prevAt = Date.parse(prev.publishedAt) || 0;
      const nextAt = Date.parse(publishedAt) || 0;
      byVer.set(version, {
        version,
        notes: notes || prev.notes || '',
        notesEn: notesEn || prev.notesEn || '',
        publishedAt:
          nextAt >= prevAt
            ? publishedAt || prev.publishedAt
            : prev.publishedAt || publishedAt,
      });
    }
  }
  return Array.from(byVer.values()).sort((a, b) =>
    cmpSemver(b.version, a.version)
  );
}

function readLocalChangelogEntries() {
  try {
    if (!fs.existsSync(CHANGELOG_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(CHANGELOG_PATH, 'utf8'));
    return Array.isArray(data && data.entries) ? data.entries : [];
  } catch (_) {
    return [];
  }
}

/**
 * 拉取线上已发布的公告（manifest.changelog + public/changelog.json blob），
 * 避免本机文件缺失/过旧时把历史公告冲掉。
 */
async function loadRemoteChangelogEntries(remote) {
  const parts = [];
  if (remote && Array.isArray(remote.changelog)) {
    parts.push(remote.changelog);
  }
  const fileEntry =
    remote &&
    Array.isArray(remote.files) &&
    remote.files.find((f) => f && f.path === 'public/changelog.json');
  if (fileEntry && fileEntry.url) {
    try {
      const buf = await fetchBuffer(fileEntry.url, { timeoutMs: 30000 });
      const text = normalizeTextBuffer(buf).toString('utf8');
      const data = JSON.parse(text);
      if (Array.isArray(data && data.entries)) {
        parts.push(data.entries);
        console.log(
          '[publish] 已合并线上 public/changelog.json（' +
            data.entries.length +
            ' 条）'
        );
      }
    } catch (err) {
      console.warn(
        '[publish] 拉取线上 changelog.json 失败:',
        err && err.message ? err.message : err
      );
    }
  }
  return mergeChangelogEntries(...parts);
}

/**
 * 把本次发布备注写入 public/changelog.json（并同步 mobile/www），随 OTA 下发。
 * 会与线上/本地历史按版本合并，保证各主机拉到的公告一致。
 */
function updateLocalChangelog(version, notes, notesEn, remoteEntries) {
  const merged = mergeChangelogEntries(
    remoteEntries || [],
    readLocalChangelogEntries()
  );
  const publishedAt = new Date().toISOString();
  const noteText = String(notes || '').trim() || `主机更新 ${version}`;
  const noteEn = String(notesEn || '').trim();
  const ver = String(version);
  const idx = merged.findIndex((e) => String(e.version) === ver);
  const entry = {
    version: ver,
    notes: noteText,
    notesEn: noteEn,
    publishedAt,
  };
  if (idx >= 0) {
    const prev = merged[idx];
    merged[idx] = {
      version: ver,
      notes: noteText || prev.notes || '',
      notesEn: noteEn || prev.notesEn || '',
      publishedAt,
    };
  } else {
    merged.unshift(entry);
  }
  merged.sort((a, b) => cmpSemver(b.version, a.version));
  const next = {
    schema: 1,
    entries: merged.slice(0, CHANGELOG_MAX),
  };
  const body = JSON.stringify(next, null, 2) + '\n';
  fs.mkdirSync(path.dirname(CHANGELOG_PATH), { recursive: true });
  fs.writeFileSync(CHANGELOG_PATH, body);
  try {
    fs.mkdirSync(path.dirname(CHANGELOG_MOBILE_PATH), { recursive: true });
    fs.writeFileSync(CHANGELOG_MOBILE_PATH, body);
  } catch (err) {
    console.warn(
      '[publish] 同步 mobile changelog 失败:',
      err && err.message ? err.message : err
    );
  }
  console.log(
    `[publish] changelog → ${CHANGELOG_PATH}（${next.entries.length} 条，已与线上合并）`
  );
  return next;
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
      out.push(norm);
    }
  }
}

function collectHostFiles(version) {
  const list = [];
  for (const d of SCAN_DIRS) {
    walkFiles(path.join(ROOT, d), d, list);
  }
  for (const f of ROOT_FILES) {
    if (fs.existsSync(path.join(ROOT, f)) && isPathAllowed(f)) list.push(f);
  }
  for (const f of PACK_EXTRA_FILES) {
    if (fs.existsSync(path.join(ROOT, f)) && isPathAllowed(f)) list.push(f);
  }

  // 生成与绿版一致的启动脚本 / README，供 OTA 下发
  fs.rmSync(OTA_PACK_STAGE, { recursive: true, force: true });
  writeWindowsPackLaunchers(OTA_PACK_STAGE, {
    nodeExeName: 'node.exe',
    version: version || '0.0.0',
    suffix: PACK_SUFFIX,
    port: DEFAULT_PORT,
  });
  for (const f of PACK_LAUNCHER_FILES) {
    if (isPathAllowed(f)) list.push(f);
  }

  list.sort();
  return [...new Set(list)];
}

/** 启动脚本读自 ota-pack-files；其余读仓库根 */
function resolvePublishAbs(rel) {
  const norm = String(rel || '').replace(/\\/g, '/');
  if (PACK_LAUNCHER_FILES.includes(norm)) {
    return path.join(OTA_PACK_STAGE, ...norm.split('/'));
  }
  return path.join(ROOT, ...norm.split('/'));
}

function blobRelPath(sha) {
  return 'blobs/' + sha.slice(0, 2) + '/' + sha;
}

function parseOwnerRepoFromUrl(url) {
  const u = String(url || '').trim();
  let m = u.match(/gitee\.com[:/]([^/]+)\/([^/.]+)/i);
  if (m) return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
  m = u.match(/github\.com[:/]([^/]+)\/([^/.]+)/i);
  if (m) return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
  return null;
}

function gitRemoteUrl(name) {
  const r = spawnSync('git', ['remote', 'get-url', name], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (r.status !== 0) return '';
  return String(r.stdout || '').trim();
}

function listRemotes() {
  const r = spawnSync('git', ['remote'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (r.status !== 0) return [];
  return String(r.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveOtaRemote() {
  const remotes = listRemotes();
  if (remotes.includes(OTA_REMOTE)) return OTA_REMOTE;
  // 若用户把 origin 直接设成 Gitee，也可
  const originUrl = gitRemoteUrl('origin');
  if (/gitee\.com/i.test(originUrl)) return 'origin';
  return OTA_REMOTE;
}

function detectRepo(remoteName) {
  const url = gitRemoteUrl(remoteName);
  if (url) {
    const parsed = parseOwnerRepoFromUrl(url);
    if (parsed) return parsed;
  }
  // 没有 OTA remote 时不要用 GitHub origin 推断（用户名/仓库名常与 Gitee 不一致）
  const originUrl = gitRemoteUrl('origin');
  if (/gitee\.com/i.test(originUrl)) {
    const parsed = parseOwnerRepoFromUrl(originUrl);
    if (parsed) return parsed;
  }
  return { owner: DEFAULT_OWNER, repo: DEFAULT_REPO };
}

function rawBlobUrl(owner, repo, sha) {
  return (
    'https://raw.giteeusercontent.com/' +
    owner +
    '/' +
    repo +
    '/raw/' +
    OTA_BRANCH +
    '/' +
    blobRelPath(sha)
  );
}

function rawManifestUrl(owner, repo) {
  return (
    'https://raw.giteeusercontent.com/' +
    owner +
    '/' +
    repo +
    '/raw/' +
    OTA_BRANCH +
    '/host-update.json'
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

function writeProgress(label, pct, state) {
  const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  if (process.stdout.isTTY) {
    process.stdout.write('\r[publish] ' + label + ' ' + n + '%    ');
    return;
  }
  // 非 TTY 避免刷屏：每 5% 打一行
  if (state && n < 100 && n < (state.last || 0) + 5) return;
  if (state) state.last = n;
  process.stdout.write('[publish] ' + label + ' ' + n + '%\n');
}

function finishProgress(label) {
  if (process.stdout.isTTY) {
    process.stdout.write('\r[publish] ' + label + ' 100%\n');
  } else {
    process.stdout.write('[publish] ' + label + ' 100%\n');
  }
}

/** 从 git --progress 输出里取最近一次百分比 */
function lastGitPercent(text) {
  const matches = String(text || '').match(/(\d+)%/g);
  if (!matches || !matches.length) return null;
  const n = parseInt(matches[matches.length - 1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * 带进度的 git 调用。opts.progressFrom/To 把子步骤百分比映射到总进度区间。
 */
function runGitProgress(args, opts = {}) {
  const label = opts.progressLabel || 'git';
  const from = opts.progressFrom == null ? 0 : opts.progressFrom;
  const to = opts.progressTo == null ? 100 : opts.progressTo;
  const state = opts.progressState || { last: -1 };
  const cwd = opts.cwd || ROOT;

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_PROGRESS_DELAY: '0' },
    });
    let stdout = '';
    let stderr = '';
    const onChunk = (buf, isErr) => {
      const s = buf.toString();
      if (isErr) stderr += s;
      else stdout += s;
      const pct = lastGitPercent(s);
      if (pct == null) return;
      const mapped = from + ((to - from) * pct) / 100;
      writeProgress(label, mapped, state);
    };
    child.stdout.on('data', (b) => onChunk(b, false));
    child.stderr.on('data', (b) => onChunk(b, true));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        const err = (stderr || stdout || '').trim() || 'git failed';
        reject(new Error('git ' + args.join(' ') + '\n' + err));
        return;
      }
      writeProgress(label, to, state);
      resolve(String(stdout || '').trim());
    });
  });
}

function ensureOtaRemote(remoteName, owner, repo) {
  const remotes = listRemotes();
  if (remotes.includes(remoteName)) return;
  const url = 'git@gitee.com:' + owner + '/' + repo + '.git';
  throw new Error(
    `缺少 git remote「${remoteName}」。请先在 Gitee 创建仓库 ${owner}/${repo}，然后执行：\n` +
      `  git remote add ${remoteName} ${url}\n` +
      `（推荐 SSH；HTTPS 每次推送都要账号/令牌）\n` +
      `再重新运行本脚本。`
  );
}

function clearStaleOtaWorktree(worktreePath) {
  try {
    runGit(['worktree', 'prune']);
  } catch (_) {}
  if (fs.existsSync(worktreePath)) return;
  // 目录已删但 git 仍登记时，强制注销（prune 偶尔不够）
  try {
    runGit(['worktree', 'remove', '--force', worktreePath]);
  } catch (_) {}
  try {
    runGit(['worktree', 'prune']);
  } catch (_) {}
}

async function ensureOtaWorktree(worktreePath, remoteName) {
  const label = 'preparing worktree';
  const state = { last: -1 };
  writeProgress(label, 0, state);

  if (!fs.existsSync(worktreePath)) {
    clearStaleOtaWorktree(worktreePath);
  }

  if (fs.existsSync(worktreePath)) {
    try {
      await runGitProgress(['fetch', '--progress', remoteName, OTA_BRANCH], {
        cwd: ROOT,
        progressLabel: label,
        progressFrom: 0,
        progressTo: 70,
        progressState: state,
      });
    } catch (_) {
      writeProgress(label, 70, state);
    }
    try {
      runGit(['checkout', OTA_BRANCH], { cwd: worktreePath });
      writeProgress(label, 85, state);
      try {
        await runGitProgress(
          ['pull', '--ff-only', '--progress', remoteName, OTA_BRANCH],
          {
            cwd: worktreePath,
            progressLabel: label,
            progressFrom: 85,
            progressTo: 100,
            progressState: state,
          }
        );
      } catch (_) {
        writeProgress(label, 100, state);
      }
      finishProgress(label);
      return;
    } catch (_) {
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch (_) {}
      clearStaleOtaWorktree(worktreePath);
    }
  }

  let remoteHas = false;
  try {
    await runGitProgress(['fetch', '--progress', remoteName, OTA_BRANCH], {
      progressLabel: label,
      progressFrom: 0,
      progressTo: 60,
      progressState: state,
    });
    remoteHas = true;
  } catch (_) {
    remoteHas = false;
    writeProgress(label, 60, state);
  }

  if (remoteHas) {
    writeProgress(label, 65, state);
    clearStaleOtaWorktree(worktreePath);
    runGit(['worktree', 'add', worktreePath, remoteName + '/' + OTA_BRANCH]);
    writeProgress(label, 90, state);
    try {
      runGit(['checkout', '-B', OTA_BRANCH], { cwd: worktreePath });
    } catch (_) {}
    finishProgress(label);
    return;
  }

  const branches = runGit(['branch', '--list', OTA_BRANCH]);
  writeProgress(label, 70, state);
  if (branches) {
    clearStaleOtaWorktree(worktreePath);
    runGit(['worktree', 'add', worktreePath, OTA_BRANCH]);
    finishProgress(label);
    return;
  }

  clearStaleOtaWorktree(worktreePath);
  runGit(['worktree', 'add', '--detach', worktreePath, 'HEAD']);
  writeProgress(label, 80, state);
  runGit(['checkout', '--orphan', OTA_BRANCH], { cwd: worktreePath });
  try {
    runGit(['rm', '-rf', '.'], { cwd: worktreePath });
  } catch (_) {}
  fs.writeFileSync(
    path.join(worktreePath, 'README.md'),
    '# LianJi host OTA (Gitee)\n\nContent-addressed blobs + host-update.json\n'
  );
  runGit(['add', 'README.md'], { cwd: worktreePath });
  runGit(['commit', '-m', 'chore: init ota branch'], { cwd: worktreePath });
  finishProgress(label);
}

async function fetchRemoteManifest(url) {
  try {
    const { manifest } = await fetchManifestObject(url);
    return manifest;
  } catch (_) {
    return null;
  }
}

function printHelp() {
  console.log(`发布 Windows 主机差分更新（Gitee）

  node scripts/publish-host-update.js [options]

扫描范围（与绿版打包一致，不含 node_modules / node.exe / .tools）:
  server/  public/  docs/  package.json
  scripts/check-host-update.js
  启动.bat  本机多开测试.bat  _start-one.bat  README.txt

选项:
  --notes "说明"       更新说明（中文，写入更新公告，最多保留近 10 版）
  --notes-en "..."     英文说明
  --bump patch|minor|major  先 bump package.json 再发布
  --min-version x.y.z  低于此版本强制升级
  --force              manifest.force = true
  --dry-run            只生成 dist/ota-stage，不推送
  --no-push            写入 ota worktree 并 commit，但不 push
  --skip-verify        推送后跳过「新上传文件下载检测」
  --verify-only        不发布，只检测线上 host-update.json 全部文件能否下载

默认推送到 remote「${OTA_REMOTE}」的 ${OTA_BRANCH} 分支。
推送成功后会自动检测本次新上传的 blob 能否从 Gitee raw 下载（可用 --skip-verify 跳过）。
可用环境变量 LIANJI_OTA_REMOTE 改 remote 名。
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.verifyOnly) {
    const remoteName = resolveOtaRemote();
    const { owner, repo } = detectRepo(remoteName);
    const manifestUrl = rawManifestUrl(owner, repo);
    console.log('[publish] --verify-only: 检测线上清单', manifestUrl);
    const remote = await fetchRemoteManifest(manifestUrl);
    if (!remote || !Array.isArray(remote.files) || !remote.files.length) {
      throw new Error('线上 manifest 无 files 列表');
    }
    console.log(
      '[publish] 线上版本',
      remote.version || '?',
      '，文件数',
      remote.files.length
    );
    await runDownloadVerify(remote.files, { waitMs: 0 });
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

  const remoteName = resolveOtaRemote();
  const { owner, repo } = detectRepo(remoteName);
  const manifestUrl = rawManifestUrl(owner, repo);

  console.log('[publish] version =', version);
  console.log('[publish] remote =', remoteName);
  console.log('[publish] repo =', owner + '/' + repo, '(Gitee)');
  console.log('[publish] manifest will be', manifestUrl);

  if (!args.dryRun && !args.noPush) {
    ensureOtaRemote(remoteName, owner, repo);
  }

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

  const notes =
    args.notes ||
    (remote && remote.version === version
      ? String(remote.notes || '')
      : '') ||
    String(pkg.description || '').trim() ||
    `主机更新 ${version}`;
  const notesEn = args.notesEn || '';
  // 先与线上公告合并并写回本地文件，再扫包，确保 OTA 带上完整 changelog.json
  const remoteChangelog = await loadRemoteChangelogEntries(remote);
  const changelog = updateLocalChangelog(
    version,
    notes,
    notesEn,
    remoteChangelog
  );

  const relFiles = collectHostFiles(version);
  console.log('[publish] scanning', relFiles.length, 'files (windows pack set)…');

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
    const abs = resolvePublishAbs(rel);
    const body = readOtaBytes(abs, rel);
    const sha = sha256Buffer(body);
    const size = body.length;
    totalBytes += size;
    const entry = {
      path: rel,
      sha256: sha,
      size,
      url: rawBlobUrl(owner, repo, sha),
    };
    files.push(entry);
    if (!existingBlobs.has(sha)) {
      newBlobs.push({ sha, abs, rel, body, size });
    }
  }

  const manifest = {
    schema: 1,
    version,
    minVersion: args.minVersion || (remote && remote.minVersion) || '',
    force: Boolean(args.force),
    notes,
    notes_en: notesEn,
    publishedAt: new Date().toISOString(),
    changelog: changelog.entries || [],
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

  fs.writeFileSync(
    path.join(stageDir, 'CHANGED_BLOBS.txt'),
    newBlobs
      .map((b) => b.sha + '  ' + b.size + '  ' + b.rel + '\n')
      .join('') || '(none)\n'
  );

  console.log(
    `[publish] files=${files.length} total=${(totalBytes / 1e6).toFixed(1)}MB newBlobs=${newBlobs.length}`
  );
  if (newBlobs.length) {
    console.log('[publish] 本次将上传的变更文件：');
    const sorted = newBlobs.slice().sort((a, b) => a.rel.localeCompare(b.rel));
    for (const b of sorted) {
      const kb = (b.size / 1024).toFixed(b.size >= 10240 ? 0 : 1);
      console.log(`  + ${b.rel}  (${kb} KB)`);
    }
  } else {
    console.log('[publish] 本次无内容变更 blob（仅可能更新 manifest）');
  }

  if (args.dryRun) {
    console.log('[publish] dry-run: staged at', stageDir);
    console.log('[publish] skip git push');
    return;
  }

  const worktreePath = path.join(ROOT, 'dist', 'ota-worktree');
  console.log('[publish] worktree →', worktreePath);
  await ensureOtaWorktree(worktreePath, remoteName);

  // 禁止 Git 改行尾，否则 blob 内容与 sha256 对不上（校验失败根因）
  try {
    runGit(['config', 'core.autocrlf', 'false'], { cwd: worktreePath });
    runGit(['config', 'core.eol', 'lf'], { cwd: worktreePath });
    runGit(['config', 'core.safecrlf', 'false'], { cwd: worktreePath });
  } catch (err) {
    console.warn('[publish] warn: git config in worktree:', err.message);
  }

  let copied = 0;
  for (const b of newBlobs) {
    const dest = path.join(worktreePath, ...blobRelPath(b.sha).split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const needWrite =
      !fs.existsSync(dest) || sha256Buffer(fs.readFileSync(dest)) !== b.sha;
    if (needWrite) {
      fs.writeFileSync(dest, b.body);
      copied += 1;
      console.log(`[publish] 写入 blob: ${b.rel}`);
    } else {
      console.log(`[publish] 已存在跳过: ${b.rel}`);
    }
  }
  fs.copyFileSync(
    path.join(stageDir, 'host-update.json'),
    path.join(worktreePath, 'host-update.json')
  );
  console.log('[publish] wrote new blobs:', copied, '/', newBlobs.length);

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

  ensureOtaRemote(remoteName, owner, repo);
  console.log('[publish] pushing ' + remoteName + '/' + OTA_BRANCH + ' …');
  runGit(['push', '-u', remoteName, OTA_BRANCH], { cwd: worktreePath });

  fs.writeFileSync(
    path.join(stageDir, 'update.url.example'),
    manifestUrl + '\n'
  );

  console.log('');
  console.log('发布成功（Gitee）。');
  console.log('  Manifest:', manifestUrl);
  console.log('  其他人启动主机后会自动检测；也可在菜单点「检查更新」。');
  console.log('  旧包若仍指向 GitHub，可在主机目录放 update.url：');
  console.log('  ' + manifestUrl);

  if (args.skipVerify) {
    console.log('[publish] 已跳过下载检测（--skip-verify）');
    return;
  }

  if (!newBlobs.length) {
    console.log('[publish] 本次无新上传 blob，跳过下载检测');
    return;
  }

  const newSha = new Set(newBlobs.map((b) => b.sha));
  const toVerify = files.filter((f) => newSha.has(f.sha256));
  console.log(
    '[publish] 仅检测本次新上传的 ' + toVerify.length + ' 个文件（非全量）：'
  );
  const verifySorted = toVerify.slice().sort((a, b) => a.path.localeCompare(b.path));
  for (const f of verifySorted) {
    console.log('  · ' + f.path);
  }
  await runDownloadVerify(toVerify);
}

main().catch((err) => {
  console.error('[publish] failed:', err && err.message ? err.message : err);
  process.exit(1);
});
