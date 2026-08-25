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
    const n = Number(p && p.expandSlots) || 0;
    const out = ['none'];
    for (let i = 1; i <= n; i++) {
      out.push('none:' + i);
    }
    return out;
  }

  function isNoneSlotKey(slot) {
    return (
      slot === 'none' ||
      (typeof slot === 'string' && /^none(:\d+)?$/.test(slot))
    );
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
    redraw: 'lasidao.func.redraw',
    banditRaid: 'lasidao.func.banditRaid',
    expand: 'lasidao.func.expand',
    robbery: 'lasidao.func.robbery',
  };

  const PRODUCE_FUNC = new Set(['remoteDice', 'exile', 'banditRaid']);
  const BUILD_FUNC = new Set(['harvest', 'robbery', 'redraw', 'expand']);

  function canPlayFuncCard(game, meId, funcType) {
    if (!game || !meId || !funcType) return false;
    if (!isMyTurn(game, meId)) return false;
    if (game.phase === 'produce') return PRODUCE_FUNC.has(funcType);
    if (game.phase === 'build') {
      const me = mePlayer(game, meId);
      if (me && me.buildPassed) return false;
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
  let redrawSelectedDeck = null;

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

  /** ?????? */
  let diceAnim = {
    key: null,
    stage: 'idle', // idle | rolling | grouping | ready
    timers: [],
    intervals: [],
    finalDice: [],
  };

  let initAnimKey = null;
  let initAnimPlayingUntil = 0;
  let lastGamePhase = null;
  let settleAnimKey = null;
  let settlePlaying = false;
  let knownBoardTiles = null; // Set of tile ids
  let pendingDealIds = new Set();
  let dealAnimPlaying = false;
  let dealtForRound = null; // ???????????
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

  function supportsCssZoom() {
    try {
      return typeof CSS !== 'undefined' && CSS.supports && CSS.supports('zoom', '1');
    } catch (e) {
      return false;
    }
  }

  function updateLasScale() {
    const panel = $('panel-lasidao');
    if (!panel || panel.hidden) return;
    const scale =
      Math.min(
        window.innerWidth / LAS_DESIGN_W,
        window.innerHeight / LAS_DESIGN_H
      ) * LAS_SCALE_BOOST;
    const s = Math.round(Math.max(0.4, Math.min(scale, 3)) * 1000) / 1000;
    panel.style.setProperty('--las-ui-scale', String(s));
    panel.dataset.uiScale = String(s);
    panel.classList.remove('las-scale-zoom', 'las-scale-transform');
  }

  function bindLasScale() {
    if (lasScaleBound) return;
    lasScaleBound = true;
    window.addEventListener('resize', updateLasScale);
    window.addEventListener('orientationchange', updateLasScale);
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
    const panel = $('panel-lasidao');
    if (supportsCssZoom()) {
      if (panel && tip.parentNode !== panel) panel.appendChild(tip);
    } else if (tip.parentNode !== document.body) {
      document.body.appendChild(tip);
    }
    return tip;
  }

  function hideCardTip() {
    const tip = $('las-card-tip');
    if (!tip) return;
    tip.hidden = true;
    tip.innerHTML = '';
    tip.classList.remove('has-preview');
    tip._lasTipText = '';
    tip._lasTipImg = '';
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

  function showCardTip(text, evt, anchorEl, imgUrl) {
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

  function functionDetail(tile) {
    if (tile && tile.faceDown) {
      return t('lasidao.faceDown') + '\n' + t('lasidao.faceDownTip');
    }
    const name = tile.label || 'func';
    const rule = funcRuleText(tile.funcType) || tile.funcType || '';
    return name + '\n' + rule;
  }

  function buildingDetail(tile, labels) {
    if (tile && tile.faceDown) {
      return t('lasidao.faceDown') + '\n' + t('lasidao.faceDownTip');
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
    const kind = tile.kind || areaKey;
    if (kind === 'resource' || areaKey === 'resource') {
      return resourceDetail(tile);
    }
    if (kind === 'function' || areaKey === 'function') {
      return functionDetail(tile);
    }
    return buildingDetail(tile, labels);
  }

  function tileImageUrl(tile, areaKey) {
    const Assets = window.LasidaoAssets;
    if (!Assets) return '';
    const kind = (tile && tile.kind) || areaKey;
    if (tile && tile.faceDown) {
      const backKind =
        kind === 'building' || areaKey === 'building'
          ? 'building'
          : kind === 'function' || areaKey === 'function'
            ? 'function'
            : 'resource';
      return typeof Assets.cardBackImageUrl === 'function'
        ? Assets.cardBackImageUrl(backKind) || ''
        : '';
    }
    if (
      (kind === 'resource' || areaKey === 'resource') &&
      typeof Assets.resourceImageUrl === 'function'
    ) {
      return Assets.resourceImageUrl(tile) || '';
    }
    if (
      (kind === 'function' || areaKey === 'function') &&
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
    el.addEventListener('mouseenter', (e) => {
      showCardTip(text || '', e, el, imgUrl);
    });
    el.addEventListener('mousemove', (e) => {
      const tip = $('las-card-tip');
      if (!tip || tip.hidden) return;
      positionCardTip(tip, e, el);
    });
    el.addEventListener('mouseleave', () => hideCardTip());
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
      const backKind =
        areaKey === 'building' || tile.kind === 'building'
          ? 'building'
          : areaKey === 'function' || tile.kind === 'function'
            ? 'function'
            : 'resource';
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
        card.setAttribute('aria-label', t('lasidao.faceDown'));
      } else {
        const name = document.createElement('div');
        name.className = 'las-tile-name';
        name.textContent = t('lasidao.faceDown');
        card.appendChild(name);
        const meta = document.createElement('div');
        meta.className = 'las-tile-meta';
        meta.textContent = t('lasidao.faceDownHint');
        card.appendChild(meta);
      }
      bindTileTip(
        card,
        { label: t('lasidao.faceDown'), faceDown: true },
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
    if (areaKey === 'resource' && tile.large != null) {
      metaTxt = tile.large + '/' + tile.small;
    } else if (areaKey === 'building' && tile.buildType === 'produce') {
      metaTxt =
        tile.produce != null
          ? '?' + tile.produce
          : tile.rich
            ? '?2'
            : '?1';
    } else if (areaKey === 'building' && tile.buildType === 'score2') {
      metaTxt = '+' + (tile.score != null ? tile.score : 2);
    } else if (areaKey === 'building' && tile.buildType === 'exchange') {
      metaTxt = t('lasidao.tip.exchangeShort');
    } else if (areaKey === 'building' && tile.buildType === 'wishWell') {
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
    bindTileTip(el, { faceDown: true, label: t('lasidao.faceDown') }, areaKey === 'building' ? 'building' : 'function');
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
      const row = document.createElement('div');
      row.className = 'las-worker-row';
      row.dataset.pid = pid;
      const color = playerDieColor(players, pid, game);
      const count = Math.min(Number(n) || 0, 24);
      for (let i = 0; i < count; i++) {
        row.appendChild(makeDieEl(face, 'is-mini is-placed', color));
      }
      wrap.appendChild(row);
    }
    container.appendChild(wrap);
    return wrap;
  }

  function workersText(workers, players, game) {
    const parts = [];
    for (const [pid, n] of Object.entries(workers || {})) {
      if (!n) continue;
      parts.push(workerName(pid, players, game) + 'x' + n);
    }
    return parts.length ? parts.join(' ') : '';
  }

  function mePlayer(game, meId) {
    return (game.players || []).find((p) => p.id === meId) || null;
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

  /** 资源区每数字格第 idx 层（0 起）于第几轮解锁；每轮开放一格 */
  function resourceSlotUnlockRound(num, idx) {
    if (idx <= 0) return 1;
    return idx * 6 + num - 5;
  }

  /** 功能/建筑区 num 格于第几轮解锁 */
  function slotUnlockRound(areaKey, num) {
    if (areaKey === 'function') return Math.max(1, num - 1);
    if (areaKey === 'building') return num;
    return null;
  }

  /** ??????????????????1~6? */
  function areaOpenSlotCount(areaKey, round) {
    const n = Math.max(0, (round || 1) - 1);
    if (areaKey === 'function') return Math.min(6, 2 + n);
    if (areaKey === 'building') return Math.min(6, 1 + n);
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
    const canPickBase =
      game.phase === 'produce' && isMyTurn(game, meId) && diceReady();
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

      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'las-slot las-slot-' + areaKey;
      slot.dataset.area = areaKey;
      slot.dataset.num = String(num);
      const capacity = areaKey === 'resource' ? 3 : 1;
      slot.style.setProperty('--las-slot-card-count', String(capacity));

      const hasTiles = tiles.length > 0;
      // ??????????????????????????????
      const matchFace = remote ? true : faces.indexOf(num) >= 0;
      const dispatchable = canPick && matchFace && hasTiles;
      slot.disabled = !dispatchable;
      if (dispatchable) {
        slot.classList.add('is-target');
      } else if (canPickBase) {
        slot.classList.add('is-dimmed');
      }
      if (
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
        { overlay: true }
      );
      const wTxt = workersText(workers, game.players, game);
      if (diceRow && wTxt) diceRow.title = wTxt;
      slot.appendChild(numEl);

      const body = document.createElement('div');
      body.className = 'las-slot-body';
      const stack = document.createElement('div');
      stack.className = 'las-slot-tiles';

      const round = game.round || 1;
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
      slot.appendChild(body);

      slot.onclick = () => {
        if (!dispatchable) return;
        pickAreaTarget(areaKey, num);
      };
      boardEl.appendChild(slot);
    }

    // 建筑区不再提供派遣到个人建筑按钮（生产建筑建成后自动产出，无需放村民）

  }

  function collectBoardTileMap(game) {
    const map = new Map(); // id -> { area, number, label, faceDown, tile }
    for (const area of ['resource', 'function', 'building']) {
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
      }
    }
    return map;
  }

  function maybePlayDeal(game) {
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
    renderBoard(game, lastMeId);
    const fx = window.LasidaoFx;
    if (!fx || typeof fx.playDeal !== 'function') {
      pendingDealIds = new Set();
      renderBoard(game, lastMeId);
      return;
    }
    dealAnimPlaying = true;
    Promise.resolve(fx.playDeal(newcomers))
      .catch(() => {})
      .then(() => {
        pendingDealIds = new Set();
        dealAnimPlaying = false;
        if (lastGame) renderBoard(lastGame, lastMeId);
      });
  }

  function renderBoard(game, meId) {
    hideCardTip();
    renderAreaBoard(game, meId, 'resource');
    renderAreaBoard(game, meId, 'function');
    renderAreaBoard(game, meId, 'building');
  }

  function renderGroupedDice() {
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (!diceEl || !groupsEl) return;
    diceEl.hidden = true;
    diceEl.innerHTML = '';
    groupsEl.hidden = false;
    groupsEl.innerHTML = '';

    const counts = countByFace(diceAnim.finalDice);
    const faces = Object.keys(counts)
      .map(Number)
      .sort((a, b) => a - b);

    for (const face of faces) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'las-die-group';
      if (selectedFace === face) btn.classList.add('is-selected');
      else if (selectedFace != null) btn.classList.add('is-dim');

      const faceEl = document.createElement('span');
      faceEl.className = 'las-die las-die-face';
      faceEl.textContent = String(face);
      const mulEl = document.createElement('span');
      mulEl.className = 'las-die-mul';
      mulEl.textContent = '\u00d7' + counts[face];
      btn.appendChild(faceEl);
      btn.appendChild(mulEl);

      btn.title = t('lasidao.dieGroupTitle', {
        face,
        count: counts[face],
      });
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

  function startDiceAnimation(finalDice, meId) {
    clearDiceTimers();
    resetDiceSelection();
    diceAnim.stage = 'rolling';
    diceAnim.finalDice = finalDice.slice();

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
        'is-rolling',
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

  function startSpectatorDiceAnimation(finalDice, color, actorName) {
    clearDiceTimers();
    resetDiceSelection();
    diceAnim.stage = 'rolling';
    diceAnim.finalDice = finalDice.slice();

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
        'is-rolling',
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
      renderSpectatorDice(finalDice, color);
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
    const myColor = playerDieColor(game.players || [], meId);
    dice.forEach((val, idx) => {
      const el = makeDieEl(
        val === 0 ? t('lasidao.wildDie') : val,
        'is-wild' + (selectedWildIdx.has(idx) ? ' is-selected' : ''),
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

  function renderSpectatorDice(dice, color) {
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (!diceEl || !groupsEl) return;
    groupsEl.hidden = true;
    groupsEl.innerHTML = '';
    diceEl.hidden = false;
    diceEl.innerHTML = '';
    for (const v of dice) {
      diceEl.appendChild(
        makeDieEl(v === 0 ? t('lasidao.wildDie') : v, '', color)
      );
    }
  }

  function renderDice(game, meId, _prevGame) {
    const wrap = $('las-dice-wrap');
    if (!wrap) return;

    renderRollWrap(game, meId);

    const confirm = $('btn-las-confirm');
    const voidBtn = $('btn-las-void');
    const preview = $('las-dispatch-preview');
    const produceActions = $('las-produce-actions');

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
          startSpectatorDiceAnimation(dice, color, actorName);
        } else {
          diceAnim.stage = 'ready';
          renderSpectatorDice(dice, color);
        }
        return;
      }

      if (diceAnim.stage === 'ready') {
        renderSpectatorDice(dice, color);
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
      dice.join(',');

    if (diceAnim.key !== key) {
      diceAnim.key = key;
      resetDiceSelection();
      if (remote) {
        diceAnim.stage = 'ready';
        diceAnim.finalDice = dice.slice();
        renderRemoteDice(game, meId);
        updateDispatchPreview();
        updateDiceHint();
      } else {
        startDiceAnimation(dice, meId);
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
        if (interactive && player && player.pendingDiscardFunc) {
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

  function appendResourceDiscardRow(hand, game, me) {
    if (!me || !me.pendingDiscardRes) return;
    const labels = getResLabels(game);
    const Assets = window.LasidaoAssets;
    const tip = document.createElement('div');
    tip.className = 'muted las-pboard-tip';
    const max = game.me && game.me.maxResourceHand != null
      ? game.me.maxResourceHand
      : (me.maxResourceHand != null ? me.maxResourceHand : 10);
    const total = Object.values(me.resources || {}).reduce((a, b) => a + b, 0);
    tip.textContent = t('lasidao.discardResTip', { total, max });
    hand.appendChild(tip);
    const grid = document.createElement('div');
    grid.className = 'las-void-skip-grid';
    for (const res of RESOURCES) {
      if ((me.resources[res] || 0) < 1) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'las-void-skip-item';
      const cardEl = document.createElement('div');
      cardEl.className = 'las-void-skip-card';
      const url =
        Assets && Assets.resourceHandImageUrl
          ? Assets.resourceHandImageUrl(res)
          : '';
      if (url) cardEl.style.backgroundImage = 'url("' + url + '")';
      const qty = document.createElement('span');
      qty.className = 'las-void-skip-qty';
      qty.textContent = '×' + (me.resources[res] || 0);
      cardEl.appendChild(qty);
      const label = document.createElement('span');
      label.className = 'las-void-skip-label';
      label.textContent = labels[res] || res;
      btn.appendChild(cardEl);
      btn.appendChild(label);
      btn.onclick = () => {
        netRef && netRef.sendAction('discardResource', { resource: res });
      };
      grid.appendChild(btn);
    }
    hand.appendChild(grid);
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
      return;
    }

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
      if (me.pendingDiscardBuild) {
        const tip = document.createElement('div');
        tip.className = 'muted las-pboard-tip';
        tip.textContent = t('lasidao.discardBuildTip', {
          n: me.maxBuildings || game.maxBuildings || 3,
        });
        hand.appendChild(tip);
        const bLab = document.createElement('div');
        bLab.className = 'las-pboard-label';
        bLab.textContent = t('lasidao.actRailBuilds');
        hand.appendChild(bLab);
        const builds = document.createElement('div');
        builds.className = 'las-cards las-act-cards';
        for (const b of me.buildings || []) {
          builds.appendChild(makeBoardBuildingCard(game, meId, me, b, true));
        }
        hand.appendChild(builds);
      }
      if (me.pendingDiscardFunc) {
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

    const buildPhasePlayable = ['harvest', 'robbery', 'redraw', 'expand'];
    // 功能卡：点选，确认发动走下方 play-bar
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

    // 建筑（未建）：点选，确认建造/放置走 play-bar
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
          'las-build-card build' +
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
        netRef.sendAction('placeBuildingSlot', {
          buildingId: b.id,
          slot: 'none',
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
      const hint = $('las-expand-hint');
      const confirmBtn = $('btn-las-expand-confirm');
      if (hint) hint.textContent = '';
      if (confirmBtn) confirmBtn.disabled = true;
      document
        .querySelectorAll('.las-expand-option')
        .forEach((d) => d.classList.remove('is-selected'));
      setExpandModalOpen(true);
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
      redrawSelectedDeck = null;
      const hint = $('las-redraw-hint');
      const confirmBtn = $('btn-las-redraw-confirm');
      if (hint) hint.textContent = '';
      if (confirmBtn) confirmBtn.disabled = true;
      document
        .querySelectorAll('.las-redraw-deck')
        .forEach((d) => d.classList.remove('is-selected'));
      setRedrawModalOpen(true);
    } else if (card.funcType === 'remoteDice') {
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
      expandCardId = card.id;
      expandDirection = null;
      const hint = $('las-expand-hint');
      const confirmBtn = $('btn-las-expand-confirm');
      if (hint) hint.textContent = '';
      if (confirmBtn) confirmBtn.disabled = true;
      document
        .querySelectorAll('.las-expand-option')
        .forEach((d) => d.classList.remove('is-selected'));
      setExpandModalOpen(true);
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

    const exCount = (me.buildings || []).filter(
      (b) => b.built && b.buildType === 'exchange'
    ).length;
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
      (b.built ? ' is-built' : '') +
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
      const buildN = (p.buildings || []).length;

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
        const vill = document.createElement('span');
        vill.className = 'badge';
        vill.textContent = t('lasidao.idleVillagers', {
          idle:
            p.idle != null
              ? p.idle
              : Math.max(0, (p.villagers || 0) - (p.dispatched || 0)),
          total: p.villagers,
          dispatched: p.dispatched || 0,
        });
        resRow.appendChild(vill);
      }
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
      const placed = (p.buildings || []).filter((b) => b.slot != null);
      for (const b of placed) {
        const cell = document.createElement('div');
        cell.className = 'las-pboard-slot las-pboard-slot-none is-filled';
        const body = document.createElement('div');
        body.className = 'las-pboard-slot-body';
        body.appendChild(makeBoardBuildingCard(game, meId, p, b, isMe));
        cell.appendChild(body);
        slots.appendChild(cell);
      }
      const emptyCount = Math.max(0, maxB - placed.length);
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
            netRef.sendAction('placeBuildingSlot', {
              buildingId: unplaced.id,
              slot: 'none',
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

      if (isMe && p.pendingDiscardBuild && !actHand) {
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
      netRef.sendAction('placeBuildingSlot', {
        buildingId: b.id,
        slot: 'none',
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
        tip.textContent = t('lasidao.func.breed');
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
        fnDraw: (game.decksLeft && game.decksLeft.function) || 0,
        fnDiscard: (game.discardsLeft && game.discardsLeft.function) || 0,
        bldDraw: (game.decksLeft && game.decksLeft.building) || 0,
        bldDiscard: (game.discardsLeft && game.discardsLeft.building) || 0,
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
    } else if (game.phase === 'build') {
      $('las-status').textContent = t('lasidao.statusBuild');
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

    const setNum = (id, n) => {
      const el = $(id);
      if (el) el.textContent = String(n || 0);
    };
    setNum('las-deck-res', game.decksLeft && game.decksLeft.resource);
    setNum('las-deck-fn', game.decksLeft && game.decksLeft.function);
    setNum('las-deck-bld', game.decksLeft && game.decksLeft.building);
    setNum(
      'las-discard-res',
      game.discardsLeft && game.discardsLeft.resource
    );
    setNum(
      'las-discard-fn',
      game.discardsLeft && game.discardsLeft.function
    );
    setNum(
      'las-discard-bld',
      game.discardsLeft && game.discardsLeft.building
    );

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

    // 结算动画期间冻结手牌区与板块区：检测到新结算即将播放或正在播放时，用旧状态渲染
    const willPlaySettle = (() => {
      const report = game && game.lastSettle;
      if (!report || !report.at) return false;
      const key = (report.round || '') + ':' + report.at;
      return settleAnimKey !== key && !settlePlaying && ['settle', 'settle_act', 'wish_well', 'build', 'over'].includes(game.phase);
    })();
    const handGame = ((willPlaySettle || settlePlaying) && _prevGame) ? _prevGame : game;

    renderDice(game, meId, _prevGame);
    renderBoard(handGame, meId);
    maybePlayDeal(game);
    renderMe(handGame, meId);
    renderBuildHand(handGame, meId);
    renderPlayers(handGame, meId);

    syncWishWellModal(game, meId);

    maybePlaySettle(game);
    maybeShowTurnToast(game, meId);

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
          buildHouseBtn.title = canHouse ? t('lasidao.func.buildHouse') : t('lasidao.buildHouseLack');
        }
        if (exBtnAct) {
          const exCount2 = (me.buildings || []).filter((b) => b.built && b.buildType === 'exchange').length;
          const need2 = exCount2 === 0 ? 4 : exCount2 === 1 ? 3 : exCount2 === 2 ? 2 : 1;
          const canEx = RESOURCES.some((r) => (me.resources[r] || 0) >= need2);
          exBtnAct.disabled = !canEx;
        }
        if (breedBtn) {
          const breedRate = game.breedFoodPerVillager != null ? game.breedFoodPerVillager : 1;
          const needFood = (me.villagers || 0) * breedRate;
          const maxV = game.maxVillagers != null ? game.maxVillagers : 12;
          const canBreed = me.villagers < maxV && (me.resources.food || 0) >= needFood;
          breedBtn.disabled = !canBreed;
          breedBtn.title = canBreed
            ? t('lasidao.func.breed')
            : t('lasidao.breedLack', { need: needFood });
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
    const done = () => {
      settlePlaying = false;
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
      }
      if (status && lastGame) {
        if (lastGame.phase === 'settle') {
          status.textContent = t('lasidao.statusSettle');
        } else if (isMyTurn(lastGame, lastMeId)) {
          status.textContent = t('lasidao.statusYourTurn');
        } else {
          status.textContent = prev || t('lasidao.statusWait');
        }
      }
    };
    if (fx && typeof fx.playSettle === 'function') {
      Promise.resolve(fx.playSettle(game)).then(done).catch(done);
    } else {
      done();
    }
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
      const faceEl = group && group.querySelector('.las-die-face, .las-die');
      const el = faceEl || group || $('las-dice-groups') || $('las-dice');
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

  function setRedrawModalOpen(open) {
    const modal = $('las-redraw-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (!open) {
      redrawCardId = null;
      redrawSelectedDeck = null;
    } else {
      const fnBack = $('las-redraw-deck-fn-back');
      const bldBack = $('las-redraw-deck-bld-back');
      const Assets = window.LasidaoAssets;
      if (fnBack && Assets && Assets.cardBackImageUrl) {
        fnBack.style.backgroundImage = 'url("' + Assets.cardBackImageUrl('function') + '")';
      }
      if (bldBack && Assets && Assets.cardBackImageUrl) {
        bldBack.style.backgroundImage = 'url("' + Assets.cardBackImageUrl('building') + '")';
      }
      if (window.I18n && window.I18n.applyDom) {
        window.I18n.applyDom(modal);
      }
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

  const EXILE_AREAS = ['resource', 'function', 'building'];

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
    const me = game && mePlayer(game, lastMeId);
    if (!body) return;
    body.innerHTML = '';

    const labels = getResLabels(game);
    const Assets = window.LasidaoAssets;
    const available = RESOURCES.filter(
      (r) => me && (me.resources[r] || 0) >= 1
    );

    if (!available.length) {
      const empty = document.createElement('p');
      empty.className = 'las-void-skip-empty muted';
      empty.textContent = t('lasidao.voidSkipNoRes');
      body.appendChild(empty);
      if (confirmBtn) confirmBtn.disabled = true;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'las-void-skip-grid';
    for (const res of available) {
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

      const qty = document.createElement('span');
      qty.className = 'las-void-skip-qty';
      qty.textContent = '×' + (me.resources[res] || 0);
      cardEl.appendChild(qty);

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
    const decks = document.querySelectorAll('.las-redraw-deck');
    const hint = $('las-redraw-hint');
    const confirmBtn = $('btn-las-redraw-confirm');

    decks.forEach((el) => {
      el.onclick = () => {
        decks.forEach((d) => d.classList.remove('is-selected'));
        el.classList.add('is-selected');
        redrawSelectedDeck = el.dataset.deck;
        const deckName =
          redrawSelectedDeck === 'function'
            ? t('lasidao.deckFunction')
            : t('lasidao.deckBuilding');
        if (hint) {
          hint.textContent = t('lasidao.redrawHint', { name: deckName });
        }
        if (confirmBtn) confirmBtn.disabled = false;
      };
    });
  }


  function renderExchangeModal() {
    const game = lastGame;
    const me = game && mePlayer(game, lastMeId);
    if (!me) return;
    const exCount = (me.buildings || []).filter((b) => b.built && b.buildType === 'exchange').length;
    const need = exCount === 0 ? 4 : exCount === 1 ? 3 : exCount === 2 ? 2 : 1;
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
      ['resource', 'function', 'building'].forEach((kind) => {
        const el = $('las-deck-stack-' + kind);
        const url = Assets.cardBackImageUrl(kind);
        if (el && url) {
          el.style.backgroundImage = 'url("' + url + '")';
          el.style.backgroundSize = 'cover';
          el.style.backgroundPosition = 'center';
          el.style.backgroundRepeat = 'no-repeat';
        }
      });
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
      confirmBtn.onclick = () => confirmDispatch();
    }
    const passBtn = $('btn-las-pass');
    if (passBtn) {
      passBtn.onclick = () => net.sendAction('pass', {});
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
        if (!redrawSelectedDeck || !redrawCardId) return;
        net.sendAction('useFunc', {
          cardId: redrawCardId,
          deck: redrawSelectedDeck,
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

    // 扩容弹窗绑定
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
