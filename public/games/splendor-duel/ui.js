'use strict';

window.SplendorDuelUi = (function () {
  const els = {};
  let mandatoryMode = null; // null | 'take' | 'buy' | 'reserve'
  let privilegeMode = null; // null | {count:1|2|3}
  let selectedCells = [];
  let selectedCardId = null;
  let discardColors = [];
  let nameOf = (id) => (id == null ? '—' : String(id));

  const COLORS = ['emerald', 'sapphire', 'ruby', 'diamond', 'onyx', 'pearl'];
  const RES_COLORS = ['emerald', 'sapphire', 'ruby', 'diamond', 'onyx'];
  const GOLD = 'gold';
  const ASSOCIATE = 'associate';
  const BSIZE = 5;
  const NAMES = { emerald: '翡翠', sapphire: '蓝宝石', ruby: '红宝石', diamond: '钻石', onyx: '玛瑙', pearl: '珍珠', gold: '金', associate: '合伙人' };
  const ABILITIES = {
    extra_turn: 'splendorDuel.abilityExtraTurn',
    take_gem: 'splendorDuel.abilityTakeGem',
    steal_gem: 'splendorDuel.abilityStealGem',
    gain_privilege: 'splendorDuel.abilityGainPrivilege',
  };

  function getEl(id) { return document.getElementById(id); }
  function initElements() {
    els.panel = getEl('panel-splendor-duel');
    els.privPool = getEl('sd-privilege-pool');
    els.optActions = getEl('sd-opt-actions');
    els.boardGrid = getEl('sd-board-grid');
    els.deckT1 = getEl('sd-deck-t1'); els.deckT2 = getEl('sd-deck-t2'); els.deckT3 = getEl('sd-deck-t3');
    els.boardT1 = getEl('sd-board-t1'); els.boardT2 = getEl('sd-board-t2'); els.boardT3 = getEl('sd-board-t3');
    els.royalties = getEl('sd-royalties-list');
    els.oppName = getEl('sd-opp-name'); els.oppPrestige = getEl('sd-opp-prestige'); els.oppCrowns = getEl('sd-opp-crowns'); els.oppPrivileges = getEl('sd-opp-privileges');
    els.oppTokens = getEl('sd-opp-tokens'); els.oppReserved = getEl('sd-opp-reserved'); els.oppBonus = getEl('sd-opp-bonus');
    els.centerInfo = getEl('sd-center-info'); els.mandHint = getEl('sd-mandatory-hint');
    els.myPrestige = getEl('sd-my-prestige'); els.myCrowns = getEl('sd-my-crowns'); els.myPrivileges = getEl('sd-my-privileges');
    els.myBonus = getEl('sd-my-bonus'); els.myReserved = getEl('sd-my-reserved'); els.myTokens = getEl('sd-my-tokens');
    els.myCards = getEl('sd-my-cards');
    els.actions = getEl('sd-actions'); els.log = getEl('sd-log');
  }
  function clear(el) { if (!el) return; while (el.firstChild) el.removeChild(el.firstChild); }
  function oppId(game, me) { return game.turnOrder.find((id) => id !== me) || null; }

  function mini(col, n) { const d = document.createElement('div'); d.className = 'sd-mini-token ' + col; d.textContent = (NAMES[col] || col).charAt(0) + n; return d; }
  function bonusDot(col, n) { const d = document.createElement('div'); d.className = 'sd-bonus-dot ' + col; d.textContent = n; return d; }
  function reserveBack(n) { const d = document.createElement('div'); d.className = 'sd-reserve-back'; d.textContent = n > 0 ? n : ''; return d; }

  function abilityText(ability, t) {
    if (!ability) return '';
    const key = ABILITIES[ability];
    return key ? t(key) : ability;
  }

  function cardDiv(card, opts = {}) {
    const t = opts.t || ((k) => k);
    const d = document.createElement('div');
    d.className = 'sd-card';
    d.dataset.cardId = card.id;
    if (card.tier) d.dataset.tier = card.tier;
    const h = document.createElement('div'); h.className = 'sd-card-header';
    if (card.prestige) { const s = document.createElement('span'); s.className = 'sd-card-prestige'; s.textContent = '+' + card.prestige; h.appendChild(s); }
    if (card.crowns) { const s = document.createElement('span'); s.className = 'sd-card-crowns'; s.textContent = '\u{1F451}' + card.crowns; h.appendChild(s); }
    if (card.discount === ASSOCIATE) {
      const s = document.createElement('span');
      s.className = 'sd-card-discount associate';
      s.textContent = card.assocColor ? (NAMES[card.assocColor] || card.assocColor).charAt(0) : '\u2605';
      s.title = t('splendorDuel.associateBonus');
      h.appendChild(s);
    } else if (card.discount) {
      const s = document.createElement('span'); s.className = 'sd-card-discount ' + card.discount; s.textContent = (NAMES[card.discount] || card.discount).charAt(0); h.appendChild(s);
    } else if (card.isRoyalty !== true) {
      const s = document.createElement('span'); s.className = 'sd-card-gold'; s.textContent = '\u{1F4B0}'; s.title = t('splendorDuel.goldCard'); h.appendChild(s);
    }
    d.appendChild(h);
    if (card.ability) { const a = document.createElement('div'); a.className = 'sd-card-ability'; a.textContent = abilityText(card.ability, t); d.appendChild(a); }
    if (card.cost && Object.keys(card.cost).length) {
      const costs = document.createElement('div'); costs.className = 'sd-card-costs';
      for (const [col, n] of Object.entries(card.cost)) { const chip = document.createElement('span'); chip.className = 'sd-cost-chip ' + col; chip.textContent = (NAMES[col] || col).charAt(0) + n; costs.appendChild(chip); }
      d.appendChild(costs);
    }
    if (opts.selectable) d.classList.add('is-selectable');
    if (opts.selected) d.classList.add('is-selected');
    if (opts.clickable) d.classList.add('is-clickable');
    if (opts.onClick) d.addEventListener('click', opts.onClick);
    return d;
  }

  function royaltyDiv(roy, opts = {}) {
    const t = opts.t || ((k) => k);
    const d = document.createElement('div');
    d.className = 'sd-royalty' + (roy.claimedBy ? ' claimed' : '');
    const p = document.createElement('div'); p.className = 'sd-royalty-prestige'; p.textContent = '+' + roy.prestige; d.appendChild(p);
    if (roy.ability) { const a = document.createElement('div'); a.className = 'sd-royalty-ability'; a.textContent = abilityText(roy.ability, t); d.appendChild(a); }
    if (roy.claimedBy) { const c = document.createElement('div'); c.className = 'sd-royalty-claimed'; c.textContent = '\u2713'; d.appendChild(c); }
    if (opts.clickable) d.classList.add('is-clickable');
    if (opts.onClick) d.addEventListener('click', opts.onClick);
    return d;
  }

  /* ===== 版图渲染 ===== */
  function renderBoard(game, isActive) {
    clear(els.boardGrid);
    for (let r = 0; r < BSIZE; r++) {
      for (let c = 0; c < BSIZE; c++) {
        const color = game.board[r][c];
        const inSel = selectedCells.some(([sr, sc]) => sr === r && sc === c);
        let clickable = false;
        if (isActive && color !== null) {
          if (privilegeMode) clickable = color !== GOLD;
          else if (mandatoryMode === 'take') clickable = color !== GOLD; // 拿标记不能拿金
        }
        const cell = document.createElement('div');
        cell.className = 'sd-grid-cell' + (color ? (' ' + color) : ' empty') + (inSel && clickable ? ' is-selected' : '') + (clickable ? ' is-selectable' : '');
        cell.textContent = color ? (NAMES[color] || color).charAt(0) : '';
        if (clickable) cell.addEventListener('click', () => _toggleCell(r, c));
        els.boardGrid.appendChild(cell);
      }
    }
  }

  function renderCards(game, isActive, net, t) {
    for (const tier of [1, 2, 3]) {
      const key = 'tier' + tier;
      const bEl = getEl('sd-board-t' + tier), dEl = getEl('sd-deck-t' + tier);
      clear(bEl); clear(dEl);
      const arr = game.boardCards[key] || [];
      for (let i = 0; i < arr.length; i++) {
        const card = arr[i];
        bEl.appendChild(cardDiv(card, {
          t,
          selectable: isActive && (mandatoryMode === 'buy' || mandatoryMode === 'reserve'),
          selected: selectedCardId === card.id,
          onClick: () => {
            if (mandatoryMode === 'buy') { selectedCardId = card.id; _refreshCardSel(); }
            else if (mandatoryMode === 'reserve') { _doReserve(net, tier, i, false); }
          },
        }));
      }
      const left = game.decksLeft[key] || 0;
      dEl.textContent = '\u{1F4E6}' + left;
      if (left > 0 && isActive && mandatoryMode === 'reserve') {
        dEl.classList.add('is-reservable');
        dEl.onclick = () => _doReserve(net, tier, -1, true);
      }
    }
  }

  function renderRoyalties(game, isActive, meId, net, t) {
    clear(els.royalties);
    const pend = game.pending;
    const chooseRoyal = isActive && pend && pend.type === 'royal' && pend.playerId === meId;
    for (const r of game.royalties || []) {
      const available = !r.claimedBy;
      els.royalties.appendChild(royaltyDiv(r, {
        t,
        clickable: chooseRoyal && available,
        onClick: () => { if (chooseRoyal && available) net.sendAction('resolve', { royalId: r.id }); },
      }));
    }
  }

  /* ===== 可选行动 ===== */
  function renderOptional(game, isActive, meId, t, net) {
    clear(els.privPool); clear(els.optActions);
    const me = game.players[meId]; if (!me) return;
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('span');
      d.className = 'sd-privilege-token' + (i < game.availablePrivileges ? ' active' : '');
      d.textContent = i < game.availablePrivileges ? '\u2605' : '';
      els.privPool.appendChild(d);
    }
    if (!isActive || game.phase !== 'play' || game.pending) return;

    if (privilegeMode) {
      const info = document.createElement('div'); info.className = 'sd-hint';
      info.textContent = t('splendorDuel.privilegeHint', { count: privilegeMode.count });
      els.optActions.appendChild(info);
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = t('splendorDuel.confirmPrivilege');
      btn.onclick = () => {
        if (selectedCells.length !== privilegeMode.count) { alert(t('splendorDuel.selectTokens')); return; }
        net.sendAction('use_privilege', { count: privilegeMode.count, tokens: selectedCells.map(([r, c]) => [r, c]) });
        _reset();
      };
      els.optActions.appendChild(btn);
      const c = document.createElement('button'); c.type = 'button'; c.className = 'secondary'; c.textContent = t('common.cancel');
      c.onclick = () => { privilegeMode = null; selectedCells = []; _forceRefresh(); };
      els.optActions.appendChild(c);
      return;
    }

    if (!game.optPrivilegeDone && me.privileges > 0) {
      for (let n = 1; n <= Math.min(me.privileges, 3); n++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = t('splendorDuel.usePrivileges', { n });
        btn.onclick = () => { privilegeMode = { count: n }; selectedCells = []; _forceRefresh(); };
        els.optActions.appendChild(btn);
      }
    }
    if (!game.optReplenishDone && game.bagLeft > 0) {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'secondary';
      btn.textContent = t('splendorDuel.actionReplenish');
      btn.onclick = () => { net.sendAction('replenish', {}); _forceRefresh(); };
      els.optActions.appendChild(btn);
    }
  }

  /* ===== 玩家面板 ===== */
  function renderMy(game, meId, isActive, t) {
    clear(els.myPrestige); clear(els.myCrowns); clear(els.myPrivileges);
    clear(els.myBonus); clear(els.myReserved); clear(els.myTokens); clear(els.myCards);
    const p = game.players[meId]; if (!p) return;
    els.myPrestige.textContent = t('splendorDuel.prestige', { n: p.prestige });
    els.myCrowns.textContent = t('splendorDuel.crowns', { n: p.crowns });
    els.myPrivileges.textContent = t('splendorDuel.privileges', { n: p.privileges });
    for (const [col, n] of Object.entries(p.bonusCounts || {})) if (n > 0) els.myBonus.appendChild(bonusDot(col, n));
    // 已购卡：按红利颜色分组显示同色声望
    const cp = p.colorPrestige || {};
    for (const col of COLORS) {
      if (!cp[col]) continue;
      const chip = document.createElement('div');
      chip.className = 'sd-color-prestige ' + col;
      chip.textContent = (NAMES[col] || col).charAt(0) + ' ' + cp[col] + '/10';
      els.myCards.appendChild(chip);
    }
    const reserved = p.reserved || [];
    for (let i = 0; i < reserved.length; i++) {
      const rc = reserved[i];
      if (rc && rc.id) {
        els.myReserved.appendChild(cardDiv(rc, {
          t,
          selectable: isActive && mandatoryMode === 'buy',
          selected: selectedCardId === rc.id,
          onClick: () => { if (mandatoryMode === 'buy') { selectedCardId = rc.id; _refreshCardSel(); } },
        }));
      } else els.myReserved.appendChild(reserveBack(1));
    }
    for (const col of COLORS.concat([GOLD])) {
      const n = p.tokenCounts[col] || 0;
      if (n > 0) {
        const d = mini(col, n);
        if (_isDiscard(game, meId)) {
          d.style.cursor = 'pointer';
          d.addEventListener('click', () => _toggleDiscardColor(col));
          if (discardColors.includes(col)) d.style.boxShadow = '0 0 0 2px #28a745';
        }
        els.myTokens.appendChild(d);
      }
    }
  }

  function renderOpp(game, oId, net, t) {
    clear(els.oppName); clear(els.oppPrestige); clear(els.oppCrowns); clear(els.oppPrivileges);
    clear(els.oppTokens); clear(els.oppReserved); clear(els.oppBonus);
    if (!oId) return;
    els.oppName.textContent = nameOf(oId);
    const p = game.players[oId]; if (!p) return;
    els.oppPrestige.textContent = t('splendorDuel.prestige', { n: p.prestige });
    els.oppCrowns.textContent = t('splendorDuel.crowns', { n: p.crowns });
    els.oppPrivileges.textContent = t('splendorDuel.privileges', { n: p.privileges });
    for (const col of COLORS.concat([GOLD])) { const n = p.tokenCounts[col] || 0; if (n > 0) els.oppTokens.appendChild(mini(col, n)); }
    for (let i = 0; i < (p.reserved || []).length; i++) els.oppReserved.appendChild(reserveBack(1));
    for (const [col, n] of Object.entries(p.bonusCounts || {})) if (n > 0) els.oppBonus.appendChild(bonusDot(col, n));
  }

  /* ===== 抉择（皇室卡 / 合伙人颜色 / 夺取宝石）===== */
  function renderPending(game, meId, t, net) {
    const pend = game.pending;
    if (!pend) return false;
    if (pend.playerId !== meId) {
      const info = document.createElement('div'); info.className = 'sd-hint';
      info.textContent = t('splendorDuel.pendingWaiting', { name: nameOf(pend.playerId) });
      els.actions.appendChild(info);
      return true;
    }
    if (pend.type === 'royal') {
      const info = document.createElement('div'); info.className = 'sd-hint';
      info.textContent = t('splendorDuel.pendingRoyalHint', { n: pend.threshold || 3 });
      els.actions.appendChild(info);
      for (const r of pend.options || []) {
        const btn = document.createElement('button'); btn.type = 'button';
        btn.textContent = '+' + r.prestige + (r.ability ? ' · ' + abilityText(r.ability, t) : '');
        btn.onclick = () => { net.sendAction('resolve', { royalId: r.id }); _reset(); };
        els.actions.appendChild(btn);
      }
      return true;
    }
    if (pend.type === 'associate_color') {
      const info = document.createElement('div'); info.className = 'sd-hint';
      info.textContent = t('splendorDuel.pendingAssociateHint');
      els.actions.appendChild(info);
      for (const col of pend.options || []) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sd-color-btn ' + col;
        btn.textContent = NAMES[col] || col;
        btn.onclick = () => { net.sendAction('resolve', { color: col }); _reset(); };
        els.actions.appendChild(btn);
      }
      return true;
    }
    if (pend.type === 'steal_gem') {
      const info = document.createElement('div'); info.className = 'sd-hint';
      info.textContent = t('splendorDuel.pendingStealHint');
      els.actions.appendChild(info);
      for (const col of pend.options || []) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sd-color-btn ' + col;
        btn.textContent = NAMES[col] || col;
        btn.onclick = () => { net.sendAction('resolve', { color: col }); _reset(); };
        els.actions.appendChild(btn);
      }
      return true;
    }
    return false;
  }

  /* ===== 行动区 ===== */
  function renderActions(game, meId, isActive, t, net) {
    clear(els.actions); clear(els.mandHint);
    if (!isActive) return;

    if (game.pending) { renderPending(game, meId, t, net); return; }

    if (_isDiscard(game, meId)) {
      const info = document.createElement('div'); info.className = 'sd-hint';
      info.textContent = t('splendorDuel.discardHint', { need: game.discardNeed });
      els.actions.appendChild(info);
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = t('splendorDuel.discardConfirm');
      btn.onclick = () => {
        const discarding = {};
        for (const col of discardColors) discarding[col] = (discarding[col] || 0) + 1;
        net.sendAction('discard_tokens', { tokens: discarding });
        _reset();
      };
      els.actions.appendChild(btn);
      return;
    }
    if (privilegeMode) return;
    if (!mandatoryMode) {
      els.mandHint.textContent = t('splendorDuel.mandatoryHint');
      const b1 = document.createElement('button'); b1.type = 'button'; b1.textContent = t('splendorDuel.actionTakeTokens');
      b1.onclick = () => { mandatoryMode = 'take'; selectedCells = []; _forceRefresh(); }; els.actions.appendChild(b1);
      const b2 = document.createElement('button'); b2.type = 'button'; b2.textContent = t('splendorDuel.actionReserve');
      b2.onclick = () => { mandatoryMode = 'reserve'; selectedCells = []; _forceRefresh(); }; els.actions.appendChild(b2);
      const b3 = document.createElement('button'); b3.type = 'button'; b3.textContent = t('splendorDuel.actionBuyCard');
      b3.onclick = () => { mandatoryMode = 'buy'; selectedCells = []; _forceRefresh(); }; els.actions.appendChild(b3);
      if (_noMandatory(game)) {
        const hint = document.createElement('div'); hint.className = 'sd-hint';
        hint.textContent = t('splendorDuel.cannotAct');
        els.actions.appendChild(hint);
        const bp = document.createElement('button'); bp.type = 'button'; bp.className = 'secondary';
        bp.textContent = t('splendorDuel.actionPass');
        bp.onclick = () => { net.sendAction('pass', {}); _reset(); };
        els.actions.appendChild(bp);
      }
      return;
    }
    if (mandatoryMode === 'take') {
      const hint = document.createElement('div'); hint.className = 'sd-hint'; hint.textContent = t('splendorDuel.takeHint'); els.actions.appendChild(hint);
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = t('splendorDuel.confirmTake');
      btn.onclick = () => {
        if (!_validTake()) { alert(t('splendorDuel.invalidSelection')); return; }
        net.sendAction('take_tokens', { cells: selectedCells.map(([r, c]) => [r, c]) });
        _reset();
      }; els.actions.appendChild(btn);
      const c = document.createElement('button'); c.type = 'button'; c.className = 'secondary'; c.textContent = t('common.cancel'); c.onclick = () => _reset(); els.actions.appendChild(c);
      return;
    }
    if (mandatoryMode === 'buy') {
      const hint = document.createElement('div'); hint.className = 'sd-hint'; hint.textContent = t('splendorDuel.buyHint'); els.actions.appendChild(hint);
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = t('splendorDuel.confirmBuy');
      btn.onclick = () => {
        if (!selectedCardId) { alert(t('splendorDuel.selectCard')); return; }
        const found = _findCard(game, selectedCardId);
        if (!found) { alert(t('splendorDuel.cardNotFound')); return; }
        if (found.source === 'reserve') net.sendAction('buy_card', { fromReserve: true, reserveIdx: found.reserveIdx });
        else net.sendAction('buy_card', { tier: found.tier, idx: found.idx });
        _reset();
      }; els.actions.appendChild(btn);
      const c = document.createElement('button'); c.type = 'button'; c.className = 'secondary'; c.textContent = t('common.cancel'); c.onclick = () => _reset(); els.actions.appendChild(c);
      return;
    }
    if (mandatoryMode === 'reserve') {
      const hint = document.createElement('div'); hint.className = 'sd-hint'; hint.textContent = t('splendorDuel.reserveHint'); els.actions.appendChild(hint);
      const c = document.createElement('button'); c.type = 'button'; c.className = 'secondary'; c.textContent = t('common.cancel'); c.onclick = () => _reset(); els.actions.appendChild(c);
    }
  }

  function _noMandatory(game) {
    let nonGold = false, gold = false;
    for (let r = 0; r < BSIZE; r++) {
      for (let c = 0; c < BSIZE; c++) {
        const v = game.board[r][c];
        if (v && v !== GOLD) nonGold = true;
        if (v === GOLD) gold = true;
      }
    }
    return !nonGold && !gold;
  }

  /* ===== 日志 ===== */
  function renderLog(game, meId, net, t) {
    clear(els.log);
    if (!game.lastAction) return;
    const la = game.lastAction;
    const li = document.createElement('li');
    const name = nameOf(la.playerId);
    if (la.type === 'take_tokens') {
      const cols = (la.colors || []).map((c) => NAMES[c] || c).join('\u3001');
      li.textContent = t('splendorDuel.logTake', { name, colors: cols });
    } else if (la.type === 'buy_card') {
      li.textContent = t('splendorDuel.logBuy', { name, cardId: la.cardId });
    } else if (la.type === 'reserve_card') {
      li.textContent = t('splendorDuel.logReserve', { name, cardId: la.cardId });
    } else if (la.type === 'use_privilege') {
      li.textContent = t('splendorDuel.logPrivilege', { name, count: la.count });
    } else if (la.type === 'replenish') {
      li.textContent = t('splendorDuel.logReplenish', { name });
    } else if (la.type === 'take_royal') {
      li.textContent = t('splendorDuel.logRoyal', { name });
    } else if (la.type === 'steal_gem') {
      li.textContent = t('splendorDuel.logSteal', { name, color: NAMES[la.color] || la.color });
    } else if (la.type === 'associate_color') {
      li.textContent = t('splendorDuel.logAssociate', { name, color: NAMES[la.color] || la.color });
    } else if (la.type === 'pass') {
      li.textContent = t('splendorDuel.logPass', { name });
    } else {
      li.textContent = name + ': ' + la.type;
    }
    els.log.appendChild(li);
  }

  function renderInfo(game, meId, t) {
    clear(els.centerInfo);
    if (game.over) {
      if (!game.winnerId) els.centerInfo.textContent = t('splendorDuel.draw');
      else if (game.winnerId === meId) els.centerInfo.textContent = t('splendorDuel.youWin');
      else els.centerInfo.textContent = t('splendorDuel.ended', { name: nameOf(game.winnerId) });
      return;
    }
    if (game.pending && game.pending.playerId !== meId) {
      els.centerInfo.textContent = t('splendorDuel.pendingWaiting', { name: nameOf(game.pending.playerId) });
      return;
    }
    if (game.phase === 'discard') { els.centerInfo.textContent = t('splendorDuel.discardPhase'); return; }
    if (game.currentPlayerId === meId) els.centerInfo.textContent = t('splendorDuel.yourTurn');
    else els.centerInfo.textContent = t('splendorDuel.waitNamed', { name: nameOf(game.currentPlayerId) });
  }

  /* ===== 交互辅助 ===== */
  function _toggleCell(r, c) {
    const idx = selectedCells.findIndex(([sr, sc]) => sr === r && sc === c);
    if (idx !== -1) { selectedCells.splice(idx, 1); }
    else {
      if (privilegeMode && selectedCells.length >= privilegeMode.count) return;
      if (mandatoryMode === 'take' && selectedCells.length >= 3) return;
      selectedCells.push([r, c]);
    }
    _forceRefresh();
  }
  function _toggleDiscardColor(col) { const idx = discardColors.indexOf(col); if (idx !== -1) discardColors.splice(idx, 1); else discardColors.push(col); _forceRefresh(); }
  function _refreshCardSel() { const cards = els.panel.querySelectorAll('.sd-card'); cards.forEach((el) => { if (selectedCardId && el.dataset.cardId === selectedCardId) el.classList.add('is-selected'); else el.classList.remove('is-selected'); }); }
  function _doReserve(net, tier, idx, fromDeck) { if (fromDeck) net.sendAction('reserve_card', { tier, fromDeck: true }); else net.sendAction('reserve_card', { tier, idx }); _reset(); }
  function _findCard(game, cardId) {
    for (const t of [1, 2, 3]) { const key = 'tier' + t; const arr = game.boardCards[key] || []; for (let i = 0; i < arr.length; i++) if (arr[i].id === cardId) return { source: 'board', tier: t, idx: i }; }
    const me = SplendorDuelUi._lastMeId;
    if (me && game.players[me]) { const r = game.players[me].reserved || []; for (let i = 0; i < r.length; i++) if (r[i].id === cardId) return { source: 'reserve', tier: r[i].tier, reserveIdx: i }; }
    return null;
  }
  function _validTake() {
    const c = selectedCells;
    if (!c || c.length < 1 || c.length > 3) return false;
    if (c.length === 1) return true;
    const sameRow = c.every(([r]) => r === c[0][0]);
    const sameCol = c.every(([, cc]) => cc === c[0][1]);
    const d1 = c.every(([r, cc]) => r - cc === c[0][0] - c[0][1]);
    const d2 = c.every(([r, cc]) => r + cc === c[0][0] + c[0][1]);
    if (!sameRow && !sameCol && !d1 && !d2) return false;
    const s = c.slice().sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
    for (let i = 1; i < s.length; i++) { const dr = Math.abs(s[i][0] - s[i - 1][0]); const dc = Math.abs(s[i][1] - s[i - 1][1]); if (dr > 1 || dc > 1) return false; }
    return true;
  }
  function _isDiscard(game, meId) { return game.phase === 'discard' && game.discardPlayerId === meId; }
  function _reset() { mandatoryMode = null; privilegeMode = null; selectedCells = []; selectedCardId = null; discardColors = []; _forceRefresh(); }
  function _forceRefresh() {
    if (SplendorDuelUi._lastState) {
      render(SplendorDuelUi._lastState, SplendorDuelUi._lastNet, {
        meId: SplendorDuelUi._lastMeId,
        t: SplendorDuelUi._lastT,
        playerNameById: SplendorDuelUi._lastNameOf,
      });
    }
  }

  /* ===== 主入口 ===== */
  function render(game, net, opts = {}) {
    if (!game || game.type !== 'splendor-duel') return;
    initElements();
    const meId = opts.meId || null;
    const t = opts.t || ((k) => k);
    nameOf =
      typeof opts.playerNameById === 'function'
        ? opts.playerNameById
        : net && typeof net.playerNameById === 'function'
          ? net.playerNameById
          : (id) => (id == null ? '—' : String(id));
    if (!els.panel) return;
    SplendorDuelUi._lastState = game;
    SplendorDuelUi._lastNet = net;
    SplendorDuelUi._lastMeId = meId;
    SplendorDuelUi._lastT = t;
    SplendorDuelUi._lastNameOf = nameOf;
    const pendingMine = !!game.pending && game.pending.playerId === meId;
    const isActive = !game.over && (
      (meId === game.currentPlayerId && (game.phase === 'play' || (game.phase === 'discard' && game.discardPlayerId === meId)))
      || pendingMine
    );
    renderOptional(game, isActive, meId, t, net);
    renderBoard(game, isActive);
    renderCards(game, isActive, net, t);
    renderRoyalties(game, isActive, meId, net, t);
    renderOpp(game, oppId(game, meId), net, t);
    renderMy(game, meId, isActive, t);
    renderActions(game, meId, isActive, t, net);
    renderInfo(game, meId, t);
    renderLog(game, meId, net, t);
  }

  return { render, _lastState: null, _lastNet: null, _lastMeId: null, _lastT: null, _lastNameOf: null };
})();
