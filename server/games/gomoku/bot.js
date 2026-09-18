'use strict';

/**
 * 五子棋 AI（Bot）
 *
 * 棋力核心（经典启发式，参考 lihongxun945/gobang 与常见棋型表）：
 * - 落点棋型识别：连五 / 活四 / 冲四 / 活三 / 眠三 / 活二
 * - 组合威胁：双活三、冲四活三、双冲四（压迫感主要来源）
 * - 必应层：成五 > 挡五 > 活四/双三 > 挡活四/双三
 * - 再做 α-β 搜索（按难度加深，并裁剪候选）
 *
 * 难度：
 * - easy：浅层贪心 + 少量随机（仍保证挡五/成五）
 * - normal：深度 4
 * - hard：深度 6（压迫感最强）
 *
 * 对外：decideBotAction(game, playerId, difficulty) → { type, payload } | null
 */

const BOARD_SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const OPPONENT = { [BLACK]: WHITE, [WHITE]: BLACK };

const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** 棋型分值（量级拉开，活四/双三接近必胜） */
const S = {
  FIVE: 10000000,
  FOUR: 1000000,
  THREE_THREE: 1000000,
  FOUR_THREE: 1000000,
  FOUR_FOUR: 2000000,
  BLOCK_FOUR: 100000,
  THREE: 10000,
  BLOCK_THREE: 1000,
  TWO: 100,
  BLOCK_TWO: 10,
  ONE: 1,
};

const DIFFICULTY = {
  easy: { depth: 1, candidates: 8, randomPick: 3, defense: 1.05, timeMs: 0 },
  normal: { depth: 4, candidates: 12, randomPick: 0, defense: 1.15, timeMs: 280 },
  hard: { depth: 6, candidates: 14, randomPick: 0, defense: 1.3, timeMs: 700 },
};

function inBounds(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function checkWin(board, row, col, player) {
  for (const [dr, dc] of DIRS) {
    let count = 1;
    for (let s = 1; s < 5; s++) {
      const r = row + dr * s;
      const c = col + dc * s;
      if (!inBounds(r, c) || board[r][c] !== player) break;
      count += 1;
    }
    for (let s = 1; s < 5; s++) {
      const r = row - dr * s;
      const c = col - dc * s;
      if (!inBounds(r, c) || board[r][c] !== player) break;
      count += 1;
    }
    if (count >= 5) return true;
  }
  return false;
}

function getNearbyCells(board, radius = 2) {
  const occupied = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== EMPTY) occupied.push([r, c]);
    }
  }
  if (occupied.length === 0) {
    const mid = Math.floor(BOARD_SIZE / 2);
    return [[mid, mid]];
  }
  const set = new Set();
  for (const [sr, sc] of occupied) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const nr = sr + dr;
        const nc = sc + dc;
        if (inBounds(nr, nc) && board[nr][nc] === EMPTY) {
          set.add(nr * BOARD_SIZE + nc);
        }
      }
    }
  }
  return [...set].map((k) => [Math.floor(k / BOARD_SIZE), k % BOARD_SIZE]);
}

/**
 * 单方向棋型：以 (row,col) 已落子为中心，统计连子与两端空位。
 * 同时识别「跳三」类：一侧空一子再连（如 XX_X）。
 */
