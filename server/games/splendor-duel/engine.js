'use strict';

/**
 * Splendor Duel（璀璨宝石·对决）引擎 —— 官方牌表 1:1 复刻
 *
 * 牌表：67 张珠宝卡（L1×30 / L2×24 / L3×13）+ 4 张皇室卡
 * 标记：5 色各 4 + 珍珠 2 + 金 3 = 25 个，开局全部铺满 5×5 版图，抽袋为空
 * 金字塔：L1 翻 5 张、L2 翻 4 张、L3 翻 3 张
 * 胜利：声望 ≥20 / 皇冠 ≥10 / 同色卡声望 ≥10
 */

const RESOURCES = ['emerald', 'sapphire', 'ruby', 'diamond', 'onyx'];
const ALL_COLORS = [...RESOURCES, 'pearl'];
const GOLD = 'gold';
const ASSOCIATE = 'associate'; // 5 宝石百搭（Associate）
const BOARD_SIZE = 5;
const HAND_LIMIT = 10;
const RESERVE_LIMIT = 3;
const PRIVILEGE_MAX = 3;
const TOTAL_PRIVILEGES = 3;
const PYRAMID = { 1: 5, 2: 4, 3: 3 };

const WIN_PRESTIGE = 20;
const WIN_CROWNS = 10;
const WIN_COLOR_PRESTIGE = 10;

/* 费用简写：W=白(钻石) U=蓝(蓝宝石) G=绿(翡翠) R=红(红宝石) B=黑(玛瑙) P=珍珠 */
const W = 'diamond';
const U = 'sapphire';
const G = 'emerald';
const R = 'ruby';
const B = 'onyx';
const P = 'pearl';

/* ============================================================ */
/* 官方牌表                                                      */
/* ============================================================ */

function mk(tier, id, discount, cost, prestige, crowns, ability) {
  return { id, tier, discount: discount || null, cost, prestige: prestige || 0, crowns: crowns || 0, ability: ability || null };
}

/* ---- 一级：30 张 ---- */
const TIER1 = [
  /* 白（钻石）红利 */
  mk(1, 'l1-01', W, { [U]: 1, [G]: 1, [R]: 1, [B]: 1 }),
  mk(1, 'l1-02', W, { [U]: 3 }, 0, 1),
  mk(1, 'l1-03', W, { [G]: 2, [R]: 2, [P]: 1 }, 0, 0, 'extra_turn'),
  mk(1, 'l1-04', W, { [R]: 2, [B]: 2 }, 0, 0, 'take_gem'),
  mk(1, 'l1-05', W, { [G]: 2, [R]: 3 }, 1),
  /* 蓝（蓝宝石）红利 */
  mk(1, 'l1-06', U, { [W]: 1, [G]: 1, [R]: 1, [B]: 1 }),
  mk(1, 'l1-07', U, { [G]: 3 }, 0, 1),
  mk(1, 'l1-08', U, { [G]: 2, [R]: 2, [P]: 1 }, 0, 0, 'extra_turn'),
  mk(1, 'l1-09', U, { [W]: 2, [B]: 2 }, 0, 0, 'take_gem'),
  mk(1, 'l1-10', U, { [R]: 2, [B]: 3 }, 1),
  /* 绿（翡翠）红利 */
  mk(1, 'l1-11', G, { [W]: 1, [U]: 1, [R]: 1, [B]: 1 }),
  mk(1, 'l1-12', G, { [R]: 3 }, 0, 1),
  mk(1, 'l1-13', G, { [R]: 2, [B]: 2, [P]: 1 }, 0, 0, 'extra_turn'),
  mk(1, 'l1-14', G, { [W]: 2, [U]: 2 }, 0, 0, 'take_gem'),
  mk(1, 'l1-15', G, { [W]: 3, [B]: 2 }, 1),
  /* 黑（玛瑙）红利 */
  mk(1, 'l1-16', B, { [W]: 1, [U]: 1, [G]: 1, [R]: 1 }),
  mk(1, 'l1-17', B, { [W]: 3 }, 0, 1),
  mk(1, 'l1-18', B, { [W]: 2, [U]: 2, [P]: 1 }, 0, 0, 'extra_turn'),
  mk(1, 'l1-19', B, { [G]: 2, [R]: 2 }, 0, 0, 'take_gem'),
  mk(1, 'l1-20', B, { [U]: 2, [G]: 3 }, 1),
  /* 红（红宝石）红利 */
  mk(1, 'l1-21', R, { [W]: 1, [U]: 1, [G]: 1, [B]: 1 }),
  mk(1, 'l1-22', R, { [B]: 3 }, 0, 1),
  mk(1, 'l1-23', R, { [W]: 2, [B]: 2, [P]: 1 }, 0, 0, 'extra_turn'),
  mk(1, 'l1-24', R, { [U]: 2, [G]: 2 }, 0, 0, 'take_gem'),
  mk(1, 'l1-25', R, { [W]: 2, [U]: 3 }, 1),
  /* 合伙人（5 宝石百搭）与金卡 */
  mk(1, 'l1-26', ASSOCIATE, { [B]: 4, [P]: 1 }, 1),
  mk(1, 'l1-27', ASSOCIATE, { [W]: 4, [P]: 1 }, 0, 1),
  mk(1, 'l1-28', null, { [R]: 4, [P]: 1 }, 3), // 金卡：无红利
  mk(1, 'l1-29', ASSOCIATE, { [U]: 2, [R]: 2, [B]: 1, [P]: 1 }, 1),
  mk(1, 'l1-30', ASSOCIATE, { [W]: 2, [G]: 2, [B]: 1, [P]: 1 }, 1),
];

