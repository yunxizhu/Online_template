/* 加入端大厅：MQTT 发现 + 聊天 + 加入/在被动主机上开房（安卓 App / PC 纯客户端共用） */
(function () {
  'use strict';

  const APP = 'lianji';
  const BROKER = 'wss://broker.emqx.io:8084/mqtt';
  /** 与电脑端默认频道一致，加入端不提供切换 */
  const DEFAULT_CHANNEL = 'xiyun_lianjidating_public';
  const LOGIN_HB_MS = 10000;
  const ROOM_OFFLINE_MS = 15000;
  const LOGIN_OFFLINE_MS = 25000;
  const STALE_CLEAR_MS = 120000;
  const STORAGE_NICK = 'lianji.nick';
  const STORAGE_TAG = 'lianji.tag';
  const STORAGE_SID = 'lianji.sessionId';
  const LEFT_ROOMS_KEY = 'lianji.leftRooms';

  function detectClient() {
    const ua = String(navigator.userAgent || '');
    const plat = String(navigator.platform || '');
    if (/Android/i.test(ua) || /iPhone|iPod|iPad/i.test(ua)) return 'mobile';
    if (/Capacitor/i.test(ua) || /; wv\)/i.test(ua)) return 'mobile';
    if (/Mac|Darwin/i.test(plat) || /Mac OS X/i.test(ua)) return 'mac';
    if (/Win/i.test(plat) || /Windows/i.test(ua)) return 'windows';
    return 'mobile';
  }

  const MY_CLIENT = detectClient();
  const MY_ROLE = 'client';
  const CLIENT_LABEL =
    MY_CLIENT === 'windows'
      ? 'Windows 纯客户端'
      : MY_CLIENT === 'mac'
        ? 'Mac 纯客户端'
        : '手机加入端';

  const el = {
    gate: document.getElementById('lobby-gate'),
    main: document.getElementById('lobby-main'),
    peopleAside: document.getElementById('lobby-people-aside'),
    playerName: document.getElementById('player-name'),
    btnEnter: document.getElementById('btn-enter-lobby'),
    btnCreateRoom: document.getElementById('btn-create-room'),
    btnJoin: document.getElementById('btn-toggle-join'),
    peersLabel: document.getElementById('peers-label'),
    roomList: document.getElementById('room-list'),
    roomEmpty: document.getElementById('room-list-empty'),
    roomListPlaying: document.getElementById('room-list-playing'),
    roomPlayingEmpty: document.getElementById('room-list-playing-empty'),
    peopleList: document.getElementById('lobby-people-list'),
    peopleEmpty: document.getElementById('lobby-people-empty'),
    peopleCount: document.getElementById('lobby-people-count'),
    headerNick: document.getElementById('header-nick'),
    nickDisplay: document.getElementById('nick-display'),
    playerNameEdit: document.getElementById('player-name-edit'),
    btnEditName: document.getElementById('btn-edit-name'),
    meLabel: document.getElementById('me-label'),
    toast: document.getElementById('toast'),
    chatDock: document.getElementById('chat-dock'),
    chatPanel: document.getElementById('chat-panel'),
    chatLog: document.getElementById('chat-log'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    chatCollapsedPreview: document.getElementById('chat-collapsed-preview'),
    chatHead: document.getElementById('chat-drag-handle'),
    btnRefreshPeople: document.getElementById('btn-refresh-doc'),
    joinModal: document.getElementById('join-code-modal'),
    joinCode: document.getElementById('join-code'),
    joinPassword: document.getElementById('join-password'),
    joinCodeTitle: document.getElementById('join-code-title'),
    hostUrl: document.getElementById('host-url'),
    btnJoinConfirm: document.getElementById('btn-join-code'),
    btnCloseJoin: document.getElementById('btn-close-join'),
    joiningOverlay: document.getElementById('joining-overlay'),
    joiningMessage: document.getElementById('joining-message'),
    bootSplash: document.getElementById('boot-splash'),
    bootSplashText: document.getElementById('boot-splash-text'),
    roomCtx: document.getElementById('room-ctx'),
    peopleCtx: document.getElementById('people-ctx'),
    rejoinModal: document.getElementById('rejoin-modal'),
    rejoinMessage: document.getElementById('rejoin-message'),
    btnAcceptRejoin: document.getElementById('btn-accept-rejoin'),
    btnDeclineRejoin: document.getElementById('btn-decline-rejoin'),
    btnCloseRejoin: document.getElementById('btn-close-rejoin'),
  };

  /** @type {Map<string, object>} */
  const rooms = new Map();
  /** @type {Map<string, object>} */
  const logins = new Map();

  let client = null;
  let pruneTimer = null;
  let loginTimer = null;
  let entered = false;
  let playerName = '';
  let playerTag = '';
  let sessionId = '';
  let instanceId = '';
  let loginAt = 0;
  let lastChatAt = 0;
  let toastTimer = null;
  let pendingRejoin = null;
  const leftRooms = {};

  function uid(prefix) {
    return (
      prefix +
      Math.random().toString(36).slice(2, 10) +
      Date.now().toString(36).slice(-4)
    );
  }

  function channelName() {
    return DEFAULT_CHANNEL;
  }

  function prefix() {
    return 'lianji/v1/' + channelName();
  }

  function showToast(text, durationMs) {
    if (!el.toast) return;
    el.toast.textContent = text;
    el.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
    }, typeof durationMs === 'number' && durationMs > 0 ? durationMs : 2800);
  }

  function stripBaseName(name) {
    return String(name || '')
      .trim()
      .replace(/#\d{1,8}\s*$/, '')
      .trim();
  }

  function normalizeTagDigits(tag) {
    return String(tag || '')
      .replace(/\D/g, '')
      .slice(-5);
  }

  function readPersistedLeftRooms() {
    try {
      const raw = localStorage.getItem(LEFT_ROOMS_KEY);
      const map = raw ? JSON.parse(raw) : {};
      return map && typeof map === 'object' ? map : {};
    } catch (_) {
      return {};
    }
  }

  function writePersistedLeftRooms(map) {
    try {
      localStorage.setItem(LEFT_ROOMS_KEY, JSON.stringify(map || {}));
    } catch (_) {}
  }

  function rememberExplicitLeave(roomId) {
    const id = roomId ? String(roomId).toUpperCase() : '';
    if (!id) return;
    const at = Date.now();
    leftRooms[id] = at;
    const map = readPersistedLeftRooms();
    map[id] = at;
    writePersistedLeftRooms(map);
  }

  function hasExplicitlyLeft(roomId) {
    const id = roomId ? String(roomId).toUpperCase() : '';
    if (!id) return false;
    if (leftRooms[id]) return true;
    const map = readPersistedLeftRooms();
    if (map[id]) {
      leftRooms[id] = map[id];
      return true;
    }
    return false;
  }

  function clearExplicitLeave(roomId) {
    const id = roomId ? String(roomId).toUpperCase() : '';
    if (!id) return;
    if (leftRooms[id]) delete leftRooms[id];
    const map = readPersistedLeftRooms();
    if (map[id]) {
      delete map[id];
      writePersistedLeftRooms(map);
    }
  }

  function isSelfInRoomPlayers(room) {
    if (!room || !Array.isArray(room.playerNames) || !room.playerNames.length) {
      return false;
    }
    const myName = stripBaseName(playerName);
    if (!myName) return false;
    const tag = normalizeTagDigits(playerTag);
    const tags = Array.isArray(room.playerTags) ? room.playerTags : [];
    return room.playerNames.some((rawName, i) => {
      const n = stripBaseName(rawName);
      if (n !== myName) return false;
      const t = normalizeTagDigits(tags[i] || '');
      if (tag && t) return tag === t;
      if (tag && !t) return false;
      if (!tag && t) return false;
      return true;
    });
  }

  function publishLeave(roomId) {
    const id = roomId ? String(roomId).toUpperCase() : '';
    if (!id || !playerName) return false;
    rememberExplicitLeave(id);
    if (!client || !client.connected) return false;
    const payload = {
      app: APP,
      kind: 'leave',
      roomId: id,
      name: playerName,
      tag: playerTag || null,
      sessionId: sessionId || null,
      at: Date.now(),
    };
    try {
      client.publish(prefix() + '/leave', JSON.stringify(payload), {
        qos: 1,
        retain: false,
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  function flushPersistedLeaves() {
    const map = { ...leftRooms, ...readPersistedLeftRooms() };
    for (const id of Object.keys(map)) {
      if (id) publishLeave(id);
    }
  }

  function pruneLeftRooms(list) {
    const map = { ...leftRooms, ...readPersistedLeftRooms() };
    const ttl = 6 * 3600 * 1000;
    const now = Date.now();
    let changed = false;
    for (const id of Object.keys(map)) {
      const at = Number(map[id] || 0);
      if (at && now - at > ttl) {
        delete leftRooms[id];
        delete map[id];
        changed = true;
        continue;
      }
      const room = (list || []).find(
        (r) => String((r && r.id) || '').toUpperCase() === id
      );
      if (!room) continue;
      if (isSelfInRoomPlayers(room)) continue;
      delete leftRooms[id];
      delete map[id];
      changed = true;
    }
    if (changed) writePersistedLeftRooms(map);
  }

  function setRejoinModalOpen(open, room) {
    if (!el.rejoinModal) return;
    if (open && room) {
      pendingRejoin = room;
      const code = room.id || '—';
      const statusText =
        room.status === 'playing'
          ? '对局仍在进行'
          : room.status === 'waiting'
            ? '房间仍在等待'
            : '房间仍有效';
      if (el.rejoinMessage) {
        el.rejoinMessage.textContent =
          '检测到你还在「' +
          (room.name || code) +
          '」（' +
          code +
          '），' +
          statusText +
          '。是否重新加入？';
      }
      el.rejoinModal.hidden = false;
    } else {
      pendingRejoin = null;
      el.rejoinModal.hidden = true;
    }
  }

  function maybeOfferRejoinFromLobby(list) {
    if (!entered || joining) return;
    if (el.rejoinModal && !el.rejoinModal.hidden) return;
    const items = list || [];
    pruneLeftRooms(items);
    for (const room of items) {
      if (!room || room.over || room.status !== 'playing') continue;
      if (hasExplicitlyLeft(room.id)) continue;
      if (!isSelfInRoomPlayers(room)) continue;
      setRejoinModalOpen(true, room);
      return;
    }
  }

  function acceptPendingRejoin() {
    const room = pendingRejoin;
    setRejoinModalOpen(false);
    if (!room || !room.id) return;
    clearExplicitLeave(room.id);
    openRoomWithPassword(room, 'join');
  }

  function declinePendingRejoin() {
    const room = pendingRejoin;
    setRejoinModalOpen(false);
    if (room && room.id) {
      publishLeave(room.id);
    }
    showToast('已留在大厅');
  }

  function normalizeHost(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s.replace(/\/+$/, '');
  }

  let joining = false;
  let codeModalMode = 'join'; // 'join' | 'spectate'
  let roomCtxTarget = null;
  let peopleCtxTarget = null;
  /** 启动加载：仅安卓/手机端，直到 MQTT 广播连上 */
  let bootSplashPending = MY_CLIENT === 'mobile';
  let bootSplashHiding = false;
  let bootSplashTimer = null;

  function wantsBootSplash() {
    return MY_CLIENT === 'mobile';
  }

  function showBootSplash(message) {
    if (!wantsBootSplash() || !el.bootSplash) return;
    bootSplashPending = true;
    bootSplashHiding = false;
    document.body.classList.add('is-booting');
    document.body.classList.remove('is-lobby-reveal');
    if (el.bootSplashText) {
      el.bootSplashText.textContent = message || '正在连接广播…';
    }
    el.bootSplash.classList.remove('is-hiding');
    el.bootSplash.hidden = false;
    el.bootSplash.setAttribute('aria-busy', 'true');
    if (bootSplashTimer) clearTimeout(bootSplashTimer);
    bootSplashTimer = setTimeout(() => {
      if (!bootSplashPending) return;
      if (el.peersLabel) el.peersLabel.textContent = '广播：连接较慢，可稍后刷新';
      hideBootSplash();
    }, 18000);
  }

  function hideBootSplash() {
    if (bootSplashTimer) {
      clearTimeout(bootSplashTimer);
      bootSplashTimer = null;
    }
    if (!el.bootSplash) {
      document.body.classList.remove('is-booting');
      bootSplashPending = false;
      return;
    }
    if (!bootSplashPending && el.bootSplash.hidden) return;
    if (bootSplashHiding) return;
    bootSplashPending = false;
    bootSplashHiding = true;
    document.body.classList.remove('is-booting');
    document.body.classList.add('is-lobby-reveal');
    el.bootSplash.classList.add('is-hiding');
    el.bootSplash.setAttribute('aria-busy', 'false');
    const finish = () => {
      if (!el.bootSplash) return;
      el.bootSplash.hidden = true;
      el.bootSplash.classList.remove('is-hiding');
      bootSplashHiding = false;
    };
    el.bootSplash.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 600);
  }

  function showJoining(message) {
    joining = true;
    if (el.joiningMessage) {
      el.joiningMessage.textContent = message || '正在加入…';
    }
    if (el.joiningOverlay) el.joiningOverlay.hidden = false;
    setJoinOpen(false);
  }

  function hideJoining() {
    joining = false;
    if (el.joiningOverlay) el.joiningOverlay.hidden = true;
  }

  const PLAY_JOIN_KEY = 'lianji.mobilePlayJoin';

  function stashPlayJoin(payload) {
    const boot = {
      roomId: String(payload.roomId || payload.id || '')
        .trim()
        .toUpperCase(),
      host: String(payload.host || '').trim(),
      name: playerName,
      password: payload.password != null ? String(payload.password) : '',
      mode: payload.mode === 'spectate' ? 'spectate' : 'join',
      sessionId,
      playerTag: playerTag || '',
      client: MY_CLIENT,
      role: MY_ROLE,
    };
    if (!boot.roomId || !boot.host) {
      showToast('房间信息不完整');
      return false;
    }
    clearExplicitLeave(boot.roomId);
    if (!boot.name) {
      showToast('请先设置昵称');
      return false;
    }
    try {
      sessionStorage.setItem(PLAY_JOIN_KEY, JSON.stringify(boot));
    } catch (_) {
      showToast('无法保存加入信息');
      return false;
    }
    publishLoginExtra('joining', boot.roomId);
    showJoining(
      boot.mode === 'spectate'
        ? '正在观战 ' + boot.roomId + '…'
        : '正在加入房间 ' + boot.roomId + '…'
    );
    window.location.href = './play.html';
    return true;
  }

  function joinRemoteRoom(room, mode, password) {
    if (joining) return;
    if (!room || !room.host) {
      showToast('暂无可用地址');
      return;
    }
    if (mode !== 'spectate' && !roomCanJoin(room)) {
      showToast(
        room.status === 'playing' ? '对局已开始，请用观战' : '房间已满'
      );
      return;
    }
    stashPlayJoin({
      id: room.id,
      host: room.host,
      password,
      mode: mode || 'join',
    });
  }

  function joinRemoteByCode(code, hostUrl, mode, password) {
    const rid = String(code || '').trim().toUpperCase();
    const url = String(hostUrl || '').trim();
    if (!rid && !url) {
      showToast('请输入房间码或房主地址');
      return;
    }
    if (url) {
      const base = normalizeHost(url);
      if (!base) {
        showToast('地址格式不正确');
        return;
      }
      if (!rid) {
        showToast('填写房主地址时请同时输入房间码');
        return;
      }
      stashPlayJoin({
        roomId: rid,
        host: base,
        password,
        mode: mode === 'spectate' ? 'spectate' : 'join',
      });
      return;
    }
    const now = Date.now();
    for (const r of rooms.values()) {
      if (
        r.id === rid &&
        r.host &&
        r.updateTime &&
        now - r.updateTime <= ROOM_OFFLINE_MS
      ) {
        if (mode === 'spectate') {
          joinRemoteRoom(r, 'spectate', password);
        } else if (!roomCanJoin(r)) {
          showToast(
            r.status === 'playing' ? '对局已开始，请用观战' : '房间已满'
          );
        } else {
          joinRemoteRoom(r, 'join', password);
        }
        return;
      }
    }
    showToast('未找到该房间码（对方需在线并广播房间）');
  }

  function askRoomPassword(room) {
    if (!room || !room.hasPassword) return '';
    const v = window.prompt('请输入房间密码（可为空）', '');
    if (v == null) return null;
    return String(v);
  }

  function openRoomWithPassword(room, mode) {
    if (!room || !room.host) {
      showToast('暂无可用地址');
      return;
    }
    const password = askRoomPassword(room);
    if (password == null) return;
    joinRemoteRoom(room, mode || 'join', password);
  }

  /** 被动主机代开：仍跳转对方网页（无 Socket 会话） */
  function openHost(host, roomId, opts = {}) {
    if (joining) return;
    const base = normalizeHost(host);
    if (!base) {
      showToast('无效的房主地址');
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(base);
    } catch (_) {
      showToast('地址格式不正确');
      return;
    }
    const mode = opts.mode === 'createPassive' ? 'createPassive' : 'join';
    if (mode !== 'createPassive') {
      showToast('请从房间列表加入');
      return;
    }
    const u = new URL(base + '/');
    u.searchParams.set('guest', '1');
    u.searchParams.set('client', MY_CLIENT);
    u.searchParams.set('role', MY_ROLE);
    // 离开代开/加入房后回到纯客户端大厅（跨域，勿用 sessionStorage）
    try {
      u.searchParams.set('return', window.location.href);
    } catch (_) {
      /* ignore */
    }
    if (playerName) u.searchParams.set('name', playerName);
    if (playerTag) u.searchParams.set('tag', playerTag);
    if (sessionId) u.searchParams.set('sid', sessionId);
    if (mode === 'createPassive') {
      u.searchParams.set('createPassive', '1');
    }
    showJoining('正在前往被动主机开房…');
    clearLoginBeacon();
    const href = u.toString();
    requestAnimationFrame(() => {
      setTimeout(() => {
        window.location.href = href;
      }, 40);
    });
  }

  function setJoinOpen(open, mode) {
    if (!el.joinModal) return;
    if (mode) codeModalMode = mode;
    el.joinModal.hidden = !open;
    if (open && el.joinCodeTitle) {
      el.joinCodeTitle.textContent =
        codeModalMode === 'spectate' ? '房间码观战' : '加入房间';
    }
    if (open && el.btnJoinConfirm) {
      el.btnJoinConfirm.textContent =
        codeModalMode === 'spectate' ? '观战' : '加入';
    }
  }

  function clientLabel(client, role) {
    const c = String(client || '').toLowerCase();
    const r = String(role || '').toLowerCase();
    let plat = '';
    if (c === 'windows') plat = 'Windows';
    else if (c === 'mac') plat = 'Mac';
    else if (c === 'mobile' || c === 'android' || c === 'ios') plat = '手机';
    let roleBit = '';
    if (r === 'host') roleBit = '主机';
    else if (r === 'client') roleBit = '客户端';
    const parts = [plat, roleBit].filter(Boolean);
    return parts.join('·');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function nickHtml(name, tag) {
    const base = escapeHtml(String(name || '玩家').trim() || '玩家');
    const t = tag ? String(tag).slice(-5) : '';
    return t
      ? base + '<span class="nick-tag">#' + escapeHtml(t) + '</span>'
      : base;
  }

  let nickEditing = false;
  let nickEditOriginal = '';

  function refreshNickUi() {
    const name = String(playerName || '玩家').trim().slice(0, 16) || '玩家';
    const tag = playerTag || '';
    if (!nickEditing) {
      if (el.nickDisplay) {
        el.nickDisplay.hidden = false;
        el.nickDisplay.innerHTML = nickHtml(name, tag);
        el.nickDisplay.title = name + (tag ? '#' + String(tag).slice(-5) : '');
      }
      if (el.playerNameEdit) {
        el.playerNameEdit.hidden = true;
        el.playerNameEdit.value = name;
      }
      if (el.btnEditName) el.btnEditName.hidden = !entered;
    }
    if (el.headerNick) el.headerNick.hidden = !entered;
  }

  function setNickEditing(on) {
    if (!el.headerNick || !el.playerNameEdit || !el.nickDisplay) return;
    if (!entered && on) return;
    nickEditing = Boolean(on);
    el.headerNick.classList.toggle('is-editing', nickEditing);
    el.nickDisplay.hidden = nickEditing;
    el.playerNameEdit.hidden = !nickEditing;
    if (el.btnEditName) el.btnEditName.hidden = nickEditing || !entered;
    if (nickEditing) {
      nickEditOriginal = String(playerName || '').trim().slice(0, 16);
      el.playerNameEdit.value = nickEditOriginal;
      try {
        el.playerNameEdit.focus();
        el.playerNameEdit.select();
      } catch (_) {}
    } else {
      refreshNickUi();
    }
  }

  function applyPlayerName(raw) {
    const name = String(raw || '')
      .trim()
      .slice(0, 16);
    if (!name) {
      showToast('昵称不能为空');
      refreshNickUi();
      return;
    }
    if (name === playerName) {
      refreshNickUi();
      return;
    }
    playerName = name;
    try {
      localStorage.setItem(STORAGE_NICK, name);
    } catch (_) {}
    if (el.playerName) el.playerName.value = name;
    refreshNickUi();
    publishLogin();
    showToast('昵称已更新');
  }

  function commitNickEdit() {
    if (!nickEditing) return;
    const next = el.playerNameEdit.value;
    setNickEditing(false);
    applyPlayerName(next);
  }

  function cancelNickEdit() {
    if (!nickEditing) return;
    el.playerNameEdit.value = nickEditOriginal;
    setNickEditing(false);
  }

  function remoteBadgeHtml(client, role) {
    const label = clientLabel(client, role);
    if (!label) return '';
    return (
      ' <span class="people-client" title="' +
      escapeHtml(label) +
      '">[' +
      escapeHtml(label) +
      ']</span>'
    );
  }

  function statusText(st, roomName) {
    if (st === 'playing') return '对局中';
    if (st === 'offline') return '离线';
    if (st === 'occupied') {
      return roomName ? '代开中 · ' + roomName : '代开中';
    }
    if (st === 'spectating') {
      return roomName ? '观战 · ' + roomName : '观战中';
    }
    if (st === 'room') {
      return roomName ? '房间中 · ' + roomName : '房间中';
    }
    if (st === 'passive') return '被动模式';
    return '空闲';
  }

  function isNarrowUi() {
    return window.matchMedia('(max-width: 719px)').matches;
  }

  function isMobileChatUi() {
    if (MY_CLIENT === 'mobile') return true;
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
        if (window.Capacitor.isNativePlatform()) return true;
      }
    } catch (_) {}
    return isNarrowUi();
  }

  function applyMobileChatChrome() {
    const mobile = isMobileChatUi();
    document.body.classList.toggle('is-mobile-chat', mobile);
    if (!el.chatDock) return;
    if (mobile) {
      el.chatDock.classList.remove('is-custom-pos');
      el.chatDock.style.left = '';
      el.chatDock.style.top = '';
      el.chatDock.style.right = '';
      el.chatDock.style.bottom = '';
      el.chatDock.style.transform = '';
      el.chatDock.style.opacity = '';
    }
  }

  function setChatDockActive(active) {
    if (!el.chatDock) return;
    const on = Boolean(active);
    el.chatDock.classList.toggle('is-active', on);
    document.body.classList.toggle('is-chat-expanded', on && isMobileChatUi());
    if (!on) setChatInputFocused(false);
  }

  function setChatInputFocused(focused) {
    if (!isMobileChatUi()) return;
    document.body.classList.toggle('is-chat-focused', Boolean(focused));
  }

  let chatStickBottom = true;

  function isChatNearBottom(threshold) {
    if (!el.chatLog) return true;
    const pad = threshold != null ? threshold : 36;
    const maxScroll = Math.max(0, el.chatLog.scrollHeight - el.chatLog.clientHeight);
    return maxScroll - el.chatLog.scrollTop <= pad;
  }

  function scrollChatToBottom() {
    if (!el.chatLog) return;
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
    chatStickBottom = true;
  }

  function scheduleChatCollapse() {
    setTimeout(() => {
      if (!el.chatDock || el.chatDock.hidden) return;
      const ae = document.activeElement;
      if (ae && el.chatDock.contains(ae)) return;
      setChatDockActive(false);
    }, 0);
  }

  function updateChatPreview(msg) {
    if (!el.chatCollapsedPreview) return;
    if (!msg || !msg.text) {
      el.chatCollapsedPreview.textContent = '还没有人发言';
      return;
    }
    const who =
      (msg.name || '玩家') + (msg.tag ? '#' + String(msg.tag).slice(-5) : '');
    el.chatCollapsedPreview.textContent = who + '：' + msg.text;
  }

  function isRoomFull(room) {
    const count = Number(room && room.playerCount);
    const max = Number(room && room.maxPlayers);
    return Number.isFinite(count) && Number.isFinite(max) && max > 0 && count >= max;
  }

  function roomCanJoin(room) {
    if (!room || !room.host) return false;
    if (room.canJoin != null) return Boolean(room.canJoin);
    const waiting = !room.status || room.status === 'waiting';
    return waiting && !isRoomFull(room);
  }

  function roomCanSpectate(room) {
    if (!room || !room.host) return false;
    if (room.canSpectate != null) return Boolean(room.canSpectate);
    return (
      !room.status ||
      room.status === 'waiting' ||
      room.status === 'playing'
    );
  }

  function bindLongPress(node, onLongPress) {
    if (!node || typeof onLongPress !== 'function') return;
    let timer = null;
    let startX = 0;
    let startY = 0;
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    node.addEventListener(
      'pointerdown',
      (ev) => {
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        startX = ev.clientX;
        startY = ev.clientY;
        clear();
        timer = setTimeout(() => {
          timer = null;
          onLongPress(ev.clientX, ev.clientY);
        }, 480);
      },
      { passive: true }
    );
    node.addEventListener(
      'pointermove',
      (ev) => {
        if (!timer) return;
        if (
          Math.abs(ev.clientX - startX) > 12 ||
          Math.abs(ev.clientY - startY) > 12
        ) {
          clear();
        }
      },
      { passive: true }
    );
    node.addEventListener('pointerup', clear, { passive: true });
    node.addEventListener('pointercancel', clear, { passive: true });
  }

  function placeCtxMenu(menu, x, y) {
    if (!menu) return;
    menu.hidden = false;
    const pad = 8;
    const rect = menu.getBoundingClientRect();
    const w = rect.width || 180;
    const h = rect.height || 90;
    let left = x;
    let top = y;
    if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
    menu.style.left = Math.max(pad, left) + 'px';
    menu.style.top = Math.max(pad, top) + 'px';
  }

  function hideRoomCtx() {
    if (!el.roomCtx) return;
    el.roomCtx.hidden = true;
    roomCtxTarget = null;
  }

  function hidePeopleCtx() {
    if (!el.peopleCtx) return;
    el.peopleCtx.hidden = true;
    peopleCtxTarget = null;
  }

  function showRoomCtx(room, x, y) {
    if (!el.roomCtx || !room) return;
    hidePeopleCtx();
    roomCtxTarget = room;
    const btnJoin = el.roomCtx.querySelector('[data-action="room-join"]');
    const btnSpec = el.roomCtx.querySelector('[data-action="room-spectate"]');
    const hint = document.getElementById('room-ctx-hint');
    const canJoin = roomCanJoin(room);
    const canSpec = roomCanSpectate(room);
    if (btnJoin) {
      btnJoin.disabled = !canJoin;
      btnJoin.title = canJoin
        ? ''
        : room.status === 'playing'
          ? '对局已开始'
          : '房间已满或不可加入';
    }
    if (btnSpec) btnSpec.disabled = !canSpec;
    if (hint) {
      hint.hidden = canJoin || canSpec;
      hint.textContent = canJoin || canSpec ? '' : '暂无可用操作';
    }
    placeCtxMenu(el.roomCtx, x, y);
  }

  function showPeopleCtx(person, x, y) {
    if (!el.peopleCtx || !person) return;
    hideRoomCtx();
    peopleCtxTarget = person;
    const btnCreate = el.peopleCtx.querySelector('[data-action="create-on-host"]');
    const hint = document.getElementById('people-ctx-hint');
    const busy =
      person.occupied ||
      person.status === 'occupied' ||
      (person.passive &&
        person.status !== 'idle' &&
        person.status !== 'passive');
    const canCreate =
      !person.self &&
      person.passive &&
      !busy &&
      person.status === 'idle' &&
      Boolean(person.host);
    let reason = '';
    if (person.self) reason = '不能在自己这里代开';
    else if (!person.passive) reason = '对方未开被动模式';
    else if (busy) reason = '对方主机已被占用，请等待房间结束';
    else if (person.status !== 'idle') reason = '对方未开被动模式或已在房间';
    else if (!person.host) reason = '缺少对方公网地址';
    if (btnCreate) {
      btnCreate.disabled = !canCreate;
      btnCreate.title = canCreate ? '' : reason;
    }
    if (hint) {
      hint.hidden = canCreate;
      hint.textContent = canCreate ? '' : reason || '暂无可用操作';
    }
    placeCtxMenu(el.peopleCtx, x, y);
  }

  function appendRoomListItem(ul, room, { preferSpectate = false } = {}) {
    if (!ul || !room) return;
    const li = document.createElement('li');
    const info = document.createElement('span');
    info.className = 'room-list-info';
    const gameLabel = room.gameLabel || room.gameType || '游戏';
    const modeBit = room.gameModeLabel ? '·' + room.gameModeLabel : '';
    let playerBit =
      room.playerCount != null && room.maxPlayers != null
        ? room.playerCount + '/' + room.maxPlayers
        : String(room.playerCount != null ? room.playerCount : '?');
    if (Array.isArray(room.playerNames) && room.playerNames.length) {
      const tags = Array.isArray(room.playerTags) ? room.playerTags : [];
      const joined = room.playerNames
        .map((n, i) =>
          String(n || '') + (tags[i] ? '#' + String(tags[i]).slice(-5) : '')
        )
        .filter(Boolean)
        .join(' · ');
      if (joined) {
        playerBit =
          joined +
          ' (' +
          (room.playerCount != null ? room.playerCount : '?') +
          '/' +
          (room.maxPlayers != null ? room.maxPlayers : '?') +
          ')';
      }
    }
    const mobile = isMobileChatUi();
    if (mobile) {
      const title = document.createElement('span');
      title.className = 'mobile-room-title';
      title.textContent = room.name || room.id || '房间';
      const meta = document.createElement('span');
      meta.className = 'mobile-room-meta';
      meta.textContent = [
        gameLabel + modeBit,
        room.id ? '码 ' + room.id : null,
        room.hasPassword ? '密码' : null,
        room.status === 'playing' ? '对局中' : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const players = document.createElement('span');
      players.className = 'mobile-room-players';
      players.textContent = playerBit;
      info.appendChild(title);
      info.appendChild(meta);
      info.appendChild(players);
    } else {
      info.innerHTML =
        '<span class="room-list-head">' +
        '<span class="badge game-badge">' +
        escapeHtml(gameLabel) +
        escapeHtml(modeBit) +
        '</span> ' +
        escapeHtml(room.name || room.id || '房间') +
        (room.id
          ? ' <span class="room-list-code">' + escapeHtml(String(room.id).toUpperCase()) + '</span>'
          : '') +
        (room.hasPassword ? ' <span class="badge">密码</span>' : '') +
        (room.status === 'playing'
          ? ' <span class="badge">对局中</span>'
          : '') +
        '</span>' +
        '<span class="room-list-players">' +
        escapeHtml(playerBit) +
        '</span>';
    }
    const canJoin = roomCanJoin(room);
    const canSpec = roomCanSpectate(room);

    const btnSpec = document.createElement('button');
    btnSpec.type = 'button';
    btnSpec.textContent = '观战';
    btnSpec.className = 'secondary';
    if (!canSpec) {
      btnSpec.disabled = true;
      btnSpec.title = !room.host ? '暂无可用地址' : '不可观战';
    } else {
      btnSpec.addEventListener('click', () => openRoomWithPassword(room, 'spectate'));
    }

    const btnJoin = document.createElement('button');
    btnJoin.type = 'button';
    btnJoin.textContent = '加入';
    if (!canJoin) {
      btnJoin.disabled = true;
      btnJoin.title = !room.host
        ? '暂无可用地址'
        : room.status === 'playing'
          ? '对局已开始，请观战'
          : '房间已满';
      li.classList.add('is-full');
    } else {
      btnJoin.addEventListener('click', () => openRoomWithPassword(room, 'join'));
    }

    li.appendChild(info);
    li.appendChild(btnSpec);
    li.appendChild(btnJoin);
    li.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      showRoomCtx(room, ev.clientX, ev.clientY);
    });
    bindLongPress(li, (x, y) => showRoomCtx(room, x, y));
    ul.appendChild(li);
  }

  function renderRooms() {
    const now = Date.now();
    const items = [...rooms.values()]
      .filter(
        (r) =>
          r.updateTime &&
          now - r.updateTime <= ROOM_OFFLINE_MS &&
          (!r.status || r.status === 'waiting' || r.status === 'playing')
      )
      .sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0));

    const waiting = items.filter(
      (r) => r.status !== 'playing' && !r.over
    );
    const playing = items.filter((r) => r.status === 'playing' && !r.over);

    if (el.roomList) el.roomList.replaceChildren();
    if (el.roomListPlaying) el.roomListPlaying.replaceChildren();
    for (const r of waiting) appendRoomListItem(el.roomList, r);
    for (const r of playing) {
      appendRoomListItem(el.roomListPlaying, r, { preferSpectate: true });
    }
    if (el.roomEmpty) el.roomEmpty.hidden = waiting.length > 0;
    if (el.roomPlayingEmpty) el.roomPlayingEmpty.hidden = playing.length > 0;
    maybeOfferRejoinFromLobby(items);
  }

  function personLabelKey(person) {
    const name = String((person && person.name) || '').trim();
    const tag = String((person && person.tag) || '').trim();
    return `${name}#${tag}`;
  }

  function personStatusRank(person) {
    if (!person) return 0;
    if (person.occupied || person.status === 'occupied') return 6;
    if (person.status === 'playing') return 5;
    if (person.status === 'room' || person.status === 'spectating') return 4;
    if (person.passive && person.host && person.status === 'idle') return 3;
    if (person.passive) return 2;
    if (person.status === 'idle') return 1;
    return 0;
  }

  function mergeLobbyPerson(prev, person) {
    if (!prev) return { ...person };
    const pick = personStatusRank(person) >= personStatusRank(prev) ? person : prev;
    const other = pick === person ? prev : person;
    return {
      ...pick,
      key: pick.key || other.key,
      self: Boolean(prev.self || person.self),
      passive: Boolean(prev.passive || person.passive),
      occupied: Boolean(prev.occupied || person.occupied),
      host: pick.host || other.host || null,
      roomName: pick.roomName || other.roomName || null,
      client: pick.client || other.client || null,
      role: pick.role || other.role || null,
    };
  }

  function collectLobbyPeople() {
    const now = Date.now();
    const out = [];
    for (const [id, p] of logins) {
      if (!p || !p.updateTime || now - p.updateTime > LOGIN_OFFLINE_MS) continue;
      const people = Array.isArray(p.people) && p.people.length ? p.people : null;
      const loginHost = p.host ? String(p.host).replace(/\/$/, '') : '';
      if (people) {
        people.forEach((pp, i) => {
          const name = String((pp && pp.name) || '').trim();
          if (!name) return;
          const passive = Boolean(pp && pp.passive);
          const status = (pp && pp.status) || 'idle';
          const occupied =
            Boolean(pp && pp.occupied) || status === 'occupied';
          out.push({
            key: id + ':' + i,
            name,
            tag: (pp && pp.tag) || null,
            status,
            roomName: (pp && pp.roomName) || null,
            client: (pp && pp.client) || null,
            role: (pp && pp.role) || null,
            passive,
            occupied,
            host: passive ? loginHost || null : null,
            self: id === instanceId,
          });
        });
      } else if (p.displayName) {
        out.push({
          key: id,
          name: p.displayName,
          tag: p.displayTag || null,
          status: 'idle',
          roomName: null,
          client: null,
          role: null,
          passive: Boolean(p.passive),
          occupied: false,
          host: p.passive ? loginHost || null : null,
          self: id === instanceId,
        });
      }
    }

    // 同一昵称+尾缀只留一条（本机空闲 + 远端被动 合并为一人）
    const byLabel = new Map();
    const unlabeled = [];
    for (const person of out) {
      const label = personLabelKey(person);
      if (!label || label === '#') {
        unlabeled.push(person);
        continue;
      }
      byLabel.set(label, mergeLobbyPerson(byLabel.get(label), person));
    }
    const merged = [...byLabel.values(), ...unlabeled];
    merged.sort((a, b) => {
      if (a.status === 'offline' && b.status !== 'offline') return 1;
      if (a.status !== 'offline' && b.status === 'offline') return -1;
      if (a.self !== b.self) return a.self ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh');
    });
    return merged;
  }

  /** 可代开的被动主机（按公网地址去重） */
  function listAvailablePassiveHosts(peopleList) {
    const list = peopleList || collectLobbyPeople();
    const byHost = new Map();
    for (const p of list) {
      if (!p || p.self) continue;
      if (!p.passive || !p.host) continue;
      if (p.occupied || p.status === 'occupied') continue;
      if (p.status !== 'idle') continue;
      const host = normalizeHost(p.host);
      if (!host || byHost.has(host)) continue;
      byHost.set(host, p);
    }
    return [...byHost.values()];
  }

  function syncCreateRoomButton() {
    if (!el.btnCreateRoom) return;
    const n = listAvailablePassiveHosts().length;
    const ok = n >= 1;
    el.btnCreateRoom.setAttribute('aria-disabled', ok ? 'false' : 'true');
    el.btnCreateRoom.title = ok
      ? '可用被动服务端 ' + n + ' 台，将自动选择其一开房'
      : '无可用被动服务端';
  }

  function createRoomOnAvailablePassiveHost() {
    if (joining) return;
    const hosts = listAvailablePassiveHosts();
    if (!hosts.length) {
      showToast('无可用被动服务端');
      return;
    }
    const pick = hosts[Math.floor(Math.random() * hosts.length)];
    if (!pick || !pick.host) {
      showToast('无可用被动服务端');
      return;
    }
    openHost(pick.host, null, { mode: 'createPassive' });
  }

  function renderPeople() {
    const out = collectLobbyPeople();

    el.peopleList.replaceChildren();
    const available = out.filter(
      (p) =>
        p.status !== 'offline' &&
        p.status !== 'playing' &&
        p.status !== 'occupied' &&
        !p.occupied
    ).length;
    for (const p of out) {
      const li = document.createElement('li');
      li.className = 'people-item';

      const row1 = document.createElement('div');
      row1.className = 'people-row people-row-main';
      const name = document.createElement('span');
      name.className = 'people-name';
      name.innerHTML =
        nickHtml(p.name, p.tag) +
        (p.self ? ' <span class="you">(我)</span>' : '') +
        (p.occupied || p.status === 'occupied'
          ? ' <span class="badge">代开中</span>'
          : '') +
        remoteBadgeHtml(p.client, p.role);
      name.title =
        p.name + (p.tag ? '#' + String(p.tag).slice(-5) : '');
      row1.appendChild(name);

      const row2 = document.createElement('div');
      row2.className = 'people-row people-row-meta';
      const status =
        p.occupied || p.status === 'occupied'
          ? statusText('occupied', p.roomName)
          : p.passive && p.status === 'idle'
            ? statusText('passive')
            : statusText(p.status, p.roomName);
      row2.textContent = status || '空闲';
      row2.title = row2.textContent;

      if (p.status === 'offline') li.classList.add('is-offline');
      li.appendChild(row1);
      li.appendChild(row2);
      li.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        showPeopleCtx(p, ev.clientX, ev.clientY);
      });
      bindLongPress(li, (x, y) => showPeopleCtx(p, x, y));
      el.peopleList.appendChild(li);
    }
    el.peopleEmpty.hidden = out.length > 0;
    if (el.peopleCount) {
      el.peopleCount.textContent = out.length
        ? '（可组队 ' + available + ' / 共 ' + out.length + '）'
        : '';
    }
    syncCreateRoomButton();
  }

  function appendChat(msg) {
    if (!el.chatLog || !msg || !msg.text) return;
    const stick = chatStickBottom || isChatNearBottom();
    const li = document.createElement('li');
    const from = document.createElement('span');
    from.className = 'chat-from';
    from.textContent =
      (msg.name || '玩家') + (msg.tag ? '#' + String(msg.tag).slice(-5) : '');
    const text = document.createElement('span');
    text.className = 'chat-text';
    text.textContent = msg.text;
    li.appendChild(from);
    li.appendChild(document.createTextNode(' '));
    li.appendChild(text);
    el.chatLog.appendChild(li);
    while (el.chatLog.children.length > 80) {
      el.chatLog.removeChild(el.chatLog.firstChild);
    }
    if (stick) scrollChatToBottom();
    updateChatPreview(msg);
  }

  function clearPeerRoomBeacon(peerInstanceId) {
    const id = String(peerInstanceId || '').trim();
    if (!client || !client.connected || !id || id === instanceId) return;
    try {
      client.publish(prefix() + '/room/' + id, '', { qos: 1, retain: true });
    } catch (_) {}
  }

  function onPeerLoginCleared(id) {
    logins.delete(id);
    rooms.delete(id);
    clearPeerRoomBeacon(id);
    renderPeople();
    renderRooms();
  }

  function prune() {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of logins) {
      if (!p || !p.updateTime || now - p.updateTime > STALE_CLEAR_MS) {
        logins.delete(id);
        rooms.delete(id);
        changed = true;
      }
    }
    for (const [id, r] of rooms) {
      if (!r || !r.updateTime || now - r.updateTime > STALE_CLEAR_MS) {
        rooms.delete(id);
        changed = true;
      }
    }
    if (changed) {
      renderRooms();
      renderPeople();
    } else {
      // 轻量刷新超时项
      renderRooms();
      renderPeople();
    }
  }

  function clearLoginBeacon() {
    if (joining) return;
    try {
      if (sessionStorage.getItem(PLAY_JOIN_KEY)) return;
    } catch (_) {}
    if (!client || !client.connected || !instanceId) return;
    try {
      client.publish(prefix() + '/login/' + instanceId, '', {
        qos: 0,
        retain: true,
      });
    } catch (_) {}
  }

  function publishLoginExtra(status, roomId) {
    if (!client || !client.connected || !entered) return;
    const payload = {
      app: APP,
      instanceId,
      displayName: playerName,
      displayTag: playerTag || null,
      people: [
        {
          name: playerName,
          tag: playerTag || null,
          status: status || 'idle',
          roomId: roomId || null,
          roomName: null,
          sessionId,
          client: MY_CLIENT,
          role: MY_ROLE,
        },
      ],
      loginAt,
      updateTime: Date.now(),
    };
    client.publish(prefix() + '/login/' + instanceId, JSON.stringify(payload), {
      qos: 1,
      retain: true,
    });
  }

  function publishLogin() {
    if (!client || !client.connected || !entered) return;
    const payload = {
      app: APP,
      instanceId,
      displayName: playerName,
      displayTag: playerTag || null,
      people: [
        {
          name: playerName,
          tag: playerTag || null,
          status: 'idle',
          roomId: null,
          roomName: null,
          sessionId,
          client: MY_CLIENT,
          role: MY_ROLE,
        },
      ],
      loginAt,
      updateTime: Date.now(),
    };
    client.publish(prefix() + '/login/' + instanceId, JSON.stringify(payload), {
      qos: 1,
      retain: true,
    });
  }

  function handleMessage(topic, buf) {
    const raw = buf ? buf.toString() : '';
    const chatTopic = prefix() + '/chat/all';
    if (topic === chatTopic || topic.endsWith('/chat/all')) {
      if (!raw.trim()) return;
      try {
        const p = JSON.parse(raw);
        if (!p || p.app !== APP || p.kind !== 'chat') return;
        if (p.instanceId && p.instanceId === instanceId) return;
        appendChat(p);
      } catch (_) {}
      return;
    }

    const loginPrefix = prefix() + '/login/';
    const roomPrefix = prefix() + '/room/';
    if (topic.startsWith(loginPrefix)) {
      const id = topic.slice(loginPrefix.length);
      if (!id) return;
      if (!raw.trim()) {
        onPeerLoginCleared(id);
        return;
      }
      try {
        const p = JSON.parse(raw);
        if (!p || p.app !== APP) return;
        logins.set(id, {
          ...p,
          updateTime: Number(p.updateTime) || Date.now(),
        });
        renderPeople();
      } catch (_) {}
      return;
    }

    if (topic.startsWith(roomPrefix)) {
      const id = topic.slice(roomPrefix.length);
      if (!id) return;
      if (!raw.trim()) {
        rooms.delete(id);
        renderRooms();
        return;
      }
      try {
        const p = JSON.parse(raw);
        if (!p || p.app !== APP || !p.host || !p.id) return;
        rooms.set(id, {
          instanceId: id,
          id: String(p.id),
          name: String(p.name || ''),
          host: String(p.host).replace(/\/$/, ''),
          gameType: p.gameType || '',
          gameLabel: p.gameLabel || '',
          gameMode: p.gameMode || '',
          gameModeLabel: p.gameModeLabel || '',
          playerCount: p.playerCount,
          maxPlayers: p.maxPlayers,
          status: p.status || 'waiting',
          over: Boolean(p.over),
          hasPassword: Boolean(p.hasPassword),
          creatorName: p.creatorName || '',
          playerNames: Array.isArray(p.playerNames) ? p.playerNames : [],
          playerTags: Array.isArray(p.playerTags) ? p.playerTags : [],
          canJoin: p.canJoin,
          canSpectate: p.canSpectate,
          updateTime: Number(p.updateTime) || Date.now(),
        });
        renderRooms();
      } catch (_) {}
    }
  }

  function disconnectMqtt() {
    if (pruneTimer) {
      clearInterval(pruneTimer);
      pruneTimer = null;
    }
    if (loginTimer) {
      clearInterval(loginTimer);
      loginTimer = null;
    }
    clearLoginBeacon();
    if (client) {
      try {
        client.end(true);
      } catch (_) {}
      client = null;
    }
  }

  function connectMqtt() {
    const mqttLib =
      typeof mqtt !== 'undefined'
        ? mqtt
        : typeof window !== 'undefined'
          ? window.mqtt
          : null;
    if (!mqttLib || !mqttLib.connect) {
      if (el.peersLabel) el.peersLabel.textContent = '广播：MQTT 库未加载';
      showToast('发现服务未就绪，仍可用「房间码 / 地址」加入');
      hideBootSplash();
      return;
    }
    disconnectMqtt();
    rooms.clear();
    logins.clear();
    renderRooms();
    renderPeople();

    if (el.peersLabel) el.peersLabel.textContent = '广播：连接中…';
    if (bootSplashPending && el.bootSplashText) {
      el.bootSplashText.textContent = '正在连接广播…';
    }
    client = mqttLib.connect(BROKER, {
      clientId: 'lianji-and-' + instanceId.slice(0, 8),
      protocolVersion: 4,
      clean: true,
      keepalive: 60,
      reconnectPeriod: 8000,
      connectTimeout: 12000,
      will: {
        topic: prefix() + '/login/' + instanceId,
        payload: '',
        qos: 1,
        retain: true,
      },
    });

    client.on('connect', () => {
      const base = prefix();
      client.subscribe(
        [base + '/login/+', base + '/room/+', base + '/chat/all'],
        { qos: 1 },
        (err) => {
          if (err) {
            if (el.peersLabel) el.peersLabel.textContent = '广播：订阅失败';
            hideBootSplash();
            return;
          }
          if (el.peersLabel) el.peersLabel.textContent = '广播：已连接';
          publishLogin();
          flushPersistedLeaves();
          hideBootSplash();
        }
      );
    });
    client.on('message', handleMessage);
    client.on('error', () => {
      if (el.peersLabel) el.peersLabel.textContent = '广播：连接异常';
    });
    client.on('close', () => {
      if (entered && el.peersLabel) {
        el.peersLabel.textContent = '广播：已断开，重连中…';
      }
    });

    pruneTimer = setInterval(prune, 5000);
    loginTimer = setInterval(publishLogin, LOGIN_HB_MS);
  }

  function enterLobby() {
    try {
      const name = String((el.playerName && el.playerName.value) || '')
        .trim()
        .slice(0, 16);
      if (!name) {
        showToast('请输入昵称');
        return;
      }
      playerName = name;
      try {
        localStorage.setItem(STORAGE_NICK, name);
        if (!localStorage.getItem(STORAGE_TAG)) {
          localStorage.setItem(
            STORAGE_TAG,
            String(Math.floor(10000 + Math.random() * 90000))
          );
        }
        if (!localStorage.getItem(STORAGE_SID)) {
          localStorage.setItem(STORAGE_SID, uid('s'));
        }
        playerTag = localStorage.getItem(STORAGE_TAG) || '';
        sessionId = localStorage.getItem(STORAGE_SID) || uid('s');
      } catch (_) {
        playerTag = String(Math.floor(10000 + Math.random() * 90000));
        sessionId = uid('s');
      }
      if (!instanceId) instanceId = uid('and');
      loginAt = Date.now();
      entered = true;

      if (el.gate) el.gate.hidden = true;
      if (el.main) el.main.hidden = false;
      if (el.peopleAside) el.peopleAside.hidden = false;
      if (el.chatDock) {
        el.chatDock.hidden = false;
        applyMobileChatChrome();
        // 进入大厅后默认收起，点开/聚焦输入再展开
        setChatDockActive(false);
      }
      if (el.headerNick) el.headerNick.hidden = false;
      refreshNickUi();
      if (el.meLabel) {
        el.meLabel.textContent = CLIENT_LABEL + ' · 已进入大厅';
      }

      // 先切界面，再连 MQTT（避免库异常导致“点了没反应”）
      if (wantsBootSplash()) showBootSplash('正在连接广播…');
      setTimeout(() => {
        try {
          connectMqtt();
        } catch (err) {
          if (el.peersLabel) {
            el.peersLabel.textContent = '广播：连接失败';
          }
          showToast(
            (err && err.message) || '广播连接失败，仍可用地址加入房间'
          );
          hideBootSplash();
        }
      }, 0);
    } catch (err) {
      showToast((err && err.message) || '进入大厅失败');
      console.error('[lianji] enterLobby', err);
      hideBootSplash();
    }
  }

  function joinFromModal() {
    const url = String(el.hostUrl.value || '').trim();
    const code = String(el.joinCode.value || '').trim();
    const password = String(
      (el.joinPassword && el.joinPassword.value) || ''
    );
    const mode = codeModalMode === 'spectate' ? 'spectate' : 'join';
    setJoinOpen(false);
    joinRemoteByCode(code, url, mode, password);
  }

  function sendChat(text) {
    const body = String(text || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    if (!body) return;
    const now = Date.now();
    if (now - lastChatAt < 700) {
      showToast('发送太快，请稍候');
      return;
    }
    lastChatAt = now;
    if (!client || !client.connected) {
      showToast('广播未连接，无法发送');
      return;
    }
    const msg = {
      app: APP,
      kind: 'chat',
      channel: 'all',
      roomId: null,
      name: playerName,
      tag: playerTag || null,
      sessionId,
      instanceId,
      text: body,
      at: now,
    };
    client.publish(prefix() + '/chat/all', JSON.stringify(msg), {
      qos: 0,
      retain: false,
    });
    appendChat(msg);
  }

  function bindUi() {
    if (!wantsBootSplash()) {
      bootSplashPending = false;
      document.body.classList.remove('is-booting');
      if (el.bootSplash) {
        el.bootSplash.hidden = true;
        el.bootSplash.setAttribute('aria-busy', 'false');
      }
    }

    if (el.btnEnter) {
      el.btnEnter.addEventListener('click', (ev) => {
        ev.preventDefault();
        enterLobby();
      });
    } else {
      console.error('[lianji] missing #btn-enter-lobby');
    }
    if (el.playerName) {
      el.playerName.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          enterLobby();
        }
      });
    }
    if (el.btnEditName) {
      el.btnEditName.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!entered) return;
        setNickEditing(true);
      });
    }
    if (el.playerNameEdit) {
      el.playerNameEdit.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          commitNickEdit();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          cancelNickEdit();
        }
      });
      el.playerNameEdit.addEventListener('click', (ev) => ev.stopPropagation());
      el.playerNameEdit.addEventListener('blur', () => {
        if (!nickEditing) return;
        commitNickEdit();
      });
    }
    document.addEventListener('pointerdown', (ev) => {
      if (!nickEditing) return;
      if (el.headerNick && el.headerNick.contains(ev.target)) return;
      commitNickEdit();
    });

    if (el.btnJoin) {
      el.btnJoin.addEventListener('click', () => setJoinOpen(true, 'join'));
    }
    if (el.btnCreateRoom) {
      el.btnCreateRoom.addEventListener('click', () => {
        if (!entered) {
          showToast('请先进入大厅');
          return;
        }
        createRoomOnAvailablePassiveHost();
      });
    }
    if (el.btnCloseJoin) {
      el.btnCloseJoin.addEventListener('click', () => setJoinOpen(false));
    }
    document.querySelectorAll('[data-close="join"]').forEach((node) => {
      node.addEventListener('click', () => setJoinOpen(false));
    });
    if (el.btnJoinConfirm) {
      el.btnJoinConfirm.addEventListener('click', joinFromModal);
    }
    if (el.btnAcceptRejoin) {
      el.btnAcceptRejoin.addEventListener('click', () => acceptPendingRejoin());
    }
    if (el.btnDeclineRejoin) {
      el.btnDeclineRejoin.addEventListener('click', () => declinePendingRejoin());
    }
    if (el.btnCloseRejoin) {
      el.btnCloseRejoin.addEventListener('click', () => declinePendingRejoin());
    }
    document.querySelectorAll('[data-close="rejoin"]').forEach((node) => {
      node.addEventListener('click', () => declinePendingRejoin());
    });
    if (el.roomCtx) {
      el.roomCtx.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-action]');
        if (!btn || !roomCtxTarget) return;
        if (btn.disabled) {
          showToast(btn.title || '不可用');
          return;
        }
        const action = btn.getAttribute('data-action');
        const room = roomCtxTarget;
        hideRoomCtx();
        if (action === 'room-join') openRoomWithPassword(room, 'join');
        else if (action === 'room-spectate') {
          openRoomWithPassword(room, 'spectate');
        }
      });
    }
    if (el.peopleCtx) {
      el.peopleCtx.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-action]');
        if (!btn || !peopleCtxTarget) return;
        if (btn.disabled) {
          showToast(btn.title || '不可用');
          return;
        }
        const action = btn.getAttribute('data-action');
        const person = peopleCtxTarget;
        hidePeopleCtx();
        if (action === 'create-on-host') {
          if (!person.host) {
            showToast('缺少对方公网地址');
            return;
          }
          openHost(person.host, null, { mode: 'createPassive' });
        }
      });
    }
    document.addEventListener('pointerdown', (ev) => {
      if (ev.button === 2) return;
      if (el.peopleCtx && !el.peopleCtx.hidden && !el.peopleCtx.contains(ev.target)) {
        hidePeopleCtx();
      }
      if (el.roomCtx && !el.roomCtx.hidden && !el.roomCtx.contains(ev.target)) {
        hideRoomCtx();
      }
    });
    if (el.btnRefreshPeople) {
      el.btnRefreshPeople.addEventListener('click', () => {
        if (!entered) return;
        prune();
        renderPeople();
        renderRooms();
        showToast('已刷新大厅列表');
      });
    }
    if (el.chatForm) {
      el.chatForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        sendChat(el.chatInput.value);
        el.chatInput.value = '';
        // 发送后保持焦点，方便连续输入；点空白处失焦才会收起
        if (isMobileChatUi() && el.chatInput) {
          el.chatInput.focus();
        }
      });
    }
    if (el.chatInput) {
      el.chatInput.addEventListener('focus', () => {
        setChatDockActive(true);
        setChatInputFocused(true);
      });
      el.chatInput.addEventListener('blur', (ev) => {
        setChatInputFocused(false);
        const next = ev.relatedTarget;
        if (next && el.chatDock && el.chatDock.contains(next)) return;
        // Android 上 relatedTarget 常为空，延后判断实际焦点
        scheduleChatCollapse();
      });
    }
    if (el.chatLog) {
      el.chatLog.addEventListener(
        'scroll',
        () => {
          chatStickBottom = isChatNearBottom();
        },
        { passive: true }
      );
      // 手指在消息区滑动时不把手势交给外层页面
      el.chatLog.addEventListener(
        'touchstart',
        (ev) => {
          ev.stopPropagation();
        },
        { passive: true }
      );
      el.chatLog.addEventListener(
        'touchmove',
        (ev) => {
          ev.stopPropagation();
        },
        { passive: true }
      );
    }
    if (el.chatDock) {
      el.chatDock.addEventListener('click', (ev) => {
        if (el.chatDock.classList.contains('is-active')) return;
        if (ev.target.closest('.chat-head')) return;
        setChatDockActive(true);
        if (isMobileChatUi() && el.chatInput && !ev.target.closest('button')) {
          try {
            el.chatInput.focus();
          } catch (_) {}
        }
      });
    }
    if (el.chatHead) {
      el.chatHead.addEventListener('click', (ev) => {
        if (!el.chatDock) return;
        ev.stopPropagation();
        const on = el.chatDock.classList.contains('is-active');
        if (on) {
          if (el.chatInput) {
            try {
              el.chatInput.blur();
            } catch (_) {}
          }
          setChatDockActive(false);
        } else {
          setChatDockActive(true);
          chatStickBottom = true;
          scrollChatToBottom();
          if (isMobileChatUi() && el.chatInput) {
            try {
              el.chatInput.focus();
            } catch (_) {}
          }
        }
      });
    }
    // 启动即按端型套用；默认收起，失焦后缩起
    applyMobileChatChrome();
    setChatDockActive(false);
    window.addEventListener('resize', () => {
      applyMobileChatChrome();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) scheduleChatCollapse();
    });
    // 点聊天室外区域：收起并失焦（所有客户端统一行为）
    document.addEventListener(
      'pointerdown',
      (ev) => {
        if (!el.chatDock || el.chatDock.hidden) return;
        if (!el.chatDock.classList.contains('is-active')) return;
        if (el.chatDock.contains(ev.target)) return;
        if (el.chatInput) {
          try {
            el.chatInput.blur();
          } catch (_) {}
        }
        setChatDockActive(false);
      },
      true
    );

    try {
      const nick = String(localStorage.getItem(STORAGE_NICK) || '')
        .trim()
        .slice(0, 16);
      if (nick && el.playerName) el.playerName.value = nick;
      // 与电脑端一致：已有昵称则自动进入大厅（加载动画持续到 MQTT 连上）
      if (nick) {
        enterLobby();
      } else if (wantsBootSplash()) {
        // 需先填昵称：结束启动遮罩，露出大厅门
        hideBootSplash();
      }
    } catch (_) {
      if (wantsBootSplash()) hideBootSplash();
    }

    window.addEventListener('pagehide', clearLoginBeacon);
    window.addEventListener('beforeunload', clearLoginBeacon);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUi);
  } else {
    bindUi();
  }
})();
