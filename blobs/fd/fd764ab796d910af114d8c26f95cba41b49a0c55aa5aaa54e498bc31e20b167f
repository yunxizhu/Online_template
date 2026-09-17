'use strict';

const sgs = require('..');

const room = {
  players: [
    { id: 'p1', name: 'P1' },
    { id: 'p2', name: 'P2' },
    { id: 'p3', name: 'P3' },
    { id: 'p4', name: 'P4' },
    { id: 'p5', name: 'P5' },
  ],
};

const game = sgs.createGameState(room);
if (game.players.filter((p) => p.identity === 'zhu').length !== 1) {
  throw new Error('need 1 lord');
}
if (game.players[0].identity !== 'zhu') {
  throw new Error('lord should be seat 0');
}

const zhuId = game.players[0].id;
if ((game.generalChoices[zhuId] || []).length !== 5) {
  throw new Error('lord should have 5 general choices');
}

// 主公先选
{
  const choices = game.generalChoices[zhuId];
  const r = sgs.applyAction(game, zhuId, {
    type: 'select_general',
    payload: { generalId: choices[0] },
  });
  if (!r.ok) throw new Error(r.error);
}

for (const p of game.players) {
  if (p.generalId) continue;
  const choices = game.generalChoices[p.id];
  if (!choices || choices.length !== 3) {
    throw new Error('others should have 3 general choices');
  }
  const r = sgs.applyAction(game, p.id, {
    type: 'select_general',
    payload: { generalId: choices[0] },
  });
  if (!r.ok) throw new Error(r.error);
}

if (game.phase !== 'playing') throw new Error('should be playing');
const zhu = game.players[0];
if (zhu.maxHp !== require('../generals').getGeneral(zhu.generalId).maxHp + 1) {
  throw new Error('lord hp +1 failed');
}

const view = sgs.publicGameState(game, 'p2');
const lordView = view.players.find((p) => p.seat === 0);
if (!lordView || lordView.identity !== 'zhu') {
  throw new Error('lord should be visible as 主公');
}
const selfView = view.players.find((p) => p.id === 'p2');
if (selfView.identity == null) {
  throw new Error('self identity visible');
}
const other = view.players.find((p) => p.id !== 'p2' && p.seat !== 0);
if (other && other.identity !== null) {
  if (other.identityLabel !== '？') throw new Error('should hide identity');
}

console.log('SGS IDENTITY BOOTSTRAP OK', {
  phase: game.phase,
  turn: game.turnPlayerId || game.turnSeat,
  hands: game.players.map((p) => p.hand.length),
});
