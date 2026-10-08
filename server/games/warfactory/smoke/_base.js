'use strict';

/**
 * 战争工厂（warfactory）对战机器人 —— 困难难度唯一档。
 *
 * 与其它回合制游戏的 bot 不同：本作是**实时对战**，没有回合、没有 applyAction，
 * 机器人通过「周期性 think → 输出一组 setPlayerInput 指令」来代操作。
 * 调度由 warfactory/index.js 的 driveBots() 完成（挂在 startLoop 的 tick 上）。
 *
 * 设计原则（与用户对齐）：
 *  - **前 / 中 / 后期按战场流程判定，不按时钟**：
 *      前期（develop）  —— 我方尚未拿下任何工厂，抢中立工厂 + 研究所，把产线铺开；
 *      中期（skirmish） —— 已立稳脚跟（≥1 厂），拉锯、偷袭、抢科技点，攒出决定性兵力；
 *      后期（endgame）  —— 兵力足以在合理时间内拆掉敌总部（或敌总部已残），孤注一掷；
 *      危急（desperate）—— 我方总部血量见红，倾巢回防。
 *  - **战术不写死**：每次 think 都基于当前局势重算（集结点 / 主攻目标 / 集结规模 /
 *    守军比例 / 科技优先级），阶段只是偏向，不是脚本。
 *  - **换家实时判断**：我方主力正在拆敌总部、而我方总部也挨打时，
 *    比「拆完对面 vs 自己被拆完 vs 敌人回救到位」三条时间线，能赢就继续推、否则回防。
 *
 * ---------------------------------------------------------------------------
 * 两条打赢所必需的战场规律（都是实测踩出来的，写死在这里免得后人又踩一遍）：
 *
 * 1) **没有研究所就没有科技点，没有科技点就开不了第二条产线**。
 *    而每条产线「在场兵越多产得越慢、满 unitCap 个即停产」（见 data.js 的 lines），
 *    所以不占研究所 = 兵力被钉死在「总部 1 条 + 每厂 1 条」的上限上，
 *    双方各十几个兵推来推去，整整半小时谁也拆不掉总部。
 *    → 经济是硬前提：研究所权重按「还缺几座」动态抬高。
 *
 * 2) **拆总部必须集结，不能添油**。
 *    总部 10000 血、自带 40 dps 防卫，而一个兵只有 ~9 dps。三三两两往前送，
 *    等于给对面总部防空卫送经验：每 300 秒只能磨掉 1400 血，永远打不完。
 *    → 先在前压集结点把兵聚起来，达到「能在 KILL_SECONDS 内拆掉目标」或
 *      「全军 65% 已到齐」才一起压上去（见 strikeReady）。
 * ---------------------------------------------------------------------------
 *
 * 本模块只读 game、不写 game；所有动作都通过返回的 { cmd, ... } 指令数组
 * 由调用方喂给 setPlayerInput —— 与真人玩家走同一条通道，自动继承所有校验
 * （落点矫正、连通域检查、限速等）。
 */

/* ---------------- 基础工具（与 index.js 同口径，但模块独立） ---------------- */

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/** 单位每秒伤害（dps）。激光兵基础 dmg 极低，但蓄能倍率高，这里给个保守当量 */
function unitDps(u) {
  const base = u.dmg / Math.max(0.2, u.cdMax);
  return u.laser ? base * 4 : base; // 激光按 ~2 秒蓄能后 ≈ 3-4 倍折算
}

/** 综合战力：伤害 × 肉度 × 阶数加成（用于「打不打得过」的粗判） */
function unitScore(u) {
  return unitDps(u) * (0.5 + u.hp / 100) * (1 + (u.tier - 1) * 0.7);
}

/** unitScore ≈ dps × 1.5（满血一阶兵），用它把「守军战力」折算成 dps */
const SCORE_PER_DPS = 1.5;

/** 一支队伍的总 dps */
function armyDps(list) {
  let s = 0;
  for (const u of list) s += unitDps(u);
  return s;
}

