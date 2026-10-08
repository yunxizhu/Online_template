#!/usr/bin/env node
/**
 * 兵种克制推演台 —— scripts/warfactory-matchup.js
 *
 * 为什么要单独写一套推演，而不是直接看 dps：
 *   dps 只是「站桩对轰」的结果，真实战斗里至少还有 6 件事在左右胜负 ——
 *   1) 射程差能不能兑现（卡攻击距离 / 回头拉扯）
 *   2) 弹速：慢弹打移动目标会空（轰击三阶 150px/s，飞 380px 要 2.5 秒）
 *   3) 激光蓄能：换目标就清零，打小兵群根本蓄不满，打大血目标才能吃满 25 倍
 *   4) 范围伤害：燎原火舌 50px / 轰击溅射 40px，敌人越抱团收益越高
 *   5) 前排顶不顶得住：远程脆皮有没人挡着，是两套完全不同的结果
 *   6) 规模：1 只和 10 只的结论经常相反（射程差在 1v1 是决定性的，10v10 会被集火淹没）
 *
 * 所以这里按服务端 index.js 的真实结算规则建模（不是另写一套数值）：
 *   - 索敌 250ms 一次，只锁「射程 + 目标半径 + 10」内的敌人，优先最近（当前目标 -40 粘性）
 *   - 边走边打（updateUnits 的开火段不看是否在移动）
 *   - 激光：换目标 → 500ms 前摇不射击 → 800ms 内倍率线性 1→25
 *   - 燎原：每 cd 秒一口火，落点在目标身上，半径 50px 内的**所有**敌人同吃这一口
 *   - 二三阶燎原额外铺火场（半径 45/65px，dps 5/9，**敌我通吃**，只烧单位）
 *   - 轰击：抛射弹，落点在开火瞬间目标身上的随机一点，飞行 D/弹速 秒后才炸（会打空）
 *   - 单位互推：任意两个单位中心距不得小于 r1+r2（服务端 separateUnits）
 *
 * 用法：
 *   node scripts/warfactory-matchup.js            # 全部
 *   node scripts/warfactory-matchup.js matrix     # 1/3/5/7/10 克制矩阵
 *   node scripts/warfactory-matchup.js aoe        # 对群（范围伤害实际命中数）
 *   node scripts/warfactory-matchup.js front      # 前排价值（给后排加盾卫的边际收益）
 *   node scripts/warfactory-matchup.js duel 锐士 激光 5 micro
 */
'use strict';

const path = require('path');
const D = require(path.join(__dirname, '../server/games/warfactory/data.js'));

const CELL = D.grid.cell;
const TYPES = ['warrior', 'shield', 'ranger', 'burst', 'burn', 'laser'];
const LABEL = (t) => D.units[t].label;
const PAD = (s, w) => {
  let n = 0;
  for (const ch of String(s)) n += ch.charCodeAt(0) > 255 ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(0, w - n));
};

// ---- 与服务端同源的常量 ----
const FLAME_R = D.flame.r * CELL;         // 火舌范围伤害半径（各阶共用）
// 火舌衰减：中心吃满，外沿只剩 EDGE_MUL 倍（与服务端 flameFalloff 同式）
const FLAME_EDGE_MUL = D.flame.edgeMul == null ? 1 : D.flame.edgeMul;
const flameFalloff = (gap) =>
  FLAME_R <= 0 || FLAME_EDGE_MUL >= 1
    ? 1
    : 1 + (FLAME_EDGE_MUL - 1) * Math.min(1, Math.max(0, gap / FLAME_R));
// 轰击溅射衰减（与服务端 splashFalloff 同式）：中心吃满，外沿只剩 SPLASH_EDGE_MUL。
// 半径跟着弹走（1/2/3 阶 = 30/45/60px），所以按「这一发弹的 splash」归一化。
const SPLASH_EDGE_MUL = D.burstSplash && D.burstSplash.edgeMul != null ? D.burstSplash.edgeMul : 1;
const splashFalloff = (gap, r) =>
  !(r > 0) || SPLASH_EDGE_MUL >= 1 ? 1 : 1 + (SPLASH_EDGE_MUL - 1) * Math.min(1, Math.max(0, gap / r));
const LW = D.laser.windupMs / 1000;       // 激光换目标前摇
const LR = D.laser.rampMs / 1000;         // 激光倍率爬升周期（每这么久 +1 倍，到 maxMul 封顶）
const LM = D.laser.maxMul;                // 倍率上限
const SCAN = 0.25;                        // 索敌周期（秒）
const SLACK = 10;                         // 索敌余量
const SHELL_MIN = 0.28;                   // 抛射最短飞行时间
const MAX_FIRES = D.flame.maxFires;
// 激光「死咬」开关：`WF_NO_STICKY=1` 时退回成旧行为（自动索敌会为更近的敌人改派，
// 蓄能被清零）—— 只用来做「死咬到底带来多少增益」的对照实验，正常跑不要开。
const LASER_STICKY = !process.env.WF_NO_STICKY;
// ---- 总部防卫（攻城场景用）----
const HQ_ATK_R = D.hqDefense.range * CELL;
const HQ_ATK_CD = D.hqDefense.cd;
const HQ_ATK_DMG = D.hqDefense.dmg;
const HQ_ATK_WINDUP = D.hqDefense.windupMs / 1000;
const HQ_R = (D.buildings.hqSize * CELL) / 2;
const HQ_HP = D.buildings.hqHp;
const FAC_HP = D.buildings.factoryHp;

