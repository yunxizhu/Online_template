'use strict';

const { getGame, resolveGameType } = require('./games');
const {
  normalizeTurnTimeSec,
  clearTurnTimer,
} = require('./turnTimer');

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

function generateRoomId(existingIds) {
  for (let attempt = 0; attempt < 50; attempt++) {
    let id = '';
    for (let i = 0; i < 6; i++) {
      id += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    if (!existingIds.has(id)) return id;
  }
  throw new Error('无法生成唯一房间码');
}

/**
 * 解析创建/修改房间时的游戏·模式·人数·思考时间。
 * @returns {{ ok:true, type, game, modeId, modeLabel, min, max, turnTimeSec }|{ ok:false, error:string }}
 */
function resolveRoomConfig({
  gameType,
  gameMode,
  maxPlayers,
  turnTimeSec,
  occupied = 1,
} = {}) {
  const type = resolveGameType(gameType);
  const game = getGame(type);
  if (!game) return { ok: false, error: '不支持的游戏类型' };

  let modeId = null;
  let modeLabel = null;
  let min = game.minPlayers;
  let max = Math.min(
    game.maxPlayers,
    Math.max(game.minPlayers, Number(maxPlayers) || game.maxPlayers)
  );

  if (game.modes && game.modes.length) {
    const mode = game.modes.find((m) => m.id === gameMode) || game.modes[0];
    modeId = mode.id;
    modeLabel = mode.label;
    if (mode.seats && mode.seats.length) {
      const seat = Number(maxPlayers);
      max = mode.seats.includes(seat) ? seat : mode.seats[0];
      min = max;
    }
  } else {
    modeId = 'standard';
    modeLabel = '标准模式';
  }

  const seatsTaken = Math.max(1, Number(occupied) || 1);
  if (max < seatsTaken) {
    return {
      ok: false,
      error: `人数上限不能小于当前人数（${seatsTaken}）`,
    };
  }

  return {
    ok: true,
    type,
    game,
    modeId,
    modeLabel,
    min,
    max,
    turnTimeSec: normalizeTurnTimeSec(turnTimeSec),
  };
}

function publicRoomView(room) {
  const waiting = !room.status || room.status === 'waiting';
  const playing = room.status === 'playing';
  const over = Boolean(room.game && room.game.over);
  const playerCount = (room.players || []).filter((p) => !p.left).length;
  const observerCount = (room.observers || []).length;
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    playerCount,
    observerCount,
    maxPlayers: room.maxPlayers,
    minPlayers: room.minPlayers,
    status: room.status,
    over,
    gameType: room.gameType,
    gameLabel: room.gameLabel,
    gameMode: room.gameMode || null,
    gameModeLabel: room.gameModeLabel || null,
    turnTimeSec: Number(room.turnTimeSec) || 0,
    playingStartedAt: room.playingStartedAt || null,
    hasPassword: Boolean(room.hasPassword),
    passiveHosted: Boolean(room.passiveHosted),
    canJoin: waiting && playerCount < room.maxPlayers,
    canSpectate: (waiting || playing) && !over,
    playerNames: (room.players || [])
      .filter((p) => !p.left)
      .map((p) => p.name || '玩家'),
    playerTags: (room.players || [])
      .filter((p) => !p.left)
      .map((p) => p.tag || null),
  };
}

function fullRoomView(room) {
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      tag: p.tag || null,
      ready: p.ready,
      offline: Boolean(p.offline),
      left: Boolean(p.left),
    })),
    observers: (room.observers || []).map((p) => ({
      id: p.id,
      name: p.name,
      tag: p.tag || null,
      offline: Boolean(p.offline),
      passiveHost: Boolean(p.passiveHost),
    })),
    status: room.status,
    maxPlayers: room.maxPlayers,
    minPlayers: room.minPlayers,
    gameType: room.gameType,
    gameLabel: room.gameLabel,
    gameMode: room.gameMode || null,
    gameModeLabel: room.gameModeLabel || null,
    turnTimeSec: Number(room.turnTimeSec) || 0,
    playingStartedAt: room.playingStartedAt || null,
    hasPassword: Boolean(room.hasPassword),
    passiveHosted: Boolean(room.passiveHosted),
  };
}

