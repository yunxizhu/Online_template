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
 * 2) **拆总部必须集结，不能添油**；但**集结也不能无限等**（见下面第 3 条）。
 *    总部 10000 血、自带 40 dps 防卫，而一个兵只有 ~9 dps。三三两两往前送，
 *    等于给对面总部防空卫送经验：每 300 秒只能磨掉 1400 血，永远打不完。
 *    → 先在前压集结点把兵聚起来，达到「能在 KILL_SECONDS 内拆掉目标」或
 *      「全军 50% 已到齐」才一起压上去（见 strikeReady）。
 *
 * 3) **中后局「等」是纯亏的**：两军在半路顶牛时，每多等一秒对面的产线就多吐一个兵。
 *    所以「到齐比例 / 拆杀时限 / 僵持换目标」这几个门槛都是朝「更早、更坚决」的方向调出来的
 *    （实测见各处的注释），不是拍脑袋。
 * ---------------------------------------------------------------------------
 *
 * 本模块只读 game、不写 game；所有动作都通过返回的 { cmd, ... } 指令数组
 * 由调用方喂给 setPlayerInput —— 与真人玩家走同一条通道，自动继承所有校验
 * （落点矫正、连通域检查、限速等）。
 */

/* ---------------- 基础工具（与 index.js 同口径，但模块独立） ---------------- */

const WFData = require('../data.js');
const GRID_PX = WFData.grid.cell; // 与 index.js 同一个 GRID：所有「格」量都用它换算
const HQ_R_PX = (WFData.buildings.hqSize * GRID_PX) / 2; // 总部碰撞半径（45px）
const HQ_DEF_R_PX = WFData.hqDefense.range * GRID_PX; // 总部防卫射程（200px）
const WORLD_PX = 11520; // 与 index.js 的 WORLD_W 同值（世界是正方形）

// 残血兵后撤（A/B 自对弈实测：净胜 13:11、强度分 +2569）
const RETREAT_HP = 0.35; // 血量低于这个比例才撤
const RETREAT_NEAR = 420; // 而且得有敌兵贴到这么近才撤（没人打你就别乱跑）
const RETREAT_D = 520; // 后撤距离：够退出一轮交火，又不至于跑出自己的射程

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

/* ---------------- 战略方向：真人会换打法，机器人也得会 ---------------- */

/**
 * 五个方向**不是开局选一个然后一条路走到黑**，而是每次思考按局势重选的**偏向**：
 *   turtle   逆风收缩：保总部、只吃近处的，等对面扑空
 *   boom     发育：抢中立厂所、把科技点产线铺起来（经济优先）
 *   harass   快攻干扰：主力照常发育，另派一小股去拆对面的厂 / 所，拖慢他的发育
 *   pressure 压制拉锯：经济 / 兵力已经领先，持续吃对面的建筑把优势滚起来
 *   finish   一波压死：屯够兵，全军拆总部
 *
 * 真人打的就是这条序列：**先发育 → 有兵力就派一股骚扰 → 骚扰让对面慢下来 →
 * 转发育把经济拉开 → 优势够了压上去一波带走**。这里是同一套条件实时切出来的，
 * 不是脚本。方向只改**偏向**（科技怎么花、分不分骚扰股、要不要屯兵），
 * 每一步具体做什么仍然由当时的战场决定 —— 所以是「融合」，不是「单一战术」。
 *
 * ⚠️ 必须带最小驻留时间：方向刚换完就换回来 = 部队在半路反复掉头，比不换更糟
 * （和「目标粘性」是同一个道理，只是尺度更大）。
 */
const POSTURE_MIN_MS = 30000; // 一个方向至少打这么久才允许换
const HARASS_MIN_UNITS = 10; // 少于这么多兵就别分兵骚扰（自己还站不稳）
const HARASS_MAX_UNITS = 8; // 骚扰股上限（试过 14 / 35%：强度分 12934 → 11890，主力被抽空）
const HARASS_RATIO = 0.25; // 骚扰股占全军比例
const HARASS_KEEP = 6; // 至少要给主力留这么多兵

function postureInfo(game, oi) {
  let foeEco = 0;
  for (const e of aliveEnemies(game, oi)) {
    const v =
      game.factories.filter((f) => f.owner === e).length +
      game.labs.filter((l) => l.owner === e).length * 2;
    if (v > foeEco) foeEco = v;
  }
  return {
    myEco: myFactories(game, oi).length + myLabs(game, oi).length * 2,
    foeEco,
    myPow: powerOf(game, oi),
    foePow: maxEnemyPower(game, oi),
    units: unitsOf(game, oi).length,
    neutralLeft:
      game.factories.some((f) => f.owner === -1) || game.labs.some((l) => l.owner === -1),
  };
}