function stat(type, tier) {
  const s = tier === 1 ? D.units[type] : D.evolved[type][tier];
  return {
    hp: s.hp,
    dmg: s.dmg,
    cd: s.cd,
    range: s.range * CELL,
    speed: s.speed,
    bullet: s.bulletSpeed || 330,
    splash: s.splash ? s.splash * CELL : 0,
    minRange: s.minRange ? s.minRange * CELL : 0, // 最小射击半径（仅轰击）：射界死角内打不到
    burn: !!s.burn,
    laser: !!s.laser,
    r: ((s.size || 2) * CELL) / 2,
  };
}
const dpsOf = (s) => s.dmg / s.cd;
/** 站桩理论秒伤（激光另算满蓄能） */
const laserDps = (s) => (s.laser ? (s.dmg * LM) / s.cd : dpsOf(s));

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================ 战斗推演 ============================ */

/**
 * @param {Array<{type:string,tier:number,count:number}>} compA
 * @param {Array<{type:string,tier:number,count:number}>} compB
 * @param {{policyA?:string,policyB?:string,gap?:number,seed?:number,maxT?:number}} opt
 *   policy: 'rush' = 直接冲进怀里（无操作，双方挤成一团）
 *           'micro' = 卡在自己射程边缘 + 射程/移速都占优时回头拉扯
 *           'siege' = 攻城站位：走到「打得到」为止，够得着就停在总部防卫圈外
 *           'guard' = 守家：不追击，只在总部防卫圈内（260px 内）接敌
 */
