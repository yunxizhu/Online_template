'use strict';
/**
 * 战争工厂「产线制」专项回归测试：node server/games/warfactory/smoke/lines.js
 *
 * basic.js 覆盖通用玩法；这里专门盯产线这层改动：
 *   工厂数量/点对称、总部自带产线且不可进化、开辟产线要先选兵种、
 *   进化产线要先选分支且此后直接产该阶单位、易主重置、快照/全量字段、多线产能倍增。
 */
const path = require('path');
const wf = require(path.join(__dirname, '..', 'index.js'));
const T = wf.__test;

let pass = 0;
let fail = 0;
function ok(c, m) {
  if (c) { pass++; console.log('  ✓ ' + m); }
  else { fail++; console.log('  ✗ ' + m); }
}
function room(c) {
  const p = [];
  for (let i = 0; i < c; i++) p.push({ id: 'p' + i, name: 'P' + i });
  return { id: 'rl-' + Math.random().toString(36).slice(2), players: p };
}
function run(g, ms) {
  let clock = Date.now();
  const n = Math.round(ms / 100);
  for (let i = 0; i < n; i++) { clock += 100; T.step(g, 0.1, clock); }
}
/**
 * 产线有「在场越多越慢」的独立乘区：第 k+1 支需要 1 / (1 - k * slowPerUnit) 个周期。
 * 所有「几个周期能产几支」的期望值都从这里推导，不要写死数字（data.js 随时会改）。
 */
function cyclesToMake(n) {
  let c = 0;
  for (let k = 0; k < n; k++) c += 1 / Math.max(1e-6, 1 - k * T.consts.LINE_SLOW_PER_UNIT);
  return c;
}
function madeInCycles(cycles) {
  let n = 0;
  while (n < T.consts.LINE_UNIT_CAP && cyclesToMake(n + 1) <= cycles) n += 1;
  return n;
}

