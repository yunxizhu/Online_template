'use strict';

/**
 * Windows 主机差分 OTA：拉取远端 host-update.json，按 sha256 只下载变更文件并热替换。
 * 本地配置（可选）：
 *   update.url  — 一行，manifest URL（覆盖默认）
 *   update.off  — 存在则禁用自动检查
 *
 * 默认走 Gitee（国内可达）：
 *   https://gitee.com/yunxizhu/Online_template/raw/ota/host-update.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_MANIFEST_URL =
  'https://gitee.com/yunxizhu/Online_template/raw/ota/host-update.json';

const ALLOWED_PREFIXES = ['server/', 'public/'];
const ALLOWED_FILES = new Set(['package.json']);
const PROTECTED_NAMES = new Set([
  'update.url',
  'update.off',
  'mqtt.channel',
  'mqtt.broker',
  'mqtt.off',
  'node.exe',
  '启动.bat',
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
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
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
    const bust =
      this.manifestUrl +
      (this.manifestUrl.includes('?') ? '&' : '?') +
      '_=' +
      Date.now();
    const buf = await fetchBuffer(bust, { timeoutMs: 20000 });
    let manifest;
    try {
      manifest = JSON.parse(buf.toString('utf8'));
    } catch (_) {
      throw new Error('update manifest 不是合法 JSON');
    }
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
          localHash = sha256File(abs);
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

  /**
   * @param {{ restart?: boolean }} opts
   */
  async apply(opts = {}) {
    if (this.applying) throw new Error('正在更新中');
    this.applying = true;
    this.progress = {
      phase: 'prepare',
      message: '准备更新…',
      current: 0,
      total: 0,
      bytes: 0,
      totalBytes: 0,
    };
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
      this.progress = {
        phase: 'download',
        message: '下载文件…',
        current: 0,
        total: list.length,
        bytes: 0,
        totalBytes,
      };

      rmDirSafe(this.stagingDir);
      ensureDir(this.stagingDir);

      let bytesDone = 0;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        this.progress = {
          phase: 'download',
          message: '下载 ' + f.path,
          current: i,
          total: list.length,
          bytes: bytesDone,
          totalBytes,
        };
        const buf = await fetchBuffer(f.url, {
          timeoutMs: 120000,
          onData: (n) => {
            if (this.progress) this.progress.bytes = bytesDone + n;
          },
        });
        const got = sha256Buffer(buf);
        if (got !== f.sha256) {
          throw new Error('校验失败: ' + f.path);
        }
        const dest = path.join(this.stagingDir, ...f.path.split('/'));
        ensureDir(path.dirname(dest));
        fs.writeFileSync(dest, buf);
        bytesDone += buf.length;
        this.progress = {
          phase: 'download',
          message: '已下载 ' + f.path,
          current: i + 1,
          total: list.length,
          bytes: bytesDone,
          totalBytes,
        };
      }

      this.progress = {
        phase: 'apply',
        message: '写入文件…',
        current: 0,
        total: list.length,
        bytes: bytesDone,
        totalBytes,
      };

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
        this.progress = {
          phase: 'apply',
          message: '已写入 ' + f.path,
          current: i + 1,
          total: list.length,
          bytes: bytesDone,
          totalBytes,
        };
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

      this.progress = {
        phase: 'done',
        message: '更新完成',
        current: list.length,
        total: list.length,
        bytes: bytesDone,
        totalBytes,
      };

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
        this.progress = {
          ...this.progress,
          phase: 'restart',
          message: '即将重启服务…',
        };
      }

      return {
        ok: true,
        from: check.localVersion,
        to: check.remoteVersion,
        files: list.length,
        restart: doRestart,
      };
    } catch (err) {
      this.progress = {
        phase: 'error',
        message: err && err.message ? err.message : String(err),
        current: (this.progress && this.progress.current) || 0,
        total: (this.progress && this.progress.total) || 0,
        bytes: (this.progress && this.progress.bytes) || 0,
        totalBytes: (this.progress && this.progress.totalBytes) || 0,
        error: err && err.message ? err.message : String(err),
      };
      throw err;
    } finally {
      this.applying = false;
    }
  }
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
  fetchBuffer,
};
