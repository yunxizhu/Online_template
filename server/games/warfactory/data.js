'use strict';

/**
 * 战争工厂（warfactory）平衡数据总表 —— 手动调参的唯一入口。
 *
 * 这里集中了「兵种属性 / 进化兵种独立数据表 / 科技费用 / 建筑数值 / 总部防卫 /
 * 激光参数 / 火焰档位 / 出兵权重 / 开局部队」。服务端 index.js 通过
 * `const WFData = require('./data.js')` 引入并解构成同名常量，其余逻辑文件保持
 * 原样引用，因此本文件之外不要再把魔数写死在代码里。改数值只需动这里，无需改其他文件。
 *
 * ===================== 格子单位制 =====================
 * 本表里所有「长度」都以**格**为单位，像素由 grid.cell 换算得出：
 *   - `size`  单位 / 建筑占多少格见方（1 级兵 2×2、2 级 3×3、3 级 4×4、工厂 12×12）
 *             碰撞半径 r = size / 2 格 = size * grid.cell / 2 像素
 *   - `range` 攻击 / 射程半径，以格计
 *   - `splash` 溅射半径、`flame.r` 火舌半径、`fireTiers[].r / mergeD` 火场半径，均以格计
 *   - `captureR` 占领判定半径、`hqDefense.range` 总部防卫射程，以格计
 * 非长度量仍用原单位：hp 血量、dmg 伤害、cd 攻击间隔(秒)、speed 移速(px/s)、
 * bulletSpeed 弹速(px/s)、dps 每秒伤害、lifeMs 毫秒、各类费用为科技点。
 *
 * 单位说明：
 *   - 科技点（RP）是统一的「科技货币」，开辟产线 / 进化产线 / 提速都花它。
 *   - 1 阶（出厂阶）数值写在 `units` 里；2 阶 / 3 阶（进化阶）写在 `evolved`
 *     里，是「完整且独立」的属性块（hp/dmg/range/cd/speed/bulletSpeed/size），不再由 1 阶 × 系数
 *     得到，因此每个进化兵种都能单独手改、互不影响。
 *     ⚠️ 改 `units` 不会自动同步 `evolved`，两边要一起改。
 *   - 进化是**单一方向**：已取消 A 攻势 / B 守势 分支，2/3 阶的 `evolved` 数值就是
 *     最终属性，不再叠加任何分支修正。
 *   - `bulletSpeed` 是弹道飞行速度（px/s）。直射弹按它匀速飞；轰击抛射弹用它换算飞行时长。
 *     燎原 / 激光不走弹道，可不写。
 */

