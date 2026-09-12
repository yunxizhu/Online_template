'use strict';

const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'server', 'mqttBulletin.js');
let s = fs.readFileSync(p, 'utf8');

const newHead = `/**
 * 公共 broker 列表（启动时按序探测，停在第一个可用的）。
 * 失败节点不后台空转；仅「当前断开」或「用户手动切换」时再探测。
 */
const DEFAULT_BROKER_SLOTS = [
  {
    id: 'hivemq',
    name: 'HiveMQ',
    urls: ['wss://broker.hivemq.com:8884/mqtt'],
  },
  {
    id: 'tyckr',
    name: 'Tyckr',
    urls: ['wss://mqtt.tyckr.io:8081'],
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    urls: ['wss://mqtt-dashboard.com:8884/mqtt'],
  },
  {
    id: 'mosquitto',
    name: 'Mosquitto',
    urls: [
      'wss://test.mosquitto.org:8081/mqtt',
      'mqtt://test.mosquitto.org:1883',
    ],
  },
  {
    id: 'shiftr',
    name: 'Shiftr',
    urls: ['wss://public.cloud.shiftr.io'],
    username: 'public',
    password: 'public',
  },
  {
    id: 'emqx',
    name: 'EMQX',
    urls: ['wss://broker.emqx.io:8084/mqtt', 'mqtt://broker.emqx.io:1883'],
  },
];
const DEFAULT_BROKERS = DEFAULT_BROKER_SLOTS.flatMap((s) => s.urls);
/** 浏览器 / 加入端只能用 WSS */
const DEFAULT_WSS_BROKER_SLOTS = DEFAULT_BROKER_SLOTS.map((s) => ({
  id: s.id,
  name: s.name,
  urls: s.urls.filter((u) => /^wss:\\/\\//i.test(u)),
})).filter((s) => s.urls.length);
const DEFAULT_WSS_BROKERS = DEFAULT_WSS_BROKER_SLOTS.flatMap((s) => s.urls);
`;

const hsN = s.indexOf('/**\n * 公共 broker');
const hsR = s.indexOf('/**\r\n * 公共 broker');
const hs = hsN >= 0 ? hsN : hsR;
const headEnd = s.indexOf('const DEFAULT_CHANNEL');
if (hs < 0 || headEnd < 0) {
  console.error('head markers', hs, headEnd);
  process.exit(1);
}
s = s.slice(0, hs) + newHead + s.slice(headEnd);

s = s.replace(
  /\/\*\*\n \* 固定地址广播：公共 MQTT（多 broker 网状连接）。[\s\S]*?\*\//,
  `/**
 * 固定地址广播：公共 MQTT（单节点连接）。
 * 启动时按序找第一个可用服务器并停住；失败节点不后台重连。
 * 当前断开时自动全量探测；用户可在大厅手动切换服务器。
 */`
);

const ctorStart = s.indexOf('    this.loginAt = Date.now();');
const peekMark = s.indexOf('  #peekUrl(knownUrl) {', ctorStart);
if (ctorStart < 0 || peekMark < 0) {
  console.error('ctor/peek', ctorStart, peekMark);
  process.exit(1);
}

