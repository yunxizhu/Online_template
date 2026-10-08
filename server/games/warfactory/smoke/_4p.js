'use strict';
// 4 人局冒烟：node server/games/warfactory/smoke/_4p.js [seed] [秒]
const mod = require('..');
const BOT = require('../bot.js');
const { resetRandom } = require('./_det.js');
const { createGameState, setPlayerInput, __test } = mod;
const seed = Number(process.argv[2] || 200);
const MAX = Number(process.argv[3] || 1200);
const DT = 0.1;
resetRandom(seed);
const room = {
  id: 'wf4p_' + seed,
  players: [0, 1, 2, 3].map((i) => ({
    id: 'p' + i,
    name: 'P' + i,
    isBot: true,
    botDifficulty: 'hard',
  })),
  mapSeed: seed,
  theme: 'classic',
};
const game = createGameState(room);
room.game = game;
let now = 1000;
game.phase = 'playing';
game.phaseEndsAt = 0;
game._lastTick = now;
const st = [{}, {}, {}, {}];
const nextAt = [0, 0, 0, 0];
let errs = 0;
for (let s = 0; s < Math.round(MAX / DT) && !game.over; s++) {
  now += DT * 1000;
  for (let i = 0; i < 4; i++) {
    if (now < nextAt[i]) continue;
    nextAt[i] = now + 700 + i * 40;
    let cmds = null;
    try {
      cmds = BOT.think(game, game.players[i].id, 'hard', st[i], now);
    } catch (e) {
      errs += 1;
      console.error('think failed', e && e.message);
      continue;
    }
    if (!Array.isArray(cmds)) continue;
    for (const c of cmds) {
      try {
        setPlayerInput(game, game.players[i].id, c, now);
      } catch (_) {}
    }
  }
  __test.step(game, DT, now);
}
const rows = game.players.map(function (p, i) {
  const us = game.units.filter(function (u) {
    return !u.dead && u.ownerIdx === i;
  }).length;
  const fac = game.factories.filter(function (f) {
    return f.owner === i;
  }).length;
  const lab = game.labs.filter(function (l) {
    return l.owner === i;
  }).length;
  return 'P' + i + ':兵' + us + '/厂' + fac + '/所' + lab + '/总' + Math.round(game.hqs[i].hp);
});
console.log(
  'seed=' + seed + ' t=' + ((now - 1000) / 1000).toFixed(0) + 's over=' + game.over +
    ' err=' + errs + ' ' + rows.join(' ')
);
