'use strict';

/**
 * 斗地主客户端渲染器
 */
window.DoudizhuUi = (function () {
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

  // 斗地主 rank 顺序与值映射（复制自服务端 engine）
  const RANKS_ARR = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const RANK_VALUE_CLIENT = {
    '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15,
    joker: 16, JOKER: 17,
  };

  function rankValueClient(rank) {
    return RANK_VALUE_CLIENT[rank] || 0;
  }

  /* ============ 记牌器 ============ */
  // 每种rank的初始数量
  const RANK_INITIAL = {
    '3': 4, '4': 4, '5': 4, '6': 4, '7': 4, '8': 4, '9': 4,
    '10': 4, 'J': 4, 'Q': 4, 'K': 4, 'A': 4, '2': 4,
    joker: 1, JOKER: 1,
  };
  const RANK_TRACKER_ORDER = ['3','4','5','6','7','8','9','10','J','Q','K','A','2','joker','JOKER'];

  // 跨局持久化的已出牌记录 { rank: 已出数量 }
  let trackerData = {};
  // 本局已知的我自己的手牌 rank（用于初始化时减去）
  let trackerMyHandSnapshot = null;

  function initTracker() {
    trackerData = {};
    for (const r of RANK_TRACKER_ORDER) trackerData[r] = 0;
    trackerMyHandSnapshot = null;
    lastTrackedPlay = null;
  }

  /**
   * 记录一批出的牌
   */
  function trackPlayed(cards) {
    if (!cards || !cards.length) return;
    for (const c of cards) {
      if (trackerData[c.rank] !== undefined) {
        trackerData[c.rank]++;
      }
    }
  }

  /**
   * 根据我的手牌初始化：总牌数 - 我的手牌 = 别人手里/未出的
   */
  function trackerSubtractMyHand(myHand) {
    if (!myHand || trackerMyHandSnapshot) return; // 只减一次
    trackerMyHandSnapshot = myHand.length;
    for (const c of myHand) {
      if (trackerData[c.rank] !== undefined) {
        trackerData[c.rank]++;
      }
    }
  }

  /**
   * 渲染记牌器
   */
  function renderTracker(myHand, t) {
    if (!els.cardTracker || !els.ctGrid) return;

    // 首次进入出牌阶段时，减去我的手牌
    trackerSubtractMyHand(myHand);

    els.cardTracker.hidden = false;
    clearChildren(els.ctGrid);

    let totalRemaining = 0;
    for (const rank of RANK_TRACKER_ORDER) {
      const played = trackerData[rank] || 0;
      const initial = RANK_INITIAL[rank] || 0;
      const remain = Math.max(0, initial - played);
      totalRemaining += remain;

      const cell = document.createElement('div');
      cell.className = 'ddz-ct-cell';

      const label = document.createElement('span');
      label.className = 'ddz-ct-rank';
      if (rank === 'joker') {
        label.textContent = t('doudizhu.jokerSmall');
        cell.classList.add('is-joker');
      } else if (rank === 'JOKER') {
        label.textContent = t('doudizhu.jokerBig');
        cell.classList.add('is-joker');
      } else {
        label.textContent = rank;
      }

      const count = document.createElement('span');
      count.className = 'ddz-ct-count';
      count.textContent = remain;
      if (remain === 0) count.classList.add('is-zero');
      else if (remain === 1) count.classList.add('is-one');

      cell.appendChild(label);
      cell.appendChild(count);
      els.ctGrid.appendChild(cell);
    }

    if (els.ctRemain) {
      els.ctRemain.textContent = t('doudizhu.trackerRemain', { count: totalRemaining });
    }
  }

  /**
   * 推荐出牌逻辑
   * @param {Array} handCards 我的手牌完整对象列表
   * @param {Object|null} lastPlayInfo 场上最新出牌 { cards, play, playerId }
   * @param {boolean} mustPlay 是否必须出牌（不能过）
   * @returns {Array<string>} 推荐的 card.id 列表，无推荐返回 []
   */
  function suggestPlay(handCards, lastPlayInfo, mustPlay) {
    if (!handCards || !handCards.length) return [];
    const rv = rankValueClient;

    // 按 rank 分组
    const groups = {};
    for (const c of handCards) {
      groups[c.rank] = groups[c.rank] || [];
      groups[c.rank].push(c);
    }
    const rankKeys = Object.keys(groups).sort((a, b) => rv(a) - rv(b));

    // 自由出牌（第一手 / 重新出牌）
    if (!lastPlayInfo || !lastPlayInfo.play) {
      let best = null;
      for (const c of handCards) {
        if (!best || rv(c.rank) < rv(best.rank)) best = c;
      }
      return best ? [best.id] : [];
    }

    const lastType = lastPlayInfo.play.type;
    const lastRank = lastPlayInfo.play.rank;
    const lastLen = lastPlayInfo.play.length || 0;
    const lastTarget = rv(lastRank);

    // 单张
    if (lastType === 'single') {
      for (const r of rankKeys) {
        if (rv(r) > lastTarget) return [groups[r][0].id];
      }
    }
    // 对子
    else if (lastType === 'pair') {
      for (const r of rankKeys) {
        if (groups[r].length >= 2 && rv(r) > lastTarget) {
          return [groups[r][0].id, groups[r][1].id];
        }
      }
    }
    // 三张
    else if (lastType === 'triple') {
      for (const r of rankKeys) {
        if (groups[r].length >= 3 && rv(r) > lastTarget) {
          return groups[r].slice(0, 3).map((c) => c.id);
        }
      }
    }
    // 三带一
    else if (lastType === 'triple_plus_single') {
      for (const r of rankKeys) {
        if (groups[r].length >= 3 && rv(r) > lastTarget) {
          const triple = groups[r].slice(0, 3);
          for (const r2 of rankKeys) {
            const same = r2 === r;
            const start = same ? 3 : 0;
            if (!groups[r2][start]) continue;
            if (same && groups[r2].length <= 3) continue;
            return [...triple.map((c) => c.id), groups[r2][start].id];
          }
        }
      }
    }
    // 三带二
    else if (lastType === 'triple_plus_pair') {
      for (const r of rankKeys) {
        if (groups[r].length >= 3 && rv(r) > lastTarget) {
          const triple = groups[r].slice(0, 3);
          for (const r2 of rankKeys) {
            const same = r2 === r;
            const start = same ? 3 : 0;
            if (!groups[r2][start + 1]) continue;
            if (same && groups[r2].length < 5) continue;
            return [
              ...triple.map((c) => c.id),
              groups[r2][start].id,
              groups[r2][start + 1].id,
            ];
          }
        }
      }
    }
    // 顺子
    else if (lastType === 'straight' && lastLen > 0) {
      for (let maxVal = lastTarget + 1; maxVal <= 14; maxVal++) {
        let ok = true;
        const ids = [];
        for (let i = lastLen - 1; i >= 0; i--) {
          const idx = maxVal - 3 - i;
          if (idx < 0 || idx >= 12) { ok = false; break; }
          const rank = RANKS_ARR[idx];
          if (!groups[rank] || !groups[rank].length) { ok = false; break; }
          ids.push(groups[rank][0].id);
        }
        if (ok) return ids;
      }
    }
    // 连对
    else if (lastType === 'double_straight' && lastLen > 0) {
      for (let maxVal = lastTarget + 1; maxVal <= 14; maxVal++) {
        let ok = true;
        const ids = [];
        for (let i = lastLen - 1; i >= 0; i--) {
          const idx = maxVal - 3 - i;
          if (idx < 0 || idx >= 12) { ok = false; break; }
          const rank = RANKS_ARR[idx];
          if (!groups[rank] || groups[rank].length < 2) { ok = false; break; }
          ids.push(groups[rank][0].id, groups[rank][1].id);
        }
        if (ok) return ids;
      }
    }
    // 纯飞机
    else if (lastType === 'plane' && lastLen > 0) {
      for (let maxVal = lastTarget + 1; maxVal <= 14; maxVal++) {
        let ok = true;
        const ids = [];
        for (let i = lastLen - 1; i >= 0; i--) {
          const idx = maxVal - 3 - i;
          if (idx < 0 || idx >= 12) { ok = false; break; }
          const rank = RANKS_ARR[idx];
          if (!groups[rank] || groups[rank].length < 3) { ok = false; break; }
          ids.push(groups[rank][0].id, groups[rank][1].id, groups[rank][2].id);
        }
        if (ok) return ids;
      }
    }
    // 飞机带单
    else if (lastType === 'plane_with_single' && lastLen > 0) {
      for (let maxVal = lastTarget + 1; maxVal <= 14; maxVal++) {
        let ok = true;
        const planeIds = [];
        const usedRanks = new Set();
        for (let i = lastLen - 1; i >= 0; i--) {
          const idx = maxVal - 3 - i;
          if (idx < 0 || idx >= 12) { ok = false; break; }
          const rank = RANKS_ARR[idx];
          if (!groups[rank] || groups[rank].length < 3) { ok = false; break; }
          planeIds.push(groups[rank][0].id, groups[rank][1].id, groups[rank][2].id);
          usedRanks.add(rank);
        }
        if (!ok) continue;
        let needExtras = lastLen;
        const extraIds = [];
        for (const r of rankKeys) {
          const cnt = groups[r].length;
          const used = usedRanks.has(r) ? 3 : 0;
          for (let k = used; k < cnt && needExtras > 0; k++) {
            extraIds.push(groups[r][k].id);
            needExtras--;
          }
          if (needExtras === 0) break;
        }
        if (needExtras === 0) return [...planeIds, ...extraIds];
      }
    }
    // 飞机带对
    else if (lastType === 'plane_with_pair' && lastLen > 0) {
      for (let maxVal = lastTarget + 1; maxVal <= 14; maxVal++) {
        let ok = true;
        const planeIds = [];
        const usedRanks = new Set();
        for (let i = lastLen - 1; i >= 0; i--) {
          const idx = maxVal - 3 - i;
          if (idx < 0 || idx >= 12) { ok = false; break; }
          const rank = RANKS_ARR[idx];
          if (!groups[rank] || groups[rank].length < 3) { ok = false; break; }
          planeIds.push(groups[rank][0].id, groups[rank][1].id, groups[rank][2].id);
          usedRanks.add(rank);
        }
        if (!ok) continue;
        let needPairs = lastLen;
        const extraIds = [];
        for (const r of rankKeys) {
          const cnt = groups[r].length;
          const used = usedRanks.has(r) ? 3 : 0;
          const availPairs = Math.floor((cnt - used) / 2);
          for (let p = 0; p < availPairs && needPairs > 0; p++) {
            extraIds.push(groups[r][used + p * 2].id, groups[r][used + p * 2 + 1].id);
            needPairs--;
          }
          if (needPairs === 0) break;
        }
        if (needPairs === 0) return [...planeIds, ...extraIds];
      }
    }
    // 四带二单
    else if (lastType === 'four_plus_two_singles') {
      for (const r of rankKeys) {
        if (groups[r].length >= 4 && rv(r) > lastTarget) {
          const four = groups[r].slice(0, 4);
          let need = 2;
          const extras = [];
          for (const r2 of rankKeys) {
            const start = r2 === r ? 4 : 0;
            for (let k = start; k < groups[r2].length && need > 0; k++) {
              extras.push(groups[r2][k].id);
              need--;
            }
            if (need === 0) break;
          }
          if (need === 0) return [...four.map((c) => c.id), ...extras];
        }
      }
    }
    // 四带两对
    else if (lastType === 'four_plus_two_pairs') {
      for (const r of rankKeys) {
        if (groups[r].length >= 4 && rv(r) > lastTarget) {
          const four = groups[r].slice(0, 4);
          let needPairs = 2;
          const extras = [];
          for (const r2 of rankKeys) {
            const start = r2 === r ? 4 : 0;
            const avail = Math.floor((groups[r2].length - start) / 2);
            for (let p = 0; p < avail && needPairs > 0; p++) {
              extras.push(groups[r2][start + p * 2].id, groups[r2][start + p * 2 + 1].id);
              needPairs--;
            }
            if (needPairs === 0) break;
          }
          if (needPairs === 0) return [...four.map((c) => c.id), ...extras];
        }
      }
    }
    // 炸弹
    else if (lastType === 'bomb') {
      for (const r of rankKeys) {
        if (groups[r].length >= 4 && rv(r) > lastTarget) {
          return groups[r].slice(0, 4).map((c) => c.id);
        }
      }
      if (groups['joker'] && groups['joker'].length && groups['JOKER'] && groups['JOKER'].length) {
        return [groups['joker'][0].id, groups['JOKER'][0].id];
      }
    }
    // 王炸（最大，无法压制）
    else if (lastType === 'rocket') {
      return [];
    }

    // -------------- 兜底：常规牌型压不过时尝试炸弹 / 王炸 --------------
    if (lastType !== 'bomb' && lastType !== 'rocket') {
      for (const r of rankKeys) {
        if (groups[r].length >= 4) return groups[r].slice(0, 4).map((c) => c.id);
      }
      if (groups['joker'] && groups['joker'].length && groups['JOKER'] && groups['JOKER'].length) {
        return [groups['joker'][0].id, groups['JOKER'][0].id];
      }
    }

    // -------------- 必须出牌但实在压不过，返回最小单张避免卡死 --------------
    if (mustPlay) {
      let best = null;
      for (const c of handCards) {
        if (!best || rv(c.rank) < rv(best.rank)) best = c;
      }
      return best ? [best.id] : [];
    }
    return [];
  }

  // 动画状态
  let lastGamePhase = null;
  let lastMyHandCount = 0;
  let lastLandlordId = null;
  // 记牌器：上次跟踪的出牌（防重复计数）
  let lastTrackedPlay = null;

  function getEl(id) {
    return document.getElementById(id);
  }

  function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
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
    // 记牌器
    els.cardTracker = getEl('ddz-card-tracker');
    els.ctGrid = getEl('ddz-ct-grid');
    els.ctRemain = getEl('ddz-ct-remain');
    // 右侧信息面板
    els.sidePanel = getEl('ddz-side-panel');
    els.matchProgress = getEl('ddz-match-progress');
    els.handDetail = getEl('ddz-hand-detail');
    els.scoreboard = getEl('ddz-scoreboard');
    els.resultOverlay = getEl('ddz-result-overlay');
    els.resultCard = getEl('ddz-result-card');
  }

  function isRedSuit(suit) {
    return suit === '♥' || suit === '♦';
  }

  function renderCard(card, opts = {}) {
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.id = card.id;
    div.classList.add(isRedSuit(card.suit) ? 'is-red' : 'is-black');

    const rankText = card.rank === 'joker' || card.rank === 'JOKER' ? 'JOK' : card.rank;
    const suitText = card.suit === 'joker' ? '🃏' : card.suit;

    // 左上角 点数+花色
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

    // 中央大水印花色
    const center = document.createElement('div');
    center.className = 'card-center';
    center.textContent = suitText;

    // 右下角（旋转180°）点数+花色
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

  function formatDelta(n) {
    const v = Number(n) || 0;
    return v > 0 ? '+' + v : String(v);
  }

  function renderMatchBar(game, t, meId) {
    if (!els.matchProgress || !els.scoreboard) return;
    els.matchProgress.textContent = t('doudizhu.matchProgress', {
      current: game.matchIndex || 1,
      total: game.matchGames || 5,
    });

    if (els.handDetail) {
      clearChildren(els.handDetail);
      const addLine = (text) => {
        if (!text) return;
        const row = document.createElement('div');
        row.className = 'ddz-detail-row ddz-detail-row-plain';
        row.textContent = text;
        els.handDetail.appendChild(row);
      };

      if (game.phase === 'bid') addLine(t('doudizhu.detailPhaseBid'));
      else if (game.handOver || game.matchOver) addLine(t('doudizhu.handResultTitle'));
      else addLine(t('doudizhu.detailPhasePlay'));

      addLine(t('doudizhu.detailBase', { score: game.baseScore || 1 }));
      if (game.landlordId || Number(game.bidMaxScore) > 0) {
        addLine(t('doudizhu.detailBid', { score: game.bidMaxScore || 1 }));
      }
      if (game.phase === 'play' || game.handOver || game.matchOver) {
        addLine(t('doudizhu.detailBombs', { count: game.bombCount || 0 }));
        addLine(t('doudizhu.detailMult', { mult: game.multiplier || 1 }));
        if (game.springType === 'spring') addLine(t('doudizhu.resultSpring'));
        else if (game.springType === 'anti') addLine(t('doudizhu.resultAntiSpring'));
      }
    }

    clearChildren(els.scoreboard);
    const scores = game.scores || {};
    const handCounts = game.handCounts || {};
    const handDelta = (game.handResult && game.handResult.handDelta) || game.handDelta || {};
    const order = (game.turnOrder || []).slice().sort((a, b) => {
      return (Number(scores[b]) || 0) - (Number(scores[a]) || 0);
    });
    for (const pid of order) {
      const chip = document.createElement('div');
      chip.className = 'ddz-score-chip';
      if (pid === meId) chip.classList.add('is-me');
      if (pid === game.landlordId) chip.classList.add('is-landlord');
      if (pid === game.currentPlayerId) chip.classList.add('is-turn');

      const top = document.createElement('div');
      top.className = 'ddz-score-top';
      const nameEl = document.createElement('span');
      nameEl.className = 'ddz-score-name';
      nameEl.textContent = nameOf(pid);
      const pts = document.createElement('span');
      pts.className = 'ddz-score-pts';
      pts.textContent = t('doudizhu.playerScore', {
        score: Number(scores[pid]) || 0,
      });
      top.appendChild(nameEl);
      top.appendChild(pts);
      chip.appendChild(top);

      const meta = document.createElement('div');
      meta.className = 'ddz-score-meta';
      if (game.landlordId) {
        const role = document.createElement('span');
        role.className = 'ddz-score-role';
        role.textContent =
          pid === game.landlordId
            ? t('doudizhu.role.landlord')
            : t('doudizhu.role.farmer');
        meta.appendChild(role);
      }
      if (handCounts[pid] != null) {
        const hc = document.createElement('span');
        hc.textContent = t('doudizhu.handCount', { count: handCounts[pid] });
        meta.appendChild(hc);
      }
      if (game.handOver && handDelta[pid] != null) {
        const d = Number(handDelta[pid]) || 0;
        const deltaEl = document.createElement('span');
        deltaEl.className = 'ddz-score-delta';
        if (d > 0) deltaEl.classList.add('is-plus');
        else if (d < 0) deltaEl.classList.add('is-minus');
        deltaEl.textContent = formatDelta(d);
        meta.appendChild(deltaEl);
      }
      if (meta.childNodes.length) chip.appendChild(meta);
      els.scoreboard.appendChild(chip);
    }
  }

  function renderResultOverlay(game, t) {
    if (!els.resultOverlay || !els.resultCard) return;
    clearChildren(els.resultCard);

    if (game.matchOver && game.ranking && game.ranking.length) {
      els.resultOverlay.hidden = false;
      const title = document.createElement('h3');
      title.textContent = t('doudizhu.matchResultTitle');
      els.resultCard.appendChild(title);
      const list = document.createElement('ol');
      list.className = 'ddz-ranking-list';
      for (const row of game.ranking) {
        const li = document.createElement('li');
        li.textContent =
          t('doudizhu.resultRank', { rank: row.rank }) +
          '  ' +
          t('doudizhu.scoreLabel', {
            name: nameOf(row.playerId),
            score: row.score,
          });
        list.appendChild(li);
      }
      els.resultCard.appendChild(list);
      return;
    }

    if (game.handOver && game.handResult) {
      els.resultOverlay.hidden = false;
      const hr = game.handResult;
      const title = document.createElement('h3');
      title.textContent = t('doudizhu.handResultTitle');
      els.resultCard.appendChild(title);

      const summary = document.createElement('p');
      summary.className = 'ddz-result-summary';
      summary.textContent = hr.landlordWin
        ? t('doudizhu.resultLandlordWin')
        : t('doudizhu.resultFarmerWin');
      els.resultCard.appendChild(summary);

      const meta = document.createElement('div');
      meta.className = 'ddz-result-meta';
      const bits = [
        t('doudizhu.resultBid', { score: hr.bidMaxScore || 1 }),
        t('doudizhu.resultBombs', { count: hr.bombCount || 0 }),
        t('doudizhu.resultMult', { mult: hr.multiplier || 1 }),
      ];
      if (hr.springType === 'spring') bits.push(t('doudizhu.resultSpring'));
      if (hr.springType === 'anti') bits.push(t('doudizhu.resultAntiSpring'));
      meta.textContent = bits.join(' · ');
      els.resultCard.appendChild(meta);

      const deltas = document.createElement('div');
      deltas.className = 'ddz-result-deltas';
      for (const pid of game.turnOrder || []) {
        const line = document.createElement('div');
        const d = hr.handDelta && hr.handDelta[pid] != null ? hr.handDelta[pid] : 0;
        line.textContent = t('doudizhu.resultDelta', {
          name: nameOf(pid),
          delta: formatDelta(d),
        });
        deltas.appendChild(line);
      }
      els.resultCard.appendChild(deltas);

      if (!game.matchOver) {
        const hint = document.createElement('p');
        hint.className = 'ddz-result-hint muted';
        hint.textContent = t('doudizhu.nextHandHint');
        els.resultCard.appendChild(hint);
      }
      return;
    }

    els.resultOverlay.hidden = true;
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

    // 抢地主前：只显示 3 张牌背，不公开底牌内容
    const hiddenCount =
      game.landlordCardsHidden || (game.landlordCards && game.landlordCards.length)
        ? 3
        : 0;
    if (!game.landlordId && hiddenCount > 0) {
      for (let i = 0; i < hiddenCount; i++) {
        els.landlordCards.appendChild(renderCardBack());
      }
    } else if (game.landlordId && game.landlordCards && game.landlordCards.length) {
      // 地主已确定时可亮出底牌（随后进入出牌阶段会清空）
      els.landlordCards.appendChild(renderCards(game.landlordCards));
    }

    // 2) 叫分信息：上方提示
    const hint = document.createElement('div');
    hint.className = 'ddz-bid-hint';
    hint.textContent = t('doudizhu.bidHint');
    els.bidInfo.appendChild(hint);

    // 3) 三玩家叫分状态卡片
    const playersPanel = document.createElement('div');
    playersPanel.className = 'ddz-bid-players';

    for (const pid of game.turnOrder || []) {
      const statusClass = getBidStatusClass(pid, game, meId);
      const wrap = document.createElement('div');
      wrap.className = 'ddz-bid-player ' + statusClass;

      // 头像/首字母
      const avatar = document.createElement('div');
      avatar.className = 'bpi-avatar';
      avatar.textContent = (nameOf(pid) || '?').charAt(0).toUpperCase();

      // 名字
      const name = document.createElement('div');
      name.className = 'bpi-name';
      const shortName = (nameOf(pid) || '?').length > 5
        ? (nameOf(pid)||'?').substring(0, 4) + '...'
        : (nameOf(pid) || '?');
      name.textContent = shortName;

      // 叫分状态
      const score = document.createElement('div');
      score.className = 'bpi-score';
      const saved = game.bidScores[pid];
      if (saved !== -1) {
        if (saved === 0) {
          score.textContent = t('doudizhu.bidPassShort');
          score.classList.add('is-pass');
        } else {
          score.textContent = t('doudizhu.bidScoreShort', { score: saved });
          score.classList.add('is-score');
        }
      } else {
        score.textContent = t('doudizhu.bidWait');
      }

      wrap.appendChild(avatar);
      wrap.appendChild(name);
      wrap.appendChild(score);
      playersPanel.appendChild(wrap);
    }
    els.bidInfo.appendChild(playersPanel);

    // 4) 叫分历史记录（折叠式，有记录才展开）
    const bidDone = game.bidScores && Object.values(game.bidScores).some((v) => v !== -1);
    if (bidDone) {
      const historyPanel = document.createElement('div');
      historyPanel.className = 'ddz-bid-history';
      for (const pid of game.turnOrder || []) {
        const s = game.bidScores[pid];
        if (s === -1) continue;
        const chip = document.createElement('span');
        chip.className = 'ddz-bid-chip ' + (s === 0 ? 'is-pass' : 'is-score');
        chip.textContent = t('doudizhu.bidRecord', {
          name: nameOf(pid) || '?',
          score: s === 0 ? t('doudizhu.bidPassShort') : s,
        });
        historyPanel.appendChild(chip);
      }
      els.bidInfo.appendChild(historyPanel);
    }

    // 5) 当前玩家可选的叫分按钮
    if (meId === game.currentPlayerId && !game.landlordId) {
      const maxScore = game.bidMaxScore || 0;
      const scores = [0, 1, 2, 3];
      for (const sc of scores) {
        if (sc > 0 && sc <= maxScore) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = sc === 0 ? 'ddz-btn-pass' : 'ddz-btn-score';
        btn.textContent = sc === 0
          ? t('doudizhu.bidPass')
          : t('doudizhu.bidScore', { score: sc });
        btn.addEventListener('click', () => {
          net.sendAction('call', { score: sc });
        });
        els.bidActions.appendChild(btn);
      }
    }
  }

  /**
   * 叫分状态样式类
   *  - active:    当前轮到
   *  - done:      已叫过分
   *  - me-active: 我当前正在叫
   *  - other:     还没到
   */
  function getBidStatusClass(pid, game, meId) {
    const isCurrent = pid === game.currentPlayerId;
    const isMe = pid === meId;
    const saved = game.bidScores[pid];
    if (isCurrent && isMe) return 'is-me-active';
    if (isCurrent) return 'is-active';
    if (saved !== -1) return 'is-done';
    return 'is-wait';
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
      nameSpan.textContent = nameOf(pid);
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
      nameSpan.textContent = nameOf(pid);
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
      const name = nameOf(game.lastPlay.playerId);
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

      // 推荐出牌按钮
      const suggestBtn = document.createElement('button');
      suggestBtn.type = 'button';
      suggestBtn.className = 'secondary btn-suggest';
      suggestBtn.textContent = t('doudizhu.suggest');
      suggestBtn.addEventListener('click', () => {
        selectedCardIds.clear();
        const suggests = suggestPlay(myHand, game.lastPlay, mustPlay);
        if (suggests && suggests.length) {
          for (const id of suggests) selectedCardIds.add(id);
          refreshHandSelection();
        } else {
          // 无牌可压过：提示用户，让用户自己决定跳过
          alert(t('doudizhu.noBiggerCards'));
        }
      });
      els.playActions.appendChild(suggestBtn);
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
    alert(t('doudizhu.invalidPlay'));
    clearSelection();
    return true;
  }

  function renderLog(game, meId, net, t) {
    clearChildren(els.log);
    if (!game.lastPlay) return;
    const li = document.createElement('li');
    const name = nameOf(game.lastPlay.playerId);
    const cards = game.lastPlay.cards.map(formatCardShort).join(' ');
    li.textContent = `${name}: ${cards}`;
    els.log.appendChild(li);
  }

  function playLandlordAnim() {
    // 为自己的角色标签添加动画
    if (els.myRole && els.myRole.classList.contains('is-landlord')) {
      els.myRole.classList.remove('landlord-anim');
      void els.myRole.offsetWidth; // 触发重排
      els.myRole.classList.add('landlord-anim');

      // 创建皇冠
      const crown = document.createElement('span');
      crown.className = 'landlord-crown';
      crown.textContent = '👑';
      const myInfo = document.querySelector('.ddz-my-info');
      if (myInfo) {
        myInfo.style.position = 'relative';
        myInfo.appendChild(crown);
        setTimeout(() => crown.remove(), 3000);
      }
    }

    // 为左右家角色标签添加动画
    const rolePrev = getEl('ddz-role-prev');
    const roleNext = getEl('ddz-role-next');
    [rolePrev, roleNext].forEach((roleEl) => {
      if (roleEl && roleEl.classList.contains('is-landlord') && !roleEl.classList.contains('landlord-anim')) {
        roleEl.classList.add('landlord-anim');
        const parent = roleEl.parentElement;
        if (parent) {
          parent.style.position = 'relative';
          const crown = document.createElement('span');
          crown.className = 'landlord-crown';
          crown.textContent = '👑';
          parent.appendChild(crown);
          setTimeout(() => crown.remove(), 3000);
        }
      }
    });
  }

  function render(game, net, opts = {}) {
    if (!game || game.type !== 'doudizhu') return;
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
    const myHandCount = myHand.length;
    // 已打出的牌从选中集合中剔除
    if (selectedCardIds.size) {
      const alive = new Set(myHand.map((c) => c.id));
      for (const id of [...selectedCardIds]) {
        if (!alive.has(id)) selectedCardIds.delete(id);
      }
    }

    if (game.phase === 'bid') {
      renderBid(game, net, meId, t);
    } else {
      renderPlay(game, net, meId, t);
    }

    renderLog(game, meId, net, t);
    renderMatchBar(game, t, meId);
    renderResultOverlay(game, t);

    // ========== 记牌器逻辑 ==========
    const isNewGame = lastGamePhase === null;
    if (isNewGame && !game.over) {
      initTracker();
    }
    // 有新的出牌记录时跟踪（用 card id 拼接签名防重复）
    const lastPlay = game.lastPlay;
    const hadLastPlay = lastPlay && lastPlay.cards && lastPlay.cards.length;
    if (hadLastPlay) {
      const sig = lastPlay.playerId + '|' + lastPlay.cards.map((c) => c.id).sort().join(',');
      if (!lastTrackedPlay || lastTrackedPlay !== sig) {
        trackPlayed(lastPlay.cards);
        lastTrackedPlay = sig;
      }
    }
    // 叫分阶段隐藏，出牌阶段显示并更新
    const tableEl = els.landlordCards && els.landlordCards.parentElement;
    if (game.phase === 'play' && !game.over && !game.handOver) {
      renderTracker(myHand, t);
      if (tableEl) tableEl.classList.add('has-tracker');
    } else if (els.cardTracker) {
      els.cardTracker.hidden = true;
      if (tableEl) tableEl.classList.remove('has-tracker');
    }

    // ========== 动画触发逻辑 ==========

    // 1) 发牌动画：从 bid 切换到 play 时，或者刚进入到 bid 阶段手牌从无到有
    const isPhaseChange = lastGamePhase !== null && game.phase !== lastGamePhase;
    const isNewBidPhase = game.phase === 'bid' && lastGamePhase === null && myHandCount > 0;
    const isBidToPlay = (isPhaseChange && game.phase === 'play' && lastGamePhase === 'bid');

    if (isNewBidPhase || isBidToPlay) {
      const handContainer = els.myHand;
      if (handContainer) {
        handContainer.classList.remove('is-dealing');
        void handContainer.offsetWidth; // 触发重排
        handContainer.classList.add('is-dealing');
        for (let i = 0; i < handContainer.children.length; i++) {
          const cardEl = handContainer.children[i];
          cardEl.style.animationDelay = (i * 0.06) + 's';
        }
        setTimeout(() => {
          handContainer.classList.remove('is-dealing');
          for (const cardEl of handContainer.children) {
            cardEl.style.animationDelay = '';
          }
        }, handContainer.children.length * 80 + 600);
      }
    }

    // 2) 抢地主成功动画：地主牌移动到地主手中时发光，角色标签弹跳
    const isLandlordJustSet = !lastLandlordId && game.landlordId;
    const isLandlordChanged = lastLandlordId && game.landlordId && game.landlordId !== lastLandlordId;
    if (isLandlordJustSet || isLandlordChanged) {
      // 地主牌区域短暂发光
      elesNextTick(() => {
        const landlordCardsEl = els.landlordCards;
        if (landlordCardsEl) {
          landlordCardsEl.classList.add('is-removing');
          // 在多数玩家渲染完角色标签后触发动画
          setTimeout(() => {
            playLandlordAnim();
            setTimeout(() => {
              if (landlordCardsEl) landlordCardsEl.classList.remove('is-removing');
            }, 2000);
          }, 150);
        } else {
          playLandlordAnim();
        }
      });
    }

    lastGamePhase = game.phase;
    lastMyHandCount = myHandCount;
    lastLandlordId = game.landlordId;
  }

  // 简单的下一帧执行辅助
  function elesNextTick(fn) {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => requestAnimationFrame(fn));
    } else {
      setTimeout(fn, 32);
    }
  }

  return { render, onGameError };
})();
