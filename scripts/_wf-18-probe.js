'use strict';

/**
 * 定向探针：复现 smoke/basic.js 第 18 节「弹体携带兵种与阶数」的第一段，
 * 诊断 warrior 为什么**有时候一个弹体都打不出来**（开去毛刺后偶发）。
 *
 * 用法：node scripts/_wf-18-probe.js [轮数]
 *   WF_NODESPECKLE=1 关掉去毛刺做对照。
 *
 * 每轮都新建一局（**不冻结** Date.now/Math.random）—— 因为 basic.js 本身就是随机的，
 * 目的就是量「随机地形下这一项多久翻一次车」。
 */

const mod = require('../server/games/warfactory');
const { createGameState, __test } = mod;
const C = __test.consts;

const room = (count) => ({ players: Array.from({ length: count }, (_, i) => ({ id: 'p' + i, name: '玩家' + i })) });

function findFlatSpot(game, gap) {
  const blocks = [...game.factories, ...game.labs, ...game.hqs];
  for (const far of [420, 300, 200, 120, 0]) {
    for (let y = 200; y < 1400; y += 40) {
      for (let x = 200; x < 2200; x += 40) {
        if (!__test.canStand(game, x, y, 14)) continue;
        if (!__test.canStand(game, x + gap / 2, y, 14)) continue;
        if (!__test.canStand(game, x + gap, y, 14)) continue;
        if (__test.losBlocked(game, x, y, x + gap, y)) continue;
        let clear = true;
        for (const u of game.units) {
          if (u.dead) continue;
          if (Math.hypot(u.x - x, u.y - y) < 320) { clear = false; break; }
        }
        if (!clear) continue;
        let ok = true;
        for (const b of blocks) {
          if (Math.hypot(b.x - x, b.y - y) < far) { ok = false; break; }
        }
        if (ok) return { x, y };
      }
    }
  }
  return { x: 1200, y: 200 };
}

const TCHAR = { 0: '.', 2: '#', 4: '~' };
const tc = (g, x, y) => TCHAR[__test.terrainCell(g, x, y)] || '?';

const CASES = [['warrior', 1], ['shield', 2], ['ranger', 3], ['burst', 2]];
const mode = process.env.WF_NODESPECKLE ? '关去毛刺' : '开去毛刺';
const rounds = Number(process.argv[2] || 12);

let badRounds = 0;
const missing = new Map(); // type -> 次数