function shapeOnDirection(board, row, col, dr, dc, player) {
  const opponent = OPPONENT[player];

  let left = 0;
  let right = 0;
  let leftBlock = false;
  let rightBlock = false;

  // 连续段
  for (let i = 1; i < 5; i++) {
    const r = row - dr * i;
    const c = col - dc * i;
    if (!inBounds(r, c) || board[r][c] === opponent) {
      leftBlock = true;
      break;
    }
    if (board[r][c] === EMPTY) break;
    if (board[r][c] === player) left += 1;
  }
  for (let i = 1; i < 5; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    if (!inBounds(r, c) || board[r][c] === opponent) {
      rightBlock = true;
      break;
    }
    if (board[r][c] === EMPTY) break;
    if (board[r][c] === player) right += 1;
  }

  const count = left + right + 1;
  const leftEmpty = !leftBlock && inBounds(row - dr * (left + 1), col - dc * (left + 1))
    && board[row - dr * (left + 1)][col - dc * (left + 1)] === EMPTY;
  const rightEmpty = !rightBlock && inBounds(row + dr * (right + 1), col + dc * (right + 1))
    && board[row + dr * (right + 1)][col + dc * (right + 1)] === EMPTY;
  const open = (leftEmpty ? 1 : 0) + (rightEmpty ? 1 : 0);

  if (count >= 5) return 'FIVE';
  if (count === 4) {
    if (open === 2) return 'FOUR';
    if (open === 1) return 'BLOCK_FOUR';
    return 'NONE';
  }
  if (count === 3) {
    if (open === 2) return 'THREE';
    if (open === 1) return 'BLOCK_THREE';
    return 'NONE';
  }
  if (count === 2) {
    if (open === 2) return 'TWO';
    if (open === 1) return 'BLOCK_TWO';
    return 'NONE';
  }

  // 跳活三 / 冲四：XX_X / X_XX（中间一空）
  const jump = detectJumpShape(board, row, col, dr, dc, player);
  if (jump) return jump;

  if (count === 1 && open === 2) return 'ONE';
  return 'NONE';
}

function detectJumpShape(board, row, col, dr, dc, player) {
  const opponent = OPPONENT[player];
  // 构建长度为 9 的窗口，中心为落点
  const cells = [];
  for (let i = -4; i <= 4; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    if (!inBounds(r, c)) cells.push(2);
    else if (board[r][c] === player) cells.push(1);
    else if (board[r][c] === opponent) cells.push(2);
    else cells.push(0);
  }
  const s = cells.join('');
  // 活四
  if (/011110/.test(s)) return 'FOUR';
  // 冲四（含跳）
  if (
    /211110|011112|10111|11011|11101|211101|211011|210111|101112|110112|111012/.test(
      s
    )
  ) {
    return 'BLOCK_FOUR';
  }
  // 活三（含跳）
  if (/01110|011010|010110/.test(s)) return 'THREE';
  // 眠三
  if (/21110|01112|211010|010112|210110|011012/.test(s)) return 'BLOCK_THREE';
  return null;
}

function scoreOfShape(shape) {
  switch (shape) {
    case 'FIVE':
      return S.FIVE;
    case 'FOUR':
      return S.FOUR;
    case 'BLOCK_FOUR':
      return S.BLOCK_FOUR;
    case 'THREE':
      return S.THREE;
    case 'BLOCK_THREE':
      return S.BLOCK_THREE;
    case 'TWO':
      return S.TWO;
    case 'BLOCK_TWO':
      return S.BLOCK_TWO;
    case 'ONE':
      return S.ONE;
    default:
      return 0;
  }
}

/**
 * 评估在 (row,col) 落子后对 player 的威胁价值（含组合棋型加成）
 * 调用前格子须为空；函数内临时落子再还原。
 */
function evaluatePoint(board, row, col, player) {
  board[row][col] = player;
  const shapes = [];
  for (const [dr, dc] of DIRS) {
    shapes.push(shapeOnDirection(board, row, col, dr, dc, player));
  }
  board[row][col] = EMPTY;

  let fours = 0;
  let blockFours = 0;
  let threes = 0;
  let blockThrees = 0;
  let twos = 0;
  let score = 0;

  for (const sh of shapes) {
    score += scoreOfShape(sh);
    if (sh === 'FIVE') return S.FIVE;
    if (sh === 'FOUR') fours += 1;
    else if (sh === 'BLOCK_FOUR') blockFours += 1;
    else if (sh === 'THREE') threes += 1;
    else if (sh === 'BLOCK_THREE') blockThrees += 1;
    else if (sh === 'TWO') twos += 1;
  }

  // 组合威胁：这才是压迫感
  if (fours >= 2) return S.FOUR_FOUR;
  if (fours >= 1 && threes >= 1) return S.FOUR_THREE;
  if (blockFours >= 2) return S.FOUR_FOUR;
  if (blockFours >= 1 && threes >= 1) return S.FOUR_THREE;
  if (threes >= 2) return S.THREE_THREE;
  if (fours >= 1) return S.FOUR;
  if (blockFours >= 1) return Math.max(score, S.BLOCK_FOUR);
  if (threes >= 1) return Math.max(score, S.THREE);

  // 双活二也有一定发展潜力
  if (twos >= 2) score += S.TWO * 3;
  if (blockThrees >= 2) score += S.BLOCK_THREE;

  return score;
}

