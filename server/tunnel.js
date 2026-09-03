'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const dns = require('dns').promises;
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');

const TOOLS_DIR = path.join(__dirname, '..', '.tools');

/** 随仓库分发的 cloudflared（git 跟踪，clone 即用） */
const VENDORED_CLOUDFLARED = {
  'win32:amd64': 'cloudflared.exe',
  'win32:arm64': 'cloudflared.exe',
  'darwin:amd64': 'cloudflared-darwin-amd64',
  'darwin:arm64': 'cloudflared-darwin-arm64',
  'linux:amd64': 'cloudflared-linux-amd64',
  'linux:arm64': 'cloudflared-linux-arm64',
};

const VENDORED_CLOUDFLARED_FILES = [
  'cloudflared.exe',
  'cloudflared-darwin-amd64',
  'cloudflared-darwin-arm64',
];

/** 打包时分平台拷贝（git 仓库仍保留全平台） */
const VENDORED_CLOUDFLARED_BY_PLATFORM = {
  win32: ['cloudflared.exe'],
  darwin: ['cloudflared-darwin-amd64', 'cloudflared-darwin-arm64'],
};

function vendoredCloudflaredFilesFor(platform) {
  if (platform === 'win32') return VENDORED_CLOUDFLARED_BY_PLATFORM.win32;
  if (platform === 'darwin') return VENDORED_CLOUDFLARED_BY_PLATFORM.darwin;
  return VENDORED_CLOUDFLARED_FILES;
}
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** 公网地址探活间隔（进程仍在但 trycloudflare 域名已死时靠此换新） */
const HEALTH_INTERVAL_MS = Math.max(
  5000,
  Number(process.env.TUNNEL_HEALTH_MS) || 15000
);
/** 拿到新 URL 后多久再开始探活（给 DNS 传播留时间） */
const HEALTH_WARMUP_MS = Math.max(
  0,
  Number(process.env.TUNNEL_HEALTH_WARMUP_MS) || 25000
);
/** 连续探活失败几次后强制换隧道（DNS 不再一票否决） */
const HEALTH_FAILS = Math.max(
  1,
  Number(process.env.TUNNEL_HEALTH_FAILS) || 4
);
const HEALTH_TIMEOUT_MS = Math.max(
  2000,
  Number(process.env.TUNNEL_HEALTH_TIMEOUT_MS) || 8000
);

/**
 * 本机 DNS 对 trycloudflare 经常假阴性；系统解析失败时再用公共 DNS 复核。
 */
function resolveHostname(hostname) {
  return dns.lookup(hostname).then(
    () => ({ ok: true, via: 'system' }),
    async (err) => {
      try {
        const resolver = new dns.Resolver();
        resolver.setServers(['1.1.1.1', '8.8.8.8']);
        await resolver.resolve4(hostname);
        return { ok: true, via: 'public-dns' };
      } catch (err2) {
        const code =
          (err2 && err2.code) || (err && err.code) || 'ENOTFOUND';
        return {
          ok: false,
          code,
          reason: `dns:${code}`,
        };
      }
    }
  );
}

/**
 * 探测公网隧道是否仍可达。
 * - HTTPS 任意响应（含 502/530）→ 域名仍在边缘，视为存活
 * - DNS / 超时 / 连接失败 → 可累计后换址（不再把 ENOTFOUND 当 fatal）
 */
function probeTunnelUrl(urlString, ops = {}) {
  const opts = ops || {};
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || HEALTH_TIMEOUT_MS);
  let hostname;
  let href;
  try {
    const u = new URL(urlString);
    hostname = u.hostname;
    href = u.href;
  } catch (_) {
    return Promise.resolve({ ok: false, reason: 'bad-url', fatal: true });
  }
  if (!hostname) {
    return Promise.resolve({ ok: false, reason: 'bad-url', fatal: true });
  }

  return resolveHostname(hostname).then((dnsResult) => {
    if (!dnsResult.ok) {
      return {
        ok: false,
        reason: dnsResult.reason || 'dns:ENOTFOUND',
        fatal: false,
      };
    }
    return new Promise((resolve) => {
      const getter = href.startsWith('https') ? https : http;
      const req = getter.get(
        href,
        {
          timeout: timeoutMs,
          headers: { 'User-Agent': 'lianji-tunnel-health' },
        },
        (res) => {
          res.resume();
          // 边缘还能回状态码 ⇒ 域名未作废（本地服务挂了也可能 502）
          resolve({
            ok: true,
            status: res.statusCode,
            dnsVia: dnsResult.via,
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, reason: 'timeout', fatal: false });
      });
      req.on('error', (err) => {
        const code = (err && err.code) || '';
        resolve({
          ok: false,
          reason: code || (err && err.message) || 'http-error',
          fatal: false,
        });
      });
    });
  });
}

