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
 * - 操作：框选己方部队 → 右键下达「移动/进攻移动」。
 *   单位**不会自动追击**：只有敌人进入攻击范围才开火，敌人跑出范围即停火（不追）。
 *   行军途中照常开火（移动攻击），所以不追击也能边走边打。
 * - 玩家失去全部工厂即出局，最后存活者获胜。
 *
 * 服务端权威模拟：固定 10Hz 步进，快照走轻量 game:rt 通道；
 * 全量 game:state 在阶段切换 / 占领 / 淘汰 / 胜负时广播（至少间隔 1s 节流）。
 */

// 地图放大到原来的 1.8 倍（面积 ×3.24）：4320 / 2880
const WORLD_W = 4320;
const WORLD_H = 2880;
const TICK_MS = 100;
const MAX_DT = 0.25;

const COUNTDOWN_MS = 3000;

// ---- 工厂 / 研究所 ----
// 建筑半径按 2/3 缩小（与单位同步）
const FACTORY_R = 39; // 建筑本体碰撞半径（原 58）
const CAPTURE_R = 79; // 占领判定半径（原 118）
const CAPTURE_RATE = 25; // 每秒占领进度（无守军时 4 秒占领）
const RECLAIM_RATE = 45; // 守方在场时的进度回退速度
const PRODUCE_MS = 20000; // 出兵间隔（每座工厂每 20 秒生产 1 支）
// 每名玩家的部队总数上限：达到即暂停所有工厂的生产（兵死了立刻恢复）
const PLAYER_UNIT_CAP = 400;
const PLAYER_UNIT_WARN = 350; // 达到该数量后客户端在右上角常驻提示
// 工厂可被攻击：血量 = 单位血量的 20 倍；血打光即由「最后一击者」接管
const FACTORY_HP = 2000;
// 中立工厂只有完整工厂的 1/3 血量
const NEUTRAL_HP_RATIO = 1 / 3;
// 手动进化冷却（毫秒）：非初级工厂每间隔这么久才能手动进阶一支本厂部队
const FAC_EVOLVE_CD = 4000;

// ---- 工厂产线升级 / 总部产能升级 ----
// 工厂默认一条产线（每 PRODUCE_MS 出 1 支）；花科技点可开辟更多产线，
// 多条产线并行生产 → 同一时间一座工厂就能同时出多个单位（产出速率 × 产线数）。
const FAC_LINE_COST = 500; // 每开辟一条新产线消耗的科技点
const FAC_MAX_LINES = 3; // 单厂产线上限（最多同时生产 3 个单位）
// 总部「生产加速」：用科技点加快本方所有部队的生产速度。
// 每一次都在「当前间隔」上再减 1/15（复利 / 非线性），最多 20 次。
const PROD_SPEED_COST = 1000; // 每次升级消耗的科技点
const PROD_SPEED_MAX = 20; // 升级次数上限
const PROD_SPEED_STEP = 1 / 15; // 每次在现有间隔上再减少的比例

// ---- 研究所 / 总部 / 科技点 ----
const LAB_R = 31; // 研究所碰撞半径（原 46）
const LAB_HP = 1200; // 研究所满血：同工厂一样可被攻击，打光即由最后一击者接管
const HQ_R = 43; // 总部碰撞半径（原 64）
const HQ_HP = 3000; // 总部满血：被打光即「总部陷落」，该玩家出局
const RP_PER_LAB = 2; // 每座已占领的研究所每 3 秒提供 2 点研究点；一座不占则完全不产出
const RP_PERIOD_MS = 3000; // 研究点结算周期
const EVOLVE_RP_COST = 500; // 每 500 点研究点可进化一次单位（取代原经验体系）
const RP_CAP = 9999; // 科技点上限，仅用于展示封顶

// ---- 单位 ----
const TYPE_LIST = ['warrior', 'shield', 'ranger', 'burst', 'burn', 'laser'];
// 单位半径按 2/3 缩小（r 为原来的 2/3），血量/伤害/射程等战斗数值保持不变
const STATS = {
  warrior: { label: '锐士', hp: 100, dmg: 11, range: 60, cd: 0.9, speed: 92, r: 9 },
  shield: { label: '盾卫', hp: 175, dmg: 8, range: 50, cd: 1.1, speed: 66, r: 10 },
  ranger: { label: '游侠', hp: 65, dmg: 10, range: 200, cd: 1.5, speed: 82, r: 9 },
  burst: { label: '轰击', hp: 75, dmg: 18, range: 165, cd: 2.1, speed: 58, r: 9, splash: 41 },
  // 燎原：持续喷火（不点射）。dmg 的含义是「每秒火焰伤害」而不是「每次伤害」，
  // cd 不参与射速（火焰是连续的），只作为面板兜底展示。
  burn: { label: '燎原', hp: 80, dmg: 6, range: 135, cd: 0.25, speed: 78, r: 9, burn: true },
  // 激光兵：持续光束直伤（不走弹道）。锁定同一个目标越久伤害越高，最高 5 倍；
  // 一旦更换锁定目标就要重新蓄能（前摇期间不射击）。
  laser: { label: '激光兵', hp: 70, dmg: 2.5, range: 175, cd: 0.4, speed: 76, r: 9, laser: true },
};
const TIER_HP = [1, 1.7, 2.6];
const TIER_DMG = [1, 1.55, 2.2];
const TIER_RANGE = [0, 15, 30];
const TIER_CD = [1, 0.88, 0.78];
// ---- 激光兵 ----
const LASER_WINDUP_MS = 800; // 前摇：换目标后这么久内不射击（蓄能）
const LASER_RAMP_MS = 4000; // 蓄能满倍率所需时间：锁定每持续 4 秒，伤害 +1 倍
const LASER_MAX_MUL = 5; // 倍率上限（初始 1 倍 → 最高 5 倍）
// 索敌余量：只锁定「已经进入攻击范围」的敌人，仅留一点点余量避免边界抖动。
// 单位不再自动追击——敌人跑出范围就停火，想打就自己右键把它拉过去。
const ATTACK_SLACK = 10;
const SCAN_MS = 250; // 索敌重估间隔
const MELEE_RANGE = 65; // ≤ 该射程视为近战（弹道高速短命）

// ---- 弹道 ----
const BULLET_SPEED = 330;
const BULLET_SPEED_MELEE = 520;
const BULLET_LIFE_MS = 2400;
const BULLET_R = 5;
// 直射弹（非激光、非近战）命中后的爆炸半径：所有「子弹」都带溅射，
// 且落点落在目标碰撞体积的随机一点（见 unitFire 的 aimAng），所以擦边命中时一次能溅到多个单位。
const BULLET_SPLASH = 18;

// ---- 轰击（burst）抛射弹 ----
// 轰击不再走平直弹道，而是「抛射」：记录发射点 (sx,sy) 与落点 (tx,ty)，按飞行时间参数化，
// 地面位置在两点之间线性插值，高度 z 走一条抛物线（峰值为 peak，落地 z=0）。
// 因此无论目标躲到山后多远，弹都能**越过山脉**落到落点 —— 它既不撞山，溅射也不受山体遮挡。
// 飞行时长随距离拉长（远射更慢、弧更高），手感更接近曲射炮。
const SHELL_FLIGHT_BASE = 620; // 基础飞行时间（ms，落点极近时）
const SHELL_FLIGHT_PER_PX = 2.0; // 每多 1px 距离增加的飞行时间（ms）
const SHELL_PEAK_BASE = 46; // 基础弧顶高度（px）
const SHELL_PEAK_PER_PX = 0.52; // 每多 1px 距离增加的弧顶高度（px）

// ---- 燎原：喷火 / 灼烧地形 ----
// 燎原不再是「一发燃烧弹命中后挂一段持续掉血」，而是**持续喷吐火焰**：
// 火舌每步向前推进、在落点结算一次范围伤害（只伤敌方，单次极低但一直在烧），
// 同时**在落点铺开一片灼烧地形**。踩在灼烧地形上的单位会持续掉血，
// 而且这里敌我通吃 —— 这是全局唯一的友伤来源，所以数值压得很低、范围给得很大。
// 火场的寿命跟着「最后一次被火舌刷到」走：火焰一停，几秒内自然熄灭。
// **建筑只吃火舌的直接打击**：落点范围内的敌方建筑同样掉血，但地上的灼烧地形
// 对建筑完全无效 —— 想拆工厂/研究所/总部，就得把火舌一直喷在它身上。
const FLAME_R = 52; // 火舌落点的范围伤害半径（范围大）
const FLAME_PULSE_MS = 180; // 喷火的表现脉冲（枪口焰 + 后坐）—— 不是射速，火焰本身是连续的
const FIRE_MAX = 160; // 场上灼烧地块上限（防极端情况下列表无限膨胀）

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
const FIRE_TIERS = [
  null, // 一级：不留火场（只有火舌本身的范围伤害）
  { r: 46, dps: 3.5, lifeMs: 3000, mergeD: 34 }, // 二级：基准
  { r: 64, dps: 6, lifeMs: 5200, mergeD: 44 }, // 三级：更大 / 更久 / 更疼
];

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

