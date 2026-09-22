'use strict';

/**
 * 弹射对决（blaster）：2–4 人实时对战小游戏。
 *
 * 规则：
 * - WASD 移动，鼠标瞄准 + 按住左键蓄力、松开发射
 * - 蓄力越久子弹越快（线性，封顶上限）；两次发射之间有固定间隔，快速点按也无法连发
 * - 子弹撞墙无限反弹、无限射程，直到击中某个小人（含发射者自己）才消失
 * - 每个小人 3 点生命，被子弹命中扣 1 点，归零即本局出局
 * - 场上只剩 1 个小人时，该小人本局获胜
 * - 积分制：存活到最后 +3 分，每淘汰一名对手 +1 分；开赛前选 3–11 局（默认 5）
 *
 * 服务端权威模拟：固定 ~30Hz 步进，快照走轻量 game:rt 通道；
 * 全量 game:state 只在阶段切换（倒计时/开局/本局结束/系列赛结束）时广播。
 */

const ARENA_W = 1500;
const ARENA_H = 960;
const WALL = 16;

const PLAYER_R = 15;
const PLAYER_SPEED = 205;
const BULLET_R = 5;
const BULLET_SPEED = 420; // 历史常量，仅作兼容导出；实际子弹速度随蓄力变化
const BULLET_SPEED_MIN = 300; // 轻点（最小蓄力）子弹速度
const BULLET_SPEED_MAX = 760; // 满蓄力子弹速度上限
const CHARGE_MAX_MS = 800; // 蓄满所需时间
const FIRE_COOLDOWN_MS = 450; // 发射间隔：冷却期内快速点按也无法连发
const MAX_HP = 3;
const MAX_BULLETS = 260;
// 每个玩家同时存在的子弹上限：超出后新发射的子弹会把该玩家最早的子弹挤掉
const MAX_BULLETS_PER_PLAYER = 5;

// ---- 道具系统 ----
const ITEM_R = 13; // 道具拾取半径（碰到即使用）
const ITEM_INITIAL_MIN = 4; // 开局铺在地上的道具数下限
const ITEM_INITIAL_MAX = 6; // 开局铺在地上的道具数上限
const ITEM_SPAWN_INTERVAL_MS = 7000; // 每隔一段时间补一批
const ITEM_SPAWN_BATCH = 2; // 每批补几个
const ITEM_MAX_ON_MAP = 10; // 场上同时存在的道具上限
const ITEM_MIN_GAP = 90; // 道具之间的最小间距
const ITEM_MIN_PLAYER_GAP = 90; // 道具与玩家（含出生点）的最小间距
// 子弹变大：半径倍率与持续时长
const BIG_BULLET_SCALE = 1.8;
const BIG_BULLET_R = Math.round(BULLET_R * BIG_BULLET_SCALE);
const BIG_BULLET_MS = 8000;
// 子弹上限增加
const AMMO_BONUS_PER_PICKUP = 2;
const MAX_AMMO_BONUS = 6; // 上限加成封顶（5 + 6 = 11 发）
// 移速提升
const SPEED_BOOST_MULT = 1.55;
const SPEED_BOOST_MS = 6000;
// 护盾：抵挡一次命中伤害，最多叠加层数
const MAX_SHIELD = 2;

/** 道具权重表（回血最常见，护盾最稀有） */
const ITEM_TABLE = [
  { type: 'heal', weight: 26 },
  { type: 'power', weight: 22 },
  { type: 'ammo', weight: 20 },
  { type: 'speed', weight: 18 },
  { type: 'shield', weight: 14 },
];

const COUNTDOWN_MS = 2500;
const ROUND_END_MS = 3200;

const SCORE_SURVIVE = 3;
const SCORE_KILL = 1;

const TICK_MS = 33;
const MAX_DT = 0.06;
const SUB_STEP = 0.02;

const MIN_MATCH_GAMES = 3;
const MAX_MATCH_GAMES = 11;
const DEFAULT_MATCH_GAMES = 5;

const TAU = Math.PI * 2;

const COLORS = ['#e5484d', '#3b82f6', '#22c55e', '#f59e0b'];

/** 出生点（相对场地比例），按人数取用 */
const SPAWN_TABLE = {
  2: [
    [0.14, 0.5],
    [0.86, 0.5],
  ],
  3: [
    [0.5, 0.16],
    [0.13, 0.82],
    [0.87, 0.82],
  ],
  4: [
    [0.13, 0.16],
    [0.87, 0.16],
    [0.13, 0.84],
    [0.87, 0.84],
  ],
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ---------------- 随机房间墙体（元胞自动机） ----------------

 * 墙体的「位置 / 大小 / 方向」全部交给元胞自动机产出，不再用「贴边凸起 / 通栏 / 外接圆弧」
 * 那套手工模板（模板只能造出与坐标轴对齐或贴边的形状，方向感很弱）：
 *   1) 粗栅格（CA_CELL 像素/格）按概率随机填充「墙胞」，最外圈恒为空；
 *   2) 迭代平滑（8 邻域，经典 4-5 规则）：空白格邻居 >= CA_BIRTH 变墙、墙胞邻居 >= CA_SURVIVE
 *      保持，否则被侵蚀 —— 噪点长成洞穴式块团，块团边界天然是斜的、不贴坐标轴；
 *   3) 出生点周围挖空（保证有落脚点，且不会一出生就贴墙）；
 *   4) 连通域（block）分析，对每个块团做 PCA（协方差主轴）：
 *        · 主轴方向      → 墙体方向 ang（斜矩形 orect 的旋转角）
 *        · 沿主轴跨度    → 墙体长度 w
 *        · 垂直主轴跨度  → 墙体厚度 h（夹取到 WALL_THICK_MIN..WALL_THICK_MAX 保持薄墙）
 *        · 长宽比接近 1 的团块 → 输出弧形墙 arc；细长的 → 输出斜矩形墙 orect
 *        · 拟合率低的 L 形块团按主轴二分递归（最多 CA_SPLIT_DEPTH 层），拆成多段墙
 *   5) 结果仍按「玩家体积膨胀」做 flood-fill 校验（每个出生点都能走到外边界环），
 *      否则换一组随机数整体重生成；多次失败兜底为「空场地」（依然合法可玩）。
 */

const CA_CELL = 30; // 元胞边长（像素）
const CA_FILL = 0.44; // 初始随机填充概率
const CA_ITER = 4; // 平滑迭代次数
const CA_BIRTH = 5; // 空白格：8 邻域墙胞达到该数就变成墙
const CA_SURVIVE = 4; // 墙胞：8 邻域墙胞达到该数才存活，否则被侵蚀
const CA_SPAWN_CLEAR = 2; // 出生点周围挖空的半径（格）
const CA_MIN_BLOB = 4; // 小于该格数的块团直接丢弃（避免满地碎渣）
const CA_MIN_WALLS = 15; // 少于该数量的布局判为太空旷，重新生成
const CA_MAX_WALLS = 34; // 单局墙体数量上限
const CA_FIT_MIN = 0.62; // 方向包围盒填充率低于此值说明是 L 形，二分拆开
const CA_SPLIT_DEPTH = 2; // 二分递归深度上限
const CA_ARC_ASPECT = 1.25; // 长宽比低于此值的块团视为「团块」→ 弧形墙
const CA_MIN_ARC_CELL = 4; // 小于该格数的团块不做弧形（弧形只给像样的团块）
const CA_MIN_WALL_LEN = 34; // 墙体长度下限（短于该值不出墙）
const WALL_THICK_MIN = 14; // 墙体厚度下限（像素）
const WALL_THICK_MAX = 22; // 墙体厚度上限（像素）

