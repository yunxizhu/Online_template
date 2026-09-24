'use strict';

/**
 * 战争工厂客户端渲染/交互校验（无需真实浏览器）
 *
 * 用 vm + 假 DOM/canvas 真实加载 public/games/warfactory/ui.js，
 * 配合服务端真实快照驱动一帧渲染与一次点击/进化流程。
 *
 * 用途：捕捉「静态检查发现不了」的客户端运行时错误
 *   —— 变量遮蔽、未定义常量、快照字段错位、面板状态机错误等。
 *   （历史上靠它抓到过：`ctx` 从未赋值导致整屏不绘制；
 *     小地图循环变量 c 遮蔽 ctx 别名导致动画循环中断；
 *     工厂血条字段被快照覆盖丢失。）
 *
 * 用法：node scripts/warfactory-client-check.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));

let failed = 0;
function ok(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) failed += 1;
}

/* ---------------- 假 DOM / canvas ---------------- */

const log = {
  texts: [],
  setTransforms: [],
  rafCbs: [],
  strokes: [],
  dashes: [],
  scales: [],
  rects: [],
  // 每次 fill() / stroke() 当时的样式（用来断言「归属底色盘 = 阵营色 + 60% 透明」这类配色）
  fills: [],
  fillMags: [],
  strokeStyles: [],
  strokeMags: [],
  // 落笔点（已按当前 2D 变换换算到画布坐标）：用来真实量出各兵种画多大
  points: [],
};
const sent = [];

/**
 * 每个 ctx 各持一份极简 2D 仿射变换跟踪：让 points 记录真实画布坐标，
 * 「锐士是否至少是盾卫一半大」就能直接从 draw 调用量出来，而不是靠读常量。
 * 必须 per-ctx —— 地形预渲染用的是另一个 canvas 的 ctx，共用状态会互相污染。
 * points 每项是 [x, y, mag]：mag 为当前变换的等效缩放，用来把「单位本体」这一趟
 * 绘制（多了 scale(f,f) 这一层）从归属墨圈、地形、建筑里筛出来。
 */
function makeXf() {
  return { stack: [], a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}
function xfMag(xf) {
  return Math.sqrt(Math.abs(xf.a * xf.d - xf.b * xf.c)) || 0;
}
function xfMul(xf, a2, b2, c2, d2, e2, f2) {
  const a1 = xf.a;
  const b1 = xf.b;
  const c1 = xf.c;
  const d1 = xf.d;
  const e1 = xf.e;
  const f1 = xf.f;
  xf.a = a1 * a2 + c1 * b2;
  xf.b = b1 * a2 + d1 * b2;
  xf.c = a1 * c2 + c1 * d2;
  xf.d = b1 * c2 + d1 * d2;
  xf.e = a1 * e2 + c1 * f2 + e1;
  xf.f = b1 * e2 + d1 * f2 + f1;
}

function makeCtx(owner) {
  const grad = { addColorStop() {} };
  const st = { lineWidth: 1, strokeStyle: '', fillStyle: '', lineCap: 'butt' };
  const xf = makeXf();
  const pt = (x, y) =>
    log.points.push([xf.a * x + xf.c * y + xf.e, xf.b * x + xf.d * y + xf.f, xfMag(xf), owner || '?']);
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'measureText') return () => ({ width: 40 });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => grad;
        if (prop === 'getImageData') return () => ({ data: [] });
        if (prop === 'fillText') return (txt) => log.texts.push(String(txt));
        if (prop === 'fillRect') return (x, y, w, h) => log.rects.push([x, y, w, h]);
        if (prop === 'stroke') {
          return () => {
            log.strokes.push(st.lineWidth);
            log.strokeStyles.push(st.strokeStyle);
            log.strokeMags.push(xfMag(xf));
          };
        }
        if (prop === 'fill') {
          return () => {
            log.fills.push(st.fillStyle);
            log.fillMags.push(xfMag(xf));
          };
        }
        if (prop === 'setLineDash') return (d) => log.dashes.push(Array.isArray(d) ? d.slice() : []);
        // ---- 变换栈（只用于把落笔点换算到画布坐标，不影响既有断言）----
        if (prop === 'save') {
          return () => xf.stack.push([xf.a, xf.b, xf.c, xf.d, xf.e, xf.f]);
        }
        if (prop === 'restore') {
          return () => {
            const s = xf.stack.pop();
            if (s) {
              xf.a = s[0];
              xf.b = s[1];
              xf.c = s[2];
              xf.d = s[3];
              xf.e = s[4];
              xf.f = s[5];
            }
          };
        }
        if (prop === 'translate') return (x, y) => xfMul(xf, 1, 0, 0, 1, x, y);
        if (prop === 'rotate') {
          return (r) => xfMul(xf, Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0);
        }
        if (prop === 'transform') {
          return (a, b, cc, d, e, f) => xfMul(xf, a, b, cc, d, e, f);
        }
        if (prop === 'scale') {
          return (sx, sy) => {
            log.scales.push([sx, sy]);
            xfMul(xf, sx, 0, 0, sy, 0, 0);
          };
        }
        if (prop === 'setTransform') {
          return (a, b, cc, d, e, f) => {
            log.setTransforms.push([a, b, cc, d, e, f]);
            xf.a = a;
            xf.b = b;
            xf.c = cc;
            xf.d = d;
            xf.e = e;
            xf.f = f;
          };
        }
        // ---- 路径落笔点 ----
        if (prop === 'beginPath') return () => {};
        if (prop === 'moveTo') return (x, y) => pt(x, y);
        if (prop === 'lineTo') return (x, y) => pt(x, y);
        if (prop === 'quadraticCurveTo') {
          return (cx2, cy2, x, y) => {
            pt(cx2, cy2);
            pt(x, y);
          };
        }
        if (prop === 'bezierCurveTo') {
          return (c1x, c1y, c2x, c2y, x, y) => {
            pt(c1x, c1y);
            pt(c2x, c2y);
            pt(x, y);
          };
        }
        // 圆/椭圆按外接矩形四点近似（略偏大，但各兵种一致，不影响比值判断）
        if (prop === 'arc') {
          return (x, y, r) => {
            pt(x - r, y - r);
            pt(x + r, y + r);
          };
        }
        if (prop === 'ellipse') {
          return (x, y, rx, ry) => {
            pt(x - rx, y - ry);
            pt(x + rx, y + ry);
          };
        }
        if (prop === 'rect') {
          return (x, y, w, h) => {
            pt(x, y);
            pt(x + w, y + h);
          };
        }
        if (prop in st) return st[prop];
        return () => {};
      },
      set(_t, prop, v) {
        if (prop in st) st[prop] = v;
        return true;
      },
    }
  );
}

const els = {};
function el(id) {
  if (els[id]) return els[id];
  const handlers = {};
  // 跟踪 class：让断言可以校验 is-me / is-out / is-mid 这类状态类
  const classes = new Set();
  const node = {
    id,
    hidden: false,
    textContent: '',
    style: {},
    children: [],
    classList: {
      add(...cs) {
        cs.forEach((c) => c && classes.add(c));
      },
      remove(...cs) {
        cs.forEach((c) => classes.delete(c));
      },
      toggle(c, force) {
        const on = force === undefined ? !classes.has(c) : Boolean(force);
        if (on) classes.add(c);
        else classes.delete(c);
        return on;
      },
      contains: (c) => classes.has(c),
    },
    addEventListener(type, fn) {
      (handlers[type] = handlers[type] || []).push(fn);
    },
    removeEventListener() {},
    dispatch(type, evt) {
      for (const fn of handlers[type] || []) fn(evt);
    },
    appendChild(c) {
      node.children.push(c);
      return c;
    },
    querySelector(sel) {
      return el(id + ' ' + sel);
    },
    getContext: () => makeCtx(id),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    width: 1280,
    height: 800,
    clientWidth: 1280,
    clientHeight: 800,
  };
  Object.defineProperty(node, 'className', {
    get() {
      return [...classes].join(' ');
    },
    set(v) {
      classes.clear();
      String(v || '')
        .split(/\s+/)
        .forEach((c) => c && classes.add(c));
    },
  });
  // innerHTML = '' 需真的清空子节点，否则记分牌会不断累积
  Object.defineProperty(node, 'innerHTML', {
    get() {
      return '';
    },
    set() {
      node.children.length = 0;
    },
  });
  els[id] = node;
  return node;
}

const documentStub = {
  getElementById: (id) => el(id),
  createElement: () => el('created-' + els.__n++),
  querySelector: (sel) => el(sel),
  addEventListener() {},
  body: { appendChild() {} },
};
els.__n = 0;

/**
 * window 桩：记下 keydown/keyup 等监听，方便用「真的按键事件」驱动快捷键用例
 * （F2 全选就是靠它验证的，而不是直接调内部函数）。
 */
const winHandlers = {};
const winStub = {
  addEventListener(type, fn) {
    (winHandlers[type] = winHandlers[type] || []).push(fn);
  },
  removeEventListener(type, fn) {
    const arr = winHandlers[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  },
  dispatch(type, evt) {
    for (const fn of [...(winHandlers[type] || [])]) fn(evt);
  },
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 800,
  document: documentStub,
};

const sandbox = {
  console,
  Math,
  Date,
  JSON,
  Object,
  Array,
  Number,
  String,
  Boolean,
  Set,
  Map,
  Infinity,
  NaN,
  performance: { now: () => Date.now() },
  document: documentStub,
  window: winStub,
  requestAnimationFrame(cb) {
    log.rafCbs.push(cb);
    return log.rafCbs.length;
  },
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
};
sandbox.globalThis = sandbox;

const src = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const Ui = sandbox.window.WarFactoryUi;

/** 从客户端源码里读 UNIT_VIS_SCALE 常量（全局视觉缩放） */
const UNIT_VIS_SCALE = Number((/const UNIT_VIS_SCALE = ([\d.]+);/.exec(src) || [0, 0])[1]) || 1;
/** 兵种基础体型系数：叠在 UNIT_VIS_SCALE 之上，锐士靠它补足体量 */
function bodyScaleOf(type) {
  const body = (/const UNIT_BODY_SCALE = \{([^}]*)\}/.exec(src) || [0, ''])[1];
  const m = new RegExp(type + ':\\s*([\\d.]+)').exec(body);
  return m ? Number(m[1]) : 1;
}

/** 小地图逻辑尺寸（从源码读，改尺寸时测试自动跟着走） */
const MINI_W = Number((/const MINIMAP_W = (\d+);/.exec(src) || [0, 0])[1]) || 0;
const MINI_H = Number((/const MINIMAP_H = (\d+);/.exec(src) || [0, 0])[1]) || 0;
/** 长按 F2 全选：从源码里确认 F2 分支确实绑到了「全选我方部队」 */
const hasSelectAllUnits = /function selectAllUnits\(/.test(src);

console.log('战争工厂客户端校验');
ok(typeof Ui === 'object' && typeof Ui.render === 'function', '客户端模块加载成功');

/* ---------------- 驱动 ---------------- */

const net = {
  on() {},
  sendRt(d) {
    sent.push(d);
  },
};
const view = { meId: 'p0', isSpectator: false, t: (k) => k, title: '战争工厂' };

function pump() {
  log.texts.length = 0;
  log.setTransforms.length = 0;
  log.scales.length = 0;
  log.rects.length = 0;
  log.points.length = 0;
  log.fills.length = 0;
  log.fillMags.length = 0;
  log.strokeStyles.length = 0;
  log.strokeMags.length = 0;
  const cbs = log.rafCbs.splice(0, log.rafCbs.length);
  for (const cb of cbs) cb();
}
function texts() {
  return log.texts.join('|');
}
function camFromLastFrame() {
  // 每帧两次 setTransform：先重置 (1,0,0,1,0,0)，再设世界变换 (kk,0,0,kk,-cam*k)
  const cands = log.setTransforms.filter((m) => m[0] === m[3] && m[1] === 0 && m[2] === 0);
  const t = cands[1] || cands[0];
  return t ? { k: t[0], x: -t[4] / t[0], y: -t[5] / t[0] } : null;
}

const canvasEl = el('warfactory-canvas');
function clickWorld(wx, wy) {
  const cam = camFromLastFrame();
  if (!cam) return false;
  const evt = {
    button: 0,
    clientX: wx - cam.x,
    clientY: wy - cam.y,
    preventDefault() {},
    shiftKey: false,
  };
  canvasEl.dispatch('mousedown', evt);
  canvasEl.dispatch('mouseup', evt);
  pump();
  return true;
}

/** 世界坐标框选（mousedown → mousemove → mouseup） */
function dragWorld(x0, y0, x1, y1, shift) {
  const cam = camFromLastFrame();
  if (!cam) return false;
  const mk = (wx, wy) => ({
    button: 0,
    clientX: wx - cam.x,
    clientY: wy - cam.y,
    preventDefault() {},
    shiftKey: Boolean(shift),
  });
  canvasEl.dispatch('mousedown', mk(x0, y0));
  canvasEl.dispatch('mousemove', mk(x1, y1));
  canvasEl.dispatch('mouseup', mk(x1, y1));
  pump();
  return true;
}

/** 取整棵子树的文本（卡片/面板是多层 DOM，桩节点不会聚合 textContent） */
function deepText(n) {
  if (!n) return '';
  const self = n.textContent ? String(n.textContent) : '';
  const kids = (n.children || []).map(deepText).join(' ');
  return self + ' ' + kids;
}

/* ---------------- 用例 ---------------- */

const g = wf.createGameState({
  id: 'client-check',
  players: [
    { id: 'p0', name: '甲' },
    { id: 'p1', name: '乙' },
  ],
});
g.phase = 'playing';
g.phaseEndsAt = 0;
g.factories[0].owner = 0;
g.factories[0].hp = g.factories[0].hpMax;
g.labs[0].owner = 0;
g.labs[1].hp = 200; // 被削过的中立研究所
g.players[0].rp = 620;

/**
 * 点建筑：在建筑圆内挑一个「离所有部队最远」的点。
 * 点选优先级是「部队 → 总部 → 工厂」，而总部出生点现在随机落点，
 * 亲兵可能正好贴在总部边上——这时候点正中会被单位抢走，断言就会随机失败。
 */
function clickBuildingPoint(b, radius) {
  let best = { x: b.x, y: b.y };
  let bestD = -1;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const px = b.x + Math.cos(a) * radius;
    const py = b.y + Math.sin(a) * radius;
    let d = Infinity;
    for (const u of g.units) {
      if (u.dead) continue;
      d = Math.min(d, Math.hypot(u.x - px, u.y - py));
    }
    if (d > bestD) {
      bestD = d;
      best = { x: px, y: py };
    }
  }
  return best;
}

Ui.render(wf.publicGameState(g), net, view);
Ui.applySnapshot(wf.snapshot(g));
pump();

console.log('\n[1] 世界绘制无异常');
ok(log.texts.includes('总 部'), '绘制总部');
ok(log.texts.includes('帅'), '绘制总部印');
ok(log.texts.includes('研 究 所'), '绘制研究所');
ok(log.texts.some((t) => /^\d+ \/ \d+$/.test(t)), '绘制建筑血条数值');
ok(Number.isFinite(camFromLastFrame() && camFromLastFrame().x), '相机变换矩阵可解析');

