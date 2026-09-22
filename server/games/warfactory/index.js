'use strict';

/**
 * 战争工厂（warfactory）：2–4 人水墨即时战略。
 *
 * 规则：
 * - 无经济系统。地图上散布 9 座战争工厂（初级×4 / 中级×2 / 高级×1）与 4 座研究所。
 * - 单位进驻工厂占领圈即可占领（圈内有守军则争夺冻结）；占领后每隔一段时间
 *   自动生产初级单位，直到该厂出身的存活部队达到本厂兵力上限。
 * - 工厂等级决定两件事：兵力上限（初级 4 / 中级 6 / 高级 9），
 *   以及该厂出厂单位的进化上限——初级工厂的兵永远只能是初级。
 * - 单位靠战斗攒经验自动进化（初级→中级→高级），研究所归属方的经验获取 ×1.5。
 * - 单位五种：锐士（近战突进）、盾卫（重甲坦克）、游侠（远程狙击）、
 *   轰击（范围炮击）、燎原（燃烧灼烧）；进化时随机定型 A 攻势 / B 守势。
 * - 操作：框选己方部队 → 右键下达「进攻移动」；单位空闲时自动迎击圈内敌人。
 * - 玩家失去全部工厂即出局，最后存活者获胜。
 *
 * 服务端权威模拟：固定 10Hz 步进，快照走轻量 game:rt 通道；
 * 全量 game:state 在阶段切换 / 占领 / 淘汰 / 胜负时广播（至少间隔 1s 节流）。
 */

const WORLD_W = 2400;
const WORLD_H = 1600;
const TICK_MS = 100;
const MAX_DT = 0.25;

const COUNTDOWN_MS = 3000;

// ---- 工厂 / 研究所 ----
const FACTORY_R = 58; // 建筑本体碰撞半径
const CAPTURE_R = 118; // 占领判定半径
const CAPTURE_RATE = 25; // 每秒占领进度（无守军时 4 秒占领）
const RECLAIM_RATE = 45; // 守方在场时的进度回退速度
const PRODUCE_MS = 6000; // 出兵间隔
const FACTORY_CAP = { 1: 4, 2: 6, 3: 9 }; // 各级工厂兵力上限（按出厂厂计）
const BASE_START_UNITS = 2; // 玩家起始工厂预置部队数

// ---- 单位 ----
const TYPE_LIST = ['warrior', 'shield', 'ranger', 'burst', 'burn'];
const STATS = {
  warrior: { label: '锐士', hp: 100, dmg: 11, range: 60, cd: 0.9, speed: 92, r: 14 },
  shield: { label: '盾卫', hp: 175, dmg: 8, range: 50, cd: 1.1, speed: 66, r: 15 },
  ranger: { label: '游侠', hp: 65, dmg: 10, range: 200, cd: 1.5, speed: 82, r: 13 },
  burst: { label: '轰击', hp: 75, dmg: 18, range: 165, cd: 2.1, speed: 58, r: 14, splash: 62 },
  burn: { label: '燎原', hp: 80, dmg: 7, range: 120, cd: 1.7, speed: 78, r: 13, burn: true },
};
const TIER_HP = [1, 1.7, 2.6];
const TIER_DMG = [1, 1.55, 2.2];
const TIER_RANGE = [0, 15, 30];
const TIER_CD = [1, 0.88, 0.78];
const XP_NEED = [80, 220]; // 累计经验达到 80 → 中级；220 → 高级
const KILL_XP_BASE = 45;
const KILL_XP_PER_TIER = 15;
const LAB_XP_MULT = 1.5; // 研究所归属方经验倍率
const AGGRO_BONUS = 70; // 索敌范围 = 射程 + 该值
const SCAN_MS = 250; // 索敌重估间隔
const LEASH_DIST = 320; // 空闲守军追击半径（超出即归位）
const MELEE_RANGE = 65; // ≤ 该射程视为近战（弹道高速短命）

// ---- 弹道 ----
const BULLET_SPEED = 330;
const BULLET_SPEED_MELEE = 520;
const BULLET_LIFE_MS = 2400;
const BULLET_R = 5;
const BURN_DPS = 9;
const BURN_MS = 3000;

const COLORS = ['#b03a2e', '#2e5e8c', '#3f7a52', '#a8742c'];

/** 玩家出生点（椭圆均布），按人数取用 */
const BASE_ANGLES = {
  2: [180, 0],
  3: [150, 30, 270],
  4: [180, 0, 90, 270],
};
const ELLIPSE = { cx: 1200, cy: 800, rx: 1000, ry: 620 };

