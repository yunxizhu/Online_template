'use strict';

/**
 * 用**真实 ui.js** 渲染一整张地图（不是另写画法），用来肉眼对照玩家看到的地形。
 * 用法：node scripts/_wf-map-view.js [players] [roomId] [themeKey] [k] [cx] [cy]
 *   cx/cy 为世界像素坐标（省略 = 自动挑「边界最密」的位置）
 * 产物：docs/_wf-map-view.html → 无头 Chrome 截图
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// ⚠️ 必须先冻结 Date.now 再 require/建局：`createGameState` 里
//    · 布局 rng = `Date.now() ^ 0x5f356495`（出生角 / 隔离带 / 总部 / 中立厂全跟着它）
//    · 地形 seedSalt = `room.mapSeed || Date.now()`
//    不冻结的话每次运行都是另一张图，「改前 / 改后」两张图对不上（连主题都可能换）。
//    冻结之后：同参数 ⇒ 逐格相同的地形与布局，才谈得上逐像素对比。
const FIXED_NOW = Number(process.env.WF_NOW || 1791539239263);
Date.now = () => FIXED_NOW;

const wf = require(path.join(ROOT, 'server/games/warfactory/index.js'));

const N = Math.max(2, Math.min(4, Number(process.argv[2]) || 2));
const roomId = process.argv[3] || 'mapview';
const themeArg = process.argv[4] || '';
const K = Number(process.argv[5]) || 0.34;

const g = wf.createGameState({
  id: roomId,
  players: Array.from({ length: N }, (_, i) => ({ id: 'p' + i, name: 'P' + i })),
  ...(themeArg ? { theme: themeArg } : {}),
});
const pub = wf.publicGameState(g);
const snap = wf.snapshot(g);
const T = g.terrain;
// WF_UI_PATH：换一份 ui.js 来渲染（做「改前 / 改后」对照图时用，见 scripts/_wf-cliff-ah.js）
const SRC_UI = fs.readFileSync(process.env.WF_UI_PATH || path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');
const panelHtml = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/panel.html'), 'utf8');

// 自动挑镜头：找「地形边界最密」的位置（那里最能暴露形状问题）
let CX = Number(process.argv[6]) || 0;
let CY = Number(process.argv[7]) || 0;
if (!CX || !CY) {
  const R = T.rows, C = T.cols;
  const WIN = 40;
  let best = { s: -1, x: 5760, y: 5760 };
  for (let r = WIN + 1; r + WIN < R; r += 5) {
    for (let c = WIN + 1; c + WIN < C; c += 5) {
      let e = 0;
      for (let dr = -WIN; dr <= WIN; dr += 2) {
        for (let dc = -WIN; dc <= WIN; dc += 2) {
          const v = T.grid[r + dr][c + dc];
          if (v !== T.grid[r + dr - 1][c + dc]) e++;
          if (v !== T.grid[r + dr][c + dc - 1]) e++;
        }
      }
      if (e > best.s) best = { s: e, x: Math.round((c + 0.5) * T.cell), y: Math.round((r + 0.5) * T.cell) };
    }
  }
  CX = best.x;
  CY = best.y;
}
console.log(`room=${roomId} N=${N} theme=${T.theme.key}(${T.theme.name}) 镜头 ${CX},${CY} k=${K}`);
const VIEW_W = 1280, VIEW_H = 800;
const CAMS = { auto: { x: Math.round(CX - VIEW_W / K / 2), y: Math.round(CY - VIEW_H / K / 2), k: K } };

const meta = { consts: pub.consts, terrain: pub.terrain, phase: 'playing', players: pub.players, you: 'p0', world: pub.world };
const panelBody = panelHtml.replace(/<!--[\s\S]*?-->/g, '');

const OUT_HTML = process.env.WF_HTML || '_wf-map-view.html';
fs.writeFileSync(
  path.join(ROOT, 'docs', OUT_HTML),
  `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>地图视图</title>
<style>
  html,body{margin:0;background:#ded3b8;font:13px "Microsoft YaHei",system-ui,sans-serif;color:#2a2620}
  #panel-warfactory{position:static !important}
  #panel-warfactory .warfactory-wrap{position:relative;width:${VIEW_W}px;height:${VIEW_H}px;margin:0}
  #warfactory-canvas{position:absolute;left:0;top:0;width:${VIEW_W}px;height:${VIEW_H}px;display:block;border:1px solid #b0a488;background:#ece3cd}
  .hud{display:none}
</style></head><body>
${panelBody}
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
  if (Ui.debug) Ui.debug.setCam(window.__WF_CAMS__.auto.x, window.__WF_CAMS__.auto.y, window.__WF_CAMS__.auto.k);
  window.__WF_READY__ = true;
})();
</script>
</body></html>`
);
console.log('已生成 docs/_wf-map-view.html');