function angleNorm(a) {
  while (a <= -Math.PI) a += TAU;
  while (a > Math.PI) a -= TAU;
  return a;
}

function angleInRange(ang, a0, a1) {
  const d = angleNorm(ang - a0);
  const span = angleNorm(a1 - a0);
  return d >= 0 && d <= span;
}

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

/* ---------------- 元胞自动机（CA）地图生成 ---------------- */

function caRandomFill(rng, cols, rows) {
  const g = new Uint8Array(cols * rows);
  // 最外圈恒为空：外边界环保持贯通，墙体也不会糊在边界上
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (rng() < CA_FILL) g[y * cols + x] = 1;
    }
  }
  return g;
}

function caStep(src, dst, cols, rows) {
  dst.fill(0);
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          n += src[(y + dy) * cols + (x + dx)];
        }
      }
      const i = y * cols + x;
      dst[i] = (src[i] ? n >= CA_SURVIVE : n >= CA_BIRTH) ? 1 : 0;
    }
  }
  return dst;
}

/** 跑一次 CA：随机填充 → 迭代平滑（经典 4-5 规则），返回墙胞栅格 */
function caRun(rng, cols, rows) {
  let cur = caRandomFill(rng, cols, rows);
  let next = new Uint8Array(cols * rows);
  for (let i = 0; i < CA_ITER; i++) {
    caStep(cur, next, cols, rows);
    const t = cur;
    cur = next;
    next = t;
  }
  return cur;
}

/** 出生点周围挖空：保证有落脚点，也不会一出生就贴着墙 */
function caCarveSpawns(g, cols, rows, spawns) {
  const r = CA_SPAWN_CLEAR * CA_CELL;
  for (const s of spawns) {
    const x0 = Math.max(1, Math.floor((s.x - r) / CA_CELL));
    const x1 = Math.min(cols - 2, Math.ceil((s.x + r) / CA_CELL));
    const y0 = Math.max(1, Math.floor((s.y - r) / CA_CELL));
    const y1 = Math.min(rows - 2, Math.ceil((s.y + r) / CA_CELL));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cx = (x + 0.5) * CA_CELL;
        const cy = (y + 0.5) * CA_CELL;
        if (Math.hypot(cx - s.x, cy - s.y) <= r) g[y * cols + x] = 0;
      }
    }
  }
}

/** 连通域（8 邻域）分析，返回若干块团的格索引数组 */
function caBlobs(g, cols, rows) {
  const seen = new Uint8Array(cols * rows);
  const blobs = [];
  const stack = [];
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const start = y * cols + x;
      if (!g[start] || seen[start]) continue;
      stack.length = 0;
      stack.push(start);
      seen[start] = 1;
      const cells = [];
      while (stack.length) {
        const i = stack.pop();
        cells.push(i);
        const cx = i % cols;
        const cy = (i - cx) / cols;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 1 || ny < 1 || nx > cols - 2 || ny > rows - 2) continue;
            const ni = ny * cols + nx;
            if (seen[ni] || !g[ni]) continue;
            seen[ni] = 1;
            stack.push(ni);
          }
        }
      }
      // 太小的块团是噪声，丢掉
      if (cells.length >= CA_MIN_BLOB) blobs.push(cells);
    }
  }
  return blobs;
}