for (let i = 0; i < rounds; i++) {
  const gd = createGameState({ id: 'probe18_' + i, players: room(2).players });
  gd.phase = 'playing';
  gd.phaseEndsAt = 0;
  gd.units.length = 0;
  const s18 = findFlatSpot(gd, 60);
  const hq18 = gd.hqs.find((h) => h.owner === 1);

  const diag = [];
  for (const [type, tier] of CASES) {
    const u = __test.spawnUnit(gd, { id: 1, owner: 0, level: 3 }, type, s18.x, s18.y);
    for (let k = 1; k < tier; k++) __test.promoteUnit(gd, u);
    u.moveX = null;
    u.moveY = null;
    u.scanAt = 0;
    u.x = hq18.x + C.HQ_R + u.range * 0.6;
    u.y = hq18.y;
    diag.push({ type, tier, u });
  }
  // 吸附后的真实落点诊断
  const pre = diag.map((d) => {
    const u = d.u;
    return {
      tag: d.type + ':' + d.tier,
      x: Math.round(u.x), y: Math.round(u.y),
      terr: tc(gd, u.x, u.y),
      dist: Math.round(Math.hypot(u.x - hq18.x, u.y - hq18.y)),
      los: __test.losBlocked(gd, u.x, u.y, hq18.x, hq18.y),
      rng: Math.round(__test.unitRangeAt(gd, u, hq18.x, hq18.y)),
      base: u.range,
    };
  });

  const seen = new Set();
  let clock = 40000;
  const w0 = diag[0].u;
  let wShots = 0;
  let prevCd = w0.cdLeft || 0;
  const stepsSeenWarrior = [];
  for (let s = 0; s < 1200 && seen.size < CASES.length; s++) {
    for (const u of gd.units) { u.scanAt = 0; u.moveX = null; u.moveY = null; }
    clock += 5;
    const nB = gd.bullets.length;
    __test.step(gd, 0.005, clock);
    // cdLeft 从 0 被重置回 cdMax ⇒ 这一 step warrior 开了一炮（哪怕子弹当帧就命中消失）
    if ((w0.cdLeft || 0) > prevCd + 0.3) wShots += 1;
    prevCd = w0.cdLeft || 0;
    for (const b of gd.bullets) {
      if (b.type === 'warrior') stepsSeenWarrior.push(s);
      seen.add(b.type + ':' + b.tier);
    }
    if (nB === 0 && gd.bullets.length === 0) { /* noop */ }
  }
  if (seen.has('warrior:1') === false) {
    const lab2 = gd.labs.find((l) => l.id === 2);
    console.log(`     ↳ warrior 实际开炮次数（按 cdLeft 重置计）= ${wShots}；循环里看到的 warrior 弹次数 = ${stepsSeenWarrior.length}`);
    if (lab2) console.log(`     ↳ 中立研究所 L#2 位置 (${Math.round(lab2.x)},${Math.round(lab2.y)}) 距 warrior=${Math.round(Math.hypot(lab2.x - w0.x, lab2.y - w0.y))} hp=${Math.round(lab2.hp)} 被打掉=${Math.round(lab2.maxHp - lab2.hp)}`);
  }

  const lost = CASES.filter(([t, ti]) => !seen.has(t + ':' + ti));
  if (lost.length) {
    badRounds += 1;
    for (const [t] of lost) missing.set(t, (missing.get(t) || 0) + 1);
    console.log(`#${i} ✗ 没打出弹：${lost.map(([t, ti]) => t + ':' + ti).join(', ')}  (seen=${[...seen].join(' ') || '无'})`);
    for (const p of pre) console.log(`     ${p.tag.padEnd(9)} pos=${String(p.x).padStart(5)},${String(p.y).padStart(5)} 地=${p.terr} 距总部=${String(p.dist).padStart(4)} 视线挡=${p.los ? '是' : '否'} 射程=${p.rng}(基础${p.base})`);
    // 打完之后兵还在不在
    const post = diag.map((d) => `${d.type}:hp${Math.max(0, Math.round(d.u.hp))}${d.u.dead ? '(死)' : ''}`);
    console.log(`     收盘：${post.join('  ')}`);
    // 深挖：warrior 的瞄准/冷却/索敌状态
    for (const d of diag) {
      if (lost.every(([t]) => t !== d.type)) continue;
      const u = d.u;
      const aim = Math.atan2(hq18.y - u.y, hq18.x - u.x);
      const tg = __test.findTarget(gd, u);
      const err = ((aim - (u.turret == null ? u.angle : u.turret)) * 180 / Math.PI).toFixed(1);
      console.log(`     ↳ ${d.type}: dead=${u.dead} hp=${Math.round(u.hp)} cdLeft=${(u.cdLeft ?? 0).toFixed(2)} cdMax=${u.cdMax} turret=${(u.turret ?? u.angle).toFixed(2)} 车体=${u.angle.toFixed(2)} 瞄差=${err}° findTarget=${tg ? (tg.kind || 'u') + '#' + (tg.ref ? tg.ref.id : tg.id) : 'null'} owner=${tg ? (tg.owner !== undefined ? tg.owner : (tg.ref && (tg.ref.owner ?? tg.ref.oi))) : '-'}`);
      if (tg && tg.x !== undefined) {
        const td2 = Math.hypot(tg.x - u.x, tg.y - u.y);
        console.log(`     ↳ 目标位置 (${Math.round(tg.x)},${Math.round(tg.y)}) 距=${Math.round(td2)} 射程=${Math.round(__test.unitRangeAt(gd, u, tg.x, tg.y)) + (tg.r || 0)} 视线挡=${__test.losBlocked(gd, u.x, u.y, tg.x, tg.y) ? '是' : '否'} 总部距=${Math.round(Math.hypot(hq18.x - u.x, hq18.y - u.y))}`);
      }
      console.log(`     ↳ 全场建筑：${gd.hqs.map((b) => `HQ#${b.id}(o${b.owner})`).concat(gd.factories.map((b) => `F#${b.id}(o${b.owner})`)).concat(gd.labs.map((b) => `L#${b.id}(o${b.owner})`)).join(' ')}`);
    }
  } else {
    console.log(`#${i} ✓ 四类弹都打出来了（${[...seen].join(' ')}）`);
  }
}

console.log(`\n[${mode}] ${badRounds}/${rounds} 轮缺弹`);
if (missing.size) console.log('缺哪些：' + [...missing].map(([t, n]) => `${t}×${n}`).join('  '));
