// Capture the REAL draw calls of ui.js into SVG, to prove what the code renders.
// (No browser needed — a recording 2D context that transforms points by the CTM.)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const uiSrc = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');
const code = uiSrc.replace(/<\/script/gi, '<\\/script');

function matMul(A, B) {
  // A after B  (point p -> A*(B*p))
  return {
    a: A.a * B.a + A.c * B.b,
    c: A.a * B.c + A.c * B.d,
    e: A.a * B.e + A.c * B.f + A.e,
    b: A.b * B.a + A.d * B.b,
    d: A.b * B.c + A.d * B.d,
    f: A.b * B.e + A.d * B.f + A.f,
  };
}
function apply(M, x, y) { return [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f]; }

function makeCtx(opts) {
  const record = !!opts.record;
  const ops = [];
  let bounds = { minx: 1e9, miny: 1e9, maxx: -1e9, maxy: -1e9 };
  let ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack = [];
  let cur = null; // current subpath {pts:[], closed}
  let path = [];  // array of subpaths
  let fillStyle = '#000', strokeStyle = '#000', lineWidth = 1, lineJoin = 'miter', lineCap = 'butt', globalAlpha = 1;
  let last = [0, 0];

  function track(x, y) {
    if (x < bounds.minx) bounds.minx = x;
    if (y < bounds.miny) bounds.miny = y;
    if (x > bounds.maxx) bounds.maxx = x;
    if (y > bounds.maxy) bounds.maxy = y;
  }
  function P(x, y) { const p = apply(ctm, x, y); track(p[0], p[1]); return p; }

  const ctx = {
    get fillStyle() { return fillStyle; }, set fillStyle(v) { fillStyle = v; },
    get strokeStyle() { return strokeStyle; }, set strokeStyle(v) { strokeStyle = v; },
    get lineWidth() { return lineWidth; }, set lineWidth(v) { lineWidth = v; },
    get lineJoin() { return lineJoin; }, set lineJoin(v) { lineJoin = v; },
    get lineCap() { return lineCap; }, set lineCap(v) { lineCap = v; },
    get globalAlpha() { return globalAlpha; }, set globalAlpha(v) { globalAlpha = v; },
    save() { stack.push({ ctm, fillStyle, strokeStyle, lineWidth, lineJoin, lineCap, globalAlpha }); },
    restore() { const s = stack.pop(); ctm = s.ctm; fillStyle = s.fillStyle; strokeStyle = s.strokeStyle; lineWidth = s.lineWidth; lineJoin = s.lineJoin; lineCap = s.lineCap; globalAlpha = s.globalAlpha; },
    translate(x, y) { ctm = matMul(ctm, { a: 1, b: 0, c: 0, d: 1, e: x, f: y }); },
    rotate(a) { const co = Math.cos(a), si = Math.sin(a); ctm = matMul(ctm, { a: co, b: si, c: -si, d: co, e: 0, f: 0 }); },
    scale(x, y) { ctm = matMul(ctm, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 }); },
    transform(a, b, c, d, e, f) { ctm = matMul(ctm, { a, b, c, d, e, f }); },
    setTransform(a, b, c, d, e, f) { ctm = { a, b, c, d, e, f }; },
    resetTransform() { ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    beginPath() { path = []; cur = null; },
    closePath() { if (cur) cur.closed = true; },
    moveTo(x, y) { const p = P(x, y); cur = { pts: [p], closed: false }; path.push(cur); last = p; },
    lineTo(x, y) { const p = P(x, y); if (!cur) { cur = { pts: [p], closed: false }; path.push(cur); } else cur.pts.push(p); last = p; },
    rect(x, y, w, h) { const p0 = P(x, y), p1 = P(x + w, y), p2 = P(x + w, y + h), p3 = P(x, y + h); cur = { pts: [p0, p1, p2, p3], closed: true }; path.push(cur); last = p0; },
    arc(x, y, r, a0, a1) {
      const segs = Math.max(8, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 8)));
      const start = P(x + r * Math.cos(a0), y + r * Math.sin(a0));
      if (cur && cur.pts.length) cur.pts.push(start); else { cur = { pts: [start], closed: false }; path.push(cur); }
      for (let i = 1; i <= segs; i++) { const a = a0 + (a1 - a0) * (i / segs); const p = P(x + r * Math.cos(a), y + r * Math.sin(a)); cur.pts.push(p); last = p; }
    },
    ellipse(x, y, rx, ry, rot, a0, a1) {
      const segs = Math.max(10, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 8)));
      const start = P(x + rx * Math.cos(a0), y + ry * Math.sin(a0));
      if (cur && cur.pts.length) cur.pts.push(start); else { cur = { pts: [start], closed: false }; path.push(cur); }
      for (let i = 1; i <= segs; i++) { const a = a0 + (a1 - a0) * (i / segs); const p = P(x + rx * Math.cos(a), y + ry * Math.sin(a)); cur.pts.push(p); last = p; }
    },
    arcTo(cx, cy, x2, y2, r) { const p = P(x2, y2); if (cur) cur.pts.push(p); else { cur = { pts: [p], closed: false }; path.push(cur); } last = p; },
    roundRect(x, y, w, h, r) {
      const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
      const p0 = P(x + rr, y); if (!cur || !cur.pts.length) { cur = { pts: [p0], closed: false }; path.push(cur); } else cur.pts.push(p0);
      cur.pts.push(P(x + w - rr, y)); cur.pts.push(P(x + w, y + rr)); cur.pts.push(P(x + w, y + h - rr)); cur.pts.push(P(x + w - rr, y + h)); cur.pts.push(P(x + rr, y + h)); cur.pts.push(P(x, y + h - rr)); cur.pts.push(P(x, y + rr)); cur.closed = true; last = p0;
    },
    quadraticCurveTo(cx, cy, x, y) {
      const p0 = cur && cur.pts.length ? cur.pts[cur.pts.length - 1] : [0, 0];
      const N = 10; const sp = P(x, y);
      if (!cur || !cur.pts.length) { cur = { pts: [], closed: false }; path.push(cur); }
      for (let i = 1; i <= N; i++) { const t = i / N; const mt = 1 - t; const bx = mt * mt * p0[0] + 2 * mt * t * cx + t * t * x; const by = mt * mt * p0[1] + 2 * mt * t * cy + t * t * y; const p = P(bx, by); cur.pts.push(p); }
      last = sp;
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const p0 = cur && cur.pts.length ? cur.pts[cur.pts.length - 1] : [0, 0];
      const N = 12; const sp = P(x, y);
      if (!cur || !cur.pts.length) { cur = { pts: [], closed: false }; path.push(cur); }
      for (let i = 1; i <= N; i++) { const t = i / N; const mt = 1 - t; const bx = mt * mt * mt * p0[0] + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x; const by = mt * mt * mt * p0[1] + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y; const p = P(bx, by); cur.pts.push(p); }
      last = sp;
    },
    fill() { if (!record || !path.length) return; for (const sub of path) { if (sub.pts.length < 2) continue; let d = 'M' + sub.pts[0][0].toFixed(1) + ' ' + sub.pts[0][1].toFixed(1); for (let i = 1; i < sub.pts.length; i++) d += 'L' + sub.pts[i][0].toFixed(1) + ' ' + sub.pts[i][1].toFixed(1); if (sub.closed) d += 'Z'; ops.push({ d, fill: fillStyle, stroke: null }); } },
    stroke() { if (!record || !path.length) return; for (const sub of path) { if (sub.pts.length < 2) continue; let d = 'M' + sub.pts[0][0].toFixed(1) + ' ' + sub.pts[0][1].toFixed(1); for (let i = 1; i < sub.pts.length; i++) d += 'L' + sub.pts[i][0].toFixed(1) + ' ' + sub.pts[i][1].toFixed(1); if (sub.closed) d += 'Z'; ops.push({ d, fill: null, stroke: strokeStyle, w: lineWidth, join: lineJoin, cap: lineCap }); } },
    fillRect(x, y, w, h) { this.rect(x, y, w, h); this.fill(); },
    strokeRect(x, y, w, h) { this.rect(x, y, w, h); this.stroke(); },
    clip() {},
    setLineDash() {}, getLineDash() { return []; },
    fillText() {}, strokeText() {}, measureText() { return { width: 0 }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createPattern() { return null; },
    drawImage() {}, getImageData() { return { data: [] }; }, putImageData() {},
    ctxOps: ops, ctxBounds: bounds,
  };
  return ctx;
}

