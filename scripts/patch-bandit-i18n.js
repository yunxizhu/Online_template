'use strict';
const fs = require('fs');

const zhExtra = {
  'lasidao.neutralName': '强盗',
  'lasidao.confirmBandit': '放置中立骰子',
  'lasidao.confirmUse': '确认发动',
  'lasidao.func.breed': '消耗等同当前村民数的食物，村民 +1（上限 10）',
  'lasidao.func.harvest': '获得任意 2 个资源（各 1）',
  'lasidao.func.remoteDice': '投掷前使用：可指定任意点数派遣',
  'lasidao.func.exile': '驱逐目标玩家在某数字格的 1 名村民',
  'lasidao.func.buildHouse': '支付 4木 3石 2铁，+1 分',
  'lasidao.func.redraw': '从功能或建筑牌堆重抽 1 张',
  'lasidao.func.banditRaid':
    '任意时间、无消耗：在任意板块的任意数字格放置 2 枚中立骰子；参与抵消并占用名次，不领取收益',
};

const enExtra = {
  'lasidao.neutralName': 'Bandits',
  'lasidao.confirmBandit': 'Place neutral dice',
  'lasidao.confirmUse': 'Confirm',
  'lasidao.func.breed': 'Pay food equal to villager count; +1 villager (max 10)',
  'lasidao.func.harvest': 'Gain any 2 resources (1 each)',
  'lasidao.func.remoteDice': 'Before rolling: dispatch with any faces',
  'lasidao.func.exile': 'Remove 1 villager of a player from a number slot',
  'lasidao.func.buildHouse': 'Pay 4 wood 3 stone 2 iron; +1 score',
  'lasidao.func.redraw': 'Redraw 1 card from function or building deck',
  'lasidao.func.banditRaid':
    'Anytime, free: place 2 neutral dice on any board number slot; they cancel ties and occupy rank, but claim nothing',
};

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

for (const [file, extra] of [
  ['public/i18n/zh.json', zhExtra],
  ['public/i18n/en.json', enExtra],
]) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(extra)) setPath(j, k, v);
  fs.writeFileSync(file, JSON.stringify(j, null, 2), 'utf8');
}
console.log('i18n ok');
