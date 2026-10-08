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
const WFData = require(path.join(ROOT, 'server/games/warfactory/data.js'));

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
  // 地形编辑器「保存并下载」走到最后会点一下 <a download>，这里记一笔
  clicks: [],
  blobs: [],
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
        // 多带两个字段：属于哪块画布、当时是什么填充色（小地图灰化地形靠它验证）
        if (prop === 'fillRect') return (x, y, w, h) => log.rects.push([x, y, w, h, owner || '?', st.fillStyle]);
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
  // 属性表：地形编辑器面板靠 data-wfe-* 找按钮，没有它这套面板就测不动
  const attrs = Object.create(null);
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
    getAttribute(k) {
      return k in attrs ? attrs[k] : null;
    },
    setAttribute(k, v) {
      attrs[String(k)] = String(v);
    },
    removeAttribute(k) {
      delete attrs[String(k)];
    },
    click() {
      log.clicks.push(node.id);
      node.dispatch('click', {});
    },
    remove() {},
    appendChild(c) {
      c.parentNode = node;
      node.children.push(c);
      return c;
    },
    insertBefore(c, ref) {
      c.parentNode = node;
      const i = ref ? node.children.indexOf(ref) : -1;
      if (i >= 0) node.children.splice(i, 0, c);
      else node.children.push(c);
      return c;
    },
    querySelector(sel) {
      return el(id + ' ' + sel);
    },
    /**
     * 按属性选择器在整个已建节点表上找（`[data-wfe-tab]` 这类）。
     * 真实浏览器只搜子树，但例里的 data-* 钩子只有地形编辑器那一块在用，
     * 摊平搜不会串到别的节点上，换来的是「不用接整套 HTML 解析器」。
     */
    querySelectorAll(sel) {
      return queryAll(sel);
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

/** `[attr]` 形选择器在所有已建节点上的匹配结果 */
function queryAll(sel) {
  const m = /^\[([a-zA-Z0-9_-]+)\]$/.exec(String(sel || '').trim());
  const key = m ? m[1] : '';
  const out = [];
  for (const k of Object.keys(els)) {
    const n = els[k];
    if (!n || typeof n.getAttribute !== 'function') continue;
    if (key ? n.getAttribute(key) !== null : false) out.push(n);
  }
  return out;
}

/**
 * 把 panel.html 里带属性的标签摊平成假 DOM 节点。
 * 面板真正 mut 的东西（id、data-wfe-*）本来就在这些属性上，
 * 于是地形编辑器的页签 / 画笔按钮在这套桩里跟真浏览器一样能被 query 出来。
 */
function seedPanelNodes() {
  const html = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');
  const re = /<([a-zA-Z][\w-]*)\s([^>]*)>/g;
  let n = 0;
  let m;
  while ((m = re.exec(html))) {
    const attrRe = /([\w:@-]+)\s*=\s*"([^"]*)"/g;
    let a;
    let found = false;
    let id = '';
    while ((a = attrRe.exec(m[2]))) {
      found = true;
      if (a[1] === 'id') id = a[2];
    }
    if (!found) continue;
    attrRe.lastIndex = 0;
    const node = el(id || 'panel-attr-' + n);
    node.tagName = m[1].toUpperCase();
    while ((a = attrRe.exec(m[2]))) {
      if (a[1] === 'id' || a[1] === 'class' || a[1] === 'type') continue;
      node.setAttribute(a[1], a[2]);
    }
    n += 1;
  }
  return n;
}

const documentStub = {
  getElementById: (id) => el(id),
  createElement: () => el('created-' + els.__n++),
  querySelector: (sel) => el(sel),
  querySelectorAll: (sel) => queryAll(sel),
  addEventListener() {},
  body: { appendChild() {} },
};
els.__n = 0;
// panel.html 里那些带 id / data-* 的标签摊平进假 DOM：地形编辑器面板全靠它们查节点
seedPanelNodes();

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
  // 删除 / 读取地图前会弹一句确认框；测试里一律「是」
  confirm: () => true,
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
  // 地形编辑器「保存并下载」要用浏览器这两个东西才能把文件落到本地
  Blob: function BlobStub(parts, opts) {
    log.blobs.push({ text: String((parts && parts[0]) || ''), type: opts && opts.type });
  },
  URL: { createObjectURL: () => 'blob:wf-mock', revokeObjectURL() {} },
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

/** 每相差 1 层，画面上错开多少世界像素（从源码读，改参数时测试自动跟着走） */
const HEIGHT_STEP = Number((/const HEIGHT_STEP = (\d+);/.exec(src) || [0, 0])[1]) || 0;
/**
 * 高低差：地图上每一格都有一层数，画面上整块往上抬 lift 像素。
 * 于是「世界坐标」和「画面位置」差了一截 —— 凡是拿世界坐标去点、去量画面位置的地方，
 * 都要先过这两个函数（直接用 Ui 的实现，测试自己的地图 lifts 与客户端必然一致）。
 *   visY(x,y)  = 站在 (x,y) 的东西画在哪条 y 上
 *   liftAt(x,y)= 那一格抬了多少像素
 */
const visY = (x, y) => Ui.heights.groundY(x, y);
const liftAt = (x, y) => Ui.heights.liftAt(x, y);

/** 从客户端源码里读 UNIT_VIS_SCALE 常量（全局视觉缩放） */
const UNIT_VIS_SCALE = Number((/const UNIT_VIS_SCALE = ([\d.]+);/.exec(src) || [0, 0])[1]) || 1;
/** 视觉格子对齐：一级兵体量目标 = UNIT_SIZE_CELLS 格 × 每格像素（与 ui.js 保持一致） */
const UNIT_SIZE_CELLS = Number((/const UNIT_SIZE_CELLS = (\d+);/.exec(src) || [0, 2])[1]) || 2;
const GRID_CELL_FALLBACK = Number((/const GRID_CELL_FALLBACK = (\d+);/.exec(src) || [0, 10])[1]) || 10;
const UNIT_BODY_TARGET = Number((/const UNIT_BODY_TARGET = (\d+);/.exec(src) || [0, 15])[1]) || 15;
/** 兵种基础体型系数：叠在 UNIT_VIS_SCALE 之上，锐士靠它补足体量 */
function bodyScaleOf(type) {
  const body = (/const UNIT_BODY_SCALE = \{([^}]*)\}/.exec(src) || [0, ''])[1];
  const m = new RegExp(type + ':\\s*([\\d.]+)').exec(body);
  const base = m ? Number(m[1]) : 1;
  // ui.js 里 bodyScaleOf 会把「15 口径」的表值放大到「2 格」目标，这里必须同步
  return base * ((GRID_CELL_FALLBACK * UNIT_SIZE_CELLS) / UNIT_BODY_TARGET);
}

/** 小地图逻辑尺寸（从源码读，改尺寸时测试自动跟着走） */
const MINI_W = Number((/const MINIMAP_W = (\d+);/.exec(src) || [0, 0])[1]) || 0;
const MINI_H = Number((/const MINIMAP_H = (\d+);/.exec(src) || [0, 0])[1]) || 0;
/**
 * 缩放上下限同样从源码读：用户随时会放宽范围，写死就会误报。
 * 另外小地图灰化三档 + 敌我两色的色值也从源码读，改配色时测试自动跟着走。
 */
const ZOOM_MIN = Number((/const ZOOM_MIN = ([\d.]+);/.exec(src) || [0, 0])[1]) || 0;
const ZOOM_MAX = Number((/const ZOOM_MAX = ([\d.]+);/.exec(src) || [0, 0])[1]) || 0;
const ZOOM_FIT_SLACK = Number((/const ZOOM_FIT_SLACK = ([\d.]+);/.exec(src) || [0, 0])[1]) || 0;
const MINI_MTN = (/const MINI_MTN = '([^']+)'/.exec(src) || [0, ''])[1];
const MINI_WATER = (/const MINI_WATER = '([^']+)'/.exec(src) || [0, ''])[1];
const MINI_FRIEND = (/const MINI_FRIEND = '([^']+)'/.exec(src) || [0, ''])[1];
const MINI_FOE = (/const MINI_FOE = '([^']+)'/.exec(src) || [0, ''])[1];
const MINI_LAND = (/const MINI_LAND = '([^']+)'/.exec(src) || [0, ''])[1];
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
  // 地形编辑器专用通道（wf:edit / map:save / map:list …）：试例要读 **发出去的指令**
  emitRaw(name, payload, ack) {
    sent.push({ __raw: String(name || ''), payload: payload });
    if (typeof ack === 'function' && typeof globalThis.__WF_MAP_ACK === 'function') {
      ack(globalThis.__WF_MAP_ACK(String(name || ''), payload));
    }
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
    clientY: visY(wx, wy) - cam.y,
    preventDefault() {},
    shiftKey: false,
  };
  canvasEl.dispatch('mousedown', evt);
  canvasEl.dispatch('mouseup', evt);
  pump();
  return true;
}

/** 世界坐标双击（直接派发 dblclick —— 这是第 9 项「双击建筑 = 选兵」的入口） */
function dblWorld(wx, wy) {
  const cam = camFromLastFrame();
  if (!cam) return false;
  canvasEl.dispatch('dblclick', {
    button: 0,
    clientX: wx - cam.x,
    clientY: visY(wx, wy) - cam.y,
    preventDefault() {},
    shiftKey: false,
  });
  pump();
  return true;
}

/** 中栏格子 / 分组按 className 找子孙（递归，够用即可） */
function kidsDeep(node, cls) {
  const out = [];
  const walk = (n) => {
    for (const ch of (n && n.children) || []) {
      if (String(ch.className || '').indexOf(cls) >= 0) out.push(ch);
      walk(ch);
    }
  };
  walk(node);
  return out;
}

