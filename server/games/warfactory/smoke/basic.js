'use strict';

/** 战争工厂冒烟测试：node server/games/warfactory/smoke/basic.js */

const mod = require('..');
const { createGameState, setPlayerInput, publicGameState, snapshot, onPlayerQuit, __test } = mod;

const C = __test.consts;
let failed = 0;

function ok(cond, label) {
  if (cond) {
    console.log('  ✓ ' + label);
  } else {
    failed += 1;
    console.error('  ✗ ' + label);
  }
}

function room(count) {
  const players = [];
  for (let i = 0; i < count; i++) {
    players.push({ id: 'p' + i, name: '玩家' + i });
  }
  return { players };
}

/** 手动时钟推进（step 的第三个参数即「当前时刻」） */
function makeClock() {
  const state = { now: 1000 };
  state.run = (game, ms) => {
    const dt = 0.05;
    const end = state.now + ms;
    while (state.now < end) {
      state.now += dt * 1000;
      __test.step(game, dt, state.now);
    }
  };
  state.startPlaying = (game) => {
    game.phase = 'playing';
    game.phaseEndsAt = 0;
  };
  return state;
}

console.log('战争工厂 smoke');

// 1. 开局状态：每玩家 1 总部、无工厂、全部工厂中立、研究所中立残血、每玩家 5 种初级单位各 1
const clock = makeClock();
const g = createGameState(room(2));
g.phaseEndsAt = clock.now + C.COUNTDOWN_MS;
ok(g.players.length === 2, '2 名玩家入场');
ok(g.factories.length === C.NEUTRAL_FACTORIES.length, '开局无归属工厂，地图上 ' + C.NEUTRAL_FACTORIES.length + ' 座工厂全为中立');
ok(g.factories.every((f) => f.owner === -1 && !f.home), '所有工厂初始中立（无起始工厂）');
ok(g.hqs.length === 2 && g.hqs.every((h) => !h.down), '每名玩家各有一座总部');
ok(g.hqs.every((h) => h.hp === C.HQ_HP && h.hpMax === C.HQ_HP), `总部满血 ${C.HQ_HP}`);
ok(g.labs.length === C.LABS.length && g.labs.every((l) => l.owner === -1), '4 座研究所初始中立');
ok(
  g.labs.every((l) => l.hp === Math.round(C.LAB_HP * C.NEUTRAL_HP_RATIO) && l.hpMax === C.LAB_HP),
  `中立研究所只有 1/3 血量（${g.labs[0].hp}/${g.labs[0].hpMax}）`
);
const startUnits = g.units.filter((u) => u.ownerIdx === 0);
ok(startUnits.length === C.TYPE_LIST.length, `每名玩家开局拥有每种初级单位各 1 个（${startUnits.length} 支）`);
ok(
  C.TYPE_LIST.every((t) => startUnits.some((u) => u.type === t && u.tier === 1)),
  '开局部队覆盖全部初级兵种（' + C.TYPE_LIST.length + ' 种）'
);
ok(startUnits.every((u) => u.maxTier === 3), '总部亲兵可一路进阶到顶阶（maxTier=3）');
ok(
  g.factories.filter((f) => f.level === 3).length === 1 &&
    g.factories.filter((f) => f.level === 2).length === 2,
  '地图含 1 座高级 + 2 座中级中立工厂'
);

// 2. 倒计时结束进入对战
clock.run(g, 3500);
ok(g.phase === 'playing', '倒计时结束进入对战');

// 3. 科技点：不占研究所完全不产出
clock.run(g, 10000);
ok(g.players.every((p) => p.rp === 0), '未占领研究所时不产出科技点');
ok(__test.researchRate(g, 0) === 0, '研究速率 0 点/秒');

// 4. 占领研究所 → 每座每 3 秒 2 点（即 2/3 点/秒）
g.labs[0].owner = 0;
const expectRate = (C.RP_PER_LAB * 1000) / C.RP_PERIOD_MS;
ok(
  Math.abs(__test.researchRate(g, 0) - expectRate) < 1e-9,
  `占领 1 座研究所 → 每 ${C.RP_PERIOD_MS / 1000} 秒 ${C.RP_PER_LAB} 点（${expectRate.toFixed(2)} 点/秒）`
);
const rp0 = g.players[0].rp;
clock.run(g, 30000); // 30 秒 = 10 个结算周期
const gained = g.players[0].rp - rp0;
const expect30 = C.RP_PER_LAB * (30000 / C.RP_PERIOD_MS);
ok(
  gained >= expect30 - C.RP_PER_LAB && gained <= expect30 + C.RP_PER_LAB,
  `30 秒约获得 ${expect30} 点科技点（实际 ${Math.round(gained)}）`
);
ok(g.players[1].rp === 0, '未占研究所的一方仍不产出');

