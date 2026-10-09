'use strict';

/**
 * 断崖线几何探针：把 ui.js 里**真实的那段断崖取线代码**整段切出来，喂进合成网格跑。
 *
 * 为什么要切真代码而不是另写一份：另写一份只会证明「我写的能对」，证明不了
 * 线上那份对。切出来跑的是同一串字符，改坏了立刻能看见。
 *
 * 用法：node scripts/_wf-cliff-probe.js
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
// WF_UI_PATH：换一份 ui.js 来探（做「改前」对照：scripts/_wf-ui-before.js）
const SRC_PATH = process.env.WF_UI_PATH || path.join(ROOT, 'public/games/warfactory/ui.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');
console.log('源码：' + path.relative(ROOT, SRC_PATH));

// 锚点只认「南向断崖：」这个前缀 —— 改前改后两版的行首都是它，正文不同也能切对
const A = '    // 南向断崖：';
const B = '    // ③ 地形外缘';
const i0 = SRC.indexOf(A);
const i1 = SRC.indexOf(B);
if (i0 < 0 || i1 < 0 || i1 <= i0) throw new Error('切不出断崖段：锚点没对上（源文件结构变了？）');
const BLOCK = SRC.slice(i0, i1);

const makeRunner = () =>
  new Function('g', 'r0', 'r1', 'gh', 'gw', 'CELL', 'cliffSide', 'C_CLIFF', BLOCK + '\nreturn cliffChains;');

const CELL = 1; // 用「格」当单位，输出好读

/** 合成网格 → grid/heights → cliffSide（逐字照抄 ui.js 的口径） */
function scene(rows, cols, typeAt, hAt) {
  const grid = [];
  const heights = [];
  for (let r = 0; r < rows; r++) {
    const gr = [];
    const hr = [];
    for (let c = 0; c < cols; c++) {
      gr.push(typeAt(r, c));
      hr.push(hAt ? hAt(r, c) : 0);
    }
    grid.push(gr);
    heights.push(hr);
  }
  const gh = rows;
  const gw = cols;
  const at = (r, c) => (r < 0 || r >= gh || c < 0 || c >= gw ? -1 : grid[r][c]);
  const hLevel = (r, c) => (r < 0 || r >= gh || c < 0 || c >= gw ? 0 : heights[r][c]);
  const isRampCell = () => false;
  const heightCliff = 2;
  const cliffSide = (ra, ca, rb, cb) => {
    if (isRampCell(ra, ca) || isRampCell(rb, cb)) return false;
    const ta = at(ra, ca);
    const tb = at(rb, cb);
    const aSolid = ta === 2 || ta === 4;
    const bSolid = tb === 2 || tb === 4;
    if (aSolid !== bSolid) return true;
    if (aSolid) return false;
    return Math.abs(hLevel(ra, ca) - hLevel(rb, cb)) >= heightCliff;
  };
  return { grid, heights, gh, gw, cliffSide, at };
}

/** 把链画成 ASCII：'+' 端点、'.' 45° 斜段中点、以及线段走向标记 */
function render(s, chains) {
  const { gh, gw, at } = s;
  const W = 2; // 每个格点占 2 字符宽，斜线才摆得下
  const rows = gh + 1;
  const cols = (gw + 1) * W;
  const buf = [];
  for (let i = 0; i < rows; i++) buf.push(new Array(cols).fill(' '));
  const put = (r, c, ch) => {
    if (r < 0 || r >= rows || c < 0 || c >= gw + 1) return;
    buf[r][c * W] = ch;
  };
  // 先铺地形
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      const t = at(r, c);
      const ch = t === 2 ? '#' : t === 4 ? '~' : ' ';
      buf[r][c * W] = ch;
      buf[r][c * W + 1] = ch === ' ' ? ' ' : ch;
      buf[r + 1][c * W] = buf[r][c * W];
      buf[r + 1][c * W + 1] = buf[r][c * W + 1];
    }
  }
  let diag = 0;
  for (const ch of chains) {
    for (let i = 0; i < ch.length; i += 2) {
      const x = ch[i] / CELL;
      const y = ch[i + 1] / CELL;
      put(y, x, '+');
      if (i + 2 < ch.length) {
        const nx = ch[i + 2] / CELL;
        const ny = ch[i + 3] / CELL;
        if (nx !== x && ny !== y) {
          diag++;
          // 斜段中点落在 2×2 方格正中 → 画在「左格点右边那一列」上
          const my = (y + ny) / 2;
          const mx = (x + nx) / 2;
          const rr2 = Math.floor(my);
          const cc2 = Math.floor(mx) * W + 1;
          if (buf[rr2] && cc2 >= 0 && cc2 < cols) buf[rr2][cc2] = ny > y ? '\\' : '/';
        }
      }
    }
  }
  console.log(buf.map((r) => r.join('')).join('\n'));
  console.log(`  链数=${chains.length}  45°斜段=${diag}`);
}

