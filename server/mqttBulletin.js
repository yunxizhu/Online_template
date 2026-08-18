'use strict';

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');

const DEFAULT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'mqtt://broker.emqx.io:1883',
];
const DEFAULT_CHANNEL = 'lianji-public';
const APP_SIGNATURE = 'lianji';
const LOGIN_HB_MS = 10000;
const ROOM_HB_MS = 10000;
// 心跳间隔 10s，超时阈值给到 2~3 个周期，避免单次延迟发布导致列表闪跳
const LOGIN_OFFLINE_MS = 25000;
const ROOM_OFFLINE_MS = 25000;
/** 接收端清除超时残留的时长：实例被强杀后 retained 心跳会永久残留，
 * 超过该阈值直接丢弃，避免「离线幽灵」永远挂在别人大厅里 */
const STALE_CLEAR_MS =
  Number(process.env.MQTT_STALE_CLEAR_MS) || 120000;
const VALID_STATUS = new Set(['idle', 'room', 'playing']);

function sanitizePeople(list) {
  const out = [];
  for (const p of list || []) {
    if (!p) continue;
    const name = String(p.name || '').trim();
    if (!name) continue;
    const status = VALID_STATUS.has(p.status) ? p.status : 'idle';
    out.push({
      name,
      tag: p.tag ? String(p.tag).slice(0, 12) : null,
      status,
      roomId: p.roomId ? String(p.roomId).slice(0, 12).toUpperCase() : null,
      roomName: p.roomName ? String(p.roomName).slice(0, 40) : null,
      sessionId: p.sessionId ? String(p.sessionId).slice(0, 48) : null,
    });
    if (out.length >= 12) break;
  }
  return out;
}

function readOptionalLine(file) {
  try {
    const s = String(fs.readFileSync(file, 'utf8') || '').trim();
    return s.split(/\r?\n/)[0].trim();
  } catch (_) {
    return '';
  }
}

function loadOptions(rootDir) {
  const disabled =
    String(process.env.MQTT_BULLETIN || '1').trim() === '0' ||
    fs.existsSync(path.join(rootDir, 'mqtt.off'));
  const channel =
    (process.env.MQTT_CHANNEL || '').trim() ||
    readOptionalLine(path.join(rootDir, 'mqtt.channel')) ||
    DEFAULT_CHANNEL;
  const broker =
    (process.env.MQTT_BROKER || '').trim() ||
    readOptionalLine(path.join(rootDir, 'mqtt.broker')) ||
    '';
  return { disabled, channel, broker };
}

/**
 * 固定地址广播：公共 MQTT（默认 EMQX）。
 * 登录心跳 10s、房间心跳 5s；超时即视为下线/房间失效。
 * 默认无需配置；可选 mqtt.channel 隔离小群，mqtt.off 关闭。
 */
class MqttBulletin {
  constructor({
    rootDir,
    instanceId,
    getDisplayName,
    getDisplayTag,
    getHostedRooms,
    getLobbyPeople,
    ensureTunnelUrl,
    onChange,
  }) {
    const opt = loadOptions(rootDir || process.cwd());
    this.enabled = !opt.disabled;
    this.channel = String(opt.channel || DEFAULT_CHANNEL).replace(/[+#]/g, '_');
    this.brokerOverride = opt.broker;
    this.instanceId = instanceId;
    this.getDisplayName = getDisplayName || (() => '');
    this.getDisplayTag = getDisplayTag || (() => null);
    this.getHostedRooms = getHostedRooms || (() => []);
    this.getLobbyPeople = getLobbyPeople || (() => []);
    this.ensureTunnelUrl = ensureTunnelUrl || (async () => null);
    this.onChange = onChange || (() => {});
    this.loginAt = Date.now();
    this.client = null;
    this._started = false;
    this._loginTimer = null;
    this._roomTimer = null;
    this._lastWarn = 0;
    /** @type {Map<string, object>} */
    this.logins = new Map();
    /** @type {Map<string, object>} */
    this.rooms = new Map();
  }

  #prefix() {
    return `lianji/v1/${this.channel}`;
  }

  #loginTopic(id = this.instanceId) {
    return `${this.#prefix()}/login/${id}`;
  }

