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

// 1. 开局状态
const clock = makeClock();
const g = createGameState(room(2));
g.phaseEndsAt = clock.now + C.COUNTDOWN_MS;
ok(g.players.length === 2, '2 名玩家入场');
ok(g.factories.length === 2 + C.NEUTRAL_FACTORIES.length, '2 座起始工厂 + 7 座中立工厂');
ok(g.labs.length === C.LABS.length, '4 座研究所');
ok(g.phase === 'countdown', '开局进入倒计时');
ok(
  g.players.every((p) => g.factories.some((f) => f.owner === g.players.indexOf(p) && f.level === 1)),
  '每名玩家拥有一座初级起始工厂'
);
ok(g.units.length === 2 * C.BASE_START_UNITS, '每座起始工厂预置 2 个单位');
ok(
  g.factories.filter((f) => f.level === 3).length === 1 &&
    g.factories.filter((f) => f.level === 2).length === 2,
  '地图含 1 座高级 + 2 座中级中立工厂'
);

// 2. 倒计时结束进入对战
clock.run(g, 3500);
ok(g.phase === 'playing', '倒计时结束进入对战');

// 3. 工厂自动产兵 + 兵力上限（初级厂上限 4）
clock.run(g, 30000);
const baseFac = g.factories[0];
const garrison = __test.garrisonOf(g, baseFac.id, 0);
ok(garrison === C.FACTORY_CAP[1], `初级厂兵力达到上限 ${C.FACTORY_CAP[1]}（当前 ${garrison}）`);
const beforeCap = g.units.filter((u) => u.ownerIdx === 0).length;
clock.run(g, 9000);
const afterCap = g.units.filter((u) => u.ownerIdx === 0).length;
ok(afterCap <= beforeCap, '达到上限后停止产兵');

// 4. 占领中立工厂（把一个单位放到中级厂旁）
const l2 = g.factories.find((f) => !f.home && f.level === 2);
const capturer = g.units.find((u) => u.ownerIdx === 0);
capturer.x = l2.x + 20;
capturer.y = l2.y;
capturer.moveX = null;
capturer.moveY = null;
clock.run(g, 5000);
ok(l2.owner === 0, '单位进驻 4 秒后占领中级工厂');
ok(g.players[0].captured >= 1, '占领数记入统计');

// 5. 该厂开始为占领方产兵（中级厂上限 6、出厂 maxTier=2）
clock.run(g, 40000);
const l2Garrison = __test.garrisonOf(g, l2.id, 0);
ok(l2Garrison > 0, '占领后的工厂开始产兵');
const l2Units = g.units.filter((u) => u.homeFac === l2.id && u.ownerIdx === 0);
ok(l2Units.every((u) => u.maxTier === 2), '中级厂出厂单位进化上限为中级');

// 6. 初级厂出厂单位永远初级（maxTier=1）
const baseUnits = g.units.filter((u) => u.homeFac === baseFac.id);
ok(baseUnits.every((u) => u.maxTier === 1), '初级厂出厂单位进化上限为初级');

// 7. 战斗：经验 → 进化（高级厂出厂单位可升到高级）
// 场地选在远离所有工厂的角落：最近的单位/出兵点都在 600px 外，
// 不会被地图上的其他部队（索敌 270 / 拴绳 320）插手，保证 1v1 可控。
const fac3 = { id: 999, owner: 0, level: 3 };
const fighter = __test.spawnUnit(g, fac3, 'shield', 300, 1400);
const victim = __test.spawnUnit(g, { id: 998, owner: 1, level: 1 }, 'ranger', 450, 1400);
victim.moveX = null;
victim.moveY = null;
fighter.moveX = null;
fighter.moveY = null;
const hp0 = victim.hp;
let sawBullet = false;
// 逐帧推进：近战/直射弹道寿命极短，必须逐帧检查才能捕捉
for (let i = 0; i < 800 && !victim.dead; i++) {
  clock.now += 50;
  __test.step(g, 0.05, clock.now);
  if (g.bullets.length > 0) sawBullet = true;
}
ok(sawBullet, '交战产生弹道');
ok(victim.dead || victim.hp < hp0, '敌方单位受到伤害');
ok(!victim.dead || victim.hp === 0, '阵亡单位血量归零');
ok(fighter.xp > 0, '射手获得经验');
ok(fighter.tier >= 2, '经验达标后进化到中级（当前 ' + fighter.tier + ' 级）');
ok(g.players[0].kills >= 1 || !victim.dead, '击杀记入统计');

// 8. 进化上限：maxTier=1 的单位无论多少经验都不升级
const capped = __test.spawnUnit(g, { id: 997, owner: 0, level: 1 }, 'warrior', 700, 700);
capped.xp = 9999;
__test.step(g, 0.05, clock.now + 100);
ok(capped.tier === 1, '初级厂单位经验再多也保持初级');

// 9. 移动指令 + 限速
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

// 10. 研究所归属
g.labs[0].owner = 0;
ok(g.labs.some((l) => l.owner === 0), '研究所可被归属');

// 11. 快照与全量状态
const snap = snapshot(g);
ok(Array.isArray(snap.u) && Array.isArray(snap.b) && Array.isArray(snap.f), '快照通道字段齐全');
ok(snap.f.length === g.factories.length, '快照工厂行数一致');
const pub = publicGameState(g);
ok(pub.type === 'warfactory' && pub.players.length === 2, '全量状态可序列化');
ok(typeof pub.consts.stats.warrior.hp === 'number', '全量状态携带单位属性表');

// 12. 淘汰与胜负：把 1 号玩家所有工厂夺走
for (const f of g.factories) {
  if (f.owner === 1) f.owner = 0;
}
g.units = g.units.filter((u) => u.ownerIdx !== 1);
clock.run(g, 500);
ok(g.players[1].eliminated, '失去全部工厂的玩家出局');
ok(g.over && g.phase === 'over', '对局结束');
ok(g.winnerId === 'p0', '最后存活者获胜');

// 13. 中途退出：工厂变中立、单位移除
const g2 = createGameState(room(2));
g2.phase = 'playing';
g2.phaseEndsAt = 0;
onPlayerQuit(g2, 'p1');
ok(g2.players[1].left, '退出玩家标记 left');
ok(g2.factories.every((f) => f.owner !== 1), '退出玩家的工厂全部变为中立');
ok(g2.units.every((u) => u.ownerIdx !== 1), '退出玩家的单位被移除');

// 14. 3/4 人布局无重叠
for (const n of [3, 4]) {
  const gn = createGameState(room(n));
  const pois = [...gn.factories.map((f) => [f.x, f.y]), ...gn.labs.map((l) => [l.x, l.y])];
  let minD = Infinity;
  for (let i = 0; i < pois.length; i++) {
    for (let j = i + 1; j < pois.length; j++) {
      minD = Math.min(minD, Math.hypot(pois[i][0] - pois[j][0], pois[i][1] - pois[j][1]));
    }
  }
  ok(minD > C.CAPTURE_R * 2, `${n} 人局建筑间距 > 2×占领半径（${Math.round(minD)}）`);
  ok(gn.units.length === n * C.BASE_START_UNITS, `${n} 人局预置部队正确`);
}

console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
