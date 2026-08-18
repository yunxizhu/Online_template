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
 */
class QuickTunnel {
  constructor() {
    this.proc = null;
    this.publicUrl = null;
    this._port = null;
    this._starting = null;
  }

  /** @returns {Promise<string>} public https URL */
  async ensure(localPort) {
    const port = Number(localPort);
    if (!port) throw new Error('invalid local port');
    if (this.proc && this.publicUrl && this._port === port) {
      return this.publicUrl;
    }
    if (this._starting) return this._starting;

    if (this.proc) this.stop();

    this._starting = this._start(port).finally(() => {
      this._starting = null;
    });
    return this._starting;
  }

  async _start(port) {
    const bin = await ensureCloudflared();
    this._port = port;
    this.publicUrl = null;

    const args = [
      'tunnel',
      '--url',
      `http://127.0.0.1:${port}`,
      '--no-autoupdate',
    ];

    return new Promise((resolve, reject) => {
      let settled = false;
      const failTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.stop();
        reject(new Error('cloudflared 启动超时（未拿到公网 URL）'));
      }, 90000);

      const proc = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.proc = proc;

      const onChunk = (buf) => {
        const text = buf.toString('utf8');
        const m = text.match(URL_RE);
        if (m && !this.publicUrl) {
          this.publicUrl = m[0].replace(/\/$/, '');
          console.log('[tunnel] 公网地址:', this.publicUrl);
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
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        this.proc = null;
        reject(err);
      });

      proc.on('exit', (code) => {
        this.proc = null;
        this.publicUrl = null;
        if (!settled) {
          settled = true;
          clearTimeout(failTimer);
          reject(new Error(`cloudflared 退出 code=${code}`));
        } else {
          console.log('[tunnel] cloudflared 已退出');
        }
      });
    });
  }

  stop() {
    const proc = this.proc;
    this.proc = null;
    this.publicUrl = null;
    this._port = null;
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

  getPublicUrl() {
    return this.publicUrl;
  }
}

module.exports = { QuickTunnel, ensureCloudflared };
