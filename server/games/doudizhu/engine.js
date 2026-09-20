'use strict';

const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const RANK_VALUE = {
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  'J': 11,
  'Q': 12,
  'K': 13,
  'A': 14,
  '2': 15,
  joker: 16,
  JOKER: 17,
};

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({ suit, rank, id: suit + rank });
    }
  }
  deck.push({ suit: 'joker', rank: 'joker', id: 'jokerjoker' });
  deck.push({ suit: 'joker', rank: 'JOKER', id: 'jokerJOKER' });
  return deck;
}

function rankValue(rank) {
  return RANK_VALUE[rank] || 0;
}

function handSort(a, b) {
  const va = rankValue(a.rank);
  const vb = rankValue(b.rank);
  if (va !== vb) return va - vb;
  const sa = SUITS.indexOf(a.suit);
  const sb = SUITS.indexOf(b.suit);
  return sa - sb;
}

function histogramByRank(cards) {
  const h = {};
  for (const c of cards) {
    h[c.rank] = (h[c.rank] || 0) + 1;
  }
  return h;
}

function classifyPlay(cards) {
  if (!cards || !cards.length) return null;
  const n = cards.length;
  const h = histogramByRank(cards);
  const values = Object.values(h);
  const ranks = Object.keys(h).sort((a, b) => rankValue(a) - rankValue(b));

  // 王炸
  if (n === 2 && h['joker'] === 1 && h['JOKER'] === 1) {
    return { type: 'rocket', rank: 'JOKER' };
  }

  // 炸弹
  if (n === 4 && values.length === 1) {
    return { type: 'bomb', rank: ranks[0] };
  }

  // 单张
  if (n === 1) {
    return { type: 'single', rank: ranks[0] };
  }

  // 对子
  if (n === 2 && values.length === 1 && values[0] === 2) {
    return { type: 'pair', rank: ranks[0] };
  }

  // 三张
  if (n === 3 && values.length === 1 && values[0] === 3) {
    return { type: 'triple', rank: ranks[0] };
  }

  // 三带一
  if (n === 4 && values.length === 2) {
    const tripleRank = ranks.find((r) => h[r] === 3);
    if (tripleRank) {
      return {
        type: 'triple_plus_single',
        rank: tripleRank,
        companion: ranks.find((r) => r !== tripleRank),
      };
    }
  }

  // 三带二
  if (n === 5 && values.length === 2) {
    const tripleRank = ranks.find((r) => h[r] === 3);
    if (tripleRank && h[ranks.find((r) => r !== tripleRank)] === 2) {
      return { type: 'triple_plus_pair', rank: tripleRank };
    }
  }

  // 顺子 (5+)
  if (n >= 5 && values.every((v) => v === 1)) {
    if (ranks.some((r) => ['2', 'joker', 'JOKER'].includes(r))) return null;
    for (let i = 1; i < ranks.length; i++) {
      if (rankValue(ranks[i]) !== rankValue(ranks[i - 1]) + 1) return null;
    }
    return { type: 'straight', rank: ranks[ranks.length - 1], length: n };
  }

  // 连对 (3+ 对)
  if (n >= 6 && n % 2 === 0 && values.every((v) => v === 2)) {
    if (ranks.some((r) => ['2', 'joker', 'JOKER'].includes(r))) return null;
    for (let i = 1; i < ranks.length; i++) {
      if (rankValue(ranks[i]) !== rankValue(ranks[i - 1]) + 1) return null;
    }
    return {
      type: 'double_straight',
      rank: ranks[ranks.length - 1],
      length: n / 2,
    };
  }

  // 飞机及三带
  const tripleRanks = ranks
    .filter((r) => h[r] === 3)
    .sort((a, b) => rankValue(a) - rankValue(b));
  if (tripleRanks.length >= 2) {
    let seqLen = 1;
    let maxSeqStart = 0;
    let curLen = 1;
    for (let i = 1; i < tripleRanks.length; i++) {
      if (rankValue(tripleRanks[i]) === rankValue(tripleRanks[i - 1]) + 1) {
        curLen++;
      } else {
        if (curLen > seqLen) {
          seqLen = curLen;
          maxSeqStart = i - curLen;
        }
        curLen = 1;
      }
    }
    if (curLen > seqLen) {
      seqLen = curLen;
      maxSeqStart = tripleRanks.length - curLen;
    }

    const coreRanks = tripleRanks.slice(maxSeqStart, maxSeqStart + seqLen);
    const coreCount = coreRanks.length * 3;
    const extra = n - coreCount;

    // 纯飞机
    if (extra === 0 && ranks.length === coreRanks.length) {
      return {
        type: 'plane',
        rank: coreRanks[coreRanks.length - 1],
        length: coreRanks.length,
      };
    }

    // 飞机带单
    if (extra === coreRanks.length) {
      const others = ranks.filter((r) => !coreRanks.includes(r));
      if (others.length === extra && others.every((r) => h[r] === 1)) {
        return {
          type: 'plane_with_single',
          rank: coreRanks[coreRanks.length - 1],
          length: coreRanks.length,
        };
      }
    }

    // 飞机带对
    if (extra === coreRanks.length * 2) {
      const others = ranks.filter((r) => !coreRanks.includes(r));
      if (others.length === coreRanks.length && others.every((r) => h[r] === 2)) {
        return {
          type: 'plane_with_pair',
          rank: coreRanks[coreRanks.length - 1],
          length: coreRanks.length,
        };
      }
    }
  }

  // 四带二单
  if (n === 6) {
    const fourRank = ranks.find((r) => h[r] === 4);
    if (fourRank && values.filter((v) => v === 1).length === 2) {
      return { type: 'four_plus_two_singles', rank: fourRank };
    }
  }

  // 四带两对
  if (n === 8) {
    const fourRank = ranks.find((r) => h[r] === 4);
    if (fourRank) {
      const others = ranks.filter((r) => r !== fourRank);
      if (others.length === 2 && others.every((r) => h[r] === 2)) {
        return { type: 'four_plus_two_pairs', rank: fourRank };
      }
    }
  }

  return null;
}

