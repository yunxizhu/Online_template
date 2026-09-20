'use strict';

/**
 * Splendor Duel 引擎 —— BGA 规则版
 *
 * 核心：5×5 版图，回合 = 可选(特权/补充) + 强制(拿标记/买卡/预留)
 */

const RESOURCES = ['emerald', 'sapphire', 'ruby', 'diamond', 'onyx'];
const ALL_COLORS = [...RESOURCES, 'pearl'];
const GOLD = 'gold';
const BOARD_SIZE = 5;
const HAND_LIMIT = 10;
const RESERVE_LIMIT = 3;
const PRIVILEGE_MAX = 3;
const TOTAL_PRIVILEGES = 3;

const WIN_PRESTIGE = 20;
const WIN_CROWNS = 10;
const WIN_COLOR_PRESTIGE = 10;

/* ============================================================ */
/* 辅助函数 */
/* ============================================================ */

function shuffle(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeId(tier, idx) { return `t${tier}_${idx}`; }

function emptyTokens() {
  const t = {};
  for (const c of ALL_COLORS) t[c] = 0;
  t[GOLD] = 0;
  return t;
}

function totalTokens(tok) { return Object.values(tok).reduce((s, v) => s + v, 0); }

function colorCounts(cards) {
  const h = {};
  for (const c of cards) { if (c.discount) h[c.discount] = (h[c.discount] || 0) + 1; }
  return h;
}

function getOpponentId(game, pid) {
  return game.turnOrder.find((id) => id !== pid);
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
/* 卡牌生成 */
/* ============================================================ */

function _mkCard(tier, idx, cost, discount, prestige, crowns, ability) {
  return {
    id: makeId(tier, idx),
    tier,
    cost,
    discount,
    prestige: prestige || 0,
    crowns: crowns || 0,
    ability: ability || null,
  };
}

function buildTier1() {
  let i = 0;
  const cards = [
    /* 2X 系列（5张）】 */
    _mkCard(1, i++, { emerald: 2 }, 'emerald'),
    _mkCard(1, i++, { sapphire: 2 }, 'sapphire'),
    _mkCard(1, i++, { ruby: 2 }, 'ruby'),
    _mkCard(1, i++, { diamond: 2 }, 'diamond'),
    _mkCard(1, i++, { onyx: 2 }, 'onyx'),
    /* 2X+1Y 系列（5张）】 */
    _mkCard(1, i++, { emerald: 2, sapphire: 1 }, 'emerald'),
    _mkCard(1, i++, { sapphire: 2, ruby: 1 }, 'sapphire'),
    _mkCard(1, i++, { ruby: 2, diamond: 1 }, 'ruby'),
    _mkCard(1, i++, { diamond: 2, onyx: 1 }, 'diamond'),
    _mkCard(1, i++, { onyx: 2, emerald: 1 }, 'onyx'),
    /* X+Y+Z 系列，声望1（5张）】 */
    _mkCard(1, i++, { emerald: 1, sapphire: 1, ruby: 1 }, 'emerald', 1),
    _mkCard(1, i++, { sapphire: 1, ruby: 1, diamond: 1 }, 'sapphire', 1),
    _mkCard(1, i++, { ruby: 1, diamond: 1, onyx: 1 }, 'ruby', 1),
    _mkCard(1, i++, { diamond: 1, onyx: 1, emerald: 1 }, 'diamond', 1),
    _mkCard(1, i++, { onyx: 1, emerald: 1, sapphire: 1 }, 'onyx', 1),
    /* 2X+2Y 系列，王冠1（5张）】 */
    _mkCard(1, i++, { emerald: 2, sapphire: 2 }, 'emerald', 0, 1),
    _mkCard(1, i++, { sapphire: 2, ruby: 2 }, 'sapphire', 0, 1),
    _mkCard(1, i++, { ruby: 2, diamond: 2 }, 'ruby', 0, 1),
    _mkCard(1, i++, { diamond: 2, onyx: 2 }, 'diamond', 0, 1),
    _mkCard(1, i++, { onyx: 2, emerald: 2 }, 'onyx', 0, 1),
    /* 能力卡（2张）】 */
    _mkCard(1, i++, { emerald: 1, sapphire: 1, ruby: 1 }, 'emerald', 0, 0, 'extra_turn'),
    _mkCard(1, i++, { ruby: 1, diamond: 1, onyx: 1 }, 'ruby', 0, 0, 'take_matching'),
  ];
  return shuffle(cards);
}

function buildTier2() {
  let i = 0;
  const cards = [
    /* 3X+2Y+1Z 系列，声望1、王冠1（5张）】 */
    _mkCard(2, i++, { emerald: 3, sapphire: 2, ruby: 1 }, 'emerald', 1, 1),
    _mkCard(2, i++, { sapphire: 3, ruby: 2, diamond: 1 }, 'sapphire', 1, 1),
    _mkCard(2, i++, { ruby: 3, diamond: 2, onyx: 1 }, 'ruby', 1, 1),
    _mkCard(2, i++, { diamond: 3, onyx: 2, emerald: 1 }, 'diamond', 1, 1),
    _mkCard(2, i++, { onyx: 3, emerald: 2, sapphire: 1 }, 'onyx', 1, 1),
    /* 2X+2Y+2Z 系列，声望2、王冠1（5张）】 */
    _mkCard(2, i++, { emerald: 2, sapphire: 2, ruby: 2 }, 'emerald', 2, 1),
    _mkCard(2, i++, { sapphire: 2, ruby: 2, diamond: 2 }, 'sapphire', 2, 1),
    _mkCard(2, i++, { ruby: 2, diamond: 2, onyx: 2 }, 'ruby', 2, 1),
    _mkCard(2, i++, { diamond: 2, onyx: 2, emerald: 2 }, 'diamond', 2, 1),
    _mkCard(2, i++, { onyx: 2, emerald: 2, sapphire: 2 }, 'onyx', 2, 1),
    /* 2X+2Y+2珍珠 系列，声望2、王冠2（5张）】 */
    _mkCard(2, i++, { emerald: 2, sapphire: 2, pearl: 2 }, 'diamond', 2, 2),
    _mkCard(2, i++, { sapphire: 2, ruby: 2, pearl: 2 }, 'onyx', 2, 2),
    _mkCard(2, i++, { ruby: 2, diamond: 2, pearl: 2 }, 'emerald', 2, 2),
    _mkCard(2, i++, { diamond: 2, onyx: 2, pearl: 2 }, 'sapphire', 2, 2),
    _mkCard(2, i++, { onyx: 2, emerald: 2, pearl: 2 }, 'ruby', 2, 2),
  ];
  return shuffle(cards);
}

function buildTier3() {
  let i = 0;
  const cards = [
    /* 3X+2Y+2Z 系列，声望4、王冠2（5张）】 */
    _mkCard(3, i++, { emerald: 3, sapphire: 2, ruby: 2 }, 'emerald', 4, 2),
    _mkCard(3, i++, { sapphire: 3, ruby: 2, diamond: 2 }, 'sapphire', 4, 2),
    _mkCard(3, i++, { ruby: 3, diamond: 2, onyx: 2 }, 'ruby', 4, 2),
    _mkCard(3, i++, { diamond: 3, onyx: 2, emerald: 2 }, 'diamond', 4, 2),
    _mkCard(3, i++, { onyx: 3, emerald: 2, sapphire: 2 }, 'onyx', 4, 2),
    /* 3X+3Y+2Z+1W 系列，声望5、王冠2（5张）】 */
    _mkCard(3, i++, { emerald: 3, sapphire: 3, ruby: 2, diamond: 1 }, 'emerald', 5, 2),
    _mkCard(3, i++, { sapphire: 3, ruby: 3, diamond: 2, onyx: 1 }, 'sapphire', 5, 2),
    _mkCard(3, i++, { ruby: 3, diamond: 3, onyx: 2, emerald: 1 }, 'ruby', 5, 2),
    _mkCard(3, i++, { diamond: 3, onyx: 3, emerald: 2, sapphire: 1 }, 'diamond', 5, 2),
    _mkCard(3, i++, { onyx: 3, emerald: 3, sapphire: 2, ruby: 1 }, 'onyx', 5, 2),
    /* 3X+2Y+2Z+1珍珠 系列，声望5、王冠3（2张）】 */
    _mkCard(3, i++, { emerald: 3, sapphire: 2, ruby: 2, pearl: 1 }, 'emerald', 5, 3),
    _mkCard(3, i++, { ruby: 3, diamond: 2, onyx: 2, pearl: 1 }, 'ruby', 5, 3),
  ];
  return shuffle(cards);
}

/* 能力已静态写入牌表，无需随机分配 */
function assignAbilities(cards) { /* no-op */ }

function buildRoyalties() {
  const pool = [
    { id: 'roy0', prestige: 3, ability: 'take_privilege' },
    { id: 'roy1', prestige: 3, ability: 'steal_token' },
    { id: 'roy2', prestige: 3, ability: 'take_matching' },
  ];
  return shuffle(pool);
}

/* ============================================================ */
/* 购买与费用 */
/* ============================================================ */

function canAffordCard(playerCards, playerTokens, card) {
  const bonuses = colorCounts(playerCards);
  let goldNeed = 0;
  for (const col of ALL_COLORS) {
    const need = card.cost[col] || 0;
    const have = (playerTokens[col] || 0) + (bonuses[col] || 0);
    if (have < need) goldNeed += need - have;
  }
  return goldNeed <= (playerTokens[GOLD] || 0);
}

function payForCard(playerCards, playerTokens, bag) {
  const bonuses = colorCounts(playerCards);
  for (const col of ALL_COLORS) {
    const need = playerTokens._tempCost[col] || 0;
    const haveTok = playerTokens[col] || 0;
    const bonus = bonuses[col] || 0;
    const fromTok = Math.min(haveTok, Math.max(0, need - bonus));
    if (fromTok > 0) { playerTokens[col] -= fromTok; bag.push(col); }
  }
  // gold
  const goldNeed = playerTokens._tempGold || 0;
  if (goldNeed > 0) { playerTokens[GOLD] -= goldNeed; bag.push(GOLD); }
  delete playerTokens._tempCost;
  delete playerTokens._tempGold;
}

/* 计算某张卡的实际花费（含 discount），同时记录在花费用什么支付 */
function computePayment(playerCards, playerTokens, card) {
  const bonuses = colorCounts(playerCards);
  const tempCost = {};
  let goldNeed = 0;
  for (const col of ALL_COLORS) {
    const need = card.cost[col] || 0;
    const bonus = bonuses[col] || 0;
    const deficit = Math.max(0, need - bonus);
    tempCost[col] = deficit;
    const haveTok = playerTokens[col] || 0;
    if (haveTok < deficit) goldNeed += deficit - haveTok;
  }
  return { tempCost, goldNeed };
}

/* ============================================================ */
/* 特权 */
/* ============================================================ */

function gainPrivilege(game, playerId) {
  const p = game.playerData[playerId];
  if (p.privileges >= PRIVILEGE_MAX) return;
  if (game.availablePrivileges > 0) {
    game.availablePrivileges--;
    p.privileges++;
  } else {
    const opp = getOpponentId(game, playerId);
    if (opp) {
      const oppP = game.playerData[opp];
      if (oppP.privileges > 0) { oppP.privileges--; p.privileges++; }
    }
  }
}

/* ============================================================ */
/* 版图操作 */
/* ============================================================ */

function fillBoardFromBag(game) {
  // 从中央格开始螺旋填充
  const emptyCells = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (game.board[r][c] === null) emptyCells.push([r, c]);
    }
  }
  if (!emptyCells.length || !game.bag.length) return;
  // shuffle bag
  game.bag = shuffle(game.bag);
  for (const [r, c] of SPIRAL) {
    if (game.board[r][c] === null && game.bag.length > 0) {
      game.board[r][c] = game.bag.shift();
    }
  }
}

