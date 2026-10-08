/**
 * 生成「地图主题」对照页：docs/warfactory-themes-preview.html
 *
 * 每个主题各生成一张图，按小地图那套灰化配色（配色从 ui.js 源码里读，别写死）画出来，
 * 并标出实测的山 / 水覆盖率与水域块数 —— 调 data.js 的 themes 参数后跑一下就能直接看效果。
 *
 * 用法：node scripts/warfactory-themes-preview.js [每个主题的图数]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));
const T = wf.__test;
const { TT_MOUNTAIN, TT_WATER, TERR_CELL: CELL, ROAD_W, ROAD_GAP } = T.consts;
// ⚠️ 每对相邻玩家几条主路是**跟人数走的**（roadPerPair）：2 人局那条弦就是直径，
//    D_2 的镜像轴压在上面，奇数条会自重合成一条 → 强制偶数取 4 条。别写死 3。
//    同理每条路的宽度也不一样（roadHalfOf：正面最宽，侧 / 后两条窄一半）。
const PER_PAIR_NOTE = [2, 3, 4].map((n) => `${n} 人 ${T.roadPerPair(n)} 条`).join('、');

// 小地图配色从 ui.js 源码读（改色时这页自动跟着变）
const srcUi = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');
const pickColor = (name, fallback) => {
  const m = new RegExp('const ' + name + " = '(#[0-9a-fA-F]{6})'").exec(srcUi);
  return m ? m[1] : fallback;
};
const COLORS = {
  land: pickColor('MINI_LAND', '#e6e4de'),
  water: pickColor('MINI_WATER', '#9ea7ac'),
  mtn: pickColor('MINI_MTN', '#55555a'),
};

const PER = Number(process.argv[2] || 1);

/** 数同类型连通块（区分「汪洋」与「千湖」） */
function blobCount(grid, type) {
  const R = grid.length;
  const C = grid[0].length;
  const seen = new Uint8Array(R * C);
  let n = 0;
  let biggest = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const id = r * C + c;
      if (grid[r][c] !== type || seen[id]) continue;
      n++;
      const st = [id];
      seen[id] = 1;
      let sz = 0;
      while (st.length) {
        const cur = st.pop();
        sz++;
        const cr = (cur / C) | 0;
        const cc = cur % C;
        for (const p of [
          [cr - 1, cc],
          [cr + 1, cc],
          [cr, cc - 1],
          [cr, cc + 1],
        ]) {
          const ny = p[0];
          const nx = p[1];
          if (ny < 0 || ny >= R || nx < 0 || nx >= C) continue;
          const nid = ny * C + nx;
          if (seen[nid] || grid[ny][nx] !== type) continue;
          seen[nid] = 1;
          st.push(nid);
        }
      }
      if (sz > biggest) biggest = sz;
    }
  }
  return { n, biggest };
}

/** 全图**最小的一块地形**多少格（山、水分别算连通块）—— 「不要小山小湖」的体检项 */
function minBlobCells(grid) {
  const R = grid.length;
  const C = grid[0].length;
  const seen = new Uint8Array(R * C);
  const st = [];
  let min = Infinity;
  for (let r0 = 0; r0 < R; r0++) {
    for (let c0 = 0; c0 < C; c0++) {
      const i0 = r0 * C + c0;
      if (seen[i0] || !grid[r0][c0]) continue;
      const type = grid[r0][c0];
      seen[i0] = 1;
      st.length = 0;
      st.push(i0);
      let sz = 0;
      while (st.length) {
        const cur = st.pop();
        sz++;
        const cr = (cur / C) | 0;
        const cc = cur % C;
        const nb = [
          [cr - 1, cc],
          [cr + 1, cc],
          [cr, cc - 1],
          [cr, cc + 1],
        ];
        for (const p of nb) {
          const ny = p[0];
          const nx = p[1];
          if (ny < 0 || ny >= R || nx < 0 || nx >= C) continue;
          const nid = ny * C + nx;
          if (seen[nid] || grid[ny][nx] !== type) continue;
          seen[nid] = 1;
          st.push(nid);
        }
      }
      if (sz < min) min = sz;
    }
  }
  return min === Infinity ? 0 : min;
}

