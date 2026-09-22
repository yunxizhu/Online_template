'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { RoomManager, fullRoomView } = require('./rooms');
const { listGames, getGame } = require('./games');
const { syncTurnTimer, clearTurnTimer } = require('./turnTimer');
const { MqttBulletin, ROOM_OFFLINE_MS } = require('./mqttBulletin');
const { QuickTunnel, createControlTunnel } = require('./tunnel');
const { HostUpdateChecker } = require('./updateChecker');
const { HostOccupancy } = require('./hostOccupancy');
const { TunnelNickMemory } = require('./tunnelNickMemory');
const crypto = require('crypto');
const pathRoot = path.join(__dirname, '..');
const hostUpdate = new HostUpdateChecker({ rootDir: pathRoot });
const hostOccupancy = new HostOccupancy();
const tunnelNickMemory = new TunnelNickMemory({
  filePath: path.join(pathRoot, '.lianji-tunnel-nicks.json'),
});

function hostnameFromHostHeader(host) {
  let s = String(host || '')
    .trim()
    .toLowerCase();
  if (!s) return '';
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    return end >= 0 ? s.slice(0, end + 1) : s;
  }
  // host:port → host（IPv4 / 域名）
  const colon = s.lastIndexOf(':');
  if (colon > 0 && /^\d+$/.test(s.slice(colon + 1))) {
    return s.slice(0, colon);
  }
  return s;
}

function hostnameFromUrl(raw) {
  try {
    return String(new URL(String(raw || '')).hostname || '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function isLoopbackHost(hostname) {
  const h = String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0:0:0:0:0:0:0:1'
  );
}

function isPrivateIPv4(hostname) {
  const m = String(hostname || '').match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  );
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isTunnelHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return (
    h === 'trycloudflare.com' ||
    h.endsWith('.trycloudflare.com') ||
    h.endsWith('.cfargotunnel.com')
  );
}

/**
 * 访问来源：console=本机控制台，lan=局域网，tunnel=公网隧道（仅进房）。
 */
function classifyAccess(hostHeader, origin, referer) {
  const hosts = [
    hostnameFromHostHeader(hostHeader),
    hostnameFromUrl(origin),
    hostnameFromUrl(referer),
  ].filter(Boolean);
  for (const h of hosts) {
    if (isLoopbackHost(h)) return 'console';
  }
  for (const h of hosts) {
    if (isTunnelHost(h)) return 'tunnel';
  }
  for (const h of hosts) {
    if (isPrivateIPv4(h)) return 'lan';
  }
  // 其它公网域名/公网 IP：按隧道访客（仅进房）
  return 'tunnel';
}

function isLocalPageHeaders(host, origin, referer) {
  return classifyAccess(host, origin, referer) === 'console';
}

function isHostConsoleRequest(req) {
  return isLocalPageHeaders(
    req.headers.host,
    req.headers.origin,
    req.headers.referer
  );
}

function socketAccess(socket) {
  const hs = (socket && socket.handshake) || {};
  const headers = hs.headers || {};
  return classifyAccess(headers.host, headers.origin, headers.referer);
}

function isHostConsoleSocket(socket) {
  return socketAccess(socket) === 'console';
}

/** 本机控制台或局域网：参与设备占用锁 */
function canClaimOccupancy(access) {
  return access === 'console' || access === 'lan';
}

const HOST_OCCUPIED_MSG = '本机已被占用';

function occupantPayload() {
  const snap = hostOccupancy.getSnapshot();
  if (!snap) return null;
  return {
    name: snap.name || '',
    tag: snap.tag || '',
    sessionId: snap.sessionId || '',
    who: snap.who || '',
  };
}

function hostOccupiedMessage() {
  const who = hostOccupancy.formatWho();
  if (who) return `${HOST_OCCUPIED_MSG}（占用者：${who}）`;
  return HOST_OCCUPIED_MSG;
}

function emitHostOccupied(socket) {
  if (!socket) return;
  socket.emit('host:occupied', {
    message: hostOccupiedMessage(),
    occupant: occupantPayload(),
  });
}

/** 开房/被动：仅占用者或可认领的本机/局域网 */
function assertHostOccupant(socket, sessionId) {
  const me = rooms.getPlayer(socket.id);
  const sid =
    sessionId ||
    (me && me.sessionId) ||
    null;
  const access = socket.data.access || socketAccess(socket);
  if (hostOccupancy.isOwner(sid, socket.id)) {
    return { ok: true };
  }
  if (canClaimOccupancy(access)) {
    if (hostOccupancy.isBlockedFor(sid, socket.id)) {
      return {
        ok: false,
        error: hostOccupiedMessage(),
        occupant: occupantPayload(),
      };
    }
    hostOccupancy.claim(sid, socket.id, {
      name: me && me.name,
      tag: me && me.tag,
    });
    return { ok: true };
  }
  return {
    ok: false,
    error: '隧道访客只能加入房间，请在本机或局域网创建房间',
    occupant: occupantPayload(),
  };
}

function listLanIPv4() {
  const ips = [];
  const ifaces = require('os').networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) {
        ips.push(info.address);
      }
    }
  }
  return ips;
}

function pickPrimaryLanIP() {
  const ips = listLanIPv4();
  return ips[0] || '127.0.0.1';
}

const PORT = Number(process.env.PORT) || 3000;
const INSTANCE_ID = crypto.randomUUID();
const HALL_CHAT_ROOM = 'hall';
const INVITE_COOLDOWN_MS = 10000;
const lastInviteAt = new Map(); // socketId -> timestamp
const app = express();
const server = http.createServer(app);

// Capacitor / 纯加入端从 https://localhost 跨域拉取 /api/info、游戏面板等
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/** 隧道探活用轻量接口，必须在 static 之前，避免被首页拖慢 */
app.get('/healthz', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, t: Date.now() });
});

/** 隧道访客快速召回昵称（无需等 Socket 握手） */
app.get('/api/tunnel-nick', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const name = tunnelNickMemory.recallFromHttpReq(req) || '';
    res.status(200).json({ ok: true, name });
  } catch (_) {
    res.status(200).json({ ok: true, name: '' });
  }
});

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // 隧道上优先靠 WebSocket；压缩大包 game:state，避免轮询把操作拖成数秒
  pingInterval: 10000,
  pingTimeout: 25000,
  maxHttpBufferSize: 8 * 1024 * 1024,
  httpCompression: { threshold: 256 },
  perMessageDeflate: { threshold: 256 },
  connectTimeout: 20000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
});

hostOccupancy.onRelease = () => {
  try {
    io.emit('host:free', { message: '本机已空闲' });
  } catch (_) {}
};

/**
 * 被动模式远程操控者（隧道访客通过公网地址操控本机大厅：开房/观战/聊天）。
 * 同一时间只允许一名操控者。
 */
let passiveController = null;

function normalizePassiveWhoName(name) {
  return (
    String(name || '')
      .trim()
      .replace(/#\d{1,8}\s*$/, '')
      .trim()
      .slice(0, 16) || ''
  );
}

function normalizePassiveWhoTag(tag) {
  const digits = String(tag || '')
    .replace(/\D/g, '')
    .slice(-5);
  return digits ? digits.padStart(5, '0') : '';
}

function formatPassiveControllerWho(ctrl) {
  if (!ctrl) return '';
  const name = normalizePassiveWhoName(ctrl.name);
  const tag = normalizePassiveWhoTag(ctrl.tag);
  if (name && tag) return `${name}#${tag}`;
  if (name) return name;
  if (tag) return `#${tag}`;
  return '';
}

function listPassiveHostPlayers() {
  return [...rooms.players.values()].filter((p) => p && p.passive);
}

function hasPassiveHost() {
  return listPassiveHostPlayers().length > 0;
}

function getPassiveControllerPayload() {
  if (!passiveController) return null;
  return {
    socketId: passiveController.socketId,
    sessionId: passiveController.sessionId || '',
    name: passiveController.name || '',
    tag: passiveController.tag || '',
    who: formatPassiveControllerWho(passiveController),
  };
}

function isPassiveController(socket, sessionId) {
  if (!passiveController || !socket) return false;
  if (passiveController.socketId === socket.id) return true;
  const sid = sessionId ? String(sessionId).slice(0, 64).trim() : '';
  if (sid && passiveController.sessionId === sid) return true;
  return false;
}

function emitPassiveControlUpdate(extraSocket = null) {
  const payload = {
    controller: getPassiveControllerPayload(),
    publicUrl: getPassiveShareUrl() || null,
    passiveMode: hasPassiveHost(),
  };
  for (const p of listPassiveHostPlayers()) {
    io.to(p.id).emit('lobby:passiveControl', payload);
  }
  if (extraSocket) {
    extraSocket.emit('lobby:passiveControl', payload);
  }
}

function claimPassiveController(socket, player) {
  if (!socket || !hasPassiveHost()) return false;
  const access = socket.data.access || socketAccess(socket);
  if (access !== 'tunnel') return false;
  const sid =
    (player && player.sessionId && String(player.sessionId).slice(0, 64)) ||
    '';
  if (
    passiveController &&
    !isPassiveController(socket, sid)
  ) {
    return false;
  }
  const name = normalizePassiveWhoName(
    (player && player.name) || socket.data.playerName || ''
  );
  const tag = normalizePassiveWhoTag(player && player.tag);
  passiveController = {
    socketId: socket.id,
    sessionId: sid || `sock:${socket.id}`,
    name,
    tag,
  };
  socket.data.controllingPassive = true;
  emitPassiveControlUpdate(socket);
  return true;
}

function releasePassiveController(socket, { silent = false } = {}) {
  if (!passiveController || !socket) return false;
  const me = rooms.getPlayer(socket.id);
  const sid = me && me.sessionId ? String(me.sessionId).slice(0, 64) : '';
  if (!isPassiveController(socket, sid)) return false;
  const peerId = sid ? findLiveSessionPeer(sid, socket.id) : null;
  if (peerId) {
    const peer = rooms.getPlayer(peerId);
    passiveController = {
      socketId: peerId,
      sessionId: sid,
      name: normalizePassiveWhoName((peer && peer.name) || passiveController.name),
      tag: normalizePassiveWhoTag((peer && peer.tag) || passiveController.tag),
    };
    const peerSock = io.sockets.sockets.get(peerId);
    if (peerSock) peerSock.data.controllingPassive = true;
    socket.data.controllingPassive = false;
    if (!silent) emitPassiveControlUpdate();
    return true;
  }
  passiveController = null;
  socket.data.controllingPassive = false;
  if (!silent) emitPassiveControlUpdate();
  return true;
}

function clearPassiveController({ silent = false } = {}) {
  if (!passiveController) return;
  const sock = io.sockets.sockets.get(passiveController.socketId);
  if (sock) sock.data.controllingPassive = false;
  passiveController = null;
  if (!silent) emitPassiveControlUpdate();
}

function findLiveSessionPeer(sessionId, exceptSocketId) {
  const sid = sessionId ? String(sessionId).slice(0, 64) : '';
  if (!sid) return null;
  for (const [id, sock] of io.sockets.sockets) {
    if (id === exceptSocketId || !sock || !sock.connected) continue;
    const p = rooms.getPlayer(id);
    if (p && p.sessionId && String(p.sessionId).slice(0, 64) === sid) {
      return id;
    }
  }
  return null;
}

const rooms = new RoomManager();
let mqttBulletin = null;
/** 房间隧道：MQTT 进房 / 对局；仅探活失败换址，退出房间/结束对局不重启 */
let tunnel = null;
/** 被动控制隧道：分享入口；每次重启/换址使用随机 trycloudflare 地址 */
let controlTunnel = null;

/** 实例对外展示名：取大厅内第一个玩家，无玩家则为空（空实例不出现在他人大厅） */
function currentDisplayName() {
  const first = [...rooms.players.values()][0];
  return (first && first.name) || '';
}

app.use(express.static(path.join(__dirname, '..', 'public')));

// 三国杀资源路径：打包后优先使用外部 resourse，支持环境变量覆盖
function getSgsResourseDir() {
  const envPath = process.env.LIANJI_RESOURSE;
  if (envPath) return envPath;
  const isPkg = Boolean(process.pkg);
  if (isPkg) {
    const exeDir = path.dirname(process.execPath);
    const external = path.join(exeDir, 'resourse');
    if (fs.existsSync(external)) return external;
  }
  return path.join(__dirname, 'games', 'sgs', 'resourse');
}
const sgsResourseDir = getSgsResourseDir();
const staticResOpts = {
  // 开发默认不长期缓存；生产也允许协商校验，换图后靠 ?v= 或 ETag 更新
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  etag: true,
  lastModified: true,
  setHeaders(res) {
    if (process.env.NODE_ENV !== 'production') {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    }
  },
};
app.use('/games/sgs/res', express.static(sgsResourseDir, staticResOpts));

// 卡拉斯坦资源：server/games/lasidao/resourse → /games/lasidao/res/
function getLasidaoResourseDir() {
  const envPath = process.env.LIANJI_LASIDAO_RESOURSE;
  if (envPath) return envPath;
  const isPkg = Boolean(process.pkg);
  if (isPkg) {
    const exeDir = path.dirname(process.execPath);
    const external = path.join(exeDir, 'lasidao-resourse');
    if (fs.existsSync(external)) return external;
  }
  return path.join(__dirname, 'games', 'lasidao', 'resourse');
}
app.use('/games/lasidao/res', express.static(getLasidaoResourseDir(), staticResOpts));

// 卡坦岛资源：server/games/catan/resourse → /games/catan/res/
function getCatanResourseDir() {
  const envPath = process.env.LIANJI_CATAN_RESOURSE;
  if (envPath) return envPath;
  const isPkg = Boolean(process.pkg);
  if (isPkg) {
    const exeDir = path.dirname(process.execPath);
    const external = path.join(exeDir, 'catan-resourse');
    if (fs.existsSync(external)) return external;
  }
  return path.join(__dirname, 'games', 'catan', 'resourse');
}
app.use('/games/catan/res', express.static(getCatanResourseDir(), staticResOpts));
// 浏览器默认还会请求 /favicon.ico
app.get('/favicon.ico', (_req, res) => {
  res.redirect(301, '/favicon.svg');
});

app.get('/api/info', (_req, res) => {
  res.json({
    port: PORT,
    lanIPs: listLanIPv4(),
    primaryIP: pickPrimaryLanIP(),
    instanceId: INSTANCE_ID,
    mqttBulletin: Boolean(mqttBulletin && mqttBulletin.enabled),
    mqttConnected: mqttBulletin ? mqttBulletin.isConnected() : false,
    publicUrl: getControlPublicUrl() || getRoomPublicUrl() || null,
    controlUrl: getControlPublicUrl() || null,
    roomUrl: getRoomPublicUrl() || null,
    controlTunnelNamed: false,
    games: listGames(),
    version: hostUpdate.getLocalVersion(),
    updateEnabled: !hostUpdate.disabled,
    passiveMode: hasPassiveHost(),
    passiveController: getPassiveControllerPayload(),
  });
});

/** 更新公告（public/changelog.json，随主机 OTA 下发） */
app.get('/api/changelog', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const file = path.join(__dirname, '..', 'public', 'changelog.json');
  let entries = [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(raw && raw.entries)) entries = raw.entries;
  } catch (_) {
    entries = [];
  }
  const version = hostUpdate.getLocalVersion();
  res.json({
    ok: true,
    version,
    entries: entries.slice(0, 50).map((e) => ({
      version: String((e && e.version) || ''),
      notes: String((e && e.notes) || ''),
      notesEn: String((e && (e.notesEn || e.notes_en)) || ''),
      publishedAt: String((e && e.publishedAt) || ''),
    })),
  });
});

