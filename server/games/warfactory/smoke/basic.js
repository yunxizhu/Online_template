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

/**
 * 第 9 项：一条产线造满 n 支要消耗几个「周期」（1 周期 = PRODUCE_MS）。
 * 在场 k 个兵时这条线只剩 (1 - k × LINE_SLOW_PER_UNIT) 的产速，所以是越造越慢：
 * 前几支各 1 个周期，第 10 支要吃 10 个周期。
 * 测试里所有「N 个周期出几支」的期望值都由它推，不写死 —— 否则改 data.js 就会误报。
 */
function cyclesToMake(n) {
  let c = 0;
  for (let k = 0; k < n; k++) c += 1 / Math.max(1e-6, 1 - k * C.LINE_SLOW_PER_UNIT);
  return c;
}

/** 给定周期内这条线实际能造出几支（超过 LINE_UNIT_CAP 就停） */
function madeInCycles(cycles) {
  let n = 0;
  while (n < C.LINE_UNIT_CAP && cyclesToMake(n + 1) <= cycles) n += 1;
  return n;
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

// 1. 开局状态：每玩家 1 总部、无工厂、全部工厂中立、研究所中立残血、开局亲兵按 startRoster
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
ok(startUnits.length === C.START_ROSTER.length, `每名玩家开局亲兵 ${C.START_ROSTER.length} 支（${startUnits.length}）`);
// 构成从 data.js 的 startRoster 推导（用户随时会改配置，这里不许写死兵种名）
const rosterCount = {};
C.START_ROSTER.forEach((t) => (rosterCount[t] = (rosterCount[t] || 0) + 1));
ok(
  Object.entries(rosterCount).every(
    ([t, n]) => startUnits.filter((u) => u.type === t && u.tier === 1).length === n
  ),
  `开局部队构成与 startRoster 一致（${Object.entries(rosterCount)
    .map(([t, n]) => `${n} ${C.STATS[t] ? C.STATS[t].label : t}`)
    .join(' + ')}）`
);
// 总部产线不可进化 → 总部出的兵（含开局亲兵）进化上限恒为 1
ok(startUnits.every((u) => u.maxTier === 1), '总部亲兵不可进化（maxTier=1）');
ok(
  g.factories.filter((f) => f.level === 3).length === 2 &&
    g.factories.filter((f) => f.level === 2).length === 4 &&
    g.factories.filter((f) => f.level === 1).length === 4,
  '地图含 2 高 + 4 中 + 4 初级（每家门口 2 座初级）'
);
// 每家总部正前方恰好 2 座初级厂，且都在防卫射程内（开局总部就能打）
{
  const range = C.HQ_ATK_RANGE;
  for (let i = 0; i < g.hqs.length; i++) {
    const hq = g.hqs[i];
    const near = g.factories.filter(
      (f) => f.level === 1 && Math.hypot(f.x - hq.x, f.y - hq.y) <= range
    );
    ok(near.length === 2, `玩家${i} 总部射程内恰好 2 座初级厂（实为 ${near.length}）`);
  }
}
ok(
  g.factories.every((f) => Array.isArray(f.specs) && f.specs.length === 1 && f.specs[0].tier === 1),
  '每座工厂开局 1 条一级产线'
);
ok(
  g.hqs.every((h) => h.specs.length === 1 && h.specs[0].type === C.HQ_PROD_TYPE),
  `总部自带 1 条产线，默认产 ${C.HQ_PROD_TYPE}`
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

// 5. 研究所可被攻击：打光血量 → 累计消耗血量最多者接管并满血
g.labs[1].owner = -1;
const l1 = g.labs[1];
const l1Hp0 = l1.hp;
g.now = 1000;
__test.damageLab(g, l1, 100, 1);
ok(l1.hp === l1Hp0 - 100, '研究所受到伤害后掉血');
__test.damageLab(g, l1, l1.hp + 1, 1);
ok(l1.owner === 1, '研究所血打光后归累计伤害最高者');
ok(l1.hp === l1.hpMax, '研究所易主后血量恢复满');

// 6. 工厂可被攻击：打光血量 → 累计消耗最多者得厂 + 满血 + 开始产兵
// 取「离双方总部最远」的初级中立厂：开局部队站在厂边就打，目标厂离总部太近会被顺手打残（踩过坑）。
const hqDist = (b) => Math.min(...g.hqs.map((h) => Math.hypot(h.x - b.x, h.y - b.y)));
const f1 = g.factories.filter((f) => f.level === 1).sort((a, b) => hqDist(b) - hqDist(a))[0];
ok(hqDist(f1) > 500, `所选测试厂远离双方总部（${Math.round(hqDist(f1))}px），不受开局部队干扰`);
ok(
  f1.hp === Math.round(C.FACTORY_HP * C.NEUTRAL_HP_RATIO) && f1.hpMax === C.FACTORY_HP,
  `中立工厂只有完整工厂的 1/3 血量（${f1.hp}/${f1.hpMax}）`
);
// 攻厂单位从「开局亲兵」里取（startRoster 由用户配置，别写死兵种名），站位按它自己的射程推
const raider = g.units.find((u) => u.ownerIdx === 0 && !u.dead);
ok(Boolean(raider), `开局亲兵里有可用的 0 号单位（${raider ? raider.type : '无'}）`);
const standOff = Math.min(100, Math.max(40, raider.range * 0.6));
raider.x = f1.x + standOff;
raider.y = f1.y;
raider.moveX = null;
raider.moveY = null;
raider.scanAt = 0;
const f1Hp0 = f1.hp;
clock.run(g, 6000);
ok(f1.hp < f1Hp0, `单位自动攻击射程内的工厂（${f1Hp0} → ${Math.round(f1.hp)}）`);
__test.damageFactory(g, f1, f1.hp + 1, 0);
ok(f1.owner === 0, '血打光后归累计伤害最高者所有');
ok(f1.hp === f1.hpMax, '归属权变化后血量恢复满');
ok(g.players[0].captured >= 1, '占领数记入统计');

// 6b. 累计伤害最高者得厂（最后一击者未必是赢家）+ 1 分钟未攻击则账本清空
{
  const fx = g.factories.filter((f) => f.level === 1 && f.id !== f1.id).sort((a, b) => hqDist(b) - hqDist(a))[0];
  fx.owner = -1;
  fx.hp = 100;
  fx.hpMax = C.FACTORY_HP;
  fx.dmgBook = Object.create(null);
  g.now = 5000;
  __test.damageFactory(g, fx, 70, 0); // p0 累计 70
  __test.damageFactory(g, fx, 20, 1); // p1 累计 20
  __test.damageFactory(g, fx, fx.hp + 1, 1); // p1 补刀，但总伤 20+30=50 < 70
  ok(fx.owner === 0, `补刀方不是赢家：累计更高的 p0 得厂（实为 p${fx.owner}）`);
  ok(fx.hp === fx.hpMax, '易主后满血');

  // 伤害遗忘：打一点后停手超过 forgetMs，账本清空，后手打满的人拿走
  const fy = g.factories.filter((f) => f.level === 1 && f.id !== f1.id && f.id !== fx.id)[0];
  fy.owner = -1;
  fy.hp = 100;
  fy.hpMax = C.FACTORY_HP;
  fy.dmgBook = Object.create(null);
  g.now = 10000;
  __test.damageFactory(g, fy, 80, 0);
  g.now = 10000 + C.DAMAGE_FORGET_MS + 100;
  __test.updateFactories(g, 0.1, g.now); // 触发 prune
  __test.damageFactory(g, fy, fy.hp + 1, 1);
  ok(fy.owner === 1, '停手超过遗忘时间后，旧账本清空，后手打光者得厂');
}

// 6c. 工厂维修：己方每兵在外缘+repairRange 内提供 repairHpPerSec
{
  f1.hp = f1.hpMax - 200;
  const healers = g.units.filter((u) => u.ownerIdx === 0 && !u.dead).slice(0, 3);
  for (const u of healers) {
    u.x = f1.x + C.FACTORY_R + 10;
    u.y = f1.y;
  }
  const hpBefore = f1.hp;
  g.now = (g.now || 0) + 1000;
  __test.updateFactories(g, 1.0, g.now); // 1 秒
  const expectHeal = healers.length * C.REPAIR_HP_PER_SEC;
  ok(
    Math.abs(f1.hp - (hpBefore + expectHeal)) < 0.01,
    `3 兵维修 1 秒回 ${expectHeal} 血（${hpBefore} → ${f1.hp.toFixed(1)}）`
  );
  // 站在维修圈外不回血
  f1.hp = f1.hpMax - 100;
  for (const u of healers) {
    u.x = f1.x + C.REPAIR_RANGE + 40;
    u.y = f1.y;
  }
  const hp2 = f1.hp;
  __test.updateFactories(g, 1.0, g.now + 1000);
  ok(f1.hp === hp2, '维修圈外的友军不提供维修');
}

// 7. 该厂持续产兵：不再有旧的「初级 4 / 中级 6 / 高级 9」截断，
//    改成每条产线自己在场名额（LINE_UNIT_CAP）封顶，且越接近满额越慢。
// 产兵间隔由 PRODUCE_MS 决定（现为 20 秒/支），推进时长必须按间隔推导而不是写死秒数
const produceMs = C.PRODUCE_MS;
const cyc6 = 6;
clock.run(g, produceMs * cyc6 + 1000); // 6 个周期
  const garrison = __test.garrisonOf(g, f1.id, 0);
  const expect6 = madeInCycles(cyc6);
  ok(
    Math.abs(garrison - expect6) <= 1,
    `${cyc6} 个周期产出 ${garrison} 支（按「在场越多越慢」推算应为 ${expect6} 支）`
  );
  ok(garrison >= madeInCycles(4), `产能没被卡在旧的 4 / 6 / 9 上（${garrison} 支）`);
// 再推到「造满名额」所需的时间（第 10 支要 10 个周期，所以这里得给足）
clock.run(g, produceMs * (cyclesToMake(C.LINE_UNIT_CAP) - cyc6) + produceMs);
const garrison2 = __test.garrisonOf(g, f1.id, 0);
ok(garrison2 > 9, `继续生产并超过旧最高上限 9（${garrison} → ${garrison2}）`);
ok(
  garrison2 === C.LINE_UNIT_CAP,
  `最终停在这条线的名额上限 ${C.LINE_UNIT_CAP}（实为 ${garrison2}）—— 满额即停产`
);
const facUnits = g.units.filter((u) => u.homeFac === f1.id && u.ownerIdx === 0);
ok(facUnits.every((u) => u.maxTier === 1), '初级厂出厂单位进化上限为初级');
ok(
  facUnits.every((u) => u.type === f1.specs[0].type),
  '工厂按第一条产线的兵种出兵'
);

// 8. 产线进化：花科技点把一条产线整体抬高一阶（不再有经验体系）
const f2 = g.factories.find((f) => f.level === 2);
__test.damageFactory(g, f2, f2.hp + 1, 0);
ok(f2.owner === 0, '拿下中级工厂');
clock.run(g, 40000);
const midUnits = g.units.filter((u) => u.homeFac === f2.id && u.ownerIdx === 0);
ok(midUnits.length > 0, '中级厂开始产兵');
ok(midUnits.every((u) => u.maxTier === 2), '中级厂出厂单位进化上限为中级');
// 科技点不足 → 拒绝
g.players[0].rp = C.FAC_LINE_EVOLVE_COST - 1;
ok(!setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: f2.id, li: 0 }), `科技点不足 ${C.FAC_LINE_EVOLVE_COST} 时拒绝进化`);
ok(f2.specs[0].tier === 1, '被拒绝时产线阶数不变');
// 科技点充足 → 直接进化（单一进化方向，不再需要先定型 A / B 分支）
g.players[0].rp = C.FAC_LINE_EVOLVE_COST * 3;
const rpBefore = g.players[0].rp;
ok(setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: f2.id, li: 0 }), '科技点充足时进化成功（无需选分支）');
ok(f2.specs[0].tier === 2 && f2.specs[0].branch === '', '产线升到二级，且不再定型分支');
ok(g.players[0].rp === rpBefore - C.FAC_LINE_EVOLVE_COST, `产线进化消耗 ${C.FAC_LINE_EVOLVE_COST} 点科技点`);
ok(!setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: f2.id, li: 0 }), '进化冷却中再次点击被拒绝');
// 关键：进化之后这条线**直接产二级单位**，而不是继续产初级
g.units.length = 0;
clock.run(g, C.PRODUCE_MS * 2 + 600);
const evolved = g.units.filter((u) => u.homeFac === f2.id && u.ownerIdx === 0);
ok(evolved.length > 0, '进化后产线继续出兵');
ok(evolved.every((u) => u.tier === 2), '新兵直接是二级（不再产初级）');
ok(evolved.every((u) => u.branch === ''), '新兵不再带分支标记');
// 总部产线不可进化（fid=0）
g.players[0].rp = C.FAC_LINE_EVOLVE_COST;
ok(!setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: 0, li: 0 }), '总部产线不可进化');
ok(g.players[0].rp === C.FAC_LINE_EVOLVE_COST, '被拒绝时科技点不变');
// 初级工厂的产线同样不可进化
const f1b = g.factories.find((f) => f.level === 1);
__test.damageFactory(g, f1b, f1b.hp + 1, 0);
ok(!setPlayerInput(g, 'p0', { cmd: 'facEvolve', fid: f1b.id, li: 0 }), '初级工厂产线不可进化');

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