const sandbox = {
  window: {}, document: { createElement() { return { getContext() { return makeCtx({ record: false }); }, style: {}, width: 0, height: 0, appendChild() {} }; }, getElementById() { return null; }, addEventListener() {} },
  requestAnimationFrame() { return 0; }, cancelAnimationFrame() {}, console, Math, JSON, Date, meta: { players: [{ color: '#b03a2e' }], consts: { navMargin: 22, heightLevels: 3, heightCliff: 2, HEIGHT_STEP_PX: 13 } },
};
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'ui.js' });
const Ui = sandbox.window.WarFactoryUi;
if (!Ui) { console.error('FAIL'); process.exit(1); }

const TYPES = ['warrior', 'shield', 'ranger', 'burst', 'burn', 'laser'];
const LABEL = { warrior: '锐士·坦克炮', shield: '盾卫·无炮管(肉盾)', ranger: '游侠·长身狙击管', burst: '轰击·斜上迫击炮', burn: '燎原·喇叭喷火器', laser: '激光·棱镜' };
const COL = '#b03a2e';
const W = 230, H = 230, PAD = 22;

function renderCell(type, tier) {
  // measure
  const m = makeCtx({ record: false });
  m.save(); m.translate(0, 0); Ui.previewUnitBody(m, type, tier, 'A', COL); m.restore();
  const b = m.ctxBounds;
  const bw = (b.maxx - b.minx) || 1, bh = (b.maxy - b.miny) || 1;
  const sc = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh);
  const ox = W / 2 - (b.minx + bw / 2) * sc;
  const oy = H / 2 - (b.miny + bh / 2) * sc;
  // emit
  const e = makeCtx({ record: true });
  e.save(); e.translate(ox, oy); e.scale(sc, sc); Ui.previewUnitBody(e, type, tier, 'A', COL); e.restore();
  const els = e.ctxOps.map(o => {
    if (o.fill) return `<path d="${o.d}" fill="${o.fill}" stroke="none"/>`;
    return `<path d="${o.d}" fill="none" stroke="${o.stroke}" stroke-width="${(o.w || 1).toFixed(2)}" stroke-linejoin="${o.join}" stroke-linecap="${o.cap}"/>`;
  }).join('');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#efe9dd"/>${els}</svg>`;
}