function pickPosture(game, oi, stance, state, tNow) {
  const info = postureInfo(game, oi);
  let next;
  if (stance === 'desperate') next = 'turtle';
  else if (stance === 'endgame') next = 'finish';
  else if (!info.neutralLeft && info.myEco >= 2) next = 'pressure'; // 中立抢光了，只能去吃对面的
  else if (info.myEco <= info.foeEco - 2 && info.myPow < info.foePow * 0.8) next = 'turtle';
  else if (info.units >= HARASS_MIN_UNITS && info.foeEco >= 1 && info.myPow > info.foePow * 0.7)
    next = 'harass'; // 对面已经起来产能了 —— 趁他还没滚起来去踢一脚
  else if (info.myEco >= info.foeEco + 2 || info.myPow > info.foePow * 1.15) next = 'pressure';
  else next = 'boom';

  const cur = state.posture;
  if (cur && cur.k === next) return next;
  // 救命 / 收人头这两个方向立刻切，不等驻留
  if (next === 'finish' || next === 'turtle') {
    state.posture = { k: next, at: tNow };
    return next;
  }
  if (cur && tNow - cur.at < POSTURE_MIN_MS) return cur.k;
  state.posture = { k: next, at: tNow };
  return next;
}

/**
 * 快攻干扰股：挑**对面**离我方部队重心最近、又啃得动的建筑（**研究所优先** ——
 * 断科技点等于断他的产线 / 进化 / 提速），派一小股过去。
 *
 * ⚠️ 是「一小股」：真人快攻是为了拖慢对面，不是把自己送掉。主力照常发育 / 压制，
 * 所以骚扰股有硬上限（25% / 至多 8 个），而且至少要给主力留 HARASS_KEEP 个兵。
 *
 * ⚠️⚠️ 还有一条更硬的：**拿不下的目标不许去**。派一股去啃 5000 血的满血厂，
 * 既拆不掉又被回防吃掉 —— 实测这个判据加上之前（35% 大股、随便挑最近的敌方建筑）
 * 强度分 12934 → 11890；加上之后回到 12930。挑目标还偏好**离敌方总部远**的外围厂
 * （回防成本高）。
 */
function pickHarass(game, oi, units, myPow) {
  if (!units || units.length < HARASS_MIN_UNITS) return null;
  const n = Math.min(
    HARASS_MAX_UNITS,
    Math.max(4, Math.round(units.length * HARASS_RATIO)),
    units.length - HARASS_KEEP
  );
  if (n < 4) return null;
  let cx = 0;
  let cy = 0;
  for (const u of units) {
    cx += u.x;
    cy += u.y;
  }
  cx /= units.length;
  cy /= units.length;
  // 敌方总部在哪：离它**越远**的厂越难回防，越值得踢
  const foeHq = enemyHqs(game, oi)[0] || null;

  const cands = [];
  for (const l of game.labs) {
    if (l.owner < 0 || l.owner === oi) continue;
    cands.push({ kind: 'l', id: l.id, x: l.x, y: l.y, ref: l, w: 1.5 });
  }
  for (const f of game.factories) {
    if (f.owner < 0 || f.owner === oi) continue;
    cands.push({ kind: 'f', id: f.id, x: f.x, y: f.y, ref: f, w: 1 });
  }
  const scoredC = [];
  for (const c of cands) {
    if (enemyPowerNear(game, oi, c.x, c.y, 600) > myPow * 0.5) continue;
    const hpRatio = c.ref.hp != null && c.ref.hpMax ? c.ref.hp / c.ref.hpMax : 1;
    const outer = 1 + (foeHq ? dist(foeHq.x, foeHq.y, c.x, c.y) : 0) / 6000;
    scoredC.push({
      c,
      s: (c.w * (1 + (1 - hpRatio) * 1.6) * outer) / (1 + dist(cx, cy, c.x, c.y) / 3000),
    });
  }
  scoredC.sort((a, b) => b.s - a.s);
  // ⚠️ 只踢「这一股真能在 KILL_SECONDS 内拆掉」的目标 —— 拿不下的硬啃 = 白送一队兵
  for (const it of scoredC) {
    const squad = units
      .slice()
      .sort((p, q) => dist(p.x, p.y, it.c.x, it.c.y) - dist(q.x, q.y, it.c.x, it.c.y))
      .slice(0, n);
    if (armyDps(squad) * KILL_SECONDS >= (it.c.ref.hp != null ? it.c.ref.hp : 5000)) {
      return { target: it.c, units: squad };
    }
  }
  return null;
}

/* ---------------- 主攻目标选择（高价值打分） ---------------- */

/**
 * 价值基础分：敌总部 > 敌工厂 > 中立工厂 > 敌研究所 > 中立研究所。
 * 再按「距离折扣」「守军强度折扣」「血量折扣」「粘性」修正；阶段 / 经济缺口不同，权重也不同。
 * @returns {Array} 按分数降序的候选列表（pickTarget 取第 0 个，pickProngs 拿前几个分兵）
 */