function canBeat(last, current) {
  if (!last) return current != null;
  if (!current) return false;

  if (current.type === 'rocket') return true;
  if (last.type === 'rocket') return false;

  if (current.type === 'bomb') {
    if (last.type !== 'bomb') return true;
    return rankValue(current.rank) > rankValue(last.rank);
  }
  if (last.type === 'bomb') return false;

  if (current.type !== last.type) return false;
  if (current.length && last.length && current.length !== last.length) return false;

  return rankValue(current.rank) > rankValue(last.rank);
}

function validateCardsInHand(hand, cardIds) {
  const handCopy = hand.map((c) => c.id);
  for (const id of cardIds) {
    const idx = handCopy.indexOf(id);
    if (idx === -1) return false;
    handCopy.splice(idx, 1);
  }
  return true;
}

function removeCardsFromHand(hand, cardIds) {
  const set = new Set(cardIds);
  return hand.filter((c) => {
    if (set.has(c.id)) {
      set.delete(c.id);
      return false;
    }
    return true;
  });
}

function createGameState(room) {
  const players = room.players.slice(0, 3);
  const turnOrder = players.map((p) => p.id);

  const deck = shuffle(buildDeck());
  const hands = {};
  for (const pid of turnOrder) {
    hands[pid] = deck.splice(0, 17).sort(handSort);
  }
  const landlordCards = deck.splice(0, 3);

  const bidScores = {};
  for (const pid of turnOrder) bidScores[pid] = -1;

  const playedCount = {};
  for (const pid of turnOrder) playedCount[pid] = 0;

  return {
    type: 'doudizhu',
    phase: 'bid',
    turnOrder,
    turnIndex: 0,
    currentPlayerId: turnOrder[0],
    hands,
    landlordCards,
    landlordId: null,
    bidScores,
    bidWinnerId: null,
    bidMaxScore: 0,
    lastPlay: null,
    lastValidPlayerId: null,
    passCount: 0,
    playedCount,
    winnerId: null,
    winners: [],
    over: false,
    startedAt: Date.now(),
  };
}