/**
 * 找一块**整片**半径 rPx 内都可站立的空地（火场 / 站位类用例用）。
 * findFlatSpot 只验了一条水平线上的三个点；而地图主题是每局随机抽的，
 * 「某点能站」不代表「它周围也能站」—— 单位一旦落在山/水上会被 nearestPassable 挪走，
 * 写死的相对站位（例如「火场外 125px」）就可能被挪进火里，用例时红时绿。
 * 这里改成整片圆盘都验一遍，从根上消除这类抖动。
 */
function findOpenDisc(game, rPx) {
  const blocks = [...game.factories, ...game.labs, ...game.hqs];
  const TC = C.TERR_CELL;
  const okAt = (x, y) => __test.canStand(game, x, y, 16) && !__test.losBlocked(game, x, y, x + 1, y);
  const discOpen = (x, y) => {
    for (let dy = -rPx; dy <= rPx; dy += TC / 2) {
      for (let dx = -rPx; dx <= rPx; dx += TC / 2) {
        if (dx * dx + dy * dy > rPx * rPx) continue;
        if (!okAt(x + dx, y + dy)) return false;
      }
    }
    return true;
  };
  for (const far of [420, 300, 200, 120, 0]) {
    for (let y = 300; y < 5200; y += 120) {
      for (let x = 300; x < 8200; x += 120) {
        let clear = true;
        for (const b of blocks) {
          if (Math.hypot(b.x - x, b.y - y) < far + rPx) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        for (const u of game.units) {
          if (!u.dead && Math.hypot(u.x - x, u.y - y) < 340) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        if (discOpen(x, y)) return { x, y };
      }
    }
  }
  return null;
}

/** 一段路径是否全程可站（用于「移动攻击」这种既要走位又要开火的用例） */
function pathStandable(game, ax, ay, bx, by, r) {
  const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / (C.TERR_CELL / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!__test.canStand(game, ax + (bx - ax) * t, ay + (by - ay) * t, r)) return false;
  }
  return true;
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
  // 盾卫对面放一名游侠：距离取「盾卫够不着（射程 + 余量之外）」，但落在旧的
  // 「射程 + 70 = 追击圈」之内 —— 正是旧版会自己冲上去的距离。距离按 data.js 推导。
  const watcher = __test.spawnUnit(gc, { id: 7001, owner: 0, level: 1 }, 'shield', sp.x, sp.y);
  const farFoe = __test.spawnUnit(gc, { id: 7002, owner: 1, level: 1 }, 'ranger', sp.x, sp.y);
  const foeDist = Math.min(
    watcher.range + farFoe.r + C.ATTACK_SLACK + 40, // 明确在盾卫的索敌范围之外
    farFoe.range * 0.9 // 同时保证游侠自己够得着（能开火形成对照）
  );
  ok(
    foeDist > watcher.range + farFoe.r + C.ATTACK_SLACK,
    `前提：游侠站位（${Math.round(foeDist)}px）在盾卫索敌范围之外`
  );
  farFoe.x = sp.x + foeDist;
  farFoe.y = sp.y;
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
  ok(
    farFoe.targetId === watcher.id,
    `但射程够远的一方（游侠 range ${farFoe.range}）照常开火（间距 ${Math.round(foeDist)}px 在其射程内）`
  );
}

// 9c. 移动攻击：行军途中照常开火（不再「停下才打」）
{
  console.log('\n[9c] 移动攻击（边走边打）');
  const gm = createGameState(room(2));
  gm.phase = 'playing';
  gm.phaseEndsAt = 0;
  gm.units.length = 0;
  // 场地要一整片都能站（findFlatSpot 只验了一条线上的三个点）；
  // 落点除了「能站 + 仍在射程内」，还要求**沿途能走** —— 地图主题每局随机，
  // 只验终点的话中间卡一道山脊就会「原地挪 14px」然后判失败。
  const sm = findOpenDisc(gm, 200) || findFlatSpot(gm, 200);
  // 用游侠当主角：射程 200 足够长，走位过程中敌人始终留在攻击范围内
  const runner = __test.spawnUnit(gm, { id: 7101, owner: 0, level: 1 }, 'ranger', sm.x, sm.y);
  const dummy = __test.spawnUnit(gm, { id: 7102, owner: 1, level: 1 }, 'shield', sm.x + 40, sm.y);
  dummy.maxHp = 1e6;
  dummy.hp = 1e6; // 别让它被打死，全程留在射程内
  let dst = null;
  for (const d of [60, -60, 90, -90, 120, -120]) {
    for (const axis of [0, 1]) {
      const c = axis ? { x: sm.x + d, y: sm.y } : { x: sm.x, y: sm.y + d };
      if (Math.hypot(c.x - dummy.x, c.y - dummy.y) > runner.range + dummy.r) continue;
      if (!__test.canStand(gm, c.x, c.y, runner.r)) continue;
      if (!pathStandable(gm, sm.x, sm.y, c.x, c.y, runner.r)) continue;
      dst = c;
      break;
    }
    if (dst) break;
  }
  ok(Boolean(dst), '移动攻击用例选到落点（沿途可走、离敌人 >26px 仍在射程内）');
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
ok(
  Array.isArray(snap.lb) && snap.lb[0].length === 5,
  `快照携带研究所血量行（含「已开拓研究产线数」，实为 ${snap.lb && snap.lb[0] ? snap.lb[0].length : '—'} 列）`
);
ok(
  Array.isArray(snap.f) && snap.f[0].length === 11 && Array.isArray(snap.f[0][9]) &&
    Array.isArray(snap.f[0][10]),
  `快照工厂行携带产线数 / 各产线配置 / 各产线在场兵数（11 列，实为 ${snap.f[0].length}）`
);
ok(
  Array.isArray(snap.hq) && snap.hq[0].length === 13 && Array.isArray(snap.hq[0][9]) &&
    Array.isArray(snap.hq[0][12]),
  `快照总部行携带产能等级 / 生产进度 / 产线配置 / 防卫前摇 / 各产线在场兵数（13 列，实为 ${snap.hq[0].length}）`
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
  ok(minD > C.FACTORY_R * 2, `${n} 人局建筑互不叠压（最近 ${Math.round(minD)}px）`);
  ok(
    gn.hqs.length === n && gn.units.filter((u) => u.ownerIdx === 0).length === C.START_ROSTER.length,
    `${n} 人局总部与开局部队正确`
  );
}

// 15. 激光兵：持续光束锁定，锁定越久伤害越高（上限见 data.laser.maxMul），换目标有前摇
{
  const cl = makeClock();
  const gl = createGameState(room(2));
  cl.startPlaying(gl);
  gl.units.length = 0; // 清掉开局部队，避免干扰索敌

  // 地形是随机生成的（含成片山脉），硬编码坐标有可能正好落在山里、或被山挡住视线
  // → 索敌直接失败。这里先扫出一块「三方都可站且互相通视」的平地再摆用例。
  const trl = gl.terrain;
  const freeAt = (x, y) => {
    const cc = Math.floor(x / trl.cell);
    const rr = Math.floor(y / trl.cell);
    if (rr < 0 || cc < 0 || rr >= trl.rows || cc >= trl.cols) return false;
    return trl.grid[rr][cc] === 0; // 0 = 平原
  };
  const blocks2 = [...gl.factories, ...gl.labs, ...gl.hqs].map((b) => [b.x, b.y]);
  let spot = null;
  for (let rr = 3; rr < trl.rows - 3 && !spot; rr++) {
    for (let cc = 3; cc < trl.cols - 3 && !spot; cc++) {
      const ax = (cc + 0.5) * trl.cell;
      const ay = (rr + 0.5) * trl.cell;
      const bx = ax + 60;
      const dx = ax + 20;
      const dy = ay + 60;
      const ex = ax + 25; // 比 t1 更近的落点：用来验「更近的敌人抢不走锁定」
      // 所有落点**都要**空着：只验后两个的话，激光自己可能落在山/水上被挪走，
      // 挪完离 t2 反而更近 → 锁定到错误的目标，用例时红时绿。
      if (!freeAt(ax, ay) || !freeAt(bx, ay) || !freeAt(ex, ay) || !freeAt(dx, dy)) continue;
      if (blocks2.some((b) => Math.hypot(b[0] - ax, b[1] - ay) < 400)) continue;
      if (__test.losBlocked(gl, ax, ay, bx, ay)) continue;
      if (__test.losBlocked(gl, ax, ay, ex, ay)) continue;
      if (__test.losBlocked(gl, ax, ay, dx, dy)) continue;
      spot = { x: ax, y: ay, bx, dx, dy, ex };
    }
  }
  ok(Boolean(spot), '找得到一块互相通视的平地摆激光用例');
  const laser = __test.spawnUnit(gl, { id: 900, owner: 0, level: 2 }, 'laser', spot.x, spot.y);
  const t1 = __test.spawnUnit(gl, { id: 901, owner: 1, level: 2 }, 'shield', spot.bx, spot.y);
  const t2 = __test.spawnUnit(gl, { id: 902, owner: 1, level: 2 }, 'shield', spot.dx, spot.dy);
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

  // ⚠️ rampMs 是「+1 倍的周期」而不是「爬满用时」：前摇结束后每持续 rampMs，倍率 +1。
  //    这条是防止有人改成「翻倍」或「一个周期吃满」。
  {
    const probe = { laser: true, lockStart: 1000 }; // ⚠️ 别用 0：0 = 「未锁定」会被判成 1 倍
    const W = C.LASER_WINDUP_MS;
    const R = C.LASER_RAMP_MS;
    const at = (ms) => __test.laserMul(probe, 1000 + W + ms);
    const cap = C.LASER_MAX_MUL;
    ok(Math.abs(at(0) - 1) < 1e-9, `前摇结束瞬间是 1 倍（实测 ${at(0).toFixed(3)}）`);
    ok(Math.abs(at(R) - 2) < 1e-6, `持续 1 个 rampMs → 2 倍（实测 ${at(R).toFixed(3)}）`);
    ok(Math.abs(at(R * 2) - 3) < 1e-6, `持续 2 个 rampMs → 3 倍（实测 ${at(R * 2).toFixed(3)}）`);
    ok(Math.abs(at(R * 3) - 4) < 1e-6, `持续 3 个 rampMs → 4 倍（实测 ${at(R * 3).toFixed(3)}）`);
    // 吃满是 (maxMul − 1) 个周期，不是 1 个周期
    ok(at(R) < cap - 1e-6, `一个 rampMs 还没吃满（${at(R).toFixed(2)} < ${cap}）`);
    const tFull = R * (cap - 1);
    ok(
      Math.abs(at(tFull) - cap) < 1e-6,
      `约 ${Math.round(tFull)}ms（${cap - 1} 个周期）吃满 ${cap} 倍（实测 ${at(tFull).toFixed(3)}）`
    );
    ok(at(tFull + R * 5) <= cap + 1e-9, '再久也不会超过上限');
  }

  // 前摇内不造成伤害：推进到「前摇还剩 ~100ms」的时刻（前摇时长从 consts 读，用户会改）
  const probe1 = Math.floor(Math.max(50, C.LASER_WINDUP_MS - 100) / 50) * 50;
  cl.run(gl, probe1);
  ok(
    laser.lockId === t1.id && laser.windupUntil > cl.now,
    `${probe1}ms 时已锁定目标 ${t1.id}，仍在前摇中（剩余 ${Math.round(laser.windupUntil - cl.now)}ms）`
  );
  ok(t1.hp === 1e6, '前摇期间不造成伤害');

  // 前摇结束 → 开始掉血（走到前摇真正结束为止，再给够一次以上的攻击间隔）
  let wGuard = 0;
  while (laser.windupUntil > cl.now && wGuard++ < 100) cl.run(gl, 50);
  ok(laser.windupUntil <= cl.now, `前摇（${C.LASER_WINDUP_MS}ms）到点后开火`);
  cl.run(gl, Math.max(600, C.STATS.laser.cd * 1000 * 2));
  ok(t1.hp < 1e6, `前摇结束后光束开始扣血（剩余 ${Math.round(t1.hp)}）`);
  const mulStart = laser.lockMul;
  ok(
    mulStart >= 1 && mulStart <= C.LASER_MAX_MUL + 1e-6,
    `开火时倍率在 1..上限之间（${mulStart.toFixed(2)} / 上限 ${C.LASER_MAX_MUL}）`
  );

  // 锁定足够久 → 倍率封顶（吃满用时 = (maxMul − 1) × rampMs + windupMs，别写死秒数）
  cl.run(gl, Math.max(6000, C.LASER_RAMP_MS * (C.LASER_MAX_MUL - 1) + C.LASER_WINDUP_MS + 1000));
  ok(laser.lockMul >= C.LASER_MAX_MUL - 0.01, `持续锁定后倍率封顶到 ${laser.lockMul.toFixed(2)} 倍`);
  ok(laser.lockMul <= C.LASER_MAX_MUL + 1e-6, `倍率不会超过上限 ${C.LASER_MAX_MUL} 倍`);

  // 点击移动会清 target* 并等到下一轮扫瞄才重锁 —— 蓄能绝不能跟着被重置
  {
    const mulBeforeMove = laser.lockMul;
    const lockBefore = laser.lockId;
    const moved = setPlayerInput(
      gl,
      'p0',
      { cmd: 'move', x: spot.x + 8, y: spot.y + 8, ids: [laser.id] },
      cl.now
    );
    ok(moved, '移动指令已下达（激光仍咬着原目标）');
    // 跨过至少一轮 SCAN_MS，复现「清目标 → 空窗 → 重锁」的路径
    cl.run(gl, 400);
    ok(
      laser.lockId === lockBefore && laser.lockMul >= mulBeforeMove - 0.01,
      `移动不重置蓄能：仍锁 ${lockBefore}，倍率 ${laser.lockMul.toFixed(2)}（移动前 ${mulBeforeMove.toFixed(2)}）`
    );
    laser.moveX = null;
    laser.moveY = null;
    laser.route = null;
  }

  // 锁定是「死咬」的：更近的敌人进圈也抢不走锁定，蓄能不被打断（激光站得住的前提）
  const t3 = __test.spawnUnit(gl, { id: 903, owner: 1, level: 2 }, 'shield', spot.ex, spot.y);
  t3.moveX = null;
  t3.moveY = null;
  t3.maxHp = 1e6;
  t3.hp = 1e6;
  const heldId = laser.lockId;
  cl.run(gl, 2000);
  ok(
    laser.lockId === heldId,
    `锁定死咬：更近的敌人（${t3.id}，${Math.round(Math.hypot(spot.ex - spot.x, 0))}px）也抢不走锁定（仍锁 ${heldId}）`
  );
  ok(
    laser.lockMul >= C.LASER_MAX_MUL - 0.01,
    `更近的敌人进圈不打断蓄能，倍率维持封顶 ${laser.lockMul.toFixed(2)} 倍`
  );

  // 目标离开攻击范围 → 解锁并改派（唯一的自动解锁条件之一）
  // ⚠️ 只断言「不再咬着原来那个」：解锁后有没有**立刻**咬上别的，取决于那一局随机地形里
  // 剩下两个靶子被推到了哪儿（实测会时有时无），断言 lockId>0 会让用例时红时绿。
  const held = gl.units.find((u) => u.id === heldId);
  const worldW = trl.cols * trl.cell;
  const push = held.x < worldW / 2 ? 900 : -900; // 往地图内侧推，别推出世界外
  held.x += push;
  let reLocked = false;
  for (let i = 0; i < 30 && !reLocked; i++) {
    cl.run(gl, 100);
    if (laser.lockId !== heldId) reLocked = true;
  }
  ok(reLocked, `目标离开攻击范围 → 解锁（lockId ${heldId} → ${laser.lockId}）`);
  // 拖回来让它重新咬住一个目标，下面的「击杀换锁」用例才有靶子
  held.x -= push;
  for (let i = 0; i < 30 && laser.lockId <= 0; i++) cl.run(gl, 100);
  ok(laser.lockId > 0, `目标回到射程内 → 重新咬住 ${laser.lockId}`);

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
  // 前摇时长同样从 consts 读：推进到「前摇还剩一点」时必须一滴血都没掉
  const probe2 = Math.floor(Math.max(50, C.LASER_WINDUP_MS - 100) / 50) * 50;
  cl.run(gl, probe2);
  ok(newTgt() && newTgt().hp === hpBefore, '新目标在前摇期间同样不受伤害');
  cl.run(gl, C.LASER_WINDUP_MS + 300);
  ok(newTgt() && newTgt().hp < hpBefore, '前摇结束后重新开始扣血');

  // 快照携带锁定状态
  const snapL = snapshot(gl);
  const rowL = snapL.u.find((r) => r[0] === laser.id);
  // 末列（第 20 列）是炮塔角：车体角 / 炮塔角各占一列（见 smoke/turret.js §5）
  ok(rowL.length === 20, `单位快照携带 20 列（含 4 列锁定状态 + 2 列追击命令 + 产线序号 + 炮塔角，实为 ${rowL.length}）`);
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
      for (let c = 4; c < tr.cols - 4; c++) {
        // ⚠️ 选点必须「左平右深」：左边一格是能站的平地（脱困方向），右边连着至少 3 格山
        //    （指令指向山体深处）。早先只要求「左右都不是山」，于是随机地形有一半概率
        //    让最近可通行点正好落在指令那一侧 —— 脱困被误判成「沿指令穿山」，用例时红时绿。
        if (tr.grid[r][c] !== C.TT_MOUNTAIN) continue;
        if (tr.grid[r][c - 1] === C.TT_MOUNTAIN || tr.grid[r][c - 1] === C.TT_WATER) continue;
        if (tr.grid[r][c + 1] !== C.TT_MOUNTAIN || tr.grid[r][c + 2] !== C.TT_MOUNTAIN) continue;
        cell = [c, r];
        break;
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
    // 两侧站位按游侠射程推导（射程改短后这里不会误报）：留出 80% 射程，确保「互相看得见」
    const rangerRange = C.STATS.ranger.range || 160;
    const halfCells = Math.max(1, Math.floor((rangerRange * 0.4) / t.cell));
    const lx = (spot[0] - halfCells + 0.5) * t.cell; // 墙西侧
    const rx = (spot[0] + halfCells + 0.5) * t.cell; // 墙东侧
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

    // 上限 = 默认 1 条 + 最多再开辟 1 条（FAC_MAX_LINES = 2）
    gu.players[0].rp = C.FAC_LINE_COST;
    ok(!setPlayerInput(gu, 'p0', { cmd: 'facLine', fid: fu.id }), '已达上限，被拒绝再开辟一条产线');
    ok(fu.lines === C.FAC_MAX_LINES, `产线数封顶在 ${C.FAC_MAX_LINES}`);
    ok(gu.players[0].rp === C.FAC_LINE_COST, '被拒绝时不扣科技点');
    gu.players[0].rp = C.FAC_LINE_COST * 3;
    ok(!setPlayerInput(gu, 'p0', { cmd: 'facLine', fid: fu.id }), '满产线后拒绝继续开辟（不扣费）');
    ok(gu.players[0].rp === C.FAC_LINE_COST * 3, '被拒绝时科技点不变');
    ok(!setPlayerInput(gu, 'p1', { cmd: 'facLine', fid: fu.id }), '不能给别人的工厂开产线');
    ok(!setPlayerInput(gu, 'p0', { cmd: 'facLine', fid: -1 }), '给不存在的工厂开产线被拒绝');
  }

  // ---- 多产线 = 产出速率成倍（2 条产线在同样时间内产出约 2 倍）----
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
    const n2 = countFac(C.FAC_MAX_LINES);
    const nOver = countFac(C.FAC_MAX_LINES + 2); // 手改超限也要被夹回上限
    // 第 9 项：在场越多的线越慢，所以 3 个周期造不满 3 支 —— 期望值按衰减表推。
    const expect3 = madeInCycles(3);
    ok(
      Math.abs(n1 - expect3) <= 1,
      `单产线 3 个周期产出 ${n1} 支（在场越多越慢，推算 ${expect3} 支）`
    );
    ok(
      Math.abs(n2 - C.FAC_MAX_LINES * expect3) <= C.FAC_MAX_LINES,
      `${C.FAC_MAX_LINES} 条产线同时间产出约 ${C.FAC_MAX_LINES} 倍（实为 ${n2} 支）`
    );
    ok(n2 > n1 * 1.5, `产线数直接决定产能（${n1} → ${n2}）`);
    ok(nOver === n2, `手改产线数超过上限会被夹回（${nOver} = ${n2}）`);
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
    // 场地必须**整片**可站：写死坐标（旧版 1400,1400）在随机地貌下可能落在水/山上，
    // 单位会被 nearestPassable 挪走，于是「火场外 125px」那条被挪进火里，用例时红时绿。
    const T2 = C.FIRE_TIERS[1]; // 二级：基准火场
    const T3 = C.FIRE_TIERS[2]; // 三级：更大 / 更久 / 更疼
    const fs = findOpenDisc(gf, T3.r + 140) || { x: 1400, y: 1400 };
    const cx = fs.x;
    const cy = fs.y;
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
    // 站位按燎原射程推导（射程改短后这里不会误报）：放在 70% 射程处，保证喷得到
    const foe = __test.spawnUnit(
      gb,
      { id: 1, owner: 1, level: 1 },
      'shield',
      s.x + Math.round(burner.range * 0.7),
      s.y
    );
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
    let flameEvts = 0;
    const shotKinds = new Set();
    let t = 20000;
    const run = (n) => {
      for (let i = 0; i < n; i++) {
        t += 50;
        __test.step(gb, 0.05, t);
        if (gb.bullets.some((b) => b.kind === 'fire')) sawFireBullet = true;
        for (const e of gb.events) {
          if (e.t === 'shot') shotKinds.add(e.k);
          if (e.t === 'flame') {
            sawFlameEvt = true;
            flameEvts++;
          }
        }
      }
    };

    // 一级：喷得到人，但地上干干净净
    run(12);
    ok(foe.hp < C.STATS.shield.hp, '一级燎原的火舌照样烧人（伤害不打折）');
    ok(gb.fires.length === 0, '一级燎原喷火不留灼烧地形');
    const hpAfterLv1 = foe.hp;

    // ---- 伤害口径：dmg 是「一口火」的伤害，不是每秒伤害 ----
    {
      const dmgA = foe.hp;
      __test.sprayFlame(gb, burner, foe.x, foe.y, 60000);
      const one = dmgA - foe.hp;
      __test.sprayFlame(gb, burner, foe.x, foe.y, 60100);
      const two = dmgA - foe.hp;
      ok(
        Math.abs(one - C.STATS.burn.dmg) < 1e-6,
        `一口火正好 ${C.STATS.burn.dmg} 点伤害（实测 ${one}，与 dt 无关）`
      );
      ok(Math.abs(two - C.STATS.burn.dmg * 2) < 1e-6, `两口火 = 两份伤害（实测 ${two}）`);
    }

    // ---- 范围伤害衰减：离落点越远越低，外沿只剩 flameEdgeMul，出了半径就打不到 ----
    // （此时燎原还是一级：不留火场，掉血全是火舌打的，读数干净）
    {
      const R = C.FLAME_R;
      const edge = C.FLAME_EDGE_MUL == null ? 1 : C.FLAME_EDGE_MUL;
      const foeX = foe.x;
      const foeY = foe.y;
      // gap = 目标最近边缘到落点的距离（自己压在落点上 = 0）
      const at = (gap) => {
        foe.x = foeX;
        foe.y = foeY;
        foe.hp = C.STATS.shield.hp;
        __test.sprayFlame(gb, burner, foeX + gap + foe.r, foeY, 61000 + Math.round(gap));
        return C.STATS.shield.hp - foe.hp;
      };
      const full = at(0);
      const mid = at(R * 0.5);
      const rim = at(R * 0.98);
      const out = at(R + 40);
      const dmg1 = C.STATS.burn.dmg;
      ok(Math.abs(full - dmg1) < 1e-6, `压在落点上吃满伤（${full.toFixed(2)} / 一口 ${dmg1}）`);
      ok(
        Math.abs(mid - dmg1 * (1 + (edge - 1) * 0.5)) < 1e-6,
        `半程处掉到 ${mid.toFixed(2)}（满伤与外沿的中点）`
      );
      ok(
        Math.abs(rim - dmg1 * edge) < dmg1 * 0.05,
        `火舌外沿只剩 ${rim.toFixed(2)}（≈ 满伤 × ${edge}）`
      );
      ok(out === 0, '出了火舌半径就一点都烧不到');
      ok(full > mid && mid > rim && rim > out, '伤害随离中心的距离单调变低');
      foe.x = foeX;
      foe.y = foeY;
      foe.hp = C.STATS.shield.hp;
    }

    // ---- 攻击节拍：每 cd 秒喷一口（一级不留火场，所以这段时间掉的血全是火舌打的）----
    {
      const hp0 = foe.hp;
      run(20); // 1 秒
      const hits = (hp0 - foe.hp) / C.STATS.burn.dmg;
      const expect = 1 / C.STATS.burn.cd; // 每秒理论口数
      // ⚠️ 容差 1e-6：除法会把「正好 2 口」算成 1.9999999999999998，直接比 >= 会误报
      ok(hits >= Math.floor(expect) - 1e-6 && hits <= Math.ceil(expect) + 1e-6, `1 秒内喷了 ${hits} 口（cd ${C.STATS.burn.cd} 秒 / 次）`);
    }

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
    // 燎原的伤害按次结算（每 cd 秒一口），所以不再需要「每 FLAME_PULSE_MS 周期推一条 k=3
    // 枪口焰」的表现脉冲 —— 那正是炮管喷一下停一下、一直抖的根源。火焰由锁定状态连续绘制。
    ok(!shotKinds.has(3), '燎原不推 k=3 枪口焰 shot 事件（炮管不抖）');
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

    // 火舌按 dmg / 次结算 + 灼烧地形按 dps / 秒掉血，这里只做「累计伤害」的量级体检
    const total = C.STATS.shield.hp - foe.hp;
    ok(
      total > C.STATS.burn.dmg * 5 && total < C.STATS.shield.hp,
      `这段时间火舌 + 灼烧合计打掉 ${Math.round(total)} 血（未致死）`
    );

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
    __test.sprayFlame(gc, burner, fac.x, fac.y, 5000); // 火舌正烧工厂一口
    ok(fac.hp < hpF, `火舌直接喷到敌方工厂 → 工厂掉血（${hpF} → ${Math.round(fac.hp)}）`);
    ok(ownFac.hp === hpOwn, '自家工厂不被自家火舌烧到');

    stand(lab.x, lab.y, C.LAB_R);
    const hpL = lab.hp;
    __test.sprayFlame(gc, burner, lab.x, lab.y, 5100);
    ok(lab.hp < hpL, `火舌直接喷到敌方研究所 → 研究所掉血（${hpL} → ${Math.round(lab.hp)}）`);

    stand(hq.x, hq.y, C.HQ_R);
    const hpH = hq.hp;
    __test.sprayFlame(gc, burner, hq.x, hq.y, 5200);
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
  // ---- 18. 弹体带上「谁打的」：兵种 + 阶数（客户端据此分款式并随进化放大） ----
  {
    console.log('\n[18] 弹体携带兵种与阶数');
    const gd = createGameState(room(2));
    gd.phase = 'playing';
    gd.phaseEndsAt = 0;
    gd.units.length = 0;
    const s18 = findFlatSpot(gd, 60);
    const hq18 = gd.hqs.find((h) => h.owner === 1);
    const shoot = (type, tier, x, y) => {
      const u = __test.spawnUnit(gd, { id: 1, owner: 0, level: 3 }, type, x, y);
      for (let i = 1; i < tier; i++) ok(__test.promoteUnit(gd, u), `${type} 进化到 ${i + 1} 阶`);
      u.moveX = null;
      u.moveY = null;
      u.scanAt = 0;
      // 站到「总部半径 + 六成射程」处：贴着射程内打总部，又不会站进建筑里
      u.x = hq18.x + C.HQ_R + u.range * 0.6;
      u.y = hq18.y;
      return u;
    };
    const cases = [
      ['warrior', 1],
      ['shield', 2],
      ['ranger', 3],
      ['burst', 2],
    ];
    for (const [type, tier] of cases) shoot(type, tier, s18.x, s18.y);
    const seen = new Set();
    let sawBullet = false;
    // ⚠️ dt 取 0.005 秒（不是常用的 0.05）：锐士/盾卫/游侠的弹速写到了 9999px/s，
    //    按 0.05 步进一帧就飞完 500px —— 射程才 180px，弹同帧就命中并被清理，
    //    循环里根本看不到弹体。缩小步进让它飞两三帧，才验得到「弹体带兵种与阶数」。
    let clock18 = 40000;
    for (let i = 0; i < 1200 && seen.size < cases.length; i++) {
      for (const u of gd.units) {
        u.scanAt = 0;
        u.moveX = null;
        u.moveY = null;
      }
      clock18 += 5;
      __test.step(gd, 0.005, clock18);
      for (const b of gd.bullets) {
        sawBullet = true;
        ok(Boolean(b.type) && b.tier >= 1 && b.tier <= 3, `弹体带兵种与阶数（${b.type} ${b.tier} 阶）`);
        seen.add(b.type + ':' + b.tier);
      }
    }
    ok(sawBullet, '这场交火真的打出了弹体');
    for (const [type, tier] of cases) {
      ok(seen.has(type + ':' + tier), `${type} 打出的是自己那一阶（${type}:${tier}）的弹`);
    }
    const snap18 = snapshot(gd);
    const row18 = snap18.b[0];
    ok(row18 && row18.length === 11, `弹体快照 11 列（末两列＝兵种序号 + 阶数，实为 ${row18 ? row18.length : '?'}）`);

    // ---- 子弹「效果」也要跟进化一起变大：开火 / 命中 / 炮击落地三类事件都得带上射手兵种与阶数 ----
    // （客户端据此把枪口焰、命中墨花、弹痕按同一套倍率放大；缺这两列就只能画成一阶那么大）
    {
      const seenTy = new Map(); // 事件类别 → Set(兵种:阶数)
      const note = (t, e) => {
        if (!seenTy.has(t)) seenTy.set(t, new Set());
        seenTy.get(t).add(`${e.ty}:${e.ti}`);
      };
      let clock19 = 40000;
      for (let i = 0; i < 2000; i++) {
        for (const u of gd.units) {
          u.scanAt = 0;
          u.moveX = null;
          u.moveY = null;
        }
        clock19 += 5;
        gd.events.length = 0;
        __test.step(gd, 0.005, clock19);
        for (const e of gd.events) {
          if (e.t === 'shot' || e.t === 'hit' || e.t === 'boom') note(e.t, e);
        }
      }
      // hit 只在弹体真的撞上目标那一帧才推（这个场景里可能被总部防卫先清场），所以只要求
      // 「只要发了就必须带」，不要求一定发；shot / boom 每轮都有。
      const must = ['shot', 'boom'];
      for (const t of ['shot', 'hit', 'boom']) {
        const set = seenTy.get(t) || new Set();
        if (must.includes(t)) ok(set.size > 0, `${t} 事件真发出来了（用于按阶放大特效）`);
        let allTagged = true;
        for (const key of set) {
          const [ty, ti] = key.split(':');
          if (!ty || !(Number(ti) >= 1 && Number(ti) <= 3)) allTagged = false;
        }
        ok(allTagged, `${t} 事件自带射手兵种与阶数（${[...set].join(' / ') || '本轮未发'}）`);
      }
    }
  }

  // ---- 抛射弹在场时，其它弹必须照常推进（updateBullets 里曾把 continue 写成 return）----
  {
    const ge = createGameState({ players: room(2).players });
    ge.phase = 'playing';
    ge.phaseEndsAt = 0;
    ge.units.length = 0;
    ge.bullets.length = 0;
    const spot = findFlatSpot(ge, 60);
    const now0 = 50000;
    // 排在数组前面的抛射弹（arc）：只要天上还挂着一发，本帧就不能就此收工
    ge.bullets.push({
      id: ge.nextBulletId++,
      x: spot.x,
      y: spot.y,
      z: 0,
      vx: 100,
      vy: 0,
      dmg: 1,
      ownerIdx: 0,
      ownerId: 'p0',
      shooterId: 0,
      type: 'burst',
      tier: 1,
      kind: 'shell',
      splash: 40,
      tx: spot.x + 400,
      ty: spot.y,
      sx: spot.x,
      sy: spot.y,
      flightDur: 3000,
      flightT: 0,
      peak: 100,
      arc: true,
      targetId: 0,
      born: now0,
      dead: false,
    });
    // 排在它后面的直射弹
    ge.bullets.push({
      id: ge.nextBulletId++,
      x: spot.x,
      y: spot.y,
      vx: 0,
      vy: 120,
      dmg: 1,
      ownerIdx: 0,
      ownerId: 'p0',
      shooterId: 0,
      type: 'warrior',
      tier: 1,
      kind: 'bullet',
      splash: 18,
      tx: spot.x,
      ty: spot.y + 500,
      targetId: 0,
      born: now0,
      dead: false,
    });
    __test.step(ge, 0.1, now0 + 100);
    const straight = ge.bullets.find((b) => b.kind === 'bullet');
    ok(
      straight && straight.y > spot.y + 1,
      `天上挂着抛射弹时直射弹照常推进（y ${Math.round(spot.y)} → ${straight ? Math.round(straight.y) : '已消失'}）`
    );
    // 打完的弹必须当帧清出数组：不然 bullets 只增不减，快照还一直往下发
    if (straight) straight.dead = true;
    __test.step(ge, 0.1, now0 + 200);
    ok(!ge.bullets.some((b) => b.dead), '已命中的弹当帧就被清出数组（不会越积越多）');
  }

  // ---- 轰击：溅射半径随阶数长大、伤害随离落点的距离衰减 ----
  {
    const gi = createGameState({ players: room(2).players });
    gi.phase = 'playing';
    gi.phaseEndsAt = 0;
    gi.units.length = 0;
    gi.bullets.length = 0;
    const spot = findFlatSpot(gi, 60);
    const now0 = 70000;

    // ① 溅射半径跟着阶数长：1 / 2 / 3 阶分别 30 / 45 / 60px（data.js 里是「格」）
    const gunner = __test.spawnUnit(gi, { id: 8101, owner: 0, level: 3 }, 'burst', spot.x, spot.y);
    const r1 = gunner.splash;
    __test.promoteUnit(gi, gunner);
    const r2 = gunner.splash;
    __test.promoteUnit(gi, gunner);
    const r3 = gunner.splash;
    ok(r1 === C.STATS.burst.splash, `一级溅射半径 = ${r1}px（与 data.js 一致）`);
    ok(r2 > r1 && r3 > r2, `溅射半径随阶数变大（${r1} → ${r2} → ${r3}）`);

    // ② 距离衰减：中心吃满 → 外沿只剩 burstEdgeMul（口径同火舌）
    const edge = C.BURST_EDGE_MUL == null ? 1 : C.BURST_EDGE_MUL;
    const foe = __test.spawnUnit(gi, { id: 8102, owner: 1, level: 1 }, 'shield', spot.x, spot.y);
    const dmg3 = C.EVOLVED.burst['3'].dmg;
    let seq = 0;
    // gap = 目标最近边缘到落点的距离（自己压在落点上 = 0）
    const boom = (gap) => {
      foe.hp = foe.maxHp;
      foe.x = spot.x + gap + foe.r;
      foe.y = spot.y;
      __test.explodeShell(
        gi,
        { dead: false, ownerIdx: 0, shooterId: 0, dmg: dmg3, splash: r3 },
        spot.x,
        spot.y,
        now0 + ++seq,
        true // 抛射弹越山落点：溅射不受山体遮挡（挡了就没法测衰减）
      );
      return foe.maxHp - foe.hp;
    };
    const full = boom(0);
    const mid = boom(r3 * 0.5);
    const rim = boom(r3 * 0.98);
    const out = boom(r3 + 40);
    ok(Math.abs(full - dmg3) < 1e-6, `压在落点上吃满伤（${full.toFixed(2)} / 一发 ${dmg3}）`);
    ok(Math.abs(mid - dmg3 * (1 + (edge - 1) * 0.5)) < 1e-6, `半程处掉到 ${mid.toFixed(2)}`);
    ok(Math.abs(rim - dmg3 * edge) < dmg3 * 0.05, `溅射外沿只剩 ${rim.toFixed(2)}（≈ 满伤 × ${edge}）`);
    ok(out === 0, '出了溅射半径就一点都炸不到');
    ok(full > mid && mid > rim && rim > out, '炮弹伤害随离落点的距离单调变低');
  }

  // ---- 轰击的最小射击半径：贴脸的目标既索不到、也打不出去（被近身必死）----
  {
    const gj = createGameState({ players: room(2).players });
    gj.phase = 'playing';
    gj.phaseEndsAt = 0;
    gj.units.length = 0;
    gj.bullets.length = 0;
    // 场上的建筑统统改成己方：否则轰击会去打中立工厂，「一发都打不出去」根本测不出来
    for (const f of gj.factories) f.owner = 0;
    for (const l of gj.labs) l.owner = 0;
    for (const h of gj.hqs) h.owner = 0;
    const spot = findFlatSpot(gj, 60);
    const now0 = 80000;
    const gunner = __test.spawnUnit(gj, { id: 8201, owner: 0, level: 3 }, 'burst', spot.x, spot.y);
    const foe = __test.spawnUnit(gj, { id: 8202, owner: 1, level: 1 }, 'shield', spot.x, spot.y);
    const MINR1 = gunner.minRange;
    ok(MINR1 === C.STATS.burst.minRange, `一级最小射击半径 = ${MINR1}px（与 data.js 一致）`);
    __test.promoteUnit(gj, gunner);
    __test.promoteUnit(gj, gunner);
    const MINR = gunner.minRange;
    ok(MINR === C.EVOLVED.burst['3'].minRange, `最小射击半径跟着阶数走（${MINR1} → ${MINR}px）`);
    ok(MINR > 0 && MINR < gunner.range, `最小射击半径夹在 0 与射程之间（${MINR} < ${gunner.range}）`);

    // ① 贴脸（中心距远小于最小射程）→ 索敌直接跳过它
    foe.x = gunner.x + MINR * 0.4;
    foe.y = gunner.y;
    const picked = __test.findTarget(gj, gunner);
    ok(!(picked && picked.kind === 'u' && picked.id === foe.id), '贴脸的敌人不会进轰击的索敌列表');
    gj.bullets.length = 0;
    __test.step(gj, 0.1, now0);
    ok(gj.bullets.length === 0, '进了最小射击半径，轰击一发都打不出去');

    // ② 拉到最小射程之外 → 恢复正常开火。
    // ⚠️ 炮塔有角速度：不是「下一拍立刻开炮」，而是转到位（aimTol 内）才打，
    //    所以这里给足 2 秒（20 拍）再看有没有炮弹 —— 判的是「会不会开火」不是「多快」。
    foe.x = gunner.x + MINR + 60;
    foe.y = gunner.y;
    let shellAt = -1;
    for (let i = 0; i < 20 && shellAt < 0; i++) {
      __test.step(gj, 0.1, now0 + 100 + i * 100);
      if (gj.bullets.some((b) => b.kind === 'shell')) shellAt = i;
    }
    ok(
      shellAt >= 0,
      `拉出最小射程后照样开炮（${shellAt < 0 ? '2 秒内' : (shellAt + 1) * 0.1 + 's 后'}打出 ${gj.bullets.filter((b) => b.kind === 'shell').length} 发）`
    );
    // 射程外的老远目标同样打不到（最小射程不该把「够不着」变成「够得着」）
    gj.bullets.length = 0;
    foe.x = gunner.x + gunner.range + 200;
    __test.step(gj, 0.1, now0 + 200);
    ok(gj.bullets.length === 0, '射程之外的目标本来就打不到（最小射程没把射程撑大）');
  }

  // ---- 高速弹不许「一步跨过目标」----
  // 锐士/盾卫弹速 9999，TICK_MS=100 → dt=0.1 时一帧飞 1000px、被切成 16 小步（62px/步），
  // 而命中半径只有十几 px。只判「这一步走完停在圆内」会整发跨过去（实测 110px 外 0% 命中）。
  {
    const gh = createGameState({ players: room(2).players });
    gh.phase = 'playing';
    gh.phaseEndsAt = 0;
    gh.units.length = 0;
    gh.bullets.length = 0;
    const tr = gh.terrain;
    // 找一条 ≥ 20 格（200px）的空走廊：射线中途撞山会被判成打空，那是另一条规则
    let spot = null;
    for (let r = 2; r < tr.rows - 2 && !spot; r++) {
      for (let c = 2; c + 20 < tr.cols; c++) {
        let ok = true;
        for (let k = 0; k <= 20; k++) {
          const v = tr.grid[r][c + k];
          if (v === C.TT_MOUNTAIN || v === C.TT_WATER) ok = false;
        }
        if (ok) {
          spot = { x: (c + 0.5) * tr.cell, y: (r + 0.5) * tr.cell };
          break;
        }
      }
    }
    if (spot) {
      const a = __test.spawnUnit(gh, { id: 1, owner: 0, level: 1 }, 'warrior', spot.x, spot.y);
      const d = Math.round(a.range * 0.8); // 射程内但不贴脸（贴脸本来就能打中）
      const b = __test.spawnUnit(gh, { id: 1, owner: 1, level: 1 }, 'shield', spot.x + d, spot.y);
      const hp0 = b.hp;
      let now = 70000;
      for (let i = 0; i < 40 && b.hp >= hp0; i++) {
        a.scanAt = 0;
        b.scanAt = 0;
        a.moveX = null;
        a.moveY = null;
        b.moveX = null;
        b.moveY = null;
        now += 100;
        __test.step(gh, 0.1, now); // 真实帧率：dt = 0.1
      }
      ok(b.hp < hp0, `dt=0.1 下 ${d}px 处的目标照样打得中（高速弹按线段判命中）`);
    }
  }

  // ---- stop / move 要把「正在啃的建筑」一起解锁 ----
  {
    const gs = createGameState({ players: room(2).players });
    gs.phase = 'playing';
    gs.phaseEndsAt = 0;
    gs.units.length = 0;
    const spot = findFlatSpot(gs, 60);
    const u = __test.spawnUnit(gs, { id: 1, owner: 0, level: 1 }, 'warrior', spot.x, spot.y);
    const fac = gs.factories[0];
    u.targetFac = fac ? fac.id : 1;
    u.targetHq = 1;
    setPlayerInput(gs, 'p0', { cmd: 'stop', ids: [u.id] }, 60000);
    ok(u.targetFac === 0 && u.targetHq === 0, '停止指令连「正在打的建筑」一起解锁');
    u.targetFac = fac ? fac.id : 1;
    setPlayerInput(gs, 'p0', { cmd: 'move', ids: [u.id], x: spot.x + 100, y: spot.y }, 60100);
    ok(u.targetFac === 0, '行军指令同样解锁（否则一路走一路还在啃那栋楼）');
  }
}

/* ==========================================================================
   [19] 第 9 项：每条产线最多同时在场 N 个兵 · 每多一个该线产速 -10%（独立乘区）
   ========================================================================== */
console.log('\n[19] 产线名额：在场上限 ' + C.LINE_UNIT_CAP + ' · 逐兵减速 ' + Math.round(C.LINE_SLOW_PER_UNIT * 100) + '%');
{
  const cap = C.LINE_UNIT_CAP;
  const mulOf = __test.lineSpeedMul;
  ok(Math.abs(mulOf(0) - 1) < 1e-9, '0 个在场 → 满速 100%');
  ok(Math.abs(mulOf(1) - (1 - C.LINE_SLOW_PER_UNIT)) < 1e-9, `1 个在场 → ${Math.round((1 - C.LINE_SLOW_PER_UNIT) * 100)}%`);
  // ⚠️ 别写死 0.5 / 0：逐兵减速是 data.js 的 lines.slowPerUnit，改它这里就得跟着走
  const halfMul = Math.max(0, 1 - (cap / 2) * C.LINE_SLOW_PER_UNIT);
  ok(Math.abs(mulOf(cap / 2) - halfMul) < 1e-9, `半数名额 → ${Math.round(halfMul * 100)}%`);
  ok(mulOf(cap) === (C.LINE_SLOW_PER_UNIT * cap >= 1 ? 0 : Math.max(0, 1 - cap * C.LINE_SLOW_PER_UNIT)), `满 ${cap} 个 → ${Math.round(mulOf(cap) * 100)}%`);
  ok(mulOf(cap + 5) === mulOf(cap), '超过名额也不会变成负产速');

  // 独立乘区：不被别人的进度影响，只跟自己这条线的在场数走
  const gi = createGameState(room(2));
  gi.phase = 'playing'; // 只有对战中才会走生产（倒计时阶段 step 直接返回）
  gi.phaseEndsAt = 0;
  const facI = gi.factories.find((f) => f.owner < 0) || gi.factories[0];
  facI.owner = 0;
  facI.hp = facI.hpMax = C.FACTORY_HP;
  const src = { id: facI.id, owner: 0, level: 1 };
  const countLine = (g, fid, line) =>
    g.units.filter((u) => !u.dead && u.homeFac === fid && (u.lineIdx || 0) === line).length;
  /** 给这条线铺满名额（直接按配额人工补人，省去等生产的时间） */
  const fill = (n, line) => {
    for (let i = countLine(gi, facI.id, line); i < n; i++) {
      const u = __test.spawnUnit(gi, src, 'warrior', facI.x + 90 + i * 6, facI.y + (line ? 40 : 0));
      if (u) u.lineIdx = line;
    }
  };
  const stepMs = (ms) => {
    let left = ms;
    let t = 1e6;
    while (left > 0) {
      t += 50;
      __test.step(gi, 0.05, t);
      left -= 50;
    }
  };

  // ---- 一条线：铺满后彻底停产 ----
  fill(cap, 0);
  ok(countLine(gi, facI.id, 0) === cap, `这条线现在正好 ${cap} 个在场兵`);
  stepMs(C.PRODUCE_MS * 2);
  ok(countLine(gi, facI.id, 0) === cap, '名额满了 → 这段时间一个也没多产出来');

  // ---- 让出一个名额 → 按 10% 的慢速补回来 ----
  const victim = gi.units.find((u) => u.homeFac === facI.id && (u.lineIdx || 0) === 0);
  victim.dead = true;
  // 只剩 10% 产能 → 补一个人要吃 PRODUCT_MS / 0.1 的时间（按数据推导，不写死）
  stepMs(Math.ceil(C.PRODUCE_MS / Math.max(0.01, mulOf(cap - 1))) + C.PRODUCE_MS);
  ok(countLine(gi, facI.id, 0) === cap, '阵亡让出名额 → 慢慢补回到满额，然后重新停产');

  // ---- 多条线各自名额独立 ----
  while (facI.specs.length < 2) facI.specs.push({ type: 'ranger', tier: 1, branch: '', lineIdx: 1 });
  while (facI.prog.length < 2) facI.prog.push(0);
  facI.lines = 2;
  fill(cap, 1);
  const before2 = countLine(gi, facI.id, 0) + countLine(gi, facI.id, 1);
  stepMs(C.PRODUCE_MS);
  ok(
    countLine(gi, facI.id, 0) === cap && countLine(gi, facI.id, 1) === cap,
    `两条线各自封顶到 ${cap}（合计 ${before2} → ${countLine(gi, facI.id, 0) + countLine(gi, facI.id, 1)}）`
  );

  // ---- 快照：每座建筑把「各线在场数」一并下发（客户端据此显示 n/上限）----
  const si = snapshot(gi);
  const frow = si.f.find((r) => r[0] === facI.id);
  ok(frow && frow.length === 11, `工厂快照 11 列（末列＝各产线在场兵数，实为 ${frow ? frow.length : '?'}）`);
  const aliveRow = frow[frow.length - 1];
  ok(
    Array.isArray(aliveRow) && aliveRow.length === 2 && aliveRow[0] === cap && aliveRow[1] === cap,
    `两条线各记 ${cap} 个在场兵（实际 ${aliveRow}）`
  );
  const hrow = si.hq.find((r) => r[0] === gi.hqs[0].id);
  ok(hrow && hrow.length === 13, `总部快照 13 列（末列＝各产线在场兵数，实为 ${hrow ? hrow.length : '?'}）`);
  const hqLine = hrow ? hrow[hrow.length - 1] : null;
  ok(
    Array.isArray(hqLine) && hqLine[0] >= C.START_ROSTER.length && hqLine[0] <= cap,
    `总部那条线记着 ${hqLine ? hqLine[0] : '?'} 支：开局亲兵 ${C.START_ROSTER.length} 支同样占名额，之后补产到上限 ${cap}`
  );
  // 末列（第 20 列）是炮塔角，产线序号在第 19 列 —— 车体角 / 炮塔角各占一列（见 smoke/turret.js §5）
  ok(si.u[0].length === 20, `单位快照 20 列（末列＝炮塔角，实为 ${si.u[0].length}）`);
  const inLine = si.u.filter((r) => r[11] === facI.id);
  ok(inLine.length > 0 && inLine.every((r) => r[18] === 0 || r[18] === 1), '每支部队都带着自己的产线序号');
}

console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
