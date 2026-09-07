const fs = require('fs');
const path = process.argv[2];
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

// Remove freeExpand entry
html = html.replace(/<dt data-las-card="func:freeExpand">[^<]+<\/dt><dd>[^<]+<\/dd>/, '');

// Update welfareHouse description
const oldWf = '<dt data-las-card="func:welfareHouse">福利房（3）</dt><dd>建造阶段：获得 1 间免费房子（可繁殖村民，但不加分）。</dd>';
const newWf = '<dt data-las-card="func:welfareHouse">福利房（3）</dt><dd>建造阶段：免费获得 1 间房子（不增加分数，仅 +2 人口上限）。</dd>';
if (html.includes(oldWf)) {
  html = html.replace(oldWf, newWf);
} else if (html.includes('func:welfareHouse')) {
  // fallback: replace span inside dd
  html = html.replace(/(<dt data-las-card="func:welfareHouse">[^<]+<\/dt><dd>)[^<]+(<\/dd>)/, '$1建造阶段：免费获得 1 间房子（不增加分数，仅 +2 人口上限）。$2');
}

node.funcHtml = html;
fs.writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
console.log('Updated', path);