console.log('\n[2] 左上角科技点 HUD');
ok(texts().includes('科 技 点'), 'HUD 标题');
ok(texts().includes('620'), '显示当前科技点');
// 期望值按服务端常数推导：rpPerLab / rpPeriodMs 调整后这里不会误报
const Cc = wf.__test.consts;
// 产出按「每座研究所每周期 +RP_PER_LAB 点」结算，多座线性叠加
const rpPeriodSec = Math.max(1, Math.round(Cc.RP_PERIOD_MS / 1000));
const perPeriodOf = (labs) => {
  const r = Math.round(labs * Cc.RP_PER_LAB * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};
ok(
  texts().includes(`每 ${rpPeriodSec} 秒 +${perPeriodOf(1)} · 研究所 ×1`),
  `显示每 ${rpPeriodSec} 秒产出与研究所数（每 ${rpPeriodSec} 秒 +${perPeriodOf(1)}）`
);
ok(log.texts.includes('可进化 ×1'), '≥500 时显示可进化次数');

// 离散结算：点数按周期一次性跳，HUD 显示「下次 +N · 剩余秒数」与结算进度条
{
  const P = Cc.RP_PERIOD_MS;
  const trackW = 196 - 24; // 进度条底槽宽 = HUD 宽 196 − 左右各 12
  const barWidths = () =>
    log.rects.filter((r) => r[3] === 4).map((r) => Math.round(r[2] * 10) / 10);
  const setAcc = (ms) => {
    g.players[0].rpAccMs = ms;
    Ui.applySnapshot(wf.snapshot(g));
    pump();
  };
  setAcc(P * 0.5); // 进度走到一半
  ok(texts().includes('620'), '进度未满一个周期时点数不变（离散结算，仍为 620）');
  ok(
    log.texts.some((t) => new RegExp('^下次 \\+' + perPeriodOf(1) + ' · 1\\.5s$').test(t)),
    `显示距下次结算的倒计时（下次 +${perPeriodOf(1)} · 1.5s）`
  );
  const half = barWidths();
  setAcc(0);
  const zero = barWidths();
  ok(
    zero.includes(0) && half.includes(trackW / 2),
    `结算进度条按周期进度填充（0 → 0px，半周期 → ${trackW / 2}px）`
  );
  g.players[0].rpAccMs = 0;
  Ui.applySnapshot(wf.snapshot(g));
  pump();
}
g.players[0].rp = 380;
Ui.applySnapshot(wf.snapshot(g));
pump();
ok(texts().includes('380 / 500'), '不足 500 时显示进度 x/500');

console.log('\n[2b] 观战视角的科技点 HUD');
{
  const gSpec = wf.createGameState({
    id: 'client-check-spect',
    players: [
      { id: 'p0', name: '甲' },
      { id: 'p1', name: '乙' },
    ],
  });
  gSpec.phase = 'playing';
  gSpec.phaseEndsAt = 0;
  gSpec.labs[0].owner = 0;
  gSpec.labs[1].owner = 0;
  gSpec.labs[2].owner = 1;
  gSpec.players[0].rp = 120;
  const spectView = { meId: '', isSpectator: true, t: (k) => k, title: '战争工厂' };
  Ui.render(wf.publicGameState(gSpec), net, spectView);
  Ui.applySnapshot(wf.snapshot(gSpec));
  pump();
  ok(
    log.texts.some((t) =>
      t.includes(`2 所 · 每 ${rpPeriodSec} 秒 +${perPeriodOf(2)}`)
    ),
    `观战列出每周期产出（2 所 · 每 ${rpPeriodSec} 秒 +${perPeriodOf(2)}）`
  );
  ok(
    log.texts.some((t) => t.includes(`1 所 · 每 ${rpPeriodSec} 秒 +${perPeriodOf(1)}`)),
    `观战列出单人产出（1 所 · 每 ${rpPeriodSec} 秒 +${perPeriodOf(1)}）`
  );
}

console.log('\n[3] 未占研究所不产出');
const g0 = wf.createGameState({
  id: 'client-check-zero',
  players: [
    { id: 'p0', name: '甲' },
    { id: 'p1', name: '乙' },
  ],
});
g0.phase = 'playing';
Ui.render(wf.publicGameState(g0), net, view);
Ui.applySnapshot(wf.snapshot(g0));
pump();
ok(texts().includes('未占研究所 · 不产出'), '提示未占研究所不产出');

console.log('\n[4] 点选自家总部 → 右侧面板');
g.players[0].rp = 620;
Ui.render(wf.publicGameState(g), net, view);
Ui.applySnapshot(wf.snapshot(g));
pump();
const hq0 = g.hqs.find((h) => h.owner === 0);
const hq0p = clickBuildingPoint(hq0, 30);
ok(clickWorld(hq0p.x, hq0p.y), '点击总部');
const panel = el('warfactory-facpanel');
const title = el('warfactory-facpanel #wfp-title');
const evo = el('warfactory-facpanel #wfp-evolve');
ok(panel.hidden === false, '面板弹出');
ok(title.textContent === '总部', '标题为「总部」');
ok(evo.hidden === false && !evo.disabled, '总部可进化且按钮可用（' + evo.textContent + '）');
ok(evo.textContent.includes('500'), '按钮显示 500 科技点');
ok(el('warfactory-facpanel #wfp-prod-sec').hidden === true, '总部隐藏「正在生产」段');

console.log('\n[5] 总部进化指令');
sent.length = 0;
evo.dispatch('click', { stopPropagation() {} });
ok(sent.some((d) => d.cmd === 'facEvolve' && d.fid === 0), '发出 facEvolve(fid=0)：' + JSON.stringify(sent[0]));

console.log('\n[6] 点选自家工厂 → 工厂面板');
const fac0 = g.factories[0];
ok(clickWorld(fac0.x, fac0.y), '点击工厂');
ok(title.textContent === '1 号工厂', '标题为工厂');
ok(el('warfactory-facpanel #wfp-prod-sec').hidden === false, '显示「正在生产」');
ok(el('warfactory-facpanel #wfp-unit-name').textContent.length > 0, '显示本厂兵种：' + el('warfactory-facpanel #wfp-unit-name').textContent);
ok(el('warfactory-facpanel #wfp-rally').hidden === false, '显示集结点状态');

console.log('\n[7] 进化按钮三态');
g.factories[0].level = 1;
Ui.render(wf.publicGameState(g), net, view);
Ui.applySnapshot(wf.snapshot(g));
pump();
clickWorld(fac0.x, fac0.y);
ok(evo.hidden === true, '初级工厂不显示进化按钮');
g.factories[0].level = 2;
g.units[0].homeFac = fac0.id;
g.units[0].maxTier = 2; // 伪造一支本厂可进阶部队
g.players[0].rp = 10;
Ui.render(wf.publicGameState(g), net, view);
Ui.applySnapshot(wf.snapshot(g));
pump();
clickWorld(fac0.x, fac0.y);
ok(evo.hidden === false, '中级工厂显示进化按钮');
ok(evo.disabled === true && evo.textContent.includes('科技点不足'), '点数不足时禁用（' + evo.textContent + '）');
g.players[0].rp = 900;
Ui.applySnapshot(wf.snapshot(g));
pump();
ok(!evo.disabled, '点数充足后恢复可用（' + evo.textContent + '）');

console.log('\n[8] 空白处点击收起面板');
// 总部出生点随机之后，写死的画布坐标可能正好压在总部/部队上（那就会被选中而不是收起面板），
// 所以现算一个「附近真没有建筑也没有单位」的世界坐标。
function emptyWorldSpot() {
  const cam = camFromLastFrame() || { k: 1, x: 0, y: 0 };
  const blocks = [...g.factories, ...g.labs, ...g.hqs];
  for (let sy = 796; sy >= 4; sy -= 40) {
    for (let sx = 4; sx <= 1276; sx += 40) {
      const wx = cam.x + sx;
      const wy = cam.y + sy;
      if (wx < 10 || wx > 4310 || wy < 10 || wy > 2870) continue;
      let ok = true;
      for (const b of blocks) {
        if (Math.hypot(b.x - wx, b.y - wy) < 150) {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (const u of g.units) {
          if (!u.dead && Math.hypot(u.x - wx, u.y - wy) < 70) {
            ok = false;
            break;
          }
        }
      }
      if (ok) return { x: wx, y: wy };
    }
  }
  return { x: 6, y: 6 };
}
const emptySpot = emptyWorldSpot();
clickWorld(emptySpot.x, emptySpot.y);
ok(panel.hidden === true, '面板收起（点了空地 ' + Math.round(emptySpot.x) + ',' + Math.round(emptySpot.y) + '）');

console.log('\n[9] 指挥栏·我方概况（已瘦身：只留科技点 + 提示，详细数据「点谁看谁」）');
const srcUi = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');
const srcHtml = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');
const selfNode = el('warfactory-self');
// 桩 DOM 里 querySelector 拿到的是独立节点（不挂在 selfNode.children 下），
// 所以按 id 前缀把「我方概况」整棵子树的文本聚合起来。
function subText(prefix) {
  return Object.keys(els)
    .filter((k) => k === prefix || k.indexOf(prefix + ' ') === 0)
    .map((k) => String(els[k].textContent || ''))
    .join(' | ');
}
const selfText = () => subText('warfactory-self');
{
  // 旧的多玩家记分牌必须彻底消失（结构 + 代码两处）
  ok(!srcHtml.includes('warfactory-scores'), 'panel.html 已移除多人记分牌容器');
  ok(!srcHtml.includes('score-card'), 'panel.html 已无记分牌卡片类名');
  ok(!srcUi.includes('score-card') && !srcUi.includes('renderScoreCards'), 'ui.js 已无记分牌代码');
  ok(!srcHtml.includes('warfactory-card-'), 'panel.html 已无记分牌内部节点类名');

  g.hqs[0].hp = 1800;
  g.players[0].losses = 3;
  g.players[0].evolved = 2;
  g.players[0].captured = 1;
  g.players[1].eliminated = true;
  Ui.render(wf.publicGameState(g), net, view);
  Ui.applySnapshot(wf.snapshot(g));
  pump();

  ok(selfNode.hidden === false, '未选中任何目标时显示我方概况');
  ok(
    new RegExp(`科 \\d+（每 ${rpPeriodSec} 秒 \\+\\d+(\\.\\d+)?·\\d+ 所）`).test(selfText()),
    '显示我方科技点与每周期产出'
  );
  // 瘦身：编制 / 战绩 / 总部血量等都移到「点谁看谁」的面板里，默认态不再堆这些
  ok(!/厂 \d+ · 所 \d+/.test(selfText()), '默认态不再堆「厂/所/兵」编制（已移到工厂面板）');
  ok(!/斩 \d+ · 损 \d+/.test(selfText()), '默认态不再堆「斩/损/进化/占」战绩');
  ok(!selfText().includes('总部 1800'), '默认态不再重复展示总部血量（点总部才看）');
  ok(selfText().includes('左键点选'), '给出「点谁看谁」的操作提示');
  ok(!selfText().includes('乙'), '我方概况里不出现其他玩家的任何数据');
  ok(!selfText().includes('出局'), '我方概况里不展示他人的出局状态');
  ok(el('wdt-title').textContent === '我方概况', '详情栏标题为「我方概况」（' + el('wdt-title').textContent + '）');
}

console.log('\n[10] 激光兵光束（前摇 → 蓄能满）');
{
  const gl = wf.createGameState({
    id: 'client-laser',
    players: [
      { id: 'p0', name: '甲' },
      { id: 'p1', name: '乙' },
    ],
  });
  gl.phase = 'playing';
  gl.phaseEndsAt = 0;
  gl.units.length = 0;
  const L = wf.__test.spawnUnit(gl, { id: 900, owner: 0, level: 2 }, 'laser', 700, 500);
  const E = wf.__test.spawnUnit(gl, { id: 901, owner: 1, level: 2 }, 'shield', 790, 500);
  for (const u of [L, E]) {
    u.moveX = null;
    u.moveY = null;
    u.maxHp = 1e6;
    u.hp = 1e6;
  }
  Ui.render(wf.publicGameState(gl), net, view);
  Ui.applySnapshot(wf.snapshot(gl));
  log.strokes.length = 0;
  pump();
  ok(log.strokes.length > 0, '激光兵外形成功绘制（' + log.strokes.length + ' 次描边）');

  // 用真实时间戳驱动（snapshot 内部取 Date.now() 判断前摇剩余）
  let now = Date.now();
  for (let i = 0; i < 3; i++) wf.__test.step(gl, 0.05, (now += 50));
  Ui.applySnapshot(wf.snapshot(gl));
  log.dashes.length = 0;
  log.strokes.length = 0;
  log.texts.length = 0;
  pump();
  ok(L.lockId === E.id && L.lockMul === 1, '已锁定目标，仍在前摇中');
  ok(
    log.dashes.some((d) => d.length === 2),
    '前摇阶段绘制虚线瞄准线'
  );
  ok(!texts().includes('×'), '前摇阶段不显示倍率读数');

  // 蓄能满：快进 8 秒（把 windupUntil 归零以模拟真实时间已流逝）
  for (let i = 0; i < 170; i++) wf.__test.step(gl, 0.05, (now += 50));
  L.windupUntil = 0;
  Ui.applySnapshot(wf.snapshot(gl));
  log.dashes.length = 0;
  log.strokes.length = 0;
  log.texts.length = 0;
  pump();
  const maxW = log.strokes.length ? Math.max(...log.strokes) : 0;
  ok(L.lockMul >= 5 - 0.01, `锁定倍率已封顶（${L.lockMul.toFixed(2)}）`);
  ok(maxW >= 8, `绘制粗光束（最粗 ${maxW.toFixed(1)}px，随倍率增强）`);
  ok(texts().includes('×5.0'), '单位上方显示倍率读数 ×5.0');
}

console.log('\n[11] 单位面板（单选看属性 / 多选看编成）');
{
  const gp = wf.createGameState({
    id: 'client-unitpanel',
    players: [
      { id: 'p0', name: '甲' },
      { id: 'p1', name: '乙' },
    ],
  });
  gp.phase = 'playing';
  gp.phaseEndsAt = 0;
  gp.units.length = 0; // 清掉开局部队，只留本段伪造的两支
  gp.factories[0].owner = 0;
  Ui.render(wf.publicGameState(gp), net, view);
  Ui.applySnapshot(wf.snapshot(gp));
  pump();

  const upanel = el('warfactory-unitpanel');
  const up = (sel) => el('warfactory-unitpanel ' + sel);
  const upText = (...sels) => sels.map((s) => deepText(up(s))).join(' | ');
  ok(upanel.hidden === true, '未选中部队时面板隐藏');

  // 单选：总部亲兵（初级锐士）→ 详细属性
  const hero = wf.__test.spawnUnit(gp, { id: 0, owner: 0, level: 3 }, 'warrior', 700, 500);
  hero.moveX = null;
  hero.moveY = null;
  Ui.applySnapshot(wf.snapshot(gp));
  pump();
  clickWorld(hero.x, hero.y);
  ok(upanel.hidden === false, '点选部队后弹出单位面板');
  const t1 = upText('#wup-title', '#wup-name', '#wup-desc', '#wup-stats', '#wup-hp-text');
  ok(t1.includes('锐士'), '显示兵种名（锐士）');
  ok(t1.includes('初级'), '标题显示等级（初级）');
  ok(/攻　击/.test(t1), '显示攻击属性');
  ok(/射　程/.test(t1) && /攻　速/.test(t1) && /移　速/.test(t1), '显示射程 / 攻速 / 移速');
  ok(t1.includes('总部亲兵'), '显示部队来源（总部亲兵）');
  ok(/进　化/.test(t1) && t1.includes('科技点'), '显示进化上限与科技点消耗');
  ok(up('#wup-hp-text').textContent === '100 / 100', '显示血量 100 / 100（初级锐士）');
  ok(up('#wup-stats').textContent.split('\n').length >= 7, '属性表至少 7 行（' + up('#wup-stats').textContent.split('\n').length + '）');

  // 点选容差应随单位体型同步放大：先点空白清空选择，再点单位外侧（略小于 24×缩放）仍应选中
  const vsNow = Number((/const UNIT_VIS_SCALE = ([\d.]+);/.exec(src) || [0, 0])[1]) || 1;
  const clickR = 24 * vsNow * 0.85;
  clickWorld(1180, 940);
  clickWorld(hero.x + clickR, hero.y);
  ok(
    upanel.hidden === false && up('#wup-title').textContent.includes('锐士'),
    `点选容差随体型放大（外侧 ${clickR.toFixed(1)}px 仍能选中）`
  );

  // 攻击/血量的分级与分支：中级守势盾卫 = 基础血 × 中级系数 × 守势 1.25
  const tank = wf.__test.spawnUnit(gp, { id: 0, owner: 0, level: 3 }, 'shield', 640, 560);
  tank.moveX = null;
  tank.moveY = null;
  tank.branch = 'B'; // 先定分支，再走服务端正式进阶接口（进阶会重算血量/伤害）
  wf.__test.promoteUnit(gp, tank);
  Ui.applySnapshot(wf.snapshot(gp));
  pump();
  clickWorld(tank.x, tank.y);
  const gc = wf.publicGameState(gp).consts;
  const shieldMax = Math.round(gc.stats.shield.hp * gc.tierHp[1] * 1.25);
  ok(
    up('#wup-hp-text').textContent === shieldMax + ' / ' + shieldMax,
    `中级守势盾卫血量按公式推算（${up('#wup-hp-text').textContent}）`
  );
  ok(up('#wup-name').textContent.includes('守势'), '显示分支（守势）');

  // 多选：两支 → 编成汇总
  dragWorld(560, 440, 820, 620);
  const t2 = upText('#wup-title', '#wup-name', '#wup-stats');
  ok(t2.includes('已选 2 支'), '多选时标题显示「已选 2 支」');
  ok(t2.includes('锐士') && t2.includes('盾卫'), '编成列出两个兵种');

  // 面板互斥：点自家工厂 → 单位面板收起、工厂面板弹出
  clickWorld(gp.factories[0].x, gp.factories[0].y);
  ok(upanel.hidden === true, '选中建筑后单位面板收起');

  // 关闭按钮
  clickWorld(hero.x, hero.y);
  const closeBtn = up('#wup-close');
  closeBtn.dispatch('click', { stopPropagation() {} });
  pump();
  ok(upanel.hidden === true, '点 × 收起单位面板');
}

console.log('\n[12] 单位体型（全局缩放 × 兵种基础体型）');
const visScale = UNIT_VIS_SCALE;
{
  ok(visScale > 1, `单位体型已整体放大（UNIT_VIS_SCALE = ${visScale}）`);
  const wScale = bodyScaleOf('warrior');
  ok(wScale > 1, `锐士有独立的体型系数（×${wScale}）`);

  const gs = wf.createGameState({
    id: 'client-unitscale',
    players: [
      { id: 'p0', name: '甲' },
      { id: 'p1', name: '乙' },
    ],
  });
  gs.phase = 'playing';
  gs.phaseEndsAt = 0;
  gs.units.length = 0;
  const hq0 = gs.hqs.find((h) => h.owner === 0);
  wf.__test.spawnUnit(gs, { id: 0, owner: 0, level: 1 }, 'warrior', hq0.x, hq0.y + 120);
  Ui.render(wf.publicGameState(gs), net, view);
  Ui.applySnapshot(wf.snapshot(gs));
  pump();
  const uni = log.scales.filter(([a, b]) => a === b && a > 1);
  const expect = visScale * wScale;
  ok(uni.length > 0, `单位本体绘制时按等比放大（${uni.length} 次）`);
  ok(
    uni.length > 0 && uni.every(([a]) => Math.abs(a - expect) < 1e-6),
    `放大倍率 = UNIT_VIS_SCALE × 锐士体型系数（实际 ${uni.length ? uni[0][0] : '—'}，期望 ${expect.toFixed(2)}）`
  );
}

console.log('\n[13] 山体遮挡：客户端反馈与图例');
{
  // 服务端在「弹丸撞山」时下发 spark 事件，客户端必须有对应的特效分支
  ok(/'spark'/.test(src), '客户端已订阅弹丸撞山事件（spark）');
  ok(/kind === 'spark'/.test(src), '客户端已绘制弹丸撞山特效（spark）');

  const gm = wf.createGameState({
    id: 'client-los',
    players: [
      { id: 'p0', name: '甲' },
      { id: 'p1', name: '乙' },
    ],
  });
  gm.phase = 'playing';
  gm.phaseEndsAt = 0;
  gm.units.length = 0;
  Ui.render(wf.publicGameState(gm), net, view);
  const snapM = wf.snapshot(gm);
  // 伪造一帧「子弹撞山 + 炮弹在山坡炸开」的事件
  snapM.ev = [
    { t: 'spark', x: 900, y: 700 },
    { t: 'boom', x: 940, y: 700, r: 41, oi: 0 },
  ];
  let threw = null;
  log.strokes.length = 0;
  try {
    Ui.applySnapshot(snapM);
    pump();
  } catch (e) {
    threw = e;
  }
  ok(!threw, '弹丸撞山事件不导致渲染异常（' + (threw ? threw.message : '无异常') + '）');

  // 差分：同一静止场景，多下发 N 个撞山事件应当多画出对应墨痕
  const drawFrame = (evs) => {
    const s = wf.snapshot(gm);
    s.ev = evs;
    log.strokes.length = 0;
    Ui.applySnapshot(s);
    pump();
    return log.strokes.length;
  };
  const base = drawFrame([]);
  const sparks = drawFrame(Array.from({ length: 6 }, (_, i) => ({ t: 'spark', x: 900 + i * 8, y: 700 })));
  ok(
    sparks >= base + 12,
    `撞山特效确实参与绘制（无事件 ${base} 次描边 → 6 个撞山点 ${sparks} 次）`
  );

  // 图例：山地必须写明遮挡视线与弹道；水域保持「只是不可通行」
  const panelHtml = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');
  const legend = (name) => {
    const m = new RegExp(`<b>${name}</b><em>([^<]*)</em>`).exec(panelHtml);
    return m ? m[1] : '';
  };
  ok(/视线|弹道/.test(legend('山地')), `图例：山地标注了遮挡视线与弹道（${legend('山地')}）`);
  ok(!/视线|弹道/.test(legend('水域')), `图例：水域未标注遮挡（${legend('水域')}）`);
}

console.log('\n[14] 阶数越高越繁复（内部花纹 + 外部挂件），锐士体型 ≥ 盾卫一半');
{
  const TYPES = ['warrior', 'shield', 'ranger', 'burst', 'burn', 'laser'];
  const LABEL = { warrior: '锐士', shield: '盾卫', ranger: '游侠', burst: '轰击', burn: '燎原', laser: '激光兵' };

  /**
   * 在「远离所有建筑的空地」放一支指定兵种 / 阶数的部队，渲染一帧并回传绘制统计。
   * - strokes：该帧描边次数（阶数装饰越多 → 描边越多）
   * - box：单位本体那一趟绘制的包围盒（按当前变换换算过，故可直接比大小）
   */
  const shot = (type, tier) => {
    const g = wf.createGameState({
      id: 'client-tier-' + type,
      players: [
        { id: 'p0', name: '甲' },
        { id: 'p1', name: '乙' },
      ],
    });
    g.phase = 'playing';
    g.phaseEndsAt = 0;
    g.units.length = 0;
    const tr = g.terrain;
    const blocks = [...g.factories, ...g.labs, ...g.hqs].map((b) => [b.x, b.y]);
    let spot = null;
    for (let r = 6; r < tr.rows - 6 && !spot; r++) {
      for (let c = 6; c < tr.cols - 6; c++) {
        if (tr.grid[r][c] === 2 || tr.grid[r][c] === 4) continue; // 山 / 水
        const x = (c + 0.5) * tr.cell;
        const y = (r + 0.5) * tr.cell;
        if (blocks.some((b) => Math.hypot(b[0] - x, b[1] - y) < 700)) continue;
        spot = { x, y };
        break;
      }
    }
    const u = wf.__test.spawnUnit(g, { id: 0, owner: 0, level: 3 }, type, spot.x, spot.y);
    u.tier = tier;
    u.branch = tier > 1 ? 'A' : ''; // 统一看攻势分支，让各阶可比
    u.angle = 0; // 角度归零，量出来的包围盒才是正交的
    Ui.render(wf.publicGameState(g), net, view);
    Ui.applySnapshot(wf.snapshot(g));
    pump(); // 暖机帧（地形预渲染等只发生一次，别混进测量帧）
    log.strokes.length = 0;
    log.strokeMags.length = 0;
    Ui.applySnapshot(wf.snapshot(g));
    pump(); // 测量帧

    const cam = camFromLastFrame();
    // 本体那一趟多了 scale(unitScale) 这一层，用等效缩放把它从地形 / 建筑 / 归属底色盘里筛出来
    const bodyScale = cam ? cam.k * visScale * bodyScaleOf(type) : 0;
    const isBody = (m) => bodyScale > 0 && Math.abs(m - bodyScale) <= bodyScale * 1e-6;
    const pts = cam
      ? log.points.filter(([px, py, pm]) => {
          if (!isBody(pm)) return false;
          return Math.abs(px - (u.x - cam.x) * cam.k) < 90 && Math.abs(py - (u.y - cam.y) * cam.k) < 90;
        })
      : [];
    let box = null;
    for (const [px, py] of pts) {
      if (!box) box = { x0: px, y0: py, x1: px, y1: py };
      else {
        box.x0 = Math.min(box.x0, px);
        box.y0 = Math.min(box.y0, py);
        box.x1 = Math.max(box.x1, px);
        box.y1 = Math.max(box.y1, py);
      }
    }
    return {
      // 只数本体那一趟的描边：不然「场上单位越多 → 归属底盘描边越多」会稀释
      // 「阶数越高装饰越多」这条断言（画底盘的那一趟缩放在世界层，不是 bodyScale）
      strokes: log.strokes.filter((_, i) => isBody(log.strokeMags[i])).length,
      box: box ? { w: box.x1 - box.x0, h: box.y1 - box.y0 } : null,
    };
  };

  for (const type of TYPES) {
    const s1 = shot(type, 1);
    const s2 = shot(type, 2);
    const s3 = shot(type, 3);
    ok(
      s2.strokes > s1.strokes && s3.strokes > s2.strokes,
      `${LABEL[type]}：阶数越高装饰越多（描边 初 ${s1.strokes} < 中 ${s2.strokes} < 高 ${s3.strokes}）`
    );
    ok(
      s3.box && s1.box && s3.box.w >= s1.box.w - 0.01 && s3.box.h >= s1.box.h - 0.01,
      `${LABEL[type]}：高级体型不小于初级（${s1.box ? `${s1.box.w.toFixed(1)}×${s1.box.h.toFixed(1)}` : '?'} → ${s3.box ? `${s3.box.w.toFixed(1)}×${s3.box.h.toFixed(1)}` : '?'}）`
    );
  }

  // 锐士的基础体型至少要有盾卫的一半（宽、高都要达标）
  const w1 = shot('warrior', 1).box;
  const g1 = shot('shield', 1).box;
  const w3 = shot('warrior', 3).box;
  const g3 = shot('shield', 3).box;
  ok(
    w1 && g1 && w1.w >= g1.w * 0.5 && w1.h >= g1.h * 0.5,
    `初级锐士 ≥ 初级盾卫的一半（锐士 ${w1 ? `${w1.w.toFixed(1)}×${w1.h.toFixed(1)}` : '?'} vs 盾卫 ${g1 ? `${g1.w.toFixed(1)}×${g1.h.toFixed(1)}` : '?'}）`
  );
  ok(
    w3 && g3 && w3.w >= g3.w * 0.5 && w3.h >= g3.h * 0.5,
    `高级锐士 ≥ 高级盾卫的一半（锐士 ${w3 ? `${w3.w.toFixed(1)}×${w3.h.toFixed(1)}` : '?'} vs 盾卫 ${g3 ? `${g3.w.toFixed(1)}×${g3.h.toFixed(1)}` : '?'}）`
  );
}

console.log('\n[15] 底部指挥栏三栏：小地图（左）｜单位粗览（中）｜单位详情（右）');
{
  const html = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');
  ok(html.includes('id="warfactory-minimap"'), '左栏有小地图画布');
  ok(html.includes('id="warfactory-overview"'), '中栏有单位粗览容器');
  ok(
    html.includes('id="warfactory-unitpanel"') && html.includes('id="warfactory-facpanel"'),
    '右栏含部队 / 工厂详情面板'
  );
  ok(
    html.indexOf('warfactory-minimap') < html.indexOf('warfactory-overview') &&
      html.indexOf('warfactory-overview') < html.indexOf('warfactory-unitpanel'),
    '三栏顺序：小地图 → 单位粗览 → 单位详情'
  );
  ok(html.includes('id="warfactory-self"'), '右栏含我方概况块');

  // [8] 收起了面板，这里重新进入对战页
  Ui.render(wf.publicGameState(g), net, view);
  Ui.applySnapshot(wf.snapshot(g));
  pump();

  // 左栏：小地图画在自己那块画布上，用本地坐标（0..210 / 0..140）
  const miniPts = log.points.filter((p) => p[3] === 'warfactory-minimap');
  ok(miniPts.length > 0, '小地图画布确有绘制（' + miniPts.length + ' 个落笔点）');
  ok(
    miniPts.every((p) => p[0] >= -1 && p[0] <= MINI_W + 1 && p[1] >= -1 && p[1] <= MINI_H + 1),
    `小地图用本地坐标绘制且放大了（${MINI_W}×${MINI_H}，不再铺在战场右下角）`
  );

  // 中栏：三栏常驻（只列选中，不再平铺全部部队）；没选中时显示空态提示，
  // 而不是把整栏收掉 —— 收掉会让右栏「单位详情」滑到画面中间去。
  const myCount = (wf.snapshot(g).u || []).filter((r) => r[1] === 0).length;
  const ov = el('warfactory-overview');
  ok(myCount > 0, `场上 ${myCount} 支我方部队可用于用例`);
  ok(el('warfactory-ov-sec').hidden === false, '未选中部队时中栏依然在（三栏常驻）');
  ok(ov.children.length === 1, '未选中时粗览里是一句空态提示（' + ov.children.length + '）');
  ok(
    ov.children[0] && String(ov.children[0].className).indexOf('wov-empty') >= 0,
    '空态提示用的 .wov-empty'
  );
  ok(
    el('warfactory-detail-sec').classList.contains('is-wide') === false,
    '右栏不再跨列补位（单位详情永远钉在最右边）'
  );

  // 中栏 → 右栏：选中部队后中栏列出选中项，右栏从「我方概况」切成「单位详情」
  ok(el('warfactory-self').hidden === false, '未选中时右栏显示我方概况');
  const u15 = [...g.units].find((x) => x.ownerIdx === 0 && !x.dead);
  ok(clickWorld(u15.x, u15.y), '点选一支我方部队');
  pump();
  ok(el('warfactory-ov-sec').hidden === false, '选中后中栏照旧在');
  ok(ov.children.length === 1, '粗览只列选中的 1 支（' + ov.children.length + '）');
  ok(el('wov-count').textContent === '已选 1 支', '粗览计数为「已选 1 支」（' + el('wov-count').textContent + '）');
  ok(
    el('warfactory-detail-sec').classList.contains('is-wide') === false,
    '右栏位置始终不变（不因选中与否重排）'
  );
  ok(el('warfactory-self').hidden === true, '我方概况让位隐藏');
  ok(el('warfactory-unitpanel').hidden === false, '右栏弹出部队详情');
  ok(el('wdt-title').textContent === '单位详情', '详情栏标题回到「单位详情」');
  ok(
    el('wdt-count').textContent.includes('已选 1 支'),
    '详情栏计数为已选 1 支（' + el('wdt-count').textContent + '）'
  );

  // 左栏：小地图点击跳转镜头（harness 里 rect 恒为 1280×800，按比例换算）
  const miniEl = el('warfactory-minimap');
  miniEl.dispatch('mousedown', { button: 0, clientX: 0, clientY: 0, preventDefault() {} });
  miniEl.dispatch('mouseup', {});
  pump();
  const atTL = camFromLastFrame();
  // 顶边不再死贴视口 0：要留出顶部浮层的高度，世界最上边才不会被菜单压住
  ok(
    atTL && Math.abs(atTL.x) < 1 && atTL.y <= 0.5 && atTL.y > -40,
    '点小地图左上角 → 镜头跳到世界左上角（顶边让开顶部浮层 ' + Math.round(-atTL.y) + '）'
  );

  miniEl.dispatch('mousedown', { button: 0, clientX: 1279, clientY: 799, preventDefault() {} });
  miniEl.dispatch('mouseup', {});
  pump();
  const atBR = camFromLastFrame();
  ok(atBR && atTL && atBR.x > atTL.x && atBR.y > atTL.y, '点小地图右下角 → 镜头跳向世界右下角');

  // 主战场不再兼职小地图：战场上的点击不该再触发镜头瞬移
  canvasEl.dispatch('click', { button: 0, clientX: 4, clientY: 796 });
  pump();
  const afterClick = camFromLastFrame();
  ok(
    afterClick && atBR && afterClick.x === atBR.x && afterClick.y === atBR.y,
    '主战场上的点击不再误触发小地图跳转'
  );
}

console.log('\n[16] F2 全选 · 小地图放大 · 工厂产能升级 · 总部生产加速');
{
  // ---------- 小地图尺寸（源码常量 / DOM canvas / CSS 三处一致） ----------
  const miniCss = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/style.css'), 'utf8');
  ok(MINI_W === 300 && MINI_H === 200, `小地图逻辑尺寸已放大到 ${MINI_W}×${MINI_H}`);
  ok(
    new RegExp(`id="warfactory-minimap"[\\s\\S]{0,120}?width="${MINI_W}"[\\s\\S]{0,80}?height="${MINI_H}"`).test(
      srcHtml
    ),
    'panel.html 的小地图 canvas 尺寸同步放大'
  );
  ok(
    new RegExp(`\\.warfactory-minimap\\s*\\{[^}]*width:\\s*${MINI_W}px[^}]*height:\\s*${MINI_H}px`).test(
      miniCss
    ),
    'style.css 的小地图显示尺寸同步放大'
  );
  ok(
    new RegExp(`grid-template-columns:\\s*${MINI_W + 26}px`).test(miniCss),
    `指挥栏左栏宽度随小地图加宽（${MINI_W + 26}px）`
  );
  // 回归护栏：面板里大量 display:flex/block 的类会盖过 UA 的 [hidden]{display:none}，
  // 曾导致总部面板冒出「开辟产线」按钮。这条兜底规则必须在。
  ok(
    /#panel-warfactory \[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(miniCss),
    'style.css 保留 #panel-warfactory [hidden] 兜底规则'
  );

  // ---------- F2 全选我方部队 ----------
  {
    const gk = wf.createGameState({
      id: 'client-keys',
      players: [
        { id: 'p0', name: '甲' },
        { id: 'p1', name: '乙' },
      ],
    });
    gk.phase = 'playing';
    gk.phaseEndsAt = 0;
    Ui.render(wf.publicGameState(gk), net, view);
    Ui.applySnapshot(wf.snapshot(gk));
    pump();
    const mine = gk.units.filter((u) => u.ownerIdx === 0).length;
    ok(mine > 0, `准备 ${mine} 支我方部队用于全选用例`);

    // 上一节在粗览里点掉过 1 支，选中态会留在模块里（同局指纹不变，render 不会清）。
    // 先点地图空地取消选择，回到「未选中 = 列我方全部」的初始视图。
    const miniEl16 = el('warfactory-minimap');
    miniEl16.dispatch('mousedown', { button: 0, clientX: 0, clientY: 0, preventDefault() {} });
    miniEl16.dispatch('mouseup', {});
    pump();
    clickWorld(6, 6); // 世界左上角空地：既没有单位也没有建筑 → 清空选择
    pump();
    ok(
      el('warfactory-ov-sec').hidden === false &&
        String(el('warfactory-overview').children[0].className).indexOf('wov-empty') >= 0,
      '未选中部队时中栏常驻，只显示空态提示（不再平铺全部部队）'
    );

    winStub.dispatch('keydown', { code: 'F2', target: null, preventDefault() {} });
    pump();
    ok(
      el('wov-count').textContent === '已选 ' + mine + ' 支',
      `F2 全选我方部队（${el('wov-count').textContent} / 共 ${mine} 支）`
    );
    ok(el('warfactory-self').hidden === true, '全选后右栏切到单位详情');

    winStub.dispatch('keydown', { code: 'KeyF', target: null, preventDefault() {} });
    pump();
    ok(hasSelectAllUnits, 'ui.js 里 selectAllUnits() 与 F2 分支同在（源码核对）');
  }

  // ---------- 工厂面板：产能 + 开辟产线 ----------
  {
    g.players[0].rp = 2000;
    g.hqs[0].speedLv = 0;
    g.factories[0].lines = 1;
    Ui.render(wf.publicGameState(g), net, view);
    Ui.applySnapshot(wf.snapshot(g));
    pump();
    const fac0 = g.factories[0];
    ok(clickWorld(fac0.x, fac0.y), '点选工厂');

    const lineBtn = el('warfactory-facpanel #wfp-line');
    const lineText = el('warfactory-facpanel #wfp-lines');
    const rateText = el('warfactory-facpanel #wfp-rate');
    const spdBox = el('warfactory-facpanel #wfp-spd');
    ok(lineText.textContent === '产线 1 / 3', '显示产线数（' + lineText.textContent + '）');
    ok(/秒 \/ 支/.test(rateText.textContent), '显示产出速率（' + rateText.textContent + '）');
    ok(
      rateText.textContent.includes('20.0 秒 / 支') && rateText.textContent.includes('1 条并行'),
      '单条产线时速率 = 基础间隔（20.0 秒 / 支）'
    );
    ok(lineBtn.hidden === false && !lineBtn.disabled, '开辟产线按钮可用（' + lineBtn.textContent + '）');
    ok(lineBtn.textContent.includes('500'), '按钮标注 500 科技点');
    ok(spdBox.hidden === true, '工厂面板不显示总部专用的生产加速段');

    sent.length = 0;
    lineBtn.dispatch('click', { stopPropagation() {} });
    ok(
      sent.some((d) => d.cmd === 'facLine' && d.fid === fac0.id),
      '点按钮发出 facLine 指令（' + JSON.stringify(sent[0]) + '）'
    );

    // 科技点不足 → 禁用
    g.players[0].rp = 100;
    Ui.applySnapshot(wf.snapshot(g));
    pump();
    ok(lineBtn.disabled === true && lineBtn.textContent.includes('科技点不足'), '科技点不足时禁用（' + lineBtn.textContent + '）');

    // 产线满 → 按钮变成「已满」
    g.players[0].rp = 5000;
    g.factories[0].lines = 3;
    Ui.applySnapshot(wf.snapshot(g));
    pump();
    ok(lineText.textContent === '产线 3 / 3', '产线数随快照刷新（' + lineText.textContent + '）');
    ok(lineBtn.disabled === true && lineBtn.textContent.includes('已满'), '满产线后按钮变为「已满」（' + lineBtn.textContent + '）');
    ok(
      rateText.textContent.includes('3 条并行') && rateText.textContent.includes('6.7 秒 1 支'),
      '3 条并行时合计每 6.7 秒 1 支（' + rateText.textContent + '）'
    );
  }

  // ---------- 总部面板：血量 + 生产加速 ----------
  {
    g.players[0].rp = 5000;
    g.factories[0].lines = 1;
    g.hqs[0].speedLv = 0;
    Ui.render(wf.publicGameState(g), net, view);
    Ui.applySnapshot(wf.snapshot(g));
    pump();
    const hq = g.hqs.find((h) => h.owner === 0);
    const hqp = clickBuildingPoint(hq, 30);
ok(clickWorld(hqp.x, hqp.y), '点选总部');

    const spdBox = el('warfactory-facpanel #wfp-spd');
    const spdLv = el('warfactory-facpanel #wfp-spd-lv');
    const spdRate = el('warfactory-facpanel #wfp-spd-rate');
    const spdBtn = el('warfactory-facpanel #wfp-speed');
    ok(spdBox.hidden === false, '总部面板显示「生产加速」段');
    ok(
      el('warfactory-facpanel #wfp-hp-text').textContent.includes('/'),
      '总部面板展示血量（' + el('warfactory-facpanel #wfp-hp-text').textContent + '）'
    );
    ok(spdLv.textContent === '生产加速 0 / 20 级', '显示加速等级（' + spdLv.textContent + '）');
    ok(spdBtn.hidden === false && !spdBtn.disabled, '加速按钮可用（' + spdBtn.textContent + '）');
    ok(spdBtn.textContent.includes('1000'), '按钮标注 1000 科技点');
    ok(el('warfactory-facpanel #wfp-line').hidden === true, '总部面板隐藏「开辟产线」按钮');
    ok(el('warfactory-facpanel #wfp-prod-sec').hidden === true, '总部面板隐藏「产能」段');

    sent.length = 0;
    spdBtn.dispatch('click', { stopPropagation() {} });
    ok(
      sent.some((d) => d.cmd === 'prodSpeed'),
      '点按钮发出 prodSpeed 指令（' + JSON.stringify(sent[0]) + '）'
    );

    // 等级提高 → 等级与间隔同步刷新（复利：每级在当前间隔上再减 1/15）
    g.hqs[0].speedLv = 3;
    Ui.applySnapshot(wf.snapshot(g));
    pump();
    ok(spdLv.textContent === '生产加速 3 / 20 级', '等级随快照刷新（' + spdLv.textContent + '）');
    // 注意：先乘再 toFixed，别写成 20 * Math.pow(...).toFixed(1)（那是字符串乘法）
    const expect3 = (20 * Math.pow(14 / 15, 3)).toFixed(1);
    ok(
      spdRate.textContent.includes('20.0 秒 → ' + expect3 + ' 秒'),
      `间隔按 (14/15)^3 复利缩短（${spdRate.textContent}）`
    );
    ok(spdRate.textContent.includes('提速'), '显示已提速百分比');

    // 满级 → 禁用
    g.hqs[0].speedLv = 20;
    Ui.applySnapshot(wf.snapshot(g));
    pump();
    ok(spdBtn.disabled === true && spdBtn.textContent.includes('已满级'), '满 20 级后按钮禁用（' + spdBtn.textContent + '）');
    ok(spdLv.textContent === '生产加速 20 / 20 级', '满级显示（' + spdLv.textContent + '）');
  }

  // ---------- 面板互斥：点单位时这两段都不该出现 ----------
  {
    g.hqs[0].speedLv = 0;
    Ui.applySnapshot(wf.snapshot(g));
    pump();
    const u0 = [...g.units].find((u) => u.ownerIdx === 0 && !u.dead);
    if (u0) {
      ok(clickWorld(u0.x, u0.y), '点选我方单位');
      ok(el('warfactory-unitpanel').hidden === false, '右栏弹出部队详情');
      ok(el('warfactory-facpanel').hidden === true, '工厂/总部面板让位');
      ok(el('warfactory-self').hidden === true, '我方概况让位');
    }
  }
}

console.log('\n[17] 滚轮缩放大地图 · 空格回总部');
{
  const CW = 1280; // 桩 canvas 的 CSS 尺寸
  const CH = 800;
  const zoomOf = () => {
    const c = camFromLastFrame();
    return c ? c.k : 0; // dpr=1，故 k 就是 zoom
  };
  const viewSize = () => {
    const z = zoomOf() || 1;
    return { w: CW / z, h: CH / z };
  };
  const camCenter = () => {
    const c = camFromLastFrame();
    const v = viewSize();
    return { x: c.x + v.w / 2, y: c.y + v.h / 2 };
  };
  /** 鼠标位置（画布像素）下压着的世界坐标——缩放锚点是否守住就看它 */
  const worldUnder = (px, py) => {
    const c = camFromLastFrame();
    const v = viewSize();
    return { x: c.x + (px / CW) * v.w, y: c.y + (py / CH) * v.h };
  };
  const wheel = (deltaY, px, py) => {
    canvasEl.dispatch('wheel', {
      deltaY,
      deltaMode: 0,
      clientX: px,
      clientY: py,
      preventDefault() {},
    });
    pump(); // 缩放是同步改相机，跑一帧后 setTransform 才反映出来
  };
  const mini17 = el('warfactory-minimap');
  const miniNav = (fx, fy) => {
    const r = mini17.getBoundingClientRect();
    const evt = {
      button: 0,
      clientX: r.left + fx * r.width,
      clientY: r.top + fy * r.height,
      preventDefault() {},
    };
    mini17.dispatch('mousedown', evt);
    mini17.dispatch('mouseup', evt);
    pump();
  };

  g.hqs[0].speedLv = 0;
  Ui.render(wf.publicGameState(g), net, view);
  Ui.applySnapshot(wf.snapshot(g));
  pump();
  const ws = wf.publicGameState(g).world;

  // ---------- 事件接线（源码核对）----------
  ok(
    /addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(src),
    '主画布注册 wheel（passive:false，能阻止页面跟着滚）'
  );
  ok(/removeEventListener\('wheel', onWheel\)/.test(src), '解绑时一并摘掉 wheel');
  ok(!/miniCanvas\.addEventListener\('wheel'/.test(src), '小地图不接管滚轮（避免误缩放）');
  ok(/case 'Space':[\s\S]{0,200}?centerOnMyBase\(\)/.test(src), '空格分支绑定 centerOnMyBase（源码核对）');

  // ---------- 1 倍基准 ----------
  miniNav(0.5, 0.5); // 镜头落到世界正中，四周都有余量，不会被 clamp 干扰
  ok(Math.abs(zoomOf() - 1) < 1e-6, '1 倍镜头：视野 ' + Math.round(viewSize().w) + '×' + Math.round(viewSize().h) + ' 世界像素');
  const c0 = camCenter();
  ok(
    Math.abs(c0.x - ws.w / 2) < 1 && Math.abs(c0.y - ws.h / 2) < 1,
    '小地图点击把镜头对到世界中心（' + Math.round(c0.x) + ',' + Math.round(c0.y) + '）'
  );

  // ---------- 放大：以鼠标为锚点 ----------
  const anchorBefore = worldUnder(960, 400);
  wheel(-600, 960, 400); // 向上滚 = 放大
  const z1 = zoomOf();
  ok(z1 > 1.1, '向上滚放大：1.00× → ' + z1.toFixed(2) + '×');
  ok(
    Math.abs(viewSize().w * z1 - CW) < 1 && Math.abs(viewSize().h * z1 - CH) < 1,
    '视野尺寸与缩放互洽（cssW/zoom）'
  );
  const anchorAfter = worldUnder(960, 400);
  ok(
    Math.abs(anchorAfter.x - anchorBefore.x) < 0.5 && Math.abs(anchorAfter.y - anchorBefore.y) < 0.5,
    '鼠标所指的世界点缩放前后不动（锚点 ' + Math.round(anchorBefore.x) + ',' + Math.round(anchorBefore.y) + '）'
  );
  ok(viewSize().w < CW, '放大后视野变窄（' + Math.round(viewSize().w) + ' 世界像素宽）');

  // ---------- 缩小：下限＝整张地图装进「扣掉上下浮层」的可见区（再松 15%）----------
  for (let i = 0; i < 60; i++) wheel(240, 640, 400);
  const zMin = zoomOf();
  const vMin = viewSize();
  const OVERLAY = 28; // 测试桩没有真实浮层：上下各退回默认边距（HUD_PAD=14）
  const fitMin = Math.min(CW / ws.w, (CH - OVERLAY) / ws.h); // 整图装进可见区的倍率
  const expectMin = Math.max(0.22, fitMin * 0.85);
  ok(
    Math.abs(zMin - expectMin) < 0.02,
    '缩放下限 = max(0.22 倍, 整图装进可见区 × 0.85)（' + zMin.toFixed(3) + '× ≈ ' + expectMin.toFixed(3) + '×）'
  );
  ok(zMin < 0.5, '比原来的 0.5 倍下限拉得更远（' + zMin.toFixed(2) + '×）');
  // 视野比世界还大时不再贴着某个角：整图摆在可见区中间，留白左右对称
  if (vMin.w > ws.w + 1) {
    const cMin = camCenter();
    ok(
      Math.abs(cMin.x - ws.w / 2) < 1,
      '拉到最远（视野比世界宽）→ 地图左右居中（中心 ' + Math.round(cMin.x) + ' / 世界中心 ' + ws.w / 2 + '）'
    );
  }

  // ---------- 上限 ----------
  for (let i = 0; i < 80; i++) wheel(-240, 640, 400);
  const zMax = zoomOf();
  ok(Math.abs(zMax - 2.2) < 0.05, '推到最近停在 2.2 倍（' + zMax.toFixed(2) + '×）');

  // ---------- 空格：回总部，且不动缩放 ----------
  const hq = g.hqs.find((h) => h.owner === 0);
  ok(Boolean(hq), '存在自家总部可用于回镜头');
  // 把总部挪到偏离世界中心的位置：否则「对准总部」和「clamp 到中心」分不出来
  hq.x = Math.round(ws.w * 0.25);
  hq.y = Math.round(ws.h * 0.3);
  // 增量快照（game:rt）不带建筑坐标：总部挪窝必须走全量 game:state 才会进 hqView
  Ui.render(wf.publicGameState(g), net, view);
  Ui.applySnapshot(wf.snapshot(g));
  pump();
  miniNav(0.04, 0.06); // 先把镜头挪到左上角远离总部
  const away = camCenter();
  ok(Math.hypot(away.x - hq.x, away.y - hq.y) > 300, '镜头先离开总部（' + Math.round(away.x) + ',' + Math.round(away.y) + '）');
  const zBefore = zoomOf();
  miniNav(0.9, 0.9); // 再挪到右下角，确保空格是唯一把镜头拉回去的动作
  winStub.dispatch('keydown', { code: 'Space', target: null, preventDefault() {} });
  pump();
  const v2 = viewSize();
  const wantX = Math.min(Math.max(hq.x - v2.w / 2, 0), Math.max(0, ws.w - v2.w)) + v2.w / 2;
  const wantY = Math.min(Math.max(hq.y - v2.h / 2, 0), Math.max(0, ws.h - v2.h)) + v2.h / 2;
  const c2 = camCenter();
  ok(
    Math.abs(c2.x - hq.x) < 1 && Math.abs(c2.y - hq.y) < 1,
    '空格把镜头对准自家总部（' + Math.round(c2.x) + ',' + Math.round(c2.y) + ' → 总部 ' + hq.x + ',' + hq.y + '）'
  );
  ok(
    Math.abs(c2.x - wantX) < 1 && Math.abs(c2.y - wantY) < 1,
    '对准结果与 clampCam 边界一致（不越出世界）'
  );
  ok(Math.abs(zoomOf() - zBefore) < 1e-6, '空格不改变缩放倍率（仍 ' + zoomOf().toFixed(2) + '×）');

  // ---------- 总部没了 → 退到自家工厂 ----------
  ok(/function centerOnMyBase\(\)[\s\S]{0,600}?pickMine\(factoriesView\)/.test(src), '总部不可用时退回自家工厂（源码核对）');
  ok(/function centerOnMyBase\(\)[\s\S]{0,900}?boxSel\.on = false/.test(src), '空格同时取消进行中的框选');

  // 收尾：滚回 1 倍——后续用例的屏幕坐标换算默认按 1 倍算，留着 2.2 倍会串味
  for (let i = 0; i < 40 && Math.abs(zoomOf() - 1) > 0.005; i++) {
    const k = zoomOf();
    const dy = Math.min(600, Math.max(-600, Math.round(Math.log(k) / Math.log(1.0016))));
    if (!dy) break;
    wheel(dy, 640, 400);
  }
  ok(Math.abs(zoomOf() - 1) < 0.02, '用例收尾滚回 1 倍（' + zoomOf().toFixed(3) + '×）');
}

console.log('\n[18] 侦察他方目标（只读）· 框选只圈自己 · 中栏只列选中');
{
  const css18 = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/style.css'), 'utf8');
  const html18 = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');
  ok(
    html18.includes('id="warfactory-ov-sec"') && html18.includes('id="warfactory-detail-sec"'),
    'panel.html 给中栏 / 右栏整段加了 id'
  );
  ok(/\.wcb-overview\[hidden\]\s*\{[^}]*display:\s*none/.test(css18), 'style.css 保证中栏 hidden 时整段收掉');
  // 右栏宽度随时间视口伸缩，但**永远在最后一列**（不许再跨列补位到画面中间）
  ok(
    /\.warfactory-cmdbar\s*\{[^}]*grid-template-columns:\s*326px[^;]*clamp\(/.test(css18),
    '指挥栏三栏常驻，右栏宽度用 clamp 随视口伸缩'
  );
  ok(
    !/\.wcb-detail\.is-wide\s*\{[^}]*grid-column:\s*2\s*\/\s*4/.test(css18),
    '已移除「右栏跨两列补位」（单位详情固定在最右）'
  );
  // 详情栏内部两列 + 正文撑满（不再写死 216px，否则内容要滚动才看得全）
  ok(
    /\.wfp-cols,\s*\n?\.wup-cols\s*\{[^}]*display:\s*grid/.test(css18),
    'style.css 给工厂 / 部队面板做了两列排布'
  );
  ok(
    /\.wdt-body\s*\{[^}]*flex:\s*1 1 auto[^}]*min-height:\s*0/.test(css18),
    '详情正文撑满整栏高度（高度跟着指挥栏走）'
  );
  ok(
    /function selectUnitsInBox[\s\S]{0,500}?if \(u\.oi !== mine\) continue;/.test(src),
    '框选只圈我方部队（源码核对：敌方进不了框选）'
  );
  ok(/function unitAt\(wx, wy, ownerIdx\)/.test(src), '命中判定支持任意归属（只读查看用）');
  ok(/function cleanPeek\(\)/.test(src), '有「目标消失自动收起」的清理函数');
  ok(/function drawInspectMark\(t\)/.test(src), '战场上有「查看中」的取景标记');

  const ws18 = wf.publicGameState(g).world;
  const mini18 = el('warfactory-minimap');
  const focusTo = (wx, wy) => {
    const r = mini18.getBoundingClientRect();
    const evt = {
      button: 0,
      clientX: (wx / ws18.w) * r.width,
      clientY: (wy / ws18.h) * r.height,
      preventDefault() {},
    };
    mini18.dispatch('mousedown', evt);
    mini18.dispatch('mouseup', evt);
    pump();
  };
  const up18 = (sel) => el('warfactory-unitpanel ' + sel);
  const fp18 = (sel) => el('warfactory-facpanel ' + sel);
  // 屏幕换算带上当前缩放 k（真实浏览器里 zoom≠1 时就是 (世界-镜头)×k）
  const clickW = (wx, wy) => {
    const c = camFromLastFrame();
    if (!c) return false;
    const evt = {
      button: 0,
      clientX: (wx - c.x) * c.k,
      clientY: (wy - c.y) * c.k,
      preventDefault() {},
      shiftKey: false,
    };
    canvasEl.dispatch('mousedown', evt);
    canvasEl.dispatch('mouseup', evt);
    pump();
    return true;
  };
  const dragW = (x0, y0, x1, y1) => {
    const c = camFromLastFrame();
    if (!c) return false;
    const mk = (wx, wy) => ({
      button: 0,
      clientX: (wx - c.x) * c.k,
      clientY: (wy - c.y) * c.k,
      preventDefault() {},
      shiftKey: false,
    });
    canvasEl.dispatch('mousedown', mk(x0, y0));
    canvasEl.dispatch('mousemove', mk(x1, y1));
    canvasEl.dispatch('mouseup', mk(x1, y1));
    pump();
    return true;
  };
  const reRender = () => {
    Ui.render(wf.publicGameState(g), net, view);
    Ui.applySnapshot(wf.snapshot(g));
    pump();
  };

  // ---- 造场景：敌方部队 / 敌方工厂 / 敌方总部 / 中立研究所，坐标彼此错开 ----
  const foeU = [...g.units].find((u) => u.ownerIdx === 1);
  const foeF = g.factories.find((f) => f.owner === 1) || g.factories[1];
  const foeHq = g.hqs.find((h) => h.owner === 1);
  const lab = g.labs[0];
  ok(Boolean(foeU && foeF && foeHq && lab), '场上凑齐敌方部队 / 工厂 / 总部与研究所');
  foeF.owner = 1;
  lab.owner = -1;
  const at = (r, c) => ({ x: Math.round(ws18.w * r), y: Math.round(ws18.h * c) });
  Object.assign(foeF, at(0.28, 0.28));
  Object.assign(foeHq, at(0.72, 0.28));
  Object.assign(lab, at(0.28, 0.72));
  Object.assign(foeU, at(0.5, 0.5));
  foeU.moveX = null;
  foeU.moveY = null;
  reRender();

  // ---- ① 点敌方部队：能看数据，不能指挥 ----
  focusTo(foeU.x, foeU.y);
  sent.length = 0;
  ok(clickW(foeU.x, foeU.y), '点选敌方部队');
  pump();
  ok(el('warfactory-unitpanel').hidden === false, '右栏弹出单位信息');
  ok(el('warfactory-facpanel').hidden === true, '建筑面板让位');
  ok(el('wdt-title').textContent === '侦察', '详情栏标题切到「侦察」（' + el('wdt-title').textContent + '）');
  ok(el('wdt-count').textContent === '仅供查看', '标注「仅供查看」（' + el('wdt-count').textContent + '）');
  ok(up18('#wup-title').textContent.indexOf('敌军') === 0, '标题写明敌军（' + up18('#wup-title').textContent + '）');
  ok(up18('#wup-name').textContent.includes('乙'), '标出对手名（' + up18('#wup-name').textContent + '）');
  ok(up18('#wup-note').textContent.includes('仅供查看'), '底部提示只读（' + up18('#wup-note').textContent + '）');
  ok(/\/ \d+$/.test(up18('#wup-hp-text').textContent.trim()), '血量照常显示（' + up18('#wup-hp-text').textContent + '）');
  ok(/攻　击/.test(up18('#wup-stats').textContent), '属性表照常显示');
  ok(
    el('warfactory-ov-sec').hidden === false &&
      el('warfactory-overview').children.length === 1 &&
      String(el('warfactory-overview').children[0].className).indexOf('wov-empty') >= 0,
    '侦察时中栏常驻但只留空态提示（他方部队不进粗览）'
  );
  ok(el('warfactory-self').hidden === true, '我方概况也收起');
  canvasEl.dispatch('mousedown', { button: 2, clientX: 400, clientY: 300, preventDefault() {} });
  pump();
  ok(!sent.some((d) => d.cmd === 'move'), '侦察敌方部队时右键不会发出行军指令');

  // ---- ② 点敌方工厂：只读，没有任何升级按钮 ----
  focusTo(foeF.x, foeF.y);
  sent.length = 0;
  ok(clickW(foeF.x, foeF.y), '点选敌方工厂');
  pump();
  ok(el('warfactory-facpanel').hidden === false && el('warfactory-unitpanel').hidden === true, '右栏切到建筑信息');
  ok(fp18('#wfp-title').textContent.indexOf('敌军') === 0, '标题标注敌军（' + fp18('#wfp-title').textContent + '）');
  ok(fp18('#wfp-owner').textContent.includes('乙'), '归属显示对手（' + fp18('#wfp-owner').textContent + '）');
  ok(fp18('#wfp-line').hidden === true, '不出现「开辟产线」');
  ok(fp18('#wfp-evolve').hidden === true, '不出现「进化」');
  ok(fp18('#wfp-spd').hidden === true, '不出现「生产加速」');
  ok(fp18('#wfp-rally').hidden === true, '不出现「集结点」');
  ok(fp18('#wfp-note').textContent.includes('仅供查看'), '底部提示只读（' + fp18('#wfp-note').textContent + '）');
  ok(/\/ \d+$/.test(fp18('#wfp-hp-text').textContent.trim()), '血量照常显示（' + fp18('#wfp-hp-text').textContent + '）');
  fp18('#wfp-line').dispatch('click', { stopPropagation() {} });
  fp18('#wfp-evolve').dispatch('click', { stopPropagation() {} });
  fp18('#wfp-speed').dispatch('click', { stopPropagation() {} });
  pump();
  ok(sent.length === 0, '就算硬点（已隐藏的）按钮也不会发出任何指令');

  // ---- ③ 敌方总部 ----
  focusTo(foeHq.x, foeHq.y);
  ok(clickW(foeHq.x, foeHq.y), '点选敌方总部');
  pump();
  ok(fp18('#wfp-title').textContent === '敌军总部', '总部标题（' + fp18('#wfp-title').textContent + '）');
  ok(fp18('#wfp-spd').hidden === true, '敌方总部没有加速段');
  ok(fp18('#wfp-note').textContent.includes('仅供查看'), '底部提示只读');

  // ---- ④ 中立研究所 ----
  focusTo(lab.x, lab.y);
  ok(clickW(lab.x, lab.y), '点选研究所');
  pump();
  ok(fp18('#wfp-title').textContent === '研究所', '研究所标题（' + fp18('#wfp-title').textContent + '）');
  ok(fp18('#wfp-owner').textContent.includes('中立'), '显示中立（' + fp18('#wfp-owner').textContent + '）');
  ok(fp18('#wfp-line').hidden === true, '研究所没有产线按钮');
  ok(fp18('#wfp-note').textContent.includes('仅供查看'), '提示只读 + 占领产出');

  // ---- ⑤ 点空地收起，右栏回到我方概况 ----
  clickW(8, 8);
  pump();
  ok(el('warfactory-facpanel').hidden === true && el('warfactory-unitpanel').hidden === true, '点空地收起侦察面板');
  ok(el('warfactory-self').hidden === false, '右栏回到我方概况');
  ok(el('wdt-title').textContent === '我方概况', '标题回到「我方概况」（' + el('wdt-title').textContent + '）');

  // ---- ⑥ 框选只圈自己，并把侦察状态清掉 ----
  const myU = [...g.units].find((u) => u.ownerIdx === 0 && !u.dead);
  const foeU2 = [...g.units].find((u) => u.ownerIdx === 1);
  myU.x = Math.round(ws18.w * 0.6);
  myU.y = Math.round(ws18.h * 0.62);
  foeU2.x = myU.x + 60;
  foeU2.y = myU.y;
  foeU2.moveX = null;
  foeU2.moveY = null;
  reRender();
  focusTo(myU.x, myU.y);
  clickW(foeU2.x, foeU2.y);
  pump();
  ok(el('wdt-title').textContent === '侦察', '框选前先看了这支部队');
  dragW(myU.x - 260, myU.y - 260, myU.x + 320, myU.y + 260);
  pump();
  const inBox = g.units.filter(
    (u) => u.ownerIdx === 0 && Math.abs(u.x - myU.x) <= 300 && Math.abs(u.y - myU.y) <= 260
  ).length;
  ok(el('warfactory-ov-sec').hidden === false, '框选后中栏出现');
  ok(
    el('wov-count').textContent === '已选 ' + inBox + ' 支',
    '框选只圈到我方 ' + inBox + ' 支（' + el('wov-count').textContent + '）'
  );
  ok(up18('#wup-title').textContent.indexOf('敌军') !== 0, '右栏显示的是我方部队，不是敌方');
  ok(el('wdt-title').textContent === '单位详情', '侦察状态被框选清掉');

  // ---- ⑦ 目标被打光（从快照消失）→ 面板自动收起 ----
  Object.assign(foeU2, at(0.8, 0.8)); // 先挪到空处，免得又点到我方部队
  reRender();
  focusTo(foeU2.x, foeU2.y);
  clickW(foeU2.x, foeU2.y);
  pump();
  ok(
    el('warfactory-unitpanel').hidden === false && up18('#wup-title').textContent.indexOf('敌军') === 0,
    '先侦察这支部队'
  );
  g.units.splice(g.units.indexOf(foeU2), 1);
  reRender();
  ok(el('warfactory-unitpanel').hidden === true, '目标消失后侦察面板自动收起');
  ok(el('warfactory-ov-sec').hidden === false, '中栏常驻（空态提示）');

  // ---- ⑧ 右键锁定攻击目标：选中我方部队 → 点敌 / 中立目标 → attack 指令；点空地 → move ----
  const waitCmd = () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 120) {} // 跨过 110ms 指令限速窗口
  };
  const rightClickW = (wx, wy) => {
    const c = camFromLastFrame();
    if (!c) return false;
    const evt = {
      button: 2,
      clientX: (wx - c.x) * c.k,
      clientY: (wy - c.y) * c.k,
      preventDefault() {},
    };
    canvasEl.dispatch('mousedown', evt);
    pump();
    return true;
  };
  // ⑦ 把那支敌方部队移出了游戏，这里重新放一支，并摆到我方部队近旁
  const foeAtk = wf.__test.spawnUnit(g, { id: 0, owner: 1, level: 1 }, 'warrior', 0, 0);
  myU.x = Math.round(ws18.w * 0.42);
  myU.y = Math.round(ws18.h * 0.84);
  foeAtk.x = Math.round(ws18.w * 0.58);
  foeAtk.y = Math.round(ws18.h * 0.84);
  foeAtk.moveX = null;
  foeAtk.moveY = null;
  lab.owner = -1; // 中立研究所：也应是合法攻击目标
  reRender();
  focusTo(myU.x, myU.y);
  clickW(myU.x, myU.y);
  pump();
  ok(el('warfactory-ov-sec').hidden === false, '已选中我方部队（准备锁定攻击）');
  waitCmd();
  sent.length = 0;
  rightClickW(foeAtk.x, foeAtk.y);
  ok(
    sent.some((d) => d.cmd === 'attack' && d.kind === 'u' && d.id === foeAtk.id),
    '右键敌方单位 → 发出 attack(u) 指令（' + JSON.stringify(sent) + '）'
  );
  ok(!sent.some((d) => d.cmd === 'move'), '锁定攻击时不误发行军指令');
  waitCmd();
  sent.length = 0;
  focusTo(lab.x, lab.y);
  rightClickW(lab.x, lab.y);
  ok(
    sent.some((d) => d.cmd === 'attack' && d.kind === 'l' && d.id === lab.id),
    '右键中立研究所 → 发出 attack(l) 指令（' + JSON.stringify(sent) + '）'
  );
  waitCmd();
  sent.length = 0;
  const gx18 = Math.round(ws18.w * 0.15);
  const gy18 = Math.round(ws18.h * 0.15);
  focusTo(gx18, gy18);
  rightClickW(gx18, gy18);
  ok(sent.some((d) => d.cmd === 'move'), '右键空地 → 照常发出 move 指令（' + JSON.stringify(sent) + '）');
  ok(
    /function issueAttackOn\(wx, wy\)/.test(src) &&
      /if \(selection\.size > 0 && issueAttackOn\(pos\.x, pos\.y\)\)/.test(src),
    '源码核对：右键分流先尝试锁定攻击目标（再退回集结点 / 行军）'
  );

  // ---- ⑨ 追击命令的常驻指示：命令在 → 目标处有转动的虚线锁定环 + 到执行部队的虚线 ----
  waitCmd();
  myU.manualTarget = { kind: 'u', id: foeAtk.id };
  clickW(myU.x, myU.y); // 重新选中执行部队（刚才点空地已取消选择）
  log.dashes.length = 0;
  Ui.applySnapshot(wf.snapshot(g));
  pump();
  const dashPat = (p) => log.dashes.some((d) => Array.isArray(d) && d.length === 2 && d[0] === p[0] && d[1] === p[1]);
  ok(dashPat([7, 6]), '追击命令：目标处绘制转动的虚线锁定环');
  ok(dashPat([5, 7]), '追击命令：被选中部队到目标拉出虚线指示');
  ok(
    /function targetInfoOf\(kind, id\)/.test(src) && /u\.ok = row\[16\] \|\| 0;/.test(src),
    '源码核对：快照 18 列解析（ok/od）+ 类别→坐标解析（targetInfoOf）'
  );
  // 命令解除 → 指示立刻消失
  myU.manualTarget = null;
  log.dashes.length = 0;
  Ui.applySnapshot(wf.snapshot(g));
  pump();
  ok(!dashPat([7, 6]) && !dashPat([5, 7]), '命令解除后常驻指示消失（右键别处 / 停止 / 目标阵亡）');
}

console.log('\n[19] 数字键编队：编入 · 选中 · 连按两下镜头飞到首支部队');
{
  const html19 = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');
  const DBL_MS = Number((/const SQUAD_DBL_MS = (\d+);/.exec(src) || [0, 0])[1]) || 350;

  // ---------- 源码 / 图例核对 ----------
  ok(/function squadKeyOf\(code\)/.test(src), '有数字键解析（Digit0-9 与小键盘）');
  ok(/const SQUAD_DBL_MS = \d+;/.test(src), '「连按两下」有明确的时间窗常量（' + DBL_MS + 'ms）');
  ok(
    /function onKeyDown\(evt\)[\s\S]{0,600}?squadKeyOf\(evt\.code\)/.test(src),
    'onKeyDown 最前面就接管数字键（不落进方向键那套分支）'
  );
  ok(/function onSquadKey\(n, isRepeat\)/.test(src), '数字键按下走 onSquadKey（带长按标记）');
  ok(
    /function onSquadKey\(n, isRepeat\)[\s\S]{0,900}?centerOn\(first\.x, first\.y\)/.test(src),
    '连按两下 → centerOn 编队第一支部队（源码核对）'
  );
  ok(
    /function assignSquad\(n\)[\s\S]{0,600}?if \(u\.oi === mine\) ids\.push\(u\.id\)/.test(src),
    '编入时只收我方部队（他人的进不了编队）'
  );
  ok(
    /function squadUnits\(n\)[\s\S]{0,600}?out\.sort\(\(a, b\) => a\.id - b\.id\)/.test(src),
    '编队按 id 升序 → 「第一个单位」稳定可预期'
  );
  ok(/squadTapNum = isRepeat \? -1 : n;/.test(src), '长按（repeat）不计入连按，按住数字键不会一直跳镜头');
  ok(
    /squadKeyOf\(evt\.code\)[\s\S]{0,300}?isSpectator \|\| myPlayerIndex\(\) < 0\) return;/.test(src),
    '观战/已出局时数字键不做编队'
  );
  ok(html19.includes('连按两下'), 'panel.html 图例写明「连按两下」的用法');
  ok(html19.includes('编队'), 'panel.html 图例写明 Ctrl / Shift + 数字编队');
  ok(/function drawHudHints\(\)/.test(src), '编队操作有屏幕提示（左下角短提示）');

  // ---------- 造场景：4 支「新 id」的我方部队 ----------
  // 新 id 会让客户端新建视图条目，坐标即权威坐标（绝无插值误差），断言才敢卡到像素
  const ws19 = wf.publicGameState(g).world;
  const mini19 = el('warfactory-minimap');
  const focusTo19 = (wx, wy) => {
    const r = mini19.getBoundingClientRect();
    const evt = {
      button: 0,
      clientX: r.left + (wx / ws19.w) * r.width,
      clientY: r.top + (wy / ws19.h) * r.height,
      preventDefault() {},
    };
    mini19.dispatch('mousedown', evt);
    mini19.dispatch('mouseup', evt);
    pump();
  };
  const cam19 = () => {
    const c = camFromLastFrame();
    if (!c) return null;
    return { x: c.x + 1280 / (2 * c.k), y: c.y + 800 / (2 * c.k), k: c.k };
  };
  const clickW19 = (wx, wy) => {
    const c = camFromLastFrame();
    if (!c) return false;
    const evt = {
      button: 0,
      clientX: (wx - c.x) * c.k,
      clientY: (wy - c.y) * c.k,
      preventDefault() {},
      shiftKey: false,
    };
    canvasEl.dispatch('mousedown', evt);
    canvasEl.dispatch('mouseup', evt);
    pump();
    return true;
  };
  const dragW19 = (x0, y0, x1, y1) => {
    const c = camFromLastFrame();
    if (!c) return false;
    const mk = (wx, wy) => ({
      button: 0,
      clientX: (wx - c.x) * c.k,
      clientY: (wy - c.y) * c.k,
      preventDefault() {},
      shiftKey: false,
    });
    canvasEl.dispatch('mousedown', mk(x0, y0));
    canvasEl.dispatch('mousemove', mk(x1, y1));
    canvasEl.dispatch('mouseup', mk(x1, y1));
    pump();
    return true;
  };
  const reRender19 = () => {
    Ui.render(wf.publicGameState(g), net, view);
    Ui.applySnapshot(wf.snapshot(g));
    pump();
  };
  /** 真按键：数字键走的就是这条路（而不是直接调内部函数） */
  const key = (code, mods) => {
    const evt = {
      code,
      target: null,
      repeat: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault() {},
    };
    Object.assign(evt, mods || {});
    winStub.dispatch('keydown', evt);
    pump();
  };
  const selCount = () => {
    const m = /已选 (\d+) 支/.exec(el('wov-count').textContent);
    return m ? Number(m[1]) : -1;
  };
  const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);

  const proto = g.units.find((u) => u.ownerIdx === 0 && !u.dead);
  ok(Boolean(proto), '找得到一支我方部队做模板');
  const baseId = 9000;
  const cl = { x: Math.round(ws19.w * 0.42), y: Math.round(ws19.h * 0.45) };
  const rooks = [];
  for (let i = 0; i < 4; i++) {
    const nu = Object.assign({}, proto, {
      id: baseId + i,
      x: cl.x + (i % 2) * 46,
      y: cl.y + Math.floor(i / 2) * 46,
      moveX: null,
      moveY: null,
    });
    g.units.push(nu);
    rooks.push(nu);
  }
  g.nextUnitId = Math.max(g.nextUnitId || 1, baseId + 10);
  reRender19();
  ok(Math.abs(cam19().k - 1) < 0.02, '用例起始缩放是 1 倍（' + cam19().k.toFixed(3) + '×）');

  // ---------- ① 框选新兵 → Shift+1 编入 1 号 ----------
  focusTo19(cl.x, cl.y);
  ok(dragW19(cl.x - 80, cl.y - 80, cl.x + 130, cl.y + 130), '框选新兵一簇');
  ok(selCount() === 4, '框选选中这 4 支新兵（' + selCount() + '）');
  key('Digit1', { shiftKey: true });
  ok(texts().includes('编队 1：编入 4 支部队'), '编入后给出提示（' + texts().split('|').filter((t) => t.indexOf('编队') === 0).join(' / ') + '）');

  // ---------- ② 点空地取消选中 ----------
  focusTo19(ws19.w * 0.05, ws19.h * 0.95);
  ok(clickW19(ws19.w * 0.05, ws19.h * 0.95), '点一处空地');
  ok(selCount() === -1 && el('warfactory-self').hidden === false, '点空地后没有选中（右栏回到我方概况）');

  // ---------- ③ 单按数字键：选中编队，但镜头不动 ----------
  key('Digit1');
  ok(selCount() === 4, '按 1 选中整个编队（' + selCount() + ' 支）');
  const cA = cam19();
  ok(
    Math.hypot(cA.x - cl.x, cA.y - cl.y) > 400,
    '此时镜头离编队还远（' + Math.round(cA.x) + ',' + Math.round(cA.y) + '）'
  );
  key('Digit2'); // 换一个空编号，顺便把连按窗口清掉
  ok(selCount() === 4, '按空编号不清掉当前选中');
  ok(texts().includes('编队 2 尚未编队'), '从没编过的编号给「尚未编队」提示');

  // ---------- ④ 连按两下：镜头立刻飞到编队第一支部队 ----------
  const camBefore = cam19();
  const kBefore = cam19().k;
  key('Digit1'); // 第一下
  const camMid = cam19();
  ok(dist(camMid, camBefore) < 0.5, '第一下只选中，不挪镜头');
  key('Digit1'); // 第二下（同编号，间隔远小于 ' + DBL_MS + 'ms）
  const camAfter = cam19();
  ok(
    dist(camAfter, rooks[0]) < 2,
    '连按两下 → 镜头落到编队第一支部队（' +
      Math.round(camAfter.x) + ',' + Math.round(camAfter.y) +
      ' → 首支 ' + rooks[0].x + ',' + rooks[0].y + '）'
  );
  ok(
    rooks.slice(1).every((u) => dist(camAfter, u) > 20),
    '落点是「第一支」而不是随便哪支（其余 3 支都在 20 像素之外）'
  );
  ok(Math.abs(cam19().k - kBefore) < 1e-6, '连按两下不改变缩放倍率（仍 ' + cam19().k.toFixed(2) + '×）');
  ok(texts().includes('编队 1：镜头 → 首支部队'), '连按两下有明确视觉反馈');

  // ---------- ⑤ 长按（repeat）不算连按 ----------
  const camHold = cam19();
  focusTo19(ws19.w * 0.05, ws19.h * 0.95); // 先把镜头挪开，才能证明「没动」
  const camHold2 = cam19();
  key('Digit1', { repeat: true });
  key('Digit1', { repeat: true });
  ok(dist(cam19(), camHold2) < 0.5, '长按重复触发不算连按，镜头不跳（' + Math.round(dist(camHold, camHold2)) + 'px 外）');
  ok(selCount() === 4, '长按期间编队照常选中');

  // ---------- ⑥ 两下之间隔太久 → 视作两次独立按键 ----------
  const realNow = Date.now;
  try {
    let fake = realNow();
    Date.now = () => fake;
    focusTo19(ws19.w * 0.05, ws19.h * 0.95);
    const cGap0 = cam19();
    key('Digit1'); // 第一下
    fake += DBL_MS + 200; // 超出连按窗口
    key('Digit1'); // 第二下：不算连按
    ok(dist(cam19(), cGap0) < 0.5, '间隔超过 ' + DBL_MS + 'ms 的两下不算连按，镜头不动');
    ok(selCount() === 4, '超时后仍然正常选中编队');
  } finally {
    Date.now = realNow;
  }
  key('Digit9'); // 打桩期间的时间戳可能偏快，按个空编号把连按记忆清掉

  // ---------- ⑦ 编队里阵亡一支：按数字键只选中活着的 ----------
  g.units.splice(g.units.indexOf(rooks[0]), 1);
  reRender19();
  key('Digit4'); // 先按空编号清窗口
  key('Digit1');
  ok(selCount() === 3, '阵亡一支后按 1 只选中剩下的 3 支（' + selCount() + '）');
  key('Digit1'); // 连按第二下
  ok(
    dist(cam19(), rooks[1]) < 2,
    '「第一支部队」自动顺延到还活着的那支（' +
      Math.round(cam19().x) + ',' + Math.round(cam19().y) + ' → ' + rooks[1].x + ',' + rooks[1].y + '）'
  );

  // ---------- ⑧ 编队全灭：镜头不动，只给提示 ----------
  key('Digit2', { shiftKey: true }); // 当前选中 3 支 → 编入 2 号（此刻 selection 已含这 3 支）
  for (const u of [rooks[1], rooks[2], rooks[3]]) {
    const i = g.units.indexOf(u);
    if (i >= 0) g.units.splice(i, 1);
  }
  reRender19();
  key('Digit5'); // 清窗口
  focusTo19(ws19.w * 0.05, ws19.h * 0.95);
  const cDead = cam19();
  const selBefore = selCount();
  key('Digit2');
  ok(dist(cam19(), cDead) < 0.5, '编队已全灭 → 连按数字键也不挪镜头');
  ok(texts().includes('编队 2 已无部队'), '提示「编队 2 已无部队」');
  ok(selCount() === selBefore, '全灭编队不会把当前选中搅乱');
}