const newMid = `    this.loginAt = Date.now();
    /** @type {import('mqtt').MqttClient|null} */
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
    /** @type {Map<string, number>} */
    this._ephemeralKeys = new Map();
    this._lastTunnelUrl = '';
    this._lastKnownHost = '';
    this._tunnelPublishAfter = 0;
    this._tunnelRecovering = false;
    this._skipNextWarmup = false;
    this._ensuringTunnel = false;
    this._brokers = [];
    this._brokerIndex = 0;
    this._currentBroker = '';
    this._activeSlotId = '';
    this._activeSlotName = '';
    this._opLock = false;
    this._intentionalDetach = false;
    this._allBrokersDown = false;
    this._allBrokersDownMessage = '';
    this._disconnectedSince = 0;
    this._watchdogTimer = null;
    this._lastConnectedAt = 0;
    this._recoverPromise = null;
  }

  isConnected() {
    return this.#mqttUp();
  }

  #slotList() {
    if (this.brokerOverride) {
      return [
        {
          id: 'custom',
          name: '自定义',
          urls: [this.brokerOverride],
        },
      ];
    }
    return DEFAULT_BROKER_SLOTS.map((x) => ({
      id: x.id,
      name: x.name,
      urls: x.urls.slice(),
    }));
  }

  getBrokerInfo() {
    if (!this._activeSlotId && !this._currentBroker) return null;
    return {
      id: this._activeSlotId || '',
      name: this._activeSlotName || this._activeSlotId || '',
      url: this._currentBroker || '',
    };
  }

  listBrokers() {
    return this.#slotList().map((x) => ({
      id: x.id,
      name: x.name,
      active: x.id === this._activeSlotId,
    }));
  }

  getStatus() {
    const broker = this.getBrokerInfo();
    return {
      enabled: this.enabled,
      connected: this.#mqttUp(),
      broker: this._currentBroker || null,
      brokerId: broker && broker.id,
      brokerName: broker && broker.name,
      brokers: this.listBrokers(),
      allBrokersDown: Boolean(this._allBrokersDown),
      allBrokersDownMessage: this._allBrokersDownMessage || '',
      disconnectedMs:
        this._disconnectedSince && !this.#mqttUp()
          ? Date.now() - this._disconnectedSince
          : 0,
      lastConnectedAt: this._lastConnectedAt || 0,
    };
  }

  /** 当前断开或手动「重连」：全量探测可用服务器 */
  reconnect() {
    if (!this.enabled) return { ok: false, message: 'MQTT 未启用' };
    if (!this._started) {
      this.start().catch((e) => this.#warn(e));
      return { ok: true, message: '正在启动广播' };
    }
    this.#recoverAll('manual').catch((e) => this.#warn(e));
    return { ok: true, message: '正在寻找可用服务器' };
  }

  /**
   * 手动切换到指定服务器；失败则回到原服务器。
   * @param {string} slotId
   */
  async switchBroker(slotId) {
    if (!this.enabled) {
      return { ok: false, message: 'MQTT 未启用' };
    }
    if (!this._started) {
      await this.start();
    }
    const slots = this.#slotList();
    const target = slots.find((x) => x.id === slotId);
    if (!target) {
      return { ok: false, message: '未知服务器' };
    }
    if (slotId === this._activeSlotId && this.#mqttUp()) {
      return {
        ok: true,
        broker: this.getBrokerInfo(),
        message: \`已在 \${target.name}\`,
      };
    }
    const prevId = this._activeSlotId;
    const result = await this.#connectExclusive({
      onlySlotId: slotId,
      reason: 'switch',
    });
    if (result.ok) {
      this._allBrokersDown = false;
      this._allBrokersDownMessage = '';
      this.onChange();
      return {
        ok: true,
        broker: this.getBrokerInfo(),
        message: \`已切换至 \${target.name}\`,
      };
    }
    let restored = { ok: false };
    if (prevId && prevId !== slotId) {
      restored = await this.#connectExclusive({
        onlySlotId: prevId,
        reason: 'restore',
      });
    }
    if (!restored.ok) {
      restored = await this.#connectExclusive({ reason: 'restore-any' });
    }
    this.onChange();
    return {
      ok: false,
      message: '该服务器无法连接',
      restored: Boolean(restored.ok),
      broker: this.getBrokerInfo(),
    };
  }

  /** 切换到列表中的下一个服务器 */
  async switchToNextBroker() {
    const slots = this.#slotList();
    if (!slots.length) {
      return { ok: false, message: '没有可切换的服务器' };
    }
    let idx = slots.findIndex((x) => x.id === this._activeSlotId);
    if (idx < 0) idx = 0;
    const next = slots[(idx + 1) % slots.length];
    return this.switchBroker(next.id);
  }

  #mqttUp() {
    return Boolean(this.client && this.client.connected);
  }

  #liveClients() {
    if (this.client && this.client.connected) return [this.client];
    return [];
  }

`;

s = s.slice(0, ctorStart) + newMid + s.slice(peekMark);

const startMark = s.indexOf('  async start() {');
const schedMark = s.indexOf('  #scheduleLogin()');
if (startMark < 0 || schedMark < 0) {
  console.error('start/sched', startMark, schedMark);
  process.exit(1);
}

