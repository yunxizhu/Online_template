'use strict';

/**
 * 车体 / 炮塔朝向冒烟：node server/games/warfactory/smoke/turret.js
 *
 * 一只兵有两个角（都是世界角）：
 *   `angle`  = 车体 —— 朝**行进**方向
 *   `turret` = 炮塔 —— 朝**攻击**方向
 *
 * 以前只有一个角，开火时直接把整只兵扭向目标 —— 队伍边走边原地打转，很难看。
 * 这里把「两个角必须各走各的」钉死：
 *   ① 出生时炮塔与车体同向；
 *   ② 纯行军时两者保持同向（车体转弯，炮塔跟着转同样的量）；
 *   ③ 行军中开火：车体照旧朝落点，炮塔转向目标 —— 相对夹角拉得开；
 *   ④ 目标没了，炮塔在 1 秒量级内收回车体朝向（不会僵在最后打过的方向）；
 *   ⑤ 快照把两个角都下发（第 5 列车体、末列炮塔），客户端据此分两层画。
 *
 * 另外两个角都**有角速度**（data.js 的 turn 段），不能瞬间扭到位：
 *   ⑥ 命令指向身后 → 车体先掉头（一 tick 转量 ≤ 角速度×dt，掉头阶段不位移）；
 *   ⑦ 索敌到身后的目标 → 炮塔先转过去，转到位（aimTol 内）才开火。
 */

const mod = require('..');
const { createGameState, setPlayerInput, __test } = mod;

let failed = 0;
function ok(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) failed += 1;
}

const DT = 0.1;
const TAU = Math.PI * 2;

/** 角差取最短弧（-π..π] */
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

function room(n) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: 'p' + i, name: 'P' + i });
  return { id: 'turret-' + n, players };
}

/**
 * 找一块「左右都站得住、中间不隔山」的空地：
 * 我方站 (x,y)，敌方站它正西 dist 处（于是行进方向 +x 与攻击方向 −x 正好差 180°）。
 */
function pickSpot(g, dist) {
  const t = g.terrain;
  for (let r = 6; r < t.rows - 6; r += 2) {
    for (let c = 6; c < t.cols - 6; c += 2) {
      const px = (c + 0.5) * t.cell;
      const py = (r + 0.5) * t.cell;
      const fx = px - dist;
      if (!__test.canStand(g, px, py, 12)) continue;
      if (!__test.canStand(g, fx, py, 12)) continue;
      // 中间不能有山：视线被挡就不开火，测的是朝向不是地形
      if (__test.losBlocked(g, px, py, fx, py)) continue;
      return { x: px, y: py };
    }
  }
  return null;
}

console.log('[1] 车体与炮塔：出生同向');
{
  const g = createGameState(room(2));
  const bad = g.units.filter((u) => angDiff(u.turret, u.angle) > 1e-6);
  ok(g.units.length > 0 && bad.length === 0, `开局部队 ${g.units.length} 支，炮塔与车体同向`);
}

console.log('[2] 纯行军：炮塔跟着车体转（相对角保持 0）');
{
  const g = createGameState(room(2));
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  g.units.length = 0;
  const s = pickSpot(g, 300);
  ok(Boolean(s), '找到一块空地');
  const u = __test.spawnUnit(g, { id: 0, owner: 0, level: 1 }, 'ranger', s.x, s.y);
  let now = 1000;
  const dst = { x: s.x + 900, y: s.y + 300 };
  setPlayerInput(g, g.players[0].id, { cmd: 'move', x: dst.x, y: dst.y, ids: [u.id] }, now);
  let worst = 0;
  let worstMove = 0;
  let prev = { x: u.x, y: u.y };
  for (let i = 0; i < 40; i++) {
    now += DT * 1000;
    __test.step(g, DT, now);
    worst = Math.max(worst, Math.abs(angDiff(u.turret, u.angle)));
    const mv = Math.hypot(u.x - prev.x, u.y - prev.y);
    if (mv > 0.5) worstMove = Math.max(worstMove, Math.abs(angDiff(u.angle, Math.atan2(u.y - prev.y, u.x - prev.x))));
    prev = { x: u.x, y: u.y };
  }
  ok(worst < 1e-6, `行军 4s 内相对角始终为 0（最大 ${worst.toExponential(1)}）`);
  ok(worstMove < 0.1, `车体角 = 实际行进方向（最大偏差 ${worstMove.toFixed(3)} rad）`);
}

