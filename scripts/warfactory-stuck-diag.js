'use strict';

/**
 * 卡死诊断：node scripts/warfactory-stuck-diag.js [种子]
 * 先跑 300 秒 bot，挑出「有移动指令却原地不动」的部队，把它周围 11×11 格的
 * 地形 / 高度 / 通行掩码 / 流场 dist 打出来，看它到底被什么圈住。
 */

const mod = require('../server/games/warfactory/index.js');
const BOT = require('../server/games/warfactory/bot.js');
const { createGameState, setPlayerInput, __test } = mod;
const { resetRandom } = require('../server/games/warfactory/smoke/_det.js');

const SEED = Number(process.argv[2] || 101);
const DT = 0.1;
resetRandom(SEED);
const room = {
  id: 'sd_' + SEED,
  players: [
    { id: 'p0', name: 'P0', isBot: true },
    { id: 'p1', name: 'P1', isBot: true },
  ],
  mapSeed: SEED,
};
const game = createGameState(room);
room.game = game;
let now = 1000;
game.phase = 'playing';
game.phaseEndsAt = 0;
const st = [{}, {}];
const nextAt = [0, 0];
for (let s = 0; s < 3000 && !game.over; s++) {
  now += DT * 1000;
  for (let i = 0; i < 2; i++) {
    if (now < nextAt[i]) continue;
    nextAt[i] = now + 700;
    const cmds = BOT.think(game, game.players[i].id, 'hard', st[i], now);
    if (!Array.isArray(cmds)) continue;
    for (const c of cmds) setPlayerInput(game, game.players[i].id, c, now);
  }
  __test.step(game, DT, now);
}

const t = game.terrain;
const pg = __test.passGrid(game);
const C = t.cols;
const h = t.heights;

// 整队下令去远处，再看谁不动
{
  const cb = __test.compLabels(game);
  const army = game.units.filter((u) => !u.dead && u.ownerIdx === 0);
  const compOf = (x, y) => {
    const c = Math.min(t.cols - 1, Math.max(0, Math.floor(x / t.cell)));
    const r = Math.min(t.rows - 1, Math.max(0, Math.floor(y / t.cell)));
    let l = cb.lab[r * t.cols + c];
    if (l < 0) {
      for (let ring = 1; ring <= 6 && l < 0; ring++) {
        for (let dr = -ring; dr <= ring && l < 0; dr++) {
          for (let dc = -ring; dc <= ring && l < 0; dc++) {
            const rr = r + dr;
            const cc2 = c + dc;
            if (rr < 0 || rr >= t.rows || cc2 < 0 || cc2 >= t.cols) continue;
            if (pg[rr * t.cols + cc2]) l = cb.lab[rr * t.cols + cc2];
          }
        }
      }
    }
    return l;
  };
  const cnt = {};
  for (const u of army) cnt[compOf(u.x, u.y)] = (cnt[compOf(u.x, u.y)] || 0) + 1;
  const mainK = Number(Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]);
  const grp = army.filter((u) => compOf(u.x, u.y) === mainK);
  const ax = grp.reduce((a, u) => a + u.x, 0) / grp.length;
  const ay = grp.reduce((a, u) => a + u.y, 0) / grp.length;
  let dst = null;
  let bd = Infinity;
  for (let r = 2; r < t.rows - 2; r += 2) {
    for (let c = 2; c < t.cols - 2; c += 2) {
      const i = r * t.cols + c;
      if (!pg[i] || cb.lab[i] !== mainK) continue;
      const d = Math.hypot((c + 0.5) * t.cell - ax, (r + 0.5) * t.cell - ay);
      if (d < 2500 || d >= bd) continue;
      bd = d;
      dst = { x: (c + 0.5) * t.cell, y: (r + 0.5) * t.cell };
    }
  }
  if (dst) {
    setPlayerInput(game, 'p0', { cmd: 'move', x: dst.x, y: dst.y, ids: grp.map((u) => u.id) }, now);
    for (let s = 0; s < 100; s++) {
      now += DT * 1000;
      __test.step(game, DT, now);
    }
  }
}

// 找「有 move 指令但 5 秒内位移 < 30px」的部队
const watch = game.units.filter((u) => !u.dead && u.moveX != null);
const p0 = watch.map((u) => ({ u, x: u.x, y: u.y }));
for (let s = 0; s < 50; s++) {
  now += DT * 1000;
  __test.step(game, DT, now);
}
console.log(`种子 ${SEED}：带移动指令的部队 ${watch.length} 支`);
for (const e of p0) {
  const u = e.u;
  if (u.dead) continue;
  const moved = Math.hypot(u.x - e.x, u.y - e.y);
  if (moved > 30 || u.moveX == null) continue; // moveX 已被清空 = 已到达，不算卡住
  const cc = Math.floor(u.x / t.cell);
  const cr = Math.floor(u.y / t.cell);
  console.log(`\n卡住 ${u.type}#${u.id} 位置 (${Math.round(u.x)},${Math.round(u.y)}) 格 (${cc},${cr}) 层 ${h[cr * C + cc]} 掩码 ${pg[cr * C + cc]} 5s 位移 ${moved.toFixed(1)}px`);
  console.log(`  指令点 (${Math.round(u.moveX)},${Math.round(u.moveY)})，距离 ${Math.round(Math.hypot(u.x - u.moveX, u.y - u.moveY))}px`);
  const f = __test.flowField(game, u.moveX, u.moveY, u.x, u.y);
  for (let dr = -4; dr <= 4; dr++) {
    let row = '';
    for (let dc = -4; dc <= 4; dc++) {
      const r = cr + dr;
      const c = cc + dc;
      if (r < 0 || r >= t.rows || c < 0 || c >= C) { row += '  .  '; continue; }
      const i = r * C + c;
      const d = f ? f.dist[i] : -2;
      row += `${t.grid[r][c]}${h[i] >= 0 ? '+' : ''}${h[i]}${pg[i] ? '' : '#'}/${d < 0 ? '--' : String(d).padStart(2, ' ')} `;
    }
    console.log('   ' + row);
  }
  console.log('   格内容：地形 0平/2山/4水 · 层 · #=掩码不可通行 · /=流场步数');
  // 附近的建筑
  const near = [];
  for (const b of [...game.factories, ...game.labs, ...game.hqs]) {
    const d = Math.hypot(b.x - u.x, b.y - u.y);
    const r = b === game.hqs[0] ? __test.consts.HQ_R : 0;
    if (d < 400) near.push(`${b.kind || 'b'}(${Math.round(b.x)},${Math.round(b.y)}) ${Math.round(d)}px`);
  }
  if (near.length) console.log('   附近建筑：' + near.join(' , '));
  if (process.env.WF_STEP) {
    const f2 = __test.flowField(game, u.moveX, u.moveY, u.x, u.y);
    for (let k = 0; k < 12; k++) {
      const bx = u.x;
      const by = u.y;
      now += DT * 1000;
      __test.step(game, DT, now);
      const c2 = __test.cellOf(game, u.x, u.y);
      console.log(
        `    step${k} Δ${Math.hypot(u.x - bx, u.y - by).toFixed(2)} → (${u.x.toFixed(1)},${u.y.toFixed(1)}) 格(${c2.c},${c2.r}) d=${f2 ? f2.dist[c2.i] : '-'}`
      );
    }
  }
}