function battle(compA, compB, opt = {}) {
  const dt = 0.02;
  const maxT = opt.maxT || 90;
  const pol = [opt.policyA || 'micro', opt.policyB || 'micro'];
  const gap = opt.gap || 420;
  const rng = mulberry32(opt.seed || 20261006);
  const units = [];
  let nextId = 1;

  const place = (comp, side, cx) => {
    const list = [];
    for (const c of comp) for (let i = 0; i < c.count; i++) list.push({ type: c.type, tier: c.tier });
    // 射程短的站前排（离敌人更近那一行）
    list.sort((a, b) => stat(a.type, a.tier).range - stat(b.type, b.tier).range);
    const n = list.length || 1;
    const cols = Math.min(n, Math.max(1, Math.ceil(Math.sqrt(n))));
    const rows = Math.ceil(n / cols);
    list.forEach((it, i) => {
      const s = stat(it.type, it.tier);
      const sp = Math.max(28, s.r * 2.8);
      const row = Math.floor(i / cols);
      const col = i % cols;
      const back = (rows - 1 - row) * sp * (side === 0 ? -1 : 1); // 后排往自家方向错开
      const units0 = { id: nextId++, type: it.type, tier: it.tier, side };
      Object.assign(units0, s, {
        x: cx + back,
        y: (col - (cols - 1) / 2) * sp,
        hp: s.hp,
        maxHp: s.hp,
        cdLeft: 0,
        nextFire: 0,
        windup: 0,
        lockStart: -1,
        lockKey: '',
        tid: -1,
        scanAt: 0,
        shots: 0,
        hits: 0, // 实际打中的**敌人数**（AoE 一次可能 +N；单体恒 +1）
        dealt: 0,
      });
      units.push(units0);
    });
  };
  place(compA, 0, opt.aX != null ? opt.aX : -gap / 2);
  place(compB, 1, opt.bX != null ? opt.bX : gap / 2);
  if (opt.hq) {
    units.push({
      id: nextId++, type: '__hq', tier: 1, side: opt.hqSide != null ? opt.hqSide : 1, isHq: true,
      x: 0, y: 0, r: HQ_R, hp: opt.hqHp || HQ_HP, maxHp: opt.hqHp || HQ_HP,
      dmg: HQ_ATK_DMG, cd: HQ_ATK_CD, range: opt.noDef ? 0 : HQ_ATK_R, speed: 0,
      bullet: 9999, splash: 0, burn: false, laser: false,
      cdLeft: 0, nextFire: 0, windup: 0, lockStart: -1, lockKey: '', tid: -1, scanAt: 0, shots: 0, dealt: 0,
    });
  }

  const shells = [];
  const fires = [];
  let t = 0;

  const hurt = (e, dmg) => {
    if (e.hp <= 0) return;
    e.hp -= dmg;
  };

  const addFire = (u, x, y) => {
    const prof = D.fireTiers[u.tier - 1];
    if (!prof) return; // 一级燎原不留火场
    const merge = prof.mergeD * CELL;
    for (const f of fires) {
      if (Math.hypot(f.x - x, f.y - y) <= merge) {
        f.until = t + prof.lifeMs / 1000;
        f.r = Math.max(f.r, prof.r * CELL);
        f.dps = Math.max(f.dps, prof.dps);
        return;
      }
    }
    if (fires.length >= MAX_FIRES) fires.shift();
    fires.push({ x, y, r: prof.r * CELL, dps: prof.dps, until: t + prof.lifeMs / 1000 });
  };

  while (t < maxT) {
    const alive = units.filter((u) => u.hp > 0);
    let aN = 0;
    let bN = 0;
    for (const u of alive) (u.side === 0 ? aN++ : bN++);
    if (!aN || !bN) break;

    for (const u of alive) {
      if (u.hp <= 0) continue;
      if (u.cdLeft > 0) u.cdLeft -= dt;

      // ---- 索敌（250ms 一次，只锁射程内） ----
      if (t >= u.scanAt) {
        u.scanAt = t + SCAN;
        if (u.isHq) {
          // 总部防卫：锁定期内目标还活着就继续打，否则重新抓最近的（index.js 同款）
          const keep = u.tid >= 0 ? units.find((z) => z.id === u.tid) : null;
          if (keep && keep.hp > 0 && keep.side !== u.side && Math.hypot(keep.x - u.x, keep.y - u.y) <= u.range) {
            // 保持锁定
          } else {
            let best = null;
            let bd = Infinity;
            for (const e of alive) {
              if (e.side === u.side || e.hp <= 0) continue;
              const d = Math.hypot(e.x - u.x, e.y - u.y);
              if (d > u.range || d >= bd) continue;
              bd = d;
              best = e;
            }
            u.tid = best ? best.id : -1;
          }
        } else {
          // 激光兵：**锁定死咬**（index.js 的 laserHeldTarget 同款）。
          // 目标还活着、还在攻击范围内就绝不改派 —— 蓄能不会因为「更近的敌人」而清零。
          // 只有目标阵亡 / 离开射程才重新选目标。
          const keep = u.laser && LASER_STICKY && u.tid >= 0 ? units.find((z) => z.id === u.tid) : null;
          const held =
            Boolean(keep) &&
            keep.hp > 0 &&
            keep.side !== u.side &&
            Math.hypot(keep.x - u.x, keep.y - u.y) <= u.range + keep.r + SLACK &&
            // 挤进最小射击半径（射界死角）就打不着 → 解锁另找目标
            !(u.minRange && Math.hypot(keep.x - u.x, keep.y - u.y) - keep.r < u.minRange);
          if (!held) {
            let best = null;
            let bd = Infinity;
            for (const e of alive) {
              if (e.side === u.side || e.hp <= 0) continue;
              const d = Math.hypot(e.x - u.x, e.y - u.y);
              if (d > u.range + e.r + SLACK) continue;
              if (u.minRange && d - e.r < u.minRange) continue; // 射界死角：贴脸的敌人不能当目标
              const score = e.id === u.tid ? d - 40 : d;
              if (score < bd) {
                bd = score;
                best = e;
              }
            }
            u.tid = best ? best.id : -1;
          }
        }
      }

      // ---- 走位 ----
      let near = null;
      let nd = Infinity;
      for (const e of alive) {
        if (e.side === u.side || e.hp <= 0) continue;
        const d = Math.hypot(e.x - u.x, e.y - u.y);
        if (d < nd) {
          nd = d;
          near = e;
        }
      }
      if (near && nd > 0.001 && !u.isHq) {
        const ux = (near.x - u.x) / nd;
        const uy = (near.y - u.y) / nd;
        if (pol[u.side] === 'siege') {
          // 攻城站位：先站到「打得到」的最远处；够得着就停在总部防卫圈外白嫖
          let want = u.range + near.r - 2;
          if (near.isHq && u.range + near.r > HQ_ATK_R + 6) want = Math.min(want, HQ_ATK_R + 6);
          if (nd > want) {
            const st = Math.min(u.speed * dt, nd - want);
            u.x += ux * st;
            u.y += uy * st;
          } else if (nd < want - 2) {
            // 挤得太近（被互推进了总部防卫圈 / 进了自己的最小射程）→ 退回到「打得到的最远处」。
            // 实战里玩家一定会拉出来，否则白白挨总部 40dps；不模拟这一步等于白送战损。
            const st = Math.min(u.speed * dt, want - nd);
            u.x -= ux * st;
            u.y -= uy * st;
          }
        } else if (pol[u.side] === 'guard') {
          // 守家：先保证自己待在总部防卫圈里（让总部一起输出），再按自己的射程卡位
          const hqAt = opt.hqAt || { x: 0, y: 0 };
          const dh = Math.hypot(u.x - hqAt.x, u.y - hqAt.y);
          if (dh > 260) {
            const hx = (hqAt.x - u.x) / dh;
            const hy = (hqAt.y - u.y) / dh;
            u.x += hx * u.speed * dt;
            u.y += hy * u.speed * dt;
          } else if (nd > u.range * 0.9) {
            const st = Math.min(u.speed * dt, nd - u.range * 0.9);
            u.x += ux * st;
            u.y += uy * st;
          }
        } else if (pol[u.side] === 'rush') {
          const want = (u.r + near.r) * 0.9;
          if (nd > want) {
            const st = Math.min(u.speed * dt, nd - want);
            u.x += ux * st;
            u.y += uy * st;
          }
        } else {
          // 卡攻击距离：贴到自己射程边缘就停（不再往里挤）
          const want = u.range * 0.9;
          // 回头拉扯：只有「射程占优且移速不吃亏」才拉得开，否则越拉越挨打
          const kite = nd < u.range * 0.62 && u.range > near.range && u.speed >= near.speed;
          if (kite) {
            u.x -= ux * u.speed * dt;
            u.y -= uy * u.speed * dt;
          } else if (nd > want) {
            const st = Math.min(u.speed * dt, nd - want);
            u.x += ux * st;
            u.y += uy * st;
          }
        }
      }

      // ---- 开火（边走边打） ----
      const tgt = u.tid >= 0 ? units.find((z) => z.id === u.tid) : null;
      const td = tgt ? Math.hypot(tgt.x - u.x, tgt.y - u.y) : 0;
      // 与服务端 inRange 同款：射程内、没被山挡（推演台无地形）、**且不在最小射击半径内**
      const inRange = tgt && tgt.hp > 0 && td <= u.range + tgt.r && !(u.minRange && td - tgt.r < u.minRange);
      if (!inRange) continue;

      if (u.isHq) {
        const key = String(tgt.id);
        if (key !== u.lockKey) {
          u.lockKey = key;
          u.windup = t + HQ_ATK_WINDUP; // 换目标重起 500ms 前摇
        }
        if (t >= u.windup && u.cdLeft <= 0) {
          hurt(tgt, u.dmg);
          u.dealt += u.dmg;
          u.shots++;
          u.cdLeft = u.cd;
          u.windup = t + HQ_ATK_WINDUP; // 每发之后也重起前摇（index.js 同款）
        }
        continue;
      }

      if (u.laser) {
        const key = String(tgt.id);
        if (key !== u.lockKey) {
          u.lockKey = key;
          u.lockStart = t;
          u.windup = t + LW;
        }
        const held = t - u.lockStart - LW;
        // ⚠️ rampMs 是「+1 倍的周期」不是「爬满用时」：每持续 LR 秒倍率 +1（与 index.js 同式）
        const mul = held <= 0 ? 1 : Math.min(LM, 1 + held / LR);
        if (t >= u.nextFire && t >= u.windup) {
          const dmg = u.dmg * mul;
          hurt(tgt, dmg);
          u.dealt += dmg;
          u.shots++;
          u.nextFire = t + u.cd;
        }
        continue;
      }

      if (u.burn) {
        if (u.cdLeft <= 0) {
          u.cdLeft = u.cd;
          u.shots++;
          const dd = Math.hypot(tgt.x - u.x, tgt.y - u.y);
          const ang = Math.atan2(tgt.y - u.y, tgt.x - u.x);
          const reach = Math.min(dd, u.range + tgt.r);
          const lx = u.x + Math.cos(ang) * reach;
          const ly = u.y + Math.sin(ang) * reach;
          for (const e of alive) {
            if (e.side === u.side || e.hp <= 0) continue;
            const gap = Math.max(0, Math.hypot(e.x - lx, e.y - ly) - e.r);
            if (gap > FLAME_R) continue;
            const d = u.dmg * flameFalloff(gap);
            hurt(e, d);
            u.dealt += d;
            u.hits++;
          }
          addFire(u, lx, ly);
        }
        continue;
      }

      if (u.cdLeft <= 0) {
        u.cdLeft = u.cd;
        u.shots++;
        if (u.splash) {
          // 抛射弹：落点 = 开火瞬间目标身上的随机一点，飞行期间目标走了就是打空
          const aa = rng() * Math.PI * 2;
          const ax = tgt.x + Math.cos(aa) * tgt.r;
          const ay = tgt.y + Math.sin(aa) * tgt.r;
          const dd = Math.hypot(ax - u.x, ay - u.y);
          shells.push({
            x: ax,
            y: ay,
            land: t + Math.max(SHELL_MIN, dd / u.bullet),
            dmg: u.dmg,
            splash: u.splash,
            side: u.side,
            ref: u,
          });
        } else {
          hurt(tgt, u.dmg);
          u.dealt += u.dmg;
          u.hits++; // 单体兵：一发最多中 1 个
        }
      }
    }

    // ---- 抛射弹落地 ----
    for (let i = shells.length - 1; i >= 0; i--) {
      const b = shells[i];
      if (t < b.land) continue;
      shells.splice(i, 1);
      for (const e of alive) {
        if (e.side === b.side || e.hp <= 0) continue;
        const dd = Math.hypot(e.x - b.x, e.y - b.y);
        if (dd <= b.splash + e.r) {
          // 溅射同样随离落点的距离衰减（与服务端 explodeShell 同式）
          const d = b.dmg * splashFalloff(Math.max(0, dd - e.r), b.splash);
          hurt(e, d);
          b.ref.dealt += d;
          b.ref.hits++;
        }
      }
    }

    // ---- 火场结算（敌我通吃，只烧单位） ----
    for (let i = fires.length - 1; i >= 0; i--) {
      if (fires[i].until < t) {
        fires.splice(i, 1);
        continue;
      }
      for (const e of alive) {
        if (e.hp <= 0) continue;
        if (Math.hypot(e.x - fires[i].x, e.y - fires[i].y) <= fires[i].r) hurt(e, fires[i].dps * dt);
      }
    }

    // ---- 单位互推（服务端 separateUnits：中心距 < r1+r2 就对称推开） ----
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const min = a.r + b.r;
        if (d >= min) continue;
        if (d < 0.0001) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (min - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
      }
    }

    t += dt;
  }

  const tot = (side) => {
    let hp = 0;
    let max = 0;
    let n = 0;
    for (const u of units) {
      if (u.side !== side || u.isHq) continue; // 总部不计入「部队残血」，另算
      max += u.maxHp;
      if (u.hp > 0) {
        hp += u.hp;
        n++;
      }
    }
    return { pct: max ? hp / max : 0, n, max };
  };
  const A = tot(0);
  const B = tot(1);
  const per = {};
  for (const u of units) {
    if (u.isHq) continue;
    const k = u.type + u.tier;
    per[k] = per[k] || { shots: 0, hits: 0, dealt: 0, n: 0 };
    per[k].shots += u.shots;
    per[k].hits += u.hits;
    per[k].dealt += u.dealt;
    per[k].n++;
  }
  for (const k in per) {
    const s = stat(k.slice(0, -1), +k.slice(-1));
    // 两个口径：hitPerShot = 实际打中的敌人数（AoE 的真实命中数）；
    //           effPerShot = 折算成「满伤份数」（把距离衰减折进去，反映真实输出量）
    per[k].hitPerShot = per[k].shots ? per[k].hits / per[k].shots : 0;
    per[k].effPerShot = per[k].shots ? per[k].dealt / (per[k].shots * s.dmg) : 0;
  }
  const hqUnit = units.find((u) => u.isHq);
  return {
    t,
    hqPct: hqUnit ? Math.max(0, hqUnit.hp) / hqUnit.maxHp : null,
    aSurv: A.n,
    bSurv: B.n,
    aPct: A.pct,
    bPct: B.pct,
    margin: A.pct - B.pct,
    per,
  };
}