/** 主机 OTA 状态；apply 仅本机可调用（防隧道访客乱升级） */
app.get('/api/update/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const canApply = isHostConsoleRequest(req);
  try {
    if (req.query.refresh === '1' || req.query.check === '1') {
      // update.off：后台 refresh 不强制联网，仅标记跳过；有 update.off 时用手动 /check
      await hostUpdate.check({ force: !hostUpdate.disabled });
    }
  } catch (_) {
    /* status 里带 error */
  }
  const st = hostUpdate.getStatus();
  // 不把完整 changed.url 列表回给非本机，减少信息暴露
  const changed =
    canApply && Array.isArray(st.changed)
      ? st.changed.map((f) => ({
          path: f.path,
          size: f.size,
          sha256: f.sha256,
        }))
      : undefined;
  res.json({
    ...st,
    changed,
    canApply,
  });
});

app.post('/api/update/check', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isHostConsoleRequest(req)) {
    return res.status(403).json({ ok: false, message: '请在本机浏览器（localhost）操作升级' });
  }
  try {
    // 手动检查：即使存在 update.off 也强制联网检测（允许手动升级）
    const result = await hostUpdate.check({ force: true });
    res.json({ ok: true, ...result, canApply: true, enabled: !hostUpdate.disabled });
  } catch (err) {
    res.status(500).json({
      ok: false,
      message: err && err.message ? err.message : String(err),
    });
  }
});

app.post('/api/update/apply', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isHostConsoleRequest(req)) {
    return res.status(403).json({ ok: false, message: '请在本机浏览器（localhost）操作升级' });
  }
  if (hostUpdate.applying) {
    return res.status(409).json({ ok: false, message: '正在更新中' });
  }
  try {
    const result = await hostUpdate.apply({ restart: true });
    res.json({ ok: true, ...result });
    if (result.restart) {
      setTimeout(() => {
        console.log('[update] 更新完成，重启进程…');
        process.exit(0);
      }, 600);
    }
  } catch (err) {
    res.status(500).json({
      ok: false,
      message: err && err.message ? err.message : String(err),
      progress: hostUpdate.progress,
    });
  }
});

function localBaseUrl() {
  return `http://${pickPrimaryLanIP()}:${PORT}`;
}

function beaconRooms() {
  return [...rooms.rooms.values()]
    .filter((room) => !room.pendingLobby)
    .map((room) => ({
      id: room.id,
      name: room.name,
      hasPassword: Boolean(room.hasPassword),
      playerCount: (room.players || []).filter((p) => !p.left).length,
      maxPlayers: room.maxPlayers,
      minPlayers: room.minPlayers,
      status: room.status,
      gameType: room.gameType,
      gameLabel: room.gameLabel,
      gameMode: room.gameMode,
      gameModeLabel: room.gameModeLabel,
      observerCount: (room.observers || []).length,
      passiveHosted: Boolean(room.passiveHosted),
      players: room.players || [],
    }));
}

/** 远端房间解析：统一走 MQTT 广播（host 为 Cloudflare 隧道地址） */
function resolveRoomRemote(roomId) {
  const id = String(roomId || '').toUpperCase();
  if (!id) return null;
  return mqttBulletin ? mqttBulletin.resolveRoom(id) : null;
}

function buildLobbyPayload() {
  const localHost = localBaseUrl();
  const roomUrl = getRoomPublicUrl() || null;
  const controlUrl = getControlPublicUrl() || null;
  const advertiseHost = roomUrl || localHost;
  const passiveHost = controlUrl || roomUrl || localHost;
  const localRooms = rooms.listLobbyRooms().map((room) => ({
    ...room,
    host: advertiseHost,
    local: true,
  }));

  const remoteRooms = mqttBulletin ? mqttBulletin.getPublicRooms() : [];
  const peers = mqttBulletin ? mqttBulletin.getOnlinePeers() : [];

  const localPeople = rooms.listLobbyPeople().map((p) => ({
    ...p,
    local: true,
    host: p.passive ? passiveHost : localHost,
  }));
  const remotePeople = mqttBulletin ? mqttBulletin.getRemotePeople() : [];
  const people = mergeLobbyPeople(localPeople, remotePeople);

  return {
    rooms: [...localRooms, ...remoteRooms],
    peers,
    people,
    localHost,
    mqttBulletin: Boolean(mqttBulletin && mqttBulletin.enabled),
    mqttConnected: mqttBulletin ? mqttBulletin.isConnected() : false,
    mqttBroker: mqttBulletin ? mqttBulletin.getBrokerInfo() : null,
    mqttBrokers: mqttBulletin ? mqttBulletin.listBrokers() : [],
    mqttAllBrokersDown: Boolean(
      mqttBulletin && mqttBulletin.getStatus().allBrokersDown
    ),
    mqttAllBrokersDownMessage:
      (mqttBulletin && mqttBulletin.getStatus().allBrokersDownMessage) || '',
    publicUrl: controlUrl || roomUrl,
    controlUrl,
    roomUrl,
    games: listGames(),
    // 含已代开进观战席的被动主机：隧道访客仍可操控/观战/聊天
    passiveMode: hasPassiveHost(),
    passiveIdle: Boolean(
      [...rooms.players.values()].some((p) => p.passive && !p.roomId)
    ),
    passiveController: getPassiveControllerPayload(),
  };
}

function personLabelKey(person) {
  const name = String(person && person.name ? person.name : '').trim();
  const tag = String(person && person.tag ? person.tag : '').trim();
  return `${name}#${tag}`;
}

/** 兼容旧心跳把 instanceId 拼在 sessionId 前面 */
function personSessionKey(person) {
  const raw = String((person && person.sessionId) || '').trim();
  if (!raw) return '';
  const idx = raw.indexOf(':');
  if (idx > 0) {
    const rest = raw.slice(idx + 1).trim();
    if (rest) return rest;
  }
  return raw;
}

function personIdentityKey(person) {
  const sid = personSessionKey(person);
  if (sid) return `sid:${sid}`;
  const label = personLabelKey(person);
  if (label && label !== '#') return `nick:${label}`;
  return `id:${(person && (person.id || person.socketId)) || Math.random()}`;
}

function pickLaterPerson(prev, person) {
  if (!prev) return person;
  const tNew = Number(person.updateTime || 0);
  const tOld = Number(prev.updateTime || 0);
  // 同一玩家只留一条状态：心跳更新时间更晚的覆盖；时间相同则后写入的覆盖
  return tNew >= tOld ? person : prev;
}

/** 合并本机+远端人员：同一玩家只出现一次，以最近一次心跳为准 */
function mergeLobbyPeople(localPeople, remotePeople) {
  const byKey = new Map();
  const put = (person) => {
    if (!person) return;
    const key = personIdentityKey(person);
    byKey.set(key, pickLaterPerson(byKey.get(key), person));
  };

  const now = Date.now();
  for (const p of localPeople || []) {
    put({ ...p, updateTime: p.updateTime || now });
  }
  for (const p of remotePeople || []) put(p);

  // 再按昵称+尾缀合并：同一个人跨实例（进房后本机空闲残影 vs 房主侧房间中）只留最新
  const byLabel = new Map();
  const unlabeled = [];
  for (const person of byKey.values()) {
    const label = personLabelKey(person);
    if (!label || label === '#') {
      unlabeled.push(person);
      continue;
    }
    byLabel.set(label, pickLaterPerson(byLabel.get(label), person));
  }

  return [...byLabel.values(), ...unlabeled].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'zh')
  );
}

function dropIdleSessionGhosts(sessionId, keepId) {
  if (!sessionId) return;
  const dropped = rooms.evictIdleSessionDuplicates(sessionId, keepId);
  for (const id of dropped) {
    const stale = io.sockets.sockets.get(id);
    if (stale) stale.disconnect(true);
  }
}

/**
 * 创建等待期间客户端可能已换新 socket：优先用仍在线的同 session 连接收尾。
 */
function resolveLiveCreatorSocket(preferredSocket, sessionId) {
  if (preferredSocket && preferredSocket.connected) return preferredSocket;
  const sid = sessionId ? String(sessionId).slice(0, 64) : '';
  if (sid) {
    for (const p of rooms.players.values()) {
      if (!p || p.sessionId !== sid) continue;
      const s = io.sockets.sockets.get(p.id);
      if (s && s.connected) return s;
    }
  }
  return preferredSocket || null;
}

function playerRegisterOpts(data = {}) {
  return {
    sessionId: data.sessionId || null,
    playerTag: data.playerTag || null,
    client: data.client || null,
    role: data.role || null,
    lastHost: data.lastHost || null,
    lastRoomId: data.lastRoomId || data.roomId || null,
    lastRoomName: data.lastRoomName || null,
    lastStatus: data.lastStatus || null,
  };
}

function hostedBeaconRooms() {
  return beaconRooms()
    .filter((r) => {
      const full = rooms.getRoom(r.id);
      if (!full) return false;
      if (full.hostId && rooms.getPlayer(full.hostId)) return true;
      return (
        (full.players && full.players.some((p) => !p.left)) ||
        (full.observers && full.observers.length)
      );
    })
    .map((r) => {
      const full = rooms.getRoom(r.id);
      return {
        ...r,
        _createdAt: (full && full.createdAt) || Date.now(),
        players: full && full.players
          ? full.players
              .filter((p) => p && !p.left)
              .map((p) => ({ name: p.name, tag: p.tag || null, left: false }))
          : [],
        observers: full && full.observers
          ? full.observers.map((p) => ({ name: p.name, tag: p.tag || null }))
          : [],
        observerCount: full && full.observers ? full.observers.length : 0,
        passiveHosted: Boolean(full && full.passiveHosted),
        over: Boolean(full && full.game && full.game.over),
        hasPassword: Boolean(full && full.hasPassword),
      };
    })
    .sort((a, b) => {
      if (Boolean(a.over) !== Boolean(b.over)) return a.over ? 1 : -1;
      return (Number(b._createdAt) || 0) - (Number(a._createdAt) || 0);
    });
}

function mqttOnLogin() {
  if (mqttBulletin && mqttBulletin.enabled) mqttBulletin.pulseLogin();
}

function mqttAfterRoomChange() {
  if (mqttBulletin && mqttBulletin.enabled) mqttBulletin.pulseRoom();
}

function applyExplicitLeaveResult(result) {
  if (!result || !result.ok || result.noop) return;
  if (result.leftObserver && result.room) {
    emitSpectatorLeft(result.room, result.leftObserver);
    emitRoomUpdate(result.room);
  } else if (result.abandoned && result.room) {
    handleAbandonedPlayers(result.room);
    io.to(result.room.id).emit('game:player-left', {
      playerId: null,
      name: result.playerName,
      tag: result.playerTag,
    });
    emitRoomUpdate(result.room);
    emitGameState(result.room);
    if (result.room.status === 'playing' && result.room.game) {
      syncTurnTimer(result.room, { onTimeout: handleTurnTimeout });
    }
  } else if (result.dissolved) {
    for (const otherId of result.affectedPlayerIds || []) {
      const otherSocket = io.sockets.sockets.get(otherId);
      if (otherSocket && result.leftRoomId) {
        otherSocket.leave(result.leftRoomId);
      }
      io.to(otherId).emit('room:left', {
        reason: 'dissolved',
        roomId: result.leftRoomId || null,
      });
    }
  } else if (result.room) {
    emitRoomUpdate(result.room);
  }
  emitLobbyUpdate();
  mqttOnLogin();
  if (result.dissolved) mqttClearRoomOnDissolve();
  else mqttAfterRoomChange();
  if (result.dissolved) stopTunnelIfIdle();
}

/** 对局开始/结束或房间状态变化：立刻刷新大厅 + MQTT 房间心跳 */
function mqttNotifyRoomStatusNow() {
  emitLobbyUpdate();
  mqttOnLogin();
  mqttAfterRoomChange();
}

/**
 * 对局过程中状态边界：开局已在 room:start 处理；此处捕获「刚结束」等。
 */
function afterPlayingMutation(room, { wasOver = false, wasStatus = null } = {}) {
  if (!room) return;
  const nowOver = Boolean(room.game && room.game.over);
  const nowStatus = room.status || null;
  if ((nowOver && !wasOver) || (wasStatus && nowStatus && wasStatus !== nowStatus)) {
    mqttNotifyRoomStatusNow();
  }
  scheduleDoudizhuNextHand(room);
}

