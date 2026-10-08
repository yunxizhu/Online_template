'use strict';

/**
 * 生成「高低差看不看得出来」的取证页面（docs/warfactory-height-preview.html）。
 *
 * 目的：回答「当前的斜视视角无法看出高低区别吗」这类问题 —— 光读代码没用，
 * 必须真的把画面画出来看。这里复用 public/index.html 的真实页面骨架 +
 * 真实 style.css + 真实 panel.html + 真实 ui.js，喂一局真实对局，
 * 再把镜头挪到「高低差最剧烈」的那块地上，用无头浏览器截图。
 *
 * 用法：node scripts/warfactory-height-preview.js
 * 截图：
 *   chrome --headless=new --disable-gpu --no-sandbox --window-size=1600,900 \
 *     --virtual-time-budget=900 \
 *     --screenshot=docs/warfactory-height-preview-z1.png \
 *     "file:///…/docs/warfactory-height-preview.html?z=0&probe=1"
 *
 * 查询串：
 *   ?z=0      默认镜头（1 倍，1 世界像素 = 1 CSS 像素）
 *   ?z=1..3   往里推几档滚轮（1 档 ×2，两档就顶到 ZOOM_MAX=3.6）
 *   ?z=-6     往外拉到底（ZOOM_MIN=0.09，整图 overview）
 *   ?probe=1  左下角打出镜头倍率 / 视口里有多少层差 / 每层折合几个屏幕像素
 *   ?theme=群山  固定地形主题（不写就随机，出图不可复现）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));

/** ui.js 里的两个视觉常量（改了那边这里要跟着改，否则选点会算错） */
const HEIGHT_STEP = 13;
const LIFT_MTN_BOOST = 3;
const LIFT_WAT_SINK = 2;

function buildGame(theme) {
  const g = wf.createGameState({
    id: 'height-preview',
    players: [{ id: 'p0', name: '墨客' }, { id: 'p1', name: '砚台' }],
    theme: theme || undefined,
  });
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  return g;
}

/**
 * 按 ui.js 同一套公式把「每格抬升多少世界像素」算出来，
 * 再扫一遍找「最陡的一块窗口」——截图要对准这，否则拍到的可能是一马平川。
 */
function liftGrid(st) {
  const t = st.terrain;
  const off = (st.consts && st.consts.heightOff) || 3;
  const rows = t.rows, cols = t.cols;
  const out = new Int16Array(rows * cols);
  const hl = new Int8Array(rows * cols); // 真实高度层（不含山/水的视觉加成）—— 判崖用它
  for (let i = 0; i < rows * cols; i++) {
    const c = t.data.charCodeAt(i) - 48;
    let lv = t.heights ? t.heights.charCodeAt(i) - 48 - off : 0;
    hl[i] = lv;
    if (c === 2) lv += LIFT_MTN_BOOST;
    else if (c === 4) lv -= LIFT_WAT_SINK;
    out[i] = lv * HEIGHT_STEP;
  }
  return { lift: out, hl, rows, cols, cell: t.cell, levels: t.levels, cliff: t.cliff || 2 };
}

/**
 * 找「层差最剧烈」的落点。
 * 远景窗口 46×26 格（默认镜头 1600×900 一屏差不多这么多），近景窗口 13×7 格
 * （拉近到 3.6 倍后一屏只有 11×5.5 格 —— 近景落点必须按那个尺寸挑，否则
 * 对准的是大窗口中心的一块平地，崖壁全在屏幕外）。
 */
