'use strict';

/**
 * 开局「堵路 / 建筑体量」诊断：node scripts/wf-block-diag.js [局数] [人数]
 *
 * 量化四件事：
 *   A. 加了建筑占位之后，passGrid 的连通分量变成几片。
 *   B. 每座建筑外缘一圈是否还与主片连通（孤立 = 进出全靠运气）。
 *   C. 每对建筑之间的**净缝**（中心距 − 两占位半径和）有多少个地形格 ——
 *      负数/太小就是「视觉上有缝、实际被占位糊死」。
 *   D. 碎片成因分类：崖隔断 / 地形实体围 / 建筑占位封。
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const mod = require(path.join(ROOT, 'server/games/warfactory/index.js'));
const { createGameState, __test } = mod;
const WFData = require(path.join(ROOT, 'server/games/warfactory/data.js'));

const GAMES = Number(process.argv[2]) || 3;
const NP = Number(process.argv[3]) || 4;
const TERR_CELL = 40;
const HQ_R = (WFData.buildings.hqSize * WFData.grid.cell) / 2;
const FAC_R = (WFData.buildings.factorySize * WFData.grid.cell) / 2;
const LAB_R = (WFData.buildings.labSize * WFData.grid.cell) / 2;
const GRID = WFData.grid.cell;
const MARGIN = 22; // BLOCK_MARGIN，客户端要画占位圈时也得跟这个一致

function room(n, tag) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: 'p' + i + '-' + tag, name: 'P' + i });
  return { id: 'blk-' + tag, players };
}
const sitesOf = (g) => [
  ...g.hqs.map((h) => ({ k: 'hq', x: h.x, y: h.y, R: HQ_R })),
  ...g.factories.map((f) => ({ k: 'f', x: f.x, y: f.y, R: FAC_R })),
  ...g.labs.map((l) => ({ k: 'l', x: l.x, y: l.y, R: LAB_R })),
];

/** 建筑占位格集合（与 passGrid 同口径：格心距圆心 < r + MARGIN） */
function occupySet(g, t) {
  const s = new Set();
  for (const b of sitesOf(g)) {
    const rr = b.R + MARGIN;
    const c0 = Math.max(0, Math.floor((b.x - rr) / t.cell));
    const c1 = Math.min(t.cols - 1, Math.floor((b.x + rr) / t.cell));
    const r0 = Math.max(0, Math.floor((b.y - rr) / t.cell));
    const r1 = Math.min(t.rows - 1, Math.floor((b.y + rr) / t.cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const px = (c + 0.5) * t.cell;
        const py = (r + 0.5) * t.cell;
        if (Math.hypot(px - b.x, py - b.y) < rr) s.add(r * t.cols + c);
      }
    }
  }
  return s;
}

let worstSplit = 0;
let orphanTotal = 0;
const splitHist = [];
const tightAll = [];

for (let gi = 0; gi < GAMES; gi++) {
  const g = createGameState(room(NP, 'd' + gi));
  const t = g.terrain;
  const pg = __test.passGrid(g);
  const cb = __test.compLabels(g);

  const order = cb.sizes.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
  const mainComp = order[0][1];

  const cellOf = (x, y) => {
    const c = Math.max(0, Math.min(t.cols - 1, Math.floor(x / t.cell)));
    const r = Math.max(0, Math.min(t.rows - 1, Math.floor(y / t.cell)));
    return r * t.cols + c;
  };

  // 建筑外缘一圈：任一采样点与主片同分量即算连通
  let orphan = 0;
  const orphanList = [];
  for (const b of sitesOf(g)) {
    let ok = false;
    for (let a = 0; a < 32 && !ok; a++) {
      const th = (a / 32) * Math.PI * 2;
      for (const rr of [b.R + MARGIN + 26, b.R + MARGIN + 48, b.R + MARGIN + 78]) {
        const px = b.x + Math.cos(th) * rr;
        const py = b.y + Math.sin(th) * rr;
        if (px < 0 || py < 0 || px >= 11520 || py >= 11520) continue;
        const i = cellOf(px, py);
        if (pg[i] && cb.lab[i] === mainComp) { ok = true; break; }
      }
    }
    if (!ok) { orphan++; orphanList.push(`${b.k}@${Math.round(b.x)},${Math.round(b.y)}`); }
  }

  // 相邻建筑净缝（地形格）
  const B = sitesOf(g);
  const tight = [];
  for (let i = 0; i < B.length; i++) {
    for (let j = i + 1; j < B.length; j++) {
      const d = Math.hypot(B[i].x - B[j].x, B[i].y - B[j].y);
      const gap = d - (B[i].R + MARGIN + B[j].R + MARGIN);
      if (gap < TERR_CELL * 1.4) tight.push({ a: B[i].k, b: B[j].k, gapCells: +(gap / TERR_CELL).toFixed(2) });
    }
  }
  tight.sort((x, y) => x.gapCells - y.gapCells);

  splitHist.push(order.length - 1);
  worstSplit = Math.max(worstSplit, order.length - 1);
  orphanTotal += orphan;
  for (const x of tight) tightAll.push(x);

  console.log(`\n=== 局 ${gi + 1}（${NP} 人 · ${t.theme.key}）===`);
  console.log(`  分量：共 ${order.length} 片，最大 ${order.slice(0, 5).map((s) => s[0]).join(' / ')}`);
  console.log(`  建筑 ${B.length} 座（hq ${g.hqs.length} / fac ${g.factories.length} / lab ${g.labs.length}）`);
  console.log(`  外缘与主片不连通：${orphan} 座 ${orphanList.slice(0, 6).join(' ')}`);
  console.log(`  净缝 < 1.4 格：${tight.length} 对 ${tight.slice(0, 4).map((x) => `${x.a}-${x.b}:${x.gapCells}`).join('  ')}`);
}

