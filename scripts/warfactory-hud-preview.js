'use strict';

/**
 * 生成「底部指挥栏」的静态可视化预览页（docs/warfactory-hud-preview.html）。
 *
 * 目的：CSS 布局 / 三栏比例 / 小地图画布 / 右栏四态（我方概况 / 单位 / 工厂 / 总部）
 * 这类问题，vm + 假 DOM 的用例查不出来，必须在真实浏览器里看一眼。
 * 这里用服务端真实 publicGameState + snapshot 喂给客户端 ui.js，
 * 把 panel.html / style.css / ui.js 全部内联成单文件，免得 file:// 下的 fetch 被 CORS 拦掉。
 *
 * 用法：node scripts/warfactory-hud-preview.js
 * 页面按 URL 查询串切态：?mode=self（默认）| unit | fac | hq；?fx=1 交火态；?burn=1 燎原喷火态
 * 截图：chrome --headless=new --screenshot=docs/x.png "file:///…/warfactory-hud-preview.html?mode=fac"
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));

function buildGame() {
  const g = wf.createGameState({
    id: 'hud-preview',
    players: [
      { id: 'p0', name: '墨客' },
      { id: 'p1', name: '砚台' },
    ],
  });
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  g.units.length = 0;

  // 归属：本方 2 厂 2 所，敌方 1 厂 1 所，其余保持中立
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

  // 产能升级演示：3 条产线 + 3 级生产加速
  g.factories[0].lines = 3;
  g.factories[0].prodProg = 0.42;
  g.factories[0].prodType = 'shield';
  g.factories[0].level = 3;
  g.factories[0].rally = { x: g.factories[0].x + 120, y: g.factories[0].y + 90 };
  g.hqs[0].speedLv = 3;

  // 本方部队：六兵种 × 三阶，铺在总部前面
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
    const x = hq.x - 90 + col * 60;
    const y = hq.y + 110 + rowI * 58;
    const u = wf.__test.spawnUnit(g, { id: uid++, owner: 0, level: 1 }, type, x, y);
    u.tier = tier;
    u.branch = tier > 1 ? branch || 'A' : '';
    u.hp = Math.round(u.maxHp * 0.7);
  });
  // 敌方来几支，让战场不至于空
  for (let i = 0; i < 4; i++) {
    wf.__test.spawnUnit(g, { id: uid++, owner: 1, level: 1 }, i % 2 ? 'shield' : 'ranger', hq.x + 260 + i * 46, hq.y - 90 - i * 30);
  }
  return g;
}

/** 页面里跑的驱动脚本（内联进 HTML，浏览器执行） */
const RUNNER = `
(function () {
  var statusEl = document.getElementById('game-status');
  function fail(msg) { document.title = 'PREVIEW-ERROR ' + msg; }
  window.onerror = function (m) { fail(m); };
  try {
  var ui = window.WarFactoryUi;
  var d = window.__WF__;
  var WW = d.state.world.w, WH = d.state.world.h;

  // ---- 拦 2D 上下文的 setTransform，记下最后一帧的世界变换，用来把世界坐标换算成屏幕坐标 ----
  // 只认「对角 + 平移非零」的变换：世界变换是 (kk,0,0,kk,-cam.x*kk,-cam.y*kk)，
  // 而 HUD/小地图的重置是 (dpr,0,0,dpr,0,0)——平移为零，不能拿来覆盖 cam。
  var cam = null;
  var camLog = []; // 最近几次世界变换（[k, camX, camY]），用来核对「渲染相机」是否真的动了
  var rawGet = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind) {
    var c = rawGet.apply(this, arguments);
    if (kind === '2d' && c && !c.__wfProbe) {
      c.__wfProbe = 1;
      var raw = c.setTransform.bind(c);
      c.setTransform = function (a, b, cc, dd, e, f) {
        if (a === dd && b === 0 && cc === 0 && a > 0.2 && (e !== 0 || f !== 0)) {
          cam = { k: a, x: -e / a, y: -f / a };
          camLog.push([a, cam.x, cam.y]);
          if (camLog.length > 10) camLog.shift();
        }
        return raw(a, b, cc, dd, e, f);
      };
    }
    return c;
  };

  document.getElementById('panel-warfactory').hidden = false;
  var net = { on: function () {}, sendRt: function () {} };
  ui.render(d.state, net, { meId: 'p0', isSpectator: false, title: '战争工厂' });
  ui.applySnapshot(d.snap);

  var mode = (String(location.search).match(/mode=(\\w+)/) || [])[1] || 'self';
  var qs = String(location.search);
  var wheelDy = Number((qs.match(/wheel=(-?\\d+)/) || [])[1] || 0);
  // ?mode=pad&pad=1：换成四方同框那一局（2 人局里看不到黄/绿两方的底色）
  var STATE = d.state;
  var SNAP = d.snap;
  if (qs.indexOf('pad=1') >= 0) {
    STATE = d.padState;
    SNAP = d.padSnap;
    ui.render(STATE, net, { meId: 'p0', isSpectator: false, title: '战争工厂' });
    ui.applySnapshot(SNAP);
  }
  var foeKind = (qs.match(/foe=(\\w+)/) || [])[1] || '';
  // ?burn=1：燎原喷火态（火舌 + 灼烧地形）。火场寿命是相对真实时钟算的，
  // 所以这一局是拿 Date.now() 真跑出来的，不能像别的模式那样喂假时间。
  if (qs.indexOf('burn=1') >= 0) {
    STATE = d.burnState;
    SNAP = d.burnSnap;
    ui.render(STATE, net, { meId: 'r0', isSpectator: false, title: '战争工厂' });
    ui.applySnapshot(SNAP);
  }
  // ?fx=1：真实交火态。开火事件只在「喂快照那一帧」生效一次 ——
  // 枪口焰是 170~240ms 的短促动画，若每帧都重喂事件，焰会永远停在 age=0
  // （那时焰还没张开，alpha 是 0），截图上就什么都看不到。
  if (qs.indexOf('fx=1') >= 0) {
    STATE = d.fxState;
    ui.render(STATE, net, { meId: 'q0', isSpectator: false, title: '战争工厂' });
    ui.applySnapshot(d.fxSnap);
    SNAP = Object.assign({}, d.fxSnap, { ev: [] });
  }
  /** 取一件「不是我的」目标（坐标由 main() 塞进 d.foes，publicGameState 不带单位） */
  function pickFoe(kind) {
    return (d.foes && d.foes[kind]) || null;
  }

  // 真实 WheelEvent：验证滚轮缩放（桩测试碰不到 passive/preventDefault 这类浏览器行为）
  function wheelTo(dy) {
    var cv = document.getElementById('warfactory-canvas');
    var r = cv.getBoundingClientRect();
    cv.dispatchEvent(new WheelEvent('wheel', {
      deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    }));
  }
  // 真实 KeyboardEvent：客户端按 evt.code 分支，所以要给 code 传 Space
  function pressSpace() {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }));
  }
  /** 真实键盘事件：数字键编队用的就是这条路径 */
  function pressKey(code, shift) {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: code, bubbles: true, cancelable: true, shiftKey: Boolean(shift),
    }));
  }

  function ev(type, el, x, y) {
    el.dispatchEvent(new MouseEvent(type, {
      bubbles: true, button: 0, clientX: x, clientY: y,
      preventDefault: function () {}, shiftKey: false,
    }));
  }
  // 先点小地图把镜头挪过去，再点主战场 —— 免得目标落在视口外
  function focus(wx, wy) {
    var mm = document.getElementById('warfactory-minimap');
    var r = mm.getBoundingClientRect();
    ev('mousedown', mm, r.left + (wx / WW) * r.width, r.top + (wy / WH) * r.height);
    ev('mouseup', mm, r.left + (wx / WW) * r.width, r.top + (wy / WH) * r.height);
  }
  function clickWorld(wx, wy) {
    if (!cam) return false;
    var cv = document.getElementById('warfactory-canvas');
    var r = cv.getBoundingClientRect();
    ev('mousedown', cv, r.left + (wx - cam.x) * cam.k, r.top + (wy - cam.y) * cam.k);
    ev('mouseup', cv, r.left + (wx - cam.x) * cam.k, r.top + (wy - cam.y) * cam.k);
    return true;
  }
  function pickUnit() {
    var ov = document.getElementById('warfactory-overview');
    var t = ov && ov.children[0];
    if (t && String(t.className || '').indexOf('wov-tile') >= 0) {
      t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    }
    return false;
  }

  function inView(wx, wy) {
    if (!cam) return false;
    var cv = document.getElementById('warfactory-canvas');
    var r = cv.getBoundingClientRect();
    var sx = r.left + (wx - cam.x) * cam.k;
    var sy = r.top + (wy - cam.y) * cam.k;
    return sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom;
  }

  var settle = 0;
  (function warmup() {
    ui.applySnapshot(SNAP);
    if (++settle < 3) { requestAnimationFrame(warmup); return; }
    // 无头截图模式下 rAF 帧数有限（约 6~8 帧），动作要压在前几帧完成
    var wx = 0, wy = 0;
    var panInfo = null;
    var pendingPan = false;
    if (mode === 'fac') {
      var mineF = STATE.factories.filter(function (q) { return q.owner === 0; });
      var f = mineF.filter(function (q) { return inView(q.x, q.y); })[0] || mineF[0];
      wx = f.x; wy = f.y;
      if (!inView(wx, wy)) focus(wx, wy); // 兜底：不在视口内就先用小地图挪镜头
    } else if (mode === 'hq') {
      var h = STATE.hqs.filter(function (q) { return q.owner === 0; })[0];
      wx = h.x; wy = h.y;
      if (!inView(wx, wy)) focus(wx, wy);
    } else if (mode === 'unit') {
      pickUnit();
    }
    if (mode === 'fac' || mode === 'hq') clickWorld(wx, wy);
    var pendingClick = null;
    if (foeKind) {
      // 先把镜头挪到目标上（下一帧才点，否则探针里的 cam 还是旧的）
      var tgt = pickFoe(foeKind);
      if (tgt) {
        pendingClick = { x: tgt.x, y: tgt.y };
        focus(tgt.x, tgt.y);
      } else {
        document.title = 'PREVIEW-ERROR 没有可侦察的 ' + foeKind;
      }
    }
    // ?mode=zoom&wheel=-600（负=放大）｜?space=1 让镜头回总部；二者可同时给
    if (wheelDy) wheelTo(wheelDy);
    if (qs.indexOf('space=1') >= 0) {
      // 先把镜头甩到世界左上角，再按空格——这样才能看出「空格把镜头拉回总部」
      focus(WW * 0.12, WH * 0.12);
      pressSpace();
    }
    // ?squad=pre：只把镜头甩到远角（「连按两下」之前的对照态）
    if (qs.indexOf('squad=pre') >= 0) {
      focus(WW * 0.12, WH * 0.12);
    }
    // ?squad=1：F2 全选 → Shift+1 编入 1 号 → 把镜头甩到远角 → 连按两下 1
    // 探针会打出编队首支部队应有的屏幕位置，与画布中心比对即知「镜头是否飞过去了」
    if (qs.indexOf('squad=1') >= 0) {
      pressKey('F2');
      pressKey('Digit1', true); // Shift+1 = 编入
      focus(WW * 0.12, WH * 0.12); // 先甩到远角，才看得出镜头被拉回来
      pressKey('Digit1'); // 第一下：只选中
      pressKey('Digit1'); // 第二下：连按 → 镜头飞到编队首支部队
    }
    // ?pan=1：先把镜头甩到地图中央（离四边都远），下一帧再按住中键拖一段距离。
    // 真实 MouseEvent(button:1)，顺带记录 mousedown 有没有被 preventDefault ——
    // 这正是「浏览器中键自动滚动被掐掉」的判据
    if (qs.indexOf('pan=1') >= 0) {
      pendingPan = true;
      focus(WW * 0.5, WH * 0.5);
    }
    // ?mode=pad&pad=1：镜头落到四方列阵正中，并点选一支自家部队（看选中光环 + 四角方框）
    if (qs.indexOf('pad=1') >= 0) {
      focus(d.padCenter.x, d.padCenter.y);
      if (d.padPick) pendingClick = { x: d.padPick.x, y: d.padPick.y };
    }
    // ?fx=1：镜头对准交火线正中；?fxpick=1 顺带选中一支自家部队（顺便看后坐）
    if (qs.indexOf('burn=1') >= 0) {
      // ?burn=1：镜头对准三支燎原中间的喷火线，并点选中间那支（顺便看面板里的火焰/灼烧数值）
      focus(d.burnCenter.x - 40, d.burnCenter.y);
      if (qs.indexOf('burnpick=1') >= 0) {
        for (var bi = 0; bi < (SNAP.u || []).length; bi++) {
          if (SNAP.u[bi][1] === 0 && SNAP.u[bi][5] === 4) {
            pendingClick = { x: SNAP.u[bi][2], y: SNAP.u[bi][3] };
            break;
          }
        }
      }
    }
    if (qs.indexOf('fx=1') >= 0) {
      focus(d.fxCenter.x, d.fxCenter.y);
      if (qs.indexOf('fxpick=1') >= 0) {
        var mineFx = [];
        for (var si = 0; si < (SNAP.u || []).length; si++) {
          if (SNAP.u[si][1] === 0) mineFx.push({ oi: 0, x: SNAP.u[si][2], y: SNAP.u[si][3] });
        }
        if (mineFx.length) pendingClick = { x: mineFx[0].x, y: mineFx[0].y };
      }
    }
    var n2 = 0;
    (function paint() {
      ui.applySnapshot(SNAP);
      if (pendingClick && n2 >= 1) {
        var pc = pendingClick;
        pendingClick = null;
        clickWorld(pc.x, pc.y);
      }
      if (pendingPan && n2 >= 1) {
        pendingPan = false;
        try {
          var cvP = document.getElementById('warfactory-canvas');
          var rP = cvP.getBoundingClientRect();
          var sxP = rP.left + rP.width * 0.5;
          var syP = rP.top + rP.height * 0.5;
          var mDown = new MouseEvent('mousedown', {
            bubbles: true, cancelable: true, button: 1, buttons: 4, clientX: sxP, clientY: syP,
          });
          panInfo = { sx: 200, sy: 130, before: cam ? { k: cam.k, x: cam.x, y: cam.y } : null, pre: null };
          cvP.dispatchEvent(mDown);
          panInfo.pre = mDown.defaultPrevented;
          window.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true, cancelable: true, button: 1, buttons: 4, clientX: sxP + panInfo.sx, clientY: syP + panInfo.sy,
          }));
          window.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true, cancelable: true, button: 1, buttons: 0, clientX: sxP + panInfo.sx, clientY: syP + panInfo.sy,
          }));
        } catch (ePan) {
          panInfo = { err: String((ePan && ePan.message) || ePan) };
        }
      }
      if (++n2 < 4) { requestAnimationFrame(paint); return; }
      document.title = 'ready-' + mode +
        ' k=' + (cam ? cam.k.toFixed(3) : '?') +
        ' cam=' + (cam ? Math.round(cam.x) + ',' + Math.round(cam.y) : '?');
      // dump-dom 拿不到运行后的 DOM，所以把镜头探针写进页面左上角，截图即可读数
      var hq0 = STATE.hqs.filter(function (q) { return q.owner === 0; })[0];
      var probe = document.getElementById('wfp-zoomprobe');
      if (!probe) {
        probe = document.createElement('div');
        probe.id = 'wfp-zoomprobe';
        probe.style.cssText = 'position:fixed;left:270px;top:8px;background:#fff;color:#000;font:13px monospace;padding:2px 8px;z-index:99999;border:1px solid #000;';
        document.body.appendChild(probe);
      }
      var cvp = document.getElementById('warfactory-canvas').getBoundingClientRect();
      var f1 = camLog[0], fN = camLog[camLog.length - 1];
      var fmt = function (m) { return m ? (m[0].toFixed(2) + '@' + Math.round(m[1]) + ',' + Math.round(m[2])) : '?'; };
      var hqScr = fN ? (Math.round(cvp.left + (hq0.x - fN[1]) * fN[0]) + ',' + Math.round(cvp.top + (hq0.y - fN[2]) * fN[0])) : '?';
      // 编队首支部队（id 最小那支）落在画布的哪个位置：越接近画布中心 = 镜头越准
      var sf = d.squadFirst;
      var sqScr = (sf && fN) ? (Math.round(cvp.left + (sf.x - fN[1]) * fN[0]) + ',' + Math.round(cvp.top + (sf.y - fN[2]) * fN[0])) : '?';
      var ctr = Math.round(cvp.left + cvp.width / 2) + ',' + Math.round(cvp.top + cvp.height / 2);
      probe.textContent = 'frames=' + camLog.length +
        ' first=' + fmt(f1) + ' last=' + fmt(fN) +
        ' cvp=' + Math.round(cvp.width) + 'x' + Math.round(cvp.height) +
        ' hq0scr=' + hqScr +
        ' sq1=' + (sf ? sf.x + ',' + sf.y : '?') +
        ' sq1scr=' + sqScr + ' cvctr=' + ctr;
      if (qs.indexOf('fx=1') >= 0) {
        // 交火态读数：这一帧画了几发弹、场上有几支兵、喂进去多少条事件
        probe.textContent = 'FX bullets=' + ((SNAP.b || []).length) +
          ' units=' + ((SNAP.u || []).length) +
          ' events=' + ((d.fxSnap.ev || []).length) +
          ' k=' + (cam ? cam.k.toFixed(2) : '?') +
          ' cam=' + (cam ? Math.round(cam.x) + ',' + Math.round(cam.y) : '?');
      }
      if (panInfo && panInfo.err) {
        probe.textContent = 'PAN-ERROR ' + panInfo.err;
      } else if (panInfo && panInfo.before && fN) {
        // 手移 → 画面位移：地图 1:1 跟手时两者应完全相等
        probe.textContent =
          'PAN mDownPrevented=' + panInfo.pre +
          ' hand=' + panInfo.sx + ',' + panInfo.sy +
          ' camBefore=' + Math.round(panInfo.before.x) + ',' + Math.round(panInfo.before.y) +
          ' camAfter=' + Math.round(fN[1]) + ',' + Math.round(fN[2]) +
          ' mapMovedOnScreen=' +
          Math.round((panInfo.before.x - fN[1]) * fN[0]) + ',' +
          Math.round((panInfo.before.y - fN[2]) * fN[0]);
      }
    })();
  })();
  } catch (err) { fail(err && err.message); }
})();
`;

