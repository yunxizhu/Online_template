'use strict';

/**
 * 纯加入端（Capacitor / play.html）：经 MQTT 解析房间最新公网 host。
 * 与 mobile/www/app.js 使用同一 broker 与频道。
 */
window.MqttRoomResolve = (function () {
  const APP = 'lianji';
  const BROKER = 'wss://broker.emqx.io:8084/mqtt';
  const DEFAULT_CHANNEL = 'xiyun_lianjidating_public';
  const ROOM_OFFLINE_MS = 15000;

  function prefix(channel) {
    return 'lianji/v1/' + (channel || DEFAULT_CHANNEL);
  }

  function normalizeHost(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s.replace(/\/+$/, '');
  }

  function mqttLib() {
    if (typeof mqtt !== 'undefined' && mqtt.connect) return mqtt;
    if (typeof window !== 'undefined' && window.mqtt && window.mqtt.connect) {
      return window.mqtt;
    }
    return null;
  }

  /**
   * @param {string} roomId
   * @param {{ preferred?: string, timeoutMs?: number, channel?: string }} opts
   */
  function resolveHost(roomId, opts) {
    opts = opts || {};
    const rid = String(roomId || '')
      .trim()
      .toUpperCase();
    if (!rid) return Promise.resolve('');

    const preferred = opts.preferred ? normalizeHost(opts.preferred) : '';
    const lib = mqttLib();
    if (!lib) return Promise.resolve(preferred);

    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 10000;
    const roomPrefix = prefix(opts.channel) + '/room/';

    return new Promise((resolve) => {
      let settled = false;
      let best = preferred;
      let bestTime = preferred ? Date.now() : 0;

      const finish = (host) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          if (client) client.end(true);
        } catch (_) {}
        resolve(host ? normalizeHost(host) : '');
      };

      const timer = setTimeout(() => finish(best), timeoutMs);
      const clientId =
        'lianji-rslv-' + Math.random().toString(36).slice(2, 10);
      const client = lib.connect(BROKER, {
        clientId,
        protocolVersion: 4,
        clean: true,
        keepalive: 30,
        connectTimeout: 12000,
      });

      client.on('connect', () => {
        client.subscribe(roomPrefix + '+', { qos: 1 }, (err) => {
          if (err) finish(best);
        });
      });

      client.on('message', (topic, buf) => {
        if (!topic.startsWith(roomPrefix)) return;
        const raw = buf ? buf.toString() : '';
        if (!raw.trim()) return;
        try {
          const p = JSON.parse(raw);
          if (!p || p.app !== APP) return;
          if (String(p.id || '').toUpperCase() !== rid) return;
          if (!p.host) return;
          const t = Number(p.updateTime) || Date.now();
          if (Date.now() - t > ROOM_OFFLINE_MS) return;
          const host = normalizeHost(p.host);
          if (!host) return;
          if (t >= bestTime) {
            best = host;
            bestTime = t;
          }
        } catch (_) {}
      });

      client.on('error', () => finish(best));
      client.on('close', () => {
        if (!settled && best) finish(best);
      });
    });
  }

  return { resolveHost, normalizeHost };
})();