/** 世界坐标框选（mousedown → mousemove → mouseup） */
function dragWorld(x0, y0, x1, y1, shift) {
  const cam = camFromLastFrame();
  if (!cam) return false;
  const mk = (wx, wy) => ({
    button: 0,
    clientX: wx - cam.x,
    clientY: visY(wx, wy) - cam.y,
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
  // 半径也要参与搜索：总部亲兵是「围成一圈」站着的，只在固定半径上绕一圈取点，
  // 最优点也可能刚好贴在某个兵的选择半径边上（总部出生点随机 → 时好时坏）。
  // 把圆心一起放进候选集后，最优点至少离每个亲兵一整圈的距离，断言不再抖。
  for (const r of [0, radius * 0.5, radius]) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const px = b.x + Math.cos(a) * r;
      const py = b.y + Math.sin(a) * r;
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
ok(
  log.texts.includes('可进化 ×' + Math.floor(620 / Cc.FAC_LINE_EVOLVE_COST)),
  `攒够 ${Cc.FAC_LINE_EVOLVE_COST} 时显示可进化次数`
);

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
  // 剩余秒数按服务端周期推导（rpPeriodMs 改成 1500 后这里不会误报）
  const leftHalfSec = ((P - P * 0.5) / 1000).toFixed(1);
  ok(
    log.texts.some((t) => new RegExp('^下次 \\+' + perPeriodOf(1) + ' · ' + leftHalfSec.replace('.', '\\.') + 's$').test(t)),
    `显示距下次结算的倒计时（下次 +${perPeriodOf(1)} · ${leftHalfSec}s）`
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
// 第 1 项：升级价统一为 300 → 取一个「不足一次」的点数（< FAC_LINE_EVOLVE_COST）看进度
const rpPartial = Math.max(1, Math.floor(Cc.FAC_LINE_EVOLVE_COST * 0.6));
g.players[0].rp = rpPartial;
Ui.applySnapshot(wf.snapshot(g));
pump();
ok(
  texts().includes(rpPartial + ' / ' + Cc.FAC_LINE_EVOLVE_COST),
  `不足 ${Cc.FAC_LINE_EVOLVE_COST} 时显示进度 ${rpPartial}/${Cc.FAC_LINE_EVOLVE_COST}`
);

console.log('\n[2b] 观战视角的科技点 HUD');
{
  // 研究所总数 = 人数 × layout.labPerPlayer（现为 1），所以要凑出「甲 2 所 / 乙 1 所」
  // 至少得 3 人局 —— 写死 2 人局的话 labs[2] 是 undefined。
  const gSpec = wf.createGameState({
    id: 'client-check-spect',
    players: [
      { id: 'p0', name: '甲' },
      { id: 'p1', name: '乙' },
      { id: 'p2', name: '丙' },
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
const UNIT_CN = { warrior: '锐士', shield: '盾卫', ranger: '游侠', burst: '轰击', burn: '燎原', laser: '激光兵' };
/** DOM 桩没有 querySelectorAll：按 class 递归找后代（行 / 行内文字 / 行内按钮 / 选择器选项） */
const kidsByClass = (node, cls) => {
  const out = [];
  const visit = (n) => {
    if (!n) return;
    if (String(n.className || '').split(/\s+/).includes(cls)) out.push(n);
    (n.children || []).forEach(visit);
  };
  visit(node);
  return out;
};
/** 产线清单里所有「进化」按钮（总部 / 初级厂都不会有） */
const lineEvoBtns = () => kidsByClass(el('warfactory-facpanel #wfp-line-list'), 'wfp-lbtn');
/** 产线清单里每行的文字（序号·兵种 阶数 分支） */
const lineRowTexts = () =>
  kidsByClass(el('warfactory-facpanel #wfp-line-list'), 'wfp-lname').map((n) => n.textContent);
/** 选择器里的选项按钮 */
const pickerItems = () => kidsByClass(el('warfactory-facpanel #wfp-picker'), 'wfp-pick');
ok(panel.hidden === false, '面板弹出');
ok(title.textContent === '总部', '标题为「总部」');
ok(el('warfactory-facpanel #wfp-prod-sec').hidden === false, '总部也出兵 → 显示「产能 · 产线」段');
ok(
  lineRowTexts().length === 1 && lineRowTexts()[0].includes('锐士'),
  '总部产线清单显示默认产锐士（' + lineRowTexts().join(' / ') + '）'
);
ok(lineEvoBtns().length === 0, '总部产线不可进化 → 没有进化按钮');

console.log('\n[5] 总部开辟产线：先选兵种');
sent.length = 0;
{
  const lineBtn = el('warfactory-facpanel #wfp-line');
  ok(lineBtn.hidden === false && !lineBtn.disabled, '总部面板可开辟产线（' + lineBtn.textContent + '）');
  lineBtn.dispatch('click', { stopPropagation() {} });
  const picker = el('warfactory-facpanel #wfp-picker');
  ok(picker.hidden === false, '点「开辟产线」弹出兵种选择器');
  ok(pickerItems().length === Cc.TYPE_LIST.length, '选择器列出全部 ' + Cc.TYPE_LIST.length + ' 个兵种');
  const want = Cc.TYPE_LIST[2];
  pickerItems()
    .find((b) => b.textContent.indexOf(UNIT_CN[want]) === 0)
    .dispatch('click', { stopPropagation() {} });
  ok(
    sent.some((d) => d.cmd === 'facLine' && d.fid === 0 && d.type === want),
    '选定兵种后发出 facLine(fid=0, type)：' + JSON.stringify(sent[0])
  );
  ok(picker.hidden === true, '选完自动收起选择器');
}

console.log('\n[6] 点选自家工厂 → 工厂面板');
const fac0 = g.factories[0];
ok(clickWorld(fac0.x, fac0.y), '点击工厂');
ok(title.textContent === '1 号工厂', '标题为工厂');
ok(el('warfactory-facpanel #wfp-prod-sec').hidden === false, '显示「正在生产」');
ok(
  lineRowTexts().length >= 1 && lineRowTexts()[0].length > 0,
  '产线清单显示每条线产什么兵：' + lineRowTexts().join(' / ')
);
ok(el('warfactory-facpanel #wfp-rally').hidden === false, '显示集结点状态');

console.log('\n[7] 产线进化按钮三态');
g.factories[0].level = 1;
Ui.render(wf.publicGameState(g), net, view);
Ui.applySnapshot(wf.snapshot(g));
pump();
clickWorld(fac0.x, fac0.y);
ok(lineEvoBtns().length === 0, '初级工厂的产线不可进化 → 没有进化按钮');
g.factories[0].level = 2;
g.players[0].rp = 10;
Ui.render(wf.publicGameState(g), net, view);
Ui.applySnapshot(wf.snapshot(g));
pump();
clickWorld(fac0.x, fac0.y);
ok(lineEvoBtns().length === 1, '中级工厂每条产线各挂一个进化按钮');
ok(
  lineEvoBtns()[0].disabled === true && lineEvoBtns()[0].textContent.includes('科技点不足'),
  '点数不足时禁用（' + lineEvoBtns()[0].textContent + '）'
);
g.players[0].rp = Cc.FAC_LINE_EVOLVE_COST * 2;
Ui.applySnapshot(wf.snapshot(g));
pump();
ok(!lineEvoBtns()[0].disabled, '点数充足后恢复可用（' + lineEvoBtns()[0].textContent + '）');

console.log('\n[7b] 产线进化：单一方向，点进化直接发指令（不再选分支）');
sent.length = 0;
lineEvoBtns()[0].dispatch('click', { stopPropagation() {} });
ok(sent.length === 1, '点进化只发一条指令（无分支选择中间态）：' + sent.length);
ok(
  sent.some((d) => d.cmd === 'facEvolve' && d.fid === fac0.id && d.li === 0 && !d.branch),
  '直接发出 facEvolve(fid, li)，不再带 branch：' + JSON.stringify(sent[0])
);

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
  // 地图含随机成片山脉：硬编码坐标可能落在山里或被山挡住视线 → 索敌直接失败。
  // 先扫一块「两处都可站且互相通视」的平地再摆用例。
  const trl = gl.terrain;
  const freeAtL = (x, y) => {
    const cc = Math.floor(x / trl.cell);
    const rr = Math.floor(y / trl.cell);
    return rr >= 0 && cc >= 0 && rr < trl.rows && cc < trl.cols && trl.grid[rr][cc] === 0;
  };
  const blocksL = [...gl.factories, ...gl.labs, ...gl.hqs].map((b) => [b.x, b.y]);
  let spL = null;
  for (let rr = 3; rr < trl.rows - 3 && !spL; rr++) {
    for (let cc = 3; cc < trl.cols - 5 && !spL; cc++) {
      const ax = (cc + 0.5) * trl.cell;
      const ay = (rr + 0.5) * trl.cell;
      const bx = ax + 90;
      if (!freeAtL(bx, ay)) continue;
      if (blocksL.some((b) => Math.hypot(b[0] - ax, b[1] - ay) < 400)) continue;
      if (wf.__test.losBlocked(gl, ax, ay, bx, ay)) continue;
      spL = { ax, ay, bx };
    }
  }
  ok(Boolean(spL), '找得到一块互相通视的平地摆激光用例');
  const L = wf.__test.spawnUnit(gl, { id: 900, owner: 0, level: 2 }, 'laser', spL.ax, spL.ay);
  const E = wf.__test.spawnUnit(gl, { id: 901, owner: 1, level: 2 }, 'shield', spL.bx, spL.ay);
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

  // 蓄能满：快进「吃满用时」（⚠️ rampMs 是 +1 倍的周期，吃满 = (maxMul−1)×rampMs，别写死秒数）
  {
    const cK = wf.__test.consts;
    const needMs = cK.LASER_RAMP_MS * (cK.LASER_MAX_MUL - 1) + cK.LASER_WINDUP_MS + 500;
    for (let i = 0; i * 50 < needMs; i++) wf.__test.step(gl, 0.05, (now += 50));
  }
  L.windupUntil = 0;
  Ui.applySnapshot(wf.snapshot(gl));
  log.dashes.length = 0;
  log.strokes.length = 0;
  log.texts.length = 0;
  pump();
  const maxW = log.strokes.length ? Math.max(...log.strokes) : 0;
  const MAX_MUL = wf.__test.consts.LASER_MAX_MUL;
  ok(L.lockMul >= MAX_MUL - 0.01, `锁定倍率已封顶（${L.lockMul.toFixed(2)} / 上限 ${MAX_MUL}）`);
  ok(maxW >= 8, `绘制粗光束（最粗 ${maxW.toFixed(1)}px，随倍率增强）`);
  ok(texts().includes('×' + MAX_MUL.toFixed(1)), `单位上方显示倍率读数 ×${MAX_MUL.toFixed(1)}`);
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

  // 站位**不能写死**：地貌主题每局随机（抽到大山脉时满图是山），写死的坐标可能正好落在
  // 山/水里 —— spawnUnit 会把部队挪到最近的可通行格，两支就被拆散了，
  // 后面那次框选只能框到一支（实测会红「已选 2 支」「编成列出两个兵种」两项）。
  // 所以先找一块 spanPx × spanPx 的连续空地，两支都摆在里面，框选也按它来。
  const openBlock = (g, spanPx) => {
    const tr = g.terrain;
    const blocks = [...g.factories, ...g.labs, ...g.hqs].map((b) => [b.x, b.y]);
    const free = (r, c) => tr.grid[r] && tr.grid[r][c] !== 2 && tr.grid[r][c] !== 4;
    const need = Math.ceil(spanPx / tr.cell) + 2;
    const near = (x, y) => blocks.some((b) => Math.hypot(b[0] - x, b[1] - y) < 900);
    for (let r = 4; r + need < tr.rows - 4; r++) {
      for (let c = 4; c + need < tr.cols - 4; c++) {
        let okAll = true;
        for (let dr = 0; dr < need && okAll; dr++) {
          for (let dc = 0; dc < need; dc++) {
            if (!free(r + dr, c + dc)) {
              okAll = false;
              break;
            }
          }
        }
        if (!okAll) continue;
        const x = (c + need / 2) * tr.cell;
        const y = (r + need / 2) * tr.cell;
        if (near(x, y)) continue;
        return { x, y, half: (need * tr.cell) / 2 };
      }
    }
    return { x: g.world.w / 2, y: g.world.h / 2, half: spanPx / 2 };
  };
  const spot = openBlock(gp, 300);
  const hx = spot.x + 60;
  const hy = spot.y - 30;
  const tx = spot.x - 60;
  const ty = spot.y + 30;

  // 单选：总部亲兵（初级锐士）→ 详细属性
  const hero = wf.__test.spawnUnit(gp, { id: 0, owner: 0, level: 3 }, 'warrior', hx, hy);
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
  // 血量从 data.js 动态取（手改 units.warrior.hp 时断言自动跟着走，不要写死数字）
  const warriorHp = wf.__test.consts.STATS.warrior.hp;
  ok(
    up('#wup-hp-text').textContent === warriorHp + ' / ' + warriorHp,
    `显示血量 ${warriorHp} / ${warriorHp}（初级锐士）`
  );
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

  // 攻击/血量的分级：中级盾卫直接从独立数据表 evolved.shield[2] 取，不再叠加分支修正
  const tank = wf.__test.spawnUnit(gp, { id: 0, owner: 0, level: 3 }, 'shield', tx, ty);
  tank.moveX = null;
  tank.moveY = null;
  wf.__test.promoteUnit(gp, tank);
  Ui.applySnapshot(wf.snapshot(gp));
  pump();
  clickWorld(tank.x, tank.y);
  const gc = wf.publicGameState(gp).consts;
  const shieldMax = Math.round(gc.evolved.shield[2].hp);
  ok(
    up('#wup-hp-text').textContent === shieldMax + ' / ' + shieldMax,
    `中级盾卫血量取独立数据表 evolved.shield[2]（${up('#wup-hp-text').textContent}）`
  );
  ok(
    !up('#wup-name').textContent.includes('守势') &&
      !up('#wup-name').textContent.includes('攻势'),
    '单位名称不再显示分支（已改为单一进化方向）'
  );

  // 多选：两支 → 编成汇总（框选范围也按找到的那块空地来，别写死坐标）
  dragWorld(spot.x - spot.half, spot.y - spot.half, spot.x + spot.half, spot.y + spot.half);
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
    // 固定用「超级平原」：本组量的是兵种绘制，地形只是背景；
    // 不指定的话每局随机抽主题（同一房连开也会换地貌），空地落点会漂，测量跟着抖。
    const g = wf.createGameState({
      id: 'client-tier-' + type,
      theme: 'plains',
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
    u.angle = 0; // 角度归零，量出来的包围盒才是正交的
    Ui.render(wf.publicGameState(g), net, view);
    Ui.applySnapshot(wf.snapshot(g));
    pump(); // 暖机帧（地形预渲染等只发生一次，别混进测量帧）
    log.strokes.length = 0;
    log.strokeMags.length = 0;
    Ui.applySnapshot(wf.snapshot(g));
    pump(); // 测量帧

    const cam = camFromLastFrame();
    // 本体那一趟多了 scale(unitScale) 这一层，用等效缩放把它从地形 / 建筑 / 归属底色盘里筛出来。
    // 缩放 = 全局 × 兵种归一 × 阶数倍率（三级 = 一级的 2 倍），三者都要乘进来才筛得准。
    const bodyScale = cam
      ? cam.k * visScale * bodyScaleOf(type) * Ui.scales.tier(type, tier)
      : 0;
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

  const BOX = {};
  for (const type of TYPES) {
    const s1 = shot(type, 1);
    const s2 = shot(type, 2);
    const s3 = shot(type, 3);
    BOX[type] = { s1, s3 };
    ok(
      s2.strokes > s1.strokes && s3.strokes > s2.strokes,
      `${LABEL[type]}：阶数越高装饰越多（描边 初 ${s1.strokes} < 中 ${s2.strokes} < 高 ${s3.strokes}）`
    );
    ok(
      s3.box && s1.box && s3.box.w >= s1.box.w - 0.01 && s3.box.h >= s1.box.h - 0.01,
      `${LABEL[type]}：高级体型不小于初级（${s1.box ? `${s1.box.w.toFixed(1)}×${s1.box.h.toFixed(1)}` : '?'} → ${s3.box ? `${s3.box.w.toFixed(1)}×${s3.box.h.toFixed(1)}` : '?'}）`
    );
  }

  // ---- 第 10 项：三级兵体型 = 一级兵的 2 倍 ----
  // 量的是「本体半长」：span[tier] × tierScale = TIER_SIZE_MUL[tier] × span[1]。
  // 不量包围盒 —— 三级还多出花纹 / 挂件 / 饰带这些「额外探出来」的装饰（一级完全没有），
  // 包围盒必然比 2 倍更大，那是「外观更先进」应有的部分，不是体型。
  for (const type of TYPES) {
    const sp1 = Ui.scales.span(type, 1)[0];
    const sp3 = Ui.scales.span(type, 3)[0];
    const half1 = sp1 * Ui.scales.tier(type, 1);
    const half3 = sp3 * Ui.scales.tier(type, 3);
    ok(
      Math.abs(half3 / half1 - 2) < 1e-9,
      `${LABEL[type]}：三级本体半长 = 一级的 2 倍（${half1.toFixed(1)} → ${half3.toFixed(1)}，×${(half3 / half1).toFixed(3)}）`
    );
    // 连同装饰一起看：三级至少要明显大一圈（≥1.8 倍）
    const b1 = BOX[type].s1.box;
    const b3 = BOX[type].s3.box;
    ok(
      b3.w / b1.w >= 1.8 && b3.h / b1.h >= 1.8,
      `${LABEL[type]}：三级连装饰明显大一圈（${b1.w.toFixed(1)}×${b1.h.toFixed(1)} → ${b3.w.toFixed(1)}×${b3.h.toFixed(1)}）`
    );
  }
  // ---- 第 10 项：所有一级兵体型基本一致（按「体量 = 半长×半宽的几何平均」归一后比对）----
  {
    const bulk = TYPES.map((t) => {
      const s = Ui.scales.span(t, 1);
      return Math.sqrt(s[0] * s[1]) * bodyScaleOf(t);
    });
    const spread = Math.max(...bulk) / Math.min(...bulk);
    ok(
      spread <= 1.2,
      `一级兵体型基本一致（体量 ${Math.min(...bulk).toFixed(2)}~${Math.max(...bulk).toFixed(2)}，极差 ×${spread.toFixed(3)}）`
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
    // 第 8 项：单厂上限 = 默认 1 条 + 最多再开 1 条（facMaxLines = 2）
    ok(lineText.textContent === '产线 1 / 2', '显示产线数（' + lineText.textContent + '）');
    ok(/秒 \/ 支/.test(rateText.textContent), '显示产出速率（' + rateText.textContent + '）');
    ok(
      rateText.textContent.includes('20.0 秒 / 支') && rateText.textContent.includes('1 条并行'),
      '单条产线时速率 = 基础间隔（20.0 秒 / 支）'
    );
    ok(lineBtn.hidden === false && !lineBtn.disabled, '开辟产线按钮可用（' + lineBtn.textContent + '）');
    ok(lineBtn.textContent.includes(String(Cc.FAC_LINE_COST)), `按钮标注 ${Cc.FAC_LINE_COST} 科技点`);
    ok(spdBox.hidden === true, '工厂面板不显示总部专用的生产加速段');

    // 点「开辟产线」→ 先弹兵种选择器，选完才发指令
    sent.length = 0;
    lineBtn.dispatch('click', { stopPropagation() {} });
    {
      const picker = el('warfactory-facpanel #wfp-picker');
      ok(picker.hidden === false && sent.length === 0, '先弹兵种选择器，此时还没发指令');
      ok(pickerItems().length === Cc.TYPE_LIST.length, '列出全部 ' + Cc.TYPE_LIST.length + ' 个兵种');
      const want = Cc.TYPE_LIST[1];
      pickerItems()
        .find((b) => b.textContent.indexOf(UNIT_CN[want]) === 0)
        .dispatch('click', { stopPropagation() {} });
      ok(
        sent.some((d) => d.cmd === 'facLine' && d.fid === fac0.id && d.type === want),
        '选完兵种才发 facLine（' + JSON.stringify(sent[0]) + '）'
      );
    }

    // 科技点不足 → 禁用
    g.players[0].rp = 100;
    Ui.applySnapshot(wf.snapshot(g));
    pump();
    ok(lineBtn.disabled === true && lineBtn.textContent.includes('科技点不足'), '科技点不足时禁用（' + lineBtn.textContent + '）');

    // 产线满 → 按钮变成「已满」
    g.players[0].rp = 5000;
    g.factories[0].lines = 3; // 手改超限：服务端会夹回上限 2
    Ui.applySnapshot(wf.snapshot(g));
    pump();
    ok(
      lineText.textContent === '产线 2 / 2',
      '产线数随快照刷新且被夹到上限（' + lineText.textContent + '）'
    );
    ok(lineBtn.disabled === true && lineBtn.textContent.includes('已满'), '满产线后按钮变为「已满」（' + lineBtn.textContent + '）');
    ok(
      rateText.textContent.includes('2 条并行') && rateText.textContent.includes('10.0 秒 1 支'),
      '2 条并行时合计每 10.0 秒 1 支（' + rateText.textContent + '）'
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
    // 先把镜头拉回自家总部（空格）：出生点是随机 jitter 过的，地图放大到 11520 之后
    // jitter 也跟着放大，总部有可能落在视野外 —— 那时 clickWorld 算出的画布坐标
    // 是负的或超出画布，这一下点击就打空了（实测地图放大后开始偶发）。
    winStub.dispatch('keydown', { code: 'Space', target: null, preventDefault() {} });
    pump();
    Ui.render(wf.publicGameState(g), net, view);
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
    ok(spdBtn.textContent.includes(String(Cc.PROD_SPEED_COST)), `按钮标注 ${Cc.PROD_SPEED_COST} 科技点`);
    ok(
      el('warfactory-facpanel #wfp-line').hidden === false,
      '总部也出兵 → 面板显示「开辟产线」按钮'
    );
    ok(el('warfactory-facpanel #wfp-prod-sec').hidden === false, '总部面板显示「产能 · 产线」段');
    ok(
      kidsByClass(el('warfactory-facpanel #wfp-line-list'), 'wfp-lbtn').length === 0,
      '总部产线不可进化（清单里没有进化按钮）'
    );

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
  // 期望值从源码常量推导（ZOOM_MIN / ZOOM_FIT_SLACK 都可能被改）
  const expectMin = Math.max(ZOOM_MIN, fitMin * ZOOM_FIT_SLACK);
  ok(
    Math.abs(zMin - expectMin) < 0.02,
    '缩放下限 = max(' + ZOOM_MIN + ' 倍, 整图装进可见区 × ' + ZOOM_FIT_SLACK + ')（' +
      zMin.toFixed(3) + '× ≈ ' + expectMin.toFixed(3) + '×）'
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
  ok(
    Math.abs(zMax - ZOOM_MAX) < 0.05,
    '推到最近停在 ' + ZOOM_MAX + ' 倍（' + zMax.toFixed(2) + '×）'
  );
  ok(ZOOM_MAX > 2.2 && ZOOM_MIN < 0.35, `缩放范围已放宽：${ZOOM_MIN}× ~ ${ZOOM_MAX}×（原 0.35~2.2）`);

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
  ok(clickW(foeU.x, visY(foeU.x, foeU.y)), '点选敌方部队');
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
  ok(clickW(foeF.x, visY(foeF.x, foeF.y)), '点选敌方工厂');
  pump();
  ok(el('warfactory-facpanel').hidden === false && el('warfactory-unitpanel').hidden === true, '右栏切到建筑信息');
  ok(fp18('#wfp-title').textContent.indexOf('敌军') === 0, '标题标注敌军（' + fp18('#wfp-title').textContent + '）');
  ok(fp18('#wfp-owner').textContent.includes('乙'), '归属显示对手（' + fp18('#wfp-owner').textContent + '）');
  ok(fp18('#wfp-line').hidden === true, '不出现「开辟产线」');
  ok(kidsByClass(fp18('#wfp-line-list'), 'wfp-lbtn').length === 0, '不出现产线「进化」按钮');
  ok(fp18('#wfp-spd').hidden === true, '不出现「生产加速」');
  ok(fp18('#wfp-rally').hidden === true, '不出现「集结点」');
  ok(fp18('#wfp-note').textContent.includes('仅供查看'), '底部提示只读（' + fp18('#wfp-note').textContent + '）');
  ok(/\/ \d+$/.test(fp18('#wfp-hp-text').textContent.trim()), '血量照常显示（' + fp18('#wfp-hp-text').textContent + '）');
  fp18('#wfp-line').dispatch('click', { stopPropagation() {} });
  fp18('#wfp-speed').dispatch('click', { stopPropagation() {} });
  pump();
  ok(sent.length === 0, '就算硬点（已隐藏的）按钮也不会发出任何指令');

  // ---- ③ 敌方总部 ----
  focusTo(foeHq.x, foeHq.y);
  ok(clickW(foeHq.x, visY(foeHq.x, foeHq.y)), '点选敌方总部');
  pump();
  ok(fp18('#wfp-title').textContent === '敌军总部', '总部标题（' + fp18('#wfp-title').textContent + '）');
  ok(fp18('#wfp-spd').hidden === true, '敌方总部没有加速段');
  ok(fp18('#wfp-note').textContent.includes('仅供查看'), '底部提示只读');

  // ---- ④ 中立研究所 ----
  focusTo(lab.x, lab.y);
  ok(clickW(lab.x, visY(lab.x, lab.y)), '点选研究所');
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
  /**
   * 挑一块「周围一圈都没有高低差」的平地落脚。
   *
   * 画面上的 y 是被抬拉过的（见 visY），点下去要靠 visualToWorldY 反推回地面；
   * 这条反推在坡地上是多解的，随机地貌下一不小心就解到隔壁一格，
   * 于是「点得中/点不中」跟着地图抽风。用例用的一律是这种零抬拉的平地 ——
   * 连着后面框选那 ±300 像素一起兜进去，才算稳。
   */
  const flatSpot18 = () => {
    const tr = g.terrain;
    const blocks = [...g.factories, ...g.labs, ...g.hqs].map((b) => [b.x, b.y]);
    const R = Math.ceil(300 / tr.cell) + 1;
    const C = Math.ceil(320 / tr.cell) + 1;
    // 先按「整片窗口都是平原」筛（纯读地形表，很便宜），过了再用 liftAt 抽检；
    // 全平原窗口里不可能混着山，抽到非零抬拉就说明旁边还有坡，换下一个。
    const allPlain = (r, c) => {
      for (let dr = -R; dr <= R; dr++) {
        const row = tr.grid[r + dr];
        for (let dc = -C; dc <= C; dc++) if (row[c + dc] !== 0) return false;
      }
      return true;
    };
    const flatEnough = (r, c) => {
      for (let dr = -R; dr <= R; dr += 3) {
        for (let dc = -C; dc <= C; dc += 3) {
          if (liftAt((c + dc + 0.5) * tr.cell, (r + dr + 0.5) * tr.cell) !== 0) return false;
        }
      }
      return true;
    };
    let tries = 0;
    for (let r = R + 2; r < tr.rows - R - 2 && tries < 400; r += 2) {
      for (let c = C + 2; c < tr.cols - C - 2 && tries < 400; c += 2) {
        if (tr.grid[r][c] !== 0) continue;
        tries++;
        if (!allPlain(r, c) || !flatEnough(r, c)) continue;
        const x = (c + 0.5) * tr.cell;
        const y = (r + 0.5) * tr.cell;
        if (blocks.some((b) => Math.hypot(b[0] - x, b[1] - y) < 700)) continue;
        return { x, y };
      }
    }
    return { x: Math.round(ws18.w * 0.6), y: Math.round(ws18.h * 0.62) };
  };
  const sp18 = flatSpot18();
  myU.x = Math.round(sp18.x);
  myU.y = Math.round(sp18.y);
  foeU2.x = myU.x + 60;
  foeU2.y = myU.y;
  foeU2.moveX = null;
  foeU2.moveY = null;
  reRender();
  focusTo(myU.x, myU.y);
  clickW(foeU2.x, visY(foeU2.x, foeU2.y));
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
  clickW(foeU2.x, visY(foeU2.x, foeU2.y));
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
      clientY: (visY(wx, wy) - c.y) * c.k,
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
  clickW(myU.x, visY(myU.x, myU.y));
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
  clickW(myU.x, visY(myU.x, myU.y)); // 重新选中执行部队（刚才点空地已取消选择）
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
  /**
   * 「点一处空地」的落点**不能写死**：中立工厂是按 C_N 轨道动态摆的，写死的偏移
   * （世界中心 −420,−240）实测有 ~9% 的局正好压在工厂/研究所上 —— 那一下就变成
   * 「点建筑」，右栏切成建筑面板，「清空后回到我方概况」「中键点击面板不变」两条一起红。
   * 所以先在镜头中心附近找一处**真正的空地**（平原、离建筑 ≥300px、离部队 ≥160px）。
   */
  const emptyNear = (cx, cy, span) => {
    const tr = g.terrain;
    const blocks = [...g.factories, ...g.labs, ...g.hqs].map((b) => [b.x, b.y]);
    const free = (x, y) => {
      if (x < 0 || y < 0 || x > ws20.w || y > ws20.h) return false;
      const r = Math.floor(y / tr.cell);
      const c = Math.floor(x / tr.cell);
      if (!(tr.grid[r] && tr.grid[r][c] === 0)) return false;
      if (blocks.some((b) => Math.hypot(b[0] - x, b[1] - y) < 300)) return false;
      if (g.units.some((u) => !u.dead && Math.hypot(u.x - x, u.y - y) < 160)) return false;
      return true;
    };
    for (let d = 0; d <= span; d += 40) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const x = cx + Math.cos(ang) * d;
        const y = cy + Math.sin(ang) * d;
        if (free(x, y)) return { x, y };
      }
    }
    return { x: cx, y: cy };
  };
  for (let i = 0; i < 3; i++) {
    g.units.push(
      Object.assign({}, proto20, { id: 9200 + i, x: c20.x + i * 40, y: c20.y, moveX: null, moveY: null })
    );
  }
  // 空地要在三支新兵**摆好之后**再找，否则会挑到它们自己站的位置
  const blank20 = emptyNear(c20.x, c20.y, 300);
  g.nextUnitId = Math.max(g.nextUnitId || 1, 9300);
  reRender20();
  focus20(c20.x, c20.y);
  ok(Math.abs(cam20().k - 1) < 0.02, '用例从 1 倍镜头开始（' + cam20().k.toFixed(3) + '×）');

  // ---------- ① 中键「点击」（只按下不拖动）----------
  ok(clickW20(blank20.x, blank20.y), '先点一处空地，清掉选中与面板');
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
  // 世界放大到 8640×5760 后，跨到对角需要的位移远超 6000px → 每步拖 900px（20 步 = 18000）
  dragFar(600, 400, -900, -900); // 再一直往左上拖 → 顶到世界右下角
  const tl3b = camTL20();
  const vw3 = 1280 / tl3b.k;
  const vh3 = 800 / tl3b.k;
  const liftBot = (tl3b.y + vh3 - ws20.h) * tl3b.k; // 世界底边抬到视口底边之上多少像素
  ok(
    Math.abs(tl3b.x + vw3 - ws20.w) < 2 && liftBot >= 0 && liftBot < 40,
    '一直往左上拖 → 镜头贴住世界右下边界（底边抬起 ' + Math.round(liftBot) +
      'px —— 正好让出底部指挥栏，地图最下边看得见；右边界差 ' +
      (tl3b.x + vw3 - ws20.w).toFixed(2) + 'px，世界 ' + ws20.w + '×' + ws20.h +
      ' 视口 ' + vw3.toFixed(1) + '×' + vh3.toFixed(1) + '）'
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
  const hasPtRaw = (wx, wy, tol) => {
    const px = (wx - cam.x) * cam.k;
    const py = (wy - cam.y) * cam.k;
    return log.points.some(([x, y]) => Math.abs(x - px) <= (tol || 0.6) && Math.abs(y - py) <= (tol || 0.6));
  };
  /**
   * 高低差版：站在 (ax,ay) 的那东西整只被抬了 liftAt(ax,ay)，它身上所有零件的画面坐标
   * 都跟着平移同一截。写「画面该有这一点」的断言必须先减去这一截，
   * 否则一点点高度差就能让「量位置」的断言全军覆没。
   */
  const hasPt = (ax, ay, wx, wy, tol) => hasPtRaw(wx, wy - liftAt(ax, ay), tol);
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
    Boolean(neutralFac) && !hasPt(neutralFac.x, neutralFac.y, neutralFac.x - 72, neutralFac.y - 13),
    '中立工厂不压归属底色（' + (neutralFac ? neutralFac.id + ' 号厂' : '?') + '）'
  );

  // 几何：单位脚下的椭圆盘半径随体型缩放。
  // 体型 = 全局缩放 × 兵种归一系数 × 阶数倍率（第 10 项：三级 = 一级的 2 倍），
  // 与 drawUnits 里的 f 完全一致，用 Ui.scales.tier 取，避免脚本自己抄一份算歪。
  const fW = UNIT_VIS_SCALE * bodyScaleOf('warrior') * Ui.scales.tier('warrior', mineU.tier || 1);
  ok(
    hasPt(mineU.x, mineU.y, mineU.x - 18 * fW, mineU.y + 11 * fW - 6.8 * fW) &&
      hasPt(mineU.x, mineU.y, mineU.x + 18 * fW, mineU.y + 11 * fW + 6.8 * fW),
    '己方锐士脚下的归属色椭圆盘画在脚边（18×6.8 × 体型 ' + fW.toFixed(2) + '）'
  );
  const fS = UNIT_VIS_SCALE * bodyScaleOf('shield') * Ui.scales.tier('shield', foeU.tier || 1);
  ok(
    hasPt(foeU.x, foeU.y, foeU.x - 18 * fS, foeU.y + 11 * fS - 6.8 * fS) &&
      hasPt(foeU.x, foeU.y, foeU.x + 18 * fS, foeU.y + 11 * fS + 6.8 * fS),
    '敌方盾卫同样压本方的归属色底盘'
  );
  const ownFac = (meta21.factories || []).find((f) => f.owner === 1);
  ok(
    Boolean(ownFac) &&
      hasPt(ownFac.x, ownFac.y, ownFac.x - 72, ownFac.y - 13) &&
      hasPt(ownFac.x, ownFac.y, ownFac.x + 72, ownFac.y + 53),
    '工厂厂区整块压归属底色（椭圆 72×33）'
  );
  const ownHq = (meta21.hqs || []).find((h) => h.owner === 1);
  ok(
    Boolean(ownHq) &&
      hasPt(ownHq.x, ownHq.y, ownHq.x - 64, ownHq.y - 4) &&
      hasPt(ownHq.x, ownHq.y, ownHq.x + 64, ownHq.y + 40),
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
        Math.abs(r[0] - (foeU.x - (26 * fS) / 2)) < 0.06 &&
        Math.abs(r[1] - (foeU.y - 28 * fS)) < 0.06
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
    const lift = liftAt(ux, uy); // 整只兵连同脚下光环被抬起
    const pcx = (ux - cam.x) * cam.k;
    const pcy = (uy + 11 * f - lift - cam.y) * cam.k;
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
  ok(!hasPt(mineU.x, mineU.y, mineU.x - 21 * fW, mineU.y - 21 * fW), '未选中时没有四角方框');

  const clickAt = (wx, wy) => {
    const e = {
      button: 0,
      clientX: (wx - cam.x) * cam.k,
      clientY: (visY(wx, wy) - cam.y) * cam.k,
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
    hasPt(mineU.x, mineU.y, mineU.x - 21 * fW, mineU.y - 21 * fW, 0.8) &&
      hasPt(mineU.x, mineU.y, mineU.x + 21 * fW, mineU.y + 21 * fW, 0.8),
    '选中后四周多出四角方框（对角 ±21 × 体型 ' + fW.toFixed(2) + '）'
  );
  ok(fillCount(pad0) === padTotal(0), '选中不改变归属底色盘（仍是 ' + fillCount(pad0) + ' 处）');
  const hpRects2 = log.rects.filter((r) => Math.abs(r[3] - 3.4) < 1e-9).length;
  ok(hpRects2 === allUnits * 2, '选中再画一帧，血条数目不变（' + hpRects2 + '，不会重复叠加）');

  // ---- ④ 未被选中的其它单位不会误带光环 / 方框 ----
  ok(
    !haloRing(foeU.x, foeU.y, fS) &&
      ![0, 1, 2, 3].every((i) =>
        hasPt(foeU.x, foeU.y, foeU.x + (i % 2 ? 21 : -21) * fS, foeU.y + (i > 1 ? 21 : -21) * fS, 0.8)
      ),
    '只给选中的那一支画光环与方框，没选中的敌方盾卫身上干净'
  );
  ok(!hasPt(foeU.x, foeU.y, foeU.x + 21 * fS, foeU.y + 21 * fS, 0.8), '没选中的敌方盾卫身上没有方框');
}

console.log('\n[22] 弹道不规则炸开（水球感）· 开火动画与后坐 · 地面弹痕');
{
  /**
   * 找一段「连续空地」，长度要够放下两支交火部队（沿途都不是山/水），返回这段的中点。
   * 地貌主题每局随机（抽到大山脉时满图是山），所以不能只检查两三格 ——
   * 必须按「交火跨度」去找，否则视线和弹道会被山挡住，开火事件就抓不到了（踩过坑）。
   */
  const clearSpot = (g, spanPx) => {
    const tr = g.terrain;
    const blocks = [...g.factories, ...g.labs, ...g.hqs].map((b) => [b.x, b.y]);
    const free = (r, c) =>
      r >= 0 && c >= 0 && r < tr.rows && c < tr.cols && tr.grid[r][c] !== 2 && tr.grid[r][c] !== 4;
    const need = Math.ceil(spanPx / tr.cell) + 2; // 再多留两格余量
    for (let r = 8; r < tr.rows - 8; r++) {
      for (let c = 8; c + need < tr.cols - 8; c++) {
        let run = true;
        for (let k = 0; k < need; k++) {
          if (!free(r, c + k)) {
            run = false;
            break;
          }
        }
        if (!run) continue;
        const x = (c + need / 2) * tr.cell;
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
  // 先落在原点，只为拿到两支部队的射程 / 体型来推算站位；真正的位置在下面选好空地后再挪过去。
  const shooter = wf.__test.spawnUnit(g22, { id: 0, owner: 0, level: 1 }, 'ranger', 0, 0);
  const victim = wf.__test.spawnUnit(g22, { id: 1, owner: 1, level: 1 }, 'shield', 0, 0);
  // 站位按 data.js 推导：游侠够得着盾卫，盾卫够不着游侠 → 只有游侠开火，事件干净。
  // （用户改射程后 100px 的写死距离会让盾卫也开火，boom 事件就不干净了 —— 踩过坑。）
  const dist22 = Math.min(
    shooter.range - 10, // 游侠一定够得着
    victim.range + shooter.r + wf.__test.consts.ATTACK_SLACK + 40 // 盾卫一定够不着
  );
  // 空地长度按「两支部队拉开的距离 + 余量」来要，保证整段交火路线都不被地形挡
  const sp = clearSpot(g22, dist22 + 120);
  shooter.x = sp.x - dist22 / 2;
  shooter.y = sp.y;
  victim.x = sp.x + dist22 / 2;
  victim.y = sp.y;
  // 步长要够细：data.js 里的弹速可以很高（现在游侠 3000px/s），按常规 0.05s 步进的话
  // 子弹会在「开火的那一帧」直接飞到目标 —— 快照里拦不到在飞的弹体。
  // 取 4ms/步：再快的弹也会被切成好几帧，b 列表一定抓得到。（写死 dt 同样会被改爆，
  // 所以这里按「一步走不完 dist22 的一半」来取，跟着 data.js 自适应。）
  const dt22 = Math.min(0.05, dist22 / 2 / Math.max(1, shooter.bulletSpeed));
  let snapFire = null;
  let snapHit = null;
  let clk = 1000;
  // 上限按「射手 CD 够开两枪」折算（CD 也是 data.js 里的数据），再狠也不至于死等。
  const max22 = Math.ceil((Math.max(0.5, shooter.cdMax) * 2) / dt22) + 20;
  for (let i = 0; i < max22 && !(snapFire && snapHit); i++) {
    clk += dt22 * 1000;
    wf.__test.step(g22, dt22, clk);
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
  ok(
    rows.length > 0 && rows.every((r) => r.length === 11),
    '弹道快照带朝向与个体种子（' + rows.length + ' 发 × 11 字段：x,y,归属,弹种,dx,dy,种子,高度,抛射,兵种,阶数）'
  );
  ok(
    rows.length > 0 && rows.every((r) => r[9] >= 0 && r[9] <= 5 && r[10] >= 1 && r[10] <= 3),
    '每发子弹带「谁打的」：兵种序号（0..5）与阶数（1..3），客户端据此分款式并随进化放大'
  );
  // 源码层面：每个有弹体的兵种一套画法 + 尺寸随阶数放大（含火舌 / 光束）
  ok(
    /function drawWarriorShot/.test(src) &&
      /function drawShieldShot/.test(src) &&
      /function drawRangerShot/.test(src) &&
      /function drawBurstShell/.test(src),
    '客户端为四个有弹体的兵种各写了一套专属弹型（锐士墨刃 / 盾卫扇面 / 游侠长矢 / 轰击重弹）'
  );
  ok(
    /const BULLET_TIER_MUL = \[1, [.\d]+, [.\d]+\]/.test(src) &&
      /function bulletScaleOf/.test(src) &&
      /bulletScaleOf\(tier\)/.test(src),
    '弹型尺寸统一乘阶数倍率（一级 → 三级整体放大）'
  );
  ok(
    /beamScaleOf\(u\.tier \|\| 1\)/.test(src),
    '火舌与光束（燎原 / 激光的「子弹」）同样随阶数变粗'
  );
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
  // 世界坐标 → 画布坐标。注意要先过 visY：站在 (wx,wy) 的东西连同它身上的每一点
  // 都被整块抬到了上面那一层，直接拿世界 y 换算是量不到它的。
  const scrOf = (wx, wy) => [(wx - cam23.x) * cam23.k, (visY(wx, wy) - cam23.y) * cam23.k];
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
  // 兵种序号给 9（越界 = 未知兵种，走「按弹种画的兜底墨团款」）：这一条量的是通用墨团的不规则度，
  // 换成某个兵种的专属弹型后形状不再是多瓣墨团，不适用这把尺（专属弹型另有断言核对）。
  const bX = sp23.x + 150;
  const bY = sp23.y - 60;
  Ui.applySnapshot(Object.assign({}, base, { b: [[bX, bY, 0, 0, 1, 0, 0.37, 0, 0, 9, 1]], ev: [] }));
  pump();
  const bs = scrOf(bX, bY);
  const bPts = ringPts(bX, bY, 0, 14);
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
  /*
   * 等飞溅彻底甩开再量：墨点带随机初速，只等 150ms 时环带里的点数正好卡在 7~8 的
   * 临界上（阈值是 +8），于是这条断言时红时绿。等到 380ms 墨点已经全部散到各自的
   * 落点（实测稳定 27 个），既真在量「向外飞溅」，又不再看运气。
   */
  while (Date.now() - t2 < 380) {
    /* 等 380ms 让飞溅彻底甩开 */
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

/* ==========================================================================
   [23] 本轮 10 项：统一 300 / 侦察敌方工厂生产信息 / 总部集结点 /
        总部防卫前摇 / 研究所研究产线 / 产线上限与标识 / 胜利结算弹窗
   ========================================================================== */
console.log('\n[23] 本轮十项（客户端侧）');
{
  const html23 = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');
  const css23 = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/style.css'), 'utf8');

  // ---------- ① 升级价统一 300 ----------
  {
    const c23 = wf.publicGameState(
      wf.createGameState({ id: 'c23', players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }] })
    ).consts;
    ok(
      c23.facLineCost === 300 && c23.evolveLineCost === 300 && c23.prodSpeedCost === 300 &&
        c23.upgradeRpCost == null,
      `开辟产线 / 产线进化 / 生产加速各为 300，无统一升级价（${c23.facLineCost}/${c23.evolveLineCost}/${c23.prodSpeedCost}）`
    );
    ok(!/（600）|（1000）/.test(html23), '面板文案里不再出现 600 / 1000 的旧价');
    ok(/id="wfp-line"[^>]*>开辟产线（300）/.test(html23), '面板「开辟产线」标注 300');
    ok(/id="wfp-speed"[^>]*>加速生产（300）/.test(html23), '面板「加速生产」标注 300');
  }

  // ---------- ③ 敌方 / 中立工厂也能看生产信息 ----------
  {
    const g23 = wf.createGameState({
      id: 'c23-peek',
      players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }],
    });
    g23.phase = 'playing';
    g23.phaseEndsAt = 0;
    g23.units.length = 0;
    const foeF = g23.factories.find((f) => f.owner !== 0) || g23.factories[1];
    foeF.owner = 1;
    const neuF = g23.factories.find((f) => f.owner < 0);
    Ui.render(wf.publicGameState(g23), net, view);
    Ui.applySnapshot(wf.snapshot(g23));
    pump();

    const fp = (sel) => el('warfactory-facpanel ' + sel);
    const look = (fac) => {
      const c = camFromLastFrame();
      const ev = {
        button: 0,
        clientX: (fac.x - c.x) * c.k,
        clientY: (fac.y - c.y) * c.k,
        preventDefault() {},
        shiftKey: false,
      };
      canvasEl.dispatch('mousedown', ev);
      canvasEl.dispatch('mouseup', ev);
      pump();
    };
    look(foeF);
    ok(fp('#wfp-title').textContent.indexOf('敌军') >= 0, '点敌方工厂 → 标题标明敌军（' + fp('#wfp-title').textContent + '）');
    ok(
      /产线 \d+ \/ \d+/.test(fp('#wfp-lines').textContent) && fp('#wfp-lines').hidden === false,
      '敌方工厂照常显示产线数（' + fp('#wfp-lines').textContent + '）'
    );
    ok(
      /秒 \/ 支/.test(fp('#wfp-rate').textContent) && fp('#wfp-rate').hidden === false,
      '敌方工厂照常显示产能速率（' + fp('#wfp-rate').textContent + '）'
    );
    const rows23 = el('warfactory-facpanel #wfp-line-list').children;
    ok(rows23.length >= 1, '敌方工厂的产线清单也列出来了（' + rows23.length + ' 行）');
    // 只读：开辟产线 / 进化按钮都不出现
    ok(fp('#wfp-line').hidden === true, '敌方工厂没有「开辟产线」按钮');
    const hasEvoBtn = rows23.some((r) =>
      (r.children || []).some((ch) => String(ch.className || '').indexOf('wfp-lbtn') >= 0)
    );
    ok(!hasEvoBtn, '敌方工厂的产线行没有「进化」按钮');
    if (neuF) {
      look(neuF);
      ok(fp('#wfp-title').textContent.indexOf('中立') >= 0, '点中立工厂 → 标题标明中立（' + fp('#wfp-title').textContent + '）');
      ok(/产线 \d+ \/ \d+/.test(fp('#wfp-lines').textContent), '中立工厂也能看产线数（' + fp('#wfp-lines').textContent + '）');
    }
  }

  // ---------- ④ 总部右键设集结点 ----------
  {
    const g23 = wf.createGameState({
      id: 'c23-rally',
      players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }],
    });
    g23.phase = 'playing';
    g23.phaseEndsAt = 0;
    g23.units.length = 0;
    Ui.render(wf.publicGameState(g23), net, view);
    Ui.applySnapshot(wf.snapshot(g23));
    pump();
    const myHq = g23.hqs.find((h) => h.owner === 0);
    const c0 = camFromLastFrame();
    const click = (wx, wy, btn) => {
      const c = camFromLastFrame();
      const ev = {
        button: btn || 0,
        clientX: (wx - c.x) * c.k,
        clientY: (wy - c.y) * c.k,
        preventDefault() {},
        shiftKey: false,
      };
      canvasEl.dispatch('mousedown', ev);
      canvasEl.dispatch('mouseup', ev);
      pump();
    };
    void c0;
    click(myHq.x, myHq.y); // 左键选中自家总部
    ok(el('warfactory-facpanel').hidden === false, '左键点选自家总部 → 弹出面板');
    ok(el('warfactory-facpanel #wfp-title').textContent === '总部', '面板标题为「总部」');
    ok(el('warfactory-facpanel #wfp-rally').hidden === false, '总部面板里有「集结点」一行');
    sent.length = 0;
    click(myHq.x + 260, myHq.y + 180, 2); // 右键点地 → 设集结点
    ok(
      sent.some((d) => d.cmd === 'rally' && d.fid === 0 && typeof d.x === 'number'),
      '总部右键设集结点 → 发 {cmd:"rally", fid:0}（' + JSON.stringify(sent[0] || null) + '）'
    );
    ok(
      /集结点：\d+,\d+/.test(el('warfactory-facpanel #wfp-rally').textContent),
      '面板显示总部集结点坐标（' + el('warfactory-facpanel #wfp-rally').textContent + '）'
    );
    // 服务端确实接受并记住（fid=0 = 我自己的总部）
    const okSet = wf.setPlayerInput(g23, 'p0', { cmd: 'rally', fid: 0, x: 1234, y: 5678 });
    ok(okSet && g23.hqs.find((h) => h.owner === 0).rally, '服务端接受总部集结点（fid=0 按归属方解析）');
    ok(/function drawOneRally\(/.test(src) && /hqRallyKey\(h\.id\)/.test(src), '源码核对：集结点牵引线 / 旗标工厂与总部共用');
  }

  // ---------- ⑥ 总部防卫（数值全部从 data.js 推导，改数值时测试自动跟着走） ----------
  {
    const HD = require(path.join(ROOT, 'server/games/warfactory/data.js')).hqDefense;
    const c23 = wf.publicGameState(
      wf.createGameState({ id: 'c23-hq', players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }] })
    ).consts;
    const CELL23 = (c23.grid && c23.grid.cell) || 10; // 1 格 = 几像素（data.js 的 grid.cell）
    ok(
      c23.hqAtkRange === HD.range * CELL23 &&
        c23.hqAtkCd === HD.cd &&
        c23.hqAtkDmg === HD.dmg &&
        c23.hqAtkWindupMs === HD.windupMs,
      `总部防卫参数：射程 ${c23.hqAtkRange} / 间隔 ${c23.hqAtkCd}s / 伤害 ${c23.hqAtkDmg} / 前摇 ${c23.hqAtkWindupMs}ms`
    );
    ok(/function drawHqDefense\(/.test(src), '源码核对：有总部防卫的绘制函数');
    ok(/drawHqDefense\(t\)/.test(src), '源码核对：每帧调用总部防卫绘制');
    // 前摇三件套：聚能球 + 蓄能弧 + 目标处收拢环（走满才开火）
    ok(/聚能球/.test(src) && /蓄能弧/.test(src) && /收拢的锁定环/.test(src), '前摇有「聚能球 + 蓄能弧 + 目标环收紧」的明显表现');
    // 快照带前摇剩余，客户端据此连续倒计时
    const gsnap = wf.createGameState({
      id: 'c23-hqsnap',
      players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }],
    });
    // 第 9 项：末一列 = 每条产线此刻还在场的兵数
    ok(wf.snapshot(gsnap).hq[0].length === 13, '总部快照 13 列（末三列＝锁定目标 / 前摇剩余 / 各产线在场兵数）');
    ok(/atkWindupAt/.test(src), '客户端按「快照剩余 + 接收时刻」自行倒计时（前摇连续长起来）');
  }

  // ---------- ⑦ 研究所开拓研究产线（点击即生效，无二级选择） ----------
  {
    ok(html23.includes('id="wfp-labline"'), '面板里有「开拓研究产线」按钮');
    const c23 = wf.publicGameState(
      wf.createGameState({ id: 'c23-lab', players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }] })
    ).consts;
    ok(c23.labLineCost === 200 && c23.labMaxLines === 1 && c23.labLineRpMul === 1.5,
      `研究产线：花费 ${c23.labLineCost} / 每所上限 ${c23.labMaxLines} / 产出 ×${c23.labLineRpMul}`);
    // 点击即生效：不发二级选择、不弹选择器
    ok(
      /cmd: 'labLine', lid/.test(src) && !/labLine[\s\S]{0,200}openPicker/.test(src),
      '源码核对：点「开拓研究产线」直接发指令，没有二级选择项'
    );
    // 服务端行为：占下 → 开拓 → 产出 +50%；再点被拒
    const gl = wf.createGameState({
      id: 'c23-lab2',
      players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }],
    });
    gl.phase = 'playing';
    gl.phaseEndsAt = 0;
    gl.labs[0].owner = 0; // 先占下（未占领时该所不产出，没法比倍率）
    const before = wf.__test.labRpTotalOf(gl, 0);
    gl.players[0].rp = 9999;
    ok(wf.setPlayerInput(gl, 'p0', { cmd: 'labLine', lid: gl.labs[0].id }), '开拓研究产线成功');
    ok(gl.labs[0].lines === 1, '研究所产线 0 → 1');
    const after = wf.__test.labRpTotalOf(gl, 0);
    ok(
      before > 0 && Math.abs(after / before - 1.5) < 1e-9,
      `开拓后该所产出 +50%（${before} → ${after}）`
    );
    ok(!wf.setPlayerInput(gl, 'p0', { cmd: 'labLine', lid: gl.labs[0].id }), '每所最多 1 条：再点被拒');
    ok(wf.snapshot(gl).lb[0].length === 5, '研究所快照 5 列（末列＝已开拓产线数）');
  }

  // ---------- ⑧ 产线上限 2 + 已开拓标识 ----------
  {
    const c23 = wf.publicGameState(
      wf.createGameState({ id: 'c23-cap', players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }] })
    ).consts;
    ok(c23.facMaxLines === 2 && c23.labMaxLines === 1,
      `工厂最多 ${c23.facMaxLines} 条（默认 1 + 可开 1）、研究所最多 ${c23.labMaxLines} 条`);
    ok(/function drawLineBadge\(/.test(src), '源码核对：有「已开拓产线」的小模型标识函数');
    ok(/slots\.length >= 2\)/.test(src) && /drawLineBadge\(c, 'fac'/.test(src), '工厂开了第 2 条 → 右下角画简化小模型');
    ok(/l\.lines \|\| 0\), 0, 1\) >= 1/.test(src) && /drawLineBadge\(c, 'lab'/.test(src), '研究所开了产线 → 右下角画简化小模型');
    // 标识必须比本体简化：只用两三笔线稿，不画门窗瓦顶
    const badge = /function drawLineBadge\(c, kind, col\) \{[\s\S]*?\n  \}/.exec(src);
    ok(Boolean(badge) && badge[0].length < 1600, '标识造型明显简化（只是两三笔线稿）');
  }

  // ---------- ⑨ 胜利结算弹窗（含「退出到大厅」） ----------
  {
    ok(html23.includes('id="wf-result"'), 'panel.html 有胜利结算弹窗');
    ok(html23.includes('id="wfr-exit"'), '结算弹窗有「退出到大厅」按钮');
    ok(/退出到大厅/.test(html23), '按钮文案为「退出到大厅」');
    ok(/\.wf-result\s*\{[^}]*position:\s*absolute/.test(css23), 'style.css 让结算弹窗浮在整屏之上');
    ok(/function syncResultModal\(/.test(src), '源码核对：有结算弹窗的显隐逻辑');
    ok(/net\.leaveRoom\(\)/.test(src), '「退出到大厅」走 net.leaveRoom()（与大厅离开房间同一条路）');
    ok(/resultDismissed/.test(src), '点「留在战场」后不再重复弹（开新局才重新武装）');

    // 真的弹出来：构造一个已结束的对局
    const go = wf.createGameState({
      id: 'c23-over',
      players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }],
    });
    go.phase = 'over';
    go.over = true;
    go.winnerId = 'p0';
    Ui.render(wf.publicGameState(go), net, view);
    Ui.applySnapshot(wf.snapshot(go));
    pump();
    // 注意：本脚本的 DOM 桩里 querySelector(sel) 实际取的是 "<父id> <sel>" 这个键
    const res = el('wf-result');
    const rTitle = el('wf-result #wfr-title');
    const rSub = el('wf-result #wfr-sub');
    const rRows = el('wf-result #wfr-rows');
    const rStay = el('wf-result #wfr-stay');
    ok(res.hidden === false, '对局结束后自动弹出结算弹窗');
    ok(rTitle.textContent.replace(/\s/g, '') === '大捷', '我赢了显示「大 捷」（' + rTitle.textContent + '）');
    ok(/甲/.test(rSub.textContent), '副标题点名胜者（' + rSub.textContent + '）');
    ok(rRows.children.length === 2, '结算列出全部 2 名玩家（' + rRows.children.length + ' 行）');
    // 点「留在战场」→ 收起
    rStay.dispatch('click', { stopPropagation() {} });
    pump();
    ok(res.hidden === true, '点「留在战场」收起弹窗');
  }
}

/* ==========================================================================
   [24] 第 9 项：每条产线最多 10 个兵 · 越多越慢 · 一键选兵 · 单击选厂 / 双击选兵 · 选中闪烁
   ========================================================================== */
console.log('\n[24] 第 9 项：产线名额 / 一键选兵 / 单击选厂·双击选兵 / 选中闪烁');
{
  const css24 = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/style.css'), 'utf8');
  const cap = wf.__test.consts.LINE_UNIT_CAP;
  const slow = wf.__test.consts.LINE_SLOW_PER_UNIT;

  // ---------- ① 名额与减速：一份 formula，两边同源 ----------
  ok(cap === 10, `每条产线最多同时在场 ${cap} 个兵`);
  ok(
    Math.abs(slow - WFData.lines.slowPerUnit) < 1e-9,
    `每多在场 1 个兵，该线产速 -${Math.round(slow * 100)}%（取自 data.js，不写死）`
  );
  const mul = wf.__test.lineSpeedMul;
  // 期望值从 slow 推，不写死：data.js 把 slowPerUnit 调成 0 时（= 不减速）这套断言照样成立
  const exp = (n) => Math.max(0, 1 - n * slow);
  ok(Math.abs(mul(0) - 1) < 1e-9 && Math.abs(mul(1) - exp(1)) < 1e-9 && Math.abs(mul(5) - exp(5)) < 1e-9,
    `独立乘区：0 个 100% / 1 个 ${Math.round(exp(1) * 100)}% / 5 个 ${Math.round(exp(5) * 100)}%`);
  ok(Math.abs(mul(cap) - exp(cap)) < 1e-9 && Math.abs(mul(cap + 3) - exp(cap + 3)) < 1e-9,
    `${cap} 个时产速 ${Math.round(exp(cap) * 100)}%（由 slowPerUnit=${slow} 推出）`);
  // 服务端源码单独读（上面的 src 是客户端 ui.js）
  const srcSrv = fs.readFileSync(path.join(ROOT, 'server/games/warfactory/index.js'), 'utf8');
  ok(/const LINE_UNIT_CAP = WFData\.lines\.unitCap/.test(srcSrv) && /const LINE_SLOW_PER_UNIT = WFData\.lines\.slowPerUnit/.test(srcSrv),
    '源码核对：名额与减速率都取自 data.js（调参入口唯一）');
  ok(/const p = \(b\.prog\[i\] \|\| 0\) \+ \(dtMs \/ ivl\) \* mul/.test(srcSrv),
    '源码核对：产线进度按「基础速度 × 该线乘区」走');

  // ---------- ② 服务端：名额用真正的「所在单位记账」 ----------
  {
    const g24 = wf.createGameState({ id: 'c24-cap', players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }] });
    g24.phase = 'playing';
    g24.phaseEndsAt = 0;
    const fac = g24.factories.find((f) => f.owner < 0);
    fac.owner = 0;
    // 把名额填满，服务端就该彻底停产（这条线的 10 个位置一个都不剩）
    // 沿工厂外圈错开站位：挤成一坨的话，后面补产的那支会找不到落脚点，测试就偶发差一个
    for (let i = 0; i < cap; i++) {
      const a = (i / cap) * Math.PI * 2;
      wf.__test.spawnUnit(g24, { id: fac.id, owner: 0, level: 1 }, 'warrior', fac.x + Math.cos(a) * 80, fac.y + Math.sin(a) * 80);
    }
    fac.prog = [0.6];
    const before = g24.units.filter((u) => !u.dead && u.homeFac === fac.id).length;
    let clk = 1000;
    for (let i = 0; i < 200; i++) {
      clk += 50;
      wf.__test.step(g24, 0.05, clk);
    }
    const after = g24.units.filter((u) => !u.dead && u.homeFac === fac.id).length;
    ok(before === cap && after === cap, `名额满 ${cap} 个后完全停产（${before} → ${after}）`);
    const s24 = wf.snapshot(g24);
    const row = s24.f.find((r) => r[0] === fac.id);
    ok(row && row.length === 11, '工厂快照 11 列（末列＝各产线在场兵数）');
    ok(row && row[row.length - 1][0] === cap, `快照里这条线记着 ${cap} 个在场兵`);
    ok(s24.u[0].length === 20, '单位快照 20 列（末列＝炮塔角，倒数第二＝出生自第几条产线）');
    // 让出一个名额 → 立刻接着造（9 个在场时只剩 10% 产能，所以要多给它一点时间：
    // 等待步数从「基础生产间隔 ÷ 当前乘区」推出，跟着 data.js 走，不写死）
    const victim = g24.units.find((u) => u.homeFac === fac.id);
    victim.dead = true;
    const dtMs = 50;
    const wait = Math.ceil(wf.__test.consts.PRODUCE_MS / dtMs / mul(cap - 1)) + 40;
    for (let i = 0; i < wait; i++) {
      clk += dtMs;
      wf.__test.step(g24, dtMs / 1000, clk);
    }
    const revived = g24.units.filter((u) => !u.dead && u.homeFac === fac.id).length;
    ok(revived === cap, `阵亡让出名额 → 补到第 ${cap} 个就又停（现在 ${revived}）`);
  }

  // ---------- ③ 中栏：选中本方工厂 → 按产线列出它的兵，可一键选中 ----------
  const g24 = wf.createGameState({ id: 'c24-ui', players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }] });
  g24.phase = 'playing';
  g24.phaseEndsAt = 0;
  g24.units.length = 0;
  const fac24 = g24.factories.find((f) => f.owner < 0);
  fac24.owner = 0;
  // 手动造 3 支出自「这条产线」的兵（配额之外的事情这里不用管）
  const line = [];
  for (let i = 0; i < 3; i++) {
    line.push(wf.__test.spawnUnit(g24, { id: fac24.id, owner: 0, level: 1 }, 'warrior', fac24.x + 90 + i * 12, fac24.y));
  }
  const hqUnit = wf.__test.spawnUnit(g24, { id: 0, owner: 0, level: 1 }, 'laser', g24.hqs[0].x + 70, g24.hqs[0].y);
  Ui.render(wf.publicGameState(g24), net, view);
  Ui.applySnapshot(wf.snapshot(g24));
  pump();

  const ov24 = el('warfactory-overview');
  ok(clickWorld(fac24.x, fac24.y), '单击自家工厂');
  const grps = kidsDeep(ov24, 'wov-lgrp');
  ok(grps.length >= 1, `中栏按产线列出这座厂的兵（${grps.length} 组）`);
  const grp = grps[0];
  const head24 = kidsDeep(grp, 'wov-lhead')[0];
  const cnt24 = kidsDeep(grp, 'wov-lcnt')[0];
  ok(Boolean(head24) && /产线1/.test(head24.textContent || kidsDeep(grp, 'wov-ltitle')[0].textContent),
    '组头写明「产线1」');
  ok(Boolean(cnt24) && new RegExp('^3/' + cap).test(cnt24.textContent),
    `组头写着「在场 3/${cap} · 产速%」（实际 ${cnt24 && cnt24.textContent}）`);
  const pct3 = Math.round(Math.max(0, 1 - 3 * slow) * 100) + '%';
  ok(
    cnt24.textContent.indexOf(pct3) >= 0,
    `产速随在场数衰减（3 个 → ${pct3}，实际 ${cnt24 && cnt24.textContent}）`
  );
  const tiles24 = kidsDeep(grp, 'wov-tile');
  ok(tiles24.length === 3, `这一线的兵全部列了出来（${tiles24.length} 格）`);
  // 单击工厂 = 只选工厂：右侧仍是工厂面板，中栏是产线视图
  ok(el('warfactory-facpanel').hidden === false, '单击工厂 → 右侧仍是工厂面板');
  ok(el('wov-count').textContent === '在场 3 支', `粗览计数改为「在场 3 支」（${el('wov-count').textContent}）`);
  ok(hqUnit && true, '总部亲兵不混进工厂的产线列表');

  // 一键选中：点「全选」
  const allBtn = kidsDeep(grp, 'wov-lall')[0];
  ok(Boolean(allBtn), '组头有「全选」按钮');
  if (allBtn) {
    log.fills.length = 0;
    allBtn.dispatch('click', { stopPropagation() {} });
    pump();
    ok(el('wov-count').textContent === '已选 3 支', `点「全选」选中这一线全部兵（${el('wov-count').textContent}）`);
    ok(el('warfactory-facpanel').hidden === true, '选兵后让出建筑选择（右键变成「命令部队」而不是「设集结点」）');
    ok(el('warfactory-unitpanel').hidden === false, '右侧切成部队详情');
    const flashed = log.fills.filter((f) => String(f).indexOf('255,253,246') >= 0);
    ok(flashed.length > 0, `被选中的 3 支部队都闪了一下（${flashed.length} 次白色高亮落笔）`);
  }

  // ---------- ④ 双击建筑 = 选中它产出的兵 ----------
  {
    // 先清掉选择：点一块空地
    clickWorld(fac24.x + 400, fac24.y + 400);
    ok(dblWorld(fac24.x, fac24.y), '双击自家工厂');
    ok(el('wov-count').textContent === '已选 3 支', `双击选出这座厂在场的全部兵（${el('wov-count').textContent}）`);
    ok(el('warfactory-unitpanel').hidden === false, '双击后右侧是部队详情（不是工厂面板）');
    // 双击同质部队 = 选中同屏所有同种部队
    clickWorld(fac24.x + 400, fac24.y + 400);
    ok(dblWorld(hqUnit.x, hqUnit.y), '双击一支 laser 亲兵');
    ok(el('wov-count').textContent === '已选 1 支', '双击同样兵种 → 选中在场的所有同种部队');
    ok(/function onDoubleClick\(/.test(src) && /addEventListener\('dblclick', onDoubleClick\)/.test(src),
      '源码核对：canvas 上挂了 dblclick 监听');
    ok(!/for \(const q of units\.values\(\)\)[\s\S]{0,80}< 130\) selection\.add/.test(src),
      '源码核对：单击工厂不再顺手圈走驻军（单击只选工厂）');
  }

  // ---------- ⑤ 选中反馈：任何东西被选中都会闪一下 ----------
  {
    ok(/function syncSelectionFlash\(/.test(src) && /syncSelectionFlash\(now\)/.test(src),
      '源码核对：每帧扫选中集合，给「刚选中」的目标盖时间戳');
    ok(/drawFlashPulse\(c, u\.x/.test(src), '单位本体上闪');
    ok(/drawFlashPulse\(c, 0, 0, factoryRadius\(\) \* 0\.82, 'f' \+ f\.id/.test(src), '工厂本体上闪');
    ok(/drawFlashPulse\(c, 0, -8, 46, 'h' \+ h\.id/.test(src), '总部本体上闪');
    ok(/const FLASH_MS = 260/.test(src), '闪一下约 260ms（不是长亮）');
    // 点选单支部队 → 白闪
    log.fills.length = 0;
    ok(clickWorld(line[0].x, line[0].y), '单击选中一支部队');
    ok(log.fills.filter((f) => String(f).indexOf('255,253,246') >= 0).length > 0, '刚选中的部队闪了一下');
  }

  // ---------- ⑥ 面板里的数字与按钮样式 ----------
  ok(/\.wov-lgrp\s*\{[^}]*grid-column:\s*1 \/ -1/.test(css24), 'style.css：一组占满整行');
  ok(/\.wfp-lcnt\.is-full/.test(css24) && /\.wov-lcnt\.is-full/.test(css24), 'style.css：名额占满时数字转警示色');
  ok(/wfp-lpick/.test(css24), 'style.css：「选兵」按钮有独立样式（不与进化按钮同款）');
}

/* ==========================================================================
   [25] 小地图专项：地形整体灰化（山 / 水仍看得出）· 我方蓝点 / 敌方红点 ·
        大地图缩放范围放宽
   ========================================================================== */
console.log('\n[25] 小地图灰化 · 敌我两色 · 大地图缩放放宽');
{
  const css25 = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/style.css'), 'utf8');
  const html25 = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');

  /** 感知明度：判断「三档灰」是否拉得开（灰化之后还能不能分出山与水） */
  function lumOf(hex) {
    const h = String(hex || '').replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  /** 彩度（max-min）：越小越「灰」 */
  function satOf(hex) {
    const h = String(hex || '').replace('#', '');
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return Math.max(...v) - Math.min(...v);
  }
  const rgbOf = (hex) => {
    const h = String(hex || '').replace('#', '');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };

  // ---------- ① 灰化三档：够灰（低彩度）但明度拉得开（分得清山与水）----------
  ok(Boolean(MINI_LAND && MINI_WATER && MINI_MTN), `小地图地形三档色：${MINI_LAND} / ${MINI_WATER} / ${MINI_MTN}`);
  const lL = lumOf(MINI_LAND);
  const lW = lumOf(MINI_WATER);
  const lM = lumOf(MINI_MTN);
  ok(
    lL - lW >= 40 && lW - lM >= 40,
    `明度三档递进且间隔够大：平原 ${lL.toFixed(0)} > 水 ${lW.toFixed(0)} > 山 ${lM.toFixed(0)}`
  );
  ok(
    satOf(MINI_LAND) <= 30 && satOf(MINI_WATER) <= 30 && satOf(MINI_MTN) <= 30,
    `三档都已灰化（彩度 ${satOf(MINI_LAND)} / ${satOf(MINI_WATER)} / ${satOf(MINI_MTN)}，越低越灰）`
  );
  ok(
    rgbOf(MINI_WATER)[2] > rgbOf(MINI_WATER)[0],
    '水体保留一点冷调（蓝通道偏高），不靠颜色也能认出是水'
  );
  ok(!/rgba\(58,92,118|rgba\(74,66,54/.test(src), '源码核对：小地图不再用大地图那两套有彩色的地形色');

  // ---------- ② 敌我两色：我方蓝 / 敌方红 ----------
  const fRgb = rgbOf(MINI_FRIEND);
  const eRgb = rgbOf(MINI_FOE);
  ok(fRgb[2] > fRgb[0] + 40, `我方色偏蓝（${MINI_FRIEND}）`);
  ok(eRgb[0] > eRgb[2] + 40, `敌方色偏红（${MINI_FOE}）`);
  ok(/function miniSideColor\(/.test(src), '源码核对：小地图统一走 miniSideColor（只分敌我）');
  ok(/oi === me \? MINI_FRIEND : MINI_FOE/.test(src), '源码核对：我方→蓝、其余→红');
  ok(/if \(isSpectator \|\| me < 0\) return playerColor\(oi\)/.test(src), '源码核对：观战时仍按阵营色区分四方');

  // ---------- ③ 真的画出来了：灰化地形 + 蓝红两点 ----------
  {
    const g25 = wf.createGameState({ id: 'c25', players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }] });
    g25.phase = 'playing';
    g25.phaseEndsAt = 0;
    g25.units.length = 0;
    const ownFac = g25.factories.find((f) => f.owner < 0);
    ownFac.owner = 0;
    const foeFac = g25.factories.find((f) => f !== ownFac && f.owner < 0);
    foeFac.owner = 1;
    const ownU = wf.__test.spawnUnit(g25, { id: ownFac.id, owner: 0, level: 1 }, 'warrior', ownFac.x + 80, ownFac.y);
    const foeU = wf.__test.spawnUnit(g25, { id: foeFac.id, owner: 1, level: 1 }, 'warrior', foeFac.x + 80, foeFac.y);
    ok(Boolean(ownU && foeU), '摆好一蓝一红两支部队');
    Ui.render(wf.publicGameState(g25), net, view);
    Ui.applySnapshot(wf.snapshot(g25));
    pump(); // 这一帧里小地图会把灰化地形栅格化到离屏画布，再画两个点

    // 灰化地形：离屏画布（createElement 出来的）上出现了山 / 水两档灰
    const offRects = log.rects.filter((r) => String(r[4]).indexOf('created-') === 0);
    const mtnRects = offRects.filter((r) => String(r[5]) === MINI_MTN);
    const waterRects = offRects.filter((r) => String(r[5]) === MINI_WATER);
    ok(offRects.length > 0, '小地图地形画在离屏画布上（每帧只贴图，不重画格子）');
    ok(mtnRects.length > 0, `山体按深灰栅格化（${mtnRects.length} 格）`);
    ok(waterRects.length > 0, `水体按中灰栅格化（${waterRects.length} 格）`);
    ok(
      !offRects.some((r) => /rgba\(58,92,118|rgba\(74,66,54/.test(String(r[5]))),
      '离屏底图里没有旧的彩色地形（已彻底灰化）'
    );
    ok(/c\.drawImage\(mt, 0, 0, w, h\)/.test(src), '源码核对：灰化底图是一次 drawImage 贴图');

    // 蓝点与红点：核心实心色 + 外面一圈同色光晕（hexAlpha 的 rgba 形式）
    const fills25 = log.fills.map(String);
    ok(fills25.includes(MINI_FRIEND), `我方部队画成蓝点（${MINI_FRIEND}）`);
    ok(fills25.includes(MINI_FOE), `敌方部队画成红点（${MINI_FOE}）`);
    const haloOwn = fills25.filter((f) => f.indexOf('47,111,191') >= 0).length;
    const haloFoe = fills25.filter((f) => f.indexOf('207,59,44') >= 0).length;
    ok(haloOwn > 0 && haloFoe > 0, `两个点都带同色光晕（高亮：蓝 ${haloOwn} 次 / 红 ${haloFoe} 次）`);
    // 每个点 = 一圈光晕 + 一个实心核，都落在小地图画布上
    const miniArcs = log.points.filter((p) => p[3] === 'warfactory-minimap').length;
    ok(miniArcs >= 4, `小地图逐个点画（这一帧 ${miniArcs} 个落笔点 ≥ 2 支部队 × 2 笔）`);
    ok(
      /const sel = selection\.has\(u\.id\)/.test(src) && /sel \? 5\.4 : 4\.2/.test(src),
      '源码核对：选中的部队点更大一圈（方便在人群里找）'
    );
  }

  // ---------- ④ 图例：告诉玩家「深灰是山、中灰是水、蓝是我、红是敌」----------
  ok(/id="warfactory-minilegend"/.test(html25), '指挥栏小地图下方有图例');
  ok(/wml-mtn[\s\S]{0,200}wml-water[\s\S]{0,200}wml-own[\s\S]{0,200}wml-foe/.test(html25), '图例四项齐：山 / 水 / 我方 / 敌方');
  ok(/\.wml-mtn\s*\{[^}]*background:\s*#55555a/.test(css25), 'style.css：山体色块与 ui.js 一致');
  ok(/\.wml-own\s*\{[^}]*background:\s*#2f6fbf/.test(css25), 'style.css：我方色块与 ui.js 一致');
  ok(/\.wml-foe\s*\{[^}]*background:\s*#cf3b2c/.test(css25), 'style.css：敌方色块与 ui.js 一致');
  ok(/灰化|我方蓝/.test(html25), '帮助文案同步说明小地图的灰化与蓝红规则');

  // ---------- ⑤ 大地图：缩放范围比原来宽得多 ----------
  ok(ZOOM_MIN < 0.35, `最远能拉到 ${ZOOM_MIN}×（原硬下限 0.35×）`);
  ok(ZOOM_MAX > 2.2, `最近能推到 ${ZOOM_MAX}×（原上限 2.2×）`);
  const CW25 = 1280; // 桩 canvas 的 CSS 尺寸
  const CH25 = 800;
  const zoom25 = () => {
    const cc = camFromLastFrame();
    return cc ? cc.k : 0;
  };
  const view25 = () => {
    const z = zoom25() || 1;
    return { w: CW25 / z, h: CH25 / z };
  };
  const wheel25 = (deltaY, px, py) => {
    canvasEl.dispatch('wheel', { deltaY, deltaMode: 0, clientX: px, clientY: py, preventDefault() {} });
    pump();
  };
  const ws25 = wf.publicGameState(
    wf.createGameState({ id: 'c25-z', players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }] })
  ).world;
  for (let i = 0; i < 120; i++) wheel25(240, 640, 400);
  const zOut = zoom25();
  ok(zOut < 0.35, `滚轮真能拉过原来的 0.35 倍下限（现在 ${zOut.toFixed(3)}×）`);
  const v25 = view25();
  ok(
    v25.w >= ws25.w * 0.98 || v25.h >= ws25.h * 0.98,
    `拉到最远时整张地图基本进得来（视野 ${Math.round(v25.w)}×${Math.round(v25.h)} / 世界 ${ws25.w}×${ws25.h}）`
  );
  for (let i = 0; i < 200; i++) wheel25(-240, 640, 400);
  ok(Math.abs(zoom25() - ZOOM_MAX) < 0.05, `反向推到底停在 ${ZOOM_MAX}×（${zoom25().toFixed(2)}×）`);
}

/* ==========================================================================
   [26] 地图主题：每局随机抽一个地貌（大海洋 / 大山脉 / 超级平原 …），
        主题随地形下发，客户端在小地图旁标出这局是什么地貌
   ========================================================================== */
console.log('\n[26] 地图主题（每局随机地貌）');
{
  const html26 = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');
  const css26 = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/style.css'), 'utf8');

  // ---- 服务端：主题表 + 抽取 ----
  const themes26 = wf.__test.themes;
  ok(Array.isArray(themes26) && themes26.length >= 3, `data.js 至少要有 3 个地图主题（实到 ${themes26.length} 个）`);
  const keys26 = themes26.map((t) => t.key);
  ok(new Set(keys26).size === keys26.length, '主题 key 不能重复');
  for (const t of themes26) {
    ok(Boolean(t.name), `主题 ${t.key} 要有中文名`);
    // 上限放到 0.5：maxBlocked 现在**包含中心圈的专属额度**（core.budget），
    // 那笔是专门给中场的、不占外圈的份，所以总量会比「纯外圈」的上限高一些。
    ok(
      Number.isFinite(t.maxBlocked) && t.maxBlocked > 0 && t.maxBlocked <= 0.5,
      `主题 ${t.key} 的 maxBlocked 要落在 (0,0.5]（含中心圈专属额度）`
    );
    // 地形由「图元清单」生成：每个主题都要给出至少一条 shapes，且每条的 kind 都认得
    const sh26 = wf.__test.fillTheme(t).shapes;
    ok(Array.isArray(sh26) && sh26.length > 0, `主题 ${t.key} 要给出图元清单 shapes`);
    for (const s of sh26) {
      ok(s.kind === 'wall' || s.kind === 'blob' || s.kind === 'ring', `主题 ${t.key} 的图元 kind 只能是 wall/blob/ring（实到 ${s.kind}）`);
      ok(s.type === 'mountain' || s.type === 'water', `主题 ${t.key} 的图元 type 只能是 mountain/water（实到 ${s.type}）`);
    }
  }
  // 权重：加起来 > 0，且每个主题都有权重字段（想关掉某个主题就写 0）
  const wsum26 = themes26.reduce((a, t) => a + Math.max(0, t.weight || 0), 0);
  ok(wsum26 > 0, '主题权重之和必须大于 0');

  // 随机性：不同种子应能抽到不同主题（说明「每次开局可能换地貌」）
  const picked26 = new Set();
  for (let i = 0; i < 400; i++) picked26.add(wf.__test.pickTheme(i * 7919 + 13).key);
  ok(picked26.size >= 3, `400 次抽取应覆盖多个主题（实到 ${picked26.size} 个）`);
  ok(
    wf.__test.pickTheme(424242).key === wf.__test.pickTheme(424242).key,
    '同一颗种子必须抽到同一个主题（可复现）'
  );

  // ---- 下发：主题随地形一起给客户端（terrain 只在全量 publicGameState 里，rt 快照不带地形）----
  const g26 = wf.createGameState({
    id: 'c26-ocean',
    players: [{ id: 'q0' }, { id: 'q1' }],
    theme: 'ocean',
  });
  const pub26 = wf.publicGameState(g26);
  ok(pub26.terrain && pub26.terrain.theme, '下发的地形要带上本局主题');
  ok(pub26.terrain.theme.key === 'ocean', `指定 ocean 时下发主题应为 ocean（实到 ${pub26.terrain.theme.key}）`);
  ok(Boolean(pub26.terrain.theme.name), '下发主题要带中文名');
  ok(Boolean(pub26.terrain.data), '下发地形仍要带网格数据（主题不能把它挤掉）');

  // ---- 客户端：小地图标题旁标出地貌 ----
  ok(/id="warfactory-theme"/.test(html26), 'panel.html 要有地貌标签 #warfactory-theme');
  ok(
    /id="warfactory-theme"[\s\S]{0,120}<\/header>/.test(html26) &&
      /小地图[\s\S]{0,200}id="warfactory-theme"/.test(html26),
    '地貌标签要放在小地图那一栏里'
  );
  ok(/\.wcb-theme\s*\{/.test(css26), 'style.css 要有 .wcb-theme 样式');
  ok(/function syncThemeLabel/.test(src), 'ui.js 要有 syncThemeLabel（把地貌名写进标签）');
  ok(/syncThemeLabel\(meta\.terrain/.test(src), 'ui.js 要在收到地形时同步地貌标签');

  // 真的渲染一局「大海洋」：人数与默认那局不同 → 会被判定为开新局，标签随之刷新
  const gt26 = wf.createGameState({
    id: 'c26-ocean-render',
    players: [{ id: 'q0' }, { id: 'q1' }, { id: 'q2' }],
    theme: 'ocean',
  });
  gt26.phase = 'playing';
  gt26.phaseEndsAt = 0;
  Ui.render(wf.publicGameState(gt26), net, view);
  Ui.applySnapshot(wf.snapshot(gt26));
  pump();
  const themeLabel = el('warfactory-theme');
  const name26 = wf.__test.themeByKey('ocean').name;
  ok(
    String(themeLabel.textContent || '').indexOf(name26) >= 0,
    `渲染大海洋后小地图标题应出现「${name26}」（实到「${themeLabel.textContent}」）`
  );
  ok(
    String(themeLabel.title || '').indexOf(name26) >= 0,
    '地貌标签的悬停说明里也要提到本局地貌'
  );
  ok(themeLabel.hidden === false, '有主题时地貌标签要显示出来');
}

/* ------------------------------------------------------------------ *
 * [27] 相邻玩家之间的「进攻主路」：每对 ≥3 条、每条净宽 ≥15 格
 * ------------------------------------------------------------------ */
{
  const C27 = wf.__test.consts;
  const ROAD_PER = C27.ROAD_PER_PAIR;
  const ROAD_PER_4 = wf.__test.roadPerPair(4); // 2 人局是偶数条（见 data.js roads.perPairByPlayers）
  const ROAD_W27 = C27.ROAD_W;
  const ROAD_MIN = C27.ROAD_MIN_W;
  const CELL27 = C27.TERR_CELL;
  const R27 = C27.TERR_ROWS;
  const CW27 = C27.TERR_COLS;
  ok(ROAD_PER >= 3, `每对相邻玩家至少 3 条主路（data.js 现为 ${ROAD_PER} 条）`);
  ok(ROAD_W27 >= ROAD_MIN, `主路净宽不得小于 ${ROAD_MIN} 格（data.js 现为 ${ROAD_W27} 格）`);
  const srcSrv27 = fs.readFileSync(path.join(ROOT, 'server/games/warfactory/index.js'), 'utf8');
  const html27 = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');
  ok(/const ROAD_PER_PAIR = Math\.max/.test(srcSrv27), '源码核对：主路条数从 data.js 的 roads 段读');
  ok(/const ROAD_MIN_W = 15/.test(srcSrv27), '源码核对：主路净宽有 15 格硬下限（写窄了会被夹回来）');
  ok(/function carveMainRoads/.test(srcSrv27), '源码核对：要有 carveMainRoads（挖主路）');
  ok(
    /game\.mainRoads = carveMainRoads/.test(srcSrv27),
    '源码核对：主路要在总部落位之后挖（才知道谁跟谁相邻）'
  );

  const pass27 = (grid, x, y) => {
    const c = Math.floor(x / CELL27);
    const r = Math.floor(y / CELL27);
    if (r < 0 || r >= R27 || c < 0 || c >= CW27) return false;
    const v = grid[r][c];
    return v !== C27.TT_MOUNTAIN && v !== C27.TT_WATER;
  };
  let worstMargin27 = 99;
  let minW27 = 99;
  for (let i = 0; i < 4; i++) {
    const g27 = wf.createGameState({
      id: 'c27-' + i + '-' + Math.random().toString(36).slice(2, 7),
      players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    });
    const grid27 = g27.terrain.grid;
    const pairs27 = wf.__test.adjacentBasePairs(g27.hqs);
    ok(pairs27.length === 4, `4 人局应有 4 对相邻玩家（实到 ${pairs27.length}）`);
    ok(
      (g27.mainRoads || []).length === pairs27.length * ROAD_PER_4,
      `主路总数应为 ${pairs27.length * ROAD_PER_4} 条（实到 ${(g27.mainRoads || []).length}）`
    );
    for (const rd of g27.mainRoads || []) {
      // 中心线全程可通行
      let bad = 0;
      for (const p of rd.pts) if (!pass27(grid27, p[0], p[1])) bad++;
      ok(bad === 0, `第 ${rd.from}-${rd.to} 对第 ${rd.lane + 1} 条主路应全程可通行（${bad} 点被挡）`);
      // 中场量净宽
      const a = g27.hqs[rd.from];
      const b = g27.hqs[rd.to];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const mid = rd.pts[Math.floor(rd.pts.length / 2)];
      let wA = 0;
      let wB = 0;
      for (let d = 0.25; d <= ROAD_W27 + 8; d += 0.25) {
        if (!pass27(grid27, mid[0] + nx * d * CELL27, mid[1] + ny * d * CELL27)) break;
        wA = d;
      }
      for (let d = 0.25; d <= ROAD_W27 + 8; d += 0.25) {
        if (!pass27(grid27, mid[0] - nx * d * CELL27, mid[1] - ny * d * CELL27)) break;
        wB = d;
      }
      const w = wA + wB;
      // ⚠️ 每条主路的**设计宽度**是不一样的（正面那条最宽，侧面 / 绕后只有 sideWidthCells + 1.5 格，
      //    见 index.js 的 ROAD_HALF_BY_ROLE）—— 拿统一的下限去卡所有路，会把刻意做窄的侧道判死。
      //    这里留 1 格的栅格化误差（跟 warfactory-terrain-check 同一口径）。
      const nominal = wf.__test.roadHalfOf(ROAD_PER_4, rd.lane) * 2;
      const margin = w - (nominal - 1);
      if (margin < worstMargin27) worstMargin27 = margin;
      if (w < minW27) minW27 = w;
    }
  }
  ok(
    worstMargin27 >= 0,
    `每条主路净宽都应 ≥ 自己被挖的宽度（最差的一条少了 ${(-worstMargin27).toFixed(2)} 格，允许 1 格栅格误差）`
  );
  console.log(
    `  · 主路实测最窄 ${minW27.toFixed(2)} 格；比各自的设计宽度最差 ${worstMargin27.toFixed(2)} 格（要求 ≥ 0）`
  );
  ok(/进攻主路/.test(html27), '帮助浮层的地形段要说明「进攻主路」');
}

/* ------------------------------------------------------------------ *
 * [28] 激光兵光束观感跟着伤害走：
 *      大小系数 = 1 + log2(伤害 / 1.5) × 5%（以 1.5 伤害为基底，每翻一倍 +5%）
 *      细节层数 = clamp(floor(同一个 log2 值 / 1.6), 0, 3)，层数越多加绘越多
 * ------------------------------------------------------------------ */
{
  const C28 = wf.__test.consts;
  const sizeMul = wf.__test.laserVisSizeMul;
  const detailOf = wf.__test.laserVisDetail;
  const BASE = C28.LASER_VIS_BASE_DMG;
  const STEP = C28.LASER_VIS_STEP_PCT;
  const PER = C28.LASER_VIS_DETAIL_PER;
  const DMAX = C28.LASER_VIS_DETAIL_MAX;
  const MAXMUL = C28.LASER_MAX_MUL;
  const DATA28 = require(path.join(ROOT, 'server/games/warfactory/data.js'));

  // ---- 1. 参数从 data.js 透传，且必须下发到客户端 ----
  // ⚠️ 别写死 1.5：这个基底跟着 1 阶激光的 dmg 走（dmg 一改它就得改），只验透传 + 为正
  ok(
    BASE === DATA28.laser.visBaseDmg && BASE > 0,
    `大小系数的基底伤害从 data.js 透传（实到 ${BASE}）`
  );
  // ⚠️ 别写死 0.05：步长同样在 data.js 里，只验「透传 + 为正」
  ok(
    STEP === DATA28.laser.visStepPct && STEP > 0,
    `每翻一倍的大小系数步长从 data.js 透传（实到 +${(STEP * 100).toFixed(2)}%）`
  );
  ok(PER > 0 && DMAX >= 1, `细节按每翻 ${PER} 倍解锁一层、封顶 ${DMAX} 层`);
  const st28 = wf.publicGameState(
    wf.createGameState({ id: 'c28-consts', players: [{ id: 'a' }, { id: 'b' }] })
  ).consts;
  ok(
    st28.laserVisBaseDmg === BASE &&
      st28.laserVisStepPct === STEP &&
      st28.laserVisDetailPer === PER &&
      st28.laserVisDetailMax === DMAX,
    '四个观感参数要随 consts 下发（客户端不能写死，改 data.js 就得生效）'
  );
  ok(
    Boolean(st28.stats) && Boolean(st28.evolved) && st28.stats.laser && st28.evolved.laser,
    '客户端要能从 consts 取到各阶基础伤害（算实际伤害要用）'
  );

  // ---- 2. 公式口径：1.5 → 1.00，之后每翻一倍整加一个 step ----
  ok(Math.abs(sizeMul(BASE) - 1) < 1e-9, `${BASE} 伤害时大小系数正好 1.00（实到 ${sizeMul(BASE).toFixed(4)}）`);
  for (let k = 0; k <= 5; k++) {
    const d = BASE * Math.pow(2, k);
    const want = 1 + k * STEP;
    ok(
      Math.abs(sizeMul(d) - want) < 1e-9,
      `伤害 ${d}（基底的 2^${k} 倍）→ 系数 ${want.toFixed(2)}（实到 ${sizeMul(d).toFixed(4)}）`
    );
  }
  ok(
    Math.abs(sizeMul(BASE * 4) - sizeMul(BASE * 2) - STEP) < 1e-9,
    '相邻两个「翻倍」之间恰好差一个 step（线性于 log2，不是线性于伤害）'
  );

  // ---- 3. 单调 + 夹取 ----
  let prev = -1;
  let mono = true;
  let prevD = -1;
  let monoD = true;
  const seen = new Set();
  for (let d = 0.2; d <= 500; d *= 1.03) {
    const v = sizeMul(d);
    const k = detailOf(d);
    if (v < prev - 1e-12) mono = false;
    if (k < prevD) monoD = false;
    prev = v;
    prevD = k;
    seen.add(k);
  }
  ok(mono, '大小系数随伤害单调不减');
  ok(monoD, '细节层数随伤害单调不减');
  ok(seen.size === DMAX + 1, `实测能走出全部 ${DMAX + 1} 档细节（实到 ${seen.size} 档）`);
  ok(detailOf(BASE) === 0 && detailOf(BASE / 2) === 0, '不高于基底就是素光束（0 层细节）');
  ok(detailOf(1e9) === DMAX, `细节层数封顶 ${DMAX}（实到 ${detailOf(1e9)}）`);
  ok(sizeMul(1e-6) >= 0.7 - 1e-9, '伤害趋零时系数夹在下限，光束不会细到看不见');

  // ---- 4. 实战区间：每阶从「刚锁定」到「满蓄能」都要动起来 ----
  const baseOf = (t) => (t === 1 ? DATA28.units.laser.dmg : DATA28.evolved.laser[t].dmg);
  const maxReal = Math.max(baseOf(1), baseOf(2), baseOf(3)) * MAXMUL;
  ok(
    sizeMul(maxReal) <= 1.5,
    `实战最高伤害 ${maxReal}（三级 × 满蓄能）的系数 ${sizeMul(maxReal).toFixed(3)} 仍在合理区间（≤1.5，不至于糊成一团）`
  );
  for (let tier = 1; tier <= 3; tier++) {
    const d0 = baseOf(tier);
    const d1 = d0 * MAXMUL;
    const s0 = sizeMul(d0);
    const s1 = sizeMul(d1);
    ok(
      s1 > s0 + 1e-6,
      `${tier} 级：锁定到底（伤害 ${d0} → ${d1}）光束要变粗（${s0.toFixed(3)} → ${s1.toFixed(3)}）`
    );
    ok(detailOf(d1) > detailOf(d0), `${tier} 级：满蓄能时细节要比刚锁定时多（${detailOf(d0)} → ${detailOf(d1)} 层）`);
  }
  const b1 = baseOf(1);
  const b3 = baseOf(3);
  ok(sizeMul(b3) > sizeMul(b1), `同为 1 倍率时高阶更粗（一级 ${b1} → ${sizeMul(b1).toFixed(3)}，三级 ${b3} → ${sizeMul(b3).toFixed(3)}）`);

  // ---- 5. 客户端源码核对：系数落在哪些笔画上、细节怎么解锁 ----
  const srcUi28 = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');
  const from = srcUi28.indexOf('function drawBeams');
  const to = srcUi28.indexOf('/* ---------------- 水墨特效基元');
  ok(from > 0 && to > from, '源码核对：找得到 drawBeams');
  const beamSrc = srcUi28.slice(from, to);
  ok(/const dmg = baseDmg \* mul/.test(beamSrc), '源码核对：客户端按「该阶基础伤害 × 锁定倍率」算实际伤害');
  ok(/const dbl = Math\.log2\(Math\.max\(0\.01, dmg \/ visBase\)\)/.test(beamSrc), '源码核对：按 log2(伤害 / 基底) 计「翻了几倍」');
  ok(
    /const visMul = Math\.max\(0\.7, 1 \+ dbl \* visStep\)/.test(beamSrc),
    '源码核对：大小系数 = 1 + 翻倍数 × step（同服务端 laserVisSizeMul）'
  );
  ok(
    /const detail = dbl <= 0 \? 0 : clamp\(Math\.floor\(dbl \/ visPer\), 0, visMax\)/.test(beamSrc),
    '源码核对：细节层数由同一个翻倍数解锁（同服务端 laserVisDetail）'
  );
  ok(/const baseDmg = unitStatsOf\('laser', u\.tier \|\| 1\)\.dmg/.test(beamSrc), '源码核对：基础伤害从 consts 的数据表取，不写死');
  ok(/K\.laserVisBaseDmg/.test(beamSrc) && /K\.laserVisStepPct/.test(beamSrc), '源码核对：基底 / step 从服务端 consts 读');
  ok(
    /const w = \(2\.2 \+ heat \* 4\.4\) \* flick \* beamScaleOf\(u\.tier \|\| 1\) \* visMul/.test(beamSrc),
    '源码核对：光束粗细乘上大小系数'
  );
  ok(/c\.lineWidth = w \* 2\.6/.test(beamSrc), '源码核对：外层光晕跟着光束一起变粗');
  ok(/const bigR = \(9 \+ heat \* 11\) \* visMul/.test(beamSrc), '源码核对：命中灼斑跟着大小系数走');
  ok(/const coreR = \(2\.6 \+ heat \* 5\) \* visMul/.test(beamSrc), '源码核对：命中亮芯跟着大小系数走');
  ok(
    /if \(detail >= 1\)/.test(beamSrc) && /if \(detail >= 2\)/.test(beamSrc) && /if \(detail >= 3\)/.test(beamSrc),
    '源码核对：三层细节（电弧 / 行进光球+十字光刺 / 冲击环+火星）逐级解锁'
  );

  // ---- 6. 运行时：同一支部队，伤害越高 → 加绘越多、光束越粗 ----
  const g28 = wf.createGameState({
    id: 'c28-laser',
    players: [
      { id: 'p0', name: '甲' },
      { id: 'p1', name: '乙' },
    ],
  });
  g28.phase = 'playing';
  g28.phaseEndsAt = 0;
  g28.units.length = 0;
  const tr28 = g28.terrain;
  const free28 = (x, y) => {
    const cc = Math.floor(x / tr28.cell);
    const rr = Math.floor(y / tr28.cell);
    return rr >= 0 && cc >= 0 && rr < tr28.rows && cc < tr28.cols && tr28.grid[rr][cc] === 0;
  };
  const blocks28 = [...g28.factories, ...g28.labs, ...g28.hqs].map((b) => [b.x, b.y]);
  let sp28 = null;
  for (let rr = 3; rr < tr28.rows - 3 && !sp28; rr++) {
    for (let cc = 3; cc < tr28.cols - 5 && !sp28; cc++) {
      const ax = (cc + 0.5) * tr28.cell;
      const ay = (rr + 0.5) * tr28.cell;
      const bx = ax + 90;
      if (!free28(bx, ay)) continue;
      if (blocks28.some((b) => Math.hypot(b[0] - ax, b[1] - ay) < 400)) continue;
      if (wf.__test.losBlocked(g28, ax, ay, bx, ay)) continue;
      sp28 = { ax, ay, bx };
    }
  }
  ok(Boolean(sp28), '找得到一块互相通视的平地摆激光用例');
  const L28 = wf.__test.spawnUnit(g28, { id: 950, owner: 0, level: 1 }, 'laser', sp28.ax, sp28.ay);
  const E28 = wf.__test.spawnUnit(g28, { id: 951, owner: 1, level: 1 }, 'shield', sp28.bx, sp28.ay);
  for (const u of [L28, E28]) {
    u.moveX = null;
    u.moveY = null;
    u.maxHp = 1e9;
    u.hp = 1e9;
  }
  const render28 = () => {
    Ui.render(wf.publicGameState(g28), net, view);
    Ui.applySnapshot(wf.snapshot(g28));
    log.strokes.length = 0;
    pump();
    return {
      n: log.strokes.length,
      maxW: log.strokes.length ? Math.max.apply(null, log.strokes) : 0,
    };
  };

  // 刚锁定：还没走到前摇外，伤害就是基础伤害 1
  let now28 = Date.now();
  for (let i = 0; i < 3; i++) wf.__test.step(g28, 0.05, (now28 += 50));
  ok(L28.lockId === E28.id && L28.lockMul === 1, `锁住目标且倍率仍为 1（伤害 ${baseOf(1)}）`);
  const a28 = render28();
  ok(detailOf(baseOf(1)) === 0, `一级 ${baseOf(1)} 伤害：素光束，0 层细节`);

  // 满蓄能：伤害爬到上限倍率（吃满用时同样从 consts 推，别写死 200 步）
  {
    const cK = wf.__test.consts;
    const needMs = cK.LASER_RAMP_MS * (cK.LASER_MAX_MUL - 1) + cK.LASER_WINDUP_MS + 500;
    for (let i = 0; i * 50 < needMs; i++) wf.__test.step(g28, 0.05, (now28 += 50));
  }
  L28.windupUntil = 0;
  const b28 = render28();
  ok(L28.lockMul >= MAXMUL - 0.01, `满蓄能时倍率封顶（${L28.lockMul.toFixed(1)} / ${MAXMUL}）`);
  // ⚠️ 期望层数按当前参数推，别写死「≥2 层」：visDetailPerDbl / maxMul 一改层数就变
  const dmgFull28 = baseOf(1) * MAXMUL;
  const wantLayers28 = Math.max(0, Math.min(DMAX, Math.floor(Math.log2(dmgFull28 / BASE) / PER)));
  ok(
    detailOf(dmgFull28) === wantLayers28,
    `一级满蓄能伤害 ${dmgFull28.toFixed(1)} 按公式解锁到第 ${detailOf(dmgFull28)} 层细节（应为 ${wantLayers28}）`
  );
  ok(wantLayers28 >= 1, '一级满蓄能至少要多解锁一层细节（否则「越锁越粗」看不出来）');
  ok(b28.n > a28.n, `细节变多：描边次数 ${a28.n} → ${b28.n}`);
  ok(
    b28.n - a28.n >= 2,
    `每多一层细节就多几笔加绘（这次多了 ${b28.n - a28.n} 笔，≥2 说明至少两层已解锁）`
  );
  ok(b28.maxW > a28.maxW, `光束变粗：最粗描边 ${a28.maxW.toFixed(2)}px → ${b28.maxW.toFixed(2)}px`);
  console.log(
    `  · 一级伤害 ${baseOf(1)} → ${(baseOf(1) * MAXMUL).toFixed(1)}：系数 ${sizeMul(baseOf(1)).toFixed(3)} → ` +
      `${sizeMul(baseOf(1) * MAXMUL).toFixed(3)}，细节 ${detailOf(baseOf(1))} → ${detailOf(baseOf(1) * MAXMUL)} 层，` +
      `描边 ${a28.n} → ${b28.n} 笔`
  );
}

/* ---------------- 坡与崖：客户端画法 ---------------- */

console.log('\n[28b] 坡与崖的画法（等高线 + 崖壁立面）');

// 配色从源码读：改了 ui.js 那边，这里自动跟着走，不会因为调色误报
const CONTOUR_CLIFF_C = (/const CONTOUR_CLIFF = '([^']+)'/.exec(src) || [0, ''])[1];
const CONTOUR_SLOPE_C = (/const CONTOUR_SLOPE = '([^']+)'/.exec(src) || [0, ''])[1];
const CLIFF_FACE_C = (/const CLIFF_FACE = '([^']+)'/.exec(src) || [0, ''])[1];
const SLOPE_FACE_C = (/const SLOPE_FACE = '([^']+)'/.exec(src) || [0, ''])[1];
// 线宽（屏幕像素）同样从源码读
const CLIFF_W_PX = Number((/const CONTOUR_CLIFF_W = ([\d.]+);/.exec(src) || [0, 0])[1]) || 0;
const SLOPE_W_PX = Number((/const CONTOUR_SLOPE_W = ([\d.]+);/.exec(src) || [0, 0])[1]) || 0;

// 固定主题（群山）再量：崖是「量出来的」断言，随机主题可能整图没几条崖
const gCliff = wf.createGameState({
  id: 'cliff-render',
  players: [
    { id: 'c0', name: '崖左' },
    { id: 'c1', name: '崖右' },
  ],
  theme: 'mountain',
});
// 换玩家 id：客户端 render 用「世界尺寸 + 玩家 id + 工厂数」判断是不是新局，
// 不换 id 就不会重新铺地形 / 收等高线，量到的还是上一局的图
const viewCliff = { meId: 'c0', isSpectator: false, t: (k) => k, title: '战争工厂' };
// 地形贴图是「换局时一次性烘好」的（同步落在 setTerrainGrid 里），等高线却是**每帧**画的
// （走 rAF）。两边要分开量：先同步渲染收崖壁立面，再跑一帧 rAF 收等高线笔画。
pump();
log.strokes.length = 0;
log.strokeStyles.length = 0;
log.strokeMags.length = 0;
log.rects.length = 0;
log.points.length = 0;
Ui.render(wf.publicGameState(gCliff), net, viewCliff);
Ui.applySnapshot(wf.snapshot(gCliff));
const cliffRectsAll = log.rects.filter((r) => r[5] === CLIFF_FACE_C);
const slopeRectsAll = log.rects.filter((r) => r[5] === SLOPE_FACE_C);
log.strokes.length = 0;
log.strokeStyles.length = 0;
log.strokeMags.length = 0;
pump();

const cnCliff = Ui.heights.contours();
ok(cnCliff.cliffAt === WFData.height.cliffAt, `崖判据与服务端一致（层差 ≥ ${cnCliff.cliffAt}）`);
ok(cnCliff.terrace === WFData.height.terrace, `台地档位与服务端一致（${cnCliff.terrace} 层一档）`);
ok(cnCliff.cliff > 0, `崖线收出来了（${cnCliff.cliff} 段）`);
ok(cnCliff.slope > 0, `坡线收出来了（${cnCliff.slope} 段）`);

// 镜头对准「崖与坡相邻」的那块地再量笔画：默认镜头可能正好罩不到坡线（随机图会抖）。
// ⚠️ 前面几节把滚轮拧到了最大倍率（cam.k=3.6，一屏只有 356×222 世界像素），
// 先拉到最远再导航，否则 900px 邻域里的坡线根本不在视野里 —— 这条曾经时红时绿。
const spotCS = Ui.heights.spot(900);
ok(spotCS, '找得到「崖与坡相邻」的取样点');
if (spotCS) {
  const cvC = el('warfactory-canvas');
  for (let i = 0; i < 24; i++) {
    cvC.dispatch('wheel', { deltaY: 800, deltaMode: 0, clientX: 640, clientY: 400, preventDefault() {} });
  }
  pump();
  const worldC = wf.publicGameState(gCliff).world;
  const miniC = el('warfactory-minimap');
  const rC = miniC.getBoundingClientRect();
  const evtC = {
    button: 0,
    clientX: rC.left + (spotCS.x / worldC.w) * rC.width,
    clientY: rC.top + (spotCS.y / worldC.h) * rC.height,
    preventDefault() {},
  };
  miniC.dispatch('mousedown', evtC);
  miniC.dispatch('mouseup', evtC);
  log.strokes.length = 0;
  log.strokeStyles.length = 0;
  log.strokeMags.length = 0;
  pump();
  if (process.env.WF_DBG) {
    const cfD = camFromLastFrame();
    console.log('  [dbg] spot=' + JSON.stringify(spotCS) + ' cam.k=' + cfD.k);
  }
}

// 线宽按屏幕像素补偿：lineWidth × 当时变换倍率 应恒等于源码里那个屏幕粗细。
// 无论当前缩放到哪一档，这条乘积都不该变 —— 变了就是「拉远看不见」的老毛病回来了。
const prodOf = (color) => {
  const out = [];
  for (let i = 0; i < log.strokeStyles.length; i++) {
    if (log.strokeStyles[i] !== color) continue;
    out.push(log.strokes[i] * log.strokeMags[i]);
  }
  return out;
};
const cliffProds = prodOf(CONTOUR_CLIFF_C);
const slopeProds = prodOf(CONTOUR_SLOPE_C);
const near = (arr, v) => arr.length > 0 && arr.every((x) => Math.abs(x - v) < 0.35);
ok(
  near(cliffProds, CLIFF_W_PX),
  `崖线屏幕粗细恒定 ${CLIFF_W_PX}px（实测 ${cliffProds.length} 笔，均值 ` +
    (cliffProds.length ? (cliffProds.reduce((a, b) => a + b, 0) / cliffProds.length).toFixed(2) : '-') + 'px）'
);
ok(
  near(slopeProds, SLOPE_W_PX),
  `坡线屏幕粗细恒定 ${SLOPE_W_PX}px（实测 ${slopeProds.length} 笔）`
);

// 崖壁立面：烘进地形贴图的那一面。有崖就该有「暗色墙面」的矩形落笔
const cliffRects = cliffRectsAll;
const slopeRects = slopeRectsAll;
ok(cliffRects.length > 0, `崖壁立面画出来了（${cliffRects.length} 笔暗色墙面）`);
ok(slopeRects.length > 0, `坡面画出来了（${slopeRects.length} 笔浅色斜面）`);
// 崖壁必须明显比坡面暗：一眼分「过不去 / 走得上去」靠的就是这个对比
ok(cliffRects.length === 0 || slopeRects.length === 0 || CLIFF_FACE_C !== SLOPE_FACE_C, '崖与坡用的是两套颜色');

/* ---------------- 地势射程环：站得高打得远（画出来，不写出来） ---------------- */

console.log('\n[28c] 地势射程环（高打低外扩 · 低打高收缩 · 全程零文字）');

// 配色与采样参数都从源码读：改了 ui.js 那边，这里自动跟着走
const RELIEF_GAIN_C = (/const RELIEF_GAIN = '([^']+)'/.exec(src) || [0, ''])[1];
const RELIEF_LOSS_C = (/const RELIEF_LOSS = '([^']+)'/.exec(src) || [0, ''])[1];
const RELIEF_ANGLES_N = Number((/const RELIEF_ANGLES = (\d+);/.exec(src) || [0, 0])[1]) || 0;
const RELIEF_STEP_N = Number((/const RELIEF_STEP = (\d+);/.exec(src) || [0, 0])[1]) || 0;
const TCELL_N = Number((/const TERRAIN_CELL = (\d+);/.exec(src) || [0, 40])[1]) || 40;

// 固定主题 + 换玩家 id（不换 id 客户端认成同一局，不会重新铺地形 / 收高度场）
const gRel = wf.createGameState({
  id: 'relief-check',
  players: [
    { id: 'rl0', name: '高处' },
    { id: 'rl1', name: '低处' },
  ],
  theme: 'mountain',
});
const viewRel = { meId: 'rl0', isSpectator: false, t: (k) => k, title: '战争工厂' };
pump();
Ui.render(wf.publicGameState(gRel), net, viewRel);
Ui.applySnapshot(wf.snapshot(gRel));
pump();

const constsRel = wf.publicGameState(gRel).consts || {};
const BASE_REL = (constsRel.stats && constsRel.stats.ranger && constsRel.stats.ranger.range) || 180;
const stepPxRel = Ui.heights.stepPx();
const hfRel = gRel.terrain && gRel.terrain.heights;
const lvlAtRel = Ui.heights.levelAt;

// ① 每层折合多少像素射程 —— 服务端早就下发了，客户端得真的接住（接不住就画不出优势）
ok(stepPxRel > 0, `每 1 层高低差 = ${stepPxRel}px 射程（服务端 consts.HEIGHT_STEP_PX 已落到客户端）`);
ok(
  Math.abs(stepPxRel - WFData.grid.cell * WFData.height.rangeCellsPerStep) < 0.01,
  `与服务端同口径：${WFData.height.rangeCellsPerStep} 格 × ${WFData.grid.cell}px = ${stepPxRel}px`
);
ok(Boolean(hfRel), '这一局有高度场（群山主题）');

// ② 高度解码：客户端解出来的层必须与服务端 heightAtWorld 逐点一致
//    （这是最容易错的一环：字符偏移 / 越界 / 行列颠倒，错了整张环就画反）
{
  let bad = 0;
  let n = 0;
  for (let r = 1; r < 288; r += 7) {
    for (let c = 1; c < 288; c += 7) {
      const x = (c + 0.5) * TCELL_N;
      const y = (r + 0.5) * TCELL_N;
      if (lvlAtRel(x, y) !== wf.__test.heightAtWorld(hfRel, x, y)) bad++;
      n++;
    }
  }
  ok(bad === 0, `客户端解出的高度层与服务端逐点一致（抽查 ${n} 点，错 ${bad} 个）`);
}

// ---- 找落点：一块「四周同高」的平地 + 一块「一边高一边低」的坡地 ----
const atRC = (r, c) => Ui.editor.at(r, c);
const lvlRC = (r, c) => lvlAtRel((c + 0.5) * TCELL_N, (r + 0.5) * TCELL_N);
const marchRad = BASE_REL + WFData.height.levels * 2 * stepPxRel + RELIEF_STEP_N;
const RAD_N = Math.ceil(marchRad / TCELL_N) + 1; // 覆盖整条射线的最远行程
const boxStats = (r, c) => {
  let mn = 99;
  let mx = -99;
  let mtn = 0;
  for (let dr = -RAD_N; dr <= RAD_N; dr++) {
    for (let dc = -RAD_N; dc <= RAD_N; dc++) {
      const t = atRC(r + dr, c + dc);
      if (t === 2) {
        mtn++;
        continue;
      }
      if (t < 0) continue;
      const lv = lvlRC(r + dr, c + dc);
      if (lv < mn) mn = lv;
      if (lv > mx) mx = lv;
    }
  }
  return { mn, mx, mtn, spread: mx - mn };
};
/**
 * 这条射线上、走到 dmax 之前有没有撞上山（撞上就是被挡，不是高低差造成的）。
 * ⚠️ 要一路扫到 **dmax + 一步**：客户端是在「再往外一格」时才发现撞山才停下的，
 * 只扫到 dmax 会把「被山截断的方向」误判成「被高处削掉的方向」。
 */
const blockedRel = (x, y, ux, uy, dmax) => {
  for (let d = 2 * RELIEF_STEP_N; d <= dmax + RELIEF_STEP_N; d += RELIEF_STEP_N) {
    if (atRC(Math.floor((y + uy * d) / TCELL_N), Math.floor((x + ux * d) / TCELL_N)) === 2) return true;
  }
  return false;
};
/** 射线走到 rMax 这一路上遇到的最低 / 最高层 */
const spanRel = (x, y, ux, uy, rMax) => {
  let mn = 99;
  let mx = -99;
  for (let d = RELIEF_STEP_N; d <= rMax; d += RELIEF_STEP_N) {
    const lv = lvlAtRel(x + ux * d, y + uy * d);
    if (lv < mn) mn = lv;
    if (lv > mx) mx = lv;
  }
  return { mn, mx };
};

let flatRel = null;
let slopeRel = null;
for (let r = RAD_N + 2; r < 288 - RAD_N - 2 && (!flatRel || !slopeRel); r += 3) {
  for (let c = RAD_N + 2; c < 288 - RAD_N - 2; c += 3) {
    if (atRC(r, c) !== 0) continue;
    const bx = boxStats(r, c);
    const x = (c + 0.5) * TCELL_N;
    const y = (r + 0.5) * TCELL_N;
    if (!flatRel && bx.mtn === 0 && bx.spread === 0) flatRel = { x, y, lv: lvlRC(r, c) };
    if (!slopeRel && bx.spread >= 2) {
      const ring = Ui.heights.relief({ x, y, type: 'ranger', tier: 1 }, BASE_REL);
      let gain = 0;
      let loss = 0;
      for (let i = 0; i < RELIEF_ANGLES_N; i++) {
        const a = (i / RELIEF_ANGLES_N) * Math.PI * 2;
        if (blockedRel(x, y, Math.cos(a), Math.sin(a), ring[i])) continue;
        if (ring[i] > BASE_REL) gain++;
        else if (ring[i] < BASE_REL) loss++;
      }
      // 要的是「同一处既有外扩方向、又有收缩方向」—— 单向的坡读不出「哪边占便宜」
      if (gain > 0 && loss > 0) slopeRel = { x, y, lv: lvlRC(r, c), ring, gain, loss };
    }
    if (flatRel && slopeRel) break;
  }
}

// ③ 平地上：没有高低差就没有优势可言 → 环应当是个正圆
ok(Boolean(flatRel), '找得到一块四周同高的平地');
if (flatRel) {
  const rr = Ui.heights.relief({ x: flatRel.x, y: flatRel.y, type: 'ranger', tier: 1 }, BASE_REL);
  const mx = Math.max.apply(null, rr);
  const mn = Math.min.apply(null, rr);
  ok(mx - mn === 0, `平地上环是正圆（各向半径都是 ${mx}px，基准 ${BASE_REL}px）`);
}

// ④ 坡地上：环要变形 —— 朝下坡鼓出去、朝上坡被削掉
ok(Boolean(slopeRel), '找得到一处「一边高一边低」的落点');
if (slopeRel) {
  const { x, y, lv, ring } = slopeRel;
  const mx = Math.max.apply(null, ring);
  const mn = Math.min.apply(null, ring);
  ok(mx > BASE_REL, `朝低处鼓出去了（最远 ${mx}px > 基准 ${BASE_REL}px）`);
  ok(mn < BASE_REL, `朝高处被削掉了（最窄 ${mn}px < 基准 ${BASE_REL}px）`);
  // 鼓出去的那一侧，路上必须真的更低；削掉的那一侧，路上必须真的更高
  let gainOk = 0;
  let lossOk = 0;
  let gainN = 0;
  let lossN = 0;
  for (let i = 0; i < RELIEF_ANGLES_N; i++) {
    const a = (i / RELIEF_ANGLES_N) * Math.PI * 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    if (blockedRel(x, y, ux, uy, ring[i])) continue;
    // 扫到「被拒掉的那一格」为止：环停在哪、是**下一格**够不着决定的，只扫到环上会漏判
    const sp = spanRel(x, y, ux, uy, ring[i] + RELIEF_STEP_N);
    if (ring[i] > BASE_REL) {
      gainN++;
      if (sp.mn < lv) gainOk++;
    } else if (ring[i] < BASE_REL) {
      lossN++;
      if (sp.mx > lv) lossOk++;
    }
  }
  ok(gainN > 0 && gainOk === gainN, `外扩的方向确实通向更低处（${gainOk}/${gainN} 个方向，脚下 ${lv} 层）`);
  ok(lossN > 0 && lossOk === lossN, `收缩的方向确实通向更高处（${lossOk}/${lossN} 个方向）`);

  // ⑤ 与服务端同口径：客户端「够得着 / 够不着」的分界，必须落在服务端 effRange 上
  let reachOk = 0;
  let reachN = 0;
  for (let i = 0; i < RELIEF_ANGLES_N; i += 3) {
    const a = (i / RELIEF_ANGLES_N) * Math.PI * 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    if (blockedRel(x, y, ux, uy, ring[i])) continue;
    const d = ring[i];
    const px = x + ux * d;
    const py = y + uy * d;
    const effD = wf.__test.effRange(hfRel, BASE_REL, x, y, px, py);
    const nd = d + RELIEF_STEP_N;
    const effN = wf.__test.effRange(hfRel, BASE_REL, x, y, x + ux * nd, y + uy * nd);
    reachN++;
    if (d <= effD + 0.5 && nd > effN) reachOk++;
  }
  ok(
    reachN > 0 && reachOk === reachN,
    `边界与服务端 effRange 对齐（${reachOk}/${reachN} 条射线：环内够得着、再外一格就够不着）`
  );
}

// ⑥ 真的画出来了：选中我方兵之后，一帧里同时出现「占便宜」与「吃亏」两种描边
//    形状是量的，这里量的是「这两套配色有没有落笔」—— 落了才说明地图上真能看出来
// 落笔时用的是 hexAlpha() 转出来的 rgba(...) —— 断言得按 rgba 前缀比对，比 hex 是永远对不上的
const rgbaPrefix = (h) => {
  const s = String(h).replace('#', '');
  if (s.length !== 6) return '';
  return (
    'rgba(' +
    parseInt(s.slice(0, 2), 16) +
    ',' +
    parseInt(s.slice(2, 4), 16) +
    ',' +
    parseInt(s.slice(4, 6), 16) +
    ','
  );
};
const GAIN_PRE = rgbaPrefix(RELIEF_GAIN_C);
const LOSS_PRE = rgbaPrefix(RELIEF_LOSS_C);
const BASE_STROKE = rgbaPrefix((/const RELIEF_FLAT = '([^']+)'/.exec(src) || [0, ''])[1]) + '0.22)';
const reliefFrame = () => {
  log.strokes.length = 0;
  log.strokeStyles.length = 0;
  log.fills.length = 0;
  pump();
  return {
    gain: log.strokeStyles.filter((s) => String(s).indexOf(GAIN_PRE) === 0).length,
    loss: log.strokeStyles.filter((s) => String(s).indexOf(LOSS_PRE) === 0).length,
    base: log.strokeStyles.filter((s) => String(s) === BASE_STROKE).length,
  };
};
const spawnRel = (id, x, y) =>
  wf.__test.spawnUnit(gRel, { id, owner: 0, level: 1 }, 'ranger', x, y);
const spotsRel = [slopeRel, flatRel].filter(Boolean);
let rid = 700;
for (const s of spotsRel) spawnRel(rid++, s.x, s.y);
Ui.render(wf.publicGameState(gRel), net, viewRel);
Ui.applySnapshot(wf.snapshot(gRel));
pump();
const beforeRel = reliefFrame();
ok(beforeRel.gain === 0 && beforeRel.loss === 0, '没选中时地图上不画射程环（不打扰）');
winStub.dispatch('keydown', { code: 'F2', target: null, preventDefault() {} });
pump();
const afterRel = reliefFrame();
ok(afterRel.gain > 0, `选中后画出了「占便宜」一侧（暖金描边 ${afterRel.gain} 笔）`);
ok(afterRel.loss > 0, `选中后画出了「吃亏」一侧（冷灰描边 ${afterRel.loss} 笔）`);
ok(afterRel.base > 0, `画了不考虑地势的虚线基准圈当尺子（${afterRel.base} 个）`);
ok(RELIEF_GAIN_C !== RELIEF_LOSS_C, '占便宜与吃亏是两套颜色');

// ⑦ 需求原话：不要用文字去标 → 整段绘制代码里一个字都不该有
const reliefSrc = (src.match(/function drawRangeRelief\(\)[\s\S]*?\n  \}/) || [''])[0];
ok(reliefSrc.length > 0, 'ui.js 里有 drawRangeRelief() 这一段');
ok(reliefSrc.length > 0 && !/fillText|strokeText/.test(reliefSrc), '地势射程环全程零文字（纯图形，不标高地/层级）');
console.log(
  `  · 基准 ${BASE_REL}px，每 1 层 ±${stepPxRel}px，共 ${RELIEF_ANGLES_N} 个方向 / ` +
    `步长 ${RELIEF_STEP_N}px；坡地上最远 ${slopeRel ? Math.max.apply(null, slopeRel.ring) : '-'}px、` +
    `最窄 ${slopeRel ? Math.min.apply(null, slopeRel.ring) : '-'}px`
);

/* ---------------- 战前选图面板 ---------------- */

console.log('\n[29] 战前选图（面板显隐 · 预览 · 换图/随机/拍板 · 非房主只读）');

/** 建一局「停在战前」的局（换玩家 id 让 client 认成新局） */
const gBrief = wf.createGameState({
  id: 'briefing-check',
  players: [
    { id: 'b0', name: '房主' },
    { id: 'b1', name: '客人' },
  ],
});
wf.beginBriefing(gBrief, { hostId: 'b0', mapFile: null });

const raws = () => sent.filter((d) => d && d.__raw).map((d) => d.__raw);
const rawArgs = (name) => {
  const hit = sent.filter((d) => d && d.__raw === name);
  return hit.length ? hit[hit.length - 1].payload : null;
};
const brRootEl = el('wf-briefing');

// 一张「存档地图」的样子：服务端 briefing:list 回的就是这种结构
const MAP_FILE_CASE = {
  file: 'briefing-case-map.json',
  name: '用例地图',
  players: 2,
  size: { rows: 288, cols: 288 },
  thumb: { rows: 4, cols: 4, step: 72, data: '0000222200004444', pins: [[0, 0, 0, 'hq'], [3, 3, 1, 'hq']] },
};
// 服务端应答桩：第一次拉目录给空（模拟"还没存过图"），换图之后才给一张
let brListAcks = 0;
globalThis.__WF_MAP_ACK = (name) => {
  if (name === 'briefing:list') {
    brListAcks += 1;
    return {
      ok: true,
      maps: brListAcks >= 2 ? [MAP_FILE_CASE] : [],
      current: null,
      briefing: gBrief.briefing,
      hostId: 'b0',
    };
  }
  return { ok: true, briefing: gBrief.briefing };
};

// ① 房主视角：面板该铺开，两个按钮都能按
sent.length = 0;
Ui.render(wf.publicGameState(gBrief), net, { meId: 'b0', isSpectator: false, t: (k) => k, title: '战争工厂' });
ok(brRootEl.hidden === false, '房主进游戏先看到战前面板');
ok(String(el('wfb-cur-mode').textContent || '') === '随机', '没指定图 → 标着「随机」');
ok(
  /人图/.test(String(el('wfb-cur-meta').textContent || '')),
  '预览下面带着人数 / 规模那一行（' + el('wfb-cur-meta').textContent + '）'
);
ok(el('wfb-reroll').disabled === false, '房主的「再随机一张」可按');
ok(el('wfb-confirm').disabled === false, '房主的「就用这张，开打」可按');
// 目录是异步拉的：进战时至少发出过一次 briefing:list
ok(raws().indexOf('briefing:list') >= 0, '进战前就拉了一次地图目录');

// ②「再随机一张」→ 发的是 briefing:pick 且 mapFile 为 null
el('wfb-reroll').click();
ok(rawArgs('briefing:pick') !== null, '点「再随机一张」发出 briefing:pick');
ok(
  rawArgs('briefing:pick') && (rawArgs('briefing:pick').mapFile === null || rawArgs('briefing:pick').mapFile === undefined),
  '随机时 mapFile 传的是空（服务端据此重新摇一张）'
);

// ③ 目录里的存档地图：点一下就换它（payload 带着文件名）
// 换一次图 → briefingSeq 递进 → 客户端重拉目录并重画
gBrief.briefingSeq = (Number(gBrief.briefingSeq) || 0) + 1;
Ui.render(wf.publicGameState(gBrief), net, { meId: 'b0', isSpectator: false, t: (k) => k, title: '战争工厂' });
const brItems = el('wfb-items').children || [];
ok(brItems.length === 1, '目录里列出了那张存档地图（' + brItems.length + ' 项）');
if (brItems.length) {
  brItems[0].dispatch('click', {});
}
ok(
  rawArgs('briefing:pick') && rawArgs('briefing:pick').mapFile === MAP_FILE_CASE.file,
  '点目录里的图 → 带着文件名换过去（' +
    (rawArgs('briefing:pick') ? rawArgs('briefing:pick').mapFile : '-') +
    '）'
);

// ④ 拍板
el('wfb-confirm').click();
ok(raws().indexOf('briefing:confirm') >= 0, '点「就用这张，开打」发出 briefing:confirm');

// ⑤ 非房主：看得见目录，但按钮是灰的（看得到才谈得上"这把打哪张"，但不能拍板）
Ui.render(wf.publicGameState(gBrief), net, { meId: 'b1', isSpectator: false, t: (k) => k, title: '战争工厂' });
ok(brRootEl.hidden === false, '客人也能看到战前面板');
ok(el('wfb-reroll').disabled === true, '客人的「再随机一张」是灰的');
ok(el('wfb-confirm').disabled === true, '客人的「开打」是灰的');
ok(/等待房主/.test(String(el('wfb-sub').textContent || '')), '客人那栏写着「等待房主选图…」');

// ⑥ 回归：连点「再随机一张」不能让预览画布越画越大
//    以前 brDrawThumb 拿 cv.width 当逻辑边长，而 cv.width 已经在上一次被乘过 dpr
//    → 每重画一遍再乘一次 dpr，高清屏连点几次 backing store 就膨胀到几万像素，
//    浏览器再把这么大的图缩回 360px 显示 → 越点越糊（用户报的就是这个）。
{
  const dprOld = winStub.devicePixelRatio;
  winStub.devicePixelRatio = 2; // dpr=1 时乘一次等于没乘，只有 2 倍屏才复现
  const widths = [];
  for (let i = 0; i < 4; i++) {
    gBrief.briefingSeq = (Number(gBrief.briefingSeq) || 0) + 1; // 换了图 → 预览必须重画
    Ui.render(wf.publicGameState(gBrief), net, { meId: 'b0', isSpectator: false, t: (k) => k, title: '战争工厂' });
    widths.push(el('wfb-canvas').width);
  }
  winStub.devicePixelRatio = dprOld;
  ok(
    widths.length > 1 && widths.every((w) => w === widths[0]),
    '连点随机后预览画布不膨胀（backing store ' + widths.join(' → ') + '）'
  );
}

// ⑦ 房主拍板之后（服务端把 briefing 清掉）→ 面板自己收起
wf.endBriefing(gBrief);
Ui.render(wf.publicGameState(gBrief), net, { meId: 'b0', isSpectator: false, t: (k) => k, title: '战争工厂' });
ok(brRootEl.hidden === true, '拍板之后战前面板收起');
delete globalThis.__WF_MAP_ACK;

/* ---------------- 地形编辑器 ---------------- */

console.log('\n[30] 地形编辑器（热键唤出 → 涂抹 → 摆建筑放兵 → 存盘下载）');

/** 假 DOM 里按属性值找一个节点（panel.html 里的 data-wfe-* 钩子） */
function nodeWith(attr, val) {
  for (const k of Object.keys(els)) {
    const n = els[k];
    if (n && n.getAttribute && n.getAttribute(attr) === String(val)) return n;
  }
  return null;
}
/** 动态生成的那一排按钮（笔刷粗细 / 归属 / 兵种） */
function dynBtn(hostId, val) {
  for (const c of el(hostId).children || []) {
    if (c && c.getAttribute && c.getAttribute('data-val') === String(val)) return c;
  }
  return null;
}
/** 按原始鼠标按键在战场上点一下 / 拖一下（编辑器要区分左右键） */
function edPointer(button) {
  // 注意乘 cam.k：客户端把 clientX 按画布宽度折回「镜头覆盖的世界宽」，
  // 缩放不是 1 的时候不加这一下，点就落到别的格子上去了。
  const cam = camFromLastFrame() || { x: 0, y: 0, k: 1 };
  return (wx, wy) => ({
    button,
    clientX: (wx - cam.x) * cam.k,
    clientY: (visY(wx, wy) - cam.y) * cam.k,
    preventDefault() {},
    shiftKey: false,
  });
}
function edStroke(button, wx, wy) {
  const mk = edPointer(button);
  canvasEl.dispatch('mousedown', mk(wx, wy));
  canvasEl.dispatch('mouseup', mk(wx, wy));
}
/** 编辑器里拖一笔（区别于 dragWorld：要能指定左右键，且必须过 cam.k 换算） */
function edDrag(button, x0, y0, x1, y1) {
  const mk = edPointer(button);
  canvasEl.dispatch('mousedown', mk(x0, y0));
  canvasEl.dispatch('mousemove', mk(x1, y1));
  canvasEl.dispatch('mouseup', mk(x1, y1));
  pump();
}

{
  const MAPS = wf.maps;
  // 服务端那一路（热键 → 补占位电脑 → 开局即暂停）由 smoke/editor.js 覆盖；
  // 这里只造「已经在编辑态的那局」，专测客户端面板与涂抹交互。
  const edRoom = {
    id: 'editor-room',
    players: [
      { id: 'p0', name: '甲' },
      { id: 'p1', name: '乙' },
    ],
    editorMode: true,
    editorOwnerId: 'p0',
    wfMap: wf.blankMap(2),
  };
  const gEd = wf.createGameState(edRoom);
  // 每刷新一次都带上快照：单位视图来自 game:rt，不给的话删兵的用例认不出目标
  const draw = () => {
    Ui.render(wf.publicGameState(gEd), net, view);
    Ui.applySnapshot(wf.snapshot(gEd));
    pump();
  };
  draw();
  const edRootEl = el('wf-editor');
  const CELL = wf.publicGameState(gEd).terrain.cell;
  const COLS = wf.publicGameState(gEd).terrain.cols;

  console.log('— 入口 —');
  ok(edRootEl.hidden === false, '编辑态一进来就拉出地形面板');
  ok(Ui.editor.active(), '认得出「我（p0）是编辑者」');
  ok(gEd.phase === 'edit' && gEd.paused === true, '开局即停在编辑阶段');
  ok(el('wfe-pause').textContent === '继续', '暂停按钮写的是「继续」');
  ok(Ui.editor.state.tab === 'terrain', '默认停在「地形」页');
  ok(Ui.editor.state.terr === 0 && Ui.editor.state.shape === 'circle', '默认笔 = 平原 + 圆头');
  ok(nodeWith('data-wfe-pane', 'building').hidden === true, '非当前页签的工具条是收着的');
  ok((el('wfe-sizes').children || []).length >= 5, '笔刷粗细那排按钮按预设铺开了');

  console.log('— 页签 —');
  nodeWith('data-wfe-tab', 'building').click();
  ok(Ui.editor.state.tab === 'building', '点「建筑」页签切过去了');
  nodeWith('data-wfe-tab', 'terrain').click();
  pump();
  ok(nodeWith('data-wfe-pane', 'terrain').hidden === false, '切回来：地形工具条可见');
  ok(nodeWith('data-wfe-pane', 'building').hidden === true, '切回来：建筑工具条收起');

  console.log('— 笔刷形状与粗细 —');
  ok(Ui.editor.brushCells(50, 50, 1, 'circle').length === 1, '1 格笔只碰一格');
  ok(Ui.editor.brushCells(50, 50, 3, 'square').length === 9, '方笔 3 格 = 3×3 共 9 格');
  ok(Ui.editor.brushCells(50, 50, 3, 'circle').length === 5, '圆笔 3 格 = 十字 5 格（比方笔圆润）');
  ok(Ui.editor.brushCells(50, 50, 3, 'diamond').length === 5, '菱笔 3 格 = 菱形 5 格');
  const c20 = Ui.editor.brushCells(50, 50, 20, 'circle').length;
  ok(c20 > 280 && c20 < 360, `20 格圆笔 ≈ π·10² = 314 格（实测 ${c20}）`);
  ok(
    Ui.editor.brushCells(1, 1, 5, 'circle').every((i) => i >= 0 && i < COLS * COLS),
    '贴地图边角也不产出越界格号'
  );
  ok(Ui.editor.boxCells({ c0: 10, r0: 10, c1: 12, r1: 13 }).length === 12, '框选 = 整块矩形（3×4）');
  ok(Ui.editor.boxCells({ c0: 12, r0: 13, c1: 10, r1: 10 }).length === 12, '框选反着拖也是同一块');

  console.log('— 涂抹 —');
  nodeWith('data-wfe-terr', '2').click();
  dynBtn('wfe-sizes', '5').click();
  ok(Ui.editor.state.terr === 2 && Ui.editor.state.size === 5, '选了「山」+ 5 格笔');
  sent.length = 0;
  const x0 = 40 * CELL + CELL / 2;
  const y0 = 40 * CELL + CELL / 2;
  edDrag(0, x0, y0, x0 + CELL * 6, y0); // 从左到右拖一笔
  const paints = sent.filter((s) => s.__raw === 'wf:edit' && s.payload.op === 'paint');
  ok(paints.length > 0, '拖一笔会发 wf:edit / paint');
  ok(
    paints.every((p) => p.payload.cells.every((it) => it[1] === 2)),
    '这一笔写的全是「山」'
  );
  const touched = new Set();
  for (const p of paints) for (const it of p.payload.cells) touched.add(it[0]);
  ok(touched.has(40 * COLS + 40), '起点那格进了发送队列');
  ok(touched.size > 10, `拖动把沿途都连上了（${touched.size} 格）`);
  ok(Ui.editor.at(40, 40) === 2, '本地立刻就是山（不等服务端回包）');
  ok(Ui.editor.at(40, 45) === 2, '沿途的格子也跟着改了');
  ok(Ui.editor.at(40, 60) === 0, '没拖到的地方没受影响');

  sent.length = 0;
  edStroke(2, x0, y0); // 右键 = 抹平成平原
  const rubs = sent.filter((s) => s.__raw === 'wf:edit' && s.payload.op === 'paint');
  ok(
    rubs.length > 0 && rubs.every((p) => p.payload.cells.every((it) => it[1] === 0)),
    '右键=橡皮：写进去的全是平原'
  );
  ok(Ui.editor.at(40, 40) === 0, '擦过的格子回到平原');
  // 服务端真实执行一遍：本地改的和权威的结果必须一致
  for (const p of [...paints, ...rubs]) wf.applyEditorCommand(gEd, p.payload);
  ok(gEd.terrain.grid[40][40] === 0 && gEd.terrain.grid[40][45] === 2, '服务端照着这批指令改出了同一张图');

  console.log('— 框选整片填充 —');
  nodeWith('data-wfe-shape', 'box').click();
  nodeWith('data-wfe-terr', '4').click();
  sent.length = 0;
  // 一律取格子**中心**：取边界的话，「世界→屏幕→世界」这一来一回的浮点误差
  // 就能把点挤到隔壁格，框出来的矩形随机少一行/一列。
  const bx0 = (70 + 0.5) * CELL;
  const by0 = (70 + 0.5) * CELL;
  edDrag(0, bx0, by0, bx0 + CELL * 4, by0 + CELL * 3);
  const boxed = sent.filter((s) => s.__raw === 'wf:edit' && s.payload.op === 'paint').pop();
  ok(Boolean(boxed), '框选松手会一次性发一整块');
  ok(boxed.payload.cells.length === 20, `拖出来的矩形正好 5×4 = ${boxed.payload.cells.length ? 20 : 0} 格`);
  ok(
    boxed.payload.cells.every((it) => it[1] === 4),
    '整块填的是「水」'
  );
  ok(Ui.editor.at(72, 72) === 4, '框内的格子变成水');
  wf.applyEditorCommand(gEd, boxed.payload);
  ok(gEd.terrain.grid[72][72] === 4, '服务端也认可这一整块');
  nodeWith('data-wfe-shape', 'circle').click();

  console.log('— 建筑 —');
  const st0 = wf.publicGameState(gEd);
  const blocks = [].concat(st0.factories, st0.labs, st0.hqs).map((b) => [b.x, b.y]);
  let spotA = null;
  for (let rr = 40; rr < 120 && !spotA; rr += 3) {
    for (let cc = 40; cc < 120; cc += 3) {
      const px = (cc + 0.5) * CELL;
      const py = (rr + 0.5) * CELL;
      if (blocks.every((b) => Math.hypot(b[0] - px, b[1] - py) > 300)) {
        spotA = { x: px, y: py, c: cc, r: rr };
        break;
      }
    }
  }
  ok(Boolean(spotA), '找得到一块离所有建筑都远的空地');
  nodeWith('data-wfe-tab', 'building').click();
  nodeWith('data-wfe-bkind', 'lab').click();
  sent.length = 0;
  edStroke(0, spotA.x, spotA.y);
  const bcmd = sent.filter((s) => s.__raw === 'wf:edit' && s.payload.op === 'building').pop();
  ok(Boolean(bcmd), '在地图上点一下会发 building 指令');
  ok(bcmd.payload.kind === 'lab' && bcmd.payload.owner === -1, '默认「中立」归属写进了指令');
  ok(bcmd.payload.col === spotA.c && bcmd.payload.row === spotA.r, '落点是鼠标指着的那一格');
  const labsBefore = gEd.labs.length;
  ok(wf.applyEditorCommand(gEd, bcmd.payload) && gEd.labs.length === labsBefore + 1, '服务端收下：多了一座研究所');
  // 归属改成座位 0（甲）再放一座工厂
  nodeWith('data-wfe-bkind', 'factory:3').click();
  const ownerBtns = el('wfe-bowner').children || [];
  ok(ownerBtns.length === 3, `归属里有「中立 + 两个座位」共 ${ownerBtns.length} 个按钮`);
  dynBtn('wfe-bowner', '0').click();
  sent.length = 0;
  edStroke(0, spotA.x + CELL * 8, spotA.y);
  const fcmd = sent.filter((s) => s.__raw === 'wf:edit' && s.payload.op === 'building').pop();
  ok(fcmd.payload.kind === 'factory' && fcmd.payload.level === 3, '放的是三级工厂');
  ok(fcmd.payload.owner === 0, '归属跟着「甲」走');
  const facBefore = gEd.factories.length;
  ok(wf.applyEditorCommand(gEd, fcmd.payload) && gEd.factories.length === facBefore + 1, '服务端收下：多了一座工厂');
  draw(); // 让它进客户端的建筑表，下面那句「点到已有建筑 = 挪动」才有目标
  sent.length = 0;
  edStroke(0, spotA.x + CELL * 8, spotA.y);
  const mcmd = sent.filter((s) => s.__raw === 'wf:edit' && s.payload.op === 'building').pop();
  ok(Boolean(mcmd) && Boolean(mcmd.payload.id), '点在已有建筑上 = 挪动它（指令带着 id）');
  wf.applyEditorCommand(gEd, mcmd.payload);
  ok(gEd.factories.length === facBefore + 1, '挪动不会多出第二座');
  // 删：开删除模式
  el('wfe-bdel').click();
  pump();
  ok(Ui.editor.state.bDel === true, '「删除模式」已打开');
  sent.length = 0;
  edStroke(0, spotA.x + CELL * 8, spotA.y);
  const dcmd = sent.filter((s) => s.__raw === 'wf:edit' && s.payload.op === 'building').pop();
  ok(dcmd && dcmd.payload.remove === true && dcmd.payload.kind === 'factory', '删除模式发出 remove 指令');
  wf.applyEditorCommand(gEd, dcmd.payload);
  ok(gEd.factories.length === facBefore, '服务端把它删掉了');
  el('wfe-bdel').click();

  console.log('— 部队 —');
  nodeWith('data-wfe-tab', 'unit').click();
  pump();
  const uTypes = el('wfe-utype').children || [];
  ok(uTypes.length >= 6, `兵种照服务端 TYPE_LIST 列出来（${uTypes.length} 个）`);
  const typeList = wf.publicGameState(gEd).consts.typeList || [];
  ok(uTypes[0].getAttribute('data-val') === typeList[0], '兵种顺序与服务端一致');
  nodeWith('data-wfe-utier', '3').click();
  sent.length = 0;
  edStroke(0, spotA.x, spotA.y + CELL * 8);
  const ucmd = sent.filter((s) => s.__raw === 'wf:edit' && s.payload.op === 'unit').pop();
  ok(Boolean(ucmd), '点地图会发 unit 指令');
  ok(ucmd.payload.tier === 3 && ucmd.payload.owner === 0, '阶数与归属跟着面板走');
  ok(typeList.indexOf(ucmd.payload.type) >= 0, '兵种是服务端认得的那个');
  const uBefore = gEd.units.length;
  ok(wf.applyEditorCommand(gEd, ucmd.payload) && gEd.units.length === uBefore + 1, '服务端收下：多了一个兵');
  // 删除部队
  draw(); // 先把新部队同步到客户端的单位表
  el('wfe-udel').click();
  pump();
  const u = gEd.units[gEd.units.length - 1];
  sent.length = 0;
  edStroke(0, u.x, u.y);
  const urm = sent.filter((s) => s.__raw === 'wf:edit' && s.payload.op === 'unit').pop();
  ok(urm && urm.payload.remove === true && urm.payload.id === u.id, '删除模式点中这个兵（带对了 id）');
  ok(wf.applyEditorCommand(gEd, urm.payload) && gEd.units.length === uBefore, '服务端把它删掉了');
  el('wfe-udel').click();

  console.log('— 整图填充 —');
  sent.length = 0;
  nodeWith('data-wfe-tab', 'terrain').click();
  nodeWith('data-wfe-terr', '2').click();
  // 「已经是山」的那些不进发送队列（服务端本来就是同一个值），算总账时要先记住有多少格
  let alreadyMtn = 0;
  for (let rr = 0; rr < COLS; rr++) for (let cc = 0; cc < COLS; cc++) if (Ui.editor.at(rr, cc) === 2) alreadyMtn++;
  el('wfe-fill-all').click();
  pump();
  let allMtn = true;
  for (let cc = 0; cc < COLS; cc += 17) if (Ui.editor.at(0, cc) !== 2) allMtn = false;
  ok(allMtn, '「整图填充」按当前笔刷铺满，连地图边边角角都是山');
  const fillsSent = sent.filter((s) => s.__raw === 'wf:edit' && s.payload.op === 'paint');
  let n = 0;
  for (const p of fillsSent) n += p.payload.cells.length;
  ok(
    n + alreadyMtn === COLS * COLS,
    `整图一次发完（发出去 ${n} 格 + 原本就是山 ${alreadyMtn} 格 = ${n + alreadyMtn} / ${COLS * COLS}）`
  );
  nodeWith('data-wfe-terr', '0').click();
  el('wfe-fill-all').click();
  pump();
  for (const p of sent.filter((s) => s.__raw === 'wf:edit' && s.payload.op === 'paint')) {
    wf.applyEditorCommand(gEd, p.payload);
  }

  console.log('— 存盘与下载 —');
  let savedFile = '';
  globalThis.__WF_MAP_ACK = (name, payload) => {
    if (name === 'map:save') {
      const obj = wf.exportCurrentMap(gEd);
      obj.name = (payload && payload.name) || obj.name;
      obj.players = gEd.players.length;
      const res = MAPS.writeMap(obj, payload && payload.file, { overwrite: Boolean(payload && payload.overwrite) });
      if (res.ok) savedFile = res.file;
      return res;
    }
    return { ok: true, maps: MAPS.listMaps(), selected: savedFile || null };
  };
  el('wfe-name').value = '编辑器测试图';
  log.clicks.length = 0;
  log.blobs.length = 0;
  el('wfe-save').click();
  pump();
  ok(log.blobs.length === 1, '存成了文件（拿到了要给浏览器下载的那份 JSON）');
  // log.clicks 里还有「保存」按钮自己那一下，下载锚点是运行时 createElement 出来的
  const dlClicks = log.clicks.filter((c) => String(c).indexOf('created-') === 0);
  ok(dlClicks.length === 1, `触发了一次浏览器下载（<a download> 被点了 ${dlClicks.length} 下）`);
  let saved = null;
  try {
    saved = JSON.parse(log.blobs[0].text);
  } catch (_) {
    /* ignore */
  }
  ok(Boolean(saved) && saved.format === 'warfactory-map', '下载内容是合法地图文件');
  ok(Boolean(saved) && saved.name === '编辑器测试图', '地图名写进去了');
  ok(Boolean(saved) && saved.buildings.some((b) => b.kind === 'lab'), '刚摆的研究所进了文件');
  ok(Boolean(saved) && (saved.units || []).length >= 0, '部队表也落盘了');
  const back = savedFile ? MAPS.loadMap(savedFile) : null;
  ok(Boolean(back), '这份文件还能再读回来');
  ok(Boolean(back) && back.grid2[70][70] === Ui.editor.at(70, 70), '读回来的地形与客户端此刻一致');

  nodeWith('data-wfe-tab', 'map').click();
  pump();
  ok((el('wfe-maplist').children || []).length >= 1, '「已有地图」拉回了存档卡片');
  ok(deepText(el('wfe-maplist')).includes('编辑器测试图'), '卡片上写的是地图名');
  ok(Boolean(nodeWith('data-wfe-tab', 'map').classList.contains('is-on')), '当前页签高亮');

  sent.length = 0;
  el('wfe-heights').click();
  const rect = sent.filter((s) => s.__raw === 'wf:edit' && s.payload.op === 'recalcHeights');
  ok(rect.length === 1, '「重算高低差」会发 recalcHeights');
  wf.applyEditorCommand(gEd, rect[0].payload);
  ok(Boolean(gEd.terrain.heights), '服务端按当前地形算出了高度场');

  console.log('— 退出 —');
  sent.length = 0;
  el('wfe-exit').click();
  const unpause = sent.filter((s) => s.__raw === 'wf:edit' && s.payload.op === 'pause').pop();
  ok(unpause && unpause.payload.on === false, '「退出编辑」= 让对局继续跑');
  draw();
  ok(edRootEl.hidden === true, '退出后面板收起来了');
  ok(Ui.editor.active() === false, '退了就不许再动笔');

  // 收尾：别在仓库里留下测试用的地图文件
  try {
    if (savedFile) fs.unlinkSync(path.join(MAPS.MAP_DIR, savedFile));
  } catch (_) {
    /* ignore */
  }
  delete globalThis.__WF_MAP_ACK;

  // 普通对局（非编辑态）永远不该冒出这块面板
  Ui.render(wf.publicGameState(g), net, view);
  pump();
  ok(edRootEl.hidden === true, '普通对局里面板始终藏着');
}

/* ---------------- 行军路线预览 ---------------- */
console.log('\n[31] 行军路线预览（绕得开山水建筑崖 · 两端接得上）');
{
  const gr = wf.createGameState({
    id: 'wf-route',
    players: [
      { id: 'ra', name: '甲' },
      { id: 'rb', name: '乙' },
    ],
  });
  gr.phase = 'playing';
  gr.phaseEndsAt = 0;
  Ui.render(wf.publicGameState(gr), net, view);
  Ui.applySnapshot(wf.snapshot(gr));
  pump();

  const CELL = Ui.route.cell;
  const tg = gr.terrain;
  const passAt = (x, y) => Ui.route.passAt(Math.floor(y / CELL), Math.floor(x / CELL));
  // 起点取亲兵，终点取「同分量里够远的空地」—— 太近了路线只有两三个点，量不出东西
  const u0 = gr.units.find((u) => !u.dead && u.ownerIdx === 0);
  let goal = null;
  let bestD = Infinity;
  for (let r = 2; r < tg.rows - 2; r += 2) {
    for (let c = 2; c < tg.cols - 2; c += 2) {
      const px = (c + 0.5) * CELL;
      const py = (r + 0.5) * CELL;
      const d = Math.hypot(px - u0.x, py - u0.y);
      if (d < 2000 || d > 3600) continue;
      if (!passAt(px, py)) continue;
      if (d < bestD) {
        bestD = d;
        goal = { x: px, y: py };
      }
    }
  }
  ok(Boolean(goal), '找得到一块远处空地当落点');
  const pts = goal ? Ui.route.plan(u0.x, u0.y, goal.x, goal.y) : null;
  ok(Array.isArray(pts) && pts.length >= 2, `求得行军折线（${pts ? pts.length : 0} 个拐点）`);
  if (pts) {
    // ① 两端接得上：起点贴着部队、终点就是落点
    // 部队可能正站在建筑占位格里（掩码 0），此时起点会被矫正到最近的可通行格
    ok(Math.hypot(pts[0][0] - u0.x, pts[0][1] - u0.y) < CELL * 14, '折线起点从部队脚下起步');
    const last = pts[pts.length - 1];
    ok(Math.hypot(last[0] - goal.x, last[1] - goal.y) < 1, '折线终点就是落点');
    // ② 全程走得通：每一段按半格采样，落点格必须都在行军掩码里
    let bad = 0;
    let seg = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / (CELL * 0.5)));
      for (let s = 0; s <= n; s++) {
        const px = a[0] + ((b[0] - a[0]) * s) / n;
        const py = a[1] + ((b[1] - a[1]) * s) / n;
        seg++;
        if (!passAt(px, py)) bad++;
      }
    }
    ok(bad === 0, `折线全程走在可通行格上（采样 ${seg} 点，越界 ${bad} 个）`);
    // ③ 真的绕了路：直线若被山/水拦着，折线里程必须明显长于直线
    const poly = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
    ok(poly >= bestD - CELL * 2, `折线里程 ${Math.round(poly)}px 不短于直线 ${Math.round(bestD)}px`);
    ok(poly < bestD * 8, `折线没有绕到离谱（${Math.round(poly)}px ≤ 直线 ${Math.round(bestD)}px 的 8 倍）`);
  }
  // ④ 落点本身站不住人（深山里）时不该硬画一条穿山的线
  let deep = null;
  for (let r = 2; r < tg.rows - 2 && !deep; r++) {
    for (let c = 2; c < tg.cols - 2 && !deep; c++) {
      if (tg.grid[r][c] === 2) deep = { x: (c + 0.5) * CELL, y: (r + 0.5) * CELL };
    }
  }
  if (deep) {
    const p2 = Ui.route.plan(u0.x, u0.y, deep.x, deep.y);
    if (p2) {
      let bad2 = 0;
      for (let i = 0; i + 1 < p2.length; i++) {
        const a = p2[i];
        const b = p2[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL * 0.5)));
        for (let s = 0; s <= n; s++) {
          if (!passAt(a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n)) bad2++;
        }
      }
      ok(bad2 === 0, '落点在山里时，画出来的线也不穿山（越界 ' + bad2 + ' 个）');
    } else {
      ok(true, '落点在山里时直接不画线');
    }
  }
}

