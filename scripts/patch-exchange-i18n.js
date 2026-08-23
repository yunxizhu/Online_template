'use strict';
const fs = require('fs');
function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
const zh = {
  'lasidao.exchangeBtn': '兑换',
  'lasidao.exchangeBtnN': '兑换（{n}换1）',
  'lasidao.exchangeHint':
    '已建 {count} 座交易所：任意相同 {n} 个资源 → 任意 1 个（无限次，无需工人）',
  'lasidao.exchangeHintDefault':
    '默认银行：任意相同 {n} 个资源 → 任意 1 个（无限次，无需工人）',
  'lasidao.exchangeCardTip':
    '无需工人；任意时间将相同资源换成任意 1 个（默认银行 4:1，每建 1 座交易所比例提升 1 级）',
  'lasidao.exchangeFrom': '换出',
  'lasidao.exchangeTo': '换入',
  'lasidao.cancel': '取消',
};
const en = {
  'lasidao.exchangeBtn': 'Trade',
  'lasidao.exchangeBtnN': 'Trade ({n}→1)',
  'lasidao.exchangeHint':
    '{count} exchange(s): {n} identical resources → any 1 (unlimited, no workers)',
  'lasidao.exchangeHintDefault':
    'Default bank: {n} identical resources → any 1 (unlimited, no workers)',
  'lasidao.exchangeCardTip':
    'No workers; anytime trade identical resources for any 1 (default bank 4:1, +1 tier per built exchange)',
  'lasidao.exchangeFrom': 'Give',
  'lasidao.exchangeTo': 'Get',
  'lasidao.cancel': 'Cancel',
};
for (const [file, extra] of [
  ['public/i18n/zh.json', zh],
  ['public/i18n/en.json', en],
]) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(extra)) setPath(j, k, v);
  fs.writeFileSync(file, JSON.stringify(j, null, 2), 'utf8');
}
console.log('i18n ok');
