'use strict';

const { createGameState, applyAction } = require('..');

const room = {
  players: [
    { id: 'p1', name: '黑' },
    { id: 'p2', name: '白' },
  ],
};

const game = createGameState(room);

function place(pid, x, y) {
  const r = applyAction(game, pid, { type: 'place', payload: { x, y } });
  if (!r.ok) throw new Error(r.error + ` @${x},${y} by ${pid}`);
  return r.state;
}

// Black builds horizontal five on row 7: (3,7)(4,7)(5,7)(6,7)(7,7)
// with white intervening elsewhere
place('p1', 3, 7);
place('p2', 0, 0);
place('p1', 4, 7);
place('p2', 0, 1);
place('p1', 5, 7);
place('p2', 0, 2);
place('p1', 6, 7);
place('p2', 0, 3);
const end = place('p1', 7, 7);

if (!end.over || end.winnerId !== 'p1') {
  console.error('expected black win', end);
  process.exit(1);
}
if (!end.winLine || end.winLine.length < 5) {
  console.error('expected winLine', end.winLine);
  process.exit(1);
}

const blocked = applyAction(game, 'p2', { type: 'place', payload: { x: 1, y: 1 } });
if (blocked.ok) {
  console.error('should reject moves after game over');
  process.exit(1);
}

console.log('GOMOKU RULES OK');
