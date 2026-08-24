'use strict';

/** 资源类型 */
const RESOURCES = ['wood', 'stone', 'food', 'iron'];
const RESOURCE_LABELS = {
  wood: '木头',
  stone: '石头',
  food: '小麦',
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
  expand: '扩容',
  robbery: '抢劫',
};

/** 中立强盗工人 ID（参与抵消与名次，但不领取收益） */
const NEUTRAL_WORKER_ID = '__neutral__';
const NEUTRAL_WORKER_NAME = '强盗';
const BANDIT_RAID_COUNT = 2;

const BUILD_TYPES = {
  produce: '资源建筑',
  score2: '宫殿',
  exchange: '集市',
  wishWell: '许愿井',
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
  for (const res of ['wood', 'stone','food']) {
    for (let i = 0; i < 4; i++) {
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
    for (let i = 0; i < 6; i++) {
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


  for (let i = 0; i < 6; i++) {
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
  for (let i = 0; i < 3; i++) cards.push(makeFunc('harvest'));
  for (let i = 0; i < 3; i++) cards.push(makeFunc('remoteDice'));
  for (let i = 0; i < 6; i++) cards.push(makeFunc('exile'));
  for (let i = 0; i < 3; i++) cards.push(makeFunc('redraw'));
  for (let i = 0; i < 6; i++) cards.push(makeFunc('banditRaid'));
  for (let i = 0; i < 3; i++) cards.push(makeFunc('expand'));
  for (let i = 0; i < 6; i++) cards.push(makeFunc('robbery'));
  return shuffle(cards);
}

/** 生产建筑造价：资源种类 × 富/贫（仅列出非 0 项） */
const PRODUCE_BUILD_COSTS = {
  wood: {
    rich: { wood: 2, stone: 5,food: 3, iron: 2 },
    poor: { stone: 3,food: 2, iron: 1 },
  },
  stone: {
    rich: { wood: 5, stone: 2,food: 3, iron: 2 },
    poor: { wood: 3,food: 2, iron: 1  },
  },
  food: {
    rich: { wood: 5, stone: 5, iron: 2 },
    poor: { wood: 2, stone: 2 , iron: 1 },
  },
  iron: {
    rich: { wood: 4, stone: 4,food: 3, iron: 2 },
    poor: { wood: 1, stone: 1,food: 2, iron: 2 },
  },
};

function makeProduceBuild(resource, rich) {
  const tier = rich ? 'rich' : 'poor';
  const byRes = PRODUCE_BUILD_COSTS[resource];
  const cost = byRes && byRes[tier];
  if (!cost) {
    throw new Error(`未知生产建筑造价: ${resource}/${tier}`);
  }
  return {
    id: nextId('bld'),
    kind: 'building',
    buildType: 'produce',
    resource,
    rich,
    label: `${RESOURCE_LABELS[resource]}建筑·${rich ? '富' : '贫'}`,
    cost: { ...cost },
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
    label: '宫殿(+3)',
    cost: { wood: 7, stone: 7 , food: 7, iron: 4 },
    produce: 0,
    score: 3,
    needsWorker: false,
    functionalOnly: true,
  };
}

function makeExchange() {
  return {
    id: nextId('bld'),
    kind: 'building',
    buildType: 'exchange',
    label: '集市',
    cost: { wood: 3, stone: 3 },
    produce: 0,
    score: 0,
    needsWorker: false,
    functionalOnly: true,
  };
}

/** 每建成一座：生产阶段结束后可选任意一种资源 +1 */
function makeWishWell() {
  return {
    id: nextId('bld'),
    kind: 'building',
    buildType: 'wishWell',
    label: '许愿井',
    cost: { wood: 2, stone: 2, food: 2, iron: 2 },
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
  cards.push(makeProduceBuild('iron', false));
  cards.push(makeProduceBuild('iron', false));
  cards.push(makeProduceBuild('iron', false));
  for (let i = 0; i < 5; i++) cards.push(makeScore2());
  for (let i = 0; i < 4; i++) cards.push(makeExchange());
  for (let i = 0; i < 4; i++) cards.push(makeWishWell());
  return shuffle(cards);
}

/** 常驻「建造房子」造价 */
const BUILD_HOUSE_COST = { wood: 3, stone: 3,  iron: 2 };

/** 常驻「繁殖村民」：小麦消耗 = 当前村民数 × 该系数 */
const BREED_FOOD_PER_VILLAGER = 1;

function breedFoodCost(villagers) {
  return Math.max(0, Math.floor(Number(villagers) || 0)) * BREED_FOOD_PER_VILLAGER;
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
  makeProduceBuild,
  PRODUCE_BUILD_COSTS,
  BUILD_HOUSE_COST,
  BREED_FOOD_PER_VILLAGER,
  breedFoodCost,
  buildResourceDeck,
  buildFunctionDeck,
  buildBuildingDeck,
};