  #roomTopic(id = this.instanceId) {
    return `${this.#prefix()}/room/${id}`;
  }

  #warn(err) {
    const now = Date.now();
    if (now - this._lastWarn < 15000) return;
    this._lastWarn = now;
    console.warn('[mqtt]', err && err.message ? err.message : err);
  }

  async start() {
    if (!this.enabled || this._started) return;
    this._started = true;
    const brokers = this.brokerOverride
      ? [this.brokerOverride]
      : DEFAULT_BROKERS.slice();
    this.#connect(brokers, 0);
  }

  stop() {
    this._started = false;
    if (this._loginTimer) { clearTimeout(this._loginTimer); this._loginTimer = null; }
    if (this._roomTimer) { clearTimeout(this._roomTimer); this._roomTimer = null; }
    if (this._roomRetryTimer) { clearTimeout(this._roomRetryTimer); this._roomRetryTimer = null; }
    const c = this.client;
    this.client = null;
    if (!c) return;
    try {
      c.publish(this.#loginTopic(), '', { qos: 0, retain: true });
      c.publish(this.#roomTopic(), '', { qos: 0, retain: true });
    } catch (_) {}
    try { c.end(true); } catch (_) {}
  }

  /** 清除超时残留的远端心跳/房间（实例死掉后 retained 消息不会自己消失） */
  #pruneStale() {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.logins) {
      if (!p || !p.updateTime || now - p.updateTime > STALE_CLEAR_MS) {
        this.logins.delete(id);
        changed = true;
      }
    }
    for (const [id, r] of this.rooms) {
      if (!r || !r.updateTime || now - r.updateTime > STALE_CLEAR_MS) {
        this.rooms.delete(id);
        changed = true;
      }
    }
    if (changed) this.onChange();
  }

  #connect(brokers, index) {
    if (!this._started) return;
    const url = brokers[index];
    if (!url) {
      this.#warn(new Error('无法连接公共 MQTT，稍后重试'));
      setTimeout(() => this.#connect(brokers, 0), 20000);
      return;
    }
    if (this.client) {
      try { this.client.end(true); } catch (_) {}
      this.client = null;
    }
    const client = mqtt.connect(url, {
      clientId: `lianji-${this.instanceId.slice(0, 8)}-${Math.random().toString(36).slice(2, 8)}`,
      clean: true,
      keepalive: 60,
      reconnectPeriod: 8000,
      connectTimeout: 12000,
      protocolVersion: 4,
      will: {
        topic: this.#loginTopic(),
        payload: '',
        qos: 0,
        retain: true,
      },
    });
    this.client = client;
    client.on('connect', () => {
      console.log(`[mqtt] 广播已连接 ${url} 频道=${this.channel}`);
      client.subscribe(
        [`${this.#prefix()}/login/+`, `${this.#prefix()}/room/+`],
        { qos: 0 },
        (err) => {
          if (err) this.#warn(err);
        }
      );
      this.touchLogin().catch((e) => this.#warn(e));
      this.touchRoom().catch((e) => this.#warn(e));
      this.#scheduleLogin();
      this.#scheduleRoom();
    });
    client.on('message', (topic, buf) => this.#onMessage(topic, buf));
    client.on('error', (err) => this.#warn(err));
    client.on('close', () => {
      if (!this._started) return;
      if (this.client === client && !client.reconnecting) {
        const next = (index + 1) % brokers.length;
        setTimeout(() => {
          if (this.client === client) this.#connect(brokers, next);
        }, 5000);
      }
    });
  }

  #scheduleLogin() {
    if (this._loginTimer) clearTimeout(this._loginTimer);
    this._loginTimer = setTimeout(() => {
      this.touchLogin().catch((e) => this.#warn(e)).finally(() => {
        if (this._started) this.#scheduleLogin();
      });
    }, LOGIN_HB_MS);
  }

  #scheduleRoom() {
    if (this._roomTimer) clearTimeout(this._roomTimer);
    this._roomTimer = setTimeout(() => {
      this.touchRoom().catch((e) => this.#warn(e)).finally(() => {
        if (this._started) this.#scheduleRoom();
      });
    }, ROOM_HB_MS);
  }

  /** 隧道未就绪时的快速重试（1.5s），成功后自动停止 */
  #scheduleRoomRetry() {
    if (this._roomRetryTimer || !this._started) return;
    this._roomRetryTimer = setTimeout(() => {
      this._roomRetryTimer = null;
      if (!this._started) return;
      this.touchRoom().catch((e) => this.#warn(e));
    }, 1500);
  }

  #pub(topic, obj) {
    const c = this.client;
    if (!c || !c.connected) return;
    const payload = obj == null ? '' : JSON.stringify(obj);
    c.publish(topic, payload, { qos: 0, retain: true });
  }

  async touchLogin() {
    if (!this.enabled || !this._started) return;
    const now = Date.now();
    const people = sanitizePeople(this.getLobbyPeople() || []);
    // 无大厅玩家：不对外发布，并清掉可能残留的 retained 登录消息，
    // 避免空实例以主机名形式出现在他人的大厅人员列表里
    if (!people.length) {
      this.#pub(this.#loginTopic(), '');
      return;
    }
    const first = people[0];
    this.#pub(this.#loginTopic(), {
      app: APP_SIGNATURE,
      instanceId: this.instanceId,
      displayName: first.name,
      displayTag: first.tag || null,
      people,
      loginAt: this.loginAt,
      updateTime: now,
    });
  }

  async touchRoom() {
    if (!this.enabled || !this._started) return;
    const rooms = this.getHostedRooms() || [];
    const room = rooms[0];
    // 没有有效房间时：彻底不发 room topic
    // 远端通过 updateTime + ROOM_OFFLINE_MS 自动判定房间消失（不依赖 broker retained 空消息）
    if (!room || room.hidden) return;
    if (
      room.status &&
      room.status !== 'waiting' &&
      room.status !== 'playing'
    )
      return;
    const tunnelUrl = (await this.ensureTunnelUrl()) || '';
    if (!tunnelUrl) {
      // 隧道还没就绪：短暂重试，尽快把房间广播出去，
      // 避免远端要等下一个 10s 心跳周期才看到房间
      this.#scheduleRoomRetry();
      return;
    }
    const now = Date.now();
    this.#pub(this.#roomTopic(), {
      app: APP_SIGNATURE,
      id: room.id,
      name: room.name || '',
      creatorId: this.instanceId,
      creatorName: this.getDisplayName() || '',
      creatorTag: this.getDisplayTag() || null,
      host: String(tunnelUrl).replace(/\/$/, ''),
      gameType: room.gameType || '',
      gameLabel: room.gameLabel || '',
      gameMode: room.gameMode || room.gameModeLabel || '',
      gameModeLabel: room.gameModeLabel || '',
      playerNames: (room.players || []).map((p) => p.name || '玩家'),
      playerTags: (room.players || []).map((p) => p.tag || null),
      playerCount: room.playerCount,
      maxPlayers: room.maxPlayers,
      status: room.status || 'waiting',
      createTime: room._createdAt || now,
      updateTime: now,
    });
  }

  #onMessage(topic, buf) {
    const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
    const loginPrefix = `${this.#prefix()}/login/`;
    const roomPrefix = `${this.#prefix()}/room/`;
    if (topic.startsWith(loginPrefix)) {
      const id = topic.slice(loginPrefix.length);
      if (!id || id === this.instanceId) return;
      if (!text.trim()) {
        this.logins.delete(id);
        this.onChange();
        return;
      }
      try {
        const p = JSON.parse(text);
        if (!p || p.app !== APP_SIGNATURE) return;
        const updateTime = Number(p.updateTime || 0);
        const people = Array.isArray(p.people) ? sanitizePeople(p.people) : [];
        this.logins.set(id, {
          instanceId: id,
          displayName: String(
            p.displayName ||
              (people[0] && people[0].name) ||
              '玩家'
          ),
          displayTag: p.displayTag ? String(p.displayTag) : null,
          people,
          loginAt: Number(p.loginAt || 0),
          updateTime,
        });
        this.onChange();
      } catch (_) {}
      return;
    }
    if (topic.startsWith(roomPrefix)) {
      const id = topic.slice(roomPrefix.length);
      if (!id || id === this.instanceId) return;
      if (!text.trim()) {
        this.rooms.delete(id);
        this.onChange();
        return;
      }
      try {
        const p = JSON.parse(text);
        if (!p || p.app !== APP_SIGNATURE) return;
        const updateTime = Number(p.updateTime || 0);
        const host = String(p.host || '').replace(/\/$/, '');
        if (!host || !p.id) {
          this.rooms.delete(id);
          this.onChange();
          return;
        }
        this.rooms.set(id, {
          id: String(p.id).toUpperCase(),
          name: String(p.name || p.id),
          creatorId: id,
          creatorName: String(p.creatorName || ''),
          creatorTag: p.creatorTag ? String(p.creatorTag) : null,
          host,
          gameType: String(p.gameType || ''),
          gameLabel: String(p.gameLabel || p.gameType || ''),
          gameMode: String(p.gameMode || ''),
          gameModeLabel: String(p.gameModeLabel || p.gameMode || ''),
          playerNames: Array.isArray(p.playerNames) ? p.playerNames : [],
          playerTags: Array.isArray(p.playerTags) ? p.playerTags : [],
          playerCount: Number(p.playerCount || (p.playerNames && p.playerNames.length) || 0),
          maxPlayers: Number(p.maxPlayers || 0) || undefined,
          status: String(p.status || 'waiting'),
          createTime: Number(p.createTime || 0),
          updateTime,
          instanceId: id,
          local: false,
          via: 'mqtt',
          hidden: false,
        });
        this.onChange();
      } catch (_) {}
    }
  }

  getOnlinePeers() {
    this.#pruneStale();
    const now = Date.now();
    return [...this.logins.values()]
      .filter(
        (p) =>
          String(p.displayName || '').trim() &&
          p.updateTime &&
          now - p.updateTime <= LOGIN_OFFLINE_MS
      )
      .map((p) => ({
        instanceId: p.instanceId,
        host: '',
        displayName: p.displayName,
        alive: true,
        via: 'mqtt',
      }));
  }

  getRemotePeople() {
    this.#pruneStale();
    const now = Date.now();
    const out = [];
    for (const p of this.logins.values()) {
      // 心跳超时的玩家直接剔除，不展示「离线」条目
      if (!(p.updateTime && now - p.updateTime <= LOGIN_OFFLINE_MS)) continue;
      const people = Array.isArray(p.people) && p.people.length
        ? p.people
        : [{ name: p.displayName, tag: p.displayTag, status: 'idle', roomId: null, roomName: null, sessionId: null }];
      people.forEach((pp, i) => {
        const name = String((pp && pp.name) || '').trim();
        if (!name) return;
        const roomId = (pp && pp.roomId) || null;
        const knownRoom = roomId ? this.rooms.get(roomId.toUpperCase()) : null;
        // 唯一身份 = 机器 id(instanceId) + 玩家本 id(sessionId)，用于跨端去重
        const sid = (pp && pp.sessionId) ? String(pp.sessionId) : `${name}#${pp && pp.tag || ''}#p${i}`;
        out.push({
          id: `${p.instanceId}:p${i}`,
          name,
          tag: (pp && pp.tag) || null,
          status: String(pp.status || 'idle'),
          roomId,
          roomName: (pp && pp.roomName) || null,
          instanceId: p.instanceId,
          host: (knownRoom && knownRoom.host) || null,
          local: false,
          alive: true,
          via: 'mqtt',
          sessionId: `${p.instanceId}:${sid}`,
        });
      });
    }
    return out;
  }

  getPublicRooms() {
    this.#pruneStale();
    const now = Date.now();
    return [...this.rooms.values()].filter(
      (r) =>
        r.updateTime &&
        now - r.updateTime <= ROOM_OFFLINE_MS &&
        (!r.status || r.status === 'waiting')
    );
  }

  resolveRoom(roomId) {
    const id = String(roomId || '').toUpperCase();
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.id === id && room.updateTime && now - room.updateTime <= ROOM_OFFLINE_MS) {
        return { host: room.host, room, via: 'mqtt' };
      }
    }
    return null;
  }
}

module.exports = {
  MqttBulletin,
  DEFAULT_CHANNEL,
  LOGIN_HB_MS,
  ROOM_HB_MS,
  LOGIN_OFFLINE_MS,
  ROOM_OFFLINE_MS,
};