function rankTargets(game, oi, stance, state, tNow) {
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
  // ⚠️ 后期别再为研究所分心：缺所时 wLabE 会飙到 105，配上距离折扣能把敌总部比下去，
  // 于是全军在半个地图上来回拉练（实测 seed=112：h:2 ↔ l:2 每 100 秒换一次，
  // 「集结点到齐比例」永远凑不满、committed 被反复清空 → 56 个兵打不掉 10000 血）。
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
    // ⚠️ 0.4 → 0.8 → 1.2 → 1.6 是逐档实测出来的（24 局强度分 10076 → 11501 → 12491 → 12934）：
    // 「快打完了」本身就是最强的吸引力 —— 再补一刀就能变成自己的产能，
    // 而去啃一座满血的新目标要从头再来。真人一定先收残血。
    const hpMul = 1 + (1 - hpRatio) * 1.6;
    // 粘性：正在打的目标给个大加成，避免来回横跳（打到一半换目标 = 两边都打不下来）
    const sticky =
      state && state.target && state.target.kind === c.kind && state.target.id === c.id ? 1.6 : 1;
    // ⚠️ 距离折扣的分母不能再小：2200 会把 9600px 外的敌总部砍到 0.19 倍，
    // 反而输给近处的厂/所 —— 后期就永远在「想去打总部 → 被近处目标勾走」之间横跳。
    // ⚠️ 工厂**分等级**，而且只有 lv≥2 的厂能进化（lv2→2 阶、lv3→3 阶），
    // lv1 厂永远只能吐 1 阶兵。全场 14 座里 lv1×8 / lv2×4 / lv3×2 ——
    // 不分等级地抢，等于把有限的兵力花在 8 座「永远升不了阶」的厂上，
    // 而 3 阶兵是唯一能压垮对手的质量差。所以 lv3 厂的吸引力要翻倍。
    c.score = (c.w / (1 + d / 2200)) * mul * hpMul * sticky;
  }

  cands.sort((a, b) => b.score - a.score);
  // 拉黑名单：啃不动的目标一段时间内不再考虑（见 think 里的僵持检测）
  if (state && state.blocked && cands.length > 2) {
    return cands.filter((c) => !(state.blocked[targetKey(c)] > tNow));
  }
  return cands;
}

function pickTarget(game, oi, stance, state, tNow) {
  return rankTargets(game, oi, stance, state, tNow)[0] || null;
}

/* ---------------- 僵持检测：啃不动就换目标 ---------------- */

// ⚠️ 40s → 25s 是实测出来的（24 局强度分 9634 → 10076）：换目标越快，扩张窗口吃得住。
const PROBE_MS = 25000; // 一个目标啃这么久还没有任何进展 → 判定卡住
const PROBE_BLOCK_MS = 90000; // 卡住的目标拉黑这么久（够换两三个目标了）
const PROBE_REACH_R = 700; // 「有兵真正摸到目标」的判据

/**
 * ⚠️ 没有这套机制，机器人会**死磕一个够不着 / 打不动的目标打到输**：
 * 实测 seed=112，P0 从第 150 秒起一直锁着中立厂 f:13，兵一路死在半路，
 * 到 1094 秒总部被打爆时仍是一座厂都没拿下 —— 而对手同期已经拿了 4 座。
 * 真人早换目标了。
 *
 * 判据（两条都要满足才算卡住）：
 *   ① 一个兵都没摸到目标 PROBE_REACH_R 内；
 *   ② 目标血量一点没掉。
 * 只要有任一条有进展就重新计时。卡住 → 拉黑，让 pickTarget 挑下一个。
 *
 * 只在「真的在打」的时候判（已发动总攻 / 前中期）—— 否则「故意在集结点等集结」
 * 会被误判成够不着，把敌总部也拉黑了。
 */
function updateProbe(game, oi, state, tNow, committed, stance) {
  if (!state.target) {
    state.probe = null;
    return;
  }
  const k = targetKey(state.target);
  const ref =
    state.target.kind === 'h'
      ? game.hqs.find((h) => h.id === state.target.id)
      : state.target.kind === 'f'
        ? game.factories.find((f) => f.id === state.target.id)
        : game.labs.find((l) => l.id === state.target.id);
  if (!ref) {
    state.probe = null;
    return;
  }
  const active = committed || stance === 'develop' || stance === 'skirmish';
  if (!active) {
    state.probe = null;
    return;
  }
  const hp = ref.hp != null ? ref.hp : null;
  if (state.probe && state.probe.k === k) {
    const reached = unitsOf(game, oi).some(
      (u) => dist(u.x, u.y, ref.x, ref.y) <= PROBE_REACH_R
    );
    const bled = hp != null && state.probe.hp != null && hp < state.probe.hp - 1;
    if (reached || bled) {
      state.probe.at = tNow; // 有进展 → 重新计时
      state.probe.hp = hp;
      return;
    }
    // ⚠️ 别给「赶路中」加宽限（试过：40s + 赶路时长 + 30s → 16 局净胜从 12:2 掉到 4:11）。
    // 这套机器人赢在**灵活换目标**：啃不动就 40 秒换一个，把全图的厂一所抢下来；
    // 一旦允许它为一个目标死磕三四分钟，就等于把扩张窗口全送掉。
    if (tNow - state.probe.at > PROBE_MS) {
      if (!state.blocked) state.blocked = {};
      state.blocked[k] = tNow + PROBE_BLOCK_MS;
      state.probe = null;
      // 别把候选全拉黑了：黑到只剩一两个就整体清空，宁可回头再啃
      if (Object.keys(state.blocked).length >= 3) state.blocked = {};
    }
  } else {
    state.probe = { k, at: tNow, hp };
  }
}

/* ---------------- 多线分兵：前中期同时开几条战线 ---------------- */

/**
 * 前中期（develop / skirmish，且还没发动总攻）把部队按「离哪个目标近」拆成 2 股各打各的。
 *
 * 为什么必须分兵：**占领是靠把建筑血打光来易主的**（中立厂 2500 血 ≈ 10 个兵打 28 秒），
 * 单线推进 = 抢完一座再横穿半张图去下一座，开局最好的扩张窗口全浪费在路上。
 * 真人一定是两三个方向同时开。
 *
 * 只拆给「软目标」：守军不超过我全军的 1/3、彼此离得够远、且不碰总部（总部必须合兵）。
 * 任一股凑不够下限就整体不分 —— 添油比不拆更糟。
 *
 * @returns {null|Array<{target:object, units:Array}>}
 */
