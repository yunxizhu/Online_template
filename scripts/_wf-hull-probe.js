'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');

// 自返回的 Proxy：任何属性都是函数，调用返回自身 → 链式调用 / 取值都不会崩
function makeCtx() {
  const target = function () {};
  const store = {};
  return new Proxy(target, {
    get(t, p) {
      if (p === 'canvas') return { width: 100, height: 100 };
      if (p === 'measureText') return () => ({ width: 0 });
      if (p in store) return store[p];
      // 颜色/数值属性读写都允许
      if (p === 'fillStyle' || p === 'strokeStyle' || p === 'lineWidth' ||
          p === 'lineJoin' || p === 'lineCap' || p === 'font' || p === 'textAlign' ||
          p === 'globalAlpha') return store[p];
      return (...args) => proxy; // 方法：no-op，返回自身
    },
    set(t, p, v) { store[p] = v; return true; },
    apply() { return proxy; },
  });
  function proxy() {}
}
const ctxProxy = makeCtx();

const calls = { stroke: 0, fill: 0, arc: 0, moveTo: 0 };
// 包装：统计关键调用数，验证「真的画了东西」
const counting = new Proxy(ctxProxy, {
  get(t, p) {
    const v = ctxProxy[p];
    if (typeof v === 'function' && p in calls) {
      return (...a) => { calls[p]++; return v.apply(ctxProxy, a); };
    }
    return v;
  },
});

const sandbox = {
  window: {},
  document: {
    createElement: () => ({ getContext: () => counting, width: 0, height: 0, style: {} }),
    getElementById: () => null,
    addEventListener: () => {},
  },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  console,
  Math, Date, JSON, TAU: Math.PI * 2,
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// ui.js 是 IIFE，结尾挂到 window.WarFactoryUi
const code = src + '\n;if (typeof WarFactoryUi === "undefined" && window.WarFactoryUi) {/*noop*/}';
try {
  vm.runInContext(code, sandbox, { filename: 'ui.js' });
} catch (e) {
  console.error('EVAL ERROR:', e && e.stack || e);
  process.exit(1);
}

const Ui = sandbox.window.WarFactoryUi || sandbox.WarFactoryUi;
if (!Ui) { console.error('WarFactoryUi 未挂载'); process.exit(1); }

const TYPES = ['warrior', 'shield', 'ranger', 'burst', 'burn', 'laser'];
let ok = 0, fail = 0;
for (const ty of TYPES) {
  for (let tier = 1; tier <= 3; tier++) {
    try {
      Ui.drawUnitParts(counting, ty, tier, 'A', '#b03a2e', 'base');
      Ui.drawUnitParts(counting, ty, tier, 'A', '#b03a2e', 'turret');
      ok++;
    } catch (e) {
      fail++;
      console.error('DRAW FAIL', ty, tier, e && e.message);
    }
  }
}
console.log('base+turret 绘制: ok=' + ok + ' fail=' + fail);
console.log('调用统计(base+turret 全部):', JSON.stringify(calls));
console.log(fail === 0 ? 'PROBE_OK' : 'PROBE_FAIL');
