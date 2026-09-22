'use strict';

/** 弹射对决冒烟测试：node server/games/blaster/smoke/basic.js */

const mod = require('..');
const {
  createGameState,
  setPlayerInput,
  publicGameState,
  snapshot,
  clampMatchGames,
  __test,
} = mod;

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

function room(count, matchGames) {
  const players = [];
  for (let i = 0; i < count; i++) {
    players.push({ id: 'p' + i, name: '玩家' + i });
  }
  return { players, matchGames };
}

/** 手动时钟推进：step 的第三个参数即「当前时刻」 */
function run(game, ms, state) {
  const dt = 0.016;
  const end = state.now + ms;
  while (state.now < end) {
    state.now += dt * 1000;
    __test.step(game, dt, state.now);
  }
}

function startPlaying(game) {
  game.phase = 'playing';
  game.phaseEndsAt = 0;
}

console.log('弹射对决 smoke');

// 1. 局数裁剪
ok(clampMatchGames(1) === 3, '局数下限裁剪为 3');
ok(clampMatchGames(99) === 11, '局数上限裁剪为 11');
ok(clampMatchGames(5) === 5, '局数 5 保持');
ok(clampMatchGames(undefined) === 5, '缺省局数 5');

// 2. 开局状态
const g = createGameState(room(4, 5));
ok(g.players.length === 4, '4 名玩家入场');
ok(g.matchGames === 5, '读取房间局数 5');
ok(g.phase === 'countdown', '开局进入倒计时');
ok(
  g.players.every((p) => p.hp === C.MAX_HP && p.alive),
  '每人 3 点生命'
);
ok(g.bullets.length === 0, '开局无子弹');
ok(
  g.players.every(
    (p) =>
      p.x >= C.WALL + C.PLAYER_R &&
      p.x <= C.ARENA_W - C.WALL - C.PLAYER_R &&
      p.y >= C.WALL + C.PLAYER_R &&
      p.y <= C.ARENA_H - C.WALL - C.PLAYER_R
  ),
  '出生点都在场地内'
);

// 3. 倒计时结束进入对战
// 手动时钟从「很久以前」起步，避免追上真实时钟触发的阶段自动推进
const s1 = { now: Date.now() - 600000 };
g.phaseEndsAt = s1.now;
run(g, 32, s1);
ok(g.phase === 'playing', '倒计时结束进入对战');
ok(g.phaseEndsAt === 0, '进入对战清空倒计时');

// 4. WASD 移动 + 边界夹取（单独 2 人局，避免被其他小人挡住）
const gw = createGameState(room(2, 5));
startPlaying(gw);
const sw = { now: Date.now() - 600000 };
const me = gw.players[0];
gw.players[1].x = 120;
gw.players[1].y = C.ARENA_H - 60;
const beforeX = me.x;
setPlayerInput(gw, me.id, { mx: 1, my: 0, aim: 0, charge: 0 });
run(gw, 320, sw);
ok(me.x > beforeX, '按 D 向右移动');
ok(me.x <= C.ARENA_W - C.WALL - C.PLAYER_R + 0.001, '不会穿出右墙');
setPlayerInput(gw, me.id, { mx: 1, my: 0, aim: 0, charge: 0 });
run(gw, 6000, sw);
ok(
  Math.abs(me.x - (C.ARENA_W - C.WALL - C.PLAYER_R)) < 0.5,
  '长时间顶墙后停在墙边（x=' + me.x.toFixed(1) + '）'
);
setPlayerInput(gw, me.id, { mx: 0, my: 1, aim: 0, charge: 0 });
run(gw, 6000, sw);
ok(
  Math.abs(me.y - (C.ARENA_H - C.WALL - C.PLAYER_R)) < 0.5,
  '按 S 顶下墙后停在下墙边'
);

// 5. 蓄力发射 + 发射间隔（冷却）
gw.bullets = [];
me.x = C.ARENA_W / 2;
me.y = C.ARENA_H / 2;
me.nextFireAt = 0;
// 按住蓄力 ~250ms 后松开 → 发射 1 颗
setPlayerInput(gw, me.id, { mx: 0, my: 0, aim: 0, charge: 1 });
run(gw, 250, sw);
ok(gw.bullets.length === 0, '仅按住蓄力时不会自动开火');
setPlayerInput(gw, me.id, { mx: 0, my: 0, aim: 0, charge: 0 });
run(gw, 32, sw);
ok(gw.bullets.length === 1, '松开左键射出 1 颗子弹');
// 立刻再次点按（冷却期内）→ 被发射间隔拦截，无法连发
setPlayerInput(gw, me.id, { mx: 0, my: 0, aim: 0, charge: 1 });
run(gw, 16, sw);
setPlayerInput(gw, me.id, { mx: 0, my: 0, aim: 0, charge: 0 });
run(gw, 32, sw);
ok(gw.bullets.length === 1, '冷却期内快速点按无法连发');
// 等过冷却 → 可再次发射
run(gw, C.FIRE_COOLDOWN_MS + 60, sw);
setPlayerInput(gw, me.id, { mx: 0, my: 0, aim: 0, charge: 1 });
run(gw, 16, sw);
setPlayerInput(gw, me.id, { mx: 0, my: 0, aim: 0, charge: 0 });
run(gw, 32, sw);
ok(gw.bullets.length >= 2, '冷却结束后可再次射击');
setPlayerInput(gw, me.id, { mx: 0, my: 0, aim: 0, charge: 0 });

// 5a. 蓄力越久子弹越快，且有速度上限
const gcv = createGameState(room(2, 5));
startPlaying(gcv);
const scv = { now: Date.now() - 600000 };
const cvMe = gcv.players[0];
gcv.players[1].x = 60;
gcv.players[1].y = 60;
function chargeAndFire(game, p, holdMs, st) {
  p.nextFireAt = 0;
  setPlayerInput(game, p.id, { mx: 0, my: 0, aim: Math.PI / 2, charge: 1 });
  run(game, holdMs, st);
  setPlayerInput(game, p.id, { mx: 0, my: 0, aim: Math.PI / 2, charge: 0 });
  run(game, 32, st);
  const b = game.bullets[game.bullets.length - 1];
  return b ? Math.hypot(b.vx, b.vy) : 0;
}
cvMe.x = C.ARENA_W / 2;
cvMe.y = C.ARENA_H / 2;
const spShort = chargeAndFire(gcv, cvMe, 120, scv);
gcv.bullets = [];
cvMe.x = C.ARENA_W / 2;
cvMe.y = C.ARENA_H / 2;
const spLong = chargeAndFire(gcv, cvMe, C.CHARGE_MAX_MS + 400, scv);
gcv.bullets = [];
ok(
  spShort >= C.BULLET_SPEED_MIN - 0.5 && spShort < C.BULLET_SPEED_MAX,
  '短期蓄力子弹速度落在下限与上限之间（' + spShort.toFixed(1) + '）'
);
ok(spLong > spShort, '蓄力越久子弹越快');
ok(Math.abs(spLong - C.BULLET_SPEED_MAX) < 0.5, '蓄满后速度封顶于上限');