/**
 * ?pad=1 专用：四方同框。
 * 「不同玩家压不同归属底色（红/蓝/黄/绿，60% 透明）」这种事只有把四方摆进同一屏才看得清，
 * 所以这里另造一局 4 人局，围着世界中心铺开，各自带伤（顺带看血条）。
 */
function buildPadGame() {
  const g = wf.createGameState({
    id: 'pad-preview',
    players: [
      { id: 'p0', name: '墨客' },
      { id: 'p1', name: '砚台' },
      { id: 'p2', name: '青瓷' },
      { id: 'p3', name: '竹影' },
    ],
  });
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  g.units.length = 0;
  const cx = Math.round(g.world.w / 2);
  const cy = Math.round(g.world.h / 2);
  for (let i = 0; i < 4; i++) {
    const f = g.factories[i];
    if (f) {
      f.owner = i;
      f.hp = Math.round(f.hpMax * (1 - i * 0.18)); // 各厂血量不同，顺带看工厂血条
      f.level = 1 + (i % 3);
    }
  }
  const kinds = ['warrior', 'shield', 'ranger', 'burst', 'burn', 'laser'];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 4; k++) {
      const type = kinds[(i * 4 + k) % kinds.length];
      const x = cx - 165 + i * 110 + (k % 2) * 52;
      const y = cy - 70 + Math.floor(k / 2) * 74;
      // spawnUnit 的第二个参数是「生产它的厂」——只用来定 owner / level，厂 id 不影响
      const u = wf.__test.spawnUnit(g, { id: i, owner: i, level: 1 }, type, x, y);
      if (!u) continue;
      u.tier = 1 + (k % 3);
      u.branch = u.tier > 1 ? 'A' : '';
      u.hp = Math.round(u.maxHp * (0.35 + 0.2 * k));
    }
  }
  return g;
}