/** 中立战争工厂（等级固定在地图上，180° 旋转对称） */
const NEUTRAL_FACTORIES = [
  { x: 560, y: 800, level: 1 },
  { x: 1840, y: 800, level: 1 },
  { x: 980, y: 1180, level: 1 },
  { x: 1420, y: 420, level: 1 },
  { x: 980, y: 420, level: 2 },
  { x: 1420, y: 1180, level: 2 },
  { x: 1200, y: 800, level: 3 },
];

/** 研究所（归属方单位经验 ×1.5） */
const LABS = [
  { x: 700, y: 350 },
  { x: 1700, y: 350 },
  { x: 700, y: 1250 },
  { x: 1700, y: 1250 },
];

/** 出兵类型权重 */
const SPAWN_WEIGHTS = [
  ['warrior', 26],
  ['shield', 20],
  ['ranger', 20],
  ['burst', 17],
  ['burn', 17],
];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function pickWeighted(rng) {
  let total = 0;
  for (const it of SPAWN_WEIGHTS) total += it[1];
  let roll = rng() * total;
  for (const it of SPAWN_WEIGHTS) {
    roll -= it[1];
    if (roll <= 0) return it[0];
  }
  return SPAWN_WEIGHTS[0][0];
}

/** 每房间一个确定性轻量随机源（模拟内部使用） */
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}

/** 出生工厂坐标（按人数椭圆均布） */
function basePos(index, count) {
  const table = BASE_ANGLES[count] || BASE_ANGLES[4];
  const a = (table[index % table.length] * Math.PI) / 180;
  return {
    x: clamp(ELLIPSE.cx + Math.cos(a) * ELLIPSE.rx, FACTORY_R + 40, WORLD_W - FACTORY_R - 40),
    y: clamp(ELLIPSE.cy + Math.sin(a) * ELLIPSE.ry, FACTORY_R + 40, WORLD_H - FACTORY_R - 40),
  };
}

/** 按类型/等级/分支计算战斗属性 */
function unitStats(type, tier, branch) {
  const s = STATS[type] || STATS.warrior;
  const t = clamp(tier, 1, 3) - 1;
  return {
    hp: Math.round(s.hp * TIER_HP[t] * (branch === 'B' ? 1.25 : 1)),
    dmg: round1(s.dmg * TIER_DMG[t] * (branch === 'A' ? 1.2 : 1)),
    range: Math.round(s.range + TIER_RANGE[t]),
    cd: round2(s.cd * TIER_CD[t]),
  };
}

function createGameState(room) {
  const seats = (room && room.players ? room.players : []).filter(
    (p) => p && !p.left
  );
  const count = Math.max(2, Math.min(4, seats.length));
  const chosen = seats.slice(0, count);
  const rng = makeRng((Date.now() ^ 0x5f356495) >>> 0);

  const players = chosen.map((p, i) => {
    const pos = basePos(i, count);
    return {
      id: p.id,
      name: p.name || '玩家',
      color: COLORS[i % COLORS.length],
      baseX: pos.x,
      baseY: pos.y,
      kills: 0,
      losses: 0,
      evolved: 0,
      captured: 0,
      eliminated: false,
      left: false,
    };
  });

  const factories = [];
  let facId = 1;
  for (let i = 0; i < count; i++) {
    const pos = basePos(i, count);
    factories.push({
      id: facId++,
      x: round1(pos.x),
      y: round1(pos.y),
      level: 1,
      owner: i, // 玩家下标；-1 为中立
      capBy: -1,
      capProg: 0,
      contested: false,
      prodProg: 0,
      home: true,
    });
  }
  for (const nf of NEUTRAL_FACTORIES) {
    factories.push({
      id: facId++,
      x: nf.x,
      y: nf.y,
      level: nf.level,
      owner: -1,
      capBy: -1,
      capProg: 0,
      contested: false,
      prodProg: 0,
      home: false,
    });
  }

  const labs = LABS.map((l, i) => ({ id: i + 1, x: l.x, y: l.y, owner: -1 }));

  const game = {
    type: 'warfactory',
    world: { w: WORLD_W, h: WORLD_H },
    consts: {
      factoryR: FACTORY_R,
      captureR: CAPTURE_R,
      captureRate: CAPTURE_RATE,
      reclaimRate: RECLAIM_RATE,
      produceMs: PRODUCE_MS,
      factoryCap: FACTORY_CAP,
      typeList: TYPE_LIST,
      stats: STATS,
      tierHp: TIER_HP,
      tierDmg: TIER_DMG,
      tierRange: TIER_RANGE,
      tierCd: TIER_CD,
      xpNeed: XP_NEED,
      killXpBase: KILL_XP_BASE,
      killXpPerTier: KILL_XP_PER_TIER,
      labXpMult: LAB_XP_MULT,
      aggroBonus: AGGRO_BONUS,
      burnDps: BURN_DPS,
      burnMs: BURN_MS,
      colors: COLORS,
    },
    phase: 'countdown',
    phaseEndsAt: Date.now() + COUNTDOWN_MS,
    players,
    factories,
    labs,
    units: [],
    bullets: [],
    events: [],
    over: false,
    winnerId: null,
    seq: 0,
    nextUnitId: 1,
    nextBulletId: 1,
    _rng: rng,
    _lastTick: Date.now(),
    _lastStateBroadcast: 0,
  };

  // 玩家起始工厂预置少量部队，开局即可行动
  for (const f of factories) {
    if (f.owner < 0) continue;
    for (let k = 0; k < BASE_START_UNITS; k++) {
      const type = k === 0 ? 'warrior' : 'shield';
      const ang = rng() * Math.PI * 2;
      spawnUnit(game, f, type, f.x + Math.cos(ang) * (FACTORY_R + 30), f.y + Math.sin(ang) * (FACTORY_R + 30));
    }
  }

  return game;
}

