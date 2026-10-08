'use strict';

/**
 * 建筑地基「被崖围死」体检：node scripts/warfactory-site-trap-check.js [局数]
 *
 * 部队出生在建筑中心（占位格），如果整块地基四周都是崖，它就一辈子出不去 ——
 * 这正是「点了移动却纹丝不动」的根因。这里逐座建筑查：地基外缘有没有至少一步能走出去。
 */

const path = require('path');
const wf = require(path.resolve(__dirname, '../server/games/warfactory/index.js'));
const WFData = require(path.resolve(__dirname, '../server/games/warfactory/data.js'));

const CLIFF = WFData.height.cliffAt;
const ROUNDS = Math.max(1, Number(process.argv[2]) || 8);

let bad = 0;
let total = 0;

function checkOne(tag, n) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: 'p' + i + '-' + tag, name: 'P' + i });
  const g = wf.createGameState({ id: 'trap-' + tag, players });
  const t = g.terrain;
  const h = t.heights;
  const C = t.cols;
  const R = t.rows;
  const pg = wf.__test.passGrid(g);
  const cb = wf.__test.compLabels(g);

  const sites = [];
  for (const x of g.hqs) sites.push({ kind: '总部', x: x.x, y: x.y, r: wf.__test.consts.HQ_R });
  for (const x of g.factories) sites.push({ kind: '工厂', x: x.x, y: x.y, r: wf.__test.consts.FACTORY_R });
  for (const x of g.labs) sites.push({ kind: '研究所', x: x.x, y: x.y, r: wf.__test.consts.LAB_R });

  // 主连通分量（按「能走」算，含崖）
  const sizes = cb.sizes.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  const mainK = sizes[0].i;

  const lines = [];
  for (const s of sites) {
    total++;
    const cc = Math.floor(s.x / t.cell);
    const cr = Math.floor(s.y / t.cell);
    const lv = h[cr * C + cc];
    // 地基外缘：建筑占位环外 1~3 格的可通行格
    const out0 = Math.ceil(s.r / t.cell);
    let openN = 0;
    let compN = new Set();
    for (let dr = -out0 - 3; dr <= out0 + 3; dr++) {
      for (let dc = -out0 - 3; dc <= out0 + 3; dc++) {
        const r = cr + dr;
        const c = cc + dc;
        if (r < 0 || r >= R || c < 0 || c >= C) continue;
        const i = r * C + c;
        if (!pg[i]) continue;
        if (Math.hypot((c + 0.5) * t.cell - s.x, (r + 0.5) * t.cell - s.y) <= s.r + 24) continue;
        // 从地基（层 lv）能不能一步走到这一格
        let stepOk = false;
        for (const [ar, ac] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const pr = r + ar;
          const pc = c + ac;
          if (pr < 0 || pr >= R || pc < 0 || pc >= C) continue;
          const pi = pr * C + pc;
          const inPad = Math.hypot((pc + 0.5) * t.cell - s.x, (pr + 0.5) * t.cell - s.y) <= s.r + 24;
          if (!inPad) continue;
          if (Math.abs(h[pi] - h[i]) < CLIFF) stepOk = true;
        }
        if (!stepOk) continue;
        openN++;
        compN.add(cb.lab[i]);
      }
    }
    const reachesMain = compN.has(mainK);
    if (openN === 0 || !reachesMain) {
      bad++;
      lines.push(`    ✗ ${s.kind} (${Math.round(s.x)},${Math.round(s.y)}) 层${lv}：可走出格 ${openN} 个，接主平原 ${reachesMain}`);
    }
  }
  console.log(`${n} 人局 ${tag}（${t.theme && t.theme.name}）：${lines.length ? '' : '全部建筑地基与外界连通'}`);
  for (const l of lines) console.log(l);
}

console.log('建筑地基连通性体检（cliffAt=' + CLIFF + '）');
for (let i = 0; i < ROUNDS; i++) checkOne(i + 1, 2 + (i % 3));
console.log(`\n${bad ? '✗ ' : '✓ '}被围死的建筑 ${bad}/${total}`);