// ---- 地形（元胞自动机：上半生成 + 180° 旋转出下半）----
// 类型编号与客户端（public/games/warfactory/ui.js）保持一致：
//   0 平原 / 2 山地（不可通行，窄而连续的山脉）/ 3 沼泽（可通行，减速）/ 4 水域（不可通行，大片连续）
// 其中「山地」另有高度：它同时遮挡视线与弹道（山两侧互相看不见、打不到）；
// 「水域」只是不可通行的平面，不遮挡视线，弹丸照常飞越水面。
const TERR_COLS = 108;
const TERR_ROWS = 72; // 偶数行：确保上下半 180° 旋转无缝衔接
const TERR_CELL = 40; // 4320/40=108，2880/40=72
const TT_PLAIN = 0;
const TT_MOUNTAIN = 2;
const TT_SWAMP = 3;
const TT_WATER = 4;
const TERRAIN_CLEAR_CELLS = 3; // 建筑周围清理「山地/水域」的格子半径（约 120px，覆盖出兵环）
const SWAMP_SLOW = 0.5; // 沼泽减速：处于沼泽的单位移动速度 ×0.5
const WATER_TOP = 0.28; // 高程低于此值 → 水域（大片连续，不可通行）
const SWAMP_TOP = 0.44; // 高程低于此值 → 沼泽（可通行，减速）
const SMOOTH_ROUNDS = 6; // 平滑轮数越多，水域越成大片
const MAJORITY_ROUNDS = 2; // 众数滤波轮数：抹掉孤立格，让水域/沼泽连成规整大片
const MIN_WATER_BLOB = 14; // 小于该格数的水域斑块并入沼泽，保证水域大片连续
const MIN_SWAMP_BLOB = 18; // 小于该格数的沼泽斑块并入平原（沼泽不零散混杂在平原里）
const MIN_PLAIN_BLOB = 8; // 小于该格数的平原斑块并入沼泽（沼泽内部不含零碎平原）
const MIN_PASSAGE = 2; // 最小通行通道宽度（格）：开运算消除宽度不足 2 格的狭窄缝隙
const RIDGE_COUNT = 3; // 上半区域的山脉条数（下半由 180° 旋转得到）
const RIDGE_WIDEN = 0.32; // 山脊加宽成 2 格的概率（控制山体「窄」）
// 寻路：每步最多新建多少个地形流场（缓存未命中时才建；超限的单位本步退回直线转向）
const FLOW_BUILD_PER_STEP = 8;
const FLOW_CACHE_MAX = 96; // 流场缓存上限（按目标格缓存）
// ---- 山体遮挡（山有高度）----
// 山地不只是「不可通行」：它还会挡住视线与弹道，山两侧的单位互相看不见、打不到。
// 水域只是不可通行（平面），不遮挡视线，弹丸照常飞过水面。
const LOS_STEP = TERR_CELL / 2; // 视线采样步长（半格 20px：不漏掉 1 格宽的山脊，也不会因擦角误判）
const BULLET_TERRAIN_STEP = 8; // 弹道逐帧位移可达 33px，需细分采样才不会「跨过」山脊

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

/**
 * 生成地形网格（仅生成上半，下半由上半 180° 旋转得到）。
 * - 水域 / 沼泽 / 平原：元胞自动机（随机高程场 → 多轮邻域扩散平滑 → 归一化 + 拉伸 → 阈值分类），
 *   平滑轮数较多，因此水域呈大片连续。
 * - 山地：不走阈值，改用「随机游走山脊」——若干条折线，宽度多为 1 格，故山体窄而连续成脉。
 * @returns {number[][]} grid[r][c] ∈ {0,2,3,4}
 */
function generateTerrainGrid(rng) {
  const gw = TERR_COLS;
  const gh = TERR_ROWS;
  const half = gh / 2;

  // 1) 仅生成上半：随机初始高程场
  const elev = [];
  for (let r = 0; r < half; r++) {
    elev[r] = [];
    for (let c = 0; c < gw; c++) elev[r][c] = rng();
  }

  // 2) 元胞自动机：多轮邻域扩散平滑 → 起伏地形（轮数多 → 水域成大片）
  for (let it = 0; it < SMOOTH_ROUNDS; it++) {
    const nx = [];
    for (let r = 0; r < half; r++) {
      nx[r] = [];
      for (let c = 0; c < gw; c++) {
        let sum = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= half || cc < 0 || cc >= gw) continue;
            sum += elev[rr][cc];
            n++;
          }
        }
        nx[r][c] = (elev[r][c] * 3 + sum) / (3 + n);
      }
    }
    for (let r = 0; r < half; r++) elev[r] = nx[r];
  }

  // 3) 归一化到 [0,1]，再做对比拉伸，避免平滑后高程挤在中段
  let mn = 1;
  let mx = 0;
  for (let r = 0; r < half; r++) {
    for (let c = 0; c < gw; c++) {
      if (elev[r][c] < mn) mn = elev[r][c];
      if (elev[r][c] > mx) mx = elev[r][c];
    }
  }
  const span = mx - mn || 1;
  const GAIN = 1.8;
  for (let r = 0; r < half; r++) {
    for (let c = 0; c < gw; c++) {
      let v = (elev[r][c] - mn) / span;
      v = (v - 0.5) * GAIN + 0.5;
      elev[r][c] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }

  // 4) 上半分类：低处水域 / 次低沼泽 / 其余平原
  const top = [];
  for (let r = 0; r < half; r++) {
    top[r] = [];
    for (let c = 0; c < gw; c++) {
      const e = elev[r][c];
      top[r][c] = e < WATER_TOP ? TT_WATER : e < SWAMP_TOP ? TT_SWAMP : TT_PLAIN;
    }
  }

  // 5) 元胞众数滤波：抹掉孤立格与锯齿边缘，让水域/沼泽连成规整大片
  majorityFilter(top);

  // 6) 山体：随机游走画出窄而连续的山脉（覆盖在上半网格上）
  drawRidges(top, rng);

  // 7) 抹掉面积过小的水域斑块（并入沼泽）——放在山脊之后，连被山脊切碎的水域也一并清掉，
  //    确保剩下的水域都是大片连续
  dropSmallBlobs(top, TT_WATER, MIN_WATER_BLOB, TT_SWAMP);

  // 8) 沼泽与平原分离：小块沼泽并入平原、沼泽内部的零碎平原并入沼泽，
  //    这样「沼泽区域」是一整块，不会和一小片一小片的平原互相穿插
  dropSmallBlobs(top, TT_SWAMP, MIN_SWAMP_BLOB, TT_PLAIN);
  dropSmallBlobs(top, TT_PLAIN, MIN_PLAIN_BLOB, TT_SWAMP);

  // 9) 保证通行通道最小宽度：把被障碍夹成 1 格宽的缝隙填掉，避免出现「一线天」
  widenPassages(top);

  // 10) 下半 = 上半 180° 旋转（点对称）
  const grid = [];
  for (let r = 0; r < gh; r++) {
    grid[r] = [];
    for (let c = 0; c < gw; c++) {
      const er = r < half ? r : gh - 1 - r;
      const ec = r < half ? c : gw - 1 - c;
      grid[r][c] = top[er][ec];
    }
  }
  return grid;
}

/**
 * 抹掉面积小于 minArea 的同类连通块，转为 fallback 类型。
 * 用于保证「水域是大片连续的」——零散小水坑并入沼泽。
 */
function dropSmallBlobs(grid, type, minArea, fallback) {
  const R = grid.length;
  if (!R) return;
  const C = grid[0].length;
  const seen = new Array(R * C).fill(false);
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (grid[r][c] !== type || seen[r * C + c]) continue;
      const st = [[r, c]];
      seen[r * C + c] = true;
      const cells = [];
      while (st.length) {
        const cur = st.pop();
        cells.push(cur);
        const y = cur[0];
        const x = cur[1];
        for (let k = 0; k < 4; k++) {
          const ny = y + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const nx = x + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (ny < 0 || ny >= R || nx < 0 || nx >= C) continue;
          if (seen[ny * C + nx] || grid[ny][nx] !== type) continue;
          seen[ny * C + nx] = true;
          st.push([ny, nx]);
        }
      }
      if (cells.length < minArea) {
        for (const cell of cells) grid[cell[0]][cell[1]] = fallback;
      }
    }
  }
}

/**
 * 保证通行通道最小宽度：形态学「开运算」（2×2 结构元先腐蚀再膨胀）。
 * 任何无法被某个「2×2 全可通行」方块覆盖的可通行格，都视为宽度不足 2 的窄缝，填成山地。
 * 为避免封缝后主陆被切断，逐个候选格试填：若使主陆可达面积下降则撤销该格（保持连通）。
 * 只在上半网格上运行，因此整图仍保持 180° 点对称。
 */
