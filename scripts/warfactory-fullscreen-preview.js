'use strict';

/**
 * 生成「地图铺满整屏」的静态可视化预览页（docs/warfactory-fullscreen-preview.html）。
 *
 * 目的：`body.phase-game:has(#panel-warfactory:not([hidden]))` 这一大段 CSS
 * （地图铺满、顶部栏变浮层、说明文字收进 ? 浮层、聊天窗抬到指挥栏上面）
 * 桩测试完全查不出来 —— 它测的是「浏览器真实布局」。
 * 所以这里直接把 public/index.html 的真实页面骨架（.app / .app-top / .app-body /
 * #view-game / #game-panels / .chat-dock）搬进来，配上真实的 public/css/style.css，
 * 再把 panel.html + ui.js 内联进去，喂一局真实对局，最后用无头浏览器截图看。
 *
 * 用法：node scripts/warfactory-fullscreen-preview.js
 * 截图：chrome --headless=new --window-size=1920,1080 \
 *         --screenshot=docs/warfactory-fullscreen-preview.png \
 *         "file:///…/docs/warfactory-fullscreen-preview.html"
 * 查询串：
 *   ?help=1        右上角「规则与操作」浮层默认展开
 *   ?pick=unit     点选一支我方部队（看右栏「单位详情」的属性面板）
 *   ?pick=fac|hq   点选自家工厂 / 总部（看右栏的产能 / 加速面板）
 *   ?utype=burn    配合 pick=unit 指定兵种（warrior/shield/ranger/burst/burn/laser）
 *
 * 页面左下角的读数徽标里会打出右栏的**溢出量**（scrollHeight - clientHeight），
 * 用来核对「不用滚动就能看全所有元素」——这是纯 CSS 布局问题，桩测试查不出来。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));

/** 造一局「有厂有所有部队」的对局，让 HUD 四角与指挥栏三栏都有东西可画 */
function buildGame() {
  const g = wf.createGameState({
    id: 'fullscreen-preview',
    players: [
      { id: 'p0', name: '墨客' },
      { id: 'p1', name: '砚台' },
    ],
  });
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  g.units.length = 0;

  g.factories[0].owner = 0;
  g.factories[1].owner = 0;
  g.factories[2].owner = 1;
  g.labs[0].owner = 0;
  g.labs[1].owner = 0;
  g.labs[2].owner = 1;
  for (const f of g.factories) f.hp = f.hpMax;
  g.hqs[0].hp = Math.round(g.hqs[0].hpMax * 0.8);
  g.hqs[1].hp = Math.round(g.hqs[1].hpMax * 0.31);

  g.players[0].rp = 620;
  g.players[0].rpPerPeriod = 4;
  g.players[0].rpAccMs = 1500;
  g.players[0].kills = 8;
  g.players[0].losses = 3;
  g.players[0].evolved = 2;
  g.players[0].captured = 4;
  g.players[1].kills = 4;
  g.players[1].losses = 6;

  g.factories[0].lines = 3;
  g.factories[0].prodProg = 0.42;
  g.factories[0].prodType = 'shield';
  g.factories[0].level = 3;
  g.factories[0].rally = { x: g.factories[0].x + 120, y: g.factories[0].y + 90 };
  g.hqs[0].speedLv = 3;

  const hq = g.hqs[0];
  const kit = [
    ['warrior', 1, ''], ['warrior', 3, 'A'], ['shield', 2, 'B'], ['shield', 3, ''], ['ranger', 2, 'A'],
    ['burst', 1, ''], ['burst', 3, 'B'], ['burn', 2, ''], ['laser', 3, 'A'], ['laser', 1, ''],
    ['ranger', 1, ''], ['warrior', 2, 'B'],
  ];
  let uid = 1;
  kit.forEach(([type, tier, branch], i) => {
    const col = i % 4;
    const rowI = Math.floor(i / 4);
    const u = wf.__test.spawnUnit(g, { id: uid++, owner: 0, level: 1 }, type, hq.x - 90 + col * 60, hq.y + 110 + rowI * 58);
    if (!u) return;
    u.tier = tier;
    u.branch = tier > 1 ? branch || 'A' : '';
    u.hp = Math.round(u.maxHp * 0.7);
  });
  for (let i = 0; i < 4; i++) {
    wf.__test.spawnUnit(g, { id: uid++, owner: 1, level: 1 }, i % 2 ? 'shield' : 'ranger', hq.x + 260 + i * 46, hq.y - 90 - i * 30);
  }
  return g;
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
    // 只认「对角 + 平移非零」的变换：世界变换是 (k,0,0,k,-cam.x*k,-cam.y*k)，
    // 而 HUD / 小地图的重置是 (dpr,0,0,dpr,0,0)——平移为零，不能拿来覆盖 cam。
    var cam = null;
    var rawGet = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind) {
      var c = rawGet.apply(this, arguments);
      if (kind === '2d' && c && !c.__wfProbe) {
        c.__wfProbe = 1;
        var raw = c.setTransform.bind(c);
        c.setTransform = function (a, b, cc, dd, e, f) {
          if (a === dd && b === 0 && cc === 0 && a > 0.2 && (e !== 0 || f !== 0)) {
            cam = { k: a, x: -e / a, y: -f / a };
          }
          return raw(a, b, cc, dd, e, f);
        };
      }
      return c;
    };

    // —— 把页面切到「对局中」这一态：游戏视图亮起、其余视图收掉 ——
    var hide = function (id) { var el = document.getElementById(id); if (el) el.hidden = true; };
    var show = function (id) { var el = document.getElementById(id); if (el) el.hidden = false; };
    hide('view-lobby'); hide('view-room'); hide('lobby-people-aside');
    hide('lobby-gate'); hide('lobby-main');
    show('view-game');

    // 顶部栏：菜单按钮 + 对局计时。中间那段标题（app-top-mid）与观战按钮故意「亮着」，
    // 因为 CSS 就是靠 phase-game:has(#panel-warfactory) 把它们压掉的 —— 亮着才测得出那条规则。
    show('match-clock');
    var t = document.getElementById('match-clock-time'); if (t) t.textContent = '12:34';
    show('spectators-watch');
    show('header-nick');
    var nd = document.getElementById('nick-display'); if (nd) nd.textContent = '墨客';

    // 聊天窗也亮起来：检查它有没有被抬到指挥栏上面（否则会压住「单位粗览」）
    show('chat-dock');
    var log = document.getElementById('chat-log');
    if (log) {
      ['开局，先占研究所。', '对面的盾卫好硬…'].forEach(function (txt) {
        var li = document.createElement('li');
        li.className = 'chat-line';
        li.textContent = txt;
        log.appendChild(li);
      });
    }

    // —— 挂载战争工厂面板（真身是 boot-games 干的活）——
    var gp = document.getElementById('game-panels');
    gp.innerHTML = window.__WF_PANEL__;
    document.getElementById('panel-warfactory').hidden = false;

    // —— 喂一局真数据，让 HUD / 指挥栏 / 小地图都画上东西 ——
    var net = { on: function () {}, sendRt: function () {} };
    window.WarFactoryUi.render(d.state, net, { meId: 'p0', isSpectator: false, title: '战争工厂' });
    window.WarFactoryUi.applySnapshot(d.snap);

    var qs = String(location.search || '');
    if (qs.indexOf('help=1') >= 0) {
      var btn = document.getElementById('wf-help-btn');
      if (btn) btn.click();
    }

    // ---- 点选一个目标，让右栏「单位详情」真的填上内容 ----
    // 先把镜头甩到目标上（点小地图），再点主战场 —— 免得目标落在视口外。
    function mmFocus(wx, wy) {
      var mm = document.getElementById('warfactory-minimap');
      var w = d.state.world.w;
      var h = d.state.world.h;
      var r = mm.getBoundingClientRect();
      var ev = function (type) {
        mm.dispatchEvent(new MouseEvent(type, {
          bubbles: true, button: 0, clientX: r.left + (wx / w) * r.width, clientY: r.top + (wy / h) * r.height,
        }));
      };
      ev('mousedown');
      ev('mouseup');
    }
    function clickWorld(wx, wy) {
      if (!cam) return false;
      var cv = document.getElementById('warfactory-canvas');
      var r = cv.getBoundingClientRect();
      var x = r.left + (wx - cam.x) * cam.k;
      var y = r.top + (wy - cam.y) * cam.k;
      ['mousedown', 'mouseup'].forEach(function (type) {
        cv.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
      });
      return true;
    }
    var pick = (qs.match(/pick=(\\w+)/) || [])[1] || '';
    var utype = (qs.match(/utype=(\\w+)/) || [])[1] || 'burn';
    var UTYPE_IX = { warrior: 0, shield: 1, ranger: 2, burst: 3, burn: 4, laser: 5 };
    var pendingPick = null;
    if (pick === 'fac' || pick === 'hq') {
      var src = pick === 'fac' ? d.state.factories : d.state.hqs;
      var tgt = (src || []).filter(function (q) { return q.owner === 0; })[0];
      if (tgt) { mmFocus(tgt.x, tgt.y); pendingPick = { x: tgt.x, y: tgt.y }; }
    } else if (pick === 'unit') {
      var rows = d.snap.u || [];
      var want = UTYPE_IX[utype] == null ? 4 : UTYPE_IX[utype];
      var hit = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][1] === 0 && rows[i][5] === want) { hit = rows[i]; break; }
      }
      if (!hit) for (var j = 0; j < rows.length; j++) { if (rows[j][1] === 0) { hit = rows[j]; break; } }
      if (hit) { mmFocus(hit[2], hit[3]); pendingPick = { x: hit[2], y: hit[3] }; }
    }

    var n = 0;
    (function paint() {
      window.WarFactoryUi.applySnapshot(d.snap);
      n++;
      // 第 2 帧才点：那时 cam 已经被渲染帧填好了
      if (n === 2 && pendingPick) { clickWorld(pendingPick.x, pendingPick.y); }
      if (n < 5) { requestAnimationFrame(paint); return; }

      // 把布局读数写成页面上的小徽标，截图里就能直接读，不用 dump-dom
      var cv = document.getElementById('warfactory-canvas');
      var rc = cv.getBoundingClientRect();
      var cb = document.querySelector('.warfactory-cmdbar');
      var rb = cb ? cb.getBoundingClientRect() : { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 };
      var mid = document.querySelector('.app-top-mid');
      var spec = document.getElementById('spectators-watch');
      var chat = document.getElementById('chat-dock');
      var rchat = chat ? chat.getBoundingClientRect() : null;
      var vis = function (el) {
        if (!el) return 'none';
        var s = getComputedStyle(el);
        if (s.display === 'none') return 'none';
        var r = el.getBoundingClientRect();
        return Math.round(r.width) + 'x' + Math.round(r.height);
      };
      var help = document.getElementById('wf-help');
      // 右栏「单位详情」的布局读数：溢出量 = scrollHeight - clientHeight，
      // 只要 > 0 就说明「得滚动才看得全」，正是要修的东西。
      var det = document.getElementById('warfactory-detail-sec');
      var rd = det ? det.getBoundingClientRect() : { left: 0, right: 0, width: 0 };
      var body = document.querySelector('.wdt-body');
      var facp = document.getElementById('warfactory-facpanel');
      var unp = document.getElementById('warfactory-unitpanel');
      var shot = function (el) {
        if (!el || el.hidden) return 'hidden';
        return Math.round(el.getBoundingClientRect().height) + 'px';
      };
      var ovf = function (el) {
        if (!el) return -1;
        return el.scrollHeight - el.clientHeight;
      };
      var ovSec = document.getElementById('warfactory-ov-sec');
      var probe = document.getElementById('wfp-fs-probe');
      if (!probe) {
        probe = document.createElement('div');
        probe.id = 'wfp-fs-probe';
        probe.style.cssText =
          'position:fixed;left:8px;bottom:8px;z-index:99999;max-width:560px;' +
          'background:#111;color:#0f0;font:12px/1.45 monospace;padding:6px 9px;border-radius:4px;white-space:pre-wrap;';
        document.body.appendChild(probe);
      }
      // ?probe=0：截图时把这块读数徽标藏起来（真实页面本来就没有它）
      probe.style.display = qs.indexOf('probe=0') >= 0 ? 'none' : '';
      probe.textContent =
        'viewport=' + innerWidth + 'x' + innerHeight +
        '\\ncanvas=' + Math.round(rc.width) + 'x' + Math.round(rc.height) +
        ' @(' + Math.round(rc.left) + ',' + Math.round(rc.top) + ')  rem=' +
        (innerWidth - Math.round(rc.right)) + ',' + (innerHeight - Math.round(rc.bottom)) +
        '\\ncmdbar=' + vis(cb) + ' @y' + Math.round(rb.top) + '→' + Math.round(rb.bottom) +
        '\\napp-top-mid=' + vis(mid) + '  spectators=' + vis(spec) +
        '\\nmatch-clock=' + vis(document.getElementById('match-clock')) +
        '  menu-btn=' + vis(document.getElementById('btn-game-menu')) +
        '\\nhelp=' + (help && !help.hidden ? 'open ' + vis(help) : 'closed') +
        '\\nchat-dock=' + vis(chat) + (rchat ? ' bottom→' + Math.round(innerHeight - rchat.bottom) : '') +
        '\\n-- 右栏详情 --' +
        '\\ndetail x' + Math.round(rd.left) + '→' + Math.round(rd.right) + ' w' + Math.round(rd.width) +
        '  ovsec=' + (ovSec && !ovSec.hidden ? 'shown' : 'hidden') +
        '  wide=' + (det && det.classList.contains('is-wide') ? 'Y' : 'N') +
        '\\nwdt-body h' + (body ? body.clientHeight : -1) + '  溢出 ' + ovf(body) + 'px' +
        '\\nfacpanel=' + shot(facp) + '  unitpanel=' + shot(unp) +
        '  (内容 ' + (facp && !facp.hidden ? facp.scrollHeight : unp && !unp.hidden ? unp.scrollHeight : 0) + 'px)';
      document.title = 'ready-flat';

      // ?dump=1：把右栏里每个子元素的高度逐个打出来（设计「不滚动」布局时用的量具）
      if (qs.indexOf('dump=1') >= 0) {
        var box = facp && !facp.hidden ? facp : unp;
        var rows2 = '';
        if (box) {
          for (var ci = 0; ci < box.children.length; ci++) {
            var ch = box.children[ci];
            if (getComputedStyle(ch).display === 'none') continue;
            rows2 += '\\n  ' + (ch.id || ch.className) + ' h' + Math.round(ch.getBoundingClientRect().height);
          }
        }
        var gr = document.getElementById('warfactory-overview');
        rows2 += '\\n  [ov-grid] h' + (gr ? Math.round(gr.getBoundingClientRect().height) : -1) +
          ' scroll' + (gr ? gr.scrollHeight : -1) + ' client' + (gr ? gr.clientHeight : -1);
        probe.textContent += '\\n-- dump --' + rows2;
      }
    })();
  } catch (err) { fail((err && err.message) || err); }
})();
`;

function main() {
  const g = buildGame();
  const state = wf.publicGameState(g);
  const snap = wf.snapshot(g);

  const shellCss = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');
  const panel = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');
  const shell = extractShell();

  const data = JSON.stringify({ state, snap });

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>战争工厂 · 铺满整屏预览</title>
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

  const out = path.join(ROOT, 'docs/warfactory-fullscreen-preview.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, 'utf8');
  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log('wrote ' + path.relative(ROOT, out) + ' (' + kb + ' KB)');
  console.log('我方部队 ' + snap.u.filter((r) => r[1] === 0).length + ' 支 / 敌方 ' + snap.u.filter((r) => r[1] === 1).length + ' 支');
}

main();
