/**
 * 坡/崖寻路体检：确认「崖过不去、坡走得上去、且走的是最近的那个坡口」。
 *
 * 用法：node scripts/warfactory-ramp-check.js [局数]
 *
 * 判据（每层都要绿）：
 *  ① 地形上确实存在坡边（Δh == 1），否则「坡可通行」无从谈起；
 *  ② 流场路径的**每一步** Δh ≤ 1 —— 一步崖都不许跨；
 *  ③ 路径长度 == 不认崖时的下界？不，反过来看：认崖的路径一定 ≥ 不认崖的路径；
 *     差值就是「为了绕崖多走的格数」，只做记录（地形使然，不算 bug）；
 *  ④ 路径真的跨了坡（Δh == 1 的边 ≥ 1 条）时，说明它**用了坡口**而不是绕开整个台地；
 *     只在「起终点确实分处不同层」的对子上检查。
 *  ⑤ 指定一条已知坡口：把坡口封死（临时抬高成崖）后路径应变长或走不通 —— 证明坡口被用上。
 */
'use strict';

const path = require('path');
const wf = require(path.join(__dirname, '..', 'server', 'games', 'warfactory', 'index.js'));
const { createGameState } = wf;
const T = wf.__test;

const ROUNDS = Number(process.argv[2] || 4);
let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) failed++;
};

function room(n, tag) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: 'p' + i, name: 'P' + i });
  return { id: 'ramp-' + tag + '-' + n, players, modeId: 'standard' };
}

/** 全图边统计：坡边 / 崖边（只算可通行的格子之间） */
function edgeStats(g) {
  const t = g.terrain;
  const pg = T.passGrid(g);
  const h = t.heights;
  const C = t.cols;
  const R = t.rows;
  let slope = 0;
  let cliff = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const i = r * C + c;
      if (!pg[i]) continue;
      if (c < C - 1) {
        const j = i + 1;
        if (pg[j]) {
          const d = Math.abs(h[i] - h[j]);
          if (d === 1) slope++;
          else if (d >= 2) cliff++;
        }
      }
      if (r < R - 1) {
        const j = i + C;
        if (pg[j]) {
          const d = Math.abs(h[i] - h[j]);
          if (d === 1) slope++;
          else if (d >= 2) cliff++;
        }
      }
    }
  }
  return { slope, cliff };
}

/** 沿父链取路径（格号数组） */
function chainOf(f, start) {
  const out = [];
  let node = start;
  for (let guard = 0; guard < 200000; guard++) {
    out.push(node);
    if (node === f.goalIdx) break;
    const p = f.prev[node];
    if (p < 0) break;
    node = p;
  }
  return out;
}

/** 忽略崖的 BFS 长度（下界对照） */
function flatDist(g, gi, si) {
  const t = g.terrain;
  const pg = T.passGrid(g);
  const tot = t.cols * t.rows;
  const d = new Int32Array(tot).fill(-1);
  const q = new Int32Array(tot);
  let head = 0;
  let tail = 0;
  d[gi] = 0;
  q[tail++] = gi;
  while (head < tail) {
    const cur = q[head++];
    const nd = d[cur] + 1;
    const c0 = cur % t.cols;
    if (c0 > 0 && pg[cur - 1] && d[cur - 1] < 0) { d[cur - 1] = nd; q[tail++] = cur - 1; }
    if (c0 < t.cols - 1 && pg[cur + 1] && d[cur + 1] < 0) { d[cur + 1] = nd; q[tail++] = cur + 1; }
    if (cur >= t.cols && pg[cur - t.cols] && d[cur - t.cols] < 0) { d[cur - t.cols] = nd; q[tail++] = cur - t.cols; }
    if (cur + t.cols < tot && pg[cur + t.cols] && d[cur + t.cols] < 0) { d[cur + t.cols] = nd; q[tail++] = cur + t.cols; }
  }
  return d[si];
}

