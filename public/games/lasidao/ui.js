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
    const n = 1 + (Number(p && p.expandSlots) || 0);
    const out = ['none'];
    for (let i = 1; i < n; i++) out.push('none:' + i);
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


  const FUNC_RULE = {
    breed: 'lasidao.func.breed',
    harvest: 'lasidao.func.harvest',
    remoteDice: 'lasidao.func.remoteDice',
    exile: 'lasidao.func.exile',
    buildHouse: 'lasidao.func.buildHouse',
    redraw: 'lasidao.func.redraw',
    banditRaid: 'lasidao.func.banditRaid',
    expand: 'lasidao.func.expand',
  };

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
  let lastGame = null;
  let lastMeId = null;

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
  let effAlloc = { wood: 0, stone: 0, food: 0, iron: 0 };
  let effAllocFor = 0; // pending total this form is editing

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
    setRulesModalOpen(false);
    // ???????? game:state ?? hide+render???????????????
    if (opts && opts.reset) {
      resetSession();
    }
  }

  function resetSession() {
    resetDiceAnim();
    knownBoardTiles = null;
    pendingDealIds = new Set();
    dealAnimPlaying = false;
    dealtForRound = null;
    if (window.LasidaoFx && typeof window.LasidaoFx.clearLayer === 'function') {
      window.LasidaoFx.clearLayer();
    }
  }

  function ensureCardTip() {
    let tip = $('las-card-tip');
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = 'las-card-tip';
    tip.className = 'las-card-tip';
    tip.hidden = true;
    const panel = $('panel-lasidao');
    (panel || document.body).appendChild(tip);
    return tip;
  }

  function hideCardTip() {
    const tip = $('las-card-tip');
    if (tip) {
      tip.hidden = true;
      tip.textContent = '';
    }
  }

  function showCardTip(text, evt, anchorEl) {
    const tip = ensureCardTip();
    tip.textContent = text;
    tip.hidden = false;
    tip.style.pointerEvents = 'none';

    let x = 12;
    let y = 12;
    if (evt && typeof evt.clientX === 'number') {
      x = evt.clientX + 14;
      y = evt.clientY + 14;
    } else if (anchorEl && anchorEl.getBoundingClientRect) {
      const r = anchorEl.getBoundingClientRect();
      x = r.right + 8;
      y = r.top;
    }
    const pad = 8;
    const tw = tip.offsetWidth || 180;
    const th = tip.offsetHeight || 60;
    if (x + tw > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - tw - pad);
    if (y + th > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - th - pad);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
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
    } else if (tile.buildType === 'efficiency') {
      effect = t('lasidao.tip.efficiencyEffect');
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

  function bindTileTip(card, tile, areaKey) {
    card.style.pointerEvents = 'auto';
    card.addEventListener('mouseenter', (e) => {
      const labels = getResLabels(lastGame);
      showCardTip(tileDetailText(tile, areaKey, labels), e, card);
    });
    card.addEventListener('mousemove', (e) => {
      const tip = $('las-card-tip');
      if (!tip || tip.hidden) return;
      showCardTip(tip.textContent, e, card);
    });
    card.addEventListener('mouseleave', () => hideCardTip());
    card.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
  }

  function makeTileCard(tile, areaKey) {
    const card = document.createElement('div');
    card.className = 'las-tile ' + (tile.kind || areaKey);
    card.dataset.tileId = tile.id || '';

    const art = document.createElement('div');
    art.className = 'las-tile-art';
    art.setAttribute('aria-hidden', 'true');
    if (
      (areaKey === 'resource' || tile.kind === 'resource') &&
      window.LasidaoAssets &&
      typeof window.LasidaoAssets.applyResourceArt === 'function'
    ) {
      window.LasidaoAssets.applyResourceArt(art, tile);
    }
    card.appendChild(art);

    const name = document.createElement('div');
    name.className = 'las-tile-name';

    if (tile.faceDown) {
      card.classList.add('is-facedown');
      name.textContent = t('lasidao.faceDown');
      card.appendChild(name);
      const meta = document.createElement('div');
      meta.className = 'las-tile-meta';
      meta.textContent = t('lasidao.faceDownHint');
      card.appendChild(meta);
      bindTileTip(
        card,
        { label: t('lasidao.faceDown'), faceDown: true },
        areaKey
      );
      return card;
    }

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
    } else if (areaKey === 'building' && tile.buildType === 'efficiency') {
      metaTxt = t('lasidao.tip.efficiencyShort');
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

  function appendWorkerDice(container, face, workers, players, game) {
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
    wrap.className = 'las-workers las-worker-dice';
    for (const [pid, n] of entries) {
      const color = playerDieColor(players, pid, game);
      const count = Math.min(Number(n) || 0, 24);
      for (let i = 0; i < count; i++) {
        wrap.appendChild(makeDieEl(face, 'is-mini is-placed', color));
      }
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
        hint.textContent = t('lasidao.dicePickFace');
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
    selectedTarget = { type: 'area', area: areaKey, number: num };
    if (lastGame && isRemoteMode(lastGame)) {
      selectedFace = num;
    }
    renderBoard(lastGame, lastMeId);
    if (lastGame && isRemoteMode(lastGame)) renderRemoteDice(lastGame, lastMeId);
    else renderGroupedDice();
    updateDispatchPreview();
    updateDiceHint();
  }

  /** ??? num?? max(1,num-1) ????????? num?? num ????? */
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
    const canPick =
      game.phase === 'produce' &&
      isMyTurn(game, meId) &&
      diceReady() &&
      (remote ? selectedWildCount > 0 : selectedFace != null);

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
      const hasTiles = tiles.length > 0;
      const matchFace = remote ? true : selectedFace === num;
      slot.disabled = !canPick || !matchFace || !hasTiles;
      if (canPick && matchFace && hasTiles) slot.classList.add('is-target');
      if (
        selectedTarget &&
        selectedTarget.type === 'area' &&
        selectedTarget.area === areaKey &&
        selectedTarget.number === num
      ) {
        slot.classList.add('is-picked');
      }

      const numEl = document.createElement('span');
      numEl.className = 'las-slot-num';
      numEl.textContent = String(num);
      slot.appendChild(numEl);

      const stack = document.createElement('div');
      stack.className = 'las-slot-tiles';

      if (!hasTiles) {
        const empty = document.createElement('span');
        empty.className = 'muted las-slot-empty';
        const unlockAt = slotUnlockRound(areaKey, num);
        const openCount = areaOpenSlotCount(areaKey, game.round || 1);
        // ??/??????????????????????????????
        if (
          unlockAt != null &&
          (game.phase === 'init_roll' ||
            game.phase === 'init_announce' ||
            num > openCount)
        ) {
          empty.classList.add('las-slot-locked');
          empty.textContent = t('lasidao.unlockRound', { n: unlockAt });
          slot.classList.add('is-locked');
        } else {
          empty.textContent = t('lasidao.emptySlot');
        }
        stack.appendChild(empty);
      } else {
        for (const tile of tiles) {
          const card = makeTileCard(tile, areaKey);
          if (pendingDealIds.has(tile.id)) {
            card.classList.add('is-dealing');
          }
          stack.appendChild(card);
        }
      }
      slot.appendChild(stack);

      const wTxt = workersText(workers, game.players, game);
      const diceRow = appendWorkerDice(slot, num, workers, game.players, game);
      if (diceRow && wTxt) diceRow.title = wTxt;

      slot.onclick = () => {
        if (!canPick || !matchFace || !hasTiles) return;
        pickAreaTarget(areaKey, num);
      };
      boardEl.appendChild(slot);
    }

    if (areaKey === 'building') {
      const me = mePlayer(game, meId);
      let personalHost = $('las-personal-builds');
      if (!personalHost) {
        personalHost = document.createElement('div');
        personalHost.id = 'las-personal-builds';
        personalHost.className = 'las-personal-builds';
        const section = boardEl.closest('.las-board-section-building');
        if (section) section.appendChild(personalHost);
        else boardEl.parentNode.appendChild(personalHost);
      }
      personalHost.innerHTML = '';
      if (me && canPick) {
        for (const b of me.buildings || []) {
          if (!b.built) continue;
          if (!remote && b.slot !== selectedFace) continue;
          if (remote && (b.slot == null || b.slot === 'none')) continue;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'las-tile building las-personal-build';
          if (
            selectedTarget &&
            selectedTarget.type === 'building' &&
            selectedTarget.buildingId === b.id
          ) {
            btn.classList.add('is-picked');
          }
          const art = document.createElement('div');
          art.className = 'las-tile-art';
          btn.appendChild(art);
          const name = document.createElement('div');
          name.className = 'las-tile-name';
          name.textContent = t('lasidao.personalBuild', { label: b.label });
          btn.appendChild(name);
          const meta = document.createElement('div');
          meta.className = 'las-tile-meta';
          meta.textContent =
            b.slot != null && b.slot !== 'none' ? '#' + b.slot : '';
          btn.appendChild(meta);
          if ((b.workers || 0) > 0 && b.slot != null && b.slot !== 'none') {
            appendWorkerDice(
              btn,
              Number(b.slot),
              { [me.id]: b.workers },
              game.players,
              game
            );
          }
          bindTileTip(btn, Object.assign({}, b, { kind: 'building' }), 'building');
          btn.onclick = () => {
            selectedTarget = {
              type: 'building',
              buildingId: b.id,
              label: b.label,
            };
            if (remote) selectedFace = Number(b.slot);
            renderBoard(lastGame, lastMeId);
            if (remote) renderRemoteDice(lastGame, lastMeId);
            else renderGroupedDice();
            updateDispatchPreview();
            updateDiceHint();
          };
          personalHost.appendChild(btn);
        }
      }
    }
  }

  function collectBoardTileMap(game) {
    const map = new Map(); // id -> { area, number, label, faceDown }
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

  function renderDice(game, meId) {
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
      if (diceAnim.key !== key) {
        diceAnim.key = key;
        diceAnim.stage = 'ready';
        diceAnim.finalDice = dice.slice();
        resetDiceSelection();
      }
      renderSpectatorDice(dice, color);
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

  function renderMe(game, meId) {
    const me = mePlayer(game, meId);
    const resEl = $('las-me-res');
    const fnEl = $('las-me-funcs');
    const bldEl = $('las-me-builds');
    if (resEl) resEl.innerHTML = '';
    if (fnEl) fnEl.innerHTML = '';
    if (bldEl) bldEl.innerHTML = '';
    if (!me) {
      const effWrap = $('las-efficiency-wrap');
      if (effWrap) effWrap.hidden = true;
      const host = $('las-boards-host');
      if (host) host.innerHTML = '';
      return;
    }

    const labels = getResLabels(game);
    renderPlayerBoards(game, meId);
    renderEfficiencyBonus(game, me, labels);

    const exCount = (me.buildings || []).filter(
      (b) => b.built && b.buildType === 'exchange'
    ).length;
    const exWrap = $('las-exchange-wrap');
    const exBtn = $('btn-las-exchange');
    const exHint = $('las-exchange-hint');
    if (exWrap) exWrap.hidden = exCount <= 0;
    if (exCount > 0) {
      fillResSelect($('las-ex-from'), labels);
      fillResSelect($('las-ex-to'), labels);
      const cost =
        (game.me && game.me.exchangeCost) ||
        (exCount === 1
          ? 4
          : exCount === 2
            ? 3
            : exCount === 3
              ? 2
              : 1);
      if (exBtn) {
        exBtn.textContent = t('lasidao.exchangeBtnN', { n: cost });
      }
      if (exHint) {
        exHint.textContent = t('lasidao.exchangeHint', {
          count: exCount,
          n: cost,
        });
      }
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

  function makeBoardBuildingCard(game, meId, p, b, isMe) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'las-pboard-card build' +
      (b.built ? ' is-built' : '') +
      (b.faceDown ? ' is-facedown' : '');
    btn.textContent = buildingSlotLabel(b);
    if (
      b.built &&
      (b.workers || 0) > 0 &&
      b.slot != null &&
      !isNoneSlotKey(b.slot)
    ) {
      appendWorkerDice(
        btn,
        Number(b.slot),
        { [p.id]: b.workers },
        game.players,
        game
      );
    }
    if (isMe) {
      btn.onclick = () => onBuildingClick(game, p, b);
      if (b.slot != null && !p.pendingDiscardBuild) {
        btn.title = t('lasidao.discardBuildingHint');
      }
    } else {
      btn.disabled = true;
    }
    return btn;
  }

  function renderPlayerBoards(game, meId) {
    const host = $('las-boards-host');
    if (!host) return;
    host.innerHTML = '';
    const players = (game.players || []).slice().sort((a, b) => {
      if (meId && a.id === meId) return -1;
      if (meId && b.id === meId) return 1;
      return (a.seat || 0) - (b.seat || 0);
    });
    const labels = getResLabels(game);

    for (const p of players) {
      const isMe = Boolean(meId && p.id === meId);
      const maxB =
        p.maxBuildings ||
        (game.maxBuildings || 6) + (Number(p.expandSlots) || 0);
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
        res: Object.values(p.resources || {}).reduce((a, b) => a + b, 0),
        func: p.funcCount != null ? p.funcCount : (p.funcCards || []).length,
        build: (p.buildings || []).length,
      });
      head.appendChild(stats);
      board.appendChild(head);

      if (isMe) {
        const resRow = document.createElement('div');
        resRow.className = 'las-pboard-res las-res';
        for (const [k, v] of Object.entries(p.resources || {})) {
          const span = document.createElement('span');
          span.className = 'badge';
          span.textContent = (labels[k] || k) + ' ' + v;
          resRow.appendChild(span);
        }
        const vill = document.createElement('span');
        vill.className = 'badge';
        vill.textContent = t('lasidao.idleVillagers', {
          idle: p.idle != null ? p.idle : Math.max(0, (p.villagers || 0) - (p.dispatched || 0)),
          total: p.villagers,
          dispatched: p.dispatched || 0,
        });
        resRow.appendChild(vill);
        board.appendChild(resRow);
      }

      const slotsTitle = document.createElement('div');
      slotsTitle.className = 'las-pboard-label';
      slotsTitle.textContent = t('lasidao.buildSlots');
      board.appendChild(slotsTitle);

      const slots = document.createElement('div');
      slots.className = 'las-pboard-slots';
      for (let n = 1; n <= 6; n++) {
        const cell = document.createElement('div');
        cell.className = 'las-pboard-slot';
        cell.dataset.slot = String(n);
        const num = document.createElement('span');
        num.className = 'las-pboard-slot-num';
        num.textContent = String(n);
        cell.appendChild(num);
        const body = document.createElement('div');
        body.className = 'las-pboard-slot-body';
        const occ = (p.buildings || []).find((b) => b.slot === n);
        if (occ) {
          body.appendChild(makeBoardBuildingCard(game, meId, p, occ, isMe));
        } else {
          const empty = document.createElement('span');
          empty.className = 'muted las-pboard-empty';
          empty.textContent = t('lasidao.slotEmpty');
          body.appendChild(empty);
          if (isMe) {
            cell.classList.add('is-drop');
            cell.onclick = () => {
              const unplaced = (p.buildings || []).find(
                (b) => !b.built && b.slot == null
              );
              if (!unplaced || !netRef) return;
              netRef.sendAction('placeBuildingSlot', {
                buildingId: unplaced.id,
                slot: n,
              });
            };
          }
        }
        cell.appendChild(body);
        slots.appendChild(cell);
      }
      board.appendChild(slots);

      const noneKeys = noneSlotKeysFor(p);
      const noneRow = document.createElement('div');
      noneRow.className = 'las-pboard-none';
      const noneLab = document.createElement('div');
      noneLab.className = 'las-pboard-label';
      noneLab.textContent = t('lasidao.slotNoneArea');
      noneRow.appendChild(noneLab);
      const noneSlots = document.createElement('div');
      noneSlots.className = 'las-pboard-none-slots';
      for (const slotKey of noneKeys) {
        const cell = document.createElement('div');
        cell.className = 'las-pboard-slot las-pboard-slot-none';
        cell.dataset.slot = String(slotKey);
        const num = document.createElement('span');
        num.className = 'las-pboard-slot-num';
        num.textContent = t('lasidao.slotNone');
        cell.appendChild(num);
        const body = document.createElement('div');
        body.className = 'las-pboard-slot-body';
        const occ = (p.buildings || []).find((b) => b.slot === slotKey);
        if (occ) {
          body.appendChild(makeBoardBuildingCard(game, meId, p, occ, isMe));
        } else {
          const empty = document.createElement('span');
          empty.className = 'muted las-pboard-empty';
          empty.textContent = t('lasidao.slotEmpty');
          body.appendChild(empty);
          if (isMe) {
            cell.classList.add('is-drop');
            cell.onclick = () => {
              const unplaced = (p.buildings || []).find(
                (b) =>
                  !b.built &&
                  b.slot == null &&
                  b.buildType !== 'produce'
              );
              if (!unplaced || !netRef) return;
              netRef.sendAction('placeBuildingSlot', {
                buildingId: unplaced.id,
                slot: slotKey,
              });
            };
          }
        }
        cell.appendChild(body);
        noneSlots.appendChild(cell);
      }
      noneRow.appendChild(noneSlots);
      board.appendChild(noneRow);

      const unplaced = (p.buildings || []).filter((b) => b.slot == null);
      if (unplaced.length) {
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

      if (isMe && p.pendingDiscardBuild) {
        const tip = document.createElement('div');
        tip.className = 'muted las-pboard-tip';
        tip.textContent = t('lasidao.discardBuildTip', { n: maxB });
        board.appendChild(tip);
      }

      const funcTitle = document.createElement('div');
      funcTitle.className = 'las-pboard-label';
      funcTitle.textContent = t('lasidao.funcHand');
      board.appendChild(funcTitle);
      const funcs = document.createElement('div');
      funcs.className = 'las-pboard-funcs las-cards';
      if (isMe) {
        const visible = (p.funcCards || []).filter((c) => !c.hidden);
        if (!visible.length) {
          funcs.innerHTML =
            '<span class="muted">' + t('lasidao.noFunc') + '</span>';
        } else {
          for (const c of visible) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className =
              'las-card func' +
              (selectedFuncId === c.id ? ' is-selected' : '');
            btn.textContent = c.label;
            btn.onclick = () => {
              selectedFuncId = selectedFuncId === c.id ? null : c.id;
              renderPlayerBoards(game, meId);
              renderFuncForm(game, p);
            };
            funcs.appendChild(btn);
            if (p.pendingDiscardFunc) {
              const disc = document.createElement('button');
              disc.type = 'button';
              disc.className = 'las-card';
              disc.textContent = t('lasidao.discardFunc', { label: c.label });
              disc.onclick = () =>
                netRef && netRef.sendAction('discardFunc', { cardId: c.id });
              funcs.appendChild(disc);
            }
          }
        }
      } else {
        const n = Number(p.funcCount) || 0;
        if (!n) {
          funcs.innerHTML =
            '<span class="muted">' + t('lasidao.noFunc') + '</span>';
        } else {
          for (let i = 0; i < Math.min(n, 12); i++) {
            const back = document.createElement('span');
            back.className = 'las-card func is-facedown';
            back.textContent = t('lasidao.faceDown');
            funcs.appendChild(back);
          }
          if (n > 12) {
            const more = document.createElement('span');
            more.className = 'muted';
            more.textContent = t('lasidao.funcHidden', { n });
            funcs.appendChild(more);
          }
        }
      }
      board.appendChild(funcs);

      host.appendChild(board);
    }
  }

  function sumEffAlloc() {
    return (
      (effAlloc.wood || 0) +
      (effAlloc.stone || 0) +
      (effAlloc.food || 0) +
      (effAlloc.iron || 0)
    );
  }

  function renderEfficiencyBonus(game, me, labels) {
    const wrap = $('las-efficiency-wrap');
    const picks = $('las-efficiency-picks');
    const hint = $('las-efficiency-hint');
    const confirmBtn = $('btn-las-efficiency-confirm');
    if (!wrap || !picks) return;

    const need = Number(me.pendingEfficiencyBonus) || 0;
    const show =
      need > 0 &&
      (game.phase === 'settle_act' || game.phase === 'settle');
    wrap.hidden = !show;
    if (!show) return;

    if (effAllocFor !== need) {
      effAllocFor = need;
      effAlloc = { wood: 0, stone: 0, food: 0, iron: 0 };
    }

    const used = sumEffAlloc();
    const left = Math.max(0, need - used);
    if (hint) {
      hint.textContent = t('lasidao.efficiencyHint', {
        left,
        total: need,
      });
    }

    picks.innerHTML = '';
    for (const [k, lab] of Object.entries(labels)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'las-efficiency-pick' + ((effAlloc[k] || 0) > 0 ? ' is-on' : '');
      btn.textContent = t('lasidao.efficiencyPick', {
        name: lab,
        n: effAlloc[k] || 0,
      });
      btn.disabled = left <= 0;
      btn.onclick = () => {
        if (sumEffAlloc() >= need) return;
        effAlloc[k] = (effAlloc[k] || 0) + 1;
        renderEfficiencyBonus(game, me, labels);
      };
      picks.appendChild(btn);
    }
    if (confirmBtn) {
      confirmBtn.disabled = used !== need;
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
    if (!b.built && b.slot == null) {
      const slotRaw = prompt(
        t('lasidao.placeSlotPrompt'),
        '1'
      );
      if (slotRaw == null) return;
      const slot = String(slotRaw).trim();
      let slotKey =
        slot === 'none' || slot === '0' || /^none:\d+$/.test(slot)
          ? slot === '0'
            ? 'none'
            : slot
          : Number(slot);
      if (
        slotKey !== 'none' &&
        !(typeof slotKey === 'string' && /^none:\d+$/.test(slotKey)) &&
        (!Number.isInteger(slotKey) || slotKey < 1 || slotKey > 6)
      ) {
        alert(t('lasidao.slotInvalid'));
        return;
      }
      if (isNoneSlotKey(slotKey) && !noneSlotKeysFor(me).includes(slotKey)) {
        alert(t('lasidao.slotNoneNeedExpand'));
        return;
      }
      const occupied = (me.buildings || []).find((x) => x.slot === slotKey);
      if (occupied) {
        if (
          !window.confirm(
            t('lasidao.confirmReplaceBuilding', {
              oldLabel: occupied.label,
              newLabel: b.label,
              slot: slotKey === 'none' || isNoneSlotKey(slotKey)
                ? t('lasidao.slotNone')
                : String(slotKey),
            })
          )
        ) {
          return;
        }
        netRef.sendAction('placeBuildingSlot', {
          buildingId: b.id,
          slot,
          replace: true,
        });
        return;
      }
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
      isMyTurn(game, me.id)
    ) {
      netRef.sendAction('construct', { buildingId: b.id });
    }
  }

  function renderFuncForm(game, me) {
    const panel = $('las-func-panel');
    const form = $('las-func-form');
    if (!selectedFuncId || !me) {
      panel.hidden = true;
      form.innerHTML = '';
      return;
    }
    const card = (me.funcCards || []).find((c) => c.id === selectedFuncId);
    if (!card) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    form.innerHTML = '';
    const title = document.createElement('p');
    title.textContent = t('lasidao.funcFormTitle', { label: card.label });
    form.appendChild(title);

    if (card.funcType === 'harvest') {
      const s1 = document.createElement('select');
      const s2 = document.createElement('select');
      fillResSelect(s1, getResLabels(game));
      fillResSelect(s2, getResLabels(game));
      form.appendChild(s1);
      form.appendChild(s2);
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = t('lasidao.confirmHarvest');
      go.onclick = () => {
        netRef.sendAction('useFunc', {
          cardId: card.id,
          resources: [s1.value, s2.value],
        });
        selectedFuncId = null;
      };
      form.appendChild(go);
    } else if (card.funcType === 'redraw') {
      const goFn = document.createElement('button');
      goFn.type = 'button';
      goFn.textContent = t('lasidao.redrawFunction');
      goFn.onclick = () => {
        netRef.sendAction('useFunc', {
          cardId: card.id,
          deck: 'function',
        });
        selectedFuncId = null;
      };
      const goBd = document.createElement('button');
      goBd.type = 'button';
      goBd.textContent = t('lasidao.redrawBuilding');
      goBd.onclick = () => {
        netRef.sendAction('useFunc', {
          cardId: card.id,
          deck: 'building',
        });
        selectedFuncId = null;
      };
      form.appendChild(goFn);
      form.appendChild(goBd);
    } else if (card.funcType === 'remoteDice') {
      const tip = document.createElement('p');
      tip.className = 'muted';
      tip.textContent = t('lasidao.func.remoteDice');
      form.appendChild(tip);
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = t('lasidao.confirmUse');
      go.onclick = () => {
        netRef.sendAction('useFunc', { cardId: card.id });
        selectedFuncId = null;
      };
      form.appendChild(go);
    } else if (card.funcType === 'exile') {
      const tip = document.createElement('p');
      tip.className = 'muted';
      tip.textContent = t('lasidao.func.exile');
      form.appendChild(tip);
      const areaSel = document.createElement('select');
      for (const k of ['resource', 'function', 'building']) {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = areaLabel(k);
        areaSel.appendChild(opt);
      }
      const numSel = document.createElement('select');
      for (let n = 1; n <= 6; n++) {
        const opt = document.createElement('option');
        opt.value = String(n);
        opt.textContent = t('lasidao.slotNum', { n });
        numSel.appendChild(opt);
      }
      const sel = document.createElement('select');
      for (const p of game.players || []) {
        if (p.left) continue;
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        sel.appendChild(opt);
      }
      form.appendChild(areaSel);
      form.appendChild(numSel);
      form.appendChild(sel);
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = t('lasidao.confirmExile');
      go.onclick = () => {
        netRef.sendAction('useFunc', {
          cardId: card.id,
          targetId: sel.value,
          area: areaSel.value,
          number: Number(numSel.value),
        });
        selectedFuncId = null;
      };
      form.appendChild(go);
    } else if (card.funcType === 'banditRaid') {
      const tip = document.createElement('p');
      tip.className = 'muted';
      tip.textContent = t('lasidao.func.banditRaid');
      form.appendChild(tip);
      const areaSel = document.createElement('select');
      for (const [k, lab] of Object.entries(
        game.areaLabels || AREA_LABEL
      )) {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = typeof lab === 'string' ? lab : areaLabel(k);
        areaSel.appendChild(opt);
      }
      const numSel = document.createElement('select');
      for (let n = 1; n <= 6; n++) {
        const opt = document.createElement('option');
        opt.value = String(n);
        opt.textContent = '#' + n;
        numSel.appendChild(opt);
      }
      form.appendChild(areaSel);
      form.appendChild(numSel);
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = t('lasidao.confirmBandit');
      go.onclick = () => {
        netRef.sendAction('useFunc', {
          cardId: card.id,
          area: areaSel.value,
          number: Number(numSel.value),
        });
        selectedFuncId = null;
      };
      form.appendChild(go);
    } else {
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = t('lasidao.confirmUse');
      go.onclick = () => {
        netRef.sendAction('useFunc', { cardId: card.id });
        selectedFuncId = null;
      };
      form.appendChild(go);
    }
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
    netRef = net;
    lastGame = game;
    lastMeId = opts && opts.meId;
    lastGamePhase = game.phase;
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
      $('las-status').textContent = t('lasidao.statusSettleAct');
    } else if (game.phase === 'build') {
      $('las-status').textContent = t('lasidao.statusBuild');
    } else if (game.phase === 'round_end') {
      $('las-status').textContent = t('lasidao.statusRoundEnd');
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

    renderDice(game, meId);
    renderBoard(game, meId);
    maybePlayDeal(game);
    renderMe(game, meId);
    renderPlayers(game, meId);

    maybePlaySettle(game);

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
    if (phaseAct) {
      // ???/??????????????????
      phaseAct.hidden = !(game.phase === 'build' && isMyTurn(game, meId));
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
      !['settle', 'settle_act', 'build', 'round_end', 'over'].includes(
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
      if (status && lastGame) {
        if (isMyTurn(lastGame, lastMeId)) {
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

  function confirmDispatch() {
    if (!netRef || !selectedTarget) return;
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

  function setRulesModalOpen(open) {
    const modal = $('las-rules-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (open && window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(modal);
    }
  }

  function bindButtons(net) {
    netRef = net;
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
      voidBtn.onclick = () => {
        resetDiceAnim();
        net.sendAction('voidSkip', {});
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
    const exBtn = $('btn-las-exchange');
    if (exBtn) {
      exBtn.onclick = () => {
        net.sendAction('exchange', {
          from: $('las-ex-from').value,
          to: $('las-ex-to').value,
        });
      };
    }
    const effReset = $('btn-las-efficiency-reset');
    if (effReset) {
      effReset.onclick = () => {
        effAlloc = { wood: 0, stone: 0, food: 0, iron: 0 };
        if (lastGame) renderMe(lastGame, lastMeId);
      };
    }
    const effConfirm = $('btn-las-efficiency-confirm');
    if (effConfirm) {
      effConfirm.onclick = () => {
        const need = effAllocFor;
        if (sumEffAlloc() !== need) {
          alert(t('lasidao.efficiencyNeedAll'));
          return;
        }
        net.sendAction('allocateEfficiency', {
          alloc: {
            wood: effAlloc.wood || 0,
            stone: effAlloc.stone || 0,
            food: effAlloc.food || 0,
            iron: effAlloc.iron || 0,
          },
        });
      };
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

  return { render, hide, resetSession, bindButtons };
})();
