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

const WFData = require('./data.js');
const GRID_PX = WFData.grid.cell; // 与 index.js 同一个 GRID：所有「格」量都用它换算
const HQ_R_PX = (WFData.buildings.hqSize * GRID_PX) / 2; // 总部碰撞半径（45px）
const FAC_R_PX = (WFData.buildings.factorySize * GRID_PX) / 2; // 工厂碰撞半径（60px）
const LAB_R_PX = (WFData.buildings.labSize * GRID_PX) / 2; // 研究所碰撞半径（30px）
const HQ_DEF_R_PX = WFData.hqDefense.range * GRID_PX; // 总部防卫射程（300px）
const WORLD_PX = 11520; // 与 index.js 的 WORLD_W 同值（世界是正方形）

/* ---------------- 地形：能不能站 + 高不高（高地战术） ----------------
 * 高低差是**射程**也是**墙**：
 *   - 射程：effRange = 基础 + (我层 − 敌层) × 1 格（data.height.rangeCellsPerStep），
 *     台地档位 0 / ±2 / ±3，所以站在高台上打低处最多白捡 30~60px 射程；
 *   - 墙：相邻格层差 ≥ 2 就是崖（cliffAt），部队过不去，只能走坡口 —— 站上去就难被赶下来。
 * ⚠️⚠️ 踩过的坑（0:38 崩盘那次）：把集结点**挪到山体上去**了 —— 山体根本站不住人，
 * 部队永远到不了「集结点」，判定「人没到齐」就一直原地等。所以：
 *   **落点必须 standable（非山非水），而且不能为了爬高绕远路**（见 maxPush）。
 */
const TERR_CELL = 40;
const TT_MOUNTAIN = 2;
const TT_WATER = 4;

function terrCell(game, x, y) {
  const t = game && game.terrain;
  if (!t || !t.grid) return null;
  const c = Math.floor(x / TERR_CELL);
  const r = Math.floor(y / TERR_CELL);
  if (r < 0 || c < 0 || r >= (t.rows || 0) || c >= (t.cols || 0)) return null;
  const row = t.grid[r];
  if (!row) return null;
  const cols = t.cols || 0;
  return { v: row[c], h: t.heights ? t.heights[r * cols + c] || 0 : 0 };
}

/** 这一格站得住人吗（山 / 水都不行） */
function standable(game, x, y) {
  const c = terrCell(game, x, y);
  return Boolean(c) && c.v !== TT_MOUNTAIN && c.v !== TT_WATER;
}

function heightAt(game, x, y) {
  const c = terrCell(game, x, y);
  return c ? c.h : 0;
}

/**
 * 把落点微调到「附近站得住的更高处」：一圈采样，挑**层高最高**且站得住的点。
 *   - 只有真比原地高才挪（平层不动，免得部队无谓地来回蹭）；
 *   - 不能为了爬高绕远路：比原地离目标远超过 maxPush 就不要；
 *   - 采样点全部要求 standable —— 山体 / 水域一律不要（血的教训）。
 */
function highGround(game, x, y, tx, ty, rads, maxPush) {
  if (!standable(game, x, y)) return { x, y };
  const base = heightAt(game, x, y);
  const d0 = dist(x, y, tx, ty);
  let bx = x;
  let by = y;
  let best = null;
  for (const rad of rads) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const nx = x + Math.cos(a) * rad;
      const ny = y + Math.sin(a) * rad;
      if (nx < 200 || ny < 200 || nx > WORLD_PX - 200 || ny > WORLD_PX - 200) continue;
      if (!standable(game, nx, ny)) continue;
      const d = dist(nx, ny, tx, ty);
      if (d > d0 + maxPush) continue;
      const score = heightAt(game, nx, ny) * 100 - Math.max(0, d - d0) * 0.3;
      if (best === null || score > best) {
        best = score;
        bx = nx;
        by = ny;
      }
    }
  }
  return heightAt(game, bx, by) > base ? { x: bx, y: by } : { x, y };
}