/**
 * ?fx=1 专用：真实交火态。
 * 「子弹是一滴拖笔的墨而不是圆点」「命中像水球炸开」「开火有枪口焰与后坐」这类事，
 * 桩测试只能量出「画了东西」，好不好看必须在真浏览器里看图。
 * 这里不手搓特效，而是真的把一局推进一段（走真实的索敌/开火/弹道/命中），
 * 再抓一帧两军对射中的快照 —— 子弹在哪、谁在开火、地上哪儿被打过，全是真的。
 */
function findClearing(g, minFromBuildings) {
  const tr = g.terrain;
  const blocks = [...g.factories, ...g.labs, ...g.hqs].map((b) => [b.x, b.y]);
  const free = (r, c) =>
    r >= 0 && c >= 0 && r < tr.rows && c < tr.cols && tr.grid[r][c] !== 2 && tr.grid[r][c] !== 4;
  /** 交火线占 9 格宽 × 5 格高，整块都要能站人（截图才是一片开阔的战场，而不是挤在山缝里） */
  const freeBlock = (r, c) => {
    for (let dr = 0; dr < 5; dr++) {
      for (let dc = 0; dc < 9; dc++) if (!free(r + dr, c + dc)) return false;
    }
    return true;
  };
  for (let r = 8; r < tr.rows - 16; r++) {
    for (let c = 8; c < tr.cols - 16; c++) {
      if (!freeBlock(r, c)) continue;
      const x = (c + 0.5) * tr.cell;
      const y = (r + 0.5) * tr.cell;
      // 离世界四边也要够远：镜头是中心对齐的，贴着边会让交火线被挤到画面角落
      if (x < 760 || y < 560 || x > g.world.w - 760 || y > g.world.h - 560) continue;
      if (blocks.some((b) => Math.hypot(b[0] - x, b[1] - y) < minFromBuildings)) continue;
      return { x, y };
    }
  }
  return { x: g.world.w / 2, y: g.world.h / 2 };
}