function spawnUnit(game, fac, type, x, y) {
  const ownerIdx = fac.owner;
  if (ownerIdx < 0 || ownerIdx >= game.players.length) return null;
  // 初级单位无分支；首次进化时随机定型 A 攻势 / B 守势
  const branch = '';
  const st = unitStats(type, 1, branch);
  const s = STATS[type] || STATS.warrior;
  const u = {
    id: game.nextUnitId++,
    ownerId: game.players[ownerIdx].id,
    ownerIdx,
    type: TYPE_LIST.includes(type) ? type : 'warrior',
    tier: 1,
    branch,
    maxTier: clamp(fac.level, 1, 3),
    homeFac: fac.id,
    x: clamp(x, 20, WORLD_W - 20),
    y: clamp(y, 20, WORLD_H - 20),
    angle: game._rng() * Math.PI * 2,
    hp: st.hp,
    maxHp: st.hp,
    dmg: st.dmg,
    range: st.range,
    cdMax: st.cd,
    cdLeft: 0,
    speed: s.speed,
    r: s.r,
    splash: s.splash || 0,
    burn: Boolean(s.burn),
    xp: 0,
    targetId: 0,
    scanAt: 0,
    moveX: null,
    moveY: null,
    homeX: x,
    homeY: y,
    chasing: false,
    disengageUntil: 0,
    burnUntil: 0,
    burnDps: 0,
    burnFrom: -1,
    lastHitBy: 0,
    killerIdx: null,
    dead: false,
  };
  game.units.push(u);
  return u;
}

function garrisonOf(game, facId, ownerIdx) {
  let n = 0;
  for (const u of game.units) {
    if (!u.dead && u.homeFac === facId && u.ownerIdx === ownerIdx) n++;
  }
  return n;
}

function labOwnedBy(game, ownerIdx) {
  return game.labs.some((l) => l.owner === ownerIdx);
}

function pushEvent(game, ev) {
  game.events.push(ev);
  if (game.events.length > 60) game.events.shift();
}

/** 经验获取（研究所归属方加成） */
function grantXp(game, u, amount) {
  if (u.dead) return;
  const mult = labOwnedBy(game, u.ownerIdx) ? LAB_XP_MULT : 1;
  u.xp += amount * mult;
}

/** 检查进化；进化后属性按新等级重算，血量按比例保留 */
function checkEvolve(game, u) {
  let evolved = false;
  while (u.tier < u.maxTier && u.xp >= XP_NEED[u.tier - 1]) {
    u.tier += 1;
    // 分支在首次进化时定型，之后保持
    if (!u.branch) u.branch = game._rng() < 0.5 ? 'A' : 'B';
    const st = unitStats(u.type, u.tier, u.branch);
    const ratio = u.maxHp > 0 ? u.hp / u.maxHp : 1;
    u.maxHp = st.hp;
    u.hp = Math.max(1, Math.round(st.hp * ratio));
    u.dmg = st.dmg;
    u.range = st.range;
    u.cdMax = st.cd;
    u.splash = (STATS[u.type] || STATS.warrior).splash || 0;
    u.burn = Boolean((STATS[u.type] || STATS.warrior).burn);
    game.players[u.ownerIdx].evolved += 1;
    pushEvent(game, { t: 'evo', uid: u.id, oi: u.ownerIdx, tier: u.tier, x: round1(u.x), y: round1(u.y) });
    evolved = true;
  }
  return evolved;
}

/* ---------------- 占领 ---------------- */