/** 一支队伍的总战力 */
function armyScore(list) {
  let s = 0;
  for (const u of list) s += unitScore(u);
  return s;
}

function myHq(game, oi) {
  return game.hqs.find((h) => h.owner === oi && !h.down) || null;
}

function myFactories(game, oi) {
  return game.factories.filter((f) => f.owner === oi);
}

function myLabs(game, oi) {
  return game.labs.filter((l) => l.owner === oi);
}

function enemyHqs(game, oi) {
  return game.hqs.filter((h) => h.owner !== oi && !h.down);
}

function aliveEnemies(game, oi) {
  const out = [];
  for (let i = 0; i < game.players.length; i++) {
    if (i === oi) continue;
    const p = game.players[i];
    if (p.eliminated || p.left) continue;
    out.push(i);
  }
  return out;
}

function unitsOf(game, oi) {
  return game.units.filter((u) => !u.dead && u.ownerIdx === oi);
}

function powerOf(game, oi) {
  return armyScore(unitsOf(game, oi));
}

/** 敌人在 (x, y) r 半径内的战力（守军估算用） */
function enemyPowerNear(game, oi, x, y, r) {
  let s = 0;
  for (const u of game.units) {
    if (u.dead || u.ownerIdx === oi) continue;
    if (dist(u.x, u.y, x, y) > r) continue;
    s += unitScore(u);
  }
  return s;
}

function maxEnemyPower(game, oi) {
  let m = 0;
  for (const e of aliveEnemies(game, oi)) {
    const p = powerOf(game, e);
    if (p > m) m = p;
  }
  return m;
}

/* ---------------- 阶段判定（按战场流程，不按时钟） ---------------- */

/**
 * @returns {'develop'|'skirmish'|'endgame'|'desperate'}
 *
 * ⚠️ 「有 3 座工厂就进后期」这条早先写死过，实测是灾难：三座厂往往只有十几个兵，
 * 拿这点人去啃 10000 血的总部，就是前面说的添油。后期改由**兵力是否够拆**来定
 * （见 think 里的 strikeReady / detectStance 的 endgame 分支）。
 */
function detectStance(game, oi) {
  const hq = myHq(game, oi);
  if (!hq) return 'desperate';
  const hqRatio = hq.hp / hq.hpMax;
  if (hqRatio < 0.4) return 'desperate';

  const myPow = powerOf(game, oi);
  const foePow = maxEnemyPower(game, oi);
  const myDps = armyDps(unitsOf(game, oi));

  // 已经把对面打残 / 战力碾压 → 收官
  const foeHqLow = enemyHqs(game, oi).some((h) => h.hp < h.hpMax * 0.45);
  if (foeHqLow) return 'endgame';
  if (foePow > 0 && myPow > foePow * 1.6) return 'endgame';

  // 中立建筑抢光了 → 拉锯已经没有意义，只能去拆总部
  const neutralLeft =
    game.factories.some((f) => f.owner === -1) || game.labs.some((l) => l.owner === -1);
  if (!neutralLeft && myFactories(game, oi).length >= 2) return 'endgame';

  // 手里的兵已经够在合理时间内拆掉一座总部 → 收官（实时判定，不看时钟）
  if (myDps >= HQ_BREAK_DPS && myFactories(game, oi).length >= 2) return 'endgame';

  if (myFactories(game, oi).length >= 1) return 'skirmish';
  return 'develop';
}

/* ---------------- 主攻目标选择（高价值打分） ---------------- */

/**
 * 价值基础分：敌总部 > 敌工厂 > 中立工厂 > 敌研究所 > 中立研究所。
 * 再按「距离折扣」「守军强度折扣」「血量折扣」「粘性」修正；阶段 / 经济缺口不同，权重也不同。
 */
