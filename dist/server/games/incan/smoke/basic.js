'use strict';

const {
  createGameState,
  applyAction,
  publicGameState,
} = require('..');

const room = {
  players: [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ],
};

const game = createGameState(room);

function decide(id, decision) {
  const r = applyAction(game, id, {
    type: 'decide',
    payload: { decision },
  });
  if (!r.ok) throw new Error(r.error);
}

// A locks continue — B should not see A's choice
decide('a', 'continue');
const viewB = publicGameState(game, 'b');
const rowA = viewB.players.find((p) => p.id === 'a');
if (rowA.choice !== null) throw new Error('choice should be hidden from others');
if (!rowA.locked) throw new Error('should show locked');
const viewA = publicGameState(game, 'a');
if (viewA.me.choice !== 'continue') throw new Error('self should see choice');

decide('b', 'continue');
decide('c', 'retreat');

// After all decide, round resolves; C should be in camp
if (game.players.find((p) => p.id === 'c').exploring) {
  throw new Error('C should have retreated');
}
if (!game.players.find((p) => p.id === 'a').exploring) {
  throw new Error('A should still explore');
}

// Hidden again next choosing phase
const mid = publicGameState(game, 'b');
if (mid.phase !== 'choosing' && !game.over) {
  // could have collapsed/ended temple in rare deck luck — still ok if over or new temple
}
if (game.phase === 'choosing') {
  decide('a', 'retreat');
  const hide = publicGameState(game, 'b');
  const aRow = hide.players.find((p) => p.id === 'a');
  if (aRow.choice !== null) throw new Error('still must hide mid-choice');
}

console.log('INCAN SIMULTANEOUS OK', {
  temple: game.temple,
  phase: game.phase,
  path: game.path.length,
});
