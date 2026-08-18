'use strict';

/**
 * 昵称尾缀：本地固定分配 #12345，对他人可见但置灰展示。
 */
window.PlayerNick = (function () {
  const TAG_KEY = 'lianji.playerTag';

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeTag(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length >= 5) return digits.slice(-5);
    if (digits.length > 0) return digits.padStart(5, '0');
    return '';
  }

  function ensureTag() {
    try {
      let tag = normalizeTag(localStorage.getItem(TAG_KEY));
      if (!tag) {
        tag = String(10000 + Math.floor(Math.random() * 90000));
        localStorage.setItem(TAG_KEY, tag);
      } else if (localStorage.getItem(TAG_KEY) !== tag) {
        localStorage.setItem(TAG_KEY, tag);
      }
      return tag;
    } catch (_) {
      return String(10000 + Math.floor(Math.random() * 90000));
    }
  }

  /** 输入框只用纯昵称，去掉历史粘贴的 #尾缀 */
  function stripBaseName(name) {
    return String(name || '')
      .trim()
      .replace(/#\d{1,8}\s*$/, '')
      .trim()
      .slice(0, 16);
  }

  function fullLabel(name, tag) {
    const base = stripBaseName(name) || '玩家';
    const t = normalizeTag(tag);
    return t ? `${base}#${t}` : base;
  }

  /** 名字白色 + 尾缀置灰 */
  function formatHtml(name, tag) {
    const base = stripBaseName(name) || '玩家';
    const t = normalizeTag(tag);
    if (!t) return `<span class="nick-base">${escapeHtml(base)}</span>`;
    return (
      `<span class="nick-base">${escapeHtml(base)}</span>` +
      `<span class="nick-tag">#${escapeHtml(t)}</span>`
    );
  }

  return {
    TAG_KEY,
    escapeHtml,
    normalizeTag,
    ensureTag,
    stripBaseName,
    fullLabel,
    formatHtml,
  };
})();

/**
 * Socket.IO client: can switch host when joining a LAN-discovered room.
 */