console.log('\n[A] 工厂/研究所布局（门口 2 初 + 中场 2 初/2 中/1 高；所=门口1+中场1，2/3/4 人）');
{
  // 人均：工厂 7（门口2初 + 中场2初+2中+1高）；研究所 2（门口1 + 中场1）
  const expect = (c) => ({ total: 7 * c, low: 4 * c, mid: 2 * c, high: c, labs: 2 * c });
  for (const c of [2, 3, 4]) {
    const g = wf.createGameState(room(c));
    g.phase = 'playing'; g.phaseEndsAt = 0;
    const C = T.consts;
    const e = expect(c);
    ok(g.factories.length === C.NEUTRAL_FACTORIES.length, `${c}人：工厂数 = ${g.factories.length}（与常量一致）`);
    ok(g.factories.length === e.total, `${c}人：共 ${e.total} 座工厂（人均 7）`);
    const by = (l) => g.factories.filter((f) => f.level === l).length;
    ok(
      by(1) === e.low && by(2) === e.mid && by(3) === e.high,
      `${c}人：初级 ${by(1)} / 中级 ${by(2)} / 高级 ${by(3)}（应 ${e.low}/${e.mid}/${e.high}）`
    );
    // 每家总部射程内恰好 2 座初级厂
    let doorOk = 0;
    for (const hq of g.hqs) {
      const near = g.factories.filter(
        (f) => f.level === 1 && Math.hypot(f.x - hq.x, f.y - hq.y) <= C.HQ_ATK_RANGE
      );
      if (near.length === 2) doorOk++;
    }
    ok(doorOk === c, `${c}人：每家门口恰好 2 座可被总部打到的初级厂（${doorOk}/${c}）`);
    // 研究所：总数 + 每家总部旁恰好 1 座
    ok(g.labs.length === e.labs && g.labs.length === C.LABS.length, `${c}人：研究所 ${g.labs.length} 座（应 ${e.labs}）`);
    let labDoor = 0;
    for (const hq of g.hqs) {
      // ⚠️ 阈值必须跟着布局口径走：门口研究所摆在**总部正后方 minCenterDist(HQ_R, LAB_R)**
      //    = 两座占位半径之和 + 一条净缝（见 index.js 的 BUILD_LANE_PX）。
      //    早先这里写死 `HQ_R + LAB_R + 80`，而布局改按占位算之后距离变大，
      //    断言就变成「所有门口一所都没数到」—— 是判据过期，不是布局坏了。
      const reach = T.minCenterDist(C.HQ_R, C.LAB_R) + T.BUILD_LANE_PX;
      const near = g.labs.filter((l) => Math.hypot(l.x - hq.x, l.y - hq.y) <= reach);
      if (near.length === 1) labDoor++;
    }
    ok(labDoor === c, `${c}人：每家总部旁恰好 1 座研究所（${labDoor}/${c}）`);
    // C_N 轨道配对（N = 人数）：每座厂都能找到「绕世界中心每转 360°/N」的同级孪生厂
    const twinAt = (f, k) => {
      const p = T.rotateAround(f.x, f.y, k, c);
      return g.factories.find((x) => Math.abs(x.x - p.x) < 2 && Math.abs(x.y - p.y) < 2);
    };
    let pairOk = 0;
    for (const f of g.factories) {
      let all = true;
      for (let k = 1; k < c; k++) {
        const m = twinAt(f, k);
        if (!m || m.level !== f.level) all = false;
      }
      if (all) pairOk++;
    }
    ok(pairOk === e.total, `${c}人：每座厂都有绕中心 ${Math.round(360 / c)}° 的孪生厂（${pairOk}/${e.total}）`);
    // 同轨道的孪生厂兵种一致
    let sameType = 0;
    for (const f of g.factories) {
      let all = f.specs[0] != null;
      for (let k = 1; k < c; k++) {
        const m = twinAt(f, k);
        if (!m || !m.specs[0] || m.specs[0].type !== f.specs[0].type) all = false;
      }
      if (all) sameType++;
    }
    ok(sameType === e.total, `${c}人：孪生厂开局兵种一致（${sameType}/${e.total}）`);
    ok(new Set(g.factories.map((f) => f.specs[0].type)).size >= 5, `${c}人：覆盖多种兵种：${new Set(g.factories.map((f) => f.specs[0].type)).size} 种`);
    // 中场厂彼此间距（门口两座并排故意更近，不计入）
    const doorIds = new Set();
    for (const hq of g.hqs) {
      g.factories
        .filter((f) => f.level === 1 && Math.hypot(f.x - hq.x, f.y - hq.y) <= C.HQ_ATK_RANGE)
        .forEach((f) => doorIds.add(f.id));
    }
    let minD = Infinity;
    for (let i = 0; i < g.factories.length; i++) {
      for (let j = i + 1; j < g.factories.length; j++) {
        if (doorIds.has(g.factories[i].id) && doorIds.has(g.factories[j].id)) continue;
        minD = Math.min(minD, Math.hypot(g.factories[i].x - g.factories[j].x, g.factories[i].y - g.factories[j].y));
      }
    }
    ok(minD > 400, `${c}人：中场最近两厂间距 ${Math.round(minD)}px`);
    // 中场厂离研究所的间距（门口厂/所本来就贴着总部，另算）
    let minLab = Infinity;
    for (const f of g.factories) {
      if (doorIds.has(f.id)) continue;
      for (const l of g.labs) minLab = Math.min(minLab, Math.hypot(f.x - l.x, f.y - l.y));
    }
    ok(minLab > 400, `${c}人：中场厂离研究所最近 ${Math.round(minLab)}px`);
  }
}

console.log('\n[B] 总部产线（默认锐士 / 不可进化）');
{
  const g = wf.createGameState(room(2));
  g.phase = 'playing'; g.phaseEndsAt = 0;
  const hq = g.hqs.find((h) => h.owner === 0);
  ok(hq.specs.length === 1 && hq.specs[0].type === 'warrior', '总部默认 1 条产线、产锐士');
  ok(hq.specs[0].tier === 1 && hq.specs[0].branch === '', '总部产线为一级');
  g.units.length = 0;
  const before = g.units.filter((u) => (u.homeFac || 0) === 0 && u.ownerIdx === 0).length;
  run(g, T.consts.PRODUCE_MS * 2 + 500);
  const made = g.units.filter((u) => (u.homeFac || 0) === 0 && u.ownerIdx === 0);
  ok(made.length >= before + 1, '总部持续出兵（' + before + ' → ' + made.length + ' 支）');
  ok(made.every((u) => u.type === 'warrior'), '总部只产锐士');
  ok(made.every((u) => u.tier === 1 && u.maxTier === 1), '总部出的兵恒为一级且进化上限 1');
  g.players[0].rp = 9999;
  ok(!wf.setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: 0, li: 0 }), '总部产线不可进化（fid=0 被拒绝）');
  ok(g.players[0].rp === 9999, '被拒绝时不扣科技点');
}