let rows = '';
for (const type of TYPES) {
  const cells = [1, 2, 3].map(t => `<td style="text-align:center">${renderCell(type, t)}<div style="font:12px sans-serif">T${t}</div></td>`).join('');
  rows += `<tr><td style="font:13px sans-serif;white-space:nowrap;padding-right:8px"><b>${LABEL[type]}</b></td>${cells}</tr>`;
}

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>兵种炮管对照(SVG实绘)</title>
<style>body{background:#ddd;font-family:sans-serif}table{border-collapse:collapse;background:#fff;margin:12px}td{padding:6px;border:1px solid #ccc}</style></head>
<body><h3>兵种炮管对照 · 由 ui.js 真实绘制调用抓取的 SVG（非示意）</h3>
<table><tr><td></td><td>T1</td><td>T2</td><td>T3</td></tr>${rows}</table>
<p style="font:12px sans-serif;color:#555">每个兵种的炮管都是各自独立的几何：锐士=直粗坦克炮 / 盾卫=无管(前端层叠甲板+撞角) / 游侠=细长狙击管 / 轰击=斜上扬迫击炮 / 燎原=喇叭喷火器 / 激光=棱镜。</p>
</body></html>`;

const outPath = path.join(ROOT, 'docs', 'warfactory-barrel-svg-preview.html');
fs.writeFileSync(outPath, html);
console.log('OK wrote', outPath, '(svg captured from real ui.js draw calls)');
