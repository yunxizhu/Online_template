'use strict';

/**
 * 寻路冒烟：node server/games/warfactory/smoke/path.js
 *
 * 几件事，一件都不能再退回去：
 *   ① 向量场 —— SolasXer 口径：每格 next 指向「navStepOk + dist 最低」的邻格，
 *      沿 next 链每一步都得是「可通行 + 不跨崖」的真边（否则又会指到崖对面抖）。
 *   ② 建筑地基出得去 —— 地基垫平圈必须大过寻路掩码的占位圈，
 *      否则生在建筑里的兵一辈子出不来（实测 5 秒位移 1.2px 的那种）。
 *   ③ 整队远征不空转 —— 下令跨越半张图后，队伍必须真的在往落点推进。
 *   ④ 斜线 —— 向量场是 8 向的，next 链里得有对角步，不能永远「横一段 + 竖一段」。
 *   ⑤ 坡与崖 —— 跨层只能走坡；对角切崖角也必须拦住。
 */

const mod = require('..');
const { createGameState, setPlayerInput, __test } = mod;
const C = __test.consts;
const WFData = require('../data.js');

let failed = 0;
function ok(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) failed += 1;
}

const CLIFF = WFData.height.cliffAt;
const DT = 0.1;

function room(n, tag) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: 'p' + i + '-' + tag, name: 'P' + i });
  return { id: 'path-' + tag, players };
}

console.log('寻路冒烟');

/* ---- ① 向量场：每一步都得真走得通 ---- */
console.log('\n[1] 向量场 next 链（每一步可通行 · 不跨崖 · 严格递减）');
{
  const g = createGameState(room(3, 'chain'));
  const t = g.terrain;
  const pg = __test.passGrid(g);
  const cb = __test.compLabels(g);
  // 起点取「总部外缘第一格站得住人的地方」：总部圆心本身在掩码里是 0，
  // 拿它当起点的话流场压根标不到它（dist = -1），测的就不是路了。
  const hq = g.hqs[0];
  const from = __test.nearestPassable(g, hq.x, hq.y);
  const fromCell = __test.cellOf(g, from.x, from.y);
  const wantComp = cb.lab[fromCell.i];
  // 终点取一块同分量、离起点够远的空地，逼出一条长得能看出问题的路
  let goal = null;
  let bd = Infinity;
  for (let r = 2; r < t.rows - 2; r += 3) {
    for (let c = 2; c < t.cols - 2; c += 3) {
      const i = r * t.cols + c;
      if (!pg[i] || cb.lab[i] !== wantComp) continue;
      const px = (c + 0.5) * t.cell;
      const py = (r + 0.5) * t.cell;
      const d = Math.hypot(px - from.x, py - from.y);
      if (d < 2500 || d >= bd) continue;
      bd = d;
      goal = { x: px, y: py };
    }
  }
  ok(Boolean(goal), '找到落点');
  g._flowBudget = 99; // 手动时钟下 step() 没跑过，预算得自己给
  const f = __test.flowField(g, goal.x, goal.y, from.x, from.y);
  ok(Boolean(f && f.next && f.dirX && f.dirY), '流场带向量（next / dirX / dirY）');
  const start = fromCell.i;
  ok(f && f.dist[start] > 20, `总部到落点有 ${f ? f.dist[start] : 0} 格路程`);
  let steps = 0;
  let badEdge = 0;
  let badDrop = 0;
  let badDir = 0;
  let node = start;
  const rmp = t.ramps;
  const cols = t.cols;
  while (f && node >= 0 && node !== f.goalIdx && steps < 5000) {
    const nx = f.next[node];
    if (nx < 0) break;
    if (!pg[nx]) badEdge++;
    // 跨了 ≥cliffAt 层却两端都不是坡 = 真的穿墙了。
    // 坡道是「无视高低差也能走」的地形，走坡时跨几层都合法（见 cliffBetween）。
    if (Math.abs(t.heights[nx] - t.heights[node]) >= CLIFF && !(rmp && (rmp[nx] || rmp[node]))) badEdge++;
    // 加权 Dijkstra：每一步代价必须严格下降（不再要求恰好 -1）
    if (!(f.dist[nx] < f.dist[node] - 1e-6)) badDrop++;
    // 方向向量应指向 next 邻格
    const c0 = node % cols;
    const r0 = (node - c0) / cols;
    const c1 = nx % cols;
    const r1 = (nx - c1) / cols;
    const wantX = c1 - c0;
    const wantY = r1 - r0;
    const wlen = Math.hypot(wantX, wantY) || 1;
    const dx = f.dirX[node];
    const dy = f.dirY[node];
    if (Math.hypot(dx - wantX / wlen, dy - wantY / wlen) > 0.05) badDir++;
    node = nx;
    steps++;
  }
  ok(steps > 20, `沿向量链走出 ${steps} 步`);
  ok(badEdge === 0, `每一步都可通行、跨层只在坡上（越界 ${badEdge} 步）`);
  ok(badDrop === 0, `每一步都严格靠近目标（异常 ${badDrop} 步）`);
  ok(badDir === 0, `dirX/dirY 与 next 一致（异常 ${badDir} 步）`);
  ok(f && node === f.goalIdx, '向量链一路走到目标格');
}