function updateCaptures(game, dt) {
  let captured = 0;
  for (const f of game.factories) {
    const counts = new Map();
    for (const u of game.units) {
      if (u.dead) continue;
      if (dist(u.x, u.y, f.x, f.y) > CAPTURE_R) continue;
      counts.set(u.ownerIdx, (counts.get(u.ownerIdx) || 0) + 1);
    }
    const ownerPresent = f.owner >= 0 && counts.has(f.owner);
    const attackers = [...counts.keys()].filter((i) => i !== f.owner);
    f.contested = false;

    if (attackers.length === 1 && !ownerPresent) {
      f.capBy = attackers[0];
      f.capProg += CAPTURE_RATE * dt;
      if (f.capProg >= 100) {
        const prev = f.owner;
        f.owner = f.capBy;
        f.capProg = 0;
        f.capBy = -1;
        f.prodProg = 0;
        game.players[f.owner].captured += 1;
        pushEvent(game, { t: 'cap', fid: f.id, oi: f.owner, prev, x: f.x, y: f.y });
        captured++;
      }
    } else if (attackers.length === 0) {
      // 无攻方：进度回退
      if (f.capProg > 0) {
        f.capProg = Math.max(0, f.capProg - RECLAIM_RATE * dt);
        if (f.capProg === 0) f.capBy = -1;
      }
    } else {
      // 多方争夺 / 守军相持：冻结
      f.contested = true;
    }
  }
  return captured;
}

/* ---------------- 生产 ---------------- */

function updateProduction(game, dt) {
  const dtMs = dt * 1000;
  for (const f of game.factories) {
    if (f.owner < 0) continue;
    if (garrisonOf(game, f.id, f.owner) >= FACTORY_CAP[f.level]) continue;
    f.prodProg += dtMs / PRODUCE_MS;
    if (f.prodProg >= 1) {
      f.prodProg -= 1;
      const ang = game._rng() * Math.PI * 2;
      const d = FACTORY_R + 28;
      spawnUnit(
        game,
        f,
        pickWeighted(game._rng),
        f.x + Math.cos(ang) * d,
        f.y + Math.sin(ang) * d
      );
    }
  }
}

/* ---------------- 单位 AI ---------------- */

function findTarget(game, u) {
  const aggro = u.range + AGGRO_BONUS;
  let best = null;
  let bestD = Infinity;
  for (const e of game.units) {
    if (e.dead || e.ownerIdx === u.ownerIdx) continue;
    const d = dist(u.x, u.y, e.x, e.y);
    if (d > aggro) continue;
    // 优先当前目标（粘性），其次最近
    const score = e.id === u.targetId ? d - 40 : d;
    if (score < bestD) {
      bestD = score;
      best = e;
    }
  }
  return best;
}

function unitFire(game, u, target, now) {
  const kind = u.splash ? 'shell' : u.burn ? 'fire' : u.range <= MELEE_RANGE ? 'melee' : 'bullet';
  const speed = kind === 'melee' ? BULLET_SPEED_MELEE : BULLET_SPEED;
  const ang = Math.atan2(target.y - u.y, target.x - u.x);
  u.angle = ang;
  game.bullets.push({
    id: game.nextBulletId++,
    x: u.x + Math.cos(ang) * (u.r + 4),
    y: u.y + Math.sin(ang) * (u.r + 4),
    vx: Math.cos(ang) * speed,
    vy: Math.sin(ang) * speed,
    dmg: u.dmg,
    ownerIdx: u.ownerIdx,
    ownerId: u.ownerId,
    shooterId: u.id,
    kind,
    splash: u.splash || 0,
    tx: target.x,
    ty: target.y,
    targetId: kind === 'shell' ? 0 : target.id,
    born: now,
    dead: false,
  });
}

function updateUnits(game, dt, now) {
  for (const u of game.units) {
    if (u.dead) continue;
    if (u.cdLeft > 0) u.cdLeft -= dt;

    // 周期性索敌（撤退窗口内不索敌，方便把残兵拉出火线）
    if (now >= u.scanAt) {
      u.scanAt = now + SCAN_MS + (u.id % 5) * 20;
      if (u.disengageUntil && now < u.disengageUntil) {
        u.targetId = 0;
      } else {
        const t = findTarget(game, u);
        if (t) {
          if (!u.targetId) {
            // 从空闲转入交战：记录归位点（守军拴绳）
            u.homeX = u.x;
            u.homeY = u.y;
            u.chasing = !u.moveX;
          }
          u.targetId = t.id;
        } else if (u.targetId) {
          u.targetId = 0;
          u.chasing = false;
        }
      }
    }

    let target = null;
    if (u.targetId) {
      target = game.units.find((e) => e.id === u.targetId && !e.dead) || null;
      if (!target) u.targetId = 0;
    }

    // 空闲守军拴绳：追太远就归位
    if (!u.moveX && u.chasing && target) {
      if (dist(u.x, u.y, u.homeX, u.homeY) > LEASH_DIST) {
        u.targetId = 0;
        u.chasing = false;
        u.moveX = u.homeX;
        u.moveY = u.homeY;
        target = null;
      }
    }

    if (target && !(u.disengageUntil && now < u.disengageUntil)) {
      const d = dist(u.x, u.y, target.x, target.y);
      const reach = u.range + target.r;
      u.angle = Math.atan2(target.y - u.y, target.x - u.x);
      if (d > reach * 0.92) {
        const spd = u.speed * dt;
        u.x += Math.cos(u.angle) * spd;
        u.y += Math.sin(u.angle) * spd;
      } else if (u.cdLeft <= 0) {
        unitFire(game, u, target, now);
        u.cdLeft = u.cdMax;
      }
    } else if (u.moveX != null) {
      const d = dist(u.x, u.y, u.moveX, u.moveY);
      if (d <= 26) {
        u.moveX = null;
        u.moveY = null;
        u.disengageUntil = 0;
      } else {
        const ang = Math.atan2(u.moveY - u.y, u.moveX - u.x);
        u.angle = ang;
        const spd = u.speed * dt;
        u.x += Math.cos(ang) * spd;
        u.y += Math.sin(ang) * spd;
      }
    }
  }
}