const WFData = {
  // ===================== 格子基准：1 格 = 多少像素 =====================
  grid: {
    cell: 10, // 1 格 = 10px。改这一个值即可整体缩放所有长度（半径 / 射程 / 建筑）。
  },

  // ===================== 兵种基础数据（出厂 1 阶数值） =====================
  // hp 血量 / dmg 单发伤害 / range 射程(格) / cd 攻击间隔(s)
  // speed 移动速度(px/s) / bulletSpeed 弹速(px/s) / size 占位格数(见方)
  // splash 溅射半径(格, 仅轰击) / burn 灼烧单位(仅燎原) / laser 激光单位(仅激光兵)
  units: {
    warrior: { label: '锐士', hp: 60, dmg: 8, range: 15, cd: 0.9, speed: 85, bulletSpeed: 9999, size: 2 },
    shield: { label: '盾卫', hp: 100, dmg: 8, range: 10, cd: 1.5, speed: 90, bulletSpeed: 9999, size: 3 },
    ranger: { label: '游侠', hp: 45, dmg: 25, range: 17, cd: 3.0, speed: 65, bulletSpeed: 3000, size: 2 },
    burst: { label: '轰击', hp: 35, dmg: 12, range: 32, cd: 2.5, speed: 65, bulletSpeed: 450, size: 2, splash: 4 },
    // 燎原：范围喷火，和其它兵种一样按次结算 —— dmg = 一口火的伤害，cd = 喷一口的间隔。
    burn: { label: '燎原', hp: 45, dmg: 6, range: 13, cd: 0.4, speed: 75, size: 2, burn: true },
    // 激光兵：持续光束直伤（不走弹道）。锁定越久伤害越高（见 laser 段），换目标重蓄能。
    laser: { label: '激光兵', hp: 40, dmg: 1, range: 18, cd: 0.4, speed: 65, size: 2, laser: true },
  },

  // ===================== 出兵类型权重（初始布阵用） =====================
  spawnWeights: [
    ['warrior', 24],
    ['shield', 18],
    ['ranger', 18],
    ['burst', 15],
    ['burn', 15],
    ['laser', 14],
  ],

  // ===================== 开局部队（总部旁亲兵） =====================
  // 每名玩家开局在总部旁获得的部队：[[兵种, 数量], ...]
  startRoster: [
    ['warrior', 4],
    ['laser', 2],
  ],

  // ===================== 进化兵种独立数据表（2 阶 / 3 阶） =====================
  // 每个兵种每个进化等级都是「完整且独立」的属性块，不再由 1 阶 × 系数得到。
  // size 按格子基准：2 阶占 3×3 格、3 阶占 4×4 格（1 阶为 2×2 格）。
  // 字段：hp 血量 / dmg 单发伤害 / range 射程(格) / cd 攻击间隔(s) /
  //       speed 移速(px/s) / bulletSpeed 弹速(px/s) / size 占位格数 /
  //       splash(仅轰击) / burn(仅燎原) / laser(仅激光兵)
  evolved: {
    warrior: {
      2: { hp: 100, dmg: 13, range: 18, cd: 0.9, speed: 70, bulletSpeed: 9999, size: 3 },
      3: { hp: 160, dmg: 20, range: 21, cd: 0.90, speed: 55, bulletSpeed: 9999, size: 4 },
    },
    shield: {
      2: { hp: 200, dmg: 13, range: 11, cd: 1.5, speed: 80, bulletSpeed: 9999, size: 4 },
      3: { hp: 300, dmg: 20, range: 12, cd: 1.5, speed: 70, bulletSpeed: 9999, size: 5 },
    },
    ranger: {
      2: { hp: 75, dmg: 40, range: 20, cd: 3, speed: 55, bulletSpeed: 3000, size: 3 },
      3: { hp: 125, dmg: 65, range: 23, cd: 3, speed: 45, bulletSpeed: 3000, size: 4 },
    },
    burst: {
      2: { hp: 65, dmg: 18, range: 35, cd: 2.5, speed: 55, bulletSpeed: 300, size: 3, splash: 4 },
      3: { hp: 110, dmg: 26, range: 48, cd: 2.5, speed: 45, bulletSpeed: 150, size: 4, splash: 4 },
    },
    burn: {
      2: { hp: 75, dmg: 8, range: 16, cd: 0.4, speed: 65, size: 3, burn: true },
      3: { hp: 125, dmg: 12, range: 19, cd: 0.4, speed: 55, size: 4, burn: true },
    },
    laser: {
      2: { hp: 70, dmg: 1.5, range: 21, cd: 0.4, speed: 55, size: 3, laser: true },
      3: { hp: 115, dmg: 2.5, range: 24, cd: 0.4, speed: 45, size: 4, laser: true },
    },
  },

  // ===================== 科技费用与上限（单位：科技点 RP） =====================
  tech: {
    upgradeRpCost: 300,     // 统一升级价（开辟 / 进化产线 / 提速 都用它）
    facLineCost: 300,       // 开辟一条新产线
    facLineEvolveCost: 300, // 进化一条产线
    prodSpeedCost: 300,     // 每次升级生产速度
    evolveRpCost: 200,      // 旧规则（单支部队手动进阶）的花费
    labLineCost: 200,       // 开拓研究产线
    facMaxLines: 2,         // 单厂产线上限（含默认那条）
    labMaxLines: 1,         // 每座研究所最多开拓的产线条数
    labLineRpMul: 1.5,      // 已开拓产线的研究所产出倍率（+50%）
    prodSpeedMax: 20,       // 提速升级次数上限
    prodSpeedStep: 1 / 15,  // 每次在现有间隔上再减少的比例
    facEvolveCd: 1000,      // 进化产线后的冷却(ms)
    rpCap: 9999,            // 科技点展示上限
    rpPerLab: 2,            // 每座已占领研究所每周期产出的科技点
    rpPeriodMs: 1500,       // 研究点结算周期(ms)
  },

  // ===================== 建筑数值 =====================
  buildings: {
    factoryHp: 5000,
    labHp: 5000,
    hqHp: 10000,
    // ---- 占位大小（格）---- 碰撞半径 = size / 2 格 = size * grid.cell / 2 像素
    factorySize: 12, // 工厂 12×12 格
    labSize: 6,      // 研究所 6×6 格
    hqSize: 9,       // 总部 9×9 格
    captureR: 8,     // 占领判定半径（格）
    captureRate: 25, // 每秒占领进度（无守军时 4 秒占领）
    reclaimRate: 45, // 守方在场时的进度回退速度
    produceMs: 20000,// 出兵间隔（每座工厂每 20 秒生产 1 支）
    neutralHpRatio: 1 / 2, // 中立建筑血量占满血比例
    hqProdType: 'warrior', // 总部默认产兵种（且不可进化）
  },

  // ===================== 总部防卫 =====================
  hqDefense: {
    range: 20,     // 防卫射程（格）
    cd: 0.5,       // 攻击间隔（秒）
    dmg: 20,       // 每发伤害
    windupMs: 500, // 攻击前摇（毫秒）：锁定后先蓄能这么久才开火
  },

  // ===================== 激光兵参数 =====================
  laser: {
    windupMs: 500, // 换目标后前摇：这么久内不射击（蓄能）
    rampMs: 400,  // 蓄能满倍率所需时间：锁定每持续 4 秒，伤害 +1 倍
    maxMul: 25,     // 倍率上限（初始 1 倍 → 最高 5 倍）
  },

  // ===================== 火焰（燎原）=====================
  // 燎原的 dmg 和其它兵种一致，是「一口火的伤害」：攻击间隔由 units.burn.cd 决定，
  // 每秒伤害 ≈ dmg / cd。火舌落点的范围伤害半径就是 flame.r。
  flame: {
    r: 5,          // 火舌落点的范围伤害半径（格）—— 各阶共用，不随阶数变化
    maxFires: 160, // 场上灼烧地块上限（防极端情况下列表无限膨胀）
  },

  // ---- 灼烧地形档位（逐阶解锁）----
  // 索引对应阶数：0=1阶(不留火场) / 1=2阶 / 2=3阶
  //   r 火场半径(格) / dps 每秒伤害（敌我通吃）/ lifeMs 末次刷到后还能烧多久
  //   mergeD 相近落点并入距离(格)
  fireTiers: [
    null, // 一级：不留火场（只有火舌本身的范围伤害）
    { r: 4.5, dps: 5, lifeMs: 2000, mergeD: 3.5 }, // 二级：基准
    { r: 6.5, dps: 9, lifeMs: 4000, mergeD: 4.5 }, // 三级：更大 / 更久 / 更疼
  ],
};

module.exports = WFData;
