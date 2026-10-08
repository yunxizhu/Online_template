/**
 * 「光跑路不靠近」体检：部队一直在走（walked 很大）却几乎没有向目标推进 ——
 * 典型症状是在崖沿/建筑角上来回翻、或者被自己人挤得绕圈。
 *
 * 用法：node scripts/warfactory-orbit-diag.js [局数] [秒数]
 */
'use strict';

const wf = require('../server/games/warfactory/index.js');
const { createGameState, setPlayerInput, __test } = wf;

const ROUNDS = Number(process.argv[2] || 6);
const SEC = Number(process.argv[3] || 120);
const DT = 0.1;

for (let k = 0; k < ROUNDS; k++) {
  const n = 2 + (k % 2);
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: 'p' + i, name: 'P' + i });
  const g = createGameState({ id: 'orbit-' + k, players });
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  const t = g.terrain;
  const pg = __test.passGrid(g);
  const cb = __test.compLabels(g);
  const compOf = (x, y) => {
    const c = Math.max(0, Math.min(t.cols - 1, Math.floor(x / t.cell)));
    const r = Math.max(0, Math.min(t.rows - 1, Math.floor(y / t.cell)));
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
  const army = g.units.filter((u) => !u.dead && u.ownerIdx === 0);
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
      if (d < 2200 || d >= bd) continue;
      bd = d;
      dst = { x: (c + 0.5) * t.cell, y: (r + 0.5) * t.cell };
    }
  }
  if (!dst) continue;
  let now = 1000;
  setPlayerInput(g, g.players[0].id, { cmd: 'move', x: dst.x, y: dst.y, ids: grp.map((u) => u.id) }, now);
  const track = grp.map((u) => ({
    u,
    d0: Math.hypot(u.x - dst.x, u.y - dst.y),
    walked: 0,
    px: u.x,
    py: u.y,
    path: [],
  }));
  for (let s = 0; s < Math.round(SEC / DT); s++) {
    now += DT * 1000;
    __test.step(g, DT, now);
    for (const e of track) {
      if (e.u.dead) continue;
      e.walked += Math.hypot(e.u.x - e.px, e.u.y - e.py);
      e.px = e.u.x;
      e.py = e.u.y;
      if (s % 50 === 0) e.path.push([Math.round(e.u.x), Math.round(e.u.y)]); // 每 5 秒记一个点
    }
  }
  const bad = track.filter((e) => {
    if (e.u.dead) return false;
    const d1 = Math.hypot(e.u.x - dst.x, e.u.y - dst.y);
    return e.walked > 1500 && (e.d0 - d1) / e.walked < Number(process.env.ORBIT_MIN || 0.03) && d1 > 60;
  });
  console.log(
    `第 ${k + 1} 局（${n} 家）：落点 ${Math.round(dst.x)},${Math.round(dst.y)}，空转 ${bad.length}/${grp.length}`
  );
  for (const e of bad) {
    const u = e.u;
    const d1 = Math.hypot(u.x - dst.x, u.y - dst.y);
    console.log(
      `  ${u.type}#${u.id}：d0 ${Math.round(e.d0)} → d1 ${Math.round(d1)}，走了 ${Math.round(e.walked)}px`
    );
    console.log('    轨迹：' + e.path.map((p) => p.join(',')).join(' → '));
    const c = Math.floor(u.x / t.cell);
    const r = Math.floor(u.y / t.cell);
    console.log(`    现在 cell ${c},${r} 层 ${t.heights[r * t.cols + c]} pg ${pg[r * t.cols + c]} moveX ${u.moveX == null ? '-' : Math.round(u.moveX) + ',' + Math.round(u.moveY)}`);
    for (let dr = -3; dr <= 3; dr++) {
      let row = '';
      for (let dc = -3; dc <= 3; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        const i = rr * t.cols + cc;
        row += t.grid[rr][cc] + (t.heights[i] >= 0 ? '+' : '') + t.heights[i] + (pg[i] ? '' : '#') + ' ';
      }
      console.log('      ' + row);
    }
  }
}