function pickProngs(game, oi, stance, state, units, tNow) {
  if (stance !== 'develop' && stance !== 'skirmish') return null;
  if (!units || units.length < 8) return null;
  const list = rankTargets(game, oi, stance, state, tNow);
  const myPow = powerOf(game, oi);
  const soft = [];
  for (const c of list) {
    if (soft.length >= 2) break;
    if (c.kind === 'h') continue; // 总部不合兵打不下来
    if (c.ref && c.ref.owner === oi) continue;
    if (enemyPowerNear(game, oi, c.x, c.y, 600) > myPow * 0.35) continue;
    if (soft.some((s) => dist(s.x, s.y, c.x, c.y) < 900)) continue; // 别在同一个点开两条线
    soft.push(c);
  }
  if (soft.length < 2) return null;

  const groups = soft.map(() => []);
  for (const u of units) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < soft.length; i++) {
      const d = dist(u.x, u.y, soft[i].x, soft[i].y);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    groups[bi].push(u);
  }
  const min = Math.max(3, Math.round(units.length / 4));
  if (groups.some((g) => g.length < min)) return null;
  return soft.map((c, i) => ({ target: c, units: groups[i] }));
}

/* ---------------- 集结：先聚兵，再压上去 ---------------- */

// ⚠️ 45 → 70 实测净提升（强度分 10076 → 10975）：「够狠」这条线划得太严，
// 就等于永远在等一支理想中的大军；放宽后总攻明显更坚决。
const KILL_SECONDS = 70; // 「多久能拆掉目标」的目标值：超过就继续攒兵
const HQ_BREAK_DPS = 220; // 全军 dps 过这条线就具备拆总部的资格（10000 血 ≈ 45 秒）
// ⚠️ 这两个数实测往「更早压上去」的方向调是净提升（16 局 15:1 → 16:0）：
// 中后局两军在半路顶牛时，**等**是纯亏的 —— 每一秒对面的产线都在吐兵，
// 而集结不满就一直不动，等于把时间白送给对面。宁可半路接战也要保持压迫。
const STAGE_R = 1200; // 集结点判定半径（离集结点这么近算「已到齐」）
const STAGE_OFF = 460; // 集结点在「最前建筑」朝目标方向的偏移量
const MASS_RATIO = 0.5; // 全军到齐这个比例就压上去（不再死等 dps 达标）
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
function strikeReady(game, oi, target, stage, posture) {
  const alive = unitsOf(game, oi);
  if (!target || !stage) return { ready: false, strike: [], haveDps: 0, need: 0 };
  const strike = alive.filter((u) => dist(u.x, u.y, stage.x, stage.y) <= STAGE_R);
  const haveDps = armyDps(strike);
  const need = needDps(game, oi, target);
  const minStrike = target.kind === 'h' ? 10 : target.kind === 'f' ? 5 : 3;
  // 屯不屯兵，跟着方向走（这也是真人会换的节奏）：
  //   收官 **屯**：一波定生死，凑不齐就别送，宁可多等十几秒；
  //   快攻 / 压制 **不屯**：要的是持续压迫，边打边补，等齐了反而把节奏让出去。
  // ⚠️ 收官这一档实测**不能往上调**（0.6 → 强度分 12934 → 12620）：
  // 一旦进 endgame 就会一直待在 finish（实测 seed=103 从第 450 秒起到结束都是它），
  // 屯兵门槛抬高 = 把总攻一拖再拖，而这套机器人的赢法偏偏是「早压、持续压」。
  const ratio =
    posture === 'finish' ? 0.5 : posture === 'harass' || posture === 'pressure' ? 0.4 : MASS_RATIO;
  const massed = strike.length >= Math.max(minStrike, Math.ceil(alive.length * ratio));
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

/* ---------------- 回防 / 换家：总部挨打时的选择题 ---------------- */

/**
 * ⚠️ 老版本的 raceCheck 只在「主攻目标**正好是敌总部**」时才做这道选择题。
 * 于是主力去打一座工厂、家里总部被端掉时，机器人压根不会回防 ——
 * 实测 seed=108 / 112 就是这么输的：己方总部 0、对方总部满血，一波带走。
 * 現在拆成两段：**只要总部挨打就先判回防**，再在「正在拆敌总部」时叠加换家三时间线。
 *
 * @returns {null|{action:'race'}|{action:'recall', x:number, y:number, power:number}}
 */
function homeDefense(game, oi, target, threats) {
  const hqT = threats.find((t) => t.building.kind === 'h');
  const hqB = myHq(game, oi);
  if (!hqT || !hqB) return null;

  let foeDps = 0;
  let foePow = 0;
  for (const u of game.units) {
    if (u.dead || u.ownerIdx === oi) continue;
    if (dist(u.x, u.y, hqB.x, hqB.y) > 1200) continue;
    foeDps += unitDps(u);
    foePow += unitScore(u);
  }
  // ⚠️ 不是「家门口有两个敌兵」就值得回救：对面只是路过 / 挠一下，我这边总部还能撑
  // 两分半以上，掉头回家就等于把已经推到对方门口的主力白白撤回来（来回一趟跨越整张图
  // 要 150 秒，来回拉扯会让整局永远打不完）。只有真的扛不住了才做这道选择题。
  if (foeDps < 20) return null;
  const tLose = hqB.hp / foeDps;
  if (tLose > 150) return null;

  // 正在拆敌总部 → 比三条时间线，能同时赢就继续推
  if (target && target.kind === 'h') {
    const foeHq = game.hqs.find((h) => h.id === target.id && !h.down);
    if (foeHq) {
      let myDps = 0;
      for (const u of game.units) {
        if (u.dead || u.ownerIdx !== oi) continue;
        if (dist(u.x, u.y, foeHq.x, foeHq.y) > 900) continue;
        myDps += unitDps(u);
      }
      if (myDps > 0.5) {
        const tWin = foeHq.hp / myDps;
        let tBack = Infinity;
        for (const u of game.units) {
          if (u.dead || u.ownerIdx !== foeHq.owner) continue;
          const t = dist(u.x, u.y, foeHq.x, foeHq.y) / Math.max(40, u.speed);
          if (t < tBack) tBack = t;
        }
        // 赢面要略大才值得换（避免 1% 险胜赌博），且要赶在敌回防前
        if (tWin < tLose * 0.92 && tWin < tBack * 0.95) return { action: 'race' };
      }
    }
  }
  return { action: 'recall', x: hqT.x, y: hqT.y, power: foePow };
}

/* ---------------- 科技（科技点 RP 开销） ---------------- */

/**
 * 产线进化：把某条产线的出厂阶数抬一阶 —— **此后这条线吐出来的兵永久更强**。
 * 1→2 阶约 +60% dps / +70% 血，2→3 阶再 +50%，是所有科技里唯一「一次付费、永久生效」
 * 的一笔（扩产线会被名额封顶，提速只影响节奏），所以排在最前。
 *
 * 挑选顺序：**当前阶数低的优先**（把 tier2 铺开比把一条线怼到 tier3 划算），
 * 同阶时挑等级高的厂（等级高的厂上限更高，后续还能继续升）。
 * ⚠️ 初级厂（level 1）无法进化，服务端会直接拒。
 */
function pickEvolve(facs) {
  let best = null;
  let bestKey = null;
  for (const f of facs) {
    if (f.level < 2 || (f.evoCd || 0) > 0) continue;
    const specs = f.specs || [];
    for (let li = 0; li < specs.length; li++) {
      const tier = specs[li].tier || 1;
      if (tier >= f.level) continue;
      const key = [tier, -f.level, -li];
      if (
        !best ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))
      ) {
        best = { cmd: 'facEvolve', fid: f.id, li };
        bestKey = key;
      }
    }
  }
  return best;
}