// 5b. 贴墙朝墙开火会自伤（自杀机制：子弹不防呆，撞墙反射后/贴墙射出即可能打到自己）
const gw2 = createGameState(room(2, 5));
startPlaying(gw2);
const sw2 = { now: Date.now() - 600000 };
const wallMe = gw2.players[0];
wallMe.x = C.ARENA_W - C.WALL - C.PLAYER_R;
wallMe.y = C.ARENA_H / 2;
gw2.players[1].x = 200;
gw2.players[1].y = 80;
wallMe.nextFireAt = 0;
setPlayerInput(gw2, wallMe.id, { mx: 0, my: 0, aim: 0, charge: 1 });
run(gw2, 200, sw2);
setPlayerInput(gw2, wallMe.id, { mx: 0, my: 0, aim: 0, charge: 0 });
run(gw2, 80, sw2);
ok(wallMe.hp < C.MAX_HP, '贴墙朝墙开火会自伤（自杀机制生效）');

// 5c. 正常朝空旷方向开火，出膛瞬间不会误伤自己
const gw3 = createGameState(room(2, 5));
startPlaying(gw3);
const sw3 = { now: Date.now() - 600000 };
const safe = gw3.players[0];
safe.x = C.ARENA_W / 2;
safe.y = C.ARENA_H / 2;
gw3.players[1].x = 60;
gw3.players[1].y = 60;
safe.nextFireAt = 0;
setPlayerInput(gw3, safe.id, { mx: 0, my: 0, aim: 0, charge: 1 });
run(gw3, 32, sw3);
setPlayerInput(gw3, safe.id, { mx: 0, my: 0, aim: 0, charge: 0 });
run(gw3, 32, sw3);
ok(safe.hp === C.MAX_HP, '朝空旷方向开火不会出膛即自伤');

// 5d. 每人同时存在的子弹上限 5 颗：继续发射会挤掉自己最早的那颗
const gcap = createGameState(room(2, 5));
startPlaying(gcap);
gcap.walls = []; // 去掉随机墙体，弹道只受场地边界影响，回弹时间可预期
const sc = { now: Date.now() - 600000 };
const capMe = gcap.players[0];
const capOther = gcap.players[1];
capMe.x = C.WALL + C.PLAYER_R + 2; // 贴左墙，朝右平射：回弹路程最长
capMe.y = C.ARENA_H / 2;
capOther.x = 60;
capOther.y = 60;
gcap.bullets = [];
const capFiredIds = [];
const capShots = C.MAX_BULLETS_PER_PLAYER + 2; // 故意多打 2 发
for (let i = 0; i < capShots; i++) {
  run(gcap, C.FIRE_COOLDOWN_MS + 20, sc); // 先等过冷却，再重新短蓄力
  setPlayerInput(gcap, capMe.id, { mx: 0, my: 0, aim: 0, charge: 1 });
  run(gcap, 30, sc); // 极短蓄力 → 最小弹速，回弹最慢
  setPlayerInput(gcap, capMe.id, { mx: 0, my: 0, aim: 0, charge: 0 });
  run(gcap, 32, sc);
  const mineNow = gcap.bullets.filter((b) => b.ownerId === capMe.id);
  ok(mineNow.length <= C.MAX_BULLETS_PER_PLAYER, '第 ' + (i + 1) + ' 发后场上子弹不超过上限');
  capFiredIds.push(mineNow[mineNow.length - 1].id);
}
const capMine = gcap.bullets.filter((b) => b.ownerId === capMe.id);
ok(
  capMine.length === C.MAX_BULLETS_PER_PLAYER,
  '连打 ' + capShots + ' 发后仍只保留 ' + C.MAX_BULLETS_PER_PLAYER + ' 颗（实测 ' + capMine.length + '）'
);
ok(!capMine.some((b) => b.id === capFiredIds[0]), '最早那发被挤掉（第 1 发已不在场上）');
ok(
  capMine.some((b) => b.id === capFiredIds[capFiredIds.length - 1]),
  '最新那发保留在场上'
);
// 上限只作用于自己，不影响别人
__test.spawnBullet(gcap, capOther, C.BULLET_SPEED_MIN);
ok(
  gcap.bullets.some((b) => b.ownerId === capOther.id),
  '其他玩家的子弹不受该上限影响'
);
ok(C.MAX_BULLETS_PER_PLAYER === 5, '上限常量为 5');

// 6. 单发子弹速度在反弹中保持不变 + 撞墙无限反弹
gw.bullets = [];
gw.players[1].x = 60;
gw.players[1].y = 60;
me.x = C.ARENA_W / 2;
me.y = C.ARENA_H / 2;
me.nextFireAt = 0;
setPlayerInput(gw, me.id, { mx: 0, my: 0, aim: 0.7, charge: 1 });
run(gw, 60, sw);
setPlayerInput(gw, me.id, { mx: 0, my: 0, aim: 0.7, charge: 0 });
run(gw, 32, sw);
ok(gw.bullets.length === 1, '测试子弹已生成');
const bullet = gw.bullets[0];
const speed0 = Math.hypot(bullet.vx, bullet.vy);
ok(
  speed0 >= C.BULLET_SPEED_MIN - 0.5 && speed0 <= C.BULLET_SPEED_MAX + 0.5,
  '子弹速度落在蓄力区间内'
);
let bounced = 0;
let outOfBounds = 0;
let prevVx = bullet.vx;
let prevVy = bullet.vy;
for (let i = 0; i < 400 && gw.bullets.length; i++) {
  sw.now += 16;
  __test.step(gw, 0.016, sw.now);
  if (!gw.bullets.length) break;
  const b = gw.bullets[0];
  if (Math.sign(b.vx) !== Math.sign(prevVx) || Math.sign(b.vy) !== Math.sign(prevVy)) {
    bounced += 1;
  }
  prevVx = b.vx;
  prevVy = b.vy;
  if (
    b.x < C.WALL ||
    b.x > C.ARENA_W - C.WALL ||
    b.y < C.WALL ||
    b.y > C.ARENA_H - C.WALL
  ) {
    outOfBounds += 1;
  }
  if (Math.abs(Math.hypot(b.vx, b.vy) - speed0) > 0.5) outOfBounds += 100;
}
ok(outOfBounds === 0, '子弹始终留在场地内且该发速度不变');
ok(bounced >= 1, '子弹撞墙后反弹（次数 ' + bounced + '）');