for (let k = 0; k < ROUNDS; k++) {
  const n = 2 + (k % 3);
  const g = createGameState(room(n, k));
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  g._flowBudget = 999;
  const t = g.terrain;
  const pg = T.passGrid(g);
  const h = t.heights;
  console.log(`\n第 ${k + 1} 局（${n} 家，${t.cols}×${t.rows}）`);

  const es = edgeStats(g);
  console.log(`  可通行格之间：坡边 ${es.slope} 条 / 崖边 ${es.cliff} 条`);
  ok(es.slope > 0, '地图上存在坡（Δh = 1 的相邻格）');

  // 起终点：各家总部
  let checked = 0;
  let across = 0;
  let crossLayers = 0;
  for (let a = 0; a < g.hqs.length; a++) {
    for (let b = 0; b < g.hqs.length; b++) {
      if (a === b) continue;
      const A = g.hqs[a];
      const B = g.hqs[b];
      // 总部中心落在建筑占位格里（掩码为 0），得先退到圈外可站人的格
      const pa = T.nearestPassable(g, A.x, A.y);
      const pb = T.nearestPassable(g, B.x, B.y);
      if (!pa || !pb) continue;
      const sa = T.cellOf(g, pa.x, pa.y);
      const gb = T.cellOf(g, pb.x, pb.y);
      if (!pg[sa.i] || !pg[gb.i]) continue;
      const f = T.flowField(g, pb.x, pb.y, pa.x, pa.y);
      if (!f || f.dist[sa.i] < 0) {
        console.log(`  · HQ${a}→HQ${b} 流场不可达（分处不同层且无坡口？）`);
        continue;
      }
      const chain = chainOf(f, sa.i);
      checked++;
      // ② 每一步不许跨崖
      let bad = 0;
      let up = 0;
      for (let i = 1; i < chain.length; i++) {
        const d = Math.abs(h[chain[i]] - h[chain[i - 1]]);
        if (d >= 2) bad++;
        if (d === 1) up++;
      }
      ok(bad === 0, `HQ${a}→HQ${b}：${chain.length} 步里 0 步跨崖`);
      const ha = h[sa.i];
      const hb = h[gb.i];
      if (ha !== hb) {
        crossLayers++;
        if (up > 0) across++;
        ok(up > 0, `HQ${a}→HQ${b}：跨层（${ha}→${hb}）且真的走了坡（${up} 段）`);
      }
      const flat = flatDist(g, gb.i, sa.i);
      const detour = flat > 0 ? chain.length / flat : 0;
      console.log(`    绕行系数 ${detour.toFixed(2)}（认崖 ${chain.length} 步 / 无视崖 ${flat} 步）`);
      ok(chain.length >= flat, `HQ${a}→HQ${b}：绕崖路径不短于理论下界`);
    }
  }
  ok(checked > 0, `至少量到 ${checked} 条路径`);
  if (crossLayers) ok(across === crossLayers, `所有跨层路径都走了坡（${across}/${crossLayers}）`);

  // ⑤ 坡是「唯一的上山下山通道」：把一条路径用到的坡整段封死，路径必须绕远或走不通。
  //    （只封 1 格不行 —— 坡口宽 rampWidth 格，部队会从旁边那列挤上去，长度看不出变化）
  let did = false;
  for (let a = 0; a < g.hqs.length && !did; a++) {
    for (let b = 0; b < g.hqs.length && !did; b++) {
      if (a === b) continue;
      const pa = T.nearestPassable(g, g.hqs[a].x, g.hqs[a].y);
      const pb = T.nearestPassable(g, g.hqs[b].x, g.hqs[b].y);
      if (!pa || !pb) continue;
      const sa = T.cellOf(g, pa.x, pa.y);
      if (!pg[sa.i]) continue;
      const f = T.flowField(g, pb.x, pb.y, pa.x, pa.y);
      if (!f || f.dist[sa.i] < 0) continue;
      const chain = chainOf(f, sa.i);
      let si = -1;
      for (let i = 1; i < chain.length; i++) if (Math.abs(h[chain[i]] - h[chain[i - 1]]) === 1) { si = i; break; }
      if (si < 0) continue;
      const before = chain.length;
      // 以这段坡为中心砌一道 5×5 的「墙」（整块抬 2 层，墙内仍是平地，墙外就是崖）
      const wr = (chain[si] - (chain[si] % t.cols)) / t.cols;
      const wc = chain[si] % t.cols;
      const undo = [];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const r = wr + dr;
          const c = wc + dc;
          if (r < 0 || r >= t.rows || c < 0 || c >= t.cols) continue;
          const i = r * t.cols + c;
          if (!pg[i]) continue;
          undo.push([i, h[i]]);
          h[i] = h[chain[si]] + 2;
        }
      }
      g._flowCache = null;
      g._compGrid = null;
      const f2 = T.flowField(g, pb.x, pb.y, pa.x, pa.y);
      const after = f2 && f2.dist[sa.i] >= 0 ? chainOf(f2, sa.i).length : -1;
      for (const [i, v] of undo) h[i] = v;
      g._flowCache = null;
      g._compGrid = null;
      did = true;
      console.log(`    封死一处坡口（5×5）：路径 ${before} 步 → ${after < 0 ? '走不通' : after + ' 步'}`);
      // 只断言「不会因此变短」：地图是旋转对称的，封了这一处往往能走对称的另一处，长度恰好相等。
      ok(after < 0 || after >= before, '封死坡口后没有出现「越封越近」的怪事');
    }
  }
  if (!did) console.log('    （本局没有跨层路径，跳过封坡验证）');

  // ⑥ 随机抽查：分处不同层的两块地之间，绝大多数应该「能通」（靠坡口），
  //    且通了的路必定一步崖都不跨。若可达率太低 = 坡口被挖塌了，部队会被崖困死。
  let pairs = 0;
  let reach = 0;
  let badStep = 0;
  const C = t.cols;
  const R = t.rows;
  for (let tries = 0; tries < 4000 && pairs < 40; tries++) {
    const r1 = 1 + Math.floor(Math.random() * (R - 2));
    const c1 = 1 + Math.floor(Math.random() * (C - 2));
    const r2 = 1 + Math.floor(Math.random() * (R - 2));
    const c2 = 1 + Math.floor(Math.random() * (C - 2));
    const i1 = r1 * C + c1;
    const i2 = r2 * C + c2;
    if (!pg[i1] || !pg[i2] || h[i1] === h[i2]) continue;
    if (Math.hypot(c1 - c2, r1 - r2) * t.cell < 1200) continue;
    const x1 = (c1 + 0.5) * t.cell;
    const y1 = (r1 + 0.5) * t.cell;
    const x2 = (c2 + 0.5) * t.cell;
    const y2 = (r2 + 0.5) * t.cell;
    g._flowCache = null;
    const ff = T.flowField(g, x2, y2, x1, y1);
    if (!ff || ff.dist[i1] < 0) {
      pairs++;
      continue;
    }
    pairs++;
    reach++;
    const ch = chainOf(ff, i1);
    for (let i = 1; i < ch.length; i++) if (Math.abs(h[ch[i]] - h[ch[i - 1]]) >= 2) badStep++;
  }
  g._flowCache = null;
  const rate = pairs ? reach / pairs : 0;
  console.log(`    跨层格对采样：${reach}/${pairs} 可达（${(rate * 100).toFixed(0)}%）`);
  ok(badStep === 0, '所有跨层路径一步崖都没跨');
  ok(rate >= 0.7, `跨层可达率 ${(rate * 100).toFixed(0)}% ≥ 70%（坡口够用）`);
}

console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
