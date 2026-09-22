'use strict';

/**
 * 弹射对决（blaster）客户端渲染 + 输入。
 *
 * 服务端权威：本端只做「自己」的本地预测 + 其他单位的平滑/外推，
 * 位置最终以服务端快照为准。快照走 game:rt 轻量通道（~30Hz）。
 */
window.BlasterUi = (function () {
  const TAU = Math.PI * 2;

  let ARENA_W = 1500;
  let ARENA_H = 960;
  const WALL = 16;
  const PLAYER_R = 15;
  const BULLET_R = 5;
  const MAX_HP = 3;
  const PLAYER_SPEED = 205;
  const BULLET_SPEED_MIN = 300;
  const BULLET_SPEED_MAX = 760;
  const CHARGE_MAX_MS = 800;
  // 每个玩家同时存在的子弹上限（服务端权威，meta.consts 会覆盖此缺省值）
  let MAX_BULLETS_PER_PLAYER = 5;
  const INPUT_HZ = 50;

  // ---- 道具 ----
  let ITEM_R = 13;
  let BIG_BULLET_R = 9;
  let SPEED_BOOST_MULT = 1.55;
  // 道具外观：颜色 + 语言无关的符号
  const ITEM_STYLE = {
    heal: { color: '#34d399', glyph: '+' },
    power: { color: '#a78bfa', glyph: '◉' },
    ammo: { color: '#60a5fa', glyph: '≡' },
    speed: { color: '#fbbf24', glyph: '»' },
    shield: { color: '#22d3ee', glyph: '◆' },
  };
  const SMOOTH = 18;
  const MAX_BULLET_LAG = 120;

  let net = null;
  let meta = null;
  let meId = null;
  let isSpectator = false;
  let trFn = null;

  let panel = null;
  let canvas = null;
  let ctx = null;
  let dpr = 1;
  let scoreBox = null;
  let titleEl = null;
  let statusEl = null;

  let active = false;
  let raf = 0;
  let inputTimer = 0;
  let lastFrame = 0;
  let rtBound = false;

  let snaps = [];
  let selfPos = null;
  // 自己当前生效的道具状态（来自最近一次快照，用于本地预测与 HUD）
  const selfEff = { shield: 0, bigMs: 0, spdMs: 0, ammo: 0 };
  const remote = new Map();
  const keys = Object.create(null);
  const input = { mx: 0, my: 0, aim: 0, charge: 0 };
  let chargeStart = 0;
  let lastStatus = '';
  let lastCardKey = '';

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /** 把坐标按「来回折叠」的方式映射回场地内，用于粗略还原多次反弹 */
  function fold(v, lo, hi) {
    const span = hi - lo;
    if (span <= 0) return lo;
    let x = (v - lo) % (2 * span);
    if (x < 0) x += 2 * span;
    if (x > span) x = 2 * span - x;
    return lo + x;
  }

  /* ---------------- 墙体碰撞（与服务端一致的本地预测用） ---------------- */

  function angleInRangeClient(ang, a0, a1) {
    let d = ang - a0;
    while (d <= -Math.PI) d += TAU;
    while (d > Math.PI) d -= TAU;
    let span = a1 - a0;
    while (span <= -Math.PI) span += TAU;
    while (span > Math.PI) span -= TAU;
    return d >= 0 && d <= span;
  }

  function wallContact(w, x, y, r) {
    if (w.type === 'orect') {
      // 斜矩形（CA 拟合出来的带方向墙体）：局部坐标下做圆-盒分离
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
    const dist = Math.hypot(x - w.cx, y - w.cy);
    if (dist < 1e-6) return { x: w.cx + r, y: w.cy, nx: 1, ny: 0 };
    const ang = Math.atan2(y - w.cy, x - w.cx);
    if (!angleInRangeClient(ang, w.a0, w.a1)) return null;
    const band = w.t / 2 + r;
    const gap = dist - w.r;
    if (Math.abs(gap) > band) return null;
    const ux = (x - w.cx) / dist;
    const uy = (y - w.cy) / dist;
    // 与服务端 contactWall 的 arc 分支保持一致：法线指向撞来的一侧
    const sx = gap < 0 ? -1 : 1;
    const nx = ux * sx;
    const ny = uy * sx;
    const newDist = w.r + sx * band;
    return { x: w.cx + ux * newDist, y: w.cy + uy * newDist, nx, ny };
  }

  function collideWallsLocal(walls, x, y, r) {
    if (!walls || !walls.length) return { x, y };
    for (const w of walls) {
      const c = wallContact(w, x, y, r);
      if (c) {
        x = c.x;
        y = c.y;
      }
    }
    return { x, y };
  }

  function setupCanvas() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(ARENA_W * dpr);
    canvas.height = Math.round(ARENA_H * dpr);
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- DOM 记分牌 ---------------- */

  function cardKey() {
    if (!meta) return '';
    return (meta.players || [])
      .map((p) => {
        const hp = p._hp != null ? p._hp : p.hp;
        const alive = p._alive != null ? p._alive : p.alive;
        return [p.id, p.score, p.kills, hp, alive ? 1 : 0, p._shield || 0].join(':');
      })
      .join('|');
  }

  function renderScoreCards() {
    if (!scoreBox || !meta) return;
    const key = cardKey();
    if (key === lastCardKey) return;
    lastCardKey = key;
    scoreBox.innerHTML = '';
    for (const p of meta.players || []) {
      const hp = p._hp != null ? p._hp : p.hp;
      const alive = p._alive != null ? p._alive : p.alive;
      const card = document.createElement('div');
      card.className = 'blaster-score-card';
      if (p.id === meId) card.classList.add('is-me');
      if (!alive) card.classList.add('is-out');

      const dot = document.createElement('span');
      dot.className = 'blaster-dot';
      dot.style.background = p.color || '#888';
      card.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'blaster-card-name';
      name.textContent = p.name || '玩家';
      card.appendChild(name);

      const score = document.createElement('span');
      score.className = 'blaster-card-score';
      score.textContent =
        p.score + ' 分 · ' + p.kills + ' 淘汰 · ' + hp + ' 血';
      card.appendChild(score);

      // 护盾层数用道具同色徽标提示
      if (p._shield > 0) {
        const sh = document.createElement('span');
        sh.className = 'blaster-card-badge';
        sh.style.color = ITEM_STYLE.shield.color;
        sh.style.borderColor = hexAlpha(ITEM_STYLE.shield.color, 0.6);
        sh.textContent = ITEM_STYLE.shield.glyph + ' ×' + p._shield;
        card.appendChild(sh);
      }

      scoreBox.appendChild(card);
    }
  }

  /* ---------------- 状态文案 ---------------- */

  function tr(key, vars, fallback) {
    if (typeof trFn === 'function') {
      const v = trFn(key, vars);
      if (v && v !== key) return v;
    }
    return fallback;
  }

  function statusText() {
    if (!meta) return '—';
    const total = meta.matchGames || 5;
    const round = meta.roundIndex || 1;
    const nameOf = (id) => {
      const p = (meta.players || []).find((x) => x.id === id);
      return p ? p.name : '—';
    };
    const roundOf = (extraText, fallbackExtra) =>
      tr(
        'blaster.roundOf',
        { round, total, extra: extraText },
        '第 ' + round + '/' + total + ' 局 · ' + fallbackExtra
      );

    if (meta.over) {
      return meta.winnerId
        ? tr(
            'blaster.matchOver',
            { name: nameOf(meta.winnerId) },
            '系列赛结束，冠军：' + nameOf(meta.winnerId)
          )
        : tr('blaster.matchDraw', {}, '系列赛结束（同分平局）');
    }
    if (meta.phase === 'countdown') {
      const left = Math.max(0, Math.ceil(((meta.phaseEndsAt || 0) - Date.now()) / 1000));
      return roundOf(String(left || '…'), '准备 ' + (left || '…'));
    }
    if (meta.phase === 'roundOver') {
      const lr = meta.lastRound;
      const who =
        lr && lr.winnerId ? nameOf(lr.winnerId) + ' 存活（+3）' : '无人生还';
      return roundOf(who, who);
    }
    return roundOf(tr('blaster.roundPlaying', {}, '进行中'), '进行中');
  }

  function syncStatus() {
    if (!statusEl || !meta) return;
    const s = statusText();
    if (s !== lastStatus) {
      lastStatus = s;
      statusEl.textContent = s;
    }
  }

  /* ---------------- 绘制 ---------------- */

  function drawArena() {
    ctx.fillStyle = '#3b4252';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    ctx.fillStyle = '#151a24';
    ctx.fillRect(WALL, WALL, ARENA_W - WALL * 2, ARENA_H - WALL * 2);

    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    const step = 50;
    ctx.beginPath();
    for (let x = WALL + step; x < ARENA_W - WALL; x += step) {
      ctx.moveTo(x, WALL);
      ctx.lineTo(x, ARENA_H - WALL);
    }
    for (let y = WALL + step; y < ARENA_H - WALL; y += step) {
      ctx.moveTo(WALL, y);
      ctx.lineTo(ARENA_W - WALL, y);
    }
    ctx.stroke();
  }

  function drawPlayer(p, x, y, aim, hp, alive, isMe) {
    if (!alive) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = p.color || '#888';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_R * 0.7, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 5);
      ctx.lineTo(x + 5, y + 5);
      ctx.moveTo(x + 5, y - 5);
      ctx.lineTo(x - 5, y + 5);
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(aim);
    ctx.fillStyle = '#0e1118';
    ctx.fillRect(PLAYER_R - 3, -3.5, 17, 7);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, PLAYER_R, 0, TAU);
    ctx.fillStyle = p.color || '#888';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isMe ? '#ffffff' : 'rgba(255,255,255,0.6)';
    ctx.stroke();

    if (isMe) {
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_R + 6, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 护盾道具：青色能量环，一层一圈（可叠 2 层）
    const shield = p._shield || 0;
    for (let i = 0; i < shield; i++) {
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_R + 4 + i * 4, 0, TAU);
      ctx.strokeStyle = ITEM_STYLE.shield.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // 子弹变大：紫色外环提示
    if (p._bigMs > 0) {
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_R + 4 + shield * 4 + 4, 0, TAU);
      ctx.strokeStyle = hexAlpha(ITEM_STYLE.power.color, 0.7);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 蓄力指示环：按住左键时绕自身填充，进度代表子弹速度（满圈=上限）
    if (isMe && input.charge && meta && meta.phase === 'playing') {
      const ratio = clamp((Date.now() - chargeStart) / CHARGE_MAX_MS, 0, 1);
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_R + 11, -Math.PI / 2, -Math.PI / 2 + ratio * TAU);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    for (let i = 0; i < MAX_HP; i++) {
      const px = x - (MAX_HP - 1) * 5 + i * 10;
      const py = y - PLAYER_R - 11;
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, TAU);
      ctx.fillStyle = i < hp ? '#ffd166' : 'rgba(255,255,255,0.18)';
      ctx.fill();
    }

    ctx.font = '600 13px system-ui, -apple-system, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(p.name || '玩家', x, y + PLAYER_R + 16);
  }

  function drawOverlay() {
    if (!meta) return;
    let main = '';
    let sub = '';
    if (meta.over) {
      const w = (meta.players || []).find((p) => p.id === meta.winnerId);
      main = w
        ? tr('blaster.champion', { name: w.name }, w.name + ' 夺冠！')
        : tr('blaster.drawTitle', {}, '同分，平局');
      sub = tr('blaster.championSub', {}, '总积分榜见下方');
    } else if (meta.phase === 'countdown') {
      const left = Math.max(0, Math.ceil(((meta.phaseEndsAt || 0) - Date.now()) / 1000));
      main = left > 0 ? String(left) : 'GO!';
      sub = tr('blaster.countdownHint', {}, 'WASD 移动 · 鼠标瞄准 · 按住左键蓄力发射');
    } else if (meta.phase === 'roundOver') {
      const lr = meta.lastRound;
      if (lr && lr.winnerId) {
        const w = (meta.players || []).find((p) => p.id === lr.winnerId);
        const nm = w ? w.name : '—';
        main = tr('blaster.survivor', { name: nm }, nm + ' 存活到最后');
        sub = tr('blaster.survivorBonus', {}, '+3 分 · 下一局即将开始');
      } else {
        main = tr('blaster.mutualKill', {}, '同归于尽');
        sub = tr('blaster.mutualKillSub', {}, '本局无人得分');
      }
    } else {
      return;
    }
    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 16, 0.55)';
    ctx.fillRect(0, ARENA_H / 2 - 66, ARENA_W, 132);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 42px system-ui, -apple-system, "Microsoft YaHei", sans-serif';
    ctx.fillText(main, ARENA_W / 2, ARENA_H / 2 + 6);
    ctx.font = '500 16px system-ui, -apple-system, "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText(sub, ARENA_W / 2, ARENA_H / 2 + 40);
    ctx.restore();
  }

  /** 道具列表：优先用实时快照的紧凑数组，退回公开状态的完整对象 */
  function itemList() {
    const last = snaps.length ? snaps[snaps.length - 1] : null;
    if (last && last.its) return last.its;
    return ((meta && meta.items) || []).map((it) => [it.id, it.x, it.y, it.type]);
  }

  /** 地图道具：带呼吸光晕的圆形标记，颜色 + 符号区分类型 */
  function drawItems() {
    const list = itemList();
    if (!list.length) return;
    const t = Date.now() / 300;
    for (const it of list) {
      const id = it[0];
      const x = it[1];
      const y = it[2];
      const st = ITEM_STYLE[it[3]] || ITEM_STYLE.heal;
      const pulse = 1 + Math.sin(t + id * 0.9) * 0.07;
      const rr = ITEM_R * pulse;
      ctx.beginPath();
      ctx.arc(x, y, rr + 5, 0, TAU);
      ctx.fillStyle = hexAlpha(st.color, 0.16);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, TAU);
      ctx.fillStyle = '#111826';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = st.color;
      ctx.stroke();
      ctx.fillStyle = st.color;
      ctx.font = '700 13px system-ui, -apple-system, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(st.glyph, x, y + 1);
    }
    ctx.textBaseline = 'alphabetic';
  }

  function drawWalls() {
    const walls = (meta && meta.walls) || [];
    if (!ctx || !walls.length) return;
    for (const w of walls) {
      if (w.type === 'orect') {
        // 元胞自动机拟合出来的斜矩形墙：按 ang 旋转绘制（与碰撞用的局部坐标一致）
        ctx.save();
        ctx.translate(w.x, w.y);
        ctx.rotate(w.ang);
        ctx.fillStyle = '#4c566a';
        ctx.fillRect(-w.w / 2, -w.h / 2, w.w, w.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-w.w / 2 + 0.5, -w.h / 2 + 0.5, w.w - 1, w.h - 1);
        ctx.restore();
      } else if (w.type === 'rect') {
        ctx.fillStyle = '#4c566a';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        ctx.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
      } else {
        ctx.beginPath();
        ctx.arc(w.cx, w.cy, w.r, w.a0, w.a1);
        ctx.lineWidth = w.t;
        ctx.strokeStyle = '#4c566a';
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.lineWidth = 1;
      }
    }
  }

  function draw() {
    if (!ctx || !meta) return;
    drawArena();
    drawWalls();
    drawItems();

    const players = meta.players || [];
    const last = snaps.length ? snaps[snaps.length - 1] : null;
    const lag = last ? Math.min(MAX_BULLET_LAG, Date.now() - last.at) : 0;

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      let x;
      let y;
      let aim = p.aim || 0;
      if (p.id === meId && !isSpectator && selfPos) {
        x = selfPos.x;
        y = selfPos.y;
        aim = selfPos.aim;
      } else {
        const r = remote.get(p.id);
        if (r) {
          x = r.x;
          y = r.y;
          if (r.aim != null) aim = r.aim;
        } else {
          x = p.x;
          y = p.y;
        }
      }
      const hp = p._hp != null ? p._hp : p.hp;
      const alive = p._alive != null ? p._alive : p.alive;
      drawPlayer(p, x, y, aim, hp, alive, p.id === meId);
    }

    if (last && last.bs) {
      // 只在「对战」阶段按延迟外推子弹位置；倒计时/结算/系列赛结束阶段
      // 快照可能暂停推送，lag 会持续暴涨，外推会把子弹位置弹到很远再折叠回来，
      // 表现为「整个屏幕都在抖」。非 playing 阶段直接用快照原位置冻结渲染。
      const t = meta.phase === 'playing' ? lag / 1000 : 0;
      for (const b of last.bs) {
        const id = b[0];
        const x = b[1];
        const y = b[2];
        const vx = b[3];
        const vy = b[4];
        const oi = b[5];
        // 半径记在子弹自己身上：吃过「子弹变大」的那发会一直保持大号
        const r = b[6] ? BIG_BULLET_R : BULLET_R;
        const bx = fold(x + vx * t, WALL + r, ARENA_W - WALL - r);
        const by = fold(y + vy * t, WALL + r, ARENA_H - WALL - r);
        const owner = players[oi];
        ctx.beginPath();
        ctx.arc(bx, by, r + 3.5, 0, TAU);
        ctx.fillStyle = owner ? hexAlpha(owner.color, 0.28) : 'rgba(255,255,255,0.28)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, TAU);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = owner ? owner.color : '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        void id;
      }
    }

    drawAmmoHud(last, players);
    drawOverlay();
  }

  /**
   * 左下角 HUD：自己当前在场的子弹数 / 上限（上限会被「备弹扩容」道具抬高），
   * 以及生效中的道具增益（护盾 / 子弹变大 / 疾风）。
   * 子弹达到上限后再发射会挤掉最早的那颗，这里给出可视化反馈。
   */
  function drawAmmoHud(last, players) {
    if (!ctx || isSpectator || !meta || meta.over) return;
    if (meta.phase !== 'playing') return;
    const myIdx = players.findIndex((p) => p.id === meId);
    if (myIdx < 0) return;
    let used = 0;
    if (last && last.bs) {
      for (const b of last.bs) if (b[5] === myIdx) used++;
    }
    const row = last && last.ps ? last.ps[myIdx] : null;
    const max = MAX_BULLETS_PER_PLAYER + (row ? row[8] || 0 : 0);
    const full = used >= max;
    const x = 20;
    const y = ARENA_H - 26;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '600 14px system-ui, -apple-system, "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    const label = tr('blaster.ammoHud', { used, max }, '场上子弹 ' + used + '/' + max);
    ctx.fillText(label, x, y);
    // 子弹格：实心=在场，空心=空位；满格时高亮提示会顶掉最早的一颗
    const pipX = x + ctx.measureText(label).width + 12;
    for (let i = 0; i < max; i++) {
      ctx.beginPath();
      ctx.arc(pipX + i * 14, y, 4.5, 0, TAU);
      if (i < used) {
        ctx.fillStyle = full ? '#ffb454' : 'rgba(255,255,255,0.85)';
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.32)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // 生效中的增益：护盾 / 子弹变大 / 疾风
    const chips = [];
    const shield = row ? row[5] || 0 : 0;
    const bigMs = row ? row[6] || 0 : 0;
    const spdMs = row ? row[7] || 0 : 0;
    if (shield > 0) chips.push({ key: 'shield', color: ITEM_STYLE.shield.color, value: '×' + shield });
    if (bigMs > 0) {
      chips.push({ key: 'power', color: ITEM_STYLE.power.color, value: (bigMs / 1000).toFixed(0) + 's' });
    }
    if (spdMs > 0) {
      chips.push({ key: 'speed', color: ITEM_STYLE.speed.color, value: (spdMs / 1000).toFixed(0) + 's' });
    }
    if (chips.length) {
      ctx.font = '600 12px system-ui, -apple-system, "Microsoft YaHei", sans-serif';
      let cx = x;
      for (const c of chips) {
        const st = ITEM_STYLE[c.key];
        const text = tr('blaster.item.' + c.key, {}, c.key) + ' ' + c.value;
        const w = ctx.measureText(text).width + 18;
        ctx.beginPath();
        roundRect(cx, y - 34, w, 22, 11);
        ctx.fillStyle = hexAlpha(st.color, 0.16);
        ctx.fill();
        ctx.strokeStyle = hexAlpha(st.color, 0.75);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = st.color;
        ctx.fillText(st.glyph, cx + 9, y - 22);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(text, cx + 19, y - 22);
        cx += w + 8;
      }
    }
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexAlpha(hex, alpha) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return 'rgba(255,255,255,' + alpha + ')';
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /* ---------------- 主循环 ---------------- */

  function frame() {
    raf = requestAnimationFrame(frame);
    const now = Date.now();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!meta || !ctx) return;

    if (selfPos && selfPos.alive && !isSpectator && meta.phase === 'playing') {
      const mx = input.mx;
      const my = input.my;
      if (mx || my) {
        const len = Math.hypot(mx, my) || 1;
        // 吃到「疾风」道具时本地预测也要用加速后的速度，否则会和服务器互相拉扯
        const spd = selfEff.spdMs > 0 ? PLAYER_SPEED * SPEED_BOOST_MULT : PLAYER_SPEED;
        selfPos.x = clamp(
          selfPos.x + (mx / len) * spd * dt,
          WALL + PLAYER_R,
          ARENA_W - WALL - PLAYER_R
        );
        selfPos.y = clamp(
          selfPos.y + (my / len) * spd * dt,
          WALL + PLAYER_R,
          ARENA_H - WALL - PLAYER_R
        );
        const wr = collideWallsLocal(
          meta.walls,
          selfPos.x,
          selfPos.y,
          PLAYER_R
        );
        selfPos.x = wr.x;
        selfPos.y = wr.y;
      }
    }

    for (const r of remote.values()) {
      if (r.tx == null) continue;
      const k = Math.min(1, dt * SMOOTH);
      r.x += (r.tx - r.x) * k;
      r.y += (r.ty - r.y) * k;
    }

    syncStatus();
    draw();
  }

  function start() {
    if (active) return;
    active = true;
    bindInput();
    lastFrame = Date.now();
    if (!raf) raf = requestAnimationFrame(frame);
    if (!inputTimer) inputTimer = setInterval(sendInput, INPUT_HZ);
  }

  /**
   * 收起面板。注意：这里不清空按键状态——renderGame 每次都会先
   * hideAllGamePanels() 再 render()，若清键会导致切阶段时移动突然中断。
   */
  function stop() {
    active = false;
    unbindInput();
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (inputTimer) {
      clearInterval(inputTimer);
      inputTimer = 0;
    }
  }

  /* ---------------- 输入 ---------------- */

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

  function refreshMove() {
    input.mx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    input.my = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
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
      default:
        return;
    }
    if (evt.code === 'ArrowUp' || evt.code === 'ArrowDown') evt.preventDefault();
    refreshMove();
  }

  function onKeyUp(evt) {
    if (isTypingTarget(evt.target)) return;
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
    refreshMove();
  }

  /** 自己的参考位置：优先用本地预测，快照还没到时退回全量状态里的坐标 */
  function selfEntity() {
    if (selfPos) return selfPos;
    if (!meta || !meId) return null;
    return (meta.players || []).find((p) => p.id === meId) || null;
  }

  function onMouseMove(evt) {
    if (!active || isSpectator || !canvas) return;
    const s = selfEntity();
    if (!s) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const sx = ((evt.clientX - rect.left) / rect.width) * ARENA_W;
    const sy = ((evt.clientY - rect.top) / rect.height) * ARENA_H;
    input.aim = Math.atan2(sy - s.y, sx - s.x);
  }

  function onMouseDown(evt) {
    if (!active || isSpectator || !canvas) return;
    if (evt.button !== 0) return;
    input.charge = 1;
    chargeStart = Date.now();
    evt.preventDefault();
  }

  function onMouseUp(evt) {
    if (evt && evt.button !== undefined && evt.button !== 0) return;
    input.charge = 0;
  }

  function onBlur() {
    input.charge = 0;
    for (const k of Object.keys(keys)) delete keys[k];
    refreshMove();
  }

  function bindInput() {
    if (!canvas) return;
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('contextmenu', preventCtx);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  }

  function unbindInput() {
    if (!canvas) return;
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('contextmenu', preventCtx);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  }

  function preventCtx(evt) {
    evt.preventDefault();
  }

  function sendInput() {
    if (!active || !net || isSpectator || !meta || meta.over) return;
    if (panel && panel.hidden) return;
    if (typeof net.sendRt !== 'function') return;
    net.sendRt({
      mx: input.mx,
      my: input.my,
      aim: Math.round(input.aim * 1000) / 1000,
      charge: input.charge ? 1 : 0,
    });
  }

  /* ---------------- 对外 API ---------------- */

  function bindRt() {
    if (rtBound || !net || typeof net.on !== 'function') return;
    rtBound = true;
    net.on('game:rt', (snap) => {
      if (!active) return;
      applySnapshot(snap);
    });
  }

  function applySnapshot(snap) {
    if (!snap || !meta) return;
    snap.at = Date.now();
    snaps.push(snap);
    if (snaps.length > 8) snaps.shift();

    const players = meta.players || [];
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const row = snap.ps && snap.ps[i];
      if (!row) continue;
      const x = row[0];
      const y = row[1];
      const aim = row[2];
      const hp = row[3];
      const alive = row[4] === 1;
      p._hp = hp;
      p._alive = alive;
      // 道具状态：护盾层数 / 子弹变大剩余 ms / 疾风剩余 ms / 备弹扩容加成
      p._shield = row[5] || 0;
      p._bigMs = row[6] || 0;
      p._spdMs = row[7] || 0;
      p._ammo = row[8] || 0;
      if (p.id === meId && !isSpectator) {
        selfEff.shield = p._shield;
        selfEff.bigMs = p._bigMs;
        selfEff.spdMs = p._spdMs;
        selfEff.ammo = p._ammo;
        if (!selfPos) {
          selfPos = { x: x, y: y, aim: aim, alive: alive };
        } else {
          const d = Math.hypot(x - selfPos.x, y - selfPos.y);
          if (d > 70 || !alive) {
            selfPos.x = x;
            selfPos.y = y;
          } else {
            selfPos.x += (x - selfPos.x) * 0.28;
            selfPos.y += (y - selfPos.y) * 0.28;
          }
          selfPos.aim = aim;
          selfPos.alive = alive;
        }
      } else {
        let r = remote.get(p.id);
        if (!r) {
          r = { x: x, y: y };
          remote.set(p.id, r);
        } else if (Math.hypot(x - r.x, y - r.y) > 250) {
          // 新一局换位：直接落位，不要横穿场地滑过去
          r.x = x;
          r.y = y;
        }
        r.tx = x;
        r.ty = y;
        r.aim = aim;
      }
    }
    renderScoreCards();
  }

  function render(game, netObj, opts = {}) {
    net = netObj || net;
    meta = game;
    meId = opts.meId || null;
    isSpectator = Boolean(opts.isSpectator);
    if (typeof opts.t === 'function') trFn = opts.t;
    if (opts.title && titleEl) titleEl.textContent = opts.title;

    panel = document.getElementById('panel-blaster');
    canvas = document.getElementById('blaster-canvas');
    scoreBox = document.getElementById('blaster-scores');
    if (panel) {
      panel.hidden = false;
      titleEl = panel.querySelector('#game-title');
      statusEl = panel.querySelector('#game-status');
    }
    // 场地尺寸以服务端为准（地图可能调整），保证画布与模拟一致
    if (meta && meta.arena) {
      ARENA_W = meta.arena.w || ARENA_W;
      ARENA_H = meta.arena.h || ARENA_H;
    }
    // 场上子弹上限 / 道具参数同样以服务端为准
    if (meta && meta.consts) {
      if (meta.consts.maxBulletsPerPlayer) {
        MAX_BULLETS_PER_PLAYER = meta.consts.maxBulletsPerPlayer;
      }
      if (meta.consts.bigBulletR) BIG_BULLET_R = meta.consts.bigBulletR;
      if (meta.consts.itemR) ITEM_R = meta.consts.itemR;
      if (meta.consts.speedBoostMult) SPEED_BOOST_MULT = meta.consts.speedBoostMult;
    }
    if (
      canvas &&
      (!ctx ||
        canvas.width !== Math.round(ARENA_W * dpr) ||
        canvas.height !== Math.round(ARENA_H * dpr))
    ) {
      setupCanvas();
    }

    if (snaps.length && meta && meta.players) {
      // 面板重挂后补齐一次单位状态，避免首帧空白
      applySnapshot(snaps[snaps.length - 1]);
    }
    lastCardKey = '';
    renderScoreCards();
    lastStatus = '';
    syncStatus();
    bindRt();
    start();
    draw();
  }

  function hide() {
    stop();
    if (panel) panel.hidden = true;
  }

  function bindButtons(netObj) {
    if (netObj) net = netObj;
    bindRt();
  }

  window.addEventListener('resize', () => {
    if (!canvas) return;
    const next = Math.min(2, window.devicePixelRatio || 1);
    if (Math.abs(next - dpr) > 0.01) setupCanvas();
  });

  return { render, hide, applySnapshot, bindButtons };
})();