/**
 * 新产线产什么兵：**按目标配比补最缺的那一档**，而不是「随便补一种」。
 *
 * 为什么必须配比（实测 A/B：从「轰击为主」改成配比后，16 局净胜 13:2 → 15:1）：
 * 轰击 12 dmg / 2.5s cd = **4.8 dps**，是全兵种里最低的；它唯一的价值是 32 格射程能站在
 * 总部防卫圈（20 格）外攻城。可在「中立厂抢完、两军在半路顶牛」的中后局，
 * 攻城射程根本用不上 —— 拿一半的产能去造 4.8 dps 的兵，等于自断一臂。
 *
 * 三档各自的分工：
 *  - 盾卫 100 hp / 12 dps：唯一能顶在前排吃伤害的肉（射程 8 格，注定贴脸）；
 *  - 燎原 6 dmg / 0.4s cd = **15 dps**，而且是 5 格半径的**范围伤害**（打得到建筑、
 *    也能一次糊到挤成一团的一整队敌兵） —— 全场效率最高的输出兵；
 *  - 轰击 4.8 dps / 32 格：只留够攻城用的量。
 *
 * ⚠️ 判定写成「谁离目标配比最远就补谁」，而不是一串 if —— 后者会卡在某个阈值上反复横跳，
 * 造出来的兵种随战场损失剧烈摆动。
 */
const MIX_WANT = { shield: 0.35, burn: 0.3, burst: 0.3 };

function pickLineType(game, oi) {
  const cnt = {};
  for (const u of game.units) {
    if (u.dead || u.ownerIdx !== oi) continue;
    cnt[u.type] = (cnt[u.type] || 0) + 1;
  }
  const total = Object.keys(cnt).reduce((a, k) => a + cnt[k], 0) || 1;
  let best = 'shield';
  let worst = Infinity;
  for (const k in MIX_WANT) {
    const have = (cnt[k] || 0) / total / MIX_WANT[k];
    if (have < worst) {
      worst = have;
      best = k;
    }
  }
  return best;
}

