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

  /**
   * 纯加入端：用登录心跳声明仍停在旧隧道，并监听房主 reload。
   * @returns {function} stop
   */
  function watchTunnelReload(opts) {
    opts = opts || {};
    const rid = String(opts.roomId || '')
      .trim()
      .toUpperCase();
    const onReload = typeof opts.onReload === 'function' ? opts.onReload : null;
    const lib = mqttLib();
    if (!lib || !rid) return function () {};

    const instanceId = 'join-' + Math.random().toString(36).slice(2, 10);
    const loginTopic = prefix(opts.channel) + '/login/' + instanceId;
    const reloadTopic = prefix(opts.channel) + '/reload';
    const lastHost = normalizeHost(opts.lastHost || '');
    let stopped = false;
    let pulseTimer = null;
    const client = lib.connect(BROKER, {
      clientId: 'lianji-rel-' + Math.random().toString(36).slice(2, 10),
      protocolVersion: 4,
      clean: true,
      keepalive: 30,
      connectTimeout: 12000,
    });

    function pulse() {
      if (stopped || !client.connected) return;
      const people = [
        {
          name: String(opts.name || '玩家').trim().slice(0, 24) || '玩家',
          tag: opts.tag ? String(opts.tag).slice(0, 12) : null,
          status: 'playing',
          roomId: rid,
          sessionId: opts.sessionId ? String(opts.sessionId).slice(0, 64) : null,
          host: lastHost,
          client: 'mobile',
          role: 'client',
        },
      ];
      client.publish(
        loginTopic,
        JSON.stringify({
          app: APP,
          instanceId,
          displayName: people[0].name,
          displayTag: people[0].tag,
          people,
          host: lastHost,
          loginAt: Date.now(),
          updateTime: Date.now(),
        }),
        { qos: 1, retain: true }
      );
    }

    client.on('connect', () => {
      if (stopped) return;
      client.subscribe(reloadTopic, { qos: 1 });
      pulse();
      pulseTimer = setInterval(pulse, 10000);
    });
    client.on('message', (topic, buf) => {
      if (stopped || !onReload) return;
      if (topic !== reloadTopic && !String(topic).endsWith('/reload')) return;
      const raw = buf ? buf.toString() : '';
      if (!raw.trim()) return;
      try {
        const p = JSON.parse(raw);
        if (!p || p.app !== APP || p.kind !== 'reload') return;
        if (String(p.roomId || '').toUpperCase() !== rid) return;
        if (!p.host) return;
        onReload({
          kind: 'reload',
          roomId: String(p.roomId).toUpperCase(),
          host: normalizeHost(p.host),
          name: p.name || '',
          gameType: p.gameType || '',
          gameLabel: p.gameLabel || '',
          status: p.status || 'playing',
          targets: Array.isArray(p.targets) ? p.targets : [],
          at: Number(p.at) || Date.now(),
        });
      } catch (_) {}
    });

    return function stop() {
      stopped = true;
      if (pulseTimer) {
        clearInterval(pulseTimer);
        pulseTimer = null;
      }
      try {
        if (client.connected) {
          client.publish(loginTopic, '', { qos: 1, retain: true });
        }
      } catch (_) {}
      try {
        client.end(true);
      } catch (_) {}
    };
  }

  return { resolveHost, normalizeHost, watchTunnelReload };
})();
