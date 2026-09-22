'use strict';

/**
 * 战争工厂（warfactory）客户端：水墨渲染 + RTS 操作。
 *
 * 服务端权威：全部单位/工厂状态来自 game:rt 快照（10Hz），本端做插值平滑；
 * 玩家只上报离散指令（框选后右键进攻移动），走 game:rtInput 通道。
 * 画面：宣纸底 + 淡墨远山 + 竹石点缀；单位造型沿用玩家手绘模型并水墨化。
 */

window.WarFactoryUi = (function () {
  const TAU = Math.PI * 2;

  // ==== 世界与视口 ====
  let WORLD_W = 2400;
  let WORLD_H = 1600;
  const VIEW_W = 1280; // 设计视口宽（世界像素）
  let VIEW_H = 800; // 由容器纵横比决定
  const MINIMAP_W = 210;
  const MINIMAP_H = 140;

  // ==== 建筑半径（与服务端 consts 对齐；服务端下发后以 consts 为准）====
  const LAB_R_FALLBACK = 46;
  const HQ_R_FALLBACK = 64;
  function labR() {
    return (meta && meta.consts && meta.consts.labR) || LAB_R_FALLBACK;
  }
  function hqR() {
    return (meta && meta.consts && meta.consts.hqR) || HQ_R_FALLBACK;
  }

  // ==== 水墨配色 ====
  const INK = '#2a2620';
  const PAPER = '#ece3cd';
  const PAPER_DEEP = '#e3d8bd';
  const TYPE_ACCENT = {
    warrior: '#8f3b2e',
    shield: '#3d5a78',
    ranger: '#4a453c',
    burst: '#a3742a',
    burn: '#9c3b2c',
    laser: '#2f6f7a',
  };
  const LEVEL_CHAR = { 1: '初', 2: '中', 3: '高' };
  const TIER_CHAR = { 1: '初', 2: '中', 3: '高' };

  const CALLOUT_FONT = '"STKaiti","KaiTi","Noto Serif SC","SimSun",serif';

  let net = null;
  let meta = null;
  let meId = null;
  let isSpectator = false;
  let trFn = null;

  let panel = null;
  let canvas = null;
  let ctx = null;
  let dpr = 1;
  let cssW = 1280;
  let cssH = 800;
  let zoom = 1;

  let scoreBox = null;
  let titleEl = null;
  let statusEl = null;

  let active = false;
  let raf = 0;
  let lastFrame = 0;
  let rtBound = false;
  let startedAt = 0;
  // 同一局的稳定指纹：用于区分「同局 repeated render」与「开新局」，避免每次 game:state 都重置镜头/清空单位
  let lastMatchKey = null;

  // ==== 运行时状态 ====
  let lastSnap = null;
  const units = new Map(); // id → 可绘制单位（插值）
  let factoriesView = []; // {id,x,y,level,home,owner,capBy,capProg,prodProg,contested,pt,hp,hpMax,ecd}
  let labsView = []; // {id,x,y,owner,hp,hpMax}
  let hqView = []; // {id,x,y,owner,hp,hpMax,down}
  let rpView = []; // 各玩家科技点（与 meta.players 同序）
  const selection = new Set();
  let selFacId = 0; // 当前选中的本方工厂：右键为其设置集结点（0 = 未选中）
  let selHqId = 0; // 当前选中的本方总部：右侧面板展示亲兵进化（0 = 未选中）
  const rallyById = new Map(); // 工厂 id → {x,y} 集结点（服务端权威）
  const UNIT_CN = { warrior: '锐士', shield: '盾卫', ranger: '游侠', burst: '轰击', burn: '燎原', laser: '激光兵' };
  const cam = { x: 0, y: 0 };
  const keys = Object.create(null);
  const boxSel = { on: false, x0: 0, y0: 0, x1: 0, y1: 0, add: false };
  const effects = []; // 特效队列
  const moveMarkers = [];
  const rallyFx = []; // 设置集结点时的落点特效
  let bgCanvas = null;
  let bgReady = false;
  let lastCardKey = '';
  let lastStatus = '';
  let lastHudKey = '';

  // ==== 右侧工厂面板（选中工厂时弹出）====
  let facPanelEl = null;
  const fpEls = {}; // 面板内各节点的缓存
  let facPanelKey = ''; // 结构签名：工厂 id/等级/归属/兵种 变化时重建静态部分
  const UNIT_DESC = {
    warrior: '近战突进，攻守兼备',
    shield: '重甲缓慢，坚不可摧',
    ranger: '远程狙击，薄血长射',
    burst: '范围炮击，落点成墨',
    burn: '引火灼烧，伤上加伤',
    laser: '锁定越久伤害越高，最高 5 倍',
  };

  // ==== 地形（元胞自动机：上半生成 + 180° 旋转出下半）====
  let terrainCanvas = null;
  let terrainReady = false;
  let terrainGrid = null; // [gh][gw] → 地形类型 id
  let terrainGW = 0;
  let terrainGH = 0;
  const TERRAIN_CELL = 40; // 每个地形格的世界像素
  // 与服务端（server/games/warfactory/index.js）保持一致的地形常量
  // 类型：0 平原 / 2 山地（不可通行，窄而连续）/ 3 沼泽（可通行，减速）/ 4 水域（不可通行，大片连续）
  const WATER_TOP = 0.28; // 高程低于此值 → 水域
  const SWAMP_TOP = 0.44; // 高程低于此值 → 沼泽，其余为平原
  const SMOOTH_ROUNDS = 6;
  const MAJORITY_ROUNDS = 2;
  const MIN_WATER_BLOB = 10;
  const RIDGE_COUNT = 3;
  const RIDGE_WIDEN = 0.32;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function tr(key, vars, fallback) {
    if (typeof trFn === 'function') {
      const v = trFn(key, vars);
      if (v && v !== key) return v;
    }
    return fallback;
  }

  function hexAlpha(hex, alpha) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return 'rgba(42,38,32,' + alpha + ')';
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /** 与服务端 unitStats 一致的属性推算（客户端展示用） */
  function unitStatsOf(type, tier, branch) {
    const st = (meta && meta.consts && meta.consts.stats) || {};
    const s = st[type] || { hp: 100, dmg: 10, range: 60, cd: 1, r: 14 };
    const tierHp = (meta && meta.consts && meta.consts.tierHp) || [1, 1.7, 2.6];
    const t = clamp(tier, 1, 3) - 1;
    return {
      hp: Math.round(s.hp * tierHp[t] * (branch === 'B' ? 1.25 : 1)),
      r: s.r || 14,
    };
  }

  /* ================= 背景（宣纸 + 远山 + 竹石） ================= */

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

  function buildBackground(seed) {
    const c = document.createElement('canvas');
    c.width = WORLD_W;
    c.height = WORLD_H;
    const b = c.getContext('2d');
    const rng = makeRng(seed || 20260922);

    // 宣纸底色
    b.fillStyle = PAPER;
    b.fillRect(0, 0, WORLD_W, WORLD_H);

    // 纸纤维与噪点
    b.fillStyle = 'rgba(90,74,52,0.045)';
    for (let i = 0; i < 5200; i++) {
      b.fillRect(rng() * WORLD_W, rng() * WORLD_H, 1.4, 1.4);
    }
    b.strokeStyle = 'rgba(120,100,70,0.05)';
    b.lineWidth = 1;
    for (let i = 0; i < 160; i++) {
      const x = rng() * WORLD_W;
      const y = rng() * WORLD_H;
      const a = rng() * TAU;
      const l = 14 + rng() * 40;
      b.beginPath();
      b.moveTo(x, y);
      b.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.25);
      b.stroke();
    }

    // 淡墨远山（三四层）
    const layers = [
      { base: WORLD_H * 0.3, amp: 120, alpha: 0.055, peaks: 6 },
      { base: WORLD_H * 0.42, amp: 90, alpha: 0.075, peaks: 8 },
      { base: WORLD_H * 0.76, amp: 100, alpha: 0.05, peaks: 7 },
    ];
    for (const L of layers) {
      b.beginPath();
      b.moveTo(0, WORLD_H);
      b.lineTo(0, L.base);
      let x = 0;
      let px = 0;
      for (let p = 0; p <= L.peaks; p++) {
        px = x;
        x = ((p + 1) / (L.peaks + 1)) * WORLD_W + (rng() - 0.5) * 160;
        const peakY = L.base - L.amp * (0.4 + rng() * 0.6);
        const midX = (px + x) / 2;
        b.quadraticCurveTo(midX, peakY, x, L.base + (rng() - 0.5) * 30);
      }
      b.lineTo(WORLD_W, WORLD_H);
      b.closePath();
      b.fillStyle = 'rgba(42,38,32,' + L.alpha + ')';
      b.fill();
      // 山脊淡描
      b.strokeStyle = 'rgba(42,38,32,' + (L.alpha + 0.03) + ')';
      b.lineWidth = 2;
      b.stroke();
    }

    // 云雾留白带
    for (let i = 0; i < 5; i++) {
      const y = WORLD_H * (0.2 + rng() * 0.6);
      const h = 40 + rng() * 90;
      const g = b.createLinearGradient(0, y - h / 2, 0, y + h / 2);
      g.addColorStop(0, 'rgba(236,227,205,0)');
      g.addColorStop(0.5, 'rgba(236,227,205,0.5)');
      g.addColorStop(1, 'rgba(236,227,205,0)');
      b.fillStyle = g;
      b.fillRect(0, y - h / 2, WORLD_W, h);
    }

    // 竹丛（固定点位，避开建筑）
    const bamboos = [
      [300, 300], [2100, 1300], [400, 1450], [2000, 200],
      [1150, 620], [1250, 980], [820, 900], [1580, 700],
    ];
    for (const [bx, by] of bamboos) {
      const n = 5 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const x = bx + (rng() - 0.5) * 90;
        const y = by + (rng() - 0.5) * 60;
        const h = 70 + rng() * 70;
        const lean = (rng() - 0.5) * 0.24;
        b.strokeStyle = 'rgba(58,72,52,' + (0.4 + rng() * 0.3) + ')';
        b.lineWidth = 2.6;
        b.beginPath();
        b.moveTo(x, y);
        b.quadraticCurveTo(x + lean * h * 0.5, y - h * 0.6, x + lean * h, y - h);
        b.stroke();
        // 竹节
        b.lineWidth = 1;
        for (let k = 1; k <= 3; k++) {
          const t = k / 4;
          const jx = x + lean * h * t * t;
          const jy = y - h * t;
          b.beginPath();
          b.moveTo(jx - 3, jy);
          b.lineTo(jx + 3, jy);
          b.stroke();
        }
        // 竹叶
        b.fillStyle = 'rgba(58,72,52,0.5)';
        for (let k = 0; k < 4; k++) {
          const lx = x + lean * h + (rng() - 0.5) * 26;
          const ly = y - h - 6 + (rng() - 0.5) * 22;
          const la = -0.6 - rng() * 0.8;
          b.save();
          b.translate(lx, ly);
          b.rotate(la);
          b.beginPath();
          b.ellipse(9, 0, 10, 2.6, 0, 0, TAU);
          b.fill();
          b.restore();
        }
      }
    }

    // 顽石点缀
    for (let i = 0; i < 10; i++) {
      const x = 120 + rng() * (WORLD_W - 240);
      const y = 120 + rng() * (WORLD_H - 240);
      const r = 8 + rng() * 16;
      b.beginPath();
      b.ellipse(x, y, r, r * 0.62, rng() * TAU, 0, TAU);
      b.fillStyle = 'rgba(42,38,32,0.08)';
      b.fill();
      b.strokeStyle = 'rgba(42,38,32,0.3)';
      b.lineWidth = 2;
      b.stroke();
    }

    // 边缘晕染（旧纸感）
    const vg = b.createRadialGradient(
      WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.45,
      WORLD_W / 2, WORLD_H / 2, WORLD_W * 0.72
    );
    vg.addColorStop(0, 'rgba(80,60,30,0)');
    vg.addColorStop(1, 'rgba(80,60,30,0.14)');
    b.fillStyle = vg;
    b.fillRect(0, 0, WORLD_W, WORLD_H);

    bgCanvas = c;
    bgReady = true;
  }

  /* ================= 地形（元胞自动机生成） ================= */

  // 由字符串生成稳定哈希，作为每局地形种子（主机端/加入端一致）
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // 基于格子坐标的确定性随机数：保证上下半 180° 对称时笔触一致
  function cellRng(r, c) {
    let s = ((r * 73856093) ^ (c * 19349663) ^ 0x9e3779b9) >>> 0;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return (s >>> 0) / 4294967296;
    };
  }

  /**
   * 生成地形（与服务端算法完全一致）：
   *  1) 仅对「上半地图」做元胞自动机（随机初始高程场 → 多轮邻域扩散平滑 → 起伏地形）；
   *  2) 高程阈值分出 水域 / 沼泽 / 平原，再经众数滤波与小斑块清理，使水域成大片连续；
   *  3) 山体改用「随机游走山脊」，只走正交 4 方向，故窄而连续成脉；
   *  4) 下半地图由上半地图 180° 旋转得到（点对称，行数取偶数保证中缝无缝）。
   * 类型：0 平原 / 2 山地 / 3 沼泽 / 4 水域。
   */
  function buildTerrain(seed) {
    try {
      const rng = makeRng((seed >>> 0) || 1);
      const CELL = TERRAIN_CELL;
      let gw = Math.max(8, Math.round(WORLD_W / CELL));
      let gh = Math.max(6, Math.round(WORLD_H / CELL));
      if (gh % 2 === 1) gh -= 1; // 偶数行：确保上下半 180° 旋转无缝衔接
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
            let sum = 0, n = 0;
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                const rr = r + dr, cc = c + dc;
                if (rr < 0 || rr >= half || cc < 0 || cc >= gw) continue;
                sum += elev[rr][cc]; n++;
              }
            }
            nx[r][c] = (elev[r][c] * 3 + sum) / (3 + n);
          }
        }
        for (let r = 0; r < half; r++) elev[r] = nx[r];
      }

      // 3) 归一化到 [0,1]，再做对比拉伸，避免平滑后高程挤在中段
      let mn = 1, mx = 0;
      for (let r = 0; r < half; r++) for (let c = 0; c < gw; c++) {
        if (elev[r][c] < mn) mn = elev[r][c];
        if (elev[r][c] > mx) mx = elev[r][c];
      }
      const span = (mx - mn) || 1;
      const GAIN = 1.8; // 拉开分布，使水/山更分明
      for (let r = 0; r < half; r++) for (let c = 0; c < gw; c++) {
        let v = (elev[r][c] - mn) / span;
        v = (v - 0.5) * GAIN + 0.5;
        elev[r][c] = v < 0 ? 0 : v > 1 ? 1 : v;
      }

      // 4) 上半分类：低处水域 / 次低沼泽 / 其余平原
      const top = [];
      for (let r = 0; r < half; r++) {
        top[r] = [];
        for (let c = 0; c < gw; c++) {
          const e = elev[r][c];
          top[r][c] = e < WATER_TOP ? 4 : e < SWAMP_TOP ? 3 : 0;
        }
      }
      majorityFilter(top);
      drawRidges(top, rng);
      dropSmallBlobs(top, 4, MIN_WATER_BLOB, 3);

      // 5) 下半 = 上半 180° 旋转（点对称）
      const grid = [];
      for (let r = 0; r < gh; r++) {
        grid[r] = [];
        for (let c = 0; c < gw; c++) {
          const er = r < half ? r : gh - 1 - r;
          const ec = r < half ? c : gw - 1 - c;
          grid[r][c] = top[er][ec];
        }
      }

      // 兜底生成时：清理建筑（工厂/研究所）周围的山地与水域，避免建筑被不可通行地形封死
      clearTerrainAroundBuildingsLocal(grid, gw, gh);

      setTerrainGrid(grid, gw, gh);
    } catch (err) {
      terrainReady = false;
      if (typeof console !== 'undefined') console.warn('[warfactory] 地形生成失败:', err);
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
              const rr = r + dr, cc = c + dc;
              if (rr < 0 || rr >= R || cc < 0 || cc >= C) continue;
              const v = grid[rr][cc];
              cnt[v] = (cnt[v] || 0) + 1;
            }
          }
          let best = grid[r][c]; // 平票时保留原类型
          let bn = cnt[best] || 0;
          for (const k in cnt) if (cnt[k] > bn) { best = Number(k); bn = cnt[k]; }
          nx[r][c] = best;
        }
      }
      for (let r = 0; r < R; r++) grid[r] = nx[r];
    }
  }

  /** 随机游走山脊：只走正交 4 方向（保证 4-连通不断裂），线宽多为 1 格，故山体窄而连续成脉 */
  function drawRidges(grid, rng) {
    const half = grid.length;
    if (!half) return;
    const gw = grid[0].length;
    const dr4 = [-1, 0, 1, 0];
    const dc4 = [0, 1, 0, -1];
    const put = (r, c) => {
      if (r < 0 || r >= half || c < 0 || c >= gw) return;
      grid[r][c] = 2;
    };
    for (let k = 0; k < RIDGE_COUNT; k++) {
      let r = Math.floor(rng() * half);
      let c = Math.floor(rng() * gw);
      let dir = Math.floor(rng() * 4);
      const len = Math.floor(gw * (0.9 + rng() * 1.2));
      for (let s = 0; s < len; s++) {
        put(r, c);
        if (rng() < RIDGE_WIDEN) put(r + dr4[(dir + 1) % 4], c + dc4[(dir + 1) % 4]);
        if (rng() < 0.22) dir = (dir + (rng() < 0.5 ? 1 : 3)) % 4;
        let nr = r + dr4[dir], nc = c + dc4[dir];
        if (nr < 0 || nr >= half || nc < 0 || nc >= gw) {
          dir = (dir + 2) % 4;
          nr = r + dr4[dir]; nc = c + dc4[dir];
          if (nr < 0) nr = 0; else if (nr >= half) nr = half - 1;
          if (nc < 0) nc = 0; else if (nc >= gw) nc = gw - 1;
        }
        r = nr; c = nc;
      }
    }
  }

  /** 抹掉面积小于 minArea 的同类连通块（转为 fallback），保证水域都是大片连续 */
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
          const y = cur[0], x = cur[1];
          for (let k = 0; k < 4; k++) {
            const ny = y + (k === 0 ? 1 : k === 1 ? -1 : 0);
            const nx2 = x + (k === 2 ? 1 : k === 3 ? -1 : 0);
            if (ny < 0 || ny >= R || nx2 < 0 || nx2 >= C) continue;
            if (seen[ny * C + nx2] || grid[ny][nx2] !== type) continue;
            seen[ny * C + nx2] = true;
            st.push([ny, nx2]);
          }
        }
        if (cells.length < minArea) for (const cell of cells) grid[cell[0]][cell[1]] = fallback;
      }
    }
  }

  // 把地形类型网格写入离屏画布（一次性栅格化，逐帧直接贴图）
  function setTerrainGrid(grid, gw, gh) {
    terrainGrid = grid;
    terrainGW = gw;
    terrainGH = gh;
    const cv = document.createElement('canvas');
    cv.width = WORLD_W;
    cv.height = WORLD_H;
    paintTerrain(cv.getContext('2d'), grid, gw, gh, TERRAIN_CELL);
    terrainCanvas = cv;
    terrainReady = true;
  }

  /** 解析服务端下发的地形（权威），优先于本地生成使用 */
  function applyServerTerrain(terr) {
    try {
      if (!terr || !terr.data) return false;
      const cols = terr.cols || terrainGW || 60;
      const rows = terr.rows || terrainGH || 40;
      const data = terr.data;
      const grid = [];
      let ok = true;
      for (let r = 0; r < rows; r++) {
        grid[r] = [];
        for (let c = 0; c < cols; c++) {
          const v = Number(data[r * cols + c]);
          grid[r][c] = Number.isInteger(v) && v >= 0 && v <= 4 ? v : 0;
          if (!Number.isInteger(v)) ok = false;
        }
      }
      setTerrainGrid(grid, cols, rows);
      return ok;
    } catch (err) {
      terrainReady = false;
      if (typeof console !== 'undefined') console.warn('[warfactory] 服务端地形解析失败:', err);
      return false;
    }
  }

  // 本地兜底时，把建筑周围的山地与水域清成平原（与服务端一致）
  function clearTerrainAroundBuildingsLocal(grid, gw, gh) {
    if (!meta || !meta.factories) return;
    const R = 3;
    const pts = [];
    for (const f of meta.factories) pts.push([f.x, f.y]);
    if (meta.labs) for (const l of meta.labs) pts.push([l.x, l.y]);
    for (const pt of pts) {
      const cc = Math.floor(pt[0] / TERRAIN_CELL);
      const cr = Math.floor(pt[1] / TERRAIN_CELL);
      for (let r = cr - R; r <= cr + R; r++) {
        for (let c = cc - R; c <= cc + R; c++) {
          if (r < 0 || r >= gh || c < 0 || c >= gw) continue;
          if (grid[r][c] === 2) grid[r][c] = 0;
        }
      }
    }
  }

  // 把地形类型网格画成水墨笔触（平原留白透出宣纸）
  function paintTerrain(g, grid, gw, gh, CELL) {
    for (let r = 0; r < gh; r++) {
      for (let c = 0; c < gw; c++) {
        const t = grid[r][c];
        if (t === 0) continue;
        const x = c * CELL, y = r * CELL;
        const cx = x + CELL / 2, cy = y + CELL / 2;
        const cr = cellRng(r, c);
        if (t === 3) {
          // 沼泽（可通行，减速）：湿墨底色 + 草簇点
          g.fillStyle = 'rgba(104,104,72,0.20)';
          g.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
          const n = 3 + Math.floor(cr() * 3);
          for (let i = 0; i < n; i++) {
            const px = x + 4 + cr() * (CELL - 8);
            const py = y + 4 + cr() * (CELL - 8);
            g.strokeStyle = 'rgba(88,96,58,' + (0.30 + cr() * 0.25) + ')';
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(px, py + 4);
            g.lineTo(px + (cr() - 0.5) * 4, py - 4);
            g.stroke();
          }
        } else if (t === 4) {
          // 水域（不可通行）：大片深墨蓝，横向波纹
          g.fillStyle = 'rgba(74,96,112,0.40)';
          g.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
          g.strokeStyle = 'rgba(50,72,92,0.45)';
          g.lineWidth = 1.4;
          for (let k = 0; k < 3; k++) {
            const yy = y + CELL * (0.25 + k * 0.25);
            g.beginPath();
            g.moveTo(x + 4, yy);
            g.quadraticCurveTo(cx, yy - 4, x + CELL - 4, yy);
            g.stroke();
          }
        } else if (t === 2) {
          // 山（不可通行，画得醒目些）
          g.fillStyle = 'rgba(72,68,62,0.42)';
          g.beginPath();
          g.moveTo(cx - CELL * 0.46, cy + CELL * 0.32);
          g.lineTo(cx, cy - CELL * 0.38);
          g.lineTo(cx + CELL * 0.46, cy + CELL * 0.32);
          g.closePath();
          g.fill();
          g.strokeStyle = 'rgba(40,38,34,0.55)';
          g.lineWidth = 1.5;
          g.stroke();
          // 山脊线
          g.strokeStyle = 'rgba(40,38,34,0.30)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(cx - CELL * 0.16, cy + CELL * 0.08);
          g.lineTo(cx, cy - CELL * 0.38);
          g.stroke();
        }
      }
    }
  }

  /* ================= 建筑绘制 ================= */

  /** 飞檐屋顶（原点在屋脊底边中心，向上） */
  function drawRoof(c, w) {
    const h = w * 0.3;
    c.beginPath();
    c.moveTo(-w / 2, 0);
    c.quadraticCurveTo(-w * 0.4, -h * 0.6, 0, -h);
    c.quadraticCurveTo(w * 0.4, -h * 0.6, w / 2, 0);
    c.quadraticCurveTo(0, -h * 0.32, -w / 2, 0);
    c.stroke();
    c.beginPath();
    c.moveTo(-w * 0.15, -h * 0.66);
    c.lineTo(w * 0.15, -h * 0.66);
    c.stroke();
  }

  function drawFactoryBuilding(c, f, t) {
    const lvl = f.level;
    // 石台基座
    c.fillStyle = 'rgba(42,38,32,0.07)';
    c.beginPath();
    c.ellipse(0, 34, 66, 16, 0, 0, TAU);
    c.fill();

    // 围墙（双线）
    c.strokeStyle = INK;
    c.lineWidth = 3;
    c.strokeRect(-46, -14, 92, 48);
    c.lineWidth = 1;
    c.strokeStyle = hexAlpha(INK, 0.45);
    c.strokeRect(-40, -8, 80, 36);

    // 门楼
    c.strokeStyle = INK;
    c.lineWidth = 2.4;
    c.beginPath();
    c.moveTo(-13, 34);
    c.lineTo(-13, 8);
    c.quadraticCurveTo(0, -4, 13, 8);
    c.lineTo(13, 34);
    c.stroke();

    // 后方主塔：lvl 层飞檐
    c.save();
    c.translate(0, -14);
    c.strokeStyle = INK;
    for (let i = 0; i < lvl; i++) {
      c.lineWidth = 2.6 - i * 0.3;
      c.beginPath();
      c.rect(-20 + i * 2, -14, 40 - i * 4, 14);
      c.stroke();
      c.translate(0, -14);
      drawRoof(c, 58 - i * 8);
      c.translate(0, -drawRoofH(58 - i * 8));
    }
    // 塔顶旗杆 + 帅旗
    const ownerColor = f.owner >= 0 ? playerColor(f.owner) : null;
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, -26);
    c.stroke();
    if (ownerColor) {
      c.fillStyle = ownerColor;
      c.beginPath();
      c.moveTo(0, -26);
      c.lineTo(20, -21);
      c.lineTo(0, -14);
      c.closePath();
      c.fill();
      c.fillStyle = '#f6efdd';
      c.font = '700 9px ' + CALLOUT_FONT;
      c.textAlign = 'center';
      c.fillText(LEVEL_CHAR[lvl], 8, -18);
    } else {
      // 中立：灰白旗
      c.strokeStyle = hexAlpha(INK, 0.6);
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(0, -26);
      c.lineTo(16, -22);
      c.lineTo(0, -15);
      c.closePath();
      c.stroke();
    }
    c.restore();

    // 烟囱 + 炊烟（产兵中）
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.strokeRect(-38, -30, 10, 16);
    if (f.owner >= 0 && f.prodProg > 0.05) {
      const ph = (t / 900) % 1;
      c.fillStyle = hexAlpha(INK, 0.18 * (1 - ph));
      c.beginPath();
      c.arc(-33 + Math.sin(t / 300) * 3, -36 - ph * 16, 3 + ph * 3.5, 0, TAU);
      c.fill();
    }
  }

  function drawRoofH(w) {
    return w * 0.3;
  }

  function factoryRadius() {
    return (meta && meta.consts && meta.consts.factoryR) || 58;
  }

  function drawFactory(f, t) {
    const c = ctx;
    c.save();
    c.translate(f.x, f.y);

    // 占领圈
    const cr = (meta && meta.consts && meta.consts.captureR) || 118;
    c.strokeStyle = hexAlpha(INK, 0.18);
    c.lineWidth = 1.6;
    c.setLineDash([7, 7]);
    c.beginPath();
    c.arc(0, 0, cr, 0, TAU);
    c.stroke();
    c.setLineDash([]);

    // 占领进度弧
    if (f.capProg > 0 && f.capBy >= 0) {
      const col = playerColor(f.capBy);
      c.strokeStyle = f.contested && Math.floor(t / 150) % 2 === 0
        ? hexAlpha(col, 0.35)
        : col;
      c.lineWidth = 4.5;
      c.beginPath();
      c.arc(0, 0, cr, -Math.PI / 2, -Math.PI / 2 + (f.capProg / 100) * TAU);
      c.stroke();
    }

    drawFactoryBuilding(c, f, t);

    // 产能条
    if (f.owner >= 0) {
      const bw = 56;
      c.fillStyle = hexAlpha(INK, 0.25);
      c.fillRect(-bw / 2, 44, bw, 3.5);
      c.fillStyle = playerColor(f.owner);
      c.fillRect(-bw / 2, 44, bw * clamp(f.prodProg, 0, 1), 3.5);
    }

    // 选中高亮（选中后右键可设集结点）
    if (f.id === selFacId) {
      const pulse = 1 + Math.sin(t / 320) * 0.06;
      c.strokeStyle = hexAlpha(playerColor(f.owner), 0.9);
      c.lineWidth = 3 / zoom;
      c.setLineDash([9, 6]);
      c.lineDashOffset = -(t / 50) % 15;
      c.beginPath();
      c.arc(0, 0, (factoryRadius() + 14) * pulse, 0, TAU);
      c.stroke();
      c.setLineDash([]);
      c.lineDashOffset = 0;
    }

    // 等级印
    c.fillStyle = f.owner >= 0 ? hexAlpha(playerColor(f.owner), 0.92) : hexAlpha(INK, 0.55);
    c.beginPath();
    c.rect(-10, 52, 20, 20);
    c.fill();
    c.fillStyle = '#f6efdd';
    c.font = '700 13px ' + CALLOUT_FONT;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(LEVEL_CHAR[f.level], 0, 63);

    // 生产兵种印：本厂只产这一种，开局固定
    const cn = UNIT_CN[f.pt] || '';
    if (cn) {
      const col = f.owner >= 0 ? playerColor(f.owner) : INK;
      c.fillStyle = hexAlpha(col, 0.3);
      c.beginPath();
      c.rect(14, 52, 20, 20);
      c.fill();
      c.strokeStyle = hexAlpha(col, 0.85);
      c.lineWidth = 1.2 / zoom;
      c.stroke();
      c.fillStyle = hexAlpha(INK, 0.9);
      c.font = '700 12px ' + CALLOUT_FONT;
      c.fillText(cn.charAt(0), 24, 63);
    }

    // 工厂血条：工厂可被攻击，血打光即由「最后一击者」接管；中立厂只有 1/3 血
    if (f.hp != null && f.hpMax > 0) {
      const ratio = clamp(f.hp / f.hpMax, 0, 1);
      const hw = 76;
      const hy = 76;
      c.fillStyle = 'rgba(38,34,28,0.30)';
      c.fillRect(-hw / 2, hy, hw, 6);
      c.fillStyle =
        ratio > 0.5
          ? hexAlpha('#4d6b3c', 0.9)
          : ratio > 0.22
          ? hexAlpha('#b8862c', 0.92)
          : hexAlpha('#a63a2e', 0.95);
      c.fillRect(-hw / 2, hy, hw * ratio, 6);
      c.strokeStyle = hexAlpha(INK, 0.55);
      c.lineWidth = 1;
      c.strokeRect(-hw / 2, hy, hw, 6);
      if (ratio < 0.999) {
        c.fillStyle = hexAlpha(INK, 0.8);
        c.font = '600 11px ' + CALLOUT_FONT;
        c.textAlign = 'center';
        c.textBaseline = 'top';
        c.fillText(Math.round(f.hp) + ' / ' + Math.round(f.hpMax), 0, hy + 9);
      }
    }
    c.textBaseline = 'alphabetic';
    c.restore();
  }

  /** 工厂 → 集结点：虚线牵引 + 旗标；选中的工厂加粗高亮 */
  function drawRallies(t) {
    if (!rallyById.size) return;
    const c = ctx;
    for (const f of factoriesView) {
      const r = rallyById.get(f.id);
      if (!r) continue;
      const col = f.owner >= 0 ? playerColor(f.owner) : INK;
      const sel = f.id === selFacId;
      c.save();
      c.strokeStyle = hexAlpha(col, sel ? 0.85 : 0.45);
      c.lineWidth = (sel ? 2.6 : 1.6) / zoom;
      c.setLineDash([10, 8]);
      c.lineDashOffset = sel ? -(t / 45) % 18 : 0; // 选中时流动，指示行进方向
      c.beginPath();
      c.moveTo(f.x, f.y);
      c.lineTo(r.x, r.y);
      c.stroke();
      c.setLineDash([]);
      c.lineDashOffset = 0;

      // 集结点旗标：杆 + 三角旗 + 落点圈
      const pulse = 1 + Math.sin(t / 380) * 0.1;
      c.strokeStyle = hexAlpha(col, 0.9);
      c.lineWidth = 2 / zoom;
      c.beginPath();
      c.moveTo(r.x, r.y);
      c.lineTo(r.x, r.y - 30);
      c.stroke();
      c.fillStyle = hexAlpha(col, 0.9);
      c.beginPath();
      c.moveTo(r.x, r.y - 30);
      c.lineTo(r.x + 18, r.y - 23);
      c.lineTo(r.x, r.y - 16);
      c.closePath();
      c.fill();
      c.strokeStyle = hexAlpha(col, sel ? 0.8 : 0.5);
      c.lineWidth = (sel ? 2.2 : 1.4) / zoom;
      c.beginPath();
      c.arc(r.x, r.y, 13 * pulse, 0, TAU);
      c.stroke();
      c.beginPath();
      c.moveTo(r.x - 5, r.y);
      c.lineTo(r.x + 5, r.y);
      c.moveTo(r.x, r.y - 5);
      c.lineTo(r.x, r.y + 5);
      c.stroke();

      // 旗上标注工厂编号，便于分辨是哪个厂的集结地
      c.fillStyle = hexAlpha(INK, 0.75);
      c.font = '600 11px ' + CALLOUT_FONT;
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText('集' + f.id, r.x + 22, r.y - 23);
      c.textBaseline = 'alphabetic';
      c.restore();
    }
  }

  function drawLab(l, t) {
    const c = ctx;
    c.save();
    c.translate(l.x, l.y);
    const owned = l.owner >= 0;
    const col = owned ? playerColor(l.owner) : hexAlpha(INK, 0.7);

    // 六边形亭身
    c.strokeStyle = owned ? col : INK;
    c.lineWidth = 2.6;
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (TAU / 6) * i - Math.PI / 6;
      const px = Math.cos(a) * 30;
      const py = Math.sin(a) * 30;
      i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
    }
    c.closePath();
    c.stroke();

    // 内环 + 核心（归属后呼吸）
    const breath = owned ? 1 + Math.sin(t / 400) * 0.12 : 1;
    c.strokeStyle = hexAlpha(owned ? col : INK, 0.55);
    c.lineWidth = 1.4;
    c.beginPath();
    c.arc(0, 0, 15 * breath, 0, TAU);
    c.stroke();
    c.fillStyle = owned ? hexAlpha(col, 0.75) : hexAlpha(INK, 0.4);
    c.beginPath();
    c.arc(0, 0, 6.5, 0, TAU);
    c.fill();

    // 天线
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -30);
    c.lineTo(0, -44);
    c.stroke();
    c.beginPath();
    c.arc(0, -47, 3, 0, TAU);
    c.stroke();

    // 归属印
    if (owned) {
      c.fillStyle = hexAlpha(col, 0.9);
      c.beginPath();
      c.rect(22, -40, 16, 16);
      c.fill();
      c.fillStyle = '#f6efdd';
      c.font = '700 11px ' + CALLOUT_FONT;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('研', 30, -31);
      c.textBaseline = 'alphabetic';
    }

    c.fillStyle = hexAlpha(INK, 0.6);
    c.font = '12px ' + CALLOUT_FONT;
    c.textAlign = 'center';
    c.fillText('研 究 所', 0, 50);
    // 研究所血条：和工厂一样可被攻击，打光即由最后一击者接管
    drawBuildingHpBar(c, 0, 58, l.hp, l.hpMax, 64);
    c.restore();
  }

  /** 建筑通用血条（世界坐标，以 (x,y) 为左上角基准） */
  function drawBuildingHpBar(c, x, y, hp, hpMax, w) {
    if (hp == null || !(hpMax > 0)) return;
    const ratio = clamp(hp / hpMax, 0, 1);
    c.fillStyle = 'rgba(38,34,28,0.30)';
    c.fillRect(x - w / 2, y, w, 6);
    c.fillStyle =
      ratio > 0.5
        ? hexAlpha('#4d6b3c', 0.9)
        : ratio > 0.22
          ? hexAlpha('#b8862c', 0.92)
          : hexAlpha('#a63a2e', 0.95);
    c.fillRect(x - w / 2, y, w * ratio, 6);
    c.strokeStyle = hexAlpha(INK, 0.55);
    c.lineWidth = 1;
    c.strokeRect(x - w / 2, y, w, 6);
    if (ratio < 0.999) {
      c.fillStyle = hexAlpha(INK, 0.8);
      c.font = '600 11px ' + CALLOUT_FONT;
      c.textAlign = 'center';
      c.textBaseline = 'top';
      c.fillText(Math.round(hp) + ' / ' + Math.round(hpMax), x, y + 9);
      c.textBaseline = 'alphabetic';
    }
  }

  /* ================= 总部绘制 ================= */

  function drawHq(h) {
    const c = ctx;
    c.save();
    c.translate(h.x, h.y);
    const col = playerColor(h.owner);
    const down = h.down;

    // 台基
    c.fillStyle = hexAlpha(INK, 0.10);
    c.beginPath();
    c.ellipse(0, 18, 60, 20, 0, 0, TAU);
    c.fill();

    // 双层城楼
    c.strokeStyle = down ? hexAlpha(INK, 0.35) : hexAlpha(col, 0.9);
    c.lineWidth = 2.8;
    c.beginPath();
    c.moveTo(-46, 20);
    c.lineTo(-46, -14);
    c.lineTo(46, -14);
    c.lineTo(46, 20);
    c.closePath();
    c.stroke();
    c.beginPath();
    c.moveTo(-30, -14);
    c.lineTo(-30, -40);
    c.lineTo(30, -40);
    c.lineTo(30, -14);
    c.closePath();
    c.stroke();

    // 檐（飞檐两条弧）
    c.lineWidth = 2.4;
    c.beginPath();
    c.moveTo(-58, -14);
    c.quadraticCurveTo(0, -30, 58, -14);
    c.stroke();
    c.beginPath();
    c.moveTo(-40, -40);
    c.quadraticCurveTo(0, -52, 40, -40);
    c.stroke();

    // 主旗
    c.strokeStyle = hexAlpha(col, 0.95);
    c.lineWidth = 2.4;
    c.beginPath();
    c.moveTo(0, -40);
    c.lineTo(0, -74);
    c.stroke();
    if (down) {
      c.strokeStyle = hexAlpha(INK, 0.4);
      c.beginPath();
      c.moveTo(0, -74);
      c.lineTo(14, -66);
      c.lineTo(0, -58);
      c.stroke();
    } else {
      const flap = Math.sin(Date.now() / 420) * 4;
      c.fillStyle = hexAlpha(col, 0.9);
      c.beginPath();
      c.moveTo(0, -74);
      c.lineTo(24, -68 + flap);
      c.lineTo(0, -58);
      c.closePath();
      c.fill();
    }

    // 中央印
    c.fillStyle = down ? hexAlpha(INK, 0.35) : hexAlpha(col, 0.85);
    c.beginPath();
    c.arc(0, 2, 11, 0, TAU);
    c.fill();
    c.fillStyle = '#f6efdd';
    c.font = '700 13px ' + CALLOUT_FONT;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('帅', 0, 3);
    c.textBaseline = 'alphabetic';

    // 名称 + 血条
    c.fillStyle = down ? hexAlpha(INK, 0.45) : hexAlpha(INK, 0.75);
    c.font = '12px ' + CALLOUT_FONT;
    c.textAlign = 'center';
    c.fillText(down ? '总部（陷落）' : '总 部', 0, 92);
    if (!down) drawBuildingHpBar(c, 0, 100, h.hp, h.hpMax, 84);
    c.restore();
  }

  /* ================= 单位绘制（玩家手绘模型 · 水墨化） ================= */

  function drawHexagon(c, x, y, r) {
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
    }
    c.closePath();
    c.stroke();
  }

  function drawWarrior(c, tier, branch) {
    const line = 2.5 + tier * 0.4;
    c.strokeStyle = INK;
    c.lineWidth = line;
    const acc = TYPE_ACCENT.warrior;

    if (tier === 1) {
      c.beginPath();
      c.moveTo(-10, 0); c.lineTo(8, -8); c.lineTo(14, 0); c.lineTo(8, 8);
      c.closePath(); c.stroke();
      c.fillStyle = acc;
      c.beginPath(); c.arc(2, 0, 3, 0, TAU); c.fill();
    }
    if (tier === 2 && branch === 'A') {
      c.beginPath();
      c.moveTo(-12, 0); c.lineTo(10, -10); c.lineTo(18, 0); c.lineTo(10, 10);
      c.closePath(); c.stroke();
      c.beginPath();
      c.moveTo(-8, -10); c.lineTo(-2, -6);
      c.moveTo(-8, 10); c.lineTo(-2, 6);
      c.stroke();
      c.fillStyle = acc;
      c.beginPath(); c.arc(2, 0, 3.5, 0, TAU); c.fill();
    }
    if (tier === 2 && branch === 'B') {
      c.beginPath();
      c.moveTo(-10, 0); c.lineTo(12, -6); c.lineTo(16, 0); c.lineTo(12, 6);
      c.closePath(); c.stroke();
      c.beginPath();
      c.moveTo(-14, 0); c.lineTo(-22, -3);
      c.moveTo(-14, 0); c.lineTo(-22, 3);
      c.stroke();
      c.fillStyle = acc;
      c.beginPath(); c.arc(2, 0, 3, 0, TAU); c.fill();
    }
    if (tier === 3 && branch === 'A') {
      c.beginPath();
      c.moveTo(-14, 0); c.lineTo(12, -12); c.lineTo(22, 0); c.lineTo(12, 12);
      c.closePath(); c.stroke();
      c.fillStyle = '#6e2420';
      c.fillRect(-4, -4, 8, 8);
      c.beginPath();
      c.moveTo(-10, -12); c.lineTo(-4, -8);
      c.moveTo(-10, 12); c.lineTo(-4, 8);
      c.stroke();
      c.beginPath();
      c.moveTo(10, 0); c.lineTo(26, 0);
      c.stroke();
    }
    if (tier === 3 && branch === 'B') {
      c.beginPath();
      c.moveTo(-10, 0); c.lineTo(14, -5); c.lineTo(18, 0); c.lineTo(14, 5);
      c.closePath(); c.stroke();
      c.beginPath();
      c.moveTo(-14, -8); c.lineTo(4, -14); c.lineTo(8, -8); c.closePath(); c.stroke();
      c.beginPath();
      c.moveTo(-14, 8); c.lineTo(4, 14); c.lineTo(8, 8); c.closePath(); c.stroke();
      c.beginPath(); c.arc(-14, 0, 6, 0, TAU); c.stroke();
      c.beginPath(); c.arc(-20, 0, 3, 0, TAU); c.stroke();
      c.fillStyle = acc;
      c.beginPath(); c.arc(2, 0, 3.5, 0, TAU); c.fill();
    }
  }

  function drawShield(c, tier, branch) {
    const line = 4 + tier * 0.4;
    c.strokeStyle = '#33465c';
    c.lineWidth = line;
    const acc = TYPE_ACCENT.shield;

    if (tier === 1) {
      drawHexagon(c, 0, 0, 16);
      drawHexagon(c, 0, 0, 24);
      c.fillStyle = acc;
      c.beginPath(); c.arc(6, 0, 4, 0, TAU); c.fill();
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(8, 0); c.lineTo(20, 0); c.stroke();
    }
    if (tier === 2 && branch === 'A') {
      drawHexagon(c, 0, 0, 20);
      drawHexagon(c, 0, 0, 28);
      c.strokeStyle = INK;
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(10, 0); c.lineTo(24, 0); c.stroke();
      c.fillStyle = acc;
      c.beginPath(); c.arc(6, 0, 4.5, 0, TAU); c.fill();
    }
    if (tier === 2 && branch === 'B') {
      drawHexagon(c, 0, 0, 14);
      drawHexagon(c, 0, 0, 22);
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(8, -3); c.lineTo(22, -3);
      c.moveTo(8, 3); c.lineTo(22, 3);
      c.stroke();
      c.fillStyle = acc;
      c.beginPath(); c.arc(6, 0, 4, 0, TAU); c.fill();
    }
    if (tier === 3 && branch === 'A') {
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i;
        const px = Math.cos(a) * 22;
        const py = Math.sin(a) * 22;
        i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
      }
      c.closePath(); c.stroke();
      drawHexagon(c, 0, 0, 30);
      c.strokeStyle = INK;
      c.lineWidth = 4;
      c.beginPath(); c.moveTo(12, 0); c.lineTo(28, 0); c.stroke();
      c.fillStyle = acc;
      c.beginPath(); c.arc(6, 0, 5, 0, TAU); c.fill();
    }
    if (tier === 3 && branch === 'B') {
      drawHexagon(c, 0, 0, 16);
      drawHexagon(c, 0, 0, 24);
      c.fillStyle = '#2f4d6b';
      c.beginPath();
      c.moveTo(4, -4); c.lineTo(8, 0); c.lineTo(4, 4); c.lineTo(0, 0);
      c.closePath(); c.fill();
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(8, 0); c.lineTo(28, 0); c.stroke();
      c.beginPath(); c.arc(6, 0, 7, 0, TAU); c.stroke();
      c.beginPath();
      c.moveTo(8, -5); c.lineTo(24, -5);
      c.moveTo(8, 5); c.lineTo(24, 5);
      c.stroke();
    }
  }

  function drawRanger(c, tier, branch) {
    const line = 2 + tier * 0.4;
    c.strokeStyle = INK;
    c.lineWidth = line;

    if (tier === 1) {
      c.beginPath();
      c.moveTo(-12, 0); c.lineTo(6, -7); c.lineTo(22, 0); c.lineTo(6, 7);
      c.closePath(); c.stroke();
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(6, 0); c.lineTo(24, 0); c.stroke();
    }
    if (tier === 2 && branch === 'A') {
      c.beginPath();
      c.moveTo(-14, 0); c.lineTo(4, -8); c.lineTo(24, 0); c.lineTo(4, 8);
      c.closePath(); c.stroke();
      c.lineWidth = 4;
      c.beginPath(); c.moveTo(8, 0); c.lineTo(28, 0); c.stroke();
      c.fillStyle = '#4a453c';
      c.beginPath(); c.arc(4, 0, 4, 0, TAU); c.fill();
    }
    if (tier === 2 && branch === 'B') {
      c.beginPath();
      c.moveTo(-12, 0); c.lineTo(6, -6); c.lineTo(20, 0); c.lineTo(6, 6);
      c.closePath(); c.stroke();
      c.beginPath();
      c.moveTo(-4, -6); c.lineTo(2, -10);
      c.moveTo(-4, 6); c.lineTo(2, 10);
      c.stroke();
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(6, 0); c.lineTo(24, 0); c.stroke();
    }
    if (tier === 3 && branch === 'A') {
      c.beginPath();
      c.moveTo(-16, 0); c.lineTo(2, -10); c.lineTo(26, 0); c.lineTo(2, 10);
      c.closePath(); c.stroke();
      c.lineWidth = 5;
      c.beginPath(); c.moveTo(10, 0); c.lineTo(34, 0); c.stroke();
      c.beginPath(); c.arc(4, 0, 6, 0, TAU); c.stroke();
      c.beginPath();
      c.moveTo(22, -4); c.lineTo(30, -6); c.lineTo(30, 6); c.lineTo(22, 4);
      c.closePath(); c.stroke();
    }
    if (tier === 3 && branch === 'B') {
      c.beginPath();
      c.moveTo(-14, 0); c.lineTo(4, -7); c.lineTo(20, 0); c.lineTo(4, 7);
      c.closePath(); c.stroke();
      c.beginPath();
      c.moveTo(-8, -8); c.lineTo(0, -12); c.lineTo(4, -7); c.stroke();
      c.beginPath();
      c.moveTo(-8, 8); c.lineTo(0, 12); c.lineTo(4, 7); c.stroke();
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(8, 0); c.lineTo(32, 0); c.stroke();
      c.fillStyle = INK;
      c.beginPath();
      c.moveTo(4, -3); c.lineTo(8, 0); c.lineTo(4, 3);
      c.closePath(); c.fill();
    }
  }

  function drawBurst(c, tier, branch) {
    const line = 3 + tier * 0.4;
    c.strokeStyle = '#4a2c22';
    c.lineWidth = line;
    const acc = TYPE_ACCENT.burst;

    if (tier === 1) {
      c.beginPath(); c.arc(0, 0, 12, 0, TAU); c.stroke();
      c.beginPath();
      c.moveTo(8, -4); c.lineTo(22, -4);
      c.moveTo(8, 4); c.lineTo(22, 4);
      c.stroke();
      c.fillStyle = acc;
      c.beginPath(); c.arc(0, 0, 4, 0, TAU); c.fill();
    }
    if (tier === 2 && branch === 'A') {
      c.beginPath(); c.arc(0, 0, 14, 0, TAU); c.stroke();
      c.beginPath();
      c.moveTo(10, -5); c.lineTo(26, -5);
      c.moveTo(10, 5); c.lineTo(26, 5);
      c.stroke();
      c.fillStyle = acc;
      c.beginPath(); c.arc(0, 0, 4.5, 0, TAU); c.fill();
    }
    if (tier === 2 && branch === 'B') {
      c.beginPath(); c.arc(0, 0, 12, 0, TAU); c.stroke();
      c.beginPath();
      c.moveTo(8, -4); c.lineTo(24, -4);
      c.moveTo(8, 0); c.lineTo(24, 0);
      c.moveTo(8, 4); c.lineTo(24, 4);
      c.stroke();
      c.fillStyle = acc;
      c.beginPath(); c.arc(0, 0, 4, 0, TAU); c.fill();
    }
    if (tier === 3 && branch === 'A') {
      c.beginPath(); c.arc(0, 0, 16, 0, TAU); c.stroke();
      c.beginPath(); c.arc(0, 0, 22, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(12, 0); c.lineTo(30, 0); c.stroke();
      c.fillStyle = acc;
      c.beginPath(); c.arc(0, 0, 5, 0, TAU); c.fill();
      c.beginPath();
      c.moveTo(10, 0); c.lineTo(22, -4);
      c.moveTo(10, 0); c.lineTo(22, 4);
      c.stroke();
    }
    if (tier === 3 && branch === 'B') {
      c.beginPath(); c.arc(0, 0, 14, 0, TAU); c.stroke();
      c.beginPath();
      c.moveTo(8, -5); c.lineTo(24, -5);
      c.moveTo(8, -1); c.lineTo(24, -1);
      c.moveTo(8, 1); c.lineTo(24, 1);
      c.moveTo(8, 5); c.lineTo(24, 5);
      c.stroke();
      c.beginPath(); c.moveTo(10, 0); c.lineTo(28, 0); c.stroke();
      c.fillStyle = INK;
      c.beginPath();
      c.moveTo(4, -3); c.lineTo(10, 0); c.lineTo(4, 3);
      c.closePath(); c.fill();
      c.fillStyle = acc;
      c.beginPath(); c.arc(0, 0, 4, 0, TAU); c.fill();
    }
  }

  function drawBurn(c, tier, branch) {
    const line = 3 + tier * 0.4;
    c.strokeStyle = '#452a22';
    c.lineWidth = line;

    if (tier === 1) {
      c.beginPath();
      c.moveTo(-10, -6); c.lineTo(-4, 0); c.lineTo(-10, 6);
      c.closePath(); c.stroke();
      c.fillStyle = TYPE_ACCENT.burn;
      c.beginPath();
      c.moveTo(-4, -3); c.lineTo(14, 0); c.lineTo(-4, 3);
      c.closePath(); c.fill();
    }
    if (tier === 2 && branch === 'A') {
      c.beginPath();
      c.moveTo(-12, -8); c.lineTo(-4, 0); c.lineTo(-12, 8);
      c.closePath(); c.stroke();
      c.fillStyle = TYPE_ACCENT.burn;
      c.beginPath();
      c.moveTo(-4, -4); c.lineTo(18, 0); c.lineTo(-4, 4);
      c.closePath(); c.fill();
      c.fillStyle = '#c07a2c';
      c.beginPath(); c.arc(-2, 0, 3, 0, TAU); c.fill();
    }
    if (tier === 2 && branch === 'B') {
      c.beginPath();
      c.moveTo(-10, -6); c.lineTo(-4, 0); c.lineTo(-10, 6);
      c.closePath(); c.stroke();
      c.beginPath();
      c.moveTo(-4, -2); c.lineTo(16, -2);
      c.moveTo(-4, 2); c.lineTo(16, 2);
      c.stroke();
      c.beginPath(); c.arc(18, 0, 3, 0, TAU); c.stroke();
      c.fillStyle = '#6b6f2a';
      c.beginPath(); c.arc(-2, 0, 3, 0, TAU); c.fill();
    }
    if (tier === 3 && branch === 'A') {
      c.beginPath();
      c.moveTo(-12, -8); c.lineTo(-4, 0); c.lineTo(-12, 8);
      c.closePath(); c.stroke();
      c.fillStyle = TYPE_ACCENT.burn;
      c.beginPath();
      c.moveTo(-4, -4); c.lineTo(20, 0); c.lineTo(-4, 4);
      c.closePath(); c.fill();
      c.fillStyle = '#c07a2c';
      c.beginPath();
      c.moveTo(-4, -3); c.lineTo(14, 0); c.lineTo(-4, 3);
      c.closePath(); c.fill();
      c.beginPath(); c.arc(-2, 0, 7, 0, TAU); c.stroke();
      c.save();
      c.translate(8, 0);
      c.rotate(Math.PI / 6);
      c.fillStyle = TYPE_ACCENT.burn;
      c.beginPath();
      c.moveTo(-4, -3); c.lineTo(14, 0); c.lineTo(-4, 3);
      c.closePath(); c.fill();
      c.restore();
    }
    if (tier === 3 && branch === 'B') {
      c.beginPath();
      c.moveTo(-12, -8); c.lineTo(-4, 0); c.lineTo(-12, 8);
      c.closePath(); c.stroke();
      c.beginPath();
      c.moveTo(-4, -3); c.lineTo(18, -3);
      c.moveTo(-4, 3); c.lineTo(18, 3);
      c.stroke();
      c.fillStyle = '#6b6f2a';
      c.beginPath(); c.arc(-2, 0, 4, 0, TAU); c.fill();
      c.beginPath();
      c.arc(20, -4, 2, 0, TAU);
      c.arc(22, 4, 2, 0, TAU);
      c.stroke();
      c.beginPath();
      c.moveTo(-4, -2); c.lineTo(20, -2);
      c.moveTo(-4, 2); c.lineTo(20, 2);
      c.stroke();
      c.beginPath(); c.arc(22, 0, 4, 0, TAU); c.stroke();
      c.beginPath(); c.arc(26, 0, 2, 0, TAU); c.stroke();
    }
  }

  /** 激光兵：长镜筒 + 聚光镜组（青色为光学部件）。阶数越高镜筒越长、镜环越多。 */
  function drawLaser(c, tier, branch) {
    const acc = TYPE_ACCENT.laser;
    const line = 2 + tier * 0.4;
    c.strokeStyle = INK;
    c.lineWidth = line;

    // 机座（守势分支更厚重）
    const bulk = branch === 'B' ? 8 : 6;
    c.beginPath();
    c.moveTo(-11, -bulk);
    c.lineTo(1, -bulk * 0.55);
    c.lineTo(1, bulk * 0.55);
    c.lineTo(-11, bulk);
    c.closePath();
    c.stroke();

    // 镜筒：越高级越长
    const barrel = 16 + (tier - 1) * 6;
    c.lineWidth = line + (branch === 'B' ? 2 : 1);
    c.beginPath();
    c.moveTo(1, 0);
    c.lineTo(barrel, 0);
    c.stroke();

    // 镜环：数量 = 阶数
    for (let k = 1; k < tier; k++) {
      c.lineWidth = line;
      c.beginPath();
      c.arc(1 + (barrel - 1) * (k / tier), 0, 2.4, 0, TAU);
      c.stroke();
    }
    // 聚光镜
    c.fillStyle = acc;
    c.beginPath();
    c.arc(barrel, 0, 2.6 + tier * 0.5, 0, TAU);
    c.fill();

    // 高阶：攻势加副管，守势加散热鳍
    if (tier >= 3 && branch === 'A') {
      c.lineWidth = line;
      c.beginPath();
      c.moveTo(1, -5);
      c.lineTo(barrel - 4, -5);
      c.stroke();
      c.fillStyle = acc;
      c.beginPath();
      c.arc(barrel - 4, -5, 2.4, 0, TAU);
      c.fill();
    }
    if (tier >= 2 && branch === 'B') {
      c.lineWidth = line * 0.8;
      for (let k = 0; k < 3; k++) {
        const x = 4 + k * 5;
        c.beginPath();
        c.moveTo(x, -bulk * 0.5);
        c.lineTo(x, -bulk * 0.5 - 6);
        c.stroke();
      }
    }
  }

  function drawUnitBody(type, tier, branch) {
    if (type === 'warrior') drawWarrior(ctx, tier, branch);
    else if (type === 'shield') drawShield(ctx, tier, branch);
    else if (type === 'ranger') drawRanger(ctx, tier, branch);
    else if (type === 'burst') drawBurst(ctx, tier, branch);
    else if (type === 'burn') drawBurn(ctx, tier, branch);
    else if (type === 'laser') drawLaser(ctx, tier, branch);
  }

  /* ================= 场景绘制 ================= */

  function playerColor(idx) {
    const p = meta && meta.players && meta.players[idx];
    return (p && p.color) || INK;
  }

  function drawUnits(t) {
    const c = ctx;
    const myIdx = myPlayerIndex();
    for (const u of units.values()) {
      const col = playerColor(u.oi);
      // 归属墨圈
      c.fillStyle = hexAlpha(col, 0.28);
      c.beginPath();
      c.ellipse(u.x, u.y + 11, 15, 5.5, 0, 0, TAU);
      c.fill();

      // 选中虚线圈
      if (selection.has(u.id)) {
        c.strokeStyle = hexAlpha(col, 0.95);
        c.lineWidth = 1.8;
        c.setLineDash([5, 4]);
        c.beginPath();
        c.arc(u.x, u.y, 22, t / 600, t / 600 + TAU);
        c.stroke();
        c.setLineDash([]);
      }

      // 本体
      c.save();
      c.translate(u.x, u.y);
      c.rotate(u.ang);
      drawUnitBody(u.type, u.tier, u.branch);
      c.restore();

      // 灼烧火苗
      if (u.burning) {
        const fl = Math.sin(t / 70 + u.id) * 2;
        c.fillStyle = hexAlpha('#c0492c', 0.75);
        c.beginPath();
        c.moveTo(u.x - 3, u.y - 18);
        c.quadraticCurveTo(u.x - 2 + fl, u.y - 27, u.x, u.y - 30 - fl);
        c.quadraticCurveTo(u.x + 2 + fl, u.y - 25, u.x + 3, u.y - 18);
        c.closePath();
        c.fill();
      }

      // 血条（受损或选中时显示）
      const st = unitStatsOf(u.type, u.tier, u.branch);
      const maxHp = Math.max(st.hp, u.hp);
      if (u.hp < maxHp || selection.has(u.id)) {
        const bw = 26;
        c.fillStyle = hexAlpha(INK, 0.35);
        c.fillRect(u.x - bw / 2, u.y - 26, bw, 3);
        c.fillStyle = col;
        c.fillRect(u.x - bw / 2, u.y - 26, bw * clamp(u.hp / maxHp, 0, 1), 3);
        // 仍可进阶的标记（进化改由科技点驱动，单位本身不再有经验）
        if (u.tier < u.maxTier) {
          c.strokeStyle = hexAlpha(INK, 0.35);
          c.lineWidth = 1;
          c.strokeRect(u.x - bw / 2, u.y - 22, bw, 2);
        }
      }

      // 激光兵：锁定倍率读数（超过 1 倍才显示，颜色随倍率升温）
      if (u.type === 'laser' && u.lk && !u.lw && (u.lm || 100) > 105) {
        const mul = (u.lm || 100) / 100;
        const heat = clamp((mul - 1) / 4, 0, 1);
        c.save();
        c.fillStyle = heat > 0.7 ? hexAlpha('#c0492c', 0.95) : hexAlpha(INK, 0.7);
        c.font = '700 11px ' + CALLOUT_FONT;
        c.textAlign = 'center';
        c.fillText('×' + mul.toFixed(1), u.x, u.y - 30);
        c.restore();
      }
      void myIdx;
    }
  }

  /** 解析激光兵锁定目标的世界坐标：服务端只下发「类别 + id」，坐标从本地视图取 */
  function lockTargetPos(u) {
    if (u.lk === 1) {
      const t = units.get(u.li);
      return t ? { x: t.x, y: t.y } : null;
    }
    if (u.lk === 2) {
      const f = factoriesView.find((x) => x.id === u.li);
      return f ? { x: f.x, y: f.y } : null;
    }
    if (u.lk === 3) {
      const l = labsView.find((x) => x.id === u.li);
      return l ? { x: l.x, y: l.y } : null;
    }
    if (u.lk === 4) {
      const h = hqView.find((x) => x.id === u.li);
      return h ? { x: h.x, y: h.y } : null;
    }
    return null;
  }

  /**
   * 激光兵光束：完全由服务端的「锁定状态」驱动。
   *  - 前摇中（lw > 0）：虚线瞄准 + 枪口蓄能光点 + 目标处收拢的锁定环（尚不造成伤害）
   *  - 已锁定（lw = 0）：枪口到目标的持续光束，粗细与亮度随倍率（1 → 5 倍）增强
   */
  function drawBeams(t) {
    const c = ctx;
    if (!meta) return;
    const maxMul = (meta.consts && meta.consts.laserMaxMul) || 5;
    const windupMs = (meta.consts && meta.consts.laserWindupMs) || 800;
    for (const u of units.values()) {
      if (u.type !== 'laser' || !u.lk) continue;
      const tp = lockTargetPos(u);
      if (!tp) continue;
      const col = playerColor(u.oi);
      const mul = Math.max(1, (u.lm || 100) / 100);
      const heat = clamp((mul - 1) / Math.max(0.001, maxMul - 1), 0, 1); // 1 倍 → 0，5 倍 → 1
      const mx = u.x + Math.cos(u.ang) * 15;
      const my = u.y + Math.sin(u.ang) * 15;

      if (u.lw > 0) {
        // —— 前摇：蓄能中
        const prog = 1 - clamp(u.lw / windupMs, 0, 1);
        c.save();
        c.strokeStyle = hexAlpha(col, 0.3 + 0.35 * prog);
        c.lineWidth = 1.3;
        c.setLineDash([4, 6]);
        c.beginPath();
        c.moveTo(mx, my);
        c.lineTo(tp.x, tp.y);
        c.stroke();
        c.setLineDash([]);
        // 枪口蓄能光点
        c.fillStyle = hexAlpha('#eaf7ff', 0.45 + 0.5 * prog);
        c.beginPath();
        c.arc(mx, my, 2 + 4.5 * prog, 0, TAU);
        c.fill();
        // 目标处收拢的锁定环
        c.strokeStyle = hexAlpha(TYPE_ACCENT.laser, 0.35 + 0.4 * prog);
        c.lineWidth = 1.6;
        c.beginPath();
        c.arc(tp.x, tp.y, 19 - 9 * prog, 0, TAU);
        c.stroke();
        c.restore();
        continue;
      }

      // —— 已锁定：持续光束（外层光晕 + 内层亮芯）
      const flick = 0.88 + 0.12 * Math.sin(t / 40 + u.id);
      const w = (2.2 + heat * 4.4) * flick;
      c.save();
      c.lineCap = 'round';
      c.strokeStyle = hexAlpha(TYPE_ACCENT.laser, 0.22 + heat * 0.34);
      c.lineWidth = w * 2.6;
      c.beginPath();
      c.moveTo(mx, my);
      c.lineTo(tp.x, tp.y);
      c.stroke();
      c.strokeStyle = hexAlpha('#f4fbff', 0.55 + heat * 0.4);
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(mx, my);
      c.lineTo(tp.x, tp.y);
      c.stroke();
      // 命中点的灼烧光斑
      c.fillStyle = hexAlpha(TYPE_ACCENT.laser, 0.3 + heat * 0.25);
      c.beginPath();
      c.arc(tp.x, tp.y, 9 + heat * 11, 0, TAU);
      c.fill();
      c.fillStyle = hexAlpha('#f4fbff', 0.5 + heat * 0.45);
      c.beginPath();
      c.arc(tp.x, tp.y, 2.6 + heat * 5, 0, TAU);
      c.fill();
      c.restore();
    }
  }

  function drawBullets() {
    const c = ctx;
    if (!lastSnap || !lastSnap.b) return;
    for (const b of lastSnap.b) {
      const x = b[0];
      const y = b[1];
      const oi = b[2];
      const kind = b[3];
      const col = playerColor(oi);
      if (kind === 2) {
        // 炮击弹：大墨点 + 虚线影
        c.fillStyle = hexAlpha(INK, 0.85);
        c.beginPath(); c.arc(x, y, 5, 0, TAU); c.fill();
        c.strokeStyle = hexAlpha(col, 0.4);
        c.lineWidth = 1.4;
        c.setLineDash([3, 4]);
        c.beginPath(); c.arc(x, y, 9, 0, TAU); c.stroke();
        c.setLineDash([]);
      } else if (kind === 3) {
        // 燃烧弹：朱砂火星
        c.fillStyle = hexAlpha('#c0492c', 0.9);
        c.beginPath(); c.arc(x, y, 3.5, 0, TAU); c.fill();
        c.fillStyle = hexAlpha('#e0a03c', 0.5);
        c.beginPath(); c.arc(x, y - 3, 2, 0, TAU); c.fill();
      } else if (kind === 1) {
        // 近战挥击：短墨痕
        c.strokeStyle = hexAlpha(INK, 0.8);
        c.lineWidth = 2.4;
        const dx = b[4] || 1;
        const dy = b[5] || 0;
        c.beginPath();
        c.moveTo(x - dx * 5, y - dy * 5);
        c.lineTo(x + dx * 5, y + dy * 5);
        c.stroke();
      } else {
        // 墨滴
        c.fillStyle = hexAlpha(INK, 0.85);
        c.beginPath(); c.arc(x, y, 3, 0, TAU); c.fill();
        c.fillStyle = hexAlpha(col, 0.35);
        c.beginPath(); c.arc(x, y, 5.5, 0, TAU); c.fill();
      }
    }
  }

  function drawEffects(t) {
    const c = ctx;
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const age = (t - e.born) / e.ttl;
      if (age >= 1) {
        effects.splice(i, 1);
        continue;
      }
      const fade = 1 - age;
      if (e.kind === 'splash') {
        // 阵亡墨溅
        c.fillStyle = hexAlpha(INK, 0.4 * fade);
        for (const d of e.dots) {
          c.beginPath();
          c.arc(e.x + d[0] * age * 1.4, e.y + d[1] * age * 1.4, d[2] * (0.6 + fade * 0.4), 0, TAU);
          c.fill();
        }
      } else if (e.kind === 'evo') {
        // 进化：扩散墨环 + 破茧点
        const col = playerColor(e.oi);
        c.strokeStyle = hexAlpha(col, 0.85 * fade);
        c.lineWidth = 3;
        c.beginPath();
        c.arc(e.x, e.y, 10 + age * 34, 0, TAU);
        c.stroke();
        c.strokeStyle = hexAlpha(INK, 0.5 * fade);
        c.lineWidth = 1.6;
        c.beginPath();
        c.arc(e.x, e.y, 4 + age * 20, 0, TAU);
        c.stroke();
        c.fillStyle = hexAlpha(col, 0.9 * fade);
        c.font = '700 ' + Math.round(14 + age * 8) + 'px ' + CALLOUT_FONT;
        c.textAlign = 'center';
        c.fillText('化', e.x, e.y - 26 - age * 12);
      } else if (e.kind === 'cap') {
        // 占领：帅旗色环 + 「取」
        const col = playerColor(e.oi);
        c.strokeStyle = hexAlpha(col, 0.9 * fade);
        c.lineWidth = 5;
        c.beginPath();
        c.arc(e.x, e.y, 40 + age * 50, 0, TAU);
        c.stroke();
        c.fillStyle = hexAlpha(col, 0.95 * fade);
        c.font = '700 26px ' + CALLOUT_FONT;
        c.textAlign = 'center';
        c.fillText('取', e.x, e.y - 66 - age * 14);
      } else if (e.kind === 'lab') {
        // 研究所易主
        const col = playerColor(e.oi);
        c.strokeStyle = hexAlpha(col, 0.85 * fade);
        c.lineWidth = 4;
        c.beginPath();
        c.arc(e.x, e.y, 34 + age * 46, 0, TAU);
        c.stroke();
        c.fillStyle = hexAlpha(col, 0.9 * fade);
        c.font = '700 22px ' + CALLOUT_FONT;
        c.textAlign = 'center';
        c.fillText('研', e.x, e.y - 58 - age * 12);
      } else if (e.kind === 'hqdown') {
        // 总部陷落：大幅墨爆
        const col = playerColor(e.oi);
        c.strokeStyle = hexAlpha(col, 0.7 * fade);
        c.lineWidth = 6;
        c.beginPath();
        c.arc(e.x, e.y, 50 + age * 120, 0, TAU);
        c.stroke();
        c.fillStyle = hexAlpha(INK, 0.3 * fade);
        c.beginPath();
        c.arc(e.x, e.y, 60 * (0.5 + age), 0, TAU);
        c.fill();
        c.fillStyle = hexAlpha('#8a2f22', 0.9 * fade);
        c.font = '700 30px ' + CALLOUT_FONT;
        c.textAlign = 'center';
        c.fillText('陷', e.x, e.y - 80 - age * 20);
      } else if (e.kind === 'boom') {
        // 落点成墨
        c.fillStyle = hexAlpha(INK, 0.5 * fade);
        c.beginPath();
        c.arc(e.x, e.y, e.r * (0.4 + age * 0.75), 0, TAU);
        c.fill();
        c.strokeStyle = hexAlpha(INK, 0.6 * fade);
        c.lineWidth = 2;
        c.beginPath();
        c.arc(e.x, e.y, e.r * (0.8 + age * 0.6), 0, TAU);
        c.stroke();
      }
    }
    // 右键行军标记
    for (let i = moveMarkers.length - 1; i >= 0; i--) {
      const m = moveMarkers[i];
      const age = (t - m.born) / m.ttl;
      if (age >= 1) {
        moveMarkers.splice(i, 1);
        continue;
      }
      const col = playerColor(myPlayerIndex());
      c.strokeStyle = hexAlpha(col, 0.8 * (1 - age));
      c.lineWidth = 2.4;
      c.beginPath();
      c.arc(m.x, m.y, 16 * (1 - age * 0.5), 0, TAU);
      c.stroke();
      c.beginPath();
      c.moveTo(m.x - 6, m.y);
      c.lineTo(m.x + 6, m.y);
      c.moveTo(m.x, m.y - 6);
      c.lineTo(m.x, m.y + 6);
      c.stroke();
    }
    // 集结点落点特效（扩散旗圈）
    for (let i = rallyFx.length - 1; i >= 0; i--) {
      const m = rallyFx[i];
      const age = (t - m.born) / m.ttl;
      if (age >= 1) {
        rallyFx.splice(i, 1);
        continue;
      }
      const col = playerColor(myPlayerIndex());
      c.strokeStyle = hexAlpha(col, 0.9 * (1 - age));
      c.lineWidth = 2.6;
      c.beginPath();
      c.arc(m.x, m.y, 16 + age * 28, 0, TAU);
      c.stroke();
      c.beginPath();
      c.arc(m.x, m.y, 9 * (1 - age), 0, TAU);
      c.stroke();
    }
  }

  /* ================= HUD（屏幕坐标系） ================= */

  /**
   * 左上角科技点面板：当前研究点数 / 每秒产出 / 距下次进化的进度。
   * 只有占领研究所才产出（每座 3 点/秒），500 点可进化一次单位。
   */
  function drawTechHud() {
    if (!meta || meta.phase === 'countdown') return;
    const c = ctx;
    const mine = myPlayerIndex();
    const cost = (meta.consts && meta.consts.evolveRpCost) || 500;
    const perLab = (meta.consts && meta.consts.rpPerLab) || 3;
    const viewing = mine >= 0 && !isSpectator ? mine : -1;

    const x = 14;
    const y = 14;
    const w = 196;
    const h = viewing >= 0 ? 96 : 30 + Math.max(1, (meta.players || []).length) * 22;

    c.save();
    c.fillStyle = 'rgba(246,239,221,0.9)';
    c.fillRect(x, y, w, h);
    c.strokeStyle = hexAlpha(INK, 0.5);
    c.lineWidth = 1.4;
    c.strokeRect(x, y, w, h);

    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = hexAlpha(INK, 0.6);
    c.font = '600 11px ' + CALLOUT_FONT;
    c.fillText('科 技 点', x + 12, y + 18);

    if (viewing >= 0) {
      const nLabs = labsView.filter((l) => l.owner === viewing).length;
      const rp = rpView.length ? rpView[viewing] || 0 : 0;
      const rate = nLabs * perLab;
      c.fillStyle = nLabs > 0 ? '#8a2f22' : hexAlpha(INK, 0.42);
      c.font = '700 30px ' + CALLOUT_FONT;
      c.fillText(String(Math.floor(rp)), x + 12, y + 50);
      c.fillStyle = hexAlpha(INK, 0.62);
      c.font = '500 12px ' + CALLOUT_FONT;
      c.fillText(nLabs > 0 ? `+${rate} / 秒 · 研究所 ×${nLabs}` : '未占研究所 · 不产出', x + 12, y + 68);

      // 距下次进化（每 cost 点可进化一次）
      const prog = clamp((rp % cost) / cost, 0, 1);
      const bx = x + 12;
      const by = y + 78;
      const bw = w - 24;
      c.fillStyle = 'rgba(38,34,28,0.18)';
      c.fillRect(bx, by, bw, 6);
      const ready = Math.floor(rp / cost);
      c.fillStyle = ready > 0 ? hexAlpha('#8a2f22', 0.85) : hexAlpha(INK, 0.4);
      c.fillRect(bx, by, bw * prog, 6);
      c.strokeStyle = hexAlpha(INK, 0.4);
      c.lineWidth = 1;
      c.strokeRect(bx, by, bw, 6);
      c.textAlign = 'right';
      c.fillStyle = ready > 0 ? '#8a2f22' : hexAlpha(INK, 0.62);
      c.font = '600 11px ' + CALLOUT_FONT;
      c.fillText(ready > 0 ? `可进化 ×${ready}` : `${Math.floor(rp)} / ${cost}`, x + w - 12, y + 72);
    } else {
      // 观战：列出各玩家科技点
      (meta.players || []).forEach((p, i) => {
        const nLabs = labsView.filter((l) => l.owner === i).length;
        c.fillStyle = p.color || INK;
        c.beginPath();
        c.arc(x + 16, y + 32 + i * 22 - 4, 4, 0, TAU);
        c.fill();
        c.fillStyle = hexAlpha(INK, 0.8);
        c.font = '600 12px ' + CALLOUT_FONT;
        c.fillText(p.name || '玩家', x + 28, y + 32 + i * 22);
        c.textAlign = 'right';
        c.fillStyle = nLabs > 0 ? '#8a2f22' : hexAlpha(INK, 0.4);
        c.fillText(Math.round(rpView[i] || 0) + (nLabs > 0 ? ` (${nLabs} 所)` : ''), x + w - 12, y + 32 + i * 22);
        c.textAlign = 'left';
      });
    }
    c.restore();
  }

  function drawMinimap(t) {
    const c = ctx;
    const w = MINIMAP_W;
    const h = MINIMAP_H;
    const x0 = cssW - w - 14;
    const y0 = cssH - h - 14;
    const sx = w / WORLD_W;
    const sy = h / WORLD_H;

    c.save();
    // 底
    c.fillStyle = 'rgba(246,239,221,0.92)';
    c.fillRect(x0, y0, w, h);
    // 地形底色
    if (terrainReady && terrainGrid) {
      const cw = w / terrainGW, chh = h / terrainGH;
      // 注意：循环变量不得命名为 c/t，否则会遮蔽上面的 ctx 别名 c 与帧时间参数 t
      for (let rr = 0; rr < terrainGH; rr++) {
        for (let cc = 0; cc < terrainGW; cc++) {
          const tv = terrainGrid[rr][cc];
          let col = null;
          if (tv === 3) col = 'rgba(104,104,72,0.5)'; // 沼泽
          else if (tv === 4) col = 'rgba(74,96,112,0.7)'; // 水域（不可通行）
          else if (tv === 2) col = 'rgba(72,68,62,0.75)'; // 山地（不可通行）
          if (col) {
            c.fillStyle = col;
            c.fillRect(x0 + cc * cw, y0 + rr * chh, cw + 0.6, chh + 0.6);
          }
        }
      }
    }
    c.strokeStyle = hexAlpha(INK, 0.6);
    c.lineWidth = 1.5;
    c.strokeRect(x0, y0, w, h);

    // 工厂
    for (const f of factoriesView) {
      const col = f.owner >= 0 ? playerColor(f.owner) : hexAlpha(INK, 0.45);
      c.fillStyle = col;
      const r = 3 + f.level;
      c.fillRect(x0 + f.x * sx - r / 2, y0 + f.y * sy - r / 2, r, r);
      if (f.capProg > 0 && f.capBy >= 0) {
        c.strokeStyle = playerColor(f.capBy);
        c.lineWidth = 1.2;
        c.strokeRect(x0 + f.x * sx - r, y0 + f.y * sy - r, r * 2, r * 2);
      }
    }
    // 研究所
    for (const l of labsView) {
      c.fillStyle = l.owner >= 0 ? playerColor(l.owner) : hexAlpha(INK, 0.3);
      c.beginPath();
      const lx = x0 + l.x * sx;
      const ly = y0 + l.y * sy;
      c.moveTo(lx, ly - 3);
      c.lineTo(lx + 3, ly);
      c.lineTo(lx, ly + 3);
      c.lineTo(lx - 3, ly);
      c.closePath();
      c.fill();
    }
    // 总部（方形套环，陷落则描空心）
    for (const h of hqView) {
      const hx = x0 + h.x * sx;
      const hy = y0 + h.y * sy;
      c.lineWidth = 2;
      c.strokeStyle = h.down ? hexAlpha(INK, 0.35) : playerColor(h.owner);
      c.strokeRect(hx - 4, hy - 4, 8, 8);
      if (!h.down) {
        c.fillStyle = hexAlpha(playerColor(h.owner), 0.85);
        c.fillRect(hx - 1.6, hy - 1.6, 3.2, 3.2);
      }
      if (h.id === selHqId) {
        c.strokeStyle = hexAlpha(INK, 0.8);
        c.lineWidth = 1;
        c.strokeRect(hx - 7, hy - 7, 14, 14);
      }
    }
    // 单位
    for (const u of units.values()) {
      c.fillStyle = playerColor(u.oi);
      c.fillRect(x0 + u.x * sx - 1, y0 + u.y * sy - 1, 2.4, 2.4);
    }
    // 视口框
    c.strokeStyle = hexAlpha(INK, 0.75);
    c.lineWidth = 1;
    c.setLineDash([4, 3]);
    c.strokeRect(
      x0 + cam.x * sx,
      y0 + cam.y * (h / WORLD_H === sy ? sy : sy),
      VIEW_W * sx,
      VIEW_H * sy
    );
    c.setLineDash([]);
    c.restore();
    void t;
  }

  /** 选中工厂时的提示条：本厂兵种 + 集结点状态 + 操作指引 */
  function drawFactoryHud() {
    if (isSpectator || !selFacId) return;
    const f = factoriesView.find((x) => x.id === selFacId);
    if (!f) return;
    const r = rallyById.get(f.id);
    const cn = UNIT_CN[f.pt] || '';
    const text =
      '已选 ' +
      f.id +
      ' 号工厂 · 产' +
      (cn || '兵') +
      ' · ' +
      (r ? '集结点已设 ' + Math.round(r.x) + ',' + Math.round(r.y) : '右键设置集结点') +
      '（Delete 清除）';
    const c = ctx;
    c.save();
    c.font = '600 14px ' + CALLOUT_FONT;
    const w = c.measureText(text).width + 26;
    const x0 = 14;
    const y0 = cssH - 80;
    c.fillStyle = 'rgba(246,239,221,0.92)';
    c.beginPath();
    c.rect(x0, y0, w, 28);
    c.fill();
    c.strokeStyle = hexAlpha(playerColor(f.owner), 0.75);
    c.lineWidth = 1.2;
    c.strokeRect(x0, y0, w, 28);
    c.fillStyle = INK;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(text, x0 + 13, y0 + 14);
    c.restore();
  }

  /* ================= 右侧工厂面板 ================= */

  /** 绑定面板按钮：关闭 / 进化 */
  function bindFacPanel() {
    if (!facPanelEl) return;
    const closeBtn = fpEls.close;
    if (closeBtn && !closeBtn._wfBound) {
      closeBtn._wfBound = true;
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selFacId = 0;
        syncFacPanel();
      });
    }
    const evoBtn = fpEls.evolve;
    if (evoBtn && !evoBtn._wfBound) {
      evoBtn._wfBound = true;
      evoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isSpectator) return;
        // fid = 0 表示总部亲兵；否则为选中的工厂
        const fid = selHqId ? 0 : selFacId;
        if (!fid && !selHqId) return;
        if (net && typeof net.sendRt === 'function') net.sendRt({ cmd: 'facEvolve', fid });
      });
      // 面板叠在画布之上：吞掉按下/右键，避免误触发拖框或设集结点
      evoBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      evoBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    if (facPanelEl && !facPanelEl._wfBound) {
      facPanelEl._wfBound = true;
      facPanelEl.addEventListener('mousedown', (e) => e.stopPropagation());
      facPanelEl.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  /** 科技点是否够进化一次 */
  function myRp() {
    const mine = myPlayerIndex();
    if (mine < 0) return 0;
    return rpView.length ? rpView[mine] || 0 : (meta.players && meta.players[mine] && meta.players[mine].rp) || 0;
  }

  /** 统计某来源（工厂 id / 0=总部）产出、尚未到顶阶的部队数 */
  function evolvableCount(ownerIdx, sourceId) {
    let n = 0;
    for (const u of units.values()) {
      if (u.oi !== ownerIdx) continue;
      if ((u.mf || 0) !== sourceId) continue;
      if ((u.maxTier || 1) > (u.tier || 1)) n += 1;
    }
    return n;
  }

  /**
   * 右侧面板：选中本方工厂 → 本厂兵种/生产进度/进化；选中本方总部 → 亲兵进化。
   * 进化消耗科技点（500 点/次），点数不足则按钮禁用。
   */
  function syncFacPanel() {
    if (!facPanelEl) return;
    const mine = myPlayerIndex();
    const f = !selHqId && selFacId ? factoriesView.find((x) => x.id === selFacId) : null;
    const hq = !f && selHqId ? hqView.find((x) => x.id === selHqId && x.owner === mine && !x.down) : null;
    if ((!f && !hq) || isSpectator || mine < 0) {
      if (!facPanelEl.hidden) facPanelEl.hidden = true;
      facPanelKey = '';
      return;
    }
    if (facPanelEl.hidden) {
      facPanelEl.hidden = false;
      bindFacPanel();
    }

    const cost = (meta.consts && meta.consts.evolveRpCost) || 500;
    const cdMax = (meta.consts && meta.consts.facEvolveCd) || 4000;
    const rp = myRp();
    const isHq = Boolean(hq);

    // 结构签名变化才重写静态文本，避免每帧刷 DOM
    const sig = isHq
      ? 'hq|' + hq.id + '|' + hq.owner + '|' + Math.floor(rp / cost)
      : 'f|' + f.id + '|' + f.level + '|' + f.owner + '|' + f.pt + '|' + (f.ecd || 0);
    const ownerName = (idx) =>
      idx >= 0 && meta.players && meta.players[idx] ? meta.players[idx].name : '玩家' + (idx + 1);

    if (sig !== facPanelKey) {
      facPanelKey = sig;
      if (fpEls.title) fpEls.title.textContent = isHq ? '总部' : f.id + ' 号工厂';
      if (fpEls.owner) fpEls.owner.textContent = '归属：' + ownerName(isHq ? hq.owner : f.owner);
      if (fpEls.level) fpEls.level.textContent = isHq ? '本阵' : (LEVEL_CHAR[f.level] || '初') + '级';
      // 总部没有生产环节，隐藏「正在生产」与「集结点」两段
      if (fpEls.prodSec) fpEls.prodSec.hidden = isHq;
      if (fpEls.unitRow) fpEls.unitRow.hidden = isHq;
      if (fpEls.rally) fpEls.rally.hidden = isHq;
      if (!isHq) {
        const cn = UNIT_CN[f.pt] || '兵';
        if (fpEls.glyph) fpEls.glyph.textContent = cn.charAt(0);
        if (fpEls.unitName) fpEls.unitName.textContent = cn;
        if (fpEls.unitDesc) fpEls.unitDesc.textContent = UNIT_DESC[f.pt] || '';
      }
    }

    // —— 动态部分：血条 / 生产进度 / 进化按钮 / 集结点
    const hpMax = isHq
      ? hq.hpMax || (meta.consts && meta.consts.hqHp) || 3000
      : f.hpMax || (meta.consts && meta.consts.factoryHp) || 2000;
    const hp = (isHq ? hq.hp : f.hp) == null ? hpMax : (isHq ? hq.hp : f.hp);
    const ratio = clamp(hp / hpMax, 0, 1);
    if (fpEls.hpFill) fpEls.hpFill.style.width = (ratio * 100).toFixed(1) + '%';
    if (fpEls.hpBar) {
      fpEls.hpBar.classList.toggle('is-mid', ratio <= 0.5 && ratio > 0.22);
      fpEls.hpBar.classList.toggle('is-low', ratio <= 0.22);
    }
    if (fpEls.hpText) fpEls.hpText.textContent = Math.round(hp) + ' / ' + Math.round(hpMax);
    if (!isHq && fpEls.prodFill) {
      fpEls.prodFill.style.width = (clamp(f.prodProg || 0, 0, 1) * 100).toFixed(1) + '%';
    }

    const evoBtn = fpEls.evolve;
    if (evoBtn) {
      const cd = isHq ? hq.ecd || 0 : f.ecd || 0;
      if (!isHq && f.level < 2) {
        // 初级工厂的兵只有一阶，没有进化按钮
        if (!evoBtn.hidden) evoBtn.hidden = true;
      } else {
        if (evoBtn.hidden) evoBtn.hidden = false;
        const ready = evolvableCount(isHq ? hq.owner : f.owner, isHq ? 0 : f.id);
        if (cd > 0) {
          evoBtn.disabled = true;
          evoBtn.textContent = '进化 ' + (cd / 1000).toFixed(1) + 's';
        } else if (rp < cost) {
          evoBtn.disabled = true;
          evoBtn.textContent = '科技点不足 ' + Math.floor(rp) + '/' + cost;
        } else {
          evoBtn.disabled = ready === 0;
          evoBtn.textContent = ready > 0 ? `进化一阶（${cost}）· 可 ${ready} 支` : '无可进阶部队';
        }
      }
      // 说明文案
      if (fpEls.note) {
        if (isHq) {
          fpEls.note.textContent = `总部亲兵最高 ${TIER_CHAR[3] || '高'}阶 · 每次消耗 ${cost} 科技点`;
        } else if (f.level < 2) {
          fpEls.note.textContent = '初级工厂：产出的部队无法进阶';
        } else {
          fpEls.note.textContent =
            '本厂部队最高 ' + (TIER_CHAR[f.level] || '中') + '阶 · 每次进化消耗 ' + cost +
            ' 科技点 · 冷却 ' + Math.round(cdMax / 1000) + ' 秒';
        }
      }
    }

    if (!isHq && fpEls.rally) {
      const r = rallyById.get(f.id);
      fpEls.rally.textContent = r
        ? '集结点：' + Math.round(r.x) + ',' + Math.round(r.y) + '（右键改点 / Delete 清除）'
        : '集结点：未设置（右键地图设点）';
    }
  }

  function drawSelectionHud() {
    if (isSpectator || selection.size === 0) return;
    const c = ctx;
    // 汇总所选
    const agg = {};
    for (const u of units.values()) {
      if (!selection.has(u.id)) continue;
      const key = u.type + '|' + u.tier;
      agg[key] = (agg[key] || 0) + 1;
    }
    const labels = { warrior: '锐士', shield: '盾卫', ranger: '游侠', burst: '轰击', burn: '燎原' };
    const parts = [];
    let total = 0;
    for (const key of Object.keys(agg).sort()) {
      const [type, tier] = key.split('|');
      parts.push(labels[type] + '×' + agg[key] + '(' + (TIER_CHAR[tier] || '初') + ')');
      total += agg[key];
    }
    const text = '点兵 ' + total + '：' + parts.slice(0, 6).join(' ');
    c.save();
    c.font = '600 14px ' + CALLOUT_FONT;
    const w = c.measureText(text).width + 26;
    const x0 = 14;
    const y0 = cssH - 44;
    c.fillStyle = 'rgba(246,239,221,0.9)';
    c.beginPath();
    c.rect(x0, y0, w, 28);
    c.fill();
    c.strokeStyle = hexAlpha(INK, 0.5);
    c.lineWidth = 1;
    c.strokeRect(x0, y0, w, 28);
    c.fillStyle = INK;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(text, x0 + 13, y0 + 15);
    c.textBaseline = 'alphabetic';
    c.restore();
  }

  function drawOverlay() {
    if (!meta) return;
    const c = ctx;
    c.save();
    c.textAlign = 'center';
    if (meta.over) {
      const mine = !isSpectator && (meta.players || []).find((p) => p.id === meId);
      const iWon = meta.winnerId && meta.winnerId === meId;
      const main = meta.winnerId
        ? iWon
          ? '大 捷'
          : mine && mine.eliminated
            ? '败 北'
            : '终 局'
        : '同 归 于 尽';
      const winner = (meta.players || []).find((p) => p.id === meta.winnerId);
      const sub = winner ? (winner.name || '玩家') + ' 平定天下' : '尘埃落定';
      c.fillStyle = 'rgba(236,227,205,0.62)';
      c.fillRect(0, cssH / 2 - 62, cssW, 124);
      c.fillStyle = iWon ? '#8a2f22' : INK;
      c.font = '700 52px ' + CALLOUT_FONT;
      c.fillText(main, cssW / 2, cssH / 2 + 6);
      c.font = '500 17px ' + CALLOUT_FONT;
      c.fillStyle = hexAlpha(INK, 0.75);
      c.fillText(sub, cssW / 2, cssH / 2 + 40);
      c.restore();
      return;
    }
    if (meta.phase === 'countdown') {
      const left = Math.max(0, Math.ceil(((meta.phaseEndsAt || 0) - Date.now()) / 1000));
      c.fillStyle = 'rgba(236,227,205,0.55)';
      c.fillRect(0, cssH / 2 - 70, cssW, 140);
      c.fillStyle = INK;
      c.font = '700 58px ' + CALLOUT_FONT;
      c.fillText(left > 0 ? String(left) : '出 征', cssW / 2, cssH / 2 + 10);
      c.font = '500 17px ' + CALLOUT_FONT;
      c.fillStyle = hexAlpha(INK, 0.7);
      c.fillText(
        tr('warfactory.countdownHint', {}, '抢占工厂与研究所 · 科技点攒够 500 即可进化部队'),
        cssW / 2,
        cssH / 2 + 46
      );
    } else if (meta.phase === 'playing' && startedAt && Date.now() - startedAt < 9000) {
      const fade = 1 - (Date.now() - startedAt) / 9000;
      c.fillStyle = hexAlpha(INK, 0.55 * fade);
      c.font = '500 15px ' + CALLOUT_FONT;
      c.fillText(
        tr('warfactory.playHint', {}, '左键框选部队 · 右键进攻移动'),
        cssW / 2,
        34
      );
    }
    // 出局横幅
    for (const e of effects) {
      if (e.kind !== 'elim') continue;
      const age = (Date.now() - e.born) / e.ttl;
      if (age >= 1) continue;
      const col = playerColor(e.oi);
      c.fillStyle = hexAlpha(col, 0.9 * (1 - age));
      c.font = '700 40px ' + CALLOUT_FONT;
      c.fillText('滅', cssW / 2, cssH / 2 - 90);
    }
    c.restore();
  }

  /* ================= 快照应用 ================= */

  function myPlayerIndex() {
    if (!meta || !meId) return -1;
    const idx = (meta.players || []).findIndex((p) => p.id === meId);
    return idx;
  }

  const TYPE_BY_IX = ['warrior', 'shield', 'ranger', 'burst', 'burn', 'laser'];
  const BRANCH_BY_IX = ['', 'A', 'B'];

  function applySnapshot(snap) {
    if (!snap) return;
    lastSnap = snap;
    const now = Date.now();

    // 单位
    const seen = new Set();
    for (const row of snap.u || []) {
      const id = row[0];
      seen.add(id);
      let u = units.get(id);
      if (!u) {
        u = {
          id,
          x: row[2],
          y: row[3],
          ang: row[4],
        };
        units.set(id, u);
      }
      u.oi = row[1];
      u.tx = row[2];
      u.ty = row[3];
      u.tang = row[4];
      u.type = TYPE_BY_IX[row[5]] || 'warrior';
      u.tier = row[6];
      u.branch = BRANCH_BY_IX[row[7]] || '';
      u.hp = row[8];
      u.maxTier = row[9];
      u.burning = row[10] === 1;
      u.mf = row[11] || 0; // 产出该单位的工厂 id（0 = 总部亲兵）
      // 激光兵锁定状态（其余兵种恒为 0）
      u.lk = row[12] || 0; // 锁定目标类别：0 无 / 1 单位 / 2 工厂 / 3 研究所 / 4 总部
      u.li = row[13] || 0; // 锁定目标 id
      u.lm = row[14] || 100; // 当前伤害倍率 ×100（100 = 1 倍）
      u.lw = row[15] || 0; // 前摇剩余毫秒（>0 = 蓄能中，尚未开火）
    }
    for (const id of [...units.keys()]) {
      if (!seen.has(id)) {
        units.delete(id);
        selection.delete(id);
      }
    }

    // 工厂 / 研究所动态状态
    if (meta && meta.factories) {
      const byId = {};
      for (const row of snap.f || []) {
        byId[row[0]] = row;
      }
      factoriesView = meta.factories.map((f) => {
        const row = byId[f.id];
        return {
          id: f.id,
          x: f.x,
          y: f.y,
          level: f.level,
          home: f.home,
          owner: row ? row[1] : f.owner,
          capProg: row ? row[2] : 0,
          capBy: row ? row[3] : -1,
          prodProg: row ? row[4] : 0,
          contested: row ? row[5] === 1 : false,
          hp: row && row[6] != null ? row[6] : f.hp != null ? f.hp : null,
          hpMax: f.hpMax || (meta.consts && meta.consts.factoryHp) || 2000,
          ecd: row && row[7] != null ? row[7] : 0,
          pt: f.pt || 'warrior',
        };
      });
    }
    // 集结点（服务端权威，仅下发已设置的）
    if (snap.r) {
      rallyById.clear();
      for (const row of snap.r) rallyById.set(row[0], { x: row[1], y: row[2] });
    }
    if (meta && meta.labs) {
      const byLid = {};
      for (const row of snap.lb || []) byLid[row[0]] = row;
      labsView = meta.labs.map((l) => {
        const row = byLid[l.id];
        return {
          id: l.id,
          x: l.x,
          y: l.y,
          owner: row ? row[1] : l.owner,
          hp: row ? row[2] : l.hp != null ? l.hp : null,
          hpMax: (row ? row[3] : l.hpMax) || (meta.consts && meta.consts.labHp) || 1200,
        };
      });
    }
    // 总部（每名玩家一座；打光即陷落）
    if (meta && meta.hqs) {
      const byHid = {};
      for (const row of snap.hq || []) byHid[row[0]] = row;
      hqView = meta.hqs.map((h) => {
        const row = byHid[h.id];
        return {
          id: h.id,
          x: h.x,
          y: h.y,
          owner: row ? row[1] : h.owner,
          hp: row ? row[2] : h.hp != null ? h.hp : null,
          hpMax: (row ? row[3] : h.hpMax) || (meta.consts && meta.consts.hqHp) || 3000,
          down: row ? row[4] === 1 : Boolean(h.down),
          ecd: row && row[5] != null ? row[5] : h.ecd || 0,
        };
      });
    }
    // 科技点（与 meta.players 同序）
    if (snap.rp) rpView = snap.rp.slice();

    // 事件 → 特效
    for (const ev of snap.ev || []) {
      if (ev.t === 'kill') {
        const dots = [];
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * TAU;
          const r = 6 + Math.random() * 18;
          dots.push([Math.cos(a) * r, Math.sin(a) * r * 0.6, 1.6 + Math.random() * 3.2]);
        }
        effects.push({ kind: 'splash', x: ev.x, y: ev.y, born: now, ttl: 750, dots });
      } else if (ev.t === 'evo') {
        effects.push({ kind: 'evo', x: ev.x, y: ev.y, oi: ev.oi, born: now, ttl: 900 });
      } else if (ev.t === 'cap') {
        effects.push({ kind: 'cap', x: ev.x, y: ev.y, oi: ev.oi, born: now, ttl: 1200 });
      } else if (ev.t === 'lab') {
        // 研究所易主：复用占领特效，紫色环
        effects.push({ kind: 'lab', x: ev.x, y: ev.y, oi: ev.oi, born: now, ttl: 1200 });
      } else if (ev.t === 'hqdown') {
        effects.push({ kind: 'hqdown', x: ev.x, y: ev.y, oi: ev.oi, born: now, ttl: 1600 });
        effects.push({ kind: 'elim', oi: ev.oi, born: now, ttl: 2600 });
      } else if (ev.t === 'boom') {
        effects.push({ kind: 'boom', x: ev.x, y: ev.y, r: Math.max(20, ev.r || 40), born: now, ttl: 520 });
      } else if (ev.t === 'elim') {
        effects.push({ kind: 'elim', oi: ev.oi, born: now, ttl: 2600 });
      } else if (ev.t === 'over') {
        // 胜负由 overlay 处理
      }
    }
  }

  /* ================= 记分牌（DOM） ================= */

  function renderScoreCards() {
    if (!scoreBox || !meta) return;
    const snap = lastSnap;
    // 汇总各玩家工厂/兵力（来自最近快照，保持实时）
    const facCount = {};
    const unitCount = {};
    for (const f of factoriesView) {
      if (f.owner >= 0) facCount[f.owner] = (facCount[f.owner] || 0) + 1;
    }
    for (const u of units.values()) {
      unitCount[u.oi] = (unitCount[u.oi] || 0) + 1;
    }
    const key = (meta.players || [])
      .map((p, i) =>
        [
          p.id,
          facCount[i] || 0,
          unitCount[i] || 0,
          p.kills,
          Math.floor(rpView[i] || 0),
          labsView.filter((l) => l.owner === i).length,
          hqView.some((h) => h.owner === i && h.down) ? 1 : 0,
          p.eliminated ? 1 : 0,
        ].join(':')
      )
      .join('|');
    if (key === lastCardKey) return;
    lastCardKey = key;

    scoreBox.innerHTML = '';
    for (let i = 0; i < (meta.players || []).length; i++) {
      const p = meta.players[i];
      const card = document.createElement('div');
      card.className = 'warfactory-score-card';
      if (p.id === meId) card.classList.add('is-me');
      if (p.eliminated || p.left) card.classList.add('is-out');

      const seal = document.createElement('span');
      seal.className = 'warfactory-seal';
      seal.style.background = p.color || INK;
      seal.textContent = '厂';
      card.appendChild(seal);

      const name = document.createElement('span');
      name.className = 'warfactory-card-name';
      name.textContent = p.name || '玩家';
      card.appendChild(name);

      const stat = document.createElement('span');
      stat.className = 'warfactory-card-stat';
      const nLabs = labsView.filter((l) => l.owner === i).length;
      stat.textContent =
        '厂 ' + (facCount[i] || 0) + ' · 所 ' + nLabs + ' · 兵 ' + (unitCount[i] || 0) +
        ' · 斩 ' + (p.kills || 0) + ' · 科 ' + Math.floor(rpView[i] || 0);
      card.appendChild(stat);

      scoreBox.appendChild(card);
    }
  }

  function statusText() {
    if (!meta) return '—';
    if (meta.over) {
      const winner = (meta.players || []).find((p) => p.id === meta.winnerId);
      return winner
        ? tr('warfactory.matchOver', { name: winner.name }, '战局终结：' + winner.name + ' 平定天下')
        : tr('warfactory.matchDraw', {}, '战局终结（同归于尽）');
    }
    if (meta.phase === 'countdown') {
      const left = Math.max(0, Math.ceil(((meta.phaseEndsAt || 0) - Date.now()) / 1000));
      return tr('warfactory.countdown', { n: left }, '出征准备 ' + (left || '…') + ' 秒');
    }
    if (meta.phase === 'playing') {
      const mine = myPlayerIndex();
      if (mine >= 0) {
        const p = meta.players[mine];
        if (p && p.eliminated) return tr('warfactory.eliminated', {}, '你已出局（可观战）');
      }
      return tr('warfactory.playing', {}, '逐鹿中原');
    }
    return '—';
  }

  function syncStatus() {
    if (!statusEl || !meta) return;
    const s = statusText();
    if (s !== lastStatus) {
      lastStatus = s;
      statusEl.textContent = s;
    }
  }

  /* ================= 相机与输入 ================= */

  function clampCam() {
    cam.x = clamp(cam.x, 0, Math.max(0, WORLD_W - VIEW_W));
    cam.y = clamp(cam.y, 0, Math.max(0, WORLD_H - VIEW_H));
  }

  function centerOn(x, y) {
    cam.x = x - VIEW_W / 2;
    cam.y = y - VIEW_H / 2;
    clampCam();
  }

  function centerOnMyBase() {
    const mine = myPlayerIndex();
    // 开局只有总部，没有起始工厂：优先对准自家总部
    const h = mine >= 0 ? hqView.find((x) => x.owner === mine) : null;
    const f = mine >= 0 ? factoriesView.find((x) => x.owner === mine) : null;
    if (h) centerOn(h.x, h.y);
    else if (f) centerOn(f.x, f.y);
    else centerOn(WORLD_W / 2, WORLD_H / 2);
  }

  function eventWorldPos(evt) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const mx = ((evt.clientX - rect.left) / rect.width) * VIEW_W;
    const my = ((evt.clientY - rect.top) / rect.height) * VIEW_H;
    return { x: cam.x + mx, y: cam.y + my };
  }

  function ownUnitAt(wx, wy) {
    let best = null;
    let bestD = 24;
    for (const u of units.values()) {
      if (u.oi !== myPlayerIndex()) continue;
      const d = Math.hypot(u.x - wx, u.y - wy);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  function selectUnitsInBox(x0, y0, x1, y1, additive) {
    const loX = Math.min(x0, x1);
    const hiX = Math.max(x0, x1);
    const loY = Math.min(y0, y1);
    const hiY = Math.max(y0, y1);
    const mine = myPlayerIndex();
    if (!additive) selection.clear();
    for (const u of units.values()) {
      if (u.oi !== mine) continue;
      if (u.x >= loX && u.x <= hiX && u.y >= loY && u.y <= hiY) selection.add(u.id);
    }
  }

  function onMouseDown(evt) {
    if (!active || !canvas) return;
    const pos = eventWorldPos(evt);
    if (!pos) return;
    if (evt.button === 0) {
      boxSel.on = true;
      boxSel.add = evt.shiftKey;
      boxSel.x0 = pos.x;
      boxSel.y0 = pos.y;
      boxSel.x1 = pos.x;
      boxSel.y1 = pos.y;
      evt.preventDefault();
    } else if (evt.button === 2) {
      // 选中了本方工厂 → 右键设集结点；否则 → 指挥选中部队移动
      if (selFacId) issueRally(pos.x, pos.y);
      else issueMove(pos.x, pos.y);
      evt.preventDefault();
    }
  }

  function onMouseMove(evt) {
    if (!active || !boxSel.on) return;
    const pos = eventWorldPos(evt);
    if (!pos) return;
    boxSel.x1 = pos.x;
    boxSel.y1 = pos.y;
  }

  function onMouseUp(evt) {
    if (!active || evt.button !== 0) return;
    if (!boxSel.on) return;
    boxSel.on = false;
    const pos = eventWorldPos(evt);
    if (!pos) return;
    const drag = Math.hypot(pos.x - boxSel.x0, pos.y - boxSel.y0);
    if (drag < 8) {
      // 点选：优先单位，其次本方总部，再次本方工厂（选中工厂 = 可右键设集结点）
      const u = ownUnitAt(pos.x, pos.y);
      const mine = myPlayerIndex();
      const hq = mine >= 0
        ? hqView.find((x) => !x.down && x.owner === mine && Math.hypot(x.x - pos.x, x.y - pos.y) < hqR() + 18)
        : null;
      const f = mine >= 0
        ? factoriesView.find((x) => Math.hypot(x.x - pos.x, x.y - pos.y) < 70 && x.owner === mine)
        : null;
      if (u) {
        selFacId = 0;
        selHqId = 0;
        if (!boxSel.add) selection.clear();
        selection.add(u.id);
      } else if (hq) {
        selFacId = 0;
        selHqId = !boxSel.add ? hq.id : 0;
        if (!boxSel.add) selection.clear();
      } else if (f && !boxSel.add) {
        selHqId = 0;
        selFacId = f.id;
        // 点工厂：同时选中该厂驻军，方便直接指挥
        selection.clear();
        for (const q of units.values()) {
          if (q.oi === mine && Math.hypot(q.x - f.x, q.y - f.y) < 130) selection.add(q.id);
        }
      } else if (!boxSel.add) {
        selFacId = 0;
        selHqId = 0;
        selection.clear();
      }
    } else {
      selFacId = 0;
      selHqId = 0;
      selectUnitsInBox(boxSel.x0, boxSel.y0, boxSel.x1, boxSel.y1, boxSel.add);
    }
  }

  let lastCmdAt = 0;

  /** 给选中的工厂设置集结点：此后该厂每次产出的部队自动前往该点 */
  function issueRally(wx, wy) {
    if (isSpectator || !selFacId) return;
    const f = factoriesView.find((x) => x.id === selFacId);
    if (!f || f.owner !== myPlayerIndex()) {
      selFacId = 0;
      return;
    }
    const now = Date.now();
    if (now - lastCmdAt < 110) return;
    lastCmdAt = now;
    const x = Math.max(0, Math.min(WORLD_W, Math.round(wx)));
    const y = Math.max(0, Math.min(WORLD_H, Math.round(wy)));
    if (net && typeof net.sendRt === 'function') {
      net.sendRt({ cmd: 'rally', fid: selFacId, x, y });
      // 本地立即生效，避免等待一次服务端往返才看到标记
      rallyById.set(selFacId, { x, y });
      rallyFx.push({ x, y, born: now, ttl: 900 });
    }
  }

  function issueMove(wx, wy) {
    if (isSpectator || selection.size === 0) return;
    const now = Date.now();
    if (now - lastCmdAt < 110) return;
    lastCmdAt = now;
    const ids = [...selection].slice(0, 80);
    if (typeof net !== 'undefined' && net && typeof net.sendRt === 'function') {
      net.sendRt({ cmd: 'move', x: Math.round(wx), y: Math.round(wy), ids });
      moveMarkers.push({ x: wx, y: wy, born: now, ttl: 850 });
    }
  }

  function selectAllOnScreen() {
    const mine = myPlayerIndex();
    if (mine < 0) return;
    for (const u of units.values()) {
      if (u.oi !== mine) continue;
      if (
        u.x >= cam.x &&
        u.x <= cam.x + VIEW_W &&
        u.y >= cam.y &&
        u.y <= cam.y + VIEW_H
      ) {
        selection.add(u.id);
      }
    }
  }

  function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    const tag = String(target.tagName).toUpperCase();
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      Boolean(target.isContentEditable)
    );
  }

  function onKeyDown(evt) {
    if (!active || isTypingTarget(evt.target)) return;
    switch (evt.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.up = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        keys.down = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keys.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keys.right = true;
        break;
      case 'KeyF':
        selectAllOnScreen();
        break;
      case 'Space':
        centerOnMyBase();
        evt.preventDefault();
        break;
      case 'Delete':
      case 'Backspace':
        // 清除选中工厂的集结点
        if (selFacId && !isSpectator) {
          const f = factoriesView.find((x) => x.id === selFacId);
          if (f && f.owner === myPlayerIndex() && net && typeof net.sendRt === 'function') {
            net.sendRt({ cmd: 'rally', fid: selFacId, clear: true });
            rallyById.delete(selFacId);
          }
        }
        break;
      default:
        return;
    }
    if (String(evt.code).indexOf('Arrow') === 0) evt.preventDefault();
  }

  function onKeyUp(evt) {
    switch (evt.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.up = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        keys.down = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keys.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keys.right = false;
        break;
      default:
        return;
    }
  }

  function onMinimapNav(evt) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    // 屏幕坐标
    const sx = ((evt.clientX - rect.left) / rect.width) * cssW;
    const sy = ((evt.clientY - rect.top) / rect.height) * cssH;
    const x0 = cssW - MINIMAP_W - 14;
    const y0 = cssH - MINIMAP_H - 14;
    if (sx < x0 || sy < y0) return false;
    const wx = ((sx - x0) / MINIMAP_W) * WORLD_W;
    const wy = ((sy - y0) / MINIMAP_H) * WORLD_H;
    centerOn(wx, wy);
    return true;
  }

  function onCanvasClickNav(evt) {
    if (!active || evt.button !== 0) return;
    onMinimapNav(evt);
  }

  function bindInput() {
    if (!canvas) return;
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('click', onCanvasClickNav);
    canvas.addEventListener('contextmenu', preventCtx);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  }

  function unbindInput() {
    if (!canvas) return;
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('click', onCanvasClickNav);
    canvas.removeEventListener('contextmenu', preventCtx);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  }

  function preventCtx(evt) {
    evt.preventDefault();
  }

  function onBlur() {
    for (const k of Object.keys(keys)) delete keys[k];
    boxSel.on = false;
  }

  /* ================= 主循环 ================= */

  function setupCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    cssW = rect.width || cssW;
    cssH = rect.height || cssH;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    zoom = cssW / VIEW_W;
    VIEW_H = cssH / zoom;
    clampCam();
  }

  function lerpAngle(a, b, k) {
    let d = b - a;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return a + d * k;
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    const now = Date.now();
    const dt = Math.min(0.06, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;
    if (!ctx || !meta) return;
    const t = now;

    // 相机移动
    const camSpd = 950 * dt;
    let cx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let cy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (cx || cy) {
      const len = Math.hypot(cx, cy) || 1;
      cam.x += (cx / len) * camSpd;
      cam.y += (cy / len) * camSpd;
      clampCam();
    }

    // 单位插值
    const k = Math.min(1, dt * 11);
    for (const u of units.values()) {
      if (u.tx != null) {
        if (Math.hypot(u.tx - u.x, u.ty - u.y) > 260) {
          u.x = u.tx;
          u.y = u.ty;
        } else {
          u.x += (u.tx - u.x) * k;
          u.y += (u.ty - u.y) * k;
        }
      }
      if (u.tang != null) u.ang = lerpAngle(u.ang, u.tang, k);
    }

    if (meta.phase === 'playing' && !startedAt) startedAt = Date.now();
    if (meta.phase === 'countdown') startedAt = 0;

    // ---- 世界坐标绘制 ----
    const kk = dpr * zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER_DEEP;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(kk, 0, 0, kk, -cam.x * kk, -cam.y * kk);
    if (bgReady) ctx.drawImage(bgCanvas, 0, 0);
    if (terrainReady) ctx.drawImage(terrainCanvas, 0, 0);

    for (const f of factoriesView) drawFactory(f, t);
    drawRallies(t);
    for (const h of hqView) drawHq(h);
    for (const l of labsView) drawLab(l, t);
    drawUnits(t);
    drawBullets();
    drawBeams(t);
    drawEffects(t);

    // 框选矩形
    if (boxSel.on) {
      ctx.strokeStyle = hexAlpha(INK, 0.7);
      ctx.lineWidth = 1.6 / zoom;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(
        Math.min(boxSel.x0, boxSel.x1),
        Math.min(boxSel.y0, boxSel.y1),
        Math.abs(boxSel.x1 - boxSel.x0),
        Math.abs(boxSel.y1 - boxSel.y0)
      );
      ctx.setLineDash([]);
      ctx.fillStyle = hexAlpha(INK, 0.06);
      ctx.fillRect(
        Math.min(boxSel.x0, boxSel.x1),
        Math.min(boxSel.y0, boxSel.y1),
        Math.abs(boxSel.x1 - boxSel.x0),
        Math.abs(boxSel.y1 - boxSel.y0)
      );
    }

    // ---- 屏幕坐标 HUD ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTechHud();
    drawMinimap(t);
    drawFactoryHud();
    drawSelectionHud();
    drawOverlay();

    syncFacPanel();
    syncStatus();
    renderScoreCards();
  }

  /* ================= 对外 API ================= */

  function bindRt() {
    if (rtBound || !net || typeof net.on !== 'function') return;
    rtBound = true;
    net.on('game:rt', (snap) => {
      if (!active) return;
      applySnapshot(snap);
    });
  }

  function render(game, netObj, opts = {}) {
    net = netObj || net;
    meta = game;
    meId = opts.meId || null;
    isSpectator = Boolean(opts.isSpectator);
    if (typeof opts.t === 'function') trFn = opts.t;
    if (opts.title && titleEl) titleEl.textContent = opts.title;

    panel = document.getElementById('panel-warfactory');
    canvas = document.getElementById('warfactory-canvas');
    if (canvas) ctx = canvas.getContext('2d');
    scoreBox = document.getElementById('warfactory-scores');
    facPanelEl = document.getElementById('warfactory-facpanel');
    if (panel) {
      panel.hidden = false;
      titleEl = panel.querySelector('#game-title');
      statusEl = panel.querySelector('#game-status');
    }
    if (facPanelEl) {
      fpEls.title = facPanelEl.querySelector('#wfp-title');
      fpEls.close = facPanelEl.querySelector('#wfp-close');
      fpEls.owner = facPanelEl.querySelector('#wfp-owner');
      fpEls.level = facPanelEl.querySelector('#wfp-level');
      fpEls.hpBar = facPanelEl.querySelector('.wfp-bar-hp');
      fpEls.hpFill = facPanelEl.querySelector('#wfp-hp-fill');
      fpEls.hpText = facPanelEl.querySelector('#wfp-hp-text');
      fpEls.prodSec = facPanelEl.querySelector('#wfp-prod-sec');
      fpEls.unitRow = facPanelEl.querySelector('#wfp-unit');
      fpEls.glyph = facPanelEl.querySelector('#wfp-glyph');
      fpEls.unitName = facPanelEl.querySelector('#wfp-unit-name');
      fpEls.unitDesc = facPanelEl.querySelector('#wfp-unit-desc');
      fpEls.prodFill = facPanelEl.querySelector('#wfp-prod-fill');
      fpEls.evolve = facPanelEl.querySelector('#wfp-evolve');
      fpEls.note = facPanelEl.querySelector('#wfp-note');
      fpEls.rally = facPanelEl.querySelector('#wfp-rally');
      if (facPanelEl.hidden) facPanelKey = '';
      bindFacPanel();
    }

    if (meta && meta.world) {
      const changed =
        meta.world.w !== WORLD_W || meta.world.h !== WORLD_H;
      WORLD_W = meta.world.w || WORLD_W;
      WORLD_H = meta.world.h || WORLD_H;
      if (changed || !bgReady) buildBackground(Math.floor(Date.now() / 86400000));
    } else if (!bgReady) {
      buildBackground(20260922);
    }

    setupCanvas();
    factoriesView = (meta.factories || []).map((f) => ({
      id: f.id,
      x: f.x,
      y: f.y,
      level: f.level,
      home: f.home,
      owner: f.owner,
      capBy: f.capBy,
      capProg: f.capProg || 0,
      prodProg: f.prodProg || 0,
      contested: false,
      hp: f.hp != null ? f.hp : null,
      hpMax: f.hpMax || (meta.consts && meta.consts.factoryHp) || 2000,
      ecd: f.ecd || 0, // 手动进化冷却剩余（毫秒）
      pt: f.pt || 'warrior', // 本厂固定生产的兵种
    }));
    // 集结点：以服务端 publicGameState 的初始值为准
    rallyById.clear();
    for (const f of meta.factories || []) {
      if (f.rx != null && f.ry != null) rallyById.set(f.id, { x: f.rx, y: f.ry });
    }
    labsView = (meta.labs || []).map((l) => ({
      id: l.id,
      x: l.x,
      y: l.y,
      owner: l.owner,
      hp: l.hp != null ? l.hp : l.hpMax,
      hpMax: l.hpMax || 1200,
    }));
    hqView = (meta.hqs || []).map((h) => ({
      id: h.id,
      x: h.x,
      y: h.y,
      owner: h.owner,
      hp: h.hp != null ? h.hp : h.hpMax,
      hpMax: h.hpMax || 3000,
      down: Boolean(h.down),
      ecd: h.ecd || 0,
    }));
    rpView = (meta.players || []).map((p) => p.rp || 0);

    // 同一局内，render 会被 game:state 反复调用（hideAllGamePanels 先调了 hide）。
    // 仅当「开新局」时才重置相机与运行时状态；同局 repeated render 必须保留镜头/单位，否则会周期性瞬移+闪屏。
    const matchKey =
      (meta.world ? meta.world.w + 'x' + meta.world.h : '?') +
      '#' +
      (meta.players || []).map((p) => p.id).sort().join(',') +
      '#' +
      (meta.factories || []).length;
    if (matchKey !== lastMatchKey) {
      lastMatchKey = matchKey;
      units.clear();
      effects.length = 0;
      moveMarkers.length = 0;
      rallyFx.length = 0;
      selection.clear();
      selFacId = 0;
      selHqId = 0;
      rpView = [];
      lastSnap = null;
      startedAt = 0;
      frame._camInit = false;
      // 地形：优先使用服务端权威地形（含建筑水域清理），否则本地确定性生成兜底
      if (meta.terrain && meta.terrain.data) {
        applyServerTerrain(meta.terrain);
      } else {
        buildTerrain(hashStr(matchKey) ^ ((WORLD_W * 31 + WORLD_H) >>> 0));
      }
    }

    // 首次进入（或开新局）：镜头对准本方大营
    if (!frame._camInit) {
      centerOnMyBase();
      frame._camInit = true;
    }

    lastCardKey = '';
    lastStatus = '';
    bindRt();
    if (!active) {
      active = true;
      bindInput();
    }
    if (!raf) {
      lastFrame = Date.now();
      raf = requestAnimationFrame(frame);
    }
  }

  function hide() {
    active = false;
    unbindInput();
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    // 注意：此处不再清空 units/effects/selection/cam/_camInit。
    // 因为 renderGame 在每次 game:state 都会先调 hideAllGamePanels → hide()，
    // 若在此清空，会导致同局内周期性闪屏 + 镜头瞬移回大营。
    // 镜头/单位的重置改由 render() 用「同局指纹」在开新局时统一处理。
    if (panel) panel.hidden = true;
    // 注意：此处不动 facPanelEl 的显示状态。hide() 在每次 game:state 都会被
    // hideAllGamePanels 调用，若在此收起侧栏会造成周期性闪烁；侧栏随 panel
    // 一起隐藏/显示，其显隐完全由 selFacId 在 syncFacPanel() 里决定。
  }

  function bindButtons(netObj) {
    if (netObj) net = netObj;
    bindRt();
  }

  window.addEventListener('resize', () => {
    if (!canvas || !active) return;
    setupCanvas();
  });

  return { render, hide, applySnapshot, bindButtons };
})();
