'use strict';

/**
 * 自定义地图仓库（地形编辑器产物的读写入口）。
 *
 * 地图文件放在项目根的 `maps/warfactory/*.json`，只由本模块负责读写 ——
 * 对局逻辑（server/games/warfactory/index.js）拿到的永远是**解析后的普通对象**，
 * 它不该知道文件在哪、也不该知道地形是怎么压成字符串的。
 *
 * 文件格式（version 1）：
 *   {
 *     format: 'warfactory-map', version: 1,
 *     name, players, createdAt, updatedAt,
 *     grid : { cols, rows, cell },
 *     terrain: '<游程压缩的地形串>',   // 见 encodeGrid / decodeGrid
 *     theme : { key, name, desc },
 *     buildings: [ { kind:'hq'|'factory'|'lab', owner, level?, x, y } ],
 *     units     : [ { owner, type, tier, x, y } ]
 *   }
 *
 * owner 一律用**座位下标**：玩家 0..n-1，中立建筑 −1。
 * （不用 socket id —— 那样地图换一局就废了。）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MAP_DIR = path.join(ROOT, 'maps', 'warfactory');
const MAP_EXT = '.json';
const FORMAT = 'warfactory-map';
const VERSION = 1;

/** 地形取值白名单（与 index.js 的 TT_* 对齐；3 号沼泽已废弃，读到就当平原） */
const TT_OK = [0, 2, 4];
const TT_PLAIN = 0;

function ensureDir() {
  try {
    fs.mkdirSync(MAP_DIR, { recursive: true });
  } catch (_) {
    /* 目录已存在 */
  }
}

/** 文件名只留 汉字/字母/数字/_- ；给不出就退回时间戳 */
function slugify(name) {
  const raw = String(name || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '');
  const kept = raw.replace(/[^\w一-龥-]/g, '');
  return (kept || 'map').slice(0, 40);
}