/** 实时对战（弹射对决）：服务端权威模拟循环，负责推进物理并广播快照 */
function startRealtimeLoop(room) {
  if (!room || !room.game) return;
  const mod = getGame(room.gameType);
  if (!mod || typeof mod.startLoop !== 'function') return;
  mod.startLoop(room, {
    isAlive: () => rooms.getRoom(room.id) === room,
    broadcastState: () => emitGameState(room),
    broadcastRt: (payload) => {
      try {
        io.to(room.id).emit('game:rt', payload);
      } catch (_) {
        /* ignore */
      }
    },
  });
}

function stopRealtimeLoop(room) {
  if (!room) return;
  const mod = getGame(room.gameType);
  if (mod && typeof mod.stopLoop === 'function') mod.stopLoop(room.id);
}

/** 斗地主：本局结束且系列赛未完 → 短暂展示结果后自动开下一局 */
const _ddzNextHandTimers = new Map();
function scheduleDoudizhuNextHand(room) {
  if (!room || room.gameType !== 'doudizhu' || !room.game) return;
  const g = room.game;
  if (!g.handOver || g.matchOver || g.over) return;
  if (g.matchIndex >= g.matchGames) return;

  const roomId = room.id;
  if (_ddzNextHandTimers.has(roomId)) return;
  const timer = setTimeout(() => {
    _ddzNextHandTimers.delete(roomId);
    const cur = rooms.getRoom(roomId);
    if (!cur || cur.status !== 'playing' || !cur.game) return;
    if (cur.gameType !== 'doudizhu') return;
    const mod = getGame('doudizhu');
    if (!mod || typeof mod.startNextHand !== 'function') return;
    if (!cur.game.handOver || cur.game.matchOver || cur.game.over) return;
    const result = mod.startNextHand(cur.game);
    if (!result || !result.ok) return;
    emitGameState(cur);
    emitRoomUpdate(cur);
    syncTurnTimer(cur, { onTimeout: handleTurnTimeout });
    scheduleBotTick(cur);
  }, 3200);
  _ddzNextHandTimers.set(roomId, timer);
}

/** 房间主动解散时立刻清掉 MQTT retained，不等心跳超时 */
function mqttClearRoomOnDissolve() {
  if (mqttBulletin && mqttBulletin.enabled) {
    mqttBulletin.clearRoomBeacon();
    mqttBulletin.pulseRoom();
  }
}