/* ---------------- 弹道 ---------------- */

function applyBurn(victim, fromIdx, now) {
  victim.burnUntil = now + BURN_MS;
  victim.burnDps = Math.max(victim.burnDps || 0, BURN_DPS);
  victim.burnFrom = fromIdx;
}

function damageUnit(game, victim, amount, killerIdx) {
  if (victim.dead || amount <= 0) return;
  victim.hp -= amount;
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.dead = true;
    victim.killerIdx = killerIdx;
    pushEvent(game, { t: 'kill', vi: victim.ownerIdx, ki: killerIdx, x: round1(victim.x), y: round1(victim.y), tier: victim.tier });
  }
}

/** 受击反击：被攻击且处于空闲的单位立即锁定攻击者（防止被远程无伤风筝） */
function retaliate(game, victim, shooterId) {
  if (!shooterId || victim.targetId || victim.moveX != null || victim.dead) return;
  const shooter = game.units.find((u) => u.id === shooterId && !u.dead);
  if (!shooter || shooter.ownerIdx === victim.ownerIdx) return;
  victim.targetId = shooter.id;
  victim.homeX = victim.x;
  victim.homeY = victim.y;
  victim.chasing = true;
}

function explodeShell(game, b, x, y, now) {
  b.dead = true;
  pushEvent(game, { t: 'boom', x: round1(x), y: round1(y), r: b.splash, oi: b.ownerIdx });
  for (const e of game.units) {
    if (e.dead || e.ownerIdx === b.ownerIdx) continue;
    if (dist(e.x, e.y, x, y) <= b.splash + e.r) {
      e.lastHitBy = b.shooterId || 0;
      retaliate(game, e, b.shooterId);
      const dealt = Math.min(e.hp, b.dmg);
      grantXpToShooter(game, b, dealt);
      damageUnit(game, e, b.dmg, b.ownerIdx);
    }
  }
}

/** 弹道命中时的经验记账（按实际伤害，记给射手单位本体） */
function grantXpToShooter(game, b, dealt) {
  if (dealt <= 0 || !b.shooterId) return;
  const u = game.units.find((x) => x.id === b.shooterId);
  if (u && !u.dead) grantXp(game, u, dealt);
}

function updateBullets(game, dt, now) {
  for (const b of game.bullets) {
    if (b.dead) continue;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // 非炮击弹道轻微追踪目标，保证命中率
    if (b.targetId) {
      const t = game.units.find((e) => e.id === b.targetId && !e.dead);
      if (t) {
        const spd = Math.hypot(b.vx, b.vy) || BULLET_SPEED;
        const ang = Math.atan2(t.y - b.y, t.x - b.x);
        b.vx = Math.cos(ang) * spd;
        b.vy = Math.sin(ang) * spd;
      }
    }

    // 寿命 / 出界
    if (now - b.born > BULLET_LIFE_MS || b.x < -20 || b.x > WORLD_W + 20 || b.y < -20 || b.y > WORLD_H + 20) {
      b.dead = true;
      continue;
    }

    if (b.kind === 'shell') {
      // 到达预定落点或撞到敌人即爆
      const movedPast = (b.vx * (b.x - b.tx) + b.vy * (b.y - b.ty)) > 0;
      let hitEnemy = false;
      for (const e of game.units) {
        if (e.dead || e.ownerIdx === b.ownerIdx) continue;
        if (dist(e.x, e.y, b.x, b.y) <= e.r + BULLET_R + 2) {
          hitEnemy = true;
          break;
        }
      }
      if (movedPast || hitEnemy) {
        explodeShell(game, b, b.tx, b.ty, now);
      }
      continue;
    }

    // 直射弹道：命中任意敌人
    for (const e of game.units) {
      if (e.dead || e.ownerIdx === b.ownerIdx) continue;
      if (dist(e.x, e.y, b.x, b.y) <= e.r + BULLET_R) {
        b.dead = true;
        e.lastHitBy = b.shooterId || 0;
        retaliate(game, e, b.shooterId);
        const dealt = Math.min(e.hp, b.dmg);
        grantXpToShooter(game, b, dealt);
        if (b.kind === 'fire') applyBurn(e, b.ownerIdx, now);
        damageUnit(game, e, b.dmg, b.ownerIdx);
        break;
      }
    }
  }
  game.bullets = game.bullets.filter((b) => !b.dead);
  if (game.bullets.length > 400) game.bullets.splice(0, game.bullets.length - 400);
}

