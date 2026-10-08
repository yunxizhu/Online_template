'use strict';
/**
 * 临时探针：直射弹（锐士 / 盾卫，弹速 9999）在不同 dt 与不同距离下的**实际命中率**。
 * 用来量化「弹道细分被 clamp 到 16 后，高速弹一步跨过命中窗口」这一隐患有多严重。
 * 用法：node smoke/_hitprobe.js
 */
const mod = require(process.env.WF_MOD || '..');
const { createGameState, __test } = mod;
const C = __test.consts;

function flat(game) {
  // ⚠️ 必须保证「射手 → 靶子 → 靶子再往外」整条射线都是空地：
  //    弹速 9999 一帧就飞 1000px，中途撞到任何一座山都会被判成「打空」，
  //    那是正常规则（山挡弹道），不是命中 bug —— 选点不干净就量不出真问题。
  const NEED = 24; // 格（240px，覆盖最远测距 + 余量）
  const t = game.terrain;
  for (let r = 2; r < t.rows - 2; r++) {
    for (let c = 2; c + NEED < t.cols - 2; c++) {
      let okSpot = true;
      for (let k = 0; k <= NEED; k++) {
        const v = t.grid[r][c + k];
        if (v === C.TT_MOUNTAIN || v === C.TT_WATER) okSpot = false;
      }
      // 上下各留一格，免得单位被推挤时挪进山里改变距离
      if (t.grid[r - 1][c] === C.TT_MOUNTAIN || t.grid[r + 1][c] === C.TT_MOUNTAIN) okSpot = false;
      if (okSpot) return { x: (c + 0.5) * t.cell, y: (r + 0.5) * t.cell };
    }
  }
  return { x: 200, y: 200 };
}

// 只建一次局面（createGameState 很贵），后面每轮只重置两个兵
const g = createGameState({ players: [{ id: 'p0', name: '甲' }, { id: 'p1', name: '乙' }] });
g.phase = 'playing';
g.phaseEndsAt = 0;
g.units.length = 0;
g.bullets.length = 0;
const S = flat(g);
const A = __test.spawnUnit(g, { id: 1, owner: 0, level: 3 }, 'warrior', S.x, S.y);
const B = __test.spawnUnit(g, { id: 1, owner: 1, level: 1 }, 'shield', S.x + 100, S.y);
const HP_B = C.STATS.shield.hp;

function trial(type, dist, dt) {
  // 换兵种：直接改属性（STATS 是像素版，照抄 spawnUnit/Evolve 的结果）
  const st = C.STATS[type];
  A.type = type;
  A.range = st.range;
  A.dmg = st.dmg;
  A.cdMax = st.cd;
  A.cdLeft = 0;
  A.bulletSpeed = st.bulletSpeed;
  A.splash = st.splash || 0;
  A.x = S.x;
  A.y = S.y;
  A.scanAt = 0;
  A.moveX = null;
  A.moveY = null;
  // ⚠️ 上一轮把靶子打死之后 reapDead 会把它移出 game.units —— 不放回去就等于后面几轮
  //   射手根本没有目标，统计出来的「0% 命中」是探针自己的锅，不是弹道的问题。
  if (!g.units.includes(A)) g.units.push(A);
  if (!g.units.includes(B)) g.units.push(B);
  A.dead = false;
  A.hp = 1e9; // 射手别被还击打死，否则轮到第三轮就没射手了
  B.x = S.x + dist;
  B.y = S.y;
  B.hp = HP_B;
  B.dead = false;
  B.scanAt = 0;
  B.moveX = null;
  B.moveY = null;
  g.bullets.length = 0;
  let now = 20000;
  const why = { spark: 0, boom: 0, hit: 0, shot: 0 };
  let lastX = null;
  for (let i = 0; i < 40; i++) {
    A.scanAt = 0;
    B.scanAt = 0;
    A.moveX = null;
    A.moveY = null;
    B.moveX = null;
    B.moveY = null;
    now += Math.round(dt * 1000);
    __test.step(g, dt, now);
    for (const e of g.events) if (why[e.t] != null) why[e.t] += 1;
    if (g.bullets.length) lastX = Math.round(g.bullets[0].x - A.x);
    if (B.hp < HP_B) return { hit: true, why, lastX };
    if (i > 2 && g.bullets.length === 0) break;
  }
  return { hit: B.hp < HP_B, why, lastX };
}

// 诊断模式：WF_DEBUG=<距离> WF_DT=<dt> node smoke/_hitprobe.js
if (process.env.WF_DEBUG) {
  const r = trial('warrior', Number(process.env.WF_DEBUG), Number(process.env.WF_DT || 0.1));
  console.log('诊断', JSON.stringify(r));
  process.exit(0);
}

const dists = [70, 110, 150, 180];
for (const type of ['warrior', 'shield']) {
  for (const dt of [0.05, 0.1, 0.25]) {
    const line = [];
    for (const d of dists) {
      let hit = 0;
      const N = 30;
      for (let i = 0; i < N; i++) if (trial(type, d, dt).hit) hit += 1;
      line.push(`${d}px ${Math.round((hit / N) * 100)}%`);
    }
    console.log(`${type.padEnd(8)} dt=${dt}  ${line.join('  ')}`);
  }
}
