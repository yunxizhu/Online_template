'use strict';
const fs = require('fs');
function merge(file, extra) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(j.lasidao, extra);
  if (extra.fx) {
    j.lasidao.fx = Object.assign({}, j.lasidao.fx || {}, extra.fx);
    delete extra.fx;
    Object.assign(j.lasidao, extra);
  }
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
}
merge('public/i18n/zh.json', {
  deckHint: '抽/弃',
  fx: { dealStart: '—— 摆放板块 ——' },
});
merge('public/i18n/en.json', {
  deckHint: 'draw/discard',
  fx: { dealStart: '—— Dealing tiles ——' },
});
console.log('i18n ok');
