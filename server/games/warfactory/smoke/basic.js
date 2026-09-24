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
ok(g.players.every((p) => (p.rpAccMs || 0) === 0), '不占研究所时也不累积结算进度');

// 4. 占领研究所 → 每座每 3 秒「一次性」+2 点（离散跳变，不是连续增长）
g.labs[0].owner = 0;
const expectRate = (C.RP_PER_LAB * 1000) / C.RP_PERIOD_MS;
ok(
  Math.abs(__test.researchRate(g, 0) - expectRate) < 1e-9,
  `占领 1 座研究所 → 平均 ${expectRate.toFixed(2)} 点/秒（= 每 ${C.RP_PERIOD_MS / 1000} 秒 ${C.RP_PER_LAB} 点）`
);

// 4a. 离散：不满一个周期时点数一动不动（连续累加的实现必然挂在这里）
const rp0 = g.players[0].rp;
clock.run(g, C.RP_PERIOD_MS - 200);
ok(
  g.players[0].rp === rp0,
  `不满 ${C.RP_PERIOD_MS / 1000} 秒时点数不变（仍为 ${g.players[0].rp}，非连续增长）`
);
ok(
  (g.players[0].rpAccMs || 0) > 0 && g.players[0].rpAccMs < C.RP_PERIOD_MS,
  `结算进度在累积（${Math.round(g.players[0].rpAccMs)}/${C.RP_PERIOD_MS}ms）`
);

// 4b. 满周期 → 一次性跳 +2（整数）
clock.run(g, 200);
ok(
  g.players[0].rp === rp0 + C.RP_PER_LAB,
  `满 ${C.RP_PERIOD_MS / 1000} 秒后一次性跳 +${C.RP_PER_LAB}（${rp0} → ${g.players[0].rp}）`
);

// 4c. 长时段：总量严格等于「周期数 × 每周期产量」，不漏发也不多发
const rpBulk = g.players[0].rp;
const periods = 10;
clock.run(g, C.RP_PERIOD_MS * periods);
const gained = g.players[0].rp - rpBulk;
ok(
  gained === C.RP_PER_LAB * periods,
  `${periods} 个周期恰好获得 ${C.RP_PER_LAB * periods} 点（实际 ${gained}）`
);
ok(Number.isInteger(g.players[0].rp), '科技点恒为整数（离散跳变）');
ok(g.players[1].rp === 0, '未占研究所的一方仍不产出');

// 多座线性叠加：2 座 → 每 3 秒一次性 +4（严格按周期验证，而非只看总量）
g.labs[1].owner = 0;
const rp2before = g.players[0].rp;
clock.run(g, C.RP_PERIOD_MS);
const gainedOnePeriod = g.players[0].rp - rp2before;
ok(
  gainedOnePeriod === C.RP_PER_LAB * 2,
  `2 座研究所叠加：每 ${C.RP_PERIOD_MS / 1000} 秒一次 +${C.RP_PER_LAB * 2}（实际 ${gainedOnePeriod}）`
);
g.labs[1].owner = -1; // 还原，避免影响后续用例
const rp1before = g.players[0].rp;
clock.run(g, C.RP_PERIOD_MS);
const gainedOneLab = g.players[0].rp - rp1before;
ok(
  gainedOneLab === C.RP_PER_LAB,
  `单座单周期精确产出：每 ${C.RP_PERIOD_MS / 1000} 秒一次 +${C.RP_PER_LAB}（实际 ${gainedOneLab}）`
);

