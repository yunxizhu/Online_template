'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 隧道访客昵称记忆：按「公网 IP + UA」软指纹存到房主本机。
 * 换 trycloudflare 域名后 localStorage 会丢，但同设备连回同一房主仍可召回。
 */
class TunnelNickMemory {
  constructor({ filePath, ttlMs } = {}) {
    this.filePath =
      filePath ||
      path.join(__dirname, '..', '.lianji-tunnel-nicks.json');
    this.ttlMs = Math.max(
      24 * 60 * 60 * 1000,
      Number(ttlMs) || 30 * 24 * 60 * 60 * 1000
    );
    /** @type {Map<string, { name: string, at: number }>} */
    this.map = new Map();
    this._load();
  }

  #normalizeName(name) {
    return (
      String(name || '')
        .trim()
        .replace(/#\d{1,8}\s*$/, '')
        .trim()
        .slice(0, 16) || ''
    );
  }

  #clientIpFromHeaders(headers, address) {
    const h = headers || {};
    const xf = String(h['x-forwarded-for'] || '')
      .split(',')[0]
      .trim();
    const cf = String(h['cf-connecting-ip'] || '').trim();
    const real = String(h['x-real-ip'] || '').trim();
    const addr = String(address || '').trim();
    return (cf || xf || real || addr || '').slice(0, 64);
  }

  #clientIp(socket) {
    const hs = (socket && socket.handshake) || {};
    return this.#clientIpFromHeaders(hs.headers, hs.address);
  }

  keyFromParts(ip, ua) {
    const ipKey = String(ip || '').slice(0, 64);
    const uaKey = String(ua || '').slice(0, 180);
    const digest = crypto
      .createHash('sha1')
      .update(`${ipKey}|${uaKey}`)
      .digest('hex')
      .slice(0, 16);
    return `${ipKey || 'unknown'}#${digest}`;
  }

  keyForSocket(socket) {
    const ip = this.#clientIp(socket);
    const ua = String(
      ((socket && socket.handshake && socket.handshake.headers) || {})[
        'user-agent'
      ] || ''
    );
    return this.keyFromParts(ip, ua);
  }

  keyForHttpReq(req) {
    if (!req) return this.keyFromParts('', '');
    const ip = this.#clientIpFromHeaders(req.headers, req.socket && req.socket.remoteAddress);
    const ua = String((req.headers && req.headers['user-agent']) || '');
    return this.keyFromParts(ip, ua);
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      const entries = data && data.entries;
      if (!entries || typeof entries !== 'object') return;
      const now = Date.now();
      for (const [k, v] of Object.entries(entries)) {
        if (!v || typeof v !== 'object') continue;
        const name = this.#normalizeName(v.name);
        const at = Number(v.at) || 0;
        if (!name || !at || now - at > this.ttlMs) continue;
        this.map.set(String(k).slice(0, 120), { name, at });
      }
    } catch (_) {
      /* missing / corrupt → empty */
    }
  }

  _save() {
    try {
      const entries = {};
      for (const [k, v] of this.map.entries()) {
        entries[k] = { name: v.name, at: v.at };
      }
      fs.writeFileSync(
        this.filePath,
        JSON.stringify({ v: 1, entries }, null, 0),
        'utf8'
      );
    } catch (_) {
      /* ignore disk errors */
    }
  }

  #prune() {
    const now = Date.now();
    let changed = false;
    for (const [k, v] of this.map.entries()) {
      if (!v || now - (v.at || 0) > this.ttlMs) {
        this.map.delete(k);
        changed = true;
      }
    }
    return changed;
  }

  #recallByKey(key) {
    this.#prune();
    const row = this.map.get(key);
    if (!row) return '';
    row.at = Date.now();
    this._save();
    return row.name || '';
  }

  remember(socket, name) {
    const n = this.#normalizeName(name);
    if (!n || !socket) return '';
    const key = this.keyForSocket(socket);
    this.map.set(key, { name: n, at: Date.now() });
    if (this.map.size > 400) this.#prune();
    this._save();
    return n;
  }

  recall(socket) {
    if (!socket) return '';
    return this.#recallByKey(this.keyForSocket(socket));
  }

  recallFromHttpReq(req) {
    if (!req) return '';
    return this.#recallByKey(this.keyForHttpReq(req));
  }
}

module.exports = { TunnelNickMemory };
