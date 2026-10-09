'use strict';

/**
 * 地形形状诊断：把生成出来的地形网格逐格画出来（原样，不做任何美化），
 * 用来肉眼定位「不平滑 / 直角 / 硬拉直线」到底出在哪一层。
 *
 * 用法：node scripts/_wf-terrain-diag.js [roomId] [players] [themeKey] [themeSalt] [seed]
 * 产物：docs/_wf-terrain-diag.html → 用无头 Chrome 截图
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));

const roomId = process.argv[2] || 'diag';
const players = Math.max(2, Math.min(4, Number(process.argv[3]) || 4));
const themeKey = process.argv[4] || '';

const g = wf.createGameState({
  id: roomId,
  players: Array.from({ length: players }, (_, i) => ({ id: 'p' + i, name: 'P' + i })),
  ...(themeKey ? { theme: themeKey } : {}),
});
const pub = wf.publicGameState(g);
const T = g.terrain;
const ROWS = T.rows;
const COLS = T.cols;
const GRID = T.grid; // grid[r][c] ∈ {0,2,4}
const H = T.heights; // 高度层（Int8Array，行主序）

console.log(`room=${roomId} players=${players} theme=${T.theme && T.theme.key} ${T.theme && T.theme.name}`);
console.log(`world=${pub.world.w}x${pub.world.h} cell=${T.cell} grid=${COLS}x${ROWS}`);
// ── 统计：直角 / 锯齿 ──────────────────────────────────────────────
function stats() {
  let mtn = 0, wat = 0, plain = 0;
  let stairs = 0; // 45° 阶梯角（对角两块同类、两正交邻非同类的「凸角」）
  let notch = 0; // 凹角
  let longH = 0, longV = 0; // ≥12 格的横/竖直线段（「硬拉的直线」嫌疑）
  const t = (r, c) => (r < 0 || r >= ROWS || c < 0 || c >= COLS ? -1 : GRID[r][c]);
  const solid = (v) => v === 2 || v === 4;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = GRID[r][c];
      if (v === 2) mtn++;
      else if (v === 4) wat++;
      else plain++;
      if (!solid(v)) continue;
      const N = t(r - 1, c) === v, S = t(r + 1, c) === v;
      const W = t(r, c - 1) === v, E = t(r, c + 1) === v;
      const n = (N ? 1 : 0) + (S ? 1 : 0) + (W ? 1 : 0) + (E ? 1 : 0);
      if (n === 2 && !((N && S) || (W && E))) stairs++;
      // 凹角：正交两邻非同类的对角也非同类
      if (n >= 1) {
        const ne = t(r - 1, c + 1) === v, nw = t(r - 1, c - 1) === v;
        const se = t(r + 1, c + 1) === v, sw = t(r + 1, c - 1) === v;
        if ((!N && !E && ne) || (!N && !W && nw) || (!S && !E && se) || (!S && !W && sw)) notch++;
      }
    }
  }
  // 长直线段：同一行上连续同类的水平游程
  const RUN = 14;
  for (let r = 0; r < ROWS; r++) {
    let run = 1;
    for (let c = 1; c <= COLS; c++) {
      if (c < COLS && GRID[r][c] === GRID[r][c - 1] && solid(GRID[r][c])) run++;
      else {
        if (run >= RUN) longH++;
        run = 1;
      }
    }
  }
  for (let c = 0; c < COLS; c++) {
    let run = 1;
    for (let r = 1; r <= ROWS; r++) {
      if (r < ROWS && GRID[r][c] === GRID[r - 1][c] && solid(GRID[r][c])) run++;
      else {
        if (run >= RUN) longV++;
        run = 1;
      }
    }
  }
  const total = ROWS * COLS;
  return { mtn, wat, plain, stairs, notch, longH, longV, total };
}
const st = stats();
console.log(`地形：山 ${st.mtn} (${((st.mtn / st.total) * 100).toFixed(1)}%) 水 ${st.wat} (${((st.wat / st.total) * 100).toFixed(1)}%) 平原 ${st.plain} (${((st.plain / st.total) * 100).toFixed(1)}%)`);
console.log(`直角：台阶角 ${st.stairs}  凹角 ${st.notch}  水平长直段(≥14) ${st.longH}  竖直长直段(≥14) ${st.longV}`);

// ── 选一块「最典型的」放大区：边界密度最高 ───────────────────────
const CROP = 110;
const cropAt = (() => {
  let best = { score: -1, r: 20, c: 20 };
  for (let r = 1; r + CROP <= ROWS; r += 8) {
    for (let c = 1; c + CROP <= COLS; c += 8) {
      let e = 0;
      for (let dr = 0; dr < CROP; dr += 2) {
        for (let dc = 0; dc < CROP; dc += 2) {
          const v = GRID[r + dr][c + dc];
          if (v !== GRID[r + dr - 1][c + dc]) e++;
          if (v !== GRID[r + dr][c + dc - 1]) e++;
        }
      }
      if (e > best.score) best = { score: e, r, c };
    }
  }
  return best;
})();
const cropR = cropAt.r;
const cropC = cropAt.c;
console.log(`放大区：行 ${cropR}..${cropR + CROP} 列 ${cropC}..${cropC + CROP}`);

const meta = { ROWS, COLS, CROP, cropR, cropC, GRID, H, T, st };
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>地形诊断</title>
<style>body{margin:0;background:#222;color:#eee;font:12px/1.6 Consolas,monospace}
canvas{display:block;image-rendering:pixelated;margin:8px} h2{margin:10px 12px 0;font-size:13px}</style>
</head><body>
<h2 id="t1"></h2><div id="a"></div>
<h2 id="t2"></h2><div id="b"></div>
<script>
var M = ${JSON.stringify(meta)};
function draw(cv, r0, c0, rows, cols, px, opt) {
  cv.width = cols * px; cv.height = rows * px;
  var x = cv.getContext('2d');
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
    var gv = M.GRID[r0 + r][c0 + c];
    var h = M.H ? M.H[(r0 + r) * M.COLS + (c0 + c)] : 0;
    var col;
    if (opt.type) {
      col = gv === 2 ? '#6b6154' : gv === 4 ? '#8fa6b0' : '#ece3cd';
    } else {
      var L = 3, u = (h + L) / (2 * L); var t = u * u * (3 - 2 * u);
      var lo = [0x3a, 0x34, 0x2a], hi = [0xf4, 0xee, 0xdc];
      col = 'rgb(' + lo.map(function (m, k) { return Math.round(m + (hi[k] - m) * t); }).join(',') + ')';
      if (gv === 2) col = '#6b6154'; if (gv === 4) col = '#8fa6b0';
    }
    x.fillStyle = col; x.fillRect(c * px, r * px, px, px);
    if (opt.grid) { x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = 1;
      x.strokeRect(c * px + .5, r * px + .5, px - 1, px - 1); }
  }
}
var a = document.createElement('canvas'); document.getElementById('a').appendChild(a);
draw(a, 0, 0, M.ROWS, M.COLS, ${Math.max(2, Math.floor(1100 / Math.max(ROWS, COLS)))}, { type: true, grid: false });
var b = document.createElement('canvas'); document.getElementById('b').appendChild(b);
draw(b, M.cropR, M.cropC, M.CROP, M.CROP, 9, { type: true, grid: true });
var c2 = document.createElement('canvas'); document.getElementById('b').appendChild(c2);
draw(c2, M.cropR, M.cropC, M.CROP, M.CROP, 9, { type: false, grid: false });
document.getElementById('t1').textContent = '① 全图 · 地形类型（山/水/平原） ' + M.COLS + 'x' + M.ROWS;
document.getElementById('t2').textContent = '② 放大 ' + M.CROP + 'x' + M.CROP + ' 格（左=带格线类型 / 右=高度层配色）';
window.__READY__ = true;
</script></body></html>
`;
const outPath = path.join(ROOT, 'docs', '_wf-terrain-diag.html');
fs.writeFileSync(outPath, html);
console.log('已生成 ' + path.relative(ROOT, outPath));
