const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('Usage: node patch-shelter.js <path>'); process.exit(1); }
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
// Insert shelter after recruit
const afterRecruit = '<dt data-las-card="func:recruit">征召（5）</dt><dd>建造阶段：下一轮生产阶段临时村民 +2，可参与投骰与派遣；该生产阶段结束后消失。</dd>';
const shelterEntry = '<dt data-las-card="func:shelter">收留（4）</dt><dd>建造阶段：免费获得 1 普通村民（不超过人口上限，不占用繁殖次数）。使用后立即生效。</dd>';
if (!html.includes('func:shelter')) {
  if (html.includes(afterRecruit)) {
    html = html.replace(afterRecruit, afterRecruit + shelterEntry);
  } else {
    html = html.replace('</dl>', shelterEntry + '</dl>');
  }
  node.funcHtml = html;
  fs.writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  console.log('Patched', path);
} else {
  console.log('Already has shelter in', path);
}
