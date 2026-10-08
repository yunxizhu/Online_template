'use strict';
/**
 * 临时取证脚本：把真实 ui.js 画出来的地形导出成 SVG（无头 Chrome 在本机跑不起来）。
 * 用 vm + 假 DOM/canvas 真加载 public/games/warfactory/ui.js，喂一局真实对局触发
 * setTerrainGrid → paintTerrain，再把离屏地形画布上的每一笔录成 SVG。
 * 用法：node scripts/_terrain-svg.js [主题]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));

/* ---------------- 记录型 canvas ---------------- */
const canvases = [];
function makeCtx() {
  const st = { lineWidth: 1, strokeStyle: '', fillStyle: '', lineCap: 'butt' };
  const xf = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, stack: [] };
  const ops = [];
  const grads = [];
  let cur = [];
  const X = (x, y) => xf.a * x + xf.c * y + xf.e;
  const Y = (x, y) => xf.b * x + xf.d * y + xf.f;
  const mul = (a2, b2, c2, d2, e2, f2) => {
    const { a, b, c, d, e, f } = xf;
    xf.a = a * a2 + c * b2; xf.b = b * a2 + d * b2;
    xf.c = a * c2 + c * d2; xf.d = b * c2 + d * d2;
    xf.e = a * e2 + c * f2 + e; xf.f = b * e2 + d * f2 + f;
  };
  const ctx = new Proxy({}, {
    get(_t, p) {
      switch (p) {
        case 'measureText': return () => ({ width: 40 });
        case 'createLinearGradient':
          return (x0, y0, x1, y1) => {
            const g = { __i: grads.length, x0: X(x0, y0), y0: Y(x0, y0), x1: X(x1, y1), y1: Y(x1, y1), stops: [] };
            grads.push(g);
            return { addColorStop: (o, c) => g.stops.push([o, c]), __grad: g };
          };
        case 'createRadialGradient':
          return () => ({ addColorStop() {} });
        case 'getImageData': return () => ({ data: [] });
        case 'fillRect':
          return (x, y, w, h) => ops.push({ t: 'fr', x: X(x, y), y: Y(x, y), w: w * xf.a, h: h * xf.d, f: st.fillStyle });
        case 'strokeRect':
          return (x, y, w, h) => ops.push({ t: 'sr', x: X(x, y), y: Y(x, y), w: w * xf.a, h: h * xf.d, s: st.strokeStyle, lw: st.lineWidth });
        case 'fill': return () => ops.push({ t: 'f', p: cur.slice(), f: st.fillStyle });
        case 'stroke': return () => ops.push({ t: 's', p: cur.slice(), s: st.strokeStyle, lw: st.lineWidth });
        case 'beginPath': return () => { cur = []; };
        case 'moveTo': return (x, y) => cur.push(['M', X(x, y), Y(x, y)]);
        case 'lineTo': return (x, y) => cur.push(['L', X(x, y), Y(x, y)]);
        case 'quadraticCurveTo': return (cx, cy, x, y) => cur.push(['Q', X(cx, cy), Y(cx, cy), X(x, y), Y(x, y)]);
        case 'bezierCurveTo': return (a, b, c, d, x, y) => cur.push(['C', X(a, b), Y(a, b), X(c, d), Y(c, d), X(x, y), Y(x, y)]);
        case 'arc': return (x, y, r) => cur.push(['A', X(x, y), Y(x, y), r * xf.a]);
        case 'ellipse': return (x, y, rx, ry) => cur.push(['E', X(x, y), Y(x, y), rx * xf.a, ry * xf.d]);
        case 'rect': return (x, y, w, h) => cur.push(['R', X(x, y), Y(x, y), w, h]);
        case 'closePath': return () => cur.push(['Z']);
        case 'save': return () => xf.stack.push([xf.a, xf.b, xf.c, xf.d, xf.e, xf.f]);
        case 'restore': return () => { const s = xf.stack.pop(); if (s) [xf.a, xf.b, xf.c, xf.d, xf.e, xf.f] = s; };
        case 'translate': return (x, y) => mul(1, 0, 0, 1, x, y);
        case 'scale': return (sx, sy) => mul(sx, 0, 0, sy, 0, 0);
        case 'rotate': return (r) => mul(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0);
        case 'transform': return (a, b, c, d, e, f) => mul(a, b, c, d, e, f);
        case 'setTransform': return (a, b, c, d, e, f) => { xf.a = a; xf.b = b; xf.c = c; xf.d = d; xf.e = e; xf.f = f; };
        default:
          if (p in st) return st[p];
          return () => {};
      }
    },
    set(_t, p, v) { if (p in st) st[p] = v; return true; },
  });
  return { ctx, ops, grads };
}