/* ---- ② 建筑地基出得去 ---- */
console.log('\n[2] 建筑地基（垫平圈必须大过占位圈，否则生在里面出不来）');
for (let k = 0; k < 6; k++) {
  const n = 2 + (k % 3);
  const g = createGameState(room(n, 'pad' + k));
  const t = g.terrain;
  const pg = __test.passGrid(g);
  const sites = [];
  for (const h of g.hqs) sites.push({ kind: '总部', x: h.x, y: h.y, r: C.HQ_R });
  for (const f of g.factories) sites.push({ kind: '工厂', x: f.x, y: f.y, r: C.FACTORY_R });
  for (const l of g.labs) sites.push({ kind: '研究所', x: l.x, y: l.y, r: C.LAB_R });
  let walled = 0;
  for (const s of sites) {
    const cc = Math.floor(s.x / t.cell);
    const cr = Math.floor(s.y / t.cell);
    const out0 = Math.ceil(s.r / t.cell);
    let exit = 0;
    for (let dr = -out0 - 3; dr <= out0 + 3; dr++) {
      for (let dc = -out0 - 3; dc <= out0 + 3; dc++) {
        const r = cr + dr;
        const c = cc + dc;
        if (r < 0 || r >= t.rows || c < 0 || c >= t.cols) continue;
        const i = r * t.cols + c;
        if (!pg[i]) continue;
        if (Math.hypot((c + 0.5) * t.cell - s.x, (r + 0.5) * t.cell - s.y) <= s.r + 24) continue;
        for (const [ar, ac] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const pr = r + ar;
          const pc = c + ac;
          if (pr < 0 || pr >= t.rows || pc < 0 || pc >= t.cols) continue;
          const pi = pr * t.cols + pc;
          const inPad = Math.hypot((pc + 0.5) * t.cell - s.x, (pr + 0.5) * t.cell - s.y) <= s.r + 24;
          if (!inPad) continue;
          if (Math.abs(t.heights[pi] - t.heights[i]) < CLIFF) exit++;
        }
      }
    }
    if (exit === 0) walled++;
  }
  ok(walled === 0, `${n} 人局 #${k + 1}：${sites.length} 座建筑的地基都有出口（被围死 ${walled} 座）`);
}