/**
 * 一条指令或 null。
 *
 * **科技点怎么花，跟着战略方向走** —— 这是真人和死板 bot 最大的区别之一：
 * 同样的 300 点，「再开一条产线」和「把这条线升到二阶」在不同局势下价值完全相反。
 *   boom     **发育**：铺产线 → 升质量 → 提速（产能优先，把兵力上限先顶上去）
 *   harass   **快攻**：铺产线 → **早期提速** → 升质量 —— 要的是「兵尽快出门去骚扰」，
 *            进化这种一次付费永久生效的可以往后排
 *   pressure **压制**：先升质量 → 再铺线（产能已经够了，要的是每个兵更能打）
 *   finish   **一波**：只买立刻变强的（进化 / 提速），不再往产能上砸钱
 *   turtle   **逆风**：先提速（赶紧把兵补回来）→ 再谈质量
 *
 * ① 研究所产线（200）在所有方向里都排第一：它最便宜，而且让**后续所有**科技点 +50%。
 *   ⚠️ 唯一例外是 finish —— 都准备一波带走了，别再为 50% 的利息耽误正事。
 * ② 扩产线（300）：名额 = 每条线 10 兵，线越多兵力上限越高；到 TOTAL_LINE_CAP 就停手。
 *   ⚠️ 「铺线 vs 进化谁先」是 A/B 打出来的：进化只抬高**一条线**的 10 个名额，
 *   开线则多给 10 个名额 + 一条独立的产出流水线。前期数量压倒质量。
 * ③ 进化（300）：一次付费永久生效，全场最划算的一笔（早先排最后 → 整局没升过一阶）。
 * ④ 提速（300）：全局乘区，越早买越划算，没有上限（PROD_SPEED_MAX=20）。
 */
// ⚠️「进化优先」在 A/B 里是输的（8 局 3:5 vs 扩线优先 5:3），所以**只有 harass 方向**
// 敢在铺线之后插一笔早期提速；其余方向一律保持「铺线 → 进化 → 提速」这条实测出来的顺序。
const TECH_PLAN = {
  boom: ['line', 'evolve', 'speed'],
  harass: ['line', 'speed5', 'evolve', 'speed'],
  pressure: ['line', 'evolve', 'speed'],
  finish: ['line', 'evolve', 'speed'],
  turtle: ['line', 'evolve', 'speed'],
};

function pickTech(game, oi, stance, posture) {
  const me = game.players[oi];
  if (!me || me.rp == null) return null;
  const rp = me.rp;
  const hq = myHq(game, oi);
  if (!hq) return null;
  const myFacs = myFactories(game, oi);
  const myLs = myLabs(game, oi);

  const COST_LINE = 300;
  const COST_SPD = 300;
  const COST_LAB = 200;
  const TOTAL_LINE_CAP = 10; // 全场产线（含总部）到这个数就不再扩，钱转投质量

  // ① 研究所产线：最便宜、且让后续所有科技点提速 50%
  //    （试过收官阶段不买 → 强度分掉，别自作聪明：一波推不掉时还得靠后续科技续命）
  if (rp >= COST_LAB) {
    const l0 = myLs.find((l) => (l.lines || 0) < 1);
    if (l0) return { cmd: 'labLine', lid: l0.id };
  }
  const totalLines = myFacs.reduce((a, f) => a + (f.lines || 1), 0) + (hq.lines || 1);
  const spdCap = stance === 'desperate' ? 12 : 10;
  const plan = TECH_PLAN[posture] || TECH_PLAN.boom;
  for (const step of plan) {
    if (step === 'line') {
      if (rp >= COST_LINE && totalLines < TOTAL_LINE_CAP) {
        if ((hq.lines || 1) < 2) return { cmd: 'facLine', fid: 0, type: pickLineType(game, oi) };
        const f0 = myFacs.find((f) => (f.lines || 1) < 2);
        if (f0) return { cmd: 'facLine', fid: f0.id, type: pickLineType(game, oi) };
      }
    } else if (step === 'evolve') {
      if (rp >= COST_LINE) {
        const e = pickEvolve(myFacs);
        if (e) return e;
      }
    } else if (step === 'speed5') {
      if (rp >= COST_SPD && (hq.speedLv || 0) < 5) return { cmd: 'prodSpeed' };
    } else if (step === 'speed') {
      if (rp >= COST_SPD && (hq.speedLv || 0) < spdCap) return { cmd: 'prodSpeed' };
    }
  }
  // 都没得买：继续扩线 / 提速，别把 rp 攒着发霉
  if (rp >= COST_LINE) {
    const f0 = myFacs.find((f) => (f.lines || 1) < 2);
    if (f0) return { cmd: 'facLine', fid: f0.id, type: pickLineType(game, oi) };
  }
  if (rp >= COST_SPD && (hq.speedLv || 0) < 20) return { cmd: 'prodSpeed' };
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
function assignRallies(game, oi, stance, target, stage, committed, state, limit) {
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
  } else if (stage && target) {
    // 集结点指哪儿，取决于这个目标**需不需要合兵**：
    //  - 敌方建筑（owner >= 0，尤其总部）：必须聚够了再上，新兵先到前压集结点会合；
    //  - 中立建筑：没人守，让新兵直接流过去帮忙打 —— 2500 血的中立厂，
    //    靠开局那 6 个兵（约 54 dps）要磨 46 秒，补充兵再堵在家里就是白白拖死扩张窗口
    //    （实测 seed=112 就是这么被对手抢光工厂、一路压着打到输的）。
    const massing = target.ref && target.ref.owner >= 0;
    if (massing) {
      rx = stage.x;
      ry = stage.y;
      tag = 'stg:' + targetKey(target) + ':' + Math.round(stage.x / 200) + ',' + Math.round(stage.y / 200);
    } else {
      rx = target.x;
      ry = target.y;
      tag = 'atk:' + targetKey(target);
    }
  } else if (hq) {
    rx = hq.x;
    ry = hq.y;
    tag = 'home';
  }
  if (rx == null) return cmds;

  const cap = limit == null ? myBs.length : Math.max(0, limit);
  let sent = 0;
  for (const b of myBs) {
    if (sent >= cap) break;
    const key = tag;
    if (state.rallies[b.key] === key) continue; // 没变，不重发
    state.rallies[b.key] = key;
    sent += 1;
    cmds.push({ cmd: 'rally', fid: b.fid, x: Math.round(rx), y: Math.round(ry) });
  }
  return cmds;
}