/** 攻防综合分：己方价值 + 防守对方价值 */
function moveScore(board, row, col, player, defense) {
  const attack = evaluatePoint(board, row, col, player);
  const defend = evaluatePoint(board, row, col, OPPONENT[player]);
  return attack + defend * defense;
}

function pickTacticalMove(board, moves, player) {
  let bestFive = null;
  let bestBlockFive = null;
  let bestFour = null;
  let bestBlockFour = null;
  let bestThreeThree = null;
  let bestBlockTT = null;

  for (const [r, c] of moves) {
    const atk = evaluatePoint(board, r, c, player);
    const def = evaluatePoint(board, r, c, OPPONENT[player]);
    if (atk >= S.FIVE) bestFive = [r, c];
    if (def >= S.FIVE) bestBlockFive = [r, c];
    if (atk >= S.FOUR) bestFour = [r, c];
    if (def >= S.FOUR) bestBlockFour = [r, c];
    if (atk >= S.THREE_THREE) bestThreeThree = [r, c];
    if (def >= S.THREE_THREE) bestBlockTT = [r, c];
  }

  if (bestFive) return bestFive;
  if (bestBlockFive) return bestBlockFive;
  if (bestFour) return bestFour;
  if (bestThreeThree) return bestThreeThree;
  if (bestBlockFour) return bestBlockFour;
  if (bestBlockTT) return bestBlockTT;
  return null;
}