/* ---- ③ 整队远征不空转 ---- */
console.log('\n[3] 整队远征（下令后必须真在推进，不许原地打转）');
for (let k = 0; k < 3; k++) {
  const n = 2 + (k % 2);
  const g = createGameState(room(n, 'march' + k));
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  const t = g.terrain;
  const pg = __test.passGrid(g);
  const cb = __test.compLabels(g);
  /** 某坐标所在连通分量（站在建筑占位格里时退到最近的可通行格） */
  const compOf = (x, y) => {
    const c = Math.min(t.cols - 1, Math.max(0, Math.floor(x / t.cell)));
    const r = Math.min(t.rows - 1, Math.max(0, Math.floor(y / t.cell)));
    let l = cb.lab[r * t.cols + c];
    if (l < 0) {
      for (let ring = 1; ring <= 6 && l < 0; ring++) {
        for (let dr = -ring; dr <= ring && l < 0; dr++) {
          for (let dc = -ring; dc <= ring && l < 0; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= t.rows || cc < 0 || cc >= t.cols) continue;
            if (pg[rr * t.cols + cc]) l = cb.lab[rr * t.cols + cc];
          }
        }
      }
    }
    return l;
  };
  const army = g.units.filter((u) => !u.dead && u.ownerIdx === 0);
  const cnt = {};
  for (const u of army) cnt[compOf(u.x, u.y)] = (cnt[compOf(u.x, u.y)] || 0) + 1;
  const mainK = Number(Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]);
  const grp = army.filter((u) => compOf(u.x, u.y) === mainK);
  const ax = grp.reduce((a, u) => a + u.x, 0) / grp.length;
  const ay = grp.reduce((a, u) => a + u.y, 0) / grp.length;
  let dst = null;
  let bd = Infinity;
  for (let r = 2; r < t.rows - 2; r += 2) {
    for (let c = 2; c < t.cols - 2; c += 2) {
      const i = r * t.cols + c;
      if (!pg[i] || cb.lab[i] !== mainK) continue;
      const d = Math.hypot((c + 0.5) * t.cell - ax, (r + 0.5) * t.cell - ay);
      if (d < 2200 || d >= bd) continue;
      bd = d;
      dst = { x: (c + 0.5) * t.cell, y: (r + 0.5) * t.cell };
    }
  }
  if (!dst) {
    ok(true, `${n} 人局 #${k + 1}：这张图找不到够远的落点，跳过`);
    continue;
  }
  let now = 1000;
  const d0 = grp.map((u) => Math.hypot(u.x - dst.x, u.y - dst.y));
  const walked = grp.map(() => 0);
  const last = grp.map((u) => ({ x: u.x, y: u.y }));
  const from = grp.map((u) => ({ x: u.x, y: u.y }));
  ok(
    setPlayerInput(g, g.players[0].id, { cmd: 'move', x: dst.x, y: dst.y, ids: grp.map((u) => u.id) }, now),
    '移动指令被接受'
  );
  for (let s = 0; s < 1200; s++) {
    now += DT * 1000;
    __test.step(g, DT, now);
    for (let i = 0; i < grp.length; i++) {
      if (grp[i].dead) continue;
      walked[i] += Math.hypot(grp[i].x - last[i].x, grp[i].y - last[i].y);
      last[i].x = grp[i].x;
      last[i].y = grp[i].y;
    }
  }
  if (process.env.WF_PATH_DEBUG) {
    console.log('    落点', Math.round(dst.x), Math.round(dst.y), 'd0', d0.map((v) => Math.round(v)).join(','));
    console.log('    矫正后', grp.map((u) => (u.moveX == null ? '-' : Math.round(u.moveX) + ',' + Math.round(u.moveY))).join(' | '));
    console.log('    d1', grp.map((u) => Math.round(Math.hypot(u.x - dst.x, u.y - dst.y))).join(','));
    console.log('    walked', walked.map((v) => Math.round(v)).join(','));
  }
  // 判据盯着「原地打转」本身：**跑了很多路却几乎没离开出发地**才是寻路坏了 ——
  // （旧 bug 实测：跑了 15751px、离目标反而更远，因为它一直在崖沿来回翻）。
  // ⚠️ 不能拿「有没有靠近目标」当判据：地图中间横着一整片山/水时，合法路径会先
  // 大幅远离目标再绕回来（实测绕行系数 5+，120s 走 12600px 还没走完也属正常）。
  // 于是改用「净位移 / 累计位移」：绕远是单向长路（比值 0.3~0.9），打转则趋近 0。
  let spinning = 0;
  let arrived = 0;
  let straightSum = 0;
  let straightN = 0;
  for (let i = 0; i < grp.length; i++) {
    const u = grp[i];
    if (u.dead) continue;
    const d1 = Math.hypot(u.x - dst.x, u.y - dst.y);
    if (d1 < 60) {
      arrived++;
      continue;
    }
    const net = Math.hypot(u.x - from[i].x, u.y - from[i].y);
    const straight = walked[i] > 0 ? net / walked[i] : 1;
    straightSum += straight;
    straightN++;
    if (walked[i] > 1500 && straight < 0.12) spinning++;
  }
  const avgStraight = straightN ? straightSum / straightN : 1;
  ok(
    spinning === 0,
    `${n} 人局 #${k + 1}：${grp.length} 支行军 120s，无一原地打转（到达 ${arrived}，打转 ${spinning}，净位移/里程 ${avgStraight.toFixed(2)}）`
  );
}

