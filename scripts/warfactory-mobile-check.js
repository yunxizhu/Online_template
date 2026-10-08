'use strict';

/**
 * 战争工厂 mobile 前端冒烟校验（不需要真实浏览器）
 *
 * 用 vm + 极简假 DOM/canvas 真加载 mobile/www/games/warfactory/ui.js，
 * 拿服务端真实快照驱动若干帧渲染与一次点击，捕捉「node --check 查不出来」的运行时错误
 *   —— 未定义变量、存取错的字段、save/restore 不配对导致的画面逐帧漂移等。
 *
 * mobile 那份前端和 public 是**两份独立副本**（历史上长期落后），
 * 凡是给 public 移植的能力都要在这里对着跑一遍，别让它悄悄坏掉。
 *
 * 用法：node scripts/warfactory-mobile-check.js
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

/* ---------------- 假 canvas：记录经仿射变换后的落点 ---------------- */

const log = {
  texts: [],
  setTransforms: [],
  rects: [], // [x, y, w, h, fillStyle]（已换算到画布坐标）
  ellipses: [], // [cx, cy, rx, ry]（每帧需要换算回世界坐标再比）
  points: [], // [x, y]
  strokes: [], // 每次 stroke() 当时的 lineWidth
  strokeStyles: [], // 每次 stroke() 当时的 strokeStyle
  strokeMags: [], // 每次 stroke() 当时变换的放大倍率（lineWidth × 它 = 屏幕像素粗细）
  rafCbs: [],
};