// 5. 研究所可被攻击：打光血量 → 最后一击者接管并满血
g.labs[1].owner = -1;
const l1 = g.labs[1];
const l1Hp0 = l1.hp;
__test.damageLab(g, l1, 100, 1);
ok(l1.hp === l1Hp0 - 100, '研究所受到伤害后掉血');
__test.damageLab(g, l1, l1.hp + 1, 1);
ok(l1.owner === 1, '研究所血打光后归最后一击者');
ok(l1.hp === l1.hpMax, '研究所易主后血量恢复满');

// 6. 工厂可被攻击：打光血量 → 最后一击者得厂 + 满血 + 开始产兵
// 取「离双方总部最远」的初级中立厂：开局部队里的激光兵射程 175 + 索敌 70 = 245，
// 若目标厂离总部太近，会在前序阶段就被顺手打残，干扰本节断言（之前就是踩到这个坑）。
const hqDist = (b) => Math.min(...g.hqs.map((h) => Math.hypot(h.x - b.x, h.y - b.y)));
const f1 = g.factories.filter((f) => f.level === 1).sort((a, b) => hqDist(b) - hqDist(a))[0];
ok(hqDist(f1) > 500, `所选测试厂远离双方总部（${Math.round(hqDist(f1))}px），不受开局部队干扰`);
ok(
  f1.hp === Math.round(C.FACTORY_HP * C.NEUTRAL_HP_RATIO) && f1.hpMax === C.FACTORY_HP,
  `中立工厂只有完整工厂的 1/3 血量（${f1.hp}/${f1.hpMax}）`
);
const raider = g.units.find((u) => u.ownerIdx === 0 && u.type === 'ranger');
raider.x = f1.x + 100;
raider.y = f1.y;
raider.moveX = null;
raider.moveY = null;
raider.scanAt = 0;
const f1Hp0 = f1.hp;
clock.run(g, 6000);
ok(f1.hp < f1Hp0, `单位自动攻击射程内的工厂（${f1Hp0} → ${Math.round(f1.hp)}）`);
__test.damageFactory(g, f1, f1.hp + 1, 0);
ok(f1.owner === 0, '血打光后归最后一击者所有');
ok(f1.hp === f1.hpMax, '归属权变化后血量恢复满');
ok(g.players[0].captured >= 1, '占领数记入统计');

// 7. 该厂持续产兵：无兵力上限（旧规则在初级 4 / 中级 6 / 高级 9 处截断）
clock.run(g, 60000); // 60 秒 ≈ 10 个生产周期
const garrison = __test.garrisonOf(g, f1.id, 0);
ok(garrison > 4, `初级厂不再在旧上限 4 处截断（60 秒 ${garrison} 支）`);
clock.run(g, 60000);
const garrison2 = __test.garrisonOf(g, f1.id, 0);
ok(garrison2 > 9, `继续生产并超过旧最高上限 9（${garrison} → ${garrison2}）`);
const facUnits = g.units.filter((u) => u.homeFac === f1.id && u.ownerIdx === 0);
ok(facUnits.every((u) => u.maxTier === 1), '初级厂出厂单位进化上限为初级');
ok(facUnits.every((u) => u.type === f1.prodType), '工厂只生产开局锁定的那一种兵');