function isBidDone(game) {
  return Object.values(game.bidScores).every((v) => v !== -1);
}

function resolveBid(game) {
  let maxScore = -1;
  let winnerId = null;
  for (const pid of game.turnOrder) {
    const s = game.bidScores[pid];
    if (s > maxScore) {
      maxScore = s;
      winnerId = pid;
    }
  }
  if (maxScore <= 0) {
    winnerId = game.turnOrder[0];
    maxScore = 1;
  }
  game.bidWinnerId = winnerId;
  game.landlordId = winnerId;
  game.bidMaxScore = maxScore;
  game.hands[winnerId] = game.hands[winnerId].concat(game.landlordCards).sort(handSort);
  game.phase = 'play';
  game.turnIndex = game.turnOrder.indexOf(winnerId);
  game.currentPlayerId = winnerId;
  game.lastPlay = null;
  game.lastValidPlayerId = null;
  game.passCount = 0;
}

function applyAction(game, playerId, action) {
  if (!game) return { ok: false, error: '对局未开始' };
  if (game.over) return { ok: false, error: '对局已结束' };
  if (playerId !== game.currentPlayerId) {
    return { ok: false, error: '还没轮到你' };
  }

  const type = action && action.type;

  if (game.phase === 'bid') {
    if (type !== 'call') return { ok: false, error: '当前为叫分阶段' };
    const score = Number(action.payload && action.payload.score);
    if (![0, 1, 2, 3].includes(score)) {
      return { ok: false, error: '叫分无效' };
    }
    if (score > 0 && score <= game.bidMaxScore) {
      return { ok: false, error: '叫分必须比当前高' };
    }

    game.bidScores[playerId] = score;
    if (score === 3) {
      resolveBid(game);
      return { ok: true, state: publicGameState(game, playerId) };
    }

    game.turnIndex = (game.turnIndex + 1) % game.turnOrder.length;
    game.currentPlayerId = game.turnOrder[game.turnIndex];

    if (isBidDone(game)) {
      resolveBid(game);
    }
    return { ok: true, state: publicGameState(game, playerId) };
  }

  if (game.phase === 'play') {
    if (type === 'pass') {
      // 第一手必须由地主出
      if (!game.lastPlay && game.turnOrder[game.turnIndex] === game.landlordId) {
        return { ok: false, error: '第一手必须出牌' };
      }

      // 当前出牌者不能在自己已经是最新出牌者时pass（实际不会发生，但保险）
      if (
        game.lastValidPlayerId === playerId &&
        game.passCount >= game.turnOrder.length - 1
      ) {
        return { ok: false, error: '你是最新出牌者，必须出牌' };
      }

      game.passCount += 1;

      if (game.passCount >= game.turnOrder.length) {
        game.lastPlay = null;
        game.lastValidPlayerId = null;
        game.passCount = 0;
      }

      game.turnIndex = (game.turnIndex + 1) % game.turnOrder.length;
      game.currentPlayerId = game.turnOrder[game.turnIndex];
      return { ok: true, state: publicGameState(game, playerId) };
    }

    if (type !== 'play') return { ok: false, error: '无效操作' };

    const payload = action.payload || {};
    const cardIds = Array.isArray(payload.cards) ? payload.cards : [];
    if (!cardIds.length) return { ok: false, error: '请至少出一张牌' };

    if (!validateCardsInHand(game.hands[playerId], cardIds)) {
      return { ok: false, error: '所选牌不在手牌中' };
    }

    const selectedCards = game.hands[playerId].filter((c) =>
      cardIds.includes(c.id)
    );
    const play = classifyPlay(selectedCards);
    if (!play) return { ok: false, error: '牌型不合法' };

    if (game.lastPlay && game.lastPlay.playerId !== playerId) {
      if (!canBeat(game.lastPlay.play, play)) {
        return { ok: false, error: '牌型或大小不足以压过上家' };
      }
    }

    game.hands[playerId] = removeCardsFromHand(
      game.hands[playerId],
      cardIds
    );
    game.playedCount[playerId] = (game.playedCount[playerId] || 0) + cardIds.length;
    game.lastPlay = {
      playerId,
      cards: selectedCards.map((c) => ({ ...c })),
      play: { ...play },
    };
    game.lastValidPlayerId = playerId;
    game.passCount = 0;

    if (game.hands[playerId].length === 0) {
      game.over = true;
      game.winnerId = playerId;
      if (playerId === game.landlordId) {
        game.winners = [game.landlordId];
      } else {
        game.winners = game.turnOrder.filter((id) => id !== game.landlordId);
      }
    } else {
      game.turnIndex = (game.turnIndex + 1) % game.turnOrder.length;
      game.currentPlayerId = game.turnOrder[game.turnIndex];
    }

    return { ok: true, state: publicGameState(game, playerId) };
  }

  return { ok: false, error: '未知阶段' };
}

