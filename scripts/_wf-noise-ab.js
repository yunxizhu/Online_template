'use strict';

/**
 * 地形「不平滑」归因 A/B（第二版）：直接对比「噪声原图」与「最终图」，并做差分。
 *
 *   ① 世界直采噪声 → 阈值（没有楔形、没有折叠、没有后处理）
 *   ② 楔形噪声 → 折叠展开（generateTerrainGrid 的真产物，无后处理）
 *   ③ 完整管线（createGameState 里的 game.terrain.grid）
 *   ④ 差分：红 = ②有山/水、③变成平原（被后处理**挖掉**的地形）
 *          蓝 = ②是平原、③变成山/水（被后处理**补上**的地形）
 *
 * 用法：node scripts/_wf-noise-ab.js [players] [roomId] [themeKey]
 * 产物：docs/_wf-noise-ab.html
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));
const WFPerlin = require(path.join(ROOT, 'server/games/warfactory/perlin.js'));
const X = wf.__test;

const N = Math.max(2, Math.min(4, Number(process.argv[2]) || 4));
const roomId = process.argv[3] || 'noiseab';
const themeArg = process.argv[4] || '';

const g = wf.createGameState({
  id: roomId,
  players: Array.from({ length: N }, (_, i) => ({ id: 'p' + i, name: 'P' + i })),
  ...(themeArg ? { theme: themeArg } : {}),
});
const theme = g.terrain.theme;
const COLS = g.terrain.cols;
const ROWS = g.terrain.rows;
const TOT = COLS * ROWS;

const th = X.themeByKey(theme.key) || X.fillTheme({});
const nc = th.noise || {};
const noiseSeed = (g._mapGen && g._mapGen.noiseSeed) || 1;
const mixM = th.mix.mountain;
const mixW = th.mix.water;
const scale = Math.max(4, Number(nc.scale) || 40);
console.log(`room=${roomId} N=${N} theme=${theme.key}(${theme.name}) seed=${noiseSeed}`);
console.log(`noise=${JSON.stringify(nc)} mix M=${mixM} W=${mixW}`);

function threshold(vals, total) {
  const sorted = vals.slice().sort((a, b) => b.n - a.n);
  const grid = [];
  for (let r = 0; r < ROWS; r++) grid[r] = new Array(COLS).fill(0);
  let got = 0;
  const wantM = total * mixM;
  for (let k = 0; k < sorted.length && got < wantM; k++) { grid[sorted[k].r][sorted[k].c] = 2; got++; }
  const asc = sorted.slice().reverse();
  let gotW = 0;
  const wantW = total * mixW;
  for (let k = 0; k < asc.length && gotW < wantW; k++) {
    if (grid[asc[k].r][asc[k].c] !== 0) continue;
    grid[asc[k].r][asc[k].c] = 4; gotW++;
  }
  return grid;
}

// ① 世界直采
const wm = WFPerlin.generateNoiseMap(COLS, ROWS, noiseSeed, scale, nc.octaves, nc.persistance, nc.lacunarity, { x: 0, y: 0 });
const gRaw = (() => {
  const vals = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) vals.push({ r, c, n: wm[c][r] });
  return threshold(vals, TOT);
})();

// ② 生成器真产物：把 rng 桩成「第一次调用就吐 noiseSeed」
const gGen = (() => {
  let used = false;
  const rngStub = () => { if (!used) { used = true; return (noiseSeed - 1) / 0xfffffe; } return 0.5; };
  return X.generateTerrainGrid(rngStub, th, N, {});
})();

// ③ 完整管线
const gFull = g.terrain.grid;

// ④ 差分
const diff = [];
for (let r = 0; r < ROWS; r++) {
  diff[r] = [];
  for (let c = 0; c < COLS; c++) {
    const a = gGen[r][c], b = gFull[r][c];
    diff[r][c] = a !== 0 && b === 0 ? 1 : a === 0 && b !== 0 ? 2 : 0; // 1=被挖掉 2=被补上
  }
}
function countGrid(gr) {
  let m = 0, w = 0, p = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const v = gr[r][c]; if (v === 2) m++; else if (v === 4) w++; else p++;
  }
  return { m, w, p };
}
for (const [name, gr] of [['①世界直采', gRaw], ['②生成器  ', gGen], ['③完整管线', gFull]]) {
  const s = countGrid(gr);
  console.log(`${name}: 山 ${s.m} (${((s.m / TOT) * 100).toFixed(1)}%) 水 ${s.w} (${((s.w / TOT) * 100).toFixed(1)}%) 平原 ${s.p} (${((s.p / TOT) * 100).toFixed(1)}%)`);
}
let dw = 0, ad = 0;
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { if (diff[r][c] === 1) dw++; else if (diff[r][c] === 2) ad++; }
console.log(`差分：后处理挖掉 ${dw} 格（${((dw / TOT) * 100).toFixed(1)}%），补上 ${ad} 格（${((ad / TOT) * 100).toFixed(1)}%）`);

// ⑤ 掩膜叠加：主路 / 关口 / 隔离带 —— 看「直线」到底是谁挖的
const bases = (g.hqs || []).map((h) => ({ x: h.x, y: h.y }));
const order = X.symOrder(N);
let roadMask = null, gateMask = null;
try { roadMask = X.roadPlainFor(bases, order); } catch (e) { console.log('roadPlainFor 失败', e.message); }
try { gateMask = X.gateMaskOf(bases, order, X.gateSizeK ? X.gateSizeK(th) : 1); } catch (e) { console.log('gateMaskOf 失败', e.message); }
const bands = g._mapGen && g._mapGen.bands;
let isoCount = 0;
const isoMask = [];
for (let r = 0; r < ROWS; r++) {
  isoMask[r] = new Uint8Array(COLS);
  for (let c = 0; c < COLS; c++) {
    const x = (c + 0.5) * 40, y = (r + 0.5) * 40;
    let hit = false;
    try { hit = !!(bands && X.inIsolationBand(bands, x, y)); } catch (e) { hit = false; }
    if (hit) { isoMask[r][c] = 1; isoCount++; }
  }
}
console.log(`掩膜：主路 ${roadMask ? countMask(roadMask) : 0} 格，关口 ${gateMask ? countMask(gateMask) : 0} 格，隔离带 ${isoCount} 格`);
function countMask(m) { let n = 0; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (m[r][c]) n++; return n; }

fs.writeFileSync(
  path.join(ROOT, 'docs', '_wf-noise-ab.html'),
  `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>noise ab</title>
<style>body{margin:0;background:#1c1c1c;color:#ddd;font:12px Consolas,monospace}
canvas{display:block;image-rendering:pixelated;margin:6px} h3{margin:8px 10px 0;font-size:13px}</style>
</head><body>
${['① 世界直采噪声→阈值', '② 楔形噪声→折叠展开（生成器原图）', '③ 完整管线', '④ 差分（红=被挖掉 / 蓝=被补上）', '⑤ 掩膜叠加（黄=主路 / 品红=关口 / 青=隔离带）']
  .map((t, i) => `<h3>${t}</h3><canvas id="c${i}"></canvas>`)
  .join('\n')}
<script>
var RAW=${JSON.stringify(gRaw)}, GEN=${JSON.stringify(gGen)}, FULL=${JSON.stringify(gFull)}, DIFF=${JSON.stringify(diff)};
var ROAD=${JSON.stringify(roadMask || [])}, GATE=${JSON.stringify(gateMask || [])}, ISO=${JSON.stringify(Array.from(isoMask, (row) => Array.from(row)))};
var PX=3, COLS=${COLS}, ROWS=${ROWS};
function paint(i, f) {
  var cv = document.getElementById('c' + i);
  cv.width = COLS * PX; cv.height = ROWS * PX;
  var x = cv.getContext('2d');
  for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
    x.fillStyle = f(r, c); x.fillRect(c * PX, r * PX, PX, PX);
  }
}
function tcol(v) { return v === 2 ? '#6b6154' : v === 4 ? '#8fa6b0' : '#ece3cd'; }
paint(0, function (r, c) { return tcol(RAW[r][c]); });
paint(1, function (r, c) { return tcol(GEN[r][c]); });
paint(2, function (r, c) { return tcol(FULL[r][c]); });
paint(3, function (r, c) {
  var d = DIFF[r][c];
  if (d === 1) return '#d02020';
  if (d === 2) return '#2060d0';
  var v = FULL[r][c];
  return v === 2 ? '#3a352c' : v === 4 ? '#2c3a44' : '#d8d2c0';
});
paint(4, function (r, c) {
  if (ROAD.length && ROAD[r] && ROAD[r][c]) return '#e0a020';
  if (GATE.length && GATE[r] && GATE[r][c]) return '#d020a0';
  if (ISO[r] && ISO[r][c]) return '#20c0c0';
  var v = FULL[r][c];
  return v === 2 ? '#4a4438' : v === 4 ? '#3a4a54' : '#e6e0cf';
});
window.__READY__ = true;
</script></body></html>`
);
console.log('已生成 docs/_wf-noise-ab.html');
