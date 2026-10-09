// 生成 docs/warfactory-burst-elevation-preview.html
// 把轰击（完整本体 = 车体 + 炮塔）按 0°/45°/.../315° 摆一圈，炮塔角 = 车体角（tur=angle），
// 复刻游戏内「已旋转到射向」的变换。验证：无论朝哪，迫击炮口永远朝屏幕上方（曲射仰角与朝向无关）。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');
const outPath = path.join(ROOT, 'docs', 'warfactory-burst-elevation-preview.html');

const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const TYPES = { burst: '轰击' };
const BRIEF = { burst: '轰击（曲射迫击炮）' };

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>轰击 · 所有视角炮口抬升核对</title>
<style>
  body { margin: 0; background: #2b271f; color: #e9e2d2; font: 14px/1.5 system-ui, sans-serif; padding: 22px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .sub { color: #b7ad97; margin: 0 0 18px; max-width: 760px; }
  .card { margin-bottom: 26px; }
  .card h2 { font-size: 15px; margin: 0 0 10px; color: #f0e8d6; }
  .row { display: flex; flex-wrap: wrap; gap: 14px; }
  .cap { font-size: 12px; color: #c9bfa8; text-align: center; margin-top: 4px; }
  .cell { background: #353025; border: 1px solid #4a4334; border-radius: 8px; padding: 8px; }
</style>
</head>
<body>
<h1>轰击 · 所有视角炮口抬升核对</h1>
<p class="sub">每只兵按 0°~315° 摆一圈（炮塔角 = 车体角，复刻游戏内旋转）。十字准星标「屏幕正上方」，
只要炮管口始终在耳轴<strong>上方</strong>、且朝准星那一侧抬，就是「斜向上仰」而非「单纯歪」——
这正是本改动的判定点。</p>
<div id="root"></div>

<script>
${SRC.replace(/<\/script/gi, '<\\/script')}
</script>
<script>
(function () {
  try {
    var Ui = window.WarFactoryUi;
    if (!Ui) throw new Error('WarFactoryUi 未挂载');
    var COL = '#b03a2e';
    var ANGLES = ${JSON.stringify(ANGLES)};
    var BRIEF = ${JSON.stringify(BRIEF)};
    function cell(w, h) {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var x = c.getContext('2d'); x.lineJoin = 'miter'; x.lineCap = 'butt'; return { c: c, x: x };
    }
    function wrap(w, h, draw, capText) {
      var d = document.createElement('div');
      var box = cell(w, h);
      try { draw(box.x, w, h); }
      catch (err) { box.x.fillStyle = '#ff6644'; box.x.font = '11px monospace'; box.x.fillText('ERR ' + err.message, 6, 20); console.error(err); }
      d.appendChild(box.c);
      var cap = document.createElement('div'); cap.className = 'cap'; cap.textContent = capText || ''; d.appendChild(cap);
      var cellWrap = document.createElement('div'); cellWrap.className = 'cell'; cellWrap.appendChild(d); return cellWrap;
    }
    function rowFor(tier, destId) {
      var dest = document.getElementById(destId);
      var card = document.createElement('div'); card.className = 'card';
      card.innerHTML = '<h2>' + BRIEF.burst + ' · ' + (tier === 1 ? '一阶' : '三阶') + '</h2>';
      var row = document.createElement('div'); row.className = 'row';
      for (var k = 0; k < ANGLES.length; k++) {
        (function (deg) {
          var rad = deg * Math.PI / 180;
          row.appendChild(wrap(168, 168, function (x, w, h) {
            var f = 2.1;
            x.save();
            x.translate(w / 2, h / 2);
            x.rotate(rad);                     // 车体（与炮塔同向）旋转到该朝向
            x.scale(f, f);
            Ui.previewUnitBody(x, 'burst', tier, 'A', COL, 1, rad); // tur=rad → 抬升朝屏幕上方
            x.restore();
            // 屏幕正上方准星（不随单位旋转）
            x.strokeStyle = 'rgba(233,226,210,0.5)'; x.lineWidth = 1;
            x.beginPath();
            x.moveTo(w / 2 - 16, h / 2); x.lineTo(w / 2 + 16, h / 2);
            x.moveTo(w / 2, h / 2 - 16); x.lineTo(w / 2, h / 2 + 16);
            x.stroke();
            x.fillStyle = 'rgba(233,226,210,0.6)'; x.font = '10px monospace';
            x.fillText('↑屏幕上方', w / 2 + 4, 14);
          }, deg + '°'));
        })(ANGLES[k]);
      }
      card.appendChild(row); dest.appendChild(card);
    }
    var root = document.getElementById('root');
    rowFor(1, 'root');
    rowFor(3, 'root');
    window.__WF_OK__ = true;
  } catch (e) {
    document.body.insertAdjacentHTML('beforeend', '<pre style="color:#ff8866">preview error: ' + (e && e.message) + '</pre>');
    if (window.console) console.error(e);
  }
})();
</script>
</body>
</html>`;

fs.writeFileSync(outPath, html, 'utf8');
console.log('wrote', outPath);