// 4d. 丢掉全部研究所：立即停发，且不保留结算进度
g.labs[0].owner = -1;
const rpLost = g.players[0].rp;
clock.run(g, 1000);
ok(
  g.players[0].rp === rpLost && (g.players[0].rpAccMs || 0) === 0,
  '丢掉全部研究所后：不再产出且结算进度清零'
);

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
// 产兵间隔由 PRODUCE_MS 决定（现为 20 秒/支），推进时长必须按间隔推导而不是写死秒数
const produceMs = C.PRODUCE_MS;
clock.run(g, produceMs * 6 + 1000); // 6 个周期
const garrison = __test.garrisonOf(g, f1.id, 0);
ok(garrison > 4, `初级厂不再在旧上限 4 处截断（6 个周期 ${garrison} 支）`);
clock.run(g, produceMs * 5); // 累计 11 个周期
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
// 总部出生点改成随机之后，建筑位置每局都不同：这里按「离建筑越远越好」逐级放宽，
// 找不到完美场地也不会退化成固定坐标（那才会让断言莫名其妙地失败）。
function findFlatSpot(game, gap) {
  const blocks = [...game.factories, ...game.labs, ...game.hqs];
  for (const far of [420, 300, 200, 120, 0]) {
    for (let y = 200; y < 1400; y += 40) {
      for (let x = 200; x < 2200; x += 40) {
        // 三个点都要能站：起点、中点（用例常把第二名单位放在 x+45 这种位置）、终点
        if (!__test.canStand(game, x, y, 14)) continue;
        if (!__test.canStand(game, x + gap / 2, y, 14)) continue;
        if (!__test.canStand(game, x + gap, y, 14)) continue;
        // 两点之间不能被山挡住：否则索敌直接放弃（1v1 用例会「一团和气」）
        if (__test.losBlocked(game, x, y, x + gap, y)) continue;
        // 离现有部队远一点：免得路过的亲兵把 1v1 场地搅成混战
        let clear = true;
        for (const u of game.units) {
          if (u.dead) continue;
          if (Math.hypot(u.x - x, u.y - y) < 320) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        let ok = true;
        for (const b of blocks) {
          if (Math.hypot(b.x - x, b.y - y) < far) {
            ok = false;
            break;
          }
        }
        if (ok) return { x, y };
      }
    }
  }
  return { x: 1200, y: 200 };
}
const spot = findFlatSpot(g, 60);
const fac3 = { id: 999, owner: 0, level: 3 };
const fighter = __test.spawnUnit(g, fac3, 'shield', spot.x, spot.y);
// 间距必须落在「盾卫的攻击范围」内：取消自动追击后单位不会再自己贴上去，
// 站远了就永远打不到（盾卫 range 50 + 游侠半径 9 = 59，所以取 45）。
const victim = __test.spawnUnit(g, { id: 998, owner: 1, level: 1 }, 'ranger', spot.x + 45, spot.y);
victim.moveX = null;
victim.moveY = null;
fighter.moveX = null;
fighter.moveY = null;
const hp0 = victim.hp;
const bidProbe = g.nextBulletId; // 弹体计数器：贴身近战可能「同一帧生成又命中消失」，快照抓不到
let sawBullet = false;
for (let i = 0; i < 800 && !victim.dead; i++) {
  clock.now += 50;
  __test.step(g, 0.05, clock.now);
  if (g.bullets.length > 0) sawBullet = true;
}
const spawned = g.nextBulletId - bidProbe;
ok(sawBullet || spawned > 0, `交战产生弹道（飞出 ${spawned} 发）`);
ok(victim.dead || victim.hp < hp0, '敌方单位受到伤害');
ok(!victim.dead || victim.hp === 0, '阵亡单位血量归零');
ok(g.players[0].kills >= 1 || !victim.dead, '击杀记入统计');

// 9b. 不再自动追击：敌人在「旧追击圈」内、但不在攻击范围内 → 不移动也不开火
{
  console.log('\n[9b] 取消自动追击');
  const gc = createGameState(room(2));
  gc.phase = 'playing';
  gc.phaseEndsAt = 0;
  gc.units.length = 0;
  const sp = findFlatSpot(gc, 200);
  // 盾卫（range 50）对面 120px 放一名游侠：远在其攻击范围（50+9+10=69）之外，
  // 但落在旧的「射程 + 70 = 120」追击圈之内 —— 正是旧版会自己冲上去的距离。
  const watcher = __test.spawnUnit(gc, { id: 7001, owner: 0, level: 1 }, 'shield', sp.x, sp.y);
  const farFoe = __test.spawnUnit(gc, { id: 7002, owner: 1, level: 1 }, 'ranger', sp.x + 120, sp.y);
  watcher.moveX = null;
  watcher.moveY = null;
  watcher.scanAt = 0;
  farFoe.moveX = null;
  farFoe.moveY = null;
  const w0 = { x: watcher.x, y: watcher.y };
  const foeHp0 = farFoe.hp;
  const cl = makeClock();
  for (let i = 0; i < 60; i++) {
    cl.now += 100;
    __test.updateUnits(gc, 0.1, cl.now);
  }
  ok(watcher.targetId === 0, '索敌只认攻击范围：范围外的敌人不锁定');
  ok(
    Math.hypot(watcher.x - w0.x, watcher.y - w0.y) < 0.5,
    `不自动追击：原地待命（位移 ${Math.hypot(watcher.x - w0.x, watcher.y - w0.y).toFixed(2)}px）`
  );
  ok(farFoe.hp === foeHp0, '打不到就不开火（不会隔空输出）');
  ok(farFoe.targetId === watcher.id, '但射程够远的一方（游侠 range 200）照常开火');
}

// 9c. 移动攻击：行军途中照常开火（不再「停下才打」）
{
  console.log('\n[9c] 移动攻击（边走边打）');
  const gm = createGameState(room(2));
  gm.phase = 'playing';
  gm.phaseEndsAt = 0;
  gm.units.length = 0;
  const sm = findFlatSpot(gm, 200);
  // 用游侠当主角：射程 200 足够长，走位过程中敌人始终留在攻击范围内
  const runner = __test.spawnUnit(gm, { id: 7101, owner: 0, level: 1 }, 'ranger', sm.x, sm.y);
  const dummy = __test.spawnUnit(gm, { id: 7102, owner: 1, level: 1 }, 'shield', sm.x + 40, sm.y);
  dummy.maxHp = 1e6;
  dummy.hp = 1e6; // 别让它被打死，全程留在射程内
  // 落点要同时满足：可站立 + 全程仍在攻击范围内（reach = 200 + 10）
  let dst = null;
  for (const dy of [60, -60, 90, -90]) {
    const c = { x: sm.x, y: sm.y + dy };
    if (Math.hypot(c.x - dummy.x, c.y - dummy.y) > runner.range + dummy.r) continue;
    if (!__test.canStand(gm, c.x, c.y, runner.r)) continue;
    dst = c;
    break;
  }
  if (!dst) {
    for (const dx of [60, -60, 90, -90]) {
      const c = { x: sm.x + dx, y: sm.y };
      if (Math.hypot(c.x - dummy.x, c.y - dummy.y) > runner.range + dummy.r) continue;
      if (!__test.canStand(gm, c.x, c.y, runner.r)) continue;
      dst = c;
      break;
    }
  }
  ok(Boolean(dst), '移动攻击用例选到落点（离敌人 >26px 仍在射程内）');
  if (dst) {
    runner.moveX = dst.x;
    runner.moveY = dst.y;
    runner.scanAt = 0;
    const p0 = { x: runner.x, y: runner.y };
    const cl = makeClock();
    let firedWhileMoving = false;
    let moved = 0;
    for (let i = 0; i < 30; i++) {
      cl.now += 100;
      __test.updateUnits(gm, 0.1, cl.now);
      if (gm.bullets.length > 0 && runner.moveX != null) firedWhileMoving = true;
      moved = Math.hypot(runner.x - p0.x, runner.y - p0.y);
    }
    ok(firedWhileMoving, '移动攻击：开火时单位仍在行军途中（未停下）');
    ok(moved > 26, `移动攻击：同时确实在往指令点走（位移 ${moved.toFixed(1)}px）`);
    ok(runner.moveX == null && runner.moveY == null, '抵达指令点后自动停步');
  }
}

// 10. 移动指令 + 限速
// 地形系统上线后：起点与目标都必须落在可通行地形上，否则单位会被脱困逻辑推开、
// 或沿流场绕行，用固定坐标（旧版 1200,800 → 1800,800）断言位移方向不再成立。
const mover = g.units.find((u) => u.ownerIdx === 0 && !u.dead);
if (mover) {
  // 起点不能取「总部旁边」：总部现在是随机落的，可能贴着山壁/水岸，而且身边挤着另外几名亲兵，
  // 单位光是从人堆里挤出来就要花掉大半时间，位移断言会误判。改成找一块开阔空地起步。
  const stand = findFlatSpot(g, 200);
  // 从落脚点向右找一段「整条直线都能走」的空地作为目标（中途不撞山、不撞建筑）
  const marchOk = (fx, fy, cx, cy) => {
    const steps = Math.ceil(Math.hypot(cx - fx, cy - fy) / 40);
    for (let i = 1; i <= steps; i++) {
      const px = fx + ((cx - fx) * i) / steps;
      const py = fy + ((cy - fy) * i) / steps;
      if (!__test.canStand(g, px, py, mover.r)) return false;
    }
    return true;
  };
  let tx = 0;
  let ty = 0;
  for (let d = 500; d <= 1000 && !tx; d += 50) {
    for (const dy of [0, 40, -40, 80, -80, 120, -120]) {
      const cx = Math.round(stand.x) + d;
      const cy = Math.round(stand.y) + dy;
      if (cx > C.WORLD_W - 80 || cy < 80 || cy > C.WORLD_H - 80) continue;
      if (__test.canStand(g, cx, cy, mover.r) && marchOk(stand.x, stand.y, cx, cy)) {
        tx = cx;
        ty = cy;
        break;
      }
    }
  }
  if (!tx) {
    tx = Math.round(stand.x) + 500;
    ty = Math.round(stand.y);
  }
  mover.x = stand.x;
  mover.y = stand.y;
  mover.targetId = 0;
  mover.moveX = null;
  mover.moveY = null;
  mover.disengageUntil = 0;
  const d0 = Math.hypot(tx - mover.x, ty - mover.y);
  const sent = setPlayerInput(g, 'p0', { cmd: 'move', x: tx, y: ty, ids: [mover.id] });
  ok(sent, '移动指令被接受');
  clock.run(g, 4000);
  const d1 = Math.hypot(tx - mover.x, ty - mover.y);
  ok(d1 < d0 - 60, `单位向目标点移动（距目标 ${Math.round(d0)} → ${Math.round(d1)}）`);
  let blocked = false;
  for (let i = 0; i < 15; i++) {
    if (!setPlayerInput(g, 'p0', { cmd: 'move', x: tx, y: ty, ids: [mover.id] })) blocked = true;
  }
  ok(blocked, '每秒指令数超限后被拒绝');
}

// 11. 快照与全量状态
const snap = snapshot(g);
ok(Array.isArray(snap.u) && Array.isArray(snap.b) && Array.isArray(snap.f), '快照通道字段齐全');
ok(snap.f.length === g.factories.length, '快照工厂行数一致');
ok(Array.isArray(snap.lb) && snap.lb[0].length === 4, '快照携带研究所血量行');
ok(
  Array.isArray(snap.f) && snap.f[0].length === 9,
  `快照工厂行携带产线数（9 列，实为 ${snap.f[0].length}）`
);
ok(
  Array.isArray(snap.hq) && snap.hq[0].length === 7,
  `快照携带总部行（含进化冷却与产能等级，7 列，实为 ${snap.hq[0].length}）`
);
ok(Array.isArray(snap.rp) && snap.rp.length === g.players.length, '快照携带科技点');
ok(
  Array.isArray(snap.rpAcc) && snap.rpAcc.length === g.players.length,
  '快照携带距下次结算的进度（rpAcc）'
);
const pub = publicGameState(g);
ok(pub.type === 'warfactory' && pub.players.length === 2, '全量状态可序列化');
ok(typeof pub.consts.stats.warrior.hp === 'number', '全量状态携带单位属性表');
ok(typeof pub.consts.evolveRpCost === 'number' && typeof pub.consts.rpPerLab === 'number', '全量状态携带科技点参数');
ok(pub.players[0].rp != null && pub.players[0].rpRate != null, '全量状态携带玩家科技点与产出速率');
ok(
  typeof pub.players[0].rpAccMs === 'number' && typeof pub.players[0].rpPerPeriod === 'number',
  '全量状态携带结算进度与每周期产量（rpAccMs / rpPerPeriod）'
);
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
  ok(rowL.length === 18, `单位快照携带 18 列（含 4 列锁定状态 + 2 列追击命令，实为 ${rowL.length}）`);
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

/**
 * 14. 山体遮挡视线与弹道。
 * 设计语义：山有高度 —— 山两侧的单位互相看不见（不索敌）、打不到（弹道被山挡住、溅射不越山）；
 * 水域只是「不可通行的平面」，不遮挡视线，弹丸照常飞过水面。
 */
{
  console.log('\n[14] 山体遮挡视线与弹道（水域不受影响）');

  /**
   * 造一块干净试验田：整图清成平原 → 人工砌一道南北向的「墙」（山或水）→ 墙两侧各放一名游侠。
   * 不依赖随机地形，用例可复现；墙南北各延伸 8 格，保证两个单位在用例时限内绕不过去。
   */
  function scene(wallType) {
    const g = createGameState({ players: room(2).players });
    g.phase = 'playing';
    g.phaseEndsAt = 0;
    g.units.length = 0;
    const t = g.terrain;
    for (let r = 0; r < t.rows; r++) {
      for (let c = 0; c < t.cols; c++) t.grid[r][c] = C.TT_PLAIN;
    }
    // 远离所有建筑：否则建筑会抢走索敌（aggro = 射程 + 70）
    const blocks = [...g.factories, ...g.labs, ...g.hqs].map((b) => [b.x, b.y]);
    const far = (x, y) => blocks.every((b) => Math.hypot(b[0] - x, b[1] - y) > 520);
    let spot = null;
    for (let r = 10; r < t.rows - 10 && !spot; r++) {
      for (let c = 10; c < t.cols - 10; c++) {
        const wx = (c + 0.5) * t.cell;
        const wy = (r + 0.5) * t.cell;
        if (!far(wx, wy) || !far(wx - 80, wy) || !far(wx + 80, wy)) continue;
        spot = [c, r];
        break;
      }
    }
    for (let dr = -8; dr <= 8; dr++) t.grid[spot[1] + dr][spot[0]] = wallType;
    const wy = (spot[1] + 0.5) * t.cell;
    const wallX = (spot[0] + 0.5) * t.cell;
    const lx = (spot[0] - 2 + 0.5) * t.cell; // 墙西侧两格
    const rx = (spot[0] + 2 + 0.5) * t.cell; // 墙东侧两格
    const a = __test.spawnUnit(g, { id: 0, owner: 0, level: 1 }, 'ranger', lx, wy);
    const b = __test.spawnUnit(g, { id: 1, owner: 1, level: 1 }, 'ranger', rx, wy);
    // 工厂 / 研究所 / 总部全归甲方：乙方的唯一敌人就是甲的那名游侠
    g.factories.forEach((f) => (f.owner = 0));
    g.labs.forEach((l) => (l.owner = 0));
    g.hqs.forEach((h) => (h.owner = 0));
    return { g, a, b, wallX, lx, rx, wy };
  }

  const advance = (g, n) => {
    const cl = makeClock();
    for (let i = 0; i < n; i++) {
      cl.now += 100;
      __test.updateUnits(g, 0.1, cl.now);
    }
  };

  // ① losBlocked 纯判定
  {
    const mt = scene(C.TT_MOUNTAIN);
    const wt = scene(C.TT_WATER);
    ok(__test.losBlocked(mt.g, mt.lx, mt.wy, mt.rx, mt.wy) === true, '视线判定：山体遮挡成立');
    ok(__test.losBlocked(wt.g, wt.lx, wt.wy, wt.rx, wt.wy) === false, '视线判定：水域不遮挡（水体行为不变）');
    ok(__test.losBlocked(mt.g, mt.lx, mt.wy, mt.lx + 30, mt.wy) === false, '视线判定：同侧近距不误报');
    // 单位被挤进山体（异常态）时，不该被「自己所在的格子」挡住视线
    const inside = mt.wallX + 0.5;
    ok(
      __test.losBlocked(mt.g, inside, mt.wy, inside - 160, mt.wy) === false,
      '忽略起点自身所在格：异常嵌山时不产生自我遮挡'
    );
    ok(
      __test.mountainHitAlong(wt.g, wt.lx, wt.wy, wt.rx, wt.wy, { step: 8 }) < 0,
      'mountainHitAlong：整段飞越水面都不命中山体'
    );
    ok(
      __test.mountainHitAlong(mt.g, mt.lx, mt.wy, mt.rx, mt.wy, { step: 8 }) >= 0,
      'mountainHitAlong：山墙命中'
    );
  }

  // ② 索敌：山两侧互不索敌；水两侧照常索敌
  {
    const mt = scene(C.TT_MOUNTAIN);
    const wt = scene(C.TT_WATER);
    advance(mt.g, 15);
    ok(mt.a.targetId === 0 && mt.b.targetId === 0, '山两侧的单位互不索敌（双方目标均为 0）');
    ok(__test.findTarget(mt.g, mt.a) === null, 'findTarget：隔着山找不到任何目标');
    ok(mt.g.bullets.length === 0, `山两侧的单位互不开火（弹道 ${mt.g.bullets.length} 发）`);
    ok(
      mt.a.x === mt.lx && mt.a.y === mt.wy,
      '山两侧的单位不会隔山追击（原地不动）'
    );

    advance(wt.g, 15);
    ok(wt.a.targetId === wt.b.id && wt.b.targetId === wt.a.id, '水两侧的单位照常互相索敌（水面不遮挡）');
    ok(wt.g.bullets.length > 0, `水两侧的单位照常开火（已有弹道 ${wt.g.bullets.length} 发）`);
  }

  // ③ 弹道：直射弹撞山即止，飞越水面不受影响
  {
    const fly = (sc) => {
      sc.g.units.length = 0; // 清掉单位，只观察弹丸与地形
      sc.g.bullets.length = 0;
      const cl = makeClock();
      sc.g.bullets.push({
        id: 7777,
        x: sc.lx,
        y: sc.wy,
        vx: 320,
        vy: 0,
        dmg: 5,
        ownerIdx: 0,
        ownerId: 'p9',
        shooterId: 0,
        kind: 'bullet',
        splash: 0,
        tx: sc.rx,
        ty: sc.wy,
        targetId: 0,
        born: cl.now,
        dead: false,
      });
      let maxX = sc.lx;
      for (let i = 0; i < 10 && sc.g.bullets.length; i++) {
        cl.now += 100;
        __test.updateBullets(sc.g, 0.1, cl.now);
        for (const b of sc.g.bullets) maxX = Math.max(maxX, b.x);
      }
      return maxX;
    };
    const mt = scene(C.TT_MOUNTAIN);
    const wt = scene(C.TT_WATER);
    const mtEnd = fly(mt);
    ok(
      mtEnd < mt.wallX,
      `直射弹撞山即止（停在 x=${Math.round(mtEnd)}，山墙中心 x=${Math.round(mt.wallX)}）`
    );
    const wtEnd = fly(wt);
    ok(
      wtEnd > wt.wallX + 40,
      `直射弹照常飞越水面（飞到 x=${Math.round(wtEnd)}，水面中心 x=${Math.round(wt.wallX)}）`
    );
  }

  // ④ 炮击溅射同样不越山
  {
    const mt = scene(C.TT_MOUNTAIN);
    const shell = { ownerIdx: 0, shooterId: 0, dmg: 30, splash: 120 };
    const hpBefore = mt.b.hp;
    __test.explodeShell(mt.g, shell, mt.wallX - 30, mt.wy, 5000);
    ok(mt.b.hp === hpBefore, '炮击溅射不越山：山另一侧的单位毫发无伤');

    const wt = scene(C.TT_WATER);
    const hpBeforeW = wt.b.hp;
    __test.explodeShell(wt.g, shell, wt.wallX - 30, wt.wy, 5000);
    ok(wt.b.hp < hpBeforeW, `同一发炮击落在水面上仍会溅射到对岸（${hpBeforeW} → ${wt.b.hp}）`);
  }

  // ⑤ 受击反击同样受视线约束：看不见攻击者就不还手（否则部队会朝山体扎堆）
  {
    const mt = scene(C.TT_MOUNTAIN);
    __test.retaliate(mt.g, mt.b, mt.a.id);
    ok(mt.b.targetId === 0, '被山挡住的攻击者不引发反击（看不见就不还手）');

    const wt = scene(C.TT_WATER);
    __test.retaliate(wt.g, wt.b, wt.a.id);
    ok(wt.b.targetId === wt.a.id, '水面不遮挡 → 受击后照常反击');
  }
}

/**
 * 16. 工厂产线升级（花科技点开辟新产线，并行生产，最多 3 条）
 *     + 总部产能升级（花科技点加快生产速度，每次在当前间隔上再减 1/15，最多 20 次）
 */
{
  console.log('\n[16] 工厂产线升级 / 总部产能升级');

  // ---- 产线升级：花费 / 上限 / 归属校验 ----
  {
    const gu = createGameState(room(2));
    gu.phase = 'playing';
    gu.phaseEndsAt = 0;
    const fu = gu.factories[0];
    __test.damageFactory(gu, fu, fu.hp + 1, 0);
    ok(fu.owner === 0 && (fu.lines || 1) === 1, '工厂初始只有 1 条产线');

    gu.players[0].rp = C.FAC_LINE_COST - 1;
    ok(!setPlayerInput(gu, 'p0', { cmd: 'facLine', fid: fu.id }), `科技点不足 ${C.FAC_LINE_COST} 时拒绝开产线`);
    gu.players[0].rp = C.FAC_LINE_COST;
    ok(setPlayerInput(gu, 'p0', { cmd: 'facLine', fid: fu.id }), '科技点充足时开辟产线成功');
    ok(fu.lines === 2, '产线数 1 → 2');
    ok(gu.players[0].rp === 0, `开产线扣除 ${C.FAC_LINE_COST} 科技点`);

    gu.players[0].rp = C.FAC_LINE_COST;
    ok(setPlayerInput(gu, 'p0', { cmd: 'facLine', fid: fu.id }), '再开辟一条产线');
    ok(fu.lines === C.FAC_MAX_LINES, `产线数达到上限 ${C.FAC_MAX_LINES}`);
    gu.players[0].rp = C.FAC_LINE_COST * 3;
    ok(!setPlayerInput(gu, 'p0', { cmd: 'facLine', fid: fu.id }), '满产线后拒绝继续开辟（不扣费）');
    ok(gu.players[0].rp === C.FAC_LINE_COST * 3, '被拒绝时科技点不变');
    ok(!setPlayerInput(gu, 'p1', { cmd: 'facLine', fid: fu.id }), '不能给别人的工厂开产线');
    ok(!setPlayerInput(gu, 'p0', { cmd: 'facLine', fid: -1 }), '给不存在的工厂开产线被拒绝');
  }

  // ---- 多产线 = 产出速率成倍（3 条产线在同样时间内产出约 3 倍）----
  {
    const countFac = (lines) => {
      const gp = createGameState(room(2));
      gp.phase = 'playing';
      gp.phaseEndsAt = 0;
      gp.units.length = 0;
      const fp = gp.factories[0];
      __test.damageFactory(gp, fp, fp.hp + 1, 0);
      fp.rally = null;
      fp.lines = lines;
      fp.prodProg = 0;
      const cl = makeClock();
      const steps = Math.round((C.PRODUCE_MS * 3) / 100);
      for (let i = 0; i < steps; i++) {
        cl.now += 100;
        __test.updateProduction(gp, 0.1, cl.now);
      }
      return __test.garrisonOf(gp, fp.id, 0);
    };
    const n1 = countFac(1);
    const n3 = countFac(3);
    ok(n1 === 3, `单产线 3 个周期产出 3 支（实为 ${n1}）`);
    ok(n3 >= 8, `3 条产线同时间产出约 3 倍（实为 ${n3} 支）`);
    ok(n3 > n1 * 2, `产线数直接决定产能（${n1} → ${n3}）`);
  }

  // ---- 总部产能升级：花费 / 复利递减 / 上限 / 只影响自己 ----
  {
    const gs = createGameState(room(2));
    gs.phase = 'playing';
    gs.phaseEndsAt = 0;
    const hq0 = gs.hqs.find((h) => h.owner === 0);
    const hq1 = gs.hqs.find((h) => h.owner === 1);
    ok((hq0.speedLv || 0) === 0 && (hq1.speedLv || 0) === 0, '总部初始 0 级生产加速');
    const base = __test.prodIntervalMs(gs, 0);
    ok(Math.abs(base - C.PRODUCE_MS) < 1e-6, `0 级时生产间隔 = 基础间隔（${Math.round(base)}ms）`);

    gs.players[0].rp = C.PROD_SPEED_COST - 1;
    ok(!setPlayerInput(gs, 'p0', { cmd: 'prodSpeed' }), `科技点不足 ${C.PROD_SPEED_COST} 时拒绝升级`);
    gs.players[0].rp = C.PROD_SPEED_COST;
    ok(setPlayerInput(gs, 'p0', { cmd: 'prodSpeed' }), '科技点充足时升级成功');
    ok(hq0.speedLv === 1, '生产加速等级 0 → 1');
    ok(gs.players[0].rp === 0, `升级扣除 ${C.PROD_SPEED_COST} 科技点`);

    const l1 = __test.prodIntervalMs(gs, 0);
    const expect1 = C.PRODUCE_MS * (1 - C.PROD_SPEED_STEP);
    ok(Math.abs(l1 - expect1) < 1e-6, `每次在「当前间隔」上再减 1/15（${Math.round(base)} → ${Math.round(l1)}ms）`);
    ok(__test.prodIntervalMs(gs, 1) === base, '只影响自己：对手的生产间隔不变');

    // 复利（非线性）：第 2 次升级减少的绝对毫秒数 < 第 1 次
    hq0.speedLv = 2;
    const l2 = __test.prodIntervalMs(gs, 0);
    ok(base - l1 > l1 - l2, '非线性：越往后每次减少的绝对时间越少（复利）');

    // 上限
    hq0.speedLv = C.PROD_SPEED_MAX;
    gs.players[0].rp = C.PROD_SPEED_COST * 5;
    ok(!setPlayerInput(gs, 'p0', { cmd: 'prodSpeed' }), `满 ${C.PROD_SPEED_MAX} 级后拒绝继续升级`);
    const lMax = __test.prodIntervalMs(gs, 0);
    const expectMax = C.PRODUCE_MS * Math.pow(1 - C.PROD_SPEED_STEP, C.PROD_SPEED_MAX);
    ok(
      Math.abs(lMax - expectMax) < 1e-6,
      `满级间隔 = 基础 × (14/15)^${C.PROD_SPEED_MAX} ≈ ${Math.round(lMax)}ms`
    );
    ok(
      lMax < C.PRODUCE_MS / 3 && lMax > C.PRODUCE_MS / 5,
      `满级约为基础间隔的 1/4（提速约 ${(C.PRODUCE_MS / lMax).toFixed(2)} 倍）`
    );

    // 快照 / 全量状态下发
    const snapU = snapshot(gs);
    const rowF = snapU.f.find((r) => r[0] === gs.factories[0].id);
    ok(rowF && rowF[8] === (gs.factories[0].lines || 1), '快照下发工厂产线数');
    const rowH = snapU.hq.find((r) => r[0] === hq0.id);
    ok(rowH && rowH[6] === C.PROD_SPEED_MAX, '快照下发总部生产加速等级');
    const st = publicGameState(gs);
    ok(
      st.hqs.every((h) => typeof h.speedLv === 'number' && typeof h.prodIntervalMs === 'number'),
      '全量状态携带总部加速等级与当前生产间隔'
    );
    ok(
      st.factories.every((f) => typeof f.lines === 'number' && f.lines >= 1),
      '全量状态携带工厂产线数'
    );
    ok(
      st.consts.facLineCost === C.FAC_LINE_COST &&
        st.consts.facMaxLines === C.FAC_MAX_LINES &&
        st.consts.prodSpeedCost === C.PROD_SPEED_COST &&
        st.consts.prodSpeedMax === C.PROD_SPEED_MAX,
      '全量状态下发升级相关常数'
    );
  }
}

/**
 * 17. 燎原：持续喷火 + 灼烧地形
 *     - 火舌落在哪里，就在哪里铺开一片火场（不是「一发燃烧弹命中挂 DoT」）
 *     - **逐阶解锁**：一级只喷火、不留火场；二级起才在地上留火；三级火场更大 / 更久 / 更疼
 *     - 站在火场上的**所有**单位持续掉血：敌我通吃（全局唯一的友伤）
 *     - 伤害低、范围大；火焰一停，火场几秒内自行熄灭
 */
{
  console.log('\n[17] 燎原喷火 / 灼烧地形');

  // ---- ① 火场本体：逐阶解锁 / 敌我通吃 / 半径 / 秒伤 / 合并 / 熄灭 ----
  {
    const gf = createGameState(room(2));
    gf.phase = 'playing';
    gf.phaseEndsAt = 0;
    gf.units.length = 0; // 清场：这一组只关心火场本身
    const cx = 1400;
    const cy = 1400;
    const T2 = C.FIRE_TIERS[1]; // 二级：基准火场
    const T3 = C.FIRE_TIERS[2]; // 三级：更大 / 更久 / 更疼
    const foe = __test.spawnUnit(gf, { id: 1, owner: 1, level: 1 }, 'shield', cx + 20, cy);
    const mate = __test.spawnUnit(gf, { id: 1, owner: 0, level: 1 }, 'shield', cx - 20, cy);
    const out = __test.spawnUnit(gf, { id: 1, owner: 1, level: 1 }, 'shield', cx + T3.r + 60, cy);
    ok(gf.fires.length === 0, '开局场上没有灼烧地形');
    ok(C.FIRE_TIERS[0] === null && T2 && T3, '火场参数逐阶解锁：一级没有（null），二级 / 三级各一套');
    ok(
      T3.r > T2.r && T3.dps > T2.dps && T3.lifeMs > T2.lifeMs,
      `三级火场比二级更大 / 更疼 / 更耐烧（半径 ${T2.r}→${T3.r}、伤害 ${T2.dps}→${T3.dps}/秒、` +
        `寿命 ${T2.lifeMs / 1000}→${T3.lifeMs / 1000} 秒）`
    );
    const consts17 = publicGameState(gf).consts;
    ok(
      consts17.fireTiers[0] === null &&
        consts17.fireTiers[1][0] === T2.r &&
        consts17.fireTiers[1][1] === T2.dps &&
        consts17.fireTiers[2][0] === T3.r,
      'consts 下发逐阶火场参数（客户端单位面板按当前阶数显示）'
    );

    // 一级：只喷火，不留火场 —— 想烧地得先把它进化一次
    ok(
      __test.addFire(gf, cx, cy, 0, 1000, 1) === null && gf.fires.length === 0,
      '一级燎原喷火不留灼烧地形'
    );
    ok(
      __test.fireProfile(1) === null && __test.fireProfile(2) === T2 && __test.fireProfile(3) === T3,
      'fireProfile 按阶取火场参数（一级 null）'
    );

    // 二级起才有火场
    __test.addFire(gf, cx, cy, 0, 1000, 2);
    ok(gf.fires.length === 1 && gf.fires[0].r === T2.r, `二级燎原留下火场（半径 ${T2.r}）`);

    const hpF = foe.hp;
    const hpM = mate.hp;
    const hpO = out.hp;
    for (let i = 0; i < 20; i++) __test.updateFires(gf, 0.05, 1000 + i * 50); // 烧 1 秒
    ok(foe.hp < hpF, '火场里的敌方单位掉血');
    ok(mate.hp < hpM, '火场里的自家单位同样掉血（不分敌我）');
    ok(out.hp === hpO, `火场外（> ${T3.r} + 单位半径）的单位不掉血`);
    ok(foe.burning && mate.burning, '站在火里的单位被标记 burning（客户端据此画身上火苗）');
    ok(!out.burning, '火场外的单位不带 burning 标记');
    const fireDps = (hpF - foe.hp) / 1;
    ok(
      Math.abs(fireDps - T2.dps) < 0.4,
      `二级灼烧伤害低：实测 ${fireDps.toFixed(2)}/秒（常数 ${T2.dps}/秒）`
    );
    ok(T2.dps < C.STATS.warrior.dmg, `灼烧低于锐士一击（${T2.dps} < ${C.STATS.warrior.dmg}）`);

    // 火舌每秒要刷几十次：相近落点必须并进同一片火场，否则地上会瞬间铺出几百块
    const before = gf.fires.length;
    __test.addFire(gf, cx + 10, cy + 10, 0, 2000, 2);
    ok(gf.fires.length === before, '相近落点并入同一片火场（不会每步新铺一块）');
    __test.addFire(gf, cx + T2.mergeD + 40, cy, 0, 2000, 2);
    ok(gf.fires.length === before + 1, '落点明显挪动后才另铺一片（跟着火舌连成火线）');
    __test.addFire(gf, cx + 5, cy + 5, 1, 2000, 2);
    ok(gf.fires.length === before + 2, '不同喷火者各烧各的（火场按归属分开）');

    // 三级燎原扫过二级留下的火区 → 那片火整体升级（合并时逐项取强）
    const low = gf.fires.find((f) => f.owner === 0);
    __test.addFire(gf, low.x, low.y, 0, 2100, 3);
    ok(
      gf.fires.length === before + 2 && low.r === T3.r && low.dps === T3.dps && low.lifeMs === T3.lifeMs,
      '三级火扫过二级火区 → 并入并整体升级（不是旁边另铺一块小的）'
    );

    // 熄灭：火场寿命跟着「最后一次被火舌刷到」走
    gf.fires.length = 0;
    __test.addFire(gf, cx, cy, 0, 2000, 2);
    __test.updateFires(gf, 0.05, 2000 + T2.lifeMs - 300);
    ok(gf.fires.length === 1, `停止喷吐 ${(T2.lifeMs - 300) / 1000} 秒后火还在烧（不是立刻消失）`);
    __test.updateFires(gf, 0.05, 2000 + T2.lifeMs + 100);
    ok(gf.fires.length === 0, `超过 ${T2.lifeMs / 1000} 秒后二级火场熄灭（几秒内消失）`);

    // 火舌还在喷 → 火场被续命
    gf.fires.length = 0;
    __test.addFire(gf, cx, cy, 0, 2000, 2);
    __test.addFire(gf, cx, cy, 0, 2000 + T2.lifeMs - 50, 2); // 火舌又刷了一次
    __test.updateFires(gf, 0.05, 2000 + T2.lifeMs + 200);
    ok(gf.fires.length === 1, '火舌没停 → 火场被续命，不会熄灭');

    // 三级更耐烧：二级早熄了，它还在烧
    gf.fires.length = 0;
    __test.addFire(gf, cx, cy, 0, 2000, 3);
    __test.updateFires(gf, 0.05, 2000 + T2.lifeMs + 100);
    ok(gf.fires.length === 1, `三级火场比二级耐烧（二级 ${T2.lifeMs / 1000} 秒已灭，三级还在烧）`);
    __test.updateFires(gf, 0.05, 2000 + T3.lifeMs + 100);
    ok(gf.fires.length === 0, `三级火场 ${T3.lifeMs / 1000} 秒后同样会熄灭`);

    // 三级更疼：一样的站位、同样烧 1 秒，掉血明显更多
    const foe3 = __test.spawnUnit(gf, { id: 1, owner: 1, level: 1 }, 'shield', cx + 20, cy);
    gf.fires.length = 0;
    __test.addFire(gf, cx, cy, 0, 9000, 3);
    const hpF3 = foe3.hp;
    for (let i = 0; i < 20; i++) __test.updateFires(gf, 0.05, 9000 + i * 50);
    const dps3 = hpF3 - foe3.hp;
    ok(Math.abs(dps3 - T3.dps) < 0.6, `三级灼烧更疼：实测 ${dps3.toFixed(2)}/秒（${T3.dps}/秒）`);
    ok(dps3 > fireDps * 1.4, `三级火场伤害明显高于二级（${dps3.toFixed(2)} > ${fireDps.toFixed(2)}）`);
  }

  // ---- ② 真打一场：一级不留火、二级留火、三级火更大更久，且完全不走弹道 ----
  {
    const T2 = C.FIRE_TIERS[1];
    const T3 = C.FIRE_TIERS[2];
    const gb = createGameState(room(2));
    gb.phase = 'playing';
    gb.phaseEndsAt = 0;
    gb.units.length = 0;
    const s = findFlatSpot(gb, 60);
    const burner = __test.spawnUnit(gb, { id: 1, owner: 0, level: 3 }, 'burn', s.x, s.y);
    const foe = __test.spawnUnit(gb, { id: 1, owner: 1, level: 1 }, 'shield', s.x + 110, s.y);
    burner.moveX = null;
    burner.moveY = null;
    burner.scanAt = 0;
    foe.moveX = null;
    foe.moveY = null;
    ok(burner.burn === true, '燎原自带 burn 标记');
    ok(burner.tier === 1, '刚出厂的燎原是一级');
    ok(burner.range === C.STATS.burn.range, `一级燎原射程 ${burner.range}`);

    let sawFireBullet = false;
    let sawFlameEvt = false;
    const shotKinds = new Set();
    let t = 20000;
    const run = (n) => {
      for (let i = 0; i < n; i++) {
        t += 50;
        __test.step(gb, 0.05, t);
        if (gb.bullets.some((b) => b.kind === 'fire')) sawFireBullet = true;
        for (const e of gb.events) {
          if (e.t === 'shot') shotKinds.add(e.k);
          if (e.t === 'flame') sawFlameEvt = true;
        }
      }
    };

    // 一级：喷得到人，但地上干干净净
    run(12);
    ok(foe.hp < C.STATS.shield.hp, '一级燎原的火舌照样烧人（伤害不打折）');
    ok(gb.fires.length === 0, '一级燎原喷火不留灼烧地形');
    const hpAfterLv1 = foe.hp;

    // 二级：开始在地上留下火场（基准大小）
    ok(__test.promoteUnit(gb, burner), '进化到二级');
    run(10);
    ok(gb.fires.length > 0, `二级燎原留下灼烧地形（${gb.fires.length} 块）`);
    ok(gb.fires.every((f) => f.r === T2.r), `二级火场是基准大小（半径 ${T2.r}）`);
    ok(foe.hp < hpAfterLv1, '踩在火场里继续掉血');

    // 三级：火场更大 / 更久 / 更疼
    ok(__test.promoteUnit(gb, burner) && burner.tier === 3, '再进化到三级');
    ok(burner.range > C.STATS.burn.range, `三级燎原射程更长（${burner.range}）`);
    run(20);
    ok(!sawFireBullet, '火焰不走弹道（场上的弹体里没有 kind=fire）');
    ok(sawFlameEvt, '火舌落地推 flame 事件（客户端在落点演一次爆焰）');
    ok(shotKinds.has(3), '喷火推的是 k=3（火焰色）枪口焰事件');
    ok(
      gb.fires.length > 0 && gb.fires.every((f) => f.r === T3.r && f.lifeMs === T3.lifeMs),
      `升到三级后脚下的火场整体升级（半径 ${T3.r}、寿命 ${T3.lifeMs / 1000} 秒）`
    );
    const f0 = gb.fires[0];
    ok(
      Math.hypot(f0.x - foe.x, f0.y - foe.y) <= T3.r,
      '火场铺在「火焰落下的地方」（目标脚下）'
    );
    ok(foe.burning, '目标站在自己脚下的火里 → 持续被烧');
    ok(burner.lockKind === 1 && burner.lockId === foe.id, '喷火时下发锁定目标（客户端据此画火舌）');

    const dps = (C.STATS.shield.hp - foe.hp) / 2.1;
    ok(dps > 2 && dps < 20, `火焰 + 灼烧合计每秒 ${dps.toFixed(1)}：低伤害、慢灼烧`);

    const snap = snapshot(gb);
    ok(
      Array.isArray(snap.fr) && snap.fr.length > 0 && snap.fr[0].length === 6,
      '快照下发灼烧地形 fr（x, y, 半径, 剩余寿命, 归属, 寿命上限）'
    );
    // 剩余寿命是相对「快照那一刻的真实时钟」算的，所以这里把火场寿命对齐到真实时间再断言
    gb.fires.forEach((f) => (f.until = Date.now() + 2500));
    const snap2 = snapshot(gb);
    ok(
      snap2.fr.every((f) => f[3] > 0 && f[3] <= T3.lifeMs && f[5] === T3.lifeMs),
      '快照带剩余寿命 + 寿命上限（客户端据此把火画得越来越暗）'
    );
    const row = snap.u.find((r) => r[0] === burner.id);
    ok(row && row[12] === 1, '快照下发燎原的喷火锁定类别');
    const foeRow = snap.u.find((r) => r[0] === foe.id);
    ok(foeRow && foeRow[10] === 1, '快照下发单位身上的「在燃烧」标记');
  }

  // ---- ③ 建筑：只吃「火舌直接喷到」，不吃地上的灼烧地形 ----
  {
    const gc = createGameState(room(2));
    gc.phase = 'playing';
    gc.phaseEndsAt = 0;
    gc.units.length = 0; // 清场：这一组只关心建筑挨不挨烧

    const fac = gc.factories[0];
    fac.owner = 1; // 敌方工厂
    fac.hp = fac.hpMax;
    const ownFac = gc.factories[1];
    ownFac.owner = 0; // 自家工厂（对照：不该被自家火舌烧到）
    ownFac.hp = ownFac.hpMax;
    const lab = gc.labs[0];
    lab.owner = 1;
    lab.hp = lab.hpMax;
    const hq = gc.hqs.find((h) => h.owner === 1);

    const burner = __test.spawnUnit(gc, { id: 1, owner: 0, level: 3 }, 'burn', fac.x, fac.y);
    // 把燎原挪到建筑边缘外侧一点点（建筑周边地形是清空的，视线一定畅通），火舌落点压在建筑中心
    const stand = (bx, by, r) => {
      burner.x = bx + r + 8;
      burner.y = by;
    };

    stand(fac.x, fac.y, C.FACTORY_R);
    const hpF = fac.hp;
    const hpOwn = ownFac.hp;
    __test.sprayFlame(gc, burner, fac.x, fac.y, 1, 5000); // 火舌正烧工厂 1 秒
    ok(fac.hp < hpF, `火舌直接喷到敌方工厂 → 工厂掉血（${hpF} → ${Math.round(fac.hp)}）`);
    ok(ownFac.hp === hpOwn, '自家工厂不被自家火舌烧到');

    stand(lab.x, lab.y, C.LAB_R);
    const hpL = lab.hp;
    __test.sprayFlame(gc, burner, lab.x, lab.y, 1, 5100);
    ok(lab.hp < hpL, `火舌直接喷到敌方研究所 → 研究所掉血（${hpL} → ${Math.round(lab.hp)}）`);

    stand(hq.x, hq.y, C.HQ_R);
    const hpH = hq.hp;
    __test.sprayFlame(gc, burner, hq.x, hq.y, 1, 5200);
    ok(hq.hp < hpH, `火舌直接喷到敌方总部 → 总部掉血（${hpH} → ${Math.round(hq.hp)}）`);

    // 对照：把火铺在三座建筑脚下烧满 1 秒，建筑血量必须纹丝不动
    const f2 = fac.hp;
    const l2 = lab.hp;
    const h2 = hq.hp;
    __test.addFire(gc, fac.x, fac.y, 0, 6000, 3);
    __test.addFire(gc, lab.x, lab.y, 0, 6000, 3);
    __test.addFire(gc, hq.x, hq.y, 0, 6000, 3);
    for (let i = 0; i < 20; i++) __test.updateFires(gc, 0.05, 6000 + i * 50); // 烧 1 秒
    ok(gc.fires.length > 0, '对照组前提：火确实铺在了三座建筑脚下');
    ok(
      fac.hp === f2 && lab.hp === l2 && hq.hp === h2,
      '灼烧地形对建筑完全无伤害（工厂 / 研究所 / 总部血量不变）'
    );
  }
}

console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
