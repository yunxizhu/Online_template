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
  const GOLD = 'gold';
  const ASSOCIATE = 'associate';
  const BSIZE = 5;
  const GOAL_PRESTIGE = 20;
  const GOAL_CROWNS = 10;
  const GOAL_COLOR = 10;
  const RESERVE_LIMIT = 3;
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
    els.bagLeft = getEl('sd-bag-left');
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

  /**
   * 面板里的静态文案（data-i18n / data-i18n-attr）。
   * 面板是运行时注入的，可能错过全局 i18n 扫描；且语言包缺键时 t() 会原样返回 key。
   * 这里统一兜底：取不到译文就回落到 HTML 里写的默认文本，绝不把 "splendorDuel.xxx" 显示在界面上。
   */
  function applyStaticI18n(t) {
    if (!els.panel || typeof t !== 'function') return;
    const nodes = els.panel.querySelectorAll('[data-i18n],[data-i18n-attr]');
    for (const el of nodes) {
      const key = el.getAttribute('data-i18n');
      if (key) {
        if (el.dataset.i18nFb === undefined) el.dataset.i18nFb = el.textContent || '';
        const v = t(key);
        el.textContent = v && v !== key ? v : el.dataset.i18nFb;
      }
      const spec = el.getAttribute('data-i18n-attr');
      if (spec) {
        for (const part of String(spec).split(',')) {
          const bits = part.split(':').map((s) => (s || '').trim());
          if (bits.length < 2 || !bits[0] || !bits[1]) continue;
          const [attr, aKey] = bits;
          const fbKey = 'i18nFbAttr' + attr.charAt(0).toUpperCase() + attr.slice(1);
          if (el.dataset[fbKey] === undefined) el.dataset[fbKey] = el.getAttribute(attr) || '';
          const av = t(aKey);
          el.setAttribute(attr, av && av !== aKey ? av : el.dataset[fbKey]);
        }
      }
    }
  }
  function oppId(game, me) { return game.turnOrder.find((id) => id !== me) || null; }

  function mini(col, n) {
    const d = document.createElement('div');
    d.className = 'sd-mini-token ' + col;
    d.textContent = (NAMES[col] || col).charAt(0) + n;
    d.title = NAMES[col] || col;
    return d;
  }
  function bonusDot(col, n) {
    const d = document.createElement('div');
    d.className = 'sd-bonus-dot ' + col;
    d.textContent = n;
    // 明确表达「购买该色卡牌的费用减免」（红利数量 = 减免数量）
    d.title = (NAMES[col] || col) + ' · 费用减免 -' + n;
    return d;
  }
  function reserveBack() {
    const d = document.createElement('div');
    d.className = 'sd-reserve-back';
    d.textContent = '\u{1F0CF}';
    return d;
  }
  function reserveSlot() {
    const d = document.createElement('div');
    d.className = 'sd-reserve-slot';
    return d;
  }

  function setStat(el, label, cur, max, cls) {
    if (!el) return;
    clear(el);
    el.className = 'sd-stat ' + cls;
    const v = document.createElement('span');
    v.className = 'sd-stat-v';
    v.textContent = label;
    el.appendChild(v);
    if (max > 0) {
      const bar = document.createElement('span');
      bar.className = 'sd-stat-bar';
      const i = document.createElement('i');
      i.style.width = Math.max(0, Math.min(100, Math.round(((cur || 0) / max) * 100))) + '%';
      bar.appendChild(i);
      el.appendChild(bar);
    }
  }

  function abilityText(ability, t) {
    if (!ability) return '';
    const key = ABILITIES[ability];
    return key ? t(key) : ability;
  }

  /* ===== 卡牌 ===== */
  function cardDiv(card, opts = {}) {
    const t = opts.t || ((k) => k);
    const d = document.createElement('div');
    d.className = 'sd-card' + (card.tier ? ' tier' + card.tier : '');
    d.dataset.cardId = card.id;
    if (card.tier) d.dataset.tier = card.tier;

    const top = document.createElement('div');
    top.className = 'sd-card-top';
    const left = document.createElement('div'); left.className = 'sd-card-left';
    const right = document.createElement('div'); right.className = 'sd-card-right';

    if (card.discount === ASSOCIATE) {
      const s = document.createElement('span');
      s.className = 'sd-card-discount associate';
      s.textContent = card.assocColor ? (NAMES[card.assocColor] || card.assocColor).charAt(0) : '\u2605';
      s.title = t('splendorDuel.associateBonus');
      left.appendChild(s);
    } else if (card.discount) {
      const s = document.createElement('span');
      s.className = 'sd-card-discount ' + card.discount;
      s.textContent = (NAMES[card.discount] || card.discount).charAt(0);
      s.title = NAMES[card.discount] || card.discount;
      left.appendChild(s);
    } else if (card.isRoyalty !== true) {
      const s = document.createElement('span');
      s.className = 'sd-card-gold';
      s.textContent = '\u{1F4B0}';
      s.title = t('splendorDuel.goldCard');
      left.appendChild(s);
    }

    if (card.prestige) {
      const s = document.createElement('span');
      s.className = 'sd-card-prestige';
      s.textContent = '+' + card.prestige;
      right.appendChild(s);
    }
    if (card.crowns) {
      const s = document.createElement('span');
      s.className = 'sd-card-crowns';
      s.textContent = '\u{1F451}' + card.crowns;
      right.appendChild(s);
    }
    top.appendChild(left); top.appendChild(right);
    d.appendChild(top);

    if (card.ability) {
      const a = document.createElement('div');
      a.className = 'sd-card-ability';
      a.textContent = abilityText(card.ability, t);
      d.appendChild(a);
    }
    if (card.cost && Object.keys(card.cost).length) {
      const costs = document.createElement('div');
      costs.className = 'sd-card-costs';
      for (const [col, n] of Object.entries(card.cost)) {
        const chip = document.createElement('span');
        chip.className = 'sd-cost-chip ' + col;
        chip.textContent = n;
        chip.title = (NAMES[col] || col) + ' ' + n;
        costs.appendChild(chip);
      }
      d.appendChild(costs);
    }
    if (opts.affordable) d.classList.add('is-affordable');
    if (opts.dim) d.classList.add('is-dim');
    if (opts.selectable) d.classList.add('is-selectable');
    if (opts.selected) d.classList.add('is-selected');
    if (opts.onClick) d.addEventListener('click', opts.onClick);
    return d;
  }

  function royaltyDiv(roy, opts = {}) {
    const t = opts.t || ((k) => k);
    const d = document.createElement('div');
    d.className = 'sd-royalty' + (roy.claimedBy ? ' claimed' : '');
    const p = document.createElement('div'); p.className = 'sd-royalty-prestige'; p.textContent = '+' + roy.prestige; d.appendChild(p);
    if (roy.ability) { const a = document.createElement('div'); a.className = 'sd-royalty-ability'; a.textContent = abilityText(roy.ability, t); d.appendChild(a); }
    if (roy.claimedBy) { const c = document.createElement('div'); c.className = 'sd-royalty-claimed'; c.textContent = '\u2713 ' + nameOf(roy.claimedBy); d.appendChild(c); }
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
        if (color) cell.title = NAMES[color] || color;
        if (clickable) cell.addEventListener('click', () => _toggleCell(r, c));
        els.boardGrid.appendChild(cell);
      }
    }
  }

  function boardHasNonGold(board) {
    for (let r = 0; r < BSIZE; r++) for (let c = 0; c < BSIZE; c++) { const v = board[r][c]; if (v && v !== GOLD) return true; }
    return false;
  }
  function boardHasGold(board) {
    for (let r = 0; r < BSIZE; r++) for (let c = 0; c < BSIZE; c++) if (board[r][c] === GOLD) return true;
    return false;
  }

  /* 能否买得起（与服务端 computePayment 同口径） */
  function _canAfford(p, card) {
    const bonus = p.bonusCounts || {};
    const tok = p.tokenCounts || {};
    let goldNeed = 0;
    for (const col of COLORS) {
      const need = (card.cost && card.cost[col]) || 0;
      const deficit = Math.max(0, need - (bonus[col] || 0));
      const have = tok[col] || 0;
      const fromTok = Math.min(have, deficit);
      if (fromTok < deficit) goldNeed += deficit - fromTok;
    }
    return goldNeed <= (tok[GOLD] || 0);
  }

  function _anyAffordable(game, meId) {
    const p = game.players[meId];
    if (!p) return false;
    for (const key of ['tier1', 'tier2', 'tier3']) {
      for (const card of game.boardCards[key] || []) if (_canAfford(p, card)) return true;
    }
    for (const card of p.reserved || []) if (card && card.id && _canAfford(p, card)) return true;
    return false;
  }

  function renderCards(game, isActive, meId, net, t) {
    const p = game.players[meId];
    const buyMode = isActive && mandatoryMode === 'buy';
    for (const tier of [1, 2, 3]) {
      const key = 'tier' + tier;
      const bEl = getEl('sd-board-t' + tier), dEl = getEl('sd-deck-t' + tier);
      clear(bEl); clear(dEl);
      const arr = game.boardCards[key] || [];
      for (let i = 0; i < arr.length; i++) {
        const card = arr[i];
        const afford = p ? _canAfford(p, card) : false;
        bEl.appendChild(cardDiv(card, {
          t,
          affordable: buyMode && afford,
          dim: buyMode && !afford,
          selectable: isActive && (mandatoryMode === 'buy' || mandatoryMode === 'reserve'),
          selected: selectedCardId === card.id,
          onClick: () => {
            if (mandatoryMode === 'buy') { if (!afford) return; selectedCardId = card.id; _forceRefresh(); }
            else if (mandatoryMode === 'reserve') { _doReserve(net, tier, i, false); }
          },
        }));
      }
      const left = game.decksLeft[key] || 0;
      const n = document.createElement('span'); n.className = 'sd-deck-n'; n.textContent = left;
      const lbl = document.createElement('span'); lbl.textContent = left > 0 ? t('splendorDuel.deck') : t('splendorDuel.deckEmpty');
      dEl.appendChild(n); dEl.appendChild(lbl);
      dEl.classList.remove('is-reservable', 'is-empty');
      if (left === 0) dEl.classList.add('is-empty');
      if (left > 0 && isActive && mandatoryMode === 'reserve') {
        dEl.classList.add('is-reservable');
        dEl.onclick = () => _doReserve(net, tier, -1, true);
      } else dEl.onclick = null;
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
      btn.disabled = selectedCells.length !== privilegeMode.count;
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
    clear(els.myBonus); clear(els.myReserved); clear(els.myTokens); clear(els.myCards);
    const p = game.players[meId]; if (!p) return;
    setStat(els.myPrestige, t('splendorDuel.prestige', { n: p.prestige }), p.prestige, GOAL_PRESTIGE, 'prestige');
    setStat(els.myCrowns, t('splendorDuel.crowns', { n: p.crowns }), p.crowns, GOAL_CROWNS, 'crowns');
    setStat(els.myPrivileges, t('splendorDuel.privileges', { n: p.privileges }), p.privileges, 3, 'priv');

    for (const [col, n] of Object.entries(p.bonusCounts || {})) if (n > 0) els.myBonus.appendChild(bonusDot(col, n));

    // 已购卡：按红利颜色显示同色声望进度
    const cp = p.colorPrestige || {};
    for (const col of COLORS) {
      const v = cp[col] || 0;
      if (!v) continue;
      const row = document.createElement('div'); row.className = 'sd-cp-row';
      const dot = document.createElement('span'); dot.className = 'sd-cp-dot ' + col;
      const bar = document.createElement('span'); bar.className = 'sd-cp-bar';
      const i = document.createElement('i');
      i.style.width = Math.min(100, Math.round((v / GOAL_COLOR) * 100)) + '%';
      bar.appendChild(i);
      const num = document.createElement('span'); num.className = 'sd-cp-num'; num.textContent = v + '/' + GOAL_COLOR;
      row.appendChild(dot); row.appendChild(bar); row.appendChild(num);
      els.myCards.appendChild(row);
    }
    if (!els.myCards.childNodes.length) {
      const none = document.createElement('span'); none.className = 'sd-cp-num'; none.textContent = '—';
      els.myCards.appendChild(none);
    }

    // 预留卡（3 个槽位）
    const reserved = p.reserved || [];
    for (let i = 0; i < RESERVE_LIMIT; i++) {
      const rc = reserved[i];
      if (rc && rc.id) {
        const afford = _canAfford(p, rc);
        els.myReserved.appendChild(cardDiv(rc, {
          t,
          affordable: isActive && mandatoryMode === 'buy' && afford,
          dim: isActive && mandatoryMode === 'buy' && !afford,
          selectable: isActive && mandatoryMode === 'buy',
          selected: selectedCardId === rc.id,
          onClick: () => { if (mandatoryMode === 'buy') { if (!afford) return; selectedCardId = rc.id; _forceRefresh(); } },
        }));
      } else els.myReserved.appendChild(reserveSlot());
    }

    // 我的宝石
    for (const col of COLORS.concat([GOLD])) {
      const n = p.tokenCounts[col] || 0;
      if (n > 0) {
        const d = mini(col, n);
        if (_isDiscard(game, meId)) {
          d.classList.add('is-pickable');
          d.addEventListener('click', () => _toggleDiscardColor(col));
          if (discardColors.includes(col)) d.classList.add('is-picked');
        }
        els.myTokens.appendChild(d);
      }
    }
  }

  function renderOpp(game, oId, t) {
    clear(els.oppName); clear(els.oppTokens); clear(els.oppReserved); clear(els.oppBonus);
    if (!oId) return;
    els.oppName.textContent = nameOf(oId);
    const p = game.players[oId]; if (!p) return;
    setStat(els.oppPrestige, t('splendorDuel.prestige', { n: p.prestige }), p.prestige, GOAL_PRESTIGE, 'prestige');
    setStat(els.oppCrowns, t('splendorDuel.crowns', { n: p.crowns }), p.crowns, GOAL_CROWNS, 'crowns');
    setStat(els.oppPrivileges, t('splendorDuel.privileges', { n: p.privileges }), p.privileges, 3, 'priv');
    for (const col of COLORS.concat([GOLD])) { const n = p.tokenCounts[col] || 0; if (n > 0) els.oppTokens.appendChild(mini(col, n)); }
    for (let i = 0; i < (p.reserved || []).length; i++) els.oppReserved.appendChild(reserveBack());
    if (!(p.reserved || []).length) els.oppReserved.appendChild(reserveSlot());
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
    if (pend.type === 'associate_color' || pend.type === 'steal_gem') {
      const info = document.createElement('div'); info.className = 'sd-hint';
      info.textContent = pend.type === 'associate_color' ? t('splendorDuel.pendingAssociateHint') : t('splendorDuel.pendingStealHint');
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

  /* ===== 行动区（顶部行动条）===== */
  function renderActions(game, meId, isActive, t, net) {
    clear(els.actions); clear(els.mandHint);
    if (!isActive) return;

    if (game.pending) { renderPending(game, meId, t, net); return; }

    if (_isDiscard(game, meId)) {
      const info = document.createElement('div'); info.className = 'sd-hint';
      info.textContent = t('splendorDuel.discardHint', { need: game.discardNeed });
      els.actions.appendChild(info);
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = t('splendorDuel.discardConfirm');
      btn.disabled = discardColors.length < game.discardNeed;
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
      const me = game.players[meId] || {};
      const canTake = boardHasNonGold(game.board);
      const canReserve = (me.reserved || []).length < RESERVE_LIMIT
        && ((game.boardCards.tier1 || []).length + (game.boardCards.tier2 || []).length + (game.boardCards.tier3 || []).length > 0
          || (game.decksLeft.tier1 || 0) + (game.decksLeft.tier2 || 0) + (game.decksLeft.tier3 || 0) > 0);
      const canBuy = _anyAffordable(game, meId);

      const b1 = document.createElement('button'); b1.type = 'button'; b1.textContent = t('splendorDuel.actionTakeTokens');
      b1.disabled = !canTake;
      b1.onclick = () => { mandatoryMode = 'take'; selectedCells = []; _forceRefresh(); }; els.actions.appendChild(b1);
      const b2 = document.createElement('button'); b2.type = 'button'; b2.textContent = t('splendorDuel.actionReserve');
      b2.disabled = !canReserve;
      b2.onclick = () => { mandatoryMode = 'reserve'; selectedCells = []; _forceRefresh(); }; els.actions.appendChild(b2);
      const b3 = document.createElement('button'); b3.type = 'button'; b3.textContent = t('splendorDuel.actionBuyCard');
      b3.disabled = !canBuy;
      b3.onclick = () => { mandatoryMode = 'buy'; selectedCells = []; _forceRefresh(); }; els.actions.appendChild(b3);

      if (!canTake && !canReserve && !canBuy) {
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
      const chip = document.createElement('span'); chip.className = 'sd-sel-chip';
      chip.textContent = t('splendorDuel.selectedCount', { n: selectedCells.length, m: 3 });
      els.mandHint.appendChild(chip);
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = t('splendorDuel.confirmTake');
      btn.disabled = !_validTake();
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
      btn.disabled = !selectedCardId;
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

  /* ===== 日志 ===== */
  function renderLog(game, meId, t) {
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
      if (game.winCondition === 'stalemate') els.centerInfo.textContent += ' · ' + t('splendorDuel.stalemate');
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

  function renderBag(game, t) {
    clear(els.bagLeft);
    if (!els.bagLeft) return;
    els.bagLeft.textContent = t('splendorDuel.bag', { n: game.bagLeft || 0 });
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
    applyStaticI18n(t);
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
    renderBag(game, t);
    renderOptional(game, isActive, meId, t, net);
    renderBoard(game, isActive);
    renderCards(game, isActive, meId, net, t);
    renderRoyalties(game, isActive, meId, net, t);
    renderOpp(game, oppId(game, meId), t);
    renderMy(game, meId, isActive, t);
    renderActions(game, meId, isActive, t, net);
    renderInfo(game, meId, t);
    renderLog(game, meId, t);
  }

  return { render, _lastState: null, _lastNet: null, _lastMeId: null, _lastT: null, _lastNameOf: null };
})();
