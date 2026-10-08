'use strict';
/**
 * 中场密度探针（诊断用，不是测试）。
 *
 * `scripts/warfactory-terrain-check.js` 里「中场不该是空地」那条断言偶发红
 * （实测最低见过 0.41 倍，下限 0.45），本脚本一次性跑很多局，把这张比值的**分布**打出来，
 * 用来判断「偶发抖动」还是「结构性缺陷」。
 *
 * 用法：node scripts/warfactory-mid-probe.js [局数=24]
 * 输出：每行 = 一局（人数 / 主题 / 中场密度比 / 中心圈可用面积占比 / 全图地形密度）。
 *      密度比 =（中心圈地形占比）÷（全图地形占比），两边都先扣掉主路 + 隔离带。
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));
const T = wf.__test;
const { TERR_ROWS: R, TERR_COLS: C, TT_MOUNTAIN, TT_PLAIN } = T.consts;

function measureOnce(n) {
  const room = { id: 'probe-' + Math.random().toString(36).slice(2, 7) };
  room.players = [];
  for (let i = 0; i < n; i++) room.players.push({ id: 'p' + i, name: 'P' + i });
  const g = wf.createGameState(room);
  const thR = T.fillTheme(T.themeByKey(g.terrain.theme && g.terrain.theme.key) || {});
  const coreR = ((thR.core ? thR.core.r : 0.5) * Math.min(g.world.w, g.world.h)) / 2;
  const corr = [];
  for (let r = 0; r < R; r++) corr[r] = new Array(C).fill(TT_MOUNTAIN);
  T.carveMainRoads(corr, g.hqs, n);
  // 隔离带：由 0 号总部所在的角度反推 spawnRot，与 terrain-check 同一套口径
  const rot = Math.atan2(g.hqs[0].y - g.world.h / 2, g.hqs[0].x - g.world.w / 2);
  const bands = T.isolationBands(n, rot);
  const free = (r, c) =>
    corr[r][c] !== TT_PLAIN && !T.inIsolationBand(bands, (c + 0.5) * g.terrain.cell, (r + 0.5) * g.terrain.cell);
  let cb = 0;
  let ct = 0;
  let gb = 0;
  let gt = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const v = g.terrain.grid[r][c];
      if (free(r, c)) {
        gt++;
        if (v) gb++;
      }
      if (Math.hypot((c + 0.5) * g.terrain.cell - g.world.w / 2, (r + 0.5) * g.terrain.cell - g.world.h / 2) > coreR) continue;
      if (!free(r, c)) continue;
      ct++;
      if (v) cb++;
    }
  }
  const ratio = ct && gb ? (cb / ct) / (gb / gt) : 0;
  return { n: n, theme: thR.name, ratio: ratio, ctFrac: ct / (R * C), gDensity: gb / gt };
}

const rounds = Number(process.argv[2] || 24);
const rows = [];
for (let i = 0; i < rounds; i++) rows.push(measureOnce(2 + (i % 3)));
rows.sort((a, b) => a.ratio - b.ratio);

console.log('人数 主题        密度比   中心可用%  全图密度');
for (const r of rows) {
  const flag = r.ratio < 0.45 ? (r.ctFrac < 0.02 ? '  ← 面积不足会被跳过' : '  ← 断言会红') : '';
  console.log(
    r.n + '    ' + r.theme.padEnd(8) + r.ratio.toFixed(2).padStart(6) + '   ' + (r.ctFrac * 100).toFixed(1).padStart(5) + '%    ' + (r.gDensity * 100).toFixed(1) + '%' + flag
  );
}
const mean = rows.reduce((s, r) => s + r.ratio, 0) / (rows.length || 1);
console.log('\n共 ' + rounds + ' 局：均值 ' + mean.toFixed(2) + '，最低 ' + rows[0].ratio.toFixed(2) + '（' + rows[0].theme + ' ' + rows[0].n + ' 人）');
console.log('实测（2026-10-02，120 局）分布大致落在 0.55~5.5，低于下限 0.45 的是罕见尾部。');