/* ---------------- 部队分组与调度 ---------------- */

/**
 * ⚠️ 全场最容易踩、也最致命的一处机制差异（实测）：
 * **`attack` 命令 = 手动锁定（u.manualTarget），它会完全顶掉自动索敌** ——
 * 部队眼里只剩那个目标，一路走过去，途中的敌人一个都不还手。
 * 于是「全军 attack 敌总部」= 让整支部队排着队挨枪子儿走完全程，
 * 这也是老版本「兵不少但总部血就是掉不动」的真正原因。
 *
 * 所以 **建筑目标一律只下 `move`**（`findTarget` 在射程内会自己打建筑，
 * 而且优先打射程内的敌兵 —— 边走边还手全靠这条）。
 *
 * ⚠️⚠️ 不要给建筑混发 `attack`：两者的**寻路落点不是同一个点**（实测 seed=112 整局死锁）：
 *   - `move`   → 服务器 `snapOutsideBuildings` 把落点推到建筑外缘 82px（本例 (1954,7529)），
 *                这点在**高地台地**上，与部队同侧，流场直着走 19 格就能到；
 *   - `attack` → 目标恒为**建筑中心**（本例 (1918,7456)），而中心在**崖下的低地**，
 *                流场必须绕 29 格外的坡口，第一步是往**反方向**走的。
 * 两个落点一动一静、方向相反，而 `SIEGE_R` 的判定半径又正好压在部队所处的 461~533px
 * 之间 —— 于是 0.7 秒一次的思考把同一批兵在 move / attack 之间反复横跳，
 * 净位移为零，19 个兵对着一座 2500 血中立厂磨满整局。
 *
 * 单位目标（追杀）才用 `attack`：`move` 到单位身上没有意义（目标一直在动）。
 */
/**
 * 拆总部时的站位：**够得着就站在防卫圈外打**。
 *
 * 总部自带防卫：200px 射程、20 dmg / 0.5s = 40 dps 单点火力。一支 30 人的部队贴脸拆
 * 10000 血（≈45 秒）要躺掉二十来个兵 —— 而 180 射程的兵（锐士 / 游侠 / 激光）
 * 最远能在 `HQ_R + range = 225px` 处开火，比防卫射程远 25px。
 * 站在这个「甜甜圈缝」里 = 白嫖总部，这是真人一定会用的手法。
 * 只有射程不够的（盾卫 80 / 燎原 150）才必须顶进去挨打。
 */
function siegeRing(target, group) {
  let sx = 0;
  let sy = 0;
  for (const u of group) {
    sx += u.x;
    sy += u.y;
  }
  let minReach = Infinity;
  for (const u of group) minReach = Math.min(minReach, (u.range || 0) + HQ_R_PX + 5);
  const r = Math.min(HQ_DEF_R_PX + 12, minReach);
  let ax = sx / group.length - target.x;
  let ay = sy / group.length - target.y;
  const d = Math.hypot(ax, ay) || 1;
  return { x: target.x + (ax / d) * r, y: target.y + (ay / d) * r };
}

function splitMarch(target, units, cmds) {
  const ids = units.map((u) => u.id);
  if (!ids.length) return cmds;
  if (target.kind === 'u') {
    cmds.push({ cmd: 'attack', kind: 'u', id: target.id, ids });
    return cmds;
  }
  if (target.kind === 'h') {
    const out = [];
    const inn = [];
    for (const u of units) {
      ((u.range || 0) + HQ_R_PX + 8 >= HQ_DEF_R_PX + 12 ? out : inn).push(u);
    }
    // 人太少就别玩站位了：零星几个兵站外圈既打不动也挡不住，直接压上去
    if (out.length >= 6) {
      const p = siegeRing(target, out);
      cmds.push({ cmd: 'move', x: Math.round(p.x), y: Math.round(p.y), ids: out.map((u) => u.id) });
      if (inn.length) {
        cmds.push({ cmd: 'move', x: Math.round(target.x), y: Math.round(target.y), ids: inn.map((u) => u.id) });
      }
      return cmds;
    }
  }
  cmds.push({ cmd: 'move', x: Math.round(target.x), y: Math.round(target.y), ids });
  return cmds;
}

/**
 * 守军比例：develop 0 / skirmish 0.1 / endgame 0.06 / desperate 0.8
 * （无威胁时几乎不留守：总部自带防卫，兵力压上去才有输出。）
 *
 * 调度优先级：
 *   ① 回防 / 换家判决（homeDefense）
 *   ② 未集结完成 → 前中期分兵多线扩张，否则机动部队去集结（守军照常护家）
 *   ③ 已集结    → 机动部队扑向主目标
 */
