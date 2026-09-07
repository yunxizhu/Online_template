const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('Usage: node patch-welfare-house.js <path>'); process.exit(1); }
const obj = JSON.parse(fs.readFileSync(path, 'utf-8'));
function find(parent) {
  if (parent && typeof parent === 'object') {
    if ('funcHtml' in parent) return parent;
    for (const k of Object.keys(parent)) {
      const r = find(parent[k]);
      if (r) return r;
    }
  }
  return null;
}
const node = find(obj);
if (!node) { console.error('funcHtml not found'); process.exit(1); }
let html = node.funcHtml;
if (html.includes('func:welfareHouse')) { console.log('Already has welfareHouse in', path); process.exit(0); }
const afterShelter = '<dt data-las-card="func:shelter">收留（4）</dt><dd>建造阶段：免费获得 1 普通村民（不超过人口上限，不占用繁殖次数）。使用后立即生效。</dd>';
const entry = '<dt data-las-card="func:welfareHouse">福利房（3）</dt><dd>建造阶段：免费获得 1 间房子（不增加分数，仅 +2 人口上限）。</dd>';
if (html.includes(afterShelter)) {
  html = html.replace(afterShelter, afterShelter + entry);
} else {
  html = html.replace('</dl>', entry + '</dl>');
}
node.funcHtml = html;
fs.writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
console.log('Patched', path);
