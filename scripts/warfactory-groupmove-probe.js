'use strict';

/**
 * 群队行军体检：node scripts/warfactory-groupmove-probe.js [种子]
 *
 * 先让 bot 打 300 秒攒出部队，再整队下令去一个远处可达点，看多少人真能走到。
 * 重点看「流场预算」是不是把大多数人挤成了直线撞墙。
 */

const mod = require('../server/games/warfactory/index.js');
const BOT = require('../server/games/warfactory/bot.js');
const { createGameState, setPlayerInput, __test } = mod;
const { resetRandom } = require('../server/games/warfactory/smoke/_det.js');

const SEED = Number(process.argv[2] || 100);
const DT = 0.1;
const THINK_MS = 700;

resetRandom(SEED);
const room = {
  id: 'gm_' + SEED,
  players: [
    { id: 'p0', name: 'P0', isBot: true, botDifficulty: 'hard' },
    { id: 'p1', name: 'P1', isBot: true, botDifficulty: 'hard' },
  ],
  mapSeed: SEED,
  theme: 'classic',
};
const game = createGameState(room);
room.game = game;
let now = 1000;
game.phase = 'playing';
game.phaseEndsAt = 0;

const st = [{}, {}];
const nextAt = [0, 0];
function run(seconds, useBot) {
  const steps = Math.round(seconds / DT);
  for (let s = 0; s < steps && !game.over; s++) {
    now += DT * 1000;
    if (useBot) {
      for (let i = 0; i < 2; i++) {
        if (now < nextAt[i]) continue;
        nextAt[i] = now + THINK_MS;
        const cmds = BOT.think(game, game.players[i].id, 'hard', st[i], now);
        if (!Array.isArray(cmds)) continue;
        for (const c of cmds) setPlayerInput(game, game.players[i].id, c, now);
      }
    }
    __test.step(game, DT, now);
  }
}

run(300, true);

const t = game.terrain;
console.log(`种子 ${SEED} 主题 ${t.theme && t.theme.name}：p0 ${game.units.filter((u) => !u.dead && u.ownerIdx === 0).length} 兵 / p1 ${game.units.filter((u) => !u.dead && u.ownerIdx === 1).length} 兵`);

// 找一个与 p0 部队同分量、且至少 2500px 远的落点
const cb = __test.compLabels(game);
const pg = __test.passGrid(game);
const army0 = game.units.filter((u) => !u.dead && u.ownerIdx === 0);
if (!army0.length) {
  console.log('p0 没兵了，换种子');
  process.exit(0);
}
const compOf = (x, y) => {
  const c = Math.min(t.cols - 1, Math.max(0, Math.floor(x / t.cell)));
  const r = Math.min(t.rows - 1, Math.max(0, Math.floor(y / t.cell)));
  let l = cb.lab[r * t.cols + c];
  if (l < 0) {
    for (let ring = 1; ring <= 6 && l < 0; ring++) {
      for (let dr = -ring; dr <= ring && l < 0; dr++) {
        for (let dc = -ring; dc <= ring && l < 0; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= t.rows || cc < 0 || cc >= t.cols) continue;
          if (pg[rr * t.cols + cc]) l = cb.lab[rr * t.cols + cc];
        }
      }
    }
  }
  return l;
};
const compCount = {};
for (const u of army0) {
  const l = compOf(u.x, u.y);
  compCount[l] = (compCount[l] || 0) + 1;
}
const mainComp = Number(Object.entries(compCount).sort((a, b) => b[1] - a[1])[0][0]);
const group = army0.filter((u) => compOf(u.x, u.y) === mainComp);
const cxA = group.reduce((a, u) => a + u.x, 0) / group.length;
const cyA = group.reduce((a, u) => a + u.y, 0) / group.length;

let dst = null;
let bestD = Infinity;
for (let r = 2; r < t.rows - 2; r += 2) {
  for (let c = 2; c < t.cols - 2; c += 2) {
    const i = r * t.cols + c;
    if (!pg[i] || cb.lab[i] !== mainComp) continue;
    const px = (c + 0.5) * t.cell;
    const py = (r + 0.5) * t.cell;
    const d = Math.hypot(px - cxA, py - cyA);
    if (d < 2500 || d >= bestD) continue;
    bestD = d;
    dst = { x: px, y: py };
  }
}
console.log(`目标点 (${Math.round(dst.x)},${Math.round(dst.y)})，直线 ${Math.round(bestD)}px，队伍 ${group.length} 人`);
{
  const f0 = __test.flowField(game, dst.x, dst.y, cxA, cyA);
  const sc = Math.floor(cxA / t.cell);
  const sr = Math.floor(cyA / t.cell);
  const steps = f0 ? f0.dist[sr * t.cols + sc] : -1;
  console.log(`  流场最短里程 ${steps} 格 = ${steps * t.cell}px（直线 ${Math.round(bestD)}px，绕行系数 ${(steps * t.cell / bestD).toFixed(2)}）`);
}

