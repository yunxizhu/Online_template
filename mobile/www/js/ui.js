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
    hostOccupiedHint: document.getElementById('host-occupied-hint'),
    tunnelWaitHint: document.getElementById('tunnel-wait-hint'),
    tunnelGateHint: document.getElementById('tunnel-gate-hint'),
    btnToggleCreate: document.getElementById('btn-toggle-create'),
    btnToggleJoin: document.getElementById('btn-toggle-join'),
    chkPassiveMode: document.getElementById('chk-passive-mode'),
    lobbyRefreshHint: document.getElementById('lobby-refresh-hint'),
    btnCloseCreate: document.getElementById('btn-close-create'),
    btnCloseJoin: document.getElementById('btn-close-join'),
    createRoomModal: document.getElementById('create-room-modal'),
    joinCodeModal: document.getElementById('join-code-modal'),
    peersLabel: document.getElementById('peers-label'),
    btnMqttBroker: document.getElementById('btn-mqtt-broker'),
    mqttBrokerModal: document.getElementById('mqtt-broker-modal'),
    mqttBrokerList: document.getElementById('mqtt-broker-list'),
    btnCloseMqttBroker: document.getElementById('btn-close-mqtt-broker'),
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
    spectatorsWatch: document.getElementById('spectators-watch'),
    btnSpectators: document.getElementById('btn-spectators'),
    spectatorsCount: document.getElementById('spectators-count'),
    spectatorsPop: document.getElementById('spectators-pop'),
    spectatorsList: document.getElementById('spectators-list'),
    spectatorsEmpty: document.getElementById('spectators-empty'),
    btnSpectatorsClose: document.getElementById('btn-spectators-close'),
    btnHosting: document.getElementById('btn-hosting'),
    hostingOverlay: document.getElementById('hosting-overlay'),
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
    roomAllowTrade: document.getElementById('room-allow-trade'),
    roomAllowTradeWrap: document.getElementById('room-allow-trade-wrap'),
    roomConflictDlc: document.getElementById('room-conflict-dlc'),
    roomConflictDlcWrap: document.getElementById('room-conflict-dlc-wrap'),
    roomHasPassword: document.getElementById('room-has-password'),
    roomPassword: document.getElementById('room-password'),
    roomPasswordWrap: document.getElementById('room-password-wrap'),
    joinPassword: document.getElementById('join-password'),
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
    roomPasswordBadge: document.getElementById('room-password-badge'),
    memberList: document.getElementById('member-list'),
    observerList: document.getElementById('observer-list'),
    observerSection: document.getElementById('observer-section'),
    btnStart: document.getElementById('btn-start'),
    btnEditRoom: document.getElementById('btn-edit-room'),
    btnInviteLobby: document.getElementById('btn-invite-lobby'),
    btnMenuGameRules: document.getElementById('btn-menu-game-rules'),
    btnLeave: document.getElementById('btn-leave'),
    inviteToastSlot: document.getElementById('invite-toast-slot'),
    btnMenuInviteBlock: document.getElementById('btn-menu-invite-block'),
    btnMenuCheckUpdate: document.getElementById('btn-menu-check-update'),
    hostUpdateModal: document.getElementById('host-update-modal'),
    hostUpdateVersion: document.getElementById('host-update-version'),
    hostUpdateNotes: document.getElementById('host-update-notes'),
    hostUpdateMeta: document.getElementById('host-update-meta'),
    hostUpdateProgressWrap: document.getElementById('host-update-progress-wrap'),
    hostUpdateProgressFill: document.getElementById('host-update-progress-fill'),
    hostUpdateProgressText: document.getElementById('host-update-progress-text'),
    hostUpdateActions: document.getElementById('host-update-actions'),
    btnHostUpdateApply: document.getElementById('btn-host-update-apply'),
    btnHostUpdateLater: document.getElementById('btn-host-update-later'),
    roomStartHint: document.getElementById('room-start-hint'),
    roomBanner: document.getElementById('room-banner'),
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
    passiveLockTitle: document.getElementById('passive-lock-title'),
    passiveLockDesc: document.getElementById('passive-lock-desc'),
    passiveShareUrl: document.getElementById('passive-share-url'),
    btnCopyPassiveUrl: document.getElementById('btn-copy-passive-url'),
    btnExitPassive: document.getElementById('btn-exit-passive'),
    addBotModal: document.getElementById('add-bot-modal'),
    addBotSeatLabel: document.getElementById('add-bot-seat-label'),
    botDifficulty: document.getElementById('bot-difficulty'),
    btnCloseAddBot: document.getElementById('btn-close-add-bot'),
    btnConfirmAddBot: document.getElementById('btn-confirm-add-bot'),
  };

  const state = {
    me: null,
    room: null,
    game: null,
    games: [],
    people: [],
    lobbyRooms: [],
    inLobby: false,
    hostOccupied: false,
    access: '',
    playerName: '',
    pendingRejoin: null,
    ctxTarget: null,
    mqttBulletin: false,
    mqttConnected: false,
    mqttBroker: null,
    mqttBrokers: [],
    mqttAllBrokersDown: false,
    mqttHintShown: false,
    createModalMode: 'create', // 'create' | 'edit' | 'create-on-host'
    createOnHostTarget: null,
    codeModalMode: 'join', // 'join' | 'spectate'
    isSpectator: false,
    passiveMode: false,
    canControlPassive: false,
    passiveController: null,
    passivePublicUrl: '',
    roomSeatMoveFrom: null,
    addBotSeatIndex: null,
    roomCtxTarget: null,
    chatChannel: 'all',
    chatAll: [],
    chatRoom: [],
    chatRoomId: null,
    unreadAll: 0,
    unreadRoom: 0,
    roomChatBubbles: {},
    chatNeedsAttention: false,
    _rejoinSnoozeUntil: {},
    _leftRooms: {},
  };

  let board = null;
  let toastTimer = null;
  let toastExitTimer = null;
  const SPECTATOR_TOAST_ANIM_MS = 1000;
  const SPECTATOR_TOAST_HOLD_MS = 2000;
  let roomBusyTimer = null;
  let leavingToLocal = false;
  const inviteToasts = [];
  const BLOCK_INVITES_MS = 15 * 60 * 1000;
  const BLOCK_INVITES_KEY = 'lianji.blockInvitesUntil';
  let blockInvitesUntil = (function loadBlockInvites() {
    try {
      const v = Number(localStorage.getItem(BLOCK_INVITES_KEY));
      if (Number.isFinite(v) && v > Date.now()) return v;
    } catch (_) {}
    return 0;
  })();
  let ignoreRoomLeftId = null;
  let ignoreRoomLeftUntil = 0;
  let lobbyRefreshTimer = null;
  let mqttAutoRecoverTimer = null;
  let mqttReconnecting = false;
  let mqttSwitching = false;
  let mqttAllDownAlerted = false;
  let remoteRecoverTimer = null;
  let remoteRecovering = false;
  let roomReloadBusy = false;
  let reloadTakeover = false;
  const roomBubbleTimers = new Map();
  const ROOM_BUBBLE_MS = 3000;
  const LOBBY_REFRESH_MS = 3000;
  const NICK_STORAGE_KEY = 'lianji.playerName';
  const GUEST_FLAG_KEY = 'lianji.guestClient';
  const GUEST_RETURN_KEY = 'lianji.guestReturn';

  function readBootQuery() {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch (_) {
      return new URLSearchParams();
    }
  }

  function detectPageAccess() {
    const h = String(window.location.hostname || '').toLowerCase();
    if (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '[::1]' ||
      h === '::1'
    ) {
      return 'console';
    }
    if (
      h === 'trycloudflare.com' ||
      h.endsWith('.trycloudflare.com') ||
      h.endsWith('.cfargotunnel.com')
    ) {
      return 'tunnel';
    }
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a === 10 || a === 127) return 'lan';
      if (a === 192 && b === 168) return 'lan';
      if (a === 172 && b >= 16 && b <= 31) return 'lan';
      if (a === 169 && b === 254) return 'lan';
    }
    return 'tunnel';
  }

  function isTunnelGuest() {
    if (state.access === 'tunnel') return true;
    if (state.access === 'console' || state.access === 'lan') return false;
    return detectPageAccess() === 'tunnel';
  }

  /** 隧道访客离开房间后退出网页（不回大厅） */
  function exitTunnelGuestPage(message) {
    leavingToLocal = true;
    hideRoomBusy();
    const msg = message || t('toast.tunnelGuestBye');
    try {
      net.leaveRoom();
    } catch (_) {}
    try {
      if (net.stopAutoReconnect) net.stopAutoReconnect();
    } catch (_) {}
    try {
      if (net.disconnect) net.disconnect();
    } catch (_) {}
    showToast(msg);
    try {
      window.open('', '_self');
      window.close();
    } catch (_) {}
    setTimeout(() => {
      try {
        document.open();
        document.write(
          '<!doctype html><html><head><meta charset="utf-8"><title>已离开</title></head>' +
            '<body style="font-family:sans-serif;padding:2.5rem;text-align:center;background:#111;color:#eee">' +
            '<p style="font-size:1.1rem">' +
            String(msg).replace(/</g, '&lt;') +
            '</p><p style="opacity:.7;margin-top:1rem">可以关闭此标签页</p></body></html>'
        );
        document.close();
      } catch (_) {}
    }, 50);
  }

  function syncTunnelGuestChrome() {
    const tunnel = isTunnelGuest();
    document.body.classList.toggle('is-tunnel-guest', tunnel);
    document.body.classList.toggle(
      'is-passive-controller',
      tunnel && state.canControlPassive
    );
    const view =
      currentViewName ||
      (!el.viewLobby.hidden
        ? 'lobby'
        : !el.viewRoom.hidden
          ? 'room'
          : !el.viewGame.hidden
            ? 'game'
            : 'lobby');
    const showPeopleAside =
      state.inLobby && (view === 'lobby' || view === 'room');
    if (el.tunnelWaitHint) {
      const rooms = state.lobbyRooms || [];
      const hasJoinable = rooms.some((r) => r && r.id);
      if (tunnel && state.canControlPassive) {
        // 仅大厅提示；房间/对局中不显示
        el.tunnelWaitHint.hidden = view !== 'lobby';
        el.tunnelWaitHint.textContent = t('lobby.passiveControlHint');
      } else {
        el.tunnelWaitHint.hidden = !tunnel || !state.inLobby || hasJoinable || view !== 'lobby';
        if (tunnel && state.inLobby && !hasJoinable && view === 'lobby') {
          el.tunnelWaitHint.textContent = t('lobby.tunnelWait');
        }
      }
    }
    if (!tunnel) return;
    if (state.canControlPassive) {
      if (el.btnToggleCreate) el.btnToggleCreate.hidden = false;
      // 对局中不要强行打开大厅人员栏（否则会盖住游戏界面右侧）
      if (el.lobbyPeopleAside) el.lobbyPeopleAside.hidden = !showPeopleAside;
      if (el.peersLabel) el.peersLabel.hidden = false;
      if (el.lobbyRefreshHint) el.lobbyRefreshHint.hidden = false;
      const wrap = document.getElementById('passive-toggle-wrap');
      if (wrap) wrap.hidden = true;
      if (el.btnMqttBroker) el.btnMqttBroker.hidden = true;
      return;
    }
    if (el.btnToggleCreate) el.btnToggleCreate.hidden = true;
    const wrap = document.getElementById('passive-toggle-wrap');
    if (wrap) wrap.hidden = true;
    if (el.lobbyPeopleAside) el.lobbyPeopleAside.hidden = true;
    if (el.btnMqttBroker) el.btnMqttBroker.hidden = true;
    if (el.peersLabel) el.peersLabel.hidden = true;
    if (el.lobbyRefreshHint) el.lobbyRefreshHint.hidden = true;
  }

  function applyTunnelGateLabels() {
    if (!el.btnEnterLobby) return;
    const controlling =
      state.canControlPassive ||
      (isTunnelGuest() && state._hostPassiveMode);
    const label = controlling
      ? t('lobby.enterPassiveControl')
      : t('lobby.enterRoom');
    el.btnEnterLobby.textContent =
      label === 'lobby.enterRoom' || label === 'lobby.enterPassiveControl'
        ? controlling
          ? '进入并操控主机'
          : '进入房间'
        : label;
    el.btnEnterLobby.setAttribute(
      'data-i18n',
      controlling ? 'lobby.enterPassiveControl' : 'lobby.enterRoom'
    );
  }

  function tunnelConnectingMessage() {
    const msg = t('lobby.tunnelConnecting');
    return msg === 'lobby.tunnelConnecting' ? '正在连接中…' : msg;
  }

  function isTunnelNickGatePending() {
    return (
      isTunnelGuest() &&
      !state.inLobby &&
      !state.room &&
      !state._tunnelJoining &&
      !state._guestBootJoining
    );
  }

  function showTunnelConnecting() {
    state.access = 'tunnel';
    if (el.lobbyGate) el.lobbyGate.hidden = true;
    if (el.lobbyMain) el.lobbyMain.hidden = true;
    if (el.lobbyPeopleAside) el.lobbyPeopleAside.hidden = true;
    document.documentElement.classList.add('boot-joining');
    showRoomBusy('connect', tunnelConnectingMessage());
  }

  function showTunnelNickGateOnly() {
    state.access = 'tunnel';
    state.inLobby = false;
    // 未连上：只转圈，不展示昵称门
    if (!(net.isConnected && net.isConnected())) {
      showTunnelConnecting();
      return;
    }
    hideRoomBusy();
    document.documentElement.classList.remove('boot-joining');
    if (el.lobbyGate) el.lobbyGate.hidden = false;
    if (el.lobbyMain) el.lobbyMain.hidden = true;
    if (el.lobbyPeopleAside) el.lobbyPeopleAside.hidden = true;
    if (el.tunnelGateHint) {
      el.tunnelGateHint.hidden = false;
      if (state._hostPassiveMode) {
        el.tunnelGateHint.textContent =
          t('lobby.passiveControlHint') !== 'lobby.passiveControlHint'
            ? t('lobby.passiveControlHint')
            : '输入昵称后可操控此被动主机：开房、观战、聊天';
      }
    }
    applyTunnelGateLabels();
    syncTunnelGuestChrome();
    updateMeLabel();
    // 探测主机是否处于被动模式，更新入口文案
    fetch('/api/info', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (!info) return;
        if (!(net.isConnected && net.isConnected())) return;
        if (state.inLobby || state.room) return;
        state._hostPassiveMode = Boolean(info.passiveMode);
        if (info.publicUrl) state.passivePublicUrl = String(info.publicUrl);
        if (el.tunnelGateHint && state._hostPassiveMode && !state.inLobby) {
          el.tunnelGateHint.textContent =
            t('lobby.passiveControlHint') !== 'lobby.passiveControlHint'
              ? t('lobby.passiveControlHint')
              : '输入昵称后可操控此被动主机：开房、观战、聊天';
        }
        applyTunnelGateLabels();
      })
      .catch(() => {});
  }

  async function waitUntilTunnelConnected(timeoutMs) {
    showTunnelConnecting();
    const deadline = Date.now() + Math.max(5000, Number(timeoutMs) || 120000);
    while (Date.now() < deadline) {
      if (leavingToLocal) return false;
      try {
        if (net.isConnected && net.isConnected()) return true;
        await net.connect(net.getLocalOrigin());
        if (net.isConnected && net.isConnected()) return true;
      } catch (_) {
        /* 继续重试 */
      }
      await sleepMs(600);
      if (state.roomBusy === 'connect') {
        updateRoomBusyMessage(tunnelConnectingMessage());
      }
    }
    return Boolean(net.isConnected && net.isConnected());
  }

  function pickTunnelJoinRoom(rooms) {
    const list = (rooms || []).filter((r) => r && r.id && !r.over);
    const waiting = list.filter(
      (r) => !r.status || r.status === 'waiting'
    );
    const localWait = waiting.filter((r) => r.local === true);
    const pool = localWait.length ? localWait : [];
    if (!pool.length) return null;
    pool.sort(
      (a, b) => Number(a.createdAt || a._createdAt || 0) - Number(b.createdAt || b._createdAt || 0)
    );
    return pool[0];
  }

  function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForJoinableTunnelRoom(timeoutMs) {
    const deadline = Date.now() + Math.max(3000, Number(timeoutMs) || 120000);
    while (Date.now() < deadline) {
      if (leavingToLocal || state.room) return null;
      const hit = pickTunnelJoinRoom(state.lobbyRooms);
      if (hit) return hit;
      try {
        if (typeof net.refreshLobby === 'function') net.refreshLobby();
      } catch (_) {}
      await sleepMs(400);
    }
    return null;
  }

  async function joinTunnelRoomNow(room, nick) {
    if (!room || !room.id) throw new Error(t('toast.roomNotFound'));
    const name =
      window.PlayerNick.stripBaseName(nick) ||
      window.PlayerNick.stripBaseName(state.playerName) ||
      '';
    if (!name) throw new Error(t('lobby.nickPlaceholder') || '请输入昵称');
    state.playerName = name;
    saveNick(name);
    try {
      net.renamePlayer(name, lobbyJoinOpts());
    } catch (_) {}
    updateRoomBusyMessage(t('create.joining'));
    await joinRoomWithBusy(async () => {
      const joined = await net.joinRoomAndWait(room.id, name, {
        ...lobbyJoinOpts(),
        local: true,
        preferLocal: true,
      });
      if (joined && joined.room) state.room = joined.room;
    });
    ensureOwnSeatName(name);
    try {
      net.renamePlayer(name, lobbyJoinOpts());
    } catch (_) {}
    hideRoomBusy();
    document.documentElement.classList.remove('boot-joining');
    state._tunnelWatchJoin = false;
    if (!state.room) return;
    if (state.room.status === 'playing') {
      showView('game');
      scheduleRenderGame(true);
    } else {
      showView('room');
      renderRoom();
    }
  }

  function isDefaultNick(name) {
    const n = window.PlayerNick.stripBaseName(name || '');
    return (
      !n ||
      n === '玩家' ||
      n === 'Player' ||
      n === t('app.playerDefault')
    );
  }

  /** 把自己在房间座位上的显示名钉成指定昵称 */
  function ensureOwnSeatName(wantName) {
    const want = window.PlayerNick.stripBaseName(wantName || state.playerName || '');
    if (!want || !state.room) return false;
    const meId = state.me && state.me.id;
    if (!meId) return false;
    let changed = false;
    const patch = (list) => {
      if (!Array.isArray(list)) return;
      for (const p of list) {
        if (!p || String(p.id) !== String(meId)) continue;
        if (p.name !== want) {
          p.name = want;
          changed = true;
        }
      }
    };
    patch(state.room.players);
    patch(state.room.observers);
    if (changed) {
      state.playerName = want;
      saveNick(want);
      try {
        renderRoom();
      } catch (_) {}
    }
    return changed;
  }

  function maybeAutoJoinTunnelFromLobby() {
    if (!isTunnelGuest() || !state._tunnelWatchJoin) return;
    if (state.room || state.roomBusy || state._tunnelJoining) return;
    const room = pickTunnelJoinRoom(state.lobbyRooms);
    if (!room) return;
    state._tunnelWatchJoin = false;
    state._tunnelJoining = true;
    const nick =
      state.playerName || loadSavedNick() || t('app.playerDefault');
    showRoomBusy('join', t('create.joining'));
    joinTunnelRoomNow(room, nick)
      .catch((err) => {
        showToast((err && err.message) || t('toast.joinFail'));
        state._tunnelWatchJoin = true;
        showLobbyHome();
        syncTunnelGuestChrome();
      })
      .finally(() => {
        state._tunnelJoining = false;
      });
  }

  /** 隧道访客：连上后直进房间（有存名可自动跳过点按钮） */
  async function enterTunnelGuestToRoom(name) {
    const next =
      window.PlayerNick.stripBaseName(name) || '';
    if (!next) {
      showToast(t('lobby.nickPlaceholder') || '请输入昵称');
      showTunnelNickGateOnly();
      throw new Error('需要昵称');
    }
    state.access = 'tunnel';
    state.playerName = next;
    saveNick(next);
    if (el.playerName) el.playerName.value = next;
    window.PlayerNick.ensureTag();
    state._sessionReclaimed = false;
    state.pendingRejoin = null;
    state._tunnelWatchJoin = false;
    state._tunnelJoining = true;

    if (el.lobbyGate) el.lobbyGate.hidden = true;
    if (el.lobbyMain) el.lobbyMain.hidden = true;
    document.documentElement.classList.add('boot-joining');
    if (!(net.isConnected && net.isConnected())) {
      showTunnelConnecting();
      const ok = await waitUntilTunnelConnected(120000);
      if (!ok) {
        showTunnelConnecting();
        throw new Error(t('toast.disconnected') || '连接失败');
      }
    }
    showRoomBusy('join', t('lobby.tunnelJoining'));

    try {
      await net.connect(net.getLocalOrigin());

      // 刷新后优先认领刚才的隧道房间
      const active = loadActivePlay();
      if (active && active.roomId && !hasExplicitlyLeft(active.roomId)) {
        try {
          await net.joinLobbyAndWait(next, {
            ...rejoinLobbyOpts({
              roomId: active.roomId,
              status: active.status,
            }),
            timeoutMs: 5000,
            requireMe: true,
          });
          const ok = await waitForSessionRestore(4000);
          if (ok && isInRestoredGameView()) {
            state.inLobby = true;
            state.access = 'tunnel';
            clearHostOccupied();
            hideRoomBusy();
            document.documentElement.classList.remove('boot-joining');
            return;
          }
          try {
            await net.joinRoomAndWait(active.roomId, next, {
              ...lobbyJoinOpts(),
              local: true,
              preferLocal: true,
              timeoutMs: 5000,
            });
            if (state.room) {
              state.inLobby = true;
              state.access = 'tunnel';
              clearHostOccupied();
              if (state.room.status === 'playing') {
                showView('game');
                scheduleRenderGame(true);
              } else {
                showView('room');
                renderRoom();
              }
              hideRoomBusy();
              document.documentElement.classList.remove('boot-joining');
              return;
            }
          } catch (_) {
            /* 继续走普通隧道进房 */
          }
        } catch (_) {
          /* 继续走普通隧道进房 */
        }
      }

      await net.joinLobbyAndWait(next, {
        ...lobbyJoinOpts(),
        timeoutMs: 4000,
        requireMe: true,
      });
      state.inLobby = true;
      state.access = 'tunnel';
      clearHostOccupied();
      state.playerName = next;
      try {
        net.renamePlayer(next, lobbyJoinOpts());
      } catch (_) {}

      // 被动主机：直接进入大厅操控（开房/观战/聊天），不必干等房间
      if (state.canControlPassive || state._hostPassiveMode) {
        hideRoomBusy();
        document.documentElement.classList.remove('boot-joining');
        state._tunnelWatchJoin = false;
        showView('lobby');
        showLobbyHome();
        syncTunnelGuestChrome();
        applyTunnelGateLabels();
        if (state.canControlPassive) {
          showToast(
            t('toast.passiveControlGranted') !== 'toast.passiveControlGranted'
              ? t('toast.passiveControlGranted')
              : '已获得主机操控权：可开房、观战、聊天',
            2800
          );
        }
        return;
      }

      updateRoomBusyMessage(t('lobby.tunnelWaitShort'));
      let room = pickTunnelJoinRoom(state.lobbyRooms);
      if (!room) {
        room = await waitForJoinableTunnelRoom(90000);
      }
      if (!room) {
        hideRoomBusy();
        document.documentElement.classList.remove('boot-joining');
        state._tunnelWatchJoin = true;
        showView('lobby');
        showLobbyHome();
        syncTunnelGuestChrome();
        return;
      }
      await joinTunnelRoomNow(room, next);
    } catch (err) {
      hideRoomBusy();
      document.documentElement.classList.remove('boot-joining');
      if (err && err.code === 'HOST_OCCUPIED') {
        applyHostOccupied(err);
      } else if (err && err.message === '需要昵称') {
        /* gate 已显示 */
      } else {
        showToast((err && err.message) || t('toast.autoLobbyFail'));
        showTunnelNickGateOnly();
      }
      throw err;
    } finally {
      state._tunnelJoining = false;
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

  function rememberGuestReturn(raw) {
    const s = String(raw || '').trim();
    if (!s) return;
    try {
      const u = new URL(s);
      if (u.origin === window.location.origin) return;
      sessionStorage.setItem(GUEST_RETURN_KEY, u.href);
    } catch (_) {
      /* ignore invalid */
    }
  }

  function peekGuestReturnUrl() {
    try {
      return sessionStorage.getItem(GUEST_RETURN_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function clearGuestReturnUrl() {
    try {
      sessionStorage.removeItem(GUEST_RETURN_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  /** 代开/加入端结束会话后回到自己的网页端大厅（跨域 return） */
  function tryNavigateGuestReturn() {
    if (!isGuestClient()) return false;
    const href = peekGuestReturnUrl();
    if (!href) return false;
    try {
      clearGuestReturnUrl();
      window.location.href = href;
      return true;
    } catch (_) {
      return false;
    }
  }

  /** 代开端不在房间内时应回到自己的客户端网页 */
  function maybeGuestExitIfNotInRoom() {
    if (!isGuestClient() || leavingToLocal) return false;
    if (state.room || state.game || isInLiveSession()) return false;
    if (state._guestBootCreatePassive) return false;
    if (state.roomBusy) return false;
    if (el.roomBusyOverlay && !el.roomBusyOverlay.hidden) return false;
    if (el.createRoomModal && !el.createRoomModal.hidden) return false;
    return tryNavigateGuestReturn();
  }

  /** 对局结束后：代开端自动退出并回自己的网页端 */
  function maybeGuestExitAfterGameOver(gameState) {
    if (!isGuestClient()) return;
    if (!gameState || !gameState.over) return;
    if (state._guestExitingOver || leavingToLocal) return;
    state._guestExitingOver = true;
    showToast('对局结束，可点击胜利弹窗下方按钮返回大厅');
    // 不再自动跳转，让用户看完胜利弹窗后手动离开
  }

  /** 被动服务端/隧道断开：代开端回自己的网页端（短延迟避免闪断） */
  function scheduleGuestReturnOnDisconnect() {
    cancelRemoteRecover();
    remoteRecoverTimer = setTimeout(() => {
      remoteRecoverTimer = null;
      if (leavingToLocal) return;
      // 已在房间/对局、或仍在进房流程中：不要跳回客户端
      if (state._guestBootJoining || state.roomBusy || state._guestBootCreatePassive) return;
      if (state.room || state.game || isInLiveSession()) return;
      if (el.roomBusyOverlay && !el.roomBusyOverlay.hidden) return;
      if (typeof net.isConnected === 'function' && net.isConnected()) return;
      leavingToLocal = true;
      if (tryNavigateGuestReturn()) return;
      leavingToLocal = false;
      bounceToLocalLobby(t('toast.disconnected')).catch(() => {});
    }, 3500);
  }

  function syncGuestChrome() {
    const guest = isGuestClient();
    document.body.classList.toggle('is-guest-client', guest);
    // 加入端仍显示「创建房间」，走代开（本机不可开房）；被动模式仅主机可见
    if (el.btnToggleCreate) el.btnToggleCreate.hidden = false;
    const wrap = document.getElementById('passive-toggle-wrap');
    if (wrap) wrap.hidden = guest;
    if (
      guest &&
      el.createRoomModal &&
      !el.createRoomModal.hidden &&
      state.createModalMode !== 'create-on-host'
    ) {
      setCreatePanelOpen(false);
    }
    if (guest) applyPassiveLockUi(false);
    syncTunnelGuestChrome();
  }

  /** 对局进行中不可退出被动 */
  function isPassiveExitBlocked() {
    const room = state.room;
    if (!room || room.status !== 'playing') return false;
    if (state.game && state.game.over) return false;
    return true;
  }

  function formatPassiveControllerWho(ctrl) {
    if (!ctrl) return '';
    if (ctrl.who) return String(ctrl.who);
    const name = window.PlayerNick.stripBaseName(ctrl.name || '') || '';
    const tag = window.PlayerNick.normalizeTag(ctrl.tag || '');
    if (name && tag) return `${name}#${tag}`;
    return name || tag || '';
  }

  function syncPassiveShareUrl(url) {
    const next = String(url || state.passivePublicUrl || '').trim();
    if (next) state.passivePublicUrl = next;
    if (!el.passiveShareUrl) return;
    const show = Boolean(state.passiveMode && state.passivePublicUrl);
    el.passiveShareUrl.hidden = !show;
    if (show) {
      const input = el.passiveShareUrl.querySelector('input');
      if (input) input.value = state.passivePublicUrl;
    }
  }

  function syncPassiveExitButton() {
    if (!el.btnExitPassive) return;
    const blocked = state.passiveMode && isPassiveExitBlocked();
    el.btnExitPassive.disabled = blocked;
    el.btnExitPassive.title = blocked
      ? '对局进行中，请等待本局结束后再退出'
      : '';
    const hostName =
      window.PlayerNick.stripBaseName(
        state.playerName || (state.me && state.me.name) || ''
      ) || t('app.playerDefault');
    const who = formatPassiveControllerWho(state.passiveController);
    if (el.passiveLockTitle) {
      el.passiveLockTitle.textContent = who
        ? `${hostName}（正在被${who}操控中）`
        : t('lobby.passiveLockTitle') !== 'lobby.passiveLockTitle'
          ? t('lobby.passiveLockTitle')
          : '处于被动模式中';
    }
    if (el.passiveLockDesc) {
      if (blocked) {
        el.passiveLockDesc.textContent =
          '本机正在托管对局，无法退出被动模式，请等待本局结束。';
      } else if (who) {
        el.passiveLockDesc.textContent =
          '对方可通过隧道地址操控本机：开房、观战、聊天。本机保持锁定；结束后仍留在被动模式。';
      } else if (state.room && state.room.id) {
        el.passiveLockDesc.textContent =
          '无人值守中。退出被动模式将解散当前房间。可分享下方隧道地址让他人操控。';
      } else {
        el.passiveLockDesc.textContent =
          '无人值守：分享隧道地址后，他人可操控本机开房、观战与聊天；本机保持锁定。结束后仍留在被动模式。';
      }
    }
    syncPassiveShareUrl();
  }

  /** 被动模式锁定：暗屏 + 屏蔽点击，仅保留退出按钮与复制隧道地址 */
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
      // 进入被动完成时务必清掉准备中遮罩（含 state.roomBusy）
      if (state.roomBusy === 'passive') hideRoomBusy();
      else if (el.roomBusyOverlay) el.roomBusyOverlay.hidden = true;
    }
    syncPassiveExitButton();
  }

  function clearBootQueryFromUrl() {
    try {
      if (!window.location.search && !window.location.hash) return;
      window.history.replaceState({}, '', window.location.pathname);
    } catch (_) {}
  }

  function readBootPassword(bootQuery) {
    let bootPassword = '';
    try {
      bootPassword = String(sessionStorage.getItem('lianji.joinPwd') || '');
      sessionStorage.removeItem('lianji.joinPwd');
    } catch (_) {
      bootPassword = '';
    }
    if (!bootPassword && bootQuery.get('pwd') != null) {
      bootPassword = String(bootQuery.get('pwd'));
    }
    if (!bootPassword) {
      try {
        const hash = String(window.location.hash || '').replace(/^#/, '');
        if (hash) {
          const hp = new URLSearchParams(hash);
          if (hp.get('pwd') != null) bootPassword = String(hp.get('pwd'));
        }
      } catch (_) {
        /* ignore */
      }
    }
    return bootPassword;
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
    if (isTunnelGuest()) {
      try {
        if (typeof net.rememberTunnelNick === 'function') {
          net.rememberTunnelNick(next);
        }
      } catch (_) {}
    }
    return next;
  }

  /** 换隧道域名后 localStorage 会丢：HTTP + Socket 并行向房主召回 */
  async function resolveTunnelGuestNick() {
    let nick = loadSavedNick();
    if (nick) return nick;

    const httpP =
      typeof net.fetchTunnelNickHttp === 'function'
        ? net.fetchTunnelNickHttp({ timeoutMs: 1200 }).catch(() => '')
        : Promise.resolve('');

    const connectP = net.connect(net.getLocalOrigin());
    const socketP = connectP
      .then(() =>
        typeof net.recallTunnelNick === 'function'
          ? net.recallTunnelNick({ timeoutMs: 800 })
          : ''
      )
      .catch(() => '');

    // 谁先给出非空昵称就用谁；都空则最多再等齐
    nick = await new Promise((resolve) => {
      let done = false;
      const finish = (name) => {
        if (done) return;
        const n = window.PlayerNick.stripBaseName(name || '');
        if (!n) return;
        done = true;
        resolve(n);
      };
      httpP.then(finish);
      socketP.then(finish);
      setTimeout(() => {
        if (!done) {
          done = true;
          resolve('');
        }
      }, 1400);
    });

    if (!nick) {
      const [h, s] = await Promise.all([httpP, socketP]);
      nick =
        window.PlayerNick.stripBaseName(s || '') ||
        window.PlayerNick.stripBaseName(h || '') ||
        '';
    }

    try {
      await connectP;
    } catch (_) {
      /* enter 阶段还会再连 */
    }

    if (nick) {
      try {
        localStorage.setItem(NICK_STORAGE_KEY, nick);
      } catch (_) {}
    }
    return nick;
  }

  async function bootTunnelGuestFlow() {
    state.access = 'tunnel';
    state._tunnelBooting = true;
    applyTunnelGateLabels();
    document.documentElement.classList.add('boot-joining');
    showTunnelConnecting();
    try {
      const connected = await waitUntilTunnelConnected(120000);
      if (!connected) {
        showTunnelConnecting();
        showToast(t('toast.disconnected') || '未连接');
        // 后台继续重试；连上后由 connect 事件打开昵称门
        waitUntilTunnelConnected(600000).then((ok) => {
          if (!ok || leavingToLocal || state.inLobby || state.room) return;
          if (state._tunnelJoining || state._tunnelBooting) return;
          const saved = loadSavedNick();
          if (saved) {
            enterTunnelGuestToRoom(saved).catch(() => showTunnelNickGateOnly());
          } else {
            showTunnelNickGateOnly();
          }
        });
        return;
      }
      let nick = '';
      try {
        nick = await resolveTunnelGuestNick();
      } catch (_) {
        nick = loadSavedNick();
      }
      if (nick) {
        state.playerName = nick;
        if (el.playerName) el.playerName.value = nick;
        refreshNickUi();
        try {
          await enterTunnelGuestToRoom(nick);
        } catch (_) {
          /* toast / gate 已在 enterTunnelGuestToRoom 处理 */
        } finally {
          document.documentElement.classList.remove('boot-joining');
          clearBootQueryFromUrl();
        }
        return;
      }
      showTunnelNickGateOnly();
      clearBootQueryFromUrl();
    } finally {
      state._tunnelBooting = false;
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
    rememberExplicitLeave(roomId);
  }

  const LEFT_ROOMS_KEY = 'lianji.leftRooms';

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
    } catch (_) {
      /* ignore */
    }
  }

  function rememberExplicitLeave(roomId) {
    const id = roomId ? String(roomId).toUpperCase() : '';
    if (!id) return;
    const at = Date.now();
    state._leftRooms[id] = at;
    const map = readPersistedLeftRooms();
    map[id] = at;
    writePersistedLeftRooms(map);
  }

  function hasExplicitlyLeft(roomId) {
    const id = roomId ? String(roomId).toUpperCase() : '';
    if (!id) return false;
    if (state._leftRooms[id]) return true;
    const map = readPersistedLeftRooms();
    if (map[id]) {
      state._leftRooms[id] = map[id];
      return true;
    }
    return false;
  }

  function clearExplicitLeave(roomId) {
    const id = roomId ? String(roomId).toUpperCase() : '';
    if (!id) return;
    if (state._leftRooms[id]) delete state._leftRooms[id];
    const map = readPersistedLeftRooms();
    if (map[id]) {
      delete map[id];
      writePersistedLeftRooms(map);
    }
  }

  function pruneLeftRooms(rooms) {
    const list = rooms || [];
    const map = { ...state._leftRooms, ...readPersistedLeftRooms() };
    const ttl = 6 * 3600 * 1000;
    const now = Date.now();
    let changed = false;
    for (const id of Object.keys(map)) {
      const at = Number(map[id] || 0);
      if (at && now - at > ttl) {
        delete state._leftRooms[id];
        delete map[id];
        changed = true;
        continue;
      }
      const room = list.find((r) => String(r && r.id ? r.id : '').toUpperCase() === id);
      if (!room) continue;
      // 服务端仍认为我在房间里 → 清理本地「已离开」标记，避免阻挡重连弹窗
      if (isSelfInRoomPlayers(room)) {
        delete state._leftRooms[id];
        delete map[id];
        changed = true;
        continue;
      }
    }
    if (changed) writePersistedLeftRooms(map);
  }

  function announceLeaveToHost(probe) {
    const roomId = String(
      (probe && (probe.roomId || probe.id)) ||
        (state.room && state.room.id) ||
        state._lastRoomId ||
        ''
    ).toUpperCase();
    if (!roomId) return;
    rememberExplicitLeave(roomId);
    const payload = {
      roomId,
      name: state.playerName || (el.playerName && el.playerName.value) || '',
      tag: myTag(),
      sessionId: getTabSessionId(),
    };
    try {
      if (typeof net.announceLeave === 'function') net.announceLeave(payload);
    } catch (_) {}
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
    document.body.classList.toggle('is-chat-expanded', on && isMobileChatUi());
    if (!on) setChatInputFocused(false);
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
      for (const row of list.querySelectorAll('[data-speaker-key]')) {
        if (row.dataset.speakerKey === key) return row;
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
    stopMqttAutoRecover();
  }

  function startLobbyAutoRefresh() {
    stopLobbyAutoRefresh();
    if (!state.inLobby) return;
    requestLobbyRefresh();
    lobbyRefreshTimer = setInterval(requestLobbyRefresh, LOBBY_REFRESH_MS);
    scheduleMqttAutoRecover();
  }

  function readBootQueryEarly() {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch (_) {
      return new URLSearchParams();
    }
  }

  function isMobilePlayPage() {
    try {
      return (
        document.documentElement.dataset.mobilePlay === '1' ||
        /\/play\.html$/i.test(String(window.location.pathname || ''))
      );
    } catch (_) {
      return false;
    }
  }

  function isMobileChatUi() {
    if (!isMobilePlayPage()) return false;
    try {
      if (window.ClientPlatform && window.ClientPlatform.current() === 'mobile') {
        return true;
      }
      if (
        window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform()
      ) {
        return true;
      }
    } catch (_) {}
    return window.matchMedia('(max-width: 719px)').matches;
  }

  function applyMobilePlayChatChrome() {
    if (!isMobileChatUi()) return;
    document.body.classList.add('is-mobile-chat');
    if (!el.chatDock) return;
    el.chatDock.classList.remove('is-custom-pos');
    el.chatDock.style.left = '';
    el.chatDock.style.top = '';
    el.chatDock.style.right = '';
    el.chatDock.style.bottom = '';
    el.chatDock.style.transform = '';
    el.chatDock.style.opacity = '';
  }

  function setChatInputFocused(focused) {
    if (!isMobileChatUi()) return;
    document.body.classList.toggle('is-chat-focused', Boolean(focused));
  }

  function peekMobilePlayJoin() {
    try {
      const raw = sessionStorage.getItem('lianji.mobilePlayJoin');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function navigateJoinClientHome() {
    const home =
      net.getJoinClientHome && net.getJoinClientHome
        ? net.getJoinClientHome()
        : '';
    if (!home) return false;
    window.location.href = home;
    return true;
  }

  function getRemoteHostBaseUrl() {
    try {
      if (net.isOnRemoteHost && net.isOnRemoteHost()) {
        return String(net.getCurrentUrl() || '').replace(/\/$/, '');
      }
    } catch (_) {
      /* ignore */
    }
    try {
      const h = sessionStorage.getItem('lianji.mobilePlayHost');
      if (h) return String(h).replace(/\/$/, '');
    } catch (_) {
      /* ignore */
    }
    return '';
  }

  function syncRemoteAssetBase() {
    const remote = getRemoteHostBaseUrl();
    if (!remote) return;
    try {
      window.__lianjiRemoteAssetBase = remote;
    } catch (_) {
      /* ignore */
    }
  }

  function gameAssetBaseUrl() {
    // 安卓 play 页：面板/脚本打包在 APK 内，仅卡图/音频走房主服务器
    if (isMobilePlayPage()) {
      syncRemoteAssetBase();
      return '';
    }
    try {
      if (net.isOnRemoteHost && net.isOnRemoteHost()) {
        return String(net.getCurrentUrl() || '').replace(/\/$/, '');
      }
    } catch (_) {
      /* ignore */
    }
    return '';
  }

  async function fetchGamesCatalog() {
    if (isMobilePlayPage()) {
      const info = await fetch('./games-info.json', { cache: 'no-cache' }).then(
        (r) => {
          if (!r.ok) throw new Error('games-info.json');
          return r.json();
        }
      );
      return info.games || [];
    }
    const base = gameAssetBaseUrl();
    const infoPath = base ? base + '/api/info' : '/api/info';
    const res = await fetch(infoPath, { cache: 'no-cache' });
    if (!res.ok) throw new Error('api/info HTTP ' + res.status);
    const info = await res.json();
    return info.games || [];
  }

  function syncBootJoinBusyMessage() {
    if (!document.documentElement.classList.contains('boot-joining')) return;
    const msg = el.roomBusyMessage || document.getElementById('room-busy-message');
    if (!msg) return;
    msg.setAttribute('data-i18n-manual', '');
    msg.removeAttribute('data-i18n');
    const q = readBootQueryEarly();
    const bootJoin = String(q.get('join') || '').trim();
    if (bootJoin) {
      msg.textContent =
        q.get('spectate') === '1'
          ? '正在观战…'
          : t('create.joining') !== 'create.joining'
            ? t('create.joining')
            : '进入房间中…';
      if (el.roomBusyOverlay) el.roomBusyOverlay.dataset.busyMode = 'join';
    } else if (q.get('createPassive') === '1') {
      msg.textContent = '正在进入被动主机…';
      if (el.roomBusyOverlay) el.roomBusyOverlay.dataset.busyMode = 'create';
    } else {
      msg.textContent = t('lobby.enter') !== 'lobby.enter' ? t('lobby.enter') : '正在加入…';
    }
    if (el.roomBusyOverlay) el.roomBusyOverlay.hidden = false;
  }

  if (I18n && typeof I18n.init === 'function') {
    try {
      await I18n.init();
    } catch (err) {
      console.warn('i18n init failed', err);
    }
  }
  syncBootJoinBusyMessage();

  const bootQueryEarly = readBootQueryEarly();
  const guestBootJoinFast =
    bootQueryEarly.get('guest') === '1' &&
    String(bootQueryEarly.get('join') || '').trim();
  const mobilePlayJoinFast =
    isMobilePlayPage() && Boolean(peekMobilePlayJoin());
  const bootSidEarly = String(bootQueryEarly.get('sid') || '').trim().slice(0, 64);
  if (bootSidEarly) {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, bootSidEarly);
    } catch (_) {
      /* ignore */
    }
  }
  const bootTagEarly = window.PlayerNick.normalizeTag(bootQueryEarly.get('tag') || '');
  if (bootTagEarly) {
    try {
      localStorage.setItem(window.PlayerNick.TAG_KEY, bootTagEarly);
    } catch (_) {}
  }

  async function mountGamePanels() {
    syncRemoteAssetBase();
    const panelBase = isMobilePlayPage() ? '' : gameAssetBaseUrl();
    state.games = await fetchGamesCatalog();
    const result = await window.GameBoot.mountPanels(
      state.games,
      panelBase || undefined
    );
    if (result && result.fail && result.fail.length) {
      console.warn('部分游戏资源未加载', result.fail);
    }
    if (I18n && typeof I18n.applyDom === 'function') {
      I18n.applyDom(document.getElementById('game-panels') || document);
    }
    return result;
  }

  let gamePanelsReadyPromise = null;
  let gamePanelsBound = false;

  function gamePanelsMounted() {
    const mount = document.getElementById('game-panels');
    return Boolean(mount && mount.children.length > 0);
  }

  function gameUiReadyFor(type) {
    if (!type) return gamePanelsMounted();
    const panel = document.getElementById('panel-' + type);
    if (!panel) return false;
    if (type === 'lasidao') return Boolean(window.LasidaoUi);
    if (type === 'sgs') return Boolean(window.SgsUi);
    if (type === 'incan') return Boolean(window.IncanUi);
    if (type === 'gomoku') return Boolean(window.GomokuBoard || el.gomokuCanvas);
    return true;
  }

  function resetGamePanelsState() {
    gamePanelsBound = false;
    gamePanelsReadyPromise = null;
  }

  async function ensureGamePanelsReady() {
    const needType = currentGameType();
    if (
      gamePanelsBound &&
      gamePanelsMounted() &&
      (!needType || gameUiReadyFor(needType))
    ) {
      return;
    }
    // 已绑定但当前游戏 UI 丢失（半截失败）→ 强制重挂
    if (gamePanelsBound && needType && !gameUiReadyFor(needType)) {
      resetGamePanelsState();
    }
    if (!gamePanelsReadyPromise) {
      gamePanelsReadyPromise = mountGamePanels()
        .then((result) => {
          bindGamePanelUi();
          gamePanelsBound = gamePanelsMounted();
          if (!gamePanelsBound) {
            throw new Error('游戏面板未挂载');
          }
          if (result && result.fail && result.fail.length) {
            const need = currentGameType();
            const needFailed =
              need && result.fail.some((f) => f.id === need);
            if (needFailed || !result.ok.length) {
              const ids = result.fail.map((f) => f.id).join(', ');
              showToastSafe(t('game.loadFail') + ' (' + ids + ')', 5000);
            } else {
              console.warn(
                '部分非当前游戏资源未加载',
                result.fail.map((f) => f.id)
              );
            }
          }
          return result;
        })
        .catch((err) => {
          resetGamePanelsState();
          throw err;
        });
    }
    await gamePanelsReadyPromise;
  }

  function showToastSafe(message, durationMs) {
    try {
      if (typeof showToast === 'function') {
        showToast(message, durationMs);
        return;
      }
    } catch (_) {}
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.hidden = false;
    toast.textContent = message;
  }

  function bindGamePanelUi() {
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
  }

  // 访客深链 / 安卓 play：先连房间；游戏面板从 APK 内本地加载（避免跨域 fetch 失败）
  if (guestBootJoinFast || mobilePlayJoinFast) {
    try {
      state.games = await fetchGamesCatalog();
    } catch (err) {
      console.warn('games catalog fetch failed', err);
      state.games = [];
    }
  } else {
    try {
      await ensureGamePanelsReady();
    } catch (err) {
      // 不中断整页初始化：大厅仍可用，进房/开局时再重试挂载
      console.error('game panels boot failed', err);
      resetGamePanelsState();
      showToastSafe(t('game.loadFail'), 5000);
    }
  }

  function showToast(message, durationMs, opts) {
    opts = opts || {};
    const large = Boolean(opts.large || opts.variant === 'spectator');
    const toastSlot = el.toast && el.toast.parentElement;
    clearTimeout(toastTimer);
    clearTimeout(toastExitTimer);
    toastTimer = null;
    toastExitTimer = null;

    el.toast.textContent = message;
    el.toast.hidden = false;
    el.toast.classList.remove('is-entering', 'is-leaving');
    el.toast.classList.toggle('is-spectator-notice', large);
    if (toastSlot) toastSlot.classList.toggle('is-spectator-notice', large);

    if (large) {
      void el.toast.offsetWidth;
      el.toast.classList.add('is-entering');
      toastTimer = setTimeout(() => {
        el.toast.classList.remove('is-entering');
        el.toast.classList.add('is-leaving');
        toastExitTimer = setTimeout(() => {
          el.toast.hidden = true;
          el.toast.classList.remove(
            'is-spectator-notice',
            'is-entering',
            'is-leaving'
          );
          if (toastSlot) toastSlot.classList.remove('is-spectator-notice');
          toastExitTimer = null;
        }, SPECTATOR_TOAST_ANIM_MS);
        toastTimer = null;
      }, SPECTATOR_TOAST_ANIM_MS + SPECTATOR_TOAST_HOLD_MS);
      return;
    }

    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
      el.toast.classList.remove('is-spectator-notice', 'is-entering', 'is-leaving');
      if (toastSlot) toastSlot.classList.remove('is-spectator-notice');
      toastTimer = null;
    }, typeof durationMs === 'number' && durationMs > 0 ? durationMs : 3200);
  }

  function isBlockingInvites() {
    return Date.now() < blockInvitesUntil;
  }

  function removeInviteToast(toastEl) {
    if (!toastEl) return;
    if (toastEl._autoCloseTimer) {
      clearTimeout(toastEl._autoCloseTimer);
      toastEl._autoCloseTimer = null;
    }
    const idx = inviteToasts.indexOf(toastEl);
    if (idx !== -1) inviteToasts.splice(idx, 1);
    toastEl.remove();
  }

  function clearAllInviteToasts() {
    while (inviteToasts.length) {
      const el = inviteToasts.pop();
      if (el && el.parentNode) el.remove();
    }
  }

  function blockAllInvites() {
    blockInvitesUntil = Date.now() + BLOCK_INVITES_MS;
    try {
      localStorage.setItem(BLOCK_INVITES_KEY, String(blockInvitesUntil));
    } catch (_) {}
    clearAllInviteToasts();
    syncInviteBlockMenuItem();
    showToast(t('invite.blockedHint') || '15 分钟内不再接收房间邀请');
  }

  function syncInviteBlockMenuItem() {
    if (!el.btnMenuInviteBlock) return;
    const isOn = isBlockingInvites();
    el.btnMenuInviteBlock.textContent = isOn
      ? (t('invite.blockAllOn') || '已关闭房间邀请')
      : (t('invite.blockAllMenu') || '不接受房间邀请');
    el.btnMenuInviteBlock.classList.toggle('is-active', isOn);
  }

  function showInviteToast(data) {
    if (!el.inviteToastSlot) return;
    if (isBlockingInvites()) return;

    const host = window.PlayerNick.fullLabel(data.hostName, data.hostTag);
    const game = gameLabelOf(data.gameType, data.gameLabel || data.gameType);
    const mode = data.gameModeLabel || data.gameMode || '';
    const line1 = t('invite.text', { host });
    const line2 = mode ? `${game} · ${mode}` : game;
    const line3 = t('invite.roomCount', {
      cur: data.playerCount,
      max: data.maxPlayers,
    });

    const toast = document.createElement('div');
    toast.className = 'invite-toast';
    toast.dataset.roomId = data.roomId || '';
    toast.dataset.host = data.host || '';

    const head = document.createElement('div');
    head.className = 'invite-toast-head';

    const body = document.createElement('div');
    body.className = 'invite-toast-body';
    body.textContent = [line1, line2, line3].join('\n');

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'icon-btn invite-toast-close';
    closeBtn.setAttribute('aria-label', t('invite.dismiss') || '关闭');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => removeInviteToast(toast));

    head.appendChild(body);
    head.appendChild(closeBtn);

    const actions = document.createElement('div');
    actions.className = 'invite-toast-actions';

    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'invite-toast-reject';
    rejectBtn.dataset.action = 'reject';
    rejectBtn.textContent = t('invite.reject') || '拒绝';
    rejectBtn.addEventListener('click', () => removeInviteToast(toast));

    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'invite-toast-accept';
    acceptBtn.dataset.action = 'accept';
    acceptBtn.textContent = t('invite.accept') || '接受';
    acceptBtn.addEventListener('click', () => {
      const rid = toast.dataset.roomId;
      const host = toast.dataset.host || null;
      removeInviteToast(toast);
      if (rid) {
        const name = state.playerName || el.playerName.value.trim() || t('app.playerDefault');
        joinRoomWithBusy(async () => {
          const opts = { password: '' };
          if (!host) opts.local = true;
          await net.enterRoomOnHost(rid, name, host, opts);
        }).catch((err) => {
          showToast(err.message || t('toast.joinFail'));
        });
      }
    });

    actions.appendChild(rejectBtn);
    actions.appendChild(acceptBtn);

    const blockBtn = document.createElement('button');
    blockBtn.type = 'button';
    blockBtn.className = 'invite-toast-block';
    blockBtn.dataset.action = 'block';
    blockBtn.textContent = t('invite.blockAllBtn') || '15分钟内不接受任何邀请';
    blockBtn.addEventListener('click', () => {
      removeInviteToast(toast);
      blockAllInvites();
    });

    toast.appendChild(head);
    toast.appendChild(actions);
    toast.appendChild(blockBtn);
    el.inviteToastSlot.appendChild(toast);
    inviteToasts.push(toast);

    // 自动关闭（可选）
    const autoCloseMs = 15000;
    const autoCloseTimer = setTimeout(() => removeInviteToast(toast), autoCloseMs);
    toast._autoCloseTimer = autoCloseTimer;
  }

  function showRoomBusy(mode, message) {
    state.roomBusy = mode;
    if (el.roomBusyOverlay) {
      el.roomBusyOverlay.hidden = false;
      el.roomBusyOverlay.dataset.busyMode = mode || '';
    }
    if (el.roomBusyMessage) {
      el.roomBusyMessage.setAttribute('data-i18n-manual', '');
      el.roomBusyMessage.removeAttribute('data-i18n');
      el.roomBusyMessage.textContent =
        message ||
        (mode === 'passive'
          ? '正在进入被动模式…'
          : mode === 'assets'
            ? t('lasidao.loadingAssets')
          : mode === 'connect'
            ? tunnelConnectingMessage()
          : mode === 'create'
            ? t('create.creating')
            : t('create.joining'));
    }
    clearTimeout(roomBusyTimer);
    // 隧道连接中：不自动超时关掉，保持转圈直到连上或用户离开
    if (mode === 'connect') {
      roomBusyTimer = null;
      return;
    }
    roomBusyTimer = setTimeout(() => {
      if (!state.roomBusy) return;
      const was = state.roomBusy;
      hideRoomBusy();
      if (was === 'passive') {
        if (el.chkPassiveMode) el.chkPassiveMode.checked = false;
        applyPassiveLockUi(false);
        showToast('进入被动模式超时，请重试');
      } else if (was === 'assets') {
        showToast(t('lasidao.loadingAssetsTimeout'));
      } else if (was === 'reload') {
        showToast(t('reload.timeout') || t('create.joinTimeout'));
      } else {
        showToast(was === 'create' ? t('create.createTimeout') : t('create.joinTimeout'));
      }
    }, mode === 'reload' || mode === 'create' ? 90000 : 15000);
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

  /** 卡拉斯坦：进等待室后在后台预热卡图 */
  function kickLasidaoPreload(room) {
    if (!room || room.gameType !== 'lasidao') return;
    if (room.status === 'playing') return;
    const A = window.LasidaoAssets;
    if (A && typeof A.preloadPictures === 'function') A.preloadPictures();
  }

  /** 开局前尽量等卡图就绪；超时也放行，避免整局卡死 */
  const LASIDAO_ASSETS_WAIT_MS = 10000;

  async function ensureLasidaoAssetsReady(opts) {
    const A = window.LasidaoAssets;
    if (!A || typeof A.preloadPictures !== 'function') return true;
    if (typeof A.isPreloadDone === 'function' && A.isPreloadDone()) return true;

    const blockUi = !(opts && opts.blockUi === false);
    const pending = A.preloadPictures();
    if (typeof A.isPreloadDone === 'function' && A.isPreloadDone()) return true;

    if (blockUi) {
      showRoomBusy('assets', t('lasidao.loadingAssets'));
    }
    let timer = null;
    try {
      const timed = new Promise((resolve) => {
        timer = setTimeout(() => resolve('timeout'), LASIDAO_ASSETS_WAIT_MS);
      });
      const result = await Promise.race([
        Promise.resolve(pending).then(() => 'ok'),
        timed,
      ]);
      return result === 'ok';
    } catch (err) {
      console.warn('lasidao assets preload failed', err);
      return false;
    } finally {
      if (timer) clearTimeout(timer);
      if (blockUi && state.roomBusy === 'assets') hideRoomBusy();
    }
  }

  /** 对局中后台预热，不挡渲染、不盖遮罩 */
  function kickLasidaoAssetsBackground() {
    const A = window.LasidaoAssets;
    if (!A || typeof A.preloadPictures !== 'function') return;
    if (typeof A.isPreloadDone === 'function' && A.isPreloadDone()) return;
    try {
      A.preloadPictures();
    } catch (err) {
      console.warn('lasidao background preload failed', err);
    }
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

  function syncGameRulesMenuItem() {
    if (!el.btnMenuGameRules) return;
    const isLasidao = state.room && state.room.gameType === 'lasidao';
    el.btnMenuGameRules.hidden = !(currentViewName === 'game' && isLasidao);
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
    if (isMobileChatUi()) {
      applyMobilePlayChatChrome();
    } else if (!chatDockPosLoaded) {
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

    // 左上角菜单始终可见；对局中额外显示「退出游戏」与「游戏规则」
    if (el.gameMenu) el.gameMenu.hidden = false;
    if (el.roomBanner) el.roomBanner.hidden = name !== 'room';
    syncQuitMenuItem();
    syncGameRulesMenuItem();
    if (name !== 'game') closeGameMenu();

    if (el.appPhaseTitle) {
      el.appPhaseTitle.textContent =
        name === 'room'
          ? t('app.titleRoom')
          : name === 'game'
            ? t('app.titleGame')
            : t('app.title');
    }
    // 昵称：大厅标题旁；房间「房间等待中」标题右侧也可改名
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
    // 隧道操控 chrome 可能改过人员栏，按当前视图再对齐一次
    syncTunnelGuestChrome();
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
    syncSpectatorsWatchUi();
  }

  function humanSpectators(room) {
    return (room && room.observers ? room.observers : []).filter(
      (o) => o && !o.passiveHost
    );
  }

  function closeSpectatorsPop() {
    if (!el.spectatorsPop || !el.btnSpectators) return;
    el.spectatorsPop.hidden = true;
    el.btnSpectators.setAttribute('aria-expanded', 'false');
  }

  function fillSpectatorsList() {
    if (!el.spectatorsList || !el.spectatorsEmpty) return;
    const list = humanSpectators(state.room);
    el.spectatorsList.innerHTML = '';
    for (const o of list) {
      const li = document.createElement('li');
      const isMe = state.me && o.id === state.me.id;
      li.innerHTML =
        nickHtml(o.name, o.tag) +
        (isMe ? ' <span class="you">(我)</span>' : '');
      li.title = window.PlayerNick.fullLabel(o.name, o.tag);
      el.spectatorsList.appendChild(li);
    }
    el.spectatorsEmpty.hidden = list.length > 0;
  }

  function openSpectatorsPop() {
    if (!el.spectatorsPop || !el.btnSpectators) return;
    fillSpectatorsList();
    el.spectatorsPop.hidden = false;
    el.btnSpectators.setAttribute('aria-expanded', 'true');
  }

  function toggleSpectatorsPop() {
    if (!el.spectatorsPop) return;
    if (el.spectatorsPop.hidden) openSpectatorsPop();
    else closeSpectatorsPop();
  }

  function syncSpectatorsWatchUi() {
    if (!el.spectatorsWatch) {
      syncHostingUi();
      return;
    }
    const inGameView =
      currentViewName === 'game' ||
      (state.room && state.room.status === 'playing' && !el.viewGame.hidden);
    const show = Boolean(state.room && inGameView);
    el.spectatorsWatch.hidden = !show;
    if (!show) {
      closeSpectatorsPop();
      syncHostingUi();
      return;
    }
    const n = humanSpectators(state.room).length;
    if (el.spectatorsCount) el.spectatorsCount.textContent = String(n);
    if (el.btnSpectators) {
      el.btnSpectators.title = t('room.spectatorsTitle') + '：' + n;
    }
    if (el.spectatorsPop && !el.spectatorsPop.hidden) fillSpectatorsList();
    syncHostingUi();
  }

  function isSelfHosted() {
    const meId = state.me && state.me.id;
    if (!meId) return false;
    if (state.game && state.game.me && state.game.me.isHosted) return true;
    if (state.room && Array.isArray(state.room.players)) {
      const seat = state.room.players.find((p) => p && p.id === meId);
      if (seat && seat.isHosted) return true;
    }
    return false;
  }

  function syncHostingUi() {
    const inGameView =
      currentViewName === 'game' ||
      (state.room && state.room.status === 'playing' && !el.viewGame.hidden);
    const gameMeta =
      (state.games || []).find(
        (g) =>
          g &&
          g.id ===
            ((state.game && state.game.type) ||
              (state.room && state.room.gameType))
      ) || null;
    const allowsHosting = Boolean(gameMeta && gameMeta.supportsHosting);
    const seated =
      Boolean(state.me && state.me.id) &&
      !state.isSpectator &&
      Boolean(
        state.room &&
          Array.isArray(state.room.players) &&
          state.room.players.some(
            (p) => p && p.id === state.me.id && !p.left && !p.isBot
          )
      );
    const gameOver = Boolean(state.game && state.game.over);
    const show = Boolean(
      state.room && inGameView && allowsHosting && seated && !gameOver
    );
    const hosted = isSelfHosted();

    if (el.btnHosting) {
      el.btnHosting.hidden = !show;
      el.btnHosting.classList.toggle('is-active', show && hosted);
      el.btnHosting.textContent = hosted
        ? t('game.hostingCancel')
        : t('game.hosting');
      el.btnHosting.setAttribute(
        'aria-pressed',
        show && hosted ? 'true' : 'false'
      );
    }

    if (el.hostingOverlay) {
      el.hostingOverlay.hidden = !(show && hosted);
      el.hostingOverlay.setAttribute(
        'aria-hidden',
        show && hosted ? 'false' : 'true'
      );
    }
    document.body.classList.toggle('is-hosting', Boolean(show && hosted));
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

  function placeHeaderNick(view) {
    if (!el.headerNick) return;
    const titleRow = document.querySelector('.app-top-title-row');
    const title = document.getElementById('app-phase-title');
    const inRoomOrGame =
      Boolean(state.room) && (view === 'room' || view === 'game');
    if (inRoomOrGame && titleRow && title) {
      // 房间/对局：昵称放在「房间等待中」标题右侧
      if (el.headerNick.parentNode !== titleRow || el.headerNick.previousElementSibling !== title) {
        title.insertAdjacentElement('afterend', el.headerNick);
      }
      return;
    }
    if (titleRow && el.headerNick.parentNode !== titleRow) {
      titleRow.appendChild(el.headerNick);
    }
  }

  function canEditHeaderNick() {
    if (!el.headerNick) return false;
    // 大厅内可改
    if (state.inLobby && el.viewLobby && !el.viewLobby.hidden) return true;
    // 房间/对局内所有玩家都可改
    if (
      state.room &&
      ((el.viewRoom && !el.viewRoom.hidden) ||
        (el.viewGame && !el.viewGame.hidden))
    ) {
      return true;
    }
    return false;
  }

  function shouldShowHeaderNick(view) {
    if (state.inLobby && view === 'lobby') return true;
    if (state.room && (view === 'room' || view === 'game')) return true;
    return false;
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
    // 大厅标题旁；房间「房间等待中」标题右侧也可改名
    const showNick = shouldShowHeaderNick(view);
    placeHeaderNick(view);
    if (!showNick && nickEditing) {
      nickEditing = false;
      if (el.headerNick) el.headerNick.classList.remove('is-editing');
    }
    if (el.headerNick) {
      el.headerNick.hidden = !showNick;
      el.headerNick.classList.toggle(
        'is-room-nick',
        Boolean(view === 'room' || view === 'game')
      );
      el.headerNick.classList.remove('is-tunnel-room-nick');
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
    // 未进大厅的昵称门：不要用默认「玩家」覆盖用户正在输入的内容
    if (el.playerName && !state.inLobby && state.playerName) {
      el.playerName.value = window.PlayerNick.stripBaseName(state.playerName);
    }
  }

  function hostHint(room) {
    if (!room || !room.host) return '';
    if (room.local) return t('room.viaLocal');
    const viaRaw = String(room.via || '');
    return viaRaw.includes('mqtt') ? t('room.viaMqtt') : t('room.viaRemote');
  }

  function remoteBadgeLabel(person) {
    const client = String((person && person.client) || '').toLowerCase();
    const role = String((person && person.role) || '').toLowerCase();
    let plat = '';
    if (client === 'windows') plat = t('lobby.clientWindows');
    else if (client === 'mac') plat = t('lobby.clientMac');
    else if (client === 'mobile') plat = t('lobby.clientMobile');
    let roleLabel = '';
    if (role === 'host') roleLabel = t('lobby.roleHost');
    else if (role === 'client') roleLabel = t('lobby.roleClient');
    return [plat, roleLabel].filter(Boolean).join('·');
  }

  function remoteBadge(person) {
    const label = remoteBadgeLabel(person);
    if (!label) return '';
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

  let lastCreateGameId = null;

  function updateCreateForm() {
    const g = selectedGameMeta();
    if (!g) {
      el.gameHint.textContent = t('create.hintDefault');
      return;
    }

    // 由各游戏 modes 下发；缺省则兜底为「标准模式」。切换游戏时落到该游戏的默认模式。
    const modes =
      g.modes && g.modes.length
        ? g.modes
        : [{ id: 'standard', label: t('create.modeStandard') }];
    const gameChanged = lastCreateGameId !== g.id;
    lastCreateGameId = g.id;
    if (el.gameModeWrap) el.gameModeWrap.hidden = false;
    if (el.gameMode) {
      let cur = el.gameMode.value;
      if (g.id === 'lasidao' && (cur === 'standard' || cur === 'solo')) cur = 'melee';
      el.gameMode.innerHTML = '';
      for (const m of modes) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = modeLabelOf(m.id, m.label);
        el.gameMode.appendChild(opt);
      }
      const defaultMode = modes.find((m) => m.default) || modes[0];
      if (
        !gameChanged &&
        [...el.gameMode.options].some((o) => o.value === cur)
      ) {
        el.gameMode.value = cur;
      } else if (
        defaultMode &&
        [...el.gameMode.options].some((o) => o.value === defaultMode.id)
      ) {
        el.gameMode.value = defaultMode.id;
      } else {
        el.gameMode.value = modes[0].id;
      }
    }

    if (g.id === 'gomoku') {
      el.maxPlayersWrap.hidden = true;
      restoreMaxOptions();
      el.roomMax.value = '2';
      el.gameHint.textContent = t('create.hintGomoku');
      if (el.roomAllowTradeWrap) el.roomAllowTradeWrap.hidden = true;
      if (el.roomConflictDlcWrap) el.roomConflictDlcWrap.hidden = true;
    } else if (g.id === 'incan') {
      el.maxPlayersWrap.hidden = false;
      restoreMaxOptions();
      const v = Number(el.roomMax.value);
      if (v < 3) el.roomMax.value = '6';
      el.gameHint.textContent = t('create.hintIncanFull');
      if (el.roomAllowTradeWrap) el.roomAllowTradeWrap.hidden = true;
      if (el.roomConflictDlcWrap) el.roomConflictDlcWrap.hidden = true;
    } else if (g.id === 'lasidao') {
      el.maxPlayersWrap.hidden = false;
      const modeId = el.gameMode ? el.gameMode.value : 'melee';
      const mode = (g.modes || []).find((m) => m.id === modeId) || g.modes[0];
      const seats = (mode && mode.seats) || [2, 3, 4, 5];
      const cur = el.roomMax.value;
      const fallback = seats.includes(Number(mode && mode.defaultSeat))
        ? Number(mode.defaultSeat)
        : seats[0];
      el.roomMax.innerHTML = '';
      for (const n of seats) {
        const opt = document.createElement('option');
        opt.value = String(n);
        opt.textContent = String(n);
        el.roomMax.appendChild(opt);
      }
      if (
        !gameChanged &&
        [...el.roomMax.options].some((o) => o.value === cur)
      ) {
        el.roomMax.value = cur;
      } else {
        el.roomMax.value = String(fallback);
      }
      if (modeId === 'h2h') {
        el.gameHint.textContent = t('create.hintLasidaoH2h');
      } else {
        el.gameHint.textContent = t('create.hintLasidaoFull');
      }
      if (el.roomAllowTradeWrap) el.roomAllowTradeWrap.hidden = false;
      if (el.roomConflictDlcWrap) el.roomConflictDlcWrap.hidden = false;
    } else if (g.id === 'sgs') {
      if (el.roomAllowTradeWrap) el.roomAllowTradeWrap.hidden = true;
      if (el.roomConflictDlcWrap) el.roomConflictDlcWrap.hidden = true;
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
      if (el.roomAllowTradeWrap) el.roomAllowTradeWrap.hidden = true;
      if (el.roomConflictDlcWrap) el.roomConflictDlcWrap.hidden = true;
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
    const preferred = 'lasidao';
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

  function syncCreatePasswordUi() {
    const on = Boolean(el.roomHasPassword && el.roomHasPassword.checked);
    if (el.roomPasswordWrap) el.roomPasswordWrap.hidden = !on;
  }

  function createPasswordPayload() {
    const hasPassword = Boolean(el.roomHasPassword && el.roomHasPassword.checked);
    return {
      hasPassword,
      password: hasPassword
        ? String((el.roomPassword && el.roomPassword.value) || '')
        : '',
    };
  }

  function askRoomPassword(room) {
    if (!room || !room.hasPassword) return '';
    const tip = t('join.passwordPrompt') || '请输入房间密码（可为空）';
    const v = window.prompt(tip, '');
    if (v == null) return null; // cancelled
    return String(v);
  }

  function roomCanJoin(room) {
    if (!room) return false;
    if (room.canJoin != null) return Boolean(room.canJoin);
    const waiting = !room.status || room.status === 'waiting';
    return waiting && !isRoomFull(room);
  }

  function roomCanSpectate(room) {
    if (!room) return false;
    if (room.over) return false;
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
    info.className = 'room-list-info';
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
      room.status === 'playing' && !room.over
        ? ' <span class="badge">对局中</span>'
        : '';
    const pwdBit = room.hasPassword
      ? ' <span class="badge">' + escapeHtml(t('room.password') || '密码') + '</span>'
      : '';
    const codeBit = room.id
      ? ` <span class="room-list-code" title="${escapeHtml(t('room.code') || '房间码')}">${escapeHtml(String(room.id).toUpperCase())}</span>`
      : '';
    info.innerHTML =
      `<span class="room-list-head">` +
      `<span class="badge game-badge">${escapeHtml(gameLabel)}${escapeHtml(modeBit)}</span> ` +
      `${escapeHtml(room.name)}${codeBit}` +
      statusBit +
      pwdBit +
      (where ? ` <span class="room-list-where">· ${escapeHtml(where)}</span>` : '') +
      `</span>` +
      `<span class="room-list-players">${playerBitHtml}</span>`;
    const canJoin = roomCanJoin(room);
    const canSpec = roomCanSpectate(room);

    const btnSpec = document.createElement('button');
    btnSpec.type = 'button';
    const _specText = t('lobby.spectate');
    btnSpec.textContent = _specText === 'lobby.spectate' ? '观战' : _specText;
    btnSpec.className = 'secondary';
    if (!canSpec) {
      btnSpec.disabled = true;
      btnSpec.title = '当前房间不可观战';
    } else {
      btnSpec.addEventListener('click', () => spectateDiscoveredRoom(room));
    }

    const btnJoin = document.createElement('button');
    btnJoin.type = 'button';
    btnJoin.textContent = t('lobby.join');
    if (!canJoin) {
      btnJoin.disabled = true;
      btnJoin.title = room.status === 'playing' ? '对局已开始，请观战' : t('lobby.roomFull');
      li.classList.add('is-full');
    } else {
      btnJoin.addEventListener('click', () => joinDiscoveredRoom(room));
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

  function isSelfInRoomPlayers(room) {
    if (!room || !Array.isArray(room.playerNames) || !room.playerNames.length) {
      return false;
    }
    const myName = window.PlayerNick.stripBaseName(
      state.playerName || (el.playerName && el.playerName.value) || ''
    );
    if (!myName) return false;
    const tag = window.PlayerNick.normalizeTag(myTag() || '');
    const tags = Array.isArray(room.playerTags) ? room.playerTags : [];
    return room.playerNames.some((rawName, i) => {
      const n = window.PlayerNick.stripBaseName(rawName);
      if (n !== myName) return false;
      const t = window.PlayerNick.normalizeTag(tags[i] || '');
      if (tag && t) return tag === t;
      if (tag && !t) return false;
      if (!tag && t) return false;
      return true;
    });
  }

  function roomToRejoinProbe(room) {
    if (!room || !room.id) return null;
    return {
      ok: true,
      roomId: room.id,
      name: room.name || room.id,
      status: room.status || 'waiting',
      host: room.host || null,
      local: room.local === true,
      via: room.via || null,
    };
  }

  function isRejoinSnoozed(roomId) {
    if (!roomId) return false;
    const until = state._rejoinSnoozeUntil[roomId];
    return until && Date.now() < until;
  }

  function isOnLobbyScreen() {
    return (
      state.inLobby &&
      currentViewName === 'lobby' &&
      (!el.viewLobby || !el.viewLobby.hidden) &&
      !isInLiveSession()
    );
  }

  function findRejoinProbeFromLobby(rooms) {
    const list = rooms || [];
    const active = loadActivePlay();
    const activeId = active && active.roomId
      ? String(active.roomId).toUpperCase()
      : '';
    pruneLeftRooms(list);

    // 优先：刚刷新记下的房间
    if (activeId) {
      const hit = list.find(
        (r) =>
          r &&
          !r.over &&
          String(r.id || '').toUpperCase() === activeId &&
          (r.status === 'waiting' || r.status === 'playing') &&
          !hasExplicitlyLeft(r.id)
      );
      if (hit) return roomToRejoinProbe(hit);
    }

    for (const room of list) {
      if (!room || room.over) continue;
      if (room.status !== 'playing' && room.status !== 'waiting') continue;
      if (hasExplicitlyLeft(room.id)) continue;
      if (!isSelfInRoomPlayers(room)) continue;
      return roomToRejoinProbe(room);
    }
    return null;
  }

  function maybeOfferRejoinFromLobby(rooms) {
    if (!isOnLobbyScreen()) return;
    if (state._rejoining || remoteRecovering || leavingToLocal) return;
    if (el.rejoinModal && !el.rejoinModal.hidden) return;
    const probe = findRejoinProbeFromLobby(rooms);
    if (!probe) return;
    rememberActivePlay({
      id: probe.roomId,
      status: probe.status || 'waiting',
    });
    // 刷新回房：自动重进，无需手动点确认
    void autoAcceptRejoin(probe);
  }

  function renderLobbyRooms(rooms) {
    const list = rooms || [];
    state.lobbyRooms = list;
    const waiting = list.filter(
      (r) => (!r.status || r.status === 'waiting') && !r.over
    );
    const playing = list.filter((r) => r.status === 'playing' && !r.over);

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
    maybeOfferRejoinFromLobby(list);
    syncTunnelGuestChrome();
    maybeAutoJoinTunnelFromLobby();
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
    const password = askRoomPassword(room);
    if (password == null) return;
    const name =
      state.playerName ||
      (el.playerName && el.playerName.value) ||
      t('app.playerDefault');
    try {
      showRoomBusy('join', '正在观战…');
      await net.enterRoomOnHost(room.id, name, room.host, {
        local: Boolean(room.local),
        mode: 'spectate',
        password,
        hasPassword: Boolean(room.hasPassword),
        sessionId: getTabSessionId(),
        playerTag: window.PlayerNick.ensureTag(),
      });
    } catch (err) {
      hideRoomBusy();
      showToast((err && err.message) || '观战失败');
    }
  }

  function renderMqttBrokerButton() {
    if (!el.btnMqttBroker) return;
    if (!state.mqttBulletin) {
      el.btnMqttBroker.hidden = true;
      return;
    }
    el.btnMqttBroker.hidden = false;
    const name =
      (state.mqttBroker && state.mqttBroker.name) ||
      (state.mqttConnected ? '…' : '—');
    el.btnMqttBroker.textContent = t('lobby.mqttServerBtn', { name });
    el.btnMqttBroker.disabled = Boolean(mqttSwitching);
    el.btnMqttBroker.title = t('lobby.mqttSwitchHint');
  }

  function renderPeers(peers) {
    if (!el.peersLabel) return;
    const list = peers || [];
    const n = list.length;
    const mqttN = list.filter((p) => String(p.via || '').includes('mqtt')).length;
    renderMqttBrokerButton();
    if (state.mqttBulletin && state.mqttConnected === false) {
      el.peersLabel.textContent = state.mqttAllBrokersDown
        ? t('lobby.mqttAllDown')
        : t('lobby.peersMqttDisconnected');
      return;
    }
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

  async function requestMqttReconnect({ silent } = {}) {
    if (!state.mqttBulletin || mqttReconnecting || mqttSwitching) return;
    if (typeof net.reconnectMqtt !== 'function') return;
    mqttReconnecting = true;
    renderMqttBrokerButton();
    if (!silent) showToast(t('lobby.mqttReconnecting'));
    try {
      const result = await net.reconnectMqtt();
      if (result && result.ok) {
        if (!silent) showToast(t('lobby.mqttReconnectOk'));
        requestLobbyRefresh();
      } else if (!silent) {
        showToast((result && result.message) || t('lobby.mqttReconnectFail'));
      }
    } catch (err) {
      if (!silent) showToast(err.message || t('lobby.mqttReconnectFail'));
    } finally {
      mqttReconnecting = false;
      renderMqttBrokerButton();
    }
  }

  async function requestMqttSwitch(brokerId) {
    if (!state.mqttBulletin || mqttSwitching) return;
    if (typeof net.switchMqttBroker !== 'function') return;
    const id = String(brokerId || '').trim();
    if (!id) return;
    if (state.mqttBroker && state.mqttBroker.id === id && state.mqttConnected) {
      setMqttBrokerModalOpen(false);
      showToast(t('lobby.mqttSwitchOk', { name: state.mqttBroker.name || id }));
      return;
    }
    mqttSwitching = true;
    // 本地先清掉非本机条目，等新服务器心跳再填
    clearRemoteLobbyView();
    renderMqttBrokerButton();
    renderMqttBrokerList();
    showToast(t('lobby.mqttSwitching'));
    try {
      const result = await net.switchMqttBroker(id);
      if (result && result.broker) {
        state.mqttBroker = result.broker;
      }
      if (Array.isArray(result && result.brokers)) {
        state.mqttBrokers = result.brokers;
      }
      state.mqttConnected = Boolean(result && result.mqttConnected);
      renderMqttBrokerButton();
      renderMqttBrokerList();
      if (result && result.ok) {
        const name = (result.broker && result.broker.name) || '';
        setMqttBrokerModalOpen(false);
        showToast(t('lobby.mqttSwitchOk', { name }));
        requestLobbyRefresh();
        return;
      }
      window.alert(t('lobby.mqttSwitchFail'));
      if (result && result.restored && result.broker && result.broker.name) {
        showToast(t('lobby.mqttRestored', { name: result.broker.name }));
      }
      requestLobbyRefresh();
    } catch (err) {
      window.alert((err && err.message) || t('lobby.mqttSwitchFail'));
    } finally {
      mqttSwitching = false;
      renderMqttBrokerButton();
      renderMqttBrokerList();
    }
  }

  /** 切换服务器时清空远端大厅视图（保留本机房间/人员） */
  function clearRemoteLobbyView() {
    const localRooms = (state.lobbyRooms || []).filter((r) => r && r.local);
    const localPeople = (state.people || []).filter((p) => p && p.local);
    state.lobbyRooms = localRooms;
    renderLobbyRooms(localRooms);
    renderLobbyPeople(localPeople);
    renderPeers([]);
  }

  function setMqttBrokerModalOpen(open) {
    if (!el.mqttBrokerModal) return;
    el.mqttBrokerModal.hidden = !open;
    if (open) renderMqttBrokerList();
  }

  function renderMqttBrokerList() {
    if (!el.mqttBrokerList) return;
    const list =
      (Array.isArray(state.mqttBrokers) && state.mqttBrokers.length
        ? state.mqttBrokers
        : null) ||
      [
        { id: 'hivemq', name: 'HiveMQ' },
        { id: 'tyckr', name: 'Tyckr' },
        { id: 'dashboard', name: 'Dashboard' },
        { id: 'mosquitto', name: 'Mosquitto' },
        { id: 'shiftr', name: 'Shiftr' },
        { id: 'emqx', name: 'EMQX' },
      ];
    const activeId = (state.mqttBroker && state.mqttBroker.id) || '';
    el.mqttBrokerList.innerHTML = '';
    for (const broker of list) {
      if (!broker || !broker.id) continue;
      const li = document.createElement('li');
      const isActive = broker.id === activeId || broker.active;
      if (isActive) li.classList.add('is-active');
      const info = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.className = 'mqtt-broker-name';
      nameEl.textContent = broker.name || broker.id;
      info.appendChild(nameEl);
      if (isActive) {
        const meta = document.createElement('div');
        meta.className = 'mqtt-broker-meta';
        meta.textContent = t('lobby.mqttCurrent');
        info.appendChild(meta);
      }
      li.appendChild(info);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isActive ? 'secondary' : '';
      btn.textContent = isActive ? t('lobby.mqttCurrent') : t('lobby.mqttUse');
      btn.disabled = Boolean(mqttSwitching) || isActive;
      btn.addEventListener('click', () => {
        requestMqttSwitch(broker.id).catch(() => {});
      });
      li.appendChild(btn);
      el.mqttBrokerList.appendChild(li);
    }
  }

  function scheduleMqttAutoRecover() {
    if (mqttAutoRecoverTimer) return;
    mqttAutoRecoverTimer = setInterval(() => {
      if (!state.inLobby || !state.mqttBulletin || state.mqttConnected) return;
      requestMqttReconnect({ silent: true }).catch(() => {});
    }, 60000);
  }

  function stopMqttAutoRecover() {
    if (!mqttAutoRecoverTimer) return;
    clearInterval(mqttAutoRecoverTimer);
    mqttAutoRecoverTimer = null;
  }

  function peopleStatusText(person) {
    if (person.status === 'offline') return t('lobby.statusOffline');
    if (person.occupied || person.status === 'occupied') {
      return person.roomName ? '代开中 · ' + person.roomName : '代开中';
    }
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

  function isPassiveHostBusy(person) {
    if (!person) return false;
    if (person.occupied || person.status === 'occupied') return true;
    if (!person.passive) return false;
    return (
      person.status === 'room' ||
      person.status === 'playing' ||
      person.status === 'spectating' ||
      Boolean(person.roomId)
    );
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
    else if (!person.passive) createOnHostReason = '对方未开被动模式';
    else if (isPassiveHostBusy(person)) {
      createOnHostReason = '对方主机已被占用，请等待房间结束';
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
      (p) =>
        p.status !== 'offline' &&
        p.status !== 'playing' &&
        p.status !== 'occupied' &&
        !p.occupied
    ).length;
    if (el.lobbyPeopleCount) {
      const total = sorted.length;
      el.lobbyPeopleCount.textContent = total
        ? t('lobby.peopleAvail', { available: availableCount, total })
        : '';
    }

    for (const person of sorted) {
      const li = document.createElement('li');
      li.className = 'people-item';
      li.dataset.playerId = person.id;
      const isMe =
        state.me &&
        (person.id === state.me.id || person.socketId === state.me.id);

      const row1 = document.createElement('div');
      row1.className = 'people-row people-row-main';
      const name = document.createElement('span');
      name.className = 'people-name';
      name.innerHTML =
        nickHtml(person.name, person.tag) +
        (isMe ? ' <span class="you">(' + t('common.you') + ')</span>' : '') +
        (person.occupied || person.status === 'occupied'
          ? ' <span class="badge">代开中</span>'
          : '') +
        remoteBadge(person);
      name.title = window.PlayerNick.fullLabel(person.name, person.tag);
      row1.appendChild(name);

      const row2 = document.createElement('div');
      row2.className = 'people-row people-row-meta';
      const roomStatus = peopleStatusText(person);
      row2.textContent = roomStatus || '';
      row2.title = row2.textContent;

      if (person.status === 'offline') {
        li.classList.add('is-offline');
      }
      li.appendChild(row1);
      li.appendChild(row2);
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
    el.roomPasswordBadge.hidden = !room.hasPassword;

    el.memberList.innerHTML = '';
    const maxSlots = room.maxPlayers || (room.players || []).length || 0;
    const players = room.players || [];
    const isSpectator =
      state.me &&
      (room.observers || []).some(
        (o) => o && String(o.id) === String(state.me.id)
      );
    const isHost =
      state.me &&
      String(room.hostId) === String(state.me.id) &&
      !isSpectator;
    const teamRoom =
      room.gameType === 'lasidao' && room.gameMode === 'h2h';

    function fillRoomSlot(slot, p, teamKey, slotIdx) {
      if (p) {
        if (p.left) slot.classList.add('is-left');
        if (p.isBot) slot.classList.add('is-bot');
        slot.dataset.speakerKey = memberSpeakerKey(p);
        const isMe = state.me && p.id === state.me.id;
        const hostHere = p.id === room.hostId;
        const nick = document.createElement('span');
        nick.className = 'room-slot-nick';
        nick.innerHTML =
          nickHtml(p.name, p.tag) +
          (isMe ? ' <span class="you">(' + t('common.you') + ')</span>' : '') +
          (hostHere ? ' <span class="badge">' + t('room.host') + '</span>' : '') +
          (p.isBot ? ' <span class="badge">' + (p.botDifficultyLabel || t('bot.botPlayer')) + '</span>' : '');
        nick.title = window.PlayerNick.fullLabel(p.name, p.tag);
        const status = document.createElement('span');
        status.className = 'muted room-slot-status';
        if (p.left) status.textContent = t('room.left');
        else if (hostHere) status.textContent = t('room.host');
        else if (p.isBot) status.textContent = t('bot.botPlayer');
        else status.textContent = t('room.seated');
        slot.appendChild(nick);
        slot.appendChild(status);

        if (p.isBot && isHost && room.status !== 'playing') {
          const actions = document.createElement('div');
          actions.className = 'slot-actions';
          const btnRemove = document.createElement('button');
          btnRemove.type = 'button';
          btnRemove.className = 'btn-remove-bot';
          btnRemove.textContent = t('room.removeBot');
          btnRemove.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (net.removeBot) net.removeBot(slotIdx);
          });
          actions.appendChild(btnRemove);
          slot.appendChild(actions);
        }
      } else {
        const empty = document.createElement('span');
        empty.className = 'room-slot-empty';
        empty.textContent = t('room.emptySeat');
        slot.appendChild(empty);

        const gameMeta =
          (state.games || []).find((g) => g && g.id === room.gameType) || null;
        const supportsBot = Boolean(gameMeta && gameMeta.supportsBot);
        if (isHost && room.status !== 'playing' && supportsBot) {
          const actions = document.createElement('div');
          actions.className = 'slot-actions';
          const btnAdd = document.createElement('button');
          btnAdd.type = 'button';
          btnAdd.className = 'btn-add-bot';
          btnAdd.textContent = t('room.addBot');
          btnAdd.addEventListener('click', (ev) => {
            ev.stopPropagation();
            openAddBotModal(slotIdx);
          });
          actions.appendChild(btnAdd);
          slot.appendChild(actions);
        }
      }
      if (teamRoom && isHost && room.status !== 'playing') {
        slot.classList.add('is-team-movable');
        if (p) slot.draggable = true;
        const key = teamKey + ':' + slotIdx;
        if (
          state.roomSeatMoveFrom &&
          state.roomSeatMoveFrom.team === teamKey &&
          Number(state.roomSeatMoveFrom.slot) === slotIdx
        ) {
          slot.classList.add('is-seat-selected');
        }
        slot.addEventListener('dragstart', (ev) => {
          if (!p) {
            ev.preventDefault();
            return;
          }
          state.roomSeatMoveFrom = { team: teamKey, slot: slotIdx };
          try {
            ev.dataTransfer.setData('text/plain', key);
            ev.dataTransfer.effectAllowed = 'move';
          } catch (_) {}
        });
        slot.addEventListener('dragover', (ev) => {
          ev.preventDefault();
          slot.classList.add('is-drag-over');
        });
        slot.addEventListener('dragleave', () => {
          slot.classList.remove('is-drag-over');
        });
        slot.addEventListener('drop', (ev) => {
          ev.preventDefault();
          slot.classList.remove('is-drag-over');
          const from = state.roomSeatMoveFrom;
          state.roomSeatMoveFrom = null;
          if (!from || !net.moveRoomSeat) return;
          net.moveRoomSeat(from, { team: teamKey, slot: slotIdx });
        });
        slot.addEventListener('click', () => {
          if (!state.roomSeatMoveFrom) {
            if (!p) return;
            state.roomSeatMoveFrom = { team: teamKey, slot: slotIdx };
            renderRoom();
            return;
          }
          const from = state.roomSeatMoveFrom;
          state.roomSeatMoveFrom = null;
          if (net.moveRoomSeat) {
            net.moveRoomSeat(from, { team: teamKey, slot: slotIdx });
          } else {
            renderRoom();
          }
        });
      }
    }

    if (teamRoom) {
      el.memberList.classList.add('is-teams');
      const byTeam = { A: [null, null], B: [null, null] };
      for (const p of players) {
        if (!p) continue;
        const team = p.team === 'B' ? 'B' : 'A';
        const idx = Number(p.teamSlot) === 1 ? 1 : 0;
        if (!byTeam[team][idx]) byTeam[team][idx] = p;
        else if (!byTeam[team][0]) byTeam[team][0] = p;
        else if (!byTeam[team][1]) byTeam[team][1] = p;
      }
      for (const team of ['A', 'B']) {
        const group = document.createElement('div');
        group.className = 'room-team room-team-' + team.toLowerCase();
        const title = document.createElement('h4');
        title.className = 'room-team-title';
        title.textContent = t('room.team' + team);
        group.appendChild(title);
        const slotsWrap = document.createElement('div');
        slotsWrap.className = 'room-team-slots';
        for (let i = 0; i < 2; i++) {
          const p = byTeam[team][i];
          const slot = document.createElement('div');
          slot.className = 'room-player-slot' + (p ? '' : ' is-empty');
          fillRoomSlot(slot, p, team, i);
          slotsWrap.appendChild(slot);
        }
        group.appendChild(slotsWrap);
        el.memberList.appendChild(group);
      }
    } else {
      el.memberList.classList.remove('is-teams');
      state.roomSeatMoveFrom = null;
      for (let i = 0; i < maxSlots; i++) {
        const p = players[i];
        const slot = document.createElement('div');
        slot.className = 'room-player-slot' + (p ? '' : ' is-empty');
        fillRoomSlot(slot, p, null, i);
        el.memberList.appendChild(slot);
      }
    }

    const observers = room.observers || [];
    if (el.observerList) el.observerList.innerHTML = '';
    for (const o of observers) {
      if (!el.observerList) break;
      const li = document.createElement('li');
      li.dataset.speakerKey = memberSpeakerKey(o);
      const isMe = state.me && o.id === state.me.id;
      const isPassiveServer = Boolean(o.passiveHost);
      const left = document.createElement('span');
      left.innerHTML =
        nickHtml(o.name, o.tag) +
        (isMe ? ' <span class="you">(我)</span>' : '') +
        (isPassiveServer
          ? ' <span class="badge">' +
            (t('room.passiveServer') || '被动服务器') +
            '</span>'
          : '');
      left.title = window.PlayerNick.fullLabel(o.name, o.tag);
      const right = document.createElement('span');
      right.className = 'muted';
      right.textContent = isPassiveServer
        ? t('room.passiveServer') || '被动服务器'
        : '观战';
      li.appendChild(left);
      li.appendChild(right);
      el.observerList.appendChild(li);
    }
    if (el.observerSection) {
      el.observerSection.hidden = observers.length === 0;
    }
    syncRoomChatBubbles();

    const min = room.minPlayers || 2;
    const need = Number(room.maxPlayers) || min;
    // 仅统计座位玩家，观战席不计入开局人数
    const seated = (room.players || []).filter((p) => !p.left).length;
    el.roomStartHint.textContent = t('room.startHintCount', {
      min,
      cur: seated,
      max: need,
    });
    if (teamRoom && isHost && room.status !== 'playing') {
      el.roomStartHint.textContent += ' ' + t('room.teamMoveHint');
    }

    state.isSpectator = Boolean(isSpectator);
    el.btnStart.hidden = !isHost;
    el.btnStart.disabled = seated < need;
    if (el.btnEditRoom) {
      el.btnEditRoom.hidden = !isHost || room.status === 'playing';
    }
    if (el.btnInviteLobby) {
      el.btnInviteLobby.hidden = !isHost || room.status === 'playing';
    }
    if (el.btnLeave) {
      el.btnLeave.textContent = isHost
        ? '解散房间'
        : isSpectator
          ? '退出观战'
          : t('room.leave');
    }
    if (el.roomBannerHint) {
      el.roomBannerHint.textContent = isSpectator
        ? '观战中'
        : room.status === 'playing'
          ? '对局中'
          : '等待开局';
    }
    kickLasidaoPreload(room);
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

  /** 合并同一帧内多次 game:state，避免主线程被连续全量 render 占满 */
  let renderGameRaf = 0;
  function scheduleRenderGame(immediate) {
    const run = () => {
      (async () => {
        try {
          await ensureGamePanelsReady();
          const game = state.game;
          // 对局中绝不阻塞渲染等卡图；仅后台预热
          if (game && game.type === 'lasidao' && !game.over) {
            kickLasidaoAssetsBackground();
          }
          renderGame();
        } catch (err) {
          console.error(
            'scheduleRenderGame failed:',
            err && err.stack ? err.stack : err
          );
          showToastSafe(t('game.loadFail'), 5000);
          resetGamePanelsState();
          try {
            renderGame();
          } catch (innerErr) {
            console.error(
              'renderGame retry failed:',
              innerErr && innerErr.stack ? innerErr.stack : innerErr
            );
          }
        }
      })();
    };
    if (immediate) {
      if (renderGameRaf) {
        cancelAnimationFrame(renderGameRaf);
        renderGameRaf = 0;
      }
      run();
      return;
    }
    if (renderGameRaf) return;
    renderGameRaf = requestAnimationFrame(() => {
      renderGameRaf = 0;
      run();
    });
  }

  /** 非结算阶段服务端只下发 lastSettle stub，动画中途不要把 slots 冲掉 */
  function mergeIncomingGameState(next) {
    const prev = state.game;
    if (!next || !prev) return next;

    // 隧道乱序：丢弃过期全量包（否则主机会被「仍在等待投掷」盖掉 pulse 里的骰面）
    const prevSeq = Number(prev.stateSeq) || 0;
    const nextSeq = Number(next.stateSeq) || 0;
    if (prevSeq > 0 && nextSeq > 0 && nextSeq < prevSeq) {
      return prev;
    }

    const incoming = next.lastSettle;
    const kept = prev.lastSettle;
    if (
      incoming &&
      kept &&
      incoming.at === kept.at &&
      (!incoming.slots || !incoming.slots.length) &&
      Array.isArray(kept.slots) &&
      kept.slots.length
    ) {
      next.lastSettle = kept;
    }
    // 同一行动者已落骰后，丢弃乱序迟到的「仍在等待投掷」空骰快照。
    // 必须要求 activeProduce.playerId === currentPlayerId，否则 placeDice 推进到下一玩家时
    //（pulse 已改 currentPlayerId，但残留上一玩家骰面）会把新的 awaiting 误判成过期包挡掉。
    if (
      prev.type === 'lasidao' &&
      next.type === 'lasidao' &&
      next.phase === 'produce' &&
      prev.phase === 'produce' &&
      prev.round === next.round &&
      prev.currentPlayerId &&
      prev.currentPlayerId === next.currentPlayerId
    ) {
      const prevDice = Array.isArray(prev.dice) ? prev.dice : [];
      const nextDice = Array.isArray(next.dice) ? next.dice : [];
      const prevActive = prev.activeProduce || null;
      const prevActiveDice =
        prevActive && Array.isArray(prevActive.dice) ? prevActive.dice : [];
      const nextActive = next.activeProduce || null;
      const nextActiveDice =
        nextActive && Array.isArray(nextActive.dice) ? nextActive.dice : [];
      const meId = prev.me && prev.me.id;
      const prevActiveMatches =
        prevActive &&
        prevActive.playerId === prev.currentPlayerId &&
        !prevActive.awaitingRoll &&
        prevActiveDice.length > 0;
      const prevSelfRolled =
        Boolean(meId) &&
        meId === prev.currentPlayerId &&
        !prev.awaitingProduceRoll &&
        prevDice.length > 0;
      const rolledLocally = prevActiveMatches || prevSelfRolled;
      const incomingAwaitingEmpty =
        next.awaitingProduceRoll &&
        nextDice.length === 0 &&
        (!nextActive || nextActive.awaitingRoll || nextActiveDice.length === 0);
      if (rolledLocally && incomingAwaitingEmpty) {
        next.awaitingProduceRoll = false;
        if (prevSelfRolled) {
          next.dice = prevDice.slice();
          next.diceBoosted = Array.isArray(prev.diceBoosted)
            ? prev.diceBoosted.slice()
            : [];
        }
        const ap = prevActive || {};
        const keepDice = (prevActiveDice.length
          ? prevActiveDice
          : prevDice
        ).slice();
        const keepBoost = (
          ap.diceBoosted && ap.diceBoosted.length
            ? ap.diceBoosted
            : next.diceBoosted || prev.diceBoosted || []
        ).slice();
        next.activeProduce = {
          ...(nextActive || {}),
          playerId: prev.currentPlayerId,
          awaitingRoll: false,
          remoteDiceMode: Boolean(ap.remoteDiceMode),
          dice: keepDice,
          diceBoosted: keepBoost,
        };
        if (next.me && prev.me && prevSelfRolled) {
          next.me = {
            ...next.me,
            dice: (prev.me.dice && prev.me.dice.length
              ? prev.me.dice
              : prevDice
            ).slice(),
            awaitingProduceRoll: false,
          };
        }
        if (prevSeq > nextSeq) next.stateSeq = prevSeq;
      }
    }
    return next;
  }

  function applyProducePulseSnapshot(g, data) {
    const meId = g.me && g.me.id;
    const curId = data.currentPlayerId || g.currentPlayerId;
    if (Object.prototype.hasOwnProperty.call(data, 'awaitingProduceRoll')) {
      g.awaitingProduceRoll = Boolean(data.awaitingProduceRoll);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'remoteDiceMode')) {
      g.remoteDiceMode = Boolean(data.remoteDiceMode);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'activeProduce')) {
      g.activeProduce = data.activeProduce
        ? {
            playerId: data.activeProduce.playerId || curId,
            awaitingRoll: Boolean(data.activeProduce.awaitingRoll),
            remoteDiceMode: Boolean(data.activeProduce.remoteDiceMode),
            dice: Array.isArray(data.activeProduce.dice)
              ? data.activeProduce.dice.slice()
              : [],
            diceBoosted: Array.isArray(data.activeProduce.diceBoosted)
              ? data.activeProduce.diceBoosted.slice()
              : [],
          }
        : null;
    }
    const isActor = Boolean(meId && curId && meId === curId);
    // 轮到自己：同步顶层 dice；否则清空自己的生产骰，避免残留上一手
    if (isActor) {
      if (Array.isArray(data.dice)) {
        g.dice = data.dice.slice();
        g.diceBoosted = Array.isArray(data.diceBoosted)
          ? data.diceBoosted.slice()
          : [];
      } else if (
        g.activeProduce &&
        g.activeProduce.playerId === meId &&
        Array.isArray(g.activeProduce.dice)
      ) {
        g.dice = g.activeProduce.dice.slice();
        g.diceBoosted = Array.isArray(g.activeProduce.diceBoosted)
          ? g.activeProduce.diceBoosted.slice()
          : [];
      } else if (g.awaitingProduceRoll) {
        g.dice = [];
        g.diceBoosted = [];
      }
      if (g.me) {
        g.me.awaitingProduceRoll = Boolean(g.awaitingProduceRoll);
        g.me.dice = Array.isArray(g.dice) ? g.dice.slice() : [];
        g.me.remoteDiceMode = Boolean(g.remoteDiceMode);
      }
    } else if (
      Object.prototype.hasOwnProperty.call(data, 'activeProduce') ||
      Object.prototype.hasOwnProperty.call(data, 'awaitingProduceRoll')
    ) {
      // 旁观：自己不应再挂着已结束回合的 dice
      g.dice = [];
      g.diceBoosted = [];
      if (g.me) {
        g.me.dice = [];
        g.me.awaitingProduceRoll = false;
        g.me.remoteDiceMode = false;
      }
    }
  }

  function applyGamePulse(data) {
    if (!data || !state.game) return;
    const g = state.game;
    const pulseSeq = Number(data.stateSeq) || 0;
    const curSeq = Number(g.stateSeq) || 0;
    // 过期 pulse 直接丢（乱序时主机曾被旧包打回 awaiting）
    if (pulseSeq > 0 && curSeq > 0 && pulseSeq < curSeq) return;
    if (pulseSeq > curSeq) g.stateSeq = pulseSeq;

    const prevCurrentId = g.currentPlayerId;
    if (data.phase) g.phase = data.phase;
    if (Object.prototype.hasOwnProperty.call(data, 'currentPlayerId')) {
      g.currentPlayerId = data.currentPlayerId;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'lastPlacerId')) {
      g.lastPlacerId = data.lastPlacerId;
    }
    if (data.fx && data.fx.id) {
      g.lastProduceFx = data.fx;
    }

    if (g.type === 'lasidao' && data.phase === 'produce') {
      applyProducePulseSnapshot(g, data);
      // 回合刚切到自己且服务端要求投掷：强制清残留骰，避免「无 awaiting、无骰面」空白卡死
      const meId = g.me && g.me.id;
      const turnedToMe =
        Boolean(meId) &&
        data.currentPlayerId &&
        data.currentPlayerId === meId &&
        data.currentPlayerId !== prevCurrentId;
      if (turnedToMe && data.awaitingProduceRoll) {
        g.awaitingProduceRoll = true;
        g.dice = [];
        g.diceBoosted = [];
        if (g.me) {
          g.me.awaitingProduceRoll = true;
          g.me.dice = [];
        }
        if (!g.activeProduce || g.activeProduce.playerId !== meId) {
          g.activeProduce = {
            playerId: meId,
            awaitingRoll: true,
            remoteDiceMode: false,
            dice: [],
            diceBoosted: [],
          };
        } else {
          g.activeProduce.awaitingRoll = true;
          g.activeProduce.dice = [];
          g.activeProduce.diceBoosted = [];
        }
      }
    } else if (data.type === 'produceRoll') {
      // 兼容旧 pulse：仅投掷包
      g.awaitingProduceRoll = false;
      const actorId = data.actorId || g.currentPlayerId;
      const meId = g.me && g.me.id;
      const isActor = Boolean(meId && actorId && meId === actorId);
      if (!g.activeProduce) g.activeProduce = {};
      g.activeProduce.playerId = actorId || g.activeProduce.playerId;
      g.activeProduce.awaitingRoll = false;
      g.activeProduce.remoteDiceMode = false;
      if (Array.isArray(data.dice)) {
        if (isActor) {
          g.dice = data.dice.slice();
          g.diceBoosted = Array.isArray(data.diceBoosted)
            ? data.diceBoosted.slice()
            : [];
        }
        g.activeProduce.dice = data.dice.slice();
        g.activeProduce.diceBoosted = Array.isArray(data.diceBoosted)
          ? data.diceBoosted.slice()
          : [];
      }
      if (isActor && g.me) {
        g.me.awaitingProduceRoll = false;
        if (Array.isArray(data.dice)) g.me.dice = data.dice.slice();
      }
    } else if (data.type === 'mercenaryRoll') {
      g.awaitingProduceRoll = false;
      if (g.activeProduce) g.activeProduce.awaitingRoll = false;
      if (!g.mercenary) g.mercenary = {};
      if (Array.isArray(data.mercenaryRoll)) {
        g.mercenary.roll = data.mercenaryRoll.slice();
      }
      if (Array.isArray(data.mercenaryPlaced)) {
        g.mercenary.placed = data.mercenaryPlaced.slice();
      }
    }
    scheduleRenderGame(true);
  }

  function renderGame() {
    const game = state.game;
    if (!game) return;
    updateTurnTimer();
    syncHostingUi();
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
          isSpectator: state.isSpectator,
          selfName: state.me && state.me.name,
          selfTag: state.me && state.me.tag,
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
    const password = askRoomPassword(room);
    if (password == null) return;
    const name = state.playerName || el.playerName.value.trim() || t('app.playerDefault');
    try {
      await joinRoomWithBusy(async () => {
        await net.joinRoomOnHost(room.id, name, room.host, {
          ...lobbyJoinOpts(),
          password,
          hasPassword: Boolean(room.hasPassword),
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

  function hideLasidaoUiFully() {
    if (!window.LasidaoUi) return;
    if (typeof window.LasidaoUi.resetSession === 'function') {
      window.LasidaoUi.resetSession();
      window.LasidaoUi.hide();
    } else {
      window.LasidaoUi.hide({ reset: true });
    }
  }

  async function leaveAndReturnLocal() {
    // 隧道远程操控被动主机：离开房间后留在大厅继续操控，不关页
    if (isTunnelGuest() && (state.canControlPassive || state._hostPassiveMode)) {
      leavingToLocal = true;
      hideRoomBusy();
      hideLasidaoUiFully();
      const rid = (state.room && state.room.id) || state._lastRoomId;
      markSelfRoomLeave(rid);
      clearActivePlay();
      clearGameArchive();
      state.room = null;
      state.game = null;
      state._lastRoomId = null;
      rememberChatRoom(null);
      try {
        net.leaveRoom();
      } catch (_) {}
      showView('lobby');
      showLobbyHome();
      syncTunnelGuestChrome();
      updateMeLabel();
      leavingToLocal = false;
      return;
    }
    if (isTunnelGuest()) {
      exitTunnelGuestPage(t('toast.tunnelGuestBye'));
      return;
    }
    leavingToLocal = true;
    hideRoomBusy();
    hideLasidaoUiFully();
    const rid = (state.room && state.room.id) || state._lastRoomId;
    announceLeaveToHost({ roomId: rid });
    markSelfRoomLeave(rid);
    const joinHome =
      net.getJoinClientHome && net.getJoinClientHome
        ? net.getJoinClientHome()
        : '';
    if (joinHome) {
      try {
        net.leaveRoom();
      } catch (_) {}
      try {
        net.stopAutoReconnect();
      } catch (_) {}
      window.location.href = joinHome;
      return;
    }
    clearActivePlay();
    clearGameArchive();
    net.leaveRoom();
    state.room = null;
    state.game = null;
    state._lastRoomId = null;
    rememberChatRoom(null);
    let navigatedAway = false;
    try {
      navigatedAway = tryNavigateGuestReturn();
      if (navigatedAway) return;
      await net.returnToLocalLobby(state.playerName, lobbyJoinOpts());
      state.inLobby = true;
      showView('lobby');
      showLobbyHome();
      updateMeLabel();
    } catch (err) {
      showToast(err.message || t('toast.backLocalFail'));
    } finally {
      // 已跳回网页端时保持标记，避免跳转完成前被 disconnect/room:left 再次处理
      if (!navigatedAway) leavingToLocal = false;
    }
  }

  /** 房间失效/解散：退出并回到本机大厅 */
  async function bounceToLocalLobby(message, opts = {}) {
    if (isTunnelGuest() && (state.canControlPassive || state._hostPassiveMode)) {
      leavingToLocal = true;
      hideRoomBusy();
      hideLasidaoUiFully();
      markSelfRoomLeave((state.room && state.room.id) || state._lastRoomId);
      cancelRemoteRecover();
      remoteRecovering = false;
      state._rejoining = false;
      if (opts.clearArchive !== false) {
        clearActivePlay();
        clearGameArchive();
      }
      state.room = null;
      state.game = null;
      state._lastRoomId = null;
      rememberChatRoom(null);
      showView('lobby');
      showLobbyHome();
      syncTunnelGuestChrome();
      updateMeLabel();
      if (message) showToast(message);
      leavingToLocal = false;
      return;
    }
    if (isTunnelGuest()) {
      exitTunnelGuestPage(message || t('toast.tunnelGuestBye'));
      return;
    }
    leavingToLocal = true;
    hideRoomBusy();
    hideLasidaoUiFully();
    if (navigateJoinClientHome()) {
      if (message) showToast(message);
      try {
        net.leaveRoom();
      } catch (_) {}
      return;
    }
    const keepPassiveLock = state.passiveMode;
    const clearArchive = opts.clearArchive !== false;
    markSelfRoomLeave((state.room && state.room.id) || state._lastRoomId);
    cancelRemoteRecover();
    remoteRecovering = false;
    state._rejoining = false;
    if (clearArchive) {
      clearActivePlay();
      clearGameArchive();
    }
    state.room = null;
    state.game = null;
    state._lastRoomId = null;
    rememberChatRoom(null);
    try {
      net.leaveRoom();
    } catch (_) {
      /* ignore */
    }
    if (tryNavigateGuestReturn()) {
      return;
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
    if (maybeGuestExitIfNotInRoom()) return;
    el.lobbyGate.hidden = state.inLobby;
    el.lobbyMain.hidden = !state.inLobby;
    if (el.lobbyPeopleAside) {
      el.lobbyPeopleAside.hidden =
        !state.inLobby ||
        (isTunnelGuest() && !state.canControlPassive);
    }
    if (el.hostOccupiedHint) {
      el.hostOccupiedHint.hidden = !state.hostOccupied;
      if (state.hostOccupied) {
        el.hostOccupiedHint.textContent = t('toast.hostOccupied');
      }
    }
    if (el.tunnelGateHint) {
      el.tunnelGateHint.hidden = !(isTunnelGuest() && !state.inLobby);
    }
    syncGuestChrome();
    syncTunnelGuestChrome();
    syncChatVisibility();
    refreshNickUi();
    updateMeLabel();
    if (state.inLobby) startLobbyAutoRefresh();
    else stopLobbyAutoRefresh();
  }

  function formatHostOccupiedText(data) {
    if (data && data.message) return String(data.message);
    const who =
      (data && data.occupant && data.occupant.who) ||
      (data && data.who) ||
      '';
    if (who) {
      const labeled = t('toast.hostOccupiedBy', { who });
      return labeled === 'toast.hostOccupiedBy'
        ? `${t('toast.hostOccupied')}（占用者：${who}）`
        : labeled;
    }
    return t('toast.hostOccupied');
  }

  function applyHostOccupied(data) {
    const message =
      typeof data === 'string' ? data : formatHostOccupiedText(data);
    state.inLobby = false;
    state.hostOccupied = true;
    if (el.hostOccupiedHint) {
      el.hostOccupiedHint.hidden = false;
      el.hostOccupiedHint.textContent = message;
    }
    showLobbyHome();
    showToast(message);
  }

  function clearHostOccupied() {
    state.hostOccupied = false;
    if (el.hostOccupiedHint) el.hostOccupiedHint.hidden = true;
  }

  function applyHostFreed(message) {
    if (!state.hostOccupied) return;
    clearHostOccupied();
    showLobbyHome();
    showToast(message || t('toast.hostFreed'));
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
      let mode = room.gameMode;
      if (room.gameType === 'lasidao' && (mode === 'standard' || mode === 'solo')) {
        mode = 'melee';
      }
      if ([...el.gameMode.options].some((o) => o.value === mode)) {
        el.gameMode.value = mode;
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
    if (el.roomHasPassword) {
      el.roomHasPassword.checked = Boolean(room.hasPassword);
    }
    if (el.roomPassword) {
      // 编辑时不回填真实密码，仅保留勾选态；勾选后可改新密码
      el.roomPassword.value = '';
      el.roomPassword.placeholder = room.hasPassword
        ? '留空则保持原密码'
        : t('create.passwordPlaceholder') || '可为空';
    }
    syncCreatePasswordUi();
    if (el.roomTurnTime && room.turnTimeSec != null) {
      const v = String(Number(room.turnTimeSec) || 0);
      if ([...el.roomTurnTime.options].some((o) => o.value === v)) {
        el.roomTurnTime.value = v;
      }
    }
    if (el.roomAllowTrade) {
      el.roomAllowTrade.checked = Boolean(room.allowTrade);
    }
    if (el.roomConflictDlc) {
      el.roomConflictDlc.checked = room.peacefulDev === false;
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
        if (el.roomHasPassword) el.roomHasPassword.checked = false;
        if (el.roomAllowTrade) el.roomAllowTrade.checked = false;
        if (el.roomConflictDlc) el.roomConflictDlc.checked = false;
        if (el.roomPassword) {
          el.roomPassword.value = '';
          el.roomPassword.placeholder =
            t('create.passwordPlaceholder') || '可为空';
        }
        syncCreatePasswordUi();
      }
    } else {
      state.createModalMode = 'create';
      state._guestBootCreatePassive = false;
      syncCreateModalChrome();
      if (isGuestClient() && !state.room && !state.game && !leavingToLocal) {
        tryNavigateGuestReturn();
      }
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
    if (el.addBotModal) el.addBotModal.hidden = true;
    state.addBotSeatIndex = null;
    state.createModalMode = 'create';
    syncCreateModalChrome();
  }

  function setAddBotOpen(open, seatIndex) {
    if (!el.addBotModal) return;
    el.addBotModal.hidden = !open;
    if (open) {
      state.addBotSeatIndex = seatIndex;
      if (el.addBotSeatLabel) {
        el.addBotSeatLabel.textContent = t('room.botSeatLabel').replace('{seat}', String(Number(seatIndex) + 1));
      }
      if (el.botDifficulty) el.botDifficulty.value = 'hard';
      if (el.createRoomModal) el.createRoomModal.hidden = true;
      if (el.joinCodeModal) el.joinCodeModal.hidden = true;
    } else {
      state.addBotSeatIndex = null;
    }
  }

  function openAddBotModal(seatIndex) {
    const room = state.room;
    const gameMeta =
      room && (state.games || []).find((g) => g && g.id === room.gameType);
    if (!gameMeta || !gameMeta.supportsBot) return;
    setAddBotOpen(true, seatIndex);
  }

  let nickEditing = false;
  let nickEditOriginal = '';

  function setNickEditing(on) {
    if (!el.headerNick || !el.playerNameEdit || !el.nickDisplay) return;
    if (on && !canEditHeaderNick()) return;
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
    if (next !== prev && (state.inLobby || state.room)) {
      if (typeof net.renamePlayer === 'function') {
        net.renamePlayer(next, lobbyJoinOpts());
      } else if (state.inLobby) {
        net.joinLobby(next, lobbyJoinOpts());
      }
      if (state.room) {
        try {
          ensureOwnSeatName(next);
        } catch (_) {}
        try {
          if (!el.viewRoom.hidden) renderRoom();
        } catch (_) {}
      }
      if (!silent) showToast(t('toast.nickUpdated'));
    }
    updateMeLabel();
    return next;
  }

  async function enterLobbyWithName(name, { silent, skipRejoin, skipLobbyHome } = {}) {
    const next = window.PlayerNick.stripBaseName(name) || t('app.playerDefault');
    state.playerName = next;
    saveNick(next);
    if (el.playerName) el.playerName.value = next;
    // 进入大厅前确保本机固定尾缀已生成
    window.PlayerNick.ensureTag();
    state._sessionReclaimed = false;
    state.pendingRejoin = null;

    await net.connect(net.getLocalOrigin());

    // 刷新后优先认领刚才的房间（等待房/对局均可）
    if (!skipRejoin) {
      const active = loadActivePlay();
      if (active && active.roomId && !hasExplicitlyLeft(active.roomId)) {
        try {
          showRoomBusy('join', t('toast.rejoining'));
          state._rejoining = true;
          await net.joinLobbyAndWait(next, {
            ...rejoinLobbyOpts({
              roomId: active.roomId,
              status: active.status,
            }),
            timeoutMs: 8000,
            requireMe: true,
          });
          const ok = await waitForSessionRestore(4500);
          if (ok && isInRestoredGameView()) {
            clearHostOccupied();
            state.inLobby = true;
            showToast(t('toast.rejoined'), 2000);
            return;
          }
          // 认领未成功：再尝试直接进房接上 offline 座位
          try {
            await net.joinRoomAndWait(active.roomId, next, {
              ...lobbyJoinOpts(),
              local: true,
              preferLocal: true,
              timeoutMs: 6000,
            });
            if (state.room) {
              clearHostOccupied();
              state.inLobby = true;
              if (state.room.status === 'playing') {
                showView('game');
                scheduleRenderGame(true);
              } else {
                showView('room');
                renderRoom();
              }
              showToast(t('toast.rejoined'), 2000);
              return;
            }
          } catch (_) {
            /* 回落到普通进大厅 */
          }
        } catch (err) {
          if (err && err.code === 'HOST_OCCUPIED') {
            applyHostOccupied(err);
            throw err;
          }
        } finally {
          state._rejoining = false;
          hideRoomBusy();
        }
      }
    }

    // 须等 lobby:join 结果：占用锁拒绝时不能乐观进大厅
    try {
      await net.joinLobbyAndWait(next, {
        ...lobbyJoinOpts(),
        timeoutMs: 10000,
        requireMe: true,
      });
    } catch (err) {
      if (err && err.code === 'HOST_OCCUPIED') {
        applyHostOccupied(err);
      }
      throw err;
    }
    clearHostOccupied();
    state.inLobby = true;
    setCreatePanelOpen(false);
    setJoinPanelOpen(false);
    if (!skipLobbyHome) {
      if (!silent) refreshNickUi();
      showLobbyHome();
      if (!skipRejoin) await maybeOfferRejoin();
    }
  }

  const REJOIN_COUNTDOWN_SEC = 3;
  let rejoinCountdownTimer = null;
  let rejoinCountdownLeft = 0;

  function rejoinAcceptLabel(seconds) {
    const base = t('rejoin.accept');
    if (seconds == null || seconds <= 0) return base;
    const labeled = t('rejoin.acceptCountdown', { n: seconds });
    return labeled === 'rejoin.acceptCountdown' ? `${base}（${seconds}）` : labeled;
  }

  function stopRejoinCountdown() {
    if (rejoinCountdownTimer) {
      clearInterval(rejoinCountdownTimer);
      rejoinCountdownTimer = null;
    }
    rejoinCountdownLeft = 0;
    if (el.btnAcceptRejoin) el.btnAcceptRejoin.textContent = t('rejoin.accept');
  }

  function startRejoinCountdown() {
    stopRejoinCountdown();
    rejoinCountdownLeft = REJOIN_COUNTDOWN_SEC;
    if (el.btnAcceptRejoin) {
      el.btnAcceptRejoin.textContent = rejoinAcceptLabel(rejoinCountdownLeft);
    }
    rejoinCountdownTimer = setInterval(() => {
      rejoinCountdownLeft -= 1;
      if (rejoinCountdownLeft <= 0) {
        stopRejoinCountdown();
        acceptPendingRejoin().catch((err) => {
          showToast((err && err.message) || t('toast.rejoinFail'));
        });
        return;
      }
      if (el.btnAcceptRejoin) {
        el.btnAcceptRejoin.textContent = rejoinAcceptLabel(rejoinCountdownLeft);
      }
    }, 1000);
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
      startRejoinCountdown();
    } else {
      stopRejoinCountdown();
      state.pendingRejoin = null;
      el.rejoinModal.hidden = true;
    }
  }

  async function maybeOfferRejoin() {
    // 以大厅心跳里是否含自己为准；等一拍让 MQTT/大厅列表先到
    await new Promise((r) => setTimeout(r, 400));
    if (isInRestoredGameView() || state._rejoining) return;
    maybeOfferRejoinFromLobby(state.lobbyRooms);
    // 列表里还没有时：用 activePlay 直接探测并回房
    if (!isInRestoredGameView() && !state._rejoining) {
      await tryAutoRejoinFromActivePlay();
    }
  }

  async function tryAutoRejoinFromActivePlay() {
    if (state._rejoining || remoteRecovering || leavingToLocal) return false;
    if (isInRestoredGameView()) return false;
    const active = loadActivePlay();
    if (!active || !active.roomId) return false;
    if (hasExplicitlyLeft(active.roomId)) {
      clearActivePlay();
      return false;
    }
    const roomId = String(active.roomId).toUpperCase();
    let probe = {
      ok: true,
      roomId,
      name: roomId,
      status: active.status || 'waiting',
      host: null,
      local: true,
    };
    try {
      if (typeof net.probeRoom === 'function') {
        const result = await net.probeRoom(roomId);
        if (result && result.ok) {
          probe = {
            ok: true,
            roomId: result.roomId || roomId,
            name: result.name || roomId,
            status: result.status || active.status || 'waiting',
            host: result.host || null,
            local: result.local === true,
            via: result.via || null,
          };
        } else if (result && result.ok === false) {
          clearActivePlay();
          return false;
        }
      }
    } catch (_) {
      /* 探测失败仍尝试本机认领 */
    }
    await autoAcceptRejoin(probe);
    return isInRestoredGameView();
  }

  async function autoAcceptRejoin(probe) {
    if (!probe || !probe.roomId) return;
    if (state._rejoining || remoteRecovering || leavingToLocal) return;
    if (isInRestoredGameView()) return;
    state.pendingRejoin = probe;
    if (el.rejoinModal) el.rejoinModal.hidden = true;
    stopRejoinCountdown();
    showRoomBusy('join', t('toast.rejoining'));
    try {
      await acceptPendingRejoin();
    } finally {
      hideRoomBusy();
    }
  }

  async function acceptPendingRejoin() {
    if (state._rejoining) return;
    const probe = state.pendingRejoin;
    setRejoinModalOpen(false);
    if (!probe || !probe.roomId) return;
    clearExplicitLeave(probe.roomId);

    const name = state.playerName || t('app.playerDefault');
    const opts = rejoinLobbyOpts(probe);
    if (!opts.roomId) {
      showToast(t('toast.needSeat'));
      return;
    }

    showToast(t('toast.rejoining'));
    state._sessionReclaimed = false;
    state._rejoining = true;
    try {
      if (typeof net.stopAutoReconnect === 'function') net.stopAutoReconnect();
      const host = probe.host || null;
      const isLocal = probe.local === true || !host;
      const roomId = probe.roomId;

      if (isLocal) {
        await net.connectAny([net.getLocalOrigin()], { retriesPerHost: 3 });
        await net.joinLobbyAndWait(name, {
          ...opts,
          timeoutMs: 8000,
          requireMe: true,
        });
      } else {
        await net.joinRoomOnHost(roomId, name, host, {
          ...opts,
          local: false,
          preferLocal: false,
        });
      }

      let ok = await waitForSessionRestore(5000);
      if (!ok || !isInRestoredGameView()) {
        // 认领未立刻切页：等待房可再走一次进房（会接上 offline 座位）
        try {
          await net.joinRoomAndWait(roomId, name, {
            ...lobbyJoinOpts(),
            local: isLocal,
            preferLocal: isLocal,
            sessionId: opts.sessionId,
            playerTag: opts.playerTag,
            timeoutMs: 8000,
          });
          ok = isInRestoredGameView() || Boolean(state.room);
        } catch (_) {
          /* ignore */
        }
      }
      if (ok && (isInRestoredGameView() || state.room)) {
        if (state.room && state.room.status === 'playing') {
          showView('game');
          scheduleRenderGame(true);
        } else if (state.room) {
          showView('room');
          renderRoom();
        }
        showToast(t('toast.rejoined'), 2000);
        if (probe.roomId && state._rejoinSnoozeUntil[probe.roomId]) {
          delete state._rejoinSnoozeUntil[probe.roomId];
        }
        return;
      }
      showToast(t('toast.rejoinSeatFail'));
      if (net.isOnRemoteHost()) {
        await net.returnToLocalLobby(name, lobbyJoinOpts());
      }
      showLobbyHome();
    } catch (err) {
      showToast(err.message || t('toast.rejoinFail'));
      if (net.isOnRemoteHost()) {
        try {
          await net.returnToLocalLobby(name, lobbyJoinOpts());
        } catch (_) {
          /* ignore */
        }
      }
      showLobbyHome();
    } finally {
      state._rejoining = false;
    }
  }

  function declinePendingRejoin() {
    const probe = state.pendingRejoin;
    setRejoinModalOpen(false);
    if (probe && probe.roomId) {
      announceLeaveToHost(probe);
      clearActivePlay();
      clearGameArchive();
    }
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
    const name = (el.playerName.value || '').trim();
    if (!name) {
      showToast(t('lobby.nickPlaceholder') || '请输入昵称');
      try {
        el.playerName.focus();
      } catch (_) {}
      return;
    }
    try {
      if (isTunnelGuest() || detectPageAccess() === 'tunnel') {
        await enterTunnelGuestToRoom(name);
        return;
      }
      await enterLobbyWithName(name);
    } catch (err) {
      if (err && err.code === 'HOST_OCCUPIED') return;
      if (err && err.message === '需要昵称') return;
      showToast(err.message || t('toast.localFail'));
    }
  });

  el.playerName.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') el.btnEnterLobby.click();
  });

  if (el.btnEditName) {
    el.btnEditName.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!canEditHeaderNick()) return;
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
      if (isGuestClient() || (isTunnelGuest() && state.canControlPassive)) {
        // 加入端 / 隧道操控被动主机：代开本机
        state.createOnHostTarget = {
          passive: true,
          alreadyOnHost: true,
          host: null,
        };
        setCreatePanelOpen(el.createRoomModal.hidden, 'create-on-host');
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
        const ok = window.confirm(
          '开启被动模式后，本机将锁定无人值守；可分享隧道地址，他人可操控本机开房、观战与聊天；对局进行中无法退出。确定开启吗？'
        );
        if (!ok) {
          el.chkPassiveMode.checked = false;
          return;
        }
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
  if (el.btnCopyPassiveUrl) {
    el.btnCopyPassiveUrl.addEventListener('click', async () => {
      const url = state.passivePublicUrl || '';
      if (!url) {
        showToast(t('toast.unavailable') || '当前不可用');
        return;
      }
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
          ok = true;
        }
      } catch (_) {
        ok = false;
      }
      if (!ok) {
        try {
          const input =
            el.passiveShareUrl &&
            el.passiveShareUrl.querySelector('input');
          if (input) {
            input.focus();
            input.select();
            ok = document.execCommand('copy');
          }
        } catch (_) {
          ok = false;
        }
      }
      showToast(
        ok
          ? t('toast.passiveUrlCopied') !== 'toast.passiveUrlCopied'
            ? t('toast.passiveUrlCopied')
            : '隧道地址已复制'
          : url
      );
    });
  }
  if (el.btnCloseJoin) {
    el.btnCloseJoin.addEventListener('click', () => setJoinPanelOpen(false));
  }
  if (el.btnCloseAddBot) {
    el.btnCloseAddBot.addEventListener('click', () => setAddBotOpen(false));
  }
  if (el.btnConfirmAddBot) {
    el.btnConfirmAddBot.addEventListener('click', () => {
      const seatIndex = state.addBotSeatIndex;
      const difficulty = el.botDifficulty ? el.botDifficulty.value : 'hard';
      if (seatIndex != null && net.addBot) {
        net.addBot(seatIndex, difficulty);
      }
      setAddBotOpen(false);
    });
  }
  if (el.addBotModal) {
    el.addBotModal.addEventListener('click', (ev) => {
      const close = ev.target.closest('[data-close="add-bot"]');
      if (close) setAddBotOpen(false);
    });
  }
  if (el.btnRefreshDoc) {
    el.btnRefreshDoc.addEventListener('click', () => {
      requestLobbyRefresh();
      showToast(t('lobby.refreshingPeople'));
    });
  }
  if (el.btnMqttBroker) {
    el.btnMqttBroker.addEventListener('click', () => {
      if (!state.mqttBulletin || mqttSwitching) return;
      setMqttBrokerModalOpen(true);
    });
  }
  document.querySelectorAll('[data-close="mqtt-broker"]').forEach((node) => {
    node.addEventListener('click', () => setMqttBrokerModalOpen(false));
  });

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
      return;
    }
    if (el.mqttBrokerModal && !el.mqttBrokerModal.hidden) {
      setMqttBrokerModalOpen(false);
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
      setChatInputFocused(true);
      holdChatDockFocus();
    });
    el.chatInput.addEventListener('blur', (ev) => {
      if (chatDockDragging) return;
      setChatInputFocused(false);
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
      if (isMobileChatUi()) {
        setTimeout(() => {
          if (!el.chatDock || el.chatDock.hidden) return;
          const ae = document.activeElement;
          if (ae && el.chatDock.contains(ae)) return;
          setChatDockActive(false);
        }, 120);
        return;
      }
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
        const theirRoom = (state.lobbyRooms || []).find(
          (r) => String(r.id).toUpperCase() === String(target.roomId).toUpperCase()
        );
        const name = state.playerName || t('app.playerDefault');
        const room = theirRoom || {
          id: target.roomId,
          host: target.host,
          local: target.local === true,
          hasPassword: false,
        };
        const password = askRoomPassword(room);
        if (password == null) return;
        try {
          await joinRoomWithBusy(async () => {
            await net.joinRoomOnHost(room.id, name, room.host, {
              ...lobbyJoinOpts(),
              password,
              hasPassword: Boolean(room.hasPassword),
              local: room.local === true,
              preferLocal: room.local === true,
            });
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
      ...createPasswordPayload(),
      gameType: el.gameType.value || 'lasidao',
      gameMode: el.gameMode ? el.gameMode.value : undefined,
      maxPlayers: g ? Number(el.roomMax.value) || g.maxPlayers : 2,
      turnTimeSec: el.roomTurnTime
        ? Number(el.roomTurnTime.value) || 0
        : 0,
      allowTrade: Boolean(el.roomAllowTrade && el.roomAllowTrade.checked),
      peacefulDev: !(el.roomConflictDlc && el.roomConflictDlc.checked),
    };

    if (state.createModalMode === 'edit') {
      if (
        !state.room ||
        !state.me ||
        String(state.room.hostId) !== String(state.me.id)
      ) {
        showToast(t('toast.updateRoomFail'));
        return;
      }
      try {
        if (typeof net.updateRoomSettings !== 'function') {
          showToast(t('toast.updateRoomFail'));
          return;
        }
        // 编辑勾选密码但输入为空：若原本有密码则保持原密码（服务端 password==null 不改）
        if (
          payload.hasPassword &&
          !String(payload.password || '') &&
          state.room.hasPassword
        ) {
          delete payload.password;
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
        state._guestBootCreatePassive = false;
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
        if (isGuestClient()) tryNavigateGuestReturn();
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
    const password = String((el.joinPassword && el.joinPassword.value) || '');
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
            password,
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

  if (el.roomHasPassword) {
    el.roomHasPassword.addEventListener('change', syncCreatePasswordUi);
  }
  syncCreatePasswordUi();

  el.btnStart.addEventListener('click', () => net.startGame());
  if (el.btnInviteLobby) {
    el.btnInviteLobby.addEventListener('click', () => {
      net.inviteLobby();
      showToast(t('room.inviteSent') || '邀请已发送');
    });
  }
  if (el.btnEditRoom) {
    el.btnEditRoom.addEventListener('click', () => {
      if (
        !state.room ||
        !state.me ||
        String(state.room.hostId) !== String(state.me.id)
      ) {
        return;
      }
      if (state.room.status === 'playing') return;
      setCreatePanelOpen(true, 'edit');
    });
  }
  if (el.btnMenuGameRules) {
    el.btnMenuGameRules.addEventListener('click', () => {
      closeGameMenu();
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
  if (el.btnSpectators) {
    el.btnSpectators.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleSpectatorsPop();
    });
  }
  if (el.btnSpectatorsClose) {
    el.btnSpectatorsClose.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeSpectatorsPop();
    });
  }
  if (el.btnHosting) {
    el.btnHosting.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!net.setHosted) return;
      const gameMeta =
        (state.games || []).find(
          (g) =>
            g &&
            g.id ===
              ((state.game && state.game.type) ||
                (state.room && state.room.gameType))
        ) || null;
      if (!gameMeta || !gameMeta.supportsHosting) return;
      net.setHosted(!isSelfHosted());
    });
  }
  if (el.spectatorsPop) {
    el.spectatorsPop.addEventListener('click', (ev) => ev.stopPropagation());
  }
  if (el.btnQuitGame) {
    el.btnQuitGame.addEventListener('click', () => {
      closeGameMenu();
      if (state.isSpectator) {
        leaveAndReturnLocal();
        return;
      }
      announceLeaveToHost({
        roomId: (state.room && state.room.id) || state._lastRoomId,
      });
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
  if (el.btnMenuInviteBlock) {
    el.btnMenuInviteBlock.addEventListener('click', () => {
      closeGameMenu();
      if (isBlockingInvites()) {
        blockInvitesUntil = 0;
        try {
          localStorage.removeItem(BLOCK_INVITES_KEY);
        } catch (_) {}
        syncInviteBlockMenuItem();
        showToast(t('invite.blockAllOff') || '已恢复接收房间邀请');
      } else {
        blockAllInvites();
      }
    });
  }
  if (el.btnMenuCheckUpdate) {
    el.btnMenuCheckUpdate.addEventListener('click', () => {
      closeGameMenu();
      checkHostUpdate({ manual: true }).catch((err) => {
        showToast((err && err.message) || t('update.checkFail'));
      });
    });
  }
  if (el.btnHostUpdateApply) {
    el.btnHostUpdateApply.addEventListener('click', () => {
      applyHostUpdate().catch((err) => {
        showToast((err && err.message) || t('update.applyFail'));
      });
    });
  }
  if (el.btnHostUpdateLater) {
    el.btnHostUpdateLater.addEventListener('click', () => {
      dismissHostUpdateModal();
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
    if (el.gameMenu && !el.gameMenu.contains(ev.target)) {
      closeGameMenu();
    }
    if (
      el.spectatorsWatch &&
      !el.spectatorsWatch.contains(ev.target)
    ) {
      closeSpectatorsPop();
    }
  });

  function refreshAfterLangChange() {
    if (I18n && I18n.applyDom) I18n.applyDom(document);
    syncLangMenuActive();
    syncQuitMenuItem();
    syncGameRulesMenuItem();
    syncInviteBlockMenuItem();
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
  syncGameRulesMenuItem();
  syncInviteBlockMenuItem();
  if (el.roomTurnTime) {
    for (const opt of el.roomTurnTime.options) {
      const v = Number(opt.value);
      if (v === 0) opt.textContent = t('create.turnUnlimited');
      else opt.textContent = t('create.turnSec', { n: v });
    }
  }

  net.on('player:me', (data) => {
    const prevId = state.me && state.me.id;
    state.me = data;
    if (data && data.access) state.access = String(data.access);
    else if (!state.access) state.access = detectPageAccess();
    if (data && data.name) {
      const incoming = window.PlayerNick.stripBaseName(data.name) || '';
      const local = window.PlayerNick.stripBaseName(state.playerName || '');
      const isDefault =
        !incoming ||
        incoming === '玩家' ||
        incoming === 'Player' ||
        incoming === t('app.playerDefault');
      if (incoming && !isDefault) {
        state.playerName = incoming;
        saveNick(incoming);
      } else if (local && local !== '玩家' && local !== 'Player') {
        // 服务端落到默认名时，保留本地自定义昵称并回写
        state.playerName = local;
        try {
          if (state.inLobby || state.room) {
            net.renamePlayer(local, lobbyJoinOpts());
          }
        } catch (_) {}
      } else if (incoming) {
        state.playerName = incoming;
        saveNick(incoming);
      }
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
    if (data && Object.prototype.hasOwnProperty.call(data, 'canControlPassive')) {
      state.canControlPassive = Boolean(data.canControlPassive);
    }
    if (data && Object.prototype.hasOwnProperty.call(data, 'controllingPassive')) {
      state.canControlPassive = Boolean(
        data.controllingPassive || data.canControlPassive
      );
    }
    if (data && Object.prototype.hasOwnProperty.call(data, 'passiveController')) {
      state.passiveController = data.passiveController || null;
    }
    if (data && data.publicUrl) {
      state.passivePublicUrl = String(data.publicUrl);
    }
    if (data && Object.prototype.hasOwnProperty.call(data, 'passiveMode')) {
      if (isTunnelGuest()) {
        state._hostPassiveMode = Boolean(data.passiveMode);
      }
    }
    const archiveRoomId =
      (state.room && state.room.id) ||
      state._lastRoomId ||
      (loadGameArchive() && loadGameArchive().roomId) ||
      null;
    if (archiveRoomId && data && data.id && (state.room || state._sessionReclaimed)) {
      rememberGameArchive({
        roomId: archiveRoomId,
        seatId: data.id,
        phase: (state.room && state.room.status) || null,
      });
    }
    refreshNickUi();
    updateMeLabel();
    syncTunnelGuestChrome();
    applyTunnelGateLabels();
    if (state.passiveMode) syncPassiveExitButton();
    // room:update 可能早于 player:me：身份对齐后立刻刷新房主按钮
    if (state.room && data && data.id && data.id !== prevId) {
      if (state.room.status === 'playing') {
        if (state.game) renderGame();
      } else {
        renderRoom();
      }
    }
  });

  net.on('lobby:passiveProgress', (data) => {
    const msg =
      (data && data.message) || '正在进入被动模式…';
    if (state.roomBusy === 'passive') updateRoomBusyMessage(msg);
    else showRoomBusy('passive', msg);
  });

  net.on('lobby:passiveControl', (data) => {
    state.passiveController = (data && data.controller) || null;
    if (data && data.publicUrl) {
      state.passivePublicUrl = String(data.publicUrl);
    }
    if (data && Object.prototype.hasOwnProperty.call(data, 'passiveMode')) {
      if (isTunnelGuest()) {
        state._hostPassiveMode = Boolean(data.passiveMode);
      }
    }
    if (state.passiveMode) syncPassiveExitButton();
    syncTunnelGuestChrome();
  });

  net.on('lobby:passive', (data) => {
    const on = Boolean(data && data.passive);
    if (state.roomBusy === 'passive') hideRoomBusy();
    if (data && data.publicUrl) {
      state.passivePublicUrl = String(data.publicUrl);
    } else if (!on) {
      state.passivePublicUrl = '';
    }
    if (Object.prototype.hasOwnProperty.call(data || {}, 'controller')) {
      state.passiveController = data.controller || null;
    }
    applyPassiveLockUi(on);
    if (el.chkPassiveMode) el.chkPassiveMode.checked = on;
    syncPassiveShareUrl(data && data.publicUrl);
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
    if (data && Object.prototype.hasOwnProperty.call(data, 'mqttConnected')) {
      state.mqttConnected = Boolean(data.mqttConnected);
    }
    if (data && data.mqttBroker) {
      state.mqttBroker = data.mqttBroker;
    }
    if (data && Array.isArray(data.mqttBrokers)) {
      state.mqttBrokers = data.mqttBrokers;
    }
    if (data && Object.prototype.hasOwnProperty.call(data, 'passiveMode')) {
      if (isTunnelGuest()) {
        state._hostPassiveMode = Boolean(data.passiveMode);
      }
    }
    if (data && Object.prototype.hasOwnProperty.call(data, 'passiveController')) {
      state.passiveController = data.passiveController || null;
      if (state.passiveMode) syncPassiveExitButton();
    }
    if (data && data.publicUrl) {
      state.passivePublicUrl = String(data.publicUrl);
      if (state.passiveMode) syncPassiveShareUrl(data.publicUrl);
    }
    if (data && Object.prototype.hasOwnProperty.call(data, 'mqttAllBrokersDown')) {
      state.mqttAllBrokersDown = Boolean(data.mqttAllBrokersDown);
      if (state.mqttAllBrokersDown) {
        if (!mqttAllDownAlerted && state.inLobby) {
          mqttAllDownAlerted = true;
          window.alert(
            data.mqttAllBrokersDownMessage || t('lobby.mqttAllDown')
          );
        }
      } else {
        mqttAllDownAlerted = false;
      }
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
    // 兜底：服务端已被动成功时，即使仍卡在「正在进入」也立刻切到锁定层
    if (el.chkPassiveMode && state.me) {
      const mePerson = (data.people || []).find(
        (p) => p.id === state.me.id || p.socketId === state.me.id
      );
      if (mePerson) {
        if (mePerson.passive) {
          if (state.roomBusy === 'passive') hideRoomBusy();
          applyPassiveLockUi(true);
        } else if (state.roomBusy !== 'passive') {
          applyPassiveLockUi(false);
        }
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

  net.on('lobby:invite', (data) => {
    if (!data || !data.roomId) return;
    // 仅在大厅（未进房、未对局）时显示邀请弹窗
    if (state.game || state.room) return;
    if (isBlockingInvites()) return;
    showInviteToast(data);
  });

  net.on('room:creating', (data) => {
    if (state.roomBusy !== 'create') return;
    updateRoomBusyMessage((data && data.message) || t('create.creating'));
  });

  net.on('room:update', (data) => {
    cancelRemoteRecover();
    hideRoomBusy();
    state._guestBootJoining = false;
    state._guestBootCreatePassive = false;
    // 被动主机进房后仍保持锁定（无人值守）；不在此解除
    if (state.passiveMode) applyPassiveLockUi(true);
    const prevRoomId = state._lastRoomId;
    const prev = state.room;
    state.room = data.room;
    if (data.room && data.room.id) clearExplicitLeave(data.room.id);
    // 隧道进房后若座位名被打成默认「玩家」，用本地已设昵称立刻纠正并回写
    if (
      isTunnelGuest() &&
      state.room &&
      state.playerName &&
      !isDefaultNick(state.playerName)
    ) {
      const meId = state.me && state.me.id;
      const seat =
        meId &&
        (state.room.players || []).find(
          (p) => p && String(p.id) === String(meId)
        );
      if (seat && isDefaultNick(seat.name)) {
        ensureOwnSeatName(state.playerName);
        try {
          net.renamePlayer(state.playerName, lobbyJoinOpts());
        } catch (_) {}
      }
    }
    syncPassiveExitButton();
    syncSpectatorsWatchUi();
    const keepEdit =
      state.createModalMode === 'edit' &&
      el.createRoomModal &&
      !el.createRoomModal.hidden &&
      data.room &&
      data.room.status === 'waiting';
    if (!keepEdit) closeAllModals();
    if (data.room.status === 'playing') {
      rememberActivePlay(data.room);
      state.isSpectator = Boolean(
        state.me &&
          (data.room.observers || []).some((o) => o.id === state.me.id)
      );
      const enterPlaying = () => {
        ensureGamePanelsReady()
          .then(() => {
            showView('game');
            if (state.game) renderGame();
          })
          .catch((err) => {
            console.warn('game panels load failed', err);
            resetGamePanelsState();
            showToastSafe(t('game.loadFail'), 5000);
            showView('game');
            if (state.game) {
              try {
                renderGame();
              } catch (_) {}
            }
          });
      };
      if (data.room.gameType === 'lasidao') {
        ensureLasidaoAssetsReady().then(enterPlaying).catch(enterPlaying);
      } else {
        enterPlaying();
      }
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
          Boolean(prev.hasPassword) !== Boolean(data.room.hasPassword) ||
          Number(prev.turnTimeSec) !== Number(data.room.turnTimeSec);
        if (gameChanged) fillCreateFormFromRoom(data.room);
      }
      if (data.room.id && data.room.id !== prevRoomId) {
        showToast(t('room.enteredNamed', { name: data.room.name || data.room.id }), 2000);
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

  net.on('session:reclaimed', async (data) => {
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
    }
    if (data && data.playing) {
      if (state.room && state.room.gameType === 'lasidao') {
        await ensureLasidaoAssetsReady();
      }
      showView('game');
    } else if (data && data.roomId) {
      showView('room');
      if (state.room) renderRoom();
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
      if (state.game && state.game.over) {
        state.room = null;
        state._lastRoomId = null;
        clearActivePlay();
        clearGameArchive();
        return;
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

  net.on('room:spectatorJoined', (data) => {
    if (!data || !state.room) return;
    if (state.me && data.id && data.id === state.me.id) return;
    const observers = Array.isArray(state.room.observers)
      ? state.room.observers.slice()
      : [];
    if (data.id && !observers.some((o) => o && o.id === data.id)) {
      observers.push({
        id: data.id,
        name: data.name || t('app.playerDefault'),
        tag: data.tag || null,
      });
      state.room = { ...state.room, observers };
    }
    syncSpectatorsWatchUi();
    const name = window.PlayerNick.fullLabel(
      data.name || t('app.playerDefault'),
      data.tag || ''
    );
    showToast(t('app.spectatorJoined', { name }), 0, {
      large: Boolean(state.room && state.room.status === 'playing'),
    });
  });

  net.on('room:spectatorLeft', (data) => {
    if (!data) return;
    if (state.room) {
      const observers = (state.room.observers || []).filter(
        (o) => o && o.id !== data.id
      );
      state.room = { ...state.room, observers };
    }
    syncSpectatorsWatchUi();
    if (state.me && data.id && data.id === state.me.id) return;
    const name = window.PlayerNick.fullLabel(
      data.name || t('app.playerDefault'),
      data.tag || ''
    );
    showToast(t('app.spectatorLeft', { name }), 3000);
  });

  net.on('room:error', (data) => {
    if (state._guestBootJoining) return;
    hideRoomBusy();
    state._guestBootCreatePassive = false;
    showToast(data.message || t('toast.roomError'));
    if (isGuestClient() && !state.room && !state.game) {
      // 留一点时间看清错误，再跳回客户端大厅
      setTimeout(() => {
        if (!state.room && !state.game) tryNavigateGuestReturn();
      }, 1600);
    }
  });
  net.on('room:settingsUpdated', () => {
    closeAllModals();
    showToast(t('toast.roomUpdated'));
  });
  net.on('game:started', async (data) => {
    if (leavingToLocal) return;
    state.game = data.state;
    if (data && data.spectator) state.isSpectator = true;
    if (data && data.state && data.state.over) {
      clearActivePlay();
    } else if (state.room) {
      rememberActivePlay(state.room);
    } else if (state._lastRoomId) {
      rememberActivePlay({ id: state._lastRoomId, status: 'playing' });
    }
    const roomId = state.room && state.room.id ? state.room.id : state._lastRoomId;
    const seatId = data && data.state && data.state.me ? data.state.me.id : null;
    rememberGameArchive({
      roomId,
      seatId,
      phase: data && data.state ? data.state.phase : null,
    });
    // 被动无人值守：对局结束也保留状态，让用户看完胜利弹窗
    if (state.passiveMode && data && data.state && data.state.over) {
      applyPassiveLockUi(true);
      syncPassiveExitButton();
      showView('game');
      scheduleRenderGame(true);
      return;
    }
    if (
      data &&
      data.state &&
      data.state.type === 'lasidao' &&
      !data.state.over
    ) {
      await ensureLasidaoAssetsReady();
    }
    if (state.passiveMode) applyPassiveLockUi(true);
    showView('game');
    scheduleRenderGame(true);
    maybeGuestExitAfterGameOver(data && data.state);
  });
  net.on('game:state', async (data) => {
    if (leavingToLocal) return;
    state.game = mergeIncomingGameState(data.state);
    if (data && data.spectator) state.isSpectator = true;
    if (data && data.state && data.state.over) {
      clearActivePlay();
    } else if (state.room) {
      rememberActivePlay(state.room);
    } else if (state._lastRoomId) {
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
      applyPassiveLockUi(true);
      syncPassiveExitButton();
      showView('game');
      syncSpectatorsWatchUi();
      scheduleRenderGame(true);
      return;
    }
    const firstLasidaoFrame =
      data &&
      data.state &&
      data.state.type === 'lasidao' &&
      !data.state.over &&
      el.viewGame &&
      el.viewGame.hidden;
    if (firstLasidaoFrame) {
      await ensureLasidaoAssetsReady();
    }
    if (state.passiveMode) applyPassiveLockUi(true);
    syncPassiveExitButton();
    showView('game');
    syncSpectatorsWatchUi();
    scheduleRenderGame();
    maybeGuestExitAfterGameOver(data && data.state);
  });
  net.on('game:pulse', (data) => {
    applyGamePulse(data);
  });
  net.on('game:play-reveal', (data) => {
    if (
      state.game &&
      state.game.type === 'lasidao' &&
      window.LasidaoUi &&
      typeof window.LasidaoUi.onPlayReveal === 'function'
    ) {
      window.LasidaoUi.onPlayReveal(data);
    }
  });
  net.on('game:error', (data) => {
    showToast(data.message || t('toast.opFail'));
    if (
      window.LasidaoUi &&
      typeof window.LasidaoUi.onGameError === 'function'
    ) {
      window.LasidaoUi.onGameError(data);
    }
  });
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
    }
    scheduleRenderGame();
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

  function reloadMessageTargetsMe(msg) {
    if (!msg || !msg.roomId || !msg.host) return false;
    const sid = getTabSessionId();
    const myName = window.PlayerNick.stripBaseName(
      state.playerName || (el.playerName && el.playerName.value) || ''
    );
    const mineTag = String(myTag() || '').replace(/\D/g, '').slice(-5);
    const roomId = String(
      (state.room && state.room.id) ||
        state._lastRoomId ||
        (loadGameArchive() && loadGameArchive().roomId) ||
        ''
    ).toUpperCase();
    const wantRoom = String(msg.roomId).toUpperCase();
    const targets = Array.isArray(msg.targets) ? msg.targets : [];
    if (targets.length) {
      return targets.some((item) => {
        if (
          item.sessionId &&
          sid &&
          String(item.sessionId) === String(sid)
        ) {
          return true;
        }
        const n = window.PlayerNick.stripBaseName(item.name || '');
        const tag = String(item.tag || '').replace(/\D/g, '').slice(-5);
        if (!n || n !== myName) return false;
        if (tag && mineTag) return tag === mineTag;
        return true;
      });
    }
    return Boolean(roomId && roomId === wantRoom && isInLiveSession());
  }

  function ensureReloadModal() {
    let box = document.getElementById('room-reload-modal');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'room-reload-modal';
    box.className = 'modal';
    box.innerHTML =
      '<div class="modal-backdrop"></div>' +
      '<div class="modal-dialog panel" role="dialog" aria-modal="true" aria-labelledby="room-reload-title">' +
      '<div class="row panel-head"><h2 id="room-reload-title"></h2></div>' +
      '<p id="room-reload-message" class="invite-message"></p>' +
      '</div>';
    document.body.appendChild(box);
    return box;
  }

  function showReloadModal(title, message) {
    const box = ensureReloadModal();
    const heading = box.querySelector('#room-reload-title');
    const body = box.querySelector('#room-reload-message');
    if (heading) heading.textContent = title;
    if (body) body.textContent = message;
    box.hidden = false;
  }

  function hideReloadModal() {
    const box = document.getElementById('room-reload-modal');
    if (box) box.hidden = true;
  }

  async function applyRoomReload(msg) {
    if (roomReloadBusy || leavingToLocal) return;
    if (!reloadMessageTargetsMe(msg)) return;
    const host = String(msg.host || '').replace(/\/$/, '');
    if (!host) return;
    if (
      originOf(host) === originOf(net.getCurrentUrl()) &&
      typeof net.isConnected === 'function' &&
      net.isConnected()
    ) {
      return;
    }
    roomReloadBusy = true;
    reloadTakeover = true;
    cancelRemoteRecover();
    remoteRecovering = false;
    state._rejoining = true;
    showReloadModal(t('reload.title'), t('reload.message'));
    const roomId = String(msg.roomId).toUpperCase();
    const name =
      state.playerName ||
      (el.playerName && el.playerName.value) ||
      t('app.playerDefault');
    try {
      await sleepMs(1200);
      hideReloadModal();
      showRoomBusy('reload', t('reload.entering'));
      const opts = rejoinLobbyOpts({ roomId });
      await net.joinRoomOnHost(roomId, name, host, {
        ...opts,
        local: false,
        preferLocal: false,
      });
      const ok = await waitForSessionRestore(4000);
      hideRoomBusy();
      if (ok && isInRestoredGameView()) {
        showToast(t('toast.tunnelBack'));
      }
    } catch (err) {
      hideRoomBusy();
      hideReloadModal();
      showToast((err && err.message) || t('toast.opFail'));
    } finally {
      roomReloadBusy = false;
      state._rejoining = false;
    }
  }

  function scheduleRemoteRecover() {
    if (!net.isOnRemoteHost() || remoteRecovering) return;
    cancelRemoteRecover();
    // 判断自己是否是房主：非房主延迟更长，给房主重启隧道留出时间
    const isHost = Boolean(
      state.room && state.me && String(state.room.hostId) === String(state.me.id)
    );
    const delayMs = isHost ? 2500 : 12000;
    remoteRecoverTimer = setTimeout(() => {
      remoteRecoverTimer = null;
      recoverRemoteSession().catch((err) => {
        bounceToLocalLobby(err && err.message ? err.message : t('toast.roomInvalid'), {
          clearArchive: false,
        });
      });
    }, delayMs);
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
    reloadTakeover = false;
    state._rejoining = true;
    const deadHost = net.getCurrentUrl();
    const name =
      state.playerName || (el.playerName && el.playerName.value) || t('app.playerDefault');
    showToast(t('toast.tunnelLost'));

    let stopWatch = null;
    async function resolveMqttHost() {
      if (
        !window.MqttRoomResolve ||
        typeof window.MqttRoomResolve.resolveHost !== 'function'
      ) {
        return '';
      }
      try {
        return await window.MqttRoomResolve.resolveHost(roomId, {
          timeoutMs: 8000,
        });
      } catch (_) {
        return '';
      }
    }

    try {
      if (typeof net.stopAutoReconnect === 'function') net.stopAutoReconnect();
      const joinOnly = Boolean(
        typeof net.getJoinClientHome === 'function' && net.getJoinClientHome()
      );
      if (!joinOnly) {
        try {
          await net.connect(net.getLocalOrigin());
          await net.joinLobbyAndWait(name, {
            ...rejoinLobbyOpts({ roomId }),
            lastHost: deadHost,
            lastRoomId: roomId,
            lastStatus:
              (state.room && state.room.status) ||
              (state.game ? 'playing' : 'room'),
          });
        } catch (_) {
          /* 纯加入端或本机服务不可用时改走 MQTT */
        }
      }
      if (
        window.MqttRoomResolve &&
        typeof window.MqttRoomResolve.watchTunnelReload === 'function'
      ) {
        stopWatch = window.MqttRoomResolve.watchTunnelReload({
          roomId,
          name,
          tag: myTag(),
          sessionId: getTabSessionId(),
          lastHost: deadHost,
          onReload: (msg) => {
            applyRoomReload(msg).catch(() => {});
          },
        });
      }
      let notFoundStreak = 0;
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        if (leavingToLocal || reloadTakeover) return;
        if (
          !joinOnly &&
          originOf(net.getCurrentUrl()) !== originOf(net.getLocalOrigin())
        ) {
          try {
            await net.connect(net.getLocalOrigin());
          } catch (_) {
            /* ignore */
          }
        }
        let probe = null;
        if (!joinOnly) {
          try {
            probe = await net.probeRoom(roomId);
          } catch (_) {
            probe = null;
          }
        }
        if (probe && probeMissesRoom(probe)) {
          notFoundStreak += 1;
        } else {
          notFoundStreak = 0;
        }
        let host = (probe && probe.host) || '';
        const recovering = Boolean(probe && probe.tunnelRecovering);
        if (!host || recovering) {
          const mqttHost = await resolveMqttHost();
          if (mqttHost) host = mqttHost;
        }
        const roomStillThere = Boolean(
          (probe && probe.ok) || recovering || host
        );
        if (roomStillThere) {
          notFoundStreak = 0;
          const hostOrigin = host ? originOf(host) : '';
          if (
            recovering ||
            !hostOrigin ||
            hostOrigin === originOf(deadHost)
          ) {
            await sleepMs(2000);
            continue;
          }
          showToast(t('toast.tunnelFound'));
          try {
            const opts = rejoinLobbyOpts(probe || { roomId });
            await net.joinRoomOnHost(roomId, name, host, {
              ...opts,
              local: probe && probe.local === true,
              preferLocal: probe && probe.local === true,
            });
            const ok = await waitForSessionRestore(4000);
            if (ok && isInRestoredGameView()) {
              showToast(t('toast.tunnelBack'));
              return;
            }
          } catch (_) {
            /* 新地址可能还没就绪，继续等 */
          }
        } else if (notFoundStreak >= 20) {
          await bounceToLocalLobby(t('toast.roomInvalid'), { clearArchive: false });
          return;
        }
        await sleepMs(2000);
      }
      await bounceToLocalLobby(t('toast.roomInvalid'), { clearArchive: false });
    } finally {
      if (typeof stopWatch === 'function') {
        try {
          stopWatch();
        } catch (_) {}
      }
      remoteRecovering = false;
      if (!reloadTakeover) state._rejoining = false;
    }
  }

  net.on('room:reload', (data) => {
    applyRoomReload(data).catch(() => {});
  });

  net.on('tunnel:status', (data) => {
    if (leavingToLocal) return;
    // 房主本机仍连着，需要提示隧道在重建；客人走 disconnect 恢复流程
    if (typeof net.isOnRemoteHost === 'function' && net.isOnRemoteHost()) return;
    // 只在真正经历过隧道中断后恢复时才提示（首次启动不弹）
    if (!data || !data.wasLost) return;
    if (data.recovering) {
      showToast(t('toast.tunnelHostRecovering'));
      return;
    }
    showToast(t('toast.tunnelHostReady'));
  });

  net.on('host:occupied', (data) => {
    applyHostOccupied(data || {});
  });

  net.on('host:free', (data) => {
    applyHostFreed((data && data.message) || t('toast.hostFreed'));
  });

  net.on('disconnect', () => {
    if (leavingToLocal) return;
    // 代开端：被动服务端关闭 / 隧道断开 → 退出代开，回自己的网页端
    if (isGuestClient()) {
      if (state._guestBootJoining || state.roomBusy) {
        showToast(t('toast.reconnect'));
        return;
      }
      if (isInLiveSession()) {
        showToast(t('toast.reconnect'));
        return;
      }
      showToast(t('toast.reconnect'));
      scheduleGuestReturnOnDisconnect();
      return;
    }
    // 隧道昵称门未进房：断线后收回输入框，改回转圈连接中
    if (isTunnelNickGatePending()) {
      showTunnelConnecting();
      return;
    }
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
    // 正在手动重连流程中，由 acceptPendingRejoin / 隧道恢复 / guest 深链自己处理
    if (
      state.pendingRejoin ||
      state._rejoining ||
      state._guestBootJoining ||
      state._tunnelJoining ||
      state._tunnelBooting ||
      remoteRecovering
    ) {
      return;
    }
    // 隧道昵称门：连上后才展示输入框；等用户点「进入」
    if (
      (isTunnelGuest() || detectPageAccess() === 'tunnel') &&
      !state.inLobby &&
      !state.room
    ) {
      if (state.roomBusy === 'connect' || !el.lobbyGate || el.lobbyGate.hidden) {
        showTunnelNickGateOnly();
      }
      return;
    }
    const name = (state.playerName || (el.playerName && el.playerName.value) || '').trim();
    if (!name) return;
    // 创建房间等待隧道时也可能断线重连：仍要重新进大厅注册，否则 players 表空、丢房主
    if (state.roomBusy === 'create') {
      net.joinLobby(name, lobbyJoinOpts());
      state.inLobby = true;
      return;
    }
    if (state.roomBusy) {
      return;
    }
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
  if (!guestBootJoinFast && !mobilePlayJoinFast) {
    showView('lobby');
  }

  const bootQuery = readBootQuery();
  if (bootQuery.get('guest') === '1') markGuestClient(true);
  if (bootQuery.get('return')) rememberGuestReturn(bootQuery.get('return'));
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
  const bootPassword = readBootPassword(bootQuery);
  const bootTag = window.PlayerNick.normalizeTag(bootQuery.get('tag') || '');
  if (bootTag) {
    try {
      localStorage.setItem(window.PlayerNick.TAG_KEY, bootTag);
    } catch (_) {}
  }
  const bootSid = String(bootQuery.get('sid') || '').trim().slice(0, 64);
  if (bootSid) {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, bootSid);
    } catch (_) {
      /* ignore */
    }
  }

  async function bootMobilePlayJoin() {
    const boot = peekMobilePlayJoin();
    if (!boot || !isMobilePlayPage()) return false;

    const ridEarly = String(boot.roomId || '')
      .trim()
      .toUpperCase();
    const hostEarly = String(boot.host || '').trim();

    if (window.GameNet && window.GameNet.configureJoinClient) {
      const joinCfg = {
        joinOnly: true,
        client: boot.client || 'mobile',
        role: boot.role || 'client',
        homeUrl: './index.html',
      };
      if (
        window.MqttRoomResolve &&
        typeof window.MqttRoomResolve.resolveHost === 'function'
      ) {
        joinCfg.resolveRoomHost = (roomId) =>
          window.MqttRoomResolve.resolveHost(roomId, {
            preferred: hostEarly,
            timeoutMs: 12000,
          });
      }
      net.configureJoinClient(joinCfg);
    }
    if (window.ClientPlatform) {
      window.ClientPlatform.rememberGuestClient(boot.client || 'mobile');
      window.ClientPlatform.rememberGuestRole(boot.role || 'client');
    }

    const nick = window.PlayerNick.stripBaseName(boot.name || '');
    if (!nick) {
      showToast('昵称无效');
      window.location.replace('./index.html');
      return true;
    }
    state.playerName = nick;
    if (el.playerName) el.playerName.value = nick;
    refreshNickUi();
    if (boot.sessionId) {
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, String(boot.sessionId));
      } catch (_) {}
    }
    if (boot.playerTag) {
      try {
        localStorage.setItem(
          window.PlayerNick.TAG_KEY,
          window.PlayerNick.normalizeTag(boot.playerTag)
        );
      } catch (_) {}
    }

    const rid = String(boot.roomId || '')
      .trim()
      .toUpperCase();
    const host = String(boot.host || '').trim();
    if (!rid || !host) {
      showToast('加入信息不完整');
      window.location.replace('./index.html');
      return true;
    }

    try {
      sessionStorage.setItem('lianji.mobilePlayHost', host);
    } catch (_) {}

    document.documentElement.classList.add('boot-joining');
    showRoomBusy(
      'join',
      boot.mode === 'spectate' ? '正在观战…' : t('create.joining')
    );
    try {
      await joinRoomWithBusy(async () => {
        await net.enterRoomOnHost(rid, nick, host, {
          ...lobbyJoinOpts({
            sessionId: boot.sessionId || getTabSessionId(),
          }),
          mode: boot.mode === 'spectate' ? 'spectate' : 'join',
          password: boot.password != null ? String(boot.password) : '',
          wait: true,
          requireMe: true,
          lobbyTimeoutMs: 15000,
          timeoutMs: 25000,
        });
      });
      cancelRemoteRecover();
      state.inLobby = true;
      applyMobilePlayChatChrome();
      syncRemoteAssetBase();
      try {
        await ensureGamePanelsReady();
      } catch (err) {
        console.warn('game panels preload failed', err);
        resetGamePanelsState();
        showToast(t('game.loadFail'));
      }
      if (state.room) {
        try {
          sessionStorage.removeItem('lianji.mobilePlayJoin');
        } catch (_) {}
        if (state.game || state.room.status === 'playing') {
          showView('game');
          scheduleRenderGame(true);
        } else {
          showView('room');
          renderRoom();
        }
      }
    } catch (err) {
      hideRoomBusy();
      document.documentElement.classList.remove('boot-joining');
      showToast(err.message || t('toast.autoLobbyFail'));
      setTimeout(() => window.location.replace('./index.html'), 1600);
    } finally {
      document.documentElement.classList.remove('boot-joining');
    }
    return true;
  }

  async function bootGuestDeepLink() {
    state._guestBootJoining = Boolean(bootJoin);
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
      if (isGuestClient()) {
        tryNavigateGuestReturn();
        return;
      }
      net.connect(net.getLocalOrigin()).catch(() => {});
      showLobbyHome();
      updateMeLabel();
      return;
    }
    state.playerName = nick;
    if (el.playerName) el.playerName.value = nick;
    refreshNickUi();
    try {
      await enterLobbyWithName(nick, {
        silent: true,
        skipRejoin: Boolean(bootJoin || bootCreatePassive),
        skipLobbyHome: Boolean(bootJoin),
      });
      if (bootJoin) {
        updateRoomBusyMessage(bootSpectate ? '正在观战…' : t('create.joining'));
        await joinRoomWithBusy(async () => {
          const joined = await net.joinRoomAndWait(bootJoin, nick, {
            ...lobbyJoinOpts(),
            password: bootPassword,
            spectate: bootSpectate,
          });
          if (joined && joined.room) state.room = joined.room;
        });
        cancelRemoteRecover();
        if (state.room) {
          showView('room');
          renderRoom();
        }
      } else if (bootCreatePassive) {
        hideRoomBusy();
        document.documentElement.classList.remove('boot-joining');
        state._guestBootCreatePassive = true;
        state.createOnHostTarget = {
          passive: true,
          alreadyOnHost: true,
          host: null,
        };
        // 必须先打开代开弹窗再 showLobbyHome，否则 maybeGuestExitIfNotInRoom 会立刻跳回客户端
        setCreatePanelOpen(true, 'create-on-host');
        showLobbyHome();
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
      if (isGuestClient()) {
        tryNavigateGuestReturn();
      } else {
        showLobbyHome();
      }
    } finally {
      state._guestBootJoining = false;
      clearBootQueryFromUrl();
      syncGuestChrome();
    }
  }

  if (isMobilePlayPage()) {
    applyMobilePlayChatChrome();
  }
  if (isMobilePlayPage() && !peekMobilePlayJoin()) {
    window.location.replace('./index.html');
  } else if (await bootMobilePlayJoin()) {
    /* bootMobilePlayJoin 内已预加载面板并在对局中 render */
  } else if (
    isGuestClient() &&
    (bootName || bootJoin || bootCreatePassive || bootQuery.get('guest') === '1')
  ) {
    await bootGuestDeepLink();
    if (guestBootJoinFast && state.room) {
      ensureGamePanelsReady()
        .then(() => {
          fillGameOptions(state.games);
          updateCreateForm();
          if (
            state.game ||
            (state.room && state.room.status === 'playing')
          ) {
            showView('game');
            scheduleRenderGame(true);
          }
        })
        .catch((err) => console.warn('deferred game panels load failed', err));
    }
  } else if (detectPageAccess() === 'tunnel') {
    await bootTunnelGuestFlow();
  } else {
    const savedNick = loadSavedNick();
    if (savedNick) {
      state.playerName = savedNick;
      if (el.playerName) el.playerName.value = savedNick;
      refreshNickUi();
      enterLobbyWithName(savedNick, { silent: true }).catch((err) => {
        if (err && err.code === 'HOST_OCCUPIED') return;
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

  /* —— Windows 主机差分 OTA —— */
  const HOST_UPDATE_DISMISS_KEY = 'lianji.hostUpdate.dismissed';
  let hostUpdateApplying = false;
  let hostUpdatePollTimer = null;

  function formatBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    return (v / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function isHostUpdateDismissed(remoteVersion) {
    try {
      return localStorage.getItem(HOST_UPDATE_DISMISS_KEY) === String(remoteVersion || '');
    } catch (_) {
      return false;
    }
  }

  function dismissHostUpdateModal() {
    if (!el.hostUpdateModal) return;
    const ver =
      (el.hostUpdateModal.dataset && el.hostUpdateModal.dataset.remoteVersion) ||
      '';
    if (ver && !el.hostUpdateModal.dataset.force) {
      try {
        localStorage.setItem(HOST_UPDATE_DISMISS_KEY, ver);
      } catch (_) {}
    }
    el.hostUpdateModal.hidden = true;
  }

  function showHostUpdateModal(info) {
    if (!el.hostUpdateModal || !info) return;
    el.hostUpdateModal.dataset.remoteVersion = info.remoteVersion || '';
    if (info.force) el.hostUpdateModal.dataset.force = '1';
    else delete el.hostUpdateModal.dataset.force;

    const lang = (I18n && I18n.getLang && I18n.getLang()) || 'zh';
    const notes =
      lang === 'en' && info.notesEn
        ? info.notesEn
        : info.notes || t('update.noNotes');

    if (el.hostUpdateVersion) {
      el.hostUpdateVersion.textContent = t('update.versionLine', {
        local: info.localVersion || '?',
        remote: info.remoteVersion || '?',
      });
    }
    if (el.hostUpdateNotes) el.hostUpdateNotes.textContent = notes;
    if (el.hostUpdateMeta) {
      el.hostUpdateMeta.textContent = t('update.metaLine', {
        count: info.changedCount || 0,
        size: formatBytes(info.totalBytes),
      });
    }
    if (el.hostUpdateProgressWrap) el.hostUpdateProgressWrap.hidden = true;
    if (el.hostUpdateActions) el.hostUpdateActions.hidden = false;
    if (el.btnHostUpdateApply) el.btnHostUpdateApply.disabled = !info.canApply;
    if (el.btnHostUpdateLater) {
      el.btnHostUpdateLater.hidden = Boolean(info.force);
      el.btnHostUpdateLater.disabled = false;
    }
    el.hostUpdateModal.hidden = false;
  }

  async function fetchUpdateStatus(refresh) {
    const origin = (net && net.getLocalOrigin && net.getLocalOrigin()) || '';
    const q = refresh ? '?refresh=1' : '';
    const res = await fetch(origin + '/api/update/status' + q, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function checkHostUpdate(opts) {
    opts = opts || {};
    const manual = Boolean(opts.manual);
    let info;
    try {
      if (manual) {
        const origin = (net && net.getLocalOrigin && net.getLocalOrigin()) || '';
        const res = await fetch(origin + '/api/update/check', {
          method: 'POST',
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || t('update.checkFail'));
        }
        info = { ...data, canApply: true };
      } else {
        info = await fetchUpdateStatus(true);
      }
    } catch (err) {
      if (manual) throw err;
      return null;
    }

    if (!info || info.enabled === false) {
      if (manual) showToast(t('update.disabled'));
      return info;
    }
    if (!info.available) {
      if (manual) {
        showToast(
          t('update.uptoDate', { version: info.localVersion || '?' })
        );
      }
      return info;
    }
    if (!info.canApply) {
      if (manual) showToast(t('update.localOnly'));
      return info;
    }
    if (!manual && !info.force && isHostUpdateDismissed(info.remoteVersion)) {
      return info;
    }
    showHostUpdateModal(info);
    return info;
  }

  function setHostUpdateProgress(p) {
    if (!el.hostUpdateProgressWrap) return;
    el.hostUpdateProgressWrap.hidden = false;
    if (el.hostUpdateActions) el.hostUpdateActions.hidden = true;
    const total = (p && p.total) || 0;
    const cur = (p && p.current) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((cur / total) * 100)) : 0;
    if (el.hostUpdateProgressFill) {
      el.hostUpdateProgressFill.style.width = pct + '%';
    }
    if (el.hostUpdateProgressText) {
      el.hostUpdateProgressText.textContent =
        (p && p.message) || t('update.working');
    }
  }

  async function waitForServerRestart(timeoutMs) {
    const origin = (net && net.getLocalOrigin && net.getLocalOrigin()) || '';
    const deadline = Date.now() + (timeoutMs || 60000);
    // 先等服务挂掉
    for (let i = 0; i < 20; i++) {
      try {
        await fetch(origin + '/healthz', { cache: 'no-store' });
        await new Promise((r) => setTimeout(r, 300));
      } catch (_) {
        break;
      }
    }
    while (Date.now() < deadline) {
      try {
        const res = await fetch(origin + '/healthz', { cache: 'no-store' });
        if (res.ok) return true;
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 800));
    }
    return false;
  }

  async function applyHostUpdate() {
    if (hostUpdateApplying) return;
    hostUpdateApplying = true;
    if (el.btnHostUpdateApply) el.btnHostUpdateApply.disabled = true;
    if (el.btnHostUpdateLater) el.btnHostUpdateLater.disabled = true;
    setHostUpdateProgress({ current: 0, total: 1, message: t('update.working') });

    const origin = (net && net.getLocalOrigin && net.getLocalOrigin()) || '';
    if (hostUpdatePollTimer) clearInterval(hostUpdatePollTimer);
    hostUpdatePollTimer = setInterval(() => {
      fetchUpdateStatus(false)
        .then((st) => {
          if (st && st.progress) setHostUpdateProgress(st.progress);
        })
        .catch(() => {});
    }, 500);

    try {
      const res = await fetch(origin + '/api/update/apply', {
        method: 'POST',
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || t('update.applyFail'));
      }
      setHostUpdateProgress({
        current: 1,
        total: 1,
        message: t('update.restarting'),
      });
      const ok = await waitForServerRestart(90000);
      if (ok) {
        try {
          localStorage.removeItem(HOST_UPDATE_DISMISS_KEY);
        } catch (_) {}
        location.reload();
      } else {
        showToast(t('update.restartTimeout'));
        if (el.hostUpdateModal) el.hostUpdateModal.hidden = true;
      }
    } catch (err) {
      setHostUpdateProgress({
        current: 0,
        total: 1,
        message: (err && err.message) || t('update.applyFail'),
      });
      if (el.hostUpdateActions) el.hostUpdateActions.hidden = false;
      if (el.btnHostUpdateApply) el.btnHostUpdateApply.disabled = false;
      if (el.btnHostUpdateLater) {
        el.btnHostUpdateLater.disabled = false;
        el.btnHostUpdateLater.hidden = false;
      }
      throw err;
    } finally {
      if (hostUpdatePollTimer) {
        clearInterval(hostUpdatePollTimer);
        hostUpdatePollTimer = null;
      }
      hostUpdateApplying = false;
    }
  }

  // 自动升级已改到启动.bat 命令行完成；大厅不再自动弹窗（菜单「检查更新」仍可用）
})();