/* ============================ 报表 ============================ */

const SCALES = [1, 3, 5, 7, 10];
const sym = (m) => (m > 0.08 ? '＋' : m < -0.08 ? '－' : '＝');

function matrix(tier, policy) {
  const M = {};
  for (const a of TYPES) M[a] = {};
  for (const a of TYPES) {
    for (const b of TYPES) {
      if (a === b) {
        M[a][b] = null;
        continue;
      }
      if (M[a][b]) continue; // 已由反对称镜像填好，省一半算力
      const row = [];
      for (const n of SCALES) {
        const r = battle([{ type: a, tier, count: n }], [{ type: b, tier, count: n }], {
          policyA: policy,
          policyB: policy,
        });
        row.push(r);
      }
      M[a][b] = row;
      // 双方策略相同 → A vs B 与 B vs A 严格互为镜像
      M[b][a] = row.map((r) => ({ ...r, margin: -r.margin, aPct: r.bPct, bPct: r.aPct }));
    }
  }
  return M;
}

function printMatrix(tier, policy) {
  const M = matrix(tier, policy);
  console.log(
    `\n${'='.repeat(76)}\n${tier} 阶 · 双方操作水平：${policy === 'rush' ? '无操作对冲（挤成一团）' : '会卡攻击距离 + 会回头拉扯'}\n${'='.repeat(76)}`,
  );
  console.log('行=我方，列=敌方。每格 5 个字符依次是 1v1 / 3v3 / 5v5 / 7v7 / 10v10 的结果');
  console.log('  ＋ 我方胜（残血比对方高 8% 以上）   － 我方负   ＝ 接近平手\n');
  console.log(PAD('', 8) + TYPES.map((t) => PAD(LABEL(t), 8)).join(''));
  for (const a of TYPES) {
    let line = PAD(LABEL(a), 8);
    for (const b of TYPES) {
      line += PAD(a === b ? '·' : M[a][b].map((r) => sym(r.margin)).join(''), 8);
    }
    console.log(line);
  }

  console.log(`\n—— 10v10 残血差（我方剩余血量% − 敌方剩余血量%，正数=我方赢）——`);
  console.log(PAD('', 8) + TYPES.map((t) => PAD(LABEL(t), 8)).join(''));
  for (const a of TYPES) {
    let line = PAD(LABEL(a), 8);
    for (const b of TYPES) {
      const r = a === b ? null : M[a][b][4];
      line += PAD(a === b ? '·' : (r.margin > 0 ? '+' : '') + Math.round(r.margin * 100), 8);
    }
    console.log(line);
  }
  return M;
}