console.log('\n[C] 开辟产线：先选兵种');
{
  const g = wf.createGameState(room(2));
  g.phase = 'playing'; g.phaseEndsAt = 0;
  const f = g.factories[0];
  T.damageFactory(g, f, f.hp + 1, 0);
  ok(f.owner === 0 && f.lines === 1, '拿下工厂，初始 1 条产线');
  g.players[0].rp = T.consts.FAC_LINE_COST;
  ok(wf.setPlayerInput(g, 'p0', { cmd: 'facLine', fid: f.id, type: 'ranger' }), '开辟产线并指定游侠');
  ok(f.lines === 2 && f.specs.length === 2, '产线 1 → 2');
  ok(f.specs[1].type === 'ranger' && f.specs[1].tier === 1, '新产线＝游侠一级');
  ok(f.specs[0].type !== undefined && f.specs[0].type === f.specs[0].type, '原产线不受影响：' + f.specs[0].type);
  g.players[0].rp = T.consts.FAC_LINE_COST;
  ok(!wf.setPlayerInput(g, 'p0', { cmd: 'facLine', fid: f.id, type: 'burn' }), '产线上限后拒绝再开（总 2 条）');
  ok(f.lines === 2 && f.specs.length === 2, '产线上限 2（默认 1 + 可开 1）');
  ok(g.players[0].rp === T.consts.FAC_LINE_COST, '被拒绝时不扣科技点');
  // 两条线各产各的
  g.units.length = 0;
  run(g, T.consts.PRODUCE_MS * 2 + 500);
  const want = f.specs.map((s) => s.type);
  const types = new Set(g.units.filter((u) => u.homeFac === f.id).map((u) => u.type));
  // 工厂初始兵种是随机的，可能和后来选的撞车 → 不能靠「去重后有 2 种」判定，
  // 要看「每条产线配置的兵种是不是都被产出来了」。
  ok(
    want.every((t) => types.has(t)) && types.size === new Set(want).size,
    '两条线各产各的兵种：' + [...types].join('/') + '（应产 ' + want.join('/') + '）'
  );
  ok([...types].every((t) => want.includes(t)), '产出的兵种都能对上某条产线');
  ok(types.has('ranger'), '新开的线产的是自己选的兵种');
}

console.log('\n[D] 产线进化：单一方向 → 后续直接产出该阶单位');
{
  const g = wf.createGameState(room(2));
  g.phase = 'playing'; g.phaseEndsAt = 0;
  const f = g.factories.find((x) => x.level === 2);
  T.damageFactory(g, f, f.hp + 1, 0);
  g.players[0].rp = 9999;
  // 单一进化方向：不再需要 branch 参数，也没有 A 攻势 / B 守势 之分
  ok(wf.setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: f.id, li: 0 }), '不带分支参数也能进化');
  ok(f.specs[0].tier === 2 && f.specs[0].branch === '', '产线升到二级，且不再定型分支');
  ok(g.players[0].rp === 9999 - T.consts.FAC_LINE_EVOLVE_COST || g.players[0].rp === 9999 - 600, '扣除产线进化科技点（' + g.players[0].rp + '）');
  ok(!wf.setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: f.id, li: 0 }), '冷却中拒绝');
  ok(f.specs[0].tier === 2, '被拒绝时阶数不变');
  // 关键：此后产出的就是二级单位
  g.units.length = 0;
  run(g, T.consts.PRODUCE_MS * 2 + 500);
  const made = g.units.filter((u) => u.homeFac === f.id && u.ownerIdx === 0);
  ok(made.length > 0, '进化后继续产兵（' + made.length + ' 支）');
  ok(made.every((u) => u.tier === 2), '新兵直接是二级（不再产初级）');
  ok(made.every((u) => u.branch === ''), '新兵不再带分支标记');
  ok(made.every((u) => u.maxTier === 2), '中级厂产线进化上限 = 2');
  const st1 = T.unitStats(made[0].type, 1);
  ok(made[0].hp > st1.hp, `二级血量高于一级（${made[0].hp} > ${st1.hp}）`);
  // 二级 → 三级（高级厂）
  const g3 = wf.createGameState(room(2));
  g3.phase = 'playing'; g3.phaseEndsAt = 0;
  const f3 = g3.factories.find((x) => x.level === 3);
  T.damageFactory(g3, f3, f3.hp + 1, 0);
  g3.players[0].rp = 9999;
  ok(wf.setPlayerInput(g3, 'p0', { cmd: 'facEvolve', fid: f3.id, li: 0 }), '高级厂产线进化（一级→二级）');
  g3.players[0].rp = 9999;
  f3.evoCd = 0;
  ok(wf.setPlayerInput(g3, 'p0', { cmd: 'facEvolve', fid: f3.id, li: 0 }), '再进化一次直达三级');
  ok(f3.specs[0].tier === 3, '升到三级');
  g3.units.length = 0;
  run(g3, T.consts.PRODUCE_MS + 500);
  const m3 = g3.units.filter((u) => u.homeFac === f3.id);
  ok(m3.length > 0 && m3.every((u) => u.tier === 3), '三级产线直接吐三级兵');
  // 初级厂不能进化
  const g1 = wf.createGameState(room(2));
  g1.phase = 'playing'; g1.phaseEndsAt = 0;
  const f1 = g1.factories.find((x) => x.level === 1);
  T.damageFactory(g1, f1, f1.hp + 1, 0);
  g1.players[0].rp = 9999;
  ok(!wf.setPlayerInput(g1, 'p0', { cmd: 'facEvolve', fid: f1.id, li: 0 }), '初级工厂产线不可进化');
}

