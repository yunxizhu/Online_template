'use strict';

/**
 * 车体 / 炮塔预览页体检：node scripts/warfactory-turret-preview-check.js
 * （需要 jsdom：NODE_PATH="C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules"）
 *
 * 用 jsdom 把 docs/warfactory-turret-preview.html 真跑一遍：
 * canvas 上下文换成 Proxy 记账，断言「每一格都真画了东西」，
 * 并且「炮塔转 180° 那一格画出来的点与 0° 那一格不同」——
 * 后者才证明炮塔是绕座圈转的，而不是画了个固定图形。
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'docs/warfactory-turret-preview.html'), 'utf8');
const uiSrc = fs.readFileSync(path.join(ROOT, 'public/games/warfactory/ui.js'), 'utf8');

let failed = 0;
function ok(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) failed += 1;
}

/** 记录所有绘制调用的伪 2D 上下文；每块画布一份，按它的 data-t/data-tier/data-a 归档 */
const buckets = new Map();

function makeCtx() {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'measureText') return () => ({ width: 40 });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
          return () => ({ addColorStop() {} });
        if (prop === 'getImageData') return () => ({ data: [] });
        if (prop === 'canvas') return { width: 132, height: 132 };
        return rec(prop);
      },
      set(_t, prop, v) {
        calls.push(['set:' + prop, v]);
        return true;
      },
    }
  );
}

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const win = dom.window;

// 每块 canvas 一个记账上下文：key 从元素自己的 data-* 读
// （canvas 是页面脚本拼出来的，静态 HTML 里搜不到，只能这么拿）
win.HTMLCanvasElement.prototype.getContext = function getCtx() {
  const key =
    this.getAttribute('data-t') + '|' + this.getAttribute('data-tier') + '|' + this.getAttribute('data-a');
  const c = makeCtx();
  buckets.set(key, c.__calls || (c.__calls = []));
  const calls = [];
  const proxied = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === '__calls') return calls;
        if (prop === 'measureText') return () => ({ width: 40 });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
          return () => ({ addColorStop() {} });
        if (prop === 'getImageData') return () => ({ data: [] });
        if (prop === 'canvas') return { width: 132, height: 132 };
        return (...args) => calls.push([prop, ...args]);
      },
      set(_t, prop, v) {
        calls.push(['set:' + prop, v]);
        return true;
      },
    }
  );
  buckets.set(key, calls);
  return proxied;
};

win.eval(uiSrc);
ok(typeof win.WarFactoryUi === 'object' && typeof win.WarFactoryUi.drawUnitParts === 'function',
  'ui.js 在页面里挂上了 WarFactoryUi（drawUnitParts 可用）');

// 执行页面自己的内联脚本
const inline = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
try {
  win.eval(inline);
  ok(true, '预览页内联脚本执行无异常');
  const cvs = win.document.querySelectorAll('canvas');
  ok(cvs.length === 6 * 3 * 7, `页面里插出了 ${cvs.length} 块画布（6 兵种 × 3 阶 × 7 个炮塔角）`);
  ok(buckets.size === 6 * 3 * 7, `每块画布都拿到了自己的记账上下文（${buckets.size} 份）`);
} catch (e) {
  ok(false, '预览页内联脚本执行异常：' + e.message);
}

// ① 每一格都画了东西
let empty = 0;
let total = 0;
for (const [, calls] of buckets) {
  const draws = calls.filter((c) => c[0] === 'fill' || c[0] === 'stroke' || c[0] === 'fillRect');
  total += draws.length;
  if (draws.length < 3) empty++;
}
ok(empty === 0, `每一格都真的画出了图形（空格 ${empty} 个，共 ${total} 次填充/描边）`);

// ② 炮塔层真的被旋转了：180° 那一格必须出现 rotate(±π)，0° 那一格是 rotate(0)
//    （ctx 是记账用的 Proxy，不会真的施加变换，所以只能从 rotate 调用本身断言 ——
//     这正是「炮塔绕座圈转」的直接证据：局部坐标两格相同，差的就是这一次 rotate）
let noRot = 0;
let zeroBad = 0;
let checked = 0;
for (const t of ['warrior', 'shield', 'ranger', 'burst', 'burn', 'laser']) {
  for (let tier = 1; tier <= 3; tier++) {
    const at180 = (buckets.get(t + '|' + tier + '|180') || []).filter((c) => c[0] === 'rotate');
    const at0 = (buckets.get(t + '|' + tier + '|0') || []).filter((c) => c[0] === 'rotate');
    checked++;
    if (!at180.some((r) => Math.abs(Math.abs(r[1]) - Math.PI) < 1e-6)) noRot++;
    if (!at0.length || !at0.every((r) => Math.abs(r[1]) < 1e-9)) zeroBad++;
  }
}
ok(noRot === 0, `180° 格都下了 rotate(±π) 把炮塔转过去（比对 ${checked} 组，缺失 ${noRot} 组）`);
ok(zeroBad === 0, `0° 格的 rotate 全是 0（炮塔与车体同向，异常 ${zeroBad} 组）`);

// ③ 车体层在两格里完全一致（= 车体没跟着炮塔转）
let bodyMoved = 0;
for (const t of ['ranger', 'burst', 'laser']) {
  const a0 = buckets.get(t + '|3|0') || [];
  const a180 = buckets.get(t + '|3|180') || [];
  // 车体层是每格的第一段（旋转之前），取前 60 条 moveTo/lineTo 比对
  const head = (cs) =>
    cs
      .filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')
      .slice(0, 60)
      .map((c) => c[1].toFixed(1) + ',' + c[2].toFixed(1))
      .join(';');
  if (!a0.length || !a180.length || head(a0) !== head(a180)) bodyMoved++;
}
ok(bodyMoved === 0, `车体层的画法与炮塔角无关（逐点相同，异常 ${bodyMoved} 个）`);

win.close();
console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
