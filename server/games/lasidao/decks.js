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
  expand: '扩建',
  freeExpand: '免费扩建',
  welfareHouse: '福利房',
  caravan: '商队来临',
  robbery: '抢劫',
  enhance: '强化',
  recruit: '征召',
};

/** 中立强盗工人 ID（参与抵消与名次，但不领取收益） */
const NEUTRAL_WORKER_ID = '__neutral__';
const NEUTRAL_WORKER_NAME = '强盗';
const BANDIT_RAID_COUNT = 2;

const BUILD_TYPES = {
  produce: '资源建筑',
  score2: '宫殿',
  score1: '学堂',
  exchange: '集市',
  wishWell: '许愿井',
  eternalThrone: '永恒王座',
  mixer: '打料机',
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

/** 资源板块：木/石/食各 12（丰4/贫8），铁矿 贫6 */
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
    for (let i = 0; i < 8; i++) {
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

/** 功能板块卡堆（未洗，供合堆组装） */
function buildFunctionDeckRaw() {
  const cards = [];
  for (let i = 0; i < 5; i++) cards.push(makeFunc('harvest')); // 丰收
  for (let i = 0; i < 2; i++) cards.push(makeFunc('remoteDice')); // 遥控骰子
  for (let i = 0; i < 5; i++) cards.push(makeFunc('exile')); // 驱逐
  for (let i = 0; i < 3; i++) cards.push(makeFunc('redraw')); // 重抽
  for (let i = 0; i < 5; i++) cards.push(makeFunc('banditRaid')); // 强盗来袭
  for (let i = 0; i < 5; i++) cards.push(makeFunc('robbery')); // 抢劫
  for (let i = 0; i < 3; i++) cards.push(makeFunc('freeExpand')); // 免费扩建
  for (let i = 0; i < 3; i++) cards.push(makeFunc('welfareHouse')); // 福利房
  for (let i = 0; i < 2; i++) cards.push(makeFunc('caravan')); // 商队来临
  for (let i = 0; i < 2; i++) cards.push(makeFunc('enhance')); // 强化
  for (let i = 0; i < 5; i++) cards.push(makeFunc('recruit')); // 征召
  return cards;
}

/** 功能板块卡堆 */
function buildFunctionDeck() {
  return shuffle(buildFunctionDeckRaw());
}

/** 生产建筑造价：资源种类 × 富/贫（仅列出非 0 项） */
const PRODUCE_BUILD_COSTS = {
  wood: {
    rich: { stone: 2,food: 3, iron: 2 },
    poor: { stone: 1, iron: 1 },
  },
  stone: {
    rich: { wood: 2, food: 3, iron: 2 },
    poor: { wood: 1, iron: 1  },
  },
  food: {
    rich: { wood: 3, stone: 3, iron: 1 },
    poor: { wood: 1, stone: 1  },
  },
  iron: {
    rich: { wood: 4, stone: 4,food: 3, iron: 2 },
    poor: { wood: 1, stone: 1, iron: 1 },
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
    label: '宫殿(+2)',
    cost: { wood: 3, stone: 3 , food: 3, iron: 2 },
    produce: 0,
    score: 2,
    needsWorker: false,
    functionalOnly: true,
  };
}

function makeScore1() {
  return {
    id: nextId('bld'),
    kind: 'building',
    buildType: 'score1',
    label: '学堂(+1)',
    cost: { wood: 1, stone: 1, food: 1, iron: 1 },
    produce: 0,
    score: 1,
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
    cost: { wood: 1, stone: 1 , food: 1},
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
    cost: { wood: 1, stone: 1, food: 1, iron: 1 },
    produce: 0,
    score: 0,
    needsWorker: false,
    functionalOnly: true,
  };
}

/** 允许使用不同资源按兑换比例兑换 */
function makeMixer() {
  return {
    id: nextId('bld'),
    kind: 'building',
    buildType: 'mixer',
    label: '打料机',
    cost: { wood: 1, stone: 1, iron: 2 },
    img: 'jianzhuka_daliaoji.png',
    produce: 0,
    score: 0,
    needsWorker: false,
    functionalOnly: true,
  };
}

/** 每个建造回合结束时获得 1 胜利点 */
function makeEternalThrone() {
  return {
    id: nextId('bld'),
    kind: 'building',
    buildType: 'eternalThrone',
    label: '永恒王座',
    cost: { wood: 5, stone: 5, food: 5, iron: 5 },
    produce: 0,
    score: 0,
    needsWorker: false,
    functionalOnly: true,
  };
}

/** 建筑卡堆：木/石/食生产建筑 2富3贫；铁矿 0富3贫（未洗，供合堆组装） */
function buildBuildingDeckRaw() {
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
  for (let i = 0; i < 4; i++) cards.push(makeScore2());
  for (let i = 0; i < 5; i++) cards.push(makeScore1());
  for (let i = 0; i < 5; i++) cards.push(makeExchange());
  for (let i = 0; i < 3; i++) cards.push(makeWishWell());
  for (let i = 0; i < 2; i++) cards.push(makeMixer());
  for (let i = 0; i < 2; i++) cards.push(makeEternalThrone());
  return cards;
}

/** 建筑卡堆 */
function buildBuildingDeck() {
  return shuffle(buildBuildingDeckRaw());
}

/** 功能+建筑混洗合堆 */
function buildSpecialDeck() {
  return shuffle(buildFunctionDeckRaw().concat(buildBuildingDeckRaw()));
}

/**
 * 事件牌目录（共 15 张）
 * trigger: dispatch=派遣时 / settle=结算抵消后
 * setup: 上场初始化
 */
const ENVIRONMENT_CATALOG = [
  {
    envType: 'prisonersDilemma',
    label: '囚徒困境',
    trigger: 'settle',
    setup: 'neutral2',
    desc: '上场在本格放置 2 枚中立骰。结算抵消后：骰子最少的玩家（可并列，可为 0）各弃 n 张资源卡，n=第一名骰子数；该弃牌在个人产出（含许愿井）后、建造前进行',
  },
  {
    envType: 'barrenHarvest',
    label: '颗粒无收',
    trigger: 'dispatch',
    setup: 'marker',
    desc: '成为本格最大者时可放置标记（首次亦触发；继续加码不重复）。标记格结算无收获',
  },
  {
    envType: 'resistBarbarians',
    label: '抵抗南蛮',
    trigger: 'settle',
    desc: '生产结算（抵消并发资源）后、弃牌前：本格仍有至少 2 个骰子的玩家按名次从第一名起各获得 1 胜利点；有人达到 15 分则立刻结束游戏',
  },
  {
    envType: 'clearSky',
    label: '晴空万里',
    trigger: 'dispatch',
    desc: '派遣时：派遣者任选获得 1 个资源（每次派遣触发一次，与数量无关）',
  },
  {
    envType: 'enterFray',
    label: '以身入局',
    trigger: 'dispatch',
    setup: 'neutral3',
    desc: '上场时在本格放置 3 枚中立骰。派遣时可将本格 1 枚中立骰移到任意板块数字格（无中立骰则不可发动）',
  },
  {
    envType: 'oneMountain',
    label: '一山不容二虎',
    trigger: 'settle',
    desc: '结算抵消后：第二名不获得本格小份资源，第一名额外获得小份',
  },
  {
    envType: 'luckyDraw',
    label: '幸运一抽',
    trigger: 'settle',
    setup: 'sideCard',
    desc: '上场时将功能/建筑合堆顶 1 张暗置在旁。结算抵消后，第一名获得该暗置牌',
  },
  {
    envType: 'fishermanProfit',
    label: '渔翁得利',
    trigger: 'settle',
    dispatchAlso: true,
    desc: '派遣：成为本格最大者时（首次亦触发；继续加码不重复），任选获得 2 个资源（可重复）。结算：第三名额外获得前两名在本格所得资源之和',
  },
  {
    envType: 'firstCome',
    label: '先到先得',
    trigger: 'dispatch',
    setup: 'stashResources',
    desc: '第 1–4/5–8/9+ 轮奖励档为每种资源各 1/2/3 张；玩家在本格放置满 2/4/6 个村民时获得一档（每玩家每事件仅一次）',
  },
  {
    envType: 'welfareMinimum',
    label: '低保户',
    trigger: 'setup',
    setup: 'lowestScoreTwo',
    desc: '出现时：当前分数最低的玩家各任选 2 个资源（可并列、可重复）',
  },
  {
    envType: 'recall',
    label: '召回',
    trigger: 'dispatch',
    desc: '派遣时：可将场上（含本格）你自己的 1 枚骰子收回到手中',
  },
  {
    envType: 'weiQiRescueZhao',
    label: '围魏救赵',
    trigger: 'dispatch',
    setup: 'neutralParitySlots',
    desc: '上场时：本格为奇数则在资源区与功能/建筑区各偶数格各放置 1 枚中立骰；本格为偶数则各奇数格各放置 1 枚中立骰。派遣时：选择任意有其他中立骰的板块，将其上全部中立骰集中到本事件格',
  },
  {
    envType: 'teleport',
    label: '传送',
    trigger: 'dispatch',
    desc: '派遣：成为本格最大者时（首次亦触发；继续加码不重复），将场上任意板块任意玩家（含中立）的 1 枚骰子传送到任意有板块的格子（不触发目标格派遣事件）',
  },
  {
    envType: 'keepOverflow',
    label: '吃不了兜着走',
    trigger: 'settle',
    desc: '生产结算后：本格第一名（可并列）跳过本轮生产结算后的资源弃牌阶段',
  },
  {
    envType: 'mercenaries',
    label: '雇佣军',
    trigger: 'preSettle',
    setup: 'mercenary2',
    desc: '上场时放置 2 枚雇佣骰。全员放置完骰子后、生产判定（抵消与获资源）开始前：若本格有唯一第一名则由其投掷并放置（并列第一不触发）；放置后按对应格大份立即获得资源；若放到有派遣触发事件的格上则同样触发该效果，然后才进入生产判定',
  },
  
];

const ENVIRONMENT_BY_TYPE = Object.fromEntries(
  ENVIRONMENT_CATALOG.map((d) => [d.envType, d])
);

function makeEnvironmentFromDef(def) {
  return {
    id: nextId('env'),
    kind: 'environment',
    label: def.label,
    envType: def.envType,
    trigger: def.trigger,
    desc: def.desc,
    setup: def.setup || null,
  };
}

/** 事件牌堆（15 张；每轮摆板前整堆洗混） */
function buildEnvironmentDeck() {
  return shuffle(ENVIRONMENT_CATALOG.map((def) => makeEnvironmentFromDef(def)));
}

function getEnvironmentDef(envType) {
  return ENVIRONMENT_BY_TYPE[envType] || null;
}

/** 常驻「建造房子」造价 */
const BUILD_HOUSE_COST = { wood: 3, stone: 3, iron: 1 };

/** 常驻「购买功能卡」造价 */
const BUY_FUNC_COST = { food: 3, iron: 2 };

/** 常驻「繁殖村民」：小麦消耗 = 当前村民数量 × 该系数 */
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
  BUY_FUNC_COST,
  BREED_FOOD_PER_VILLAGER,
  breedFoodCost,
  buildResourceDeck,
  buildFunctionDeck,
  buildBuildingDeck,
  buildSpecialDeck,
  buildEnvironmentDeck,
  ENVIRONMENT_CATALOG,
  getEnvironmentDef,
};