function buildFxGame() {
  const g = wf.createGameState({
    id: 'fx-preview',
    players: [
      { id: 'q0', name: '墨客' },
      { id: 'q1', name: '砚台' },
    ],
  });
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  g.units.length = 0;
  for (const f of g.factories) {
    f.owner = -1;
    f.hp = f.hpMax;
  }
  const c = findClearing(g, 420);
  // 两列面对面，一一对应（间距 120，燎原 120 射程也够得着）——
  // 这样每种兵都有各自的目标，快照里才会同时出现「弹道 + 枪口焰 + 炸开 + 弹痕」
  const mine = ['ranger', 'burst', 'laser', 'burn'];
  const foe = ['shield', 'ranger', 'burst', 'shield'];
  for (let i = 0; i < mine.length; i++) {
    const y = c.y - 165 + i * 110;
    const u = wf.__test.spawnUnit(g, { id: 0, owner: 0, level: 3 }, mine[i], c.x - 60, y);
    if (u) {
      u.tier = 2 + (i % 2);
      u.branch = 'A';
      u.angle = 0; // 朝右（敌方）
      u.hp = Math.round(u.maxHp * (0.45 + 0.2 * (i % 3)));
    }
    const v = wf.__test.spawnUnit(g, { id: 1, owner: 1, level: 3 }, foe[i], c.x + 60, y);
    if (v) {
      v.tier = 2 + ((i + 1) % 2);
      v.branch = 'B';
      v.angle = Math.PI; // 朝左（我方）
      v.hp = Math.round(v.maxHp * (0.4 + 0.2 * ((i + 2) % 3)));
    }
  }
  // 真跑一段：前 1.1 秒把事件丢掉（只要「打过之后」的战场状态），
  // 最后 0.6 秒的事件全部留着 —— 命中会在地上留弹痕，事件越多弹痕越能连成一片；
  // 再微调到「看得见弹道 + 有开火」的那一帧收快照
  let t = 1000;
  for (let i = 0; i < 22; i++) {
    t += 50;
    wf.__test.step(g, 0.05, t);
    wf.snapshot(g); // 丢弃旧事件
  }
  for (let i = 0; i < 12; i++) {
    t += 50;
    wf.__test.step(g, 0.05, t);
  }
  for (let i = 0; i < 40; i++) {
    t += 50;
    wf.__test.step(g, 0.05, t);
    // 激光是「直击」，同一 tick 里既 shot 又 hit、却没有任何弹体在飞 ——
    // 要的是「看得见弹道 + 枪口有火」的那一帧，所以非激光的开火与在飞弹体都得齐
    const shots = g.events.filter((e) => e.t === 'shot' && e.k !== 4).length;
    const hits = g.events.filter((e) => e.t === 'hit').length;
    if (shots >= 2 && hits >= 1 && g.bullets.length >= 2) break;
  }
  return { g, center: c };
}

