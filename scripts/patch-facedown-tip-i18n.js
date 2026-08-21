const fs = require('fs');
for (const [f, tip] of [
  [
    'public/i18n/zh.json',
    '该格功能/建筑卡背面朝上；取得后仅获得者可见，建筑建造后公开',
  ],
  [
    'public/i18n/en.json',
    'Face-down on even slots; only the claimer sees it after taking; buildings reveal when built',
  ],
]) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.lasidao.faceDownTip = tip;
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
}
console.log('ok');
