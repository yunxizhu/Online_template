'use strict';

/**
 * 「坡与崖」规则体检：有高低差的地方只有坡口能上下，其余是过不去的崖。
 *
 * 查四件事，每一件都是这条规则成立的前提：
 *   ① 台地化 —— 高度只剩几个档位，档与档之间落差 ≥ cliffAt（这就是崖）
 *   ② 坡口 —— 存在「中间层」的过渡格，且坡道上每一步只差 1 层
 *   ③ 拦得住 —— 站在崖脚，朝向崖顶的那一步被 canStand 判死
 *   ④ 走得通 —— 站在坡脚，能一级一级走上去；且全图连通性没被崖切断
 *
 * 用法：node scripts/warfactory-cliff-check.js [局数]
 */

const path = require('path');
const wf = require(path.resolve(__dirname, '../server/games/warfactory/index.js'));
const WFData = require(path.resolve(__dirname, '../server/games/warfactory/data.js'));

const CLIFF = WFData.height.cliffAt;
const TERR = WFData.height.terrace;
const ROUNDS = Math.max(1, Number(process.argv[2]) || 6);

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + msg);
  } else {
    fail++;
    console.log('  ✗ ' + msg);
  }
}

/** 只算「站得住人」的格子（山 / 水不算） */
function passMask(g) {
  const t = g.terrain;
  const C = t.cols;
  const out = new Uint8Array(t.rows * C);
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < C; c++) {
      const v = t.grid[r][c];
      out[r * C + c] = v !== 2 && v !== 4 ? 1 : 0;
    }
  }
  return out;
}

/** 连通块（ok 决定相邻两格算不算连着） */
function comps(pass, cols, rows, okEdge) {
  const total = cols * rows;
  const lab = new Int32Array(total).fill(-1);
  const q = new Int32Array(total);
  const sizes = [];
  let n = 0;
  for (let s = 0; s < total; s++) {
    if (!pass[s] || lab[s] >= 0) continue;
    let hd = 0;
    let tl = 0;
    let sz = 0;
    q[tl++] = s;
    lab[s] = n;
    sz++;
    while (hd < tl) {
      const cur = q[hd++];
      const c0 = cur % cols;
      const r0 = (cur - c0) / cols;
      const nb = [c0 > 0 ? cur - 1 : -1, c0 < cols - 1 ? cur + 1 : -1, r0 > 0 ? cur - cols : -1, r0 < rows - 1 ? cur + cols : -1];
      for (const m of nb) {
        if (m < 0 || lab[m] >= 0 || !pass[m] || !okEdge(cur, m)) continue;
        lab[m] = n;
        q[tl++] = m;
        sz++;
      }
    }
    sizes.push(sz);
    n++;
  }
  return sizes.sort((a, b) => b - a);
}

function one(t) {
  const n = 2 + (t % 3);
  const g = wf.createGameState({
    id: 'cliff-' + t,
    players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i + '-' + t, name: 'P' + i })),
  });
  const tg = g.terrain;
  const h = tg.heights;
  const C = tg.cols;
  const R = tg.rows;
  const CELL = tg.cell;
  console.log(n + ' 人局 #' + (t + 1) + '（主题 ' + (tg.theme && tg.theme.name) + '）');

  // ① 台地档位
  const seen = new Set();
  for (let i = 0; i < h.length; i++) seen.add(h[i]);
  const lv = Array.from(seen).sort((a, b) => a - b);
  const offGrid = lv.filter((v) => v !== 0 && Math.abs(v) % TERR !== 0 && Math.abs(v) !== Number(WFData.height.levels));
  ok(offGrid.length === 0 || offGrid.every((v) => Math.abs(v) === 1),
    '高度只剩台地档位（层 ' + lv.join('/') + '；±1 那几层是坡道带）');

  // ② 坡口：找一条「层差 ≥ cliffAt 的边界被改写成了每步 1 层」的通路
  const pass = passMask(g);
  let cliffEdges = 0;
  let rampCells = 0;
  let rampOk = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const i = r * C + c;
      if (!pass[i]) continue;
      const east = c < C - 1 && pass[i + 1] ? i + 1 : -1;
      const south = r < R - 1 && pass[i + C] ? i + C : -1;
      for (const j of [east, south]) {
        if (j < 0) continue;
        const d = h[j] - h[i];
        if (Math.abs(d) >= CLIFF) cliffEdges++;
      }
      // 坡道格：四邻里有比自己高 1 层、也有和自己同层的（说明是夹在中间的过渡带）
      let hasUp = false;
      let hasFlat = false;
      for (const j of [east, south, c > 0 && pass[i - 1] ? i - 1 : -1, r > 0 && pass[i - C] ? i - C : -1]) {
        if (j < 0) continue;
        if (h[j] - h[i] === 1 || h[i] - h[j] === 1) hasUp = true;
        if (h[j] === h[i]) hasFlat = true;
      }
      if (hasUp) {
        rampCells++;
        if (hasFlat) rampOk++;
      }
    }
  }
  ok(cliffEdges > 200, '图上确实有崖（崖边 ' + cliffEdges + ' 条）');
  ok(rampCells > 40 && rampOk > 20, '坡口挖出来了（坡道格 ' + rampCells + ' 个，其中贴着同层的 ' + rampOk + ' 个）');

  // ③ 拦得住：挑一处崖，站崖脚朝崖顶迈一步 —— canStand 必须判死；反过来走平地能过
  let blocked = 0;
  let tried = 0;
  let rampUp = 0;
  let rampTried = 0;
  for (let r = 1; r < R - 1 && tried < 60; r++) {
    for (let c = 1; c < C - 1 && tried < 60; c++) {
      const i = r * C + c;
      if (!pass[i]) continue;
      const j = i + C; // 只看南邻，够用了
      if (!pass[j]) continue;
      const d = h[j] - h[i];
      const ax = (c + 0.5) * CELL;
      const ay = (r + 0.5) * CELL;
      const bx = (c + 0.5) * CELL;
      const by = (r + 1.5) * CELL;
      if (Math.abs(d) >= CLIFF) {
        tried++;
        // 从崖脚朝崖顶迈一步（起点在 i、落点在 j）
        if (!wf.canStand(g, bx, by, 10, ax, ay)) blocked++;
      } else if (Math.abs(d) === 1) {
        rampTried++;
        if (wf.canStand(g, bx, by, 10, ax, ay)) rampUp++;
      }
    }
  }
  ok(tried > 0 && blocked === tried, '崖拦得住：' + blocked + '/' + tried + ' 次「朝崖顶迈步」全被判死');
  ok(rampTried > 0 && rampUp === rampTried, '坡走得通：' + rampUp + '/' + rampTried + ' 次「朝高一层迈步」全都放行');

  // ④ 连通性：加崖之后的连通块数不能比「只看地形」多 —— 多一块就是有地被崖困死了
  const a = comps(pass, C, R, () => true);
  const b = comps(pass, C, R, (x, y) => Math.abs(h[x] - h[y]) < CLIFF);
  ok(b.length === a.length, '崖没切断任何一块地（地形 ' + a.length + ' 块 / 加崖 ' + b.length + ' 块）');
}

console.log('坡与崖规则体检（cliffAt=' + CLIFF + '、terrace=' + TERR + '）');
for (let t = 0; t < ROUNDS; t++) one(t);
console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
