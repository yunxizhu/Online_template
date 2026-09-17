'use strict';

const sgs = require('..');

const room = {
  gameMode: '1v2',
  players: [
    { id: 'a', name: '甲' },
    { id: 'b', name: '乙' },
    { id: 'c', name: '丙' },
  ],
};

const game = sgs.createGameState(room);
if (game.phase !== 'bid_lord') throw new Error('bid phase');

// a bids 1, b pass, c pass → a is lord
let r = sgs.applyAction(game, 'a', { type: 'bid_lord', payload: { value: 1 } });
if (!r.ok) throw new Error(r.error);
r = sgs.applyAction(game, 'b', { type: 'bid_lord', payload: { value: 0 } });
if (!r.ok) throw new Error(r.error);
r = sgs.applyAction(game, 'c', { type: 'bid_lord', payload: { value: 0 } });
if (!r.ok) throw new Error(r.error);

if (game.phase !== 'select_general') throw new Error('should select');
const lord = game.players.find((p) => p.identity === 'zhu');
if (!lord || lord.seat !== 0) throw new Error('lord seat 0');
if (lord.id !== 'a') throw new Error('a should be lord');
if (game.generalChoices[lord.id].length !== 5) throw new Error('lord 5 choices');
const fans = game.players.filter((p) => p.identity === 'fan');
if (fans.length !== 2) throw new Error('2 rebels');
for (const f of fans) {
  if (game.generalChoices[f.id].length !== 3) throw new Error('rebel 3');
}

for (const p of game.players) {
  const choices = game.generalChoices[p.id];
  r = sgs.applyAction(game, p.id, {
    type: 'select_general',
    payload: { generalId: choices[0] },
  });
  if (!r.ok) throw new Error(r.error);
}

if (game.phase !== 'playing') throw new Error('playing');
if (lord.maxHp !== require('../generals').getGeneral(lord.generalId).maxHp + 1) {
  throw new Error('lord +1 hp');
}

// 跋扈: lord should have drawn 1 at prepare + 2 at draw = start 4 + 3 = 7 on first turn
if (lord.hand.length !== 7) {
  console.log('lord hand', lord.hand.length);
  throw new Error('expected 7 cards after bahu first turn');
}

const view = sgs.publicGameState(game, lord.id);
if (!view.lordSkills || view.lordSkills.length !== 2) {
  throw new Error('lord skills visible');
}

console.log('SGS 1V2 OK', {
  lord: lord.name,
  hp: lord.hp + '/' + lord.maxHp,
  hands: game.players.map((p) => p.identity + ':' + p.hand.length),
});