console.log('\n[20] 中键按住拖动 = 平移地图（网页自带的中键行为已去掉）');
{
  const html20 = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');
  ok(/evt\.button === 1/.test(src), '中键（button 1）有独立处理分支');
  ok(/canvas\.addEventListener\('auxclick', preventCtx\)/.test(src), '中键抬起（auxclick）同样被 preventDefault');
  ok(
    /panel\.addEventListener\('mousedown', preventMiddleDefault\)/.test(src) &&
      /function preventMiddleDefault\(evt\)/.test(src),
    '整块游戏面板都屏蔽中键的网页默认行为（自动滚动 / 中键粘贴）'
  );
  ok(/function endPan\(\)/.test(src), '有明确的「结束平移」收口（松手、失焦都走它）');
  ok(
    /window\.addEventListener\('mousemove', onMouseMove\)/.test(src),
    'window 上也挂 mousemove：鼠标拖出画布仍继续平移'
  );
  ok(
    /if \(evt\.button === 1\) \{[\s\S]{0,200}?boxSel\.on = false/.test(src),
    '按下中键即取消进行中的框选（两种拖拽不打架）'
  );
  ok(/const pan = \{ on: false/.test(src), '有独立的平移状态（不与框选共用）');
  ok(html20.includes('中键'), 'panel.html 图例写明中键拖动平移');

  // ---------- 场景：三支新兵（新 id → 坐标无插值误差）----------
  const ws20 = wf.publicGameState(g).world;
  const mini20 = el('warfactory-minimap');
  const focus20 = (wx, wy) => {
    const r = mini20.getBoundingClientRect();
    const evt = {
      button: 0,
      clientX: r.left + (wx / ws20.w) * r.width,
      clientY: r.top + (wy / ws20.h) * r.height,
      preventDefault() {},
    };
    mini20.dispatch('mousedown', evt);
    mini20.dispatch('mouseup', evt);
    pump();
  };
  const cam20 = () => {
    const c = camFromLastFrame();
    return c ? { x: c.x + 1280 / (2 * c.k), y: c.y + 800 / (2 * c.k), k: c.k } : null;
  };
  /** 镜头左上角的世界坐标（clamp 断言要看它，而不是画面中心） */
  const camTL20 = () => {
    const c = cam20();
    return c ? { x: c.x - 1280 / (2 * c.k), y: c.y - 800 / (2 * c.k), k: c.k } : null;
  };
  const reRender20 = () => {
    Ui.render(wf.publicGameState(g), net, view);
    Ui.applySnapshot(wf.snapshot(g));
    pump();
  };
  const clickW20 = (wx, wy) => {
    const c = camFromLastFrame();
    if (!c) return false;
    const evt = {
      button: 0,
      clientX: (wx - c.x) * c.k,
      clientY: (wy - c.y) * c.k,
      preventDefault() {},
      shiftKey: false,
    };
    canvasEl.dispatch('mousedown', evt);
    canvasEl.dispatch('mouseup', evt);
    pump();
    return true;
  };
  const midEvt = (x, y, spy) => ({
    button: 1,
    clientX: x,
    clientY: y,
    preventDefault() {
      if (spy) spy.n += 1;
    },
  });
  const zero = () => ({ n: 0 });
  /** 本节的选中计数（[19] 的同名帮手在它自己的块里，这里各用各的） */
  const selCount = () => {
    const m = /已选 (\d+) 支/.exec(el('wov-count').textContent);
    return m ? Number(m[1]) : -1;
  };
  const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);

  const proto20 = g.units.find((u) => u.ownerIdx === 0 && !u.dead);
  ok(Boolean(proto20), '找得到我方部队做模板');
  const c20 = { x: Math.round(ws20.w * 0.5), y: Math.round(ws20.h * 0.5) };
  for (let i = 0; i < 3; i++) {
    g.units.push(
      Object.assign({}, proto20, { id: 9200 + i, x: c20.x + i * 40, y: c20.y, moveX: null, moveY: null })
    );
  }
  g.nextUnitId = Math.max(g.nextUnitId || 1, 9300);
  reRender20();
  focus20(c20.x, c20.y);
  ok(Math.abs(cam20().k - 1) < 0.02, '用例从 1 倍镜头开始（' + cam20().k.toFixed(3) + '×）');

  // ---------- ① 中键「点击」（只按下不拖动）----------
  ok(clickW20(c20.x - 420, c20.y - 240), '先点一处空地，清掉选中与面板');
  ok(selCount() === -1 && el('warfactory-self').hidden === false, '清空后右栏回到「我方概况」');
  const cBefore1 = cam20();
  const spy1 = zero();
  canvasEl.dispatch('mousedown', midEvt(640, 400, spy1));
  pump();
  ok(spy1.n === 1, '中键按下被 preventDefault —— 浏览器自带的自动滚动从源头掐掉');
  ok(dist(cBefore1, cam20()) < 0.5, '中键只按下不拖动：镜头纹丝不动');
  winStub.dispatch('mouseup', midEvt(640, 400, spy1));
  pump();
  ok(selCount() === -1 && el('warfactory-self').hidden === false, '中键点击不选中任何东西、面板也不变');

  // ---------- ② 按住中键拖动：地图 1:1 跟着手走 ----------
  const k20 = cam20().k;
  const cStart2 = cam20();
  const dxS = 220;
  const dyS = -140; // 屏幕像素；起点 (640,400) 正压在中间那支部队身上
  const spy2 = zero();
  canvasEl.dispatch('mousedown', midEvt(640, 400, spy2));
  winStub.dispatch('mousemove', midEvt(640 + dxS / 2, 400 + dyS / 2, spy2));
  winStub.dispatch('mousemove', midEvt(640 + dxS, 400 + dyS, spy2));
  winStub.dispatch('mousemove', midEvt(640 + dxS, 400 + dyS, spy2)); // 原地重复一次，不应再挪
  winStub.dispatch('mouseup', midEvt(640 + dxS, 400 + dyS, spy2));
  pump();
  const cEnd2 = cam20();
  const movedX = (cStart2.x - cEnd2.x) * k20;
  const movedY = (cStart2.y - cEnd2.y) * k20;
  ok(
    Math.abs(movedX - dxS) < 1.5 && Math.abs(movedY - dyS) < 1.5,
    '拖 ' + dxS + ',' + dyS + ' 屏幕像素 → 地图恰好跟着走 ' +
      Math.round(movedX) + ',' + Math.round(movedY) + ' 屏幕像素（1:1 跟手）'
  );
  ok(Math.abs(cEnd2.k - k20) < 1e-6, '平移不改变缩放倍率（仍 ' + cEnd2.k.toFixed(2) + '×）');
  ok(selCount() === -1, '中键从部队身上开始拖，也不会把它选上（中键只归地图）');

  // ---------- ③ 拖到世界边角：镜头被 clamp 在世界内 ----------
  // 视线在世界内平移的上限 = 世界尺寸 − 视野尺寸，所以要拖得足够远才能撞到边界
  const dragFar = (fromX, fromY, sx, sy) => {
    const spy = zero();
    canvasEl.dispatch('mousedown', midEvt(fromX, fromY, spy));
    for (let i = 1; i <= 20; i++) winStub.dispatch('mousemove', midEvt(fromX + sx * i, fromY + sy * i, spy));
    winStub.dispatch('mouseup', midEvt(fromX + sx * 20, fromY + sy * 20, spy));
    pump();
  };
  dragFar(100, 100, 300, 300); // 一直往右下拖 → 镜头被顶到世界左上角
  const tl3 = camTL20();
  const liftTop = -tl3.y * tl3.k; // 世界顶边被推到视口第几像素（= 顶部浮层高度）
  ok(
    Math.abs(tl3.x) < 1 && liftTop >= 0 && liftTop < 40,
    '一直往右下拖 → 镜头贴住世界左上边界（顶边让开 ' + Math.round(liftTop) + 'px 顶部浮层）'
  );
  dragFar(600, 400, -300, -300); // 再一直往左上拖 → 顶到世界右下角
  const tl3b = camTL20();
  const vw3 = 1280 / tl3b.k;
  const vh3 = 800 / tl3b.k;
  const liftBot = (tl3b.y + vh3 - ws20.h) * tl3b.k; // 世界底边抬到视口底边之上多少像素
  ok(
    Math.abs(tl3b.x + vw3 - ws20.w) < 2 && liftBot >= 0 && liftBot < 40,
    '一直往左上拖 → 镜头贴住世界右下边界（底边抬起 ' + Math.round(liftBot) +
      'px —— 正好让出底部指挥栏，地图最下边看得见）'
  );

  // ---------- ④ 松开中键后，移动鼠标不再拖地图 ----------
  const cStill = cam20();
  winStub.dispatch('mousemove', midEvt(1900, 1100, zero()));
  pump();
  ok(dist(cStill, cam20()) < 0.5, '松开中键后移动鼠标，地图不再跟着走');

  // ---------- ⑤ 拖地图途中把左键框选作废 ----------
  focus20(c20.x, c20.y);
  const selBefore5 = selCount();
  const c5 = camFromLastFrame();
  const mk5 = (wx, wy) => ({
    button: 0,
    clientX: (wx - c5.x) * c5.k,
    clientY: (wy - c5.y) * c5.k,
    preventDefault() {},
    shiftKey: false,
  });
  canvasEl.dispatch('mousedown', mk5(c20.x - 60, c20.y - 60)); // 左键按下：开始框选
  canvasEl.dispatch('mousemove', mk5(c20.x + 140, c20.y + 60)); // 框已经拖出来了
  const spy5 = zero();
  canvasEl.dispatch('mousedown', midEvt(700, 300, spy5)); // 半途插进中键拖动
  winStub.dispatch('mousemove', midEvt(770, 350, spy5));
  canvasEl.dispatch('mouseup', mk5(c20.x + 140, c20.y + 60)); // 松左键
  winStub.dispatch('mouseup', midEvt(770, 350, spy5)); // 松中键
  pump();
  ok(
    selCount() === selBefore5,
    '拖地图途中松开的左键框选不再结算（框不会误选中部队，' + selCount() + '）'
  );

  // ---------- ⑥ 按住中键时窗口失焦 → 平移立即收口 ----------
  const c6 = cam20();
  canvasEl.dispatch('mousedown', midEvt(400, 300, zero()));
  winStub.dispatch('blur', {});
  pump();
  winStub.dispatch('mousemove', midEvt(1000, 700, zero()));
  pump();
  ok(dist(c6, cam20()) < 0.5, '按住中键时窗口失焦 → 平移立刻收口，回来不会「粘手」');
}

console.log('\n[21] 归属底色盘（60% 透明）· 单位常显血条 · 选中光环与四角方框');
{
  const COL = wf.__test.consts.COLORS;
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(String(hex).substr(i, 2), 16));
  /** 客户端 hexAlpha() 的等价输出，用来精确比对 fillStyle */
  const rgba = (hex, a) => 'rgba(' + rgbOf(hex).join(',') + ',' + a + ')';
  const PAD = 0.6;

  // ---- 色板：红 / 蓝 / 黄 / 绿，四方互不相同 ----
  const [r0, g0, b0] = rgbOf(COL[0]);
  const [r1, g1, b1] = rgbOf(COL[1]);
  const [r2, g2, b2] = rgbOf(COL[2]);
  const [r3, g3, b3] = rgbOf(COL[3]);
  ok(COL.length === 4 && new Set(COL).size === 4, '四方归属色互不相同（' + COL.join(' ') + '）');
  ok(r0 > g0 && g0 > b0, '一号位是红（' + COL[0] + '）');
  ok(b1 > r1 && b1 > g1, '二号位是蓝（' + COL[1] + '）');
  ok(r2 > b2 + 80 && g2 > b2 + 80, '三号位是黄（红绿都远高于蓝，' + COL[2] + '）');
  ok(g3 > r3 && g3 > b3, '四号位是绿（' + COL[3] + '）');

  // ---- 造一局：双方各占一座工厂，中央空地上双方各放一支部队 ----
  const g21 = wf.createGameState({
    id: 'client-pad',
    players: [
      { id: 'p0', name: '甲' },
      { id: 'p1', name: '乙' },
    ],
  });
  g21.phase = 'playing';
  g21.phaseEndsAt = 0;
  for (const fi of [0, 1]) {
    g21.factories[fi].owner = fi;
    g21.factories[fi].hp = g21.factories[fi].hpMax;
  }
  const meta21 = wf.publicGameState(g21);
  const wx0 = Math.round(meta21.world.w / 2);
  const wy0 = Math.round(meta21.world.h / 2);
  const mineU = wf.__test.spawnUnit(g21, { id: 0, owner: 0, level: 1 }, 'warrior', wx0 - 130, wy0 - 70);
  const foeU = wf.__test.spawnUnit(g21, { id: 1, owner: 1, level: 1 }, 'shield', wx0 + 130, wy0 + 70);
  ok(Boolean(mineU && foeU), '双方各放一支部队到世界中央空地');

  Ui.render(wf.publicGameState(g21), net, view);
  Ui.applySnapshot(wf.snapshot(g21));
  pump(); // 暖机帧
  Ui.applySnapshot(wf.snapshot(g21));
  pump(); // 测量帧

  const cam21 = camFromLastFrame();
  // 点小地图正中 → 镜头落到世界中心，两支部队都在视野内
  const mini21 = el('warfactory-minimap');
  const nav21 = (fx, fy) => {
    const r = mini21.getBoundingClientRect();
    const e = {
      button: 0,
      clientX: r.left + fx * r.width,
      clientY: r.top + fy * r.height,
      preventDefault() {},
    };
    mini21.dispatch('mousedown', e);
    mini21.dispatch('mouseup', e);
    pump();
  };
  nav21(0.5, 0.5);
  Ui.applySnapshot(wf.snapshot(g21));
  pump(); // 测量帧

  const cam = camFromLastFrame();
  ok(Boolean(cam), '镜头就绪（' + (cam ? cam.k.toFixed(2) + '×' : '?') + '）');
  /** 世界坐标 → 本帧画布坐标（log.points 记的就是画布坐标） */
  const hasPt = (wx, wy, tol) => {
    const px = (wx - cam.x) * cam.k;
    const py = (wy - cam.y) * cam.k;
    return log.points.some(([x, y]) => Math.abs(x - px) <= (tol || 0.6) && Math.abs(y - py) <= (tol || 0.6));
  };
  const fillCount = (s) => log.fills.filter((f) => f === s).length;

  // ---- ① 归属底色盘：单位脚下 / 工厂厂区 / 总部台基各压一层 60% 阵营色 ----
  const pad0 = rgba(meta21.players[0].color, PAD);
  const pad1 = rgba(meta21.players[1].color, PAD);
  const uRows = wf.snapshot(g21).u || [];
  const ownedUnits = (oi) => uRows.filter((r) => r[1] === oi).length;
  const ownedFacs = (oi) => (meta21.factories || []).filter((f) => f.owner === oi).length;
  const ownedHqs = (oi) => (meta21.hqs || []).filter((h) => h.owner === oi && !h.down).length;
  const padTotal = (oi) => ownedUnits(oi) + ownedFacs(oi) + ownedHqs(oi);
  const allUnits = uRows.length;
  ok(
    fillCount(pad0) === padTotal(0) && padTotal(0) >= 3,
    '己方每支单位 + 每座厂 + 总部都压了一层 60% 归属底色（' + fillCount(pad0) + ' / 应有 ' + padTotal(0) + '）'
  );
  ok(
    fillCount(pad1) === padTotal(1) && padTotal(1) >= 3,
    '对手同理，用的是他自己的阵营色（' + fillCount(pad1) + ' / 应有 ' + padTotal(1) + '）'
  );
  ok(
    fillCount(pad0) + fillCount(pad1) === padTotal(0) + padTotal(1),
    '全图 60% 底色盘总数 = 双方已归属目标数（多一处就是给中立建筑误着色了）'
  );
  const neutralFac = (meta21.factories || []).find((f) => f.owner < 0);
  ok(
    Boolean(neutralFac) && !hasPt(neutralFac.x - 72, neutralFac.y - 13),
    '中立工厂不压归属底色（' + (neutralFac ? neutralFac.id + ' 号厂' : '?') + '）'
  );

  // 几何：单位脚下的椭圆盘半径随体型缩放
  const fW = UNIT_VIS_SCALE * bodyScaleOf('warrior');
  ok(
    hasPt(mineU.x - 18 * fW, mineU.y + 11 * fW - 6.8 * fW) && hasPt(mineU.x + 18 * fW, mineU.y + 11 * fW + 6.8 * fW),
    '己方锐士脚下的归属色椭圆盘画在脚边（18×6.8 × 体型 ' + fW.toFixed(2) + '）'
  );
  const fS = UNIT_VIS_SCALE * bodyScaleOf('shield');
  ok(
    hasPt(foeU.x - 18 * fS, foeU.y + 11 * fS - 6.8 * fS) && hasPt(foeU.x + 18 * fS, foeU.y + 11 * fS + 6.8 * fS),
    '敌方盾卫同样压本方的归属色底盘'
  );
  const ownFac = (meta21.factories || []).find((f) => f.owner === 1);
  ok(
    Boolean(ownFac) && hasPt(ownFac.x - 72, ownFac.y - 13) && hasPt(ownFac.x + 72, ownFac.y + 53),
    '工厂厂区整块压归属底色（椭圆 72×33）'
  );
  const ownHq = (meta21.hqs || []).find((h) => h.owner === 1);
  ok(
    Boolean(ownHq) && hasPt(ownHq.x - 64, ownHq.y - 4) && hasPt(ownHq.x + 64, ownHq.y + 40),
    '总部台基也压归属底色（椭圆 64×22）'
  );

  // ---- ② 血条：所有单位默认常显（满血、未选中也要画） ----
  const hpRects = log.rects.filter((r) => Math.abs(r[3] - 3.4) < 1e-9);
  ok(
    hpRects.length === allUnits * 2,
    '全图每支单位都画了血条（' + allUnits + ' 支 → ' + hpRects.length + ' 次底槽/填充，满血也画）'
  );
  ok(
    hpRects.some(
      (r) =>
        Math.abs(r[0] - (mineU.x - (26 * fW) / 2)) < 0.01 &&
        Math.abs(r[1] - (mineU.y - 28 * fW)) < 0.01 &&
        Math.abs(r[2] - 26 * fW) < 0.01
    ),
    '满血且未选中的己方锐士，血条照样顶在头上（' + (26 * fW).toFixed(1) + ' 宽）'
  );
  ok(
    hpRects.some(
      (r) =>
        Math.abs(r[0] - (foeU.x - (26 * fS) / 2)) < 0.01 &&
        Math.abs(r[1] - (foeU.y - 28 * fS)) < 0.01
    ),
    '敌方单位的血条也在（' + (26 * fS).toFixed(1) + ' 宽底槽）'
  );
  ok(
    log.fills.includes(meta21.players[1].color),
    '血条填充用的是实色归属色（' + meta21.players[1].color + '），与底盘区分'
  );

  // ---- ③ 选中效果：脚下光环 + 四角方框（画在本体之前，压在本体「下方」） ----
  // 光环内芯填的是同色 22% 透明，这个不透明度全项目只有它用，作为「有没有选中光环」的判据
  const haloFill = rgba(meta21.players[0].color, 0.22);
  /** 脚下光环是一圈 24×9.2（× 体型）的椭圆：在落笔点里找这圈环（允许呼吸脉冲 ±8%） */
  const haloRing = (ux, uy, f) => {
    const pcx = (ux - cam.x) * cam.k;
    const pcy = (uy + 11 * f - cam.y) * cam.k;
    const rx = 24 * f * cam.k;
    const ry = 9.2 * f * cam.k;
    // 一整圈环 = 左右两侧都得有落笔。只要求「某一点刚好落在半径上」太松：
    // 弹道、弹痕、地形都会往 log.points 里塞点，偶尔会蒙对成一个假阳性。
    const side = (sign) =>
      log.points.some(([x, y]) => {
        if ((x - pcx) * sign <= 0) return false;
        const dx = Math.abs(x - pcx) / rx;
        const dy = Math.abs(y - pcy) / ry;
        return Math.abs(dx - 1) < 0.1 && Math.abs(dy - 1) < 0.12;
      });
    return side(1) && side(-1);
  };
  ok(!log.fills.includes(haloFill) && !haloRing(mineU.x, mineU.y, fW), '未选中时脚下没有光环');
  ok(!hasPt(mineU.x - 21 * fW, mineU.y - 21 * fW), '未选中时没有四角方框');

  const clickAt = (wx, wy) => {
    const e = {
      button: 0,
      clientX: (wx - cam.x) * cam.k,
      clientY: (wy - cam.y) * cam.k,
      preventDefault() {},
      shiftKey: false,
    };
    canvasEl.dispatch('mousedown', e);
    canvasEl.dispatch('mouseup', e);
    pump();
  };
  clickAt(mineU.x, mineU.y);
  ok(el('warfactory-unitpanel').hidden === false, '点选部队成功（右栏弹出单位详情）');
  ok(
    log.fills.includes(haloFill) && haloRing(mineU.x, mineU.y, fW),
    '选中后脚下多出一圈亮色光环（24 × 9.2 × 体型 ' + fW.toFixed(2) + ' 椭圆环 + 22% 同色内芯）'
  );
  ok(
    hasPt(mineU.x - 21 * fW, mineU.y - 21 * fW, 0.8) && hasPt(mineU.x + 21 * fW, mineU.y + 21 * fW, 0.8),
    '选中后四周多出四角方框（对角 ±21 × 体型 ' + fW.toFixed(2) + '）'
  );
  ok(fillCount(pad0) === padTotal(0), '选中不改变归属底色盘（仍是 ' + fillCount(pad0) + ' 处）');
  const hpRects2 = log.rects.filter((r) => Math.abs(r[3] - 3.4) < 1e-9).length;
  ok(hpRects2 === allUnits * 2, '选中再画一帧，血条数目不变（' + hpRects2 + '，不会重复叠加）');

  // ---- ④ 未被选中的其它单位不会误带光环 / 方框 ----
  ok(
    !haloRing(foeU.x, foeU.y, fS) &&
      ![0, 1, 2, 3].every((i) =>
        hasPt(foeU.x + (i % 2 ? 21 : -21) * fS, foeU.y + (i > 1 ? 21 : -21) * fS, 0.8)
      ),
    '只给选中的那一支画光环与方框，没选中的敌方盾卫身上干净'
  );
  ok(!hasPt(foeU.x + 21 * fS, foeU.y + 21 * fS, 0.8), '没选中的敌方盾卫身上没有方框');
}

