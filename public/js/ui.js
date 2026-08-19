'use strict';

(async function () {
  const net = window.GameNet;

  const el = {
    meLabel: document.getElementById('me-label'),
    toast: document.getElementById('toast'),
    viewLobby: document.getElementById('view-lobby'),
    viewRoom: document.getElementById('view-room'),
    viewGame: document.getElementById('view-game'),
    playerName: document.getElementById('player-name'),
    playerNameEdit: document.getElementById('player-name-edit'),
    nickDisplay: document.getElementById('nick-display'),
    headerNick: document.getElementById('header-nick'),
    btnEditName: document.getElementById('btn-edit-name'),
    btnEnterLobby: document.getElementById('btn-enter-lobby'),
    lobbyGate: document.getElementById('lobby-gate'),
    lobbyMain: document.getElementById('lobby-main'),
    btnToggleCreate: document.getElementById('btn-toggle-create'),
    btnToggleJoin: document.getElementById('btn-toggle-join'),
    btnRefreshLobby: document.getElementById('btn-refresh-lobby'),
    lobbyRefreshHint: document.getElementById('lobby-refresh-hint'),
    btnCloseCreate: document.getElementById('btn-close-create'),
    btnCloseJoin: document.getElementById('btn-close-join'),
    createRoomModal: document.getElementById('create-room-modal'),
    joinCodeModal: document.getElementById('join-code-modal'),
    peersLabel: document.getElementById('peers-label'),
    lobbyPeopleAside: document.getElementById('lobby-people-aside'),
    chatDock: document.getElementById('chat-dock'),
    chatDragHandle: document.getElementById('chat-drag-handle'),
    chatPanel: document.getElementById('chat-panel'),
    chatCollapsedPreview: document.getElementById('chat-collapsed-preview'),
    chatHeadChannel: document.getElementById('chat-head-channel'),
    chatHeadUnread: document.getElementById('chat-head-unread'),
    lobbyPeopleList: document.getElementById('lobby-people-list'),
    lobbyPeopleTitle: document.getElementById('lobby-people-title'),
    appPhaseTitle: document.getElementById('app-phase-title'),
    lobbyPeopleEmpty: document.getElementById('lobby-people-empty'),
    lobbyPeopleCount: document.getElementById('lobby-people-count'),
    btnRefreshDoc: document.getElementById('btn-refresh-doc'),
    chatTabAll: document.getElementById('chat-tab-all'),
    chatTabRoom: document.getElementById('chat-tab-room'),
    chatTabs: document.querySelector('.chat-tabs'),
    chatUnreadAll: document.getElementById('chat-unread-all'),
    chatUnreadRoom: document.getElementById('chat-unread-room'),
    chatLog: document.getElementById('chat-log'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    gameType: document.getElementById('game-type'),
    gameMode: document.getElementById('game-mode'),
    gameModeWrap: document.getElementById('game-mode-wrap'),
    roomMax: document.getElementById('room-max'),
    maxPlayersWrap: document.getElementById('max-players-wrap'),
    roomName: document.getElementById('room-name'),
    roomHidden: document.getElementById('room-hidden'),
    roomTurnTime: document.getElementById('room-turn-time'),
    gameHint: document.getElementById('game-hint'),
    btnCreateRoom: document.getElementById('btn-create-room'),
    joinCode: document.getElementById('join-code'),
    btnJoinCode: document.getElementById('btn-join-code'),
    roomList: document.getElementById('room-list'),
    roomListEmpty: document.getElementById('room-list-empty'),
    roomTitle: document.getElementById('room-title'),
    roomGameLabel: document.getElementById('room-game-label'),
    roomCode: document.getElementById('room-code'),
    roomHiddenBadge: document.getElementById('room-hidden-badge'),
    memberList: document.getElementById('member-list'),
    btnStart: document.getElementById('btn-start'),
    btnLeave: document.getElementById('btn-leave'),
    roomStartHint: document.getElementById('room-start-hint'),
    gameMenu: document.getElementById('game-menu'),
    btnGameMenu: document.getElementById('btn-game-menu'),
    gameMenuPop: document.getElementById('game-menu-pop'),
    btnQuitGame: document.getElementById('btn-quit-game'),
    turnTimer: document.getElementById('turn-timer'),
    turnTimerSec: document.getElementById('turn-timer-sec'),
    peopleCtx: document.getElementById('people-ctx'),
    rejoinModal: document.getElementById('rejoin-modal'),
    rejoinMessage: document.getElementById('rejoin-message'),
    btnAcceptRejoin: document.getElementById('btn-accept-rejoin'),
    btnDeclineRejoin: document.getElementById('btn-decline-rejoin'),
    btnCloseRejoin: document.getElementById('btn-close-rejoin'),
  };

  const state = {
    me: null,
    room: null,
    game: null,
    games: [],
    people: [],
    lobbyRooms: [],
    inLobby: false,
    playerName: '',
    pendingRejoin: null,
    ctxTarget: null,
    mqttBulletin: false,
    mqttHintShown: false,
    chatChannel: 'all',
    chatAll: [],
    chatRoom: [],
    chatRoomId: null,
    unreadAll: 0,
    unreadRoom: 0,
    roomChatBubbles: {},
    chatNeedsAttention: false,
  };

  let board = null;
  let toastTimer = null;
  let leavingToLocal = false;
  let lobbyRefreshTimer = null;
  let remoteRecoverTimer = null;
  let remoteRecovering = false;
  const roomBubbleTimers = new Map();
  const ROOM_BUBBLE_MS = 3000;
  const LOBBY_REFRESH_MS = 3000;
  const NICK_STORAGE_KEY = 'lianji.playerName';

  function loadSavedNick() {
    try {
      const raw = localStorage.getItem(NICK_STORAGE_KEY);
      const name = window.PlayerNick.stripBaseName(raw || '');
      return name || '';
    } catch (_) {
      return '';
    }
  }

  function saveNick(name) {
    const next = window.PlayerNick.stripBaseName(name) || '玩家';
    try {
      localStorage.setItem(NICK_STORAGE_KEY, next);
    } catch (_) {
      /* ignore quota / private mode */
    }
  }

  function nickHtml(name, tag) {
    return window.PlayerNick.formatHtml(name, tag);
  }

  function myTag() {
    return (
      (state.me && state.me.tag) ||
      window.PlayerNick.ensureTag()
    );
  }

  const CHAT_MAX = 80;
  const chatSeen = new Set();

  const CHAT_DOCK_POS_KEY = 'lianji.chatDockPos';
  let chatDockPosLoaded = false;

  let chatDockDragging = false;
  let chatDockDragMoved = false;
  let chatDockDragStart = null;
  let chatDockPreserveActive = false;

  function clearChatAttention() {
    if (state.chatNeedsAttention) {
      console.debug('[chat-debug] clear attention', {
        channel: state.chatChannel,
        allCount: state.chatAll.length,
        roomCount: state.chatRoom.length,
      });
    }
    state.chatNeedsAttention = false;
    if (el.chatHeadUnread) {
      el.chatHeadUnread.hidden = true;
      el.chatHeadUnread.textContent = '新消息';
    }
  }

  function setChatDockActive(active) {
    if (!el.chatDock) return;
    const on = Boolean(active);
    el.chatDock.classList.toggle('is-active', on);
    if (on) {
      clearChatAttention();
    }
    syncChatTabs();
    updateChatCollapsedPreview();
  }

  function currentChatList() {
    return state.chatChannel === 'room' ? state.chatRoom : state.chatAll;
  }

  function updateChatCollapsedPreview() {
    if (!el.chatCollapsedPreview) return;
    const list = currentChatList();
    const previewList = list && list.length ? list.slice(-3) : [];
    if (!previewList.length) {
      console.debug('[chat-debug] collapsed preview empty', {
        channel: state.chatChannel,
        allCount: state.chatAll.length,
        roomCount: state.chatRoom.length,
      });
      el.chatCollapsedPreview.textContent =
        state.chatChannel === 'room' ? '房间内暂无消息' : '还没有人发言';
      return;
    }
    const html = previewList
      .map((msg) => {
        const name = window.PlayerNick.fullLabel(msg.name || '玩家', msg.tag || '');
        return `<div class="chat-collapsed-line">${escapeHtml(name)}: ${escapeHtml(msg.text || '')}</div>`;
      })
      .join('');
    console.debug('[chat-debug] collapsed preview render', {
      channel: state.chatChannel,
      count: previewList.length,
      lines: previewList.map((msg) => ({
        name: window.PlayerNick.fullLabel(msg.name || '玩家', msg.tag || ''),
        text: msg.text || '',
      })),
      html,
    });
    el.chatCollapsedPreview.innerHTML = html;
  }

  function focusChatInput() {
    if (!el.chatDock || !el.chatInput) return;
    if (el.chatDock.hidden) return;
    setChatDockActive(true);
    try {
      el.chatInput.focus();
      if (typeof el.chatInput.select === 'function') el.chatInput.select();
    } catch (_) {}
  }

  function isMyChatMessage(msg) {
    if (!msg) return false;
    const myTagNow = window.PlayerNick.normalizeTag(myTag());
    const msgTag = window.PlayerNick.normalizeTag(msg.tag);
    if (myTagNow && msgTag) return myTagNow === msgTag;
    const myName = window.PlayerNick.stripBaseName(state.playerName || '');
    const msgName = window.PlayerNick.stripBaseName(msg.name || '');
    return Boolean(myName && msgName && myName === msgName);
  }

  function isTextLikeTarget(target) {
    if (!target) return false;
    const tag = target.tagName ? String(target.tagName).toUpperCase() : '';
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      tag === 'BUTTON' ||
      target.isContentEditable
    );
  }

  function loadChatDockPos() {
    if (!el.chatDock) return;
    try {
      const raw = localStorage.getItem(CHAT_DOCK_POS_KEY);
      if (!raw) {
        el.chatDock.classList.remove('is-custom-pos');
        el.chatDock.style.left = '';
        el.chatDock.style.bottom = '';
        return;
      }
      const pos = JSON.parse(raw);
      if (
        !pos ||
        typeof pos.left !== 'number' ||
        typeof pos.bottom !== 'number'
      )
        return;
      const rect = el.chatDock.getBoundingClientRect();
      const w = rect.width || el.chatDock.offsetWidth;
      const h = rect.height || el.chatDock.offsetHeight;
      const left = Math.max(0, Math.min(pos.left, window.innerWidth - w));
      const bottom = Math.max(
        0,
        Math.min(pos.bottom, window.innerHeight - h)
      );
      el.chatDock.classList.add('is-custom-pos');
      el.chatDock.style.left = `${left}px`;
      el.chatDock.style.bottom = `${bottom}px`;
    } catch (_) {
      /* ignore */
    }
  }

  function saveChatDockPos() {
    if (!el.chatDock) return;
    try {
      const rect = el.chatDock.getBoundingClientRect();
      const left = Math.round(rect.left);
      const bottom = Math.round(window.innerHeight - rect.bottom);
      el.chatDock.classList.add('is-custom-pos');
      localStorage.setItem(
        CHAT_DOCK_POS_KEY,
        JSON.stringify({ left, bottom })
      );
    } catch (_) {
      /* ignore */
    }
  }

  function tagHue(tag) {
    const s = String(tag || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function chatSpeakerKey(msg) {
    const tag = window.PlayerNick.normalizeTag(msg && msg.tag);
    if (tag) return `t:${tag}`;
    const name = window.PlayerNick.stripBaseName((msg && msg.name) || '');
    return `n:${name || '玩家'}`;
  }

  function memberSpeakerKey(player) {
    const tag = window.PlayerNick.normalizeTag(player && player.tag);
    if (tag) return `t:${tag}`;
    const name = window.PlayerNick.stripBaseName((player && player.name) || '');
    return `n:${name || '玩家'}`;
  }

  function findMemberRowForSpeaker(key) {
    if (!el.memberList || !key) return null;
    for (const li of el.memberList.querySelectorAll('li[data-speaker-key]')) {
      if (li.dataset.speakerKey === key) return li;
    }
    return null;
  }

  function clearRoomChatBubbles() {
    for (const timer of roomBubbleTimers.values()) clearTimeout(timer);
    roomBubbleTimers.clear();
    state.roomChatBubbles = {};
    if (el.memberList) {
      el.memberList.querySelectorAll('.room-chat-bubble').forEach((node) => node.remove());
    }
  }

  function removeRoomChatBubble(key) {
    const row = findMemberRowForSpeaker(key);
    if (row) {
      const bubble = row.querySelector('.room-chat-bubble');
      if (bubble) bubble.remove();
    }
    if (state.roomChatBubbles) delete state.roomChatBubbles[key];
  }

  function paintRoomChatBubble(key) {
    const entry = state.roomChatBubbles && state.roomChatBubbles[key];
    if (!entry || !entry.text) return;
    const row = findMemberRowForSpeaker(key);
    if (!row) return;

    let bubble = row.querySelector('.room-chat-bubble');
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'room-chat-bubble';
      bubble.setAttribute('role', 'status');
      row.appendChild(bubble);
    }
    bubble.textContent = entry.text;
    bubble.classList.remove('is-in');
    void bubble.offsetWidth;
    bubble.classList.add('is-in');
  }

  function syncRoomChatBubbles() {
    if (!state.roomChatBubbles) return;
    for (const key of Object.keys(state.roomChatBubbles)) {
      paintRoomChatBubble(key);
    }
  }

  function showRoomChatBubble(msg) {
    if (!msg || !msg.text) return;
    if (el.viewGame && !el.viewGame.hidden) {
      showGameChatFly(msg);
      return;
    }
    if (!state.room || !el.viewRoom || el.viewRoom.hidden) return;

    const key = chatSpeakerKey(msg);
    if (roomBubbleTimers.has(key)) {
      clearTimeout(roomBubbleTimers.get(key));
      roomBubbleTimers.delete(key);
    }

    if (!state.roomChatBubbles) state.roomChatBubbles = {};
    state.roomChatBubbles[key] = { text: msg.text, at: msg.at || Date.now() };
    paintRoomChatBubble(key);

    roomBubbleTimers.set(
      key,
      setTimeout(() => {
        removeRoomChatBubble(key);
        roomBubbleTimers.delete(key);
      }, ROOM_BUBBLE_MS)
    );
  }

  function showGameChatFly(msg) {
    const node = document.createElement('div');
    node.className = 'game-chat-fly';
    const name = window.PlayerNick.fullLabel(msg.name || '玩家', msg.tag || '');
    node.textContent = `${name}: ${msg.text || ''}`;
    const laneTop = 88 + Math.floor(Math.random() * 220);
    node.style.top = `${laneTop}px`;
    document.body.appendChild(node);
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => {
      if (node.isConnected) node.remove();
    }, 4200);
  }

  function chatKey(msg) {
    return [
      msg.at || 0,
      msg.instanceId || '',
      msg.sessionId || '',
      msg.tag || '',
      msg.channel || '',
      msg.text || '',
    ].join('|');
  }

  function syncChatTabs() {
    const inRoom = Boolean(state.room && state.room.id);
    if (el.chatTabRoom) {
      el.chatTabRoom.hidden = !inRoom;
    }
    if (el.chatTabs) {
      el.chatTabs.classList.toggle('is-solo', !inRoom);
    }
    if (!inRoom && state.chatChannel === 'room') {
      state.chatChannel = 'all';
    }
    if (el.chatTabAll) el.chatTabAll.classList.toggle('is-on', state.chatChannel === 'all');
    if (el.chatTabRoom) {
      el.chatTabRoom.classList.toggle('is-on', inRoom && state.chatChannel === 'room');
    }
    if (el.chatInput) {
      el.chatInput.placeholder =
        state.chatChannel === 'room' ? '房间频道…' : '所有人…';
    }
    if (el.chatHeadChannel) {
      el.chatHeadChannel.textContent =
        state.chatChannel === 'room' ? '房间' : '所有人';
      el.chatHeadChannel.classList.toggle('is-room', state.chatChannel === 'room');
    }
    const paintUnread = (node, n) => {
      if (!node) return;
      if (n > 0) {
        node.hidden = false;
        node.textContent = n > 9 ? '9+' : String(n);
      } else {
        node.hidden = true;
        node.textContent = '';
      }
    };
    paintUnread(el.chatUnreadAll, state.unreadAll);
    paintUnread(el.chatUnreadRoom, state.unreadRoom);
    if (el.chatHeadUnread) {
      el.chatHeadUnread.hidden = !state.chatNeedsAttention;
    }
    updateChatCollapsedPreview();
  }

  function setChatChannel(channel) {
    if (channel === 'room' && !(state.room && state.room.id)) return;
    state.chatChannel = channel === 'room' ? 'room' : 'all';
    if (state.chatChannel === 'all') state.unreadAll = 0;
    else state.unreadRoom = 0;
    syncChatTabs();
    renderChatLog();
  }

  function renderChatLog() {
    if (!el.chatLog) return;
    const list =
      state.chatChannel === 'room' ? state.chatRoom : state.chatAll;
    const myTagNow = myTag();
    const myName = window.PlayerNick.stripBaseName(state.playerName || '');
    el.chatLog.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('li');
      empty.className = 'chat-empty';
      empty.textContent =
        state.chatChannel === 'room' ? '房间内暂无消息' : '还没有人发言';
      el.chatLog.appendChild(empty);
      return;
    }
    for (const msg of list) {
      const li = document.createElement('li');
      const mine =
        (msg.tag && msg.tag === myTagNow) ||
        (!msg.tag && msg.name === myName);
      if (mine) li.classList.add('is-mine');
      const hue = tagHue(msg.tag || msg.name);
      const from = nickHtml(msg.name || '玩家', msg.tag);
      li.innerHTML =
        `<span class="chat-dot" style="background:hsl(${hue},52%,58%)"></span>` +
        `<span class="chat-body">` +
        `<span class="chat-from">${from}</span>` +
        `<span class="chat-text">${escapeHtml(msg.text)}</span>` +
        `</span>`;
      el.chatLog.appendChild(li);
    }
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }

  function pushChatMessage(msg) {
    if (!msg || !msg.text) return;
    const channel = msg.channel === 'room' ? 'room' : msg.channel === 'all' ? 'all' : '';
    if (!channel) return;
    const key = chatKey(msg);
    if (chatSeen.has(key)) return;
    chatSeen.add(key);
    if (chatSeen.size > 400) {
      const first = chatSeen.values().next().value;
      chatSeen.delete(first);
    }
    if (channel === 'room') {
      const rid = msg.roomId ? String(msg.roomId).toUpperCase() : '';
      const cur = state.room && state.room.id ? String(state.room.id).toUpperCase() : '';
      if (!rid || !cur || rid !== cur) return;
      state.chatRoom.push(msg);
      if (state.chatRoom.length > CHAT_MAX) state.chatRoom.shift();
      if (state.chatChannel !== 'room') state.unreadRoom += 1;
      showRoomChatBubble(msg);
    } else {
      state.chatAll.push(msg);
      if (state.chatAll.length > CHAT_MAX) state.chatAll.shift();
      if (state.chatChannel !== 'all') state.unreadAll += 1;
    }
    syncChatTabs();
    if (state.chatChannel === channel) renderChatLog();
    if (
      !isMyChatMessage(msg) &&
      (!el.chatDock || !el.chatDock.classList.contains('is-active'))
    ) {
      console.debug('[chat-debug] set attention from chat message', {
        channel,
        text: msg.text,
        name: msg.name || '',
        tag: msg.tag || '',
        roomId: msg.roomId || null,
        at: msg.at || null,
        active: Boolean(el.chatDock && el.chatDock.classList.contains('is-active')),
      });
      state.chatNeedsAttention = true;
      if (el.chatHeadUnread) el.chatHeadUnread.hidden = false;
      updateChatCollapsedPreview();
    }
  }

  function rememberChatRoom(roomId) {
    const next = roomId ? String(roomId).toUpperCase() : null;
    const prev = state.chatRoomId;
    if (prev && next && prev !== next) {
      state.chatRoom = [];
      state.unreadRoom = 0;
      clearRoomChatBubbles();
    }
    if (!next) {
      state.chatRoom = [];
      state.unreadRoom = 0;
      state.chatRoomId = null;
      clearRoomChatBubbles();
      setChatChannel('all');
      return;
    }
    const justEntered = prev !== next;
    state.chatRoomId = next;
    if (justEntered) setChatChannel('room');
    else syncChatTabs();
  }

  const SESSION_STORAGE_KEY = 'lianji.tabSessionId';
  const ACTIVE_PLAY_KEY = 'lianji.activePlay';
  const GAME_ARCHIVE_KEY = 'lianji.gameArchive';

  /** 每个浏览器标签页独立会话，用于对局断线重连认领座位 */
  function getTabSessionId() {
    try {
      let id = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!id) {
        id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(SESSION_STORAGE_KEY, id);
      }
      return id;
    } catch (_) {
      return `s_${Date.now()}`;
    }
  }

  function lobbyJoinOpts(extra = {}) {
    return {
      sessionId: getTabSessionId(),
      playerTag: myTag(),
      // 普通进大厅不带房间认领，避免刷新后自动抢座
      roomId: null,
      oldPlayerId: null,
      rejoin: false,
      ...extra,
    };
  }

  /** 用户确认重连时：用存档房间码 + 旧用户 id 强匹配 */
  function rejoinLobbyOpts(probe) {
    const archive = loadGameArchive();
    const roomId =
      (probe && probe.roomId) ||
      (archive && archive.roomId) ||
      null;
    return {
      sessionId: getTabSessionId(),
      playerTag: myTag(),
      roomId,
      oldPlayerId: archive && archive.seatId ? archive.seatId : null,
      rejoin: true,
    };
  }

  function rememberActivePlay(room) {
    if (!room || !room.id) return;
    try {
      sessionStorage.setItem(
        ACTIVE_PLAY_KEY,
        JSON.stringify({
          roomId: room.id,
          status: room.status || null,
          sessionId: getTabSessionId(),
          at: Date.now(),
        })
      );
      // 同步一份到 localStorage，防止个别环境 sessionStorage 异常
      localStorage.setItem(
        ACTIVE_PLAY_KEY,
        JSON.stringify({
          roomId: room.id,
          status: room.status || null,
          sessionId: getTabSessionId(),
          at: Date.now(),
        })
      );
    } catch (_) {
      /* ignore */
    }
  }

  function clearActivePlay() {
    try {
      sessionStorage.removeItem(ACTIVE_PLAY_KEY);
    } catch (_) {
      /* ignore */
    }
    try {
      localStorage.removeItem(ACTIVE_PLAY_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  function rememberGameArchive({ roomId, seatId, phase } = {}) {
    if (!roomId || !seatId) return;
    const payload = {
      roomId,
      seatId,
      phase: phase || null,
      at: Date.now(),
    };
    try {
      sessionStorage.setItem(GAME_ARCHIVE_KEY, JSON.stringify(payload));
      localStorage.setItem(GAME_ARCHIVE_KEY, JSON.stringify(payload));
    } catch (_) {
      /* ignore */
    }
  }

  function clearGameArchive() {
    try {
      sessionStorage.removeItem(GAME_ARCHIVE_KEY);
    } catch (_) {
      /* ignore */
    }
    try {
      localStorage.removeItem(GAME_ARCHIVE_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  function loadGameArchive() {
    try {
      const raw =
        sessionStorage.getItem(GAME_ARCHIVE_KEY) ||
        localStorage.getItem(GAME_ARCHIVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.roomId || !data.seatId) return null;
      if (data.at && Date.now() - Number(data.at) > 6 * 60 * 60 * 1000) {
        clearGameArchive();
        return null;
      }
      return data;
    } catch (_) {
      return null;
    }
  }

  function loadActivePlay() {
    try {
      const raw =
        sessionStorage.getItem(ACTIVE_PLAY_KEY) ||
        localStorage.getItem(ACTIVE_PLAY_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.roomId) return null;
      // 超过 6 小时视为过期
      if (data.at && Date.now() - Number(data.at) > 6 * 60 * 60 * 1000) {
        clearActivePlay();
        return null;
      }
      // 写回 sessionStorage，保证本标签页后续认领一致
      try {
        sessionStorage.setItem(ACTIVE_PLAY_KEY, raw);
      } catch (_) {
        /* ignore */
      }
      return data;
    } catch (_) {
      return null;
    }
  }

  function isInRestoredGameView() {
    // 认领成功后可能先切了页面、state 尚未写入；也视为已恢复
    if (state._sessionReclaimed) {
      if (el.viewGame && !el.viewGame.hidden) return true;
      if (el.viewRoom && !el.viewRoom.hidden) return true;
    }
    return Boolean(
      (el.viewGame &&
        !el.viewGame.hidden &&
        (state.game ||
          (state.room && state.room.status === 'playing'))) ||
        (el.viewRoom && !el.viewRoom.hidden && state.room)
    );
  }

  function waitForSessionRestore(ms) {
    return new Promise((resolve) => {
      if (isInRestoredGameView()) {
        resolve(true);
        return;
      }
      const started = Date.now();
      const timer = setInterval(() => {
        if (isInRestoredGameView()) {
          clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - started >= ms) {
          clearInterval(timer);
          resolve(false);
        }
      }, 40);
    });
  }

  function formatRefreshTime(date = new Date()) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function markLobbyRefreshed() {
    if (!el.lobbyRefreshHint) return;
    el.lobbyRefreshHint.textContent = `大厅列表每 3 秒自动刷新 · 上次 ${formatRefreshTime()}`;
  }

  function requestLobbyRefresh() {
    if (!state.inLobby) return;
    net.refreshLobby();
  }

  function stopLobbyAutoRefresh() {
    if (lobbyRefreshTimer) {
      clearInterval(lobbyRefreshTimer);
      lobbyRefreshTimer = null;
    }
  }

  function startLobbyAutoRefresh() {
    stopLobbyAutoRefresh();
    if (!state.inLobby) return;
    requestLobbyRefresh();
    lobbyRefreshTimer = setInterval(requestLobbyRefresh, LOBBY_REFRESH_MS);
  }

  // 先拉游戏清单，挂载各游戏面板 / 样式 / 脚本
  try {
    const info = await fetch('/api/info').then((r) => r.json());
    state.games = info.games || [];
    await window.GameBoot.mountPanels(state.games);
  } catch (err) {
    console.error(err);
    document.getElementById('toast').hidden = false;
    document.getElementById('toast').textContent =
      '游戏资源加载失败，请刷新重试';
    return;
  }

  el.panelGomoku = document.getElementById('panel-gomoku');
  el.panelIncan = document.getElementById('panel-incan');
  el.gameTitle = document.getElementById('game-title');
  el.gameStatus = document.getElementById('game-status');
  el.gameSides = document.getElementById('game-sides');
  el.gomokuCanvas = document.getElementById('gomoku-board');

  if (el.gomokuCanvas && window.GomokuBoard) {
    board = window.GomokuBoard.create(el.gomokuCanvas);
  }
  if (window.IncanUi) window.IncanUi.bindButtons(net);
  if (window.SgsUi) window.SgsUi.bindButtons(net);

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
    }, 3200);
  }

  function syncBgm(viewName) {
    const A = window.SgsAssets;
    if (!A || typeof A.playBgm !== 'function') return;
    if (viewName === 'room') {
      A.playBgm('lobby');
      return;
    }
    if (viewName === 'game') {
      if (state.game && state.game.over) {
        A.stopBgm();
      } else {
        A.playBgm('game');
      }
      return;
    }
    A.stopBgm();
  }

  function closeGameMenu() {
    if (!el.gameMenuPop || !el.btnGameMenu) return;
    el.gameMenuPop.hidden = true;
    el.btnGameMenu.setAttribute('aria-expanded', 'false');
  }

  function toggleGameMenu() {
    if (!el.gameMenuPop || !el.btnGameMenu || (el.gameMenu && el.gameMenu.hidden)) {
      return;
    }
    const open = el.gameMenuPop.hidden;
    el.gameMenuPop.hidden = !open;
    el.btnGameMenu.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function syncChatVisibility(viewName) {
    const name =
      viewName ||
      (el.viewRoom && !el.viewRoom.hidden
        ? 'room'
        : el.viewGame && !el.viewGame.hidden
          ? 'game'
          : 'lobby');
    if (!el.chatDock) return;
    const shouldShow = state.inLobby && (name === 'lobby' || name === 'room');
    el.chatDock.hidden = !shouldShow;
    if (!shouldShow) {
      setChatDockActive(false);
      return;
    }
    if (!state.chatAll.length && !state.chatRoom.length) {
      console.debug('[chat-debug] chat shown with empty history -> clear attention');
      clearChatAttention();
    }
    // 默认收起半透明；只有点击/回车/聚焦输入时才展开
    setChatDockActive(false);
    if (!chatDockPosLoaded) {
      loadChatDockPos();
      chatDockPosLoaded = true;
    }
  }

  function showView(name) {
    el.viewLobby.hidden = name !== 'lobby';
    el.viewRoom.hidden = name !== 'room';
    el.viewGame.hidden = name !== 'game';

    document.body.classList.remove('phase-lobby', 'phase-room', 'phase-game');
    document.body.classList.add(
      name === 'room' ? 'phase-room' : name === 'game' ? 'phase-game' : 'phase-lobby'
    );

    if (el.gameMenu) el.gameMenu.hidden = name !== 'game';
    if (name !== 'game') closeGameMenu();

    if (el.appPhaseTitle) {
      el.appPhaseTitle.textContent =
        name === 'room'
          ? '房间等待中'
          : name === 'game'
            ? '对局中'
            : '联机大厅';
    }
    // 昵称只在「联机大厅」标题旁显示；进房/对局时收起
    refreshNickUi(name);
    if (el.lobbyPeopleTitle) {
      el.lobbyPeopleTitle.textContent =
        name === 'room' ? '房间外玩家' : '大厅人员';
    }
    if (el.lobbyPeopleAside) {
      el.lobbyPeopleAside.setAttribute(
        'aria-label',
        name === 'room' ? '房间外玩家' : '大厅人员'
      );
      // 大厅与房间等待页都显示人员栏，便于查看和加入别人的房间
      el.lobbyPeopleAside.hidden = !(
        state.inLobby &&
        (name === 'lobby' || name === 'room')
      );
    }
    syncChatVisibility(name);
    if (state.inLobby && (name === 'lobby' || name === 'room')) {
      startLobbyAutoRefresh();
    } else {
      stopLobbyAutoRefresh();
    }
    updateMeLabel();
    syncBgm(name);
    syncChatTabs();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function playerHasLeft(id) {
    if (!id) return false;
    if (state.room && Array.isArray(state.room.players)) {
      const p = state.room.players.find((x) => x.id === id);
      if (p && p.left) return true;
    }
    const ids = state.game && state.game.leftPlayerIds;
    return Array.isArray(ids) && ids.includes(id);
  }

  function playerNameById(id) {
    if (!state.room) return id;
    const p = state.room.players.find((x) => x.id === id);
    const name = p ? p.name : id.slice(0, 6);
    return playerHasLeft(id) ? `${name}（已离开）` : name;
  }

  function updateMeLabel() {
    if (!state.inLobby) {
      el.meLabel.textContent = '未进入大厅';
      return;
    }
    const remote = net.isOnRemoteHost() ? '已连到房主' : '本机大厅';
    if (state.room) {
      const st = state.room.status === 'playing' ? '对局中' : '房间内';
      el.meLabel.textContent = `${remote} · ${st}`;
    } else {
      el.meLabel.textContent = remote;
    }
  }

  function refreshNickUi(viewName) {
    const name =
      window.PlayerNick.stripBaseName(
        state.playerName || (state.me && state.me.name) || '玩家'
      ) || '玩家';
    const tag = myTag();
    const view =
      viewName ||
      (!el.viewLobby.hidden
        ? 'lobby'
        : !el.viewRoom.hidden
          ? 'room'
          : !el.viewGame.hidden
            ? 'game'
            : 'lobby');
    // 仅大厅页、且已进入大厅时，显示在「联机大厅」右侧
    const showNick = Boolean(state.inLobby && view === 'lobby');
    if (!showNick && nickEditing) {
      nickEditing = false;
      if (el.headerNick) el.headerNick.classList.remove('is-editing');
    }
    if (el.headerNick) {
      el.headerNick.hidden = !showNick;
    }
    if (!nickEditing) {
      if (el.nickDisplay) {
        el.nickDisplay.hidden = false;
        el.nickDisplay.innerHTML = nickHtml(name, tag);
        el.nickDisplay.title = window.PlayerNick.fullLabel(name, tag);
      }
      if (el.playerNameEdit) {
        el.playerNameEdit.hidden = true;
        el.playerNameEdit.value = name;
      }
      if (el.btnEditName) el.btnEditName.hidden = !showNick;
    }
    if (el.playerName && !state.inLobby) el.playerName.value = name;
  }

  function hostHint(room) {
    if (!room || !room.host) return '';
    if (room.local) return '本机';
    const viaRaw = String(room.via || '');
    return viaRaw.includes('mqtt') ? '公网隧道' : '远端';
  }

  function remoteBadge(person) {
    return '';
  }

  function selectedGameMeta() {
    const id = el.gameType.value;
    return state.games.find((g) => g.id === id) || null;
  }

  function updateCreateForm() {
    const g = selectedGameMeta();
    if (!g) {
      el.gameHint.textContent = '选择游戏后查看人数要求。';
      return;
    }
    if (el.gameModeWrap) el.gameModeWrap.hidden = !(g.modes && g.modes.length);
    if (g.modes && g.modes.length && el.gameMode) {
      const cur = el.gameMode.value;
      el.gameMode.innerHTML = '';
      for (const m of g.modes) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        el.gameMode.appendChild(opt);
      }
      if ([...el.gameMode.options].some((o) => o.value === cur)) {
        el.gameMode.value = cur;
      }
    }

    if (g.id === 'gomoku') {
      el.maxPlayersWrap.hidden = true;
      restoreMaxOptions();
      el.roomMax.value = '2';
      el.gameHint.textContent = '五子棋：双人局，房主执黑先手。';
    } else if (g.id === 'incan') {
      el.maxPlayersWrap.hidden = false;
      restoreMaxOptions();
      const v = Number(el.roomMax.value);
      if (v < 3) el.roomMax.value = '6';
      el.gameHint.textContent =
        '印加宝藏：3–8 人；同时抉择继续/返回，全员锁定后才揭晓并结算。';
    } else if (g.id === 'sgs') {
      el.maxPlayersWrap.hidden = false;
      const modeId = el.gameMode ? el.gameMode.value : 'identity';
      const mode = (g.modes || []).find((m) => m.id === modeId) || g.modes[0];
      const seats = (mode && mode.seats) || [5, 8];
      el.roomMax.innerHTML = '';
      for (const n of seats) {
        const opt = document.createElement('option');
        opt.value = String(n);
        opt.textContent = String(n);
        el.roomMax.appendChild(opt);
      }
      el.roomMax.value = String(seats[0]);
      if (modeId === 'h2h') {
        el.gameHint.textContent =
          '三国杀·2V2：4 人交叉座位（1·4 vs 2·3）；队友手牌共享；先 Ban 将再选将。';
      } else if (modeId === '1v2') {
        el.gameHint.textContent =
          '三国杀·1V2：3 人叫地主；主公有【跋扈】【飞扬】，体力+1；反贼击杀主公即胜。';
      } else if (modeId === 'xianzhu') {
        el.gameHint.textContent =
          '三国杀·先主黄巾：5/8 人；先主 5 选 1、其余 3 选 1；先主体力+1（后主不加），可传位；黄巾可感染，人数达存活一半（向上取整）时起义（剩 2 人不起义）。';
      } else {
        el.gameHint.textContent =
          '三国杀·标准身份：5/8 人满员开局；主公亮明且 5 选 1，其余角色 3 选 1；主公体力+1。';
      }
    } else {
      el.maxPlayersWrap.hidden = false;
      restoreMaxOptions();
      el.gameHint.textContent = `${g.label}：${g.minPlayers}–${g.maxPlayers} 人`;
    }
  }

  function restoreMaxOptions() {
    const cur = el.roomMax.value;
    el.roomMax.innerHTML = '';
    for (let n = 2; n <= 8; n++) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = String(n);
      el.roomMax.appendChild(opt);
    }
    if ([...el.roomMax.options].some((o) => o.value === cur)) {
      el.roomMax.value = cur;
    }
  }

  function fillGameOptions(games) {
    state.games = games || [];
    if (!el.gameType || !state.games.length) return;
    const current = el.gameType.value;
    el.gameType.innerHTML = '';
    for (const g of state.games) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `${g.label}（${g.minPlayers}–${g.maxPlayers}人）`;
      el.gameType.appendChild(opt);
    }
    const preferred = 'sgs';
    if ([...el.gameType.options].some((o) => o.value === current)) {
      el.gameType.value = current;
    } else if ([...el.gameType.options].some((o) => o.value === preferred)) {
      el.gameType.value = preferred;
    }
    updateCreateForm();
  }

  function isRoomFull(room) {
    const count = Number(room && room.playerCount);
    const max = Number(room && room.maxPlayers);
    return Number.isFinite(count) && Number.isFinite(max) && max > 0 && count >= max;
  }

  function renderLobbyRooms(rooms) {
    el.roomList.innerHTML = '';
    const list = rooms || [];
    state.lobbyRooms = list;
    el.roomListEmpty.hidden = list.length > 0;

    for (const room of list) {
      const li = document.createElement('li');
      const info = document.createElement('span');
      const where = hostHint(room);
      const gameLabel = room.gameLabel || room.gameType || '游戏';
      const modeBit = room.gameModeLabel ? `·${room.gameModeLabel}` : '';
      let playerBitHtml = `${escapeHtml(room.playerCount)}/${escapeHtml(room.maxPlayers)}`;
      if (room.playerNames && room.playerNames.length) {
        const tags = Array.isArray(room.playerTags) ? room.playerTags : [];
        const joined = room.playerNames.map((name, i) => nickHtml(name, tags[i])).join(' · ');
        playerBitHtml = `${joined} (${escapeHtml(room.playerCount)}/${escapeHtml(room.maxPlayers)})`;
      }
      info.innerHTML =
        `<span class="badge game-badge">${escapeHtml(gameLabel)}${escapeHtml(modeBit)}</span> ` +
        `${escapeHtml(room.name)}  ${playerBitHtml}` +
        (where ? `  · ${escapeHtml(where)}` : '');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '加入';
      if (isRoomFull(room)) {
        btn.disabled = true;
        btn.title = '房间已满员';
        btn.setAttribute('aria-disabled', 'true');
        li.classList.add('is-full');
      } else {
        btn.addEventListener('click', () => joinDiscoveredRoom(room));
      }
      li.appendChild(info);
      li.appendChild(btn);
      el.roomList.appendChild(li);
    }
  }

  function renderPeers(peers) {
    if (!el.peersLabel) return;
    const list = peers || [];
    const n = list.length;
    const mqttN = list.filter((p) => String(p.via || '').includes('mqtt')).length;
    if (n === 0) {
      el.peersLabel.textContent =
        state.mqttBulletin
          ? '在线：暂未发现其他实例（双方需保持心跳）'
          : '广播：MQTT 未启用，无法跨实例联机';
      return;
    }
    const bits = [];
    if (mqttN) bits.push(`广播 ${mqttN}`);
    el.peersLabel.textContent =
      `在线：发现 ${n} 个实例` + (bits.length ? `（${bits.join(' · ')}）` : '');
  }

  function peopleStatusText(person) {
    if (person.status === 'offline') return '离线';
    if (person.status === 'playing') return '对局中';
    if (person.status === 'room') {
      return person.roomName ? `房间：${person.roomName}` : '房间中';
    }
    return '空闲';
  }

  function hidePeopleCtx() {
    if (!el.peopleCtx) return;
    el.peopleCtx.hidden = true;
    state.ctxTarget = null;
  }

  function getPeopleCtxActions(person) {
    const isMe =
      state.me &&
      (person.id === state.me.id || person.socketId === state.me.id);

    let joinEnabled = false;
    let joinReason = '';
    if (person.status === 'offline') joinReason = '对方已离线';
    else if (isMe) joinReason = '不能加入自己的房间';
    else if (state.room) joinReason = '请先离开当前房间';
    else if (person.status !== 'room' || !person.roomId) {
      joinReason = '对方不在房间中';
    } else {
      const theirRoom = (state.lobbyRooms || []).find(
        (r) => String(r.id).toUpperCase() === String(person.roomId).toUpperCase()
      );
      if (theirRoom && isRoomFull(theirRoom)) joinReason = '房间已满员';
      else joinEnabled = true;
    }

    return { isMe, joinEnabled, joinReason };
  }

  function showPeopleCtx(person, x, y) {
    if (!el.peopleCtx || !person) return;
    const actions = getPeopleCtxActions(person);
    const btnJoin = el.peopleCtx.querySelector('[data-action="join-their-room"]');
    const hint = document.getElementById('people-ctx-hint');

    if (btnJoin) {
      btnJoin.hidden = false;
      btnJoin.disabled = !actions.joinEnabled;
      btnJoin.title = actions.joinEnabled ? '' : actions.joinReason;
    }
    if (hint) {
      if (!actions.joinEnabled) {
        hint.hidden = false;
        hint.textContent = actions.joinReason || '暂无可用操作';
      } else {
        hint.hidden = true;
        hint.textContent = '';
      }
    }

    state.ctxTarget = person;
    el.peopleCtx.hidden = false;
    // 先显示再量宽高，避免 hidden 时尺寸为 0
    const pad = 8;
    const rect = el.peopleCtx.getBoundingClientRect();
    const w = rect.width || 180;
    const h = rect.height || 90;
    let left = x;
    let top = y;
    if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
    el.peopleCtx.style.left = `${Math.max(pad, left)}px`;
    el.peopleCtx.style.top = `${Math.max(pad, top)}px`;
  }

  function renderLobbyPeople(people) {
    if (!el.lobbyPeopleList || !el.lobbyPeopleEmpty) return;
    const list = people || [];
    state.people = list;
    el.lobbyPeopleList.innerHTML = '';
    el.lobbyPeopleEmpty.hidden = list.length > 0;
    const sorted = list.slice().sort((a, b) => {
      if (a.status === 'offline' && b.status !== 'offline') return 1;
      if (a.status !== 'offline' && b.status === 'offline') return -1;
      return 0;
    });
    const availableCount = sorted.filter(
      (p) => p.status !== 'offline' && p.status !== 'playing'
    ).length;
    if (el.lobbyPeopleCount) {
      const total = sorted.length;
      el.lobbyPeopleCount.textContent = total
        ? `${availableCount} / ${total} 可用`
        : '';
    }

    for (const person of sorted) {
      const li = document.createElement('li');
      li.dataset.playerId = person.id;
      const isMe =
        state.me &&
        (person.id === state.me.id || person.socketId === state.me.id);
      const name = document.createElement('span');
      name.className = 'people-name';
      name.innerHTML =
        nickHtml(person.name, person.tag) +
        (isMe ? ' <span class="you">(你)</span>' : '') +
        remoteBadge(person);
      name.title = window.PlayerNick.fullLabel(person.name, person.tag);
      const status = document.createElement('span');
      status.className = 'people-status';
      status.textContent = peopleStatusText(person);
      if (person.status === 'offline') {
        li.classList.add('is-offline');
      }
      li.appendChild(name);
      li.appendChild(status);
      el.lobbyPeopleList.appendChild(li);
    }
  }

  function renderRoom() {
    const room = state.room;
    if (!room) return;

    el.roomTitle.textContent = room.name;
    el.roomGameLabel.textContent =
      (room.gameLabel || room.gameType || '—') +
      (room.gameModeLabel ? '·' + room.gameModeLabel : '') +
      ` · 思考${formatTurnTime(room.turnTimeSec)}`;
    el.roomCode.textContent = room.id;
    el.roomHiddenBadge.hidden = !room.hidden;

    el.memberList.innerHTML = '';
    for (const p of room.players) {
      const li = document.createElement('li');
      li.dataset.speakerKey = memberSpeakerKey(p);
      const isMe = state.me && p.id === state.me.id;
      const isHost = p.id === room.hostId;
      const left = document.createElement('span');
      left.innerHTML =
        nickHtml(p.name, p.tag) +
        (isMe ? ' <span class="you">(你)</span>' : '') +
        (isHost ? ' <span class="badge">房主</span>' : '');
      left.title = window.PlayerNick.fullLabel(p.name, p.tag);
      const right = document.createElement('span');
      right.className = 'muted';
      right.textContent = isHost ? '房主' : '已入座';
      li.appendChild(left);
      li.appendChild(right);
      el.memberList.appendChild(li);
    }
    syncRoomChatBubbles();

    const min = room.minPlayers || 2;
    el.roomStartHint.textContent = `至少 ${min} 人即可开始（当前 ${room.players.length}/${room.maxPlayers}）。人齐后房主可直接开局。`;

    const isHost = state.me && room.hostId === state.me.id;
    el.btnStart.hidden = !isHost;
    el.btnStart.disabled = room.players.length < min;
  }

  function hideAllGamePanels() {
    if (el.panelGomoku) el.panelGomoku.hidden = true;
    if (window.IncanUi) window.IncanUi.hide();
    if (window.SgsUi) window.SgsUi.hide();
  }

  function renderGomoku() {
    const game = state.game;
    hideAllGamePanels();
    if (el.panelGomoku) el.panelGomoku.hidden = false;

    if (el.gameTitle) {
      el.gameTitle.textContent =
        (state.room && state.room.gameLabel) || '五子棋';
    }

    const blackId = Object.keys(game.stones || {}).find(
      (id) => game.stones[id] === 1
    );
    const whiteId = Object.keys(game.stones || {}).find(
      (id) => game.stones[id] === 2
    );
    const my = state.me ? game.stones[state.me.id] : null;
    if (el.gameSides) {
      el.gameSides.textContent =
        `黑：${blackId ? playerNameById(blackId) : '—'}　白：${
          whiteId ? playerNameById(whiteId) : '—'
        }` + (my === 1 ? '　你是黑棋' : my === 2 ? '　你是白棋' : '');
    }

    if (el.gameStatus) {
      if (game.over) {
        if (game.draw) el.gameStatus.textContent = '平局';
        else if (game.winnerId) {
          const winName = playerNameById(game.winnerId);
          const mine = state.me && game.winnerId === state.me.id;
          el.gameStatus.textContent = mine
            ? `你赢了！（连成五子）`
            : `${winName} 获胜`;
        } else el.gameStatus.textContent = '对局结束';
      } else {
        const mine = state.me && game.currentPlayerId === state.me.id;
        el.gameStatus.textContent = mine
          ? '轮到你落子'
          : `等待 ${playerNameById(game.currentPlayerId)} 落子`;
      }
    }

    if (board) {
      board.render(game, {
        interactive:
          !game.over && state.me && game.currentPlayerId === state.me.id,
        onPlace: (x, y) => net.sendAction('place', { x, y }),
      });
    }
  }

  function renderGame() {
    const game = state.game;
    if (!game) return;
    updateTurnTimer();
    // 对局结束时停掉对局 BGM（房间回到 waiting 后再播大厅曲）
    if (game.over && window.SgsAssets && window.SgsAssets.stopBgm) {
      const A = window.SgsAssets;
      if (typeof A.playBgm === 'function') {
        // 仍停在对局页：只停 BGM；若已回房间页由 showView 播大厅曲
        A.stopBgm();
      }
    } else if (
      !game.over &&
      !el.viewGame.hidden &&
      window.SgsAssets &&
      typeof window.SgsAssets.playBgm === 'function'
    ) {
      window.SgsAssets.playBgm('game');
    }
    if (game.type === 'incan') {
      hideAllGamePanels();
      if (window.IncanUi) {
        window.IncanUi.render(game, net, {
          meId: state.me && state.me.id,
          playerNameById,
        });
      }
    } else if (game.type === 'sgs') {
      hideAllGamePanels();
      if (window.SgsUi) window.SgsUi.render(game, net);
    } else {
      renderGomoku();
    }
  }

  function formatTurnTime(sec) {
    const n = Number(sec) || 0;
    return n > 0 ? `${n}秒` : '不限';
  }

  function updateTurnTimer() {
    if (!el.turnTimer || !el.turnTimerSec) return;
    const game = state.game;
    const timer = game && game.turnTimer;
    const meId = state.me && state.me.id;
    const forMe =
      timer &&
      meId &&
      Array.isArray(timer.actorIds) &&
      timer.actorIds.includes(meId) &&
      Number(timer.limitSec) > 0 &&
      !game.over;

    if (!forMe) {
      el.turnTimer.hidden = true;
      el.turnTimer.classList.remove('is-urgent');
      return;
    }

    const left = Math.max(
      0,
      Math.ceil((Number(timer.deadline) - Date.now()) / 1000)
    );
    el.turnTimer.hidden = false;
    el.turnTimerSec.textContent = `${left}s`;
    el.turnTimer.classList.toggle('is-urgent', left <= 5);
  }

  async function joinDiscoveredRoom(room) {
    if (isRoomFull(room)) {
      showToast('房间已满员');
      return;
    }
    const name = state.playerName || el.playerName.value.trim() || '玩家';
    try {
      // 本机房间始终走当前页源；远端房间统一走公网隧道地址
      await net.joinRoomOnHost(room.id, name, room.host, {
        ...lobbyJoinOpts(),
        local: room.local === true,
        preferLocal: room.local === true,
      });
    } catch (err) {
      const base = (err && err.message) || '无法连接房主';
      showToast(
        room && room.local === true
          ? base
          : `${base}（若持续失败，请以管理员身份运行 修复DNS.bat 后重开浏览器）`
      );
    }
  }

  async function leaveAndReturnLocal() {
    leavingToLocal = true;
    clearActivePlay();
    clearGameArchive();
    net.leaveRoom();
    state.room = null;
    state.game = null;
    rememberChatRoom(null);
    try {
      await net.returnToLocalLobby(state.playerName, lobbyJoinOpts());
      showView('lobby');
      updateMeLabel();
    } catch (err) {
      showToast(err.message || '返回本地大厅失败');
    } finally {
      leavingToLocal = false;
    }
  }

  /** 房间失效/解散：退出并回到本机大厅 */
  async function bounceToLocalLobby(message) {
    cancelRemoteRecover();
    remoteRecovering = false;
    state._rejoining = false;
    leavingToLocal = true;
    clearActivePlay();
    clearGameArchive();
    state.room = null;
    state.game = null;
    state._lastRoomId = null;
    rememberChatRoom(null);
    try {
      net.leaveRoom();
    } catch (_) {
      /* ignore */
    }
    try {
      await net.returnToLocalLobby(
        state.playerName || (el.playerName && el.playerName.value) || '玩家',
        lobbyJoinOpts()
      );
    } catch (_) {
      /* ignore */
    }
    state.inLobby = true;
    showView('lobby');
    showLobbyHome();
    updateMeLabel();
    if (message) showToast(message);
    leavingToLocal = false;
  }

  function showLobbyHome() {
    if (!el.lobbyGate || !el.lobbyMain) return;
    el.lobbyGate.hidden = state.inLobby;
    el.lobbyMain.hidden = !state.inLobby;
    if (el.lobbyPeopleAside) {
      el.lobbyPeopleAside.hidden = !state.inLobby;
    }
    syncChatVisibility();
    refreshNickUi();
    updateMeLabel();
    if (state.inLobby) startLobbyAutoRefresh();
    else stopLobbyAutoRefresh();
  }

  function setCreatePanelOpen(open) {
    if (!el.createRoomModal) return;
    el.createRoomModal.hidden = !open;
    if (open) {
      if (el.joinCodeModal) el.joinCodeModal.hidden = true;
      const focusEl = el.gameType || el.roomName;
      if (focusEl) requestAnimationFrame(() => focusEl.focus());
    }
  }

  function setJoinPanelOpen(open) {
    if (!el.joinCodeModal) return;
    el.joinCodeModal.hidden = !open;
    if (open) {
      if (el.createRoomModal) el.createRoomModal.hidden = true;
      if (el.joinCode) {
        requestAnimationFrame(() => {
          el.joinCode.focus();
          el.joinCode.select();
        });
      }
    }
  }

  function closeAllModals() {
    if (el.createRoomModal) el.createRoomModal.hidden = true;
    if (el.joinCodeModal) el.joinCodeModal.hidden = true;
    if (el.rejoinModal) el.rejoinModal.hidden = true;
    state.pendingRejoin = null;
  }

  let nickEditing = false;
  let nickEditOriginal = '';

  function setNickEditing(on) {
    if (!el.headerNick || !el.playerNameEdit || !el.nickDisplay) return;
    // 未进大厅或不在大厅页时不允许编辑
    if (on && (!state.inLobby || el.viewLobby.hidden)) return;
    nickEditing = Boolean(on);
    el.headerNick.classList.toggle('is-editing', nickEditing);
    el.nickDisplay.hidden = nickEditing;
    el.playerNameEdit.hidden = !nickEditing;
    if (el.btnEditName) el.btnEditName.hidden = nickEditing || el.headerNick.hidden;
    if (nickEditing) {
      nickEditOriginal =
        window.PlayerNick.stripBaseName(state.playerName) || '玩家';
      el.playerNameEdit.value = nickEditOriginal;
      requestAnimationFrame(() => {
        el.playerNameEdit.focus();
        el.playerNameEdit.select();
      });
    } else {
      refreshNickUi();
    }
  }

  function applyPlayerName(name, { silent } = {}) {
    const next = window.PlayerNick.stripBaseName(name) || '玩家';
    const prev = state.playerName;
    state.playerName = next;
    saveNick(next);
    if (el.playerName) el.playerName.value = next;
    refreshNickUi();
    if (state.inLobby && next !== prev) {
      if (typeof net.renamePlayer === 'function') {
        net.renamePlayer(next, lobbyJoinOpts());
      } else {
        net.joinLobby(next, lobbyJoinOpts());
      }
      if (!silent) showToast('昵称已更新');
    }
    updateMeLabel();
    return next;
  }

  async function enterLobbyWithName(name, { silent } = {}) {
    const next = window.PlayerNick.stripBaseName(name) || '玩家';
    state.playerName = next;
    saveNick(next);
    if (el.playerName) el.playerName.value = next;
    // 进入大厅前确保本机固定尾缀已生成
    window.PlayerNick.ensureTag();
    state._sessionReclaimed = false;
    state.pendingRejoin = null;

    await net.connect(net.getLocalOrigin());
    // 普通进大厅：不自动认领回桌
    net.joinLobby(next, lobbyJoinOpts());
    state.inLobby = true;
    setCreatePanelOpen(false);
    setJoinPanelOpen(false);
    if (!silent) refreshNickUi();
    showLobbyHome();

    // 有存档房间码时：先探测是否仍活跃，再弹窗询问是否重连
    await maybeOfferRejoin();
  }

  function setRejoinModalOpen(open, probe) {
    if (!el.rejoinModal) return;
    if (open && probe) {
      state.pendingRejoin = probe;
      const code = probe.roomId || '—';
      const statusText =
        probe.status === 'playing'
          ? '对局进行中'
          : probe.status === 'waiting'
            ? '房间等待中'
            : '房间仍在';
      if (el.rejoinMessage) {
        el.rejoinMessage.textContent = `检测到你曾在房间「${
          probe.name || code
        }」（${code}），当前${statusText}。是否重新加入？`;
      }
      el.rejoinModal.hidden = false;
    } else {
      state.pendingRejoin = null;
      el.rejoinModal.hidden = true;
    }
  }

  async function maybeOfferRejoin() {
    const archive = loadGameArchive() || loadActivePlay();
    if (!archive || !archive.roomId) return;
    // 等 MQTT 广播刷一轮，避免刚进大厅时 probe 过早
    await new Promise((r) => setTimeout(r, 800));
    try {
      let probe = await net.probeRoom(archive.roomId);
      if (!probe || !probe.ok) {
        await new Promise((r) => setTimeout(r, 1500));
        probe = await net.probeRoom(archive.roomId);
      }
      if (!probe || !probe.ok) {
        clearActivePlay();
        clearGameArchive();
        return;
      }
      setRejoinModalOpen(true, probe);
    } catch (_) {
      /* ignore probe errors */
    }
  }

  async function acceptPendingRejoin() {
    const probe = state.pendingRejoin;
    setRejoinModalOpen(false);
    if (!probe || !probe.roomId) return;

    const name = state.playerName || '玩家';
    const opts = rejoinLobbyOpts(probe);
    if (!opts.oldPlayerId) {
      showToast('缺少本地座位记录，无法强匹配重连');
      return;
    }

    showToast('正在重新加入对局…');
    state._sessionReclaimed = false;
    state._rejoining = true;
    try {
      const host = probe.host || null;
      const isLocal = probe.local === true;
      const candidates = [];
      if (isLocal || !host) {
        candidates.push(net.getLocalOrigin());
      } else {
        candidates.push(host);
      }
      await net.connectAny(candidates);
      await net.joinLobbyAndWait(name, opts);

      const ok = await waitForSessionRestore(4000);
      if (ok && isInRestoredGameView()) {
        showToast('已重新加入对局');
        return;
      }
      showToast('重连失败：未能回到原座位');
      if (net.isOnRemoteHost()) {
        await net.returnToLocalLobby(name, lobbyJoinOpts());
      }
      showLobbyHome();
    } catch (err) {
      showToast(err.message || '重连失败');
      showLobbyHome();
    } finally {
      state._rejoining = false;
    }
  }

  function declinePendingRejoin() {
    setRejoinModalOpen(false);
    clearActivePlay();
    clearGameArchive();
    showToast('已取消重连，留在大厅');
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
    refreshNickUi();
  }

  el.gameType.addEventListener('change', updateCreateForm);
  if (el.gameMode) {
    el.gameMode.addEventListener('change', updateCreateForm);
  }

  el.btnEnterLobby.addEventListener('click', async () => {
    const name = (el.playerName.value || '').trim() || '玩家';
    try {
      await enterLobbyWithName(name);
    } catch (err) {
      showToast(err.message || '连接本地服务失败');
    }
  });

  el.playerName.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') el.btnEnterLobby.click();
  });

  if (el.btnEditName) {
    el.btnEditName.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!state.inLobby) return;
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
  }

  document.addEventListener('pointerdown', (ev) => {
    if (!nickEditing) return;
    if (el.headerNick && el.headerNick.contains(ev.target)) return;
    commitNickEdit();
  });

  if (el.btnToggleCreate) {
    el.btnToggleCreate.addEventListener('click', () => {
      setCreatePanelOpen(el.createRoomModal.hidden);
    });
  }
  if (el.btnCloseCreate) {
    el.btnCloseCreate.addEventListener('click', () => setCreatePanelOpen(false));
  }
  if (el.btnToggleJoin) {
    el.btnToggleJoin.addEventListener('click', () => {
      setJoinPanelOpen(el.joinCodeModal.hidden);
    });
  }
  if (el.btnCloseJoin) {
    el.btnCloseJoin.addEventListener('click', () => setJoinPanelOpen(false));
  }
  if (el.btnRefreshLobby) {
    el.btnRefreshLobby.addEventListener('click', () => {
      requestLobbyRefresh();
      showToast('正在刷新大厅…');
    });
  }
  if (el.btnRefreshDoc) {
    el.btnRefreshDoc.addEventListener('click', () => {
      requestLobbyRefresh();
      showToast('正在刷新大厅状态…');
    });
  }

  document.querySelectorAll('[data-close="create"]').forEach((node) => {
    node.addEventListener('click', () => setCreatePanelOpen(false));
  });
  document.querySelectorAll('[data-close="join"]').forEach((node) => {
    node.addEventListener('click', () => setJoinPanelOpen(false));
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (nickEditing) return;
    if (el.peopleCtx && !el.peopleCtx.hidden) {
      hidePeopleCtx();
      return;
    }
    if (el.rejoinModal && !el.rejoinModal.hidden) {
      declinePendingRejoin();
      return;
    }
    if (el.createRoomModal && !el.createRoomModal.hidden) {
      setCreatePanelOpen(false);
      return;
    }
    if (el.joinCodeModal && !el.joinCodeModal.hidden) {
      setJoinPanelOpen(false);
      return;
    }
    if (el.gameMenuPop && !el.gameMenuPop.hidden) {
      closeGameMenu();
    }
  });

  document.querySelectorAll('[data-close="rejoin"]').forEach((node) => {
    node.addEventListener('click', () => declinePendingRejoin());
  });
  if (el.btnCloseRejoin) {
    el.btnCloseRejoin.addEventListener('click', () => declinePendingRejoin());
  }
  if (el.btnDeclineRejoin) {
    el.btnDeclineRejoin.addEventListener('click', () => declinePendingRejoin());
  }
  if (el.btnAcceptRejoin) {
    el.btnAcceptRejoin.addEventListener('click', () => {
      acceptPendingRejoin().catch((err) => {
        showToast(err.message || '重连失败');
      });
    });
  }

  // 聊天：半隐形拖动 + 点击/回车聚焦输入
  if (el.chatInput) {
    el.chatInput.addEventListener('focus', () => setChatDockActive(true));
    el.chatInput.addEventListener('blur', () => {
      if (chatDockDragging || chatDockPreserveActive) return;
      setChatDockActive(false);
    });
  }

  if (el.chatPanel) {
    el.chatPanel.addEventListener('pointerdown', (ev) => {
      const target = ev.target;
      if (
        (el.chatForm && el.chatForm.contains(target)) ||
        (el.chatTabs && el.chatTabs.contains(target)) ||
        (el.chatDragHandle && el.chatDragHandle.contains(target))
      ) {
        return;
      }
      chatDockPreserveActive = true;
      setChatDockActive(true);
      setTimeout(() => {
        chatDockPreserveActive = false;
      }, 0);
    });
    el.chatPanel.addEventListener('click', (ev) => {
      if (chatDockDragging || chatDockDragMoved) return;
      const target = ev.target;
      if (
        (el.chatForm && el.chatForm.contains(target)) ||
        (el.chatTabs && el.chatTabs.contains(target))
      ) {
        return;
      }
      focusChatInput();
    });
  }

  if (el.chatForm) {
    el.chatForm.addEventListener('pointerdown', () => {
      chatDockPreserveActive = true;
      setChatDockActive(true);
      setTimeout(() => {
        chatDockPreserveActive = false;
      }, 0);
    });
  }

  if (el.chatTabs) {
    el.chatTabs.addEventListener('pointerdown', () => {
      chatDockPreserveActive = true;
      setChatDockActive(true);
      setTimeout(() => {
        chatDockPreserveActive = false;
      }, 0);
    });
  }

  if (el.chatDragHandle && el.chatDock) {
    el.chatDragHandle.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 && ev.pointerType !== 'touch') return;
      if (el.chatTabs && el.chatTabs.contains(ev.target)) return;
      chatDockPreserveActive = true;
      chatDockDragging = true;
      chatDockDragMoved = false;
      setChatDockActive(true);
      const rect = el.chatDock.getBoundingClientRect();
      chatDockDragStart = {
        clientX: ev.clientX,
        clientY: ev.clientY,
        left: rect.left,
        bottom: window.innerHeight - rect.bottom,
        w: rect.width || el.chatDock.offsetWidth,
        h: rect.height || el.chatDock.offsetHeight,
      };
      try {
        el.chatDragHandle.setPointerCapture(ev.pointerId);
      } catch (_) {}
      ev.preventDefault();
    });

    el.chatDragHandle.addEventListener('pointermove', (ev) => {
      if (!chatDockDragging || !chatDockDragStart) return;
      const dx = ev.clientX - chatDockDragStart.clientX;
      const dy = ev.clientY - chatDockDragStart.clientY;
      chatDockDragMoved = chatDockDragMoved || Math.abs(dx) + Math.abs(dy) > 2;

      let left = chatDockDragStart.left + dx;
      let bottom = chatDockDragStart.bottom - dy;
      left = Math.max(0, Math.min(left, window.innerWidth - chatDockDragStart.w));
      bottom = Math.max(
        0,
        Math.min(bottom, window.innerHeight - chatDockDragStart.h)
      );
      el.chatDock.style.left = `${left}px`;
      el.chatDock.style.bottom = `${bottom}px`;
    });

    el.chatDragHandle.addEventListener('pointerup', () => {
      if (!chatDockDragging) return;
      chatDockDragging = false;
      const moved = chatDockDragMoved;
      chatDockDragMoved = false;
      chatDockDragStart = null;
      saveChatDockPos();
      setTimeout(() => {
        chatDockPreserveActive = false;
      }, 0);
      if (!moved) focusChatInput();
    });

    el.chatDragHandle.addEventListener('pointercancel', () => {
      chatDockDragging = false;
      chatDockDragMoved = false;
      chatDockDragStart = null;
      setTimeout(() => {
        chatDockPreserveActive = false;
      }, 0);
    });
  }

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    if (nickEditing) return;
    if (!state.inLobby) return;
    if (!el.chatDock || el.chatDock.hidden) return;
    if (ev.defaultPrevented) return;
    if (isTextLikeTarget(ev.target)) return;
    ev.preventDefault();
    focusChatInput();
  });

  if (el.chatTabAll) {
    el.chatTabAll.addEventListener('click', () => setChatChannel('all'));
  }
  if (el.chatTabRoom) {
    el.chatTabRoom.addEventListener('click', () => setChatChannel('room'));
  }
  if (el.chatForm) {
    el.chatForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const text = el.chatInput ? el.chatInput.value.trim() : '';
      if (!text) return;
      chatDockPreserveActive = true;
      setChatDockActive(true);
      net.sendChat(state.chatChannel, text);
      el.chatInput.value = '';
      focusChatInput();
      setTimeout(() => {
        chatDockPreserveActive = false;
      }, 0);
    });
  }

  if (el.lobbyPeopleList) {
    el.lobbyPeopleList.addEventListener('contextmenu', (ev) => {
      const li = ev.target.closest('li[data-player-id]');
      if (!li) return;
      ev.preventDefault();
      ev.stopPropagation();
      const person = (state.people || []).find((p) => p.id === li.dataset.playerId);
      if (!person) return;
      showPeopleCtx(person, ev.clientX, ev.clientY);
    });
  }

  if (el.peopleCtx) {
    el.peopleCtx.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (!btn || !state.ctxTarget) return;
      if (btn.disabled) {
        showToast(btn.title || '当前不可用');
        return;
      }
      const action = btn.getAttribute('data-action');
      const target = state.ctxTarget;
      hidePeopleCtx();
      if (action === 'join-their-room') {
        if (!target.roomId) return;
        const name = state.playerName || '玩家';
        try {
          if (target.local === false && target.host) {
            await net.joinRoomOnHost(
              target.roomId,
              name,
              target.host,
              lobbyJoinOpts()
            );
          } else {
            await net.joinRoomOnHost(target.roomId, name, null, {
              ...lobbyJoinOpts(),
              local: true,
            });
          }
        } catch (err) {
          showToast(err.message || '加入失败');
        }
      }
    });
  }

  document.addEventListener('pointerdown', (ev) => {
    if (ev.button === 2) return; // 右键留给菜单
    if (!el.peopleCtx || el.peopleCtx.hidden) return;
    if (el.peopleCtx.contains(ev.target)) return;
    hidePeopleCtx();
  });

  el.btnCreateRoom.addEventListener('click', async () => {
    try {
      if (net.isOnRemoteHost()) {
        await net.returnToLocalLobby(state.playerName, lobbyJoinOpts());
      }
      const g = selectedGameMeta();
      net.createRoom({
        name: el.roomName.value.trim(),
        hidden: el.roomHidden.checked,
        gameType: el.gameType.value || 'sgs',
        gameMode: el.gameMode ? el.gameMode.value : undefined,
        maxPlayers: g ? Number(el.roomMax.value) || g.maxPlayers : 2,
        turnTimeSec: el.roomTurnTime
          ? Number(el.roomTurnTime.value) || 0
          : 0,
        playerName: state.playerName || el.playerName.value.trim(),
        playerTag: myTag(),
        sessionId: getTabSessionId(),
      });
      closeAllModals();
    } catch (err) {
      showToast(err.message || '创建房间失败');
    }
  });

  el.btnJoinCode.addEventListener('click', async () => {
    const code = el.joinCode.value.trim().toUpperCase();
    if (!code) {
      showToast('请输入房间码');
      return;
    }
    const name = state.playerName || el.playerName.value.trim() || '玩家';
    try {
      await net.connect(net.getLocalOrigin());
      net.joinLobby(name, lobbyJoinOpts());
      const resolved = await net.resolveRoom(code);
      if (!resolved.ok) {
        showToast(resolved.message || '未找到房间');
        return;
      }
      await net.joinRoomOnHost(
        resolved.roomId,
        name,
        resolved.host,
        {
          ...lobbyJoinOpts(),
          local: resolved.local === true,
          preferLocal: resolved.local === true,
        }
      );
    } catch (err) {
      const base = (err && err.message) || '加入失败';
      showToast(
        base.indexOf('websocket error') >= 0
          ? `${base}（若持续失败，请以管理员身份运行 修复DNS.bat 后重开浏览器）`
          : base
      );
    }
  });

  el.btnStart.addEventListener('click', () => net.startGame());
  el.btnLeave.addEventListener('click', () => leaveAndReturnLocal());
  if (el.btnGameMenu) {
    el.btnGameMenu.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleGameMenu();
    });
  }
  if (el.btnQuitGame) {
    el.btnQuitGame.addEventListener('click', () => {
      closeGameMenu();
      if (typeof net.quitGame === 'function') net.quitGame();
    });
  }
  document.addEventListener('click', (ev) => {
    if (!el.gameMenu || el.gameMenu.hidden) return;
    if (el.gameMenu.contains(ev.target)) return;
    closeGameMenu();
  });

  net.on('player:me', (data) => {
    state.me = data;
    if (data && data.name) {
      state.playerName = window.PlayerNick.stripBaseName(data.name) || '玩家';
      saveNick(state.playerName);
    }
    if (data && data.tag) {
      try {
        localStorage.setItem(
          window.PlayerNick.TAG_KEY,
          window.PlayerNick.normalizeTag(data.tag)
        );
      } catch (_) {
        /* ignore */
      }
    } else {
      window.PlayerNick.ensureTag();
    }
    refreshNickUi();
    updateMeLabel();
  });

  net.on('lobby:update', (data) => {
    if (data && Object.prototype.hasOwnProperty.call(data, 'mqttBulletin')) {
      state.mqttBulletin = Boolean(data.mqttBulletin);
    }
    fillGameOptions(data.games);
    renderLobbyRooms(data.rooms);
    renderPeers(data.peers);
    renderLobbyPeople(data.people);
    markLobbyRefreshed();
    if (
      state.inLobby &&
      !state.mqttBulletin &&
      !state.mqttHintShown &&
      (!(data.peers || []).length)
    ) {
      state.mqttHintShown = true;
      showToast('跨网默认使用 MQTT 广播，无需填写地址');
    }
  });

  net.on('room:update', (data) => {
    const prevRoomId = state._lastRoomId;
    state.room = data.room;
    closeAllModals();
    if (data.room.status === 'playing') {
      rememberActivePlay(data.room);
      showView('game');
      if (state.game) renderGame();
    } else {
      rememberActivePlay(data.room);
      state.game = null;
      showView('room');
      renderRoom();
      if (data.room.id && data.room.id !== prevRoomId) {
        showToast(`已进入房间「${data.room.name || data.room.id}」`);
      }
    }
    state._lastRoomId = data.room.id || null;
    rememberChatRoom(data.room.id);
    // 进房即存档：房间码 + 当前用户 id（供刷新后强匹配）
    const seatId = state.me && state.me.id;
    if (data.room.id && seatId) {
      rememberGameArchive({
        roomId: data.room.id,
        seatId,
        phase: data.room.status || null,
      });
    }
    if (data.room.status !== 'playing') renderRoom();
  });

  net.on('session:reclaimed', (data) => {
    state._sessionReclaimed = true;
    if (data && data.roomId) {
      const status =
        data.status || (data.playing ? 'playing' : 'waiting');
      rememberActivePlay({ id: data.roomId, status });
      if (!state.room || state.room.id !== data.roomId) {
        state.room = { id: data.roomId, status };
      } else {
        state.room.status = status;
      }
      state._lastRoomId = data.roomId;
      if (state.me && state.me.id) {
        rememberGameArchive({
          roomId: data.roomId,
          seatId: state.me.id,
          phase: status,
        });
      }
    }
    if (data && data.playing) {
      showView('game');
    } else if (data && data.roomId) {
      showView('room');
    }
  });

  net.on('session:reclaim-failed', () => {
    bounceToLocalLobby('房间已失效，已返回大厅').catch(() => {});
  });

  net.on('room:left', async (data) => {
    if (leavingToLocal) return;
    const pending = state.pendingJoinAfterLeave;
    state.pendingJoinAfterLeave = null;
    if (pending && pending.roomId) {
      state.room = null;
      state.game = null;
      state._lastRoomId = null;
      try {
        await joinWithInvite(pending);
      } catch (err) {
        showToast(err.message || '接受邀请失败');
        showView('lobby');
        updateMeLabel();
      }
      return;
    }
    // 房主退出会解散房间：在房内的人立刻回大厅，不要当成断线去抢座位
    if (data && data.reason === 'dissolved') {
      await bounceToLocalLobby('房间已解散，已返回大厅');
      return;
    }
    // 对局进行中先尝试认领；失败会走 session:reclaim-failed 回大厅
    if (state.game && !state.game.over && el.viewGame && !el.viewGame.hidden) {
      showToast('连接异常，正在恢复对局…');
      const roomId =
        (state.room && state.room.id) ||
        state._lastRoomId ||
        (loadGameArchive() && loadGameArchive().roomId);
      net.joinLobby(
        state.playerName || (el.playerName && el.playerName.value) || '玩家',
        rejoinLobbyOpts({ roomId })
      );
      return;
    }
    await bounceToLocalLobby('房间已解散，已返回大厅');
  });

  net.on('room:error', (data) => showToast(data.message || '房间错误'));
  net.on('game:started', (data) => {
    state.game = data.state;
    if (state.room) rememberActivePlay(state.room);
    else if (state._lastRoomId) {
      rememberActivePlay({ id: state._lastRoomId, status: 'playing' });
    }
    const roomId = state.room && state.room.id ? state.room.id : state._lastRoomId;
    const seatId = data && data.state && data.state.me ? data.state.me.id : null;
    rememberGameArchive({
      roomId,
      seatId,
      phase: data && data.state ? data.state.phase : null,
    });
    showView('game');
    renderGame();
  });
  net.on('game:state', (data) => {
    state.game = data.state;
    if (state.room) rememberActivePlay(state.room);
    else if (state._lastRoomId) {
      rememberActivePlay({ id: state._lastRoomId, status: 'playing' });
    }
    const roomId = state.room && state.room.id ? state.room.id : state._lastRoomId;
    const seatId = data && data.state && data.state.me ? data.state.me.id : null;
    rememberGameArchive({
      roomId,
      seatId,
      phase: data && data.state ? data.state.phase : null,
    });
    showView('game');
    renderGame();
  });
  net.on('game:error', (data) => showToast(data.message || '操作失败'));
  net.on('chat:message', (msg) => pushChatMessage(msg));
  net.on('chat:error', (data) => showToast((data && data.message) || '发送失败'));
  net.on('game:player-left', (data) => {
    const name = (data && data.name) || '有玩家';
    showToast(`${name} 已离开对局`);
    if (state.room && Array.isArray(state.room.players) && data && data.playerId) {
      const seat = state.room.players.find((p) => p.id === data.playerId);
      if (seat) seat.left = true;
    }
    if (state.game) {
      const ids = new Set(state.game.leftPlayerIds || []);
      if (data && data.playerId) ids.add(data.playerId);
      state.game.leftPlayerIds = [...ids];
      if (Array.isArray(state.game.players)) {
        for (const p of state.game.players) {
          if (data && p.id === data.playerId) p.left = true;
        }
      }
      renderGame();
    }
  });
  net.on('game:quit-ok', () => {
    bounceToLocalLobby('已退出对局，返回大厅').catch(() => {});
  });

  function isInLiveSession() {
    return Boolean(
      state.game ||
        state.room ||
        (el.viewGame && !el.viewGame.hidden) ||
        (el.viewRoom && !el.viewRoom.hidden)
    );
  }

  function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function originOf(url) {
    try {
      return new URL(url, window.location.href).origin;
    } catch (_) {
      return String(url || '');
    }
  }

  function cancelRemoteRecover() {
    if (remoteRecoverTimer) {
      clearTimeout(remoteRecoverTimer);
      remoteRecoverTimer = null;
    }
  }

  function probeMissesRoom(probe) {
    if (!probe || probe.ok) return false;
    const msg = String((probe && probe.message) || '');
    return !msg.includes('超时');
  }

  function scheduleRemoteRecover() {
    if (!net.isOnRemoteHost() || remoteRecovering) return;
    cancelRemoteRecover();
    remoteRecoverTimer = setTimeout(() => {
      remoteRecoverTimer = null;
      recoverRemoteSession().catch((err) => {
        bounceToLocalLobby(err && err.message ? err.message : '房间已失效，已返回大厅');
      });
    }, 2500);
  }

  async function recoverRemoteSession() {
    if (leavingToLocal || remoteRecovering) return;
    const roomId =
      (state.room && state.room.id) ||
      state._lastRoomId ||
      (loadGameArchive() && loadGameArchive().roomId) ||
      null;
    if (!roomId || !isInLiveSession()) return;

    remoteRecovering = true;
    state._rejoining = true;
    const deadHost = net.getCurrentUrl();
    const name =
      state.playerName || (el.playerName && el.playerName.value) || '玩家';
    showToast('公网隧道中断，正在查找新地址…');
    try {
      if (typeof net.stopAutoReconnect === 'function') net.stopAutoReconnect();
      await net.connect(net.getLocalOrigin());
      let notFoundStreak = 0;
      for (let i = 0; i < 12; i++) {
        if (leavingToLocal) return;
        if (originOf(net.getCurrentUrl()) !== originOf(net.getLocalOrigin())) {
          await net.connect(net.getLocalOrigin());
        }
        const probe = await net.probeRoom(roomId);
        if (probeMissesRoom(probe)) {
          notFoundStreak += 1;
          if (notFoundStreak >= 8) {
            await bounceToLocalLobby('房间已失效，已返回大厅');
            return;
          }
        } else {
          notFoundStreak = 0;
        }
        const host = probe && probe.host;
        if (probe && probe.ok && host) {
          const hostOrigin = originOf(host);
          if (hostOrigin === originOf(deadHost)) {
            await sleepMs(2000);
            continue;
          }
          showToast('已找到新隧道，正在回到对局…');
          try {
            const opts = rejoinLobbyOpts(probe);
            await net.joinRoomOnHost(roomId, name, host, {
              ...opts,
              local: probe.local === true,
              preferLocal: probe.local === true,
            });
            const ok = await waitForSessionRestore(4000);
            if (ok && isInRestoredGameView()) {
              showToast('已重新连上对局');
              return;
            }
          } catch (_) {
            /* 新地址可能还没就绪，继续等 */
          }
        }
        await sleepMs(2000);
      }
      await bounceToLocalLobby('房间已失效，已返回大厅');
    } finally {
      remoteRecovering = false;
      state._rejoining = false;
    }
  }

  net.on('disconnect', () => {
    if (leavingToLocal) return;
    // 对局中短暂断线：只提示重连，不跳回大厅（否则会出现「1号回房、其他人还在打」）
    if (isInLiveSession()) {
      showToast('连接中断，正在重连…');
      scheduleRemoteRecover();
      return;
    }
    showToast('与服务器断开连接');
  });

  net.on('connect', () => {
    if (leavingToLocal) return;
    cancelRemoteRecover();
    // 正在手动重连流程中，由 acceptPendingRejoin / 隧道恢复自己发 lobby:join
    if (state.pendingRejoin || state._rejoining || remoteRecovering) return;
    const name = (state.playerName || (el.playerName && el.playerName.value) || '').trim();
    if (!name) return;
    if (isInLiveSession()) {
      net.joinLobby(
        name,
        rejoinLobbyOpts({
          roomId: (state.room && state.room.id) || state._lastRoomId,
        })
      );
      return;
    }
    net.joinLobby(name, lobbyJoinOpts());
    state.inLobby = true;
  });

  fillGameOptions(state.games);
  updateCreateForm();
  showView('lobby');

  const savedNick = loadSavedNick();
  if (savedNick) {
    state.playerName = savedNick;
    if (el.playerName) el.playerName.value = savedNick;
    refreshNickUi();
    enterLobbyWithName(savedNick, { silent: true }).catch((err) => {
      showToast(err.message || '自动进入大厅失败，请手动进入');
      state.inLobby = false;
      showLobbyHome();
    });
  } else {
    net.connect(net.getLocalOrigin()).catch(() => {});
    showLobbyHome();
    updateMeLabel();
  }

  setInterval(() => {
    if (el.viewGame && !el.viewGame.hidden) updateTurnTimer();
  }, 250);
})();
