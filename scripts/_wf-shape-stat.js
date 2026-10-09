'use strict';
/**
 * 地形形状量化：把「长直线段 / 直角 / 45°台阶」按阶段数出来，定位是谁把地形改成方块。
 * 用法：node scripts/_wf-shape-stat.js [players] [roomId] [themeKey]
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));
const X = wf.__test;

const N = Math.max(2, Math.min(4, Number(process.argv[2]) || 2));
const roomId = process.argv[3] || 'shapestat';
const themeArg = process.argv[4] || '';
const g = wf.createGameState({
  id: roomId,
  players: Array.from({ length: N }, (_, i) => ({ id: 'p' + i, name: 'P' + i })),
  ...(themeArg ? { theme: themeArg } : {}),
});
const COLS = g.terrain.cols, ROWS = g.terrain.rows;
const th = X.themeByKey(g.terrain.theme.key) || X.fillTheme({});
const noiseSeed = g._mapGen.noiseSeed;
const gen = (() => {
  let used = false;
  const rngStub = () => { if (!used) { used = true; return (noiseSeed - 1) / 0xfffffe; } return 0.5; };
  return X.generateTerrainGrid(rngStub, th, N, {});
})();

/** 统计：地形（山/水）外缘里，横 / 竖直线段（≥run 格）各多少，以及总边界长度 */
function edgeStat(grid, runMin) {
  const solid = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS && (grid[r][c] === 2 || grid[r][c] === 4);
  let hCells = 0, vCells = 0, edge = 0;               // 边界格（四邻有平原的实心格）
  const hRuns = [], vRuns = [];
  for (let r = 0; r < ROWS; r++) {
    let run = 0;
    for (let c = 0; c <= COLS; c++) {
      // 水平直边：该格实心 且 上方/下方是平原（说明这段水平外缘存在）
      const up = solid(r, c) && !solid(r - 1, c);
      const dn = solid(r, c) && !solid(r + 1, c);
      const lf = solid(r, c) && !solid(r, c - 1);
      const rt = solid(r, c) && !solid(r, c + 1);
      if (up || dn) hCells++;
      if (lf || rt) vCells++;
      if (up || dn) edge++;
      if (lf || rt) edge++;
      if (up || dn) run++; else { if (run >= runMin) hRuns.push(run); run = 0; }
    }
  }
  for (let c = 0; c < COLS; c++) {
    let run = 0;
    for (let r = 0; r <= ROWS; r++) {
      const lf = solid(r, c) && !solid(r, c - 1);
      const rt = solid(r, c) && !solid(r, c + 1);
      if (lf || rt) run++; else { if (run >= runMin) vRuns.push(run); run = 0; }
    }
  }
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  let stairs = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const v = grid[r][c];
    if (v !== 2 && v !== 4) continue;
    const nn = (rr, cc) => solid(rr, cc) && grid[rr][cc] === v;
    const n = [nn(r - 1, c), nn(r + 1, c), nn(r, c - 1), nn(r, c + 1)].filter(Boolean).length;
    if (n === 2 && !((nn(r - 1, c) && nn(r + 1, c)) || (nn(r, c - 1) && nn(r, c + 1)))) stairs++;
  }
  return {
    edge, hCells, vCells, stairs,
    hRunN: hRuns.length, hRunSum: sum(hRuns), hRunMax: Math.max(0, ...hRuns),
    vRunN: vRuns.length, vRunSum: sum(vRuns), vRunMax: Math.max(0, ...vRuns),
  };
}
const RUN = 16;
function line(name, gr) {
  const s = edgeStat(gr, RUN);
  const axis = ((s.hCells + s.vCells) / Math.max(1, s.edge)) * 100;
  console.log(
    `${name}: 边界 ${s.edge} 格｜轴对齐占 ${axis.toFixed(1)}%｜≥${RUN}格直段 横 ${s.hRunN} 条(${s.hRunSum} 格, 最长 ${s.hRunMax}) 竖 ${s.vRunN} 条(${s.vRunSum} 格, 最长 ${s.vRunMax})｜45°台阶角 ${s.stairs}`
  );
}
console.log(`room=${roomId} N=${N} theme=${g.terrain.theme.key}(${g.terrain.theme.name})`);
line('② 生成器原图 ', gen);
line('③ 完整管线   ', g.terrain.grid);