/** 块团 PCA：主轴方向、沿主轴/垂直主轴的跨度、方向包围盒中心与填充率 */
function fitBlob(cells, cols) {
  const n = cells.length;
  if (!n) return null;
  const px = (i) => (i % cols + 0.5) * CA_CELL;
  const py = (i) => (Math.floor(i / cols) + 0.5) * CA_CELL;
  let mx = 0;
  let my = 0;
  for (const i of cells) {
    mx += px(i);
    my += py(i);
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const i of cells) {
    const dx = px(i) - mx;
    const dy = py(i) - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n;
  syy /= n;
  sxy /= n;
  // 协方差矩阵主轴（最大特征值方向）= 墙体方向
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  let minL = Infinity;
  let maxL = -Infinity;
  let minP = Infinity;
  let maxP = -Infinity;
  for (const i of cells) {
    const dx = px(i) - mx;
    const dy = py(i) - my;
    const l = dx * ca + dy * sa;
    const p = -dx * sa + dy * ca;
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
    if (p < minP) minP = p;
    if (p > maxP) maxP = p;
  }
  // 每个墙胞在世界上占 CA_CELL 见方，所以跨度要补回一个胞宽
  const len = maxL - minL + CA_CELL;
  const perp = maxP - minP + CA_CELL;
  const midL = (minL + maxL) / 2;
  const midP = (minP + maxP) / 2;
  const area = n * CA_CELL * CA_CELL;
  return {
    mx,
    my,
    midL,
    ang,
    len,
    perp,
    cellCount: n,
    radius: Math.sqrt(area / Math.PI),
    fill: area / Math.max(1, len * perp),
    x: mx + ca * midL - sa * midP, // 方向包围盒中心（世界坐标）
    y: my + sa * midL + ca * midP,
  };
}

/** 团块 → 弧形墙：弧带穿过块团质心，圆心沿「离场地中心向外」偏移，
 *  凸面朝外；端点越出围栏就放弃（调用方退回斜矩形）。
 *  关键：块团到圆心的距离必须≈弧半径，否则墙画在块团的空地上，
 *  子弹会从块团原本的位置穿过去、却在空地上被弹开。 */
function makeArcFromFit(fit, thick, rng) {
  const blobR = Math.max(CA_CELL, fit.radius);
  const dx = fit.x - ARENA_W / 2;
  const dy = fit.y - ARENA_H / 2;
  const d = Math.hypot(dx, dy);
  let ux;
  let uy;
  if (d < 1e-3) {
    const a = rng() * TAU;
    ux = Math.cos(a);
    uy = Math.sin(a);
  } else {
    ux = dx / d;
    uy = dy / d;
  }
  const r = clamp(blobR * 1.7 + 26, 70, 300);
  const half = clamp(blobR / r, 0.16, 0.6);
  const mid = Math.atan2(-uy, -ux);
  // 弧带半径：让弧线正好穿过块团质心（而不是隔着一个 r）
  const arcR = clamp(r - blobR * 0.3, 70, 340);
  const cx = fit.x + ux * r;
  const cy = fit.y + uy * r;
  const a0 = mid - half;
  const a1 = mid + half;
  const lo = WALL + thick / 2 + 2;
  const hix = ARENA_W - WALL - thick / 2 - 2;
  const hiy = ARENA_H - WALL - thick / 2 - 2;
  for (let k = -1; k <= 1; k++) {
    const ang = mid + half * k;
    const x = cx + Math.cos(ang) * arcR;
    const y = cy + Math.sin(ang) * arcR;
    if (x < lo || x > hix || y < lo || y > hiy) return null;
  }
  return {
    type: 'arc',
    cx: round1(cx),
    cy: round1(cy),
    r: round1(arcR),
    t: round1(thick),
    a0: round3(a0),
    a1: round3(a1),
  };
}

/** 块团 → 墙体图元：位置/大小/方向都取自上面的 PCA 拟合 */
function emitFromFit(fit, rng, spawns) {
  const thick = clamp(fit.perp, WALL_THICK_MIN, WALL_THICK_MAX);
  const len = fit.len;
  const aspect = len / Math.max(1, fit.perp);
  let w = null;
  // 长宽比接近 1 的团块 → 弧形；细长的 → 斜矩形。直线墙占多数（弧形只做点缀）
  if (aspect < CA_ARC_ASPECT && fit.cellCount >= CA_MIN_ARC_CELL) {
    w = makeArcFromFit(fit, thick, rng);
  }
  if (!w) {
    if (len < CA_MIN_WALL_LEN) return null;
    const ca = Math.cos(fit.ang);
    const sa = Math.sin(fit.ang);
    const hx = Math.abs((len / 2) * ca) + Math.abs((thick / 2) * sa);
    const hy = Math.abs((len / 2) * sa) + Math.abs((thick / 2) * ca);
    const loX = WALL + hx + 2;
    const hiX = ARENA_W - WALL - hx - 2;
    const loY = WALL + hy + 2;
    const hiY = ARENA_H - WALL - hy - 2;
    if (loX > hiX || loY > hiY) return null; // 太长放不进场地：丢弃
    w = {
      type: 'orect',
      x: round1(clamp(fit.x, loX, hiX)),
      y: round1(clamp(fit.y, loY, hiY)),
      w: round1(len),
      h: round1(thick),
      ang: round3(fit.ang),
    };
  }
  // 最终裁决：块团可能是「绕开出生点挖空」后的回字形，拟合框会横跨那块空隙。
  // 压到出生点的墙一律不要 —— 宁可少一面墙，也不能把小人埋进墙里。
  if (spawns && spawns.length) {
    for (const s of spawns) {
      if (pointInWall(w, s.x, s.y, PLAYER_R + 6)) return null;
    }
  }
  return w;
}

/** 递归把块团变墙：L 形/不规则块团沿主轴二分，直到每段都近似直条 */
function blobToWalls(cells, cols, depth, rng, out, spawns) {
  const fit = fitBlob(cells, cols);
  if (!fit) return;
  if (fit.fill < CA_FIT_MIN && depth < CA_SPLIT_DEPTH) {
    const ca = Math.cos(fit.ang);
    const sa = Math.sin(fit.ang);
    const a = [];
    const b = [];
    for (const i of cells) {
      const dx = (i % cols + 0.5) * CA_CELL - fit.mx;
      const dy = (Math.floor(i / cols) + 0.5) * CA_CELL - fit.my;
      (dx * ca + dy * sa <= fit.midL ? a : b).push(i);
    }
    if (a.length >= CA_MIN_BLOB && b.length >= CA_MIN_BLOB) {
      blobToWalls(a, cols, depth + 1, rng, out, spawns);
      blobToWalls(b, cols, depth + 1, rng, out, spawns);
      return;
    }
  }
  const w = emitFromFit(fit, rng, spawns);
  if (w) out.push(w);
}

/** 图元中心点（弧形取弧带中点），用于去重 */
function wallCenter(w) {
  if (w.type === 'arc') {
    const mid = (w.a0 + w.a1) / 2;
    return { x: w.cx + Math.cos(mid) * w.r, y: w.cy + Math.sin(mid) * w.r };
  }
  return { x: w.x, y: w.y };
}

/** CA 候选布局：栅格 CA → 挖空出生点 → 块团 PCA → 墙图元 */
function buildWallCandidate(spawns, rng) {
  const cols = Math.round(ARENA_W / CA_CELL);
  const rows = Math.round(ARENA_H / CA_CELL);
  const grid = caRun(rng, cols, rows);
  caCarveSpawns(grid, cols, rows, spawns);
  // 大块团优先：越大越可能被拆成多段长墙，避免配额被碎块占满
  const blobs = caBlobs(grid, cols, rows).sort((a, b) => b.length - a.length);
  const walls = [];
  for (const cells of blobs) {
    if (walls.length >= CA_MAX_WALLS) break;
    blobToWalls(cells, cols, 0, rng, walls, spawns);
  }
  // 去重：块团相邻时拟合出的墙可能几乎重合
  const out = [];
  for (const w of walls) {
    const c = wallCenter(w);
    let dup = false;
    for (const o of out) {
      const oc = wallCenter(o);
      if (Math.hypot(c.x - oc.x, c.y - oc.y) < 26) {
        dup = true;
        break;
      }
    }
    if (!dup) out.push(w);
  }
  return out.slice(0, CA_MAX_WALLS);
}

function pointInWall(w, x, y, pad) {
  if (w.type === 'orect') {
    // 斜矩形：把点转到墙体局部坐标再判（CA 拟合出来的墙带方向）
    const ca = Math.cos(w.ang);
    const sa = Math.sin(w.ang);
    const dx = x - w.x;
    const dy = y - w.y;
    const l = dx * ca + dy * sa;
    const p = -dx * sa + dy * ca;
    return Math.abs(l) <= w.w / 2 + pad && Math.abs(p) <= w.h / 2 + pad;
  }
  if (w.type === 'rect') {
    return (
      x >= w.x - pad &&
      x <= w.x + w.w + pad &&
      y >= w.y - pad &&
      y <= w.y + w.h + pad
    );
  }
  const dist = Math.hypot(x - w.cx, y - w.cy);
  if (!angleInRange(Math.atan2(y - w.cy, x - w.cx), w.a0, w.a1)) return false;
  return Math.abs(dist - w.r) <= w.t / 2 + pad;
}

/** 每个出生点都能（在按玩家体积膨胀墙体后）走到外边界环才合格。
 *  关键：膨胀 PLAYER_R 再用细栅格 flood-fill，否则细墙/弧形会从网格缝隙漏过去，
 *  洪水填充误判「能走出去」，实际小人被墙 + 边界围进死口袋（概率性卡死）。 */
function validateLayout(walls, spawns) {
  const cell = 6;
  const cols = Math.ceil(ARENA_W / cell);
  const rows = Math.ceil(ARENA_H / cell);
  const pad = PLAYER_R + 4; // 墙体按玩家体积膨胀（含栅格半格余量）
  const blockedAt = (x, y) => {
    if (x <= WALL || x >= ARENA_W - WALL || y <= WALL || y >= ARENA_H - WALL)
      return false; // 外边界环视为开放
    for (const w of walls) {
      if (pointInWall(w, x, y, pad)) return true;
    }
    return false;
  };
  const blocked = (cx, cy) => blockedAt(cx * cell + cell / 2, cy * cell + cell / 2);
  const idx = (cx, cy) => cy * cols + cx;
  const seen = new Uint8Array(cols * rows);
  for (const s of spawns) {
    const scx = Math.floor(s.x / cell);
    const scy = Math.floor(s.y / cell);
    // 出生点本身（精确点，而不只是所在网格中心）必须在墙外
    if (blockedAt(s.x, s.y) || blocked(scx, scy)) return false;
    seen.fill(0);
    const stack = [[scx, scy]];
    seen[idx(scx, scy)] = 1;
    let reachBoundary = false;
    while (stack.length) {
      const cur = stack.pop();
      const cx = cur[0];
      const cy = cur[1];
      if (cx <= 1 || cy <= 1 || cx >= cols - 2 || cy >= rows - 2) {
        reachBoundary = true;
      }
      const nb = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ];
      for (let k = 0; k < nb.length; k++) {
        const nx = nb[k][0];
        const ny = nb[k][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (seen[idx(nx, ny)]) continue;
        if (blocked(nx, ny)) continue;
        seen[idx(nx, ny)] = 1;
        stack.push([nx, ny]);
      }
    }
    if (!reachBoundary) return false; // 被围住，无法到达边界
  }
  return true;
}

function generateWalls(spawns, rng) {
  rng =
    rng || makeRng((Date.now() ^ ((process.pid || 0) * 2654435761)) >>> 0);
  for (let tries = 0; tries < 90; tries++) {
    const walls = buildWallCandidate(spawns, rng);
    // 太空旷（CA 块团太少）也重生成，保证每局都有像样的掩体
    if (walls.length < CA_MIN_WALLS) continue;
    if (validateLayout(walls, spawns)) return walls;
  }
  return []; // 兜底：空场地（仍合法）
}

/** 比赛开始时调用：依据当前出生点为房间生成随机墙体（保证贯通、出生点不被围） */
function assignRandomWalls(game) {
  if (!game) return;
  const spawns = game.players.map((p) => ({ x: p.x, y: p.y }));
  game.walls = generateWalls(spawns, makeRng((Date.now() ^ 0x9e3779b1) >>> 0));
}

/* ---------------- 道具系统 ----------------
 * 5 种道具，玩家碰到即生效（回血在满血时不消耗，留在原地等受伤后再吃）：
 *   heal   回血    +1 HP（不超过上限）
 *   power  子弹变大 自己的子弹半径 ×1.8，持续 8s
 *   ammo   备弹扩容 自己的在场子弹上限 +2（本局内永久，最多 +6）
 *   speed  疾风   移动速度 ×1.55，持续 6s
 *   shield 护盾   获得 1 层护盾，抵挡下一次命中（不扣血），最多 2 层
 * 开局铺一批，之后每隔 ITEM_SPAWN_INTERVAL_MS 补一批，场上同时最多 ITEM_MAX_ON_MAP 个。
 * 每局开始（进入 playing）时清空重铺，避免上一局残留。
 */

function pickItemType(rng) {
  let total = 0;
  for (const it of ITEM_TABLE) total += it.weight;
  let roll = rng() * total;
  for (const it of ITEM_TABLE) {
    roll -= it.weight;
    if (roll <= 0) return it.type;
  }
  return ITEM_TABLE[0].type;
}

/** 随机找一个合法的道具落点：不在墙里、不与其他道具/玩家过近 */
function findItemSpot(game, rng) {
  const pad = WALL + ITEM_R + 3;
  for (let attempt = 0; attempt < 80; attempt++) {
    const x = pad + rng() * (ARENA_W - pad * 2);
    const y = pad + rng() * (ARENA_H - pad * 2);
    let bad = false;
    for (const w of game.walls) {
      if (pointInWall(w, x, y, ITEM_R + 2)) {
        bad = true;
        break;
      }
    }
    if (bad) continue;
    for (const it of game.items) {
      if (Math.hypot(it.x - x, it.y - y) < ITEM_MIN_GAP) {
        bad = true;
        break;
      }
    }
    if (bad) continue;
    for (const p of game.players) {
      if (Math.hypot(p.x - x, p.y - y) < PLAYER_R + ITEM_R + ITEM_MIN_PLAYER_GAP) {
        bad = true;
        break;
      }
    }
    if (bad) continue;
    return { x, y };
  }
  return null;
}

/** 往场上撒 count 个道具（放不下就提前结束） */
function spawnItems(game, now, count) {
  if (!game._itemRng) {
    game._itemRng = makeRng(((Date.now() ^ 0x85ebca6b) >>> 0) || 1);
  }
  const rng = game._itemRng;
  let added = 0;
  for (let i = 0; i < count; i++) {
    if (game.items.length >= ITEM_MAX_ON_MAP) break;
    const spot = findItemSpot(game, rng);
    if (!spot) break;
    game.items.push({
      id: game.nextItemId++,
      type: pickItemType(rng),
      x: spot.x,
      y: spot.y,
      at: now,
    });
    added += 1;
  }
  return added;
}

/** 每局开始铺一次道具（进入 playing 时确保已铺） */
function ensureItems(game, now) {
  if (game.itemRound === game.roundIndex) return;
  game.itemRound = game.roundIndex;
  game.items = [];
  game.nextItemAt = now + ITEM_SPAWN_INTERVAL_MS;
  const span = ITEM_INITIAL_MAX - ITEM_INITIAL_MIN + 1;
  const rng = game._itemRng || (game._itemRng = makeRng(((Date.now() ^ 0x85ebca6b) >>> 0) || 1));
  const want = ITEM_INITIAL_MIN + Math.floor(rng() * span);
  spawnItems(game, now, want);
}

/** 定时补货 + 玩家拾取判定 */
function updateItems(game, now) {
  if (now >= game.nextItemAt) {
    game.nextItemAt = now + ITEM_SPAWN_INTERVAL_MS;
    if (game.items.length < ITEM_MAX_ON_MAP) {
      spawnItems(game, now, ITEM_SPAWN_BATCH);
    }
  }

  if (!game.items.length) return;
  const kept = [];
  for (const item of game.items) {
    let taker = null;
    for (const p of game.players) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - item.x, p.y - item.y) <= PLAYER_R + ITEM_R) {
        taker = p;
        break;
      }
    }
    if (taker && applyItem(game, taker, item, now)) continue;
    kept.push(item);
  }
  game.items = kept;
}