function cloudflaredPlatformKey(platform, arch) {
  const p = platform || process.platform;
  const a = arch || process.arch;
  const normArch = a === 'arm64' ? 'arm64' : 'amd64';
  return `${p}:${normArch}`;
}

function vendoredCloudflaredFileName(platform, arch) {
  return VENDORED_CLOUDFLARED[cloudflaredPlatformKey(platform, arch)] || null;
}

function vendoredCloudflaredPath(platform, arch) {
  const name = vendoredCloudflaredFileName(platform, arch);
  if (!name) return null;
  const p = path.join(TOOLS_DIR, name);
  return fs.existsSync(p) ? p : null;
}

function binUsable(p) {
  if (!p || !fs.existsSync(p)) return false;
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size < 4096) return false;
  } catch (_) {
    return false;
  }
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync(p, ['--version'], { timeout: 10000, windowsHide: true });
    if (r.error) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function copyVendoredCloudflaredTo(destToolsDir, opts = {}) {
  fs.mkdirSync(destToolsDir, { recursive: true });
  const names = opts.platform
    ? vendoredCloudflaredFilesFor(opts.platform)
    : VENDORED_CLOUDFLARED_FILES;
  const copied = [];
  for (const name of names) {
    const src = path.join(TOOLS_DIR, name);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(destToolsDir, name);
    fs.copyFileSync(src, dst);
    if (process.platform !== 'win32' || !name.endsWith('.exe')) {
      try {
        fs.chmodSync(dst, 0o755);
      } catch (_) {
        /* ignore */
      }
    }
    copied.push(name);
  }
  if (!opts.quiet && copied.length) {
    console.log('[tunnel] copied vendored cloudflared:', copied.join(', '));
  }
  return copied;
}

function cloudflaredBinaryName() {
  if (process.platform === 'win32') return 'cloudflared.exe';
  return 'cloudflared';
}

function cloudflaredDownloadUrl() {
  // latest/download redirects to the current release asset
  const base =
    'https://github.com/cloudflare/cloudflared/releases/latest/download';
  if (process.platform === 'win32') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    return `${base}/cloudflared-windows-${arch}.exe`;
  }
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    return `${base}/cloudflared-darwin-${arch}.tgz`;
  }
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  return `${base}/cloudflared-linux-${arch}`;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith('https') ? https : http;
    const req = getter.get(url, { headers: { 'User-Agent': 'lianji' } }, (res) => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        let redirectUrl;
        try {
          redirectUrl = new URL(res.headers.location, url).href;
        } catch (_) {
          reject(new Error(`invalid redirect location: ${res.headers.location}`));
          return;
        }
        downloadFile(redirectUrl, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`download failed HTTP ${res.statusCode}`));
        return;
      }
      const out = createWriteStream(dest);
      pipeline(res, out).then(resolve, (err) => {
        try { fs.unlinkSync(dest); } catch (_) {}
        reject(err);
      });
    });
    req.on('error', (err) => {
      try { fs.unlinkSync(dest); } catch (_) {}
      reject(err);
    });
  });
}

async function ensureCloudflared() {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });

  const vendored = vendoredCloudflaredPath();
  if (vendored && binUsable(vendored)) {
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(vendored, 0o755);
      } catch (_) {
        /* ignore */
      }
    }
    return vendored;
  }

  const bin = path.join(TOOLS_DIR, cloudflaredBinaryName());
  if (binUsable(bin)) return bin;
  try {
    fs.unlinkSync(bin);
  } catch (_) {
    /* ignore */
  }

  const url = cloudflaredDownloadUrl();
  console.log('[tunnel] 仓库内无可用 cloudflared，正在下载…');
  console.log('[tunnel]', url);

  if (process.platform === 'darwin' && url.endsWith('.tgz')) {
    const tgz = path.join(TOOLS_DIR, 'cloudflared.tgz');
    await downloadFile(url, tgz);
    const { execFileSync } = require('child_process');
    execFileSync('tar', ['-xzf', tgz, '-C', TOOLS_DIR], { stdio: 'ignore' });
    const extracted = path.join(TOOLS_DIR, 'cloudflared');
    if (!fs.existsSync(extracted)) {
      throw new Error('cloudflared extract failed');
    }
    fs.chmodSync(extracted, 0o755);
    fs.unlinkSync(tgz);
    return extracted;
  }

  await downloadFile(url, bin);
  if (process.platform !== 'win32') {
    fs.chmodSync(bin, 0o755);
  }
  console.log('[tunnel] cloudflared 已安装到', bin);
  return bin;
}

/**
 * Cloudflare Quick Tunnel for a local HTTP port.
 * trycloudflare 快速隧道不稳定：进程退出或公网域名僵死时都必须自动拉起并换新域名。
 */
