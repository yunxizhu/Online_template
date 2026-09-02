'use strict';

/**
 * 纯客户端静态页服务：只提供加入端大厅页面，不建房、不开隧道。
 * 用法：node client-server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = fs.existsSync(path.join(__dirname, 'www'))
  ? path.join(__dirname, 'www')
  : path.join(__dirname, '..', 'mobile', 'www');
const PORT = Math.max(1, Number(process.env.PORT) || 39199);
const OPEN = String(process.env.OPEN_BROWSER || '1') !== '0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(String(urlPath || '/').split('?')[0]);
  const rel = decoded.replace(/^\/+/, '');
  const full = path.normalize(path.join(root, rel || 'index.html'));
  if (!full.startsWith(root)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  let file = safeJoin(ROOT, req.url === '/' ? '/index.html' : req.url);
  if (!file) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      file = path.join(file, 'index.html');
    }
    fs.readFile(file, (readErr, data) => {
      if (readErr) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`[lianji-client] ${url}`);
  console.log('[lianji-client] join-only lobby (no host/create)');
  if (!OPEN) return;
  if (process.platform === 'win32') {
    exec(`cmd /c start "" "${url}"`);
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
});