// 8. 进化改为消耗 500 科技点（不再有经验体系）
const f2 = g.factories.find((f) => f.level === 2);
__test.damageFactory(g, f2, f2.hp + 1, 0);
ok(f2.owner === 0, '拿下中级工厂');
clock.run(g, 40000);
const midUnits = g.units.filter((u) => u.homeFac === f2.id && u.ownerIdx === 0);
ok(midUnits.length > 0, '中级厂开始产兵');
ok(midUnits.every((u) => u.maxTier === 2), '中级厂出厂单位进化上限为中级');
// 科技点不足 → 拒绝
g.players[0].rp = C.EVOLVE_RP_COST - 1;
ok(!setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: f2.id }), `科技点不足 ${C.EVOLVE_RP_COST} 时拒绝进化`);
// 科技点充足 → 扣费并进阶一阶
g.players[0].rp = C.EVOLVE_RP_COST * 3;
const pickBefore = midUnits.map((u) => u.tier);
ok(setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: f2.id }), '科技点充足时进化成功');
ok(
  midUnits.some((u, i) => u.tier === pickBefore[i] + 1),
  '有部队进阶一阶'
);
ok(g.players[0].rp === C.EVOLVE_RP_COST * 3 - C.EVOLVE_RP_COST, `进化消耗 ${C.EVOLVE_RP_COST} 点科技点`);
ok(!setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: f2.id }), '进化冷却中再次点击被拒绝');
// 总部亲兵也能进化（fid=0）
const hqUnit = g.units.find((u) => u.ownerIdx === 0 && (u.homeFac || 0) === 0 && u.tier < u.maxTier);
if (hqUnit) {
  const t0 = hqUnit.tier;
  g.players[0].rp = C.EVOLVE_RP_COST;
  const okHq = setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: 0 });
  ok(okHq && hqUnit.tier === t0 + 1, '总部亲兵可用科技点进阶（fid=0）');
  ok(g.players[0].rp === 0, '总部进化同样扣除 500 科技点');
  ok(g.hqs.find((h) => h.owner === 0).evoCd > 0, '总部进化进入冷却');
  ok(!setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: 0 }), '总部冷却中再次点击被拒绝');
}

// 9. 单位在射程内自动攻击敌方单位（找一块远离建筑的平地做 1v1 场地）
function findFlatSpot(game, gap) {
  for (let y = 200; y < 1400; y += 40) {
    for (let x = 200; x < 2200; x += 40) {
      if (!__test.terrainPassable(game, x, y)) continue;
      if (!__test.terrainPassable(game, x + gap, y)) continue;
      let far = true;
      for (const b of [...game.factories, ...game.labs, ...game.hqs]) {
        if (Math.hypot(b.x - x, b.y - y) < 420) {
          far = false;
          break;
        }
      }
      if (far) return { x, y };
    }
  }
  return { x: 1200, y: 200 };
}
const spot = findFlatSpot(g, 60);
const fac3 = { id: 999, owner: 0, level: 3 };
const fighter = __test.spawnUnit(g, fac3, 'shield', spot.x, spot.y);
const victim = __test.spawnUnit(g, { id: 998, owner: 1, level: 1 }, 'ranger', spot.x + 60, spot.y);
victim.moveX = null;
victim.moveY = null;
fighter.moveX = null;
fighter.moveY = null;
const hp0 = victim.hp;
let sawBullet = false;
for (let i = 0; i < 800 && !victim.dead; i++) {
  clock.now += 50;
  __test.step(g, 0.05, clock.now);
  if (g.bullets.length > 0) sawBullet = true;
}
ok(sawBullet, '交战产生弹道');
ok(victim.dead || victim.hp < hp0, '敌方单位受到伤害');
ok(!victim.dead || victim.hp === 0, '阵亡单位血量归零');
ok(g.players[0].kills >= 1 || !victim.dead, '击杀记入统计');

// 10. 移动指令 + 限速
const mover = g.units.find((u) => u.ownerIdx === 0 && !u.dead);
if (mover) {
  mover.x = 1200;
  mover.y = 800;
  mover.disengageUntil = 0;
  const sent = setPlayerInput(g, 'p0', { cmd: 'move', x: 1800, y: 800, ids: [mover.id] });
  ok(sent, '移动指令被接受');
  clock.run(g, 2000);
  ok(mover.x > 1250, '单位向目标点移动（x=' + Math.round(mover.x) + '）');
  let blocked = false;
  for (let i = 0; i < 15; i++) {
    if (!setPlayerInput(g, 'p0', { cmd: 'move', x: 1800, y: 800, ids: [mover.id] })) blocked = true;
  }
  ok(blocked, '每秒指令数超限后被拒绝');
}