function validateTokenCells(board, cells) {
  if (!cells || cells.length < 1 || cells.length > 3) return false;
  for (const [r, c] of cells) {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    if (board[r][c] === null) return false;
  }
  if (cells.length === 1) return true;

  const sameRow = cells.every(([r, c]) => r === cells[0][0]);
  const sameCol = cells.every(([r, c]) => c === cells[0][1]);
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

/* ============================================================ */
/* 王室卡牌 */
/* ============================================================ */

function checkRoyaltyTrigger(game, playerId) {
  const p = game.playerData[playerId];
  if (!p) return;
  const thresholds = [3, 6];
  for (const th of thresholds) {
    if (p.crowns >= th && !p.royaltyTriggersReceived.includes(th)) {
      p.royaltyTriggersReceived.push(th);
      const available = game.royalties.filter((r) => !r.claimedBy);
      if (available.length > 0) {
        const roy = available[0];
        roy.claimedBy = playerId;
        p.cards.push({ ...roy, isRoyalty: true });
        p.prestige += roy.prestige;
        resolveCardAbility(game, playerId, roy);
      }
    }
  }
}

/* ============================================================ */
/* 卡牌能力结算 */
/* ============================================================ */

function resolveCardAbility(game, playerId, card) {
  if (!card.ability) return;
  const p = game.playerData[playerId];
  const opp = getOpponentId(game, playerId);
  switch (card.ability) {
    case 'extra_turn':
      game.extraTurnFlag = true;
      break;
    case 'take_matching': {
      const col = card.discount;
      if (!col) break;
      let taken = false;
      for (let r = 0; r < BOARD_SIZE && !taken; r++) {
        for (let c = 0; c < BOARD_SIZE && !taken; c++) {
          if (game.board[r][c] === col) {
            game.board[r][c] = null;
            p.tokens[col] = (p.tokens[col] || 0) + 1;
            taken = true;
          }
        }
      }
      break;
    }
    case 'take_privilege':
      gainPrivilege(game, playerId);
      break;
    case 'steal_token': {
      if (!opp) break;
      const oppP = game.playerData[opp];
      const stealable = [];
      for (const col of ALL_COLORS) {
        if ((oppP.tokens[col] || 0) > 0) stealable.push(col);
      }
      if (stealable.length > 0) {
        const col = stealable[Math.floor(Math.random() * stealable.length)];
        oppP.tokens[col]--;
        p.tokens[col] = (p.tokens[col] || 0) + 1;
      }
      break;
    }
    default: break;
  }
}

/* ============================================================ */
/* 胜利条件 */
/* ============================================================ */

function checkWin(game, playerId) {
  const p = game.playerData[playerId];
  if (!p) return null;
  if (p.prestige >= WIN_PRESTIGE) return 'prestige';
  if (p.crowns >= WIN_CROWNS) return 'crowns';
  // 同色卡牌声望≥10
  const colorPrestige = {};
  for (const c of p.cards) {
    if (!c.isNoble && !c.isRoyalty && c.discount) {
      colorPrestige[c.discount] = (colorPrestige[c.discount] || 0) + (c.prestige || 0);
    }
  }
  for (const sum of Object.values(colorPrestige)) {
    if (sum >= WIN_COLOR_PRESTIGE) return 'color_prestige';
  }
  return null;
}

function endTurn(game, actingPlayerId) {
  // 检查是否需要弃标记
  const p = game.playerData[actingPlayerId];
  const handTotal = totalTokens(p.tokens);
  if (handTotal > HAND_LIMIT) {
    game.phase = 'discard';
    game.discardPlayerId = actingPlayerId;
    game.discardNeed = handTotal - HAND_LIMIT;
    return { ok: true, state: publicGameState(game, actingPlayerId) };
  }

  // 胜利检查
  const winCond = checkWin(game, actingPlayerId);
  if (winCond) {
    game.over = true;
    game.phase = 'over';
    game.winnerId = actingPlayerId;
    game.winCondition = winCond;
    return { ok: true, state: publicGameState(game, actingPlayerId) };
  }

  // 额外回合？
  if (game.extraTurnFlag) {
    game.extraTurnFlag = false;
    _resetTurnFlags(game);
    game.currentPlayerId = actingPlayerId;
    return { ok: true, state: publicGameState(game, actingPlayerId) };
  }

  // 正常切换
  _resetTurnFlags(game);
  game.turnIndex = (game.turnIndex + 1) % game.turnOrder.length;
  game.currentPlayerId = game.turnOrder[game.turnIndex];
  return { ok: true, state: publicGameState(game, actingPlayerId) };
}

function _resetTurnFlags(game) {
  game.optPrivilegeDone = false;
  game.optReplenishDone = false;
  game.extraTurnFlag = false;
}

/* ============================================================ */
/* 创建游戏状态 */
/* ============================================================ */

function createBoardFromBag(bag) {
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  // 从中央格开始按螺旋顺序依次放置 bag 中的 token
  for (let i = 0; i < SPIRAL.length && i < 25 && bag.length > 0; i++) {
    const [r, c] = SPIRAL[i];
    board[r][c] = bag.shift();
  }
  return board;
}

function createGameState(room) {
  const players = room.players.slice(0, 2);
  const turnOrder = players.map((p) => p.id);

  // Token 池
  const bag = [];
  for (const col of RESOURCES) for (let i = 0; i < 5; i++) bag.push(col);
  for (let i = 0; i < 3; i++) bag.push('pearl');
  for (let i = 0; i < 3; i++) bag.push(GOLD);
  // 33 个 token，25 放版图，8 留 bag
  const shuffledBag = shuffle(bag);
  const board = createBoardFromBag(shuffledBag);

  const decks = { tier1: buildTier1(), tier2: buildTier2(), tier3: buildTier3() };
  assignAbilities(decks.tier1);
  assignAbilities(decks.tier2);
  assignAbilities(decks.tier3);

  const boardCards = {
    tier1: decks.tier1.splice(0, 3),
    tier2: decks.tier2.splice(0, 3),
    tier3: decks.tier3.splice(0, 3),
  };

  const royalties = buildRoyalties();

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

  // 随机先手，对手拿1特权
  const firstIdx = Math.floor(Math.random() * turnOrder.length);
  const firstPlayer = turnOrder[firstIdx];
  const secondPlayer = turnOrder[(firstIdx + 1) % turnOrder.length];
  playerData[secondPlayer].privileges = 1;

  return {
    type: 'splendor-duel',
    turnOrder,
    turnIndex: firstIdx,
    currentPlayerId: firstPlayer,
    phase: 'play',
    discardPlayerId: null,
    discardNeed: 0,
    optPrivilegeDone: false,
    optReplenishDone: false,
    extraTurnFlag: false,
    board,
    bag: shuffledBag,
    decks,
    boardCards,
    royalties,
    availablePrivileges: TOTAL_PRIVILEGES - 1, // 1 已给先手对手
    playerData,
    lastAction: null,
    winnerId: null,
    winCondition: null,
    over: false,
    startedAt: Date.now(),
  };
}

/* ============================================================ */
/* 操作路由 */
/* ============================================================ */

function applyAction(game, playerId, action) {
  if (!game || game.over) return { ok: false, error: game ? 'Game over' : 'Not started' };
  const type = action && action.type;
  const payload = action.payload || {};

  // 弃标记阶段
  if (game.phase === 'discard') {
    if (playerId !== game.discardPlayerId) return { ok: false, error: 'Not your turn to discard' };
    if (type !== 'discard_tokens') return { ok: false, error: 'Please discard tokens' };
    return _handleDiscard(game, playerId, payload);
  }

  // 正常回合
  if (playerId !== game.currentPlayerId) return { ok: false, error: 'Not your turn' };

  if (game.phase !== 'play') return { ok: false, error: 'Invalid phase' };

  // 可选行动
  if (type === 'use_privilege') {
    if (game.optPrivilegeDone) return { ok: false, error: 'Privilege already used this turn' };
    return _handleUsePrivilege(game, playerId, payload);
  }
  if (type === 'replenish') {
    if (game.optReplenishDone) return { ok: false, error: 'Replenish already used this turn' };
    return _handleReplenish(game, playerId);
  }

  // 强制行动
  if (type === 'take_tokens') return _handleTakeTokens(game, playerId, payload);
  if (type === 'reserve_card') return _handleReserve(game, playerId, payload);
  if (type === 'buy_card') return _handleBuyCard(game, playerId, payload);

  return { ok: false, error: 'Invalid action' };
}

/* ============================================================ */
/* 可选：使用特权 */
/* ============================================================ */

function _handleUsePrivilege(game, playerId, payload) {
  const p = game.playerData[playerId];
  const count = Math.max(1, Math.min(p.privileges, Number(payload.count) || 1));
  const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];

  if (count > p.privileges) return { ok: false, error: 'Not enough privileges' };
  if (tokens.length !== count) return { ok: false, error: `Select ${count} tokens` };

  // 验证每个 token 在版图上且不是金
  for (const [r, c] of tokens) {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return { ok: false, error: 'Invalid token position' };
    if (game.board[r][c] === null) return { ok: false, error: 'No token there' };
    if (game.board[r][c] === GOLD) return { ok: false, error: 'Cannot take gold with privilege' };
  }

  // 执行
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
/* 可选：补充版图 */
/* ============================================================ */

function _handleReplenish(game, playerId) {
  if (game.bag.length === 0) return { ok: false, error: 'Bag is empty' };

  fillBoardFromBag(game);
  game.optReplenishDone = true;

  // 对手拿1特权
  const opp = getOpponentId(game, playerId);
  if (opp) gainPrivilege(game, opp);

  game.lastAction = { type: 'replenish', playerId };
  return { ok: true, state: publicGameState(game, playerId) };
}

/* ============================================================ */
/* 强制：拿标记 */
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

  // 统计同色
  const colorFreq = {};
  for (const col of colors) colorFreq[col] = (colorFreq[col] || 0) + 1;
  const maxSame = Math.max(0, ...Object.values(colorFreq));

  // 拿3同色或2珍珠 → 对手拿1特权
  if (maxSame >= 3 || pearlCount >= 2) {
    const opp = getOpponentId(game, playerId);
    if (opp) gainPrivilege(game, opp);
  }

  game.lastAction = { type: 'take_tokens', playerId, cells: cells.map(([r, c]) => [r, c]), colors };
  return _endTurnAfterMandatory(game, playerId);
}

