'use strict';

/**
 * 五子棋 AI（Bot）
 *
 * 算法来源：[Carbon-Gomoku](https://github.com/gomoku/Carbon-Gomoku)
 * （Michał Czardybon，JS 移植自 AICarbon，使用原 STATUS/PRIOR/CONFIG 启发式表）
 *
 * 难度通过搜索时间 / 深度区分：
 * - easy：固定深度 2
 * - normal / hard / hardplus / hell：迭代加深 + 时限递增
 *
 * 对外：decideBotAction(game, playerId, difficulty) → { type, payload } | null
 */

const { findMove } = require('./carbon-js/engine');

const BOARD_SIZE = 15;
const BLACK = 1;
const WHITE = 2;

const DIFFICULTY = {
  easy: { depth: 2, timeMs: 2500 },
  normal: { depth: 0, timeMs: 2500 },
  hard: { depth: 0, timeMs: 3000 },
  hardplus: { depth: 0, timeMs: 3500 },
  hell: { depth: 0, timeMs: 4000 },
};

/**
 * @param {number[][]} board board[y][x] 0空 1黑 2白
 * @param {1|2} player
 * @param {string} difficulty
 * @returns {[number, number]} [row, col]
 */
function getAIMove(board, player, difficulty = 'hard') {
  const key = String(difficulty || 'normal').toLowerCase();
  const cfg = DIFFICULTY[key] || DIFFICULTY.normal;
  const move = findMove(board, player, {
    depth: cfg.depth || 0,
    timeMs: cfg.timeMs || 0,
    difficulty: key,
  });
  if (!move || !Number.isInteger(move.x) || !Number.isInteger(move.y)) {
    const mid = Math.floor(BOARD_SIZE / 2);
    return [mid, mid];
  }
  return [move.y, move.x];
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
    row < 0 ||
    col < 0 ||
    row >= BOARD_SIZE ||
    col >= BOARD_SIZE ||
    game.board[row][col] !== 0
  ) {
    return null;
  }

  return { type: 'place', payload: { x: col, y: row } };
}

module.exports = {
  decideBotAction,
  getAIMove,
};
