'use strict';

/**
 * 纯加入端（Capacitor / play.html）：经 MQTT 解析房间最新公网 host。
 * 并行连接所有公共 WSS 节点，与主机网状广播一致，避免主/备分流后找不到房。
 */
window.MqttRoomResolve = (function () {
  const APP = 'lianji';
  const BROKERS = [
    { url: 'wss://broker.hivemq.com:8884/mqtt' },
    { url: 'wss://mqtt.tyckr.io:8081' },
    { url: 'wss://mqtt-dashboard.com:8884/mqtt' },
    { url: 'wss://test.mosquitto.org:8081/mqtt' },
    {
      url: 'wss://public.cloud.shiftr.io',
      username: 'public',
      password: 'public',
    },
    { url: 'wss://broker.emqx.io:8084/mqtt' },
  ];
  const DEFAULT_CHANNEL = 'xiyun_lianjidating_public';
  const ROOM_OFFLINE_MS = 12000;

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

  function openClients(lib, brokers, opts) {
    opts = opts || {};
    const clients = [];
    for (let i = 0; i < brokers.length; i++) {
      const entry = brokers[i];
      const url = typeof entry === 'string' ? entry : entry && entry.url;
      if (!url) continue;
      try {
        const connectOpts = {
          clientId:
            (opts.clientIdPrefix || 'lianji-m-') +
            Math.random().toString(36).slice(2, 10),
          protocolVersion: 4,
          clean: true,
          keepalive: opts.keepalive || 30,
          reconnectPeriod: 0,
          connectTimeout: opts.connectTimeout || 10000,
        };
        if (entry && typeof entry === 'object' && entry.username) {
          connectOpts.username = entry.username;
          connectOpts.password = entry.password || '';
        }
        const client = lib.connect(url, connectOpts);
        clients.push(client);
        if (opts.onClient) opts.onClient(client, url);
      } catch (_) {}
    }
    return {
      clients,
      stop() {
        for (const c of clients) {
          try {
            c.removeAllListeners();
            c.end(true);
          } catch (_) {}
        }
        clients.length = 0;
      },
    };
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

    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 14000;
    const roomPrefix = prefix(opts.channel) + '/room/';

    return new Promise((resolve) => {
      let settled = false;
      let best = preferred;
      let bestTime = preferred ? Date.now() : 0;
      let session = null;

      const finish = (host) => {
        if (settled) return;
        settled = true;
        clearTimeout(overall);
        if (session) session.stop();
        resolve(host ? normalizeHost(host) : '');
      };

      const overall = setTimeout(() => finish(best), timeoutMs);

      session = openClients(lib, BROKERS, {
        clientIdPrefix: 'lianji-rslv-',
        onClient(client) {
          client.on('connect', () => {
            if (settled) return;
            client.subscribe(roomPrefix + '+', { qos: 1 });
          });
          client.on('message', (topic, buf) => {
            if (settled) return;
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
              finish(best);
            } catch (_) {}
          });
        },
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
    const live = [];

    function pulse() {
      if (stopped) return;
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
      const body = JSON.stringify({
        app: APP,
        instanceId,
        displayName: people[0].name,
        displayTag: people[0].tag,
        people,
        host: lastHost,
        loginAt: Date.now(),
        updateTime: Date.now(),
      });
      for (const c of live) {
        if (!c.connected) continue;
        try {
          c.publish(loginTopic, body, { qos: 1, retain: true });
        } catch (_) {}
      }
    }

    const session = openClients(lib, BROKERS, {
      clientIdPrefix: 'lianji-rel-',
      keepalive: 30,
      onClient(client) {
        client.on('connect', () => {
          if (stopped) return;
          live.push(client);
          client.subscribe(reloadTopic, { qos: 1 });
          pulse();
          if (!pulseTimer) pulseTimer = setInterval(pulse, 10000);
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
      },
    });

    return function stop() {
      stopped = true;
      if (pulseTimer) {
        clearInterval(pulseTimer);
        pulseTimer = null;
      }
      for (const c of live) {
        try {
          if (c.connected) {
            c.publish(loginTopic, '', { qos: 1, retain: true });
          }
        } catch (_) {}
      }
      session.stop();
      live.length = 0;
    };
  }

  return {
    resolveHost,
    watchTunnelReload,
    BROKERS,
    DEFAULT_CHANNEL,
  };
})();