/* ---------------- 极简假 DOM ---------------- */
const els = {};
let seq = 0;
function el(id) {
  if (els[id]) return els[id];
  const handlers = {};
  const node = {
    id, hidden: false, textContent: '', style: {}, children: [], tagName: 'DIV',
    classList: { add() {}, remove() {}, toggle() { return false; }, contains: () => false },
    addEventListener(t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
    removeEventListener() {}, dispatch(t, e) { for (const fn of handlers[t] || []) fn(e); },
    getAttribute: () => null, setAttribute() {}, removeAttribute() {},
    click() {}, remove() {},
    appendChild(c) { node.children.push(c); return c; }, insertBefore(c) { node.children.push(c); return c; },
    querySelector: (s) => el(id + ' ' + s), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    width: 1280, height: 800, clientWidth: 1280, clientHeight: 800,
  };
  let cx = null;
  node.getContext = () => {
    if (!cx) { cx = makeCtx(); canvases.push({ id, w: node.width, h: node.height, ...cx }); }
    return cx.ctx;
  };
  Object.defineProperty(node, 'className', { get: () => '', set() {} });
  Object.defineProperty(node, 'innerHTML', { get: () => '', set() { node.children.length = 0; } });
  els[id] = node;
  return node;
}
const documentStub = {
  getElementById: (id) => el(id),
  createElement: () => el('created-' + seq++),
  querySelector: (s) => el(s),
  querySelectorAll: () => [],
  addEventListener() {},
  body: { appendChild() {} },
};
const winStub = {
  addEventListener() {}, removeEventListener() {}, dispatch() {},
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800, document: documentStub, confirm: () => true,
};
const sandbox = {
  console, Math, Date, JSON, Object, Array, Number, String, Boolean, Set, Map, Infinity, NaN,
  performance: { now: () => Date.now() },
  Blob: function B(p) { this.parts = p; }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  document: documentStub, window: winStub,
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, clearTimeout,
};
sandbox.globalThis = sandbox;

const src = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const Ui = sandbox.window.WarFactoryUi;

/* ---------------- 造一局，选一个「山水坡全有」的窗口 ---------------- */
const theme = process.argv[2] || '';
const g = wf.createGameState({
  id: 'svg-' + (theme || 'rand'),
  players: [{ id: 's0', name: '甲' }, { id: 's1', name: '乙' }],
  theme: theme || undefined,
});
g.phase = 'playing';
g.phaseEndsAt = 0;
const st = wf.publicGameState(g);
Ui.render(st, { on() {}, sendRt() {}, emitRaw() {} }, { meId: 's0', isSpectator: false, t: (k) => k, title: '战争工厂' });

const terr = st.terrain;
const off = (st.consts && st.consts.heightOff) || 3;
const T = terr.data, H = terr.heights, COLS = terr.cols, ROWS = terr.rows;
const typAt = (r, c) => T.charCodeAt(r * COLS + c) - 48;
const lvAt = (r, c) => H.charCodeAt(r * COLS + c) - 48 - off;

const WC = 30, WR = 20; // 窗口：30×20 格
let best = null;
for (let r = 0; r + WR < ROWS; r += 2) {
  for (let c = 0; c + WC < COLS; c += 2) {
    let mtn = 0, wat = 0, sl = 0;
    for (let r2 = r; r2 < r + WR; r2++) {
      for (let c2 = c; c2 < c + WC; c2++) {
        const t = typAt(r2, c2);
        if (t === 2) mtn++;
        else if (t === 4) wat++;
        if (c2 + 1 < COLS && t !== 2 && t !== 4 && typAt(r2, c2 + 1) !== 2 && typAt(r2, c2 + 1) !== 4 && Math.abs(lvAt(r2, c2) - lvAt(r2, c2 + 1)) === 1) sl++;
      }
    }
    const score = Math.min(mtn, 40) + Math.min(wat, 40) + Math.min(sl, 12) * 3;
    if (!best || score > best.score) best = { r, c, mtn, wat, sl, score };
  }
}

// 地形离屏画布：宽 = 世界宽的那一张
const tc = canvases.filter((x) => x.w >= 11520 && x.ops.length > 500).pop();
if (!tc) { console.log('没找到地形画布，已创建的画布：' + canvases.map((c) => c.w + 'x' + c.h + ':' + c.ops.length).join(', ')); process.exit(1); }
const offY = tc.h - 11520 - 96; // dn = (levels + WAT_SINK + RIM_STEPS) * 13 + 1
const CELL = 40;
const wx0 = best.c * CELL, wy0 = best.r * CELL;
const PAD_UP = 170, PAD_DN = 60;
const vx = wx0, vy = wy0 + offY - PAD_UP;
const vw = WC * CELL, vh = WR * CELL + PAD_UP + PAD_DN;

/* ---------------- 导出 SVG ---------------- */
const gradIds = new Map();
const defs = [];
function paintOf(v) {
  if (v && typeof v === 'object' && v.__grad) {
    const g2 = v.__grad;
    if (!gradIds.has(g2)) {
      const id = 'g' + gradIds.size;
      gradIds.set(g2, id);
      const st2 = g2.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${g2.x0.toFixed(1)}" y1="${g2.y0.toFixed(1)}" x2="${g2.x1.toFixed(1)}" y2="${g2.y1.toFixed(1)}">${st2}</linearGradient>`);
    }
    return `url(#${gradIds.get(g2)})`;
  }
  return String(v || 'none');
}
function dOf(p) {
  return p.map((s) => (s[0] === 'M' ? `M${s[1].toFixed(1)} ${s[2].toFixed(1)}` : s[0] === 'L' ? `L${s[1].toFixed(1)} ${s[2].toFixed(1)}` : s[0] === 'Q' ? `Q${s[1].toFixed(1)} ${s[2].toFixed(1)} ${s[3].toFixed(1)} ${s[4].toFixed(1)}` : s[0] === 'Z' ? 'Z' : '')).join(' ');
}
const inView = (x, y, w, h) => x + (w || 0) > vx && x < vx + vw && y + (h || 0) > vy && y < vy + vh;
const body = [];
let skipped = 0;
for (const o of tc.ops) {
  if (o.t === 'fr') {
    if (!inView(o.x, o.y, o.w, o.h)) { skipped++; continue; }
    body.push(`<rect x="${o.x.toFixed(1)}" y="${o.y.toFixed(1)}" width="${o.w.toFixed(1)}" height="${o.h.toFixed(1)}" fill="${paintOf(o.f)}"/>`);
  } else {
    const d = dOf(o.p);
    if (!d) continue;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const s of o.p) for (let i = 1; i + 1 < s.length; i += 2) { minx = Math.min(minx, s[i]); maxx = Math.max(maxx, s[i]); miny = Math.min(miny, s[i + 1]); maxy = Math.max(maxy, s[i + 1]); }
    if (!inView(minx, miny, maxx - minx, maxy - miny)) { skipped++; continue; }
    if (o.t === 'f') body.push(`<path d="${d}" fill="${paintOf(o.f)}"/>`);
    else body.push(`<path d="${d}" fill="none" stroke="${paintOf(o.s)}" stroke-width="${(o.lw || 1).toFixed(2)}"/>`);
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}">
<defs>${defs.join('')}</defs>
<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#efe8d8"/>
${body.join('\n')}
</svg>`;
const out = path.join(ROOT, 'docs/_terrain-svg-' + (theme || 'rand') + '.html');
fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>地形取证 ${theme || '随机'}</title>
<body style="margin:0;background:#1e1b16;color:#e8e2d4;font:13px/1.6 sans-serif">
<div style="padding:8px 12px">主题 ${theme || '随机'} · 窗口 行${best.r} 列${best.c} · 山${best.mtn} 水${best.wat} 坡${best.sl} · 笔数 ${body.length}（窗外略去 ${skipped}）</div>
${svg}</body>`, 'utf8');
console.log('wrote ' + out);
console.log(`窗口 行${best.r} 列${best.c} 山${best.mtn} 水${best.wat} 坡${best.sl}  导出 ${body.length} 笔`);