/* ---- 二级：24 张 ---- */
const TIER2 = [
  mk(2, 'l2-01', W, { [G]: 2, [R]: 2, [B]: 2, [P]: 1 }, 2, 1),
  mk(2, 'l2-02', W, { [U]: 4, [R]: 3 }, 1, 0, 'steal_gem'),
  mk(2, 'l2-03', W, { [W]: 4, [B]: 2, [P]: 1 }, 2, 0, 'gain_privilege'),
  mk(2, 'l2-04', W, { [U]: 5, [G]: 2 }, 1),
  mk(2, 'l2-05', U, { [W]: 2, [R]: 2, [B]: 2, [P]: 1 }, 2, 1),
  mk(2, 'l2-06', U, { [G]: 4, [B]: 3 }, 1, 0, 'steal_gem'),
  mk(2, 'l2-07', U, { [W]: 2, [U]: 4, [P]: 1 }, 2, 0, 'gain_privilege'),
  mk(2, 'l2-08', U, { [G]: 5, [R]: 2 }, 1),
  mk(2, 'l2-09', G, { [W]: 2, [U]: 2, [B]: 2, [P]: 1 }, 2, 1),
  mk(2, 'l2-10', G, { [W]: 3, [R]: 4 }, 1, 0, 'steal_gem'),
  mk(2, 'l2-11', G, { [U]: 2, [G]: 4, [P]: 1 }, 2, 0, 'gain_privilege'),
  mk(2, 'l2-12', G, { [R]: 5, [B]: 2 }, 1),
  mk(2, 'l2-13', B, { [U]: 2, [G]: 2, [R]: 2, [P]: 1 }, 2, 1),
  mk(2, 'l2-14', B, { [W]: 4, [G]: 3 }, 1, 0, 'steal_gem'),
  mk(2, 'l2-15', B, { [R]: 2, [B]: 4, [P]: 1 }, 2, 0, 'gain_privilege'),
  mk(2, 'l2-16', B, { [W]: 5, [U]: 2 }, 1),
  mk(2, 'l2-17', R, { [W]: 2, [U]: 2, [G]: 2, [P]: 1 }, 2, 1),
  mk(2, 'l2-18', R, { [U]: 3, [B]: 4 }, 1, 0, 'steal_gem'),
  mk(2, 'l2-19', R, { [G]: 2, [R]: 4, [P]: 1 }, 2, 0, 'gain_privilege'),
  mk(2, 'l2-20', R, { [W]: 2, [B]: 5 }, 1),
  mk(2, 'l2-21', ASSOCIATE, { [G]: 6, [P]: 1 }, 2),
  mk(2, 'l2-22', ASSOCIATE, { [G]: 6, [P]: 1 }, 0, 2),
  mk(2, 'l2-23', ASSOCIATE, { [U]: 6, [P]: 1 }, 0, 2),
  mk(2, 'l2-24', null, { [U]: 6, [P]: 1 }, 5), // 金卡：无红利
];

/* ---- 三级：13 张 ---- */
const TIER3 = [
  mk(3, 'l3-01', W, { [U]: 3, [R]: 5, [B]: 3, [P]: 1 }, 3, 2),
  mk(3, 'l3-02', W, { [W]: 6, [U]: 2, [B]: 2 }, 4),
  mk(3, 'l3-03', U, { [W]: 3, [G]: 3, [B]: 5, [P]: 1 }, 3, 2),
  mk(3, 'l3-04', U, { [W]: 2, [U]: 6, [G]: 2 }, 4),
  mk(3, 'l3-05', G, { [W]: 5, [U]: 3, [R]: 3, [P]: 1 }, 3, 2),
  mk(3, 'l3-06', G, { [U]: 2, [G]: 6, [R]: 2 }, 4),
  mk(3, 'l3-07', B, { [W]: 3, [G]: 5, [R]: 3, [P]: 1 }, 3, 2),
  mk(3, 'l3-08', B, { [W]: 2, [R]: 2, [B]: 6 }, 4),
  mk(3, 'l3-09', R, { [U]: 5, [G]: 3, [B]: 3, [P]: 1 }, 3, 2),
  mk(3, 'l3-10', R, { [G]: 2, [R]: 6, [B]: 2 }, 4),
  mk(3, 'l3-11', ASSOCIATE, { [R]: 8 }, 3, 0, 'extra_turn'),
  mk(3, 'l3-12', ASSOCIATE, { [B]: 8 }, 0, 3),
  mk(3, 'l3-13', null, { [W]: 8 }, 6), // 金卡：无红利
];

/* ---- 皇室卡：4 张（3 / 6 皇冠时各取 1 张）---- */
const ROYALS = [
  { id: 'royal-01', prestige: 2, ability: 'steal_gem' },
  { id: 'royal-02', prestige: 2, ability: 'extra_turn' },
  { id: 'royal-03', prestige: 2, ability: 'gain_privilege' },
  { id: 'royal-04', prestige: 3, ability: null },
];

/* ============================================================ */
/* 辅助函数                                                      */
/* ============================================================ */

