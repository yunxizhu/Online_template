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
  burn: { label: '燎原', hp: 80, dmg: 7, range: 120, cd: 1.7, speed: 78, r: 9, burn: true },
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

// ---- 地形（元胞自动机：上半生成 + 180° 旋转出下半）----
// 类型编号与客户端（public/games/warfactory/ui.js）保持一致：
//   0 平原 / 2 山地（不可通行，窄而连续的山脉）/ 3 沼泽（可通行，减速）/ 4 水域（不可通行，大片连续）
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
      rp: 0, // 科技（研究）点数：只有占领中的研究所会产出
      eliminated: false,
      left: false,
    };
  });

  // 总部：每名玩家一座，开局即归属本人；被打光则「总部陷落」→ 该玩家出局
  const hqs = players.map((p, i) => ({
    id: i + 1,
    x: round1(p.baseX),
    y: round1(p.baseY),
    owner: i,
    hp: HQ_HP,
    hpMax: HQ_HP,
    down: false,
    evoCd: 0,
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
      aggroBonus: AGGRO_BONUS,
      burnDps: BURN_DPS,
      burnMs: BURN_MS,
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
    hqs,
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

  // 开局部队：每名玩家在总部旁拥有「每种初级单位各一个」（无初始工厂，工厂全靠打下来）
  const hqSource = { id: 0, owner: 0, level: 3 }; // level 3 → 总部亲兵可一路进阶到顶阶
  for (let i = 0; i < players.length; i++) {
    hqSource.owner = i;
    const hq = hqs[i];
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

/** 该玩家当前存活部队总数（含总部亲兵与各厂部队） */
function unitCountOf(game, ownerIdx) {
  let n = 0;
  for (const u of game.units) {
    if (!u.dead && u.ownerIdx === ownerIdx) n++;
  }
  return n;
}

/** 该玩家当前实际产出的研究点/秒 = 已占领研究所数 × (RP_PER_LAB / RP_PERIOD_MS)（一座不占则为 0） */
function researchRate(game, ownerIdx) {
  let n = 0;
  for (const l of game.labs) if (l.owner === ownerIdx) n++;
  return (n * RP_PER_LAB * 1000) / RP_PERIOD_MS;
}

/** 科技点累积：只有占领中的研究所才产出研究点，完全被动（不需要任何操作） */
function updateResearch(game, dt) {
  for (let i = 0; i < game.players.length; i++) {
    const p = game.players[i];
    if (p.eliminated || p.left) continue;
    const rate = researchRate(game, i);
    if (rate > 0) p.rp = Math.min(RP_CAP, p.rp + rate * dt);
  }
}

function pushEvent(game, ev) {
  game.events.push(ev);
  if (game.events.length > 60) game.events.shift();
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

function updateProduction(game, dt, now) {
  const dtMs = dt * 1000;
  const stamp = now || Date.now();
  // 每名玩家当前部队数（兵力上限判定用；每步只统计一次）
  const counts = game.players.map((_, i) => unitCountOf(game, i));
  for (const f of game.factories) {
    if (f.owner < 0) continue;
    // 每 20 秒生产 1 支。兵力达上限时进度停在 1（不丢进度），有部队阵亡立刻补出
    f.prodProg = Math.min(1, f.prodProg + dtMs / PRODUCE_MS);
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
    // 设了集结点的工厂：新兵自动前往集结点（给 1.5s 脱离窗口，避免半路被拉去交战）
    if (u && f.rally) {
      u.moveX = f.rally.x;
      u.moveY = f.rally.y;
      u.chasing = false;
      u.targetId = 0;
      u.disengageUntil = stamp + 1500;
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
  if (best) return { kind: 'u', id: best.id };

  // 射程内没有敌方单位 → 打建筑（工厂 / 研究所 / 总部 都是合法目标，按边缘距离取最近）
  let bRef = null;
  let bKind = '';
  let bfd = Infinity;
  const bear = (kind, ref, radius) => {
    if (ref.owner === u.ownerIdx) return;
    if (kind === 'h' && ref.down) return;
    const d = dist(u.x, u.y, ref.x, ref.y) - radius; // 到建筑边缘的距离
    if (d > aggro) return;
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
  if (target.kind === 'fac') damageFactory(game, target.ref, dmg, u.ownerIdx);
  else if (target.kind === 'lab') damageLab(game, target.ref, dmg, u.ownerIdx);
  else if (target.kind === 'hq') damageHq(game, target.ref, dmg, u.ownerIdx);
  else {
    target.lastHitBy = u.id;
    retaliate(game, target, u.id);
    damageUnit(game, target, dmg, u.ownerIdx);
  }
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
        u.targetFac = 0;
        u.targetLab = 0;
        u.targetHq = 0;
      } else {
        const t = findTarget(game, u);
        if (t) {
          if (!u.targetId && !u.targetFac && !u.targetLab && !u.targetHq) {
            // 从空闲转入交战：记录归位点（守军拴绳）
            u.homeX = u.x;
            u.homeY = u.y;
            u.chasing = !u.moveX;
          }
          u.targetId = t.kind === 'u' ? t.id : 0;
          u.targetFac = t.kind === 'f' ? t.id : 0;
          u.targetLab = t.kind === 'l' ? t.id : 0;
          u.targetHq = t.kind === 'h' ? t.id : 0;
        } else {
          u.targetId = 0;
          u.targetFac = 0;
          u.targetLab = 0;
          u.targetHq = 0;
          u.chasing = false;
        }
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

    const engaged = target && !(u.disengageUntil && now < u.disengageUntil);
    const tDist = engaged ? dist(u.x, u.y, target.x, target.y) : 0;
    const tReach = engaged ? u.range + target.r : 0;

    // 激光兵：维护「锁定」。只有真正进入射程才开始蓄能；换目标（或目标丢失/离开射程）
    // 立刻重置倍率并进入前摇，前摇期间不开火。
    if (u.laser) {
      const inRange = engaged && tDist <= tReach;
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

    if (engaged) {
      const d = tDist;
      const reach = tReach;
      u.angle = Math.atan2(target.y - u.y, target.x - u.x);
      if (d > reach * 0.92) {
        const spd = u.speed * dt * terrainSpeedFactor(game, u);
        // 追击也走地形寻路：目标在山/水另一侧时绕行，而不是撞墙站住
        stepViaFlow(game, u, target.x, target.y, spd);
      } else {
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
    } else if (u.moveX != null) {
      const d = dist(u.x, u.y, u.moveX, u.moveY);
      if (d <= 26) {
        u.moveX = null;
        u.moveY = null;
        u.disengageUntil = 0;
      } else {
        const ang = Math.atan2(u.moveY - u.y, u.moveX - u.x);
        u.angle = ang;
        const spd = u.speed * dt * terrainSpeedFactor(game, u);
        // 沿地形流场绕开山地与水域抵达指令点（集结点派遣同样走这里）
        if (!stepViaFlow(game, u, u.moveX, u.moveY, spd)) {
          if (d <= 26 + TERR_CELL) {
            u.moveX = null;
            u.moveY = null;
            u.disengageUntil = 0;
          }
        }
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
  const amt = amount; // 地形不再影响伤害（林地已移除）
  victim.hp -= amt;
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
      damageUnit(game, e, b.dmg, b.ownerIdx);
    }
  }
  // 炮击同样会砸伤范围内的敌方建筑（工厂 / 研究所 / 总部）
  for (const f of game.factories) {
    if (f.owner === b.ownerIdx) continue;
    if (dist(f.x, f.y, x, y) <= b.splash + FACTORY_R) {
      damageFactory(game, f, b.dmg, b.ownerIdx);
    }
  }
  for (const l of game.labs) {
    if (l.owner === b.ownerIdx) continue;
    if (dist(l.x, l.y, x, y) <= b.splash + LAB_R) {
      damageLab(game, l, b.dmg, b.ownerIdx);
    }
  }
  for (const h of game.hqs) {
    if (h.owner === b.ownerIdx || h.down) continue;
    if (dist(h.x, h.y, x, y) <= b.splash + HQ_R) {
      damageHq(game, h, b.dmg, b.ownerIdx);
    }
  }
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
        if (b.kind === 'fire') applyBurn(e, b.ownerIdx, now);
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
          damageHq(game, h, b.dmg, b.ownerIdx);
          break;
        }
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
  updateBurns(game, dt, now);
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
      u.burnUntil > now ? 1 : 0,
      u.homeFac || 0, // 产出该单位的工厂（0 = 总部亲兵）；侧栏统计「可进化部队」用
      // —— 激光兵锁定状态（非激光兵恒为 0）——
      u.laser ? u.lockKind : 0, // 锁定目标类别：0 无 / 1 单位 / 2 工厂 / 3 研究所 / 4 总部
      u.laser ? u.lockId : 0, // 锁定目标 id
      u.laser ? Math.round(u.lockMul * 100) : 0, // 当前伤害倍率 ×100（100 = 1 倍）
      u.laser && u.windupUntil > now ? Math.round(u.windupUntil - now) : 0, // 前摇剩余毫秒（>0 表示蓄能中）
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
      Math.round(f.hp), // 工厂当前血量（打光即易主）
      Math.round(f.evoCd || 0), // 手动进化冷却剩余（毫秒）
    ]),
    // 研究所：[id, 归属, 当前血量, 满血]（同样是打光即易主）
    lb: game.labs.map((l) => [l.id, l.owner, Math.round(l.hp), Math.round(l.hpMax)]),
    // 总部：[id, 归属, 当前血量, 满血, 是否已陷落, 进化冷却剩余]
    hq: game.hqs.map((h) => [
      h.id,
      h.owner,
      Math.round(h.hp),
      Math.round(h.hpMax),
      h.down ? 1 : 0,
      Math.round(h.evoCd || 0),
    ]),
    // 科技点：与 players 同序（左上角 HUD / 记分牌用）
    rp: game.players.map((p) => Math.round(p.rp)),
    // 兵力：与 players 同序（右上角兵力上限提示用）
    uc: game.players.map((_, i) => unitCountOf(game, i)),
    // 集结点（仅下发已设置的，绝大多数时候为空数组）：[工厂id, x, y]
    r: game.factories
      .filter((f) => f.rally)
      .map((f) => [f.id, Math.round(f.rally.x), Math.round(f.rally.y)]),
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
      u.chasing = false;
      // 1.5s 脱离窗口：残兵可以拉出火线，之后恢复自动迎击
      u.disengageUntil = now + 1500;
      u.targetId = 0;
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
    reapDead,
    updateOutcome,
    findTarget,
    damageFactory,
    damageLab,
    damageHq,
    updateResearch,
    researchRate,
    promoteUnit,
    laserMul,
    laserZap,
    terrainCell,
    terrainSpeedFactor,
    terrainPassable,
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
      SWAMP_SLOW,
      WATER_TOP,
      SWAMP_TOP,
      RIDGE_COUNT,
      LASER_WINDUP_MS,
      LASER_RAMP_MS,
      LASER_MAX_MUL,
    },
  },
};
