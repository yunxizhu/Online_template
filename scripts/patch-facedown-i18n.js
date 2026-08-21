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
  'lasidao.faceDown': '暗置',
  'lasidao.faceDownHint': '背面',
  'lasidao.faceDownTip': '该格功能/建筑卡背面朝上，取得后才会翻开',
};
const en = {
  'lasidao.faceDown': 'Hidden',
  'lasidao.faceDownHint': 'Face down',
  'lasidao.faceDownTip': 'Face-down function/building tile; revealed when claimed',
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