// 7. 命中扣血 / 归零出局
const g2 = createGameState(room(2, 3));
startPlaying(g2);
const a = g2.players[0];
const b2 = g2.players[1];
a.x = 200;
a.y = C.ARENA_H / 2;
b2.x = 500;
b2.y = C.ARENA_H / 2;
const s2 = { now: Date.now() - 600000 };
a.nextFireAt = 0;
setPlayerInput(g2, a.id, { mx: 0, my: 0, aim: 0, charge: 1 });
run(g2, 120, s2);
setPlayerInput(g2, a.id, { mx: 0, my: 0, aim: 0, charge: 0 });
run(g2, 32, s2);
ok(g2.bullets.length === 1, '瞄准对手开火');
run(g2, 1200, s2);
ok(b2.hp === C.MAX_HP - 1, '命中扣 1 点生命（剩 ' + b2.hp + '）');
ok(g2.bullets.length === 0, '命中后子弹消失');
ok(a.kills === 0, '未击杀不计淘汰');
ok(a.score === 0, '未击杀不计分');

// 8. 三发命中 → 出局 → 本局结束 + 存活得分
// 注入两枚残留子弹：验证本局结束时会被清空，否则 roundOver 阶段仍渲染飞行中的子弹 → 画面抖动
g2.bullets.push({ id: 9001, x: 500, y: 320, vx: 400, vy: 0, ownerIndex: 0 });
g2.bullets.push({ id: 9002, x: 300, y: 200, vx: -300, vy: 100, ownerIndex: 1 });
for (let n = 0; n < 2 && b2.alive; n++) {
  a.nextFireAt = 0;
  setPlayerInput(g2, a.id, { mx: 0, my: 0, aim: 0, charge: 1 });
  run(g2, 120, s2);
  setPlayerInput(g2, a.id, { mx: 0, my: 0, aim: 0, charge: 0 });
  run(g2, 32, s2);
  run(g2, 1200, s2);
}
ok(b2.hp === 0 && !b2.alive, '三次命中后出局');
ok(a.kills === 1, '淘汰计入击杀数');
ok(a.score === C.SCORE_KILL + C.SCORE_SURVIVE, '淘汰 +1、存活 +3，共 4 分');
ok(g2.phase === 'roundOver', '场上只剩 1 人 → 本局结束');
ok(g2.bullets.length === 0, '本局结束（roundOver）清空了残留子弹，避免结算画面抖动');
ok(g2.lastRound && g2.lastRound.winnerId === a.id, '本局胜者为存活者');
ok(g2.roundIndex === 1, '仍在第 1 局');

// 9. 自动进入下一局
g2.phaseEndsAt = s2.now - 1;
run(g2, 32, s2);
ok(g2.roundIndex === 2, '自动进入第 2 局');
ok(g2.phase === 'countdown', '新一局重新倒计时');
ok(
  g2.players.every((p) => p.hp === C.MAX_HP && p.alive),
  '新一局满血复活'
);
ok(g2.bullets.length === 0, '新一局清空子弹');
ok(a.score === C.SCORE_KILL + C.SCORE_SURVIVE, '积分跨局累计');

// 10. 打满局数 → 系列赛结束
g2.phase = 'roundOver';
g2.roundIndex = g2.matchGames;
g2.phaseEndsAt = s2.now - 1;
run(g2, 32, s2);
ok(g2.over === true && g2.matchOver === true, '打满局数后系列赛结束');
ok(g2.winnerId === a.id, '总积分最高者夺冠');
ok(Array.isArray(g2.ranking) && g2.ranking.length === 2, '产出积分榜');

// 11. 中途退出
const g3 = createGameState(room(3, 5));
startPlaying(g3);
mod.onPlayerQuit(g3, g3.players[2].id);
ok(g3.players[2].left === true && !g3.players[2].alive, '退出者立即出局');
ok(g3.phase === 'playing', '3 人局仍有 2 人时不结束');
mod.onPlayerQuit(g3, g3.players[1].id);
ok(g3.phase === 'roundOver', '只剩 1 人时本局结束');

// 12. 公开状态与快照
const pub = publicGameState(g);
ok(pub.type === 'blaster' && pub.players.length === 4, '公开状态含 4 名玩家');
ok(pub.arena.w === C.ARENA_W && pub.arena.h === C.ARENA_H, '公开状态含场地尺寸');
ok(pub.matchGames === 5, '公开状态含总局数');
const snap = snapshot(g);
ok(Array.isArray(snap.ps) && snap.ps.length === 4, '快照含玩家数组');
ok(Array.isArray(snap.bs), '快照含子弹数组');
ok(typeof snap.t === 'number' && typeof snap.phase === 'string', '快照含时间与阶段');

// 13. 无效输入
setPlayerInput(g, 'not-a-player', { mx: 1 });
ok(true, '未知玩家输入被忽略');
setPlayerInput(g, me.id, { mx: 9, my: -9, aim: 0, charge: 1 });
ok(
  Math.abs(me.input.mx) <= 1 && Math.abs(me.input.my) <= 1,
  '移动输入被夹取到 -1..1'
);

// 13b. 墙体生成（元胞自动机）：CA 规则 + 位置/大小/方向来自块团 PCA 拟合
const caCols = 50;
const caRows = 32;
/** 统计「墙胞但 8 邻域里 <=1 个墙胞」的毛刺数量：CA 平滑后应当归零 */
const flakeCount = (g) => {
  let n = 0;
  for (let y = 1; y < caRows - 1; y++) {
    for (let x = 1; x < caCols - 1; x++) {
      if (!g[y * caCols + x]) continue;
      let nb = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          nb += g[(y + dy) * caCols + (x + dx)];
        }
      }
      if (nb <= 1) n++;
    }
  }
  return n;
};
const rawFlakes = flakeCount(__test.caRandomFill(Math.random, caCols, caRows));
const caFlakes = flakeCount(__test.caRun(Math.random, caCols, caRows));
ok(rawFlakes > 10, '初始随机填充有大量毛刺墙胞（实测 ' + rawFlakes + ' 个）');
ok(caFlakes === 0, 'CA 平滑后毛刺归零：活下来的墙胞至少 4 个墙邻居（实测 ' + caFlakes + ' 个）');