function printAoe() {
  console.log(`\n${'='.repeat(76)}\n对群能力：范围伤害的**实际命中数**（一口火 / 一发炮平均打到几个敌人）\n${'='.repeat(76)}`);
  console.log(
    `（敌人是抱团推进的同阶锐士；火舌 ${FLAME_R}px / 轰击溅射 30→45→60px，敌我互推会天然把阵型挤密）`,
  );
  console.log(
    '⚠️ 轰击有最小射击半径（100/110/120px）：敌人贴到脸上就进了射界死角，一发都打不出去。\n' +
    '   所以分两个场景看：**冲锋贴脸**（轰击被压制）与 **卡距离对峙**（轰击站得住）。\n',
  );
  const run = (type, tier, n, polB) =>
    battle([{ type, tier, count: n }], [{ type: 'warrior', tier, count: n }], {
      policyA: 'micro',
      policyB: polB,
    });
  for (const polB of ['rush', 'micro']) {
    console.log(
      `\n—— 敌人${polB === 'rush' ? '贴脸冲锋 rush' : '卡距离对峙 micro'}（我方一律 micro 卡距离） ——`,
    );
    console.log(PAD('兵种', 10) + PAD('阶', 4) + SCALES.map((n) => PAD(`${n} 个敌人`, 12)).join(''));
    for (const type of ['burn', 'burst', 'warrior']) {
      for (const tier of [1, 2, 3]) {
        let line = PAD(LABEL(type), 10) + PAD(tier, 4);
        for (const n of SCALES) {
          const r = run(type, tier, n, polB);
          const k = type + tier;
          const h = r.per[k] ? r.per[k].hitPerShot : 0;
          line += PAD(h.toFixed(2) + ' 个/次', 12);
        }
        console.log(line);
      }
    }
  }
  // 距离衰减后的「满伤份数」：命中数 × 衰减，反映真实输出量（只在轰击站得住的场景比）
  console.log('\n—— 折算成「满伤份数」（命中数 × 距离衰减；只取卡距离对峙场景） ——');
  console.log(PAD('兵种', 10) + PAD('阶', 4) + SCALES.map((n) => PAD(`${n} 个敌人`, 12)).join(''));
  for (const type of ['burn', 'burst']) {
    for (const tier of [1, 2, 3]) {
      let line = PAD(LABEL(type), 10) + PAD(tier, 4);
      for (const n of SCALES) {
        const r = run(type, tier, n, 'micro');
        const k = type + tier;
        const h = r.per[k] ? r.per[k].effPerShot : 0;
        line += PAD(h.toFixed(2) + ' 份/次', 12);
      }
      console.log(line);
    }
  }
  console.log('\n注：锐士/游侠/盾卫是单体，命中数恒为 1（只用来当对照）。');
}