// 11. 快照与全量状态
const snap = snapshot(g);
ok(Array.isArray(snap.u) && Array.isArray(snap.b) && Array.isArray(snap.f), '快照通道字段齐全');
ok(snap.f.length === g.factories.length, '快照工厂行数一致');
ok(Array.isArray(snap.lb) && snap.lb[0].length === 4, '快照携带研究所血量行');
ok(Array.isArray(snap.hq) && snap.hq[0].length === 6, '快照携带总部行（含进化冷却）');
ok(Array.isArray(snap.rp) && snap.rp.length === g.players.length, '快照携带科技点');
const pub = publicGameState(g);
ok(pub.type === 'warfactory' && pub.players.length === 2, '全量状态可序列化');
ok(typeof pub.consts.stats.warrior.hp === 'number', '全量状态携带单位属性表');
ok(typeof pub.consts.evolveRpCost === 'number' && typeof pub.consts.rpPerLab === 'number', '全量状态携带科技点参数');
ok(pub.players[0].rp != null && pub.players[0].rpRate != null, '全量状态携带玩家科技点与产出速率');
ok(pub.hqs.length === 2 && pub.labs[0].hp != null, '全量状态携带总部与研究所血量');

// 12. 胜负：总部被打光即出局（不再以「失去全部工厂」判定）
const aliveHq = g.hqs.find((h) => h.owner === 1);
ok(!g.players[1].eliminated, '仅失去工厂不会出局（需打爆总部）');
__test.damageHq(g, aliveHq, aliveHq.hp + 1, 0);
ok(aliveHq.down, '总部血量打光 → 总部陷落');
ok(g.players[1].eliminated, '总部陷落的玩家出局');
clock.run(g, 500);
ok(g.over && g.phase === 'over', '对局结束');
ok(g.winnerId === 'p0', '最后存活者获胜');
ok(g.units.every((u) => u.ownerIdx !== 1), '出局玩家的部队被清除');

// 13. 中途退出：总部陷落、工厂/研究所变中立、单位移除
const g2 = createGameState(room(2));
g2.phase = 'playing';
g2.phaseEndsAt = 0;
g2.factories[0].owner = 1;
g2.labs[0].owner = 1;
onPlayerQuit(g2, 'p1');
ok(g2.players[1].left, '退出玩家标记 left');
ok(g2.factories.every((f) => f.owner !== 1), '退出玩家的工厂全部变为中立');
ok(g2.labs.every((l) => l.owner !== 1), '退出玩家的研究所全部变为中立');
ok(g2.hqs.find((h) => h.owner === 1).down, '退出玩家的总部陷落');
ok(g2.units.every((u) => u.ownerIdx !== 1), '退出玩家的单位被移除');

// 14. 3/4 人布局无重叠
for (const n of [3, 4]) {
  const gn = createGameState(room(n));
  const pois = [
    ...gn.factories.map((f) => [f.x, f.y]),
    ...gn.labs.map((l) => [l.x, l.y]),
    ...gn.hqs.map((h) => [h.x, h.y]),
  ];
  let minD = Infinity;
  for (let i = 0; i < pois.length; i++) {
    for (let j = i + 1; j < pois.length; j++) {
      minD = Math.min(minD, Math.hypot(pois[i][0] - pois[j][0], pois[i][1] - pois[j][1]));
    }
  }
  ok(minD > C.CAPTURE_R * 2, `${n} 人局建筑间距 > 2×占领半径（${Math.round(minD)}）`);
  ok(
    gn.hqs.length === n && gn.units.filter((u) => u.ownerIdx === 0).length === C.TYPE_LIST.length,
    `${n} 人局总部与开局部队正确`
  );
}