/** 拾取生效；返回 true 表示道具被消耗 */
function applyItem(game, p, item, now) {
  switch (item.type) {
    case 'heal':
      // 满血不消耗，道具留在原地，受伤回来还能吃
      if (p.hp >= MAX_HP) return false;
      p.hp = Math.min(MAX_HP, p.hp + 1);
      break;
    case 'power':
      p.bigBulletUntil = Math.max(p.bigBulletUntil || 0, now) + BIG_BULLET_MS;
      break;
    case 'ammo':
      p.ammoBonus = Math.min(MAX_AMMO_BONUS, (p.ammoBonus || 0) + AMMO_BONUS_PER_PICKUP);
      break;
    case 'speed':
      p.speedUntil = Math.max(p.speedUntil || 0, now) + SPEED_BOOST_MS;
      break;
    case 'shield':
      p.shield = Math.min(MAX_SHIELD, (p.shield || 0) + 1);
      break;
    default:
      return false;
  }
  p.pickups = (p.pickups || 0) + 1;
  game.pickupEvents.push({ playerId: p.id, item: item.type, at: now });
  if (game.pickupEvents.length > 40) game.pickupEvents.shift();
  return true;
}

/** 玩家当前生效的子弹上限（基础 5 + 备弹扩容） */
function bulletCapOf(p) {
  return MAX_BULLETS_PER_PLAYER + Math.max(0, p.ammoBonus || 0);
}