function printFront() {
  console.log(`\n${'='.repeat(76)}\n前排价值：给后排加盾卫，能换回多少（敌 = 同数量锐士，双方都会卡距离）\n${'='.repeat(76)}`);
  const tier = 3;
  for (const n of [5, 10]) {
    console.log(`\n—— ${n} 打 ${n} ——`);
    console.log(PAD('我方阵容', 26) + PAD('残血差', 10) + PAD('结果', 8));
    const foe = [{ type: 'warrior', tier, count: n }];
    const cases = [
      [{ type: 'laser', tier, count: n }],
      [{ type: 'laser', tier, count: n - 1 }, { type: 'shield', tier, count: 1 }],
      [{ type: 'laser', tier, count: Math.ceil(n / 2) }, { type: 'shield', tier, count: Math.floor(n / 2) }],
      [{ type: 'laser', tier, count: Math.ceil(n * 0.7) }, { type: 'shield', tier, count: Math.floor(n * 0.3) }],
      [{ type: 'ranger', tier, count: n }],
      [{ type: 'ranger', tier, count: Math.ceil(n / 2) }, { type: 'shield', tier, count: Math.floor(n / 2) }],
      [{ type: 'burst', tier, count: n }],
      [{ type: 'burst', tier, count: Math.ceil(n / 2) }, { type: 'shield', tier, count: Math.floor(n / 2) }],
      [{ type: 'burn', tier, count: n }],
      [{ type: 'burn', tier, count: Math.ceil(n / 2) }, { type: 'shield', tier, count: Math.floor(n / 2) }],
    ];
    for (const c of cases) {
      const r = battle(c, foe, { policyA: 'micro', policyB: 'micro' });
      const name = c.map((x) => `${LABEL(x.type)}${x.tier}阶×${x.count}`).join(' + ');
      console.log(PAD(name, 26) + PAD((r.margin > 0 ? '+' : '') + Math.round(r.margin * 100), 10) + PAD(sym(r.margin) === '＋' ? '胜' : sym(r.margin) === '－' ? '负' : '平', 8));
    }
  }
}