function makeCtx(tag) {
  let tf = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const apply = (m) => {
    const [a1, b1, c1, d1, e1, f1] = tf;
    const [a2, b2, c2, d2, e2, f2] = m;
    tf = [
      a1 * a2 + c1 * b2,
      b1 * a2 + d1 * b2,
      a1 * c2 + c1 * d2,
      b1 * c2 + d1 * d2,
      a1 * e2 + c1 * f2 + e1,
      b1 * e2 + d1 * f2 + f1,
    ];
  };
  const pt = (x, y) => [tf[0] * x + tf[2] * y + tf[4], tf[1] * x + tf[3] * y + tf[5]];
  const rec = (x, y) => log.points.push(pt(x, y));
  // 当前变换的放大倍率：lineWidth × 它 = 屏幕像素粗细（等高线「粗细恒定」就靠它验）
  const mag = () => Math.sqrt(Math.abs(tf[0] * tf[3] - tf[1] * tf[2])) || 0;
  const ctx = {
    canvas: null,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineDashOffset: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    save() {
      stack.push(tf.slice());
    },
    restore() {
      if (stack.length) tf = stack.pop();
    },
    setTransform(a, b, c, d, e, f) {
      tf = [a, b, c, d, e, f];
      log.setTransforms.push([a, b, c, d, e, f]);
    },
    resetTransform() {
      tf = [1, 0, 0, 1, 0, 0];
    },
    transform(a, b, c, d, e, f) {
      apply([a, b, c, d, e, f]);
    },
    translate(x, y) {
      apply([1, 0, 0, 1, x, y]);
    },
    scale(x, y) {
      apply([x, 0, 0, y, 0, 0]);
    },
    rotate(a) {
      apply([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
    },
    beginPath() {},
    closePath() {},
    moveTo(x, y) {
      rec(x, y);
    },
    lineTo(x, y) {
      rec(x, y);
    },
    quadraticCurveTo(cx, cy, x, y) {
      rec(cx, cy);
      rec(x, y);
    },
    bezierCurveTo(a, b, c, d, e, f) {
      rec(a, b);
      rec(e, f);
    },
    arc(x, y, r) {
      rec(x, y);
      log.rects.push([pt(x, y)[0], pt(x, y)[1], r, r]);
    },
    ellipse(x, y, rx, ry) {
      const p = pt(x, y);
      log.ellipses.push([p[0], p[1], rx, ry]);
      rec(x, y);
    },
    rect(x, y, w, h) {
      const p = pt(x, y);
      log.rects.push([p[0], p[1], w, h]);
    },
    fillRect(x, y, w, h) {
      const p = pt(x, y);
      log.rects.push([p[0], p[1], w, h, ctx.fillStyle]);
      rec(x, y);
    },
    strokeRect(x, y, w, h) {
      const p = pt(x, y);
      log.rects.push([p[0], p[1], w, h]);
    },
    stroke() {
      log.strokes.push(ctx.lineWidth);
      log.strokeStyles.push(ctx.strokeStyle);
      log.strokeMags.push(mag());
    },
    fill() {},
    clearRect() {},
    fillText(t, x, y) {
      log.texts.push(String(t));
      rec(x, y);
    },
    strokeText() {},
    setLineDash() {},
    getLineDash: () => [],
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    drawImage() {},
    measureText: (t) => ({ width: String(t).length * 6 }),
    clip() {},
    roundRect(x, y, w, h) {
      const p = pt(x, y);
      log.rects.push([p[0], p[1], w, h]);
    },
    __tag: tag,
  };
  return ctx;
}

/* ---------------- 假 DOM ---------------- */

const els = {};
function el(id) {
  if (els[id]) return els[id];
  const classes = new Set();
  const handlers = {};
  const node = {
    id,
    tagName: 'DIV',
    hidden: false,
    children: [],
    style: {},
    dataset: {},
    textContent: '',
    scrollTop: 0,
    scrollHeight: 0,
    parentNode: null,
    classList: {
      add(...cs) {
        cs.forEach((c) => c && classes.add(c));
      },
      remove(...cs) {
        cs.forEach((c) => c && classes.delete(c));
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
    querySelector: (sel) => el(id + ' ' + sel),
    getContext: () => makeCtx(id),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    focus() {},
    blur() {},
    remove() {},
    width: 1280,
    height: 800,
    clientWidth: 1280,
    clientHeight: 800,
    offsetWidth: 1280,
    offsetHeight: 800,
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
els.__n = 0;

const documentStub = {
  getElementById: (id) => el(id),
  createElement: () => el('created-' + els.__n++),
  querySelector: (sel) => el(sel),
  addEventListener() {},
  body: { appendChild() {} },
  documentElement: { clientWidth: 1280, clientHeight: 800 },
};

const winStub = {
  addEventListener() {},
  removeEventListener() {},
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
  WeakMap,
  Promise,
  Error,
  parseInt,
  parseFloat,
  isNaN,
  Infinity,
  NaN,
  undefined,
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
  setInterval,
  clearInterval,
};
sandbox.globalThis = sandbox;
sandbox.navigator = { userAgent: 'node' };

const src = fs.readFileSync(path.join(ROOT, 'mobile/www/games/warfactory/ui.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const Ui = sandbox.window.WarFactoryUi;

/** 每层的视觉错位像素（从源码读，改参数时校验自动跟着走） */
const HEIGHT_STEP = Number((/const HEIGHT_STEP = (\d+);/.exec(src) || [0, 0])[1]) || 0;
const BG_PAD = Number((/const BG_PAD = (\d+);/.exec(src) || [0, 0])[1]) || 0;

console.log('战争工厂 mobile 前端冒烟校验');
ok(Boolean(Ui) && typeof Ui.render === 'function', 'mobile 客户端模块加载成功');
ok(Boolean(Ui && Ui.heights), '导出高低差换算 heights（与 public 版同名字同语义）');

const visY = (x, y) => Ui.heights.groundY(x, y);
const liftAt = (x, y) => Ui.heights.liftAt(x, y);

/* ---------------- 驱动 ---------------- */

const net = { on() {}, sendRt() {} };
const sent = [];
net.sendRt = (d) => sent.push(d);
// 每一局各自的观战身份由 newGame() 生成（换图时要连玩家 id 一起换，见那里）

function pump() {
  log.texts.length = 0;
  log.rects.length = 0;
  log.ellipses.length = 0;
  log.points.length = 0;
  log.setTransforms.length = 0;
  const cbs = log.rafCbs.splice(0, log.rafCbs.length);
  for (const cb of cbs) cb();
}
function camFromLastFrame() {
  const cands = log.setTransforms.filter((m) => m[0] === m[3] && m[1] === 0 && m[2] === 0);
  const t = cands[1] || cands[0];
  return t && t[0] ? { k: t[0], x: -t[4] / t[0], y: -t[5] / t[0] } : null;
}

console.log('\n[1] 服务端地形下发后 mobile 端能解析出高低差');

/**
 * 开一局新的随机图。
 * ⚠️ 每次重试都要让 client 认出「换了一局」，它才会重新铺地形：Ui 用
 * 「世界尺寸 + 玩家 id + 工厂数」当 key 判断是不是新局，而随机图这几项都不变，
 * 所以重开的那份必须换一组玩家 id（meId 跟着换，否则 client 会把我当成观众）。
 */
function newGame(n) {
  const ids = ['m0-' + n, 'm1-' + n];
  const st = wf.createGameState({
    id: 'mobile-check',
    players: ids.map((id, i) => ({ id, name: i ? '乙' : '甲' })),
  });
  st.phase = 'playing';
  st.phaseEndsAt = 0;
  return { st, opts: { meId: ids[0], isSpectator: false, t: (k) => k, title: '战争工厂' } };
}

/** 把局面喂给 client 跑一帧：Ui 自己缓存了一份地形与高度场，换了图必须重 render */
function renderGame(st, opts) {
  Ui.render(wf.publicGameState(st), net, opts);
  Ui.applySnapshot(wf.snapshot(st));
  pump();
}

/** 抽 4000 个点，看这张图一共出现几种抬升值、最陡的是多少 */
function surveyLift(st) {
  const seen = new Set();
  let max = 0;
  for (let i = 0; i < 4000; i++) {
    const x = ((i * 977) % st.world.w) + 0.5;
    const y = ((i * 613) % st.world.h) + 0.5;
    const L = liftAt(x, y);
    seen.add(L);
    if (Math.abs(L) > Math.abs(max)) max = L;
  }
  return { seen: seen, max: max };
}

let made = newGame(0);
let g = made.st;
let opts = made.opts;
renderGame(g, opts);

ok(HEIGHT_STEP > 0, '源码里有 HEIGHT_STEP（每层错位像素）');
ok(BG_PAD > 0 && /c\.height = WORLD_H \+ BG_PAD \* 2/.test(src), '背景画布上下留出 BG_PAD（抬起的地块不会露底）');
ok(/cv\.height = Math\.ceil\(WORLD_H \+ terrainOffY \+ dn\)/.test(src), '地形画布按高度预留上下边');
ok(
  /ctx\.drawImage\(bgCanvas, 0, -BG_PAD\)/.test(src) && /ctx\.drawImage\(terrainCanvas, 0, -terrainOffY\)/.test(src),
  '主循环贴图时把预留的上边白减回去'
);

const ICONSCALE = Number((/const UNIT_VIS_SCALE = ([\d.]+);/.exec(src) || [0, 1])[1]) || 1;
const BODY_SHIELD =
  Number((/shield:\s*([\d.]+)/.exec((/const UNIT_BODY_SCALE = \{([^}]*)\}/.exec(src) || [0, ''])[1]) || [0, 1])[1]) || 1;
const { TERR_ROWS: R, TERR_COLS: C, TERR_CELL: CELL_PX } = wf.__test.consts;
/** 点选容差（与 ui.js unitAt 同一套算法）：后面的判据必须以它为尺度 */
const CLICK_TOL = 24 * ICONSCALE * BODY_SHIELD;
/** 随机地图不一定有「能站人又够陡」的坡；抽不到就换图，最多试这么多张 */
const MAP_TRIES = 8;

/**
 * 找一块「落差最大」的空地，用来验证「站在坡上的兵」的一整套行为。
 * 落差必须大于点选容差（否则「点错一层」和「点对」落在同一个判定圆里，断言没有区分力），
 * 所以这里一路扫到找到够陡的那块为止。
 */
function pickSlopedSpot() {
  let best = null;
  const enough = () => best && Math.abs(best.L) > CLICK_TOL + 6;
  // 直接按地形格逐格扫：保证拿到的就是全图最陡的那格，而不是「恰好被抽到的那格」
  for (let r = 2; r < R - 2 && !enough(); r++) {
    for (let c = 2; c < C - 2; c++) {
      const x = c * CELL_PX + CELL_PX / 2;
      const y = r * CELL_PX + CELL_PX / 2;
      const L = liftAt(x, y);
      if (Math.abs(L) < HEIGHT_STEP) continue;
      if (best && Math.abs(L) <= Math.abs(best.L)) continue;
      // 最陡的格子往往在山水内部（不可通行），spawnUnit 会把兵挪到最近的可通行格、
      // 落差就被抹平了 —— 所以候选本身必须能站人。
      if (!wf.__test.canStand(g, x, y, 14)) continue;
      let clean = true;
      for (const u of g.units) {
        if (!u.dead && Math.hypot(u.x - x, u.y - y) < 120) {
          clean = false;
          break;
        }
      }
      if (clean) best = { x, y, L };
    }
  }
  return best;
}

let survey = surveyLift(g);
let spot = null;
let hero = null;
let heroLift = 0;
let usable = false;
// 「够陡」这件事由随机地图决定：本局最陡的**可站**格子可能只有 2 层（26px），
// 跟点选容差 26.4px 差不多，那样「点对」和「点错一层」落在同一个判定圆里，断言就没有区分力。
// 与其把这种运气差的局判成失败，不如换一张随机图重试：实测三次里就有一次要换到第 2 张以上
// （最多 MAP_TRIES 张）。换来的是每次跑都真的验证了「贴画面点得中、贴地面点不中」。
let mapTries = 0;
let mapsUsed = 0;
for (mapTries = 1; mapTries <= MAP_TRIES && !usable; mapTries++) {
  mapsUsed = mapTries;
  if (mapTries > 1) {
    made = newGame(mapTries - 1);
    g = made.st;
    opts = made.opts;
    renderGame(g, opts);
    survey = surveyLift(g);
  }
  spot = pickSlopedSpot();
  // spawnUnit 会把部队挪到最近的可通行格（可能换了一层），所以摆好后再重新量一次
  hero = spot ? wf.__test.spawnUnit(g, { id: 9001, owner: 0, level: 1 }, 'shield', spot.x, spot.y) : null;
  heroLift = hero ? liftAt(hero.x, hero.y) : 0;
  // 够不够有区分力：错位量要大于点选容差，否则「点对」和「点错一层」都算命中
  usable = Boolean(hero) && Math.abs(heroLift) > CLICK_TOL + 6;
}

const lifts = survey.seen;
const maxLift = survey.max;
ok(lifts.size > 1, '地图确实有起伏（取到 ' + lifts.size + ' 种抬升值）');
ok(Math.abs(maxLift) >= HEIGHT_STEP, '至少有一处落差 ≥ 1 层（最大 ' + maxLift + 'px）');
ok(Math.abs(maxLift) % HEIGHT_STEP === 0, '抬升值都是 HEIGHT_STEP 的整数倍');

console.log('\n[2] 首帧渲染 + 把一支兵摆到最陡的那块地上');
const cam0 = camFromLastFrame();
ok(Boolean(cam0) && Number.isFinite(cam0.x), '相机变换矩阵可解析');
ok(log.texts.includes('总 部') || log.texts.includes('研 究 所'), '世界内容绘制完成');
ok(log.rects.length > 0 && log.points.length > 0, '画布上确实有落笔（不是空帧）');

ok(Boolean(spot), '找到有落差的空地' + (spot ? '（' + spot.L + 'px）' : ''));
ok(Boolean(hero), '在上面摆了一支我方盾卫');
ok(
  usable,
  '这道坡够陡：错位 ' +
    heroLift +
    'px > 点选容差 ' +
    CLICK_TOL.toFixed(1) +
    'px（断言才有区分力；第 ' +
    mapsUsed +
    '/' +
    MAP_TRIES +
    ' 张随机图够陡）'
);

Ui.applySnapshot(wf.snapshot(g));
pump();

if (usable) {
  // 每支部队都会被画一个「归属底色盘」椭圆：圆心应落在 groundY 上，而不是它的地面坐标上。
  const cam = camFromLastFrame();
  const invX = (px) => px / cam.k + cam.x;
  const invY = (py) => py / cam.k + cam.y; // 注意用 cam.y，别跟着 x 走
  const centers = log.ellipses.map(([px, py]) => [invX(px), invY(py)]);
  // padY = u.y + 11*f，f = 全局缩放 × 体型系数 ≈ 1.2：给 0..30 的窗足够宽松又不至于误判
  const inWin = (base) => centers.some((c) => Math.abs(c[0] - hero.x) < 1.5 && c[1] > base - 2 && c[1] < base + 30);
  const onVisual = inWin(visY(hero.x, hero.y));
  const onRawGround = inWin(hero.y);
  // 失败时把现场带上：最可能的原因是这一支没被画（例如快照没把它带过来）
  const diag = () => {
    const near = centers.filter((c) => Math.abs(c[0] - hero.x) < 1.5);
    return (
      '错位 ' + heroLift + 'px、底盘应落在 y=' + visY(hero.x, hero.y).toFixed(1) +
      '，该 x 上共 ' + near.length + ' 个椭圆圆心' +
      (near.length ? '：' + near.slice(0, 6).map((c) => c[1].toFixed(1)).join(',') : '（这一支没被画）')
    );
  };
  ok(onVisual, '它的底盘被画在抬升后的位置（groundY）上 → ' + (onVisual ? '' : diag()));
  ok(!onRawGround, '没有被画在原来的地面坐标上（' + diag() + '）');
}

console.log('\n[3] 光标 → 世界坐标：点画面上的它要选中，点它的地面坐标要选不中');
const canvasEl = el('warfactory-canvas');
function clickAt(wx, wy) {
  const cam = camFromLastFrame();
  if (!cam) return false;
  const evt = { button: 0, clientX: wx - cam.x, clientY: wy - cam.y, preventDefault() {}, shiftKey: false };
  canvasEl.dispatch('mousedown', evt);
  canvasEl.dispatch('mouseup', evt);
  pump();
  return true;
}
const countText = () => String(el('wov-count').textContent || '');
if (usable) {
  clickAt(hero.x + 600, hero.y + 600); // 先点空地清空选择
  const cleared = countText();
  clickAt(hero.x, visY(hero.x, hero.y));
  const hitVisual = countText();
  ok(hitVisual === '已选 1 支', '点画面上的它 → 选中（' + cleared + ' → ' + hitVisual + '）');
  clickAt(hero.x + 600, hero.y + 600);
  const cleared2 = countText();
  clickAt(hero.x, hero.y); // 只差一个抬升量：点在地层面（视觉上错了一层）→ 应当落空
  const hitRaw = countText();
  ok(hitRaw !== '已选 1 支', '点错一层 → 选不中（' + cleared2 + ' → ' + hitRaw + '）');
} else {
  // 「这坡够不够陡」上面已经判过一次了，这里不重复计数，只说清楚为什么跳过了点选那一段
  console.log('  · ' + MAP_TRIES + ' 张随机图都没找到足够陡的落脚点，点选用例跳过');
}

console.log('\n[4] 连续若干帧不报错（覆盖光束 / 弹道 / 特效 / 火舌这些改动过的分支）');
let frameErr = null;
try {
  let now = Date.now();
  for (let i = 0; i < 60; i++) {
    wf.__test.step(g, 0.05, (now += 50));
    Ui.applySnapshot(wf.snapshot(g));
    pump();
  }
} catch (err) {
  frameErr = err;
}
ok(!frameErr, '连跑 60 帧无异常' + (frameErr ? '：' + frameErr.message : ''));

console.log('\n[5] 坡与崖：等高线 + 崖壁立面（与 public 同一套画法，真渲染量一遍）');

// 配色 / 线宽从源码读：改了 mobile 的 ui.js 这边自动跟着走，不会因为调色误报
const CONTOUR_CLIFF_C = (/const CONTOUR_CLIFF = '([^']+)'/.exec(src) || [0, ''])[1];
const CONTOUR_SLOPE_C = (/const CONTOUR_SLOPE = '([^']+)'/.exec(src) || [0, ''])[1];
const CLIFF_FACE_C = (/const CLIFF_FACE = '([^']+)'/.exec(src) || [0, ''])[1];
const SLOPE_FACE_C = (/const SLOPE_FACE = '([^']+)'/.exec(src) || [0, ''])[1];
const CLIFF_W_PX = Number((/const CONTOUR_CLIFF_W = ([\d.]+);/.exec(src) || [0, 0])[1]) || 0;
const SLOPE_W_PX = Number((/const CONTOUR_SLOPE_W = ([\d.]+);/.exec(src) || [0, 0])[1]) || 0;

// 固定主题（群山）再量：崖是「量出来的」断言，随机主题可能整图没几条崖
const gCliff = wf.createGameState({
  id: 'mobile-cliff',
  players: [
    { id: 'mc0', name: '崖左' },
    { id: 'mc1', name: '崖右' },
  ],
  theme: 'mountain',
});
gCliff.phase = 'playing';
gCliff.phaseEndsAt = 0;
// 换玩家 id：Ui 用「世界尺寸 + 玩家 id + 工厂数」判断是不是新局，不换 id 就不重铺地形 / 收等高线
const viewCliff = { meId: 'mc0', isSpectator: false, t: (k) => k, title: '战争工厂' };
// 分两步量：地形贴图是换局时**同步**烘的（崖壁立面），等高线是**每帧**画的（走 rAF）。
// 混在一帧里量会错位 —— 这在 public 那边踩过一次。
pump();
const clearStrokes = () => {
  log.strokes.length = 0;
  log.strokeStyles.length = 0;
  log.strokeMags.length = 0;
};
clearStrokes();
log.rects.length = 0;
Ui.render(wf.publicGameState(gCliff), net, viewCliff);
Ui.applySnapshot(wf.snapshot(gCliff));
const cliffRects = log.rects.filter((r) => r[4] === CLIFF_FACE_C);
const slopeRects = log.rects.filter((r) => r[4] === SLOPE_FACE_C);
clearStrokes();
pump();

const cnC = Ui.heights.contours();
ok(cnC.cliffAt === WFData.height.cliffAt, `崖判据与服务端一致（层差 ≥ ${cnC.cliffAt}）`);
ok(cnC.terrace === WFData.height.terrace, `台地档位与服务端一致（${cnC.terrace} 层一档）`);
ok(cnC.cliff > 0, `崖线收出来了（${cnC.cliff} 段）`);
ok(cnC.slope > 0, `坡线收出来了（${cnC.slope} 段）`);

// 镜头对准「崖与坡相邻」的那块地再量笔画：默认镜头可能正好罩不到坡线。
// ⚠️ 前面几节可能把倍率拧大了，先拉到最远再导航，否则邻域里的坡线根本不在视野里。
const cliffSpot = Ui.heights.spot(900);
ok(cliffSpot, '找得到「崖与坡相邻」的取样点');
if (cliffSpot) {
  const cvC = el('warfactory-canvas');
  for (let i = 0; i < 24; i++) {
    cvC.dispatch('wheel', { deltaY: 800, deltaMode: 0, clientX: 640, clientY: 400, preventDefault() {} });
  }
  pump();
  const worldC = wf.publicGameState(gCliff).world;
  const miniC = el('warfactory-minimap');
  const mrC = miniC.getBoundingClientRect();
  const meC = {
    button: 0,
    clientX: mrC.left + (cliffSpot.x / worldC.w) * mrC.width,
    clientY: mrC.top + (cliffSpot.y / worldC.h) * mrC.height,
    preventDefault() {},
  };
  miniC.dispatch('mousedown', meC);
  miniC.dispatch('mouseup', meC);
  clearStrokes();
  pump();
}

// 线宽按屏幕像素补偿：lineWidth × 当时变换倍率 应恒等于源码里那个屏幕粗细。
// 无论缩放到哪一档这条乘积都不该变 —— 变了就是「拉远看不见」的老毛病回来了。
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
const nearPx = (arr, v) => arr.length > 0 && arr.every((x) => Math.abs(x - v) < 0.35);
const avgPx = (arr) => (arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : '-');
ok(nearPx(cliffProds, CLIFF_W_PX), `崖线屏幕粗细恒定 ${CLIFF_W_PX}px（实测 ${cliffProds.length} 笔，均值 ${avgPx(cliffProds)}px）`);
ok(nearPx(slopeProds, SLOPE_W_PX), `坡线屏幕粗细恒定 ${SLOPE_W_PX}px（实测 ${slopeProds.length} 笔，均值 ${avgPx(slopeProds)}px）`);

// 崖壁立面（烘进地形贴图的那一面）：有崖就该有「暗色墙面」的矩形落笔
ok(cliffRects.length > 0, `崖壁立面画出来了（${cliffRects.length} 笔暗色墙面）`);
ok(slopeRects.length > 0, `坡面画出来了（${slopeRects.length} 笔浅色斜面）`);
// 崖壁必须明显比坡面暗：一眼分「过不去 / 走得上去」靠的就是这个对比
ok(CLIFF_FACE_C !== SLOPE_FACE_C, `崖与坡用的是两套颜色（${CLIFF_FACE_C} / ${SLOPE_FACE_C}）`);

console.log('\n[5b] 地势射程环（与 public 同一套：高打低外扩 / 低打高收缩）');

const RELIEF_GAIN_C = (/const RELIEF_GAIN = '([^']+)'/.exec(src) || [0, ''])[1];
const RELIEF_LOSS_C = (/const RELIEF_LOSS = '([^']+)'/.exec(src) || [0, ''])[1];
const RELIEF_ANGLES_N = Number((/const RELIEF_ANGLES = (\d+);/.exec(src) || [0, 0])[1]) || 0;
const RELIEF_STEP_N = Number((/const RELIEF_STEP = (\d+);/.exec(src) || [0, 0])[1]) || 0;
const TCELL_N = Number((/const TERRAIN_CELL = (\d+);/.exec(src) || [0, 40])[1]) || 40;

ok(typeof Ui.heights.relief === 'function', '导出 relief()（与 public 同名字同语义）');
ok(Ui.heights.stepPx() > 0, `每 1 层高低差 = ${Ui.heights.stepPx()}px 射程（服务端 consts 已落到 mobile 端）`);

// ⚠️ 必须先把这一局喂回 client：[5] 那一段把 gCliff 的地形/高度场留在了 client 里，
// 不重 render 就按 gCliff 的高度场去找落点，摆到 g 上却完全是另一张图 → 量出来的环对不上。
renderGame(g, opts);

// mobile 端最容易踩的坑不是算法（那段与 public 逐字相同），而是**缺个 helper 一跑就炸**
// （移植时就真缺过 gridCell()）。所以这里必须真渲染一遍：选中 → 一帧 → 量落笔。
const gridRel = g.terrain.grid;
const terrRel = (r, c) => (gridRel[r] ? gridRel[r][c] : -1);
const BASE_REL = (wf.publicGameState(g).consts.stats.ranger && wf.publicGameState(g).consts.stats.ranger.range) || 180;
/** 射线上有没有撞山（撞上就是被挡，不是高低差造成的） */
const blockedRel = (x, y, ux, uy, dmax) => {
  for (let d = 2 * RELIEF_STEP_N; d <= dmax + RELIEF_STEP_N; d += RELIEF_STEP_N) {
    if (terrRel(Math.floor((y + uy * d) / TCELL_N), Math.floor((x + ux * d) / TCELL_N)) === 2) return true;
  }
  return false;
};
/** 这一处环有没有真的变形（既鼓出去又削掉）—— 平地上环是正圆，量不出东西 */
const deformOf = (x, y) => {
  const ring = Ui.heights.relief({ x, y, type: 'ranger', tier: 1 }, BASE_REL);
  if (ring.length !== RELIEF_ANGLES_N) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = (i / ring.length) * Math.PI * 2;
    if (blockedRel(x, y, Math.cos(a), Math.sin(a), ring[i])) continue;
    if (ring[i] > BASE_REL) gain++;
    else if (ring[i] < BASE_REL) loss++;
  }
  return gain > 0 && loss > 0 ? { ring, gain, loss } : null;
};