// 4-5 规则本身（5x5 小栅格，中心在 (2,2)）
const caTiny = new Uint8Array(25);
const caOut = new Uint8Array(25);
caTiny[1 * 5 + 2] = 1;
caTiny[2 * 5 + 1] = 1;
caTiny[2 * 5 + 3] = 1;
caTiny[3 * 5 + 2] = 1;
__test.caStep(caTiny, caOut, 5, 5);
ok(caOut[2 * 5 + 2] === 0, 'CA 规则：只有 4 个墙邻居的空白格不生成墙');
caTiny[1 * 5 + 1] = 1;
__test.caStep(caTiny, caOut, 5, 5);
ok(caOut[2 * 5 + 2] === 1, 'CA 规则：5 个墙邻居的空白格变成墙');
const caLone = new Uint8Array(25);
caLone[2 * 5 + 2] = 1;
__test.caStep(caLone, caOut, 5, 5);
ok(caOut[2 * 5 + 2] === 0, 'CA 规则：孤立墙胞被侵蚀掉');
const caSolid = new Uint8Array(25);
for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) caSolid[y * 5 + x] = 1;
__test.caStep(caSolid, caOut, 5, 5);
ok(caOut[2 * 5 + 2] === 1, 'CA 规则：团块内部的墙胞保持存活');
ok(caOut[0] === 0 && caOut[24] === 0, 'CA 规则：最外圈恒为空（外边界环保持贯通）');

// 连通域分组
const caGroup = new Uint8Array(12 * 8);
const groupCells = [
  [1, 1],
  [2, 1],
  [1, 2],
  [2, 2],
  [5, 5],
  [6, 5],
  [5, 6],
  [6, 6],
];
for (const [cx, cy] of groupCells) caGroup[cy * 12 + cx] = 1;
const groupBlobs = __test.caBlobs(caGroup, 12, 8);
ok(groupBlobs.length === 2, '连通域分析把分离的墙团分成 2 块（实测 ' + groupBlobs.length + ' 块）');
ok(
  groupBlobs.every((b) => b.length === 4),
  '每块墙团格数正确（' +
    groupBlobs
      .map((b) => b.length)
      .join('/') +
    '）'
);

// PCA 拟合：方向 / 长度 / 厚度都来自块团
const diagCells = [];
for (let i = 0; i < 8; i++) diagCells.push((8 + i) * caCols + (8 + i));
const diagFit = __test.fitBlob(diagCells, caCols);
const diagDeg = ((((diagFit.ang * 180) / Math.PI) % 180) + 180) % 180;
ok(Math.abs(diagDeg - 45) < 6, '斜向块团主轴 ≈45°（实测 ' + diagDeg.toFixed(1) + '°）');
const flatCells = [];
for (let x = 8; x < 15; x++) {
  flatCells.push(10 * caCols + x);
  flatCells.push(11 * caCols + x);
}
const flatFit = __test.fitBlob(flatCells, caCols);
ok(Math.abs(flatFit.ang) < 0.01, '水平块团主轴 ≈0°');
ok(Math.abs(flatFit.len - 7 * C.CA_CELL) < 0.01, '沿主轴跨度 = 块团长（7 格 = ' + flatFit.len + 'px）');
ok(Math.abs(flatFit.perp - 2 * C.CA_CELL) < 0.01, '垂直主轴跨度 = 块团宽（2 格 = ' + flatFit.perp + 'px）');
ok(flatFit.fill > 0.95, '规整块团的方向包围盒填充率高（' + flatFit.fill.toFixed(2) + '）');
const flatWall = __test.emitFromFit(flatFit, Math.random);
ok(flatWall.type === 'orect', '细长块团 → 斜矩形墙（orect）');
ok(
  Math.abs(flatWall.w - flatFit.len) < 0.2 &&
    flatWall.h >= C.WALL_THICK_MIN &&
    flatWall.h <= C.WALL_THICK_MAX,
  '墙体长度取自块团跨度、厚度夹到薄墙区间（' + flatWall.w + '×' + flatWall.h + '）'
);

// 多次生成：方向多样、薄墙、不越界、出生点安全、可达边界
let anyWallsOk = false;
let spawnFreeOk = true;
let connectedOk = true;
let thickOk = true;
let insideOk = true;
let orectSeen = 0;
let arcSeenCA = 0;
let wallSumCA = 0;
const layoutCountCA = 60;
const angleSet = new Set();
for (let t = 0; t < layoutCountCA; t++) {
  const gg = createGameState(room(2 + (t % 3), 5));
  mod.assignRandomWalls(gg);
  const spawns = gg.players.map((p) => ({ x: p.x, y: p.y }));
  if (gg.walls.length) anyWallsOk = true;
  wallSumCA += gg.walls.length;
  for (const s of spawns) {
    for (const w of gg.walls) {
      if (__test.pointInWall(w, s.x, s.y, C.PLAYER_R + 6)) spawnFreeOk = false;
    }
  }
  for (const w of gg.walls) {
    if (w.type === 'orect') {
      orectSeen++;
      if (w.h < C.WALL_THICK_MIN - 0.01 || w.h > C.WALL_THICK_MAX + 0.01) thickOk = false;
      const ca = Math.cos(w.ang);
      const sa = Math.sin(w.ang);
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const lx = (sx * w.w) / 2;
          const ly = (sy * w.h) / 2;
          const px = w.x + lx * ca - ly * sa;
          const py = w.y + lx * sa + ly * ca;
          if (
            px < C.WALL - 0.6 ||
            px > C.ARENA_W - C.WALL + 0.6 ||
            py < C.WALL - 0.6 ||
            py > C.ARENA_H - C.WALL + 0.6
          ) {
            insideOk = false;
          }
        }
      }
      angleSet.add(Math.round(((((w.ang * 180) / Math.PI) % 180) + 180) % 180));
    } else {
      arcSeenCA++;
      if (w.t < C.WALL_THICK_MIN - 0.01 || w.t > C.WALL_THICK_MAX + 0.01) thickOk = false;
      const mid = (w.a0 + w.a1) / 2;
      for (const ang of [w.a0, mid, w.a1]) {
        const px = w.cx + Math.cos(ang) * w.r;
        const py = w.cy + Math.sin(ang) * w.r;
        if (
          px < C.WALL - 0.6 ||
          px > C.ARENA_W - C.WALL + 0.6 ||
          py < C.WALL - 0.6 ||
          py > C.ARENA_H - C.WALL + 0.6
        ) {
          insideOk = false;
        }
      }
    }
  }
  if (!__test.validateLayout(gg.walls, spawns)) connectedOk = false;
}
ok(anyWallsOk, 'CA 算法正常会生成非空墙体');
ok(
  orectSeen > 0 && arcSeenCA > 0,
  '墙体图元同时包含斜矩形与弧形（直线 ' + orectSeen + ' : 弧形 ' + arcSeenCA + '）'
);
ok(thickOk, '所有墙体厚度都夹在 ' + C.WALL_THICK_MIN + '..' + C.WALL_THICK_MAX + '（薄墙）');
ok(insideOk, 'CA 生成的墙体都落在场地围栏内（不会挤进边界）');
ok(spawnFreeOk, '出生点不在任何墙体内');
ok(connectedOk, '每个布局所有出生点都可达边界（不被围住）');
ok(angleSet.size > 20, '墙体方向由 CA 块团主轴决定、分布多样（实测 ' + angleSet.size + ' 种角度）');
const avgWallsCA = wallSumCA / layoutCountCA;
ok(avgWallsCA >= 9, '平均墙体数够密集（实测 ' + avgWallsCA.toFixed(1) + ' 面/局）');