/** 压成一行字符串：0 平原 / 2 山 / 4 水（每格 1 字符，客户端按行列还原） */
function pack(grid) {
  let s = '';
  for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[0].length; c++) s += String(grid[r][c]);
  return s;
}

const themes = T.themes.map((t) => T.fillTheme(t));

/** 把主题的图元清单压成一行人话（预览页卡片底部显示，改 data.js 后自动跟着变） */
function shapeBrief(th) {
  const rng2 = (v) => (Array.isArray(v) ? `${v[0]}~${v.length > 1 ? v[1] : v[0]}` : String(v));
  return (th.shapes || [])
    .map((s) => {
      const kind = s.kind === 'wall' ? '长墙' : s.kind === 'ring' ? '环形山' : s.type === 'water' ? '湖' : '山块';
      const cnt = rng2(s.count);
      let dim;
      if (s.kind === 'wall') dim = `长 ${rng2(s.len)}·厚 ${rng2(s.thick)}·关口 ${rng2(s.gapW)}`;
      else if (s.kind === 'ring') dim = `半径 ${rng2(s.r)}·厚 ${rng2(s.thick)}·缺口 ${rng2(s.gap)}`;
      else dim = `${rng2(s.w)}×${rng2(s.h)} 格·方圆 ${s.round}`;
      return `${kind}×${cnt}(${dim})`;
    })
    .join(' · ');
}
let totalW = 0;
for (const t of themes) totalW += Math.max(0, t.weight || 0);