function widenPassages(grid) {
  const R = grid.length;
  if (!R || MIN_PASSAGE <= 1) return;
  const C = grid[0].length;
  const pass = (r, c) =>
    r >= 0 && r < R && c >= 0 && c < C && grid[r][c] !== TT_MOUNTAIN && grid[r][c] !== TT_WATER;

  // 1) 标记「被某个 2×2 全可通行方块覆盖」的格子
  const covered = [];
  for (let r = 0; r < R; r++) covered[r] = new Uint8Array(C);
  for (let r = 0; r < R - 1; r++) {
    for (let c = 0; c < C - 1; c++) {
      if (pass(r, c) && pass(r + 1, c) && pass(r, c + 1) && pass(r + 1, c + 1)) {
        covered[r][c] = 1;
        covered[r + 1][c] = 1;
        covered[r][c + 1] = 1;
        covered[r + 1][c + 1] = 1;
      }
    }
  }

  // 2) 候选：可通行但未被覆盖 → 处于宽度 1 的窄缝中
  const cand = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (pass(r, c) && !covered[r][c]) cand.push([r, c]);
    }
  }
  if (!cand.length) return;

  const flood = (sr, sc) => {
    const vis = new Uint8Array(R * C);
    if (!pass(sr, sc)) return { n: 0, first: sr * C + sc };
    const q = [sr * C + sc];
    vis[sr * C + sc] = 1;
    let n = 0;
    for (let h = 0; h < q.length; h++) {
      const cur = q[h];
      const cr = (cur / C) | 0;
      const cc = cur % C;
      n++;
      if (pass(cr + 1, cc) && !vis[cur + C]) { vis[cur + C] = 1; q.push(cur + C); }
      if (pass(cr - 1, cc) && !vis[cur - C]) { vis[cur - C] = 1; q.push(cur - C); }
      if (pass(cr, cc + 1) && !vis[cur + 1]) { vis[cur + 1] = 1; q.push(cur + 1); }
      if (pass(cr, cc - 1) && !vis[cur - 1]) { vis[cur - 1] = 1; q.push(cur - 1); }
    }
    return { n, first: q[0] };
  };

  // 3) 找最大连通分量作为连通性基准（以其任一格为种子）
  const seen = new Uint8Array(R * C);
  let seed = -1;
  let best = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (seen[r * C + c] || !pass(r, c)) continue;
      const res = flood(r, c);
      // 把该分量整体标记已访问
      const vis2 = new Uint8Array(R * C);
      const q = [r * C + c];
      vis2[r * C + c] = 1;
      for (let h = 0; h < q.length; h++) {
        const cur = q[h];
        const cr = (cur / C) | 0;
        const cc = cur % C;
        seen[cur] = 1;
        if (pass(cr + 1, cc) && !vis2[cur + C]) { vis2[cur + C] = 1; q.push(cur + C); }
        if (pass(cr - 1, cc) && !vis2[cur - C]) { vis2[cur - C] = 1; q.push(cur - C); }
        if (pass(cr, cc + 1) && !vis2[cur + 1]) { vis2[cur + 1] = 1; q.push(cur + 1); }
        if (pass(cr, cc - 1) && !vis2[cur - 1]) { vis2[cur - 1] = 1; q.push(cur - 1); }
      }
      if (res.n > best) {
        best = res.n;
        seed = r * C + c;
      }
    }
  }
  if (seed < 0) return;
  const sr = (seed / C) | 0;
  const sc = seed % C;
  let baseline = best;

  // 4) 逐个试填；若使主陆可达面积下降（被切断）则撤销
  for (const [r, c] of cand) {
    const old = grid[r][c];
    grid[r][c] = TT_MOUNTAIN;
    const n = flood(sr, sc).n;
    if (n < baseline) grid[r][c] = old;
  }
}

/** 元胞自动机「众数滤波」：每格取 3×3 邻域内占比最高的类型，抹掉孤立点与锯齿，使同类地形连成片 */
function majorityFilter(grid) {
  const R = grid.length;
  if (!R) return;
  const C = grid[0].length;
  for (let it = 0; it < MAJORITY_ROUNDS; it++) {
    const nx = [];
    for (let r = 0; r < R; r++) {
      nx[r] = [];
      for (let c = 0; c < C; c++) {
        const cnt = {};
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= R || cc < 0 || cc >= C) continue;
            const v = grid[rr][cc];
            cnt[v] = (cnt[v] || 0) + 1;
          }
        }
        let best = grid[r][c]; // 平票时保留原类型
        let bn = cnt[best] || 0;
        for (const k in cnt) {
          if (cnt[k] > bn) {
            best = Number(k);
            bn = cnt[k];
          }
        }
        nx[r][c] = best;
      }
    }
    for (let r = 0; r < R; r++) grid[r] = nx[r];
  }
}

/**
 * 随机游走山脊：在网格上画若干条折线，只走正交 4 方向（保证山体 4-连通不断裂），
 * 线宽多为 1 格、局部 2 格，故山体窄且连续成脉。
 * 只在上半区域绘制，下半由 180° 旋转得到，保证整图点对称。
 */
