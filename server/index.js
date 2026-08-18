'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { RoomManager, fullRoomView } = require('./rooms');
const { listGames, getGame } = require('./games');
const { syncTurnTimer, clearTurnTimer } = require('./turnTimer');
const {
  LanDiscovery,
  listLanIPv4,
  pickPrimaryLanIP,
} = require('./discovery');
const { MqttBulletin } = require('./mqttBulletin');
const { QuickTunnel } = require('./tunnel');
const crypto = require('crypto');
const pathRoot = path.join(__dirname, '..');

const PORT = Number(process.env.PORT) || 3000;
const INSTANCE_ID = crypto.randomUUID();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // 本机多开/后台标签页定时器被节流时，适当放宽避免误断线
  pingInterval: 25000,
  pingTimeout: 60000,
});

const rooms = new RoomManager();
let discovery = null;
let mqttBulletin = null;
let tunnel = null;
let hostDisplayName = '';

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
  return [...rooms.rooms.values()].map((room) => ({
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

/** 多源合并：靠后的源覆盖 host（房间统一走公网隧道） */
function mergeRemoteSources(groups, keyFn) {
  const map = new Map();
  for (const group of groups || []) {
    const viaDefault = group.via || 'remote';
    for (const item of group.items || []) {
      const key = keyFn(item);
      const via = item.via || viaDefault;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...item, via });
        continue;
      }
      const vias = new Set(
        String(prev.via || '')
          .split(/[+|,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      );
      vias.add(via);
      map.set(key, {
        ...item,
        via: [...vias].join('+'),
        publicHost: prev.publicHost || prev.host,
      });
    }
  }
  return [...map.values()];
}

function buildLobbyPayload() {
  const localHost = localBaseUrl();
  const localRooms = rooms.listLobbyRooms().map((room) => ({
    ...room,
    host: localHost,
    local: true,
  }));

  const remoteRooms = mergeRemoteSources(
    [
      {
        items: mqttBulletin ? mqttBulletin.getPublicRooms() : [],
        via: 'mqtt',
      },
    ],
    (r) => `${r.instanceId || r.creatorId || ''}:${r.id}`
  );

  const peers = mergeRemoteSources(
    [
      {
        items: mqttBulletin ? mqttBulletin.getOnlinePeers() : [],
        via: 'mqtt',
      },
    ],
    (p) => p.instanceId
  );

  const localPeople = rooms.listLobbyPeople().map((p) => ({
    ...p,
    local: true,
    host: localHost,
  }));
  const remotePeople = mergeRemoteSources(
    [
      {
        items: mqttBulletin ? mqttBulletin.getRemotePeople() : [],
        via: 'mqtt',
      },
    ],
    (p) => p.id
  );
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

/** 合并本机+局域网人员：同 session 只保留一条，优先「对局/房间」且偏本机 */
function mergeLobbyPeople(localPeople, remotePeople) {
  const rank = (status) => {
    if (status === 'playing') return 3;
    if (status === 'room') return 2;
    return 1;
  };
  const labelKey = (person) => {
    const name = String(person && person.name ? person.name : '').trim();
    const tag = String(person && person.tag ? person.tag : '').trim();
    return `${name}#${tag}`;
  };
  const byKey = new Map();

  const put = (person) => {
    if (!person) return;
    const key = person.sessionId
      ? `sid:${person.sessionId}`
      : person.local === false
        ? `remote:${person.instanceId || ''}:${labelKey(person) || (person.socketId || person.id)}`
        : `local:${person.id}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, person);
      return;
    }
    const betterStatus = rank(person.status) > rank(prev.status);
    const sameStatusPreferLocal =
      rank(person.status) === rank(prev.status) &&
      person.local === true &&
      prev.local === false;
    if (betterStatus || sameStatusPreferLocal) byKey.set(key, person);
  };

  for (const p of localPeople || []) put(p);
  for (const p of remotePeople || []) put(p);

  // 无 session 时的兜底：只要某昵称已经以「房间中/对局中」出现，
  // 就丢掉同名的「空闲」残影（常见于 MQTT 仅知道登录在线、不知道已进房）
  const busyNames = new Set(
    [...byKey.values()]
      .filter((p) => rank(p.status) >= 2)
      .map((p) => String(p.name || ''))
  );
  for (const [key, person] of [...byKey.entries()]) {
    if (rank(person.status) === 1) {
      if (busyNames.has(String(person.name || ''))) byKey.delete(key);
    }
  }

  // 终合并：远端同一实例的同名同尾缀人物，LAN / MQTT 只保留一条
  const collapsed = new Map();
  const sourceRank = (person) => {
    const via = String((person && person.via) || '');
    if (via.includes('lan')) return 3;
    if (via.includes('mqtt')) return 1;
    return 0;
  };
  for (const person of byKey.values()) {
    if (!person || person.local !== false) {
      collapsed.set(`local:${person && person.id ? person.id : Math.random()}`, person);
      continue;
    }
    const key = `remote:${person.instanceId || ''}:${labelKey(person)}`;
    const prev = collapsed.get(key);
    if (!prev) {
      collapsed.set(key, person);
      continue;
    }
    const betterStatus = rank(person.status) > rank(prev.status);
    const sameStatusBetterSource =
      rank(person.status) === rank(prev.status) &&
      sourceRank(person) > sourceRank(prev);
    if (betterStatus || sameStatusBetterSource) collapsed.set(key, person);
  }

  return [...collapsed.values()].sort((a, b) =>
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

function syncDiscoveryPresence() {
  const hasLobbyPlayers = rooms.players.size > 0;
  if (discovery) {
    discovery.setAdvertising(hasLobbyPlayers);
    if (hasLobbyPlayers) discovery.broadcastNow();
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
  if (mqttBulletin && mqttBulletin.enabled) mqttBulletin.touchLogin().catch(() => {});
}

function mqttAfterRoomChange() {
  if (mqttBulletin && mqttBulletin.enabled) mqttBulletin.touchRoom().catch(() => {});
}

async function ensurePublicTunnelUrl() {
  if (!tunnel) tunnel = new QuickTunnel();
  return tunnel.ensure(PORT);
}

function emitLobbyUpdate() {
  io.emit('lobby:update', buildLobbyPayload());
  if (discovery) discovery.broadcastNow();
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
  if (discovery) discovery.broadcastNow();
}

function publicStateForRoom(room, viewerId) {
  const mod = getGame(room.gameType);
  if (!mod || !room.game) return null;
  const state = mod.publicGameState(room.game, viewerId);
  if (state && room.turnTimer) {
    state.turnTimer = {
      actorIds: room.turnTimer.actorIds.slice(),
      deadline: room.turnTimer.deadline,
      limitSec: room.turnTimer.limitSec,
    };
  }
  return state;
}

function emitGameState(room) {
  if (!room) return;
  for (const p of room.players) {
    if (p.offline) continue;
    io.to(p.id).emit('game:state', {
      state: publicStateForRoom(room, p.id),
    });
  }
}

function emitGameStarted(room) {
  if (!room) return;
  for (const p of room.players) {
    if (p.offline) continue;
    io.to(p.id).emit('game:started', {
      state: publicStateForRoom(room, p.id),
    });
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
      socket.data.playerName = player.name;
      hostDisplayName = player.name;
      mqttOnLogin();
      syncDiscoveryPresence();
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
      if (data.playerName) hostDisplayName = player.name;
      if (data.playerName) mqttOnLogin();
      syncDiscoveryPresence();
      emitLobbyUpdate();
      emitPlayerMe(socket, player, data.playerName);
      socket.emit('session:reclaim-failed', {
        roomId: roomIdHint,
        message: '未能认领原座位，房间可能已解散或座位已被占用',
      });
      return;
    }

    // 清掉同 session 仍停在大厅的旧连接（localhost / 局域网 IP 双连）
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
    if (data.playerName) hostDisplayName = player.name;
    if (data.playerName) mqttOnLogin();
    syncDiscoveryPresence();
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
    const found =
      (discovery && discovery.resolveRoom(roomId)) ||
      (mqttBulletin && mqttBulletin.resolveRoom(roomId)) ||
      null;
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
    if (discovery) discovery.broadcastNow();
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
    hostDisplayName = player.name;
    mqttOnLogin();
    emitPlayerMe(socket, player, data.playerName);
    if (room) {
      emitRoomUpdate(room);
      if (room.status === 'playing' && room.game) emitGameState(room);
    }
    syncDiscoveryPresence();
    emitLobbyUpdate();
  });

  socket.on('discovery:resolve', (data = {}) => {
    const roomId = String(data.roomId || '').toUpperCase();
    const local = rooms.getRoom(roomId);
    if (local) {
      socket.emit('discovery:resolved', {
        ok: true,
        host: localBaseUrl(),
        roomId: local.id,
        local: true,
      });
      return;
    }

    const found = mqttBulletin ? mqttBulletin.resolveRoom(roomId) : null;
    if (!found) {
      socket.emit('discovery:resolved', {
        ok: false,
        message:
          mqttBulletin && mqttBulletin.enabled
            ? '未找到该房间码（对方需在线；跨网请确认 MQTT 广播心跳正常）'
            : '未找到该房间码',
      });
      return;
    }

    socket.emit('discovery:resolved', {
      ok: true,
      host: found.host,
      roomId: found.room.id,
      local: false,
      via: found.via || 'mqtt',
    });
  });

  socket.on('room:create', (data = {}) => {
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

    socket.join(result.room.id);
    const me = rooms.getPlayer(socket.id);
    dropIdleSessionGhosts(me && me.sessionId, socket.id);
    emitRoomUpdate(result.room);
    emitLobbyUpdate();
    mqttAfterRoomChange();
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
    const me = rooms.getPlayer(socket.id);
    dropIdleSessionGhosts(me && me.sessionId, socket.id);
    emitRoomUpdate(result.room);
    emitLobbyUpdate();
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
      io.to(otherId).emit('room:left', {});
    }
    if (result.room) {
      emitRoomUpdate(result.room);
    }
    emitLobbyUpdate();
    socket.emit('room:left', {});
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
    syncTurnTimer(result.room, { onTimeout: handleTurnTimeout });
    emitGameStarted(result.room);
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

    // 服务端接受的操作视为有效操作，刷新思考时间
    syncTurnTimer(room, { onTimeout: handleTurnTimeout });
    emitGameState(room);
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
    if (rooms.players.size === 0) {
      hostDisplayName = '';
    } else {
      const first = [...rooms.players.values()][0];
      if (first) hostDisplayName = first.name;
    }
    syncDiscoveryPresence();
    emitLobbyUpdate();
  });
});

function onRosterChange() {
  io.emit('lobby:update', buildLobbyPayload());
}

discovery = new LanDiscovery({
  httpPort: PORT,
  instanceId: INSTANCE_ID,
  getBeaconPayload: () => ({
    displayName: hostDisplayName,
    rooms: beaconRooms(),
    people: rooms.listLobbyPeople(),
  }),
  onChange: onRosterChange,
});

mqttBulletin = new MqttBulletin({
  rootDir: pathRoot,
  instanceId: INSTANCE_ID,
  getDisplayName: () => hostDisplayName || '',
  getDisplayTag: () => {
    const first = [...rooms.players.values()][0];
    return (first && first.tag) || null;
  },
  getHostedRooms: () => hostedBeaconRooms(),
  ensureTunnelUrl: ensurePublicTunnelUrl,
  onChange: onRosterChange,
});

if (mqttBulletin && mqttBulletin.enabled) {
  tunnel = new QuickTunnel();
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
  try {
    if (discovery) discovery.stop();
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
  const ips = listLanIPv4();
  const localUrl = `http://localhost:${PORT}`;
  console.log(`联机服务已启动: ${localUrl}`);
  if (ips.length) {
    console.log(`局域网地址: ${ips.map((ip) => `http://${ip}:${PORT}`).join(', ')}`);
  }
  console.log('局域网发现：进入大厅后才会对外广播；可发现其他已进大厅的实例');
  if (mqttBulletin && mqttBulletin.enabled) {
    console.log(
      `跨网广播: MQTT 已启用（固定地址 broker.emqx.io，频道 ${mqttBulletin.channel}；登录心跳 10s，房间心跳 5s）`
    );
  }
  if (!(mqttBulletin && mqttBulletin.enabled)) {
    console.log('跨网: MQTT 广播已关闭，仅局域网可用（创建 mqtt.off 可关闭）');
  }
  console.log('可选游戏:', listGames().map((g) => g.label).join(', '));
  discovery.start();
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