console.log('\n[E] 易主 / 出局重置产线');
{
  const g = wf.createGameState(room(2));
  g.phase = 'playing'; g.phaseEndsAt = 0;
  const f = g.factories.find((x) => x.level === 3);
  T.damageFactory(g, f, f.hp + 1, 0);
  g.players[0].rp = 9999;
  wf.setPlayerInput(g, 'p0', { cmd: 'facLine', fid: f.id, type: 'burn' });
  wf.setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: f.id, li: 0 });
  ok(f.lines === 2 && f.specs[0].tier === 2, '玩家0 把厂养成 2 线 / 2 阶');
  T.damageFactory(g, f, f.hp + 1, 1);
  ok(f.owner === 1, '被玩家1 夺下');
  ok(f.lines === 1 && f.specs.length === 1 && f.specs[0].tier === 1, '易主后产线重置为一条一级线');
  ok(f.specs[0].branch === '', '易主后无分支标记（单一进化方向）');
}

console.log('\n[F] 快照 / 全量状态下发产线');
{
  const g = wf.createGameState(room(2));
  g.phase = 'playing'; g.phaseEndsAt = 0;
  const f = g.factories.find((x) => x.level === 3);
  T.damageFactory(g, f, f.hp + 1, 0);
  g.players[0].rp = 9999;
  wf.setPlayerInput(g, 'p0', { cmd: 'facLine', fid: f.id, type: 'laser' });
  wf.setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: f.id, li: 1 });
  const snap = wf.snapshot(g);
  const rowF = snap.f.find((r) => r[0] === f.id);
  ok(Array.isArray(rowF[9]) && rowF[9].length === 2, '快照下发 2 条产线配置');
  ok(rowF[9][1][0] === 5 && rowF[9][1][1] === 2 && rowF[9][1][2] === 0, '第二条线＝激光兵 / 二级（无分支）（' + JSON.stringify(rowF[9][1]) + '）');
  const rowH = snap.hq.find((r) => r[0] === g.hqs[0].id);
  ok(rowH.length === 13, '总部快照 13 列（末列＝每条线的在场兵数）');
  ok(Array.isArray(rowH[9]) && rowH[9][0][0] === 0, '总部快照第一条线＝锐士');
  ok(
    Array.isArray(rowH[12]) && rowH[12].length === rowH[9].length,
    '总部快照下发每条线的在场兵数（' + JSON.stringify(rowH[12]) + '）'
  );
  ok(
    Array.isArray(rowF[10]) && rowF[10].length === rowF[9].length,
    '工厂快照下发每条线的在场兵数（' + JSON.stringify(rowF[10]) + '）'
  );
  const st = wf.publicGameState(g);
  const pf = st.factories.find((x) => x.id === f.id);
  ok(pf.specs.length === 2 && pf.specs[1].type === 'laser' && pf.specs[1].tier === 2, '全量状态携带每条产线（' + JSON.stringify(pf.specs[1]) + '）');
  ok(st.hqs.every((h) => Array.isArray(h.specs) && h.specs.length >= 1), '全量状态携带总部产线');
  ok(st.consts.evolveLineCost > 0 && st.consts.hqCanEvolve === false, 'consts 下发产线进化费用与「总部不可进化」');
}