function pickSpot(L, winC, winR, minKinds) {
  let best = null;
  for (let r = 0; r + winR < L.rows; r += 2) {
    for (let c = 0; c + winC < L.cols; c += 2) {
      let lo = 1e9, hi = -1e9, mtn = 0, wat = 0, plain = 0;
      for (let rr = r; rr < r + winR; rr++) {
        for (let cc = c; cc < c + winC; cc++) {
          const i = rr * L.cols + cc;
          const v = L.lift[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
          // 光看极值不够：还要这块地里山、水、平地都有，才看得出「层级关系」
          const ch = L.data ? L.data.charCodeAt(i) - 48 : 0;
          if (ch === 2) mtn++; else if (ch === 4) wat++; else plain++;
        }
      }
      const kinds = (mtn > winC * winR * 0.05 ? 1 : 0) +
        (wat > winC * winR * 0.05 ? 1 : 0) + (plain > winC * winR * 0.2 ? 1 : 0);
      if (minKinds && kinds < minKinds) continue;
      const score = (hi - lo) + kinds * 30;
      if (!best || score > best.score) {
        best = { score, r, c, lo, hi, mtn, wat, plain, kinds,
          cx: (c + winC / 2) * L.cell, cy: (r + winR / 2) * L.cell };
      }
    }
  }
  return best;
}

/**
 * 找「崖最多」的落点。
 * 层差 ≥ cliff 的边界才是「过不去的断崖」——要证明画面看得出崖，镜头必须对准崖最密的地方，
 * 而不是泛泛地找一块高低起伏大的地（那里可能全是 1 层的缓坡）。
 */
function cliffEdgeGrid(L, cliff) {
  const out = new Int32Array(L.rows * L.cols);
  let total = 0;
  for (let r = 0; r < L.rows; r++) {
    for (let c = 0; c < L.cols; c++) {
      const a = L.hl[r * L.cols + c];
      let n = 0;
      if (r + 1 < L.rows && Math.abs(a - L.hl[(r + 1) * L.cols + c]) >= cliff) n++;
      if (c + 1 < L.cols && Math.abs(a - L.hl[r * L.cols + c + 1]) >= cliff) n++;
      out[r * L.cols + c] = n;
      total += n;
    }
  }
  return { edges: out, total };
}

function pickCliffSpot(L, winC, winR) {
  let best = null;
  for (let r = 0; r + winR < L.rows; r += 2) {
    for (let c = 0; c + winC < L.cols; c += 2) {
      let n = 0;
      for (let rr = r; rr < r + winR; rr++) {
        for (let cc = c; cc < c + winC; cc++) n += L.edges[rr * L.cols + cc];
      }
      if (!best || n > best.n) {
        best = { n, r, c, cx: (c + winC / 2) * L.cell, cy: (r + winR / 2) * L.cell };
      }
    }
  }
  return best;
}

/** 从 public/index.html 里抠出 <body> 的真实骨架，并清掉所有 <script>（file:// 下会 404） */
function extractShell() {
  const raw = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const m = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!m) throw new Error('public/index.html 里找不到 <body>');
  return m[1]
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*\/>/gi, '');
}