function shuffle(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function emptyTokens() {
  const t = {};
  for (const c of ALL_COLORS) t[c] = 0;
  t[GOLD] = 0;
  return t;
}

function totalTokens(tok) { return Object.values(tok).reduce((s, v) => s + v, 0); }

/** 卡牌的实际红利颜色（合伙人卡取玩家选定的颜色；金卡无红利） */
function effectiveDiscount(card) {
  if (!card || !card.discount) return null;
  if (card.discount === ASSOCIATE) return card.assocColor || null;
  return card.discount;
}

function colorCounts(cards) {
  const h = {};
  for (const c of cards) {
    const d = effectiveDiscount(c);
    if (d) h[d] = (h[d] || 0) + 1;
  }
  return h;
}

function getOpponentId(game, pid) {
  return game.turnOrder.find((id) => id !== pid) || null;
}

function hasAnyBonus(cards) {
  return cards.some((c) => c.discount);
}

/* 5×5 中央开始顺时针螺旋序列 */
function spiralCells() {
  const cells = [];
  let r = 2, c = 2;
  cells.push([r, c]);
  const dirs = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // R, U, L, D
  let dir = 0, steps = 1;
  while (cells.length < BOARD_SIZE * BOARD_SIZE) {
    for (let repeat = 0; repeat < 2; repeat++) {
      const [dr, dc] = dirs[dir];
      for (let s = 0; s < steps; s++) {
        r += dr; c += dc;
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) cells.push([r, c]);
      }
      dir = (dir + 1) % 4;
    }
    steps++;
  }
  return cells;
}

const SPIRAL = spiralCells();

/* ============================================================ */
/* 购买与费用                                                    */
/* ============================================================ */

function computePayment(playerCards, playerTokens, card) {
  const bonuses = colorCounts(playerCards);
  const spend = {};
  let goldNeed = 0;
  for (const col of ALL_COLORS) {
    const need = card.cost[col] || 0;
    const deficit = Math.max(0, need - (bonuses[col] || 0));
    const have = playerTokens[col] || 0;
    const fromTokens = Math.min(have, deficit);
    spend[col] = fromTokens;
    if (fromTokens < deficit) goldNeed += deficit - fromTokens;
  }
  return { spend, goldNeed };
}

function canAffordCard(playerCards, playerTokens, card) {
  const { goldNeed } = computePayment(playerCards, playerTokens, card);
  return goldNeed <= (playerTokens[GOLD] || 0);
}

function payForCard(playerCards, playerTokens, bag, spend, goldNeed) {
  for (const col of ALL_COLORS) {
    const n = (spend && spend[col]) || 0;
    if (n > 0) {
      playerTokens[col] -= n;
      for (let i = 0; i < n; i++) bag.push(col);
    }
  }
  const gold = goldNeed || 0;
  if (gold > 0) {
    if ((playerTokens[GOLD] || 0) < gold) return false;
    playerTokens[GOLD] -= gold;
    for (let i = 0; i < gold; i++) bag.push(GOLD);
  }
  return true;
}

/* ============================================================ */
/* 特权                                                          */
/* ============================================================ */

function gainPrivilege(game, playerId) {
  const p = game.playerData[playerId];
  if (!p || p.privileges >= PRIVILEGE_MAX) return; // 已有 3 个则无事发生
  if (game.availablePrivileges > 0) {
    game.availablePrivileges--;
    p.privileges++;
    return;
  }
  const opp = getOpponentId(game, playerId);
  const oppP = opp ? game.playerData[opp] : null;
  if (oppP && oppP.privileges > 0) { oppP.privileges--; p.privileges++; }
}

/* ============================================================ */
/* 版图操作                                                      */
/* ============================================================ */

function fillBoardFromBag(game) {
  if (!game.bag.length) return;
  game.bag = shuffle(game.bag);
  for (const [r, c] of SPIRAL) {
    if (game.bag.length === 0) break;
    if (game.board[r][c] === null) game.board[r][c] = game.bag.shift();
  }
}

function validateTokenCells(board, cells) {
  if (!cells || cells.length < 1 || cells.length > 3) return false;
  for (const [r, c] of cells) {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    if (board[r][c] === null) return false;
    if (board[r][c] === GOLD) return false; // 拿标记行动不能拿黄金
  }
  if (cells.length === 1) return true;

  const sameRow = cells.every(([r]) => r === cells[0][0]);
  const sameCol = cells.every(([, c]) => c === cells[0][1]);
  const sameDiag1 = cells.every(([r, c]) => r - c === cells[0][0] - cells[0][1]);
  const sameDiag2 = cells.every(([r, c]) => r + c === cells[0][0] + cells[0][1]);
  if (!sameRow && !sameCol && !sameDiag1 && !sameDiag2) return false;

  const sorted = cells.slice().sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
  for (let i = 1; i < sorted.length; i++) {
    const dr = Math.abs(sorted[i][0] - sorted[i - 1][0]);
    const dc = Math.abs(sorted[i][1] - sorted[i - 1][1]);
    if (dr > 1 || dc > 1) return false;
  }
  return true;
}

function boardHasNonGold(board) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null && board[r][c] !== GOLD) return true;
    }
  }
  return false;
}

function boardHasGold(board) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === GOLD) return true;
    }
  }
  return false;
}

/** 拿走版图上第一个指定颜色的标记（能力「取同色宝石」/「预留拿金」用） */
function takeTokenOfColor(game, playerId, col) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (game.board[r][c] === col) {
        game.board[r][c] = null;
        game.playerData[playerId].tokens[col] = (game.playerData[playerId].tokens[col] || 0) + 1;
        return true;
      }
    }
  }
  return false;
}