/**
 * ?burn=1 专用：燎原喷火态。
 * 「火舌是不是一道道连续的带」「灼烧地形是不是一片贴着地烧的火场」「踩在火里的单位
 * 身上有没有火苗」这类事，桩测试只能量出「画了东西」；要在真浏览器里看一眼。
 * 这里不手搓特效：真跑一局（用**真实时钟**推进，因为火场寿命是相对真实时间算的），
 * 让两支部队真的对喷一段，再把那一刻的快照喂给客户端。
 */
function buildBurnGame() {
  const g = wf.createGameState({
    id: 'burn-preview',
    players: [
      { id: 'r0', name: '墨客' },
      { id: 'r1', name: '砚台' },
    ],
  });
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  g.units.length = 0;
  for (const f of g.factories) {
    f.owner = -1;
    f.hp = f.hpMax;
  }
  const c = findClearing(g, 420);
  // 三支**三级**燎原一字排开朝右喷（三级 + 攻击分支 = 火舌最长最粗、火场也最大）
  for (let i = 0; i < 3; i++) {
    const y = c.y - 195 + i * 130;
    const u = wf.__test.spawnUnit(g, { id: 0, owner: 0, level: 3 }, 'burn', c.x - 60, y);
    if (!u) continue;
    // 用 promoteUnit 真进化两次（不是直接改 tier）：属性/射程/火场参数都跟着走
    wf.__test.promoteUnit(g, u);
    wf.__test.promoteUnit(g, u);
    u.branch = 'A';
    u.angle = 0;
    u.hp = Math.round(u.maxHp * 0.8);
    // 每支燎原正前方站一支盾卫当靶子（火舌落点就在它脚下，也就是火场的中心）
    const v = wf.__test.spawnUnit(g, { id: 1, owner: 1, level: 2 }, 'shield', c.x + 40, y);
    if (v) {
      v.tier = 2;
      v.angle = Math.PI;
      v.hp = Math.round(v.maxHp * 0.7);
    }
  }
  // 最下面一排摆一支**一级**燎原打同样的目标：它一样喷火、一样烧人，
  // 但地上**不会**留下火场 —— 对着上面那三排三级的一眼就能看出「分阶解锁」。
  {
    const y1 = c.y + 205;
    const u1 = wf.__test.spawnUnit(g, { id: 0, owner: 0, level: 3 }, 'burn', c.x - 60, y1);
    if (u1) {
      u1.angle = 0;
      u1.hp = Math.round(u1.maxHp * 0.75);
    }
    const v1 = wf.__test.spawnUnit(g, { id: 1, owner: 1, level: 2 }, 'shield', c.x + 40, y1);
    if (v1) {
      v1.tier = 2;
      v1.angle = Math.PI;
      v1.hp = Math.round(v1.maxHp * 0.6);
    }
  }
  // 自己人也站进火里一支：验证「灼烧地形敌我通吃」在画面上是什么样（身上会冒火苗）
  const mate = wf.__test.spawnUnit(g, { id: 0, owner: 0, level: 1 }, 'warrior', c.x + 92, c.y + 65);
  if (mate) mate.hp = Math.round(mate.maxHp * 0.55);

  // 真跑 1.2 秒（真实时钟：火场寿命按 Date.now() 算，喂假时间会全部显示成已熄灭）
  const realStart = Date.now();
  let t = realStart;
  for (let i = 0; i < 24; i++) {
    t += 50;
    wf.__test.step(g, 0.05, t);
  }
  // 再补两片「另一处」的火场做同框对照：**同样的年龄**（刚铺下 0.4 秒），
  // 二级的只有半径 46、三级的半径 64 —— 一眼看出三级火场更大。
  wf.__test.addFire(g, c.x - 260, c.y - 320, 0, Date.now() - 400, 2);
  wf.__test.addFire(g, c.x - 120, c.y - 320, 0, Date.now() - 400, 3);
  // 无头截图跑在「虚拟时钟」上，页面里的 Date.now() 可能被快进好几秒 ——
  // 火场寿命只有 3 秒，很容易在截图那一刻刚好烧完，于是画面上什么都没有。
  // 所以这里把寿命统一推到 6 秒（客户端 life 是 clamp 到 1 的，推长了只会「烧得更旺」，
  // 不会失真）；真正的「熄灭渐隐」由 docs 特效图谱页按 age 定点核对。
  g.fires.forEach((f) => {
    f.until = Date.now() + 6000;
  });
  return { g, center: c };
}