function sanitizeChatText(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function buildChatMessage(player, channel, text) {
  return {
    app: 'lianji',
    kind: 'chat',
    channel: channel === 'room' ? 'room' : 'all',
    roomId: channel === 'room' ? player.roomId || null : null,
    name: player.name || '玩家',
    tag: player.tag || null,
    sessionId: player.sessionId || null,
    instanceId: INSTANCE_ID,
    text,
    at: Date.now(),
  };
}

function originHost(url) {
  try {
    return new URL(String(url)).origin;
  } catch (_) {
    return String(url || '').replace(/\/$/, '');
  }
}

const tunnelReloadWatch = {
  oldHost: '',
  newHost: '',
  timer: null,
  lastSent: new Map(),
  until: 0,
};

function sameLobbyPerson(person, seat) {
  if (!person || !seat) return false;
  const sid = person.sessionId ? String(person.sessionId).slice(0, 64) : '';
  const seatSid = seat.sessionId ? String(seat.sessionId).slice(0, 64) : '';
  if (sid && seatSid && sid === seatSid) return true;
  const name = String(person.name || '').trim();
  const seatName = String(seat.name || '').trim();
  if (!name || name !== seatName) return false;
  const tag = String(person.tag || '').replace(/\D/g, '').slice(-5);
  const seatTag = String(seat.tag || '').replace(/\D/g, '').slice(-5);
  if (tag && seatTag) return tag === seatTag;
  return !tag && !seatTag;
}

function isSeatOnThisHost(seat) {
  if (!seat || seat.left || seat.offline) return false;
  return Boolean(rooms.getPlayer(seat.id));
}

function startTunnelReloadWatch(newUrl, oldUrl) {
  const neu = originHost(newUrl);
  const old = originHost(oldUrl);
  if (!neu || !old || neu === old) return;
  tunnelReloadWatch.oldHost = old;
  tunnelReloadWatch.newHost = neu;
  tunnelReloadWatch.until = Date.now() + 120000;
  nudgeStaleTunnelPlayers();
  if (tunnelReloadWatch.timer) clearInterval(tunnelReloadWatch.timer);
  tunnelReloadWatch.timer = setInterval(() => {
    if (Date.now() > tunnelReloadWatch.until) {
      clearInterval(tunnelReloadWatch.timer);
      tunnelReloadWatch.timer = null;
      return;
    }
    nudgeStaleTunnelPlayers();
  }, 3000);
  if (typeof tunnelReloadWatch.timer.unref === 'function') {
    tunnelReloadWatch.timer.unref();
  }
}

function nudgeStaleTunnelPlayers() {
  if (!mqttBulletin || !mqttBulletin.enabled) return;
  const newHost =
    tunnelReloadWatch.newHost || originHost(tunnel && tunnel.getPublicUrl());
  const oldHost = tunnelReloadWatch.oldHost;
  if (!newHost) return;
  const listed = hostedBeaconRooms();
  if (!listed.length) return;
  const remote = mqttBulletin.getRemotePeople() || [];
  for (const brief of listed) {
    const full = rooms.getRoom(brief.id);
    if (!full) continue;
    const members = [
      ...(full.players || []),
      ...(full.observers || []),
    ].filter((p) => p && !p.left);
    const targets = [];
    for (const seat of members) {
      if (isSeatOnThisHost(seat)) continue;
      const hit = remote.find((person) => sameLobbyPerson(person, seat));
      if (!hit) continue;
      const theirHost = originHost(hit.host);
      const theirRoom = String(hit.roomId || '').toUpperCase();
      const stillInOldRoom =
        theirRoom === String(full.id).toUpperCase() &&
        theirHost &&
        theirHost !== newHost;
      const stillOnOldHost = Boolean(oldHost && theirHost && theirHost === oldHost);
      if (!stillInOldRoom && !stillOnOldHost) continue;
      targets.push({
        name: seat.name,
        tag: seat.tag || null,
        sessionId: seat.sessionId || hit.sessionId || null,
      });
    }
    if (!targets.length) continue;
    const now = Date.now();
    const fresh = targets.filter((t) => {
      const key = t.sessionId || `${t.name}#${t.tag || ''}`;
      const last = tunnelReloadWatch.lastSent.get(key) || 0;
      if (now - last < 8000) return false;
      tunnelReloadWatch.lastSent.set(key, now);
      return true;
    });
    if (!fresh.length) continue;
    const ok = mqttBulletin.publishReload({
      roomId: full.id,
      host: newHost,
      name: full.name,
      gameType: full.gameType,
      gameLabel: full.gameLabel,
      gameMode: full.gameMode,
      gameModeLabel: full.gameModeLabel,
      status: full.status || 'playing',
      targets: fresh,
    });
    if (ok) {
      console.log(
        `[mqtt] 已通知 ${fresh.length} 名仍停在旧隧道的玩家 reload → ${newHost}`
      );
    }
  }
}

/** 本机仍有未挂起房间时，禁止因公网探活误杀隧道（含结算中；仅探活失败才换址） */
function hasActiveHostedRoom() {
  try {
    for (const room of rooms.rooms.values()) {
      if (!room || room.pendingLobby) continue;
      return true;
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

/**
 * 退出房间 / 结束对局不再重启或预热换址；隧道一直维持，仅探活失败会换新。
 * 保留函数名以免改散各处调用点。
 */
function prepareTunnelIfIdle() {
  /* no-op */
}

/** @deprecated 兼容旧名：现为 no-op（不再因空闲停隧道/换址） */
function stopTunnelIfIdle() {
  prepareTunnelIfIdle();
}

function getRoomPublicUrl() {
  return (tunnel && tunnel.getPublicUrl()) || '';
}

function getControlPublicUrl() {
  return (controlTunnel && controlTunnel.getPublicUrl()) || '';
}

/** 被动分享 / 远程操控入口（优先控制隧道） */
function getPassiveShareUrl() {
  return getControlPublicUrl() || getRoomPublicUrl() || '';
}

function tunnelIsProtected() {
  return hasActiveHostedRoom();
}

function attachTunnelHooks(t) {
  if (!t) return t;
  t.shouldProtect = tunnelIsProtected;
  let tunnelHadLost = false;
  t.onUrl = (url) => {
    const oldHost =
      (mqttBulletin &&
        mqttBulletin.getLastKnownHost &&
        mqttBulletin.getLastKnownHost()) ||
      '';
    if (mqttBulletin && mqttBulletin.enabled) {
      // 新房间隧道到手：立刻把本机对局挂到新地址并重发心跳
      mqttBulletin.flushIfReady(url, { skipWarmup: true });
    }
    const wasLost = tunnelHadLost;
    tunnelHadLost = false;
    io.emit('tunnel:status', { recovering: false, url: url || '', wasLost });
    startTunnelReloadWatch(url, oldHost);
  };
  t.onLost = () => {
    if (mqttBulletin && mqttBulletin.enabled) {
      // 不要清房间心跳：对局仍在本机，续播旧址并后台拉起新隧道
      mqttBulletin.markTunnelLost();
    }
    tunnelHadLost = true;
    io.emit('tunnel:status', {
      recovering: true,
      wasLost: true,
      needsReopen: hasActiveHostedRoom(),
    });
  };
  t.onDegraded = () => {
    if (!hasActiveHostedRoom()) return;
    io.emit('tunnel:status', {
      recovering: true,
      needsReopen: true,
      reason: 'degraded',
    });
  };
  return t;
}

function attachControlTunnelHooks(t) {
  if (!t) return t;
  // 控制隧道与房间隧道一样：僵死则换新随机地址
  t.shouldProtect = () => false;
  t.onUrl = (url) => {
    console.log('[tunnel:control] 控制入口就绪:', url || '');
    emitPassiveControlUpdate();
    if (mqttBulletin && mqttBulletin.enabled) {
      mqttBulletin.touchLogin().catch(() => {});
    }
    emitLobbyUpdate();
  };
  t.onLost = () => {
    // 不影响房间隧道；换址前短暂不可达
    console.warn('[tunnel:control] 控制隧道中断，正在重连…');
    emitPassiveControlUpdate();
  };
  return t;
}

async function ensurePublicTunnelUrl() {
  if (!tunnel) tunnel = attachTunnelHooks(new QuickTunnel({ label: 'room' }));
  await tunnel.ensure(PORT);
  return tunnel.getPublicUrl() || '';
}

async function ensureControlTunnelUrl() {
  if (!controlTunnel) {
    controlTunnel = attachControlTunnelHooks(createControlTunnel());
  } else if (controlTunnel._stopped) {
    controlTunnel._stopped = false;
  }
  await controlTunnel.ensure(PORT);
  return controlTunnel.getPublicUrl() || '';
}

function stopControlTunnel() {
  if (!controlTunnel) return;
  try {
    controlTunnel.stop();
  } catch (_) {
    /* ignore */
  }
  controlTunnel = null;
}

/** 服务启动后在后台预热房间隧道，不阻塞 HTTP/MQTT 监听 */
function warmupTunnelInBackground() {
  if (!mqttBulletin || !mqttBulletin.enabled) return;
  setImmediate(() => {
    console.log('[tunnel:room] 后台预热中…');
    ensurePublicTunnelUrl()
      .then((url) => {
        if (url) console.log('[tunnel:room] 后台预热完成');
      })
      .catch((err) => {
        console.warn(
          '[tunnel:room] 后台预热失败:',
          err && err.message ? err.message : err
        );
      });
  });
}

function emitLobbyUpdate() {
  io.emit('lobby:update', buildLobbyPayload());
}

/** 进入大厅后统一加入 hall，用于「所有人」频道广播 */
function joinHallChat(socket) {
  if (socket) socket.join(HALL_CHAT_ROOM);
}

function broadcastChatAllLocal(msg) {
  io.to(HALL_CHAT_ROOM).emit('chat:message', msg);
}

/** 向本实例中处于大厅（未进房）的玩家广播邀请 */
function broadcastInviteLocal(msg, excludeSocketId = null) {
  const people = rooms.listLobbyPeople();
  for (const person of people) {
    if (excludeSocketId && person.id === excludeSocketId) continue;
    if (person.status !== 'idle') continue;
    if (msg.roomId && person.roomId && person.roomId === msg.roomId) continue;
    io.to(person.id).emit('lobby:invite', msg);
  }
}

function emitChatAll(msg) {
  broadcastChatAllLocal(msg);
  if (mqttBulletin && mqttBulletin.enabled) mqttBulletin.publishChat(msg);
}

function emitPlayerMe(socket, player, fallbackName) {
  const access = socket.data.access || socketAccess(socket);
  const name = (player && player.name) || fallbackName || '玩家';
  if (access === 'tunnel') {
    try {
      tunnelNickMemory.remember(socket, name);
    } catch (_) {}
  }
  const controllingPassive = Boolean(
    socket.data.controllingPassive ||
      isPassiveController(socket, player && player.sessionId)
  );
  socket.emit('player:me', {
    id: socket.id,
    name,
    tag: (player && player.tag) || null,
    localHost: localBaseUrl(),
    access,
    tunnelGuest: access === 'tunnel',
    occupancyOwner: hostOccupancy.isOwner(
      player && player.sessionId,
      socket.id
    ),
    passiveMode: hasPassiveHost(),
    canControlPassive: controllingPassive,
    controllingPassive,
    passiveController: getPassiveControllerPayload(),
    publicUrl: getPassiveShareUrl() || null,
  });
}

/**
 * 从 socket 载荷里取出昵称（兼容 playerName / name / nick）。
 */
function pickPayloadPlayerName(data = {}) {
  const raw =
    (data && (data.playerName || data.name || data.nick)) || '';
  return (
    String(raw)
      .trim()
      .replace(/#\d{1,8}\s*$/, '')
      .trim()
      .slice(0, 16) || ''
  );
}

/**
 * 注册/刷新玩家：payload 缺昵称时保留已有名字，避免进房被盖成「玩家」。
 */
function ensureSocketPlayer(socket, data = {}) {
  const incoming = pickPayloadPlayerName(data);
  const existing = rooms.getPlayer(socket.id);
  const name =
    incoming ||
    (existing && existing.name) ||
    String(socket.data.playerName || '').trim() ||
    '玩家';
  const player = rooms.registerPlayer(socket.id, name, playerRegisterOpts(data));
  socket.data.playerName = player.name;
  return player;
}

/** 进房后再次钉死昵称到玩家表与座位，防止中途被默认名覆盖 */
function forceSocketPlayerName(socket, data = {}) {
  const want = pickPayloadPlayerName(data);
  if (!want) return rooms.getPlayer(socket.id);
  const player = rooms.setPlayerName(
    socket.id,
    want,
    playerRegisterOpts(data)
  ).player;
  socket.data.playerName = player.name;
  return player;
}

function emitSpectatorLeft(room, observer) {
  if (!room || !observer || !observer.id) return;
  io.to(room.id).emit('room:spectatorLeft', {
    id: observer.id,
    name: observer.name || '玩家',
    tag: observer.tag || null,
  });
}

function emitRoomUpdate(room, joinSocket = null) {
  if (!room) return;
  const payload = { room: fullRoomView(room) };
  if (joinSocket) {
    joinSocket.emit('room:update', payload);
    joinSocket.to(room.id).emit('room:update', payload);
    return;
  }
  io.to(room.id).emit('room:update', payload);
}

function publicStateForRoom(room, viewerId) {
  const mod = getGame(room.gameType);
  if (!mod || !room.game) return null;
  const state = mod.publicGameState(room.game, viewerId);
  if (!state) return null;
  const leftIds = (room.players || [])
    .filter((p) => p.left)
    .map((p) => p.id);
  const hostedIds = new Set(
    (room.players || []).filter((p) => p && p.isHosted).map((p) => p.id)
  );
  state.leftPlayerIds = leftIds;
  if (Array.isArray(state.players)) {
    for (const p of state.players) {
      p.left = Boolean(p.left) || leftIds.includes(p.id);
      p.isHosted = Boolean(p.isHosted) || hostedIds.has(p.id);
    }
  }
  if (state.me && leftIds.includes(state.me.id)) state.me.left = true;
  if (state.me) {
    state.me.isHosted = Boolean(state.me.isHosted) || hostedIds.has(state.me.id);
    if (state.me.isHosted) state.me.canAct = false;
  }
  if (state && room.turnTimer) {
    state.turnTimer = {
      actorIds: room.turnTimer.actorIds.slice(),
      deadline: room.turnTimer.deadline,
      limitSec: room.turnTimer.limitSec,
    };
  }
  if (room.playingStartedAt) {
    state.playingStartedAt = room.playingStartedAt;
  }
  return state;
}

function emitGameState(room) {
  if (!room) return;
  for (const p of room.players) {
    if (p.offline || p.left) continue;
    io.to(p.id).emit('game:state', {
      state: publicStateForRoom(room, p.id),
    });
  }
  // 观战：中立视角（无个人手牌）
  for (const o of room.observers || []) {
    if (o.offline) continue;
    io.to(o.id).emit('game:state', {
      state: publicStateForRoom(room, null),
      spectator: true,
    });
  }
  scheduleLasidaoSettleAnim(room);
}

function emitGameLoading(room) {
  if (!room) return;
  const progress = room._loadingProgress || {};
  const ready = room._loadingReady || new Set();
  for (const p of room.players) {
    if (p.offline || p.left) continue;
    io.to(p.id).emit('game:loading', {
      state: publicStateForRoom(room, p.id),
      progress,
      readyCount: ready.size,
      totalCount: (room.players || []).filter((x) => x && !x.left && !x.offline).length,
    });
  }
  for (const o of room.observers || []) {
    if (o.offline) continue;
    io.to(o.id).emit('game:loading', {
      state: publicStateForRoom(room, null),
      spectator: true,
      progress,
      readyCount: ready.size,
      totalCount: (room.players || []).filter((x) => x && !x.left && !x.offline).length,
    });
  }
}

function emitGameStarted(room) {
  if (!room) return;
  for (const p of room.players) {
    if (p.offline || p.left) continue;
    io.to(p.id).emit('game:started', {
      state: publicStateForRoom(room, p.id),
    });
  }
  for (const o of room.observers || []) {
    if (o.offline) continue;
    io.to(o.id).emit('game:started', {
      state: publicStateForRoom(room, null),
      spectator: true,
    });
  }
}

function broadcastLoadingProgress(room) {
  if (!room) return;
  const progress = room._loadingProgress || {};
  const ready = room._loadingReady || new Set();
  const totalCount = (room.players || []).filter((x) => x && !x.left && !x.offline).length;
  const payload = {
    progress,
    readyCount: ready.size,
    totalCount,
  };
  for (const p of room.players) {
    if (p.offline || p.left) continue;
    io.to(p.id).emit('game:loadingProgress', payload);
  }
  for (const o of room.observers || []) {
    if (o.offline) continue;
    io.to(o.id).emit('game:loadingProgress', payload);
  }
}

/** 卡拉斯坦：先手宣布结束后再发牌进入生产 */
function scheduleLasidaoInitAnnounce(room) {
  if (!room || room.gameType !== 'lasidao' || !room.game) return;
  if (room.game.phase !== 'init_announce') return;
  const mod = getGame('lasidao');
  if (!mod || typeof mod.finishInitAnnounce !== 'function') return;
  if (room._lasInitTimer) {
    clearTimeout(room._lasInitTimer);
    room._lasInitTimer = null;
  }
  const until = Number(room.game.initAnnounceUntil) || 0;
  const delay = Math.max(0, until - Date.now());
  room._lasInitTimer = setTimeout(() => {
    room._lasInitTimer = null;
    if (!room.game || room.game.phase !== 'init_announce') return;
    mod.finishInitAnnounce(room.game);
    syncTurnTimer(room, { onTimeout: handleTurnTimeout });
    emitGameState(room);
    scheduleBotTick(room);
  }, delay);
}

/** 卡拉斯坦：结算动画超时后强制进入下一阶段 */
function scheduleLasidaoSettleAnim(room) {
  if (!room || room.gameType !== 'lasidao' || !room.game) return;
  if (room.game.phase !== 'settle') {
    if (room._lasSettleTimer) {
      clearTimeout(room._lasSettleTimer);
      room._lasSettleTimer = null;
    }
    return;
  }
  const mod = getGame('lasidao');
  if (!mod || typeof mod.finishSettleAnimForce !== 'function') return;
  if (room._lasSettleTimer) return;
  const until = Number(room.game.settleAnimUntil) || 0;
  const delay = Math.max(0, until - Date.now());
  room._lasSettleTimer = setTimeout(() => {
    room._lasSettleTimer = null;
    if (!room.game || room.game.phase !== 'settle') return;
    const wasOver = Boolean(room.game.over);
    const wasStatus = room.status;
    mod.finishSettleAnimForce(room.game);
    syncTurnTimer(room, { onTimeout: handleTurnTimeout });
    emitGameState(room);
    afterPlayingMutation(room, { wasOver, wasStatus });
    scheduleBotTick(room);
  }, delay);
}

function abandonedSig(room, mod, leftIds) {
  const game = room.game;
  if (!game) return '';
  const actors = (mod.getActingPlayerIds(game) || []).filter((id) =>
    leftIds.has(id)
  );
  const pend = game.pending;
  return [
    actors.slice().sort().join(','),
    game.phase || '',
    game.turnPhase || '',
    game.turnSeat != null ? game.turnSeat : '',
    game.currentPlayerId || '',
    pend && pend.type,
    pend && (pend.askId || pend.playerId),
    game.over ? 1 : 0,
  ].join('|');
}

function handleAbandonedPlayers(room) {
  const mod = getGame(room.gameType);
  if (!mod || !room.game) return;
  const leftIds = (room.players || []).filter((p) => p.left).map((p) => p.id);
  if (!leftIds.length) return;

  if (typeof mod.onPlayerQuit === 'function') {
    for (const id of leftIds) {
      mod.onPlayerQuit(room.game, id);
      if (!room.game || room.game.over) break;
    }
    return;
  }

  if (typeof mod.skipAbandoned === 'function') {
    try {
      mod.skipAbandoned(room.game, leftIds);
    } catch (_) {
      /* ignore */
    }
  }
  if (!room.game || room.game.over || typeof mod.forceTimeout !== 'function') {
    return;
  }
  const leftSet = new Set(leftIds);
  let guard = 0;
  while (room.game && !room.game.over && guard++ < 48) {
    const before = abandonedSig(room, mod, leftSet);
    const actors = (mod.getActingPlayerIds(room.game) || []).filter((id) =>
      leftSet.has(id)
    );
    if (!actors.length) break;
    for (const id of actors) {
      try {
        mod.forceTimeout(room.game, id);
      } catch (_) {
        /* ignore */
      }
      if (!room.game || room.game.over) break;
    }
    const after = abandonedSig(room, mod, leftSet);
    if (after === before) break;
  }
}

/**
 * 座位是否由电脑代操作（真实 bot 或玩家托管）
 */
function seatAutoPlays(seat) {
  return Boolean(seat && (seat.isBot || seat.isHosted));
}

/**
 * 自动操作难度：托管固定困难，bot 用其设定难度
 */
function seatAutoDifficulty(seat) {
  if (seat && seat.isHosted) return 'hard';
  return (seat && seat.botDifficulty) || 'normal';
}

/** 人机行动指纹：用于检测「决策/超时后状态未变」的卡死。
 * 建造/生产可以连续行动且不换人，必须把资源、繁殖、日志也算进去，
 * 否则一次成功的繁殖会被当成卡死并强制跳过。
 */
function botActingFingerprint(game, playerId) {
  if (!game || !playerId) return '';
  const ev = game.pendingEventChoice;
  const p = Array.isArray(game.players)
    ? game.players.find((x) => x && x.id === playerId)
    : null;
  const res = (p && p.resources) || {};
  const log = game.log;
  const lastLog =
    log && log.length
      ? String(
          (log[log.length - 1] && (log[log.length - 1].text || log[log.length - 1])) ||
            ''
        )
      : '';
  const dice = (game.dice && game.dice[playerId]) || [];
  const parts = [
    game.phase || '',
    game.currentPlayerId || '',
    game.awaitingProduceRoll ? '1' : '0',
    ev && ev.playerId === playerId
      ? `ev:${ev.needChoice || ''}:${ev.teleportStep || ''}:${ev.fromNumber || ''}`
      : '',
    game.pendingRedrawChoice && game.pendingRedrawChoice.playerId === playerId
      ? 'redraw'
      : '',
    game.pendingRobberyPick && game.pendingRobberyPick.targetId === playerId
      ? 'robbery'
      : '',
    game.pendingIllegalBuild && game.pendingIllegalBuild.targetId === playerId
      ? 'illegal'
      : '',
    game.pendingTrade && game.pendingTrade.toId === playerId ? 'trade' : '',
    game.pendingWelfareMinimumChoices &&
    game.pendingWelfareMinimumChoices[playerId]
      ? 'welfare'
      : '',
    p
      ? [
          p.villagers,
          p.houses,
          p.roundBred ? 1 : 0,
          p.roundBuiltHouse ? 1 : 0,
          p.expandResSlots,
          p.expandSlots,
          p.dispatched,
          p.voided,
          res.wood,
          res.stone,
          res.food,
          res.iron,
          (p.funcCards || []).length,
          (p.buildings || []).length,
          p.buildTurnBuyFuncCount,
          game.buildPassed && game.buildPassed[playerId] ? 1 : 0,
          dice.length,
        ].join(',')
      : '',
    lastLog,
  ];
  return parts.join('|');
}

/**
 * 当游戏状态变化后，安排 bot / 托管 自动行动（不限时模式下也适用）。
 */
function scheduleBotTick(room) {
  if (!room || room.status !== 'playing' || !room.game || room.game.over) return;
  const mod = getGame(room.gameType);
  if (!mod || typeof mod.decideBotAction !== 'function') return;

  const actors = (mod.getActingPlayerIds(room.game) || []).filter((id) => {
    const seat = (room.players || []).find((p) => p.id === id);
    return seatAutoPlays(seat);
  });
  if (!actors.length) return;

  // 判断 bot 是否刚摇完骰子准备派遣，是则停留更久让玩家看清骰子
  let delay = 1200 + Math.floor(Math.random() * 300); // 1200-1500ms
    for (const id of actors) {
    if (
      room.game.phase === 'produce' &&
      room.game.currentPlayerId === id &&
      !room.game.awaitingProduceRoll
    ) {
      delay = 4000 + Math.floor(Math.random() * 300); // 4000-4300ms
      break;
    }
  }
  if (room._botTickHandle) clearTimeout(room._botTickHandle);
  room._botTickHandle = setTimeout(() => {
    room._botTickHandle = null;
    if (!room.game || room.game.over) return;
    const freshActors = (mod.getActingPlayerIds(room.game) || []).filter((id) => {
      const seat = (room.players || []).find((p) => p.id === id);
      return seatAutoPlays(seat);
    });
    if (!freshActors.length) return;

    const wasOver = Boolean(room.game.over);
    const wasStatus = room.status;

    for (const id of freshActors) {
      const seat = (room.players || []).find((p) => p.id === id);
      if (!seatAutoPlays(seat)) continue;
      const beforeKey = botActingFingerprint(room.game, id);
      try {
        let botAction = mod.decideBotAction(
          room.game,
          id,
          seatAutoDifficulty(seat)
        );
        // 兑换连打熔断：同玩家连续兑换过多 → 强制 pass，避免 1:1 集市卡死整桌
        if (botAction && botAction.type === 'exchange') {
          if (!room._botExchangeStreak) room._botExchangeStreak = {};
          room._botExchangeStreak[id] = (room._botExchangeStreak[id] || 0) + 1;
          if (room._botExchangeStreak[id] >= 4) {
            botAction = { type: 'pass' };
            room._botExchangeStreak[id] = 0;
          }
        } else if (room._botExchangeStreak) {
          room._botExchangeStreak[id] = 0;
        }
        if (botAction) {
          const result = mod.applyAction(room.game, id, botAction);
          if (!result || !result.ok) {
            // AI 决策不合法时回退到 forceTimeout
            if (typeof mod.forceTimeout === 'function') {
              mod.forceTimeout(room.game, id);
            }
          }
        } else if (typeof mod.forceTimeout === 'function') {
          mod.forceTimeout(room.game, id);
        }
      } catch (_) {
        try {
          if (typeof mod.forceTimeout === 'function') {
            mod.forceTimeout(room.game, id);
          }
        } catch (__) {}
      }
      // 仍卡在同一待处理状态：再强制超时一次（forceTimeout 内有事件跳过托底）
      if (
        typeof mod.forceTimeout === 'function' &&
        beforeKey &&
        beforeKey === botActingFingerprint(room.game, id)
      ) {
        try {
          mod.forceTimeout(room.game, id);
        } catch (__) {}
      }
      if (room.game.over) break;
    }

    handleAbandonedPlayers(room);
    syncTurnTimer(room, { onTimeout: handleTurnTimeout });
    emitGameState(room);
    afterPlayingMutation(room, { wasOver, wasStatus });

    // 递归：如果 bot 行动后又轮到另一个 bot
    scheduleBotTick(room);
  }, delay);
}

function handleTurnTimeout(room) {
  if (!room || room.status !== 'playing' || !room.game) {
    clearTurnTimer(room);
    return;
  }

  const wasOver = Boolean(room.game.over);
  const wasStatus = room.status;
  const mod = getGame(room.gameType);
  if (!mod || typeof mod.forceTimeout !== 'function') {
    clearTurnTimer(room);
    emitGameState(room);
    afterPlayingMutation(room, { wasOver, wasStatus });
    return;
  }

  const snapshot = (
    (room.turnTimer && room.turnTimer.actorIds) ||
    mod.getActingPlayerIds(room.game) ||
    []
  ).slice();

  for (const id of snapshot) {
    if (!room.game || room.game.over) break;
    const still = (mod.getActingPlayerIds(room.game) || []).includes(id);
    if (!still) continue;

    // Bot / 托管 优先走 AI 决策，失败再兜底 forceTimeout
    const seat = (room.players || []).find((p) => p.id === id);
    if (seatAutoPlays(seat) && typeof mod.decideBotAction === 'function') {
      try {
        const botAction = mod.decideBotAction(
          room.game,
          id,
          seatAutoDifficulty(seat)
        );
        if (botAction) {
          const result = mod.applyAction(room.game, id, botAction);
          if (result && result.ok) continue;
        }
      } catch (_) {}
    }

    try {
      mod.forceTimeout(room.game, id);
    } catch (_) {
      /* ignore per-player timeout failures */
    }
  }

  handleAbandonedPlayers(room);
  syncTurnTimer(room, { onTimeout: handleTurnTimeout });
  emitGameState(room);
  afterPlayingMutation(room, { wasOver, wasStatus });

  // 超时后也可能轮到 bot，继续排程
  scheduleBotTick(room);
}

io.on('connection', (socket) => {
  socket.data.access = socketAccess(socket);

  // 隧道连接后立刻推送曾用昵称，免去客户端再发 nick:recall 等一轮
  if (socket.data.access === 'tunnel') {
    try {
      const suggested = tunnelNickMemory.recall(socket) || '';
      if (suggested) {
        socket.emit('nick:suggest', { ok: true, name: suggested });
      }
    } catch (_) {}
  }

  socket.on('nick:recall', (ack) => {
    const access = socket.data.access || socketAccess(socket);
    const name =
      access === 'tunnel' ? tunnelNickMemory.recall(socket) : '';
    const payload = { ok: true, name: name || '' };
    if (typeof ack === 'function') ack(payload);
    else socket.emit('nick:recall:result', payload);
  });

  socket.on('nick:remember', (data = {}, ack) => {
    const access = socket.data.access || socketAccess(socket);
    let name = '';
    if (access === 'tunnel') {
      name = tunnelNickMemory.remember(
        socket,
        (data && data.playerName) || data.name || ''
      );
    }
    const payload = { ok: true, name: name || '' };
    if (typeof ack === 'function') ack(payload);
  });

  socket.on('lobby:join', (data = {}) => {
    const sessionId = data.sessionId || null;
    const roomIdHint = data.roomId || null;
    const oldPlayerId = data.oldPlayerId || null;
    const playerTag = data.playerTag || null;
    const joinName = pickPayloadPlayerName(data) || data.playerName;
    // 仅在明确「重新加入」时认领座位；普通进大厅不自动回桌
    const wantRejoin = Boolean(data.rejoin);
    const access = socket.data.access || socketAccess(socket);
    socket.data.access = access;
    // 进房通行：带有效本机 roomId 且非「重连认领」路径（joinRoomOnHost 先 lobby 再 room）
    const joinTransit =
      !wantRejoin && hostOccupancy.isJoinTransit(roomIdHint, rooms);

    const reclaimed = wantRejoin
      ? rooms.tryReclaimSeat(
          socket.id,
          joinName,
          sessionId,
          roomIdHint,
          oldPlayerId,
          playerTag
        )
      : null;
    if (reclaimed && reclaimed.room) {
      if (reclaimed.oldId && reclaimed.oldId !== socket.id) {
        const stale = io.sockets.sockets.get(reclaimed.oldId);
        if (stale) stale.disconnect(true);
      }
      // 认领后再写一次 tag，保证尾缀固定同步到座位
      const player = rooms.registerPlayer(socket.id, joinName, {
        sessionId,
        playerTag,
        client: data.client,
        role: data.role,
      });
      player.lastHost = null;
      player.lastRoomId = null;
      player.lastRoomName = null;
      player.lastStatus = null;
      socket.join(reclaimed.room.id);
      joinHallChat(socket);
      socket.data.playerName = player.name;
      // 座位重连：不抢占主机占用权；若本就是占用者则续占
      if (hostOccupancy.isOwner(sessionId, socket.id)) {
        hostOccupancy.claim(sessionId, socket.id, {
          name: player.name,
          tag: player.tag,
        });
      }
      mqttOnLogin();
      emitLobbyUpdate();
      if (access === 'tunnel' && hasPassiveHost()) {
        claimPassiveController(socket, player);
      }
      emitPlayerMe(socket, player, joinName);
      socket.emit('session:reclaimed', {
        roomId: reclaimed.room.id,
        status: reclaimed.room.status,
        playing: Boolean(
          reclaimed.room.status === 'playing' && reclaimed.room.game
        ),
      });
      emitRoomUpdate(reclaimed.room, socket);
      if (reclaimed.room.status === 'playing' && reclaimed.room.game) {
        emitGameState(reclaimed.room);
        scheduleLasidaoInitAnnounce(reclaimed.room);
      }
      return;
    }

    // 占用锁：本机控制台 + 局域网互斥认领；隧道访客仅进房，不抢占
    if (!joinTransit) {
      if (canClaimOccupancy(access)) {
        if (hostOccupancy.isBlockedFor(sessionId, socket.id)) {
          emitHostOccupied(socket);
          return;
        }
        hostOccupancy.claim(sessionId, socket.id, {
          name: joinName,
          tag: playerTag,
        });
      }
    }

    if (wantRejoin) {
      // 明确重连但认领失败：仍进大厅，并告知客户端
      const player = rooms.registerPlayer(socket.id, joinName, {
        sessionId,
        playerTag,
        client: data.client,
        role: data.role,
        lastHost: data.lastHost || null,
        lastRoomId: data.lastRoomId || roomIdHint,
        lastRoomName: data.lastRoomName || null,
        lastStatus: data.lastStatus || null,
      });
      socket.data.playerName = player.name;
      joinHallChat(socket);
      if (joinName) mqttOnLogin();
      emitLobbyUpdate();
      emitPlayerMe(socket, player, joinName);
      socket.emit('session:reclaim-failed', {
        roomId: roomIdHint,
        message: '未能认领原座位，房间可能已解散或座位已被占用',
      });
      return;
    }

    // 清掉同 session 仍停在大厅的旧连接（localhost 双连）
    const dropped = rooms.evictIdleSessionDuplicates(sessionId, socket.id);
    for (const id of dropped) {
      const stale = io.sockets.sockets.get(id);
      if (stale) stale.disconnect(true);
    }

    const player = rooms.registerPlayer(socket.id, joinName, {
      sessionId,
      playerTag,
      client: data.client,
      role: data.role,
    });
    socket.data.playerName = player.name;
    if (!joinTransit && hostOccupancy.isOwner(sessionId, socket.id)) {
      hostOccupancy.claim(sessionId, socket.id, {
        name: player.name,
        tag: player.tag,
      });
    }
    // 隧道访客 + 被动主机：认领远程操控权（开房/观战/聊天）
    if (access === 'tunnel' && hasPassiveHost()) {
      claimPassiveController(socket, player);
    }
    joinHallChat(socket);
    if (joinName) mqttOnLogin();
    emitLobbyUpdate();
    emitPlayerMe(socket, player, joinName);
    const room = rooms.getRoom(player.roomId);
    if (room) {
      socket.join(room.id);
      emitRoomUpdate(room);
      if (room.status === 'playing' && room.game) emitGameState(room);
    }
  });

  /** 查询房间是否仍活跃（用于刷新后提示重连，不自动进房） */
  socket.on('room:probe', (data = {}) => {
    const roomId = String(data.roomId || '').toUpperCase();
    if (!roomId) {
      socket.emit('room:probe-result', { ok: false, message: '缺少房间码' });
      return;
    }
    const local = rooms.getRoom(roomId);
    if (local) {
      const active =
        local.status === 'waiting' ||
        (local.status === 'playing' && Boolean(local.game));
      socket.emit('room:probe-result', {
        ok: active,
        roomId: local.id,
        name: local.name,
        status: local.status,
        host: localBaseUrl(),
        local: true,
        message: active ? null : '房间已不存在或对局已结束',
      });
      return;
    }
    const found = resolveRoomRemote(roomId);
    if (!found || !found.room) {
      socket.emit('room:probe-result', {
        ok: false,
        roomId,
        message: '未找到该房间（可能已解散）',
      });
      return;
    }
    const status = found.room.status || 'waiting';
    const active =
      status === 'waiting' || status === 'playing';
    socket.emit('room:probe-result', {
      ok: active,
      roomId: found.room.id,
      name: found.room.name,
      status,
      host: found.host,
      local: false,
      via: found.via || null,
      tunnelRecovering: Boolean(found.room.tunnelRecovering),
      message: active
        ? found.room.tunnelRecovering
          ? '房主隧道恢复中'
          : null
        : '房间已不存在或对局已结束',
    });
  });

  socket.on('lobby:refresh', () => {
    socket.emit('lobby:update', buildLobbyPayload());
  });

  socket.on('lobby:mqtt-reconnect', () => {
    if (!mqttBulletin || !mqttBulletin.enabled) {
      socket.emit('lobby:mqtt-reconnect-result', {
        ok: false,
        message: 'MQTT 广播未启用',
      });
      return;
    }
    const result = mqttBulletin.reconnect();
    socket.emit('lobby:mqtt-reconnect-result', {
      ok: Boolean(result && result.ok),
      message: (result && result.message) || null,
      mqttConnected: mqttBulletin.isConnected(),
      broker: mqttBulletin.getBrokerInfo(),
    });
    emitLobbyUpdate();
  });

  socket.on('lobby:mqtt-switch', async (data = {}) => {
    if (!mqttBulletin || !mqttBulletin.enabled) {
      socket.emit('lobby:mqtt-switch-result', {
        ok: false,
        message: 'MQTT 广播未启用',
      });
      return;
    }
    try {
      const result =
        data && data.brokerId
          ? await mqttBulletin.switchBroker(String(data.brokerId))
          : await mqttBulletin.switchToNextBroker();
      socket.emit('lobby:mqtt-switch-result', {
        ok: Boolean(result && result.ok),
        message: (result && result.message) || null,
        restored: Boolean(result && result.restored),
        broker: (result && result.broker) || mqttBulletin.getBrokerInfo(),
        brokers: mqttBulletin.listBrokers(),
        mqttConnected: mqttBulletin.isConnected(),
      });
    } catch (err) {
      socket.emit('lobby:mqtt-switch-result', {
        ok: false,
        message: (err && err.message) || '切换服务器失败',
        broker: mqttBulletin.getBrokerInfo(),
        brokers: mqttBulletin.listBrokers(),
        mqttConnected: mqttBulletin.isConnected(),
      });
    }
    emitLobbyUpdate();
  });

  socket.on('lobby:announce-leave', (data = {}) => {
    const me = rooms.getPlayer(socket.id);
    const ident = {
      roomId: String(data.roomId || '').toUpperCase(),
      name: data.name || (me && me.name) || '',
      tag: data.tag || (me && me.tag) || null,
      sessionId: data.sessionId || (me && me.sessionId) || null,
    };
    if (!ident.roomId) return;
    const result = rooms.explicitLeaveByIdentity(ident);
    applyExplicitLeaveResult(result);
    if (mqttBulletin && mqttBulletin.enabled) mqttBulletin.publishLeave(ident);
  });

  socket.on('player:rename', (data = {}) => {
    const want = pickPayloadPlayerName(data);
    if (!want) {
      const me = rooms.getPlayer(socket.id);
      emitPlayerMe(socket, me, me && me.name);
      return;
    }
    if (!rooms.getPlayer(socket.id)) {
      ensureSocketPlayer(socket, { ...data, playerName: want });
    }
    const { player, room } = rooms.setPlayerName(
      socket.id,
      want,
      playerRegisterOpts(data)
    );
    socket.data.playerName = player.name;
    if (
      isPassiveController(socket, player.sessionId) ||
      socket.data.controllingPassive
    ) {
      claimPassiveController(socket, player);
    }
    mqttOnLogin();
    emitPlayerMe(socket, player, want);
    if (room) {
      emitRoomUpdate(room);
      if (room.status === 'playing' && room.game) emitGameState(room);
    }
    emitLobbyUpdate();
  });

  socket.on('room:resolve', (data = {}) => {
    const roomId = String(data.roomId || '').toUpperCase();
    const local = rooms.getRoom(roomId);
    if (local) {
      socket.emit('room:resolved', {
        ok: true,
        host: localBaseUrl(),
        roomId: local.id,
        local: true,
      });
      return;
    }

    const found = resolveRoomRemote(roomId);
    if (!found) {
      socket.emit('room:resolved', {
        ok: false,
        message:
          mqttBulletin && mqttBulletin.enabled
            ? '未找到该房间码（对方需在线并已连接 MQTT 广播）'
            : '未找到该房间码',
      });
      return;
    }

    socket.emit('room:resolved', {
      ok: true,
      host: found.host,
      roomId: found.room.id,
      local: false,
      via: found.via || 'mqtt',
    });
  });

  // 前端打开创建面板时就开始后台预热隧道，不必等到点击创建
  socket.on('room:warmupTunnel', () => {
    ensurePublicTunnelUrl().catch(() => {});
  });

  socket.on('room:create', async (data = {}) => {
    let wantPassive = Boolean(data.passiveHost);
    // 隧道远程操控被动主机：即使未显式带 passiveHost，也走代开
    if (
      !wantPassive &&
      (socket.data.controllingPassive ||
        isPassiveController(
          socket,
          data.sessionId || (rooms.getPlayer(socket.id) || {}).sessionId
        )) &&
      hasPassiveHost()
    ) {
      wantPassive = true;
    }
    // 被动代开：由空闲被动主机接待，不走大厅占用锁
    if (!wantPassive) {
      const gate = assertHostOccupant(socket, data.sessionId);
      if (!gate.ok) {
        socket.emit('room:error', { message: gate.error });
        return;
      }
    }

    if (!rooms.getPlayer(socket.id)) {
      ensureSocketPlayer(socket, data);
    } else if (data.sessionId || data.playerTag || data.client || data.playerName) {
      ensureSocketPlayer(socket, data);
    }

    let operatorId = null;
    if (wantPassive) {
      // 被动开房：找本机已开启被动模式、且空闲（未被占用）的主机
      const op = [...rooms.players.values()].find(
        (p) => p.passive && !p.roomId && p.id !== socket.id
      );
      if (!op) {
        const busy = [...rooms.players.values()].find(
          (p) => p.passive && p.roomId && p.id !== socket.id
        );
        const self = rooms.getPlayer(socket.id);
        if (busy) {
          socket.emit('room:error', {
            message: '该被动主机已被占用，请等待对方房间结束后再试',
          });
          return;
        }
        if (!(self && self.passive && !self.roomId)) {
          socket.emit('room:error', {
            message: '目标未处于被动模式，或已在房间中',
          });
          return;
        }
      } else {
        operatorId = op.id;
      }
    }

    const result = rooms.createRoom(socket.id, {
      name: data.name,
      hasPassword: data.hasPassword,
      password: data.password,
      maxPlayers: data.maxPlayers,
      gameType: data.gameType,
      gameMode: data.gameMode,
      turnTimeSec: data.turnTimeSec,
      allowTrade: data.allowTrade,
      peacefulDev: data.peacefulDev,
      easyStart: data.easyStart,
      matchGames: data.matchGames,
      passiveHost: wantPassive && Boolean(operatorId),
      operatorId,
    });

    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }

    const room = result.room;
    socket.join(room.id);
    joinHallChat(socket);
    const me = rooms.getPlayer(socket.id);
    dropIdleSessionGhosts(me && me.sessionId, socket.id);

    // 把被动操作者拉进房间频道
    if (operatorId) {
      const opSock = io.sockets.sockets.get(operatorId);
      if (opSock) {
        opSock.join(room.id);
        joinHallChat(opSock);
      }
    }

    // pendingLobby 期间仍按空闲发登录心跳，不广播房间
    mqttOnLogin();

    const progress = (message) =>
      socket.emit('room:creating', { message, roomId: room.id });
    progress('正在创建房间…');

    let onProgress = null;
    try {
      onProgress = (phase) => {
        if (phase === 'mqtt') progress('正在连接 MQTT…');
        else if (phase === 'tunnel') progress('正在准备公网隧道…');
        else if (phase === 'tunnel-warmup') progress('隧道就绪中，请稍候…');
      };

      if (mqttBulletin && mqttBulletin.enabled) {
        progress('正在准备公网隧道…');
        await ensurePublicTunnelUrl();

        // 先等隧道/MQTT 就绪，此时房间仍 pending，大厅不会出现、状态仍空闲
        const ready = await mqttBulletin.waitForInfrastructureReady({
          timeoutMs: 90000,
          onProgress,
        });
        if (!ready.ok) {
          throw new Error(ready.message || '房间广播失败');
        }
      } else {
        try {
          await ensurePublicTunnelUrl();
        } catch (_) {
          /* 无 MQTT 时隧道可选 */
        }
      }

      // 隧道就绪后：公开房间并先完成 MQTT 广播，再让房主进房（避免其他人看不见）
      const fresh = rooms.clearPendingLobby(room.id);
      if (!fresh) {
        socket.emit('room:error', { message: '房间创建失败' });
        return;
      }

      // 等待隧道期间可能短暂断线/换 id：绑到当前仍在线的同 session 连接
      const creatorSock =
        resolveLiveCreatorSocket(socket, data.sessionId) || socket;
      const bound = rooms.bindCreatorAsHost(creatorSock.id, fresh.id, {
        playerName: data.playerName,
        ...playerRegisterOpts(data),
      });
      if (!bound.ok) {
        creatorSock.emit('room:error', {
          message: bound.error || '房间创建失败',
        });
        return;
      }
      dropIdleSessionGhosts(bound.player.sessionId, creatorSock.id);
      creatorSock.join(bound.room.id);
      joinHallChat(creatorSock);
      emitPlayerMe(creatorSock, bound.player, data.playerName);

      mqttOnLogin();

      if (mqttBulletin && mqttBulletin.enabled) {
        progress('正在广播房间到大厅…');
        const beacon = await mqttBulletin.waitForRoomBeacon(
          bound.room.id,
          () => {
            const list = hostedBeaconRooms();
            return (
              list.find(
                (r) =>
                  String(r.id).toUpperCase() ===
                  String(bound.room.id).toUpperCase()
              ) || null
            );
          },
          { timeoutMs: 90000, onProgress }
        );
        if (!beacon.ok) {
          throw new Error(beacon.message || '房间广播失败');
        }
      } else {
        mqttAfterRoomChange();
      }

      emitRoomUpdate(bound.room);
      emitLobbyUpdate();
    } catch (err) {
      const creatorSock =
        resolveLiveCreatorSocket(socket, data.sessionId) || socket;
      const leave = rooms.leaveRoom(creatorSock.id);
      if (leave.leftRoomId) creatorSock.leave(leave.leftRoomId);
      // 断线后 players 表可能已无本人：按房间 id 清掉挂起的空房，避免僵尸房
      if (
        (!leave.leftRoomId || !leave.dissolved) &&
        room &&
        room.id &&
        rooms.getRoom(room.id)
      ) {
        const dissolved = rooms.dissolveRoom(room.id, creatorSock.id);
        if (dissolved.leftRoomId) {
          creatorSock.leave(dissolved.leftRoomId);
          for (const aid of dissolved.affectedPlayerIds || []) {
            const as = io.sockets.sockets.get(aid);
            if (as) as.leave(dissolved.leftRoomId);
          }
        }
      }
      if (operatorId) {
        const opLeave = rooms.leaveRoom(operatorId);
        if (opLeave.leftRoomId) {
          const opSock = io.sockets.sockets.get(operatorId);
          if (opSock) opSock.leave(opLeave.leftRoomId);
        }
      }
      mqttOnLogin();
      mqttAfterRoomChange();
      emitLobbyUpdate();
      creatorSock.emit('room:error', {
        message: (err && err.message) || '创建房间失败',
      });
    }
  });

  /**
   * 房主确认「房间状态错误，是否重开」：
   * 维持现有隧道（不主动换址）→ 解散旧房并清 MQTT → 建新房 → 广播转移通知。
   * 换隧道仅由探活失败触发。
   */
  socket.on('room:reopenTunnel', async () => {
    const me = rooms.getPlayer(socket.id);
    if (!me || !me.roomId) {
      socket.emit('room:error', { message: '你不在房间中' });
      return;
    }
    const oldRoom = rooms.getRoom(me.roomId);
    if (!oldRoom) {
      socket.emit('room:error', { message: '房间不存在' });
      return;
    }
    if (oldRoom.hostId !== socket.id) {
      socket.emit('room:error', { message: '仅房主可重开房间' });
      return;
    }

    const oldRoomId = oldRoom.id;
    const settings = {
      name: oldRoom.name,
      hasPassword: Boolean(oldRoom.hasPassword),
      password: oldRoom.password || '',
      maxPlayers: oldRoom.maxPlayers,
      gameType: oldRoom.gameType,
      gameMode: oldRoom.gameMode,
      turnTimeSec: oldRoom.turnTimeSec,
      allowTrade: Boolean(oldRoom.allowTrade),
      peacefulDev: oldRoom.peacefulDev !== false,
      easyStart: oldRoom.easyStart !== false,
      matchGames: oldRoom.matchGames,
    };
    const targets = [];
    for (const p of oldRoom.players || []) {
      if (!p || p.id === socket.id || p.left) continue;
      targets.push({
        name: p.name,
        tag: p.tag || null,
        sessionId: p.sessionId || null,
      });
    }
    for (const o of oldRoom.observers || []) {
      if (!o || o.id === socket.id || o.passiveHost) continue;
      targets.push({
        name: o.name,
        tag: o.tag || null,
        sessionId: o.sessionId || null,
      });
    }

    const progress = (message) =>
      socket.emit('room:creating', { message, roomId: oldRoomId });

    try {
      progress('正在确认公网隧道…');
      if (!tunnel) tunnel = attachTunnelHooks(new QuickTunnel({ label: 'room' }));
      // 不 forceRotate：沿用现有地址；仅进程已死时 ensure 会拉起
      const publicUrl = await ensurePublicTunnelUrl();
      if (!publicUrl) throw new Error('未能获得公网地址');

      // 先清旧房心跳，再解散本机房间
      mqttClearRoomOnDissolve();
      const dissolved = rooms.dissolveRoom(oldRoomId, socket.id);
      if (dissolved.leftRoomId) {
        socket.leave(dissolved.leftRoomId);
        for (const aid of dissolved.affectedPlayerIds || []) {
          const as = io.sockets.sockets.get(aid);
          if (as) {
            as.leave(dissolved.leftRoomId);
            as.emit('room:kicked', {
              reason: 'tunnel-reopen',
              message: '房主正在重开房间',
            });
          }
        }
      }
      emitLobbyUpdate();
      mqttOnLogin();

      progress('正在创建新房间…');
      const created = rooms.createRoom(socket.id, settings);
      if (!created.ok) {
        throw new Error(created.error || '创建新房间失败');
      }
      const room = created.room;
      socket.join(room.id);
      joinHallChat(socket);
      mqttOnLogin();

      if (mqttBulletin && mqttBulletin.enabled) {
        progress('正在准备公网隧道…');
        const ready = await mqttBulletin.waitForInfrastructureReady({
          timeoutMs: 90000,
        });
        if (!ready.ok) {
          throw new Error(ready.message || '隧道未就绪');
        }
      }

      const fresh = rooms.clearPendingLobby(room.id);
      if (!fresh) throw new Error('房间创建失败');

      const hostPlayer = rooms.getPlayer(socket.id);
      const creatorSock =
        resolveLiveCreatorSocket(
          socket,
          hostPlayer && hostPlayer.sessionId
        ) || socket;
      const bound = rooms.bindCreatorAsHost(creatorSock.id, fresh.id, {
        playerName: (hostPlayer && hostPlayer.name) || socket.data.playerName,
        sessionId: hostPlayer && hostPlayer.sessionId,
        playerTag: hostPlayer && hostPlayer.tag,
        client: hostPlayer && hostPlayer.client,
        role: hostPlayer && hostPlayer.role,
      });
      if (!bound.ok) throw new Error(bound.error || '房间创建失败');
      dropIdleSessionGhosts(bound.player.sessionId, creatorSock.id);
      creatorSock.join(bound.room.id);
      joinHallChat(creatorSock);
      emitPlayerMe(creatorSock, bound.player, bound.player.name);
      mqttOnLogin();

      if (mqttBulletin && mqttBulletin.enabled) {
        progress('正在广播新房间…');
        const beacon = await mqttBulletin.waitForRoomBeacon(
          bound.room.id,
          () => {
            const list = hostedBeaconRooms();
            return (
              list.find(
                (r) =>
                  String(r.id).toUpperCase() ===
                  String(bound.room.id).toUpperCase()
              ) || null
            );
          },
          { timeoutMs: 90000 }
        );
        if (!beacon.ok) {
          throw new Error(beacon.message || '房间广播失败');
        }
      } else {
        mqttAfterRoomChange();
      }

      const hostUrl = String(
        (tunnel && tunnel.getPublicUrl()) || publicUrl || ''
      ).replace(/\/$/, '');
      const transferMsg = {
        kind: 'roomTransfer',
        oldRoomId: String(oldRoomId).toUpperCase(),
        roomId: String(bound.room.id).toUpperCase(),
        host: hostUrl,
        name: bound.room.name || '',
        gameType: bound.room.gameType || '',
        gameLabel: bound.room.gameLabel || '',
        gameMode: bound.room.gameMode || '',
        gameModeLabel: bound.room.gameModeLabel || '',
        status: bound.room.status || 'waiting',
        targets,
        at: Date.now(),
      };
      if (mqttBulletin && mqttBulletin.enabled) {
        mqttBulletin.publishRoomTransfer(transferMsg);
      }
      io.emit('room:transfer', transferMsg);

      emitRoomUpdate(bound.room);
      emitLobbyUpdate();
      creatorSock.emit('room:reopenDone', {
        oldRoomId: transferMsg.oldRoomId,
        roomId: transferMsg.roomId,
        host: hostUrl,
      });
      console.log(
        `[tunnel] 房主重开房间 ${oldRoomId} → ${bound.room.id} @ ${hostUrl}`
      );
    } catch (err) {
      mqttOnLogin();
      mqttAfterRoomChange();
      emitLobbyUpdate();
      socket.emit('room:error', {
        message: (err && err.message) || '重开房间失败',
      });
    }
  });

  socket.on('room:spectate', (data = {}) => {
    ensureSocketPlayer(socket, data);

    const result = rooms.spectateRoom(socket.id, data.roomId, {
      password: data.password,
    });
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }

    socket.join(result.room.id);
    joinHallChat(socket);
    const me = forceSocketPlayerName(socket, data) || rooms.getPlayer(socket.id);
    dropIdleSessionGhosts(me && me.sessionId, socket.id);
    if (!result.already) {
      socket.to(result.room.id).emit('room:spectatorJoined', {
        id: socket.id,
        name: (me && me.name) || pickPayloadPlayerName(data) || '玩家',
        tag: (me && me.tag) || null,
      });
    }
    emitRoomUpdate(result.room, socket);
    emitPlayerMe(socket, me, (me && me.name) || pickPayloadPlayerName(data));
    if (result.room.status === 'playing' && result.room.game) {
      emitGameState(result.room);
    }
    emitLobbyUpdate();
    mqttOnLogin();
    mqttAfterRoomChange();
  });

  socket.on('room:verifyPassword', (data = {}) => {
    // 必须在房主本机服务端校验；密码从不经 MQTT 广播
    const result = rooms.checkRoomPassword(data.roomId, data.password);
    socket.emit('room:verifyPassword:result', {
      ok: Boolean(result.ok),
      roomId: data.roomId ? String(data.roomId).toUpperCase() : null,
      needsPassword: Boolean(result.needsPassword),
      message: result.ok ? null : result.error || '房间密码错误',
    });
  });

  socket.on('room:join', (data = {}) => {
    ensureSocketPlayer(socket, data);

    const result = rooms.joinRoom(socket.id, data.roomId, {
      password: data.password,
    });
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }

    socket.join(result.room.id);
    joinHallChat(socket);
    const me = forceSocketPlayerName(socket, data) || rooms.getPlayer(socket.id);
    dropIdleSessionGhosts(me && me.sessionId, socket.id);
    emitRoomUpdate(result.room, socket);
    emitPlayerMe(socket, me, (me && me.name) || pickPayloadPlayerName(data));
    emitLobbyUpdate();
    mqttOnLogin();
    mqttAfterRoomChange();
  });

  socket.on('lobby:setPassive', async (data = {}) => {
    const on = Boolean(data && data.on);
    if (!rooms.getPlayer(socket.id)) {
      socket.emit('lobby:error', { message: '请先进入大厅' });
      return;
    }

    const gate = assertHostOccupant(
      socket,
      data && data.sessionId
    );
    if (!gate.ok) {
      socket.emit('lobby:error', { message: gate.error });
      const p = rooms.getPlayer(socket.id);
      socket.emit('lobby:passive', {
        passive: Boolean(p && p.passive),
        publicUrl: getPassiveShareUrl() || null,
        controller: getPassiveControllerPayload(),
      });
      return;
    }

    // 关闭被动：对局进行中禁止；若已在房间则解散房间后再关
    if (!on) {
      // 取消正在进行的「进入被动」准备
      socket.data.passivePreparing = false;
      const cur = rooms.getPlayer(socket.id);
      const room = cur && cur.roomId ? rooms.getRoom(cur.roomId) : null;
      if (
        room &&
        room.status === 'playing' &&
        room.game &&
        !room.game.over
      ) {
        socket.emit('lobby:error', {
          message: '对局进行中，请等待本局结束后再退出被动模式',
        });
        socket.emit('lobby:passive', {
          passive: true,
          publicUrl: getPassiveShareUrl() || null,
          controller: getPassiveControllerPayload(),
        });
        return;
      }
      if (room) {
        const leftRoomId = room.id;
        const dissolve = rooms.dissolveRoom(leftRoomId, socket.id);
        socket.leave(leftRoomId);
        for (const otherId of dissolve.affectedPlayerIds || []) {
          const otherSocket = io.sockets.sockets.get(otherId);
          if (otherSocket) otherSocket.leave(leftRoomId);
          io.to(otherId).emit('room:left', {
            reason: 'dissolved',
            roomId: leftRoomId,
          });
        }
        socket.emit('room:left', {
          reason: 'dissolved',
          roomId: leftRoomId,
        });
        mqttClearRoomOnDissolve();
        stopTunnelIfIdle();
      }

      const result = rooms.setPlayerPassive(socket.id, false);
      if (!result.ok) {
        const p = rooms.getPlayer(socket.id);
        socket.emit('lobby:error', { message: result.error });
        socket.emit('lobby:passive', {
          passive: Boolean(p && p.passive),
          publicUrl: getPassiveShareUrl() || null,
          controller: getPassiveControllerPayload(),
        });
        return;
      }
      clearPassiveController({ silent: true });
      // 退出被动后停掉控制隧道，房间隧道保留给后续开房
      if (!hasPassiveHost()) stopControlTunnel();
      socket.emit('lobby:passive', {
        passive: false,
        publicUrl: null,
        controller: null,
      });
      emitLobbyUpdate();
      mqttOnLogin();
      mqttAfterRoomChange();
      return;
    }

    // 开启被动：控制隧道就绪前不设标记、不发被动心跳
    const already = rooms.getPlayer(socket.id);
    if (already && already.passive) {
      socket.emit('lobby:passive', {
        passive: true,
        publicUrl: getPassiveShareUrl() || null,
        controller: getPassiveControllerPayload(),
      });
      emitPassiveControlUpdate(socket);
      return;
    }
    if (socket.data.passivePreparing) {
      socket.emit('lobby:passiveProgress', {
        message: '正在进入被动模式…',
      });
      return;
    }

    socket.data.passivePreparing = true;
    socket.emit('lobby:passiveProgress', {
      message: '正在进入被动模式…',
    });

    try {
      if (mqttBulletin && mqttBulletin.enabled) {
        const progress = (phase) => {
          if (!socket.data.passivePreparing) return;
          let message = '正在进入被动模式…';
          if (phase === 'mqtt') message = '正在进入被动模式…（连接广播）';
          else if (phase === 'tunnel') {
            message = '正在进入被动模式…（准备控制隧道）';
          } else if (phase === 'tunnel-warmup') {
            message = '正在进入被动模式…（控制隧道就绪中）';
          }
          socket.emit('lobby:passiveProgress', { message });
        };
        progress('tunnel');
        // 控制隧道：分享入口；房间隧道并行预热，开房时不必再等
        await Promise.all([
          ensureControlTunnelUrl(),
          ensurePublicTunnelUrl().catch(() => ''),
        ]);
        const ready = await mqttBulletin.waitForInfrastructureReady({
          timeoutMs: 90000,
          onProgress: progress,
          skipTouchLogin: true,
          preferControlTunnel: true,
        });
        if (!socket.data.passivePreparing) return;
        if (!ready.ok) {
          throw new Error(ready.message || '控制隧道准备失败');
        }
      } else {
        try {
          await ensureControlTunnelUrl();
          await ensurePublicTunnelUrl().catch(() => '');
        } catch (_) {
          /* 无 MQTT 时隧道可选 */
        }
        if (!socket.data.passivePreparing) return;
      }

      const result = rooms.setPlayerPassive(socket.id, true);
      socket.data.passivePreparing = false;
      if (!result.ok) {
        if (!hasPassiveHost()) stopControlTunnel();
        socket.emit('lobby:error', { message: result.error });
        socket.emit('lobby:passive', {
          passive: false,
          publicUrl: null,
          controller: null,
        });
        return;
      }
      socket.emit('lobby:passive', {
        passive: true,
        publicUrl: getPassiveShareUrl() || null,
        controller: getPassiveControllerPayload(),
      });
      // 已在大厅的隧道访客：立刻授予操控权
      if (!passiveController) {
        for (const [id, sock] of io.sockets.sockets) {
          if (!sock || !sock.connected) continue;
          if ((sock.data.access || socketAccess(sock)) !== 'tunnel') continue;
          const guest = rooms.getPlayer(id);
          if (!guest || guest.passive) continue;
          if (claimPassiveController(sock, guest)) {
            emitPlayerMe(sock, guest, guest.name);
            break;
          }
        }
      }
      emitPassiveControlUpdate(socket);
      emitLobbyUpdate();
      mqttOnLogin();
    } catch (err) {
      socket.data.passivePreparing = false;
      const still = rooms.getPlayer(socket.id);
      if (still) still.passive = false;
      if (!hasPassiveHost()) stopControlTunnel();
      socket.emit('lobby:error', {
        message: (err && err.message) || '进入被动模式失败',
      });
      socket.emit('lobby:passive', {
        passive: false,
        publicUrl: null,
        controller: null,
      });
      emitLobbyUpdate();
      mqttOnLogin();
    }
  });

  socket.on('room:leave', () => {
    const result = rooms.leaveRoom(socket.id);
    if (result.leftRoomId) {
      socket.leave(result.leftRoomId);
    }
    for (const otherId of result.affectedPlayerIds || []) {
      const otherSocket = io.sockets.sockets.get(otherId);
      if (otherSocket && result.leftRoomId) {
        otherSocket.leave(result.leftRoomId);
      }
      io.to(otherId).emit('room:left', {
        reason: result.dissolved ? 'dissolved' : 'kicked',
        roomId: result.leftRoomId || null,
      });
    }
    if (result.room) {
      if (result.leftObserver) emitSpectatorLeft(result.room, result.leftObserver);
      emitRoomUpdate(result.room);
    }
    emitLobbyUpdate();
    if (result.dissolved) stopRealtimeLoop(result.room);
    socket.emit('room:left', {
      reason: result.dissolved ? 'dissolved' : 'left',
      roomId: result.leftRoomId || null,
    });
    mqttOnLogin();
    if (result.dissolved) mqttClearRoomOnDissolve();
    else mqttAfterRoomChange();
    if (result.dissolved) stopTunnelIfIdle();
  });

  socket.on('game:leave', () => {
    const result = rooms.quitPlaying(socket.id);
    if (result.leftRoomId) {
      socket.leave(result.leftRoomId);
    }
    if (result.leftObserver && result.room) {
      emitSpectatorLeft(result.room, result.leftObserver);
      emitRoomUpdate(result.room);
    } else if (result.abandoned && result.room) {
      handleAbandonedPlayers(result.room);
      io.to(result.room.id).emit('game:player-left', {
        playerId: socket.id,
        name: result.playerName,
        tag: result.playerTag,
      });
      emitRoomUpdate(result.room);
      emitGameState(result.room);
      if (result.room.status === 'playing' && result.room.game) {
        syncTurnTimer(result.room, { onTimeout: handleTurnTimeout });
      }
    } else if (result.dissolved) {
      for (const otherId of result.affectedPlayerIds || []) {
        const otherSocket = io.sockets.sockets.get(otherId);
        if (otherSocket && result.leftRoomId) {
          otherSocket.leave(result.leftRoomId);
        }
        io.to(otherId).emit('room:left', {
          reason: 'dissolved',
          roomId: result.leftRoomId || null,
        });
      }
    }
    socket.emit('game:quit-ok', {});
    if (result.dissolved) stopRealtimeLoop(result.room);
    emitLobbyUpdate();
    mqttOnLogin();
    if (result.dissolved) mqttClearRoomOnDissolve();
    else mqttAfterRoomChange();
    if (result.dissolved) stopTunnelIfIdle();
  });

  socket.on('room:ready', (data = {}) => {
    const result = rooms.setReady(socket.id, data.ready);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }
    emitRoomUpdate(result.room);
  });

  socket.on('room:inviteLobby', () => {
    const player = rooms.getPlayer(socket.id);
    if (!player || !player.roomId) return;
    const room = rooms.getRoom(player.roomId);
    if (!room || room.status !== 'waiting') return;
    if (room.hostId !== socket.id) return;

    const now = Date.now();
    const last = lastInviteAt.get(socket.id) || 0;
    if (now - last < INVITE_COOLDOWN_MS) {
      socket.emit('room:error', { message: '邀请过于频繁，请稍后再试' });
      return;
    }
    lastInviteAt.set(socket.id, now);

    const seated = (room.players || []).filter((p) => p && !p.left).length;
    const msg = {
      app: 'lianji',
      kind: 'invite',
      instanceId: INSTANCE_ID,
      roomId: room.id,
      hostName: player.name || '房主',
      hostTag: player.tag || null,
      gameType: room.gameType || '',
      gameLabel: room.gameLabel || '',
      gameMode: room.gameMode || '',
      gameModeLabel: room.gameModeLabel || '',
      playerCount: seated,
      maxPlayers: room.maxPlayers,
      at: Date.now(),
      host: null,
    };

    broadcastInviteLocal(msg, socket.id);
    if (mqttBulletin && mqttBulletin.enabled) {
      const advertiseHost =
        getRoomPublicUrl() || localBaseUrl();
      mqttBulletin.publishInvite({ ...msg, host: advertiseHost });
    }
  });

  socket.on('room:start', () => {
    const result = rooms.startGame(socket.id);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }
    emitRoomUpdate(result.room);
    // 开局：先发送 game:loading，等所有人资源加载完成后再发 game:started
    mqttNotifyRoomStatusNow();
    emitGameLoading(result.room);
  });

  socket.on('game:loadingProgress', (data = {}) => {
    const progress = Number(data && data.progress) || 0;
    const res = rooms.reportLoadingProgress(socket.id, progress);
    if (res.ok && res.room) {
      broadcastLoadingProgress(res.room);
    }
  });

  socket.on('game:loadingReady', () => {
    const res = rooms.reportLoadingReady(socket.id);
    if (!res.ok || !res.room) return;
    broadcastLoadingProgress(res.room);
    if (res.allReady) {
      const room = res.room;
      // 所有人加载完成：正式开局，启动倒计时
      syncTurnTimer(room, { onTimeout: handleTurnTimeout });
      emitGameStarted(room);
      scheduleLasidaoInitAnnounce(room);
      startRealtimeLoop(room);
    }
  });

  // 实时对战：玩家操作输入（移动/瞄准/射击），高频轻量通道，不触发全量状态广播
  socket.on('game:rtInput', (data = {}) => {
    const player = rooms.getPlayer(socket.id);
    if (!player || !player.roomId) return;
    const room = rooms.getRoom(player.roomId);
    if (!room || room.status !== 'playing' || !room.game) return;
    const mod = getGame(room.gameType);
    if (!mod || typeof mod.setPlayerInput !== 'function') return;
    const seat = (room.players || []).find((p) => p && p.id === socket.id);
    if (seat && seat.isHosted) return;
    try {
      mod.setPlayerInput(room.game, socket.id, data);
    } catch (_) {
      /* ignore */
    }
  });

  socket.on('room:moveSeat', (data = {}) => {
    const result = rooms.moveTeamSeat(socket.id, data.from, data.to);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }
    emitRoomUpdate(result.room);
  });

  socket.on('room:addBot', (data = {}) => {
    const result = rooms.addBotPlayer(socket.id, data.seatIndex, data.difficulty);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }
    emitRoomUpdate(result.room);
  });

  socket.on('room:removeBot', (data = {}) => {
    const result = rooms.removeBotPlayer(socket.id, data.seatIndex);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }
    emitRoomUpdate(result.room);
  });

  socket.on('game:setHosted', (data = {}) => {
    const want =
      data && Object.prototype.hasOwnProperty.call(data, 'hosted')
        ? Boolean(data.hosted)
        : true;
    const result = rooms.setPlayerHosted(socket.id, want);
    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }
    const room = result.room;
    const mod = getGame(room.gameType);

    // 开启托管时：结算动画直接确认；若轮到自己则立刻由困难电脑接手
    if (result.isHosted && room.game && mod) {
      if (room.game.phase === 'settle' && typeof mod.applyAction === 'function') {
        try {
          mod.applyAction(room.game, socket.id, {
            type: 'finishSettleAnim',
            payload: {},
          });
        } catch (_) {
          /* ignore */
        }
      }
    }

    emitRoomUpdate(room);
    emitGameState(room);
    if (result.isHosted) {
      scheduleBotTick(room);
    }
    socket.emit('game:hosted', { ok: true, isHosted: result.isHosted });
  });

  socket.on('room:updateSettings', (data = {}) => {
    const result = rooms.updateSettings(socket.id, {
      name: data.name,
      hasPassword: data.hasPassword,
      password: data.password,
      maxPlayers: data.maxPlayers,
      gameType: data.gameType,
      gameMode: data.gameMode,
      turnTimeSec: data.turnTimeSec,
      allowTrade: data.allowTrade,
      peacefulDev: data.peacefulDev,
      easyStart: data.easyStart,
      matchGames: data.matchGames,
    });
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }
    // 立刻同步房内成员 + 本机大厅 + MQTT 公网列表
    emitRoomUpdate(result.room);
    emitLobbyUpdate();
    mqttOnLogin();
    mqttAfterRoomChange();
    socket.emit('room:settingsUpdated', { ok: true, roomId: result.room.id });
  });

  socket.on('game:action', (data = {}) => {
    const player = rooms.getPlayer(socket.id);
    if (!player || !player.roomId) {
      socket.emit('game:error', { message: '你不在房间中' });
      return;
    }

    const room = rooms.getRoom(player.roomId);
    if (!room || room.status !== 'playing' || !room.game) {
      socket.emit('game:error', { message: '对局未开始' });
      return;
    }
    if ((room.observers || []).some((o) => o.id === socket.id)) {
      socket.emit('game:error', { message: '观战中无法操作' });
      return;
    }

    const seat = (room.players || []).find((p) => p && p.id === socket.id);
    if (seat && seat.isHosted && data.type !== 'finishSettleAnim') {
      socket.emit('game:error', { message: '托管中，由电脑代为操作' });
      return;
    }

    const mod = getGame(room.gameType);
    if (!mod) {
      socket.emit('game:error', { message: '未知游戏类型' });
      return;
    }

    const wasOver = Boolean(room.game && room.game.over);
    const wasStatus = room.status;
    const prevRevealId =
      room.game && room.game.lastPlayReveal
        ? room.game.lastPlayReveal.id
        : null;
    const prevFxId =
      room.game && room.game.lastProduceFx
        ? room.game.lastProduceFx.id
        : null;
    const result = mod.applyAction(room.game, socket.id, {
      type: data.type,
      payload: data.payload,
    });

    if (!result.ok) {
      socket.emit('game:error', {
        message: result.error,
        code: result.code || null,
      });
      return;
    }

    handleAbandonedPlayers(room);
    // 服务端接受的操作视为有效操作，刷新思考时间
    syncTurnTimer(room, { onTimeout: handleTurnTimeout });
    // 轻量 pulse 先于全量状态：隧道上大包 game:state 可能晚到数秒
    const g = room.game;
    const newReveal = g && g.lastPlayReveal;
    const newFx = g && g.lastProduceFx;
    if (newReveal && newReveal.id && newReveal.id !== prevRevealId) {
      io.to(room.id).emit('game:play-reveal', { reveal: newReveal });
    }
    if (g) {
      const pulse = {
        type: data.type,
        actorId: socket.id,
        phase: g.phase,
        currentPlayerId: g.currentPlayerId || null,
        lastPlacerId: g.lastPlacerId || null,
        stateSeq: Number(g.stateSeq) || 0,
        fx: newFx && newFx.id && newFx.id !== prevFxId ? newFx : null,
      };
      // 生产阶段：每次操作都带上 awaiting + activeProduce，避免 placeDice 推进回合后
      // 客户端只改了 currentPlayerId、残留上一玩家骰面，把「下一玩家等待投掷」挡掉
      if (g.phase === 'produce' && room.gameType === 'lasidao') {
        const pid = g.currentPlayerId;
        const produceDice = pid && g.dice && g.dice[pid] ? g.dice[pid] : [];
        const produceBoost =
          pid && g.diceBoosted && g.diceBoosted[pid] ? g.diceBoosted[pid] : [];
        pulse.awaitingProduceRoll = Boolean(g.awaitingProduceRoll);
        pulse.remoteDiceMode = Boolean(g.remoteDiceMode);
        pulse.activeProduce = pid
          ? {
              playerId: pid,
              awaitingRoll: Boolean(g.awaitingProduceRoll),
              remoteDiceMode: Boolean(g.remoteDiceMode),
              dice: produceDice.slice(),
              diceBoosted: produceBoost.slice(),
            }
          : null;
        // 投掷结果：行动者顶层 dice（旁观者只看 activeProduce）
        if (data.type === 'produceRoll' && pid) {
          pulse.dice = produceDice.slice();
          pulse.diceBoosted = produceBoost.slice();
          pulse.actorId = pid;
        }
      } else if (data.type === 'mercenaryRoll') {
        pulse.mercenaryRoll = (g.mercenaryRoll || []).slice();
        pulse.mercenaryPlaced = (g.mercenaryPlaced || []).slice();
      }
      io.to(room.id).emit('game:pulse', pulse);
    }
    emitGameState(room);
    // 对局刚结束：立刻刷新房间状态并广播
    afterPlayingMutation(room, { wasOver, wasStatus });
    // 玩家行动后，如果轮到 bot，触发自动行动
    scheduleBotTick(room);
  });

  socket.on('chat:send', (data = {}) => {
    const player = rooms.getPlayer(socket.id);
    if (!player) {
      socket.emit('chat:error', { message: '请先进入大厅' });
      return;
    }
    const text = sanitizeChatText(data.text);
    if (!text) {
      socket.emit('chat:error', { message: '消息不能为空' });
      return;
    }
    const now = Date.now();
    if (socket.data.lastChatAt && now - socket.data.lastChatAt < 700) {
      socket.emit('chat:error', { message: '发送太快，请稍候' });
      return;
    }
    socket.data.lastChatAt = now;
    const channel = data.channel === 'room' ? 'room' : 'all';
    if (channel === 'room' && !player.roomId) {
      socket.emit('chat:error', { message: '进入房间后才能使用房间频道' });
      return;
    }
    const msg = buildChatMessage(player, channel, text);
    if (channel === 'room') {
      io.to(player.roomId).emit('chat:message', msg);
      return;
    }
    emitChatAll(msg);
  });

  socket.on('disconnect', () => {
    lastInviteAt.delete(socket.id);
    const me = rooms.getPlayer(socket.id);
    if (hostOccupancy.isOwner(me && me.sessionId, socket.id)) {
      const peerId = findLiveSessionPeer(me && me.sessionId, socket.id);
      const peer = peerId ? rooms.getPlayer(peerId) : null;
      hostOccupancy.transferOrRelease(me && me.sessionId, peerId, {
        name: (peer && peer.name) || (me && me.name),
        tag: (peer && peer.tag) || (me && me.tag),
      });
    }
    releasePassiveController(socket);
    // 对局中断线：标记离线并保留牌局，便于重连；大厅/等待房仍直接离开
    const result = rooms.markOffline(socket.id);
    if (result.leftRoomId && result.room) {
      if (result.leftObserver) emitSpectatorLeft(result.room, result.leftObserver);
      emitRoomUpdate(result.room);
      if (result.offline && result.room.status === 'playing' && result.room.game) {
        emitGameState(result.room);
      }
    }
    mqttOnLogin();
    if (result.leftRoomId || result.room || result.dissolved) {
      if (result.dissolved) mqttClearRoomOnDissolve();
      else mqttAfterRoomChange();
    }
    emitLobbyUpdate();
  });
});

