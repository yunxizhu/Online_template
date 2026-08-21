'use strict';
const fs = require('fs');
for (const [f, msg] of [
  ['public/i18n/zh.json', '第{n}回合解锁'],
  ['public/i18n/en.json', 'Unlocks R{n}'],
]) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.lasidao.unlockRound = msg;
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
}
console.log('ok');