/** 防目录穿越：只允许纯文件名（含扩展名） */
function safeFileName(file) {
  const base = path.basename(String(file || ''));
  if (!base.endsWith(MAP_EXT)) return '';
  if (base !== String(file || '')) return ''; // 带了路径分隔符
  if (/[\\/:*?"<>|]/.test(base)) return '';
  return base;
}

/* ---------------- 地形串 ↔ 网格 ---------------- */

/**
 * 游程压缩：`<值>*<段长>` 用逗号分隔，单格就写一个字符。
 * 一整张 288×288 的图通常只有几千段 → 十几 KB，直接写进 JSON 也不肉痛。
 */
function encodeGrid(grid, rows, cols) {
  const out = [];
  let run = 1;
  for (let r = 0; r < rows; r++) {
    const row = grid && grid[r];
    for (let c = 0; c < cols; c++) {
      const v = row ? Number(row[c]) || 0 : 0;
      if (c > 0 || r > 0) {
        const pr = c > 0 ? r : r - 1;
        const pc = c > 0 ? c - 1 : cols - 1;
        const pv = grid[pr] ? Number(grid[pr][pc]) || 0 : 0;
        if (v === pv) {
          run += 1;
          continue;
        }
        out.push(run > 1 ? pv + '*' + run : String(pv));
        run = 1;
      }
    }
  }
  const lastR = rows - 1;
  const lastC = cols - 1;
  const lv = grid && grid[lastR] ? Number(grid[lastR][lastC]) || 0 : 0;
  out.push(run > 1 ? lv + '*' + run : String(lv));
  return out.join(',');
}

/**
 * 解回 [rows][cols] 的二维数组。缺的补平原、非法值也当平原 ——
 * 手写坏了一半的文件不该让整个服崩掉。
 */
function decodeGrid(str, rows, cols) {
  const grid = [];
  for (let r = 0; r < rows; r++) grid[r] = new Array(cols).fill(0);
  if (!str) return grid;
  const parts = String(str).split(',');
  let i = 0;
  for (const seg of parts) {
    const m = /^(-?\d+)(?:\*(\d+))?$/.exec(String(seg).trim());
    if (!m) continue;
    const v = Number(m[1]);
    const ok = TT_OK.indexOf(v) >= 0 ? v : 0;
    let n = Math.max(1, Math.min(Number(m[2]) || 1, rows * cols - i));
    while (n > 0 && i < rows * cols) {
      const r = (i / cols) | 0;
      grid[r][i % cols] = ok;
      i += 1;
      n -= 1;
    }
    if (i >= rows * cols) break;
  }
  return grid;
}

/* ---------------- 文件读写 ---------------- */

function readMap(file) {
  const name = safeFileName(file);
  if (!name) return null;
  let raw;
  try {
    raw = fs.readFileSync(path.join(MAP_DIR, name), 'utf8');
  } catch (_) {
    return null;
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (_) {
    return null;
  }
  if (!obj || obj.format !== FORMAT) return null;
  const rows = Number(obj.grid && obj.grid.rows) || 0;
  const cols = Number(obj.grid && obj.grid.cols) || 0;
  if (!(rows > 0) || !(cols > 0)) return null;
  return {
    file: name,
    name: String(obj.name || name.replace(MAP_EXT, '')),
    players: clampPlayers(obj.players),
    updatedAt: Number(obj.updatedAt) || 0,
    createdAt: Number(obj.createdAt) || 0,
    map: obj,
  };
}

/** 读出来直接就能塞进房间的那份（含解好的 grid） */
function loadMap(file) {
  const rec = readMap(file);
  if (!rec) return null;
  const m = rec.map;
  const rows = Number(m.grid.rows);
  const cols = Number(m.grid.cols);
  return {
    file: rec.file,
    name: rec.name,
    players: rec.players,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    grid: { rows, cols, cell: Number(m.grid.cell) || 40 },
    grid2: decodeGrid(m.terrain, rows, cols),
    theme:
      m.theme && m.theme.key
        ? {
            key: String(m.theme.key),
            name: String(m.theme.name || m.theme.key),
            desc: String(m.theme.desc || ''),
          }
        : { key: 'custom', name: '自定义地图', desc: '由地形编辑器制作' },
    buildings: Array.isArray(m.buildings) ? m.buildings : [],
    units: Array.isArray(m.units) ? m.units : [],
  };
}

/**
 * 存盘。`preferFile` 为空时按名字派生文件名；重名就往后加 -2 / -3 …
 * @param {string} [preferFile] 想存成哪个文件名；不合法 / 没给就按名字派生
 * @param {{ overwrite?: boolean }} [opts] overwrite = 允许覆盖同名文件（「改同一张图再存一次」）；
 *        默认不覆盖 —— 新图另起 xxx-2.json，别把别人的图盖掉
 * @returns {{ ok:boolean, file?:string, error?:string }}
 */
function writeMap(map, preferFile, opts) {
  ensureDir();
  const now = Date.now();
  const body = {
    format: FORMAT,
    version: VERSION,
    name: String((map && map.name) || '未命名地图').slice(0, 40),
    players: clampPlayers(map && map.players),
    createdAt: Number((map && map.createdAt) || now) || now,
    updatedAt: now,
    grid: map.grid,
    terrain: map.terrain,
    theme: map.theme || { key: 'custom', name: '自定义地图', desc: '由地形编辑器制作' },
    buildings: Array.isArray(map.buildings) ? map.buildings : [],
    units: Array.isArray(map.units) ? map.units : [],
  };
  let file = safeFileName(preferFile) || slugify(body.name) + MAP_EXT;
  const overwrite = Boolean(opts && opts.overwrite);
  if (!overwrite) {
    const base = file.slice(0, -MAP_EXT.length);
    let k = 1;
    while (k < 500 && fs.existsSync(path.join(MAP_DIR, file))) {
      file = base + '-' + ++k + MAP_EXT;
    }
  }
  const text = JSON.stringify(body);
  try {
    fs.writeFileSync(path.join(MAP_DIR, file), text, 'utf8');
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : '地图写入失败' };
  }
  // json 一并返回：客户端拿它触发浏览器下载（省得为了下载再把文件读一遍）
  return { ok: true, file, json: text };
}

function removeMap(file) {
  const name = safeFileName(file);
  if (!name) return { ok: false, error: '地图名不合法' };
  try {
    fs.unlinkSync(path.join(MAP_DIR, name));
    return { ok: true, file: name };
  } catch (err) {
    return { ok: false, error: err && err.code === 'ENOENT' ? '地图不存在' : '地图删除失败' };
  }
}

function listMaps() {
  ensureDir();
  let files = [];
  try {
    files = fs.readdirSync(MAP_DIR);
  } catch (_) {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(MAP_EXT)) continue;
    const rec = readMap(f);
    if (!rec) continue;
    let bytes = 0;
    try {
      bytes = fs.statSync(path.join(MAP_DIR, f)).size;
    } catch (_) {
      /* ignore */
    }
    out.push({
      file: rec.file,
      name: rec.name,
      players: rec.players,
      updatedAt: rec.updatedAt,
      bytes,
    });
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

/* ---------------- 预览缩略图（给战前选图面板用） ---------------- */

/**
 * 小方块里占多数的地形：山 / 水都是成片的，直接抓左上角那一格会把细墙漏掉，
 * 所以在块内棋盘式抽 9 个点投票（同票取中间那个 0 / 2 / 4）。
 */
function dominantCell(grid, r0, c0, step, rows, cols) {
  const cnt = [0, 0, 0, 0, 0];
  const hops = [0, 0.34, 0.67];
  for (const hr of hops) {
    for (const hc of hops) {
      const r = Math.min(rows - 1, r0 + Math.round(hr * Math.max(0, step - 1)));
      const c = Math.min(cols - 1, c0 + Math.round(hc * Math.max(0, step - 1)));
      const v = grid[r] ? Number(grid[r][c]) || 0 : 0;
      cnt[v >= 0 && v < cnt.length ? v : 0] += 1;
    }
  }
  let best = 0;
  for (let v = 4; v >= 0; v--) if (cnt[v] > cnt[best]) best = v;
  return TT_OK.includes(best) ? best : TT_PLAIN;
}

/**
 * 把一张地图降采样成极轻的下发形态 —— 客户端逐格 fillRect 就能画出来。
 * @returns {{rows:number, cols:number, step:number, data:string, pins:Array}|null}
 *          data 每格一个字符（'0' 平原 / '2' 山 / '4' 水）；pins 是建筑落点（已换算到缩略图格）。
 */
function thumbOf(mapObj, maxSide = 48) {
  const grid = mapObj && mapObj.grid2;
  const rows = Number(mapObj && mapObj.grid && mapObj.grid.rows) || (Array.isArray(grid) ? grid.length : 0);
  const cols = Number(mapObj && mapObj.grid && mapObj.grid.cols) || (Array.isArray(grid) && grid[0] ? grid[0].length : 0);
  if (!Array.isArray(grid) || !(rows > 0) || !(cols > 0)) return null;
  const step = Math.max(1, Math.ceil(Math.max(rows, cols) / maxSide));
  const tr = Math.max(1, Math.ceil(rows / step));
  const tc = Math.max(1, Math.ceil(cols / step));
  const out = [];
  for (let r = 0; r < tr; r++) {
    const r0 = Math.min(rows - 1, r * step);
    for (let c = 0; c < tc; c++) {
      out.push(dominantCell(grid, r0, Math.min(cols - 1, c * step), step, rows, cols));
    }
  }
  const pins = [];
  for (const b of (mapObj && mapObj.buildings) || []) {
    if (!b || (b.kind !== 'hq' && b.kind !== 'factory' && b.kind !== 'lab')) continue;
    const col = Number(b.col);
    const row = Number(b.row);
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
    pins.push([Math.min(tc - 1, Math.max(0, Math.round(col / step))), Math.min(tr - 1, Math.max(0, Math.round(row / step))), b.owner, b.kind]);
  }
  return { rows: tr, cols: tc, step, data: out.map(String).join(''), pins };
}

/**
 * 战前选图的目录：每张图带上缩略图 / 人数 / 主题名。
 * 比 listMaps 重（要解地形），只在打开战前面板时拉一次。
 */
function listMapsDetailed(maxSide) {
  ensureDir();
  let files = [];
  try {
    files = fs.readdirSync(MAP_DIR);
  } catch (_) {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(MAP_EXT)) continue;
    const loaded = loadMap(f);
    if (!loaded) continue;
    out.push({
      file: loaded.file,
      name: loaded.name,
      players: loaded.players,
      updatedAt: loaded.updatedAt,
      theme: loaded.theme ? { key: loaded.theme.key, name: loaded.theme.name } : null,
      size: { rows: loaded.grid.rows, cols: loaded.grid.cols },
      buildings: (loaded.buildings || []).length,
      units: (loaded.units || []).length,
      thumb: thumbOf(loaded, maxSide || 48),
    });
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

function clampPlayers(v) {
  return Math.max(2, Math.min(4, Math.round(Number(v) || 2)));
}

module.exports = {
  FORMAT,
  VERSION,
  MAP_DIR,
  ensureDir,
  slugify,
  safeFileName,
  encodeGrid,
  decodeGrid,
  listMaps,
  listMapsDetailed,
  thumbOf,
  readMap,
  loadMap,
  writeMap,
  removeMap,
};
