'use strict';
const fs = require('fs');
const zh = {
  produceSkip: '跳过',
  otherDice: '{name} 的投掷结果',
  otherDiceHint: '正在观看 {name} 的生产回合',
  otherAwaitingRoll: '等待 {name} 投掷…',
  waitingOtherRoll: '对方尚未投掷',
};
const en = {
  produceSkip: 'Skip',
  otherDice: "{name}'s roll",
  otherDiceHint: "Watching {name}'s produce turn",
  otherAwaitingRoll: 'Waiting for {name} to roll…',
  waitingOtherRoll: 'Not rolled yet',
};
for (const [f, extra] of [
  ['public/i18n/zh.json', zh],
  ['public/i18n/en.json', en],
]) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  Object.assign(j.lasidao, extra);
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
}
console.log('ok');
