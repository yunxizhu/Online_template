const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('Usage: node patch.js <path>'); process.exit(1); }
const obj = JSON.parse(fs.readFileSync(path, 'utf-8'));
function findKey(o, key) {
  if (o && typeof o === 'object') {
    if (key in o) return o;
    for (const k of Object.keys(o)) {
      const r = findKey(o[k], key);
      if (r) return r;
    }
  }
  return null;
}
const parent = findKey(obj, 'buildHtml');
if (!parent) { console.error('buildHtml not found'); process.exit(1); }
let html = parent.buildHtml;
html = html.replace(/<dt data-las-card="build:eternalThrone">.*?<\/dd>/, '');
parent.buildHtml = html;
fs.writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
console.log('Patched', path);
