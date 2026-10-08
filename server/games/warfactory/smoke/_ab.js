'use strict';

/**
 * A/B 对战评估：node server/games/warfactory/smoke/_ab.js [局数] [每局秒数]
 *
 * P0 用「当前 bot.js」，P1 用「冻结基线 smoke/_base.js」；每个种子**两个座位各打一局**，
 * 用净胜场 + 成对总部血差衡量改动到底是变强还是变弱（单看「能不能分胜负」噪声太大）。
 *
 * 用法：node _ab.js [种子数] [每局秒数] [NEW模块] [OLD模块] [种子起点]
 *   node _ab.js 24 2400 ../bot.js ./_base.js 100   —— 对比冻结基线（看整体进化了多少）
 *   node _ab.js 24 2400 ./_vX.js   ./_best.js 100  —— 自对弈（调参；_best.js 是本轮开始时
 *                                                      `cp ../bot.js` 下来的冻结副本，中途别覆盖）
 *
 * ⚠️⚠️ 分辨率极限（血泪教训）：48 局下**同模块互打的噪声底就有 ±2500**，
 * 训练集（种子 100+）和验证集（种子 200+）会给同一改动打出**反号**的结果
 * （实测 kh3：训练 +1476、验证 −1690）。所以：
 *   ① 任何候选都必须在**至少两批种子**上同号才可信；
 *   ② 只有 vs 冻结基线那种 +8000 量级才是铁证，几百到两千的都可能是噪声。
 */

const mod = require('..');
const NEW = require(process.argv[4] || '../bot.js');
// 第 5 参可指定「对手」：默认冻结基线（看整体进化了多少）；
// 传 '../bot.js' 则变成**自对弈**（候选 vs 当前版本）——净胜场饱和后只有自对弈才分得出高下。
const OLD = require(process.argv[5] || './_base.js');
const { resetRandom } = require('./_det.js');
const { createGameState, setPlayerInput, __test } = mod;

const N = Number(process.argv[2] || 8);
const MAX_SECONDS = Number(process.argv[3] || 2400);
// 第 6 参：种子起点。24 局的噪声能盖过 2000 分的差距，
// 所以「调参用 100+」和「验证用 200+」必须分开，别在训练集上自我说服。
const SEED_BASE = Number(process.argv[6] || 100);
const DT = 0.1;
const THINK_MS = 700;

function run(seed, newIsP0) {
  resetRandom(seed);
  const room = {
    id: 'wfbot_ab_' + seed + '_' + (newIsP0 ? 'a' : 'b'),
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

  const seats = newIsP0 ? [NEW, OLD] : [OLD, NEW];
  const st = [{}, {}];
  const nextAt = [0, 0];

  for (let s = 0; s < Math.round(MAX_SECONDS / DT) && !game.over; s++) {
    // ⚠️ 座位必须**完全对称**，否则「座位红利」比被测的改动还大：
    // ① 两席思考错峰必须一致（早先 +40/+120，同模块互打能跑出 +5095 的假增益）；
    // ② 同一 tick 里两席的指令按奇偶轮转先后生效，消掉先手优势。
    now += DT * 1000;
    const order = s % 2 === 0 ? [0, 1] : [1, 0];
    for (const i of order) {
      if (now < nextAt[i]) continue;
      nextAt[i] = now + THINK_MS;
      let cmds = null;
      try {
        cmds = seats[i].think(game, game.players[i].id, 'hard', st[i], now);
      } catch (e) {
        console.error('think failed', e && e.message);
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
  }
  const t = (now - 1000) / 1000;
  const hq = game.hqs.map((h) => Math.round(h.hp));
  let res = 'draw';
  if (game.over && game.winnerId) {
    const w = game.players.findIndex((p) => p.id === game.winnerId);
    const newWon = (w === 0) === newIsP0;
    res = newWon ? 'NEW' : 'OLD';
  } else {
    // 没分胜负：按「谁把对面打得更惨」判优势方
    const newIdx = newIsP0 ? 0 : 1;
    const oldIdx = newIsP0 ? 1 : 0;
    if (hq[oldIdx] < hq[newIdx] * 0.85) res = 'NEW+';
    else if (hq[newIdx] < hq[oldIdx] * 0.85) res = 'OLD+';
  }
  console.log(`  seed=${seed} ${newIsP0 ? 'NEW=先手方' : 'NEW=后手方'} t=${t.toFixed(0)}s ${res} hq=${hq.join('/')}`);
  // 净胜场已经在 16 局里打到 16:0 —— 胜负本身分不出高下了，得有**连续量**才看得见强弱。
  // margin = NEW 总部剩余 − OLD 总部剩余（越大越强）；分出胜负时按剩余时间给个额外奖励
  // （早 1 秒结束 ≈ 多 3 点，让「打得更快」也能体现在分数上）。
  const newIdx = newIsP0 ? 0 : 1;
  const oldIdx = newIsP0 ? 1 : 0;
  // 三个量分开记：配对之后「总部血差」和「时间奖励」性质完全不同 ——
  // 时间奖励是**两局都拿**的（≈ 常数偏置，同模块互打也有 ~2500），只有血差才是真信号。
  const bonus = game.over ? (MAX_SECONDS - t) * 3 : 0;
  return { res, margin: hq[newIdx] - hq[oldIdx], bonus };
}

// ⚠️⚠️ 每个种子**两个座位各打一局**，再把两局的 margin 平均。
// 早先「偶数种子 NEW=P0、奇数种子 NEW=P1」把座位和种子混在一起，而座位本身是主导因素
// （两个**同一个模块**互打，48 局能跑出 +667 / +2860 的假增益、胜负 20:30），
// 那样测出来的东西全是噪声。成对跑之后座位效应逐种子精确抵消。
let tally = { NEW: 0, OLD: 0, 'NEW+': 0, 'OLD+': 0, draw: 0 };
let marginSum = 0;
let bonusSum = 0;
let games = 0;
for (let k = 0; k < N; k++) {
  const seed = SEED_BASE + k;
  const a = run(seed, true);
  const b = run(seed, false);
  tally[a.res] += 1;
  tally[b.res] += 1;
  marginSum += (a.margin + b.margin) / 2;
  bonusSum += (a.bonus + b.bonus) / 2;
  games += 2;
}
const win = tally.NEW + tally['NEW+'];
const lose = tally.OLD + tally['OLD+'];
console.log(`\n新 bot 净胜 ${win} : ${lose}（占优未分胜负 ${tally['NEW+']}:${tally['OLD+']}，平 ${tally.draw}）`);
console.log(
  `成对总部血差 ${(marginSum / N).toFixed(0)}（真信号）｜提前结束奖励 ${(bonusSum / N).toFixed(0)}（常数偏置，越大＝打得越快）｜共 ${games} 局`
);