/* ============================================================ */
/* 卡牌能力                                                      */
/* ============================================================ */

/**
 * 立即结算的能力；需要玩家抉择的（steal_gem）返回 'pending' 由调用方入队。
 * @returns {'done'|'pending'}
 */
function resolveCardAbility(game, playerId, card) {
  if (!card.ability) return 'done';
  const p = game.playerData[playerId];
  switch (card.ability) {
    case 'extra_turn':
      game.extraTurnFlag = true;
      return 'done';
    case 'gain_privilege':
      gainPrivilege(game, playerId);
      return 'done';
    case 'take_gem': {
      const col = effectiveDiscount(card);
      if (col) takeTokenOfColor(game, playerId, col);
      return 'done';
    }
    case 'steal_gem': {
      const opp = getOpponentId(game, playerId);
      const oppP = opp ? game.playerData[opp] : null;
      const stealable = oppP ? ALL_COLORS.filter((c) => (oppP.tokens[c] || 0) > 0) : [];
      if (!stealable.length) return 'done'; // 对手无宝石则忽略
      game.pending.push({ type: 'steal_gem', playerId, options: stealable });
      return 'pending';
    }
    default:
      return 'done';
  }
}

function claimRoyal(game, playerId, royalId) {
  const roy = (game.royalties || []).find((r) => r.id === royalId && !r.claimedBy);
  if (!roy) return false;
  roy.claimedBy = playerId;
  const p = game.playerData[playerId];
  p.cards.push({ ...roy, isRoyalty: true, tier: 0 });
  p.prestige += roy.prestige;
  resolveCardAbility(game, playerId, roy);
  return true;
}

/* ============================================================ */
/* 胜利条件                                                      */
/* ============================================================ */

function colorPrestigeMap(cards) {
  const m = {};
  for (const c of cards) {
    if (c.isNoble || c.isRoyalty) continue; // 皇室卡不计入同色声望
    const col = effectiveDiscount(c);
    if (col) m[col] = (m[col] || 0) + (c.prestige || 0);
  }
  return m;
}

function checkWin(game, playerId) {
  const p = game.playerData[playerId];
  if (!p) return null;
  if (p.prestige >= WIN_PRESTIGE) return 'prestige';
  if (p.crowns >= WIN_CROWNS) return 'crowns';
  for (const sum of Object.values(colorPrestigeMap(p.cards))) {
    if (sum >= WIN_COLOR_PRESTIGE) return 'color_prestige';
  }
  return null;
}

/* ============================================================ */
/* 回合结束                                                      */
/* ============================================================ */

function _resetTurnFlags(game) {
  game.optPrivilegeDone = false;
  game.optReplenishDone = false;
  game.extraTurnFlag = false;
}

/** 所有抉择处理完毕后才调用：弃牌 → 胜利判定 → 切换/额外回合 */
function finishTurn(game, actingPlayerId) {
  const p = game.playerData[actingPlayerId];
  const handTotal = totalTokens(p.tokens);
  if (handTotal > HAND_LIMIT) {
    game.phase = 'discard';
    game.discardPlayerId = actingPlayerId;
    game.discardNeed = handTotal - HAND_LIMIT;
    return { ok: true, state: publicGameState(game, actingPlayerId) };
  }

  const winCond = checkWin(game, actingPlayerId);
  if (winCond) {
    game.over = true;
    game.phase = 'over';
    game.winnerId = actingPlayerId;
    game.winCondition = winCond;
    return { ok: true, state: publicGameState(game, actingPlayerId) };
  }

  if (game.extraTurnFlag) {
    _resetTurnFlags(game);
    game.currentPlayerId = actingPlayerId;
    return { ok: true, state: publicGameState(game, actingPlayerId) };
  }

  _resetTurnFlags(game);
  game.turnIndex = (game.turnIndex + 1) % game.turnOrder.length;
  game.currentPlayerId = game.turnOrder[game.turnIndex];
  return { ok: true, state: publicGameState(game, actingPlayerId) };
}

/** 强制行动结束后：先处理抉择队列，全部清空才结束回合 */
function afterMandatory(game, actingPlayerId) {
  game.optPrivilegeDone = true;
  game.optReplenishDone = true;
  if (game.pending.length > 0) return { ok: true, state: publicGameState(game, actingPlayerId) };
  return finishTurn(game, actingPlayerId);
}

/* ============================================================ */
/* 创建游戏状态                                                  */
/* ============================================================ */

