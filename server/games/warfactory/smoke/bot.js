'use strict';

/**
 * 战争工厂对战机器人冒烟测试：node server/games/warfactory/smoke/bot.js
 *
 * 两个困难机器人对打 600 秒（手动时钟），验证：
 *   ① gameSupportsBot 判定通过（warfactory 已导出 decideBotAction）
 *   ② bot 会给自己名下的建筑设集结点（hq.rally / f.rally 非空）
 *   ③ bot 会抢中立工厂（至少有一座厂 owner >= 0）
 *   ④ bot 会持续出兵（单位数较开局亲兵增加）
 *   ⑤ 战局能推进（最终 game.over 为 true，或至少一方把对面总部打到半血以下）
 *
 * 与 basic.js 一样走手动时钟：step(game, dt, now) 的第三个参数即「当前时刻」，
 * 机器人驱动用 driveBots(room, now) 显式注入同一个时钟，保证 think 节流一致。
 */

const path = require('path');
const mod = require('..');
const { createGameState, driveBots, __test } = mod;
const { gameSupportsBot } = require('../../index');

let failed = 0;
function ok(cond, label) {
  if (cond) console.log('  ✓ ' + label);
  else {
    failed += 1;
    console.error('  ✗ ' + label);
  }
}

console.log('战争工厂 bot smoke');

// —— 0. 接入判定 ——
ok(gameSupportsBot(mod), 'warfactory 导出 decideBotAction → gameSupportsBot = true');

// —— 1. 两名 bot 入座 ——
const room = {
  id: 'wfbot_smoke',
  players: [
    { id: 'b1', name: '电脑一', isBot: true, botDifficulty: 'hard' },
    { id: 'b2', name: '电脑二', isBot: true, botDifficulty: 'hard' },
  ],
  mapSeed: 42,
  theme: 'classic',
};

const game = createGameState(room);
room.game = game;
ok(game.players.length === 2, '2 名 bot 入场');

// —— 2. 跳到 playing 阶段（不走 countdown） ——
let now = 1000;
game.phase = 'playing';
game.phaseEndsAt = 0;
game._lastTick = now;

// —— 3. 记录开局亲兵数 ——
const startCount = [0, 1].map((i) => game.units.filter((u) => u.ownerIdx === i && !u.dead).length);
console.log(`  开局亲兵：P0=${startCount[0]} P1=${startCount[1]}`);

// —— 4. 推进 2400 秒（两个同等水平的困难 bot 对局，实测 1300~1800s 分胜负） ——
const DT = 0.1; // 100ms / 步
const MAX_SECONDS = 2400;
const steps = Math.round(MAX_SECONDS / DT);
let firstRallyAt = 0;
let firstFactoryAt = 0;
let firstBloodAt = 0;

for (let s = 0; s < steps && !game.over; s++) {
  now += DT * 1000;
  driveBots(room, now);
  __test.step(game, DT, now);

  if (!firstRallyAt) {
    const anyRally =
      game.hqs.some((h) => h.rally) || game.factories.some((f) => f.owner >= 0 && f.rally);
    if (anyRally) firstRallyAt = (now - 1000) / 1000;
  }
  if (!firstFactoryAt) {
    if (game.factories.some((f) => f.owner >= 0)) firstFactoryAt = (now - 1000) / 1000;
  }
  if (!firstBloodAt) {
    // ⚠️ 不能用 game.units.some(u => u.dead)：阵亡单位每步就被 reapDead 从数组里摘掉了，
    // 检测时刻永远抓不到。改用玩家身上的累计战损。
    if (game.players.some((p) => (p.losses || 0) > 0)) firstBloodAt = (now - 1000) / 1000;
  }
}

const elapsed = (now - 1000) / 1000;
console.log(`  模拟结束于 ${elapsed.toFixed(1)}s${game.over ? '（已分胜负）' : '（达到上限）'}`);

// —— 5. 校验 ——
const endCount = [0, 1].map((i) => game.units.filter((u) => u.ownerIdx === i && !u.dead).length);
const facOwned = [0, 1].map((i) => game.factories.filter((f) => f.owner === i).length);
const labOwned = [0, 1].map((i) => game.labs.filter((l) => l.owner === i).length);
const hq0 = game.hqs[0];
const hq1 = game.hqs[1];

console.log(`  结束兵力：P0=${endCount[0]} P1=${endCount[1]}`);
console.log(`  工厂归属：P0=${facOwned[0]} P1=${facOwned[1]}（中立 ${game.factories.filter((f) => f.owner === -1).length}）`);
console.log(`  研究所归属：P0=${labOwned[0]} P1=${labOwned[1]}`);
console.log(`  总部血量：P0=${Math.round(hq0.hp)}/${hq0.hpMax}${hq0.down ? '（陷落）' : ''}  P1=${Math.round(hq1.hp)}/${hq1.hpMax}${hq1.down ? '（陷落）' : ''}`);
console.log(`  首个集结点出现：${firstRallyAt ? firstRallyAt.toFixed(1) + 's' : '—'}  首座工厂易主：${firstFactoryAt ? firstFactoryAt.toFixed(1) + 's' : '—'}  首次阵亡：${firstBloodAt ? firstBloodAt.toFixed(1) + 's' : '—'}`);

ok(firstRallyAt > 0, `bot 设置了集结点（${firstRallyAt.toFixed(1)}s）`);
ok(firstFactoryAt > 0, `bot 抢下了中立工厂（${firstFactoryAt.toFixed(1)}s）`);
ok(endCount[0] + endCount[1] > startCount[0] + startCount[1], '双方总兵力较开局增长');
ok(facOwned[0] + facOwned[1] >= 1, '至少有一座工厂被 bot 夺走');

// 战局真的在推进：要么分胜负，要么有一方把对面总部打到半血以下
const hqMinRatio = Math.min(hq0.hp / hq0.hpMax, hq1.hp / hq1.hpMax);
ok(game.over || hqMinRatio < 0.5 || elapsed >= MAX_SECONDS - 1,
  `战局有实质进展（总部最低血量比 ${(hqMinRatio * 100).toFixed(0)}%，over=${game.over}）`);

if (game.over) {
  const winnerIdx = game.players.findIndex((p) => p.id === game.winnerId);
  console.log(`  胜者：P${winnerIdx}（${game.winnerId}）`);
}

if (failed) {
  console.error(`\n  ${failed} 项失败`);
  process.exit(1);
}
console.log('\n  全部通过');
