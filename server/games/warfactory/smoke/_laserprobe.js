'use strict';

/**
 * 激光锁定探针（临时诊断用）：在**真实服务端**上跑 bot 对局，统计激光兵的锁被换掉多少次、
 * 平均倍率是多少。用来回答「锁定死咬到底带来多少增益」。
 *
 * 用法：node smoke/_laserprobe.js [种子数] [每局秒数] [种子起点]
 *   模块由环境变量 WF_MOD 指定（默认 '..' = 当前 index.js；'_old_index' = 关掉死咬的对照版）
 */

const mod = require(process.env.WF_MOD || '..');
const BOT = require('../bot.js');
const { resetRandom } = require('./_det.js');
const { createGameState, setPlayerInput, __test } = mod;

const N = Number(process.argv[2] || 2);
const MAX_SECONDS = Number(process.argv[3] || 2400);
const SEED_BASE = Number(process.argv[4] || 100);
const DT = 0.1;
const THINK_MS = 700;

function run(seed) {
  resetRandom(seed);
  const room = {
    id: 'wf_lp_' + seed,
    players: [
      { id: 'p0', name: 'P0', isBot: true, botDifficulty: 'hard' },
      { id: 'p1', name: 'P1', isBot: true, botDifficulty: 'hard' },
    ],
    mapSeed: seed,
    theme: 'classic',
  };
  const game = createGameState(room);
  room.game = game;
  let now = 1000;
  game.phase = 'playing';
  game.phaseEndsAt = 0;
  game._lastTick = now;

  const st = [{}, {}];
  const nextAt = [0, 0];
  const prevKey = new Map(); // unitId -> 上一 tick 的 lockKey
  let switches = 0; // 换锁次数（含「锁丢失后重新锁上」）
  let samples = 0;
  let mulSum = 0;
  let laserTicks = 0; // 激光兵在场 tick 数
  let lockedTicks = 0; // 其中有锁的 tick 数

  for (let s = 0; s < Math.round(MAX_SECONDS / DT) && !game.over; s++) {
    now += DT * 1000;
    const order = s % 2 === 0 ? [0, 1] : [1, 0];
    for (const i of order) {
      if (now < nextAt[i]) continue;
      nextAt[i] = now + THINK_MS;
      let cmds = null;
      try {
        cmds = BOT.think(game, game.players[i].id, 'hard', st[i], now);
      } catch (_) {
        continue;
      }
      if (!Array.isArray(cmds)) continue;
      for (const c of cmds) {
        try {
          setPlayerInput(game, game.players[i].id, c, now);
        } catch (_) {}
      }
    }
    __test.step(game, DT, now);

    for (const u of game.units) {
      if (u.dead || !u.laser) continue;
      laserTicks++;
      const k = u.lockKey || '';
      if (k) {
        lockedTicks++;
        samples++;
        mulSum += u.lockMul || 1;
      }
      const p = prevKey.get(u.id);
      if (p !== undefined && p !== k) switches++;
      prevKey.set(u.id, k);
    }
  }
  return { switches, samples, mulSum, laserTicks, lockedTicks, t: (now - 1000) / 1000, over: game.over };
}

let S = 0;
let SAMP = 0;
let MUL = 0;
let LT = 0;
let LK = 0;
for (let k = 0; k < N; k++) {
  const r = run(SEED_BASE + k);
  S += r.switches;
  SAMP += r.samples;
  MUL += r.mulSum;
  LT += r.laserTicks;
  LK += r.lockedTicks;
  console.log(`  seed=${SEED_BASE + k} t=${r.t.toFixed(0)}s 换锁 ${r.switches} 平均倍率 ${(r.mulSum / Math.max(1, r.samples)).toFixed(2)} 有锁率 ${((r.lockedTicks / Math.max(1, r.laserTicks)) * 100).toFixed(0)}%`);
}
console.log(
  `\n合计 ${N} 局：换锁 ${S} 次｜平均倍率 ${(MUL / Math.max(1, SAMP)).toFixed(2)}｜有锁率 ${((LK / Math.max(1, LT)) * 100).toFixed(0)}%`
);
