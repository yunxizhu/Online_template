'use strict';
// 单局时间线诊断：node server/games/warfactory/smoke/_t.js [seed] [秒] [nn|ab|ba]
const mod = require('..');
const { createGameState, setPlayerInput, __test } = mod;
const NEW = require('../bot.js');
const OLD = require('./_base.js');
const { resetRandom } = require('./_det.js');

const seed = Number(process.argv[2] || 100);
const MAX_SECONDS = Number(process.argv[3] || 2400);
const MODE = String(process.argv[4] || 'nn'); // nn=双新 ab=P0新/P1旧 ba=P0旧/P1新
const SEATS = MODE === 'ab' ? [NEW, OLD] : MODE === 'ba' ? [OLD, NEW] : [NEW, NEW];
const DT = 0.1;
const THINK_MS = 700;

resetRandom(seed);
// ⚠️ room.id 会参与地形种子（hashStr），必须和 _ab.js 一字不差，否则跑的不是同一张图
const room = {
  id: 'wfbot_ab_' + seed + '_' + (MODE === 'ba' ? 'b' : 'a'),
  players: [
    { id: 'p0', name: 'P0', isBot: true, botDifficulty: 'hard' },
    { id: 'p1', name: 'P1', isBot: true, botDifficulty: 'hard' },
  ],
  mapSeed: seed,
  theme: 'classic',
};
const game = createGameState(room);
room.game = game;
let now = 1000;
game.phase = 'playing';
game.phaseEndsAt = 0;
game._lastTick = now;
const st = [{}, {}];
const nextAt = [0, 0];

console.log(
  `seed=${seed} 厂=${game.factories.length} 所=${game.labs.length} 总部=${game.hqs.map((h) => `${h.x | 0},${h.y | 0}`).join(' ')}`
);

let nextLog = 0;
for (let s = 0; s < Math.round(MAX_SECONDS / DT) && !game.over; s++) {
  now += DT * 1000;
  for (let i = 0; i < 2; i++) {
    if (now < nextAt[i]) continue;
    nextAt[i] = now + THINK_MS + (i === 0 ? 40 : 120);
    let cmds = null;
    try {
      cmds = SEATS[i].think(game, game.players[i].id, 'hard', st[i], now);
    } catch (e) {
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
  const t = (now - 1000) / 1000;
  if (t >= nextLog) {
    nextLog += 150;
    const rows = game.players.map((p, i) => {
      const us = game.units.filter((u) => !u.dead && u.ownerIdx === i);
      const fac = game.factories.filter((f) => f.owner === i).length;
      const lab = game.labs.filter((l) => l.owner === i).length;
      const lines =
        game.factories.filter((f) => f.owner === i).reduce((a, f) => a + (f.lines || 1), 0) +
        (game.hqs[i] ? (game.hqs[i].lines || 1) : 0);
      // 部队分布：敌方总部 1300 内 / 我方半场
      const foeHq = game.hqs.find((h) => h.owner !== i && !h.down) || { x: -9e9, y: -9e9 };
      const near = us.filter((u) => Math.hypot(u.x - foeHq.x, u.y - foeHq.y) <= 1400).length;
      const tier = us.reduce((a, u) => a + (u.tier || 1), 0) / Math.max(1, us.length);
      const stx = st[i].stance || '-';
      const tg = st[i].target ? st[i].target.kind + ':' + st[i].target.id : '-';
      return `P${i} 兵${String(us.length).padStart(3)}(近${String(near).padStart(3)} 阶${tier.toFixed(1)}) 厂${fac} 所${lab} 线${lines} rp${Math.round(p.rp || 0)} 总${Math.round(game.hqs[i].hp)} [${stx}→${tg}]`;
    });
    console.log(`t=${String(Math.round(t)).padStart(4)}s | ${rows.join(' | ')} | 中立厂${game.factories.filter((f) => f.owner === -1).length} 所${game.labs.filter((l) => l.owner === -1).length}`);
  }
}
const t = (now - 1000) / 1000;
console.log(`\n结束 t=${t.toFixed(0)}s over=${game.over} winner=${game.winnerId} hq=${game.hqs.map((h) => Math.round(h.hp)).join('/')}`);
console.log('stance', st.map((s) => s.stance).join(','), 'target', st.map((s) => (s.target ? s.target.kind + ':' + s.target.id : '-')).join(','));

for (let i = 0; i < 2; i++) {
  const hq = game.hqs[i];
  const us = game.units.filter((u) => !u.dead && u.ownerIdx === i);
  const ds = us.map((u) => Math.round(Math.hypot(u.x - hq.x, u.y - hq.y))).sort((a, b) => a - b);
  const mid = ds.length ? ds[Math.floor(ds.length / 2)] : -1;
  const far = ds.length ? ds[ds.length - 1] : -1;
  const types = {};
  for (const u of us) types[u.type] = (types[u.type] || 0) + 1;
  const man = us.filter((u) => u.manualTarget).length;
  const mv = us.filter((u) => u.moveX != null).length;
  const stuck = us.filter((u) => u._dbgDx != null).length;
  console.log(
    'P' + i + ' 离自家总部 中位' + mid + ' 最远' + far + ' 有移动目标' + mv + ' 有锁定' + man +
      ' 兵种' + JSON.stringify(types) + ' 卡住' + stuck
  );
}