function createGameState(room) {
  const players = room.players.slice(0, 2);
  const turnOrder = players.map((p) => p.id);

  // 25 个标记：5 色各 4 + 珍珠 2 + 金 3；开局全部铺满版图，抽袋为空
  const pool = [];
  for (const col of RESOURCES) for (let i = 0; i < 4; i++) pool.push(col);
  for (let i = 0; i < 2; i++) pool.push('pearl');
  for (let i = 0; i < 3; i++) pool.push(GOLD);

  const shuffled = shuffle(pool);
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  for (let i = 0; i < SPIRAL.length && shuffled.length > 0; i++) {
    const [r, c] = SPIRAL[i];
    board[r][c] = shuffled.shift();
  }

  const decks = { tier1: shuffle(TIER1), tier2: shuffle(TIER2), tier3: shuffle(TIER3) };
  const boardCards = {
    tier1: decks.tier1.splice(0, PYRAMID[1]),
    tier2: decks.tier2.splice(0, PYRAMID[2]),
    tier3: decks.tier3.splice(0, PYRAMID[3]),
  };

  const royalties = ROYALS.map((r) => ({ ...r, claimedBy: null }));

  const playerData = {};
  for (const pid of turnOrder) {
    playerData[pid] = {
      tokens: emptyTokens(),
      cards: [],
      reserved: [],
      prestige: 0,
      crowns: 0,
      privileges: 0,
      royaltyTriggersReceived: [],
    };
  }

  const firstIdx = Math.floor(Math.random() * turnOrder.length);
  const secondPlayer = turnOrder[(firstIdx + 1) % turnOrder.length];
  playerData[secondPlayer].privileges = 1;

  return {
    type: 'splendor-duel',
    turnOrder,
    turnIndex: firstIdx,
    currentPlayerId: turnOrder[firstIdx],
    phase: 'play',
    discardPlayerId: null,
    discardNeed: 0,
    optPrivilegeDone: false,
    optReplenishDone: false,
    extraTurnFlag: false,
    passStreak: 0,
    pending: [],
    board,
    bag: [],
    decks,
    boardCards,
    royalties,
    availablePrivileges: TOTAL_PRIVILEGES - 1, // 先手对手已拿 1
    playerData,
    lastAction: null,
    winnerId: null,
    winCondition: null,
    over: false,
    startedAt: Date.now(),
  };
}

/* ============================================================ */
/* 操作路由                                                      */
/* ============================================================ */

function applyAction(game, playerId, action) {
  if (!game || game.over) return { ok: false, error: game ? 'Game over' : 'Not started' };
  const type = action && action.type;
  const payload = action.payload || {};

  // 抉择队列最优先（皇室卡 / 合伙人颜色 / 偷宝石）
  if (game.pending.length > 0) {
    const cur = game.pending[0];
    if (playerId !== cur.playerId) return { ok: false, error: 'Not your turn' };
    if (type !== 'resolve') return { ok: false, error: 'Pending choice required' };
    return _resolvePending(game, playerId, cur, payload);
  }

  if (game.phase === 'discard') {
    if (playerId !== game.discardPlayerId) return { ok: false, error: 'Not your turn to discard' };
    if (type !== 'discard_tokens') return { ok: false, error: 'Please discard tokens' };
    return _handleDiscard(game, playerId, payload);
  }

  if (playerId !== game.currentPlayerId) return { ok: false, error: 'Not your turn' };
  if (game.phase !== 'play') return { ok: false, error: 'Invalid phase' };

  if (type === 'use_privilege') {
    if (game.optPrivilegeDone) return { ok: false, error: 'Privilege already used this turn' };
    return _handleUsePrivilege(game, playerId, payload);
  }
  if (type === 'replenish') {
    if (game.optReplenishDone) return { ok: false, error: 'Replenish already used this turn' };
    return _handleReplenish(game, playerId);
  }

  if (type === 'take_tokens' || type === 'reserve_card' || type === 'buy_card' || type === 'pass') {
    if (!_canAct(game, playerId)) {
      // 规则：无法执行任何强制行动时，必须先补充版图（抽袋为空才可跳过）
      if (game.bag.length > 0) {
        const r = _forceReplenish(game, playerId);
        if (r.ok) return r;
      }
      if (type !== 'pass') return { ok: false, error: 'No mandatory action available' };
      game.passStreak += 1;
      game.lastAction = { type: 'pass', playerId };
      if (game.passStreak >= 2) return _endStalemate(game);
      return afterMandatory(game, playerId);
    }
    game.passStreak = 0;
  }

  if (type === 'take_tokens') return _handleTakeTokens(game, playerId, payload);
  if (type === 'reserve_card') return _handleReserve(game, playerId, payload);
  if (type === 'buy_card') return _handleBuyCard(game, playerId, payload);

  return { ok: false, error: 'Invalid action' };
}

/** 双方连续无法行动：按声望 → 皇冠 → 卡牌数判定，仍相同则为平局 */
function _endStalemate(game) {
  game.over = true;
  game.phase = 'over';
  game.winCondition = 'stalemate';
  const [a, b] = game.turnOrder;
  const pa = game.playerData[a], pb = game.playerData[b];
  if (pa.prestige !== pb.prestige) game.winnerId = pa.prestige > pb.prestige ? a : b;
  else if (pa.crowns !== pb.crowns) game.winnerId = pa.crowns > pb.crowns ? a : b;
  else if (pa.cards.length !== pb.cards.length) game.winnerId = pa.cards.length > pb.cards.length ? a : b;
  else game.winnerId = null; // 平局
  return { ok: true, state: publicGameState(game, a) };
}

/** 是否还存在可行的强制行动 */
function _canAct(game, playerId) {
  if (boardHasNonGold(game.board)) return true;
  const p = game.playerData[playerId];
  if (boardHasGold(game.board) && p.reserved.length < RESERVE_LIMIT) return true;
  for (const key of ['tier1', 'tier2', 'tier3']) {
    for (const card of game.boardCards[key] || []) {
      if (canAffordCard(p.cards, p.tokens, card)) return true;
    }
  }
  for (const card of p.reserved || []) {
    if (canAffordCard(p.cards, p.tokens, card)) return true;
  }
  return false;
}

/* ============================================================ */
/* 抉择结算                                                      */
/* ============================================================ */

