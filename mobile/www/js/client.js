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
 * 登录端识别：windows | mac | mobile
 * 程序角色：host=完整主机包；client=纯加入端
 * 纯客户端进房时用 URL 参数 client= / role= 保留真实信息。
 */
window.ClientPlatform = (function () {
  const GUEST_CLIENT_KEY = 'lianji.guestClientPlatform';
  const GUEST_ROLE_KEY = 'lianji.guestClientRole';
  const GUEST_FLAG_KEY = 'lianji.guestClient';

  function normalize(raw) {
    const s = String(raw || '')
      .toLowerCase()
      .trim();
    if (s === 'windows' || s === 'win' || s === 'win32') return 'windows';
    if (s === 'mac' || s === 'macos' || s === 'darwin') return 'mac';
    if (
      s === 'mobile' ||
      s === 'android' ||
      s === 'ios' ||
      s === 'phone'
    ) {
      return 'mobile';
    }
    return '';
  }

  function normalizeRole(raw) {
    const s = String(raw || '')
      .toLowerCase()
      .trim();
    if (s === 'host' || s === 'server') return 'host';
    if (s === 'client' || s === 'guest') return 'client';
    return '';
  }

  function detect() {
    const ua = String(navigator.userAgent || '');
    const plat = String(navigator.platform || '');
    if (/Android/i.test(ua) || /iPhone|iPod|iPad/i.test(ua)) return 'mobile';
    if (/Capacitor/i.test(ua) || /; wv\)/i.test(ua)) return 'mobile';
    if (/Mac|Darwin/i.test(plat) || /Mac OS X/i.test(ua)) return 'mac';
    if (/Win/i.test(plat) || /Windows/i.test(ua)) return 'windows';
    return '';
  }

  function rememberGuestClient(raw) {
    const n = normalize(raw) || detect();
    try {
      if (n) sessionStorage.setItem(GUEST_CLIENT_KEY, n);
    } catch (_) {}
    return n;
  }

  function rememberGuestRole(raw) {
    const n = normalizeRole(raw) || 'client';
    try {
      sessionStorage.setItem(GUEST_ROLE_KEY, n);
      sessionStorage.setItem(GUEST_FLAG_KEY, '1');
    } catch (_) {}
    return n;
  }

  function current() {
    try {
      const remembered = normalize(sessionStorage.getItem(GUEST_CLIENT_KEY));
      if (remembered) return remembered;
    } catch (_) {}
    return detect();
  }

  function currentRole() {
    try {
      if (sessionStorage.getItem(GUEST_FLAG_KEY) === '1') {
        return normalizeRole(sessionStorage.getItem(GUEST_ROLE_KEY)) || 'client';
      }
      const remembered = normalizeRole(sessionStorage.getItem(GUEST_ROLE_KEY));
      if (remembered) return remembered;
    } catch (_) {}
    // 完整主机包页面（本机服务）默认主机
    return 'host';
  }

  return {
    current,
    currentRole,
    detect,
    normalize,
    normalizeRole,
    rememberGuestClient,
    rememberGuestRole,
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
  /** 纯加入端（Capacitor / file / 无本机 Node）：不能走 localhost room:resolve */
  const joinClientConfig = {
    joinOnly: false,
    resolveRoomHost: null,
    homeUrl: '',
  };

  function detectJoinOnlyOrigin() {
    try {
      if (document.documentElement.dataset.mobilePlay === '1') return true;
      const p = String(window.location.protocol || '').toLowerCase();
      if (p === 'capacitor:' || p === 'file:') return true;
      // Capacitor WebView 常见 origin
      if (
        p === 'https:' &&
        /^localhost(:\d+)?$/i.test(String(window.location.host || ''))
      ) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function configureJoinClient(opts = {}) {
    if (opts.joinOnly != null) {
      joinClientConfig.joinOnly = Boolean(opts.joinOnly);
    } else if (detectJoinOnlyOrigin()) {
      joinClientConfig.joinOnly = true;
    }
    if (typeof opts.resolveRoomHost === 'function') {
      joinClientConfig.resolveRoomHost = opts.resolveRoomHost;
    }
    if (opts.homeUrl) {
      joinClientConfig.homeUrl = String(opts.homeUrl);
    }
    if (opts.client && window.ClientPlatform && window.ClientPlatform.rememberGuestClient) {
      window.ClientPlatform.rememberGuestClient(opts.client);
    }
    if (opts.role && window.ClientPlatform && window.ClientPlatform.rememberGuestRole) {
      window.ClientPlatform.rememberGuestRole(opts.role);
    }
  }

  async function refreshRemoteHost(roomId, preferred, deadHosts) {
    if (typeof joinClientConfig.resolveRoomHost === 'function') {
      try {
        const h = await joinClientConfig.resolveRoomHost(roomId);
        const n = h ? normalizeUrl(h) : '';
        if (n && !deadHosts.has(n)) return n;
      } catch (_) {
        /* ignore */
      }
    }
    if (joinClientConfig.joinOnly) {
      const fallback = preferred ? normalizeUrl(preferred) : '';
      return fallback && !deadHosts.has(fallback) ? fallback : '';
    }
    try {
      if (
        !socket ||
        currentUrl !== normalizeUrl(localOrigin) ||
        !socket.connected
      ) {
        await connect(localOrigin);
      }
      const resolved = await resolveRoom(roomId);
      if (resolved && resolved.ok && resolved.host) {
        return normalizeUrl(resolved.host);
      }
    } catch (_) {
      /* ignore */
    }
    const fallback = preferred ? normalizeUrl(preferred) : '';
    if (fallback && !deadHosts.has(fallback)) return fallback;
    return '';
  }

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
      'lobby:error',
      'lobby:passive',
      'lobby:passiveProgress',
      'lobby:mqtt-reconnect-result',
      'player:me',
      'session:reclaimed',
      'session:reclaim-failed',
      'room:update',
      'room:creating',
      'room:error',
      'room:settingsUpdated',
      'room:left',
      'room:probe-result',
      'room:resolved',
      'room:verifyPassword:result',
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
        const old = socket;
        socket = null;
        try {
          if (old.io) old.io.reconnection(false);
        } catch (_) {
          /* ignore */
        }
        old.removeAllListeners();
        try {
          old.disconnect();
        } catch (_) {
          /* ignore */
        }
        try {
          if (typeof old.close === 'function') old.close();
        } catch (_) {
          /* ignore */
        }
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

  function errText(err) {
    if (!err) return '';
    const parts = [
      err.message,
      err.description,
      err.type,
      err.context && err.context.message,
      typeof err.toString === 'function' ? err.toString() : '',
    ];
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  function isDnsNotResolvedError(err) {
    const msg = errText(err);
    return (
      msg.includes('err_name_not_resolved') ||
      msg.includes('name_not_resolved') ||
      msg.includes('enotfound') ||
      msg.includes('getaddrinfo') ||
      msg.includes('dns')
    );
  }

  function isRetryableRemoteJoinError(err) {
    const msg = errText(err);
    return (
      isDnsNotResolvedError(err) ||
      msg.includes('xhr poll error') ||
      msg.includes('websocket error') ||
      msg.includes('transport error') ||
      msg.includes('timeout') ||
      msg.includes('连接失败')
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

  /**
   * 按候选地址连接。
   * - 新域名 DNS 未就绪：短退避重试
   * - ERR_NAME_NOT_RESOLVED 且多次失败：多半是旧隧道已作废，尽快换地址
   */
  async function connectAny(candidates, opts = {}) {
    const list = (candidates || []).filter(Boolean);
    if (!list.length) list.push(localOrigin);
    const retriesPerHost = Math.max(1, Number(opts.retriesPerHost) || 1);
    const dnsFailFast = opts.dnsFailFast !== false;
    let lastErr = null;
    for (const target of list) {
      let dnsFails = 0;
      for (let attempt = 0; attempt < retriesPerHost; attempt++) {
        try {
          return await connect(target);
        } catch (err) {
          lastErr = err;
          const retryable = isRetryableRemoteJoinError(err);
          if (!retryable || attempt >= retriesPerHost - 1) break;
          if (dnsFailFast && isDnsNotResolvedError(err)) {
            dnsFails += 1;
            // 同一 trycloudflare 域名连续 DNS 失败 → 几乎肯定隧道已换新，别空转
            if (dnsFails >= 2) break;
            await sleep(600);
            continue;
          }
          // 0.8s → 1.2s → 1.6s … 上限 3s；给 Cloudflare DNS 传播时间
          await sleep(Math.min(3000, 800 + attempt * 400));
        }
      }
    }
    throw lastErr || new Error('无法连接房主');
  }

  function clientOf(opts = {}) {
    if (opts.client) return opts.client;
    try {
      return window.ClientPlatform && window.ClientPlatform.current
        ? window.ClientPlatform.current()
        : '';
    } catch (_) {
      return '';
    }
  }

  function roleOf(opts = {}) {
    if (opts.role) return opts.role;
    try {
      return window.ClientPlatform && window.ClientPlatform.currentRole
        ? window.ClientPlatform.currentRole()
        : 'host';
    } catch (_) {
      return 'host';
    }
  }

  function joinLobby(playerName, opts = {}) {
    ensureSocket().emit('lobby:join', {
      playerName,
      playerTag: opts.playerTag || window.PlayerNick.ensureTag(),
      sessionId: opts.sessionId || null,
      roomId: opts.roomId || null,
      oldPlayerId: opts.oldPlayerId || null,
      rejoin: Boolean(opts.rejoin),
      client: clientOf(opts),
      role: roleOf(opts),
    });
  }

  /** 进大厅并等到 player:me（或超时），避免紧接着 room:join 时尚未注册 */
  function joinLobbyAndWait(playerName, opts = {}) {
    return new Promise((resolve, reject) => {
      const s = ensureSocket();
      let settled = false;
      let gotMe = false;
      const timeoutMs =
        Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 1200;
      const requireMe = opts.requireMe === true;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        s.off('player:me', onMe);
        s.off('session:reclaimed', onMe);
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => {
        if (requireMe && !gotMe) {
          finish(new Error('进入大厅超时，请重试'));
          return;
        }
        finish();
      }, timeoutMs);
      function onMe() {
        gotMe = true;
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
        client: clientOf(opts),
        role: roleOf(opts),
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

  function reconnectMqtt() {
    return new Promise((resolve) => {
      const s = ensureSocket();
      const timer = setTimeout(() => {
        s.off('lobby:mqtt-reconnect-result', onResult);
        resolve({ ok: false, message: '重连广播超时' });
      }, 8000);
      function onResult(data) {
        clearTimeout(timer);
        s.off('lobby:mqtt-reconnect-result', onResult);
        resolve(data || { ok: false });
      }
      s.on('lobby:mqtt-reconnect-result', onResult);
      s.emit('lobby:mqtt-reconnect');
    });
  }

  function renamePlayer(playerName, opts = {}) {
    ensureSocket().emit('player:rename', {
      playerName,
      playerTag: opts.playerTag || window.PlayerNick.ensureTag(),
      sessionId: opts.sessionId || null,
      client: clientOf(opts),
      role: roleOf(opts),
    });
  }

  function createRoom(opts) {
    ensureSocket().emit('room:create', {
      ...opts,
      client: clientOf(opts),
      role: roleOf(opts),
    });
  }

  function setPassive(on) {
    ensureSocket().emit('lobby:setPassive', { on: Boolean(on) });
  }

  function updateRoomSettings(opts) {
    ensureSocket().emit('room:updateSettings', opts);
  }

  function verifyRoomPassword(roomId, password) {
    return new Promise((resolve) => {
      const s = ensureSocket();
      const timer = setTimeout(() => {
        s.off('room:verifyPassword:result', onResult);
        resolve({ ok: false, message: '密码验证超时' });
      }, 8000);

      function onResult(data) {
        clearTimeout(timer);
        s.off('room:verifyPassword:result', onResult);
        resolve(data || { ok: false, message: '密码验证失败' });
      }

      s.on('room:verifyPassword:result', onResult);
      s.emit('room:verifyPassword', {
        roomId,
        // 明文只发到房主隧道，不走 MQTT
        password: password == null ? '' : String(password),
      });
    });
  }

  async function assertRoomPassword(roomId, password) {
    const result = await verifyRoomPassword(roomId, password);
    if (!result || !result.ok) {
      throw new Error((result && result.message) || '房间密码错误');
    }
    return result;
  }

  function joinRoom(roomId, playerName, opts = {}) {
    ensureSocket().emit('room:join', {
      roomId,
      playerName,
      playerTag: opts.playerTag || window.PlayerNick.ensureTag(),
      sessionId: opts.sessionId || null,
      password: opts.password != null ? String(opts.password) : '',
      client: clientOf(opts),
      role: roleOf(opts),
    });
  }

  function waitForRoomJoinResult(roomId, playerName, opts = {}) {
    const rid = String(roomId || '')
      .trim()
      .toUpperCase();
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 20000;
    return new Promise((resolve, reject) => {
      const s = ensureSocket();
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        s.off('room:update', onUpdate);
        s.off('session:reclaimed', onReclaimed);
        s.off('room:error', onError);
      };
      const finishOk = (data) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(data);
      };
      const finishErr = (data) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error((data && data.message) || '加入房间失败'));
      };
      const timer = setTimeout(
        () => finishErr({ message: '加入房间超时' }),
        timeoutMs
      );

      function onUpdate(data) {
        const room = data && data.room;
        if (room && String(room.id).toUpperCase() === rid) finishOk(data);
      }
      function onReclaimed(data) {
        if (data && String(data.roomId || '').toUpperCase() === rid) {
          finishOk({ room: { id: rid, status: data.status || 'waiting' } });
        }
      }
      function onError(data) {
        finishErr(data);
      }

      s.on('room:update', onUpdate);
      s.on('session:reclaimed', onReclaimed);
      s.on('room:error', onError);
    });
  }

  /** 验密后进房并等到 room:update（或 room:error / 超时） */
  async function joinRoomAndWait(roomId, playerName, opts = {}) {
    const rid = String(roomId || '')
      .trim()
      .toUpperCase();
    if (!rid) throw new Error('房间码无效');

    await assertRoomPassword(rid, opts.password);

    async function emitJoin() {
      const wait = waitForRoomJoinResult(rid, playerName, opts);
      if (opts.spectate) spectateRoom(rid, playerName, opts);
      else joinRoom(rid, playerName, opts);
      return wait;
    }

    try {
      return await emitJoin();
    } catch (err) {
      const msg = String((err && err.message) || '');
      if (!msg.includes('请先进入大厅')) throw err;
      await joinLobbyAndWait(playerName, {
        ...opts,
        timeoutMs: 8000,
        requireMe: true,
      });
      return emitJoin();
    }
  }

  function spectateRoom(roomId, playerName, opts = {}) {
    ensureSocket().emit('room:spectate', {
      roomId,
      playerName,
      playerTag: opts.playerTag || window.PlayerNick.ensureTag(),
      sessionId: opts.sessionId || null,
      password: opts.password != null ? String(opts.password) : '',
      client: clientOf(opts),
      role: roleOf(opts),
    });
  }

  /**
   * Join a room on a possibly remote host. Switches Socket.IO connection when needed.
   * 本机房间请传 local:true 或 preferLocal；远端房间统一走公网隧道 host。
   */
  async function joinRoomOnHost(roomId, playerName, host, opts = {}) {
    const remote = !(opts.local || opts.preferLocal);
    const deadHosts = new Set();

    async function doJoin(targetHost) {
      let candidates = [];
      if (!remote) {
        candidates = [localOrigin];
      } else if (targetHost) {
        const h = normalizeUrl(targetHost);
        if (!deadHosts.has(h)) candidates = [h];
      }
      if (!candidates.length) {
        throw new Error('隧道地址尚未就绪，请稍后再试');
      }
      // 远端：DNS 失败会快速放弃该域名；本机一次即可
      await connectAny(candidates, {
        retriesPerHost: remote ? 4 : 1,
        dnsFailFast: remote,
      });
      await joinLobbyAndWait(playerName, {
        sessionId: opts.sessionId || null,
        roomId: opts.roomId || roomId || null,
        oldPlayerId: opts.oldPlayerId || null,
        rejoin: Boolean(opts.rejoin),
        playerTag: opts.playerTag || null,
        client: clientOf(opts),
        role: roleOf(opts),
        timeoutMs: opts.lobbyTimeoutMs,
        requireMe: opts.requireMe,
      });
      if (!opts.rejoin) {
        await assertRoomPassword(roomId, opts.password);
        let waitPromise = null;
        if (opts.wait) {
          waitPromise = waitForRoomJoinResult(roomId, playerName, opts);
        }
        joinRoom(roomId, playerName, opts);
        if (waitPromise) return await waitPromise;
      }
    }

    // 远端：先向本机 MQTT 拉最新隧道，避免大厅列表里的旧 trycloudflare 域名
    let activeHost = host;
    if (remote) {
      const fresh = await refreshRemoteHost(roomId, host, deadHosts);
      if (fresh) activeHost = fresh;
    }

    try {
      return await doJoin(activeHost);
    } catch (err) {
      if (!remote || !isRetryableRemoteJoinError(err)) {
        throw err;
      }
      if (activeHost) deadHosts.add(normalizeUrl(activeHost));
    }

    // 仍失败：回本地轮询最新地址；跳过已确认 DNS 失败的旧域名
    if (!joinClientConfig.joinOnly) {
      await connect(localOrigin);
    }
    let lastResolved = null;
    let lastErr = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const nextHost = await refreshRemoteHost(roomId, host, deadHosts);
      lastResolved = nextHost
        ? { ok: true, host: nextHost }
        : { ok: false, message: '未找到该房间码' };
      if (nextHost && !deadHosts.has(nextHost)) {
        try {
          return await doJoin(nextHost);
        } catch (err) {
          lastErr = err;
          if (!isRetryableRemoteJoinError(err)) throw err;
          deadHosts.add(nextHost);
        }
      } else if (nextHost && deadHosts.has(nextHost)) {
        // 房主还在广播同一个已死域名：等它换隧道
        lastErr = new Error(
          '房主隧道已失效，正在等待对方刷新公网地址…'
        );
      }
      await sleep(1500);
    }
    if (lastErr) throw lastErr;
    throw new Error(
      (lastResolved && lastResolved.message) ||
        '隧道地址尚未就绪（DNS），请稍后再试'
    );
  }

  /** 观战远端/本机房间 */
  async function spectateRoomOnHost(roomId, playerName, host, opts = {}) {
    return joinRoomOnHost(roomId, playerName, host, {
      ...opts,
      _spectate: true,
    }).then(() => {
      /* joinRoomOnHost 已进大厅；若标记 spectate 需改发 spectate */
    });
  }

  async function enterRoomOnHost(roomId, playerName, host, opts = {}) {
    const remote = !(opts.local || opts.preferLocal);
    const mode = opts.mode === 'spectate' ? 'spectate' : 'join';
    const deadHosts = new Set();
    const joinOpts = {
      ...opts,
      spectate: mode === 'spectate',
    };

    async function doEnter(targetHost) {
      let candidates = [];
      if (!remote) {
        candidates = [localOrigin];
      } else if (targetHost) {
        const h = normalizeUrl(targetHost);
        if (!deadHosts.has(h)) candidates = [h];
      }
      if (!candidates.length) {
        throw new Error('隧道地址尚未就绪，请稍后再试');
      }
      await connectAny(candidates, {
        retriesPerHost: remote ? 4 : 1,
        dnsFailFast: remote,
      });
      await joinLobbyAndWait(playerName, {
        sessionId: opts.sessionId || null,
        roomId: opts.roomId || roomId || null,
        oldPlayerId: opts.oldPlayerId || null,
        rejoin: Boolean(opts.rejoin),
        playerTag: opts.playerTag || null,
        client: clientOf(opts),
        role: roleOf(opts),
        timeoutMs: opts.lobbyTimeoutMs,
        requireMe: opts.requireMe !== false,
      });
      if (!opts.rejoin) {
        await assertRoomPassword(roomId, opts.password);
        let waitPromise = null;
        if (opts.wait) {
          waitPromise = waitForRoomJoinResult(roomId, playerName, joinOpts);
        }
        if (mode === 'spectate') spectateRoom(roomId, playerName, joinOpts);
        else joinRoom(roomId, playerName, joinOpts);
        if (waitPromise) return await waitPromise;
      }
    }

    let activeHost = host;
    if (remote) {
      const fresh = await refreshRemoteHost(roomId, host, deadHosts);
      if (fresh) activeHost = fresh;
    }
    try {
      return await doEnter(activeHost);
    } catch (err) {
      if (!remote || !isRetryableRemoteJoinError(err)) throw err;
      if (activeHost) deadHosts.add(normalizeUrl(activeHost));
    }
    if (!joinClientConfig.joinOnly) {
      await connect(localOrigin);
    }
    let lastErr = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const nextHost = await refreshRemoteHost(roomId, host, deadHosts);
      if (nextHost && !deadHosts.has(nextHost)) {
        try {
          return await doEnter(nextHost);
        } catch (err) {
          lastErr = err;
          if (!isRetryableRemoteJoinError(err)) throw err;
          deadHosts.add(nextHost);
        }
      }
      await sleep(1500);
    }
    if (lastErr) throw lastErr;
    throw new Error('隧道地址尚未就绪（DNS），请稍后再试');
  }

  /** 在被动主机上开房（切到对方隧道后 createRoom + passiveHost） */
  async function createRoomOnHost(playerName, host, opts = {}) {
    const target = host ? normalizeUrl(host) : '';
    if (!target) throw new Error('缺少被动主机地址');
    await connectAny([target], { retriesPerHost: 4, dnsFailFast: true });
    await joinLobbyAndWait(playerName, {
      sessionId: opts.sessionId || null,
      playerTag: opts.playerTag || null,
    });
    createRoom({
      ...opts,
      playerName,
      playerTag: opts.playerTag || window.PlayerNick.ensureTag(),
      sessionId: opts.sessionId || null,
      passiveHost: true,
    });
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

  function isConnected() {
    return Boolean(socket && socket.connected);
  }

  function getJoinClientHome() {
    return joinClientConfig.homeUrl ? String(joinClientConfig.homeUrl) : '';
  }

  if (detectJoinOnlyOrigin()) {
    joinClientConfig.joinOnly = true;
  }

  return {
    connect,
    connectAny,
    reconnect,
    stopAutoReconnect,
    configureJoinClient,
    getJoinClientHome,
    on,
    joinLobby,
    joinLobbyAndWait,
    refreshLobby,
    reconnectMqtt,
    renamePlayer,
    createRoom,
    createRoomOnHost,
    setPassive,
    updateRoomSettings,
    joinRoom,
    joinRoomAndWait,
    spectateRoom,
    verifyRoomPassword,
    joinRoomOnHost,
    enterRoomOnHost,
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
    isConnected,
  };
})();