function assignUnits(game, oi, stance, target, threats, def, stage, committed, state, tNow, posture) {
  const cmds = [];
  const hq = myHq(game, oi);
  if (!hq) return cmds;

  let alive = unitsOf(game, oi);
  if (!alive.length) return cmds;

  // —— ① 回防 / 换家判决优先 ——
  if (def) {
    if (def.action === 'race' && target && target.kind === 'h') {
      splitMarch(target, alive, cmds);
      return cmds;
    }
    if (def.action === 'recall') {
      // 只撤「够用」的那部分：全军掉头等于把前线白扔掉。
      // 按「离总部由近及远」挑，战力攒到来犯者的 1.4 倍就停 —— 剩下的继续原任务。
      const want = def.power * 1.4;
      const sorted = alive
        .slice()
        .sort((a, b) => dist(a.x, a.y, hq.x, hq.y) - dist(b.x, b.y, hq.x, hq.y));
      const back = [];
      let got = 0;
      for (const u of sorted) {
        back.push(u);
        got += unitScore(u);
        if (got >= want) break;
      }
      if (back.length) {
        cmds.push({
          cmd: 'move',
          x: Math.round(def.x),
          y: Math.round(def.y),
          ids: back.map((u) => u.id),
        });
        const backSet = new Set(back.map((u) => u.id));
        alive = alive.filter((u) => !backSet.has(u.id));
      }
      if (!alive.length) return cmds;
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
  let mobile = scored.slice(keep).map((s) => s.u);

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
    // 快攻干扰：先切出一小股去踢对面的厂 / 所（见 pickHarass），**主力照常发育 / 压制**
    let harass = null;
    if (!committed && target && posture === 'harass') {
      harass = pickHarass(game, oi, mobile, myPow);
      if (harass) {
        const hs = new Set(harass.units.map((u) => u.id));
        mobile = mobile.filter((u) => !hs.has(u.id));
        splitMarch(harass.target, harass.units, cmds);
      }
    }
    // 前中期还没发动总攻 → 分兵多线同时扩张（单线推进太慢，见 pickProngs）
    const prongs = !committed && target ? pickProngs(game, oi, stance, state, mobile, tNow) : null;
    if (prongs) {
      for (const g of prongs) splitMarch(g.target, g.units, cmds);
    } else if (!mobile.length) {
      // 兵全派去骚扰了，主体这轮不再下指令
    } else if (!target) {
      if (stage) cmds.push({ cmd: 'move', x: Math.round(stage.x), y: Math.round(stage.y), ids: mobile.map((u) => u.id) });
    } else if (committed) {
      // 全军扑向主目标：已到门口的强拆，还在赶路的边走边打（补充兵也由集结点直发战场）
      splitMarch(target, mobile, cmds);
    } else if (stage) {
      // 还没凑够人：先到前压集结点会合（移动途中照常自动索敌开火）
      cmds.push({ cmd: 'move', x: Math.round(stage.x), y: Math.round(stage.y), ids: mobile.map((u) => u.id) });
    } else {
      splitMarch(target, mobile, cmds);
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
  // 战略方向：真人会换打法，机器人也得会（发育 / 快攻干扰 / 压制 / 一波 / 收缩）
  const posture = pickPosture(game, oi, stance, state, tNow);
  // ⚠️ 僵持检测必须在重挑目标**之前**跑：它判的是「上一次挑的目标」啃没啃动，
  // 啃不动就拉黑，pickTarget 才能挑下一个。
  updateProbe(game, oi, state, tNow, state.committed != null, stance);
  const target = pickTarget(game, oi, stance, state, tNow);
  const threats = detectThreats(game, oi);
  const def = homeDefense(game, oi, target, threats);

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
      const sr = stage ? strikeReady(game, oi, target, stage, posture) : null;
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
  const tech = pickTech(game, oi, stance, posture);
  if (tech) cmds.push(tech);

  // 2) 集结点（每座建筑至多一条；未变则不发；一帧最多 2 条，别把部队指令挤掉。
  //    ⚠️ 只有真的发出去的那几条才记账，否则被截掉的建筑会永远不再补发。
  //    ⚠️ 快攻干扰要多一条部队指令，这一帧的集结点额度让给 1 条）
  cmds.push(...assignRallies(game, oi, stance, target, stage, committed, state, posture === 'harass' ? 1 : 2));

  // 3) 部队（守军 1 条 + 骚扰股 1 条 + 分兵 ≤ 2 组 × 2 条）
  cmds.push(
    ...assignUnits(game, oi, stance, target, threats, def, stage, committed, state, tNow, posture)
  );

  // 记状态，供下次粘性判断
  state.stance = stance;
  state.postureK = posture;
  state.target = target ? { kind: target.kind, id: target.id } : null;
  state.threat = threats.length ? { kind: threats[0].building.kind, id: threats[0].building.id } : null;

  // ⚠️ 截到 6 条是硬性的：限速是每秒 12 条、think 每 0.7 秒一次，
  // 超了会被 setPlayerInput 直接拒掉。优先级：科技 > 部队 > 集结点（下帧再补）。
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
    rankTargets,
    pickTarget,
    pickProngs,
    detectThreats,
    homeDefense,
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