/** 页面里跑的驱动脚本（内联进 HTML，浏览器执行） */
const RUNNER = `
(function () {
  function fail(msg) { document.title = 'PREVIEW-ERROR ' + msg; }
  window.onerror = function (m) { fail(m); };
  try {
    document.body.classList.add('phase-game');
    var d = window.__WF__;

    // ---- 拦 2D 上下文的 setTransform，记下最后一帧的世界变换（世界坐标 → 屏幕坐标）----
    var cam = null;
    var rawGet = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind) {
      var c = rawGet.apply(this, arguments);
      if (kind === '2d' && c && !c.__wfProbe) {
        c.__wfProbe = 1;
        var raw = c.setTransform.bind(c);
        c.setTransform = function (a, b, cc, dd, e, f) {
          if (a === dd && b === 0 && cc === 0 && a > 0.005 && (e !== 0 || f !== 0)) {
            cam = { k: a, x: -e / a, y: -f / a };
          }
          return raw(a, b, cc, dd, e, f);
        };
      }
      return c;
    };

    var hide = function (id) { var el = document.getElementById(id); if (el) el.hidden = true; };
    var show = function (id) { var el = document.getElementById(id); if (el) el.hidden = false; };
    hide('view-lobby'); hide('view-room'); hide('lobby-people-aside');
    hide('lobby-gate'); hide('lobby-main');
    show('view-game');
    show('match-clock');
    var t = document.getElementById('match-clock-time'); if (t) t.textContent = '12:34';
    show('header-nick');
    var nd = document.getElementById('nick-display'); if (nd) nd.textContent = '墨客';

    var gp = document.getElementById('game-panels');
    gp.innerHTML = window.__WF_PANEL__;
    document.getElementById('panel-warfactory').hidden = false;

    var net = { on: function () {}, sendRt: function () {} };
    window.WarFactoryUi.render(d.state, net, { meId: 'p0', isSpectator: false, title: '战争工厂' });
    window.WarFactoryUi.applySnapshot(d.snap);

    var qs = String(location.search || '');
    var q = function (k, dv) { var m = qs.match(new RegExp(k + '=(-?\\\\w+)')); return m ? m[1] : dv; };
    var zSteps = Number(q('z', '0'));
    // 拉近(z≥1)用近景落点（一屏只有 11×5.5 格），其余用远景落点
    // ?spot=cliff → 改成对准「崖最密」的窗口（要证明的是崖，不是泛泛的起伏）
    var wantCliff = qs.indexOf('spot=cliff') >= 0;
    var SPOT = zSteps >= 1
      ? (wantCliff ? d.spotCliffNear : d.spotNear)
      : (wantCliff ? d.spotCliff : d.spotWide);

    // 镜头先甩到「最陡的一块地」上（点小地图，走的是真实交互路径）
    function mmFocus(wx, wy) {
      var mm = document.getElementById('warfactory-minimap');
      var r = mm.getBoundingClientRect();
      var ev = function (type) {
        mm.dispatchEvent(new MouseEvent(type, {
          bubbles: true, button: 0,
          clientX: r.left + (wx / d.state.world.w) * r.width,
          clientY: r.top + (wy / d.state.world.h) * r.height,
        }));
      };
      ev('mousedown'); ev('mouseup');
    }
    function wheel(notches) {
      var cv = document.getElementById('warfactory-canvas');
      var r = cv.getBoundingClientRect();
      for (var i = 0; i < Math.abs(notches); i++) {
        cv.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true,
          deltaY: notches > 0 ? -800 : 800,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        }));
      }
    }

    var n = 0;
    (function paint() {
      window.WarFactoryUi.applySnapshot(d.snap);
      n++;
      if (n === 2) { mmFocus(SPOT.cx, SPOT.cy); }
      if (n === 3 && zSteps) { wheel(zSteps); }
      if (n < 7) { requestAnimationFrame(paint); return; }

      // 镜头读数徽标：倍率 k 是这一步的关键 —— 13px/层 在屏幕上是 13*k 像素
      var probe = document.getElementById('wfh-probe');
      if (!probe) {
        probe = document.createElement('div');
        probe.id = 'wfh-probe';
        probe.style.cssText =
          'position:fixed;left:8px;bottom:8px;z-index:99999;max-width:620px;' +
          'background:#111;color:#0f0;font:12px/1.5 monospace;padding:6px 9px;' +
          'border-radius:4px;white-space:pre-wrap;';
        document.body.appendChild(probe);
      }
      probe.style.display = qs.indexOf('probe=0') >= 0 ? 'none' : '';

      var H = window.WarFactoryUi.heights;
      var k = cam ? cam.k : -1;
      var perLvl = 13 * k;
      // 视口里实际出现了几种抬升值（拿画面中心那一片采样，跟眼睛看到的一致）
      var seen = {}; var lo = 1e9; var hi = -1e9;
      var cv2 = document.getElementById('warfactory-canvas');
      var rc = cv2.getBoundingClientRect();
      if (cam) {
        for (var i = 0; i < 6000; i++) {
          var wx = cam.x + ((i * 7919) % 1000) / 1000 * (rc.width / k);
          var wy = cam.y + ((i * 6151) % 1000) / 1000 * (rc.height / k);
          if (wx < 0 || wy < 0 || wx >= d.state.world.w || wy >= d.state.world.h) continue;
          var L = H.liftAt(wx, wy);
          seen[Math.round(L)] = 1;
          if (L < lo) lo = L; if (L > hi) hi = L;
        }
      }
      var keys = Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
      var CN = (H.contours ? H.contours() : { cliff: 0, slope: 0, cliffAt: -1 });
      probe.textContent =
        'zoom k=' + k.toFixed(3) + '  (滚轮档位 ' + zSteps + ')' +
        '\\n坡线 ' + CN.slope + ' 段 / 崖线 ' + CN.cliff + ' 段  (崖判据 层差≥' + CN.cliffAt + ')' +
        '  崖线屏幕粗细 ' + (2.6).toFixed(1) + 'px / 坡线 ' + (1.1).toFixed(1) + 'px（恒定）' +
        '\\n每层抬升 13 世界px → 屏幕上 ' + perLvl.toFixed(2) + ' px' +
        '\\n视口内抬升值: ' + (keys.length ? keys.join(' / ') : '(镜头未就绪)') +
        '\\n最大层差 ' + (hi > lo ? (hi - lo).toFixed(0) : 0) + 'px → 屏幕上 ' +
        ((hi - lo) * k).toFixed(1) + 'px' +
        '\\n落点 ' + Math.round(SPOT.cx) + ',' + Math.round(SPOT.cy) +
        '  该窗口: 山' + SPOT.mtn + '格 水' + SPOT.wat + '格 平地' + SPOT.plain + '格' +
        '\\n主题 ' + (d.state.terrain && d.state.terrain.theme ? d.state.terrain.theme.name : '?');
      document.title = 'ready-height';
    })();
  } catch (err) { fail((err && err.message) || err); }
})();
`;