function _resolvePending(game, playerId, pend, payload) {
  if (pend.type === 'royal') {
    const royalId = payload.royalId;
    if (!claimRoyal(game, playerId, royalId)) return { ok: false, error: 'Invalid royal card' };
    game.lastAction = { type: 'take_royal', playerId, royalId };
  } else if (pend.type === 'associate_color') {
    const col = payload.color;
    const p = game.playerData[playerId];
    const allowed = Object.keys(colorCounts(p.cards)).filter((c) => c !== ASSOCIATE);
    if (!RESOURCES.includes(col)) return { ok: false, error: 'Invalid color' };
    if (!allowed.includes(col)) return { ok: false, error: 'No bonus of that color' };
    const card = p.cards.find((c) => c.id === pend.cardId);
    if (!card) return { ok: false, error: 'Card not found' };
    card.assocColor = col;
    game.lastAction = { type: 'associate_color', playerId, color: col };
  } else if (pend.type === 'steal_gem') {
    const col = payload.color;
    const opp = getOpponentId(game, playerId);
    const oppP = opp ? game.playerData[opp] : null;
    if (!oppP || !ALL_COLORS.includes(col) || (oppP.tokens[col] || 0) <= 0) {
      return { ok: false, error: 'Invalid steal target' };
    }
    oppP.tokens[col]--;
    game.playerData[playerId].tokens[col] = (game.playerData[playerId].tokens[col] || 0) + 1;
    game.lastAction = { type: 'steal_gem', playerId, color: col };
  } else {
    game.pending.shift();
    return { ok: false, error: 'Unknown pending' };
  }

  game.pending.shift();
  if (game.pending.length > 0) return { ok: true, state: publicGameState(game, playerId) };
  return finishTurn(game, playerId);
}

/* ============================================================ */
/* 可选：使用特权                                                */
/* ============================================================ */

function _handleUsePrivilege(game, playerId, payload) {
  const p = game.playerData[playerId];
  const count = Math.max(1, Math.min(p.privileges, Number(payload.count) || 1));
  const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];

  if (count > p.privileges) return { ok: false, error: 'Not enough privileges' };
  if (tokens.length !== count) return { ok: false, error: `Select ${count} tokens` };

  for (const [r, c] of tokens) {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return { ok: false, error: 'Invalid token position' };
    if (game.board[r][c] === null) return { ok: false, error: 'No token there' };
    if (game.board[r][c] === GOLD) return { ok: false, error: 'Cannot take gold with privilege' };
  }

  p.privileges -= count;
  game.availablePrivileges += count;
  for (const [r, c] of tokens) {
    const col = game.board[r][c];
    game.board[r][c] = null;
    p.tokens[col] = (p.tokens[col] || 0) + 1;
  }

  game.lastAction = { type: 'use_privilege', playerId, count, tokens: tokens.map(([r, c]) => [r, c]) };
  game.optPrivilegeDone = true;
  return { ok: true, state: publicGameState(game, playerId) };
}

/* ============================================================ */
/* 可选：补充版图                                                */
/* ============================================================ */

function _handleReplenish(game, playerId) {
  if (game.bag.length === 0) return { ok: false, error: 'Bag is empty' };
  const r = _forceReplenish(game, playerId);
  if (r.ok) game.optReplenishDone = true;
  return r;
}

/** 补充版图（不受「本回合已补充」限制，用于规则强制触发） */
function _forceReplenish(game, playerId) {
  if (game.bag.length === 0) return { ok: false, error: 'Bag is empty' };

  fillBoardFromBag(game);
  game.optReplenishDone = true;

  const opp = getOpponentId(game, playerId);
  if (opp) gainPrivilege(game, opp);

  game.lastAction = { type: 'replenish', playerId };
  return { ok: true, state: publicGameState(game, playerId) };
}

/* ============================================================ */
/* 强制：拿标记                                                  */
/* ============================================================ */

function _handleTakeTokens(game, playerId, payload) {
  const cells = Array.isArray(payload.cells) ? payload.cells : [];
  if (!validateTokenCells(game.board, cells)) {
    return { ok: false, error: 'Invalid token selection' };
  }

  const p = game.playerData[playerId];
  const colors = [];
  let pearlCount = 0;
  for (const [r, c] of cells) {
    const col = game.board[r][c];
    game.board[r][c] = null;
    p.tokens[col] = (p.tokens[col] || 0) + 1;
    colors.push(col);
    if (col === 'pearl') pearlCount++;
  }

  const colorFreq = {};
  for (const col of colors) colorFreq[col] = (colorFreq[col] || 0) + 1;
  const maxSame = Math.max(0, ...Object.values(colorFreq));

  if (maxSame >= 3 || pearlCount >= 2) {
    const opp = getOpponentId(game, playerId);
    if (opp) gainPrivilege(game, opp);
  }

  game.lastAction = { type: 'take_tokens', playerId, cells: cells.map(([r, c]) => [r, c]), colors };
  return afterMandatory(game, playerId);
}

/* ============================================================ */
/* 强制：预留（拿 1 金）                                          */
/* ============================================================ */