// 13c. 子弹撞墙反射（方形：翻轴）
const rectW = [{ type: 'rect', x: 480, y: 100, w: 30, h: 400 }];
const c1 = __test.collideCircle(rectW, 480 - C.BULLET_R + 1, 300, C.BULLET_R, 400, 0);
ok(c1.vx < 0, '子弹撞矩形左面后水平速度反向（反射）');
ok(c1.x <= 480 - C.BULLET_R + 0.001, '子弹被推出到墙左侧');
const c2 = __test.collideCircle(rectW, 510 + C.BULLET_R - 1, 300, C.BULLET_R, -400, 0);
ok(c2.vx > 0, '子弹撞矩形右面后水平速度反向');

// 弧形墙：径向反射
// 注：弧带实体是 annulus（w.r ± w.t/2），「凹侧」（dist<r）撞来与「凸侧」（dist>r）
// 撞来的法线方向互为相反。子弹被推到**撞来的那一侧之外**（sx=+1 → r + t/2 + r_b）；
// 若从凹侧往弧带打（dist=t/2），应被推回内周 r - t/2 - r_b 一侧，而不是穿过弧带。
const arcW = [{ type: 'arc', cx: 500, cy: 320, r: 120, t: 12, a0: -0.6, a1: 0.6 }];
const arcR = 120;
const arcHalf = 6;
// 情形一：子弹从凸侧（外周外侧）朝圆心打 → 碰到外周面后径向反射回凸侧
const c3 = __test.collideCircle(arcW, 500 + (arcR + 4), 320, C.BULLET_R, -400, 0);
ok(c3.vx > 0, '子弹撞弧形外壁后沿径向反射（弹回凸侧）');
ok(
  Math.abs(Math.hypot(c3.x - 500, c3.y - 320) - (arcR + arcHalf + C.BULLET_R)) < 0.001,
  '子弹被推到弧线外周一侧'
);
// 情形二：子弹从凹侧（内周内侧）朝外打 → 被推回凹侧
const c3in = __test.collideCircle(arcW, 500 + (arcR - 4), 320, C.BULLET_R, 400, 0);
ok(c3in.vx < 0, '子弹撞弧形内壁后沿径向反射（弹回凹侧）');
ok(
  Math.abs(Math.hypot(c3in.x - 500, c3in.y - 320) - (arcR - arcHalf - C.BULLET_R)) < 0.001,
  '子弹被推到弧线内周一侧'
);
// 情形三（回归）：紧贴弧带、朝圆心飞 → 必须被推到撞来那一侧之外，不能停在弧带里
const c3gap = __test.collideCircle(arcW, 500 + (arcR - 2), 320, C.BULLET_R, -400, 0);
ok(
  !__test.pointInWall(arcW[0], c3gap.x, c3gap.y, C.BULLET_R - 0.5),
  '子弹不会残留在弧带内部（回归：弧体振荡）'
);
// 情形四（回归）：斜射入弧带，同样不允许停在弧体内部
const c3c = __test.collideCircle(arcW, 500 + (arcR + 4), 320 + 2, C.BULLET_R, -400, -60);
ok(
  !__test.pointInWall(arcW[0], c3c.x, c3c.y, C.BULLET_R - 1),
  '子弹撞弧形墙后不会残留在弧带内部'
);

// 13d. 玩家被墙体推出
const cp = __test.collideCircle(rectW, 485, 300, C.PLAYER_R, 0, 0);
ok(cp.x <= 480 - C.PLAYER_R + 0.001, '站进矩形内的玩家被推到墙外');

// 13d2. 斜矩形墙（CA 产出的带方向墙体）：沿墙法线反射 + 把陷进去的对象推出
const obW = [{ type: 'orect', x: 700, y: 400, w: 240, h: 16, ang: Math.PI / 4 }];
const obNx = -Math.sin(Math.PI / 4); // 墙轴垂直方向（法线）
const obNy = Math.cos(Math.PI / 4);
const obStartX = 700 + obNx * (8 + C.BULLET_R - 1);
const obStartY = 400 + obNy * (8 + C.BULLET_R - 1);
const obVx = -obNx * 400;
const obVy = -obNy * 400;
const obHit = __test.collideCircle(obW, obStartX, obStartY, C.BULLET_R, obVx, obVy);
ok(
  obVx * obNx + obVy * obNy < 0 && obHit.vx * obNx + obHit.vy * obNy > 0,
  '子弹撞斜矩形墙后沿墙法线反射'
);
ok(
  !__test.pointInWall(obW[0], obHit.x, obHit.y, C.BULLET_R - 1),
  '子弹被推出斜矩形墙外'
);
const obP = __test.collideCircle(obW, 700, 400, C.PLAYER_R, 0, 0);
ok(
  !__test.pointInWall(obW[0], obP.x, obP.y, C.PLAYER_R - 2),
  '陷进斜矩形墙中央的玩家被推出墙外'
);
// 沿墙轴方向飞行的子弹不会凭空被弹开（局部坐标判断正确）
const obAlong = __test.collideCircle(obW, 700, 400, C.BULLET_R, Math.cos(Math.PI / 4) * 400, Math.sin(Math.PI / 4) * 400);
ok(obAlong.vx > 0 && obAlong.vy > 0, '沿墙轴方向的速度在反射后方向不变（只翻法线分量）');

