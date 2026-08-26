'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { RoomManager, fullRoomView } = require('./rooms');
const { listGames, getGame } = require('./games');
const { syncTurnTimer, clearTurnTimer } = require('./turnTimer');
const { MqttBulletin } = require('./mqttBulletin');
const { QuickTunnel } = require('./tunnel');
const crypto = require('crypto');
const pathRoot = path.join(__dirname, '..');

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
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // 本机多开/后台标签页定时器被节流时，适当放宽避免误断线
  pingInterval: 25000,
  pingTimeout: 60000,
});

const rooms = new RoomManager();
let mqttBulletin = null;
let tunnel = null;

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
app.use('/games/sgs/res', express.static(sgsResourseDir));

// 拉斯岛资源：server/games/lasidao/resourse → /games/lasidao/res/
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
app.use('/games/lasidao/res', express.static(getLasidaoResourseDir()));
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
    publicUrl: tunnel ? tunnel.getPublicUrl() : null,
    games: listGames(),
  });
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
      hidden: room.hidden,
      playerCount: room.players.length,
      maxPlayers: room.maxPlayers,
      minPlayers: room.minPlayers,
      status: room.status,
      gameType: room.gameType,
      gameLabel: room.gameLabel,
      gameMode: room.gameMode,
      gameModeLabel: room.gameModeLabel,
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
  const localRooms = rooms.listLobbyRooms().map((room) => ({
    ...room,
    host: localHost,
    local: true,
  }));

  const remoteRooms = mqttBulletin ? mqttBulletin.getPublicRooms() : [];
  const peers = mqttBulletin ? mqttBulletin.getOnlinePeers() : [];

  const localPeople = rooms.listLobbyPeople().map((p) => ({
    ...p,
    local: true,
    host: localHost,
  }));
  const remotePeople = mqttBulletin ? mqttBulletin.getRemotePeople() : [];
  const people = mergeLobbyPeople(localPeople, remotePeople);

  return {
    rooms: [...localRooms, ...remoteRooms],
    peers,
    people,
    localHost,
    mqttBulletin: Boolean(mqttBulletin && mqttBulletin.enabled),
    publicUrl: tunnel ? tunnel.getPublicUrl() : null,
    games: listGames(),
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

function hostedBeaconRooms() {
  return beaconRooms()
    .filter((r) => {
      const full = rooms.getRoom(r.id);
      return full && full.hostId && rooms.getPlayer(full.hostId);
    })
    .map((r) => {
      const full = rooms.getRoom(r.id);
      return {
        ...r,
        _createdAt: (full && full.createdAt) || Date.now(),
        players: (full && full.players)
          ? full.players.map((p) => ({ name: p.name, tag: p.tag || null }))
          : [],
      };
    });
}

function mqttOnLogin() {
  if (mqttBulletin && mqttBulletin.enabled) mqttBulletin.pulseLogin();
}

function mqttAfterRoomChange() {
  if (mqttBulletin && mqttBulletin.enabled) mqttBulletin.pulseRoom();
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

function attachTunnelHooks(t) {
  if (!t) return t;
  t.onUrl = (url) => {
    if (mqttBulletin && mqttBulletin.enabled) {
      // 公网地址刚到手：MQTT 已连上则立刻广播房间
      mqttBulletin.flushIfReady(url);
    }
  };
  t.onLost = () => {
    if (mqttBulletin && mqttBulletin.enabled) mqttBulletin.clearRoomBeacon();
  };
  return t;
}

async function ensurePublicTunnelUrl() {
  if (!tunnel) tunnel = attachTunnelHooks(new QuickTunnel());
  await tunnel.ensure(PORT);
  return tunnel.getPublicUrl() || '';
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

function emitChatAll(msg) {
  broadcastChatAllLocal(msg);
  if (mqttBulletin && mqttBulletin.enabled) mqttBulletin.publishChat(msg);
}

function emitPlayerMe(socket, player, fallbackName) {
  socket.emit('player:me', {
    id: socket.id,
    name: (player && player.name) || fallbackName || '玩家',
    tag: (player && player.tag) || null,
    localHost: localBaseUrl(),
  });
}

function emitRoomUpdate(room) {
  if (!room) return;
  const payload = { room: fullRoomView(room) };
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
  state.leftPlayerIds = leftIds;
  if (Array.isArray(state.players)) {
    for (const p of state.players) {
      p.left = Boolean(p.left) || leftIds.includes(p.id);
    }
  }
  if (state.me && leftIds.includes(state.me.id)) state.me.left = true;
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
  scheduleLasidaoSettleAnim(room);
}

function emitGameStarted(room) {
  if (!room) return;
  for (const p of room.players) {
    if (p.offline || p.left) continue;
    io.to(p.id).emit('game:started', {
      state: publicStateForRoom(room, p.id),
    });
  }
}

/** 拉斯岛：先手宣布结束后再发牌进入生产 */
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
  }, delay);
}