/** 玩家当前移动速度（疾风道具生效期间加速） */
function speedOf(p, now) {
  return (p.speedUntil || 0) > now ? PLAYER_SPEED * SPEED_BOOST_MULT : PLAYER_SPEED;
}

/** 把一个半径 r 的圆（带速度 vx,vy）推出墙体并反射速度，返回新状态 */
function contactWall(w, x, y, r) {
  if (w.type === 'orect') {
    // 斜矩形：转到墙体局部坐标做圆-盒碰撞，法线再转回世界坐标
    const ca = Math.cos(w.ang);
    const sa = Math.sin(w.ang);
    const dx = x - w.x;
    const dy = y - w.y;
    const l = dx * ca + dy * sa;
    const p = -dx * sa + dy * ca;
    const hw = w.w / 2;
    const hh = w.h / 2;
    const ql = clamp(l, -hw, hw);
    const qp = clamp(p, -hh, hh);
    const dl = l - ql;
    const dp = p - qp;
    const d = Math.hypot(dl, dp);
    if (d > r) return null;
    let nl;
    let np;
    let px;
    let py;
    if (d > 1e-6) {
      nl = dl / d;
      np = dp / d;
      px = ql + nl * r;
      py = qp + np * r;
    } else {
      // 圆心陷在墙里：沿最近的一个面推出去
      const left = l + hw;
      const right = hw - l;
      const top = p + hh;
      const bottom = hh - p;
      const m = Math.min(left, right, top, bottom);
      if (m === left) {
        nl = -1;
        np = 0;
        px = -hw - r;
        py = p;
      } else if (m === right) {
        nl = 1;
        np = 0;
        px = hw + r;
        py = p;
      } else if (m === top) {
        nl = 0;
        np = -1;
        px = l;
        py = -hh - r;
      } else {
        nl = 0;
        np = 1;
        px = l;
        py = hh + r;
      }
    }
    return {
      x: w.x + px * ca - py * sa,
      y: w.y + px * sa + py * ca,
      nx: nl * ca - np * sa,
      ny: nl * sa + np * ca,
    };
  }
  if (w.type === 'rect') {
    const qx = clamp(x, w.x, w.x + w.w);
    const qy = clamp(y, w.y, w.y + w.h);
    const dx = x - qx;
    const dy = y - qy;
    const d = Math.hypot(dx, dy);
    if (d > r) return null;
    if (d > 1e-6) {
      const nx = dx / d;
      const ny = dy / d;
      return { x: qx + nx * r, y: qy + ny * r, nx, ny };
    }
    const left = x - w.x;
    const right = w.x + w.w - x;
    const top = y - w.y;
    const bottom = w.y + w.h - y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) return { x: w.x - r, y, nx: -1, ny: 0 };
    if (m === right) return { x: w.x + w.w + r, y, nx: 1, ny: 0 };
    if (m === top) return { x, y: w.y - r, nx: 0, ny: -1 };
    return { x, y: w.y + w.h + r, nx: 0, ny: 1 };
  }
  // arc
  const dist = Math.hypot(x - w.cx, y - w.cy);
  if (dist < 1e-6) return { x: w.cx + r, y: w.cy, nx: 1, ny: 0 };
  const ang = Math.atan2(y - w.cy, x - w.cx);
  if (!angleInRange(ang, w.a0, w.a1)) return null;
  const band = w.t / 2 + r;
  const gap = dist - w.r;
  if (Math.abs(gap) > band) return null;
  const ux = (x - w.cx) / dist;
  const uy = (y - w.cy) / dist;
  // 法线方向必须指向「来的一侧」，否则会把物体推到弧带的另一面，
  // 圆在带内来回被推 → 在弧体内部反复震荡（打不出去）。
  // gap<0 说明从凹侧撞来，法线朝内(-u)；gap>=0 从凸侧，法线朝外(+u)。
  const sx = gap < 0 ? -1 : 1;
  const nx = ux * sx;
  const ny = uy * sx;
  const newDist = w.r + sx * band;
  return { x: w.cx + ux * newDist, y: w.cy + uy * newDist, nx, ny };
}