function main() {
  const argTheme = (process.argv.slice(2).find((a) => a.startsWith('--theme=')) || '').slice(8);
  const theme = argTheme || '群山';
  const g = buildGame(theme);
  const state = wf.publicGameState(g);
  const snap = wf.snapshot(g);

  const L = liftGrid(state);
  L.data = state.terrain.data;
  const CE0 = cliffEdgeGrid(L, L.cliff);
  L.edges = CE0.edges;
  const spotWide = pickSpot(L, 46, 26, 2);
  const spotNear = pickSpot(L, 13, 7, 0);
  const spotCliff = pickCliffSpot(L, 46, 26);
  const spotCliffNear = pickCliffSpot(L, 13, 7);
  if (!spotWide || !spotNear || !spotCliff || !spotCliffNear) throw new Error('没找到合适的取样窗口');

  const shellCss = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');
  const panel = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');
  const shell = extractShell();

  const data = JSON.stringify({ state, snap, spotWide, spotNear, spotCliff, spotCliffNear });

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>战争工厂 · 高低差取证</title>
<style>
${shellCss}
</style>
<style>
${css}
</style>
</head>
<body>
${shell}
<script>window.__WF__ = ${data};</script>
<script>window.__WF_PANEL__ = ${JSON.stringify(panel)};</script>
<script>
${ui}
</script>
<script>
${RUNNER}
</script>
</body>
</html>
`;

  const out = path.join(ROOT, 'docs/warfactory-height-preview.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, 'utf8');
  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log('wrote docs/warfactory-height-preview.html (' + kb + ' KB)');
  console.log('主题=' + (state.terrain.theme && state.terrain.theme.name) +
    '  高度层数=' + state.terrain.levels + '  崖判据=层差≥' + L.cliff);
  console.log('全图崖边 ' + CE0.total + ' 条（含重复计数的双向边界）');
  console.log('远景落点 行' + spotWide.r + ' 列' + spotWide.c +
    ' → ' + Math.round(spotWide.cx) + ',' + Math.round(spotWide.cy) +
    '  山' + spotWide.mtn + '/水' + spotWide.wat + '/平地' + spotWide.plain +
    '  抬升 ' + spotWide.lo + ' ~ ' + spotWide.hi + 'px');
  console.log('近景落点 行' + spotNear.r + ' 列' + spotNear.c +
    ' → ' + Math.round(spotNear.cx) + ',' + Math.round(spotNear.cy) +
    '  山' + spotNear.mtn + '/水' + spotNear.wat + '/平地' + spotNear.plain +
    '  抬升 ' + spotNear.lo + ' ~ ' + spotNear.hi + 'px');
  console.log('崖最密远景落点 行' + spotCliff.r + ' 列' + spotCliff.c +
    ' → ' + Math.round(spotCliff.cx) + ',' + Math.round(spotCliff.cy) +
    '  该窗口崖边 ' + spotCliff.n + ' 条');
  console.log('崖最密近景落点 行' + spotCliffNear.r + ' 列' + spotCliffNear.c +
    ' → ' + Math.round(spotCliffNear.cx) + ',' + Math.round(spotCliffNear.cy) +
    '  该窗口崖边 ' + spotCliffNear.n + ' 条');
}

main();