/** 拉斯岛：结算动画超时后强制进入下一阶段 */
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
    mod.finishSettleAnimForce(room.game);
    syncTurnTimer(room, { onTimeout: handleTurnTimeout });
    emitGameState(room);
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

function handleTurnTimeout(room) {
  if (!room || room.status !== 'playing' || !room.game) {
    clearTurnTimer(room);
    return;
  }

  const mod = getGame(room.gameType);
  if (!mod || typeof mod.forceTimeout !== 'function') {
    clearTurnTimer(room);
    emitGameState(room);
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
    try {
      mod.forceTimeout(room.game, id);
    } catch (_) {
      /* ignore per-player timeout failures */
    }
  }

  handleAbandonedPlayers(room);
  syncTurnTimer(room, { onTimeout: handleTurnTimeout });
  emitGameState(room);
}

io.on('connection', (socket) => {
  socket.on('lobby:join', (data = {}) => {
    const sessionId = data.sessionId || null;
    const roomIdHint = data.roomId || null;
    const oldPlayerId = data.oldPlayerId || null;
    const playerTag = data.playerTag || null;
    // 仅在明确「重新加入」时认领座位；普通进大厅不自动回桌
    const wantRejoin = Boolean(data.rejoin);
    const reclaimed = wantRejoin
      ? rooms.tryReclaimSeat(
          socket.id,
          data.playerName,
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
      const player = rooms.registerPlayer(socket.id, data.playerName, {
        sessionId,
        playerTag,
      });
      socket.join(reclaimed.room.id);
      joinHallChat(socket);
      socket.data.playerName = player.name;
      mqttOnLogin();
      emitLobbyUpdate();
      emitPlayerMe(socket, player, data.playerName);
      socket.emit('session:reclaimed', {
        roomId: reclaimed.room.id,
        status: reclaimed.room.status,
        playing: Boolean(
          reclaimed.room.status === 'playing' && reclaimed.room.game
        ),
      });
      emitRoomUpdate(reclaimed.room);
      if (reclaimed.room.status === 'playing' && reclaimed.room.game) {
        emitGameState(reclaimed.room);
        scheduleLasidaoInitAnnounce(reclaimed.room);
      }
      return;
    }

    if (wantRejoin) {
      // 明确重连但认领失败：仍进大厅，并告知客户端
      const player = rooms.registerPlayer(socket.id, data.playerName, {
        sessionId,
        playerTag,
      });
      socket.data.playerName = player.name;
      joinHallChat(socket);
      if (data.playerName) mqttOnLogin();
      emitLobbyUpdate();
      emitPlayerMe(socket, player, data.playerName);
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

    const player = rooms.registerPlayer(socket.id, data.playerName, {
      sessionId,
      playerTag,
    });
    socket.data.playerName = player.name;
    joinHallChat(socket);
    if (data.playerName) mqttOnLogin();
    emitLobbyUpdate();
    emitPlayerMe(socket, player, data.playerName);
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
      message: active ? null : '房间已不存在或对局已结束',
    });
  });

  socket.on('lobby:refresh', () => {
    socket.emit('lobby:update', buildLobbyPayload());
  });

  socket.on('player:rename', (data = {}) => {
    if (!rooms.getPlayer(socket.id)) {
      rooms.registerPlayer(socket.id, data.playerName || '玩家', {
        sessionId: data.sessionId,
        playerTag: data.playerTag,
      });
    }
    const { player, room } = rooms.setPlayerName(
      socket.id,
      data.playerName,
      { sessionId: data.sessionId, playerTag: data.playerTag }
    );
    socket.data.playerName = player.name;
    mqttOnLogin();
    emitPlayerMe(socket, player, data.playerName);
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

  socket.on('room:create', async (data = {}) => {
    if (!rooms.getPlayer(socket.id)) {
      rooms.registerPlayer(socket.id, data.playerName || '玩家', {
        sessionId: data.sessionId,
        playerTag: data.playerTag,
      });
    } else if (data.sessionId || data.playerTag) {
      rooms.registerPlayer(socket.id, data.playerName || '玩家', {
        sessionId: data.sessionId,
        playerTag: data.playerTag,
      });
    }

    const result = rooms.createRoom(socket.id, {
      name: data.name,
      hidden: data.hidden,
      maxPlayers: data.maxPlayers,
      gameType: data.gameType,
      gameMode: data.gameMode,
      turnTimeSec: data.turnTimeSec,
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
    // pendingLobby 期间仍按空闲发登录心跳，不广播房间
    mqttOnLogin();

    const progress = (message) =>
      socket.emit('room:creating', { message, roomId: room.id });
    progress('正在创建房间…');

    try {
      if (mqttBulletin && mqttBulletin.enabled) {
        progress('正在准备公网隧道…');
        await ensurePublicTunnelUrl();

        const onProgress = (phase) => {
          if (phase === 'mqtt') progress('正在连接 MQTT…');
          else if (phase === 'tunnel') progress('正在准备公网隧道…');
          else if (phase === 'tunnel-warmup') progress('隧道就绪中，请稍候…');
        };

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

      // 隧道就绪后：公开房间 → 房主进房 → 再刷新大厅/广播（此前大厅不出现该房、状态仍空闲）
      const fresh = rooms.clearPendingLobby(room.id);
      if (!fresh) {
        socket.emit('room:error', { message: '房间创建失败' });
        return;
      }
      emitRoomUpdate(fresh);
      emitLobbyUpdate();
      mqttOnLogin();
      mqttAfterRoomChange();
    } catch (err) {
      const leave = rooms.leaveRoom(socket.id);
      if (leave.leftRoomId) socket.leave(leave.leftRoomId);
      mqttOnLogin();
      mqttAfterRoomChange();
      emitLobbyUpdate();
      socket.emit('room:error', {
        message: (err && err.message) || '创建房间失败',
      });
    }
  });

  socket.on('room:join', (data = {}) => {
    if (!rooms.getPlayer(socket.id)) {
      rooms.registerPlayer(socket.id, data.playerName || '玩家', {
        sessionId: data.sessionId,
        playerTag: data.playerTag,
      });
    } else if (data.sessionId || data.playerTag) {
      rooms.registerPlayer(socket.id, data.playerName || '玩家', {
        sessionId: data.sessionId,
        playerTag: data.playerTag,
      });
    }

    const result = rooms.joinRoom(socket.id, data.roomId);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }

    socket.join(result.room.id);
    joinHallChat(socket);
    const me = rooms.getPlayer(socket.id);
    dropIdleSessionGhosts(me && me.sessionId, socket.id);
    emitRoomUpdate(result.room);
    emitLobbyUpdate();
    mqttOnLogin();
    mqttAfterRoomChange();
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
      emitRoomUpdate(result.room);
    }
    emitLobbyUpdate();
    socket.emit('room:left', {
      reason: result.dissolved ? 'dissolved' : 'left',
      roomId: result.leftRoomId || null,
    });
    mqttOnLogin();
    mqttAfterRoomChange();
  });

  socket.on('game:leave', () => {
    const result = rooms.quitPlaying(socket.id);
    if (result.leftRoomId) {
      socket.leave(result.leftRoomId);
    }
    if (result.abandoned && result.room) {
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
    emitLobbyUpdate();
    mqttOnLogin();
    mqttAfterRoomChange();
  });

  socket.on('room:ready', (data = {}) => {
    const result = rooms.setReady(socket.id, data.ready);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }
    emitRoomUpdate(result.room);
  });

  socket.on('room:start', () => {
    const result = rooms.startGame(socket.id);
    if (!result.ok) {
      socket.emit('room:error', { message: result.error });
      return;
    }
    emitRoomUpdate(result.room);
    emitLobbyUpdate();
    mqttOnLogin();
    mqttAfterRoomChange();
    syncTurnTimer(result.room, { onTimeout: handleTurnTimeout });
    emitGameStarted(result.room);
    scheduleLasidaoInitAnnounce(result.room);
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

    const mod = getGame(room.gameType);
    if (!mod) {
      socket.emit('game:error', { message: '未知游戏类型' });
      return;
    }

    const result = mod.applyAction(room.game, socket.id, {
      type: data.type,
      payload: data.payload,
    });

    if (!result.ok) {
      socket.emit('game:error', { message: result.error });
      return;
    }

    handleAbandonedPlayers(room);
    // 服务端接受的操作视为有效操作，刷新思考时间
    syncTurnTimer(room, { onTimeout: handleTurnTimeout });
    emitGameState(room);
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
    // 对局中断线：标记离线并保留牌局，便于重连；大厅/等待房仍直接离开
    const result = rooms.markOffline(socket.id);
    if (result.leftRoomId && result.room) {
      emitRoomUpdate(result.room);
      if (result.offline && result.room.status === 'playing' && result.room.game) {
        emitGameState(result.room);
      }
    }
    mqttOnLogin();
    if (result.leftRoomId || result.room || result.dissolved) {
      mqttAfterRoomChange();
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
  peekTunnelUrl: () => (tunnel && tunnel.getPublicUrl()) || '',
  onChange: onRosterChange,
  onChat: (msg) => {
    broadcastChatAllLocal(msg);
  },
});

if (mqttBulletin && mqttBulletin.enabled) {
  tunnel = attachTunnelHooks(new QuickTunnel());
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
    console.log(
      `跨网广播: MQTT 已启用（固定地址 broker.emqx.io，频道 ${mqttBulletin.channel}；登录心跳 10s，房间心跳 5s）`
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
  }

  const openFlag = String(process.env.OPEN_BROWSER || '').toLowerCase();
  if (openFlag === '1' || openFlag === 'true' || openFlag === 'yes') {
    openBrowser(localUrl);
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