console.log('\n[22] 弹道不规则炸开（水球感）· 开火动画与后坐 · 地面弹痕');
{
  /** 找一块远离所有建筑的空地（要求连续 3 格都不是山/水），保证交火不被地形挡住 */
  const clearSpot = (g) => {
    const tr = g.terrain;
    const blocks = [...g.factories, ...g.labs, ...g.hqs].map((b) => [b.x, b.y]);
    const free = (r, c) =>
      r >= 0 && c >= 0 && r < tr.rows && c < tr.cols && tr.grid[r][c] !== 2 && tr.grid[r][c] !== 4;
    for (let r = 8; r < tr.rows - 8; r++) {
      for (let c = 8; c < tr.cols - 8; c++) {
        if (!free(r, c) || !free(r, c + 1) || !free(r, c + 2)) continue;
        const x = (c + 0.5) * tr.cell;
        const y = (r + 0.5) * tr.cell;
        if (blocks.some((b) => Math.hypot(b[0] - x, b[1] - y) < 700)) continue;
        return { x, y };
      }
    }
    return { x: g.world.w / 2, y: g.world.h / 2 };
  };

  /* ---------- A. 服务端协议：开火 / 命中 / 弹体朝向与种子 ---------- */
  const g22 = wf.createGameState({
    id: 'client-fx',
    players: [
      { id: 'p0', name: '甲' },
      { id: 'p1', name: '乙' },
    ],
  });
  g22.phase = 'playing';
  g22.phaseEndsAt = 0;
  g22.units.length = 0;
  const sp = clearSpot(g22);
  // 游侠射程 200 打得着；盾卫射程 50 打不着 100px 外的游侠 → 只有游侠开火，事件干净
  const shooter = wf.__test.spawnUnit(g22, { id: 0, owner: 0, level: 1 }, 'ranger', sp.x - 40, sp.y);
  const victim = wf.__test.spawnUnit(g22, { id: 1, owner: 1, level: 1 }, 'shield', sp.x + 60, sp.y);
  let snapFire = null;
  let snapHit = null;
  let clk = 1000;
  for (let i = 0; i < 90 && !(snapFire && snapHit); i++) {
    for (let k = 0; k < 1; k++) {
      clk += 50;
      wf.__test.step(g22, 0.05, clk);
    }
    const s = wf.snapshot(g22);
    if (!snapFire && (s.ev || []).some((e) => e.t === 'shot')) snapFire = s;
    if (!snapHit && (s.ev || []).some((e) => e.t === 'boom')) snapHit = s;
  }

  const shots = ((snapFire && snapFire.ev) || []).filter((e) => e.t === 'shot');
  const sh = shots.filter((e) => e.uid === shooter.id)[0] || shots[0];
  ok(Boolean(sh), '交火后服务端下发开火事件（shot，' + shots.length + ' 条）');
  ok(
    Boolean(sh) && Number.isFinite(sh.a) && Number.isFinite(sh.x) && Number.isFinite(sh.y) && sh.k === 0 && sh.uid === shooter.id,
    'shot 带齐「枪口坐标 + 朝向 + 弹种 + 射手」' + (sh ? '（x=' + sh.x + ' y=' + sh.y + ' a=' + sh.a + ' k=' + sh.k + '）' : '')
  );
  ok(Boolean(sh) && Number.isFinite(sh.r) && sh.r > 0, 'shot 带射手体型（枪口焰大小随体型）');
  ok(
    Boolean(sh) && (sh.x - shooter.x) * Math.cos(sh.a) + (sh.y - shooter.y) * Math.sin(sh.a) > 3,
    '枪口在射手身前而非身上（沿朝向偏出 ' +
      (sh ? ((sh.x - shooter.x) * Math.cos(sh.a) + (sh.y - shooter.y) * Math.sin(sh.a)).toFixed(1) : '?') +
      'px）'
  );

  const hitRow = ((snapHit && snapHit.ev) || []).filter((e) => e.t === 'boom');
  ok(hitRow.length > 0, '子弹命中后服务端下发爆炸事件（boom，' + hitRow.length + ' 条）——所有非激光子弹都带爆炸半径');
  ok(
    hitRow.length > 0 &&
      hitRow.every(
        (e) =>
          Number.isFinite(e.x) &&
          Number.isFinite(e.y) &&
          Number.isFinite(e.r) &&
          e.r > 0 &&
          e.r < 41 && // 直射弹的小爆炸半径，明显小于轰击炮击的 41
          e.oi === shooter.ownerIdx
      ),
    'boom 带齐「落点 + 小爆炸半径(' + (hitRow[0] ? hitRow[0].r : '?') + ') + 归属」'
  );
  ok(
    hitRow.length > 0 && hitRow.every((e) => Math.hypot(e.x - sp.x, e.y - sp.y) < 140),
    '爆炸点落在两军之间的交火线上（而不是原地爆）'
  );

  const rows = (snapFire && snapFire.b) || [];
  ok(rows.length > 0 && rows.every((r) => r.length === 9), '弹道快照带朝向与个体种子（' + rows.length + ' 发 × 9 字段：x,y,归属,弹种,dx,dy,种子,高度,抛射）');
  ok(rows.length > 0 && rows.every((r) => Math.abs(Math.hypot(r[4], r[5]) - 1) < 0.03), '弹道朝向是单位向量');
  ok(rows.length > 0 && rows.every((r) => r[6] >= 0 && r[6] < 1), '每发子弹带 0..1 的稳定个体种子（形状不重样）');
  ok(rows.length > 0 && rows.every((r) => Number.isFinite(r[7]) && (r[8] === 0 || r[8] === 1)), '抛射弹带「高度 z」与「抛射标志 arc」（arc 为 0/1）');

  /* ---------- B. 客户端：后坐 / 枪口焰 / 不规则炸开 / 弹痕 ---------- */
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(String(hex).substr(i, 2), 16));
  const c0 = rgbOf(wf.__test.consts.COLORS[0]).join(','); // 一号位（自己）的实色
  /** 弹痕那层「归属色 17% 淡墨」：只有地面弹痕用这个不透明度（炸开内芯固定 30%，不会混进来） */
  const tintMarks = () => log.fills.filter((f) => f.indexOf('rgba(' + c0 + ',0.1') === 0);
  const MARK_MAX = Number((/const GROUND_MARK_MAX = (\d+);/.exec(src) || [0, 0])[1]) || 0;
  const MARK_TTL = Number((/const GROUND_MARK_TTL = (\d+);/.exec(src) || [0, 0])[1]) || 0;
  const MARK_INK = Number((/const MARK_INK_ALPHA = ([\d.]+);/.exec(src) || [0, 0])[1]) || 0;

  const g23 = wf.createGameState({
    // 玩家 id 故意不用 p0/p1：客户端的「同局指纹」= 世界尺寸 + 玩家 id + 工厂数，
    // 与前面的用例撞了就不会重置（units/effects 沿用上一局的残留对象），
    // 单位本体还带着上一局的随机朝角在插值旋转 —— 会污染这里的位移测量。
    id: 'client-fx-render',
    players: [
      { id: 'fx0', name: '甲' },
      { id: 'fx1', name: '乙' },
    ],
  });
  g23.phase = 'playing';
  g23.phaseEndsAt = 0;
  g23.units.length = 0;
  const sp23 = clearSpot(g23);
  // 用锐士（UNIT_BODY_SCALE=1.4）：它「本体那一趟」的等效缩放与世界层（底盘/血条）不同，
  // 测后坐时能靠 mag 把本体点从底盘点里筛干净 —— bodyScale=1 的兵种两者 mag 相同，会互相污染。
  const u23 = wf.__test.spawnUnit(g23, { id: 0, owner: 0, level: 1 }, 'warrior', sp23.x, sp23.y);
  u23.angle = 0; // 朝 +x 站着，后坐方向可预期（往 -x 退）
  Ui.render(wf.publicGameState(g23), net, view);
  // 镜头挪到这块空地（点小地图正中会跑到世界中心，不一定在这里）
  const mini23 = el('warfactory-minimap');
  {
    const r = mini23.getBoundingClientRect();
    const e = {
      button: 0,
      clientX: r.left + (sp23.x / g23.world.w) * r.width,
      clientY: r.top + (sp23.y / g23.world.h) * r.height,
      preventDefault() {},
    };
    mini23.dispatch('mousedown', e);
    mini23.dispatch('mouseup', e);
  }
  Ui.applySnapshot(wf.snapshot(g23));
  pump();

  const cam23 = camFromLastFrame();
  const f23 = UNIT_VIS_SCALE * bodyScaleOf('warrior');
  // 只认主战场画布上的落笔点：地形/背景是在自己的离屏画布上预渲染的，
  // 它们同样往 log.points 里塞点（每帧上千个），按方位筛点时必须先把它们挡掉。
  const worldPts = () => log.points.filter(([, , , owner]) => owner === 'warfactory-canvas');
  /** 射手本体那一趟的落笔点（用等效缩放把它从归属底盘/血条里筛出来） */
  const bodyPts = () => {
    const mag = cam23.k * f23;
    return worldPts().filter(
      ([x, y, m]) =>
        Math.abs(m - mag) <= mag * 1e-6 &&
        Math.abs(x - (u23.x - cam23.x) * cam23.k) < 70 &&
        Math.abs(y - (u23.y - cam23.y) * cam23.k) < 70
    );
  };
  const centroid = (pts) => {
    const s = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
    return [s[0] / pts.length, s[1] / pts.length];
  };
  const scrOf = (wx, wy) => [(wx - cam23.x) * cam23.k, (wy - cam23.y) * cam23.k];
  /** 命中点附近 [inner, outer] 环带内的落笔点（量飞溅/炸开用；先挡掉离屏画布的点） */
  const ringPts = (wx, wy, inner, outer) => {
    const s = scrOf(wx, wy);
    return worldPts().filter(([x, y]) => {
      const d = Math.hypot(x - s[0], y - s[1]);
      return d > inner * cam23.k && d < outer * cam23.k;
    });
  };

  const base = wf.snapshot(g23);
  base.ev = [];
  Ui.applySnapshot(base);
  pump();
  const pts0 = bodyPts();
  ok(pts0.length > 4, '量得到射手本体那一趟的落笔点（' + pts0.length + ' 点）');
  const cen0 = centroid(pts0);
  Ui.applySnapshot(base);
  pump();
  const cen1 = centroid(bodyPts());
  ok(
    Math.hypot(cen1[0] - cen0[0], cen1[1] - cen0[1]) < 0.05,
    '没开火时本体原地不动（基线漂移 ' + Math.hypot(cen1[0] - cen0[0], cen1[1] - cen0[1]).toFixed(4) + 'px）'
  );

  // ---- ① 后坐：开火瞬间本体向后一顿（底盘/血条不动） ----
  const muzzleX = u23.x + u23.r + 5;
  const muzzleY = u23.y;
  Ui.applySnapshot(
    Object.assign({}, base, {
      ev: [{ t: 'shot', x: muzzleX, y: muzzleY, a: 0, k: 1, oi: 0, uid: u23.id, r: u23.r }],
    })
  );
  pump();
  const cenFire = centroid(bodyPts());
  const expectRc = 4.6 * f23 * cam23.k;
  const moved = Math.hypot(cenFire[0] - cen1[0], cenFire[1] - cen1[1]);
  ok(
    Math.abs(moved - expectRc) < expectRc * 0.25,
    '开火瞬间射手整体向后一顿（位移 ' + moved.toFixed(2) + 'px / 期望约 ' + expectRc.toFixed(2) + 'px）'
  );
  ok(cenFire[0] < cen1[0] - expectRc * 0.5, '后坐方向与枪口朝向相反（朝右开枪 → 整个人往左退）');

  // ---- ② 枪口焰：沿朝向喷火星 + 回卷硝烟，先烧起来再收干净 ----
  // 用炮击弹（k=2）在远处放一记：这类焰最长，几何量得准，且 uid 不存在 → 不会牵动任何单位
  const mzX = sp23.x + 240;
  const mzY = sp23.y + 180;
  Ui.applySnapshot(Object.assign({}, base, { b: [], ev: [{ t: 'shot', x: mzX, y: mzY, a: 0, k: 2, oi: 0, uid: 99999, r: 10 }] }));
  pump();
  // 焰是「先炸开再收」，0ms 还很小；先空转 60ms 让它烧到最亮再量
  const t0 = Date.now();
  while (Date.now() - t0 < 60) {
    /* 空转 60ms */
  }
  pump();
  const mz = scrOf(mzX, mzY);
  const near = log.points.filter(([x, y]) => Math.hypot(x - mz[0], y - mz[1]) < 80);
  const fwdD = near.map(([x]) => x - mz[0]);
  ok(fwdD.length > 0 && Math.max(...fwdD) > 8, '枪口沿朝向喷出火星（最远焰尖 ' + (fwdD.length ? Math.max(...fwdD).toFixed(1) : '?') + 'px）');
  ok(fwdD.some((d) => d < -3), '枪口后方还有回卷的硝烟墨团（' + fwdD.filter((d) => d < -3).length + ' 个落笔点）');
  // 焰芯用朱金一层；这个颜色只有枪口焰用，拿它读「焰的亮度曲线」
  const hotA = () => {
    const m = log.fills.map((f) => /^rgba\(216,162,74,([\d.]+)\)$/.exec(f)).filter(Boolean);
    return m.length ? Math.max(...m.map((x) => Number(x[1]))) : 0;
  };
  ok(hotA() > 0.5, '焰已烧起来（当前亮度 ' + hotA().toFixed(2) + '）');
  const t1 = Date.now();
  while (Date.now() - t1 < 260) {
    /* 再等 260ms：开火动画应当已经收干净 */
  }
  pump();
  ok(hotA() === 0, '开火动画是短促的一下（260ms 后完全收掉，不留常亮光斑）');

  // 0ms 那一帧应当比 60ms 暗（「先炸开」的曲线，不是一亮就一直亮）
  Ui.applySnapshot(Object.assign({}, base, { b: [], ev: [{ t: 'shot', x: mzX, y: mzY, a: 0, k: 2, oi: 0, uid: 99999, r: 10 }] }));
  pump();
  const hotFresh = hotA();
  ok(hotFresh < 0.2, '刚开火那一瞬焰还没张开（' + hotFresh.toFixed(2) + ' → 60ms 后 ' + '0.6+' + '）');

  // ---- ③ 弹丸不是圆点：墨团边界半径各不相同，且沿弹道拉长 ----
  const bX = sp23.x + 150;
  const bY = sp23.y - 60;
  Ui.applySnapshot(Object.assign({}, base, { b: [[bX, bY, 0, 0, 1, 0, 0.37]], ev: [] }));
  pump();
  const bs = scrOf(bX, bY);
  const bPts = ringPts(bX, bY, 0, 8);
  const bR = bPts.map(([x, y]) => Math.hypot(x - bs[0], y - bs[1])).filter((r) => r > 0.4);
  const kinds = new Set(bR.map((r) => Math.round(r * 20) / 20));
  ok(
    kinds.size >= 5,
    '弹丸墨团的边界半径各不相同（' + kinds.size + ' 种；正圆的圆弧只会给出 2 种）'
  );
  const far = bPts.reduce(
    (a, p) => (Math.hypot(p[0] - bs[0], p[1] - bs[1]) > Math.hypot(a[0] - bs[0], a[1] - bs[1]) ? p : a),
    bPts[0]
  );
  const farAng = Math.abs(Math.atan2(far[1] - bs[1], far[0] - bs[0]));
  const dAng = Math.min(farAng, Math.abs(farAng - Math.PI));
  ok(
    bPts.length > 0 && dAng < 0.9,
    '墨滴最远处落在弹道方向上（夹角 ' + ((dAng * 180) / Math.PI).toFixed(0) + '° → 朝向取自快照）'
  );

  // ---- ③ 炮击落点：不规则墨花（原本是正圆） ----
  const boomX = sp23.x - 120;
  const boomY = sp23.y + 90;
  Ui.applySnapshot(Object.assign({}, base, { b: [], ev: [{ t: 'boom', x: boomX, y: boomY, r: 41, oi: 0 }] }));
  pump();
  const bm = scrOf(boomX, boomY);
  const bmR = new Set(
    log.points
      .filter(([x, y]) => Math.hypot(x - bm[0], y - bm[1]) < 85 * cam23.k)
      .map(([x, y]) => Math.round(Math.hypot(x - bm[0], y - bm[1]) * 10) / 10)
  );
  ok(bmR.size >= 6, '炮击落点炸开的是不规则墨花（' + bmR.size + ' 种边界半径；正圆只有 2 种）');

  // ---- ④ 命中：飞溅甩出去 + 地上留弹痕（画在单位/建筑下面） ----
  const hitX = sp23.x + 120;
  const hitY = sp23.y + 40;
  // 先量一块「还没在这里炸过」的基线：HUD 与地面绘制也会往这一带落笔，
  // 不比基线就等于没量 —— 差分才是「炸开真的多画了东西」的证据
  Ui.applySnapshot(base);
  pump();
  const ringBase = ringPts(hitX, hitY, 12, 70).length;
  Ui.applySnapshot(Object.assign({}, base, { b: [], ev: [{ t: 'hit', x: hitX, y: hitY, a: 0.6, k: 0, oi: 0, id: 7 }] }));
  pump();
  const t2 = Date.now();
  while (Date.now() - t2 < 150) {
    /* 等 150ms 让飞溅甩开 */
  }
  pump();
  const hs = scrOf(hitX, hitY);
  const flyOut = ringPts(hitX, hitY, 12, 70).length;
  ok(flyOut >= ringBase + 8, '命中炸开时墨点向外飞溅（基线 ' + ringBase + ' → 炸开后 ' + flyOut + ' 个落笔点）');
  const mk1 = tintMarks();
  ok(mk1.length >= 1, '命中处在地上留下一块弹痕（' + mk1.length + ' 处，墨色 ' + MARK_INK * 100 + '% 起淡出）');
  const wpts = worldPts();
  const firstMarkPt = wpts.findIndex(([x, y]) => Math.hypot(x - hs[0], y - hs[1]) < 10 * cam23.k);
  const firstUnitPt = wpts.findIndex(([, , m]) => Math.abs(m - cam23.k * f23) <= cam23.k * f23 * 1e-6);
  ok(
    firstMarkPt >= 0 && firstUnitPt > firstMarkPt,
    '弹痕画在单位下面（弹痕落笔点 #' + firstMarkPt + ' 早于单位本体 #' + firstUnitPt + '）'
  );

  // ---- ⑤ 弹痕会留在地上、并且真的在淡出 ----
  Ui.applySnapshot(base);
  pump();
  const mk2 = tintMarks();
  ok(mk2.length === mk1.length, '弹痕不会一帧就没（下一帧仍是 ' + mk2.length + ' 处）');
  const alphaOf = (arr) => (arr.length ? Math.max(...arr.map((f) => Number(f.slice(f.lastIndexOf(',') + 1, -1)))) : 0);
  const aOld = alphaOf(mk2);
  const t3 = Date.now();
  while (Date.now() - t3 < 400) {
    /* 等 400ms 看它淡下去 */
  }
  pump();
  const aNew = alphaOf(tintMarks());
  ok(aNew < aOld - 0.002 && aNew > 0.1, '弹痕是慢慢淡出而不是突然消失（' + aOld.toFixed(3) + ' → ' + aNew.toFixed(3) + '）');
  ok(MARK_TTL > 2000 && MARK_MAX >= 60, '弹痕寿命 ' + MARK_TTL + 'ms、上限 ' + MARK_MAX + ' 处（不永久堆积）');

  // ---- ⑦ 弹痕数量有上限（长时间对局不会无限攒） ----
  const many = [];
  for (let i = 0; i < MARK_MAX + 25; i++) {
    many.push({ t: 'hit', x: hitX + (i % 40) * 9, y: hitY + Math.floor(i / 40) * 11, a: 0, k: 0, oi: 0, id: i + 100 });
  }
  Ui.applySnapshot(Object.assign({}, base, { b: [], ev: many }));
  pump();
  const capped = tintMarks().length;
  ok(capped === MARK_MAX, '弹痕上限生效（塞 ' + many.length + ' 处 → 画 ' + capped + ' 处）');
}

console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