/* ---------------- 灼烧 / 分离 / 尸体清理 ---------------- */

function updateBurns(game, dt, now) {
  for (const u of game.units) {
    if (u.dead || u.burnUntil <= now) continue;
    const dealt = Math.min(u.hp, u.burnDps * dt);
    if (u.burnFrom >= 0 && u.burnFrom !== u.ownerIdx) {
      // 灼烧伤害记经验给点火者
      const burner = game.units.find((x) => x.ownerIdx === u.burnFrom && !x.dead);
      if (burner) grantXp(game, burner, dealt);
    }
    damageUnit(game, u, u.burnDps * dt, u.burnFrom);
  }
}

/** 单位圆形分离 + 不穿过工厂建筑 + 边界约束 */
function separateUnits(game) {
  const list = game.units.filter((u) => !u.dead);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
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
    const u = list[i];
    // 工厂建筑推挤
    for (const f of game.factories) {
      const d = dist(u.x, u.y, f.x, f.y);
      const min = FACTORY_R + u.r;
      if (d < min) {
        if (d < 0.001) {
          u.x = f.x + min;
        } else {
          u.x = f.x + ((u.x - f.x) / d) * min;
          u.y = f.y + ((u.y - f.y) / d) * min;
        }
      }
    }
    for (const l of game.labs) {
      const d = dist(u.x, u.y, l.x, l.y);
      const min = 40 + u.r;
      if (d < min && d > 0.001) {
        u.x = l.x + ((u.x - l.x) / d) * min;
        u.y = l.y + ((u.y - l.y) / d) * min;
      }
    }
    u.x = clamp(u.x, u.r, WORLD_W - u.r);
    u.y = clamp(u.y, u.r, WORLD_H - u.r);
  }
}

function reapDead(game) {
  const dead = game.units.filter((u) => u.dead);
  if (!dead.length) return 0;
  for (const u of dead) {
    const victim = game.players[u.ownerIdx];
    if (victim) victim.losses += 1;
    const ki = u.killerIdx;
    if (ki != null && ki >= 0 && ki !== u.ownerIdx && game.players[ki]) {
      game.players[ki].kills += 1;
      // 伤害经验在弹道命中时已记给射手；这里把击杀奖励补给「补刀者」（若在场）
      if (u.lastHitBy) {
        const shooter = game.units.find((x) => x.id === u.lastHitBy && !x.dead);
        if (shooter) grantXp(game, shooter, KILL_XP_BASE + u.tier * KILL_XP_PER_TIER);
      }
    }
  }
  game.units = game.units.filter((u) => !u.dead);
  return dead.length;
}

/** 全军进化检查（经验在战斗中积累，这里统一触发升级） */
function evolvePhase(game) {
  let n = 0;
  for (const u of game.units) {
    if (u.dead) continue;
    if (checkEvolve(game, u)) n++;
  }
  return n;
}

/* ---------------- 胜负 ---------------- */

function updateOutcome(game) {
  let dirty = false;
  for (let i = 0; i < game.players.length; i++) {
    const p = game.players[i];
    if (p.eliminated || p.left) continue;
    const owned = game.factories.some((f) => f.owner === i);
    if (!owned) {
      p.eliminated = true;
      for (const u of game.units) {
        if (u.ownerIdx === i) u.dead = true;
      }
      pushEvent(game, { t: 'elim', oi: i });
      dirty = true;
    }
  }
  game.units = game.units.filter((u) => !u.dead);
  const alive = game.players.filter((p) => !p.eliminated && !p.left);
  if (game.phase === 'playing' && alive.length <= 1) {
    game.phase = 'over';
    game.over = true;
    game.winnerId = alive.length === 1 ? alive[0].id : null;
    pushEvent(game, { t: 'over', winner: game.winnerId || -1 });
    dirty = true;
  }
  return dirty;
}

/* ---------------- 主步进 ---------------- */

function step(game, dt, now) {
  if (game.phase === 'countdown') {
    if (now >= game.phaseEndsAt) {
      game.phase = 'playing';
      game.phaseEndsAt = 0;
      return true;
    }
    return false;
  }
  if (game.phase !== 'playing') return false;
  dt = Math.min(dt, MAX_DT);

  updateProduction(game, dt);
  const captured = updateCaptures(game, dt);
  updateUnits(game, dt, now);
  updateBullets(game, dt, now);
  updateBurns(game, dt, now);
  separateUnits(game);
  const kills = reapDead(game);
  evolvePhase(game);
  const outcomeDirty = updateOutcome(game);
  return captured > 0 || kills > 0 || outcomeDirty;
}

