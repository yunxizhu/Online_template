'use strict';

/**
 * 地形外缘「锯齿度」量化：把 ui.js 真实那段取线代码切出来，喂**真实一局**的
 * grid + heights，统计边界的形状质量。
 *
 * 为什么要专门量这个：玩家反馈「不平滑 / 硬拉一条线」，目视只能看出「有点糙」，
 * 量出来才知道是**哪一类**糙、改一步动了多少：
 *   · 链数      —— 断成多少截（越少越连贯）
 *   · 斜段      —— 45° 切角段数
 *   · 回头看段  —— 连续两个拐点相距 1 格且方向相反 = 「V 勾 / 锯齿尖」
 *   · 长直段    —— ≥ 8 格的纯横段（「硬拉一条直线」的嫌疑对象）
 *
 * 用法：node scripts/_wf-edge-stat.js [roomId] [players] [theme] [smoothPasses]
 *   smoothPasses > 0 时，先对**地形掩膜**跑 N 遍 roundTerrainEdges 再统计（A/B 用）。
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FIXED_NOW = Number(process.env.WF_NOW || 1791539239263);
Date.now = () => FIXED_NOW;
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));

const roomId = process.argv[2] || 'mapview';
const N = Math.max(2, Math.min(4, Number(process.argv[3]) || 2));
const themeArg = process.argv[4] || '';
const smoothPasses = Number(process.argv[5]) || 0;

const g = wf.createGameState({
  id: roomId,
  players: Array.from({ length: N }, (_, i) => ({ id: 'p' + i, name: 'P' + i })),
  ...(themeArg ? { theme: themeArg } : {}),
});
const T = g.terrain;
const gw = T.cols;
const gh = T.rows;
const CELL = T.cell;
let H = T.heights;

/* ---- 取 ui.js 里真实的断崖取线段 ---- */
const SRC = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');
const i0 = SRC.indexOf('    // 南向断崖：');
const i1 = SRC.indexOf('    // ③ 地形外缘');
if (i0 < 0 || i1 <= i0) throw new Error('断崖段锚点没对上');
const BLOCK = SRC.slice(i0, i1);
const runCliffs = new Function(
  'g',
  'r0',
  'r1',
  'gh',
  'gw',
  'CELL',
  'cliffSide',
  'C_CLIFF',
  BLOCK + '\nreturn cliffChains;'
);

const mkSide = (grid, hf, ramps) => {
  const at = (r, c) => (r < 0 || r >= gh || c < 0 || c >= gw ? -1 : grid[r][c]);
  const hLevel = (r, c) => (r < 0 || r >= gh || c < 0 || c >= gw ? 0 : hf[r * gw + c]);
  const isRampCell = (r, c) =>
    !!(ramps && r >= 0 && r < gh && c >= 0 && c < gw && ramps[r * gw + c] === 1);
  return (ra, ca, rb, cb) => {
    if (isRampCell(ra, ca) || isRampCell(rb, cb)) return false;
    const ta = at(ra, ca);
    const tb = at(rb, cb);
    const aSolid = ta === 2 || ta === 4;
    const bSolid = tb === 2 || tb === 4;
    if (aSolid !== bSolid) return true;
    if (aSolid) return false;
    const cliffAt = Number((wf.__test.consts && wf.__test.consts.HEIGHT_CLIFF) || 2);
    return Math.abs(hLevel(ra, ca) - hLevel(rb, cb)) >= cliffAt;
  };
};

/* 斜坡格：ui.js 用服务端下发的 ramps；这里直接取 buildHeightField 挂在 heights 上的那份 */
const ramps = (() => {
  const r = T.ramps;
  if (!r) return null;
  // rampsToData 的结果可能是 [idx, ...] 或者 {list:[]}；统一成 Uint8Array
  const arr = new Uint8Array(gw * gh);
  const list = Array.isArray(r) ? r : r.list || r.cells || [];
  for (let i = 0; i < list.length; i++) if (list[i] >= 0) arr[list[i]] = 1;
  return arr;
})();

function analyze(grid, hf, rampsArr) {
  const chains = runCliffs(
    { strokeStyle: '', lineWidth: 0, lineJoin: '', lineCap: '', beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} },
    0,
    gh - 1,
    gh,
    gw,
    CELL,
    mkSide(grid, hf, rampsArr),
    '#000'
  );
  let h = 0;
  let v = 0;
  let d = 0;
  let pts = 0;
  let zig = 0; // 相邻两段斜线的左右方向相反 = 尖（「V 勾 / 锯齿尖」）
  let longH = 0;
  let longHMax = 0;
  for (const ch of chains) {
    const n = ch.length / 2;
    pts += n;
    let runH = 0;
    let prevDiag = 0; // 上一段的 dx 符号（0 = 非斜段）
    for (let i = 0; i + 1 < n; i++) {
      const dx = ch[(i + 1) * 2] - ch[i * 2];
      const dy = ch[(i + 1) * 2 + 1] - ch[i * 2 + 1];
      if (dy === 0) {
        h++;
        runH++;
        prevDiag = 0;
      } else if (dx === 0) {
        v++;
        if (runH >= 8) {
          longH++;
          longHMax = Math.max(longHMax, runH);
        }
        runH = 0;
        prevDiag = 0;
      } else {
        d++;
        if (prevDiag !== 0 && Math.sign(dx) !== prevDiag) zig++;
        prevDiag = Math.sign(dx);
        runH = 0;
      }
    }
    if (runH >= 8) {
      longH++;
      longHMax = Math.max(longHMax, runH);
    }
  }
  return { chains: chains.length, pts, h, v, d, zig, longH, longHMax };
}

