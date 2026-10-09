'use strict';
/**
 * 生成器回归检查（比 terrain-check 快得多）：地形占比 / D_N 对称误差 / 宽通道连通 / 直边长度 / 耗时。
 * 用法：node scripts/_wf-gen-check.js [轮数]
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));
const X = wf.__test;

// ⚠️ 必须冻结 Date.now，否则每跑一次换一张图 —— 「开 / 关某个开关」的两组结果
//    其实是两组不同地形，比了个寂寞。每轮给不同基准值，保证轮与轮之间仍是不同地图。
const NOW_BASE = Number(process.env.WF_NOW || 1791539239263);
const ROUNDS = Math.max(1, Number(process.argv[1 + 1]) || 6);
const THEMES = ['classic', 'mountain', 'battlements', 'canyon', 'checker', 'lakes', 'ocean', 'plains', 'ring'];

function symmetryErr(grid, n) {
  const R = grid.length;
  const C = grid[0].length;
  const CELL = 40;
  let bad = 0;
  let tot = 0;
  const order = X.symOrder(n);
  for (let r = 0; r < R; r += 2) {
    for (let c = 0; c < C; c += 2) {
      const x = (c + 0.5) * CELL;
      const y = (r + 0.5) * CELL;
      const q = X.rotateAround(x, y, 1, order);
      const rr = Math.floor(q.y / CELL);
      const cc = Math.floor(q.x / CELL);
      if (rr < 0 || rr >= R || cc < 0 || cc >= C) continue;
      tot++;
      if (grid[r][c] !== grid[rr][cc]) bad++;
    }
  }
  return tot ? bad / tot : 0;
}

/** 长直边：横 / 竖方向上 ≥RUN 格连续且另一侧地形不同的外缘 */
function straightEdges(grid, RUN) {
  const R = grid.length;
  const C = grid[0].length;
  const solid = (r, c) => r >= 0 && r < R && c >= 0 && c < C && (grid[r][c] === 2 || grid[r][c] === 4);
  let n = 0;
  let cells = 0;
  for (let r = 0; r < R; r++) {
    let run = 0;
    for (let c = 0; c <= C; c++) {
      const isEdge = c < C && solid(r, c) && !solid(r - 1, c);
      if (isEdge) run++;
      else {
        if (run >= RUN) { n++; cells += run; }
        run = 0;
      }
    }
  }
  for (let c = 0; c < C; c++) {
    let run = 0;
    for (let r = 0; r <= R; r++) {
      const isEdge = r < R && solid(r, c) && !solid(r, c - 1);
      if (isEdge) run++;
      else {
        if (run >= RUN) { n++; cells += run; }
        run = 0;
      }
    }
  }
  return { n, cells };
}

console.log(`轮数 ${ROUNDS}（每人局 × 每主题）`);
let worstSym = 0;
let worstTheme = '';
let regBad = 0;
for (let i = 0; i < ROUNDS; i++) {
  const theme = THEMES[i % THEMES.length];
  const n = 2 + (i % 3);
  const id = 'gencheck-' + i;
  Date.now = () => NOW_BASE + i * 7919;
  const t0 = Date.now();
  const g = wf.createGameState({
    id,
    players: Array.from({ length: n }, (_, k) => ({ id: 'p' + k, name: 'P' + k })),
    theme,
  });
  const ms = Date.now() - t0;
  const th = X.themeByKey(theme);
  const grid = g.terrain.grid;
  let m = 0, w = 0;
  for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[0].length; c++) {
    if (grid[r][c] === 2) m++; else if (grid[r][c] === 4) w++;
  }
  const TOT = grid.length * grid[0].length;
  const sym = symmetryErr(grid, n);
  const reg = X.wideRegions(X.wideMask(grid)).length;
  const se = straightEdges(grid, 12);
  if (sym > worstSym) { worstSym = sym; worstTheme = `${theme}/${n}人`; }
  if (reg > 1) regBad++;
  console.log(
    `${String(i).padStart(2)} ${theme.padEnd(11)} ${n}人  山 ${((m / TOT) * 100).toFixed(1)}%（预设 ${(th.mix.mountain * 100).toFixed(1)}%）` +
      ` 水 ${((w / TOT) * 100).toFixed(1)}%（预设 ${(th.mix.water * 100).toFixed(1)}%）` +
      ` 对称误差 ${(sym * 100).toFixed(2)}%  宽通道 ${reg} 片  ≥12格直边 ${se.n} 条/${se.cells} 格  ${ms}ms`
  );
}
console.log(`\n最大对称误差 ${(worstSym * 100).toFixed(2)}%（${worstTheme}）｜宽通道 >1 片的局数 ${regBad}/${ROUNDS}`);