function _handleReserve(game, playerId, payload) {
  const p = game.playerData[playerId];
  if (p.reserved.length >= RESERVE_LIMIT) return { ok: false, error: 'Reserve limit reached' };
  if (!boardHasGold(game.board)) return { ok: false, error: 'No gold token on board' };

  const tier = payload.tier;
  const idx = payload.idx;
  const fromDeck = payload.fromDeck === true;
  const key = `tier${tier}`;
  let card = null;

  if (fromDeck) {
    if (![1, 2, 3].includes(tier) || !game.decks[key] || game.decks[key].length === 0) return { ok: false, error: 'Deck empty' };
    card = game.decks[key].shift();
  } else {
    if (![1, 2, 3].includes(tier) || !(idx >= 0) || idx >= (game.boardCards[key] || []).length) return { ok: false, error: 'Invalid card' };
    card = game.boardCards[key][idx];
    game.boardCards[key].splice(idx, 1);
    if (game.decks[key].length > 0) game.boardCards[key].push(game.decks[key].shift());
  }
  if (!card) return { ok: false, error: 'Card not found' };

  p.reserved.push({ ...card });
  takeTokenOfColor(game, playerId, GOLD);

  game.lastAction = { type: 'reserve_card', playerId, cardId: card.id, tier: card.tier };
  return afterMandatory(game, playerId);
}

/* ============================================================ */
/* 强制：买卡                                                    */
/* ============================================================ */

function _handleBuyCard(game, playerId, payload) {
  const p = game.playerData[playerId];
  let card = null;
  let source = null;

  const tier = payload.tier;
  const idx = payload.idx;
  const fromReserve = payload.fromReserve === true;
  const reserveIdx = typeof payload.reserveIdx === 'number' ? payload.reserveIdx : -1;

  if (fromReserve) {
    if (reserveIdx < 0 || reserveIdx >= p.reserved.length) return { ok: false, error: 'Invalid reserved card' };
    card = p.reserved[reserveIdx];
    source = 'reserve';
  } else {
    const key = `tier${tier}`;
    if (![1, 2, 3].includes(tier) || !(idx >= 0) || idx >= (game.boardCards[key] || []).length) return { ok: false, error: 'Invalid card' };
    card = game.boardCards[key][idx];
    source = 'board';
  }

  if (!card) return { ok: false, error: 'Card not found' };
  if (card.discount === ASSOCIATE && !hasAnyBonus(p.cards.filter((c) => c.id !== card.id))) {
    return { ok: false, error: 'Need a card with a bonus first' };
  }
  if (!canAffordCard(p.cards, p.tokens, card)) return { ok: false, error: 'Cannot afford' };

  const { spend, goldNeed } = computePayment(p.cards, p.tokens, card);
  if (!payForCard(p.cards, p.tokens, game.bag, spend, goldNeed)) return { ok: false, error: 'Cannot afford' };

  if (source === 'board') {
    const key = `tier${tier}`;
    game.boardCards[key].splice(idx, 1);
    if (game.decks[key].length > 0) game.boardCards[key].push(game.decks[key].shift());
  } else {
    p.reserved.splice(reserveIdx, 1);
  }

  const bought = { ...card, assocColor: null };
  p.cards.push(bought);
  p.prestige += card.prestige || 0;
  p.crowns += card.crowns || 0;

  game.pending = [];

  // 1) 合伙人卡：选择要复制的红利颜色
  if (card.discount === ASSOCIATE) {
    game.pending.push({ type: 'associate_color', playerId, cardId: bought.id });
  }

  // 2) 皇冠达 3 / 6：取 1 张皇室卡（玩家自选）
  for (const th of [3, 6]) {
    if (p.crowns >= th && !p.royaltyTriggersReceived.includes(th)) {
      p.royaltyTriggersReceived.push(th);
      if (game.royalties.some((r) => !r.claimedBy)) {
        game.pending.push({ type: 'royal', playerId, threshold: th });
      }
    }
  }

  // 3) 卡牌能力
  resolveCardAbility(game, playerId, bought);

  game.lastAction = { type: 'buy_card', playerId, cardId: card.id, source, tier: card.tier };
  return afterMandatory(game, playerId);
}

/* ============================================================ */
/* 弃标记                                                        */
/* ============================================================ */

function _handleDiscard(game, playerId, payload) {
  const p = game.playerData[playerId];
  const discarding = payload.tokens || {};
  let dropCount = 0;
  for (const col of ALL_COLORS.concat([GOLD])) {
    const n = discarding[col] || 0;
    if (n < 0 || n > (p.tokens[col] || 0)) return { ok: false, error: 'Invalid discard count' };
    dropCount += n;
  }
  if (dropCount !== game.discardNeed) return { ok: false, error: `Must discard exactly ${game.discardNeed} tokens` };

  for (const col of ALL_COLORS.concat([GOLD])) {
    const n = discarding[col] || 0;
    if (n > 0) {
      p.tokens[col] -= n;
      for (let i = 0; i < n; i++) game.bag.push(col);
    }
  }

  game.phase = 'play';
  game.discardPlayerId = null;
  game.discardNeed = 0;
  return finishTurn(game, playerId);
}

/* ============================================================ */
/* 公共状态                                                      */
/* ============================================================ */

