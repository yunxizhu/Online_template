'use strict';

/**
 * 掼蛋客户端渲染器
 */
window.GuandanUi = (function () {
  const els = {};
  let selectedCardIds = new Set();
  let nameOf = (id) => (id == null ? '—' : String(id));

  /* ============ 滑动选牌 ============ */
  let paintSelecting = false;
  let paintModeAdd = true;
  let paintTouched = new Set();
  let paintBound = false;

  function applyPaintToCard(cardEl) {
    if (!cardEl || !cardEl.classList.contains('is-selectable')) return;
    const id = cardEl.dataset.id;
    if (!id || paintTouched.has(id)) return;
    paintTouched.add(id);
    if (paintModeAdd) {
      selectedCardIds.add(id);
      cardEl.classList.add('is-selected');
    } else {
      selectedCardIds.delete(id);
      cardEl.classList.remove('is-selected');
    }
  }

  function cardFromPoint(x, y, handEl) {
    const el = document.elementFromPoint(x, y);
    if (!el || typeof el.closest !== 'function') return null;
    const card = el.closest('.card.is-selectable');
    if (!card || !handEl.contains(card)) return null;
    return card;
  }

  function bindHandPaintSelect() {
    if (paintBound || !els.myHand) return;
    paintBound = true;
    const handEl = els.myHand;

    const endPaint = () => {
      paintSelecting = false;
      paintTouched = new Set();
      handEl.classList.remove('is-painting');
    };

    handEl.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      const card = e.target.closest && e.target.closest('.card.is-selectable');
      if (!card || !handEl.contains(card)) return;
      paintSelecting = true;
      paintTouched = new Set();
      paintModeAdd = !selectedCardIds.has(card.dataset.id);
      handEl.classList.add('is-painting');
      applyPaintToCard(card);
      try {
        handEl.setPointerCapture(e.pointerId);
      } catch (_) {}
      e.preventDefault();
    });

    handEl.addEventListener('pointermove', (e) => {
      if (!paintSelecting) return;
      const card = cardFromPoint(e.clientX, e.clientY, handEl);
      if (card) applyPaintToCard(card);
    });

    handEl.addEventListener('pointerup', endPaint);
    handEl.addEventListener('pointercancel', endPaint);
    handEl.addEventListener('lostpointercapture', endPaint);
  }

  /* ============ 记牌器（双副牌） ============ */
  const RANK_INITIAL = {
    '3': 8, '4': 8, '5': 8, '6': 8, '7': 8, '8': 8, '9': 8,
    '10': 8, 'J': 8, 'Q': 8, 'K': 8, 'A': 8, '2': 8,
    joker: 2, JOKER: 2,
  };
  const RANK_TRACKER_ORDER = [
    '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'joker', 'JOKER',
  ];

  let trackerData = {};
  let lastTrackedPlay = null;
  let lastGameStartedAt = null;

  function initTracker() {
    trackerData = {};
    for (const r of RANK_TRACKER_ORDER) trackerData[r] = 0;
    lastTrackedPlay = null;
  }

  function trackPlayed(cards) {
    if (!cards) return;
    for (const c of cards) {
      if (trackerData[c.rank] !== undefined) {
        trackerData[c.rank]++;
      }
    }
  }

  function countMyHandByRank(myHand) {
    const counts = {};
    for (const r of RANK_TRACKER_ORDER) counts[r] = 0;
    if (!myHand) return counts;
    for (const c of myHand) {
      if (counts[c.rank] !== undefined) counts[c.rank]++;
    }
    return counts;
  }

  function renderTracker(myHand, game, t) {
    if (!els.cardTracker || !els.ctGrid) return;

    els.cardTracker.hidden = false;
    clearChildren(els.ctGrid);

    const myCounts = countMyHandByRank(myHand);
    let totalRemaining = 0;
    for (const rank of RANK_TRACKER_ORDER) {
      const played = trackerData[rank] || 0;
      const initial = RANK_INITIAL[rank] || 0;
      const mine = myCounts[rank] || 0;
      // 剩余 = 总量 - 已出 - 我手中（记别人手里还剩多少）
      const remain = Math.max(0, initial - played - mine);
      totalRemaining += remain;

      const cell = document.createElement('div');
      cell.className = 'gd-ct-cell';
      if (game.level && rank === game.level) cell.classList.add('is-level');

      const label = document.createElement('span');
      label.className = 'gd-ct-rank';
      if (rank === 'joker') {
        label.textContent = t('guandan.jokerSmall');
        cell.classList.add('is-joker');
      } else if (rank === 'JOKER') {
        label.textContent = t('guandan.jokerBig');
        cell.classList.add('is-joker');
      } else {
        label.textContent = rank;
      }

      const count = document.createElement('span');
      count.className = 'gd-ct-count';
      count.textContent = remain;
      if (remain === 0) count.classList.add('is-zero');
      else if (remain === 1) count.classList.add('is-one');

      cell.appendChild(label);
      cell.appendChild(count);
      els.ctGrid.appendChild(cell);
    }

    if (els.ctRemain) {
      els.ctRemain.textContent = t('guandan.trackerRemain', { count: totalRemaining });
    }
  }

  function getEl(id) {
    return document.getElementById(id);
  }

  function initElements() {
    els.panel = getEl('panel-guandan');
    els.table = getEl('gd-table');
    els.levelValue = getEl('gd-level-value');
    els.areaOpposite = getEl('gd-area-opposite');
    els.areaPrev = getEl('gd-area-prev');
    els.areaNext = getEl('gd-area-next');
    els.centerArea = getEl('gd-center-area');
    els.lastPlayCenter = getEl('gd-last-play-center');
    els.lastPlayInfo = getEl('gd-last-play-info');
    els.myHand = getEl('gd-my-hand');
    els.myRole = getEl('gd-my-role');
    els.myCount = getEl('gd-my-count');
    els.playActions = getEl('gd-play-actions');
    els.log = getEl('gd-log');

    els.nameOpposite = getEl('gd-name-opposite');
    els.roleOpposite = getEl('gd-role-opposite');
    els.handOpposite = getEl('gd-hand-opposite');
    els.countOpposite = getEl('gd-count-opposite');
    els.playOpposite = getEl('gd-play-opposite');

    els.namePrev = getEl('gd-name-prev');
    els.rolePrev = getEl('gd-role-prev');
    els.handPrev = getEl('gd-hand-prev');
    els.countPrev = getEl('gd-count-prev');
    els.playPrev = getEl('gd-play-prev');

    els.nameNext = getEl('gd-name-next');
    els.roleNext = getEl('gd-role-next');
    els.handNext = getEl('gd-hand-next');
    els.countNext = getEl('gd-count-next');
    els.playNext = getEl('gd-play-next');

    els.cardTracker = getEl('gd-card-tracker');
    els.ctGrid = getEl('gd-ct-grid');
    els.ctRemain = getEl('gd-ct-remain');
    els.sidePanel = getEl('gd-side-panel');
    els.handDetail = getEl('gd-hand-detail');
    els.scoreboard = getEl('gd-scoreboard');
  }

  function isRedSuit(suit) {
    return suit === '♥' || suit === '♦';
  }

  function renderCard(card, opts = {}) {
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.id = card.id;
    div.classList.add(isRedSuit(card.suit) ? 'is-red' : 'is-black');

    if (opts.levelRank && card.rank === opts.levelRank) {
      div.classList.add('is-level');
    }

    const rankText =
      card.rank === 'joker' || card.rank === 'JOKER' ? 'JOK' : card.rank;
    const suitText = card.suit === 'joker' ? '🃏' : card.suit;

    const tl = document.createElement('div');
    tl.className = 'card-corner card-tl';
    const tlRank = document.createElement('span');
    tlRank.className = 'corner-rank';
    tlRank.textContent = rankText;
    const tlSuit = document.createElement('span');
    tlSuit.className = 'corner-suit';
    tlSuit.textContent = suitText;
    tl.appendChild(tlRank);
    tl.appendChild(tlSuit);

    const center = document.createElement('div');
    center.className = 'card-center';
    center.textContent = suitText;

    const br = document.createElement('div');
    br.className = 'card-corner card-br';
    const brRank = document.createElement('span');
    brRank.className = 'corner-rank';
    brRank.textContent = rankText;
    const brSuit = document.createElement('span');
    brSuit.className = 'corner-suit';
    brSuit.textContent = suitText;
    br.appendChild(brRank);
    br.appendChild(brSuit);

    div.appendChild(tl);
    div.appendChild(center);
    div.appendChild(br);

    if (opts.selectable) {
      div.classList.add('is-selectable');
      if (selectedCardIds.has(card.id)) {
        div.classList.add('is-selected');
      }
    }

    return div;
  }

  function renderCardBack() {
    const div = document.createElement('div');
    div.className = 'card-back';
    return div;
  }

  function formatCardShort(card) {
    const r = card.rank === 'joker' || card.rank === 'JOKER' ? 'JOK' : card.rank;
    return r + (card.suit === 'joker' ? '🃏' : card.suit);
  }

  function renderHandBack(count) {
    const frag = document.createDocumentFragment();
    const n = Math.max(0, Number(count) || 0);
    for (let i = 0; i < n; i++) frag.appendChild(renderCardBack());
    return frag;
  }

  function renderCards(cards, opts = {}) {
    const frag = document.createDocumentFragment();
    if (!cards || !cards.length) return frag;
    for (const c of cards) {
      frag.appendChild(renderCard(c, opts));
    }
    return frag;
  }

  function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function getOrderedPlayers(game, meId) {
    const order = (game.turnOrder || []).slice();
    if (!meId || order.length < 4) {
      return { me: null, opposite: null, prev: null, next: null };
    }
    const myIdx = order.indexOf(meId);
    if (myIdx === -1) {
      return { me: null, opposite: null, prev: null, next: null };
    }
    return {
      me: meId,
      opposite: order[(myIdx + 2) % order.length],
      prev: order[(myIdx - 1 + order.length) % order.length],
      next: order[(myIdx + 1) % order.length],
    };
  }

  function getTeamLabel(playerId, game) {
    if (!game.teamA || !game.teamB) return '';
    if (game.teamA.includes(playerId)) return 'A';
    if (game.teamB.includes(playerId)) return 'B';
    return '';
  }

  function renderSidePanel(game, t, meId) {
    if (els.levelValue) {
      els.levelValue.textContent = game.level || '2';
    }

    if (els.handDetail) {
      clearChildren(els.handDetail);
      const addLine = (text) => {
        if (!text) return;
        const row = document.createElement('div');
        row.className = 'gd-detail-row';
        row.textContent = text;
        els.handDetail.appendChild(row);
      };

      const teamA = (game.teamA || []).map((id) => nameOf(id)).join(' & ');
      const teamB = (game.teamB || []).map((id) => nameOf(id)).join(' & ');
      if (teamA) addLine(t('guandan.teamLine', { team: 'A', names: teamA }));
      if (teamB) addLine(t('guandan.teamLine', { team: 'B', names: teamB }));

      if (game.over && game.winnerTeam) {
        const levelText = t('guandan.levelUp', { n: game.levelsUp || 1 });
        addLine(
          t('guandan.teamWin', {
            team: game.winnerTeam,
            levelUp: levelText,
          })
        );
      }
    }

    if (!els.scoreboard) return;
    clearChildren(els.scoreboard);

    const handCounts = game.handCounts || {};
    const finishOrder = game.finishOrder || [];
    const order = (game.turnOrder || []).slice();

    for (const pid of order) {
      const chip = document.createElement('div');
      chip.className = 'gd-score-chip';
      const team = getTeamLabel(pid, game);
      if (pid === meId) chip.classList.add('is-me');
      if (team === 'A') chip.classList.add('is-teamA');
      if (team === 'B') chip.classList.add('is-teamB');
      if (pid === game.currentPlayerId && !game.over) chip.classList.add('is-turn');
      if (finishOrder.includes(pid)) chip.classList.add('is-finished');

      const top = document.createElement('div');
      top.className = 'gd-score-top';
      const nameEl = document.createElement('span');
      nameEl.className = 'gd-score-name';
      nameEl.textContent = nameOf(pid);
      const handEl = document.createElement('span');
      handEl.className = 'gd-score-hand';
      handEl.textContent = t('guandan.handCount', {
        count: handCounts[pid] != null ? handCounts[pid] : 0,
      });
      top.appendChild(nameEl);
      top.appendChild(handEl);
      chip.appendChild(top);

      const meta = document.createElement('div');
      meta.className = 'gd-score-meta';
      if (team) {
        const role = document.createElement('span');
        role.className = 'gd-score-role';
        role.textContent = t('guandan.team', { team });
        meta.appendChild(role);
      }
      if (finishOrder.includes(pid)) {
        const fin = document.createElement('span');
        fin.className = 'gd-score-finish';
        fin.textContent = t('guandan.finished', {
          order: finishOrder.indexOf(pid) + 1,
        });
        meta.appendChild(fin);
      }
      if (meta.childNodes.length) chip.appendChild(meta);
      els.scoreboard.appendChild(chip);
    }
  }

  function renderPlayerArea(pid, game, net, meId, t, areaId) {
    const nameEl = getEl('gd-name-' + areaId);
    const roleEl = getEl('gd-role-' + areaId);
    const handEl = getEl('gd-hand-' + areaId);
    const countEl = getEl('gd-count-' + areaId);
    const playEl = getEl('gd-play-' + areaId);

    clearChildren(nameEl);
    clearChildren(roleEl);
    clearChildren(handEl);
    clearChildren(countEl);
    clearChildren(playEl);

    if (!pid) return;

    nameEl.textContent = nameOf(pid);

    const team = getTeamLabel(pid, game);
    roleEl.textContent = team ? t('guandan.team', { team }) : '';
    roleEl.className = 'gd-player-role';
    if (team === 'A') roleEl.classList.add('is-teamA');
    if (team === 'B') roleEl.classList.add('is-teamB');

    if (game.finishOrder && game.finishOrder.includes(pid)) {
      roleEl.classList.add('is-finished');
      const order = game.finishOrder.indexOf(pid) + 1;
      roleEl.textContent = t('guandan.finished', { order });
    }

    const count = game.handCounts ? game.handCounts[pid] || 0 : 0;
    handEl.appendChild(renderHandBack(count));
    countEl.textContent = t('guandan.handCount', { count });

    if (
      game.lastPlay &&
      game.lastPlay.playerId === pid &&
      game.lastPlay.cards
    ) {
      playEl.appendChild(
        renderCards(game.lastPlay.cards, { levelRank: game.level })
      );
    }
  }

  function renderPlay(game, net, meId, t) {
    const players = getOrderedPlayers(game, meId);

    renderPlayerArea(players.opposite, game, net, meId, t, 'opposite');
    renderPlayerArea(players.prev, game, net, meId, t, 'prev');
    renderPlayerArea(players.next, game, net, meId, t, 'next');

    clearChildren(els.lastPlayCenter);
    clearChildren(els.lastPlayInfo);

    if (game.lastPlay && game.lastPlay.cards) {
      els.lastPlayCenter.appendChild(
        renderCards(game.lastPlay.cards, { levelRank: game.level })
      );
      els.lastPlayInfo.textContent = t('guandan.lastPlay', {
        name: nameOf(game.lastPlay.playerId),
      });
    } else {
      els.lastPlayInfo.textContent = t('guandan.newRound');
    }

    clearChildren(els.myHand);
    clearChildren(els.myRole);
    clearChildren(els.myCount);
    clearChildren(els.playActions);

    if (meId && game.hands && game.hands[meId]) {
      const myHand = game.hands[meId];
      const myTeam = getTeamLabel(meId, game);
      els.myRole.textContent = myTeam
        ? t('guandan.myTeam', { team: myTeam })
        : '';
      els.myRole.className = 'gd-my-role';
      if (myTeam === 'A') els.myRole.classList.add('is-teamA');
      if (myTeam === 'B') els.myRole.classList.add('is-teamB');

      if (game.finishOrder && game.finishOrder.includes(meId)) {
        els.myRole.textContent = t('guandan.iFinished');
        els.myRole.classList.add('is-finished');
      }

      els.myCount.textContent = t('guandan.myHandCount', {
        count: myHand.length,
      });

      const isActive =
        meId === game.currentPlayerId &&
        !(game.finishOrder && game.finishOrder.includes(meId));
      els.myHand.appendChild(
        renderCards(myHand, {
          selectable: isActive,
          levelRank: game.level || null,
        })
      );

      if (isActive) {
        const hint = document.createElement('div');
        hint.className = 'muted';
        hint.style.marginBottom = '0.25rem';
        hint.textContent = t('guandan.selectCards');
        els.playActions.appendChild(hint);

        const passBtn = document.createElement('button');
        passBtn.type = 'button';
        passBtn.className = 'secondary';
        passBtn.textContent = t('guandan.pass');
        passBtn.addEventListener('click', () => {
          selectedCardIds.clear();
          net.sendAction('pass', {});
        });
        els.playActions.appendChild(passBtn);

        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.textContent = t('guandan.play');
        playBtn.addEventListener('click', () => {
          if (!selectedCardIds.size) {
            alert(t('guandan.selectCards'));
            return;
          }
          const cards = Array.from(selectedCardIds);
          net.sendAction('play', { cards });
        });
        els.playActions.appendChild(playBtn);

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'secondary';
        resetBtn.textContent = t('guandan.reset');
        resetBtn.addEventListener('click', () => {
          selectedCardIds.clear();
          refreshHandSelection();
        });
        els.playActions.appendChild(resetBtn);
      }
    }
  }

  function refreshHandSelection() {
    if (!els.myHand) return;
    for (const el of els.myHand.children) {
      if (selectedCardIds.has(el.dataset.id)) {
        el.classList.add('is-selected');
      } else {
        el.classList.remove('is-selected');
      }
    }
  }

  function clearSelection() {
    selectedCardIds.clear();
    refreshHandSelection();
  }

  function isInvalidPlayError(data) {
    const msg = String((data && data.message) || '');
    return (
      msg.includes('牌型不合法') ||
      msg.includes('不足以压过') ||
      msg.includes('invalid') ||
      (data && data.code === 'invalid_play')
    );
  }

  function onGameError(data, opts = {}) {
    if (!isInvalidPlayError(data)) return false;
    const t = opts.t || ((k) => k);
    alert(t('guandan.invalidPlay'));
    clearSelection();
    return true;
  }

  function renderLog(game) {
    clearChildren(els.log);
    if (!game.lastPlay) return;
    const li = document.createElement('li');
    const name = nameOf(game.lastPlay.playerId);
    const cards = game.lastPlay.cards.map(formatCardShort).join(' ');
    li.textContent = `${name}: ${cards}`;
    els.log.appendChild(li);
  }

  function render(game, net, opts = {}) {
    if (!game || game.type !== 'guandan') return;
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

    bindHandPaintSelect();

    const myHand = (meId && game.hands && game.hands[meId]) || [];
    if (selectedCardIds.size) {
      const alive = new Set(myHand.map((c) => c.id));
      for (const id of [...selectedCardIds]) {
        if (!alive.has(id)) selectedCardIds.delete(id);
      }
    }

    // 新开局重置记牌器
    if (game.startedAt && game.startedAt !== lastGameStartedAt) {
      lastGameStartedAt = game.startedAt;
      initTracker();
    }

    renderPlay(game, net, meId, t);
    renderLog(game);
    renderSidePanel(game, t, meId);

    // 记牌器：跟踪出牌，未结束时显示
    const lastPlay = game.lastPlay;
    if (lastPlay && lastPlay.cards && lastPlay.cards.length) {
      const sig =
        lastPlay.playerId +
        '|' +
        lastPlay.cards
          .map((c) => c.id)
          .sort()
          .join(',');
      if (!lastTrackedPlay || lastTrackedPlay !== sig) {
        trackPlayed(lastPlay.cards);
        lastTrackedPlay = sig;
      }
    }

    if (!game.over) {
      renderTracker(myHand, game, t);
      if (els.table) els.table.classList.add('has-tracker');
    } else if (els.cardTracker) {
      els.cardTracker.hidden = true;
      if (els.table) els.table.classList.remove('has-tracker');
    }
  }

  return { render, onGameError };
})();