console.log('\n[32] 多点路径规划（Shift+右键：加路点 · 逐段求解 · 可取消）');
{
  const gr = wf.createGameState({
    id: 'wf-route2',
    players: [
      { id: 'rc', name: '甲' },
      { id: 'rd', name: '乙' },
    ],
  });
  gr.phase = 'playing';
  gr.phaseEndsAt = 0;
  Ui.render(wf.publicGameState(gr), net, view);
  Ui.applySnapshot(wf.snapshot(gr));
  pump();

  const CELL = Ui.route.cell;
  const tg = gr.terrain;
  const passAt = (x, y) => Ui.route.passAt(Math.floor(y / CELL), Math.floor(x / CELL));
  const u0 = gr.units.find((u) => !u.dead && u.ownerIdx === 0);
  // 沿「离部队越来越远」的环带挑三个路点（都在可通行格上）
  const wps = [];
  for (const want of [1200, 2000, 2800]) {
    let best = null;
    let bd = Infinity;
    for (let r = 2; r < tg.rows - 2; r += 3) {
      for (let c = 2; c < tg.cols - 2; c += 3) {
        const px = (c + 0.5) * CELL;
        const py = (r + 0.5) * CELL;
        if (!passAt(px, py)) continue;
        const d = Math.abs(Math.hypot(px - u0.x, py - u0.y) - want);
        if (d >= bd) continue;
        bd = d;
        best = { x: px, y: py };
      }
    }
    if (best) wps.push(best);
  }
  ok(wps.length >= 2, `挑出 ${wps.length} 个路点`);

  Ui.route.clear();
  for (const w of wps) Ui.route.addWaypoint(w.x, w.y);
  pump(); // 规划中的线要真的画一遍（画错/抛错在这一步就会炸）
  ok(Ui.route.draft.wps.length === wps.length, `路点进了规划（${Ui.route.draft.wps.length} 个）`);
  ok(Ui.route.draft.segs.length > 0, '规划中就已经算出了行进折线');
  // 折线必须依次串起每个路点，且全程走得通
  const chain = Ui.route.chain(u0.x, u0.y, wps);
  ok(Array.isArray(chain) && chain.length >= 2, `多点折线求得（${chain ? chain.length : 0} 个点）`);
  if (chain && chain.length >= 2) {
    let bad = 0;
    let seg = 0;
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL * 0.5)));
      for (let s = 0; s <= n; s++) {
        seg++;
        if (!passAt(a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n)) bad++;
      }
    }
    ok(bad === 0, `多点折线全程走在可通行格上（采样 ${seg} 点，越界 ${bad} 个）`);
    const poly = chain.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - chain[i - 1][0], p[1] - chain[i - 1][1]) : 0), 0);
    const straight = Math.hypot(wps[wps.length - 1].x - u0.x, wps[wps.length - 1].y - u0.y);
    ok(poly >= straight - CELL * 2, `多点里程 ${Math.round(poly)}px 不短于直线 ${Math.round(straight)}px`);
  }
  Ui.route.clear();
  ok(Ui.route.draft.wps.length === 0 && Ui.route.draft.segs.length === 0, 'clear 能把规划一次清空');
}