/** 将对局内所有等于 oldId 的玩家引用替换为 newId（含对象键） */
function deepReplacePlayerId(value, oldId, newId, seen = new WeakSet()) {
  if (value === oldId) return newId;
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (value[i] === oldId) value[i] = newId;
      else if (value[i] && typeof value[i] === 'object') {
        deepReplacePlayerId(value[i], oldId, newId, seen);
      }
    }
    return value;
  }
  const keys = Object.keys(value);
  for (const k of keys) {
    if (k === oldId) {
      value[newId] = value[k];
      delete value[k];
      deepReplacePlayerId(value[newId], oldId, newId, seen);
      continue;
    }
    if (value[k] === oldId) value[k] = newId;
    else if (value[k] && typeof value[k] === 'object') {
      deepReplacePlayerId(value[k], oldId, newId, seen);
    }
  }
  return value;
}

class RoomManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.rooms = new Map();
    /** @type {Map<string, { id: string, name: string, roomId: string|null }>} */
    this.players = new Map();
  }

  registerPlayer(playerId, name, opts = {}) {
    const trimmed = String(name || '')
      .trim()
      .replace(/#\d{1,8}\s*$/, '')
      .trim()
      .slice(0, 16) || '玩家';
    const sessionId = opts.sessionId
      ? String(opts.sessionId).slice(0, 64)
      : null;
    const tagRaw = opts.playerTag != null ? opts.playerTag : opts.tag;
    const tag = String(tagRaw || '')
      .replace(/\D/g, '')
      .slice(-5);
    const client = normalizeClient(opts.client);
    const role = normalizeRole(opts.role);
    const existing = this.players.get(playerId);
    if (existing) {
      existing.name = trimmed;
      if (sessionId) existing.sessionId = sessionId;
      if (tag) existing.tag = tag.padStart(5, '0');
      if (client) existing.client = client;
      if (role) existing.role = role;
      this.syncNameToRoom(existing);
      this.syncSessionToRoom(existing);
      return existing;
    }
    const player = {
      id: playerId,
      name: trimmed,
      tag: tag ? tag.padStart(5, '0') : null,
      roomId: null,
      sessionId,
      client: client || null,
      role: role || null,
    };
    this.players.set(playerId, player);
    return player;
  }

  /**
   * Keep room seat list (and in-progress game players) in sync with lobby name.
   * @returns {object|null} room if player is in one
   */
  syncNameToRoom(player) {
    if (!player || !player.roomId) return null;
    const room = this.getRoom(player.roomId);
    if (!room) return null;
    const seat = room.players.find((p) => p.id === player.id);
    if (seat) {
      seat.name = player.name;
      seat.tag = player.tag || null;
    }
    if (Array.isArray(room.observers)) {
      const obs = room.observers.find((o) => o.id === player.id);
      if (obs) {
        obs.name = player.name;
        obs.tag = player.tag || null;
      }
    }
    if (room.game && Array.isArray(room.game.players)) {
      const gp = room.game.players.find((p) => p.id === player.id);
      if (gp) {
        gp.name = player.name;
        gp.tag = player.tag || null;
      }
    }
    return room;
  }

  /** 把 sessionId 写回座位，避免刷新后认领失败 */
  syncSessionToRoom(player) {
    if (!player || !player.roomId || !player.sessionId) return null;
    const room = this.getRoom(player.roomId);
    if (!room) return null;
    const seat = room.players.find((p) => p.id === player.id);
    if (seat) seat.sessionId = player.sessionId;
    return room;
  }

  setPlayerName(playerId, name, opts = {}) {
    const player = this.registerPlayer(playerId, name, opts);
    const room = this.syncNameToRoom(player);
    return { player, room };
  }

  getPlayer(playerId) {
    return this.players.get(playerId) || null;
  }

  getRoom(roomId) {
    if (!roomId) return null;
    return this.rooms.get(String(roomId).toUpperCase()) || null;
  }

  listLobbyRooms() {
    const list = [];
    for (const room of this.rooms.values()) {
      if (room.pendingLobby) continue;
      if (room.status === 'waiting') {
        list.push(publicRoomView(room));
        continue;
      }
      if (room.status === 'playing' && !(room.game && room.game.over)) {
        list.push(publicRoomView(room));
      }
    }
    return list;
  }

  listLobbyPeople() {
    const list = [];
    for (const p of this.players.values()) {
      let status = 'idle';
      let roomName = null;
      let roomId = null;
      let occupied = false;
      if (p.roomId) {
        const room = this.getRoom(p.roomId);
        if (room) {
          const isObs = (room.observers || []).some((o) => o.id === p.id);
          // 被动主机一旦被代开进房（含 pending）：对外占用，禁止他人再代开
          if (p.passive || (room.passiveHosted && isObs)) {
            occupied = true;
            status = 'occupied';
            roomName = room.name;
            roomId = p.roomId;
          } else if (!room.pendingLobby) {
            // 普通玩家：pending 创建中仍显示空闲；公开后显示房间/对局
            if (isObs) status = 'spectating';
            else status = room.status === 'playing' ? 'playing' : 'room';
            roomName = room.name;
            roomId = p.roomId;
          }
        }
      }
      list.push({
        id: p.id,
        name: p.name,
        tag: p.tag || null,
        status,
        roomId,
        roomName,
        sessionId: p.sessionId || null,
        client: p.client || null,
        role: p.role || null,
        passive: Boolean(p.passive),
        occupied,
      });
    }

    // 同 session 幽灵：只留最后一条（后写入覆盖）
    const bySession = new Map();
    const rest = [];
    for (const person of list) {
      if (!person.sessionId) {
        rest.push(person);
        continue;
      }
      bySession.set(person.sessionId, person);
    }
    const deduped = [...bySession.values(), ...rest];
    const byLabel = new Map();
    for (const person of deduped) {
      const label = `${person.name}#${person.tag || ''}`;
      byLabel.set(label, person);
    }
    const unique = [...byLabel.values()];
    unique.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    return unique;
  }

  setPlayerPassive(playerId, on) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, error: '请先进入大厅' };
    if (player.roomId) {
      const room = this.getRoom(player.roomId);
      const isObs =
        room &&
        Array.isArray(room.observers) &&
        room.observers.some((o) => o.id === playerId);
      // 开启被动、或座位玩家：不可切换
      if (!isObs || on) {
        return { ok: false, error: '在房间中无法切换被动模式' };
      }
      // 对局已开始且未结束：不可退出被动
      if (
        room.status === 'playing' &&
        room.game &&
        !room.game.over
      ) {
        return {
          ok: false,
          error: '对局进行中，请等待本局结束后再退出被动模式',
        };
      }
    }
    player.passive = Boolean(on);
    return { ok: true, player, passive: player.passive };
  }

  /**
   * 清理同 sessionId 的大厅幽灵连接（例如换了 host 别名后旧 socket 又自动重连）。
   * 已在房间内的条目不在这里动，交给 tryReclaimSeat。
   */
  evictIdleSessionDuplicates(sessionId, keepId) {
    const sid = sessionId ? String(sessionId).slice(0, 64) : '';
    if (!sid) return [];
    const dropped = [];
    for (const [id, p] of [...this.players.entries()]) {
      if (id === keepId) continue;
      if (!p || p.sessionId !== sid) continue;
      if (p.roomId) continue;
      this.players.delete(id);
      dropped.push(id);
    }
    return dropped;
  }

  createRoom(
    playerId,
    {
      name,
      hasPassword = false,
      password = '',
      maxPlayers,
      gameType,
      gameMode,
      turnTimeSec,
      passiveHost = false,
      operatorId = null,
    } = {}
  ) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, error: '请先进入大厅' };
    if (player.roomId) return { ok: false, error: '你已在房间中，请先离开' };

    const cfg = resolveRoomConfig({
      gameType,
      gameMode,
      maxPlayers,
      turnTimeSec,
      occupied: 1,
    });
    if (!cfg.ok) return cfg;

    const roomName =
      String(name || '').trim().slice(0, 24) ||
      `${player.name}的${cfg.game.label}${cfg.modeLabel ? '·' + cfg.modeLabel : ''}`;
    const id = generateRoomId(this.rooms);
    const usePassword = Boolean(hasPassword);

    const room = {
      id,
      name: roomName,
      hasPassword: usePassword,
      // 仅服务端保存；对外只暴露 hasPassword
      password: usePassword ? String(password == null ? '' : password).slice(0, 32) : '',
      hostId: playerId,
      players: [
        {
          id: playerId,
          name: player.name,
          tag: player.tag || null,
          ready: true,
          sessionId: player.sessionId || null,
        },
      ],
      observers: [],
      status: 'waiting',
      maxPlayers: cfg.max,
      minPlayers: cfg.min,
      gameType: cfg.type,
      gameLabel: cfg.game.label,
      gameMode: cfg.modeId,
      gameModeLabel: cfg.modeLabel,
      turnTimeSec: cfg.turnTimeSec,
      turnTimer: null,
      game: null,
      createdAt: Date.now(),
      playingStartedAt: null,
      // 隧道就绪并房主进房前：不进大厅列表、人员仍显示空闲、不广播房间
      pendingLobby: true,
      passiveHosted: Boolean(passiveHost),
    };

    this.rooms.set(id, room);
    player.roomId = id;
    player.passive = false;

    // 被动开房：本机主机进观战席（不占玩家位），且保持被动标记——无人值守锁屏
    const opId = operatorId || null;
    if (passiveHost && opId && opId !== playerId) {
      const op = this.players.get(opId);
      if (op && !op.roomId) {
        room.observers.push({
          id: opId,
          name: op.name,
          tag: op.tag || null,
          sessionId: op.sessionId || null,
          passiveHost: true,
        });
        op.roomId = id;
        op.passive = true;
      }
    }

    return { ok: true, room };
  }

  /**
   * 房主在等待室内修改房间信息（立刻生效并应配合 emit + MQTT 重发）。
   */
  updateSettings(
    playerId,
    { name, hasPassword, password, maxPlayers, gameType, gameMode, turnTimeSec } = {}
  ) {
    const player = this.players.get(playerId);
    if (!player || !player.roomId) {
      return { ok: false, error: '你不在房间中' };
    }
    const room = this.getRoom(player.roomId);
    if (!room) return { ok: false, error: '房间不存在' };
    if (room.hostId !== playerId) {
      return { ok: false, error: '只有房主可以修改房间信息' };
    }
    if (room.status !== 'waiting') {
      return { ok: false, error: '对局已开始，无法修改房间信息' };
    }

    const cfg = resolveRoomConfig({
      gameType: gameType != null ? gameType : room.gameType,
      gameMode: gameMode != null ? gameMode : room.gameMode,
      maxPlayers: maxPlayers != null ? maxPlayers : room.maxPlayers,
      turnTimeSec: turnTimeSec != null ? turnTimeSec : room.turnTimeSec,
      occupied: (room.players || []).filter((p) => !p.left).length,
    });
    if (!cfg.ok) return cfg;

    const trimmed = String(name != null ? name : room.name || '')
      .trim()
      .slice(0, 24);
    room.name =
      trimmed ||
      `${player.name}的${cfg.game.label}${cfg.modeLabel ? '·' + cfg.modeLabel : ''}`;
    if (hasPassword != null) {
      const usePassword = Boolean(hasPassword);
      room.hasPassword = usePassword;
      if (usePassword) {
        if (password != null) {
          room.password = String(password).slice(0, 32);
        }
      } else {
        room.password = '';
      }
    } else if (password != null && room.hasPassword) {
      room.password = String(password).slice(0, 32);
    }
    room.maxPlayers = cfg.max;
    room.minPlayers = cfg.min;
    room.gameType = cfg.type;
    room.gameLabel = cfg.game.label;
    room.gameMode = cfg.modeId;
    room.gameModeLabel = cfg.modeLabel;
    room.turnTimeSec = cfg.turnTimeSec;

    return { ok: true, room };
  }

  /** 创建流程完成：对外公开房间（大厅列表 / 人员状态 / MQTT） */
  clearPendingLobby(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    room.pendingLobby = false;
    return room;
  }

  /** 密码仅存本机；对外校验。无密码房直接通过。 */
  checkRoomPassword(roomId, password) {
    const room = this.getRoom(roomId);
    if (!room) return { ok: false, error: '房间不存在' };
    if (!room.hasPassword) {
      return { ok: true, room, needsPassword: false };
    }
    const got = String(password == null ? '' : password);
    const want = String(room.password == null ? '' : room.password);
    if (got !== want) {
      return { ok: false, error: '房间密码错误', needsPassword: true };
    }
    return { ok: true, room, needsPassword: true };
  }

  joinRoom(playerId, roomId, { password } = {}) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, error: '请先进入大厅' };
    const wantId = String(roomId || '').toUpperCase();
    if (player.roomId) {
      // 重复点击加入：已在目标房则直接成功，避免「要点两次」的错觉
      if (String(player.roomId).toUpperCase() === wantId) {
        const room = this.getRoom(player.roomId);
        return room
          ? { ok: true, room, already: true }
          : { ok: false, error: '房间不存在' };
      }
      return { ok: false, error: '你已在房间中，请先离开' };
    }

    const auth = this.checkRoomPassword(roomId, password);
    if (!auth.ok) return auth;
    const room = auth.room;
    if (room.status !== 'waiting') return { ok: false, error: '对局已开始，无法加入（可观战）' };
    const seated = (room.players || []).filter((p) => !p.left).length;
    if (seated >= room.maxPlayers) return { ok: false, error: '房间已满' };

    room.players.push({
      id: playerId,
      name: player.name,
      tag: player.tag || null,
      ready: true,
      sessionId: player.sessionId || null,
    });
    player.roomId = room.id;
    player.passive = false;
    return { ok: true, room };
  }

  /** 观战：等待房/对局中均可，不占玩家席 */
  spectateRoom(playerId, roomId, { password } = {}) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, error: '请先进入大厅' };
    const wantId = String(roomId || '').toUpperCase();
    if (player.roomId) {
      if (String(player.roomId).toUpperCase() === wantId) {
        const room = this.getRoom(player.roomId);
        return room
          ? { ok: true, room, already: true, asSpectator: true }
          : { ok: false, error: '房间不存在' };
      }
      return { ok: false, error: '你已在房间中，请先离开' };
    }
    const auth = this.checkRoomPassword(roomId, password);
    if (!auth.ok) return auth;
    const room = auth.room;
    if (room.status !== 'waiting' && room.status !== 'playing') {
      return { ok: false, error: '房间不可观战' };
    }
    if (!Array.isArray(room.observers)) room.observers = [];
    if (room.observers.some((o) => o.id === playerId)) {
      player.roomId = room.id;
      return { ok: true, room, already: true, asSpectator: true };
    }
    room.observers.push({
      id: playerId,
      name: player.name,
      tag: player.tag || null,
      sessionId: player.sessionId || null,
    });
    player.roomId = room.id;
    player.passive = false;
    return { ok: true, room, asSpectator: true };
  }

  /**
   * 解散房间（用于被动主机退出被动模式等）。
   * @returns {{ ok: boolean, dissolved: boolean, leftRoomId: string|null, affectedPlayerIds: string[] }}
   */
  dissolveRoom(roomId, initiatorId = null) {
    const room = this.getRoom(roomId);
    if (!room) {
      return {
        ok: true,
        dissolved: false,
        leftRoomId: null,
        affectedPlayerIds: [],
      };
    }
    const leftRoomId = room.id;
    const affectedPlayerIds = [
      ...room.players.map((p) => p.id),
      ...(room.observers || []).map((o) => o.id),
    ].filter((id) => id && id !== initiatorId);
    for (const memberId of [
      ...affectedPlayerIds,
      ...(initiatorId ? [initiatorId] : []),
    ]) {
      const member = this.players.get(memberId);
      if (member) member.roomId = null;
    }
    clearTurnTimer(room);
    this.rooms.delete(room.id);
    return {
      ok: true,
      dissolved: true,
      leftRoomId,
      affectedPlayerIds,
    };
  }

  leaveRoom(playerId, { abortPlaying = true } = {}) {
    const player = this.players.get(playerId);
    if (!player || !player.roomId) {
      return {
        ok: true,
        room: null,
        dissolved: false,
        leftRoomId: null,
        affectedPlayerIds: [],
      };
    }

    const room = this.getRoom(player.roomId);
    const leftRoomId = player.roomId;
    player.roomId = null;

    if (!room) {
      return {
        ok: true,
        room: null,
        dissolved: false,
        leftRoomId,
        affectedPlayerIds: [],
      };
    }

    // 观战席离开：不解散房间
    if (!Array.isArray(room.observers)) room.observers = [];
    const wasObserver = room.observers.some((o) => o.id === playerId);
    if (wasObserver) {
      room.observers = room.observers.filter((o) => o.id !== playerId);
      if (
        room.players.filter((p) => !p.left).length === 0 &&
        room.observers.length === 0
      ) {
        clearTurnTimer(room);
        this.rooms.delete(room.id);
        return {
          ok: true,
          room: null,
          dissolved: true,
          leftRoomId,
          affectedPlayerIds: [],
        };
      }
      return {
        ok: true,
        room,
        dissolved: false,
        leftRoomId,
        affectedPlayerIds: [],
      };
    }

    // 逻辑房主主动离开：解散整个房间
    if (room.hostId === playerId) {
      const affectedPlayerIds = [
        ...room.players.filter((p) => p.id !== playerId).map((p) => p.id),
        ...room.observers.map((o) => o.id),
      ];
      for (const memberId of affectedPlayerIds) {
        const member = this.players.get(memberId);
        if (member) member.roomId = null;
      }
      clearTurnTimer(room);
      this.rooms.delete(room.id);
      return {
        ok: true,
        room: null,
        dissolved: true,
        leftRoomId,
        affectedPlayerIds,
      };
    }

    room.players = room.players.filter((p) => p.id !== playerId);

    if (
      room.players.filter((p) => !p.left).length === 0 &&
      room.observers.length === 0
    ) {
      clearTurnTimer(room);
      this.rooms.delete(room.id);
      return {
        ok: true,
        room: null,
        dissolved: true,
        leftRoomId,
        affectedPlayerIds: [],
      };
    }

    // 主动离开才中止对局；断线走 markOffline，不在这里清 game
    if (abortPlaying && room.status === 'playing') {
      clearTurnTimer(room);
      room.status = 'waiting';
      room.game = null;
      room.playingStartedAt = null;
      for (const p of room.players) {
        p.ready = true;
        p.offline = false;
      }
    }

    return {
      ok: true,
      room,
      dissolved: false,
      leftRoomId,
      affectedPlayerIds: [],
    };
  }

  /**
   * 对局中主动退出：座位保留并标记已离开，按各游戏规则处理；本人回大厅。
   * 等待房仍走 leaveRoom（房主离开会解散）。
   */
  quitPlaying(playerId) {
    const player = this.players.get(playerId);
    if (!player || !player.roomId) {
      return {
        ok: true,
        abandoned: false,
        dissolved: false,
        room: null,
        leftRoomId: null,
        playerName: null,
        playerTag: null,
      };
    }
    const room = this.getRoom(player.roomId);
    if (!room || room.status !== 'playing' || !room.game) {
      return this.leaveRoom(playerId);
    }

    // 观战中途退出：不走「座位留下」逻辑
    if (
      Array.isArray(room.observers) &&
      room.observers.some((o) => o.id === playerId)
    ) {
      return this.leaveRoom(playerId, { abortPlaying: false });
    }

    const seat = room.players.find((p) => p.id === playerId);
    const playerName = (seat && seat.name) || player.name || '玩家';
    const playerTag = (seat && seat.tag) || player.tag || null;
    if (seat) {
      seat.left = true;
      seat.leftAt = Date.now();
      seat.offline = false;
      delete seat.offlineAt;
    }
    if (room.game && Array.isArray(room.game.players)) {
      const gp = room.game.players.find((p) => p.id === playerId);
      if (gp) gp.left = true;
    }
    if (room.game && Array.isArray(room.game.log)) {
      room.game.log.push({ at: Date.now(), text: `${playerName} 离开了游戏` });
    }

    const leftRoomId = player.roomId;
    player.roomId = null;

    const stillHere = room.players.filter((p) => !p.left);
    if (!stillHere.length) {
      clearTurnTimer(room);
      this.rooms.delete(room.id);
      return {
        ok: true,
        abandoned: true,
        dissolved: true,
        room: null,
        leftRoomId,
        playerName,
        playerTag,
      };
    }

    return {
      ok: true,
      abandoned: true,
      dissolved: false,
      room,
      leftRoomId,
      playerName,
      playerTag,
    };
  }

  /**
   * 短暂断线：对局中或等待房保留座位；其它情况直接离开。
   */
  markOffline(playerId) {
    const player = this.players.get(playerId);
    if (!player) {
      return { ok: true, room: null, leftRoomId: null, offline: false };
    }
    if (!player.roomId) {
      this.players.delete(playerId);
      return { ok: true, room: null, leftRoomId: null, offline: false };
    }

    const room = this.getRoom(player.roomId);
    // 观战席断线：直接离席（不占位、不触发房主解散）
    if (
      room &&
      Array.isArray(room.observers) &&
      room.observers.some((o) => o.id === playerId)
    ) {
      const leave = this.leaveRoom(playerId, { abortPlaying: false });
      this.players.delete(playerId);
      return { ...leave, offline: false };
    }
    const keepSeat =
      room &&
      (room.status === 'waiting' ||
        (room.status === 'playing' && room.game));
    if (!keepSeat) {
      const leave = this.leaveRoom(playerId, { abortPlaying: true });
      this.players.delete(playerId);
      return { ...leave, offline: false };
    }

    const seat = room.players.find((p) => p.id === playerId);
    if (seat && seat.left) {
      this.players.delete(playerId);
      return {
        ok: true,
        room,
        leftRoomId: room.id,
        offline: false,
        abandoned: true,
      };
    }
    if (seat) {
      seat.offline = true;
      seat.offlineAt = Date.now();
      seat.sessionId = player.sessionId || seat.sessionId || null;
    }
    // 从在线表移除，但座位仍挂在房间里（id 暂时仍是旧 socket）
    this.players.delete(playerId);
    return {
      ok: true,
      room,
      dissolved: false,
      leftRoomId: room.id,
      offline: true,
    };
  }

  /**
   * 认领座位。优先用旧用户 id（seatId）强匹配，再退回 sessionId / 昵称。
   */
  tryReclaimSeat(
    newSocketId,
    playerName,
    sessionId,
    roomIdHint,
    oldPlayerId = null,
    playerTag = null
  ) {
    const name = String(playerName || '')
      .trim()
      .replace(/#\d{1,8}\s*$/, '')
      .trim()
      .slice(0, 16);
    const sid = sessionId ? String(sessionId).slice(0, 64) : '';
    const hint = roomIdHint ? String(roomIdHint).toUpperCase() : '';
    const savedSeatId = oldPlayerId ? String(oldPlayerId) : '';
    const tagDigits = String(playerTag || '')
      .replace(/\D/g, '')
      .slice(-5);
    const tag = tagDigits ? tagDigits.padStart(5, '0') : '';
    if (!name && !sid && !hint && !savedSeatId) return null;

    const reclaimableRooms = [];
    if (hint) {
      const preferred = this.getRoom(hint);
      if (
        preferred &&
        (preferred.status === 'waiting' ||
          (preferred.status === 'playing' && preferred.game))
      ) {
        reclaimableRooms.push(preferred);
      }
    }
    for (const room of this.rooms.values()) {
      if (reclaimableRooms.includes(room)) continue;
      const reclaimable =
        room.status === 'waiting' ||
        (room.status === 'playing' && room.game);
      if (reclaimable) reclaimableRooms.push(room);
    }

    const sameNick = (p) => {
      if (!p || p.name !== name) return false;
      if (tag && p.tag) return p.tag === tag;
      if (tag && !p.tag) return false;
      return true;
    };

    const bindSeat = (room, seat) => {
      const fromId = seat.id;
      if (tag) seat.tag = tag;
      if (fromId === newSocketId) {
        seat.offline = false;
        delete seat.offlineAt;
        if (sid) seat.sessionId = sid;
        const player = {
          id: newSocketId,
          name: seat.name || name || '玩家',
          tag: seat.tag || tag || null,
          roomId: room.id,
          sessionId: sid || seat.sessionId || null,
        };
        this.players.set(newSocketId, player);
        return { room, oldId: fromId, reclaimed: true };
      }
      if (fromId && this.players.has(fromId)) {
        this.players.delete(fromId);
      }
      this.rebindSeatId(room, fromId, newSocketId);
      seat.offline = false;
      delete seat.offlineAt;
      if (sid) seat.sessionId = sid;
      const player = {
        id: newSocketId,
        name: seat.name || name || '玩家',
        tag: seat.tag || tag || null,
        roomId: room.id,
        sessionId: sid || seat.sessionId || null,
      };
      this.players.set(newSocketId, player);
      return { room, oldId: fromId, reclaimed: true };
    };

    // 1) 用户 id 强匹配（本地存档的旧 seatId / socket.id）
    if (savedSeatId) {
      for (const room of reclaimableRooms) {
        const seat = (room.players || []).find((p) => p.id === savedSeatId);
        if (seat && !seat.left) return bindSeat(room, seat);
      }
    }

    for (const room of reclaimableRooms) {
      let seat = null;
      if (sid) {
        seat = room.players.find(
          (p) => p.sessionId && p.sessionId === sid
        );
      }
      if (!seat && hint && room.id === hint && name) {
        const matches = room.players.filter(
          (p) => p.offline && sameNick(p)
        );
        if (matches.length === 1) seat = matches[0];
        if (!seat) {
          const byName = room.players.filter((p) => sameNick(p));
          if (byName.length === 1) seat = byName[0];
        }
      }
      if (!seat && name) {
        const matches = room.players.filter(
          (p) => p.offline && sameNick(p)
        );
        if (matches.length === 1) seat = matches[0];
      }
      if (!seat && hint && room.id === hint) {
        const offlines = room.players.filter((p) => p.offline);
        if (offlines.length === 1) seat = offlines[0];
      }
      if (!seat || seat.left) continue;
      return bindSeat(room, seat);
    }

    return null;
  }

  rebindSeatId(room, oldId, newId) {
    if (!room || !oldId || !newId || oldId === newId) return;
    const seat = room.players.find((p) => p.id === oldId);
    if (seat) seat.id = newId;
    if (Array.isArray(room.observers)) {
      const obs = room.observers.find((o) => o.id === oldId);
      if (obs) obs.id = newId;
    }
    if (room.hostId === oldId) room.hostId = newId;
    if (room.game) {
      deepReplacePlayerId(room.game, oldId, newId);
    }
    if (room.turnTimer && Array.isArray(room.turnTimer.actorIds)) {
      room.turnTimer.actorIds = room.turnTimer.actorIds.map((id) =>
        id === oldId ? newId : id
      );
    }
  }

  setReady(playerId, ready) {
    const player = this.players.get(playerId);
    if (!player || !player.roomId) return { ok: false, error: '你不在房间中' };

    const room = this.getRoom(player.roomId);
    if (!room) return { ok: false, error: '房间不存在' };
    if (room.status !== 'waiting') return { ok: false, error: '对局进行中无法改准备状态' };

    const member = room.players.find((p) => p.id === playerId);
    if (!member) return { ok: false, error: '你不在房间中' };

    member.ready = Boolean(ready);
    return { ok: true, room };
  }

  canStart(room) {
    if (!room || room.status !== 'waiting') return false;
    const game = getGame(room.gameType);
    const min = game ? game.minPlayers : 2;
    const seated = (room.players || []).filter((p) => !p.left).length;
    if (seated < min) return false;
    if (game && seated > game.maxPlayers) return false;
    // 进房即视为准备，人齐即可开局（观战不计入）
    return true;
  }

  startGame(playerId) {
    const player = this.players.get(playerId);
    if (!player || !player.roomId) return { ok: false, error: '你不在房间中' };

    const room = this.getRoom(player.roomId);
    if (!room) return { ok: false, error: '房间不存在' };
    if (room.hostId !== playerId) return { ok: false, error: '只有房主可以开始游戏' };
    if (!this.canStart(room)) {
      const game = getGame(room.gameType);
      const min = game ? game.minPlayers : 2;
      const seated = (room.players || []).filter((p) => !p.left).length;
      return {
        ok: false,
        error: `至少需要 ${min} 人才能开始（当前 ${seated} 人，不含观战）`,
      };
    }

    const game = getGame(room.gameType);
    if (!game) return { ok: false, error: '不支持的游戏类型' };

    room.status = 'playing';
    room.playingStartedAt = Date.now();
    try {
      room.game = game.createGameState(room);
    } catch (err) {
      room.status = 'waiting';
      room.playingStartedAt = null;
      return { ok: false, error: err.message || '开局失败' };
    }
    return { ok: true, room, gameModule: game };
  }

  removePlayer(playerId) {
    const leave = this.leaveRoom(playerId);
    this.players.delete(playerId);
    return leave;
  }
}

module.exports = {
  RoomManager,
  publicRoomView,
  fullRoomView,
};
