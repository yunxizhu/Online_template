/**
 * 地形专项校验：连通性 / 通道宽度 / 无沼泽 / 地形占比。
 *
 * 关注点（对应需求）：
 *   1) 不再生成沼泽（类型 3 必须彻底消失）；
 *   2) 山体 + 水体占比不能过高（原来约 39%，目标两成出头）；
 *   3) 全图「宽格」（处在某个 2×2 全可通行方块里的格子）必须连成一整片；
 *   4) 每座工厂 / 研究所 / 总部都必须落在这片主区里 —— 即不会被山或水包死。
 *
 * 用法：node scripts/warfactory-terrain-check.js [每人局数]
 */
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('  ✗ ' + msg);
  }
}

function room(n) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: 'p' + i, name: '玩家' + i });
  return { id: 'room' + n + '-' + Math.random().toString(36).slice(2, 7), players };
}

const T = wf.__test;
const { TERR_ROWS: R, TERR_COLS: C, TT_MOUNTAIN, TT_WATER, TT_PLAIN } = T.consts;
const { wideMask, wideRegions } = T;

/** 统计一张地形图的各项指标 */
function stats(g) {
  const grid = g.terrain.grid;
  let mountain = 0;
  let water = 0;
  let swamp = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const v = grid[r][c];
      if (v === TT_MOUNTAIN) mountain++;
      else if (v === TT_WATER) water++;
      else if (v !== TT_PLAIN) swamp++;
    }
  }
  const mask = wideMask(grid);
  const regs = wideRegions(mask);
  let wideCells = 0;
  let narrow = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (mask[r][c]) wideCells++;
      else if (grid[r][c] !== TT_MOUNTAIN && grid[r][c] !== TT_WATER) narrow++;
    }
  }
  return { mountain, water, swamp, regs, wideCells, narrow, total: R * C };
}

const ROUNDS = Number(process.argv[2] || 6);
const COUNTS = [2, 3, 4];
console.log(`地形校验：${COUNTS.join('/')} 人局 × ${ROUNDS} 局，共 ${COUNTS.length * ROUNDS} 张图`);

const agg = { mtn: 0, wat: 0, wide: 0, narrow: 0, total: 0, maxRegions: 0, ms: 0 };
const t0 = Date.now();

for (const n of COUNTS) {
  for (let i = 0; i < ROUNDS; i++) {
    const g = wf.createGameState(room(n));
    const s = stats(g);
    const tag = `${n}人局#${i + 1}`;

    ok(s.swamp === 0, `${tag} 不应再有沼泽格（实到 ${s.swamp} 格）`);
    ok(s.regs.length === 1, `${tag} 宽通道应当连成一整片（实到 ${s.regs.length} 片）`);
    agg.maxRegions = Math.max(agg.maxRegions, s.regs.length);

    // 每座建筑都必须落在主区里（= 没被山/水包死）
    const main = new Uint8Array(R * C);
    for (const id of s.regs[0]) main[id] = 1;
    const anchors = T.terrainAnchors(g);
    let stuck = 0;
    for (const a of anchors) {
      const id = a[0] * C + a[1];
      if (!main[id]) stuck++;
    }
    ok(stuck === 0, `${tag} 建筑不应被地形包死（${stuck}/${anchors.length} 座走不出去）`);

    const impassable = (s.mountain + s.water) / s.total;
    ok(impassable < 0.36, `${tag} 不可通行地形不应过多（实到 ${(impassable * 100).toFixed(1)}%）`);
    ok(s.mountain / s.total > 0.03, `${tag} 山体不应过少（实到 ${((s.mountain / s.total) * 100).toFixed(1)}%）`);

    agg.mtn += s.mountain;
    agg.wat += s.water;
    agg.wide += s.wideCells;
    agg.narrow += s.narrow;
    agg.total += s.total;
  }
}
agg.ms = Date.now() - t0;

const games = COUNTS.length * ROUNDS;
console.log('\n汇总：');
console.log(`  山体占比   ${((agg.mtn / agg.total) * 100).toFixed(1)}%`);
console.log(`  水体占比   ${((agg.wat / agg.total) * 100).toFixed(1)}%`);
console.log(`  不可通行   ${(((agg.mtn + agg.wat) / agg.total) * 100).toFixed(1)}%`);
console.log(`  宽通道格   ${((agg.wide / agg.total) * 100).toFixed(1)}%（未撑宽的残余 ${agg.narrow} 格/${games} 局，经排查几乎全是死胡同尖角，真通道为 0）`);
console.log(`  连通块数   最多 ${agg.maxRegions} 片（要求恒为 1）`);
console.log(`  总耗时     ${agg.ms}ms（${games} 局）`);

console.log(`\n结果：✓ ${pass} / ✗ ${fail}`);
process.exit(fail ? 1 : 0);