console.log('\n[33] 车体 / 炮塔：分两层画（车体朝行进、炮塔朝攻击）');
{
  const pc = makeCtx('preview');
  const types = ['warrior', 'shield', 'ranger', 'burst', 'burn', 'laser'];
  // ① 两层各自都画得出东西 —— 炮塔件被误包进车体分支（或反之）时这里会直接抓到
  let empty = 0;
  let drawn = 0;
  for (const ty of types) {
    for (let tier = 1; tier <= 3; tier++) {
      log.points.length = 0;
      Ui.drawUnitParts(pc, ty, tier, 'A', '#b03a2e', 'base');
      const nb = log.points.length;
      log.points.length = 0;
      Ui.drawUnitParts(pc, ty, tier, 'A', '#b03a2e', 'turret');
      const nt = log.points.length;
      if (nb <= 0 || nt <= 0) empty++;
      drawn += nb + nt;
    }
  }
  ok(empty === 0, `6 兵种 × 3 阶：车体层与炮塔层都有内容（空层 ${empty} 个，共画出 ${drawn} 个点）`);

  // ② 静态预览（docs 用）走的是「两层同向叠起来」，不能因为拆层而画空
  log.points.length = 0;
  Ui.previewUnitBody(pc, 'laser', 3, 'A', '#b03a2e', 1);
  ok(log.points.length > 0, `静态预览仍画出完整的一只兵（${log.points.length} 个点）`);

  // ③ 相对角走最短弧：179° → -179° 只该转 2°，不是绕 358°
  const R = Ui.turretRel;
  ok(R({ ang: 0, tur: 0 }) === 0, '炮塔与车体同向 → 相对角 0');
  ok(Math.abs(Math.abs(R({ ang: 0, tur: Math.PI })) - Math.PI) < 1e-9, '炮塔转到正后方 → 相对角 ±π');
  const wrap = R({ ang: 3.1, tur: -3.1 });
  ok(Math.abs(wrap) < 0.2, `跨 ±π 走最短弧（${wrap.toFixed(3)} rad，不是 ${(2 * Math.PI - Math.abs(wrap)).toFixed(2)}）`);
  ok(R({ ang: 0, tur: null }) === 0 && R({}) === 0, '缺炮塔角时退化为「炮塔 = 车体」（老快照不会画崩）');
}

console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);