/* ---------------- 数值体检：山多高 / 水多深 / 坡多缓 ---------------- */
const pick = (name) => {
  const m = new RegExp("const " + name + " = '([^']+)'").exec(src);
  return m ? m[1] : null;
};
const NAMES = {
  [pick('WALL_MTN')]: '山峭壁',
  [pick('BANK_FACE')]: '水岸壁',
  [pick('CLIFF_FACE')]: '崖',
  [pick('SLOPE_FACE')]: '坡肩',
};
const stat = {};
for (const o of tc.ops) {
  if (o.t !== 'fr') continue;
  const n = NAMES[o.f];
  if (!n) continue;
  (stat[n] = stat[n] || []).push(o.h);
}
const fmt = (a) => {
  if (!a || !a.length) return '0 笔';
  a = a.slice().sort((x, y) => x - y);
  const avg = a.reduce((s, v) => s + v, 0) / a.length;
  return `${a.length} 笔，高 ${a[0].toFixed(0)}~${a[a.length - 1].toFixed(0)}px（均 ${avg.toFixed(0)}）`;
};
console.log('— 立面高度体检 —');
for (const k of ['山峭壁', '水岸壁', '崖', '坡肩']) console.log('  ' + k + '：' + fmt(stat[k]));
let crown = 0, peakTop = 0;
for (const o of tc.ops) {
  if (o.t !== 'f' && o.t !== 's') continue;
  for (const s of o.p) if (s[0] === 'M' || s[0] === 'L') peakTop = Math.min(peakTop, s[2]);
}
for (const o of tc.ops) if (o.t === 'f' && typeof o.f === 'string' && /^rgba\((44,38,28|150,142,124)/.test(o.f)) crown++;
console.log(`  山冠（受光+背光两片）：${crown} 笔`);