/* ============================================================ */
/* 强制：预留 */
/* ============================================================ */

function _handleReserve(game, playerId, payload) {
  const p = game.playerData[playerId];
  if (p.reserved.length >= RESERVE_LIMIT) return { ok: false, error: 'Reserve limit reached' };

  // 检查版图上是否有金
  let goldOnBoard = false;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (game.board[r][c] === GOLD) { goldOnBoard = true; break; }
    }
    if (goldOnBoard) break;
  }
  if (!goldOnBoard) return { ok: false, error: 'No gold token on board' };

  const tier = payload.tier;
  const idx = payload.idx;
  const fromDeck = payload.fromDeck === true;
  const key = `tier${tier}`;
  let card = null;

  if (fromDeck) {
    if (![1, 2, 3].includes(tier) || !game.decks[key] || game.decks[key].length === 0) return { ok: false, error: 'Deck empty' };
    card = game.decks[key].shift();
  } else {
    if (![1, 2, 3].includes(tier) || idx < 0 || idx >= (game.boardCards[key] || []).length) return { ok: false, error: 'Invalid card' };
    card = game.boardCards[key][idx];
    game.boardCards[key].splice(idx, 1);
    if (game.decks[key].length > 0) game.boardCards[key].push(game.decks[key].shift());
  }
  if (!card) return { ok: false, error: 'Card not found' };

  p.reserved.push(card);

  // 拿1金（从版图上最近的）
  let goldTaken = false;
  for (let r = 0; r < BOARD_SIZE && !goldTaken; r++) {
    for (let c = 0; c < BOARD_SIZE && !goldTaken; c++) {
      if (game.board[r][c] === GOLD) {
        game.board[r][c] = null;
        p.tokens[GOLD] = (p.tokens[GOLD] || 0) + 1;
        goldTaken = true;
      }
    }
  }

  game.lastAction = { type: 'reserve_card', playerId, cardId: card.id, tier: card.tier };
  return _endTurnAfterMandatory(game, playerId);
}