function collideCircle(walls, x, y, r, vx, vy) {
  let hit = false;
  for (const w of walls) {
    const c = contactWall(w, x, y, r);
    if (!c) continue;
    hit = true;
    x = c.x;
    y = c.y;
    const dot = vx * c.nx + vy * c.ny;
    if (dot < 0) {
      vx -= 2 * dot * c.nx;
      vy -= 2 * dot * c.ny;
    }
  }
  return { x, y, vx, vy, hit };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

function clampMatchGames(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_MATCH_GAMES;
  return Math.max(MIN_MATCH_GAMES, Math.min(MAX_MATCH_GAMES, n));
}

function spawnPoint(index, count) {
  const table = SPAWN_TABLE[count] || SPAWN_TABLE[4];
  const row = table[index % table.length];
  return {
    x: clamp(row[0] * ARENA_W, WALL + PLAYER_R + 4, ARENA_W - WALL - PLAYER_R - 4),
    y: clamp(row[1] * ARENA_H, WALL + PLAYER_R + 4, ARENA_H - WALL - PLAYER_R - 4),
  };
}

function angleTo(x, y, tx, ty) {
  return Math.atan2(ty - y, tx - x);
}

function createGameState(room) {
  const seats = (room && room.players ? room.players : []).filter(
    (p) => p && !p.left
  );
  const count = Math.max(2, Math.min(4, seats.length));
  const chosen = seats.slice(0, count);
  const totalGames = clampMatchGames(
    room && room.matchGames != null ? room.matchGames : DEFAULT_MATCH_GAMES
  );

  const players = chosen.map((p, i) => {
    const s = spawnPoint(i, count);
    return {
      id: p.id,
      name: p.name || '玩家',
      color: COLORS[i % COLORS.length],
      x: s.x,
      y: s.y,
      aim: angleTo(s.x, s.y, ARENA_W / 2, ARENA_H / 2),
      hp: MAX_HP,
      alive: true,
      kills: 0,
      deaths: 0,
      score: 0,
      nextFireAt: 0,
      chargeMs: 0,
      charging: false,
      input: { mx: 0, my: 0, aim: 0, charge: 0 },
      // 道具带来的状态（每局重置）
      shield: 0,
      ammoBonus: 0,
      bigBulletUntil: 0,
      speedUntil: 0,
      pickups: 0,
      left: false,
    };
  });

  const scores = {};
  for (const p of players) scores[p.id] = 0;

  return {
    type: 'blaster',
    arena: { w: ARENA_W, h: ARENA_H, wall: WALL },
    consts: {
      playerR: PLAYER_R,
      bulletR: BULLET_R,
      maxHp: MAX_HP,
      playerSpeed: PLAYER_SPEED,
      bulletSpeed: BULLET_SPEED,
      bulletSpeedMin: BULLET_SPEED_MIN,
      bulletSpeedMax: BULLET_SPEED_MAX,
      chargeMaxMs: CHARGE_MAX_MS,
      fireCooldownMs: FIRE_COOLDOWN_MS,
      maxBulletsPerPlayer: MAX_BULLETS_PER_PLAYER,
      scoreSurvive: SCORE_SURVIVE,
      scoreKill: SCORE_KILL,
      // 道具相关参数（客户端 HUD / 图例用）
      itemR: ITEM_R,
      itemTypes: ITEM_TABLE.map((it) => it.type),
      itemSpawnIntervalMs: ITEM_SPAWN_INTERVAL_MS,
      bigBulletR: BIG_BULLET_R,
      bigBulletMs: BIG_BULLET_MS,
      ammoBonusPerPickup: AMMO_BONUS_PER_PICKUP,
      maxAmmoBonus: MAX_AMMO_BONUS,
      speedBoostMult: SPEED_BOOST_MULT,
      speedBoostMs: SPEED_BOOST_MS,
      maxShield: MAX_SHIELD,
    },
    phase: 'countdown',
    phaseEndsAt: Date.now() + COUNTDOWN_MS,
    roundIndex: 1,
    matchGames: totalGames,
    players,
    walls: [],
    bullets: [],
    items: [],
    pickupEvents: [],
    itemRound: 0,
    nextItemAt: 0,
    nextItemId: 1,
    scores,
    ranking: [],
    roundEvents: [],
    lastRound: null,
    over: false,
    matchOver: false,
    winnerId: null,
    seq: 0,
    nextBulletId: 1,
    _lastTick: Date.now(),
  };
}

function resetRound(game) {
  game.bullets = [];
  game.roundEvents = [];
  // 道具每局重铺：这里先清空，进入 playing 时 ensureItems 依新墙体重铺
  game.items = [];
  game.itemRound = 0;
  const n = game.players.length;
  const now = Date.now();
  game.players.forEach((p, i) => {
    const s = spawnPoint(i, n);
    p.x = s.x;
    p.y = s.y;
    p.aim = angleTo(s.x, s.y, ARENA_W / 2, ARENA_H / 2);
    p.hp = MAX_HP;
    p.alive = !p.left;
    p.nextFireAt = now + 300;
    p.chargeMs = 0;
    p.charging = false;
    p.input = { mx: 0, my: 0, aim: p.aim, charge: 0 };
    // 道具带来的增益不跨局
    p.shield = 0;
    p.ammoBonus = 0;
    p.bigBulletUntil = 0;
    p.speedUntil = 0;
  });
  game.phase = 'countdown';
  game.phaseEndsAt = now + COUNTDOWN_MS;
  // 每局刷新随机房间（新的出生点对应新的墙体布局）
  game.walls = generateWalls(
    game.players.map((p) => ({ x: p.x, y: p.y })),
    makeRng((Date.now() ^ (game.roundIndex * 2246822519 + 7)) >>> 0)
  );
}

/** 蓄力时间 → 子弹速度（线性，封顶 CHARGE_MAX_MS 对应 BULLET_SPEED_MAX） */
function chargeToSpeed(chargeMs) {
  const t = clamp(chargeMs, 0, CHARGE_MAX_MS) / CHARGE_MAX_MS;
  return BULLET_SPEED_MIN + (BULLET_SPEED_MAX - BULLET_SPEED_MIN) * t;
}

function spawnBullet(game, p, speed, now) {
  const sp = Number(speed) > 0 ? speed : BULLET_SPEED_MIN;
  const stamp = Number(now) > 0 ? now : Date.now();
  // 「子弹变大」道具生效期间，这一发按放大后的半径出生（大小记在子弹自己身上，
  // 之后就算增益到期，已经飞出去的子弹也不会突然缩回去）
  const big = (p.bigBulletUntil || 0) > stamp;
  const r = big ? BIG_BULLET_R : BULLET_R;
  const dist = PLAYER_R + r + 4;
  const minX = WALL + r;
  const maxX = ARENA_W - WALL - r;
  const minY = WALL + r;
  const maxY = ARENA_H - WALL - r;
  let x = p.x + Math.cos(p.aim) * dist;
  let y = p.y + Math.sin(p.aim) * dist;
  let vx = Math.cos(p.aim) * sp;
  let vy = Math.sin(p.aim) * sp;
  // 贴墙开火时出生点会被压回场内，同时把对应方向的速度翻掉，避免子弹卡在墙里
  if (x < minX) {
    x = minX;
    vx = -vx;
  } else if (x > maxX) {
    x = maxX;
    vx = -vx;
  }
  if (y < minY) {
    y = minY;
    vy = -vy;
  } else if (y > maxY) {
    y = maxY;
    vy = -vy;
  }
  const b = {
    id: game.nextBulletId++,
    x,
    y,
    vx,
    vy,
    r,
    big: big ? 1 : 0,
    ownerId: p.id,
    ownerIndex: game.players.indexOf(p),
  };
  game.bullets.push(b);
  // 每人同时存在的子弹上限（基础 5 + 备弹扩容道具）：
  // 超出时把该玩家最早的子弹挤掉（game.bullets 按发射时间递增）
  const cap = bulletCapOf(p);
  let mine = 0;
  for (const q of game.bullets) if (q.ownerId === p.id) mine++;
  for (let i = 0; i < game.bullets.length && mine > cap; i++) {
    if (game.bullets[i].ownerId === p.id) {
      game.bullets.splice(i, 1);
      i--;
      mine--;
    }
  }
}

function stepBullet(b, dt, walls) {
  const br = b.r || BULLET_R;
  const minX = WALL + br;
  const maxX = ARENA_W - WALL - br;
  const minY = WALL + br;
  const maxY = ARENA_H - WALL - br;
  let nx = b.x + b.vx * dt;
  let ny = b.y + b.vy * dt;
  let guard = 0;
  while ((nx < minX || nx > maxX || ny < minY || ny > maxY) && guard++ < 8) {
    if (nx < minX) {
      nx = minX + (minX - nx);
      b.vx = -b.vx;
    } else if (nx > maxX) {
      nx = maxX - (nx - maxX);
      b.vx = -b.vx;
    }
    if (ny < minY) {
      ny = minY + (minY - ny);
      b.vy = -b.vy;
    } else if (ny > maxY) {
      ny = maxY - (ny - maxY);
      b.vy = -b.vy;
    }
  }
  b.x = clamp(nx, minX, maxX);
  b.y = clamp(ny, minY, maxY);
  // 内部墙体（方形 / 弧形）碰撞：推出并反射
  if (walls && walls.length) {
    const c = collideCircle(walls, b.x, b.y, br, b.vx, b.vy);
    b.x = c.x;
    b.y = c.y;
    b.vx = c.vx;
    b.vy = c.vy;
  }
}

function clampPlayer(p) {
  const minX = WALL + PLAYER_R;
  const maxX = ARENA_W - WALL - PLAYER_R;
  const minY = WALL + PLAYER_R;
  const maxY = ARENA_H - WALL - PLAYER_R;
  p.x = clamp(p.x, minX, maxX);
  p.y = clamp(p.y, minY, maxY);
}

/** 简单圆形分离，避免小人重叠堆叠 */
function separatePlayers(game) {
  const list = game.players.filter((p) => p.alive);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      const min = PLAYER_R * 2;
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
      clampPlayer(a);
      clampPlayer(b);
    }
  }
}

