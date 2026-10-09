'use strict';

/**
 * 打印某块区域的「类型 + 高度层」小图，用来判断「不平滑」到底是**地形类型**的锯齿
 * 还是**高度层**的台阶（两者画出来的观感完全不同，修法也完全不同）。
 *
 * 用法：node scripts/_wf-cell-dump.js [roomId] [players] [theme] [r0] [r1] [c0] [c1]
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
// 与 _wf-map-view.js 同一招：冻结 Date.now，否则每次都是另一张图，跟渲染图对不上
const FIXED_NOW = Number(process.env.WF_NOW || 1791539239263);
Date.now = () => FIXED_NOW;
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));

const roomId = process.argv[2] || 'mapview';
const N = Math.max(2, Math.min(4, Number(process.argv[3]) || 2));
const themeArg = process.argv[4] || '';
const r0 = Number(process.argv[5]) || 180;
const r1 = Number(process.argv[6]) || 194;
const c0 = Number(process.argv[7]) || 140;
const c1 = Number(process.argv[8]) || 158;

const g = wf.createGameState({
  id: roomId,
  players: Array.from({ length: N }, (_, i) => ({ id: 'p' + i, name: 'P' + i })),
  ...(themeArg ? { theme: themeArg } : {}),
});
const T = g.terrain;
const H = T.heights; // ⚠️ 是**扁平** Int8Array（rows*cols），不是二维数组
const HL = (r, c) => H[r * T.cols + c];
const CH = { 0: ' ', 2: '#', 4: '~' }; // 0 平原 / 2 山 / 4 水

console.log(`room=${roomId} N=${N} theme=${T.theme.key} rows=${T.rows} cols=${T.cols}`);
console.log(`区域 r=${r0}..${r1}  c=${c0}..${c1}\n`);

let head = '     ';
for (let c = c0; c <= c1; c++) head += String(c % 100).padStart(2, ' ');
console.log(head + '     ← 列（个位/十位）');
console.log(' 类型：0 平原  # 山  ~ 水');
for (let r = r0; r <= r1; r++) {
  let s = String(r).padStart(4, ' ') + ' ';
  for (let c = c0; c <= c1; c++) s += ' ' + (CH[T.grid[r][c]] !== undefined ? CH[T.grid[r][c]] : '?') + ' ';
  console.log(s);
}
console.log('\n 高度层（hLevel，块字符 = 层数）：');
for (let r = r0; r <= r1; r++) {
  let s = String(r).padStart(4, ' ') + ' ';
  for (let c = c0; c <= c1; c++) {
    const v = HL(r, c) || 0;
    s += String(v).padStart(2, ' ');
  }
  console.log(s);
}

/* ---- 边界粗糙度统计（整图） ---- */
function rough(name, mask) {
  const R = T.rows;
  const C = T.cols;
  let boundary = 0;
  let tips = 0;
  let concave = 0;
  let runs = [];
  for (let r = 0; r < R; r++) {
    let run = 0;
    for (let c = 0; c < C; c++) {
      const on = mask(r, c);
      const isB = on && (!mask(r - 1, c) || !mask(r + 1, c) || !mask(r, c - 1) || !mask(r, c + 1));
      if (on && !mask(r - 1, c) && !mask(r + 1, c) && !mask(r, c - 1) && !mask(r, c + 1)) tips++;
      if (isB) {
        boundary++;
        run++;
      } else {
        if (run) runs.push(run);
        run = 0;
      }
    }
    if (run) runs.push(run);
  }
  // 「外凸孤格」= 正交邻同类 ≤1
  let spurs = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (!mask(r, c)) continue;
      let n = 0;
      if (mask(r - 1, c)) n++;
      if (mask(r + 1, c)) n++;
      if (mask(r, c - 1)) n++;
      if (mask(r, c + 1)) n++;
      if (n <= 1) spurs++;
    }
  }
  console.log(
    `${name}: 格数=${boundary} 尖刺(邻≤1)=${spurs} 孤立格=${tips} 邻块数=${runs.length}`
  );
  void concave;
}
const mtn = (r, c) => r >= 0 && r < T.rows && c >= 0 && c < T.cols && T.grid[r][c] === 2;
const wat = (r, c) => r >= 0 && r < T.rows && c >= 0 && c < T.cols && T.grid[r][c] === 4;
console.log('');
rough('山地', mtn);
rough('水域', wat);

/* ---- 高度层台阶粗糙度 ---- */
let steps = 0;
let bigSteps = 0;
for (let r = 0; r < T.rows; r++) {
  for (let c = 0; c < T.cols - 1; c++) {
    const a = HL(r, c);
    const b = HL(r, c + 1);
    if (a !== b) {
      steps++;
      if (Math.abs(a - b) >= 2) bigSteps++;
    }
  }
}
console.log(`\n高度台阶（东西向相邻层不同）：${steps} 处，其中层差 ≥2（断崖）：${bigSteps} 处`);