// 摆一支我方游侠到「一边高一边低」的地方（spawnUnit 可能挪到最近可通行格，摆完再复量一次）
let heroRel = null;
let spotRel = null;
for (let r = 8; r < 280 && !spotRel; r += 3) {
  for (let c = 8; c < 280; c += 3) {
    if (terrRel(r, c) !== 0) continue;
    if (!deformOf((c + 0.5) * TCELL_N, (r + 0.5) * TCELL_N)) continue;
    const u = wf.__test.spawnUnit(g, { id: 9101, owner: 0, level: 1 }, 'ranger', (c + 0.5) * TCELL_N, (r + 0.5) * TCELL_N);
    const d = u ? deformOf(u.x, u.y) : null;
    if (d) {
      heroRel = u;
      spotRel = d;
      break;
    }
  }
}
ok(Boolean(spotRel), '找得到一处「一边高一边低」的落脚点');
if (spotRel) {
  const mx = Math.max.apply(null, spotRel.ring);
  const mn = Math.min.apply(null, spotRel.ring);
  ok(mx > BASE_REL && mn < BASE_REL, `环随高度变形：最远 ${mx}px / 最窄 ${mn}px（基准 ${BASE_REL}px）`);
  // 落笔时是 hexAlpha() 转出的 rgba(...)，按前缀比对（比 hex 永远对不上）
  const rgbPre = (h) => {
    const s = String(h).replace('#', '');
    return s.length === 6
      ? 'rgba(' + parseInt(s.slice(0, 2), 16) + ',' + parseInt(s.slice(2, 4), 16) + ',' + parseInt(s.slice(4, 6), 16) + ','
      : '';
  };
  const GAIN_PRE = rgbPre(RELIEF_GAIN_C);
  const LOSS_PRE = rgbPre(RELIEF_LOSS_C);
  const countPre = (pre) => log.strokeStyles.filter((s) => String(s).indexOf(pre) === 0).length;
  // 把镜头挪到落脚点：默认镜头可能正好罩不到它，点下去的画布坐标落在屏幕外就选不中。
  const cvR = el('warfactory-canvas');
  for (let i = 0; i < 24; i++) {
    cvR.dispatch('wheel', { deltaY: 800, deltaMode: 0, clientX: 640, clientY: 400, preventDefault() {} });
  }
  pump();
  const worldR = wf.publicGameState(g).world;
  const miniR = el('warfactory-minimap');
  const mrR = miniR.getBoundingClientRect();
  const meR = {
    button: 0,
    clientX: mrR.left + (heroRel.x / worldR.w) * mrR.width,
    clientY: mrR.top + (heroRel.y / worldR.h) * mrR.height,
    preventDefault() {},
  };
  miniR.dispatch('mousedown', meR);
  miniR.dispatch('mouseup', meR);
  Ui.applySnapshot(wf.snapshot(g));
  pump();
  clearStrokes();
  pump();
  ok(countPre(GAIN_PRE) === 0 && countPre(LOSS_PRE) === 0, '没选中时地图上不画射程环（不打扰）');
  // ⚠️ clickAt() 是 [3] 那节写的，那里镜头倍率还是 1；这边为了看清已经拉远了，
  // 画布坐标必须乘 cam.k —— 照抄 clickAt 会把点落到屏幕外，选不中就什么都量不到。
  {
    const cam = camFromLastFrame();
    const evt = {
      button: 0,
      clientX: (heroRel.x - cam.x) * cam.k,
      clientY: (visY(heroRel.x, heroRel.y) - cam.y) * cam.k,
      preventDefault() {},
      shiftKey: false,
    };
    canvasEl.dispatch('mousedown', evt);
    canvasEl.dispatch('mouseup', evt);
    pump();
  }
  clearStrokes();
  pump();
  const gainN = countPre(GAIN_PRE);
  const lossN = countPre(LOSS_PRE);
  ok(gainN > 0, `选中后画出了「占便宜」一侧（暖金描边 ${gainN} 笔）`);
  ok(lossN > 0, `选中后画出了「吃亏」一侧（冷灰描边 ${lossN} 笔）`);
  ok(RELIEF_GAIN_C !== RELIEF_LOSS_C, '占便宜与吃亏是两套颜色');
}