function applyDamage(game, bullet, victim) {
  // 护盾：抵消这一次命中（不扣血），子弹照样消失
  if (victim.shield > 0) {
    victim.shield -= 1;
    game.roundEvents.push({
      killerId: null,
      victimId: victim.id,
      fatal: false,
      shielded: true,
    });
    return;
  }
  victim.hp -= 1;
  if (victim.hp > 0) {
    game.roundEvents.push({
      killerId: bullet.ownerId === victim.id ? null : bullet.ownerId,
      victimId: victim.id,
      fatal: false,
    });
    return;
  }
  victim.hp = 0;
  victim.alive = false;
  victim.deaths += 1;
  let killerId = null;
  if (bullet.ownerId && bullet.ownerId !== victim.id) {
    const killer = game.players.find((p) => p.id === bullet.ownerId);
    if (killer) {
      killer.kills += 1;
      killer.score += SCORE_KILL;
      game.scores[killer.id] = killer.score;
      killerId = killer.id;
    }
  }
  game.roundEvents.push({ killerId, victimId: victim.id, fatal: true });
}

function endRound(game, alive) {
  const now = Date.now();
  if (alive.length === 1) {
    const w = alive[0];
    w.score += SCORE_SURVIVE;
    game.scores[w.id] = w.score;
  }
  game.lastRound = {
    roundIndex: game.roundIndex,
    winnerId: alive.length === 1 ? alive[0].id : null,
    survivorIds: alive.map((p) => p.id),
    events: game.roundEvents.slice(),
  };
  // 本局结束：清除所有残留子弹，避免在 roundOver/结算阶段仍渲染飞行中的子弹
  game.bullets = [];
  game.phase = 'roundOver';
  game.phaseEndsAt = now + ROUND_END_MS;
}

function rankingOf(game) {
  return game.players
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      kills: p.kills,
      deaths: p.deaths,
    }))
    .sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
}

function finishMatch(game) {
  game.phase = 'over';
  game.over = true;
  game.matchOver = true;
  game.bullets = [];
  game.items = [];
  game.ranking = rankingOf(game);
  if (
    game.ranking.length &&
    (game.ranking.length === 1 ||
      game.ranking[0].score > game.ranking[1].score)
  ) {
    game.winnerId = game.ranking[0].id;
  } else {
    game.winnerId = null;
  }
}

function advanceRound(game) {
  const remaining = game.players.filter((p) => !p.left);
  if (remaining.length <= 1) {
    finishMatch(game);
    return;
  }
  if (game.roundIndex >= game.matchGames) {
    finishMatch(game);
    return;
  }
  game.roundIndex += 1;
  resetRound(game);
}

function step(game, dt, now) {
  if (game.phase === 'countdown') {
    if (now >= game.phaseEndsAt) {
      game.phase = 'playing';
      game.phaseEndsAt = 0;
    }
    return;
  }
  if (game.phase === 'roundOver') {
    if (now >= game.phaseEndsAt) advanceRound(game);
    return;
  }
  if (game.phase !== 'playing') return;

  // 本局道具：进入对战后确保已铺好（每局重铺），并处理定时补货与拾取
  ensureItems(game, now);

  for (const p of game.players) {
    if (!p.alive) continue;
    const inp = p.input || {};
    const mx = Number(inp.mx) || 0;
    const my = Number(inp.my) || 0;
    if (mx || my) {
      const len = Math.hypot(mx, my) || 1;
      const spd = speedOf(p, now); // 疾风道具生效期间加速
      p.x += (mx / len) * spd * dt;
      p.y += (my / len) * spd * dt;
    }
    const aim = Number(inp.aim);
    if (Number.isFinite(aim)) p.aim = aim;
    clampPlayer(p);
  }
  separatePlayers(game);

  // 把小人推出内部墙体（贴边时不会卡进墙里）
  for (const p of game.players) {
    if (!p.alive) continue;
    const c = collideCircle(game.walls, p.x, p.y, PLAYER_R, 0, 0);
    p.x = c.x;
    p.y = c.y;
    clampPlayer(p);
  }

  // 蓄力发射：按住（charge）累计蓄力，松开时按蓄力时长决定子弹速度；
  // 受发射间隔（nextFireAt）限制，冷却期内即使快速点按也无法连发。
  for (const p of game.players) {
    if (!p.alive) {
      p.chargeMs = 0;
      p.charging = false;
      continue;
    }
    const inp = p.input || {};
    const charging = inp.charge ? true : false;
    if (charging) {
      p.chargeMs = Math.min(CHARGE_MAX_MS, (p.chargeMs || 0) + dt * 1000);
    }
    if (p.charging && !charging) {
      // 松开鼠标 → 发射一次（冷却期内则丢弃，保证有发射间隔）
      if (now >= p.nextFireAt) {
        spawnBullet(game, p, chargeToSpeed(p.chargeMs || 0), now);
        p.nextFireAt = now + FIRE_COOLDOWN_MS;
      }
      p.chargeMs = 0;
    }
    p.charging = charging;
  }

  const kept = [];
  for (const b of game.bullets) {
    stepBullet(b, dt, game.walls);
    const br = b.r || BULLET_R;
    let hit = null;
    for (const p of game.players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d <= PLAYER_R + br) {
        hit = p;
        break;
      }
    }
    if (hit) {
      applyDamage(game, b, hit);
      continue;
    }
    kept.push(b);
  }
  game.bullets = kept;
  if (game.bullets.length > MAX_BULLETS) {
    game.bullets.splice(0, game.bullets.length - MAX_BULLETS);
  }

  // 道具拾取放在子弹结算之后：本帧被击中的玩家不会顺手吃到道具
  updateItems(game, now);

  const alive = game.players.filter((p) => p.alive);
  if (alive.length <= 1) endRound(game, alive);
}

function tick(game) {
  const now = Date.now();
  let dt = (now - game._lastTick) / 1000;
  game._lastTick = now;
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  if (dt > MAX_DT) dt = MAX_DT;

  const before = game.phase;
  const steps = Math.max(1, Math.min(4, Math.ceil(dt / SUB_STEP)));
  const sub = dt / steps;
  for (let i = 0; i < steps && game.phase === before; i++) {
    step(game, sub, now);
  }
  game.seq += 1;
  return game.phase !== before;
}

function snapshot(game) {
  const now = Date.now();
  return {
    t: now,
    seq: game.seq,
    phase: game.phase,
    until: game.phaseEndsAt || 0,
    r: game.roundIndex,
    m: game.matchGames,
    hp: game.players.map((p) => p.hp),
    ps: game.players.map((p) => [
      round1(p.x),
      round1(p.y),
      round2(p.aim),
      p.hp,
      p.alive ? 1 : 0,
      p.shield || 0, // 5 护盾层数
      (p.bigBulletUntil || 0) > now ? Math.round(p.bigBulletUntil - now) : 0, // 6 子弹变大剩余 ms
      (p.speedUntil || 0) > now ? Math.round(p.speedUntil - now) : 0, // 7 疾风剩余 ms
      p.ammoBonus || 0, // 8 备弹扩容加成
    ]),
    bs: game.bullets.map((b) => [
      b.id,
      round1(b.x),
      round1(b.y),
      round1(b.vx),
      round1(b.vy),
      b.ownerIndex,
      b.big ? 1 : 0, // 6 是否大子弹（半径放大）
    ]),
    its: game.items.map((it) => [
      it.id,
      round1(it.x),
      round1(it.y),
      it.type,
    ]),
  };
}