function tick(game) {
  const now = Date.now();
  let dt = (now - game._lastTick) / 1000;
  game._lastTick = now;
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  if (dt > MAX_DT) dt = MAX_DT;
  const before = game.phase;
  let changed = false;
  if (game.phase === 'countdown' && now >= game.phaseEndsAt) {
    game.phase = 'playing';
    game.phaseEndsAt = 0;
    changed = true;
  }
  if (game.phase === 'playing') {
    const overNow = step(game, dt, now);
    changed = changed || overNow || game.over;
  }
  game.seq += 1;
  return changed;
}

/* ---------------- 快照 ---------------- */

const TYPE_IX = {};
TYPE_LIST.forEach((t, i) => (TYPE_IX[t] = i));

function snapshot(game) {
  const now = Date.now();
  return {
    t: now,
    seq: game.seq,
    phase: game.phase,
    until: game.phaseEndsAt || 0,
    u: game.units.map((u) => [
      u.id,
      u.ownerIdx,
      round1(u.x),
      round1(u.y),
      round2(u.angle),
      TYPE_IX[u.type] || 0,
      u.tier,
      u.branch === 'A' ? 1 : u.branch === 'B' ? 2 : 0,
      Math.round(u.hp),
      u.maxTier,
      Math.round(Math.min(1, u.xp / (XP_NEED[Math.min(u.tier, 2) - 1] || 1)) * 100),
      u.burnUntil > now ? 1 : 0,
    ]),
    b: game.bullets.map((b) => [
      round1(b.x),
      round1(b.y),
      b.ownerIdx,
      b.kind === 'shell' ? 2 : b.kind === 'fire' ? 3 : b.kind === 'melee' ? 1 : 0,
    ]),
    f: game.factories.map((f) => [
      f.id,
      f.owner,
      Math.round(f.capProg),
      f.capBy,
      round2(f.prodProg),
      f.contested ? 1 : 0,
    ]),
    lb: game.labs.map((l) => l.owner),
    ev: game.events.splice(0, game.events.length),
  };
}

function publicGameState(game) {
  if (!game) return null;
  return {
    type: 'warfactory',
    world: { w: game.world.w, h: game.world.h },
    consts: JSON.parse(JSON.stringify(game.consts)),
    phase: game.phase,
    phaseEndsAt: game.phaseEndsAt || 0,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      kills: p.kills,
      losses: p.losses,
      evolved: p.evolved,
      captured: p.captured,
      eliminated: Boolean(p.eliminated),
      left: Boolean(p.left),
    })),
    factories: game.factories.map((f) => ({
      id: f.id,
      x: f.x,
      y: f.y,
      level: f.level,
      owner: f.owner,
      capBy: f.capBy,
      capProg: Math.round(f.capProg),
      prodProg: round2(f.prodProg),
      home: Boolean(f.home),
    })),
    labs: game.labs.map((l) => ({ id: l.id, x: l.x, y: l.y, owner: l.owner })),
    units: game.units.length,
    over: Boolean(game.over),
    winnerId: game.winnerId || null,
    seq: game.seq,
    serverTime: Date.now(),
  };
}

/* ---------------- 玩家输入（离散指令） ---------------- */