function main() {
  const g = buildGame();
  const state = wf.publicGameState(g);
  const snap = wf.snapshot(g);
  const gPad = buildPadGame();
  const padState = wf.publicGameState(gPad);
  const padSnap = wf.snapshot(gPad);
  const padMine = gPad.units.filter((u) => u.ownerIdx === 0).sort((a, b) => a.id - b.id);
  const fx = buildFxGame();
  const fxState = wf.publicGameState(fx.g);
  const fxSnap = wf.snapshot(fx.g);
  const fxEvents = fxSnap.ev || [];
  const burn = buildBurnGame();
  const burnState = wf.publicGameState(burn.g);
  const burnSnap = wf.snapshot(burn.g);

  const css = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');
  const panel = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');

  const data = JSON.stringify({
    state,
    snap,
    // ?pad=1：四方阵营同框（看红/蓝/黄/绿归属底色 + 血条 + 选中效果）
    padState,
    padSnap,
    padPick: padMine[0] ? { x: padMine[0].x, y: padMine[0].y } : null,
    padCenter: { x: Math.round(gPad.world.w / 2), y: Math.round(gPad.world.h / 2) },
    // ?fx=1：真实交火态（那一帧里带着真实的 shot / hit 事件）
    fxState,
    fxSnap,
    fxCenter: { x: Math.round(fx.center.x), y: Math.round(fx.center.y) },
    // ?burn=1：燎原喷火态（火舌 + 灼烧地形 + 踩在火里的单位）
    burnState,
    burnSnap,
    burnCenter: { x: Math.round(burn.center.x), y: Math.round(burn.center.y) },
    // 编队用例：我方「id 最小」那支部队的坐标（连按两下后镜头应对准它）
    squadFirst: (() => {
      const mine = g.units.filter((u) => u.ownerIdx === 0).sort((a, b) => a.id - b.id)[0];
      return mine ? { x: mine.x, y: mine.y } : null;
    })(),
    // publicGameState 不带单位（单位走快照），侦察用例的目标坐标单独塞进来
    foes: {
      unit: (() => {
        const u = g.units.find((x) => x.ownerIdx === 1);
        return u ? { x: u.x, y: u.y } : null;
      })(),
      fac: (() => {
        const f = g.factories.find((x) => x.owner === 1);
        return f ? { x: f.x, y: f.y } : null;
      })(),
      hq: (() => {
        const h = g.hqs.find((x) => x.owner === 1);
        return h ? { x: h.x, y: h.y } : null;
      })(),
      lab: g.labs[2]
        ? { x: g.labs[2].x, y: g.labs[2].y }
        : g.labs[0]
          ? { x: g.labs[0].x, y: g.labs[0].y }
          : null,
    },
  });

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>战争工厂 · 底部指挥栏预览</title>
<style>
  body { margin: 0; padding: 14px; background: #f4efe2; font-family: "Noto Serif SC", "Songti SC", serif; }
  .panel.game-panel { max-width: 1300px; margin: 0 auto; }
  h2 { margin: 0 0 4px; font-size: 20px; color: #2a2620; }
  .game-status { margin: 0 0 10px; font-size: 13px; color: #6c5f4b; }
  .muted { display: none; }
  ${css}
</style>
</head>
<body>
${panel}
<script>
window.__WF__ = ${data};
</script>
<script>
${ui}
</script>
<script>
${RUNNER}
</script>
</body>
</html>
`;

  const out = path.join(ROOT, 'docs/warfactory-hud-preview.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, 'utf8');
  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log('wrote ' + path.relative(ROOT, out) + ' (' + kb + ' KB)');
  console.log('我方部队 ' + snap.u.filter((r) => r[1] === 0).length + ' 支 / 敌方 ' + snap.u.filter((r) => r[1] === 1).length + ' 支');
  const ev = fxEvents.reduce((m, e) => ((m[e.t] = (m[e.t] || 0) + 1), m), {});
  console.log(
    '交火态：' +
      fxSnap.u.length +
      ' 支在场 · ' +
      fxSnap.b.length +
      ' 发弹在飞 · 事件 ' +
      Object.keys(ev).map((k) => k + '×' + ev[k]).join(' ') +
      ' · 中心 ' +
      Math.round(fx.center.x) +
      ',' +
      Math.round(fx.center.y)
  );
  console.log(
    '燎原态：' +
      burnSnap.u.length +
      ' 支在场（' +
      burnSnap.u.filter((r) => r[10] === 1).length +
      ' 支在燃烧）· ' +
      burnSnap.fr.length +
      ' 片灼烧地形 · 中心 ' +
      Math.round(burn.center.x) +
      ',' +
      Math.round(burn.center.y)
  );
}

main();
