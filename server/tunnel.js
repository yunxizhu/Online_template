'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');

const TOOLS_DIR = path.join(__dirname, '..', '.tools');
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

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
        downloadFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`download failed HTTP ${res.statusCode}`));
        return;
      }
      const out = createWriteStream(dest);
      pipeline(res, out).then(resolve, reject);
    });
    req.on('error', reject);
  });
}

async function ensureCloudflared() {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  const bin = path.join(TOOLS_DIR, cloudflaredBinaryName());
  if (fs.existsSync(bin)) return bin;

  const url = cloudflaredDownloadUrl();
  console.log('[tunnel] 正在下载 cloudflared…');
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
 * trycloudflare 快速隧道不稳定，进程退出后必须自动拉起并换新域名。
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
    this.onUrl = typeof opts.onUrl === 'function' ? opts.onUrl : null;
    this.onLost = typeof opts.onLost === 'function' ? opts.onLost : null;
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
          console.log('[tunnel] 公网地址:', this.publicUrl);
          if (typeof this.onUrl === 'function') {
            try {
              this.onUrl(this.publicUrl);
            } catch (_) {
              /* ignore */
            }
          }
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

  _scheduleRestart() {
    if (this._stopped || this.proc || this._restartTimer) return;
    const port = this._port;
    if (!port) return;
    const delay = this._backoffMs;
    this._backoffMs = Math.min(Math.round(this._backoffMs * 1.8), 30000);
    console.log(`[tunnel] ${Math.round(delay / 100) / 10}s 后自动重连…`);
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      if (this._stopped || this.proc || this._starting) return;
      this.ensure(port).catch((err) => {
        console.warn(
          '[tunnel] 重连失败:',
          err && err.message ? err.message : err
        );
      });
    }, delay);
  }

  _killProc() {
    this._gen += 1;
    const proc = this.proc;
    this.proc = null;
    this.publicUrl = null;
    if (!proc) return;
    try {
      proc.kill('SIGTERM');
    } catch (_) {
      /* ignore */
    }
    setTimeout(() => {
      try {
        if (!proc.killed) proc.kill('SIGKILL');
      } catch (_) {
        /* ignore */
      }
    }, 2000);
  }

  stop() {
    this._stopped = true;
    this._clearRestart();
    this._killProc();
    this._port = null;
  }

  getPublicUrl() {
    return this.publicUrl;
  }
}

module.exports = { QuickTunnel, ensureCloudflared };