window.GameNet = (function () {
  let socket = null;
  let currentUrl = null;
  const localOrigin = window.location.origin;
  const handlers = {};

  function on(event, fn) {
    if (!handlers[event]) handlers[event] = [];
    handlers[event].push(fn);
  }

  function emitLocal(event, data) {
    const list = handlers[event] || [];
    for (const fn of list) fn(data);
  }

  function normalizeUrl(url) {
    const u = new URL(url, window.location.href);
    return u.origin;
  }

  function bindServerEvents(s) {
    const events = [
      'lobby:update',
      'player:me',
      'session:reclaimed',
      'session:reclaim-failed',
      'room:update',
      'room:error',
      'room:left',
      'room:probe-result',
      'game:started',
      'game:state',
      'game:error',
      'discovery:resolved',
    ];
    for (const event of events) {
      s.on(event, (data) => emitLocal(event, data));
    }
    s.on('connect', () => emitLocal('connect', { url: currentUrl }));
    s.on('disconnect', () => emitLocal('disconnect', {}));
  }

  function connect(url) {
    const target = normalizeUrl(url || localOrigin);
    if (socket && currentUrl === target && socket.connected) {
      return Promise.resolve(socket);
    }
    return reconnect(target);
  }

  function reconnect(url) {
    const target = normalizeUrl(url);
    return new Promise((resolve, reject) => {
      if (socket) {
        // 换源前禁止旧连接自动重连，否则会出现「大厅幽灵 + 房间本人」双人影
        try {
          if (socket.io) socket.io.reconnection(false);
        } catch (_) {
          /* ignore */
        }
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
      }

      currentUrl = target;
      const s = io(target, {
        autoConnect: true,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5000,
        timeout: 20000,
      });
      socket = s;
      bindServerEvents(s);

      const onErr = (err) => {
        cleanup();
        reject(err || new Error('连接失败: ' + target));
      };
      const onOk = () => {
        cleanup();
        resolve(s);
      };
      const cleanup = () => {
        s.off('connect', onOk);
        s.off('connect_error', onErr);
      };

      if (s.connected) {
        resolve(s);
        return;
      }
      s.once('connect', onOk);
      s.once('connect_error', onErr);
    });
  }

  function ensureSocket() {
    if (!socket) connect(localOrigin);
    return socket;
  }

  function joinLobby(playerName, opts = {}) {
    ensureSocket().emit('lobby:join', {
      playerName,
      playerTag: opts.playerTag || window.PlayerNick.ensureTag(),
      sessionId: opts.sessionId || null,
      roomId: opts.roomId || null,
      oldPlayerId: opts.oldPlayerId || null,
      rejoin: Boolean(opts.rejoin),
    });
  }

  /** 进大厅并等到 player:me（或超时），避免紧接着 room:join 时尚未注册 */
  function joinLobbyAndWait(playerName, opts = {}) {
    return new Promise((resolve) => {
      const s = ensureSocket();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        s.off('player:me', onMe);
        resolve();
      };
      const timer = setTimeout(finish, 1200);
      function onMe() {
        finish();
      }
      s.once('player:me', onMe);
      s.emit('lobby:join', {
        playerName,
        playerTag: opts.playerTag || window.PlayerNick.ensureTag(),
        sessionId: opts.sessionId || null,
        roomId: opts.roomId || null,
        oldPlayerId: opts.oldPlayerId || null,
        rejoin: Boolean(opts.rejoin),
      });
    });
  }

  /** 查询房间是否仍活跃（本机或局域网发现） */
  function probeRoom(roomId) {
    return new Promise((resolve) => {
      const s = ensureSocket();
      const timer = setTimeout(() => {
        s.off('room:probe-result', onResult);
        resolve({ ok: false, message: '查询房间超时' });
      }, 4000);

      function onResult(data) {
        clearTimeout(timer);
        s.off('room:probe-result', onResult);
        resolve(data || { ok: false });
      }

      s.on('room:probe-result', onResult);
      s.emit('room:probe', { roomId });
    });
  }

  function refreshLobby() {
    ensureSocket().emit('lobby:refresh');
  }

  function renamePlayer(playerName, opts = {}) {
    ensureSocket().emit('player:rename', {
      playerName,
      playerTag: opts.playerTag || window.PlayerNick.ensureTag(),
      sessionId: opts.sessionId || null,
    });
  }

  function createRoom(opts) {
    ensureSocket().emit('room:create', opts);
  }

  function joinRoom(roomId, playerName, opts = {}) {
    ensureSocket().emit('room:join', {
      roomId,
      playerName,
      playerTag: opts.playerTag || window.PlayerNick.ensureTag(),
      sessionId: opts.sessionId || null,
    });
  }

  /**
   * Join a room on a possibly remote host. Switches Socket.IO connection when needed.
   * 本机房间请传 local:true 或 preferLocal，避免 localhost↔局域网IP 双连接造成重复玩家。
   */
  async function joinRoomOnHost(roomId, playerName, host, opts = {}) {
    let target = host ? normalizeUrl(host) : currentUrl || localOrigin;
    if (opts.local || opts.preferLocal) {
      target = localOrigin;
    } else if (host) {
      // 同端口且目标是本机常见别名时，也留在当前页源，避免双连接
      try {
        const want = new URL(target);
        const here = new URL(localOrigin);
        const loopbacks = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
        const samePort =
          (want.port || defaultPort(want.protocol)) ===
          (here.port || defaultPort(here.protocol));
        if (
          samePort &&
          (loopbacks.has(want.hostname) || loopbacks.has(here.hostname))
        ) {
          target = localOrigin;
        }
      } catch (_) {
        /* keep target */
      }
    }
    await connect(target);
    await joinLobbyAndWait(playerName, {
      sessionId: opts.sessionId || null,
      roomId: opts.roomId || null,
    });
    joinRoom(roomId, playerName, opts);
  }

  function defaultPort(protocol) {
    return protocol === 'https:' ? '443' : '80';
  }

  function resolveRoom(roomId) {
    return new Promise((resolve) => {
      const s = ensureSocket();
      const timer = setTimeout(() => {
        s.off('discovery:resolved', onResolved);
        resolve({ ok: false, message: '查找房间超时' });
      }, 4000);

      function onResolved(data) {
        clearTimeout(timer);
        s.off('discovery:resolved', onResolved);
        resolve(data);
      }

      s.on('discovery:resolved', onResolved);
      s.emit('discovery:resolve', { roomId });
    });
  }

  async function returnToLocalLobby(playerName, opts = {}) {
    await connect(localOrigin);
    if (playerName) joinLobby(playerName, opts);
  }

  function leaveRoom() {
    ensureSocket().emit('room:leave');
  }

  function setReady(ready) {
    ensureSocket().emit('room:ready', { ready });
  }

  function startGame() {
    ensureSocket().emit('room:start');
  }

  function sendAction(type, payload) {
    ensureSocket().emit('game:action', { type, payload });
  }

  function getLocalOrigin() {
    return localOrigin;
  }

  function getCurrentUrl() {
    return currentUrl || localOrigin;
  }

  function isOnRemoteHost() {
    return normalizeUrl(getCurrentUrl()) !== normalizeUrl(localOrigin);
  }

  return {
    connect,
    reconnect,
    on,
    joinLobby,
    joinLobbyAndWait,
    refreshLobby,
    renamePlayer,
    createRoom,
    joinRoom,
    joinRoomOnHost,
    resolveRoom,
    probeRoom,
    returnToLocalLobby,
    leaveRoom,
    setReady,
    startGame,
    sendAction,
    getLocalOrigin,
    getCurrentUrl,
    isOnRemoteHost,
  };
})();
