'use strict';

/**
 * 生成「建筑占位 + 分层配色 + 坡道渐变」预览页：docs/warfactory-lane-preview.html
 *
 * 用真实的 public/games/warfactory/ui.js + panel.html 画一张真实对局
 * （不是另写一套画法），于是这张图就是玩家会看到的画面。用来肉眼确认三件事：
 *   ① 建筑占位圈是否清楚（哪儿能走一目了然）
 *   ② 每个高度层是不是一个色（高一级低一级读得出来）
 *   ③ 坡是不是「连通两层的渐变」+ 明显的边线
 *
 * 用法：node scripts/warfactory-lane-preview.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));
const outPath = path.join(ROOT, 'docs', 'warfactory-lane-preview.html');
const SRC_UI = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');

const g = wf.createGameState({
  id: 'lane-preview',
  players: [
    { id: 'p0', name: '甲' },
    { id: 'p1', name: '乙' },
    { id: 'p2', name: '丙' },
    { id: 'p3', name: '丁' },
  ],
});
const pub = wf.publicGameState(g);
const snap = wf.snapshot(g);
const panelHtml = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');

// 相机对准 0 号总部：那儿有总部 + 门口 2 厂 + 后方研究所，是「建筑挤在一起」最典型的地方。
// 取总部与它门口两厂的中点，让三者同时入镜。
const hq = g.hqs[0];
const door = g.factories.filter((f) => Math.hypot(f.x - hq.x, f.y - hq.y) < pub.consts.hqAtkRange);
const mid = door.length
  ? {
      x: door.reduce((s, f) => s + f.x, hq.x) / (door.length + 1),
      y: door.reduce((s, f) => s + f.y, hq.y) / (door.length + 1),
    }
  : { x: hq.x, y: hq.y };
// 两个镜头：建筑群特写（看清占位圈）/ 全景（看清分层配色与坡道渐变）
const CELL_PX = pub.terrain.cell || 40;
const CAMS = {
  // 特写：k=2.4 ⇒ 视野约 533×333，正好把「总部 + 门口两厂 + 后方研究所」这一小簇装满；
  // 视口中心往上让 60px，避开左上角的「科技点」浮层。
  close: { x: Math.round(mid.x - 640 / 2.4), y: Math.round(mid.y - 340 / 2.4), k: 2.4 },
  // 中景：对准**全场山最多的一块**（找坡道格最密的视野中心），k=0.55 ⇒ 视野约 1160×727，
  // 正好一屏能同时看到台地分层、坡道渐变与断崖线三种画法。
  wide: (() => {
    // 在离总部 1500~3500px 的环带上找坡道最密的位置（那里必有山又有坡）
    let best = null;
    for (let ang = 0; ang < Math.PI * 2; ang += Math.PI / 24) {
      for (const rad of [2000, 2600, 3200]) {
        const x = Math.round(5760 + Math.cos(ang) * rad);
        const y = Math.round(5760 + Math.sin(ang) * rad);
        const c = Math.floor(x / CELL_PX);
        const r = Math.floor(y / CELL_PX);
        if (r < 4 || r >= pub.terrain.rows - 4 || c < 4 || c >= pub.terrain.cols - 4) continue;
        let ramps = 0;
        let mtn = 0;
        for (let dr = -8; dr <= 8; dr++) {
          for (let dc = -8; dc <= 8; dc++) {
            const i = (r + dr) * pub.terrain.cols + (c + dc);
            if (pub.terrain.ramps && pub.terrain.ramps[i] === 1) ramps++;
            if (pub.terrain.data[i] === 2) mtn++;
          }
        }
        const score = ramps * 3 + mtn;
        if (ramps >= 6 && (!best || score > best.score)) best = { x, y, score };
      }
    }
    const p = best || { x: 5760, y: 5760 };
    const K = 0.55;
    return { x: Math.round(p.x - 640 / K), y: Math.round(p.y - 400 / K), k: K };
  })(),
};

const meta = {
  consts: pub.consts,
  terrain: pub.terrain,
  phase: 'playing',
  players: pub.players,
  you: 'p0',
  world: pub.world,
};

// panel.html 里有模板注释；预览只需要结构，样式由本页接管
const panelBody = panelHtml.replace(/<!--[\s\S]*?-->/g, '');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>战争工厂 · 建筑占位 / 分层配色 / 坡道渐变 预览</title>
<style>
  html, body { margin: 0; background: #ded3b8; }
  body { font: 13px/1.7 "Microsoft YaHei", system-ui, sans-serif; color: #2a2620; }
  h1 { font-size: 16px; margin: 14px 18px 2px; font-weight: 700; }
  .sub { margin: 0 18px 10px; color: #5a5248; }
  #panel-warfactory { position: static !important; }
  #panel-warfactory .warfactory-wrap { position: relative; width: 1280px; height: 800px; margin: 0 18px; }
  #warfactory-canvas { position: absolute; left: 0; top: 0; width: 1280px; height: 800px; display: block;
                       border: 1px solid #b0a488; background: #ece3cd; }
  ul { margin: 10px 18px 24px; padding-left: 22px; color: #4a4238; }
  code { background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 3px; }
</style>
</head>
<body>
<h1>建筑占位 · 高度分层 · 坡道渐变（真实 ui.js 渲染）</h1>
<p class="sub">相机对准 0 号总部与它门口的两座初级厂 —— 「建筑挤在一起」最典型的地方。</p>
${panelBody}
<ul>
  <li><b>虚线圈</b> = 寻路占位范围（碰撞半径 + navMargin ${pub.consts.navMargin}px），与服务端寻路掩码 <code>passGrid</code> 同口径</li>
  <li><b>内圈实线</b> = 建筑本体碰撞外缘；两圈之间那条余量就是寻路外扩</li>
  <li><b>地面颜色</b> = 高度层，暖 = 高 / 冷 = 低，每层一个纯色（0 层是纸色）</li>
  <li><b>坡道</b> = 连通上下两层的线性渐变 + 明显暖色描边；<b>断崖</b> = 深色主线 + 浅色崖唇</li>
</ul>
<script>
window.__WF_META__ = ${JSON.stringify(meta)};
window.__WF_PUB__ = ${JSON.stringify(pub)};
window.__WF_SNAP__ = ${JSON.stringify(snap)};
window.__WF_CAMS__ = ${JSON.stringify(CAMS)};
Object.defineProperty(window, 'devicePixelRatio', { get: function () { return 1; } });
</script>
<script>
${SRC_UI.replace(/<\/script/gi, '<\\/script')}
</script>
<script>
(function () {
  var Ui = window.WarFactoryUi;
  Ui.render(window.__WF_META__, { send: function () {} }, { meId: 'p0', spectator: false, t: function () { return Date.now(); } });
  Ui.applySnapshot(window.__WF_SNAP__);
  // 相机推到总部群身上（debug.setCam 是 ui.js 专为此给的调试出口）
  var which = (location.hash || '#close').slice(1);
  var cam = window.__WF_CAMS__[which] || window.__WF_CAMS__.close;
  if (Ui.debug) Ui.debug.setCam(cam.x, cam.y, cam.k);
  window.__WF_READY__ = true;
})();
</script>
</body>
</html>
`;

fs.writeFileSync(outPath, html);
console.log('已生成 ' + path.relative(ROOT, outPath));
console.log(
  `总部 @ ${Math.round(hq.x)},${Math.round(hq.y)} · 门口厂 ${door.length} 座 · navMargin ${pub.consts.navMargin}px`
);
console.log('  镜头：close（建筑群特写）/ wide（全景，看分层与坡道）— 用 #wide 打开全景');
