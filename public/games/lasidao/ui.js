'use strict';

/**
 * ??? UI
 * ??????? ? ?? ? ???? ? ??/?? ? ????
 */
window.LasidaoUi = (function () {
  function $(id) {
    return document.getElementById(id);
  }

  function t(key, vars) {
    return window.I18n && typeof window.I18n.t === 'function'
      ? window.I18n.t(key, vars)
      : key;
  }

  function noneSlotKeysFor(p) {
    const max =
      (p && p.maxBuildings) ||
      3 + (Number(p && p.expandSlots) || 0);
    const out = [];
    for (let i = 0; i < max; i++) {
      out.push(i === 0 ? 'none' : 'none:' + i);
    }
    return out;
  }

  function isNoneSlotKey(slot) {
    return (
      slot === 'none' ||
      (typeof slot === 'string' && /^none(:\d+)?$/.test(slot))
    );
  }

  function occupiedBuildSlotKeys(p) {
    const set = new Set();
    for (const b of (p && p.buildings) || []) {
      if (b.slot == null) continue;
      set.add(String(b.slot));
    }
    return set;
  }

  function buildingsOnBuildSlot(p, slot) {
    const key = String(slot);
    return ((p && p.buildings) || []).filter(
      (b) => b.slot != null && String(b.slot) === key
    );
  }

  function buildingStackKey(b) {
    if (!b) return '';
    if (b.buildType === 'produce') {
      return 'produce:' + b.resource + ':' + (b.rich ? 'rich' : 'poor');
    }
    return String(b.buildType || '');
  }

  function canStackBuildingOnSlot(p, slot, building) {
    const on = buildingsOnBuildSlot(p, slot);
    if (!on.length || !building) return false;
    const key = buildingStackKey(building);
    return on.every((b) => buildingStackKey(b) === key);
  }

  function isHomogeneousStackSlot(p, slot) {
    const on = buildingsOnBuildSlot(p, slot);
    if (!on.length) return false;
    const key = buildingStackKey(on[0]);
    return on.every((b) => buildingStackKey(b) === key);
  }

  function findStackSlotKey(p, building) {
    if (!building) return null;
    const key = buildingStackKey(building);
    for (const slot of occupiedBuildSlotKeys(p)) {
      const on = buildingsOnBuildSlot(p, slot);
      if (on.length && on.every((b) => buildingStackKey(b) === key)) {
        return slot;
      }
    }
    return null;
  }

  /** @deprecated */
  function isExchangeOnlyBuildSlot(p, slot) {
    return isHomogeneousStackSlot(p, slot) &&
      buildingsOnBuildSlot(p, slot).every((b) => b.buildType === 'exchange');
  }

  function nextFreeBuildSlotKey(p) {
    const used = occupiedBuildSlotKeys(p);
    for (const s of noneSlotKeysFor(p)) {
      if (!used.has(String(s))) return s;
    }
    return null;
  }

  /** @deprecated */
  function findExchangeStackSlotKey(p) {
    return findStackSlotKey(p, { buildType: 'exchange' });
  }

  /** 放置目标：相同建筑优先叠到已有同型格，否则取空位 */
  function pickPlaceSlotForBuilding(p, building) {
    const stack = findStackSlotKey(p, building);
    if (stack != null) return stack;
    return nextFreeBuildSlotKey(p);
  }

  function groupPlacedBuildingsBySlot(p) {
    const map = new Map();
    for (const b of (p && p.buildings) || []) {
      if (b.slot == null) continue;
      const k = String(b.slot);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(b);
    }
    return map;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function canPay(have, cost) {
    for (const k of ['wood', 'stone', 'food', 'iron']) {
      if ((have[k] || 0) < (cost[k] || 0)) return false;
    }
    return true;
  }

  function phaseLabel(phase) {
    const k = 'lasidao.phase.' + phase;
    const v = t(k);
    return v === k ? phase : v;
  }

  function areaLabel(area) {
    const k = 'lasidao.area.' + area;
    const v = t(k);
    return v === k ? area : v;
  }

  const PHASE_LABEL = new Proxy(
    {},
    { get: (_, p) => phaseLabel(p) }
  );

  const AREA_LABEL = new Proxy(
    {},
    { get: (_, p) => areaLabel(p) }
  );


  const RESOURCES = ['wood', 'stone', 'food', 'iron'];
  const LAS_LOG_MAX = 60;

  const FUNC_RULE = {
    breed: 'lasidao.func.breed',
    harvest: 'lasidao.func.harvest',
    remoteDice: 'lasidao.func.remoteDice',
    exile: 'lasidao.func.exile',
    buildHouse: 'lasidao.func.buildHouse',
    enhance: 'lasidao.func.enhance',
    recruit: 'lasidao.func.recruit',
    redraw: 'lasidao.func.redraw',
    banditRaid: 'lasidao.func.banditRaid',
    expand: 'lasidao.func.expand',
    freeExpand: 'lasidao.func.freeExpand',
    welfareHouse: 'lasidao.func.welfareHouse',
    caravan: 'lasidao.func.caravan',
    robbery: 'lasidao.func.robbery',
    illegalBuild: 'lasidao.func.illegalBuild',
  };

  const PRODUCE_FUNC = new Set(['remoteDice', 'exile', 'banditRaid']);
  const BUILD_FUNC = new Set([
    'harvest',
    'robbery',
    'illegalBuild',
    'redraw',
    'expand',
    'freeExpand',
    'welfareHouse',
    'caravan',
    'enhance',
    'recruit',
  ]);

  function canPlayFuncCard(game, meId, funcType) {
    if (!game || !meId || !funcType) return false;
    if (!isMyTurn(game, meId)) return false;
    if (game.phase === 'produce') {
      if (!PRODUCE_FUNC.has(funcType)) return false;
      if (funcType === 'remoteDice') {
        if (game.remoteDiceMode) return false;
        if (game.awaitingProduceRoll) {
          const me = mePlayer(game, meId);
          return Boolean(me && idleVillagersUi(me) > 0);
        }
        const dice = Array.isArray(game.dice) ? game.dice : [];
        return dice.length > 0;
      }
      return true;
    }
    if (game.phase === 'build') {
      const me = mePlayer(game, meId);
      if (me && me.buildPassed) return false;
      if (funcType === 'enhance') {
        const enh = Number(me && me.enhancedDice) || 0;
        const vil = Number(me && me.villagers) || 0;
        const maxEnh = Number(game && game.maxEnhancedDice) || 3;
        if (enh >= Math.min(vil, maxEnh)) return false;
      }
      if (funcType === 'illegalBuild') {
        return (game.players || []).some(
          (p) => !p.left && countBuiltBuildingsUi(p) > 0
        );
      }
      return BUILD_FUNC.has(funcType);
    }
    return false;
  }

  function idleVillagersUi(me) {
    if (!me) return 0;
    if (typeof me.idle === 'number') return Math.max(0, me.idle);
    const v = Number(me.villagers) || 0;
    const d = Number(me.dispatched) || 0;
    const t = Number(me.tempVillagers) || 0;
    return Math.max(0, v + t - d);
  }

  function funcRuleText(funcType) {
    const key = FUNC_RULE[funcType];
    return key ? t(key) : '';
  }

  function defaultResLabels() {
    return {
      wood: t('lasidao.res.wood'),
      stone: t('lasidao.res.stone'),
      food: t('lasidao.res.food'),
      iron: t('lasidao.res.iron'),
    };
  }

  function buildBldTooltip(b, resLabels) {
    const costParts = [];
    for (const k of ['wood', 'stone', 'food', 'iron']) {
      const n = b.cost?.[k] || 0;
      if (n > 0) costParts.push(`${resLabels[k]}×${n}`);
    }
    const costText = costParts.length ? costParts.join('、') : '无';

    let effect = '';
    if (b.buildType === 'produce') {
      const res = resLabels[b.resource] || b.resource;
      effect = `产出${b.produce}${res}`;
      if (b.needsWorker) effect += '（需工人）';
    } else if (b.buildType === 'score2') {
      effect = `建成+${b.score}分（无需工人）`;
    } else if (b.buildType === 'score1') {
      effect = '建成+1分（无需工人）';
    } else if (b.buildType === 'exchange') {
      effect = '无需工人，改善兑换比例';
    } else if (b.buildType === 'wishWell') {
      effect = '无需工人，生产阶段结束后可选任意资源+1';
    } else if (b.buildType === 'eternalThrone') {
      effect = '无需工人，每个建造回合结束时+1分';
    }

    return `消耗：${costText}` + (effect ? `\n${effect}` : '');
  }

  function getResLabels(game) {
        return defaultResLabels();
  }

  let netRef = null;
  let selectedFace = null;
  /** ???????? */
  let selectedWildCount = 0;
  let selectedWildIdx = new Set();
  /** @type {null|{type:'area',area:string,number:number}|{type:'building',buildingId:string,label:string}} */
  let selectedTarget = null;
  let selectedFuncId = null;
  let selectedBuildingId = null;
  /** @type {null|'buildHouse'|'breed'|'expand'|'exchange'} */
  let selectedPermanent = null;
  let turnUsedBuyFunc = false;
  let turnUsedRedraw = false;
  let lastGame = null;
  let lastMeId = null;
  const AUTO_PRODUCE_ROLL_MS = 1500;
  let autoProduceRollTimer = null;
  let autoProduceRollKey = null;

  let robberyCardId = null;
  /** @type {[string|null, string|null]} */
  let robberyTargets = [null, null];
  let robberyPickStep = 0;
  let illegalBuildCardId = null;
  let redrawCardId = null;

  let voidSkipMode = 'burn';
  let voidSkipRes = null;
  let voidSkipPayPick = emptyDiscardResPick();
  let eventTwoResPick = { wood: 0, stone: 0, food: 0, iron: 0 };
  let harvestCardId = null;
  let harvestCounts = {};
  let harvestMaxCount = 2;
  let harvestSourceText = '';

  let expandCardId = null;
  let expandDirection = null;

  let exileCardId = null;
  let exileArea = null;
  let exileNumber = null;
  let exileTargetId = null;
  let exileDieEnhanced = null;

  let banditCardId = null;
  let banditArea = null;
  let banditNumber = null;

  /** 颗粒无收：点选要放置标记的数字格（资源区或功能/建筑区） */
  let barrenPickArea = null;
  let barrenPickNumber = null;
  /** 以身入局：点选要放置中立骰的目标格 */
  let neutralPickArea = null;
  let neutralPickNumber = null;

  /** 弃牌阶段：待弃置的各资源数量 */
  let discardResPick = { wood: 0, stone: 0, food: 0, iron: 0 };
  /** 结算弃牌弹框：功能卡 / 建筑选择 */
  let settleDiscardFuncId = null;
  let settleDiscardBuildPick = null;
  let settleDiscardModalKind = null;

  /** ?????? */
  let diceAnim = {
    key: null,
    stage: 'idle', // idle | rolling | grouping | ready
    timers: [],
    intervals: [],
    finalDice: [],
    finalBoosted: [],
  };

  let initAnimKey = null;
  let initAnimPlayingUntil = 0;
  let lastGamePhase = null;
  let settleAnimKey = null;
  let settlePlaying = false;
  let settleAckKey = null;
  let settlePlayingWatchdog = null;
  let settleUnstickTimer = null;
  let produceFxWatchdog = null;
  let dispatchBusyWatchdog = null;
  let lastLogRenderKey = '';
  let lastLogNewestKey = '';
  let victoryModalKey = null;
  let victoryAnimPlaying = false;
  let onLeaveLobbyRef = null;
  let lastProduceFxKey = null;
  let produceFxPlaying = false;
  /** 对手派遣飞入动画期间冻结板块，避免工人先瞬移再动画 */
  let dispatchBoardFreeze = null;
  /** 结算动画期间冻结板块（骰子+卡牌），直到回收动画结束 */
  let settleBoardFreeze = null;
  let settleBoardFreezeKey = null;
  /** 结算动画期间冻结手牌（保留生产阶段已获资源） */
  let settleHandFreeze = null;
  let settleHandFreezeKey = null;
  let lastRenderPrevGame = null;
  /** 结算前短暂展示最后一手派遣的骰子 */
  let settleDispatchHoldTimer = null;
  let settleDispatchHoldKey = null;
  let mercenaryRollAnimKey = null;
  let mercenaryRollAnimDoneKey = null;
  let mercenaryToastKey = null;
  let neutralToastKey = null;
  let recallToastKey = null;
  let recallPickArea = null;
  let recallPickNumber = null;
  let gatherNeutralsToastKey = null;
  let teleportToastKey = null;
  let teleportPickArea = null;
  let teleportPickNumber = null;
  let knownBoardTiles = null; // Set of tile ids
  let pendingDealIds = new Set();
  let dealAnimPlaying = false;
  let dealtForRound = null; // ???????????
  /** 发牌动画期间冻结牌堆顶/张数，避免提前显示发牌后结果 */
  let dealDeckFreeze = null;
  let wishAlloc = { wood: 0, stone: 0, food: 0, iron: 0 };
  let wishAllocFor = 0;
  let exFromBatches = { wood: 0, stone: 0, food: 0, iron: 0 };
  let tradeTargetId = null;
  let tradeGive = { wood: 0, stone: 0, food: 0, iron: 0 };
  let tradeTake = { wood: 0, stone: 0, food: 0, iron: 0 };
  let exToBatches = { wood: 0, stone: 0, food: 0, iron: 0 };
  let turnToastArmed = true;
  let turnToastTimer = null;
  let turnToastSnap = null;
  const PLAY_REVEAL_MS = 2500;
  const PLAY_REVEAL_FADE_MS = 280;
  let lastShownPlayRevealId = null;
  let playRevealTimer = null;
  let lasScaleBound = false;
  let lasViewportScrollDone = false;
  let lasViewportScrollTimer = null;

  const LAS_DESIGN_W = 1920;
  const LAS_DESIGN_H = 1080;
  /** 1080p 设计稿基准缩放；安卓 play 页单独收紧 */
  const LAS_SCALE_BOOST = 1.14;

  function isMobilePlaySurface() {
    try {
      if (document.documentElement.dataset.mobilePlay === '1') return true;
      if (document.body.classList.contains('is-mobile-chat')) return true;
      if (/\/play\.html$/i.test(String(window.location.pathname || ''))) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function updateLasScale() {
    const panel = $('panel-lasidao');
    if (!panel || panel.hidden) return;
    const host =
      panel.closest('#game-panels') ||
      panel.closest('.game-panels') ||
      panel.parentElement;
    const vv = window.visualViewport;
    const vw = (vv && vv.width) || window.innerWidth || LAS_DESIGN_W;
    const vh = (vv && vv.height) || window.innerHeight || LAS_DESIGN_H;
    const hostW = (host && host.clientWidth) || vw;
    const hostH = (host && host.clientHeight) || 0;
    const mobile = isMobilePlaySurface();
    let availW = Math.max(320, Math.min(hostW, vw));
    let availH = Math.max(240, hostH > 80 ? Math.min(hostH, vh) : vh);
    if (mobile) {
      availW = Math.max(280, availW - 12);
      const chatDock = document.getElementById('chat-dock');
      const chatH =
        chatDock && !chatDock.hidden
          ? chatDock.getBoundingClientRect().height || 54
          : 54;
      availH = Math.max(220, availH - chatH - 64);
    }
    const boost = mobile ? 0.76 : LAS_SCALE_BOOST;
    const scale =
      Math.min(availW / LAS_DESIGN_W, availH / LAS_DESIGN_H) * boost;
    const minScale = mobile ? 0.24 : 0.35;
    const maxScale = mobile ? 0.46 : 3;
    const s = Math.round(Math.max(minScale, Math.min(scale, maxScale)) * 1000) / 1000;
    panel.style.setProperty('--las-ui-scale', String(s));
    panel.dataset.uiScale = String(s);
    document.documentElement.style.setProperty('--las-ui-scale', String(s));
    panel.classList.remove('las-scale-zoom', 'las-scale-transform');
    if (mobile) {
      panel.classList.add('las-mobile-surface');
    } else {
      panel.classList.remove('las-mobile-surface');
    }
  }

  function bindLasScale() {
    if (lasScaleBound) return;
    lasScaleBound = true;
    window.addEventListener('resize', updateLasScale);
    window.addEventListener('orientationchange', updateLasScale);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateLasScale);
    }
    const host = document.getElementById('game-panels') || document.body;
    if (typeof ResizeObserver !== 'undefined' && host) {
      const ro = new ResizeObserver(() => updateLasScale());
      ro.observe(host);
    }
  }

  function getLasViewportScrollGap() {
    const panel = $('panel-lasidao');
    if (!panel) return 12;
    const rem = parseFloat(getComputedStyle(panel).getPropertyValue('--las-rem')) || 16;
    return Math.max(8, rem * 0.35);
  }

  function scrollToPlayerBand() {
    const band = $('las-player-band');
    const panel = $('panel-lasidao');
    if (!band || !panel || panel.hidden) return false;
    const gap = getLasViewportScrollGap();
    const rect = band.getBoundingClientRect();
    const scrollRoot = document.scrollingElement || document.documentElement;
    const target = Math.max(0, rect.top + scrollRoot.scrollTop - gap);
    window.scrollTo({ top: target, left: 0, behavior: 'auto' });
    return true;
  }

  function scheduleLasViewportScroll() {
    if (lasViewportScrollDone) return;
    if (lasViewportScrollTimer) {
      clearTimeout(lasViewportScrollTimer);
      lasViewportScrollTimer = null;
    }
    const finish = () => {
      if (lasViewportScrollDone) return;
      if (scrollToPlayerBand()) lasViewportScrollDone = true;
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        finish();
        if (!lasViewportScrollDone) {
          lasViewportScrollTimer = setTimeout(() => {
            lasViewportScrollTimer = null;
            finish();
          }, 100);
        }
      });
    });
  }

  function clearDiceTimers() {
    for (const t of diceAnim.timers) clearTimeout(t);
    for (const t of diceAnim.intervals) clearInterval(t);
    diceAnim.timers = [];
    diceAnim.intervals = [];
  }

  function resetDiceSelection() {
    selectedFace = null;
    selectedTarget = null;
    selectedWildCount = 0;
    selectedWildIdx = new Set();
  }

  function resetDiceAnim() {
    clearDiceTimers();
    diceAnim.key = null;
    diceAnim.stage = 'idle';
    diceAnim.finalDice = [];
    diceAnim.finalBoosted = [];
    resetDiceSelection();
  }

  function hideOthers() {
    const gomoku = $('panel-gomoku');
    if (gomoku) gomoku.hidden = true;
    if (window.IncanUi) window.IncanUi.hide();
    if (window.SgsUi) window.SgsUi.hide();
  }

  function hide(opts) {
    const panel = $('panel-lasidao');
    if (panel) panel.hidden = true;
    hideCardTip();
    hideTurnToast(true);
    setRulesModalOpen(false);
    // ???????? game:state ?? hide+render???????????????
    if (opts && opts.reset) {
      resetSession();
    }
  }

  function resetSession() {
    resetDiceAnim();
    selectedFuncId = null;
    selectedBuildingId = null;
    selectedPermanent = null;
    knownBoardTiles = null;
    pendingDealIds = new Set();
    dealAnimPlaying = false;
    dealtForRound = null;
    dealDeckFreeze = null;
    lastProduceFxKey = null;
    produceFxPlaying = false;
    dispatchBoardFreeze = null;
    settleBoardFreeze = null;
    settleBoardFreezeKey = null;
    settleHandFreeze = null;
    settleHandFreezeKey = null;
    lastRenderPrevGame = null;
    lastLogRenderKey = '';
    lastLogNewestKey = '';
    if (settleDispatchHoldTimer) {
      clearTimeout(settleDispatchHoldTimer);
      settleDispatchHoldTimer = null;
    }
    settleDispatchHoldKey = null;
    clearSettleAnimWatchdogs();
    clearAutoProduceRoll();
    mercenaryRollAnimKey = null;
    mercenaryRollAnimDoneKey = null;
    mercenaryToastKey = null;
    neutralToastKey = null;
    banditCardId = null;
    victoryModalKey = null;
    victoryAnimPlaying = false;
    setVictoryModalOpen(false);
    discardResPick = emptyDiscardResPick();
    settleDiscardFuncId = null;
    settleDiscardBuildPick = null;
    settleDiscardModalKind = null;
    setSettleDiscardModalOpen(false);
    turnToastArmed = true;
    turnToastSnap = null;
    lastShownPlayRevealId = null;
    hidePlayReveal(true);
    hideTurnToast(true);
    lasViewportScrollDone = false;
    if (lasViewportScrollTimer) {
      clearTimeout(lasViewportScrollTimer);
      lasViewportScrollTimer = null;
    }
    if (window.LasidaoFx && typeof window.LasidaoFx.clearLayer === 'function') {
      window.LasidaoFx.clearLayer();
    }
    if (window.LasidaoAssets && typeof window.LasidaoAssets.stopBgm === 'function') {
      window.LasidaoAssets.stopBgm();
    }
  }

  function hideTurnToast(immediate) {
    const el = $('las-turn-toast');
    if (turnToastTimer) {
      clearTimeout(turnToastTimer);
      turnToastTimer = null;
    }
    if (!el) return;
    if (immediate) {
      el.hidden = true;
      el.classList.remove('is-in', 'is-out', 'has-card');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('is-in', 'has-card');
    el.classList.add('is-out');
    turnToastTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('is-out');
      turnToastTimer = null;
    }, 280);
  }

  function showTurnToast(text, durationMs, opts) {
    opts = opts || {};
    const el = $('las-turn-toast');
    if (!el || !text) return;
    if (turnToastTimer) {
      clearTimeout(turnToastTimer);
      turnToastTimer = null;
    }
    el.classList.remove('has-card');
    el.innerHTML = '';
    if (opts.card && opts.kind) {
      el.classList.add('has-card');
      const txt = document.createElement('span');
      txt.textContent = text;
      el.appendChild(txt);
      const thumb = makeToastCardEl(opts.card, opts.kind);
      if (thumb) el.appendChild(thumb);
    } else {
      el.textContent = text;
    }
    el.hidden = false;
    el.classList.remove('is-out');
    void el.offsetWidth;
    el.classList.add('is-in');
    const ms = Number(durationMs) > 0 ? Number(durationMs) : 3200;
    turnToastTimer = setTimeout(() => hideTurnToast(false), ms);
  }

  function makeToastCardEl(card, kind) {
    if (!card) return null;
    const div = document.createElement('div');
    div.className = 'las-turn-toast-card';
    div.title = card.label || '';
    const url = tileImageUrl(card, kind);
    if (url) {
      div.style.backgroundImage = 'url("' + url + '")';
    } else {
      div.textContent = card.label || '';
    }
    return div;
  }

  function hidePlayReveal(immediate) {
    const el = $('las-play-reveal');
    if (!el) return;
    if (playRevealTimer) {
      clearTimeout(playRevealTimer);
      playRevealTimer = null;
    }
    if (immediate) {
      el.hidden = true;
      el.classList.remove('is-in', 'is-out', 'has-card');
      el.innerHTML = '';
      return;
    }
    el.classList.add('is-out');
    el.classList.remove('is-in');
    playRevealTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('is-out', 'has-card');
      el.innerHTML = '';
      playRevealTimer = null;
    }, PLAY_REVEAL_FADE_MS);
  }

  function formatPlayRevealText(reveal) {
    if (!reveal) return '';
    if (reveal.stepText) return reveal.stepText;
    if (reveal.actorName && reveal.card && reveal.card.label) {
      if (reveal.kind === 'function') {
        return `${reveal.actorName} 发动「${reveal.card.label}」`;
      }
      if (reveal.kind === 'building') {
        return `${reveal.actorName} 建造了「${reveal.card.label}」`;
      }
    }
    return reveal.actorName || '';
  }

  function makePlayRevealCardEl(card, kind) {
    if (!card) return null;
    const div = document.createElement('div');
    div.className = 'las-play-reveal-card';
    div.title = card.label || '';
    const url = tileImageUrl(card, kind);
    if (url) {
      div.style.backgroundImage = 'url("' + url + '")';
    } else {
      div.textContent = card.label || '';
    }
    return div;
  }

  function showPlayReveal(reveal) {
    if (!reveal || !reveal.id) return false;
    if (reveal.id === lastShownPlayRevealId) return false;
    const text = formatPlayRevealText(reveal);
    if (!text) return false;

    lastShownPlayRevealId = reveal.id;
    const el = $('las-play-reveal');
    if (!el) return false;

    if (playRevealTimer) {
      clearTimeout(playRevealTimer);
      playRevealTimer = null;
    }

    const hasCard =
      (reveal.kind === 'building' || reveal.kind === 'function') && reveal.card;

    el.classList.remove('is-out', 'has-card');
    el.innerHTML = '';

    const txt = document.createElement('div');
    txt.className = 'las-play-reveal-text';
    txt.textContent = text;
    el.appendChild(txt);

    if (hasCard) {
      el.classList.add('has-card');
      const thumb = makePlayRevealCardEl(reveal.card, reveal.kind);
      if (thumb) el.appendChild(thumb);
    }

    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('is-in');
    playRevealTimer = setTimeout(() => hidePlayReveal(false), PLAY_REVEAL_MS);
    return true;
  }

  function maybeShowPlayRevealFromState(game, prev) {
    if (!game || !prev) return false;
    const reveal = game.lastPlayReveal;
    if (!reveal || !reveal.id) return false;
    if (reveal.id === prev.lastPlayRevealId) return false;
    return showPlayReveal(reveal);
  }

  function onPlayReveal(data) {
    const reveal = data && data.reveal;
    showPlayReveal(reveal);
  }

  function logEntryText(entry) {
    if (entry == null) return '';
    if (typeof entry === 'string') return entry;
    return String(entry.text || '');
  }

  function playerByIdLocal(game, id) {
    return (game.players || []).find((p) => p.id === id) || null;
  }

  function isNoiseActionLog(text) {
    if (!text) return true;
    if (text.indexOf('——') >= 0) return true;
    if (text.indexOf('结算动画') >= 0) return true;
    if (text.indexOf('发动功能「') >= 0) return true;
    return false;
  }

  function logActorIsOther(text, game, meId) {
    const me = mePlayer(game, meId);
    const myName = me && me.name;
    if (myName && text.indexOf(myName) === 0) return false;
    for (const p of game.players || []) {
      if (!p || p.id === meId || !p.name) continue;
      if (text.indexOf(p.name) === 0) return true;
    }
    return false;
  }

  /** 日志中含其他玩家名 + 可见操作关键词（含中立骰、雇佣军等） */
  function logMentionsOtherAction(text, game, meId) {
    if (!text || isNoiseActionLog(text)) return false;
    if (logActorIsOther(text, game, meId)) return true;
    const me = mePlayer(game, meId);
    if (me && me.name && text.indexOf(me.name) >= 0) return false;
    const actionRe =
      /中立骰|雇佣|强盗来袭|派遣|投掷|遥控骰|触发「|跳过.*骰|集中.*中立|移动中立|许愿井|驱逐|抢劫|弃置功能|弃置建筑|放置好|发动「/;
    if (!actionRe.test(text)) return false;
    for (const p of game.players || []) {
      if (!p || p.id === meId || !p.name) continue;
      if (text.indexOf(p.name) >= 0) return true;
    }
    return false;
  }

  /** play-reveal 已播报时，避免日志再弹同款顶部 toast */
  function playRevealSuppressesLogToast(game, meId, prev, logText) {
    const reveal = game && game.lastPlayReveal;
    if (!reveal || !reveal.id || reveal.id === prev.lastPlayRevealId) return false;
    if (!reveal.actorId || reveal.actorId === meId) return false;
    if (!logText) return false;
    if (reveal.stepText && logText === reveal.stepText) return true;
    if (
      reveal.kind === 'step' ||
      reveal.kind === 'building' ||
      reveal.kind === 'function'
    ) {
      return logActorIsOther(logText, game, meId);
    }
    return false;
  }

  function otherPlayerName(game, playerId) {
    const p = playerByIdLocal(game, playerId);
    return (p && p.name) || '?';
  }

  function otherEventChoiceToast(choice, name) {
    if (!choice || !choice.needChoice) return '';
    const label = choice.label || '';
    switch (choice.needChoice) {
      case 'moveNeutral':
        return t('lasidao.turnToastOtherMoveNeutral', { name, label });
      case 'gatherNeutrals':
        return t('lasidao.turnToastOtherGatherNeutrals', { name, label });
      case 'recallDie':
        return t('lasidao.turnToastOtherRecall', { name, label });
      case 'teleportDie':
        return t('lasidao.turnToastOtherTeleport', { name, label });
      case 'moveBarrenMarker':
        return t('lasidao.turnToastOtherBarren', { name, label });
      case 'pickResource':
      case 'pickTwoResources':
        return t('lasidao.turnToastOtherEnvPick', { name, label });
      default:
        return t('lasidao.turnToastOtherEvent', { name, label });
    }
  }

  function captureTurnToastSnap(game, meId) {
    const me = mePlayer(game, meId);
    const idle =
      me == null
        ? 0
        : me.idle != null
          ? Number(me.idle) || 0
          : Math.max(0, (me.villagers || 0) - (me.dispatched || 0));
    return {
      phase: game.phase,
      round: game.round,
      myTurn: isMyTurn(game, meId),
      awaiting: isAwaitingRoll(game),
      diceN: Array.isArray(game.dice) ? game.dice.length : 0,
      idle,
      buildPassed: Boolean(
        (me && me.buildPassed) || (game.me && game.me.buildPassed)
      ),
      currentPlayerId: game.currentPlayerId || null,
      logLen: Array.isArray(game.log) ? game.log.length : 0,
      lastPlayRevealId:
        (game.lastPlayReveal && game.lastPlayReveal.id) || null,
      pendingChoiceKey:
        game.pendingEventChoice && game.pendingEventChoice.playerId
          ? `${game.pendingEventChoice.playerId}:${game.pendingEventChoice.needChoice || ''}:${game.pendingEventChoice.teleportStep || ''}`
          : null,
      mercenaryKey:
        game.phase === 'event_mercenary' && game.mercenary
          ? (() => {
              const q0 = (game.mercenary.queue && game.mercenary.queue[0]) || {};
              return `${q0.playerId || ''}:${(game.mercenary.roll || []).join(',')}:${(game.mercenary.placed || []).length}`;
            })()
          : null,
      lastProduceFxId: (game.lastProduceFx && game.lastProduceFx.id) || null,
      settleDiscardKey:
        game.phase === 'settle_act' && Array.isArray(game.settleDiscardPending)
          ? game.settleDiscardPending
              .map((p) => p.id)
              .sort()
              .join(',')
          : '',
      wishWellKey:
        game.phase === 'wish_well' && Array.isArray(game.wishWellPending)
          ? game.wishWellPending
              .map((p) => p.id)
              .sort()
              .join(',')
          : '',
      prisonerDiscard: Number(game.pendingPrisonerDiscard) || 0,
    };
  }

  function lastLogText(game) {
    const logs = game && game.log;
    if (!logs || !logs.length) return '';
    const last = logs[logs.length - 1];
    return last == null ? '' : String(last);
  }

  function getTurnToastInfo(game, meId) {
    if (!game || !meId || game.over) return null;
    if (!isMyTurn(game, meId)) return null;

    if (game.phase === 'produce') {
      if (isAwaitingRoll(game)) {
        return { text: t('lasidao.turnToastRoll') };
      }
      return null;
    }

    if (game.phase === 'build') {
      const me = mePlayer(game, meId);
      const passed = Boolean(
        (me && me.buildPassed) || (game.me && game.me.buildPassed)
      );
      if (passed) return null;
      return { text: t('lasidao.turnToastBuild') };
    }

    return null;
  }

  function maybeShowEventToasts(game, meId, prev, cur) {
    if (!prev || !cur) return false;

    if (cur.phase === 'build' && prev.phase !== 'build') {
      showTurnToast(t('lasidao.turnToastBuildPhase'));
      return true;
    }

    if (cur.phase === 'build' && cur.buildPassed && !prev.buildPassed) {
      showTurnToast(t('lasidao.turnToastBuildPassed'));
      return true;
    }

    // ??????????/??
    if (prev.phase === 'produce' && prev.myTurn && !prev.awaiting) {
      const log = lastLogText(game);
      const isVoid =
        log.indexOf('\u7206\u6389 1 \u679a\u9ab0\u5b50') >= 0 ||
        log.indexOf('\u8df3\u8fc7\u672c\u56de\u5408\uff08\u4e0d\u7206\u9ab0\uff09') >= 0;
      const diceCleared = prev.diceN > 0 && cur.diceN === 0;
      const turnLeft = !cur.myTurn || cur.phase !== 'produce';
      const reAwait =
        cur.phase === 'produce' && cur.myTurn && cur.awaiting;

      if (isVoid && (diceCleared || turnLeft || reAwait)) {
        showTurnToast(t('lasidao.turnToastVoidSkip'));
        return true;
      }
      if (diceCleared || (turnLeft && prev.diceN > 0)) {
        if (!reAwait) {
          // 仍有空闲村民时稍后还会再轮到你，不能提示「轮空至生产结束」
          const stillIdle = (cur.idle || 0) > 0;
          showTurnToast(
            t(
              stillIdle
                ? 'lasidao.turnToastDicePartial'
                : 'lasidao.turnToastDiceDone'
            )
          );
          return true;
        }
      }
    }
    return false;
  }

  /** 其他玩家操作 / 回合切换：与「轮到你了」同款顶部提示 */
  function maybeShowOtherPlayerToasts(game, meId, prev, cur) {
    if (!prev || !cur || !game || !meId) return false;

    const fx = game.lastProduceFx;
    if (
      fx &&
      fx.id &&
      fx.id !== prev.lastProduceFxId &&
      fx.actorId &&
      fx.actorId !== meId
    ) {
      const name = otherPlayerName(game, fx.actorId);
      if (fx.type === 'dispatch') {
        const slot = fx.number != null ? fx.number : fx.face;
        showTurnToast(
          t('lasidao.turnToastOtherDispatch', {
            name,
            area: areaLabel(fx.area || 'resource'),
            n: slot,
            count: fx.count || 1,
          })
        );
        return true;
      }
      if (fx.type === 'banditRaid') {
        const slot = fx.number != null ? fx.number : fx.face;
        showTurnToast(
          t('lasidao.turnToastOtherBanditRaid', {
            name,
            area: areaLabel(fx.area || 'resource'),
            n: slot,
          })
        );
        return true;
      }
      if (fx.type === 'exile') {
        showTurnToast(t('lasidao.turnToastOtherExile', { name }));
        return true;
      }
    }

    const choice = game.pendingEventChoice;
    if (
      choice &&
      choice.playerId &&
      choice.playerId !== meId &&
      !choice.forMe &&
      cur.pendingChoiceKey &&
      cur.pendingChoiceKey !== prev.pendingChoiceKey
    ) {
      const toast = otherEventChoiceToast(
        choice,
        otherPlayerName(game, choice.playerId)
      );
      if (toast) {
        showTurnToast(toast);
        return true;
      }
    }

    const merc = game.mercenary;
    if (
      game.phase === 'event_mercenary' &&
      merc &&
      !merc.forMe &&
      cur.mercenaryKey &&
      cur.mercenaryKey !== prev.mercenaryKey
    ) {
      const q0 = (merc.queue && merc.queue[0]) || {};
      if (q0.playerId && q0.playerId !== meId) {
        const name = otherPlayerName(game, q0.playerId);
        const roll = merc.roll || [];
        if (!roll.length) {
          showTurnToast(t('lasidao.turnToastOtherMercenaryRoll', { name }));
          return true;
        }
        const idx = currentMercenaryDieIndex(merc);
        if (idx >= 0) {
          showTurnToast(
            t('lasidao.turnToastOtherMercenaryPlace', {
              name,
              face: roll[idx],
              cur: idx + 1,
              total: roll.length,
            })
          );
          return true;
        }
      }
    }

    const logs = game.log || [];
    const prevLen = Number(prev.logLen) || 0;
    if (logs.length > prevLen) {
      let lastOther = null;
      let produceStartName = null;
      for (let i = prevLen; i < logs.length; i++) {
        const text = logEntryText(logs[i]);
        if (!text || isNoiseActionLog(text)) continue;
        if (text.indexOf('生产阶段开始，轮到 ') === 0) {
          produceStartName = text.slice('生产阶段开始，轮到 '.length).trim();
          continue;
        }
        if (logMentionsOtherAction(text, game, meId)) lastOther = text;
      }
      if (lastOther) {
        if (!playRevealSuppressesLogToast(game, meId, prev, lastOther)) {
          showTurnToast(lastOther);
          return true;
        }
      }
      if (produceStartName) {
        const me = mePlayer(game, meId);
        if (!me || me.name !== produceStartName) {
          showTurnToast(
            t('lasidao.turnToastOtherRoll', { name: produceStartName })
          );
          return true;
        }
      }
    }

    if (
      cur.currentPlayerId &&
      cur.currentPlayerId !== prev.currentPlayerId &&
      cur.currentPlayerId !== meId
    ) {
      const actor = playerByIdLocal(game, cur.currentPlayerId);
      const name = actor ? actor.name : '?';
      if (
        cur.phase === 'produce' &&
        cur.awaiting &&
        prev.phase === 'produce'
      ) {
        showTurnToast(t('lasidao.turnToastOtherRoll', { name }));
        return true;
      }
      if (cur.phase === 'build' && prev.phase === 'build') {
        if (actor && !actor.buildPassed) {
          showTurnToast(t('lasidao.turnToastOtherBuild', { name }));
          return true;
        }
      }
      if (
        cur.phase === 'settle_act' &&
        prev.phase === 'settle_act' &&
        name
      ) {
        showTurnToast(t('lasidao.turnToastOtherDiscard', { names: name }));
        return true;
      }
      if (
        cur.phase === 'event_discard' &&
        prev.phase === 'event_discard' &&
        name
      ) {
        showTurnToast(t('lasidao.turnToastOtherDiscard', { names: name }));
        return true;
      }
    }

    if (
      cur.phase === 'settle_act' &&
      prev.phase !== 'settle_act' &&
      cur.settleDiscardKey
    ) {
      const names = formatPendingNames(game.settleDiscardPending, meId);
      if (names) {
        showTurnToast(t('lasidao.turnToastOtherDiscard', { names }));
        return true;
      }
    }

    if (
      cur.phase === 'wish_well' &&
      (prev.phase !== 'wish_well' || cur.wishWellKey !== prev.wishWellKey)
    ) {
      const pending = game.wishWellPending || [];
      const myPending = pending.some((p) => p.id === meId);
      if (!myPending) {
        const names = formatPendingNames(pending, meId);
        if (names) {
          showTurnToast(t('lasidao.turnToastOtherWishWell', { names }));
          return true;
        }
      }
    }

    return false;
  }

  function maybeShowTurnToast(game, meId) {
    if (!game || !meId) return;
    const cur = captureTurnToastSnap(game, meId);
    const prev = turnToastSnap;
    turnToastSnap = cur;

    maybeShowPlayRevealFromState(game, prev);

    const showedEvent = maybeShowEventToasts(game, meId, prev, cur);
    const showedOther = maybeShowOtherPlayerToasts(game, meId, prev, cur);

    const info = getTurnToastInfo(game, meId);
    if (!info) {
      turnToastArmed = true;
      return;
    }
    if (!turnToastArmed) return;
    turnToastArmed = false;
    if (showedEvent || showedOther) {
      setTimeout(() => {
        if (lastGame && getTurnToastInfo(lastGame, lastMeId)) {
          showTurnToast(info.text);
        }
      }, 1700);
    } else {
      showTurnToast(info.text);
    }
  }

  function ensureCardTip() {
    let tip = $('las-card-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'las-card-tip';
      tip.className = 'las-card-tip';
      tip.hidden = true;
    }
    // 规则弹窗会挂到 body；大图 tip 也必须在 body，且 z-index 高于 .modal
    if (tip.parentNode !== document.body) {
      document.body.appendChild(tip);
    }
    return tip;
  }

  function hideCardTip() {
    const tip = $('las-card-tip');
    if (!tip) return;
    tip.hidden = true;
    tip.innerHTML = '';
    tip.classList.remove(
      'has-preview',
      'has-multi-preview',
      'is-pinned',
      'is-perm-tip'
    );
    tip._lasTipText = '';
    tip._lasTipImg = '';
    tip._lasTipPinned = false;
    tip.style.left = '';
    tip.style.top = '';
  }

  /** 点击后立刻关掉悬停：自定义大图 tip + 浏览器原生 title（否则会粘在点击后的按钮上） */
  function dismissHoverHints(fromEl) {
    hideCardTip();
    const el =
      fromEl && fromEl.closest
        ? fromEl.closest('button,[title]') || fromEl
        : fromEl;
    if (!el || !el.getAttribute) return;
    const saved = el.getAttribute('title');
    if (!saved) return;
    el.removeAttribute('title');
    const restore = () => {
      if (!el.getAttribute('title')) el.setAttribute('title', saved);
      el.removeEventListener('pointerleave', restore);
      el.removeEventListener('blur', restore);
    };
    el.addEventListener('pointerleave', restore);
    el.addEventListener('blur', restore);
  }

  function positionCardTip(tip, evt, anchorEl) {
    let x = 12;
    let y = 12;
    if (evt && typeof evt.clientX === 'number') {
      x = evt.clientX + 16;
      y = evt.clientY + 16;
    } else if (anchorEl && anchorEl.getBoundingClientRect) {
      const r = anchorEl.getBoundingClientRect();
      x = r.right + 10;
      y = r.top;
    }
    const pad = 8;
    const tw = tip.offsetWidth || (tip.classList.contains('has-preview') ? 480 : 220);
    const th = tip.offsetHeight || (tip.classList.contains('has-preview') ? 640 : 120);
    if (x + tw > window.innerWidth - pad) {
      x = Math.max(pad, (evt && evt.clientX != null ? evt.clientX : x) - tw - 16);
    }
    if (y + th > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - th - pad);
    }
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  /** 弹窗外「显示/隐藏」：跟弹窗开关绑定，不跟内容折叠走 */
  let modalVisToggleInstalled = false;
  const modalVisToggleBtns = new WeakMap();

  function modalVisToggleLabel() {
    return t('lasidao.modalToggleVis') || '显示/隐藏';
  }

  function syncModalVisTogglePositions() {
    const openBtns = [];
    document.querySelectorAll('.las-modal-vis-toggle').forEach((btn) => {
      if (!btn.hidden) openBtns.push(btn);
    });
    openBtns.forEach((btn, i) => {
      btn.style.setProperty('--las-modal-vis-i', String(i));
    });
  }

  function ensureModalVisToggleBtn(modal) {
    let btn = modalVisToggleBtns.get(modal);
    if (btn && btn.isConnected) return btn;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'las-modal-vis-toggle';
    btn.textContent = modalVisToggleLabel();
    btn.hidden = true;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (modal.hidden) return;
      modal.classList.toggle('is-content-hidden');
      const collapsed = modal.classList.contains('is-content-hidden');
      btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    });
    document.body.appendChild(btn);
    modalVisToggleBtns.set(modal, btn);
    return btn;
  }

  function syncModalVisToggle(modal) {
    if (!modal || !modal.classList || !modal.classList.contains('modal')) return;
    const btn = ensureModalVisToggleBtn(modal);
    btn.textContent = modalVisToggleLabel();
    if (modal.hidden) {
      btn.hidden = true;
      modal.classList.remove('is-content-hidden');
      btn.setAttribute('aria-pressed', 'false');
    } else {
      btn.hidden = false;
      btn.setAttribute(
        'aria-pressed',
        modal.classList.contains('is-content-hidden') ? 'true' : 'false'
      );
    }
    syncModalVisTogglePositions();
  }

  function installModalVisibilityToggles() {
    if (modalVisToggleInstalled) return;
    modalVisToggleInstalled = true;
    const root = $('panel-lasidao') || document;
    const modals = root.querySelectorAll
      ? root.querySelectorAll('.modal')
      : [];
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'hidden') {
          syncModalVisToggle(m.target);
        }
      }
    });
    modals.forEach((modal) => {
      obs.observe(modal, { attributes: true, attributeFilter: ['hidden'] });
      syncModalVisToggle(modal);
    });
  }

  function showCardTip(text, evt, anchorEl, imgUrl, pinned) {
    const tip = ensureCardTip();
    const nextText = text || '';
    const imgList = Array.isArray(imgUrl)
      ? imgUrl.filter(Boolean)
      : imgUrl
        ? [imgUrl]
        : [];
    const nextImg = imgList.join('\n');
    const changed =
      tip._lasTipText !== nextText || tip._lasTipImg !== nextImg;
    if (changed) {
      tip._lasTipText = nextText;
      tip._lasTipImg = nextImg;
      tip.innerHTML = '';
      tip.classList.toggle('has-preview', imgList.length > 0);
      tip.classList.toggle('has-multi-preview', imgList.length > 1);
      if (imgList.length === 1) {
        const preview = document.createElement('div');
        preview.className = 'las-card-tip-preview';
        preview.style.backgroundImage = 'url("' + imgList[0] + '")';
        tip.appendChild(preview);
      } else if (imgList.length > 1) {
        const row = document.createElement('div');
        row.className = 'las-card-tip-preview-row';
        for (const u of imgList) {
          const preview = document.createElement('div');
          preview.className = 'las-card-tip-preview is-stash-mini';
          preview.style.backgroundImage = 'url("' + u + '")';
          row.appendChild(preview);
        }
        tip.appendChild(row);
      }
      if (nextText) {
        const desc = document.createElement('div');
        desc.className = 'las-card-tip-desc';
        desc.textContent = nextText;
        tip.appendChild(desc);
      }
    }
    tip._lasTipPinned = Boolean(pinned);
    tip.classList.toggle('is-pinned', Boolean(pinned));
    tip.hidden = false;
    tip.style.pointerEvents = 'none';
    positionCardTip(tip, evt, anchorEl);
  }

  function formatCost(cost, labels) {
    if (!cost || typeof cost !== 'object') return '?';
    const labs = labels || defaultResLabels();
    const parts = [];
    for (const [k, v] of Object.entries(cost)) {
      if (!v) continue;
      parts.push((labs[k] || k) + v);
    }
    return parts.length ? parts.join(' ') : '?';
  }

  /** 常驻操作按钮外包一层，禁用时仍可悬停显示消耗提示 */
  function ensurePermBtnWrap(btn) {
    if (!btn) return null;
    let wrap = btn.parentElement;
    if (wrap && wrap.classList.contains('las-perm-btn-wrap')) return wrap;
    wrap = document.createElement('span');
    wrap.className = 'las-perm-btn-wrap';
    if (btn.classList.contains('las-perm-reset')) {
      wrap.classList.add('las-perm-reset');
    }
    btn.parentNode.insertBefore(wrap, btn);
    wrap.appendChild(btn);
    if (!wrap.__lasTipBound) {
      wrap.__lasTipBound = true;
      wrap.addEventListener('mouseenter', (e) => {
        if (!wrap.dataset.lasTip) return;
        showCardTip(wrap.dataset.lasTip, e, wrap, null, false);
        const tip = $('las-card-tip');
        if (tip) tip.classList.add('is-perm-tip');
      });
      wrap.addEventListener('mousemove', (e) => {
        const tip = $('las-card-tip');
        if (!tip || tip.hidden) return;
        positionCardTip(tip, e, wrap);
      });
      wrap.addEventListener('mouseleave', () => hideCardTip());
      wrap.addEventListener('pointerdown', () => hideCardTip());
      btn.addEventListener('click', () => hideCardTip());
    }
    return wrap;
  }

  function formatPermanentTip(action, cost) {
    const costLine = cost ? String(cost).trim() : t('lasidao.permanentNoCost');
    return t('lasidao.permanentPhaseTip', { action, cost: costLine });
  }

  function setPermBtnTip(btn, text) {
    const wrap = ensurePermBtnWrap(btn);
    if (!wrap) return;
    wrap.dataset.lasTip = text || '';
    btn.removeAttribute('title');
  }

  function lackHouseCostTip(game, houseCost) {
    const c = houseCost || { wood: 3, stone: 3, iron: 1 };
    return t('lasidao.buildHouseLack', {
      wood: c.wood || 0,
      stone: c.stone || 0,
      iron: c.iron || 0,
    });
  }

  function faceDownCardKind(tile, areaKey) {
    if (tile && tile.backKind) return tile.backKind;
    if (tile && tile.kind === 'building') return 'building';
    if (tile && tile.kind === 'function') return 'function';
    if (tile && tile.kind === 'resource') return 'resource';
    if (tile && tile.kind === 'environment') return 'environment';
    if (areaKey === 'building') return 'building';
    if (areaKey === 'function') return 'function';
    if (areaKey === 'resource') return 'resource';
    if (areaKey === 'environment') return 'environment';
    return 'function';
  }

  function faceDownDetailText(tile, areaKey) {
    const ck = faceDownCardKind(tile, areaKey);
    const kindLabel =
      ck === 'building'
        ? t('lasidao.tip.buildingCard')
        : ck === 'function'
          ? t('lasidao.tip.functionCard')
          : ck === 'environment'
            ? t('lasidao.environmentSlot')
            : t('lasidao.tip.resourceCard');
    return t('lasidao.faceDown') + ' · ' + kindLabel + '\n' + t('lasidao.faceDownTip');
  }

  function resourceDetail(tile) {
    const name = tile.label || t('lasidao.tip.unknown');
    const richTxt = tile.rich
      ? t('lasidao.tip.rich')
      : t('lasidao.tip.poor');
    const large = tile.large != null ? tile.large : '?';
    const small = tile.small != null ? tile.small : '?';
    const num =
      tile.number != null
        ? t('lasidao.tip.boardSlot', { n: tile.number })
        : t('lasidao.tip.boardSlotUnset');
    return (
      name +
      '\n' +
      t('lasidao.tip.richPoor') +
      richTxt +
      '\n' +
      t('lasidao.tip.largeSmall', { large, small }) +
      '\n' +
      num
    );
  }

  function functionDetail(tile, areaKey) {
    if (tile && tile.faceDown) {
      return faceDownDetailText(tile, areaKey);
    }
    const name = tile.label || 'func';
    const rule = funcRuleText(tile.funcType) || tile.funcType || '';
    return name + '\n' + rule;
  }

  function buildingDetail(tile, labels, areaKey) {
    if (tile && tile.faceDown) {
      return faceDownDetailText(tile, areaKey);
    }
    const name = tile.label || t('lasidao.tip.unknown');
    const costTxt =
      t('lasidao.tip.cost') + formatCost(tile.cost, labels);
    let effect = '';
    if (tile.buildType === 'produce') {
      const amt = tile.produce != null ? tile.produce : tile.rich ? 2 : 1;
      effect = t('lasidao.tip.produceEffect', {
        amt,
        rich: tile.rich ? t('lasidao.tip.rich') : t('lasidao.tip.poor'),
      });
    } else if (tile.buildType === 'score2') {
      effect = t('lasidao.tip.score2Effect', {
        score: tile.score != null ? tile.score : 2,
      });
    } else if (tile.buildType === 'score1') {
      effect = t('lasidao.tip.score1Effect', {
        score: tile.score != null ? tile.score : 1,
      });
    } else if (tile.buildType === 'exchange') {
      effect = t('lasidao.exchangeCardTip');
    } else if (tile.buildType === 'wishWell') {
      effect = t('lasidao.tip.wishWellEffect');
    } else if (tile.buildType === 'eternalThrone') {
      effect = t('lasidao.tip.eternalThroneEffect');
    } else if (tile.score) {
      effect = t('lasidao.tip.scoreEffect', { score: tile.score });
    } else if (tile.produce) {
      effect = t('lasidao.tip.produceAmt', { amt: tile.produce });
    } else {
      effect = t('lasidao.tip.buildingGeneric');
    }
    const num =
      tile.number != null
        ? '\n' + t('lasidao.tip.boardSlot', { n: tile.number })
        : '';
    return name + '\n' + costTxt + '\n' + effect + num;
  }

  function tileDetailText(tile, areaKey, labels) {
    if (tile && tile.faceDown) {
      return faceDownDetailText(tile, areaKey);
    }
    const kind = tile.kind || areaKey;
    if (kind === 'environment' || areaKey === 'environment') {
      return environmentDetail(tile);
    }
    if (kind === 'resource' || areaKey === 'resource') {
      return resourceDetail(tile);
    }
    if (kind === 'function' || tile.funcType) {
      return functionDetail(tile, areaKey);
    }
    return buildingDetail(tile, labels, areaKey);
  }

  function tileImageUrl(tile, areaKey) {
    const Assets = window.LasidaoAssets;
    if (!Assets) return '';
    const kind = (tile && tile.kind) || areaKey;
    if (tile && tile.faceDown) {
      return typeof Assets.cardBackImageUrl === 'function'
        ? Assets.cardBackImageUrl(faceDownCardKind(tile, areaKey)) || ''
        : '';
    }
    if (
      (kind === 'resource' || areaKey === 'resource') &&
      tile &&
      tile.useHandArt &&
      typeof Assets.resourceHandImageUrl === 'function'
    ) {
      return Assets.resourceHandImageUrl(tile.resource) || '';
    }
    if (
      (kind === 'resource' || areaKey === 'resource') &&
      typeof Assets.resourceImageUrl === 'function'
    ) {
      return Assets.resourceImageUrl(tile) || '';
    }
    if (
      (kind === 'environment' || areaKey === 'environment') &&
      typeof Assets.environmentImageUrl === 'function'
    ) {
      return Assets.environmentImageUrl(tile) || '';
    }
    if (
      (kind === 'function' || (tile && tile.funcType)) &&
      typeof Assets.functionImageUrl === 'function'
    ) {
      return Assets.functionImageUrl(tile) || '';
    }
    if (typeof Assets.buildingImageUrl === 'function') {
      return Assets.buildingImageUrl(tile) || '';
    }
    return '';
  }

  function bindTileTip(card, tile, areaKey) {
    card.style.pointerEvents = 'auto';
    const imgUrl = tileImageUrl(tile, areaKey);
    card.addEventListener('mouseenter', (e) => {
      const labels = getResLabels(lastGame);
      showCardTip(
        tileDetailText(tile, areaKey, labels),
        e,
        card,
        imgUrl
      );
    });
    card.addEventListener('mousemove', (e) => {
      const tip = $('las-card-tip');
      if (!tip || tip.hidden) return;
      positionCardTip(tip, e, card);
    });
    card.addEventListener('mouseleave', () => hideCardTip());
    card.addEventListener('pointerdown', () => hideCardTip());
    card.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
  }

  /** 不可点但仍可悬停看大图（勿用 native disabled，否则无 mouseenter） */
  function setLasCardInert(el, inert) {
    if (!el) return;
    el.disabled = false;
    if (inert) {
      el.setAttribute('aria-disabled', 'true');
      el.classList.add('is-inert');
    } else {
      el.removeAttribute('aria-disabled');
      el.classList.remove('is-inert');
    }
  }

  function isLasCardInert(el) {
    return Boolean(el && el.getAttribute('aria-disabled') === 'true');
  }

  function bindImageTip(el, imgUrl, text) {
    if (!el || !imgUrl) return;
    el.style.pointerEvents = 'auto';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.addEventListener('mouseenter', (e) => {
      const tip = $('las-card-tip');
      if (tip && tip._lasTipPinned) return;
      showCardTip(text || '', e, el, imgUrl, false);
    });
    el.addEventListener('mousemove', (e) => {
      const tip = $('las-card-tip');
      if (!tip || tip.hidden || tip._lasTipPinned) return;
      positionCardTip(tip, e, el);
    });
    el.addEventListener('mouseleave', () => {
      const tip = $('las-card-tip');
      if (tip && tip._lasTipPinned) return;
      hideCardTip();
    });
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tip = $('las-card-tip');
      if (
        tip &&
        !tip.hidden &&
        tip._lasTipPinned &&
        tip._lasTipImg === imgUrl
      ) {
        hideCardTip();
        return;
      }
      showCardTip(text || '', e, el, imgUrl, true);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      el.click();
    });
  }

  if (typeof document !== 'undefined' && !window.__lasCardTipOutsideBound) {
    window.__lasCardTipOutsideBound = true;
    document.addEventListener(
      'pointerdown',
      (e) => {
        const tip = $('las-card-tip');
        if (!tip || tip.hidden || !tip._lasTipPinned) return;
        const t = e.target;
        if (t && t.closest && t.closest('.las-rules-card-thumb')) return;
        hideCardTip();
      },
      true
    );
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const tip = $('las-card-tip');
      if (tip && tip._lasTipPinned) hideCardTip();
    });
    // 操作栏 / 侧栏按钮：点击后立刻清掉原生 title 悬停，避免粘滞
    document.addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target;
        if (!t || !t.closest) return;
        const btn = t.closest(
          '.lasidao-panel .las-actions button, .lasidao-panel .las-act-wrap button, .lasidao-panel .las-permanent-grid button, .lasidao-panel .las-permanent-grid .las-perm-btn-wrap, .lasidao-panel .las-pass-row button'
        );
        if (!btn) return;
        dismissHoverHints(btn);
      },
      true
    );
  }

  if (typeof document !== 'undefined' && !window.__lasSettleUnstickBound) {
    window.__lasSettleUnstickBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !lastGame) return;
      ensureSettleAnimAck(lastGame);
      if (lastGame.phase === 'settle' && !settlePlaying) {
        maybePlaySettle(lastGame);
      }
    });
  }

  function makeTileCard(tile, areaKey) {
    const card = document.createElement('div');
    card.className = 'las-tile ' + (tile.kind || areaKey);
    card.dataset.tileId = tile.id || '';

    const art = document.createElement('div');
    art.className = 'las-tile-art';
    art.setAttribute('aria-hidden', 'true');
    let hasArt = false;
    if (
      (areaKey === 'resource' || tile.kind === 'resource') &&
      window.LasidaoAssets &&
      typeof window.LasidaoAssets.applyResourceArt === 'function'
    ) {
      hasArt = Boolean(window.LasidaoAssets.applyResourceArt(art, tile));
    }
    if (
      !hasArt &&
      (areaKey === 'function' || tile.kind === 'function') &&
      window.LasidaoAssets &&
      typeof window.LasidaoAssets.applyFunctionArt === 'function'
    ) {
      hasArt = Boolean(window.LasidaoAssets.applyFunctionArt(art, tile));
    }
    if (
      !hasArt &&
      (areaKey === 'building' || tile.kind === 'building') &&
      window.LasidaoAssets &&
      typeof window.LasidaoAssets.applyBuildingArt === 'function'
    ) {
      hasArt = Boolean(window.LasidaoAssets.applyBuildingArt(art, tile));
    }
    card.appendChild(art);

    if (tile.faceDown) {
      card.classList.add('is-facedown');
      const backKind = faceDownCardKind(tile, areaKey);
      if (
        window.LasidaoAssets &&
        typeof window.LasidaoAssets.applyCardBackArt === 'function'
      ) {
        hasArt = Boolean(
          window.LasidaoAssets.applyCardBackArt(art, backKind)
        );
      }
      if (hasArt) {
        card.classList.add('has-art', 'has-back');
        card.setAttribute('aria-label', faceDownDetailText(tile, areaKey).split('\n')[0]);
      } else {
        const name = document.createElement('div');
        name.className = 'las-tile-name';
        name.textContent = t('lasidao.faceDown');
        card.appendChild(name);
        const meta = document.createElement('div');
        meta.className = 'las-tile-meta';
        meta.textContent =
          faceDownCardKind(tile, areaKey) === 'building'
            ? t('lasidao.tip.buildingCard')
            : faceDownCardKind(tile, areaKey) === 'resource'
              ? t('lasidao.tip.resourceCard')
              : t('lasidao.tip.functionCard');
        card.appendChild(meta);
      }
      bindTileTip(
        card,
        { ...tile, faceDown: true, label: null },
        areaKey
      );
      return card;
    }

    if (hasArt) {
      card.classList.add('has-art');
      card.setAttribute('aria-label', tile.label || '');
      bindTileTip(card, tile, areaKey);
      return card;
    }

    const name = document.createElement('div');
    name.className = 'las-tile-name';
    name.textContent = tile.label || '';
    card.appendChild(name);

    let metaTxt = '';
    const isBld = areaKey === 'building' || tile.kind === 'building';
    if ((areaKey === 'resource' || tile.kind === 'resource') && tile.large != null) {
      metaTxt = tile.large + '/' + tile.small;
    } else if (isBld && tile.buildType === 'produce') {
      metaTxt =
        tile.produce != null
          ? '?' + tile.produce
          : tile.rich
            ? '?2'
            : '?1';
    } else if (isBld && tile.buildType === 'score2') {
      metaTxt = '+' + (tile.score != null ? tile.score : 2);
    } else if (isBld && tile.buildType === 'score1') {
      metaTxt = '+' + (tile.score != null ? tile.score : 1);
    } else if (isBld && tile.buildType === 'exchange') {
      metaTxt = t('lasidao.tip.exchangeShort');
    } else if (isBld && tile.buildType === 'wishWell') {
      metaTxt = t('lasidao.tip.wishWellShort');
    } else if (isBld && tile.buildType === 'eternalThrone') {
      metaTxt = t('lasidao.tip.eternalThroneShort');
    }
    if (metaTxt) {
      const meta = document.createElement('div');
      meta.className = 'las-tile-meta';
      meta.textContent = metaTxt;
      card.appendChild(meta);
    }

    bindTileTip(card, tile, areaKey);
    return card;
  }

  function environmentDetail(tile) {
    const title = (tile && tile.label) || t('lasidao.environmentSlot');
    const triggerKey =
      tile && tile.trigger === 'settle'
        ? 'lasidao.environmentTriggerSettle'
        : tile && tile.trigger === 'dispatch'
          ? 'lasidao.environmentTriggerDispatch'
          : tile && tile.trigger === 'preSettle'
            ? 'lasidao.environmentTriggerPreSettle'
            : null;
    const triggerLine = triggerKey ? t(triggerKey) : '';
    const desc =
      (tile && tile.desc) || t('lasidao.environmentPlaceholder');
    return [title, triggerLine, desc].filter(Boolean).join('\n');
  }

  function makeEnvironmentTileCard(tile) {
    const card = document.createElement('div');
    card.className = 'las-tile environment';
    card.dataset.tileId = tile.id || '';

    const art = document.createElement('div');
    art.className = 'las-tile-art';
    art.setAttribute('aria-hidden', 'true');
    let hasArt = false;
    if (
      window.LasidaoAssets &&
      typeof window.LasidaoAssets.applyEnvironmentArt === 'function'
    ) {
      hasArt = Boolean(window.LasidaoAssets.applyEnvironmentArt(art, tile));
    }
    card.appendChild(art);

    if (hasArt) {
      card.classList.add('has-art');
    } else {
      card.classList.add('is-placeholder');
      const name = document.createElement('div');
      name.className = 'las-tile-name';
      name.textContent = tile.label || t('lasidao.environmentSlot');
      card.appendChild(name);
    }

    card.setAttribute('aria-label', tile.label || t('lasidao.environmentSlot'));
    bindTileTip(card, tile, 'environment');
    return card;
  }

  /** 手牌/个人版面按钮：显示卡面图（失败时保留文字） */
  function decorateHandCardArt(el, tile, areaKey) {
    const Assets = window.LasidaoAssets;
    if (!el || !tile || !Assets) return false;

    const art = document.createElement('div');
    art.className = 'las-hand-card-art';
    art.setAttribute('aria-hidden', 'true');

    let hasArt = false;
    if (tile.faceDown) {
      const backKind = areaKey === 'building' ? 'building' : 'function';
      if (typeof Assets.applyCardBackArt === 'function') {
        hasArt = Boolean(Assets.applyCardBackArt(art, backKind));
      }
    } else if (areaKey === 'function' && typeof Assets.applyFunctionArt === 'function') {
      hasArt = Boolean(Assets.applyFunctionArt(art, tile));
    } else if (areaKey === 'building' && typeof Assets.applyBuildingArt === 'function') {
      hasArt = Boolean(Assets.applyBuildingArt(art, tile));
    }

    if (!hasArt) return false;

    el.classList.add('has-art');
    el.textContent = '';
    el.setAttribute(
      'aria-label',
      tile.faceDown ? t('lasidao.faceDown') : tile.label || ''
    );
    el.appendChild(art);
    bindTileTip(el, tile, areaKey);
    return true;
  }

  function makeFaceDownHandCard(areaKey) {
    const el = document.createElement('span');
    el.className =
      'las-card' +
      (areaKey === 'building' ? ' build' : ' func') +
      ' is-facedown';
    decorateHandCardArt(
      el,
      { faceDown: true, label: t('lasidao.faceDown') },
      areaKey === 'building' ? 'building' : 'function'
    );
    if (!el.classList.contains('has-art')) {
      el.textContent = t('lasidao.faceDown');
    }
    bindTileTip(el, { faceDown: true, kind: areaKey === 'building' ? 'building' : 'function' }, areaKey === 'building' ? 'building' : 'function');
    return el;
  }

  const PLAYER_DIE_COLORS = ['red', 'yellow', 'blue', 'green', 'pink'];

  function playerDieColor(players, playerId, game) {
    const nid =
      (game && game.neutralWorkerId) ||
      (typeof window !== 'undefined' &&
        window.__LAS_NEUTRAL__) ||
      '__neutral__';
    if (playerId === nid) return 'neutral';
    const p = (players || []).find((x) => x.id === playerId);
    const seat = p && typeof p.seat === 'number' ? p.seat : 0;
    return PLAYER_DIE_COLORS[
      ((seat % PLAYER_DIE_COLORS.length) + PLAYER_DIE_COLORS.length) %
        PLAYER_DIE_COLORS.length
    ];
  }

  function workerName(workersPid, players, game) {
    const nid = (game && game.neutralWorkerId) || '__neutral__';
    if (workersPid === nid) {
      return (game && game.neutralWorkerName) || t('lasidao.neutralName');
    }
    const p = (players || []).find((x) => x.id === workersPid);
    return p ? p.name : workersPid.slice(0, 4);
  }

  function makeDieEl(value, className, colorKey) {
    const el = document.createElement('div');
    let cls = 'las-die';
    if (className) cls += ' ' + className;
    if (colorKey) cls += ' color-' + colorKey;
    el.className = cls;
    el.textContent = String(value);
    if (colorKey) el.dataset.color = colorKey;
    return el;
  }

  function workerSlotStrength(count, boosted) {
    const n = Number(count) || 0;
    const b = Math.min(Math.max(0, Number(boosted) || 0), n);
    return (n * 2 + b) / 2;
  }

  function formatWorkerStrength(count, boosted) {
    const s = workerSlotStrength(count, boosted);
    return Number.isInteger(s) ? String(s) : s.toFixed(1);
  }

  function appendWorkerDice(container, face, workers, players, game, opts) {
    opts = opts || {};
    const boosts = opts.boosts || {};
    const entries = Object.entries(workers || {}).filter(([, n]) => n > 0);
    if (!entries.length) return null;
    const nid = (game && game.neutralWorkerId) || '__neutral__';
    entries.sort((a, b) => {
      if (a[0] === nid) return 1;
      if (b[0] === nid) return -1;
      const pa = (players || []).find((p) => p.id === a[0]);
      const pb = (players || []).find((p) => p.id === b[0]);
      const sa = pa && typeof pa.seat === 'number' ? pa.seat : 99;
      const sb = pb && typeof pb.seat === 'number' ? pb.seat : 99;
      return sa - sb;
    });
    const wrap = document.createElement('div');
    wrap.className =
      'las-workers las-worker-dice' + (opts.overlay ? ' is-overlay' : '');
    for (const [pid, n] of entries) {
      const color = playerDieColor(players, pid, game);
      const count = Math.min(Number(n) || 0, 24);
      const boosted = Math.min(Number(boosts[pid]) || 0, count);
      const strength = workerSlotStrength(count, boosted);
      if (strength <= 0) continue;

      const row = document.createElement('div');
      row.className = 'las-worker-row is-compact';
      row.dataset.pid = pid;
      row.appendChild(makeDieEl(face, 'is-mini is-placed', color));
      const mul = document.createElement('span');
      mul.className = 'las-worker-mul';
      mul.textContent = '\u00d7' + formatWorkerStrength(count, boosted);
      if (boosted > 0) {
        mul.title = t('lasidao.workerBoostHint', {
          count,
          boost: boosted,
          strength: formatWorkerStrength(count, boosted),
        });
      }
      row.appendChild(mul);
      row.title =
        workerName(pid, players, game) +
        ' \u00d7' +
        formatWorkerStrength(count, boosted) +
        (boosted > 0
          ? ' (' + t('lasidao.boostMul', { n: boosted }) + ')'
          : '');
      wrap.appendChild(row);
    }
    container.appendChild(wrap);
    return wrap;
  }

  function workersText(workers, players, game, boosts) {
    const parts = [];
    for (const [pid, n] of Object.entries(workers || {})) {
      if (!n) continue;
      const count = Number(n) || 0;
      const boosted = Math.min(Number(boosts && boosts[pid]) || 0, count);
      parts.push(
        workerName(pid, players, game) +
          'x' +
          formatWorkerStrength(count, boosted)
      );
    }
    return parts.length ? parts.join(' ') : '';
  }

  function mePlayer(game, meId) {
    return (game.players || []).find((p) => p.id === meId) || null;
  }

  function playerVillagerTotal(p) {
    return (Number(p.villagers) || 0) + (Number(p.tempVillagers) || 0);
  }

  function playerIdleCount(p) {
    if (p && p.idle != null) return Math.max(0, Number(p.idle) || 0);
    return Math.max(
      0,
      playerVillagerTotal(p) - (Number(p.dispatched) || 0)
    );
  }

  function appendIdleVillagerBadge(parent, p, opts) {
    if (!parent || !p) return null;
    opts = opts || {};
    const idle = playerIdleCount(p);
    const total = playerVillagerTotal(p);
    const vill = document.createElement('span');
    vill.className =
      'badge las-idle-villagers' + (idle <= 0 ? ' is-zero' : '');
    if (opts.compact) {
      vill.textContent = t('lasidao.produceIdleChip', { idle, total });
      vill.title = t('lasidao.idleVillagers', {
        idle,
        total,
        dispatched: p.dispatched || 0,
      });
    } else {
      vill.textContent = t('lasidao.idleVillagers', {
        idle,
        total,
        dispatched: p.dispatched || 0,
      });
    }
    if (Number(p.tempVillagers) > 0) {
      vill.title = t('lasidao.tempVillagersActive', { n: p.tempVillagers });
    } else if (Number(p.recruitPending) > 0) {
      vill.title = t('lasidao.recruitPendingHint', { n: p.recruitPending });
    }
    parent.appendChild(vill);
    return vill;
  }

  function renderProduceIdleBar(game) {
    const bar = $('las-produce-idle');
    if (!bar) return;
    if (!game || game.phase !== 'produce') {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    bar.hidden = false;
    bar.innerHTML = '';
    const title = document.createElement('span');
    title.className = 'las-produce-idle-label muted';
    title.textContent = t('lasidao.produceIdleTitle');
    bar.appendChild(title);
    const chips = document.createElement('div');
    chips.className = 'las-produce-idle-chips';
    const players = (game.players || [])
      .slice()
      .sort((a, b) => (a.seat || 0) - (b.seat || 0));
    for (const p of players) {
      if (p.left) continue;
      const color = playerDieColor(game.players, p.id, game);
      const chip = document.createElement('div');
      chip.className = 'las-produce-idle-chip color-' + color;
      if (p.id === game.currentPlayerId) chip.classList.add('is-current');
      const swatch = document.createElement('span');
      swatch.className = 'las-die-swatch color-' + color;
      chip.appendChild(swatch);
      const name = document.createElement('span');
      name.className = 'las-produce-idle-name';
      const Nick = window.PlayerNick;
      if (Nick && Nick.formatHtml) {
        name.innerHTML = Nick.formatHtml(p.name, p.tag);
      } else {
        name.textContent = p.name || '';
      }
      chip.appendChild(name);
      const total = p.villagers || 0;
      const idle = Math.max(0, total - (p.dispatched || 0));
      const vill = document.createElement('span');
      vill.className = 'las-idle-villagers';
      vill.textContent = t('lasidao.idleVillagersShort', { idle, total });
      chip.appendChild(vill);
      chips.appendChild(chip);
    }
    bar.appendChild(chips);
  }

  function syncMeSettleSlot(game, meId) {
    const slot = $('las-me-settle-slot');
    const infoCell = $('las-pcell-info');
    const inSettle = Boolean(game && game.phase === 'settle_act');
    if (infoCell) infoCell.classList.toggle('is-settle-act', inSettle);
    if (slot) {
      slot.setAttribute('aria-hidden', 'true');
      slot.innerHTML = '';
    }
  }

  function isMyTurn(game, meId) {
    return game.currentPlayerId && meId && game.currentPlayerId === meId;
  }

  function countBuiltBuildingsUi(player) {
    if (!player) return 0;
    const n = Number(player.builtBuildingCount);
    if (Number.isFinite(n) && n >= 0) return n;
    return (player.buildings || []).filter((b) => b.built).length;
  }

  function formatPendingNames(list, meId) {
    return (list || [])
      .filter((p) => p && p.id && p.id !== meId)
      .map((p) => p.name || '?')
      .filter(Boolean)
      .join('、');
  }

  function renderLasStatus(game, meId) {
    const status = $('las-status');
    if (!status) return;
    let text = '';
    if (!game.over) {
      if (game.pendingTrade) {
        const decider =
          game.pendingTrade.toName ||
          ((game.players || []).find((p) => p.id === game.pendingTrade.toId) ||
            {}).name ||
          '?';
        text = t('lasidao.statusAwaitTrade', { name: decider });
      } else if (game.pendingIllegalBuild) {
        const pending = game.pendingIllegalBuild;
        if (pending.forMe) {
          text = t('lasidao.illegalBuildPickBuilding', {
            actor: pending.actorName || '?',
          });
        } else if (pending.isActor) {
          text = t('lasidao.illegalBuildAwaitTarget', {
            name: pending.targetName || '?',
          });
        } else {
          text = t('lasidao.illegalBuildAwaitOther', {
            target: pending.targetName || '?',
          });
        }
      } else if (game.phase === 'settle_act') {
        const me = mePlayer(game, meId);
        const myPending = Boolean(
          me &&
            (me.pendingDiscardFunc ||
              me.pendingDiscardBuild ||
              me.pendingDiscardRes)
        );
        if (!myPending) {
          const pending = Array.isArray(game.settleDiscardPending)
            ? game.settleDiscardPending
            : [];
          const names = formatPendingNames(pending, meId);
          if (names) {
            text = t('lasidao.statusAwaitDiscard', { names });
          } else if (!isMyTurn(game, meId)) {
            const cur = (game.players || []).find(
              (p) => p.id === game.currentPlayerId
            );
            if (cur) {
              text = t('lasidao.statusAwaitDiscard', { names: cur.name });
            }
          }
        }
      } else if (game.phase === 'wish_well') {
        const pending = Array.isArray(game.wishWellPending)
          ? game.wishWellPending
          : [];
        const myPending = pending.some((p) => p.id === meId);
        if (!myPending) {
          const names = formatPendingNames(pending, meId);
          if (names) {
            text = t('lasidao.statusAwaitWishWell', { names });
          }
        }
      } else if (game.phase === 'event_discard') {
        const myN = Number(game.pendingPrisonerDiscard) || 0;
        if (myN <= 0 && !isMyTurn(game, meId)) {
          const cur = (game.players || []).find(
            (p) => p.id === game.currentPlayerId
          );
          if (cur) {
            text = t('lasidao.statusAwaitDiscard', { names: cur.name });
          }
        }
      } else if (game.phase === 'settle') {
        text = t('lasidao.statusSettle');
      } else if (!isMyTurn(game, meId)) {
        const cur = (game.players || []).find(
          (p) => p.id === game.currentPlayerId
        );
        if (cur) {
          if (game.phase === 'produce') {
            text = t('lasidao.statusAwaitDispatch', { name: cur.name });
          } else if (game.phase === 'build') {
            text = t('lasidao.statusAwaitBuild', { name: cur.name });
          }
        }
      }
    }
    status.textContent = text;
    status.hidden = !text;
    syncSkipSettleBtn(game, meId);
  }

  function settleReportKey(game) {
    const report = game && game.lastSettle;
    if (!report || !report.at) return null;
    return (report.round || '') + ':' + report.at;
  }

  function clearSettleAnimWatchdogs() {
    if (settlePlayingWatchdog) {
      clearTimeout(settlePlayingWatchdog);
      settlePlayingWatchdog = null;
    }
    if (settleUnstickTimer) {
      clearTimeout(settleUnstickTimer);
      settleUnstickTimer = null;
    }
    if (produceFxWatchdog) {
      clearTimeout(produceFxWatchdog);
      produceFxWatchdog = null;
    }
    if (dispatchBusyWatchdog) {
      clearTimeout(dispatchBusyWatchdog);
      dispatchBusyWatchdog = null;
    }
  }

  function sendSettleAnimAck(key) {
    if (!key || !netRef) return false;
    if (settleAckKey === key) return false;
    settleAckKey = key;
    netRef.sendAction('finishSettleAnim', {});
    return true;
  }

  /** 结算动画 UI 收尾并上报 ack；可重复调用（幂等） */
  function finishSettleUi(key) {
    if (settlePlayingWatchdog) {
      clearTimeout(settlePlayingWatchdog);
      settlePlayingWatchdog = null;
    }
    if (settleUnstickTimer) {
      clearTimeout(settleUnstickTimer);
      settleUnstickTimer = null;
    }
    const wasPlaying = settlePlaying;
    settlePlaying = false;
    if (key) settleAnimKey = key;
    deferredHeavyRenderPending = false;
    sendSettleAnimAck(key);
    if (!wasPlaying) return;
    const status = $('las-status');
    if (lastGame && lastMeId) {
      renderMe(lastGame, lastMeId);
      renderBuildHand(lastGame, lastMeId);
      renderPlayers(lastGame, lastMeId);
      renderActRail(lastGame, lastMeId);
      renderPlayerBoards(lastGame, lastMeId);
      applyDeckUi(lastGame);
    }
    if (status && lastGame) {
      renderLasStatus(lastGame, lastMeId);
    }
    if (lastGame && lastGame.over) {
      maybeShowVictoryModal(lastGame, lastMeId);
    }
  }

  /**
   * 仍卡在 settle、本地动画已结束或超时却未 ack 时补发；
   * 刷新重进会立刻继续，多半是这里没上报过 finishSettleAnim。
   */
  function ensureSettleAnimAck(game) {
    if (!game || game.phase !== 'settle' || game.over) return;
    const key = settleReportKey(game);
    if (!key) return;
    if (settlePlaying) return;
    if (settleAnimKey === key) {
      sendSettleAnimAck(key);
    }
  }

  function armSettlePlayingWatchdog(key) {
    if (settlePlayingWatchdog) {
      clearTimeout(settlePlayingWatchdog);
      settlePlayingWatchdog = null;
    }
    // 后台标签页定时器会被节流；仍设上限，避免永久卡在 settlePlaying
    settlePlayingWatchdog = setTimeout(() => {
      settlePlayingWatchdog = null;
      if (!settlePlaying || (key && settleAnimKey !== key)) return;
      console.warn('[lasidao] settle anim watchdog: force finish');
      abortLocalSettleFx();
      finishSettleUi(key || settleAnimKey);
    }, 45000);
  }

  function scheduleSettleUnstick() {
    if (settleUnstickTimer) return;
    settleUnstickTimer = setTimeout(() => {
      settleUnstickTimer = null;
      if (!lastGame || lastGame.phase !== 'settle') return;
      if (settlePlaying) return;
      const key = settleReportKey(lastGame);
      if (!key || settleAnimKey === key) {
        ensureSettleAnimAck(lastGame);
        return;
      }
      // 派遣/特效标志位卡住会永久挡住结算动画
      if (produceFxPlaying || dispatchBusy) {
        console.warn('[lasidao] settle blocked by fx flags; clearing');
        produceFxPlaying = false;
        dispatchBusy = false;
        dispatchBoardFreeze = null;
        if (produceFxWatchdog) {
          clearTimeout(produceFxWatchdog);
          produceFxWatchdog = null;
        }
        if (dispatchBusyWatchdog) {
          clearTimeout(dispatchBusyWatchdog);
          dispatchBusyWatchdog = null;
        }
      }
      maybePlaySettle(lastGame);
    }, 8000);
  }

  function armProduceFxWatchdog() {
    if (produceFxWatchdog) clearTimeout(produceFxWatchdog);
    produceFxWatchdog = setTimeout(() => {
      produceFxWatchdog = null;
      if (!produceFxPlaying) return;
      console.warn('[lasidao] produce fx watchdog: force clear');
      produceFxPlaying = false;
      dispatchBoardFreeze = null;
      flushDeferredHeavyRender();
      if (lastGame && isSettlePipelinePhase(lastGame.phase)) {
        maybePlaySettle(lastGame);
      }
    }, 20000);
  }

  function armDispatchBusyWatchdog() {
    if (dispatchBusyWatchdog) clearTimeout(dispatchBusyWatchdog);
    dispatchBusyWatchdog = setTimeout(() => {
      dispatchBusyWatchdog = null;
      if (!dispatchBusy) return;
      console.warn('[lasidao] dispatchBusy watchdog: force clear');
      dispatchBusy = false;
      flushDeferredHeavyRender();
      if (lastGame && isSettlePipelinePhase(lastGame.phase)) {
        maybePlaySettle(lastGame);
      }
    }, 20000);
  }

  function syncSkipSettleBtn(game, meId) {
    const btn = $('btn-las-skip-settle');
    if (!btn) return;
    const me = mePlayer(game, meId);
    const show = Boolean(
      game &&
        !game.over &&
        game.phase === 'settle' &&
        me &&
        !me.left &&
        !me.isSpectator
    );
    btn.hidden = !show;
    btn.disabled = !show;
  }

  function abortLocalSettleFx() {
    if (settleDispatchHoldTimer) {
      clearTimeout(settleDispatchHoldTimer);
      settleDispatchHoldTimer = null;
    }
    const LasFx = window.LasidaoFx;
    if (LasFx && typeof LasFx.abortSettle === 'function') {
      LasFx.abortSettle();
    }
  }

  function skipSettleAnim() {
    if (!lastGame || lastGame.phase !== 'settle') return;
    const key = settleReportKey(lastGame);
    if (key) {
      settleAnimKey = key;
      settleDispatchHoldKey = key;
    }
    abortLocalSettleFx();
    if (settlePlaying) {
      // 中止后 finishSettleUi 应由 Promise 收尾；再保险一次防止 abort 未传到 await
      setTimeout(() => {
        if (settlePlaying) finishSettleUi(key);
      }, 400);
      return;
    }
    sendSettleAnimAck(key);
    syncSkipSettleBtn(lastGame, lastMeId);
  }

  function syncPlayerPanelHighlight(game, meId) {
    const grid = $('las-player-grid');
    if (!grid) return;
    grid.classList.toggle(
      'is-current',
      Boolean(game && meId && isMyTurn(game, meId) && !game.over)
    );
  }

  function isRemoteMode(game) {
    return Boolean(game && game.remoteDiceMode);
  }

  function isAwaitingRoll(game) {
    return Boolean(game && game.awaitingProduceRoll);
  }

  function clearAutoProduceRoll() {
    if (autoProduceRollTimer) {
      clearTimeout(autoProduceRollTimer);
      autoProduceRollTimer = null;
    }
    autoProduceRollKey = null;
  }

  function syncAutoProduceRoll(game, meId) {
    const shouldAuto =
      Boolean(game) &&
      !game.over &&
      game.phase === 'produce' &&
      isMyTurn(game, meId) &&
      isAwaitingRoll(game) &&
      !isMercenaryRollMode(game, meId);
    const key = shouldAuto
      ? `${game.round || 0}:${meId}:${game.currentPlayerId || ''}:await`
      : null;
    if (!shouldAuto) {
      clearAutoProduceRoll();
      return;
    }
    if (autoProduceRollKey === key && autoProduceRollTimer) return;
    clearAutoProduceRoll();
    autoProduceRollKey = key;
    autoProduceRollTimer = setTimeout(() => {
      autoProduceRollTimer = null;
      if (autoProduceRollKey !== key) return;
      const g = lastGame;
      const id = lastMeId;
      if (
        !netRef ||
        !g ||
        g.over ||
        g.phase !== 'produce' ||
        !isMyTurn(g, id) ||
        !isAwaitingRoll(g) ||
        isMercenaryRollMode(g, id)
      ) {
        return;
      }
      netRef.sendAction('produceRoll', {});
    }, AUTO_PRODUCE_ROLL_MS);
  }

  function currentMercenaryDieIndex(merc) {
    const roll = (merc && merc.roll) || [];
    const placed = new Set((merc && merc.placed) || []);
    for (let i = 0; i < roll.length; i++) {
      if (!placed.has(i)) return i;
    }
    return -1;
  }

  function remainingMercenaryDice(merc) {
    const roll = (merc && merc.roll) || [];
    const placed = new Set((merc && merc.placed) || []);
    const out = [];
    for (let i = 0; i < roll.length; i++) {
      if (!placed.has(i)) out.push(Number(roll[i]) || 0);
    }
    return out;
  }

  function mercenaryDieIndexForFace(merc, face) {
    if (face == null) return -1;
    const roll = (merc && merc.roll) || [];
    const placed = new Set((merc && merc.placed) || []);
    const want = Number(face);
    for (let i = 0; i < roll.length; i++) {
      if (!placed.has(i) && Number(roll[i]) === want) return i;
    }
    return -1;
  }

  function mercenaryDieIndexForSkip(merc, face) {
    const byFace = mercenaryDieIndexForFace(merc, face);
    if (byFace >= 0) return byFace;
    return currentMercenaryDieIndex(merc);
  }

  function mercenaryCurrentFace(game) {
    const merc = game && game.mercenary;
    if (!merc) return null;
    const idx = currentMercenaryDieIndex(merc);
    if (idx < 0) return null;
    return Number(merc.roll[idx]) || null;
  }

  function isMercenaryRollMode(game, meId) {
    const merc = game && game.mercenary;
    return Boolean(
      game &&
        game.phase === 'event_mercenary' &&
        merc &&
        merc.forMe &&
        !(merc.roll && merc.roll.length) &&
        !(game.pendingEventChoice && game.pendingEventChoice.forMe)
    );
  }

  function isMercenaryPlaceMode(game, meId) {
    const merc = game && game.mercenary;
    return Boolean(
      game &&
        game.phase === 'event_mercenary' &&
        merc &&
        merc.forMe &&
        merc.roll &&
        merc.roll.length &&
        currentMercenaryDieIndex(merc) >= 0 &&
        !(game.pendingEventChoice && game.pendingEventChoice.forMe)
    );
  }

  function maybeShowMercenaryToast(game, meId) {
    const merc = game && game.mercenary;
    if (!merc || !merc.forMe || game.phase !== 'event_mercenary') return;
    const q0 = (merc.queue && merc.queue[0]) || {};
    const key =
      String(game.round || '') +
      ':' +
      String(q0.playerId || '') +
      ':' +
      String((merc.roll || []).join(',')) +
      ':' +
      String((merc.placed || []).join(','));
    if (mercenaryToastKey === key) return;
    mercenaryToastKey = key;
    if (!(merc.roll && merc.roll.length)) {
      showTurnToast(t('lasidao.eventMercenaryRollToast'), 2200);
    } else if (
      currentMercenaryDieIndex(merc) >= 0 &&
      (merc.placed || []).length === 0
    ) {
      showTurnToast(t('lasidao.eventMercenaryPlaceHint'), 2200);
    }
  }

  function diceReady() {
    return diceAnim.stage === 'ready';
  }

  function countByFace(dice) {
    const counts = {};
    for (const d of dice) counts[d] = (counts[d] || 0) + 1;
    return counts;
  }

  /** 按点数汇总：总数 / 强化数 / 普通数 */
  function faceDiceStats(dice, boosted) {
    const stats = {};
    for (let i = 0; i < dice.length; i++) {
      const f = dice[i];
      if (f == null || f < 1 || f > 6) continue;
      if (!stats[f]) stats[f] = { total: 0, boosted: 0 };
      stats[f].total += 1;
      if (boosted && boosted[i]) stats[f].boosted += 1;
    }
    return stats;
  }

  function appendGroupDieStack(parent, face, count, isBoosted, colorKey) {
    if (!count) return null;
    const stack = document.createElement('span');
    stack.className = 'las-die-stack';
    const faceEl = document.createElement('span');
    let cls = 'las-die las-die-face';
    if (isBoosted) cls += ' is-boosted';
    if (colorKey) cls += ' color-' + colorKey;
    faceEl.className = cls;
    faceEl.textContent = String(face);
    const mulEl = document.createElement('span');
    mulEl.className = 'las-die-mul';
    mulEl.textContent = '\u00d7' + count;
    stack.appendChild(faceEl);
    stack.appendChild(mulEl);
    parent.appendChild(stack);
    return stack;
  }

  /** ????????????????????? 0? */
  function availableFaces() {
    const counts = countByFace(diceAnim.finalDice || []);
    return Object.keys(counts)
      .map(Number)
      .filter((f) => f >= 1 && f <= 6 && counts[f] > 0);
  }

  function hasAvailableFace(num) {
    return availableFaces().indexOf(Number(num)) >= 0;
  }

  function updateDispatchPreview() {
    const confirm = $('btn-las-confirm');
    if (!confirm) return;

    if (isMercenaryPlaceMode(lastGame, lastMeId) && diceReady()) {
      if (selectedFace == null) {
        confirm.hidden = true;
        confirm.disabled = true;
        syncSlotConfirmButtons();
        return;
      }
      if (!selectedTarget) {
        confirm.hidden = true;
        confirm.disabled = true;
        syncSlotConfirmButtons();
        return;
      }
      confirm.hidden = false;
      confirm.disabled = false;
      syncSlotConfirmButtons();
      return;
    }

    const remote = lastGame && isRemoteMode(lastGame);

    if (remote) {
      if (!selectedWildCount) {
        confirm.hidden = true;
        return;
      }
      if (!selectedTarget) {
        confirm.hidden = true;
        return;
      }
      confirm.hidden = false;
      return;
    }

    if (selectedFace == null) {
      confirm.hidden = true;
      confirm.disabled = true;
      return;
    }

    if (!selectedTarget) {
      confirm.hidden = true;
      confirm.disabled = true;
      syncSlotConfirmButtons();
      return;
    }

    confirm.hidden = false;
    confirm.disabled = false;
    syncSlotConfirmButtons();
  }

  function dispatchTargetLabel(target) {
    if (!target) return '';
    if (target.type === 'area') {
      return areaLabel(target.area) + ' #' + target.number;
    }
    return t('lasidao.targetPersonal', { label: target.label || '' });
  }

  function setSlotConfirmVisible(confirmBtn, show) {
    if (!confirmBtn) return;
    const layer = confirmBtn.closest('.las-slot-confirm-layer');
    confirmBtn.classList.toggle('is-active', show);
    if (layer) layer.classList.toggle('is-visible', show);
  }

  function syncSlotConfirmButtons() {
    for (const areaKey of ['resource', 'special']) {
      const boardEl = $('las-board-' + areaKey);
      if (!boardEl) continue;
      for (const slot of boardEl.querySelectorAll('.las-slot')) {
        const confirmBtn = slot.querySelector('.las-slot-confirm-btn');
        if (!confirmBtn) continue;
        const num = Number(slot.dataset.num);
        const area = slot.dataset.area;
        let show = false;
        if (
          selectedTarget &&
          selectedTarget.type === 'area' &&
          selectedTarget.area === area &&
          selectedTarget.number === num
        ) {
          if (lastGame && isMercenaryPlaceMode(lastGame, lastMeId)) {
            show = diceReady() && selectedFace != null;
          } else if (lastGame && isRemoteMode(lastGame)) {
            show = diceReady() && selectedWildCount > 0;
          } else {
            show = diceReady() && selectedFace != null;
          }
        }
        setSlotConfirmVisible(confirmBtn, show);
      }
    }
  }

  function updateDiceHint() {
    const hint = $('las-dice-hint');
    const rollHint = $('las-roll-hint');
    if (isMercenaryRollMode(lastGame, lastMeId)) {
      const mercHint = t('lasidao.eventMercenaryRollHint');
      if (rollHint) rollHint.textContent = mercHint;
      if (hint) hint.textContent = mercHint;
      return;
    }
    if (rollHint && lastGame && lastGame.phase === 'produce' && isMyTurn(lastGame, lastMeId) && isAwaitingRoll(lastGame)) {
      rollHint.textContent = t('lasidao.rollHint');
    }
    if (!hint) return;
    if (isMercenaryPlaceMode(lastGame, lastMeId)) {
      if (diceAnim.stage === 'rolling') {
        hint.textContent = t('lasidao.diceRolling');
      } else if (diceAnim.stage === 'grouping') {
        hint.textContent = t('lasidao.diceGrouping');
      } else if (diceAnim.stage === 'ready') {
        const count =
          selectedFace != null
            ? countByFace(diceAnim.finalDice)[selectedFace] || 0
            : 0;
        if (selectedFace == null) {
          hint.textContent = t('lasidao.dicePickFaceOrBoard');
        } else if (!selectedTarget) {
          hint.textContent = t('lasidao.previewNeedTarget', {
            face: selectedFace,
            count,
          });
        } else {
          hint.textContent = t('lasidao.previewReady', {
            face: selectedFace,
            count,
            target: dispatchTargetLabel(selectedTarget),
          });
        }
      } else {
        hint.textContent = '';
      }
      return;
    }
    if (lastGame && isRemoteMode(lastGame) && diceAnim.stage === 'ready') {
      if (!selectedWildCount) {
        hint.textContent = t('lasidao.diceRemoteHint');
      } else if (!selectedTarget) {
        hint.textContent = t('lasidao.diceRemotePick', {
          count: selectedWildCount,
        });
      } else {
        hint.textContent = t('lasidao.previewRemote', {
          count: selectedWildCount,
          target: dispatchTargetLabel(selectedTarget),
        });
      }
      return;
    }
    if (diceAnim.stage === 'rolling') {
      hint.textContent = t('lasidao.diceRolling');
    } else if (diceAnim.stage === 'grouping') {
      hint.textContent = t('lasidao.diceGrouping');
    } else if (diceAnim.stage === 'ready') {
      const count =
        selectedFace != null
          ? countByFace(diceAnim.finalDice)[selectedFace] || 0
          : 0;
      if (selectedFace == null) {
        hint.textContent = t('lasidao.dicePickFaceOrBoard');
      } else if (!selectedTarget) {
        hint.textContent = t('lasidao.previewNeedTarget', {
          face: selectedFace,
          count,
        });
      } else {
        hint.textContent = t('lasidao.previewReady', {
          face: selectedFace,
          count,
          target: dispatchTargetLabel(selectedTarget),
        });
      }
    } else {
      hint.textContent = '';
    }
  }

  function syncBoardPickHighlight() {
    for (const areaKey of ['resource', 'special']) {
      const boardEl = $('las-board-' + areaKey);
      if (!boardEl) continue;
      for (const slot of boardEl.querySelectorAll('.las-slot')) {
        slot.classList.remove('is-picked');
        const num = Number(slot.dataset.num);
        const area = slot.dataset.area;
        const picked =
          (barrenPickArea === area && barrenPickNumber === num) ||
          (neutralPickArea === area && neutralPickNumber === num) ||
          (selectedTarget &&
            selectedTarget.type === 'area' &&
            selectedTarget.area === area &&
            selectedTarget.number === num);
        if (picked) slot.classList.add('is-picked');
      }
    }
  }

  function syncGroupedDiceSelection() {
    const groupsEl = $('las-dice-groups');
    if (!groupsEl) return;
    for (const btn of groupsEl.querySelectorAll('.las-die-group')) {
      const face = Number(btn.dataset.face);
      if (!Number.isFinite(face)) continue;
      btn.classList.toggle('is-selected', selectedFace === face);
      btn.classList.toggle(
        'is-dim',
        selectedFace != null && selectedFace !== face
      );
    }
  }

  function logEntryText(row) {
    if (!row) return '';
    if (typeof row === 'string') return row;
    return row.text != null ? String(row.text) : '';
  }

  function logRenderKey(rows) {
    if (!rows || !rows.length) return '0';
    return rows
      .map(
        (r) =>
          `${r && r.at != null ? r.at : ''}:${logEntryText(r)}`
      )
      .join('\n');
  }

  function logNewestKey(rows) {
    if (!rows || !rows.length) return '';
    const newest = rows[rows.length - 1];
    return `${newest && newest.at != null ? newest.at : ''}:${logEntryText(newest)}`;
  }

  function logRowKey(row) {
    return `${row && row.at != null ? row.at : ''}:${logEntryText(row)}`;
  }

  function renderGameLog(game) {
    const log = $('las-log');
    if (!log) return;
    const rows = game.log || [];
    const key = logRenderKey(rows);
    if (key === lastLogRenderKey && log.children.length > 0) return;

    const newestKey = logNewestKey(rows);
    // 一次状态推送可能带多条日志（如最后一次跳过立刻进结算）；需全部追加，不能只插最新一条
    if (
      newestKey &&
      newestKey !== lastLogNewestKey &&
      lastLogNewestKey &&
      log.children.length > 0 &&
      log.children.length <= LAS_LOG_MAX
    ) {
      let prevIdx = -1;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (logRowKey(rows[i]) === lastLogNewestKey) {
          prevIdx = i;
          break;
        }
      }
      if (prevIdx >= 0 && prevIdx < rows.length - 1) {
        const newRows = rows.slice(prevIdx + 1);
        for (let i = 0; i < newRows.length; i++) {
          const li = document.createElement('li');
          li.textContent = logEntryText(newRows[i]);
          log.insertBefore(li, log.firstChild);
        }
        while (log.children.length > LAS_LOG_MAX) {
          log.removeChild(log.lastChild);
        }
        lastLogRenderKey = key;
        lastLogNewestKey = newestKey;
        return;
      }
    }

    lastLogRenderKey = key;
    lastLogNewestKey = newestKey;
    log.innerHTML = '';
    for (const row of rows.slice().reverse().slice(0, LAS_LOG_MAX)) {
      const li = document.createElement('li');
      li.textContent = logEntryText(row);
      log.appendChild(li);
    }
  }

  function appendGameLogLine(text) {
    if (!text) return;
    const log = $('las-log');
    if (!log) return;
    for (let i = 0; i < log.children.length; i++) {
      if (log.children[i].textContent === text) return;
    }
    const li = document.createElement('li');
    li.textContent = text;
    log.insertBefore(li, log.firstChild);
    while (log.children.length > LAS_LOG_MAX) {
      log.removeChild(log.lastChild);
    }
    lastLogNewestKey = `local:${Date.now()}:${text}`;
  }

  function pickAreaTarget(areaKey, num) {
    const remote = lastGame && isRemoteMode(lastGame);
    if (!remote) {
      if (!hasAvailableFace(num)) return;
      selectedFace = Number(num);
    } else {
      selectedFace = Number(num);
    }
    selectedTarget = { type: 'area', area: areaKey, number: num };
    syncBoardPickHighlight();
    if (remote) renderRemoteDice(lastGame, lastMeId);
    else renderGroupedDice();
    updateDispatchPreview();
    updateDiceHint();
  }

  function isBarrenMarkerPickMode(game, meId) {
    const c = game && game.pendingEventChoice;
    return Boolean(
      c && c.forMe && c.needChoice === 'moveBarrenMarker'
    );
  }

  function isNeutralPickMode(game, meId) {
    const c = game && game.pendingEventChoice;
    return Boolean(
      c && c.forMe && c.needChoice === 'moveNeutral'
    );
  }

  function isRecallPickMode(game, meId) {
    const c = game && game.pendingEventChoice;
    return Boolean(c && c.forMe && c.needChoice === 'recallDie');
  }

  function isGatherNeutralsPickMode(game, meId) {
    const c = game && game.pendingEventChoice;
    return Boolean(c && c.forMe && c.needChoice === 'gatherNeutrals');
  }

  function gatherNeutralsTarget(game) {
    const c = game && game.pendingEventChoice;
    if (!c) return null;
    return {
      area: c.toArea || 'resource',
      number: Number(c.toNumber != null ? c.toNumber : c.number),
    };
  }

  function neutralCountOnSlot(workers, game) {
    const nid = (game && game.neutralWorkerId) || '__neutral__';
    return Number((workers || {})[nid]) || 0;
  }

  function gatherNeutralsSlotSelectable(game, meId, areaKey, num, workers, lockedByRound) {
    if (!isGatherNeutralsPickMode(game, meId)) return false;
    if (areaKey === 'special' && lockedByRound) return false;
    const tgt = gatherNeutralsTarget(game);
    if (tgt && tgt.area === areaKey && tgt.number === num) return false;
    return neutralCountOnSlot(workers, game) > 0;
  }

  function slotPlayerDieCounts(game, areaKey, num, pid) {
    const ab = game.board && game.board[areaKey];
    if (!ab) return { normal: 0, enhanced: 0, total: 0 };
    const total = Number((ab.workers[num] || {})[pid]) || 0;
    const boosted = Math.min(
      Number((ab.boosts && ab.boosts[num] && ab.boosts[num][pid]) || 0),
      total
    );
    return { normal: total - boosted, enhanced: boosted, total };
  }

  function appendDieKindPickButton(parent, game, face, isBoosted, label, onPick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'las-die-kind-pick';
    const die = makeDieEl(
      face,
      'is-mini' + (isBoosted ? ' is-boosted' : ''),
      playerDieColor(game.players, lastMeId, game)
    );
    const txt = document.createElement('span');
    txt.className = 'las-die-kind-label';
    txt.textContent = label;
    btn.appendChild(die);
    btn.appendChild(txt);
    btn.onclick = onPick;
    parent.appendChild(btn);
  }

  function ownDiceOnSlot(workers, meId) {
    return Number((workers || {})[meId]) || 0;
  }

  function recallSlotSelectable(game, meId, areaKey, num, workers) {
    if (!isRecallPickMode(game, meId)) return false;
    if (
      areaKey === 'special' &&
      num > areaOpenSlotCount(areaKey, game.round)
    ) {
      return false;
    }
    const c = game.pendingEventChoice;
    const exArea = (c && c.excludeArea) || 'resource';
    const exNum = Number(
      c && (c.excludeNumber != null ? c.excludeNumber : c.number)
    );
    if (areaKey === exArea && num === exNum) return false;
    return ownDiceOnSlot(workers, meId) > 0;
  }

  function isTeleportPickMode(game, meId) {
    const c = game && game.pendingEventChoice;
    return Boolean(c && c.forMe && c.needChoice === 'teleportDie');
  }

  function teleportStep(game) {
    const c = game && game.pendingEventChoice;
    if (!c || c.needChoice !== 'teleportDie') return null;
    return c.teleportStep || 'from';
  }

  function occupantsOnSlot(workers) {
    return Object.entries(workers || {}).filter(
      ([, n]) => (Number(n) || 0) > 0
    );
  }

  function teleportFromSlotSelectable(
    game,
    meId,
    areaKey,
    num,
    workers,
    lockedByRound
  ) {
    if (!isTeleportPickMode(game, meId) || teleportStep(game) !== 'from') {
      return false;
    }
    if (areaKey === 'special' && lockedByRound) return false;
    return occupantsOnSlot(workers).length > 0;
  }

  function teleportToSlotSelectable(
    game,
    meId,
    areaKey,
    num,
    tiles,
    lockedByRound
  ) {
    if (!isTeleportPickMode(game, meId) || teleportStep(game) !== 'to') {
      return false;
    }
    if (areaKey === 'special' && lockedByRound) return false;
    if (!tiles.length) return false;
    const c = game.pendingEventChoice;
    if (c && c.fromArea === areaKey && Number(c.fromNumber) === num) {
      return false;
    }
    return true;
  }

  function handleTeleportFromPick(areaKey, num, workers) {
    if (!netRef) return;
    const occ = occupantsOnSlot(workers);
    if (!occ.length) return;
    if (occ.length === 1) {
      teleportPickArea = null;
      teleportPickNumber = null;
      netRef.sendAction('eventTeleportFrom', {
        area: areaKey,
        number: num,
        targetId: occ[0][0],
      });
      return;
    }
    teleportPickArea = areaKey;
    teleportPickNumber = num;
    renderBoard(lastGame, lastMeId);
    syncTeleportPickUi(lastGame, lastMeId);
  }

  function confirmBarrenMarkerPlace() {
    if (!netRef || barrenPickNumber == null) return;
    if (!isBarrenMarkerPickMode(lastGame, lastMeId)) return;
    const area = barrenPickArea || 'resource';
    const n = barrenPickNumber;
    barrenPickArea = null;
    barrenPickNumber = null;
    netRef.sendAction('eventMoveBarrenMarker', { area, number: n });
  }

  function maybeShowTeleportToast(game, meId) {
    const c = game && game.pendingEventChoice;
    if (!isTeleportPickMode(game, meId) || !c) return;
    const step = teleportStep(game) || 'from';
    const key =
      String(game.round || '') +
      ':' +
      step +
      ':' +
      String(c.fromArea || '') +
      ':' +
      String(c.fromNumber != null ? c.fromNumber : '') +
      ':' +
      String(c.fromTargetId || '');
    if (teleportToastKey === key) return;
    teleportToastKey = key;
    teleportPickArea = null;
    teleportPickNumber = null;
    showTurnToast(
      step === 'to'
        ? t('lasidao.eventTeleportToToast')
        : t('lasidao.eventTeleportFromToast'),
      2200
    );
  }

  function maybeShowRecallToast(game, meId) {
    const c = game && game.pendingEventChoice;
    if (!isRecallPickMode(game, meId) || !c) return;
    const key =
      String(game.round || '') +
      ':' +
      String(c.number != null ? c.number : '');
    if (recallToastKey === key) return;
    recallToastKey = key;
    showTurnToast(t('lasidao.eventRecallToast'), 2200);
  }

  function maybeShowGatherNeutralsToast(game, meId) {
    const c = game && game.pendingEventChoice;
    if (!isGatherNeutralsPickMode(game, meId) || !c) return;
    const tgt = gatherNeutralsTarget(game);
    const key =
      String(game.round || '') +
      ':' +
      String(tgt ? tgt.area : 'resource') +
      ':' +
      String(tgt ? tgt.number : '');
    if (gatherNeutralsToastKey === key) return;
    gatherNeutralsToastKey = key;
    showTurnToast(t('lasidao.eventGatherNeutralsToast'), 2200);
  }

  function maybeShowNeutralToast(game, meId) {
    const c = game && game.pendingEventChoice;
    if (!isNeutralPickMode(game, meId) || !c) return;
    const key =
      String(game.round || '') +
      ':' +
      String(c.fromArea || 'resource') +
      ':' +
      String(c.fromNumber != null ? c.fromNumber : c.number);
    if (neutralToastKey === key) return;
    neutralToastKey = key;
    selectedTarget = null;
    neutralPickArea = null;
    neutralPickNumber = null;
    showTurnToast(t('lasidao.eventMoveNeutralToast'), 2200);
  }

  function neutralDispatchFromCenter(game) {
    const c = game && game.pendingEventChoice;
    if (!c) return null;
    const fromArea = c.fromArea || 'resource';
    const fromNumber = Number(c.fromNumber != null ? c.fromNumber : c.number);
    const el =
      document.querySelector(
        `.las-slot[data-area="${fromArea}"][data-num="${fromNumber}"] .las-slot-num`
      ) ||
      document.querySelector(
        `.las-slot[data-area="${fromArea}"][data-num="${fromNumber}"]`
      );
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width || r.height) {
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    const diceRoot = $('las-dice');
    if (diceRoot) {
      const r = diceRoot.getBoundingClientRect();
      if (r.width || r.height) {
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  }

  function confirmNeutralPlace() {
    if (!netRef || !lastGame) return;
    if (!isNeutralPickMode(lastGame, lastMeId)) return;
    if (!selectedTarget || selectedTarget.type !== 'area') return;
    const toArea = selectedTarget.area;
    const toNumber = selectedTarget.number;
    const fromCenter = neutralDispatchFromCenter(lastGame);
    const LasFx = window.LasidaoFx;
    dispatchBusy = true;
    armDispatchBusyWatchdog();
    Promise.resolve()
      .then(async () => {
        if (LasFx && typeof LasFx.playDispatch === 'function') {
          await LasFx.playDispatch({
            face: '?',
            count: 1,
            color: 'neutral',
            fromCenters: fromCenter ? [fromCenter] : [],
            area: toArea,
            number: toNumber,
          });
        }
        if (LasFx && typeof LasFx.clearLayer === 'function') LasFx.clearLayer();
        netRef.sendAction('eventMoveNeutral', { area: toArea, number: toNumber });
        selectedTarget = null;
        neutralPickArea = null;
        neutralPickNumber = null;
      })
      .finally(() => {
        dispatchBusy = false;
        if (dispatchBusyWatchdog) {
          clearTimeout(dispatchBusyWatchdog);
          dispatchBusyWatchdog = null;
        }
        flushDeferredHeavyRender();
      });
  }

  function isBanditPickMode(game, meId) {
    return Boolean(
      banditCardId &&
        game &&
        game.phase === 'produce' &&
        isMyTurn(game, meId)
    );
  }

  function confirmBanditPlace() {
    if (!netRef || !banditCardId || !selectedTarget) return;
    if (selectedTarget.type !== 'area') return;
    const area = selectedTarget.area;
    const number = selectedTarget.number;
    const cardId = banditCardId;
    const fx = window.LasidaoFx;
    dispatchBusy = true;
    armDispatchBusyWatchdog();
    Promise.resolve()
      .then(async () => {
        if (fx && typeof fx.playBanditRaid === 'function') {
          await fx.playBanditRaid({
            game: lastGame,
            actorId: lastMeId,
            area,
            number,
            count: 2,
          });
        }
        if (fx && typeof fx.clearLayer === 'function') fx.clearLayer();
        netRef.sendAction('useFunc', { cardId, area, number });
        banditCardId = null;
        selectedTarget = null;
        selectedFuncId = null;
      })
      .finally(() => {
        dispatchBusy = false;
        if (dispatchBusyWatchdog) {
          clearTimeout(dispatchBusyWatchdog);
          dispatchBusyWatchdog = null;
        }
        flushDeferredHeavyRender();
      });
  }

  function syncBanditPickUi(game, meId) {
    if (!isBanditPickMode(game, meId)) {
      return false;
    }
    const wrap = $('las-dice-wrap');
    const hint = $('las-dice-hint');
    const confirm = $('btn-las-confirm');
    const voidBtn = $('btn-las-void');
    const produceActions = $('las-produce-actions');
    const preview = $('las-dispatch-preview');
    if (wrap) wrap.hidden = false;
    setDiceTitle(t('lasidao.func.banditRaid'));
    if (hint) {
      hint.textContent = selectedTarget
        ? t('lasidao.banditPickBoardSelected', {
            area: areaLabel(selectedTarget.area),
            n: selectedTarget.number,
          })
        : t('lasidao.banditPickBoardHint');
    }
    if (preview) preview.hidden = true;
    if (voidBtn) {
      voidBtn.hidden = false;
      voidBtn.textContent = t('lasidao.cancel');
    }
    if (produceActions) produceActions.hidden = false;
    if (confirm) {
      confirm.hidden = false;
      confirm.disabled = !selectedTarget;
      confirm.textContent = t('lasidao.banditPickBoardConfirm');
    }
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (diceEl) {
      diceEl.hidden = false;
      diceEl.innerHTML = '';
      for (let i = 0; i < 2; i++) {
        diceEl.appendChild(makeDieEl('?', 'is-mini is-bandit', 'neutral'));
      }
    }
    if (groupsEl) {
      groupsEl.hidden = true;
      groupsEl.innerHTML = '';
    }
    return true;
  }

  function barrenPickLabel(game) {
    if (barrenPickNumber == null) return t('lasidao.eventMoveBarren');
    const area = barrenPickArea || 'resource';
    return t('lasidao.eventMoveBarrenPicked', {
      area: areaLabel(area),
      n: barrenPickNumber,
    });
  }

  function syncBarrenMarkerPickUi(game, meId) {
    if (!isBarrenMarkerPickMode(game, meId)) {
      return false;
    }
    const wrap = $('las-dice-wrap');
    const hint = $('las-dice-hint');
    const confirm = $('btn-las-confirm');
    const voidBtn = $('btn-las-void');
    const produceActions = $('las-produce-actions');
    const preview = $('las-dispatch-preview');
    if (wrap) wrap.hidden = false;
    setDiceTitle(t('lasidao.eventBarrenTitle'));
    if (hint) {
      hint.textContent = barrenPickLabel(game);
    }
    if (preview) preview.hidden = true;
    if (voidBtn) voidBtn.hidden = true;
    if (produceActions) produceActions.hidden = false;
    if (confirm) {
      confirm.hidden = false;
      confirm.disabled = barrenPickNumber == null;
      confirm.textContent = t('lasidao.eventMoveBarrenConfirm');
    }
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (diceEl) {
      diceEl.hidden = false;
      diceEl.innerHTML =
        '<span class="muted">' + barrenPickLabel(game) + '</span>';
    }
    if (groupsEl) {
      groupsEl.hidden = true;
      groupsEl.innerHTML = '';
    }
    return true;
  }

  function syncTeleportPickUi(game, meId) {
    if (!isTeleportPickMode(game, meId)) {
      return false;
    }
    maybeShowTeleportToast(game, meId);
    const step = teleportStep(game) || 'from';
    const wrap = $('las-dice-wrap');
    const hint = $('las-dice-hint');
    const confirm = $('btn-las-confirm');
    const voidBtn = $('btn-las-void');
    const produceActions = $('las-produce-actions');
    const preview = $('las-dispatch-preview');
    if (wrap) wrap.hidden = false;
    setDiceTitle(t('lasidao.eventTeleportTitle') || t('lasidao.environmentSlot'));
    if (hint) {
      hint.textContent =
        step === 'to'
          ? t('lasidao.eventTeleportToHint')
          : teleportPickArea != null
            ? t('lasidao.eventTeleportPickPlayer')
            : t('lasidao.eventTeleportFromHint');
    }
    if (preview) preview.hidden = true;
    if (voidBtn) voidBtn.hidden = true;
    if (produceActions) produceActions.hidden = false;
    if (confirm) confirm.hidden = true;
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (diceEl) {
      diceEl.hidden = false;
      if (
        step === 'from' &&
        teleportPickArea != null &&
        teleportPickNumber != null
      ) {
        const ab = game.board && game.board[teleportPickArea];
        const w =
          ab && ab.workers && ab.workers[teleportPickNumber]
            ? ab.workers[teleportPickNumber]
            : {};
        const occ = occupantsOnSlot(w);
        diceEl.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'las-event-teleport-players';
        for (const [pid] of occ) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className =
            'las-exile-player color-' + playerDieColor(game.players, pid, game);
          btn.textContent = workerName(pid, game.players, game);
          btn.onclick = () => {
            if (!netRef) return;
            netRef.sendAction('eventTeleportFrom', {
              area: teleportPickArea,
              number: teleportPickNumber,
              targetId: pid,
            });
            teleportPickArea = null;
            teleportPickNumber = null;
          };
          grid.appendChild(btn);
        }
        diceEl.appendChild(grid);
      } else {
        diceEl.innerHTML =
          '<span class="muted">' +
          (step === 'to'
            ? t('lasidao.eventTeleportToHint')
            : t('lasidao.eventTeleportFromHint')) +
          '</span>';
      }
    }
    if (groupsEl) {
      groupsEl.hidden = true;
      groupsEl.innerHTML = '';
    }
    return true;
  }

  function syncRecallPickUi(game, meId) {
    if (!isRecallPickMode(game, meId)) {
      recallPickArea = null;
      recallPickNumber = null;
      return false;
    }
    maybeShowRecallToast(game, meId);
    const wrap = $('las-dice-wrap');
    const hint = $('las-dice-hint');
    const confirm = $('btn-las-confirm');
    const voidBtn = $('btn-las-void');
    const produceActions = $('las-produce-actions');
    const preview = $('las-dispatch-preview');
    if (wrap) wrap.hidden = false;
    setDiceTitle(t('lasidao.eventRecallTitle') || t('lasidao.environmentSlot'));
    if (hint) hint.textContent = t('lasidao.eventRecallHint');
    if (preview) preview.hidden = true;
    if (voidBtn) voidBtn.hidden = true;
    if (produceActions) produceActions.hidden = false;
    if (confirm) confirm.hidden = true;
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (diceEl) {
      diceEl.hidden = false;
      if (recallPickArea != null && recallPickNumber != null) {
        diceEl.innerHTML = '';
        const pickWrap = document.createElement('div');
        pickWrap.className = 'las-recall-die-pick';
        const pickHint = document.createElement('p');
        pickHint.className = 'muted';
        pickHint.textContent = t('lasidao.eventRecallPickDie');
        pickWrap.appendChild(pickHint);
        const grid = document.createElement('div');
        grid.className = 'las-recall-die-grid';
        const face = recallPickNumber;
        appendDieKindPickButton(
          grid,
          game,
          face,
          false,
          t('lasidao.pickNormalDie'),
          () => {
            if (!netRef) return;
            netRef.sendAction('eventRecallDie', {
              area: recallPickArea,
              number: recallPickNumber,
              enhanced: false,
            });
            recallPickArea = null;
            recallPickNumber = null;
          }
        );
        appendDieKindPickButton(
          grid,
          game,
          face,
          true,
          t('lasidao.pickEnhancedDie'),
          () => {
            if (!netRef) return;
            netRef.sendAction('eventRecallDie', {
              area: recallPickArea,
              number: recallPickNumber,
              enhanced: true,
            });
            recallPickArea = null;
            recallPickNumber = null;
          }
        );
        pickWrap.appendChild(grid);
        diceEl.appendChild(pickWrap);
      } else {
        diceEl.innerHTML =
          '<span class="muted">' + t('lasidao.eventRecallHint') + '</span>';
      }
    }
    if (groupsEl) {
      groupsEl.hidden = true;
      groupsEl.innerHTML = '';
    }
    return true;
  }

  function syncGatherNeutralsPickUi(game, meId) {
    if (!isGatherNeutralsPickMode(game, meId)) {
      return false;
    }
    maybeShowGatherNeutralsToast(game, meId);
    const wrap = $('las-dice-wrap');
    const hint = $('las-dice-hint');
    const confirm = $('btn-las-confirm');
    const voidBtn = $('btn-las-void');
    const produceActions = $('las-produce-actions');
    const preview = $('las-dispatch-preview');
    if (wrap) wrap.hidden = false;
    setDiceTitle(
      t('lasidao.eventGatherNeutralsTitle') || t('lasidao.environmentSlot')
    );
    if (hint) hint.textContent = t('lasidao.eventGatherNeutralsHint');
    if (preview) preview.hidden = true;
    if (voidBtn) voidBtn.hidden = true;
    if (produceActions) produceActions.hidden = false;
    if (confirm) confirm.hidden = true;
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (diceEl) {
      diceEl.hidden = false;
      diceEl.innerHTML =
        '<span class="muted">' + t('lasidao.eventGatherNeutralsHint') + '</span>';
    }
    if (groupsEl) {
      groupsEl.hidden = true;
      groupsEl.innerHTML = '';
    }
    return true;
  }

  function syncNeutralPickUi(game, meId) {
    if (!isNeutralPickMode(game, meId)) {
      return false;
    }
    maybeShowNeutralToast(game, meId);
    const wrap = $('las-dice-wrap');
    const hint = $('las-dice-hint');
    const confirm = $('btn-las-confirm');
    const voidBtn = $('btn-las-void');
    const produceActions = $('las-produce-actions');
    const preview = $('las-dispatch-preview');
    if (wrap) wrap.hidden = false;
    setDiceTitle(t('lasidao.eventMoveNeutralTitle') || t('lasidao.environmentSlot'));
    if (hint) {
      hint.textContent =
        selectedTarget && selectedTarget.type === 'area'
          ? t('lasidao.eventMoveNeutralPicked', {
              area: areaLabel(selectedTarget.area),
              n: selectedTarget.number,
            })
          : t('lasidao.eventMoveNeutralHint');
    }
    if (preview) preview.hidden = true;
    if (voidBtn) voidBtn.hidden = true;
    if (produceActions) produceActions.hidden = false;
    if (confirm) {
      confirm.hidden = false;
      confirm.disabled = !(selectedTarget && selectedTarget.type === 'area');
      confirm.textContent = t('lasidao.eventMoveNeutralConfirm');
    }
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (diceEl) {
      diceEl.hidden = false;
      diceEl.innerHTML = '';
      diceEl.appendChild(makeDieEl('?', 'is-mini is-bandit', 'neutral'));
    }
    if (groupsEl) {
      groupsEl.hidden = true;
      groupsEl.innerHTML = '';
    }
    return true;
  }

  /** 资源区每数字格容量：1–3 格各 3 张，4–6 格各 2 张（合计上限 15） */
  function resourceSlotCapacity(num) {
    return num >= 4 ? 2 : 3;
  }

  /** 资源区每数字格第 idx 层（0 起）于第几轮解锁；每轮开放一格 */
  function resourceSlotUnlockRound(num, idx) {
    if (idx <= 0) return 1;
    return idx * 6 + num - 5;
  }

  /** 功能/建筑合区 num 格于第几轮解锁（1–2 号第 1 轮，之后每 2 轮 +1 格） */
  function slotUnlockRound(areaKey, num) {
    if (areaKey === 'special') {
      if (num <= 2) return 1;
      return 2 * (num - 2) + 1;
    }
    return null;
  }

  /** 判断该空卡位/锁定位是否属于暗置位置（解锁后摆放的卡牌为暗置） */
  function isSlotFaceDownPosition(areaKey, num, idx) {
    if (areaKey === 'special') {
      return num === 2 || num === 4 || num === 6;
    }
    // 资源区卡位一律明示
    return false;
  }

  function isBoardSlotLocked(areaKey, num, idx, game) {
    const round = (game && game.round) || 1;
    if (areaKey === 'resource') {
      if (idx >= 1) {
        const u = resourceSlotUnlockRound(num, idx);
        if (round < u) return { locked: true, unlockN: u };
      }
      return { locked: false, unlockN: null };
    }
    if (idx === 0) {
      const u = slotUnlockRound(areaKey, num);
      const openCount = areaOpenSlotCount(areaKey, round);
      if (
        u != null &&
        (game.phase === 'init_roll' ||
          game.phase === 'init_announce' ||
          num > openCount)
      ) {
        return { locked: true, unlockN: u };
      }
    }
    return { locked: false, unlockN: null };
  }

  function tilesAtBoardPositions(tiles, capacity) {
    const byPos = new Array(capacity).fill(null);
    const list = (tiles || []).slice();
    list.sort((a, b) => {
      const pa =
        a && a.cardIndexOnSlot != null ? Number(a.cardIndexOnSlot) : 0;
      const pb =
        b && b.cardIndexOnSlot != null ? Number(b.cardIndexOnSlot) : 0;
      if (pa && pb) return pa - pb;
      if (pa) return pa;
      if (pb) return pb;
      return 0;
    });
    let fill = 0;
    for (const tile of list) {
      if (!tile) continue;
      if (tile.cardIndexOnSlot != null) {
        const i = Number(tile.cardIndexOnSlot) - 1;
        if (i >= 0 && i < capacity) byPos[i] = tile;
        continue;
      }
      while (fill < capacity && byPos[fill]) fill += 1;
      if (fill < capacity) {
        byPos[fill] = tile;
        fill += 1;
      }
    }
    return byPos;
  }

  function makeBoardSlotEmptyEl(areaKey, num, idx, game, options) {
    const opts = options || {};
    const empty = document.createElement('span');
    empty.className = 'muted las-slot-empty';
    empty.dataset.slotIdx = String(idx);
    const round = (game && game.round) || 1;
    const lock = isBoardSlotLocked(areaKey, num, idx, game);
    if (lock.locked) {
      empty.classList.add('las-slot-locked');
      if (isSlotFaceDownPosition(areaKey, num, idx)) {
        empty.classList.add('is-multi-line');
        const line1 = document.createElement('span');
        line1.className = 'las-slot-empty-line';
        line1.textContent = t('lasidao.unlockRound', { n: lock.unlockN });
        const line2 = document.createElement('span');
        line2.className = 'las-slot-empty-line las-slot-empty-facedown';
        line2.textContent = t('lasidao.faceDownSlot');
        empty.appendChild(line1);
        empty.appendChild(line2);
      } else {
        empty.textContent = t('lasidao.unlockRound', { n: lock.unlockN });
      }
      if (opts.markSlotLocked && areaKey !== 'resource') {
        opts.markSlotLocked();
      }
    } else {
      empty.classList.add('las-slot-open');
      if (isSlotFaceDownPosition(areaKey, num, idx)) {
        empty.textContent = t('lasidao.faceDownSlot');
        empty.classList.add('las-slot-facedown-hint');
      } else {
        empty.textContent = t('lasidao.emptySlot');
      }
    }
    return empty;
  }

  function replaceBoardTileWithEmpty(areaKey, num, idx) {
    if (!lastGame) return null;
    const slot = document.querySelector(
      '.las-slot[data-area="' + areaKey + '"][data-num="' + num + '"]'
    );
    if (!slot) return null;
    const stack = slot.querySelector('.las-slot-tiles');
    if (!stack) return null;
    const child = stack.children[idx];
    if (!child || !child.classList.contains('las-tile')) return null;
    const empty = makeBoardSlotEmptyEl(areaKey, num, idx, lastGame, {
      markSlotLocked: () => slot.classList.add('is-locked'),
    });
    stack.replaceChild(empty, child);
    return empty;
  }

  /** 合区本轮开放格数 1~6 */
  function areaOpenSlotCount(areaKey, round) {
    const r = Math.max(1, Number(round) || 1);
    if (areaKey === 'special') {
      return Math.min(6, 2 + Math.floor((r - 1) / 2));
    }
    return 6;
  }

  /* __LAS_INCREMENTAL_RENDER_START__ */
  const boardClickBound = { resource: false, special: false };
  let deferredHeavyRenderPending = false;

  function shouldDeferHeavyPanels(game) {
    return Boolean(
      settlePlaying ||
        dealAnimPlaying ||
        dispatchBusy ||
        produceFxPlaying ||
        (game.phase === 'produce' && diceAnim.stage === 'rolling')
    );
  }

  function mustRenderHandsNow(game, meId) {
    const me = mePlayer(game, meId);
    if (!me) return false;
    if (game.phase === 'build' && isMyTurn(game, meId)) {
      if (me.pendingDiscardFunc || me.pendingDiscardBuild) return true;
    }
    if (game.phase === 'settle_act') {
      if (me.pendingDiscardFunc || me.pendingDiscardBuild || me.pendingDiscardRes) {
        return true;
      }
    }
    if (game.pendingEventChoice && game.pendingEventChoice.forMe) return true;
    if (game.pendingTrade && game.pendingTrade.forMe) return true;
    if (isMercenaryPlaceMode(game, meId)) return true;
    return false;
  }

  function flushDeferredHeavyRender() {
    if (!deferredHeavyRenderPending || !lastGame) return;
    deferredHeavyRenderPending = false;
    const me = mePlayer(lastGame, lastMeId);
    renderPlayerBoards(lastGame, lastMeId);
    renderActRail(lastGame, lastMeId);
    renderBuildHand(lastGame, lastMeId);
    renderPlayers(lastGame, lastMeId);
    if (me) renderFuncForm(lastGame, me);
  }

  function boardSlotContentHash(game, areaKey, num, slotInfo, tiles, workers, boosts) {
    const tilePart = (tiles || [])
      .map((t, i) => {
        if (!t) return `${i}:_`;
        return `${i}:${t.id}:${t.faceDown ? 1 : 0}:${t.label || ''}:${t.cardIndexOnSlot || ''}`;
      })
      .join(',');
    const wPart = Object.entries(workers || {})
      .sort()
      .filter(([, v]) => v > 0)
      .map(([k, v]) => k + ':' + v)
      .join(',');
    const bPart = Object.entries(boosts || {})
      .sort()
      .filter(([, v]) => v > 0)
      .map(([k, v]) => 'b' + k + ':' + v)
      .join(',');
    const area = (game.board && game.board[areaKey]) || {};
    const env =
      (area.environments && area.environments[num]) ||
      slotInfo.environment ||
      null;
    const envPart = env
      ? `${env.id}:${env.mercenaryDice || 0}:${env.envType || ''}:${JSON.stringify(env.stash || {})}:${env.hasSideCard ? 1 : 0}:${env.sideCardKind || ''}`
      : '';
    const markerArea =
      (game.barrenMarkerArea != null && game.barrenMarkerArea) || 'resource';
    const barren =
      game.barrenMarkerNumber != null &&
      markerArea === areaKey &&
      Number(game.barrenMarkerNumber) === num
        ? game.barrenMarkerOwnerId || '_'
        : '';
    const dealPart = [...(tiles || []), ...(env ? [env] : [])]
      .filter((t) => t && t.id && pendingDealIds.has(t.id))
      .map((t) => t.id)
      .join(',');
    return [
      game.round,
      game.phase,
      areaKey,
      num,
      tilePart,
      wPart,
      bPart,
      envPart,
      barren,
      dealPart,
    ].join(';');
  }

  function getBoardSlotInteraction(game, meId, areaKey, num, slotInfo, tiles, workers) {
    const remote = isRemoteMode(game);
    const faces = availableFaces();
    const barrenPick = isBarrenMarkerPickMode(game, meId);
    const neutralPick = isNeutralPickMode(game, meId);
    const recallPick = isRecallPickMode(game, meId);
    const gatherNeutralsPick = isGatherNeutralsPickMode(game, meId);
    const teleportPick = isTeleportPickMode(game, meId);
    const banditPick = isBanditPickMode(game, meId);
    const mercPlace = isMercenaryPlaceMode(game, meId);
    const round = game.round || 1;
    const openCount = areaOpenSlotCount(areaKey, round);
    const lockedByRound = areaKey === 'special' && num > openCount;
    const hasTiles = (tiles || []).length > 0;
    const canPickBase =
      !barrenPick &&
      !neutralPick &&
      !recallPick &&
      !gatherNeutralsPick &&
      !teleportPick &&
      !banditPick &&
      ((game.phase === 'produce' &&
        isMyTurn(game, meId) &&
        diceReady()) ||
        (mercPlace && diceReady()));
    const canPick =
      canPickBase &&
      (remote ? selectedWildCount > 0 : faces.length > 0);
    const matchFace = remote ? true : faces.indexOf(num) >= 0;
    const barrenSelectable =
      barrenPick &&
      (areaKey === 'resource' || (areaKey === 'special' && !lockedByRound));
    const neutralSelectable =
      neutralPick &&
      (areaKey === 'resource' || areaKey === 'special') &&
      !(areaKey === 'special' && lockedByRound);
    const recallSelectable = recallSlotSelectable(
      game,
      meId,
      areaKey,
      num,
      workers
    );
    const gatherNeutralsSelectable = gatherNeutralsSlotSelectable(
      game,
      meId,
      areaKey,
      num,
      workers,
      lockedByRound
    );
    const teleportFromSelectable = teleportFromSlotSelectable(
      game,
      meId,
      areaKey,
      num,
      workers,
      lockedByRound
    );
    const teleportToSelectable = teleportToSlotSelectable(
      game,
      meId,
      areaKey,
      num,
      tiles,
      lockedByRound
    );
    const banditSelectable =
      banditPick && hasTiles && !(areaKey === 'special' && lockedByRound);
    const dispatchable = canPick && matchFace && hasTiles;
    return {
      barrenSelectable,
      neutralSelectable,
      recallSelectable,
      gatherNeutralsSelectable,
      teleportFromSelectable,
      teleportToSelectable,
      banditSelectable,
      dispatchable,
      canPickBase,
      banditPick,
      workers,
    };
  }

  function applyBoardSlotInteraction(slot, ix) {
    slot.classList.remove(
      'is-target',
      'is-dimmed',
      'is-picked',
      'is-locked',
      'has-barren-marker'
    );
    slot.disabled = !(
      ix.barrenSelectable ||
      ix.neutralSelectable ||
      ix.recallSelectable ||
      ix.gatherNeutralsSelectable ||
      ix.teleportFromSelectable ||
      ix.teleportToSelectable ||
      ix.banditSelectable ||
      ix.dispatchable
    );
    if (
      ix.barrenSelectable ||
      ix.neutralSelectable ||
      ix.recallSelectable ||
      ix.gatherNeutralsSelectable ||
      ix.teleportFromSelectable ||
      ix.teleportToSelectable ||
      ix.banditSelectable ||
      ix.dispatchable
    ) {
      slot.classList.add('is-target');
    }
    const tileCards = slot.querySelectorAll('.las-tile');
    for (const card of tileCards) {
      if (ix.canPickBase && !ix.dispatchable) {
        card.classList.add('is-dimmed');
      } else {
        card.classList.remove('is-dimmed');
      }
    }
    const areaKey = slot.dataset.area;
    const num = Number(slot.dataset.num);
    if (
      ix.barrenSelectable &&
      barrenPickArea === areaKey &&
      barrenPickNumber === num
    ) {
      slot.classList.add('is-picked');
    } else if (
      ix.neutralSelectable &&
      selectedTarget &&
      selectedTarget.type === 'area' &&
      selectedTarget.area === areaKey &&
      selectedTarget.number === num
    ) {
      slot.classList.add('is-picked');
    } else if (
      ix.neutralSelectable &&
      neutralPickArea === areaKey &&
      neutralPickNumber === num
    ) {
      slot.classList.add('is-picked');
    } else if (
      selectedTarget &&
      selectedTarget.type === 'area' &&
      selectedTarget.area === areaKey &&
      selectedTarget.number === num
    ) {
      slot.classList.add('is-picked');
    }
    // 增量刷新勿丢掉定位锚点：has-barren-marker 被 remove 后需按现况补回
    if (
      lastGame &&
      lastGame.barrenMarkerNumber != null &&
      Number(lastGame.barrenMarkerNumber) === num &&
      ((lastGame.barrenMarkerArea != null && lastGame.barrenMarkerArea) ||
        'resource') === areaKey
    ) {
      slot.classList.add('has-barren-marker');
    } else if (slot.querySelector('.las-barren-marker')) {
      slot.classList.add('has-barren-marker');
    }
    const confirmBtn = slot.querySelector('.las-slot-confirm-btn');
    if (confirmBtn) {
      let show = false;
      if (
        selectedTarget &&
        selectedTarget.type === 'area' &&
        selectedTarget.area === areaKey &&
        selectedTarget.number === num
      ) {
        if (lastGame && isMercenaryPlaceMode(lastGame, lastMeId)) {
          show = diceReady() && selectedFace != null;
        } else if (lastGame && isRemoteMode(lastGame)) {
          show = diceReady() && selectedWildCount > 0;
        } else {
          show = diceReady() && selectedFace != null;
        }
      }
      setSlotConfirmVisible(confirmBtn, show);
    }
  }

  function handleBoardSlotClick(areaKey, num) {
    const game = lastGame;
    const meId = lastMeId;
    if (!game) return;
    const area =
      (game.board && game.board[areaKey]) || { slots: [], workers: {} };
    const slotInfo =
      (area.slots || []).find((s) => s.number === num) || {
        number: num,
        tiles: (area.tiles || []).filter((t) => t.number === num),
        workers: (area.workers && area.workers[num]) || {},
      };
    const tiles = slotInfo.tiles || [];
    const workers = slotInfo.workers || {};
    const ix = getBoardSlotInteraction(
      game,
      meId,
      areaKey,
      num,
      slotInfo,
      tiles,
      workers
    );
    if (ix.barrenSelectable) {
      barrenPickArea = areaKey;
      barrenPickNumber = num;
      syncBoardPickHighlight();
      syncBarrenMarkerPickUi(lastGame, lastMeId);
      return;
    }
    if (ix.recallSelectable) {
      if (!netRef) return;
      const counts = slotPlayerDieCounts(game, areaKey, num, meId);
      if (counts.normal > 0 && counts.enhanced > 0) {
        recallPickArea = areaKey;
        recallPickNumber = num;
        syncRecallPickUi(game, meId);
        return;
      }
      netRef.sendAction('eventRecallDie', {
        area: areaKey,
        number: num,
        enhanced: counts.enhanced > 0,
      });
      return;
    }
    if (ix.gatherNeutralsSelectable) {
      if (!netRef) return;
      netRef.sendAction('eventGatherNeutrals', { area: areaKey, number: num });
      return;
    }
    if (ix.teleportFromSelectable) {
      handleTeleportFromPick(areaKey, num, workers);
      return;
    }
    if (ix.teleportToSelectable) {
      if (!netRef) return;
      netRef.sendAction('eventTeleportTo', { area: areaKey, number: num });
      return;
    }
    if (ix.neutralSelectable) {
      selectedTarget = { type: 'area', area: areaKey, number: num };
      neutralPickArea = areaKey;
      neutralPickNumber = num;
      syncBoardPickHighlight();
      syncNeutralPickUi(lastGame, lastMeId);
      return;
    }
    if (ix.banditSelectable) {
      selectedTarget = { type: 'area', area: areaKey, number: num };
      syncBoardPickHighlight();
      syncBanditPickUi(lastGame, lastMeId);
      return;
    }
    if (!ix.dispatchable) return;
    pickAreaTarget(areaKey, num);
  }

  function ensureBoardClickDelegate(boardEl, areaKey) {
    if (boardClickBound[areaKey]) return;
    boardClickBound[areaKey] = true;
    boardEl.addEventListener('click', (ev) => {
      const slot = ev.target.closest('.las-slot');
      if (!slot || !boardEl.contains(slot)) return;
      const num = Number(slot.dataset.num);
      if (!Number.isFinite(num)) return;
      handleBoardSlotClick(areaKey, num);
    });
  }

  function playerBoardContentHash(p, game, meId) {
    const isMe = Boolean(meId && p.id === meId);
    const funcCards = p.funcCards || [];
    const buildings = p.buildings || [];
    return [
      p.id,
      p.seat,
      p.left ? 1 : 0,
      p.id === game.currentPlayerId ? 1 : 0,
      p.score,
      p.villagers,
      p.houses,
      p.freeHouses,
      JSON.stringify(p.resources || {}),
      funcCards.map((c) => c.id + (c.hidden ? ':h' : '')).join(','),
      buildings
        .map(
          (b) =>
            `${b.id}:${b.built ? 1 : 0}:${b.slot}:${b.workers || 0}:${
              b.faceDown ? 1 : 0
            }`
        )
        .join(','),
      p.pendingDiscardBuild ? 1 : 0,
      p.pendingDiscardFunc ? 1 : 0,
      p.needsDiscardFunc ? 1 : 0,
      p.needsDiscardBuild ? 1 : 0,
      p.needsDiscardRes ? 1 : 0,
      game.phase,
      selectedBuildingId || '',
      selectedFuncId || '',
      selectedPermanent || '',
      game.pendingTrade
        ? `${game.pendingTrade.fromId}:${game.pendingTrade.toId}`
        : '',
      p.commerceTycoon ? 1 : 0,
      (p.titles || []).map((x) => x.id || x).join(','),
    ].join('|');
  }
  /* __LAS_INCREMENTAL_RENDER_END__ */

  function renderAreaBoard(game, meId, areaKey) {
    const boardEl = $('las-board-' + areaKey);
    if (!boardEl) return;
    ensureBoardClickDelegate(boardEl, areaKey);

    const area =
      (game.board && game.board[areaKey]) || { slots: [], workers: {} };
    const remote = isRemoteMode(game);
    const faces = availableFaces();
    const barrenPick = isBarrenMarkerPickMode(game, meId);
    const neutralPick = isNeutralPickMode(game, meId);
    const recallPick = isRecallPickMode(game, meId);
    const gatherNeutralsPick = isGatherNeutralsPickMode(game, meId);
    const teleportPick = isTeleportPickMode(game, meId);
    const banditPick = isBanditPickMode(game, meId);
    const mercPlace = isMercenaryPlaceMode(game, meId);

    for (let num = 1; num <= 6; num++) {
      const slotInfo =
        (area.slots || []).find((s) => s.number === num) || {
          number: num,
          tiles: (area.tiles || []).filter((t) => t.number === num),
          workers: (area.workers && area.workers[num]) || {},
        };
      const tiles = slotInfo.tiles || [];
      const workers = slotInfo.workers || {};
      const boosts =
        slotInfo.boosts ||
        (area.boosts && area.boosts[num]) ||
        {};

      const capacity =
        areaKey === 'resource' ? resourceSlotCapacity(num) : 1;
      const slotCardCount = areaKey === 'resource' ? 3 : capacity;
      const tilesByPos = tilesAtBoardPositions(tiles, capacity);
      const contentHash = boardSlotContentHash(
        game,
        areaKey,
        num,
        slotInfo,
        tilesByPos,
        workers,
        boosts
      );
      let slot = boardEl.querySelector('.las-slot[data-num="' + num + '"]');
      const needsLayoutFix =
        slot && !slot.querySelector('.las-slot-num .las-slot-confirm-layer');
      const needsRebuild =
        !slot ||
        slot.dataset.lasContentHash !== contentHash ||
        needsLayoutFix;
      if (!slot) {
        slot = document.createElement('button');
        slot.type = 'button';
        slot.className = 'las-slot las-slot-' + areaKey;
        slot.dataset.area = areaKey;
        slot.dataset.num = String(num);
        slot.style.setProperty('--las-slot-card-count', String(slotCardCount));
        boardEl.appendChild(slot);
      } else if (needsRebuild) {
        slot.innerHTML = '';
        slot.className = 'las-slot las-slot-' + areaKey;
      }
      if (needsRebuild) {
        slot.dataset.lasContentHash = contentHash;
      }
      const round = game.round || 1;
      const openCount = areaOpenSlotCount(areaKey, round);
      const lockedByRound =
        areaKey === 'special' &&
        num > openCount;

      const hasTiles = tilesByPos.some(Boolean);
      const canPickBase =
        !barrenPick &&
        !neutralPick &&
        !recallPick &&
        !gatherNeutralsPick &&
        !teleportPick &&
        !banditPick &&
        ((game.phase === 'produce' &&
          isMyTurn(game, meId) &&
          diceReady()) ||
          (mercPlace && diceReady()));
      const canPick =
        canPickBase &&
        (remote ? selectedWildCount > 0 : faces.length > 0);
      const matchFace = remote ? true : faces.indexOf(num) >= 0;
      const barrenSelectable =
        barrenPick &&
        (areaKey === 'resource' ||
          (areaKey === 'special' && !lockedByRound));
      const neutralSelectable =
        neutralPick &&
        (areaKey === 'resource' || areaKey === 'special') &&
        !(areaKey === 'special' && lockedByRound);
      const recallSelectable = recallSlotSelectable(
        game,
        meId,
        areaKey,
        num,
        workers
      );
      const gatherNeutralsSelectable = gatherNeutralsSlotSelectable(
        game,
        meId,
        areaKey,
        num,
        workers,
        lockedByRound
      );
      const teleportFromSelectable = teleportFromSlotSelectable(
        game,
        meId,
        areaKey,
        num,
        workers,
        lockedByRound
      );
      const teleportToSelectable = teleportToSlotSelectable(
        game,
        meId,
        areaKey,
        num,
        tiles,
        lockedByRound
      );
      const banditSelectable =
        banditPick &&
        hasTiles &&
        !(areaKey === 'special' && lockedByRound);
      const dispatchable = canPick && matchFace && hasTiles;
      const slotIx = getBoardSlotInteraction(
        game,
        meId,
        areaKey,
        num,
        slotInfo,
        tilesByPos.filter(Boolean),
        workers
      );
      if (!needsRebuild) {
        applyBoardSlotInteraction(slot, slotIx);
        continue;
      }
      const head = document.createElement('div');
      head.className = 'las-slot-head';
      const numEl = document.createElement('div');
      numEl.className = 'las-slot-num';
      const numLabel = document.createElement('span');
      numLabel.className = 'las-slot-num-label';
      numLabel.textContent = String(num);
      numEl.appendChild(numLabel);
      const diceRow = appendWorkerDice(
        numEl,
        num,
        workers,
        game.players,
        game,
        { overlay: true, boosts }
      );
      const wTxt = workersText(workers, game.players, game, boosts);
      if (diceRow && wTxt) diceRow.title = wTxt;
      const confirmLayer = document.createElement('div');
      confirmLayer.className = 'las-slot-confirm-layer';
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'las-slot-confirm-btn';
      confirmBtn.textContent = t('lasidao.confirmDispatch');
      confirmBtn.onclick = (e) => {
        e.stopPropagation();
        confirmDispatch();
      };
      confirmLayer.appendChild(confirmBtn);
      numEl.appendChild(confirmLayer);
      head.appendChild(numEl);
      slot.appendChild(head);

      const body = document.createElement('div');
      body.className = 'las-slot-body';
      const stack = document.createElement('div');
      stack.className = 'las-slot-tiles';

      for (let idx = 0; idx < capacity; idx++) {
        const tile = tilesByPos[idx];
        if (tile) {
          const card = makeTileCard(tile, areaKey);
          if (pendingDealIds.has(tile.id)) {
            card.classList.add('is-dealing');
          }
          stack.appendChild(card);
        } else {
          stack.appendChild(
            makeBoardSlotEmptyEl(areaKey, num, idx, game, {
              markSlotLocked:
                capacity === 1
                  ? () => slot.classList.add('is-locked')
                  : null,
            })
          );
        }
      }
      body.appendChild(stack);

      if (areaKey === 'resource' && num >= 1 && num <= 6) {
        const envWrap = document.createElement('div');
        envWrap.className = 'las-slot-env-wrap';
        const envLabel = document.createElement('div');
        envLabel.className = 'las-slot-env-label muted';
        envLabel.textContent = t('lasidao.environmentSlot');
        envWrap.appendChild(envLabel);
        const envBox = document.createElement('div');
        envBox.className = 'las-slot-env';
        const envTile =
          (area.environments && area.environments[num]) ||
          slotInfo.environment ||
          null;
        if (envTile) {
          const envCard = makeEnvironmentTileCard(envTile);
          if (pendingDealIds.has(envTile.id)) {
            envCard.classList.add('is-dealing');
          }
          envBox.appendChild(envCard);
          const badges = document.createElement('div');
          badges.className = 'las-env-badges';
          if (Number(envTile.mercenaryDice) > 0) {
            const mercN = Math.min(Number(envTile.mercenaryDice) || 0, 8);
            const mercRow = document.createElement('div');
            mercRow.className = 'las-env-mercenary-dice';
            mercRow.title = t('lasidao.eventMercenaryBadge', { n: mercN });
            for (let i = 0; i < mercN; i++) {
              mercRow.appendChild(
                makeDieEl('?', 'is-mini is-mercenary', 'neutral')
              );
            }
            envBox.appendChild(mercRow);
          }
          if (envTile.hasSideCard || envTile.sideCardKind) {
            const sideKind =
              envTile.sideCardKind === 'building' ? 'building' : 'function';
            const sideCard = makeTileCard(
              {
                id: (envTile.id || 'env') + ':side',
                kind: sideKind,
                faceDown: true,
                label: null,
              },
              sideKind
            );
            sideCard.classList.add('las-env-side-card');
            sideCard.title = t('lasidao.eventSideCardBadge');
            envBox.appendChild(sideCard);
          }
          if (
            envTile.envType === 'firstCome' &&
            envTile.stash &&
            RESOURCES.reduce((s, r) => s + (Number(envTile.stash[r]) || 0), 0) > 0
          ) {
            const labels = defaultResLabels();
            const stashWrap = document.createElement('div');
            stashWrap.className = 'las-env-stash-wrap';
            const need = Number(envTile.firstComeRequired) || 0;
            const stashTitle = document.createElement('div');
            stashTitle.className = 'las-env-stash-title';
            stashTitle.textContent = need
              ? t('lasidao.eventFirstComeStashTitle', { need })
              : t('lasidao.eventFirstComeLabel');
            stashWrap.appendChild(stashTitle);
            const stashStack = document.createElement('div');
            stashStack.className = 'las-env-stash-stack';
            let stackIdx = 0;
            let totalN = 0;
            const tipLines = [];
            const tipImgs = [];
            for (const res of RESOURCES) {
              const n = Number(envTile.stash[res]) || 0;
              if (n <= 0) continue;
              const resLabel = labels[res] || res;
              totalN += n;
              tipLines.push(resLabel + '×' + n);
              const handUrl =
                window.LasidaoAssets &&
                typeof window.LasidaoAssets.resourceHandImageUrl === 'function'
                  ? window.LasidaoAssets.resourceHandImageUrl(res)
                  : '';
              if (handUrl) tipImgs.push(handUrl);
              const stashCard = document.createElement('div');
              stashCard.className =
                'las-tile resource las-env-stash-card has-art';
              stashCard.style.setProperty('--las-stash-i', String(stackIdx));
              stashCard.setAttribute('aria-hidden', 'true');
              const art = document.createElement('div');
              art.className = 'las-tile-art has-image';
              art.setAttribute('aria-hidden', 'true');
              if (handUrl) {
                art.style.backgroundImage = 'url("' + handUrl + '")';
              }
              stashCard.appendChild(art);
              stashStack.appendChild(stashCard);
              stackIdx += 1;
            }
            stashStack.style.setProperty(
              '--las-stash-n',
              String(Math.max(1, stackIdx))
            );
            const stackBadge = document.createElement('span');
            stackBadge.className = 'las-env-stash-count';
            stackBadge.textContent = '×' + totalN;
            stashStack.appendChild(stackBadge);
            const tipText = [
              t('lasidao.eventFirstComeLabel'),
              tipLines.join('\n'),
            ]
              .filter(Boolean)
              .join('\n');
            stashStack.title = tipText.replace(/\n/g, ' · ');
            stashStack.setAttribute('aria-label', tipText.replace(/\n/g, '，'));
            stashStack.addEventListener('mouseenter', (e) => {
              showCardTip(tipText, e, stashStack, tipImgs);
            });
            stashStack.addEventListener('mousemove', (e) => {
              const tip = $('las-card-tip');
              if (!tip || tip.hidden) return;
              positionCardTip(tip, e, stashStack);
            });
            stashStack.addEventListener('mouseleave', () => hideCardTip());
            stashStack.addEventListener('pointerdown', () => hideCardTip());
            stashWrap.appendChild(stashStack);
            envBox.appendChild(stashWrap);
          }
          if (badges.childNodes.length) envBox.appendChild(badges);
        } else {
          const emptyEnv = document.createElement('span');
          emptyEnv.className = 'muted las-slot-empty las-slot-env-empty';
          emptyEnv.textContent = t('lasidao.emptySlot');
          envBox.appendChild(emptyEnv);
        }
        envWrap.appendChild(envBox);
        body.appendChild(envWrap);
      }

      const markerArea =
        (game.barrenMarkerArea != null && game.barrenMarkerArea) || 'resource';
      if (
        game.barrenMarkerNumber != null &&
        markerArea === areaKey &&
        Number(game.barrenMarkerNumber) === num
      ) {
        slot.classList.add('has-barren-marker');
        const mark = document.createElement('div');
        mark.className = 'las-barren-marker';
        const ownerId = game.barrenMarkerOwnerId;
        const owner = ownerId
          ? (game.players || []).find((p) => p.id === ownerId)
          : null;
        if (ownerId) {
          const color = playerDieColor(game.players, ownerId, game);
          mark.classList.add('color-' + color, 'has-owner');
          const swatch = document.createElement('span');
          swatch.className = 'las-die-swatch color-' + color;
          swatch.setAttribute('aria-hidden', 'true');
          mark.appendChild(swatch);
        }
        const markLabel = document.createElement('span');
        markLabel.className = 'las-barren-marker-label';
        markLabel.textContent = t('lasidao.eventBarrenMarker');
        mark.appendChild(markLabel);
        const barrenTipText = [
          t('lasidao.eventBarrenTitle'),
          owner
            ? t('lasidao.eventBarrenMarkerOwner', { name: owner.name })
            : '',
          t('lasidao.eventBarrenMarkerTip'),
        ]
          .filter(Boolean)
          .join('\n');
        mark.setAttribute('aria-label', barrenTipText);
        const barrenImg =
          window.LasidaoAssets &&
          typeof window.LasidaoAssets.environmentImageUrl === 'function'
            ? window.LasidaoAssets.environmentImageUrl({
                envType: 'barrenHarvest',
              }) || ''
            : '';
        mark.addEventListener('mouseenter', (e) => {
          e.stopPropagation();
          showCardTip(barrenTipText, e, mark, barrenImg);
        });
        mark.addEventListener('mousemove', (e) => {
          e.stopPropagation();
          const tip = $('las-card-tip');
          if (!tip || tip.hidden) return;
          positionCardTip(tip, e, mark);
        });
        mark.addEventListener('mouseleave', () => hideCardTip());
        mark.addEventListener('mousedown', (e) => e.stopPropagation());
        mark.addEventListener('click', (e) => e.stopPropagation());
        // 挂到 slot 上，相对整个数字格定位到右上角
        slot.appendChild(mark);
      }

      slot.appendChild(body);
      applyBoardSlotInteraction(slot, slotIx);

      if (!slot.parentNode) boardEl.appendChild(slot);
    }

    // 建筑区不再提供派遣到个人建筑按钮（生产建筑建成后自动产出，无需放村民）

  }

  function collectBoardTileMap(game) {
    const map = new Map(); // id -> { area, number, label, faceDown, tile }
    for (const area of ['resource', 'special']) {
      const tiles =
        (game.board && game.board[area] && game.board[area].tiles) || [];
      for (const tile of tiles) {
        if (!tile || !tile.id) continue;
        map.set(tile.id, {
          area,
          number: tile.number,
          label: tile.faceDown ? null : tile.label,
          faceDown: Boolean(tile.faceDown),
          tile,
        });
      }
      if (area === 'resource') {
        const envs =
          (game.board &&
            game.board.resource &&
            game.board.resource.environments) ||
          {};
        for (const num of [1, 2, 3, 4, 5, 6]) {
          const tile = envs[num];
          if (!tile || !tile.id || map.has(tile.id)) continue;
          map.set(tile.id, {
            area: 'environment',
            number: num,
            label: tile.label,
            faceDown: false,
            tile,
          });
        }
      }
      // also from slots if tiles array empty but slots present
      const slots =
        (game.board && game.board[area] && game.board[area].slots) || [];
      for (const s of slots) {
        for (const tile of s.tiles || []) {
          if (!tile || !tile.id || map.has(tile.id)) continue;
          map.set(tile.id, {
            area,
            number: s.number,
            label: tile.faceDown ? null : tile.label,
            faceDown: Boolean(tile.faceDown),
            tile,
          });
        }
        if (area === 'resource' && s.environment && s.environment.id) {
          const tile = s.environment;
          if (!map.has(tile.id)) {
            map.set(tile.id, {
              area: 'environment',
              number: s.number,
              label: tile.label,
              faceDown: false,
              tile,
            });
          }
        }
      }
    }
    return map;
  }

  function tileKindForDeck(tile) {
    if (!tile) return null;
    if (tile.kind === 'building' || tile.buildType) return 'building';
    if (tile.kind === 'function' || tile.funcType) return 'function';
    return null;
  }

  function buildDealDeckFreeze(game, prevGame, newcomers) {
    const list = newcomers || [];
    const resDealt = list.filter((n) => n.area === 'resource').length;
    const envDealt = list.filter((n) => n.area === 'environment').length;
    const specials = list
      .filter((n) => n.area === 'special')
      .slice()
      .sort((a, b) => (a.number || 0) - (b.number || 0));
    const spDealt = specials.length;

    if (prevGame) {
      return {
        specialDeckTopKind: prevGame.specialDeckTopKind || null,
        decksLeft: {
          resource:
            prevGame.decksLeft && prevGame.decksLeft.resource != null
              ? prevGame.decksLeft.resource
              : ((game.decksLeft && game.decksLeft.resource) || 0) + resDealt,
          special:
            prevGame.decksLeft && prevGame.decksLeft.special != null
              ? prevGame.decksLeft.special
              : ((game.decksLeft && game.decksLeft.special) || 0) + spDealt,
          environment:
            prevGame.decksLeft && prevGame.decksLeft.environment != null
              ? prevGame.decksLeft.environment
              : ((game.decksLeft && game.decksLeft.environment) || 0) +
                envDealt,
        },
        discardsLeft: prevGame.discardsLeft
          ? { ...prevGame.discardsLeft }
          : game.discardsLeft
            ? { ...game.discardsLeft }
            : null,
      };
    }

    const firstSp = specials[0];
    return {
      specialDeckTopKind: tileKindForDeck(firstSp && firstSp.tile),
      decksLeft: {
        resource: ((game.decksLeft && game.decksLeft.resource) || 0) + resDealt,
        special: ((game.decksLeft && game.decksLeft.special) || 0) + spDealt,
        environment:
          ((game.decksLeft && game.decksLeft.environment) || 0) + envDealt,
      },
      discardsLeft: game.discardsLeft ? { ...game.discardsLeft } : null,
    };
  }

  function applyDeckUi(game) {
    const freeze = dealDeckFreeze;
    const decksLeft = (freeze && freeze.decksLeft) || (game && game.decksLeft);
    const discardsLeft =
      (freeze && freeze.discardsLeft) || (game && game.discardsLeft);
    const setNum = (id, n) => {
      const el = $(id);
      if (el) el.textContent = String(n || 0);
    };
    setNum('las-deck-res', decksLeft && decksLeft.resource);
    setNum('las-deck-sp', decksLeft && decksLeft.special);
    setNum('las-deck-env', decksLeft && decksLeft.environment);
    setNum('las-discard-res', discardsLeft && discardsLeft.resource);
    setNum('las-discard-sp', discardsLeft && discardsLeft.special);
    setNum('las-discard-env', discardsLeft && discardsLeft.environment);
    updateSpecialDeckTopArt(
      freeze
        ? { specialDeckTopKind: freeze.specialDeckTopKind }
        : game
    );
  }

  function maybePlayDeal(game, prevGame) {
    const map = collectBoardTileMap(game);
    const ids = new Set(map.keys());
    const round = Number(game.round) || 1;

    // ???? / ??????
    if (
      game.phase === 'init_roll' ||
      game.phase === 'init_announce' ||
      ids.size === 0
    ) {
      knownBoardTiles = ids;
      return;
    }

    // ????????????????????
    if (dealtForRound === round) {
      knownBoardTiles = ids;
      return;
    }

    const newcomers = [];
    for (const id of ids) {
      newcomers.push(Object.assign({ id }, map.get(id)));
    }
    knownBoardTiles = ids;
    dealtForRound = round;
    if (!newcomers.length || dealAnimPlaying) return;
    pendingDealIds = new Set(newcomers.map((n) => n.id));
    dealDeckFreeze = buildDealDeckFreeze(game, prevGame, newcomers);
    renderBoard(game, lastMeId);
    applyDeckUi(game);
    const fx = window.LasidaoFx;
    if (!fx || typeof fx.playDeal !== 'function') {
      pendingDealIds = new Set();
      dealDeckFreeze = null;
      renderBoard(game, lastMeId);
      applyDeckUi(game);
      return;
    }
    dealAnimPlaying = true;
    applyDeckUi(game);
    Promise.resolve(fx.playDeal(newcomers))
      .catch(() => {})
      .then(() => {
        pendingDealIds = new Set();
        dealAnimPlaying = false;
        dealDeckFreeze = null;
        if (lastGame) {
          renderBoard(lastGame, lastMeId);
          applyDeckUi(lastGame);
          flushDeferredHeavyRender();
        }
      });
  }

  function renderBoard(game, meId) {
    hideCardTip();
    renderAreaBoard(game, meId, 'resource');
    renderAreaBoard(game, meId, 'special');
  }

  function renderGroupedDice() {
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (!diceEl || !groupsEl) return;
    diceEl.hidden = true;
    diceEl.innerHTML = '';
    groupsEl.hidden = false;
    groupsEl.innerHTML = '';

    const dice = diceAnim.finalDice || [];
    const boosted = diceAnim.finalBoosted || [];
    const stats = faceDiceStats(dice, boosted);
    const faces = Object.keys(stats)
      .map(Number)
      .sort((a, b) => a - b);
    const myColor = playerDieColor(
      (lastGame && lastGame.players) || [],
      lastMeId,
      lastGame
    );

    for (const face of faces) {
      const stat = stats[face];
      const normal = stat.total - stat.boosted;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'las-die-group';
      btn.dataset.face = String(face);
      if (selectedFace === face) btn.classList.add('is-selected');
      else if (selectedFace != null) btn.classList.add('is-dim');

      const diceWrap = document.createElement('div');
      diceWrap.className = 'las-die-group-dice';
      if (stat.boosted > 0) {
        appendGroupDieStack(diceWrap, face, stat.boosted, true, myColor);
      }
      if (normal > 0) {
        appendGroupDieStack(diceWrap, face, normal, false, myColor);
      }
      btn.appendChild(diceWrap);

      btn.title = t('lasidao.dieGroupTitle', {
        face,
        count: stat.total,
      });
      if (stat.boosted > 0) {
        btn.title +=
          ' (' + t('lasidao.boostMul', { n: stat.boosted }) + ')';
      }
      btn.onclick = () => {
        if (!diceReady()) return;
        selectedFace = selectedFace === face ? null : face;
        selectedTarget = null;
        syncBoardPickHighlight();
        syncGroupedDiceSelection();
        updateDispatchPreview();
        updateDiceHint();
      };
      groupsEl.appendChild(btn);
    }
  }

  function startDiceAnimation(finalDice, meId, boostFlags) {
    clearDiceTimers();
    resetDiceSelection();
    diceAnim.stage = 'rolling';
    diceAnim.finalDice = finalDice.slice();
    diceAnim.finalBoosted = (boostFlags || []).slice();

    const wrap = $('las-dice-wrap');
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (!wrap || !diceEl || !groupsEl) return;

    wrap.hidden = false;
    groupsEl.hidden = true;
    groupsEl.innerHTML = '';
    diceEl.hidden = false;
    diceEl.innerHTML = '';
    updateDiceHint();
    updateDispatchPreview();

    const n = finalDice.length;
    const myColor = playerDieColor(
      (lastGame && lastGame.players) || [],
      meId
    );
    const dieNodes = [];
    for (let i = 0; i < n; i++) {
      const el = makeDieEl(
        1 + Math.floor(Math.random() * 6),
        'is-rolling' + (diceAnim.finalBoosted[i] ? ' is-boosted' : ''),
        myColor
      );
      diceEl.appendChild(el);
      dieNodes.push(el);
    }

    const spin = setInterval(() => {
      for (const el of dieNodes) {
        el.textContent = String(1 + Math.floor(Math.random() * 6));
      }
    }, 70);
    diceAnim.intervals.push(spin);

    const t1 = setTimeout(() => {
      clearInterval(spin);
      for (let i = 0; i < n; i++) {
        const el = dieNodes[i];
        el.classList.remove('is-rolling');
        el.classList.add('is-reveal');
        if (diceAnim.finalBoosted[i]) el.classList.add('is-boosted');
        el.textContent = String(finalDice[i]);
      }
      updateDiceHint();
    }, 900);
    diceAnim.timers.push(t1);

    const t2 = setTimeout(() => {
      diceAnim.stage = 'grouping';
      updateDiceHint();

      const counts = countByFace(finalDice);
      const faces = Object.keys(counts)
        .map(Number)
        .sort((a, b) => a - b);
      const faceIndex = {};
      faces.forEach((f, i) => {
        faceIndex[f] = i;
      });

      const groupWidth = 64;
      const totalW = faces.length * groupWidth + (faces.length - 1) * 8;
      const startX = -totalW / 2 + groupWidth / 2;

      for (let i = 0; i < n; i++) {
        const face = finalDice[i];
        const gi = faceIndex[face];
        const el = dieNodes[i];
        const fromRect = el.getBoundingClientRect();
        const stage = $('las-dice-stage');
        const stageRect = stage
          ? stage.getBoundingClientRect()
          : { left: 0, width: 300, top: fromRect.top };
        const targetCenterX =
          stageRect.left + stageRect.width / 2 + startX + gi * (groupWidth + 8);
        const curCenterX = fromRect.left + fromRect.width / 2;
        const dx = targetCenterX - curCenterX;
        el.classList.add('is-fly');
        el.style.transform = 'translateX(' + dx + 'px)';
        el.style.opacity = '0.35';
      }
    }, 1300);
    diceAnim.timers.push(t2);

    const t3 = setTimeout(() => {
      diceAnim.stage = 'ready';
      renderGroupedDice();
      updateDiceHint();
      updateDispatchPreview();
      renderBoard(lastGame, meId);
      renderDice(lastGame, lastMeId);
    }, 1800);
    diceAnim.timers.push(t3);
  }

  function startSpectatorDiceAnimation(finalDice, color, actorName, boostFlags) {
    clearDiceTimers();
    resetDiceSelection();
    diceAnim.stage = 'rolling';
    diceAnim.finalDice = finalDice.slice();
    diceAnim.finalBoosted = (boostFlags || []).slice();

    const wrap = $('las-dice-wrap');
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (!wrap || !diceEl || !groupsEl) return;

    wrap.hidden = false;
    groupsEl.hidden = true;
    groupsEl.innerHTML = '';
    diceEl.hidden = false;
    diceEl.innerHTML = '';
    updateDiceHint();

    const n = finalDice.length;
    const dieNodes = [];
    for (let i = 0; i < n; i++) {
      const el = makeDieEl(
        1 + Math.floor(Math.random() * 6),
        'is-rolling' + (diceAnim.finalBoosted[i] ? ' is-boosted' : ''),
        color
      );
      diceEl.appendChild(el);
      dieNodes.push(el);
    }

    const spin = setInterval(() => {
      for (const el of dieNodes) {
        el.textContent = String(1 + Math.floor(Math.random() * 6));
      }
    }, 70);
    diceAnim.intervals.push(spin);

    const t1 = setTimeout(() => {
      clearInterval(spin);
      for (let i = 0; i < n; i++) {
        const el = dieNodes[i];
        el.classList.remove('is-rolling');
        el.classList.add('is-reveal');
        if (diceAnim.finalBoosted[i]) el.classList.add('is-boosted');
        const v = finalDice[i];
        el.textContent = v === 0 ? t('lasidao.wildDie') : String(v);
      }
      updateDiceHint();
    }, 900);
    diceAnim.timers.push(t1);

    const t2 = setTimeout(() => {
      diceAnim.stage = 'grouping';
      updateDiceHint();

      const counts = countByFace(finalDice);
      const faces = Object.keys(counts)
        .map(Number)
        .sort((a, b) => a - b);
      const faceIndex = {};
      faces.forEach((f, i) => {
        faceIndex[f] = i;
      });

      const groupWidth = 64;
      const totalW = faces.length * groupWidth + (faces.length - 1) * 8;
      const startX = -totalW / 2 + groupWidth / 2;

      for (let i = 0; i < n; i++) {
        const face = finalDice[i];
        const gi = faceIndex[face];
        const el = dieNodes[i];
        const fromRect = el.getBoundingClientRect();
        const stage = $('las-dice-stage');
        const stageRect = stage
          ? stage.getBoundingClientRect()
          : { left: 0, width: 300, top: fromRect.top };
        const targetCenterX =
          stageRect.left + stageRect.width / 2 + startX + gi * (groupWidth + 8);
        const curCenterX = fromRect.left + fromRect.width / 2;
        const dx = targetCenterX - curCenterX;
        el.classList.add('is-fly');
        el.style.transform = 'translateX(' + dx + 'px)';
        el.style.opacity = '0.35';
      }
    }, 1300);
    diceAnim.timers.push(t2);

    const t3 = setTimeout(() => {
      diceAnim.stage = 'ready';
      renderSpectatorDice(finalDice, color, diceAnim.finalBoosted);
      const hint = $('las-dice-hint');
      if (hint) {
        hint.textContent = t('lasidao.otherDiceHint', { name: actorName });
      }
    }, 1800);
    diceAnim.timers.push(t3);
  }

  function renderRemoteDice(game, meId) {
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (!diceEl || !groupsEl) return;
    groupsEl.hidden = true;
    groupsEl.innerHTML = '';
    diceEl.hidden = false;
    diceEl.innerHTML = '';
    const dice = (game.dice || []).slice();
    const boostFlags = (game.diceBoosted || []).slice();
    const myColor = playerDieColor(game.players || [], meId);
    dice.forEach((val, idx) => {
      const el = makeDieEl(
        val === 0 ? t('lasidao.wildDie') : val,
        'is-wild' +
          (selectedWildIdx.has(idx) ? ' is-selected' : '') +
          (boostFlags[idx] ? ' is-boosted' : ''),
        myColor
      );
      el.style.cursor = 'pointer';
      el.onclick = () => {
        if (selectedWildIdx.has(idx)) selectedWildIdx.delete(idx);
        else selectedWildIdx.add(idx);
        selectedWildCount = selectedWildIdx.size;
        selectedTarget = null;
        selectedFace = null;
        renderRemoteDice(lastGame, lastMeId);
        // 遥控模式：槽位可点依赖 selectedWildCount；未刷新时 button[disabled] 吞掉点击
        if (lastGame) renderBoard(lastGame, lastMeId);
        syncBoardPickHighlight();
        updateDispatchPreview();
        updateDiceHint();
      };
      diceEl.appendChild(el);
    });
    diceAnim.stage = 'ready';
    diceAnim.finalDice = dice.slice();
    diceAnim.finalBoosted = boostFlags.slice();
  }

  function renderRollWrap(game, meId) {
    const wrap = $('las-roll-wrap');
    const rollBtn = $('btn-las-produce-roll');
    const remoteBtn = $('btn-las-remote-dice');
    if (!wrap) return;
    const showMerc = isMercenaryRollMode(game, meId);
    const showProduce =
      game.phase === 'produce' &&
      isMyTurn(game, meId) &&
      isAwaitingRoll(game);
    const show = showMerc || showProduce;
    wrap.hidden = !show;
    if (rollBtn) {
      rollBtn.hidden = !show;
      if (showMerc) {
        rollBtn.textContent = t('lasidao.eventMercenaryRollBtn');
      } else if (showProduce) {
        rollBtn.textContent = t('lasidao.produceRoll');
      }
    }
    if (remoteBtn) {
      remoteBtn.hidden = !(
        showProduce &&
        game.me &&
        game.me.hasRemoteDice &&
        canPlayFuncCard(game, meId, 'remoteDice')
      );
    }
    syncPostRemoteDiceBtn(game, meId);
    syncAutoProduceRoll(game, meId);
  }

  function syncPostRemoteDiceBtn(game, meId) {
    const postBtn = $('btn-las-remote-dice-post');
    if (!postBtn) return;
    const show =
      game &&
      game.me &&
      game.me.hasRemoteDice &&
      game.phase === 'produce' &&
      isMyTurn(game, meId) &&
      !isAwaitingRoll(game) &&
      canPlayFuncCard(game, meId, 'remoteDice');
    postBtn.hidden = !show;
  }

  function renderMercenaryDice(game, meId) {
    const wrap = $('las-dice-wrap');
    const merc = game.mercenary;
    if (!wrap || !merc) {
      if (wrap) wrap.hidden = true;
      return;
    }

    const confirm = $('btn-las-confirm');
    const voidBtn = $('btn-las-void');
    const preview = $('las-dispatch-preview');
    const produceActions = $('las-produce-actions');
    const rollWrap = $('las-roll-wrap');

    if (game.pendingEventChoice && game.pendingEventChoice.forMe) {
      wrap.hidden = true;
      if (produceActions) produceActions.hidden = true;
      return;
    }

    if (!merc.forMe) {
      wrap.hidden = false;
      if (produceActions) produceActions.hidden = true;
      if (confirm) confirm.hidden = true;
      if (voidBtn) voidBtn.hidden = true;
      if (preview) preview.hidden = true;
      const actorId = game.currentPlayerId;
      const actor = (game.players || []).find((p) => p.id === actorId);
      const actorName = actor ? actor.name : '';
      const roll = merc.roll || [];
      if (!roll.length) {
        if (diceAnim.stage !== 'idle') resetDiceAnim();
        setDiceTitle(t('lasidao.eventMercenarySpectateRoll', { name: actorName }));
        const diceEl = $('las-dice');
        const groupsEl = $('las-dice-groups');
        if (diceEl) {
          diceEl.hidden = false;
          diceEl.innerHTML =
            '<span class="muted">' +
            t('lasidao.eventMercenarySpectateWaiting') +
            '</span>';
        }
        if (groupsEl) {
          groupsEl.hidden = true;
          groupsEl.innerHTML = '';
        }
        updateDiceHint();
        return;
      }
      const animKey = 'merc:' + (game.currentPlayerId || '') + ':' + roll.join(',');
      if (mercenaryRollAnimKey !== animKey || diceAnim.stage === 'idle') {
        mercenaryRollAnimKey = animKey;
        const color = playerDieColor(game.players || [], actorId, game);
        startSpectatorDiceAnimation(roll, color, []);
      }
      setDiceTitle(t('lasidao.eventMercenarySpectatePlace', { name: actorName }));
      updateDiceHint();
      return;
    }

    wrap.hidden = false;
    const roll = merc.roll || [];

    if (!roll.length) {
      if (diceAnim.stage !== 'idle') resetDiceAnim();
      if (rollWrap) rollWrap.hidden = false;
      wrap.hidden = true;
      if (produceActions) produceActions.hidden = true;
      if (confirm) confirm.hidden = true;
      if (voidBtn) voidBtn.hidden = true;
      if (preview) preview.hidden = true;
      const diceEl = $('las-dice');
      const groupsEl = $('las-dice-groups');
      if (diceEl) { diceEl.hidden = true; diceEl.innerHTML = ''; }
      if (groupsEl) { groupsEl.hidden = true; groupsEl.innerHTML = ''; }
      setDiceTitle(t('lasidao.eventMercenaryTitle'));
      updateDiceHint();
      maybeShowMercenaryToast(game, meId);
      return;
    }

    if (rollWrap) rollWrap.hidden = true;
    if (produceActions) produceActions.hidden = false;

    const animKey = 'merc:' + (game.currentPlayerId || '') + ':' + roll.join(',');
    if (mercenaryRollAnimKey !== animKey || diceAnim.stage === 'idle') {
      mercenaryRollAnimKey = animKey;
      mercenaryRollAnimDoneKey = null;
      startDiceAnimation(roll.slice(), meId, roll.map(() => false));
      maybeShowMercenaryToast(game, meId);
    }

    const idx = currentMercenaryDieIndex(merc);
    if (idx < 0) {
      resetDiceAnim();
      const diceEl = $('las-dice');
      const groupsEl = $('las-dice-groups');
      if (diceEl) { diceEl.hidden = true; diceEl.innerHTML = ''; }
      if (groupsEl) { groupsEl.hidden = true; groupsEl.innerHTML = ''; }
      wrap.hidden = true;
      if (produceActions) produceActions.hidden = true;
      return;
    }

    if (diceAnim.stage === 'ready') {
      if (mercenaryRollAnimDoneKey !== mercenaryRollAnimKey) {
        mercenaryRollAnimDoneKey = mercenaryRollAnimKey;
        maybeShowMercenaryToast(game, meId);
      }
      clearBuildDicePanelMode();
      const remaining = remainingMercenaryDice(merc);
      const remainKey = remaining.join(',');
      const curKey = (diceAnim.finalDice || []).join(',');
      if (curKey !== remainKey) {
        diceAnim.finalDice = remaining.slice();
        diceAnim.finalBoosted = remaining.map(() => false);
        if (
          selectedFace != null &&
          remaining.indexOf(selectedFace) < 0
        ) {
          resetDiceSelection();
        }
      }
      renderGroupedDice();
      setDiceTitle(t('lasidao.eventMercenaryTitle'));
      if (voidBtn) {
        voidBtn.hidden = false;
        voidBtn.textContent = t('lasidao.eventMercenarySkipDie');
        voidBtn.disabled = false;
      }
      if (confirm) {
        confirm.textContent = t('lasidao.confirmDispatch');
      }
      updateDispatchPreview();
      updateDiceHint();
      return;
    }

    setDiceTitle(t('lasidao.eventMercenaryTitle'));
    if (confirm) confirm.hidden = true;
    if (voidBtn) voidBtn.hidden = true;
    if (preview) preview.hidden = true;
    updateDiceHint();
  }

  function setDiceTitle(text) {
    const title = $('las-dice-title');
    if (title) title.textContent = text;
  }

  function getBuildActionState(game, me) {
    const isBuild = Boolean(game && game.phase === 'build');
    const myTurn = Boolean(me && isMyTurn(game, me.id));
    const canAct = Boolean(isBuild && myTurn && me && !me.buildPassed);
    const hasSel = Boolean(
      selectedFuncId || selectedBuildingId || selectedPermanent
    );
    const mustDiscard = Boolean(
      me &&
        (me.pendingDiscardFunc || me.pendingDiscardBuild) &&
        !me.pendingDiscardRes
    );
    const canPlay = Boolean(canAct && hasSel && !mustDiscard);
    return { isBuild, canAct, hasSel, mustDiscard, canPlay };
  }

  function buildConfirmButtonText(game, me) {
    if (selectedBuildingId) {
      const b = (me.buildings || []).find((x) => x.id === selectedBuildingId);
      return b && b.slot == null
        ? t('lasidao.confirmPlaceBuilding')
        : t('lasidao.confirmConstruct');
    }
    if (selectedPermanent === 'buildHouse') {
      return t('lasidao.confirmBuildHouse');
    }
    if (selectedPermanent === 'breed') {
      return t('lasidao.confirmBreed');
    }
    if (selectedPermanent === 'expand') {
      return t('lasidao.confirmExpand');
    }
    if (selectedPermanent === 'exchange') {
      return t('lasidao.confirmExchange');
    }
    if (selectedPermanent === 'buyFunc') {
      return t('lasidao.confirmBuyFunc');
    }
    return t('lasidao.confirmUse');
  }

  function clearBuildDicePanelMode() {
    const pcell = $('las-pcell-dice');
    const wrap = $('las-dice-wrap');
    if (pcell) pcell.classList.remove('is-build-actions');
    if (wrap) wrap.classList.remove('is-build-actions');
    const diceHead = wrap && wrap.querySelector('.las-dice-head');
    const diceStage = $('las-dice-stage');
    if (diceHead) diceHead.hidden = false;
    if (diceStage) diceStage.hidden = false;
    const confirmBtn = $('btn-las-confirm');
    const passBtn = $('btn-las-void');
    if (confirmBtn) confirmBtn.disabled = false;
    if (passBtn) passBtn.disabled = false;
  }

  function syncBuildDicePanel(game, me) {
    const wrap = $('las-dice-wrap');
    const rollWrap = $('las-roll-wrap');
    const produceActions = $('las-produce-actions');
    const confirmBtn = $('btn-las-confirm');
    const passBtn = $('btn-las-void');
    const diceHead = wrap && wrap.querySelector('.las-dice-head');
    const diceStage = $('las-dice-stage');
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    const hint = $('las-dice-hint');
    const { isBuild, canAct, mustDiscard, canPlay } = getBuildActionState(
      game,
      me
    );

    clearBuildDicePanelMode();

    if (!isBuild || !canAct) {
      if (wrap && isBuild) wrap.hidden = true;
      if (produceActions && isBuild) produceActions.hidden = true;
      return;
    }

    const pcell = $('las-pcell-dice');
    if (pcell) pcell.classList.add('is-build-actions');
    if (wrap) wrap.classList.add('is-build-actions');

    if (rollWrap) rollWrap.hidden = true;
    if (wrap) wrap.hidden = false;
    if (diceHead) diceHead.hidden = true;
    if (diceStage) diceStage.hidden = true;
    if (diceEl) {
      diceEl.hidden = true;
      diceEl.innerHTML = '';
    }
    if (groupsEl) {
      groupsEl.hidden = true;
      groupsEl.innerHTML = '';
    }
    if (produceActions) produceActions.hidden = false;
    if (hint) hint.textContent = '';

    if (confirmBtn) {
      confirmBtn.hidden = false;
      confirmBtn.disabled = !canPlay;
      confirmBtn.textContent = buildConfirmButtonText(game, me);
    }
    if (passBtn) {
      passBtn.hidden = false;
      passBtn.disabled = mustDiscard;
      passBtn.textContent = t('lasidao.passBuild');
    }
  }

  function renderSpectatorDice(dice, color, boostFlags) {
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (!diceEl || !groupsEl) return;
    groupsEl.hidden = true;
    groupsEl.innerHTML = '';
    diceEl.hidden = false;
    diceEl.innerHTML = '';
    const flags = boostFlags || diceAnim.finalBoosted || [];
    dice.forEach((v, i) => {
      diceEl.appendChild(
        makeDieEl(
          v === 0 ? t('lasidao.wildDie') : v,
          flags[i] ? 'is-boosted' : '',
          color
        )
      );
    });
  }

  function renderDice(game, meId, _prevGame) {
    const wrap = $('las-dice-wrap');
    if (!wrap) return;

    renderRollWrap(game, meId);

    if (syncBarrenMarkerPickUi(game, meId)) {
      return;
    }
    if (syncRecallPickUi(game, meId)) {
      return;
    }
    if (syncGatherNeutralsPickUi(game, meId)) {
      return;
    }
    if (syncTeleportPickUi(game, meId)) {
      return;
    }
    if (syncNeutralPickUi(game, meId)) {
      return;
    }
    if (syncBanditPickUi(game, meId)) {
      return;
    }

    if (game.phase === 'event_mercenary') {
      renderMercenaryDice(game, meId);
      return;
    }

    if (!isBarrenMarkerPickMode(game, meId) && barrenPickNumber != null) {
      barrenPickArea = null;
      barrenPickNumber = null;
    }
    if (!isNeutralPickMode(game, meId) && neutralPickNumber != null) {
      neutralPickArea = null;
      neutralPickNumber = null;
      if (selectedTarget && !isBanditPickMode(game, meId) && !isMercenaryPlaceMode(game, meId)) {
        selectedTarget = null;
      }
    }
    if (!isTeleportPickMode(game, meId) && teleportPickNumber != null) {
      teleportPickArea = null;
      teleportPickNumber = null;
    }

    const confirm = $('btn-las-confirm');
    const voidBtn = $('btn-las-void');
    const preview = $('las-dispatch-preview');
    const produceActions = $('las-produce-actions');
    if (confirm) confirm.textContent = t('lasidao.confirmDispatch');

    if (game.phase === 'build') {
      syncBuildDicePanel(game, mePlayer(game, meId));
      return;
    }

    clearBuildDicePanelMode();

    if (game.phase !== 'produce') {
      if (diceAnim.stage !== 'idle') resetDiceAnim();
      wrap.hidden = true;
      return;
    }

    const myTurn = isMyTurn(game, meId);
    const active = game.activeProduce || null;
    const actorId = (active && active.playerId) || game.currentPlayerId;
    const actor = (game.players || []).find((p) => p.id === actorId);
    const actorName = actor ? actor.name : '';

    // ??????????????????????
    if (myTurn && isAwaitingRoll(game)) {
      if (diceAnim.stage !== 'idle') resetDiceAnim();
      wrap.hidden = true;
      return;
    }

    // 他人回合且尚未投掷：不展示等待提示
    if (!myTurn && active && active.awaitingRoll) {
      if (diceAnim.stage !== 'idle') resetDiceAnim();
      wrap.hidden = true;
      return;
    }

    const dice = myTurn
      ? (game.dice || []).slice()
      : ((active && active.dice) || []).slice();
    const boostFlags = myTurn
      ? (game.diceBoosted || []).slice()
      : ((active && active.diceBoosted) || []).slice();

    if (!dice.length) {
      if (diceAnim.stage !== 'idle') resetDiceAnim();
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    if (produceActions) produceActions.hidden = !myTurn;
    syncPostRemoteDiceBtn(game, meId);

    if (myTurn) {
      setDiceTitle(t('lasidao.yourDice'));
      if (confirm) {
        confirm.disabled = false;
      }
      if (voidBtn) {
        voidBtn.hidden = false;
        voidBtn.textContent = t('lasidao.produceSkip');
        voidBtn.disabled = false;
      }
    } else {
      setDiceTitle(t('lasidao.otherDice', { name: actorName }));
      if (preview) preview.hidden = true;
      if (confirm) confirm.hidden = true;
      if (voidBtn) voidBtn.hidden = true;
      const hint = $('las-dice-hint');
      if (hint) {
        hint.textContent = t('lasidao.otherDiceHint', { name: actorName });
      }
      const color = playerDieColor(game.players || [], actorId, game);
      const key =
        'spec:' +
        game.round +
        ':' +
        actorId +
        ':' +
        dice.join(',');

      // 动画播放期间 dice 因放置而减少：结束动画直接更新，不重新启动
      if (
        (diceAnim.stage === 'rolling' || diceAnim.stage === 'grouping') &&
        diceAnim.key !== key
      ) {
        clearDiceTimers();
        diceAnim.stage = 'ready';
        diceAnim.finalDice = dice.slice();
        renderSpectatorDice(dice, color);
        return;
      }

    if (diceAnim.key !== key) {
      diceAnim.key = key;
        resetDiceSelection();
        diceAnim.finalDice = dice.slice();

        const prevActive = _prevGame && _prevGame.activeProduce;
        const prevDice =
          prevActive && prevActive.playerId === actorId
            ? prevActive.dice || []
            : [];
        const isFreshRoll =
          _prevGame &&
          _prevGame.phase === 'produce' &&
          prevDice.length === 0 &&
          dice.length > 0;

        if (isFreshRoll && !(active && active.remoteDiceMode)) {
          startSpectatorDiceAnimation(dice, color, actorName, boostFlags);
        } else {
          diceAnim.stage = 'ready';
          diceAnim.finalBoosted = boostFlags.slice();
          renderSpectatorDice(dice, color, boostFlags);
        }
      return;
    }

      if (diceAnim.stage === 'ready') {
        renderSpectatorDice(dice, color, boostFlags);
      }
      return;
    }

    // ?? ??????? ??
    const remote = isRemoteMode(game);
    const key =
      game.round +
      ':' +
      meId +
      ':' +
      (remote ? 'R' : 'N') +
      ':' +
      dice.join(',') +
      ':' +
      boostFlags.map((b) => (b ? '1' : '0')).join('');

    if (diceAnim.key !== key) {
      diceAnim.key = key;
      resetDiceSelection();
      if (remote) {
        diceAnim.stage = 'ready';
        diceAnim.finalDice = dice.slice();
        diceAnim.finalBoosted = boostFlags.slice();
        renderRemoteDice(game, meId);
        updateDispatchPreview();
        updateDiceHint();
      } else {
        startDiceAnimation(dice, meId, boostFlags);
      }
      return;
    }

    if (remote) {
      renderRemoteDice(game, meId);
      updateDispatchPreview();
      updateDiceHint();
      return;
    }

    if (diceAnim.stage === 'rolling' || diceAnim.stage === 'grouping') {
      updateDiceHint();
      return;
    }

    if (diceAnim.stage === 'ready') {
      renderGroupedDice();
      updateDispatchPreview();
      updateDiceHint();
    }
  }

  function playInitAnnounce(game) {
    const reveal = game.pendingInitReveal;
    if (!reveal || !reveal.rolls) return;
    const key =
      String(reveal.firstPlayerId) +
      ':' +
      String(reveal.best) +
      ':' +
      Object.keys(reveal.rolls)
        .sort()
        .map((id) => id + '=' + reveal.rolls[id])
        .join(',');
    if (initAnimKey === key) return;
    initAnimKey = key;

    const wrap = $('las-init-wrap');
    const box = $('las-init-dice');
    const banner = $('las-init-banner');
    if (wrap) wrap.hidden = false;
    if (banner) {
      banner.hidden = true;
      banner.textContent = '';
    }
    if (!box) return;
    box.hidden = false;
    box.classList.add('las-init-all-dice');
    box.innerHTML = '';

    const dieEls = [];
    const players = (game.players || [])
      .slice()
      .sort((a, b) => (a.seat || 0) - (b.seat || 0));
    for (const p of players) {
      if (p.left) continue;
      const v = reveal.rolls[p.id];
      if (typeof v !== 'number') continue;
      const col = document.createElement('div');
      col.className = 'las-init-player-die';
      if (p.id === reveal.firstPlayerId) col.classList.add('is-first');
      const name = document.createElement('span');
      name.className = 'las-init-name';
      name.textContent = p.name;
      const die = makeDieEl(1 + Math.floor(Math.random() * 6), 'is-rolling');
      col.appendChild(name);
      col.appendChild(die);
      box.appendChild(col);
      dieEls.push({ el: die, value: v });
    }

    initAnimPlayingUntil = Date.now() + 3200;
    const spin = setInterval(() => {
      for (const d of dieEls) {
        d.el.textContent = String(1 + Math.floor(Math.random() * 6));
      }
    }, 70);

    setTimeout(() => {
      clearInterval(spin);
      for (const d of dieEls) {
        d.el.classList.remove('is-rolling');
        d.el.classList.add('is-reveal');
        d.el.textContent = String(d.value);
      }
      const first = (game.players || []).find(
        (p) => p.id === reveal.firstPlayerId
      );
      if (banner) {
        banner.hidden = false;
        banner.textContent = t('lasidao.initFirstBanner', {
          name: first ? first.name : '?',
          n: reveal.best,
        });
      }
      initAnimPlayingUntil = Date.now() + 2200;
    }, 1100);
  }

  function playInitRollAnim(value) {
    const box = $('las-init-dice');
    const wrap = $('las-init-wrap');
    if (!box) return;
    if (wrap) wrap.hidden = false;
    box.hidden = false;
    box.classList.remove('las-init-all-dice');
    box.innerHTML = '';
    const el = makeDieEl(1 + Math.floor(Math.random() * 6), 'is-rolling');
    box.appendChild(el);
    initAnimPlayingUntil = Date.now() + 1400;
    const spin = setInterval(() => {
      el.textContent = String(1 + Math.floor(Math.random() * 6));
    }, 70);
    setTimeout(() => {
      clearInterval(spin);
      el.classList.remove('is-rolling');
      el.classList.add('is-reveal');
      el.textContent = String(value);
      initAnimPlayingUntil = Date.now() + 600;
      setTimeout(() => {
        const w = $('las-init-wrap');
        if (
          w &&
          lastGamePhase !== 'init_roll' &&
          lastGamePhase !== 'init_announce' &&
          Date.now() >= initAnimPlayingUntil
        ) {
          w.hidden = true;
        }
      }, 620);
    }, 800);
  }

  const MAX_FUNC_HAND_UI = 3;

  function makeEmptyFuncSlot() {
    const slot = document.createElement('div');
    slot.className = 'las-func-slot is-empty';
    slot.setAttribute('aria-hidden', 'true');
    return slot;
  }

  /** ????????????????????? maxSlots???????? */
  function fillFuncHandRow(funcsEl, opts) {
    const {
      cards,
      isMe,
      interactive,
      game,
      player,
      meId,
      maxSlots,
    } = opts;
    const max = Math.max(1, Number(maxSlots) || MAX_FUNC_HAND_UI);
    funcsEl.classList.add('las-func-hand');
    funcsEl.innerHTML = '';

    let filled = 0;
    if (isMe) {
      const visible = (cards || []).filter((c) => !c.hidden);
      for (const c of visible) {
        const playable = canPlayFuncCard(game, meId, c.funcType);
        const discardMode =
          interactive &&
          player &&
          player.pendingDiscardFunc &&
          !player.pendingDiscardRes &&
          game.phase === 'build' &&
          isMyTurn(game, meId);
        const buildSelect =
          interactive &&
          game.phase === 'build' &&
          isMyTurn(game, meId) &&
          player &&
          !player.buildPassed &&
          !discardMode;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'las-card func' +
          (selectedFuncId === c.id ? ' is-selected' : '') +
          (buildSelect && playable ? ' is-affordable' : '');
        if (!decorateHandCardArt(btn, c, 'function')) {
          btn.textContent = c.label;
        }
        if (interactive) {
          if (!playable && !discardMode && !buildSelect) {
            setLasCardInert(btn, true);
            btn.title = t('lasidao.funcWrongPhase');
          }
          if (discardMode) {
            btn.title = t('lasidao.discardFunc', { label: c.label });
            btn.onclick = () => {
              if (!netRef || isLasCardInert(btn)) return;
              netRef.sendAction('discardFunc', { cardId: c.id });
            };
          } else if (buildSelect) {
            const ok = playable;
            if (!ok) {
              setLasCardInert(btn, true);
              btn.title = t('lasidao.funcWrongPhase');
            } else {
              btn.title = c.label;
              btn.onclick = () => {
                if (isLasCardInert(btn)) return;
                selectedBuildingId = null;
                selectedPermanent = null;
                if (c.funcType === 'freeExpand') {
                  expandCardId = c.id;
                  expandDirection = null;
                  setExpandModalOpen(true);
                  selectedFuncId = null;
                } else {
                  selectedFuncId = selectedFuncId === c.id ? null : c.id;
                }
                renderPlayerBoards(game, meId);
                renderFuncForm(game, player);
                syncPermanentSelection(game, player);
                syncBuildConfirmBar(game, player);
              };
            }
          } else {
            btn.onclick = () => {
              if (!playable || isLasCardInert(btn)) return;
              selectedFuncId = selectedFuncId === c.id ? null : c.id;
              renderPlayerBoards(game, meId);
              renderFuncForm(game, player);
              syncBuildConfirmBar(game, player);
            };
          }
        } else {
          setLasCardInert(btn, true);
        }
        funcsEl.appendChild(btn);
        filled += 1;
      }
    } else {
      const n = Number(opts.funcCount) || 0;
      for (let i = 0; i < Math.min(n, max); i++) {
        funcsEl.appendChild(makeFaceDownHandCard('function'));
        filled += 1;
      }
      if (n > max) {
        const more = document.createElement('span');
        more.className = 'muted';
        more.textContent = t('lasidao.funcHidden', { n });
        funcsEl.appendChild(more);
      }
    }

    const empties = Math.max(0, max - filled);
    for (let i = 0; i < empties; i++) {
      funcsEl.appendChild(makeEmptyFuncSlot());
    }
  }

  function shouldShowActRail(game, meId) {
    if (!game) return false;
    if (needsSettleActUi(game, meId)) return true;
    if (game.phase === 'build') return true;
    if (game.phase === 'produce' && isMyTurn(game, meId)) {
      const me = mePlayer(game, meId);
      return Boolean(
        me &&
          (me.funcCards || []).some(
            (c) => !c.hidden && PRODUCE_FUNC.has(c.funcType)
          )
      );
    }
    return false;
  }

  function settleDiscardHintForMe(me) {
    if (!me) return t('lasidao.actRailHintSettleDiscard');
    const parts = [];
    if (me.pendingDiscardRes) parts.push('res');
    if (me.pendingDiscardFunc) parts.push('func');
    if (me.pendingDiscardBuild) parts.push('build');
    if (parts.length === 3) return t('lasidao.actRailHintSettleAll');
    if (parts.includes('res') && parts.includes('func')) {
      return t('lasidao.actRailHintSettleResFunc');
    }
    if (parts.includes('res') && parts.includes('build')) {
      return t('lasidao.actRailHintSettleResBuild');
    }
    if (me.pendingDiscardRes) return t('lasidao.actRailHintSettleRes');
    if (me.pendingDiscardFunc && me.pendingDiscardBuild) {
      return t('lasidao.actRailHintSettleBoth');
    }
    if (me.pendingDiscardFunc) return t('lasidao.actRailHintSettleFunc');
    if (me.pendingDiscardBuild) return t('lasidao.actRailHintSettleBuild');
    return t('lasidao.actRailHintSettleDiscard');
  }

  function settleDiscardStatusText(game, meId) {
    const me = mePlayer(game, meId);
    const pending = Array.isArray(game.settleDiscardPending)
      ? game.settleDiscardPending
      : (game.players || []).filter(
          (p) => p.needsDiscardFunc || p.needsDiscardBuild || p.needsDiscardRes
        ).map((p) => ({
          id: p.id,
          name: p.name,
          func: Boolean(p.needsDiscardFunc),
          build: Boolean(p.needsDiscardBuild),
          res: Boolean(p.needsDiscardRes),
        }));
    const myPending = Boolean(
      me &&
        (me.pendingDiscardFunc ||
          me.pendingDiscardBuild ||
          me.pendingDiscardRes)
    );
    if (myPending) {
      if (
        me.pendingDiscardRes &&
        me.pendingDiscardFunc &&
        me.pendingDiscardBuild
      ) {
        return t('lasidao.statusSettleActYouAll');
      }
      if (me.pendingDiscardRes && me.pendingDiscardFunc) {
        return t('lasidao.statusSettleActYouResFunc');
      }
      if (me.pendingDiscardRes && me.pendingDiscardBuild) {
        return t('lasidao.statusSettleActYouResBuild');
      }
      if (me.pendingDiscardRes) return t('lasidao.statusSettleActYouRes');
      if (me.pendingDiscardFunc && me.pendingDiscardBuild) {
        return t('lasidao.statusSettleActYouBoth');
      }
      if (me.pendingDiscardFunc) return t('lasidao.statusSettleActYouFunc');
      return t('lasidao.statusSettleActYouBuild');
    }
    if (pending.length) {
      return t('lasidao.statusAwaitDiscard', {
        names: pending.map((p) => p.name).join('、'),
      });
    }
    return t('lasidao.statusSettleAct');
  }

  function needsSettleActUi(game, meId) {
    if (!game || game.phase !== 'settle_act') return false;
    const me = mePlayer(game, meId);
    return Boolean(
      me &&
        (me.pendingDiscardFunc ||
          me.pendingDiscardBuild ||
          me.pendingDiscardRes)
    );
  }

  function emptyDiscardResPick() {
    return { wood: 0, stone: 0, food: 0, iron: 0 };
  }

  function discardResPickTotal() {
    return RESOURCES.reduce((s, r) => s + (Number(discardResPick[r]) || 0), 0);
  }

  function appendResourceDiscardRow(hand, game, me) {
    if (!me || !me.pendingDiscardRes) return;
    const labels = getResLabels(game);
    const Assets = window.LasidaoAssets;
    const max =
      game.me && game.me.maxResourceHand != null
        ? game.me.maxResourceHand
        : me.maxResourceHand != null
          ? me.maxResourceHand
          : 12;
    const total = Object.values(me.resources || {}).reduce((a, b) => a + b, 0);
    const need = Math.max(0, total - max);
    if (need <= 0) {
      discardResPick = emptyDiscardResPick();
      return;
    }
    // 若手牌变化导致已选超量，裁剪
    let picked = discardResPickTotal();
    if (picked > need) {
      discardResPick = emptyDiscardResPick();
      picked = 0;
    }
    for (const r of RESOURCES) {
      const own = me.resources[r] || 0;
      if ((discardResPick[r] || 0) > own) discardResPick[r] = own;
    }
    picked = discardResPickTotal();

    const tip = document.createElement('div');
    tip.className = 'muted las-pboard-tip';
    tip.textContent = t('lasidao.discardResTip', {
      total,
      max,
      need,
      picked,
    });
    hand.appendChild(tip);

    const grid = document.createElement('div');
    grid.className = 'las-void-skip-grid las-discard-res-grid';
    for (const res of RESOURCES) {
      const own = me.resources[res] || 0;
      if (own < 1) continue;
      const sel = Number(discardResPick[res]) || 0;
      const canAdd = picked < need && sel < own;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'las-void-skip-item' +
        (sel > 0 ? ' is-selected' : '') +
        (!canAdd ? ' is-disabled' : '');
      btn.disabled = !canAdd;
      btn.title = canAdd
        ? t('lasidao.discardResClickTip')
        : picked >= need
          ? t('lasidao.discardResFullTip')
          : t('lasidao.discardResOwnTip');
      const cardEl = document.createElement('div');
      cardEl.className = 'las-void-skip-card';
      const url =
        Assets && Assets.resourceHandImageUrl
          ? Assets.resourceHandImageUrl(res)
          : '';
      if (url) cardEl.style.backgroundImage = 'url("' + url + '")';
      if (sel > 0) {
        const pickBadge = document.createElement('span');
        pickBadge.className = 'las-discard-res-pick';
        pickBadge.textContent = String(sel);
        cardEl.appendChild(pickBadge);
      }
      const qty = document.createElement('span');
      qty.className = 'las-void-skip-qty-top';
      qty.textContent = '×' + own;
      const label = document.createElement('span');
      label.className = 'las-void-skip-label';
      label.textContent = labels[res] || res;
      btn.appendChild(qty);
      btn.appendChild(cardEl);
      btn.appendChild(label);
      btn.onclick = () => {
        if (!canAdd) return;
        discardResPick[res] = (discardResPick[res] || 0) + 1;
        if (lastGame && lastMeId) renderActRail(lastGame, lastMeId);
      };
      grid.appendChild(btn);
    }
    hand.appendChild(grid);

    const foot = document.createElement('div');
    foot.className = 'las-void-skip-foot las-discard-res-foot';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'secondary';
    resetBtn.textContent = t('lasidao.discardResReset');
    resetBtn.disabled = picked <= 0;
    resetBtn.onclick = () => {
      discardResPick = emptyDiscardResPick();
      if (lastGame && lastMeId) renderActRail(lastGame, lastMeId);
    };
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = t('lasidao.discardResConfirm');
    confirmBtn.disabled = picked !== need;
    confirmBtn.onclick = () => {
      if (!netRef || discardResPickTotal() !== need) return;
      const amounts = { ...discardResPick };
      discardResPick = emptyDiscardResPick();
      netRef.sendAction('discardResources', { amounts });
    };
    foot.appendChild(resetBtn);
    foot.appendChild(confirmBtn);
    hand.appendChild(foot);
  }

  function appendBuildDiscardChoiceUi(parent, game, meId, me) {
    const pending = me && me.pendingDiscardBuild;
    if (!pending || !pending.newCard || !parent) return;
    const maxB = me.maxBuildings || game.maxBuildings || 3;
    const unbuiltExisting = (me.buildings || []).filter((b) => !b.built);

    const tip = document.createElement('div');
    tip.className = 'muted las-pboard-tip las-discard-build-tip';
    tip.textContent = unbuiltExisting.length
      ? t('lasidao.discardBuildChoiceTip', { n: maxB })
      : t('lasidao.discardBuildAllBuiltTip', { n: maxB });
    parent.appendChild(tip);

    const newWrap = document.createElement('div');
    newWrap.className = 'las-discard-build-group';
    const newLab = document.createElement('div');
    newLab.className = 'las-pboard-label';
    newLab.textContent = t('lasidao.pendingNewBuild');
    newWrap.appendChild(newLab);
    const newCards = document.createElement('div');
    newCards.className = 'las-cards las-act-cards';
    const neuBtn = makeBoardBuildingCard(
      game,
      meId,
      me,
      pending.newCard,
      true
    );
    neuBtn.classList.add('is-pending-new');
    neuBtn.onclick = () => {
      if (netRef) netRef.sendAction('discardPendingBuild', {});
    };
    newCards.appendChild(neuBtn);
    newWrap.appendChild(newCards);
    parent.appendChild(newWrap);

    if (!unbuiltExisting.length) return;

    const oldWrap = document.createElement('div');
    oldWrap.className = 'las-discard-build-group';
    const oldLab = document.createElement('div');
    oldLab.className = 'las-pboard-label';
    oldLab.textContent = t('lasidao.existingUnbuiltDiscard');
    oldWrap.appendChild(oldLab);
    const oldCards = document.createElement('div');
    oldCards.className = 'las-cards las-act-cards';
    for (const b of unbuiltExisting) {
      oldCards.appendChild(makeBoardBuildingCard(game, meId, me, b, true));
    }
    oldWrap.appendChild(oldCards);
    parent.appendChild(oldWrap);
  }

  function renderActRail(game, meId) {
    const hint = $('las-act-hint');
    const permCell = $('las-pcell-perm');
    if (permCell) permCell.classList.toggle('is-build-turn', game.phase === 'build');
    if (!hint) return;
    hideCardTip();

    const me = mePlayer(game, meId);
    if (!me) {
      hint.textContent = '';
      hint.setAttribute('aria-hidden', 'true');
      return;
    }

    if (game.phase === 'build') {
      const mustDiscard =
        me &&
        (me.pendingDiscardFunc || me.pendingDiscardBuild) &&
        !me.pendingDiscardRes;
      if (mustDiscard) {
        hint.textContent = me.pendingDiscardFunc
          ? t('lasidao.discardFuncTip')
          : t('lasidao.discardBuildTip', {
              n: me.maxBuildings || game.maxBuildings || 3,
            });
      } else {
        hint.textContent = '';
      }
    } else if (game.phase === 'produce') {
      hint.textContent = '';
    } else if (game.phase === 'settle_act') {
      if (shouldOpenSettleDiscardModal(game, meId)) {
        hint.textContent = '';
      } else {
        hint.textContent = settleDiscardHintForMe(me);
      }
    } else {
      hint.textContent = '';
    }
    syncBuildConfirmBar(game, me);
    hint.setAttribute('aria-hidden', hint.textContent ? 'false' : 'true');
  }

  /** 建造阶段：确认/跳过按钮在骰子区 */
  function renderBuildHand(game, meId) {
    syncBuildConfirmBar(game, mePlayer(game, meId));
  }

  function syncBuildConfirmBar(game, me) {
    syncBuildDicePanel(game, me);
  }

  /** @deprecated 兼容旧调用，统一走 syncBuildConfirmBar */
  function syncBuildPlayBar(game, me) {
    syncBuildConfirmBar(game, me);
  }

  /** 建造阶段：确认发动已选功能卡 / 常驻功能 / 建造或放置已选建筑 */
  function confirmBuildHandSelection(game, me) {
    if (!netRef || !me) return;

    if (selectedPermanent) {
      beginSelectedPermanent(game, me);
      return;
    }

    if (selectedBuildingId) {
      const b = (me.buildings || []).find((x) => x.id === selectedBuildingId);
      if (!b || b.built) {
        selectedBuildingId = null;
        return;
      }
      if (b.slot == null) {
        const slot = pickPlaceSlotForBuilding(me, b);
        if (slot == null) return;
        netRef.sendAction('placeBuildingSlot', {
          buildingId: b.id,
          slot,
        });
      } else if (
        game.phase === 'build' &&
        isMyTurn(game, me.id) &&
        !me.buildPassed
      ) {
        netRef.sendAction('construct', { buildingId: b.id });
      }
      selectedBuildingId = null;
      selectedFuncId = null;
      selectedPermanent = null;
      return;
    }

    if (selectedFuncId) {
      beginSelectedFuncUse(game, me);
    }
  }

  function beginSelectedPermanent(game, me) {
    if (!netRef || !me || !selectedPermanent) return;
    const kind = selectedPermanent;
    if (kind === 'buildHouse') {
      netRef.sendAction('buildHousePermanent', {});
      selectedPermanent = null;
    } else if (kind === 'breed') {
      netRef.sendAction('breedPermanent', {});
      selectedPermanent = null;
    } else if (kind === 'expand') {
      expandCardId = null;
      expandDirection = null;
      setExpandModalOpen(true);
      selectedPermanent = null;
    } else if (kind === 'exchange') {
      setExchangeModalOpen(true);
      selectedPermanent = null;
    } else if (kind === 'buyFunc') {
      netRef.sendAction('buyFuncCardPermanent', {});
      selectedPermanent = null;
    }
    syncPermanentSelection(game, me);
    if (lastGame && lastMeId) {
      renderBuildHand(lastGame, lastMeId);
      renderFuncForm(lastGame, me);
    }
  }

  function selectPermanent(kind, game, me) {
    dismissHoverHints(
      kind === 'buildHouse'
        ? $('btn-las-build-house')
        : kind === 'breed'
          ? $('btn-las-breed')
          : kind === 'buyFunc'
            ? $('btn-las-buy-func')
          : kind === 'expand'
            ? $('btn-las-expand-perm')
            : $('btn-las-exchange')
    );
    hideCardTip();
    selectedFuncId = null;
    selectedBuildingId = null;
    selectedPermanent = selectedPermanent === kind ? null : kind;
    if (game && me) {
      renderBuildHand(game, me.id || lastMeId);
    renderFuncForm(game, me);
      syncPermanentSelection(game, me);
    }
  }

  function syncPermanentSelection(game, me) {
    const map = {
      buildHouse: $('btn-las-build-house'),
      breed: $('btn-las-breed'),
      buyFunc: $('btn-las-buy-func'),
      expand: $('btn-las-expand-perm'),
      exchange: $('btn-las-exchange'),
    };
    for (const [kind, btn] of Object.entries(map)) {
      if (!btn) continue;
      btn.classList.toggle('is-selected', selectedPermanent === kind);
    }
    syncBuildPlayBar(game, me);
  }

  /** 点「确认发动」后：打开参数弹窗或直接发动 */
  function beginSelectedFuncUse(game, me) {
    if (!netRef || !me || !selectedFuncId) return;
    const card = (me.funcCards || []).find((c) => c.id === selectedFuncId);
    if (!card || !canPlayFuncCard(game, me.id, card.funcType)) return;

    if (card.funcType === 'harvest') {
      openHarvestModal({
        source: card.label || '丰收',
        maxCount: 3,
        cardId: card.id,
      });
    } else if (card.funcType === 'redraw') {
      redrawCardId = card.id;
      setRedrawModalOpen(true);
      renderRedrawModal();
    } else if (card.funcType === 'remoteDice') {
      netRef.sendAction('useFunc', { cardId: card.id });
      selectedFuncId = null;
    } else if (card.funcType === 'enhance') {
      netRef.sendAction('useFunc', { cardId: card.id });
      selectedFuncId = null;
    } else if (card.funcType === 'recruit') {
      netRef.sendAction('useFunc', { cardId: card.id });
      selectedFuncId = null;
    } else if (card.funcType === 'exile') {
      exileCardId = card.id;
      exileArea = null;
      exileNumber = null;
      exileTargetId = null;
      setExileModalOpen(true);
      renderExileSlotStep(game);
    } else if (card.funcType === 'banditRaid') {
      banditCardId = card.id;
      selectedTarget = null;
      selectedFuncId = null;
      resetDiceSelection();
      showTurnToast(t('lasidao.banditPickBoardToast'), 2200);
      if (lastGame) {
        renderBoard(lastGame, lastMeId);
        renderDice(lastGame, lastMeId);
      }
    } else if (card.funcType === 'expand' || card.funcType === 'freeExpand') {
      expandCardId = card.id;
      expandDirection = null;
      setExpandModalOpen(true);
      selectedFuncId = null;
    } else if (card.funcType === 'robbery') {
      robberyCardId = card.id;
      robberyTargets = [null, null];
      robberyPickStep = 0;
      setRobberyModalOpen(true);
      renderRobberyModal(game, card);
      selectedFuncId = null;
    } else if (card.funcType === 'illegalBuild') {
      if (!(game.players || []).some((p) => !p.left && countBuiltBuildingsUi(p) > 0)) {
        return;
      }
      illegalBuildCardId = card.id;
      setIllegalBuildModalOpen(true);
      renderIllegalBuildModal(game, card, 'target');
      selectedFuncId = null;
    } else {
      netRef.sendAction('useFunc', { cardId: card.id });
      selectedFuncId = null;
    }
  }

  function renderMe(game, meId) {
    const me = mePlayer(game, meId);
    const resEl = $('las-me-res');
    const fnEl = $('las-me-funcs');
    const bldEl = $('las-me-builds');
    if (resEl) resEl.innerHTML = '';
    if (fnEl) fnEl.innerHTML = '';
    if (bldEl) bldEl.innerHTML = '';
    if (!me) {
      setWishWellModalOpen(false);
      const host = $('las-boards-host');
      if (host) host.innerHTML = '';
      const meHost = $('las-boards-me');
      if (meHost) meHost.innerHTML = '';
      const othersTitle = $('las-others-title');
      if (othersTitle) othersTitle.hidden = true;
      return;
    }

    const labels = getResLabels(game);
    renderPlayerBoards(game, meId);
    renderActRail(game, meId);

    const exBuilt = (me.buildings || []).filter(
      (b) => b.built && b.buildType === 'exchange'
    ).length;
    const exCount =
      game.me && game.me.exchangeCount != null
        ? Number(game.me.exchangeCount)
        : Math.min(exBuilt, 2);
    const exBtn = $('btn-las-exchange');
    if (exBtn) {
      const cost = (game.me && game.me.exchangeCost != null) ? game.me.exchangeCost : (exCount === 0 ? 3 : exCount === 1 ? 2 : 1);
      exBtn.textContent = t('lasidao.exchangeBtnN', { n: cost });
      const caravan = Boolean(game.me && game.me.caravanPending);
      exBtn.title = caravan
        ? t('lasidao.exchangeCaravanHint', { n: cost })
        : exCount === 0
          ? t('lasidao.exchangeHintDefault', { n: cost })
          : t('lasidao.exchangeHint', { count: exCount, n: cost });
    }

    renderFuncForm(game, me);
  }

  function buildingSlotLabel(b) {
    if (b.faceDown && !b.label) return t('lasidao.faceDown');
    let s = b.label || '?';
    if (b.faceDown && b.label) s += ' ?' + t('lasidao.faceDown');
    if (b.built) s += ' [' + t('lasidao.built') + ']';
    else s += ' [' + t('lasidao.hand') + ']';
    return s;
  }

  function buildingHiddenFromViewer(b, isMe) {
    return Boolean(b && !isMe && !b.built);
  }

  function makeBoardBuildingCard(game, meId, p, b, isMe) {
    const hidden = buildingHiddenFromViewer(b, isMe);
    // 持有者始终明示；仅他人看到未建/隐藏卡背
    const display = hidden
      ? { faceDown: true, id: b.id }
      : { ...b, faceDown: false };
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'las-pboard-card build' +
      (b.built ? ' is-built' : ' is-unbuilt') +
      (hidden ? ' is-facedown' : '') +
      (isMe && selectedBuildingId === b.id ? ' is-selected' : '');
    if (!decorateHandCardArt(btn, display, 'building')) {
      if (!hidden) {
        btn.textContent = buildingSlotLabel({ ...b, faceDown: false });
      }
    } else if (b.built) {
      btn.classList.add('is-built');
    }
    if (isMe) {
      btn.onclick = () => {
        if (isLasCardInert(btn)) return;
        onBuildingClick(game, p, b);
      };
      if (
        game.phase === 'build' &&
        isMyTurn(game, meId) &&
        !p.buildPassed &&
        !b.built
      ) {
        const canAfford = canPay(p.resources || {}, b.cost || {});
        const needsPay = b.slot != null;
        if (!needsPay || canAfford) btn.classList.add('is-affordable');
      }
    } else {
      setLasCardInert(btn, true);
    }
    if (!btn.classList.contains('has-art')) {
      bindTileTip(btn, hidden ? { faceDown: true } : display, 'building');
    }
    return btn;
  }

  function appendPlayerTitleBadges(parent, player) {
    if (!parent || !player) return;
    const titles = Array.isArray(player.titles) ? player.titles : [];
    for (const title of titles) {
      const badge = document.createElement('span');
      badge.className = 'las-player-title';
      badge.dataset.titleId = title.id || '';
      badge.textContent = title.label || t('lasidao.titleCommerceTycoon');
      if (title.id === 'commerceTycoon' || title.stackKey === 'exchange') {
        badge.title = t('lasidao.titleCommerceTycoonTip');
      } else if (title.id === 'lampSpirit' || title.stackKey === 'wishWell') {
        badge.title = t('lasidao.titleLampSpiritTip');
      } else {
        badge.title = t('lasidao.stackAchievementTip', {
          need: 3,
          score: title.score || 2,
        });
      }
      parent.appendChild(badge);
    }
  }

  function appendPlayerInfoGrid(parent, game, p, labels, statsPayload, options) {
    const isMe = options && options.isMe;
    const infoGrid = document.createElement('div');
    infoGrid.className = 'las-me-info-grid';
    const playerCell = document.createElement('div');
    playerCell.className = 'las-me-info-player';
    const color = playerDieColor(game.players, p.id);
    const swatch = document.createElement('span');
    swatch.className = 'las-die-swatch color-' + color;
    playerCell.appendChild(swatch);
    const title = document.createElement('div');
    title.className = 'las-pboard-title';
    const Nick = window.PlayerNick;
    title.innerHTML =
      (Nick && Nick.formatHtml
        ? Nick.formatHtml(p.name, p.tag)
        : escapeHtml(p.name)) +
      (isMe ? ' <span class="you">(' + t('lasidao.youMark') + ')</span>' : '');
    playerCell.appendChild(title);
    appendPlayerTitleBadges(playerCell, p);
    infoGrid.appendChild(playerCell);

    const capsCell = document.createElement('div');
    capsCell.className = 'las-me-info-caps';
    capsCell.textContent = t('lasidao.playerStatsLine2', statsPayload);
    infoGrid.appendChild(capsCell);

    const scoreCell = document.createElement('div');
    scoreCell.className = 'las-me-info-score';
    scoreCell.textContent = t('lasidao.playerStatsLine1', statsPayload);
    infoGrid.appendChild(scoreCell);

    const resCell = document.createElement('div');
    resCell.className = 'las-me-info-res';
    for (const [k, v] of Object.entries(p.resources || {})) {
      const span = document.createElement('span');
      span.className = 'badge';
      span.textContent = (labels[k] || k) + ' ' + v;
      resCell.appendChild(span);
    }
    infoGrid.appendChild(resCell);
    parent.appendChild(infoGrid);
    return infoGrid;
  }

  function canProposePlayerTrade(game, meId, targetId) {
    if (!game || !meId || !targetId || meId === targetId) return false;
    if (game.over) return false;
    if (game.pendingTrade || game.pendingEventChoice || game.pendingRedrawChoice || game.pendingIllegalBuild) {
      return false;
    }
    if (game.phase !== 'produce' && game.phase !== 'build') return false;
    if (!isMyTurn(game, meId)) return false;
    const me = mePlayer(game, meId);
    if (!me || me.left) return false;
    if (game.phase === 'build' && me.buildPassed) return false;
    const target = (game.players || []).find((p) => p.id === targetId);
    return Boolean(target && !target.left);
  }

  function emptyTradeCounts() {
    return { wood: 0, stone: 0, food: 0, iron: 0 };
  }

  function sumTradeCounts(counts) {
    return RESOURCES.reduce((s, r) => s + (Number(counts && counts[r]) || 0), 0);
  }

  function appendOtherPlayerInfoGrid(parent, game, p, statsPayload, meId) {
    const infoGrid = document.createElement('div');
    infoGrid.className = 'las-other-info-grid';

    const playerCell = document.createElement('div');
    playerCell.className = 'las-other-info-player';
    const color = playerDieColor(game.players, p.id);
    const swatch = document.createElement('span');
    swatch.className = 'las-die-swatch color-' + color;
    playerCell.appendChild(swatch);
    const title = document.createElement('div');
    title.className = 'las-pboard-title';
    const Nick = window.PlayerNick;
    title.innerHTML =
      Nick && Nick.formatHtml
        ? Nick.formatHtml(p.name, p.tag)
        : escapeHtml(p.name);
    playerCell.appendChild(title);
    appendPlayerTitleBadges(playerCell, p);
    infoGrid.appendChild(playerCell);

    const statsCell = document.createElement('div');
    statsCell.className = 'las-other-info-stats';
    statsCell.textContent = t('lasidao.playerStatsLine1', statsPayload);
    infoGrid.appendChild(statsCell);

    const capsCell = document.createElement('div');
    capsCell.className = 'las-other-info-caps';
    capsCell.textContent = t('lasidao.playerStatsLine2', statsPayload);
    infoGrid.appendChild(capsCell);

    parent.appendChild(infoGrid);
    return infoGrid;
  }

  function appendOtherPlayerCornerSection(parent, labelText, slotsEl) {
    const section = document.createElement('div');
    section.className = 'las-other-slots-section';
    const wrap = document.createElement('div');
    wrap.className = 'las-other-slots-wrap';
    const label = document.createElement('span');
    label.className = 'las-pboard-corner-label';
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(slotsEl);
    section.appendChild(wrap);
    parent.appendChild(section);
    return section;
  }

  function renderPlayerBoards(game, meId) {
    const host = $('las-boards-host');
    const meHost = $('las-boards-me');
    const othersTitle = $('las-others-title');
    if (!host) return;
    const players = (game.players || []).slice().sort((a, b) => {
      return (a.seat || 0) - (b.seat || 0);
    });
    const labels = getResLabels(game);
    let othersCount = 0;

    const seenIds = new Set();
    for (const p of players) {
      seenIds.add(p.id);
      const isMe = Boolean(meId && p.id === meId);
      const panelHash = playerBoardContentHash(p, game, meId);
      const panelHost = isMe && meHost ? meHost : host;
      let existing = panelHost.querySelector('[data-pid="' + p.id + '"]');
      if (existing && existing.dataset.lasPanelHash === panelHash && !isMe) {
        existing.classList.toggle('is-current', p.id === game.currentPlayerId);
        existing.classList.toggle('is-left', Boolean(p.left));
        if (existing.querySelector('.las-other-player-grid')) {
          othersCount += 1;
          continue;
        }
      }
      const buildHost = isMe ? $('las-pcell-build') : null;
      const funcHost = isMe ? $('las-pcell-func') : null;
      const maxB =
        p.maxBuildings ||
        (game.maxBuildings || 3) + (Number(p.expandSlots) || 0);
      const maxFunc = p.maxFuncHand || MAX_FUNC_HAND_UI;
      const maxRes =
        p.maxResourceHand != null
          ? p.maxResourceHand
          : isMe && game.me && game.me.maxResourceHand != null
            ? game.me.maxResourceHand
            : 12;
      const totalRes = Object.values(p.resources || {}).reduce(
        (a, b) => a + b,
        0
      );
      const funcN =
        p.funcCount != null ? p.funcCount : (p.funcCards || []).length;
      const buildN = occupiedBuildSlotKeys(p).size;

      const board = document.createElement('section');
      board.className = 'las-pboard' + (isMe ? ' is-me' : '');
      board.dataset.pid = p.id;
      if (p.left) board.classList.add('is-left');
      if (p.id === game.currentPlayerId) board.classList.add('is-current');

      const statsPayload = {
        score: p.score,
        villagers: p.villagers,
        houses: p.houses != null ? p.houses : 3,
        freeHouses:
          p.freeHouses != null
            ? p.freeHouses
            : Math.max(0, (p.houses != null ? p.houses : 3) - (p.villagers || 0)),
        res: totalRes,
        resMax: maxRes,
        func: funcN,
        funcMax: maxFunc,
        build: buildN,
        buildMax: maxB,
      };

      if (isMe) {
        appendPlayerInfoGrid(board, game, p, labels, statsPayload, { isMe: true });
      }

      const slotsTitle = document.createElement('div');
      slotsTitle.className = 'las-pboard-label';
      slotsTitle.textContent = t('lasidao.buildSlotsCap', {
        n: buildN,
        max: maxB,
      });

      const slots = document.createElement('div');
      slots.className = 'las-pboard-none-slots';
      const bySlot = groupPlacedBuildingsBySlot(p);
      const slotOrder = noneSlotKeysFor(p).filter((k) => bySlot.has(String(k)));
      for (const [k] of bySlot) {
        if (!slotOrder.includes(k)) slotOrder.push(k);
      }
      for (const slotKey of slotOrder) {
        const group = bySlot.get(slotKey) || [];
        const cell = document.createElement('div');
        cell.className =
          'las-pboard-slot las-pboard-slot-none is-filled' +
          (group.length > 1 ? ' is-stack' : '');
        cell.dataset.slot = slotKey;
        const body = document.createElement('div');
        body.className = 'las-pboard-slot-body';
        // 未建造在下、已建造在上，错位叠放时透出下层
        const ordered = group.slice().sort((a, b) => {
          const ab = a.built ? 1 : 0;
          const bb = b.built ? 1 : 0;
          return ab - bb;
        });
        if (ordered.length > 1) {
          cell.style.setProperty('--stack-n', String(ordered.length));
        }
        ordered.forEach((b, i) => {
          const card = makeBoardBuildingCard(game, meId, p, b, isMe);
          if (ordered.length > 1) {
            card.style.setProperty('--stack-i', String(i));
          }
          body.appendChild(card);
        });
        if (ordered.length > 1) {
          const badge = document.createElement('span');
          badge.className = 'las-pboard-stack-badge';
          badge.textContent = '×' + ordered.length;
          cell.appendChild(badge);
        }
        cell.appendChild(body);
        if (isMe && isHomogeneousStackSlot(p, slotKey)) {
          cell.classList.add('is-stackable');
          const slotStackKey = buildingStackKey(group[0]);
          cell.onclick = (ev) => {
            if (ev.target && ev.target.closest && ev.target.closest('.las-pboard-card')) {
              return;
            }
            const unplacedMatch = (p.buildings || []).find(
              (b) =>
                !b.built &&
                b.slot == null &&
                buildingStackKey(b) === slotStackKey
            );
            if (!unplacedMatch || !netRef) return;
            netRef.sendAction('placeBuildingSlot', {
              buildingId: unplacedMatch.id,
              slot: slotKey,
            });
          };
        }
        slots.appendChild(cell);
      }
      const emptyCount = Math.max(0, maxB - bySlot.size);
      for (let i = 0; i < emptyCount; i++) {
        const cell = document.createElement('div');
        cell.className = 'las-pboard-slot las-pboard-slot-none is-empty';
        cell.setAttribute('aria-hidden', 'true');
        const body = document.createElement('div');
        body.className = 'las-pboard-slot-body';
        if (isMe) {
          cell.classList.add('is-drop');
          cell.removeAttribute('aria-hidden');
          cell.onclick = () => {
            const unplaced = (p.buildings || []).find(
              (b) => !b.built && b.slot == null
            );
            if (!unplaced || !netRef) return;
            const slot = pickPlaceSlotForBuilding(p, unplaced);
            if (slot == null) return;
            netRef.sendAction('placeBuildingSlot', {
              buildingId: unplaced.id,
              slot,
            });
          };
        }
        cell.appendChild(body);
        slots.appendChild(cell);
      }

      const unplaced = (p.buildings || []).filter((b) => b.slot == null);
      let unplacedHand = null;
      if (unplaced.length) {
        const hand = document.createElement('div');
        hand.className = 'las-pboard-unplaced';
        if (isMe) {
          const lab = document.createElement('div');
          lab.className = 'las-pboard-label';
          lab.textContent = t('lasidao.unplacedBuilds');
          hand.appendChild(lab);
        }
        const cards = document.createElement('div');
        cards.className = 'las-cards';
        for (const b of unplaced) {
          cards.appendChild(makeBoardBuildingCard(game, meId, p, b, isMe));
        }
        hand.appendChild(cards);
        unplacedHand = hand;
      }

      const funcs = document.createElement('div');
      funcs.className = 'las-pboard-funcs las-cards las-func-hand';
      fillFuncHandRow(funcs, {
        cards: p.funcCards,
        isMe,
        interactive:
          isMe &&
          (game.phase === 'produce' ||
            game.phase === 'build' ||
            game.phase === 'settle_act'),
        game,
        player: p,
        meId,
        funcCount: p.funcCount,
        maxSlots: maxFunc,
      });

      if (isMe) {
        const buildSection = document.createElement('div');
        buildSection.className = 'las-pboard-build-section';
        buildSection.appendChild(slotsTitle);
        buildSection.appendChild(slots);
        if (unplacedHand) buildSection.appendChild(unplacedHand);
        if (
          p.pendingDiscardBuild &&
          p.pendingDiscardBuild.newCard &&
          game.phase === 'build'
        ) {
          appendBuildDiscardChoiceUi(buildSection, game, meId, p);
        } else if (p.pendingDiscardBuild && game.phase === 'build') {
          const tip = document.createElement('div');
          tip.className = 'muted las-pboard-tip';
          tip.textContent = t('lasidao.discardBuildTip', { n: maxB });
          buildSection.appendChild(tip);
        }
        if (buildHost) {
          buildHost.innerHTML = '';
          buildHost.appendChild(buildSection);
        }

        const funcTitle = document.createElement('div');
        funcTitle.className = 'las-pboard-label';
        funcTitle.textContent = t('lasidao.funcHandCap', {
          n: funcN,
          max: maxFunc,
        });
        const funcSection = document.createElement('div');
        funcSection.className = 'las-pboard-func-section';
        funcSection.appendChild(funcTitle);
        funcSection.appendChild(funcs);
        if (funcHost) {
          funcHost.innerHTML = '';
          funcHost.appendChild(funcSection);
        }
      } else {
        board.classList.add('las-other-pboard');
        const grid = document.createElement('div');
        grid.className = 'las-other-player-grid';

        const infoCell = document.createElement('div');
        infoCell.className = 'las-other-pcell las-other-pcell-info';
        appendOtherPlayerInfoGrid(infoCell, game, p, statsPayload, meId);
        grid.appendChild(infoCell);

        const buildCell = document.createElement('div');
        buildCell.className = 'las-other-pcell las-other-pcell-build las-pcell-build';
        appendOtherPlayerCornerSection(
          buildCell,
          t('lasidao.buildSlotsCap', { n: buildN, max: maxB }),
          slots
        );
        if (unplacedHand) buildCell.appendChild(unplacedHand);
        grid.appendChild(buildCell);

        const funcCell = document.createElement('div');
        funcCell.className = 'las-other-pcell las-other-pcell-func las-pcell-func';
        appendOtherPlayerCornerSection(
          funcCell,
          t('lasidao.funcHandCap', { n: funcN, max: maxFunc }),
          funcs
        );
        grid.appendChild(funcCell);

        board.appendChild(grid);
      }

      board.dataset.lasPanelHash = panelHash;
      if (existing) existing.replaceWith(board);
      else panelHost.appendChild(board);
      if (!isMe) othersCount += 1;
    }

    for (const container of [host, meHost]) {
      if (!container) continue;
      for (const el of [...container.querySelectorAll('[data-pid]')]) {
        if (!seenIds.has(el.dataset.pid)) el.remove();
      }
    }

    if (!meId || !mePlayer(game, meId)) {
      const buildHost = $('las-pcell-build');
      const funcHost = $('las-pcell-func');
      if (buildHost) buildHost.innerHTML = '';
      if (funcHost) funcHost.innerHTML = '';
    }

    if (othersTitle) {
      othersTitle.hidden = othersCount === 0;
    }
    host.hidden = othersCount === 0;
  }

  function sumWishAlloc() {
    return (
      (wishAlloc.wood || 0) +
      (wishAlloc.stone || 0) +
      (wishAlloc.food || 0) +
      (wishAlloc.iron || 0)
    );
  }

  function setWishWellModalOpen(open) {
    const modal = $('las-wishwell-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (!open) {
      wishAlloc = { wood: 0, stone: 0, food: 0, iron: 0 };
      wishAllocFor = 0;
    } else if (window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(modal);
    }
  }

  function renderWishWellModal(game, me, labels) {
    const hint = $('las-wishwell-modal-hint');
    const picks = $('las-wishwell-modal-picks');
    const confirmBtn = $('btn-las-wishwell-modal-confirm');
    if (!picks) return;

    const need = Number(me.pendingWishWellBonus) || 0;
    if (wishAllocFor !== need) {
      wishAllocFor = need;
      wishAlloc = { wood: 0, stone: 0, food: 0, iron: 0 };
    }

    const used = sumWishAlloc();
    const left = Math.max(0, need - used);
    if (hint) {
      hint.textContent = t('lasidao.wishWellHint', { left, total: need });
    }

    picks.innerHTML = '';
    for (const [k, lab] of Object.entries(labels)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'las-wishwell-pick' + ((wishAlloc[k] || 0) > 0 ? ' is-on' : '');
      btn.textContent = t('lasidao.wishWellPick', {
        name: lab,
        n: wishAlloc[k] || 0,
      });
      btn.disabled = left <= 0;
      btn.onclick = () => {
        if (sumWishAlloc() >= need) return;
        wishAlloc[k] = (wishAlloc[k] || 0) + 1;
        renderWishWellModal(game, me, labels);
      };
      picks.appendChild(btn);
    }
    if (confirmBtn) {
      confirmBtn.disabled = used !== need;
    }
  }

  function syncWishWellModal(game, meId) {
    const me = mePlayer(game, meId);
    const need = me ? Number(me.pendingWishWellBonus) || 0 : 0;
    const shouldOpen =
      game.phase === 'wish_well' &&
      need > 0 &&
      !settlePlaying &&
      game.phase !== 'settle';
    const modal = $('las-wishwell-modal');
    const isOpen = modal && !modal.hidden;

    if (shouldOpen) {
      if (!isOpen) setWishWellModalOpen(true);
      renderWishWellModal(game, me, getResLabels(game));
    } else if (isOpen) {
      setWishWellModalOpen(false);
    }
  }

  function getSettleDiscardKind(game, me) {
    if (!game || !me || game.phase !== 'settle_act') return null;
    if (!isMyTurn(game, me.id)) return null;
    const scope = game.settleActScope || 'all';
    if (me.pendingDiscardRes && (scope === 'resource' || scope === 'all')) {
      return 'res';
    }
    if (
      me.pendingDiscardFunc &&
      (scope === 'card' || scope === 'all') &&
      !me.pendingDiscardRes
    ) {
      return 'func';
    }
    if (
      me.pendingDiscardBuild &&
      (scope === 'card' || scope === 'all') &&
      !me.pendingDiscardRes &&
      !me.pendingDiscardFunc
    ) {
      return 'build';
    }
    return null;
  }

  function shouldOpenSettleDiscardModal(game, meId) {
    if (!game || settlePlaying) return false;
    const me = mePlayer(game, meId);
    return Boolean(getSettleDiscardKind(game, me));
  }

  function settleDiscardResNeed(game, me) {
    if (!me || !me.pendingDiscardRes) return 0;
    const max =
      game.me && game.me.maxResourceHand != null
        ? game.me.maxResourceHand
        : me.maxResourceHand != null
          ? me.maxResourceHand
          : 12;
    const total = Object.values(me.resources || {}).reduce((a, b) => a + b, 0);
    return Math.max(0, total - max);
  }

  function setSettleDiscardModalOpen(open, kind) {
    const modal = $('las-settle-discard-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (!open) {
      settleDiscardModalKind = null;
      return;
    }
    if (kind && kind !== settleDiscardModalKind) {
      discardResPick = emptyDiscardResPick();
      settleDiscardFuncId = null;
      settleDiscardBuildPick = null;
      settleDiscardModalKind = kind;
    }
    if (window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(modal);
    }
  }

  function updateSettleDiscardModalUi(game, me, kind) {
    const totalEl = $('las-settle-discard-total');
    const hintEl = $('las-settle-discard-hint');
    const confirmBtn = $('btn-las-settle-discard-confirm');
    const resetBtn = $('btn-las-settle-discard-reset');
    if (!kind || !me) {
      if (confirmBtn) confirmBtn.disabled = true;
      if (resetBtn) resetBtn.hidden = true;
      return;
    }
    if (kind === 'res') {
      const max =
        game.me && game.me.maxResourceHand != null
          ? game.me.maxResourceHand
          : me.maxResourceHand != null
            ? me.maxResourceHand
            : 12;
      const total = Object.values(me.resources || {}).reduce((a, b) => a + b, 0);
      const need = settleDiscardResNeed(game, me);
      const picked = discardResPickTotal();
      if (totalEl) {
        totalEl.textContent = t('lasidao.discardResTip', {
          total,
          max,
          need,
          picked,
        });
        totalEl.hidden = false;
      }
      if (hintEl) hintEl.hidden = true;
      if (resetBtn) {
        resetBtn.hidden = false;
        resetBtn.disabled = picked <= 0;
      }
      if (confirmBtn) confirmBtn.disabled = picked !== need;
      document.querySelectorAll('.las-settle-discard-modal .las-harvest-item').forEach((item) => {
        const res = item.dataset.res;
        if (!res) return;
        const c = discardResPick[res] || 0;
        const minus = item.querySelector('.las-harvest-minus');
        const plus = item.querySelector('.las-harvest-plus');
        const countSpan = item.querySelector('.las-harvest-count');
        if (minus) minus.disabled = c <= 0;
        if (plus) plus.disabled = picked >= need;
        if (countSpan) countSpan.textContent = String(c);
      });
      return;
    }
    if (totalEl) totalEl.hidden = true;
    if (resetBtn) resetBtn.hidden = true;
    if (kind === 'func') {
      if (hintEl) {
        hintEl.textContent = t('lasidao.discardFuncTip');
        hintEl.hidden = false;
      }
      if (confirmBtn) confirmBtn.disabled = !settleDiscardFuncId;
      return;
    }
    if (kind === 'build') {
      const pending = me.pendingDiscardBuild;
      const maxB = me.maxBuildings || game.maxBuildings || 3;
      const unbuiltExisting = (me.buildings || []).filter((b) => !b.built);
      if (hintEl) {
        hintEl.textContent = unbuiltExisting.length
          ? t('lasidao.discardBuildChoiceTip', { n: maxB })
          : t('lasidao.discardBuildAllBuiltTip', { n: maxB });
        hintEl.hidden = false;
      }
      if (confirmBtn) confirmBtn.disabled = !settleDiscardBuildPick;
    }
  }

  function renderSettleDiscardResBody(body, game, me) {
    const labels = getResLabels(game);
    const Assets = window.LasidaoAssets;
    const need = settleDiscardResNeed(game, me);
    const handRes = me.resources || {};
    const grid = document.createElement('div');
    grid.className = 'las-harvest-grid';
    for (const res of RESOURCES) {
      const own = handRes[res] || 0;
      if (own < 1) continue;
      const item = document.createElement('div');
      item.className = 'las-harvest-item';
      item.dataset.res = res;

      const handRow = document.createElement('div');
      handRow.className = 'las-harvest-hand';
      handRow.textContent = t('lasidao.eventPickResourceHandSingle', { n: own });
      item.appendChild(handRow);

      const row = document.createElement('div');
      row.className = 'las-harvest-item-row';

      const minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'las-harvest-minus';
      minus.textContent = '−';
      minus.onclick = () => {
        if ((discardResPick[res] || 0) > 0) {
          discardResPick[res] = (discardResPick[res] || 0) - 1;
          updateSettleDiscardModalUi(game, me, 'res');
        }
      };

      const cardEl = document.createElement('div');
      cardEl.className = 'las-harvest-card';
      const url =
        Assets && Assets.resourceHandImageUrl
          ? Assets.resourceHandImageUrl(res)
          : '';
      if (url) cardEl.style.backgroundImage = 'url("' + url + '")';
      const countSpan = document.createElement('span');
      countSpan.className = 'las-harvest-count';
      countSpan.textContent = String(discardResPick[res] || 0);
      cardEl.appendChild(countSpan);

      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'las-harvest-plus';
      plus.textContent = '+';
      plus.onclick = () => {
        const picked = discardResPickTotal();
        const sel = discardResPick[res] || 0;
        if (picked < need && sel < own) {
          discardResPick[res] = sel + 1;
          updateSettleDiscardModalUi(game, me, 'res');
        }
      };

      row.appendChild(minus);
      row.appendChild(cardEl);
      row.appendChild(plus);
      item.appendChild(row);

      const label = document.createElement('div');
      label.className = 'las-harvest-label';
      label.textContent = labels[res] || res;
      item.appendChild(label);
      grid.appendChild(item);
    }
    body.appendChild(grid);
  }

  function renderSettleDiscardFuncBody(body, game, me) {
    const cards = (me.funcCards || []).filter((c) => !c.hidden);
    const grid = document.createElement('div');
    grid.className = 'las-settle-discard-cards';
    for (const c of cards) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'las-card func' +
        (settleDiscardFuncId === c.id ? ' is-selected' : '');
      if (!decorateHandCardArt(btn, c, 'function')) {
        btn.textContent = c.label;
      }
      btn.title = c.label;
      btn.onclick = () => {
        settleDiscardFuncId = settleDiscardFuncId === c.id ? null : c.id;
        renderSettleDiscardModal(game, me);
      };
      grid.appendChild(btn);
    }
    body.appendChild(grid);
  }

  function appendSettleDiscardBuildCard(parent, game, me, card, pickKey, isPendingNew) {
    const btn = makeBoardBuildingCard(game, me.id, me, card, true);
    if (isPendingNew) btn.classList.add('is-pending-new');
    if (settleDiscardBuildPick === pickKey) btn.classList.add('is-selected');
    btn.onclick = () => {
      settleDiscardBuildPick =
        settleDiscardBuildPick === pickKey ? null : pickKey;
      renderSettleDiscardModal(game, me);
    };
    parent.appendChild(btn);
  }

  function renderSettleDiscardBuildBody(body, game, me) {
    const pending = me.pendingDiscardBuild;
    if (!pending || !pending.newCard) return;
    const unbuiltExisting = (me.buildings || []).filter((b) => !b.built);

    const newWrap = document.createElement('div');
    newWrap.className = 'las-settle-discard-group';
    const newLab = document.createElement('div');
    newLab.className = 'las-settle-discard-group-label';
    newLab.textContent = t('lasidao.pendingNewBuild');
    newWrap.appendChild(newLab);
    const newCards = document.createElement('div');
    newCards.className = 'las-settle-discard-cards';
    appendSettleDiscardBuildCard(
      newCards,
      game,
      me,
      pending.newCard,
      'pending',
      true
    );
    newWrap.appendChild(newCards);
    body.appendChild(newWrap);

    if (!unbuiltExisting.length) return;

    const oldWrap = document.createElement('div');
    oldWrap.className = 'las-settle-discard-group';
    const oldLab = document.createElement('div');
    oldLab.className = 'las-settle-discard-group-label';
    oldLab.textContent = t('lasidao.existingUnbuiltDiscard');
    oldWrap.appendChild(oldLab);
    const oldCards = document.createElement('div');
    oldCards.className = 'las-settle-discard-cards';
    for (const b of unbuiltExisting) {
      appendSettleDiscardBuildCard(oldCards, game, me, b, b.id, false);
    }
    oldWrap.appendChild(oldCards);
    body.appendChild(oldWrap);
  }

  function renderSettleDiscardModal(game, me) {
    const titleEl = $('las-settle-discard-title');
    const body = $('las-settle-discard-body');
    if (!titleEl || !body || !me) return;
    const kind = getSettleDiscardKind(game, me);
    body.innerHTML = '';
    if (!kind) return;

    if (kind === 'res') {
      const need = settleDiscardResNeed(game, me);
      if (discardResPickTotal() > need) {
        discardResPick = emptyDiscardResPick();
      }
      for (const r of RESOURCES) {
        const own = me.resources[r] || 0;
        if ((discardResPick[r] || 0) > own) discardResPick[r] = own;
      }
      titleEl.textContent = t('lasidao.statusSettleActYouRes');
      renderSettleDiscardResBody(body, game, me);
    } else if (kind === 'func') {
      titleEl.textContent = t('lasidao.statusSettleActYouFunc');
      renderSettleDiscardFuncBody(body, game, me);
    } else if (kind === 'build') {
      titleEl.textContent = t('lasidao.statusSettleActYouBuild');
      renderSettleDiscardBuildBody(body, game, me);
    }
    updateSettleDiscardModalUi(game, me, kind);
  }

  function syncSettleDiscardModal(game, meId) {
    const me = mePlayer(game, meId);
    const kind = getSettleDiscardKind(game, me);
    const shouldOpen = shouldOpenSettleDiscardModal(game, meId);
    const modal = $('las-settle-discard-modal');
    const isOpen = modal && !modal.hidden;

    if (shouldOpen && kind) {
      if (!isOpen || settleDiscardModalKind !== kind) {
        setSettleDiscardModalOpen(true, kind);
      }
      renderSettleDiscardModal(game, me);
    } else if (isOpen) {
      setSettleDiscardModalOpen(false);
    }
  }

  function fillResSelect(sel, labels) {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '';
    for (const [k, lab] of Object.entries(labels)) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = lab;
      sel.appendChild(opt);
    }
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }

  function onBuildingClick(game, me, b) {
    if (!netRef) return;
    if (me.pendingDiscardBuild) {
      if (game.phase === 'settle_act') return;
      if (b.built) return;
      netRef.sendAction('discardUnbuilt', { buildingId: b.id });
      return;
    }
    // 建造阶段：点选后走确认栏，不直接发动
    if (
      game.phase === 'build' &&
      isMyTurn(game, me.id) &&
      !me.buildPassed &&
      !b.built
    ) {
      selectedFuncId = null;
      selectedPermanent = null;
      selectedBuildingId = selectedBuildingId === b.id ? null : b.id;
      renderPlayerBoards(game, me.id);
      renderFuncForm(game, me);
      syncPermanentSelection(game, me);
      return;
    }
    if (!b.built && b.slot == null) {
      const slot = pickPlaceSlotForBuilding(me, b);
      if (slot == null) return;
      netRef.sendAction('placeBuildingSlot', {
        buildingId: b.id,
        slot,
      });
      return;
    }
    if (
      !b.built &&
      b.slot != null &&
      game.phase === 'build' &&
      isMyTurn(game, me.id) &&
      !me.buildPassed
    ) {
      netRef.sendAction('construct', { buildingId: b.id });
    }
  }

  function renderFuncForm(game, me) {
    const panel = $('las-func-panel');
    const form = $('las-func-form');
    if (!panel || !form) return;

    if (game.phase === 'build') {
      panel.hidden = true;
      form.innerHTML = '';
      return;
    }

    if (!selectedFuncId || !me) {
      panel.hidden = true;
      form.innerHTML = '';
      return;
    }
    // 已跳过本轮建造时防御性关闭功能面板
    if (game.phase === 'build' && me.buildPassed) {
      panel.hidden = true;
      form.innerHTML = '';
      selectedFuncId = null;
      return;
    }
    const card = (me.funcCards || []).find((c) => c.id === selectedFuncId);
    if (!card) {
      panel.hidden = true;
      return;
    }
    if (!canPlayFuncCard(game, me.id, card.funcType)) {
      panel.hidden = true;
      selectedFuncId = null;
      return;
    }
    panel.hidden = false;
    form.innerHTML = '';
    const title = document.createElement('p');
    title.textContent = t('lasidao.funcFormTitle', { label: card.label });
    form.appendChild(title);

      const tip = document.createElement('p');
      tip.className = 'muted';
    tip.textContent = funcRuleText(card.funcType) || card.label;
      form.appendChild(tip);

      const go = document.createElement('button');
      go.type = 'button';
    go.textContent = t('lasidao.confirmUse');
    go.onclick = () => beginSelectedFuncUse(game, me);
      form.appendChild(go);
  }

  function renderPlayers(game, meId) {
    // ???? renderPlayerBoards ??????????
    const ul = $('las-players');
    if (ul) ul.innerHTML = '';
  }

  function setVictoryModalOpen(open) {
    const modal = $('las-victory-modal');
    if (!modal) return;
    modal.hidden = !open;
    const dialog = $('las-victory-dialog');
    if (dialog && !open) dialog.classList.remove('is-in');
  }

  function victoryModalStateKey(game) {
    return ((game && game.winners) || []).join(',') + '@' + ((game && game.round) || 0);
  }

  function renderVictoryModalContent(game, meId) {
    const titleEl = $('las-victory-title');
    const subEl = $('las-victory-sub');
    const listEl = $('las-victory-players');
    if (!titleEl || !subEl || !listEl) return;

    const winners = new Set((game && game.winners) || []);
    const players = (game.players || []).slice().sort((a, b) => {
      const aw = winners.has(a.id) ? 1 : 0;
      const bw = winners.has(b.id) ? 1 : 0;
      if (aw !== bw) return bw - aw;
      return (Number(b.score) || 0) - (Number(a.score) || 0);
    });

    const winnerNames = (game.winners || [])
      .map((id) => {
        const p = players.find((x) => x.id === id);
        return p ? p.name : id;
      })
      .filter(Boolean);

    const iAmWinner = Boolean(meId && winners.has(meId));
    if (iAmWinner && winners.size === 1) {
      titleEl.textContent = t('lasidao.victoryYouWin');
    } else if (winnerNames.length === 1) {
      titleEl.textContent = t('lasidao.victoryWin', { name: winnerNames[0] });
    } else if (winnerNames.length > 1) {
      titleEl.textContent = t('lasidao.victoryWinMulti', {
        names: winnerNames.join('、'),
      });
    } else {
      titleEl.textContent = t('lasidao.victoryTitle');
    }

    subEl.textContent = t('lasidao.victoryRound', {
      round: game.round || 1,
      target: game.winScore || 10,
    });

    listEl.innerHTML = '';
      const Nick = window.PlayerNick;
    players.forEach((p, idx) => {
      const isWinner = winners.has(p.id);
      const isMe = Boolean(meId && p.id === meId);
      const maxB =
        p.maxBuildings ||
        (game.maxBuildings || 3) + (Number(p.expandSlots) || 0);
      const maxFunc = p.maxFuncHand || MAX_FUNC_HAND_UI;
      const maxRes =
        p.maxResourceHand != null ? p.maxResourceHand : 12;
      const totalRes = Object.values(p.resources || {}).reduce(
        (a, b) => a + b,
        0
      );
      const funcN =
        p.funcCount != null ? p.funcCount : (p.funcCards || []).length;
      const buildN = occupiedBuildSlotKeys(p).size;

      const row = document.createElement('div');
      row.className =
        'las-victory-row' +
        (isWinner ? ' is-winner' : '') +
        (isMe ? ' is-me' : '');
      row.style.animationDelay = 0.08 * idx + 0.15 + 's';

      const rank = document.createElement('span');
      rank.className = 'las-victory-rank';
      rank.textContent = String(idx + 1);
      row.appendChild(rank);

      const swatch = document.createElement('span');
      swatch.className = 'las-die-swatch color-' + playerDieColor(game.players, p.id);
      row.appendChild(swatch);

      const info = document.createElement('div');
      info.className = 'las-victory-info';
      const name = document.createElement('div');
      name.className = 'las-victory-name';
      name.innerHTML =
        (Nick && Nick.formatHtml
          ? Nick.formatHtml(p.name, p.tag)
          : escapeHtml(p.name)) +
        (isMe ? ' <span class="you">(' + t('lasidao.youMark') + ')</span>' : '') +
        (isWinner
          ? ' <span class="las-victory-badge">' +
            escapeHtml(t('lasidao.victoryWinnerBadge')) +
            '</span>'
          : '');
      info.appendChild(name);
      const stats = document.createElement('div');
      stats.className = 'las-victory-stats muted';
      stats.textContent = t('lasidao.victoryStats', {
        villagers: p.villagers || 0,
        houses: p.houses != null ? p.houses : 3,
        res: totalRes,
        resMax: maxRes,
        func: funcN,
        funcMax: maxFunc,
        build: buildN,
        buildMax: maxB,
      });
      info.appendChild(stats);
      row.appendChild(info);

      const score = document.createElement('div');
      score.className = 'las-victory-score';
      score.textContent = String(Number(p.score) || 0);
      row.appendChild(score);

      listEl.appendChild(row);
    });
  }


  function appendEventHandResourceSummary(parent, game, meId) {
    if (!parent || !game) return;
    const me = mePlayer(game, meId);
    if (!me) return;
    const labels = getResLabels(game);
    const wrap = document.createElement('div');
    wrap.className = 'las-event-hand-res';
    const title = document.createElement('div');
    title.className = 'las-event-hand-res-title muted';
    title.textContent = t('lasidao.eventPickResourceHand');
    wrap.appendChild(title);
    const row = document.createElement('div');
    row.className = 'las-event-hand-res-row las-res';
    for (const k of RESOURCES) {
      const v = (me.resources && me.resources[k]) || 0;
      const span = document.createElement('span');
      span.className = 'badge';
      span.textContent = (labels[k] || k) + ' ' + v;
      row.appendChild(span);
    }
    const total = RESOURCES.reduce(
      (s, k) => s + ((me.resources && me.resources[k]) || 0),
      0
    );
    const maxRes =
      me.maxResourceHand != null
        ? me.maxResourceHand
        : game.me && game.me.maxResourceHand != null
          ? game.me.maxResourceHand
          : null;
    if (maxRes != null) {
      const cap = document.createElement('span');
      cap.className = 'badge' + (total > maxRes ? ' las-res-over' : '');
      cap.textContent = t('lasidao.resourceHandCap', { total, max: maxRes });
      row.appendChild(cap);
    }
    wrap.appendChild(row);
    parent.appendChild(wrap);
  }

  function syncEventUi(game, meId) {
    const modal = $('las-event-modal');
    const title = $('las-event-title');
    const hint = $('las-event-hint');
    const body = $('las-event-body');
    const confirmBtn = $('btn-las-event-confirm');
    const skipBtn = $('btn-las-event-skip');
    if (!modal || !body) return;

    const choice = game && game.pendingEventChoice;
    const merc = game && game.mercenary;
    const prisonerN = Number(game && game.pendingPrisonerDiscard) || 0;

    const showChoice = Boolean(
      choice &&
        choice.forMe &&
        choice.needChoice !== 'moveBarrenMarker' &&
        choice.needChoice !== 'moveNeutral' &&
        choice.needChoice !== 'recallDie' &&
        choice.needChoice !== 'gatherNeutrals' &&
        choice.needChoice !== 'teleportDie'
    );
    const showPrisoner = Boolean(
      game &&
        game.phase === 'event_discard' &&
        prisonerN > 0 &&
        isMyTurn(game, meId)
    );

    if (!showChoice && !showPrisoner) {
      modal.hidden = true;
      body.innerHTML = '';
      eventTwoResPick = { wood: 0, stone: 0, food: 0, iron: 0 };
      if (confirmBtn) confirmBtn.hidden = true;
      if (skipBtn) skipBtn.hidden = true;
      if (harvestSourceText) setHarvestModalOpen(false);
      return;
    }

    modal.hidden = false;
    body.innerHTML = '';
    if (confirmBtn) {
      confirmBtn.hidden = true;
      confirmBtn.onclick = null;
    }
    if (skipBtn) {
      skipBtn.hidden = true;
      skipBtn.onclick = null;
    }

    if (showChoice) {
      if (title) title.textContent = choice.label || t('lasidao.environmentSlot');
      if (choice.needChoice === 'pickResource') {
        modal.hidden = true;
        openHarvestModal({
          source: choice.label || t('lasidao.environmentSlot'),
          maxCount: 1,
        });
        const harvestCancel = $('btn-las-harvest-cancel');
        if (harvestCancel) harvestCancel.hidden = false;
        return;
      } else if (choice.needChoice === 'pickTwoResources') {
        modal.hidden = true;
        const pickCount = choice.count || 2;
        openHarvestModal({
          source: choice.label || t('lasidao.environmentSlot'),
          maxCount: pickCount,
        });
        const harvestCancel = $('btn-las-harvest-cancel');
        if (harvestCancel) {
          harvestCancel.hidden =
            choice.resume === 'welfareSetup' || choice.resume === 'keepOverflow';
        }
        return;
      }
      return;
    }

    if (showPrisoner) {
      if (title) title.textContent = t('lasidao.eventPrisonerTitle');
      if (hint) hint.textContent = t('lasidao.eventPrisonerHint', { n: prisonerN });
      const me = mePlayer(game, meId);
      if (!me) return;
      for (const r of RESOURCES) {
        const qty = (me.resources && me.resources[r]) || 0;
        if (qty <= 0) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = t('lasidao.res.' + r) + ' ×' + qty;
        btn.onclick = () =>
          netRef &&
          netRef.sendAction('eventDiscard', { kind: 'resource', resource: r });
        body.appendChild(btn);
      }
    }
  }

  function maybeShowVictoryModal(game, meId) {
    if (!game || !game.over) {
      setVictoryModalOpen(false);
      return;
    }
    renderVictoryModalContent(game, meId);
    if (settlePlaying || victoryAnimPlaying) return;

    const key = victoryModalStateKey(game);
    if (victoryModalKey === key && !$('las-victory-modal')?.hidden) {
      return;
    }

    victoryModalKey = key;
    victoryAnimPlaying = true;
    setVictoryModalOpen(false);

    const show = () => {
      victoryAnimPlaying = false;
      setVictoryModalOpen(true);
      const dialog = $('las-victory-dialog');
      if (dialog) {
        dialog.classList.remove('is-in');
        void dialog.offsetWidth;
        dialog.classList.add('is-in');
      }
    };

    const fx = window.LasidaoFx;
    if (fx && typeof fx.playVictory === 'function') {
      Promise.resolve(fx.playVictory(game)).then(show).catch(show);
    } else {
      show();
    }
  }

  function render(game, net, opts) {
    const panel = $('panel-lasidao');
    if (!panel || !game) return;
    hideOthers();
    panel.hidden = false;
    bindLasScale();
    updateLasScale();
    const _prevGame = lastGame; // 保存旧状态，用于结算动画期间冻结手牌区
    lastRenderPrevGame = _prevGame;
    netRef = net;
    lastGame = game;
    lastMeId = opts && opts.meId;
    onLeaveLobbyRef =
      (opts && opts.onLeaveLobby) ||
      onLeaveLobbyRef ||
      null;
    lastGamePhase = game.phase;
    if (game.phase !== 'produce') {
      setVoidSkipModalOpen(false);
    }
    const meId = lastMeId;
    // 进入新的建造回合时重置标记
    if (game.phase === 'build' && isMyTurn(game, meId)) {
      const prevMe = _prevGame ? mePlayer(_prevGame, meId) : null;
      const isNewBuildTurn =
        !_prevGame ||
        _prevGame.phase !== 'build' ||
        !isMyTurn(_prevGame, meId) ||
        (prevMe && prevMe.buildPassed);
      if (isNewBuildTurn) {
        turnUsedBuyFunc = false;
        turnUsedRedraw = false;
      }
    }
    // 根据服务器 pending 状态确认本回合已使用购买功能卡或重抽
    const pendingRedraw = game.pendingRedrawChoice;
    if (pendingRedraw && pendingRedraw.playerId === meId) {
      if (pendingRedraw.source === 'buyFunc') turnUsedBuyFunc = true;
      else if (pendingRedraw.source === 'redraw') turnUsedRedraw = true;
    }

    $('las-round').textContent = t('lasidao.roundPhase', {
      round: game.round,
      phase: phaseLabel(game.phase),
    });
    const deckMeta = $('las-deck-meta');
    if (deckMeta) {
      deckMeta.textContent = t('lasidao.deckMeta', {
        resDraw: (game.decksLeft && game.decksLeft.resource) || 0,
        resDiscard: (game.discardsLeft && game.discardsLeft.resource) || 0,
        spDraw: (game.decksLeft && game.decksLeft.special) || 0,
        spDiscard: (game.discardsLeft && game.discardsLeft.special) || 0,
      });
    }

    renderLasStatus(game, meId);

    if (game.phase === 'init_announce' && game.pendingInitReveal) {
      playInitAnnounce(game);
    } else if (game.phase === 'init_roll' && meId) {
      const me = mePlayer(game, meId);
      const v = me && typeof me.initRoll === 'number' ? me.initRoll : null;
      const key = v != null ? meId + ':' + v : null;
      if (key && initAnimKey !== key) {
        initAnimKey = key;
        playInitRollAnim(v);
      }
      if (v == null) {
        const box = $('las-init-dice');
        if (box) box.hidden = true;
        initAnimKey = null;
      }
    } else if (
      game.pendingInitReveal &&
      meId &&
      typeof game.pendingInitReveal.myRoll === 'number' &&
      game.phase !== 'produce'
    ) {
      const v = game.pendingInitReveal.myRoll;
      const key = meId + ':' + v;
      if (initAnimKey !== key) {
        initAnimKey = key;
        playInitRollAnim(v);
      }
    }

    const initBanner = $('las-init-banner');
    if (initBanner && game.phase !== 'init_announce') {
      initBanner.hidden = true;
    }

    const willPlaySettle = (() => {
      const report = game && game.lastSettle;
      if (!report || !report.at) return false;
      const key = (report.round || '') + ':' + report.at;
      return settleAnimKey !== key && !settlePlaying && ['settle', 'settle_act', 'wish_well', 'build', 'over'].includes(game.phase);
    })();
    // 结算演绎中可冻结手牌显示；建造/弃牌阶段必须用当前状态，否则回合信息过期导致无法点选
    const freezeHandGame =
      (willPlaySettle || settlePlaying) &&
      _prevGame &&
      game.phase !== 'build' &&
      game.phase !== 'settle_act';
    const handGame = freezeHandGame
      ? resolveHandFreezeGame(game, _prevGame)
      : game;

    const deferHeavy = shouldDeferHeavyPanels(game);
    const forceHands = mustRenderHandsNow(game, meId);

    if (!deferHeavy || diceAnim.stage !== 'rolling') {
      renderDice(game, meId, _prevGame);
    }
    if (!deferHeavy) {
      renderProduceIdleBar(game);
    }
    // 离开 settle 阶段后移除 las-settling
    const boardRoot = $('las-playfield');
    if (boardRoot && !isSettlePipelinePhase(game.phase)) {
      boardRoot.classList.remove('las-settling');
    }
    if (settlePlaying && game.phase !== 'settle') {
      abortLocalSettleFx();
      settlePlaying = false;
    }
    const boardGame = resolveBoardGame(game, _prevGame);
    renderBoard(boardGame, meId);
    maybePlayDeal(game, _prevGame);
    applyDeckUi(game);
    if (!deferHeavy || forceHands) {
      deferredHeavyRenderPending = false;
      renderMe(handGame, meId);
      renderBuildHand(handGame, meId);
      renderPlayers(handGame, meId);
    } else {
      deferredHeavyRenderPending = true;
    }
    maybePlayProduceFx(game, _prevGame);

    syncWishWellModal(game, meId);
    syncSettleDiscardModal(game, meId);
    syncEventUi(game, meId);
    syncRedrawUi(game, meId);
    syncIllegalBuildUi(game, meId);
    syncTradeModals(game, meId);

    maybePlaySettle(game);
    ensureSettleAnimAck(game);
    maybeShowVictoryModal(game, meId);
    maybeShowTurnToast(game, meId);
    syncPlayerPanelHighlight(game, meId);
    syncMeSettleSlot(game, meId);

    if (game.over) {
      const permActOver = $('las-permanent-actions');
      if (permActOver) permActOver.classList.add('is-dimmed');
      const produceActionsOver = $('las-produce-actions');
      if (produceActionsOver) produceActionsOver.hidden = true;
    }

    const initWrap = $('las-init-wrap');
    const keepInitUi =
      game.phase === 'init_roll' ||
      game.phase === 'init_announce' ||
      Date.now() < initAnimPlayingUntil;
    if (initWrap) initWrap.hidden = !keepInitUi;
    const initBtn = $('btn-las-init-roll');
    if (initBtn) {
      // ?????????
      initBtn.hidden = true;
    }

    // 常驻功能按钮（建造房子 / 兑换 / 繁殖村民）
    const permAct = $('las-permanent-actions');
    const buildHouseBtn = $('btn-las-build-house');
    const breedBtn = $('btn-las-breed');
    const buyFuncBtn = $('btn-las-buy-func');
    const expandPermBtn = $('btn-las-expand-perm');
    const exBtnAct = $('btn-las-exchange');
    const tradeBtnAct = $('btn-las-trade');
    const resetBuildBtn = $('btn-las-reset-build');
    if (permAct) {
      permAct.hidden = false;
      const myBuildTurn =
        game.phase === 'build' &&
        isMyTurn(game, meId) &&
        !(game.me && game.me.buildPassed);
      permAct.classList.toggle('is-dimmed', !myBuildTurn);
      const me = mePlayer(game, meId);
      const markAffordable = (btn, on) => {
        if (!btn) return;
        btn.classList.toggle('is-affordable', Boolean(on));
      };
      if (me) {
        const mustDiscard =
          me.pendingDiscardFunc || me.pendingDiscardBuild;
        const houseCost = game.buildHouseCost || { wood: 3, stone: 3, iron: 1 };
        const canHouse = canPay(me.resources || {}, houseCost);
        const usedHouse = Boolean(me.roundBuiltHouse);
        const usedBreed = Boolean(me.roundBred);
        const usedExpand = Boolean(me.roundExpanded);
        if (buildHouseBtn) {
          const ok = myBuildTurn && canHouse && !mustDiscard && !usedHouse;
          buildHouseBtn.disabled = !ok;
          markAffordable(buildHouseBtn, ok);
          let houseCostTip;
          if (usedHouse) {
            houseCostTip = t('lasidao.permanentUsedThisTurn');
          } else if (canHouse) {
            houseCostTip = t('lasidao.buildHouseTooltip').replace(/^消耗\s*/, '');
          } else {
            houseCostTip = lackHouseCostTip(game, houseCost);
          }
          setPermBtnTip(
            buildHouseBtn,
            formatPermanentTip(t('lasidao.buildHousePermanent'), houseCostTip)
          );
        }
        if (exBtnAct) {
          const exWrap = ensurePermBtnWrap(exBtnAct);
          if (exWrap) exWrap.classList.add('las-perm-exchange');
          const ok = myBuildTurn && !mustDiscard;
          exBtnAct.disabled = !ok;
          markAffordable(exBtnAct, ok);
          setPermBtnTip(
            exBtnAct,
            formatPermanentTip(
              t('lasidao.exchangeBtn'),
              t('lasidao.permanentNoCost')
            )
          );
        }
        if (tradeBtnAct) {
          const tradeWrap = ensurePermBtnWrap(tradeBtnAct);
          if (tradeWrap) tradeWrap.classList.add('las-perm-trade');
          const canTrade = listTradeTargets(game, meId).length > 0;
          tradeBtnAct.disabled = !canTrade;
          tradeBtnAct.classList.remove('is-selected');
          markAffordable(tradeBtnAct, canTrade);
          setPermBtnTip(
            tradeBtnAct,
            formatPermanentTip(
              t('lasidao.tradeBtn'),
              canTrade
                ? t('lasidao.permanentNoCost')
                : t('lasidao.tradeNoTarget')
            )
          );
        }
        if (breedBtn) {
          const breed = breedCostPayload(game, me);
          const maxV = game.maxVillagers != null ? game.maxVillagers : 15;
          const atCap = me.villagers >= maxV;
          const noHouse = breed.free <= 0;
          const noFood = breed.have < breed.need;
          const canBreed = !atCap && !noHouse && !noFood;
          const ok = myBuildTurn && canBreed && !mustDiscard && !usedBreed;
          breedBtn.disabled = !ok;
          markAffordable(breedBtn, ok);
          let breedCostTip;
          if (usedBreed) {
            breedCostTip = t('lasidao.permanentUsedThisTurn');
          } else if (canBreed) {
            breedCostTip = t('lasidao.breedTooltip', breed);
          } else if (atCap) {
            breedCostTip = t('lasidao.breedLackCap', { max: maxV });
          } else if (noHouse) {
            breedCostTip = t('lasidao.breedLackHouse', {
              capacity: breed.capacity,
              villagers: me.villagers || 0,
            });
          } else {
            breedCostTip = t('lasidao.breedLack', breed);
          }
          setPermBtnTip(
            breedBtn,
            formatPermanentTip(t('lasidao.breedPermanent'), breedCostTip)
          );
          if (selectedPermanent === 'breed' && !ok) selectedPermanent = null;
        }
        if (expandPermBtn) {
          const expandCost = expandCostPayload(game);
          const canExpand = canPay(me.resources || {}, expandCost);
          const ok = myBuildTurn && canExpand && !mustDiscard && !usedExpand;
          expandPermBtn.disabled = !ok;
          markAffordable(expandPermBtn, ok);
          let expandCostTip;
          if (usedExpand) {
            expandCostTip = t('lasidao.permanentUsedThisTurn');
          } else if (canExpand) {
            expandCostTip = t('lasidao.expandPermanentTip', expandCost);
          } else {
            expandCostTip = t('lasidao.expandPermanentLack', expandCost);
          }
          setPermBtnTip(
            expandPermBtn,
            formatPermanentTip(t('lasidao.expandPermanent'), expandCostTip)
          );
          if (selectedPermanent === 'expand' && !ok) selectedPermanent = null;
        }
        if (buyFuncBtn) {
          const buyCost = game.buyFuncCost || { wood: 1, stone: 1, iron: 2 };
          const canBuy = canPay(me.resources || {}, buyCost);
          const ok = myBuildTurn && canBuy && !mustDiscard;
          buyFuncBtn.disabled = !ok;
          markAffordable(buyFuncBtn, ok);
          setPermBtnTip(
            buyFuncBtn,
            formatPermanentTip(
              t('lasidao.buyFuncPermanent'),
              canBuy
                ? t('lasidao.buyFuncPermanentTip', buyCost)
                : t('lasidao.buyFuncPermanentLack', buyCost)
            )
          );
          if (selectedPermanent === 'buyFunc' && !ok) selectedPermanent = null;
        }
        if (resetBuildBtn) {
          const ok =
            myBuildTurn && !turnUsedBuyFunc && !turnUsedRedraw && !mustDiscard;
          resetBuildBtn.disabled = !ok;
          markAffordable(resetBuildBtn, ok);
          setPermBtnTip(
            resetBuildBtn,
            formatPermanentTip(
              t('lasidao.resetBuildTurn'),
              turnUsedBuyFunc
                ? t('lasidao.resetBuildTurnBlockedBuyFunc')
                : turnUsedRedraw
                  ? t('lasidao.resetBuildTurnBlockedRedraw')
                  : t('lasidao.permanentNoCost')
            )
          );
        }
        if (!myBuildTurn && selectedPermanent) selectedPermanent = null;
        syncPermanentSelection(game, me);
        syncBuildConfirmBar(game, me);
      } else {
        selectedPermanent = null;
        syncPermanentSelection(game, me);
        syncBuildConfirmBar(game, me);
      }
    }

    syncBuildConfirmBar(game, mePlayer(game, meId));

    const voidBtn = $('btn-las-void');
    if (
      voidBtn &&
      game.phase !== 'produce' &&
      game.phase !== 'event_mercenary' &&
      game.phase !== 'build'
    ) {
      voidBtn.hidden = true;
    }
    const produceActions = $('las-produce-actions');
    if (
      produceActions &&
      game.phase !== 'produce' &&
      game.phase !== 'event_mercenary' &&
      game.phase !== 'build'
    ) {
      produceActions.hidden = true;
    }

    renderGameLog(game);
    scheduleLasViewportScroll();
  }

  function isSettlePipelinePhase(phase) {
    return ['settle', 'settle_act', 'wish_well', 'build', 'over'].includes(
      phase
    );
  }

  function cloneBoardWorkers(src) {
    const out = {};
    for (const [num, slot] of Object.entries(src || {})) {
      out[num] = { ...slot };
    }
    return out;
  }

  function cloneBoardArea(area) {
    if (!area) return { tiles: [], workers: {}, boosts: {} };
    return {
      ...area,
      tiles: Array.isArray(area.tiles) ? area.tiles.slice() : [],
      workers: cloneBoardWorkers(area.workers),
      boosts: cloneBoardWorkers(area.boosts),
      slots: Array.isArray(area.slots)
        ? area.slots.map((s) => ({
            ...s,
            tiles: Array.isArray(s.tiles) ? s.tiles.slice() : [],
          }))
        : undefined,
    };
  }

  /** 同步更新 slots 数组中的 workers/boosts，避免增量渲染使用旧数据 */
  function updateSlotInArea(areaBoard, number, key, value) {
    if (!areaBoard || !areaBoard.slots) return;
    const idx = areaBoard.slots.findIndex((s) => s.number === number);
    if (idx >= 0) {
      areaBoard.slots[idx] = { ...areaBoard.slots[idx], [key]: value };
    }
  }

  /** 传送事件：在服务端已清空工人前，根据 lastProduceFx 还原骰子位置 */
  function synthesizeBoardAfterTeleport(baseGame, fx) {
    if (!baseGame || !fx || fx.type !== 'teleport') return baseGame;
    const fromArea = fx.fromArea;
    const fromNumber = Number(fx.fromNumber);
    const toArea = fx.toArea;
    const toNumber = Number(fx.number != null ? fx.number : fx.toNumber);
    const targetId = fx.targetId;
    if (
      !fromArea ||
      !toArea ||
      !Number.isFinite(fromNumber) ||
      !Number.isFinite(toNumber) ||
      !targetId
    ) {
      return baseGame;
    }
    const board = {
      resource: cloneBoardArea(baseGame.board && baseGame.board.resource),
      special: cloneBoardArea(baseGame.board && baseGame.board.special),
    };
    const fromSlot = { ...(board[fromArea].workers[fromNumber] || {}) };
    const fromCount = Number(fromSlot[targetId]) || 0;
    if (fromCount <= 0) return baseGame;
    if (fromCount <= 1) delete fromSlot[targetId];
    else fromSlot[targetId] = fromCount - 1;
    board[fromArea].workers = { ...board[fromArea].workers, [fromNumber]: fromSlot };
    updateSlotInArea(board[fromArea], fromNumber, 'workers', fromSlot);
    const toSlot = { ...(board[toArea].workers[toNumber] || {}) };
    toSlot[targetId] = (Number(toSlot[targetId]) || 0) + 1;
    board[toArea].workers = { ...board[toArea].workers, [toNumber]: toSlot };
    updateSlotInArea(board[toArea], toNumber, 'workers', toSlot);

    // 同步事件/环境状态，避免 teleport 触发的事件效果在基于 prevGame 合成时被遗漏
    if (lastGame && lastGame.board) {
      for (const key of ['resource', 'special']) {
        const refArea = lastGame.board[key];
        if (refArea && board[key] && refArea.environments) {
          board[key].environments = { ...refArea.environments };
        }
      }
    }

    return { ...baseGame, board };
  }

  /** 在服务端已清空工人时，根据 lastProduceFx 还原最后一手派遣的版面显示 */
  function synthesizeBoardAfterDispatch(baseGame, fx) {
    if (!baseGame || !fx || fx.type !== 'dispatch' || !fx.actorId) {
      return baseGame;
    }
    const count = Math.max(1, Number(fx.count) || 1);
    const boostAdd = Math.max(0, Number(fx.boostAdd) || 0);

    if (fx.buildingId) {
      return {
        ...baseGame,
        players: (baseGame.players || []).map((p) => ({
          ...p,
          buildings: (p.buildings || []).map((b) =>
            b.id === fx.buildingId
              ? { ...b, workers: (Number(b.workers) || 0) + count }
              : b
          ),
        })),
      };
    }

    const area = fx.area;
    const number = fx.number != null ? fx.number : fx.face;
    if (!area || number == null) return baseGame;

    const board = {
      resource: cloneBoardArea(baseGame.board && baseGame.board.resource),
      special: cloneBoardArea(baseGame.board && baseGame.board.special),
    };
    const areaBoard = board[area];
    if (!areaBoard) return baseGame;

    const slotW = { ...(areaBoard.workers[number] || {}) };
    slotW[fx.actorId] = (slotW[fx.actorId] || 0) + count;
    areaBoard.workers = { ...areaBoard.workers, [number]: slotW };
    updateSlotInArea(areaBoard, number, 'workers', slotW);

    if (boostAdd > 0) {
      const slotB = { ...((areaBoard.boosts && areaBoard.boosts[number]) || {}) };
      slotB[fx.actorId] = (slotB[fx.actorId] || 0) + boostAdd;
      areaBoard.boosts = { ...(areaBoard.boosts || {}), [number]: slotB };
      updateSlotInArea(areaBoard, number, 'boosts', slotB);
    }

    // 同步事件/环境状态，避免 dispatch 触发的事件效果（如 firstCome stashClaimed）
    // 在基于 prevGame 合成时被遗漏
    if (lastGame && lastGame.board) {
      for (const key of ['resource', 'special']) {
        const refArea = lastGame.board[key];
        if (refArea && board[key] && refArea.environments) {
          board[key].environments = { ...refArea.environments };
        }
      }
    }

    return { ...baseGame, board };
  }

  function boardHasDispatch(baseGame, fx) {
    if (!baseGame || !fx || fx.type !== 'dispatch' || !fx.actorId) return false;
    const need = Math.max(1, Number(fx.count) || 1);
    if (fx.buildingId) {
      for (const p of baseGame.players || []) {
        const b = (p.buildings || []).find((x) => x.id === fx.buildingId);
        if (b && (Number(b.workers) || 0) >= need) return true;
      }
      return false;
    }
    const area = fx.area;
    const number = fx.number != null ? fx.number : fx.face;
    const slotW =
      baseGame.board &&
      baseGame.board[area] &&
      baseGame.board[area].workers &&
      baseGame.board[area].workers[number];
    return Boolean(slotW && (slotW[fx.actorId] || 0) >= need);
  }

  function boardHasAnyWorkers(game) {
    if (!game || !game.board) return false;
    for (const area of ['resource', 'special']) {
      const workers = game.board[area] && game.board[area].workers;
      if (!workers) continue;
      for (const slot of Object.values(workers)) {
        if (slot && Object.values(slot).some((n) => Number(n) > 0)) return true;
      }
    }
    for (const p of game.players || []) {
      for (const b of p.buildings || []) {
        if ((Number(b.workers) || 0) > 0) return true;
      }
    }
    return false;
  }

  /** 服务端已清空工人/取走卡牌时，从 lastSettle 报告还原结算前版面 */
  function synthesizeSettleBoardFromReport(game) {
    const report = game && game.lastSettle;
    if (!report) return game;
    const board = {
      resource: cloneBoardArea(game.board && game.board.resource),
      special: cloneBoardArea(game.board && game.board.special),
    };
    board.resource.workers = {};
    board.resource.boosts = board.resource.boosts || {};
    board.special.workers = {};
    board.special.boosts = board.special.boosts || {};

    for (const slot of report.slots || []) {
      const area = slot.area;
      const num = slot.number;
      if (!area || !board[area] || num == null) continue;
      if (slot.physical && Object.keys(slot.physical).length) {
        board[area].workers[num] = { ...slot.physical };
      }
      if (slot.boosts && Object.keys(slot.boosts).length) {
        board[area].boosts[num] = { ...slot.boosts };
      }
      // 同步 slots 数组，renderAreaBoard 优先读取 slots 而非 workers
      const slotArr = board[area].slots;
      if (Array.isArray(slotArr)) {
        const s = slotArr.find((x) => x.number === num);
        if (s) {
          if (slot.physical) s.workers = { ...slot.physical };
          if (slot.boosts) s.boosts = { ...slot.boosts };
        } else {
          slotArr.push({
            number: num,
            tiles: [],
            workers: slot.physical ? { ...slot.physical } : {},
            boosts: slot.boosts ? { ...slot.boosts } : {},
            environment: null,
          });
        }
      }
      if (Array.isArray(slot.tiles) && slot.tiles.length) {
        const tiles = (board[area].tiles || []).slice();
        const ids = new Set(tiles.map((t) => t.id));
        for (const t of slot.tiles) {
          if (!t || !t.id) continue;
          const idx = tiles.findIndex((x) => x.id === t.id);
          if (idx >= 0) {
            tiles[idx] = { ...tiles[idx], ...t, number: num };
          } else {
            tiles.push({ ...t, number: num });
            ids.add(t.id);
          }
        }
        board[area].tiles = tiles;
        // 同步 slots 中的 tiles
        if (Array.isArray(slotArr)) {
          const s = slotArr.find((x) => x.number === num);
          if (s) {
            const stiles = (s.tiles || []).slice();
            for (const t of slot.tiles) {
              if (!t || !t.id) continue;
              const idx2 = stiles.findIndex((x) => x.id === t.id);
              if (idx2 >= 0) {
                stiles[idx2] = { ...stiles[idx2], ...t, number: num };
              } else {
                stiles.push({ ...t, number: num });
              }
            }
            s.tiles = stiles;
          }
        }
      }
    }
    return { ...game, board, phase: 'produce' };
  }

  function buildSettleBoardFreeze(game, prevGame) {
    const report = game && game.lastSettle;
    if (!report || !report.at) return null;
    const key = (report.round || '') + ':' + report.at;
    if (settleBoardFreeze && settleBoardFreezeKey === key) {
      return settleBoardFreeze;
    }

    let base = null;
    if (
      prevGame &&
      prevGame.board &&
      (prevGame.phase === 'produce' || boardHasAnyWorkers(prevGame))
    ) {
      base = prevGame;
    } else {
      base = synthesizeSettleBoardFromReport(game);
    }

    const fx = game.lastProduceFx;
    if (
      fx &&
      fx.type === 'dispatch' &&
      fx.actorId &&
      base &&
      !boardHasDispatch(base, fx)
    ) {
      base = synthesizeBoardAfterDispatch(base, fx);
    }
    if (fx && fx.type === 'teleport' && base) {
      base = synthesizeBoardAfterTeleport(base, fx);
    }

    const snap = {
      ...base,
      board: {
        resource: cloneBoardArea(base.board && base.board.resource),
        special: cloneBoardArea(base.board && base.board.special),
      },
    };
    for (const slot of report.slots || []) {
      const area = slot.area;
      const num = slot.number;
      if (!area || !snap.board[area] || num == null) continue;
      if (slot.physical && Object.keys(slot.physical).length) {
        snap.board[area].workers[num] = { ...slot.physical };
      }
      if (slot.boosts && Object.keys(slot.boosts).length) {
        snap.board[area].boosts = snap.board[area].boosts || {};
        snap.board[area].boosts[num] = { ...slot.boosts };
      }
      // 同步 slots 数组，renderAreaBoard 优先读取 slots 而非 workers
      const slotArr = snap.board[area].slots;
      if (Array.isArray(slotArr)) {
        const s = slotArr.find((x) => x.number === num);
        if (s) {
          if (slot.physical) s.workers = { ...slot.physical };
          if (slot.boosts) s.boosts = { ...slot.boosts };
        } else {
          slotArr.push({
            number: num,
            tiles: [],
            workers: slot.physical ? { ...slot.physical } : {},
            boosts: slot.boosts ? { ...slot.boosts } : {},
            environment: null,
          });
        }
      }
      const tiles = (snap.board[area].tiles || []).slice();
      for (const rt of slot.tiles || []) {
        if (!rt || !rt.id) continue;
        const idx = tiles.findIndex((t) => t.id === rt.id);
        if (idx >= 0) {
          tiles[idx] = { ...tiles[idx], ...rt, number: num };
        }
      }
      snap.board[area].tiles = tiles;
      // 同步 slots 中的 tiles
      if (Array.isArray(slotArr)) {
        const s = slotArr.find((x) => x.number === num);
        if (s) {
          const stiles = (s.tiles || []).slice();
          for (const rt of slot.tiles || []) {
            if (!rt || !rt.id) continue;
            const idx2 = stiles.findIndex((t) => t.id === rt.id);
            if (idx2 >= 0) {
              stiles[idx2] = { ...stiles[idx2], ...rt, number: num };
            }
          }
          s.tiles = stiles;
        }
      }
    }
    settleBoardFreeze = snap;
    settleBoardFreezeKey = key;
    return snap;
  }

  function shouldUseSettleBoardFreeze(game) {
    const report = game && game.lastSettle;
    if (!report || !report.at || !isSettlePipelinePhase(game.phase)) {
      return false;
    }
    // 只有在真正的 settle 阶段才使用 freeze；settle_act / build / produce 等应使用最新 state
    if (game.phase !== 'settle') return false;
    return true;
  }

  /**
   * 结算动画期间冻结手牌：隐藏版面结算刚发的资源/卡，但保留生产阶段已到手的（如最后一跳爆骰换资源）。
   * produce→settle 同一次推送时 prev 还是跳过前状态，不能直接用 prev。
   */
  function resolveHandFreezeGame(game, prevGame) {
    const report = game && game.lastSettle;
    const key =
      report && report.at != null
        ? `${report.round || ''}:${report.at}`
        : null;
    if (key && settleHandFreeze && settleHandFreezeKey === key) {
      return settleHandFreeze;
    }

    let snap;
    if (
      prevGame &&
      prevGame.phase === 'produce' &&
      game &&
      report
    ) {
      const resById = Object.create(null);
      for (const p of game.players || []) {
        if (!p || !p.id) continue;
        resById[p.id] = { ...(p.resources || {}) };
      }
      for (const slot of report.slots || []) {
        if (!slot || slot.area !== 'resource') continue;
        for (const g of slot.gains || []) {
          if (!g || !g.pid || !resById[g.pid]) continue;
          const bag = resById[g.pid];
          for (const d of g.detail || []) {
            if (!d || !d.resource) continue;
            bag[d.resource] = Math.max(
              0,
              (Number(bag[d.resource]) || 0) - (Number(d.amount) || 0)
            );
          }
        }
      }
      const patchPlayer = (p) => {
        if (!p || !p.id || !resById[p.id]) return p;
        return { ...p, resources: resById[p.id] };
      };
      snap = {
        ...prevGame,
        players: (prevGame.players || []).map(patchPlayer),
        me: prevGame.me ? patchPlayer(prevGame.me) : prevGame.me,
      };
    } else {
      snap = prevGame || game;
    }

    if (key) {
      settleHandFreeze = snap;
      settleHandFreezeKey = key;
    }
    return snap;
  }

  function resolveBoardGame(game, prevGame) {
    // 已进入结算管道阶段时，优先使用 settle snapshot，避免 dispatchFreeze 遮挡最终状态
    if (shouldUseSettleBoardFreeze(game)) {
      const snap =
        settleBoardFreeze || buildSettleBoardFreeze(game, prevGame);
      if (snap) return snap;
    }

    if (dispatchBoardFreeze) return dispatchBoardFreeze;

    const fx = game && game.lastProduceFx;
    if (produceFxPlaying && fx && fx.type === 'dispatch' && fx.actorId !== lastMeId) {
      return dispatchBoardFreeze || prevGame || game;
    }

    return game;
  }

  function produceFxBlocksSettle(game) {
    if (dispatchBusy) return true;
    if (!produceFxPlaying) return false;
    const fx = game && game.lastProduceFx;
    if (fx && (fx.type === 'teleport' || fx.type === 'recall')) return false;
    if (fx && fx.type === 'dispatch' && fx.actorId === lastMeId) return false;
    return true;
  }

  function maybePlaySettle(game) {
    const report = game && game.lastSettle;
    if (!report || !report.at) return;
    const key = (report.round || '') + ':' + report.at;
    if (settleAnimKey === key || settlePlaying) {
      ensureSettleAnimAck(game);
      return;
    }
    if (!isSettlePipelinePhase(game.phase)) {
      return;
    }

    if (produceFxBlocksSettle(game)) {
      scheduleSettleUnstick();
      return;
    }

    const dispatchFx = game.lastProduceFx;
    if (
      dispatchFx &&
      dispatchFx.type === 'dispatch' &&
      dispatchFx.id &&
      dispatchFx.id !== lastProduceFxKey &&
      game.phase === 'produce'
    ) {
      return;
    }

    if (
      dispatchFx &&
      dispatchFx.type === 'dispatch' &&
      dispatchFx.id &&
      settleDispatchHoldKey !== key
    ) {
      if (!settleDispatchHoldTimer) {
        const delay = dispatchFx.actorId === lastMeId ? 700 : 450;
        settleDispatchHoldTimer = setTimeout(() => {
          settleDispatchHoldTimer = null;
          settleDispatchHoldKey = key;
          if (lastGame) maybePlaySettle(lastGame);
        }, delay);
      }
      return;
    }

    settleAnimKey = key;
    settleDispatchHoldKey = key;
    settlePlaying = true;
    armSettlePlayingWatchdog(key);
    const boardSnap =
      buildSettleBoardFreeze(game, lastRenderPrevGame) ||
      settleBoardFreeze;
    if (boardSnap && lastMeId) {
      renderBoard(boardSnap, lastMeId);
    }
    const status = $('las-status');
    if (status) status.hidden = true;
    syncSkipSettleBtn(game, lastMeId);
    const LasFx = window.LasidaoFx;
    const boardRoot = $('las-playfield') || document.body;
    if (boardRoot) boardRoot.classList.add('las-settling');

    const run = async () => {
      try {
        if (LasFx && typeof LasFx.playSettle === 'function') {
          await LasFx.playSettle(game);
        }
        if (LasFx && typeof LasFx.settleSleep === 'function') {
          await LasFx.settleSleep(400);
        } else {
          await new Promise((r) => setTimeout(r, Math.round(400 / 2.5)));
        }
        const boardSnap2 = settleBoardFreeze || lastGame || game;
        if (LasFx && typeof LasFx.playRecycleBoard === 'function') {
          await LasFx.playRecycleBoard(boardSnap2);
        }
      } catch (err) {
        if (LasFx && typeof LasFx.isSettleAbort === 'function' && LasFx.isSettleAbort(err)) {
          return;
        }
        if (err && err.name === 'SettleAbort') return;
        throw err;
      }
    };

    Promise.resolve(run())
      .then(() => finishSettleUi(key))
      .catch(() => finishSettleUi(key));
  }

  function peekPendingOpponentDispatch(game) {
    const fx = game && game.lastProduceFx;
    return Boolean(
      fx &&
        fx.type === 'dispatch' &&
        fx.id &&
        fx.id !== lastProduceFxKey &&
        !produceFxPlaying &&
        !dispatchBusy &&
        !settlePlaying &&
        !dealAnimPlaying &&
        fx.actorId &&
        fx.actorId !== lastMeId
    );
  }

  function maybePlayProduceFx(game, prevGame) {
    const fx = game && game.lastProduceFx;
    if (!fx || !fx.id || fx.id === lastProduceFxKey || produceFxPlaying) return;
    if (settlePlaying || dealAnimPlaying || dispatchBusy) return;
    lastProduceFxKey = fx.id;
    produceFxPlaying = true;
    armProduceFxWatchdog();
    const LasFx = window.LasidaoFx;
    const finish = () => {
      produceFxPlaying = false;
      if (produceFxWatchdog) {
        clearTimeout(produceFxWatchdog);
        produceFxWatchdog = null;
      }
      if (LasFx && typeof LasFx.clearLayer === 'function') LasFx.clearLayer();
      flushDeferredHeavyRender();
      if (lastGame && isSettlePipelinePhase(lastGame.phase)) {
        maybePlaySettle(lastGame);
      }
    };

    if (fx.type === 'dispatch') {
      // 本人已在本地播过派遣动画，跳过；对手则先冻结板块再飞入
      if (fx.actorId && fx.actorId === lastMeId) {
        finish();
        return;
      }
      dispatchBoardFreeze = prevGame || null;
      if (dispatchBoardFreeze) renderBoard(dispatchBoardFreeze, lastMeId);
      const color = playerDieColor(
        (game.players || []).length ? game.players : (prevGame && prevGame.players) || [],
        fx.actorId,
        game
      );
      const fromCenters = collectOpponentDispatchCenters(fx.count || 1);
      const run =
        LasFx && typeof LasFx.playDispatch === 'function'
          ? LasFx.playDispatch({
              face: fx.face != null ? fx.face : fx.number,
              count: fx.count || 1,
              color,
              fromCenters,
              area: fx.area,
              number: fx.number != null ? fx.number : fx.face,
              buildingId: fx.buildingId || null,
            })
          : Promise.resolve();
      Promise.resolve(run)
        .then(() => {
          dispatchBoardFreeze = null;
          if (lastGame) {
            const snap = synthesizeBoardAfterDispatch(prevGame || lastGame, fx);
            renderBoard(snap, lastMeId);
          }
          finish();
        })
        .catch(() => {
          dispatchBoardFreeze = null;
          if (lastGame) {
            const snap = synthesizeBoardAfterDispatch(prevGame || lastGame, fx);
            renderBoard(snap, lastMeId);
          }
          finish();
        });
      return;
    }

    if (fx.type === 'banditRaid' && fx.actorId && fx.actorId === lastMeId) {
      finish();
      return;
    }

    if (fx.type === 'teleport') {
      if (prevGame || lastGame) {
        const snap = synthesizeBoardAfterTeleport(prevGame || lastGame, fx);
        renderBoard(snap, lastMeId);
      }
      finish();
      return;
    }

    const run =
      fx.type === 'exile' && LasFx && typeof LasFx.playExile === 'function'
        ? LasFx.playExile({ game, ...fx })
        : fx.type === 'banditRaid' &&
            LasFx &&
            typeof LasFx.playBanditRaid === 'function'
          ? LasFx.playBanditRaid({ game, ...fx })
          : Promise.resolve();
    Promise.resolve(run).then(finish).catch(finish);
  }

  function collectOpponentDispatchCenters(count) {
    const centers = [];
    const n = Math.max(1, Number(count) || 1);
    const diceRoot = $('las-dice');
    const diceEls = diceRoot
      ? diceRoot.querySelectorAll('.las-die, .las-die-face')
      : [];
    for (const el of diceEls) {
      const r = el.getBoundingClientRect();
      if (r.width || r.height) {
        centers.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }
    }
    if (!centers.length) {
      const group = document.querySelector('.las-die-group .las-die-face, .las-die-group .las-die');
      if (group) {
        const r = group.getBoundingClientRect();
        if (r.width || r.height) {
          centers.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }
      }
    }
    if (!centers.length) {
      const stage = $('las-dice-stage') || $('las-dice') || $('las-pcell-dice');
      if (stage) {
        const r = stage.getBoundingClientRect();
        centers.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }
    }
    if (!centers.length) return centers;
    const out = [];
    for (let i = 0; i < n; i++) {
      const base = centers[i % centers.length];
      out.push({
        x: base.x + (i % 3) * 6 - 6,
        y: base.y + Math.floor(i / 3) * 6,
      });
    }
    return out;
  }

  let dispatchBusy = false;

  function collectDispatchFromCenters(remote, face, count) {
    const centers = [];
    if (remote) {
      const diceRoot = $('las-dice');
      const selected = diceRoot
        ? diceRoot.querySelectorAll('.las-die.is-selected, .las-die.is-wild.is-selected')
        : [];
      for (const el of selected) {
        const r = el.getBoundingClientRect();
        if (r.width || r.height) {
          centers.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }
      }
    } else {
      const group = document.querySelector('.las-die-group.is-selected');
      if (group) {
        const stacks = group.querySelectorAll('.las-die-stack');
        for (const stack of stacks) {
          const faceEl = stack.querySelector('.las-die-face, .las-die');
          const mulEl = stack.querySelector('.las-die-mul');
          if (!faceEl) continue;
          const r = faceEl.getBoundingClientRect();
          if (!r.width && !r.height) continue;
          const base = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          let n = 1;
          if (mulEl && mulEl.textContent) {
            const m = mulEl.textContent.match(/\d+/);
            if (m) n = Math.max(1, parseInt(m[0], 10) || 1);
          }
          for (let i = 0; i < n; i++) {
            centers.push({
              x: base.x + (i % 3) * 6 - 6,
              y: base.y + Math.floor(i / 3) * 6,
            });
          }
        }
      }
      if (!centers.length) {
        const el = $('las-dice-groups') || $('las-dice');
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width || r.height) {
            const base = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            for (let i = 0; i < count; i++) {
              centers.push({
                x: base.x + (i % 3) * 6 - 6,
                y: base.y + Math.floor(i / 3) * 6,
              });
            }
          }
        }
      }
    }
    if (!centers.length) {
      const stage = $('las-dice-stage') || $('las-dice');
      if (stage) {
        const r = stage.getBoundingClientRect();
        const base = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        for (let i = 0; i < count; i++) centers.push(base);
      }
    }
    return centers;
  }

  async function confirmMercenaryPlace() {
    if (!netRef || !lastGame || dispatchBusy) return;
    if (!isMercenaryPlaceMode(lastGame, lastMeId)) return;
    const merc = lastGame.mercenary;
    if (selectedFace == null || !selectedTarget || selectedTarget.type !== 'area') {
      return;
    }
    const idx = mercenaryDieIndexForFace(merc, selectedFace);
    if (idx < 0) return;
    const face = merc.roll[idx];
    if (Number(selectedTarget.number) !== face) return;

    const color = playerDieColor(lastGame.players, lastMeId, lastGame);
    const fromCenters = collectDispatchFromCenters(false, face, 1);
    const fx = window.LasidaoFx;
    dispatchBusy = true;
    armDispatchBusyWatchdog();
    try {
      if (fx && typeof fx.playDispatch === 'function') {
        await fx.playDispatch({
          face,
          count: 1,
          color,
          fromCenters,
          area: selectedTarget.area,
          number: selectedTarget.number,
        });
      }
      if (fx && typeof fx.clearLayer === 'function') fx.clearLayer();
      netRef.sendAction('mercenaryPlace', {
        index: idx,
        skip: false,
        area: selectedTarget.area,
      });
      resetDiceSelection();
      mercenaryRollAnimDoneKey = null;
    } finally {
      dispatchBusy = false;
      if (dispatchBusyWatchdog) {
        clearTimeout(dispatchBusyWatchdog);
        dispatchBusyWatchdog = null;
      }
      flushDeferredHeavyRender();
      if (lastGame && isSettlePipelinePhase(lastGame.phase)) {
        maybePlaySettle(lastGame);
      }
    }
  }

  function confirmMercenarySkip() {
    if (!netRef || !lastGame) return;
    if (!isMercenaryPlaceMode(lastGame, lastMeId)) return;
    const merc = lastGame.mercenary;
    const idx = mercenaryDieIndexForSkip(merc, selectedFace);
    if (idx < 0) return;
    netRef.sendAction('mercenaryPlace', { index: idx, skip: true });
    resetDiceSelection();
    mercenaryRollAnimDoneKey = null;
  }

  async function confirmDispatch() {
    if (isMercenaryPlaceMode(lastGame, lastMeId)) {
      return confirmMercenaryPlace();
    }
    if (!netRef || !selectedTarget || dispatchBusy) return;
    const remote = lastGame && isRemoteMode(lastGame);
    if (remote) {
      if (!selectedWildCount || selectedFace == null) return;
      const payload = {
        face: selectedFace,
        count: selectedWildCount,
      };
      if (selectedTarget.type === 'area') payload.area = selectedTarget.area;
      else payload.buildingId = selectedTarget.buildingId;
      netRef.sendAction('placeDice', payload);
      resetDiceAnim();
      return;
    }
    if (selectedFace == null) return;
    const payload = { face: selectedFace };
    if (selectedTarget.type === 'area') {
      payload.area = selectedTarget.area;
    } else {
      payload.buildingId = selectedTarget.buildingId;
    }
    netRef.sendAction('placeDice', payload);
    resetDiceAnim();
  }

  function decorateRulesCards(modal) {
    if (!modal) return;
    const Assets = window.LasidaoAssets;
    if (!Assets || typeof Assets.ruleCardImageUrl !== 'function') return;

    modal.querySelectorAll('[data-las-card], [data-las-cards]').forEach((el) => {
      if (el.querySelector('.las-rules-card-thumbs')) return;
      const specs = [];
      const multi = el.getAttribute('data-las-cards');
      const single = el.getAttribute('data-las-card');
      if (multi) specs.push(...multi.trim().split(/\s+/).filter(Boolean));
      else if (single) specs.push(single);

      const wrap = document.createElement('span');
      wrap.className = 'las-rules-card-thumbs';
      for (const spec of specs) {
        const url = Assets.ruleCardImageUrl(spec);
        if (!url) continue;
        const thumb = document.createElement('span');
        thumb.className = 'las-rules-card-thumb';
        thumb.style.backgroundImage = 'url("' + url + '")';
        thumb.setAttribute('role', 'img');
        bindImageTip(thumb, url, '');
        wrap.appendChild(thumb);
      }
      if (!wrap.children.length) return;
      el.classList.add('las-rules-dt-has-card');
      el.insertBefore(wrap, el.firstChild);
    });
  }

  function setRulesModalOpen(open) {
    const modal = $('las-rules-modal');
    if (!modal) return;
    if (!open) {
      modal.hidden = true;
      hideCardTip();
      return;
    }
    // 房间等待页时对局面板是 hidden，挂到 body 才能显示
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    modal.hidden = false;
    if (window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(modal);
    }
    decorateRulesCards(modal);
  }

  function setPermanentModalOpen(open) {
    const modal = $('las-permanent-modal');
    if (!modal) return;
    if (!open) {
      modal.hidden = true;
      hideCardTip();
      return;
    }
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    modal.hidden = false;
    if (window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(modal);
    }
  }

  function setSpecialDeckModalOpen(open) {
    const modal = $('las-special-deck-modal');
    if (!modal) return;
    if (!open) {
      modal.hidden = true;
      hideCardTip();
      return;
    }
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    modal.hidden = false;
    if (window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(modal);
    }
    decorateRulesCards(modal);
  }

  function setResourceDeckModalOpen(open) {
    const modal = $('las-resource-deck-modal');
    if (!modal) return;
    if (!open) {
      modal.hidden = true;
      hideCardTip();
      return;
    }
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    modal.hidden = false;
    if (window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(modal);
    }
    decorateRulesCards(modal);
  }

  function setEventDeckModalOpen(open) {
    const modal = $('las-event-deck-modal');
    if (!modal) return;
    if (!open) {
      modal.hidden = true;
      hideCardTip();
      return;
    }
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    modal.hidden = false;
    if (window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(modal);
    }
    decorateRulesCards(modal);
  }

  function resetTradeProposeSelection() {
    tradeGive = emptyTradeCounts();
    tradeTake = emptyTradeCounts();
  }

  function setTradeProposeModalOpen(open) {
    const modal = $('las-trade-propose-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (open) {
      renderTradeProposeModal();
      if (window.I18n && window.I18n.applyDom) {
        window.I18n.applyDom(modal);
      }
    } else {
      tradeTargetId = null;
      resetTradeProposeSelection();
    }
  }

  function listTradeTargets(game, meId) {
    return (game.players || []).filter((p) =>
      canProposePlayerTrade(game, meId, p.id)
    );
  }

  function openTradeFromPermanent() {
    if (!lastGame || !lastMeId) return;
    const targets = listTradeTargets(lastGame, lastMeId);
    if (!targets.length) return;
    resetTradeProposeSelection();
    tradeTargetId = null;
    setTradeProposeModalOpen(true);
  }

  function setTradeDecisionModalOpen(open) {
    const modal = $('las-trade-decision-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (open && window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(modal);
    }
  }

  function fillTradeCardRow(rowEl, amounts) {
    if (!rowEl) return;
    rowEl.innerHTML = '';
    const Assets = window.LasidaoAssets;
    let any = false;
    for (const r of RESOURCES) {
      const n = Number(amounts && amounts[r]) || 0;
      if (n <= 0) continue;
      any = true;
      const face = document.createElement('div');
      face.className = 'las-trade-face';
      const url =
        Assets && Assets.resourceHandImageUrl
          ? Assets.resourceHandImageUrl(r)
          : '';
      if (url) face.style.backgroundImage = 'url("' + url + '")';
      const count = document.createElement('span');
      count.className = 'las-trade-face-count';
      count.textContent = '×' + n;
      face.appendChild(count);
      rowEl.appendChild(face);
    }
    if (!any) {
      const empty = document.createElement('span');
      empty.className = 'las-trade-empty';
      empty.textContent = t('lasidao.tradeNone');
      rowEl.appendChild(empty);
    }
  }

  function renderTradeDecisionModal(trade) {
    if (!trade) return;
    const fromEl = $('las-trade-decision-from');
    if (fromEl) {
      fromEl.textContent = t('lasidao.tradeFromPlayer', {
        name: trade.fromName || '?',
      });
    }
    // 对目标：交出 = 发起方要拿走的 take；获得 = 发起方给出的 give
    fillTradeCardRow($('las-trade-decision-give'), trade.take);
    fillTradeCardRow($('las-trade-decision-receive'), trade.give);
    const me = lastGame && mePlayer(lastGame, lastMeId);
    const acceptBtn = $('btn-las-trade-accept');
    if (acceptBtn) {
      const canPay = Boolean(me) &&
        RESOURCES.every(
          (r) => (me.resources[r] || 0) >= (Number(trade.take && trade.take[r]) || 0)
        );
      acceptBtn.disabled = !canPay;
      acceptBtn.title = canPay
        ? ''
        : t('lasidao.tradeAcceptLack');
    }
  }

  function renderTradeProposeModal() {
    const game = lastGame;
    const me = game && mePlayer(game, lastMeId);
    if (!me || !game) return;
    const targets = listTradeTargets(game, lastMeId);
    if (
      tradeTargetId &&
      !targets.some((p) => p.id === tradeTargetId)
    ) {
      tradeTargetId = null;
    }
    const target =
      tradeTargetId &&
      (game.players || []).find((p) => p.id === tradeTargetId);
    const targetRow = $('las-trade-target-row');
    const targetList = $('las-trade-target-list');
    if (targetRow && targetList) {
      targetRow.hidden = false;
      targetList.innerHTML = '';
      if (!targets.length) {
        const empty = document.createElement('span');
        empty.className = 'muted';
        empty.textContent = t('lasidao.tradeNoTarget');
        targetList.appendChild(empty);
      } else {
        for (const p of targets) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className =
            'las-trade-target-chip' +
            (p.id === tradeTargetId ? ' is-selected' : '');
          chip.textContent = p.name || p.id;
          chip.onclick = () => {
            if (tradeTargetId === p.id) return;
            tradeTargetId = p.id;
            resetTradeProposeSelection();
            renderTradeProposeModal();
          };
          targetList.appendChild(chip);
        }
      }
    }
    const labels = getResLabels(game);
    const Assets = window.LasidaoAssets;
    const hint = $('las-trade-propose-hint');
    if (hint) {
      hint.textContent = target
        ? t('lasidao.tradeProposeHint', { name: target.name || '?' })
        : t('lasidao.tradePickTarget');
    }
    if (!target) {
      const giveList = $('las-trade-give-list');
      const takeList = $('las-trade-take-list');
      if (giveList) giveList.innerHTML = '';
      if (takeList) takeList.innerHTML = '';
      const confirmBtn = $('btn-las-trade-propose-confirm');
      if (confirmBtn) confirmBtn.disabled = true;
      return;
    }

    function renderSide(listId, side) {
      const list = $(listId);
      if (!list) return;
      list.innerHTML = '';
      const counts = side === 'give' ? tradeGive : tradeTake;
      const unlimited = side === 'take';
      const bag = me.resources || {};
      for (const r of RESOURCES) {
        const qty = Number(bag[r]) || 0;
        const item = document.createElement('div');
        item.className = 'las-ex-item';
        item.dataset.res = r;

        const row = document.createElement('div');
        row.className = 'las-ex-item-row';

        const minus = document.createElement('button');
        minus.type = 'button';
        minus.className = 'las-ex-minus';
        minus.textContent = '−';
        minus.disabled = (counts[r] || 0) <= 0;
        minus.onclick = () => {
          if ((counts[r] || 0) <= 0) return;
          counts[r] = (counts[r] || 0) - 1;
          renderTradeProposeModal();
        };

        const cardEl = document.createElement('div');
        cardEl.className = 'las-ex-card';
        const url =
          Assets && Assets.resourceHandImageUrl
            ? Assets.resourceHandImageUrl(r)
            : '';
        if (url) cardEl.style.backgroundImage = 'url("' + url + '")';

        const countSpan = document.createElement('span');
        countSpan.className = 'las-ex-count';
        countSpan.textContent = String(counts[r] || 0);
        cardEl.appendChild(countSpan);

        const plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'las-ex-plus';
        plus.textContent = '+';
        if (unlimited) {
          plus.disabled = false;
          plus.onclick = () => {
            counts[r] = (counts[r] || 0) + 1;
            renderTradeProposeModal();
          };
        } else {
          plus.disabled = (counts[r] || 0) >= qty;
          plus.onclick = () => {
            if ((counts[r] || 0) >= qty) return;
            counts[r] = (counts[r] || 0) + 1;
            renderTradeProposeModal();
          };
        }

        const label = document.createElement('div');
        label.className = 'las-ex-label';
        label.textContent = unlimited
          ? labels[r] || r
          : (labels[r] || r) + ' ×' + qty;

        if ((counts[r] || 0) > 0) item.classList.add('is-active');

        row.appendChild(minus);
        row.appendChild(cardEl);
        row.appendChild(plus);
        item.appendChild(row);
        item.appendChild(label);
        list.appendChild(item);
      }
    }

    renderSide('las-trade-give-list', 'give');
    renderSide('las-trade-take-list', 'take');

    const confirmBtn = $('btn-las-trade-propose-confirm');
    if (confirmBtn) {
      const total = sumTradeCounts(tradeGive) + sumTradeCounts(tradeTake);
      const giveOk = RESOURCES.every(
        (r) => (me.resources[r] || 0) >= (tradeGive[r] || 0)
      );
      confirmBtn.disabled = total <= 0 || !giveOk;
    }
  }

  function syncTradeModals(game, meId) {
    const trade = game && game.pendingTrade;
    const proposeModal = $('las-trade-propose-modal');
    const decisionModal = $('las-trade-decision-modal');

    if (trade && trade.forMe) {
      if (proposeModal && !proposeModal.hidden) {
        setTradeProposeModalOpen(false);
      }
      renderTradeDecisionModal(trade);
      setTradeDecisionModalOpen(true);
      return;
    }

    if (decisionModal && !decisionModal.hidden) {
      setTradeDecisionModalOpen(false);
    }

    if (trade && proposeModal && !proposeModal.hidden) {
      setTradeProposeModalOpen(false);
    }

    if (
      proposeModal &&
      !proposeModal.hidden &&
      tradeTargetId &&
      !canProposePlayerTrade(game, meId, tradeTargetId)
    ) {
      setTradeProposeModalOpen(false);
    } else if (proposeModal && !proposeModal.hidden) {
      renderTradeProposeModal();
    }
  }

  function resetExchangeSelection() {
    exFromBatches = { wood: 0, stone: 0, food: 0, iron: 0 };
    exToBatches = { wood: 0, stone: 0, food: 0, iron: 0 };
  }

  function setExchangeModalOpen(open) {
    const modal = $('las-exchange-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (open) {
      resetExchangeSelection();
      renderExchangeModal();
      if (window.I18n && window.I18n.applyDom) {
        window.I18n.applyDom(modal);
      }
    } else {
      resetExchangeSelection();
    }
  }

  function setRobberyModalOpen(open) {
    const modal = $('las-robbery-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (!open) {
      robberyCardId = null;
      robberyTargets = [null, null];
      robberyPickStep = 0;
    } else if (window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(modal);
    }
  }

  function setIllegalBuildModalOpen(open) {
    const modal = $('las-illegal-build-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (!open) {
      illegalBuildCardId = null;
    } else if (window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(modal);
    }
  }

  function syncIllegalBuildUi(game, meId) {
    if (game && game.pendingIllegalBuild && game.pendingIllegalBuild.forMe) {
      setIllegalBuildModalOpen(true);
      renderIllegalBuildModal(game, null, 'building');
    }
  }

  function renderIllegalBuildModal(game, card, mode) {
    const title = $('las-illegal-build-title');
    const body = $('las-illegal-build-body');
    if (!title || !body) return;
    body.innerHTML = '';

    if (mode === 'building') {
      title.textContent = t('lasidao.illegalBuildPickBuildingTitle');
      const me = mePlayer(game, lastMeId);
      const built = (me && me.buildings ? me.buildings : []).filter(
        (b) => b.built
      );
      if (!built.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = t('lasidao.illegalBuildNoBuilt');
        body.appendChild(empty);
        return;
      }
      const grid = document.createElement('div');
      grid.className = 'las-robbery-players';
      for (const b of built) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'las-card build';
        if (!decorateHandCardArt(btn, b, 'building')) {
          btn.textContent = b.label || '?';
        }
        if (b.score) {
          btn.title = t('lasidao.illegalBuildScoreLoss', { score: b.score });
        }
        btn.onclick = () => {
          if (!netRef) return;
          netRef.sendAction('illegalBuildPick', { buildingId: b.id });
          selectedBuildingId = null;
          setIllegalBuildModalOpen(false);
        };
        grid.appendChild(btn);
      }
      body.appendChild(grid);
      return;
    }

    title.textContent = t('lasidao.illegalBuildPickTarget');
    const players = (game && game.players) || [];
    const eligible = players.filter(
      (p) => !p.left && countBuiltBuildingsUi(p) > 0
    );
    if (!eligible.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = t('lasidao.illegalBuildNoTarget');
      body.appendChild(empty);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'las-robbery-players';
    for (const p of eligible) {
      const canPick = countBuiltBuildingsUi(p) > 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = p.name || '?';
      btn.disabled = !canPick;
      if (!canPick) {
        btn.classList.add('is-disabled');
        btn.title = t('lasidao.illegalBuildNoBuilt');
      } else {
        btn.onclick = () => {
          if (!netRef || !illegalBuildCardId) return;
          netRef.sendAction('useFunc', {
            cardId: illegalBuildCardId,
            targetId: p.id,
          });
          selectedFuncId = null;
          setIllegalBuildModalOpen(false);
        };
      }
      wrap.appendChild(btn);
    }
    body.appendChild(wrap);
  }

  function updateSpecialDeckTopArt(game) {
    const el = $('las-deck-stack-special');
    const topLabel = $('las-deck-special-top');
    const Assets = window.LasidaoAssets;
    const topKind = game && game.specialDeckTopKind;
    const kindName =
      topKind === 'building'
        ? t('lasidao.deckBuilding')
        : topKind === 'function'
          ? t('lasidao.deckFunction')
          : t('lasidao.redrawTopUnknown');
    if (topLabel) {
      topLabel.textContent = topKind
        ? t('lasidao.deckTopKind', { name: kindName })
        : t('lasidao.deckTopEmpty');
    }
    if (!el || !Assets || !Assets.cardBackImageUrl) return;
    const backKind = topKind === 'building' ? 'building' : 'function';
    const url = Assets.cardBackImageUrl(backKind);
    if (url) {
      el.style.backgroundImage = 'url("' + url + '")';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.backgroundRepeat = 'no-repeat';
    }
    el.classList.toggle('is-top-building', topKind === 'building');
    el.classList.toggle('is-top-function', topKind === 'function');
  }

  function setRedrawModalOpen(open) {
    const modal = $('las-redraw-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (!open) {
      redrawCardId = null;
    } else {
      if (window.I18n && window.I18n.applyDom) {
        window.I18n.applyDom(modal);
      }
      renderRedrawModal();
    }
  }

  function syncRedrawUi(game, meId) {
    if (game && game.pendingRedrawChoice && game.pendingRedrawChoice.forMe) {
      setRedrawModalOpen(true);
      renderRedrawModal(game);
    }
  }

  function renderRedrawModal(gameParam) {
    const game = gameParam || lastGame;
    const hint = $('las-redraw-hint');
    const confirmBtn = $('btn-las-redraw-confirm');
    const cancelBtn = $('btn-las-redraw-cancel');
    const title = $('las-redraw-title');
    const body = $('las-redraw-body');
    const pending = game && game.pendingRedrawChoice;
    const pickMode = Boolean(pending && pending.forMe);
    const Assets = window.LasidaoAssets;

    if (title) {
      const isBuy = pending && pending.source === 'buyFunc';
      title.textContent = pickMode
        ? isBuy
          ? t('lasidao.buyFuncPickKeep')
          : t('lasidao.redrawPickKeep')
        : t('lasidao.redrawPickDeck');
    }

    if (pickMode) {
      if (hint) {
        hint.textContent =
          pending.source === 'buyFunc'
            ? t('lasidao.buyFuncPickHint')
            : t('lasidao.redrawPickHint');
      }
      if (confirmBtn) confirmBtn.hidden = true;
      if (cancelBtn) cancelBtn.hidden = true;
      if (!body) return;
      body.innerHTML = '';
      const decks = document.createElement('div');
      decks.className = 'las-redraw-decks';
      for (const card of pending.options || []) {
        const btn = document.createElement('button');
        btn.type = 'button';
        const areaKey =
          card.buildType || card.kind === 'building' ? 'building' : 'function';
        btn.className =
          'las-card ' + (areaKey === 'building' ? 'build' : 'func');
        if (!decorateHandCardArt(btn, card, areaKey)) {
          btn.textContent = card.label || '?';
        }
        btn.onclick = () => {
          if (!netRef) return;
          netRef.sendAction('redrawPick', { keepId: card.id });
          setRedrawModalOpen(false);
          selectedFuncId = null;
        };
        decks.appendChild(btn);
      }
      body.appendChild(decks);
      return;
    }

    if (confirmBtn) confirmBtn.hidden = false;
    if (cancelBtn) cancelBtn.hidden = false;
    const topKind = game && game.specialDeckTopKind;
    const kindName =
      topKind === 'building'
        ? t('lasidao.deckBuilding')
        : topKind === 'function'
          ? t('lasidao.deckFunction')
          : t('lasidao.redrawTopUnknown');
    if (hint) {
      hint.textContent =
        (game && game.decksLeft && game.decksLeft.special) ||
        (game && game.discardsLeft && game.discardsLeft.special)
          ? t('lasidao.redrawHintDraw')
          : t('lasidao.redrawHintEmpty');
    }
    if (!body) return;
    body.innerHTML = '';
    const preview = document.createElement('div');
    preview.className = 'las-redraw-preview';
    const backEl = document.createElement('div');
    backEl.className = 'las-redraw-deck-back';
    const labelEl = document.createElement('span');
    labelEl.textContent = kindName;
    if (Assets && Assets.cardBackImageUrl) {
      const backKind = topKind === 'building' ? 'building' : 'function';
      const url = Assets.cardBackImageUrl(backKind);
      if (url) {
        backEl.style.backgroundImage = 'url("' + url + '")';
        backEl.style.backgroundSize = 'cover';
        backEl.style.backgroundPosition = 'center';
      }
    }
    preview.appendChild(backEl);
    preview.appendChild(labelEl);
    body.appendChild(preview);
    if (confirmBtn) {
      const left =
        (game && game.decksLeft && game.decksLeft.special) || 0;
      const disc =
        (game && game.discardsLeft && game.discardsLeft.special) || 0;
      confirmBtn.disabled = left + disc < 2;
    }
  }

  function expandCostPayload(game) {
    const c =
      (game && game.me && game.me.expandPermanentCost) ||
      { wood: 1, stone: 1, food: 1, iron: 1 };
    return {
      wood: c.wood,
      stone: c.stone,
      food: c.food,
      iron: c.iron,
      n: (game && game.me && game.me.expandCount) || 0,
    };
  }

  function breedCostPayload(game, me) {
    const rate =
      game && game.breedFoodPerVillager != null
        ? game.breedFoodPerVillager
        : game && game.breedFoodPerHouse != null
          ? game.breedFoodPerHouse
          : 1;
    const houses =
      me && me.houses != null
        ? me.houses
        : game && game.me && game.me.houses != null
          ? game.me.houses
          : 0;
    const villagers = (me && me.villagers) || 0;
    const need = villagers * rate;
    const perHouse =
      game && game.villagersPerHouse != null ? game.villagersPerHouse : 2;
    const capacity = houses * perHouse;
    const free =
      me && me.freeHouses != null
        ? me.freeHouses
        : Math.max(0, capacity - villagers);
    const have = (me && me.resources && me.resources.food) || 0;
    return { rate, houses, villagers, need, capacity, free, have };
  }

  function setExpandModalOpen(open) {
    const modal = $('las-expand-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (!open) {
      expandCardId = null;
      expandDirection = null;
      document.querySelectorAll('.las-expand-option').forEach((el) => {
        el.classList.remove('is-selected');
      });
    } else {
      expandDirection = null;
      document.querySelectorAll('.las-expand-option').forEach((el) => {
        el.classList.remove('is-selected');
      });
      if (window.I18n && window.I18n.applyDom) {
        window.I18n.applyDom(modal);
      }
      const Assets = window.LasidaoAssets;
      if (Assets && Assets.cardBackImageUrl) {
        document.querySelectorAll('.las-expand-option').forEach((el) => {
          const back = el.querySelector('.las-expand-back');
          if (!back) return;
          const dir = el.dataset.direction;
          const kind = dir === 'building' ? 'building' : dir === 'resource' ? 'resource' : 'function';
          const url = Assets.cardBackImageUrl(kind);
          if (url) {
            back.style.backgroundImage = 'url("' + url + '")';
            back.style.backgroundSize = 'cover';
            back.style.backgroundPosition = 'center';
          }
        });
      }
      renderExpandModal();
    }
  }

  function renderExpandModal() {
    const hint = $('las-expand-hint');
    const confirmBtn = $('btn-las-expand-confirm');
    if (confirmBtn) confirmBtn.disabled = !expandDirection;
    if (!hint) return;
    if (!expandDirection) {
      hint.textContent = '';
      return;
    }
    const name =
      expandDirection === 'function'
        ? t('lasidao.expandFunction')
        : expandDirection === 'resource'
          ? t('lasidao.expandResource')
          : t('lasidao.expandBuilding');
    hint.textContent = t('lasidao.expandHint', { name });
  }

  function setBanditModalOpen(open) {
    const modal = $('las-bandit-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (!open) {
      banditCardId = null;
      banditArea = null;
      banditNumber = null;
    }
  }

  function tilesOnNumberClient(areaBoard, num) {
    if (!areaBoard) return [];
    if (areaBoard.tiles && areaBoard.tiles.length) {
      return areaBoard.tiles.filter((t) => t.number === num);
    }
    const slot = (areaBoard.slots || []).find((s) => s.number === num);
    return slot ? (slot.tiles || []) : [];
  }

  function banditSlotsWithTiles(game) {
    const results = [];
    for (const area of EXILE_AREAS) {
      const ab = game.board && game.board[area];
      if (!ab) continue;
      for (let num = 1; num <= 6; num++) {
        const tiles = tilesOnNumberClient(ab, num);
        if (tiles.length > 0) results.push({ area, number: num });
      }
    }
    return results;
  }

  function renderBanditSlotStep(game) {
    const title = $('las-bandit-title');
    const body = $('las-bandit-body');
    const backBtn = $('btn-las-bandit-back');
    const confirmBtn = $('btn-las-bandit-confirm');
    if (!title || !body) return;

    title.textContent = t('lasidao.banditPickSlot');
    body.innerHTML = '';
    if (backBtn) backBtn.hidden = true;
    if (confirmBtn) confirmBtn.hidden = true;

    const slots = banditSlotsWithTiles(game);
    if (!slots.length) {
      const empty = document.createElement('p');
      empty.className = 'las-bandit-empty';
      empty.textContent = t('lasidao.banditNoSlot');
      body.appendChild(empty);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'las-bandit-slots';
    for (const s of slots) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'las-bandit-slot';
      const slotLabel = areaLabel(s.area) + ' ' + t('lasidao.slotNum', { n: s.number });
      btn.innerHTML = '<span class="slot-name">' + escapeHtml(slotLabel) + '</span>';
      btn.onclick = () => {
        banditArea = s.area;
        banditNumber = s.number;
        document.querySelectorAll('.las-bandit-slot').forEach((el) => el.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        renderBanditConfirmStep(game);
      };
      grid.appendChild(btn);
    }
    body.appendChild(grid);
  }

  function renderBanditConfirmStep(game) {
    const title = $('las-bandit-title');
    const body = $('las-bandit-body');
    const backBtn = $('btn-las-bandit-back');
    const confirmBtn = $('btn-las-bandit-confirm');
    if (!title || !body || !banditArea || !banditNumber) return;

    const slotLabel = areaLabel(banditArea) + ' ' + t('lasidao.slotNum', { n: banditNumber });
    title.textContent = t('lasidao.banditHint', { slot: slotLabel });
    body.innerHTML = '';

    if (backBtn) {
      backBtn.hidden = false;
      backBtn.onclick = () => renderBanditSlotStep(game);
    }
    if (confirmBtn) {
      confirmBtn.hidden = false;
      confirmBtn.onclick = () => {
        if (!netRef || !banditCardId) return;
        netRef.sendAction('useFunc', {
          cardId: banditCardId,
          area: banditArea,
          number: banditNumber,
        });
        selectedFuncId = null;
        setBanditModalOpen(false);
      };
    }
  }

  const EXILE_AREAS = ['resource', 'special'];

  function exilePlayerColor(players, playerId, game) {
    return playerDieColor(players, playerId, game);
  }

  function makeExilePlayerLabel(p, pid, count) {
    return (p ? p.name : pid) + (count != null ? ' ×' + count : '');
  }

  function decorateExilePlayerName(el, players, pid, game) {
    const color = exilePlayerColor(players, pid, game);
    el.classList.add('las-exile-worker-name', 'color-' + color);
    return color;
  }

  function makeExilePlayerButton(game, pid, count, onPick) {
    const p = (game.players || []).find((pl) => pl.id === pid);
    const btn = document.createElement('button');
    btn.type = 'button';
    const color = exilePlayerColor(game.players, pid, game);
    btn.className = 'las-exile-player color-' + color;
    const swatch = document.createElement('span');
    swatch.className = 'las-die-swatch color-' + color;
    swatch.setAttribute('aria-hidden', 'true');
    btn.appendChild(swatch);
    btn.appendChild(document.createTextNode(makeExilePlayerLabel(p, pid, count)));
    btn.onclick = onPick;
    return btn;
  }

  function setExileModalOpen(open) {
    const modal = $('las-exile-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (!open) {
      exileCardId = null;
      exileArea = null;
      exileNumber = null;
      exileTargetId = null;
      exileDieEnhanced = null;
    }
  }

  function occupiedSlots(game) {
    const result = [];
    for (const area of EXILE_AREAS) {
      const ab = game.board && game.board[area];
      if (!ab) continue;
      for (let num = 1; num <= 6; num++) {
        const w = ab.workers && ab.workers[num] ? ab.workers[num] : {};
        const entries = Object.entries(w).filter(([pid, c]) => c > 0 && pid !== '__neutral__');
        if (entries.length > 0) result.push({ area, number: num, workers: w, entries });
      }
    }
    return result;
  }

  function exileDestinationSlots(game, fromArea, fromNumber) {
    const result = [];
    for (const area of EXILE_AREAS) {
      const ab = game.board && game.board[area];
      if (!ab) continue;
      for (let num = 1; num <= 6; num++) {
        if (area === fromArea && num === fromNumber) continue;
        const tiles = tilesOnNumberClient(ab, num);
        if (!tiles.length) continue;
        result.push({ area, number: num });
      }
    }
    return result;
  }

  function renderExileSlotStep(game) {
    const title = $('las-exile-title');
    const body = $('las-exile-body');
    const backBtn = $('btn-las-exile-back');
    if (!title || !body) return;

    title.textContent = t('lasidao.exilePickSlot');
    body.innerHTML = '';
    if (backBtn) backBtn.hidden = true;
    exileTargetId = null;

    const slots = occupiedSlots(game);
    if (!slots.length) {
      const empty = document.createElement('p');
      empty.className = 'las-exile-empty';
      empty.textContent = t('lasidao.exileNoSlot');
      body.appendChild(empty);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'las-exile-slots';
    for (const s of slots) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'las-exile-slot';
      const slotLabel = areaLabel(s.area) + ' ' + t('lasidao.slotNum', { n: s.number });
      const nameEl = document.createElement('span');
      nameEl.className = 'slot-name';
      nameEl.textContent = slotLabel;
      const workersEl = document.createElement('span');
      workersEl.className = 'slot-workers';
      s.entries.forEach(([pid, c], idx) => {
        if (idx > 0) workersEl.appendChild(document.createTextNode('、'));
        const p = (game.players || []).find((pl) => pl.id === pid);
        const span = document.createElement('span');
        decorateExilePlayerName(span, game.players, pid, game);
        span.textContent = makeExilePlayerLabel(p, pid, c);
        workersEl.appendChild(span);
      });
      btn.appendChild(nameEl);
      btn.appendChild(workersEl);
      btn.onclick = () => {
        exileArea = s.area;
        exileNumber = s.number;
        exileTargetId = null;
        exileDieEnhanced = null;
        renderExilePlayerStep(game);
      };
      grid.appendChild(btn);
    }
    body.appendChild(grid);
  }

  function renderExilePlayerStep(game) {
    const title = $('las-exile-title');
    const body = $('las-exile-body');
    const backBtn = $('btn-las-exile-back');
    if (!title || !body || !exileArea || !exileNumber) return;

    const slotLabel = areaLabel(exileArea) + ' ' + t('lasidao.slotNum', { n: exileNumber });
    title.textContent = t('lasidao.exilePickPlayer', { slot: slotLabel });
    body.innerHTML = '';
    if (backBtn) {
      backBtn.hidden = false;
      backBtn.onclick = () => {
        exileArea = null;
        exileNumber = null;
        exileTargetId = null;
        exileDieEnhanced = null;
        renderExileSlotStep(game);
      };
    }

    const ab = game.board && game.board[exileArea];
    const w = ab && ab.workers && ab.workers[exileNumber] ? ab.workers[exileNumber] : {};
    const entries = Object.entries(w).filter(([pid, c]) => c > 0 && pid !== '__neutral__');

    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'las-exile-empty';
      empty.textContent = t('lasidao.exileNoPlayer');
      body.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'las-exile-players';
    for (const [pid, c] of entries) {
      wrap.appendChild(
        makeExilePlayerButton(game, pid, c, () => {
          exileTargetId = pid;
          const counts = slotPlayerDieCounts(game, exileArea, exileNumber, pid);
          if (counts.normal > 0 && counts.enhanced > 0) {
            exileDieEnhanced = null;
            renderExileDieStep(game);
          } else {
            exileDieEnhanced = counts.enhanced > 0;
            renderExileDestStep(game);
          }
        })
      );
    }
    body.appendChild(wrap);
  }

  function renderExileDieStep(game) {
    const title = $('las-exile-title');
    const body = $('las-exile-body');
    const backBtn = $('btn-las-exile-back');
    if (!title || !body || !exileArea || !exileNumber || !exileTargetId) return;

    const slotLabel =
      areaLabel(exileArea) + ' ' + t('lasidao.slotNum', { n: exileNumber });
    title.textContent = t('lasidao.exilePickDie', { slot: slotLabel });
    body.innerHTML = '';
    if (backBtn) {
      backBtn.hidden = false;
      backBtn.onclick = () => {
        exileTargetId = null;
        exileDieEnhanced = null;
        renderExilePlayerStep(game);
      };
    }

    const wrap = document.createElement('div');
    wrap.className = 'las-exile-die-pick';
    const grid = document.createElement('div');
    grid.className = 'las-recall-die-grid';
    const target = (game.players || []).find((p) => p.id === exileTargetId);
    const color = playerDieColor(game.players, exileTargetId, game);
    const face = exileNumber;

    function makePick(isBoosted) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'las-die-kind-pick';
      const die = makeDieEl(
        face,
        'is-mini' + (isBoosted ? ' is-boosted' : ''),
        color
      );
      const txt = document.createElement('span');
      txt.className = 'las-die-kind-label';
      txt.textContent = isBoosted
        ? t('lasidao.pickEnhancedDie')
        : t('lasidao.pickNormalDie');
      btn.appendChild(die);
      btn.appendChild(txt);
      btn.onclick = () => {
        exileDieEnhanced = isBoosted;
        renderExileDestStep(game);
      };
      grid.appendChild(btn);
    }

    makePick(false);
    makePick(true);
    wrap.appendChild(grid);
    if (target) {
      const hint = document.createElement('p');
      hint.className = 'las-exile-empty';
      hint.textContent = target.name;
      wrap.insertBefore(hint, grid);
    }
    body.appendChild(wrap);
  }

  function renderExileDestStep(game) {
    const title = $('las-exile-title');
    const body = $('las-exile-body');
    const backBtn = $('btn-las-exile-back');
    if (!title || !body || !exileArea || !exileNumber || !exileTargetId) return;

    const fromLabel =
      areaLabel(exileArea) + ' ' + t('lasidao.slotNum', { n: exileNumber });
    title.textContent = t('lasidao.exilePickDest', { slot: fromLabel });
    body.innerHTML = '';
    if (backBtn) {
      backBtn.hidden = false;
      backBtn.onclick = () => {
        const counts = slotPlayerDieCounts(
          game,
          exileArea,
          exileNumber,
          exileTargetId
        );
        if (counts.normal > 0 && counts.enhanced > 0) {
          exileDieEnhanced = null;
          renderExileDieStep(game);
        } else {
          exileTargetId = null;
          exileDieEnhanced = null;
          renderExilePlayerStep(game);
        }
      };
    }

    const slots = exileDestinationSlots(game, exileArea, exileNumber);
    if (!slots.length) {
      const empty = document.createElement('p');
      empty.className = 'las-exile-empty';
      empty.textContent = t('lasidao.exileNoDest');
      body.appendChild(empty);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'las-exile-slots';
    for (const s of slots) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'las-exile-slot';
      const nameEl = document.createElement('span');
      nameEl.className = 'slot-name';
      nameEl.textContent =
        areaLabel(s.area) + ' ' + t('lasidao.slotNum', { n: s.number });
      btn.appendChild(nameEl);
      btn.onclick = () => {
        if (!netRef || !exileCardId || !exileTargetId) return;
        if (typeof exileDieEnhanced !== 'boolean') return;
        netRef.sendAction('useFunc', {
          cardId: exileCardId,
          targetId: exileTargetId,
          area: exileArea,
          number: exileNumber,
          toArea: s.area,
          toNumber: s.number,
          enhanced: exileDieEnhanced,
        });
        selectedFuncId = null;
        setExileModalOpen(false);
      };
      grid.appendChild(btn);
    }
    body.appendChild(grid);
  }

  function voidSkipPayPickTotal() {
    return RESOURCES.reduce(
      (s, r) => s + (Number(voidSkipPayPick[r]) || 0),
      0
    );
  }

  function setVoidSkipModalOpen(open) {
    const modal = $('las-void-skip-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (open) {
      voidSkipMode = 'burn';
      voidSkipRes = null;
      voidSkipPayPick = emptyDiscardResPick();
      renderVoidSkipModal();
      if (window.I18n && window.I18n.applyDom) {
        window.I18n.applyDom(modal);
      }
    } else {
      voidSkipMode = 'burn';
      voidSkipRes = null;
      voidSkipPayPick = emptyDiscardResPick();
    }
  }

  function voidSkipOwnLabel(own) {
    const el = document.createElement('span');
    el.className = 'las-void-skip-qty-top';
    el.textContent = t('lasidao.eventPickResourceHandSingle', { n: own });
    return el;
  }

  function renderVoidSkipModal() {
    const body = $('las-void-skip-body');
    const confirmBtn = $('btn-las-void-skip-confirm');
    const hint = $('las-void-skip-hint');
    const game = lastGame;
    const me = mePlayer(game, lastMeId);
    if (!body) return;
    body.innerHTML = '';

    const modeRow = document.createElement('div');
    modeRow.className = 'las-void-skip-modes';
    const burnBtn = document.createElement('button');
    burnBtn.type = 'button';
    burnBtn.className =
      'las-void-skip-mode' + (voidSkipMode === 'burn' ? ' is-selected' : '');
    burnBtn.textContent = t('lasidao.voidSkipModeBurn');
    burnBtn.onclick = () => {
      voidSkipMode = 'burn';
      renderVoidSkipModal();
    };
    const payBtn = document.createElement('button');
    payBtn.type = 'button';
    const totalRes = me
      ? Object.values(me.resources || {}).reduce((a, b) => a + b, 0)
      : 0;
    const canPay = totalRes >= 2;
    payBtn.className =
      'las-void-skip-mode' +
      (voidSkipMode === 'pay' ? ' is-selected' : '') +
      (!canPay ? ' is-disabled' : '');
    payBtn.textContent = t('lasidao.voidSkipModePay');
    payBtn.disabled = !canPay;
    if (!canPay) {
      payBtn.title = t('lasidao.voidSkipPayLack');
    }
    payBtn.onclick = () => {
      if (!canPay) return;
      voidSkipMode = 'pay';
      voidSkipPayPick = emptyDiscardResPick();
      renderVoidSkipModal();
    };
    modeRow.appendChild(burnBtn);
    modeRow.appendChild(payBtn);
    body.appendChild(modeRow);

    if (hint) {
      hint.textContent =
        voidSkipMode === 'pay'
          ? t('lasidao.voidSkipHintPay')
          : t('lasidao.voidSkipHint');
    }

    const labels = getResLabels(game);
    const Assets = window.LasidaoAssets;

    const grid = document.createElement('div');
    grid.className = 'las-void-skip-grid';

    if (voidSkipMode === 'burn') {
      for (const res of RESOURCES) {
        const own = (me && me.resources && me.resources[res]) || 0;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'las-void-skip-item' + (voidSkipRes === res ? ' is-selected' : '');

        btn.appendChild(voidSkipOwnLabel(own));

        const cardEl = document.createElement('div');
        cardEl.className = 'las-void-skip-card';
        const url =
          Assets && Assets.resourceHandImageUrl
            ? Assets.resourceHandImageUrl(res)
            : '';
        if (url) cardEl.style.backgroundImage = 'url("' + url + '")';

        const label = document.createElement('span');
        label.className = 'las-void-skip-label';
        label.textContent = labels[res] || res;

        btn.appendChild(cardEl);
        btn.appendChild(label);
        btn.onclick = () => {
          voidSkipRes = res;
          renderVoidSkipModal();
        };
        grid.appendChild(btn);
      }
      body.appendChild(grid);
      if (confirmBtn) confirmBtn.disabled = !voidSkipRes;
      return;
    }

    const picked = voidSkipPayPickTotal();
    const sub = document.createElement('div');
    sub.className = 'muted las-void-skip-pay-tip';
    sub.textContent = t('lasidao.voidSkipPayTip', { picked, need: 2 });
    body.appendChild(sub);

    for (const res of RESOURCES) {
      const own = (me && me.resources && me.resources[res]) || 0;
      const sel = Number(voidSkipPayPick[res]) || 0;
      const isEmpty = own < 1;
      const canAdd = !isEmpty && picked < 2 && sel < own;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'las-void-skip-item' +
        (sel > 0 ? ' is-selected' : '') +
        (isEmpty ? ' is-empty' : '') +
        (isEmpty || !canAdd ? ' is-disabled' : '');

      btn.appendChild(voidSkipOwnLabel(own));

      const cardEl = document.createElement('div');
      cardEl.className = 'las-void-skip-card';
      const url =
        Assets && Assets.resourceHandImageUrl
          ? Assets.resourceHandImageUrl(res)
          : '';
      if (url) cardEl.style.backgroundImage = 'url("' + url + '")';

      const label = document.createElement('span');
      label.className = 'las-void-skip-label';
      label.textContent = labels[res] || res;

      if (sel > 0) {
        const pickBadge = document.createElement('span');
        pickBadge.className = 'las-discard-res-pick';
        pickBadge.textContent = '-' + sel;
        btn.appendChild(pickBadge);
      }

      btn.appendChild(cardEl);
      btn.appendChild(label);
      btn.disabled = isEmpty || !canAdd;
      btn.onclick = () => {
        if (!canAdd) return;
        voidSkipPayPick[res] = (voidSkipPayPick[res] || 0) + 1;
        renderVoidSkipModal();
      };
      grid.appendChild(btn);
    }
    body.appendChild(grid);

    const foot = document.createElement('div');
    foot.className = 'las-void-skip-foot las-void-skip-pay-foot';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'secondary';
    resetBtn.textContent = t('lasidao.voidSkipPayReset');
    resetBtn.onclick = () => {
      voidSkipPayPick = emptyDiscardResPick();
      renderVoidSkipModal();
    };
    foot.appendChild(resetBtn);
    body.appendChild(foot);

    if (confirmBtn) confirmBtn.disabled = picked !== 2;
  }

  function setHarvestModalOpen(open) {
    const modal = $('las-harvest-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (!open) {
      harvestCardId = null;
      harvestCounts = {};
      harvestMaxCount = 2;
      harvestSourceText = '';
      const harvestCancel = $('btn-las-harvest-cancel');
      if (harvestCancel) harvestCancel.hidden = false;
      const sourceEl = $('las-harvest-source');
      if (sourceEl) {
        sourceEl.textContent = '';
        sourceEl.hidden = true;
      }
    } else {
      if (window.I18n && window.I18n.applyDom) {
        window.I18n.applyDom(modal);
      }
    }
  }

  function formatHarvestPickTitle(need) {
    if (need === 1) return t('lasidao.harvestPickOne');
    return t('lasidao.harvestPickMany', { need });
  }

  function updateHarvestModalHead() {
    const sourceEl = $('las-harvest-source');
    const titleEl = $('las-harvest-title');
    if (sourceEl) {
      if (harvestSourceText) {
        sourceEl.textContent = t('lasidao.harvestSourceLabel', {
          source: harvestSourceText,
        });
        sourceEl.hidden = false;
      } else {
        sourceEl.textContent = '';
        sourceEl.hidden = true;
      }
    }
    if (titleEl) {
      titleEl.textContent = formatHarvestPickTitle(harvestMaxCount);
    }
  }

  function openHarvestModal(opts) {
    opts = opts || {};
    harvestCardId = opts.cardId || null;
    harvestSourceText = opts.source || '';
    harvestMaxCount = opts.maxCount || 2;
    harvestCounts = { wood: 0, stone: 0, food: 0, iron: 0 };
    setHarvestModalOpen(true);
    updateHarvestModalHead();
    renderHarvestModal();
  }

  function renderHarvestModal() {
    const body = $('las-harvest-body');
    if (!body) return;
    body.innerHTML = '';

    const me = mePlayer(lastGame, lastMeId);
    const handRes = me ? (me.resources || {}) : {};

    const grid = document.createElement('div');
    grid.className = 'las-harvest-grid';
    const Assets = window.LasidaoAssets;
    const labels = defaultResLabels();

    for (const res of RESOURCES) {
      const item = document.createElement('div');
      item.className = 'las-harvest-item';
      item.dataset.res = res;

      const handCount = handRes[res] || 0;
      const handRow = document.createElement('div');
      handRow.className = 'las-harvest-hand';
      handRow.textContent = t('lasidao.eventPickResourceHandSingle', { n: handCount });
      item.appendChild(handRow);

      const row = document.createElement('div');
      row.className = 'las-harvest-item-row';

      const minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'las-harvest-minus';
      minus.textContent = '−';
      minus.disabled = true;
      minus.onclick = () => {
        if ((harvestCounts[res] || 0) > 0) {
          harvestCounts[res] = (harvestCounts[res] || 0) - 1;
          updateHarvestTotal();
        }
      };

      const cardEl = document.createElement('div');
      cardEl.className = 'las-harvest-card';
      const url = Assets && Assets.resourceHandImageUrl ? Assets.resourceHandImageUrl(res) : '';
      if (url) cardEl.style.backgroundImage = 'url("' + url + '")';

      const countSpan = document.createElement('span');
      countSpan.className = 'las-harvest-count';
      countSpan.textContent = '0';
      cardEl.appendChild(countSpan);

      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'las-harvest-plus';
      plus.textContent = '+';
      plus.onclick = () => {
        const total = Object.values(harvestCounts).reduce((a, b) => a + b, 0);
        if (total < harvestMaxCount) {
          harvestCounts[res] = (harvestCounts[res] || 0) + 1;
          updateHarvestTotal();
        }
      };

      row.appendChild(minus);
      row.appendChild(cardEl);
      row.appendChild(plus);
      item.appendChild(row);

      const label = document.createElement('div');
      label.className = 'las-harvest-label';
      label.textContent = labels[res] || res;
      item.appendChild(label);

      grid.appendChild(item);
    }

    body.appendChild(grid);
    updateHarvestTotal();
  }

  function updateHarvestTotal() {
    const totalEl = $('las-harvest-total');
    const confirmBtn = $('btn-las-harvest-confirm');
    const total = Object.values(harvestCounts).reduce((a, b) => a + b, 0);
    if (totalEl) {
      totalEl.textContent = total + ' / ' + harvestMaxCount;
    }
    if (confirmBtn) {
      confirmBtn.disabled = total !== harvestMaxCount;
    }
    document.querySelectorAll('.las-harvest-item').forEach((item) => {
      const res = item.dataset.res;
      if (!res) return;
      const c = harvestCounts[res] || 0;
      const minus = item.querySelector('.las-harvest-minus');
      const plus = item.querySelector('.las-harvest-plus');
      const countSpan = item.querySelector('.las-harvest-count');
      if (minus) minus.disabled = c <= 0;
      if (plus) plus.disabled = total >= harvestMaxCount;
      if (countSpan) countSpan.textContent = String(c);
    });
  }

  function stealableHandCountForPlayer(p) {
    if (!p) return 0;
    if (p.stealableCount != null) return Number(p.stealableCount) || 0;
    let n = 0;
    const res = p.resources || {};
    for (const r of RESOURCES) n += Number(res[r]) || 0;
    return n;
  }

  function canPickRobberyTarget(p, step) {
    const count = stealableHandCountForPlayer(p);
    if (count <= 0) return false;
    if (
      step === 1 &&
      robberyTargets[0] === p.id &&
      count < 2
    ) {
      return false;
    }
    return true;
  }

  function renderRobberyModal(game, card) {
    const title = $('las-robbery-title');
    const body = $('las-robbery-body');
    const confirmBtn = $('btn-las-robbery-confirm');
    const cancelBtn = $('btn-las-robbery-cancel');
    if (!title || !body || !confirmBtn || !cancelBtn) return;

    body.innerHTML = '';
    cancelBtn.hidden = false;
    cancelBtn.textContent = t('lasidao.cancel');

    const players = (game.players || []).filter(
      (p) => !p.left && p.id !== lastMeId
    );

    if (robberyPickStep >= 2) {
      const t1 = players.find((p) => p.id === robberyTargets[0]);
      const t2 = players.find((p) => p.id === robberyTargets[1]);
      title.textContent = t('lasidao.robberyConfirmTitle');
      const hint = document.createElement('p');
      hint.className = 'muted las-hint';
      if (t1 && t2) {
        hint.textContent =
          robberyTargets[0] === robberyTargets[1]
            ? t('lasidao.robberySummarySame', { name: t1.name })
            : t('lasidao.robberySummary', { name1: t1.name, name2: t2.name });
      }
      body.appendChild(hint);
      confirmBtn.hidden = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = t('lasidao.confirmRobbery');
      return;
    }

    confirmBtn.hidden = true;
    confirmBtn.disabled = true;
    title.textContent =
      robberyPickStep === 0
        ? t('lasidao.robberyPickTarget1')
        : t('lasidao.robberyPickTarget2');

    if (!players.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = t('lasidao.robberyNoTarget');
      body.appendChild(empty);
      return;
    }

    const eligible = players.filter((p) => canPickRobberyTarget(p, robberyPickStep));
    if (!eligible.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = t('lasidao.robberyNoStealable');
      body.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'las-robbery-players';
    for (const p of players) {
      const canPick = canPickRobberyTarget(p, robberyPickStep);
      const btn = makeExilePlayerButton(game, p.id, null, () => {
        if (!canPick) return;
        robberyTargets[robberyPickStep] = p.id;
        robberyPickStep += 1;
        renderRobberyModal(game, card);
      });
      if (!canPick) {
        btn.disabled = true;
        btn.classList.add('is-disabled');
        btn.title = t('lasidao.robberyNoHand');
      }
      wrap.appendChild(btn);
    }
    body.appendChild(wrap);
  }

  function bindRedrawDeckClicks() {
    /* 合堆顶抽：无需选堆 */
  }


  function renderExchangeModal() {
    const game = lastGame;
    const me = game && mePlayer(game, lastMeId);
    if (!me) return;
    const exBuilt = (me.buildings || []).filter(
      (b) => b.built && b.buildType === 'exchange'
    ).length;
    const exCount =
      game.me && game.me.exchangeCount != null
        ? Number(game.me.exchangeCount)
        : Math.min(exBuilt, 2);
    const need =
      game.me && game.me.exchangeCost != null
        ? Number(game.me.exchangeCost)
        : exCount === 0
          ? 3
          : exCount === 1
            ? 2
            : 1;
    const labels = getResLabels(game);
    const Assets = window.LasidaoAssets;

    const rateHint = $('las-exchange-rate-hint');
    if (rateHint) {
      const caravan = Boolean(game.me && game.me.caravanPending);
      rateHint.textContent = caravan
        ? t('lasidao.exchangeCaravanHint', { n: need })
        : exCount === 0
          ? t('lasidao.exchangeHintDefault', { n: need })
          : t('lasidao.exchangeHint', { count: exCount, n: need });
    }

    function maxFromCards(res) {
      return (me.resources[res] || 0);
    }

    function renderSide(listId, isFrom) {
      const list = $(listId);
      if (!list) return;
      list.innerHTML = '';
      for (const r of RESOURCES) {
        const qty = me.resources[r] || 0;
        const item = document.createElement('div');
        item.className = 'las-ex-item';
        item.dataset.res = r;

        const row = document.createElement('div');
        row.className = 'las-ex-item-row';

        const minus = document.createElement('button');
        minus.type = 'button';
        minus.className = 'las-ex-minus';
        minus.textContent = '−';

        const cardEl = document.createElement('div');
        cardEl.className = 'las-ex-card';
        const url =
          Assets && Assets.resourceHandImageUrl
            ? Assets.resourceHandImageUrl(r)
            : '';
        if (url) cardEl.style.backgroundImage = 'url("' + url + '")';

        const countSpan = document.createElement('span');
        countSpan.className = 'las-ex-count';
        const batches = isFrom ? (exFromBatches[r] || 0) : (exToBatches[r] || 0);
        // 统一按“张数”显示
        countSpan.textContent = String(batches);
        cardEl.appendChild(countSpan);

        const plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'las-ex-plus';
        plus.textContent = '+';

        const label = document.createElement('div');
        label.className = 'las-ex-label';
        label.textContent = (labels[r] || r) + ' ×' + qty;

        if (isFrom) {
          minus.disabled = (exFromBatches[r] || 0) <= 0;
          minus.onclick = () => {
            if ((exFromBatches[r] || 0) <= 0) return;
            exFromBatches[r] = (exFromBatches[r] || 0) - 1;
            renderExchangeModal();
          };
          plus.disabled = maxFromCards(r) <= (exFromBatches[r] || 0);
          plus.onclick = () => {
            if ((exFromBatches[r] || 0) >= maxFromCards(r)) return;
            exFromBatches[r] = (exFromBatches[r] || 0) + 1;
            renderExchangeModal();
          };
          if ((exFromBatches[r] || 0) > 0) item.classList.add('is-active');
        } else {
          const totalFrom = RESOURCES.reduce((sum, res) => sum + (exFromBatches[res] || 0), 0);
          const totalTo = RESOURCES.reduce((sum, res) => sum + (exToBatches[res] || 0), 0);
          const maxTo = Math.floor(totalFrom / need);
          minus.disabled = (exToBatches[r] || 0) <= 0;
          minus.onclick = () => {
            if ((exToBatches[r] || 0) <= 0) return;
            exToBatches[r] = (exToBatches[r] || 0) - 1;
            renderExchangeModal();
          };
          plus.disabled = (exFromBatches[r] || 0) > 0 || totalTo >= maxTo;
          plus.onclick = () => {
            if ((exFromBatches[r] || 0) > 0) return;
            if (totalTo >= maxTo) return;
            exToBatches[r] = (exToBatches[r] || 0) + 1;
            renderExchangeModal();
          };
          if ((exToBatches[r] || 0) > 0) item.classList.add('is-active');
        }

        const disabled = isFrom
          ? maxFromCards(r) <= 0
          : (() => {
              const totalFrom = RESOURCES.reduce((sum, res) => sum + (exFromBatches[res] || 0), 0);
              if (totalFrom <= 0) return true;
              const maxTo = Math.floor(totalFrom / need);
              const totalTo = RESOURCES.reduce((sum, res) => sum + (exToBatches[res] || 0), 0);
              return totalTo >= maxTo || (exFromBatches[r] || 0) > 0;
            })();
        if (disabled) item.classList.add('is-card-disabled');

        row.appendChild(minus);
        row.appendChild(cardEl);
        row.appendChild(plus);
        item.appendChild(row);
        item.appendChild(label);
        list.appendChild(item);
      }
    }

    renderSide('las-ex-from-list', true);
    renderSide('las-ex-to-list', false);

    const confirmBtn = $('btn-las-exchange-confirm');
    const resetBtn = $('btn-las-exchange-reset');
    const totalFrom = RESOURCES.reduce((sum, r) => sum + (exFromBatches[r] || 0), 0);
    const totalTo = RESOURCES.reduce((sum, r) => sum + (exToBatches[r] || 0), 0);
    const noOverlap = RESOURCES.every(r => !(exFromBatches[r] > 0 && exToBatches[r] > 0));
    const hasEnough = RESOURCES.every(r => (me.resources[r] || 0) >= (exFromBatches[r] || 0));

    let ready = totalFrom > 0 && totalTo > 0 && noOverlap && hasEnough;
    let batchCount = 0;
    if (ready) {
      if (totalFrom % need !== 0) {
        ready = false;
      } else {
        batchCount = totalFrom / need;
        if (totalTo !== batchCount) ready = false;
      }
    }

    let targetReceive = 0;
    if (totalFrom > 0) {
      targetReceive = Math.floor(totalFrom / need);
    }

    if (confirmBtn) {
      confirmBtn.disabled = !ready;
      if (ready) {
        confirmBtn.textContent = t('lasidao.exchangeConfirm', {
          times: batchCount,
        });
      } else if (totalFrom > 0 || totalTo > 0) {
        confirmBtn.textContent = t('lasidao.exchangeNeedMatch', {
          left: targetReceive,
          right: totalTo,
        });
      } else {
        confirmBtn.textContent = t('lasidao.exchangeBtnN', { n: need });
      }
    }
    if (resetBtn) {
      const hasPick = totalFrom > 0 || totalTo > 0;
      resetBtn.disabled = !hasPick;
    }
  }

  function bindButtons(net) {
    netRef = net;
    installModalVisibilityToggles();
    // 绑定卡堆卡背（一次性）
    const Assets = window.LasidaoAssets;
    if (Assets && Assets.cardBackImageUrl) {
      const resEl = $('las-deck-stack-resource');
      const resUrl = Assets.cardBackImageUrl('resource');
      if (resEl && resUrl) {
        resEl.style.backgroundImage = 'url("' + resUrl + '")';
        resEl.style.backgroundSize = 'cover';
        resEl.style.backgroundPosition = 'center';
        resEl.style.backgroundRepeat = 'no-repeat';
      }
      const envEl = $('las-deck-stack-environment');
      const envUrl = Assets.cardBackImageUrl('environment');
      if (envEl && envUrl) {
        envEl.style.backgroundImage = 'url("' + envUrl + '")';
        envEl.style.backgroundSize = 'cover';
        envEl.style.backgroundPosition = 'center';
        envEl.style.backgroundRepeat = 'no-repeat';
      }
      if (lastGame) updateSpecialDeckTopArt(lastGame);
    }
    const specialDeckStack = $('las-deck-stack-special');
    if (specialDeckStack) {
      specialDeckStack.addEventListener('click', (e) => {
        e.stopPropagation();
        setSpecialDeckModalOpen(true);
      });
    }
    const resourceDeckStack = $('las-deck-stack-resource');
    if (resourceDeckStack) {
      resourceDeckStack.addEventListener('click', (e) => {
        e.stopPropagation();
        setResourceDeckModalOpen(true);
      });
    }
    const eventDeckStack = $('las-deck-stack-environment');
    if (eventDeckStack) {
      eventDeckStack.addEventListener('click', (e) => {
        e.stopPropagation();
        setEventDeckModalOpen(true);
      });
    }
    const actPermHelp = $('btn-las-act-permanent-help');
    if (actPermHelp) {
      actPermHelp.onclick = () => setPermanentModalOpen(true);
    }
    const skipSettleBtn = $('btn-las-skip-settle');
    if (skipSettleBtn) {
      skipSettleBtn.onclick = () => skipSettleAnim();
    }
    const buildPermHelp = $('btn-las-build-permanent-help');
    if (buildPermHelp) {
      buildPermHelp.onclick = () => setPermanentModalOpen(true);
    }
    const permClose = $('btn-las-permanent-close');
    if (permClose) {
      permClose.onclick = () => setPermanentModalOpen(false);
    }
    const permBackdrop = $('las-permanent-backdrop');
    if (permBackdrop) {
      permBackdrop.onclick = () => setPermanentModalOpen(false);
    }
    const spClose = $('btn-las-special-deck-close');
    if (spClose) {
      spClose.onclick = () => setSpecialDeckModalOpen(false);
    }
    const spBackdrop = $('las-special-deck-backdrop');
    if (spBackdrop) {
      spBackdrop.onclick = () => setSpecialDeckModalOpen(false);
    }
    const resClose = $('btn-las-resource-deck-close');
    if (resClose) {
      resClose.onclick = () => setResourceDeckModalOpen(false);
    }
    const resBackdrop = $('las-resource-deck-backdrop');
    if (resBackdrop) {
      resBackdrop.onclick = () => setResourceDeckModalOpen(false);
    }
    const evtClose = $('btn-las-event-deck-close');
    if (evtClose) {
      evtClose.onclick = () => setEventDeckModalOpen(false);
    }
    const evtBackdrop = $('las-event-deck-backdrop');
    if (evtBackdrop) {
      evtBackdrop.onclick = () => setEventDeckModalOpen(false);
    }
    const rulesClose = $('btn-las-rules-close');
    if (rulesClose) {
      rulesClose.onclick = () => setRulesModalOpen(false);
    }
    const rollBtn = $('btn-las-produce-roll');
    if (rollBtn) {
      rollBtn.onclick = () => {
        if (!net) return;
        clearAutoProduceRoll();
        if (lastGame && isMercenaryRollMode(lastGame, lastMeId)) {
          net.sendAction('mercenaryRoll', {});
          return;
        }
        net.sendAction('produceRoll', {});
      };
    }
    const remoteBtn = $('btn-las-remote-dice');
    const useRemoteDiceCard = () => {
      const me = lastGame && mePlayer(lastGame, lastMeId);
      const card =
        me &&
        (me.funcCards || []).find((c) => c.funcType === 'remoteDice');
      if (!card || !net) return;
      if (!canPlayFuncCard(lastGame, lastMeId, 'remoteDice')) return;
      clearAutoProduceRoll();
      net.sendAction('useFunc', { cardId: card.id });
    };
    if (remoteBtn) {
      remoteBtn.onclick = useRemoteDiceCard;
    }
    const remotePostBtn = $('btn-las-remote-dice-post');
    if (remotePostBtn) {
      remotePostBtn.onclick = useRemoteDiceCard;
    }
    const initBtn = $('btn-las-init-roll');
    if (initBtn) {
      initBtn.onclick = () => net.sendAction('initRoll', {});
    }
    const voidBtn = $('btn-las-void');
    if (voidBtn) {
      voidBtn.onclick = () => {
        if (lastGame && lastGame.phase === 'build') {
          if (!netRef) return;
          const me = mePlayer(lastGame, lastMeId);
          const { mustDiscard } = getBuildActionState(lastGame, me);
          if (mustDiscard) return;
          netRef.sendAction('pass', {});
          return;
        }
        if (isBanditPickMode(lastGame, lastMeId)) {
          banditCardId = null;
          selectedTarget = null;
          if (lastGame) {
            renderBoard(lastGame, lastMeId);
            renderDice(lastGame, lastMeId);
          }
          return;
        }
        if (isMercenaryPlaceMode(lastGame, lastMeId)) {
          confirmMercenarySkip();
          return;
        }
        setVoidSkipModalOpen(true);
      };
    }

    const voidSkipCancel = $('btn-las-void-skip-cancel');
    if (voidSkipCancel) {
      voidSkipCancel.onclick = () => setVoidSkipModalOpen(false);
    }
    const voidSkipConfirm = $('btn-las-void-skip-confirm');
    if (voidSkipConfirm) {
      voidSkipConfirm.onclick = () => {
        if (!netRef) return;
        if (voidSkipMode === 'pay') {
          if (voidSkipPayPickTotal() !== 2) return;
          resetDiceAnim();
          netRef.sendAction('voidSkip', {
            mode: 'pay',
            amounts: { ...voidSkipPayPick },
          });
        } else {
          if (!voidSkipRes) return;
          resetDiceAnim();
          netRef.sendAction('voidSkip', {
            mode: 'burn',
            resource: voidSkipRes,
          });
        }
        setVoidSkipModalOpen(false);
      };
    }
    const confirmBtn = $('btn-las-confirm');
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        if (lastGame && lastGame.phase === 'build') {
          confirmBuildHandSelection(
            lastGame,
            mePlayer(lastGame, lastMeId)
          );
          return;
        }
        if (isBarrenMarkerPickMode(lastGame, lastMeId)) {
          confirmBarrenMarkerPlace();
          return;
        }
        if (isNeutralPickMode(lastGame, lastMeId)) {
          confirmNeutralPlace();
          return;
        }
        if (isBanditPickMode(lastGame, lastMeId)) {
          confirmBanditPlace();
          return;
        }
        confirmDispatch();
      };
    }
    const victoryLeaveBtn = $('btn-las-victory-leave');
    if (victoryLeaveBtn) {
      victoryLeaveBtn.onclick = () => {
        if (typeof onLeaveLobbyRef === 'function') {
          onLeaveLobbyRef();
        }
      };
    }
    const buildHouseBtn = $('btn-las-build-house');
    if (buildHouseBtn) {
      buildHouseBtn.onclick = () => {
        const me = lastGame && mePlayer(lastGame, lastMeId);
        selectPermanent('buildHouse', lastGame, me);
      };
    }
    const buyFuncBtn = $('btn-las-buy-func');
    if (buyFuncBtn) {
      buyFuncBtn.onclick = () => {
        const me = lastGame && mePlayer(lastGame, lastMeId);
        selectPermanent('buyFunc', lastGame, me);
      };
    }
    const breedBtn = $('btn-las-breed');
    const expandPermBtn = $('btn-las-expand-perm');
    if (breedBtn) {
      breedBtn.onclick = () => {
        const me = lastGame && mePlayer(lastGame, lastMeId);
        selectPermanent('breed', lastGame, me);
      };
    }
    if (expandPermBtn) {
      expandPermBtn.onclick = () => {
        const me = lastGame && mePlayer(lastGame, lastMeId);
        selectPermanent('expand', lastGame, me);
      };
    }
    const exBtn = $('btn-las-exchange');
    if (exBtn) {
      exBtn.onclick = () => {
        const me = lastGame && mePlayer(lastGame, lastMeId);
        // 直接打开兑换窗口，无需底部确认按钮
        selectedPermanent = null;
        if (lastGame && me) {
          syncPermanentSelection(lastGame, me);
        }
        setExchangeModalOpen(true);
      };
    }
    const tradeBtn = $('btn-las-trade');
    if (tradeBtn) {
      tradeBtn.onclick = () => {
        selectedPermanent = null;
        if (lastGame) {
          const me = mePlayer(lastGame, lastMeId);
          if (me) syncPermanentSelection(lastGame, me);
        }
        openTradeFromPermanent();
      };
    }
    const resetBuildBtn = $('btn-las-reset-build');
    if (resetBuildBtn) {
      resetBuildBtn.onclick = () => net.sendAction('resetBuildTurn', {});
    }
    const exCancel = $('btn-las-exchange-cancel');
    if (exCancel) {
      exCancel.onclick = () => setExchangeModalOpen(false);
    }
    const exReset = $('btn-las-exchange-reset');
    if (exReset) {
      exReset.onclick = () => {
        resetExchangeSelection();
        renderExchangeModal();
      };
    }
    const exConfirm = $('btn-las-exchange-confirm');
    if (exConfirm) {
      exConfirm.onclick = () => {
        const m = lastGame && mePlayer(lastGame, lastMeId);
        if (!m) return;
        const exBuilt = (m.buildings || []).filter(
          (b) => b.built && b.buildType === 'exchange'
        ).length;
        const exCount =
          lastGame.me && lastGame.me.exchangeCount != null
            ? Number(lastGame.me.exchangeCount)
            : Math.min(exBuilt, 2);
        const need =
          lastGame.me && lastGame.me.exchangeCost != null
            ? Number(lastGame.me.exchangeCost)
            : exCount === 0
              ? 3
              : exCount === 1
                ? 2
                : 1;
        const totalFrom = RESOURCES.reduce((sum, r) => sum + (exFromBatches[r] || 0), 0);
        const totalTo = RESOURCES.reduce((sum, r) => sum + (exToBatches[r] || 0), 0);
        if (totalFrom <= 0 || totalTo <= 0) return;
        const noOverlap = RESOURCES.every(r => !(exFromBatches[r] > 0 && exToBatches[r] > 0));
        if (!noOverlap) return;
        const hasEnough = RESOURCES.every(r => (m.resources[r] || 0) >= (exFromBatches[r] || 0));
        if (!hasEnough) return;

        if (totalFrom % need !== 0) return;
        const batch = totalFrom / need;
        if (totalTo !== batch) return;

        net.sendAction('exchange', {
          from: { ...exFromBatches },
          to: { ...exToBatches },
        });
        setExchangeModalOpen(false);
      };
    }
    const tradeProposeCancel = $('btn-las-trade-propose-cancel');
    if (tradeProposeCancel) {
      tradeProposeCancel.onclick = () => setTradeProposeModalOpen(false);
    }
    const tradeProposeBackdrop = $('las-trade-propose-backdrop');
    if (tradeProposeBackdrop) {
      tradeProposeBackdrop.onclick = () => setTradeProposeModalOpen(false);
    }
    const tradeProposeReset = $('btn-las-trade-propose-reset');
    if (tradeProposeReset) {
      tradeProposeReset.onclick = () => {
        resetTradeProposeSelection();
        renderTradeProposeModal();
      };
    }
    const tradeProposeConfirm = $('btn-las-trade-propose-confirm');
    if (tradeProposeConfirm) {
      tradeProposeConfirm.onclick = () => {
        if (!netRef || !tradeTargetId) return;
        const total = sumTradeCounts(tradeGive) + sumTradeCounts(tradeTake);
        if (total <= 0) return;
        netRef.sendAction('proposeTrade', {
          targetId: tradeTargetId,
          give: { ...tradeGive },
          take: { ...tradeTake },
        });
        setTradeProposeModalOpen(false);
      };
    }
    const tradeAccept = $('btn-las-trade-accept');
    if (tradeAccept) {
      tradeAccept.onclick = () => {
        if (!netRef) return;
        netRef.sendAction('acceptTrade', {});
      };
    }
    const tradeReject = $('btn-las-trade-reject');
    if (tradeReject) {
      tradeReject.onclick = () => {
        if (!netRef) return;
        netRef.sendAction('rejectTrade', {});
      };
    }
    const wishReset = $('btn-las-wishwell-modal-reset');
    if (wishReset) {
      wishReset.onclick = () => {
        wishAlloc = { wood: 0, stone: 0, food: 0, iron: 0 };
        if (lastGame) syncWishWellModal(lastGame, lastMeId);
      };
    }
    const wishConfirm = $('btn-las-wishwell-modal-confirm');
    if (wishConfirm) {
      wishConfirm.onclick = () => {
        const need = wishAllocFor;
        if (sumWishAlloc() !== need) {
          alert(t('lasidao.wishWellNeedAll'));
          return;
        }
        net.sendAction('allocateWishWell', {
          alloc: {
            wood: wishAlloc.wood || 0,
            stone: wishAlloc.stone || 0,
            food: wishAlloc.food || 0,
            iron: wishAlloc.iron || 0,
          },
        });
      };
    }
    // Robbery modal bindings
    const robCancel = $('btn-las-robbery-cancel');
    if (robCancel) {
      robCancel.onclick = () => setRobberyModalOpen(false);
    }
    const robConfirm = $('btn-las-robbery-confirm');
    if (robConfirm) {
      robConfirm.onclick = () => {
        if (!robberyCardId || robberyPickStep < 2 || !netRef) return;
        if (!robberyTargets[0] || !robberyTargets[1]) return;
        net.sendAction('useFunc', {
          cardId: robberyCardId,
          targets: robberyTargets.slice(),
        });
        selectedFuncId = null;
        setRobberyModalOpen(false);
      };
    }

    const ibCancel = $('btn-las-illegal-build-cancel');
    if (ibCancel) {
      ibCancel.onclick = () => setIllegalBuildModalOpen(false);
    }

    // Redraw modal bindings
    const redrawCancel = $('btn-las-redraw-cancel');
    if (redrawCancel) {
      redrawCancel.onclick = () => setRedrawModalOpen(false);
    }
    const redrawConfirm = $('btn-las-redraw-confirm');
    if (redrawConfirm) {
      redrawConfirm.onclick = () => {
        if (!redrawCardId) return;
        net.sendAction('useFunc', {
          cardId: redrawCardId,
        });
        selectedFuncId = null;
      };
    }
    bindRedrawDeckClicks();

    // Harvest modal bindings
    const harvestCancel = $('btn-las-harvest-cancel');
    if (harvestCancel) {
      harvestCancel.onclick = () => setHarvestModalOpen(false);
    }
    const harvestConfirm = $('btn-las-harvest-confirm');
    if (harvestConfirm) {
      harvestConfirm.onclick = () => {
        const total = Object.values(harvestCounts).reduce((a, b) => a + b, 0);
        if (total !== harvestMaxCount) return;
        if (harvestCardId) {
          const resources = [];
          for (const res of RESOURCES) {
            const n = harvestCounts[res] || 0;
            for (let i = 0; i < n; i++) resources.push(res);
          }
          net.sendAction('useFunc', {
            cardId: harvestCardId,
            resources,
          });
          setHarvestModalOpen(false);
          selectedFuncId = null;
        } else if (harvestSourceText) {
          if (harvestMaxCount === 1) {
            for (const res of RESOURCES) {
              if ((harvestCounts[res] || 0) > 0) {
                netRef.sendAction('eventPickResource', { resource: res });
                break;
              }
            }
          } else {
            const amounts = {};
            for (const res of RESOURCES) {
              amounts[res] = harvestCounts[res] || 0;
            }
            netRef.sendAction('eventPickTwoResources', { amounts });
            eventTwoResPick = { wood: 0, stone: 0, food: 0, iron: 0 };
          }
          setHarvestModalOpen(false);
        }
      };
    }

    const settleDiscardConfirm = $('btn-las-settle-discard-confirm');
    if (settleDiscardConfirm) {
      settleDiscardConfirm.onclick = () => {
        if (!netRef || !lastGame) return;
        const me = mePlayer(lastGame, lastMeId);
        const kind = getSettleDiscardKind(lastGame, me);
        if (!me || !kind) return;
        if (kind === 'res') {
          const need = settleDiscardResNeed(lastGame, me);
          if (discardResPickTotal() !== need) return;
          netRef.sendAction('discardResources', {
            amounts: { ...discardResPick },
          });
          discardResPick = emptyDiscardResPick();
        } else if (kind === 'func') {
          if (!settleDiscardFuncId) return;
          netRef.sendAction('discardFunc', { cardId: settleDiscardFuncId });
          settleDiscardFuncId = null;
        } else if (kind === 'build') {
          if (!settleDiscardBuildPick) return;
          if (settleDiscardBuildPick === 'pending') {
            netRef.sendAction('discardPendingBuild', {});
          } else {
            netRef.sendAction('discardUnbuilt', {
              buildingId: settleDiscardBuildPick,
            });
          }
          settleDiscardBuildPick = null;
        }
      };
    }
    const settleDiscardReset = $('btn-las-settle-discard-reset');
    if (settleDiscardReset) {
      settleDiscardReset.onclick = () => {
        discardResPick = emptyDiscardResPick();
        if (lastGame && lastMeId) {
          const me = mePlayer(lastGame, lastMeId);
          renderSettleDiscardModal(lastGame, me);
        }
      };
    }

    // 扩建弹窗绑定
    const expandCancel = $('btn-las-expand-cancel');
    if (expandCancel) {
      expandCancel.onclick = () => setExpandModalOpen(false);
    }
    const expandConfirm = $('btn-las-expand-confirm');
    if (expandConfirm) {
      expandConfirm.onclick = () => {
        if (!expandDirection) return;
        if (expandCardId) {
          net.sendAction('useFunc', {
            cardId: expandCardId,
            direction: expandDirection,
          });
          selectedFuncId = null;
        } else {
          net.sendAction('expandPermanent', { direction: expandDirection });
        }
        setExpandModalOpen(false);
        if (lastGame && lastMeId) {
          renderBuildHand(lastGame, lastMeId);
          syncPermanentSelection(lastGame, mePlayer(lastGame, lastMeId));
        }
      };
    }
    document.querySelectorAll('.las-expand-option').forEach((el) => {
      el.onclick = () => {
        document.querySelectorAll('.las-expand-option').forEach((d) => d.classList.remove('is-selected'));
        el.classList.add('is-selected');
        expandDirection = el.dataset.direction;
        renderExpandModal();
      };
    });

    // Exile modal bindings
    const exileCancel = $('btn-las-exile-cancel');
    if (exileCancel) {
      exileCancel.onclick = () => setExileModalOpen(false);
    }

    // Bandit modal bindings
    const banditCancel = $('btn-las-bandit-cancel');
    if (banditCancel) {
      banditCancel.onclick = () => setBanditModalOpen(false);
    }

  }

  window.addEventListener('i18n:change', () => {
    document.querySelectorAll('.las-modal-vis-toggle').forEach((btn) => {
      btn.textContent = modalVisToggleLabel();
    });
    if (lastGame && netRef) {
      render(lastGame, netRef, { meId: lastMeId });
      if (window.I18n && window.I18n.applyDom) {
        window.I18n.applyDom(document.getElementById('panel-lasidao'));
      }
    }
  });

  return {
    render,
    hide,
    resetSession,
    bindButtons,
    onPlayReveal,
    appendGameLogLine,
    openRules: () => setRulesModalOpen(true),
    makeBoardSlotEmptyEl,
    replaceBoardTileWithEmpty,
  };
})();
