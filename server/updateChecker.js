'use strict';

/**
 * Windows 主机差分 OTA：拉取远端 host-update.json，按 sha256 只下载变更文件并热替换。
 * 允许路径与绿版打包内容对齐（server/public/docs + 启动脚本等；不含 node_modules/node.exe/.tools）。
 * 本地配置（可选）：
 *   update.url  — 一行，manifest URL（覆盖默认）
 *   update.off  — 存在则禁用「启动前 / 大厅后台」自动检查；手动「检查更新」仍可检测并升级
 *
 * 默认走 Gitee（国内可达）：
 *   https://raw.giteeusercontent.com/xiyunzhu/online_template/raw/ota/host-update.json
 *   （也兼容 https://gitee.com/.../raw/ota/host-update.json，会 302 到上面）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_MANIFEST_URL =
  'https://raw.giteeusercontent.com/xiyunzhu/online_template/raw/ota/host-update.json';

const ALLOWED_PREFIXES = ['server/', 'public/', 'docs/'];
/** 与 Windows 绿版打包内容对齐（不含 node_modules / node.exe / .tools） */
const ALLOWED_FILES = new Set([
  'package.json',
  'scripts/check-host-update.js',
  '启动.bat',
  '_start-one.bat',
  '本机多开测试.bat',
  'README.txt',
]);
const PROTECTED_NAMES = new Set([
  'update.url',
  'update.off',
  'mqtt.channel',
  'mqtt.broker',
  'mqtt.off',
  'node.exe',
]);

function readOptionalLine(file) {
  try {
    const s = String(fs.readFileSync(file, 'utf8') || '').trim();
    return s.split(/\r?\n/)[0].trim();
  } catch (_) {
    return '';
  }
}

function cmpSemver(a, b) {
  const pa = String(a || '0')
    .replace(/^v/i, '')
    .split(/[^\d]+/)
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0')
    .replace(/^v/i, '')
    .split(/[^\d]+/)
    .map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function sha256File(filePath) {
  return sha256Buffer(readOtaBytes(filePath));
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 文本扩展名：OTA 统一按 LF 计算/上传，避免 Windows CRLF + git autocrlf 导致校验失败 */
const OTA_TEXT_EXT = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.htm',
  '.css',
  '.md',
  '.txt',
  '.svg',
  '.xml',
  '.yml',
  '.yaml',
  '.tsv',
  '.csv',
  '.map',
  '.bat',
  '.cmd',
  '.ps1',
  '.sh',
]);

function isOtaTextPath(relPath) {
  const ext = path.extname(String(relPath || '')).toLowerCase();
  return OTA_TEXT_EXT.has(ext);
}

/**
 * 读取文件并规范化为 OTA 内容（文本去 \\r，二进制原样）。
 * @returns {Buffer}
 */
function readOtaBytes(filePath, relPathHint) {
  const buf = fs.readFileSync(filePath);
  const rel = relPathHint || filePath;
  if (!isOtaTextPath(rel)) {
    // 含 NUL 的当二进制；无扩展名的小文本也尝试去 \\r
    if (buf.includes(0)) return buf;
    const base = path.basename(rel);
    if (base === 'package.json' || !path.extname(base)) {
      return normalizeTextBuffer(buf);
    }
    return buf;
  }
  return normalizeTextBuffer(buf);
}

function normalizeTextBuffer(buf) {
  // 已是合法 UTF-8 文本时去掉 CR；否则原样（避免误伤）
  const s = buf.toString('utf8');
  if (Buffer.byteLength(s, 'utf8') !== buf.length) return buf;
  if (!s.includes('\r')) return buf;
  return Buffer.from(s.replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'utf8');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function rmDirSafe(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function isPathAllowed(relPath) {
  const norm = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!norm || norm.includes('..') || path.isAbsolute(norm)) return false;
  if (PROTECTED_NAMES.has(norm.split('/').pop())) return false;
  if (ALLOWED_FILES.has(norm)) return true;
  return ALLOWED_PREFIXES.some((p) => norm === p.slice(0, -1) || norm.startsWith(p));
}

function resolveUnderRoot(rootDir, relPath) {
  const norm = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!isPathAllowed(norm)) {
    throw new Error('不允许更新的路径: ' + norm);
  }
  const abs = path.resolve(rootDir, ...norm.split('/'));
  const root = path.resolve(rootDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('路径越界: ' + norm);
  }
  return abs;
}