function publicGameState(game) {
  if (!game) return null;
  return {
    type: 'blaster',
    arena: { w: game.arena.w, h: game.arena.h, wall: game.arena.wall },
    consts: { ...game.consts },
    walls: game.walls.map((w) => ({ ...w })),
    phase: game.phase,
    phaseEndsAt: game.phaseEndsAt || 0,
    roundIndex: game.roundIndex,
    matchGames: game.matchGames,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      x: round1(p.x),
      y: round1(p.y),
      aim: round2(p.aim),
      hp: p.hp,
      alive: Boolean(p.alive),
      kills: p.kills,
      deaths: p.deaths,
      score: p.score,
      shield: p.shield || 0,
      ammoBonus: p.ammoBonus || 0,
      bigBulletUntil: p.bigBulletUntil || 0,
      speedUntil: p.speedUntil || 0,
      pickups: p.pickups || 0,
      left: Boolean(p.left),
    })),
    bullets: game.bullets.map((b) => ({
      id: b.id,
      x: round1(b.x),
      y: round1(b.y),
      vx: round1(b.vx),
      vy: round1(b.vy),
      r: b.r || BULLET_R,
      big: Boolean(b.big),
      ownerId: b.ownerId,
      ownerIndex: b.ownerIndex,
    })),
    items: game.items.map((it) => ({
      id: it.id,
      type: it.type,
      x: round1(it.x),
      y: round1(it.y),
      r: ITEM_R,
    })),
    pickupEvents: game.pickupEvents.slice(-20),
    scores: { ...game.scores },
    ranking: game.ranking.map((r) => ({ ...r })),
    roundEvents: game.roundEvents.slice(),
    lastRound: game.lastRound
      ? {
          roundIndex: game.lastRound.roundIndex,
          winnerId: game.lastRound.winnerId,
          survivorIds: game.lastRound.survivorIds.slice(),
          events: game.lastRound.events.slice(),
        }
      : null,
    over: Boolean(game.over),
    matchOver: Boolean(game.matchOver),
    winnerId: game.winnerId || null,
    seq: game.seq,
    serverTime: Date.now(),
  };
}

function getActingPlayerIds() {
  return [];
}

/** 实时对战：玩家输入通过 game:rtInput 上报，不走 applyAction */
function applyAction() {
  return { ok: false, error: '实时对战无需落子操作' };
}

function setPlayerInput(game, playerId, data) {
  if (!game || !playerId) return false;
  const p = game.players.find((x) => x.id === playerId);
  if (!p) return false;
  const d = data || {};
  const inp = p.input || (p.input = { mx: 0, my: 0, aim: p.aim, charge: 0 });
  inp.mx = clamp(Math.round(Number(d.mx) || 0), -1, 1);
  inp.my = clamp(Math.round(Number(d.my) || 0), -1, 1);
  const aim = Number(d.aim);
  if (Number.isFinite(aim)) inp.aim = aim;
  inp.charge = d.charge ? 1 : 0;
  if (!p.alive) {
    inp.mx = 0;
    inp.my = 0;
    inp.charge = 0;
  }
  return true;
}

function onPlayerQuit(game, playerId) {
  if (!game || game.over) return;
  const p = game.players.find((x) => x.id === playerId);
  if (!p) return;
  p.left = true;
  p.alive = false;
  p.hp = 0;
  p.input = { mx: 0, my: 0, aim: p.aim, charge: 0 };
  if (game.phase === 'playing') {
    const alive = game.players.filter((x) => x.alive);
    if (alive.length <= 1) endRound(game, alive);
  }
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
  if (!room || !room.game || room.game.type !== 'blaster') return;
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
      console.error('[blaster] tick failed:', err && err.message);
      stopLoop(room.id);
      return;
    }
    try {
      if (io && typeof io.broadcastRt === 'function') {
        io.broadcastRt(snapshot(cur));
      }
      if (changed && io && typeof io.broadcastState === 'function') {
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
  id: 'blaster',
  label: '弹射对决',
  minPlayers: 2,
  maxPlayers: 4,
  modes: [{ id: 'standard', label: '标准模式' }],
  client: {
    styles: ['/games/blaster/style.css'],
    scripts: ['/games/blaster/ui.js'],
    panel: '/games/blaster/panel.html',
  },
  createGameState,
  assignRandomWalls,
  applyAction,
  publicGameState,
  getActingPlayerIds,
  onPlayerQuit,
  setPlayerInput,
  startLoop,
  stopLoop,
  stopAllLoops,
  snapshot,
  clampMatchGames,
  /** 实时对战：不支持添加电脑，也不支持对局中托管 */
  supportsHosting: false,

  /** 冒烟测试用：暴露内部推进函数，避免依赖真实时钟 */
  __test: {
    step,
    tick,
    resetRound,
    advanceRound,
    endRound,
    finishMatch,
    spawnBullet,
    generateWalls,
    buildWallCandidate,
    validateLayout,
    pointInWall,
    collideCircle,
    contactWall,
    wallCenter,
    // 元胞自动机地图生成
    caRandomFill,
    caStep,
    caRun,
    caCarveSpawns,
    caBlobs,
    fitBlob,
    emitFromFit,
    blobToWalls,
    // 道具系统
    ensureItems,
    updateItems,
    spawnItems,
    applyItem,
    pickItemType,
    findItemSpot,
    bulletCapOf,
    speedOf,
    consts: {
      ARENA_W,
      ARENA_H,
      WALL,
      PLAYER_R,
      BULLET_R,
      PLAYER_SPEED,
      BULLET_SPEED,
      BULLET_SPEED_MIN,
      BULLET_SPEED_MAX,
      CHARGE_MAX_MS,
      MAX_HP,
      FIRE_COOLDOWN_MS,
      MAX_BULLETS_PER_PLAYER,
      SCORE_SURVIVE,
      SCORE_KILL,
      // 元胞自动机 / 墙体图元参数
      CA_CELL,
      CA_FILL,
      CA_ITER,
      CA_BIRTH,
      CA_SURVIVE,
      CA_SPAWN_CLEAR,
      CA_MIN_BLOB,
      CA_MIN_WALLS,
      CA_MAX_WALLS,
      CA_FIT_MIN,
      CA_SPLIT_DEPTH,
      CA_ARC_ASPECT,
      CA_MIN_ARC_CELL,
      CA_MIN_WALL_LEN,
      WALL_THICK_MIN,
      WALL_THICK_MAX,
      ITEM_R,
      ITEM_TABLE,
      ITEM_INITIAL_MIN,
      ITEM_INITIAL_MAX,
      ITEM_SPAWN_INTERVAL_MS,
      ITEM_SPAWN_BATCH,
      ITEM_MAX_ON_MAP,
      ITEM_MIN_GAP,
      BIG_BULLET_R,
      BIG_BULLET_SCALE,
      BIG_BULLET_MS,
      AMMO_BONUS_PER_PICKUP,
      MAX_AMMO_BONUS,
      SPEED_BOOST_MULT,
      SPEED_BOOST_MS,
      MAX_SHIELD,
    },
  },
};
