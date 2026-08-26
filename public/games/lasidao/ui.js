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

  function isExchangeOnlyBuildSlot(p, slot) {
    const on = buildingsOnBuildSlot(p, slot);
    return on.length > 0 && on.every((b) => b.buildType === 'exchange');
  }

  function nextFreeBuildSlotKey(p) {
    const used = occupiedBuildSlotKeys(p);
    for (const s of noneSlotKeysFor(p)) {
      if (!used.has(String(s))) return s;
    }
    return null;
  }

  function findExchangeStackSlotKey(p) {
    for (const slot of occupiedBuildSlotKeys(p)) {
      if (isExchangeOnlyBuildSlot(p, slot)) return slot;
    }
    return null;
  }

  /** 放置目标：集市优先叠到已有集市格，否则取空位 */
  function pickPlaceSlotForBuilding(p, building) {
    if (building && building.buildType === 'exchange') {
      const stack = findExchangeStackSlotKey(p);
      if (stack != null) return stack;
    }
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
    robbery: 'lasidao.func.robbery',
  };

  const PRODUCE_FUNC = new Set(['remoteDice', 'exile', 'banditRaid']);
  const BUILD_FUNC = new Set([
    'harvest',
    'robbery',
    'redraw',
    'expand',
    'enhance',
    'recruit',
  ]);

  function canPlayFuncCard(game, meId, funcType) {
    if (!game || !meId || !funcType) return false;
    if (!isMyTurn(game, meId)) return false;
    if (game.phase === 'produce') return PRODUCE_FUNC.has(funcType);
    if (game.phase === 'build') {
      const me = mePlayer(game, meId);
      if (me && me.buildPassed) return false;
      if (funcType === 'enhance') {
        const enh = Number(me && me.enhancedDice) || 0;
        const vil = Number(me && me.villagers) || 0;
        const maxEnh = Number(game && game.maxEnhancedDice) || 3;
        if (enh >= Math.min(vil, maxEnh)) return false;
      }
      return BUILD_FUNC.has(funcType);
    }
    return false;
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
    } else if (b.buildType === 'exchange') {
      effect = '无需工人，改善兑换比例';
    } else if (b.buildType === 'wishWell') {
      effect = '无需工人，生产阶段结束后可选任意资源+1';
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
  let lastGame = null;
  let lastMeId = null;

  let robberyCardId = null;
  let robberyTargetId = null;
  let redrawCardId = null;

  let voidSkipRes = null;
  let harvestCardId = null;
  let harvestCounts = {};

  let expandCardId = null;
  let expandDirection = null;

  let exileCardId = null;
  let exileArea = null;
  let exileNumber = null;

  let banditCardId = null;
  let banditArea = null;
  let banditNumber = null;

  /** 颗粒无收：点选要放置标记的资源数字格 */
  let barrenPickNumber = null;
  /** 以身入局：点选要放置中立骰的目标格 */
  let neutralPickArea = null;
  let neutralPickNumber = null;

  /** 弃牌阶段：待弃置的各资源数量 */
  let discardResPick = { wood: 0, stone: 0, food: 0, iron: 0 };

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
  let victoryModalKey = null;
  let victoryAnimPlaying = false;
  let onLeaveLobbyRef = null;
  let lastProduceFxKey = null;
  let produceFxPlaying = false;
  /** 对手派遣飞入动画期间冻结板块，避免工人先瞬移再动画 */
  let dispatchBoardFreeze = null;
  let knownBoardTiles = null; // Set of tile ids
  let pendingDealIds = new Set();
  let dealAnimPlaying = false;
  let dealtForRound = null; // ???????????
  /** 发牌动画期间冻结牌堆顶/张数，避免提前显示发牌后结果 */
  let dealDeckFreeze = null;
  let wishAlloc = { wood: 0, stone: 0, food: 0, iron: 0 };
  let wishAllocFor = 0;
  let exFrom = null;
  let exFromBatches = 0;
  let exTo = null;
  let exToBatches = 0;
  let turnToastArmed = true;
  let turnToastTimer = null;
  let turnToastSnap = null;
  let lasScaleBound = false;

  const LAS_DESIGN_W = 1920;
  const LAS_DESIGN_H = 1080;
  /** ?? 1080p ??????????/?????? */
  const LAS_SCALE_BOOST = 1.14;

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
    // 优先用面板可用宽；高度取视口与宿主中更紧的一方，避免侧栏/顶栏挤压后仍按全屏算
    const availW = Math.max(320, Math.min(hostW, vw));
    const availH = Math.max(240, hostH > 80 ? Math.min(hostH, vh) : vh);
    const scale =
      Math.min(availW / LAS_DESIGN_W, availH / LAS_DESIGN_H) * LAS_SCALE_BOOST;
    const s = Math.round(Math.max(0.35, Math.min(scale, 3)) * 1000) / 1000;
    panel.style.setProperty('--las-ui-scale', String(s));
    panel.dataset.uiScale = String(s);
    // 悬停提示等挂在 body 上，同步到 :root 以便 --las-rem 生效
    document.documentElement.style.setProperty('--las-ui-scale', String(s));
    panel.classList.remove('las-scale-zoom', 'las-scale-transform');
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
    victoryModalKey = null;
    victoryAnimPlaying = false;
    setVictoryModalOpen(false);
    discardResPick = emptyDiscardResPick();
    turnToastArmed = true;
    turnToastSnap = null;
    hideTurnToast(true);
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
      el.classList.remove('is-in', 'is-out');
      el.textContent = '';
      return;
    }
    el.classList.remove('is-in');
    el.classList.add('is-out');
    turnToastTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('is-out');
      turnToastTimer = null;
    }, 280);
  }

  function showTurnToast(text) {
    const el = $('las-turn-toast');
    if (!el || !text) return;
    if (turnToastTimer) {
      clearTimeout(turnToastTimer);
      turnToastTimer = null;
    }
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('is-out');
    void el.offsetWidth;
    el.classList.add('is-in');
    turnToastTimer = setTimeout(() => hideTurnToast(false), 3200);
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
      const isVoid = log.indexOf('\u865a\u7a7a') >= 0; // ??
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

  function maybeShowTurnToast(game, meId) {
    if (!game || !meId) return;
    const cur = captureTurnToastSnap(game, meId);
    const prev = turnToastSnap;
    turnToastSnap = cur;

    const showedEvent = maybeShowEventToasts(game, meId, prev, cur);

    const info = getTurnToastInfo(game, meId);
    if (!info) {
      turnToastArmed = true;
      return;
    }
    if (!turnToastArmed) return;
    turnToastArmed = false;
    if (showedEvent) {
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
    tip.classList.remove('has-preview', 'is-pinned');
    tip._lasTipText = '';
    tip._lasTipImg = '';
    tip._lasTipPinned = false;
    tip.style.left = '';
    tip.style.top = '';
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
    const tw = tip.offsetWidth || 220;
    const th = tip.offsetHeight || 120;
    if (x + tw > window.innerWidth - pad) {
      x = Math.max(pad, (evt && evt.clientX != null ? evt.clientX : x) - tw - 16);
    }
    if (y + th > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - th - pad);
    }
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  function showCardTip(text, evt, anchorEl, imgUrl, pinned) {
    const tip = ensureCardTip();
    const nextText = text || '';
    const nextImg = imgUrl || '';
    const changed =
      tip._lasTipText !== nextText || tip._lasTipImg !== nextImg;
    if (changed) {
      tip._lasTipText = nextText;
      tip._lasTipImg = nextImg;
      tip.innerHTML = '';
      tip.classList.toggle('has-preview', Boolean(nextImg));
      if (nextImg) {
        const preview = document.createElement('div');
        preview.className = 'las-card-tip-preview';
        preview.style.backgroundImage = 'url("' + nextImg + '")';
        tip.appendChild(preview);
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
    } else if (tile.buildType === 'exchange') {
      effect = t('lasidao.exchangeCardTip');
    } else if (tile.buildType === 'wishWell') {
      effect = t('lasidao.tip.wishWellEffect');
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
    card.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
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
    } else if (isBld && tile.buildType === 'exchange') {
      metaTxt = t('lasidao.tip.exchangeShort');
    } else if (isBld && tile.buildType === 'wishWell') {
      metaTxt = t('lasidao.tip.wishWellShort');
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
      // 派遣到格子上：强化骰换算为效力（每枚强化 +1），统一用普通尺寸显示
      const strength = Math.min(count + boosted, 48);
      if (strength <= 0) continue;

      const row = document.createElement('div');
      row.className = 'las-worker-row is-compact';
      row.dataset.pid = pid;
      row.appendChild(makeDieEl(face, 'is-mini is-placed', color));
      const mul = document.createElement('span');
      mul.className = 'las-worker-mul';
      mul.textContent = '\u00d7' + strength;
      if (boosted > 0) {
        mul.title = t('lasidao.workerBoostHint', {
          count,
          boost: boosted,
          strength,
        });
      }
      row.appendChild(mul);
      row.title =
        workerName(pid, players, game) +
        ' \u00d7' +
        strength +
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
      const strength = count + boosted;
      parts.push(workerName(pid, players, game) + 'x' + strength);
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
      const chip = document.createElement('span');
      chip.className = 'las-produce-idle-chip';
      if (p.id === game.currentPlayerId) chip.classList.add('is-current');
      const swatch = document.createElement('span');
      swatch.className =
        'las-die-swatch color-' + playerDieColor(game.players, p.id, game);
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
      appendIdleVillagerBadge(chip, p, { compact: true });
      chips.appendChild(chip);
    }
    bar.appendChild(chips);
  }

  function isMyTurn(game, meId) {
    return game.currentPlayerId && meId && game.currentPlayerId === meId;
  }

  function isRemoteMode(game) {
    return Boolean(game && game.remoteDiceMode);
  }

  function isAwaitingRoll(game) {
    return Boolean(game && game.awaitingProduceRoll);
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
    const box = $('las-dispatch-preview');
    const confirm = $('btn-las-confirm');
    if (!box || !confirm) return;
    const remote = lastGame && isRemoteMode(lastGame);

    if (remote) {
      if (!selectedWildCount) {
        box.hidden = true;
        confirm.hidden = true;
        return;
      }
      if (!selectedTarget) {
        box.hidden = false;
        box.textContent = t('lasidao.diceRemotePick', {
          count: selectedWildCount,
        });
        confirm.hidden = true;
        return;
      }
      let targetTxt = '';
      if (selectedTarget.type === 'area') {
        targetTxt =
          areaLabel(selectedTarget.area) + ' #' + selectedTarget.number;
      } else {
        targetTxt = t('lasidao.targetPersonal', {
          label: selectedTarget.label || '',
        });
      }
      box.hidden = false;
      box.textContent = t('lasidao.previewRemote', {
        count: selectedWildCount,
        target: targetTxt,
      });
      confirm.hidden = false;
      return;
    }

    if (selectedFace == null) {
      box.hidden = true;
      confirm.hidden = true;
      return;
    }

    const count = countByFace(diceAnim.finalDice)[selectedFace] || 0;
    if (!selectedTarget) {
      box.hidden = false;
      box.textContent = t('lasidao.previewNeedTarget', {
        face: selectedFace,
        count,
      });
      confirm.hidden = true;
      return;
    }

    let targetTxt = '';
    if (selectedTarget.type === 'area') {
      targetTxt =
        areaLabel(selectedTarget.area) + ' #' + selectedTarget.number;
    } else {
      targetTxt = t('lasidao.targetPersonal', {
        label: selectedTarget.label || '',
      });
    }
    box.hidden = false;
    box.textContent = t('lasidao.previewReady', {
      face: selectedFace,
      count,
      target: targetTxt,
    });
    confirm.hidden = false;
  }

  function updateDiceHint() {
    const hint = $('las-dice-hint');
    if (!hint) return;
    if (lastGame && isRemoteMode(lastGame) && diceAnim.stage === 'ready') {
      if (!selectedWildCount) {
        hint.textContent = t('lasidao.diceRemoteHint');
      } else if (!selectedTarget) {
        hint.textContent = t('lasidao.diceRemotePick', {
          count: selectedWildCount,
        });
      } else {
        hint.textContent = t('lasidao.diceConfirm');
      }
      return;
    }
    if (diceAnim.stage === 'rolling') {
      hint.textContent = t('lasidao.diceRolling');
    } else if (diceAnim.stage === 'grouping') {
      hint.textContent = t('lasidao.diceGrouping');
    } else if (diceAnim.stage === 'ready') {
      if (selectedFace == null) {
        hint.textContent = t('lasidao.dicePickFaceOrBoard');
      } else if (!selectedTarget) {
        hint.textContent = t('lasidao.dicePickTarget', { face: selectedFace });
      } else {
        hint.textContent = t('lasidao.diceConfirm');
      }
    } else {
      hint.textContent = '';
    }
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
    renderBoard(lastGame, lastMeId);
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

  function confirmBarrenMarkerPlace() {
    if (!netRef || barrenPickNumber == null) return;
    if (!isBarrenMarkerPickMode(lastGame, lastMeId)) return;
    const n = barrenPickNumber;
    barrenPickNumber = null;
    netRef.sendAction('eventMoveBarrenMarker', { number: n });
  }

  function confirmNeutralPlace() {
    if (!netRef || !neutralPickArea || neutralPickNumber == null) return;
    if (!isNeutralPickMode(lastGame, lastMeId)) return;
    const area = neutralPickArea;
    const number = neutralPickNumber;
    neutralPickArea = null;
    neutralPickNumber = null;
    netRef.sendAction('eventMoveNeutral', { area, number });
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
      hint.textContent =
        barrenPickNumber != null
          ? t('lasidao.eventMoveBarrenPicked', { n: barrenPickNumber })
          : t('lasidao.eventMoveBarren');
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
        '<span class="muted">' +
        (barrenPickNumber != null
          ? t('lasidao.slotNum', { n: barrenPickNumber })
          : t('lasidao.eventMoveBarren')) +
        '</span>';
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
        neutralPickArea && neutralPickNumber != null
          ? t('lasidao.eventMoveNeutralPicked', {
              area: areaLabel(neutralPickArea),
              n: neutralPickNumber,
            })
          : t('lasidao.eventMoveNeutral');
    }
    if (preview) preview.hidden = true;
    if (voidBtn) voidBtn.hidden = true;
    if (produceActions) produceActions.hidden = false;
    if (confirm) {
      confirm.hidden = false;
      confirm.disabled = !(neutralPickArea && neutralPickNumber != null);
      confirm.textContent = t('lasidao.eventMoveNeutralConfirm');
    }
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (diceEl) {
      diceEl.hidden = false;
      diceEl.innerHTML =
        '<span class="muted">' +
        (neutralPickArea && neutralPickNumber != null
          ? t('lasidao.eventMoveNeutralPicked', {
              area: areaLabel(neutralPickArea),
              n: neutralPickNumber,
            })
          : t('lasidao.eventMoveNeutral')) +
        '</span>';
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

  /** 功能/建筑合区 num 格于第几轮解锁（开局 2 格，逐轮 +1） */
  function slotUnlockRound(areaKey, num) {
    if (areaKey === 'special') return Math.max(1, num - 1);
    return null;
  }

  /** 合区本轮开放格数 1~6 */
  function areaOpenSlotCount(areaKey, round) {
    const n = Math.max(0, (round || 1) - 1);
    if (areaKey === 'special') return Math.min(6, 2 + n);
    return 6;
  }

  function renderAreaBoard(game, meId, areaKey) {
    const boardEl = $('las-board-' + areaKey);
    if (!boardEl) return;
    boardEl.innerHTML = '';

    const area =
      (game.board && game.board[areaKey]) || { slots: [], workers: {} };
    const remote = isRemoteMode(game);
    const faces = availableFaces();
    const barrenPick = isBarrenMarkerPickMode(game, meId);
    const neutralPick = isNeutralPickMode(game, meId);
    const canPickBase =
      !barrenPick &&
      !neutralPick &&
      game.phase === 'produce' &&
      isMyTurn(game, meId) &&
      diceReady();
    const canPick = canPickBase && (remote ? selectedWildCount > 0 : faces.length > 0);

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

      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'las-slot las-slot-' + areaKey;
      slot.dataset.area = areaKey;
      slot.dataset.num = String(num);
      const capacity =
        areaKey === 'resource' ? resourceSlotCapacity(num) : 1;
      // 资源区 4–6 容量为 2，但格宽与 1–3 对齐（按 3 张卡宽），内容居中
      const slotCardCount =
        areaKey === 'resource' ? 3 : capacity;
      slot.style.setProperty('--las-slot-card-count', String(slotCardCount));
      const round = game.round || 1;
      const openCount = areaOpenSlotCount(areaKey, round);
      const lockedByRound =
        areaKey === 'special' &&
        num > openCount;

      const hasTiles = tiles.length > 0;
      // ??????????????????????????????
      const matchFace = remote ? true : faces.indexOf(num) >= 0;
      const barrenSelectable = barrenPick && areaKey === 'resource';
      const neutralSelectable =
        neutralPick &&
        (areaKey === 'resource' || areaKey === 'special') &&
        !(areaKey === 'special' && lockedByRound);
      const dispatchable = canPick && matchFace && hasTiles;
      slot.disabled = !(barrenSelectable || neutralSelectable || dispatchable);
      if (barrenSelectable || neutralSelectable || dispatchable) {
        slot.classList.add('is-target');
      } else if (canPickBase) {
        slot.classList.add('is-dimmed');
      }
      if (
        barrenSelectable &&
        barrenPickNumber === num
      ) {
        slot.classList.add('is-picked');
      } else if (
        neutralSelectable &&
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
      slot.appendChild(numEl);

      const body = document.createElement('div');
      body.className = 'las-slot-body';
      const stack = document.createElement('div');
      stack.className = 'las-slot-tiles';

      for (let idx = 0; idx < capacity; idx++) {
        const tile = tiles[idx];
        if (tile) {
          const card = makeTileCard(tile, areaKey);
          if (pendingDealIds.has(tile.id)) {
            card.classList.add('is-dealing');
          }
          stack.appendChild(card);
        } else {
          const empty = document.createElement('span');
          empty.className = 'muted las-slot-empty';
          let locked = false;
          let unlockN = null;
          if (areaKey === 'resource') {
            if (idx >= 1) {
              const u = resourceSlotUnlockRound(num, idx);
              if (round < u) {
                locked = true;
                unlockN = u;
              }
            }
          } else if (idx === 0) {
            const u = slotUnlockRound(areaKey, num);
            const openCount = areaOpenSlotCount(areaKey, round);
            if (
              u != null &&
              (game.phase === 'init_roll' ||
                game.phase === 'init_announce' ||
                num > openCount)
            ) {
              locked = true;
              unlockN = u;
            }
          }
          if (locked) {
            empty.classList.add('las-slot-locked');
            empty.textContent = t('lasidao.unlockRound', { n: unlockN });
            if (capacity === 1) slot.classList.add('is-locked');
          } else {
            empty.textContent = t('lasidao.emptySlot');
          }
          stack.appendChild(empty);
        }
      }
      body.appendChild(stack);

      if (areaKey === 'resource' && num >= 4 && num <= 6) {
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
          if (envTile.stash && !envTile.stashClaimed) {
            const total = RESOURCES.reduce(
              (s, r) => s + (Number(envTile.stash[r]) || 0),
              0
            );
            if (total > 0) {
              const stashCard = makeTileCard(
                {
                  id: (envTile.id || 'env') + ':stash',
                  kind: 'resource',
                  backKind: 'resourceCard',
                  faceDown: true,
                  label: null,
                },
                'resource'
              );
              stashCard.classList.add('las-env-side-card', 'las-env-stash-card');
              stashCard.title = t('lasidao.eventStashBadge', { n: total });
              stashCard.setAttribute(
                'aria-label',
                t('lasidao.eventStashBadge', { n: total })
              );
              const count = document.createElement('span');
              count.className = 'las-env-stash-count';
              count.textContent = '×' + total;
              stashCard.appendChild(count);
              envBox.appendChild(stashCard);
            }
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

      if (
        areaKey === 'resource' &&
        game.barrenMarkerNumber != null &&
        Number(game.barrenMarkerNumber) === num
      ) {
        slot.classList.add('has-barren-marker');
        const mark = document.createElement('div');
        mark.className = 'las-barren-marker';
        mark.textContent = t('lasidao.eventBarrenMarker');
        mark.setAttribute('aria-label', t('lasidao.eventBarrenMarkerTip'));
        const barrenTipText = [
          t('lasidao.eventBarrenTitle'),
          t('lasidao.eventBarrenMarkerTip'),
        ]
          .filter(Boolean)
          .join('\n');
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
        body.appendChild(mark);
      }

      slot.appendChild(body);

      slot.onclick = () => {
        if (barrenSelectable) {
          barrenPickNumber = num;
          renderBoard(lastGame, lastMeId);
          syncBarrenMarkerPickUi(lastGame, lastMeId);
          return;
        }
        if (neutralSelectable) {
          neutralPickArea = areaKey;
          neutralPickNumber = num;
          renderBoard(lastGame, lastMeId);
          syncNeutralPickUi(lastGame, lastMeId);
          return;
        }
        if (!dispatchable) return;
        pickAreaTarget(areaKey, num);
      };
      boardEl.appendChild(slot);
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
        for (const num of [4, 5, 6]) {
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
        renderBoard(lastGame, lastMeId);
        renderGroupedDice();
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
        el.style.transform = 'translateX(' + dx + 'px) scale(0.85)';
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
        el.style.transform = 'translateX(' + dx + 'px) scale(0.85)';
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
        renderBoard(lastGame, lastMeId);
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
    const show =
      game.phase === 'produce' &&
      isMyTurn(game, meId) &&
      isAwaitingRoll(game);
    wrap.hidden = !show;
    if (rollBtn) rollBtn.hidden = !show;
    if (remoteBtn) {
      const hasCard = Boolean(game.me && game.me.hasRemoteDice);
      remoteBtn.hidden = !(show && hasCard);
    }
  }

  function setDiceTitle(text) {
    const title = document.querySelector('#las-dice-wrap > .game-sub');
    if (title) title.textContent = text;
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
    if (syncNeutralPickUi(game, meId)) {
      return;
    }
    if (!isBarrenMarkerPickMode(game, meId) && barrenPickNumber != null) {
      barrenPickNumber = null;
    }
    if (!isNeutralPickMode(game, meId) && neutralPickNumber != null) {
      neutralPickArea = null;
      neutralPickNumber = null;
    }

    const confirm = $('btn-las-confirm');
    const voidBtn = $('btn-las-void');
    const preview = $('las-dispatch-preview');
    const produceActions = $('las-produce-actions');
    if (confirm) confirm.textContent = t('lasidao.confirmDispatch');

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

    // ?????????????????
    if (!myTurn && active && active.awaitingRoll) {
      if (diceAnim.stage !== 'idle') resetDiceAnim();
      wrap.hidden = false;
      setDiceTitle(t('lasidao.otherAwaitingRoll', { name: actorName }));
      const diceEl = $('las-dice');
      const groupsEl = $('las-dice-groups');
      if (diceEl) {
        diceEl.hidden = false;
        diceEl.innerHTML =
          '<span class="muted">' + t('lasidao.waitingOtherRoll') + '</span>';
      }
      if (groupsEl) {
        groupsEl.hidden = true;
        groupsEl.innerHTML = '';
      }
      if (preview) preview.hidden = true;
      if (confirm) confirm.hidden = true;
      if (voidBtn) voidBtn.hidden = true;
      if (produceActions) produceActions.hidden = true;
      const hint = $('las-dice-hint');
      if (hint) hint.textContent = '';
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

    if (myTurn) {
      setDiceTitle(t('lasidao.yourDice'));
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
      const status = $('las-status');
      if (status && first) {
        status.textContent = t('lasidao.statusInitAnnounce', {
          name: first.name,
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
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'las-card func' + (selectedFuncId === c.id ? ' is-selected' : '');
        if (!decorateHandCardArt(btn, c, 'function')) {
          btn.textContent = c.label;
        }
        if (interactive) {
          const playable = canPlayFuncCard(game, meId, c.funcType);
          if (!playable && !player.pendingDiscardFunc) {
            btn.disabled = true;
            btn.title = t('lasidao.funcWrongPhase');
          }
          btn.onclick = () => {
            if (!playable && !player.pendingDiscardFunc) return;
            selectedFuncId = selectedFuncId === c.id ? null : c.id;
            renderPlayerBoards(game, meId);
            renderActRail(game, meId);
            renderFuncForm(game, player);
          };
        } else {
          btn.disabled = true;
        }
        funcsEl.appendChild(btn);
        filled += 1;
        if (
          interactive &&
          player &&
          player.pendingDiscardFunc &&
          !player.pendingDiscardRes
        ) {
          const disc = document.createElement('button');
          disc.type = 'button';
          disc.className = 'las-card';
          disc.textContent = t('lasidao.discardFunc', { label: c.label });
          disc.onclick = () =>
            netRef && netRef.sendAction('discardFunc', { cardId: c.id });
          funcsEl.appendChild(disc);
        }
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
      return t('lasidao.statusSettleActWait', {
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
          : 10;
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
      qty.className = 'las-void-skip-qty';
      qty.textContent = '×' + own;
      cardEl.appendChild(qty);
      const label = document.createElement('span');
      label.className = 'las-void-skip-label';
      label.textContent = labels[res] || res;
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

    const tip = document.createElement('div');
    tip.className = 'muted las-pboard-tip las-discard-build-tip';
    tip.textContent = t('lasidao.discardBuildChoiceTip', { n: maxB });
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

    const oldWrap = document.createElement('div');
    oldWrap.className = 'las-discard-build-group';
    const oldLab = document.createElement('div');
    oldLab.className = 'las-pboard-label';
    oldLab.textContent = t('lasidao.existingBuildsDiscard');
    oldWrap.appendChild(oldLab);
    const oldCards = document.createElement('div');
    oldCards.className = 'las-cards las-act-cards';
    for (const b of me.buildings || []) {
      oldCards.appendChild(makeBoardBuildingCard(game, meId, me, b, true));
    }
    oldWrap.appendChild(oldCards);
    parent.appendChild(oldWrap);
  }

  function renderActRail(game, meId) {
    const wrap = $('las-act-wrap');
    const hand = $('las-act-hand');
    const hint = $('las-act-hint');
    if (!wrap || !hand) return;

    const show = shouldShowActRail(game, meId);
    wrap.hidden = !show;
    if (!show) {
      hand.innerHTML = '';
      if (hint) hint.textContent = '';
      if (game.phase !== 'settle_act') discardResPick = emptyDiscardResPick();
      return;
    }
    if (game.phase !== 'settle_act') discardResPick = emptyDiscardResPick();

    const me = mePlayer(game, meId);
    hand.innerHTML = '';
    if (!me) {
      if (hint) hint.textContent = '';
      return;
    }

    if (hint) {
      if (game.phase === 'build') {
        hint.textContent = isMyTurn(game, meId)
          ? t('lasidao.actRailHintBuild')
          : t('lasidao.actRailHintBuildWait');
      } else if (game.phase === 'produce') {
        hint.textContent = t('lasidao.actRailHintProduce');
      } else if (game.phase === 'settle_act') {
        hint.textContent = settleDiscardHintForMe(me);
      } else {
        hint.textContent = '';
      }
    }

    if (game.phase === 'build' && (me.buildPassed || (game.me && game.me.buildPassed))) {
      const done = document.createElement('div');
      done.className = 'las-act-passed muted';
      done.textContent = t('lasidao.buildPassedNote');
      hand.appendChild(done);
    }

    // 生产阶段：展示可用功能卡（遥控骰子 / 驱逐 / 强盗来袭）
    if (game.phase === 'produce') {
      const produceCards = (me.funcCards || []).filter(
        (c) => !c.hidden && PRODUCE_FUNC.has(c.funcType)
      );
      const funcLab = document.createElement('div');
      funcLab.className = 'las-pboard-label';
      funcLab.textContent = t('lasidao.funcHand');
      hand.appendChild(funcLab);
      const funcs = document.createElement('div');
      funcs.className = 'las-cards las-act-cards las-func-hand';
      fillFuncHandRow(funcs, {
        cards: produceCards,
        isMe: true,
        interactive: true,
        game,
        player: me,
        meId,
        maxSlots: Math.max(produceCards.length, 1),
      });
      hand.appendChild(funcs);
      return;
    }

    // 建造阶段的手牌与建筑已移至抽牌堆上方的建造手牌区
    if (game.phase === 'settle_act') {
      appendResourceDiscardRow(hand, game, me);
      if (me.pendingDiscardBuild && !me.pendingDiscardRes) {
        appendBuildDiscardChoiceUi(hand, game, meId, me);
      }
      if (me.pendingDiscardFunc && !me.pendingDiscardRes) {
        const tip = document.createElement('div');
        tip.className = 'muted las-pboard-tip';
        tip.textContent = t('lasidao.discardFuncTip');
        hand.appendChild(tip);
        const funcLab = document.createElement('div');
        funcLab.className = 'las-pboard-label';
        funcLab.textContent = t('lasidao.funcHand');
        hand.appendChild(funcLab);
        const funcs = document.createElement('div');
        funcs.className = 'las-cards las-act-cards las-func-hand';
        fillFuncHandRow(funcs, {
          cards: me.funcCards,
          isMe: true,
          interactive: true,
          game,
          player: me,
          meId,
          maxSlots: me.maxFuncHand || MAX_FUNC_HAND_UI,
        });
        hand.appendChild(funcs);
      }
      return;
    }

    if (game.phase !== 'build') {
      const funcLab = document.createElement('div');
      funcLab.className = 'las-pboard-label';
      funcLab.textContent = t('lasidao.funcHand');
      hand.appendChild(funcLab);
      const funcs = document.createElement('div');
      funcs.className = 'las-cards las-act-cards las-func-hand';
      fillFuncHandRow(funcs, {
        cards: me.funcCards,
        isMe: true,
        interactive: true,
        game,
        player: me,
        meId,
        maxSlots: me.maxFuncHand || MAX_FUNC_HAND_UI,
      });
      hand.appendChild(funcs);

      const unplaced = (me.buildings || []).filter((b) => b.slot == null);
      const placedUnbuilt = (me.buildings || []).filter(
        (b) => !b.built && b.slot != null
      );
      if (unplaced.length || placedUnbuilt.length || me.pendingDiscardBuild) {
        const bLab = document.createElement('div');
        bLab.className = 'las-pboard-label';
        bLab.textContent = t('lasidao.actRailBuilds');
        hand.appendChild(bLab);
        const builds = document.createElement('div');
        builds.className = 'las-cards las-act-cards';
        for (const b of unplaced) {
          builds.appendChild(makeBoardBuildingCard(game, meId, me, b, true));
        }
        for (const b of placedUnbuilt) {
          builds.appendChild(makeBoardBuildingCard(game, meId, me, b, true));
        }
        if (me.pendingDiscardBuild) {
          const tip = document.createElement('div');
          tip.className = 'muted las-pboard-tip';
          tip.textContent = t('lasidao.discardBuildTip', {
            n: me.maxBuildings || game.maxBuildings || 3,
          });
          builds.appendChild(tip);
          for (const b of me.buildings || []) {
            if (unplaced.includes(b) || placedUnbuilt.includes(b)) continue;
            builds.appendChild(makeBoardBuildingCard(game, meId, me, b, true));
          }
        }
        hand.appendChild(builds);
      }
    }
  }

  /** 建造阶段手牌区（抽牌堆上方） */
  function renderBuildHand(game, meId) {
    const wrap = $('las-build-hand-wrap');
    const hand = $('las-build-hand');
    const bldLabel = $('las-build-hand-bld-label');
    const bldHand = $('las-build-hand-bld');
    const playBar = $('las-build-play-bar');
    const playBtn = $('btn-las-build-play');
    if (!wrap || !hand) return;

    const isBuild = game.phase === 'build';
    const me = mePlayer(game, meId);
    const myTurn = isMyTurn(game, meId);
    if (!isBuild || !me || me.buildPassed) {
      wrap.hidden = true;
      if (playBar) playBar.hidden = true;
      if (bldLabel) bldLabel.hidden = true;
      if (bldHand) bldHand.innerHTML = '';
      selectedBuildingId = null;
      if (me && me.buildPassed) selectedPermanent = null;
      return;
    }

    wrap.hidden = false;
    hand.innerHTML = '';
    if (bldHand) bldHand.innerHTML = '';

    // 选中项若已不存在则清除
    if (
      selectedFuncId &&
      !(me.funcCards || []).some((c) => c.id === selectedFuncId && !c.hidden)
    ) {
      selectedFuncId = null;
    }
    if (
      selectedBuildingId &&
      !(me.buildings || []).some((b) => b.id === selectedBuildingId && !b.built)
    ) {
      selectedBuildingId = null;
    }

    const buildPhasePlayable = [
      'harvest',
      'robbery',
      'redraw',
      'expand',
      'enhance',
      'recruit',
    ];
    // 功能卡：点选，确认发动走标题下方 play-bar
    const visible = (me.funcCards || []).filter((c) => !c.hidden);
    for (const c of visible) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const canPlay = buildPhasePlayable.includes(c.funcType);
      const ok = myTurn && canPlay;
      const isSelected = selectedFuncId === c.id;

      btn.className =
        'las-build-card func' +
        (isSelected ? ' is-selected' : '') +
        (ok ? '' : ' is-disabled');
      if (!decorateHandCardArt(btn, c, 'function')) {
        btn.textContent = c.label;
      }
      if (!ok) {
        btn.disabled = true;
        btn.title = !myTurn
          ? t('lasidao.actRailHintBuildWait')
          : t('lasidao.funcWrongPhase');
      } else {
        btn.title = c.label;
        btn.onclick = () => {
          selectedBuildingId = null;
          selectedPermanent = null;
          selectedFuncId = isSelected ? null : c.id;
          renderBuildHand(game, meId);
          renderFuncForm(game, me);
          syncPermanentSelection(game, me);
        };
      }
      hand.appendChild(btn);
    }

    // 建筑（未建）：点选，确认建造/放置走标题下方 play-bar
    const resLabels = defaultResLabels();
    const nonBuilt = (me.buildings || []).filter((b) => !b.built);
    if (bldHand) {
      for (const b of nonBuilt) {
        const btn = document.createElement('button');
        btn.type = 'button';
        const canAfford = canPay(me.resources || {}, b.cost || {});
        const needsPay = b.slot != null;
        const isBlocked = !myTurn || (needsPay && !canAfford);
        const isSelected = selectedBuildingId === b.id;
        btn.className =
          'las-build-card build is-unbuilt' +
          (isSelected ? ' is-selected' : '') +
          (isBlocked ? ' is-disabled' : '');
        if (!decorateHandCardArt(btn, b, 'building')) {
          btn.textContent = b.label || '?';
        }
        if (isBlocked) {
          btn.disabled = true;
          const tip = buildBldTooltip(b, resLabels);
          btn.title = !myTurn
            ? t('lasidao.actRailHintBuildWait')
            : '资源不足\n' + tip;
        } else {
          btn.title = buildBldTooltip(b, resLabels);
          btn.onclick = () => {
            selectedFuncId = null;
            selectedPermanent = null;
            selectedBuildingId = isSelected ? null : b.id;
            renderBuildHand(game, meId);
            renderFuncForm(game, me);
            syncPermanentSelection(game, me);
          };
        }
        bldHand.appendChild(btn);
      }
    }
    if (bldLabel) {
      bldLabel.hidden = nonBuilt.length === 0;
    }

    syncBuildPlayBar(game, me);
  }

  function syncBuildPlayBar(game, me) {
    const playBar = $('las-build-play-bar');
    const playBtn = $('btn-las-build-play');
    if (!playBar || !playBtn) return;

    const myTurn = isMyTurn(game, me && me.id);
    const hasSel = Boolean(
      selectedFuncId || selectedBuildingId || selectedPermanent
    );
    playBar.hidden = !(
      game.phase === 'build' &&
      myTurn &&
      hasSel &&
      me &&
      !me.buildPassed
    );
    if (playBar.hidden) {
      playBtn.onclick = null;
      return;
    }

    if (selectedBuildingId) {
      const b = (me.buildings || []).find((x) => x.id === selectedBuildingId);
      playBtn.textContent =
        b && b.slot == null
          ? t('lasidao.confirmPlaceBuilding')
          : t('lasidao.confirmConstruct');
    } else if (selectedPermanent === 'buildHouse') {
      playBtn.textContent = t('lasidao.confirmBuildHouse');
    } else if (selectedPermanent === 'breed') {
      playBtn.textContent = t('lasidao.confirmBreed');
    } else if (selectedPermanent === 'expand') {
      playBtn.textContent = t('lasidao.confirmExpand');
    } else if (selectedPermanent === 'exchange') {
      playBtn.textContent = t('lasidao.confirmExchange');
    } else {
      playBtn.textContent = t('lasidao.confirmUse');
    }

    playBtn.onclick = () => confirmBuildHandSelection(game, me);
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
      netRef.sendAction('expandPermanent', {});
      selectedPermanent = null;
    } else if (kind === 'exchange') {
      setExchangeModalOpen(true);
      selectedPermanent = null;
    }
    syncPermanentSelection(game, me);
    if (lastGame && lastMeId) {
      renderBuildHand(lastGame, lastMeId);
      renderFuncForm(lastGame, me);
    }
  }

  function selectPermanent(kind, game, me) {
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
      harvestCardId = card.id;
      harvestCounts = { wood: 0, stone: 0, food: 0, iron: 0 };
      setHarvestModalOpen(true);
      renderHarvestModal();
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
      setExileModalOpen(true);
      renderExileSlotStep(game);
    } else if (card.funcType === 'banditRaid') {
      banditCardId = card.id;
      banditArea = null;
      banditNumber = null;
      setBanditModalOpen(true);
      renderBanditSlotStep(game);
    } else if (card.funcType === 'expand') {
      netRef.sendAction('useFunc', { cardId: card.id });
      selectedFuncId = null;
    } else if (card.funcType === 'robbery') {
      robberyCardId = card.id;
      robberyTargetId = null;
      setRobberyModalOpen(true);
      renderRobberyPlayerStep(game, card);
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
      const actWrap = $('las-act-wrap');
      if (actWrap) actWrap.hidden = true;
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
        : Math.min(exBuilt, 3);
    const exBtn = $('btn-las-exchange');
    if (exBtn) {
      const cost = (game.me && game.me.exchangeCost != null) ? game.me.exchangeCost : (exCount === 0 ? 4 : exCount === 1 ? 3 : exCount === 2 ? 2 : 1);
      exBtn.textContent = t('lasidao.exchangeBtnN', { n: cost });
      exBtn.title = exCount === 0
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
      btn.onclick = () => onBuildingClick(game, p, b);
    } else {
      btn.disabled = true;
    }
    if (!btn.classList.contains('has-art')) {
      bindTileTip(btn, hidden ? { faceDown: true } : display, 'building');
    }
    return btn;
  }

  function renderPlayerBoards(game, meId) {
    const host = $('las-boards-host');
    const meHost = $('las-boards-me');
    const othersTitle = $('las-others-title');
    if (!host) return;
    host.innerHTML = '';
    if (meHost) meHost.innerHTML = '';
    const players = (game.players || []).slice().sort((a, b) => {
      return (a.seat || 0) - (b.seat || 0);
    });
    const labels = getResLabels(game);
    let othersCount = 0;

    for (const p of players) {
      const isMe = Boolean(meId && p.id === meId);
      const maxB =
        p.maxBuildings ||
        (game.maxBuildings || 3) + (Number(p.expandSlots) || 0);
      const maxFunc = p.maxFuncHand || MAX_FUNC_HAND_UI;
      const maxRes =
        p.maxResourceHand != null
          ? p.maxResourceHand
          : isMe && game.me && game.me.maxResourceHand != null
            ? game.me.maxResourceHand
            : 10;
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

      const head = document.createElement('div');
      head.className = 'las-pboard-head';
      const color = playerDieColor(game.players, p.id);
      const swatch = document.createElement('span');
      swatch.className = 'las-die-swatch color-' + color;
      head.appendChild(swatch);
      const title = document.createElement('div');
      title.className = 'las-pboard-title';
      const Nick = window.PlayerNick;
      title.innerHTML =
        (Nick && Nick.formatHtml
          ? Nick.formatHtml(p.name, p.tag)
          : escapeHtml(p.name)) +
        (isMe ? ' <span class="you">(' + t('lasidao.youMark') + ')</span>' : '');
      head.appendChild(title);
      const stats = document.createElement('div');
      stats.className = 'las-pboard-stats muted';
      stats.textContent = t('lasidao.playerStats', {
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
      });
      head.appendChild(stats);
      board.appendChild(head);

      // 自己与其他玩家都显示资源手牌上限
      const resRow = document.createElement('div');
      resRow.className = 'las-pboard-res las-res';
      if (isMe) {
        for (const [k, v] of Object.entries(p.resources || {})) {
          const span = document.createElement('span');
          span.className = 'badge';
          span.textContent = (labels[k] || k) + ' ' + v;
          resRow.appendChild(span);
        }
      }
      appendIdleVillagerBadge(resRow, p);
      const cap = document.createElement('span');
      cap.className = 'badge' + (totalRes > maxRes ? ' las-res-over' : '');
      cap.textContent = t('lasidao.resourceHandCap', {
        total: totalRes,
        max: maxRes,
      });
      resRow.appendChild(cap);
      board.appendChild(resRow);

      const slotsTitle = document.createElement('div');
      slotsTitle.className = 'las-pboard-label';
      slotsTitle.textContent = t('lasidao.buildSlotsCap', {
        n: buildN,
        max: maxB,
      });
      board.appendChild(slotsTitle);

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
        if (isMe && isExchangeOnlyBuildSlot(p, slotKey)) {
          cell.classList.add('is-stackable');
          cell.onclick = (ev) => {
            if (ev.target && ev.target.closest && ev.target.closest('.las-pboard-card')) {
              return;
            }
            const unplacedEx = (p.buildings || []).find(
              (b) => !b.built && b.slot == null && b.buildType === 'exchange'
            );
            if (!unplacedEx || !netRef) return;
            netRef.sendAction('placeBuildingSlot', {
              buildingId: unplacedEx.id,
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
      board.appendChild(slots);

      const actHand =
        isMe && shouldShowActRail(game, meId);

      const unplaced = (p.buildings || []).filter((b) => b.slot == null);
      if (unplaced.length && !actHand) {
        const hand = document.createElement('div');
        hand.className = 'las-pboard-unplaced';
        const lab = document.createElement('div');
        lab.className = 'las-pboard-label';
        lab.textContent = t('lasidao.unplacedBuilds');
        hand.appendChild(lab);
        const cards = document.createElement('div');
        cards.className = 'las-cards';
        for (const b of unplaced) {
          cards.appendChild(makeBoardBuildingCard(game, meId, p, b, isMe));
        }
        hand.appendChild(cards);
        board.appendChild(hand);
      }

      if (isMe && p.pendingDiscardBuild && p.pendingDiscardBuild.newCard) {
        appendBuildDiscardChoiceUi(board, game, meId, p);
      } else if (isMe && p.pendingDiscardBuild && !actHand) {
        const tip = document.createElement('div');
        tip.className = 'muted las-pboard-tip';
        tip.textContent = t('lasidao.discardBuildTip', { n: maxB });
        board.appendChild(tip);
      }

      if (
        !isMe &&
        game.phase === 'settle_act' &&
        (p.needsDiscardFunc || p.needsDiscardBuild || p.needsDiscardRes)
      ) {
        const tip = document.createElement('div');
        tip.className = 'muted las-pboard-tip';
        tip.textContent = t('lasidao.settleDiscardOtherTip', {
          name: p.name,
        });
        board.appendChild(tip);
        board.classList.add('is-discard-pending');
      }

      if (actHand) {
        const note = document.createElement('div');
        note.className = 'muted las-pboard-tip';
        note.textContent = t('lasidao.actRailMovedNote');
        board.appendChild(note);
      }

      const funcTitle = document.createElement('div');
      funcTitle.className = 'las-pboard-label';
      funcTitle.textContent = t('lasidao.funcHandCap', {
        n: funcN,
        max: maxFunc,
      });
      board.appendChild(funcTitle);
      const funcs = document.createElement('div');
      funcs.className = 'las-pboard-funcs las-cards las-func-hand';
      fillFuncHandRow(funcs, {
        cards: p.funcCards,
        isMe,
        interactive:
          isMe &&
          !actHand &&
          (game.phase === 'produce' || game.phase === 'build'),
        game,
        player: p,
        meId,
        funcCount: p.funcCount,
        maxSlots: maxFunc,
      });
      board.appendChild(funcs);

      if (isMe && meHost) {
        meHost.appendChild(board);
      } else {
        host.appendChild(board);
        othersCount += 1;
      }
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
      renderBuildHand(game, me.id);
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

    // 建造阶段：选中常驻功能
    if (
      game.phase === 'build' &&
      selectedPermanent &&
      me &&
      !me.buildPassed
    ) {
      panel.hidden = false;
      form.innerHTML = '';
      const title = document.createElement('p');
      const tip = document.createElement('p');
      tip.className = 'muted';
      if (selectedPermanent === 'buildHouse') {
        title.textContent = t('lasidao.permanentFormTitle', {
          label: t('lasidao.buildHousePermanent'),
        });
        tip.textContent = t('lasidao.func.buildHouse');
      } else if (selectedPermanent === 'breed') {
        title.textContent = t('lasidao.permanentFormTitle', {
          label: t('lasidao.breedPermanent'),
        });
        const free =
          me.freeHouses != null
            ? me.freeHouses
            : Math.max(0, (me.houses || 0) - (me.villagers || 0));
        tip.textContent = t('lasidao.breedFormHint', {
          need: (me.villagers || 0) * (game.breedFoodPerVillager != null ? game.breedFoodPerVillager : 1),
          free,
          houses: me.houses != null ? me.houses : 0,
        });
      } else if (selectedPermanent === 'expand') {
        title.textContent = t('lasidao.permanentFormTitle', {
          label: t('lasidao.expandPermanent'),
        });
        const expandCost =
          (game.me && game.me.expandPermanentCost) || { wood: 2, stone: 2 };
        tip.textContent = t('lasidao.expandPermanentTip', {
          wood: expandCost.wood,
          stone: expandCost.stone,
          n: (game.me && game.me.expandCount) || 0,
        });
      } else if (selectedPermanent === 'exchange') {
        title.textContent = t('lasidao.permanentFormTitle', {
          label: t('lasidao.exchangeBtn'),
        });
        tip.textContent = t('lasidao.exchangeFormHint');
      } else {
        panel.hidden = true;
        form.innerHTML = '';
        return;
      }
      form.appendChild(title);
      form.appendChild(tip);
      return;
    }

    // 建造阶段：选中建筑时显示说明（确认按钮在 play-bar）
    if (
      game.phase === 'build' &&
      selectedBuildingId &&
      me &&
      !me.buildPassed
    ) {
      const b = (me.buildings || []).find((x) => x.id === selectedBuildingId);
      if (b && !b.built) {
        panel.hidden = false;
        form.innerHTML = '';
        const title = document.createElement('p');
        const placing = b.slot == null;
        title.textContent = t(
          placing
            ? 'lasidao.placeBuildingFormTitle'
            : 'lasidao.constructFormTitle',
          { label: b.label || '?' }
        );
        form.appendChild(title);
        const tip = document.createElement('p');
        tip.className = 'muted';
        tip.textContent = t(
          placing
            ? 'lasidao.placeBuildingFormHint'
            : 'lasidao.constructFormHint'
        );
        form.appendChild(tip);
        const costTip = document.createElement('p');
        costTip.className = 'muted';
        costTip.textContent = buildBldTooltip(b, defaultResLabels());
        form.appendChild(costTip);
        return;
      }
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

    // 建造阶段：确认走上方 play-bar，侧栏只展示说明
    if (game.phase === 'build') {
      return;
    }

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
      target: 15,
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
        p.maxResourceHand != null ? p.maxResourceHand : 10;
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
        choice.needChoice !== 'moveNeutral'
    );
    const showMerc = Boolean(
      merc && merc.forMe && game.phase === 'event_mercenary'
    );
    const showPrisoner = Boolean(
      game &&
        game.phase === 'event_discard' &&
        prisonerN > 0 &&
        isMyTurn(game, meId)
    );

    if (!showChoice && !showMerc && !showPrisoner) {
      modal.hidden = true;
      body.innerHTML = '';
      if (confirmBtn) confirmBtn.hidden = true;
      if (skipBtn) skipBtn.hidden = true;
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
        if (hint) hint.textContent = t('lasidao.eventPickResource');
        for (const r of RESOURCES) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = t('lasidao.res.' + r);
          btn.onclick = () => {
            if (!netRef) return;
            netRef.sendAction('eventPickResource', { resource: r });
          };
          body.appendChild(btn);
        }
      } else if (choice.needChoice === 'moveNeutral') {
        if (hint) hint.textContent = t('lasidao.eventMoveNeutral');
        for (const area of ['resource', 'special']) {
          const row = document.createElement('div');
          row.className = 'row las-event-row';
          const lab = document.createElement('span');
          lab.className = 'muted';
          lab.textContent = areaLabel(area) + ' ';
          row.appendChild(lab);
          for (let n = 1; n <= 6; n++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = String(n);
            btn.onclick = () => {
              if (!netRef) return;
              netRef.sendAction('eventMoveNeutral', { area, number: n });
            };
            row.appendChild(btn);
          }
          body.appendChild(row);
        }
      }
      return;
    }

    if (showMerc) {
      if (title) title.textContent = t('lasidao.eventMercenaryTitle');
      const roll = merc.roll || [];
      const placed = new Set(merc.placed || []);
      if (!roll.length) {
        if (hint) hint.textContent = t('lasidao.eventMercenaryRollHint');
        if (confirmBtn) {
          confirmBtn.hidden = false;
          confirmBtn.textContent = t('lasidao.produceRoll');
          confirmBtn.onclick = () =>
            netRef && netRef.sendAction('mercenaryRoll', {});
        }
        if (skipBtn) {
          skipBtn.hidden = false;
          skipBtn.textContent = t('lasidao.eventMercenarySkip');
          skipBtn.onclick = () =>
            netRef && netRef.sendAction('mercenarySkipAll', {});
        }
      } else {
        if (hint) hint.textContent = t('lasidao.eventMercenaryPlaceHint');
        roll.forEach((face, idx) => {
          if (placed.has(idx)) return;
          const wrap = document.createElement('div');
          wrap.className = 'row las-event-row';
          const lab = document.createElement('span');
          lab.textContent = t('lasidao.eventMercenaryDie', { face });
          wrap.appendChild(lab);
          const place = document.createElement('button');
          place.type = 'button';
          place.textContent = t('lasidao.eventMercenaryPlace');
          place.onclick = () =>
            netRef &&
            netRef.sendAction('mercenaryPlace', { index: idx, skip: false });
          wrap.appendChild(place);
          const sk = document.createElement('button');
          sk.type = 'button';
          sk.className = 'secondary';
          sk.textContent = t('lasidao.pass');
          sk.onclick = () =>
            netRef &&
            netRef.sendAction('mercenaryPlace', { index: idx, skip: true });
          wrap.appendChild(sk);
          body.appendChild(wrap);
        });
        if (skipBtn) {
          skipBtn.hidden = false;
          skipBtn.textContent = t('lasidao.eventMercenarySkip');
          skipBtn.onclick = () =>
            netRef && netRef.sendAction('mercenarySkipAll', {});
        }
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
      for (const c of me.funcCards || []) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = c.label || c.funcType;
        btn.onclick = () =>
          netRef &&
          netRef.sendAction('eventDiscard', { kind: 'func', cardId: c.id });
        body.appendChild(btn);
      }
      for (const b of me.buildings || []) {
        if (b.built) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent =
          (b.label || t('lasidao.tip.buildingCard')) +
          ' (' +
          t('lasidao.hand') +
          ')';
        btn.onclick = () =>
          netRef &&
          netRef.sendAction('eventDiscard', {
            kind: 'building',
            buildingId: b.id,
          });
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

    if (game.over) {
      const names = (game.winners || [])
        .map((id) => {
          const p = (game.players || []).find((x) => x.id === id);
          return p ? p.name : id;
        })
        .join(', ');
      $('las-status').textContent = t('lasidao.statusOver', {
        names: names || t('lasidao.statusOverNobody'),
      });
    } else if (game.phase === 'init_announce') {
      const reveal = game.pendingInitReveal;
      const first =
        reveal &&
        (game.players || []).find((p) => p.id === reveal.firstPlayerId);
      if (first && reveal) {
        $('las-status').textContent = t('lasidao.statusInitAnnounce', {
          name: first.name,
          n: reveal.best,
        });
      } else {
        $('las-status').textContent = t('lasidao.statusInit');
      }
    } else if (game.phase === 'init_roll') {
      $('las-status').textContent = t('lasidao.statusInit');
    } else if (game.phase === 'produce') {
      if (isMyTurn(game, meId) && isAwaitingRoll(game)) {
        $('las-status').textContent = t('lasidao.statusAwaitRoll');
      } else if (
        isMyTurn(game, meId) &&
        isRemoteMode(game)
      ) {
        $('las-status').textContent = t('lasidao.diceRemoteHint');
      } else if (
        isMyTurn(game, meId) &&
        !diceReady() &&
        (game.dice || []).length
      ) {
        $('las-status').textContent =
          diceAnim.stage === 'rolling'
            ? t('lasidao.diceRolling')
            : t('lasidao.diceGrouping');
      } else {
        $('las-status').textContent = t('lasidao.statusProduce');
      }
    } else if (game.phase === 'settle') {
      $('las-status').textContent = t('lasidao.statusSettle');
    } else if (game.phase === 'settle_act') {
      $('las-status').textContent = settleDiscardStatusText(game, meId);
    } else if (game.phase === 'wish_well') {
      const me = mePlayer(game, meId);
      const need = me ? Number(me.pendingWishWellBonus) || 0 : 0;
      if (need > 0) {
        $('las-status').textContent = t('lasidao.statusWishWell');
      } else if (Array.isArray(game.wishWellPending) && game.wishWellPending.length) {
        $('las-status').textContent = t('lasidao.statusWishWellWait', {
          names: game.wishWellPending.map((p) => p.name).join('、'),
        });
      } else {
        $('las-status').textContent = t('lasidao.statusWishWell');
      }
    } else if (game.phase === 'event_mercenary') {
      const merc = game.mercenary;
      if (
        game.pendingEventChoice &&
        game.pendingEventChoice.forMe
      ) {
        $('las-status').textContent = t('lasidao.statusEventChoice', {
          name:
            game.pendingEventChoice.label || t('lasidao.environmentSlot'),
        });
      } else if (merc && merc.forMe) {
        $('las-status').textContent = t('lasidao.statusEventMercenary');
      } else {
        $('las-status').textContent = t('lasidao.statusEventMercenaryWait');
      }
    } else if (game.phase === 'event_discard') {
      const n = Number(game.pendingPrisonerDiscard) || 0;
      if (n > 0 && isMyTurn(game, meId)) {
        $('las-status').textContent = t('lasidao.statusEventPrisoner', { n });
      } else {
        $('las-status').textContent = t('lasidao.statusEventPrisonerWait');
      }
    } else if (game.phase === 'build') {
      $('las-status').textContent = t('lasidao.statusBuild');
    } else if (
      game.pendingEventChoice &&
      game.pendingEventChoice.forMe
    ) {
      $('las-status').textContent = t('lasidao.statusEventChoice', {
        name: game.pendingEventChoice.label || t('lasidao.environmentSlot'),
      });
    } else if (isMyTurn(game, meId)) {
      $('las-status').textContent = phaseLabel(game.phase);
    } else {
      const cur = (game.players || []).find(
        (p) => p.id === game.currentPlayerId
      );
      $('las-status').textContent = cur
        ? t('lasidao.statusPlayerPhase', {
            name: cur.name,
            phase: phaseLabel(game.phase),
          })
        : phaseLabel(game.phase);
    }

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
    // 结算动画期间冻结手牌区；板块区用当前状态以保留最后一次派遣的村民显示
    const handGame = ((willPlaySettle || settlePlaying) && _prevGame) ? _prevGame : game;

    renderDice(game, meId, _prevGame);
    renderProduceIdleBar(game);
    const boardGame =
      dispatchBoardFreeze ||
      (peekPendingOpponentDispatch(game) && _prevGame) ||
      game;
    renderBoard(boardGame, meId);
    maybePlayDeal(game, _prevGame);
    applyDeckUi(game);
    renderMe(handGame, meId);
    maybePlayProduceFx(game, _prevGame);
    renderBuildHand(handGame, meId);
    renderPlayers(handGame, meId);

    syncWishWellModal(game, meId);
    syncEventUi(game, meId);

    maybePlaySettle(game);
    maybeShowVictoryModal(game, meId);
    maybeShowTurnToast(game, meId);

    if (game.over) {
      const buildHandWrap = $('las-build-hand-wrap');
      if (buildHandWrap) buildHandWrap.hidden = true;
      const actWrapOver = $('las-act-wrap');
      if (actWrapOver) actWrapOver.hidden = true;
      const permActOver = $('las-permanent-actions');
      if (permActOver) permActOver.hidden = true;
      const phaseActOver = $('las-phase-actions');
      if (phaseActOver) phaseActOver.hidden = true;
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

    const phaseAct = $('las-phase-actions');
    const passBtn = $('btn-las-pass');
    if (phaseAct) {
      const showPass =
        game.phase === 'build' &&
        isMyTurn(game, meId) &&
        !(game.me && game.me.buildPassed);
      phaseAct.hidden = !showPass;
      if (passBtn) {
        passBtn.disabled = !showPass;
        passBtn.textContent = t('lasidao.passBuild');
      }
    }
    // 常驻功能按钮（建造房子 / 兑换 / 繁殖村民）
    const permAct = $('las-permanent-actions');
    const buildHouseBtn = $('btn-las-build-house');
    const breedBtn = $('btn-las-breed');
    const expandPermBtn = $('btn-las-expand-perm');
    const exBtnAct = $('btn-las-exchange');
    const resetBuildBtn = $('btn-las-reset-build');
    if (permAct) {
      const showPerm =
        game.phase === 'build' &&
        isMyTurn(game, meId) &&
        !(game.me && game.me.buildPassed);
      permAct.hidden = !showPerm;
      const me = mePlayer(game, meId);
      if (me && showPerm) {
        if (buildHouseBtn) {
          const houseCost = game.buildHouseCost || { wood: 4, stone: 3, iron: 2 };
          const canHouse = canPay(me.resources || {}, houseCost);
          buildHouseBtn.disabled = !canHouse;
          buildHouseBtn.title = canHouse
            ? t('lasidao.buildHouseTooltip')
            : t('lasidao.buildHouseLack');
        }
        if (exBtnAct) {
          const exCount2 =
            game.me && game.me.exchangeCount != null
              ? Number(game.me.exchangeCount)
              : Math.min(
                  (me.buildings || []).filter(
                    (b) => b.built && b.buildType === 'exchange'
                  ).length,
                  3
                );
          const need2 =
            game.me && game.me.exchangeCost != null
              ? Number(game.me.exchangeCost)
              : exCount2 === 0
                ? 4
                : exCount2 === 1
                  ? 3
                  : exCount2 === 2
                    ? 2
                    : 1;
          const canEx = RESOURCES.some((r) => (me.resources[r] || 0) >= need2);
          exBtnAct.disabled = !canEx;
        }
        if (breedBtn) {
          const breedRate = game.breedFoodPerVillager != null ? game.breedFoodPerVillager : 1;
          const needFood = (me.villagers || 0) * breedRate;
          const maxV = game.maxVillagers != null ? game.maxVillagers : 15;
          const houses =
            me.houses != null
              ? me.houses
              : game.me && game.me.houses != null
                ? game.me.houses
                : 3;
          const freeHouses =
            me.freeHouses != null
              ? me.freeHouses
              : game.me && game.me.freeHouses != null
                ? game.me.freeHouses
                : Math.max(0, houses - (me.villagers || 0));
          const atCap = me.villagers >= maxV;
          const noHouse = freeHouses <= 0;
          const noFood = (me.resources.food || 0) < needFood;
          const canBreed = !atCap && !noHouse && !noFood;
          breedBtn.disabled = !canBreed;
          if (canBreed) {
            breedBtn.title = t('lasidao.breedTooltip', {
              need: needFood,
              free: freeHouses,
              houses,
            });
          } else if (atCap) {
            breedBtn.title = t('lasidao.breedLackCap', { max: maxV });
          } else if (noHouse) {
            breedBtn.title = t('lasidao.breedLackHouse', {
              houses,
              villagers: me.villagers || 0,
            });
          } else {
            breedBtn.title = t('lasidao.breedLack', { need: needFood });
          }
          if (selectedPermanent === 'breed' && !canBreed) {
            selectedPermanent = null;
          }
        }
        if (expandPermBtn) {
          const expandCost =
            (game.me && game.me.expandPermanentCost) ||
            { wood: 2, stone: 2 };
          const canExpand = canPay(me.resources || {}, expandCost);
          expandPermBtn.disabled = !canExpand;
          expandPermBtn.title = canExpand
            ? t('lasidao.expandPermanentTip', {
                wood: expandCost.wood,
                stone: expandCost.stone,
                n: (game.me && game.me.expandCount) || 0,
              })
            : t('lasidao.expandPermanentLack', {
                wood: expandCost.wood,
                stone: expandCost.stone,
              });
        }
        if (resetBuildBtn) {
          resetBuildBtn.disabled = false;
        }
        syncPermanentSelection(game, me);
      } else {
        selectedPermanent = null;
        syncPermanentSelection(game, me);
      }
    }
    // 结算行动：仅有待弃牌时显示行动区，弃完自动推进，不显示跳过
    if (
      phaseAct &&
      game.phase === 'settle_act'
    ) {
      phaseAct.hidden = true;
      if (passBtn) passBtn.disabled = true;
    }

    const actWrap = $('las-act-wrap');
    if (actWrap) {
      actWrap.hidden = !shouldShowActRail(game, meId);
    }

    // ????????? renderDice ????????????
    const voidBtn = $('btn-las-void');
    if (voidBtn && game.phase !== 'produce') {
      voidBtn.hidden = true;
    }
    const produceActions = $('las-produce-actions');
    if (produceActions && game.phase !== 'produce') {
      produceActions.hidden = true;
    }

    const log = $('las-log');
    log.innerHTML = '';
    for (const row of (game.log || []).slice().reverse()) {
      const li = document.createElement('li');
      li.textContent = row.text;
      log.appendChild(li);
    }
  }

  function maybePlaySettle(game) {
    const report = game && game.lastSettle;
    if (!report || !report.at) return;
    const key = (report.round || '') + ':' + report.at;
    if (settleAnimKey === key || settlePlaying) return;
    if (
      !['settle', 'settle_act', 'wish_well', 'build', 'over'].includes(
        game.phase
      )
    ) {
      return;
    }
    settleAnimKey = key;
    settlePlaying = true;
    const status = $('las-status');
    const prev = status ? status.textContent : '';
    if (status) status.textContent = t('lasidao.statusSettle');
    const fx = window.LasidaoFx;
    const boardRoot = $('las-playfield') || document.body;
    if (boardRoot) boardRoot.classList.add('las-settling');

    const finishUi = () => {
      settlePlaying = false;
      if (boardRoot) boardRoot.classList.remove('las-settling');
      if (netRef) {
        netRef.sendAction('finishSettleAnim', {});
      }
      if (lastGame && lastMeId) {
        renderBoard(lastGame, lastMeId);
        renderMe(lastGame, lastMeId);
        renderBuildHand(lastGame, lastMeId);
        renderPlayers(lastGame, lastMeId);
        renderActRail(lastGame, lastMeId);
        renderPlayerBoards(lastGame, lastMeId);
        applyDeckUi(lastGame);
      }
      if (status && lastGame) {
        if (lastGame.phase === 'settle') {
          status.textContent = t('lasidao.statusSettle');
        } else if (lastGame.over) {
          const names = (lastGame.winners || [])
            .map((id) => {
              const p = (lastGame.players || []).find((x) => x.id === id);
              return p ? p.name : id;
            })
            .join(', ');
          status.textContent = t('lasidao.statusOver', {
            names: names || t('lasidao.statusOverNobody'),
          });
        } else if (isMyTurn(lastGame, lastMeId)) {
          status.textContent = t('lasidao.statusYourTurn');
        } else {
          status.textContent = prev || t('lasidao.statusWait');
        }
      }
      if (lastGame && lastGame.over) {
        maybeShowVictoryModal(lastGame, lastMeId);
      }
    };

    const run = async () => {
      if (fx && typeof fx.playSettle === 'function') {
        await fx.playSettle(game);
      }
      // 结算演绎结束：工人已在服务端清空，立刻刷新版面去掉骰子
      if (lastGame && lastMeId) {
        renderBoard(lastGame, lastMeId);
      }
      // 停顿后再播卡牌回收
      await new Promise((r) => setTimeout(r, 2000));
      const boardSnap = lastGame || game;
      if (fx && typeof fx.playRecycleBoard === 'function') {
        await fx.playRecycleBoard(boardSnap);
      }
    };

    Promise.resolve(run()).then(finishUi).catch(finishUi);
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
    const LasFx = window.LasidaoFx;
    const finish = () => {
      produceFxPlaying = false;
      if (LasFx && typeof LasFx.clearLayer === 'function') LasFx.clearLayer();
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
          if (lastGame) renderBoard(lastGame, lastMeId);
          finish();
        })
        .catch(() => {
          dispatchBoardFreeze = null;
          if (lastGame) renderBoard(lastGame, lastMeId);
          finish();
        });
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
      const stage = $('las-dice-stage') || $('las-dice') || $('las-side-rail');
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

  async function confirmDispatch() {
    if (!netRef || !selectedTarget || dispatchBusy) return;
    const remote = lastGame && isRemoteMode(lastGame);
    const face = selectedFace;
    if (face == null) return;

    let count = 1;
    let payload;
    if (remote) {
      if (!selectedWildCount) return;
      count = selectedWildCount;
      payload = {
        face,
        count,
      };
      if (selectedTarget.type === 'area') payload.area = selectedTarget.area;
      else payload.buildingId = selectedTarget.buildingId;
    } else {
      count = countByFace(diceAnim.finalDice)[face] || 1;
      payload = { face };
      if (selectedTarget.type === 'area') {
        payload.area = selectedTarget.area;
      } else {
        payload.buildingId = selectedTarget.buildingId;
      }
    }

    const color = playerDieColor(
      lastGame && lastGame.players,
      lastMeId,
      lastGame
    );
    const fromCenters = collectDispatchFromCenters(remote, face, count);
    const fx = window.LasidaoFx;
    dispatchBusy = true;
    try {
      if (fx && typeof fx.playDispatch === 'function') {
        await fx.playDispatch({
          face,
          count,
          color,
          fromCenters,
          area: payload.area,
          number:
            selectedTarget.type === 'area'
              ? selectedTarget.number
              : face,
          buildingId: payload.buildingId,
        });
      }
      if (fx && typeof fx.clearLayer === 'function') fx.clearLayer();
      netRef.sendAction('placeDice', payload);
      resetDiceAnim();
    } finally {
      dispatchBusy = false;
    }
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

  function resetExchangeSelection() {
    exFrom = null;
    exFromBatches = 0;
    exTo = null;
    exToBatches = 0;
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
      robberyTargetId = null;
    }
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

  function renderRedrawModal() {
    const hint = $('las-redraw-hint');
    const confirmBtn = $('btn-las-redraw-confirm');
    const backEl = $('las-redraw-deck-top-back');
    const labelEl = $('las-redraw-top-label');
    const game = lastGame;
    const topKind = game && game.specialDeckTopKind;
    const Assets = window.LasidaoAssets;
    const kindName =
      topKind === 'building'
        ? t('lasidao.deckBuilding')
        : topKind === 'function'
          ? t('lasidao.deckFunction')
          : t('lasidao.redrawTopUnknown');
    if (hint) {
      hint.textContent = topKind
        ? t('lasidao.redrawHintTop', { name: kindName })
        : t('lasidao.redrawHintEmpty');
    }
    if (labelEl) labelEl.textContent = kindName;
    if (backEl && Assets && Assets.cardBackImageUrl) {
      const backKind = topKind === 'building' ? 'building' : 'function';
      const url = Assets.cardBackImageUrl(backKind);
      if (url) {
        backEl.style.backgroundImage = 'url("' + url + '")';
        backEl.style.backgroundSize = 'cover';
        backEl.style.backgroundPosition = 'center';
      }
    }
    if (confirmBtn) {
      const left =
        (game && game.decksLeft && game.decksLeft.special) || 0;
      const disc =
        (game && game.discardsLeft && game.discardsLeft.special) || 0;
      confirmBtn.disabled = left + disc <= 0;
    }
  }

  function setExpandModalOpen(open) {
    const modal = $('las-expand-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (!open) {
      expandCardId = null;
      expandDirection = null;
    } else {
      if (window.I18n && window.I18n.applyDom) {
        window.I18n.applyDom(modal);
      }
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

  function setExileModalOpen(open) {
    const modal = $('las-exile-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (!open) {
      exileCardId = null;
      exileArea = null;
      exileNumber = null;
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

  function renderExileSlotStep(game) {
    const title = $('las-exile-title');
    const body = $('las-exile-body');
    const backBtn = $('btn-las-exile-back');
    if (!title || !body) return;

    title.textContent = t('lasidao.exilePickSlot');
    body.innerHTML = '';
    if (backBtn) backBtn.hidden = true;

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
      const names = s.entries
        .map(([pid, c]) => {
          const p = (game.players || []).find((pl) => pl.id === pid);
          return (p ? p.name : pid) + '×' + c;
        })
        .join('、');
      btn.innerHTML = '<span class="slot-name">' + escapeHtml(slotLabel) + '</span><span class="slot-workers">' + escapeHtml(names) + '</span>';
      btn.onclick = () => {
        exileArea = s.area;
        exileNumber = s.number;
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
      backBtn.onclick = () => renderExileSlotStep(game);
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
      const p = (game.players || []).find((pl) => pl.id === pid);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = (p ? p.name : pid) + ' ×' + c;
      btn.onclick = () => {
        if (!netRef || !exileCardId) return;
        netRef.sendAction('useFunc', {
          cardId: exileCardId,
          targetId: pid,
          area: exileArea,
          number: exileNumber,
        });
        selectedFuncId = null;
        setExileModalOpen(false);
      };
      wrap.appendChild(btn);
    }
    body.appendChild(wrap);
  }

  function setVoidSkipModalOpen(open) {
    const modal = $('las-void-skip-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (open) {
      voidSkipRes = null;
      renderVoidSkipModal();
      if (window.I18n && window.I18n.applyDom) {
        window.I18n.applyDom(modal);
      }
    } else {
      voidSkipRes = null;
    }
  }

  function renderVoidSkipModal() {
    const body = $('las-void-skip-body');
    const confirmBtn = $('btn-las-void-skip-confirm');
    const game = lastGame;
    if (!body) return;
    body.innerHTML = '';

    const labels = getResLabels(game);
    const Assets = window.LasidaoAssets;

    const grid = document.createElement('div');
    grid.className = 'las-void-skip-grid';
    for (const res of RESOURCES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'las-void-skip-item' + (voidSkipRes === res ? ' is-selected' : '');

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
  }

  function setHarvestModalOpen(open) {
    const modal = $('las-harvest-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (!open) {
      harvestCardId = null;
      harvestCounts = {};
    } else {
      if (window.I18n && window.I18n.applyDom) {
        window.I18n.applyDom(modal);
      }
    }
  }

  function renderHarvestModal() {
    const body = $('las-harvest-body');
    if (!body) return;
    body.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'las-harvest-grid';
    const Assets = window.LasidaoAssets;
    const labels = defaultResLabels();

    for (const res of RESOURCES) {
      const item = document.createElement('div');
      item.className = 'las-harvest-item';
      item.dataset.res = res;

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
        if (total < 2) {
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
      totalEl.textContent = total + ' / 2';
    }
    if (confirmBtn) {
      confirmBtn.disabled = total !== 2;
    }
    document.querySelectorAll('.las-harvest-item').forEach((item) => {
      const res = item.dataset.res;
      if (!res) return;
      const c = harvestCounts[res] || 0;
      const minus = item.querySelector('.las-harvest-minus');
      const plus = item.querySelector('.las-harvest-plus');
      const countSpan = item.querySelector('.las-harvest-count');
      if (minus) minus.disabled = c <= 0;
      if (plus) plus.disabled = total >= 2;
      if (countSpan) countSpan.textContent = String(c);
    });
  }

  function renderRobberyPlayerStep(game, card) {
    const title = $('las-robbery-title');
    const body = $('las-robbery-body');
    const confirmBtn = $('btn-las-robbery-confirm');
    const cancelBtn = $('btn-las-robbery-cancel');
    if (!title || !body || !confirmBtn || !cancelBtn) return;

    title.textContent = t('lasidao.robberyPickTarget');
    body.innerHTML = '';
    confirmBtn.hidden = true;
    cancelBtn.hidden = false;
    cancelBtn.textContent = t('lasidao.cancel');

    const players = (game.players || []).filter(
      (p) => !p.left && p.id !== lastMeId && Object.values(p.resources || {}).some((v) => v > 0)
    );

    if (!players.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = t('lasidao.robberyNoTarget');
      body.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'las-robbery-players';
    for (const p of players) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = p.name;
      btn.onclick = () => {
        robberyTargetId = p.id;
        renderRobberyResourceStep(game, card);
      };
      wrap.appendChild(btn);
    }
    body.appendChild(wrap);
  }

  function renderRobberyResourceStep(game, card) {
    const title = $('las-robbery-title');
    const body = $('las-robbery-body');
    const confirmBtn = $('btn-las-robbery-confirm');
    const cancelBtn = $('btn-las-robbery-cancel');
    if (!title || !body || !confirmBtn || !cancelBtn) return;

    const target = (game.players || []).find((p) => p.id === robberyTargetId);
    if (!target) return;

    title.textContent = t('lasidao.robberyPickResource', { name: target.name });
    body.innerHTML = '';
    confirmBtn.hidden = true;
    cancelBtn.hidden = true;

    const grid = document.createElement('div');
    grid.className = 'las-robbery-res-grid';
    const Assets = window.LasidaoAssets;
    const labels = getResLabels(game);

    for (const [k, v] of Object.entries(target.resources || {})) {
      if (v <= 0) continue;
      const group = document.createElement('div');
      group.className = 'las-robbery-res-group';
      for (let i = 0; i < v; i++) {
        const cardEl = document.createElement('div');
        cardEl.className = 'las-robbery-res-card';
        const url = Assets && Assets.resourceHandImageUrl ? Assets.resourceHandImageUrl(k) : '';
        if (url) cardEl.style.backgroundImage = 'url("' + url + '")';
        cardEl.title = labels[k] || k;
        cardEl.onclick = () => {
          if (!netRef) return;
          netRef.sendAction('useFunc', {
            cardId: card.id,
            targetId: target.id,
            resource: k,
          });
          selectedFuncId = null;
          setRobberyModalOpen(false);
        };
        group.appendChild(cardEl);
      }
      const count = document.createElement('span');
      count.className = 'las-robbery-res-count';
      count.textContent = (labels[k] || k) + ' × ' + v;
      group.appendChild(count);
      grid.appendChild(group);
    }

    body.appendChild(grid);
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
        : Math.min(exBuilt, 3);
    const need =
      game.me && game.me.exchangeCost != null
        ? Number(game.me.exchangeCost)
        : exCount === 0
          ? 4
          : exCount === 1
            ? 3
            : exCount === 2
              ? 2
              : 1;
    const labels = getResLabels(game);
    const Assets = window.LasidaoAssets;

    const rateHint = $('las-exchange-rate-hint');
    if (rateHint) {
      rateHint.textContent = exCount === 0
        ? t('lasidao.exchangeHintDefault', { n: need })
        : t('lasidao.exchangeHint', { count: exCount, n: need });
    }

    function maxFromBatches(res) {
      return Math.floor((me.resources[res] || 0) / need);
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
        row.className = 'row las-ex-item-row';

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
        const batches = isFrom
          ? exFrom === r
            ? exFromBatches
            : 0
          : exTo === r
            ? exToBatches
            : 0;
        // 左侧：显示实际消耗张数（比例×次数，如 4/8/12）；右侧：换入张数即次数
        countSpan.textContent = String(isFrom ? batches * need : batches);
        cardEl.appendChild(countSpan);

        const plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'las-ex-plus';
        plus.textContent = '+';

        const label = document.createElement('div');
        label.className = 'las-ex-label';
        label.textContent = (labels[r] || r) + ' ×' + qty;

        if (isFrom) {
          minus.disabled = exFrom !== r || exFromBatches <= 0;
          minus.onclick = () => {
            if (exFrom !== r || exFromBatches <= 0) return;
            exFromBatches -= 1;
            if (exFromBatches <= 0) {
              exFrom = null;
              exTo = null;
              exToBatches = 0;
            } else {
              // 换出次数变少后，换入需重新点满，先清零
              exTo = null;
              exToBatches = 0;
            }
            renderExchangeModal();
          };
          plus.disabled = maxFromBatches(r) <= (exFrom === r ? exFromBatches : 0);
          plus.onclick = () => {
            if (exFrom !== r) {
              exFrom = r;
              exFromBatches = 0;
              exTo = null;
              exToBatches = 0;
            }
            if (exFromBatches >= maxFromBatches(r)) return;
            exFromBatches += 1;
            renderExchangeModal();
          };
          if (exFrom === r && exFromBatches > 0) item.classList.add('is-active');
        } else {
          minus.disabled = exTo !== r || exToBatches <= 0;
          minus.onclick = () => {
            if (exTo !== r || exToBatches <= 0) return;
            exToBatches -= 1;
            if (exToBatches <= 0) exTo = null;
            renderExchangeModal();
          };
          plus.disabled =
            exFromBatches <= 0 ||
            r === exFrom ||
            (exTo === r ? exToBatches : 0) >= exFromBatches;
          plus.onclick = () => {
            if (exFromBatches <= 0 || r === exFrom) return;
            if (exTo !== r) {
              exTo = r;
              exToBatches = 0;
            }
            if (exToBatches >= exFromBatches) return;
            exToBatches += 1;
            renderExchangeModal();
          };
          if (exTo === r && exToBatches > 0) item.classList.add('is-active');
        }

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
    const ready =
      Boolean(exFrom) &&
      Boolean(exTo) &&
      exFrom !== exTo &&
      exFromBatches > 0 &&
      exToBatches === exFromBatches;
    if (confirmBtn) {
      confirmBtn.disabled = !ready;
      if (ready) {
        confirmBtn.textContent = t('lasidao.exchangeConfirm', {
          n: need,
          from: labels[exFrom] || exFrom,
          to: labels[exTo] || exTo,
          times: exFromBatches,
          spend: need * exFromBatches,
          gain: exFromBatches,
        });
      } else if (exFromBatches > 0 && exToBatches !== exFromBatches) {
        confirmBtn.textContent = t('lasidao.exchangeNeedMatch', {
          left: exFromBatches,
          right: exToBatches,
        });
      } else {
        confirmBtn.textContent = t('lasidao.exchangeBtnN', { n: need });
      }
    }
    if (resetBtn) {
      const hasPick =
        exFromBatches > 0 || exToBatches > 0 || exFrom || exTo;
      resetBtn.disabled = !hasPick;
    }
  }

  function bindButtons(net) {
    netRef = net;
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
    const rulesBtn = $('btn-las-rules');
    if (rulesBtn) {
      rulesBtn.onclick = () => setRulesModalOpen(true);
    }
    const rulesClose = $('btn-las-rules-close');
    if (rulesClose) {
      rulesClose.onclick = () => setRulesModalOpen(false);
    }
    const rulesBackdrop = $('las-rules-backdrop');
    if (rulesBackdrop) {
      rulesBackdrop.onclick = () => setRulesModalOpen(false);
    }
    const rollBtn = $('btn-las-produce-roll');
    if (rollBtn) {
      rollBtn.onclick = () => net.sendAction('produceRoll', {});
    }
    const remoteBtn = $('btn-las-remote-dice');
    if (remoteBtn) {
      remoteBtn.onclick = () => {
        const me = lastGame && mePlayer(lastGame, lastMeId);
        const card =
          me &&
          (me.funcCards || []).find((c) => c.funcType === 'remoteDice');
        if (!card) return;
        net.sendAction('useFunc', { cardId: card.id });
      };
    }
    const initBtn = $('btn-las-init-roll');
    if (initBtn) {
      initBtn.onclick = () => net.sendAction('initRoll', {});
    }
    const voidBtn = $('btn-las-void');
    if (voidBtn) {
      voidBtn.onclick = () => setVoidSkipModalOpen(true);
    }
    const voidSkipBackdrop = $('las-void-skip-backdrop');
    if (voidSkipBackdrop) {
      voidSkipBackdrop.onclick = () => setVoidSkipModalOpen(false);
    }
    const voidSkipCancel = $('btn-las-void-skip-cancel');
    if (voidSkipCancel) {
      voidSkipCancel.onclick = () => setVoidSkipModalOpen(false);
    }
    const voidSkipConfirm = $('btn-las-void-skip-confirm');
    if (voidSkipConfirm) {
      voidSkipConfirm.onclick = () => {
        if (!voidSkipRes || !netRef) return;
        resetDiceAnim();
        netRef.sendAction('voidSkip', { resource: voidSkipRes });
        setVoidSkipModalOpen(false);
      };
    }
    const confirmBtn = $('btn-las-confirm');
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        if (isBarrenMarkerPickMode(lastGame, lastMeId)) {
          confirmBarrenMarkerPlace();
          return;
        }
        if (isNeutralPickMode(lastGame, lastMeId)) {
          confirmNeutralPlace();
          return;
        }
        confirmDispatch();
      };
    }
    const passBtn = $('btn-las-pass');
    if (passBtn) {
      passBtn.onclick = () => net.sendAction('pass', {});
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
        selectPermanent('exchange', lastGame, me);
      };
    }
    const resetBuildBtn = $('btn-las-reset-build');
    if (resetBuildBtn) {
      resetBuildBtn.onclick = () => net.sendAction('resetBuildTurn', {});
    }
    const exBackdrop = $('las-exchange-backdrop');
    if (exBackdrop) {
      exBackdrop.onclick = () => setExchangeModalOpen(false);
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
        if (
          !exFrom ||
          !exTo ||
          exFrom === exTo ||
          exFromBatches <= 0 ||
          exToBatches !== exFromBatches
        ) {
          return;
        }
        net.sendAction('exchange', {
          from: exFrom,
          to: exTo,
          count: exFromBatches,
        });
        setExchangeModalOpen(false);
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
    const robBackdrop = $('las-robbery-backdrop');
    if (robBackdrop) {
      robBackdrop.onclick = () => setRobberyModalOpen(false);
    }
    const robCancel = $('btn-las-robbery-cancel');
    if (robCancel) {
      robCancel.onclick = () => setRobberyModalOpen(false);
    }

    // Redraw modal bindings
    const redrawBackdrop = $('las-redraw-backdrop');
    if (redrawBackdrop) {
      redrawBackdrop.onclick = () => setRedrawModalOpen(false);
    }
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
        setRedrawModalOpen(false);
        selectedFuncId = null;
      };
    }
    bindRedrawDeckClicks();

    // Harvest modal bindings
    const harvestBackdrop = $('las-harvest-backdrop');
    if (harvestBackdrop) {
      harvestBackdrop.onclick = () => setHarvestModalOpen(false);
    }
    const harvestCancel = $('btn-las-harvest-cancel');
    if (harvestCancel) {
      harvestCancel.onclick = () => setHarvestModalOpen(false);
    }
    const harvestConfirm = $('btn-las-harvest-confirm');
    if (harvestConfirm) {
      harvestConfirm.onclick = () => {
        if (!harvestCardId) return;
        const total = Object.values(harvestCounts).reduce((a, b) => a + b, 0);
        if (total !== 2) return;
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
      };
    }

    // 扩建弹窗绑定
    const expandBackdrop = $('las-expand-backdrop');
    if (expandBackdrop) {
      expandBackdrop.onclick = () => setExpandModalOpen(false);
    }
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
    const exileBackdrop = $('las-exile-backdrop');
    if (exileBackdrop) {
      exileBackdrop.onclick = () => setExileModalOpen(false);
    }
    const exileCancel = $('btn-las-exile-cancel');
    if (exileCancel) {
      exileCancel.onclick = () => setExileModalOpen(false);
    }

    // Bandit modal bindings
    const banditBackdrop = $('las-bandit-backdrop');
    if (banditBackdrop) {
      banditBackdrop.onclick = () => setBanditModalOpen(false);
    }
    const banditCancel = $('btn-las-bandit-cancel');
    if (banditCancel) {
      banditCancel.onclick = () => setBanditModalOpen(false);
    }

  }

  window.addEventListener('i18n:change', () => {
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
    openRules: () => setRulesModalOpen(true),
  };
})();