function onRosterChange() {
  io.emit('lobby:update', buildLobbyPayload());
}

mqttBulletin = new MqttBulletin({
  rootDir: pathRoot,
  instanceId: INSTANCE_ID,
  getDisplayName: () => currentDisplayName(),
  getDisplayTag: () => {
    const first = [...rooms.players.values()][0];
    return (first && first.tag) || null;
  },
  getLobbyPeople: () => rooms.listLobbyPeople(),
  getHostedRooms: () => hostedBeaconRooms(),
  ensureTunnelUrl: ensurePublicTunnelUrl,
  peekTunnelUrl: () => getRoomPublicUrl(),
  ensureControlTunnelUrl,
  peekControlTunnelUrl: () => getControlPublicUrl(),
  onChange: () => {
    onRosterChange();
    nudgeStaleTunnelPlayers();
  },
  onChat: (msg) => {
    broadcastChatAllLocal(msg);
  },
  onInvite: (msg) => {
    broadcastInviteLocal(msg);
  },
  onReload: (msg) => {
    io.emit('room:reload', msg);
  },
  onRoomTransfer: (msg) => {
    io.emit('room:transfer', msg);
  },
  onLeave: (msg) => {
    try {
      const result = rooms.explicitLeaveByIdentity(msg || {});
      applyExplicitLeaveResult(result);
    } catch (err) {
      console.warn('[mqtt] leave', err && err.message);
    }
  },
});

