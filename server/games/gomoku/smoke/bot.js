'use strict';

const { createGameState, applyAction, decideBotAction } = require('..');
const { getAIMove, evaluatePoint, S } = require('../bot');

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
}

function emptyBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(0));
}

// 挡冲四/活四：黑 3-6 横四，白必须挡 2 或 7
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

// 自己能成五优先
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

// 双活三威胁点应被高分识别
{
  const board = emptyBoard();
  // 构造：在 (7,7) 落白可同时形成两个方向的活三倾向
  // 横向：6,7 和 8 空 → 需要更多子
  board[7][5] = 2;
  board[7][6] = 2;
  board[5][7] = 2;
  board[6][7] = 2;
  // (7,7) 横向是活三，纵向是活三 → 双活三
  const score = evaluatePoint(board, 7, 7, 2);
  if (score < S.THREE_THREE) {
    console.error('expected THREE_THREE at (7,7)', score);
    process.exit(1);
  }
  const [r, c] = getAIMove(board, 2, 'hard');
  if (!(r === 7 && c === 7)) {
    console.error('hard should play double-three point', { r, c, score });
    process.exit(1);
  }
}

// 对方双活三要挡
{
  const board = emptyBoard();
  board[7][5] = 1;
  board[7][6] = 1;
  board[5][7] = 1;
  board[6][7] = 1;
  board[0][0] = 2;
  const [r, c] = getAIMove(board, 2, 'hard');
  if (!(r === 7 && c === 7)) {
    console.error('hard should block double-three', { r, c });
    process.exit(1);
  }
}

// easy 合法
{
  const board = emptyBoard();
  board[7][7] = 1;
  const [r, c] = getAIMove(board, 2, 'easy');
  if (board[r][c] !== 0) {
    console.error('easy illegal', { r, c });
    process.exit(1);
  }
}

console.log('GOMOKU BOT OK');