/* ============================================================ */
/* 强制：买卡 */
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
    if (![1, 2, 3].includes(tier) || idx < 0 || idx >= (game.boardCards[key] || []).length) return { ok: false, error: 'Invalid card' };
    card = game.boardCards[key][idx];
    source = 'board';
  }

  if (!card) return { ok: false, error: 'Card not found' };
  if (!canAffordCard(p.cards, p.tokens, card)) return { ok: false, error: 'Cannot afford' };

  // 计算并执行付款
  const { tempCost, goldNeed } = computePayment(p.cards, p.tokens, card);
  p._tempCost = tempCost;
  p._tempGold = goldNeed;
  payForCard(p.cards, p.tokens, game.bag);

  if (source === 'board') {
    const key = `tier${tier}`;
    game.boardCards[key].splice(idx, 1);
    if (game.decks[key].length > 0) game.boardCards[key].push(game.decks[key].shift());
  } else {
    p.reserved.splice(reserveIdx, 1);
  }

  p.cards.push(card);
  p.prestige += card.prestige || 0;
  p.crowns += card.crowns || 0;

  // 王室触发
  checkRoyaltyTrigger(game, playerId);

  // 卡牌能力
  resolveCardAbility(game, playerId, card);

  game.lastAction = { type: 'buy_card', playerId, cardId: card.id, source, tier: card.tier };
  return _endTurnAfterMandatory(game, playerId);
}

