'use strict';

/**
 * 寻路体检：node scripts/warfactory-path-probe.js [局数]
 *
 * 查三件事：
 *   ① 流场命中率 —— 下令后部队到底能不能拿到「沿地形绕行」的流场（拿不到就退化成直线撞墙）
 *   ② 到达率 —— 让每家的亲兵去打若干远距离目标点，看多少比例真能走到
 *   ③ 卡点分布 —— 没走到的卡在哪儿（原地抖动 / 贴墙 / 隔崖）
 */

const path = require('path');
const mod = require(path.resolve(__dirname, '../server/games/warfactory/index.js'));
const { createGameState, setPlayerInput, __test } = mod;
const C = __test.consts;

const ROUNDS = Math.max(1, Number(process.argv[2]) || 3);

function clock(start) {
  const st = { now: start || 1000 };
  st.run = (game, ms) => {
    const dt = 0.05;
    const end = st.now + ms;
    while (st.now < end) {
      st.now += dt * 1000;
      __test.step(game, dt, st.now);
    }
  };
  return st;
}

function newGame(n, tag) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: 'p' + i + '-' + tag, name: 'P' + i });
  const g = createGameState({ id: 'probe-' + tag, players });
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  return g;
}

/** 找一块「与 (x,y) 同连通分量」且直线距离 ≥ minD 的空地 */
function farSpot(g, x, y, minD) {
  const t = g.terrain;
  const cb = __test.compLabels(g);
  const pg = __test.passGrid(g);
  const cc = Math.min(t.cols - 1, Math.max(0, Math.floor(x / t.cell)));
  const cr = Math.min(t.rows - 1, Math.max(0, Math.floor(y / t.cell)));
  let want = cb.lab[cr * t.cols + cc];
  if (want < 0) {
    for (let ring = 1; ring <= 6 && want < 0; ring++) {
      for (let dr = -ring; dr <= ring && want < 0; dr++) {
        for (let dc = -ring; dc <= ring && want < 0; dc++) {
          const r = cr + dr;
          const c = cc + dc;
          if (r < 0 || r >= t.rows || c < 0 || c >= t.cols) continue;
          if (pg[r * t.cols + c]) want = cb.lab[r * t.cols + c];
        }
      }
    }
  }
  let best = null;
  let bestD = Infinity;
  for (let r = 2; r < t.rows - 2; r += 2) {
    for (let c = 2; c < t.cols - 2; c += 2) {
      const i = r * t.cols + c;
      if (!pg[i] || cb.lab[i] !== want) continue;
      const px = (c + 0.5) * t.cell;
      const py = (r + 0.5) * t.cell;
      const d = Math.hypot(px - x, py - y);
      if (d < minD) continue;
      if (d < bestD) {
        bestD = d;
        best = { x: px, y: py };
      }
    }
  }
  return best;
}

function run(n, tag) {
  const g = newGame(n, tag);
  const tk = clock(1000);
  const t = g.terrain;
  console.log(`\n=== ${n} 人局 ${tag}（主题 ${t.theme && t.theme.name}）${t.cols}×${t.rows} 格 ===`);

  // ---- ① 流场命中率：对每个部队的当前所在格 → 若干目标格，看 flowField 能不能建出来 ----
  let ffTry = 0;
  let ffOk = 0;
  const owned = g.units.filter((u) => !u.dead);
  const goals = [];
  for (const f of g.factories) goals.push({ x: f.x, y: f.y, tag: '工厂' });
  for (const l of g.labs) goals.push({ x: l.x, y: l.y, tag: '研究所' });
  for (const h of g.hqs) goals.push({ x: h.x, y: h.y, tag: '总部' });
  for (const u of owned.slice(0, 40)) {
    for (const gl of goals) {
      ffTry++;
      const f = __test.flowField(g, gl.x, gl.y, u.x, u.y);
      if (f) {
        const me = __test.cellOf ? __test.cellOf(g, u.x, u.y) : null;
        if (f.dist && f.dist.length) ffOk++;
      }
    }
  }
  console.log(`  流场建立：${ffOk}/${ffTry}（${Math.round((ffOk / ffTry) * 100)}%）`);

  // 流场里「部队所在格可达」的比例
  let reachTry = 0;
  let reachOk = 0;
  for (const u of owned.slice(0, 40)) {
    for (const gl of goals) {
      g._flowCache = null;
      g._goalFix = null;
      g._flowBudget = 999;
      const f = __test.flowField(g, gl.x, gl.y, u.x, u.y);
      if (!f) continue;
      reachTry++;
      const c = Math.min(t.cols - 1, Math.max(0, Math.floor(u.x / t.cell)));
      const r = Math.min(t.rows - 1, Math.max(0, Math.floor(u.y / t.cell)));
      if (f.dist[r * t.cols + c] >= 0) reachOk++;
    }
  }
  console.log(`  流场里自家格可达：${reachOk}/${reachTry}（${Math.round((reachOk / Math.max(1, reachTry)) * 100)}%）`);

  // ---- ② 到达率：亲兵 → 远处空地 ----
  const hq0 = g.hqs[0];
  let trips = 0;
  let arrived = 0;
  const stalls = [];
  for (const u of owned) {
    const dst = farSpot(g, u.x, u.y, 2600);
    if (!dst) continue;
    if (Math.hypot(dst.x - u.x, dst.y - u.y) < 1200) continue;
    u.moveX = null;
    u.moveY = null;
    u.manualTarget = null;
    setPlayerInput(g, g.players[u.ownerIdx].id, { cmd: 'move', x: dst.x, y: dst.y, ids: [u.id] }, tk.now);
    const d0 = Math.hypot(dst.x - u.x, dst.y - u.y);
    let px = u.x;
    let py = u.y;
    let moved = 0;
    const SEC = 90;
    for (let s = 0; s < SEC * 20; s++) {
      tk.run(g, 50);
      moved += Math.hypot(u.x - px, u.y - py);
      px = u.x;
      py = u.y;
      if (Math.hypot(dst.x - u.x, dst.y - u.y) < 40) break;
      if (u.dead) break;
    }
    const d1 = Math.hypot(dst.x - u.x, dst.y - u.y);
    trips++;
    const okk = d1 < 60;
    if (okk) arrived++;
    else {
      stalls.push({
        type: u.type,
        d0: Math.round(d0),
        d1: Math.round(d1),
        walked: Math.round(moved),
        prog: Math.round((1 - d1 / d0) * 100),
      });
    }
  }
  console.log(`  远征到达：${arrived}/${trips}`);
  if (stalls.length) {
    const byType = {};
    for (const s of stalls) {
      byType[s.type] = byType[s.type] || [];
      byType[s.type].push(s);
    }
    for (const k of Object.keys(byType)) {
      const arr = byType[k];
      const avgP = Math.round(arr.reduce((a, b) => a + b.prog, 0) / arr.length);
      const avgW = Math.round(arr.reduce((a, b) => a + b.walked, 0) / arr.length);
      console.log(`    卡住 ${k} ×${arr.length}：平均推进 ${avgP}%、走了 ${avgW}px（直线 ${arr[0].d0}px）`);
    }
  }
  return { trips, arrived, ffTry, ffOk };
}

let T = 0;
let A = 0;
for (let i = 0; i < ROUNDS; i++) {
  const n = 2 + (i % 3);
  const r = run(n, i + 1);
  T += r.trips;
  A += r.arrived;
}
console.log(`\n合计：${A}/${T}（${Math.round((A / Math.max(1, T)) * 100)}%）`);
