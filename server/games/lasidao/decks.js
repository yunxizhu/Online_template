'use strict';

/** 资源类型 */
const RESOURCES = ['wood', 'stone', 'food', 'iron'];
const RESOURCE_LABELS = {
  wood: '木头',
  stone: '石头',
  food: '食物',
  iron: '铁矿',
};

const FUNC_TYPES = {
  breed: '繁殖村民',
  harvest: '丰收',
  remoteDice: '遥控骰子',
  exile: '驱逐',
  buildHouse: '建造房子',
  redraw: '重抽',
  banditRaid: '强盗来袭',
  expand: '扩建',
};

/** 中立强盗工人 ID（参与抵消与名次，但不领取收益） */
const NEUTRAL_WORKER_ID = '__neutral__';
const NEUTRAL_WORKER_NAME = '强盗';
const BANDIT_RAID_COUNT = 2;

const BUILD_TYPES = {
  produce: '资源建筑',
  score2: '记分建筑',
  exchange: '交易所',
  efficiency: '精炼装置',
};

let _uid = 1;
function nextId(prefix) {
  return `${prefix}_${_uid++}`;
}

function resetUid(n = 1) {
  _uid = n;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 资源板块：木/石/食各 10（丰/贫各 5），铁矿 5（仅 2/1） */
function buildResourceDeck() {
  const cards = [];
  for (const res of ['wood', 'stone', 'food']) {
    for (let i = 0; i < 3; i++) {
      cards.push({
        id: nextId('res'),
        kind: 'resource',
        resource: res,
        rich: true,
        large: 3,
        small: 2,
        label: `${RESOURCE_LABELS[res]}·丰`,
      });
    }
    for (let i = 0; i < 5; i++) {
      cards.push({
        id: nextId('res'),
        kind: 'resource',
        resource: res,
        rich: false,
        large: 2,
        small: 1,
        label: `${RESOURCE_LABELS[res]}·贫`,
      });
    }
  }
  for (let i = 0; i < 4; i++) {
    cards.push({
      id: nextId('res'),
      kind: 'resource',
      resource: 'iron',
      rich: false,
      large: 2,
      small: 1,
      label: '铁矿·贫',
    });
  }
  return shuffle(cards);
}

function makeFunc(type, extra = {}) {
  return {
    id: nextId('fn'),
    kind: 'function',
    funcType: type,
    label: FUNC_TYPES[type] || type,
    ...extra,
  };
}

/** 功能板块卡堆 */
function buildFunctionDeck() {
  const cards = [];
  for (let i = 0; i < 6; i++) cards.push(makeFunc('breed'));
  for (let i = 0; i < 2; i++) cards.push(makeFunc('harvest'));
  for (let i = 0; i < 2; i++) cards.push(makeFunc('remoteDice'));
  for (let i = 0; i < 1; i++) cards.push(makeFunc('exile'));
  for (let i = 0; i < 4; i++) cards.push(makeFunc('buildHouse'));
  for (let i = 0; i < 2; i++) cards.push(makeFunc('redraw'));
  for (let i = 0; i < 1; i++) cards.push(makeFunc('banditRaid'));
  for (let i = 0; i < 2; i++) cards.push(makeFunc('expand'));
  return shuffle(cards);
}

function makeProduceBuild(resource, rich) {
  return {
    id: nextId('bld'),
    kind: 'building',
    buildType: 'produce',
    resource,
    rich,
    label: `${RESOURCE_LABELS[resource]}建筑·${rich ? '富' : '贫'}`,
    cost: rich
      ? { wood: 4, stone: 4, iron: 1 }
      : { wood: 2, stone: 2 },
    produce: rich ? 2 : 1,
    score: 0,
    needsWorker: true,
    functionalOnly: false,
  };
}

function makeScore2() {
  return {
    id: nextId('bld'),
    kind: 'building',
    buildType: 'score2',
    label: '记分建筑(+2)',
    cost: { wood: 5, stone: 5, iron: 3 },
    produce: 0,
    score: 2,
    needsWorker: false,
    functionalOnly: true,
  };
}

function makeExchange() {
  return {
    id: nextId('bld'),
    kind: 'building',
    buildType: 'exchange',
    label: '交易所',
    cost: { wood: 2, stone: 2 },
    produce: 0,
    score: 0,
    needsWorker: false,
    functionalOnly: true,
  };
}

/** 每建成一座：从资源板块取资源后可指定 1 次「某资源 +1」（可叠同一资源） */
function makeEfficiency() {
  return {
    id: nextId('bld'),
    kind: 'building',
    buildType: 'efficiency',
    label: '精炼装置',
    cost: { wood: 2, stone: 2, iron: 1 },
    produce: 0,
    score: 0,
    needsWorker: false,
    functionalOnly: true,
  };
}

/** 建筑卡堆：木/石/食生产建筑 2富3贫；铁矿 1富2贫 */
function buildBuildingDeck() {
  const cards = [];
  for (const res of ['wood', 'stone', 'food']) {
    cards.push(makeProduceBuild(res, true));
    cards.push(makeProduceBuild(res, true));
    cards.push(makeProduceBuild(res, false));
    cards.push(makeProduceBuild(res, false));
    cards.push(makeProduceBuild(res, false));
  }
  cards.push(makeProduceBuild('iron', true));
  cards.push(makeProduceBuild('iron', false));
  cards.push(makeProduceBuild('iron', false));
  for (let i = 0; i < 5; i++) cards.push(makeScore2());
  for (let i = 0; i < 5; i++) cards.push(makeExchange());
  for (let i = 0; i < 4; i++) cards.push(makeEfficiency());
  return shuffle(cards);
}

module.exports = {
  RESOURCES,
  RESOURCE_LABELS,
  FUNC_TYPES,
  BUILD_TYPES,
  NEUTRAL_WORKER_ID,
  NEUTRAL_WORKER_NAME,
  BANDIT_RAID_COUNT,
  nextId,
  resetUid,
  shuffle,
  makeFunc,
  buildResourceDeck,
  buildFunctionDeck,
  buildBuildingDeck,
};
