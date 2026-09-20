'use strict';

/**
 * 掼蛋客户端渲染器
 */
window.GuandanUi = (function () {
  const els = {};
  let selectedCardIds = new Set();

  function getEl(id) {
    return document.getElementById(id);
  }

  function initElements() {
    els.panel = getEl('panel-guandan');
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
  }

  function isRedSuit(suit) {
    return suit === '♥' || suit === '♦';
  }

  function renderCard(card, opts = {}) {
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.id = card.id;

    const red = isRedSuit(card.suit);
    div.classList.add(red ? 'is-red' : 'is-black');

    if (opts.isLevel) {
      div.classList.add('is-level');
    }

    const rankEl = document.createElement('span');
    rankEl.className = 'card-rank';
    rankEl.textContent =
      card.rank === 'joker' || card.rank === 'JOKER' ? 'JOK' : card.rank;

    const suitEl = document.createElement('span');
    suitEl.className = 'card-suit';
    suitEl.textContent = card.suit === 'joker' ? '🃏' : card.suit;

    div.appendChild(rankEl);
    div.appendChild(suitEl);

    if (opts.selectable) {
      div.classList.add('is-selectable');
      if (selectedCardIds.has(card.id)) {
        div.classList.add('is-selected');
      }
      div.addEventListener('click', () => {
        if (selectedCardIds.has(card.id)) {
          selectedCardIds.delete(card.id);
          div.classList.remove('is-selected');
        } else {
          selectedCardIds.add(card.id);
          div.classList.add('is-selected');
        }
      });
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
    const n = Math.min(count, 14);
    for (let i = 0; i < n; i++) frag.appendChild(renderCardBack());
    if (count > n) {
      const more = document.createElement('span');
      more.style.fontSize = '0.7rem';
      more.style.alignSelf = 'center';
      more.style.color = 'var(--muted)';
      more.textContent = '+' + (count - n);
      frag.appendChild(more);
    }
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
    const oppositeIdx = (myIdx + 2) % order.length;
    const prevIdx = (myIdx - 1 + order.length) % order.length;
    const nextIdx = (myIdx + 1) % order.length;
    return {
      me: meId,
      opposite: order[oppositeIdx],
      prev: order[prevIdx],
      next: order[nextIdx],
    };
  }

  function getTeamLabel(playerId, game) {
    if (!game.teamA || !game.teamB) return '';
    if (game.teamA.includes(playerId)) return 'A';
    if (game.teamB.includes(playerId)) return 'B';
    return '';
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

    const name = net && net.playerNameById ? net.playerNameById(pid) : pid;
    nameEl.textContent = name;

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
      playEl.appendChild(renderCards(game.lastPlay.cards));
    }
  }

  function renderPlay(game, net, meId, t) {
    const players = getOrderedPlayers(game, meId);

    // 更新级牌显示
    if (els.levelValue) {
      els.levelValue.textContent = game.level || '2';
    }

    // 渲染对家
    renderPlayerArea(
      players.opposite,
      game,
      net,
      meId,
      t,
      'opposite'
    );

    // 渲染上家
    renderPlayerArea(players.prev, game, net, meId, t, 'prev');

    // 渲染下家
    renderPlayerArea(players.next, game, net, meId, t, 'next');

    // 居中出牌区
    clearChildren(els.lastPlayCenter);
    clearChildren(els.lastPlayInfo);

    if (game.lastPlay && game.lastPlay.cards) {
      els.lastPlayCenter.appendChild(renderCards(game.lastPlay.cards));
      const name = (net && net.playerNameById)
        ? net.playerNameById(game.lastPlay.playerId)
        : game.lastPlay.playerId;
      els.lastPlayInfo.textContent = t('guandan.lastPlay', { name });
    } else {
      els.lastPlayInfo.textContent = t('guandan.newRound');
    }

    // 我的手牌
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
          isLevel: game.level ? (c) => c.rank === game.level : false,
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
          net.sendAction('play', { cards: Array.from(selectedCardIds) });
          selectedCardIds.clear();
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

  function renderLog(game, meId, net, t) {
    clearChildren(els.log);
    if (!game.lastPlay) return;
    const li = document.createElement('li');
    const name =
      net && net.playerNameById
        ? net.playerNameById(game.lastPlay.playerId)
        : game.lastPlay.playerId;
    const cards = game.lastPlay.cards.map(formatCardShort).join(' ');
    li.textContent = `${name}: ${cards}`;
    els.log.appendChild(li);
  }

  function render(game, net, opts = {}) {
    if (!game || game.type !== 'guandan') return;
    initElements();

    const meId = opts.meId || null;
    const t = opts.t || ((k, p) => k);

    if (!els.panel) return;

    renderPlay(game, net, meId, t);
    renderLog(game, meId, net, t);
  }

  return { render };
})();