class QuickTunnel {
  constructor(opts = {}) {
    this.proc = null;
    this.publicUrl = null;
    this._port = null;
    this._starting = null;
    this._stopped = false;
    this._gen = 0;
    this._restartTimer = null;
    this._backoffMs = 1500;
    this._logLines = [];
    this._healthTimer = null;
    this._healthFails = 0;
    this._healthRunning = false;
    this.onUrl = typeof opts.onUrl === 'function' ? opts.onUrl : null;
    this.onLost = typeof opts.onLost === 'function' ? opts.onLost : null;
    this._probe =
      typeof opts.probe === 'function' ? opts.probe : probeTunnelUrl;
  }

  /** @returns {Promise<string>} public https URL */
  async ensure(localPort) {
    const port = Number(localPort);
    if (!port) throw new Error('invalid local port');
    this._stopped = false;
    this._port = port;
    if (this.proc && this.publicUrl && this._port === port) {
      return this.publicUrl;
    }
    if (this._starting) return this._starting;

    this._clearRestart();
    if (this.proc) this._killProc();

    this._starting = this._start(port).finally(() => {
      this._starting = null;
    });
    return this._starting;
  }

  async _start(port) {
    const bin = await ensureCloudflared();
    if (this._stopped) throw new Error('tunnel stopped');
    this._port = port;
    this.publicUrl = null;
    this._clearHealth();
    const gen = ++this._gen;

    const protocol = String(process.env.TUNNEL_PROTOCOL || 'http2').trim() || 'http2';
    const args = [
      'tunnel',
      '--url',
      `http://127.0.0.1:${port}`,
      '--no-autoupdate',
      '--protocol',
      protocol,
    ];

    return new Promise((resolve, reject) => {
      let settled = false;
      const failTimer = setTimeout(() => {
        if (settled || gen !== this._gen) return;
        settled = true;
        this._killProc();
        reject(new Error('cloudflared 启动超时（未拿到公网 URL）'));
        this._scheduleRestart();
      }, 90000);

      const proc = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1' },
      });
      this.proc = proc;

      const onChunk = (buf) => {
        if (gen !== this._gen) return;
        const text = buf.toString('utf8');
        this._rememberLog(text);
        const m = text.match(URL_RE);
        if (m && !this.publicUrl) {
          this.publicUrl = m[0].replace(/\/$/, '');
          this._backoffMs = 1500;
          this._healthFails = 0;
          console.log('[tunnel] 公网地址:', this.publicUrl);
          if (typeof this.onUrl === 'function') {
            try {
              this.onUrl(this.publicUrl);
            } catch (_) {
              /* ignore */
            }
          }
          this._armHealth();
          if (!settled) {
            settled = true;
            clearTimeout(failTimer);
            resolve(this.publicUrl);
          }
        }
      };

      proc.stdout.on('data', onChunk);
      proc.stderr.on('data', onChunk);

      proc.on('error', (err) => {
        if (gen !== this._gen) return;
        if (this.proc === proc) this.proc = null;
        this._clearHealth();
        if (settled) {
          this._scheduleRestart();
          return;
        }
        settled = true;
        clearTimeout(failTimer);
        reject(err);
        this._scheduleRestart();
      });

      proc.on('exit', (code, signal) => {
        clearTimeout(failTimer);
        if (gen !== this._gen) return;
        if (this.proc === proc) {
          this.proc = null;
          this.publicUrl = null;
        }
        this._clearHealth();
        const tail = this._logLines.slice(-6).join(' | ');
        const why = `code=${code} signal=${signal || '-'}${
          tail ? ` 日志: ${tail}` : ''
        }`;
        if (!settled) {
          settled = true;
          reject(new Error(`cloudflared 退出 ${why}`));
          this._scheduleRestart();
          return;
        }
        if (this._stopped) return;
        console.warn('[tunnel] cloudflared 已退出', why);
        this._clearRestart();
        this._backoffMs = Math.min(this._backoffMs, 300);
        if (typeof this.onLost === 'function') {
          try {
            this.onLost();
          } catch (_) {
            /* ignore */
          }
        }
        this._scheduleRestart();
      });
    });
  }

  _rememberLog(text) {
    const parts = String(text || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const line of parts) {
      this._logLines.push(line.slice(0, 240));
    }
    if (this._logLines.length > 40) {
      this._logLines = this._logLines.slice(-40);
    }
  }

  _clearRestart() {
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
  }

  _clearHealth() {
    if (this._healthTimer) {
      clearTimeout(this._healthTimer);
      this._healthTimer = null;
    }
    this._healthRunning = false;
  }

  _armHealth() {
    this._clearHealth();
    if (this._stopped || !this.publicUrl) return;
    this._healthTimer = setTimeout(() => {
      this._healthTimer = null;
      this._runHealthTick();
    }, HEALTH_WARMUP_MS);
    if (typeof this._healthTimer.unref === 'function') this._healthTimer.unref();
  }

  _scheduleHealthTick() {
    this._clearHealth();
    if (this._stopped || !this.publicUrl || !this.proc) return;
    this._healthTimer = setTimeout(() => {
      this._healthTimer = null;
      this._runHealthTick();
    }, HEALTH_INTERVAL_MS);
    if (typeof this._healthTimer.unref === 'function') this._healthTimer.unref();
  }

  async _runHealthTick() {
    if (this._stopped || this._healthRunning) return;
    const url = this.publicUrl;
    if (!url || !this.proc) return;
    this._healthRunning = true;
    let result;
    try {
      result = await this._probe(url, { timeoutMs: HEALTH_TIMEOUT_MS });
    } catch (err) {
      result = {
        ok: false,
        reason: (err && err.message) || 'probe-error',
        fatal: false,
      };
    } finally {
      this._healthRunning = false;
    }
    // 探活期间已换址 / 进程已死则忽略
    if (this._stopped || this.publicUrl !== url || !this.proc) return;

    if (result && result.ok) {
      this._healthFails = 0;
      this._scheduleHealthTick();
      return;
    }

    this._healthFails += 1;
    const reason = (result && result.reason) || 'unknown';
    const fatal = Boolean(result && result.fatal);
    console.warn(
      `[tunnel] 公网探活失败 (${this._healthFails}/${HEALTH_FAILS}` +
        `${fatal ? ', fatal' : ''}): ${reason}`
    );
    if (fatal || this._healthFails >= HEALTH_FAILS) {
      this._forceRotate(reason);
      return;
    }
    this._scheduleHealthTick();
  }

  /**
   * 进程可能仍在，但 trycloudflare 域名已死：杀进程、立刻换新隧道。
   * 对局房间仍留在本机内存；MQTT 心跳由 onLost → markTunnelLost 续上。
   * （_killProc 会抬高 _gen，exit 回调不会再走 onLost/_scheduleRestart）
   */
  _forceRotate(reason) {
    if (this._stopped) return;
    const dead = this.publicUrl;
    console.warn(
      `[tunnel] 公网地址失效，强制换新` +
        `${dead ? `（旧址 ${dead}）` : ''}: ${reason || 'health'}`
    );
    this._clearHealth();
    this._clearRestart();
    this.publicUrl = null;
    this._healthFails = 0;
    this._backoffMs = Math.min(this._backoffMs || 200, 200);
    this._killProc();
    if (typeof this.onLost === 'function') {
      try {
        this.onLost();
      } catch (_) {
        /* ignore */
      }
    }
    this._scheduleRestart();
  }

  _scheduleRestart() {
    if (this._stopped || this._restartTimer) return;
    if (this.proc && this.publicUrl) return;
    const port = this._port;
    if (!port) return;
    const delay = this._backoffMs;
    this._backoffMs = Math.min(Math.round(this._backoffMs * 1.8), 30000);
    console.log(`[tunnel] ${Math.round(delay / 100) / 10}s 后自动重连…`);
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      if (this._stopped) return;
      if (this.proc && this.publicUrl) return;
      this.ensure(port).catch((err) => {
        console.warn(
          '[tunnel] 重连失败:',
          err && err.message ? err.message : err
        );
      });
    }, delay);
    if (typeof this._restartTimer.unref === 'function') this._restartTimer.unref();
  }

  _killProc() {
    this._gen += 1;
    const proc = this.proc;
    this.proc = null;
    this.publicUrl = null;
    this._clearHealth();
    if (!proc) return;
    try {
      proc.kill('SIGTERM');
    } catch (_) {
      /* ignore */
    }
    const killer = setTimeout(() => {
      try {
        if (!proc.killed) proc.kill('SIGKILL');
      } catch (_) {
        /* ignore */
      }
    }, 2000);
    if (typeof killer.unref === 'function') killer.unref();
  }

  stop() {
    this._stopped = true;
    this._clearRestart();
    this._clearHealth();
    this._killProc();
    this._port = null;
  }

  getPublicUrl() {
    return this.publicUrl;
  }
}

module.exports = {
  QuickTunnel,
  ensureCloudflared,
  probeTunnelUrl,
  downloadFile,
  TOOLS_DIR,
  VENDORED_CLOUDFLARED_FILES,
  VENDORED_CLOUDFLARED_BY_PLATFORM,
  vendoredCloudflaredFilesFor,
  copyVendoredCloudflaredTo,
  vendoredCloudflaredPath,
};
