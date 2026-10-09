'use strict';

/**
 * 战争工厂（warfactory）：2–4 人水墨即时战略。
 *
 * 规则：
 * - 无经济系统。每家总部正前方固定 2 座初级厂（开局即在防卫射程内），
 *   中场再随机 2 座初级 + 2 中 + 1 高；研究所每家门口 1 座 + 中场再随机 1 座。
 * - 建筑易主靠打光血量：累计消耗血量最多的玩家在血尽时接管；占领后每条产线各自计时，
 *   到点产出该产线当前阶数的单位（不再按「每厂兵力上限」截断）。
 *   己方兵站在工厂外缘维修半径内可为工厂回血；停止攻击 1 分钟则清空该玩家的伤害账本。
 * - 工厂等级只决定一件事：本厂每条产线能进化到的最高阶（初级 1 / 中级 2 / 高级 3）。
 * - 产线：工厂与总部默认各 1 条，花科技点可再开辟（最多 FAC_MAX_LINES 条），
 *   开辟时自选兵种；中 / 高级工厂的每条产线还能花科技点单独进化一阶 ——
 *   首次进化必须先定型分支（A 攻势 / B 守势），此后这条线**直接产出该阶单位**
 *   （而不是继续产出初级、再由玩家一支支手动进阶）。
 * - 总部也出兵：默认产锐士，且总部产线**不可进化**（永远只有初级）。
 * - 单位五种：锐士（近战突进）、盾卫（重甲坦克）、游侠（远程狙击）、
 *   轰击（范围炮击）、燎原（燃烧灼烧）；产线首次进化时定型 A 攻势 / B 守势。
 * - 操作：框选己方部队 → 右键下达「移动/进攻移动」。
 *   单位**不会自动追击**：只有敌人进入攻击范围才开火，敌人跑出范围即停火（不追）。
 *   行军途中照常开火（移动攻击），所以不追击也能边走边打。
 * - 玩家失去全部工厂即出局，最后存活者获胜。
 *
 * 服务端权威模拟：固定 10Hz 步进，快照走轻量 game:rt 通道；
 * 全量 game:state 在阶段切换 / 占领 / 淘汰 / 胜负时广播（至少间隔 1s 节流）。
 */

const WFData = require('./data.js'); // 平衡数据总表：兵种 / 进化 / 科技费用 / 建筑 / 总部 / 激光 / 火焰
const WFMaps = require('./maps.js'); // 自定义地图仓库（地形编辑器导出的 maps/warfactory/*.json）
const WFBot = require('./bot.js'); // 对战机器人（困难档）：think() 输出 setPlayerInput 指令
const WFPerlin = require('./perlin.js'); // 柏林噪声（https://gitee.com/sli97/pcg）
const WFRvo = require('./rvo.js'); // RVO2/ORCA 单位避障（https://github.com/warmtrue/RVO2-Unity）

// 世界是**正方形**：11520 × 11520（N 重旋转对称要求纵横同尺度，否则转 90° 会把地图转出界）。
// 格子边长 TERR_CELL 保持不变（40px），故行列同为 288（见 TERR_COLS / TERR_ROWS）。
// 地图一路放大是为了给**中场**腾地方：出生圈贴着外沿、主路沿着各家之间的弦走，
// 中间那一大片正是双方争夺的战场 —— 图越大，中场能摆的遮挡物越多（见 CORE_* 与 topUpCore）。
const WORLD_W = 11520;
const WORLD_H = 11520;
const TICK_MS = 100;
const MAX_DT = 0.25;
const TAU = Math.PI * 2;

const COUNTDOWN_MS = 3000;

// ---- 格子单位制 ----
// data.js 里所有长度都以「格」为单位，这里统一换算成像素供引擎使用。
// 想整体缩放战场尺度，只改 data.js 的 grid.cell 即可。
const GRID = WFData.grid.cell; // 1 格 = 多少像素
/** 格 → 像素 */
function cellsToPx(n) {
  return n * GRID;
}
/** 占位格数 → 碰撞半径（像素）：占 size 格见方的东西，半径 = size/2 格 */
function sizeToR(size) {
  return (size * GRID) / 2;
}

// ---- 工厂 / 研究所 ----
const FACTORY_R = sizeToR(WFData.buildings.factorySize); // 工厂碰撞半径（size/2 格）
const PRODUCE_MS = WFData.buildings.produceMs; // 出兵间隔
// 工厂维修：判定半径 = 工厂碰撞外缘 + repairRange 格；每名友军单位提供 repairHpPerSec HP/s
const REPAIR_RANGE = FACTORY_R + cellsToPx(WFData.buildings.repairRange != null ? WFData.buildings.repairRange : 5);
const REPAIR_HP_PER_SEC = Number(WFData.buildings.repairHpPerSec != null ? WFData.buildings.repairHpPerSec : 2);
// 伤害账本遗忘：这么久没再打这座建筑 → 该玩家累计消耗血量清零
const DAMAGE_FORGET_MS = Math.max(1000, Number(WFData.buildings.damageForgetMs != null ? WFData.buildings.damageForgetMs : 60000));
// 每名玩家的部队总数上限：达到即暂停所有工厂的生产（兵死了立刻恢复）
const PLAYER_UNIT_CAP = 400;
const PLAYER_UNIT_WARN = 350; // 达到该数量后客户端在右上角常驻提示
// 工厂可被攻击：血量 = 单位血量的 20 倍；血打光即由「最后一击者」接管
const FACTORY_HP = WFData.buildings.factoryHp;
// 中立工厂只有完整工厂的 1/3 血量
const NEUTRAL_HP_RATIO = WFData.buildings.neutralHpRatio;
// 手动进化冷却（毫秒）：非初级工厂每间隔这么久才能手动进阶一支本厂部队
const FAC_EVOLVE_CD = WFData.tech.facEvolveCd;

// ---- 工厂产线升级 / 总部产能升级 ----
// 工厂默认一条产线（每 PRODUCE_MS 出 1 支）；花科技点可开辟更多产线，
// 多条产线并行生产 → 同一时间一座工厂就能同时出多个单位（产出速率 × 产线数）。
// 各项科技花费各自读 data.js tech.*，互不覆盖 —— 改价只改对应字段。
const FAC_LINE_COST = WFData.tech.facLineCost; // 开辟一条新产线
// 第 8 项：每座建筑（工厂 / 研究所）最多**额外**开拓 1 条产线 ——
// 工厂/总部默认 1 条，开拓后 2 条（取代原先的 3 条上限）。
const FAC_MAX_LINES = WFData.tech.facMaxLines; // 单厂产线上限（含默认那条）

// ---- 第 9 项：每条产线各自的「在场名额」与「越多越慢」----
// 每条产线吐出来的兵，只要还在场上就占着这条线的一个名额。每占一个名额，
// 这条线的产速就 -10%（**独立乘区**：与总部提速、抢占加成等其它系数相乘，
// 不参与加减），占满 LINE_UNIT_CAP 个名额时乘区归零 → 彻底停产。
// 于是「一条线最多同时养 10 个兵」既是硬上限，也是它自己算出来的自然结果。
const LINE_UNIT_CAP = WFData.lines.unitCap; // 每条产线同时最多养这么多兵
const LINE_SLOW_PER_UNIT = WFData.lines.slowPerUnit; // 每多在场一个兵，该线产速减少的比例
// 产线进化：把某一条产线的「出厂阶数」整体抬高一阶 —— 此后这条线直接吐该阶单位，
// 比旧规则（一次只进阶一支现存部队）强得多，所以单独定价、不再沿用 EVOLVE_RP_COST。
const FAC_LINE_EVOLVE_COST = WFData.tech.facLineEvolveCost; // 每进化一条产线
// 总部产线：总部自己也会出兵，默认兵种固定为锐士，且**不可进化**（永远只出初级）。
// 想换兵种可以花科技点再开辟产线（开辟时自选），但同样只能是一级。
const HQ_PROD_TYPE = WFData.buildings.hqProdType;
// 总部「生产加速」：用科技点加快本方所有部队的生产速度。
// 每一次都在「当前间隔」上再减 1/15（复利 / 非线性），最多 20 次。
const PROD_SPEED_COST = WFData.tech.prodSpeedCost; // 每次升级消耗的科技点
const PROD_SPEED_MAX = WFData.tech.prodSpeedMax; // 升级次数上限
const PROD_SPEED_STEP = WFData.tech.prodSpeedStep; // 每次在现有间隔上再减少的比例

// ---- 第 7 项：研究所「研究产线」----
// 研究所可花科技点开拓研究产线（每座最多 LAB_MAX_LINES 条，点击即生效、无二级选择）。
// 每开拓一条，该所每周期产出 +LAB_LINE_RP_BONUS（与基数相加，不是倍率）。
const LAB_LINE_COST = WFData.tech.labLineCost; // 开拓研究产线消耗的科技点
const LAB_MAX_LINES = WFData.tech.labMaxLines; // 每座研究所最多开拓的产线条数
const LAB_LINE_RP_BONUS = Math.max(
  0,
  Math.round(Number(WFData.tech.labLineRpBonus != null ? WFData.tech.labLineRpBonus : 1))
); // 每条产线每周期额外产出

// ---- 第 6 项：总部防卫 ----
// 总部自带防卫火力：锁定进入射程的敌方部队，先亮出明显的攻击前摇，再一发直伤。
const HQ_ATK_RANGE = cellsToPx(WFData.hqDefense.range); // 防卫射程
const HQ_ATK_CD = WFData.hqDefense.cd; // 攻击间隔（秒）
const HQ_ATK_DMG = WFData.hqDefense.dmg; // 每发伤害
const HQ_ATK_WINDUP_MS = WFData.hqDefense.windupMs; // 攻击前摇（毫秒）：锁定后先蓄能这么久才开火

// ---- 研究所 / 总部 / 科技点 ----
const LAB_R = sizeToR(WFData.buildings.labSize); // 研究所碰撞半径（6×6 格 → 半径 3 格）
const LAB_HP = WFData.buildings.labHp; // 研究所满血：同工厂一样可被攻击，打光即由最后一击者接管
const HQ_R = sizeToR(WFData.buildings.hqSize); // 总部碰撞半径（9×9 格 → 半径 4.5 格）
const HQ_HP = WFData.buildings.hqHp; // 总部满血：被打光即「总部陷落」，该玩家出局
const RP_PER_LAB = WFData.tech.rpPerLab; // 每座已占领的研究所每 3 秒提供 2 点研究点；一座不占则完全不产出
const RP_PERIOD_MS = WFData.tech.rpPeriodMs; // 研究点结算周期
// 旧「单支部队进阶」的价钱：进化改为「产线整体抬一阶」后已不再参与结算，
// 仅保留常量与下发字段（evolveRpCost）以免旧客户端读 consts 时取到 undefined。
const EVOLVE_RP_COST = WFData.tech.evolveRpCost;
const RP_CAP = WFData.tech.rpCap; // 科技点上限，仅用于展示封顶

// ---- 单位 ----
const TYPE_LIST = Object.keys(WFData.units); // 兵种顺序与 data.js 中一致
// 开局部队：展开 data.js 的 [[兵种, 数量], ...] → 扁平兵种列表
const START_ROSTER = [];
for (const entry of WFData.startRoster || []) {
  const type = entry[0];
  const n = Math.max(0, entry[1] | 0);
  if (!TYPE_LIST.includes(type) || n <= 0) continue;
  for (let i = 0; i < n; i++) START_ROSTER.push(type);
}
// 战斗数值全部来自 data.js（见 WFData.units）。
const STATS = WFData.units;
// 进化兵种：2/3 阶的完整属性直接查 evolved[type][tier]（见 data.js，独立数据表）
// ---- 激光兵 ----
const LASER_WINDUP_MS = WFData.laser.windupMs; // 前摇：换目标后这么久内不射击（蓄能）
const LASER_RAMP_MS = WFData.laser.rampMs; // 倍率爬升周期：前摇结束后每持续这么久，倍率 +1
const LASER_MAX_MUL = WFData.laser.maxMul; // 倍率上限（初始 1 倍 → 最高 20 倍）
// ---- 光束观感跟着「实际伤害」走（详见 laserVisSizeMul / laserVisDetail）----
const LASER_VIS_BASE_DMG = WFData.laser.visBaseDmg; // 基底伤害：正好这么多伤害时大小系数为 1
const LASER_VIS_STEP_PCT = WFData.laser.visStepPct; // 每比基底翻一倍，大小系数 +这么多（0.05 = +5%）
const LASER_VIS_DETAIL_PER = WFData.laser.visDetailPerDbl; // 每再翻这么多倍，多一层特效细节
const LASER_VIS_DETAIL_MAX = WFData.laser.visDetailMax; // 细节层数上限
// 索敌余量：只锁定「已经进入攻击范围」的敌人，仅留一点点余量避免边界抖动。
// 单位不再自动追击——敌人跑出范围就停火，想打就自己右键把它拉过去。
const ATTACK_SLACK = 10;
const SCAN_MS = 250; // 索敌重估间隔
const MELEE_RANGE = 65; // ≤ 该射程视为近战（弹道高速短命）

// ---- 转向速率：车体（底盘）与炮塔都按角速度转，不再瞬间扭到位 ----
// 车体朝行进方向、炮塔朝攻击方向（两者是两个独立的角，见 turnHull / turnTurret）。
// 有角速度之后：
//   · 下移动命令 → 车头先转过去（夹角太大就原地掉头），转到位 / 转到一定角度才开始挪；
//   · 索敌到目标 → 炮塔先转过去，对上（aimTol 内）才允许开火。
// 全部数值来自 data.js 的 turn 段，别在这里写死。
const TURN_HULL = WFData.turn.hull; // 车体角速度（rad/s）
const TURN_TURRET = WFData.turn.turret; // 炮塔角速度（rad/s）
const TURN_SIZE_SLOW = WFData.turn.sizeSlow; // 体型惩罚指数：越大的兵转得越慢
const TURN_AIM_TOL = WFData.turn.aimTol; // 炮塔偏差 ≤ 此值才算瞄上，才允许开火
const TURN_MOVE_COS = WFData.turn.moveCos; // 车头与前进方向夹角余弦 < 此值 → 原地掉头
const TURN_MOVE_MIN = WFData.turn.moveMin; // 边掉头边走时的最低速度比例

// ---- 弹道 ----
// 弹速按兵种写在 data.js 的 bulletSpeed 里；这里只留缺省兜底（旧数据 / 无弹道兵种）。
const BULLET_SPEED_FALLBACK = 330;
const BULLET_LIFE_MS = 2400;
const BULLET_R = 5;
// 弹体细分步长（px）：弹速可以快到一步跨过目标（9999px/s × 50ms = 500px），
// 命中判定按这个长度把一帧切成若干小步 —— 再快的弹也不会从敌人身上飞过去。
const BULLET_SUBSTEP_PX = 12;
// 直射弹（非激光、非近战）命中后的爆炸半径：所有「子弹」都带溅射，
// 且落点落在目标碰撞体积的随机一点（见 unitFire 的 aimAng），所以擦边命中时一次能溅到多个单位。
const BULLET_SPLASH = 18;

// ---- 轰击（burst）抛射弹 ----
// 轰击不再走平直弹道，而是「抛射」：记录发射点 (sx,sy) 与落点 (tx,ty)，按飞行时间参数化，
// 地面位置在两点之间线性插值，高度 z 走一条抛物线（峰值为 peak，落地 z=0）。
// 因此无论目标躲到山后多远，弹都能**越过山脉**落到落点 —— 它既不撞山，溅射也不受山体遮挡。
// 飞行时长由该兵种的 bulletSpeed 与距离换算（远射更久）；弧顶高度仍随距离升高。
const SHELL_FLIGHT_MIN_MS = 280; // 抛射最短飞行时间（ms），避免贴脸瞬间落地
const SHELL_PEAK_BASE = 46; // 基础弧顶高度（px）
const SHELL_PEAK_PER_PX = 0.52; // 每多 1px 距离增加的弧顶高度（px）

// ---- 燎原：喷火 / 灼烧地形 ----
// 燎原不再按秒摊伤害，而是跟其它兵种一样**按次结算**：
// 每 `cd` 秒喷「一口火」，一口 = `dmg` 点范围伤害（只伤敌方），并在落点刷新灼烧地形。
// （对比：火应用到一口结算一次；灼烧地形本身仍按 dps 每秒烧人。）
// 火舌的**落点**锁在敌人身上（见 sprayFlame），所以连着喷时几口火落在同一个地方。
// 踩在灼烧地形上的单位持续掉血，而且这里敌我通吃 —— 这是全局唯一的友伤来源，
// 所以灼烧地形的 dps 压得很低、范围给得很大。
// 火场的寿命跟着「最后一次被火舌刷到」走：火焰一停，几秒内自然熄灭。
// **建筑只吃火舌的直接打击**：落点范围内的敌方建筑同样掉血，但地上的灼烧地形
// 对建筑完全无效 —— 想拆工厂/研究所/总部，就得把火舌一直喷在它身上。
const FLAME_R = cellsToPx(WFData.flame.r); // 火舌落点的范围伤害半径（范围大）
const FIRE_MAX = WFData.flame.maxFires; // 场上灼烧地块上限（防列表无限膨胀）
// 火舌范围伤害的**距离衰减**：落点中心吃满 dmg，越往外越低，边缘只剩 FLAME_EDGE_MUL 倍。
const FLAME_EDGE_MUL = WFData.flame.edgeMul == null ? 1 : WFData.flame.edgeMul;

/**
 * 目标离落点中心 `gap` 像素时，这一口火还剩下几成伤害（1 = 满伤）。
 * gap 用「目标最近边缘到落点的距离」：自己压在落点上就是 0，吃满；
 * 站在火舌最外沿就是 FLAME_R，只剩 FLAME_EDGE_MUL。中间线性过渡。
 */
function flameFalloff(gap) {
  if (FLAME_R <= 0 || FLAME_EDGE_MUL >= 1) return 1;
  const t = Math.min(1, Math.max(0, gap / FLAME_R));
  return 1 + (FLAME_EDGE_MUL - 1) * t;
}

// 轰击炮弹落地的溅射衰减：口径同上（中心吃满 → 边缘只剩 BURST_EDGE_MUL），
// 但半径**跟着弹走**（1/2/3 阶分别是 30 / 45 / 60px，见 data.js 的 units.burst.splash），
// 所以这里按「这一发弹的 splash 半径 r」归一化，而不是像火舌那样用全局常数。
const BURST_EDGE_MUL = WFData.burstSplash && WFData.burstSplash.edgeMul != null ? WFData.burstSplash.edgeMul : 1;

/** 目标离落点中心 gap 像素（已扣掉自身半径）时，这一发炮弹还剩几成伤害（1 = 满伤） */
function splashFalloff(gap, r) {
  if (!(r > 0) || BURST_EDGE_MUL >= 1) return 1;
  const t = Math.min(1, Math.max(0, gap / r));
  return 1 + (BURST_EDGE_MUL - 1) * t;
}

/**
 * 灼烧地形**逐阶解锁**（用户设定）：
 *   一级燎原只会喷火，火舌落点不留火场 —— 想烧地，得先把它进化一次；
 *   二级开始在地上留下灼烧地形（基准值）；
 *   三级火场更大、烧得更久、伤害也更高。
 *
 * 每片火场自带自己的 r/dps/lifeMs（而不是共用全局常量），
 * 因为场上会同时存在不同阶数留下的火场，客户端还要按各自寿命上限算衰减。
 *   r      火场半径（范围大）
 *   dps    每秒伤害（低，而且**敌我通吃**）
 *   lifeMs 最后一次被火舌刷到之后，还能烧多久（几秒内自然熄灭）
 *   mergeD 同主人的相近落点并入同一片火场的距离（否则每步都会新铺一块）
 */
// 火焰档位（见 data.js）：r / mergeD 是格数，这里换算成像素；dps / lifeMs 原样保留
const FIRE_TIERS = WFData.fireTiers.map((p) =>
  p ? { r: cellsToPx(p.r), dps: p.dps, lifeMs: p.lifeMs, mergeD: cellsToPx(p.mergeD) } : null
);

/** 取该阶数的火场参数；一级返回 null，表示「这一阶的燎原不留火场」 */
function fireProfile(tier) {
  return FIRE_TIERS[clamp(tier || 1, 1, 3) - 1];
}

/**
 * 弹种编号（下发到客户端的紧凑表示，客户端按它选画法）。
 *   0 弹丸 / 1 近战 / 2 炮击 / 3 火焰 / 4 激光（激光不走弹道，只用于「开火」表现）
 * 客户端 public/games/warfactory/ui.js 的 drawBullets / 枪口焰分支与此一一对应。
 *
 * 注意：3（火焰）现在**不再有弹体** —— 燎原改成了持续喷吐的火舌（见 sprayFlame），
 * 编号 3 只用来让客户端把枪口焰画成火焰色。快照里不会出现 k=3 的弹丸，
 * 但 drawBulletBody / drawSplatFx 仍保留 k=3 的分支，供 docs 特效图谱页逐格核对。
 */
const BULLET_KIND_IX = { bullet: 0, melee: 1, shell: 2, fire: 3 };
/** 开火事件里的弹种编号：4 表示激光（客户端画冷光蓄能焰，而非火花） */
const SHOT_KIND_LASER = 4;
/**
 * 目标类别编号（与单位快照里的「锁定目标类别」「追击命令目标类别」共用同一套编号）：
 * 0 无 / 1 单位 / 2 工厂 / 3 研究所 / 4 总部。
 * 客户端只收到编号与 id，具体坐标由它从本地的单位/建筑视图里取。
 */
const TARGET_KIND_IX = { u: 1, f: 2, l: 3, h: 4 };

// 玩家归属色：红 / 蓝 / 黄 / 绿。
// 客户端把它同时用于单位本体描色、单位脚下底色盘、工厂底色盘（60% 透明）等，
// 改动这里请连带看一眼 public/games/warfactory/ui.js 的 OWNER_PAD_ALPHA。
const COLORS = ['#b03a2e', '#2e5e8c', '#c9a227', '#3f7a52'];

// ---- 地形（几何图元：楔形母图 + N 重旋转折叠出整图）----
// 类型编号与客户端（public/games/warfactory/ui.js）保持一致：
//   0 平原 / 2 山地（不可通行，另有高度 → 遮挡视线与弹道）/ 4 水域（不可通行，大片连续；不遮挡视线）
// 其中「山地」另有高度：它同时遮挡视线与弹道（山两侧互相看不见、打不到）；
// 「水域」只是不可通行的平面，不遮挡视线，弹丸照常飞越水面。
const TERR_COLS = 288;
const TERR_ROWS = 288; // 正方形地图：288 × 288 格（11520/40 = 288）
const TERR_CELL = 40;
const TT_PLAIN = 0;
const TT_MOUNTAIN = 2;
const TT_WATER = 4;
// 沼泽已彻底移除：不再生成该地形，单位移动也不再有任何减速惩罚。
const TERRAIN_CLEAR_CELLS = 3; // 建筑周围清理「山地/水域」的格子半径（约 120px，覆盖出兵环）

// ---- 地形图元：一整套「人工设计」风格的笔刷（取代原先的元胞自动机）----
// 旧算法是「随机高程场 → 多轮平滑 → 分位数分类 → 众数滤波」，出来的是噪声状团块：
// 边界歪歪扭扭、每局都像另一张图，既不像山也不像湖。
// 现在改成从**整片平原**起步，按主题给的 shapes 清单往上盖**规整图元**：
//   wall  笔直长墙：正交或 45°、整数厚度、沿长度按固定间距开隘口当「关口」
//   blob  山块 / 湖泊：round 控制方圆（0 = 矩形台地，1 = 椭圆湖）
//   ring  环形山：一圈墙 + 若干缺口
// 位置随机但**吸附到 SHAPE_SNAP 的整数倍**、方向只取正交 → 每局摆位不同、
// 结构却是同一套：墙大致顺直、山块圆角、湖是圆的。收尾还有 roundTerrainEdges
// 削掉外缘直角锯齿（对角切角禁令下，方角会把窄路卡死）。
const SHAPE_SNAP = 4; // 图元中心吸附的格距（越大越有「格子纸上画图」的整齐感）
const SHAPE_TRY = 24; // 有落笔白名单时，图元中心最多试几个候选位（见 shapeCenter）
// 每种图元的兜底参数：主题里没写的字段落回这里（写法见 data.js 的 themes 段）
const SHAPE_DEFAULTS = {
  // len 是「世界宽度的倍数」；gap / gapW 是隘口的间距与宽度（格）
  wall: { count: [5, 7], len: [0.3, 0.5], thick: [3, 4], gap: [44, 72], gapW: [10, 14], dir: 'hv' },
  // round 0.78 → 超椭圆指数 ≈ 3.8：明显圆角，少直角台地（0.2 ≈ 指数 8.4 的方砖）
  blob: { count: [3, 5], w: [12, 24], h: [12, 24], round: 0.78 },
  ring: { count: [1, 1], r: [24, 34], thick: [4, 6], gap: [3, 4] },
};

// 单个「山块 / 湖泊」的最小占地（格²）—— 地形要成片，不许出现小山小湖。
// 480 格 ≈ 0.58% 图幅：22 格见方的方台山、25 格直径的圆湖（≈ 900 × 900 px 起步）。
// 早先是 200 格（14 格见方），但需求要「山体和水体更大」—— 小碎块既挡不住进攻、
// 也看不出地貌，只会把地图画脏（而且会被连通性兜底当碎块填掉）。写小了会被夹回来。
const SHAPE_MIN_AREA = 480;
// 收尾时把比这还小的地形块整块填平（见 clearTinyBlobs）。图元本身 ≥200 格，
// 但被主路 / 清场圈 / 连通性开道切过之后会留下几格大的斑点 —— 那也算「小山小湖」。
// 48 格 ≈ 275 × 275 px：再小就挡不住人、只把地图画脏。
// 早先是 60 格，但三条主路铺开后地形被切得更碎，稀疏主题（超级平原 / 环形山）连
// topUpCore 专门补进中心圈的那点地形都会被整片清掉（实测 2 人局中心密度比 0.00）。
const MIN_BLOB_CELLS = 48;

/**
 * 达到最小占地所需的边长（格）。圆形只填满外接矩形的 π/4，方塊填满 1，
 * 所以圆湖要按填充率把边长放大 —— 否则「14 格的圆湖」实际只有 154 格，还是个小水坑。
 */
function shapeMinSide(round) {
  const k = 0.785 + 0.215 * (1 - clamp(Number(round) || 0, 0, 1)); // 圆 0.785 → 方 1
  return Math.ceil(Math.sqrt(SHAPE_MIN_AREA / k));
}

/** 图元单件的**预估占地**（格²）：用于收尾时挑小图元，免得一盖就超额一大块 */
function shapeEstArea(cfg) {
  const d = SHAPE_DEFAULTS[cfg.kind] || SHAPE_DEFAULTS.blob;
  const mid = (v, dv) => {
    if (Array.isArray(v)) return ((Number(v[0]) || 0) + (Number(v[v.length - 1]) || 0)) / 2;
    return Number(v != null ? v : dv) || 0;
  };
  if (cfg.kind === 'wall') return mid(cfg.len, d.len) * ((TERR_COLS + TERR_ROWS) / 2) * mid(cfg.thick, d.thick);
  if (cfg.kind === 'ring') return 2 * Math.PI * mid(cfg.r, d.r) * mid(cfg.thick, d.thick);
  return mid(cfg.w, d.w) * mid(cfg.h, d.h) * (0.785 + 0.215 * (1 - clamp(Number(cfg.round == null ? d.round : cfg.round), 0, 1)));
}

/**
 * 把图元整体缩小到「占地 × f」（0 < f ≤ 1），但**不得小于 SHAPE_MIN_AREA** ——
 * 缩到最小还是塞不下就原样返回（调用方据此判断「这个图元用不了」）。
 *
 * 为什么需要：图元现在都很大（一块 30 格的台地被 D_N 复制 4 份就是全图的 4.3%），
 * 而补地形时剩下的缺口常常只有 1~2 个百分点 —— 「盖一整块就超额、不盖就永远差一截」，
 * 于是补地形那一步只能硬着头皮盖最小的那个，实测超级平原的山从预设 5% 顶到 9.2%。
 * 缩到刚好塞得下之后，缺口多大就画多大的图元，主题预设才贴得住。
 */
function shrinkShape(cfg, f) {
  if (!cfg || !(f > 0)) return cfg;
  const est = Math.max(1, shapeEstArea(cfg));
  const g = clamp(f, SHAPE_MIN_AREA / est, 1);
  if (g >= 0.995) return cfg;
  const d = SHAPE_DEFAULTS[cfg.kind] || SHAPE_DEFAULTS.blob;
  const mid = (v, dv) => {
    if (Array.isArray(v)) return ((Number(v[0]) || 0) + (Number(v[v.length - 1]) || 0)) / 2;
    return Number(v != null ? v : dv) || 0;
  };
  const sc = (v, dv, mul) => {
    const m = mid(v, dv) || 1;
    const out = Math.max(1, Math.round(m * mul));
    return Array.isArray(v) ? [out, out] : out;
  };
  const out = { ...cfg };
  if (cfg.kind === 'wall') {
    // 只缩长度、**不缩厚度**：墙细到 2 格就不叫墙了，短而厚仍是一道关口
    out.len = sc(cfg.len, d.len, g);
  } else if (cfg.kind === 'ring') {
    const s = Math.sqrt(g);
    out.r = sc(cfg.r, d.r, s);
    out.thick = sc(cfg.thick, d.thick, s);
  } else {
    const s = Math.sqrt(g);
    out.w = sc(cfg.w, d.w, s);
    out.h = sc(cfg.h != null ? cfg.h : cfg.w, cfg.h != null ? d.h : (cfg.w != null ? cfg.w : d.w), s);
  }
  return shapeEstArea(out) >= SHAPE_MIN_AREA * 0.98 ? out : cfg;
}

/** 图元数量的上限（count 写成 [a,b] 取 b、单值取它本身） */
function shapeCountMax(s) {
  const c = s && s.count;
  if (Array.isArray(c)) return Number(c.length > 1 ? c[1] : c[0]) || 0;
  if (c != null) return Number(c) || 0;
  return 0;
}

/** 把尺寸区间（或单值）的下界抬到 min —— 用来夹住「太小」的图元 */
function liftMin(v, min) {
  if (v == null) return [min, min];
  if (Array.isArray(v)) {
    const a = Number(v[0]);
    const b = Number(v.length > 1 ? v[1] : v[0]);
    return [Math.max(Number.isFinite(a) ? a : min, min), Math.max(Number.isFinite(b) ? b : min, min)];
  }
  const n = Number(v);
  return Math.max(Number.isFinite(n) ? n : min, min);
}

/** 图元参数补齐：只认 kind ∈ {wall, blob, ring}，其余字段缺失时落回 SHAPE_DEFAULTS */
function fillShape(s) {
  const kind = s && (s.kind === 'wall' || s.kind === 'ring') ? s.kind : 'blob';
  const d = SHAPE_DEFAULTS[kind];
  // 山块 / 湖泊有**最小占地**：写小了直接夹回来（详见 SHAPE_MIN_AREA）
  const minSide = shapeMinSide(s && s.round != null ? s.round : d.round);
  return {
    kind,
    type: s && s.type === 'water' ? 'water' : 'mountain',
    count: s && s.count != null ? s.count : d.count,
    len: s && s.len != null ? s.len : d.len,
    thick: s && s.thick != null ? s.thick : d.thick,
    gap: s && s.gap != null ? s.gap : d.gap,
    gapW: s && s.gapW != null ? s.gapW : d.gapW,
    w: liftMin(s && s.w != null ? s.w : d.w, minSide),
    // blob 只写了 w 时，h 默认跟着 w（正方形），除非显式给了 h
    h: liftMin(s && s.h != null ? s.h : s && s.w != null ? s.w : d.h, minSide),
    r: s && s.r != null ? s.r : d.r,
    round: s && s.round != null ? s.round : d.round,
    dir: s && s.dir ? s.dir : d.dir,
    // full: 允许在**整张图**范围内定位（配 at:'center' 就能做出贯穿全图的长墙 / 居中的环形山）
    full: !!(s && s.full),
    // at 是「锚点」：center = 世界正中、corner = 地图四角（45° 方向）。
    // 锚点图元在超额撤图元时**不会被撤**（它们是这局地貌的保底量），所以两个值都得原样留下来
    // —— 只认 'center' 的话，写了 at:'corner' 的主题会被静默降级成随机图元，保底就没了。
    at: s && (s.at === 'center' || s.at === 'corner') ? s.at : null,
  };
}

// ---- 地图主题（每局随机抽一个，见 data.js 的 themes 段）----
// 下面是「没有主题时的兜底参数」：主题里没写的字段就落回这些默认值。
const THEMES = Array.isArray(WFData.themes) ? WFData.themes.filter((t) => t && t.key) : [];

/**
 * 中心圈补地形的默认值（主题里没写 core 就用它）。
 *   r       中心圈半径（相对世界半宽）：0.5 = 中心到边缘的一半，正好覆盖「中场争夺区」
 *   fill    中心圈里**还能落笔**的空地要填到多少比例（主路走廊 / 建筑清场圈不算在内）。
 *           填太满会把中场堵成一整块实心山（绕都绕不过去），0.45 上下是
 *           「有险可守、路也走得通」的量。
 *   budget  中心圈专属的地形额度（占全图的比例）。它是**额外**的一笔，不跟外圈抢：
 *           主题的 maxBlocked 要相应加上它，否则中心补进去的量会把全图顶穿上限。
 *           （于是「外圈堆成山、中间一片空」变成「中间也有险可守」，外圈并不减少。）
 */
const CORE_FALLBACK = { r: 0.5, fill: 0.9, budget: 0.15 };

// 主题里写的 maxBlocked 原值（THEME_FALLBACK.maxBlocked 随后会被抬到「盖得住 mix」，
// 见下）—— fillTheme 兜底时要用**原值**去推 mix，否则每次补齐都会再抬一截。
const THEME_BLOCKED_RAW = 0.28;
const THEME_FALLBACK = {
  key: 'classic',
  name: '标准战场',
  desc: '',
  weight: 1,
  snap: SHAPE_SNAP,
  maxBlocked: THEME_BLOCKED_RAW, // 山 + 水合计覆盖率的硬上限
  core: CORE_FALLBACK, // 中心圈补地形（见 topUpCore）
  shapes: [
    { kind: 'wall', type: 'mountain', count: [4, 6], len: [0.3, 0.5], thick: [5, 7], gap: [40, 64], gapW: [10, 14], dir: 'hv' },
    { kind: 'blob', type: 'mountain', count: [3, 4], w: [28, 40], h: [26, 36], round: 0.15 },
    { kind: 'blob', type: 'water', count: [2, 3], w: [32, 46], h: [32, 46], round: 0.9 },
  ].map(fillShape),
};
// 上面这份兜底也要有 mix（fillTheme 对 THEME_FALLBACK 是原样返回的），
// maxBlocked 同样按「盖得住 mix 目标 + 收尾余量」抬一次 —— 跟 fillTheme 保持同一套规则，
// 否则 fillTheme({key:'x'}) 补齐出来的 maxBlocked 会跟 THEME_FALLBACK.maxBlocked 对不上。
THEME_FALLBACK.mix = fillMix(null, THEME_FALLBACK.maxBlocked, THEME_FALLBACK.shapes);
THEME_FALLBACK.maxBlocked = Math.max(
  THEME_FALLBACK.maxBlocked,
  THEME_FALLBACK.mix.mountain + THEME_FALLBACK.mix.water + 0.05
);
/** 柏林噪声默认参数（与 Gitee sli97/pcg MapManager 默认值对齐） */
const NOISE_FALLBACK = {
  scale: 40,
  octaves: 5,
  persistance: 0.5,
  lacunarity: 2,
  offsetX: 0,
  offsetY: 0,
  /** 可选地貌偏置：'none' | 'centerWater' | 'ringMountain' | 'stretchH' | 'stretchV' */
  bias: 'none',
};
THEME_FALLBACK.noise = Object.assign({}, NOISE_FALLBACK);

/**
 * 中心圈补地形的默认值（主题里没写 core 就用它）。
 *   r     中心圈半径（相对世界半宽）：0.5 = 中心到边缘的一半，正好覆盖「中场争夺区」
 *   fill  中心圈里**还能落笔**的空地要填到多少比例（走廊 / 建筑清场圈不算）
 * 填太满会把中场堵成一整块实心山（绕都绕不过去），0.4 上下是「有险可守、路也走得通」的量。
 */
// ---- 连通性保证 ----
// 「宽格」= 处在某个「2×2 全可通行」方块里的格子。要求所有宽格连成一整片：
//   ① 不足 2 格宽的窄缝会被撑宽；
//   ② 互相隔离的区域之间开出 2 格宽走廊；
//   ③ 小到没意义的孤立碎块直接填掉。
// 于是任何建筑（工厂 / 研究所 / 总部）都不可能被山或水包死，且通道至少 2 格宽。
const MIN_REGION = 20; // 小于该格数的孤立可通行区直接填掉（免得留下走不出去的死地）
const MAX_CARVE_PASSES = 6; // 开走廊的最大轮数（正常 1~2 轮就收敛）
// 寻路：每步最多新建多少个地形流场（缓存未命中时才建；超限的单位本步退回直线转向）
//
// ⚠️ 这个值曾经是 8，是**卡死的主因**：预算耗尽后 flowField 直接返回 null，
//    寻路退化成「直线朝目标转」—— 于是部队一头撞进山体/崖壁，在障碍前每帧左右微调、
//    净位移接近 0，看起来就是「站在原地不动」。
//    实测（3~4 人局、20 支兵各奔不同远点）：预算 8 → 10% 的单位冻结 100s 以上；
//    提到 64 → 冻结 0%。派生预算见 flowBudgetFor()。
const FLOW_BUILD_BASE = 24; // 每步保底新建额度
const FLOW_BUILD_PER_UNIT = 2; // 每在场单位再加多少（单位多、目标分散时才容易不够）
const FLOW_BUILD_MAX = 256; // 硬上限：再多人也不会让单步无限建场
const FLOW_CACHE_MAX = 192; // 流场缓存上限（按目标格缓存）—— 同步调大，别让缓存先于预算失效

// ---- RVO2 / ORCA 单位避障（https://github.com/warmtrue/RVO2-Unity，Apache-2.0）----
// 流场给出「想往哪走」的期望速度；ORCA 在邻域里半责任让开，再交给 slideStep 落地。
// 静态障碍（山/建筑）仍走 canStand + separateUnits，不进 RVO 障碍多边形。
const RVO_CFG = (WFData.rvo) || {};
const RVO_NEIGHBOR_DIST = Math.max(40, Number(RVO_CFG.neighborDist != null ? RVO_CFG.neighborDist : 140));
const RVO_MAX_NEIGHBORS = Math.max(1, Math.round(Number(RVO_CFG.maxNeighbors != null ? RVO_CFG.maxNeighbors : 10)));
const RVO_TIME_HORIZON = Math.max(0.2, Number(RVO_CFG.timeHorizon != null ? RVO_CFG.timeHorizon : 1.25));
const RVO_ENABLED = RVO_CFG.enabled === false ? false : true;
// ---- 山体遮挡（山有高度）----
// 山地不只是「不可通行」：它还会挡住视线与弹道，山两侧的单位互相看不见、打不到。
// 水域只是不可通行（平面），不遮挡视线，弹丸照常飞过水面。
const LOS_STEP = TERR_CELL / 2; // 视线采样步长（半格 20px：不漏掉 1 格宽的山脊，也不会因擦角误判）
const BULLET_TERRAIN_STEP = 8; // 弹道逐帧位移可达 33px，需细分采样才不会「跨过」山脊
// ---- 相邻玩家之间的「进攻主路」（见 data.js 的 roads 段）----
// 环上相邻的两家之间强制挖出 ROAD_PER_PAIR 条可通行大道，每条净宽 ROAD_W 格。
// ROAD_MIN_W 是需求给的硬下限（15 格）：data.js 里写得更小也会被夹回来，防止手滑写窄。
const maxCell = (v, dflt, cap) => Math.max(1, Math.min(cap, Math.round(Number(v != null ? v : dflt) || dflt)));
const ROAD_PER_PAIR = Math.max(1, Math.round((WFData.roads && WFData.roads.perPair) || 3));
// 按人数覆盖条数（data.js 的 roads.perPairByPlayers）。
// ⚠️ **2 人局必须给偶数条**：两家是对径点、连线就是直径，而 D_2 的镜像轴正好压在这条
// 直径上 —— 深度集合必须自对称（± 成对），写 3 条就只能是 [−d, 0, +d]，中路恒在连线上，
// 把关口中线挖穿、两家之间又变回一条笔直大道（实测 2 人局连线 183 格全程无阻挡）。
// 给 4 条 → [−1.5s, −0.5s, +0.5s, +1.5s]，连线两侧各留 ~10 格地形，关口才立得住。
const ROAD_PER_BY_PLAYERS = (WFData.roads && WFData.roads.perPairByPlayers) || null;
const roadPerPair = (n) => {
  const v = ROAD_PER_BY_PLAYERS && ROAD_PER_BY_PLAYERS[Number(n)];
  return Math.max(1, Math.round(v || ROAD_PER_PAIR));
};
const ROAD_MIN_W = 15; // 需求硬下限：主路净宽不得小于 15 格
const ROAD_W = Math.max(ROAD_MIN_W, Math.round((WFData.roads && WFData.roads.widthCells) || ROAD_MIN_W));
const ROAD_GAP = Math.max(0, Number((WFData.roads && WFData.roads.gapCells) != null ? WFData.roads.gapCells : 8));
const ROAD_FAN_END = clamp(Number((WFData.roads && WFData.roads.fanEnd) != null ? WFData.roads.fanEnd : 0.25), 0, 1);
// 三条路的角色几何（详见 roadLanes）：单位是「格」，都是**名义值**；
// 生成时每条还会各自乘一个「尽量用满这边空地」的系数（最大 ROAD_FIT_MAX 倍）。
const ROAD_INNER = maxCell(WFData.roads && WFData.roads.innerCells, 54, 90); // 侧翼路向地图中心侧兜进去多深
const ROAD_OUTER = maxCell(WFData.roads && WFData.roads.outerCells, 72, 110); // 绕后路向地图外侧甩出去多远
// 中路以外那两条形如一张弓：wave3/wave5 是往 sin(πt) 里掺的**奇次**谐波（奇次谐波在
// t → 1−t 下不变号 → 仍然是自镜像的）。掺了之后「起落快、中段平直」，
// 实测绕路长度比从 1.18 倍长到 1.35~1.5 倍；掺太多（≥0.5）就成直角折线了。
const ROAD_WAVE3 = clamp(Number((WFData.roads && WFData.roads.wave3) != null ? WFData.roads.wave3 : 0.28), 0, 0.45);
const ROAD_WAVE5 = clamp(Number((WFData.roads && WFData.roads.wave5) != null ? WFData.roads.wave5 : 0.12), 0, 0.3);
// 侧翼路不许再往里啃：正中间要留得住一整块大地形（见 topUpCore），
// 否则每对的侧翼路都从正中穿过，中场又成了「什么都没有」的十字路口。
const ROAD_CORE_GAP = Math.max(0, Number((WFData.roads && WFData.roads.coreGapCells) != null ? WFData.roads.coreGapCells : 16));
const ROAD_FIT_MAX = 1.35; // 幅度最多放大到名义值的这么多倍（空地有余时把路撑开）
// 挖掘半宽 = 名义半宽 + 栅格补偿：判定用的是「格子中心是否落在半径内」，
// 边缘那一圈会掉 0.5~0.7 格，不补的话写 16 格实测只有 15 格出头。
const ROAD_HALF = ROAD_W / 2 + 0.75;
// 侧翼 / 绕后那两条可以窄一些：它们走的是偷袭、包抄，不需要并排推大军。
// 这不是为了省事 —— 三条路都按正面主路的宽度铺，4 人局（4 对 × 3 条）的路网会吃掉
// 42% 的地图，主题预设的地形量（34%~39%）就再也塞不进去了（实测只能到 21%）。
// 让两条支路窄 5 格，走廊降到 33%，地形才补得回来。
const ROAD_SIDE_W = Math.max(8, Math.min(ROAD_W, Math.round((WFData.roads && WFData.roads.sideWidthCells) || 11)));
// 按角色给挖掘半宽（顺序跟 ROAD_ROLES / roadDepths 一致）
// 3 条：侧翼（窄）/ 正面（宽）/ 绕后（窄）；4 条（2 人局）：内 → 外 = 窄 / 宽 / 宽 / 窄
const ROAD_HALF_BY_ROLE = [ROAD_SIDE_W / 2 + 0.75, ROAD_HALF, ROAD_SIDE_W / 2 + 0.75];
const roadHalfOf = (per, k) => {
  if (per !== 4) return ROAD_HALF_BY_ROLE[Math.min(k, ROAD_HALF_BY_ROLE.length - 1)];
  return k === 1 || k === 2 ? ROAD_HALF : ROAD_SIDE_W / 2 + 0.75;
};

// ---- 中场关口：两家之间不许一马平川地直达（见 data.js 的 gates 段）----
// 每对相邻总部的**连线中点**上压一道横跨连线的大地形（山主题 = 台地山墙，水主题 = 内陆湖）：
//   · 正面主路只能从关口里挖出的那条峡谷穿过（两侧是山 / 水，天然的 bottleneck）；
//   · 侧翼 / 绕后两条主路从关口的内外两侧绕过去；
//   · 于是「总部 ↔ 总部」不再是一条笔直的大道 —— 要么挤关口、要么绕远路。
// 尺寸**自适应**：按「正面路的中点到旁边两条路还隔多远」来定跨度，写死的话
// 3 人局（弦中点离世界中心近、内侧空地小）会把侧翼路一起埋掉，那条路就不通了。
const GATE = WFData.gates || {};
// 跨度（格）：关口横跨两家连线的宽度 —— 越大越挡，但也越容易蹭到侧翼 / 绕后路
const GATE_SPAN = maxCell(GATE.spanCells, 54, 110);
// 跨度下限：两侧空地实在不够时也至少留这么宽（否则关口只剩一条缝，等于没有）
const GATE_MIN_SPAN = Math.min(maxCell(GATE.minSpanCells, 30, 80), GATE_SPAN);
// 厚度（格）：顺着两家连线方向的进深 —— 正面主路要打这么长一条隧道才穿得过去
const GATE_THICK = maxCell(GATE.thickCells, 26, 48);
const GATE_MIN_THICK = Math.min(maxCell(GATE.minThickCells, 16, 40), GATE_THICK);
// 形状用超椭圆：|u/a|^p + |v/b|^p ≤ 1。p = 3 是「带圆角的矩形台地 / 人工湖」
// （p = 1 是菱形，越大越接近纯矩形）—— 比纯矩形看着自然，又比椭圆规整。
const GATE_ROUND_P = clamp(Number(GATE.roundP != null ? GATE.roundP : 3), 1, 8);

// ---- 地形「参与度」：无效地形（没人去的地方）→ 有效地形（有争夺的地方）----
// 口径见 data.js 的 relevance 段注释。这里只做夹取与兜底，不写死数值。
const REL = WFData.relevance || {};
/** 离任一争夺点（总部 / 工厂 / 研究所）多少格以内 = 有人管 */
const REL_BUILDING_PAD = clamp(Number(REL.buildingPadCells != null ? REL.buildingPadCells : 26), 4, 80);
/** 离主路多少格以内 = 有人走（主路两侧正是打伏击的地方） */
const REL_ROAD_PAD = clamp(Number(REL.roadPadCells != null ? REL.roadPadCells : 14), 2, 60);
/** 补地形时工厂周边的禁笔半径（比选址采样半径 8 大一圈，别把新地形堆到工厂脸上） */
const REL_KEEP_PAD = Math.max(8, clamp(Number(REL.keepPadCells != null ? REL.keepPadCells : 14), 8, 40));
/** 一次最多搬走多少战局外的地形 */
const REL_TAKE = clamp(Number(REL.takeFrac != null ? REL.takeFrac : 0.9), 0, 1);
/** 战局内的空地最多被填到多少（填太满会堵住行军） */
const REL_FILL = clamp(Number(REL.fillMax != null ? REL.fillMax : 0.34), 0.05, 0.8);
/** 单局最多搬「全图地形」的多大比例 */
const REL_CAP = clamp(Number(REL.moveCap != null ? REL.moveCap : 0.5), 0, 0.6);
/** 切割的最小偏僻深度：贴着战局边界的那一圈留着当过渡（0 = 全剃光） */
const REL_EDGE = clamp(Math.round(Number(REL.edgeCells != null ? REL.edgeCells : 2)), 0, 40);
/** 搬迁 + 补回的轮数 */
const REL_ROUNDS = Math.max(1, Math.round(Number(REL.rounds != null ? REL.rounds : 2)));
/** 每轮补地形时 topUpLoop 的遍数（兜底用） */
const REL_PASSES = Math.max(1, Math.round(Number(REL.passes != null ? REL.passes : 2)));
/** 「偏僻深度」算到多少格就封顶（再远也一样远，桶排序的桶数） */
const REL_EXC_MAX = 160;

// ---- 地形高低差（由最终地形派生的坡地高度场，口径见 data.js 的 height 段）----
const HGT = WFData.height || {};
/** 高度层数：最终高度取 −levels..+levels 的整数 */
const HGT_LEVELS = Math.max(1, Math.round(Number(HGT.levels != null ? HGT.levels : 3)));
/** 每 1 层高低差 = ±多少**格**射程（格 → 像素走 cellsToPx） */
const HGT_STEP_PX = cellsToPx(Math.abs(Number(HGT.rangeCellsPerStep != null ? HGT.rangeCellsPerStep : 1)));
/** 坡度过渡半径（地形格）：山 / 水的高度往外摊多远 */
const HGT_SLOPE = Math.max(1, Math.round(Number(HGT.slopeCells != null ? HGT.slopeCells : 6)));
/** 模糊遍数（盒式模糊多遍 ≈ 高斯） */
const HGT_PASSES = Math.max(1, Math.round(Number(HGT.passes != null ? HGT.passes : 3)));
/** 山 / 水对高度场的贡献权重（山为正 → 高地，水为负 → 洼地） */
const HGT_MTN = Number(HGT.mountain != null ? HGT.mountain : 1);
const HGT_WAT = Number(HGT.water != null ? HGT.water : -1);
/** 归一化分位数（≥1 = 取全图最大值）：掐掉极端高峰，免得其它地方全被压成 0 层 */
const HGT_Q = Number(HGT.normQuantile != null ? HGT.normQuantile : 0.97);
/** 下发字符偏移：层 level → 字符 level + HGT_OFF（必须 ≥ levels，保证是 '0'~'9' 单字符） */
const HGT_OFF = Math.min(9, Math.max(HGT_LEVELS, Math.round(Number(HGT.serialOff != null ? HGT.serialOff : HGT_LEVELS))));
/** 台地档位间隔（层）：量化后的层再吸附到它的整数倍，档与档之间就是崖 */
const HGT_TERRACE = Math.max(1, Math.round(Number(HGT.terrace != null ? HGT.terrace : 2)));
/** 相邻两格层差 ≥ 此值 = 崖，部队过不去；层差 1 = 坡，可以上下 */
const HGT_CLIFF = Math.max(1, Math.round(Number(HGT.cliffAt != null ? HGT.cliffAt : HGT_TERRACE)));
/** 坡口：宽度（格，沿边界）、每块台地的最少/最多坡口数、每多少格再加一个 */
const HGT_RAMP_W = Math.max(1, Math.round(Number(HGT.rampWidth != null ? HGT.rampWidth : 3)));
const HGT_RAMP_MIN = Math.max(0, Math.round(Number(HGT.rampMin != null ? HGT.rampMin : 1)));
const HGT_RAMP_MAX = Math.max(HGT_RAMP_MIN, Math.round(Number(HGT.rampMaxPerPatch != null ? HGT.rampMaxPerPatch : 3)));
const HGT_RAMP_PER = Math.max(1, Number(HGT.rampPerCells != null ? HGT.rampPerCells : 900));
const HGT_RAMP_SPREAD = Number(HGT.rampSpread != null ? HGT.rampSpread : 1) !== 0;
/**
 * 坡肩外扩（格）：坡道沿边界方向向两侧各多铺这么多格，**只标记不改层**。
 *
 * ⚠️ 这是「坡看起来像地形而不是一条线」的关键：
 *    台阶带本身只有 w×(d−1) 格，实测每簇仅 3~5 格 —— 在 8 万格地图上、
 *    最远视角下（每格 3.6 屏幕像素）就是一条几乎看不见的细线。
 *    坡肩把它加宽成一条**连续的金色地带**，玩家一眼就能定位「这儿能上下」。
 */
const HGT_RAMP_GRIP = clamp(Math.round(Number(HGT.rampGrip != null ? HGT.rampGrip : 3)), 0, 12);

/** FNV-1a 字符串哈希，作为每局地形种子（与客户端算法一致） */
function hashStr(s) {
  let h = 2166136261 >>> 0;
  s = String(s);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/* ---------------- 地图主题 ---------------- */

/**
 * 主题里「山 / 水各占全图多少」的预设（mix）。
 * 没写就按 shapes 清单里两种地形的**面积权重**去分 maxBlocked ——
 * 这样山图元多的主题自然山多，但比例未必是设计者想要的，所以建议显式写。
 */
function fillMix(t, maxBlocked, shapes) {
  const raw = t && t.mix;
  let m = raw && raw.mountain != null ? Number(raw.mountain) : null;
  let w = raw && raw.water != null ? Number(raw.water) : null;
  if (!Number.isFinite(m) || !Number.isFinite(w)) {
    // 缺省：按清单里每种地形的「数量 × 单件面积」估个权重
    let sm = 0;
    let sw = 0;
    for (const s of shapes) {
      const a = shapeEstArea(s) * Math.max(0, shapeCountMax(s));
      if (s.type === 'water') sw += a;
      else sm += a;
    }
    const sum = sm + sw;
    const k = sum > 0 ? maxBlocked / sum : 0;
    m = Number.isFinite(m) ? m : sm * k;
    w = Number.isFinite(w) ? w : sw * k;
  }
  // 合计不许超过 maxBlocked（它是硬上限）：超了就等比压缩
  const sum = Math.max(0, m) + Math.max(0, w);
  if (sum > maxBlocked && sum > 0) {
    const k = maxBlocked / sum;
    m *= k;
    w *= k;
  }
  return { mountain: Math.max(0, m), water: Math.max(0, w) };
}

/** 主题柏林噪声参数补齐（缺字段落回 NOISE_FALLBACK） */
function fillNoise(t) {
  const raw = (t && t.noise) || {};
  const fb = NOISE_FALLBACK;
  return {
    scale: raw.scale != null ? Number(raw.scale) : fb.scale,
    octaves: raw.octaves != null ? Number(raw.octaves) : fb.octaves,
    persistance: raw.persistance != null ? Number(raw.persistance) : fb.persistance,
    lacunarity: raw.lacunarity != null ? Number(raw.lacunarity) : fb.lacunarity,
    offsetX: raw.offsetX != null ? Number(raw.offsetX) : fb.offsetX,
    offsetY: raw.offsetY != null ? Number(raw.offsetY) : fb.offsetY,
    bias: raw.bias != null ? String(raw.bias) : fb.bias,
  };
}

/** 把主题的字段补齐：主题里没写的就落回 THEME_FALLBACK（shapes 仍保留作兼容，主生成已改噪声） */
function fillTheme(t) {
  if (!t) return THEME_FALLBACK;
  const shapes = Array.isArray(t.shapes) && t.shapes.length ? t.shapes.map(fillShape) : THEME_FALLBACK.shapes;
  const mix = fillMix(t, t.maxBlocked == null ? THEME_BLOCKED_RAW : t.maxBlocked, shapes);
  // maxBlocked 是**硬上限**，必须盖得住 mix 的目标量：一个图元折回世界就有 1~2% 图幅，
  // 收尾时最后那一下的误差就有这么大（超级平原目标 11%、实测会到 14% 左右）。
  // 写的上限比「目标 + 余量」还低的话，clampBlocked 会把辛苦盖好的地形从边缘削掉。
  const maxBlocked = Math.max(
    t.maxBlocked == null ? THEME_BLOCKED_RAW : t.maxBlocked,
    (mix.mountain + mix.water) + 0.05
  );
  return {
    key: t.key || THEME_FALLBACK.key,
    name: t.name || THEME_FALLBACK.key,
    desc: t.desc || '',
    weight: t.weight == null ? THEME_FALLBACK.weight : t.weight,
    snap: t.snap == null ? THEME_FALLBACK.snap : t.snap,
    maxBlocked,
    mix,
    noise: fillNoise(t),
    core: {
      r: t.core && t.core.r != null ? t.core.r : CORE_FALLBACK.r,
      fill: t.core && t.core.fill != null ? t.core.fill : CORE_FALLBACK.fill,
      budget: t.core && t.core.budget != null ? t.core.budget : CORE_FALLBACK.budget,
    },
    shapes,
  };
}

/** 按 key 取主题（取不到返回 null，交给调用方兜底） */
function themeByKey(key) {
  if (!key) return null;
  for (const t of THEMES) if (t.key === key) return fillTheme(t);
  return null;
}

/**
 * 按种子加权随机抽一个主题：同一颗种子必出同一个主题（可复现），
 * 换房 / 换人 / 换时间 → 换主题。
 */
function pickTheme(seed) {
  if (!THEMES.length) return THEME_FALLBACK;
  let total = 0;
  for (const t of THEMES) total += Math.max(0, t.weight || 0);
  if (total <= 0) return fillTheme(THEMES[0]);
  let x = (seed >>> 0) % total;
  for (const t of THEMES) {
    x -= Math.max(0, t.weight || 0);
    if (x < 0) return fillTheme(t);
  }
  return fillTheme(THEMES[THEMES.length - 1]);
}

/** 数一数网格里有多少格不可通行（山 + 水） */
function countBlocked(grid) {
  let n = 0;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      const v = grid[r][c];
      if (v === TT_MOUNTAIN || v === TT_WATER) n++;
    }
  }
  return n;
}

/**
 * 从边缘往里削掉至多 need 格指定类型（同类邻居越少越先削），保持大块地形的形状。
 * 同类邻居阈值从 1 逐档放宽到 3：先削「细枝末节」，实在不够再啃实心边缘。
 * @returns {number} 实际削掉的格数
 */
function erodeType(grid, type, need) {
  const R = grid.length;
  if (!R || need <= 0) return 0;
  const C = grid[0].length;
  let got = 0;
  for (let thr = 1; thr <= 3 && got < need; thr++) {
    const marks = [];
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        if (grid[r][c] !== type) continue;
        let n = 0;
        if (r > 0 && grid[r - 1][c] === type) n++;
        if (r < R - 1 && grid[r + 1][c] === type) n++;
        if (c > 0 && grid[r][c - 1] === type) n++;
        if (c < C - 1 && grid[r][c + 1] === type) n++;
        if (n <= thr) marks.push([r, c, n]);
      }
    }
    if (!marks.length) continue;
    // 同类邻居少的先削：先掉的是细枝与毛边，大块本体留着
    marks.sort((a, b) => a[2] - b[2]);
    const take = Math.min(marks.length, need - got);
    for (let i = 0; i < take; i++) grid[marks[i][0]][marks[i][1]] = TT_PLAIN;
    got += take;
  }
  return got;
}

/**
 * 把「山 + 水」的合计覆盖率压到 cap 以内（超了会把多出来的部分从边缘削回平原）。
 * 先削**占比小的那类**，好让这局的主角地形（汪洋的水 / 群山的山）完整留下来。
 * 注意：这只保证不会出「走不动的图」；通道连通性由 ensureOpenTerrain 另行兜底。
 */
function clampBlocked(grid, cap) {
  const R = grid.length;
  if (!R) return;
  const total = R * grid[0].length;
  const limit = Math.floor(total * cap);
  for (let guard = 0; guard < 16; guard++) {
    const blocked = countBlocked(grid);
    if (blocked <= limit) return;
    const need = Math.ceil((blocked - limit) * 1.05) + 8;
    // 先削少的那个，不够再削多的那个
    let mtn = 0;
    let wat = 0;
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < grid[0].length; c++) {
        if (grid[r][c] === TT_MOUNTAIN) mtn++;
        else if (grid[r][c] === TT_WATER) wat++;
      }
    }
    const first = mtn <= wat ? TT_MOUNTAIN : TT_WATER;
    const second = first === TT_MOUNTAIN ? TT_WATER : TT_MOUNTAIN;
    const got = erodeType(grid, first, need) || 0;
    if (got < need) erodeType(grid, second, need - got);
  }
}

/* ---------------- 地图对称：N 重旋转 + N 条镜像轴（阶数 = 玩家人数）---------------- */
// 需求：地图要轴对称，而且对称的阶数跟着人数走 —— 2 人局 2 重、3 人局 3 重、4 人局 4 重。
//
// 世界是 11520×11520 的正方形、地形格是 40px 的方格。「绕中心转 90°」在正方形上刚好还是格子
// 对格子（4 人局严格无误差），但转 120°（3 人局）不会把格子转回格子，
// 所以这里不是把整张网格拿去旋转，而是**折叠采样**：
//   ① 先在一张「半扇区楔形」母图上盖好图元（母图坐标系与世界同轴 → 墙仍然是笔直的）；
//   ② 世界每个格子按极坐标折回这个楔形去查表：先减掉 k×2π/N 落进 [0, 2π/N)，
//      再沿 π/N 那条射线镜像到 [0, π/N]。
// 折回的是**连续坐标**，所以任意一点都能查到值（不存在「转出去就没地形」的空角），
// 整张图同时满足「旋转 2π/N 不变」与「沿 N 条轴镜像不变」（二面体群 D_N）：
// 每家门口的地形、到中心的距离、与主路的相对位置都完全一样。
const SYM_MIN_N = 2;
const SYM_MAX_N = 4;
// 楔形母图的半径（格）：世界角点到中心的距离，再留点余量给图元厚度。
// 只要覆盖到这个半径，世界上任何一格折回来都落在母图内。
const WEDGE_R = Math.ceil(Math.hypot(TERR_COLS / 2, TERR_ROWS / 2)) + 4;

/** 对称阶数 = 玩家人数（2/3/4 人 → 2/3/4 重旋转） */
function symOrder(count) {
  const n = Math.round(Number(count) || SYM_MIN_N);
  return clamp(n, SYM_MIN_N, SYM_MAX_N);
}

/** 楔形母图的尺寸（格）：宽 = 半径，高 = 半径 × sin(π/N)（半扇区的外接矩形） */
function wedgeDims(n) {
  const cols = WEDGE_R + 2;
  const rows = Math.max(8, Math.ceil(WEDGE_R * Math.sin(Math.PI / symOrder(n))) + 2);
  return { rows, cols };
}

/** 绕世界中心旋转 k × (2π/n) */
function rotateAround(x, y, k, n) {
  const a = (k * Math.PI * 2) / symOrder(n);
  const dx = x - WORLD_W / 2;
  const dy = y - WORLD_H / 2;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return { x: WORLD_W / 2 + dx * ca - dy * sa, y: WORLD_H / 2 + dx * sa + dy * ca };
}

/** 绕世界中心的 C_N 轨道：n 个点，等角间隔（总部 / 工厂 / 研究所都按它成对成组地摆） */
function symOrbit(x, y, n) {
  const out = [];
  for (let k = 0; k < symOrder(n); k++) out.push(rotateAround(x, y, k, n));
  return out;
}

/**
 * 把世界坐标折回楔形母图的**局部坐标**（相对世界中心的偏移，单位 px）。
 * 先减去 k×2π/N 落进 [0, 2π/N)，再沿 π/N 的射线镜像到 [0, π/N]。
 * @returns {number[]} [u, v]：u ≥ 0、v ≥ 0（恒在第一象限的楔形里）
 */
function foldToWedge(x, y, n) {
  const dx = x - WORLD_W / 2;
  const dy = y - WORLD_H / 2;
  const rr = Math.hypot(dx, dy);
  if (rr < 1e-6) return [0, 0];
  const step = (Math.PI * 2) / symOrder(n);
  let phi = Math.atan2(dy, dx);
  if (phi < 0) phi += Math.PI * 2;
  let f = phi % step;
  if (f > step / 2) f = step - f;
  return [rr * Math.cos(f), rr * Math.sin(f)];
}

/**
 * 楔形母图每一格**等价于世界里多少格** —— 也就是这条 D_N 轨道有幾個像落在图内
 * （贴着地图角上的轨道，2N 个像里有一半落在图外，只值 2~3 格；正中间的则值满 2N 格）。
 *
 * 地形额度必须按它**加权**，不能按「楔形格数」平摊：把地形盖在角上会吃掉同样的额度，
 * 玩家却只看到一半 —— 3 人局的平原主题实测能差出一倍多（楔形里 7.8%，世界只剩 3.3%）。
 * @returns {{used:number[], wt:Int32Array, total:number}} 有权重的格子清单、权重表、世界总格数
 */
function wedgeWeights(order, dim) {
  const m = wedgeMap(order);
  return { used: m.used, wt: m.wt, total: m.total };
}

/**
 * 「世界格 ↔ 楔形格」的映射表 —— **按对称阶数缓存**，只算一次。
 *
 * 为什么需要它：补地形、对称化、折回/展开母图每一步都要把 8 万多个格子折回楔形一次
 * （foldToWedge 里有 hypot / atan2 / 三角函数），而单局要跑十几遍 —— 光这一步就上百万次
 * 三角运算，实测占掉单局生成的一半耗时（921ms 里的约 460ms）。映射只跟 order 有关
 * （世界尺寸固定），所以算一次存起来复用。
 *
 * 存三样：
 *   orbit  世界格 → 楔形格序号（wr×cols+wc），-1 = 折不进母图（当平原）
 *   wt     楔形格 → 这条 D_N 轨道在世界里值几格（地形额度按它加权，见 wedgeWeights）
 *   轨道 → 世界格清单（CSR 摊平：gStart/gCells），给对称化按轨道分组用
 */
const WEDGE_CACHE = new Map();
function wedgeMap(order) {
  const n = symOrder(order);
  const hit = WEDGE_CACHE.get(n);
  if (hit) return hit;
  const dim = wedgeDims(n);
  const N = TERR_ROWS * TERR_COLS;
  const K = dim.rows * dim.cols;
  const orbit = new Int32Array(N).fill(-1);
  const wt = new Int32Array(K);
  for (let r = 0; r < TERR_ROWS; r++) {
    const py = (r + 0.5) * TERR_CELL;
    for (let c = 0; c < TERR_COLS; c++) {
      const at = wedgeCellAt((c + 0.5) * TERR_CELL, py, n, dim);
      if (!at) continue;
      const k = at[0] * dim.cols + at[1];
      orbit[r * TERR_COLS + c] = k;
      wt[k]++;
    }
  }
  // 轨道 → 成员格（CSR：先数一遍，再摊进一条 Int32Array，避免 4 万个小数组）
  const gStart = new Int32Array(K + 1);
  for (let i = 0; i < N; i++) if (orbit[i] >= 0) gStart[orbit[i] + 1]++;
  for (let i = 0; i < K; i++) gStart[i + 1] += gStart[i];
  const gCells = new Int32Array(N);
  const cur = gStart.slice(0, K);
  for (let i = 0; i < N; i++) {
    const k = orbit[i];
    if (k >= 0) gCells[cur[k]++] = i;
  }
  const used = [];
  let total = 0;
  for (let i = 0; i < K; i++) {
    if (wt[i] > 0) {
      used.push(i);
      total += wt[i];
    }
  }
  const m = { n, dim, orbit, wt, gStart, gCells, used, total };
  WEDGE_CACHE.set(n, m);
  return m;
}

/** 世界某格（中心像素坐标）在楔形母图里对应哪一格；落在母图外返回 null（当平原处理） */
function wedgeCellAt(x, y, n, dim) {
  const p = foldToWedge(x, y, n);
  const wc = Math.floor(p[0] / TERR_CELL);
  const wr = Math.floor(p[1] / TERR_CELL);
  if (wr < 0 || wc < 0 || wr >= dim.rows || wc >= dim.cols) return null;
  return [wr, wc];
}

/**
 * 生成地形网格（D_N 对称：N 重旋转 + N 条镜像轴，N = 玩家人数）。
 *
 * 算法分两步：
 *   ① **楔形母图**：在「半扇区」的外接矩形上，按主题的 shapes 清单盖规整图元
 *      （笔直长墙 / 矩形山块 / 椭圆湖泊 / 环形山）。母图与世界同轴，所以图元仍是
 *      轴对齐的，墙是横平竖直的；图元数量按「楔形面积 ÷ 整图面积」缩放，
 *      免得密度翻倍后被 maxBlocked 整块撤掉一半（白画）。
 *   ② **折叠采样**：世界每格按 foldToWedge 折回楔形查表 → 整图自动带上 D_N 对称。
 * 覆盖率由主题的 maxBlocked 封顶：超了就**整块撤掉最后盖的图元**（而不是从边缘啃），
 * 所以留下来的图元形状始终是完整的。
 *
 * @param {() => number} rng 随机源
 * @param {object} [theme] 地图主题（fillTheme 补齐过的）；不传则用兜底参数
 * @param {number} [n] 对称阶数（= 玩家人数 2/3/4），缺省 4
 * @returns {number[][]} grid[r][c] ∈ {0,2,4}
 */
/**
 * 按主题 bias 微调噪声场（在分位阈值之前）。
 * 高值 → 山、低值 → 水（与 paintWedgeByNoise 一致）。
 */
function applyNoiseBias(noiseMap, dim, bias) {
  if (!bias || bias === 'none') return;
  const cols = dim.cols;
  const rows = dim.rows;
  const halfPx = Math.min(WORLD_W, WORLD_H) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rn = Math.hypot((c + 0.5) * TERR_CELL, (r + 0.5) * TERR_CELL) / halfPx;
      let v = noiseMap[c][r];
      if (bias === 'centerWater') {
        // 中心压低噪声 → 更容易成水（汪洋）
        const k = clamp(1 - rn * 1.1, 0, 1);
        v = v * (1 - 0.55 * k);
      } else if (bias === 'ringMountain') {
        // 环形带抬高噪声 → 环形山
        const band = Math.exp(-((rn - 0.38) * (rn - 0.38)) / (2 * 0.09 * 0.09));
        v = v * (1 - 0.35 * band) + band * 0.95;
      } else if (bias === 'stretchH') {
        // 横纹感：叠加低频竖向波（壁垒）
        v = clamp(v * 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(r / 7)), 0, 1);
      } else if (bias === 'stretchV') {
        // 纵纹感（裂谷）
        v = clamp(v * 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(c / 7)), 0, 1);
      } else if (bias === 'cornerMountain') {
        // 角上抬高（群山 / 超级平原保底起伏）
        const corner = Math.max(rn - 0.75, 0) / 0.35;
        v = clamp(v + corner * 0.35, 0, 1);
      }
      noiseMap[c][r] = v;
    }
  }
}

/**
 * 把楔形噪声场按 mix 分位阈值成山 / 水 / 平原。
 * 高噪声 → 山、低噪声 → 水；额度按 wt 加权，贴 th.mix。
 * @returns {Float32Array} 楔形线性噪声（供 topUp 继续按噪声补）
 */
function paintWedgeByNoise(wedge, noiseMap, dim, used, wt, total, mixM, mixW) {
  const cols = dim.cols;
  const flat = new Float32Array(dim.rows * cols);
  for (let r = 0; r < dim.rows; r++) {
    for (let c = 0; c < cols; c++) {
      flat[r * cols + c] = noiseMap[c][r];
      wedge[r][c] = TT_PLAIN;
    }
  }
  const items = new Array(used.length);
  for (let k = 0; k < used.length; k++) {
    const i = used[k];
    items[k] = { i, n: flat[i], w: wt[i] };
  }
  const wantM = total * Math.max(0, mixM);
  const wantW = total * Math.max(0, mixW);

  items.sort((a, b) => b.n - a.n);
  let gotM = 0;
  for (let k = 0; k < items.length && gotM < wantM; k++) {
    const it = items[k];
    const r = (it.i / cols) | 0;
    const c = it.i % cols;
    wedge[r][c] = TT_MOUNTAIN;
    gotM += it.w;
  }

  items.sort((a, b) => a.n - b.n);
  let gotW = 0;
  for (let k = 0; k < items.length && gotW < wantW; k++) {
    const it = items[k];
    const r = (it.i / cols) | 0;
    const c = it.i % cols;
    if (wedge[r][c] !== TT_PLAIN) continue;
    wedge[r][c] = TT_WATER;
    gotW += it.w;
  }
  return flat;
}

/**
 * 在候选平原格上按噪声继续「晋升」为山 / 水，补到目标加权格数。
 * @returns {{addedM:number, addedW:number}}
 */
function promoteNoiseOnWedge(wedge, noiseFlat, dim, wt, candidates, addM, addW) {
  const cols = dim.cols;
  const plains = [];
  for (let k = 0; k < candidates.length; k++) {
    const i = candidates[k];
    const r = (i / cols) | 0;
    const c = i % cols;
    if (wedge[r][c] !== TT_PLAIN) continue;
    plains.push({ i, n: noiseFlat[i], w: wt[i] });
  }
  let addedM = 0;
  let addedW = 0;
  if (addM > 0) {
    plains.sort((a, b) => b.n - a.n);
    for (let k = 0; k < plains.length && addedM < addM; k++) {
      const it = plains[k];
      const r = (it.i / cols) | 0;
      const c = it.i % cols;
      if (wedge[r][c] !== TT_PLAIN) continue;
      wedge[r][c] = TT_MOUNTAIN;
      addedM += it.w;
    }
  }
  if (addW > 0) {
    plains.sort((a, b) => a.n - b.n);
    for (let k = 0; k < plains.length && addedW < addW; k++) {
      const it = plains[k];
      const r = (it.i / cols) | 0;
      const c = it.i % cols;
      if (wedge[r][c] !== TT_PLAIN) continue;
      wedge[r][c] = TT_WATER;
      addedW += it.w;
    }
  }
  return { addedM, addedW };
}

/**
 * 用柏林噪声生成整张地形网格（D_N 对称：噪声画在楔形上再折叠展开）。
 * 算法来自 https://gitee.com/sli97/pcg（generateNoiseMap + 分位阈值）。
 * @param {object} [out] 可选：写入 { noise, noiseSeed } 供补地形复用
 */
function generateTerrainGrid(rng, theme, n, out) {
  const th = theme && theme.mix ? theme : fillTheme(theme);
  const order = symOrder(n == null ? SYM_MAX_N : n);
  const dim = wedgeDims(order);

  // ① 楔形母图：整片平原起步
  const wedge = [];
  for (let r = 0; r < dim.rows; r++) wedge[r] = new Array(dim.cols).fill(TT_PLAIN);
  // 楔形是「半扇区」的外接矩形，矩形里有相当一部分**永远采样不到** ——
  // 额度按「这一格在世界里值几格」加权（wedgeWeights），直接等于世界格数。
  const { used, wt, total } = wedgeWeights(order, dim);
  const nc = th.noise || NOISE_FALLBACK;
  // 种子来自本局 rng，保证可复现
  const noiseSeed = Math.max(1, Math.floor((rng() * 0xfffffe) + 1));
  // stretch 主题：采样尺度在某一轴上拉长（壁垒横纹 / 裂谷纵纹）
  let scale = Math.max(4, Number(nc.scale) || 40);
  let offsetX = Number(nc.offsetX) || 0;
  let offsetY = Number(nc.offsetY) || 0;
  if (nc.bias === 'stretchH') scale = Math.max(scale, 55);
  if (nc.bias === 'stretchV') scale = Math.max(scale, 55);
  const noiseMap = WFPerlin.generateNoiseMap(
    dim.cols,
    dim.rows,
    noiseSeed,
    scale,
    nc.octaves,
    nc.persistance,
    nc.lacunarity,
    { x: offsetX, y: offsetY }
  );
  applyNoiseBias(noiseMap, dim, nc.bias);
  const noiseFlat = paintWedgeByNoise(
    wedge,
    noiseMap,
    dim,
    used,
    wt,
    total,
    th.mix.mountain,
    th.mix.water
  );
  // 硬上限：噪声分位已经贴 mix，一般不会超；仍兜底一次
  clampBlocked(wedge, th.maxBlocked);

  if (out) {
    out.noise = noiseFlat;
    out.noiseSeed = noiseSeed;
  }
  // ② 折叠采样出整张世界图
  return renderWorldFromWedge(wedge, order, dim);
}

/** 主题的 shapes 清单 → 「每种盖几个」的计划表 */
function shapePlan(rng, shapes) {
  return (shapes || []).map((cfg) => {
    const raw = rngRange(rng, cfg.count, SHAPE_DEFAULTS[cfg.kind].count);
    const cnt = Math.max(raw >= 1 ? 1 : 0, Math.round(raw));
    return { cfg, cnt, base: cnt, done: 0 };
  });
}

/**
 * 按计划表反复往楔形母图上盖章，直到「会落到世界里的格子」里不可通行数达到 target。
 *
 * 比「按面积缩放图元数量」稳：后者会随楔形的高矮（N 越大楔形越扁）忽高忽低，
 * 各主题的地形量对不上号。盖章顺序是**轮转**的（山、水、山、水…）：
 * 超额时 clampShapes 从末尾撤，撤掉的是各种图元各一点；若按清单顺序盖，
 * 山写在前面会先把额度占满，末尾的水被整批撤掉 —— 「标着有湖，实际一滴水都没有」。
 *
 * @param {Uint8Array} [ok] 落笔白名单（给了就只画 ok[i]===1 的格子，见 putCell）
 * @param {Set<number>} [keep] 记录「不许撤」的图元序号（锚点图元）
 * @returns {number} 下一个可用的图元序号
 */
function runStamps(wedge, own, dim, used, wt, rng, plan, snap, order, target, ok, keep, zone, mix, showcase) {
  let id = 0;
  // 覆盖量按 wt 加权（= 世界里实际的不可通行格数），见 wedgeWeights。
  // 给了 mix 就**山、水各数各的**：两种地形各有自己的目标占比，谁先到谁先停 ——
  // 否则山图元大的主题会把额度先抢光，水就只剩零头（「标着有湖，实际一滴水都没有」）。
  // 覆盖量**增量维护**：putCell 落笔时直接加减（cnt.m / cnt.w），不用每盖一个图元就
  // 全表重扫一遍 —— 那样单局生成要 700ms。开局扫一次作为初值即可。
  const cnt = { wt, m: 0, w: 0 };
  for (const i of used) {
    const v = wedge[(i / dim.cols) | 0][i % dim.cols];
    if (v === TT_MOUNTAIN) cnt.m += wt[i];
    else if (v === TT_WATER) cnt.w += wt[i];
  }
  const tOf = (type) => (type === 'water' ? TT_WATER : TT_MOUNTAIN);
  const wantOf = (type) => (mix ? (type === 'water' ? mix.water : mix.mountain) : 0);
  const curOf = (type) => (type === 'water' ? cnt.w : cnt.m);
  const curTotal = () => cnt.m + cnt.w;
  const typeFull = (type) => (mix ? curOf(type) >= wantOf(type) : false);
  // 一个图元在楔形里只画一次，折回世界却有 2N 个像 —— 它在「世界里值多少格」要乘上
  // 平均权重倍率，用单件面积去判断会不会超额会差好几倍。
  const wtScale = (() => {
    let t = 0;
    for (const i of used) t += wt[i];
    return t / Math.max(1, used.length);
  })();
  // 超额容忍度：图元最小也有 1~2% 图幅，卡太死就永远盖不满，1.08 是实测合适的档
  const OVER_TOL = 1.08;
  const totalFull = () => (mix ? typeFull('mountain') && typeFull('water') : curTotal() >= target);
  // 进度（0~1）：收尾阶段要挑小图元，得先知道还差多少
  const progress = () => {
    if (mix) {
      const wm = Math.max(1, wantOf('mountain'));
      const ww = Math.max(1, wantOf('water'));
      return Math.min(curOf('mountain') / wm, curOf('water') / ww);
    }
    return curTotal() / Math.max(1, target);
  };
  // 撤销刚才那一个图元（undo 里记着它每格的旧值）：补地形时图元常常被主路走廊 /
  // 建筑清场圈切掉一大半，剩下那点边角就是**小山小湖**，必须整个撤销、换个地方重画。
  const undoLast = () => {
    if (!cnt.undo) return;
    for (let k = 0; k < cnt.undo.length; k += 2) {
      const i = cnt.undo[k];
      const old = cnt.undo[k + 1];
      const r = (i / dim.cols) | 0;
      const c = i % dim.cols;
      const w = wt[i] || 0;
      const cur = wedge[r][c];
      if (cur === TT_MOUNTAIN) cnt.m -= w;
      else if (cur === TT_WATER) cnt.w -= w;
      if (old === TT_MOUNTAIN) cnt.m += w;
      else if (old === TT_WATER) cnt.w += w;
      wedge[r][c] = old;
      own[i] = -1;
    }
    cnt.undo.length = 0;
  };
  const stamp = (p, cfgOverride) => {
    const cfg = cfgOverride || p.cfg;
    if (cfg.at && keep) keep.add(id);
    const est = shapeEstArea(cfg);
    // 有落笔白名单时最多试 3 个位置：落笔不足预估的 55% 说明这个图元大半压在
    // 走廊 / 清场圈上，画出来只剩几个碎格 —— 撤销重画，别留一地碎屑。
    const tries = ok ? 3 : 1;
    for (let t = 0; t < tries; t++) {
      cnt.undo = ok ? [] : null;
      drawStamp(wedge, own, id++, rng, cfg, dim.rows, dim.cols, snap, order, ok, zone, cnt);
      if (!ok || cnt.undo.length >= est * 0.55) break;
      undoLast();
    }
    cnt.undo = null;
    p.done++;
  };
  // 锚点图元**先盖**：它们不占「轮转补额度」的名额，也不会因为额度被别的图元抢光而
  // 轮不上（额度是先到先得的 —— 若按清单顺序盖，前面几个大图元就能把额度吃满，
  // 保底的那块反而被 clampShapes 从末尾整块撤掉，地形量直接归零）。
  const ordered = plan.filter((p) => p.cfg.at).concat(plan.filter((p) => !p.cfg.at));
  // ① 每种图元先各露一次脸（山归山、湖归湖），之后才轮转着边盖边看额度。
  //    只在**从零开始画图**时才这么干（showcase）：补地形的时候缺口可能只有 1%，
  //    每种都露一次脸反而会整块超额（实测超级平原补完 15.6%，而预设只有 11%）。
  if (showcase) for (const p of ordered) if (p.cnt > 0) stamp(p);
  // ② 一直盖到额度为止：额度没到就轮转补，清单盖完了就给「非独苗」图元各再加一轮。
  //    注意这里**不能**写成「每轮每种只盖 1 个、最多 N 轮」—— 那样图元小、数量多的主题
  //    （千湖泽国 26 个小圆湖）会在轮数用尽时只填到额度的四成，地形量平白少一大截。
  // 安全阀：图元极小 / maxBlocked 写得极大时不至于跑飞。
  // 三条主路铺开之后走廊要吃掉三分之一张图，补地形得按存活率把额度成倍放大
  // （见 topUpTerrain 的 loss），目标量常常是「整张图的八九成」；
  // 而收尾阶段为了不超额会改用小图元（见下面的 sort），一个只有几十格 ——
  // 600 次根本盖不到目标（实测只能到预设的七成），放宽到 2500 才够。
  const MAX_STAMPS = 600;
  for (let guard = 0; guard < MAX_STAMPS && !totalFull(); guard++) {
    // 快到额度时**先盖小的**：图元一旦变大，最后那一下很容易整块超额
    // （一个 74 格的内海就是 6% 图幅），用小图元收尾能把误差压到零点几个百分点。
    const list = progress() >= 0.72 ? ordered.slice().sort((a, b) => shapeEstArea(a.cfg) - shapeEstArea(b.cfg)) : ordered;
    let drew = false;
    // 两遍：① 挑食（盖下去会明显超额就先跳过这个图元，换小的）；
    //       ② 若①一个都没盖成（说明剩下的图元都太大），就不再挑食，盖最小的那个 ——
    //          否则「谁都超额 → 谁都不盖」，额度永远填不满。
    for (let pass = 0; pass < 2 && !drew && !totalFull(); pass++) {
      const forced = pass === 1;
      for (const p of list) {
        if (p.done >= p.cnt) continue;
        if (mix && typeFull(p.cfg.type)) continue; // 这种地形已经够了，别再盖
        let cfg = p.cfg;
        if (mix) {
          const w = wantOf(p.cfg.type);
          if (w > 0) {
            const room = Math.max(0, w - curOf(p.cfg.type)); // 这种地形还剩多少额度
            const est = shapeEstArea(p.cfg) * wtScale;
            // 兜底那一遍（forced）放宽到 1.7 倍：这时候剩下的图元全太大，
            // 卡 1.08 就一个都盖不成、额度永远差一截；1.7 倍落在 ±3 个点的容差里。
            const tol = forced ? 1.7 : OVER_TOL;
            if (est > room * tol) {
              // 整块盖下去会超额 → **缩到刚好塞得下**（详见 shrinkShape）。
              // 缩不动（已经贴着 SHAPE_MIN_AREA 的下限）就换下一个图元 ——
              // 宁可差一点点也别整块顶过预设。
              const fit = shrinkShape(p.cfg, (room * tol) / Math.max(1, est));
              if (fit === p.cfg) continue;
              cfg = fit;
            }
          }
        }
        stamp(p, cfg);
        drew = true;
        if (totalFull()) break;
      }
    }
    if (!drew) {
      // 清单都盖完了还没到额度 → 非「独苗」图元（count > 1）各再加一轮
      let more = false;
      for (const p of plan) {
        if (shapeCountMax(p.cfg) > 1 && (!mix || !typeFull(p.cfg.type))) {
          p.cnt += p.base;
          more = true;
        }
      }
      if (!more) break; // 全是「只画一个」的图元（环形山之类），盖完就收工
    }
  }
  return id;
}

/** 楔形母图 → 世界地形图（折叠采样，见 generateTerrainGrid 步骤 ②） */
function renderWorldFromWedge(wedge, order, dim) {
  const m = wedgeMap(order);
  const cols = m.dim.cols;
  const grid = [];
  for (let r = 0; r < TERR_ROWS; r++) {
    grid[r] = new Array(TERR_COLS);
    const base = r * TERR_COLS;
    for (let c = 0; c < TERR_COLS; c++) {
      const k = m.orbit[base + c];
      grid[r][c] = k < 0 ? TT_PLAIN : wedge[(k / cols) | 0][k % cols];
    }
  }
  return grid;
}

/**
 * 世界地形图 → 楔形母图（每条 D_N 轨道取多数）。
 * 只在「整图已经重新对齐过对称」之后调用才有意义：那时每条轨道内部取值一致，
 * 折回去得到的楔形再展开就能还原整图。补地形要靠它回到楔形坐标系里继续盖章。
 */
function wedgeFromWorld(grid, order, dim) {
  const m = wedgeMap(order);
  const cols = m.dim.cols;
  const wedge = [];
  for (let r = 0; r < m.dim.rows; r++) wedge[r] = new Array(cols).fill(TT_PLAIN);
  const K = m.dim.rows * cols;
  const open = new Int32Array(K);
  const mtn = new Int32Array(K);
  const wat = new Int32Array(K);
  const orbit = m.orbit;
  for (let i = 0; i < orbit.length; i++) {
    const k = orbit[i];
    if (k < 0) continue;
    const v = grid[(i / TERR_COLS) | 0][i % TERR_COLS];
    if (v === TT_PLAIN) open[k]++;
    else if (v === TT_MOUNTAIN) mtn[k]++;
    else wat[k]++;
  }
  for (let k = 0; k < K; k++) {
    const tot = open[k] + mtn[k] + wat[k];
    if (!tot || open[k] * 2 >= tot) continue; // 平原过半 → 仍是平原
    wedge[(k / cols) | 0][k % cols] = mtn[k] >= wat[k] ? TT_MOUNTAIN : TT_WATER;
  }
  return wedge;
}

// 「补地形」时，可落笔的空地最多填到这个比例 —— 主路很宽（4 人局能占掉六成图），
// 若按主题的 maxBlocked 硬塞满剩下的空地，那片空地会被塞成一整块实心山，看着更假。
const TOP_UP_FILL = 0.82;
// 收尾损耗补偿：补完地形之后还有「清碎块 / 连通开道 / 最后再挖一遍主路」这几刀，
// 实测能把地形再削掉 15%~25%（清碎块一刀就吃掉 4~7 个点）。补的时候按这个系数
// 多补一点，落下来才正好是主题的预设占比 —— 不然永远停在预设的七八成。
const TOP_UP_CLEAN_K = 1.22;

/**
 * 主路 / 隔离带 / 建筑清场都挖完之后，把地形**补回**到这个主题该有的量。
 *
 * 为什么需要这一步：主路是「相邻两家之间的 3 条 ≥15 格宽大道」，4 人局四条弦加起来
 * 能吃掉六成地图 —— 生成时按 maxBlocked 盖好的地形，挖完路常常只剩个零头
 * （实测经典地貌 24.5% → 6.3%），整张图看着就是一块白板。
 * 但额度不能靠「生成时多盖」来补：多盖的部分照样会被路吃掉，纯属浪费。
 *
 * 所以改成**挖完路再补**，而且只补在「路够不到」的地方：
 *   ① 把主路重挖在一张「整片不可通行」的图上 → 还是平的地方就是走廊；
 *   ② 走廊 / 建筑清场圈 / 隔离带折回楔形 → 这些轨道一条都不许再落笔
 *      （对称化之后整条轨道同值，堵住一个像就是把一条路堵死）；
 *   ③ 由当前世界图还原楔形母图，只盖在剩下的空地上，直到达到主题的量；
 *   ④ 折回世界。调用方随后会再跑一遍清场 / 隔离带 / 主路 / 连通性兜底，
 *      所以②的掩膜只需大致准确，不必严丝合缝。
 *
 * @returns {boolean} 是否真的补了（额度已经够了就 false）
 */
/**
 * 「补地形」用的禁笔区：折回楔形后的那条 D_N 轨道**一条都不许再落笔**。
 *
 * 包含 ① 主路走廊、② 建筑清场圈、③ 两家之间的隔离带 —— 这三样随后都还会再挖一遍，
 * 画上去纯属浪费额度（而且对称化之后整条轨道同值，堵一个像就是堵一条路）。
 *
 * @param {Uint8Array[]} [extra] 额外的世界掩膜（1 = 也不许画），用于「连通性挖开的通道」
 * @returns {Uint8Array} 楔形格索引 → 1 = 不许画
 */
function bannedWedgeCells(game, order, dim, extra) {
  const gen = game._mapGen;
  // ① 世界掩膜：这些格子必须保持可通行
  const mask = [];
  for (let r = 0; r < TERR_ROWS; r++) mask[r] = new Uint8Array(TERR_COLS);
  // 主路走廊：把路挖在一张「整片山地」的图上，凡是被挖平的就是走廊
  const corr = [];
  for (let r = 0; r < TERR_ROWS; r++) corr[r] = new Array(TERR_COLS).fill(TT_MOUNTAIN);
  carveMainRoads(corr, game.hqs, order);
  for (let r = 0; r < TERR_ROWS; r++) {
    for (let c = 0; c < TERR_COLS; c++) if (corr[r][c] === TT_PLAIN) mask[r][c] = 1;
  }
  // 建筑清场圈（随后还会再清一遍，画上去也是白画）
  const markAround = (bx, by) => {
    if (!Number.isFinite(bx) || !Number.isFinite(by)) return;
    const cc = Math.floor(bx / TERR_CELL);
    const cr = Math.floor(by / TERR_CELL);
    for (let r = cr - TERRAIN_CLEAR_CELLS; r <= cr + TERRAIN_CLEAR_CELLS; r++) {
      if (r < 0 || r >= TERR_ROWS) continue;
      for (let c = cc - TERRAIN_CLEAR_CELLS; c <= cc + TERRAIN_CLEAR_CELLS; c++) {
        if (c < 0 || c >= TERR_COLS) continue;
        mask[r][c] = 1;
      }
    }
  };
  for (const f of game.factories || []) markAround(f.x, f.y);
  for (const l of game.labs || []) markAround(l.x, l.y);
  for (const h of game.hqs) markAround(h.x, h.y);
  // 隔离带：两家出生区之间的缓冲区，同样随后会再清一遍
  if (gen.bands && gen.bands.length) {
    for (let r = 0; r < TERR_ROWS; r++) {
      const y = (r + 0.5) * TERR_CELL;
      for (let c = 0; c < TERR_COLS; c++) {
        if (!mask[r][c] && inIsolationBand(gen.bands, (c + 0.5) * TERR_CELL, y)) mask[r][c] = 1;
      }
    }
  }
  if (extra) {
    for (let r = 0; r < TERR_ROWS; r++) {
      if (!extra[r]) continue;
      for (let c = 0; c < TERR_COLS; c++) if (extra[r][c]) mask[r][c] = 1;
    }
  }
  // ② 折回楔形（映射表已按 order 缓存，见 wedgeMap）
  const m = wedgeMap(order);
  const banned = new Uint8Array(m.dim.rows * m.dim.cols);
  for (let r = 0; r < TERR_ROWS; r++) {
    const base = r * TERR_COLS;
    for (let c = 0; c < TERR_COLS; c++) {
      if (!mask[r][c]) continue;
      const k = m.orbit[base + c];
      if (k >= 0) banned[k] = 1;
    }
  }
  let mk = 0;
  for (let r = 0; r < TERR_ROWS; r++) for (let c = 0; c < TERR_COLS; c++) if (mask[r][c]) mk++;
  gen.corrFrac = mk / (TERR_ROWS * TERR_COLS);
  return banned;
}

/**
 * 山 + 水合计不许超过主题的硬上限 maxBlocked。
 *
 * 两种地形各有各的目标（mix），补地形又要按存活率把额度**成倍放大**（盖在走廊上的那一半
 * 随后会被挖掉），单看某一类都不超额、加起来却可能冲过上限 —— 实测汪洋（上限 45%）
 * 能冲到 51.6%。所以放大之后要再按合计封一次顶（按比例缩回去）。
 */
function capMixSum(mix, cap) {
  const sum = mix.mountain + mix.water;
  if (!(cap > 0) || !(sum > cap)) return mix;
  const f = cap / sum;
  mix.mountain *= f;
  mix.water *= f;
  return mix;
}

/**
 * 楔形母图里山 / 水各占「世界里多少格」（按 wt 加权）—— 这是**重挖走廊之前**的量，
 * 跟重挖之后的世界实际量一比，就能算出这一轮补的地形有多少活下来了（见 topUpLoop）。
 */
function wedgeMixCount(wedge, dim, used, wt) {
  let m = 0;
  let w = 0;
  for (const i of used) {
    const v = wedge[(i / dim.cols) | 0][i % dim.cols];
    if (v === TT_MOUNTAIN) m += wt[i];
    else if (v === TT_WATER) w += wt[i];
  }
  return { m, w };
}

/** 世界地形图里山 / 水各占多少格（重挖走廊之后的实际量） */
function worldMixCount(grid) {
  let m = 0;
  let w = 0;
  for (let r = 0; r < TERR_ROWS; r++) {
    for (let c = 0; c < TERR_COLS; c++) {
      const v = grid[r][c];
      if (v === TT_MOUNTAIN) m++;
      else if (v === TT_WATER) w++;
    }
  }
  return { m, w };
}

/**
 * 走廊掩膜折回楔形 → 落笔白名单（1 = 可以画）。
 *
 * 之前补地形是「整块盖下去、压在走廊上的那部分随后被重挖掉」，再按实测存活率把额度
 * 成倍放大来凑数 —— 三条主路铺开后走廊要吃掉三分之一张图，这条路子既浪费（盖两倍
 * 留一半）又极不稳（同一主题实测 8%~30% 乱跳）。改成**只画走廊以外**：存活率恒为 1，
 * 额度就是缺口本身。走廊是连成片的宽带，图元被它切出来的断面依旧是大块，
 * 剩下零碎的边角由 clearTinyBlobs 收尾（见调用处）。
 *
 * 注意取的是「轨道代表格」而不是整条轨道的并集：后者（bannedWedgeCells 那套）
 * 在 2 人局会把走廊翻一倍，可用面积凭空少一半。
 */
/**
 * 补地形的落笔白名单 = 「走廊以外」再并上「工厂周边以外」。
 * @param {Uint8Array[]} [keepPlain] 世界掩膜：1 = 这一格附近不许再盖地形（工厂周边）
 */
function wedgeOkOutsideCorridor(order, dim, roadPlain, keepPlain) {
  const m = wedgeMap(order);
  const K = dim.rows * dim.cols;
  const ok = new Uint8Array(K);
  if (!roadPlain && !keepPlain) return null;
  for (let k = 0; k < K; k++) {
    const p0 = m.gStart[k];
    const p1 = m.gStart[k + 1];
    if (p0 >= p1) continue;
    // ⚠️ **整条轨道的每个像都要看**，不能只看第一个（早先就是只看 p0）：
    // 工厂群不是严格的 D_N 轨道（选址数量不是人数的整倍数时会多出几座，
    // 它们的像落在别处），于是「首像挨着 2 号工厂、另一支像正好压在 5 号工厂门口」
    // 这种轨道照样拿到写权限 —— 实测每个 2 人局有 400~550 条这样的轨道，
    // 工厂 17×17 邻域里凭空长出十几个百分点的地形（选址白挑了）。
    let blocked = 0;
    for (let j = p0; j < p1; j++) {
      const i = m.gCells[j];
      const r = (i / TERR_COLS) | 0;
      const c = i % TERR_COLS;
      if ((roadPlain && roadPlain[r][c]) || (keepPlain && keepPlain[r][c])) {
        blocked = 1;
        break;
      }
    }
    ok[k] = blocked ? 0 : 1;
  }
  return ok;
}

/**
 * 工厂周边不许再补地形（世界掩膜，1 = 禁笔）。
 *
 * ⚠️ 工厂是**在补地形之前**摆好的（createGameState 里先 buildNeutralFactories、再 topUpLoop /
 * rescueCore），所以 siteScore 挑中的那块开阔地，会被随后补上来的地形重新埋掉 —— 实测
 * 最挤的一座工厂 17×17 邻域里有 71% 是地形，「工厂选址要看地形」等于白做。
 * 工厂本来就是 N 重对称的一整组，禁笔区也跟着对称，不会破坏 D_N。
 */
function factoryKeepMask(game, radius) {
  const R = Math.max(0, Math.round(radius));
  let any = false;
  const mask = [];
  for (let r = 0; r < TERR_ROWS; r++) mask[r] = new Uint8Array(TERR_COLS);
  for (const f of (game && game.factories) || []) {
    const cc = Math.floor(f.x / TERR_CELL);
    const cr = Math.floor(f.y / TERR_CELL);
    for (let r = cr - R; r <= cr + R; r++) {
      if (r < 0 || r >= TERR_ROWS) continue;
      for (let c = cc - R; c <= cc + R; c++) {
        if (c < 0 || c >= TERR_COLS) continue;
        mask[r][c] = 1;
        any = true;
      }
    }
  }
  return any ? mask : null;
}

function topUpTerrain(game, n, extra, lossK, okMask) {
  const gen = game && game._mapGen;
  if (!gen || !game.terrain || !game.terrain.grid) return false;
  const th = gen.theme;
  if (!th || !th.mix || !game.hqs || game.hqs.length < 2) return false;
  const order = symOrder(n == null ? SYM_MAX_N : n);
  const dim = wedgeDims(order);

  const banned = bannedWedgeCells(game, order, dim, extra);
  // ② 还原楔形母图，并找出还能落笔的空地（额度一律按「世界里值几格」加权）
  const wedge = wedgeFromWorld(game.terrain.grid, order, dim);
  const { used, wt, total } = wedgeWeights(order, dim);
  ensureMapGenNoise(gen, dim, order);
  const noiseFlat = gen.noise;
  if (!noiseFlat) return false;
  const cur = { mountain: 0, water: 0 };
  for (const i of used) {
    const v = wedge[(i / dim.cols) | 0][i % dim.cols];
    if (v === TT_MOUNTAIN) cur.mountain += wt[i];
    else if (v === TT_WATER) cur.water += wt[i];
  }
  const candidates = [];
  let free = 0;
  for (const i of used) {
    if (okMask ? !okMask[i] : banned[i]) continue;
    free += wt[i];
    candidates.push(i);
  }
  if (!free || !candidates.length) return false;
  // 山 / 水各差多少 → 按主题的 mix 补齐（谁缺得多补谁，比例始终贴着预设）。
  // **缺口要按 loss 放大后再算**：mix 说的是**重挖走廊之后**地图上该有多少地形，
  // 而这里画的量随即会被走廊削掉一大半。
  const corr = clamp(Number(gen.corrFrac), 0, 0.85);
  const loss0 = lossK > 0 ? clamp(lossK, 1, 4) : clamp(1 / Math.max(0.15, 1 - corr), 1, 2.5);
  const wantM = Math.max(0, total * th.mix.mountain * TOP_UP_CLEAN_K * loss0 - cur.mountain);
  const wantW = Math.max(0, total * th.mix.water * TOP_UP_CLEAN_K * loss0 - cur.water);
  const want = wantM + wantW;
  if (want <= 0) return false;
  // 空地能承受的量：主路吃得多的时候不能硬塞满剩下的空地
  const room = Math.min(want, free * TOP_UP_FILL);
  const k = room / want;
  let addM = wantM * k;
  let addW = wantW * k;
  // 上限按 loss 放大（重挖之前的目标量）
  const cap = Math.min(total, total * clamp(th.maxBlocked, 0, 0.9) * loss0);
  const after = cur.mountain + cur.water + addM + addW;
  if (after > cap && after > 0) {
    const shrink = Math.max(0, cap - cur.mountain - cur.water) / (addM + addW);
    addM *= shrink;
    addW *= shrink;
  }
  // 柏林噪声补地形：在候选平原格里按噪声高低晋升为山 / 水（同 Gitee pcg 阈值思路）
  const painted = promoteNoiseOnWedge(wedge, noiseFlat, dim, wt, candidates, addM, addW);
  if (painted.addedM + painted.addedW <= 0) return false;
  gen.wedgeMix = wedgeMixCount(wedge, dim, used, wt);
  game.terrain.grid = renderWorldFromWedge(wedge, order, dim);
  return true;
}

/** 补地形时若噪声场丢失（旧存档 / 测试桩），按主题参数重算一张楔形噪声 */
function ensureMapGenNoise(gen, dim, order) {
  if (gen.noise && gen.noise.length === dim.rows * dim.cols) return;
  const th = gen.theme || THEME_FALLBACK;
  const nc = th.noise || NOISE_FALLBACK;
  const seed = gen.noiseSeed || Math.max(1, Math.floor(((gen.rng && gen.rng()) || Math.random()) * 0xfffffe) + 1);
  const noiseMap = WFPerlin.generateNoiseMap(
    dim.cols,
    dim.rows,
    seed,
    Math.max(4, Number(nc.scale) || 40),
    nc.octaves,
    nc.persistance,
    nc.lacunarity,
    { x: Number(nc.offsetX) || 0, y: Number(nc.offsetY) || 0 }
  );
  applyNoiseBias(noiseMap, dim, nc.bias);
  const flat = new Float32Array(dim.rows * dim.cols);
  for (let r = 0; r < dim.rows; r++) {
    for (let c = 0; c < dim.cols; c++) flat[r * dim.cols + c] = noiseMap[c][r];
  }
  gen.noise = flat;
  gen.noiseSeed = seed;
  void order;
}

/**
 * 给**中场 / 中心**专门补地形 —— 这是双方真正争夺的主战场，不能是一片空地。
 *
 * 为什么要单独一步：图元中心按「面积均匀」撒点时，绝大部分会落在外圈（外圈面积大），
 * 而主路又恰恰沿着各家之间的弦穿过中场 —— 两头一挤，中间就成了真空
 * （实测 4 人局 0.45~0.8 那一环的地形不到 3%，2 人局正中心几乎是 0）。
 * 光靠 topUpTerrain 补不回来：它只看全图总量，额度全被面积更大的外圈吃掉了。
 *
 * 所以这里把图元中心**限制在中心圈内**（zone），并且只统计中心圈的覆盖量：
 *   core.r     中心圈半径（相对世界半宽）
 *   core.fill  中心圈里「还能落笔的空地」要填到多少比例
 * 额度仍受主题的 maxBlocked 约束（中心优先，剩下的留给随后那次全图补）。
 *
 * @returns {boolean} 是否真的补了
 */
/**
 * 量一量中心圈里现在有多少地形（补地形用）。
 *
 * 口径跟 topUpCore 完全一致：中心圈 = 半径 core.r × 世界半宽，格子按 wt 加权
 * （= 它在世界里值几格），**不排除主路走廊**（理由见 topUpCore）。
 *
 * @returns {?{idx:number[], free:number, blocked:number, curM:number, curW:number,
 *             fill:number, order:number, dim:object, wedge:number[][], used:number[],
 *             wt:Float64Array, total:number}} 圈内的楔形格与统计量
 */
function coreCircleStats(game, n) {
  const gen = game && game._mapGen;
  const th = gen && gen.theme;
  if (!th || !game.terrain || !game.terrain.grid || !game.hqs || game.hqs.length < 2) return null;
  const core = th.core || CORE_FALLBACK;
  const rK = clamp(Number(core.r), 0.05, 1);
  const order = symOrder(n == null ? SYM_MAX_N : n);
  const dim = wedgeDims(order);
  const wedge = wedgeFromWorld(game.terrain.grid, order, dim);
  const { used, wt, total } = wedgeWeights(order, dim);
  // 中心圈：楔形格的坐标就是「相对世界中心的偏移」，直接比半径即可
  const coreR = rK * Math.min(WORLD_W, WORLD_H) / 2;
  const idx = [];
  let free = 0;
  let blocked = 0;
  let curM = 0;
  let curW = 0;
  for (const i of used) {
    const c = i % dim.cols;
    const r = (i / dim.cols) | 0;
    if (Math.hypot((c + 0.5) * TERR_CELL, (r + 0.5) * TERR_CELL) > coreR) continue;
    idx.push(i);
    free += wt[i];
    if (wedge[r][c] === TT_MOUNTAIN) {
      curM += wt[i];
      blocked += wt[i];
    } else if (wedge[r][c] === TT_WATER) {
      curW += wt[i];
      blocked += wt[i];
    }
  }
  return { idx, free, blocked, curM, curW, fill: clamp(Number(core.fill), 0, 0.9), order, dim, wedge, used, wt, total, rK };
}

function topUpCore(game, n, extra, lossK, okMask, minGoal, fit) {
  void fit; // 噪声补地形不再需要把长墙截短
  const gen = game && game._mapGen;
  if (!gen || !game.terrain || !game.terrain.grid) return false;
  const th = gen.theme;
  if (!th || !th.mix || !game.hqs || game.hqs.length < 2) return false;
  const cs = coreCircleStats(game, n);
  if (!cs || !cs.free) return false;
  const fill = cs.fill;
  if (fill <= 0) return false;
  const order = cs.order;
  const dim = cs.dim;
  const wedge = cs.wedge;
  const used = cs.used;
  const wt = cs.wt;
  const total = cs.total;
  const coreIdx = cs.idx;
  const free = cs.free;
  const blocked = cs.blocked;

  const banned = bannedWedgeCells(game, order, dim, extra);
  ensureMapGenNoise(gen, dim, order);
  const noiseFlat = gen.noise;
  if (!noiseFlat) return false;
  // 中心有**专属额度**（core.budget），不跟外圈抢；总量仍贴主题 mix。
  let allBlocked = 0;
  let allM = 0;
  let allW = 0;
  for (const i of used) {
    const v = wedge[(i / dim.cols) | 0][i % dim.cols];
    if (v === TT_MOUNTAIN) { allM += wt[i]; allBlocked += wt[i]; }
    else if (v === TT_WATER) { allW += wt[i]; allBlocked += wt[i]; }
  }
  const corr = clamp(Number(gen.corrFrac), 0, 0.85);
  const kk = lossK > 0 ? clamp(lossK, 1, 4) : clamp(1 / Math.max(0.15, 1 - corr), 1, 2.5);
  const remain = Math.max(
    total * 0.02,
    Math.max(0, total * (th.mix.mountain + th.mix.water) * kk - allBlocked)
  );
  const core = th.core || CORE_FALLBACK;
  const goal = Math.max(
    Math.min(free * fill * kk - blocked, total * clamp(Number(core.budget), 0, 0.5) * kk, remain),
    Math.min(Number(minGoal) > 0 ? Number(minGoal) : 0, Math.max(0, free * fill * kk - blocked))
  );
  if (goal <= 0) return false;
  const mixSum = th.mix.mountain + th.mix.water;
  const sh = mixSum > 0 ? th.mix.mountain / mixSum : 0.5;
  const boost = Number(minGoal) > 0 ? goal : 0;
  let addM = Math.min(goal * sh, Math.max(0, total * th.mix.mountain * kk + boost * sh - allM));
  let addW = Math.min(goal * (1 - sh), Math.max(0, total * th.mix.water * kk + boost * (1 - sh) - allW));
  const cap = Math.min(total, total * clamp(th.maxBlocked, 0, 0.9) * kk);
  const after = allM + allW + addM + addW;
  if (after > cap && addM + addW > 0) {
    const shrink = Math.max(0, cap - allM - allW) / (addM + addW);
    addM *= shrink;
    addW *= shrink;
  }
  // 只在中心圈候选格上按噪声晋升（okMask / banned 仍尊重）
  const candidates = [];
  for (const i of coreIdx) {
    if (okMask ? !okMask[i] : banned[i]) continue;
    candidates.push(i);
  }
  if (!candidates.length) return false;
  if (process.env.WFDBG) {
    console.log(
      `     [core] 圈内 ${((free / total) * 100).toFixed(1)}% 图幅（可落笔）／已有地形 ${((blocked / total) * 100).toFixed(1)}%` +
        ` → goal ${((goal / total) * 100).toFixed(1)}%（kk ${kk.toFixed(2)}）`
    );
  }
  const painted = promoteNoiseOnWedge(wedge, noiseFlat, dim, wt, candidates, addM, addW);
  if (painted.addedM + painted.addedW <= 0) return false;
  if (process.env.WFDBG) {
    let nb = 0;
    for (const i of coreIdx) if (wedge[(i / dim.cols) | 0][i % dim.cols] !== TT_PLAIN) nb += wt[i];
    console.log(`     [core] 盖完圈内地形 ${((nb / total) * 100).toFixed(1)}%`);
  }
  gen.wedgeMix = wedgeMixCount(wedge, dim, used, wt);
  game.terrain.grid = renderWorldFromWedge(wedge, order, dim);
  return true;
}

/**
 * 清掉**过小的地形块**：面积不足 minCells 的连通块（山、水各自算）整块填成平原。
 *
 * 为什么需要：图元本身都不小（≥ SHAPE_MIN_AREA），但后续会被主路 / 建筑清场圈 /
 * 隔离带 / 连通性开道切成碎块 —— 尤其是「对称化 + 连通」那几步，会在地形边缘
 * 啃出 1~3 格的小斑点。合格的地形模型不该有这种碎屑（挡不住人、也看不出地貌）。
 *
 * 判据就是**这块自身**有多大：曾经试过「按整条 D_N 轨道的总重判」，结果 6~7 格的
 * 碎屑靠同轨道大兄弟的重量活了下来（借别人的面积过关），清不干净。
 *
 * 对称由调用处兜：清完拿快照做一次**并集传播**（symmetrizeGrid 'union'），
 * 同一块地形的各个像一起开，误差才压得住。
 *
 * @returns {number} 清掉的格数
 */
function clearTinyBlobs(grid, minCells) {
  const R = grid.length;
  const C = grid[0].length;
  const thresh = Math.max(1, Number(minCells) || 0);
  const seen = new Uint8Array(R * C);
  const stack = [];
  const blobs = [];
  for (let r0 = 0; r0 < R; r0++) {
    for (let c0 = 0; c0 < C; c0++) {
      const i0 = r0 * C + c0;
      if (seen[i0] || !grid[r0][c0]) continue;
      const type = grid[r0][c0];
      seen[i0] = 1;
      stack.length = 0;
      stack.push(i0);
      const cells = [];
      while (stack.length) {
        const i = stack.pop();
        cells.push(i);
        const r = (i / C) | 0;
        const c = i % C;
        if (r > 0 && !seen[i - C] && grid[r - 1][c] === type) {
          seen[i - C] = 1;
          stack.push(i - C);
        }
        if (r + 1 < R && !seen[i + C] && grid[r + 1][c] === type) {
          seen[i + C] = 1;
          stack.push(i + C);
        }
        if (c > 0 && !seen[i - 1] && grid[r][c - 1] === type) {
          seen[i - 1] = 1;
          stack.push(i - 1);
        }
        if (c + 1 < C && !seen[i + 1] && grid[r][c + 1] === type) {
          seen[i + 1] = 1;
          stack.push(i + 1);
        }
      }
      blobs.push(cells);
    }
  }
  let gone = 0;
  for (const cells of blobs) {
    if (cells.length >= thresh) continue;
    for (const i of cells) grid[(i / C) | 0][i % C] = TT_PLAIN;
    gone += cells.length;
  }
  return gone;
}

/**
 * 把山 / 水外缘的直角锯齿磨圆：削尖刺、削外凸直角、填凹口。
 *
 * 为什么必须做（不是纯好看）：
 *   ① 直角外缘在对角切角禁令（navStepOk）下，部队要绕「凸出来的一格」走两步正交，
 *      窄走廊里就变成原地抖、看着有路却过不去；
 *   ② 开道 / 对称化 / 搬迁会在外缘啃出 1 格楼梯锯齿 —— 图元本身 round 再高也救不了收尾。
 *
 * 每遍三步（先记后改，同遍互不干扰）：
 *   尖刺 —— 同类正交邻居 ≤ 1 → 平原；
 *   凸角 —— 恰好 2 个邻居成 L、外侧对角非同类 → 削掉（方台变八边形）；
 *   凹口 —— 平原三面被同一类山/水围住 → 填回去。
 * 凸角只在前两遍削（再削会把厚墙啃穿）；尖刺 / 凹口每遍都做。
 *
 * @returns {number} 改动的格数
 */
/**
 * 磨圆山/水外缘：削尖刺、填内凹直角（楼梯凹角）、首遍轻削外凸尖角。
 * 外凸直角主要靠客户端格内斜切表达（再削会越削越出台阶）；这里只把凹台阶填实、去掉 1 邻尖刺。
 */
function roundTerrainEdges(grid, passes) {
  const R = grid.length;
  if (!R) return 0;
  const C = grid[0].length;
  const nPass = Math.max(1, Math.min(6, passes | 0));
  let changed = 0;
  const same = (r, c, t) => r >= 0 && r < R && c >= 0 && c < C && grid[r][c] === t;
  for (let p = 0; p < nPass; p++) {
    const tips = [];
    const corners = [];
    const fills = [];
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const t = grid[r][c];
        if (t === TT_MOUNTAIN || t === TT_WATER) {
          const N = same(r - 1, c, t);
          const S = same(r + 1, c, t);
          const W = same(r, c - 1, t);
          const E = same(r, c + 1, t);
          const n = (N ? 1 : 0) + (S ? 1 : 0) + (W ? 1 : 0) + (E ? 1 : 0);
          if (n <= 1) {
            tips.push(r * C + c);
            continue;
          }
          // 只在首遍削一刀外凸 L：多削会沿对角线剥出台阶，反而更方
          if (p === 0 && n === 2 && !((N && S) || (W && E))) {
            corners.push(r * C + c);
          }
        } else if (t === TT_PLAIN) {
          let mtn = 0;
          let wat = 0;
          const tally = (rr, cc) => {
            if (rr < 0 || rr >= R || cc < 0 || cc >= C) return;
            if (grid[rr][cc] === TT_MOUNTAIN) mtn += 1;
            else if (grid[rr][cc] === TT_WATER) wat += 1;
          };
          tally(r - 1, c);
          tally(r + 1, c);
          tally(r, c - 1);
          tally(r, c + 1);
          if (mtn >= 3 && wat === 0) fills.push([r * C + c, TT_MOUNTAIN]);
          else if (wat >= 3 && mtn === 0) fills.push([r * C + c, TT_WATER]);
          else {
            // 内凹直角 / 楼梯凹角：两正交邻为同类固体，且夹角对角也是同类 → 填实
            const fillL = (type, N, S, W, E) => {
              if (N && E && same(r - 1, c + 1, type)) return true;
              if (N && W && same(r - 1, c - 1, type)) return true;
              if (S && E && same(r + 1, c + 1, type)) return true;
              if (S && W && same(r + 1, c - 1, type)) return true;
              return false;
            };
            const N = same(r - 1, c, TT_MOUNTAIN);
            const S = same(r + 1, c, TT_MOUNTAIN);
            const W = same(r, c - 1, TT_MOUNTAIN);
            const E = same(r, c + 1, TT_MOUNTAIN);
            const nM = (N ? 1 : 0) + (S ? 1 : 0) + (W ? 1 : 0) + (E ? 1 : 0);
            if (nM === 2 && wat === 0 && fillL(TT_MOUNTAIN, N, S, W, E)) {
              fills.push([r * C + c, TT_MOUNTAIN]);
            } else {
              const Nw = same(r - 1, c, TT_WATER);
              const Sw = same(r + 1, c, TT_WATER);
              const Ww = same(r, c - 1, TT_WATER);
              const Ew = same(r, c + 1, TT_WATER);
              const nW = (Nw ? 1 : 0) + (Sw ? 1 : 0) + (Ww ? 1 : 0) + (Ew ? 1 : 0);
              if (nW === 2 && mtn === 0 && fillL(TT_WATER, Nw, Sw, Ww, Ew)) {
                fills.push([r * C + c, TT_WATER]);
              }
            }
          }
        }
      }
    }
    for (const i of tips) {
      grid[(i / C) | 0][i % C] = TT_PLAIN;
      changed += 1;
    }
    for (const i of corners) {
      grid[(i / C) | 0][i % C] = TT_PLAIN;
      changed += 1;
    }
    for (const it of fills) {
      grid[(it[0] / C) | 0][it[0] % C] = it[1];
      changed += 1;
    }
  }
  return changed;
}

/**
 * 去毛刺：把 **1 格宽**的尖刺拔掉、**1 格宽**的凹口填平。
 *
 * 为什么必须单独一条、而不能指望 roundTerrainEdges：
 *   ① roundTerrainEdges 的「削外凸角」每削一次就把方台削成 45° 台阶，越削越碎。
 *      实测在同一张收尾图上再跑 2 / 4 / 6 遍，「1 格宽的 V 字尖」从 396 涨到 420~452 个，
 *      地形量还掉 2~4 个点。去毛刺只拔尖、且外凸只拔「1 格宽的凸角」，不进 45° 台阶 ——
 *      同一张图 396 → 24，地形量一格不变（27.6% → 27.6%）。
 *   ② 毛刺是整条生成链（噪声阈值 → 图元 → 挖主路 → 关口 → 开道 → 表决）必然留下的残渣：
 *      1 格山尖戳在平原边上、1 格平原缺口嵌进山体。它挡不住人也走不进去，
 *      唯一后果就是把地图画脏 —— 玩家说的「一点都不平滑」大半是它。
 *
 * 只读局部 3×3，所以**与 D_N 对称群可交换**（对称的邻域转过去还是对称的邻域，判定同值）。
 * 因此它可以安全地跑在 symmetrizeGrid **之后**：既不用再表决一次（一表决就会按轨道多数
 * 把刚拔掉的尖刺插回去 —— 这正是毛刺一直清不掉的原因），也不会破坏对称与公平。
 *
 * ⚠️ 填凹口有一条硬约束：**不许把 1 格宽的过道堵死**。判据是「这个平原格有没有一对
 *    正对的平原邻居」—— 只要它在一条通道上（沿通道两个方向都是平原），一律不填。
 *    （拔尖永远不会断连通：尖刺不是桥。）
 *
 * @returns {number} 改动的格数
 */
function despeckleEdges(grid, passes) {
  const R = grid.length;
  if (!R) return 0;
  const C = grid[0].length;
  const nPass = Math.max(1, Math.min(8, passes | 0));
  const at = (r, c) => (r < 0 || r >= R || c < 0 || c >= C ? 0 : grid[r][c]);
  let changed = 0;
  for (let p = 0; p < nPass; p++) {
    const cut = [];
    const fill = [];
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const t = grid[r][c];
        if (t === TT_MOUNTAIN || t === TT_WATER) {
          const N = at(r - 1, c) === t;
          const S = at(r + 1, c) === t;
          const W = at(r, c - 1) === t;
          const E = at(r, c + 1) === t;
          const n = (N ? 1 : 0) + (S ? 1 : 0) + (W ? 1 : 0) + (E ? 1 : 0);
          if (n <= 1) {
            cut.push(r * C + c); // 孤立格 / 单格尖刺
            continue;
          }
          if (n === 2) {
            // 1 格宽的凸角：两个正邻成 L，而夹在它们中间的那个对角是异类
            if (
              (N && W && at(r - 1, c - 1) !== t) ||
              (N && E && at(r - 1, c + 1) !== t) ||
              (S && W && at(r + 1, c - 1) !== t) ||
              (S && E && at(r + 1, c + 1) !== t)
            ) {
              cut.push(r * C + c);
            }
          }
        } else if (t === TT_PLAIN) {
          const t1 = at(r - 1, c);
          const t2 = at(r + 1, c);
          const t3 = at(r, c - 1);
          const t4 = at(r, c + 1);
          if (t1 === TT_PLAIN && t2 === TT_PLAIN) continue; // 纵向过道，别堵
          if (t3 === TT_PLAIN && t4 === TT_PLAIN) continue; // 横向过道，别堵
          let mtn = 0;
          let wat = 0;
          for (const v of [t1, t2, t3, t4]) {
            if (v === TT_MOUNTAIN) mtn++;
            else if (v === TT_WATER) wat++;
          }
          if (mtn >= 3 && wat === 0) fill.push([r * C + c, TT_MOUNTAIN]);
          else if (wat >= 3 && mtn === 0) fill.push([r * C + c, TT_WATER]);
        }
      }
    }
    if (!cut.length && !fill.length) break;
    for (const i of cut) {
      grid[(i / C) | 0][i % C] = TT_PLAIN;
      changed += 1;
    }
    for (const it of fill) {
      grid[(it[0] / C) | 0][it[0] % C] = it[1];
      changed += 1;
    }
  }
  return changed;
}

/**
 * 把地形**重新对齐到 D_N 对称**。
 * 分组依据是「折叠后落在楔形的哪一格」—— 这跟生成时的采样口径完全一致，所以同组必然该同值。
 * 一组 = 一条 D_N 轨道（2N 个像，靠近四角的会因出界而少几个）。
 *
 * 两种口径（mode）：
 *   - **'vote'（多数表决，默认）**：一组里过半是平原 → 整组开；否则把少数的那几格**填回**
 *     该组的多数地形。它只抹掉栅格化留下的 ±1 格锯齿，**不会放大开口**——
 *     隔离带 / 主路这种占图一成以上的东西，若用「只要有一格开就全开」的并集，
 *     一条轨道里只要有 1 格被扫到就整组开，十几万个格子会被连锁掏空（实测地形量掉一半）。
 *   - **'union'（并集传播）**：给了 before 就只传播「这一步新挖开的格子」——
 *     用于连通性开道：某家被山包死时开的走廊，必须让所有对称位置都有一条，
 *     否则公平性就没了。这一步只在小范围开口上跑，并集不会失控。
 *
 * @param {number[][]} grid 地形网格（原地修改）
 * @param {number} n 对称阶数
 * @param {number[][]} [before] 「这一步之前」的网格快照（仅 union 用）
 * @param {'vote'|'union'} [mode] 对齐口径
 * @returns {number} 被改成平原的格数
 */
/**
 * @param {Uint8Array[]} [only] 给了就只在这些格子上判定「新挖开」（并集模式用）。
 *   主路走廊在 2 人局里对折群并不闭合（弦就是直径，镜像会把 +d 那侧翻到 −d 那侧），
 *   于是「有一个像被挖开就把整条轨道都开掉」会把走廊成倍放大 —— 实测 2 人局
 *   这一步单独吃掉 15 个点的地形（41% → 27%），比挖路本身还狠。只认走廊里的格子，
 *   既保住对称，又不把口子越开越大。
 */
function symmetrizeGrid(grid, n, before, mode, only) {
  if (!grid || !grid.length) return 0;
  const m = wedgeMap(n == null ? SYM_MAX_N : n);
  const order = m.n;
  const dim = m.dim;
  const unionMode = mode === 'union';
  // 'fill'：只做「把组里少数的平原格填回多数地形」，**绝不把地形开成平原**。
  // 用于清碎块之后修对称 —— 同一块地形的各个 D_N 像会被主路切出不同大小，
  // 只清掉其中一两个像就不对称了；用并集传播会把整条轨道开掉（清一格开 2N 格，
  // 掏空一大片），而这里要的是「补回去」，不是「再开一点」。
  const fillMode = mode === 'fill';
  // 分组用缓存好的轨道表（gStart/gCells），别再逐格折一次 —— 那是旧版最贵的一步
  const K = dim.rows * dim.cols;
  const cnt = new Int32Array(K); // 每组格数
  const gMtn = new Int32Array(K);
  const gWat = new Int32Array(K);
  const gFresh = new Uint8Array(K);
  const orbit = m.orbit;
  const N = Math.min(orbit.length, grid.length * grid[0].length);
  for (let i = 0; i < N; i++) {
    const k = orbit[i];
    if (k < 0) continue;
    const r = (i / TERR_COLS) | 0;
    const c = i % TERR_COLS;
    const v = grid[r][c];
    cnt[k]++;
    if (v === TT_MOUNTAIN) gMtn[k]++;
    else if (v === TT_WATER) gWat[k]++;
    if (unionMode && v === TT_PLAIN && before && before[r] && before[r][c] !== TT_PLAIN && (!only || only[r][c]))
      gFresh[k] = 1;
  }
  let opened = 0;
  for (let k = 0; k < K; k++) {
    const size = cnt[k];
    if (!size) continue;
    const open = size - gMtn[k] - gWat[k];
    const back = gMtn[k] >= gWat[k] ? TT_MOUNTAIN : TT_WATER;
    if (unionMode) {
      if (!gFresh[k]) continue;
    } else if (fillMode) {
      if (open === 0 || open >= size) continue; // 全同色就没什么好补的
      for (let p = m.gStart[k]; p < m.gStart[k + 1]; p++) {
        const i = m.gCells[p];
        const r = (i / TERR_COLS) | 0;
        const c = i % TERR_COLS;
        if (grid[r][c] === TT_PLAIN) grid[r][c] = back;
      }
      continue;
    } else if (open * 2 < size) {
      // 少数派是平原 → 整组统一成多数地形（抹掉锯齿，不放大开口）。
      // ⚠️ 必须把**整组**都改掉，不只是那几格平原：一组里「3 山 + 3 水 + 2 平原」同样是
      // 不对称（每家门口看到的就不一样了），而只填平原格的话那 3 格水原封不动 ——
      // 实测这一步一改，4 人局的对称误差从 2.5%~3.2% 直接掉到 0.1% 以下。
      // 整组同值是 D_N 对称的定义，不存在「本来就该混色」的轨道。
      for (let p = m.gStart[k]; p < m.gStart[k + 1]; p++) {
        const i = m.gCells[p];
        const r = (i / TERR_COLS) | 0;
        const c = i % TERR_COLS;
        if (grid[r][c] !== back) grid[r][c] = back;
      }
      continue;
    } else if (open * 2 === size) {
      // 平票（4 人局一条轨道 8 个像，4:4 很常见）→ **两边都不动**。
      // 若按「过半即开」处理，主路扫到其中一个像就把整组开掉，边角那几块地形
      // 会被成片抹平（实测能把只剩 1% 地形的平原图抹到 0）。
      // 平票留着不影响对称：真正保证对称的是**并集传播**（见调用处）——
      // 补地形输出的是「楔形采样」，本来严格对称；之后每次挖除都跟着并集传播，
      // 于是整条轨道同开同闭，压根走不到平票这一步。
      continue;
    }
    for (let p = m.gStart[k]; p < m.gStart[k + 1]; p++) {
      const i = m.gCells[p];
      const r = (i / TERR_COLS) | 0;
      const c = i % TERR_COLS;
      // 并集模式下给了 only 就**只开走廊里的格子**：2 人局的弦就是直径，镜像会把
      // 路的 +d 一侧翻到 −d 一侧，同一条轨道里既有路面也有非路面 —— 不加这道闸，
      // 「一个像被挖开就把整条轨道全开」会把走廊翻上一倍（实测吃掉 12.6 个点地形）。
      if (unionMode && only && !only[r][c]) continue;
      if (grid[r][c] !== TT_PLAIN) {
        grid[r][c] = TT_PLAIN;
        opened++;
      }
    }
  }
  return opened;
}

/* ---------------- 地形图元：把「规整形状」盖到网格上 ---------------- */

/** 取一个随机值：v 可以是 [min,max]（在区间内取）、单值，或缺失（落回兜底） */
function rngRange(rng, v, dflt) {
  let lo = 0;
  let hi = 0;
  if (Array.isArray(v)) {
    lo = Number(v[0]);
    hi = Number(v.length > 1 ? v[1] : v[0]);
  } else if (Array.isArray(dflt)) {
    lo = Number(dflt[0]);
    hi = Number(dflt[1]);
  } else {
    lo = Number(dflt);
    hi = Number(dflt);
  }
  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi)) hi = lo;
  if (hi < lo) hi = lo;
  return lo + rng() * (hi - lo);
}

/** 坐标吸附到 snap 的整数倍（并夹回 [0,max-1]）→ 布局有「格子纸上画图」的整齐感 */
function snapCell(v, snap, max) {
  const s = snap > 1 ? snap : 1;
  return clamp(Math.round(v / s) * s, 0, Math.max(0, max - 1));
}

/** 长墙的走向：只取正交 / 45°，因此墙绝对笔直（dir 见 data.js 的 themes 注释） */
function dirChoices(dir) {
  if (dir === 'h') return [[0, 1]];
  if (dir === 'v') return [[1, 0]];
  if (dir === 'diag') return [[1, 1], [1, -1]];
  if (dir === 'any') return [[0, 1], [1, 0], [1, 1], [1, -1]];
  return [[0, 1], [1, 0]]; // 'hv'：正交（默认）
}

/**
 * 图元落一格：越界忽略，同时记下归属（撤图元时用得着）。
 * @param {Uint8Array} [ok] 落笔白名单：给了就只画 ok[r*gw+c]===1 的格子。
 *        「补地形」阶段用它把图元限制在主路走廊以外 —— 画到走廊上会把刚挖好的路堵回去。
 */
function putCell(grid, own, id, r, c, type, rows, gw, ok, cnt) {
  if (r < 0 || r >= rows || c < 0 || c >= gw) return;
  const i = r * gw + c;
  if (ok && !ok[i]) return;
  // 增量维护「山 / 水各多少格」（cnt.wt 是每格在世界里值几格），省得每盖一笔就全表重扫
  if (cnt) {
    const w = cnt.wt[i] || 0;
    const old = grid[r][c];
    if (old === TT_MOUNTAIN) cnt.m -= w;
    else if (old === TT_WATER) cnt.w -= w;
    if (type === TT_MOUNTAIN) cnt.m += w;
    else if (type === TT_WATER) cnt.w += w;
    if (cnt.undo) cnt.undo.push(i, old); // 记下原值，万一这个图元要撤销（见 runStamps）
  }
  grid[r][c] = type;
  own[i] = id;
}

/**
 * 取图元中心：at:'center' 时贴着**楔形原点**（它就是世界中心，于是折回去以后
 * 这个图元就长在世界正中，向四面八方展开），否则在楔形里随机 —— 两种情况都吸附到格距。
 *
 * 随机位置走**极坐标**：φ 落在折叠真正会用到的那条半扇区 [0, π/N] 里，
 * r 取到该方向上世界的边界为止（√随机 → 面积均匀）。
 * 直接在楔形外接矩形里撒点会被浪费掉一大半：矩形里角度 > π/N、或半径超出世界半宽的那片，
 * 永远采样不到（N 越大浪费越狠，4 人局能浪费一半），图元白画、地形量上不去。
 *
 * @param {{r0:number, r1:number}} [zone] 把半径限制在这段区间里（相对世界半宽的比例）。
 *        「补中场」时用：不加约束的话，按面积均匀撒点绝大部分图元会落在外圈
 *        （外圈面积大），中场永远填不满 —— 而中场正是双方争夺的主战场。
 */
function shapeCenter(rng, rows, gw, snap, at, n, ok, zone) {
  if (at === 'center') return [0, 0];
  // at:'corner' → 贴着地图角上（45° 方向、半径 = 世界半宽 × √2）。
  // 主路是沿着各家之间的弦挖的，够不到四个角，所以「角上的地形」永远不会被路吃掉 ——
  // 想保证某主题的地貌量稳定，就把它的主角地形按在角上。
  if (at === 'corner') {
    // 沿 45° 方向、半径取到对角线长度的 86%（正好贴着角、又整个落在图内 ——
    // 直接取「角那一格」的话圆心已经在图外了，图元会被裁掉九成，等于没画）
    const diag = Math.hypot(TERR_COLS / 2, TERR_ROWS / 2);
    const k = (diag * 0.86) / Math.SQRT2;
    return [clamp(snapCell(k, snap, rows), 0, rows - 1), clamp(snapCell(k, snap, gw), 0, gw - 1)];
  }
  const order = symOrder(n == null ? SYM_MAX_N : n);
  const half = Math.PI / order;
  // 有白名单时**拒绝采样**：最多试 SHAPE_TRY 次，取第一个落在白名单里的中心；
  // 全都不中就用最后一次（图元会被白名单裁掉，等于这一笔白画，不影响正确性）。
  // 不这么做的话「补地形」阶段一大半图元会整个落在主路走廊里，白盖几百次也填不满额度。
  const tries = ok ? SHAPE_TRY : 1;
  const zr0 = zone && Number.isFinite(zone.r0) ? clamp(zone.r0, 0, 1) : 0;
  const zr1 = zone && Number.isFinite(zone.r1) ? clamp(zone.r1, zr0, 1) : 1;
  let out = null;
  for (let t = 0; t < tries; t++) {
    const phi = rng() * half;
    const rMax = Math.min(
      WORLD_W / 2 / Math.max(1e-6, Math.cos(phi)),
      WORLD_H / 2 / Math.max(1e-6, Math.sin(phi))
    );
    // 半径区间内**按面积均匀**取：r = R·√(u0² + rand·(u1² − u0²))。
    // 直接用 √rand 再线性映射到区间会把图元全挤在区间外沿，内圈照样是空的。
    // 基准恒取**内切半径** min(W,H)/2，不能用 rMax：rMax 是「该方向上到边界的距离」，
    // 45° 方向比正东方向长 √2 倍 —— 拿它当基准，斜方向上的图元会跑到中心圈外面去
    // （再被落笔白名单整块裁掉，等于一笔没画）。取内切半径则保证任意方向都在图内。
    const rr = zone
      ? Math.sqrt(zr0 * zr0 + rng() * (zr1 * zr1 - zr0 * zr0)) * (Math.min(WORLD_W, WORLD_H) / 2)
      : Math.sqrt(rng()) * rMax;
    const cr = clamp(snapCell((rr * Math.sin(phi)) / TERR_CELL, snap, rows), 0, rows - 1);
    const cc = clamp(snapCell((rr * Math.cos(phi)) / TERR_CELL, snap, gw), 0, gw - 1);
    out = [cr, cc];
    if (!ok || ok[cr * gw + cc]) break;
  }
  return out;
}

/**
 * 笔直长墙：正交或 45° 走向、整数厚度，沿长度按固定间距开「关口」（隘口）。
 * 定位方式是「先定中心、再整体平移回图内」—— 墙不会被边界截断成半截。
 */
function stampWall(grid, own, id, rng, cfg, rows, gw, snap, order, ok, zone, cnt) {
  const d = SHAPE_DEFAULTS.wall;
  const ds = dirChoices(cfg.dir);
  const dir = ds[Math.floor(rng() * ds.length)] || [0, 1];
  const dr = dir[0];
  const dc = dir[1];
  // 该走向下放得下的最大跨度：水平墙看列数，垂直 / 对角墙看可用的行数
  const spanMax = Math.max(8, Math.min(dr ? rows : gw, dc ? gw : rows) - 1);
  // len 是「世界宽度的倍数」（见 data.js 注释），所以基准恒取世界列数 —— 楔形母图比世界窄，
  // 用它的列数当基准会把所有长墙都缩短一大截。
  const len = clamp(Math.round(rngRange(rng, cfg.len, d.len) * TERR_COLS), 8, spanMax);
  const thick = Math.max(1, Math.round(rngRange(rng, cfg.thick, d.thick)));
  const gap = rngRange(rng, cfg.gap, d.gap);
  const gapW = rngRange(rng, cfg.gapW, d.gapW);
  const type = cfg.type === 'water' ? TT_WATER : TT_MOUNTAIN;
  // 中心吸附到格距；再按墙的实际跨度把整条墙平移回图内（两端都完整）
  const ctr = shapeCenter(rng, rows, gw, snap, cfg.at, order, ok, zone);
  const cr = ctr[0];
  const cc = ctr[1];
  const hr = (dr * len) / 2;
  const hc = (dc * len) / 2;
  const loR = Math.min(cr - hr, cr + hr);
  const hiR = Math.max(cr - hr, cr + hr);
  const loC = Math.min(cc - hc, cc + hc);
  const hiC = Math.max(cc - hc, cc + hc);
  let sr = 0;
  let sc = 0;
  if (loR < 0) sr = -loR;
  else if (hiR > rows - 1) sr = rows - 1 - hiR;
  if (loC < 0) sc = -loC;
  else if (hiC > gw - 1) sc = gw - 1 - hiC;
  let r = Math.round(cr - hr + sr);
  let c = Math.round(cc - hc + sc);
  // 法向（格向量）：正交墙 → 垂直方向；对角墙 → 另一条对角线
  const nr = -dc;
  const nc = dr;
  const off = -((thick - 1) >> 1);
  // 关口：沿墙每隔 gap 格开一个宽 gapW 的缺口（缺口中心落在 gap/2、3gap/2 …）
  const gaps = [];
  if (gapW > 0 && gap > gapW) for (let g = gap / 2; g < len; g += gap) gaps.push(g);
  for (let s = 0; s <= len; s++) {
    let open = false;
    for (let i = 0; i < gaps.length; i++) {
      if (Math.abs(s - gaps[i]) <= gapW / 2) {
        open = true;
        break;
      }
    }
    if (!open) for (let k = 0; k < thick; k++) putCell(grid, own, id, r + nr * (off + k), c + nc * (off + k), type, rows, gw, ok, cnt);
    r += dr;
    c += dc;
  }
}

/**
 * 山块 / 湖泊：round 控制方圆 —— 0 = 矩形台地，1 = 标准椭圆。
 * 内部是超椭圆 |dx/a|^p + |dy/b|^p ≤ 1，指数 p 由 round 反推（2 = 椭圆，10 ≈ 矩形）。
 */
function stampBlob(grid, own, id, rng, cfg, rows, gw, snap, order, ok, zone, cnt) {
  const d = SHAPE_DEFAULTS.blob;
  const round = clamp(Number(cfg.round == null ? d.round : cfg.round), 0, 1);
  // 最小占地：山块 / 湖泊不许画成小碎块（详见 SHAPE_MIN_AREA）
  const minSide = shapeMinSide(round);
  const w = Math.max(minSide, Math.round(rngRange(rng, cfg.w, d.w)));
  const h = Math.max(minSide, Math.round(rngRange(rng, cfg.h, d.h)));
  const p = 2 + (1 - round) * 8;
  const type = cfg.type === 'water' ? TT_WATER : TT_MOUNTAIN;
  const a = w / 2;
  const b = h / 2;
  // 中心吸附后夹回图内：整块形状完整，不会被边界切掉一角。
  // at:'center' 例外：它就贴着楔形原点（= 世界中心），被夹走就不是「正中央的湖/山」了 ——
  // 楔形只会保留它落在第一象限的那一角，折回采样时自然补回完整的圆。
  const ctr = shapeCenter(rng, rows, gw, snap, cfg.at, order, ok, zone);
  const pinned = cfg.at === 'center' || cfg.at === 'corner';
  const cr = pinned ? ctr[0] : clamp(ctr[0], Math.ceil(b), Math.max(Math.ceil(b), rows - 1 - Math.ceil(b)));
  const cc = pinned ? ctr[1] : clamp(ctr[1], Math.ceil(a), Math.max(Math.ceil(a), gw - 1 - Math.ceil(a)));
  for (let r = Math.floor(cr - b); r <= Math.ceil(cr + b); r++) {
    for (let c = Math.floor(cc - a); c <= Math.ceil(cc + a); c++) {
      const u = Math.abs(c - cc) / a;
      const v = Math.abs(r - cr) / b;
      if (Math.pow(u, p) + Math.pow(v, p) <= 1) putCell(grid, own, id, r, c, type, rows, gw, ok, cnt);
    }
  }
}

/** 环形山：一圈厚墙 + 若干缺口（缺口沿整圈均分） */
function stampRing(grid, own, id, rng, cfg, rows, gw, snap, order, ok, zone, cnt) {
  const d = SHAPE_DEFAULTS.ring;
  const rad = Math.max(6, rngRange(rng, cfg.r, d.r));
  const thick = Math.max(1, Math.round(rngRange(rng, cfg.thick, d.thick)));
  const notches = Math.max(0, Math.round(rngRange(rng, cfg.gap, d.gap)));
  const type = cfg.type === 'water' ? TT_WATER : TT_MOUNTAIN;
  const TAU = Math.PI * 2;
  const halfArc = 0.17; // 缺口的半角（弧度）→ 缺口弧长 ≈ 2 × 0.17 × rad 格
  const base = rng() * TAU;
  const m = Math.ceil(rad + thick / 2);
  const ctr = shapeCenter(rng, rows, gw, snap, cfg.at, order, ok, zone);
  // 同上：at:'center' 的环形山就长在世界正中（只画它在楔形里的那一段弧，折回后补成整圈）
  const pinned = cfg.at === 'center' || cfg.at === 'corner';
  const cr = pinned ? ctr[0] : clamp(ctr[0], m, Math.max(m, rows - 1 - m));
  const cc = pinned ? ctr[1] : clamp(ctr[1], m, Math.max(m, gw - 1 - m));
  for (let r = Math.floor(cr - m); r <= Math.ceil(cr + m); r++) {
    for (let c = Math.floor(cc - m); c <= Math.ceil(cc + m); c++) {
      const dx = c - cc;
      const dy = r - cr;
      if (Math.abs(Math.hypot(dx, dy) - rad) > thick / 2 + 0.5) continue;
      let open = false;
      if (notches > 0) {
        const ang = Math.atan2(dy, dx);
        for (let i = 0; i < notches; i++) {
          const na = base + (i * TAU) / notches;
          let diff = (((ang - na) % TAU) + TAU) % TAU;
          if (diff > Math.PI) diff = TAU - diff;
          if (diff < halfArc) {
            open = true;
            break;
          }
        }
      }
      if (!open) putCell(grid, own, id, r, c, type, rows, gw, ok, cnt);
    }
  }
}

/** 按图元类型分派到对应笔刷 */
function drawStamp(grid, own, id, rng, cfg, rows, gw, snap, order, ok, zone, cnt) {
  if (cfg.kind === 'wall') stampWall(grid, own, id, rng, cfg, rows, gw, snap, order, ok, zone, cnt);
  else if (cfg.kind === 'ring') stampRing(grid, own, id, rng, cfg, rows, gw, snap, order, ok, zone, cnt);
  else stampBlob(grid, own, id, rng, cfg, rows, gw, snap, order, ok, zone, cnt);
}

/**
 * 覆盖率封顶：超过 limit 就**从后往前整块撤掉图元**（后盖的是点缀，先撤它）。
 * 相比「从边缘一圈圈啃」，这样留下的墙仍旧笔直、湖仍旧是圆的 —— 不会把图元啃成怪形状。
 *
 * 注意额度口径：传了 usedIdx 就只数**真正会落到世界里**的那些格子（楔形外接矩形里
 * 有相当一部分永远采样不到，把它们算进来等于白砍一刀 —— 4 人局地形量会掉到三分之一）；
 * 再传了 wt 就按「这一格在世界里值几格」加权 —— 贴着地图角的轨道有一半的像在图外，
 * 不加权的话把地形放在角上会白吃额度（详见 wedgeWeights）。
 * @returns {number} 撤完后还剩多少格不可通行
 */
function clampShapes(grid, own, limit, count, usedIdx, keep, wt) {
  const gw = grid[0].length;
  const countIn = () => {
    if (!usedIdx) return countBlocked(grid);
    let n = 0;
    for (const i of usedIdx) if (grid[(i / gw) | 0][i % gw] !== TT_PLAIN) n += wt ? wt[i] : 1;
    return n;
  };
  let blocked = countIn();
  for (let id = count - 1; id >= 0 && blocked > limit; id--) {
    if (keep && keep.has(id)) continue; // 钉死的图元不撤（见 generateTerrainGrid 的 keep）
    for (let i = 0; i < own.length; i++) {
      if (own[i] !== id) continue;
      const r = (i / gw) | 0;
      const c = i % gw;
      if (grid[r][c] !== TT_PLAIN) {
        grid[r][c] = TT_PLAIN;
        blocked -= wt ? wt[i] : 1;
      }
      own[i] = -1;
    }
  }
  return blocked;
}

/* ---------------- 连通性保证：全图可通行区连成一片，且通道至少 2 格宽 ---------------- */

/** 某格是否可通行（山地 / 水域不可通行） */
function cellPassable(grid, r, c) {
  if (r < 0 || r >= TERR_ROWS || c < 0 || c >= TERR_COLS) return false;
  const v = grid[r][c];
  return v !== TT_MOUNTAIN && v !== TT_WATER;
}

/** 单格设为平原（越界忽略） */
function setPlain(grid, r, c) {
  if (r < 0 || r >= TERR_ROWS || c < 0 || c >= TERR_COLS) return;
  grid[r][c] = TT_PLAIN;
}

/** 连同 180° 旋转格一起设为平原 —— 保证地图始终点对称（两家看地形完全同构） */
function setPlainSym(grid, r, c) {
  setPlain(grid, r, c);
  setPlain(grid, TERR_ROWS - 1 - r, TERR_COLS - 1 - c);
}

/** 把 (r,c) 所在的 2×2 方块整块挖成平原（含旋转格）→ 该处通道宽度至少 2 格 */
function carveWide(grid, r, c) {
  const r0 = Math.min(Math.max(r, 0), TERR_ROWS - 2);
  const c0 = Math.min(Math.max(c, 0), TERR_COLS - 2);
  setPlainSym(grid, r0, c0);
  setPlainSym(grid, r0 + 1, c0);
  setPlainSym(grid, r0, c0 + 1);
  setPlainSym(grid, r0 + 1, c0 + 1);
}

/**
 * 「宽格」掩码：处在某个「2×2 全可通行」方块里 → 1。
 * 于是「宽度 ≥2 格」被编码进掩码本身 —— 1 格宽的一线天不会出现在掩码里。
 */
function wideMask(grid) {
  const m = [];
  for (let r = 0; r < TERR_ROWS; r++) m[r] = new Uint8Array(TERR_COLS);
  for (let r = 0; r < TERR_ROWS - 1; r++) {
    for (let c = 0; c < TERR_COLS - 1; c++) {
      if (
        cellPassable(grid, r, c) &&
        cellPassable(grid, r + 1, c) &&
        cellPassable(grid, r, c + 1) &&
        cellPassable(grid, r + 1, c + 1)
      ) {
        m[r][c] = 1;
        m[r + 1][c] = 1;
        m[r][c + 1] = 1;
        m[r + 1][c + 1] = 1;
      }
    }
  }
  return m;
}

/** 掩码的 4-连通块（格 id = r*COLS+c），按格数从大到小 */
function wideRegions(mask) {
  const R = TERR_ROWS;
  const C = TERR_COLS;
  const seen = new Uint8Array(R * C);
  const out = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const id0 = r * C + c;
      if (!mask[r][c] || seen[id0]) continue;
      const cells = [id0];
      seen[id0] = 1;
      for (let h = 0; h < cells.length; h++) {
        const cur = cells[h];
        const cr = (cur / C) | 0;
        const cc = cur % C;
        if (cr > 0 && !seen[cur - C] && mask[cr - 1][cc]) {
          seen[cur - C] = 1;
          cells.push(cur - C);
        }
        if (cr < R - 1 && !seen[cur + C] && mask[cr + 1][cc]) {
          seen[cur + C] = 1;
          cells.push(cur + C);
        }
        if (cc > 0 && !seen[cur - 1] && mask[cr][cc - 1]) {
          seen[cur - 1] = 1;
          cells.push(cur - 1);
        }
        if (cc < C - 1 && !seen[cur + 1] && mask[cr][cc + 1]) {
          seen[cur + 1] = 1;
          cells.push(cur + 1);
        }
      }
      out.push(cells);
    }
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}

/**
 * 撑宽窄通道：只动真正的「通道格」（上下或左右对向都能走 → 这是一条缝，不是死胡同尖角），
 * 挖掉它侧面的一格障碍，让它至少 2 格宽。连同旋转格一起挖，保持点对称。
 */
function widenNarrow(grid) {
  for (let round = 0; round < 4; round++) {
    const mask = wideMask(grid);
    const marks = [];
    for (let r = 0; r < TERR_ROWS; r++) {
      for (let c = 0; c < TERR_COLS; c++) {
        if (!cellPassable(grid, r, c) || mask[r][c]) continue;
        const vert = cellPassable(grid, r - 1, c) && cellPassable(grid, r + 1, c);
        const horz = cellPassable(grid, r, c - 1) && cellPassable(grid, r, c + 1);
        if (!vert && !horz) continue; // 死胡同尖角：本来就不是通道，不动
        if (vert) {
          if (!cellPassable(grid, r, c - 1)) marks.push([r, c - 1]);
          else if (!cellPassable(grid, r, c + 1)) marks.push([r, c + 1]);
        } else {
          if (!cellPassable(grid, r - 1, c)) marks.push([r - 1, c]);
          else if (!cellPassable(grid, r + 1, c)) marks.push([r + 1, c]);
        }
      }
    }
    if (!marks.length) return;
    for (const m of marks) setPlainSym(grid, m[0], m[1]);
  }
}

/**
 * 从 sources 出发的小权重 Dijkstra：进入可通行格代价 0、水域 1、山地 3。
 * 山地代价高 → 优先借水体开道，尽量不挖穿当成「墙」的山脉。
 * @returns {{dist: Int32Array, prev: Int32Array}} prev 供回溯出开道路径
 */
function dijkstraFrom(grid, sources) {
  const C = TERR_COLS;
  const R = TERR_ROWS;
  const N = R * C;
  const dist = new Int32Array(N);
  const prev = new Int32Array(N);
  dist.fill(0x3fffffff);
  prev.fill(-1);
  // 极简二叉堆（两个平行数组，避免每条边都分配对象）
  const hd = [];
  const hi = [];
  const hpush = (d, id) => {
    hd.push(d);
    hi.push(id);
    let i = hd.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      const td = hd[p];
      hd[p] = hd[i];
      hd[i] = td;
      const ti = hi[p];
      hi[p] = hi[i];
      hi[i] = ti;
      i = p;
    }
  };
  const hpop = () => {
    const d = hd[0];
    const id = hi[0];
    const ld = hd.pop();
    const li = hi.pop();
    if (hd.length) {
      hd[0] = ld;
      hi[0] = li;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r2 = l + 1;
        let m = i;
        if (l < hd.length && hd[l] < hd[m]) m = l;
        if (r2 < hd.length && hd[r2] < hd[m]) m = r2;
        if (m === i) break;
        const td = hd[m];
        hd[m] = hd[i];
        hd[i] = td;
        const ti = hi[m];
        hi[m] = hi[i];
        hi[i] = ti;
        i = m;
      }
    }
    return [d, id];
  };
  for (const s of sources) {
    if (dist[s] === 0) continue;
    dist[s] = 0;
    hpush(0, s);
  }
  while (hd.length) {
    const cur = hpop();
    const d = cur[0];
    const id = cur[1];
    if (d !== dist[id]) continue; // 过期的堆项
    const cr = (id / C) | 0;
    const cc = id % C;
    const relax = (nr, nc) => {
      if (nr < 0 || nr >= R || nc < 0 || nc >= C) return;
      const nid = nr * C + nc;
      const v = grid[nr][nc];
      const w = v === TT_MOUNTAIN ? 3 : v === TT_WATER ? 1 : 0;
      const nd = d + w;
      if (nd < dist[nid]) {
        dist[nid] = nd;
        prev[nid] = id;
        hpush(nd, nid);
      }
    };
    relax(cr - 1, cc);
    relax(cr + 1, cc);
    relax(cr, cc - 1);
    relax(cr, cc + 1);
  }
  return { dist, prev };
}

/**
 * 连通性总保证（在整张图上跑，建筑清场之后调用）：
 *   ① 撑宽所有不足 2 格的窄通道；
 *   ② 填掉小到没意义的孤立碎块（按外围多数类型填成山或水，不留走不出去的死地）；
 *   ③ 把剩下的每个孤立区都开一条 2 格宽走廊接到最大区 —— 于是不存在被山/水包死的地方。
 * @param {number[][]} grid 地形网格
 * @param {number[][]} anchors 必须留出口的格子（工厂 / 研究所 / 总部所在格）
 */
/**
 * 由**最终地形**派生整张图的高度场（整数层，见 data.js 的 height 段）。
 *
 * 为什么不是「山 = 高、水 = 低、平原 = 0」那样给：单位只能站在平原格上（山 / 水不可通行），
 * 那样一算所有单位永远同高，高低差机制等于没做。改成山 / 水的高度**往外摊一圈缓坡**：
 *   ① 正负掩膜（山 = +mountain、水 = water 的负值）→ ② 可分离盒式模糊多遍（≈ 高斯）
 *   → ③ **按整条 D_N 轨道取平均** → ④ 归一化后四舍五入到整数层。
 *
 * ③ 不能省：同一条轨道的各个旋转像在栅格化时难免差一点点，逐格量化会在切割线上错开
 * 半层（对称误差直接失控）—— 先按轨道平均、再量化，整条轨道取值完全一致。
 *
 * @returns {Int8Array} 行优先的逐格高度（−levels..+levels）
 */
/**
 * 由地形派生高度场 + 坡道掩码。
 *
 * @param {Uint8Array} [outRamps] 坡道掩码的输出缓冲（长度 = R×C，1 = 这格是挖出来的坡）。
 *        调用方持有它，才能把「坡」当作一种真实地形下发 / 用于寻路 ——
 *        坡不是「层差恰好为 1」这种推导结论，而是服务端亲手挖出来的结果。
 * @returns {Int8Array} 高度层
 */
function buildHeightField(grid, order, sites, outRamps) {
  const R = TERR_ROWS;
  const C = TERR_COLS;
  const TOT = R * C;
  const ramps = outRamps || new Uint8Array(TOT);
  const f = new Float32Array(TOT);
  for (let r = 0; r < R; r++) {
    const row = grid[r];
    for (let c = 0; c < C; c++) {
      const v = row[c];
      if (v === TT_MOUNTAIN) f[r * C + c] = HGT_MTN;
      else if (v === TT_WATER) f[r * C + c] = HGT_WAT;
    }
  }
  // ② 可分离盒式模糊：横向扫一遍 + 纵向扫一遍，多遍叠加近似高斯。
  //    半径 HGT_SLOPE 直接决定「一座山的高度往外摊多远」，单位是**地形格**（1 格 40px）。
  const rad = HGT_SLOPE;
  const win = 2 * rad + 1;
  const tmp = new Float32Array(TOT);
  for (let p = 0; p < HGT_PASSES; p++) {
    for (let r = 0; r < R; r++) {
      let sum = 0;
      for (let c = -rad; c <= rad; c++) sum += f[r * C + clamp(c, 0, C - 1)];
      for (let c = 0; c < C; c++) {
        tmp[r * C + c] = sum / win;
        sum += f[r * C + clamp(c + rad + 1, 0, C - 1)] - f[r * C + clamp(c - rad, 0, C - 1)];
      }
    }
    for (let c = 0; c < C; c++) {
      let sum = 0;
      for (let r = -rad; r <= rad; r++) sum += tmp[clamp(r, 0, R - 1) * C + c];
      for (let r = 0; r < R; r++) {
        f[r * C + c] = sum / win;
        sum += tmp[clamp(r + rad + 1, 0, R - 1) * C + c] - tmp[clamp(r - rad, 0, R - 1) * C + c];
      }
    }
  }
  // ③ 同一条 D_N 轨道取平均：栅格化时轨道各成员的取值难免差一点点，
  //    平均之后同一条轨道取值完全一致 → 量化结果必然一致 → 高度场严格 N 重对称。
  const map = wedgeMap(order);
  const K = map.dim.rows * map.dim.cols;
  for (let k = 0; k < K; k++) {
    const a = map.gStart[k];
    const b = map.gStart[k + 1];
    if (b <= a) continue;
    let s = 0;
    for (let j = a; j < b; j++) s += f[map.gCells[j]];
    const m = s / (b - a);
    for (let j = a; j < b; j++) f[map.gCells[j]] = m;
  }
  // ④ 归一化 → 整数层（用分位数掐掉极端值：否则一处极端高峰会把其它地方全压成 0 层）
  let scale = 0;
  if (HGT_Q >= 1) {
    for (let i = 0; i < TOT; i++) {
      const av = Math.abs(f[i]);
      if (av > scale) scale = av;
    }
  } else {
    const arr = new Float32Array(TOT);
    for (let i = 0; i < TOT; i++) arr[i] = Math.abs(f[i]);
    arr.sort();
    scale = arr[Math.min(TOT - 1, Math.max(0, Math.round(HGT_Q * (TOT - 1))))];
  }
  const out = new Int8Array(TOT);
  if (scale > 1e-6) {
    for (let i = 0; i < TOT; i++) {
      out[i] = terraceSnap(Math.round((f[i] / scale) * HGT_LEVELS));
    }
  }
  // ⑤ 建筑地基垫平：不垫的话一座 12×12 格的工厂可能半边悬在崖上，
  //    而且寻路会把它的另一半判成「过不去」—— 部队连自家工厂都进不去。
  // ⑥ 挖坡口：台地之间全是崖，部队走不上去 —— 沿边界开几道坡把它接回主平原。
  //    ⚠️ 必须在高度场派生完就挖：坡口也是高度场的一部分，晚一步就等于没挖。
  if (HGT_CLIFF > 1) {
    flattenSites(out, order, grid, sites);
    // 坡道掩码：1 = 服务端确实在这儿挖了坡（=「无视高低差也能走」的地形）。
    // 客户端只画它，寻路也只认它 —— 不再让两端各自用「层差=1」反推，
    // 那种反推会把台地之间并非坡道的相邻格一起染上色，且两边口径可能漂移。
    ramps.fill(0);
    // 第一遍：纯地形口径（山/水才是障碍）—— 主流程，决定全图的坡口布局
    carveRamps(grid, out, order, null, false, ramps);
    // 第二遍：把建筑占位也算障碍再走一遍 —— 专治「坡口正好被自家楼压住」的死地。
    // 补挖得下的就补挖，实在塞不下坡口的由 carveRamps 的收尾整块并进邻层。
    // （WF_NO_ACCESS2=1 可关掉这一遍做 A/B 对照；实测它让开局慢 60~200ms）
    const blocked = buildingBlockMask(sites);
    if (blocked && !process.env.WF_NO_ACCESS2) carveRamps(grid, out, order, blocked, true, ramps);
    // ⑦ 收口：坡必须**只**落在平原上。坡肩外扩是按 pass 判的，但两遍 carveRamps
    //    的 pass 口径不同（第二遍还排除了建筑占位），加上对称展开会覆盖轨道成员 ——
    //    实测 3 人局偶尔漏出 2 格山体被标成坡。坡一旦长在山上，
    //    客户端会把它画成金色通路，但寻路仍然不可通过，画出来的东西等于骗人。
    //    这里按最终地形网格统一清一遍：山/水格一律不是坡。
    for (let r = 0; r < R; r++) {
      const row = grid[r];
      for (let c = 0; c < C; c++) {
        const i = r * C + c;
        if (row[c] === TT_MOUNTAIN || row[c] === TT_WATER) ramps[i] = 0;
      }
    }
  } else if (!outRamps) {
    ramps.fill(0);
  }
  out.ramps = ramps; // 挂在返回值上：调用方 buildHeightField(...).ramps 取用
  return out;
}

/**
 * 建筑占位掩码（给 carveRamps 第二遍用）：1 = 这一格被楼压住、站不了人。
 * 口径与寻路掩码 passGrid 完全一致（圆心半径 r + BLOCK_MARGIN），
 * 这样「地图生成时认为通」和「寻路时认为通」才是同一件事。
 */
function buildingBlockMask(sites) {
  if (!sites || !sites.length) return null;
  const R = TERR_ROWS;
  const C = TERR_COLS;
  const m = new Uint8Array(R * C);
  for (const s of sites) {
    const rr = occupyR(s.r);
    const c0 = Math.max(0, Math.floor((s.x - rr) / TERR_CELL));
    const c1 = Math.min(C - 1, Math.floor((s.x + rr) / TERR_CELL));
    const r0 = Math.max(0, Math.floor((s.y - rr) / TERR_CELL));
    const r1 = Math.min(R - 1, Math.floor((s.y + rr) / TERR_CELL));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const px = (c + 0.5) * TERR_CELL;
        const py = (r + 0.5) * TERR_CELL;
        if (Math.hypot(px - s.x, py - s.y) <= rr) m[r * C + c] = 1;
      }
    }
  }
  return m;
}

/** 建筑占位清单（给 flattenSites 垫地基用）：总部 / 工厂 / 研究所的圆心与碰撞半径 */
function buildingSites(game) {
  const out = [];
  for (const h of game.hqs || []) out.push({ x: h.x, y: h.y, r: HQ_R });
  for (const f of game.factories || []) out.push({ x: f.x, y: f.y, r: FACTORY_R });
  for (const l of game.labs || []) out.push({ x: l.x, y: l.y, r: LAB_R });
  return out;
}

/**
 * 建筑地基垫平：把建筑占的那一圈格子统一成一层。
 *
 * 垫成**哪一层**是关键：垫成中心层的话，四周比它高/低 2 层的地就成了崖 ——
 * 整座建筑被围死，部队进不去、也出不来。所以取「外缘一圈最常见的层」，
 * 让地基和外面的地齐平；真有一侧对不上，那边本来就是崖，不算我们挖出来的。
 *
 * ⚠️ 落笔同样折回楔形（见 carveRamps）：建筑是成组对称摆的，2N 个像一起垫平才公平。
 *
 * @param {Int8Array} h 高度层（就地改）
 * @param {number} order 对称阶数
 * @param {number[][]} grid 地形网格（只垫能站人的格子）
 * @param {Array<{x:number,y:number,r:number}>} [sites] 建筑占位（世界像素半径 r）
 */
function flattenSites(h, order, grid, sites) {
  if (!h || !grid || !sites || !sites.length) return;
  const R = TERR_ROWS;
  const C = TERR_COLS;
  const map = wedgeMap(order);
  const K = map.dim.rows * map.dim.cols;
  const hw = new Int8Array(K);
  for (let k = 0; k < K; k++) {
    const a = map.gStart[k];
    if (map.gStart[k + 1] > a) hw[k] = h[map.gCells[a]];
  }
  const paint = (i, lv) => {
    const k = map.orbit[i];
    if (k >= 0) hw[k] = lv;
    else h[i] = lv;
  };
  const passable = (r, c) => r >= 0 && r < R && c >= 0 && c < C && grid[r][c] !== TT_MOUNTAIN && grid[r][c] !== TT_WATER;

  for (const s of sites) {
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
    const rr = Math.max(TERR_CELL * 0.5, Number(s.r) || 0);
    const cc = Math.floor(s.x / TERR_CELL);
    const cr = Math.floor(s.y / TERR_CELL);
    if (cc < 0 || cc >= C || cr < 0 || cr >= R) continue;
    // 外缘一圈（地基外 1~2 格）最常见的层 —— 地基垫成它才连得上外面
    const cnt = new Map();
    const out0 = Math.max(1, Math.ceil(rr / TERR_CELL));
    for (let dr = -out0 - 2; dr <= out0 + 2; dr++) {
      for (let dc = -out0 - 2; dc <= out0 + 2; dc++) {
        const md = Math.max(Math.abs(dr), Math.abs(dc));
        if (md < out0) continue;
        const r = cr + dr;
        const c = cc + dc;
        if (!passable(r, c)) continue;
        const v = h[r * C + c];
        cnt.set(v, (cnt.get(v) || 0) + 1);
      }
    }
    let L = h[cr * C + cc];
    let bc = -1;
    cnt.forEach((v, k) => { if (v > bc) { bc = v; L = k; } });
    // ⚠️ 垫平圈必须**大过**寻路掩码的占位圈（见 occupyR），且要再留出至少一格：
    //    圈外那圈若比地基低/高 2 层（崖），部队就永远迈不出去 —— 生在那里的兵原地抖一辈子。
    //    判据用「占位 + 半格量化 + 一格缓冲」：
    //      occupyR(r) = r + 22；格心判定让实际边界再外扩半格（TERR_CELL/2 = 20）；
    //      再加一格（40）⇒ 环上至少有一整圈「可站人且同层」的格子，一定出得去。
    const padR = occupyR(rr) + TERR_CELL * 1.5;
    for (let dr = -out0 - 2; dr <= out0 + 2; dr++) {
      for (let dc = -out0 - 2; dc <= out0 + 2; dc++) {
        const r = cr + dr;
        const c = cc + dc;
        if (!passable(r, c)) continue;
        const px = (c + 0.5) * TERR_CELL;
        const py = (r + 0.5) * TERR_CELL;
        if (Math.hypot(px - s.x, py - s.y) > padR) continue;
        paint(r * C + c, L);
      }
    }
  }
  for (let i = 0; i < R * C; i++) {
    const k = map.orbit[i];
    if (k >= 0) h[i] = hw[k];
  }
}

/**
 * ⑤ 台地化：把连续的整数层吸附到 terrace 的整数倍。
 * ±1 层这种「半步」全部并进相邻的档位，于是高度只剩 0 / ±2 / ±3 几档 ——
 * 档与档之间直接差 ≥2 层，那就是崖；档内是平的，那是台地。
 * （±levels 夹住：levels=3、terrace=2 时 +3 就是顶层，不会被吸成 +4）
 */
function terraceSnap(v) {
  const s = v < 0 ? -1 : 1;
  return clamp(s * Math.round(Math.abs(v) / HGT_TERRACE) * HGT_TERRACE, -HGT_LEVELS, HGT_LEVELS);
}

/**
 * ⑥ 挖坡口：被崖围住的台地/洼地要留几道能上下的口子，否则那块地谁也去不了。
 *
 * 做法：在世界图上找「孤立连通块 ↔ 已连通块」之间的崖边，挑几段平直的边界，
 * 把**高的一侧**从边界往里数 (落差−1) 格改写成中间层 —— 于是上下各只差 1 层，
 * 走得通；没挖到的边界仍是 ≥2 层的崖，走不通。这就是「只有坡能上下」。
 *
 * ⚠️ 对称：每一笔都折回楔形再展开（wedgeMap.orbit），一道坡会在 2N 个对称位置
 *    上同时出现 —— 几家到高地的通路完全一样。直接改世界格会破坏 D_N 对称。
 *
 * @param {number[][]} grid 地形网格（判断哪些格能站人）
 * @param {Int8Array} h 高度层（就地改）
 * @param {number} order 对称阶数（= 玩家人数）
 */
function carveRamps(grid, h, order, blocked, noTiny, rampOut) {
  const R = TERR_ROWS;
  const C = TERR_COLS;
  const TOT = R * C;
  const map = wedgeMap(order);
  const K = map.dim.rows * map.dim.cols;
  // 楔形层：高度场是轨道常量，取任一成员的值即可
  const hw = new Int8Array(K);
  for (let k = 0; k < K; k++) {
    const a = map.gStart[k];
    if (map.gStart[k + 1] > a) hw[k] = h[map.gCells[a]];
  }
  // 坡道掩码（楔形层）：1 = 这一格是**挖出来的坡道**，也就是「无视高低差也能走」的地形。
  // ⚠️ 坡必须当成一种**成片的地形**下发，而不是在客户端靠「层差=1」反推：
  //    反推会把量化台地之间那些并非坡道的相邻格也染上色（实测多到 10% 以上），
  //    而且客户端与服务端的判定口径天生可能漂移 —— 画出来的东西不等于能走的东西。
  //    这里由服务端直接标记「我确实在这儿挖了坡」，客户端只负责画，寻路也只认它。
  const rw = new Uint8Array(K);
  /** 在世界格 i 上落笔：折回楔形 → 展开时 2N 个像一起变（对称由此保证） */
  const paint = (i, lv, isRamp) => {
    const k = map.orbit[i];
    if (k >= 0) {
      hw[k] = lv;
      if (isRamp) rw[k] = 1;
    } else {
      h[i] = lv;
      if (isRamp && rampOut) rampOut[i] = 1;
    }
    if (isRamp && rampOut) rampOut[i] = 1;
  };
  const expand = () => {
    for (let i = 0; i < TOT; i++) {
      const k = map.orbit[i];
      if (k >= 0) {
        h[i] = hw[k];
        if (rampOut && rw[k]) rampOut[i] = 1;
      }
    }
  };

  // ⚠️ 第二遍（blocked ≠ null）要把**建筑占位**也算成障碍：
  //    地基垫平圈只比寻路占位圈大 1 格，建筑若建在小台地上，部队能站的那一圈
  //    外沿就是崖 —— 坡口再被自家楼压住的话，整块地基变成「进得去出不来」的死地
  //    （实测一支激光兵在这个环里抖了 120s、累计走了 10200px 却纹丝不动）。
  const pass = new Uint8Array(TOT);
  for (let r = 0; r < R; r++) {
    const row = grid[r];
    for (let c = 0; c < C; c++) {
      const i = r * C + c;
      pass[i] = row[c] !== TT_MOUNTAIN && row[c] !== TT_WATER && !(blocked && blocked[i]) ? 1 : 0;
    }
  }
  /** 两格之间走不走得通：都能站人，且层差不到「崖」 */
  const walkable = (a, b) => Math.abs(h[a] - h[b]) < HGT_CLIFF;
  /** 两格算不算同一块台地：同层即同一块 */
  const sameLv = (a, b) => h[a] === h[b];

  const lab = new Int32Array(TOT);
  const queue = new Int32Array(TOT);
  let compN = 0;
  /** 连通块标号：same(a,b) 决定相邻两格算不算连着 */
  function relabelBy(same) {
    lab.fill(-1);
    let n = 0;
    for (let s = 0; s < TOT; s++) {
      if (!pass[s] || lab[s] >= 0) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      lab[s] = n;
      while (head < tail) {
        const cur = queue[head++];
        const c0 = cur % C;
        const r0 = (cur - c0) / C;
        if (c0 > 0 && lab[cur - 1] < 0 && pass[cur - 1] && same(cur, cur - 1)) { lab[cur - 1] = n; queue[tail++] = cur - 1; }
        if (c0 < C - 1 && lab[cur + 1] < 0 && pass[cur + 1] && same(cur, cur + 1)) { lab[cur + 1] = n; queue[tail++] = cur + 1; }
        if (r0 > 0 && lab[cur - C] < 0 && pass[cur - C] && same(cur, cur - C)) { lab[cur - C] = n; queue[tail++] = cur - C; }
        if (r0 < R - 1 && lab[cur + C] < 0 && pass[cur + C] && same(cur, cur + C)) { lab[cur + C] = n; queue[tail++] = cur + C; }
      }
      n++;
    }
    compN = n;
    return n;
  }
  const relabel = () => relabelBy(walkable);

  /** 当前标号收成 [{k,size,cells}]（按大小降序） */
  function groups() {
    const byK = new Map();
    for (let i = 0; i < TOT; i++) {
      if (lab[i] < 0) continue;
      let g = byK.get(lab[i]);
      if (!g) {
        g = { k: lab[i], size: 0, cells: [] };
        byK.set(lab[i], g);
      }
      g.size++;
      g.cells.push(i);
    }
    return Array.from(byK.values()).sort((a, b) => b.size - a.size);
  }

  /**
   * 一块地**外面**最常见的一层 —— 小碎台地 / 接不上的死地往哪层并，就听它的。
   *
   * ⚠️ 只能数**块外**的邻居。早先连块内的邻居一起数，于是「一块同层的地」统计出来的
   * 多数层永远是它自己那一层 → `absorb` 等于原地踏步 → 被崖围死的台地（尤其是 12×12
   * 的工厂地基、9×9 的总部地基）一个都救不回来，生在那里的部队一辈子出不去。
   */
  const inside = new Uint8Array(TOT); // 复用，别每次调用都新开一张 8 万格的表
  function majorityAround(cells) {
    for (let n = 0; n < cells.length; n++) inside[cells[n]] = 1;
    const cnt = new Map();
    for (let n = 0; n < cells.length; n++) {
      const i = cells[n];
      const c0 = i % C;
      const r0 = (i - c0) / C;
      const nb = [c0 > 0 ? i - 1 : -1, c0 < C - 1 ? i + 1 : -1, r0 > 0 ? i - C : -1, r0 < R - 1 ? i + C : -1];
      for (const j of nb) {
        if (j < 0 || !pass[j] || inside[j]) continue;
        cnt.set(h[j], (cnt.get(h[j]) || 0) + 1);
      }
    }
    let best = h[cells[0]];
    let bc = 0;
    cnt.forEach((v, k) => { if (v > bc) { bc = v; best = k; } });
    for (let n = 0; n < cells.length; n++) inside[cells[n]] = 0; // 用完即擦，供下一次调用
    return best;
  }
  /** 整块改写成某一层：小碎台地并进邻层，省得留一块谁也去不了的死地 */
  function absorb(cells, lv) {
    for (let n = 0; n < cells.length; n++) paint(cells[n], lv);
  }

  // ① 台地化会在档位交界处甩出一些一两格的小台地：连一个坡口都放不下，
  //    直接并进周围的层（比留一块死地强，也比给它开一道独木桥好看）
  const MIN_PATCH = Math.max(2, HGT_RAMP_W * HGT_RAMP_W);
  if (!noTiny) {
    for (let round = 0; round < 3; round++) {
      relabelBy(sameLv);
      const tiny = groups().filter((g) => g.size < MIN_PATCH);
      if (!tiny.length) break;
      for (const g of tiny) absorb(g.cells, majorityAround(g.cells));
      expand();
    }
  }

  relabel();
  if (compN <= 1) return; // 整图本来就走得通（比如没有台地），不用挖

  // 已连通 = 主平原（最大的一块）以及后来被坡接上的块
  const open = new Uint8Array(TOT);
  let gs0 = groups();
  const mainK = gs0[0].k;
  for (const i of gs0[0].cells) open[i] = 1;

  /** 试探一处坡口：边界要平直、坡脚与坡道带都得能站人且同层 */
  function siteAt(i, j, w) {
    const c0 = i % C;
    const r0 = (i - c0) / C;
    const c1 = j % C;
    const r1 = (j - c1) / C;
    const dr = Math.sign(r1 - r0);
    const dc = Math.sign(c1 - c0);
    if (!dr && !dc) return null;
    // 高的一侧才是要动土的一侧：从 lo 往 hi 挖进去
    const up = h[j] > h[i];
    const lo = up ? i : j;
    const hi = up ? j : i;
    const L = h[lo];
    const d = h[hi] - L;
    if (d < HGT_CLIFF) return null;
    const ur = (up ? r1 : r0);
    const uc = (up ? c1 : c0);
    const lr = (up ? r0 : r1); // 坡脚所在行的坐标（低的一侧）
    const lc = (up ? c0 : c1);
    const sr = up ? dr : -dr; // 由 lo 指向 hi（往高地里挖）
    const sc = up ? dc : -dc;
    const tr = -sc; // 侧向（沿边界铺开坡口宽度）
    const tc = sr;
    const half = Math.floor(w / 2);
    for (let t = -half; t <= w - 1 - half; t++) {
      // 坡脚：低的一侧这一排要能站人、且和 lo 同层（不然坡口落进别的台地里）
      const fr = lr + tr * t;
      const fc = lc + tc * t;
      if (fr < 0 || fr >= R || fc < 0 || fc >= C) return null;
      const fi = fr * C + fc;
      if (!pass[fi] || h[fi] !== L) return null;
      for (let s = 0; s <= d - 2; s++) {
        const gr = ur + sr * s + tr * t;
        const gc = uc + sc * s + tc * t;
        if (gr < 0 || gr >= R || gc < 0 || gc >= C) return null;
        const gi = gr * C + gc;
        if (!pass[gi] || h[gi] !== h[hi]) return null;
      }
    }
    return { lo, hi, L, d, sr, sc, tr, tc, w, r: ur, c: uc };
  }

  /** 在 s 处开坡：高的一侧从边界往里 (d−1) 格各降一级，形成一级一级的坡道 */
  function carve(s) {
    const half = Math.floor(s.w / 2);
    for (let t = -half; t <= s.w - 1 - half; t++) {
      for (let st = 0; st <= s.d - 2; st++) {
        const gr = s.r + s.sr * st + s.tr * t;
        const gc = s.c + s.sc * st + s.tc * t;
        paint(gr * C + gc, s.L + 1 + st, true);
      }
      // ⚠️ 坡道要「成片」才认得出来（用户原话：别做成一条线）。
      //    只铺中间那几格台阶带时，最远视角下它就是一条细线 ——
      //    实测每簇只有 3~5 格、散落几百处，满屏地图上根本数不出哪儿能上下。
      //    所以沿边界方向向两侧各扩 HGT_RAMP_GRIP 格「坡肩」，一并标成坡。
      //    坡肩本身不改层（保持原地形高度），语义上属于「上下坡的位置」，
      //    画出来就是一整条连续的金色地带，肉眼一下就能定位。
      for (let g2 = 1; g2 <= HGT_RAMP_GRIP; g2++) {
        for (const side of [-1, 1]) {
          const tr2 = s.r + s.tr * (t + side * g2);
          const tc2 = s.c + s.tc * (t + side * g2);
          if (tr2 < 0 || tr2 >= R || tc2 < 0 || tc2 >= C) continue;
          const ti = tr2 * C + tc2;
          if (!pass[ti]) continue; // 山 / 水 / 建筑占位不能染成坡
          // 层值取「楔形里这一轨道当前的高度」—— 坡肩不改变地形高度
          const k = map.orbit[ti];
          const cur = k >= 0 ? hw[k] : h[ti];
          paint(ti, cur, true);
        }
      }
    }
  }

  /** 找这块台地通往「已连通区」的坡口：先按标准宽度找，放不下就逐级收窄到 1 格 */
  function findSites(cells, want) {
    for (let w = HGT_RAMP_W; w >= 1; w--) {
      const cands = [];
      for (const i of cells) {
        const c0 = i % C;
        const r0 = (i - c0) / C;
        const nb = [c0 > 0 ? i - 1 : -1, c0 < C - 1 ? i + 1 : -1, r0 > 0 ? i - C : -1, r0 < R - 1 ? i + C : -1];
        for (const j of nb) {
          if (j < 0 || !pass[j] || !open[j]) continue;
          if (Math.abs(h[i] - h[j]) < HGT_CLIFF) continue;
          const s = siteAt(i, j, w);
          if (s) cands.push(s);
        }
      }
      if (!cands.length) continue;
      const picked = [];
      // 多个坡口按「离已选点最远」铺开，免得全挤在一处
      while (picked.length < want) {
        let best = null;
        let bestScore = -1;
        for (const s of cands) {
          if (picked.indexOf(s) >= 0) continue;
          let score = 0;
          if (HGT_RAMP_SPREAD && picked.length) {
            let mn = Infinity;
            for (const q of picked) {
              const dr2 = q.r - s.r;
              const dc2 = q.c - s.c;
              const dd = dr2 * dr2 + dc2 * dc2;
              if (dd < mn) mn = dd;
            }
            score = mn;
          }
          if (score > bestScore) { bestScore = score; best = s; }
        }
        if (!best) break;
        picked.push(best);
      }
      return picked;
    }
    return [];
  }

  let carved = 0;
  const CARVE_CAP = 240;
  for (let round = 0; round < 24 && carved < CARVE_CAP; round++) {
    // 按块的大小从大到小处理：先给最大的台地开口，小碎块最后收尾
    const patches = groups().filter((g) => !open[g.cells[0]]);
    if (!patches.length) break;
    let progress = 0;
    for (const p of patches) {
      if (carved >= CARVE_CAP) break;
      const want = clamp(HGT_RAMP_MIN + Math.floor(p.size / HGT_RAMP_PER), HGT_RAMP_MIN, HGT_RAMP_MAX);
      const picked = findSites(p.cells, want);
      if (!picked.length) continue;
      for (const s of picked) { carve(s); carved++; }
      progress++;
    }
    if (!progress) break;
    expand();
    // 重新标号 + 重新算「已连通」：挖通的块并进主平原，下一轮接着给剩下的开口
    relabel();
    const hasOpen = new Uint8Array(Math.max(1, compN));
    for (let i = 0; i < TOT; i++) if (lab[i] >= 0 && open[i]) hasOpen[lab[i]] = 1;
    const g2 = groups();
    if (g2.length) hasOpen[g2[0].k] = 1; // 最大的一块永远算连通（它就是主平原）
    for (let i = 0; i < TOT; i++) open[i] = lab[i] >= 0 && hasOpen[lab[i]] ? 1 : 0;
  }
  // ② 收尾：还有接不上的（边界太碎，连 1 格宽的坡口都塞不下）就整块并进邻层。
  //    宁可少一块高地，也不能留一块谁也去不了的死地 —— 部队卡在上面等于那块地白画了。
  for (let round = 0; round < 4; round++) {
    relabel();
    const gs = groups();
    if (gs.length <= 1) break;
    const stuck = gs.filter((g) => !open[g.cells[0]]);
    if (!stuck.length) break;
    for (const g of stuck) absorb(g.cells, majorityAround(g.cells));
    expand();
    relabel();
    const hasOpen = new Uint8Array(Math.max(1, compN));
    for (let i = 0; i < TOT; i++) if (lab[i] >= 0 && open[i]) hasOpen[lab[i]] = 1;
    const g2 = groups();
    if (g2.length) hasOpen[g2[0].k] = 1;
    for (let i = 0; i < TOT; i++) open[i] = lab[i] >= 0 && hasOpen[lab[i]] ? 1 : 0;
  }
  if (carved) expand();
  game_rampsCarved = carved;
}

/** 最近一次挖坡口挖了几道（诊断/测试用；单局只有一个值，够用了） */
let game_rampsCarved = 0;

/** 高度网格压成字符串（每层一个字符 '0'~'9'，level + HGT_OFF），便于下发 */
function heightsToData(h) {
  if (!h) return '';
  let s = '';
  for (let i = 0; i < h.length; i++) {
    const v = clamp(h[i] + HGT_OFF, 0, 9);
    s += String(v);
  }
  return s;
}

/**
 * 坡道掩码压成字符串（每格一个字符 '0'/'1'）。
 *
 * 坡是一种**真实地形**，不是「层差恰好为 1」那种推导结论 ——
 * 由 carveRamps 挖出来时标记，客户端只负责画，寻路也只认它（见 cliffBetween）。
 * 下发它是为了让「画出来的」与「走得通的」严格一致：两端各自反推会漂移。
 */
function rampsToData(r) {
  if (!r || !r.length) return '';
  let s = '';
  for (let i = 0; i < r.length; i++) s += r[i] ? '1' : '0';
  return s;
}

/** 某一格的高度层（越界按 0：单位一辈子走不出图，别返回 undefined 让判定 NaN） */
function heightAtCell(hf, r, c) {
  if (!hf) return 0;
  if (r < 0 || r >= TERR_ROWS || c < 0 || c >= TERR_COLS) return 0;
  return hf[r * TERR_COLS + c];
}

/** 世界坐标处的高度层 */
function heightAtWorld(hf, x, y) {
  if (!hf || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
  return heightAtCell(hf, Math.floor(y / TERR_CELL), Math.floor(x / TERR_CELL));
}

/**
 * 攻击 **(ax,ay)** 打目标 **(bx,by)** 时的实际射程 —— 已计入高低差。
 *
 * 「地势高的打地势低的有射程加持」反过来吃亏：自身比目标每高一层 +HGT_STEP_PX，
 * 低一层 −同样多（HGT_STEP_PX = rangeCellsPerStep 格换算出的像素）。
 */
function effRange(hf, base, ax, ay, bx, by) {
  if (!hf) return base;
  const r = base + (heightAtWorld(hf, ax, ay) - heightAtWorld(hf, bx, by)) * HGT_STEP_PX;
  return r > 0 ? r : 0;
}

/** 某个单位打 **(bx,by)** 处目标时的实际射程（内部快捷写法：自动带上本局高度场） */
function unitRangeAt(game, u, bx, by) {
  return effRange(game.terrain && game.terrain.heights, u.range, u.x, u.y, bx, by);
}

function ensureOpenTerrain(grid, anchors) {
  const C = TERR_COLS;
  const R = TERR_ROWS;
  const anchorMask = new Uint8Array(R * C);
  if (anchors) {
    for (const a of anchors) {
      const r = a[0];
      const c = a[1];
      if (r >= 0 && r < R && c >= 0 && c < C) anchorMask[r * C + c] = 1;
    }
  }

  widenNarrow(grid);

  for (let pass = 0; pass < MAX_CARVE_PASSES; pass++) {
    const regs = wideRegions(wideMask(grid));
    if (regs.length <= 1) break;
    const main = regs[0];

    // ② 碎块：不含建筑锚点的直接填掉（先统计外围类型，再统一改，避免边改边统计）
    let filled = false;
    for (let i = 1; i < regs.length; i++) {
      if (regs[i].length >= MIN_REGION) continue;
      let hasAnchor = false;
      for (const id of regs[i]) {
        if (anchorMask[id]) {
          hasAnchor = true;
          break;
        }
      }
      if (hasAnchor) continue;
      let mtn = 0;
      let wat = 0;
      for (const id of regs[i]) {
        const r = (id / C) | 0;
        const c = id % C;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
            const v = grid[nr][nc];
            if (v === TT_MOUNTAIN) mtn++;
            else if (v === TT_WATER) wat++;
          }
        }
      }
      if (!mtn && !wat) continue; // 外围全是平原：说明只是窄颈没撑开，交给下面的开道处理
      const fill = wat > mtn ? TT_WATER : TT_MOUNTAIN;
      for (const id of regs[i]) grid[(id / C) | 0][id % C] = fill;
      filled = true;
    }
    if (filled) continue; // 地形变了，重新算连通块

    // ③ 一次多源 Dijkstra 就能给所有孤立区各开一条道：各自回溯到最大区即可
    const res = dijkstraFrom(grid, main);
    const dist = res.dist;
    const prev = res.prev;
    for (let i = 1; i < regs.length; i++) {
      let best = -1;
      let bd = Infinity;
      for (const id of regs[i]) {
        if (dist[id] < bd) {
          bd = dist[id];
          best = id;
        }
      }
      if (best < 0) continue;
      for (let cur = best; cur >= 0; cur = prev[cur]) carveWide(grid, (cur / C) | 0, cur % C);
    }
  }

  widenNarrow(grid); // 开完走廊可能又造出新的窄缝，再撑一次
}

/** 建筑（工厂 / 研究所 / 总部）所在的地形格：连通性保证必须给它们留出口 */
function terrainAnchors(game) {
  const out = [];
  const push = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    out.push([
      clamp(Math.floor(y / TERR_CELL), 0, TERR_ROWS - 1),
      clamp(Math.floor(x / TERR_CELL), 0, TERR_COLS - 1),
    ]);
  };
  for (const f of game.factories || []) push(f.x, f.y);
  for (const l of game.labs || []) push(l.x, l.y);
  for (const h of game.hqs || []) push(h.x, h.y);
  for (const p of game.players || []) if (p.baseX != null) push(p.baseX, p.baseY);
  return out;
}

/**
 * 开局收尾：把「建筑占位」也算成障碍，再补一次连通性开道。
 *
 * ⚠️ 这是「看着能通、实际走不通」的根因，也是必须单独做一遍的原因：
 *   ensureOpenTerrain / repairWide / repairConnect 那一整串只认**地形**（山/水），
 *   建筑占位是寻路掩码 passGrid 才加进去的。所以地图可以「地形上连成一整片」，
 *   建筑一落位就把某片地整个圈掉 —— 玩家看到的地图是连通的，路却不存在。
 *   实测（4 人局 ×3，开局建筑 size 全是 15 格时）：地形宽通道 1 片，
 *   加上建筑占位后多出 5~9 片；总部–门口研究所净缝甚至是**负 0.2 格**（占位圈重叠）。
 *
 * 做法与 ensureOpenTerrain 同源（连通片 + 多源 Dijkstra 回溯 + carveWide），只多两件事：
 *   ① 障碍 = 地形 **+ 建筑占位**（buildingBlockMask，口径与 passGrid 一致）；
 *      建筑自己**不开挖**（blk 的格跳过），但**可以从它旁边绕过去**——
 *      一座楼堵在 1 格宽的走廊里时，多源 Dijkstra 会就近穿山绕开，路就通了。
 *   ② 只修「小到不可能是设计意图」的碎块（≤ LANE_ORPHAN_MAX 格）：
 *      大到那片本身就是地形（湖心岛之类），硬接反而破图。
 *
 * ⚠️ 必须在 buildHeightField **之前**跑：新挖的走廊要参与高度场派生与挖坡口，
 *    否则会出现「地形上通了、层差 2 层 = 崖」，还是过不去。
 *
 * ⚠️ 对称：carveWide 走 setPlainSym（180° 点对称）。建筑成 C_N 轨道，
 *    每座建筑各自触发一次挖掘，天然覆盖各自的对称像，各家看到的地形仍然同构。
 *
 * @param {object} game 对局状态（就地改 terrain.grid）
 * @returns {number} 挖掉的格数（诊断用）
 */
function openLanesAroundBuildings(game) {
  const grid = game.terrain.grid;
  const blk = buildingBlockMask(buildingSites(game));
  if (!blk) return 0;
  const C = TERR_COLS;
  const R = TERR_ROWS;
  const TOT = C * R;
  /** 站得住人 = 地形可通行 ∧ 不在建筑占位里（与 passGrid 同口径） */
  const free = new Uint8Array(TOT);
  for (let i = 0; i < TOT; i++) {
    const r = (i / C) | 0;
    const c = i % C;
    if (blk[i]) continue;
    const v = grid[r][c];
    free[i] = v !== TT_MOUNTAIN && v !== TT_WATER ? 1 : 0;
  }
  let dug = 0;
  for (let round = 0; round < 4; round++) {
    // ① free 的 4-连通片，按大小降序
    const seen = new Uint8Array(TOT);
    const comps = [];
    const stack = [];
    for (let i = 0; i < TOT; i++) {
      if (!free[i] || seen[i]) continue;
      const cells = [];
      seen[i] = 1;
      stack.push(i);
      while (stack.length) {
        const cur = stack.pop();
        cells.push(cur);
        const cc = cur % C;
        const rr = (cur - cc) / C;
        if (rr > 0 && free[cur - C] && !seen[cur - C]) { seen[cur - C] = 1; stack.push(cur - C); }
        if (rr < R - 1 && free[cur + C] && !seen[cur + C]) { seen[cur + C] = 1; stack.push(cur + C); }
        if (cc > 0 && free[cur - 1] && !seen[cur - 1]) { seen[cur - 1] = 1; stack.push(cur - 1); }
        if (cc < C - 1 && free[cur + 1] && !seen[cur + 1]) { seen[cur + 1] = 1; stack.push(cur + 1); }
      }
      comps.push(cells);
    }
    if (!comps.length) break;
    comps.sort((a, b) => b.length - a.length);
    const orphans = comps.slice(1).filter((s) => s.length <= LANE_ORPHAN_MAX);
    if (!orphans.length) break;
    // ② 以主片为源做多源 Dijkstra（0=平原 / 1=水 / 3=山；建筑占位不可入）
    const res = dijkstraWithBlocks(grid, blk, comps[0]);
    let did = 0;
    for (const o of orphans) {
      let best = -1;
      let bd = Infinity;
      for (const id of o) {
        if (res.dist[id] < bd) {
          bd = res.dist[id];
          best = id;
        }
      }
      if (best < 0) continue; // 穿不过去：这块只能认了（不该发生，留作兜底退出）
      for (let cur = best; cur >= 0; cur = res.prev[cur]) {
        const rr = (cur / C) | 0;
        const cc = cur % C;
        if (grid[rr][cc] !== TT_PLAIN) {
          grid[rr][cc] = TT_PLAIN;
          dug++;
        }
        free[cur] = 1;
      }
      did++;
    }
    if (!did) break;
  }
  return dug;
}

/**
 * 开道专用的小权重 Dijkstra（0 平原 / 1 水 / 3 山），额外接受一张「绝对不可入」掩码。
 * 与 dijkstraFrom 的区别只有「代价表 + 屏蔽掩码」，所以另写一份而不去改 dijkstraFrom
 * （后者被地形补全那条链大量复用，动它的签名风险大）。
 */
function dijkstraWithBlocks(grid, blocks, sources) {
  const C = TERR_COLS;
  const R = TERR_ROWS;
  const TOT = C * R;
  const dist = new Int32Array(TOT).fill(0x3fffffff);
  const prev = new Int32Array(TOT).fill(-1);
  const hd = [];
  const hi = [];
  const hpush = (d, id) => {
    hd.push(d);
    hi.push(id);
    let i = hd.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      const td = hd[p]; hd[p] = hd[i]; hd[i] = td;
      const ti = hi[p]; hi[p] = hi[i]; hi[i] = ti;
      i = p;
    }
  };
  const hpop = () => {
    const d = hd[0];
    const id = hi[0];
    const ld = hd.pop();
    const li = hi.pop();
    if (hd.length) {
      hd[0] = ld;
      hi[0] = li;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const rr = l + 1;
        let m = i;
        if (l < hd.length && hd[l] < hd[m]) m = l;
        if (rr < hd.length && hd[rr] < hd[m]) m = rr;
        if (m === i) break;
        const td = hd[m]; hd[m] = hd[i]; hd[i] = td;
        const ti = hi[m]; hi[m] = hi[i]; hi[i] = ti;
        i = m;
      }
    }
    return [d, id];
  };
  for (const s of sources) {
    if (dist[s] === 0) continue;
    dist[s] = 0;
    hpush(0, s);
  }
  while (hd.length) {
    const [d, id] = hpop();
    if (d !== dist[id]) continue;
    const cc = id % C;
    const rr = (id - cc) / C;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = rr + dr;
        const nc = cc + dc;
        if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
        const nid = nr * C + nc;
        if (blocks[nid]) continue; // 建筑占位：绝不开挖、绝不当通路
        const v = grid[nr][nc];
        const w = v === TT_MOUNTAIN ? 3 : v === TT_WATER ? 1 : 0;
        const nd = d + w;
        if (nd < dist[nid]) {
          dist[nid] = nd;
          prev[nid] = id;
          hpush(nd, nid);
        }
      }
    }
  }
  return { dist, prev };
}

/** 把建筑（工厂/研究所/出生点）周围的山地清成平原，避免建筑与出兵点被不可通行的山封死。
 *  对每个建筑格，同时清理其 180° 旋转对应的格子（直接对格子索引旋转，避免坐标旋转再 floor 的错位），保持整图点对称。 */
function clearTerrainAroundBuildings(game, grid) {
  const R = TERRAIN_CLEAR_CELLS;
  const pts = []; // 存 [cellRow, cellCol]
  const pushCell = (bx, by) => {
    let cc = Math.floor(bx / TERR_CELL);
    let cr = Math.floor(by / TERR_CELL);
    if (cc < 0) cc = 0;
    else if (cc >= TERR_COLS) cc = TERR_COLS - 1;
    if (cr < 0) cr = 0;
    else if (cr >= TERR_ROWS) cr = TERR_ROWS - 1;
    // 对称由「每座建筑自己都在轨道上」保证：轨道上的孪生建筑各自都会 push 一次，
    // 于是清场范围天然就是对称的（末尾还有 symmetrizeGrid 兜底）
    pts.push([cr, cc]);
  };
  for (const f of game.factories) pushCell(f.x, f.y);
  for (const l of game.labs) pushCell(l.x, l.y);
  for (const p of game.players) {
    if (p.baseX == null) continue;
    pushCell(p.baseX, p.baseY);
  }
  for (const pt of pts) {
    const cr = pt[0];
    const cc = pt[1];
    for (let r = cr - R; r <= cr + R; r++) {
      for (let c = cc - R; c <= cc + R; c++) {
        if (r < 0 || r >= TERR_ROWS || c < 0 || c >= TERR_COLS) continue;
        // 山地与水域都不可通行，建筑周围一律清成平原
        if (grid[r][c] === TT_MOUNTAIN || grid[r][c] === TT_WATER) grid[r][c] = TT_PLAIN;
      }
    }
  }
}

/**
 * 生成地形并挂到对局状态上（权威来源，下发给客户端渲染）。
 * @param {string} [themeKey] 指定地图主题（房间指定 / 测试用）；不传则随机抽
 * @param {number|string} [themeSalt] 抽主题的额外扰动（默认用开局时刻）
 *        —— 同一个房间连开第二局也会换一种地貌，而不是永远同一张图
 */
function makeTerrain(game, seed, bands, themeKey, themeSalt, n) {
  const rng = makeRng((seed >>> 0) || 1);
  const theme =
    themeByKey(themeKey) ||
    pickTheme(hashStr(String(seed >>> 0) + '|theme|' + (themeSalt == null ? 0 : themeSalt)));
  // 对称阶数 = 玩家人数：地形跟着人数带上 N 重旋转 + N 条镜像轴
  const order = symOrder(n == null ? (game && game.players ? game.players.length : 4) : n);
  const noiseOut = {};
  const grid = generateTerrainGrid(rng, theme, order, noiseOut);
  // 暂存生成期的东西（主题、随机源、隔离带、噪声场）：挖完主路还要按同一套噪声把地形补回来。
  // 挂在 game 上而不是 game.terrain 上 —— terrain 会整份下发给客户端，不该夹带这些。
  game._mapGen = {
    theme,
    rng,
    bands,
    order,
    noise: noiseOut.noise || null,
    noiseSeed: noiseOut.noiseSeed || 0,
  };
  clearTerrainAroundBuildings(game, grid);
  // 第 5 项：隔离带整片压成平原（放在建筑清场之后，免得又被挖回山/水）
  carveIsolationBands(grid, bands);
  // 隔离带本身是 N 条等间隔射线（已经对称），这里只按**多数表决**抹掉栅格化的 ±1 格锯齿：
  // 若用并集传播，占图一成以上的隔离带会把每条轨道连锁掏空（实测地形量掉一半）。
  symmetrizeGrid(grid, order);
  game.terrain = {
    cols: TERR_COLS,
    rows: TERR_ROWS,
    cell: TERR_CELL,
    grid,
    // 本局地貌主题（客户端在小地图旁显示，玩家一眼知道这局是什么地形）
    theme: { key: theme.key, name: theme.name, desc: theme.desc || '' },
  };
  return game.terrain;
}

/* ---------------- 布局：绕世界中心的 N 重旋转对称 ---------------- */
// 出生点 / 研究所 / 中立工厂全部摆在「以世界中心为圆心」的圆环上等角分布（间隔 360°/N），
// 地形同样是 N 重对称的，于是每家门口看到的地形、到中心的距离、与邻居的关系完全同构。
// 数值入口：server/games/warfactory/data.js 的 layout 段。
const LAY = WFData.layout || {};
const BASE_R = Number(LAY.baseRadius) || 3200; // 出生圆环半径（px）
const BASE_JITTER = clamp(Number(LAY.baseJitter != null ? LAY.baseJitter : 0.2), 0, 0.6);
const LAB_R_K = Number(LAY.labRadiusK != null ? LAY.labRadiusK : 0.55); // 旧圆环系数（随机所落点半径参考）
const LAB_PER_PLAYER = Math.max(1, Math.round(LAY.labPerPlayer || 2));
/** 每家总部附近固定几座研究所（其余走中场随机轨道） */
const STARTER_LAB_PER_HQ = Math.max(0, Math.round(LAY.starterLabPerHq != null ? LAY.starterLabPerHq : 1));
const FAC_EDGE = Number(LAY.facEdge) || 700; // 中立工厂距地图边缘的最小留白
const FAC_GAP = Number(LAY.facGap) || 560; // 中立工厂之间的最小中心距
const FAC_R_MAX = Number(LAY.facRadiusMax) || 3150; // 中立工厂圆环的最大半径
/** 每家总部正前方固定几座初级厂（落在防卫射程内） */
const STARTER_FAC_PER_HQ = Math.max(0, Math.round(LAY.starterFacPerHq != null ? LAY.starterFacPerHq : 2));
/** 中场轨道再放几组初级厂（每组 n 座，与中/高级共用选址） */
const RANDOM_L1_PER_PLAYER = Math.max(0, Math.round(LAY.randomL1PerPlayer != null ? LAY.randomL1PerPlayer : 2));

/**
 * 从 (x,y) 指向地图中心的单位向量 + 右侧向量。
 * 总部「正前方」、开局亲兵阵列、门口初级厂共用这一套朝向。
 */
function dirTowardCenter(x, y) {
  let fx = WORLD_W * 0.5 - x;
  let fy = WORLD_H * 0.5 - y;
  const len = Math.hypot(fx, fy);
  if (len < 1e-6) return { fx: 0, fy: -1, rx: 1, ry: 0 };
  fx /= len;
  fy /= len;
  return { fx, fy, rx: -fy, ry: fx };
}

/** 出生圆环上的一点（角度 rad、半径 px） */
function circlePoint(angle, radius) {
  return {
    x: WORLD_W / 2 + Math.cos(angle) * radius,
    y: WORLD_H / 2 + Math.sin(angle) * radius,
  };
}

/**
 * 出生轨道：n 个总部，绕世界中心等角间隔 360°/n。
 * 地形是 N 重对称的，所以这 n 个点看到的地形一模一样 —— 这就是公平性的来源。
 * @param {number} phase 起始相位（每局随机，决定整张布局的朝向）
 * @param {number} radius 出生圆环半径
 * @param {number} n 对称阶数（= 人数）
 */
function baseOrbit(phase, radius, n) {
  const out = [];
  for (let k = 0; k < symOrder(n); k++) out.push(circlePoint(phase + (k * Math.PI * 2) / symOrder(n), radius));
  return out;
}

/* ---------------- 第 5 项：各出生区之间的「隔离带」---------------- */
// 每两个相邻出生方向之间各开一条扇形的隔离带：带内地形强制压成**平原**（可通行的平地），
// 且**不放任何工厂** —— 于是相邻玩家的出生区之间天然隔着一条空旷的缓冲地带。
// 带宽要克制：带内整片压成平原，N 条带加起来是很可观的一块面积。
// 地图上「地形量」本来就被 maxBlocked 封着，带开得太宽会把主题的地貌直接抹掉
// （实测 ±10° 的带能削掉汪洋四成的水），所以这里只取窄窄一条：够当缓冲带即可。
const BAND_HALF_ANGLE = 0.1; // 隔离带半角（弧度，约 ±6°）
const BAND_R_MIN = 0.3; // 带的内缘（归一化到出生半径的比例）
const BAND_R_MAX = 1.1; // 带的外缘

/**
 * 本局的隔离带方向表：相邻两家（轨道上等角间隔）的**角平分线**，共 n 条，同样等角间隔。
 * @param {number} count 玩家人数
 * @param {number} rot 出生轨道的起始相位（与 pickBasePositions 用同一个，保证带正好落在两家之间）
 * @returns {number[]} 各带中心方向（弧度，已归一化到 [0,2π)）
 */
function isolationBands(count, rot) {
  const n = symOrder(count);
  const TAU2 = Math.PI * 2;
  const out = [];
  for (let k = 0; k < n; k++) {
    // 第 k 家在 rot + k·(2π/n)，第 k+1 家在 rot + (k+1)·(2π/n) → 角平分线就是再转半格
    const mid = rot + ((k + 0.5) * TAU2) / n;
    out.push(((mid % TAU2) + TAU2) % TAU2);
  }
  return out;
}

/**
 * 隔离带在某个归一化半径处的**有效半角**：在半角上掺一层沿半径起伏的慢波（±18%，
 * 两端用 sin(πt) 收口 —— 带的径向端本来就是圆弧，边缘不该在那儿突然错开）。
 *
 * 为什么要它：半角恒定时带的两条边界是**从世界中心射出去的直线**，长度 60+ 格，
 * 横穿地形后照样把山切成直边块。
 * 只跟 rn 有关、不带带号 ⇒ 各条带逐字相同，绕中心旋转对称不破。
 */
function bandHalfAt(rn) {
  const span = Math.max(1e-6, BAND_R_MAX - BAND_R_MIN);
  const t = clamp((rn - BAND_R_MIN) / span, 0, 1);
  return BAND_HALF_ANGLE * (1 + 0.18 * Math.sin(Math.PI * t) * edgeWave(t, 0.37));
}

/** 某点是否落在任一隔离带内（工厂布局据此排除候选点） */
function inIsolationBand(bands, x, y) {
  if (!bands || !bands.length) return false;
  const dx = x - WORLD_W / 2;
  const dy = y - WORLD_H / 2;
  if (Math.hypot(dx, dy) < 1) return false;
  // 半径按出生**圆**环归一化（出生点是圆环上的等角点，用圆才对得上）
  const rn = Math.hypot(dx, dy) / BASE_R;
  if (rn < BAND_R_MIN || rn > BAND_R_MAX) return false;
  // 半角再叠一层 D_N 对称的二维边缘噪声 —— 光靠沿半径的慢波只是「一条被掰弯的直线」，
  // 加上这一层才是自然岸线。两处（这里与 carveIsolationBands）共用同一个函数，
  // 工厂避让口径与地形压制口径天然一致。
  const fr = clamp(Math.floor(y / TERR_CELL), 0, TERR_ROWS - 1);
  const fc = clamp(Math.floor(x / TERR_CELL), 0, TERR_COLS - 1);
  let half = bandHalfAt(rn);
  if (!process.env.WF_NOEDGENOISE) half *= 1 + 0.2 * edgeField(bands.length)[fr * TERR_COLS + fc];
  const a = Math.atan2(dy, dx);
  const TAU2 = Math.PI * 2;
  for (const b of bands) {
    // 角度差必须先取模再折半：atan2 的值域是 (−π, π]，而 bands 是 [0, 2π)，
    // 直接相减会超出 2π，折半后甚至算出负数 —— 负数恒 ≤ 半角，会把几乎全图误判成「在带内」。
    let diff = (((a - b) % TAU2) + TAU2) % TAU2; // → [0, 2π)
    if (diff > Math.PI) diff = TAU2 - diff; // → [0, π] 最短夹角
    if (diff <= half) return true;
  }
  return false;
}

/**
 * 把隔离带内的地形整片压成平原（带内「仅保留地形与平地」）。
 * @param {Uint8Array[]} [keep] 世界掩膜（1 = 这一格**不压**）。
 *   中场关口的中心正好压在隔离带上（隔离带就是「两家之间」的角平分线），
 *   不豁免的话关口会被隔离带从中间劈成两半 —— 那还叫什么关口。
 */
function carveIsolationBands(grid, bands, keep) {
  if (!bands || !bands.length) return;
  for (let r = 0; r < TERR_ROWS; r++) {
    for (let c = 0; c < TERR_COLS; c++) {
      if (keep && keep[r] && keep[r][c]) continue;
      const x = (c + 0.5) * TERR_CELL;
      const y = (r + 0.5) * TERR_CELL;
      if (inIsolationBand(bands, x, y)) grid[r][c] = TT_PLAIN;
    }
  }
}

/* ---------------- 相邻玩家之间的「进攻主路」---------------- */

/**
 * 环上相邻的玩家配对：把总部按「绕世界中心的极角」排序，取排序后相邻的两两组合（去重）。
 * 于是 4 人局是 4 对（每家左右各搭一家），2 人局只有 1 对（互为唯一邻居）。
 * @returns {number[][]} [[i,j], ...]
 */
function adjacentBasePairs(bases) {
  const n = bases.length;
  if (n < 2) return [];
  const cx = WORLD_W / 2;
  const cy = WORLD_H / 2;
  const ang = bases.map((b) => Math.atan2(b.y - cy, b.x - cx));
  const idx = bases.map((_, i) => i).sort((a, b) => ang[a] - ang[b]);
  const seen = new Set();
  const out = [];
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    const j = idx[(k + 1) % n];
    if (i === j) continue;
    const key = i < j ? i + '#' + j : j + '#' + i;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([i, j]);
  }
  return out;
}

/**
 * 沿一条折线把两侧半宽内的山 / 水压成平原（圆盘逐点扫，步长半格 → 不留缝）。
 *
 * ⚠️ 半宽**逐格**乘上一个 D_N 对称的边缘噪声（见 edgeField）：等宽扫掠出来的边缘是一条
 *    数学直线，横穿地形会把山切成直边块 —— 实测 2 人局主路占 17.6% 图幅、
 *    33% 的地形外缘紧贴主路，玩家看到的就是「本该是斜向的地形，被硬生生拉出一条直线」。
 *    噪声夹在 `halfCells ± 1~2 格` 内，下限按 `roads` 的硬口径收（净宽不许低于名义半宽的 86%）。
 *
 * @param {number[][]} grid 地形网格
 * @param {number[][]} pts 折线采样点 [x, y]（像素）
 * @param {number} halfCells 名义半宽（格）
 * @param {Float32Array} [field] edgeField 的产物（不传 = 不抖，退化成老口径）
 * @returns {number} 被改成平原的格子数
 */
function carveRoadPath(grid, pts, halfCells, field) {
  const n = pts.length;
  const amp = clamp(halfCells * 0.22, 1.0, 2.2);
  const floor = Math.max(halfCells - 1.4, halfCells * 0.86);
  const rMax = (halfCells + amp) * TERR_CELL;
  let carved = 0;
  for (let i = 0; i < n; i++) {
    const px = pts[i][0];
    const py = pts[i][1];
    const c0 = Math.max(0, Math.floor((px - rMax) / TERR_CELL));
    const c1 = Math.min(TERR_COLS - 1, Math.floor((px + rMax) / TERR_CELL));
    const r0 = Math.max(0, Math.floor((py - rMax) / TERR_CELL));
    const r1 = Math.min(TERR_ROWS - 1, Math.floor((py + rMax) / TERR_CELL));
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5) * TERR_CELL - py;
      const rowBase = r * TERR_COLS;
      for (let c = c0; c <= c1; c++) {
        const fv = field ? field[rowBase + c] : 0;
        const rr = Math.max(floor, halfCells + amp * fv) * TERR_CELL;
        const dx = (c + 0.5) * TERR_CELL - px;
        if (dx * dx + dy * dy > rr * rr) continue;
        if (grid[r][c] !== TT_PLAIN) {
          grid[r][c] = TT_PLAIN;
          carved++;
        }
      }
    }
  }
  return carved;
}

/**
 * 主路中心线的采样点：从 a 的总部出发、到 b 的总部结束，中间向一侧鼓开。
 * 鼓开量 = sign × (ROAD_W + ROAD_GAP) × [fanEnd + (1-fanEnd)·sin(πt)]：
 *   两端只张开 fanEnd（贴着自家总部起步），中场张到最大（三条路彻底分开），
 *   再对称收拢到对方总部 —— 于是三条路都是「从我家到你家」的完整通路，而不是半路插进来。
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @param {number} signed 有符号横向偏移（格）：中路 0，上/下路 ±(路宽+间隔)
 */
/**
 * 「一条弓」的形状函数：0 → 1 → 0，关于 t = 1/2 对称（自镜像，见 roadLanes）。
 * sin(πt) 掺一点奇次谐波后，两头爬得更快、中段更平 —— 路线读起来是「岔出去 →
 * 沿外/内圈平着走一段 → 切回来」，而不是一条懒洋洋的弧线。
 * @returns {number} 归一化到峰值 1
 */
const ROAD_EVEN_NORM = (() => {
  let mx = 0;
  for (let i = 1; i < 400; i++) {
    const t = i / 400;
    mx = Math.max(mx, Math.abs(Math.sin(Math.PI * t) + ROAD_WAVE3 * Math.sin(3 * Math.PI * t) + ROAD_WAVE5 * Math.sin(5 * Math.PI * t)));
  }
  return mx || 1;
})();
function roadBow(t) {
  if (t <= 0 || t >= 1) return 0;
  const v = Math.sin(Math.PI * t) + ROAD_WAVE3 * Math.sin(3 * Math.PI * t) + ROAD_WAVE5 * Math.sin(5 * Math.PI * t);
  return Math.max(0, v) / ROAD_EVEN_NORM;
}

/**
 * 走廊边缘的**确定性慢波**（−1..1）—— 主路的中心线蛇行用它。
 *
 * 为什么必须确定（而不是 Math.random）：主路的几何要在 N 个对称位置上**逐字相同**
 * （carveMainRoads 只是把同一份折线旋转过去再挖一遍）。用即时时序随机会让各个像的边缘
 * 各漂各的 —— 对称误差立刻飙起来。所以扰动只能跟「路径下标」有关，旋转后下标不变。
 *
 * @param {number} t 0..1（非闭合参数：路径进度 / 归一化半径）
 * @param {number} [k] 相位种子：同一条路的不同车道取不同值，别让它们同步起伏
 * @returns {number} −1..1
 */
function edgeWave(t, k) {
  const s = (Number(k) || 0) * 1.7;
  const u = t * Math.PI * 2;
  return (
    Math.sin(u * 3.7 + s) * 0.55 +
    Math.sin(u * 8.3 + s * 2.1) * 0.29 +
    Math.sin(u * 17 + s * 3.7) * 0.16
  );
}

/** 二维平滑值噪声（双线性 + smoothstep），值域 −1..1。不依赖 rng ⇒ 各处调用结果一致 */
function wfSmoothNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const h = (a, b) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const n00 = h(xi, yi);
  const n10 = h(xi + 1, yi);
  const n01 = h(xi, yi + 1);
  const n11 = h(xi + 1, yi + 1);
  return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
}

/**
 * 「走廊边缘噪声场」—— 全图一格的采样值，用来把**挖出来的直线边缘**打碎成自然岸线。
 *
 * 关键三点：
 *  ① **D_N 对称**：先 `foldToWedge` 折回楔形再取噪声 ⇒ 同一条 D_N 轨道的所有像取值完全相同，
 *     主路 / 隔离带 / 关口的边缘在 n 个方向上逐格重合，对称误差纹丝不动。
 *  ② **不依赖 rng / 种子**：只用「世界坐标 + 阶数」算，于是**探针**（`roadPlainFor` 那张
 *     「全是山」的图）与生成器内部算出的是同一张路面掩膜 —— 这一点是硬要求，
 *     搬迁判据 / 地形参战率都建立在「两处口径一致」上。
 *  ③ **按阶数缓存**：8.3 万格的 hypot+atan2+hash 只算一次（约 10ms），之后全是查表。
 *
 * 波长取 7 格（大起伏）+ 2.6 格（小碎边）两个八度：前者让走廊边缘摆动几个格，
 * 后者给边界加一点 1~2 格的碎屑感 —— 也就是一片真海岸线该有的样子。
 */
const EDGE_FIELD_CACHE = new Map();
function edgeField(order) {
  const n = symOrder(order);
  const hit = EDGE_FIELD_CACHE.get(n);
  if (hit) return hit;
  const f = new Float32Array(TERR_ROWS * TERR_COLS);
  const big = TERR_CELL * 7;
  const small = TERR_CELL * 2.6;
  for (let r = 0; r < TERR_ROWS; r++) {
    const y = (r + 0.5) * TERR_CELL;
    for (let c = 0; c < TERR_COLS; c++) {
      const x = (c + 0.5) * TERR_CELL;
      const p = foldToWedge(x, y, n);
      f[r * TERR_COLS + c] =
        wfSmoothNoise(p[0] / big, p[1] / big) * 0.68 + wfSmoothNoise(p[0] / small + 31.7, p[1] / small + 11.3) * 0.32;
    }
  }
  EDGE_FIELD_CACHE.set(n, f);
  return f;
}

/**
 * 三条主路各自的形状函数 s(t)：沿弦走到 t 处，要向侧下方偏多少格（+ = 远离世界中心）。
 *
 * 关键点：这三条**各自都是自镜像的**（s(t) = s(1−t)），不像早先那条&-平移的带子。
 * 自镜像的形状函数 = sin(πt) 及其**奇次**谐波之和（奇次谐波在 t → 1−t 下不变号），
 * 于是每一条单独连通两家、单独左右对称，三条合起来仍是严格 D_N 对称 ——
 * 而且**天然互不相交**（一条恒在中路的内侧、一条恒在外侧，只有家门口那一段重合），
 * 不必再算「绕后路会不会切到正面路」这类交叉条件。
 *
 * @param {number} per 这一对之间要几条路（data.js 的 roads.perPair）
 * @returns {((t:number)=>number)[]} 顺序：内圈（侧翼）/ 中路（正面）/ 外圈（绕后）
 */
/**
 * 三条主路各自的深度（格）：沿弦走到 t 处时，要向侧边偏 深度 × 弓形(t)。
 *
 * 关键点：这三条**各自都是自镜像的**（形状关于中点对称），不像早先那条「平移出来的带子」。
 * 自镜像的形状 = sin(πt) 及其**奇次**谐波之和（奇次谐波在 t → 1−t 下不变号），
 * 于是每一条单独连通两家、单独左右对称，三条合起来仍是严格 D_N 对称 ——
 * 而且**天然互不相交**（一条恒在正面路的内侧、一条恒在外侧，只有家门口那一段重合），
 * 不必再算「绕后路会不会切成正面路」这类交叉条件。
 *
 * 三条的深度不是写死的常数，而是**把这一对之间剩下的整条径向空地三等分**：
 * 内侧 empty 多少、外侧 empty 多少，各局差得远（地图是方的：正对边方向只剩 ~50 格，
 * 对角方向能到 ~130 格；4 人局弦中点离边近、3 人局离中心近），写死就会有一条被压扁。
 *
 * @param {number} per 这一对之间要几条路（data.js 的 roads.perPair）
 * @param {number} roomIn 最多能往地图中心侧兜进去多少格（负数）
 * @param {number} roomOut 最多能往地图外侧甩出去多少格（正数）
 * @returns {number[]} 顺序：侧翼 / 正面 / 绕后（跟 ROAD_ROLES 对齐）
 */
function roadDepths(per, roomIn, roomOut, ord) {
  if (per === 3) {
    // 三条**等距**铺在 [roomIn, roomOut] 这条带上：这样两道「种子」山/水一样宽，
    // 不会一边 60 格、一边 30 格 —— 横穿难度由最窄的那道决定，等分最划算。
    let mid = (roomIn + roomOut) / 2;
    // 2 人局要**关于弦对称**（[−d, 0, +d]）：两家是对径点，弦就是直径，折回楔形用的
    // 是带镜像的 D_2 —— 镜像会把 +d 那一侧翻到 −d 那一侧。深度集合若不自对称，
    // 整条路网就不闭合于折群：后续「挖开一格就把整条轨道并集传播」会把走廊翻一倍
    // （实测 2 人局被吃掉 15 个点地形），不传播则对称误差飙到 3%+。
    if (ord === 2) {
      const d = Math.min(Math.abs(roomIn), roomOut);
      return [-d, 0, d];
    }
    // ⚠️ 中路不许压在两家的**连线**上。
    // 连线（弦）是「总部 ↔ 总部」的直线，中场关口就压在它中点上（见 gateRects）；
    // 中路若是这条弦，路就会把关口从中线挖穿 —— 实测 3/4 人局连线 129~183 格
    // 全程一格都不被挡，两家之间又变成一马平川的直达大道，关口形同虚设。
    // 所以中路至少偏出自己的半幅 + 几格余量，让连线整条落在关口地形上。
    const away = ROAD_HALF + 4;
    const lo = Math.min(roomIn, roomOut);
    const hi = Math.max(roomIn, roomOut);
    if (Math.abs(mid) < away && hi - lo > away * 2 + 2) {
      // 往空地更阔的那一侧推
      mid = clamp(roomOut >= Math.abs(roomIn) ? away : -away, lo + 1, hi - 1);
    }
    return [roomIn, mid, roomOut];
  }
  // perPair 不是 3 的时候退回「同一条曲线平移出一组平行路」：
  // 成对 ±（镜像）排列，奇数时中间留一条 0，一样保得住 D_N 对称。
  const spread = Math.max(ROAD_W + ROAD_GAP, ROAD_W * 1.5);
  const out = [];
  const half = (per - 1) / 2;
  for (let k = 0; k < per; k++) {
    const cap = Math.max(roomIn * -1, roomOut);
    out.push(Math.max(-cap, Math.min(cap, (k - half) * spread)));
  }
  return out;
}

/**
 * 各条路的角色名（跟 roadDepths 的顺序一致：内 → 外），只给预览 / 测试标注用。
 * 4 条（2 人局）时中间两条都是「正面」—— 它们对称地贴在连线两侧，谁也不压在连线上。
 */
const ROAD_ROLES = ['flank', 'front', 'ambush', 'ambush'];
/** 每对几条路：按人数取（2 人局要偶数条，详见 ROAD_PER_BY_PLAYERS） */
const ROAD_PER_MAX = Math.max(ROAD_PER_PAIR, ...[2, 3, 4].map((n) => roadPerPair(n)));

function roadLanes(a, b, order) {
  // 这条路要被旋转复制 N 份（见 carveMainRoads），所以**每一份**都得留在图内：
  // 地图是方的，某个方向上能到 203 格（对角），转 120° 之后同样的点可能就出图了 ——
  // 只按「0 号那一对」量空地的话，实测 3 人局的绕后路有 41/417 个采样点落在图外。
  // 没传就按两家**绕世界中心的夹角**反推（外部直接调用 / 老测试）。
  let ord = Math.round(Number(order) || 0);
  if (ord < 2) {
    const TAU = Math.PI * 2;
    let d = Math.abs(Math.atan2(b.y - WORLD_H / 2, b.x - WORLD_W / 2) - Math.atan2(a.y - WORLD_H / 2, a.x - WORLD_W / 2)) % TAU;
    if (d > Math.PI) d = TAU - d;
    ord = clamp(Math.round(TAU / Math.max(1e-6, d)), 2, SYM_MAX_N);
  }
  const cosR = [];
  const sinR = [];
  for (let k = 0; k < ord; k++) {
    cosR.push(Math.cos((k * 2 * Math.PI) / ord));
    sinR.push(Math.sin((k * 2 * Math.PI) / ord));
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let nx = -uy;
  let ny = ux;
  // 横向要取在两家连线的中垂线上：这条线同时过世界中心和弦中点，
  // 只有在这个坐标系里「t → 1−t、横向不变」才等于这一对的镜像，三条路才能各自自镜像。
  let ox = (a.x + b.x) / 2 - WORLD_W / 2;
  let oy = (a.y + b.y) / 2 - WORLD_H / 2;
  const ol = Math.hypot(ox, oy);
  if (ol > 1) {
    ox /= ol;
    oy /= ol;
  } else {
    // 2 人局：两家是对径点，弦从正中穿过，往哪边偏都一样 —— 取固定的一侧，
    // 好在同一个种子下结果可复现。
    ox = nx;
    oy = ny;
  }
  if (nx * ox + ny * oy < 0) {
    nx = -nx;
    ny = -ny; // 统一让 +s 朝「外」（远离世界中心）
  }
  const steps = Math.max(24, Math.ceil(len / (TERR_CELL * 0.5)));
  const rim = (ROAD_HALF + 1) * TERR_CELL; // 路自身半幅 + 一格余量，别贴着图边
  // 中央留空：侧翼路不许啃进正中间这一圈，中间要留得住一整块大地形（见 topUpCore）。
  // 2 人局的弦本来就压在世界中心上（再怎么绕都躲不开），这时自动放弃这条约束。
  let corePx = ROAD_CORE_GAP * TERR_CELL;
  if (corePx > 0) {
    let dmin = Infinity;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      dmin = Math.min(dmin, Math.hypot(a.x + ux * len * t - WORLD_W / 2, a.y + uy * len * t - WORLD_H / 2));
    }
    if (dmin < corePx + rim) corePx = 0;
  }
  // 量这一侧到底有多深：给一个深度 d（格，可正可负），看整条 polyline 是否还装得下。
  // 用**扫描**而不是二分：地图是方的，装得下的集合未必是单调区间，扫一遍最稳。
  const deepest = (sign, nominal) => {
    const stays = (d) => {
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const off = sign * d * roadBow(t) * TERR_CELL;
        const px = a.x + ux * len * t + nx * off;
        const py = a.y + uy * len * t + ny * off;
        const rx = px - WORLD_W / 2;
        const ry = py - WORLD_H / 2;
        // 中央留空是绕中心的旋转不变量，量一次就够
        if (corePx > 0 && Math.hypot(rx, ry) < corePx) return false;
        // 图内这一条要对**每一份旋转像**都成立（3 人局转 120° 后对角方向会出图）
        for (let k = 0; k < ord; k++) {
          const x = WORLD_W / 2 + rx * cosR[k] - ry * sinR[k];
          const y = WORLD_H / 2 + rx * sinR[k] + ry * cosR[k];
          if (x < rim || x > WORLD_W - rim || y < rim || y > WORLD_H - rim) return false;
        }
      }
      return true;
    };
    const cap = nominal * ROAD_FIT_MAX; // 名义值 × 允许的最大放大倍数就是上限
    const stepD = Math.max(1, cap / 60);
    let best = 0;
    for (let d = 0; d <= cap + 1e-9; d += stepD) {
      if (!stays(d)) break;
      best = d;
    }
    return Math.max(0, best - stepD * 0.5); // 退半步，别贴着约束边
  };
  const roomOut = deepest(1, ROAD_OUTER);
  const roomIn = -deepest(-1, ROAD_INNER);
  const per = roadPerPair(ord);
  const depths = roadDepths(per, roomIn, roomOut, ord);
  // 车道**蛇行**：中心线沿路径左右摆 ±ROAD_WOBBLE 格（用 sin(πt) 收口 —— 两头必须
  // 严丝合缝地钉在总部与关口上，抖了反而对不齐）。
  //
  // 为什么非抖不可：三条路的深度是**常数 × 弓形**，中段那几十格就是一条数学直线；
  // 等宽圆盘扫过去，走廊边缘也是直线 —— 实测 2 人局主路占 17.6% 图幅、
  // 33% 的地形外缘紧贴主路，玩家看到的就是「本该是斜向的地形被硬拉出一条直线」。
  // 蛇行只动**中心线**、不动半宽 ⇒ 主路净宽口径一字不变（`roads.widthCells` 是硬需求），
  // 但边缘成了一条自然岸线。相位只跟车道号有关 ⇒ 旋转复制出来的各个像逐格重合，对称不破。
  // WF_NOEDGENOISE=1 关掉整套走廊边缘噪声（蛇行 + 逐格抖动），做 A/B 对照用
  const ROAD_WOBBLE = process.env.WF_NOEDGENOISE ? 0 : 3.2;
  const lanes = depths.map(() => []);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const env = Math.sin(Math.PI * t);
    for (let i = 0; i < depths.length; i++) {
      const wob = env > 0 ? ROAD_WOBBLE * env * edgeWave(t, i + 1) : 0;
      const off = (depths[i] * roadBow(t) + wob) * TERR_CELL;
      lanes[i].push([a.x + ux * len * t + nx * off, a.y + uy * len * t + ny * off]);
    }
  }
  return lanes;
}

/**
 * 给每一对环上相邻的玩家挖出 ROAD_PER_PAIR 条主路（上 / 中 / 下），每条净宽 ROAD_W 格。
 * 只把山 / 水压成平原，平原格子不动 —— 于是「超级平原」这类主题不会有任何变化，
 * 而「群山」只在路上被切开几道口子，山仍然连绵。
 * @returns {{from:number,to:number,lane:number,pts:number[][]}[]} 主路记录（测试与预览页用）
 */
function carveMainRoads(grid, bases, n) {
  const pairs = adjacentBasePairs(bases);
  const out = [];
  if (!grid || !grid.length) return out;
  const order = symOrder(n == null ? (bases ? bases.length : SYM_MAX_N) : n);
  const a0 = bases[0];
  const b0 = bases[1];
  if (!a0 || !b0) return out;
  // 只算**一次**「相邻两家之间的路」，其余各家一律用它的旋转像：
  // 出生点是 C_N 轨道、地形也是 N 重对称的，所以每家那段路本该一模一样。
  // 这里必须共用同一份几何 —— 若逐对各算一遍，「路带贴边时平移回图内」那一步各家算出来的
  // 平移量不同，路的边缘就会错开；后面为了抹平误差做的对称传播，会把主路扫到的地形
  // 在 N 个方向上各再抹一遍（地形就是这么被吃光的）。
  const base = roadLanes(a0, b0, order);
  for (const pr of pairs) {
    const a = bases[pr[0]];
    const b = bases[pr[1]];
    if (!a || !b) continue;
    // 这一对是「第 0 对」转过几格？用它去取对应的旋转像
    let s = -1;
    for (let k = 0; k < order; k++) {
      const pa = rotateAround(a0.x, a0.y, k, order);
      if (Math.hypot(pa.x - a.x, pa.y - a.y) < 2) {
        s = k;
        break;
      }
    }
    const lanes =
      s >= 0
        ? // 注意 rotateAround 返回的是 {x,y}，而路点一律用 [x,y] 数组（carveRoadPath 按下标取）
          base.map((pts) => pts.map((p) => {
            const q = rotateAround(p[0], p[1], s, order);
            return [q.x, q.y];
          }))
        : roadLanes(a, b); // 兜底：出生点不是标准轨道时（外部调用 / 老测试）照旧各算一遍
    const per = lanes.length;
    const edgeN = process.env.WF_NOEDGENOISE ? null : edgeField(order);
    for (let k = 0; k < per; k++) {
      carveRoadPath(grid, lanes[k], roadHalfOf(per, k), edgeN);
      // role 只是给预览页 / 测试标注用的；perPair ≠ 3 时退回平行路，就谈不上角色了
      out.push({ from: pr[0], to: pr[1], lane: k, role: ROAD_ROLES[Math.min(k, ROAD_ROLES.length - 1)], pts: lanes[k] });
    }
  }
  return out;
}

/**
 * 主路扫到哪些格子（世界掩膜，1 = 路面）。
 *
 * 做法是在一张「全是山」的探针图上重挖一遍主路：挖开的就是路面 —— 跟地形无关，
 * 于是同一局地图在搬迁前 / 搬迁后算出来的是同一张图（搬迁判据正需要这个）。
 * 竞赛验兵 -acid Bombardment: warfactory-terrain-check.js 用它量「地形参战率」，
 * 必须跟生成器内部（roadPlainOf）**同一张** —— 另挖一遍会隔着一层栅格化误差。
 */
function roadPlainFor(bases, n) {
  const order = symOrder(n == null ? (bases ? bases.length : SYM_MAX_N) : n);
  const probe = [];
  for (let r = 0; r < TERR_ROWS; r++) probe[r] = new Array(TERR_COLS).fill(TT_MOUNTAIN);
  carveMainRoads(probe, bases, order);
  const mk = [];
  for (let r = 0; r < TERR_ROWS; r++) {
    mk[r] = new Uint8Array(TERR_COLS);
    for (let c = 0; c < TERR_COLS; c++) if (probe[r][c] === TT_PLAIN) mk[r][c] = 1;
  }
  return mk;
}

/* ---------------- 中场关口：两家之间不许一马平川地直达 ---------------- */
// 每对相邻总部的连线中点上压一道**横跨连线**的大地形（山主题是台地山墙、水主题是内陆湖）。
// 于是「总部 ↔ 总部」不再是一条笔直的大道：
//   · 正面主路只能从关口里挖出的那条峡谷穿过 —— 两侧全是山 / 水，是整个战场的 bottleneck；
//   · 侧翼 / 绕后两条主路从关口的内外两侧绕过去（关口尺寸就是按「不碰到这两条路」定的）；
//   · 关口是 D_N 对称的（每对都放、几何全等），所以每家门口看到的关口一模一样。
//
// 两个容易踩的坑：
//   ① 跨度**不能写死**：3 人局的弦中点离世界中心近、内侧空地小，写死 54 格会把侧翼路一起
//      埋掉（那条路就断了）。所以按「正面路中点到旁边两条路还隔多远」自适应。
//   ② 关口压在**隔离带**上：隔离带正是「两家之间」的角平分线，不豁免的话关口会被
//      隔离带从中间劈成两半（见 carveIsolationBands 的 keep 参数）。

/** 关口用哪种地形：山主题的关口是山墙，水主题的是一片湖（跟主题的主地貌保持一致） */
function gateTypeOf(theme) {
  const mix = theme && theme.mix;
  return mix && mix.water > mix.mountain ? TT_WATER : TT_MOUNTAIN;
}

const GATE_CACHE = new WeakMap(); // bases 数组 → 关口几何（生成期会反复取，算一次就够）

/**
 * 每对相邻总部的关口几何。坐标系：u = 沿两家连线，n = 垂直连线。
 * @returns {{cx:number,cy:number,ux:number,uy:number,nx:number,ny:number,halfSpan:number,halfThick:number}[]}
 */
function gateRects(bases, order, gk) {
  if (!bases || bases.length < 2) return [];
  const k = clamp(Number(gk) || 1, 0.3, 1.5);
  const hit = GATE_CACHE.get(bases);
  if (hit && hit.k === k) return hit.rects;
  const geos = [];
  let roomMin = Infinity;
  for (const pr of adjacentBasePairs(bases)) {
    const a = bases[pr[0]];
    const b = bases[pr[1]];
    if (!a || !b) continue;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L;
    const uy = dy / L;
    // 关口只能占「正面路之外」的那条空隙：量一下旁边两条路在中点处离连线多远。
    // （roadLanes 的形状函数在 t=0.5 处取峰值 1，所以中点的横向偏移就是它的深度）
    const lanes = roadLanes(a, b, order);
    // 「正面路」= 离连线最近的那（几）条：它要从关口里穿过去，不参与「关口能跨多宽」的计算。
    // ⚠️ 不能写死 k === 1：2 人局是 4 条路（见 ROAD_PER_BY_PLAYERS），贴着连线的是中间两条。
    const near = lanes.map((pts) => {
      if (!pts || !pts.length) return Infinity;
      const m2 = pts[(pts.length / 2) | 0];
      return Math.hypot(m2[0] - mx, m2[1] - my) / TERR_CELL;
    });
    const nearest = Math.min.apply(null, near);
    for (let k = 0; k < near.length; k++) {
      if (near[k] <= nearest + 1) continue; // 正面路（可能两条）：从关口里穿过
      roomMin = Math.min(roomMin, near[k]);
    }
    geos.push({ cx: mx, cy: my, ux, uy, nx: -uy, ny: ux });
  }
  if (!Number.isFinite(roomMin)) roomMin = GATE_SPAN / 2;
  // 尺寸**全图统一**：地图是方的，各对的可用空地本来就不一样多（正对边方向贴着图边、
  // 对角方向能到 130 格）。逐对各自取宽会让 n 个关口大小不一 —— 那还叫哪门子对称
  // （实测对称误差直接飙到 3%）。取最窄的那一对，大家一样大。
  // 退 ROAD_HALF + 3：留出正面路的路面宽度，再留 3 格余量，免得蹭掉旁边那条路的边。
  const halfSpan = Math.min(GATE_SPAN / 2, Math.max(GATE_MIN_SPAN / 2, roomMin - ROAD_HALF - 3));
  // 稀疏主题（超级平原这种几乎无险可守的）按比例缩小：关口是**白送**的地形，
  // 不缩的话超级平原的山能从 5% 顶到 8.5%，主题预设就形同虚设了。
  const out = geos.map((g) => ({
    ...g,
    // 阶数带下去：gateHit 的边缘噪声要按它折回楔形（口径与主路 / 隔离带同一套）
    order,
    halfSpan: Math.max((GATE_MIN_SPAN / 2) * k, halfSpan * k),
    halfThick: Math.max((GATE_MIN_THICK / 2) * k, (GATE_THICK / 2) * k),
  }));
  GATE_CACHE.set(bases, { k, rects: out });
  return out;
}

/**
 * 关口的尺寸系数：按这个主题的地形总量缩放。
 * 关口是**白送**的地形（不计入主题的 mix 额度，只是占位），主题越稀疏它越显得突兀 ——
 * 实测不缩放时超级平原的山会从预设的 5% 顶到 8.5%（余量只有 ±3%）。
 */
function gateSizeK(theme) {
  const mix = theme && theme.mix;
  const sum = mix ? clamp(mix.mountain + mix.water, 0, 0.6) : 0.22;
  return clamp(0.45 + (sum / 0.26) * 0.55, 0.45, 1.15);
}

/** 关口的逐格判定（超椭圆 + 外缘边缘噪声，见 GATE_ROUND_P / edgeField） */
function gateHit(g, x, y) {
  const du = (x - g.cx) * g.ux + (y - g.cy) * g.uy;
  const dn = (x - g.cx) * g.nx + (y - g.cy) * g.ny;
  // 外缘乘一层 D_N 对称的边缘噪声（±22%）：超椭圆 p=3 的四条长边仍是「一把尺子量出来的
  // 直线」，不掺就是地图正中最显眼的几块直角矩形。噪声取自 edgeField（楔形折叠坐标），
  // 所以每个关口与它的 D_N 像形状逐格相同，`gateMaskOf` / `stampGates` 口径也天然一致。
  const fr = clamp(Math.floor(y / TERR_CELL), 0, TERR_ROWS - 1);
  const fc = clamp(Math.floor(x / TERR_CELL), 0, TERR_COLS - 1);
  const grow = process.env.WF_NOEDGENOISE ? 1 : 1 + 0.16 * edgeField(g.order || SYM_MAX_N)[fr * TERR_COLS + fc];
  const a = Math.abs(du / (g.halfThick * TERR_CELL * grow));
  const b = Math.abs(dn / (g.halfSpan * TERR_CELL * grow));
  return Math.pow(a, GATE_ROUND_P) + Math.pow(b, GATE_ROUND_P) <= 1;
}

/** 关口的世界掩膜（1 = 关口内）：给隔离带豁免 / 工厂避让 / 补地形禁笔用 */
function gateMaskOf(bases, order, gk) {
  const mask = [];
  for (let r = 0; r < TERR_ROWS; r++) mask[r] = new Uint8Array(TERR_COLS);
  for (const g of gateRects(bases, order, gk)) {
    const rad = Math.ceil(g.halfSpan + g.halfThick) + 2;
    const c0 = Math.max(0, Math.floor(g.cx / TERR_CELL - rad));
    const c1 = Math.min(TERR_COLS - 1, Math.ceil(g.cx / TERR_CELL + rad));
    const r0 = Math.max(0, Math.floor(g.cy / TERR_CELL - rad));
    const r1 = Math.min(TERR_ROWS - 1, Math.ceil(g.cy / TERR_CELL + rad));
    for (let r = r0; r <= r1; r++) {
      const y = (r + 0.5) * TERR_CELL;
      for (let c = c0; c <= c1; c++) {
        if (gateHit(g, (c + 0.5) * TERR_CELL, y)) mask[r][c] = 1;
      }
    }
  }
  return mask;
}

/**
 * 把关口盖到地形图上。
 * @param {Uint8Array[]} [skip] 世界掩膜（1 = 这一格不许改）：建筑清场圈 / 主路走廊
 * @returns {number} 实际改掉的格数
 */
function stampGates(grid, bases, order, type, skip, gk) {
  let put = 0;
  for (const g of gateRects(bases, order, gk)) {
    const rad = Math.ceil(g.halfSpan + g.halfThick) + 2;
    const c0 = Math.max(0, Math.floor(g.cx / TERR_CELL - rad));
    const c1 = Math.min(TERR_COLS - 1, Math.ceil(g.cx / TERR_CELL + rad));
    const r0 = Math.max(0, Math.floor(g.cy / TERR_CELL - rad));
    const r1 = Math.min(TERR_ROWS - 1, Math.ceil(g.cy / TERR_CELL + rad));
    for (let r = r0; r <= r1; r++) {
      const y = (r + 0.5) * TERR_CELL;
      for (let c = c0; c <= c1; c++) {
        if (skip && skip[r] && skip[r][c]) continue;
        if (!gateHit(g, (c + 0.5) * TERR_CELL, y)) continue;
        if (grid[r][c] !== type) {
          grid[r][c] = type;
          put++;
        }
      }
    }
  }
  return put;
}

/**
 * 中立战争工厂（按人数动态生成，N 重旋转对称）。
 * 「人均 4 初 / 2 中 / 1 高」：2 人 = 8+4+2、3 人 = 12+6+3、4 人 = 16+8+4。
 * 每座都与它绕世界中心的 N-1 个**旋转孪生厂**成组出现（一组 n 座，等角间隔），
 * 同组同兵种（assignProdTypes 据此配对），保证对称性公平。
 * 避让：地图边缘、研究所、彼此最小间距、以及各家总部（本函数在总部定好之后调用）。
 */
let NEUTRAL_FACTORIES = [];

/**
 * 每家总部正前方固定摆 STARTER_FAC_PER_HQ 座初级厂。
 * 距离卡在「不撞总部」与「总部防卫射程打得到」之间，左右对称成列，开局就能打。
 */
function placeStarterFactoriesNearHqs(bases) {
  const out = [];
  if (!bases || !bases.length || STARTER_FAC_PER_HQ <= 0) return out;
  // 中心距：下限按「占位 + 净缝」躲开总部（见 minCenterDist / BUILD_LANE_PX），
  // 上限保证工厂中心落在 HQ_ATK_RANGE 内（防卫按中心距判定）。
  // ⚠️ 早先这里是 `HQ_R + FACTORY_R + 16` —— 只算碰撞半径、且只留 16px，
  //    扣掉寻路外扩 + 格量化之后净缝是**负的**：门口那两座厂与总部的占位圈直接重叠。
  const dMin = minCenterDist(HQ_R, FACTORY_R);
  const dMax = Math.max(dMin, HQ_ATK_RANGE - 12);
  const d = dMin + (dMax - dMin) * 0.55;
  // 两座并排：横向半距 = 一半的「占位 + 净缝」⇒ 两厂之间刚好留 BUILD_LANE_PX 的通路
  const halfSep = occupyR(FACTORY_R) + BUILD_LANE_PX / 2;
  for (const hq of bases) {
    const { fx, fy, rx, ry } = dirTowardCenter(hq.x, hq.y);
    // 2 座：左 / 右各一；若将来改成更多，就在正前方横排铺开
    const nFac = STARTER_FAC_PER_HQ;
    for (let k = 0; k < nFac; k++) {
      // n=2 → ±halfSep；更多时按「占位直径 + 缝」横排
      const step = nFac <= 2 ? halfSep * 2 : minCenterDist(FACTORY_R, FACTORY_R);
      const latK = (k - (nFac - 1) * 0.5) * step;
      out.push({
        x: round1(hq.x + fx * d + rx * latK),
        y: round1(hq.y + fy * d + ry * latK),
        level: 1,
        starter: true,
      });
    }
  }
  return out;
}

/**
 * 生成中立工厂布局：
 *   ① 每家总部正前方固定 STARTER_FAC_PER_HQ 座初级厂（防卫射程内）；
 *   ② 中场轨道再放「人均 RANDOM_L1_PER_PLAYER 初级 + 2 中 + 1 高」（严格 C_N 旋转对称）。
 * 总数 = (STARTER_FAC_PER_HQ + RANDOM_L1_PER_PLAYER + 3) × n。
 * @param {number} count 玩家人数（2/3/4）
 * @param {() => number} rng 确定性随机源（每局分布不同，但始终成轨道）
 * @param {number[]} bands 隔离带方向（带内不放厂）
 * @param {{x:number,y:number}[]} [bases] 各家总部
 * @returns {{x:number,y:number,level:number}[]}
 */
function buildNeutralFactories(count, rng, bands, bases, grid) {
  const n = symOrder(count);
  const cx = WORLD_W / 2;
  const cy = WORLD_H / 2;
  // ① 门口初级厂：先钉死，后面的中场轨道要避开它们
  const starters = placeStarterFactoriesNearHqs(bases || []);
  // 工厂要长在「该长的地方」，不能纯几何撒点：
  //   ① 不该压在深山 / 深水里 —— 清场圈会把一整块地形啃出一个方洞，工厂自己四面是山也不好走；
  //   ② 不该骑在主路正中间 —— 那会把进攻通道堵成一截瓶颈（三条主路是硬指标）；
  //   ③ 贴着主路（采样圈里有一两成落在走廊上）才最好 —— 工厂本来就是路边该抢的据点。
  const mkRoad = [];
  for (let r = 0; r < TERR_ROWS; r++) mkRoad[r] = new Uint8Array(TERR_COLS);
  if (grid && bases && bases.length >= 2) {
    const probe = [];
    for (let r = 0; r < TERR_ROWS; r++) probe[r] = new Array(TERR_COLS).fill(TT_MOUNTAIN);
    carveMainRoads(probe, bases, n);
    for (let r = 0; r < TERR_ROWS; r++) {
      for (let c = 0; c < TERR_COLS; c++) if (probe[r][c] === TT_PLAIN) mkRoad[r][c] = 1;
    }
  }
  const SITE_R = 8; // 采样半径（格）：比清场圈大一圈，看的是「周边环境」而不是脚下那 7×7
  const siteScore = (x, y) => {
    if (!grid) return 0.5;
    const cc = Math.floor(x / TERR_CELL);
    const cr = Math.floor(y / TERR_CELL);
    let tot = 0;
    let bad = 0;
    let road = 0;
    for (let r = cr - SITE_R; r <= cr + SITE_R; r++) {
      if (r < 0 || r >= TERR_ROWS) continue;
      for (let c = cc - SITE_R; c <= cc + SITE_R; c++) {
        if (c < 0 || c >= TERR_COLS) continue;
        tot++;
        if (grid[r][c] !== TT_PLAIN) bad++;
        if (mkRoad[r][c]) road++;
      }
    }
    if (!tot) return 0.5;
    const blocked = bad / tot;
    const rf = road / tot;
    const sBlocked = 1 - clamp(blocked / 0.5, 0, 1); // 地形越少越好
    // 贴路最好、骑路最差。**完全不挨路的点要给低分**：早先给 0.35 的基线，
    // 「开阔但不挨路」能拿 0.74 分、跟「贴着路」的 0.88 差不了多少，于是
    // 间距约束一挤，就有工厂被排到离主路八丈远的地方（实测最远一座邻域 0% 是路面）。
    // 基线压到 0.12 之后两类拉开 0.27 分，贴路点永远排在前头。
    const sRoad = rf <= 0.35 ? 0.12 + (rf / 0.35) * 0.58 : Math.max(0, 0.7 - (rf - 0.35) / 0.5);
    return sBlocked * 0.6 + sRoad * 0.4;
  };
  const EDGE = FAC_EDGE; // 距地图边缘最小留白
  const GAP = Math.max(FAC_GAP, minCenterDist(FACTORY_R, FACTORY_R)); // 工厂之间最小中心距
  const LAB_CLEAR = Math.max(860, minCenterDist(FACTORY_R, LAB_R)); // 距研究所最小中心距
  const HQ_CLEAR = Math.max(HQ_BUILDING_GAP + FACTORY_R, minCenterDist(HQ_R, FACTORY_R)); // 距各家总部
  // 轨道内相邻两座的间距 = 2·d·sin(π/n) 同样要 ≥ GAP → 半径有下限
  const dMin = Math.max(GAP / (2 * Math.sin(Math.PI / n)), 520);
  const dMax = Math.min(FAC_R_MAX, WORLD_H / 2 - EDGE); // 再大就有旋转像掉出上下边界
  // 候选点用向日葵（phyllotaxis）分布：在圆内天然均匀铺开，比「多角 × 多半径」的稀疏网格
  // 更容易在 GAP 约束下塞下 4 人局的 28 座厂。
  const N = 600;
  const gold = Math.PI * (3 - Math.sqrt(5));
  const raw = [];
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const rr = Math.sqrt(t);
    const ang = i * gold;
    const x = round1(cx + dMax * rr * Math.cos(ang));
    const y = round1(cy + dMax * rr * Math.sin(ang));
    if (x < EDGE || x > WORLD_W - EDGE || y < EDGE || y > WORLD_H - EDGE) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d < dMin) continue;
    // 整条轨道都要合格：任何一个旋转像出界 / 落进隔离带，这一组就不能要
    const orbit = symOrbit(x, y, n);
    let ok = true;
    for (const p of orbit) {
      if (p.x < EDGE || p.x > WORLD_W - EDGE || p.y < EDGE || p.y > WORLD_H - EDGE) ok = false;
      if (inIsolationBand(bands, p.x, p.y)) ok = false;
    }
    if (!ok) continue;
    // 选址评分（见 siteScore）：整条轨道按最差的那个像打分 —— 有一个孪生厂落在深山里
    // / 骑在主路上，这一组就不能要。
    let sc = 1;
    for (const p of orbit) sc = Math.min(sc, siteScore(p.x, p.y));
    // 四面全是山 / 水 → 工厂会被地形包死，直接淘汰。
    // ⚠️ 不能只看总分：sRoad 的低基线会把「深山里」压到 0.05 上下，而同样低的分数
    // 「贴路但地形多」也能拿到 —— 前者必须淘汰、后者还能要，所以按地形占比单独判。
    if (sc <= 0.02) continue;
    let worstBlocked = 0;
    for (const p of orbit) {
      const cc = Math.floor(p.x / TERR_CELL);
      const cr = Math.floor(p.y / TERR_CELL);
      let b = 0;
      let t = 0;
      for (let r = cr - SITE_R; r <= cr + SITE_R; r++) {
        if (r < 0 || r >= TERR_ROWS) continue;
        for (let c = cc - SITE_R; c <= cc + SITE_R; c++) {
          if (c < 0 || c >= TERR_COLS) continue;
          t++;
          if (grid && grid[r][c] !== TT_PLAIN) b++;
        }
      }
      worstBlocked = Math.max(worstBlocked, b / Math.max(1, t));
    }
    if (worstBlocked > 0.55) continue; // 邻域一半以上是地形：这厂四面走不出去
    raw.push({ pts: orbit, d, sc });
  }
  const far = (a, b, lim) => dist(a.x, a.y, b.x, b.y) >= lim;
  const orbitOk = (placed, cand) => {
    for (const q of placed) {
      for (const a of cand.pts) {
        for (const b of q.pts) if (!far(a, b, GAP)) return false;
      }
    }
    for (const l of LABS) {
      for (const a of cand.pts) if (!far(a, l, LAB_CLEAR)) return false;
    }
    for (const h of bases || []) {
      for (const a of cand.pts) if (!far(a, h, HQ_CLEAR)) return false;
    }
    // 中场轨道也要躲开各家门口已经钉死的初级厂
    for (const s of starters) {
      for (const a of cand.pts) if (!far(a, s, GAP)) return false;
    }
    return true;
  };
  // 1 高 + 2 中 + RANDOM_L1_PER_PLAYER 初级（门口初级另算）
  const totalOrbits = 1 + 2 + RANDOM_L1_PER_PLAYER;
  // 多种放置顺序各贪心跑一遍，取「放下组数最多 / 同分选址更好」的结果。
  let best = [];
  const betterPlaced = (a, b) => {
    if (a.length !== b.length) return a.length > b.length;
    let sa = 0;
    let sb = 0;
    for (const p of a) sa += p.sc;
    for (const p of b) sb += p.sc;
    return sa > sb;
  };
  const orderings = [];
  orderings.push(raw.slice().sort((p, q) => q.sc - p.sc));
  for (let attempt = 0; attempt < 6; attempt++) {
    const jit = new Map();
    for (const p of raw) jit.set(p, 1 + (rng() - 0.5) * 0.3);
    orderings.push(raw.slice().sort((p, q) => q.sc * jit.get(q) - p.sc * jit.get(p)));
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const cands = raw.slice();
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = cands[i];
      cands[i] = cands[j];
      cands[j] = tmp;
    }
    orderings.push(cands);
  }
  orderings.push(
    raw.slice().sort((p, q) => q.d - p.d),
    raw.slice().sort((p, q) => p.d - q.d)
  );
  let tried = 0;
  for (const cands of orderings) {
    const placed = [];
    for (const c of cands) {
      if (placed.length >= totalOrbits) break;
      if (orbitOk(placed, c)) placed.push(c);
    }
    tried++;
    if (betterPlaced(placed, best)) best = placed;
    if (best.length >= totalOrbits && tried >= 7) break;
  }
  best.sort((p, q) => p.d - q.d); // 越靠中心阶越高
  const out = starters.slice();
  let pi = 0;
  const takeOrbits = (lv, cnt) => {
    for (let i = 0; i < cnt && pi < best.length; i++, pi++) {
      for (const p of best[pi].pts) out.push({ x: round1(p.x), y: round1(p.y), level: lv });
    }
  };
  takeOrbits(3, 1);
  takeOrbits(2, 2);
  takeOrbits(1, RANDOM_L1_PER_PLAYER);
  return out;
}

/** 研究所（每座提供科技点产出）—— 开局时填好（见 buildLabs） */
let LABS = [];

/**
 * 每家总部侧后方固定摆 STARTER_LAB_PER_HQ 座研究所。
 * 放在「背对中场」一侧，躲开正前方门口初级厂，仍贴着总部。
 */
function placeStarterLabsNearHqs(bases) {
  const out = [];
  if (!bases || !bases.length || STARTER_LAB_PER_HQ <= 0) return out;
  // 总部正后方（背对中场）。⚠️ 早先是 `HQ_R + LAB_R + 36`，扣掉寻路外扩之后净缝 −0.2 格 ——
  //   占位圈与总部重叠，研究所把总部后半圈整个糊死，出生部队推不出去。
  const dBack = minCenterDist(HQ_R, LAB_R);
  const latStep = minCenterDist(LAB_R, LAB_R);
  for (const hq of bases) {
    const { fx, fy, rx, ry } = dirTowardCenter(hq.x, hq.y);
    const nLab = STARTER_LAB_PER_HQ;
    for (let k = 0; k < nLab; k++) {
      const latK = (k - (nLab - 1) * 0.5) * latStep;
      out.push({
        x: round1(hq.x - fx * dBack + rx * latK),
        y: round1(hq.y - fy * dBack + ry * latK),
        starter: true,
      });
    }
  }
  return out;
}

/**
 * 生成研究所：
 *   ① 每家总部旁固定 STARTER_LAB_PER_HQ 座；
 *   ② 其余（labPerPlayer − starter）组走中场随机 C_N 轨道。
 * 总数 = LAB_PER_PLAYER × n。须在总部定好之后调用。
 */
function buildLabs(count, rng, bands, bases, grid) {
  const n = symOrder(count);
  const starters = placeStarterLabsNearHqs(bases || []);
  const needOrbits = Math.max(0, LAB_PER_PLAYER - STARTER_LAB_PER_HQ);
  if (needOrbits <= 0) return starters.map((p) => ({ x: p.x, y: p.y }));

  const cx = WORLD_W / 2;
  const cy = WORLD_H / 2;
  const EDGE = FAC_EDGE;
  const GAP = Math.max(FAC_GAP * 0.85, minCenterDist(LAB_R, LAB_R)); // 研究所彼此间距
  const HQ_CLEAR = Math.max(HQ_BUILDING_GAP + LAB_R, minCenterDist(HQ_R, LAB_R));
  const STARTER_CLEAR = minCenterDist(LAB_R, LAB_R); // 躲开各家门口固定所
  const dMin = Math.max(GAP / (2 * Math.sin(Math.PI / n)), BASE_R * LAB_R_K * 0.35);
  const dMax = Math.min(FAC_R_MAX, WORLD_H / 2 - EDGE);
  const N = 420;
  const gold = Math.PI * (3 - Math.sqrt(5));
  const raw = [];
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const rr = Math.sqrt(t);
    const ang = i * gold;
    const x = round1(cx + dMax * rr * Math.cos(ang));
    const y = round1(cy + dMax * rr * Math.sin(ang));
    if (x < EDGE || x > WORLD_W - EDGE || y < EDGE || y > WORLD_H - EDGE) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d < dMin) continue;
    const orbit = symOrbit(x, y, n);
    let ok = true;
    for (const p of orbit) {
      if (p.x < EDGE || p.x > WORLD_W - EDGE || p.y < EDGE || p.y > WORLD_H - EDGE) ok = false;
      if (bands && inIsolationBand(bands, p.x, p.y)) ok = false;
      // 别压进深山 / 深水：脚下是平原即可（研究所清场圈会再抠一圈）
      if (grid) {
        const cc = Math.floor(p.x / TERR_CELL);
        const cr = Math.floor(p.y / TERR_CELL);
        if (cr < 0 || cr >= TERR_ROWS || cc < 0 || cc >= TERR_COLS || grid[cr][cc] !== TT_PLAIN) ok = false;
      }
    }
    if (!ok) continue;
    raw.push({ pts: orbit, d });
  }
  const far = (a, b, lim) => dist(a.x, a.y, b.x, b.y) >= lim;
  const orbitOk = (placed, cand) => {
    for (const q of placed) {
      for (const a of cand.pts) {
        for (const b of q.pts) if (!far(a, b, GAP)) return false;
      }
    }
    for (const h of bases || []) {
      for (const a of cand.pts) if (!far(a, h, HQ_CLEAR)) return false;
    }
    for (const s of starters) {
      for (const a of cand.pts) if (!far(a, s, STARTER_CLEAR)) return false;
    }
    return true;
  };
  let best = [];
  const orderings = [];
  // 打乱多次贪心
  for (let attempt = 0; attempt < 48; attempt++) {
    const cands = raw.slice();
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
      const tmp = cands[i];
      cands[i] = cands[j];
      cands[j] = tmp;
    }
    orderings.push(cands);
  }
  orderings.push(raw.slice().sort((p, q) => q.d - p.d));
  orderings.push(raw.slice().sort((p, q) => p.d - q.d));
  for (const cands of orderings) {
    const placed = [];
    for (const c of cands) {
      if (placed.length >= needOrbits) break;
      if (orbitOk(placed, c)) placed.push(c);
    }
    if (placed.length > best.length) best = placed;
    if (best.length >= needOrbits) break;
  }
  const out = starters.map((p) => ({ x: p.x, y: p.y }));
  for (const o of best) {
    for (const p of o.pts) out.push({ x: round1(p.x), y: round1(p.y) });
  }
  // 兜底：随机轨道没塞满时，沿旧圆环补齐（仍保持 C_N 对称）
  for (let guard = 0; out.length < LAB_PER_PLAYER * n && guard < 8; guard++) {
    const j = Math.max(0, Math.floor(out.length / n) - STARTER_LAB_PER_HQ);
    const rr = BASE_R * LAB_R_K * (1 - j * 0.27);
    const rot0 = bases && bases[0] ? Math.atan2(bases[0].y - cy, bases[0].x - cx) : 0;
    const before = out.length;
    for (let k = 0; k < n && out.length < LAB_PER_PLAYER * n; k++) {
      const p = circlePoint(rot0 + (k * Math.PI * 2) / n, rr);
      let x = p.x;
      let y = p.y;
      if (out.some((q) => dist(q.x, q.y, x, y) < GAP * 0.7)) {
        const p2 = circlePoint(rot0 + (k * Math.PI * 2) / n, rr * 0.82);
        x = p2.x;
        y = p2.y;
      }
      out.push({ x: round1(x), y: round1(y) });
    }
    if (out.length === before) break;
  }
  return out;
}

/** 出兵类型权重（见 data.js） */
const SPAWN_WEIGHTS = WFData.spawnWeights;

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

/**
 * 一条产线：兵种 type + 出厂阶数 tier（进化为单一方向，无分支）。
 * - tier 决定这条线吐出来的兵是几阶：进化一次就整体抬一阶，此后一直按这个阶产；
 * - 上限是本建筑等级：工厂看 level，总部恒为 1（总部产线不可进化）。
 */
function makeSlot(type) {
  return {
    type: TYPE_LIST.includes(type) ? type : TYPE_LIST[0],
    tier: 1,
    branch: '', // 已取消 A/B 分支，保留字段仅为兼容产线序列化
  };
}

/**
 * 把建筑（工厂 / 总部）的产线数组补齐到与 lines 一致。
 * 外部（含测试）直接改 b.lines 时也能站得住 —— 缺的槽按第一条线的兵种补成一级线。
 */
function syncSlots(b) {
  const n = clamp(Math.round(b.lines || 1), 1, FAC_MAX_LINES);
  b.lines = n;
  if (!Array.isArray(b.specs)) b.specs = [];
  if (!Array.isArray(b.prog)) b.prog = [];
  const base = b.specs.length ? b.specs[0].type : 'warrior';
  while (b.specs.length < n) b.specs.push(makeSlot(base));
  if (b.specs.length > n) b.specs.length = n;
  while (b.prog.length < n) b.prog.push(0);
  if (b.prog.length > n) b.prog.length = n;
  return b.specs;
}

/** 产线被夺 / 退还中立后重置：只留一条一级线（兵种保留），免得白送别人一堆高阶产线 */
function resetSlots(b) {
  const base = b.specs && b.specs.length ? b.specs[0].type : b.prodType || 'warrior';
  b.lines = 1;
  b.specs = [makeSlot(base)];
  b.prog = [0];
  b.prodProg = 0;
  return b.specs;
}

/**
 * 开局为每座工厂**固定**第一条产线的兵种（之后由玩家自己开辟 / 进化产线）。
 * - 出生工厂：所有玩家统一同一种类型（保证绝对公平）；
 * - 中立工厂：按 180° 点对称配对分配（互为旋转对称的两座工厂同类型），保证对称性公平。
 * 同时初始化集结点（rally = null）。
 */
function assignProdTypes(factories, rng, n) {
  // 预热：rng 种子源自 Date.now()，相邻种子前几个输出相关性较强，先丢弃若干
  for (let i = 0; i < 12; i++) rng();
  // Fisher–Yates 打乱兵种表：保证中立工厂覆盖多种兵种，而不是随机扎堆同一种
  const deck = TYPE_LIST.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }

  const done = new Set();
  let di = 0;
  const nextType = () => deck[di++ % deck.length];
  for (const f of factories) {
    f.rally = null;
    if (f.home) {
      f.specs = [makeSlot(deck[0])];
      f.prog = [0];
      done.add(f.id);
    }
  }
  for (const f of factories) {
    if (done.has(f.id)) continue;
    const t = nextType();
    f.specs = [makeSlot(t)];
    f.prog = [0];
    done.add(f.id);
    // 找到**同一条旋转轨道**上的孪生厂（绕世界中心每转 360°/N 一座），赋予同一类型 ——
    // 于是每家门口那几座中立厂产的同一种兵，对称是彻底的。
    const order = symOrder(n == null ? SYM_MAX_N : n);
    for (let k = 1; k < order; k++) {
      const p = rotateAround(f.x, f.y, k, order);
      for (const g of factories) {
        if (done.has(g.id) || g.id === f.id) continue;
        if (Math.abs(g.x - p.x) < 2 && Math.abs(g.y - p.y) < 2) {
          g.specs = [makeSlot(t)];
          g.prog = [0];
          done.add(g.id);
        }
      }
    }
  }
  for (const f of factories) {
    if (!f.specs || !f.specs.length) f.specs = [makeSlot(TYPE_LIST[0])];
    if (!Array.isArray(f.prog) || !f.prog.length) f.prog = [0];
    if (f.rally === undefined) f.rally = null;
  }
}

/* ---------------- 地形查询 / 移动规则 ---------------- */

/** 取某世界坐标处的地形类型（越界按平野处理） */
function terrainCell(game, x, y) {
  const t = game.terrain;
  if (!t) return TT_PLAIN;
  let c = Math.floor(x / t.cell);
  let r = Math.floor(y / t.cell);
  if (c < 0) c = 0;
  else if (c >= t.cols) c = t.cols - 1;
  if (r < 0) r = 0;
  else if (r >= t.rows) r = t.rows - 1;
  return t.grid[r][c];
}

/** 地形对移动速度的修正（沼泽已移除，恒为 1：地形不再影响移速） */
function terrainSpeedFactor(game, u) {
  // 沼泽已移除：地形不再对移动速度做任何修正
  return 1;
}

/** 该坐标可否踏入（山地、水域不可通行） */
function terrainPassable(game, x, y) {
  const t = terrainCell(game, x, y);
  return t !== TT_MOUNTAIN && t !== TT_WATER;
}

/** 取某坐标所在的地形格线性下标（越界返回 -1） */
function cellIdxRaw(t, x, y) {
  const c = Math.floor(x / t.cell);
  const r = Math.floor(y / t.cell);
  if (r < 0 || c < 0 || r >= t.rows || c >= t.cols) return -1;
  return r * t.cols + c;
}

/**
 * 沿直线细分采样，返回「第一次进入山体格」的距离（px）；全程不碰山返回 -1。
 * 水域 / 平原都不阻挡，只有 TT_MOUNTAIN 阻挡。
 * @param {object} opts
 *   - step      采样步长（默认 LOS_STEP）
 *   - skipEnds  true 时忽略「起点 / 终点自身所在格」——单位贴着山脚站立时，
 *               自己的格子不该被算成遮挡；索敌判定用 true，弹道扫掠用 false。
 */
function mountainHitAlong(game, x1, y1, x2, y2, opts) {
  const t = game.terrain;
  if (!t) return -1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return -1;
  const ux = dx / len;
  const uy = dy / len;
  const st = (opts && opts.step) || LOS_STEP;
  const skip = Boolean(opts && opts.skipEnds);
  const ci0 = skip ? cellIdxRaw(t, x1, y1) : -1;
  const ci1 = skip ? cellIdxRaw(t, x2, y2) : -1;
  const hit = (s) => {
    const r = Math.floor((y1 + uy * s) / t.cell);
    const c = Math.floor((x1 + ux * s) / t.cell);
    if (r < 0 || c < 0 || r >= t.rows || c >= t.cols) return false;
    const i = r * t.cols + c;
    if (i === ci0 || i === ci1) return false;
    return t.grid[r][c] === TT_MOUNTAIN;
  };
  for (let s = st; s < len; s += st) {
    if (hit(s)) return s;
  }
  return hit(len) ? len : -1;
}

/**
 * 两点之间视线是否被山体挡住。
 * 山有高度 → 山两侧互相看不见：既不能索敌，也不能开火（水域不遮挡）。
 */
function losBlocked(game, x1, y1, x2, y2) {
  return mountainHitAlong(game, x1, y1, x2, y2, { step: LOS_STEP, skipEnds: true }) >= 0;
}

/**
 * 找到离 (x,y) 最近的「可通行且不压建筑」的格心。
 * 目标点本身可立足（不在建筑占位内）时原样返回，保持精确；
 * 若目标落在建筑/山地/水域里，则退到最近的可通行格心，避免部队对着不可达点空转。
 */
function nearestPassable(game, x, y, wantComp, opts) {
  const t = game.terrain;
  if (!t) return { x, y };
  const pg = passGrid(game);
  if (!pg) return { x, y };
  // wantComp 给定时，只接受「与调用方同属一个连通分量」的格。
  // 这一步是必须的：目标点落在山体里时，最近的可通行格可能是一格被山围住的孤立小岛，
  // 以它为源建流场会把单位所在的大陆整片标成不可达 → 寻路退化成直线撞墙 → 原地打转。
  const cb = wantComp != null ? compLabels(game) : null;
  const okCell = (i) => pg[i] && (!cb || cb.lab[i] === wantComp);

  const cc = Math.min(t.cols - 1, Math.max(0, Math.floor(x / t.cell)));
  const cr = Math.min(t.rows - 1, Math.max(0, Math.floor(y / t.cell)));
  if (okCell(cr * t.cols + cc)) {
    // 该格可通行；但给定点本身可能落在建筑占位圆内（格心在圆外的情况），此时退到格心
    if (!insideBuilding(game, x, y, 0)) return { x, y };
    return { x: (cc + 0.5) * t.cell, y: (cr + 0.5) * t.cell };
  }
  for (let ring = 1; ring <= 12; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const r = cr + dr;
        const c = cc + dc;
        if (r < 0 || r >= t.rows || c < 0 || c >= t.cols) continue;
        if (!okCell(r * t.cols + c)) continue;
        return { x: (c + 0.5) * t.cell, y: (r + 0.5) * t.cell };
      }
    }
  }
  if (cb && !(opts && opts.noScan)) {
    // 环形搜索（12 格 = 480px）没找到同分量格：全图扫描取最近的一个。
    // ⚠️ 只给「设集结点」这类一次性的调用用 —— 寻路每单位每步都来，全图扫描（8 万格 × dist）
    // 会把帧时间吃光（实测 12 局冒出 6.7 万次全图扫描，一局从 13 秒拖到 2 分钟）。
    // 寻路那边传 noScan：12 格环里没有同分量格，就说明目标根本不在部队这一侧，
    // 直接返回 null 让调用方退回直线转向 —— 反正建出来的流场标不上部队那一格，结果一样。
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < pg.length; i++) {
      if (!okCell(i)) continue;
      const c = i % t.cols;
      const r = (i - c) / t.cols;
      const px = (c + 0.5) * t.cell;
      const py = (r + 0.5) * t.cell;
      const d = dist(px, py, x, y);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI < 0) return null;
    const bc = bestI % t.cols;
    const br = (bestI - bc) / t.cols;
    return { x: (bc + 0.5) * t.cell, y: (br + 0.5) * t.cell };
  }
  return null;
}

/**
 * 把一个指令落点推到所有建筑占位圆之外（含自家建筑）。
 * 用于右键移动 / 设集结点：玩家点到建筑上时，落点自动挪到建筑外缘，
 * 否则部队会围着那栋建筑绕圈（目标不可达 + 每帧被推开 = 活锁）。
 */
function snapOutsideBuildings(game, x, y, r) {
  let px = x;
  let py = y;
  const pad = (r == null ? BLOCK_MARGIN : r) + (r == null ? 0 : BLOCK_MARGIN);
  for (let iter = 0; iter < 4; iter++) {
    const blocks = [];
    // ⚠️ 口径必须与 passGrid 一致（占位 = 碰撞 + BLOCK_MARGIN）。早先这里用的是
    //    `FACTORY_R + clearance`，而流场按 `FACTORY_R + BLOCK_MARGIN` 封 —— 两套口径不一致，
    //    于是「落点被判可走、但流场那格是 0」，部队走过去就被推开，原地绕圈。
    for (const f of game.factories || []) blocks.push([f.x, f.y, occupyR(FACTORY_R) + pad]);
    for (const l of game.labs || []) blocks.push([l.x, l.y, occupyR(LAB_R) + pad]);
    for (const h of game.hqs || []) {
      if (!h.down) blocks.push([h.x, h.y, occupyR(HQ_R) + pad]);
    }
    let moved = false;
    for (const b of blocks) {
      const d = dist(px, py, b[0], b[1]);
      if (d >= b[2]) continue;
      if (d < 0.001) {
        px = b[0] + b[2];
      } else {
        px = b[0] + ((px - b[0]) / d) * b[2];
        py = b[1] + ((py - b[1]) / d) * b[2];
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x: clamp(px, 20, WORLD_W - 20), y: clamp(py, 20, WORLD_H - 20) };
}

/**
 * 脱困：单位当前位于不可通行地形时，朝最近的可通行格移动一小步。
 * 存在的意义只是「走出异常位置」，不允许被当作无视地形的通行手段。
 * @returns {boolean} 是否发生了移动
 */
function unstuckStep(game, u, spd) {
  const goal = nearestPassable(game, u.x, u.y);
  if (!goal) return false;
  const d = dist(u.x, u.y, goal.x, goal.y);
  if (d < 0.001) return false;
  const step = Math.min(spd, d);
  const ang = Math.atan2(goal.y - u.y, goal.x - u.x);
  u.x += Math.cos(ang) * step;
  u.y += Math.sin(ang) * step;
  return true;
}

/**
 * 安全位移：仅在落点可立足（含不跨崖 / 不切崖角）时应用；被挡则退一步尝试单轴贴壁。
 * 用于单位分离/建筑推挤等「非主动移动」——绝不能把单位推进山体、水里或直接推上崖顶。
 * @returns {boolean} 是否发生了移动
 */
function moveIfPassable(game, u, nx, ny) {
  // 推挤也走 canStand（带起点）：否则部队挤着挤着就从崖角对角翻上去了
  if (canStand(game, nx, ny, u.r, u.x, u.y)) {
    u.x = nx;
    u.y = ny;
    return true;
  }
  if (canStand(game, nx, u.y, u.r, u.x, u.y)) {
    u.x = nx;
    return true;
  }
  if (canStand(game, u.x, ny, u.r, u.x, u.y)) {
    u.y = ny;
    return true;
  }
  return false;
}

/** 该点是否落在建筑（工厂/研究所/未陷落总部）的占位圆内 */
function insideBuilding(game, x, y, r) {
  const pad = 0.5; // 略缩，避免「刚好被分离逻辑推到接触边界」的单位被判为占位内
  for (const f of game.factories) {
    if (dist(x, y, f.x, f.y) < FACTORY_R + r - pad) return true;
  }
  for (const l of game.labs) {
    if (dist(x, y, l.x, l.y) < LAB_R + r - pad) return true;
  }
  for (const h of game.hqs) {
    if (h.down) continue;
    if (dist(x, y, h.x, h.y) < HQ_R + r - pad) return true;
  }
  return false;
}

/**
 * 相邻两格之间是不是崖：层差 ≥ HGT_CLIFF 就过不去。
 * 「有高低差的地方只有坡口能上下」这条规则就落在这一行上。
 *
 * ⚠️ **坡道格无视高低差**：只要有一端是坡（terrain.ramps[i] = 1），就不算崖 ——
 *    坡就是「无视上下高低差也能移动」的那种地形，玩家要能一眼看出它、并放心走上去。
 *    （坡由服务端 carveRamps 亲手挖出并标记，不是「层差=1」推导出来的 ——
 *      推导口径在台地密集处会误判，两端口径也容易漂移。）
 */
function cliffBetween(game, ia, ib) {
  if (!game || ia === ib || ia < 0 || ib < 0) return false;
  const ramps = game.terrain && game.terrain.ramps;
  if (ramps && (ramps[ia] || ramps[ib])) return false; // 坡：无视高低差
  const hf = game.terrain ? game.terrain.heights : null;
  if (!hf) return false;
  return Math.abs(hf[ia] - hf[ib]) >= HGT_CLIFF;
}

/**
 * 导航边是否可走（8 向）：目标格可通行、不跨崖；
 * 走对角时两侧正交格也必须可通行且不跨崖 —— 禁止「切崖角 / 切山角」抄近路。
 * 这是流场 BFS、连通分量、线段采样共用的同一套口径。
 */
function navStepOk(game, pg, cols, from, to) {
  if (!pg || from < 0 || to < 0 || !pg[to]) return false;
  if (cliffBetween(game, from, to)) return false;
  const c0 = from % cols;
  const r0 = (from - c0) / cols;
  const c1 = to % cols;
  const r1 = (to - c1) / cols;
  const dc = c1 - c0;
  const dr = r1 - r0;
  if (dc !== 0 && dr !== 0) {
    // 对角：两侧正交格都得开着，且从 from→正交、正交→to 都不能是崖
    const iH = r0 * cols + c1;
    const iV = r1 * cols + c0;
    if (!pg[iH] || !pg[iV]) return false;
    if (cliffBetween(game, from, iH) || cliffBetween(game, from, iV)) return false;
    if (cliffBetween(game, iH, to) || cliffBetween(game, iV, to)) return false;
  }
  return true;
}

/**
 * 导航边代价（调用方已确认 navStepOk）。
 * 正交 1 / 对角 √2；换层、踩坡加罚 —— 有同层平路时不会拐去走坡再拐回来。
 * 必要换层时坡仍是唯一通路，罚金只是偏好，不会堵死。
 */
const NAV_COST_ORTH = 1;
const NAV_COST_DIAG = Math.SQRT2;
const NAV_COST_DH = 0.65; // 每跨 1 层层高
const NAV_COST_RAMP = 0.4; // 边端点任一为坡

function navEdgeCost(game, from, to) {
  const cols = game.terrain.cols;
  const c0 = from % cols;
  const r0 = (from - c0) / cols;
  const c1 = to % cols;
  const r1 = (to - c1) / cols;
  let cost = c0 !== c1 && r0 !== r1 ? NAV_COST_DIAG : NAV_COST_ORTH;
  const hf = game.terrain.heights;
  if (hf) {
    const dh = Math.abs((hf[from] || 0) - (hf[to] || 0));
    if (dh > 0) cost += dh * NAV_COST_DH;
  }
  const ramps = game.terrain.ramps;
  if (ramps && (ramps[from] || ramps[to])) cost += NAV_COST_RAMP;
  return cost;
}

/**
 * 从 (ax,ay) 到 (bx,by) 的线段是否走得通：沿途每格可通行，相邻采样格之间是合法导航边
 * （含对角切角禁令）。只判地形 / 崖 / 建筑占位掩码，不判单位半径占位圆。
 *
 * ⚠️ 起点可以落在建筑占位格（掩码 0）上 —— 部队生在楼边、被推挤压进占位圈时很常见。
 *    这种情况下允许「迈出去」，但途经 / 终点仍必须是可通行格，且不得跨崖、不得切崖角。
 */
function segmentClear(game, ax, ay, bx, by) {
  const t = game.terrain;
  if (!t) return false;
  const pg = passGrid(game);
  if (!pg) return false;
  const cols = t.cols;
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1e-6) return true;
  // ¼ 格采样：斜着走时不会跳过中间格（否则「隔崖的斜对角」会被误判成通）
  const steps = Math.max(1, Math.ceil(len / (t.cell * 0.25)));
  let pc = cellOf(game, ax, ay).i;
  for (let s = 1; s <= steps; s++) {
    const px = ax + ((bx - ax) * s) / steps;
    const py = ay + ((by - ay) * s) / steps;
    const ci = cellOf(game, px, py).i;
    if (ci === pc) continue;
    if (!pg[ci]) return false;
    const c0 = pc % cols;
    const r0 = (pc - c0) / cols;
    const c1 = ci % cols;
    const r1 = (ci - c1) / cols;
    // 采样密度下正常只跨邻格；一次跳两格以上一律当不通（逼调用方拆短步）
    if (Math.abs(c1 - c0) > 1 || Math.abs(r1 - r0) > 1) return false;
    if (pg[pc]) {
      if (!navStepOk(game, pg, cols, pc, ci)) return false;
    } else {
      // 从占位格迈出：navStepOk 会因 !pg[from] 语义不完整，这里单独验崖 / 切角
      if (cliffBetween(game, pc, ci)) return false;
      if (c1 !== c0 && r1 !== r0) {
        const iH = r0 * cols + c1;
        const iV = r1 * cols + c0;
        if (cliffBetween(game, pc, iH) || cliffBetween(game, pc, iV)) return false;
        if (pg[iH] && cliffBetween(game, iH, ci)) return false;
        if (pg[iV] && cliffBetween(game, iV, ci)) return false;
        // 两侧正交若是实体障碍（山/水），禁止切角穿缝
        const tt = t.grid;
        const block = (idx) => {
          const rr = (idx / cols) | 0;
          const cc = idx % cols;
          const v = tt[rr][cc];
          return v === TT_MOUNTAIN || v === TT_WATER;
        };
        if (block(iH) || block(iV)) return false;
      }
    }
    pc = ci;
  }
  return true;
}

/** 从 (fx,fy) 这一步能不能走到 (tx,ty)：地形站得住人、且整段不跨崖 / 不切角 */
function stepOpen(game, fx, fy, tx, ty) {
  if (!terrainPassable(game, tx, ty)) return false;
  return segmentClear(game, fx, fy, tx, ty);
}

/**
 * 半径 r 的单位能否在此立足：地形可通行、不压建筑、不出世界边界。
 * 这是「移动落点」的统一判据——只判落点，不做寻路。
 * @param {number} [fromX] 给了起点就顺带判「这一步整段路径」能不能走（跨崖 / 切崖角 = 过不去）
 */
function canStand(game, x, y, r, fromX, fromY) {
  if (x < r || x > WORLD_W - r || y < r || y > WORLD_H - r) return false;
  if (!terrainPassable(game, x, y)) return false;
  if (insideBuilding(game, x, y, r)) return false;
  if (fromX != null && fromY != null) {
    if (!segmentClear(game, fromX, fromY, x, y)) return false;
  }
  return true;
}

/**
 * 朝 ang 方向迈一步；若被挡，依次尝试 ±30°、±60°、±90°、±120°、±150° 的侧向候选，
 * 取第一个可立足的方向。用于贴着建筑/山体侧滑绕行，而不是傻站在障碍前。
 * @returns {boolean} 是否发生了移动
 */
const SLIDE_OFFSETS = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150];

/**
 * 角差取最短弧（-π..π]，两角相减后用它归一化。
 */
function angWrap(d) {
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** 把角收进 (-π..π]，免得累计转圈后数值越滚越大（快照 / 客户端插值都要读它） */
function normAng(a) {
  let x = a;
  while (x > Math.PI) x -= TAU;
  while (x < -Math.PI) x += TAU;
  return x;
}

/**
 * 体型惩罚：越大的兵转身越笨重。按占位格数算（1 阶 2 格 → ×1）。
 */
function turnSizeMul(u) {
  const cells = Math.max(2, (u.r * 2) / GRID);
  return Math.pow(2 / cells, TURN_SIZE_SLOW);
}
/** 车体角速度（rad/s） */
function hullTurnRate(u) {
  return TURN_HULL * turnSizeMul(u);
}
/** 炮塔角速度（rad/s） */
function turretTurnRate(u) {
  return TURN_TURRET * turnSizeMul(u);
}

/**
 * 把**车体**朝 want 转，但**一 tick 最多转 hullTurnRate×dt**。
 *
 * 车体与炮塔是两个独立的角：`u.angle`（底盘，朝行进方向）与 `u.turret`（炮塔，朝攻击方向）。
 * 车体转弯时炮塔跟着转同样的量（保持相对角不变）——毕竟炮塔是装在车上的；
 * 炮塔要单独咬某个目标时，由开火段走 `turnTurret`，不经过这里。
 *
 * ⚠️ 每 tick 的转动额度记在 `u._turnLeft`：一 tick 内被调好几次（掉头 + 贴墙滑行等）
 * 也只转这么多，不会出现「一个 tick 转两倍」。额度由 updateUnits 每 tick 置空重算。
 *
 * 没有这个函数的话，开火时「整只兵扭向目标」，行进方向就丢了，看着很别扭；
 * 没有速率限制的话，点一下背后的路径，整只兵瞬间掉头就跑，看着像幻灯片。
 */
function turnHull(u, want, dt) {
  if (u._turnLeft == null) u._turnLeft = hullTurnRate(u) * (dt || 0);
  const d = angWrap(want - u.angle);
  const step = Math.abs(d) <= u._turnLeft ? d : (d < 0 ? -u._turnLeft : u._turnLeft);
  u._turnLeft -= Math.abs(step);
  u.angle = normAng(u.angle + step);
  // 炮塔随车体平移同样的量（相对角保持不变）
  u.turret = normAng((u.turret == null ? u.angle : u.turret) + step);
  return u.angle;
}

/**
 * 把**炮塔**朝 want 转，一 tick 最多转 turretTurnRate×dt（车体不动）。
 * 索敌到目标后炮塔要这样转过去，而不是瞬间对准 —— 转到位（aimTol 内）才开火。
 */
function turnTurret(u, want, dt) {
  const cur = u.turret == null ? u.angle : u.turret;
  const d = angWrap(want - cur);
  const max = turretTurnRate(u) * (dt || 0);
  const step = Math.abs(d) <= max ? d : (d < 0 ? -max : max);
  u.turret = normAng(cur + step);
  return u.turret;
}

/** 炮塔是否已经瞄上 want（偏差在 TURN_AIM_TOL 内） */
function turretAimed(u, want) {
  const cur = u.turret == null ? u.angle : u.turret;
  return Math.abs(angWrap(want - cur)) <= TURN_AIM_TOL;
}

/**
 * 朝 ang 方向迈一步；若被挡，依次尝试 ±30°、±60°、±90°、±120°、±150° 的侧向候选，
 * 取第一个可立足的方向。用于贴着建筑/山体侧滑绕行，而不是傻站在障碍前。
 *
 * **掉头也在这里判**，而不是在外面拿「终点方向」判 —— ⚠️ 两处目标不一致会死锁：
 * 外层按终点方向转、内层按流场路点方向转，车头每 tick 被两个方向轮流拽（实测
 * 71° ↔ 85° 来回摆、位移 ±4px，300 秒原地不动）。这里转的目标和判据都用同一个 ang。
 *
 * 流程：① 车体按角速度朝 ang 转 → ② 车头还偏太多（夹角余弦 < TURN_MOVE_COS，如 60°）
 * 就**这一步只掉头不挪窝**，返回 'turn' → ③ 否则按夹角余弦打折起步（边掉头边走），
 * 迈步方向取**转完之后的实际车头朝向**（`u.angle`）—— 车头朝哪就往哪走，不会横着平移。
 *
 * @returns {boolean|'turn'} 真值 = 这一步有动作（挪了窝或在原地掉头）；false = 被挡住没动
 */
/**
 * 本帧 RVO 邻域：用各单位「上一帧速度」建空间哈希。
 * ORCA 标准口径 —— 邻居的 velocity_ 是上一步结果，本步同时算 newVelocity。
 */
function beginRvoFrame(game) {
  if (!RVO_ENABLED) {
    game._rvo = null;
    return;
  }
  const agents = [];
  for (let i = 0; i < game.units.length; i++) {
    const u = game.units[i];
    if (!u || u.dead) continue;
    agents.push({
      id: u.id,
      x: u.x,
      y: u.y,
      vx: u._vx || 0,
      vy: u._vy || 0,
      r: Math.max(4, u.r || 10),
    });
  }
  game._rvo = WFRvo.beginFrame(agents, {
    neighborDist: RVO_NEIGHBOR_DIST,
    maxNeighbors: RVO_MAX_NEIGHBORS,
    timeHorizon: RVO_TIME_HORIZON,
  });
}

function slideStep(game, u, ang, spd, dt) {
  const off = angWrap(ang - u.angle);
  turnHull(u, ang, dt);
  const c = Math.cos(off);
  if (c < TURN_MOVE_COS) {
    u._vx = 0;
    u._vy = 0;
    return 'turn'; // 车头偏太多 → 原地掉头，转到位（或转到够近）再走
  }
  let step = spd * Math.max(TURN_MOVE_MIN, c);
  let dir = u.angle;

  // RVO：把流场期望速度交给 ORCA，避开邻兵（地形仍由下面 canStand 管）。
  // ⚠️ 必须钳制：纯 ORCA 在同路挤兑时会给出**反向**速度 → 多点路点永远走不完。
  //    丢掉反向分量，并把相对期望方向的偏角限制在 ~50° 内（侧让，不掉头逃跑）。
  if (game._rvo && dt > 1e-6) {
    const maxSpd = Math.max(u.speed || 80, step / dt);
    let prefVx = Math.cos(dir) * (step / dt);
    let prefVy = Math.sin(dir) * (step / dt);
    const jitter = 0.0001 * maxSpd;
    const ja = (u.id * 12.9898 + (game.now || 0) * 0.001) % (Math.PI * 2);
    prefVx += Math.cos(ja) * jitter;
    prefVy += Math.sin(ja) * jitter;
    const adj = WFRvo.compute(game._rvo, u.id, prefVx, prefVy, maxSpd, dt);
    let ox = adj.vx;
    let oy = adj.vy;
    const pLen2 = prefVx * prefVx + prefVy * prefVy;
    if (pLen2 > 1e-6) {
      const fwd = (ox * prefVx + oy * prefVy) / pLen2;
      if (fwd < 0) {
        ox -= prefVx * fwd;
        oy -= prefVy * fwd;
      }
      const prefAng = Math.atan2(prefVy, prefVx);
      let rvoAng = Math.atan2(oy, ox);
      let dAng = angWrap(rvoAng - prefAng);
      const maxDev = 0.87; // ≈50°
      if (dAng > maxDev) dAng = maxDev;
      if (dAng < -maxDev) dAng = -maxDev;
      rvoAng = prefAng + dAng;
      const spdOut = Math.min(maxSpd, Math.hypot(ox, oy));
      ox = Math.cos(rvoAng) * spdOut;
      oy = Math.sin(rvoAng) * spdOut;
    }
    const len = Math.hypot(ox, oy);
    if (len > 1e-4) {
      dir = Math.atan2(oy, ox);
      step = Math.min(step, len * dt);
    }
  }

  const ox = u.x;
  const oy = u.y;
  for (const soff of SLIDE_OFFSETS) {
    const a = dir + (soff * Math.PI) / 180;
    const nx = u.x + Math.cos(a) * step;
    const ny = u.y + Math.sin(a) * step;
    // 带上起点：崖只在这一步跨过去时才拦得住（只判落点的话，部队能直接走上崖顶）
    if (!canStand(game, nx, ny, u.r, u.x, u.y)) continue;
    u.x = nx;
    u.y = ny;
    if (dt > 1e-6) {
      u._vx = (nx - ox) / dt;
      u._vy = (ny - oy) / dt;
    }
    u._rvoMoved = true;
    return true;
  }
  u._vx = 0;
  u._vy = 0;
  return false;
}

/* ---------------- 寻路：地形流场 ---------------- */

/**
 * 可通行掩码 = 地形 + 建筑占位。
 * 建筑必须算进去：否则流场会把部队直接指进建筑体内，而分离逻辑每帧又把它推出来，
 * 净位移为零 → 部队绕着建筑打转、永远到不了集结点（实测的活锁）。
 * 按地形对象 + 总部状态缓存；一局内地形与建筑位置都不变，重建代价可忽略。
 */
const BLOCK_MARGIN = 22; // 建筑占位在流场里额外外扩的余量（大于最大单位半径，避免「可走格子却仍被推开」）
/**
 * 导航缓存作废：地形格被改过、或高度场（崖）重算过之后必须调一次。
 *
 * ⚠️ 缓存 key 只认「terrain 对象引用 + 总部陷落位串」，而 grid 是**原地修改**的
 * （编辑器 paint 直接 `t.grid[r][c] = v`），heights 又是后来才派生出来的。
 * 不清的话：编辑器改完地形 / 重算高低差之后，寻路仍然按旧掩码、旧连通分量走 ——
 * 表现是「明明有条路却绕远」「把崖当平地」。
 */
function invalidateNavCache(game) {
  game._passGrid = null;
  game._compGrid = null;
  game._flowCache = null;
  game._goalFix = null;
  if (game._escCache) game._escCache.clear();
}

function passGrid(game) {
  const t = game.terrain;
  if (!t) return null;
  const key = (game.hqs || []).map((h) => (h.down ? 1 : 0)).join('');
  if (game._passGrid && game._passGridFor === t && game._passGridKey === key) {
    return game._passGrid;
  }
  const pg = new Uint8Array(t.cols * t.rows);
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < t.cols; c++) {
      const v = t.grid[r][c];
      pg[r * t.cols + c] = v === TT_MOUNTAIN || v === TT_WATER ? 0 : 1;
    }
  }
  const blocks = [];
  for (const f of game.factories || []) blocks.push([f.x, f.y, occupyR(FACTORY_R)]);
  for (const l of game.labs || []) blocks.push([l.x, l.y, occupyR(LAB_R)]);
  for (const h of game.hqs || []) {
    if (!h.down) blocks.push([h.x, h.y, occupyR(HQ_R)]);
  }
  for (const b of blocks) {
    const c0 = Math.max(0, Math.floor((b[0] - b[2]) / t.cell));
    const c1 = Math.min(t.cols - 1, Math.floor((b[0] + b[2]) / t.cell));
    const r0 = Math.max(0, Math.floor((b[1] - b[2]) / t.cell));
    const r1 = Math.min(t.rows - 1, Math.floor((b[1] + b[2]) / t.cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * t.cols + c;
        if (!pg[i]) continue;
        const px = (c + 0.5) * t.cell;
        const py = (r + 0.5) * t.cell;
        if (dist(px, py, b[0], b[1]) < b[2]) pg[i] = 0;
      }
    }
  }
  game._passGrid = pg;
  game._passGridFor = t;
  game._passGridKey = key;
  // 掩码变了（例如总部陷落后不再阻挡）→ 之前按目标格缓存的流场全部作废
  game._flowCache = null;
  game._goalFix = null;
  return pg;
}

/**
 * 连通分量：给每个「可通行」格标一个分量 id，并统计各分量大小。
 *
 * 为什么必须有它：目标点经常落在山体/水域里，nearestPassable 会把它插值到最近的可通行格——
 * 但那格可能是一个被山围住的孤立小岛（分量大小 1）。以它为源建流场时，单位所在的大陆
 * 会被整片标成「不可达」（-1），寻路直接退化成直线撞墙，而 slideStep 在凹角两侧候选之间
 * 交替命中 → 部队每帧走满速度却在几像素内来回弹（实测活锁：150 帧后原地打转）。
 * 所以目标点必须插值到「与单位同一分量」的格上。
 *
 * 与 passGrid 同源缓存（地形与建筑一局内不变，重建代价可忽略）。
 */
function compLabels(game) {
  const pg = passGrid(game);
  if (!pg) return null;
  const t = game.terrain;
  const key = (game.hqs || []).map((h) => (h.down ? 1 : 0)).join('');
  if (game._compGrid && game._compGridFor === pg && game._compGridKey === key) {
    return game._compGrid;
  }
  const cols = t.cols;
  const rows = t.rows;
  const total = cols * rows;
  const lab = new Int32Array(total).fill(-1);
  const sizes = [];
  const stack = new Int32Array(total);
  // 崖也算隔断（含对角切角）：口径与流场 BFS 的 navStepOk 完全一致。
  // 不然「隔崖相望」或「只能对角切过去」的两块地会被当成同一分量，寻路把目标判成可达，
  // 部队走到崖前/崖角就再也过不去。
  for (let i = 0; i < total; i++) {
    if (!pg[i] || lab[i] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    let sp = 0;
    stack[sp++] = i;
    lab[i] = id;
    while (sp > 0) {
      const cur = stack[--sp];
      size++;
      const c0 = cur % cols;
      const r0 = (cur - c0) / cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c0 + dc;
          const nr = r0 + dr;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const n = nr * cols + nc;
          if (!pg[n] || lab[n] >= 0) continue;
          if (!navStepOk(game, pg, cols, cur, n)) continue;
          lab[n] = id;
          stack[sp++] = n;
        }
      }
    }
    sizes.push(size);
  }
  game._compGrid = { lab, sizes, cols, rows };
  game._compGridFor = pg;
  game._compGridKey = key;
  return game._compGrid;
}

/** 世界坐标 → 格坐标（越界钳制） */
function cellOf(game, x, y) {
  const t = game.terrain;
  let c = Math.floor(x / t.cell);
  let r = Math.floor(y / t.cell);
  if (c < 0) c = 0;
  else if (c >= t.cols) c = t.cols - 1;
  if (r < 0) r = 0;
  else if (r >= t.rows) r = t.rows - 1;
  return { c, r, i: r * t.cols + c };
}

/**
 * 本步允许新建多少个流场 —— 按**在场单位数**派生，不写死。
 *
 * 为什么要派生：流场按目标格缓存，命中就不花钱。真正花钱的是「同一帧里 many 个单位
 * 各自奔向不同目标」—— 每个人都未命中，人数一多就把固定额度瓜分光。额度不足的后果
 * 不是「这帧路算得糙一点」，而是 flowField 返回 null → 寻路整体退化成直线转向 →
 * 部队撞在山体/崖壁上原地抖动（实测冻结 100s+）。
 *
 * 额度按人头给，且留足余量：一个单位这一帧最多需要 1 个新流场（其余靠缓存与父链复用），
 * 所以 2×单位数 足以让所有单位都拿到路；再封顶，避免百人同帧爆建。
 */
function flowBudgetFor(game) {
  let n = 0;
  const us = game && game.units;
  if (us) {
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      if (u && !u.dead) n++;
    }
  }
  return Math.max(FLOW_BUILD_BASE, Math.min(FLOW_BUILD_MAX, n * FLOW_BUILD_PER_UNIT));
}

/**
 * 以目标点所在格为源做加权 Dijkstra，再按 SolasXer/vector-field-pathfinding 的口径
 * 生成「每格指向最优邻格」的方向向量场（MIT，https://github.com/SolasXer/vector-field-pathfinding）。
 *
 * 代价场：边代价 = navEdgeCost（几何距离 + 换层/走坡罚），有同层平路时不会拐去走坡再拐回。
 * 向量场：对每格在 8 邻域里挑「navStepOk 且 dist 最低」的邻格（与仓库 findOptimalNeighbor 同思路），
 *         存 next / dirX / dirY；⚠️ 邻格必须过 navStepOk，否则会指到崖对面（旧贪心抖动根因）。
 * 目标格会先按「与 (fromX,fromY) 同属一个连通分量」修正——否则目标落在山体里时，
 * 最近的可通行格若是孤立小岛，整张流场会把单位所在大陆标成不可达（寻路直接失效）。
 * 按目标格缓存（集结点固定不变、群体下令共用同一目标，命中率很高）。
 * 再加一道「每步新建上限」兜底，避免大量单位各自追击不同移动目标时单步爆建流场。
 */
function flowField(game, goalX, goalY, fromX, fromY) {
  const t = game.terrain;
  if (!t) return null;
  const pg = passGrid(game);
  if (!pg) return null;
  // 单位所在连通分量：单位可能正站在「建筑占位格」上（格心落在占位圆内），
  // 此时自身格 label = -1，退一步取它最近的可通行格所属分量。
  let uc = null;
  if (Number.isFinite(fromX) && Number.isFinite(fromY)) {
    const cb = compLabels(game);
    if (cb) {
      const mi = cellOf(game, fromX, fromY).i;
      uc = cb.lab[mi];
      if (uc < 0) {
        const np = nearestPassable(game, fromX, fromY);
        if (np) uc = cb.lab[cellOf(game, np.x, np.y).i];
      }
      if (uc < 0) uc = null;
    }
  }
  // 「目标格矫正」的记忆：同一格目标 + 同一分量，答案不会变（passGrid 变了会整表作废）。
  // 没有它，上百个单位追同一个目标时每单位每步都要重跑一遍环形搜索（含 12 圈邻域展开）。
  if (!game._flowCache) game._flowCache = new Map();
  if (!game._goalFix) game._goalFix = new Map();
  const rawGoal = cellOf(game, goalX, goalY);
  const ucKey = uc == null ? -1 : uc;
  let gi = null;
  let fix = game._goalFix.get(rawGoal.i);
  if (fix && fix.has(ucKey)) {
    gi = fix.get(ucKey);
  } else {
    // noScan：寻路不做全图扫描 —— 12 格环里找不到同分量格，说明目标不在部队这一侧，
    // 返回 null 退回直线转向（建出来的流场反正标不到部队那一格，结果等价，省下 8 万格遍历）。
    const gp = nearestPassable(game, goalX, goalY, uc, { noScan: true });
    if (!gp) return null;
    gi = cellOf(game, gp.x, gp.y);
    if (!fix) {
      fix = new Map();
      game._goalFix.set(rawGoal.i, fix);
    }
    fix.set(ucKey, gi);
  }
  const hit = game._flowCache.get(gi.i);
  if (hit) return hit;
  // 每步新建流场的预算（step() 开头重置）
  if ((game._flowBudget || 0) <= 0) return null;
  game._flowBudget -= 1;

  const cols = t.cols;
  const rows = t.rows;
  const tot = cols * rows;
  const INF = 1e30;
  // 边口径 = navStepOk；代价 = navEdgeCost（斜边 √2 + 换层/坡罚）
  // ⚠️ 必须用 Float64：Float32 舍入会让堆里的 d !== dist[cur]，整表 Dijkstra 失效
  const dist = new Float64Array(tot);
  dist.fill(INF);
  // 父指针：「这一格是从哪一格走过来的」。沿它回溯就是一条**真正走得通**的路 ——
  // 每一步都是亲自验过的导航边，绝不会像「贪心挑 dist 最小的邻格」
  // 那样挑到一条隔着崖、迈不过去的近路（那正是部队在崖沿原地抖动的老毛病）。
  const prev = new Int32Array(tot).fill(-1);
  const hd = [];
  const hi = [];
  const hpush = (d, id) => {
    hd.push(d);
    hi.push(id);
    let i = hd.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      const td = hd[p];
      hd[p] = hd[i];
      hd[i] = td;
      const ti = hi[p];
      hi[p] = hi[i];
      hi[i] = ti;
      i = p;
    }
  };
  const hpop = () => {
    const d = hd[0];
    const id = hi[0];
    const ld = hd.pop();
    const li = hi.pop();
    if (hd.length) {
      hd[0] = ld;
      hi[0] = li;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r2 = l + 1;
        let m = i;
        if (l < hd.length && hd[l] < hd[m]) m = l;
        if (r2 < hd.length && hd[r2] < hd[m]) m = r2;
        if (m === i) break;
        const td = hd[m];
        hd[m] = hd[i];
        hd[i] = td;
        const ti = hi[m];
        hi[m] = hi[i];
        hi[i] = ti;
        i = m;
      }
    }
    return [d, id];
  };
  dist[gi.i] = 0;
  hpush(0, gi.i);
  while (hd.length) {
    const [d, cur] = hpop();
    if (d !== dist[cur]) continue;
    const c0 = cur % cols;
    const r0 = (cur - c0) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c0 + dc;
        const nr = r0 + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const n = nr * cols + nc;
        if (!navStepOk(game, pg, cols, cur, n)) continue;
        const nd = d + navEdgeCost(game, cur, n);
        if (nd + 1e-9 < dist[n]) {
          dist[n] = nd;
          prev[n] = cur;
          hpush(nd, n);
        }
      }
    }
  }
  for (let i = 0; i < tot; i++) {
    if (dist[i] >= INF * 0.5) dist[i] = -1;
  }

  // —— 向量场（SolasXer：updateAllGridsVectors / findOptimalNeighbor）——
  // 每格指向「可一步迈过去、且到目标代价最低」的邻格；单位采样该方向即可前进。
  // prev 仍保留：诊断 / 冒烟沿父链回溯；向量与 prev 在多数格上一致，多最优邻时向量取最低 dist。
  const next = new Int32Array(tot).fill(-1);
  const dirX = new Float32Array(tot);
  const dirY = new Float32Array(tot);
  for (let i = 0; i < tot; i++) {
    if (dist[i] < 0 || i === gi.i) continue;
    const c0 = i % cols;
    const r0 = (i - c0) / cols;
    let best = -1;
    let bestD = INF;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c0 + dc;
        const nr = r0 + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const n = nr * cols + nc;
        const nd = dist[n];
        if (nd < 0) continue;
        if (!navStepOk(game, pg, cols, i, n)) continue;
        if (nd + 1e-9 < bestD) {
          bestD = nd;
          best = n;
        }
      }
    }
    if (best < 0) continue;
    next[i] = best;
    const bc = best % cols;
    const br = (best - bc) / cols;
    let vx = bc - c0;
    let vy = br - r0;
    const len = Math.hypot(vx, vy);
    if (len > 1e-6) {
      dirX[i] = vx / len;
      dirY[i] = vy / len;
    }
  }

  const field = {
    dist,
    prev,
    next,
    dirX,
    dirY,
    cols,
    rows,
    goalIdx: gi.i,
    gx: (gi.c + 0.5) * t.cell,
    gy: (gi.r + 0.5) * t.cell,
    cell: t.cell,
  };
  game._flowCache.set(gi.i, field);
  if (game._flowCache.size > FLOW_CACHE_MAX) {
    // 简单淘汰：丢弃最早写入的一半，避免追击目标频繁变动时无限增长
    let k = 0;
    for (const key of game._flowCache.keys()) {
      game._flowCache.delete(key);
      if (++k >= FLOW_CACHE_MAX / 2) break;
    }
  }
  return field;
}

/** 拉直时最多往前看多少格（越远越直，但要一路验通行，别贪） */
const FLOW_PULL_AHEAD = 12;
/**
 * 拉出来的弦允许偏离父链多远（×格边长）。
 * 旧值 0.7 太紧：L 形父链的对角弦会把拐角点甩出带宽 → 永远只能「横一段 + 竖一段」。
 * 8 向流场后路径本身更斜，带宽略放宽，斜向长弦才拉得出来。
 */
const FLOW_PULL_BAND = 1.4;

/**
 * 「从 (ax,ay) 到 (bx,by) 这条直线走得通吗」—— 与 segmentClear 同口径
 * （可通行 + 不跨崖 + 不许对角切角）。只给「拉直」用。
 */
function lineClear(game, ax, ay, bx, by) {
  return segmentClear(game, ax, ay, bx, by);
}

/** 点 p 到线段 ab 的垂距（用于「拉直后别偏离父链太远」） */
function perpDist(ax, ay, bx, by, px, py) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const L2 = vx * vx + vy * vy;
  if (L2 < 1e-9) return Math.hypot(wx, wy);
  const tt = clamp((wx * vx + wy * vy) / L2, 0, 1);
  return Math.hypot(wx - vx * tt, wy - vy * tt);
}

/**
 * 找一格「既站得住人、又能从 (x,y) 一步走过去（不跨崖）」的落点，按距离由近到远。
 * 给「站在建筑占位格里出不去」的部队脱困用 —— 只看掩码的最近格可能在崖对面，
 * 朝它走会被 canStand 判死，部队就卡死了。
 */
/**
 * 「从这里怎么绕出去、回到通往目标的那片地」—— 局部 BFS 找**能到达目标**的最近一格。
 *
 * 只在部队被圈住时用（stepViaFlow 的兜底分支）。与 nearestSteppable 的区别是关键性的：
 * 后者只找「最近的可通行格」，而那一格很可能还在同一个死胡同里 —— 部队走过去、下一帧
 * 又走回来，于是 3~4px 地抖（实测：一支激光兵抖了 120 秒、累计走了 10200px 却原地未动，
 * 因为它卡在「北边是崖、南边是建筑占位」的一条洼地里）。
 *
 * 这里按**真正走得通的边**（可通行 + 不跨崖）往外扩，一旦碰到流场里 dist ≥ 0 的格子
 * （即「从这儿能走到目标」），就沿父链回溯出第一步。走完这一步，部队就回到正常寻路了。
 *
 * @returns {{x:number,y:number}|null} 第一步该迈向哪（格心）；null = 真出不去
 */
function escapeStep(game, u, f, me) {
  const t = game.terrain;
  if (!t || !f) return null;
  const pg = passGrid(game);
  if (!pg) return null;
  const cols = t.cols;
  const rows = t.rows;
  const tot = cols * rows;
  // 复用的搜索暂存区（整局只分配一次，靠 stamp 递增免清零）
  if (!game._escPrev || game._escPrev.length !== tot) {
    game._escPrev = new Int32Array(tot);
    game._escSeen = new Int32Array(tot);
    game._escQueue = new Int32Array(tot);
    game._escStamp = 1;
  }
  const prev = game._escPrev;
  const seen = game._escSeen;
  const queue = game._escQueue;
  // 卡住的部队一帧调一次，结果按「目标格 + 自身格」缓存（抖动时这两者都不变，命中率极高）
  if (!game._escCache) game._escCache = new Map();
  const ck = f.goalIdx * 1048576 + me.i;
  const cached = game._escCache.get(ck);
  if (cached !== undefined) return cached === 0 ? null : { x: cached.x, y: cached.y };
  const stamp = game._escStamp++;
  let head = 0;
  let tail = 0;
  seen[me.i] = stamp;
  prev[me.i] = -1;
  queue[tail++] = me.i;
  let hit = -1;
  const LIMIT = 24000; // 最多扩这么多格（≈ 半径 87 格 = 3480px），再远就不叫「附近」了
  while (head < tail && tail < LIMIT) {
    const cur = queue[head++];
    const c0 = cur % cols;
    const r0 = (cur - c0) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c0 + dc;
        const nr = r0 + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const n = nr * cols + nc;
        if (seen[n] === stamp) continue;
        if (!navStepOk(game, pg, cols, cur, n)) continue;
        seen[n] = stamp;
        prev[n] = cur;
        // 「从这一格能走到目标」→ 找到了出口（起点自己不算：到这一步说明起点已经走不通）
        if (f.dist[n] >= 0) {
          hit = n;
          break;
        }
        queue[tail++] = n;
      }
      if (hit >= 0) break;
    }
    if (hit >= 0) break;
  }
  let out = null;
  if (hit >= 0) {
    // 回溯到「离开自身格的第一步」：那就是部队该迈向的地方
    let node = hit;
    while (prev[node] >= 0 && prev[node] !== me.i) node = prev[node];
    const nc = node % cols;
    const nr = (node - nc) / cols;
    out = { x: (nc + 0.5) * t.cell, y: (nr + 0.5) * t.cell };
  }
  if (game._escCache.size > 400) game._escCache.clear();
  game._escCache.set(ck, out || 0);
  return out;
}

function nearestSteppable(game, x, y) {
  const t = game.terrain;
  if (!t) return null;
  const pg = passGrid(game);
  if (!pg) return null;
  const me = cellOf(game, x, y);
  const cols = t.cols;
  const rows = t.rows;
  // 按真正走得通的边（8 向 + 不跨崖 + 不切角）往外扩，不能只比两端层高 ——
  // 否则「两边都是 0 层、中间隔着崖」的远格会被当成可一步迈过去。
  const seen = new Uint8Array(cols * rows);
  const q = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  seen[me.i] = 1;
  q[tail++] = me.i;
  while (head < tail) {
    const cur = q[head++];
    if (cur !== me.i && pg[cur]) {
      const c = cur % cols;
      const r = (cur - c) / cols;
      return { x: (c + 0.5) * t.cell, y: (r + 0.5) * t.cell };
    }
    const c0 = cur % cols;
    const r0 = (cur - c0) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c0 + dc;
        const nr = r0 + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const n = nr * cols + nc;
        if (seen[n]) continue;
        if (!navStepOk(game, pg, cols, cur, n)) continue;
        seen[n] = 1;
        q[tail++] = n;
      }
    }
    if (tail > 2000) break; // 只在附近找脱困点
  }
  return nearestPassable(game, x, y);
}

/**
 * 流场拿不到时的兜底绕障：朝目标做一次**有界环形搜索**，找「不比现在更差、且能离开
 * 当前受阻方向」的一步。
 *
 * 为什么不用 localSteer：那个搜索框按「单位↔目标」距离放大，远距离时框能铺满整张图，
 * 等于把全局 BFS 的代价又付一遍 —— 预算不够时再叠加这个，更容易雪上加霜。
 * 这里固定只看身边 DETOUR_RING 格（够绕开总部/崖角这类近处障碍），
 * 代价恒定，部队至少能贴着障碍挪出去，而不是把脸贴在墙上。
 *
 * @returns {boolean|null} true/false = 已决定移动/不动；null = 「实在没主意」，交回直线转向
 */
const DETOUR_RING = 14; // 格：兜底搜索只看这么大一圈（560px）
function detourStep(game, u, goalX, goalY, spd, dt) {
  const t = game.terrain;
  const pg = passGrid(game);
  if (!t || !pg) return null;
  const cols = t.cols;
  const rows = t.rows;
  const me = cellOf(game, u.x, u.y);
  const toGoal = Math.atan2(goalY - u.y, goalX - u.x);
  const d0 = dist(u.x, u.y, goalX, goalY);

  // 以单位为中心铺一个 DETOUR_RING 见方的小场，做多源 BFS：
  // 源是「这一圈里能站人、且离目标更近」的格子 —— 从它们反向回溯到单位，
  // 得到的就是「从单位出发能真正离开」的方向。
  const r0 = Math.max(0, me.r - DETOUR_RING);
  const r1 = Math.min(rows - 1, me.r + DETOUR_RING);
  const c0 = Math.max(0, me.c - DETOUR_RING);
  const c1 = Math.min(cols - 1, me.c + DETOUR_RING);
  const w = c1 - c0 + 1;
  const h = r1 - r0 + 1;
  const N = w * h;
  if (N <= 1) return null;
  // 复用局部寻路的缓冲（同尺寸语义），不够再按需扩容
  if (!game._detourSeen || game._detourSeen.length < N) {
    game._detourSeen = new Int32Array(N);
    game._detourPrev = new Int32Array(N);
    game._detourQueue = new Int32Array(N);
    game._detourStamp = 1;
  }
  const seen = game._detourSeen;
  const prevA = game._detourPrev;
  const q = game._detourQueue;
  const stamp = game._detourStamp++;
  if (game._detourStamp > 0x3fffffff) {
    seen.fill(0);
    game._detourStamp = 1;
  }
  let head = 0;
  let tail = 0;
  // 源：框内可通行、且**到目标更近**的格子（局部最优的方向感）
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * cols + c;
      if (!pg[i]) continue;
      const px = (c + 0.5) * t.cell;
      const py = (r + 0.5) * t.cell;
      if (dist(px, py, goalX, goalY) >= d0 - 1) continue;
      const k = (r - r0) * w + (c - c0);
      if (seen[k] === stamp) continue;
      seen[k] = stamp;
      prevA[k] = -1;
      q[tail++] = k;
    }
  }
  if (!tail) return null;
  // 从源反向扩散，navStepOk 与全局完全同口径（可通行 + 不跨崖 + 不切角）
  while (head < tail) {
    const k = q[head++];
    const r = (r0 + ((k / w) | 0));
    const c = c0 + (k % w);
    const gi = r * cols + c;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < r0 || nr > r1 || nc < c0 || nc > c1) continue;
        const nk = (nr - r0) * w + (nc - c0);
        if (seen[nk] === stamp) continue;
        const ni = nr * cols + nc;
        if (!navStepOk(game, pg, cols, gi, ni)) continue;
        seen[nk] = stamp;
        prevA[nk] = k;
        q[tail++] = nk;
      }
    }
  }
  // 沿父链从单位所在格回溯，找**第一个站得住人**的落点当方向
  const startK = (me.r - r0) * w + (me.c - c0);
  let k = startK;
  if (seen[k] !== stamp) {
    // 单位站在占位格（掩码 0）上：先找身边一个能接上这片场的可通行格
    let bestK = -1;
    let bestD = Infinity;
    for (let dr = -1; dr <= 1 && bestK < 0; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = me.r + dr;
        const nc = me.c + dc;
        if (nr < r0 || nr > r1 || nc < c0 || nc > c1) continue;
        const nk = (nr - r0) * w + (nc - c0);
        if (seen[nk] !== stamp) continue;
        const d = dist((nc + 0.5) * t.cell, (nr + 0.5) * t.cell, goalX, goalY);
        if (d < bestD) {
          bestD = d;
          bestK = nk;
        }
      }
    }
    if (bestK < 0) return null;
    k = bestK;
  }
  let node = k;
  for (let step = 0; step < DETOUR_RING * 2; step++) {
    const p = prevA[node];
    if (p < 0) break;
    const r = r0 + ((node / w) | 0);
    const c = c0 + (node % w);
    const nx = (c + 0.5) * t.cell;
    const ny = (r + 0.5) * t.cell;
    if (canStand(game, nx, ny, u.r, u.x, u.y)) {
      const ld = dist(u.x, u.y, nx, ny);
      if (ld > 0.5) {
        return slideStep(game, u, Math.atan2(ny - u.y, nx - u.x), Math.min(spd, ld), dt);
      }
    }
    node = p;
  }
  // 一格都迈不出去 → 别硬转（转了也是原地抖），交给 unstuck 逻辑
  return null;
}

/**
 * 近距局部寻路：只在「单位 ↔ 目标」外扩 LOCAL_PATH_MARGIN 格的小框里做加权 Dijkstra。
 * 解决「点了很近的地方，全局流场却绕总部/山体走半张图」—— 框外的长绕行根本进不了候选。
 * 代价与全局流场同口径（navEdgeCost），平路优先。
 * @returns {{x:number,y:number}|null} 下一步迈向的点（格心或目标点）；null = 框内走不通
 */
const LOCAL_PATH_MARGIN = 28; // 格：近距框外扩（约 1120px），够绕过总部+门口厂+研究所团
const LOCAL_PATH_MAX_DIST = 1000; // px：超过这个距离仍走全局流场

function localSteer(game, u, goalX, goalY) {
  const t = game.terrain;
  const pg = passGrid(game);
  if (!t || !pg) return null;
  const cols = t.cols;
  const rows = t.rows;
  // 落点先推出建筑占位圆，与 move 指令同口径
  const snapped = snapOutsideBuildings(game, goalX, goalY);
  goalX = snapped.x;
  goalY = snapped.y;
  const me = cellOf(game, u.x, u.y);
  let gCell = cellOf(game, goalX, goalY);
  if (!pg[gCell.i]) {
    const np = nearestPassable(game, goalX, goalY, null, { noScan: true });
    if (!np) return null;
    gCell = cellOf(game, np.x, np.y);
    goalX = np.x;
    goalY = np.y;
  }
  if (gCell.i === me.i) return { x: goalX, y: goalY };
  // 搜索框：以单位/目标为对角外扩；过窄时撑到最小跨度，保证「隔着一座总部」也能绕
  const minSpan = 48;
  let cMin = Math.min(me.c, gCell.c) - LOCAL_PATH_MARGIN;
  let cMax = Math.max(me.c, gCell.c) + LOCAL_PATH_MARGIN;
  let rMin = Math.min(me.r, gCell.r) - LOCAL_PATH_MARGIN;
  let rMax = Math.max(me.r, gCell.r) + LOCAL_PATH_MARGIN;
  if (cMax - cMin < minSpan) {
    const mid = (cMin + cMax) >> 1;
    cMin = mid - (minSpan >> 1);
    cMax = mid + (minSpan >> 1);
  }
  if (rMax - rMin < minSpan) {
    const mid = (rMin + rMax) >> 1;
    rMin = mid - (minSpan >> 1);
    rMax = mid + (minSpan >> 1);
  }
  cMin = Math.max(0, cMin);
  cMax = Math.min(cols - 1, cMax);
  rMin = Math.max(0, rMin);
  rMax = Math.min(rows - 1, rMax);
  // 局部 Dijkstra：以目标为源，只在框内扩（复用缓冲）
  const tot = cols * rows;
  const INF = 1e30;
  if (!game._localDist || game._localDist.length !== tot) {
    game._localDist = new Float64Array(tot);
    game._localPrev = new Int32Array(tot);
  }
  const distA = game._localDist;
  const prevA = game._localPrev;
  distA.fill(INF);
  prevA.fill(-1);
  const hd = [];
  const hi = [];
  const hpush = (d, id) => {
    hd.push(d);
    hi.push(id);
    let i = hd.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      const td = hd[p];
      hd[p] = hd[i];
      hd[i] = td;
      const ti = hi[p];
      hi[p] = hi[i];
      hi[i] = ti;
      i = p;
    }
  };
  const hpop = () => {
    const d = hd[0];
    const id = hi[0];
    const ld = hd.pop();
    const li = hi.pop();
    if (hd.length) {
      hd[0] = ld;
      hi[0] = li;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r2 = l + 1;
        let m = i;
        if (l < hd.length && hd[l] < hd[m]) m = l;
        if (r2 < hd.length && hd[r2] < hd[m]) m = r2;
        if (m === i) break;
        const td = hd[m];
        hd[m] = hd[i];
        hd[i] = td;
        const ti = hi[m];
        hi[m] = hi[i];
        hi[i] = ti;
        i = m;
      }
    }
    return [d, id];
  };
  distA[gCell.i] = 0;
  hpush(0, gCell.i);
  while (hd.length) {
    const [d, cur] = hpop();
    if (d !== distA[cur]) continue;
    if (cur === me.i) break;
    const c0 = cur % cols;
    const r0 = (cur - c0) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c0 + dc;
        const nr = r0 + dr;
        if (nc < cMin || nc > cMax || nr < rMin || nr > rMax) continue;
        const n = nr * cols + nc;
        // 部队可能站在建筑占位格（pg[me]=0）：允许扩到 me，其它格仍走 navStepOk
        let edgeOk = false;
        if (n === me.i) {
          if (!cliffBetween(game, cur, n)) {
            if (dc && dr) {
              const iH = r0 * cols + nc;
              const iV = nr * cols + c0;
              edgeOk = !cliffBetween(game, cur, iH) && !cliffBetween(game, cur, iV);
            } else {
              edgeOk = true;
            }
          }
        } else {
          edgeOk = navStepOk(game, pg, cols, cur, n);
        }
        if (!edgeOk) continue;
        const stepCost = n === me.i
          ? (dc && dr ? NAV_COST_DIAG : NAV_COST_ORTH)
          : navEdgeCost(game, cur, n);
        const nd = d + stepCost;
        if (nd + 1e-9 < distA[n]) {
          distA[n] = nd;
          prevA[n] = cur;
          hpush(nd, n);
        }
      }
    }
  }
  if (distA[me.i] >= INF * 0.5) return null;
  // 沿父链走一步（拉直：能直达的最远框内点）
  const chain = [];
  let node = me.i;
  for (let k = 0; k < 16 && node !== gCell.i; k++) {
    const nx = prevA[node];
    if (nx < 0) break;
    const nc = nx % cols;
    const nr = (nx - nc) / cols;
    chain.push({
      x: nx === gCell.i ? goalX : (nc + 0.5) * t.cell,
      y: nx === gCell.i ? goalY : (nr + 0.5) * t.cell,
    });
    node = nx;
  }
  if (!chain.length) return { x: goalX, y: goalY };
  for (let k = chain.length - 1; k >= 0; k--) {
    if (lineClear(game, u.x, u.y, chain[k].x, chain[k].y)) return chain[k];
  }
  return chain[0];
}

/**
 * 沿向量场朝目标推进一小步。
 *
 * 走法（2026-10-09 换成 SolasXer 向量场：每格一个方向，单位采样后前进；
 *       代价场仍是加权 Dijkstra，邻格方向必须过 navStepOk）：
 *   ⓪ 直线走得通 → 直奔（最近的点击别绕）；近距优先局部寻路，挡住全局大绕行。
 *   ① 单位所在格可达 → 沿 **向量场 next 链**往前最多看 FLOW_PULL_AHEAD 格，
 *      再**前瞻拉直**：取「直线走得通、且整条弦贴向量链」的最远路点当落点。
 *   ② 单位站在**建筑占位格**上（该格在掩码里是 0，向量指不到它）→ 退回邻域搜索：
 *      挑一个「可达且不跨崖」的邻格走出去（这一步之后就回到 ①）。
 *   ③ 连这样的邻格都没有（真的被崖 / 建筑圈死）→ escapeStep / nearestSteppable，
 *      脱不出去才退回直线转向。
 *
 * @returns {boolean} 是否发生了移动
 */
function stepViaFlow(game, u, goalX, goalY, spd, dt) {
  const direct = () => slideStep(game, u, Math.atan2(goalY - u.y, goalX - u.x), spd, dt);
  // 已身处不可通行地形（异常）→ 先脱困，不参与寻路
  if (!terrainPassable(game, u.x, u.y)) return unstuckStep(game, u, spd);

  const dGoal = dist(u.x, u.y, goalX, goalY);
  // ⓪a 直线走得通：最近也别绕流场
  if (dGoal > 0.5 && lineClear(game, u.x, u.y, goalX, goalY) && canStand(game, goalX, goalY, u.r, u.x, u.y)) {
    return slideStep(game, u, Math.atan2(goalY - u.y, goalX - u.x), Math.min(spd, dGoal), dt);
  }
  // ⓪b 近距：局部框内寻路（挡住「绕总部半圈」那种全局父链）
  if (dGoal > 0.5 && dGoal <= LOCAL_PATH_MAX_DIST) {
    const loc = localSteer(game, u, goalX, goalY);
    if (loc) {
      const ld = dist(u.x, u.y, loc.x, loc.y);
      if (ld > 0.5) {
        return slideStep(game, u, Math.atan2(loc.y - u.y, loc.x - u.x), Math.min(spd, ld), dt);
      }
    }
  }

  const f = flowField(game, goalX, goalY, u.x, u.y);
  // ⚠️ 流场拿不到（预算耗尽 / 目标不在本侧）时**不能直接直线撞墙**：
  //    直线转向会让部队贴着山体或崖壁每帧微调，净位移≈0 —— 表现就是「点了移动却不动」。
  //    这里退到局部寻路：它只在自身周围几十格内 BFS，不消耗全局流场预算，
  //    足以让部队贴着障碍绕出去；局部也失败才真的只能直线转向。
  if (!f) {
    const fb = detourStep(game, u, goalX, goalY, spd, dt);
    if (fb !== null) return fb;
    return direct();
  }
  const t = game.terrain;
  const me = cellOf(game, u.x, u.y);
  const cur = f.dist[me.i];

  // 全局流场绕行过远（近距目标却要走上百格）→ 再试局部；仍没有才贴障滑行
  if (cur > 0 && dGoal > 0.5 && dGoal <= LOCAL_PATH_MAX_DIST && cur * t.cell > dGoal * 2.6 + 160) {
    const loc2 = localSteer(game, u, goalX, goalY);
    if (loc2) {
      const ld = dist(u.x, u.y, loc2.x, loc2.y);
      if (ld > 0.5) {
        return slideStep(game, u, Math.atan2(loc2.y - u.y, loc2.x - u.x), Math.min(spd, ld), dt);
      }
    }
    // 贪心：迈向「距目标更近」的邻格，贴着建筑绕，避免无脑撞墙空转
    const pgN = passGrid(game);
    let bestX = 0;
    let bestY = 0;
    let bestD = dGoal;
    let found = false;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const r = me.r + dr;
        const c = me.c + dc;
        if (r < 0 || r >= t.rows || c < 0 || c >= t.cols) continue;
        const ni = r * t.cols + c;
        if (!navStepOk(game, pgN, t.cols, me.i, ni) && !(me.i >= 0 && !pgN[me.i] && pgN[ni] && !cliffBetween(game, me.i, ni))) {
          continue;
        }
        const nx = ni === f.goalIdx ? goalX : (c + 0.5) * t.cell;
        const ny = ni === f.goalIdx ? goalY : (r + 0.5) * t.cell;
        if (!canStand(game, nx, ny, u.r, u.x, u.y)) continue;
        const nd = dist(nx, ny, goalX, goalY);
        if (nd < bestD - 0.5) {
          bestD = nd;
          bestX = nx;
          bestY = ny;
          found = true;
        }
      }
    }
    if (found) return slideStep(game, u, Math.atan2(bestY - u.y, bestX - u.x), Math.min(spd, dist(u.x, u.y, bestX, bestY)), dt);
    return direct();
  }

  // 已在目标格内：直奔精确目标点
  if (cur === 0) {
    const d = dist(u.x, u.y, f.gx, f.gy);
    if (d < 0.5) return false;
    return slideStep(game, u, Math.atan2(f.gy - u.y, f.gx - u.x), Math.min(spd, d), dt);
  }

  const cols = f.cols;
  const rows = f.rows;
  let tx = 0;
  let ty = 0;
  let got = false;

  if (cur > 0 && f.next) {
    // ① 沿向量场 next 链取出前缀（至多 FLOW_PULL_AHEAD 个路点）……
    //    单格也可直接用 dirX/dirY 当速度方向（SolasXer Agent 采样槽位方向）；
    //    这里多看几格再拉直，避免大地图上一格一格蹭。
    const chain = [];
    let node = me.i;
    for (let k = 0; k < FLOW_PULL_AHEAD; k++) {
      const nx = f.next[node];
      if (nx < 0) break;
      const nc = nx % cols;
      const nr = (nx - nc) / cols;
      chain.push({ x: (nc + 0.5) * t.cell, y: (nr + 0.5) * t.cell, last: nx === f.goalIdx });
      node = nx;
      if (nx === f.goalIdx) break;
    }
    // ……再从最远的那个往回试，取第一个「直线走得通、且整条弦都贴着向量链」的当落点。
    // ⚠️ 走廊约束不能省：只验「终点走得通」的话，部队会沿着一条斜弦滑走，
    //    一步就滑进隔壁格子 —— 那格的向量又指回原处，于是两步一翻转、原地转圈。
    const band = t.cell * FLOW_PULL_BAND;
    for (let k = chain.length - 1; k >= 0; k--) {
      const c = chain[k];
      const gx = c.last ? f.gx : c.x;
      const gy = c.last ? f.gy : c.y;
      if (!lineClear(game, u.x, u.y, gx, gy)) continue;
      let inBand = true;
      for (let j = 0; j < k; j++) {
        if (perpDist(u.x, u.y, gx, gy, chain[j].x, chain[j].y) > band) {
          inBand = false;
          break;
        }
      }
      if (!inBand) continue;
      tx = gx;
      ty = gy;
      got = true;
      break;
    }
    // 链拉直全失败时：退回本格方向向量（SolasXer 默认走法）
    if (!got && f.dirX && f.dirY) {
      const vx = f.dirX[me.i];
      const vy = f.dirY[me.i];
      if (vx * vx + vy * vy > 1e-6) {
        tx = u.x + vx * t.cell;
        ty = u.y + vy * t.cell;
        got = true;
      }
    }
  }

  if (!got) {
    // ② 自身格不可达（站在建筑占位格里）或向量链被临时挡住：邻域搜索找一个能迈出去的格
    // ⚠️ 边口径必须与流场一致（navStepOk）：只比两端层高会漏掉「对角切崖角」。
    //    这里等价于 SolasXer 的 findOptimalNeighbor（最低 dist + 可迈）。
    const pgN = passGrid(game);
    let bestIdx = -1;
    let bestCost = Infinity;
    let bestC = 0;
    let bestR = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const r = me.r + dr;
        const c = me.c + dc;
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        const ni = r * cols + c;
        const nd = f.dist[ni];
        if (nd < 0) continue;
        if (!navStepOk(game, pgN, cols, me.i, ni)) continue;
        const cost = nd + (dr && dc ? 1.42 : 1);
        if (cost < bestCost - 1e-6) {
          bestCost = cost;
          bestIdx = ni;
          bestC = c;
          bestR = r;
        }
      }
    }
    if (bestIdx >= 0) {
      tx = bestIdx === f.goalIdx ? f.gx : (bestC + 0.5) * t.cell;
      ty = bestIdx === f.goalIdx ? f.gy : (bestR + 0.5) * t.cell;
      got = true;
    }
  }

  if (!got) {
    // ③ 被圈死了（自身格到不了目标，或邻格全迈不过去）：先找出「绕回通往目标那片地」的出口。
    //    ⚠️ 关键：出口必须是**能到目标**的格子，不能只是「最近的可通行格」——
    //    后者常常还在同一个死胡同里，部队走过去、下一帧走回来，就成了原地抖动
    //    （实测一支激光兵在「北崖 + 南建筑」的洼地里抖了 120s、累计 10200px 却纹丝不动）。
    const esc = escapeStep(game, u, f, me);
    if (esc) {
      const ed = dist(u.x, u.y, esc.x, esc.y);
      if (ed > 1 && slideStep(game, u, Math.atan2(esc.y - u.y, esc.x - u.x), Math.min(spd, ed), dt)) return true;
      // 出口就在脚下（比如隔一格但被建筑挡住）→ 按格心方向推一把，别原地不动
      return slideStep(game, u, Math.atan2(esc.y - u.y, esc.x - u.x), spd, dt);
    }
    // ④ 真的与世隔绝：退一步找「不跨崖的最近可站格」，别对着目标空推。
    //    ⚠️ 必须挑「不跨崖」的落点：nearestPassable 只认掩码，最近的格很可能就在崖对面，
    //    朝它走会被 canStand 判死 —— 于是原地不动（这就是「点了移动却纹丝不动」）。
    const esc2 = nearestSteppable(game, u.x, u.y);
    if (esc2) {
      const ed = dist(u.x, u.y, esc2.x, esc2.y);
      if (ed > 1 && slideStep(game, u, Math.atan2(esc2.y - u.y, esc2.x - u.x), Math.min(spd, ed), dt)) return true;
    }
    return direct();
  }

  return slideStep(game, u, Math.atan2(ty - u.y, tx - u.x), spd, dt);
}

/**
 * 直线步进：山地与水域均为硬障碍。
 * - 落点可通行 → 正常推进；
 * - 落点被挡 → 尝试仅沿单轴（x 或 y）贴着障碍滑行；若两轴都被挡则原地不动。
 * @returns {boolean} 是否发生了移动
 */
function stepUnit(game, u, dx, dy) {
  // 已身处不可通行地形（异常情况：被分离推挤挤入等）→ 只允许朝「最近的可通行格」脱困，
  // 绝不按指令方向前进。否则这里会变成一张免检通行证，让单位横穿整条山脉/水域。
  if (!terrainPassable(game, u.x, u.y)) {
    return unstuckStep(game, u, Math.hypot(dx, dy) || 1);
  }
  if (stepOpen(game, u.x, u.y, u.x + dx, u.y + dy)) {
    u.x += dx;
    u.y += dy;
    return true;
  }
  // 贴边滑行同样不许跨崖：否则沿着崖根一滑就上去了
  const canX = stepOpen(game, u.x, u.y, u.x + dx, u.y);
  const canY = stepOpen(game, u.x, u.y, u.x, u.y + dy);
  if (canX && !canY) {
    u.x += dx;
    return true;
  }
  if (canY && !canX) {
    u.y += dy;
    return true;
  }
  if (canX && canY) {
    u.x += dx; // 仅对角交点被挡，沿 x 轴贴边
    return true;
  }
  return false;
}

/** 出生点随机化的边界参数（世界像素） */
// 任意两座总部之间的最小间距——「旋转克隆」之后也不能贴在一起（世界 ×2 后同步放大）
const HQ_MIN_GAP = 6000;
const HQ_BUILDING_GAP = 600; // 总部与中立工厂/研究所的最小额外间距（叠在建筑半径上）
const HQ_RADIUS_JITTER = 0.2; // 椭圆半径最多向内收缩 20%（让出生点不至于永远贴在最外圈）
// 每个出生点的重掷次数。要留足余量：第 2 项的「隔 2 道山脉」是个较苛刻的地形约束，
// 候选点给得太少时会被迫放宽到 1 道甚至 0 道。
const HQ_SPOT_TRIES = 400;
const HQ_BASE_MARGIN = 800; // 出生点距世界边缘的最小距离（随世界尺寸同步放大）

/**
 * 两座建筑之间的**净缝**（占位圈之间真正能走的地带）下限，世界像素。
 *
 * ⚠️ 这是「堵路」问题的唯一判据，也是所有布局间距公式的公共口径：
 *   建筑间距必须 ≥ 两座建筑的**占位半径**之和 + 本值。
 *   占位半径 = 碰撞半径 + BLOCK_MARGIN，寻路掩码再叠加半格量化（TERRAIN_CELL/2）——
 *   早先布局公式只按「碰撞半径之和 + 一个小常数」摆位，于是
 *   ① 总部与门口研究所的占位圈**重叠**（实测净缝 −0.2 格，总部被研究所贴死）；
 *   ② 门口两座厂之间只剩 0.9 格，看着有路、实际被占位糊成一片。
 *   现在统一按占位算，并要求至少留 1.5 个地形格（60px ≈ 两排兵并行通过）。
 */
const BUILD_LANE_PX = TERR_CELL * 1.5;
/** 开道时只修「小到不可能是设计意图」的碎块（格）：更大的孤岛本身就是地形，硬接反而破图 */
const LANE_ORPHAN_MAX = 400;
/** 某座建筑的寻路占位半径（碰撞 + 外扩余量）：布局、掩码、校验三处共用同一口径 */
function occupyR(collisionR) {
  return collisionR + BLOCK_MARGIN;
}
/** 两座建筑之间的最小**中心距**（保证中间还剩 BUILD_LANE_PX 的可走净缝） */
function minCenterDist(rA, rB) {
  return occupyR(rA) + occupyR(rB) + BUILD_LANE_PX;
}
// 第 2 项：任意两座总部之间必须至少隔着这么多条**独立的山脉带**（「墙」= 山脉）。
// 判定方式：沿两座总部的连线采样地形，统计「连续山地」的段数（见 ridgeBandsBetween）。
const HQ_MIN_RIDGES = 2;

/**
 * 出生轨道的半径取值范围：
 *   上限 = data.js 的 baseRadius（再往外的点会贴到上下边界）；
 *   下限要同时满足「相邻两座总部的间距 ≥ HQ_MIN_GAP」（轨道相邻点间距 = 2R·sin(π/n)）。
 * @returns {[number, number]} [rMin, rMax]
 */
function baseRadiusRange(n) {
  const gapMin = HQ_MIN_GAP / (2 * Math.sin(Math.PI / symOrder(n)));
  const rMin = Math.min(
    Math.max(BASE_R * (1 - BASE_JITTER), gapMin + 1),
    Math.min(BASE_R, WORLD_H / 2 - HQ_BASE_MARGIN)
  );
  const rMax = Math.min(BASE_R, WORLD_H / 2 - HQ_BASE_MARGIN, WORLD_W / 2 - HQ_BASE_MARGIN);
  return [rMin, rMax];
}

/** 出生点四周是否有走得出去的口子：16 个方向里至少 3 个方向能连走 3 步 */
function baseAreaOpen(game, x, y) {
  const N = 16;
  let open = 0;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    let clear = 0;
    for (let step = 1; step <= 4; step++) {
      const rr = step * TERR_CELL * 0.9;
      if (terrainPassable(game, x + Math.cos(a) * rr, y + Math.sin(a) * rr)) clear++;
    }
    if (clear >= 3) open++;
  }
  return open >= 3;
}

/**
 * 出生点（总部位置）：不再钉死在固定角度表上，改为在椭圆环上随机取点。
 *
 * 地图是「上半 + 180° 旋转克隆」的点对称图（地形、中立工厂、研究所全是如此），
 * 所以偶数人局按 180° 配对：取一个随机点，它的克隆点（绕世界中心转 180°）交给
 * 同轴的伙伴玩家——两人分到的地形与建筑关系完全同构（公平），而落点每局都不一样。
 *
 * 随机点若太靠近世界中心，它和克隆点就会挤在一起，所以对「任意两座总部」都做
 * 最小间距判定（HQ_MIN_GAP），不满足就重掷；另外还要避开中立工厂/研究所，
 * 且四周得走得出去（别把总部塞进湖心/深山里的小坑）。
 * 逐级放宽（LADDER）保证一定有解，但最后一级也仍要求 ≥ 2×占领半径，绝不会贴脸。
 * 人数为奇数时没法两两配对，直接按同一套「间距 + 避让」规则各自随机落点。
 * @returns {{x:number, y:number}[]} 与玩家下标一一对应（已 round1）
 */
/**
 * 第 2 项：统计两点之间隔着几条「独立的山脉带」——「墙」= 山脉（不可通行的山地）。
 * 沿两点连线按半格步长采样地形，把**连续的**山地合并成一段：段数即山脉条数。
 * 中间被平原 / 水域断开的算两条（山脉本来就常被谷地分开）。
 */
function ridgeBandsBetween(game, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return 0;
  const step = TERR_CELL / 2; // 半格采样：不漏掉 1 格宽的山脊
  const n = Math.max(2, Math.ceil(len / step));
  let bands = 0;
  let inBand = false;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const isMtn = terrainCell(game, a.x + dx * t, a.y + dy * t) === TT_MOUNTAIN;
    if (isMtn && !inBand) bands += 1;
    inBand = isMtn;
  }
  return bands;
}

/**
 * 出生点布置：**整条 C_N 轨道**一次定好（n = 人数），所以各家看到的地形、到中心的距离、
 * 与邻居的关系完全同构 —— 公平性是结构性的，不再靠逐个点碰运气。
 *
 * 自由度只有两个：轨道起始相位 rot（每局随机，决定整张布局朝哪转）与出生半径。
 * 半径在 [rMin, rMax] 里摇若干个候选，逐个过「阶梯」检查（见 LADDER），
 * 取第一个合格的；整局再重排几次、按「山脉隔离最好」挑最优的一套。
 * @returns {{x:number,y:number}[]} 与玩家下标一一对应（轨道顺序）
 */
function pickBasePositions(game, count, rng, rot) {
  const n = symOrder(count);
  const pairs = (n * (n - 1)) / 2;
  let bestOut = null;
  let bestScore = -1;
  for (let attempt = 0; attempt < 12; attempt++) {
    const out = pickBasePositionOrbit(game, n, rng, rot);
    let okPairs = 0;
    let minR = 99;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const r = ridgeBandsBetween(game, out[i], out[j]);
        if (r >= HQ_MIN_RIDGES) okPairs += 1;
        if (r < minR) minR = r;
      }
    }
    // 先比「达标对数」，再比「最差那对的山脉数」
    const score = okPairs * 100 + minR;
    if (score > bestScore) {
      bestScore = score;
      bestOut = out;
    }
    if (okPairs >= pairs && minR >= HQ_MIN_RIDGES) break; // 全部达标，提前收工
  }
  return bestOut;
}

/** 摇一条出生轨道（见 pickBasePositions）：半径候选逐个过阶梯，取第一个合格的 */
function pickBasePositionOrbit(game, n, rng, rot) {
  if (!Number.isFinite(rot)) rot = rng() * Math.PI * 2;
  const [rMin, rMax] = baseRadiusRange(n);
  // 台阶：从最外圈往内一圈圈试（外圈更符合「各家守住一角」的直觉），
  // 半径差一步就有几十格，足够换一片地形。
  const cands = [];
  const steps = Math.max(8, HQ_SPOT_TRIES);
  for (let t = 0; t < steps; t++) cands.push(rMax - ((rMax - rMin) * t) / (steps - 1 || 1));
  cands.push(rMin, rMax);
  // 逐级放宽：① 避让建筑 + 四周开阔 + 隔 ≥HQ_MIN_RIDGES 条山脉 →
  //           ② 放弃「开阔」 → ③ 山脉降到 1 条 → ④ 都不强制（只保不贴脸）
  const LADDER = [
    { build: HQ_BUILDING_GAP, open: true, ridges: HQ_MIN_RIDGES },
    { build: HQ_BUILDING_GAP, open: false, ridges: HQ_MIN_RIDGES },
    { build: FACTORY_R * 2 + 60, open: false, ridges: 1 },
    { build: FACTORY_R * 2 + 20, open: false, ridges: 0 },
  ];
  /** 整条轨道是否合格：每座都要在界内、避开研究所/工厂、（可选）四周走得出去、成对隔够山脉 */
  const orbitFits = (radius, rule) => {
    const orbit = baseOrbit(rot, radius, n);
    for (const p of orbit) {
      if (p.x < HQ_BASE_MARGIN || p.x > WORLD_W - HQ_BASE_MARGIN) return null;
      if (p.y < HQ_BASE_MARGIN || p.y > WORLD_H - HQ_BASE_MARGIN) return null;
      for (const l of LABS) if (dist(l.x, l.y, p.x, p.y) < rule.build + LAB_R) return null;
      for (const f of NEUTRAL_FACTORIES) if (dist(f.x, f.y, p.x, p.y) < rule.build + FACTORY_R) return null;
      if (rule.open && !baseAreaOpen(game, p.x, p.y)) return null;
    }
    if (rule.ridges > 0) {
      for (let i = 0; i < orbit.length; i++) {
        for (let j = i + 1; j < orbit.length; j++) {
          if (ridgeBandsBetween(game, orbit[i], orbit[j]) < rule.ridges) return null;
        }
      }
    }
    return orbit;
  };
  for (const rule of LADDER) {
    for (const rr of cands) {
      const orbit = orbitFits(rr, rule);
      if (orbit) return orbit.map((p) => ({ x: round1(p.x), y: round1(p.y) }));
    }
  }
  // 兜底：最外圈（理论上到不了这里 —— 最后一档几乎什么都收）
  return baseOrbit(rot, rMax, n).map((p) => ({ x: round1(p.x), y: round1(p.y) }));
}

/** 按类型/等级计算战斗属性（进化为单一方向，无 A/B 分支）。
 *  1 阶 → 直接取 units[type]（基础数据表）；
 *  2/3 阶 → 直接取 evolved[type][tier]（进化兵种独立数据表，完整属性块）。 */
function unitStats(type, tier) {
  const t = clamp(tier, 1, 3);
  let base;
  if (t === 1) {
    base = STATS[type] || STATS.warrior;
  } else {
    base = (WFData.evolved[type] && WFData.evolved[type][t]) || STATS[type] || STATS.warrior;
  }
  return {
    hp: Math.round(base.hp),
    dmg: round1(base.dmg),
    range: Math.round(cellsToPx(base.range)), // 格 → 像素
    cd: round2(base.cd),
    bulletSpeed: Math.round(base.bulletSpeed || BULLET_SPEED_FALLBACK),
  };
}

/**
 * 把 data.js 里以「格」为单位的兵种属性块换算成**像素版**
 * （生成单位、下发给客户端都用它，客户端拿到的一律是像素）。
 *   range 格 → 像素；size 格见方 → 半径 r = size/2 格；splash / minRange 格 → 像素
 */
function statsToPx(s) {
  return Object.assign({}, s, {
    range: Math.round(cellsToPx(s.range)),
    r: sizeToR(s.size || 2),
    splash: s.splash ? Math.round(cellsToPx(s.splash)) : 0,
    // 最小射击半径（仅轰击）：比这更近的目标打不到 —— 曲射炮有射界死角
    minRange: s.minRange ? Math.round(cellsToPx(s.minRange)) : 0,
  });
}

/** 下发给客户端的兵种属性一律是像素版（客户端不感知格子） */
const STATS_PX = {};
const EVOLVED_PX = {};
for (const t of TYPE_LIST) {
  STATS_PX[t] = statsToPx(WFData.units[t]);
  EVOLVED_PX[t] = {};
  for (const k of [2, 3]) {
    if (WFData.evolved[t] && WFData.evolved[t][k]) EVOLVED_PX[t][k] = statsToPx(WFData.evolved[t][k]);
  }
}

/* ---------------- 自定义地图：装载 / 导出（地形编辑器） ---------------- */

/**
 * 地图里的 owner 一律是**座位下标**（0..n-1，中立 −1）。越界 / 非法一律当中立，
 * 坏数据不该把整个服拖下去。
 */
function mapOwnerIdx(v, n) {
  const i = Math.round(Number(v));
  return Number.isFinite(i) && i >= 0 && i < n ? i : -1;
}

/** 最近邻重采样：手工改过尺寸的文件也能塞回 TERR_ROWS × TERR_COLS */
function resampleGrid(src, srcRows, srcCols) {
  const grid = [];
  for (let r = 0; r < TERR_ROWS; r++) {
    grid[r] = new Array(TERR_COLS);
    const sr = Math.min(srcRows - 1, Math.floor((r * srcRows) / TERR_ROWS));
    for (let c = 0; c < TERR_COLS; c++) {
      const sc = Math.min(srcCols - 1, Math.floor((c * srcCols) / TERR_COLS));
      const v = src && src[sr] ? Number(src[sr][sc]) || 0 : 0;
      grid[r][c] = v === TT_MOUNTAIN || v === TT_WATER ? v : TT_PLAIN;
    }
  }
  return grid;
}

/**
 * 把「出生轨道」算出来 —— 只在地图文件**缺总部**时兜底用。
 * （正常导出一定带着 n 座总部，这条分支只是防止文件被手改坏。）
 */
function fallbackBaseOrbit(game, rot) {
  return pickBasePositions(game, game.players.length, makeRng((Date.now() ^ 0x1f2e3d4c) >>> 0), rot);
}

/**
 * 按地图文件把对局摆好（替代整条随机生成流水线）。
 *
 * 为什么必须绕开 generateTerrainGrid 那一整套：那套流水线是为了「每局随机、且 N 重对称」
 * 而写的，而编辑器要的是**所见即所得** —— 用户涂出来的每一格都得原样落地，任何
 * 「补地形 / 校正对称 / 挖主路」都会把他刚涂的东西改掉。
 *
 * @param {object} game createGameState 里已经建好的骨架（consts / players 已就位）
 * @param {object} wfMap WFMaps.loadMap() 的结果
 * @param {{ rot?: number }} [opts]
 */
function applyMapState(game, wfMap, opts) {
  const n = game.players.length;
  const count = symOrder(n);
  const rot = Number(opts && opts.rot) || 0;
  const theme =
    wfMap.theme && wfMap.theme.key
      ? {
          key: String(wfMap.theme.key),
          name: String(wfMap.theme.name || wfMap.theme.key),
          desc: String(wfMap.theme.desc || ''),
        }
      : { key: 'custom', name: '自定义地图', desc: '由地形编辑器制作' };

  let grid = wfMap.grid2;
  const srcRows = Number(wfMap.grid && wfMap.grid.rows) || TERR_ROWS;
  const srcCols = Number(wfMap.grid && wfMap.grid.cols) || TERR_COLS;
  if (!Array.isArray(grid) || grid.length !== TERR_ROWS || (grid[0] && grid[0].length !== TERR_COLS)) {
    grid = resampleGrid(grid, srcRows, srcCols);
  } else {
    // 尺寸对上了也要过一遍白名单：手改出来的 illegal 值 (1/3) 会被当成不可通行的怪地形
    grid = resampleGrid(grid, TERR_ROWS, TERR_COLS);
  }
  game.terrain = {
    cols: TERR_COLS,
    rows: TERR_ROWS,
    cell: TERR_CELL,
    grid,
    theme,
    // 编辑期不带高度场：每改一格就要重算整张高度图（摊平 + 归一化），
    // 那是几百毫秒的事，会把涂抹手感毁掉。存档时才算（见 exportCurrentMap）。
    heights: null,
  };
  game._mapGen = { theme, rng: game._rng, bands: [], order: count };
  game.mainRoads = [];

  // 骨架里预先摇好了一串「按人数均分的研究所」，那是随机流水线的一部分 ——
  // 用自定义地图时先清干净，研究所一律以文件为准（一个不多、一个不少）。
  game.labs.length = 0;

  // 建筑中心落「格心」上，和编辑器的框选对得齐
  const cellCenter = (c, r) => [(c + 0.5) * TERR_CELL, (r + 0.5) * TERR_CELL];

  // ---- 建筑 ----
  const hqSpec = new Array(n).fill(null);
  let facId = 1;
  let labId = 1;
  for (const b of wfMap.buildings || []) {
    const col = clamp(Math.round(Number(b && b.col)), 0, TERR_COLS - 1);
    const row = clamp(Math.round(Number(b && b.row)), 0, TERR_ROWS - 1);
    const p = cellCenter(col, row);
    const own = mapOwnerIdx(b && b.owner, n);
    if (b.kind === 'hq') {
      if (own >= 0 && !hqSpec[own]) hqSpec[own] = { x: p[0], y: p[1] };
    } else if (b.kind === 'factory') {
      const level = clamp(Math.round(Number(b.level) || 1), 1, 3);
      game.factories.push({
        id: facId++,
        x: p[0],
        y: p[1],
        level,
        owner: own,
        capBy: -1,
        capProg: 0,
        contested: false,
        prodProg: 0,
        lines: 1,
        specs: [makeSlot(HQ_PROD_TYPE)],
        prog: [0],
        home: false,
        hp: own >= 0 ? FACTORY_HP : Math.round(FACTORY_HP * NEUTRAL_HP_RATIO),
        hpMax: FACTORY_HP,
        lastHitBy: -1,
        evoCd: 0,
        rally: null,
      });
    } else if (b.kind === 'lab') {
      game.labs.push({
        id: labId++,
        x: p[0],
        y: p[1],
        owner: own,
        hp: own >= 0 ? LAB_HP : Math.round(LAB_HP * NEUTRAL_HP_RATIO),
        hpMax: LAB_HP,
        lastHitBy: -1,
        lines: 0,
      });
    }
  }
  // 缺总部的座位兜底：摇一条正经出生轨道补上，绝不能留 null（太多地方直接遍历 game.hqs）
  if (hqSpec.some((h) => !h)) {
    const orbit = fallbackBaseOrbit(game, rot);
    for (let i = 0; i < n; i++) {
      if (!hqSpec[i]) hqSpec[i] = { x: orbit[i].x, y: orbit[i].y };
    }
  }
  for (let i = 0; i < n; i++) {
    game.players[i].baseX = hqSpec[i].x;
    game.players[i].baseY = hqSpec[i].y;
  }
  assignProdTypes(game.factories, game._rng, count);
  game.hqs = game.players.map((p, i) => ({
    id: i + 1,
    x: p.baseX,
    y: p.baseY,
    owner: i,
    hp: HQ_HP,
    hpMax: HQ_HP,
    down: false,
    evoCd: 0,
    speedLv: 0,
    lines: 1,
    specs: [makeSlot(HQ_PROD_TYPE)],
    prog: [0],
    prodProg: 0,
    rally: null,
    atkId: 0,
    atkKind: 0, // 1 单位 / 2 工厂 / 3 研究所 / 4 总部
    atkFocus: 0, // 玩家右键指定的优先目标 id（0 = 自动索敌）
    atkFocusKind: 0,
    atkWindup: 0,
    atkCd: 0,
  }));

  // ---- 开局部队 ----
  const units = Array.isArray(wfMap.units) ? wfMap.units : [];
  if (units.length) {
    for (const u of units) {
      const own = mapOwnerIdx(u && u.owner, n);
      if (own < 0) continue;
      const type = TYPE_LIST.includes(u.type) ? u.type : TYPE_LIST[0];
      const tier = clamp(Math.round(Number(u.tier) || 1), 1, 3);
      const col = clamp(Math.round(Number(u.col)), 0, TERR_COLS - 1);
      const row = clamp(Math.round(Number(u.row)), 0, TERR_ROWS - 1);
      const p = cellCenter(col, row);
      spawnUnit(game, { id: 0, owner: own, level: tier }, type, p[0], p[1], { tier, lineIdx: 0 });
    }
  } else {
    for (let i = 0; i < n; i++) spawnStartRosterAtHq(game, game.hqs[i], i);
  }

  ensureOpenTerrain(game.terrain.grid, terrainAnchors(game));
  return game;
}

/**
 * 一张空的自定义地图（地形编辑器的画布）：整片平原、没有建筑、没有部队。
 * 座位总部在 applyMapState 里兜底生成（毕竟每位玩家必须有一座）。
 */
function blankMap(players) {
  const grid = [];
  for (let r = 0; r < TERR_ROWS; r++) grid[r] = new Array(TERR_COLS).fill(TT_PLAIN);
  return {
    file: null,
    name: '未命名地图',
    players: clamp(Math.round(Number(players) || 2), SYM_MIN_N, SYM_MAX_N),
    grid: { rows: TERR_ROWS, cols: TERR_COLS, cell: TERR_CELL },
    grid2: grid,
    theme: { key: 'custom', name: '未命名地图', desc: '由地形编辑器制作' },
    buildings: [],
    units: [],
  };
}

/**
 * 把当前对局存成地图文件：导出的是**此刻场上的样子**（地形格 + 建筑 + 部队），
 * 而不是「它是怎么生成出来的」—— 读回来什么样，这就是什么样。
 */
function exportCurrentMap(game) {
  const build = [];
  for (const h of game.hqs || []) {
    build.push({
      kind: 'hq',
      owner: h.owner,
      col: clamp(Math.floor(h.x / TERR_CELL), 0, TERR_COLS - 1),
      row: clamp(Math.floor(h.y / TERR_CELL), 0, TERR_ROWS - 1),
    });
  }
  for (const f of game.factories || []) {
    build.push({
      kind: 'factory',
      owner: f.owner,
      level: clamp(Math.round(f.level || 1), 1, 3),
      col: clamp(Math.floor(f.x / TERR_CELL), 0, TERR_COLS - 1),
      row: clamp(Math.floor(f.y / TERR_CELL), 0, TERR_ROWS - 1),
    });
  }
  for (const l of game.labs || []) {
    build.push({
      kind: 'lab',
      owner: l.owner,
      col: clamp(Math.floor(l.x / TERR_CELL), 0, TERR_COLS - 1),
      row: clamp(Math.floor(l.y / TERR_CELL), 0, TERR_ROWS - 1),
    });
  }
  const units = (game.units || []).map((u) => ({
    owner: u.ownerIdx,
    type: u.type,
    tier: clamp(Math.round(u.tier || 1), 1, 3),
    col: clamp(Math.floor(u.x / TERR_CELL), 0, TERR_COLS - 1),
    row: clamp(Math.floor(u.y / TERR_CELL), 0, TERR_ROWS - 1),
  }));
  return {
    format: WFMaps.FORMAT,
    version: WFMaps.VERSION,
    name: (game.terrain && game.terrain.theme && game.terrain.theme.name) || '自定义地图',
    players: game.players.length,
    grid: { rows: TERR_ROWS, cols: TERR_COLS, cell: TERR_CELL },
    terrain: WFMaps.encodeGrid(game.terrain.grid, TERR_ROWS, TERR_COLS),
    theme: (game.terrain && game.terrain.theme) || { key: 'custom', name: '自定义地图', desc: '' },
    buildings: build,
    units,
  };
}

/* ---------------- 地形编辑器指令 ---------------- */

/** 编辑模式里的建筑寻位：把三类建筑统一成 {list, ref}，增删就不用各写一遍 */
function findBuildRef(game, kind, id) {
  if (kind === 'factory') {
    const f = (game.factories || []).find((x) => x.id === id);
    return f ? { list: game.factories, ref: f } : null;
  }
  if (kind === 'lab') {
    const l = (game.labs || []).find((x) => x.id === id);
    return l ? { list: game.labs, ref: l } : null;
  }
  if (kind === 'hq') {
    const h = (game.hqs || []).find((x) => x.owner === id);
    return h ? { list: game.hqs, ref: h } : null;
  }
  return null;
}

function nextBuildingId(game, kind) {
  if (kind === 'factory') {
    let m = 0;
    for (const f of game.factories || []) if (f.id > m) m = f.id;
    return m + 1;
  }
  if (kind === 'lab') {
    let m = 0;
    for (const l of game.labs || []) if (l.id > m) m = l.id;
    return m + 1;
  }
  return -1;
}

/**
 * 编辑一笔。**只给编辑态用**：限定必须是在 `game.editor` 的房子里，
 * 且返回「有没有真的动到东西」，方便上层决定要不要再广播一次全量状态。
 *
 * @param {object} game
 * @param {object} cmd { op, ... }
 * @returns {boolean} 是否真的改动了东西
 */
function applyEditorCommand(game, cmd) {
  if (!game || !game.editor || game.over) return false;
  const d = cmd || {};
  const op = String(d.op || '');
  const t = game.terrain;
  if (!t || !t.grid) return false;

  // ① 涂抹地形：cells = [[格号, 类型], …]，格号 = row * cols + col
  if (op === 'paint') {
    const cells = Array.isArray(d.cells) ? d.cells : [];
    if (!cells.length) return false;
    const changes = [];
    let dirty = false;
    for (const item of cells) {
      if (!Array.isArray(item)) continue;
      const idx = Math.round(Number(item[0]));
      const val = Math.round(Number(item[1]));
      if (!Number.isFinite(idx) || idx < 0 || idx >= t.rows * t.cols) continue;
      const okVal = val === TT_MOUNTAIN || val === TT_WATER ? val : TT_PLAIN;
      const r = (idx / t.cols) | 0;
      const c = idx % t.cols;
      if (t.grid[r][c] === okVal) continue;
      t.grid[r][c] = okVal;
      changes.push(idx, okVal);
      dirty = true;
    }
    if (!dirty) return false;
    // 地形被改了 → 通行掩码 / 连通分量 / 流场缓存全部作废（见 invalidateNavCache）
    invalidateNavCache(game);
    // ⚠️ 别用 push(...changes)：一次涂几万格就是几万个实参，V8 会直接抛 RangeError。
    const arr = game._terrChanges || (game._terrChanges = []);
    for (let i = 0; i < changes.length; i++) arr.push(changes[i]);
    return true;
  }

  // ② 建筑：增 / 删 / 挪
  if (op === 'building') {
    const kind = String(d.kind || '');
    const col = clamp(Math.round(Number(d.col)), 0, TERR_COLS - 1);
    const row = clamp(Math.round(Number(d.row)), 0, TERR_ROWS - 1);
    if (d.remove) {
      // 总部不许删 —— 没总部的玩家等于开局即出局，这不是地图能表达的状态
      if (kind === 'hq') return false;
      const hit = findBuildRef(game, kind, Math.round(Number(d.id)));
      if (!hit) return false;
      const at = hit.list.indexOf(hit.ref);
      if (at < 0) return false;
      hit.list.splice(at, 1);
      return true;
    }
    const x = (col + 0.5) * TERR_CELL;
    const y = (row + 0.5) * TERR_CELL;
    if (kind === 'hq') {
      const owner = clamp(Math.round(Number(d.owner)), 0, game.players.length - 1);
      const h = (game.hqs || []).find((q) => q.owner === owner);
      if (!h) return false;
      h.x = x;
      h.y = y;
      game.players[owner].baseX = x;
      game.players[owner].baseY = y;
      return true;
    }
    const existing = findBuildRef(game, kind, Math.round(Number(d.id)));
    if (existing) {
      existing.ref.x = x;
      existing.ref.y = y;
      const own = clamp(Math.round(Number(d.owner)), -1, game.players.length - 1);
      existing.ref.owner = own;
      return true;
    }
    const own = clamp(Math.round(Number(d.owner)), -1, game.players.length - 1);
    if (kind === 'factory') {
      const level = clamp(Math.round(Number(d.level) || 1), 1, 3);
      game.factories.push({
        id: nextBuildingId(game, 'factory'),
        x,
        y,
        level,
        owner: own,
        capBy: -1,
        capProg: 0,
        contested: false,
        prodProg: 0,
        lines: 1,
        specs: [makeSlot(TYPE_LIST[0])],
        prog: [0],
        home: false,
        hp: own >= 0 ? FACTORY_HP : Math.round(FACTORY_HP * NEUTRAL_HP_RATIO),
        hpMax: FACTORY_HP,
        lastHitBy: -1,
        evoCd: 0,
        rally: null,
      });
      assignProdTypes(game.factories, game._rng, symOrder(game.players.length));
      return true;
    }
    if (kind === 'lab') {
      game.labs.push({
        id: nextBuildingId(game, 'lab'),
        x,
        y,
        owner: own,
        hp: own >= 0 ? LAB_HP : Math.round(LAB_HP * NEUTRAL_HP_RATIO),
        hpMax: LAB_HP,
        lastHitBy: -1,
        lines: 0,
      });
      return true;
    }
    return false;
  }

  // ③ 单位：增 / 删
  if (op === 'unit') {
    if (d.remove) {
      const id = Math.round(Number(d.id));
      const at = (game.units || []).findIndex((u) => u.id === id);
      if (at < 0) return false;
      game.units.splice(at, 1);
      return true;
    }
    const owner = clamp(Math.round(Number(d.owner)), 0, game.players.length - 1);
    const type = TYPE_LIST.includes(d.type) ? d.type : TYPE_LIST[0];
    const tier = clamp(Math.round(Number(d.tier) || 1), 1, 3);
    const col = clamp(Math.round(Number(d.col)), 0, TERR_COLS - 1);
    const row = clamp(Math.round(Number(d.row)), 0, TERR_ROWS - 1);
    const u = spawnUnit(
      game,
      { id: 0, owner, level: tier },
      type,
      (col + 0.5) * TERR_CELL,
      (row + 0.5) * TERR_CELL,
      { tier, lineIdx: 0 }
    );
    return Boolean(u);
  }

  // ④ 暂停 / 继续
  if (op === 'pause') {
    const want = Boolean(d.on);
    if (game.paused === want) return false;
    setPaused(game, want);
    return true;
  }

  // ⑤ 重新派生高度场（想预览高低差时手动刷一次，写进 terrain.heights）
  if (op === 'recalcHeights') {
    t.heights = buildHeightField(t.grid, symOrder(game.players.length), buildingSites(game));
    t.ramps = t.heights.ramps;
    invalidateNavCache(game); // 崖变了 → 连通分量和流场都得重算
    return true;
  }

  return false;
}

/** 取走并清空「待下发的地形改动」（形如 [格号, 值, …]） */
function takeTerrainChanges(game) {
  const out = game && game._terrChanges;
  if (!out || !out.length) return null;
  game._terrChanges = null;
  return out;
}

function setPaused(game, on) {
  game.paused = Boolean(on);
  if (game.paused) {
    game._pausePhase = game.phase;
    game.phase = 'edit';
    game.phaseEndsAt = 0;
  } else if (game._pausePhase) {
    game.phase = game._pausePhase === 'edit' ? 'playing' : game._pausePhase;
    game._pausePhase = null;
    if (game.phase === 'countdown') game.phaseEndsAt = Date.now() + COUNTDOWN_MS;
    game._lastTick = Date.now();
  }
}

/* ---------------- 战前阶段：房主挑地图 ---------------- */

/**
 * 把「当前这份局面」描述成一份战前信息（名字 / 人数 / 主题 / 规模 / 缩略图）。
 * @param {object} game
 * @param {{ mapFile?: string|null, hostId?: string|null }} [opts]
 */
function briefingView(game, opts) {
  const o = opts || {};
  const t = game.terrain || {};
  const file = o.mapFile || game.mapFile || null;
  const th = t.theme || {};
  return {
    mode: file ? 'file' : 'random',
    file: file || null,
    name: String(o.name || (file ? o.name || '' : th.name || '') || ''),
    // 图自带的人数 vs 房间实际座位数：对不上时缺的总部会随机补（见 applyMapState）
    mapPlayers: Number(o.players) || game.players.length,
    seats: game.players.length,
    theme: { key: String(th.key || ''), name: String(th.name || ''), desc: String(th.desc || '') },
    size: { rows: Number(t.rows) || 0, cols: Number(t.cols) || 0 },
    counts: {
      factories: (game.factories || []).length,
      labs: (game.labs || []).length,
      units: (game.units || []).filter((u) => u && !u.dead).length,
    },
    hostId: o.hostId || null,
    thumb: thumbOfGame(game, 56),
  };
}

/** 把战场上的建筑拼成 maps.thumbOf() 认得的那份（col/row 由像素反算） */
function liveMapLike(game) {
  const t = game.terrain || {};
  const cell = Number(t.cell) || TERR_CELL;
  const buildings = [];
  const push = (kind, b) => {
    buildings.push({
      kind,
      owner: Number(b.owner) | 0,
      col: clamp(Math.floor((Number(b.x) || 0) / cell), 0, (Number(t.cols) || TERR_COLS) - 1),
      row: clamp(Math.floor((Number(b.y) || 0) / cell), 0, (Number(t.rows) || TERR_ROWS) - 1),
    });
  };
  for (const h of game.hqs || []) push('hq', h);
  for (const f of game.factories || []) push('factory', f);
  for (const l of game.labs || []) push('lab', l);
  return {
    grid: { rows: t.rows, cols: t.cols, cell },
    grid2: t.grid,
    buildings,
  };
}

/** 当前局面的缩略图（给战前面板当预览） */
function thumbOfGame(game, maxSide) {
  return WFMaps.thumbOf(liveMapLike(game), maxSide || 56);
}

/**
 * 进战前状态：局面已经建好（随机或按文件摆的），但**一帧都不推进** ——
 * 房主在这时候决定「就用这张」还是「换一张 / 随机一张」，确认后又回到倒计时。
 *
 * 与 setPaused 的区别：那里恢复的是「暂停前的阶段」；战前 explicit 些 ——
 * `_pausePhase` 直接写死 countdown，确认开打时一定重新起一次开局倒计时。
 */
function beginBriefing(game, opts) {
  const o = opts || {};
  game.phase = 'briefing';
  game.phaseEndsAt = 0;
  game.paused = true;
  game._pausePhase = 'countdown';
  if (o.mapFile) game.mapFile = String(o.mapFile);
  game.briefingSeq = (Number(game.briefingSeq) || 0) + 1;
  game.briefing = briefingView(game, {
    mapFile: game.mapFile || null,
    name: o.name || null,
    players: o.players || 0,
    hostId: o.hostId || null,
  });
  return game.briefing;
}

/** 房主拍板：退出战前状态，起倒计时正式开打 */
function endBriefing(game) {
  game.briefing = null;
  game.paused = false;
  game._pausePhase = null;
  game.phase = 'countdown';
  game.phaseEndsAt = Date.now() + COUNTDOWN_MS;
  // 高低差留到地图敲定之后才派生：随便换图没必要每次都重算整张高度场
  if (game.terrain && !game.terrain.heights) {
    game.terrain.heights = buildHeightField(game.terrain.grid, symOrder(game.players.length), buildingSites(game));
    game.terrain.ramps = game.terrain.heights.ramps;
    invalidateNavCache(game);
  }
  game._lastTick = Date.now();
  return true;
}

function createGameState(room) {
  const seats = (room && room.players ? room.players : []).filter(
    (p) => p && !p.left
  );
  const count = Math.max(2, Math.min(4, seats.length));
  const chosen = seats.slice(0, count);
  const rng = makeRng((Date.now() ^ 0x5f356495) >>> 0);
  // 本局布局的整体旋转量：出生轨道、隔离带、研究所共用同一个，
  // 保证研究所落在各家正后方、隔离带正好落在相邻两家的出生区之间。
  // ⚠️ 只能取 π/n 的整数倍，不能整圈随便摇。
  // 地形的对称群是**固定**的 D_N：楔形母图从 0° 起、镜像轴在 k·π/n 上（见 foldToWedge）；
  // 而总部 / 主路 / 隔离带的对称群是「出生角 + k·π/n」。两者只要不重合，同一条折叠轨道
  // 就会被主路盖掉**正好一半**（4 人局 8 个像里 4 个），于是多数表决永远平票、
  // 对称误差就钉在 2%~3% 降不下来（实测 4 人局只挖主路就有 16.5% 的折叠不一致）。
  // 夹到 π/n 上之后两个群完全同一个：主路 / 隔离带 / 建筑清场圈都是整条轨道同开同闭，
  // 平票消失，对称误差回落到 0.1% 以内。代价是布局只剩下「正对边」和「对角」两种朝向 ——
  // 半径、主题、图元位置仍然每局都不同，够用了。
  const spawnRot = Math.floor(rng() * 2 * count) * (Math.PI / count);
  const bands = isolationBands(count, spawnRot);
  // 研究所须等总部定好再摆（门口固定所贴着总部；中场随机所走轨道）
  LABS = [];

  const players = chosen.map((p, i) => ({
    id: p.id,
    name: p.name || '玩家',
    color: COLORS[i % COLORS.length],
    // 出生点要等地形出来才能定（总部是随机落的，得先看地形站不站得住），见下方 pickBasePositions
    baseX: null,
    baseY: null,
    kills: 0,
    losses: 0,
    evolved: 0,
    captured: 0,
    rp: 0, // 科技（研究）点数：只有占领中的研究所会产出
    rpAccMs: 0, // 距下次结算已累积的毫秒数（到 RP_PERIOD_MS 即一次性发放）
    eliminated: false,
    left: false,
  }));

  // 无初始工厂：开局场上全部工厂都是中立的，需要靠打光血量去夺。
  // 具体坐标要等总部定好才能排（工厂要避开各家总部），所以在下面填进这个数组。
  const factories = [];

  // 研究所：初始中立，和工厂一样有血量，打光即由最后一击者接管
  const labs = LABS.map((l, i) => ({
    id: i + 1,
    x: l.x,
    y: l.y,
    owner: -1,
    hp: Math.round(LAB_HP * NEUTRAL_HP_RATIO),
    hpMax: LAB_HP,
    lastHitBy: -1,
    // 第 7/8 项：研究产线（默认 0 条，可开拓多条；每条每周期产出 +labLineRpBonus）
    lines: 0,
  }));

  const game = {
    type: 'warfactory',
    world: { w: WORLD_W, h: WORLD_H },
    consts: {
      factoryR: FACTORY_R,
      // 占位格数（data.js buildings.*Size）：客户端绘制与碰撞都读这个，改一处全跟着变
      factorySize: WFData.buildings.factorySize,
      labSize: WFData.buildings.labSize,
      hqSize: WFData.buildings.hqSize,
      repairRange: REPAIR_RANGE, // 像素：工厂中心 → 维修圈外缘（已含工厂碰撞半径）
      repairHpPerSec: REPAIR_HP_PER_SEC,
      damageForgetMs: DAMAGE_FORGET_MS,
      produceMs: PRODUCE_MS,
      playerUnitCap: PLAYER_UNIT_CAP,
      playerUnitWarn: PLAYER_UNIT_WARN,
      factoryHp: FACTORY_HP,
      neutralHpRatio: NEUTRAL_HP_RATIO,
      facEvolveCd: FAC_EVOLVE_CD,
      labR: LAB_R,
      labHp: LAB_HP,
      hqR: HQ_R,
      hqHp: HQ_HP,
      rpPerLab: RP_PER_LAB,
      rpPeriodMs: RP_PERIOD_MS,
      evolveRpCost: EVOLVE_RP_COST,
      typeList: TYPE_LIST,
      // 格子基准：客户端视觉（单位 / 建筑大小）按它对齐；其余下发的长度都是像素
      grid: { cell: GRID },
      stats: STATS_PX,
      evolved: EVOLVED_PX,
      aggroBonus: 0, // 已废弃（不再有追击圈）：保留字段避免旧客户端读 consts 时取到 undefined
      attackSlack: ATTACK_SLACK,
      /**
       * 寻路掩码对建筑占位的额外外扩（BLOCK_MARGIN）。
       * 客户端要**按同一条公式**画占位圈（occupancy = 碰撞 + navMargin）——
       * 不下发的话客户端只能写死一个数，一旦这边调了，「画出来的能走范围」
       * 和「实际能走范围」又对不上，那正是占位圈要修的病。
       */
      navMargin: BLOCK_MARGIN,
      // 转向速率：车体 / 炮塔都按角速度转（客户端据此做同速率的插值，两端不会打架）
      turn: {
        hull: TURN_HULL,
        turret: TURN_TURRET,
        sizeSlow: TURN_SIZE_SLOW,
        aimTol: TURN_AIM_TOL,
        moveCos: TURN_MOVE_COS,
        moveMin: TURN_MOVE_MIN,
      },
      facLineCost: FAC_LINE_COST,
      facMaxLines: FAC_MAX_LINES,
      // 第 9 项：每条产线的在场名额与减速（客户端面板显示 n/上限 与当前产速）
      lineUnitCap: LINE_UNIT_CAP,
      lineSlowPerUnit: LINE_SLOW_PER_UNIT,
      evolveLineCost: FAC_LINE_EVOLVE_COST, // 单条产线进化一阶的科技点开销
      hqProdType: HQ_PROD_TYPE, // 总部产线默认兵种（且不可进化）
      hqCanEvolve: false, // 总部产线不可进化（客户端据此不出进化按钮）
      prodSpeedCost: PROD_SPEED_COST,
      prodSpeedMax: PROD_SPEED_MAX,
      prodSpeedStep: PROD_SPEED_STEP,
      // 第 7 项：研究所研究产线
      labLineCost: LAB_LINE_COST,
      labMaxLines: LAB_MAX_LINES,
      labLineRpBonus: LAB_LINE_RP_BONUS, // 每条产线每周期额外产出（与基数相加）
      // 第 6 项：总部防卫（客户端据此画射程圈 / 前摇）
      hqAtkRange: HQ_ATK_RANGE,
      hqAtkCd: HQ_ATK_CD,
      hqAtkDmg: HQ_ATK_DMG,
      hqAtkWindupMs: HQ_ATK_WINDUP_MS,
      flameR: FLAME_R,
      flameEdgeMul: FLAME_EDGE_MUL, // 火舌外沿伤害 = 中心 × 它（客户端若要画出衰减可据此调浓淡）
      // 轰击的溅射同样是「中心吃满、外沿只剩这一档」；半径随阶数走，见 stats/evolved 的 splash
      burstEdgeMul: BURST_EDGE_MUL,
      /**
       * 灼烧地形逐阶参数（下标 0/1/2 = 一/二/三级）：[半径, 秒伤, 停喷后寿命ms]；
       * 一级是 null —— 燎原一级只喷火、不留火场，二级起才在地上留火，三级更大更久更疼。
       * 客户端单位面板 / 图例按它显示当前阶数的数值。
       */
      fireTiers: FIRE_TIERS.map((p) => (p ? [p.r, p.dps, p.lifeMs] : null)),
      bulletSplash: BULLET_SPLASH, // 直射弹命中后的爆炸半径（所有非激光子弹都带溅射）
      laserWindupMs: LASER_WINDUP_MS,
      laserRampMs: LASER_RAMP_MS,
      laserMaxMul: LASER_MAX_MUL,
      // 光束观感 = 实际伤害的函数（口径见 laserVisSizeMul / laserVisDetail）：
      // 客户端拿 base / step / 每层倍数 自己算，避免每帧把倍率传回来。
      laserVisBaseDmg: LASER_VIS_BASE_DMG,
      laserVisStepPct: LASER_VIS_STEP_PCT,
      laserVisDetailPer: LASER_VIS_DETAIL_PER,
      laserVisDetailMax: LASER_VIS_DETAIL_MAX,
      colors: COLORS,
    },
    phase: 'countdown',
    phaseEndsAt: Date.now() + COUNTDOWN_MS,
    players,
    factories,
    labs,
    hqs: [], // 总部：地形与随机出生点确定后再填
    units: [],
    bullets: [],
    fires: [], // 灼烧地形（燎原喷出的火场）：[{ id, x, y, r, owner, born, until }]
    events: [],
    over: false,
    winnerId: null,
    seq: 0,
    nextUnitId: 1,
    nextBulletId: 1,
    nextFireId: 1,
    _rng: rng,
    _lastTick: Date.now(),
    _lastStateBroadcast: 0,
  };

  // 生成地形（楔形母图盖规整图元 + 折叠采样出 N 重对称的整图），并清理建筑周围水域
  const seedSalt = Number(room && room.mapSeed) || Date.now();
  const terrainSeed = hashStr(
    (room && room.id ? room.id : 'wf') +
      '|' +
      chosen.map((p) => p.id).join(',') +
      '|' +
      WORLD_W +
      'x' +
      WORLD_H +
      // 战前反复「再随机一张」时要换修饰符：同一个房间同一批人连摇两次，
      // 没有它就会生成出一模一样的地图（makeTerrain 的内部 rng 只认 seed）。
      '|' +
      seedSalt
  );
  // 地貌主题：房间可指定（room.theme = 'ocean' 之类，测试与自定义房用）；
  // 不指定就按「种子 + 开局时刻」加权随机抽一个 —— 每次开局换一种地貌，
  // 连同一房间连开第二局也会换（否则同一批人永远同一张图）。
  // ---- 自定义地图分支 ----
  // 房间选了地图文件（room.wfMap，由 server/rooms.js 读好塞进来）时，
  // 整条随机生成流水线**一步都不跑**：地形、建筑、开局部队统统按文件摆，
  // 随后立刻停在编辑态等着改。放在最前面，是为了让「用地形做铁律的随机流水线」
  // 完全没有机会改用户涂出来的任何一个格子。
  if (room && room.wfMap) {
    applyMapState(game, room.wfMap, { rot: spawnRot });
    game.editor = Boolean(room.editorMode);
    game.editorOwnerId = room.editorOwnerId || (room.players && room.players[0] ? room.players[0].id : null);
    game.pausedAt = 0;
    if (game.editor) {
      setPaused(game, true);
    } else {
      // 不打编辑器的普通开局：地图是死文件、不会被再改，高低差一次算好即可
      game.terrain.heights = buildHeightField(game.terrain.grid, count, buildingSites(game));
      game.terrain.ramps = game.terrain.heights.ramps;
    }
    return game;
  }

  makeTerrain(game, terrainSeed, bands, room && room.theme ? room.theme : null, seedSalt, count);

  // 总部位置：整条 C_N 轨道一次定好（各家等角、等距，看到的地形一模一样），
  // 但要过「避让研究所 + 四周可走 + 两两隔够山脉」三关。
  const bases = pickBasePositions(
    game,
    players.length,
    makeRng((terrainSeed ^ 0x9e3779b9) >>> 0),
    spawnRot
  );
  for (let i = 0; i < players.length; i++) {
    players[i].baseX = bases[i].x;
    players[i].baseY = bases[i].y;
  }
  // 研究所：每家总部旁固定 1 座 + 中场随机再 1 座（C_N 对称）；须先于工厂，方便工厂避让
  LABS = buildLabs(count, rng, bands, bases, game.terrain.grid);
  game.labs.length = 0;
  for (let i = 0; i < LABS.length; i++) {
    const l = LABS[i];
    game.labs.push({
      id: i + 1,
      x: l.x,
      y: l.y,
      owner: -1,
      hp: Math.round(LAB_HP * NEUTRAL_HP_RATIO),
      hpMax: LAB_HP,
      lastHitBy: -1,
      lines: 0,
    });
  }
  // 中立工厂：门口 2 初级 + 中场 2 初级 / 2 中 / 1 高（人均）
  // 选址要**看地形**：别把工厂压进深山，也别骑在主路正中间。详见 siteScore。
  NEUTRAL_FACTORIES = buildNeutralFactories(count, rng, bands, bases, game.terrain.grid);
  let facId = 1;
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
      lines: 1, // 产线数（1..FAC_MAX_LINES）：多条并行生产，产出速率 ×lines
      specs: [], // 每条产线的「兵种 + 出厂阶数 + 分支」，长度恒等于 lines（开局填一条）
      prog: [], // 每条产线各自的生产进度（0..1），长度恒等于 lines
      home: false,
      // 中立工厂只有完整工厂的 1/3 血量，被拿下后恢复满血
      hp: Math.round(FACTORY_HP * NEUTRAL_HP_RATIO),
      hpMax: FACTORY_HP,
      lastHitBy: -1,
      evoCd: 0,
    });
  }
  // 每座工厂开局锁定一种生产单位类型，并初始化集结点
  assignProdTypes(factories, rng, count);

  // 总部：每名玩家一座，开局即归属本人；被打光则「总部陷落」→ 该玩家出局
  game.hqs = players.map((p, i) => ({
    id: i + 1,
    x: p.baseX,
    y: p.baseY,
    owner: i,
    hp: HQ_HP,
    hpMax: HQ_HP,
    down: false,
    evoCd: 0,
    speedLv: 0, // 生产加速等级（0..PROD_SPEED_MAX）：每级把本方生产间隔再缩短 1/15
    // 总部产线：默认一条、默认产锐士、不可进化（与工厂共用同一套产线结构）
    lines: 1,
    specs: [makeSlot(HQ_PROD_TYPE)],
    prog: [0],
    prodProg: 0,
    rally: null, // 第 4 项：总部集结点（右键设置，交互同己方工厂）
    // 第 6 项：总部防卫（射程 200 / 间隔 0.5s / 伤害 20 / 前摇 500ms）
    atkId: 0, // 当前锁定目标 id（0 = 无目标）
    atkKind: 0, // 1 单位 / 2 工厂 / 3 研究所 / 4 总部
    atkFocus: 0, // 玩家右键指定的优先目标 id（0 = 自动索敌）
    atkFocusKind: 0,
    atkWindup: 0, // 前摇结束的绝对时间戳（> now 表示正在蓄能）
    atkCd: 0, // 距离下次可开火的剩余秒数
  }));

  // 出生点周围的山/水一并清成平原，否则开局部队会被地形封死
  clearTerrainAroundBuildings(game, game.terrain.grid);
  // 建筑都在 C_N 轨道上，清场天然对称；这里只按多数表决抹掉栅格化的 ±1 格锯齿
  symmetrizeGrid(game.terrain.grid, count);
  // ---- 中场关口：两家之间横着一道大山 / 大湖（详见 gateRects）----
  // 放在「清场之后、挖主路之前」：随后 carveMainRoads 会把正面那条路从关口里挖穿，
  // 挖出来的就是那条穿山峡谷；关口自己则把连线其余部分彻底堵死。
  // 建筑清场圈要豁免（skip）：万一有工厂压在关口上，它的出兵环不能被埋掉。
  const gateType = gateTypeOf(game._mapGen.theme);
  const gateK = gateSizeK(game._mapGen.theme); // 稀疏主题的关口按比例缩小（见 gateSizeK）
  const gateMask = gateMaskOf(game.hqs, count, gateK); // 隔离带 / 补地形都要照着它豁免
  game._mapGen.gateMask = gateMask;
  // 临时诊断（WFREG=1 打开）：打印各阶段的「宽通道片数」，用来定位连通性是在哪一步散掉的
  const regLog = (tag) => {
    if (!process.env.WFREG) return;
    const cnt = wideRegions(wideMask(game.terrain.grid)).length;
    console.log(`  [reg] ${tag}: ${cnt} 片（${count} 人 / ${game._mapGen.theme.key}）`);
  };
  /**
   * 清碎块 ↔ 连通开道 交替进行，**收手的判据永远是「清完碎块之后仍是一整片」**。
   *
   * ⚠️ 顺序要命：必须在**清完碎块之后**再判一次连通。清碎块把某块小地形抹成平原 →
   * 旁边那条 1 格宽的死缝被撑成 2 格宽 → 凭空冒出一片新的孤立宽通道（实测一次多 4~9 片）。
   * 早先把 busy 放在清碎块**之前**取（清出孤岛的那一轮恰好被判成「没事」），这批孤岛就
   * 被留在了图上 —— 「宽通道应当连成一整片（实到 5 片）」就是这么来的：
   * 日志里明明「最终修补#1 → 1 片」，出去时已经是 3 片。
   *
   * @returns {boolean} 收手时是不是真的连成了一整片
   */
  const repairWide = (maxGuard) => {
    for (let guard = 0; guard < maxGuard; guard++) {
      const snapT = game.terrain.grid.map((row) => row.slice());
      if (clearTinyBlobs(game.terrain.grid, MIN_BLOB_CELLS)) {
        symmetrizeGrid(game.terrain.grid, count, snapT, 'union');
      }
      if (wideRegions(wideMask(game.terrain.grid)).length <= 1) return true;
      const snapH = game.terrain.grid.map((row) => row.slice());
      ensureOpenTerrain(game.terrain.grid, terrainAnchors(game));
      symmetrizeGrid(game.terrain.grid, count, snapH, 'union');
    }
    return wideRegions(wideMask(game.terrain.grid)).length <= 1;
  };
  /** 只管连通的开道兜底：不再动地形，补到真的连成一片为止 */
  const repairConnect = (maxGuard) => {
    for (let guard = 0; guard < maxGuard; guard++) {
      if (wideRegions(wideMask(game.terrain.grid)).length <= 1) return true;
      const snapE = game.terrain.grid.map((row) => row.slice());
      ensureOpenTerrain(game.terrain.grid, terrainAnchors(game));
      symmetrizeGrid(game.terrain.grid, count, snapE, 'union');
    }
    return wideRegions(wideMask(game.terrain.grid)).length <= 1;
  };
  const clearMaskOf = (gm) => {
    const mk = [];
    for (let r = 0; r < TERR_ROWS; r++) mk[r] = new Uint8Array(TERR_COLS);
    const mark = (bx, by) => {
      if (!Number.isFinite(bx) || !Number.isFinite(by)) return;
      const cc = Math.floor(bx / TERR_CELL);
      const cr = Math.floor(by / TERR_CELL);
      for (let r = cr - TERRAIN_CLEAR_CELLS; r <= cr + TERRAIN_CLEAR_CELLS; r++) {
        if (r < 0 || r >= TERR_ROWS) continue;
        for (let c = cc - TERRAIN_CLEAR_CELLS; c <= cc + TERRAIN_CLEAR_CELLS; c++) {
          if (c >= 0 && c < TERR_COLS) mk[r][c] = 1;
        }
      }
    };
    for (const f of gm.factories || []) mark(f.x, f.y);
    for (const l of gm.labs || []) mark(l.x, l.y);
    for (const h of gm.hqs || []) mark(h.x, h.y);
    return mk;
  };
  const clearMask = clearMaskOf(game);
  stampGates(game.terrain.grid, game.hqs, count, gateType, clearMask, gateK);
  // 进攻主路：每一对环上相邻的玩家之间挖 ROAD_PER_PAIR 条 ≥15 格宽的大道（上 / 中 / 下），
  // 保证永远不会只剩一条独木桥。放在清场之后（否则会被出生区清场覆盖），
  // 连通性兜底之前（ensureOpenTerrain 只会再开通道，不会把路填回去）。
  // 每条道都是同一条基准路的旋转像 → 主路本身已经是 N 重对称的，
  // 这里**不做并集传播**：主路很宽，一旦按「折叠到楔形同一格」把开口往外传，
  // 路扫到的每一格都会把它在 N 个方向上的孪生地形一起抹掉 —— 地形就是这么被吃光的。
  // 只走一遍多数表决，把 120° 旋转（3 人局）带来的栅格锯齿抹平。
  game.mainRoads = carveMainRoads(game.terrain.grid, game.hqs, count);
  symmetrizeGrid(game.terrain.grid, count);
  // 地形**补回来**：只补在路的走廊以外。
  // 分两步、共用主题的 maxBlocked 这一份额度，**中心优先**：
  //   ① topUpCore —— 先给中场 / 中心补（详见 topUpCore）。中间是双方争夺的主战场，
  //      而按面积均匀撒点时绝大部分图元落在外圈，中间永远是空的；
  //   ② topUpTerrain —— 再按全图总量补（详见 topUpTerrain）。
  //   顺序反过来的话，额度会先被面积更大的外圈吃光，中间又补不上了。
  // 补完地形等于把整张图按楔形重画了一遍 —— 之前挖的清场圈 / 隔离带 / 主路都要再挖一遍，
  // 好在它们都只是「把某片区域压平」，重复执行是幂等的，而且很便宜。
  // 补完地形等于把整张图按楔形重画了一遍 —— 之前挖的清场圈 / 隔离带 / 主路都要再挖一遍，
  // 好在它们都只是「把某片区域压平」，重复执行是幂等的，而且很便宜。
  // 主路走廊掩膜（把路挖在一张「整片山地」的图上，被挖平的就是路）—— 重挖之后做对称
  // 传播时要拿它把口子限定在走廊内（见 symmetrizeGrid 的 only 参数）。路网全程不变，算一次即可。
  const roadPlainOf = (gm, ord) => {
    const gen = gm._mapGen;
    // 每局都按「同一份几何」重算（见 roadPlainFor），缓存只是为了省那几百毫秒
    if (gen.roadPlain) return gen.roadPlain;
    const mk = roadPlainFor(gm.hqs, ord);
    gen.roadPlain = mk;
    return mk;
  };
  const recarve = () => {
    // 重挖是在**世界坐标**里逐格判定的（隔离带的角度、主路的圆形刷子），
    // 栅格化之后各个 D_N 像难免差一格 —— 实测这一步能留下 8% 的不对称。
    // 补完地形的整张图是「楔形采样」、本来就严格对称，所以只要把这三步**新挖开的**
    // 格子并集传播到对称副本上，就还是严格对称。
    // **不能**用多数表决：那会把「主路分隔带」整组开掉（分隔带只有 gapCells 宽，
    // 同组里路面占多数），中场又被抹平 —— 并集只传播新挖的口子，不碰别的轨道。
    const beforeRecarve = game.terrain.grid.map((row) => row.slice());
    clearTerrainAroundBuildings(game, game.terrain.grid);
    // 隔离带豁免关口：关口正好压在「两家之间」的角平分线上，不豁免就被劈成两半
    carveIsolationBands(game.terrain.grid, bands, gateMask);
    // 关口每挖一次路就要重新钉一次：补地形会盖在它上面，清碎块 / 连通开道也会啃它
    stampGates(game.terrain.grid, game.hqs, count, gateType, clearMask, gateK);
    game.mainRoads = carveMainRoads(game.terrain.grid, game.hqs, count);
    symmetrizeGrid(game.terrain.grid, count, beforeRecarve, 'union');
  };
  // 收尾钉关口时要绕开的地方 = 建筑清场圈 ∪ 主路走廊（后者的那条峡谷是设计好的通路）
  let gateSkipCache;
  const gateSkip = () => {
    if (gateSkipCache) return gateSkipCache;
    const road = roadPlainOf(game, count);
    const mk = [];
    for (let r = 0; r < TERR_ROWS; r++) {
      mk[r] = new Uint8Array(TERR_COLS);
      for (let c = 0; c < TERR_COLS; c++) mk[r][c] = clearMask[r][c] || road[r][c] ? 1 : 0;
    }
    gateSkipCache = mk;
    return mk;
  };
  // 补地形时的禁笔掩膜 = 调用方给的 extra ∪ 关口。
  // 关口是钉死的地形，补地形盖在它上面纯属浪费额度 —— 随后那一刀重画会把它盖回去。
  let extraCache;
  const extraWith = (extra) => {
    const key = extra || 0;
    if (extraCache && extraCache.key === key) return extraCache.mask;
    const mk = [];
    for (let r = 0; r < TERR_ROWS; r++) {
      mk[r] = new Uint8Array(TERR_COLS);
      for (let c = 0; c < TERR_COLS; c++) mk[r][c] = gateMask[r][c] || (extra && extra[r] && extra[r][c]) ? 1 : 0;
    }
    extraCache = { key, mask: mk };
    return mk;
  };
  // 补地形的落笔白名单：只画走廊以外（详见 wedgeOkOutsideCorridor）。路网全程不变，算一次即可。
  const okCache = new Map();
  /**
   * 补地形的落笔白名单（按工厂禁笔半径缓存）。
   * keepR 默认 8 = 选址时的采样半径：那一圈是 siteScore 打分的依据，补地形再埋进去就等于
   * 把分白打了（详见 factoryKeepMask）。
   * ⚠️ 中心圈兜底（rescueCore）要用**更小**的半径：工厂禁笔是按「每座厂」铺的，中心圈虽大
   * 但可能正好压着内圈那几座厂，禁笔一铺开中心就补不进去了（实测 2 人局中心密度掉到
   * 全图的 0.36 倍，低于 0.45 的下限）。中心圈每轮只补 ≤1.5% 图幅，放宽一点代价很小。
   */
  const okOutside = (keepR) => {
    const kr = keepR == null ? 8 : keepR;
    if (!okCache.has(kr)) {
      const ord = symOrder(count);
      const keep = factoryKeepMask(game, kr);
      okCache.set(kr, wedgeOkOutsideCorridor(ord, wedgeDims(ord), roadPlainOf(game, count), keep) || null);
    }
    return okCache.get(kr);
  };
  // 中心圈兜底：topUpLoop 是「贴住全图预设就收手」，而全图达标**不等于**中场达标 ——
  // 图元按面积均匀撒点时绝大部分落在外圈，中心圈分到的那一点还会被走廊再削一刀，
  // 实测 4 人裂谷中心圈密度只剩全图的 0.06 倍（8860 格可用面积里只有 280 格地形）。
  // 这里专补中心，目标是「中心圈的密度追平全图」（这正是「中场不该是空地」的判据），
  // 而不是 core.fill 那种「把圈填死」—— 后者会让全图冲过预设（实测裂谷山 29.5% / 预设 22%）。
  const rescueCore = (maxPass) => {
    const ok = okOutside(3); // 中心圈用很小的工厂禁笔半径（理由见 okOutside）
    const th = game._mapGen && game._mapGen.theme;
    const mixSum = th && th.mix ? clamp(th.mix.mountain + th.mix.water, 0.05, 0.5) : 0.2;
    const TOTCELLS = TERR_ROWS * TERR_COLS;
    for (let pass = 0; pass < maxPass; pass++) {
      const cs = coreCircleStats(game, count);
      if (!cs || !cs.free) return;
      // ⚠️ **全图刹车**：这一层每轮能补 1.5% 图幅、最多 6 轮 = 9 个百分点，而它只认
      // 「圈内密度」、不看全图总量 —— 锚点图元大的主题（汪洋正中那片 9~11 个点的内海）
      // 生成阶段就已经贴着 maxBlocked 了，再被这里补一刀直接冲到 46.9%（上限 39%）。
      // 全图地形的**总量**由 mix 说了算（它就是「这个主题该有多少地形」），超了就停。
      const worldNow = worldMixCount(game.terrain.grid);
      if ((worldNow.m + worldNow.w) / TOTCELLS >= mixSum) {
        if (process.env.WFDBG) console.log(`     [rescue] 第 ${pass + 1} 轮放弃：全图地形已达 ${(((worldNow.m + worldNow.w) / TOTCELLS) * 100).toFixed(1)}% ≥ 预设 ${(mixSum * 100).toFixed(1)}%`);
        return;
      }
      // 只数「圈里真正能落笔的地方」：中心圈是全图最拥挤的地方（4 人局实测近一半是
      // 主路 / 隔离带），拿整圈面积当分母会得到永远补不满的目标、白白多跑几轮。
      let freeOk = 0;
      let blockedOk = 0;
      for (const i of cs.idx) {
        if (ok && !ok[i]) continue;
        freeOk += cs.wt[i];
        if (cs.wedge[(i / cs.dim.cols) | 0][i % cs.dim.cols] !== TT_PLAIN) blockedOk += cs.wt[i];
      }
      if (!freeOk) return;
      // 中心圈密度已经追平全图就收手 —— 剩下的交给容差，别把全图顶过预设
      if (blockedOk / freeOk >= mixSum) return;
      const need = Math.max(0, freeOk * Math.min(cs.fill, mixSum) - blockedOk);
      if (need <= cs.total * 0.004) return;
      if (process.env.WFDBG) {
        console.log(
          `     [rescue] 第 ${pass + 1} 轮：圈内密度 ${((blockedOk / freeOk) * 100).toFixed(1)}% / 目标 ${(mixSum * 100).toFixed(0)}%，还差 ${((need / cs.total) * 100).toFixed(1)}% 图幅`
        );
      }
      // lossK = 1：**不放大**额度（这里补的是「额外的中心地形」，不是走廊损耗），
      // 于是上限就是 maxBlocked 本身，绝不会把全图顶过主题上限。
      // fit：把长墙截成「塞得进中心圈」的长度（见 topUpCore）—— 贯穿全图的长墙
      // 大半落在圈外，拿它填中心等于白盖，还会因为「落笔不足预估 55%」被整块撤销。
      if (!topUpCore(game, count, extraWith(null), 1, ok, Math.min(need, cs.total * 0.015), Math.max(0.12, cs.rK * 0.9))) {
        if (process.env.WFDBG) console.log(`     [rescue] 第 ${pass + 1} 轮放弃：圈内放不下任何图元`);
        return;
      }
      recarve();
    }
  };
  /**
   * 中心圈保底（最后一刀）：不再挑图元，直接**按格子移植** —— 往圈里的空地堆圆盘，
   * 再从圈外把同样多的地形削回去。
   *
   * 为什么非得有这一刀：rescueCore 只能用主题自带的图元去盖，而裂谷那种「清一色贯穿
   * 全图的超长竖墙」的主题，图元一大半压在主路走廊上，三次挑位都不过关、整块被撤销 ——
   * 实测 4 人裂谷连补 10 轮，圈内地形纹丝不动地停在 1.8%，10 局里有 5 局中心密度不足
   * 全图的 0.4 倍（最低 0.06）：中心那堵合格的墙有时被 `clampShapes` 连同超额部分整块
   * 撤掉，有时稳稳留下，于是成了「一半孤儿一半绿洲」的双峰分布。
   *
   * 这一刀绕开图元，所以一定能施工：
   *   · 加：只在圈内「可落笔」（走廊以外、不压工厂周边）的空地上盖圆盘 —— 半径按圈
   *     半径取，必然 ≥ MIN_BLOB_CELLS 格，不会变成 clearTinyBlobs 要扫的碎屑；
   *   · 减：多出来的量从**圈外**按「先啃边缘」的顺序削掉（每轮只削有平原邻居的格子，
   *     于是大块地形是慢慢缩水而不是被打成筛子），且不动关口（banned）；
   *   · 总量不变 ⇒ 主题的 mix 占比不受影响，变的只是「地形在圈内还是圈外」——
   *     而「中场不该是空地」要的正是这个。
   */
  const rescueCoreFill = (rounds) => {
    const th = game._mapGen && game._mapGen.theme;
    if (!th || !th.mix) return;
    const ord = symOrder(count);
    const dim = wedgeDims(ord);
    const { used, wt, total } = wedgeWeights(ord, dim);
    const ok = okOutside(); // 选址采样那一整圈（半径 8）都不许埋 —— 见 factoryKeepMask
    const banned = bannedWedgeCells(game, ord, dim, extraWith(null));
    const coreR = clamp(Number((th.core || CORE_FALLBACK).r), 0.05, 1) * Math.min(WORLD_W, WORLD_H) / 2;
    const type = th.mix.mountain >= th.mix.water ? TT_MOUNTAIN : TT_WATER;
    const mixSum = clamp(th.mix.mountain + th.mix.water, 0.05, 0.5);
    const rng = game._mapGen.rng;
    const rad = Math.max(5, Math.round((coreR / TERR_CELL) * 0.16));
    for (let round = 0; round < rounds; round++) {
      const wedge = wedgeFromWorld(game.terrain.grid, ord, dim);
      const nb = (i, dr, dc) => {
        const r = ((i / dim.cols) | 0) + dr;
        const c = (i % dim.cols) + dc;
        if (r < 0 || c < 0 || r >= dim.rows || c >= dim.cols) return null;
        return wedge[r][c];
      };
      const inCore = new Uint8Array(dim.rows * dim.cols);
      let inFree = 0;
      let inB = 0;
      let outFree = 0;
      let outB = 0;
      const seeds = [];
      for (const i of used) {
        const c = i % dim.cols;
        const r = (i / dim.cols) | 0;
        const core = Math.hypot((c + 0.5) * TERR_CELL, (r + 0.5) * TERR_CELL) <= coreR;
        if (core) inCore[i] = 1;
        if (ok && !ok[i]) continue;
        const v = wedge[r][c];
        if (core) {
          inFree += wt[i];
          if (v) inB += wt[i];
          else if (banned[i] !== 1) seeds.push(i);
        } else {
          outFree += wt[i];
          if (v) outB += wt[i];
        }
      }
      if (!inFree || !outFree) return;
      const outD = outB / outFree;
      // 目标：圈内密度追到圈外密度的 6 成（「中场不该是空地」的门槛是 4 成半，
      // 留一成余量给收尾的连通 / 清碎块那一刀），封顶在主题自己的份额上。
      const goal = Math.min(mixSum + 0.1, outD * 0.6);
      const cur = inB / inFree;
      const need = (goal - cur) * inFree;
      if (!(need > total * 0.002)) return;
      let added = 0;
      let painted = false;
      for (let guard = 0; guard < 400 && added < need && seeds.length; guard++) {
        const s = seeds[Math.floor(rng() * seeds.length)];
        const sr = (s / dim.cols) | 0;
        const sc = s % dim.cols;
        for (let dr = -rad; dr <= rad; dr++) {
          for (let dc = -rad; dc <= rad; dc++) {
            if (dr * dr + dc * dc > rad * rad) continue;
            const r = sr + dr;
            const c = sc + dc;
            if (r < 0 || c < 0 || r >= dim.rows || c >= dim.cols) continue;
            const i = r * dim.cols + c;
            if (!inCore[i] || wedge[r][c] !== TT_PLAIN) continue;
            if (ok && !ok[i]) continue;
            if (banned[i] === 1) continue;
            wedge[r][c] = type;
            added += wt[i];
            painted = true;
          }
        }
        // 这一块已经被填过或有平台缝，把它从候选里踢掉，别反复空转
        seeds.splice(seeds.indexOf(s), 1);
      }
      if (!painted) return;
      // ---- 从圈外按「先啃边缘」的顺序削回同样多 ----
      let cut = 0;
      for (let pass = 0; pass < 6 && cut < added; pass++) {
        for (const i of used) {
          if (cut >= added) break;
          if (inCore[i]) continue;
          const r = (i / dim.cols) | 0;
          const c = i % dim.cols;
          if (wedge[r][c] !== type) continue;
          if (banned[i] === 1) continue;
          if (ok && !ok[i]) continue;
          // 只有「贴着平原」的那层才削：一轮轮往里啃，大块地形只是缩水、不会打成筛子
          const p = (nb(i, -1, 0) === TT_PLAIN) || (nb(i, 1, 0) === TT_PLAIN) ||
            (nb(i, 0, -1) === TT_PLAIN) || (nb(i, 0, 1) === TT_PLAIN);
          if (!p) continue;
          wedge[r][c] = TT_PLAIN;
          cut += wt[i];
        }
      }
      if (process.env.WFDBG) {
        console.log(
          `     [coreFill] 第 ${round + 1} 轮：圈内 ${((cur) * 100).toFixed(1)}% → 目标 ${((goal) * 100).toFixed(1)}%，` +
            `移植 ${((added / total) * 100).toFixed(2)}% 图幅，圈外削回 ${((cut / total) * 100).toFixed(2)}%`
        );
      }
      game.terrain.grid = renderWorldFromWedge(wedge, ord, dim);
      recarve();
    }
  };
  // 补地形 ↔ 重挖走廊 **交替着来**：补的地形有一部分会盖在走廊上、随即被重挖掉，
  // 而走廊能占到半张图（12 条主路 + 隔离带 + 建筑清场圈），这一刀砍掉多少事先算不准 ——
  // 拍一个固定倍率（原先的做法）实测差 8 个百分点。改成**按上一轮实测的存活率**换算额度，
  // 来回几轮就贴住主题的预设占比（实测 3 轮内从「差 8 点」收到「差 1 点」）。
  // okOverride：楔形层面的落笔白名单（concentrateTerrain 用它把补地形**锁在战局内**）。
  // 不传就用 okOutside()（走廊以外 + 工厂禁笔圈）。
  const topUpLoop = (maxPass, extra, okOverride) => {
    const th = game._mapGen && game._mapGen.theme;
    if (!th || !th.mix) return;
    const tot = TERR_ROWS * TERR_COLS;
    let overshoot = 0;
    for (let pass = 0; pass < maxPass; pass++) {
      const now = worldMixCount(game.terrain.grid);
      if (now.m / tot >= th.mix.mountain * TOP_UP_CLEAN_K - 0.004 && now.w / tot >= th.mix.water * TOP_UP_CLEAN_K - 0.004) {
        break;
      }
      // 额度倍率 = 1 / 实测存活率；越接近预设越收着补 —— 末轮照样按满倍率盖的话，
      // 2 人局（走廊只占 15%）会一口气冲过预设三成（实测棋盘街区 40% / 预设 30%）。
      const near = clamp((now.m + now.w) / Math.max(1, tot * (th.mix.mountain + th.mix.water)), 0, 1);
      const kRaw = game._mapGen.retention > 0.1 ? 1 / clamp(game._mapGen.retention, 0.12, 1) : 0;
      const k = kRaw > 0 ? Math.max(1, 1 + (kRaw - 1) * (1 - near * 0.8)) : 0;
      const snapBack = game.terrain.grid.map((row) => row.slice());
      // **分类型**算偏差，不能只比「山 + 水」的合计：合计口径下「山多 3 个点、水少 3 个点」
      // 的偏差是 0 —— 于是山整块超额的那几轮全被当成「更接近预设」而采纳，
      // 实测超级平原的山就这么顶到 9.2%（预设 5%）。
      const distOf = (c) =>
        Math.abs(c.m - tot * th.mix.mountain) + Math.abs(c.w - tot * th.mix.water);
      const ex = extraWith(extra);
      const okUse = okOverride || okOutside();
      const a = topUpCore(game, count, ex, k, okUse);
      const b = topUpTerrain(game, count, ex, k, okUse);
      if (!a && !b) break;
      const pre = game._mapGen.wedgeMix; // 重挖之前的量
      recarve();
      const after = worldMixCount(game.terrain.grid);
      const add = pre.m - now.m + (pre.w - now.w); // 这一轮盖了多少（重挖前）
      const got = after.m - now.m + (after.w - now.w); // 活下来多少（重挖后）
      if (add > 0.002) game._mapGen.retention = clamp(got / add, 0.12, 1);
      // 只采纳**离预设更近**的那一轮：走廊占比是估出来的，末轮常常一口气盖过头
      // （实测 2 人局 43% / 预设 30%）。盖过头就退回这一轮之前，下一轮倍率会自动收窄。
      // 退回之后**不收手**：把倍率压回 1（下一轮只补缺口本身）再试一次；
      // 连续两次都盖过头才认输 —— 说明剩下的空地确实填不动了。
      if (distOf(after) > distOf(now)) {
        game.terrain.grid = snapBack;
        game._mapGen.retention = 1;
        if (++overshoot >= 2) break;
        continue;
      }
      overshoot = 0;
    }
  };
  topUpLoop(10);
  // 连通性保证：撑宽所有 1 格宽的窄缝，并给每个与外界隔绝的区域开一条 2 格宽走廊，
  // 保证没有任何工厂 / 研究所 / 总部会被山或水包死（通道宽度恒 ≥2 格）。
  // 与「对称传播」交替进行：传播会在山的另一头挖出一小块与外界不通的空地（新的碎区），
  // 所以补完对称要再兜一次连通性，直到传播不再新增开口为止（一般 1~2 轮就收敛）。
  // 循环次数给到 8：补完地形之后要开的走廊变多了，4 轮偶尔会在「传播又挖出新的碎区」
  // 这一步上用尽 —— 循环用尽时最后那次传播挖出的碎区就没人再兜，会留下走不出去的死地。
  const beforeConn = game.terrain.grid.map((row) => row.slice());
  for (let guard = 0; guard < 8; guard++) {
    const snap = game.terrain.grid.map((row) => row.slice());
    ensureOpenTerrain(game.terrain.grid, terrainAnchors(game));
    // 只把「这一步新挖开的通道」**并集传播**到它的对称副本上：某家被山包死时开的走廊，
    // 所有对称位置都得有一条，否则公平性就没了。这里必须是并集（开口只增不减），
    // 也正因如此它只能用在「连通性开道」这种小范围开口上。
    if (!symmetrizeGrid(game.terrain.grid, count, snap, 'union')) break;
  }
  // 收尾再兜一次连通性：上面的循环可能在「传播 → 新碎区」的最后一轮上退出，
  // 那时新碎区还没补过连通。这一步开的通道未必对称，但只在极少数局里真的会开，
  // 且开口很小 —— 「走不出去的死地」比「某个方向上多了几格通道」严重得多。
  ensureOpenTerrain(game.terrain.grid, terrainAnchors(game));
  // 连通性这一刀砍掉的量**补回来**：实测 3 人局能从 36.5% 削到 29.1%（7 个百分点） ——
  // 撑宽窄缝、给隔绝区开走廊、并集传播，全是把地形挖成平原，主题的预设占比就对不上了。
  // 做法是再补一次，并把「这一轮刚挖开的格子」也列为禁笔（carveMask）：
  // 否则刚开的走廊又被填回去，下一轮连通再挖一次，来回拉锯永远收敛不了。
  const carveMask = [];
  let carved = 0;
  for (let r = 0; r < TERR_ROWS; r++) {
    carveMask[r] = new Uint8Array(TERR_COLS);
    for (let c = 0; c < TERR_COLS; c++) {
      if (beforeConn[r][c] !== TT_PLAIN && game.terrain.grid[r][c] === TT_PLAIN) {
        carveMask[r][c] = 1;
        carved++;
      }
    }
  }
  if (carved) {
    topUpLoop(10, carveMask);
    // 重挖是在**世界坐标**里逐格判定的（隔离带的角度、主路的圆形刷子），
    // 栅格化之后各个 D_N 像难免差一格 —— 实测这一步会留下 4% 的不对称。
    // 所以补完地形要再对齐一次（多数表决）。早先这里刻意不表决：那时中场唯一的
    // 遮挡物是主路分隔带（只有 gapCells 宽），一表决就被整组抹平；现在中场的地形
    // 是 topUpCore 盖的大图元（几十格一块，组内多数仍是地形），抹不掉了。
    symmetrizeGrid(game.terrain.grid, count);
  }
  // 连通性开道会顺手把中心圈的地形再削一刀（它是全图最拥挤的地方），
  // 所以中心圈兜底放在**连通之后**：补完下面的连通 / 对称收尾还会再兜一遍。
  rescueCore(6);
  rescueCoreFill(4);
  /**
   * 地形「参与度」：把**战局外**的地形搬到**战局内**。
   *
   * 为什么要有这一刀：实测（scripts/wf-idle-tmp.js，口径见 data.js 的 relevance 段）
   * 地形里有相当一部分是**无效地形** —— 够不着任何争夺点、也不在主路两侧：
   *   2 人局的战局外空地图幅有 55% 上下，而**地形总量的 34%~65% 就躺在那片没人去的地方**；
   *   3 / 4 人局也有 1%~26%。这些山山水水既不挡路也不遮掩，玩家一辈子不会为它们做一个决策，
   *   却照样吃掉主题的地形预算（mix 是按全图算的，等于一半的预算白花在背景板上了）。
   *
   * 做法不是删掉（删了主题的水量 / 山量就不够预设了），而是**等量搬迁**：
   *   ① 先定义「战局」= 离任一争夺点（总部 / 工厂 / 研究所）≤ buildingPadCells，
   *      或离主路 ≤ roadPadCells（主路两侧正是打伏击的地方）；
   *   ② 量出每格**超出战局边界多远**（偏僻深度 exc），先搬最偏僻的那一批 —— 切在距离场的
   *      等值面上，切口天然平滑，不会像「东抠一格西抠一格」那样产出毛刺；
   *   ③ 再用主题自己的图元，在战局内的空地上把这块地形补回来（**锁在战局内**）。
   * 于是山还是那么多山、水还是那么多水，但都长在玩家真的会经过 / 会抢的地方。
   *
   * ⚠️ 别改成「整块搬」：最早的版本只搬**整块都够不着战局**的地形（保持块状），实测这个
   * 池子平均只占地形 8.4%（3/4 人局大量是 0%）—— 大山大湖总有一角蹭到主路或建筑，于是整块
   * 都搬不动，搬完「战局外密度 / 战局内密度」仍是 0.93（等于完全没搬）。
   *
   * 三条硬指标照旧不破：
   *   · 关口（gateMask）整块跳过 —— 那是「总部之间不许直达」的唯一依靠；
   *   · 补地形走既有白名单（不压走廊、不压工厂禁笔圈 REL_KEEP_PAD）→ 不堵路、不埋工厂；
   *   · 战局内的空地最多填到 fillMax，全图最多搬走 moveCap —— 别把能走的地方填死。
   * 万一战局内塞不下（图元挑位失败），退回全图补一次，宁可地形长回老地方，也不能让总量塌下去。
   */
  const concentrateTerrain = () => {
    const TOT = TERR_ROWS * TERR_COLS;
    const th = game._mapGen && game._mapGen.theme;
    if (!th || !th.mix) return 0;
    const dbg = process.env.WFDBG;
    const ord = symOrder(count);
    const map = wedgeMap(ord);
    const K = map.dim.rows * map.dim.cols;
    // ⚠️ 别把 grid 当成恒定引用：topUpCore / topUpTerrain 会 `game.terrain.grid = ...`
    // **换一个新数组**出来（它们是从楔形母图整体重渲染的），缓存下来就成了孤儿 ——
    // 后面几轮的写入全落在旧数组上，等于白搬。每轮开头重新取一次。
    let grid = game.terrain.grid;

    // ① 战局距离场：dB = 到最近争夺点（总部 / 工厂 / 研究所），dR = 到最近主路。
    //    多源 BFS（8 邻域），8 万格跑两遍，几毫秒的事；建筑与路网全程不变，各算一次即可。
    const distField = (seeds) => {
      const INF = 1e9;
      const d = new Float32Array(TOT).fill(INF);
      const q = [];
      for (const id of seeds) {
        if (d[id] === 0) continue;
        d[id] = 0;
        q.push(id);
      }
      for (let head = 0; head < q.length; head++) {
        const id = q[head];
        const r = (id / TERR_COLS) | 0;
        const c = id % TERR_COLS;
        const dd = d[id] + 1;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= TERR_ROWS || nc < 0 || nc >= TERR_COLS) continue;
            const nid = nr * TERR_COLS + nc;
            if (d[nid] <= dd) continue;
            d[nid] = dd;
            q.push(nid);
          }
        }
      }
      return d;
    };
    const hot = [];
    const pushAt = (x, y) => {
      const c = Math.floor(x / TERR_CELL);
      const r = Math.floor(y / TERR_CELL);
      if (r < 0 || r >= TERR_ROWS || c < 0 || c >= TERR_COLS) return;
      hot.push(r * TERR_COLS + c);
    };
    for (const h of game.hqs || []) pushAt(h.x, h.y);
    for (const f of game.factories || []) pushAt(f.x, f.y);
    for (const l of game.labs || []) pushAt(l.x, l.y);
    if (!hot.length) return 0;
    const dB = distField(hot);
    const road = roadPlainOf(game, count);
    const roadSeeds = [];
    for (let r = 0; r < TERR_ROWS; r++) for (let c = 0; c < TERR_COLS; c++) if (road[r][c]) roadSeeds.push(r * TERR_COLS + c);
    const dR = roadSeeds.length ? distField(roadSeeds) : null;
    const inZone = (id) => dB[id] <= REL_BUILDING_PAD || (dR && dR[id] <= REL_ROAD_PAD);

    // ② 战局内「还能落笔」的楔形白名单：整条 D_N 轨道的每个成员都在战局内，
    //    且不压走廊 / 不压工厂禁笔圈（整条轨道一起判 → 补出来的地形天然严格对称）。
    const keep = factoryKeepMask(game, REL_KEEP_PAD);
    const okW = wedgeOkOutsideCorridor(ord, map.dim, road, keep);
    const hotW = new Uint8Array(K);
    let hotWn = 0;
    for (let k = 0; k < K; k++) {
      const a = map.gStart[k];
      const b = map.gStart[k + 1];
      if (b <= a) continue;
      let allIn = 1;
      for (let j = a; j < b; j++) {
        if (!inZone(map.gCells[j])) {
          allIn = 0;
          break;
        }
      }
      if (!allIn) continue;
      if (okW && !okW[k]) continue;
      hotW[k] = 1;
      hotWn++;
    }
    // 战局内几乎没地方落笔（极少见）→ 这一刀白做，直接收手，别把地形搬空了补不回来
    if (hotWn < K * 0.04) return 0;
    const hotFreeNow = () => {
      const g = game.terrain.grid;
      let f = 0;
      for (let k = 0; k < K; k++) {
        if (!hotW[k]) continue;
        for (let j = map.gStart[k], e = map.gStart[k + 1]; j < e; j++) {
          const id = map.gCells[j];
          if (g[(id / TERR_COLS) | 0][id % TERR_COLS] === TT_PLAIN) f++;
        }
      }
      return f;
    };

    /**
     * 把搬走的地形**等量长回战局内**：让已有的山 / 水贴着自己的边缘一层层往外长。
     *
     * 为什么不直接用图元补（topUpTerrain）：图元是「撒点 + 挑位」，战局内常常放不下大图元
     * （长墙、大湖），挑位失败就只能退回全图补 —— 一退回，地形又长回没人去的地方，
     * 前面那一刀等于白搬（实测 2 人局的「战局外 / 战局内密度比」反而从 0.47 涨到 1.45）。
     *
     * 一层层往外长则不会失败，而且**按搬走的类型等量补**：无效地带被削薄，玩家真的会
     * 经过的那几座山 / 那几片湖被加厚 —— 顺带也更贴合「地形要够大」这条。
     *
     * 对称：距离场是对称的（种子与白名单都对称）→ 同一层天然整层对称；
     * 最后一层按**整条 D_N 轨道**取（map.orbit），差几格也不会破坏对称。
     */
    const growBack = (type, want) => {
      if (want <= 0) return 0;
      const g = game.terrain.grid;
      const q = [];
      for (let i = 0; i < TOT; i++) {
        if (g[(i / TERR_COLS) | 0][i % TERR_COLS] !== type) continue;
        q.push(i);
      }
      if (!q.length) return 0;
      // 只长进「战局内 + 非走廊 + 非工厂禁笔圈 + 非建筑清场圈 + 非关口」的平原
      const allow = new Uint8Array(TOT);
      let room = 0;
      for (let k = 0; k < K; k++) {
        if (!hotW[k]) continue;
        for (let j = map.gStart[k], e = map.gStart[k + 1]; j < e; j++) {
          const id = map.gCells[j];
          const r = (id / TERR_COLS) | 0;
          const c = id % TERR_COLS;
          if (g[r][c] !== TT_PLAIN) continue;
          if (gateMask[r][c] || (clearMask && clearMask[r][c])) continue;
          allow[id] = 1;
          room++;
        }
      }
      if (!room) return 0;
      // 给现有的每一块同类地形编号：**长胖可以，合并不行**。
      // 不设这条的话，千湖泽国那些散落的湖会被一路长成连片水域，「平均每片大小」直接
      // 追平汪洋（实测 0.94 倍，判据要求 <0.8 倍）—— 主题就认不出来了。山也一样：
      // 群山该是几道山脉，不是一整块高原。两座块之间留出至少一格，玩家还能从缝里穿过去。
      const lab = new Int32Array(TOT).fill(-1);
      let nLab = 0;
      for (let s = 0; s < q.length; s++) {
        const id = q[s];
        if (lab[id] >= 0) continue;
        const me = nLab++;
        lab[id] = me;
        const st = [id];
        while (st.length) {
          const cur = st.pop();
          const r = (cur / TERR_COLS) | 0;
          const c = cur % TERR_COLS;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              const nr = r + dr;
              const nc = c + dc;
              if (nr < 0 || nr >= TERR_ROWS || nc < 0 || nc >= TERR_COLS) continue;
              const nid = nr * TERR_COLS + nc;
              if (lab[nid] >= 0 || g[nr][nc] !== type) continue;
              lab[nid] = me;
              st.push(nid);
            }
          }
        }
      }
      // 一圈一圈往外长：**每一圈都按整块编号验收**，拿下一格的前提是它周围一圈的同类地形
      // 全都跟自己同一块。不这么做，两块编号不同的山 / 湖会把中间那格一起吃掉、焊成一整块 ——
      // 千湖泽国的散湖长成连片水域（平均每片大小追平汪洋），群山长成一整块高原，主题就废了。
      // 留一格缝还能让玩家从两块之间穿过去，比封死有用。
      const owned = new Uint8Array(TOT);
      for (let i = 0; i < q.length; i++) owned[q[i]] = 1;
      const seen = owned.slice();
      const cand = new Int32Array(TOT).fill(-2);
      let frontier = q.slice();
      let added = 0;
      while (added < want && frontier.length) {
        const touched = [];
        const next = [];
        for (let fi = 0; fi < frontier.length; fi++) {
          const id = frontier[fi];
          const me = lab[id];
          const r = (id / TERR_COLS) | 0;
          const c = id % TERR_COLS;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              const nr = r + dr;
              const nc = c + dc;
              if (nr < 0 || nr >= TERR_ROWS || nc < 0 || nc >= TERR_COLS) continue;
              const nid = nr * TERR_COLS + nc;
              if (!allow[nid] || seen[nid]) continue;
              // 旁边一圈有没有别的编号？有 → 这格拿不得（两块会焊死）
              let foreign = 0;
              for (let ar = -1; ar <= 1 && !foreign; ar++) {
                for (let ac = -1; ac <= 1; ac++) {
                  if (!ar && !ac) continue;
                  const br = nr + ar;
                  const bc = nc + ac;
                  if (br < 0 || br >= TERR_ROWS || bc < 0 || bc >= TERR_COLS) continue;
                  const bid = br * TERR_COLS + bc;
                  if (!owned[bid] || lab[bid] === me) continue;
                  foreign = 1;
                  break;
                }
              }
              if (cand[nid] === -2) {
                cand[nid] = foreign ? -1 : me;
                touched.push(nid);
              } else if (cand[nid] >= 0 && cand[nid] !== me) cand[nid] = -1;
            }
          }
        }
        // 同一格被两块盯上 / 同一条轨道里混了编号 → 整条轨道跳过，宁可少长一圈也不要焊接
        const byOrbit = new Map();
        for (const nid of touched) {
          const k = map.orbit[nid];
          if (k < 0) continue;
          let o = byOrbit.get(k);
          if (!o) {
            o = { me: cand[nid], ids: [] };
            byOrbit.set(k, o);
          } else if (o.me >= 0 && o.me !== cand[nid]) o.me = -1;
          if (cand[nid] < 0) o.me = -1;
          o.ids.push(nid);
        }
        for (const nid of touched) cand[nid] = -2;
        const ks = Array.from(byOrbit.keys()).sort((a, b) => a - b);
        for (const k of ks) {
          if (added >= want) break;
          const o = byOrbit.get(k);
          if (o.me < 0) continue;
          for (const nid of o.ids) {
            g[(nid / TERR_COLS) | 0][nid % TERR_COLS] = type;
            owned[nid] = 1;
            seen[nid] = 1;
            lab[nid] = o.me;
            next.push(nid);
            added++;
          }
        }
        if (!next.length) break;
        frontier = next;
      }
      return added;
    };


    let movedTotal = 0;
    for (let round = 0; round < REL_ROUNDS; round++) {
      grid = game.terrain.grid;

      // ③ 偏僻深度 exc = 超出战局边界多少格（「离建筑」与「离主路」取小 —— 只要沾上
      //    「有人管」或「有人走」的任一条就算战局内）。> 0 即无效地形，越大越偏僻。
      //
      //    ⚠️ **必须整条 D_N 轨道一起判**：roadPlainOf 是「路网重挖」的近似，各支旋转像
      //    栅格化时难免差一格 —— 逐格判会切出 ±1 格的锯齿，而并集对称只传播「新挖开的」、
      //    补不回来，实测对称误差从 0.03% 涨到 1.34%（上限 1%，2 人局直接判失败）。
      //    轨道内取**最小**偏僻深度（最保守）→ 整条轨道同进同退，切口严格对称。
      const excK = new Int16Array(K).fill(-1);
      const bucket = new Int32Array(REL_EXC_MAX + 1);
      let cold = 0;
      let maxExc = 0;
      for (let k = 0; k < K; k++) {
        const a = map.gStart[k];
        const b = map.gStart[k + 1];
        if (b <= a) continue;
        let mn = -1;
        let n = 0;
        for (let j = a; j < b; j++) {
          const id = map.gCells[j];
          const r = (id / TERR_COLS) | 0;
          const c = id % TERR_COLS;
          if (grid[r][c] === TT_PLAIN) continue;
          if (gateMask[r][c]) continue; // 关口是「总部之间不许直达」的唯一依靠，整块跳过
          const eB = dB[id] - REL_BUILDING_PAD;
          const eR = dR ? dR[id] - REL_ROAD_PAD : eB;
          let e = eR < eB ? eR : eB;
          if (e <= 0) continue;
          if (e > REL_EXC_MAX) e = REL_EXC_MAX;
          if (mn < 0 || e < mn) mn = e;
          n++;
        }
        if (!n) continue;
        excK[k] = mn;
        bucket[mn] += n;
        cold += n;
        if (mn > maxExc) maxExc = mn;
      }
      if (!cold) break;
      const wm0 = worldMixCount(grid);
      const terr0 = wm0.m + wm0.w;
      const free0 = hotFreeNow();
      const budget = Math.min(cold * REL_TAKE, free0 * REL_FILL, terr0 * REL_CAP);
      if (dbg) {
        console.log(
          `     [conc] 第 ${round + 1} 轮：无效地形 ${((cold / TOT) * 100).toFixed(1)}% 图幅` +
            `（占地形 ${((cold / Math.max(1, terr0)) * 100).toFixed(1)}%），战局内可落笔 ${((free0 / TOT) * 100).toFixed(1)}%` +
            ` → 额度 ${((budget / TOT) * 100).toFixed(1)}%`
        );
      }
      if (budget < TOT * 0.003) break;
      const snapRound = grid.map((row) => row.slice()); // 兜底用：这一刀万一砸了就整轮退回来
      const regBefore = wideRegions(wideMask(grid)).length;
      // 从最偏僻的格子开始取，取到额度为止 → 切口落在距离场的等值面上（平滑，不留毛刺）
      let cum = 0;
      let cut = 1;
      for (let t = maxExc; t >= 1; t--) {
        cum += bucket[t];
        cut = t;
        if (cum >= budget) break;
      }
      if (cut < REL_EDGE) cut = REL_EDGE;
      let moved = 0;
      let movedM = 0;
      let movedW = 0;
      for (let k = 0; k < K; k++) {
        if (excK[k] < cut) continue;
        for (let j = map.gStart[k], e = map.gStart[k + 1]; j < e; j++) {
          const id = map.gCells[j];
          const r = (id / TERR_COLS) | 0;
          const c = id % TERR_COLS;
          const v = grid[r][c];
          if (v === TT_PLAIN) continue;
          if (gateMask[r][c]) continue;
          if (v === TT_MOUNTAIN) movedM++;
          else if (v === TT_WATER) movedW++;
          grid[r][c] = TT_PLAIN;
          moved++;
        }
      }
      if (!moved) break;
      movedTotal += moved;
      // 切完会掉碎屑：清碎块 + 并集对称（并集只传播「新挖开的」，不会抹掉别的地形）
      const beforeSym = grid.map((row) => row.slice());
      clearTinyBlobs(grid, MIN_BLOB_CELLS);
      symmetrizeGrid(grid, count, beforeSym, 'union');

      // ④ 补回：**先**用主题自己的图元在战局内盖（见 topUpLoop 的 okOverride）。
      //    必须优先用图元 —— 补出来的湖才是湖的形状、山才是山的形状；若改成在既有地形上
      //    「一层层往外长」，千湖泽国的碎湖会被连成一整片，「每片水 0.11% vs 汪洋 0.17%」
      //    这条主题辨识度判据直接就不成立了。
      topUpLoop(REL_PASSES, null, hotW);
      grid = game.terrain.grid;
      // ⑤ 图元在战局里挑不到位（放不下大图元）时，还差的那一点用 growBack 兜住 ——
      //    它必定成功，代价是会把贴在一起的同类地形连起来，所以只让它干**零头**（≤1% 图幅）。
      //    ⚠️ 千万别退回「全图补」：topUpTerrain 按面积在全图均匀撒点，2 人局有 57% 的图幅
      //    在战局外 —— 一退回，地形就重新躺回没人去的地方（实测 2 人局的密度比反而从
      //    0.47 涨到 1.45），而且它会一路补到 mix 的 1.22 倍再靠 trimToMix 削回来，
      //    来回收割让单局耗时从 40 秒拖到 5 分钟。
      let addM = 0;
      let addW = 0;
      // ⚠️ 目标不是「本轮起点的总量」：起手常常**高于**预设（前面几刀自带 1.2 倍余量），
      //    而高出来的那部分紧接着就会被 trimToMix 削掉 —— 追着它补等于白补，还会因为
      //    「补不回 35.6%」把整轮判回退。只要不低于主题预设，删掉的就是本该删的。
      const wantSum = TOT * (th.mix.mountain + th.mix.water);
      const wantNow = Math.min(terr0, wantSum * 1.02);
      for (let fix = 0; fix < 3; fix++) {
        const now = worldMixCount(grid);
        const miss = Math.min(wantNow - (now.m + now.w), TOT * (process.env.WF_GROWCAP ? Number(process.env.WF_GROWCAP) : 0.012));
        if (miss <= TOT * 0.004) break;
        const share = movedM / Math.max(1, movedM + movedW); // 按搬走的类型比例分摊
        const a5 = growBack(TT_MOUNTAIN, Math.round(miss * share));
        const b5 = growBack(TT_WATER, Math.round(miss * (1 - share)));
        if (!a5 && !b5) break; // 战局内真的没空地了
        addM += a5;
        addW += b5;
        grid = game.terrain.grid;
        recarve();
        grid = game.terrain.grid;
      }
      // ⑥ 收尾修补：补地形 / growBack 都会顺手把窄缝填死 → 清碎块 ↔ 连通 轮着来
      //    （这两步互相给对方造素材），**停在连通这一刀上**。
      //    ⚠️ 必须在这里补完再去校验：补完地形就凉在那儿的话，第 N+1 轮会在一份「宽通道
      //    是 3 片」的底图上继续抠 —— 越抠越多孤岛，最后整轮被判回退，等于一刀没搬。
      for (let g2 = 0; g2 < 4; g2++) {
        const snapT = grid.map((row) => row.slice());
        if (clearTinyBlobs(grid, MIN_BLOB_CELLS)) symmetrizeGrid(grid, count, snapT, 'union');
        grid = game.terrain.grid;
        if (wideRegions(wideMask(grid)).length <= 1) break;
        const snapH = grid.map((row) => row.slice());
        ensureOpenTerrain(grid, terrainAnchors(game));
        symmetrizeGrid(grid, count, snapH, 'union');
        grid = game.terrain.grid;
      }
      // ⑦ 兜底校验：地形**跌破**主题预设了 / 宽通道被打散了，就把这一轮**整体退回去**。
      //    宁可这一刀不动，也不能为了「密度好看」把主题的地形硬删掉 —— mix 与连通是硬指标。
      const fin = worldMixCount(grid);
      const regAfter = wideRegions(wideMask(grid)).length;
      if ((fin.m + fin.w) < wantSum * 0.95 || regAfter > Math.max(1, regBefore)) {
        game.terrain.grid = snapRound;
        grid = snapRound;
        if (dbg) {
          console.log(
            `     [conc] 第 ${round + 1} 轮整轮回退：总量 ${((terr0 / TOT) * 100).toFixed(1)}% → ${(((fin.m + fin.w) / TOT) * 100).toFixed(1)}%，` +
              `宽通道 ${regBefore} 片 → ${regAfter} 片`
          );
        }
        break;
      }
      if (dbg) {
        console.log(
          `     [conc] 第 ${round + 1} 轮：搬走 ${((moved / TOT) * 100).toFixed(1)}%（切在偏僻深度 ${cut}），` +
            `growBack 补 山 ${((addM / TOT) * 100).toFixed(1)}% + 水 ${((addW / TOT) * 100).toFixed(1)}% → 合计 ${(((fin.m + fin.w) / TOT) * 100).toFixed(1)}%` +
            `（本轮起点 ${((terr0 / TOT) * 100).toFixed(1)}%）`
        );
      }
    }
    return movedTotal;
  };

  /**
   * 最后一刀：把山 / 水各自削回主题的 mix 预设。
   *
   * 为什么非得有：所有补地形都按「走廊会吃掉一半」把额度**放大**了 1~2.5 倍
   * （topUpLoop 的 loss），而实际存活率随局波动（图元大小、主题、人数都影响）——
   * 估高了，最终图上就留下超额的地形。实测汪洋 10 局里 2 局把不可通行顶到 47%
   * （上限 39%）、水平均 34.3%（预设 27%）。前面十几刀只会往里加，缺一个能减的。
   *
   * 削法（三条硬指标一个都不破）：
   *   · **整条 D_N 轨道一起削**（wedgeMap 的 orbit）→ 对称误差纹丝不动；
   *   · **从外圈往里削** → 中心圈密度有专门判据（rescueCoreFill），动中场代价最高；
   *   · 每轮只挑「贴着平原」的格子 → 大块地形慢慢缩水，而不是被打成筛子；
   *   · 变平原只会更好走 → 连通性不受影响，随后的清碎块会把剩下的碎屑扫干净。
   * 关口（gateMask）整条轨道跳过：那是「总部之间不许直达」的唯一依靠。
   */
  const trimToMix = () => {
    const th = game._mapGen && game._mapGen.theme;
    if (!th || !th.mix) return 0;
    const TOT = TERR_ROWS * TERR_COLS;
    // 目标就是预设本身 —— mix 写的就是「这个主题该有多少山、多少水」
    const wantM = TOT * clamp(th.mix.mountain, 0, 0.6);
    const wantW = TOT * clamp(th.mix.water, 0, 0.6);
    const grid = game.terrain.grid;
    const countType = () => {
      let m = 0;
      let w = 0;
      for (let r = 0; r < TERR_ROWS; r++) {
        for (let c = 0; c < TERR_COLS; c++) {
          const v = grid[r][c];
          if (v === TT_MOUNTAIN) m++;
          else if (v === TT_WATER) w++;
        }
      }
      return { m, w };
    };
    let cur = countType();
    const dbg = process.env.WFDBG;
    let beforeRegions = 0;
    let beforeCore = 0;
    if (dbg) {
      beforeRegions = wideRegions(wideMask(grid)).length;
      const cs = coreCircleStats(game, count);
      if (cs) {
        let b = 0;
        let f = 0;
        for (const i of cs.idx) {
          f += cs.wt[i];
          if (cs.wedge[(i / cs.dim.cols) | 0][i % cs.dim.cols] !== TT_PLAIN) b += cs.wt[i];
        }
        const g = cur.m + cur.w;
        beforeCore = f ? b / f / (g / TOT) : 0;
      }
      console.log(`     [trim] 起手：山 ${((cur.m / TOT) * 100).toFixed(1)}% / 水 ${((cur.w / TOT) * 100).toFixed(1)}%（目标 ${((wantM / TOT) * 100).toFixed(1)}% / ${((wantW / TOT) * 100).toFixed(1)}%），宽通道 ${beforeRegions} 片，中心比 ${beforeCore.toFixed(2)}`);
    }
    // 差 0.2 个点以内就别动手：那是几何取整的量级，削了也回不来
    if (cur.m - wantM <= TOT * 0.002 && cur.w - wantW <= TOT * 0.002) return 0;
    const ord = symOrder(count);
    const map = wedgeMap(ord);
    const K = map.dim.rows * map.dim.cols;
    // 中心圈里的轨道**最后才轮到**：rescueCoreFill 刚把中场补齐，「中场不该是空地」
    // 的下限（密度的 0.45 倍）全指望这圈地形 —— 从圈里往外削是本末倒置。
    const cs = coreCircleStats(game, count);
    const isCore = new Uint8Array(K);
    if (cs) for (const i of cs.idx) isCore[i] = 1;
    // 每条轨道离图心多远 —— 越远越先削（保护中场）
    const cx = TERR_COLS / 2;
    const cy = TERR_ROWS / 2;
    const distK = new Float32Array(K);
    let maxD = 1;
    for (let i = 0; i < K; i++) {
      const a = map.gStart[i];
      const b = map.gStart[i + 1];
      if (b <= a) continue;
      let s = 0;
      for (let j = a; j < b; j++) {
        const id = map.gCells[j];
        const r = (id / TERR_COLS) | 0;
        const c = id % TERR_COLS;
        s += Math.hypot(c - cx, r - cy);
      }
      distK[i] = s / (b - a);
      if (distK[i] > maxD) maxD = distK[i];
    }
    let cleared = 0;
    for (let round = 0; round < 24; round++) {
      cur = countType();
      const overM = cur.m - wantM;
      const overW = cur.w - wantW;
      if (overM <= 0 && overW <= 0) break;
      // 候选：整条轨道都是同一类地形、且不压关口；优先「每个成员都贴着平原」的（先啃外缘）
      const cand = [];
      for (let i = 0; i < K; i++) {
        const a = map.gStart[i];
        const b = map.gStart[i + 1];
        if (b <= a) continue;
        let type = -1;
        let mixed = false;
        let cnt = 0;
        let touch = 0;
        let banned = 0;
        for (let j = a; j < b; j++) {
          const id = map.gCells[j];
          const r = (id / TERR_COLS) | 0;
          const c = id % TERR_COLS;
          if (gateMask[r][c]) banned = 1;
          const v = grid[r][c];
          if (v !== TT_MOUNTAIN && v !== TT_WATER) continue;
          cnt++;
          if (type < 0) type = v;
          else if (type !== v) mixed = true;
          if (
            (r > 0 && grid[r - 1][c] === TT_PLAIN) ||
            (r + 1 < TERR_ROWS && grid[r + 1][c] === TT_PLAIN) ||
            (c > 0 && grid[r][c - 1] === TT_PLAIN) ||
            (c + 1 < TERR_COLS && grid[r][c + 1] === TT_PLAIN)
          ) {
            touch++;
          }
        }
        if (mixed || !cnt || banned) continue;
        if (type === TT_MOUNTAIN ? overM <= 0 : overW <= 0) continue;
        cand.push({ i, type, wgt: cnt, sc: touch / cnt + (distK[i] / maxD) * 0.7 - (isCore[i] ? 1.5 : 0) });
      }
      if (!cand.length) break;
      cand.sort((p, q) => q.sc - p.sc);
      let usedM = 0;
      let usedW = 0;
      let did = 0;
      for (const cd of cand) {
        const over = cd.type === TT_MOUNTAIN ? overM : overW;
        const used = cd.type === TT_MOUNTAIN ? usedM : usedW;
        if (used + cd.wgt > over) continue;
        const a = map.gStart[cd.i];
        const b = map.gStart[cd.i + 1];
        for (let j = a; j < b; j++) {
          const id = map.gCells[j];
          grid[(id / TERR_COLS) | 0][id % TERR_COLS] = TT_PLAIN;
        }
        if (cd.type === TT_MOUNTAIN) usedM += cd.wgt;
        else usedW += cd.wgt;
        did += cd.wgt;
      }
      cleared += did;
      // 这一轮几乎没削动 = 剩下的地形都在 protect 区 / 没贴着平原 → 收手，别空转
      if (did <= TOT * 0.0005) break;
    }
    if (dbg) {
      const now = countType();
      const cs = coreCircleStats(game, count);
      let afterCore = 0;
      if (cs) {
        let b = 0;
        let f = 0;
        for (const i of cs.idx) {
          f += cs.wt[i];
          if (cs.wedge[(i / cs.dim.cols) | 0][i % cs.dim.cols] !== TT_PLAIN) b += cs.wt[i];
        }
        const g = now.m + now.w;
        afterCore = f ? b / f / (g / TOT) : 0;
      }
      console.log(`     [trim] 收手：削掉 ${((cleared / TOT) * 100).toFixed(1)}% 图幅 → 山 ${((now.m / TOT) * 100).toFixed(1)}% / 水 ${((now.w / TOT) * 100).toFixed(1)}%，宽通道 ${wideRegions(wideMask(grid)).length} 片（原 ${beforeRegions}），中心比 ${afterCore.toFixed(2)}（原 ${beforeCore.toFixed(2)}）`);
    }
    return cleared;
  };
  // 收尾：连通兜底 + 对称对齐交替，直到不再有变化。
  // 地形变密之后（40% 上下）ensureOpenTerrain 开的走廊多了不少，这些开口不传播到
  // 对称副本上，对称误差会飙到 6% —— 早先地形量只有 24% 时开口少，看不出这个问题。
  for (let guard = 0; guard < 4; guard++) {
    const snap = game.terrain.grid.map((row) => row.slice());
    ensureOpenTerrain(game.terrain.grid, terrainAnchors(game));
    if (!symmetrizeGrid(game.terrain.grid, count, snap, 'union')) break;
  }
  ensureOpenTerrain(game.terrain.grid, terrainAnchors(game));
  regLog('01 收尾连通');
  // 收尾这一整段（清碎块 / 连通开道 / 最后再挖一遍主路）开出的口子统一在这一句传播给
  // 对称副本：逐步各自传播的话，漏掉任何一步都会留下不对称（实测 2 人局 1.43%，上限 1%）。
  // 并集只开不填，不会伤到「走得通」这条硬指标。
  const beforeFinal = game.terrain.grid.map((row) => row.slice());
  // 先做一次**多数表决**把前面各步攒下的不对称抹平：并集传播只开不填，
  // 历史遗留的「同轨道取值不一致」它管不了（实测 2 人局残留 1.25%~1.81%，上限 1%）。
  // 这一步可能把个别路面填回地形，但紧接着收尾还会再挖一遍主路，补得回来。
  symmetrizeGrid(game.terrain.grid, count);
  regLog('02 多数表决');
  // 最后把碎屑扫干净：连通 / 对称那几步会在地形边缘啃出 1~3 格的小斑点，
  // 那也是「小山小湖」—— 挡不住人，只把地图画脏（详见 clearTinyBlobs）。
  // 清完要把「新变平原的格子」**并集传播**到对称副本上：同一块地形的各个 D_N 像
  // 被主路切出来的大小未必一样，只清其中一个会破坏对称（实测对称误差飙到 3%）。
  // 清碎块 ↔ 连通性 **交替**：两边会互相制造对方的素材 ——
  //   · 清碎块把某块小地形抹成平原 → 旁边那条 1 格宽的死缝被撑成 2 格宽，
  //     于是一片「新的孤立宽通道」凭空出现（实测一次能多出 4~8 片）；
  //   · 连通那一步开走廊 / 撑窄缝 → 又把地形切成小块，造出新的碎块。
  // 所以两边各退一步轮着来，**最后停在「清完之后仍是一整片」那一刻**（见 repairWide，
  // 判据必须在清完碎块之后再取 —— 顺序记在里面了）。
  repairWide(6);
  regLog('03 清碎块循环');
  // 「走得通」是**硬指标**，碎屑只是难看 —— 所以最后这几刀只管连通，
  // 补到真的连成一片为止（repairConnect）。
  repairConnect(8);
  regLog('04 连通兜底');
  // 收尾再挖一遍主路：中途那几次「多数表决」对齐（symmetrizeGrid 的默认模式）会按多数派
  // 把个别路面**填回地形** —— 新几何里绕后路要贴着地图边走，各个 D_N 像在边界附近
  // 难免差一格，被填回去的正是这些格子（实测 3 人棋盘街区有 15 个采样点被堵）。
  // 主路全程走得通是硬指标，所以最后补一刀；并集传播只开不填，不会伤到地形。
  {
    clearTerrainAroundBuildings(game, game.terrain.grid);
    carveIsolationBands(game.terrain.grid, bands, gateMask);
    // 关口最后再钉一次：前面二十来刀（清碎块 / 连通开道 / 对称对齐 / 补地形）会把它
    // 啃得残缺不全 —— 尤其 ensureOpenTerrain 开的走廊，一刀就能把关口劈开。
    // 这里**避开主路走廊**：那条穿山峡谷是设计好的通路，钉回去就成死路了。
    stampGates(game.terrain.grid, game.hqs, count, gateType, gateSkip(), gateK);
    // 钉完关口要先**多数表决**对齐一次：抓手是「新填出来的地形」，而并集传播只管
    // 「新挖开的格子」，填的那一半它压根不碰 —— 各对的关口在栅格化时难免差 ±1 格，
    // 不表决就留在图上了（实测 3/4 人局对称误差 1.5%~2.1%）。
    symmetrizeGrid(game.terrain.grid, count);
    game.mainRoads = carveMainRoads(game.terrain.grid, game.hqs, count);
    symmetrizeGrid(game.terrain.grid, count, beforeFinal, 'union');
  }
  regLog('05 重挖主路');
  // 上面那次并集传播会在**对称位置**也开出同样的口子，那些口子落到山里就成了
  // 与世隔绝的小块空地 —— 实测「宽通道应当连成一整片」会因此冒出 2~3 片。
  // 所以最后还要再兜一次连通（同样配并集传播，免得破坏对称）。
  repairConnect(6);
  regLog('06 收尾连通2');
  // 无效地形 → 有效地形：把「够不着战局」的地形搬到「有争夺的地方」（见 concentrateTerrain）。
  // 放在 trimToMix 之前：先搬（可能补得略多），再削回预设，省得两个互相拉锯。
  concentrateTerrain();
  regLog('07 concentrateTerrain');
  // 切割判据（dB / dR）是从**世界坐标**逐格算出来的，而主路栅格化时各支 D_N 像难免差一格
  // （roadPlainOf 是路网重挖的近似），等值面切口因此会留下 ±1 格的锯齿 → 表决对齐一次。
  symmetrizeGrid(game.terrain.grid, count);
  regLog('08 搬迁后表决');
  trimToMix();
  regLog('09 trimToMix');
  // ⚠️ 修剪只会把地形变成平原，看着应当更好走 —— 但一条 D_N 轨道的成员是**散在各处的
  //    同一个点**，整条一削等于同时在好几座山里各戳一个洞；洞旁边再来一下就凑够 2×2，
  //    于是凭空冒出一小片「孤立宽通道」（实测群山 3 人局 1 片 → 3 片）。
  //    而「宽通道连成一整片」是硬指标，所以收尾必须是 repairWide + repairConnect：
  //    前者把清碎块撑出来的新孤岛打通并保证「收手时就是一整片」，后者再无条件兜一遍连通。
  //    （早先这段自己手写循环，把 busy 取在清碎块**之前** —— 实测日志里「最终修补#1 → 1 片」、
  //    「收工 → 3 片」，最后一轮刚清出的孤岛就这么被带了出去。）
  repairWide(8);
  regLog('10 最终修补');
  repairConnect(8);
  regLog('11 收工');
  // 「不要小山小湖」的最后一道：**开道那一步只管连通、不管碎屑**，而 clearTinyBlobs
  // 在它之前就跑完了 —— 新开的走廊两侧会啃出几格大的地形残渣（实测偶尔剩 6 格的一块）。
  // 这里补一刀清扫，但**连通永远赢**：先量一次「现在是几片」，清完若反而断了就整版退回
  // （碎屑只是难看，走不出去才是事故）。清完再按并集传播一次对称，误差才压得住。
  {
    const before = wideRegions(wideMask(game.terrain.grid)).length;
    if (before <= 1) {
      const snapT = game.terrain.grid.map((row) => row.slice());
      if (clearTinyBlobs(game.terrain.grid, MIN_BLOB_CELLS)) {
        symmetrizeGrid(game.terrain.grid, count, snapT, 'union');
        if (wideRegions(wideMask(game.terrain.grid)).length > before) {
          game.terrain.grid = snapT; // 清碎屑把路清断了 —— 退回原样
        }
      }
    }
    regLog('12 扫碎屑');
  }
  // 磨圆山/水外缘直角：削尖刺 + 削凸角 + 填凹口。连通仍优先 —— 磨完若宽通道裂开就退回。
  {
    const before = wideRegions(wideMask(game.terrain.grid)).length;
    const snapT = game.terrain.grid.map((row) => row.slice());
    const n = roundTerrainEdges(game.terrain.grid, 4);
    if (n) {
      symmetrizeGrid(game.terrain.grid, count);
      const after = wideRegions(wideMask(game.terrain.grid)).length;
      if (after > Math.max(1, before)) {
        game.terrain.grid = snapT;
      } else {
        repairConnect(4);
      }
    }
    regLog('12b 磨圆外缘');
  }
  // 建筑占位下的连通性开道：**必须排在高度场之前**（详见 openLanesAroundBuildings 的注释）。
  // 前面那一整串连通修复只认地形，建筑占位是寻路掩码 passGrid 才加进去的 ——
  // 地图「地形上连成一整片」，建筑一落位却能把某片地整个圈掉，玩家看到的路就不存在。
  // 新挖的走廊要参与高度场派生与挖坡口，所以这一刀必须在 buildHeightField 之前。
  {
    const before = process.env.WFREG ? wideRegions(wideMask(game.terrain.grid)).length : 0;
    const dug = openLanesAroundBuildings(game);
    if (process.env.WFREG) {
      const after = wideRegions(wideMask(game.terrain.grid)).length;
      console.log(`  [reg] 13 建筑开道：挖 ${dug} 格，宽通道 ${before} → ${after} 片（${count} 人）`);
    }
    // 挖完对称一次：开道逐格判定，栅格化后各 D_N 像难免差一格。
    // ⚠️ 用**多数表决**而不是并集 —— 并集会把主路走廊整组开掉（分隔带只有 gapCells 宽，
    // 同组里路面占多数），中场被抹平。详见本函数上方「收尾」段的注释。
    if (dug) {
      symmetrizeGrid(game.terrain.grid, count);
      // 开道会在走廊两侧啃出新的直角锯齿 —— 再磨两遍（凹角填 + 凸角削）
      if (roundTerrainEdges(game.terrain.grid, 2)) symmetrizeGrid(game.terrain.grid, count);
    }
  }
  // 去毛刺（见 despeckleEdges）：**收尾的最后一眼** —— 把 1 格宽的尖刺拔掉、1 格宽的凹口填平。
  //   · 放在这里（建筑开道之后、高度场之前）：开道啃出来的新锯齿一并清掉；
  //   · 跑在 symmetrizeGrid 之后是**故意**的：本地 3×3 规则与 D_N 可交换，对称自己就保住了，
  //     不需要再表决 —— 而一表决就会按「轨道多数」把刚拔掉的尖刺原样插回去
  //     （毛刺一路活到成品，根子就在这儿）。
  //   · 连通仍然优先：宽通道裂开就整版退回（和上面几步同一个纪律）。
  // WF_NODESPECKLE=1 关掉这一步（A/B 对照用；关掉后边界上会留下一堆 1 格毛刺）
  if (!process.env.WF_NODESPECKLE) {
    const before = wideRegions(wideMask(game.terrain.grid)).length;
    const snapT = game.terrain.grid.map((row) => row.slice());
    const cut = despeckleEdges(game.terrain.grid, 4);
    if (cut) {
      const after = wideRegions(wideMask(game.terrain.grid)).length;
      if (after > Math.max(1, before)) {
        game.terrain.grid = snapT; // 去毛刺把宽通道磨断了 —— 整版退回
      } else if (process.env.WFREG) {
        console.log(`  [reg] 13b 去毛刺：改 ${cut} 格，宽通道 ${before} → ${after} 片（${count} 人）`);
      }
    }
  }
  // 高低差：**地形定稿之后**才派生高度场（前面每一步都会改地形，早算了白算）。
  // 山的高度往外摊成一圈缓坡、水往下摊成一圈洼地 → 可通行的平原也有了高地 / 低洼之分，
  // 「占高处打低处有射程加持」才真的成立（见 buildHeightField / effRange）。
  game.terrain.heights = buildHeightField(game.terrain.grid, count, buildingSites(game));
  game.terrain.ramps = game.terrain.heights.ramps; // 坡道掩码：坡是「无视高低差也能走」的地形

  // 开局部队：每名玩家在总部**正前方**排成行列（面向地图中心；无初始工厂，工厂全靠打下来）
  // 总部产线不可进化 → 亲兵的进化上限同样是 1 阶（level 1）
  for (let i = 0; i < players.length; i++) spawnStartRosterAtHq(game, game.hqs[i], i);

  return game;
}

/** 总部「正前方」坐标轴（指向地图中心） */
function hqFrontAxes(hq) {
  return dirTowardCenter(hq.x, hq.y);
}

/**
 * 在总部正前方排出 count 个阵列落点（成行成列）。
 * 第 0 排贴着总部外缘，后续排朝战场推进；每排人数尽量均分。
 */
function hqFrontFormation(hq, count) {
  const n = Math.max(0, count | 0);
  if (n <= 0) return [];
  const { fx, fy, rx, ry } = hqFrontAxes(hq);
  const gapX = 38; // 列间距（px）
  const gapY = 42; // 排间距（px）
  // 每排人数：√n 取整，既不太扁也不太长（6 兵 → 3×2，4 兵 → 2×2，3 兵 → 3×1）
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const front0 = HQ_R + 32;
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = (i / cols) | 0;
    const col = i % cols;
    const nInRow = Math.min(cols, n - row * cols);
    const lat = (col - (nInRow - 1) * 0.5) * gapX;
    const fwd = front0 + row * gapY;
    out.push({ x: hq.x + fx * fwd + rx * lat, y: hq.y + fy * fwd + ry * lat });
  }
  return out;
}

/** 按 data.js 的 startRoster，在总部正前方排成阵列生成开局亲兵 */
function spawnStartRosterAtHq(game, hq, ownerIdx) {
  if (!hq || ownerIdx < 0) return;
  const hqSource = { id: 0, owner: ownerIdx, level: 1 };
  const slots = hqFrontFormation(hq, START_ROSTER.length);
  const { fx, fy } = hqFrontAxes(hq);
  START_ROSTER.forEach((type, k) => {
    const p = slots[k] || { x: hq.x + fx * (HQ_R + 32), y: hq.y + fy * (HQ_R + 32) };
    // spawnUnit：默认朝中场 + 落位挤开重叠旧兵
    spawnUnit(game, hqSource, type, p.x, p.y);
  });
}

/**
 * 新兵落位瞬间的碰撞体积：自己站住不动，把重叠的旧兵沿径向挤开。
 * （常规 separateUnits 是对半互推；出生要「占坑」，否则门口一堆人时新兵会被顶飞。）
 */
function displaceForSpawn(game, born) {
  if (!born || born.dead) return;
  // 多轮：门口叠人时一脚推开不够，旧兵互相卡住需要再挤几次
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const u of game.units) {
      if (u === born || u.dead) continue;
      let dx = u.x - born.x;
      let dy = u.y - born.y;
      let d = Math.hypot(dx, dy);
      const min = born.r + u.r;
      if (d >= min) continue;
      if (d < 1e-4) {
        // 完全重合：沿中场方向推，跟产兵朝向一致
        const { fx, fy } = dirTowardCenter(born.x, born.y);
        dx = fx;
        dy = fy;
        d = 1;
      }
      const push = min - d + 0.5; // 略多挤一点，避免下一帧又贴死
      if (moveIfPassable(game, u, u.x + (dx / d) * push, u.y + (dy / d) * push)) moved = true;
    }
    if (!moved) break;
  }
}

/**
 * 造一支部队。
 * @param {object} spec 可选：产出它的那条产线 {type, tier, branch} —— 出厂即按产线当前
 *   阶数 / 分支定型（产线进化后，新兵直接就是进化后的单位，不再是「先出初级再手动进阶」）。
 */
function spawnUnit(game, fac, type, x, y, spec) {
  const ownerIdx = fac.owner;
  if (ownerIdx < 0 || ownerIdx >= game.players.length) return null;
  // 落点安全：万一压到不可通行地形（山/水），在附近螺旋找一个可站立的点
  let sx = clamp(x, 20, WORLD_W - 20);
  let sy = clamp(y, 20, WORLD_H - 20);
  if (!terrainPassable(game, sx, sy)) {
    let found = false;
    for (let ring = 1; ring <= 6 && !found; ring++) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const nx = clamp(sx + Math.cos(a) * ring * TERR_CELL, 20, WORLD_W - 20);
        const ny = clamp(sy + Math.sin(a) * ring * TERR_CELL, 20, WORLD_H - 20);
        if (terrainPassable(game, nx, ny)) {
          sx = nx;
          sy = ny;
          found = true;
          break;
        }
      }
    }
  }
  // 出厂阶数 / 分支直接取自产线：没传产线就是一级、未定分支
  const maxTier = clamp(Math.round(fac.level || 1), 1, 3);
  const tier = spec ? clamp(Math.round(spec.tier || 1), 1, maxTier) : 1;
  const branch = ''; // 已取消 A/B 分支，保留字段仅为兼容序列化
  const st = unitStats(type, tier);
  const s = statsToPx(STATS[type] || STATS.warrior); // 格 → 像素（r / range / splash）
  const face = dirTowardCenter(sx, sy);
  const faceAng = Math.atan2(face.fy, face.fx);
  const u = {
    id: game.nextUnitId++,
    ownerId: game.players[ownerIdx].id,
    ownerIdx,
    type: TYPE_LIST.includes(type) ? type : 'warrior',
    tier,
    branch,
    maxTier,
    homeFac: fac.id,
    // 第 9 项：出生自哪条产线（0 = 第 1 条）。它在场期间占着这条线的一个名额 ——
    // 产线的「在场上限」与「越多越慢」都按它统计；阵亡即让出名额。
    lineIdx: clamp(Math.round(spec && spec.lineIdx ? spec.lineIdx : 0), 0, FAC_MAX_LINES - 1),
    x: sx,
    y: sy,
    // ⚠️ 底盘与炮塔是两个角：`angle` = 车体（朝移动方向），`turret` = 炮塔（朝攻击方向）。
    // 开火只转炮塔，车体继续照着行军方向走 —— 否则一开打整只兵就扭过去，看着很别扭。
    // 默认面向中场；产线 / 开局亲兵都会落在建筑朝中场的一侧。
    angle: faceAng,
    turret: faceAng,
    hp: st.hp,
    maxHp: st.hp,
    dmg: st.dmg,
    range: st.range,
    cdMax: st.cd,
    cdLeft: 0,
    nextFireAt: 0, // 激光兵专用：下一次可射击的绝对时间戳（步进 dt 固定为 0.1s，用绝对时间可避免浮点累积导致射速漂移）
    speed: s.speed,
    bulletSpeed: st.bulletSpeed, // 弹速（px/s），按兵种 / 阶数取自 data.js
    r: s.r,
    splash: s.splash || 0,
    minRange: s.minRange || 0, // 最小射击半径（仅轰击）：射界死角内的目标打不到
    burn: Boolean(s.burn),
    laser: Boolean(s.laser), // 激光兵：持续光束 + 锁定充能
    lockKey: '', // 当前锁定目标的标识（`类别:id`，空串 = 未锁定）
    lockKind: 0, // 锁定目标类别：0 无 / 1 单位 / 2 工厂 / 3 研究所 / 4 总部
    lockId: 0, // 锁定目标 id
    lockStart: 0, // 本次锁定开始的毫秒时间戳（0 = 未锁定）
    windupUntil: 0, // 前摇结束时间戳：之前不射击
    lockMul: 1, // 当前伤害倍率（1 → LASER_MAX_MUL）
    targetId: 0,
    targetFac: 0, // 当前锁定的敌方工厂 id（0 = 无）
    targetLab: 0, // 当前锁定的敌方研究所 id（0 = 无）
    targetHq: 0, // 当前锁定的敌方总部 id（0 = 无）
    manualTarget: null, // 玩家右键锁定的手动攻击目标 { kind, id }，优先于自动索敌
    scanAt: 0,
    moveX: null,
    moveY: null,
    // 玩家按住 Shift 右键规划的多点路径：剩余路点 [{x,y},…]，队首即当前目标（= moveX/moveY）
    route: null,
    routeAt: 0, // 走上当前这一段的时间戳（用于「这一段走不通就别死磕」的兜底）
    burning: false, // 当前是否站在灼烧地形里（客户端据此画身上的火苗）
    pulseAt: 0, // 上一次喷火表现脉冲（枪口焰/后坐）的时间戳
    lastHitBy: 0,
    killerIdx: null,
    dead: false,
  };
  game.units.push(u);
  // 新兵自带碰撞体积：把原先站在落点上的单位挤开（自己占坑）
  displaceForSpawn(game, u);
  return u;
}

function garrisonOf(game, facId, ownerIdx) {
  let n = 0;
  for (const u of game.units) {
    if (!u.dead && u.homeFac === facId && u.ownerIdx === ownerIdx) n++;
  }
  return n;
}

/** 该玩家当前存活部队总数（含总部亲兵与各厂部队） */
function unitCountOf(game, ownerIdx) {
  let n = 0;
  for (const u of game.units) {
    if (!u.dead && u.ownerIdx === ownerIdx) n++;
  }
  return n;
}

/** 该玩家当前已占领的研究所数量 */
function labCountOf(game, ownerIdx) {
  let n = 0;
  for (const l of game.labs) if (l.owner === ownerIdx) n++;
  return n;
}

/**
 * 第 7 项：某座研究所的科技点产出（点 / 结算周期）。
 * 基数 RP_PER_LAB；每开拓一条研究产线再 +LAB_LINE_RP_BONUS。
 */
function labRpOf(l) {
  const n = Math.max(0, Math.round((l && l.lines) || 0));
  return RP_PER_LAB + n * LAB_LINE_RP_BONUS;
}

/** 该玩家下一次结算能拿到的科技点总数（按各研究所是否已开拓产线累加） */
function labRpTotalOf(game, ownerIdx) {
  let sum = 0;
  for (const l of game.labs) if (l.owner === ownerIdx) sum += labRpOf(l);
  return sum;
}

/** 总部防卫目标类别：0 无 / 1 单位 / 2 工厂 / 3 研究所 / 4 总部（与单位索敌一致） */
function hqNormAtk(h) {
  // 兼容旧编码：曾经用 atkId/atkFocus 负数表示工厂、正数表示单位
  if (h.atkKind == null) {
    if (h.atkId < 0) {
      h.atkKind = 2;
      h.atkId = -h.atkId;
    } else if (h.atkId > 0) h.atkKind = 1;
    else h.atkKind = 0;
  }
  if (h.atkFocusKind == null) {
    if (h.atkFocus < 0) {
      h.atkFocusKind = 2;
      h.atkFocus = -h.atkFocus;
    } else if (h.atkFocus > 0) h.atkFocusKind = 1;
    else h.atkFocusKind = 0;
  }
  if (!(h.atkId > 0)) {
    h.atkId = 0;
    h.atkKind = 0;
  }
  if (!(h.atkFocus > 0)) {
    h.atkFocus = 0;
    h.atkFocusKind = 0;
  }
}

/**
 * 解析总部当前锁定：目标仍合法则返回 { kind, target }；否则 null。
 * inRangeOnly=true 时还要求在射程内且通视。
 */
function hqLookupAtk(game, h, kind, id, inRangeOnly) {
  if (!kind || !id) return null;
  let target = null;
  if (kind === 1) {
    const t = game.units.find((u) => u.id === id);
    if (t && !t.dead && t.ownerIdx !== h.owner) target = t;
  } else if (kind === 2) {
    const f = game.factories.find((x) => x.id === id);
    if (f && f.owner !== h.owner) target = f;
  } else if (kind === 3) {
    const l = game.labs.find((x) => x.id === id);
    if (l && l.owner !== h.owner) target = l;
  } else if (kind === 4) {
    const eh = game.hqs.find((x) => x.id === id);
    if (eh && !eh.down && eh.owner !== h.owner) target = eh;
  }
  if (!target) return null;
  if (inRangeOnly) {
    if (dist(target.x, target.y, h.x, h.y) > HQ_ATK_RANGE) return null;
    if (losBlocked(game, h.x, h.y, target.x, target.y)) return null;
  }
  return { kind, target };
}

/**
 * 总部自动索敌：口径与 findTarget 一致 ——
 * 先打射程内最近的敌方单位；没有单位再在工厂 / 研究所 / 敌方总部里取最近（中立可打）。
 */
function hqPickAuto(game, h) {
  let bestD = Infinity;
  let bestU = null;
  for (const u of game.units) {
    if (u.dead || u.ownerIdx === h.owner) continue;
    const d = dist(u.x, u.y, h.x, h.y);
    if (d > HQ_ATK_RANGE || d >= bestD) continue;
    if (losBlocked(game, h.x, h.y, u.x, u.y)) continue;
    bestD = d;
    bestU = u;
  }
  if (bestU) return { kind: 1, target: bestU };

  let bestB = null;
  let bestKind = 0;
  bestD = Infinity;
  const bear = (kind, ref) => {
    if (ref.owner === h.owner) return;
    if (kind === 4 && ref.down) return;
    const d = dist(ref.x, ref.y, h.x, h.y);
    if (d > HQ_ATK_RANGE || d >= bestD) return;
    if (losBlocked(game, h.x, h.y, ref.x, ref.y)) return;
    bestD = d;
    bestB = ref;
    bestKind = kind;
  };
  for (const f of game.factories) bear(2, f);
  for (const l of game.labs) bear(3, l);
  for (const eh of game.hqs) bear(4, eh);
  return bestB ? { kind: bestKind, target: bestB } : null;
}

/**
 * 第 6 项：总部防卫。
 * 索敌与普通单位同口径：优先射程内敌方部队，其次中立 / 敌方工厂、研究所、总部。
 * 玩家右键指定后写入 atkFocus：有焦点时优先打它（进射程才开火），失效才回退自动索敌。
 * 起攻击前摇 → 前摇走完且冷却结束才开火，每发 HQ_ATK_DMG 点直伤。
 * atkKind：1 单位 / 2 工厂 / 3 研究所 / 4 总部；atkId 为正 id。
 */
function updateHqDefense(game, dt, now) {
  for (const h of game.hqs) {
    if (!h || h.down) {
      if (h) {
        h.atkId = 0;
        h.atkKind = 0;
        h.atkFocus = 0;
        h.atkFocusKind = 0;
        h.atkWindup = 0;
      }
      continue;
    }
    hqNormAtk(h);
    if (h.atkCd > 0) h.atkCd -= dt;

    // ① 玩家指定焦点：目标仍在（未死 / 未易主）则优先；进射程+通视才开火
    let kind = 0;
    let target = null;
    let focused = false;
    if (h.atkFocusKind && h.atkFocus) {
      const alive = hqLookupAtk(game, h, h.atkFocusKind, h.atkFocus, false);
      if (!alive) {
        h.atkFocus = 0;
        h.atkFocusKind = 0;
      } else {
        focused = true;
        const inR = hqLookupAtk(game, h, h.atkFocusKind, h.atkFocus, true);
        if (inR) {
          kind = inR.kind;
          target = inR.target;
        }
      }
    }

    if (focused) {
      if (!target) {
        // 焦点还在但够不着 → 保持指定、暂不打别人
        h.atkId = 0;
        h.atkKind = 0;
        h.atkWindup = 0;
        continue;
      }
      if (h.atkKind !== kind || h.atkId !== h.atkFocus) {
        h.atkKind = kind;
        h.atkId = h.atkFocus;
        h.atkWindup = now + HQ_ATK_WINDUP_MS;
        continue; // 新锁定只亮前摇
      }
      h.atkKind = kind;
      h.atkId = h.atkFocus;
    } else {
      // ② 无焦点：校验当前目标，否则自动索敌（单位优先，再建筑）
      const cur = hqLookupAtk(game, h, h.atkKind, h.atkId, true);
      if (cur) {
        kind = cur.kind;
        target = cur.target;
      }
      if (!target) {
        const picked = hqPickAuto(game, h);
        if (picked) {
          kind = picked.kind;
          target = picked.target;
          h.atkKind = kind;
          h.atkId = target.id;
        } else {
          h.atkKind = 0;
          h.atkId = 0;
        }
        h.atkWindup = target ? now + HQ_ATK_WINDUP_MS : 0;
        continue; // 本步只亮前摇，不开火
      }
    }
    // ③ 前摇中 / 冷却中 → 只保持锁定与前摇表现
    // ⚠️ 前摇只在「新索敌」时亮一次（见上）；开火后不再重置 atkWindup，
    //    否则每发都要重新蓄能，客户端永远看不到「蓄满后突突连射」。
    if (h.atkWindup > now || h.atkCd > 0) continue;
    // ④ 开火（同目标后续只吃冷却）
    h.atkCd = HQ_ATK_CD;
    if (kind === 1) {
      target.lastHitBy = -1;
      retaliate(game, target, 0);
      damageUnit(game, target, HQ_ATK_DMG, h.owner);
    } else if (kind === 2) {
      damageFactory(game, target, HQ_ATK_DMG, h.owner);
    } else if (kind === 3) {
      damageLab(game, target, HQ_ATK_DMG, h.owner);
    } else if (kind === 4) {
      damageHq(game, target, HQ_ATK_DMG, h.owner);
    }
    pushEvent(game, {
      t: 'hqatk',
      oi: h.owner,
      hid: h.id,
      x: round1(h.x),
      y: round1(h.y),
      tx: round1(target.x),
      ty: round1(target.y),
    });
  }
}

/**
 * 该玩家的「平均」研究点产出（点/秒）= 已占领研究所数 × (RP_PER_LAB / RP_PERIOD_MS)。
 * 仅用于界面展示与测试推算：实际结算是离散跳变的（每 RP_PERIOD_MS 一次性发放整数点），
 * 本函数不参与结算。
 */
function researchRate(game, ownerIdx) {
  return (labRpTotalOf(game, ownerIdx) * 1000) / RP_PERIOD_MS;
}

/**
 * 科技点结算（离散跳变）：每满 RP_PERIOD_MS 一次性发放「当前研究所数 × RP_PER_LAB」点整数。
 * - 计时按玩家独立走：只要手里还有研究所就继续计时；研究所全部失去则计时清零（不产出、不攒进度）。
 * - 到点按「发放那一刻的研究所数量」计算，中途占下/丢掉研究所会立刻反映在下一次结算上。
 * - 已封顶（RP_CAP）时不再计时，避免解封后瞬间爆发。
 * 完全被动，不需要任何操作。
 */
function updateResearch(game, dt) {
  const stepMs = dt * 1000;
  for (let i = 0; i < game.players.length; i++) {
    const p = game.players[i];
    if (p.eliminated || p.left) {
      p.rpAccMs = 0;
      continue;
    }
    // 第 7 项：产出按各研究所 labRpOf 累加（基数 + 每条产线 bonus）
    const per = labRpTotalOf(game, i);
    if (per <= 0) {
      p.rpAccMs = 0; // 一座不占：不产出，进度也不保留
      continue;
    }
    if (p.rp >= RP_CAP) {
      p.rpAccMs = 0;
      continue;
    }
    p.rpAccMs = (p.rpAccMs || 0) + stepMs;
    // 用 while 兜住「一帧跨过多个周期」的极端情况，保证不会漏发
    while (p.rpAccMs >= RP_PERIOD_MS) {
      p.rpAccMs -= RP_PERIOD_MS;
      p.rp = Math.min(RP_CAP, p.rp + per);
      if (p.rp >= RP_CAP) {
        p.rpAccMs = 0;
        break;
      }
    }
  }
}

function pushEvent(game, ev) {
  game.events.push(ev);
  // 上限 160：开火（shot）与命中（hit）是高频视觉事件，一屏上百支互射时每帧
  // （100ms）就能攒出几十条；窗口太小会把 kill / evo / hqdown 这类关键事件挤掉。
  if (game.events.length > 160) game.events.shift();
}

/**
 * 把一支部队提升一阶（不再有经验体系：进阶完全由「科技点」驱动，由调用方扣费）。
 * 进阶后属性按新等级重算，血量按比例保留。
 * @returns {boolean} 是否真的进阶了
 */
function promoteUnit(game, u) {
  if (!u || u.dead || u.tier >= u.maxTier) return false;
  u.tier += 1;
  // 分支在首次进化时定型，之后保持
  const st = unitStats(u.type, u.tier);
  const ratio = u.maxHp > 0 ? u.hp / u.maxHp : 1;
  u.maxHp = st.hp;
  u.hp = Math.max(1, Math.round(st.hp * ratio));
  u.dmg = st.dmg;
  u.range = st.range;
  u.cdMax = st.cd;
  u.bulletSpeed = st.bulletSpeed;
  // 体型随阶数长大（1 阶 2 格 → 2 阶 3 格 → 3 阶 4 格），溅射半径同步换算
  const evoPx = statsToPx(
    (WFData.evolved[u.type] && WFData.evolved[u.type][u.tier]) || STATS[u.type] || STATS.warrior
  );
  u.r = evoPx.r;
  u.splash = evoPx.splash || 0;
  u.minRange = evoPx.minRange || 0;
  u.burn = Boolean(evoPx.burn);
  game.players[u.ownerIdx].evolved += 1;
  pushEvent(game, { t: 'evo', uid: u.id, oi: u.ownerIdx, tier: u.tier, x: round1(u.x), y: round1(u.y) });
  return true;
}

/* ---------------- 工厂血量 / 易主 ---------------- */

/* ---------------- 研究所 / 总部 血量与易主 ---------------- */

/**
 * 建筑伤害账本：记录每个玩家在这座建筑上累计消耗了多少血、上次出手时间。
 * 血尽时归「累计消耗最多」的玩家；超过 DAMAGE_FORGET_MS 没再打则该玩家账本清空。
 */
function ensureDmgBook(b) {
  if (!b.dmgBook || typeof b.dmgBook !== 'object') b.dmgBook = Object.create(null);
  return b.dmgBook;
}

/** 记一笔真实消耗的血量（不含溢出的过量伤害） */
function noteBuildingDamage(b, dealt, killerIdx, now) {
  if (dealt <= 0 || killerIdx < 0) return;
  const book = ensureDmgBook(b);
  const key = String(killerIdx);
  const row = book[key] || (book[key] = { dmg: 0, lastAt: 0 });
  row.dmg += dealt;
  row.lastAt = now;
}

/** 忘掉太久没再出手的玩家 */
function pruneDmgBook(b, now) {
  const book = b.dmgBook;
  if (!book) return;
  for (const k of Object.keys(book)) {
    if (now - (book[k].lastAt || 0) >= DAMAGE_FORGET_MS) delete book[k];
  }
}

/** 累计消耗血量最高的玩家下标；没有账本则退回 lastHitBy */
function topDamager(b, fallback) {
  const book = b.dmgBook;
  let best = -1;
  let bestD = 0;
  if (book) {
    for (const k of Object.keys(book)) {
      const d = book[k].dmg || 0;
      if (d > bestD) {
        bestD = d;
        best = Number(k);
      }
    }
  }
  if (best >= 0) return best;
  return fallback != null ? fallback : -1;
}

function clearDmgBook(b) {
  b.dmgBook = Object.create(null);
}

/**
 * 研究所受击：血打光时由「累计消耗血量最多者」接管，并立刻恢复满血。
 */
function damageLab(game, l, amount, killerIdx) {
  if (!l || amount <= 0) return;
  if (killerIdx == null || killerIdx < 0 || killerIdx >= game.players.length) return;
  if (l.owner === killerIdx) return; // 自家研究所不受自家伤害
  const dealt = Math.min(amount, Math.max(0, l.hp));
  if (dealt <= 0) return;
  l.hp -= dealt;
  l.lastHitBy = killerIdx;
  noteBuildingDamage(l, dealt, killerIdx, game.now || 0);
  if (l.hp > 0) return;
  pruneDmgBook(l, game.now || 0);
  const winner = topDamager(l, killerIdx);
  if (winner < 0 || winner >= game.players.length) {
    l.hp = 1; // 极端情况：没人能接手，留 1 血避免反复触发
    return;
  }
  const prev = l.owner;
  l.owner = winner;
  l.hp = l.hpMax; // 归属权发生变化 → 血量恢复满
  l.lastHitBy = -1;
  clearDmgBook(l);
  // 易主则清除前任主人开拓的研究产线（与工厂「易主重置产线」保持一致）
  l.lines = 0;
  game.players[winner].captured += 1;
  game._captures = (game._captures || 0) + 1;
  pushEvent(game, { t: 'lab', lid: l.id, oi: l.owner, prev, x: l.x, y: l.y });
}

/**
 * 总部受击：打光即「总部陷落」，该玩家出局（总部不会易主）。
 */
function damageHq(game, hq, amount, killerIdx) {
  if (!hq || hq.down || amount <= 0) return;
  if (killerIdx == null || killerIdx < 0 || killerIdx >= game.players.length) return;
  if (hq.owner === killerIdx) return; // 自家总部不受自家伤害
  hq.hp -= amount;
  hq.lastHitBy = killerIdx;
  if (hq.hp > 0) return;
  hq.hp = 0;
  hq.down = true;
  const p = game.players[hq.owner];
  if (p) p.eliminated = true;
  pushEvent(game, { t: 'hqdown', oi: hq.owner, ki: killerIdx, x: hq.x, y: hq.y });
  game._captures = (game._captures || 0) + 1;
}

/**
 * 工厂受击：血打光时由「累计消耗血量最多者」接管该厂，并立刻恢复满血。
 * @param {object} f 工厂
 * @param {number} amount 伤害
 * @param {number} killerIdx 造成伤害的玩家下标
 */
function damageFactory(game, f, amount, killerIdx) {
  if (!f || amount <= 0) return;
  if (killerIdx == null || killerIdx < 0 || killerIdx >= game.players.length) return;
  if (f.owner === killerIdx) return; // 自家工厂不受自家伤害
  const dealt = Math.min(amount, Math.max(0, f.hp));
  if (dealt <= 0) return;
  f.hp -= dealt;
  f.lastHitBy = killerIdx;
  noteBuildingDamage(f, dealt, killerIdx, game.now || 0);
  if (f.hp > 0) return;
  pruneDmgBook(f, game.now || 0);
  const winner = topDamager(f, killerIdx);
  if (winner < 0 || winner >= game.players.length) {
    f.hp = 1;
    return;
  }
  const prev = f.owner;
  f.owner = winner;
  f.hp = f.hpMax; // 归属权发生变化 → 血量恢复满
  f.capProg = 0;
  f.capBy = -1;
  f.contested = false;
  f.repairN = 0;
  f.rally = null; // 易主则清除前任主人设的集结点
  resetSlots(f); // 易主则产线一并重置：只留一条一级线，不白送新主人一堆高阶产线
  f.lastHitBy = -1;
  clearDmgBook(f);
  game.players[winner].captured += 1;
  game._captures = (game._captures || 0) + 1;
  pushEvent(game, { t: 'cap', fid: f.id, oi: f.owner, prev, x: f.x, y: f.y });
}

/**
 * 工厂每帧维护：伤害账本过期清理 + 友军维修 + 供客户端参考的「当前领先夺厂者」。
 * 易主由 damageFactory 在血尽时按累计消耗血量判定（不再有占领圈读条）。
 * @returns {number} 本帧之前累计的易主次数
 */
function updateFactories(game, dt, now) {
  const t = now != null ? now : game.now || 0;
  for (const f of game.factories) {
    if (f.hpMax == null) {
      f.hpMax = FACTORY_HP;
      f.hp = f.owner >= 0 ? FACTORY_HP : Math.round(FACTORY_HP * NEUTRAL_HP_RATIO);
    }
    if (f.evoCd > 0) f.evoCd = Math.max(0, f.evoCd - dt * 1000);
    pruneDmgBook(f, t);
    // 维修：己方每有 1 兵在「工厂外缘 + repairRange」内 → +repairHpPerSec HP/s
    let repairN = 0;
    if (f.owner >= 0 && f.hp < f.hpMax) {
      for (const u of game.units) {
        if (u.dead || u.ownerIdx !== f.owner) continue;
        if (dist(u.x, u.y, f.x, f.y) <= REPAIR_RANGE) repairN += 1;
      }
      if (repairN > 0) {
        f.hp = Math.min(f.hpMax, f.hp + repairN * REPAIR_HP_PER_SEC * dt);
      }
    }
    f.repairN = repairN;
    // 兼容旧客户端字段：不再表示占领读条，只标「当前伤害账本领先者」（有人在打才 >0）
    const lead = topDamager(f, -1);
    f.capBy = lead;
    f.capProg = 0;
    f.contested = false;
  }
  for (const l of game.labs) {
    pruneDmgBook(l, t);
  }
  // 总部进化冷却同步递减（总部也能用科技点让亲兵进阶）
  for (const h of game.hqs) {
    if (h.evoCd > 0) h.evoCd = Math.max(0, h.evoCd - dt * 1000);
  }
  return game._captures || 0;
}

/* ---------------- 生产 ---------------- */

/**
 * 该玩家当前「单条产线」的生产间隔（毫秒）= 基础间隔 × (14/15)^生产加速等级。
 * 每次升级都在「当前间隔」上再减 1/15（复利、非线性），越升收益越小但仍持续变快。
 */
function prodIntervalMs(game, ownerIdx) {
  const hq = game.hqs.find((h) => h.owner === ownerIdx);
  const lv = clamp(Math.round((hq && hq.speedLv) || 0), 0, PROD_SPEED_MAX);
  return PRODUCE_MS * Math.pow(1 - PROD_SPEED_STEP, lv);
}

/**
 * 第 9 项：某条产线当前的「在场部队数」—— 这条线吐出去、此刻还活着的兵。
 * 名额结算靠 `homeFac` + `lineIdx`：工厂与总部的 id 各自唯一（总部产出的兵 homeFac = 0，
 * 每名玩家只有一座总部，所以再按 ownerIdx 区分即可）。
 * @returns {Map<string, number>} key = 建筑key:线序号 → 在场兵数
 */
function lineAliveMap(game) {
  const m = new Map();
  for (const u of game.units) {
    if (u.dead) continue;
    const key = lineUnitKey(u) + ':' + (u.lineIdx || 0);
    m.set(key, (m.get(key) || 0) + 1);
  }
  return m;
}

/** 单位 → 它所属建筑的行 key（工厂按 id，总部产出的兵按 ownerIdx） */
function lineUnitKey(u) {
  return (u.homeFac || 0) > 0 ? 'f' + u.homeFac : 'h' + u.ownerIdx;
}

/** 建筑 → 行 key：工厂按 id、总部按 ownerIdx（两类的 key 都要互不重叠） */
function facLineKey(id) {
  return 'f' + id;
}
function hqLineKey(game, h) {
  const owner = h.owner != null ? h.owner : game.hqs.indexOf(h);
  return 'h' + owner;
}

/**
 * 第 9 项：产线「在场越多 → 产速越慢」的独立乘区。
 * 每有 1 个还在场的兵就扣 LINE_SLOW_PER_UNIT（默认 10%）：1 个 90%、2 个 80% ……
 * 满 LINE_UNIT_CAP 个刚好归零 —— 「一条线最多养 10 个兵」就是这么自然封顶的，
 * 不需要额外的硬截断（这里仍保留 `mul <= 0` 的兜底，防止 slowPerUnit 被改成不整除的值）。
 */
function lineSpeedMul(alive) {
  return clamp(1 - alive * LINE_SLOW_PER_UNIT, 0, 1);
}

/**
 * 让一座建筑（工厂 / 总部）的每条产线各自走进度、到点吐兵。
 * 各线独立计时 → 一条线就是一条独立的流水线：兵种、阶数、名额各不相同。
 * - 第 9 项：每条线的进度增速 = 基础速度 × 该线的在场减速乘区（见 lineSpeedMul）；
 *   名额占满时乘区为 0 —— 进度原样冻结（不丢进度），有部队阵亡立刻接着走。
 * - 玩家总兵力达上限时同样停在 1（旧规则，与产线名额并存）。
 * @param {Map<string, number>} alive 每条线的在场兵数（见 lineAliveMap）
 * @param {string} base 这座建筑的 key 前缀（facLineKey / hqLineKey）
 * @returns {number} 本次步进里这座建筑新造出的部队数
 */
function runSlots(game, b, dtMs, counts, spawnAt, alive, base) {
  const specs = syncSlots(b);
  const ivl = prodIntervalMs(game, b.owner);
  let made = 0;
  let best = 0;
  for (let i = 0; i < specs.length; i++) {
    const cnt = (alive && alive.get(base + ':' + i)) || 0;
    const mul = lineSpeedMul(cnt);
    if (cnt >= LINE_UNIT_CAP || mul <= 0) {
      // 这条线的名额满了（= 乘区归零）：进度冻结原地，等有人阵亡再继续
      if (b.prog[i] > best) best = b.prog[i];
      continue;
    }
    const p = (b.prog[i] || 0) + (dtMs / ivl) * mul;
    if (p < 1) {
      b.prog[i] = p;
    } else if (counts[b.owner] >= PLAYER_UNIT_CAP) {
      b.prog[i] = 1; // 满员：停在临界点，一有空位立刻补出
    } else {
      b.prog[i] = p - 1;
      specs[i].lineIdx = i; // 新兵落位到这条线（之后它的名额就挂在线上）
      const u = spawnAt(specs[i], i);
      if (u) {
        counts[b.owner] += 1; // 同一帧内多线产出也要计入
        made += 1;
        // 名额同步 +1：同一步进内若这条线还要结算第二条，别再按旧的在场数算。
        // （下个步长会用真实部队列表重建整张表，这里只是补上本帧刚补出的那个人。）
        if (alive) alive.set(base + ':' + i, cnt + 1);
      }
    }
    if (b.prog[i] > best) best = b.prog[i];
  }
  // 供客户端画「产能条」：取各线里最接近完工的那条
  b.prodProg = round2(clamp(best, 0, 1));
  return made;
}

function updateProduction(game, dt, now) {
  const dtMs = dt * 1000;
  void now; // 保留时间参数以维持签名（生产节奏完全由 dt / 间隔决定）
  // 每名玩家当前部队数（兵力上限判定用；每步只统计一次）
  const counts = game.players.map((_, i) => unitCountOf(game, i));
  // 第 9 项：每条产线「还在场的兵」—— 每条线按它减速 / 停产（每步只统计一次）
  const alive = lineAliveMap(game);

  // ---- 工厂：每条产线按自己的兵种 / 阶数 / 分支出兵 ----
  // 落点在工厂朝中场一侧（与总部一致），车体默认面向中场；spawnUnit 会把原位旧兵挤开
  for (const f of game.factories) {
    if (f.owner < 0) continue;
    runSlots(game, f, dtMs, counts, (spec) => {
      const { fx, fy, rx, ry } = dirTowardCenter(f.x, f.y);
      const d = FACTORY_R + 28;
      const lat = ((game._rng() * 2) - 1) * 40; // 正前方横排左右散开
      const u = spawnUnit(
        game,
        f,
        spec.type,
        f.x + fx * d + rx * lat,
        f.y + fy * d + ry * lat,
        spec
      );
      // 设了集结点的工厂：新兵自动前往集结点（期间照常边走边打，不需要脱离窗口）
      if (u && f.rally) {
        u.moveX = f.rally.x;
        u.moveY = f.rally.y;
      }
      return u;
    }, alive, facLineKey(f.id));
  }

  // ---- 总部：同样按产线出兵（默认产锐士、不可进化）----
  // 新兵出生在总部正前方横排上（面向中场），不再围着总部随机转圈
  for (const h of game.hqs) {
    if (h.down) continue;
    runSlots(game, h, dtMs, counts, (spec) => {
      const { fx, fy, rx, ry } = hqFrontAxes(h);
      const d = HQ_R + 32;
      const lat = ((game._rng() * 2) - 1) * 48; // 在正前方横排上左右散开
      // 总部产线不可进化 → 出厂上限恒为 1 阶
      const u = spawnUnit(
        game,
        { id: 0, owner: h.owner, level: 1 },
        spec.type,
        h.x + fx * d + rx * lat,
        h.y + fy * d + ry * lat,
        spec
      );
      // 第 4 项：总部设了集结点的话，亲兵同样自动前往（与工厂一致）
      if (u && h.rally) {
        u.moveX = h.rally.x;
        u.moveY = h.rally.y;
      }
      return u;
    }, alive, hqLineKey(game, h));
  }
}

/* ---------------- 单位 AI ---------------- */

/**
 * 把「kind + id」解析成可攻击目标（供手动攻击锁定 / 校验用）。
 * 只接受「非己方」目标：敌方或中立（如被弃/被占领后 owner===-1 的建筑）都合法；
 * 目标不存在、已阵亡、或已易主为己方 → 返回 null（视为失效）。
 * 返回 { kind, id, x, y, r }。
 */
function lookupTarget(game, ownerIdx, kind, id) {
  if (kind === 'u') {
    const e = game.units.find((x) => x.id === id && !x.dead);
    if (!e || e.ownerIdx === ownerIdx) return null;
    return { kind: 'u', id: e.id, x: e.x, y: e.y, r: e.r };
  }
  if (kind === 'f') {
    const f = game.factories.find((x) => x.id === id);
    if (!f || f.owner === ownerIdx) return null;
    return { kind: 'f', id: f.id, x: f.x, y: f.y, r: FACTORY_R };
  }
  if (kind === 'l') {
    const l = game.labs.find((x) => x.id === id);
    if (!l || l.owner === ownerIdx) return null;
    return { kind: 'l', id: l.id, x: l.x, y: l.y, r: LAB_R };
  }
  if (kind === 'h') {
    const h = game.hqs.find((x) => x.id === id);
    if (!h || h.down || h.owner === ownerIdx) return null;
    return { kind: 'h', id: h.id, x: h.x, y: h.y, r: HQ_R };
  }
  return null;
}

/**
 * 激光兵「死咬」判定：当前咬住的那个目标还能不能继续啃。
 *
 * 激光是唯一靠「持续锁定同一目标」变强的武器（倍率见 laserMul），自动索敌一旦为了
 * 「更近的敌人」改派，蓄能就清零、20 倍直接跌回 1 倍 —— 那激光就成了废兵。
 * 所以这里给它一条独立的规则：**咬住了就不松口**，只有下列情况才解锁：
 *   1. 目标死亡 / 建筑易主 / 总部已陷落（对象不存在了）；
 *   2. 目标离开攻击范围（含高低差的 effRange，见 unitRangeAt）；
 *   3. 视线被山体断开（激光不越山；轰击有 splash 才越山）；
 *   4. 玩家右键改派（manualTarget 被换掉 —— 那时根本不会走到这里，见 updateUnits）。
 * 返回 null 表示解锁，调用方回退到常规索敌重新选目标。
 */
function laserHeldTarget(game, u, overMountain) {
  // ⚠️ 这里**不加 ATTACK_SLACK**：判据必须和下面「开不开火」那一条完全一致
  // （`tDist <= unitRangeAt(...) + target.r`）。加了的话会出现一段「够得着但打不到」的死区：
  // 目标停在射程外 1~10px，激光死咬着它既不开火也不换人 —— 站着干等。
  // 不加也不会丢蓄能：出了严格射程时自动索敌（含 SLACK + 粘性）仍会选中同一个目标，
  // lockKey 不变 → 蓄能继续爬，等它走近立刻满倍率开火。
  const reachable = (x, y, r) => dist(u.x, u.y, x, y) - (r || 0) <= unitRangeAt(game, u, x, y);
  const visible = (x, y) => overMountain || !losBlocked(game, u.x, u.y, x, y);
  // 最小射击半径（仅轰击）：目标挤进射界死角就打不着，只能解锁另找目标
  const tooClose = (x, y, r) => Boolean(u.minRange) && dist(u.x, u.y, x, y) - (r || 0) < u.minRange;

  if (u.targetId) {
    const e = game.units.find((x) => x.id === u.targetId && !x.dead);
    if (!e || e.ownerIdx === u.ownerIdx) return null;
    if (!reachable(e.x, e.y, e.r) || !visible(e.x, e.y) || tooClose(e.x, e.y, e.r)) return null;
    return { kind: 'u', id: e.id };
  }
  if (u.targetFac) {
    const f = game.factories.find((x) => x.id === u.targetFac);
    if (!f || f.owner === u.ownerIdx) return null;
    if (!reachable(f.x, f.y, FACTORY_R) || !visible(f.x, f.y) || tooClose(f.x, f.y, FACTORY_R)) return null;
    return { kind: 'f', id: f.id };
  }
  if (u.targetLab) {
    const l = game.labs.find((x) => x.id === u.targetLab);
    if (!l || l.owner === u.ownerIdx) return null;
    if (!reachable(l.x, l.y, LAB_R) || !visible(l.x, l.y) || tooClose(l.x, l.y, LAB_R)) return null;
    return { kind: 'l', id: l.id };
  }
  if (u.targetHq) {
    const h = game.hqs.find((x) => x.id === u.targetHq);
    if (!h || h.down || h.owner === u.ownerIdx) return null;
    if (!reachable(h.x, h.y, HQ_R) || !visible(h.x, h.y) || tooClose(h.x, h.y, HQ_R)) return null;
    return { kind: 'h', id: h.id };
  }
  return null;
}

function findTarget(game, u) {
  // 轰击（burst）是曲射炮：弹道越过山脉，所以即使中间隔着山也能索敌、也能打到山另一侧。
  // 其余兵种仍受视线遮挡（山挡住就看不见、打不到）。
  const overMountain = Boolean(u.splash);
  // 激光兵：**锁定即死咬**。一旦咬住一个目标就绝不自动改派 —— 一路打到它死为止。
  // 只有三种情况会解锁：目标死亡 / 易主、目标离开攻击范围（或视线被山断掉）、玩家手动改派。
  // 这样蓄能不会因为「旁边蹭过来一个更近的敌人」而清零，激光才真正是越站越痛的武器。
  if (u.laser) {
    const held = laserHeldTarget(game, u, overMountain);
    if (held) return held;
  }
  // 索敌半径 = 自身攻击范围（单位按中心距 + 目标半径，建筑按到边缘的距离）+ 少量余量。
  // 不再有「射程 + 70」的追击圈：敌人没进范围就当作看不见，单位原地待命。
  let best = null;
  let bestD = Infinity;
  for (const e of game.units) {
    if (e.dead || e.ownerIdx === u.ownerIdx) continue;
    const d = dist(u.x, u.y, e.x, e.y);
    // 射程要算高低差（见 effRange）：站在高处打低处的人多一层就多一格射程，反过来吃亏
    if (d > unitRangeAt(game, u, e.x, e.y) + e.r + ATTACK_SLACK) continue;
    // 最小射击半径（仅轰击）：贴脸的敌人落在射界死角里，索敌直接跳过 —— 远火打不了近身战
    if (u.minRange && d - e.r < u.minRange) continue;
    // 山体挡住视线 → 看不见，也就无从索敌（水域不遮挡）；轰击例外，可越山索敌
    if (!overMountain && losBlocked(game, u.x, u.y, e.x, e.y)) continue;
    // 优先当前目标（粘性），其次最近
    const score = e.id === u.targetId ? d - 40 : d;
    if (score < bestD) {
      bestD = score;
      best = e;
    }
  }
  if (best) return { kind: 'u', id: best.id };

  // 射程内没有敌方单位 → 打建筑（工厂 / 研究所 / 总部 都是合法目标，按边缘距离取最近）
  let bRef = null;
  let bKind = '';
  let bfd = Infinity;
  const bear = (kind, ref, radius) => {
    if (ref.owner === u.ownerIdx) return;
    if (kind === 'h' && ref.down) return;
    const d = dist(u.x, u.y, ref.x, ref.y) - radius; // 到建筑边缘的距离
    if (d > unitRangeAt(game, u, ref.x, ref.y) + ATTACK_SLACK) return;
    if (u.minRange && d < u.minRange) return; // 射界死角：太近的建筑同样打不着
    if (!overMountain && losBlocked(game, u.x, u.y, ref.x, ref.y)) return; // 山挡住了 → 看不见建筑（轰击例外）
    const cur = kind === 'f' ? u.targetFac : kind === 'l' ? u.targetLab : u.targetHq;
    // 粘性：当前锁定的目标不吃 40 距离优惠，仅在同等距离时优先
    const score = ref.id === cur ? d - 40 : d;
    if (score < bfd) {
      bfd = score;
      bRef = ref;
      bKind = kind;
    }
  };
  for (const f of game.factories) bear('f', f, FACTORY_R);
  for (const l of game.labs) bear('l', l, LAB_R);
  for (const h of game.hqs) bear('h', h, HQ_R);
  return bRef ? { kind: bKind, id: bRef.id } : null;
}

function unitFire(game, u, target, now) {
  // 燎原不走这里（它持续喷火、没有弹体，见 sprayFlame），所以弹种只剩三种
  const kind = u.splash ? 'shell' : u.range <= MELEE_RANGE ? 'melee' : 'bullet';
  const speed = Math.max(1, u.bulletSpeed || BULLET_SPEED_FALLBACK);
  const ang = Math.atan2(target.y - u.y, target.x - u.x);
  u.turret = ang; // 炮塔朝目标（车体不动）
  const sx = u.x + Math.cos(ang) * (u.r + 4);
  const sy = u.y + Math.sin(ang) * (u.r + 4);
  // 瞄准点不是目标中心，而是碰撞体积（半径 target.r 的圆）上的随机一点。
  // 落点偏到边缘时，爆炸半径就可能把旁边的单位也卷进去 —— 一次发射打到多个单位。
  const aimAng = Math.random() * Math.PI * 2;
  const aimX = target.x + Math.cos(aimAng) * target.r;
  const aimY = target.y + Math.sin(aimAng) * target.r;
  if (kind === 'shell') {
    // 轰击：抛射弹。记录发射点 / 落点，按飞行时间参数化抛物线；它越过山脉、落地才炸。
    // 落点 = 目标碰撞体积上的随机一点（aimX/aimY）。
    // 飞行时长由该兵种 bulletSpeed 决定（地面平面匀速），近距有最短时间兜底。
    const gdx = aimX - sx;
    const gdy = aimY - sy;
    const D = Math.hypot(gdx, gdy);
    const flightDur = Math.max(SHELL_FLIGHT_MIN_MS, (D / speed) * 1000);
    const peak = SHELL_PEAK_BASE + D * SHELL_PEAK_PER_PX;
    game.bullets.push({
      id: game.nextBulletId++,
      x: sx, y: sy, z: 0,
      vx: (gdx / flightDur) * 1000, // 地面平面速度（px/s），仅用于快照朝向
      vy: (gdy / flightDur) * 1000,
      dmg: u.dmg,
      ownerIdx: u.ownerIdx,
      ownerId: u.ownerId,
      shooterId: u.id,
      // 谁打的：客户端据此画「这个兵种的那一款弹」，并按阶数放大弹体
      type: u.type,
      tier: u.tier,
      kind,
      splash: u.splash || 0,
      tx: aimX,
      ty: aimY,
      sx, sy,
      flightDur,
      flightT: 0,
      peak,
      arc: true, // 抛射弹：越过山脉、固定落点、不被追踪
      targetId: 0,
      aimAng,
      born: now,
      dead: false,
    });
    pushShot(game, u, ang, BULLET_KIND_IX[kind] || 0);
    return;
  }
  // 直射弹（bullet）直接瞄向碰撞体积的随机一点（aimX/aimY），不再追踪目标中心；
  // 近战（melee）仍打中心、仍追踪。两者共用同一子弹结构。
  const fireAng = kind === 'bullet' ? Math.atan2(aimY - sy, aimX - sx) : ang;
  const fx = kind === 'bullet' ? aimX : target.x;
  const fy = kind === 'bullet' ? aimY : target.y;
  const tid = kind === 'melee' ? target.id : 0; // 直射弹不追踪（已瞄到落点）；近战仍追踪
  const bSplash = kind === 'melee' ? 0 : BULLET_SPLASH;
  game.bullets.push({
    id: game.nextBulletId++,
    x: sx,
    y: sy,
    vx: Math.cos(fireAng) * speed,
    vy: Math.sin(fireAng) * speed,
    dmg: u.dmg,
    ownerIdx: u.ownerIdx,
    ownerId: u.ownerId,
    shooterId: u.id,
    // 谁打的：客户端据此画「这个兵种的那一款弹」，并按阶数放大弹体
    type: u.type,
    tier: u.tier,
    kind,
    splash: bSplash,
    tx: fx,
    ty: fy,
    targetId: tid,
    aimAng,
    born: now,
    dead: false,
  });
  pushShot(game, u, ang, BULLET_KIND_IX[kind] || 0);
}

/**
 * 各兵种的**炮口前伸系数**：枪口位置 = 碰撞半径 × 该系数。
 *
 * 为什么要有这张表：客户端把炮管画得又大又长之后，枪口焰若仍按「碰撞半径 + 5」定位，
 * 就会从炮管**中段**冒出来 —— 看着像枪在管子中间开火。
 * 早先 2026-10-09 之前所有兵种都是 `r + 5`（≈半格），那是因为炮管一律收在方框内，
 * 炮口本来就在体外一点点；炮管加长后必须跟着改。
 *
 * ⚠️ 必须与客户端 ui.js 里各 draw* 的炮口 x 坐标**同口径**：
 *    那边是「BODY_SPAN[type][tier] 的 x × 该兵种炮口比例」，按视觉倍率缩放后落在同一个世界位置。
 *    改炮管长度时两边一起改，否则枪口焰又会跑偏。
 */
const MUZZLE_K = {
  warrior: 3.1, // 坦克炮：炮口在炮管前端
  shield: 2.6,  // 无炮管，撞角前端（近战无枪口焰，但保持口径一致）
  ranger: 3.4,  // 长管炮：全兵种最远
  burst: 2.4,   // 迫击炮：斜仰，按水平投影估
  burn: 2.9,    // 喇叭口前端
  laser: 3.0,   // 棱镜聚焦点
};

/** 某单位当前的枪口前伸距离（世界像素，沿射击方向） */
function muzzleReach(u) {
  const k = MUZZLE_K[u.type || 'warrior'] || 3;
  return Math.max(u.r + 5, u.r * k);
}
function pushShot(game, u, ang, kindIx) {
  // 枪口位置按兵种的炮口前伸量算（MUZZLE_K）：炮管加长后，
  // 沿用固定的 `r + 5` 会让枪口焰从炮管中段冒出来。
  const reach = muzzleReach(u);
  pushEvent(game, {
    t: 'shot',
    x: round1(u.x + Math.cos(ang) * reach),
    y: round1(u.y + Math.sin(ang) * reach),
    a: round2(ang),
    k: kindIx,
    oi: u.ownerIdx,
    uid: u.id,
    r: Math.round(u.r),
    // 谁开的火（兵种 + 阶数）：客户端据此把枪口焰也按进化等级放大（与弹体同一套倍率）
    ty: u.type || '',
    ti: clamp(u.tier || 1, 1, 3),
  });
}

/** 直射弹命中：推一条 hit 事件（客户端在落点炸出一团不规则墨花，并在地上留弹痕） */
function pushHit(game, b) {
  pushEvent(game, {
    t: 'hit',
    x: round1(b.x),
    y: round1(b.y),
    a: round2(Math.atan2(b.vy, b.vx)),
    k: BULLET_KIND_IX[b.kind] || 0,
    oi: b.ownerIdx,
    id: b.id,
    // 谁打的（兵种 + 阶数）：客户端据此把「命中墨花 / 弹痕」也按进化等级放大，
    // 与弹体本体同一套倍率 —— 三级兵开火就该是一发更大的弹、炸出一团更大的墨。
    ty: b.type || '',
    ti: clamp(b.tier || 1, 1, 3),
  });
}

/**
 * 激光兵当前伤害倍率：锁定同一个目标越久越高。
 * 前摇期间恒为 1 倍，之后**每持续 LASER_RAMP_MS 就 +1 倍**（线性累加，不是翻倍）：
 *     1 倍 → +rampMs → 2 倍 → +2×rampMs → 3 倍 …… 封顶 LASER_MAX_MUL。
 * 例（windup 500 / ramp 500 / max 20）：0.5s 开火 1×、1.0s 2×、2.0s 4×、
 * 9.5s 才吃满 20× —— 所以「咬住不放」是唯一的玩法，换一次目标前功尽弃。
 */
function laserMul(u, now) {
  if (!u.laser || !u.lockStart) return 1;
  const held = now - u.lockStart - LASER_WINDUP_MS;
  if (held <= 0) return 1;
  if (!(LASER_RAMP_MS > 0)) return LASER_MAX_MUL; // 没配爬升时间 = 一锁定就满倍率
  return Math.min(LASER_MAX_MUL, 1 + held / LASER_RAMP_MS);
}

/**
 * lockKey 指向的实体是否仍是合法敌方（不判射程 / 通视）。
 * 用于「暂无射击目标」时决定要不要清掉蓄能：死亡/易主才清，移动清空 target 不清。
 */
function laserLockEntityAlive(game, u) {
  if (!u.lockKey) return false;
  const i = u.lockKey.indexOf(':');
  if (i < 0) return false;
  const kind = u.lockKey.slice(0, i);
  const id = Number(u.lockKey.slice(i + 1));
  if (!Number.isFinite(id)) return false;
  if (kind === 'u') {
    const e = game.units.find((x) => x.id === id && !x.dead);
    return Boolean(e && e.ownerIdx !== u.ownerIdx);
  }
  if (kind === 'fac') {
    const f = game.factories.find((x) => x.id === id);
    return Boolean(f && f.owner !== u.ownerIdx);
  }
  if (kind === 'lab') {
    const l = game.labs.find((x) => x.id === id);
    return Boolean(l && l.owner !== u.ownerIdx);
  }
  if (kind === 'hq') {
    const h = game.hqs.find((x) => x.id === id);
    return Boolean(h && !h.down && h.owner !== u.ownerIdx);
  }
  return false;
}

/**
 * 光束视觉大小系数：**线性于「伤害比基底翻了几倍」**。
 *     sizeMul = 1 + log2(伤害 / visBaseDmg) × visStepPct
 * 默认（基底 1.5 / 每翻倍 +5%）：1.5 → 1.00、3 → 1.05、6 → 1.10、12 → 1.15、24 → 1.20。
 * 用 log2 而不是线性差 —— 伤害是从 1 一路涨到 62.5（三级 × 满倍率）的，线性差的话
 * 三级一开局就把系数吃满，完全看不出「同一条光束随锁定越变越粗」。
 * 低于基底（一级刚锁定只有 1 点伤害）时系数等比缩小，但夹下限免得细到看不见。
 */
function laserVisSizeMul(dmg) {
  const base = LASER_VIS_BASE_DMG > 0 ? LASER_VIS_BASE_DMG : 1.5;
  const dbl = Math.log2(Math.max(0.01, (Number(dmg) || 0) / base));
  return Math.max(0.7, 1 + dbl * LASER_VIS_STEP_PCT);
}

/**
 * 光束视觉细节层数：同一个 log2 值每攒够 visDetailPerDbl 就多解锁一层。
 * 0 层是「素光束」（外晕 + 亮芯 + 两个光斑），往上每层多几笔加绘（电弧 → 行进光球 → 冲击环）。
 */
function laserVisDetail(dmg) {
  const base = LASER_VIS_BASE_DMG > 0 ? LASER_VIS_BASE_DMG : 1.5;
  const dbl = Math.log2(Math.max(0.01, (Number(dmg) || 0) / base));
  if (dbl <= 0) return 0;
  return Math.max(0, Math.min(LASER_VIS_DETAIL_MAX, Math.floor(dbl / LASER_VIS_DETAIL_PER)));
}

/**
 * 激光直击：不走弹道，命中即结算（对单位 / 工厂 / 研究所 / 总部都有效）。
 * 伤害 = 基础伤害 × 当前锁定倍率。命中位置由客户端依据锁定状态自行连线绘制。
 */
function laserZap(game, u, target, now) {
  const mul = laserMul(u, now);
  u.lockMul = mul;
  const dmg = u.dmg * mul;
  const ang = Math.atan2(target.y - u.y, target.x - u.x);
  // 激光是「持续喷吐」武器：开火表现只有命中点的灼痕，不再推 muzzle-flash 式的 shot 事件，
  // 这样炮管不会因为每帧开火判定而抖动（后坐完全由 shot 事件驱动，去掉它即不抖）。
  pushEvent(game, {
    t: 'hit',
    x: round1(target.x - Math.cos(ang) * (target.r || 0)),
    y: round1(target.y - Math.sin(ang) * (target.r || 0)),
    a: round2(ang),
    k: SHOT_KIND_LASER,
    oi: u.ownerIdx,
    // 谁打的（兵种 + 阶数）：激光兵的灼痕同样随进化变大（与光束本体同一套倍率）
    ty: u.type || '',
    ti: clamp(u.tier || 1, 1, 3),
  });
  if (target.kind === 'fac') damageFactory(game, target.ref, dmg, u.ownerIdx);
  else if (target.kind === 'lab') damageLab(game, target.ref, dmg, u.ownerIdx);
  else if (target.kind === 'hq') damageHq(game, target.ref, dmg, u.ownerIdx);
  else {
    target.lastHitBy = u.id;
    retaliate(game, target, u.id);
    damageUnit(game, target, dmg, u.ownerIdx);
  }
}

/**
 * 单位每步推进：索敌 → 移动 → 开火。
 *
 * 设计要点（本轮改动）：
 * - **不自动追击**：`findTarget` 只在「攻击范围 + 少量余量」内锁人；锁不到就原地待命，
 *   绝不会为了敌人自己跑出去（想要追击请右键把部队拉过去）。
 * - **移动攻击**：移动与开火彻底解耦 —— 走指令点的同时，只要目标在攻击范围内就照常开火，
 *   不再有「停下才打」。
 * - 目标离开范围 / 被山挡住 → 停火（激光兵会重置锁定与蓄能），但仍继续走自己的路。
 * - **燎原也按次结算**：`dmg` 是「一口火的伤害」，和其它兵种的「单发伤害」是同一个意思。
 *   它没有弹道，但仍按自己的 `u.cdMax` 一口一口地喷 —— 走 `u.burn` 分支，不走弹道那条 `fire()`。
 */
/**
 * 多点路径（玩家 Shift+右键规划）：走到当前路点后切下一个。
 * 最后一个点走完 → 清空，行为与单点移动指令完全一致（部队就地待命、照常索敌开火）。
 */
function advanceRoute(game, u, now) {
  if (!u.route || !u.route.length) {
    u.route = null;
    u.moveX = null;
    u.moveY = null;
    u.routeAt = 0;
    return;
  }
  u.route.shift();
  if (!u.route.length) {
    u.route = null;
    u.moveX = null;
    u.moveY = null;
    u.routeAt = 0;
    return;
  }
  u.moveX = u.route[0].x;
  u.moveY = u.route[0].y;
  u.routeAt = Number.isFinite(now) ? now : 0;
}

function updateUnits(game, dt, now) {
  // RVO 邻域：用上一帧速度建哈希，本帧 slideStep 里算 ORCA 新速度
  beginRvoFrame(game);
  for (const u of game.units) {
    if (u.dead) continue;
    u._rvoMoved = false; // slideStep 成功挪步后置 true；站桩则速度清零给下一帧 ORCA
    // 本 tick 的车体转动额度（turnHull 里按角速度记账，置空 = 这 tick 还没转过）
    u._turnLeft = null;
    // finally：燎原等分支的 continue 也会清掉幽灵速度，保证下一帧 ORCA 口径正确
    try {
      updateOneUnit(game, u, dt, now);
    } finally {
      if (!u._rvoMoved) {
        u._vx = 0;
        u._vy = 0;
      }
    }
  }
}

/** 单兵本 tick：索敌 / 寻路（含 RVO）/ 开火。由 updateUnits 包在 try/finally 里调。 */
function updateOneUnit(game, u, dt, now) {
    // ⚠️ 残渣（1e-17）必须当成 0：0.5 − 10×0.05 在浮点里是 6.9e-17 而不是 0，
    // 「正好到点」的那一帧判不出 <= 0，所有兵种每次攻击都要**多等一帧** ——
    // cd 0.5 秒实测变成 0.55 秒一口（真实秒伤比 data.js 少一成）。夹掉残渣即回到标称攻速。
    if (u.cdLeft > 0) {
      const left = u.cdLeft - dt;
      u.cdLeft = left > 1e-9 ? left : 0;
    }

    // ---- 周期性索敌（只锁攻击范围内的敌人；没有就清空目标原地待命）----
    if (now >= u.scanAt) {
      u.scanAt = now + SCAN_MS + (u.id % 5) * 20;
      // 追击攻击命令（玩家右键指定）优先：**不论远近都锁定它**。
      // 射程外由下面的「追击」段负责主动赶路；目标死亡 / 易主 / 消失则命令自动解除。
      let resolved = false;
      if (u.manualTarget) {
        const mt = lookupTarget(game, u.ownerIdx, u.manualTarget.kind, u.manualTarget.id);
        if (!mt) {
          u.manualTarget = null; // 目标已亡 / 已易主 / 不存在 → 追击命令解除
        } else {
          u.targetId = mt.kind === 'u' ? mt.id : 0;
          u.targetFac = mt.kind === 'f' ? mt.id : 0;
          u.targetLab = mt.kind === 'l' ? mt.id : 0;
          u.targetHq = mt.kind === 'h' ? mt.id : 0;
          resolved = true;
        }
      }
      if (!resolved) {
        const t = findTarget(game, u);
        u.targetId = t && t.kind === 'u' ? t.id : 0;
        u.targetFac = t && t.kind === 'f' ? t.id : 0;
        u.targetLab = t && t.kind === 'l' ? t.id : 0;
        u.targetHq = t && t.kind === 'h' ? t.id : 0;
      }
    }

    let target = null;
    if (u.targetId) {
      target = game.units.find((e) => e.id === u.targetId && !e.dead) || null;
      if (!target) u.targetId = 0;
    } else if (u.targetFac) {
      const f = game.factories.find((x) => x.id === u.targetFac);
      if (!f || f.owner === u.ownerIdx) {
        u.targetFac = 0; // 已被己方拿下 / 不存在
      } else {
        target = { kind: 'fac', ref: f, id: 0, x: f.x, y: f.y, r: FACTORY_R };
      }
    } else if (u.targetLab) {
      const l = game.labs.find((x) => x.id === u.targetLab);
      if (!l || l.owner === u.ownerIdx) {
        u.targetLab = 0;
      } else {
        target = { kind: 'lab', ref: l, id: 0, x: l.x, y: l.y, r: LAB_R };
      }
    } else if (u.targetHq) {
      const h = game.hqs.find((x) => x.id === u.targetHq);
      if (!h || h.down || h.owner === u.ownerIdx) {
        u.targetHq = 0;
      } else {
        target = { kind: 'hq', ref: h, id: 0, x: h.x, y: h.y, r: HQ_R };
      }
    }

    // 山体遮挡：目标躲到山另一侧后视线断开。
    //  - 自动索敌：立刻放弃（看不到 = 打不到），下一个索敌周期重新评估，走出山影自然重新接战。
    //  - 追击攻击命令：**不解除命令**，保持锁定让部队自己绕过去（下面追击段负责赶路），
    //    只是绕路期间不开火 —— 同一面山不能既挡视线又挡命令。
    // 轰击例外：曲射炮弹道越山，山挡住视线照样能持续轰击。
    const overMountain = Boolean(u.splash);
    let losBlockedNow = false;
    if (target && !overMountain) {
      losBlockedNow = losBlocked(game, u.x, u.y, target.x, target.y);
      if (losBlockedNow && !u.manualTarget) {
        u.targetId = 0;
        u.targetFac = 0;
        u.targetLab = 0;
        u.targetHq = 0;
        target = null;
      }
    }

    // ---- 移动 ----
    // 追击攻击命令：目标在射程外 → 主动寻路接近（不受通用「到点即停」的 26px 阈值影响，
    // 否则射程短的兵种会在射程边缘被判成「已到达」而卡住）。一直追到进射程为止 ——
    // 目标逃跑就跑着追，命令被取消（move/stop）或目标阵亡才停。
    // 其余情况仍只执行玩家指令（集结点派遣 / 右键移动），绝不自动追击。
    if (u.manualTarget) {
      if (target) {
        // 追击时的「够得着」同样要带高低差：站在坡上能更早开火，在洼地要跑更近才打得到
        const reach = unitRangeAt(game, u, target.x, target.y) + target.r;
        const td = dist(u.x, u.y, target.x, target.y);
        // ⚠️ 掉头与减速都在 slideStep 里按「实际迈步方向」判（不是这里的 want）：
        // 追击时流场常常要先绕一段，按终点方向判会和它打架（车头左右摇摆、原地不动）。
        if (td > reach) {
          const spd = u.speed * dt * terrainSpeedFactor(game, u);
          // 单步不超过「距射程边缘的距离」，贴到边缘就停，不会越过目标或绕圈
          const step = Math.min(spd, Math.max(2, td - reach));
          stepViaFlow(game, u, target.x, target.y, step, dt);
        } else if (losBlockedNow) {
          // 已到射程边缘但视线被山挡 → 继续朝目标挤（slideStep 会贴山滑行，
          // 绕到能看见的位置才开火；否则部队会在山后死锁：射程内不动也不打）。
          // 轰击（splash）曲射越山，losBlockedNow 恒 false，不会进这个分支。
          const spd = u.speed * dt * terrainSpeedFactor(game, u);
          stepViaFlow(game, u, target.x, target.y, spd, dt);
        } else if (u.minRange && td - target.r < u.minRange) {
          // 有最小射击半径的兵（轰击）被挤进射界死角 → 主动退到「刚好打得到」的位置。
          // 不这一步的话，右键让它去拆一座工厂，它会一路贴到楼根底下站着一发不发。
          const ux = (u.x - target.x) / (td || 1);
          const uy = (u.y - target.y) / (td || 1);
          const wDist = u.minRange + target.r + 8; // 到中心的距离目标
          const spd = u.speed * dt * terrainSpeedFactor(game, u);
          stepViaFlow(game, u, u.x + ux * (wDist - td + spd), u.y + uy * (wDist - td + spd), spd, dt);
        }
      }
    } else if (u.moveX != null) {
      const md = dist(u.x, u.y, u.moveX, u.moveY);
      // 中途路点放宽到 44px：走的是「路过」而不是「抵达」，卡在这圈里反复微调没意义。
      // 最后一个点仍用 26px —— 那是玩家指定的终点，得站准。
      const wpR = u.route && u.route.length > 1 ? 44 : 26;
      // 兜底：这一段啃了 20 秒还没到（多半是路点落在山另一侧、压根过不去），
      // 丢掉它继续走下一个，别让整条规划链卡死在这里。
      if (u.route && u.route.length > 1 && u.routeAt && now - u.routeAt > 20000) {
        advanceRoute(game, u, now);
      } else if (md <= wpR) {
        advanceRoute(game, u, now);
      } else {
        // 沿地形流场绕开山地与水域抵达指令点（集结点派遣同样走这里）。
        // 掉头 / 边转边走由 slideStep 统一处理：命令指向身后时，车头会先转过去再跑。
        const spd = u.speed * dt * terrainSpeedFactor(game, u);
        if (!stepViaFlow(game, u, u.moveX, u.moveY, spd, dt)) {
          if (md <= wpR + TERR_CELL) advanceRoute(game, u, now);
        }
      }
    }

    // ---- 开火：目标进入攻击范围就打（无论正在移动还是站着）----
    // 追击途中视线被山挡（绕路中）→ 打得着才开火，别穿山打。
    const tDist = target ? dist(u.x, u.y, target.x, target.y) : 0;
    const tReach = target ? unitRangeAt(game, u, target.x, target.y) + target.r : 0;
    // 最小射击半径（仅轰击）：目标贴到射界死角里就打不出去 —— 被近身只能挨打
    const tTooClose = Boolean(target) && Boolean(u.minRange) && tDist - (target.r || 0) < u.minRange;
    const inRange = Boolean(target) && tDist <= tReach && !losBlockedNow && !tTooClose;

    // ---- 炮塔转向：按角速度转，转到位才算瞄上 ----
    // 索敌到目标不会瞬间开火：炮塔先从当前朝向转过去，进入 aimTol 才允许射击
    // （车体照旧留在行进方向上，见 turnHull）。
    const aimAng = target ? Math.atan2(target.y - u.y, target.x - u.x) : u.angle;
    if (inRange) turnTurret(u, aimAng, dt);
    const onTarget = inRange && turretAimed(u, aimAng);

    // 没有目标 / 打不着时炮塔按角速度收回车体朝向（约 0.6s 回正）——
    // 否则打完一波，炮管会一直僵在最后打过的那个方向上，看着像卡住了。
    if (!inRange && u.turret != null) turnTurret(u, u.angle, dt);

    // 燎原：没有弹道，但伤害和其它兵种一样按「次」结算。
    // 只要目标在射程内就一直锁着（客户端据此连续画出这道火舌）；
    // 真正的伤害 / 铺火场按 cd 的节拍走：每 u.cdMax 秒喷一口，一口 = u.dmg 点范围伤害。
    if (u.burn) {
      u.lockKind = onTarget ? (target.kind === 'fac' ? 2 : target.kind === 'lab' ? 3 : target.kind === 'hq' ? 4 : 1) : 0;
      u.lockId = onTarget ? (target.kind ? target.ref.id : target.id) : 0;
      if (onTarget) {
        // 伤害与火场都按攻速结算（每 cdMax 秒一口），不是每步都算
        if (u.cdLeft <= 0) {
          u.cdLeft = u.cdMax;
          // 落点取「朝目标方向推进到目标身上」——目标在射程内，所以这一步不会超出射程
          // 火舌长度同样按「含高低差的射程」算（站得高能喷得远）
          const reach = Math.min(tDist, unitRangeAt(game, u, target.x, target.y) + target.r);
          sprayFlame(game, u, u.x + Math.cos(u.turret) * reach, u.y + Math.sin(u.turret) * reach, now);
        }
      }
      return;
    }

    // 激光兵：维护「锁定」。只有真正进入射程才开始蓄能。
    // 蓄能重置**只**发生在锁上另一个目标时（含首次上锁）。
    // 移动指令会清 target*、扫瞄空隙也会短暂无目标 —— 这些绝不能清掉前功。
    // 旧锁实体死亡/易主后仍暂无新目标时，才把 lockKey 清掉。
    if (u.laser) {
      const key = inRange
        ? (target.kind || 'u') + ':' + (target.kind ? target.ref.id : target.id)
        : '';
      if (key && key !== u.lockKey) {
        u.lockKey = key;
        u.lockStart = now;
        u.windupUntil = now + LASER_WINDUP_MS;
      } else if (!key && u.lockKey && !laserLockEntityAlive(game, u)) {
        u.lockKey = '';
        u.lockStart = 0;
        u.windupUntil = 0;
      }
      u.lockMul = key ? laserMul(u, now) : 1;
      u.lockKind = key
        ? target.kind === 'fac'
          ? 2
          : target.kind === 'lab'
            ? 3
            : target.kind === 'hq'
              ? 4
              : 1
        : 0;
      u.lockId = key ? (target.kind ? target.ref.id : target.id) : 0;
    }

    if (inRange) {
      // ⚠️ 只转炮塔（上面已按角速度转过）：车体留在行进方向上。整只兵扭向目标会让
      // 「正在行军的队伍」看起来边走边原地打转（每一步都被目标方向拽走）。
      // 炮塔没转到位（onTarget 为假）就先不开火 —— 转到位了才打。
      // 激光兵用绝对时间控制射速；其余兵种沿用倒计时（浮点累减会略慢，属既有手感）
      const ready = u.laser ? now >= u.nextFireAt : u.cdLeft <= 0;
      if (ready && onTarget && !(u.laser && now < u.windupUntil)) {
        if (u.laser) {
          laserZap(game, u, target, now);
          u.nextFireAt = now + u.cdMax * 1000;
        } else {
          unitFire(game, u, target, now);
          u.cdLeft = u.cdMax;
        }
      }
    }
}

/* ---------------- 燎原：喷火 / 灼烧地形 ---------------- */

/**
 * 在落点铺开 / 刷新一片灼烧地形。
 *
 * **一级燎原不留火场**：`fireProfile(tier)` 为 null 时直接返回 null，只在火舌落点结算范围伤害。
 *
 * 「火舌每步都在推」意味着每秒有几十个落点，若每个都新铺一块火，场上会瞬间堆出几百块。
 * 所以同一个主人的相近落点（≤ mergeD）**并入已有火场**，只把寿命推回满值；
 * 火舌跟着目标走远了，才会在更远处新铺一块 —— 于是画面上是一条连着的火线，而不是一堆火点。
 * 每片火场记下自己的 r/dps/lifeMs（不同阶数的火场可以同时在场）；
 * 跨阶合并时逐项取强的一方 —— 三级燎原扫过二级留下的火区，那片火会整体升级。
 * 每次刷新都把 `until` 推回 `now + lifeMs`：火焰一直喷，火就一直烧；
 * 火焰一停，最后一次刷新过后 lifeMs（几秒）内火场自然熄灭 —— 这就是「消失」的来源。
 *
 * @param {number} [tier=2] 喷火者的阶数（一级不留火场）
 * @returns {object|null} 新建的火场（不留火场 / 并入已有火场时返回 null）
 */
function addFire(game, x, y, ownerIdx, now, tier) {
  const prof = fireProfile(tier == null ? 2 : tier);
  if (!prof) return null; // 一级燎原：只喷火，不在地上留火
  let best = null;
  let bestD = Infinity;
  for (const f of game.fires) {
    if (f.owner !== ownerIdx) continue;
    const d = dist(f.x, f.y, x, y);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  if (best && bestD <= Math.max(best.mergeD || 0, prof.mergeD)) {
    // 并入已有火场：逐项取强（同级通常相同；被更高阶的火扫过时整片升级）
    best.r = Math.max(best.r, prof.r);
    best.dps = Math.max(best.dps || 0, prof.dps);
    best.lifeMs = Math.max(best.lifeMs || 0, prof.lifeMs);
    best.mergeD = Math.max(best.mergeD || 0, prof.mergeD);
    best.until = Math.max(best.until, now + best.lifeMs);
    return null;
  }
  const f = {
    id: game.nextFireId++,
    x: round1(x),
    y: round1(y),
    r: prof.r,
    dps: prof.dps,
    lifeMs: prof.lifeMs,
    mergeD: prof.mergeD,
    owner: ownerIdx,
    born: now,
    until: now + prof.lifeMs,
  };
  game.fires.push(f);
  if (game.fires.length > FIRE_MAX) game.fires.splice(0, game.fires.length - FIRE_MAX);
  return f;
}

/**
 * 一口火（燎原的一次攻击）：由 updateUnits 按 `u.cdMax` 的节拍调用，一次一份伤害。
 *
 * ① 落点范围伤害：`FLAME_R` 内的一切**敌方**单位一次掉 `u.dmg` 点血（山挡住的打不到）。
 *    和其它兵种一样按「次」结算 —— 没有弹道、没有命中判定，也不乘 dt，
 *    **每秒期望伤害 = dmg / cd**。各阶都一样：火焰本身就会烧人，
 *    **留不留灼烧地形才是分阶的地方**。
 *    ⚠️ 伤害**离中心越远越低**：压在落点上吃满 dmg，站在火舌外沿只剩 `flame.edgeMul` 倍
 *    （线性过渡，见 flameFalloff）。所以挤成一团挨喷比散开站远一点疼得多。
 * ② 落点范围内的**敌方建筑**（工厂 / 研究所 / 总部）同样按这一份伤害掉血 —— 这是「直接打击」，
 *    与炮击溅射同规则（自家建筑免疫、山挡住打不到）。注意：只有火舌**直接烧到**才结算，
 *    地上那片灼烧地形对建筑完全无效（见 updateFires）。
 * ③ 在落点铺开 / 刷新一片灼烧地形 —— 只有**二级及以上**才铺（见 FIRE_TIERS）。
 * ④ 表现：推一条 flame 事件，客户端在落点演一次爆焰（一口火一次，不会糊成一片）。
 *    连续的火舌本体由客户端按下发锁定自己画，与这次结算无关。
 */
function sprayFlame(game, u, x, y, now) {
  const dmg = u.dmg;
  if (dmg > 0) {
    for (const e of game.units) {
      if (e.dead || e.ownerIdx === u.ownerIdx) continue;
      const gap = Math.max(0, dist(e.x, e.y, x, y) - e.r); // 到目标最近边缘的距离
      if (gap > FLAME_R) continue;
      if (losBlocked(game, u.x, u.y, e.x, e.y)) continue;
      e.lastHitBy = u.id;
      retaliate(game, e, u.id);
      damageUnit(game, e, dmg * flameFalloff(gap), u.ownerIdx);
    }
    // 火舌直接烧到建筑才算数：工厂 / 研究所 / 总部按同一份伤害掉血（规则同炮击溅射）
    for (const f of game.factories) {
      if (f.owner === u.ownerIdx) continue;
      const gap = Math.max(0, dist(f.x, f.y, x, y) - FACTORY_R);
      if (gap > FLAME_R) continue;
      if (losBlocked(game, u.x, u.y, f.x, f.y)) continue;
      damageFactory(game, f, dmg * flameFalloff(gap), u.ownerIdx);
    }
    for (const l of game.labs) {
      if (l.owner === u.ownerIdx) continue;
      const gap = Math.max(0, dist(l.x, l.y, x, y) - LAB_R);
      if (gap > FLAME_R) continue;
      if (losBlocked(game, u.x, u.y, l.x, l.y)) continue;
      damageLab(game, l, dmg * flameFalloff(gap), u.ownerIdx);
    }
    for (const h of game.hqs) {
      if (h.owner === u.ownerIdx || h.down) continue;
      const gap = Math.max(0, dist(h.x, h.y, x, y) - HQ_R);
      if (gap > FLAME_R) continue;
      if (losBlocked(game, u.x, u.y, h.x, h.y)) continue;
      damageHq(game, h, dmg * flameFalloff(gap), u.ownerIdx);
    }
  }
  const born = addFire(game, x, y, u.ownerIdx, now, u.tier);
  if (born) pushEvent(game, { t: 'flame', x: born.x, y: born.y, r: born.r, oi: u.ownerIdx, id: born.id });
  // 燎原的火舌每口都在落点演一次爆焰（flame 事件），足够了 ——
  // 不再额外周期推 shot 事件打出一顿一顿的枪口焰，免得炮管看着一直在抖。
}

/**
 * 灼烧地形结算：站在火里的一切单位都掉血 —— **不分敌我**（这是全局唯一的友伤来源）。
 *
 * **只烧单位，不烧建筑**：火场烧不掉工厂 / 研究所 / 总部 —— 建筑只吃火舌的「直接打击」
 * （见 sprayFlame），地上的余火对它们无效。燎原想拆建筑，就得把火舌喷在建筑身上。
 *
 * 每秒伤害取每片火自己的 `f.dps`（二级 3.5 / 三级 6 —— 三级燎原烧出来的火更疼）。
 * 顺带维护 `u.burning`：客户端只凭这一个标记决定「身上要不要画火苗」，
 * 所以每步先全部清掉、再按本步位置重新打标（火场是移动的，不能只加不减）。
 */
function updateFires(game, dt, now) {
  for (const u of game.units) if (!u.dead) u.burning = false;
  if (!game.fires.length) return;
  for (let i = game.fires.length - 1; i >= 0; i--) {
    const f = game.fires[i];
    if (f.until <= now) {
      game.fires.splice(i, 1); // 火焰停了有一会儿了 → 火场熄灭
      continue;
    }
    const dps = f.dps == null ? FIRE_TIERS[1].dps : f.dps;
    for (const u of game.units) {
      if (u.dead) continue;
      if (dist(u.x, u.y, f.x, f.y) > f.r + u.r) continue;
      u.burning = true;
      damageUnit(game, u, dps * dt, f.owner); // 敌我通吃：自家部队踩上去一样烧
    }
  }
}

function damageUnit(game, victim, amount, killerIdx) {
  if (victim.dead || amount <= 0) return;
  const amt = amount; // 地形不再影响伤害（林地已移除）
  victim.hp -= amt;
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.dead = true;
    victim.killerIdx = killerIdx;
    pushEvent(game, { t: 'kill', vi: victim.ownerIdx, ki: killerIdx, x: round1(victim.x), y: round1(victim.y), tier: victim.tier });
  }
}

/**
 * 受击反击：被攻击且处于空闲的单位立即锁定攻击者。
 * 只在攻击者「已经进入我方攻击范围」时才锁定 —— 不再自动追出范围
 * （追出去只会被远程兵白嫖）；范围外的攻击者等它自己走进来再打。
 */
function retaliate(game, victim, shooterId) {
  if (!shooterId || victim.targetId || victim.moveX != null || victim.dead) return;
  const shooter = game.units.find((u) => u.id === shooterId && !u.dead);
  if (!shooter || shooter.ownerIdx === victim.ownerIdx) return;
  if (dist(victim.x, victim.y, shooter.x, shooter.y) > unitRangeAt(game, victim, shooter.x, shooter.y) + shooter.r + ATTACK_SLACK) return;
  // 被山挡住的敌人不还击（看不见对方，还击只会让部队朝山体扎堆）
  if (losBlocked(game, victim.x, victim.y, shooter.x, shooter.y)) return;
  victim.targetId = shooter.id;
}

function explodeShell(game, b, x, y, now, overMountain) {
  b.dead = true;
  // r = 溅射半径（随阶数 30 → 45 → 60px）；ty/ti 让客户端把落点墨花与弹痕也按阶放大
  pushEvent(game, {
    t: 'boom',
    x: round1(x),
    y: round1(y),
    r: b.splash,
    oi: b.ownerIdx,
    ty: b.type || '',
    ti: clamp(b.tier || 1, 1, 3),
  });
  // 溅射不越山（默认）：山脊另一侧的敌人不该被「隔山」炸到。
  // 但抛射弹（轰击）是飞越山脉落到落点的，落点那一侧的敌人理应被炸到 —— overMountain 时跳过 LOS。
  const sightOk = (ax, ay, bx, by) => overMountain || !losBlocked(game, ax, ay, bx, by);
  for (const e of game.units) {
    if (e.dead || e.ownerIdx === b.ownerIdx) continue;
    const d = dist(e.x, e.y, x, y);
    if (d > b.splash + e.r) continue;
    if (!sightOk(x, y, e.x, e.y)) continue;
    e.lastHitBy = b.shooterId || 0;
    retaliate(game, e, b.shooterId);
    // 溅射同样**随离落点的距离衰减**（中心吃满 → 边缘只剩 BURST_EDGE_MUL，见 splashFalloff）：
    // 挤成一团的人吃满伤，蹭到边上的只掉一点血 —— 队形越密，一发炮越值。
    damageUnit(game, e, b.dmg * splashFalloff(Math.max(0, d - e.r), b.splash), b.ownerIdx);
  }
  // 炮击同样会砸伤范围内的敌方建筑（工厂 / 研究所 / 总部）
  for (const f of game.factories) {
    if (f.owner === b.ownerIdx) continue;
    const d = dist(f.x, f.y, x, y);
    if (d <= b.splash + FACTORY_R && sightOk(x, y, f.x, f.y)) {
      damageFactory(game, f, b.dmg * splashFalloff(Math.max(0, d - FACTORY_R), b.splash), b.ownerIdx);
    }
  }
  for (const l of game.labs) {
    if (l.owner === b.ownerIdx) continue;
    const d = dist(l.x, l.y, x, y);
    if (d <= b.splash + LAB_R && sightOk(x, y, l.x, l.y)) {
      damageLab(game, l, b.dmg * splashFalloff(Math.max(0, d - LAB_R), b.splash), b.ownerIdx);
    }
  }
  for (const h of game.hqs) {
    if (h.owner === b.ownerIdx || h.down) continue;
    const d = dist(h.x, h.y, x, y);
    if (d <= b.splash + HQ_R && sightOk(x, y, h.x, h.y)) {
      damageHq(game, h, b.dmg * splashFalloff(Math.max(0, d - HQ_R), b.splash), b.ownerIdx);
    }
  }
}

function updateBullets(game, dt, now) {
  for (const b of game.bullets) {
    if (b.dead) continue;

    // ---- 抛射弹（轰击）：抛物线飞行，越过山脉，落地才炸 ----
    // 不追踪、不撞山、不提前炸——整段飞行只做「插值地面位置 + 算高度」，到时定点引爆。
    if (b.arc) {
      b.flightT += dt * 1000;
      const tt = b.flightDur > 0 ? clamp(b.flightT / b.flightDur, 0, 1) : 1;
      b.x = b.sx + (b.tx - b.sx) * tt;
      b.y = b.sy + (b.ty - b.sy) * tt;
      b.z = 4 * b.peak * tt * (1 - tt); // 抛物线：t=0/1 时 z=0，t=0.5 时达峰值 peak
      if (b.flightT >= b.flightDur || b.x < -20 || b.x > WORLD_W + 20 || b.y < -20 || b.y > WORLD_H + 20) {
        explodeShell(game, b, b.tx, b.ty, now, true); // 越山落点，溅射同样不受山体遮挡
      }
      // ⚠️ 必须是 continue：早先这里写成 return，结果只要天上有一发抛射弹，
      // 本帧排在它后面的所有弹（锐士/盾卫/游侠的直射弹）一步都不推进，
      // 连函数末尾的「清理 + 400 上限」也被整帧跳过 —— 弹道卡顿且弹体数组只增不减。
      continue;
    }

    // 弹速可以很高（data.js 里锐士 / 盾卫写到了 9999px/s）——按 10Hz 步进时它一步就能
    // 飞出 500px，直接从目标身上跨过去，命中判定永远落不到人身上（形同打不中）。
    // 所以按「每小步位移不超过 BULLET_SUBSTEP_PX」把这一帧切成若干小步，逐小步判定。
    const spd0 = Math.hypot(b.vx, b.vy) || 0;
    const subs = clamp(Math.ceil((spd0 * dt) / BULLET_SUBSTEP_PX), 1, 16);
    const sdt = dt / subs;
    for (let s = 0; s < subs && !b.dead; s++) stepBullet(game, b, sdt, now);
  }
  game.bullets = game.bullets.filter((b) => !b.dead);
  if (game.bullets.length > 400) game.bullets.splice(0, game.bullets.length - 400);
}

/**
 * 线段 (x1,y1)→(x2,y2) 与圆 (cx,cy,r) 是否相交：相交返回最近点的参数 t∈[0,1]，否则 -1。
 *
 * ⚠️ 弹道命中**必须按线段判**，不能只看「这一小步走完停在圆内」：
 *    锐士/盾卫的弹速写到了 9999px/s，dt=0.1（TICK_MS=100）时一小步就走 62px，
 *    而命中半径只有十几 px —— 点采样会直接跨过目标（实测 110px 外命中率 0%，
 *    见 smoke/_hitprobe.js）。撞山那条早就用线段采样了（mountainHitAlong），命中也一样。
 */
function segCircleT(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((cx - x1) * dx + (cy - y1) * dy) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const px = x1 + dx * t;
  const py = y1 + dy * t;
  return Math.hypot(cx - px, cy - py) <= r ? t : -1;
}

/** 单发弹体走一小步（位移 + 撞山 + 命中）；由 updateBullets 按细分步数循环调用 */
function stepBullet(game, b, dt, now) {
  {
    const ox = b.x;
    const oy = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // 山体有高度：弹道撞山即止。细分采样整段位移，避免 10Hz 下「一步跨过」山脊。
    // 炮击在坡面炸开（溅射同样不越山），直射弹撞山只是一个墨点。水面不挡弹道。
    {
      const segLen = Math.hypot(b.x - ox, b.y - oy);
      const hitS = segLen > 0 ? mountainHitAlong(game, ox, oy, b.x, b.y, { step: BULLET_TERRAIN_STEP }) : -1;
      if (hitS >= 0) {
        const ix = ox + ((b.x - ox) / segLen) * hitS;
        const iy = oy + ((b.y - oy) / segLen) * hitS;
        if (b.kind === 'shell') {
          explodeShell(game, b, ix, iy, now, false);
        } else {
          b.dead = true;
          pushEvent(game, { t: 'spark', x: round1(ix), y: round1(iy) });
        }
        return;
      }
    }

    // 非炮击弹道轻微追踪目标，保证命中率
    if (b.targetId) {
      const t = game.units.find((e) => e.id === b.targetId && !e.dead);
      if (t) {
        const spd = Math.hypot(b.vx, b.vy) || BULLET_SPEED_FALLBACK;
        const ang = Math.atan2(t.y - b.y, t.x - b.x);
        b.vx = Math.cos(ang) * spd;
        b.vy = Math.sin(ang) * spd;
      }
    }

    // 寿命 / 出界
    if (now - b.born > BULLET_LIFE_MS || b.x < -20 || b.x > WORLD_W + 20 || b.y < -20 || b.y > WORLD_H + 20) {
      b.dead = true;
      return;
    }

    if (b.kind === 'shell') {
      // 到达预定落点或撞到敌人即爆
      const movedPast = (b.vx * (b.x - b.tx) + b.vy * (b.y - b.ty)) > 0;
      let hitEnemy = false;
      for (const e of game.units) {
        if (e.dead || e.ownerIdx === b.ownerIdx) continue;
        if (segCircleT(ox, oy, b.x, b.y, e.x, e.y, e.r + BULLET_R + 2) >= 0) {
          hitEnemy = true;
          break;
        }
      }
      if (movedPast || hitEnemy) {
        explodeShell(game, b, b.tx, b.ty, now, false);
      }
      return;
    }

    // 带爆炸半径的弹（直射弹 / 非越山炮击）：命中或越过落点即爆。
    // 子弹本身已瞄向目标碰撞体积上的随机一点，所以落点偏到边缘时，爆炸半径就可能把旁边的单位也卷进去。
    if (b.splash > 0) {
      const movedPast = (b.vx * (b.x - b.tx) + b.vy * (b.y - b.ty)) > 0;
      let hitSomething = false;
      for (const e of game.units) {
        if (e.dead || e.ownerIdx === b.ownerIdx) continue;
        if (segCircleT(ox, oy, b.x, b.y, e.x, e.y, e.r + BULLET_R + 2) >= 0) {
          hitSomething = true;
          break;
        }
      }
      if (movedPast || hitSomething) {
        // ⚠️ 越过落点时必须在**瞄的那个点**炸，不能在「走完这一步后的位置」炸：
        //    一帧飞 1000px 时那个位置离目标可能差 60px，而溅射半径才 18px —— 等于白打一发。
        const ex = movedPast ? b.tx : b.x;
        const ey = movedPast ? b.ty : b.y;
        explodeShell(game, b, ex, ey, now, false);
      }
      return;
    }

    // 近战（无爆炸半径）：命中单体
    for (const e of game.units) {
      if (e.dead || e.ownerIdx === b.ownerIdx) continue;
      if (segCircleT(ox, oy, b.x, b.y, e.x, e.y, e.r + BULLET_R) >= 0) {
        b.dead = true;
        pushHit(game, b);
        e.lastHitBy = b.shooterId || 0;
        retaliate(game, e, b.shooterId);
        damageUnit(game, e, b.dmg, b.ownerIdx);
        break;
      }
    }

    // 没打到单位 → 检查是否命中敌方建筑（工厂 / 研究所 / 总部 都是合法攻击目标）
    if (!b.dead) {
      for (const f of game.factories) {
        if (f.owner === b.ownerIdx) continue;
        if (segCircleT(ox, oy, b.x, b.y, f.x, f.y, FACTORY_R + BULLET_R) >= 0) {
          b.dead = true;
          pushHit(game, b);
          damageFactory(game, f, b.dmg, b.ownerIdx);
          break;
        }
      }
    }
    if (!b.dead) {
      for (const l of game.labs) {
        if (l.owner === b.ownerIdx) continue;
        if (segCircleT(ox, oy, b.x, b.y, l.x, l.y, LAB_R + BULLET_R) >= 0) {
          b.dead = true;
          pushHit(game, b);
          damageLab(game, l, b.dmg, b.ownerIdx);
          break;
        }
      }
    }
    if (!b.dead) {
      for (const h of game.hqs) {
        if (h.owner === b.ownerIdx || h.down) continue;
        if (segCircleT(ox, oy, b.x, b.y, h.x, h.y, HQ_R + BULLET_R) >= 0) {
          b.dead = true;
          pushHit(game, b);
          damageHq(game, h, b.dmg, b.ownerIdx);
          break;
        }
      }
    }
  }
}

/* ---------------- 分离 / 尸体清理 ---------------- */

/** 单位圆形分离 + 不穿过工厂建筑 + 边界约束 */
function separateUnits(game) {
  const list = game.units.filter((u) => !u.dead);
  // 单位↔单位：RVO 已在移动时半责任让开；这里只处理**已经重叠**的硬穿透
  // （ORCA 时间域约束在极密时仍可能叠一点），推开量减半以免和 RVO 抢方向。
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
      const push = ((min - d) / 2) * (RVO_ENABLED ? 0.55 : 1);
      const ux = dx / d;
      const uy = dy / d;
      // 推挤不能把单位塞进不可通行的地形（山/水）：被挡的一侧保持原位，宁可重叠
      moveIfPassable(game, a, a.x - ux * push, a.y - uy * push);
      moveIfPassable(game, b, b.x + ux * push, b.y + uy * push);
    }
    const u = list[i];
    // 工厂建筑推挤
    for (const f of game.factories) {
      const d = dist(u.x, u.y, f.x, f.y);
      const min = FACTORY_R + u.r;
      if (d < min) {
        if (d < 0.001) {
          moveIfPassable(game, u, f.x + min, u.y);
        } else {
          moveIfPassable(game, u, f.x + ((u.x - f.x) / d) * min, f.y + ((u.y - f.y) / d) * min);
        }
      }
    }
    for (const l of game.labs) {
      const d = dist(u.x, u.y, l.x, l.y);
      const min = LAB_R + u.r;
      if (d < min && d > 0.001) {
        moveIfPassable(game, u, l.x + ((u.x - l.x) / d) * min, l.y + ((u.y - l.y) / d) * min);
      }
    }
    for (const h of game.hqs) {
      if (h.down) continue;
      const d = dist(u.x, u.y, h.x, h.y);
      const min = HQ_R + u.r;
      if (d < min) {
        if (d < 0.001) {
          moveIfPassable(game, u, h.x + min, u.y);
        } else {
          moveIfPassable(game, u, h.x + ((u.x - h.x) / d) * min, h.y + ((u.y - h.y) / d) * min);
        }
      }
    }
    // 世界边界钳制（同样受地形约束，避免把贴边单位钳进障碍格）
    moveIfPassable(game, u, clamp(u.x, u.r, WORLD_W - u.r), clamp(u.y, u.r, WORLD_H - u.r));
  }
}

/**
 * 兜底脱困：任何仍站在不可通行地形上的单位，朝最近的可通行格挪一小步。
 * 主动移动/推挤都已做地形判定，这里只防止「异常状态被永久保留」。
 */
function unstickAll(game) {
  let n = 0;
  for (const u of game.units) {
    if (u.dead) continue;
    if (terrainPassable(game, u.x, u.y)) continue;
    const goal = nearestPassable(game, u.x, u.y);
    if (!goal) continue;
    const d = dist(u.x, u.y, goal.x, goal.y);
    if (d < 0.001) continue;
    const ang = Math.atan2(goal.y - u.y, goal.x - u.x);
    const step = Math.min(u.r, d);
    u.x += Math.cos(ang) * step;
    u.y += Math.sin(ang) * step;
    n += 1;
  }
  return n;
}

/** 战损记账：阵亡数记给持有者、击杀数记给凶手。reapDead 与「出局清场」共用同一份口径。 */
function tallyDead(game, dead) {
  for (const u of dead) {
    const victim = game.players[u.ownerIdx];
    if (victim) victim.losses += 1;
    const ki = u.killerIdx;
    if (ki != null && ki >= 0 && ki !== u.ownerIdx && game.players[ki]) {
      game.players[ki].kills += 1;
    }
  }
}

function reapDead(game) {
  const dead = game.units.filter((u) => u.dead);
  if (!dead.length) return 0;
  tallyDead(game, dead);
  game.units = game.units.filter((u) => !u.dead);
  return dead.length;
}

/* ---------------- 胜负 ---------------- */

function updateOutcome(game) {
  let dirty = false;
  // 出局判定：总部被打光（damageHq 里已置 eliminated），这里负责清场与释放名下建筑
  for (let i = 0; i < game.players.length; i++) {
    const p = game.players[i];
    if (!p.eliminated || p.left) continue;
    if (p._cleared) continue;
    p._cleared = true;
    for (const f of game.factories) {
      if (f.owner !== i) continue;
      f.owner = -1;
      f.capProg = 0;
      f.capBy = -1;
      f.rally = null;
      resetSlots(f); // 出局 / 退出：产线一并重置成一条一级线
      f.lastHitBy = -1;
      clearDmgBook(f);
      f.hp = Math.round(FACTORY_HP * NEUTRAL_HP_RATIO); // 转为中立 → 只有 1/3 血量
    }
    for (const l of game.labs) {
      if (l.owner !== i) continue;
      l.owner = -1;
      l.lastHitBy = -1;
      l.lines = 0; // ⚠️ 和 damageLab 保持一致：易主就清产线，否则接手的人白拿已开的科技线
      clearDmgBook(l);
      l.hp = Math.round(LAB_HP * NEUTRAL_HP_RATIO);
    }
    const cleared = [];
    for (const u of game.units) {
      if (u.ownerIdx === i) {
        u.dead = true;
        cleared.push(u);
      }
    }
    // ⚠️ 清场杀掉的兵也要记战损：reapDead 本帧已经跑过了，这里直接 filter 会让这批兵
    //    既不记己方阵亡也不记对手击杀（一局末往往几十个单位，记分板明显偏小）。
    tallyDead(game, cleared);
    game.units = game.units.filter((u) => !u.dead);
    pushEvent(game, { t: 'elim', oi: i });
    dirty = true;
  }
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
  // 易主 / 总部陷落由「打光血量」触发，这里统计本次步进内的次数。
  // ⚠️ 只能在**步进末尾**清：玩家指令（花科技点等）是在 step 之外打这个标记的，
  //    在开头清等于把上一次指令留下的脏标记直接抹掉，客户端要等到下一次有人阵亡才刷新。
  dt = Math.min(dt, MAX_DT);
  game.now = now; // 伤害账本 / 维修时间戳共用
  game._flowBudget = flowBudgetFor(game); // 本步允许新建的寻路流场数（按在场单位数派生）
  updateResearch(game, dt);
  updateHqDefense(game, dt, now); // 第 6 项：总部防卫（前摇 → 开火）
  updateProduction(game, dt, now);
  updateFactories(game, dt, now);
  updateUnits(game, dt, now);
  updateBullets(game, dt, now);
  updateFires(game, dt, now);
  separateUnits(game);
  unstickAll(game);
  const kills = reapDead(game);
  const outcomeDirty = updateOutcome(game);
  const captured = game._captures || 0;
  game._captures = 0; // 读完即清（见步进开头那条注释）
  return captured > 0 || kills > 0 || outcomeDirty;
}

function tick(game) {
  const now = Date.now();
  let dt = (now - game._lastTick) / 1000;
  game._lastTick = now;
  // 地形编辑器停在 edit 阶段、战前停在 briefing 阶段：两者一样，一帧都不推进 ——
  // 部队不许走、产线不许转、总部防卫不许开火。
  // ⚠️ _lastTick 照常更新：否则恢复那一帧 dt 会攒成好几秒，直接瞬移一大段。
  if (game.paused || game.phase === 'edit' || game.phase === 'briefing') {
    game.seq += 1;
    return false;
  }
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

/** 产线 → 快照紧凑表示：[兵种下标, 出厂阶数, 分支(0 未定 / 1 A / 2 B)] */
function slotToRow(s) {
  return [TYPE_IX[s.type] || 0, clamp(Math.round(s.tier || 1), 1, 3), s.branch === 'A' ? 1 : s.branch === 'B' ? 2 : 0];
}

function snapshot(game) {
  const now = Date.now();
  // 第 9 项：每条产线此刻「还在场的兵」数（客户端据此显示 n/产线上限、并列出该线的兵）
  const lineAlive = lineAliveMap(game);
  /** 建筑 key + 产线序号 → 在场兵数；缺 key 时按 0 处理（快照容错） */
  const aliveRow = (base, b) => syncSlots(b).map((_, i) => lineAlive.get(base + ':' + i) || 0);
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
      u.burning ? 1 : 0, // 站在灼烧地形里（客户端画身上的火苗）
      u.homeFac || 0, // 产出该单位的工厂（0 = 总部亲兵）；侧栏统计「可进化部队」用
      // —— 锁定目标（激光兵：正在照射的目标 / 燎原：正在喷吐的火舌落点），其余兵种恒为 0 ——
      u.laser || u.burn ? u.lockKind : 0, // 锁定目标类别：0 无 / 1 单位 / 2 工厂 / 3 研究所 / 4 总部
      u.laser || u.burn ? u.lockId : 0, // 锁定目标 id
      u.laser ? Math.round(u.lockMul * 100) : 0, // 当前伤害倍率 ×100（100 = 1 倍）
      u.laser && u.windupUntil > now ? Math.round(u.windupUntil - now) : 0, // 前摇剩余毫秒（>0 表示蓄能中）
      // —— 追击攻击命令（玩家右键指定）：类别 0 = 无命令 / 1 单位 / 2 工厂 / 3 研究所 / 4 总部 ——
      // 客户端据此在目标处常驻一个锁定指示（命令解除时自动消失），追击途中玩家也能看见打谁。
      u.manualTarget ? TARGET_KIND_IX[u.manualTarget.kind] || 0 : 0,
      u.manualTarget ? u.manualTarget.id : 0,
      // 第 9 项：出生自第几条产线（0 = 第 1 条）—— 只要它还在场，就占着这条线的一个名额，
      // 客户端据此「一条线的兵一个不漏地找出来」（工厂面板一键选中 / 中栏按线列兵）。
      clamp(Math.round(u.lineIdx || 0), 0, FAC_MAX_LINES - 1),
      // —— 炮塔角（与车体角分离：车体朝行进方向，炮塔朝攻击方向）——
      // 追加在末尾，避免把上面 19 列的下标整体挤位（客户端 / mobile 副本按位取值）。
      round2(u.turret == null ? u.angle : u.turret),
    ]),
    b: game.bullets.map((b) => {
      const sp = Math.hypot(b.vx, b.vy) || 1;
      return [
        round1(b.x),
        round1(b.y),
        b.ownerIdx,
        BULLET_KIND_IX[b.kind] || 0,
        // 弹体朝向（单位向量）：客户端按它把弹丸画成「沿弹道拖笔的墨滴」而不是圆点
        round2(b.vx / sp),
        round2(b.vy / sp),
        // 个体随机种子（由弹体 id 稳定派生）：每发子弹的炸开/拖尾形状各不相同，
        // 但同一发每帧一致 —— 否则 10Hz 刷新会把它闪成一团砂。
        Math.round(((b.id % 97) / 97) * 100) / 100,
        // 抛射弹（轰击）：当前高度 z（px，0 表示贴地/已落地）+ 是否抛射弹 arc。
        // 客户端据此把轰击弹「抬高本体 + 画地面阴影 + 落点虚线圈」，呈现越山抛物线。
        round1(b.z || 0),
        b.arc ? 1 : 0,
        // —— 谁打的：兵种序号 + 阶数（0/undefined 视作一阶）——
        // 每个兵种一套弹型，并随进化把弹体放大。老快照缺这两列时客户端退回按弹种画。
        TYPE_IX[b.type] || 0,
        clamp(b.tier || 1, 1, 3),
      ];
    }),
    // 工厂：[id, 归属, 占领进度, 占领者, 生产进度, 争夺中, 当前血量, 进化冷却, 产线数, 各产线配置]
    f: game.factories.map((f) => [
      f.id,
      f.owner,
      Math.round(f.capProg),
      f.capBy,
      round2(f.prodProg),
      f.contested ? 1 : 0,
      Math.round(f.hp), // 工厂当前血量（打光即易主）
      Math.round(f.evoCd || 0), // 产线进化冷却剩余（毫秒）
      clamp(Math.round(f.lines || 1), 1, FAC_MAX_LINES), // 产线数（1..3）：并行生产
      syncSlots(f).map(slotToRow), // 每条产线：[兵种, 出厂阶数, 分支]
      // 第 9 项：每条产线此刻「还在场的兵」数（一条线最多 LINE_UNIT_CAP 个，越多这条线越慢）
      aliveRow(facLineKey(f.id), f),
    ]),
    // 研究所：[id, 归属, 当前血量, 满血, 已开拓的研究产线数]（同样是打光即易主，易主后产线清零）
    lb: game.labs.map((l) => [
      l.id,
      l.owner,
      Math.round(l.hp),
      Math.round(l.hpMax),
      clamp(Math.round(l.lines || 0), 0, LAB_MAX_LINES), // 第 7 项：0 或 1
    ]),
    // 总部：[id, 归属, 当前血量, 满血, 是否已陷落, 进化冷却剩余, 生产加速等级,
    //        生产进度, 产线数, 各产线配置]（总部也出兵，但产线不可进化）
    hq: game.hqs.map((h) => [
      h.id,
      h.owner,
      Math.round(h.hp),
      Math.round(h.hpMax),
      h.down ? 1 : 0,
      Math.round(h.evoCd || 0),
      clamp(Math.round(h.speedLv || 0), 0, PROD_SPEED_MAX),
      round2(h.prodProg || 0),
      clamp(Math.round(h.lines || 1), 1, FAC_MAX_LINES),
      syncSlots(h).map(slotToRow),
      // 第 6 项：总部防卫状态 —— 锁定目标 id + 前摇剩余毫秒 + 目标类别（1 单位 / 2 厂 / 3 所 / 4 总部）
      h.atkId || 0,
      h.atkWindup > now ? Math.round(h.atkWindup - now) : 0,
      // 第 9 项：总部每条产线此刻还在场的兵数（与工厂同规则：满额即停产）
      aliveRow(hqLineKey(game, h), h),
      h.atkKind || 0,
    ]),
    // 科技点：与 players 同序（左上角 HUD / 记分牌用）
    rp: game.players.map((p) => Math.round(p.rp)),
    // 距下次研究点结算的进度（累积毫秒，0..RP_PERIOD_MS）：客户端画「下次 +N」进度条用
    rpAcc: game.players.map((p) => Math.round(p.rpAccMs || 0)),
    // 兵力：与 players 同序（右上角兵力上限提示用）
    uc: game.players.map((_, i) => unitCountOf(game, i)),
    // 集结点（仅下发已设置的，绝大多数时候为空数组）：[工厂id, x, y]
    r: game.factories
      .filter((f) => f.rally)
      .map((f) => [f.id, Math.round(f.rally.x), Math.round(f.rally.y)]),
    // 第 4 项：总部集结点（同样只下发已设置的）：[总部id, x, y]
    hr: game.hqs
      .filter((h) => h.rally)
      .map((h) => [h.id, Math.round(h.rally.x), Math.round(h.rally.y)]),
    // 灼烧地形（燎原喷出的火场）：[x, y, 半径, 剩余寿命毫秒, 归属]
    // 剩余寿命让客户端能把火画成「逐渐熄灭」——火舌一停，客户端跟着倒计时淡出。
    fr: game.fires.map((f) => [
      Math.round(f.x),
      Math.round(f.y),
      f.r,
      Math.max(0, Math.round(f.until - now)),
      f.owner,
      f.lifeMs, // 该片火场的寿命上限：客户端按「剩余 / 上限」算衰减（三级火场更耐烧）
    ]),
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
    // 战前状态：房主还没拍板。非空 → 客户端出选图面板（并据此不再跑计时/行军）。
    briefing: game.phase === 'briefing' && game.briefing ? game.briefing : null,
    briefingSeq: Number(game.briefingSeq) || 0,
    players: game.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      kills: p.kills,
      losses: p.losses,
      evolved: p.evolved,
      captured: p.captured,
      rp: Math.round(p.rp),
      rpRate: researchRate(game, i),
      rpAccMs: Math.round(p.rpAccMs || 0), // 距下次结算的累积毫秒
      rpPerPeriod: labRpTotalOf(game, i), // 下次结算将发放的点数（含研究产线加成；0 = 不产出）
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
      lines: clamp(Math.round(f.lines || 1), 1, FAC_MAX_LINES), // 产线数（1..3）
      specs: syncSlots(f).map((s) => ({ type: s.type, tier: s.tier, branch: s.branch })), // 每条产线产什么、几阶
      home: Boolean(f.home),
      hp: Math.round(f.hp),
      hpMax: f.hpMax,
      pt: (f.specs && f.specs[0] && f.specs[0].type) || TYPE_LIST[0], // 第一条产线的兵种（兼容旧字段）
      ecd: Math.round(f.evoCd || 0),
      rx: f.rally ? Math.round(f.rally.x) : null,
      ry: f.rally ? Math.round(f.rally.y) : null,
    })),
    labs: game.labs.map((l) => ({
      id: l.id,
      x: l.x,
      y: l.y,
      owner: l.owner,
      hp: Math.round(l.hp),
      hpMax: l.hpMax,
      // 第 7/8 项：已开拓的研究产线数；每条每周期产出 +labLineRpBonus
      lines: clamp(Math.round(l.lines || 0), 0, LAB_MAX_LINES),
    })),
    hqs: game.hqs.map((h) => ({
      id: h.id,
      x: h.x,
      y: h.y,
      owner: h.owner,
      hp: Math.round(h.hp),
      hpMax: h.hpMax,
      down: Boolean(h.down),
      ecd: Math.round(h.evoCd || 0),
      speedLv: clamp(Math.round(h.speedLv || 0), 0, PROD_SPEED_MAX), // 生产加速等级
      // 总部产线：默认产锐士、不可进化（hqCanEvolve = false）
      lines: clamp(Math.round(h.lines || 1), 1, FAC_MAX_LINES),
      specs: syncSlots(h).map((s) => ({ type: s.type, tier: s.tier, branch: s.branch })),
      prodProg: round2(h.prodProg || 0),
      // 第 4 项：总部集结点（与工厂同款字段，客户端据此画旗子）
      rx: h.rally ? Math.round(h.rally.x) : null,
      ry: h.rally ? Math.round(h.rally.y) : null,
      // 第 6 项：总部防卫状态（锁定目标 / 前摇剩余毫秒 / 目标类别）
      atkId: h.atkId || 0,
      atkKind: h.atkKind || 0,
      atkWindupMs: h.atkWindup > Date.now() ? Math.round(h.atkWindup - Date.now()) : 0,
      // 该玩家当前「单条产线」的生产间隔（毫秒，已计入加速）：客户端直接展示，不必自己算
      prodIntervalMs: Math.round(prodIntervalMs(game, h.owner)),
    })),
    units: game.units.length,
    over: Boolean(game.over),
    winnerId: game.winnerId || null,
    seq: game.seq,
    serverTime: Date.now(),
    // ---- 地形编辑器 ----
    // room:startEditor 开出来的那局会停在 edit 阶段；客户端据此决定要不要把
    // 地图下方的编辑器面板拉出来。editorOwnerId 让「别人也在看」的房子里，
    // 只有编辑者本人能看到面板、也只有他能用笔。
    editor: Boolean(game.editor),
    paused: Boolean(game.paused),
    editorOwnerId: game.editorOwnerId || null,
    mapFile: game.mapFile || null,
    // 地形（权威）：客户端据此渲染，保证主客端一致
    terrain: game.terrain
      ? {
          cell: game.terrain.cell,
          cols: game.terrain.cols,
          rows: game.terrain.rows,
          data: terrainToData(game.terrain),
          // 高低差（每层一个字符 '0'~'9' = 层 + HGT_OFF）：客户端据此画立体坡地，
          // 并按同一套层差算射程（见 heightAtWorld / effRange）
          heights: heightsToData(game.terrain.heights),
          // 坡道（一种「无视高低差也能走」的地形）：'0'/'1' 每格一个字符。
          // 客户端把它画成成片的金色地带 —— 而不是让两端各自按「层差=1」反推
          // （反推会把并非坡道的相邻格也染上色，且两边口径容易漂移）。
          ramps: rampsToData(game.terrain.ramps),
          levels: HGT_LEVELS,
          // 坡与崖：层差 ≥ cliff = 崖（部队过不去），= 1 = 坡（走得上去）。
          // 客户端据此把两类边界画成两种样子，别硬编码。
          cliff: HGT_CLIFF,
          terrace: HGT_TERRACE,
          off: HGT_OFF, // 下发字符串里「字符 − 偏移 = 层」
          // 本局地貌主题（key / name / desc）：客户端据此显示「这局是什么地形」
          theme: game.terrain.theme || null,
        }
      : null,
  };
}

/** 地形网格压成字符串（每行行优先拼接的 '0'~'4'），便于下发 */
function terrainToData(t) {
  if (!t) return '';
  let s = '';
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < t.cols; c++) s += String(t.grid[r][c]);
  }
  return s;
}

/* ---------------- 玩家输入（离散指令） ---------------- */

/**
 * 玩家 / 机器人下达指令的唯一通道。
 *
 * @param {object} game
 * @param {string} playerId
 * @param {object} data 见各 cmd 分支
 * @param {number} [now] 指令时刻（毫秒）。**可选**：默认取真实时钟 Date.now()；
 *   机器人驱动与冒烟测试会传**游戏内时钟**，好让「每秒 12 条」的限速按同一把尺子算 ——
 *   否则手动时钟模拟（600 秒模拟只花几秒真实时间）会把机器人的指令几乎全判成超速拒掉。
 */
function setPlayerInput(game, playerId, data, now) {
  if (!game || !playerId || game.over) return false;
  const d = data || {};
  const cmd = String(d.cmd || '');
  const oi = game.players.findIndex((p) => p.id === playerId);
  if (oi < 0) return false;
  const p = game.players[oi];
  if (p.eliminated || p.left) return false;

  // 简单限速：每秒最多 12 条指令
  const t = Number.isFinite(now) ? now : Date.now();
  if (!p._cmdWin || t >= p._cmdWin + 1000) {
    p._cmdWin = t;
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
    // 多点路径（Shift+右键规划）：path = 依次要走的路点，末点即终点。
    // 每个点都按下面的口径单独矫正；部队走到一个点就切下一个（见 advanceRoute）。
    const rawPath = Array.isArray(d.path) ? d.path.slice(0, 12) : null;
    // 落点若压在建筑上，挪到建筑外缘——否则部队会绕着那栋建筑打转（目标不可达）
    const p = snapOutsideBuildings(game, clamp(x, 0, WORLD_W), clamp(y, 0, WORLD_H));
    const tx = p.x;
    const ty = p.y;
    const path = [];
    if (rawPath) {
      for (const w of rawPath) {
        const wx = Number(w && w.x);
        const wy = Number(w && w.y);
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
        const sp = snapOutsideBuildings(game, clamp(wx, 0, WORLD_W), clamp(wy, 0, WORLD_H));
        path.push({ x: sp.x, y: sp.y });
      }
    }
    // 终点以 x/y 为准（客户端会把它同时放进 path，这里再补一次防丢）
    if (!path.length || Math.hypot(path[path.length - 1].x - tx, path[path.length - 1].y - ty) > 1) {
      path.push({ x: tx, y: ty });
    }
    // 连通分量表：落点在山/水的另一侧时，要按**每个单位自己**所在的分量各自矫正。
    // 不矫正的话流场会把目标吸到本侧最近的可通行格，单位走到那里就算「到了」——
    // 可它离真正的指令点还有几百 px，于是 moveX/moveY 永远清不掉（卡指令，且从此不还手，
    // 因为 retaliate 见 moveX != null 就直接 return）。
    const cb = compLabels(game);
    let n = 0;
    for (const u of game.units) {
      if (u.dead || u.ownerIdx !== oi) continue;
      if (!ids.includes(u.id)) continue;
      // 每个路点都按「这个单位所在的分量」矫正一次：部队在山的这一侧时，
      // 山那边的路点会被拉到本侧最近的可通行处 —— 否则它会在崖边干等到超时兜底。
      // ⚠️ 矫正结果若离单位比点击远太多（隔崖小岛 / 全图扫描吸到半张图外），
      //    改成沿「单位→点击」方向在本侧就近落点，避免一点近处却下令去绕大圈。
      const fix = (px, py) => {
        if (!cb) return { x: px, y: py };
        let uc = cb.lab[cellOf(game, u.x, u.y).i];
        if (uc < 0) {
          const unp = nearestPassable(game, u.x, u.y);
          if (unp) uc = cb.lab[cellOf(game, unp.x, unp.y).i];
        }
        if (uc < 0) return { x: px, y: py };
        const dClick = dist(u.x, u.y, px, py);
        // 点击本身就在本侧可通行格 → 精确落点
        const ti = cellOf(game, px, py).i;
        if (cb.lab[ti] === uc && !insideBuilding(game, px, py, 0)) return { x: px, y: py };
        // 先近距环形找（不扫全图）
        let rp = nearestPassable(game, px, py, uc, { noScan: true });
        if (rp) {
          const dSnap = dist(u.x, u.y, rp.x, rp.y);
          if (dSnap <= Math.max(dClick * 2.2, dClick + 280)) return { x: rp.x, y: rp.y };
        }
        // 沿点击方向在本侧递推找一个「够近」的落点
        const ang = Math.atan2(py - u.y, px - u.x);
        for (let s = Math.min(dClick, 520); s >= 48; s -= 48) {
          const ap = nearestPassable(
            game,
            u.x + Math.cos(ang) * s,
            u.y + Math.sin(ang) * s,
            uc,
            { noScan: true }
          );
          if (ap && dist(u.x, u.y, ap.x, ap.y) <= Math.max(dClick * 1.8, dClick + 200)) {
            return { x: ap.x, y: ap.y };
          }
        }
        // 最后才允许全图扫描，但仍拒绝离谱远点
        rp = nearestPassable(game, px, py, uc);
        if (rp && dist(u.x, u.y, rp.x, rp.y) <= Math.max(1100, dClick * 3)) {
          return { x: rp.x, y: rp.y };
        }
        // 实在不行：朝点击迈一小步，交给 stepViaFlow 近距局部寻路
        const step = Math.min(96, Math.max(40, dClick * 0.35));
        return { x: u.x + Math.cos(ang) * step, y: u.y + Math.sin(ang) * step };
      };
      const fp = path.map((w) => fix(w.x, w.y));
      const head = fp[0];
      let mx = head.x;
      let my = head.y;
      u.route = fp.length > 1 ? fp.slice(1) : null;
      u.routeAt = Number.isFinite(t) ? t : 0;
      u.moveX = mx;
      u.moveY = my;
      // ⚠️ 四个 target* 都要清：只清 targetId 的话，正在啃工厂/研究所/总部的部队
      //    会一边赶路一边继续打那栋建筑（下面解析目标是 if(targetId) else if(targetFac)…）。
      u.targetId = 0; // 立刻重新索敌（移动中照常开火，所以不需要脱离窗口）
      u.targetFac = 0;
      u.targetLab = 0;
      u.targetHq = 0;
      u.manualTarget = null; // 行军指令取消追击攻击命令（右键别处 = 取消）
      n++;
    }
    return n > 0;
  }
  if (cmd === 'attack') {
    // 追击攻击命令：右键点中的敌 / 中立单位或建筑。
    // 目标在射程内就直接打；**不在射程内会主动寻路赶上去**（见 updateUnits 的追击段），
    // 目标逃跑也一路追下去 —— 直到玩家右键别处（move）/ 停止（stop），或目标死亡/易主。
    const kind = String(d.kind || '');
    if (!['u', 'f', 'l', 'h'].includes(kind)) return false;
    const id = Number(d.id);
    if (!Number.isFinite(id)) return false;
    // 只接受非己方目标（敌方 / 中立建筑 owner===-1）
    const tgt = lookupTarget(game, oi, kind, id);
    if (!tgt) return false;
    const ids = Array.isArray(d.ids) ? d.ids.slice(0, 80) : [];
    if (!ids.length) return false;
    let n = 0;
    for (const u of game.units) {
      if (u.dead || u.ownerIdx !== oi) continue;
      if (!ids.includes(u.id)) continue;
      u.manualTarget = { kind, id };
      // 攻击命令取代此前的移动命令，否则部队会先去旧目标点再回头
      u.moveX = null;
      u.moveY = null;
      u.route = null;
      u.routeAt = 0;
      u.scanAt = 0; // 立刻重新索敌，不用等下一个扫描周期（250ms）
      n++;
    }
    return n > 0;
  }
  if (cmd === 'hqAttack') {
    // 选中总部后右键：敌方单位 / 中立或敌方建筑（工厂、研究所、总部）→ 切换防卫目标（不设集结点）
    const hq = game.hqs.find((h) => h.owner === oi && !h.down);
    if (!hq) return false;
    const kind = String(d.kind || '');
    if (!['u', 'f', 'l', 'h'].includes(kind)) return false;
    const id = Number(d.id);
    if (!Number.isFinite(id)) return false;
    const tgt = lookupTarget(game, oi, kind, id);
    if (!tgt) return false;
    const focusKind = kind === 'u' ? 1 : kind === 'f' ? 2 : kind === 'l' ? 3 : 4;
    const switched =
      hq.atkFocusKind !== focusKind || hq.atkFocus !== tgt.id || hq.atkKind !== focusKind || hq.atkId !== tgt.id;
    hq.atkFocusKind = focusKind;
    hq.atkFocus = tgt.id;
    const inRange =
      dist(tgt.x, tgt.y, hq.x, hq.y) <= HQ_ATK_RANGE &&
      !losBlocked(game, hq.x, hq.y, tgt.x, tgt.y);
    if (inRange) {
      if (switched) hq.atkWindup = Date.now() + HQ_ATK_WINDUP_MS;
      hq.atkKind = focusKind;
      hq.atkId = tgt.id;
    } else {
      hq.atkKind = 0;
      hq.atkId = 0;
      hq.atkWindup = 0;
    }
    return true;
  }
  if (cmd === 'rally') {
    const fid = Number(d.fid);
    if (!Number.isFinite(fid)) return false;
    // 第 4 项：总部（fid === 0）也能设集结点，交互方式与己方工厂完全一致
    let b = null;
    if (fid === 0) {
      const hq = game.hqs.find((h) => h.owner === oi);
      if (!hq || hq.down) return false;
      b = hq;
    } else {
      const f = game.factories.find((x) => x.id === fid);
      if (!f || f.owner !== oi) return false; // 只能给自己名下的工厂设集结点
      b = f;
    }
    if (d.clear) {
      b.rally = null;
      return true;
    }
    const x = Number(d.x);
    const y = Number(d.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    // 集结点两重矫正：
    //  1) 压到建筑上 → 挪到建筑外缘（否则该厂出的兵会永远围着那栋建筑转）；
    //  2) 越过山/水到了另一个连通域 → 拉回工厂所在域（否则旗子插在不可达处，部队半路就停）。
    let p = snapOutsideBuildings(game, clamp(x, 0, WORLD_W), clamp(y, 0, WORLD_H));
    const cb = compLabels(game);
    if (cb) {
      let fc = cb.lab[cellOf(game, b.x, b.y).i];
      if (fc < 0) {
        const fnp = nearestPassable(game, b.x, b.y);
        if (fnp) fc = cb.lab[cellOf(game, fnp.x, fnp.y).i];
      }
      if (fc >= 0) {
        const rp = nearestPassable(game, p.x, p.y, fc);
        if (!rp) return false;
        p = rp;
      }
    }
    b.rally = { x: p.x, y: p.y };
    return true;
  }
  if (cmd === 'facEvolve') {
    // 产线进化：把**某一条产线**的出厂阶数整体抬高一阶 —— 此后这条线直接吐该阶单位
    // （旧规则是花点让一支现存部队进阶，产线仍继续吐初级，那不是玩家想要的效果）。
    // 总部产线（fid === 0）不可进化，一律拒绝。
    const fid = Math.round(Number(d.fid));
    if (!Number.isFinite(fid) || fid === 0) return false;
    const f = game.factories.find((x) => x.id === fid);
    if (!f || f.owner !== oi) return false; // 只能操作自己名下的工厂
    if (f.level < 2) return false; // 初级工厂的产线最高只有一阶，无从进化
    if (f.evoCd > 0) return false; // 冷却中
    if (p.rp < FAC_LINE_EVOLVE_COST) return false; // 科技点不足
    const specs = syncSlots(f);
    const li = clamp(Math.round(Number(d.li) || 0), 0, specs.length - 1);
    const s = specs[li];
    if (s.tier >= f.level) return false; // 已到本厂上限
    s.tier += 1;
    p.rp -= FAC_LINE_EVOLVE_COST; // 扣科技点
    f.evoCd = FAC_EVOLVE_CD;
    game._captures = (game._captures || 0) + 1; // 让客户端立刻看到扣费与产线变化
    pushEvent(game, {
      t: 'fcevo',
      fid,
      li,
      oi,
      tier: s.tier,
      type: s.type,
      x: round1(f.x),
      y: round1(f.y),
    });
    return true;
  }
  if (cmd === 'facLine') {
    // 开辟产线：花科技点再加一条并行产线（最多 FAC_MAX_LINES 条）。
    // 开辟时要先选好这条线产什么兵（d.type），没传就沿用第一条线的兵种。
    // fid === 0 → 总部产线（总部也出兵，但只能是一级）。
    const fid = Math.round(Number(d.fid));
    let b = null;
    if (fid === 0) {
      const hq = game.hqs.find((h) => h.owner === oi);
      if (!hq || hq.down) return false;
      b = hq;
    } else {
      const f = game.factories.find((x) => x.id === fid);
      if (!f || f.owner !== oi) return false; // 只能给自己名下的工厂开产线
      b = f;
    }
    const specs = syncSlots(b);
    if (specs.length >= FAC_MAX_LINES) return false; // 已满产
    if (p.rp < FAC_LINE_COST) return false; // 科技点不足
    const type = TYPE_LIST.includes(d.type) ? d.type : specs[0].type;
    p.rp -= FAC_LINE_COST;
    specs.push(makeSlot(type));
    b.lines = specs.length;
    b.prog.push(0);
    game._captures = (game._captures || 0) + 1; // 让客户端立刻看到扣费与产线变化
    pushEvent(game, {
      t: 'line',
      oi,
      fid,
      lines: b.lines,
      type,
      x: round1(b.x),
      y: round1(b.y),
    });
    return true;
  }
  if (cmd === 'labLine') {
    // 第 7 项：给研究所开拓研究产线 —— **点击即生效，没有二级选择项**
    // （不需要选兵种、也不需要选分支，一条命令直接开工）。
    // 每座最多 LAB_MAX_LINES 条；每条每周期产出 +LAB_LINE_RP_BONUS。
    const lid = Math.round(Number(d.lid));
    if (!Number.isFinite(lid) || lid <= 0) return false;
    const l = game.labs.find((x) => x.id === lid);
    if (!l || l.owner !== oi) return false; // 只能给自家名下的研究所开产线
    if ((l.lines || 0) >= LAB_MAX_LINES) return false; // 已开满
    if (p.rp < LAB_LINE_COST) return false; // 科技点不足
    p.rp -= LAB_LINE_COST;
    l.lines = (l.lines || 0) + 1;
    game._captures = (game._captures || 0) + 1; // 让客户端立刻看到扣费与产线变化
    pushEvent(game, {
      t: 'labline',
      oi,
      lid,
      lines: l.lines,
      x: round1(l.x),
      y: round1(l.y),
    });
    return true;
  }
  if (cmd === 'prodSpeed') {
    // 总部产能升级：花科技点加快本方所有部队的生产速度（每级把当前间隔再缩短 1/15）。
    const hq = game.hqs.find((h) => h.owner === oi);
    if (!hq || hq.down) return false;
    const lv = clamp(Math.round(hq.speedLv || 0), 0, PROD_SPEED_MAX);
    if (lv >= PROD_SPEED_MAX) return false; // 已满级
    if (p.rp < PROD_SPEED_COST) return false; // 科技点不足
    p.rp -= PROD_SPEED_COST;
    hq.speedLv = lv + 1;
    game._captures = (game._captures || 0) + 1; // 让客户端立刻看到扣费与等级变化
    pushEvent(game, { t: 'spd', oi, lv: hq.speedLv, x: round1(hq.x), y: round1(hq.y) });
    return true;
  }
  if (cmd === 'stop') {
    const ids = Array.isArray(d.ids) ? d.ids.slice(0, 80) : [];
    for (const u of game.units) {
      if (u.dead || u.ownerIdx !== oi) continue;
      if (!ids.includes(u.id)) continue;
      u.moveX = null;
      u.moveY = null;
      u.route = null;
      u.routeAt = 0;
      // ⚠️ 同上：四个 target* 一起清，否则「原地待命」的部队还在啃刚才那栋建筑
      u.targetId = 0;
      u.targetFac = 0;
      u.targetLab = 0;
      u.targetHq = 0;
      u.manualTarget = null; // 停止指令取消追击攻击命令（部队原地待命），下次则自动索敌
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
      f.rally = null;
      resetSlots(f); // 出局 / 退出：产线一并重置成一条一级线
      f.lastHitBy = -1;
      clearDmgBook(f);
      f.hp = Math.round(FACTORY_HP * NEUTRAL_HP_RATIO); // 转为中立 → 只有 1/3 血量
    }
  }
  for (const l of game.labs) {
    if (l.owner !== oi) continue;
    l.owner = -1;
    l.lastHitBy = -1;
    clearDmgBook(l);
    l.hp = Math.round(LAB_HP * NEUTRAL_HP_RATIO); // 转为中立 → 只有 1/3 血量
  }
  const hq = game.hqs.find((h) => h.owner === oi);
  if (hq) {
    hq.down = true;
    hq.hp = 0;
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

/* ---------------- 对战机器人驱动 ---------------- */

/**
 * 每个 bot / 托管座位每 BOT_THINK_MS 毫秒思考一次，产出一组 setPlayerInput 指令。
 *
 * - 实时对战无回合：回合制的「scheduleBotTick + applyAction」用不上，
 *   机器人只能像真人一样**周期性地**读盘、下指令。
 * - 状态挂在 game._botStates[playerId] 上（跨 think 持久，snapshot 不下发）。
 * - 指令一次性发完（≤6 条），由 setPlayerInput 自带的「每秒 12 条」限速兜底。
 * - editorDummy（地形编辑器的占位电脑）绝不思考 —— 它只用来凑人数摆出生点。
 *
 * @param {object} room 房间（需含 .players 与 .game）
 * @param {number} [now] 当前毫秒；不传则取 Date.now()（测试可注入手动时钟）
 */
const BOT_THINK_MS = 700;

function driveBots(room, now) {
  if (!room || !room.game || room.game.type !== 'warfactory') return;
  const game = room.game;
  if (game.over || game.phase !== 'playing') return;
  if (!Number.isFinite(now)) now = Date.now();

  if (!game._botNextThink) game._botNextThink = {};
  if (!game._botStates) game._botStates = {};

  for (let i = 0; i < game.players.length; i++) {
    const p = game.players[i];
    if (!p || p.eliminated || p.left) continue;
    const seat = (room.players || [])[i];
    if (!seat || seat.id !== p.id) continue;
    if (seat.editorDummy) continue; // 占位电脑只凑人数
    const autoPlays = Boolean(seat.isBot || seat.isHosted);
    if (!autoPlays) continue;

    const nextAt = game._botNextThink[p.id] || 0;
    if (now < nextAt) continue;
    // 700ms ± 100ms 错峰：多 bot 同场时不至于同帧思考
    game._botNextThink[p.id] = now + BOT_THINK_MS + Math.floor(Math.random() * 200);

    const diff = seat.isHosted ? 'hard' : seat.botDifficulty || 'hard';
    const st = game._botStates[p.id] || (game._botStates[p.id] = {});
    let cmds = null;
    try {
      cmds = WFBot.think(game, p.id, diff, st, now);
    } catch (err) {
      // 机器人出错不能拖垮整个 tick
      console.error('[warfactory] bot think failed:', err && err.message);
      continue;
    }
    if (!Array.isArray(cmds) || !cmds.length) continue;
    for (const c of cmds) {
      try {
        // 传游戏内时钟：让限速与模拟同尺子（手动时钟测试里这点是要命的，见 setPlayerInput）
        setPlayerInput(game, p.id, c, now);
      } catch (_) {
        /* 单条失败不影响其余 */
      }
    }
  }
}

/**
 * @param {object} room
 * @param {{ broadcastState?: () => void, broadcastRt?: (payload: object) => void, isAlive?: () => boolean }} io
 */
/** 地形分片下发的规模上限（数字个数）：超过就改发整张地形字符串 */
const WF_TERR_PATCH_MAX = 12000;

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
      // 地形编辑的分片下发：**单独一条通道**，不走全量 game:state ——
      // 那份快照带着整张地形图（八万多个字符），每涂一笔重发一次能把带宽打满。
      if (io && typeof io.broadcastTerrain === 'function') {
        const patch = takeTerrainChanges(cur);
        if (patch) {
          // 改动太大（「填成平原」就是整图八万格）时改发整张地形 ——
          // 分片要写十六条以上的数字，比整串地形还长，反而不划算。
          if (patch.length > WF_TERR_PATCH_MAX) {
            io.broadcastTerrain({
              full: terrainToData(cur.terrain),
              heights: heightsToData(cur.terrain.heights),
              ramps: rampsToData(cur.terrain.ramps),
              levels: HGT_LEVELS,
              cliff: HGT_CLIFF,
              terrace: HGT_TERRACE,
              off: HGT_OFF,
              seq: cur.seq,
            });
          } else {
            io.broadcastTerrain({ cells: patch, seq: cur.seq });
          }
        }
      }
      // 机器人代操作：在物理步进之前先让 bot 把这一帧的指令下下去
      driveBots(room);
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
      // 全量状态：阶段/胜负变化立即广播；占领/淘汰等变化至少间隔 1s。
      // 建筑 / 单位的增删编辑因为把 bodies 放在全量里，也走这条路（见 _editDirty）：
      // 编辑时对局是停着的，tick 恒返回 false，只能这样「至多一秒一次」把新建的东西送到客户端。
      const editDirty = Boolean(cur._editDirty);
      if (editDirty) cur._editDirty = false;
      if (
        io &&
        typeof io.broadcastState === 'function' &&
        (changed || editDirty) &&
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
  // 机器人决策（占位实现，让 gameSupportsBot 通过；实时驱动走 driveBots → WFBot.think）
  decideBotAction: WFBot.decideBotAction,
  // 坡与崖（scripts/warfactory-cliff-check.js 用它直接量「这一步过不过得去」）
  canStand,
  cliffBetween,
  stepOpen,
  navStepOk,
  segmentClear,
  publicGameState,
  getActingPlayerIds,
  onPlayerQuit,
  setPlayerInput,
  startLoop,
  stopLoop,
  stopAllLoops,
  snapshot,
  /** 对战机器人周期驱动（startLoop 内部调用；测试可注入手动时钟直接调） */
  driveBots,
  // ---- 地形编辑器 ----
  /** 编辑指令通道：返回是否真的改动了东西 */
  applyEditorCommand,
  /** 取出待下发的地形分片（[格号, 值, …]），没有则返回 null */
  takeTerrainChanges,
  setPaused,
  /** 把当前对局导出成地图文件对象（可直接交给 maps.writeMap 落盘） */
  exportCurrentMap,
  /** 一张空的自定义地图（编辑器的初始画布） */
  blankMap,
  maps: WFMaps,
  /** 实时对战：已接入 AI（困难档），玩家中途退出可由电脑托管 */
  supportsHosting: true,
  /** 支持战前选图：开局先停在 briefing 阶段，由房主挑地图，确认后才进倒计时 */
  supportsBriefing: true,
  beginBriefing,
  endBriefing,
  /** 当前局面的缩略图，战前面板用它当预览 */
  thumbOfGame,
  /** 战前信息快照，服务端重建局面时复用 */
  briefingView,

  /** 冒烟测试用：暴露内部推进函数，避免依赖真实时钟 */
  __test: {
    step,
    tick,
    spawnUnit,
    unitStats,
    garrisonOf,
    unitCountOf,
    updateFactories,
    updateCaptures: updateFactories, // 兼容旧名
    updateProduction,
    updateUnits,
    updateBullets,
    sprayFlame,
    addFire,
    fireProfile,
    updateFires,
    explodeShell,
    retaliate,
    reapDead,
    updateOutcome,
    findTarget,
    damageFactory,
    damageLab,
    damageHq,
    updateResearch,
    researchRate,
    labCountOf,
    labRpOf,
    labRpTotalOf,
    updateHqDefense,
    prodIntervalMs,
    promoteUnit,
    makeSlot,
    syncSlots,
    resetSlots,
    laserMul,
    laserZap,
    laserVisSizeMul,
    laserVisDetail,
    // 对战机器人（smoke/bot.js 直接调 driveBots 推进，不走真实时钟）
    driveBots,
    bot: WFBot,
    terrainCell,
    terrainSpeedFactor,
    terrainPassable,
    losBlocked,
    mountainHitAlong,
    canStand,
    nearestPassable,
    stepViaFlow,
    flowField,
    localSteer,
    lineClear,
    stepViaFlow,
    cellOf,
    passGrid,
    compLabels,
    stepUnit,
    damageUnit,
    generateTerrainGrid,
    makeTerrain,
    // 地形高低差（见 data.js 的 height 段）
    buildHeightField,
    heightsToData,
    rampsToData,
    heightAtCell,
    heightAtWorld,
    effRange,
    unitRangeAt,
    // 地图主题（每局随机抽一个）
    themes: THEMES,
    pickTheme,
    themeByKey,
    fillTheme,
    fillShape,
    clampBlocked,
    clampShapes,
    roundTerrainEdges,
    despeckleEdges,
    clearTinyBlobs,
    // N 重旋转对称（阶数 = 人数）
    symOrder,
    wedgeDims,
    rotateAround,
    symOrbit,
    foldToWedge,
    symmetrizeGrid,
    drawStamp,
    stampWall,
    stampBlob,
    stampRing,
    rngRange,
    dirChoices,
    ensureOpenTerrain,
    openLanesAroundBuildings,
    occupyR,
    minCenterDist,
    BUILD_LANE_PX,
    terrainAnchors,
    wideMask,
    wideRegions,
    cellPassable,
    ridgeBandsBetween,
    isolationBands,
    inIsolationBand,
    carveIsolationBands,
    buildNeutralFactories,
    buildLabs,
    baseOrbit,
    circlePoint,
    baseRadiusRange,
    pickBasePositions,
    clearTerrainAroundBuildings,
    terrainToData,
    // 进攻主路（相邻玩家之间预留的上 / 中 / 下大道）
    adjacentBasePairs,
    roadPerPair,
    roadHalfOf,
    roadLanes,
    carveRoadPath,
    carveMainRoads,
    roadPlainFor,
    // 中场关口（相邻总部之间横着的一道大山 / 大湖）
    gateTypeOf,
    gateRects,
    gateSizeK,
    gateMaskOf,
    stampGates,
    consts: {
      WORLD_W,
      WORLD_H,
      GRID, // 格子基准：1 格 = GRID 像素（data.js 里所有长度都是格）
      // 地形高低差（data.js 的 height 段换算结果）
      HEIGHT_LEVELS: HGT_LEVELS, // 最高 / 最低层数（−levels..+levels）
      HEIGHT_STEP_PX: HGT_STEP_PX, // 每 1 层高低差 = 这么多像素射程
      HEIGHT_SLOPE: HGT_SLOPE,
      HEIGHT_OFF: HGT_OFF, // 下发字符串里「字符 − 偏移 = 层」
      // 坡与崖：层差 ≥ cliffAt 就是崖（过不去），= 1 就是坡（走得上去）
      HEIGHT_CLIFF: HGT_CLIFF,
      HEIGHT_TERRACE: HGT_TERRACE, // 台地档位间隔（层）
      FACTORY_R,
      REPAIR_RANGE,
      REPAIR_HP_PER_SEC,
      DAMAGE_FORGET_MS,
      PRODUCE_MS,
      PLAYER_UNIT_CAP,
      PLAYER_UNIT_WARN,
      FACTORY_HP,
      NEUTRAL_HP_RATIO,
      FAC_EVOLVE_CD,
      LAB_R,
      LAB_HP,
      HQ_R,
      HQ_HP,
      RP_PER_LAB,
      RP_PERIOD_MS,
      EVOLVE_RP_COST,
      COUNTDOWN_MS,
      TYPE_LIST,
      START_ROSTER,
      LINE_UNIT_CAP, // 第 9 项：每条产线同时最多养这么多兵
      LINE_SLOW_PER_UNIT,
      STATS: STATS_PX, // 像素版（range / r / splash / minRange 已由格换算）
      EVOLVED: EVOLVED_PX, // 2 / 3 阶的像素版（同口径）
      // 注意：NEUTRAL_FACTORIES 是运行时由 createGameState 按人数动态生成的（见 buildNeutralFactories），
      // 这里用 getter 透传「当前值」，否则导出时只会抓到模块加载时的空数组 []。
      get NEUTRAL_FACTORIES() { return NEUTRAL_FACTORIES; },
      // 研究所同样是运行时按人数生成的（见 buildLabs），用 getter 才能读到当值
      get LABS() { return LABS; },
      COLORS,
      TERR_COLS,
      TERR_ROWS,
      TERR_CELL,
      TT_PLAIN,
      TT_MOUNTAIN,
      TT_WATER, // 沼泽（3）已移除，不再生成
      LOS_STEP,
      THEMES, // 地图主题表（各自一张图元清单）
      THEME_FALLBACK, // 主题未指定字段时的兜底参数
      SHAPE_DEFAULTS, // 地形图元（wall / blob / ring）的兜底参数
      SHAPE_SNAP, // 图元中心吸附的格距
      // 「不要小山小湖」：单个图元的最小面积（格）、以及收尾清扫的最小地形块（格）
      SHAPE_MIN_AREA,
      MIN_BLOB_CELLS,
      // 进攻主路
      ROAD_PER_PAIR,
      ROAD_PER_MAX, // 人数不同条数不同时的最大值（预览 / 测试遍历用）
      ROAD_W,
      ROAD_GAP,
      ROAD_FAN_END,
      ROAD_HALF,
      ROAD_MIN_W,
      ROAD_INNER,
      ROAD_OUTER,
      ROAD_WAVE3,
      ROAD_WAVE5,
      ROAD_CORE_GAP,
      ROAD_ROLES,
      LASER_WINDUP_MS,
      LASER_RAMP_MS,
      LASER_MAX_MUL,
      LASER_VIS_BASE_DMG,
      LASER_VIS_STEP_PCT,
      LASER_VIS_DETAIL_PER,
      LASER_VIS_DETAIL_MAX,
      FLAME_R,
      FLAME_EDGE_MUL, // 火舌外沿伤害 = 中心 × 它（1 = 不衰减）
      BURST_EDGE_MUL, // 轰击溅射外沿伤害 = 中心 × 它（半径随阶数走，见 STATS/EVOLVED 的 splash）
      FIRE_TIERS,
      FIRE_MAX,
      BULLET_SPLASH,
      ATTACK_SLACK,
      FAC_LINE_COST,
      FAC_MAX_LINES,
      FAC_LINE_EVOLVE_COST,
      HQ_PROD_TYPE,
      PROD_SPEED_COST,
      PROD_SPEED_MAX,
      PROD_SPEED_STEP,
      // 第 6 项：总部防卫
      HQ_ATK_RANGE,
      HQ_ATK_CD,
      HQ_ATK_DMG,
      HQ_ATK_WINDUP_MS,
      // 第 7/8 项：研究所研究产线
      LAB_LINE_COST,
      LAB_MAX_LINES,
      LAB_LINE_RP_BONUS,
      // 第 9 项：产线在场名额与减速
      LINE_UNIT_CAP,
      LINE_SLOW_PER_UNIT,
      HQ_MIN_RIDGES,
    },
    // 第 9 项：产线「在场越多越慢」的独立乘区与「每条线在场兵数」统计
    lineSpeedMul,
    lineAliveMap,
  },
};