function setPlayerInput(game, playerId, data) {
  if (!game || !playerId || game.over) return false;
  const d = data || {};
  const cmd = String(d.cmd || '');
  const oi = game.players.findIndex((p) => p.id === playerId);
  if (oi < 0) return false;
  const p = game.players[oi];
  if (p.eliminated || p.left) return false;

  // 简单限速：每秒最多 12 条指令
  const now = Date.now();
  if (!p._cmdWin || now >= p._cmdWin + 1000) {
    p._cmdWin = now;
    p._cmdCount = 0;
  }
  p._cmdCount = (p._cmdCount || 0) + 1;
  if (p._cmdCount > 12) return false;

  if (cmd === 'move') {
    const x = Number(d.x);
    const y = Number(d.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const ids = Array.isArray(d.ids) ? d.ids.slice(0, 80) : [];
    if (!ids.length) return false;
    const tx = clamp(x, 0, WORLD_W);
    const ty = clamp(y, 0, WORLD_H);
    let n = 0;
    for (const u of game.units) {
      if (u.dead || u.ownerIdx !== oi) continue;
      if (!ids.includes(u.id)) continue;
      u.moveX = tx;
      u.moveY = ty;
      u.chasing = false;
      // 1.5s 脱离窗口：残兵可以拉出火线，之后恢复自动迎击
      u.disengageUntil = now + 1500;
      u.targetId = 0;
      n++;
    }
    return n > 0;
  }
  if (cmd === 'stop') {
    const ids = Array.isArray(d.ids) ? d.ids.slice(0, 80) : [];
    for (const u of game.units) {
      if (u.dead || u.ownerIdx !== oi) continue;
      if (!ids.includes(u.id)) continue;
      u.moveX = null;
      u.moveY = null;
      u.targetId = 0;
      u.chasing = false;
      u.disengageUntil = 0;
      u.homeX = u.x;
      u.homeY = u.y;
    }
    return true;
  }
  return false;
}

function applyAction() {
  return { ok: false, error: '实时对战无需回合操作' };
}

function getActingPlayerIds() {
  return [];
}

function onPlayerQuit(game, playerId) {
  if (!game || game.over) return;
  const oi = game.players.findIndex((p) => p.id === playerId);
  if (oi < 0) return;
  const p = game.players[oi];
  p.left = true;
  for (const f of game.factories) {
    if (f.owner === oi) {
      f.owner = -1;
      f.capProg = 0;
      f.capBy = -1;
      f.prodProg = 0;
    }
  }
  for (const l of game.labs) {
    if (l.owner === oi) l.owner = -1;
  }
  for (const u of game.units) {
    if (u.ownerIdx === oi) u.dead = true;
  }
  game.units = game.units.filter((u) => !u.dead);
  updateOutcome(game);
}

/* ---------------- 模拟主循环（按房间） ---------------- */

const loops = new Map();

function stopLoop(roomId) {
  const handle = loops.get(roomId);
  if (handle) {
    clearInterval(handle);
    loops.delete(roomId);
  }
}

/**
 * @param {object} room
 * @param {{ broadcastState?: () => void, broadcastRt?: (payload: object) => void, isAlive?: () => boolean }} io
 */
function startLoop(room, io) {
  if (!room || !room.game || room.game.type !== 'warfactory') return;
  stopLoop(room.id);
  const game = room.game;
  game._lastTick = Date.now();
  const handle = setInterval(() => {
    const cur = room.game;
    const gone =
      !cur ||
      cur !== game ||
      room.status !== 'playing' ||
      cur.over ||
      (io && typeof io.isAlive === 'function' && !io.isAlive());
    if (gone) {
      stopLoop(room.id);
      return;
    }
    let changed = false;
    try {
      changed = tick(cur);
    } catch (err) {
      console.error('[warfactory] tick failed:', err && err.message);
      stopLoop(room.id);
      return;
    }
    try {
      if (io && typeof io.broadcastRt === 'function') {
        io.broadcastRt(snapshot(cur));
      }
      const now = Date.now();
      // 全量状态：阶段/胜负变化立即广播；占领/淘汰等变化至少间隔 1s
      if (
        io &&
        typeof io.broadcastState === 'function' &&
        changed &&
        now - (game._lastStateBroadcast || 0) > 1000
      ) {
        game._lastStateBroadcast = now;
        io.broadcastState();
      }
    } catch (_) {
      /* ignore */
    }
  }, TICK_MS);
  loops.set(room.id, handle);
}

function stopAllLoops() {
  for (const handle of loops.values()) clearInterval(handle);
  loops.clear();
}

module.exports = {
  id: 'warfactory',
  label: '战争工厂',
  minPlayers: 2,
  maxPlayers: 4,
  modes: [{ id: 'standard', label: '标准模式' }],
  client: {
    styles: ['/games/warfactory/style.css'],
    scripts: ['/games/warfactory/ui.js'],
    panel: '/games/warfactory/panel.html',
  },
  createGameState,
  applyAction,
  publicGameState,
  getActingPlayerIds,
  onPlayerQuit,
  setPlayerInput,
  startLoop,
  stopLoop,
  stopAllLoops,
  snapshot,
  /** 实时对战：不支持添加电脑，也不支持对局中托管 */
  supportsHosting: false,

  /** 冒烟测试用：暴露内部推进函数，避免依赖真实时钟 */
  __test: {
    step,
    tick,
    spawnUnit,
    unitStats,
    garrisonOf,
    updateCaptures,
    updateProduction,
    updateUnits,
    updateBullets,
    reapDead,
    updateOutcome,
    consts: {
      WORLD_W,
      WORLD_H,
      FACTORY_R,
      CAPTURE_R,
      CAPTURE_RATE,
      RECLAIM_RATE,
      PRODUCE_MS,
      FACTORY_CAP,
      COUNTDOWN_MS,
      XP_NEED,
      KILL_XP_BASE,
      LAB_XP_MULT,
      BASE_START_UNITS,
      TYPE_LIST,
      STATS,
      NEUTRAL_FACTORIES,
      LABS,
      COLORS,
    },
  },
};