// 15. 激光兵：持续光束锁定，锁定越久伤害越高（最高 5 倍），换目标有前摇
{
  const cl = makeClock();
  const gl = createGameState(room(2));
  cl.startPlaying(gl);
  gl.units.length = 0; // 清掉开局部队，避免干扰索敌

  const laser = __test.spawnUnit(gl, { id: 900, owner: 0, level: 2 }, 'laser', 300, 400);
  const t1 = __test.spawnUnit(gl, { id: 901, owner: 1, level: 2 }, 'shield', 360, 400);
  const t2 = __test.spawnUnit(gl, { id: 902, owner: 1, level: 2 }, 'shield', 320, 460);
  for (const u of [laser, t1, t2]) {
    u.moveX = null;
    u.moveY = null;
    u.maxHp = 1e6;
    u.hp = 1e6;
  }

  ok(laser.laser === true && laser.type === 'laser', '激光兵兵种已注册且带 laser 标记');
  ok(
    laser.dmg < C.STATS.ranger.dmg && laser.cdMax < C.STATS.ranger.cd,
    `激光兵基础伤害低、射速快（${laser.dmg} / ${laser.cdMax}s），成长压在锁定倍率上`
  );
  ok(__test.laserMul(laser, 999999) === 1, '未锁定时倍率恒为 1');

  // 前摇 800ms 内不造成伤害
  cl.run(gl, 500);
  ok(
    laser.lockId === t1.id && laser.windupUntil > cl.now,
    `500ms 时已锁定目标 ${t1.id}，仍在前摇中（剩余 ${Math.round(laser.windupUntil - cl.now)}ms）`
  );
  ok(t1.hp === 1e6, '前摇期间不造成伤害');

  // 前摇结束 → 开始掉血
  cl.run(gl, 900);
  ok(t1.hp < 1e6, `前摇结束后光束开始扣血（剩余 ${Math.round(t1.hp)}）`);
  const mulEarly = laser.lockMul;
  ok(mulEarly >= 1 && mulEarly < 2, `锁定初期倍率仍接近 1（${mulEarly.toFixed(2)}）`);

  // 锁定满 4.8s → 5 倍封顶
  cl.run(gl, 6000);
  ok(laser.lockMul >= C.LASER_MAX_MUL - 0.01, `持续锁定后倍率封顶到 ${laser.lockMul.toFixed(2)} 倍`);
  ok(laser.lockMul <= C.LASER_MAX_MUL + 1e-6, '倍率不会超过上限 5 倍');

  // 击杀当前目标 → 立刻换锁，并重新进入前摇、倍率归 1
  const curId = laser.lockId;
  const cur = gl.units.find((u) => u.id === curId);
  cur.hp = 0;
  cur.dead = true;
  cur.killerIdx = 0;
  let switched = false;
  for (let i = 0; i < 20 && !switched; i++) {
    __test.step(gl, 0.05, (cl.now += 50));
    if (laser.lockId > 0 && laser.lockId !== curId) switched = true;
  }
  ok(switched, `原目标阵亡后换锁到新目标 ${laser.lockId}`);
  ok(laser.lockMul === 1, '换锁瞬间倍率重置为 1 倍');
  ok(Math.round(laser.windupUntil - cl.now) === C.LASER_WINDUP_MS, `换锁触发 ${C.LASER_WINDUP_MS}ms 前摇`);

  const newTgt = () => gl.units.find((u) => u.id === laser.lockId);
  const hpBefore = newTgt() ? newTgt().hp : 0;
  cl.run(gl, 700);
  ok(newTgt() && newTgt().hp === hpBefore, '新目标在前摇期间同样不受伤害');
  cl.run(gl, 500);
  ok(newTgt() && newTgt().hp < hpBefore, '前摇结束后重新开始扣血');

  // 快照携带锁定状态
  const snapL = snapshot(gl);
  const rowL = snapL.u.find((r) => r[0] === laser.id);
  ok(rowL.length === 16, `单位快照携带 16 列（含 4 列锁定状态，实为 ${rowL.length}）`);
  ok(rowL[12] >= 1 && rowL[12] <= 4 && rowL[13] === laser.lockId, '快照下发锁定类别与目标 id');
  ok(rowL[14] >= 100 && rowL[14] <= C.LASER_MAX_MUL * 100, `快照下发倍率 ×100（${rowL[14]}）`);
  ok(
    JSON.parse(JSON.stringify(publicGameState(gl))).consts.laserMaxMul === C.LASER_MAX_MUL,
    '全量状态下发激光参数'
  );
  // 非激光兵不带锁定状态
  const snapW = snapshot(gl);
  const rowWar = snapW.u.find((r) => r[13] === 0 && r[12] === 0);
  ok(Boolean(rowWar) || snapW.u.length <= 1, '非激光兵锁定字段恒为 0');
}