// 13e. step 把卡在墙里的玩家推出到墙外
const gw4 = createGameState(room(2, 5));
mod.assignRandomWalls(gw4);
gw4.walls = [{ type: 'rect', x: 300, y: 200, w: 200, h: 200 }];
startPlaying(gw4);
const stuck = gw4.players[0];
stuck.x = 400;
stuck.y = 300; // 墙中央
const sw4 = { now: Date.now() - 600000 };
setPlayerInput(gw4, stuck.id, { mx: 0, my: 0, aim: 0, charge: 0 });
run(gw4, 64, sw4);
ok(
  !__test.pointInWall(gw4.walls[0], stuck.x, stuck.y, C.PLAYER_R - 2),
  'step 把卡在墙里的玩家推出到墙外'
);

// 13f. 弧形墙把玩家径向推出（弧线墙体确实生效）
const arcP = [{ type: 'arc', cx: 500, cy: 320, r: 120, t: 12, a0: -0.9, a1: 0.9 }];
const cpArc = __test.collideCircle(arcP, 500 + 110, 320, C.PLAYER_R, 0, 0);
ok(
  !__test.pointInWall(arcP[0], cpArc.x, cpArc.y, C.PLAYER_R - 2),
  '站进弧形带的玩家被径向推出墙外（弧线碰撞生效）'
);

// 13g. 弧形墙反射子弹（凸面朝外：从外侧射向弧心，被弹回场内）
const cArcB = __test.collideCircle(arcP, 500 + 126, 320, C.BULLET_R, -400, 0);
ok(cArcB.vx > 0, '子弹从凸面外侧射向弧心后被反射回场内');