function pickTarget(game, oi, stance, state) {
  const hq = myHq(game, oi);
  const me = game.players[oi];
  const cx = hq ? hq.x : me.baseX || 0;
  const cy = hq ? hq.y : me.baseY || 0;
  const myPow = powerOf(game, oi);
  const cands = [];

  const labsOwned = myLabs(game, oi).length;
  const wantLabs = stance === 'develop' ? 1 : 2;
  // 经济缺口越大，研究所越香（没有科技点就开不了第二条产线，兵力永远封顶）
  const hunger = Math.max(0, wantLabs - labsOwned);

  const wHq = stance === 'endgame' ? 120 : stance === 'skirmish' ? 55 : 22;
  const wFacE = stance === 'endgame' ? 40 : stance === 'skirmish' ? 70 : 50;
  const wFacN = stance === 'develop' ? 80 : stance === 'skirmish' ? 50 : 30;
  const wLabE = 15 + hunger * 45;
  const wLabN = stance === 'develop' ? 95 : 18 + hunger * 60;

  for (const h of game.hqs) {
    if (h.owner === oi || h.down) continue;
    cands.push({ kind: 'h', id: h.id, x: h.x, y: h.y, w: wHq, ref: h });
  }
  for (const f of game.factories) {
    if (f.owner === oi) continue;
    cands.push({ kind: 'f', id: f.id, x: f.x, y: f.y, w: f.owner === -1 ? wFacN : wFacE, ref: f });
  }
  for (const l of game.labs) {
    if (l.owner === oi) continue;
    cands.push({ kind: 'l', id: l.id, x: l.x, y: l.y, w: l.owner === -1 ? wLabN : wLabE, ref: l });
  }

  for (const c of cands) {
    const d = dist(cx, cy, c.x, c.y);
    // 守军折扣：目标周围 700 内敌军比我全军还强 → 不去送
    const guard = enemyPowerNear(game, oi, c.x, c.y, 700);
    let mul = 1;
    if (guard > myPow * 0.9) mul = 0.15;
    else if (guard > myPow * 0.6) mul = 0.5;
    // 血量折扣：建筑血越残越容易被我拿下（中立厂 1/2 血最香）
    const hpRatio = c.ref.hp != null && c.ref.hpMax ? c.ref.hp / c.ref.hpMax : 1;
    const hpMul = 1 + (1 - hpRatio) * 0.4;
    // 粘性：正在打的目标给个大加成，避免来回横跳（打到一半换目标 = 两边都打不下来）
    const sticky =
      state && state.target && state.target.kind === c.kind && state.target.id === c.id ? 1.6 : 1;
    c.score = (c.w / (1 + d / 2200)) * mul * hpMul * sticky;
  }

  cands.sort((a, b) => b.score - a.score);
  return cands[0] || null;
}

/* ---------------- 集结：先聚兵，再压上去 ---------------- */

const KILL_SECONDS = 45; // 「多久能拆掉目标」的目标值：超过就继续攒兵
const HQ_BREAK_DPS = 220; // 全军 dps 过这条线就具备拆总部的资格（10000 血 ≈ 45 秒）
const STAGE_R = 900; // 集结点判定半径（离集结点这么近算「已到齐」）
const STAGE_OFF = 460; // 集结点在「最前建筑」朝目标方向的偏移量
const MASS_RATIO = 0.65; // 全军到齐这个比例就压上去（不再死等 dps 达标）
const FIELD_R = 1300; // 离目标这么近算「已经在前线」
const HQ_DEF_DPS = 40; // 总部自带防卫（data.js 的 hqDefense：20 dmg / 0.5s）

function targetKey(t) {
  return t ? t.kind + ':' + t.id : '';
}

/**
 * 前压集结点：我方**离目标最近**的那座建筑，朝目标方向外推一点。
 * 没有建筑时退回总部。
 */
