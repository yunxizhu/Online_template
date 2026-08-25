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
/** 隧道 URL 刚出现时可额外等待再广播；给 Cloudflare DNS 一点传播时间 */
const TUNNEL_READY_DELAY_MS = Number(process.env.TUNNEL_READY_DELAY_MS) || 2500;
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
    peekTunnelUrl,
    onChange,
    onChat,
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
    this.peekTunnelUrl = peekTunnelUrl || (() => '');
    this.onChange = onChange || (() => {});
    this.onChat = onChat || (() => {});
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
    /** @type {object[]} */
    this._chatQueue = [];
    this._lastTunnelUrl = '';
    this._tunnelPublishAfter = 0;
  }

  #mqttUp() {
    return Boolean(this.client && this.client.connected);
  }

  #peekUrl(knownUrl) {
    const raw =
      (knownUrl && String(knownUrl)) ||
      (this.peekTunnelUrl && this.peekTunnelUrl()) ||
      '';
    return String(raw).replace(/\/$/, '');
  }

  /**
   * 隧道地址 + MQTT 都就绪时立刻发登录/房间心跳。
   * 任一条件刚满足时调用，不必等下一个周期。
   */
  flushIfReady(knownUrl) {
    if (!this.enabled || !this._started) return false;
    if (!this.#mqttUp()) return false;
    if (!this.#peekUrl(knownUrl)) return false;
    this.touchLogin().catch((e) => this.#warn(e));
    this.touchRoom().catch((e) => this.#warn(e));
    this.#scheduleLogin();
    this.#scheduleRoom();
    return true;
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

  #chatAllTopic() {
    return `${this.#prefix()}/chat/all`;
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
        qos: 1,
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
          // 订阅完成即视为 MQTT 就绪：若隧道地址已在，立刻发心跳
          if (!this.flushIfReady()) {
            this.touchLogin().catch((e) => this.#warn(e));
            this.touchRoom().catch((e) => this.#warn(e));
            this.#scheduleLogin();
            this.#scheduleRoom();
          }
        }
      );
      client.subscribe(this.#chatAllTopic(), { qos: 1 }, (err) => {
        if (err) this.#warn(err);
        this.#flushChatQueue();
      });
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

  /** 立刻发一次玩家心跳，并重置 10s 周期 */
  pulseLogin() {
    if (!this.enabled || !this._started) return;
    this.touchLogin().catch((e) => this.#warn(e));
    this.#scheduleLogin();
  }

  /** 立刻发一次房间心跳，并重置周期；隧道+MQTT 都就绪时马上发出 */
  pulseRoom() {
    if (!this.enabled || !this._started) return;
    if (this.flushIfReady()) return;
    this.touchRoom().catch((e) => this.#warn(e));
    this.#scheduleRoom();
  }

  /** 隧道掉线时先清掉 retained 房间，避免大厅继续指向已死的旧域名 */
  clearRoomBeacon() {
    if (!this.enabled || !this._started) return;
    this.#pub(this.#roomTopic(), '');
  }

  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  #roomSig(room, tunnelUrl) {
    if (!room || !tunnelUrl) return '';
    const host = String(tunnelUrl).replace(/\/$/, '');
    const playerCount =
      Number(room.playerCount) ||
      (Array.isArray(room.players) ? room.players.length : 0);
    return `${room.id}|${host}|${playerCount}|${room.status || 'waiting'}`;
  }

  #isRoomBeaconPublished(room, tunnelUrl) {
    if (!room || !tunnelUrl || !this._lastRoomSig) return false;
    return this._lastRoomSig === this.#roomSig(room, tunnelUrl);
  }

  /**
   * 等待 MQTT 与公网隧道就绪（含隧道稳定延迟），用于隐藏房或登录心跳。
   */
  async waitForInfrastructureReady({ timeoutMs = 90000, onProgress } = {}) {
    if (!this.enabled || !this._started) {
      return { ok: true, reason: 'disabled' };
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.#mqttUp()) {
        if (onProgress) onProgress('mqtt');
        await this.#sleep(300);
        continue;
      }
      const tunnelUrl =
        this.#peekUrl() || (await this.ensureTunnelUrl()) || '';
      if (!tunnelUrl) {
        if (onProgress) onProgress('tunnel');
        await this.#sleep(400);
        continue;
      }
      if (Date.now() < this._tunnelPublishAfter) {
        if (onProgress) onProgress('tunnel-warmup');
        await this.#sleep(300);
        continue;
      }
      await this.touchLogin();
      return { ok: true, tunnelUrl };
    }
    return { ok: false, message: '公网隧道或 MQTT 连接超时，请稍后重试' };
  }

  /**
   * 等待指定房间已成功发出 MQTT 房间心跳（他人可在大厅看到）。
   */
  async waitForRoomBeacon(roomId, getRoom, { timeoutMs = 90000, onProgress } = {}) {
    if (!this.enabled || !this._started) {
      return { ok: true, reason: 'disabled' };
    }
    const wantId = String(roomId || '').toUpperCase();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const room = getRoom && getRoom();
      if (!room || String(room.id).toUpperCase() !== wantId) {
        return { ok: false, message: '房间已不存在' };
      }
      if (room.hidden) {
        return this.waitForInfrastructureReady({
          timeoutMs: Math.max(0, deadline - Date.now()),
          onProgress,
        });
      }
      if (!this.#mqttUp()) {
        if (onProgress) onProgress('mqtt');
        await this.#sleep(300);
        continue;
      }
      const tunnelUrl =
        this.#peekUrl() || (await this.ensureTunnelUrl()) || '';
      if (!tunnelUrl) {
        if (onProgress) onProgress('tunnel');
        await this.#sleep(400);
        continue;
      }
      if (Date.now() < this._tunnelPublishAfter) {
        if (onProgress) onProgress('tunnel-warmup');
        await this.#sleep(300);
        continue;
      }
      await this.touchRoom();
      if (this.#isRoomBeaconPublished(room, tunnelUrl)) {
        return { ok: true, tunnelUrl };
      }
      if (onProgress) onProgress('beacon');
      await this.#sleep(400);
    }
    return { ok: false, message: '房间广播超时，请检查网络或稍后重试' };
  }

  /** 隧道/MQTT 未就绪时快速重试，成功发出后自动停止 */
  #scheduleRoomRetry() {
    if (this._roomRetryTimer || !this._started) return;
    this._roomRetryTimer = setTimeout(() => {
      this._roomRetryTimer = null;
      if (!this._started) return;
      this.touchRoom().catch((e) => this.#warn(e));
    }, 400);
  }

  #pub(topic, obj) {
    const c = this.client;
    if (!c || !c.connected) return false;
    const payload = obj == null ? '' : JSON.stringify(obj);
    c.publish(topic, payload, { qos: 1, retain: true });
    return true;
  }

  /** 跨实例「所有人」聊天：不 retain，避免后进的人刷到旧消息 */
  #flushChatQueue() {
    if (!this._chatQueue.length || !this.#mqttUp()) return;
    const pending = this._chatQueue.splice(0);
    for (const msg of pending) this.publishChat(msg);
  }

  publishChat(msg) {
    if (!this.enabled || !this._started) return false;
    const c = this.client;
    if (!c || !c.connected) {
      this._chatQueue.push(msg);
      if (this._chatQueue.length > 30) this._chatQueue.shift();
      return false;
    }
    try {
      c.publish(this.#chatAllTopic(), JSON.stringify(msg), {
        qos: 1,
        retain: false,
      }, (err) => {
        if (err) {
          this._chatQueue.push(msg);
          if (this._chatQueue.length > 30) this._chatQueue.shift();
          this.#warn(err);
        }
      });
      return true;
    } catch (err) {
      this._chatQueue.push(msg);
      if (this._chatQueue.length > 30) this._chatQueue.shift();
      this.#warn(err);
      return false;
    }
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
    const wantPublish = (room) =>
      room &&
      !room.hidden &&
      (!room.status ||
        room.status === 'waiting' ||
        room.status === 'playing');

    // 没有可广播房间时立刻清空 retained，避免别人大厅继续显示旧人数/旧房间
    if (!wantPublish((this.getHostedRooms() || [])[0])) {
      if (!this.#pub(this.#roomTopic(), '')) {
        this.#scheduleRoomRetry();
        return;
      }
      if (this._lastRoomSig) {
        this._lastRoomSig = '';
        console.log('[mqtt] 已清除房间广播（房间已解散或不可见）');
      }
      return;
    }
    if (!this.#mqttUp()) {
      this.#scheduleRoomRetry();
      return;
    }
    // 地址已经在手里就立刻用，避免再 await 隧道启动
    const tunnelUrl = this.#peekUrl() || (await this.ensureTunnelUrl()) || '';
    if (!tunnelUrl) {
      this.#scheduleRoomRetry();
      return;
    }
    if (tunnelUrl !== this._lastTunnelUrl) {
      this._lastTunnelUrl = tunnelUrl;
      this._tunnelPublishAfter = Date.now() + TUNNEL_READY_DELAY_MS;
      if (TUNNEL_READY_DELAY_MS > 0) {
        this.#scheduleRoomRetry();
        console.log(
          `[mqtt] 隧道地址已更新，等待 ${TUNNEL_READY_DELAY_MS}ms 后再广播房间`
        );
        return;
      }
      console.log(`[mqtt] 隧道地址已更新，立刻广播房间`);
    }
    if (Date.now() < this._tunnelPublishAfter) {
      this.#scheduleRoomRetry();
      return;
    }
    // 等隧道期间房间可能已变，发出前再读一次
    const room = (this.getHostedRooms() || [])[0];
    if (!wantPublish(room)) {
      if (!this.#pub(this.#roomTopic(), '')) {
        this.#scheduleRoomRetry();
        return;
      }
      if (this._lastRoomSig) {
        this._lastRoomSig = '';
        console.log('[mqtt] 已清除房间广播（房间已解散或不可见）');
      }
      return;
    }
    if (!this.#mqttUp()) {
      this.#scheduleRoomRetry();
      return;
    }
    const now = Date.now();
    const payload = {
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
    };
    if (!this.#pub(this.#roomTopic(), payload)) {
      this.#scheduleRoomRetry();
      return;
    }
    const sig = `${payload.id}|${payload.host}|${payload.playerCount}|${payload.status}`;
    if (this._lastRoomSig !== sig) {
      this._lastRoomSig = sig;
      console.log(`[mqtt] 已广播房间 ${payload.id} → ${payload.host}`);
    }
  }

  #onMessage(topic, buf) {
    const raw = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
    const chatTopic = this.#chatAllTopic();
    if (topic === chatTopic || topic.endsWith('/chat/all')) {
      if (!raw.trim()) return;
      try {
        const p = JSON.parse(raw);
        if (!p || p.app !== APP_SIGNATURE || p.kind !== 'chat') return;
        if (p.instanceId && p.instanceId === this.instanceId) return;
        const body = String(p.text || '')
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120);
        if (!body) return;
        const tagDigits = String(p.tag || '').replace(/\D/g, '');
        this.onChat({
          app: APP_SIGNATURE,
          kind: 'chat',
          channel: 'all',
          roomId: null,
          name: String(p.name || '玩家').trim().slice(0, 24),
          tag: tagDigits ? tagDigits.slice(-5) : null,
          sessionId: p.sessionId ? String(p.sessionId).slice(0, 48) : null,
          instanceId: p.instanceId || null,
          text: body,
          at: Number(p.at) || Date.now(),
        });
      } catch (_) {}
      return;
    }
    const loginPrefix = `${this.#prefix()}/login/`;
    const roomPrefix = `${this.#prefix()}/room/`;
    if (topic.startsWith(loginPrefix)) {
      const id = topic.slice(loginPrefix.length);
      if (!id || id === this.instanceId) return;
      if (!raw.trim()) {
        this.logins.delete(id);
        this.onChange();
        return;
      }
      try {
        const p = JSON.parse(raw);
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
      if (!raw.trim()) {
        this.rooms.delete(id);
        this.onChange();
        return;
      }
      try {
        const p = JSON.parse(raw);
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
        // 用玩家自己的 sessionId（跨实例保持同一人）；没有则退回昵称+尾缀
        const sid = (pp && pp.sessionId)
          ? String(pp.sessionId)
          : `${name}#${(pp && pp.tag) || ''}`;
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
          sessionId: sid,
          updateTime: p.updateTime,
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
