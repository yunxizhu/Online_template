'use strict';

const { createGameState, applyAction, decideBotAction } = require('..');
const { getAIMove } = require('../bot');

const room = {
  players: [
    { id: 'human', name: '人' },
    { id: 'bot', name: '电脑', isBot: true, botDifficulty: 'hard' },
  ],
};

const game = createGameState(room);

applyAction(game, 'human', { type: 'place', payload: { x: 7, y: 7 } });
const first = decideBotAction(game, 'bot', 'hard');
if (!first || first.type !== 'place') {
  console.error('expected bot place action', first);
  process.exit(1);
}
{
  const r = applyAction(game, 'bot', first);
  if (!r.ok) {
    console.error('bot first move invalid', first, r.error);
    process.exit(1);
  }
  const d = Math.max(
    Math.abs(first.payload.y - 7),
    Math.abs(first.payload.x - 7)
  );
  if (d > 2) {
    console.error('opening move too far', first);
    process.exit(1);
  }
}

function emptyBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(0));
}

// 挡冲四
{
  const board = emptyBoard();
  board[7][3] = 1;
  board[7][4] = 1;
  board[7][5] = 1;
  board[7][6] = 1;
  board[0][0] = 2;
  const [r, c] = getAIMove(board, 2, 'hard');
  if (!(r === 7 && (c === 2 || c === 7))) {
    console.error('hard should block open four', { r, c });
    process.exit(1);
  }
}

// 自己成五
{
  const board = emptyBoard();
  board[7][3] = 2;
  board[7][4] = 2;
  board[7][5] = 2;
  board[7][6] = 2;
  board[0][0] = 1;
  const [r, c] = getAIMove(board, 2, 'hard');
  if (!(r === 7 && (c === 2 || c === 7))) {
    console.error('hard should take five', { r, c });
    process.exit(1);
  }
}

// hell 合法贴子
{
  const board = emptyBoard();
  board[7][7] = 1;
  const [r, c] = getAIMove(board, 2, 'hell');
  if (board[r][c] !== 0) {
    console.error('hell illegal', { r, c });
    process.exit(1);
  }
  const d = Math.max(Math.abs(r - 7), Math.abs(c - 7));
  if (d > 2) {
    console.error('hell opening too far', { r, c, d });
    process.exit(1);
  }
}

console.log('GOMOKU BOT OK (Carbon)');