console.log('[3] 边走边打：车体朝落点、炮塔朝目标');
{
  const g = createGameState(room(2));
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  g.units.length = 0;
  const dist = 120;
  const s = pickSpot(g, dist);
  ok(Boolean(s), '找到一块空地');
  // 游侠射程 220+：往 +x 走的同时，身后 −x 方向的敌人一直在射程内
  const me = __test.spawnUnit(g, { id: 0, owner: 0, level: 1 }, 'ranger', s.x, s.y);
  const foe = __test.spawnUnit(g, { id: 0, owner: 1, level: 1 }, 'warrior', s.x - dist, s.y);
  let now = 1000;
  const dst = { x: s.x + 700, y: s.y };
  setPlayerInput(g, g.players[0].id, { cmd: 'move', x: dst.x, y: dst.y, ids: [me.id] }, now);
  let maxRel = 0;
  let worstMove = 0;
  let sawTurretBack = false;
  let prev = { x: me.x, y: me.y };
  for (let i = 0; i < 12; i++) {
    now += DT * 1000;
    __test.step(g, DT, now);
    if (me.dead || foe.dead) break;
    maxRel = Math.max(maxRel, Math.abs(angDiff(me.turret, me.angle)));
    const mv = Math.hypot(me.x - prev.x, me.y - prev.y);
    if (mv > 0.5) worstMove = Math.max(worstMove, Math.abs(angDiff(me.angle, Math.atan2(me.y - prev.y, me.x - prev.x))));
    prev = { x: me.x, y: me.y };
    if (Math.abs(angDiff(me.turret, Math.PI)) < 0.6) sawTurretBack = true;
  }
  ok(maxRel > 2, `车体与炮塔拉开了夹角（最大 ${maxRel.toFixed(2)} rad ≈ ${Math.round((maxRel * 180) / Math.PI)}°）`);
  ok(worstMove < 0.1, `车体角 = 实际行进方向（没被攻击方向拽走，偏差 ${worstMove.toFixed(3)} rad）`);
  ok(sawTurretBack, '炮塔一直咬着身后的目标');
  // 关键回归：整只兵不再「扭向目标」——旧行为的相对角恒为 0
  ok(maxRel > 0.5, '不再是「开火即整车转向」（旧行为：相对角恒 0）');
}

console.log('[4] 目标消失：炮塔收回车体朝向');
{
  const g = createGameState(room(2));
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  g.units.length = 0;
  const dist = 120;
  const s = pickSpot(g, dist);
  const me = __test.spawnUnit(g, { id: 0, owner: 0, level: 1 }, 'ranger', s.x, s.y);
  const foe = __test.spawnUnit(g, { id: 0, owner: 1, level: 1 }, 'warrior', s.x - dist, s.y);
  let now = 1000;
  // 随机地图上「多久打起来」说不准（射程内有没有敌人、视线上有没有山），
  // 所以这里取 3s 内的最大偏角，而不是某一帧的瞬时值
  let relBefore = 0;
  for (let i = 0; i < 30; i++) {
    now += DT * 1000;
    __test.step(g, DT, now);
    relBefore = Math.max(relBefore, Math.abs(angDiff(me.turret, me.angle)));
  }
  foe.dead = true; // 目标没了
  for (let i = 0; i < 30; i++) {
    now += DT * 1000;
    __test.step(g, DT, now);
  }
  const relAfter = Math.abs(angDiff(me.turret, me.angle));
  ok(relBefore > 1, `打之前炮塔是偏着的（${relBefore.toFixed(2)} rad）`);
  ok(relAfter < 0.12, `3s 后炮塔收回车体朝向（${relAfter.toFixed(3)} rad）`);
}

console.log('[5] 快照：车体角与炮塔角各占一列');
{
  const g = createGameState(room(3));
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  let now = 1000;
  for (let i = 0; i < 30; i++) {
    now += DT * 1000;
    __test.step(g, DT, now);
  }
  const snap = mod.snapshot(g);
  const row = snap.u[0];
  ok(row.length === 20, `单位行 ${row.length} 列（车体角 + 炮塔角都在）`);
  ok(
    Math.abs(angDiff(row[19], g.units[0].turret)) < 0.02 && Math.abs(angDiff(row[4], g.units[0].angle)) < 0.02,
    '末列＝炮塔角、第 5 列＝车体角'
  );
  // 客户端按位取值：末列一旦挪位，炮塔就会读到别的数 —— 这里锁住列序
  ok(typeof row[19] === 'number' && Number.isFinite(row[19]), '炮塔角是有限数值');
}

