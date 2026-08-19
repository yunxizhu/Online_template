'use strict';

const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

function createEmptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
}

function createGameState(room) {
  const players = room.players.slice(0, 2);
  const blackId = players[0].id;
  const whiteId = players[1].id;

  return {
    type: 'gomoku',
    size: SIZE,
    board: createEmptyBoard(),
    turnOrder: [blackId, whiteId],
    turnIndex: 0,
    currentPlayerId: blackId,
    turnNumber: 1,
    stones: {
      [blackId]: BLACK,
      [whiteId]: WHITE,
    },
    colors: {
      [BLACK]: blackId,
      [WHITE]: whiteId,
    },
    lastMove: null,
    winnerId: null,
    winLine: null,
    draw: false,
    over: false,
  };
}

function getStone(game, playerId) {
  return game.stones[playerId] || null;
}

function countDirection(board, x, y, dx, dy, stone) {
  let n = 0;
  let cx = x + dx;
  let cy = y + dy;
  while (
    cx >= 0 &&
    cx < SIZE &&
    cy >= 0 &&
    cy < SIZE &&
    board[cy][cx] === stone
  ) {
    n += 1;
    cx += dx;
    cy += dy;
  }
  return n;
}

function collectLine(board, x, y, dx, dy, stone) {
  const cells = [{ x, y }];
  let cx = x + dx;
  let cy = y + dy;
  while (
    cx >= 0 &&
    cx < SIZE &&
    cy >= 0 &&
    cy < SIZE &&
    board[cy][cx] === stone
  ) {
    cells.push({ x: cx, y: cy });
    cx += dx;
    cy += dy;
  }
  cx = x - dx;
  cy = y - dy;
  while (
    cx >= 0 &&
    cx < SIZE &&
    cy >= 0 &&
    cy < SIZE &&
    board[cy][cx] === stone
  ) {
    cells.unshift({ x: cx, y: cy });
    cx -= dx;
    cy -= dy;
  }
  return cells;
}

function findWinLine(board, x, y, stone) {
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (const [dx, dy] of dirs) {
    const forward = countDirection(board, x, y, dx, dy, stone);
    const backward = countDirection(board, x, y, -dx, -dy, stone);
    if (forward + backward + 1 >= 5) {
      return collectLine(board, x, y, dx, dy, stone);
    }
  }
  return null;
}

function isBoardFull(board) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] === EMPTY) return false;
    }
  }
  return true;
}

function applyAction(game, playerId, action) {
  if (!game) return { ok: false, error: '对局未开始' };
  if (game.over) return { ok: false, error: '对局已结束' };
  if (playerId !== game.currentPlayerId) {
    return { ok: false, error: '还没轮到你' };
  }

  const type = action && action.type;
  if (type !== 'place') {
    return { ok: false, error: '无效操作' };
  }

  const payload = action.payload || {};
  const x = Number(payload.x);
  const y = Number(payload.y);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
    return { ok: false, error: '落点无效' };
  }
  if (game.board[y][x] !== EMPTY) {
    return { ok: false, error: '此处已有棋子' };
  }

  const stone = getStone(game, playerId);
  if (!stone) return { ok: false, error: '你不是对局玩家' };

  game.board[y][x] = stone;
  game.lastMove = { x, y, playerId, stone };

  const winLine = findWinLine(game.board, x, y, stone);
  if (winLine) {
    game.over = true;
    game.winnerId = playerId;
    game.winLine = winLine;
    return { ok: true, state: publicGameState(game) };
  }

  if (isBoardFull(game.board)) {
    game.over = true;
    game.draw = true;
    return { ok: true, state: publicGameState(game) };
  }

  game.turnIndex = (game.turnIndex + 1) % game.turnOrder.length;
  game.currentPlayerId = game.turnOrder[game.turnIndex];
  game.turnNumber += 1;

  return { ok: true, state: publicGameState(game) };
}

function publicGameState(game, _viewerId) {
  if (!game) return null;
  return {
    type: 'gomoku',
    size: game.size,
    board: game.board.map((row) => row.slice()),
    turnOrder: game.turnOrder.slice(),
    turnIndex: game.turnIndex,
    currentPlayerId: game.currentPlayerId,
    turnNumber: game.turnNumber,
    stones: { ...game.stones },
    lastMove: game.lastMove,
    winnerId: game.winnerId,
    winLine: game.winLine ? game.winLine.map((c) => ({ ...c })) : null,
    draw: game.draw,
    over: game.over,
  };
}

function getActingPlayerIds(game) {
  if (!game || game.over) return [];
  return game.currentPlayerId ? [game.currentPlayerId] : [];
}

/** 主动退出：对手直接获胜 */
function onPlayerQuit(game, playerId) {
  if (!game || game.over) return;
  const rest = (game.turnOrder || []).filter((id) => id !== playerId);
  if (rest.length !== 1) return;
  game.over = true;
  game.winnerId = rest[0];
  game.winLine = null;
  game.draw = false;
}

function forceTimeout(game, playerId) {
  if (!game || game.over || playerId !== game.currentPlayerId) {
    return { ok: false, error: '无需操作' };
  }
  const cx = Math.floor(SIZE / 2);
  const cy = Math.floor(SIZE / 2);
  let best = null;
  let bestD = Infinity;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (game.board[y][x] !== EMPTY) continue;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  if (!best) return { ok: false, error: '无空位' };
  return applyAction(game, playerId, { type: 'place', payload: best });
}

module.exports = {
  id: 'gomoku',
  label: '五子棋',
  minPlayers: 2,
  maxPlayers: 2,
  client: {
    styles: ['/games/gomoku/style.css'],
    scripts: ['/games/gomoku/board.js'],
    panel: '/games/gomoku/panel.html',
  },
  createGameState,
  applyAction,
  publicGameState,
  getActingPlayerIds,
  onPlayerQuit,
  forceTimeout,
};