function printTable() {
  console.log(`\n${'='.repeat(76)}\n兵种面板（全部从 data.js 读出；1 格 = ${CELL}px）\n${'='.repeat(76)}`);
  console.log(
    PAD('兵种', 8) + PAD('阶', 4) + PAD('血', 7) + PAD('单发', 7) + PAD('间隔', 7) + PAD('站桩dps', 10) +
    PAD('激光满蓄', 10) + PAD('射程px', 9) + PAD('最小射程', 10) + PAD('移速', 7) + PAD('弹速', 8) + PAD('AoE', 8),
  );
  for (const type of TYPES) {
    for (const tier of [1, 2, 3]) {
      const s = stat(type, tier);
      console.log(
        PAD(LABEL(type), 8) + PAD(tier, 4) + PAD(s.hp, 7) + PAD(s.dmg, 7) + PAD(s.cd, 7) +
        PAD(dpsOf(s).toFixed(1), 10) + PAD(s.laser ? laserDps(s).toFixed(1) : '—', 10) +
        PAD(s.range, 9) + PAD(s.minRange || '—', 10) + PAD(s.speed, 7) + PAD(s.burn ? '直喷' : s.bullet >= 3000 ? '瞬发' : s.bullet, 8) +
        PAD(s.burn ? `火舌${FLAME_R}` : s.splash ? `溅射${s.splash}` : '—', 8),
      );
    }
  }
  console.log(`\n总部防卫：射程 ${HQ_ATK_R}px / ${HQ_ATK_DMG} dmg / ${HQ_ATK_CD}s = ${HQ_ATK_DMG / HQ_ATK_CD} dps（总部半径 ${HQ_R}px）`);
  console.log('能不能站在防卫圈外白嫖总部：射程 + 总部半径 > 防卫射程');
  for (const type of TYPES) {
    const row = [];
    for (const tier of [1, 2, 3]) {
      const s = stat(type, tier);
      row.push(`${tier}阶 ${s.range + HQ_R}${s.range + HQ_R > HQ_ATK_R ? '✔' : '✘'}`);
    }
    console.log(PAD(LABEL(type), 10) + row.join('   '));
  }
  console.log('\n抛射弹打移动目标的空炮判据：飞行 距离/弹速 秒，目标同期位移 = 移速 × 飞行时间');
  const FOE_SPD = D.units.warrior.speed; // 拿锐士当「典型冲锋敌人」的移速基准（不写死常数）
  for (const tier of [1, 2, 3]) {
    const s = stat('burst', tier);
    const fly = s.range / s.bullet;
    console.log(
      `  轰击${tier}阶：射程 ${s.range}px / 弹速 ${s.bullet} → 飞行 ${fly.toFixed(2)}s，${FOE_SPD}px/s 的敌人同期走 ${Math.round(FOE_SPD * fly)}px` +
      `（溅射 ${s.splash}px，越往外越轻：外沿只剩 ${SPLASH_EDGE_MUL} 倍；${s.minRange}px 内根本打不了）`,
    );
  }
}

function printSiege() {
  console.log(`\n${'='.repeat(76)}\n攻城场景：N 个兵拆总部（${HQ_HP} 血，防卫 ${HQ_ATK_R}px / ${HQ_ATK_DMG / HQ_ATK_CD} dps）\n${'='.repeat(76)}`);
  console.log('站位策略 = 打得到就停，够得着就站防卫圈外；同时给出拆工厂（无防卫，5000 血）的纯输出对比\n');
  const GAP = 420; // 与 battle() 的默认 gap 同值：开打时两军中心距
  for (const tier of [1, 3]) {
    for (const n of [10, 20, 30]) {
      console.log(`\n—— ${tier} 阶 × ${n} 个 ——`);
      console.log(PAD('兵种', 10) + PAD('拆总部', 12) + PAD('存活', 8) + PAD('战损', 8) + PAD('拆工厂(无防卫)', 16));
      for (const type of TYPES) {
        const r = battle([{ type, tier, count: n }], [], { policyA: 'siege', hq: true, maxT: 150, aX: -GAP });
        const fac = battle([{ type, tier, count: n }], [], { policyA: 'siege', hq: true, maxT: 150, aX: -GAP, hqHp: FAC_HP, noDef: true });
        const killed = (r.hqPct != null ? r.hqPct : 1) <= 1e-6; // 总部被打掉才算拆掉（bSurv 不含总部，别用它判）
        const loss = n ? (n - r.aSurv) / n : 0;
        console.log(
          PAD(LABEL(type), 10) +
          PAD(killed ? `${r.t.toFixed(0)}s` : '150s 打不掉', 12) +
          PAD(`${r.aSurv}/${n}`, 8) +
          PAD(`${Math.round(loss * 100)}%`, 8) +
          PAD((fac.hqPct != null ? fac.hqPct : 1) <= 1e-6 ? `${fac.t.toFixed(0)}s` : '—', 12),
        );
      }
    }
  }
}