function fetchBuffer(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 60000;
  const maxRedirects = opts.maxRedirects == null ? 5 : opts.maxRedirects;
  return new Promise((resolve, reject) => {
    let settled = false;
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': 'lianji-host-update/1.0',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          ...(opts.headers || {}),
        },
      },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          if (maxRedirects <= 0) {
            if (!settled) {
              settled = true;
              reject(new Error('重定向过多'));
            }
            return;
          }
          const next = new URL(res.headers.location, url).href;
          fetchBuffer(next, { ...opts, maxRedirects: maxRedirects - 1 }).then(resolve, reject);
          return;
        }
        if (code < 200 || code >= 300) {
          res.resume();
          if (!settled) {
            settled = true;
            reject(new Error('HTTP ' + code + ' ' + url));
          }
          return;
        }
        const chunks = [];
        let received = 0;
        res.on('data', (c) => {
          chunks.push(c);
          received += c.length;
          if (typeof opts.onData === 'function') opts.onData(received);
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          resolve(Buffer.concat(chunks));
        });
        res.on('error', (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      if (!settled) {
        settled = true;
        reject(new Error('下载超时: ' + url));
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/**
 * 解析 Gitee raw / CDN 清单 URL → API contents 参数
 * 例: https://raw.giteeusercontent.com/owner/repo/raw/ota/host-update.json
 */
function parseGiteeManifestUrl(url) {
  const s = String(url || '').split('?')[0];
  let m = s.match(
    /raw\.giteeusercontent\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/i
  );
  if (m) {
    return { owner: m[1], repo: m[2], branch: m[3], filePath: m[4] };
  }
  m = s.match(/gitee\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/i);
  if (m) {
    return { owner: m[1], repo: m[2], branch: m[3], filePath: m[4] };
  }
  return null;
}

/**
 * 拉 host-update.json。优先 Gitee API（无 CDN 缓存），失败再走 raw URL。
 */
async function fetchManifestObject(manifestUrl) {
  const parsed = parseGiteeManifestUrl(manifestUrl);
  const errors = [];
  if (parsed) {
    const api =
      'https://gitee.com/api/v5/repos/' +
      encodeURIComponent(parsed.owner) +
      '/' +
      encodeURIComponent(parsed.repo) +
      '/contents/' +
      parsed.filePath
        .split('/')
        .map(encodeURIComponent)
        .join('/') +
      '?ref=' +
      encodeURIComponent(parsed.branch) +
      '&t=' +
      Date.now();
    try {
      const buf = await fetchBuffer(api, { timeoutMs: 25000 });
      const meta = JSON.parse(buf.toString('utf8'));
      if (!meta || !meta.content) {
        throw new Error('API 未返回 content');
      }
      const raw = Buffer.from(String(meta.content).replace(/\s/g, ''), 'base64');
      const manifest = JSON.parse(raw.toString('utf8'));
      return { manifest, source: 'gitee-api', api };
    } catch (err) {
      errors.push('api: ' + (err && err.message ? err.message : err));
    }
  }

  const bust =
    manifestUrl +
    (manifestUrl.includes('?') ? '&' : '?') +
    '_=' +
    Date.now();
  try {
    const buf = await fetchBuffer(bust, { timeoutMs: 20000 });
    const manifest = JSON.parse(buf.toString('utf8'));
    return { manifest, source: 'raw-cdn', url: bust };
  } catch (err) {
    errors.push('raw: ' + (err && err.message ? err.message : err));
    throw new Error('拉取 update manifest 失败: ' + errors.join(' | '));
  }
}

class HostUpdateChecker {
  /**
   * @param {{ rootDir: string, manifestUrl?: string }} opts
   */
  constructor(opts) {
    this.rootDir = path.resolve(opts.rootDir || path.join(__dirname, '..'));
    this.updateDir = path.join(this.rootDir, '.update');
    this.prevDir = path.join(this.rootDir, '.update-prev');
    this.stagingDir = path.join(this.updateDir, 'staging');
    this.restartFlag = path.join(this.updateDir, 'restart.flag');
    this.disabled = fs.existsSync(path.join(this.rootDir, 'update.off'));
    this.manifestUrl =
      (opts.manifestUrl && String(opts.manifestUrl).trim()) ||
      readOptionalLine(path.join(this.rootDir, 'update.url')) ||
      process.env.LIANJI_UPDATE_URL ||
      DEFAULT_MANIFEST_URL;

    /** @type {null | object} */
    this.lastCheck = null;
    /** @type {{ phase: string, message: string, current: number, total: number, bytes: number, totalBytes: number, error?: string } | null} */
    this.progress = null;
    this.applying = false;
    this._checkPromise = null;
  }

  getLocalVersion() {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(this.rootDir, 'package.json'), 'utf8')
      );
      return String(pkg.version || '0.0.0');
    } catch (_) {
      return '0.0.0';
    }
  }

  getStatus() {
    const localVersion = this.getLocalVersion();
    const base = {
      enabled: !this.disabled,
      manifestUrl: this.manifestUrl,
      localVersion,
      applying: this.applying,
      progress: this.progress,
    };
    if (!this.lastCheck) {
      return {
        ...base,
        checked: false,
        available: false,
      };
    }
    return {
      ...base,
      checked: true,
      ...this.lastCheck,
    };
  }

  async check(opts = {}) {
    if (this.disabled && !opts.force) {
      this.lastCheck = {
        available: false,
        skipped: true,
        reason: 'disabled',
        localVersion: this.getLocalVersion(),
      };
      return this.lastCheck;
    }
    if (this._checkPromise && !opts.force) return this._checkPromise;
    this._checkPromise = this._doCheck()
      .catch((err) => {
        const fail = {
          available: false,
          error: err && err.message ? err.message : String(err),
          localVersion: this.getLocalVersion(),
        };
        this.lastCheck = fail;
        return fail;
      })
      .finally(() => {
        this._checkPromise = null;
      });
    return this._checkPromise;
  }

  async _doCheck() {
    const localVersion = this.getLocalVersion();
    const { manifest, source } = await fetchManifestObject(this.manifestUrl);
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('update manifest 无效');
    }
    const remoteVersion = String(manifest.version || '');
    if (!remoteVersion) throw new Error('manifest 缺少 version');
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (!files.length) throw new Error('manifest 没有 files');

    const force = Boolean(manifest.force);
    const newer = cmpSemver(localVersion, remoteVersion) < 0;
    const belowMin =
      manifest.minVersion && cmpSemver(localVersion, manifest.minVersion) < 0;

    const changed = [];
    let totalBytes = 0;
    for (const f of files) {
      const rel = String(f.path || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (!isPathAllowed(rel)) continue;
      const want = String(f.sha256 || '').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(want)) {
        throw new Error('无效 sha256: ' + rel);
      }
      if (!f.url) throw new Error('缺少 url: ' + rel);
      let localHash = '';
      try {
        const abs = resolveUnderRoot(this.rootDir, rel);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          localHash = sha256Buffer(readOtaBytes(abs, rel));
        }
      } catch (_) {
        localHash = '';
      }
      if (localHash !== want) {
        const size = Number(f.size) || 0;
        totalBytes += size;
        changed.push({
          path: rel,
          sha256: want,
          size,
          url: String(f.url),
        });
      }
    }

    const available = (newer || force || belowMin) && changed.length > 0;
    // 版本已新但文件不一致：仍提示（修复损坏/半更新）
    const repairOnly =
      !newer && !force && !belowMin && changed.length > 0
        ? false
        : false;

    const result = {
      available: available || (cmpSemver(localVersion, remoteVersion) === 0 && changed.length > 0),
      localVersion,
      remoteVersion,
      notes: String(manifest.notes || ''),
      notesEn: String(manifest.notes_en || manifest.notesEn || ''),
      force: force || Boolean(belowMin),
      minVersion: manifest.minVersion ? String(manifest.minVersion) : '',
      publishedAt: manifest.publishedAt || '',
      changedCount: changed.length,
      totalBytes,
      changed,
      manifestSource: source || '',
      repair: !newer && changed.length > 0 && cmpSemver(localVersion, remoteVersion) >= 0,
    };
    // 同版本但有文件差异 → 也允许修复升级
    if (result.repair) result.available = true;
    if (!newer && !force && !belowMin && !result.repair) {
      result.available = false;
    }
    void repairOnly;
    this.lastCheck = result;
    return result;
  }

  /** 控制台可读的检测摘要（启动.bat / 日志用） */
  formatCheckReport(result) {
    const r = result || this.lastCheck || {};
    const lines = [];
    lines.push('[update] -------- 主机更新检测 --------');
    lines.push('[update] 清单: ' + this.manifestUrl);
    if (r.manifestSource) {
      lines.push('[update] 来源: ' + r.manifestSource);
    }
    if (this.disabled) {
      lines.push('[update] 状态: 已禁用（存在 update.off）');
      lines.push('[update] --------------------------------');
      return lines.join('\n');
    }
    if (r.error) {
      lines.push('[update] 状态: 检查失败');
      lines.push('[update] 错误: ' + r.error);
      lines.push('[update] 本地版本: ' + (r.localVersion || this.getLocalVersion()));
      lines.push('[update] --------------------------------');
      return lines.join('\n');
    }
    if (r.skipped) {
      lines.push('[update] 状态: 已跳过 (' + (r.reason || '') + ')');
      lines.push('[update] --------------------------------');
      return lines.join('\n');
    }
    lines.push(
      '[update] 本地: ' +
        (r.localVersion || this.getLocalVersion()) +
        '  |  线上: ' +
        (r.remoteVersion || '?')
    );
    if (r.publishedAt) lines.push('[update] 发布时间: ' + r.publishedAt);
    if (r.notes) lines.push('[update] 说明: ' + r.notes);
    if (r.available) {
      lines.push(
        '[update] 结果: 检测到升级 — ' +
          (r.changedCount || 0) +
          ' 个文件 / 约 ' +
          formatBytes(r.totalBytes || 0)
      );
      lines.push('[update] 目标版本: ' + (r.remoteVersion || '?'));
    } else {
      const local = r.localVersion || this.getLocalVersion();
      const remote = r.remoteVersion || '';
      if (remote && cmpSemver(local, remote) > 0) {
        lines.push(
          '[update] 结果: 本地版本新于线上（无需升级；若刚发版请确认已 push 成功）'
        );
      } else if (remote && cmpSemver(local, remote) === 0) {
        lines.push(
          '[update] 结果: 已是最新（本地与线上版本相同）'
        );
      } else {
        lines.push('[update] 结果: 无需更新');
      }
    }
    lines.push('[update] --------------------------------');
    return lines.join('\n');
  }

  /**
   * @param {{ restart?: boolean, onProgress?: (p: object) => void }} opts
   */
  async apply(opts = {}) {
    if (this.applying) throw new Error('正在更新中');
    this.applying = true;
    const setProgress = (p) => {
      this.progress = p;
      if (typeof opts.onProgress === 'function') {
        try {
          opts.onProgress(p);
        } catch (_) {}
      }
    };
    setProgress({
      phase: 'prepare',
      message: '准备更新…',
      current: 0,
      total: 0,
      bytes: 0,
      totalBytes: 0,
    });
    try {
      let check = this.lastCheck;
      if (!check || !check.available || !Array.isArray(check.changed)) {
        check = await this.check({ force: true });
      }
      if (!check.available || !check.changed.length) {
        throw new Error('当前没有可应用的更新');
      }

      const list = check.changed;
      const totalBytes = list.reduce((s, f) => s + (Number(f.size) || 0), 0);
      setProgress({
        phase: 'download',
        message: '下载文件…',
        current: 0,
        total: list.length,
        bytes: 0,
        totalBytes,
      });

      rmDirSafe(this.stagingDir);
      ensureDir(this.stagingDir);

      const MAX_UPGRADE_ATTEMPTS = 3;
      let bytesDone = 0;
      let downloadIndex = 0;
      let upgradeAttempt = 1;

      while (downloadIndex < list.length) {
        const f = list[downloadIndex];
        setProgress({
          phase: 'download',
          message: '下载 ' + f.path,
          current: downloadIndex,
          total: list.length,
          bytes: bytesDone,
          totalBytes,
          file: f.path,
          attempt: upgradeAttempt,
          maxAttempts: MAX_UPGRADE_ATTEMPTS,
        });
        try {
          const buf = await fetchBuffer(f.url, {
            timeoutMs: 120000,
            onData: (n) => {
              if (this.progress) this.progress.bytes = bytesDone + n;
            },
          });
          // 文本再规范化一次，兼容旧版误传的 CRLF blob / CDN 改写
          const body = isOtaTextPath(f.path) ? normalizeTextBuffer(buf) : buf;
          const got = sha256Buffer(body);
          if (got !== f.sha256) {
            throw new Error(
              '校验失败: ' +
                f.path +
                '（下载 ' +
                buf.length +
                ' 字节，期望 sha ' +
                f.sha256.slice(0, 8) +
                '…）'
            );
          }
          const dest = path.join(this.stagingDir, ...f.path.split('/'));
          ensureDir(path.dirname(dest));
          fs.writeFileSync(dest, body);
          bytesDone += buf.length;
          setProgress({
            phase: 'download',
            message: '已下载 ' + f.path,
            current: downloadIndex + 1,
            total: list.length,
            bytes: bytesDone,
            totalBytes,
            file: f.path,
            attempt: upgradeAttempt,
            maxAttempts: MAX_UPGRADE_ATTEMPTS,
          });
          downloadIndex += 1;
        } catch (err) {
          const errMsg = err && err.message ? err.message : String(err);
          if (upgradeAttempt >= MAX_UPGRADE_ATTEMPTS) {
            throw new Error(
              '升级失败（已尝试 ' +
                MAX_UPGRADE_ATTEMPTS +
                ' 次，停在 ' +
                f.path +
                '）: ' +
                errMsg
            );
          }
          upgradeAttempt += 1;
          setProgress({
            phase: 'download',
            message:
              '升级异常，从 ' +
              f.path +
              ' 开始重新下载（第 ' +
              upgradeAttempt +
              '/' +
              MAX_UPGRADE_ATTEMPTS +
              ' 次）…',
            current: downloadIndex,
            total: list.length,
            bytes: bytesDone,
            totalBytes,
            file: f.path,
            attempt: upgradeAttempt,
            maxAttempts: MAX_UPGRADE_ATTEMPTS,
            error: errMsg,
            retrying: true,
          });
          // CDN / 网络抖动时稍等再从失败文件续下
          await new Promise((r) => setTimeout(r, 1000 * upgradeAttempt));
        }
      }

      // 断点续传后，对 staging 做一次全量校验，避免先前已下载文件损坏/被改写
      const verifyStaged = () => {
        const bad = [];
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          setProgress({
            phase: 'verify',
            message: '校验 ' + f.path,
            current: i,
            total: list.length,
            bytes: bytesDone,
            totalBytes,
            file: f.path,
          });
          const staged = path.join(this.stagingDir, ...f.path.split('/'));
          if (!fs.existsSync(staged) || !fs.statSync(staged).isFile()) {
            bad.push({ file: f, reason: '文件缺失' });
            continue;
          }
          try {
            const body = readOtaBytes(staged, f.path);
            const got = sha256Buffer(body);
            if (got !== f.sha256) {
              bad.push({
                file: f,
                reason:
                  '校验失败（' +
                  body.length +
                  ' 字节，期望 sha ' +
                  f.sha256.slice(0, 8) +
                  '…）',
              });
            }
          } catch (err) {
            bad.push({
              file: f,
              reason: err && err.message ? err.message : String(err),
            });
          }
          setProgress({
            phase: 'verify',
            message: '已校验 ' + f.path,
            current: i + 1,
            total: list.length,
            bytes: bytesDone,
            totalBytes,
            file: f.path,
          });
        }
        return bad;
      };

      setProgress({
        phase: 'verify',
        message: '全量校验已下载文件…',
        current: 0,
        total: list.length,
        bytes: bytesDone,
        totalBytes,
      });
      let badStaged = verifyStaged();
      if (badStaged.length) {
        setProgress({
          phase: 'verify',
          message:
            '发现 ' +
            badStaged.length +
            ' 个文件校验失败，重新下载…',
          current: 0,
          total: list.length,
          bytes: bytesDone,
          totalBytes,
          retrying: true,
          error:
            badStaged
              .slice(0, 5)
              .map((b) => b.file.path + ': ' + b.reason)
              .join('; ') + (badStaged.length > 5 ? ' …' : ''),
        });

        for (const item of badStaged) {
          const f = item.file;
          let repaired = false;
          let lastErr = item.reason;
          for (
            let attempt = 1;
            attempt <= MAX_UPGRADE_ATTEMPTS && !repaired;
            attempt++
          ) {
            setProgress({
              phase: 'download',
              message: '重新下载 ' + f.path,
              current: list.indexOf(f),
              total: list.length,
              bytes: bytesDone,
              totalBytes,
              file: f.path,
              attempt,
              maxAttempts: MAX_UPGRADE_ATTEMPTS,
            });
            try {
              const buf = await fetchBuffer(f.url, {
                timeoutMs: 120000,
                onData: (n) => {
                  if (this.progress) this.progress.bytes = bytesDone + n;
                },
              });
              const body = isOtaTextPath(f.path) ? normalizeTextBuffer(buf) : buf;
              const got = sha256Buffer(body);
              if (got !== f.sha256) {
                throw new Error(
                  '校验失败: ' +
                    f.path +
                    '（下载 ' +
                    buf.length +
                    ' 字节，期望 sha ' +
                    f.sha256.slice(0, 8) +
                    '…）'
                );
              }
              const dest = path.join(this.stagingDir, ...f.path.split('/'));
              ensureDir(path.dirname(dest));
              fs.writeFileSync(dest, body);
              repaired = true;
            } catch (err) {
              lastErr = err && err.message ? err.message : String(err);
              if (attempt < MAX_UPGRADE_ATTEMPTS) {
                await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
              }
            }
          }
          if (!repaired) {
            throw new Error(
              '全量校验后重新下载失败: ' + f.path + '（' + lastErr + '）'
            );
          }
        }

        badStaged = verifyStaged();
        if (badStaged.length) {
          throw new Error(
            '全量校验仍失败（' +
              badStaged.length +
              ' 个）: ' +
              badStaged
                .slice(0, 5)
                .map((b) => b.file.path)
                .join(', ') +
              (badStaged.length > 5 ? ' …' : '')
          );
        }
      }

      setProgress({
        phase: 'apply',
        message: '写入文件…',
        current: 0,
        total: list.length,
        bytes: bytesDone,
        totalBytes,
      });

      rmDirSafe(this.prevDir);
      ensureDir(this.prevDir);

      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        const staged = path.join(this.stagingDir, ...f.path.split('/'));
        const target = resolveUnderRoot(this.rootDir, f.path);
        ensureDir(path.dirname(target));
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
          const bak = path.join(this.prevDir, ...f.path.split('/'));
          ensureDir(path.dirname(bak));
          fs.copyFileSync(target, bak);
        }
        fs.copyFileSync(staged, target);
        setProgress({
          phase: 'apply',
          message: '已写入 ' + f.path,
          current: i + 1,
          total: list.length,
          bytes: bytesDone,
          totalBytes,
          file: f.path,
        });
      }

      // 若 package.json 未在变更列表里，仍把版本号对齐到远端（避免反复提示）
      try {
        const pkgPath = path.join(this.rootDir, 'package.json');
        if (fs.existsSync(pkgPath) && check.remoteVersion) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (String(pkg.version) !== String(check.remoteVersion)) {
            const bak = path.join(this.prevDir, 'package.json');
            ensureDir(path.dirname(bak));
            if (!fs.existsSync(bak)) fs.copyFileSync(pkgPath, bak);
            pkg.version = check.remoteVersion;
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
          }
        }
      } catch (err) {
        console.warn('[update] 对齐 package.json 版本失败:', err && err.message);
      }

      rmDirSafe(this.stagingDir);
      ensureDir(this.updateDir);
      fs.writeFileSync(
        path.join(this.updateDir, 'last-apply.json'),
        JSON.stringify(
          {
            at: new Date().toISOString(),
            from: check.localVersion,
            to: check.remoteVersion,
            files: list.map((f) => f.path),
          },
          null,
          2
        ) + '\n'
      );

      setProgress({
        phase: 'done',
        message: '更新完成',
        current: list.length,
        total: list.length,
        bytes: bytesDone,
        totalBytes,
      });

      this.lastCheck = {
        ...check,
        available: false,
        changed: [],
        changedCount: 0,
        totalBytes: 0,
        applied: true,
        localVersion: check.remoteVersion,
      };

      const doRestart = opts.restart !== false;
      if (doRestart) {
        ensureDir(this.updateDir);
        fs.writeFileSync(this.restartFlag, new Date().toISOString() + '\n');
        fs.writeFileSync(
          path.join(this.updateDir, 'skip-browser.flag'),
          '1\n'
        );
        setProgress({
          ...this.progress,
          phase: 'restart',
          message: '即将重启服务…',
        });
      }

      return {
        ok: true,
        from: check.localVersion,
        to: check.remoteVersion,
        files: list.length,
        restart: doRestart,
      };
    } catch (err) {
      setProgress({
        phase: 'error',
        message: err && err.message ? err.message : String(err),
        current: (this.progress && this.progress.current) || 0,
        total: (this.progress && this.progress.total) || 0,
        bytes: (this.progress && this.progress.bytes) || 0,
        totalBytes: (this.progress && this.progress.totalBytes) || 0,
        error: err && err.message ? err.message : String(err),
      });
      throw err;
    } finally {
      this.applying = false;
    }
  }
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
  return (v / (1024 * 1024)).toFixed(1) + ' MB';
}

HostUpdateChecker.DEFAULT_MANIFEST_URL = DEFAULT_MANIFEST_URL;
HostUpdateChecker.cmpSemver = cmpSemver;
HostUpdateChecker.isPathAllowed = isPathAllowed;
HostUpdateChecker.sha256File = sha256File;

module.exports = {
  HostUpdateChecker,
  DEFAULT_MANIFEST_URL,
  cmpSemver,
  isPathAllowed,
  sha256File,
  sha256Buffer,
  fetchBuffer,
  fetchManifestObject,
  parseGiteeManifestUrl,
  readOtaBytes,
  normalizeTextBuffer,
  isOtaTextPath,
};