const cards = [];
for (const th of themes) {
  for (let i = 0; i < PER; i++) {
    const g = wf.createGameState({
      id: 'theme-preview-' + th.key + '-' + i,
      players: [
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ],
      theme: th.key,
    });
    const grid = g.terrain.grid;
    let mtn = 0;
    let wat = 0;
    let tot = 0;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[0].length; c++) {
        tot++;
        if (grid[r][c] === TT_MOUNTAIN) mtn++;
        else if (grid[r][c] === TT_WATER) wat++;
      }
    }
    const wb = blobCount(grid, TT_WATER);
    cards.push({
      key: th.key,
      name: th.name,
      desc: th.desc,
      weight: th.weight,
      weightPct: totalW ? Math.round((th.weight / totalW) * 100) : 0,
      maxBlocked: th.maxBlocked,
      // 主题预设的「山该占多少 / 水该占多少」（data.js 的 mix），用来对照实到
      presetMtn: th.mix.mountain * 100,
      presetWat: th.mix.water * 100,
      minBlob: minBlobCells(grid),
      shapes: shapeBrief(th),
      rows: g.terrain.rows,
      cols: g.terrain.cols,
      data: pack(grid),
      mtn: (mtn / tot) * 100,
      wat: (wat / tot) * 100,
      imp: ((mtn + wat) / tot) * 100,
      blobs: wb.n,
      biggest: wb.biggest,
      seed: i,
      // 进攻主路：相邻玩家之间的几条大道（像素坐标，画的时候再除以一格边长）。
      // 顺手带上 lane —— 每条路的宽度不一样，画线要按各自的 half 来。
      roads: (g.mainRoads || []).map((r) => ({
        from: r.from,
        to: r.to,
        lane: r.lane,
        half: T.roadHalfOf(T.roadPerPair((g.hqs || []).length), r.lane),
        pts: r.pts.filter((_, k) => k % 4 === 0).map((p) => [Math.round(p[0]), Math.round(p[1])]),
      })),
      hqs: g.hqs.map((h) => [Math.round(h.x), Math.round(h.y)]),
    });
  }
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>战争工厂 · 地图主题对照</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 28px 32px 48px;
    background: #f4efe4; color: #2f2a22;
    font: 14px/1.7 "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: 2px; }
  .sub { margin: 0 0 22px; color: #7a6a52; font-size: 13px; }
  .grid { display: flex; flex-wrap: wrap; gap: 20px; }
  .card {
    width: 468px; padding: 14px 16px 16px;
    background: #fffdf7; border: 1px solid rgba(90,74,52,.28); border-radius: 10px;
    box-shadow: 0 2px 10px rgba(80,64,40,.08);
  }
  .card h2 { margin: 0 0 2px; font-size: 17px; letter-spacing: 1px; }
  .card h2 .w {
    margin-left: 8px; padding: 1px 8px; border-radius: 999px;
    border: 1px solid rgba(120,96,62,.45); background: rgba(120,96,62,.1);
    font-size: 11px; font-weight: 600; color: #7a5c34;
  }
  .desc { margin: 0 0 10px; color: #6a5c46; font-size: 12.5px; }
  canvas { display: block; width: 100%; height: auto; border: 1px solid rgba(90,74,52,.3); border-radius: 4px; background: ${COLORS.land}; }
  .stats { margin-top: 9px; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: #4d4335; font-variant-numeric: tabular-nums; }
  .stats b { font-weight: 600; }
  .stats i { font-style: normal; margin-left: 5px; color: #9b8f7c; }
  .lg { margin-top: 8px; display: flex; gap: 14px; font-size: 11.5px; color: #6a5c46; }
  .lg i { display: inline-block; width: 11px; height: 11px; margin-right: 4px; vertical-align: -1px; border: 1px solid rgba(0,0,0,.15); }
  .params { margin-top: 7px; font-size: 11.5px; color: #8a7a5e; word-break: break-all; }
  .note { margin-top: 26px; font-size: 12.5px; color: #7a6a52; max-width: 960px; }
  code { background: rgba(90,74,52,.1); padding: 1px 5px; border-radius: 3px; }
</style>
</head>
<body>
<h1>战争工厂 · 地图主题对照</h1>
<p class="sub">
  共 ${themes.length} 个主题，每局按权重随机抽一个（见下面的「抽中概率」）。
  地形只在服务端生成，这里画的是成图后的样子，配色沿用小地图那套灰化配色。
</p>
<div class="grid" id="grid"></div>
<p class="note">
  地形用<b>几何图元</b>生成（不再是元胞自动机）：整片平原起步，按主题的 <code>shapes</code> 清单往上盖
  <code>wall</code> 笔直长墙（整数厚度、按间距开关口）、<code>blob</code> 矩形 / 圆角的山块与湖泊
  （<code>round</code> 控制方圆）、<code>ring</code> 环形山；位置随机但吸附到格距，走向只取正交 ——
  所以墙是直的、块是方的，像一张设计过的关卡图。
  每个主题都写着 <code>mix</code>：山该占全图多少、水该占多少 —— 生成器必须真的做出来，
  所以卡片上的「山体 / 水体」后面都跟着<b>预设值</b>可以对。
  调参入口： <code>server/games/warfactory/data.js</code> 的 <code>themes</code> 段，
  <code>maxBlocked</code> 是「山+水」合计覆盖率的硬上限（超了整块撤掉最后盖的图元，不会把形状啃歪），
  它由 <code>mix</code> 之和自动抬到「预设 + 5 个点」，不用手填。
  地形块有<b>最小面积</b>（图元 ≥ ${T.consts.SHAPE_MIN_AREA} 格，收尾再抹掉不足 ${T.consts.MIN_BLOB_CELLS} 格的碎块），
  所以卡片上「最小一块地形」应当恒 ≥ ${T.consts.MIN_BLOB_CELLS} —— 不会出现小山小湖。
  红带是<b>进攻主路</b>：每对相邻玩家之间强制预留若干条（正面 / 侧袭 / 绕后），条数跟着人数走 ——
  ${PER_PAIR_NOTE}（2 人局那条弦就是直径、D_2 的镜像轴压在上面，奇数条会自重合成一条，所以给 4 条）。
  正面那条净宽 ${ROAD_W} 格，侧 / 后两条窄一半，彼此间隔 ${ROAD_GAP} 格，参数在 <code>data.js</code> 的
  <code>roads</code> 段。两家中点还压着一枚<b>中场关口</b>（超椭圆山或水），正面那条路从关口里穿过、
  flanking 绕开 —— 所以总部和总部之间永远不是一条笔直大道。
  改完跑 <code>node scripts/warfactory-themes-preview.js</code> 刷新本页。
</p>
<script>
const CARDS = ${JSON.stringify(cards)};
const COLORS = ${JSON.stringify(COLORS)};
const grid = document.getElementById('grid');
const colOf = (v) => (v === 2 ? COLORS.mtn : v === 4 ? COLORS.water : COLORS.land);
for (const c of CARDS) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML =
    '<h2>' + c.name + '<span class="w">抽中 ' + c.weightPct + '%</span></h2>' +
    '<p class="desc">' + c.desc + '</p>' +
    '<canvas width="' + c.cols + '" height="' + c.rows + '"></canvas>' +
    '<div class="stats">' +
      '<span>山体 <b>' + c.mtn.toFixed(1) + '%</b><i>预设 ' + c.presetMtn.toFixed(0) + '%</i></span>' +
      '<span>水体 <b>' + c.wat.toFixed(1) + '%</b><i>预设 ' + c.presetWat.toFixed(0) + '%</i></span>' +
      '<span>不可通行 <b>' + c.imp.toFixed(1) + '%</b></span>' +
      '<span>水域块数 <b>' + c.blobs + '</b></span>' +
      '<span>最大一片 <b>' + c.biggest + '</b> 格</span>' +
      '<span>最小一块地形 <b>' + c.minBlob + '</b> 格</span>' +
    '</div>' +
    '<div class="lg">' +
      '<span><i style="background:' + COLORS.mtn + '"></i>山</span>' +
      '<span><i style="background:' + COLORS.water + '"></i>水</span>' +
      '<span><i style="background:' + COLORS.land + '"></i>平原</span>' +
      '<span><i style="background:rgba(196,72,52,.55)"></i>进攻主路 ×' + c.roads.length + '</span>' +
      '<span><i style="background:#c44834;border-radius:999px"></i>总部</span>' +
    '</div>' +
    '<div class="params">maxBlocked ' + c.maxBlocked + ' · ' + c.shapes +
      (c.seed > 0 ? ' · 第 ' + (c.seed + 1) + ' 张' : '') +
    '</div>';
  grid.appendChild(el);
  const cv = el.querySelector('canvas');
  const ctx = cv.getContext('2d');
  ctx.fillStyle = COLORS.land;
  ctx.fillRect(0, 0, c.cols, c.rows);
  for (let r = 0; r < c.rows; r++) {
    for (let col = 0; col < c.cols; col++) {
      const v = Number(c.data[r * c.cols + col]);
      if (v !== 2 && v !== 4) continue;
      ctx.fillStyle = colOf(v);
      ctx.fillRect(col, r, 1, 1);
    }
  }
  // 进攻主路：几条就是几条（跟着人数变），每条按**自己的**宽度画
  ctx.save();
  ctx.strokeStyle = 'rgba(196,72,52,.55)';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const rd of c.roads || []) {
    ctx.lineWidth = rd.half * 2;
    ctx.beginPath();
    rd.pts.forEach((p, k) => {
      const x = p[0] / ${CELL};
      const y = p[1] / ${CELL};
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.restore();
  // 总部
  ctx.fillStyle = '#c44834';
  for (const h of c.hqs || []) {
    ctx.beginPath();
    ctx.arc(h[0] / ${CELL}, h[1] / ${CELL}, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = 1.5;
  for (const h of c.hqs || []) {
    ctx.beginPath();
    ctx.arc(h[0] / ${CELL}, h[1] / ${CELL}, 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}
</script>
</body>
</html>
`;

const out = path.join(ROOT, 'docs/warfactory-themes-preview.html');
fs.writeFileSync(out, html);
console.log('wrote docs/warfactory-themes-preview.html (' + (html.length / 1024).toFixed(1) + ' KB)');
console.log(themes.map((t) => t.name).join(' / '));