function printDefend() {
  console.log(`\n${'='.repeat(76)}\n守家反偷袭：敌方 10 个冲进我方总部防卫圈（总部 40dps 一起打）\n${'='.repeat(76)}`);
  console.log('我方 10 个守在总部旁（不追击，待在圈内让总部帮忙输出）；敌方直接压上来\n');
  const N = 10;
  for (const atkType of ['warrior', 'shield', 'burn']) {
    for (const tier of [1, 3]) {
      console.log(`\n—— 敌方 ${tier}阶${LABEL(atkType)} × ${N} ——`);
      console.log(PAD('我方守军', 26) + PAD('残血差', 10) + PAD('我方存活', 12) + PAD('总部剩血', 12) + PAD('结果', 8));
      for (const type of TYPES) {
        const r = battle([{ type, tier, count: N }], [{ type: atkType, tier, count: N }], {
          policyA: 'guard',
          policyB: 'rush',
          hq: true,
          hqSide: 0,
          aX: -70,
          bX: 430,
          hqAt: { x: 0, y: 0 },
          maxT: 120,
        });
        console.log(
          PAD(`${LABEL(type)}${tier}阶×${N}`, 26) +
          PAD((r.margin > 0 ? '+' : '') + Math.round(r.margin * 100), 10) +
          PAD(`${r.aSurv}/${N}`, 12) +
          PAD(`${Math.round((r.hqPct || 0) * 100)}%`, 12) +
          PAD(sym(r.margin) === '＋' ? '守住' : sym(r.margin) === '－' ? '被破' : '惨胜', 8),
        );
      }
    }
  }
}

function printRank() {
  console.log(`\n${'='.repeat(76)}\n综合野战强度排名（10v10，双方都会卡距离拉扯；对另外 5 个兵种的平均残血差）\n${'='.repeat(76)}`);
  for (const tier of [1, 3]) {
    const rows = [];
    for (const a of TYPES) {
      let s = 0;
      let n = 0;
      for (const b of TYPES) {
        if (a === b) continue;
        const r = battle([{ type: a, tier, count: 10 }], [{ type: b, tier, count: 10 }], { policyA: 'micro', policyB: 'micro' });
        s += r.margin;
        n++;
      }
      rows.push({ 兵种: LABEL(a), 平均净胜: Math.round((s / n) * 100) });
    }
    rows.sort((x, y) => y.平均净胜 - x.平均净胜);
    console.log(`\n—— ${tier} 阶 ——`);
    for (let i = 0; i < rows.length; i++) console.log(PAD(`${i + 1}. ${rows[i].兵种}`, 12) + PAD((rows[i].平均净胜 > 0 ? '+' : '') + rows[i].平均净胜, 8));
  }
}

/* ============================ CLI ============================ */

const cmd = process.argv[2] || 'all';
if (cmd === 'table' || cmd === 'all') printTable();
if (cmd === 'matrix' || cmd === 'all') {
  for (const tier of [1, 3]) for (const p of ['rush', 'micro']) printMatrix(tier, p);
}
if (cmd === 'aoe' || cmd === 'all') printAoe();
if (cmd === 'front' || cmd === 'all') printFront();
if (cmd === 'siege' || cmd === 'all') printSiege();
if (cmd === 'defend' || cmd === 'all') printDefend();
if (cmd === 'rank' || cmd === 'all') printRank();
if (cmd === 'dbg') {
  const r = battle([{ type: 'warrior', tier: 3, count: 10 }], [], { policyA: 'siege', hq: true, maxT: 150, aX: -420, hqHp: 5000, noDef: true });
  console.log('工厂:', JSON.stringify({ t: r.t, hqPct: r.hqPct, aSurv: r.aSurv }));
  const r2 = battle([{ type: 'warrior', tier: 3, count: 10 }], [], { policyA: 'siege', hq: true, maxT: 150, aX: -420 });
  console.log('总部:', JSON.stringify({ t: r2.t, hqPct: r2.hqPct, aSurv: r2.aSurv }));
}
if (cmd === 'probe') {
  const tier = process.argv[3] || '3';
  const n = process.argv[4] || '10';
  const r = battle([{ type: 'burst', tier: +tier, count: +n }], [], { policyA: 'siege', hq: true, maxT: 150, aX: -420 });
  console.log(JSON.stringify({ t: r.t, hqPct: r.hqPct, aSurv: r.aSurv, per: r.per }));
}
if (cmd === 'duel') {
  const [, , , a, b, n = '5', pol = 'micro'] = process.argv;
  const ta = TYPES.find((t) => LABEL(t) === a) || a;
  const tb = TYPES.find((t) => LABEL(t) === b) || b;
  for (const tier of [1, 3]) {
    const r = battle([{ type: ta, tier, count: +n }], [{ type: tb, tier, count: +n }], { policyA: pol, policyB: pol });
    console.log(
      `${tier}阶 ${LABEL(ta)}×${n} vs ${LABEL(tb)}×${n} [${pol}] → ${sym(r.margin)} 残血 ${Math.round(r.aPct * 100)}% : ${Math.round(r.bPct * 100)}%  存活 ${r.aSurv}:${r.bSurv}  用时 ${r.t.toFixed(1)}s`,
    );
  }
}