function pickStage(game, oi, target) {
  const hq = myHq(game, oi);
  const bs = [];
  if (hq) bs.push({ x: hq.x, y: hq.y });
  for (const f of myFactories(game, oi)) bs.push({ x: f.x, y: f.y });
  for (const l of myLabs(game, oi)) bs.push({ x: l.x, y: l.y });
  if (!bs.length) return null;

  let best = bs[0];
  let bd = Infinity;
  if (target) {
    for (const b of bs) {
      const d = dist(b.x, b.y, target.x, target.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
  }
  if (!target) return { x: best.x, y: best.y };
  const d = dist(best.x, best.y, target.x, target.y);
  if (d < 1) return { x: best.x, y: best.y };
  const ux = (target.x - best.x) / d;
  const uy = (target.y - best.y) / d;
  const off = Math.min(STAGE_OFF, d * 0.5);
  return { x: best.x + ux * off, y: best.y + uy * off };
}

/**
 * 拆掉这个目标需要多少 dps（含它周围守军的抵抗）。
 * 总部额外算上自带防卫：它会一边挨打一边还手，等效血量更高。
 */
function needDps(game, oi, target) {
  if (!target) return 0;
  const hp = target.ref && target.ref.hp != null ? target.ref.hp : 3000;
  const guard = enemyPowerNear(game, oi, target.x, target.y, 900) / SCORE_PER_DPS;
  const selfDef = target.kind === 'h' ? HQ_DEF_DPS : 0;
  return hp / KILL_SECONDS + selfDef + guard * 1.2;
}

/**
 * 是不是该压上去了。
 *  - 够狠：集结起来的 dps 能在 KILL_SECONDS 内拆掉目标；
 *  - 够齐：全军 65% 已经聚到集结点（避免永远差一点、一直不敢打）。
 * @returns {{ready:boolean, strike:Array, haveDps:number, need:number}}
 */
function strikeReady(game, oi, target, stage) {
  const alive = unitsOf(game, oi);
  if (!target || !stage) return { ready: false, strike: [], haveDps: 0, need: 0 };
  const strike = alive.filter((u) => dist(u.x, u.y, stage.x, stage.y) <= STAGE_R);
  const haveDps = armyDps(strike);
  const need = needDps(game, oi, target);
  const minStrike = target.kind === 'h' ? 10 : target.kind === 'f' ? 5 : 3;
  const massed = strike.length >= Math.max(minStrike, Math.ceil(alive.length * MASS_RATIO));
  const strong = haveDps >= need && strike.length >= minStrike;
  return { ready: strong || massed, strike, haveDps, need };
}

/* ---------------- 偷袭检测：家门口的敌人 ---------------- */

/**
 * 找「压到我方任一建筑 THREAT_R 内」的敌兵集团，按建筑聚合。
 * 返回按威胁度降序：[{ building:{kind,id,x,y,ref}, count, power, x, y }]
 */
function detectThreats(game, oi) {
  const THREAT_R = 1100;
  const myBs = [];
  const hq = myHq(game, oi);
  if (hq) myBs.push({ kind: 'h', id: hq.id, x: hq.x, y: hq.y, ref: hq });
  for (const f of myFactories(game, oi)) myBs.push({ kind: 'f', id: f.id, x: f.x, y: f.y, ref: f });
  for (const l of myLabs(game, oi)) myBs.push({ kind: 'l', id: l.id, x: l.x, y: l.y, ref: l });

  const out = [];
  for (const b of myBs) {
    let n = 0;
    let pow = 0;
    let sx = 0;
    let sy = 0;
    for (const u of game.units) {
      if (u.dead || u.ownerIdx === oi) continue;
      const d = dist(b.x, b.y, u.x, u.y);
      if (d > THREAT_R) continue;
      n += 1;
      pow += unitScore(u);
      sx += u.x;
      sy += u.y;
    }
    if (n >= 2) out.push({ building: b, count: n, power: pow, x: sx / n, y: sy / n });
  }
  // 总部受威胁 >> 工厂受威胁 > 研究所受威胁；同类别按战力排
  const rank = (t) => (t.building.kind === 'h' ? 3 : t.building.kind === 'f' ? 2 : 1);
  out.sort((a, b) => rank(b) - rank(a) || b.power - a.power);
  return out;
}

/* ---------------- 换家三时间线 ---------------- */

/**
 * 我方主力在拆敌总部、而我方总部也挨打时：
 *   tWin  —— 我方拆完敌总部还需多久（按我方在敌总部 900 内的 dps 估）
 *   tLose —— 我方总部被拆完还能撑多久
 *   tBack —— 敌方回防到位的最短时间
 * 能同时赢两条 → 继续推；否则 → 回防。
 *
 * @returns {null|{action:'race'|'recall', tWin:number, tLose:number, tBack:number}}
 */
function raceCheck(game, oi, target, threats) {
  if (!target || target.kind !== 'h') return null;
  const hqThreat = threats.find((t) => t.building.kind === 'h');
  if (!hqThreat) return null;
  const myHqB = myHq(game, oi);
  if (!myHqB) return null;
  const foeHq = game.hqs.find((h) => h.id === target.id && !h.down);
  if (!foeHq) return null;

  let myDps = 0;
  for (const u of game.units) {
    if (u.dead || u.ownerIdx !== oi) continue;
    if (dist(u.x, u.y, foeHq.x, foeHq.y) > 900) continue;
    myDps += unitDps(u);
  }
  if (myDps <= 0.5) return null;
  const tWin = foeHq.hp / myDps;

  let foeDps = 0;
  for (const u of game.units) {
    if (u.dead || u.ownerIdx === oi) continue;
    if (dist(u.x, u.y, myHqB.x, myHqB.y) > 1100) continue;
    foeDps += unitDps(u);
  }
  if (foeDps <= 0.5) return null;
  const tLose = myHqB.hp / foeDps;
  // ⚠️ 不是「家门口有两个敌兵」就值得回救：对面只是路过 / 挠一下，我这边总部还能撑
  // 两分半以上，掉头回家就等于把已经推到对方门口的主力白白撤回来（来回一趟跨越整张图
  // 要 150 秒，来回拉扯会让整局永远打不完）。只有真的扛不住了才做这道选择题。
  if (foeDps < 20 || tLose > 150) return null;

  let tBack = Infinity;
  for (const u of game.units) {
    if (u.dead || u.ownerIdx !== foeHq.owner) continue;
    const t = dist(u.x, u.y, foeHq.x, foeHq.y) / Math.max(40, u.speed);
    if (t < tBack) tBack = t;
  }

  // 赢面要略大才值得换（避免 1% 险胜赌博），且要赶在敌回防前
  if (tWin < tLose * 0.92 && tWin < tBack * 0.95) return { action: 'race', tWin, tLose, tBack };
  return { action: 'recall', tWin, tLose, tBack };
}

/* ---------------- 科技（科技点 RP 开销） ---------------- */

/**
 * 一条指令或 null。
 * 顺序按「产出」排：先让科技点自己滚起来（研究所产线 200），再扩产线（300），
 * 再提速（300），最后进化产线（300）。
 * ⚠️ 早先 develop 阶段「只攒不花」，结果兵力被产线名额卡死在十几人，整局推不动。
 */
function pickTech(game, oi, stance) {
  const me = game.players[oi];
  if (!me || me.rp == null) return null;
  const rp = me.rp;
  const hq = myHq(game, oi);
  const myFacs = myFactories(game, oi);
  const myLs = myLabs(game, oi);

  const COST_LINE = 300;
  const COST_EVO = 300;
  const COST_SPD = 300;
  const COST_LAB = 200;

  // ① 研究所产线：最便宜、且让后续所有科技点提速 50%
  if (rp >= COST_LAB) {
    const l0 = myLs.find((l) => (l.lines || 0) < 1);
    if (l0) return { cmd: 'labLine', lid: l0.id };
  }
  // ② 扩产线：总部（没厂时的唯一口子）→ 各工厂
  if (rp >= COST_LINE) {
    if (hq && (hq.lines || 1) < 2) return { cmd: 'facLine', fid: 0, type: 'ranger' };
    const f0 = myFacs.find((f) => (f.lines || 1) < 2);
    if (f0) {
      const first = f0.specs && f0.specs[0] ? f0.specs[0].type : 'warrior';
      const second =
        first === 'warrior' ? 'ranger' : first === 'ranger' ? 'burst' : first === 'burst' ? 'shield' : 'warrior';
      return { cmd: 'facLine', fid: f0.id, type: second };
    }
  }
  // ③ 提速：全军生产率，越早买越划算
  const spdCap = stance === 'desperate' ? 10 : 8;
  if (rp >= COST_SPD && hq && (hq.speedLv || 0) < spdCap) return { cmd: 'prodSpeed' };
  // ④ 产线进化：把出厂兵抬一阶
  if (rp >= COST_EVO && stance !== 'desperate') {
    for (const f of myFacs) {
      if (f.level < 2 || (f.evoCd || 0) > 0) continue;
      const specs = f.specs || [];
      for (let li = 0; li < specs.length; li++) {
        if ((specs[li].tier || 1) < f.level) return { cmd: 'facEvolve', fid: f.id, li };
      }
    }
  }
  return null;
}

/* ---------------- 集结点 ---------------- */

/**
 * 给我方每座建筑（厂 + 总部）设集结点：
 *   未发动总攻 → 指到**前压集结点**（新兵出大门就去和大部队会合，不要单枪匹马送死）；
 *   已发动总攻 → 直接指到目标（补充兵直奔战场）；
 *   危急      → 指到总部外侧（回防）。
 *
 * 不每帧都发：state.rallies 记着上一次的「目标键」，没变就跳过。
 */
function assignRallies(game, oi, stance, target, stage, committed, state) {
  const cmds = [];
  if (!state.rallies) state.rallies = {};

  const hq = myHq(game, oi);
  const myBs = [];
  if (hq) myBs.push({ kind: 'hq', key: 'hq:0', fid: 0, x: hq.x, y: hq.y, ref: hq });
  for (const f of myFactories(game, oi)) {
    myBs.push({ kind: 'f', key: 'f:' + f.id, fid: f.id, x: f.x, y: f.y, ref: f });
  }

  let rx = null;
  let ry = null;
  let tag = '';
  if (stance === 'desperate' && hq) {
    rx = hq.x;
    ry = hq.y;
    tag = 'home';
  } else if (committed && target) {
    // 已发动总攻：补充兵直奔战场
    rx = target.x;
    ry = target.y;
    tag = 'atk:' + targetKey(target);
  } else if (stage) {
    rx = target.x;
    ry = target.y;
    tag = 'atk:' + targetKey(target);
  } else if (hq) {
    rx = hq.x;
    ry = hq.y;
    tag = 'home';
  }
  if (rx == null) return cmds;

  for (const b of myBs) {
    const key = tag;
    if (state.rallies[b.key] === key) continue; // 没变，不重发
    state.rallies[b.key] = key;
    cmds.push({ cmd: 'rally', fid: b.fid, x: Math.round(rx), y: Math.round(ry) });
  }
  return cmds;
}

/* ---------------- 部队分组与调度 ---------------- */

/**
 * 守军比例：develop 0 / skirmish 0.1 / endgame 0.06 / desperate 0.8
 * （无威胁时几乎不留守：总部自带防卫，兵力压上去才有输出。）
 *
 * 调度优先级：
 *   ① 换家判决（race / recall）
 *   ② 未集结完成 → 机动部队去集结（守军照常护家）
 *   ③ 已集结    → 机动部队扑向主目标
 */
function assignUnits(game, oi, stance, target, threats, race, stage, committed) {
  const cmds = [];
  const hq = myHq(game, oi);
  if (!hq) return cmds;

  const alive = unitsOf(game, oi);
  if (!alive.length) return cmds;

  // —— 换家判决优先 ——
  if (race) {
    const ids = alive.map((u) => u.id);
    if (race.action === 'race' && target && target.kind === 'h') {
      cmds.push({ cmd: 'attack', kind: 'h', id: target.id, ids });
      return cmds;
    }
    if (race.action === 'recall') {
      cmds.push({ cmd: 'move', x: Math.round(hq.x), y: Math.round(hq.y), ids });
      return cmds;
    }
  }

  const keepRatio =
    stance === 'desperate' ? 0.8 : stance === 'endgame' ? 0.06 : stance === 'skirmish' ? 0.1 : 0;
  const threatPow = threats.length ? threats[0].power : 0;
  const myPow = powerOf(game, oi);
  const threatBoost = threatPow > 0 ? Math.min(0.5, (threatPow / Math.max(1, myPow)) * 0.6) : 0;
  let keep = Math.max(0, Math.round(alive.length * Math.min(0.85, keepRatio + threatBoost)));
  // 对面总部只剩一口气 → 一个兵也不留，全部压上去收人头
  if (target && target.kind === 'h' && target.ref && target.ref.hp < target.ref.hpMax * 0.25) keep = 0;

  // 按「离总部近 + 远程优先」选守军
  const scored = alive
    .map((u) => {
      const d = dist(u.x, u.y, hq.x, hq.y);
      const rangedBonus = u.range > 100 ? -200 : 0;
      const lowHp = u.hp / u.maxHp < 0.4 ? 100 : 0;
      return { u, score: d + rangedBonus + lowHp };
    })
    .sort((a, b) => a.score - b.score);

  const guards = scored.slice(0, keep).map((s) => s.u);
  const mobile = scored.slice(keep).map((s) => s.u);

  // —— 守军：有威胁打威胁，否则站岗 ——
  if (guards.length) {
    if (threats.length) {
      const t = threats[0];
      let focus = null;
      let fd = Infinity;
      for (const u of game.units) {
        if (u.dead || u.ownerIdx === oi) continue;
        const d = dist(u.x, u.y, t.x, t.y);
        if (d > 400) continue;
        if (d < fd) {
          fd = d;
          focus = u;
        }
      }
      if (focus) cmds.push({ cmd: 'attack', kind: 'u', id: focus.id, ids: guards.map((u) => u.id) });
      else cmds.push({ cmd: 'move', x: Math.round(t.x), y: Math.round(t.y), ids: guards.map((u) => u.id) });
    } else {
      cmds.push({
        cmd: 'move',
        x: Math.round(hq.x + 80),
        y: Math.round(hq.y + 80),
        ids: guards.map((u) => u.id),
      });
    }
  }

  // —— 机动部队 ——
  if (mobile.length) {
    if (!target) {
      if (stage) cmds.push({ cmd: 'move', x: Math.round(stage.x), y: Math.round(stage.y), ids: mobile.map((u) => u.id) });
    } else if (committed) {
      // 全军扑向主目标：已经在前线的继续打，后队一路赶上去（补充兵也由集结点直发战场）
      cmds.push({ cmd: 'attack', kind: target.kind, id: target.id, ids: mobile.map((u) => u.id) });
    } else if (stage) {
      // 还没凑够人：先到前压集结点会合（移动途中照常自动索敌开火）
      cmds.push({ cmd: 'move', x: Math.round(stage.x), y: Math.round(stage.y), ids: mobile.map((u) => u.id) });
    } else {
      cmds.push({ cmd: 'attack', kind: target.kind, id: target.id, ids: mobile.map((u) => u.id) });
    }
  }

  return cmds;
}

/* ---------------- 主入口 ---------------- */

/**
 * 一次思考 → 一组指令（≤ 6 条）。
 *
 * @param {object} game       战争工厂 game 对象
 * @param {string} playerId   玩家 id（不是 ownerIdx）
 * @param {string} difficulty 难度（保留参数；当前唯一档 hard，内部忽略）
 * @param {object} state      跨 think 的持久状态（挂在 game._botStates[playerId] 上）
 * @param {number} [now]      游戏内时钟（毫秒），用于「总攻发起了多久」的计时
 * @returns {Array<object>|null}
 */
function think(game, playerId, difficulty, state, now) {
  void difficulty; // 唯一档 hard
  if (!game || game.over || game.phase !== 'playing') return null;
  const oi = game.players.findIndex((p) => p.id === playerId);
  if (oi < 0) return null;
  const me = game.players[oi];
  if (!me || me.eliminated || me.left) return null;

  state = state || {};
  const tNow = Number.isFinite(now) ? now : 0;

  const stance = detectStance(game, oi);
  const target = pickTarget(game, oi, stance, state);
  const threats = detectThreats(game, oi);
  const race = raceCheck(game, oi, target, threats);

  const alive = unitsOf(game, oi);
  // —— 集结判定：先聚兵，够狠 / 够齐才压上去 ——
  const stage = stance === 'desperate' ? myHq(game, oi) : pickStage(game, oi, target);
  const sk = targetKey(target);
  let committed = false;
  if (stance !== 'desperate' && target) {
    const need = needDps(game, oi, target);
    if (state.committed === sk && state.commitAt != null) {
      // 已经压上去了：只要「还在赶路」或「战场上还有兵」就继续推。
      // ⚠️ 这里绝不能再用「离集结点多远」判——大部队一开拔，集结点附近就空了，
      //    会被判成「人没到齐」而原地召回，来回拉锯、整局零进展（实测过的坑）。
      const marchSec = state.marchSec || 0;
      const elapsed = (tNow - state.commitAt) / 1000;
      const field = alive.filter((u) => dist(u.x, u.y, target.x, target.y) <= FIELD_R);
      const fieldDps = armyDps(field);
      const crushed = elapsed > marchSec && fieldDps < need * 0.3 && alive.length < 12;
      if (crushed) state.committed = null;
      else committed = true;
    } else {
      state.committed = null;
      const sr = stage ? strikeReady(game, oi, target, stage) : null;
      if (sr && sr.ready) {
        state.committed = sk;
        state.commitAt = tNow;
        // 赶路宽限：从集结点走到目标的时间 + 20 秒接战时间
        state.marchSec = dist(stage.x, stage.y, target.x, target.y) / 55 + 20;
        committed = true;
      }
    }
  } else {
    state.committed = null;
  }

  const cmds = [];

  // 1) 科技（一条）
  const tech = pickTech(game, oi, stance);
  if (tech) cmds.push(tech);

  // 2) 集结点（每座建筑至多一条；未变则不发）
  cmds.push(...assignRallies(game, oi, stance, target, stage, committed, state));

  // 3) 部队（≤ 2 条）
  cmds.push(...assignUnits(game, oi, stance, target, threats, race, stage, committed));

  // 记状态，供下次粘性判断
  state.stance = stance;
  state.target = target ? { kind: target.kind, id: target.id } : null;
  state.threat = threats.length ? { kind: threats[0].building.kind, id: threats[0].building.id } : null;

  // 截到 6 条：rally 占得多时，tech 可能发不出去，下帧再补（state.rallies 已记）
  return cmds.slice(0, 6);
}

/**
 * 兼容 gameSupportsBot() 判定：warfactory 通过导出本函数宣告「我接 AI」。
 * 实际驱动不走 scheduleBotTick（实时制无回合、getActingPlayerIds 返回 []，
 * 调度框架会自然跳过）；真正的思考在 warfactory/index.js 的 driveBots() 里调 think()。
 */
function decideBotAction() {
  return null;
}

module.exports = {
  think,
  decideBotAction,
  // 供测试 / 调试
  _internal: {
    detectStance,
    pickTarget,
    detectThreats,
    raceCheck,
    pickTech,
    assignRallies,
    assignUnits,
    pickStage,
    strikeReady,
    needDps,
    powerOf,
    enemyPowerNear,
    unitScore,
    unitDps,
  },
};
