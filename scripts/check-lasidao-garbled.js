'use strict';
const fs = require('fs');
require('./fix-lasidao-ui-i18n.js');

function findGarbled(path) {
  const s = fs.readFileSync(path, 'utf8');
  const lines = s.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    // user-visible: assignment to textContent/title/innerHTML with ???
    if (/textContent|title|innerHTML|placeholder|setBanner/.test(lines[i]) && /\?{2,}/.test(lines[i])) {
      hits.push((i + 1) + ': ' + lines[i].trim().slice(0, 120));
    }
  }
  return hits;
}

console.log('ui visible garbled:', findGarbled('public/games/lasidao/ui.js'));
console.log('fx visible garbled:', findGarbled('public/games/lasidao/fx.js'));
const z = JSON.parse(fs.readFileSync('public/i18n/zh.json', 'utf8'));
console.log('has res/fx/tip', !!z.lasidao.res, !!z.lasidao.fx, !!z.lasidao.tip);
