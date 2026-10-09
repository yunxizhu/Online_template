'use strict';

/**
 * 生成「车体转向」核对页：docs/warfactory-hull-turn-preview.html
 *
 * 只画 base 层（车体 + 底盘 + 新加的 chassisAccent 亮色轮廓 + 车头朝向标记），
 * 把同一只兵按 0°/30°/60°/90°/135°/180° 摆一圈，肉眼核对：
 *   - 车体在深色地形上是否「勾得出来」（两侧阵营色履带边 + 脚下归属盘）
 *   - 转起来能不能一眼看出车体在转弯（两条履带随车体转 + 车头小楔形）
 *
 * 用法：node scripts/warfactory-hull-turn-preview.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const outPath = path.join(ROOT, 'docs', 'warfactory-hull-turn-preview.html');
const src = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');

const BRIEF = {
  warrior: '锐士 · 双足突击机甲',
  shield: '盾卫 · 履带重装堡垒',
  ranger: '游侠 · 三足炮塔平台',
  burst: '轰击 · 自行迫击炮车',
  burn: '燎原 · 喷火机甲',
  laser: '激光兵 · 光束发射车',
};
const TYPES = Object.keys(BRIEF);
const ANGLES = [0, 30, 60, 90, 135, 180];

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>战争工厂 · 车体转向核对</title>
<style>
  html, body { margin: 0; background: #ece3cd; color: #2a2620;
               font: 13px/1.7 "Microsoft YaHei", system-ui, sans-serif; }
  h1 { font-size: 17px; margin: 16px 20px 2px; }
  .sub { margin: 0 20px 14px; color: #6b6154; }
  .card { background: #f6efdd; border: 1px solid #c9bda1; border-radius: 4px;
          padding: 8px 10px 10px; margin: 0 20px 14px; }
  .card h2 { font-size: 14px; margin: 0 0 6px; }
  .row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
  canvas { background: #ece3cd; border: 1px solid #d5c9ad; display: block; }
  .cap { font-size: 10px; color: #8a7f6a; text-align: center; margin-top: 2px; }
  .dark { background: #2f2a22; border-color: #4a4338; }
  .dark canvas { background: #2f2a22; border-color: #4a4338; }
  .dark .cap { color: #b9ad94; }
  .darknote { font-size: 11px; color: #8a7f6a; margin: 0 20px 10px; }
</style>
</head>
<body>
<h1>六兵种 · 车体转向核对（仅 base 层，真实 ui.js 渲染）</h1>
<p class="sub">车体 = 两侧履带带（阵营色描边 + 滚动齿）+ 车头一枚小阵营色楔形；转起来两条履带跟着偏，一眼看出车体在转弯。上为浅色地形，下为深色地形（核对对比度）。</p>
<div id="light"></div>
<p class="darknote">—— 以下模拟深色 / 杂色地形 ——</p>
<div id="dark" class="dark"></div>

<h1 style="margin-top:26px">六兵种 · 移动留痕示意（base 层 + 身后淡出履带印）</h1>
<p class="sub">单位移动时沿行进方向在地面留下两道平行履带印，随时间自动淡出（游戏内实时行为，此处静态示意）。印子与车体履带同口径、阵营色，越老越淡。</p>
<div id="trail"></div>

<script>
${src.replace(/<\/script/gi, '<\\/script')}
</script>
<script>
(function () {
  try {
  var Ui = window.WarFactoryUi;
  if (!Ui) throw new Error('WarFactoryUi 未挂载');
  var COL = '#b03a2e'; // 阵营红：预览只看「车体转向 + 对比度」，用阵营色最直观
  var TYPES = ${JSON.stringify(TYPES)};
  var BRIEF = ${JSON.stringify(BRIEF)};
  var ANGLES = ${JSON.stringify(ANGLES)};

  function cell(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.lineJoin = 'miter'; x.lineCap = 'butt';
    return { c: c, x: x };
  }
  function wrap(w, h, draw, capText) {
    var d = document.createElement('div');
    var box = cell(w, h);
    try { draw(box.x, w, h); }
    catch (err) {
      box.x.fillStyle = '#b03a2e'; box.x.font = '11px monospace';
      box.x.fillText('ERR: ' + err.message, 6, 20);
      if (window.console) console.error('draw fail', err);
    }
    d.appendChild(box.c);
    var cap = document.createElement('div');
    cap.className = 'cap'; cap.textContent = capText || '';
    d.appendChild(cap);
    return d;
  }

  function rowFor(tier, destId) {
    var dest = document.getElementById(destId);
    for (var i = 0; i < TYPES.length; i++) {
      (function (ty) {
        var card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = '<h2>' + BRIEF[ty] + ' · ' + (tier === 1 ? '一阶' : '三阶') + '</h2>';
        var row = document.createElement('div');
        row.className = 'row';
        for (var k = 0; k < ANGLES.length; k++) {
          (function (deg) {
            var rad = deg * Math.PI / 180;
            row.appendChild(wrap(170, 150, function (x, w, h) {
              var f = 2.0;
              x.save();
              x.translate(w / 2, h / 2);
              x.rotate(rad);          // 车体朝行进方向转
              x.scale(f, f);
              Ui.drawUnitParts(x, ty, tier, 'A', COL, 'base');
              x.restore();
              // 十字准星（不旋转，标「世界朝向前方」），看车体相对它的偏角
              x.strokeStyle = 'rgba(107,97,84,0.4)';
              x.lineWidth = 1;
              x.beginPath();
              x.moveTo(w / 2 - 14, h / 2); x.lineTo(w / 2 + 14, h / 2);
              x.moveTo(w / 2, h / 2 - 14); x.lineTo(w / 2, h / 2 + 14);
              x.stroke();
            }, deg + '°'));
          })(ANGLES[k]);
        }
        card.appendChild(row);
        dest.appendChild(card);
      })(TYPES[i]);
    }
  }
  rowFor(1, 'light');
  rowFor(3, 'light');
  rowFor(1, 'dark');
  rowFor(3, 'dark');

  // ---- 移动留痕示意：把一只兵放在右侧，身后拖一串由新到旧、逐渐淡出的履带印 ----
  function hexRgb(col) {
    var m = /^#([0-9a-f]{6})$/i.exec(col || '');
    if (!m) return '120,90,70';
    var n = parseInt(m[1], 16);
    return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
  }
  // 量出某兵种某阶在画布上的实际半长 / 半宽（含履带），与车体履带严格同口径
  function measureExtent(ty, tier, f) {
    var off = document.createElement('canvas');
    off.width = 220; off.height = 220;
    var ox = off.getContext('2d');
    ox.lineJoin = 'miter'; ox.lineCap = 'butt';
    ox.save();
    ox.translate(110, 110);
    ox.scale(f, f);
    Ui.drawUnitParts(ox, ty, tier, 'A', COL, 'base');
    ox.restore();
    var img = ox.getImageData(0, 0, 220, 220).data;
    var minx = 220, maxx = 0, miny = 220, maxy = 0, hit = false;
    for (var yy = 0; yy < 220; yy++) {
      for (var xx = 0; xx < 220; xx++) {
        if (img[(yy * 220 + xx) * 4 + 3] > 12) {
          hit = true;
          if (xx < minx) minx = xx; if (xx > maxx) maxx = xx;
          if (yy < miny) miny = yy; if (yy > maxy) maxy = yy;
        }
      }
    }
    if (!hit) return { hx: 40, hy: 30 };
    return { hx: (maxx - minx) / 2, hy: (maxy - miny) / 2 };
  }
  function capsule(x, cx, cy, len, th, fill) {
    var r = Math.min(th / 2, len / 2);
    x.beginPath();
    x.moveTo(cx - len / 2 + r, cy - th / 2);
    x.lineTo(cx + len / 2 - r, cy - th / 2);
    x.arc(cx + len / 2 - r, cy, r, -Math.PI / 2, Math.PI / 2);
    x.lineTo(cx - len / 2 + r, cy + th / 2);
    x.arc(cx - len / 2 + r, cy, r, Math.PI / 2, -Math.PI / 2);
    x.closePath();
    x.fillStyle = fill; x.fill();
  }
  function drawPrint(x, px, py, ang, hx, hy, alpha, col) {
    x.save();
    x.translate(px, py);
    x.rotate(ang);
    var off = hy * 0.82, tl = hx * 2 * 0.98, th = hy * 0.40;
    for (var s = -1; s <= 1; s += 2) {
      capsule(x, 0, s * off, tl, th, 'rgba(' + hexRgb(col) + ',' + alpha.toFixed(3) + ')');
    }
    x.restore();
  }
  function rowForTrail(tier, destId) {
    var dest = document.getElementById(destId);
    for (var i = 0; i < TYPES.length; i++) {
      (function (ty) {
        var card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = '<h2>' + BRIEF[ty] + ' · ' + (tier === 1 ? '一阶' : '三阶') + '</h2>';
        var cv = cell(380, 150);
        var x = cv.x, w = 380, h = 150, f = 1.7;
        var ext = measureExtent(ty, tier, f);
        var ux = w - 60, uy = h / 2; // 兵放在右侧、朝右（+x = 行进方向）
        // 身后一串由新到旧、逐渐淡出的履带印（间距 = hx 的 ~0.9 倍，连成连续履带）
        var N = 9, gap = ext.hx * 1.5;
        for (var k = N; k >= 1; k--) {
          var a = 0.34 * Math.pow(1 - (k - 1) / N, 1.6); // 越老越淡
          drawPrint(x, ux - k * gap, uy, 0, ext.hx, ext.hy, a, COL);
        }
        x.save();
        x.translate(ux, uy);
        x.scale(f, f);
        Ui.drawUnitParts(x, ty, tier, 'A', COL, 'base'); // 车体履带与印子同口径
        x.restore();
        // 行进方向箭头
        x.strokeStyle = 'rgba(107,97,84,0.5)'; x.lineWidth = 1.2;
        x.beginPath(); x.moveTo(ux - N * gap - 14, uy); x.lineTo(ux - N * gap + 2, uy); x.stroke();
        x.beginPath(); x.moveTo(ux - N * gap - 2, uy - 4); x.lineTo(ux - N * gap + 2, uy); x.lineTo(ux - N * gap - 2, uy + 4); x.stroke();
        card.appendChild(cv.c);
        dest.appendChild(card);
      })(TYPES[i]);
    }
  }
  rowForTrail(1, 'trail');
  rowForTrail(3, 'trail');

  window.__WF_READY__ = true;
  } catch (e) {
    var d = document.createElement('pre');
    d.style.cssText = 'color:#b03a2e;background:#fff;padding:10px;margin:0 20px;white-space:pre-wrap';
    d.textContent = '页面脚本异常：' + (e && e.stack || e);
    document.body.appendChild(d);
  }
})();
</script>
</body>
</html>
`;

fs.writeFileSync(outPath, html);
console.log('已生成 ' + path.relative(ROOT, outPath));