console.log('\n[6] 与 public 版保持同一套做法（源码核对）');
ok(/function visualToWorldY\(x, vy\)/.test(src), '用逐个候选反推画面 y（不是会抖的迭代式）');
ok(/y: visualToWorldY\(cam\.x \+ mx, cam\.y \+ my\)/.test(src), 'eventWorldPos 走 visualToWorldY');
ok(/function groundY\(x, y\) \{/.test(src) && /return y - liftAt\(x, y\);/.test(src), 'groundY 与 liftCell 同源');
ok(/c\.translate\(f\.x, groundY\(f\.x, f\.y\)\)/.test(src), '工厂跟随它脚下那层地');
ok(/c\.translate\(h\.x, groundY\(h\.x, h\.y\)\)/.test(src), '总部跟随它脚下那层地');
ok(/c\.translate\(l\.x, groundY\(l\.x, l\.y\)\)/.test(src), '研究所跟随它脚下那层地');
ok(/translate\(0, groundY\(u\.x, u\.y\) - u\.y\)/.test(src), '整支部队一次 translate 到位');
ok(/const wy2 = wy - liftAt\(wx, wy\);/.test(src), '命中判定也按画面位置对齐');

console.log(
  '\n' + (failed ? '✗ ' + failed + ' 项未通过' : '✓ 全部通过') + '\n'
);
process.exitCode = failed ? 1 : 0;
