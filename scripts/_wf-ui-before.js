'use strict';

/**
 * 生成一份「改前」的 ui.js 副本，专门用来出同地形对照图。
 *
 * 为什么不留旧版源码、而是每次现拼：断崖那段被整段换掉了，旧版在仓库里已经不存在；
 * 而「改前 / 改后」必须跑**同一张地形、同一个镜头**才有说服力。这里把旧代码原文
 * 内嵌，替换掉现状那一段，写到 docs/_wf-ui-before.js。改前那版是**真跑过的**代码
 * （就是玩家截图里那串「V」勾的来源），不是事后编的稻草人。
 *
 * 用法：node scripts/_wf-ui-before.js
 *   → docs/_wf-ui-before.js + docs/_wf-ui-before.meta.json
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'public/games/warfactory/ui.js');
const OUT_PATH = path.join(ROOT, 'docs/_wf-ui-before.js');

const SRC = fs.readFileSync(SRC_PATH, 'utf8');
const A = '    // 南向断崖：横段 + 台阶竖连接段 → 接成长链 → 拐角切 45°';
const B = '    // ③ 地形外缘';
const i0 = SRC.indexOf(A);
const i1 = SRC.indexOf(B);
if (i0 < 0 || i1 < 0) throw new Error('找不到断崖段锚点，源文件结构变了');

const OLD = `    // 南向断崖：横段 + 楼梯角改斜段（2×2 方台阶走 45°，不再画成直角折线）
    const cliffSegs = [];
    const cliffDiag = []; // [x0,y0,x1,y1]
    const cliffSkipH = new Uint8Array(gw * gh); // 被斜段替代的南向横边
    for (let r = Math.max(0, r0 - 1); r < Math.min(gh - 1, r1 + 1); r++) {
      for (let c = 0; c < gw - 1; c++) {
        const a = cliffSide(r, c, r + 1, c);
        const b = cliffSide(r, c + 1, r + 1, c + 1);
        if (a === b) continue;
        // 同一 2×2 里还有竖向崖 → 这是方台阶拐角，改画斜线
        const v0 = cliffSide(r, c, r, c + 1);
        const v1 = cliffSide(r + 1, c, r + 1, c + 1);
        if (!(v0 || v1)) continue;
        const x = c * CELL;
        const yBot = (r + 1) * CELL;
        const yTop = r * CELL;
        if (a && !b) {
          // 左下有南崖、右无：斜边连左下 → 右上
          cliffDiag.push(x, yBot, x + CELL, yTop);
          cliffSkipH[r * gw + c] = 1;
        } else if (!a && b) {
          cliffDiag.push(x + CELL, yBot, x, yTop);
          cliffSkipH[r * gw + c + 1] = 1;
        }
      }
    }
    for (let r = r0; r <= r1; r++) {
      const last = r + 1 >= gh;
      let c = 0;
      while (c < gw) {
        const here = last ? false : cliffSide(r, c, r + 1, c) && !cliffSkipH[r * gw + c];
        let c1 = c;
        while (c1 + 1 < gw) {
          const h2 = last ? false : cliffSide(r, c1 + 1, r + 1, c1 + 1) && !cliffSkipH[r * gw + c1 + 1];
          if (h2 !== here) break;
          c1++;
        }
        if (here) cliffSegs.push(c * CELL, (c1 - c + 1) * CELL, r * CELL + CELL);
        c = c1 + 1;
      }
    }
    const chainCliffSegments = (segs, diags) => {
      const list = [];
      for (let i = 0; i < segs.length; i += 3) list.push([segs[i], segs[i + 2], segs[i] + segs[i + 1], segs[i + 2]]);
      for (let i = 0; i < diags.length; i += 4) list.push([diags[i], diags[i + 1], diags[i + 2], diags[i + 3]]);
      const key = (x, y) => Math.round(x) + ':' + Math.round(y);
      const ends = list.map((s) => [key(s[0], s[1]), key(s[2], s[3])]);
      const touching = new Map();
      for (let i = 0; i < ends.length; i++) {
        for (const k of ends[i]) {
          let a = touching.get(k);
          if (!a) { a = []; touching.set(k, a); }
          a.push(i);
        }
      }
      const used = new Uint8Array(list.length);
      const far = (i, k) => (ends[i][0] === k ? ends[i][1] : ends[i][0]);
      const walk = (i, from) => {
        const out = [];
        let cur = i;
        let k = from;
        while (cur != null) {
          used[cur] = 1;
          const s = list[cur];
          if (ends[cur][0] === k) out.push(s[0], s[1], s[2], s[3]);
          else out.push(s[2], s[3], s[0], s[1]);
          k = far(cur, k);
          const cand = touching.get(k) || [];
          let next = null;
          for (let j = 0; j < cand.length; j++) if (!used[cand[j]]) { next = cand[j]; break; }
          cur = next;
        }
        return out;
      };
      const chains = [];
      for (let i = 0; i < list.length; i++) {
        if (used[i]) continue;
        const a = (touching.get(ends[i][0]) || []).length;
        const b = (touching.get(ends[i][1]) || []).length;
        if (a === 1 || b === 1) {
          const c = walk(i, a === 1 ? ends[i][0] : ends[i][1]);
          if (c.length >= 4) chains.push(c);
        }
      }
      for (let i = 0; i < list.length; i++) {
        if (used[i]) continue;
        const c = walk(i, ends[i][0]);
        if (c.length >= 4) chains.push(c);
      }
      return chains;
    };
    const cliffChains = chainCliffSegments(cliffSegs, cliffDiag);
    const strokeCliffs = (chains, yBias, col, w) => {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      for (let n = 0; n < chains.length; n++) {
        const c = chains[n];
        g.moveTo(c[0], c[1] + yBias);
        for (let i = 2; i < c.length; i += 2) g.lineTo(c[i], c[i + 1] + yBias);
      }
      g.stroke();
    };
    if (cliffChains.length) {
      strokeCliffs(cliffChains, -2.5, 'rgba(255,250,238,0.72)', 5);
      strokeCliffs(cliffChains, 0, C_CLIFF, 3);
    }
`;

const out = SRC.slice(0, i0) + OLD + SRC.slice(i1);
fs.writeFileSync(OUT_PATH, out);
fs.writeFileSync(
  OUT_PATH.replace(/\.js$/, '.meta.json'),
  JSON.stringify({ from: SRC_PATH, bytes: out.length, generatedAt: new Date().toISOString() }, null, 2)
);
console.log('已生成 ' + path.relative(ROOT, OUT_PATH) + '（' + out.length + ' 字节）');
