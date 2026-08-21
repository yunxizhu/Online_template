'use strict';
const fs = require('fs');

const zhExtra = {
  res: { wood: '木头', stone: '石头', food: '食物', iron: '铁矿' },
  tip: {
    unknown: '未知',
    rich: '富裕',
    poor: '贫瘠',
    richPoor: '丰度：',
    largeSmall: '大份 {large} / 小份 {small}',
    boardSlot: '场上格 {n}',
    boardSlotUnset: '场上格 —',
    cost: '造价：',
    produceEffect: '工人生产 {amt}（{rich}）',
    score2Effect: '记分建筑 +{score} 分',
    scoreEffect: '分数 +{score}',
    produceAmt: '产出 {amt}',
    buildingGeneric: '建筑卡',
    exchangeShort: '交易所',
  },
  dieGroupTitle: '点数 {face} × {count}，点击选择',
  discardFunc: '弃置·{label}',
  funcFormTitle: '发动：{label}',
  confirmHarvest: '确认丰收',
  redrawFunction: '重抽功能卡',
  redrawBuilding: '重抽建筑卡',
  confirmExile: '确认驱逐',
  playerStats: '{score}分 · 村民{villagers} · 资源{res} · 功能{func} · 建筑{build}',
  statusPlayerPhase: '{name} · {phase}',
  statusYourTurn: '轮到你了',
  statusWait: '请等待',
  fx: {
    workerChip: '{name}×{count}',
    slotFocus: '结算 {area}区 {number} 号格',
    slotCancel: '{area}{number}：相同数量抵消',
    cancelMark: '抵消',
    slotWinner: '{name} 以 {count} 名领先',
    winMark: '胜',
    slotNobody: '{area}{number}：无人取得',
    gainRes: '{name} 取得{share} +{amount}',
    largeShare: '大份',
    smallShare: '小份',
    claimCards: '{name} 取得{kind}卡',
    noWorkers: '本轮无人派遣，跳过结算动画',
    start: '—— 开始结算 ——',
    buildingProduce: '个人建筑产出',
    mvp: '{name} 本轮收获最多（{gained}），村民 +1',
  },
};

const enExtra = {
  res: { wood: 'Wood', stone: 'Stone', food: 'Food', iron: 'Iron' },
  tip: {
    unknown: 'Unknown',
    rich: 'Rich',
    poor: 'Poor',
    richPoor: 'Yield: ',
    largeSmall: 'Large {large} / Small {small}',
    boardSlot: 'Board slot {n}',
    boardSlotUnset: 'Board slot —',
    cost: 'Cost: ',
    produceEffect: 'Workers produce {amt} ({rich})',
    score2Effect: 'Score building +{score}',
    scoreEffect: 'Score +{score}',
    produceAmt: 'Produce {amt}',
    buildingGeneric: 'Building',
    exchangeShort: 'Exchange',
  },
  dieGroupTitle: 'Face {face} × {count} — click to select',
  discardFunc: 'Discard · {label}',
  funcFormTitle: 'Use: {label}',
  confirmHarvest: 'Confirm harvest',
  redrawFunction: 'Redraw function',
  redrawBuilding: 'Redraw building',
  confirmExile: 'Confirm exile',
  playerStats:
    '{score} pts · V{villagers} · R{res} · F{func} · B{build}',
  statusPlayerPhase: '{name} · {phase}',
  statusYourTurn: 'Your turn',
  statusWait: 'Please wait',
  fx: {
    workerChip: '{name}×{count}',
    slotFocus: 'Resolve {area} slot {number}',
    slotCancel: '{area}{number}: equal counts cancel',
    cancelMark: 'X',
    slotWinner: '{name} leads with {count}',
    winMark: 'Win',
    slotNobody: '{area}{number}: nobody claims',
    gainRes: '{name} takes {share} +{amount}',
    largeShare: 'large share',
    smallShare: 'small share',
    claimCards: '{name} claims {kind} cards',
    noWorkers: 'No workers this round — skip settle FX',
    start: '—— Settling ——',
    buildingProduce: 'Personal building produce',
    mvp: '{name} gained the most ({gained}); +1 villager',
  },
};

function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!a[k] || typeof a[k] !== 'object') a[k] = {};
      deepMerge(a[k], v);
    } else {
      a[k] = v;
    }
  }
  return a;
}

for (const [file, extra] of [
  ['public/i18n/zh.json', zhExtra],
  ['public/i18n/en.json', enExtra],
]) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  deepMerge(j.lasidao, extra);
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
}

// Fix leftover comment mojibake in ui.js (cosmetic)
let ui = fs.readFileSync('public/games/lasidao/ui.js', 'utf8');
ui = ui.replace(
  /\/\*\*\r?\n \* \?+\? UI\r?\n \* [^\n]*\r?\n \*\//,
  `/**
 * 拉斯岛 UI
 * 骰子：投掷动画 → 定格 → 同点聚合 → 选点/选格 → 确认派遣
 */`
);
ui = ui.replace(
  /\/\/ \?+[\r\n]/g,
  (m) => (m.includes('遥控') ? m : '')
);
// Keep functional comments; just replace known garbled comment lines
ui = ui.replace(
  /  \/\/ \?+\r?\n  return defaultResLabels\(\);/,
  `  // 优先客户端语言包
  return defaultResLabels();`
);
ui = ui.replace(
  /  \/\*\* \?+ \*\/\r?\n  let selectedWildCount/,
  `  /** 遥控骰子已选枚数 */
  let selectedWildCount`
);
ui = ui.replace(
  /  \/\*\* \?+ \*\/\r?\n  let diceAnim/,
  `  /** 骰子动画状态 */
  let diceAnim`
);
fs.writeFileSync('public/games/lasidao/ui.js', ui);

console.log('i18n + comment fix ok');