function publicGameState(game, viewerId) {
  if (!game) return null;
  const publicPlayers = {};
  for (const pid of game.turnOrder) {
    const p = game.playerData[pid];
    publicPlayers[pid] = {
      tokenCounts: { ...p.tokens },
      reserved: pid === viewerId ? p.reserved.map((c) => ({ ...c })) : p.reserved.map((c) => ({ id: c.id, tier: c.tier })),
      cards: p.cards.map((c) => ({ ...c })),
      cardCount: p.cards.filter((c) => !c.isNoble && !c.isRoyalty).length,
      bonusCounts: colorCounts(p.cards),
      colorPrestige: colorPrestigeMap(p.cards),
      prestige: p.prestige,
      crowns: p.crowns,
      privileges: p.privileges,
      royalCount: p.cards.filter((c) => c.isRoyalty).length,
    };
  }

  const pend = game.pending[0] || null;
  let pending = null;
  if (pend) {
    pending = { type: pend.type, playerId: pend.playerId };
    if (pend.type === 'royal') {
      pending.threshold = pend.threshold || 3;
      pending.options = game.royalties.filter((r) => !r.claimedBy).map((r) => ({ id: r.id, prestige: r.prestige, ability: r.ability }));
    } else if (pend.type === 'associate_color') {
      const p = game.playerData[pend.playerId];
      pending.cardId = pend.cardId;
      if (pend.playerId === viewerId) {
        pending.options = Object.keys(colorCounts(p.cards.filter((c) => c.id !== pend.cardId))).filter((c) => c !== ASSOCIATE);
      }
    } else if (pend.type === 'steal_gem') {
      if (pend.playerId === viewerId) pending.options = pend.options.slice();
      else pending.options = pend.options.length;
    }
  }

  return {
    type: 'splendor-duel',
    turnOrder: game.turnOrder.slice(),
    turnIndex: game.turnIndex,
    currentPlayerId: game.currentPlayerId,
    phase: game.phase,
    discardPlayerId: game.discardPlayerId,
    discardNeed: game.discardNeed,
    optPrivilegeDone: game.optPrivilegeDone,
    optReplenishDone: game.optReplenishDone,
    extraTurnFlag: game.extraTurnFlag,
    board: game.board.map((row) => row.slice()),
    bagLeft: game.bag ? game.bag.length : 0,
    availablePrivileges: game.availablePrivileges,
    boardCards: {
      tier1: (game.boardCards.tier1 || []).map((c) => ({ ...c })),
      tier2: (game.boardCards.tier2 || []).map((c) => ({ ...c })),
      tier3: (game.boardCards.tier3 || []).map((c) => ({ ...c })),
    },
    decksLeft: {
      tier1: (game.decks.tier1 || []).length,
      tier2: (game.decks.tier2 || []).length,
      tier3: (game.decks.tier3 || []).length,
    },
    royalties: (game.royalties || []).map((r) => ({
      id: r.id,
      prestige: r.prestige,
      ability: r.ability,
      claimedBy: r.claimedBy || null,
    })),
    pending,
    players: publicPlayers,
    lastAction: game.lastAction ? { ...game.lastAction } : null,
    winnerId: game.winnerId,
    winCondition: game.winCondition,
    over: game.over,
    startedAt: game.startedAt,
  };
}

function getActingPlayerIds(game) {
  if (!game || game.over) return [];
  if (game.pending.length > 0) return [game.pending[0].playerId];
  if (game.phase === 'discard') return game.discardPlayerId ? [game.discardPlayerId] : [];
  return game.currentPlayerId ? [game.currentPlayerId] : [];
}

function onPlayerQuit(game, playerId) {
  if (!game || game.over) return;
  game.over = true;
  const other = getOpponentId(game, playerId);
  game.winnerId = other || game.turnOrder[0];
  game.winCondition = 'opponent_quit';
}

/* ============================================================ */
/* 超时处理                                                      */
/* ============================================================ */

function forceTimeout(game, playerId) {
  if (!game || game.over) return { ok: false, error: 'Game over' };

  if (game.pending.length > 0) {
    const pend = game.pending[0];
    if (playerId !== pend.playerId) return { ok: false, error: 'Not your turn' };
    const payload = {};
    if (pend.type === 'royal') payload.royalId = (game.royalties.find((r) => !r.claimedBy) || {}).id;
    else if (pend.type === 'associate_color') {
      const p = game.playerData[playerId];
      payload.color = Object.keys(colorCounts(p.cards.filter((c) => c.id !== pend.cardId))).filter((c) => c !== ASSOCIATE)[0];
    } else if (pend.type === 'steal_gem') payload.color = pend.options[0];
    return _resolvePending(game, playerId, pend, payload);
  }

  if (game.phase === 'discard' && playerId === game.discardPlayerId) {
    const p = game.playerData[playerId];
    const need = game.discardNeed;
    const discarding = {};
    let left = need;
    for (const col of ALL_COLORS.concat([GOLD])) {
      if (left <= 0) break;
      const n = Math.min(p.tokens[col] || 0, left);
      if (n > 0) { discarding[col] = n; p.tokens[col] -= n; left -= n; }
    }
    for (const col of ALL_COLORS.concat([GOLD])) {
      const n = discarding[col] || 0;
      for (let i = 0; i < n; i++) game.bag.push(col);
    }
    game.phase = 'play';
    game.discardPlayerId = null;
    game.discardNeed = 0;
    return finishTurn(game, playerId);
  }

  if (playerId !== game.currentPlayerId) return { ok: false, error: 'Not your turn' };

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (game.board[r][c] !== null && game.board[r][c] !== GOLD) {
        return _handleTakeTokens(game, playerId, { cells: [[r, c]] });
      }
    }
  }
  game.lastAction = { type: 'pass', playerId };
  return afterMandatory(game, playerId);
}

module.exports = {
  createGameState,
  applyAction,
  publicGameState,
  getActingPlayerIds,
  onPlayerQuit,
  forceTimeout,
  /* 供冒烟测试/工具使用 */
  _cards: { TIER1, TIER2, TIER3, ROYALS },
};