function publicGameState(game, viewerId) {
  if (!game) return null;

  const handCounts = {};
  const visibleHands = {};

  for (const pid of game.turnOrder) {
    const count = game.hands[pid] ? game.hands[pid].length : 0;
    handCounts[pid] = count;
    if (pid === viewerId) {
      visibleHands[pid] = game.hands[pid].map((c) => ({ ...c }));
    } else {
      visibleHands[pid] = null;
    }
  }

  return {
    type: 'doudizhu',
    phase: game.phase,
    turnOrder: game.turnOrder.slice(),
    turnIndex: game.turnIndex,
    currentPlayerId: game.currentPlayerId,
    handCounts,
    hands: visibleHands,
    landlordId: game.landlordId,
    landlordCards: game.landlordCards
      ? game.landlordCards.map((c) => ({ ...c }))
      : [],
    bidScores: { ...game.bidScores },
    bidWinnerId: game.bidWinnerId,
    bidMaxScore: game.bidMaxScore,
    lastPlay: game.lastPlay
      ? {
          playerId: game.lastPlay.playerId,
          cards: game.lastPlay.cards.map((c) => ({ ...c })),
          play: { ...game.lastPlay.play },
        }
      : null,
    lastValidPlayerId: game.lastValidPlayerId,
    passCount: game.passCount,
    playedCount: { ...game.playedCount },
    winnerId: game.winnerId,
    winners: game.winners ? game.winners.slice() : [],
    over: game.over,
    startedAt: game.startedAt,
  };
}

function getActingPlayerIds(game) {
  if (!game || game.over) return [];
  return game.currentPlayerId ? [game.currentPlayerId] : [];
}

function onPlayerQuit(game, playerId) {
  if (!game || game.over) return;
  game.over = true;
  if (playerId === game.landlordId) {
    game.winners = game.turnOrder.filter((id) => id !== playerId);
    game.winnerId = game.winners[0];
  } else {
    game.winners = [game.landlordId];
    game.winnerId = game.landlordId;
  }
}

function forceTimeout(game, playerId) {
  if (!game || game.over || playerId !== game.currentPlayerId) {
    return { ok: false, error: '无需操作' };
  }

  if (game.phase === 'bid') {
    return applyAction(game, playerId, {
      type: 'call',
      payload: { score: 0 },
    });
  }

  const hand = game.hands[playerId];
  if (!hand || !hand.length) return { ok: false, error: '无牌可出' };

  const mustPlay =
    !game.lastPlay || game.lastValidPlayerId === playerId;
  if (!mustPlay) {
    return applyAction(game, playerId, { type: 'pass', payload: {} });
  }

  const card = hand[0];
  return applyAction(game, playerId, {
    type: 'play',
    payload: { cards: [card.id] },
  });
}

module.exports = {
  createGameState,
  applyAction,
  publicGameState,
  getActingPlayerIds,
  onPlayerQuit,
  forceTimeout,
};