/* ---- ④ 多点路径（Shift+右键规划）：依次走完每个路点 ---- */
console.log('\n[4] 多点路径（路点依次推进 · 走完清空 · 停止即作废）');
for (let k = 0; k < 3; k++) {
  const n = 2 + (k % 2);
  const g = createGameState(room(n, 'route' + k));
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  const t = g.terrain;
  const pg = __test.passGrid(g);
  const cb = __test.compLabels(g);
  const compOf = (x, y) => {
    const c = Math.min(t.cols - 1, Math.max(0, Math.floor(x / t.cell)));
    const r = Math.min(t.rows - 1, Math.max(0, Math.floor(y / t.cell)));
    let l = cb.lab[r * t.cols + c];
    if (l < 0) {
      for (let ring = 1; ring <= 6 && l < 0; ring++) {
        for (let dr = -ring; dr <= ring && l < 0; dr++) {
          for (let dc = -ring; dc <= ring && l < 0; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= t.rows || cc < 0 || cc >= t.cols) continue;
            if (pg[rr * t.cols + cc]) l = cb.lab[rr * t.cols + cc];
          }
        }
      }
    }
    return l;
  };
  const u = g.units.find((x) => !x.dead && x.ownerIdx === 0);
  const k0 = compOf(u.x, u.y);
  // 三个路点：都取同一连通分量里、离当前位置越来越远的空地，最后回到起点附近
  const wps = [];
  for (const want of [900, 1800, 2600]) {
    let best = null;
    let bd = Infinity;
    for (let r = 2; r < t.rows - 2; r += 2) {
      for (let c = 2; c < t.cols - 2; c += 2) {
        const i = r * t.cols + c;
        if (!pg[i] || cb.lab[i] !== k0) continue;
        const px = (c + 0.5) * t.cell;
        const py = (r + 0.5) * t.cell;
        const d = Math.hypot(px - u.x, py - u.y);
        if (Math.abs(d - want) >= bd) continue;
        bd = Math.abs(d - want);
        best = { x: px, y: py };
      }
    }
    if (best) wps.push(best);
  }
  if (wps.length < 2) {
    ok(true, `${n} 人局 #${k + 1}：这张图凑不出多个路点，跳过`);
    continue;
  }
  let now = 1000;
  const last = wps[wps.length - 1];
  ok(
    setPlayerInput(
      g,
      g.players[0].id,
      { cmd: 'move', x: last.x, y: last.y, path: wps, ids: [u.id] },
      now
    ),
    '多点移动指令被接受'
  );
  ok(Boolean(u.route) && u.route.length === wps.length - 1, `路点入链：当前奔向第 1 个，余 ${u.route && u.route.length} 个`);
  const firstGoal = { x: u.moveX, y: u.moveY };
  ok(Math.hypot(firstGoal.x - wps[0].x, firstGoal.y - wps[0].y) < 200, '第一个目标是第 1 个路点（不是终点）');
  // 跑到走完所有路点（最多 300 秒游戏时间）
  let steps = 0;
  let done = false;
  for (let s = 0; s < 3000 && !done; s++) {
    now += DT * 1000;
    __test.step(g, DT, now);
    steps++;
    if (u.dead || (u.moveX == null && !u.route)) done = true;
  }
  const dLast = Math.hypot(u.x - last.x, u.y - last.y);
  ok(done, `${n} 人局 #${k + 1}：${wps.length} 个路点全部走完（${(steps * DT).toFixed(0)}s，指令已清空）`);
  ok(u.route == null && u.moveX == null, '走完后 route / moveX 都清干净（不会卡住不还手）');
  ok(dLast < 120, `最终停在终点附近（离 ${Math.round(dLast)}px）`);
  // 停止指令要能作废整条链
  setPlayerInput(g, g.players[0].id, { cmd: 'move', x: last.x, y: last.y, path: wps, ids: [u.id] }, now);
  const before = u.route ? u.route.length : 0;
  setPlayerInput(g, g.players[0].id, { cmd: 'stop', ids: [u.id] }, now);
  ok(before > 0 && u.route == null && u.moveX == null, 'stop 能把整条规划链一次作废');
}