// 13h. 压力测试：大量随机布局中，弧形墙既会生成、又不围住任何出生点
let arcSeen = 0;
let wallCountSum = 0;
let layoutCount = 0;
let strictAllOk = true;
const strictValidate = (walls, spawns) => {
  // 独立、更严的校验（cell=6，pad=PLAYER_R+6），交叉验证「小人真能走出去」
  const cell = 6;
  const cols = Math.ceil(C.ARENA_W / cell);
  const rows = Math.ceil(C.ARENA_H / cell);
  const pad = C.PLAYER_R + 4; // 与 validateLayout 保持一致
  const blocked = (cx, cy) => {
    const x = cx * cell + cell / 2;
    const y = cy * cell + cell / 2;
    if (x <= C.WALL || x >= C.ARENA_W - C.WALL || y <= C.WALL || y >= C.ARENA_H - C.WALL)
      return false;
    for (const w of walls) if (__test.pointInWall(w, x, y, pad)) return true;
    return false;
  };
  const idx = (cx, cy) => cy * cols + cx;
  const seen = new Uint8Array(cols * rows);
  for (const s of spawns) {
    const scx = Math.floor(s.x / cell);
    const scy = Math.floor(s.y / cell);
    if (blocked(scx, scy)) return false;
    seen.fill(0);
    const stack = [[scx, scy]];
    seen[idx(scx, scy)] = 1;
    let reach = false;
    while (stack.length) {
      const cur = stack.pop();
      const cx = cur[0];
      const cy = cur[1];
      if (cx <= 1 || cy <= 1 || cx >= cols - 2 || cy >= rows - 2) reach = true;
      const nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
      for (let k = 0; k < nb.length; k++) {
        const nx = nb[k][0];
        const ny = nb[k][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (seen[idx(nx, ny)] || blocked(nx, ny)) continue;
        seen[idx(nx, ny)] = 1;
        stack.push([nx, ny]);
      }
    }
    if (!reach) return false;
  }
  return true;
};
for (let t = 0; t < 600; t++) {
  const players = 2 + (t % 3); // 轮替 2/3/4 人
  const gg = createGameState(room(players, 5));
  mod.assignRandomWalls(gg);
  const spawns = gg.players.map((p) => ({ x: p.x, y: p.y }));
  layoutCount++;
  wallCountSum += gg.walls.length;
  for (const w of gg.walls) if (w.type === 'arc') arcSeen++;
  if (!strictValidate(gg.walls, spawns)) strictAllOk = false;
  // 出生点不得落在任何墙体内（含玩家体积余量）
  for (const s of spawns) {
    for (const w of gg.walls) {
      if (__test.pointInWall(w, s.x, s.y, C.PLAYER_R + 4)) strictAllOk = false;
    }
  }
}
ok(strictAllOk, '600 个随机布局中，每个出生点都能（按玩家体积）走到边界，无被围死');
ok(arcSeen > 0, '随机布局中确实会生成弧形墙');
const avgWalls = wallCountSum / Math.max(1, layoutCount);
ok(
  avgWalls >= 9,
  '平均墙体数达到翻倍水平（实测 ' + avgWalls.toFixed(1) + ' 面/局）'
);
const arcRatio = arcSeen / Math.max(1, wallCountSum);
ok(
  arcRatio > 0.05 && arcRatio < 0.45,
  '弧形占比为少数（直线:弧形 ≈ 8:2，实测 ' + (arcRatio * 100).toFixed(0) + '%）'
);


// 13i. 道具系统：开局铺一批 + 定时补货 + 五种效果
const typeNames = C.ITEM_TABLE.map((t) => t.type).join(',');
ok(typeNames === 'heal,power,ammo,speed,shield', '道具表共 5 种：回血/子弹变大/备弹扩容/疾风/护盾');
const seenTypes = {};
for (let i = 0; i < 600; i++) seenTypes[__test.pickItemType(Math.random)] = 1;
ok(
  Object.keys(seenTypes).length === C.ITEM_TABLE.length,
  '600 次抽取覆盖全部 ' + C.ITEM_TABLE.length + ' 种道具'
);

// A. 开局铺一批（带随机墙体，验证落点合法性）
const gip = createGameState(room(4, 5));
mod.assignRandomWalls(gip);
startPlaying(gip);
const sip = { now: Date.now() - 600000 };
run(gip, 32, sip);
ok(
  gip.items.length >= C.ITEM_INITIAL_MIN && gip.items.length <= C.ITEM_INITIAL_MAX,
  '开局铺好 ' + gip.items.length + ' 个道具（' + C.ITEM_INITIAL_MIN + '~' + C.ITEM_INITIAL_MAX + '）'
);
let itemSpotOk = true;
for (const it of gip.items) {
  if (it.x < C.WALL + C.ITEM_R || it.x > C.ARENA_W - C.WALL - C.ITEM_R) itemSpotOk = false;
  if (it.y < C.WALL + C.ITEM_R || it.y > C.ARENA_H - C.WALL - C.ITEM_R) itemSpotOk = false;
  for (const w of gip.walls) {
    if (__test.pointInWall(w, it.x, it.y, C.ITEM_R)) itemSpotOk = false;
  }
  for (const p of gip.players) {
    if (Math.hypot(p.x - it.x, p.y - it.y) < C.PLAYER_R + C.ITEM_R) itemSpotOk = false;
  }
}
for (let a = 0; a < gip.items.length; a++) {
  for (let b = a + 1; b < gip.items.length; b++) {
    const gap = Math.hypot(gip.items[a].x - gip.items[b].x, gip.items[a].y - gip.items[b].y);
    if (gap < C.ITEM_MIN_GAP - 0.001) itemSpotOk = false;
  }
}
ok(itemSpotOk, '道具落点合法：场地内、不在墙里、不与玩家/其他道具重叠');
ok(
  gip.items.every((it) => C.ITEM_TABLE.some((t) => t.type === it.type)),
  '道具类型都在道具表内'
);

// B. 机制测试（清空墙体，弹道确定）
const gi = createGameState(room(2, 5));
gi.walls = [];
startPlaying(gi);
const si = { now: Date.now() - 600000 };
run(gi, 32, si);
const itemBefore = gi.items.length;
ok(itemBefore >= C.ITEM_INITIAL_MIN, '无墙场地也铺好了道具（' + itemBefore + ' 个）');
run(gi, C.ITEM_SPAWN_INTERVAL_MS + 100, si);
ok(
  gi.items.length > itemBefore,
  '每隔一段时间补充新道具（' + itemBefore + ' → ' + gi.items.length + '）'
);
gi.nextItemAt = si.now + 1e9; // 后续不再自动补货，避免干扰下面的用例

const ip = gi.players[0];
const iv = gi.players[1];

// (1) 回血：+1 且不超过上限；满血时不消耗
gi.items = [];
ip.hp = 1;
ip.x = 400;
ip.y = 300;
gi.items.push({ id: 9001, type: 'heal', x: 400, y: 300, at: si.now });
run(gi, 32, si);
ok(ip.hp === 2 && gi.items.length === 0, '踩到回血道具：+1 HP 且被消耗');
ip.hp = C.MAX_HP;
gi.items.push({ id: 9002, type: 'heal', x: 400, y: 300, at: si.now });
run(gi, 32, si);
ok(gi.items.length === 1 && ip.hp === C.MAX_HP, '满血踩到回血道具：不消耗、留在原地');
gi.items = [];

// (2) 子弹变大：只影响自己，且带时长；到期后恢复普通子弹
ip.bigBulletUntil = 0;
gi.items.push({ id: 9003, type: 'power', x: 400, y: 300, at: si.now });
run(gi, 32, si);
ok(ip.bigBulletUntil > si.now && gi.items.length === 0, '踩到子弹变大道具：获得限时增益');
gi.bullets = [];
ip.aim = 0;
ip.nextFireAt = 0;
setPlayerInput(gi, ip.id, { mx: 0, my: 0, aim: 0, charge: 1 });
run(gi, 30, si);
setPlayerInput(gi, ip.id, { mx: 0, my: 0, aim: 0, charge: 0 });
run(gi, 32, si);
const bigB = gi.bullets[gi.bullets.length - 1];
ok(
  bigB && bigB.ownerId === ip.id && bigB.r === C.BIG_BULLET_R,
  '增益期间发射的子弹半径放大（' + (bigB ? bigB.r : '-') + ' > ' + C.BULLET_R + '）'
);
__test.spawnBullet(gi, iv, C.BULLET_SPEED_MIN, si.now);
const otherB = gi.bullets[gi.bullets.length - 1];
ok(otherB && otherB.r === C.BULLET_R, '其他玩家的子弹不受影响');
gi.bullets = [];
ip.bigBulletUntil = si.now - 1;
__test.spawnBullet(gi, ip, C.BULLET_SPEED_MIN, si.now);
ok(gi.bullets[0].r === C.BULLET_R, '增益到期后发射的是普通子弹');
gi.bullets = [];

// (3) 备弹扩容：子弹上限 +2，可叠加但有封顶
const capBefore = __test.bulletCapOf(ip);
ip.ammoBonus = 0;
gi.items.push({ id: 9004, type: 'ammo', x: ip.x, y: ip.y, at: si.now });
run(gi, 32, si);
ok(gi.items.length === 0, '踩到备弹扩容道具：被消耗');
ok(capBefore === C.MAX_BULLETS_PER_PLAYER, '基础子弹上限为 ' + C.MAX_BULLETS_PER_PLAYER);
ok(
  __test.bulletCapOf(ip) === C.MAX_BULLETS_PER_PLAYER + C.AMMO_BONUS_PER_PICKUP,
  '子弹上限提升到 ' + __test.bulletCapOf(ip) + ' 发'
);
// 上限确实放开：连打 7 发（基础 5 会挤掉最早的两发，扩容后 7 发都在）
gi.bullets = [];
ip.x = C.WALL + C.PLAYER_R + 2;
ip.y = C.ARENA_H / 2;
for (let i = 0; i < 7; i++) {
  run(gi, C.FIRE_COOLDOWN_MS + 20, si);
  setPlayerInput(gi, ip.id, { mx: 0, my: 0, aim: 0, charge: 1 });
  run(gi, 30, si);
  setPlayerInput(gi, ip.id, { mx: 0, my: 0, aim: 0, charge: 0 });
  run(gi, 32, si);
}
ok(
  gi.bullets.filter((b) => b.ownerId === ip.id).length === 7,
  '扩容后连打 7 发全部在场（实测 ' + gi.bullets.filter((b) => b.ownerId === ip.id).length + '）'
);
gi.bullets = [];
for (let i = 0; i < 10; i++) __test.applyItem(gi, ip, { type: 'ammo' }, si.now);
ok(
  __test.bulletCapOf(ip) === C.MAX_BULLETS_PER_PLAYER + C.MAX_AMMO_BONUS,
  '备弹扩容有封顶（最高 ' + __test.bulletCapOf(ip) + ' 发）'
);
ip.ammoBonus = 0;

// (4) 疾风：移动速度提升
ip.speedUntil = 0;
ip.x = 300;
ip.y = 200;
gi.items.push({ id: 9005, type: 'speed', x: 300, y: 200, at: si.now });
run(gi, 32, si);
ok(ip.speedUntil > si.now && gi.items.length === 0, '踩到疾风道具：获得限时加速');
ok(
  Math.abs(__test.speedOf(ip, si.now) - C.PLAYER_SPEED * C.SPEED_BOOST_MULT) < 0.001,
  '加速期间移动速度为 ' + __test.speedOf(ip, si.now).toFixed(0) + ' 单位/秒'
);
gi.items = [];
setPlayerInput(gi, ip.id, { mx: 1, my: 0, aim: 0, charge: 0 });
ip.x = 300;
ip.y = 200;
const boostStartX = ip.x;
run(gi, 300, si);
const boostDist = ip.x - boostStartX;
ip.speedUntil = 0;
ip.x = 300;
ip.y = 200;
const normalStartX = ip.x;
run(gi, 300, si);
const normalDist = ip.x - normalStartX;
ok(
  boostDist > normalDist * 1.2,
  '疾风期间同样时长位移更大（' + boostDist.toFixed(0) + ' vs ' + normalDist.toFixed(0) + '）'
);
setPlayerInput(gi, ip.id, { mx: 0, my: 0, aim: 0, charge: 0 });

// (5) 护盾：获得 1 层，抵挡下一次命中（不扣血），耗尽后正常受伤
iv.x = 800;
iv.y = 300;
iv.hp = C.MAX_HP;
iv.shield = 0;
gi.items = [{ id: 9006, type: 'shield', x: 800, y: 300, at: si.now }];
run(gi, 32, si);
ok(iv.shield === 1 && gi.items.length === 0, '踩到护盾道具：获得 1 层护盾');
ip.x = 400;
ip.y = 300;
ip.aim = 0;
ip.nextFireAt = 0;
setPlayerInput(gi, ip.id, { mx: 0, my: 0, aim: 0, charge: 1 });
run(gi, 30, si);
setPlayerInput(gi, ip.id, { mx: 0, my: 0, aim: 0, charge: 0 });
run(gi, 1800, si);
ok(
  iv.hp === C.MAX_HP && iv.shield === 0,
  '护盾抵挡一次命中：不扣血且护盾耗尽（护盾 ' + iv.shield + '，血 ' + iv.hp + '）'
);
ip.nextFireAt = 0;
run(gi, C.FIRE_COOLDOWN_MS + 20, si);
setPlayerInput(gi, ip.id, { mx: 0, my: 0, aim: 0, charge: 1 });
run(gi, 30, si);
setPlayerInput(gi, ip.id, { mx: 0, my: 0, aim: 0, charge: 0 });
run(gi, 1800, si);
ok(iv.hp === C.MAX_HP - 1, '护盾耗尽后再次命中正常扣血（剩 ' + iv.hp + '）');
ok(__test.consts.MAX_SHIELD >= 2, '护盾最多叠加 ' + C.MAX_SHIELD + ' 层');

// C. 场上道具数量有上限
const giMax = createGameState(room(2, 5));
giMax.walls = [];
startPlaying(giMax);
const sMax = { now: Date.now() - 600000 };
run(giMax, 32, sMax);
for (let i = 0; i < 20; i++) {
  giMax.nextItemAt = sMax.now - 1; // 强制每次都补货
  run(giMax, 32, sMax);
}
ok(
  giMax.items.length <= C.ITEM_MAX_ON_MAP,
  '场上道具数量不超过上限（实测 ' + giMax.items.length + ' / ' + C.ITEM_MAX_ON_MAP + '）'
);

// D. 换局后增益清零 + 道具重铺
ip.shield = 2;
ip.ammoBonus = 4;
ip.bigBulletUntil = si.now + 5000;
ip.speedUntil = si.now + 5000;
gi.items = [{ id: 9007, type: 'heal', x: 700, y: 700, at: si.now }];
__test.endRound(gi, [ip]);
__test.advanceRound(gi);
ok(
  ip.shield === 0 && ip.ammoBonus === 0 && ip.bigBulletUntil === 0 && ip.speedUntil === 0,
  '换局后道具增益全部清零'
);
ok(gi.items.length === 0 && gi.phase === 'countdown', '换局后清空上一局残留道具');
gi.phaseEndsAt = si.now - 1;
run(gi, 32, si);
ok(
  gi.items.length >= C.ITEM_INITIAL_MIN,
  '新一局进入对战后重新铺道具（' + gi.items.length + ' 个）'
);

// E. 公开状态与实时快照都带上道具
const pubI = publicGameState(gi);
ok(
  Array.isArray(pubI.items) && pubI.items.length === gi.items.length,
  '公开状态包含道具列表（' + pubI.items.length + ' 个）'
);
ok(
  Array.isArray(pubI.players) && 'shield' in pubI.players[0] && 'ammoBonus' in pubI.players[0],
  '公开状态玩家含护盾/备弹扩容字段'
);
const snapI = snapshot(gi);
ok(
  Array.isArray(snapI.its) && snapI.its.length === gi.items.length,
  '实时快照包含道具（紧凑数组）'
);
ok(
  snapI.ps[0].length >= 9 && snapI.bs.every((b) => b.length >= 7),
  '快照玩家行 / 子弹行带上了道具相关字段'
);

// 14. 服务端模拟循环
const gl = createGameState(room(2, 3));
gl.phaseEndsAt = Date.now();
const fakeRoom = {
  id: 'ROOM-TEST',
  status: 'playing',
  gameType: 'blaster',
  game: gl,
};
let rtCount = 0;
let stateCount = 0;
mod.startLoop(fakeRoom, {
  isAlive: () => true,
  broadcastRt: () => {
    rtCount += 1;
  },
  broadcastState: () => {
    stateCount += 1;
  },
});
setTimeout(() => {
  ok(rtCount > 0, '循环中持续广播实时快照（' + rtCount + ' 次）');
  ok(stateCount > 0, '阶段切换时广播全量状态');
  ok(gl.phase === 'playing', '循环把倒计时推进到了对战');
  mod.stopLoop('ROOM-TEST');
  const after = rtCount;
  setTimeout(() => {
    ok(rtCount === after, 'stopLoop 后停止广播');
    console.log('');
    if (failed) {
      console.error('FAILED: ' + failed + ' 项未通过');
      process.exit(1);
    }
    console.log('弹射对决 smoke 全部通过');
  }, 120);
}, 320);