function mix() {
  let m = 0;
  let w = 0;
  for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
    if (T.grid[r][c] === 2) m++;
    else if (T.grid[r][c] === 4) w++;
  }
  return { m: (m / (gw * gh) * 100).toFixed(1), w: (w / (gw * gh) * 100).toFixed(1) };
}

function wideInfo() {
  const mask = wf.__test.wideMask(T.grid);
  const regs = wf.__test.wideRegions(mask);
  return { n: Array.isArray(regs) ? regs.length : regs, mask };
}

const fmt = (o) =>
  `链=${o.chains} 顶点=${o.pts} 横=${o.h} 竖=${o.v} 斜=${o.d} V勾=${o.zig} 长横段=${o.longH}(最长${o.longHMax})`;

/** 去毛刺：只做「拔尖刺 + 填 1 格缺口」，**不削外凸角**（削外凸角正是台阶越削越碎的原因） */
function despeckle(grid, passes) {
  let changed = 0;
  for (let p = 0; p < passes; p++) {
    const tips = [];
    const fills = [];
    for (let r = 0; r < gh; r++) {
      for (let c = 0; c < gw; c++) {
        const t = grid[r][c];
        const nb = (rr, cc) => (rr < 0 || rr >= gh || cc < 0 || cc >= gw ? 0 : grid[rr][cc]);
        if (t === 2 || t === 4) {
          let n = 0;
          if (nb(r - 1, c) === t) n++;
          if (nb(r + 1, c) === t) n++;
          if (nb(r, c - 1) === t) n++;
          if (nb(r, c + 1) === t) n++;
          // 尖刺：只有一个同类正邻 → 拔掉（1 格宽的突刺）
          if (n <= 1) tips.push(r * gw + c);
          // 细颈：两个同类正邻且它们**相邻成 L**，而夹在中间的对角是异类 → 1 格宽的凸角块
          else if (n === 2) {
            const pairs = [
              [nb(r - 1, c) === t, nb(r, c - 1) === t, r - 1, c - 1],
              [nb(r - 1, c) === t, nb(r, c + 1) === t, r - 1, c + 1],
              [nb(r + 1, c) === t, nb(r, c - 1) === t, r + 1, c - 1],
              [nb(r + 1, c) === t, nb(r, c + 1) === t, r + 1, c + 1],
            ];
            for (const [a1, a2, rr, cc] of pairs) {
              if (a1 && a2 && nb(rr, cc) !== t) {
                tips.push(r * gw + c);
                break;
              }
            }
          }
        } else if (t === 0) {
          // 1 格宽的凹口：三面同类 → 填平
          let m = 0;
          let w2 = 0;
          for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
            const v = nb(rr, cc);
            if (v === 2) m++;
            else if (v === 4) w2++;
          }
          if (m >= 3 && w2 === 0) fills.push([r * gw + c, 2]);
          else if (w2 >= 3 && m === 0) fills.push([r * gw + c, 4]);
        }
      }
    }
    if (!tips.length && !fills.length) break;
    for (const i of tips) {
      grid[(i / gw) | 0][i % gw] = 0;
      changed++;
    }
    for (const it of fills) {
      grid[(it[0] / gw) | 0][it[0] % gw] = it[1];
      changed++;
    }
  }
  return changed;
}

const clone = () => T.grid.map((row) => row.slice());

console.log(`room=${roomId} N=${N} theme=${T.theme.key} ${gw}×${gh}`);
const base = analyze(T.grid, H, ramps);
const mx0 = mix();
console.log('原始         ' + fmt(base) + `  山${mx0.m}% 水${mx0.w}%`);

for (const k of [2, 4, 6]) {
  const grid = clone();
  const ch = wf.__test.roundTerrainEdges(grid, k);
  const hf = wf.__test.buildHeightField(grid, wf.__test.symOrder(N), []);
  const a = analyze(grid, hf, ramps);
  let m = 0;
  let w2 = 0;
  for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
    if (grid[r][c] === 2) m++;
    else if (grid[r][c] === 4) w2++;
  }
  console.log(`圆角×${k}      ` + fmt(a) + `  山${((m / (gw * gh)) * 100).toFixed(1)}% 水${((w2 / (gw * gh)) * 100).toFixed(1)}%  改${ch}格`);
}

if (smoothPasses > 0) {
  const grid = clone();
  const ch = despeckle(grid, smoothPasses);
  const hf = wf.__test.buildHeightField(grid, wf.__test.symOrder(N), []);
  const a = analyze(grid, hf, ramps);
  let m = 0;
  let w2 = 0;
  for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
    if (grid[r][c] === 2) m++;
    else if (grid[r][c] === 4) w2++;
  }
  console.log(`去毛刺×${smoothPasses}   ` + fmt(a) + `  山${((m / (gw * gh)) * 100).toFixed(1)}% 水${((w2 / (gw * gh)) * 100).toFixed(1)}%  改${ch}格`);
}

/* 连通性 / 宽通道（只对原始各测一次，用来确认没被磨碎） */
const w0 = wideInfo();
console.log(`宽通道（原始）：${w0.n} 片`);
