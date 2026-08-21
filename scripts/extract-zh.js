'use strict';
const fs = require('fs');
const files = [
  'public/js/ui.js',
  'public/games/incan/ui.js',
  'public/games/gomoku/board.js',
];
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  const re = /(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g;
  const hits = new Set();
  let m;
  while ((m = re.exec(s))) {
    const t = m[2];
    if (/[\u4e00-\u9fff]/.test(t) && t.length < 120) hits.add(t);
  }
  console.log('===', f, hits.size);
  for (const x of [...hits].sort()) console.log(x);
}
