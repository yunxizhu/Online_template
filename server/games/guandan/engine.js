'use strict';

const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

function rankValue(rank, level) {
  const order = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  if (rank === 'joker') return 100;
  if (rank === 'JOKER') return 101;
  if (rank === level) return 99;
  const v = order.indexOf(rank);
  if (v === -1) return 0;
  return v;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck() {
  const deck = [];
  for (let d = 0; d < 2; d++) {
    for (const rank of RANKS) {
      for (const suit of SUITS) {
        deck.push({ suit, rank, id: suit + rank + '_' + d });
      }
    }
  }
  deck.push({ suit: 'joker', rank: 'joker', id: 'jokerjoker_0' });
  deck.push({ suit: 'joker', rank: 'JOKER', id: 'jokerJOKER_0' });
  deck.push({ suit: 'joker', rank: 'joker', id: 'jokerjoker_1' });
  deck.push({ suit: 'joker', rank: 'JOKER', id: 'jokerJOKER_1' });
  return deck;
}

function handSort(a, b, level) {
  const va = rankValue(a.rank, level);
  const vb = rankValue(b.rank, level);
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

function isFlush(cards) {
  if (cards.length !== 5) return false;
  const suit = cards[0].suit;
  return cards.every((c) => c.suit === suit);
}

function isStraightRanks(cards, level) {
  if (cards.length !== 5) return false;
  const seen = new Set();
  for (const c of cards) {
    if (['2', 'joker', 'JOKER'].includes(c.rank)) return false;
    if (seen.has(c.rank)) return false;
    seen.add(c.rank);
  }
  const sorted = cards
    .slice()
    .sort((a, b) => rankValue(a.rank, level) - rankValue(b.rank, level));
  for (let i = 1; i < sorted.length; i++) {
    if (
      rankValue(sorted[i].rank, level) !==
      rankValue(sorted[i - 1].rank, level) + 1
    ) {
      return false;
    }
  }
  return true;
}

function classifyPlay(cards, level) {
  if (!cards || !cards.length) return null;
  const n = cards.length;
  const h = histogramByRank(cards);
  const values = Object.values(h);
  const ranks = Object.keys(h).sort(
    (a, b) => rankValue(a, level) - rankValue(b, level)
  );

  // 天王炸（4王）
  const jokerCount = (h['joker'] || 0) + (h['JOKER'] || 0);
  if (jokerCount === 4 && n === 4) {
    return { type: 'rocket', rank: 'JOKER', length: 4 };
  }

  // 同花顺
  if (n === 5 && isFlush(cards) && isStraightRanks(cards, level)) {
    const sorted = cards
      .slice()
      .sort((a, b) => rankValue(a.rank, level) - rankValue(b.rank, level));
    return {
      type: 'straight_flush',
      rank: sorted[sorted.length - 1].rank,
      length: 5,
    };
  }

  // 炸弹 (4-8张)
  if (n >= 4 && n <= 8 && values.length === 1) {
    return { type: 'bomb', rank: ranks[0], length: n };
  }

  // 单张
  if (n === 1) {
    return { type: 'single', rank: ranks[0], length: 1 };
  }

  // 对子
  if (n === 2 && values.length === 1 && values[0] === 2) {
    return { type: 'pair', rank: ranks[0], length: 1 };
  }

  // 三张
  if (n === 3 && values.length === 1 && values[0] === 3) {
    return { type: 'triple', rank: ranks[0], length: 1 };
  }

  // 三带二
  if (n === 5 && values.length === 2) {
    const tripleRank = ranks.find((r) => h[r] === 3);
    if (tripleRank) {
      const otherRank = ranks.find((r) => r !== tripleRank);
      if (h[otherRank] === 2) {
        return {
          type: 'triple_plus_pair',
          rank: tripleRank,
          length: 1,
        };
      }
    }
  }

  // 顺子 (5+)
  if (n >= 5 && values.every((v) => v === 1)) {
    if (ranks.some((r) => ['2', 'joker', 'JOKER'].includes(r))) return null;
    const sorted = cards
      .slice()
      .sort((a, b) => rankValue(a.rank, level) - rankValue(b.rank, level));
    for (let i = 1; i < sorted.length; i++) {
      if (
        rankValue(sorted[i].rank, level) !==
        rankValue(sorted[i - 1].rank, level) + 1
      )
        return null;
    }
    return { type: 'straight', rank: sorted[sorted.length - 1].rank, length: n };
  }

  // 连对 (3+ 对)
  if (n >= 6 && n % 2 === 0 && values.every((v) => v === 2)) {
    if (ranks.some((r) => ['2', 'joker', 'JOKER'].includes(r))) return null;
    for (let i = 1; i < ranks.length; i++) {
      if (rankValue(ranks[i], level) !== rankValue(ranks[i - 1], level) + 1)
        return null;
    }
    return {
      type: 'double_straight',
      rank: ranks[ranks.length - 1],
      length: n / 2,
    };
  }

  // 钢板 (2+ 连续三张)
  const tripleRanks = ranks
    .filter((r) => h[r] === 3)
    .sort((a, b) => rankValue(a, level) - rankValue(b, level));
  if (tripleRanks.length >= 2) {
    let seqLen = 1;
    let maxSeqStart = 0;
    let curLen = 1;
    for (let i = 1; i < tripleRanks.length; i++) {
      if (rankValue(tripleRanks[i], level) === rankValue(tripleRanks[i - 1], level) + 1) {
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

    if (extra === 0 && ranks.length === coreRanks.length) {
      return {
        type: 'plane',
        rank: coreRanks[coreRanks.length - 1],
        length: coreRanks.length,
      };
    }
  }

  return null;
}

function canBeat(last, current, level) {
  if (!last) return true;

  // 火箭最大
  if (current.type === 'rocket') return true;
  if (last.type === 'rocket') return false;

  // 同花顺 > 炸弹 > 普通牌型
  if (current.type === 'straight_flush') {
    if (last.type !== 'straight_flush') return true;
    return rankValue(current.rank, level) > rankValue(last.rank, level);
  }
  if (last.type === 'straight_flush') return false;

  // 炸弹
  if (current.type === 'bomb') {
    if (last.type !== 'bomb') return true;
    if (current.length > last.length) return true;
    if (current.length < last.length) return false;
    return rankValue(current.rank, level) > rankValue(last.rank, level);
  }
  if (last.type === 'bomb') return false;

  // 同类型才能比较
  if (current.type !== last.type) return false;

  // 长度必须一致（顺子、连对等）
  if (current.length !== last.length) return false;

  // 比点数
  return rankValue(current.rank, level) > rankValue(last.rank, level);
}

function validateCardsInHand(hand, cardIds) {
  if (!cardIds || !cardIds.length) return false;
  const handIds = hand.map((c) => c.id);
  for (const id of cardIds) {
    if (!handIds.includes(id)) return false;
  }
  return true;
}

function removeCardsFromHand(hand, cardIds) {
  const set = new Set(cardIds);
  return hand.filter((c) => !set.has(c.id));
}

function determineTeams(turnOrder) {
  const teamA = [turnOrder[0], turnOrder[2]];
  const teamB = [turnOrder[1], turnOrder[3]];
  return { teamA, teamB };
}

function getTeamOf(playerId, game) {
  if (game.teamA.includes(playerId)) return 'A';
  if (game.teamB.includes(playerId)) return 'B';
  return null;
}

function nextActivePlayer(game) {
  const total = game.turnOrder.length;
  for (let i = 1; i <= total; i++) {
    const idx = (game.turnIndex + i) % total;
    const pid = game.turnOrder[idx];
    if (!game.finishOrder.includes(pid)) return { idx, pid };
  }
  return null;
}

function createGameState(room) {
  const players = room.players.slice(0, 4);
  const turnOrder = players.map((p) => p.id);

  const deck = shuffle(buildDeck());
  const hands = {};
  for (const pid of turnOrder) {
    hands[pid] = deck.splice(0, 27).sort((a, b) => handSort(a, b, '2'));
  }

  const currentLevel = '2';
  const { teamA, teamB } = determineTeams(turnOrder);

  return {
    type: 'guandan',
    phase: 'play',
    turnOrder,
    turnIndex: 0,
    currentPlayerId: turnOrder[0],
    hands,
    level: currentLevel,
    teamA,
    teamB,
    lastPlay: null,
    lastValidPlayerId: null,
    passCount: 0,
    playedCount: {},
    finishOrder: [],
    scores: {},
    winnerTeam: null,
    winnerId: null,
    winners: [],
    levelsUp: 0,
    over: false,
    startedAt: Date.now(),
  };
}

function applyAction(game, playerId, action) {
  if (!game) return { ok: false, error: '对局未开始' };
  if (game.over) return { ok: false, error: '对局已结束' };
  if (playerId !== game.currentPlayerId) {
    return { ok: false, error: '还没轮到你' };
  }

  const type = action && action.type;

  if (type === 'pass') {
    if (!game.lastPlay) {
      return { ok: false, error: '第一手必须出牌' };
    }

    game.passCount += 1;

    const activePlayers = game.turnOrder.filter(
      (pid) => !game.finishOrder.includes(pid)
    );
    const allPassed = game.passCount >= activePlayers.length - 1;

    if (allPassed) {
      if (game.lastValidPlayerId) {
        const idx = game.turnOrder.indexOf(game.lastValidPlayerId);
        if (idx !== -1) {
          game.turnIndex = idx;
          game.currentPlayerId = game.turnOrder[idx];
        }
      }
      game.lastPlay = null;
      game.lastValidPlayerId = null;
      game.passCount = 0;
    } else {
      const next = nextActivePlayer(game);
      if (next) {
        game.turnIndex = next.idx;
        game.currentPlayerId = next.pid;
      }
    }

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
  const play = classifyPlay(selectedCards, game.level);
  if (!play) return { ok: false, error: '牌型不合法' };

  if (game.lastPlay && game.lastPlay.playerId !== playerId) {
    if (!canBeat(game.lastPlay.play, play, game.level)) {
      return { ok: false, error: '牌型或大小不足以压过上家' };
    }
  }

  game.hands[playerId] = removeCardsFromHand(game.hands[playerId], cardIds);
  game.playedCount[playerId] =
    (game.playedCount[playerId] || 0) + cardIds.length;

  game.lastPlay = {
    playerId,
    cards: selectedCards.map((c) => ({ ...c })),
    play: { ...play },
  };
  game.lastValidPlayerId = playerId;
  game.passCount = 0;

  // 检查是否出完了
  if (game.hands[playerId].length === 0) {
    game.finishOrder.push(playerId);

    if (game.finishOrder.length >= 3) {
      game.over = true;

      const firstPlayer = game.finishOrder[0];
      const firstTeam = getTeamOf(firstPlayer, game);

      const teammate =
        firstTeam === 'A'
          ? game.teamA.find((p) => p !== firstPlayer)
          : game.teamB.find((p) => p !== firstPlayer);
      const teammatePos = game.finishOrder.indexOf(teammate);

      let levelsUp = 1;
      if (teammatePos === 1) levelsUp = 3;
      else if (teammatePos === 2) levelsUp = 2;
      else levelsUp = 1;

      game.winnerTeam = firstTeam;
      if (firstTeam === 'A') {
        game.winners = game.teamA.slice();
      } else {
        game.winners = game.teamB.slice();
      }
      game.winnerId = firstPlayer;
      game.levelsUp = levelsUp;
    }
  }

  if (!game.over) {
    const next = nextActivePlayer(game);
    if (next) {
      game.turnIndex = next.idx;
      game.currentPlayerId = next.pid;
    }
  }

  return { ok: true, state: publicGameState(game, playerId) };
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
    type: 'guandan',
    phase: game.phase,
    turnOrder: game.turnOrder.slice(),
    turnIndex: game.turnIndex,
    currentPlayerId: game.currentPlayerId,
    handCounts,
    hands: visibleHands,
    level: game.level,
    teamA: game.teamA ? game.teamA.slice() : [],
    teamB: game.teamB ? game.teamB.slice() : [],
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
    finishOrder: game.finishOrder ? game.finishOrder.slice() : [],
    scores: { ...game.scores },
    winnerTeam: game.winnerTeam,
    winnerId: game.winnerId,
    winners: game.winners ? game.winners.slice() : [],
    levelsUp: game.levelsUp || 0,
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
  const quitTeam = getTeamOf(playerId, game);
  if (quitTeam === 'A') {
    game.winners = game.teamB.slice();
    game.winnerTeam = 'B';
  } else {
    game.winners = game.teamA.slice();
    game.winnerTeam = 'A';
  }
  game.winnerId = game.winners[0];
}

function forceTimeout(game, playerId) {
  if (!game || game.over || playerId !== game.currentPlayerId) {
    return { ok: false, error: '无需操作' };
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