if (mqttBulletin && mqttBulletin.enabled) {
  tunnel = attachTunnelHooks(new QuickTunnel({ label: 'room' }));
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `[EADDRINUSE] Port ${PORT} is already in use. Close the old server window, or run 启动.bat again.`
    );
    process.exit(1);
  }
  throw err;
});

function shutdownCleanup() {
  try {
    if (mqttBulletin) mqttBulletin.stop();
  } catch (_) {
    /* ignore */
  }
  try {
    if (controlTunnel) controlTunnel.stop();
  } catch (_) {
    /* ignore */
  }
  try {
    if (tunnel) tunnel.stop();
  } catch (_) {
    /* ignore */
  }
}

process.on('exit', shutdownCleanup);
process.on('SIGINT', () => {
  shutdownCleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdownCleanup();
  process.exit(0);
});

server.listen(PORT, '0.0.0.0', () => {
  const localUrl = `http://localhost:${PORT}`;
  console.log(`联机服务已启动: ${localUrl}`);
  if (mqttBulletin && mqttBulletin.enabled) {
    const offlineSec = Math.round(ROOM_OFFLINE_MS / 1000);
    console.log(
      `跨网广播: MQTT 已启用（单节点自动选择，大厅可切换；频道 ${mqttBulletin.channel}；登录/房间心跳 5s，失效判定 ${offlineSec}s）`
    );
  }
  if (!(mqttBulletin && mqttBulletin.enabled)) {
    console.log('跨网: MQTT 广播已关闭，仅本机可用（创建 mqtt.off 可关闭）');
  }
  console.log('联机方式：统一走 MQTT 广播 + Cloudflare 隧道（已取消局域网发现）');
  console.log('可选游戏:', listGames().map((g) => g.label).join(', '));
  if (mqttBulletin && mqttBulletin.enabled) {
    mqttBulletin.start().catch((err) => {
      console.warn('[mqtt] 启动失败:', err && err.message ? err.message : err);
    });
    warmupTunnelInBackground();
  }

  const openFlag = String(process.env.OPEN_BROWSER || '').toLowerCase();
  const skipBrowser =
    String(process.env.LIANJI_UPDATE_RESTART || '') === '1' ||
    fs.existsSync(path.join(pathRoot, '.update', 'skip-browser.flag'));
  if (!skipBrowser && (openFlag === '1' || openFlag === 'true' || openFlag === 'yes')) {
    openBrowser(localUrl);
  }
  try {
    fs.rmSync(path.join(pathRoot, '.update', 'skip-browser.flag'), {
      force: true,
    });
  } catch (_) {}

  // 主机 OTA 已在 启动.bat → scripts/check-host-update.js 启动前完成；此处仅标记状态
  if (hostUpdate.disabled) {
    console.log('[update] 已禁用（存在 update.off）');
  } else {
    console.log(
      '[update] 启动前已检查/升级（清单: ' + hostUpdate.manifestUrl + '）'
    );
  }
});

function openBrowser(url) {
  const { exec } = require('child_process');
  let cmd;
  if (process.platform === 'win32') {
    cmd = `cmd /c start "" "${url}"`;
  } else if (process.platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) console.warn('自动打开浏览器失败，请手动访问:', url);
  });
}