function drawRidges(grid, rng) {
  const half = grid.length;
  if (!half) return;
  const gw = grid[0].length;
  const dr4 = [-1, 0, 1, 0];
  const dc4 = [0, 1, 0, -1];
  const put = (r, c) => {
    if (r < 0 || r >= half || c < 0 || c >= gw) return;
    grid[r][c] = TT_MOUNTAIN;
  };
  for (let k = 0; k < RIDGE_COUNT; k++) {
    let r = Math.floor(rng() * half);
    let c = Math.floor(rng() * gw);
    let dir = Math.floor(rng() * 4);
    const len = Math.floor(gw * (0.9 + rng() * 1.2));
    for (let s = 0; s < len; s++) {
      put(r, c);
      // 偶尔向垂直于走向的一侧加宽一格（正交方向，保证连通）
      if (rng() < RIDGE_WIDEN) put(r + dr4[(dir + 1) % 4], c + dc4[(dir + 1) % 4]);
      // 小概率左右转向，形成折线而非直线
      if (rng() < 0.22) dir = (dir + (rng() < 0.5 ? 1 : 3)) % 4;
      let nr = r + dr4[dir];
      let nc = c + dc4[dir];
      if (nr < 0 || nr >= half || nc < 0 || nc >= gw) {
        dir = (dir + 2) % 4; // 撞边界折返，山脊连续不断
        nr = r + dr4[dir];
        nc = c + dc4[dir];
        if (nr < 0) nr = 0;
        else if (nr >= half) nr = half - 1;
        if (nc < 0) nc = 0;
        else if (nc >= gw) nc = gw - 1;
      }
      r = nr;
      c = nc;
    }
  }
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
    pts.push([cr, cc]);
    pts.push([TERR_ROWS - 1 - cr, TERR_COLS - 1 - cc]); // 180° 旋转格
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

/** 生成地形并挂到对局状态上（权威来源，下发给客户端渲染） */
function makeTerrain(game, seed) {
  const rng = makeRng((seed >>> 0) || 1);
  const grid = generateTerrainGrid(rng);
  clearTerrainAroundBuildings(game, grid);
  game.terrain = {
    cols: TERR_COLS,
    rows: TERR_ROWS,
    cell: TERR_CELL,
    grid,
  };
  return game.terrain;
}

/** 玩家出生点（椭圆均布），按人数取用 */
const BASE_ANGLES = {
  2: [180, 0],
  3: [150, 30, 270],
  4: [180, 0, 90, 270],
};
const ELLIPSE = { cx: 2160, cy: 1440, rx: 1800, ry: 1116 };

/** 中立战争工厂（等级固定在地图上，180° 旋转对称：绕世界中心 (2160,1440)） */
const NEUTRAL_FACTORIES = [
  { x: 1008, y: 1440, level: 1 },
  { x: 3312, y: 1440, level: 1 },
  { x: 1764, y: 2124, level: 1 },
  { x: 2556, y: 756, level: 1 },
  { x: 1764, y: 756, level: 2 },
  { x: 2556, y: 2124, level: 2 },
  { x: 2160, y: 1440, level: 3 },
];

/** 研究所（每座提供科技点产出） */
const LABS = [
  { x: 1260, y: 630 },
  { x: 3060, y: 630 },
  { x: 1260, y: 2250 },
  { x: 3060, y: 2250 },
];

/** 出兵类型权重 */
const SPAWN_WEIGHTS = [
  ['warrior', 24],
  ['shield', 18],
  ['ranger', 18],
  ['burst', 15],
  ['burn', 15],
  ['laser', 14],
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

/**
 * 开局为每座工厂**固定**一种生产单位类型，之后不再改变。
 * - 出生工厂：所有玩家统一同一种类型（保证绝对公平）；
 * - 中立工厂：按 180° 点对称配对分配（互为旋转对称的两座工厂同类型），保证对称性公平。
 * 同时初始化集结点（rally = null）。
 */
function assignProdTypes(factories, rng) {
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
      f.prodType = deck[0];
      done.add(f.id);
    }
  }
  for (const f of factories) {
    if (done.has(f.id)) continue;
    const t = nextType();
    f.prodType = t;
    done.add(f.id);
    // 找到 180° 旋转（绕世界中心点对称）对应的工厂，赋予同一类型
    const mx = WORLD_W - f.x;
    const my = WORLD_H - f.y;
    for (const g of factories) {
      if (done.has(g.id) || g.id === f.id) continue;
      if (Math.abs(g.x - mx) < 1 && Math.abs(g.y - my) < 1) {
        g.prodType = t;
        done.add(g.id);
      }
    }
  }
  for (const f of factories) {
    if (!f.prodType) f.prodType = TYPE_LIST[0];
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

/** 沼泽减速：处于沼泽格的单位移动速度 ×0.5（山地/水域不可通行，不会站在其上） */
function terrainSpeedFactor(game, u) {
  return terrainCell(game, u.x, u.y) === TT_SWAMP ? SWAMP_SLOW : 1;
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
 * 水域 / 沼泽 / 平原都不阻挡，只有 TT_MOUNTAIN 阻挡。
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
function nearestPassable(game, x, y, wantComp) {
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
  if (cb) {
    // 环形搜索（12 格 = 480px）没找到同分量格：全图扫描取最近的一个。
    // 2400 格的一次遍历，只在建流场时发生，可以忽略。
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
  const clearance = r == null ? 22 : r;
  for (let iter = 0; iter < 4; iter++) {
    const blocks = [];
    for (const f of game.factories || []) blocks.push([f.x, f.y, FACTORY_R + clearance]);
    for (const l of game.labs || []) blocks.push([l.x, l.y, LAB_R + clearance]);
    for (const h of game.hqs || []) {
      if (!h.down) blocks.push([h.x, h.y, HQ_R + clearance]);
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
 * 安全位移：仅在落点可通行时应用；被挡则退一步尝试单轴贴壁；仍不行则原地不动。
 * 用于单位分离/建筑推挤等「非主动移动」——这些地方绝不能把单位塞进山体或水里。
 * @returns {boolean} 是否发生了移动
 */
function moveIfPassable(game, u, nx, ny) {
  if (terrainPassable(game, nx, ny)) {
    u.x = nx;
    u.y = ny;
    return true;
  }
  if (terrainPassable(game, nx, u.y)) {
    u.x = nx;
    return true;
  }
  if (terrainPassable(game, u.x, ny)) {
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
 * 半径 r 的单位能否在此立足：地形可通行、不压建筑、不出世界边界。
 * 这是「移动落点」的统一判据——只判落点，不做寻路。
 */
function canStand(game, x, y, r) {
  if (x < r || x > WORLD_W - r || y < r || y > WORLD_H - r) return false;
  if (!terrainPassable(game, x, y)) return false;
  return !insideBuilding(game, x, y, r);
}

/**
 * 朝 ang 方向迈一步；若被挡，依次尝试 ±30°、±60°、±90°、±120°、±150° 的侧向候选，
 * 取第一个可立足的方向。用于贴着建筑/山体侧滑绕行，而不是傻站在障碍前。
 * @returns {boolean} 是否发生了移动
 */
const SLIDE_OFFSETS = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150];
function slideStep(game, u, ang, spd) {
  for (const off of SLIDE_OFFSETS) {
    const a = ang + (off * Math.PI) / 180;
    const nx = u.x + Math.cos(a) * spd;
    const ny = u.y + Math.sin(a) * spd;
    if (!canStand(game, nx, ny, u.r)) continue;
    u.x = nx;
    u.y = ny;
    u.angle = a;
    return true;
  }
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
  for (const f of game.factories || []) blocks.push([f.x, f.y, FACTORY_R + BLOCK_MARGIN]);
  for (const l of game.labs || []) blocks.push([l.x, l.y, LAB_R + BLOCK_MARGIN]);
  for (const h of game.hqs || []) {
    if (!h.down) blocks.push([h.x, h.y, HQ_R + BLOCK_MARGIN]);
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
      if (c0 > 0) {
        const n = cur - 1;
        if (pg[n] && lab[n] < 0) {
          lab[n] = id;
          stack[sp++] = n;
        }
      }
      if (c0 < cols - 1) {
        const n = cur + 1;
        if (pg[n] && lab[n] < 0) {
          lab[n] = id;
          stack[sp++] = n;
        }
      }
      if (cur >= cols) {
        const n = cur - cols;
        if (pg[n] && lab[n] < 0) {
          lab[n] = id;
          stack[sp++] = n;
        }
      }
      if (cur < total - cols) {
        const n = cur + cols;
        if (pg[n] && lab[n] < 0) {
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
 * 以目标点所在格为源做 BFS，得到「每格到目标的步数」流场；-1 表示不可达。
 * 目标格会先按「与 (fromX,fromY) 同属一个连通分量」修正——否则目标落在山体里时，
 * 最近的可通行格若是孤立小岛，整张流场会把单位所在大陆标成不可达（寻路直接失效）。
 * 按目标格缓存（集结点固定不变、群体下令共用同一目标，命中率很高）。
 * 60×40=2400 格的 BFS 只有几万次操作；再加一道「每步新建上限」兜底，
 * 避免大量单位各自追击不同移动目标时单步爆建流场（超限则退回直线转向）。
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
  const gp = nearestPassable(game, goalX, goalY, uc);
  if (!gp) return null;
  const gi = cellOf(game, gp.x, gp.y);
  if (!game._flowCache) game._flowCache = new Map();
  const hit = game._flowCache.get(gi.i);
  if (hit) return hit;
  // 每步新建流场的预算（step() 开头重置）
  if ((game._flowBudget || 0) <= 0) return null;
  game._flowBudget -= 1;

  const cols = t.cols;
  const rows = t.rows;
  const dist = new Int32Array(cols * rows).fill(-1);
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  dist[gi.i] = 0;
  queue[tail++] = gi.i;
  while (head < tail) {
    const cur = queue[head++];
    const nd = dist[cur] + 1;
    const c0 = cur % cols;
    const r0 = (cur - c0) / cols;
    if (c0 > 0) {
      const n = cur - 1;
      if (pg[n] && dist[n] < 0) {
        dist[n] = nd;
        queue[tail++] = n;
      }
    }
    if (c0 < cols - 1) {
      const n = cur + 1;
      if (pg[n] && dist[n] < 0) {
        dist[n] = nd;
        queue[tail++] = n;
      }
    }
    if (r0 > 0) {
      const n = cur - cols;
      if (pg[n] && dist[n] < 0) {
        dist[n] = nd;
        queue[tail++] = n;
      }
    }
    if (r0 < rows - 1) {
      const n = cur + cols;
      if (pg[n] && dist[n] < 0) {
        dist[n] = nd;
        queue[tail++] = n;
      }
    }
  }

  const field = { dist, cols, rows, goalIdx: gi.i, gx: gp.x, gy: gp.y, cell: t.cell };
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

/**
 * 沿流场朝目标推进一小步：优先走「到目标步数更少」的相邻格；
 * 若该方向被建筑/墙角挡住，则按侧向候选方向滑动绕行——
 * 流场本身只认地形（山地/水域），建筑的绕行由侧滑在局部完成。
 * @returns {boolean} 是否发生了移动
 */
function stepViaFlow(game, u, goalX, goalY, spd) {
  const direct = () => slideStep(game, u, Math.atan2(goalY - u.y, goalX - u.x), spd);
  // 已身处不可通行地形（异常）→ 先脱困，不参与寻路
  if (!terrainPassable(game, u.x, u.y)) return unstuckStep(game, u, spd);

  const f = flowField(game, goalX, goalY, u.x, u.y);
  if (!f) return direct();
  const t = game.terrain;
  const me = cellOf(game, u.x, u.y);
  const cur = f.dist[me.i];

  // 已在目标格内：直奔精确目标点
  if (cur === 0) {
    const d = dist(u.x, u.y, f.gx, f.gy);
    if (d < 0.5) return false;
    return slideStep(game, u, Math.atan2(f.gy - u.y, f.gx - u.x), Math.min(spd, d));
  }
  // 注意：这里不能在 cur < 0 时直接退回直线。
  // 单位可能正站在「建筑占位格」上（格心落在占位圆内 → 该格在掩码里是可通行 0），
  // 此时自身格不可达但相邻格可达；交给下面的邻域搜索即可正确走出。
  // 只有所有邻格都不可达（真的身处孤立分量）才会走到 bestIdx < 0 的直线兜底。

  const cols = f.cols;
  const rows = f.rows;
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
      if (dr && dc) {
        // 对角：两侧正交格必须也可通行，避免「切角」从障碍缝隙穿过
        if (f.dist[me.r * cols + c] < 0 || f.dist[r * cols + me.c] < 0) continue;
      }
      const cost = nd + (dr && dc ? 1.42 : 1);
      if (cost < bestCost - 1e-6) {
        bestCost = cost;
        bestIdx = ni;
        bestC = c;
        bestR = r;
      }
    }
  }
  if (bestIdx < 0) return direct();

  const tx = bestIdx === f.goalIdx ? f.gx : (bestC + 0.5) * t.cell;
  const ty = bestIdx === f.goalIdx ? f.gy : (bestR + 0.5) * t.cell;
  return slideStep(game, u, Math.atan2(ty - u.y, tx - u.x), spd);
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
  if (terrainPassable(game, u.x + dx, u.y + dy)) {
    u.x += dx;
    u.y += dy;
    return true;
  }
  const canX = terrainPassable(game, u.x + dx, u.y);
  const canY = terrainPassable(game, u.x, u.y + dy);
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
const HQ_MIN_GAP = 1500; // 任意两座总部之间的最小间距——「旋转克隆」之后也不能贴在一起
const HQ_BUILDING_GAP = 300; // 总部与中立工厂/研究所的最小额外间距（叠在建筑半径上）
const HQ_RADIUS_JITTER = 0.2; // 椭圆半径最多向内收缩 20%（让出生点不至于永远贴在最外圈）
const HQ_SPOT_TRIES = 160; // 每个出生点的重掷次数
const HQ_BASE_MARGIN = 200; // 出生点距世界边缘的最小距离

/** 椭圆环上的一点：angle 弧度、k 为半径缩放（1 = 标准椭圆） */
function ellipsePoint(angle, k) {
  return {
    x: ELLIPSE.cx + Math.cos(angle) * ELLIPSE.rx * k,
    y: ELLIPSE.cy + Math.sin(angle) * ELLIPSE.ry * k,
  };
}

/** 绕世界中心旋转 180°：地图就是「上半 180° 克隆出下半」，出生点按同一套配对 */
function mirrorPoint(p) {
  return { x: ELLIPSE.cx * 2 - p.x, y: ELLIPSE.cy * 2 - p.y };
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
function pickBasePositions(game, count, rng) {
  const table = BASE_ANGLES[count] || BASE_ANGLES[4];
  const rot = rng() * Math.PI * 2;
  const paired = count % 2 === 0;
  const out = new Array(count);
  const placed = [];
  /** 该点是否满足：不出界、离已放好的总部够远、避开中立工厂/研究所、（可选）四周走得出去 */
  const fits = (p, rule) => {
    if (p.x < HQ_BASE_MARGIN || p.x > WORLD_W - HQ_BASE_MARGIN) return false;
    if (p.y < HQ_BASE_MARGIN || p.y > WORLD_H - HQ_BASE_MARGIN) return false;
    for (const q of placed) if (dist(q.x, q.y, p.x, p.y) < rule.gap) return false;
    for (const f of NEUTRAL_FACTORIES) if (dist(f.x, f.y, p.x, p.y) < rule.build + FACTORY_R) return false;
    for (const l of LABS) if (dist(l.x, l.y, p.x, p.y) < rule.build + LAB_R) return false;
    return !rule.open || baseAreaOpen(game, p.x, p.y);
  };
  // 逐级放宽：① 够远 + 避让建筑 + 四周开阔 → ② 放弃「开阔」 → ③④ 只保「不贴脸」。
  // 注意最后一级仍要求 ≥ 2×占领半径，所以任何一档都不会把两座总部叠在一起。
  const LADDER = [
    { gap: HQ_MIN_GAP, build: HQ_BUILDING_GAP, open: true },
    { gap: HQ_MIN_GAP, build: HQ_BUILDING_GAP, open: false },
    { gap: Math.round(HQ_MIN_GAP * 0.6), build: CAPTURE_R * 2 + 60, open: false },
    { gap: CAPTURE_R * 2 + 20, build: CAPTURE_R * 2 + 20, open: false },
  ];
  const take = (p) => {
    placed.push(p);
    return { x: round1(p.x), y: round1(p.y) };
  };
  for (let i = 0; i < count; i++) {
    if (out[i]) continue; // 偶数人局：奇数位由同轴的伙伴（i^1）一并填好
    const mate = paired ? i ^ 1 : -1;
    const axis = ((table[i % table.length] * Math.PI) / 180) + rot;
    // 候选：整圈椭圆环上随机取点（不是只在角度表附近抖一抖 —— 那样一旦那片区域
    // 被湖/山压住就会全军覆没），末尾再补一个角度表上的标准点兜底。
    const cands = [];
    for (let t = 0; t < HQ_SPOT_TRIES; t++) {
      cands.push(ellipsePoint(rng() * Math.PI * 2, 1 - rng() * HQ_RADIUS_JITTER));
    }
    cands.push(ellipsePoint(axis, 1));
    let p1 = null;
    let p2 = null;
    for (const rule of LADDER) {
      for (const c of cands) {
        if (!fits(c, rule)) continue;
        const m = mate >= 0 ? mirrorPoint(c) : null;
        if (m) {
          // 克隆点除了自己要合格，还得和本体拉开距离——否则两座总部会贴在一起
          if (dist(c.x, c.y, m.x, m.y) < rule.gap) continue;
          if (!fits(m, rule)) continue;
        }
        p1 = c;
        p2 = m;
        break;
      }
      if (p1) break;
    }
    if (!p1) {
      // 理论上到不了这里（最后一档几乎什么都收）。真到了就退回标准点，保证一定能开局
      p1 = ellipsePoint(axis, 1);
      p2 = mate >= 0 ? mirrorPoint(p1) : null;
    }
    out[i] = take(p1);
    if (mate >= 0) out[mate] = take(p2);
  }
  return out;
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

  // 无初始工厂：开局场上全部工厂都是中立的，需要靠打光血量去夺
  const factories = [];
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
      home: false,
      // 中立工厂只有完整工厂的 1/3 血量，被拿下后恢复满血
      hp: Math.round(FACTORY_HP * NEUTRAL_HP_RATIO),
      hpMax: FACTORY_HP,
      lastHitBy: -1,
      evoCd: 0,
    });
  }

  // 研究所：初始中立，和工厂一样有血量，打光即由最后一击者接管
  const labs = LABS.map((l, i) => ({
    id: i + 1,
    x: l.x,
    y: l.y,
    owner: -1,
    hp: Math.round(LAB_HP * NEUTRAL_HP_RATIO),
    hpMax: LAB_HP,
    lastHitBy: -1,
  }));

  // 每座工厂开局锁定一种生产单位类型，并初始化集结点
  assignProdTypes(factories, rng);

  const game = {
    type: 'warfactory',
    world: { w: WORLD_W, h: WORLD_H },
    consts: {
      factoryR: FACTORY_R,
      captureR: CAPTURE_R,
      captureRate: CAPTURE_RATE,
      reclaimRate: RECLAIM_RATE,
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
      stats: STATS,
      tierHp: TIER_HP,
      tierDmg: TIER_DMG,
      tierRange: TIER_RANGE,
      tierCd: TIER_CD,
      aggroBonus: 0, // 已废弃（不再有追击圈）：保留字段避免旧客户端读 consts 时取到 undefined
      attackSlack: ATTACK_SLACK,
      facLineCost: FAC_LINE_COST,
      facMaxLines: FAC_MAX_LINES,
      prodSpeedCost: PROD_SPEED_COST,
      prodSpeedMax: PROD_SPEED_MAX,
      prodSpeedStep: PROD_SPEED_STEP,
      flameR: FLAME_R,
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

  // 生成地形（元胞自动机上半 + 180° 旋转下半），并清理建筑周围水域
  const terrainSeed = hashStr(
    (room && room.id ? room.id : 'wf') +
      '|' +
      chosen.map((p) => p.id).join(',') +
      '|' +
      WORLD_W +
      'x' +
      WORLD_H
  );
  makeTerrain(game, terrainSeed);

  // 总部位置：在椭圆环上随机取点（同一房间同一布局，换房即换布局），
  // 但要过「最小间距 + 避让中立建筑 + 四周可走」三关，避免总部与总部（含 180° 克隆点）挨太近。
  const bases = pickBasePositions(game, players.length, makeRng((terrainSeed ^ 0x9e3779b9) >>> 0));
  for (let i = 0; i < players.length; i++) {
    players[i].baseX = bases[i].x;
    players[i].baseY = bases[i].y;
  }

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
  }));

  // 出生点周围的山/水一并清成平原（含 180° 克隆格），否则开局部队会被地形封死
  clearTerrainAroundBuildings(game, game.terrain.grid);

  // 开局部队：每名玩家在总部旁拥有「每种初级单位各一个」（无初始工厂，工厂全靠打下来）
  const hqSource = { id: 0, owner: 0, level: 3 }; // level 3 → 总部亲兵可一路进阶到顶阶
  for (let i = 0; i < players.length; i++) {
    hqSource.owner = i;
    const hq = game.hqs[i];
    TYPE_LIST.forEach((type, k) => {
      const ang = (k / TYPE_LIST.length) * Math.PI * 2 + rng() * 0.4;
      spawnUnit(
        game,
        hqSource,
        type,
        hq.x + Math.cos(ang) * (HQ_R + 26),
        hq.y + Math.sin(ang) * (HQ_R + 26)
      );
    });
  }

  return game;
}

function spawnUnit(game, fac, type, x, y) {
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
    x: sx,
    y: sy,
    angle: game._rng() * Math.PI * 2,
    hp: st.hp,
    maxHp: st.hp,
    dmg: st.dmg,
    range: st.range,
    cdMax: st.cd,
    cdLeft: 0,
    nextFireAt: 0, // 激光兵专用：下一次可射击的绝对时间戳（步进 dt 固定为 0.1s，用绝对时间可避免浮点累积导致射速漂移）
    speed: s.speed,
    r: s.r,
    splash: s.splash || 0,
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
    burning: false, // 当前是否站在灼烧地形里（客户端据此画身上的火苗）
    pulseAt: 0, // 上一次喷火表现脉冲（枪口焰/后坐）的时间戳
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
 * 该玩家的「平均」研究点产出（点/秒）= 已占领研究所数 × (RP_PER_LAB / RP_PERIOD_MS)。
 * 仅用于界面展示与测试推算：实际结算是离散跳变的（每 RP_PERIOD_MS 一次性发放整数点），
 * 本函数不参与结算。
 */
function researchRate(game, ownerIdx) {
  return (labCountOf(game, ownerIdx) * RP_PER_LAB * 1000) / RP_PERIOD_MS;
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
    const n = labCountOf(game, i);
    if (n <= 0) {
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
      p.rp = Math.min(RP_CAP, p.rp + n * RP_PER_LAB);
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
  return true;
}

/* ---------------- 工厂血量 / 易主 ---------------- */

/* ---------------- 研究所 / 总部 血量与易主 ---------------- */

/**
 * 研究所受击：血打光时由「最后一击者」接管，并立刻恢复满血（同工厂规则）。
 */
function damageLab(game, l, amount, killerIdx) {
  if (!l || amount <= 0) return;
  if (killerIdx == null || killerIdx < 0 || killerIdx >= game.players.length) return;
  if (l.owner === killerIdx) return; // 自家研究所不受自家伤害
  l.hp -= amount;
  l.lastHitBy = killerIdx;
  if (l.hp > 0) {
    if (l.hp > l.hpMax) l.hp = l.hpMax;
    return;
  }
  const prev = l.owner;
  l.owner = killerIdx;
  l.hp = l.hpMax; // 归属权发生变化 → 血量恢复满
  l.lastHitBy = -1;
  game.players[killerIdx].captured += 1;
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
 * 工厂受击：血打光时由「最后一击者」接管该厂，并立刻恢复满血。
 * @param {object} f 工厂
 * @param {number} amount 伤害
 * @param {number} killerIdx 造成伤害的玩家下标
 */
function damageFactory(game, f, amount, killerIdx) {
  if (!f || amount <= 0) return;
  if (killerIdx == null || killerIdx < 0 || killerIdx >= game.players.length) return;
  if (f.owner === killerIdx) return; // 自家工厂不受自家伤害
  f.hp -= amount;
  f.lastHitBy = killerIdx;
  if (f.hp > 0) {
    if (f.hp > f.hpMax) f.hp = f.hpMax;
    return;
  }
  const prev = f.owner;
  f.owner = killerIdx;
  f.hp = f.hpMax; // 归属权发生变化 → 血量恢复满
  f.capProg = 0;
  f.capBy = -1;
  f.prodProg = 0;
  f.rally = null; // 易主则清除前任主人设的集结点
  f.lastHitBy = -1;
  game.players[killerIdx].captured += 1;
  game._captures = (game._captures || 0) + 1;
  pushEvent(game, { t: 'cap', fid: f.id, oi: f.owner, prev, x: f.x, y: f.y });
}

/**
 * 工厂每帧维护：争夺态 + 供客户端展示的「已损血百分比」。
 * 易主不再靠站桩读条，而是由 damageFactory 在血尽时判定（最后一击者得厂）。
 * @returns {number} 本帧之前累计的易主次数
 */
function updateFactories(game, dt) {
  for (const f of game.factories) {
    if (f.hpMax == null) {
      f.hpMax = FACTORY_HP;
      f.hp = f.owner >= 0 ? FACTORY_HP : Math.round(FACTORY_HP * NEUTRAL_HP_RATIO);
    }
    if (f.evoCd > 0) f.evoCd = Math.max(0, f.evoCd - dt * 1000);
    f.capProg = f.hpMax > 0 ? clamp((1 - f.hp / f.hpMax) * 100, 0, 100) : 0;
    f.capBy = f.capProg > 0 ? f.lastHitBy : -1;
    const camps = new Set();
    for (const u of game.units) {
      if (u.dead) continue;
      if (dist(u.x, u.y, f.x, f.y) > CAPTURE_R) continue;
      camps.add(u.ownerIdx);
    }
    f.contested = camps.size > 1;
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

function updateProduction(game, dt, now) {
  const dtMs = dt * 1000;
  void now; // 保留时间参数以维持签名（生产节奏完全由 dt / 间隔决定）
  // 每名玩家当前部队数（兵力上限判定用；每步只统计一次）
  const counts = game.players.map((_, i) => unitCountOf(game, i));
  for (const f of game.factories) {
    if (f.owner < 0) continue;
    const lines = clamp(Math.round(f.lines || 1), 1, FAC_MAX_LINES);
    // 多产线并行：进度按「产线数」倍速累积，但一次只吐一支（不爆兵），
    // 因此等效产出速率 = 1 / (间隔/产线数)。兵力达上限时进度停在 lines（不丢进度），有部队阵亡立刻补出。
    f.prodProg = Math.min(lines, f.prodProg + (dtMs / prodIntervalMs(game, f.owner)) * lines);
    if (f.prodProg < 1) continue;
    if (counts[f.owner] >= PLAYER_UNIT_CAP) continue; // 已达每玩家兵力上限 → 暂停生产
    f.prodProg -= 1;
    const ang = game._rng() * Math.PI * 2;
    const d = FACTORY_R + 28;
    // 每座工厂只生产开局锁定的那一种单位
    const u = spawnUnit(
      game,
      f,
      f.prodType || pickWeighted(game._rng),
      f.x + Math.cos(ang) * d,
      f.y + Math.sin(ang) * d
    );
    if (u) counts[f.owner] += 1; // 同一帧内多厂产出也要计入
    // 设了集结点的工厂：新兵自动前往集结点（期间照常边走边打，不需要脱离窗口）
    if (u && f.rally) {
      u.moveX = f.rally.x;
      u.moveY = f.rally.y;
    }
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

function findTarget(game, u) {
  // 轰击（burst）是曲射炮：弹道越过山脉，所以即使中间隔着山也能索敌、也能打到山另一侧。
  // 其余兵种仍受视线遮挡（山挡住就看不见、打不到）。
  const overMountain = Boolean(u.splash);
  // 索敌半径 = 自身攻击范围（单位按中心距 + 目标半径，建筑按到边缘的距离）+ 少量余量。
  // 不再有「射程 + 70」的追击圈：敌人没进范围就当作看不见，单位原地待命。
  let best = null;
  let bestD = Infinity;
  for (const e of game.units) {
    if (e.dead || e.ownerIdx === u.ownerIdx) continue;
    const d = dist(u.x, u.y, e.x, e.y);
    if (d > u.range + e.r + ATTACK_SLACK) continue;
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
    if (d > u.range + ATTACK_SLACK) return;
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
  const speed = kind === 'melee' ? BULLET_SPEED_MELEE : BULLET_SPEED;
  const ang = Math.atan2(target.y - u.y, target.x - u.x);
  u.angle = ang;
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
    const gdx = aimX - sx;
    const gdy = aimY - sy;
    const D = Math.hypot(gdx, gdy);
    const flightDur = SHELL_FLIGHT_BASE + D * SHELL_FLIGHT_PER_PX;
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
 * 推一条「开火」事件：枪口位置 + 朝向（弧度）+ 弹种 + 射手 id/体型。
 * 客户端据此在枪口喷出火焰并让射手向后一顿（后坐）——
 * 弹道快照是 10Hz 抽样的，靠它推不出「哪一下是刚开的火」。
 */
function pushShot(game, u, ang, kindIx) {
  pushEvent(game, {
    t: 'shot',
    x: round1(u.x + Math.cos(ang) * (u.r + 5)),
    y: round1(u.y + Math.sin(ang) * (u.r + 5)),
    a: round2(ang),
    k: kindIx,
    oi: u.ownerIdx,
    uid: u.id,
    r: Math.round(u.r),
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
  });
}

/**
 * 激光兵当前伤害倍率：锁定同一个目标越久越高。
 * 前摇期间恒为 1 倍，之后线性上升，LASER_WINDUP_MS + LASER_RAMP_MS 时达到 LASER_MAX_MUL 倍。
 */
function laserMul(u, now) {
  if (!u.laser || !u.lockStart) return 1;
  const held = now - u.lockStart - LASER_WINDUP_MS;
  if (held <= 0) return 1;
  const t = Math.min(1, held / LASER_RAMP_MS);
  return 1 + (LASER_MAX_MUL - 1) * t;
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
  // 开火表现：枪口一记冷光蓄能焰 + 命中点一团灼痕（激光不走弹道，全靠这两个事件表现）
  pushShot(game, u, ang, SHOT_KIND_LASER);
  pushEvent(game, {
    t: 'hit',
    x: round1(target.x - Math.cos(ang) * (target.r || 0)),
    y: round1(target.y - Math.sin(ang) * (target.r || 0)),
    a: round2(ang),
    k: SHOT_KIND_LASER,
    oi: u.ownerIdx,
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
 * - **燎原例外**：它不点射，而是持续喷火（每步结算一次火舌，见 sprayFlame），
 *   所以走的是 `u.burn` 那条分支，不参与 cd 与弹道。
 */
function updateUnits(game, dt, now) {
  for (const u of game.units) {
    if (u.dead) continue;
    if (u.cdLeft > 0) u.cdLeft -= dt;

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
        const reach = u.range + target.r;
        const td = dist(u.x, u.y, target.x, target.y);
        if (td > reach) {
          u.angle = Math.atan2(target.y - u.y, target.x - u.x);
          const spd = u.speed * dt * terrainSpeedFactor(game, u);
          // 单步不超过「距射程边缘的距离」，贴到边缘就停，不会越过目标或绕圈
          const step = Math.min(spd, Math.max(2, td - reach));
          stepViaFlow(game, u, target.x, target.y, step);
        }
      }
    } else if (u.moveX != null) {
      const md = dist(u.x, u.y, u.moveX, u.moveY);
      if (md <= 26) {
        u.moveX = null;
        u.moveY = null;
      } else {
        u.angle = Math.atan2(u.moveY - u.y, u.moveX - u.x);
        const spd = u.speed * dt * terrainSpeedFactor(game, u);
        // 沿地形流场绕开山地与水域抵达指令点（集结点派遣同样走这里）
        if (!stepViaFlow(game, u, u.moveX, u.moveY, spd)) {
          if (md <= 26 + TERR_CELL) {
            u.moveX = null;
            u.moveY = null;
          }
        }
      }
    }

    // ---- 开火：目标进入攻击范围就打（无论正在移动还是站着）----
    // 追击途中视线被山挡（绕路中）→ 打得着才开火，别穿山打。
    const tDist = target ? dist(u.x, u.y, target.x, target.y) : 0;
    const tReach = target ? u.range + target.r : 0;
    const inRange = Boolean(target) && tDist <= tReach && !losBlockedNow;

    // 燎原：不是「点射」，而是**持续喷吐**。只要目标在射程内，每步都推一次火舌
    // （伤害按 dt 结算，没有弹道、没有命中判定），火舌的落点就是「火焰落下的地方」。
    // 锁定状态（lockKind/lockId）同时下发给客户端，让它自己连线画出这道火舌 ——
    // 与激光兵共用同一套「锁定目标」下发格式。
    if (u.burn) {
      u.lockKind = inRange ? (target.kind === 'fac' ? 2 : target.kind === 'lab' ? 3 : target.kind === 'hq' ? 4 : 1) : 0;
      u.lockId = inRange ? (target.kind ? target.ref.id : target.id) : 0;
      if (inRange) {
        u.angle = Math.atan2(target.y - u.y, target.x - u.x);
        // 落点取「朝目标方向推进到目标身上」——目标在射程内，所以这一步不会超出射程
        const reach = Math.min(tDist, u.range + target.r);
        sprayFlame(game, u, u.x + Math.cos(u.angle) * reach, u.y + Math.sin(u.angle) * reach, dt, now);
      }
      continue;
    }

    // 激光兵：维护「锁定」。只有真正进入射程才开始蓄能；换目标（或目标丢失/离开射程）
    // 立刻重置倍率并进入前摇，前摇期间不开火。
    if (u.laser) {
      const key = inRange
        ? (target.kind || 'u') + ':' + (target.kind ? target.ref.id : target.id)
        : '';
      if (key !== u.lockKey) {
        u.lockKey = key;
        u.lockStart = key ? now : 0;
        u.windupUntil = key ? now + LASER_WINDUP_MS : 0;
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
      u.angle = Math.atan2(target.y - u.y, target.x - u.x);
      // 激光兵用绝对时间控制射速；其余兵种沿用倒计时（浮点累减会略慢，属既有手感）
      const ready = u.laser ? now >= u.nextFireAt : u.cdLeft <= 0;
      if (ready && !(u.laser && now < u.windupUntil)) {
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
 * 一次火舌推进：燎原每步（约每秒 20+ 次）对落点做一次结算。
 *
 * ① 落点范围伤害：`FLAME_R` 内的一切**敌方**单位按秒伤持续掉血（山挡住的打不到）。
 *    这是「持续喷吐」而不是「一发一发打」——所以没有弹道、没有命中判定，伤害按 dt 结算。
 *    各阶都一样：火焰本身就会烧人，**留不留灼烧地形才是分阶的地方**。
 * ② 落点范围内的**敌方建筑**（工厂 / 研究所 / 总部）同样按秒伤掉血 —— 这是「直接打击」，
 *    与炮击溅射同规则（自家建筑免疫、山挡住打不到）。注意：只有火舌**直接烧到**才结算，
 *    地上那片灼烧地形对建筑完全无效（见 updateFires）。
 * ③ 在落点铺开 / 刷新一片灼烧地形 —— 只有**二级及以上**才铺（见 FIRE_TIERS）。
 * ④ 表现脉冲：每 FLAME_PULSE_MS 推一条 shot 事件（枪口焰 + 射手后坐）。
 *    若每步都推，客户端每秒会堆几十个焰，反而糊成一片。
 */
function sprayFlame(game, u, x, y, dt, now) {
  const dmg = u.dmg * dt;
  if (dmg > 0) {
    for (const e of game.units) {
      if (e.dead || e.ownerIdx === u.ownerIdx) continue;
      if (dist(e.x, e.y, x, y) > FLAME_R + e.r) continue;
      if (losBlocked(game, u.x, u.y, e.x, e.y)) continue;
      e.lastHitBy = u.id;
      retaliate(game, e, u.id);
      damageUnit(game, e, dmg, u.ownerIdx);
    }
    // 火舌直接烧到建筑才算数：工厂 / 研究所 / 总部按同一份秒伤掉血（规则同炮击溅射）
    for (const f of game.factories) {
      if (f.owner === u.ownerIdx) continue;
      if (dist(f.x, f.y, x, y) > FLAME_R + FACTORY_R) continue;
      if (losBlocked(game, u.x, u.y, f.x, f.y)) continue;
      damageFactory(game, f, dmg, u.ownerIdx);
    }
    for (const l of game.labs) {
      if (l.owner === u.ownerIdx) continue;
      if (dist(l.x, l.y, x, y) > FLAME_R + LAB_R) continue;
      if (losBlocked(game, u.x, u.y, l.x, l.y)) continue;
      damageLab(game, l, dmg, u.ownerIdx);
    }
    for (const h of game.hqs) {
      if (h.owner === u.ownerIdx || h.down) continue;
      if (dist(h.x, h.y, x, y) > FLAME_R + HQ_R) continue;
      if (losBlocked(game, u.x, u.y, h.x, h.y)) continue;
      damageHq(game, h, dmg, u.ownerIdx);
    }
  }
  const born = addFire(game, x, y, u.ownerIdx, now, u.tier);
  if (born) pushEvent(game, { t: 'flame', x: born.x, y: born.y, r: born.r, oi: u.ownerIdx, id: born.id });
  if (now >= (u.pulseAt || 0)) {
    u.pulseAt = now + FLAME_PULSE_MS;
    pushShot(game, u, Math.atan2(y - u.y, x - u.x), BULLET_KIND_IX.fire);
  }
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
  if (dist(victim.x, victim.y, shooter.x, shooter.y) > victim.range + shooter.r + ATTACK_SLACK) return;
  // 被山挡住的敌人不还击（看不见对方，还击只会让部队朝山体扎堆）
  if (losBlocked(game, victim.x, victim.y, shooter.x, shooter.y)) return;
  victim.targetId = shooter.id;
}

function explodeShell(game, b, x, y, now, overMountain) {
  b.dead = true;
  pushEvent(game, { t: 'boom', x: round1(x), y: round1(y), r: b.splash, oi: b.ownerIdx });
  // 溅射不越山（默认）：山脊另一侧的敌人不该被「隔山」炸到。
  // 但抛射弹（轰击）是飞越山脉落到落点的，落点那一侧的敌人理应被炸到 —— overMountain 时跳过 LOS。
  const sightOk = (ax, ay, bx, by) => overMountain || !losBlocked(game, ax, ay, bx, by);
  for (const e of game.units) {
    if (e.dead || e.ownerIdx === b.ownerIdx) continue;
    if (dist(e.x, e.y, x, y) > b.splash + e.r) continue;
    if (!sightOk(x, y, e.x, e.y)) continue;
    e.lastHitBy = b.shooterId || 0;
    retaliate(game, e, b.shooterId);
    damageUnit(game, e, b.dmg, b.ownerIdx);
  }
  // 炮击同样会砸伤范围内的敌方建筑（工厂 / 研究所 / 总部）
  for (const f of game.factories) {
    if (f.owner === b.ownerIdx) continue;
    if (dist(f.x, f.y, x, y) <= b.splash + FACTORY_R && sightOk(x, y, f.x, f.y)) {
      damageFactory(game, f, b.dmg, b.ownerIdx);
    }
  }
  for (const l of game.labs) {
    if (l.owner === b.ownerIdx) continue;
    if (dist(l.x, l.y, x, y) <= b.splash + LAB_R && sightOk(x, y, l.x, l.y)) {
      damageLab(game, l, b.dmg, b.ownerIdx);
    }
  }
  for (const h of game.hqs) {
    if (h.owner === b.ownerIdx || h.down) continue;
    if (dist(h.x, h.y, x, y) <= b.splash + HQ_R && sightOk(x, y, h.x, h.y)) {
      damageHq(game, h, b.dmg, b.ownerIdx);
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
      continue;
    }

    const ox = b.x;
    const oy = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // 山体有高度：弹道撞山即止。细分采样整段位移，避免 10Hz 下「一步跨过」山脊。
    // 炮击在坡面炸开（溅射同样不越山），直射弹撞山只是一个墨点。水面/沼泽不挡弹道。
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
        continue;
      }
    }

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
        explodeShell(game, b, b.tx, b.ty, now, false);
      }
      continue;
    }

    // 带爆炸半径的弹（直射弹 / 非越山炮击）：命中或越过落点即爆。
    // 子弹本身已瞄向目标碰撞体积上的随机一点，所以落点偏到边缘时，爆炸半径就可能把旁边的单位也卷进去。
    if (b.splash > 0) {
      const movedPast = (b.vx * (b.x - b.tx) + b.vy * (b.y - b.ty)) > 0;
      let hitSomething = false;
      for (const e of game.units) {
        if (e.dead || e.ownerIdx === b.ownerIdx) continue;
        if (dist(e.x, e.y, b.x, b.y) <= e.r + BULLET_R + 2) { hitSomething = true; break; }
      }
      if (movedPast || hitSomething) {
        explodeShell(game, b, b.x, b.y, now, false);
      }
      continue;
    }

    // 近战（无爆炸半径）：命中单体
    for (const e of game.units) {
      if (e.dead || e.ownerIdx === b.ownerIdx) continue;
      if (dist(e.x, e.y, b.x, b.y) <= e.r + BULLET_R) {
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
        if (dist(f.x, f.y, b.x, b.y) <= FACTORY_R + BULLET_R) {
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
        if (dist(l.x, l.y, b.x, b.y) <= LAB_R + BULLET_R) {
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
        if (dist(h.x, h.y, b.x, b.y) <= HQ_R + BULLET_R) {
          b.dead = true;
          pushHit(game, b);
          damageHq(game, h, b.dmg, b.ownerIdx);
          break;
        }
      }
    }
  }
  game.bullets = game.bullets.filter((b) => !b.dead);
  if (game.bullets.length > 400) game.bullets.splice(0, game.bullets.length - 400);
}

/* ---------------- 分离 / 尸体清理 ---------------- */

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

function reapDead(game) {
  const dead = game.units.filter((u) => u.dead);
  if (!dead.length) return 0;
  for (const u of dead) {
    const victim = game.players[u.ownerIdx];
    if (victim) victim.losses += 1;
    const ki = u.killerIdx;
    if (ki != null && ki >= 0 && ki !== u.ownerIdx && game.players[ki]) {
      game.players[ki].kills += 1;
    }
  }
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
      f.prodProg = 0;
      f.rally = null;
      f.lastHitBy = -1;
      f.hp = Math.round(FACTORY_HP * NEUTRAL_HP_RATIO); // 转为中立 → 只有 1/3 血量
    }
    for (const l of game.labs) {
      if (l.owner !== i) continue;
      l.owner = -1;
      l.lastHitBy = -1;
      l.hp = Math.round(LAB_HP * NEUTRAL_HP_RATIO);
    }
    for (const u of game.units) {
      if (u.ownerIdx === i) u.dead = true;
    }
    pushEvent(game, { t: 'elim', oi: i });
    dirty = true;
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

  game._captures = 0; // 易主 / 总部陷落由「打光血量」触发，这里统计本次步进内的次数
  game._flowBudget = FLOW_BUILD_PER_STEP; // 本步允许新建的寻路流场数
  updateResearch(game, dt);
  updateProduction(game, dt, now);
  updateFactories(game, dt);
  updateUnits(game, dt, now);
  updateBullets(game, dt, now);
  updateFires(game, dt, now);
  separateUnits(game);
  unstickAll(game);
  const kills = reapDead(game);
  const outcomeDirty = updateOutcome(game);
  const captured = game._captures || 0;
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
      ];
    }),
    f: game.factories.map((f) => [
      f.id,
      f.owner,
      Math.round(f.capProg),
      f.capBy,
      round2(f.prodProg),
      f.contested ? 1 : 0,
      Math.round(f.hp), // 工厂当前血量（打光即易主）
      Math.round(f.evoCd || 0), // 手动进化冷却剩余（毫秒）
      clamp(Math.round(f.lines || 1), 1, FAC_MAX_LINES), // 产线数（1..3）：并行生产
    ]),
    // 研究所：[id, 归属, 当前血量, 满血]（同样是打光即易主）
    lb: game.labs.map((l) => [l.id, l.owner, Math.round(l.hp), Math.round(l.hpMax)]),
    // 总部：[id, 归属, 当前血量, 满血, 是否已陷落, 进化冷却剩余, 生产加速等级]
    hq: game.hqs.map((h) => [
      h.id,
      h.owner,
      Math.round(h.hp),
      Math.round(h.hpMax),
      h.down ? 1 : 0,
      Math.round(h.evoCd || 0),
      clamp(Math.round(h.speedLv || 0), 0, PROD_SPEED_MAX),
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
      rpPerPeriod: labCountOf(game, i) * RP_PER_LAB, // 下次结算将发放的点数（0 = 不产出）
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
      home: Boolean(f.home),
      hp: Math.round(f.hp),
      hpMax: f.hpMax,
      pt: f.prodType || TYPE_LIST[0], // 本厂固定生产的兵种
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
      // 该玩家当前「单条产线」的生产间隔（毫秒，已计入加速）：客户端直接展示，不必自己算
      prodIntervalMs: Math.round(prodIntervalMs(game, h.owner)),
    })),
    units: game.units.length,
    over: Boolean(game.over),
    winnerId: game.winnerId || null,
    seq: game.seq,
    serverTime: Date.now(),
    // 地形（权威）：客户端据此渲染，保证主客端一致
    terrain: game.terrain
      ? {
          cell: game.terrain.cell,
          cols: game.terrain.cols,
          rows: game.terrain.rows,
          data: terrainToData(game.terrain),
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
    // 落点若压在建筑上，挪到建筑外缘——否则部队会绕着那栋建筑打转（目标不可达）
    const p = snapOutsideBuildings(game, clamp(x, 0, WORLD_W), clamp(y, 0, WORLD_H));
    const tx = p.x;
    const ty = p.y;
    let n = 0;
    for (const u of game.units) {
      if (u.dead || u.ownerIdx !== oi) continue;
      if (!ids.includes(u.id)) continue;
      u.moveX = tx;
      u.moveY = ty;
      u.targetId = 0; // 立刻重新索敌（移动中照常开火，所以不需要脱离窗口）
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
      u.scanAt = 0; // 立刻重新索敌，不用等下一个扫描周期（250ms）
      n++;
    }
    return n > 0;
  }
  if (cmd === 'rally') {
    const fid = Number(d.fid);
    if (!Number.isFinite(fid)) return false;
    const f = game.factories.find((x) => x.id === fid);
    if (!f || f.owner !== oi) return false; // 只能给自己名下的工厂设集结点
    if (d.clear) {
      f.rally = null;
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
      let fc = cb.lab[cellOf(game, f.x, f.y).i];
      if (fc < 0) {
        const fnp = nearestPassable(game, f.x, f.y);
        if (fnp) fc = cb.lab[cellOf(game, fnp.x, fnp.y).i];
      }
      if (fc >= 0) {
        const rp = nearestPassable(game, p.x, p.y, fc);
        if (!rp) return false;
        p = rp;
      }
    }
    f.rally = { x: p.x, y: p.y };
    return true;
  }
  if (cmd === 'facEvolve') {
    // 手动进阶：消耗 500 科技点，把一支部队立刻提升一阶。
    // fid > 0 → 该工厂产出的部队；fid === 0 → 总部亲兵（初始那批，无工厂可点时用）。
    const raw = Number(d.fid);
    if (!Number.isFinite(raw)) return false;
    const fid = raw === 0 ? 0 : Math.round(raw);
    let cdOwner = null; // 冷却挂在建筑上：工厂用 f.evoCd，总部用 hq.evoCd
    if (fid === 0) {
      const hq = game.hqs.find((h) => h.owner === oi);
      if (!hq || hq.down) return false;
      if (hq.evoCd > 0) return false; // 冷却中
      cdOwner = hq;
    } else {
      const f = game.factories.find((x) => x.id === fid);
      if (!f || f.owner !== oi) return false; // 只能操作自己名下的工厂
      if (f.level < 2) return false; // 初级工厂的兵最高只有一阶，无从进化
      if (f.evoCd > 0) return false; // 冷却中
      cdOwner = f;
    }
    if (p.rp < EVOLVE_RP_COST) return false; // 科技点不足
    // 候选：该建筑产出、存活、尚未到顶阶的部队；优先最低阶（性价比最高）
    let pick = null;
    for (const u of game.units) {
      if (u.dead || u.ownerIdx !== oi || (u.homeFac || 0) !== fid) continue;
      if (u.tier >= u.maxTier) continue;
      if (!pick || u.tier < pick.tier) pick = u;
    }
    if (!pick) return false;
    const before = pick.tier;
    if (!promoteUnit(game, pick)) return false;
    if (pick.tier === before) return false;
    p.rp -= EVOLVE_RP_COST; // 扣科技点
    cdOwner.evoCd = FAC_EVOLVE_CD;
    game._captures = (game._captures || 0) + 1; // 让客户端立刻看到扣费后的点数
    pushEvent(game, { t: 'fcevo', fid, oi, tier: pick.tier, x: round1(pick.x), y: round1(pick.y) });
    return true;
  }
  if (cmd === 'facLine') {
    // 开辟产线：花科技点在自有工厂上再加一条产线（最多 FAC_MAX_LINES 条）。
    // 产线并行生产，同一时间一座工厂就能同时出多个单位。
    const fid = Math.round(Number(d.fid));
    const f = game.factories.find((x) => x.id === fid);
    if (!f || f.owner !== oi) return false; // 只能给自己名下的工厂开产线
    const lines = clamp(Math.round(f.lines || 1), 1, FAC_MAX_LINES);
    if (lines >= FAC_MAX_LINES) return false; // 已满产
    if (p.rp < FAC_LINE_COST) return false; // 科技点不足
    p.rp -= FAC_LINE_COST;
    f.lines = lines + 1;
    game._captures = (game._captures || 0) + 1; // 让客户端立刻看到扣费与产线变化
    pushEvent(game, { t: 'line', oi, fid, lines: f.lines, x: round1(f.x), y: round1(f.y) });
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
      u.targetId = 0;
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
      f.prodProg = 0;
      f.rally = null;
      f.lastHitBy = -1;
      f.hp = Math.round(FACTORY_HP * NEUTRAL_HP_RATIO); // 转为中立 → 只有 1/3 血量
    }
  }
  for (const l of game.labs) {
    if (l.owner !== oi) continue;
    l.owner = -1;
    l.lastHitBy = -1;
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
    prodIntervalMs,
    promoteUnit,
    laserMul,
    laserZap,
    terrainCell,
    terrainSpeedFactor,
    terrainPassable,
    losBlocked,
    mountainHitAlong,
    canStand,
    nearestPassable,
    stepViaFlow,
    flowField,
    cellOf,
    passGrid,
    compLabels,
    stepUnit,
    damageUnit,
    generateTerrainGrid,
    makeTerrain,
    clearTerrainAroundBuildings,
    terrainToData,
    consts: {
      WORLD_W,
      WORLD_H,
      FACTORY_R,
      CAPTURE_R,
      CAPTURE_RATE,
      RECLAIM_RATE,
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
      STATS,
      NEUTRAL_FACTORIES,
      LABS,
      COLORS,
      TERR_COLS,
      TERR_ROWS,
      TERR_CELL,
      TT_PLAIN,
      TT_MOUNTAIN,
      TT_SWAMP,
      TT_WATER,
      LOS_STEP,
      SWAMP_SLOW,
      WATER_TOP,
      SWAMP_TOP,
      RIDGE_COUNT,
      LASER_WINDUP_MS,
      LASER_RAMP_MS,
      LASER_MAX_MUL,
      FLAME_R,
      FLAME_PULSE_MS,
      FIRE_TIERS,
      FIRE_MAX,
      BULLET_SPLASH,
      ATTACK_SLACK,
      FAC_LINE_COST,
      FAC_MAX_LINES,
      PROD_SPEED_COST,
      PROD_SPEED_MAX,
      PROD_SPEED_STEP,
    },
  },
};