/* ---- D. 碎片成因分类 ---- */
console.log('\n=== 碎片成因（每片碎片与主片之间的封口归类）===');
{
  let cliff = 0, terr = 0, bld = 0;
  const CL = WFData.height.cliffAt;
  for (let gi = 0; gi < GAMES; gi++) {
    const g = createGameState(room(NP, 'frag' + gi));
    const t = g.terrain;
    const pg = __test.passGrid(g);
    const cb = __test.compLabels(g);
    const hf = t.heights;
    const bset = occupySet(g, t);
    const ord = cb.sizes.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
    const main = ord[0][1];
    for (let k = 1; k < ord.length; k++) {
      const id = ord[k][1];
      let nCliff = 0, nTerr = 0, nBld = 0;
      for (let i = 0; i < pg.length; i++) {
        if (cb.lab[i] !== id) continue;
        const c = i % t.cols, r = (i - c) / t.cols;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= t.rows || nc < 0 || nc >= t.cols) continue;
          const nid = nr * t.cols + nc;
          if (cb.lab[nid] === main && pg[nid]) {
            if (Math.abs(hf[i] - hf[nid]) >= CL) nCliff++;
          } else if (bset.has(nid)) nBld++;
          else if (!pg[nid] && hf[nid] === hf[i]) nTerr++;
        }
      }
      if (nBld > nCliff && nBld > nTerr) bld++;
      else if (nCliff >= nTerr) cliff++;
      else terr++;
    }
  }
  console.log(`  ${GAMES} 局合计：崖隔断 ${cliff} 片 / 地形实体围 ${terr} 片 / 建筑占位封 ${bld} 片`);
}

/* ---- 汇总 ---- */
console.log('\n=== 汇总 ===');
console.log(`  多余连通片：每局 [${splitHist.join(', ')}]，最大 ${worstSplit}`);
console.log(`  建筑外缘孤立总数：${orphanTotal}`);
console.log(
  `  净缝不足的建筑对：${tightAll.length}` +
    (tightAll.length
      ? '（最挤：' + tightAll.sort((a, b) => a.gapCells - b.gapCells).slice(0, 4).map((x) => `${x.a}-${x.b}:${x.gapCells}格`).join(' ') + '）'
      : '')
);

/* ---- 体量对照 ---- */
console.log('\n=== 建筑体量：碰撞圆 vs 视觉外廓 ===');
console.log(`  碰撞半径(px)：工厂 ${FAC_R} / 研究所 ${LAB_R} / 总部 ${HQ_R}`);
console.log(`  寻路占位 = 碰撞 + ${MARGIN} ⇒ 工厂 ${FAC_R + MARGIN}px`);
console.log(`  地形格 ${TERR_CELL}px ⇒ 工厂占位圈直径 ≈ ${(((FAC_R + MARGIN) * 2) / TERR_CELL).toFixed(1)} 格，总部 ≈ ${(((HQ_R + MARGIN) * 2) / TERR_CELL).toFixed(1)} 格`);
console.log(`  视觉（手绘 × k=R/52）：工厂围墙 ${(92 * FAC_R / 52).toFixed(0)}×${(48 * FAC_R / 52).toFixed(0)}px，底座椭圆 ${(132 * FAC_R / 52).toFixed(0)}px 宽`);
console.log(`  1 阶兵半径 ${GRID}px，3 阶 ${GRID * 2}px`);