function rankCandidates(board, moves, player, defense, limit) {
  const scored = moves.map(([r, c]) => ({
    move: [r, c],
    score: moveScore(board, r, c, player, defense),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.move);
}

function evaluateBoard(board, player, defense) {
  const moves = getNearbyCells(board, 2);
  if (moves.length === 0) return 0;
  let myBest = 0;
  let oppBest = 0;
  const opp = OPPONENT[player];
  for (const [r, c] of moves) {
    myBest = Math.max(myBest, evaluatePoint(board, r, c, player));
    oppBest = Math.max(oppBest, evaluatePoint(board, r, c, opp));
  }
  // 己方已有棋型也计入一点「盘面势能」：扫描邻近点攻防差
  let sum = 0;
  const top = Math.min(moves.length, 16);
  const ranked = rankCandidates(board, moves, player, defense, top);
  for (const [r, c] of ranked) {
    sum += moveScore(board, r, c, player, defense) * 0.01;
  }
  return myBest - oppBest * defense + sum;
}

function minimax(board, depth, isMax, player, alpha, beta, defense, candLimit, deadline) {
  if (deadline && Date.now() >= deadline) {
    return evaluateBoard(board, player, defense);
  }
  if (depth === 0) {
    return evaluateBoard(board, player, defense);
  }

  const moves = getNearbyCells(board, 2);
  if (moves.length === 0) return 0;

  const side = isMax ? player : OPPONENT[player];
  // 越深候选越少，把算力留给主变化
  const limit = depth >= 4 ? candLimit : Math.max(6, Math.floor(candLimit * 0.7));
  const sorted = rankCandidates(board, moves, side, defense, limit);

  for (const [r, c] of sorted) {
    const s = evaluatePoint(board, r, c, side);
    if (s >= S.FIVE) {
      return isMax ? S.FIVE + depth : -(S.FIVE + depth);
    }
  }

  if (isMax) {
    let best = -Infinity;
    for (const [r, c] of sorted) {
      board[r][c] = player;
      let score;
      if (checkWin(board, r, c, player)) {
        score = S.FIVE + depth;
      } else {
        score = minimax(
          board,
          depth - 1,
          false,
          player,
          alpha,
          beta,
          defense,
          candLimit,
          deadline
        );
      }
      board[r][c] = EMPTY;
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
      if (deadline && Date.now() >= deadline) break;
    }
    return best;
  }

  const opponent = OPPONENT[player];
  let best = Infinity;
  for (const [r, c] of sorted) {
    board[r][c] = opponent;
    let score;
    if (checkWin(board, r, c, opponent)) {
      score = -(S.FIVE + depth);
    } else {
      score = minimax(
        board,
        depth - 1,
        true,
        player,
        alpha,
        beta,
        defense,
        candLimit,
        deadline
      );
    }
    board[r][c] = EMPTY;
    best = Math.min(best, score);
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
    if (deadline && Date.now() >= deadline) break;
  }
  return best;
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

/**
 * @param {number[][]} board board[y][x]
 * @param {1|2} player
 * @param {'easy'|'normal'|'hard'} difficulty
 * @returns {[number, number]} [row, col]
 */
function getAIMove(board, player, difficulty = 'hard') {
  const key = String(difficulty || 'normal').toLowerCase();
  const cfg = DIFFICULTY[key] || DIFFICULTY.normal;
  const work = cloneBoard(board);
  const moves = getNearbyCells(work, 2);

  if (moves.length === 0) {
    const mid = Math.floor(BOARD_SIZE / 2);
    return [mid, mid];
  }
  if (moves.length === 1) return moves[0];

  // 1) 战术必应：成五/挡五/活四/双三
  const tactical = pickTacticalMove(work, moves, player);
  if (tactical) return tactical;

  // 2) 候选排序
  const candidates = rankCandidates(work, moves, player, cfg.defense, cfg.candidates);

  // easy：在高分候选里随机，避免完全乱下但仍弱
  if (cfg.depth <= 1 || cfg.randomPick > 0) {
    const pool = candidates.slice(0, Math.max(1, cfg.randomPick || 1));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // 3) 迭代加深 α-β（时限内尽量搜深）
  let bestMove = candidates[0];
  const deadline = cfg.timeMs > 0 ? Date.now() + cfg.timeMs : 0;
  const deepLimit = Math.max(6, Math.floor(cfg.candidates * 0.75));

  for (let depth = 2; depth <= cfg.depth; depth += 2) {
    let bestScore = -Infinity;
    let moveAtDepth = bestMove;
    let aborted = false;

    for (const [r, c] of candidates) {
      if (deadline && Date.now() >= deadline) {
        aborted = true;
        break;
      }
      work[r][c] = player;
      let score;
      if (checkWin(work, r, c, player)) {
        score = S.FIVE;
      } else {
        score = minimax(
          work,
          depth - 1,
          false,
          player,
          -Infinity,
          Infinity,
          cfg.defense,
          deepLimit,
          deadline || null
        );
      }
      work[r][c] = EMPTY;
      score += evaluatePoint(work, r, c, player) * 0.000001;
      if (score > bestScore) {
        bestScore = score;
        moveAtDepth = [r, c];
      }
      if (bestScore >= S.FIVE) break;
    }

    if (!aborted) bestMove = moveAtDepth;
    if (aborted) break;
    if (bestScore >= S.FIVE) {
      bestMove = moveAtDepth;
      break;
    }
  }
  return bestMove;
}

function decideBotAction(game, playerId, difficulty) {
  if (!game || game.over) return null;
  if (playerId !== game.currentPlayerId) return null;

  const stone = game.stones && game.stones[playerId];
  if (stone !== BLACK && stone !== WHITE) return null;
  if (!Array.isArray(game.board) || game.board.length !== BOARD_SIZE) return null;

  const [row, col] = getAIMove(game.board, stone, difficulty);
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    !inBounds(row, col) ||
    game.board[row][col] !== EMPTY
  ) {
    return null;
  }

  return { type: 'place', payload: { x: col, y: row } };
}

module.exports = {
  decideBotAction,
  getAIMove,
  evaluatePoint,
  S,
};
