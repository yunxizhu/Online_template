'use strict';

/**
 * 斗地主客户端渲染器
 */
window.DoudizhuUi = (function () {
  const els = {};
  let selectedCardIds = new Set();

  function getEl(id) {
    return document.getElementById(id);
  }

  function initElements() {
    els.panel = getEl('panel-doudizhu');
    els.bidArea = getEl('ddz-bid-area');
    els.bidInfo = getEl('ddz-bid-info');
    els.bidActions = getEl('ddz-bid-actions');
    els.landlordCards = getEl('ddz-landlord-cards');
    els.landlordLabel = getEl('ddz-landlord-label');
    els.areaPrev = getEl('ddz-area-prev');
    els.areaNext = getEl('ddz-area-next');
    els.centerArea = getEl('ddz-center-area');
    els.lastPlayCenter = getEl('ddz-last-play-center');
    els.lastPlayInfo = getEl('ddz-last-play-info');
    els.myHand = getEl('ddz-my-hand');
    els.myRole = getEl('ddz-my-role');
    els.myCount = getEl('ddz-my-count');
    els.playActions = getEl('ddz-play-actions');
    els.log = getEl('ddz-log');
  }

  function isRedSuit(suit) {
    return suit === '♥' || suit === '♦';
  }

  function renderCard(card, opts = {}) {
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.id = card.id;
    div.classList.add(isRedSuit(card.suit) ? 'is-red' : 'is-black');

    const rankEl = document.createElement('span');
    rankEl.className = 'card-rank';
    rankEl.textContent = card.rank === 'joker' || card.rank === 'JOKER' ? 'JOK' : card.rank;

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
    const n = Math.min(count, 12);
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
    if (!meId || order.length < 3) {
      return { me: null, prev: null, next: null };
    }
    const myIdx = order.indexOf(meId);
    if (myIdx === -1) {
      return { me: null, prev: null, next: null };
    }
    const prevIdx = (myIdx - 1 + order.length) % order.length;
    const nextIdx = (myIdx + 1) % order.length;
    return {
      me: meId,
      prev: order[prevIdx],
      next: order[nextIdx],
    };
  }

  function updateBid(clear) {
    selectedCardIds.clear();
    if (clear) {
      clearChildren(els.bidInfo);
      clearChildren(els.bidActions);
    }
  }

  function renderBid(game, net, meId, t) {
    els.bidArea.hidden = false;
    clearChildren(els.bidInfo);
    clearChildren(els.bidActions);
    clearChildren(els.landlordCards);
    els.landlordLabel.textContent = t('doudizhu.landlordCards');

    // 显示3张地主牌
    if (game.landlordCards && game.landlordCards.length) {
      els.landlordCards.appendChild(renderCards(game.landlordCards));
    }

    const info = document.createElement('div');
    info.textContent = t('doudizhu.bidHint');
    els.bidInfo.appendChild(info);

    const bidDone = game.bidScores && Object.values(game.bidScores).some((v) => v !== -1);
    if (bidDone) {
      const bids = document.createElement('div');
      bids.className = 'muted';
      for (const pid of game.turnOrder || []) {
        const s = game.bidScores[pid];
        const line = document.createElement('div');
        const name = (net && net.playerNameById) ? net.playerNameById(pid) : pid;
        line.textContent = t('doudizhu.bidRecord', {
          name,
          score: s >= 0 ? s : t('common.dash'),
        });
        bids.appendChild(line);
      }
      els.bidInfo.appendChild(bids);
    }

    if (meId === game.currentPlayerId && !game.landlordId) {
      const scores = [0, 1, 2, 3];
      for (const sc of scores) {
        if (sc > 0 && sc <= game.bidMaxScore) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = sc === 0 ? t('doudizhu.bidPass') : t('doudizhu.bidScore', { score: sc });
        btn.addEventListener('click', () => {
          net.sendAction('call', { score: sc });
        });
        els.bidActions.appendChild(btn);
      }
    }
  }

  function renderPlay(game, net, meId, t) {
    els.bidArea.hidden = true;
    clearChildren(els.landlordCards);
    clearChildren(els.landlordLabel);

    const players = getOrderedPlayers(game, meId);

    // 渲染上家
    clearChildren(getEl('ddz-name-prev'));
    clearChildren(getEl('ddz-role-prev'));
    clearChildren(getEl('ddz-hand-prev'));
    clearChildren(getEl('ddz-count-prev'));
    clearChildren(getEl('ddz-play-prev'));
    if (players.prev) {
      const pid = players.prev;
      const nameSpan = document.createElement('span');
      nameSpan.textContent = (net && net.playerNameById) ? net.playerNameById(pid) : pid;
      getEl('ddz-name-prev').appendChild(nameSpan);

      const isLandlord = pid === game.landlordId;
      getEl('ddz-role-prev').className = 'ddz-player-role ' + (isLandlord ? 'is-landlord' : 'is-farmer');
      getEl('ddz-role-prev').textContent = isLandlord ? t('doudizhu.role.landlord') : t('doudizhu.role.farmer');

      const count = (game.handCounts && game.handCounts[pid]) || 0;
      getEl('ddz-hand-prev').appendChild(renderHandBack(count));
      getEl('ddz-count-prev').textContent = t('doudizhu.handCount', { count });

      // 最后出牌
      if (game.lastPlay && game.lastPlay.playerId === pid) {
        getEl('ddz-play-prev').appendChild(renderCards(game.lastPlay.cards));
      }
    }

    // 渲染下家
    clearChildren(getEl('ddz-name-next'));
    clearChildren(getEl('ddz-role-next'));
    clearChildren(getEl('ddz-hand-next'));
    clearChildren(getEl('ddz-count-next'));
    clearChildren(getEl('ddz-play-next'));
    if (players.next) {
      const pid = players.next;
      const nameSpan = document.createElement('span');
      nameSpan.textContent = (net && net.playerNameById) ? net.playerNameById(pid) : pid;
      getEl('ddz-name-next').appendChild(nameSpan);

      const isLandlord = pid === game.landlordId;
      getEl('ddz-role-next').className = 'ddz-player-role ' + (isLandlord ? 'is-landlord' : 'is-farmer');
      getEl('ddz-role-next').textContent = isLandlord ? t('doudizhu.role.landlord') : t('doudizhu.role.farmer');

      const count = (game.handCounts && game.handCounts[pid]) || 0;
      getEl('ddz-hand-next').appendChild(renderHandBack(count));
      getEl('ddz-count-next').textContent = t('doudizhu.handCount', { count });

      if (game.lastPlay && game.lastPlay.playerId === pid) {
        getEl('ddz-play-next').appendChild(renderCards(game.lastPlay.cards));
      }
    }

    // 中间区域（最新出牌）
    clearChildren(els.lastPlayCenter);
    clearChildren(els.lastPlayInfo);
    if (game.lastPlay) {
      els.lastPlayCenter.appendChild(renderCards(game.lastPlay.cards));
      const name = (net && net.playerNameById) ? net.playerNameById(game.lastPlay.playerId) : game.lastPlay.playerId;
      els.lastPlayInfo.textContent = t('doudizhu.lastPlay', { name });
    } else {
      els.lastPlayInfo.textContent = t('doudizhu.newRound');
    }

    // 我的手牌
    clearChildren(els.myHand);
    const myHand = (meId && game.hands && game.hands[meId]) || [];
    for (const card of myHand) {
      els.myHand.appendChild(renderCard(card, {
        selectable: !game.over && meId === game.currentPlayerId && game.phase === 'play',
      }));
    }

    // 我的角色
    const isMeLandlord = meId === game.landlordId;
    els.myRole.className = 'ddz-my-role ' + (isMeLandlord ? 'is-landlord' : 'is-farmer');
    els.myRole.textContent = isMeLandlord ? t('doudizhu.role.landlord') : t('doudizhu.role.farmer');
    els.myCount.textContent = t('doudizhu.myHandCount', { count: myHand.length });

    // 操作按钮
    clearChildren(els.playActions);
    if (!game.over && meId === game.currentPlayerId && game.phase === 'play') {
      const isCurrentValid = meId === game.lastValidPlayerId;
      const mustPlay = !game.lastPlay || (game.passCount > 0 && game.lastValidPlayerId === meId) || !game.lastValidPlayerId;

      if (!mustPlay && !isCurrentValid) {
        const passBtn = document.createElement('button');
        passBtn.type = 'button';
        passBtn.className = 'secondary';
        passBtn.textContent = t('doudizhu.pass');
        passBtn.addEventListener('click', () => {
          selectedCardIds.clear();
          net.sendAction('pass', {});
        });
        els.playActions.appendChild(passBtn);
      }

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.textContent = t('doudizhu.play');
      playBtn.addEventListener('click', () => {
        const cards = Array.from(selectedCardIds);
        if (!cards.length) {
          alert(t('doudizhu.selectCards'));
          return;
        }
        selectedCardIds.clear();
        net.sendAction('play', { cards });
      });
      els.playActions.appendChild(playBtn);

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'secondary';
      resetBtn.textContent = t('doudizhu.reset');
      resetBtn.addEventListener('click', () => {
        selectedCardIds.clear();
        refreshHandSelection();
      });
      els.playActions.appendChild(resetBtn);
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
    const name = (net && net.playerNameById) ? net.playerNameById(game.lastPlay.playerId) : game.lastPlay.playerId;
    const cards = game.lastPlay.cards.map(formatCardShort).join(' ');
    li.textContent = `${name}: ${cards}`;
    els.log.appendChild(li);
  }

  function render(game, net, opts = {}) {
    if (!game || game.type !== 'doudizhu') return;
    initElements();

    const meId = opts.meId || null;
    const t = opts.t || ((k, p) => k);

    if (!els.panel) return;

    if (game.phase === 'bid') {
      renderBid(game, net, meId, t);
    } else {
      renderPlay(game, net, meId, t);
    }

    renderLog(game, meId, net, t);
  }

  return { render };
})();