/* ---- ⑤ 斜线寻路：向量链必须含对角步，不能永远是「横 + 竖」---- */
console.log('\n[5] 斜线寻路（8 向向量场，next 链含对角）');
{
  const g = createGameState(room(3, 'diag'));
  g._flowBudget = 99;
  const t = g.terrain;
  const pg = __test.passGrid(g);
  const cb = __test.compLabels(g);
  const hq = g.hqs[0];
  const from = __test.nearestPassable(g, hq.x, hq.y);
  const fromCell = __test.cellOf(g, from.x, from.y);
  const wantComp = cb.lab[fromCell.i];
  // 找一个「斜向够远」的同分量落点（Δx、Δy 都大），逼出对角边
  let goal = null;
  let bd = 0;
  for (let r = 2; r < t.rows - 2; r += 2) {
    for (let c = 2; c < t.cols - 2; c += 2) {
      const i = r * t.cols + c;
      if (!pg[i] || cb.lab[i] !== wantComp) continue;
      const px = (c + 0.5) * t.cell;
      const py = (r + 0.5) * t.cell;
      const dx = Math.abs(px - from.x);
      const dy = Math.abs(py - from.y);
      if (dx < 1800 || dy < 1800) continue;
      const d = Math.hypot(dx, dy);
      if (d <= bd) continue;
      bd = d;
      goal = { x: px, y: py };
    }
  }
  ok(Boolean(goal), '找到斜向落点');
  const f = goal ? __test.flowField(g, goal.x, goal.y, from.x, from.y) : null;
  let card = 0;
  let diag = 0;
  let node = fromCell.i;
  const cols = t.cols;
  while (f && node >= 0 && node !== f.goalIdx && card + diag < 8000) {
    const p = f.next[node];
    if (p < 0) break;
    const dc = (p % cols) - (node % cols);
    const dr = Math.floor(p / cols) - Math.floor(node / cols);
    if (dc && dr) diag++;
    else card++;
    node = p;
  }
  const hops = card + diag;
  ok(hops > 20, `斜向路径有 ${hops} 步`);
  ok(diag > 0, `向量链含对角步（对角 ${diag} / 正交 ${card}）`);
  ok(diag / Math.max(1, hops) >= 0.15, `对角占比 ${(diag / Math.max(1, hops) * 100).toFixed(0)}% ≥ 15%`);
}

