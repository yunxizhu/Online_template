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
 * Socket.IO client: can switch host when joining a remote room.
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
      'room:resolved',
      'game:started',
      'game:state',
      'game:error',
      'game:player-left',
      'game:quit-ok',
      'chat:message',
      'chat:error',
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
        forceNew: true,
        // trycloudflare 上直连 websocket 偶发握手失败；先 polling 再升级更稳
        transports: ['polling', 'websocket'],
        upgrade: true,
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

  function isRetryableRemoteJoinError(err) {
    const msg = String(
      (err && (err.message || err.description || err.type)) || err || ''
    ).toLowerCase();
    return (
      msg.includes('err_name_not_resolved') ||
      msg.includes('xhr poll error') ||
      msg.includes('websocket error') ||
      msg.includes('transport error')
    );
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function stopAutoReconnect() {
    if (!socket) return;
    try {
      if (socket.io) socket.io.reconnection(false);
    } catch (_) {
      /* ignore */
    }
  }

  function ensureSocket() {
    if (!socket) connect(localOrigin);
    return socket;
  }

  /** 按候选地址逐个尝试连接，全部失败才抛错（当前候选为公网隧道地址） */
  async function connectAny(candidates) {
    const list = (candidates || []).filter(Boolean);
    if (!list.length) list.push(localOrigin);
    let lastErr = null;
    for (const target of list) {
      try {
        return await connect(target);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('无法连接房主');
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
        s.off('session:reclaimed', onMe);
        resolve();
      };
      const timer = setTimeout(finish, 1200);
      function onMe() {
        finish();
      }
      s.once('player:me', onMe);
      s.once('session:reclaimed', onMe);
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

  /** 查询房间是否仍活跃（本机或跨网 MQTT 查询） */
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
   * 本机房间请传 local:true 或 preferLocal；远端房间统一走公网隧道 host。
   */
  async function joinRoomOnHost(roomId, playerName, host, opts = {}) {
    async function doJoin(targetHost) {
      let candidates = [];
      if (opts.local || opts.preferLocal) {
        candidates = [localOrigin];
      } else if (targetHost) {
        candidates = [normalizeUrl(targetHost)];
      }
      await connectAny(candidates);
      await joinLobbyAndWait(playerName, {
        sessionId: opts.sessionId || null,
        roomId: opts.roomId || roomId || null,
        oldPlayerId: opts.oldPlayerId || null,
        rejoin: Boolean(opts.rejoin),
        playerTag: opts.playerTag || null,
      });
      if (!opts.rejoin) {
        joinRoom(roomId, playerName, opts);
      }
    }

    const failedHosts = new Set();
    if (host) failedHosts.add(normalizeUrl(host));

    try {
      await doJoin(host);
      return;
    } catch (err) {
      if (host) failedHosts.add(normalizeUrl(host));
      if (opts.local || opts.preferLocal || !isRetryableRemoteJoinError(err)) {
        throw err;
      }
    }

    // 远端域名刚广播出来或隧道刚重连时，回本地持续重查一小段时间
    await connect(localOrigin);
    let lastResolved = null;
    let lastErr = null;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const resolved = await resolveRoom(roomId);
      lastResolved = resolved;
      const nextHost =
        resolved && resolved.ok && resolved.host
          ? normalizeUrl(resolved.host)
          : '';
      if (nextHost && !failedHosts.has(nextHost)) {
        try {
          await doJoin(nextHost);
          return;
        } catch (err) {
          lastErr = err;
          if (!isRetryableRemoteJoinError(err)) throw err;
          failedHosts.add(nextHost);
        }
      }
      await sleep(1500);
    }
    if (lastErr) throw lastErr;
    throw new Error(
      (lastResolved && lastResolved.message) || '未找到可用的房间最新地址'
    );
  }

  function resolveRoom(roomId) {
    return new Promise((resolve) => {
      const s = ensureSocket();
      const timer = setTimeout(() => {
        s.off('room:resolved', onResolved);
        resolve({ ok: false, message: '查找房间超时' });
      }, 4000);

      function onResolved(data) {
        clearTimeout(timer);
        s.off('room:resolved', onResolved);
        resolve(data);
      }

      s.on('room:resolved', onResolved);
      s.emit('room:resolve', { roomId });
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

  function quitGame() {
    ensureSocket().emit('game:leave');
  }

  function sendChat(channel, text) {
    ensureSocket().emit('chat:send', { channel, text });
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
    connectAny,
    reconnect,
    stopAutoReconnect,
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
    quitGame,
    sendChat,
    sendAction,
    getLocalOrigin,
    getCurrentUrl,
    isOnRemoteHost,
  };
})();
