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

  // ==== 运行时状态 ====
  let lastSnap = null;
  const units = new Map(); // id → 可绘制单位（插值）
  let factoriesView = []; // {id,x,y,level,home,owner,capBy,capProg,prodProg,contested}
  let labsView = []; // {id,x,y,owner}
  const selection = new Set();
  const cam = { x: 0, y: 0 };
  const keys = Object.create(null);
  const boxSel = { on: false, x0: 0, y0: 0, x1: 0, y1: 0, add: false };
  const effects = []; // 特效队列
  const moveMarkers = [];
  let bgCanvas = null;
  let bgReady = false;
  let lastCardKey = '';
  let lastStatus = '';
  let lastHudKey = '';

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
    c.textBaseline = 'alphabetic';
    c.restore();
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

  function drawUnitBody(type, tier, branch) {
    if (type === 'warrior') drawWarrior(ctx, tier, branch);
    else if (type === 'shield') drawShield(ctx, tier, branch);
    else if (type === 'ranger') drawRanger(ctx, tier, branch);
    else if (type === 'burst') drawBurst(ctx, tier, branch);
    else if (type === 'burn') drawBurn(ctx, tier, branch);
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
        // 进化经验刻度（仍可进化时）
        if (u.tier < u.maxTier) {
          c.fillStyle = hexAlpha(INK, 0.22);
          c.fillRect(u.x - bw / 2, u.y - 22, bw, 2);
          c.fillStyle = hexAlpha(INK, 0.62);
          c.fillRect(u.x - bw / 2, u.y - 22, bw * clamp(u.xpPct / 100, 0, 1), 2);
        }
      }
      void myIdx;
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
  }

  /* ================= HUD（屏幕坐标系） ================= */

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
        tr('warfactory.countdownHint', {}, '抢占工厂 · 研究所可加速进化'),
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

  const TYPE_BY_IX = ['warrior', 'shield', 'ranger', 'burst', 'burn'];
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
      u.xpPct = row[10];
      u.burning = row[11] === 1;
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
        };
      });
    }
    if (meta && meta.labs) {
      labsView = meta.labs.map((l, i) => ({
        id: l.id,
        x: l.x,
        y: l.y,
        owner: snap.lb ? snap.lb[i] : l.owner,
      }));
    }

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
      .map((p, i) => [p.id, facCount[i] || 0, unitCount[i] || 0, p.kills, p.eliminated ? 1 : 0].join(':'))
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
      stat.textContent =
        '厂 ' + (facCount[i] || 0) + ' · 兵 ' + (unitCount[i] || 0) + ' · 斩 ' + (p.kills || 0);
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
    const f =
      mine >= 0
        ? factoriesView.find((x) => x.owner === mine && x.home) ||
          factoriesView.find((x) => x.owner === mine)
        : null;
    if (f) centerOn(f.x, f.y);
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
      issueMove(pos.x, pos.y);
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
      // 点选：优先单位，其次本方工厂驻军
      const u = ownUnitAt(pos.x, pos.y);
      if (u) {
        if (!boxSel.add) selection.clear();
        selection.add(u.id);
      } else {
        const mine = myPlayerIndex();
        const f = factoriesView.find(
          (x) => Math.hypot(x.x - pos.x, x.y - pos.y) < 70 && x.owner === mine
        );
        if (f && !boxSel.add) {
          selection.clear();
          for (const q of units.values()) {
            if (q.oi === mine && Math.hypot(q.x - f.x, q.y - f.y) < 130) selection.add(q.id);
          }
        } else if (!boxSel.add) {
          selection.clear();
        }
      }
    } else {
      selectUnitsInBox(boxSel.x0, boxSel.y0, boxSel.x1, boxSel.y1, boxSel.add);
    }
  }

  let lastCmdAt = 0;
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

    for (const f of factoriesView) drawFactory(f, t);
    for (const l of labsView) drawLab(l, t);
    drawUnits(t);
    drawBullets();
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
    drawMinimap(t);
    drawSelectionHud();
    drawOverlay();

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
    scoreBox = document.getElementById('warfactory-scores');
    if (panel) {
      panel.hidden = false;
      titleEl = panel.querySelector('#game-title');
      statusEl = panel.querySelector('#game-status');
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
    }));
    labsView = (meta.labs || []).map((l) => ({ id: l.id, x: l.x, y: l.y, owner: l.owner }));

    // 首次进入：镜头对准本方大营
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
    selection.clear();
    units.clear();
    effects.length = 0;
    moveMarkers.length = 0;
    lastSnap = null;
    frame._camInit = false;
    startedAt = 0;
    if (panel) panel.hidden = true;
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
