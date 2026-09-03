'use strict';

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');

const DEFAULT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'mqtt://broker.emqx.io:1883',
];
const DEFAULT_CHANNEL = 'xiyun_lianjidating_public';
const APP_SIGNATURE = 'lianji';
const LOGIN_HB_MS = 10000;
/** 等待房房间心跳 */
const ROOM_HB_MS = 5000;
/** 对局中房间心跳（与等待房一致，便于断线后及时发现可重连房间） */
const ROOM_HB_PLAYING_MS = 5000;
/** 隧道 URL 刚出现时可额外等待再广播；给 Cloudflare DNS 一点传播时间 */
const TUNNEL_READY_DELAY_MS = Number(process.env.TUNNEL_READY_DELAY_MS) || 2500;
// 登录 10s / 等待房 5s；房间超过 15s 无心跳即视为失效
const LOGIN_OFFLINE_MS = 25000;
const ROOM_OFFLINE_MS = 15000;
/** 接收端清除超时残留的时长：实例被强杀后 retained 心跳会永久残留，
 * 超过该阈值直接丢弃，避免「离线幽灵」永远挂在别人大厅里 */
const STALE_CLEAR_MS =
  Number(process.env.MQTT_STALE_CLEAR_MS) || 120000;
const VALID_STATUS = new Set([
  'idle',
  'room',
  'playing',
  'spectating',
  'occupied',
]);

function sanitizePeople(list) {
  const out = [];
  for (const p of list || []) {
    if (!p) continue;
    const name = String(p.name || '').trim();
    if (!name) continue;
    const status = VALID_STATUS.has(p.status) ? p.status : 'idle';
    const client = normalizeClient(p.client);
    const role = normalizeRole(p.role);
    out.push({
      name,
      tag: p.tag ? String(p.tag).slice(0, 12) : null,
      status,
      roomId: p.roomId ? String(p.roomId).slice(0, 12).toUpperCase() : null,
      roomName: p.roomName ? String(p.roomName).slice(0, 40) : null,
      sessionId: p.sessionId ? String(p.sessionId).slice(0, 48) : null,
      client: client || null,
      role: role || null,
      passive: Boolean(p.passive),
      occupied: Boolean(p.occupied) || status === 'occupied',
      host: p.host ? String(p.host).replace(/\/$/, '').slice(0, 180) : '',
    });
    if (out.length >= 12) break;
  }
  return out;
}

/** 登录端：windows | mac | mobile */
function normalizeClient(raw) {
  const s = String(raw || '')
    .toLowerCase()
    .trim();
  if (s === 'windows' || s === 'win' || s === 'win32') return 'windows';
  if (s === 'mac' || s === 'macos' || s === 'darwin') return 'mac';
  if (
    s === 'mobile' ||
    s === 'android' ||
    s === 'ios' ||
    s === 'phone' ||
    s === '手机'
  ) {
    return 'mobile';
  }
  return '';
}

