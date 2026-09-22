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

const log = { texts: [], setTransforms: [], rafCbs: [], strokes: [], dashes: [] };
const sent = [];

function makeCtx() {
  const grad = { addColorStop() {} };
  const st = { lineWidth: 1, strokeStyle: '', fillStyle: '', lineCap: 'butt' };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'measureText') return () => ({ width: 40 });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => grad;
        if (prop === 'getImageData') return () => ({ data: [] });
        if (prop === 'fillText') return (txt) => log.texts.push(String(txt));
        if (prop === 'stroke') return () => log.strokes.push(st.lineWidth);
        if (prop === 'setLineDash') return (d) => log.dashes.push(Array.isArray(d) ? d.slice() : []);
        if (prop === 'setTransform') {
          return (a, b, c, d, e, f) => log.setTransforms.push([a, b, c, d, e, f]);
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
  const node = {
    id,
    hidden: false,
    textContent: '',
    style: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
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
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    width: 1280,
    height: 800,
    clientWidth: 1280,
    clientHeight: 800,
  };
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
  window: {
    addEventListener() {},
    removeEventListener() {},
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 800,
    document: documentStub,
  },
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
ok(log.texts.includes('620'), '显示当前科技点');
ok(texts().includes('+3 / 秒 · 研究所 ×1'), '显示每秒产出与研究所数');
ok(log.texts.includes('可进化 ×1'), '≥500 时显示可进化次数');
g.players[0].rp = 380;
Ui.applySnapshot(wf.snapshot(g));
pump();
ok(texts().includes('380 / 500'), '不足 500 时显示进度 x/500');

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
ok(clickWorld(hq0.x, hq0.y), '点击总部');
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
canvasEl.dispatch('mousedown', { button: 0, clientX: 4, clientY: 796, preventDefault() {}, shiftKey: false });
canvasEl.dispatch('mouseup', { button: 0, clientX: 4, clientY: 796, preventDefault() {}, shiftKey: false });
pump();
ok(panel.hidden === true, '面板收起');

console.log('\n[9] 记分牌');
const cards = el('warfactory-scores').children;
const cardText = (i) => cards[i].children.map((c) => c.textContent).join(' ');
ok(cards.length === 2, '2 张卡片（' + cards.length + '）');
ok(cardText(0).includes('甲'), '显示玩家名');
ok(cardText(0).includes('科 '), '显示科技点');
ok(cardText(0).includes('所 '), '显示研究所数');

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

console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
