'use strict';

(async function () {
  const net = window.GameNet;
  const I18n = window.I18n;
  function t(key, vars) {
    return I18n && typeof I18n.t === 'function' ? I18n.t(key, vars) : key;
  }
  function gameLabelOf(id, fallback) {
    const k = 'games.' + id;
    const v = t(k);
    return v === k ? fallback || id : v;
  }
  function modeLabelOf(id, fallback) {
    const k = 'games.modes.' + id;
    const v = t(k);
    return v === k ? fallback || id : v;
  }

  let currentViewName = 'lobby';

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
    btnToggleSpectate: document.getElementById('btn-toggle-spectate'),
    chkPassiveMode: document.getElementById('chk-passive-mode'),
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
    createRoomTitle: document.getElementById('create-room-title'),
    joinCode: document.getElementById('join-code'),
    btnJoinCode: document.getElementById('btn-join-code'),
    roomList: document.getElementById('room-list'),
    roomListEmpty: document.getElementById('room-list-empty'),
    roomListPlaying: document.getElementById('room-list-playing'),
    roomListPlayingEmpty: document.getElementById('room-list-playing-empty'),
    roomTitle: document.getElementById('room-title'),
    roomGameLabel: document.getElementById('room-game-label'),
    roomCode: document.getElementById('room-code'),
    roomHiddenBadge: document.getElementById('room-hidden-badge'),
    memberList: document.getElementById('member-list'),
    observerList: document.getElementById('observer-list'),
    observerSection: document.getElementById('observer-section'),
    btnStart: document.getElementById('btn-start'),
    btnEditRoom: document.getElementById('btn-edit-room'),
    btnRoomRules: document.getElementById('btn-room-rules'),
    btnLeave: document.getElementById('btn-leave'),
    roomStartHint: document.getElementById('room-start-hint'),
    roomBannerHint: document.querySelector('.room-banner-hint'),
    gameMenu: document.getElementById('game-menu'),
    btnGameMenu: document.getElementById('btn-game-menu'),
    gameMenuPop: document.getElementById('game-menu-pop'),
    btnQuitGame: document.getElementById('btn-quit-game'),
    btnMenuLang: document.getElementById('btn-menu-lang'),
    menuLangSub: document.getElementById('menu-lang-sub'),
    menuLangItem: document.getElementById('menu-lang-item'),
    btnMenuBgm: document.getElementById('btn-menu-bgm'),
    menuBgmSub: document.getElementById('menu-bgm-sub'),
    menuBgmRange: document.getElementById('menu-bgm-range'),
    menuBgmValue: document.getElementById('menu-bgm-value'),
    turnTimer: document.getElementById('turn-timer'),
    turnTimerSec: document.getElementById('turn-timer-sec'),
    matchClock: document.getElementById('match-clock'),
    matchClockTime: document.getElementById('match-clock-time'),
    peopleCtx: document.getElementById('people-ctx'),
    roomCtx: document.getElementById('room-ctx'),
    rejoinModal: document.getElementById('rejoin-modal'),
    rejoinMessage: document.getElementById('rejoin-message'),
    btnAcceptRejoin: document.getElementById('btn-accept-rejoin'),
    btnDeclineRejoin: document.getElementById('btn-decline-rejoin'),
    btnCloseRejoin: document.getElementById('btn-close-rejoin'),
    roomBusyOverlay: document.getElementById('room-busy-overlay'),
    roomBusyMessage: document.getElementById('room-busy-message'),
    passiveLockOverlay: document.getElementById('passive-lock-overlay'),
    passiveLockDesc: document.getElementById('passive-lock-desc'),
    btnExitPassive: document.getElementById('btn-exit-passive'),
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
    createModalMode: 'create', // 'create' | 'edit' | 'create-on-host'
    createOnHostTarget: null,
    codeModalMode: 'join', // 'join' | 'spectate'
    isSpectator: false,
    passiveMode: false,
    roomCtxTarget: null,
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
  let roomBusyTimer = null;
  let leavingToLocal = false;
  let ignoreRoomLeftId = null;
  let ignoreRoomLeftUntil = 0;
  let lobbyRefreshTimer = null;
  let remoteRecoverTimer = null;
  let remoteRecovering = false;
  const roomBubbleTimers = new Map();
  const ROOM_BUBBLE_MS = 3000;
  const LOBBY_REFRESH_MS = 3000;
  const NICK_STORAGE_KEY = 'lianji.playerName';
  const GUEST_FLAG_KEY = 'lianji.guestClient';

  function readBootQuery() {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch (_) {
      return new URLSearchParams();
    }
  }

  function isGuestClient() {
    try {
      if (sessionStorage.getItem(GUEST_FLAG_KEY) === '1') return true;
    } catch (_) {}
    return false;
  }

  function markGuestClient(on) {
    try {
      if (on) sessionStorage.setItem(GUEST_FLAG_KEY, '1');
      else sessionStorage.removeItem(GUEST_FLAG_KEY);
    } catch (_) {}
  }

  function syncGuestChrome() {
    const guest = isGuestClient();
    if (el.btnToggleCreate) el.btnToggleCreate.hidden = guest;
    if (el.chkPassiveMode) {
      const wrap = document.getElementById('passive-toggle-wrap');
      if (wrap) wrap.hidden = guest;
    }
    // 加入端不可本机开房，但允许在被动主机上代开（create-on-host）
    if (
      guest &&
      el.createRoomModal &&
      !el.createRoomModal.hidden &&
      state.createModalMode !== 'create-on-host'
    ) {
      setCreatePanelOpen(false);
    }
    if (guest) applyPassiveLockUi(false);
  }

  /** 对局进行中不可退出被动 */
  function isPassiveExitBlocked() {
    const room = state.room;
    if (!room || room.status !== 'playing') return false;
    if (state.game && state.game.over) return false;
    return true;
  }

  function syncPassiveExitButton() {
    if (!el.btnExitPassive) return;
    const blocked = state.passiveMode && isPassiveExitBlocked();
    el.btnExitPassive.disabled = blocked;
    el.btnExitPassive.title = blocked
      ? '对局进行中，请等待本局结束后再退出'
      : '';
    if (el.passiveLockDesc) {
      el.passiveLockDesc.textContent = blocked
        ? '本机正在托管对局，无法退出被动模式，请等待本局结束。'
        : state.room && state.room.id
          ? '无人值守中。退出被动模式将解散当前房间。'
          : '无人值守：他人可在你的主机上开房与对局；本机保持锁定，不观战、不操作。结束后仍留在被动模式。';
    }
  }

  /** 被动模式锁定：暗屏 + 屏蔽点击，仅保留退出按钮 */
  function applyPassiveLockUi(on) {
    const locked = Boolean(on) && !isGuestClient();
    state.passiveMode = locked;
    document.body.classList.toggle('is-passive-locked', locked);
    if (el.passiveLockOverlay) el.passiveLockOverlay.hidden = !locked;
    if (el.chkPassiveMode) el.chkPassiveMode.checked = locked;
    if (locked) {
      hidePeopleCtx();
      hideRoomCtx();
      closeAllModals();
      if (el.roomBusyOverlay) el.roomBusyOverlay.hidden = true;
    }
    syncPassiveExitButton();
  }

  function clearBootQueryFromUrl() {
    try {
      if (!window.location.search) return;
      const url = window.location.pathname + (window.location.hash || '');
      window.history.replaceState({}, '', url);
    } catch (_) {}
  }

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
    const next = window.PlayerNick.stripBaseName(name) || t('app.playerDefault');
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
  let chatDockFocusHoldTimer = null;
  const chatScrollState = {
    all: { scrollTop: 0, atBottom: true },
    room: { scrollTop: 0, atBottom: true },
  };

  function chatChannelKey(channel) {
    const ch = channel != null ? channel : state.chatChannel;
    return ch === 'room' ? 'room' : 'all';
  }

  function saveChatScroll(channel) {
    if (!el.chatLog) return;
    const key = chatChannelKey(channel);
    const log = el.chatLog;
    const threshold = 28;
    const maxScroll = Math.max(0, log.scrollHeight - log.clientHeight);
    const atBottom = maxScroll - log.scrollTop <= threshold;
    chatScrollState[key] = {
      scrollTop: log.scrollTop,
      atBottom,
    };
  }

  function restoreChatScroll(channel) {
    if (!el.chatLog) return;
    const key = chatChannelKey(channel);
    const st = chatScrollState[key] || { scrollTop: 0, atBottom: true };
    const maxScroll = Math.max(0, el.chatLog.scrollHeight - el.chatLog.clientHeight);
    if (st.atBottom) {
      el.chatLog.scrollTop = el.chatLog.scrollHeight;
    } else {
      el.chatLog.scrollTop = Math.min(st.scrollTop, maxScroll);
    }
    saveChatScroll(channel);
  }

  function markSelfRoomLeave(roomId) {
    ignoreRoomLeftId = roomId ? String(roomId).toUpperCase() : null;
    ignoreRoomLeftUntil = Date.now() + 10000;
  }

  function shouldIgnoreRoomLeft(data) {
    const roomId = data && data.roomId ? String(data.roomId).toUpperCase() : '';
    if (!roomId || !ignoreRoomLeftId || Date.now() > ignoreRoomLeftUntil) {
      if (Date.now() > ignoreRoomLeftUntil) ignoreRoomLeftId = null;
      return false;
    }
    return roomId === ignoreRoomLeftId;
  }

  function holdChatDockFocus(ms = 320) {
    chatDockPreserveActive = true;
    if (chatDockFocusHoldTimer) clearTimeout(chatDockFocusHoldTimer);
    chatDockFocusHoldTimer = setTimeout(() => {
      chatDockFocusHoldTimer = null;
      chatDockPreserveActive = false;
    }, ms);
  }

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
      el.chatHeadUnread.textContent = t('chat.newMessage');
    }
  }

  function setChatDockActive(active) {
    if (!el.chatDock) return;
    const on = Boolean(active);
    if (!on && el.chatDock.classList.contains('is-active')) {
      saveChatScroll();
    }
    el.chatDock.classList.toggle('is-active', on);
    if (on) {
      clearChatAttention();
      requestAnimationFrame(() => restoreChatScroll());
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
        state.chatChannel === 'room' ? t('chat.emptyRoom') : t('chat.empty');
      return;
    }
    const html = previewList
      .map((msg) => {
        const name = window.PlayerNick.fullLabel(msg.name || t('app.playerDefault'), msg.tag || '');
        return `<div class="chat-collapsed-line">${escapeHtml(name)}: ${escapeHtml(msg.text || '')}</div>`;
      })
      .join('');
    console.debug('[chat-debug] collapsed preview render', {
      channel: state.chatChannel,
      count: previewList.length,
      lines: previewList.map((msg) => ({
        name: window.PlayerNick.fullLabel(msg.name || t('app.playerDefault'), msg.tag || ''),
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
    holdChatDockFocus();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!el.chatInput || el.chatDock.hidden) return;
        try {
          el.chatInput.focus({ preventScroll: true });
          if (typeof el.chatInput.select === 'function') el.chatInput.select();
        } catch (_) {}
      });
    });
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

  function pinChatDockPosition() {
    if (!el.chatDock) return null;
    const rect = el.chatDock.getBoundingClientRect();
    const left = Math.round(rect.left);
    const bottom = Math.round(window.innerHeight - rect.bottom);
    el.chatDock.classList.add('is-custom-pos');
    el.chatDock.style.left = `${left}px`;
    el.chatDock.style.bottom = `${bottom}px`;
    return {
      left,
      bottom,
      w: rect.width || el.chatDock.offsetWidth,
      h: rect.height || el.chatDock.offsetHeight,
    };
  }

  function saveChatDockPos() {
    if (!el.chatDock) return;
    try {
      const pinned = pinChatDockPosition();
      if (!pinned) return;
      localStorage.setItem(
        CHAT_DOCK_POS_KEY,
        JSON.stringify({ left: pinned.left, bottom: pinned.bottom })
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
    return `n:${name || t('app.playerDefault')}`;
  }

  function memberSpeakerKey(player) {
    const tag = window.PlayerNick.normalizeTag(player && player.tag);
    if (tag) return `t:${tag}`;
    const name = window.PlayerNick.stripBaseName((player && player.name) || '');
    return `n:${name || t('app.playerDefault')}`;
  }

  function findMemberRowForSpeaker(key) {
    if (!key) return null;
    const lists = [el.memberList, el.observerList].filter(Boolean);
    for (const list of lists) {
      for (const li of list.querySelectorAll('li[data-speaker-key]')) {
        if (li.dataset.speakerKey === key) return li;
      }
    }
    return null;
  }

  function clearRoomChatBubbles() {
    for (const timer of roomBubbleTimers.values()) clearTimeout(timer);
    roomBubbleTimers.clear();
    state.roomChatBubbles = {};
    for (const list of [el.memberList, el.observerList]) {
      if (!list) continue;
      list.querySelectorAll('.room-chat-bubble').forEach((node) => node.remove());
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
    const name = window.PlayerNick.fullLabel(msg.name || t('app.playerDefault'), msg.tag || '');
    node.textContent = `${name}: ${msg.text || ''}`;
    const laneTop = 88 + Math.floor(Math.random() * 220);
    node.style.top = `${laneTop}px`;
    document.body.appendChild(node);
    const textLen = String(node.textContent || '').length;
    const durationMs = Math.min(18000, Math.max(8000, 6500 + textLen * 70));
    node.style.animationDuration = `${durationMs}ms`;
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => {
      if (node.isConnected) node.remove();
    }, durationMs + 300);
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
        state.chatChannel === 'room' ? t('chat.placeholderRoom') : t('chat.placeholderAll');
    }
    if (el.chatHeadChannel) {
      el.chatHeadChannel.textContent =
        state.chatChannel === 'room' ? t('chat.channelRoom') : t('chat.channelAll');
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
    saveChatScroll();
    state.chatChannel = channel === 'room' ? 'room' : 'all';
    if (state.chatChannel === 'all') state.unreadAll = 0;
    else state.unreadRoom = 0;
    syncChatTabs();
    renderChatLog();
  }

  function renderChatLog(options) {
    if (!el.chatLog) return;
    const list =
      state.chatChannel === 'room' ? state.chatRoom : state.chatAll;
    const myTagNow = myTag();
    const myName = window.PlayerNick.stripBaseName(state.playerName || '');
    const key = chatChannelKey();
    const prev = chatScrollState[key] || { scrollTop: 0, atBottom: true };
    const isActive =
      el.chatDock && el.chatDock.classList.contains('is-active');
    const forceBottom = options && options.scrollToBottom;
    const stickBottom = forceBottom || (isActive && prev.atBottom);

    el.chatLog.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('li');
      empty.className = 'chat-empty';
      empty.textContent =
        state.chatChannel === 'room' ? t('chat.emptyRoom') : t('chat.empty');
      el.chatLog.appendChild(empty);
      chatScrollState[key] = { scrollTop: 0, atBottom: true };
      return;
    }
    for (const msg of list) {
      const li = document.createElement('li');
      const mine =
        (msg.tag && msg.tag === myTagNow) ||
        (!msg.tag && msg.name === myName);
      if (mine) li.classList.add('is-mine');
      const hue = tagHue(msg.tag || msg.name);
      const from = nickHtml(msg.name || t('app.playerDefault'), msg.tag);
      li.innerHTML =
        `<span class="chat-dot" style="background:hsl(${hue},52%,58%)"></span>` +
        `<span class="chat-body">` +
        `<span class="chat-from">${from}</span>` +
        `<span class="chat-text">${escapeHtml(msg.text)}</span>` +
        `</span>`;
      el.chatLog.appendChild(li);
    }

    const applyScroll = () => {
      if (!el.chatLog) return;
      const maxScroll = Math.max(
        0,
        el.chatLog.scrollHeight - el.chatLog.clientHeight
      );
      if (stickBottom) {
        el.chatLog.scrollTop = el.chatLog.scrollHeight;
        chatScrollState[key] = {
          scrollTop: el.chatLog.scrollTop,
          atBottom: true,
        };
      } else {
        el.chatLog.scrollTop = Math.min(prev.scrollTop, maxScroll);
        if (prev.atBottom && !isActive) {
          chatScrollState[key] = { scrollTop: prev.scrollTop, atBottom: true };
        } else {
          saveChatScroll();
        }
      }
    };
    requestAnimationFrame(applyScroll);
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
    if (state.chatChannel === channel) {
      const active =
        el.chatDock && el.chatDock.classList.contains('is-active');
      renderChatLog({
        scrollToBottom:
          isMyChatMessage(msg) ||
          (active && (chatScrollState[channel]?.atBottom ?? true)),
      });
    }
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
      client:
        (window.ClientPlatform && window.ClientPlatform.current()) || '',
      role:
        (window.ClientPlatform && window.ClientPlatform.currentRole()) ||
        'host',
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
      client:
        (window.ClientPlatform && window.ClientPlatform.current()) || '',
      role:
        (window.ClientPlatform && window.ClientPlatform.currentRole()) ||
        'host',
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
    el.lobbyRefreshHint.textContent = t('lobby.refreshHintAt', {
      time: formatRefreshTime(),
    });
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

  if (I18n && typeof I18n.init === 'function') {
    try {
      await I18n.init();
    } catch (err) {
      console.warn('i18n init failed', err);
    }
  }

  // 先拉游戏清单，挂载各游戏面板 / 样式 / 脚本
  try {
    const info = await fetch('/api/info').then((r) => r.json());
    state.games = info.games || [];
    await window.GameBoot.mountPanels(state.games);
    if (I18n && typeof I18n.applyDom === 'function') {
      I18n.applyDom(document.getElementById('game-panels') || document);
    }
  } catch (err) {
    console.error(err);
    document.getElementById('toast').hidden = false;
    document.getElementById('toast').textContent = t('game.loadFail');
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
  if (window.LasidaoUi) window.LasidaoUi.bindButtons(net);

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
    }, 3200);
  }

  function showRoomBusy(mode, message) {
    state.roomBusy = mode;
    if (el.roomBusyOverlay) el.roomBusyOverlay.hidden = false;
    if (el.roomBusyMessage) {
      el.roomBusyMessage.textContent =
        message ||
        (mode === 'passive'
          ? '正在进入被动模式…'
          : mode === 'create'
            ? t('create.creating')
            : t('create.joining'));
    }
    clearTimeout(roomBusyTimer);
    roomBusyTimer = setTimeout(() => {
      if (!state.roomBusy) return;
      const was = state.roomBusy;
      hideRoomBusy();
      if (was === 'passive') {
        if (el.chkPassiveMode) el.chkPassiveMode.checked = false;
        applyPassiveLockUi(false);
        showToast('进入被动模式超时，请重试');
      } else {
        showToast(was === 'create' ? t('create.createTimeout') : t('create.joinTimeout'));
      }
    }, 90000);
  }

  function hideRoomBusy() {
    state.roomBusy = null;
    clearTimeout(roomBusyTimer);
    roomBusyTimer = null;
    if (el.roomBusyOverlay) el.roomBusyOverlay.hidden = true;
    document.documentElement.classList.remove('boot-joining');
  }

  function updateRoomBusyMessage(message) {
    if (!state.roomBusy || !message) return;
    if (el.roomBusyMessage) el.roomBusyMessage.textContent = message;
  }

  async function joinRoomWithBusy(joinFn) {
    if (state.roomBusy && state.roomBusy !== 'join') return;
    if (!state.roomBusy) {
      showRoomBusy('join', t('create.joining'));
    } else {
      updateRoomBusyMessage(t('create.joining'));
    }
    try {
      await joinFn();
    } catch (err) {
      hideRoomBusy();
      document.documentElement.classList.remove('boot-joining');
      throw err;
    }
  }

  function currentGameType() {
    if (state.game && state.game.type) return state.game.type;
    if (state.room && state.room.gameType) return state.room.gameType;
    return null;
  }

  /** 三国杀专属 BGM；其他游戏不使用 /games/sgs/res 下的资源 */
  function syncBgm(viewName) {
    const A = window.SgsAssets;
    if (!A || typeof A.playBgm !== 'function') return;
    const isSgs = currentGameType() === 'sgs';
    if (viewName === 'room' && isSgs) {
      A.playBgm('lobby');
      return;
    }
    if (viewName === 'game' && isSgs) {
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
    closeLangSub();
    closeBgmSub();
  }

  function closeLangSub() {
    if (el.menuLangSub) el.menuLangSub.hidden = true;
    if (el.btnMenuLang) el.btnMenuLang.setAttribute('aria-expanded', 'false');
  }

  function closeBgmSub() {
    if (el.menuBgmSub) el.menuBgmSub.hidden = true;
    if (el.btnMenuBgm) el.btnMenuBgm.setAttribute('aria-expanded', 'false');
  }

  function syncBgmMenuSlider() {
    if (!el.menuBgmRange || !window.BgmVolume) return;
    const pct = window.BgmVolume.percent();
    el.menuBgmRange.value = String(pct);
    if (el.menuBgmValue) el.menuBgmValue.textContent = pct + '%';
    if (el.menuBgmRange) el.menuBgmRange.setAttribute('aria-valuenow', String(pct));
  }

  function syncLangMenuActive() {
    if (!el.menuLangSub) return;
    const cur = I18n.getLang();
    for (const btn of el.menuLangSub.querySelectorAll('[data-lang]')) {
      btn.classList.toggle('is-active', btn.getAttribute('data-lang') === cur);
    }
  }

  function toggleLangSub() {
    if (!el.menuLangSub || !el.btnMenuLang) return;
    const open = el.menuLangSub.hidden;
    if (open) closeBgmSub();
    el.menuLangSub.hidden = !open;
    el.btnMenuLang.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) syncLangMenuActive();
  }

  function toggleBgmSub() {
    if (!el.menuBgmSub || !el.btnMenuBgm) return;
    const open = el.menuBgmSub.hidden;
    if (open) closeLangSub();
    el.menuBgmSub.hidden = !open;
    el.btnMenuBgm.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) syncBgmMenuSlider();
  }

  function toggleGameMenu() {
    if (!el.gameMenuPop || !el.btnGameMenu) return;
    const open = el.gameMenuPop.hidden;
    el.gameMenuPop.hidden = !open;
    el.btnGameMenu.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) {
      closeLangSub();
      closeBgmSub();
    } else {
      syncLangMenuActive();
      syncBgmMenuSlider();
    }
  }

  function syncQuitMenuItem() {
    if (!el.btnQuitGame) return;
    el.btnQuitGame.hidden = currentViewName !== 'game';
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
    // 大厅 / 房间等待 / 对局中均显示聊天室（含卡拉斯坦等）
    const shouldShow =
      state.inLobby &&
      (name === 'lobby' || name === 'room' || name === 'game');
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
    if (
      el.chatInput &&
      document.activeElement === el.chatInput &&
      !chatDockDragging
    ) {
      setChatDockActive(true);
    } else {
      setChatDockActive(false);
    }
    if (!chatDockPosLoaded) {
      loadChatDockPos();
      chatDockPosLoaded = true;
    }
  }

  function showView(name) {
    currentViewName = name;
    el.viewLobby.hidden = name !== 'lobby';
    el.viewRoom.hidden = name !== 'room';
    el.viewGame.hidden = name !== 'game';

    document.body.classList.remove('phase-lobby', 'phase-room', 'phase-game');
    document.body.classList.add(
      name === 'room' ? 'phase-room' : name === 'game' ? 'phase-game' : 'phase-lobby'
    );

    // 左上角菜单始终可见；对局中额外显示「退出游戏」
    if (el.gameMenu) el.gameMenu.hidden = false;
    syncQuitMenuItem();
    if (name !== 'game') closeGameMenu();

    if (el.appPhaseTitle) {
      el.appPhaseTitle.textContent =
        name === 'room'
          ? t('app.titleRoom')
          : name === 'game'
            ? t('app.titleGame')
            : t('app.title');
    }
    // 昵称只在「联机大厅」标题旁显示；进房/对局时收起
    refreshNickUi(name);
    if (el.lobbyPeopleTitle) {
      el.lobbyPeopleTitle.textContent =
        name === 'room' ? t('lobby.peopleOutside') : t('lobby.people');
    }
    if (el.lobbyPeopleAside) {
      el.lobbyPeopleAside.setAttribute(
        'aria-label',
        name === 'room' ? t('lobby.peopleOutside') : t('lobby.people')
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
    updateMatchClock();
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
    return playerHasLeft(id) ? t('app.playerLeft', { name }) : name;
  }

  function updateMeLabel() {
    if (!state.inLobby) {
      el.meLabel.textContent = t('app.notInLobby');
      return;
    }
    const remote = net.isOnRemoteHost() ? t('app.connectedHost') : t('app.localLobby');
    if (state.room) {
      const st = state.room.status === 'playing' ? t('app.titleGame') : t('app.inRoom');
      el.meLabel.textContent = `${remote} · ${st}`;
    } else {
      el.meLabel.textContent = remote;
    }
  }

  function refreshNickUi(viewName) {
    const name =
      window.PlayerNick.stripBaseName(
        state.playerName || (state.me && state.me.name) || t('app.playerDefault')
      ) || t('app.playerDefault');
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
    if (room.local) return t('room.viaLocal');
    const viaRaw = String(room.via || '');
    return viaRaw.includes('mqtt') ? t('room.viaMqtt') : t('room.viaRemote');
  }

  function remoteBadge(person) {
    const client = String((person && person.client) || '').toLowerCase();
    const role = String((person && person.role) || '').toLowerCase();
    let plat = '';
    if (client === 'windows') plat = t('lobby.clientWindows');
    else if (client === 'mac') plat = t('lobby.clientMac');
    else if (client === 'mobile') plat = t('lobby.clientMobile');
    let roleLabel = '';
    if (role === 'host') roleLabel = t('lobby.roleHost');
    else if (role === 'client') roleLabel = t('lobby.roleClient');
    const parts = [plat, roleLabel].filter(Boolean);
    if (!parts.length) return '';
    const label = parts.join('·');
    return (
      ' <span class="people-client" title="' +
      label +
      '">[' +
      label +
      ']</span>'
    );
  }

  function selectedGameMeta() {
    const id = el.gameType.value;
    return state.games.find((g) => g.id === id) || null;
  }

  function updateCreateForm() {
    const g = selectedGameMeta();
    if (!g) {
      el.gameHint.textContent = t('create.hintDefault');
      return;
    }

    // 三国杀为多模式；其他游戏仅「标准模式」（由各游戏 modes 下发，缺省则兜底）
    const modes =
      g.modes && g.modes.length
        ? g.modes
        : [{ id: 'standard', label: t('create.modeStandard') }];
    if (el.gameModeWrap) el.gameModeWrap.hidden = false;
    if (el.gameMode) {
      const cur = el.gameMode.value;
      el.gameMode.innerHTML = '';
      for (const m of modes) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = modeLabelOf(m.id, m.label);
        el.gameMode.appendChild(opt);
      }
      if ([...el.gameMode.options].some((o) => o.value === cur)) {
        el.gameMode.value = cur;
      } else {
        el.gameMode.value = modes[0].id;
      }
    }

    if (g.id === 'gomoku') {
      el.maxPlayersWrap.hidden = true;
      restoreMaxOptions();
      el.roomMax.value = '2';
      el.gameHint.textContent = t('create.hintGomoku');
    } else if (g.id === 'incan') {
      el.maxPlayersWrap.hidden = false;
      restoreMaxOptions();
      const v = Number(el.roomMax.value);
      if (v < 3) el.roomMax.value = '6';
      el.gameHint.textContent = t('create.hintIncanFull');
    } else if (g.id === 'lasidao') {
      el.maxPlayersWrap.hidden = false;
      const cur = el.roomMax.value;
      // 仅保留 2–5；勿在每次 lobby:update 时强制写回默认 4
      el.roomMax.innerHTML = '';
      for (let n = 2; n <= 5; n++) {
        const opt = document.createElement('option');
        opt.value = String(n);
        opt.textContent = String(n);
        el.roomMax.appendChild(opt);
      }
      if ([...el.roomMax.options].some((o) => o.value === cur)) {
        el.roomMax.value = cur;
      } else {
        el.roomMax.value = '4';
      }
      el.gameHint.textContent = t('create.hintLasidaoFull');
    } else if (g.id === 'sgs') {
      el.maxPlayersWrap.hidden = false;
      const modeId = el.gameMode ? el.gameMode.value : 'identity';
      const mode = (g.modes || []).find((m) => m.id === modeId) || g.modes[0];
      const seats = (mode && mode.seats) || [5, 8];
      const cur = el.roomMax.value;
      el.roomMax.innerHTML = '';
      for (const n of seats) {
        const opt = document.createElement('option');
        opt.value = String(n);
        opt.textContent = String(n);
        el.roomMax.appendChild(opt);
      }
      if ([...el.roomMax.options].some((o) => o.value === cur)) {
        el.roomMax.value = cur;
      } else {
        el.roomMax.value = String(seats[0]);
      }
      if (modeId === 'h2h') {
        el.gameHint.textContent = t('create.hintSgsH2h');
      } else if (modeId === '1v2') {
        el.gameHint.textContent = t('create.hintSgs1v2');
      } else if (modeId === 'xianzhu') {
        el.gameHint.textContent = t('create.hintSgsXianzhu');
      } else {
        el.gameHint.textContent = t('create.hintSgsIdentity');
      }
    } else {
      el.maxPlayersWrap.hidden = false;
      restoreMaxOptions();
      el.gameHint.textContent = t('create.hintRange', { label: gameLabelOf(g.id, g.label), min: g.minPlayers, max: g.maxPlayers });
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
      opt.textContent = t('create.gameOption', { label: gameLabelOf(g.id, g.label), min: g.minPlayers, max: g.maxPlayers });
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

  function roomCanJoin(room) {
    if (!room) return false;
    if (room.canJoin != null) return Boolean(room.canJoin);
    const waiting = !room.status || room.status === 'waiting';
    return waiting && !isRoomFull(room);
  }

  function roomCanSpectate(room) {
    if (!room) return false;
    if (room.canSpectate != null) return Boolean(room.canSpectate);
    return (
      !room.status ||
      room.status === 'waiting' ||
      room.status === 'playing'
    );
  }

  function appendRoomListItem(ul, room, { preferSpectate = false } = {}) {
    const li = document.createElement('li');
    li.dataset.roomId = room.id || '';
    const info = document.createElement('span');
    const where = hostHint(room);
    const gameLabel = gameLabelOf(
      room.gameType,
      room.gameLabel || room.gameType || t('room.gameFallback')
    );
    const modeBit = room.gameModeLabel ? `·${room.gameModeLabel}` : '';
    let playerBitHtml = `${escapeHtml(room.playerCount)}/${escapeHtml(room.maxPlayers)}`;
    if (room.playerNames && room.playerNames.length) {
      const tags = Array.isArray(room.playerTags) ? room.playerTags : [];
      const joined = room.playerNames
        .map((name, i) => nickHtml(name, tags[i]))
        .join(' · ');
      playerBitHtml = `${joined} (${escapeHtml(room.playerCount)}/${escapeHtml(room.maxPlayers)})`;
    }
    const statusBit =
      room.status === 'playing'
        ? ' <span class="badge">对局中</span>'
        : '';
    info.innerHTML =
      `<span class="badge game-badge">${escapeHtml(gameLabel)}${escapeHtml(modeBit)}</span> ` +
      `${escapeHtml(room.name)}  ${playerBitHtml}` +
      statusBit +
      (where ? `  · ${escapeHtml(where)}` : '');
    const btn = document.createElement('button');
    btn.type = 'button';
    const canJoin = roomCanJoin(room);
    const canSpec = roomCanSpectate(room);
    if (preferSpectate || (!canJoin && canSpec)) {
      btn.textContent = '观战';
      btn.className = 'secondary';
      if (!canSpec) {
        btn.disabled = true;
      } else {
        btn.addEventListener('click', () => spectateDiscoveredRoom(room));
      }
    } else {
      btn.textContent = t('lobby.join');
      if (!canJoin) {
        btn.disabled = true;
        btn.title = room.status === 'playing' ? '对局已开始，请观战' : t('lobby.roomFull');
        li.classList.add('is-full');
      } else {
        btn.addEventListener('click', () => joinDiscoveredRoom(room));
      }
    }
    li.appendChild(info);
    li.appendChild(btn);
    li.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      showRoomCtx(room, ev.clientX, ev.clientY);
    });
    bindLongPress(li, (x, y) => showRoomCtx(room, x, y));
    ul.appendChild(li);
  }

  function renderLobbyRooms(rooms) {
    const list = rooms || [];
    state.lobbyRooms = list;
    const waiting = list.filter((r) => !r.status || r.status === 'waiting');
    const playing = list.filter((r) => r.status === 'playing');

    if (el.roomList) el.roomList.innerHTML = '';
    if (el.roomListPlaying) el.roomListPlaying.innerHTML = '';
    if (el.roomListEmpty) el.roomListEmpty.hidden = waiting.length > 0;
    if (el.roomListPlayingEmpty) {
      el.roomListPlayingEmpty.hidden = playing.length > 0;
    }

    for (const room of waiting) {
      if (el.roomList) appendRoomListItem(el.roomList, room);
    }
    for (const room of playing) {
      if (el.roomListPlaying) {
        appendRoomListItem(el.roomListPlaying, room, { preferSpectate: true });
      }
    }
  }

  function hideRoomCtx() {
    if (!el.roomCtx) return;
    el.roomCtx.hidden = true;
    state.roomCtxTarget = null;
  }

  function showRoomCtx(room, x, y) {
    if (!el.roomCtx || !room) return;
    hidePeopleCtx();
    state.roomCtxTarget = room;
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
    if (btnSpec) {
      btnSpec.disabled = !canSpec;
    }
    if (hint) {
      hint.hidden = canJoin || canSpec;
      hint.textContent = canJoin || canSpec ? '' : '暂无可用操作';
    }
    el.roomCtx.hidden = false;
    const pad = 8;
    const rect = el.roomCtx.getBoundingClientRect();
    const w = rect.width || 180;
    const h = rect.height || 90;
    let left = x;
    let top = y;
    if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
    el.roomCtx.style.left = `${Math.max(pad, left)}px`;
    el.roomCtx.style.top = `${Math.max(pad, top)}px`;
  }

  function bindLongPress(node, onLongPress) {
    if (!node || typeof onLongPress !== 'function') return;
    let timer = null;
    let startX = 0;
    let startY = 0;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
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
          onLongPress(startX, startY);
        }, 520);
      },
      { passive: true }
    );
    node.addEventListener('pointerup', clear, { passive: true });
    node.addEventListener('pointercancel', clear, { passive: true });
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
  }

  async function spectateDiscoveredRoom(room) {
    if (!room || !room.id) return;
    const name =
      state.playerName ||
      (el.playerName && el.playerName.value) ||
      t('app.playerDefault');
    try {
      showRoomBusy('join', '正在观战…');
      await net.enterRoomOnHost(room.id, name, room.host, {
        local: Boolean(room.local),
        mode: 'spectate',
        sessionId: getTabSessionId(),
        playerTag: window.PlayerNick.ensureTag(),
      });
    } catch (err) {
      hideRoomBusy();
      showToast((err && err.message) || '观战失败');
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
          ? t('lobby.peersNoneKeepAlive')
          : t('lobby.peersMqttOff');
      return;
    }
    const bits = [];
    if (mqttN) bits.push(t('lobby.broadcastN', { n: mqttN }));
    el.peersLabel.textContent = bits.length
      ? t('lobby.peersFoundWith', { n, bits: bits.join(' · ') })
      : t('lobby.peersFound', { n });
  }

  function peopleStatusText(person) {
    if (person.status === 'offline') return t('lobby.statusOffline');
    if (person.status === 'playing') return t('lobby.statusPlaying');
    if (person.status === 'spectating') {
      return person.roomName
        ? '观战 · ' + person.roomName
        : '观战中';
    }
    if (person.status === 'room') {
      return person.roomName ? t('lobby.statusInRoomNamed', { name: person.roomName }) : t('lobby.statusInRoom');
    }
    if (person.passive) return '被动模式';
    return t('lobby.statusIdle');
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
    let createOnHostEnabled = false;
    let createOnHostReason = '';

    if (person.status === 'offline') joinReason = t('lobby.reasonOffline');
    else if (isMe) joinReason = t('lobby.reasonSelf');
    else if (state.room) joinReason = t('lobby.reasonLeaveFirst');
    else if (person.status !== 'room' || !person.roomId) {
      joinReason = t('lobby.reasonNotInRoom');
    } else {
      const theirRoom = (state.lobbyRooms || []).find(
        (r) => String(r.id).toUpperCase() === String(person.roomId).toUpperCase()
      );
      if (theirRoom && !roomCanJoin(theirRoom)) {
        joinReason = theirRoom.status === 'playing' ? '对局已开始' : t('lobby.reasonFull');
      } else joinEnabled = true;
    }

    if (isMe) createOnHostReason = '不能在自己这里代开';
    else if (state.room) createOnHostReason = t('lobby.reasonLeaveFirst');
    else if (!person.passive || person.status === 'room' || person.status === 'playing' || person.status === 'spectating') {
      createOnHostReason = '对方未开被动模式或已在房间';
    } else if (!person.host && !person.local) {
      createOnHostReason = '缺少对方公网地址';
    } else {
      createOnHostEnabled = true;
    }

    return {
      isMe,
      joinEnabled,
      joinReason,
      createOnHostEnabled,
      createOnHostReason,
    };
  }

  function showPeopleCtx(person, x, y) {
    if (!el.peopleCtx || !person) return;
    hideRoomCtx();
    const actions = getPeopleCtxActions(person);
    const btnJoin = el.peopleCtx.querySelector('[data-action="join-their-room"]');
    const btnCreate = el.peopleCtx.querySelector('[data-action="create-on-host"]');
    const hint = document.getElementById('people-ctx-hint');

    if (btnJoin) {
      btnJoin.hidden = false;
      btnJoin.disabled = !actions.joinEnabled;
      btnJoin.title = actions.joinEnabled ? '' : actions.joinReason;
    }
    if (btnCreate) {
      btnCreate.hidden = false;
      btnCreate.disabled = !actions.createOnHostEnabled;
      btnCreate.title = actions.createOnHostEnabled
        ? ''
        : actions.createOnHostReason;
    }
    if (hint) {
      if (!actions.joinEnabled && !actions.createOnHostEnabled) {
        hint.hidden = false;
        hint.textContent =
          actions.createOnHostReason || actions.joinReason || t('lobby.noActions');
      } else {
        hint.hidden = true;
        hint.textContent = '';
      }
    }

    state.ctxTarget = person;
    el.peopleCtx.hidden = false;
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
        ? t('lobby.peopleAvail', { available: availableCount, total })
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
        (isMe ? ' <span class="you">(' + t('common.you') + ')</span>' : '') +
        (person.passive && person.status === 'idle'
          ? ' <span class="badge">被动</span>'
          : '') +
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
      li.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        showPeopleCtx(person, ev.clientX, ev.clientY);
      });
      bindLongPress(li, (x, y) => showPeopleCtx(person, x, y));
      el.lobbyPeopleList.appendChild(li);
    }
  }

  function renderRoom() {
    const room = state.room;
    if (!room) return;

    el.roomTitle.textContent = room.name;
    el.roomGameLabel.textContent =
      gameLabelOf(room.gameType, room.gameLabel || room.gameType || t('common.dash')) +
      (room.gameModeLabel
        ? '·' + modeLabelOf(room.gameMode, room.gameModeLabel)
        : '') +
      t('room.turnThink', { time: formatTurnTime(room.turnTimeSec) });
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
        (isMe ? ' <span class="you">(' + t('common.you') + ')</span>' : '') +
        (isHost ? ' <span class="badge">' + t('room.host') + '</span>' : '');
      left.title = window.PlayerNick.fullLabel(p.name, p.tag);
      const right = document.createElement('span');
      right.className = 'muted';
      right.textContent = isHost ? t('room.host') : t('room.seated');
      li.appendChild(left);
      li.appendChild(right);
      el.memberList.appendChild(li);
    }

    const observers = room.observers || [];
    if (el.observerList) el.observerList.innerHTML = '';
    for (const o of observers) {
      if (!el.observerList) break;
      const li = document.createElement('li');
      li.dataset.speakerKey = memberSpeakerKey(o);
      const isMe = state.me && o.id === state.me.id;
      const left = document.createElement('span');
      left.innerHTML =
        nickHtml(o.name, o.tag) +
        (isMe ? ' <span class="you">(我)</span>' : '');
      left.title = window.PlayerNick.fullLabel(o.name, o.tag);
      const right = document.createElement('span');
      right.className = 'muted';
      right.textContent = '观战';
      li.appendChild(left);
      li.appendChild(right);
      el.observerList.appendChild(li);
    }
    if (el.observerSection) {
      el.observerSection.hidden = observers.length === 0;
    }
    syncRoomChatBubbles();

    const min = room.minPlayers || 2;
    // 仅统计座位玩家，观战席不计入开局人数
    const seated = (room.players || []).filter((p) => !p.left).length;
    el.roomStartHint.textContent = t('room.startHintCount', {
      min,
      cur: seated,
      max: room.maxPlayers,
    });

    const isSpectator =
      state.me &&
      (room.observers || []).some((o) => o.id === state.me.id);
    state.isSpectator = Boolean(isSpectator);
    const isHost = state.me && room.hostId === state.me.id && !isSpectator;
    el.btnStart.hidden = !isHost;
    el.btnStart.disabled = seated < min;
    if (el.btnEditRoom) {
      el.btnEditRoom.hidden = !isHost || room.status === 'playing';
    }
    if (el.btnLeave) {
      el.btnLeave.textContent = isHost
        ? '解散房间'
        : isSpectator
          ? '退出观战'
          : t('room.leave');
    }
    if (el.btnRoomRules) {
      el.btnRoomRules.hidden = room.gameType !== 'lasidao';
    }
    if (el.roomBannerHint) {
      el.roomBannerHint.textContent = isSpectator
        ? '观战中'
        : room.status === 'playing'
          ? '对局中'
          : '等待开局';
    }
  }

  function hideAllGamePanels() {
    if (el.panelGomoku) el.panelGomoku.hidden = true;
    if (window.IncanUi) window.IncanUi.hide();
    if (window.SgsUi) window.SgsUi.hide();
    if (window.LasidaoUi) {
      // 仍在卡拉斯坦对局中：只藏面板，不清发牌/骰子会话（否则每次状态同步都会重播发牌）
      if (state.game && state.game.type === 'lasidao') {
        window.LasidaoUi.hide();
      } else if (typeof window.LasidaoUi.resetSession === 'function') {
        window.LasidaoUi.resetSession();
        window.LasidaoUi.hide();
      } else {
        window.LasidaoUi.hide({ reset: true });
      }
    }
    updateMatchClock();
  }

  function renderGomoku() {
    const game = state.game;
    hideAllGamePanels();
    if (el.panelGomoku) el.panelGomoku.hidden = false;

    if (el.gameTitle) {
      el.gameTitle.textContent = gameLabelOf(
        'gomoku',
        (state.room && state.room.gameLabel) || t('gomoku.title')
      );
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
        t('gomoku.sides', {
          black: blackId ? playerNameById(blackId) : t('common.dash'),
          white: whiteId ? playerNameById(whiteId) : t('common.dash'),
        }) +
        (my === 1
          ? '　' + t('gomoku.youBlack')
          : my === 2
            ? '　' + t('gomoku.youWhite')
            : '');
    }

    if (el.gameStatus) {
      if (game.over) {
        if (game.draw) el.gameStatus.textContent = t('gomoku.draw');
        else if (game.winnerId) {
          const winName = playerNameById(game.winnerId);
          const mine = state.me && game.winnerId === state.me.id;
          el.gameStatus.textContent = mine
            ? t('gomoku.youWin')
            : t('gomoku.win', { name: winName });
        } else el.gameStatus.textContent = t('gomoku.ended');
      } else {
        const mine = state.me && game.currentPlayerId === state.me.id;
        el.gameStatus.textContent = mine
          ? t('gomoku.yourTurn')
          : t('gomoku.waitNamed', { name: playerNameById(game.currentPlayerId) });
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
    // 仅三国杀使用 SgsAssets BGM；其他游戏停掉，避免串用 sgs/res
    if (game.type === 'sgs') {
      if (game.over && window.SgsAssets && window.SgsAssets.stopBgm) {
        window.SgsAssets.stopBgm();
      } else if (
        !game.over &&
        !el.viewGame.hidden &&
        window.SgsAssets &&
        typeof window.SgsAssets.playBgm === 'function'
      ) {
        window.SgsAssets.playBgm('game');
      }
    } else if (window.SgsAssets && typeof window.SgsAssets.stopBgm === 'function') {
      window.SgsAssets.stopBgm();
    }
    if (game.type !== 'lasidao') {
      if (
        window.LasidaoAssets &&
        typeof window.LasidaoAssets.stopBgm === 'function'
      ) {
        window.LasidaoAssets.stopBgm();
      }
    }
    if (game.type === 'incan') {
      hideAllGamePanels();
      if (window.IncanUi) {
        window.IncanUi.render(game, net, {
          meId: state.me && state.me.id,
          playerNameById,
        });
      }
    } else if (game.type === 'lasidao') {
      hideAllGamePanels();
      if (game.over && window.LasidaoAssets && window.LasidaoAssets.stopBgm) {
        window.LasidaoAssets.stopBgm();
      } else if (
        !game.over &&
        !el.viewGame.hidden &&
        window.LasidaoAssets &&
        typeof window.LasidaoAssets.playBgm === 'function'
      ) {
        window.LasidaoAssets.playBgm();
      }
      if (window.LasidaoUi) {
        window.LasidaoUi.render(game, net, {
          meId: state.me && state.me.id,
          playerNameById,
          onLeaveLobby: leaveAndReturnLocal,
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
    return n > 0 ? t('common.sec', { n }) : t('common.unlimited');
  }

  function formatMatchElapsed(ms) {
    const totalSec = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
  }

  function playingStartedAt() {
    const fromGame =
      state.game && Number(state.game.playingStartedAt)
        ? Number(state.game.playingStartedAt)
        : 0;
    const fromRoom =
      state.room && Number(state.room.playingStartedAt)
        ? Number(state.room.playingStartedAt)
        : 0;
    return fromGame || fromRoom || 0;
  }

  function updateMatchClock() {
    if (!el.matchClock || !el.matchClockTime) return;
    const started = playingStartedAt();
    const inMatch =
      started > 0 &&
      ((state.room && state.room.status === 'playing') ||
        Boolean(state.game));
    if (!inMatch) {
      el.matchClock.hidden = true;
      return;
    }
    const elapsed = Math.max(0, Date.now() - started);
    el.matchClock.hidden = false;
    el.matchClockTime.textContent = formatMatchElapsed(elapsed);
  }

  function updateTurnTimer() {
    updateMatchClock();
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
    if (!roomCanJoin(room)) {
      showToast(
        room && room.status === 'playing'
          ? '对局已开始，请观战'
          : t('toast.roomFull')
      );
      return;
    }
    if (state.roomBusy) return;
    const name = state.playerName || el.playerName.value.trim() || t('app.playerDefault');
    try {
      await joinRoomWithBusy(async () => {
        await net.joinRoomOnHost(room.id, name, room.host, {
          ...lobbyJoinOpts(),
          local: room.local === true,
          preferLocal: room.local === true,
        });
      });
    } catch (err) {
      const base = (err && err.message) || t('toast.connectHostFail');
      showToast(
        room && room.local === true
          ? base
          : t('toast.dnsHint', { base })
      );
    }
  }

  async function leaveAndReturnLocal() {
    markSelfRoomLeave((state.room && state.room.id) || state._lastRoomId);
    leavingToLocal = true;
    clearActivePlay();
    clearGameArchive();
    net.leaveRoom();
    state.room = null;
    state.game = null;
    state._lastRoomId = null;
    rememberChatRoom(null);
    try {
      await net.returnToLocalLobby(state.playerName, lobbyJoinOpts());
      showView('lobby');
      updateMeLabel();
    } catch (err) {
      showToast(err.message || t('toast.backLocalFail'));
    } finally {
      leavingToLocal = false;
    }
  }

  /** 房间失效/解散：退出并回到本机大厅 */
  async function bounceToLocalLobby(message) {
    const keepPassiveLock = state.passiveMode;
    markSelfRoomLeave((state.room && state.room.id) || state._lastRoomId);
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
        state.playerName || (el.playerName && el.playerName.value) || t('app.playerDefault'),
        lobbyJoinOpts()
      );
    } catch (_) {
      /* ignore */
    }
    state.inLobby = true;
    showView('lobby');
    showLobbyHome();
    updateMeLabel();
    // 无人值守：对局结束回大厅后仍保持被动锁定
    if (keepPassiveLock) applyPassiveLockUi(true);
    if (message && !keepPassiveLock) showToast(message);
    leavingToLocal = false;
  }

  function showLobbyHome() {
    if (!el.lobbyGate || !el.lobbyMain) return;
    el.lobbyGate.hidden = state.inLobby;
    el.lobbyMain.hidden = !state.inLobby;
    if (el.lobbyPeopleAside) {
      el.lobbyPeopleAside.hidden = !state.inLobby;
    }
    syncGuestChrome();
    syncChatVisibility();
    refreshNickUi();
    updateMeLabel();
    if (state.inLobby) startLobbyAutoRefresh();
    else stopLobbyAutoRefresh();
  }

  function syncCreateModalChrome() {
    const editing = state.createModalMode === 'edit';
    const onHost = state.createModalMode === 'create-on-host';
    if (el.createRoomTitle) {
      el.createRoomTitle.textContent = editing
        ? t('create.editTitle')
        : onHost
          ? '在被动主机上开房'
          : t('create.title');
    }
    if (el.btnCreateRoom) {
      el.btnCreateRoom.textContent = editing
        ? t('create.editConfirm')
        : t('create.confirm');
    }
  }

  function fillCreateFormFromRoom(room) {
    if (!room) return;
    if (el.gameType && room.gameType) {
      if ([...el.gameType.options].some((o) => o.value === room.gameType)) {
        el.gameType.value = room.gameType;
      }
    }
    updateCreateForm();
    if (el.gameMode && room.gameMode) {
      if ([...el.gameMode.options].some((o) => o.value === room.gameMode)) {
        el.gameMode.value = room.gameMode;
        updateCreateForm();
      }
    }
    if (el.roomMax && room.maxPlayers != null) {
      const v = String(room.maxPlayers);
      if ([...el.roomMax.options].some((o) => o.value === v)) {
        el.roomMax.value = v;
      }
    }
    if (el.roomName) el.roomName.value = room.name || '';
    if (el.roomHidden) el.roomHidden.checked = Boolean(room.hidden);
    if (el.roomTurnTime && room.turnTimeSec != null) {
      const v = String(Number(room.turnTimeSec) || 0);
      if ([...el.roomTurnTime.options].some((o) => o.value === v)) {
        el.roomTurnTime.value = v;
      }
    }
  }

  function setCreatePanelOpen(open, mode = 'create') {
    if (!el.createRoomModal) return;
    if (open) {
      state.createModalMode =
        mode === 'edit'
          ? 'edit'
          : mode === 'create-on-host'
            ? 'create-on-host'
            : 'create';
      syncCreateModalChrome();
      if (state.createModalMode === 'edit' && state.room) {
        fillCreateFormFromRoom(state.room);
      } else {
        updateCreateForm();
      }
    } else {
      state.createModalMode = 'create';
      syncCreateModalChrome();
    }
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
    state.createModalMode = 'create';
    syncCreateModalChrome();
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
        window.PlayerNick.stripBaseName(state.playerName) || t('app.playerDefault');
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
    const next = window.PlayerNick.stripBaseName(name) || t('app.playerDefault');
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
      if (!silent) showToast(t('toast.nickUpdated'));
    }
    updateMeLabel();
    return next;
  }

  async function enterLobbyWithName(name, { silent } = {}) {
    const next = window.PlayerNick.stripBaseName(name) || t('app.playerDefault');
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
          ? t('toast.rejoinPlaying')
          : probe.status === 'waiting'
            ? t('toast.rejoinWaiting')
            : t('toast.rejoinStill');
      if (el.rejoinMessage) {
        el.rejoinMessage.textContent = t('toast.rejoinMsg', {
          name: `${probe.name || code}（${code}）`,
          status: statusText,
        });
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

    const name = state.playerName || t('app.playerDefault');
    const opts = rejoinLobbyOpts(probe);
    if (!opts.oldPlayerId) {
      showToast(t('toast.needSeat'));
      return;
    }

    showToast(t('toast.rejoining'));
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
        showToast(t('toast.rejoined'));
        return;
      }
      showToast(t('toast.rejoinSeatFail'));
      if (net.isOnRemoteHost()) {
        await net.returnToLocalLobby(name, lobbyJoinOpts());
      }
      showLobbyHome();
    } catch (err) {
      showToast(err.message || t('toast.rejoinFail'));
      showLobbyHome();
    } finally {
      state._rejoining = false;
    }
  }

  function declinePendingRejoin() {
    setRejoinModalOpen(false);
    clearActivePlay();
    clearGameArchive();
    showToast(t('toast.rejoinCancel'));
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
    const name = (el.playerName.value || '').trim() || t('app.playerDefault');
    try {
      await enterLobbyWithName(name);
    } catch (err) {
      showToast(err.message || t('toast.localFail'));
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
      if (isGuestClient()) {
        showToast(t('toast.guestNoCreate') || '手机端不能创建房间，请用电脑开房');
        return;
      }
      setCreatePanelOpen(el.createRoomModal.hidden, 'create');
    });
  }
  if (el.btnCloseCreate) {
    el.btnCloseCreate.addEventListener('click', () => setCreatePanelOpen(false));
  }
  if (el.btnToggleJoin) {
    el.btnToggleJoin.addEventListener('click', () => {
      state.codeModalMode = 'join';
      const title = document.getElementById('join-code-title');
      if (title) title.textContent = '房间码加入';
      setJoinPanelOpen(el.joinCodeModal.hidden);
    });
  }
  if (el.btnToggleSpectate) {
    el.btnToggleSpectate.addEventListener('click', () => {
      state.codeModalMode = 'spectate';
      const title = document.getElementById('join-code-title');
      if (title) title.textContent = '房间码观战';
      setJoinPanelOpen(el.joinCodeModal.hidden);
    });
  }
  function requestExitPassive() {
    if (isGuestClient()) return;
    if (isPassiveExitBlocked()) {
      showToast('对局进行中，请等待本局结束后再退出被动模式');
      syncPassiveExitButton();
      return;
    }
    const inRoom = Boolean(state.room && state.room.id);
    if (inRoom) {
      const ok = window.confirm(
        '退出被动模式将解散当前房间（房内玩家会回到大厅）。确定退出吗？'
      );
      if (!ok) return;
    }
    applyPassiveLockUi(false);
    net.setPassive(false);
  }

  if (el.chkPassiveMode) {
    el.chkPassiveMode.addEventListener('change', () => {
      if (!state.inLobby) {
        el.chkPassiveMode.checked = false;
        showToast('请先进入大厅');
        return;
      }
      if (isGuestClient()) {
        el.chkPassiveMode.checked = false;
        showToast('加入端不能开启被动模式');
        return;
      }
      const on = el.chkPassiveMode.checked;
      if (on) {
        // 隧道就绪前只显示准备中，不提前锁定/不视为已被动
        showRoomBusy('passive', '正在进入被动模式…');
        net.setPassive(true);
      } else {
        // 锁定层下一般走「退出被动模式」按钮；此处兜底
        if (el.chkPassiveMode) el.chkPassiveMode.checked = true;
        requestExitPassive();
      }
    });
  }
  if (el.btnExitPassive) {
    el.btnExitPassive.addEventListener('click', () => {
      requestExitPassive();
    });
  }
  if (el.btnCloseJoin) {
    el.btnCloseJoin.addEventListener('click', () => setJoinPanelOpen(false));
  }
  if (el.btnRefreshLobby) {
    el.btnRefreshLobby.addEventListener('click', () => {
      requestLobbyRefresh();
      showToast(t('lobby.refreshing'));
    });
  }
  if (el.btnRefreshDoc) {
    el.btnRefreshDoc.addEventListener('click', () => {
      requestLobbyRefresh();
      showToast(t('lobby.refreshingPeople'));
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
        showToast(err.message || t('toast.rejoinFail'));
      });
    });
  }

  // 聊天：半隐形拖动 + 点击/回车聚焦输入
  if (el.chatLog) {
    el.chatLog.addEventListener(
      'scroll',
      () => {
        if (el.chatDock && el.chatDock.classList.contains('is-active')) {
          saveChatScroll();
        }
      },
      { passive: true }
    );
  }

  if (el.chatInput) {
    el.chatInput.addEventListener('focus', () => {
      setChatDockActive(true);
      holdChatDockFocus();
    });
    el.chatInput.addEventListener('blur', (ev) => {
      if (chatDockDragging) return;
      const next = ev.relatedTarget;
      // 焦点仍在聊天室内部（切到发送按钮/页签等）→ 保持展开
      if (next && el.chatDock && el.chatDock.contains(next)) {
        holdChatDockFocus();
        return;
      }
      if (chatDockFocusHoldTimer) {
        clearTimeout(chatDockFocusHoldTimer);
        chatDockFocusHoldTimer = null;
      }
      chatDockPreserveActive = false;
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
      holdChatDockFocus();
      setChatDockActive(true);
    });
    el.chatPanel.addEventListener('click', (ev) => {
      if (chatDockDragging || chatDockDragMoved) return;
      const target = ev.target;
      if (
        (el.chatForm && el.chatForm.contains(target)) ||
        (el.chatTabs && el.chatTabs.contains(target)) ||
        (el.chatDragHandle && el.chatDragHandle.contains(target))
      ) {
        return;
      }
      focusChatInput();
    });
  }

  if (el.chatForm) {
    el.chatForm.addEventListener('pointerdown', () => {
      holdChatDockFocus();
      setChatDockActive(true);
    });
  }

  if (el.chatTabs) {
    el.chatTabs.addEventListener('pointerdown', () => {
      holdChatDockFocus();
      setChatDockActive(true);
    });
  }

  if (el.chatDragHandle && el.chatDock) {
    el.chatDragHandle.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 && ev.pointerType !== 'touch') return;
      if (el.chatTabs && el.chatTabs.contains(ev.target)) return;
      holdChatDockFocus();
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
      if (!chatDockDragMoved && Math.abs(dx) + Math.abs(dy) > 2) {
        chatDockDragMoved = true;
        const pinned = pinChatDockPosition();
        if (pinned) {
          chatDockDragStart.left = pinned.left;
          chatDockDragStart.bottom = pinned.bottom;
          chatDockDragStart.w = pinned.w;
          chatDockDragStart.h = pinned.h;
          chatDockDragStart.clientX = ev.clientX;
          chatDockDragStart.clientY = ev.clientY;
        }
        return;
      }
      if (!chatDockDragMoved) return;

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
      if (moved) saveChatDockPos();
      if (!moved) focusChatInput();
      else holdChatDockFocus();
    });

    el.chatDragHandle.addEventListener('pointercancel', () => {
      chatDockDragging = false;
      chatDockDragMoved = false;
      chatDockDragStart = null;
      holdChatDockFocus();
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
      holdChatDockFocus();
      setChatDockActive(true);
      chatScrollState[chatChannelKey()] = { scrollTop: 0, atBottom: true };
      net.sendChat(state.chatChannel, text);
      el.chatInput.value = '';
      focusChatInput();
    });
  }

  // 点击聊天室外部：收起并失焦（非输入框可聚焦区域点空白时 blur 往往不会触发）
  document.addEventListener(
    'pointerdown',
    (ev) => {
      if (!el.chatDock || el.chatDock.hidden) return;
      if (!el.chatDock.classList.contains('is-active')) return;
      if (chatDockDragging) return;
      const target = ev.target;
      if (target && el.chatDock.contains(target)) return;
      if (chatDockFocusHoldTimer) {
        clearTimeout(chatDockFocusHoldTimer);
        chatDockFocusHoldTimer = null;
      }
      chatDockPreserveActive = false;
      setChatDockActive(false);
      if (el.chatInput && document.activeElement === el.chatInput) {
        try {
          el.chatInput.blur();
        } catch (_) {}
      }
    },
    true
  );

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
        showToast(btn.title || t('toast.unavailable'));
        return;
      }
      const action = btn.getAttribute('data-action');
      const target = state.ctxTarget;
      hidePeopleCtx();
      if (action === 'join-their-room') {
        if (!target.roomId) return;
        if (state.roomBusy) return;
        const name = state.playerName || t('app.playerDefault');
        try {
          await joinRoomWithBusy(async () => {
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
          });
        } catch (err) {
          showToast(err.message || t('toast.joinFail'));
        }
      } else if (action === 'create-on-host') {
        if (!target.passive) return;
        state.createOnHostTarget = target;
        setCreatePanelOpen(true, 'create-on-host');
      }
    });
  }

  if (el.roomCtx) {
    el.roomCtx.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (!btn || !state.roomCtxTarget) return;
      if (btn.disabled) {
        showToast(btn.title || '不可用');
        return;
      }
      const action = btn.getAttribute('data-action');
      const room = state.roomCtxTarget;
      hideRoomCtx();
      if (action === 'room-join') joinDiscoveredRoom(room);
      else if (action === 'room-spectate') spectateDiscoveredRoom(room);
    });
  }

  document.addEventListener('pointerdown', (ev) => {
    if (ev.button === 2) return; // 右键留给菜单
    if (el.peopleCtx && !el.peopleCtx.hidden && !el.peopleCtx.contains(ev.target)) {
      hidePeopleCtx();
    }
    if (el.roomCtx && !el.roomCtx.hidden && !el.roomCtx.contains(ev.target)) {
      hideRoomCtx();
    }
  });

  el.btnCreateRoom.addEventListener('click', async () => {
    if (state.roomBusy) return;
    const g = selectedGameMeta();
    const payload = {
      name: el.roomName.value.trim(),
      hidden: el.roomHidden.checked,
      gameType: el.gameType.value || 'sgs',
      gameMode: el.gameMode ? el.gameMode.value : undefined,
      maxPlayers: g ? Number(el.roomMax.value) || g.maxPlayers : 2,
      turnTimeSec: el.roomTurnTime
        ? Number(el.roomTurnTime.value) || 0
        : 0,
    };

    if (state.createModalMode === 'edit') {
      if (!state.room || !state.me || state.room.hostId !== state.me.id) {
        showToast(t('toast.updateRoomFail'));
        return;
      }
      try {
        if (typeof net.updateRoomSettings !== 'function') {
          showToast(t('toast.updateRoomFail'));
          return;
        }
        net.updateRoomSettings(payload);
        closeAllModals();
      } catch (err) {
        showToast(err.message || t('toast.updateRoomFail'));
      }
      return;
    }

    if (state.createModalMode === 'create-on-host') {
      const target = state.createOnHostTarget;
      const alreadyOnHost = Boolean(target && target.alreadyOnHost);
      if (!alreadyOnHost && (!target || !target.host)) {
        showToast('缺少被动主机地址');
        return;
      }
      try {
        showRoomBusy('create', '正在对方主机上创建房间…');
        closeAllModals();
        if (alreadyOnHost) {
          net.createRoom({
            ...payload,
            playerName: state.playerName || el.playerName.value.trim(),
            playerTag: myTag(),
            sessionId: getTabSessionId(),
            passiveHost: true,
          });
        } else {
          await net.createRoomOnHost(
            state.playerName || el.playerName.value.trim(),
            target.host,
            {
              ...payload,
              playerTag: myTag(),
              sessionId: getTabSessionId(),
            }
          );
        }
        state.createOnHostTarget = null;
      } catch (err) {
        hideRoomBusy();
        showToast(err.message || t('toast.createFail'));
      }
      return;
    }

    try {
      if (net.isOnRemoteHost()) {
        await net.returnToLocalLobby(state.playerName, lobbyJoinOpts());
      }
      showRoomBusy('create', t('create.creating'));
      closeAllModals();
      net.createRoom({
        ...payload,
        playerName: state.playerName || el.playerName.value.trim(),
        playerTag: myTag(),
        sessionId: getTabSessionId(),
      });
    } catch (err) {
      hideRoomBusy();
      showToast(err.message || t('toast.createFail'));
    }
  });

  el.btnJoinCode.addEventListener('click', async () => {
    const code = el.joinCode.value.trim().toUpperCase();
    if (!code) {
      showToast(t('toast.needCode'));
      return;
    }
    if (state.roomBusy) return;
    const name = state.playerName || el.playerName.value.trim() || t('app.playerDefault');
    const asSpectate = state.codeModalMode === 'spectate';
    try {
      await net.connect(net.getLocalOrigin());
      net.joinLobby(name, lobbyJoinOpts());
      const resolved = await net.resolveRoom(code);
      if (!resolved.ok) {
        showToast(resolved.message || t('toast.roomNotFound'));
        return;
      }
      closeAllModals();
      await joinRoomWithBusy(async () => {
        await net.enterRoomOnHost(
          resolved.roomId,
          name,
          resolved.host,
          {
            ...lobbyJoinOpts(),
            local: resolved.local === true,
            mode: asSpectate ? 'spectate' : 'join',
          }
        );
      });
    } catch (err) {
      hideRoomBusy();
      showToast(err.message || (asSpectate ? '观战失败' : t('toast.joinFail')));
    }
  });

  el.btnStart.addEventListener('click', () => net.startGame());
  if (el.btnEditRoom) {
    el.btnEditRoom.addEventListener('click', () => {
      if (!state.room || !state.me || state.room.hostId !== state.me.id) return;
      if (state.room.status === 'playing') return;
      setCreatePanelOpen(true, 'edit');
    });
  }
  if (el.btnRoomRules) {
    el.btnRoomRules.addEventListener('click', () => {
      if (
        window.LasidaoUi &&
        typeof window.LasidaoUi.openRules === 'function'
      ) {
        window.LasidaoUi.openRules();
      }
    });
  }
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
  if (el.btnMenuLang) {
    el.btnMenuLang.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleLangSub();
    });
  }
  if (el.btnMenuBgm) {
    el.btnMenuBgm.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleBgmSub();
    });
  }
  if (el.menuBgmRange && window.BgmVolume) {
    el.menuBgmRange.addEventListener('input', (ev) => {
      ev.stopPropagation();
      const pct = Number(ev.target.value);
      window.BgmVolume.set(pct / 100);
      if (el.menuBgmValue) el.menuBgmValue.textContent = pct + '%';
      ev.target.setAttribute('aria-valuenow', String(pct));
    });
    el.menuBgmRange.addEventListener('click', (ev) => ev.stopPropagation());
  }
  if (el.menuBgmSub) {
    el.menuBgmSub.addEventListener('click', (ev) => ev.stopPropagation());
  }
  if (el.menuLangSub) {
    el.menuLangSub.addEventListener('click', (ev) => {
      const btn =
        ev.target && ev.target.closest && ev.target.closest('[data-lang]');
      if (!btn) return;
      ev.stopPropagation();
      I18n.setLang(btn.getAttribute('data-lang'));
      syncLangMenuActive();
      closeGameMenu();
    });
  }
  document.addEventListener('click', (ev) => {
    if (!el.gameMenu) return;
    if (el.gameMenu.contains(ev.target)) return;
    closeGameMenu();
  });

  function refreshAfterLangChange() {
    if (I18n && I18n.applyDom) I18n.applyDom(document);
    syncLangMenuActive();
    syncQuitMenuItem();
    showView(currentViewName);
    updateCreateForm();
    fillGameOptions(state.games);
    syncCreateModalChrome();
    if (state.lobbyRooms) renderLobbyRooms(state.lobbyRooms);
    if (state.room) renderRoom();
    if (state.game) renderGame();
    syncChatTabs();
    renderChatLog();
    updateMeLabel();
    markLobbyRefreshed();
    if (el.roomTurnTime) {
      for (const opt of el.roomTurnTime.options) {
        const v = Number(opt.value);
        if (v === 0) opt.textContent = t('create.turnUnlimited');
        else opt.textContent = t('create.turnSec', { n: v });
      }
    }
  }
  if (I18n && typeof I18n.onChange === 'function') {
    I18n.onChange(() => refreshAfterLangChange());
  }
  syncLangMenuActive();
  syncBgmMenuSlider();
  syncQuitMenuItem();
  if (el.roomTurnTime) {
    for (const opt of el.roomTurnTime.options) {
      const v = Number(opt.value);
      if (v === 0) opt.textContent = t('create.turnUnlimited');
      else opt.textContent = t('create.turnSec', { n: v });
    }
  }

  net.on('player:me', (data) => {
    state.me = data;
    if (data && data.name) {
      state.playerName = window.PlayerNick.stripBaseName(data.name) || t('app.playerDefault');
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

  net.on('lobby:passiveProgress', (data) => {
    const msg =
      (data && data.message) || '正在进入被动模式…';
    if (state.roomBusy === 'passive') updateRoomBusyMessage(msg);
    else showRoomBusy('passive', msg);
  });

  net.on('lobby:passive', (data) => {
    const on = Boolean(data && data.passive);
    if (state.roomBusy === 'passive') hideRoomBusy();
    applyPassiveLockUi(on);
    if (el.chkPassiveMode) el.chkPassiveMode.checked = on;
  });
  net.on('lobby:error', (data) => {
    showToast((data && data.message) || t('toast.opFail'));
    if (state.roomBusy === 'passive') {
      hideRoomBusy();
      if (el.chkPassiveMode) el.chkPassiveMode.checked = false;
      applyPassiveLockUi(false);
    }
  });

  net.on('lobby:update', (data) => {
    if (data && Object.prototype.hasOwnProperty.call(data, 'mqttBulletin')) {
      state.mqttBulletin = Boolean(data.mqttBulletin);
    }
    const editing =
      state.createModalMode === 'edit' &&
      el.createRoomModal &&
      !el.createRoomModal.hidden;
    if (editing) {
      // 编辑中勿重建表单，避免大厅刷新冲掉正在改的选项
      if (data && data.games) state.games = data.games;
    } else {
      fillGameOptions(data.games);
    }
    renderLobbyRooms(data.rooms);
    renderPeers(data.peers);
    renderLobbyPeople(data.people);
    if (el.chkPassiveMode && state.me && state.roomBusy !== 'passive') {
      const mePerson = (data.people || []).find(
        (p) => p.id === state.me.id || p.socketId === state.me.id
      );
      if (mePerson) {
        applyPassiveLockUi(Boolean(mePerson.passive));
      }
    }
    markLobbyRefreshed();
    if (
      state.inLobby &&
      !state.mqttBulletin &&
      !state.mqttHintShown &&
      (!(data.peers || []).length)
    ) {
      state.mqttHintShown = true;
      showToast(t('lobby.mqttHint'));
    }
  });

  net.on('room:creating', (data) => {
    if (state.roomBusy !== 'create') return;
    updateRoomBusyMessage((data && data.message) || t('create.creating'));
  });

  net.on('room:update', (data) => {
    hideRoomBusy();
    // 被动主机进房后仍保持锁定（无人值守）；不在此解除
    if (state.passiveMode) applyPassiveLockUi(true);
    const prevRoomId = state._lastRoomId;
    const prev = state.room;
    state.room = data.room;
    syncPassiveExitButton();
    const keepEdit =
      state.createModalMode === 'edit' &&
      el.createRoomModal &&
      !el.createRoomModal.hidden &&
      data.room &&
      data.room.status === 'waiting';
    if (!keepEdit) closeAllModals();
    if (data.room.status === 'playing') {
      rememberActivePlay(data.room);
      showView('game');
      if (state.game) renderGame();
    } else {
      rememberActivePlay(data.room);
      state.game = null;
      showView('room');
      renderRoom();
      if (keepEdit && prev) {
        const gameChanged =
          prev.gameType !== data.room.gameType ||
          prev.gameMode !== data.room.gameMode ||
          prev.maxPlayers !== data.room.maxPlayers ||
          prev.name !== data.room.name ||
          Boolean(prev.hidden) !== Boolean(data.room.hidden) ||
          Number(prev.turnTimeSec) !== Number(data.room.turnTimeSec);
        if (gameChanged) fillCreateFormFromRoom(data.room);
      }
      if (data.room.id && data.room.id !== prevRoomId) {
        showToast(t('room.enteredNamed', { name: data.room.name || data.room.id }));
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
    bounceToLocalLobby(t('toast.roomInvalid')).catch(() => {});
  });

  net.on('room:left', async (data) => {
    if (leavingToLocal) return;
    if (shouldIgnoreRoomLeft(data)) {
      ignoreRoomLeftId = null;
      return;
    }
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
      const closedId = data.roomId
        ? String(data.roomId).toUpperCase()
        : null;
      if (closedId && Array.isArray(state.lobbyRooms)) {
        state.lobbyRooms = state.lobbyRooms.filter(
          (r) => String((r && r.id) || '').toUpperCase() !== closedId
        );
        renderLobbyRooms(state.lobbyRooms);
      }
      await bounceToLocalLobby(t('toast.roomClosed'));
      return;
    }
    // 对局进行中先尝试认领；失败会走 session:reclaim-failed 回大厅
    if (state.game && !state.game.over && el.viewGame && !el.viewGame.hidden) {
      showToast(t('toast.recovering'));
      const roomId =
        (state.room && state.room.id) ||
        state._lastRoomId ||
        (loadGameArchive() && loadGameArchive().roomId);
      net.joinLobby(
        state.playerName || (el.playerName && el.playerName.value) || t('app.playerDefault'),
        rejoinLobbyOpts({ roomId })
      );
      return;
    }
    await bounceToLocalLobby(t('toast.roomClosed'));
  });

  net.on('room:error', (data) => {
    hideRoomBusy();
    showToast(data.message || t('toast.roomError'));
  });
  net.on('room:settingsUpdated', () => {
    closeAllModals();
    showToast(t('toast.roomUpdated'));
  });
  net.on('game:started', (data) => {
    state.game = data.state;
    if (data && data.spectator) state.isSpectator = true;
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
    // 被动无人值守：对局结束立刻离席回大厅，锁定不解除
    if (state.passiveMode && data && data.state && data.state.over) {
      try {
        net.leaveRoom();
      } catch (_) {
        /* ignore */
      }
      return;
    }
    if (state.passiveMode) applyPassiveLockUi(true);
    showView('game');
    renderGame();
  });
  net.on('game:state', (data) => {
    state.game = data.state;
    if (data && data.spectator) state.isSpectator = true;
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
    if (state.passiveMode && data && data.state && data.state.over) {
      try {
        net.leaveRoom();
      } catch (_) {
        /* ignore */
      }
      return;
    }
    if (state.passiveMode) applyPassiveLockUi(true);
    syncPassiveExitButton();
    showView('game');
    renderGame();
  });
  net.on('game:error', (data) => showToast(data.message || t('toast.opFail')));
  net.on('chat:message', (msg) => pushChatMessage(msg));
  net.on('chat:error', (data) => showToast((data && data.message) || t('toast.sendFail')));
  net.on('game:player-left', (data) => {
    const name = (data && data.name) || t('toast.someone');
    showToast(t('toast.playerLeftGame', { name }));
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
    bounceToLocalLobby(t('toast.quitBack')).catch(() => {});
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
        bounceToLocalLobby(err && err.message ? err.message : t('toast.roomInvalid'));
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
      state.playerName || (el.playerName && el.playerName.value) || t('app.playerDefault');
    showToast(t('toast.tunnelLost'));
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
            await bounceToLocalLobby(t('toast.roomInvalid'));
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
          showToast(t('toast.tunnelFound'));
          try {
            const opts = rejoinLobbyOpts(probe);
            await net.joinRoomOnHost(roomId, name, host, {
              ...opts,
              local: probe.local === true,
              preferLocal: probe.local === true,
            });
            const ok = await waitForSessionRestore(4000);
            if (ok && isInRestoredGameView()) {
              showToast(t('toast.tunnelBack'));
              return;
            }
          } catch (_) {
            /* 新地址可能还没就绪，继续等 */
          }
        }
        await sleepMs(2000);
      }
      await bounceToLocalLobby(t('toast.roomInvalid'));
    } finally {
      remoteRecovering = false;
      state._rejoining = false;
    }
  }

  net.on('disconnect', () => {
    if (leavingToLocal) return;
    // 对局中短暂断线：只提示重连，不跳回大厅（否则会出现「1号回房、其他人还在打」）
    if (isInLiveSession()) {
      showToast(t('toast.reconnect'));
      scheduleRemoteRecover();
      return;
    }
    showToast(t('toast.disconnected'));
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

  const bootQuery = readBootQuery();
  if (bootQuery.get('guest') === '1') markGuestClient(true);
  const bootClient = bootQuery.get('client') || '';
  const bootRole = bootQuery.get('role') || (bootQuery.get('guest') === '1' ? 'client' : '');
  if (window.ClientPlatform && window.ClientPlatform.rememberGuestClient) {
    window.ClientPlatform.rememberGuestClient(bootClient);
  }
  if (bootRole && window.ClientPlatform && window.ClientPlatform.rememberGuestRole) {
    window.ClientPlatform.rememberGuestRole(bootRole);
  }
  syncGuestChrome();

  const bootName = window.PlayerNick.stripBaseName(bootQuery.get('name') || '');
  const bootJoin = String(bootQuery.get('join') || '')
    .trim()
    .toUpperCase();
  const bootSpectate = bootQuery.get('spectate') === '1';
  const bootCreatePassive = bootQuery.get('createPassive') === '1';
  const bootTag = window.PlayerNick.normalizeTag(bootQuery.get('tag') || '');
  if (bootTag) {
    try {
      localStorage.setItem(window.PlayerNick.TAG_KEY, bootTag);
    } catch (_) {}
  }

  async function bootGuestDeepLink() {
    const nick = bootName || loadSavedNick();
    // 尽早盖住大厅门，避免「先看到进大厅页再进房」
    if (el.lobbyGate) el.lobbyGate.hidden = true;
    if (el.lobbyMain) el.lobbyMain.hidden = true;
    if (el.lobbyPeopleAside) el.lobbyPeopleAside.hidden = true;
    if (el.chatDock) el.chatDock.hidden = true;
    const busyMsg = bootCreatePassive
      ? '正在进入被动主机…'
      : bootJoin
        ? bootSpectate
          ? '正在观战…'
          : t('create.joining')
        : t('lobby.enter') || '进入大厅…';
    showRoomBusy(bootCreatePassive ? 'create' : 'join', busyMsg);

    if (!nick) {
      hideRoomBusy();
      document.documentElement.classList.remove('boot-joining');
      net.connect(net.getLocalOrigin()).catch(() => {});
      showLobbyHome();
      updateMeLabel();
      return;
    }
    state.playerName = nick;
    if (el.playerName) el.playerName.value = nick;
    refreshNickUi();
    try {
      await enterLobbyWithName(nick, { silent: true });
      if (bootJoin) {
        updateRoomBusyMessage(bootSpectate ? '正在观战…' : t('create.joining'));
        await joinRoomWithBusy(async () => {
          if (bootSpectate) net.spectateRoom(bootJoin, nick, lobbyJoinOpts());
          else net.joinRoom(bootJoin, nick, lobbyJoinOpts());
        });
      } else if (bootCreatePassive) {
        hideRoomBusy();
        document.documentElement.classList.remove('boot-joining');
        showLobbyHome();
        state.createOnHostTarget = {
          passive: true,
          alreadyOnHost: true,
          host: null,
        };
        setCreatePanelOpen(true, 'create-on-host');
      } else {
        hideRoomBusy();
        document.documentElement.classList.remove('boot-joining');
        showLobbyHome();
      }
    } catch (err) {
      hideRoomBusy();
      document.documentElement.classList.remove('boot-joining');
      showToast(err.message || t('toast.autoLobbyFail'));
      state.inLobby = false;
      showLobbyHome();
    } finally {
      clearBootQueryFromUrl();
      syncGuestChrome();
    }
  }

  if (
    isGuestClient() &&
    (bootName || bootJoin || bootCreatePassive || bootQuery.get('guest') === '1')
  ) {
    bootGuestDeepLink();
  } else {
    const savedNick = loadSavedNick();
    if (savedNick) {
      state.playerName = savedNick;
      if (el.playerName) el.playerName.value = savedNick;
      refreshNickUi();
      enterLobbyWithName(savedNick, { silent: true }).catch((err) => {
        showToast(err.message || t('toast.autoLobbyFail'));
        state.inLobby = false;
        showLobbyHome();
      });
    } else {
      net.connect(net.getLocalOrigin()).catch(() => {});
      showLobbyHome();
      updateMeLabel();
    }
    clearBootQueryFromUrl();
  }

  setInterval(() => {
    updateMatchClock();
    if (el.viewGame && !el.viewGame.hidden) updateTurnTimer();
  }, 250);
})();
