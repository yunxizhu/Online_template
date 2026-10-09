'use strict';

/**
 * 生成「六兵种炮塔造型」对照页：docs/warfactory-turret-gallery.html
 *
 * 用真实的 public/games/warfactory/ui.js（previewUnitBody = 车体 + 炮塔两层同向叠起来）
 * 画出 6 个兵种 × 3 阶，图下标注炮管前伸量与造型定位。
 * 用来肉眼核对：炮塔够不够大、炮管够不够长、六种炮管形状互不混淆
 * （坦克炮 / 无炮管肉盾 / 长身狙击管 / 斜上迫击炮 / 长条喇叭喷嘴 / 棱镜）。
 *
 * 顺带画一个「炮塔转向」示意：同一只兵、炮塔相对车体转 -35°/+35°，
 * 看座圈是否咬在车上、炮口是否正确扫出去（座圈与旋转中心不一致就会露馅）。
 *
 * 用法：node scripts/warfactory-turret-gallery.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const outPath = path.join(ROOT, 'docs', 'warfactory-turret-gallery.html');
const src = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');

// 造型定位文案（与 ui.js 里各 draw* 的注释同源）
const BRIEF = {
  warrior: { name: '锐士', role: '常规坦克炮', desc: '直管 + 炮盾 + 制退器，标准坦克侧廓' },
  shield: { name: '盾卫', role: '无炮管 · 近战肉盾', desc: '层叠甲板 + 撞角 + 下缘铲刀，刻意不给管子' },
  ranger: { name: '游侠', role: '长身狙击炮管', desc: '全兵种最长最细，三道加强环 + 支撑脚' },
  burst: { name: '轰击', role: '斜上扬迫击炮', desc: '明显仰角（曲射），粗管壁 + 口部粗箍' },
  burn: { name: '燎原', role: '长条喇叭喷嘴', desc: '细喉部一路张开的锥形口，张角随阶数' },
  laser: { name: '激光兵', role: '棱镜', desc: '两端尖的晶体 + 内部折光线 + 聚焦环组' },
};
const TYPES = Object.keys(BRIEF);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>战争工厂 · 六兵种炮塔造型对照</title>
<style>
  html, body { margin: 0; background: #ece3cd; color: #2a2620;
               font: 13px/1.7 "Microsoft YaHei", system-ui, sans-serif; }
  h1 { font-size: 17px; margin: 16px 20px 2px; }
  .sub { margin: 0 20px 14px; color: #6b6154; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 0 20px 22px; }
  .card { background: #f6efdd; border: 1px solid #c9bda1; border-radius: 4px; padding: 8px 10px 10px; }
  .card h2 { font-size: 14px; margin: 0 0 2px; display: flex; align-items: baseline; gap: 8px; }
  .card h2 em { font-style: normal; font-size: 11px; font-weight: 400; color: #8a5a2b; }
  .card p { margin: 0 0 6px; font-size: 11px; color: #6b6154; }
  .row { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
  canvas { background: #ece3cd; border: 1px solid #d5c9ad; display: block; }
  .cap { font-size: 10px; color: #8a7f6a; text-align: center; margin-top: 2px; }
  .swatch { display: inline-block; width: 10px; height: 10px; border: 1px solid #6b6154; vertical-align: -1px; margin-right: 3px; }
  h2.sec { font-size: 14px; margin: 0 20px 8px; }
  .tip { margin: 0 20px 26px; font-size: 12px; color: #6b6154; max-width: 900px; }
  ul { margin: 4px 0 0 18px; padding: 0; color: #6b6154; font-size: 12px; }
</style>
</head>
<body>
<h1>六兵种 · 炮塔造型对照（真实 ui.js 渲染）</h1>
<p class="sub">2026-10-09 重做：炮塔加大、炮管加长，并按兵种职能区分炮管形状。每格从左到右 = 一阶 / 二阶 / 三阶。</p>
<div class="grid" id="grid"></div>

<h2 class="sec">炮塔转向核对（车体朝右，炮塔相对车体 −35° / +35°）</h2>
<p class="tip">炮塔绕<b>座圈</b>转、不是绕机体中心转。座圈与旋转中心对不上时，这一屏会露出破绽：
   座圈会跟着炮管一起漂移，或炮管根部离开车身。</p>
<div class="grid" id="pivot"></div>

<h2 class="sec">读法</h2>
<ul>
  <li><span class="swatch" style="background:#b03a2e"></span>车体层（深墨）与炮塔层（阵营色）在本页用同一阵营色画；
      游戏里两者是同一只兵，只是旋转角不同。</li>
  <li>炮塔件包含：座圈 + 转塔体 + 炮管 + 炮口制退器 + 阶数件（加强环 / 副炮管 / 冷却环…）。</li>
  <li>车体层仍保留阵营色（能量核 / 肩甲 / 尾翼）—— 那是<b>归属识别</b>，与炮塔的「兵种识别」是两件事。</li>
  <li>本页<b>不按体型归一</b>（各兵种画在同一个比例下），方便直接比炮管长短与形状。</li>
</ul>
<script>
${src.replace(/<\/script/gi, '<\\/script')}
</script>
<script>
(function () {
  try {
  var Ui = window.WarFactoryUi;
  if (!Ui) throw new Error('WarFactoryUi 未挂载');
  var COL = '#b03a2e'; // 阵营红：现在兵走「阵营色方案」，用本方色最直观
  var TIERS = [1, 2, 3];

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
      // ⚠️ 单格画崩不要中断整页：标出来，其余照常渲染（否则一个兵种出问题 = 整页空白）
      box.x.fillStyle = '#b03a2e';
      box.x.font = '11px monospace';
      box.x.fillText('ERR ' + ty0 + ': ' + err.message, 6, 20);
      if (window.console) console.error('draw fail', err);
    }
    d.appendChild(box.c);
    var cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = capText || '';
    d.appendChild(cap);
    return d;
  }

  /* ---- ① 六兵种 ×3 阶 ---- */
  var grid = document.getElementById('grid');
  var TYPES = ${JSON.stringify(TYPES)};
  var BRIEF = ${JSON.stringify(BRIEF)};
  for (var i = 0; i < TYPES.length; i++) {
    var ty = TYPES[i];
    var b = BRIEF[ty];
    var card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<h2>' + b.name + '<em>' + b.role + '</em></h2><p>' + b.desc + '</p>';
    var row = document.createElement('div');
    row.className = 'row';
    for (var t = 0; t < 3; t++) {
      (function (tier) {
        var ty0 = ty;
        // 画布要装得下最长的炮管（游侠三阶）+ 一点余量
        row.appendChild(wrap(190, 120, function (x, w, h) {
          var f = 1.5 * (1 + (tier - 1) * 0.5); // 一阶 1.5× / 二阶 2.25× / 三阶 3.0×（阶数仍要看得出来大）
          x.save();
          x.translate(30, h / 2 + 10);
          x.scale(f, f);
          Ui.previewUnitBody(x, ty, tier, 'A', COL, 1);
          x.restore();
          // 地面参考线
          x.strokeStyle = 'rgba(107,97,84,0.35)';
          x.lineWidth = 1;
          x.beginPath(); x.moveTo(6, h / 2 + 8); x.lineTo(w - 6, h / 2 + 8); x.stroke();
        }, ['一阶', '二阶', '三阶'][tier - 1]));
      })(TIERS[t]);
    }
    card.appendChild(row);
    grid.appendChild(card);
  }

  /* ---- ② 炮塔转向核对 ---- */
  var pv = document.getElementById('pivot');
  for (var i = 0; i < TYPES.length; i++) {
    (function (ty) {
      var b = BRIEF[ty];
      var card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = '<h2>' + b.name + '<em>炮塔转向</em></h2>';
      var row = document.createElement('div');
      row.className = 'row';
      var ANGS = [-0.61, 0, 0.61]; // ≈ ±35°
      for (var k = 0; k < ANGS.length; k++) {
        (function (rel) {
          row.appendChild(wrap(190, 120, function (x, w, h) {
            var f = 1.15;
            x.save();
            x.translate(80, h / 2 + 8);
            x.scale(f, f);
            // 车体朝 +x，炮塔相对车体转 rel（与游戏内 drawUnits 同一套两层画法）
            x.save();
            x.rotate(0);
            Ui.drawUnitParts(x, ty, 2, 'A', COL, 'base');
            x.restore();
            var p = Ui.turretPivot(ty, 2);
            x.save();
            x.translate(p[0], p[1]);
            x.rotate(rel);
            x.translate(-p[0], -p[1]);
            Ui.drawUnitParts(x, ty, 2, 'A', COL, 'turret');
            x.restore();
            x.restore();
            // 座圈位置画个十字，核对它与旋转中心重合
            x.fillStyle = 'rgba(47,111,122,0.9)';
            x.beginPath(); x.arc(80 + p[0] * f, h / 2 + 8 + p[1] * f, 2, 0, Math.PI * 2); x.fill();
            x.strokeStyle = 'rgba(107,97,84,0.35)';
            x.lineWidth = 1;
            x.beginPath(); x.moveTo(6, h / 2 + 8); x.lineTo(w - 6, h / 2 + 8); x.stroke();
          }, (rel * 180 / Math.PI).toFixed(0) + '°'));
        })(ANGS[k]);
      }
      card.appendChild(row);
      pv.appendChild(card);
    })(TYPES[i]);
  }
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