const newConn = `
  async start() {
    if (!this.enabled || this._started) return;
    this._started = true;
    this._brokers = this.#slotList().flatMap((x) => x.urls);
    this.#startWatchdog();
    const result = await this.#connectExclusive({ reason: 'start' });
    if (!result.ok) {
      this._allBrokersDown = true;
      this._allBrokersDownMessage = result.message || '所有服务器都无法使用';
      console.warn('[mqtt]', this._allBrokersDownMessage);
      this.onChange();
    }
  }

  #startWatchdog() {
    if (this._watchdogTimer) return;
    this._watchdogTimer = setInterval(() => {
      if (!this._started) return;
      this.#pruneStale();
      if (this.#mqttUp()) {
        this._disconnectedSince = 0;
        this._allBrokersDown = false;
        this._allBrokersDownMessage = '';
        return;
      }
      if (!this._disconnectedSince) this._disconnectedSince = Date.now();
      this.#recoverAll('watchdog').catch((e) => this.#warn(e));
    }, 15000);
  }

  #stopWatchdog() {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }

  #recoverAll(reason) {
    if (this._recoverPromise) return this._recoverPromise;
    this._recoverPromise = this.#connectExclusive({ reason: reason || 'recover' })
      .then((result) => {
        if (result.ok) {
          this._allBrokersDown = false;
          this._allBrokersDownMessage = '';
        } else {
          this._allBrokersDown = true;
          this._allBrokersDownMessage =
            result.message || '所有服务器都无法使用';
          console.warn('[mqtt]', this._allBrokersDownMessage);
        }
        this.onChange();
        return result;
      })
      .finally(() => {
        this._recoverPromise = null;
      });
    return this._recoverPromise;
  }

  #detachClient(client, { force = true } = {}) {
    if (!client) return;
    try {
      client.removeAllListeners();
    } catch (_) {}
    try {
      client.end(force);
    } catch (_) {}
  }

  stop() {
    this._started = false;
    this._intentionalDetach = true;
    this.#stopWatchdog();
    if (this._loginTimer) {
      clearTimeout(this._loginTimer);
      this._loginTimer = null;
    }
    if (this._roomTimer) {
      clearTimeout(this._roomTimer);
      this._roomTimer = null;
    }
    if (this._roomRetryTimer) {
      clearTimeout(this._roomRetryTimer);
      this._roomRetryTimer = null;
    }
    const c = this.client;
    this.client = null;
    if (c) {
      try {
        c.publish(this.#loginTopic(), '', { qos: 0, retain: true });
        c.publish(this.#roomTopic(), '', { qos: 0, retain: true });
      } catch (_) {}
      this.#detachClient(c, { force: true });
    }
    this._intentionalDetach = false;
  }

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

  #tryConnectUrl(url, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const client = mqtt.connect(url, {
        clientId: \`lianji-\${this.instanceId.slice(0, 8)}-\${Math.random()
          .toString(36)
          .slice(2, 8)}\`,
        clean: true,
        keepalive: 60,
        reconnectPeriod: 0,
        connectTimeout: timeoutMs,
        protocolVersion: 4,
        will: {
          topic: this.#loginTopic(),
          payload: '',
          qos: 1,
          retain: true,
        },
      });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.#detachClient(client, { force: true });
        reject(new Error('连接超时'));
      }, timeoutMs + 500);
      client.on('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(client);
      });
      client.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#detachClient(client, { force: true });
        reject(err || new Error('连接失败'));
      });
    });
  }

  #wireClient(client) {
    client.on('message', (topic, buf) => this.#onMessage(topic, buf));
    client.on('error', (err) => {
      this.#warn(err);
    });
    client.on('close', () => {
      if (!this._started || this._intentionalDetach) return;
      if (this.client !== client) return;
      this.client = null;
      this._disconnectedSince = Date.now();
      console.warn('[mqtt] 当前服务器已断开，正在寻找可用服务器…');
      this.onChange();
      this.#recoverAll('disconnect').catch((e) => this.#warn(e));
    });
  }

  #subscribeAll(client) {
    client.subscribe(
      [\`\${this.#prefix()}/login/+\`, \`\${this.#prefix()}/room/+\`],
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
  }

  async #connectExclusive({ onlySlotId = null, reason = '' } = {}) {
    if (this._opLock) {
      return { ok: false, message: '正在切换服务器，请稍候' };
    }
    this._opLock = true;
    const slots = this.#slotList();
    let order = slots.slice();
    if (onlySlotId) {
      order = slots.filter((x) => x.id === onlySlotId);
    }
    try {
      for (const slot of order) {
        for (const url of slot.urls) {
          console.log(
            \`[mqtt] 正在探测 [\${slot.name}] \${url}\` +
              (reason ? \`（\${reason}）\` : '') +
              '…'
          );
          try {
            const client = await this.#tryConnectUrl(url);
            this._intentionalDetach = true;
            const prev = this.client;
            this.client = null;
            if (prev) this.#detachClient(prev, { force: false });
            this._intentionalDetach = false;

            this.client = client;
            this._activeSlotId = slot.id;
            this._activeSlotName = slot.name;
            this._currentBroker = url;
            this._brokerIndex = slots.findIndex((x) => x.id === slot.id);
            this._lastConnectedAt = Date.now();
            this._disconnectedSince = 0;
            this._allBrokersDown = false;
            this._allBrokersDownMessage = '';
            this.#wireClient(client);
            this.#subscribeAll(client);
            console.log(
              \`[mqtt] 广播已连接 [\${slot.name}] \${url} 频道=\${this.channel}\`
            );
            this.onChange();
            return {
              ok: true,
              broker: this.getBrokerInfo(),
            };
          } catch (err) {
            const msg = err && err.message ? err.message : String(err || '');
            console.warn(\`[mqtt] 不可用 [\${slot.name}] \${url}: \${msg}\`);
          }
        }
      }
      return {
        ok: false,
        message: onlySlotId ? '该服务器无法连接' : '所有服务器都无法使用',
      };
    } finally {
      this._opLock = false;
    }
  }

`;

s = s.slice(0, startMark) + newConn + s.slice(schedMark);

// Fix double-escaped regex in WSS filter if needed
s = s.replace(
  'urls: s.urls.filter((u) => /^wss:\\\\/\\\\//i.test(u)),',
  'urls: s.urls.filter((u) => /^wss:\\/\\//i.test(u)),'
);

fs.writeFileSync(p, s);
console.log('ok, length', s.length);