function segStats(chains) {
  let h = 0;
  let v = 0;
  let d = 0;
  let maxD = 0;
  for (const ch of chains) {
    for (let i = 0; i < ch.length - 2; i += 2) {
      const dx = ch[i + 2] - ch[i];
      const dy = ch[i + 3] - ch[i + 1];
      if (dy === 0) h++;
      else if (dx === 0) v++;
      else {
        d++;
        maxD = Math.max(maxD, Math.hypot(dx, dy));
      }
    }
  }
  return { h, v, d, maxD };
}

function run(title, s, note) {
  console.log('\n' + '='.repeat(72));
  console.log(title + (note ? ' —— ' + note : ''));
  const calls = [];
  const g = {
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    lineCap: '',
    beginPath() {},
    moveTo(x, y) {
      calls.push(['M', x, y]);
    },
    lineTo(x, y) {
      calls.push(['L', x, y]);
    },
    stroke() {},
  };
  const chains = makeRunner()(g, 0, s.gh - 1, s.gh, s.gw, CELL, s.cliffSide, '#000');
  render(s, chains);
  const st = segStats(chains);
  console.log('  横段=' + st.h + '  竖段=' + st.v + '  斜段=' + st.d + '  最长斜段=' + st.maxD.toFixed(2) + ' 格');
  return chains;
}

/* ---------- 用例 ---------- */

// ① 纯竖墙：西侧平原、东侧山（一条笔直的山脊边）
run(
  '① 纯竖墙（山在 c>=12）',
  scene(14, 24, (r, c) => (c >= 12 ? 2 : 0)),
  '期望：竖墙本身不画线（脸不朝南），链数 0'
);

// ② 45° 台阶：high = (c + r >= 8)
{
  const s = scene(12, 14, () => 0, (r, c) => (c + r >= 8 ? 2 : 0));
  run('② 45° 台阶（层差 2，高地在右上）', s, '期望：一条干净的对角链，斜段全部 1 格');
}

// ③ 矩形高台：中间 4×5 台地比周围高 2 层
{
  const s = scene(12, 14, () => 0, (r, c) => (r >= 4 && r <= 8 && c >= 4 && c <= 9 ? 2 : 0));
  run('③ 矩形高台（层差 2）', s, '期望：南向横段 + 两个角各切一格斜线，没有多余的长竖线');
}

// ④ 山体矩形块（不可通行）
{
  const s = scene(14, 20, (r, c) => (r >= 4 && r <= 9 && c >= 6 && c <= 14 ? 2 : 0));
  run('④ 山体矩形块', s, '期望：南北两条横线 + 四角 1 格斜切，中段竖墙不画');
}

// ⑤ 台阶链（每级 3 格宽），模拟「一层层爬上去的坡地」
{
  const s = scene(16, 26, () => 0, (r, c) => {
    const step = Math.floor(c / 3);
    return c + r * 1.6 >= 10 ? Math.min(2, step + 1) : 0;
  });
  run('⑤ 混合台阶地', s, '期望：斜段只在真拐角出现，横段保持连续');
}
