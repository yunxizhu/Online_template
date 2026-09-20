'use strict';

const { PEACEFUL_DECK, CONFLICT_DECK, getDeckProfile } = require('./deckProfiles');

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
  caravan: '商队来临',
  robbery: '抢劫',
  illegalBuild: '拆迁',
  enhance: '强化',
  recruit: '征召',
  shelter: '收留',
  welfareHouse: '福利房',
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

/** 牌张数：允许 0；非法值按 0 */
function copyCount(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v;
}

function resolveProfile(profile) {
  if (profile && typeof profile === 'object' && profile.resources) return profile;
  return PEACEFUL_DECK;
}

const RESOURCE_RICH_LABELS = {
  wood: '森林',
  stone: '石头山',
  food: '大麦田',
};
const RESOURCE_POOR_LABELS = {
  wood: '灌木丛',
  stone: '小石堆',
  food: '野生麦田',
};

/** 资源板块：按配置生成（富/贫张数均可为 0） */
function buildResourceDeck(profile) {
  const cfg = resolveProfile(profile).resources || {};
  const cards = [];
  for (const res of RESOURCES) {
    const entry = cfg[res] || {};
    const richN = copyCount(entry.rich);
    const poorN = copyCount(entry.poor);
    for (let i = 0; i < richN; i++) {
      cards.push({
        id: nextId('res'),
        kind: 'resource',
        resource: res,
        rich: true,
        large: 3,
        small: 2,
        label: RESOURCE_RICH_LABELS[res] || RESOURCE_LABELS[res],
      });
    }
    for (let i = 0; i < poorN; i++) {
      cards.push({
        id: nextId('res'),
        kind: 'resource',
        resource: res,
        rich: false,
        large: 2,
        small: 1,
        label:
          res === 'iron'
            ? RESOURCE_LABELS.iron
            : RESOURCE_POOR_LABELS[res] || RESOURCE_LABELS[res],
      });
    }
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
function buildFunctionDeckRaw(profile) {
  const cfg = resolveProfile(profile).functions || {};
  const cards = [];
  for (const [type, n] of Object.entries(cfg)) {
    const count = copyCount(n);
    for (let i = 0; i < count; i++) cards.push(makeFunc(type));
  }
  return cards;
}

/** 功能板块卡堆 */
function buildFunctionDeck(profile) {
  return shuffle(buildFunctionDeckRaw(profile));
}

/** 生产建筑造价：资源种类 × 富/贫（仅列出非 0 项） */
const PRODUCE_BUILD_COSTS = {
  wood: {
    rich: { stone: 2, food: 3, iron: 2 },
    poor: { stone: 1, iron: 1 },
  },
  stone: {
    rich: { wood: 2, food: 3, iron: 2 },
    poor: { wood: 1, iron: 1 },
  },
  food: {
    rich: { wood: 3, stone: 3, iron: 1 },
    poor: { wood: 1, stone: 1 },
  },
  iron: {
    rich: { wood: 4, stone: 4, food: 3, iron: 2 },
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
    cost: { wood: 2, stone: 2, food: 1, iron: 1 },
    produce: 0,
    score: 2,
    needsWorker: false,
    functionalOnly: true,
  };
}

/** 学堂：入手即 +1 胜利点并进弃牌堆，不占建筑格、无需建造 */
function makeScore1() {
  return {
    id: nextId('bld'),
    kind: 'building',
    buildType: 'score1',
    label: '学堂(+1)',
    cost: {},
    produce: 0,
    score: 1,
    needsWorker: false,
    functionalOnly: true,
    instantScore: true,
  };
}

function makeExchange() {
  return {
    id: nextId('bld'),
    kind: 'building',
    buildType: 'exchange',
    label: '集市',
    cost: { wood: 1, stone: 1, food: 1 },
    produce: 0,
    score: 0,
    needsWorker: false,
    functionalOnly: true,
  };
}

/** 许愿井：生产阶段结束后可选任意资源；同格叠放次数为 1+2+…+n */
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

/** 允许使用不同资源按兑换比例兑换（已改为默认银行可混合，打料机可选） */
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

function pushCopies(cards, n, factory) {
  const count = copyCount(n);
  for (let i = 0; i < count; i++) cards.push(factory());
}

function buildBuildingDeckRaw(profile) {
  const cfg = resolveProfile(profile).buildings || {};
  const cards = [];
  const produceCfg = cfg.produce || {};
  for (const res of RESOURCES) {
    const entry = produceCfg[res] || {};
    pushCopies(cards, entry.rich, () => makeProduceBuild(res, true));
    pushCopies(cards, entry.poor, () => makeProduceBuild(res, false));
  }
  pushCopies(cards, cfg.score2, makeScore2);
  pushCopies(cards, cfg.score1, makeScore1);
  pushCopies(cards, cfg.exchange, makeExchange);
  pushCopies(cards, cfg.wishWell, makeWishWell);
  pushCopies(cards, cfg.mixer, makeMixer);
  return cards;
}

/** 建筑卡堆 */
function buildBuildingDeck(profile) {
  return shuffle(buildBuildingDeckRaw(profile));
}

/** 功能+建筑混洗合堆 */
function buildSpecialDeck(profile) {
  return shuffle(
    buildFunctionDeckRaw(profile).concat(buildBuildingDeckRaw(profile))
  );
}

/**
 * 事件牌目录（仅元数据；张数只在 deckProfiles.js 配置）
 * trigger: dispatch=自己回合派遣自己的骰时 / settle=结算抵消后
 * setup: 上场初始化
 */
const ENVIRONMENT_CATALOG = [
  {
    envType: 'prisonersDilemma',
    label: '囚徒困境',
    trigger: 'settle',
    dispatchAlso: true,
    setup: 'neutral1',
    desc: '上场在本格放置 1 枚中立骰。自己回合派遣自己的骰到本格时：额外在本格放置 1 枚中立骰。结算抵消后：最后一名玩家（可并列；未放置者固定为最后一名）各弃 n 张资源卡，n=第一名骰子数；该弃牌在个人产出（含许愿井）后、建造前进行',
  },
  {
    envType: 'barrenHarvest',
    label: '颗粒无收',
    trigger: 'dispatch',
    setup: 'marker',
    desc: '在自己的回合中，成为本格最大者时可放置标记（首次亦触发；继续加码不重复）。标记格结算无收获',
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
    desc: '自己回合派遣自己的骰时：派遣者任选获得与此次派遣数量相同的资源（可重复）',
  },
  {
    envType: 'enterFray',
    label: '以身入局',
    trigger: 'dispatch',
    setup: 'neutral3',
    desc: '上场时在本格放置 3 枚中立骰。自己回合派遣自己的骰时可将本格与此次派遣数量相同的中立骰移到任意板块数字格（不足则全部移动；无中立骰则不可发动）',
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
    desc: '派遣：在自己的回合中，成为本格最大者时（首次亦触发；继续加码不重复），任选获得 n 个资源（可重复），n=本格骰子归属者数量（每位玩家与中立各计 1）。结算：第三名额外获得前两名在本格所得资源之和',
  },
  {
    envType: 'firstCome',
    label: '先到先得',
    trigger: 'dispatch',
    setup: 'stashResources',
    desc: '第 1–3/4–6/7+ 轮从资源牌堆抽出 3/5/7 张暗置在事件旁（不明示）；玩家在本格放置满 2/3/4 个村民时获得这些资源（每事件仅一份）',
  },
  {
    envType: 'welfareMinimum',
    label: '低保户',
    trigger: 'setup',
    setup: 'lowestScoreTwo',
    desc: '出现时：当前分数最低的玩家各随机获得 2/3/4 个资源（第 1–3/4–6/7+ 轮；可并列、可重复）',
  },
  {
    envType: 'recall',
    label: '召回',
    trigger: 'dispatch',
    desc: '自己回合派遣自己的骰时：将场上你自己的 1 枚骰子收回到手中（不可召回本次刚放置的骰子；本格有旧骰时可召回旧骰）；若没有可召回的则跳过',
  },
  {
    envType: 'weiQiRescueZhao',
    label: '围魏救赵',
    trigger: 'dispatch',
    setup: 'neutralAdjacentSlots',
    desc: '上场时：在本格周边数字格（1↔24、2↔135、3↔26、4↔15、5↔246、6↔35）于资源区各放置 1 枚中立骰。自己回合派遣自己的骰时：选择任意有其他中立骰的板块，将其上全部中立骰集中到本事件格',
  },
  {
    envType: 'teleport',
    label: '传送',
    trigger: 'dispatch',
    desc: '派遣：在自己的回合中，成为本格最大者时（首次亦触发；继续加码不重复），将场上任意板块任意玩家（含中立）的 1 枚骰子传送到任意有板块的格子（仅当传送的是自己的骰子时，触发目标格派遣事件）',
  },
  {
    envType: 'keepOverflow',
    label: '吃不了兜着走',
    trigger: 'settle',
    setup: 'stashTwoResources',
    desc: '上场时从资源牌堆抽出 2 张暗置在事件旁（不明示）；结算抵消后：本格第一名跳过本轮资源弃牌阶段，并获得这些资源',
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
  const card = {
    id: nextId('env'),
    kind: 'environment',
    label: def.label,
    envType: def.envType,
    trigger: def.trigger,
    desc: def.desc,
    setup: def.setup || null,
  };
  if (def.dispatchAlso) card.dispatchAlso = true;
  return card;
}

function environmentDeckSize(profile) {
  const cfg = resolveProfile(profile).environment || {};
  return ENVIRONMENT_CATALOG.reduce(
    (s, def) => s + copyCount(cfg[def.envType]),
    0
  );
}

/** 事件牌堆（按配置张数复制后洗混；允许某类为 0） */
function buildEnvironmentDeck(profile) {
  const cfg = resolveProfile(profile).environment || {};
  const cards = [];
  for (const def of ENVIRONMENT_CATALOG) {
    const n = copyCount(cfg[def.envType]);
    for (let i = 0; i < n; i++) {
      cards.push(makeEnvironmentFromDef(def));
    }
  }
  return shuffle(cards);
}

function getEnvironmentDef(envType) {
  return ENVIRONMENT_BY_TYPE[envType] || null;
}

/** 常驻「建造房子」造价 */
const BUILD_HOUSE_COST = { wood: 2, stone: 2, iron: 1 };

/** 常驻「购买功能卡」造价 */
const BUY_FUNC_COST = { wood: 1, stone: 1, food: 1, iron: 1 };

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
  copyCount,
  makeFunc,
  makeProduceBuild,
  makeExchange,
  makeWishWell,
  makeScore1,
  makeScore2,
  PRODUCE_BUILD_COSTS,
  BUILD_HOUSE_COST,
  BUY_FUNC_COST,
  BREED_FOOD_PER_VILLAGER,
  breedFoodCost,
  buildResourceDeck,
  buildFunctionDeck,
  buildBuildingDeck,
  buildBuildingDeckRaw,
  buildSpecialDeck,
  buildEnvironmentDeck,
  environmentDeckSize,
  ENVIRONMENT_CATALOG,
  getEnvironmentDef,
  PEACEFUL_DECK,
  CONFLICT_DECK,
  getDeckProfile,
};