/* ============================================================ */
/* 强制行动后处理 */
/* ============================================================ */

function _endTurnAfterMandatory(game, actingPlayerId) {
  game.optPrivilegeDone = true;
  game.optReplenishDone = true;
  return endTurn(game, actingPlayerId);
}

/* ============================================================ */
/* 弃标记 */
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

  // 弃完后检查胜利
  const winCond = checkWin(game, playerId);
  if (winCond) {
    game.over = true;
    game.phase = 'over';
    game.winnerId = playerId;
    game.winCondition = winCond;
    return { ok: true, state: publicGameState(game, playerId) };
  }

  if (game.extraTurnFlag) {
    game.extraTurnFlag = false;
    _resetTurnFlags(game);
    game.currentPlayerId = playerId;
    return { ok: true, state: publicGameState(game, playerId) };
  }

  _resetTurnFlags(game);
  game.turnIndex = (game.turnIndex + 1) % game.turnOrder.length;
  game.currentPlayerId = game.turnOrder[game.turnIndex];
  return { ok: true, state: publicGameState(game, playerId) };
}

/* ============================================================ */
/* 公共状态 */
/* ============================================================ */

function publicGameState(game, viewerId) {
  if (!game) return null;
  const publicPlayers = {};
  for (const pid of game.turnOrder) {
    const p = game.playerData[pid];
    publicPlayers[pid] = {
      tokenCounts: { ...p.tokens },
      reserved: pid === viewerId ? p.reserved.map((c) => ({ ...c })) : p.reserved.map((c) => ({ id: c.id, tier: c.tier })),
      cardCount: p.cards.filter((c) => !c.isNoble && !c.isRoyalty).length,
      bonusCounts: colorCounts(p.cards),
      prestige: p.prestige,
      crowns: p.crowns,
      privileges: p.privileges,
      nobleCount: p.cards.filter((c) => c.isNoble || c.isRoyalty).length,
    };
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
/* 超时处理 */
/* ============================================================ */

function forceTimeout(game, playerId) {
  if (!game || game.over) return { ok: false, error: 'Game over' };

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
    _resetTurnFlags(game);
    game.turnIndex = (game.turnIndex + 1) % game.turnOrder.length;
    game.currentPlayerId = game.turnOrder[game.turnIndex];
    return { ok: true, state: publicGameState(game, playerId) };
  }

  if (playerId !== game.currentPlayerId) return { ok: false, error: 'Not your turn' };

  // 超时默认：从版图上拿1个可用的标记
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (game.board[r][c] !== null && game.board[r][c] !== GOLD) {
        return _handleTakeTokens(game, playerId, { cells: [[r, c]] });
      }
    }
  }
  // 完全没可拿的，跳过
  game.lastAction = { type: 'pass', playerId };
  return _endTurnAfterMandatory(game, playerId);
}

module.exports = {
  createGameState,
  applyAction,
  publicGameState,
  getActingPlayerIds,
  onPlayerQuit,
  forceTimeout,
};