// 残血兵后撤（A/B 自对弈实测：净胜 13:11、强度分 +2569）
const RETREAT_HP = 0.35; // 血量低于这个比例才撤
const RETREAT_NEAR = 420; // 而且得有敌兵贴到这么近才撤（没人打你就别乱跑）
const RETREAT_D = 520; // 后撤距离：够退出一轮交火，又不至于跑出自己的射程

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/** 单位每秒伤害（dps）。激光兵基础 dmg 极低，蓄能倍率高，这里给个保守当量 */
function unitDps(u) {
  const base = u.dmg / Math.max(0.2, u.cdMax);
  // 激光满蓄能是 **10 倍**（`data.laser.maxMul`）：1 阶 50 dps、3 阶 100 dps，纸面最高。
  // ⚠️ 但 `rampMs` 是「+1 倍的周期」不是「爬满用时」：咬满要 (maxMul−1)×rampMs，
  //    现值 1.2s × 9 = **10.8 秒**。打部队时目标一死就换锁、倍率归零重走 500ms 前摇，
  //    连零头都吃不到；只有拆建筑 / 打大血单体（总部不动）才真吃满。
  // 折当取 **×8**：不算满（打部队时略高估），也不至于把它当 5 dps 看没（拆建筑时低估）。
  // 2026-10-07 A/B：降到 ×4 两批种子反号（−579 / +624），属噪声 → **维持 ×8**。
  return u.laser ? base * 8 : base;
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
 *
 * ⚠️⚠️ 实测（seed=103 整局插桩）：**99 次进入 harass 判定、0 次真正派出** ——
 * 中期 `n` 只有 4~5 人（40~50 dps），70 秒只能打出 2800~3500，够不着工厂的 5000 血，判据恒假。
 * 别再靠「降低 HARASS_MIN_UNITS」激活它：改成 7/4 后实测结果与未改动**逐位相同**。
 * 也别放开判据 / 放大股：35%·14 人 → 11890，kb −1590、kh1 −975、kh2 −709，全是负的。
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

/** 我方存活部队的重心；没兵时退回 null（开局亲兵刚死光等极端情况） */
function armyCentroid(game, oi) {
  const us = unitsOf(game, oi);
  if (!us.length) return null;
  let x = 0;
  let y = 0;
  for (const u of us) {
    x += u.x;
    y += u.y;
  }
  return { x: x / us.length, y: y / us.length, n: us.length };
}

/**
 * 价值基础分：敌总部 > 敌工厂 > 中立工厂 > 敌研究所 > 中立研究所。
 * 再按「到手时间 reach」「守军强度」「血量」「粘性」「贴身」修正。
 *
 * ⚠️ 距离必须按**兵力重心**算，不能按总部：兵已经站在远处厂门口时，
 *    用总部距离会把它们拽去打「离总部近」的另一座 —— 还没走到，那座就被人占了，
 *    再折回打脚下那座，整段路白走（用户实测的舍近求远）。
 *
 * ⚠️ 分数 ≈ 价值 × 可达性：可达性 = f(行军 + 拆楼)。高价值但特别远会被压低，
 *    近处易拿的优先 —— 扩张效率看的是「单位时间拿到多少」，不是纸面价值榜。
 *
 * @returns {Array} 按分数降序的候选列表（pickTarget 取第 0 个，pickProngs 拿前几个分兵）
 */
function rankTargets(game, oi, stance, state, tNow) {
  const hq = myHq(game, oi);
  const me = game.players[oi];
  const hx = hq ? hq.x : me.baseX || 0;
  const hy = hq ? hq.y : me.baseY || 0;
  const army = armyCentroid(game, oi);
  const ax = army ? army.x : hx;
  const ay = army ? army.y : hy;
  const myPow = powerOf(game, oi);
  const alive = army ? unitsOf(game, oi) : [];
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
    // 工厂分等级：只有 lv≥2 能进化。lv3 吸引力翻倍，别把兵力耗在永远 1 阶的厂上。
    const lv = f.level || 1;
    const lvMul = lv >= 3 ? 2 : lv >= 2 ? 1.35 : 1;
    cands.push({
      kind: 'f',
      id: f.id,
      x: f.x,
      y: f.y,
      w: (f.owner === -1 ? wFacN : wFacE) * lvMul,
      ref: f,
    });
  }
  for (const l of game.labs) {
    if (l.owner === oi) continue;
    cands.push({ kind: 'l', id: l.id, x: l.x, y: l.y, w: l.owner === -1 ? wLabN : wLabE, ref: l });
  }

  // 到手时间用的行军速度 / 拆楼 dps（与分兵评估同口径）
  const marchSpd = 55;
  const myDps = Math.max(6, armyDps(alive));

  for (const c of cands) {
    const dArmy = dist(ax, ay, c.x, c.y);
    const dHq = dist(hx, hy, c.x, c.y);
    // 路程看兵在哪（主力）；总部距离只留一点「门口安全扩张」偏向。
    // 前中期几乎全听兵力；打敌总部时总部距离略加重（别为了近厂永远不去推家）。
    let d;
    if (c.kind === 'h') d = 0.65 * dArmy + 0.35 * dHq;
    else if (stance === 'develop' || stance === 'skirmish') d = 0.9 * dArmy + 0.1 * dHq;
    else d = 0.8 * dArmy + 0.2 * dHq;

    // 守军折扣：目标周围 700 内敌军比我全军还强 → 不去送
    const guard = enemyPowerNear(game, oi, c.x, c.y, 700);
    let mul = 1;
    if (guard > myPow * 0.9) mul = 0.15;
    else if (guard > myPow * 0.6) mul = 0.5;
    // 血量折扣：建筑血越残越容易被我拿下（中立厂 1/2 血最香）
    const hp = c.ref.hp != null ? c.ref.hp : c.kind === 'h' ? 10000 : 3000;
    const hpRatio = c.ref.hpMax ? hp / c.ref.hpMax : 1;
    // ⚠️ 0.4 → 0.8 → 1.2 → 1.6 是逐档实测出来的（24 局强度分 10076 → 11501 → 12491 → 12934）：
    // 「快打完了」本身就是最强的吸引力 —— 再补一刀就能变成自己的产能，
    // 而去啃一座满血的新目标要从头再来。真人一定先收残血。
    const hpMul = 1 + (1 - hpRatio) * 1.6;
    // 粘性：正在打的目标给个大加成，避免来回横跳（打到一半换目标 = 两边都打不下来）
    const sticky =
      state && state.target && state.target.kind === c.kind && state.target.id === c.id ? 1.6 : 1;
    // 兵已经贴着 / 围着的目标：强烈加分 —— 这就是「脚下的厂」，别为了总部附近那座空跑
    let nearMul = 1;
    if (alive.length) {
      let near = 0;
      for (const u of alive) {
        if (dist(u.x, u.y, c.x, c.y) <= 900) near += 1;
      }
      if (near >= 3) nearMul = 1.75;
      else if (near >= 2) nearMul = 1.5;
      else if (near >= 1) nearMul = 1.25;
    }

    // —— 可达性：价值要除以「到手要多久」——
    //   eta ≈ 行军 + 拆楼。高价值但特别远 → eta 大 → 分数被压下去，
    //   近处易拿的反而更好（扩张窗口花在路上就是纯亏）。
    //   总部拆得久，参考时长远一点，免得中后局永远不敢推家。
    const eta = d / marchSpd + hp / myDps;
    const etaRef = c.kind === 'h' ? (stance === 'endgame' ? 100 : 140) : 45;
    // 指数 >1：特别远时跌得更狠；eta = etaRef 时约半价
    const reach = 1 / (1 + Math.pow(eta / etaRef, 1.35));
    c.score = c.w * reach * mul * hpMul * sticky * nearMul;
    c.eta = eta; // 调试 / 分兵评估可复用
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

const MARCH_SPD = 55; // 与 think 里赶路宽限同口径（px/s）
const PRONG_SEP = 1200; // 两条线的目标至少隔这么远，否则就是同一场仗
const PRONG_MAX_ETA = 200; // 这一股预计超过这么久还拿不下来 → 这条线不值得开
const PRONG_STICK_MS = 22000; // 分兵目标粘性：半路改道比分错一次更亏

function buildingHp(target) {
  return target && target.ref && target.ref.hp != null ? target.ref.hp : 3000;
}

/**
 * 一股兵拆掉这座建筑要多久：按「谁先走到谁先开火」积分，不是全员到齐再打。
 * 全军叠在出生点时，这就是「行军 + 拆楼」；已经有人围着打时，eta 会明显短于后到的人。
 */
function captureEta(units, target) {
  if (!units || !units.length || !target) return Infinity;
  const arrivals = units
    .map((u) => ({
      t: dist(u.x, u.y, target.x, target.y) / MARCH_SPD,
      dps: unitDps(u),
    }))
    .sort((a, b) => a.t - b.t);
  let dps = 0;
  let left = buildingHp(target);
  let t = 0;
  for (const a of arrivals) {
    const dt = a.t - t;
    if (dps > 0.4) {
      const dealt = dps * dt;
      if (dealt >= left) return t + left / dps;
      left -= dealt;
    }
    t = a.t;
    dps += a.dps;
  }
  if (dps < 0.4) return Infinity;
  return t + left / dps;
}

/** 全军串行：拿完一座，人从那座走到下一座再拆（扩张窗口浪费在路上的那条对照基线） */
function sequentialEta(units, targets) {
  if (!units || !units.length || !targets.length) return { makespan: Infinity, first: Infinity, times: [] };
  let cx = 0;
  let cy = 0;
  for (const u of units) {
    cx += u.x;
    cy += u.y;
  }
  cx /= units.length;
  cy /= units.length;
  const dps = Math.max(0.4, armyDps(units));
  let t = 0;
  const left = targets.slice();
  const finish = [];
  while (left.length) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = dist(cx, cy, left[i].x, left[i].y);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    const c = left.splice(bi, 1)[0];
    t += bd / MARCH_SPD + buildingHp(c) / dps;
    finish.push(t);
    cx = c.x;
    cy = c.y;
  }
  return { makespan: t, first: finish[0], times: finish };
}

/**
 * 按目标价值配额分兵，而不是「每人就近」。
 *
 * ⚠️ 开局 6 个亲兵几乎叠在同一格：就近分配时距离全相等（或只差几十 px），
 * `d < bd` 会把整队倒进列表里的第一座建筑，第二路 0 人 → 旧 pickProngs 直接放弃。
 * 人就这么一坨出去，拿完高价值再横穿半张图 —— 正是用户看到的问题。
 */
function assignProngUnits(units, targets) {
  const n = units.length;
  const totalScore = targets.reduce((a, t) => a + Math.max(0.1, t.score), 0);
  const cap = targets.map((t) =>
    Math.max(3, Math.round((n * Math.max(0.1, t.score)) / totalScore))
  );
  let capSum = cap.reduce((a, b) => a + b, 0);
  // 配额加总要对上人数：多的补给价值最高的，少的从价值最低的往下砍（不低于 3）
  while (capSum < n) {
    cap[0] += 1;
    capSum += 1;
  }
  while (capSum > n) {
    let cut = -1;
    for (let i = cap.length - 1; i >= 0; i--) {
      if (cap[i] > 3) {
        cut = i;
        break;
      }
    }
    if (cut < 0) break;
    cap[cut] -= 1;
    capSum -= 1;
  }

  const groups = targets.map((target) => ({ target, units: [] }));
  // 对某一路明显更近的兵先分配，叠在一起、没有偏好的兵按配额填
  const ordered = units.slice().sort((a, b) => {
    const spread = (u) => {
      let lo = Infinity;
      let hi = 0;
      for (const t of targets) {
        const d = dist(u.x, u.y, t.x, t.y);
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
      return hi - lo;
    };
    return spread(b) - spread(a);
  });
  for (const u of ordered) {
    let bi = -1;
    let bd = Infinity;
    for (let i = 0; i < targets.length; i++) {
      if (groups[i].units.length >= cap[i]) continue;
      const d = dist(u.x, u.y, targets[i].x, targets[i].y);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi < 0) {
      for (let i = 0; i < targets.length; i++) {
        const d = dist(u.x, u.y, targets[i].x, targets[i].y);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
    }
    groups[Math.max(0, bi)].units.push(u);
  }
  return groups;
}

function prongMakespan(groups) {
  let m = 0;
  const times = [];
  for (const g of groups) {
    const e = captureEta(g.units, g.target);
    times.push(e);
    if (e > m) m = e;
  }
  return { makespan: m, first: Math.min.apply(null, times), times };
}

/**
 * 前中期把部队拆成至多 2 股，并行去占两座软目标。
 *
 * 分不分，看三条时间线，不是看「第二名高价值在不在列表里」：
 *   串行 makespan = 全军拿 A 再走到 B 再拿 B；
 *   并行 makespan = 两股各自拆完的较晚者；
 *   主目标延误 = 分兵后 A 的 eta / 全军先打 A 的 eta。
 * 并行能更早拿下「两座都到手」，且主目标不会被抽空拖成添油，才拆。
 *
 * 总部永远不合兵打不下来，这里直接跳过。
 *
 * @returns {null|Array<{target:object, units:Array}>}
 */
function pickProngs(game, oi, stance, state, units, tNow) {
  if (stance !== 'develop' && stance !== 'skirmish') {
    if (state) state.prongKeys = null;
    return null;
  }
  if (!units || units.length < 6) {
    if (state) state.prongKeys = null;
    return null;
  }
  const list = rankTargets(game, oi, stance, state, tNow);
  const myPow = powerOf(game, oi);
  const soft = [];
  for (const c of list) {
    if (soft.length >= 5) break;
    if (c.kind === 'h') continue;
    if (c.ref && c.ref.owner === oi) continue;
    if (enemyPowerNear(game, oi, c.x, c.y, 600) > myPow * 0.35) continue;
    if (soft.some((s) => dist(s.x, s.y, c.x, c.y) < PRONG_SEP)) continue;
    soft.push(c);
  }
  if (soft.length < 2) {
    if (state) state.prongKeys = null;
    return null;
  }

  const minN = Math.max(3, Math.round(units.length / 4));
  let ax = 0;
  let ay = 0;
  for (const u of units) {
    ax += u.x;
    ay += u.y;
  }
  ax /= units.length;
  ay /= units.length;
  const scorePair = (targets) => {
    if (dist(targets[0].x, targets[0].y, targets[1].x, targets[1].y) < PRONG_SEP) return null;
    // 从部队重心看，两座目标几乎在同一条射线上、一前一后 → 就是顺路。
    // 分兵会让后队路过前一座却不帮忙，串行「拿完近的接着推」更快。
    {
      const vx0 = targets[0].x - ax;
      const vy0 = targets[0].y - ay;
      const vx1 = targets[1].x - ax;
      const vy1 = targets[1].y - ay;
      const l0 = Math.hypot(vx0, vy0) || 1;
      const l1 = Math.hypot(vx1, vy1) || 1;
      const cos = (vx0 * vx1 + vy0 * vy1) / (l0 * l1);
      if (cos > 0.7 && Math.abs(l0 - l1) > 350) return null;
    }
    const groups = assignProngUnits(units, targets);
    if (groups.some((g) => g.units.length < minN)) return null;
    const par = prongMakespan(groups);
    if (par.times.some((e) => !Number.isFinite(e) || e > PRONG_MAX_ETA)) return null;
    const seq = sequentialEta(units, targets);
    // 主目标取价值更高的那座（不是地理更近的那座）
    const primary = targets[0].score >= targets[1].score ? targets[0] : targets[1];
    const tAllFirst = captureEta(units, primary);
    const gPri = groups.find((g) => g.target === primary) || groups[0];
    const tParFirst = captureEta(gPri.units, primary);
    const delay = tParFirst / Math.max(1, tAllFirst);
    // 并行拿下两座要明显快于串行；主目标最多拖到 1.7 倍（抽太多就变成两路都啃不动）
    if (!(par.makespan * 1.06 < seq.makespan && delay <= 1.7)) return null;
    return { groups, gain: seq.makespan / Math.max(1, par.makespan), delay };
  };

  let best = null;
  // 粘性：上一轮那对目标还在软列表里，优先沿用（避免 0.7s 一思考就改道）
  if (state && Array.isArray(state.prongKeys) && tNow - (state.prongAt || 0) < PRONG_STICK_MS) {
    const kept = [];
    for (const k of state.prongKeys) {
      const c = soft.find((s) => targetKey(s) === k);
      if (c) kept.push(c);
    }
    if (kept.length >= 2) best = scorePair(kept.slice(0, 2));
  }
  if (!best) {
    for (let i = 0; i < soft.length; i++) {
      for (let j = i + 1; j < soft.length; j++) {
        const pair = [soft[i], soft[j]];
        // 价值高的放前面，配额才会把略多的兵留给主目标
        if (pair[1].score > pair[0].score) pair.reverse();
        const got = scorePair(pair);
        if (got && (!best || got.gain > best.gain)) best = got;
      }
    }
  }
  if (!best) {
    if (state) state.prongKeys = null;
    return null;
  }
  if (state) {
    state.prongKeys = best.groups.map((g) => targetKey(g.target));
    state.prongAt = tNow;
  }
  return best.groups;
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
  // 站高一点：射程随层差 +1 格/层，站在高台上打洼地里的敌人是白捡的射程。
  // 只挪 120~240px、且不许比原地离目标远 150px 以上（绕远路去爬高不划算）。
  return highGround(game, best.x + ux * off, best.y + uy * off, target.x, target.y, [120, 240], 150);
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
/**
 * 造兵配比 —— **按职能、分局势**（见下方 MIX_FIELD / MIX_SIEGE）。
 *
 * ⚠️ 兵种不是「换个数值」而已，各有职能，配比必须跟着打法走：
 *   盾卫  前排肉盾·突脸：血最厚(100→300)、移速最快(95)，但射程只有 80~110
 *   燎原  前排 AOE·清群：50px 火舌一次打到**所有**敌人，2 阶起还留火场（敌我通吃）
 *   锐士  通用主力：射程 180~240、hitscan，没有短板也没有特长
 *   游侠  后排狙击：单发 31→62.5（一口吃掉脆皮），但 cd 3 秒 → dps 全场倒数
 *   激光  拆建筑 / 打大血单体：满蓄能 37.5→75 dps，但**换目标要重走 1.3 秒蓄能**
 *   轰击  超远程攻城 + 守家：射程 260~290~320 全场最远，带 40px 溅射，dps 却只有 7.2~14.4
 *
 * ⚠️⚠️ 结论全部来自 `scripts/warfactory-matchup.js`（按服务端规则建模，含弹速飞行 /
 * 激光蓄能 / 范围伤害 / 火场 / 卡距离拉扯 / 单位互推，**逐个跑了 1·3·5·7·10 规模**）：
 *   ① **规模会翻转结论** —— 燎原 1v1 输锐士，3v3 起碾压；激光 1v1 能赢，5v5 起全输。
 *      所以配比不能按 1v1 定，得按实战规模（5~10 个一团）定。
 *   ② **燎原是野战之王**（10v10 对五兵种平均净胜 +58）：一口火平均命中 2.3~5 个，
 *      而且服务端 separateUnits 会天然把双方挤成一坨，越抱团它越赚。
 *   ③ **轰击是唯一能在总部防卫圈（300px）外开火的兵** —— 判据 `射程 + 总部半径45 > 300`：
 *      只有轰击（305 / 335 / 365）够得着；1 阶只多 5px，实战要到 2 阶才算真安全。
 *      它同时也是**守家最强**（射程最长，敌人还在路上就开始挨炸）。
 *   ④ **激光已经不是「1v1 通吃」了**（倍率 25→20、基础伤害 ×3/4）：打小兵群目标不断死、
 *      不断重蓄，实际连满蓄能一半都吃不到；它现在的活是**拆建筑 / 打大血单体**
 *      （推演里 10 个三阶激光拆工厂 13 秒，全场最快）。
 *   ⑤ **前排价值可量化**：激光×5 打锐士×5 是 −20；换成 激光×3 + 盾卫×2 立刻变成 +24。
 *      没有前排顶着的后排 = 送。
 *   ⑥ 游侠现在最弱（dps 倒数 + 45 血），只在攻城配比里留一点。
 */
// 野战（抢厂 / 拉锯 / 反偷袭）：燎原清群 + 盾卫顶前排，轰击在后排补远程输出
const MIX_FIELD = { burn: 0.35, shield: 0.3, burst: 0.2, warrior: 0.15 };
// 攻城（拆总部 / 拆建筑）：总部防卫圈已经涨到 300px，**除了轰击谁都得进去挨 40dps** ——
// 所以攻城阵容 = 轰击（唯一能站圈外白嫖）+ 盾卫（顶防卫火力）+ 激光（拆得最快）+ 少量燎原。
// 拆总部（10000 血 / 300px 防卫 40dps）—— 攻城推演 3 阶 ×20 的耗时排序：
//   激光 15s < 锐士 29s ≈ 燎原 30s < 游侠 34s < 盾卫 36s < **轰击 60s（最慢）**
// ⚠️ 所以攻城配比里**轰击要降到 0**（它守家是神、攻城是坑：dps 7.2~14.4 全场最低，
//   光靠「站圈外白嫖」省下的那点战损补不回翻倍的拆城时间）。
// 取而代之：激光最高（满蓄能 37.5~75 dps 最快）+ 盾卫顶前排吸 40dps + 燎原清守军。
// A/B 净效应（vs 各自冻结基线）：种子 100 **+2445**、种子 200 **+1073**（两批同号才敢落地）。
const MIX_SIEGE = { laser: 0.35, shield: 0.25, burn: 0.25, warrior: 0.15 };
const MIX_WANT = MIX_FIELD;

function pickLineType(game, oi, siege) {
  const MIX = siege ? MIX_SIEGE : MIX_FIELD;
  const cnt = {};
  for (const u of game.units) {
    if (u.dead || u.ownerIdx !== oi) continue;
    cnt[u.type] = (cnt[u.type] || 0) + 1;
  }
  const total = Object.keys(cnt).reduce((a, k) => a + cnt[k], 0) || 1;
  let best = 'shield';
  let worst = Infinity;
  for (const k in MIX) {
    const have = (cnt[k] || 0) / total / MIX[k];
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
        if ((hq.lines || 1) < 2) return { cmd: 'facLine', fid: 0, type: pickLineType(game, oi, stance === 'endgame') };
        const f0 = myFacs.find((f) => (f.lines || 1) < 2);
        if (f0) return { cmd: 'facLine', fid: f0.id, type: pickLineType(game, oi, stance === 'endgame') };
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
    if (f0) return { cmd: 'facLine', fid: f0.id, type: pickLineType(game, oi, stance === 'endgame') };
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
 * 总部自带防卫：300px 射程、20 dmg / 0.5s = 40 dps 单点火力（射程由 200 上调到 300 之后，
 * 「甜甜圈缝」几乎被堵死了）。判据 `射程 + 总部半径45 > 300`：
 *   锐士 / 游侠 / 激光 225~285 ✘　盾卫 125~155 ✘　燎原 195~255 ✘　**轰击 305/335/365 ✔**
 * → 现在**只有轰击能白嫖**，其余兵种一律得顶进防卫圈挨 40dps，所以攻城必须带前排。
 *
 * ⚠️ 站位半径要留余量：`r = 射程 + 总部半径 − 8`，写 `+5` 会让兵站在**打不到**的位置上
 * （整队站着不动干挨打）。够不着的兵直接判进 `inn` 往里压，不要在外圈陪站。
 */
function siegeRing(game, target, group) {
  let sx = 0;
  let sy = 0;
  for (const u of group) {
    sx += u.x;
    sy += u.y;
  }
  let minReach = Infinity;
  for (const u of group) minReach = Math.min(minReach, (u.range || 0) + HQ_R_PX - 8);
  const r = Math.min(HQ_DEF_R_PX + 12, minReach);
  let ax = sx / group.length - target.x;
  let ay = sy / group.length - target.y;
  const d = Math.hypot(ax, ay) || 1;
  // 攻城环上也要挑高处：站得高 = 射程更远 = 更可能站在防卫圈外白嫖。
  // ⚠️ 只挪 80px、且不许离总部更远 20px 以上（挪过头就打不到了，整队站着干挨打）。
  return highGround(game, target.x + (ax / d) * r, target.y + (ay / d) * r, target.x, target.y, [80], 20);
}

function splitMarch(game, target, units, cmds) {
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
      // 判定要留余量：`射程 + 总部半径 > 防卫射程 + 12` 才算真的够得着外圈
      // （轰击 1 阶 260+45 = 305 只比 300 多 5px，会被互推挤进防卫圈 → 判成 inn 更稳）
      ((u.range || 0) + HQ_R_PX > HQ_DEF_R_PX + 12 ? out : inn).push(u);
    }
    // 人太少就别玩站位了：零星几个兵站外圈既打不动也挡不住，直接压上去
    if (out.length >= 6) {
      const p = siegeRing(game, target, out);
      cmds.push({ cmd: 'move', x: Math.round(p.x), y: Math.round(p.y), ids: out.map((u) => u.id) });
      if (inn.length) {
        cmds.push({ cmd: 'move', x: Math.round(target.x), y: Math.round(target.y), ids: inn.map((u) => u.id) });
      }
      return cmds;
    }
  }
  // 有最小射击半径的兵（轰击）**不能贴到建筑脸上** —— 挤进射界死角就一发都打不出去。
  // 单独把它们摆到「建筑半径 + 自己的最小射程 + 余量」的环上，其余兵照常压到楼下。
  const stay = units.filter((u) => (u.minRange || 0) > 0);
  const push = units.filter((u) => !((u.minRange || 0) > 0));
  if (stay.length) {
    const bR = target.kind === 'h' ? HQ_R_PX : target.kind === 'l' ? LAB_R_PX : FAC_R_PX;
    let want = bR + 12;
    for (const u of stay) want = Math.max(want, bR + u.minRange + 12);
    // 从「这群兵的重心」朝建筑方向取环上一点：不用绕远，也不至于站到楼后头去
    let cx = 0;
    let cy = 0;
    for (const u of stay) {
      cx += u.x;
      cy += u.y;
    }
    cx /= stay.length;
    cy /= stay.length;
    let ax = cx - target.x;
    let ay = cy - target.y;
    const ad = Math.hypot(ax, ay) || 1;
    ax /= ad;
    ay /= ad;
    cmds.push({
      cmd: 'move',
      x: Math.round(target.x + ax * want),
      y: Math.round(target.y + ay * want),
      ids: stay.map((u) => u.id),
    });
  }
  if (push.length) cmds.push({ cmd: 'move', x: Math.round(target.x), y: Math.round(target.y), ids: push.map((u) => u.id) });
  return cmds;
}

/**
 * 守军比例：develop 0 / skirmish 0.1 / endgame 0.06 / desperate 0.8
 * （无威胁时几乎不留守：总部自带防卫，兵力压上去才有输出。）
 *
 * 调度优先级：
 *   ① 回防 / 换家判决（homeDefense）
 *   ② 前中期软目标 → 用行军/拆楼时间评估后分兵（不因主目标 committed 就全员归一）
 *   ③ 中立无人守 → 直接去打，不在集结点空等
 *   ④ 已集结 / 还在集结 → 扑向主目标或去前压点
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
      splitMarch(game, target, alive, cmds);
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

  // 按「离总部近 + 射程梯度」选守军。
  // ⚠️ 射程不是一刀切的「>100 就加成分」，而是**线性于射程本身** ——
  // 守家推演里 轰击（260~320）是唯一能在敌人还在路上就开始输出的兵，
  // 对付燎原偷袭尤其明显（10v10：轰击守军 10/10 存活，锐士/游侠/激光只剩 0~3 个）。
  const scored = alive
    .map((u) => {
      const d = dist(u.x, u.y, hq.x, hq.y);
      const rangedBonus = -(u.range || 0) * 1.2;
      const lowHp = u.hp / u.maxHp < 0.4 ? 100 : 0;
      return { u, score: d + rangedBonus + lowHp };
    })
    .sort((a, b) => a.score - b.score);

  const guards = scored.slice(0, keep).map((s) => s.u);
  let mobile = scored.slice(keep).map((s) => s.u);

  // —— 残血兵后撤（真人会拉扯，别站着白送）——
  // 血少的兵继续站在原地对射 = 白送一个产能名额（产线名额制下，兵死了这条线才补），
  // 撤出对面射程边打边退，血薄的那几个能多活一轮，等于白捡一段 dps。
  // ⚠️ 只撤「贴脸的」（附近有敌兵才撤），没敌人就别乱跑，否则主力永远在散步。
  {
    const hurt = [];
    for (const u of mobile) {
      if (u.hp / u.maxHp >= RETREAT_HP) continue;
      let nd = Infinity;
      let nx = 0;
      let ny = 0;
      for (const e of game.units) {
        if (e.dead || e.ownerIdx === oi) continue;
        const d = dist(u.x, u.y, e.x, e.y);
        if (d < nd) {
          nd = d;
          nx = e.x;
          ny = e.y;
        }
      }
      if (nd < RETREAT_NEAR) hurt.push({ u, nx, ny });
    }
    if (hurt.length) {
      // 整股朝「背离最近敌兵」的合方向退：边退边自动开火，等于拉扯
      let ax = 0;
      let ay = 0;
      let vx = 0;
      let vy = 0;
      for (const h of hurt) {
        ax += h.u.x;
        ay += h.u.y;
        const dx = h.u.x - h.nx;
        const dy = h.u.y - h.ny;
        const m = Math.hypot(dx, dy) || 1;
        vx += dx / m;
        vy += dy / m;
      }
      ax /= hurt.length;
      ay /= hurt.length;
      const mm = Math.hypot(vx, vy) || 1;
      const rx = Math.max(200, Math.min(WORLD_PX - 200, ax + (vx / mm) * RETREAT_D));
      const ry = Math.max(200, Math.min(WORLD_PX - 200, ay + (vy / mm) * RETREAT_D));
      const hs = new Set(hurt.map((h) => h.u.id));
      mobile = mobile.filter((u) => !hs.has(u.id));
      cmds.push({
        cmd: 'move',
        x: Math.round(rx),
        y: Math.round(ry),
        ids: hurt.map((h) => h.u.id),
      });
    }
  }

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
      // 站岗也站高处：射程随层差 +1 格/层，守军站高台能更早开火、覆盖更宽
      const gp = highGround(game, hq.x + 80, hq.y + 80, hq.x, hq.y, [120], 60);
      cmds.push({
        cmd: 'move',
        x: Math.round(gp.x),
        y: Math.round(gp.y),
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
        splitMarch(game, harass.target, harass.units, cmds);
      }
    }
    // 前中期软目标：用时间线评估后分兵。总部必须合兵，committed 也不准把两路合成一路。
    const prongs =
      target && target.kind !== 'h' ? pickProngs(game, oi, stance, state, mobile, tNow) : null;
    if (prongs) {
      for (const g of prongs) splitMarch(game, g.target, g.units, cmds);
    } else if (!mobile.length) {
      // 兵全派去骚扰了，主体这轮不再下指令
    } else if (!target) {
      if (stage) cmds.push({ cmd: 'move', x: Math.round(stage.x), y: Math.round(stage.y), ids: mobile.map((u) => u.id) });
    } else if (committed) {
      // 全军扑向主目标：已到门口的强拆，还在赶路的边走边打（补充兵也由集结点直发战场）
      splitMarch(game, target, mobile, cmds);
    } else if (target.ref && target.ref.owner < 0) {
      // 中立无人守：行军就是扩张，别在前压点空等半支军队
      splitMarch(game, target, mobile, cmds);
    } else if (stage) {
      // 还没凑够人：先到前压集结点会合（移动途中照常自动索敌开火）
      cmds.push({ cmd: 'move', x: Math.round(stage.x), y: Math.round(stage.y), ids: mobile.map((u) => u.id) });
    } else {
      splitMarch(game, target, mobile, cmds);
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
    armyCentroid,
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