console.log('[6] 车体有角速度：命令指向身后 → 先掉头，不「点了就跑」');
{
  const g = createGameState(room(2));
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  g.units.length = 0;
  const s = pickSpot(g, 600);
  ok(Boolean(s), '找到一块空地');
  const me = __test.spawnUnit(g, { id: 0, owner: 0, level: 1 }, 'ranger', s.x, s.y);
  me.angle = 0; // 车头朝 +x
  me.turret = 0;
  const T = g.consts.turn;
  const sizeMul = Math.pow(2 / Math.max(2, (me.r * 2) / g.consts.grid.cell), T.sizeSlow);
  const perTick = T.hull * sizeMul * DT + 1e-6; // 一 tick 的转量上限
  const dst = { x: s.x - 600, y: s.y }; // 正后方 → 需要 180° 掉头
  const startOff = Math.abs(angDiff(Math.atan2(dst.y - me.y, dst.x - me.x), me.angle));
  let now = 1000;
  setPlayerInput(g, g.players[0].id, { cmd: 'move', x: dst.x, y: dst.y, ids: [me.id] }, now);
  let maxTurn = 0; // 单 tick 最大转角
  let early = 0; // 掉头阶段的累计位移
  let firstMoveTick = -1;
  let prev = { x: me.x, y: me.y, a: me.angle };
  for (let i = 0; i < 120; i++) {
    now += DT * 1000;
    __test.step(g, DT, now);
    const da = Math.abs(angDiff(me.angle, prev.a));
    const mv = Math.hypot(me.x - prev.x, me.y - prev.y);
    if (da > maxTurn) maxTurn = da;
    if (i < 3) early += mv; // 掉头刚开始的几拍必须站着不动
    if (mv > 0.5 && firstMoveTick < 0) firstMoveTick = i;
    prev = { x: me.x, y: me.y, a: me.angle };
    if (me.dead || me.moveX == null) break;
  }
  ok(startOff > 2.5, `命令在正后方（初始夹角 ${Math.round((startOff * 180) / Math.PI)}°）`);
  ok(
    maxTurn <= perTick,
    `一 tick 最多转 ${((perTick * 180) / Math.PI).toFixed(1)}°（实测最大 ${((maxTurn * 180) / Math.PI).toFixed(1)}°，不是瞬间掉头）`
  );
  ok(firstMoveTick >= 2, `掉头 ${firstMoveTick} 拍之后才挪窝（不是「点了就跑」）`);
  ok(early < 0.5, `掉头阶段站住不动（前 3 拍位移 ${early.toFixed(2)}px）`);
  ok(Math.hypot(me.x - dst.x, me.y - dst.y) < 160, `最终还是走到了目标（离 ${Math.round(Math.hypot(me.x - dst.x, me.y - dst.y))}px）`);
}

console.log('[7] 炮塔有角速度：转到位才开火');
{
  const g = createGameState(room(2));
  g.phase = 'playing';
  g.phaseEndsAt = 0;
  g.units.length = 0;
  const s = pickSpot(g, 120);
  ok(Boolean(s), '找到一块空地');
  const me = __test.spawnUnit(g, { id: 0, owner: 0, level: 1 }, 'warrior', s.x, s.y);
  me.angle = 0; // 车头 + 炮塔都朝 +x
  me.turret = 0;
  const T = g.consts.turn;
  const sizeMul = Math.pow(2 / Math.max(2, (me.r * 2) / g.consts.grid.cell), T.sizeSlow);
  const perTick = T.turret * sizeMul * DT + 1e-6;
  let now = 1000;
  // 先空转 3s：把攻击倒计时放空，免得「还没开火」其实是 cd 没到
  for (let i = 0; i < 30; i++) {
    now += DT * 1000;
    __test.step(g, DT, now);
  }
  // 敌人出现在正后方（−x）→ 炮塔要转 180°
  const foe = __test.spawnUnit(g, { id: 0, owner: 1, level: 1 }, 'warrior', s.x - 120, s.y);
  let maxTurn = 0;
  let firstShot = -1;
  let firedWhileUnaimed = 0;
  let prevTur = me.turret;
  let prevHp = foe.hp; // ⚠️ 不能数子弹：弹速 9999 的直射弹当拍就飞到并消失，bullets 长度看不出变化
  for (let i = 0; i < 25; i++) {
    now += DT * 1000;
    __test.step(g, DT, now);
    const da = Math.abs(angDiff(me.turret, prevTur));
    if (da > maxTurn) maxTurn = da;
    const aim = Math.atan2(foe.y - me.y, foe.x - me.x);
    const off = Math.abs(angDiff(aim, me.turret));
    if (foe.hp < prevHp) {
      if (firstShot < 0) firstShot = i;
      if (off > T.aimTol + 0.05) firedWhileUnaimed++;
    }
    prevHp = foe.hp;
    prevTur = me.turret;
    if (me.dead || foe.dead) break;
  }
  const aimEnd = Math.atan2(foe.y - me.y, foe.x - me.x);
  ok(
    maxTurn <= perTick,
    `一 tick 最多转 ${((perTick * 180) / Math.PI).toFixed(1)}°（实测最大 ${((maxTurn * 180) / Math.PI).toFixed(1)}°，不是瞬间对准）`
  );
  ok(firedWhileUnaimed === 0, `没有一发是炮塔没转到位就打出去的（aimTol ${T.aimTol}）`);
  ok(firstShot >= 3, `索敌后 ${firstShot} 拍才开第一枪（不是索敌即开火）`);
  ok(Math.abs(angDiff(aimEnd, me.turret)) < 0.05, `最后炮塔对准了目标（偏差 ${Math.abs(angDiff(aimEnd, me.turret)).toFixed(3)} rad）`);
}

console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