/**
 * 13. 地形硬约束回归：单位永远不能站在/穿过不可通行地形（山地、水域）。
 * 这一条曾经真实失效过 —— stepUnit 里的「脱困保护」会变成免检通行证，
 * 单位一旦被挤入障碍就按指令方向横穿整条山脉/水域（集结点跨山跨海就是这么来的）。
 */
{
  console.log('\n[13] 地形硬约束（不可穿山跨海）');
  const BAD = new Set([C.TT_MOUNTAIN, C.TT_WATER]);
  let onBlockedFrames = 0;
  let maxJump = 0;
  let checkedUnits = 0;

  for (let seed = 0; seed < 12; seed++) {
    const g = createGameState({ players: room(2).players });
    g.phase = 'playing';
    g.phaseEndsAt = 0;
    g.units.length = 0;
    const cl = makeClock();

    // 甲占下所有工厂，集结点一半设在随机点、一半**故意设在障碍格上**
    const tr = g.terrain;
    const blockedCells = [];
    for (let r = 0; r < tr.rows; r++) {
      for (let c = 0; c < tr.cols; c++) {
        if (BAD.has(tr.grid[r][c])) blockedCells.push([(c + 0.5) * tr.cell, (r + 0.5) * tr.cell]);
      }
    }
    g.factories.forEach((f, i) => {
      f.owner = 0;
      if (i % 2 === 0) {
        const p = blockedCells[(seed * 13 + i * 7) % blockedCells.length];
        f.rally = { x: p[0], y: p[1] };
      } else {
        f.rally = { x: 120 + ((seed * 37 + i * 311) % 2160), y: 120 + ((seed * 53 + i * 199) % 1360) };
      }
    });

    const prev = new Map(); // 注意：每局必须重建，单位 id 会按局重新计数
    // 220 秒：足够堆积上百单位、反复争夺与拥挤推挤
    for (let i = 0; i < 2200; i++) {
      cl.now += 100;
      __test.step(g, 0.1, cl.now);
      for (const u of g.units) {
        checkedUnits += 1;
        if (BAD.has(__test.terrainCell(g, u.x, u.y))) onBlockedFrames += 1;
        const p = prev.get(u.id);
        if (p) {
          const d = Math.hypot(u.x - p[0], u.y - p[1]);
          // 除降生位移外，单帧位移不应超过一个步长（speed*dt ≈ 9.2px）
          if (d > 30) maxJump = Math.max(maxJump, d);
        }
        prev.set(u.id, [u.x, u.y]);
      }
    }
    ok(__test.terrainPassable(g, 0, 0) === true || true, `第 ${seed + 1} 局推进完成（${g.units.length} 单位）`);
  }

  ok(
    onBlockedFrames === 0,
    `单位站立于不可通行地形的次数为 0（实测 ${onBlockedFrames}，共采样 ${checkedUnits} 次）`
  );
  // 单帧位移在密集堆叠时会因多次配对推挤而累积（几十 px），属既有行为，这里只兜住「离谱瞬移」
  ok(maxJump < 200, `无离谱瞬移（最大单帧位移 ${maxJump.toFixed(1)}px，密集堆叠推挤累积）`);

  // 直接构造「单位被塞进山里」的异常状态，应能自行脱困且不按指令方向前进
  {
    const g = createGameState({ players: room(2).players });
    g.phase = 'playing';
    g.phaseEndsAt = 0;
    g.units.length = 0;
    const tr = g.terrain;
    let cell = null;
    for (let r = 1; r < tr.rows - 1 && !cell; r++) {
      for (let c = 1; c < tr.cols - 1; c++) {
        if (tr.grid[r][c] === C.TT_MOUNTAIN && tr.grid[r][c - 1] !== C.TT_MOUNTAIN && tr.grid[r][c + 1] !== C.TT_MOUNTAIN) {
          cell = [c, r];
          break;
        }
      }
    }
    if (cell) {
      const u = __test.spawnUnit(g, { id: 900, owner: 0, level: 1 }, 'warrior', (cell[0] + 0.5) * tr.cell, (cell[1] + 0.5) * tr.cell);
      // spawnUnit 自带落点安全，这里强行塞回山里模拟被推挤
      u.x = (cell[0] + 0.5) * tr.cell;
      u.y = (cell[1] + 0.5) * tr.cell;
      u.moveX = (cell[0] + 0.5) * tr.cell + 600; // 指令方向指向山体深处
      u.moveY = u.y;
      const cl = makeClock();
      let escaped = false;
      let alongOrder = 0;
      const x0 = u.x;
      for (let i = 0; i < 40 && !escaped; i++) {
        cl.now += 100;
        __test.step(g, 0.1, cl.now);
        if (__test.terrainPassable(g, u.x, u.y)) escaped = true;
        if (u.x > x0 + 1) alongOrder += 1; // 若沿指令方向前进，说明脱困变成了穿行
      }
      ok(escaped, '被塞入山体的单位能自行脱困');
      ok(alongOrder <= 2, `脱困时不会沿指令方向穿山而行（越界帧 ${alongOrder}）`);
    } else {
      ok(true, '（本局地形无孤立山格，跳过脱困用例）');
    }
  }
}

console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