/* ---- ⑥ 对角切崖角必须被拦住；跨层只能走坡 ---- */
console.log('\n[6] 坡可通行 / 崖不可通行（含对角切角禁令）');
{
  const g = createGameState(room(3, 'ramp'));
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  g._flowBudget = 999;
  const t = g.terrain;
  const pg = __test.passGrid(g);
  const h = t.heights;
  const C = t.cols;
  const R = t.rows;
  // 地图上得真有坡，否则「坡能走」无从谈起
  let slopeEdges = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const i = r * C + c;
      if (!pg[i]) continue;
      if (c < C - 1 && pg[i + 1] && Math.abs(h[i] - h[i + 1]) === 1) slopeEdges++;
      if (r < R - 1 && pg[i + C] && Math.abs(h[i] - h[i + C]) === 1) slopeEdges++;
    }
  }
  ok(slopeEdges > 0, `地图上存在坡（Δh = 1 的相邻格 ${slopeEdges} 条）`);

  // 对角切崖角：两端同层，但**两侧**正交邻格都是崖（或实体障碍）——
  // 只有这时候斜跨才是「切角上崖」；一侧开着时线段会贴着开着的那侧走，算绕行不算切角。
  //
  // ⚠️ 「崖」的口径要与 cliffBetween 一致：**坡道格不是崖**（坡是「无视高低差也能走」的
  //    地形）。所以坡道参与的斜跨是合法通行，不能算进「切崖角」用例 ——
  //    否则会用例本身造错，断言就会去禁止一条合法路径。
  const rmp = t.ramps;
  const isCliffCell = (idx, refA, refB) => {
    if (rmp && rmp[idx]) return false; // 坡不是崖
    if (!pg[idx]) return true;
    return Math.abs(h[refA] - h[idx]) >= CLIFF || Math.abs(h[refB] - h[idx]) >= CLIFF;
  };
  let cutCases = 0;
  let cutAllowed = 0;
  let navDiag = 0;
  for (let r = 1; r < R - 1; r++) {
    for (let c = 1; c < C - 1; c++) {
      const i = r * C + c;
      if (!pg[i]) continue;
      if (rmp && rmp[i]) continue; // 起点在坡上 → 不算切崖角
      for (const [dr, dc] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const rr = r + dr;
        const cc = c + dc;
        const j = rr * C + cc;
        if (!pg[j]) continue;
        if (rmp && rmp[j]) continue; // 终点在坡上 → 合法斜跨，不算切崖角
        if (Math.abs(h[i] - h[j]) >= CLIFF) continue;
        const iH = r * C + cc;
        const iV = rr * C + c;
        if (!isCliffCell(iH, i, j) || !isCliffCell(iV, i, j)) continue;
        cutCases++;
        if (mod.navStepOk && mod.navStepOk(g, pg, C, i, j)) navDiag++;
        const ax = (c + 0.5) * t.cell;
        const ay = (r + 0.5) * t.cell;
        const bx = (cc + 0.5) * t.cell;
        const by = (rr + 0.5) * t.cell;
        if (__test.canStand(g, bx, by, 10, ax, ay)) cutAllowed++;
      }
    }
  }
  ok(cutCases > 0, `找到双侧封死的对角切崖角用例 ${cutCases} 个（已排除坡道）`);
  ok(navDiag === 0, `流场边 navStepOk 不放行对角切角（放行 ${navDiag}）`);
  ok(cutAllowed === 0, `canStand 不放行对角切角（放行 ${cutAllowed}）`);

  const chainOf = (f, start) => {
    const out = [];
    let node = start;
    for (let guard = 0; guard < 200000; guard++) {
      out.push(node);
      if (node === f.goalIdx) break;
      const p = f.next ? f.next[node] : f.prev[node];
      if (p < 0) break;
      node = p;
    }
    return out;
  };
  // 分处不同层的两块地之间：能通，且**每一处跨层都发生在坡道上**
  //
  // ⚠️ 口径随「坡 = 一种无视高低差的地形」而变（见 index.js 的 cliffBetween）：
  //    以前坡道是靠「每步只差 1 层」硬扛过去的，所以断言是「全程一步崖都不跨」。
  //    现在坡道格被服务端显式标记，**走坡时跨几层都合法** ——
  //    于是断言改成：跨 ≥cliffAt 层的那一步，两端**至少有一端是坡道**。
  //    没有坡道参与却跨了崖，才是真的穿墙（那正是要防的 bug）。
  let pairs = 0;
  let reach = 0;
  let cliffSteps = 0;
  let slopeUsed = 0;
  const ramps = t.ramps;
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
    const f = __test.flowField(g, x2, y2, x1, y1);
    pairs++;
    if (!f || f.dist[i1] < 0) continue;
    reach++;
    const ch = chainOf(f, i1);
    for (let i = 1; i < ch.length; i++) {
      const a = ch[i - 1];
      const b = ch[i];
      // 跨了 ≥cliffAt 层却两端都不是坡 = 真的穿墙了
      if (Math.abs(h[b] - h[a]) >= 2 && !(ramps && (ramps[a] || ramps[b]))) cliffSteps++;
      if (Math.abs(h[b] - h[a]) === 1 || (ramps && (ramps[a] || ramps[b]))) slopeUsed++;
    }
  }
  g._flowCache = null;
  ok(cliffSteps === 0, `${reach} 条跨层路径，所有跨层都发生在坡道上（无端穿墙 ${cliffSteps}）`);
  ok(slopeUsed > 0, `跨层路径真的走了坡（${slopeUsed} 段）`);
  // 坡确实是一种「无视高低差」的地形：至少存在一步在坡上跨了 ≥2 层
  let bigRampSteps = 0;
  g._flowCache = null;
  for (let k = 0; k < 2000; k++) {
    const i = Math.floor(Math.random() * R * C);
    if (!pg[i] || !ramps || !ramps[i]) continue;
    for (const j of [i - 1, i + 1, i - C, i + C]) {
      if (j < 0 || j >= R * C || !pg[j]) continue;
      if (Math.abs(h[j] - h[i]) >= 2) {
        bigRampSteps++;
        break;
      }
    }
    if (bigRampSteps > 0) break;
  }
  ok(bigRampSteps > 0, '坡道上存在「跨 ≥2 层也能走」的格子（坡 = 无视高低差的地形）');
  const rate = pairs ? reach / pairs : 0;
  ok(rate >= 0.7, `跨层可达率 ${(rate * 100).toFixed(0)}% ≥ 70%（坡口够用）`);
}

console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