// 下令
const ids = group.map((u) => u.id);
setPlayerInput(game, 'p0', { cmd: 'move', x: dst.x, y: dst.y, ids }, now);
const start = group.map((u) => ({ u, d0: Math.hypot(u.x - dst.x, u.y - dst.y), walked: 0, px: u.x, py: u.y, tArrive: 0, sx: u.x, sy: u.y, traj: [] }));

const SEC = Number(process.argv[3] || 150);
let flowBuilds = 0;
for (let s = 0; s < Math.round(SEC / DT); s++) {
  now += DT * 1000;
  const before = game._flowCache ? game._flowCache.size : 0;
  __test.step(game, DT, now);
  if (game._flowCache && game._flowCache.size > before) flowBuilds += game._flowCache.size - before;
  for (const e of start) {
    if (e.u.dead) continue;
    e.walked += Math.hypot(e.u.x - e.px, e.u.y - e.py);
    e.px = e.u.x;
    e.py = e.u.y;
    if (!e.tArrive && Math.hypot(e.u.x - dst.x, e.u.y - dst.y) < 60) e.tArrive = (s + 1) * DT;
    if (!e.tArrive && s % 40 === 0) e.traj.push([e.u.x, e.u.y, Math.round(Math.hypot(e.u.x - dst.x, e.u.y - dst.y))]);
  }
}

let arrived = 0;
const bad = [];
for (const e of start) {
  if (e.u.dead) continue;
  const d1 = Math.hypot(e.u.x - dst.x, e.u.y - dst.y);
  if (d1 < 60) arrived++;
  else bad.push({ t: e.u.type, d0: Math.round(e.d0), d1: Math.round(d1), prog: Math.round((1 - d1 / e.d0) * 100), walked: Math.round(e.walked) });
}
console.log(`${SEC}s 后到达 ${arrived}/${start.length}（新建流场 ${flowBuilds} 次）`);
console.log(`  stepViaFlow：走流场 ${game._dbgFlow || 0} 次 / 退回直线 ${game._dbgDirect || 0} 次（其中邻格全不可达 ${game._dbgNoNbr || 0} 次）`);
for (const s of game._dbgSamples || []) console.log('   样本', JSON.stringify(s));
const times = start.filter((e) => e.tArrive).map((e) => e.tArrive).sort((a, b) => a - b);
if (times.length) {
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`  到达耗时：最快 ${times[0].toFixed(1)}s / 中位 ${times[Math.floor(times.length / 2)].toFixed(1)}s / 最慢 ${times[times.length - 1].toFixed(1)}s（直线里程 ${Math.round(bestD)}px，理论约 ${(bestD / 105).toFixed(0)}s）`);
}
const eff = start.filter((e) => e.tArrive).map((e) => e.d0 / e.walked);
if (eff.length) console.log(`  路径效率（直线/实走）：平均 ${(eff.reduce((a, b) => a + b, 0) / eff.length).toFixed(2)}`);
const byT = {};
for (const b of bad) {
  byT[b.t] = byT[b.t] || [];
  byT[b.t].push(b);
}
for (const k of Object.keys(byT)) {
  const a = byT[k];
  console.log(`  未达 ${k} ×${a.length}：平均推进 ${Math.round(a.reduce((x, y) => x + y.prog, 0) / a.length)}%、平均走了 ${Math.round(a.reduce((x, y) => x + y.walked, 0) / a.length)}px`);
}
if (process.env.WF_TRACE) {
  for (const e of start) {
    if (e.u.dead || e.tArrive) continue;
    console.log(`  轨迹 ${e.u.type}#${e.u.id} 起点(${Math.round(e.sx)},${Math.round(e.sy)}) → 目标(${Math.round(dst.x)},${Math.round(dst.y)}) moveX=${e.u.moveX}`);
    console.log('    ' + (e.traj || []).map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).join(' | '));
  }
}