/** 程序角色：host=完整主机包；client=纯加入端 */
function normalizeRole(raw) {
  const s = String(raw || '')
    .toLowerCase()
    .trim();
  if (s === 'host' || s === 'server' || s === '主机' || s === '服务端') {
    return 'host';
  }
  if (s === 'client' || s === 'guest' || s === '客户端' || s === '加入端') {
    return 'client';
  }
  return '';
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
    onInvite,
    onLeave,
    onReload,
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
    this.onInvite = onInvite || (() => {});
    this.onLeave = onLeave || (() => {});
    this.onReload = onReload || (() => {});
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
    /** 隧道掉线后仍用来续心跳的上一跳公网地址 */
    this._lastKnownHost = '';
    this._tunnelPublishAfter = 0;
    this._tunnelRecovering = false;
    this._skipNextWarmup = false;
    this._ensuringTunnel = false;
    this._brokers = [];
    this._brokerIndex = 0;
    this._currentBroker = '';
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._disconnectedSince = 0;
    this._watchdogTimer = null;
    this._lastConnectedAt = 0;
  }

  isConnected() {
    return this.#mqttUp();
  }

  getStatus() {
    return {
      enabled: this.enabled,
      connected: this.#mqttUp(),
      broker: this._currentBroker || null,
      disconnectedMs:
        this._disconnectedSince && !this.#mqttUp()
          ? Date.now() - this._disconnectedSince
          : 0,
      lastConnectedAt: this._lastConnectedAt || 0,
    };
  }

  /** 手动或看门狗触发：彻底断开并换源重连 */
  reconnect() {
    if (!this.enabled) return { ok: false, message: 'MQTT 未启用' };
    if (!this._started) {
      this.start().catch((e) => this.#warn(e));
      return { ok: true, message: '正在启动广播' };
    }
    this._reconnectAttempts = 0;
    this._disconnectedSince = 0;
    this.#clearReconnectTimer();
    const brokers = this._brokers.length
      ? this._brokers.slice()
      : this.brokerOverride
        ? [this.brokerOverride]
        : DEFAULT_BROKERS.slice();
    const next = brokers.length ? (this._brokerIndex + 1) % brokers.length : 0;
    this.#connect(brokers, next, { force: true });
    return { ok: true, message: '正在重连广播' };
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
  flushIfReady(knownUrl, opts = {}) {
    if (!this.enabled || !this._started) return false;
    if (!this.#mqttUp()) return false;
    const url = this.#peekUrl(knownUrl);
    if (!url) return false;
    this._lastKnownHost = url;
    if (opts.skipWarmup) this._skipNextWarmup = true;
    if (this._tunnelRecovering) {
      this._tunnelRecovering = false;
      this._skipNextWarmup = true;
    }
    this.touchLogin().catch((e) => this.#warn(e));
    this.touchRoom({ skipWarmup: true }).catch((e) => this.#warn(e));
    this.#scheduleLogin();
    this.#scheduleRoom();
    return true;
  }

  /**
   * 隧道失效：不要清掉 retained 房间。继续用上一跳地址续心跳，
   * 同时后台拉起新隧道；新地址到手后再立刻改广播。
   */
  markTunnelLost() {
    if (!this.enabled || !this._started) return;
    this._tunnelRecovering = true;
    this._skipNextWarmup = true;
    this._tunnelPublishAfter = 0;
    if (!this._lastKnownHost) {
      this._lastKnownHost = this._lastTunnelUrl || this.#peekUrl() || '';
    }
    console.warn(
      '[mqtt] 隧道中断，房间继续广播（恢复中）' +
        (this._lastKnownHost ? ` 旧址 ${this._lastKnownHost}` : '')
    );
    this.#kickTunnelEnsure();
    this.touchRoom({ allowStaleHost: true, skipWarmup: true }).catch((e) =>
      this.#warn(e)
    );
    this.#scheduleRoom();
  }

  #kickTunnelEnsure() {
    if (!this.ensureTunnelUrl || this._ensuringTunnel) return;
    this._ensuringTunnel = true;
    let p;
    try {
      p = this.ensureTunnelUrl();
    } catch (e) {
      this._ensuringTunnel = false;
      this.#warn(e);
      return;
    }
    Promise.resolve(p)
      .catch((e) => this.#warn(e))
      .finally(() => {
        this._ensuringTunnel = false;
      });
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

  #inviteTopic() {
    return `${this.#prefix()}/invite`;
  }

  #reloadTopic() {
    return `${this.#prefix()}/reload`;
  }

  #leaveTopic() {
    return `${this.#prefix()}/leave`;
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
    this._brokers = brokers.slice();
    this.#startWatchdog();
    this.#connect(brokers, 0);
  }

  #clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  #startWatchdog() {
    if (this._watchdogTimer) return;
    this._watchdogTimer = setInterval(() => {
      if (!this._started) return;
      this.#pruneStale();
      if (this.#mqttUp()) {
        this._disconnectedSince = 0;
        return;
      }
      if (!this._disconnectedSince) this._disconnectedSince = Date.now();
      const gap = Date.now() - this._disconnectedSince;
      if (gap >= 45000) {
        this.#warn(new Error('MQTT 断线过久，自动强制重连'));
        this.reconnect();
      }
    }, 15000);
  }

  #stopWatchdog() {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }

  #scheduleReconnect(brokers, index) {
    if (!this._started || this._reconnectTimer) return;
    const delay = Math.min(30000, 2500 + (this._reconnectAttempts || 0) * 2000);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._started || this.#mqttUp()) return;
      this._reconnectAttempts = (this._reconnectAttempts || 0) + 1;
      const next = brokers.length ? (index + 1) % brokers.length : 0;
      this.#connect(brokers, next, { force: true });
    }, delay);
  }

  #detachClient(client) {
    if (!client) return;
    try {
      client.removeAllListeners();
    } catch (_) {
      /* ignore */
    }
    try {
      client.end(true);
    } catch (_) {
      /* ignore */
    }
  }

  stop() {
    this._started = false;
    this.#clearReconnectTimer();
    this.#stopWatchdog();
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
    this.#detachClient(c);
  }

  /** 清除超时残留的远端心跳/房间（实例死掉后 retained 消息不会自己消失） */
  #pruneStale() {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.logins) {
      if (!p || !p.updateTime || now - p.updateTime > STALE_CLEAR_MS) {
        this.logins.delete(id);
        this.rooms.delete(id);
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

  #connect(brokers, index, opts = {}) {
    if (!this._started) return;
    const list = brokers && brokers.length ? brokers : this._brokers;
    const url = list && list[index];
    if (!url) {
      this.#warn(new Error('无法连接公共 MQTT，稍后重试'));
      this.#scheduleReconnect(list || DEFAULT_BROKERS.slice(), 0);
      return;
    }
    this.#clearReconnectTimer();
    this._brokers = list.slice();
    this._brokerIndex = index;
    this._currentBroker = url;
    const prev = this.client;
    this.client = null;
    if (prev) this.#detachClient(prev);
    const client = mqtt.connect(url, {
      clientId: `lianji-${this.instanceId.slice(0, 8)}-${Math.random().toString(36).slice(2, 8)}`,
      clean: true,
      keepalive: 60,
      // 自行调度重连，避免库内 reconnecting 卡死
      reconnectPeriod: 0,
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
      this._lastConnectedAt = Date.now();
      this._disconnectedSince = 0;
      this._reconnectAttempts = 0;
      console.log(`[mqtt] 广播已连接 ${url} 频道=${this.channel}`);
      client.subscribe(
        [`${this.#prefix()}/login/+`, `${this.#prefix()}/room/+`],
        { qos: 0 },
        (err) => {
          if (err) this.#warn(err);
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
      client.subscribe(this.#inviteTopic(), { qos: 1 }, (err) => {
        if (err) this.#warn(err);
      });
      client.subscribe(this.#reloadTopic(), { qos: 1 }, (err) => {
        if (err) this.#warn(err);
      });
      client.subscribe(this.#leaveTopic(), { qos: 1 }, (err) => {
        if (err) this.#warn(err);
      });
      this.onChange();
    });
    client.on('message', (topic, buf) => this.#onMessage(topic, buf));
    client.on('error', (err) => {
      this.#warn(err);
      if (this.client === client && !client.connected) {
        this._disconnectedSince = this._disconnectedSince || Date.now();
        this.#scheduleReconnect(list, index);
      }
    });
    client.on('offline', () => {
      if (this.client !== client) return;
      this._disconnectedSince = this._disconnectedSince || Date.now();
    });
    client.on('close', () => {
      if (!this._started || this.client !== client) return;
      this._disconnectedSince = this._disconnectedSince || Date.now();
      this.onChange();
      this.#scheduleReconnect(list, index);
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

  /** 当前应使用的房间心跳间隔（等待房/对局中均为 5s） */
  #roomHbMs() {
    return ROOM_HB_MS;
  }

  #scheduleRoom() {
    if (this._roomTimer) clearTimeout(this._roomTimer);
    this._roomTimer = setTimeout(() => {
      this.touchRoom().catch((e) => this.#warn(e)).finally(() => {
        if (this._started) this.#scheduleRoom();
      });
    }, this.#roomHbMs());
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

  /** 房间主动解散时清掉 retained；隧道故障请用 markTunnelLost，不要走这里 */
  clearRoomBeacon() {
    if (!this.enabled || !this._started) return;
    this._tunnelRecovering = false;
    this._lastRoomSig = '';
    this.#pub(this.#roomTopic(), '');
  }

  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  #roomSig(room, tunnelUrl) {
    if (!room || !tunnelUrl) return '';
    const host = String(tunnelUrl).replace(/\/$/, '');
    const keys = this.#roomPlayerKeys(room);
    const playerCount = Math.max(
      0,
      Number(
        room.playerCount != null
          ? room.playerCount
          : keys.length
      ) || 0
    );
    const over = room.over ? 1 : 0;
    const recovering = room.tunnelRecovering ? 1 : 0;
    return `${String(room.id || '').toUpperCase()}|${host}|${playerCount}|${keys.join(',')}|${room.status || 'waiting'}|${over}|${recovering}`;
  }

  #roomPlayerKeys(room) {
    if (Array.isArray(room.players) && room.players.length) {
      return room.players
        .filter((p) => p && !p.left)
        .map((p) => `${p.name || '玩家'}:${p.tag || ''}`);
    }
    if (Array.isArray(room.playerNames)) {
      const tags = Array.isArray(room.playerTags) ? room.playerTags : [];
      return room.playerNames.map(
        (n, i) => `${n || '玩家'}:${tags[i] || ''}`
      );
    }
    return [];
  }

  #isRoomBeaconPublished(room, tunnelUrl) {
    if (!room || !tunnelUrl || !this._lastRoomSig) return false;
    if (this._lastRoomSig === this.#roomSig(room, tunnelUrl)) return true;
    // touchRoom 用 payload 记签名，大厅房间对象字段不完全相同：id+host 对上即视为已广播
    const host = String(tunnelUrl).replace(/\/$/, '');
    const prefix = `${String(room.id || '').toUpperCase()}|${host}|`;
    return this._lastRoomSig.startsWith(prefix);
  }

  /**
   * 等待 MQTT 与公网隧道就绪（含隧道稳定延迟），用于隐藏房或登录心跳。
   */
  async waitForInfrastructureReady({
    timeoutMs = 90000,
    onProgress,
    skipTouchLogin = false,
  } = {}) {
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
      // 被动模式进入前会自行发心跳，避免在标记尚未打开时提前广播
      if (!skipTouchLogin) await this.touchLogin();
      return { ok: true, tunnelUrl };
    }
    return { ok: false, message: '公网隧道或 MQTT 连接超时，请稍后重试' };
  }

  /**
   * 等待指定房间已成功发出 MQTT 房间心跳（他人可在大厅看到）。
   */
  async waitForRoomBeacon(roomId, getRoom, { timeoutMs = 20000, onProgress } = {}) {
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

  #clearPeerRoomBeacon(instanceId) {
    const id = String(instanceId || '').trim();
    if (!id || id === this.instanceId) return;
    this.#pub(this.#roomTopic(id), '');
  }

  /** 远端实例登录遗言/清空：本地立刻剔除其房间，并代清 broker retained */
  #onPeerLoginCleared(instanceId) {
    const id = String(instanceId || '').trim();
    if (!id || id === this.instanceId) return;
    this.logins.delete(id);
    this.rooms.delete(id);
    this.#clearPeerRoomBeacon(id);
    this.onChange();
  }

  #pub(topic, obj) {
    const c = this.client;
    if (!c || !c.connected) return false;
    // 空串用于清除 retained；不可 JSON.stringify('')，否则会发出 '""' 导致对端无法清空
    const payload = obj === '' || obj == null ? '' : JSON.stringify(obj);
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

  publishInvite(msg) {
    if (!this.enabled || !this._started) return false;
    const c = this.client;
    if (!c || !c.connected) return false;
    try {
      c.publish(this.#inviteTopic(), JSON.stringify(msg), {
        qos: 1,
        retain: false,
      }, (err) => {
        if (err) this.#warn(err);
      });
      return true;
    } catch (err) {
      this.#warn(err);
      return false;
    }
  }

  publishReload(msg) {
    if (!this.enabled || !this._started) return false;
    const c = this.client;
    if (!c || !c.connected) return false;
    const roomId = String((msg && msg.roomId) || '').toUpperCase();
    const host = String((msg && msg.host) || '').replace(/\/$/, '');
    if (!roomId || !host) return false;
    const targets = Array.isArray(msg && msg.targets)
      ? msg.targets
          .filter((t) => t && (t.sessionId || t.name))
          .slice(0, 12)
          .map((t) => ({
            name: String(t.name || '').trim().slice(0, 24),
            tag: t.tag ? String(t.tag).slice(0, 12) : null,
            sessionId: t.sessionId ? String(t.sessionId).slice(0, 64) : null,
          }))
      : [];
    const payload = {
      app: APP_SIGNATURE,
      kind: 'reload',
      instanceId: this.instanceId,
      roomId,
      host,
      name: String((msg && msg.name) || '').slice(0, 40),
      gameType: String((msg && msg.gameType) || ''),
      gameLabel: String((msg && msg.gameLabel) || ''),
      gameMode: String((msg && msg.gameMode) || ''),
      gameModeLabel: String((msg && msg.gameModeLabel) || ''),
      status: String((msg && msg.status) || 'playing'),
      targets,
      at: Date.now(),
    };
    try {
      c.publish(this.#reloadTopic(), JSON.stringify(payload), {
        qos: 1,
        retain: false,
      }, (err) => {
        if (err) this.#warn(err);
      });
      return true;
    } catch (err) {
      this.#warn(err);
      return false;
    }
  }

  /** 隧道换址前的上一跳公网地址（恢复中仍指向旧址） */
  getLastKnownHost() {
    return String(this._lastKnownHost || this._lastTunnelUrl || '').replace(
      /\/$/,
      ''
    );
  }

  publishLeave(msg) {
    if (!this.enabled || !this._started) return false;
    const c = this.client;
    if (!c || !c.connected) return false;
    const payload = {
      app: APP_SIGNATURE,
      kind: 'leave',
      roomId: String((msg && msg.roomId) || '').toUpperCase(),
      name: String((msg && msg.name) || '').trim().slice(0, 24),
      tag: msg && msg.tag ? String(msg.tag).slice(0, 12) : null,
      sessionId: msg && msg.sessionId ? String(msg.sessionId).slice(0, 64) : null,
      at: Date.now(),
    };
    if (!payload.roomId || (!payload.name && !payload.sessionId)) return false;
    try {
      c.publish(this.#leaveTopic(), JSON.stringify(payload), {
        qos: 1,
        retain: false,
      }, (err) => {
        if (err) this.#warn(err);
      });
      return true;
    } catch (err) {
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
    const tunnelUrl = this.#peekUrl() || '';
    const anyPassive = people.some((p) => p.passive);
    this.#pub(this.#loginTopic(), {
      app: APP_SIGNATURE,
      instanceId: this.instanceId,
      displayName: first.name,
      displayTag: first.tag || null,
      people,
      passive: anyPassive,
      host: anyPassive ? String(tunnelUrl || '').replace(/\/$/, '') : '',
      loginAt: this.loginAt,
      updateTime: now,
    });
  }

  async touchRoom(opts = {}) {
    if (!this.enabled || !this._started) return;
    const wantPublish = (room) =>
      room &&
      (!room.status ||
        room.status === 'waiting' ||
        room.status === 'playing') &&
      !room.over;

    // 没有可广播房间时立刻清空 retained，避免别人大厅继续显示旧人数/旧房间
    if (!wantPublish((this.getHostedRooms() || [])[0])) {
      this._tunnelRecovering = false;
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
    // 地址已经在手里就立刻用；没有新地址时不要阻塞等隧道（否则 15s 内心跳会断）
    const liveUrl = this.#peekUrl() || '';
    if (liveUrl) {
      this._lastKnownHost = liveUrl;
      if (this._tunnelRecovering) {
        this._tunnelRecovering = false;
        this._skipNextWarmup = true;
      }
    } else {
      this.#kickTunnelEnsure();
    }
    const allowStale =
      opts.allowStaleHost !== false &&
      (this._tunnelRecovering || opts.allowStaleHost === true);
    let tunnelUrl = liveUrl;
    if (!tunnelUrl && allowStale) {
      tunnelUrl = this._lastKnownHost || this._lastTunnelUrl || '';
      if (tunnelUrl) this._tunnelRecovering = true;
    }
    if (!tunnelUrl) {
      this.#scheduleRoomRetry();
      return;
    }
    const skipWarmup =
      Boolean(opts.skipWarmup) ||
      Boolean(this._skipNextWarmup) ||
      Boolean(this._tunnelRecovering);
    if (tunnelUrl !== this._lastTunnelUrl) {
      this._lastTunnelUrl = tunnelUrl;
      if (!skipWarmup && TUNNEL_READY_DELAY_MS > 0) {
        this._tunnelPublishAfter = Date.now() + TUNNEL_READY_DELAY_MS;
        this.#scheduleRoomRetry();
        console.log(
          `[mqtt] 隧道地址已更新，等待 ${TUNNEL_READY_DELAY_MS}ms 后再广播房间`
        );
        return;
      }
      this._tunnelPublishAfter = 0;
      this._skipNextWarmup = false;
      console.log(`[mqtt] 隧道地址已更新，立刻广播房间`);
    }
    if (!skipWarmup && Date.now() < this._tunnelPublishAfter) {
      this.#scheduleRoomRetry();
      return;
    }
    if (skipWarmup) {
      this._tunnelPublishAfter = 0;
      this._skipNextWarmup = false;
    }
    // 等隧道期间房间可能已变，发出前再读一次
    const room = (this.getHostedRooms() || [])[0];
    if (!wantPublish(room)) {
      this._tunnelRecovering = false;
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
    const seated = (room.players || []).filter((p) => p && !p.left);
    const playerCount = Math.max(
      0,
      Number(
        room.playerCount != null
          ? room.playerCount
          : seated.length
      ) || 0
    );
    const recovering = Boolean(this._tunnelRecovering && !liveUrl);
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
      playerNames: seated.map((p) => p.name || '玩家'),
      playerTags: seated.map((p) => p.tag || null),
      playerCount,
      maxPlayers: room.maxPlayers,
      status: room.status || 'waiting',
      over: Boolean(room.over),
      hasPassword: Boolean(room.hasPassword),
      // 密码明文绝不进 MQTT / 大厅列表
      observerCount: Number(room.observerCount || 0),
      passiveHosted: Boolean(room.passiveHosted),
      tunnelRecovering: recovering,
      canJoin:
        !recovering &&
        (!room.status || room.status === 'waiting') &&
        playerCount < Number(room.maxPlayers || 0),
      canSpectate: !recovering && !room.over,
      createTime: room._createdAt || now,
      updateTime: now,
    };
    if (!this.#pub(this.#roomTopic(), payload)) {
      this.#scheduleRoomRetry();
      return;
    }
    const sig = this.#roomSig(payload, tunnelUrl);
    if (this._lastRoomSig !== sig) {
      console.log(
        `[mqtt] 已广播房间 ${payload.id} → ${payload.host}` +
          (recovering ? '（隧道恢复中，对局仍保留）' : '')
      );
    }
    this._lastRoomSig = sig;
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
    const inviteTopic = this.#inviteTopic();
    if (topic === inviteTopic || topic.endsWith('/invite')) {
      if (!raw.trim()) return;
      try {
        const p = JSON.parse(raw);
        if (!p || p.app !== APP_SIGNATURE || p.kind !== 'invite') return;
        if (p.instanceId && p.instanceId === this.instanceId) return;
        this.onInvite({
          app: APP_SIGNATURE,
          kind: 'invite',
          instanceId: p.instanceId || null,
          roomId: String(p.roomId || '').toUpperCase(),
          hostName: String(p.hostName || '玩家').trim().slice(0, 24),
          hostTag: p.hostTag ? String(p.hostTag).slice(0, 12) : null,
          gameType: String(p.gameType || ''),
          gameLabel: String(p.gameLabel || ''),
          gameMode: String(p.gameMode || ''),
          gameModeLabel: String(p.gameModeLabel || ''),
          playerCount: Number(p.playerCount || 0),
          maxPlayers: Number(p.maxPlayers || 0),
          at: Number(p.at) || Date.now(),
          host: p.host ? String(p.host).replace(/\/$/, '') : null,
        });
      } catch (_) {}
      return;
    }
    const reloadTopic = this.#reloadTopic();
    if (topic === reloadTopic || topic.endsWith('/reload')) {
      if (!raw.trim()) return;
      try {
        const p = JSON.parse(raw);
        if (!p || p.app !== APP_SIGNATURE || p.kind !== 'reload') return;
        if (p.instanceId && p.instanceId === this.instanceId) return;
        const roomId = String(p.roomId || '').toUpperCase();
        const host = String(p.host || '').replace(/\/$/, '');
        if (!roomId || !host) return;
        const targets = Array.isArray(p.targets)
          ? p.targets
              .filter((t) => t && (t.sessionId || t.name))
              .slice(0, 12)
              .map((t) => ({
                name: String(t.name || '').trim().slice(0, 24),
                tag: t.tag ? String(t.tag).slice(0, 12) : null,
                sessionId: t.sessionId ? String(t.sessionId).slice(0, 64) : null,
              }))
          : [];
        this.onReload({
          app: APP_SIGNATURE,
          kind: 'reload',
          instanceId: p.instanceId || null,
          roomId,
          host,
          name: String(p.name || ''),
          gameType: String(p.gameType || ''),
          gameLabel: String(p.gameLabel || ''),
          gameMode: String(p.gameMode || ''),
          gameModeLabel: String(p.gameModeLabel || ''),
          status: String(p.status || 'playing'),
          targets,
          at: Number(p.at) || Date.now(),
        });
      } catch (_) {}
      return;
    }
    const leaveTopic = this.#leaveTopic();
    if (topic === leaveTopic || topic.endsWith('/leave')) {
      if (!raw.trim()) return;
      try {
        const p = JSON.parse(raw);
        if (!p || p.app !== APP_SIGNATURE || p.kind !== 'leave') return;
        const roomId = String(p.roomId || '').toUpperCase();
        if (!roomId) return;
        this.onLeave({
          roomId,
          name: String(p.name || '').trim(),
          tag: p.tag ? String(p.tag) : null,
          sessionId: p.sessionId ? String(p.sessionId) : null,
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
        this.#onPeerLoginCleared(id);
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
          passive: Boolean(p.passive),
          host: String(p.host || '').replace(/\/$/, ''),
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
      if (!raw.trim() || raw.trim() === '""') {
        this.rooms.delete(id);
        this.onChange();
        return;
      }
      try {
        const p = JSON.parse(raw);
        if (!p || typeof p !== 'object' || p.app !== APP_SIGNATURE) {
          // 兼容旧版误发 JSON.stringify('') → '""' 等无效载荷，直接视为清除
          this.rooms.delete(id);
          this.onChange();
          return;
        }
        const updateTime = Number(p.updateTime || 0);
        const host = String(p.host || '').replace(/\/$/, '');
        const recovering = Boolean(p.tunnelRecovering);
        if (!p.id) {
          this.rooms.delete(id);
          this.onChange();
          return;
        }
        if (!host && !recovering) {
          this.rooms.delete(id);
          this.onChange();
          return;
        }
        const prev = this.rooms.get(id);
        this.rooms.set(id, {
          id: String(p.id).toUpperCase(),
          name: String(p.name || p.id),
          creatorId: id,
          creatorName: String(p.creatorName || ''),
          creatorTag: p.creatorTag ? String(p.creatorTag) : null,
          host: host || (prev && prev.host) || '',
          gameType: String(p.gameType || ''),
          gameLabel: String(p.gameLabel || p.gameType || ''),
          gameMode: String(p.gameMode || ''),
          gameModeLabel: String(p.gameModeLabel || p.gameMode || ''),
          playerNames: Array.isArray(p.playerNames) ? p.playerNames : [],
          playerTags: Array.isArray(p.playerTags) ? p.playerTags : [],
          playerCount: Number(p.playerCount || (p.playerNames && p.playerNames.length) || 0),
          maxPlayers: Number(p.maxPlayers || 0) || undefined,
          status: String(p.status || 'waiting'),
          over: Boolean(p.over),
          hasPassword: Boolean(p.hasPassword),
          observerCount: Number(p.observerCount || 0),
          passiveHosted: Boolean(p.passiveHosted),
          tunnelRecovering: recovering,
          canJoin:
            p.canJoin != null
              ? Boolean(p.canJoin)
              : (!p.status || p.status === 'waiting') &&
                Number(p.playerCount || 0) < Number(p.maxPlayers || 0),
          canSpectate: p.canSpectate != null ? Boolean(p.canSpectate) : true,
          createTime: Number(p.createTime || 0),
          updateTime,
          instanceId: id,
          local: false,
          via: 'mqtt',
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
          client: normalizeClient(pp && pp.client) || null,
          role: normalizeRole(pp && pp.role) || null,
          passive: Boolean(pp && pp.passive),
          occupied:
            Boolean(pp && pp.occupied) ||
            String(pp && pp.status) === 'occupied',
          instanceId: p.instanceId,
          host:
            (pp && pp.host) ||
            (pp && pp.passive
              ? p.host || (knownRoom && knownRoom.host) || null
              : (knownRoom && knownRoom.host) || p.host || null),
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
        !r.over &&
        (!r.status || r.status === 'waiting' || r.status === 'playing')
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
  ROOM_HB_PLAYING_MS,
  LOGIN_OFFLINE_MS,
  ROOM_OFFLINE_MS,
  normalizeClient,
  normalizeRole,
};