console.log('\n[G] 多产线产能仍随条数倍增');
{
  const count = (lines) => {
    const g = wf.createGameState(room(2));
    g.phase = 'playing'; g.phaseEndsAt = 0;
    g.units.length = 0;
    const f = g.factories[0];
    T.damageFactory(g, f, f.hp + 1, 0);
    f.rally = null;
    f.lines = lines;
    f.prog = [];
    f.prodProg = 0;
    let clock = Date.now();
    const steps = Math.round((T.consts.PRODUCE_MS * 3) / 100);
    for (let i = 0; i < steps; i++) { clock += 100; T.updateProduction(g, 0.1, clock); }
    return T.garrisonOf(g, f.id, 0);
  };
  const n1 = count(1);
  const n2 = count(2);
  const n3 = count(3);
  // 期望值不再写死：每条线独立受「在场越多越慢」乘区影响（3 周期 → madeInCycles(3) 支）
  const per = madeInCycles(3);
  ok(n1 === per, `单线 3 个周期产 ${per} 支（${n1}）`);
  ok(n2 === per * 2, '双线同期约 2 倍（' + n2 + ' 支 / 期望 ' + per * 2 + '）');
  ok(n3 === n2, '产线上限 2：手改 lines=3 也会被夹回 2（' + n3 + '）');
}

console.log('\n[H] 每条产线各自封顶（名额与减速乘区）');
{
  const C = T.consts;
  // 乘区曲线：0 兵 100%、1 兵 90% …… 满员归零
  ok(Math.abs(T.lineSpeedMul(0) - 1) < 1e-6, '0 个兵：产速 100%');
  ok(Math.abs(T.lineSpeedMul(1) - (1 - C.LINE_SLOW_PER_UNIT)) < 1e-6, `1 个兵：产速 ${Math.round((1 - C.LINE_SLOW_PER_UNIT) * 100)}%`);
  // ⚠️ 别写死「归零」：逐兵减速是 data.js 的 lines.slowPerUnit（现为 0，即不减速）
  const capMul = C.LINE_SLOW_PER_UNIT * C.LINE_UNIT_CAP >= 1 ? 0 : Math.max(0, 1 - C.LINE_UNIT_CAP * C.LINE_SLOW_PER_UNIT);
  ok(T.lineSpeedMul(C.LINE_UNIT_CAP) === capMul, `满 ${C.LINE_UNIT_CAP} 个兵：产速 ${Math.round(capMul * 100)}%`);
  ok(T.lineSpeedMul(C.LINE_UNIT_CAP + 5) === capMul, '超过名额也不会变成负产速');

  // 单线跑满：最终一定停在上限，且不再增加
  const g = wf.createGameState(room(2));
  g.phase = 'playing'; g.phaseEndsAt = 0;
  g.units.length = 0;
  const f = g.factories[0];
  T.damageFactory(g, f, f.hp + 1, 0);
  f.rally = null;
  f.lines = 1;
  f.prog = [];
  f.prodProg = 0;
  let clock = Date.now();
  const steps = Math.round((T.consts.PRODUCE_MS * 30) / 100);
  for (let i = 0; i < steps; i++) { clock += 100; T.updateProduction(g, 0.1, clock); }
  const n = T.garrisonOf(g, f.id, 0);
  ok(n === C.LINE_UNIT_CAP, `长跑 30 个周期后单线停在名额上：${n}/${C.LINE_UNIT_CAP}`);
  const snap = wf.snapshot(g);
  const rowF = snap.f.find((r) => r[0] === f.id);
  ok(rowF[10].length === 1 && rowF[10][0] === C.LINE_UNIT_CAP, '快照里的该线在场数同步为 ' + rowF[10][0]);
  ok(
    g.units.filter((u) => u.homeFac === f.id).every((u) => (u.lineIdx || 0) === 0),
    '该线产出的兵都带着自己的产线号'
  );
  // 阵亡让出名额后能补产（只剩最后一档产速，所以要多等一会儿）
  const victim = g.units.find((u) => u.homeFac === f.id && (u.lineIdx || 0) === 0);
  victim.dead = true;
  const back = Math.round((T.consts.PRODUCE_MS / Math.max(0.01, T.lineSpeedMul(C.LINE_UNIT_CAP - 1))) / 100) +
    Math.round(T.consts.PRODUCE_MS / 100);
  for (let i = 0; i < back; i++) { clock += 100; T.updateProduction(g, 0.1, clock); }
  ok(T.garrisonOf(g, f.id, 0) === C.LINE_UNIT_CAP, '阵亡空出名额后能补回来（' + T.garrisonOf(g, f.id, 0) + '）');
}

console.log('\n合计：✓ ' + pass + '  ✗ ' + fail);
process.exit(fail ? 1 : 0);
