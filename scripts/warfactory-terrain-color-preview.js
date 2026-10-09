'use strict';

/**
 * 生成「地形高度配色」对照页：docs/warfactory-terrain-color-preview.html
 *
 * 直接复刻 ui.js paintTerrain 里的 LV_COLOR 计算（与真实渲染同口径），展示：
 *   ① 旧方案（冷蓝→纸→暖金 三色）vs 新方案（暗暖墨→宣纸 单色系）的并排对比；
 *   ② 一块合成地形（洼地 / 坡道渐变 / 高地 / 山 / 水）在新配色下的样子。
 *
 * 目的：肉眼确认「同一地形的不同高度」现在是一个色系、不再花。
 * 用法：node scripts/warfactory-terrain-color-preview.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const outPath = path.join(ROOT, 'docs', 'warfactory-terrain-color-preview.html');

const L = 3; // heightLevels = 3（data.js 默认）→ 7 档 −3..+3

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>战争工厂 · 地形高度配色对照</title>
<style>
  html, body { margin: 0; background: #ece3cd; color: #2a2620;
               font: 13px/1.7 "Microsoft YaHei", system-ui, sans-serif; }
  h1 { font-size: 17px; margin: 16px 20px 2px; }
  .sub { margin: 0 20px 14px; color: #6b6154; }
  .card { background: #f6efdd; border: 1px solid #c9bda1; border-radius: 4px;
          padding: 10px 12px 12px; margin: 0 20px 16px; }
  .card h2 { font-size: 14px; margin: 0 0 8px; }
  .legend { display: flex; gap: 0; margin-bottom: 6px; }
  .strip { flex: 1; height: 54px; position: relative; }
  .strip span { position: absolute; bottom: 2px; left: 0; right: 0; text-align: center;
                font-size: 11px; color: #2a2620; text-shadow: 0 0 3px #ece3cd, 0 0 3px #ece3cd; }
  .cmp { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .tag { font-size: 12px; color: #8a5a2b; margin: 0 0 4px; }
  canvas { background: #ece3cd; border: 1px solid #d5c9ad; display: block; }
  .note { font-size: 11px; color: #6b6154; margin: 4px 20px 0; max-width: 920px; }
</style>
</head>
<body>
<h1>地形高度配色 · 旧（太花）→ 新（单色系）</h1>
<p class="sub">同一地形的不同高度：旧方案同时出现蓝块 / 米块 / 金块，太花；新方案只改明暗不改色相（暗暖墨→宣纸），整片一个色系。</p>

<div class="card">
  <h2>① 高度色阶对比（levels=3 ⇒ 7 档 −3…+3）</h2>
  <div class="cmp">
    <div>
      <p class="tag">旧：冷蓝→纸→暖金（三色，太花）</p>
      <div class="legend" id="oldLegend"></div>
    </div>
    <div>
      <p class="tag">新：暗暖墨→宣纸（单色系，统一）</p>
      <div class="legend" id="newLegend"></div>
    </div>
  </div>
</div>

<div class="card">
  <h2>② 合成地形示例（新配色）</h2>
  <canvas id="map" width="540" height="324"></canvas>
  <p class="note">左：洼地（暗）｜中：坡道（由暗到亮的渐变连接两级台地）｜右：高地（亮）。
     山（深褐，不可走）、水（青灰，不可走）是不同地形语义，与「同一地形的高度」分开——高度始终一个色系。</p>
</div>

<script>
(function () {
  var INK = '#2a2620', PAPER = '#ece3cd';
  var C_MTN = '#6b6154', C_WAT = '#8fa6b0';
  var C_CLIFF = '#2b2118';

  // 旧方案：冷蓝→纸→暖金 三色
  function lvOld(t) {
    var cLow = [147,166,178], cMid = [236,227,205], cHi = [224,174,94];
    var rgb;
    if (t >= 0.5) { var u = (t-0.5)*2; rgb = cMid.map(function(m,k){return Math.round(m+(cHi[k]-m)*u);}); }
    else { var u2 = (0.5-t)*2; rgb = cMid.map(function(m,k){return Math.round(m+(cLow[k]-m)*u2);}); }
    return 'rgb('+rgb[0]+','+rgb[1]+','+rgb[2]+')';
  }
  // 新方案：暗暖墨→宣纸 单色系
  function lvNew(t) {
    var cLow = [74,66,53], cHi = [236,227,205];
    var rgb = cLow.map(function(m,k){return Math.round(m+(cHi[k]-m)*t);});
    return 'rgb('+rgb[0]+','+rgb[1]+','+rgb[2]+')';
  }
  function lvColor(fn, lv) { return fn((lv + ${L}) / (2 * ${L})); }

  function renderLegend(id, fn, name) {
    var el = document.getElementById(id);
    for (var lv = -${L}; lv <= ${L}; lv++) {
      var s = document.createElement('div');
      s.className = 'strip';
      s.style.background = lvColor(fn, lv);
      var span = document.createElement('span');
      span.textContent = (lv > 0 ? '+' : '') + lv;
      s.appendChild(span);
      el.appendChild(s);
    }
  }
  renderLegend('oldLegend', lvOld);
  renderLegend('newLegend', lvNew);

  // 合成地形：28×18，CELL=18 → 504×324（canvas 留边）
  var GW = 28, GH = 18, CELL = 18;
  var cv = document.getElementById('map');
  var ctx = cv.getContext('2d');
  // 网格类型：0=平原；2=山；4=水
  var type = [], h = [];
  for (var r = 0; r < GH; r++) {
    type[r] = []; h[r] = [];
    for (var c = 0; c < GW; c++) {
      type[r][c] = 0;
      // 左洼地 / 中坡道 / 右高地
      if (c <= 9) h[r][c] = -2;
      else if (c >= 19) h[r][c] = 2;
      else h[r][c] = -2; // 坡道格先填左值，下面用渐变覆盖
    }
  }
  // 山块
  for (var r = 3; r <= 6; r++) for (var c = 12; c <= 14; c++) type[r][c] = 2;
  // 水块
  for (var r = 12; r <= 15; r++) for (var c = 4; c <= 7; c++) type[r][c] = 4;

  function isRamp(c) { return c > 9 && c < 19; }

  for (var r = 0; r < GH; r++) {
    for (var c = 0; c < GW; c++) {
      var x = c * CELL, y = r * CELL;
      if (type[r][c] === 2) { ctx.fillStyle = C_MTN; ctx.fillRect(x, y, CELL+0.6, CELL+0.6); continue; }
      if (type[r][c] === 4) { ctx.fillStyle = C_WAT; ctx.fillRect(x, y, CELL+0.6, CELL+0.6); continue; }
      if (isRamp(c)) {
        var g = ctx.createLinearGradient(x, y, x + CELL, y);
        g.addColorStop(0, lvColor(lvNew, -2));
        g.addColorStop(1, lvColor(lvNew, 2));
        ctx.fillStyle = g; ctx.fillRect(x, y, CELL+0.6, CELL+0.6);
      } else {
        ctx.fillStyle = lvColor(lvNew, h[r][c]);
        ctx.fillRect(x, y, CELL+0.6, CELL+0.6);
      }
    }
  }
  // 坡道上下边（明显暖线，标「能上下」）
  ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 2.5; ctx.beginPath();
  for (var r = 0; r < GH; r++) {
    // 上边（r 行与 r-1 行的坡交界）
    var c0 = 10;
    if (r === 0 || type[r-1][c0] !== 0 || !isRamp(c0)) {}
    ctx.moveTo(10*CELL, r*CELL); ctx.lineTo(19*CELL, r*CELL);
  }
  ctx.stroke();
  // 山/水轮廓（不可走，深墨边）
  ctx.strokeStyle = C_CLIFF; ctx.lineWidth = 2; ctx.beginPath();
  function strokeBlock(r0, r1, c0, c1) {
    ctx.moveTo(c0*CELL, r0*CELL); ctx.lineTo(c1*CELL, r0*CELL);
    ctx.lineTo(c1*CELL, r1*CELL); ctx.lineTo(c0*CELL, r1*CELL); ctx.closePath();
  }
  strokeBlock(3, 7, 12, 15);
  strokeBlock(12, 16, 4, 8);
  ctx.stroke();
})();
</script>
</body>
</html>
`;

fs.writeFileSync(outPath, html);
console.log('已生成 ' + path.relative(ROOT, outPath));
