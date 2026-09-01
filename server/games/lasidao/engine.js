'use strict';

const {
  RESOURCES,
  RESOURCE_LABELS,
  FUNC_TYPES,
  NEUTRAL_WORKER_ID,
  NEUTRAL_WORKER_NAME,
  BANDIT_RAID_COUNT,
  shuffle,
  resetUid,
  makeFunc,
  buildResourceDeck,
  buildFunctionDeck,
  buildBuildingDeck,
  buildSpecialDeck,
  buildEnvironmentDeck,
  environmentDeckSize,
  ENVIRONMENT_CATALOG,
  getEnvironmentDef,
  BUILD_HOUSE_COST,
  BUY_FUNC_COST,
  BREED_FOOD_PER_VILLAGER,
  breedFoodCost,
} = require('./decks');

const {
  applyEnvironmentOnDispatch,
  applyEnvironmentOnSettleSlot,
  applyEnvironmentAfterShare,
  applyResistBarbariansAfterSettle,
  applyKeepOverflowAfterSettle,
  setupEnvironmentOnBoard,
  isBarrenMarkerOn,
  isBarrenSlot,
  grantMap,
  neutralCountOn,
  addNeutral,
  addNeutralEachSlot,
  addNeutralAdjacentSlots,
  addNeutralParitySlots,
  countNeutralGatherSources,
  moveAllNeutralsBetweenSlots,
} = require('./environmentEffects');

const WIN_SCORE = 10;
const START_VILLAGERS = 3;
const START_HOUSES = 2;
/** 每间房子可容纳的村民数 */
const VILLAGERS_PER_HOUSE = 2;
const MAX_VILLAGERS = 15;
const MAX_FUNC_HAND = 3;
const MAX_BUILDINGS = 3;
const MAX_RESOURCE_HAND = 12;
/** 每位玩家最多拥有的强化骰数量 */
const MAX_ENHANCED_DICE = 3;
/** 开局每位玩家自带的强化骰数量 */
const START_ENHANCED_DICE = 1;
/** 强化骰结算效力（普通骰为 1） */
const ENHANCED_DIE_STRENGTH = 1.5;
/** 重抽 / 购买功能卡：从合堆顶抽几张再选 1 保留 */
const SPECIAL_DRAW_PICK_COUNT = 3;
/** 征召：下一轮生产临时村民数量 */
const RECRUIT_TEMP_VILLAGERS = 2;
const EXPAND_RESOURCE_BONUS = 4;
/** 资源板块摆放上限（1–3 格各 3 张，4–6 格各 2 张） */
const MAX_RESOURCE_BOARD_TILES = 15;
/** 事件牌堆总量；每轮洗混后抽 3 张摆到 4/5/6 号格 */
const ENVIRONMENT_DECK_SIZE = environmentDeckSize();
const ENVIRONMENT_SLOT_NUMBERS = [1, 2, 3, 4, 5, 6];
const ENVIRONMENT_DRAW_PER_ROUND = ENVIRONMENT_SLOT_NUMBERS.length;

/** 功能/建筑合区：数字格 n 于第几轮解锁（1–2 号第 1 轮，之后每 2 轮 +1 格） */
function specialSlotUnlockRound(num) {
  const slot = Number(num) || 1;
  if (slot <= 2) return 1;
  return 2 * (slot - 2) + 1;
}

function areaOpenSlotCount(areaKey, round) {
  const r = Math.max(1, Number(round) || 1);
  if (areaKey === 'special') {
    return Math.min(6, 2 + Math.floor((r - 1) / 2));
  }
  return 6;
}

function isNoneSlot(slot) {
  return slot === 'none' || (typeof slot === 'string' && /^none(:\d+)?$/.test(slot));
}

function noneSlotList(player) {
  const max = maxBuildingsFor(player);
  const out = [];
  for (let i = 0; i < max; i++) {
    out.push(i === 0 ? 'none' : `none:${i}`);
  }
  return out;
}

function personalSlotsFor(player) {
  return noneSlotList(player);
}

function maxBuildingsFor(player) {
  return MAX_BUILDINGS + (Number(player && player.expandSlots) || 0);
}

/** 已占用的建筑格（按 slot 去重；相同建筑叠放只占 1 格） */
function occupiedBuildSlots(player) {
  const set = new Set();
  for (const b of player.buildings || []) {
    if (b.slot == null) continue;
    set.add(String(b.slot));
  }
  return set;
}

function occupiedBuildSlotCount(player) {
  return occupiedBuildSlots(player).size;
}

function buildingsOnSlot(player, slot) {
  const key = String(slot);
  return (player.buildings || []).filter(
    (b) => b.slot != null && String(b.slot) === key
  );
}

/** 判定两建筑是否可叠放（同类型；生产建筑还须同资源与贫富档） */
function buildingStackKey(b) {
  if (!b) return '';
  if (b.buildType === 'produce') {
    return `produce:${b.resource}:${b.rich ? 'rich' : 'poor'}`;
  }
  return String(b.buildType || '');
}

function isHomogeneousStackSlot(player, slot) {
  const on = buildingsOnSlot(player, slot);
  if (!on.length) return false;
  const key = buildingStackKey(on[0]);
  return on.every((b) => buildingStackKey(b) === key);
}

function canStackBuildingOnSlot(player, slot, building) {
  const on = buildingsOnSlot(player, slot);
  if (!on.length || !building) return false;
  const key = buildingStackKey(building);
  return on.every((b) => buildingStackKey(b) === key);
}

function findStackSlotFor(player, building) {
  if (!building) return null;
  const key = buildingStackKey(building);
  for (const slot of occupiedBuildSlots(player)) {
    const on = buildingsOnSlot(player, slot);
    if (on.length && on.every((b) => buildingStackKey(b) === key)) {
      return slot;
    }
  }
  return null;
}

/** @deprecated 使用 findStackSlotFor(player, { buildType: 'exchange' }) */
function findExchangeStackSlot(player) {
  return findStackSlotFor(player, { buildType: 'exchange' });
}

/** @deprecated 使用 isHomogeneousStackSlot */
function isExchangeOnlySlot(player, slot) {
  return isHomogeneousStackSlot(player, slot) &&
    buildingsOnSlot(player, slot).every((b) => b.buildType === 'exchange');
}

function nextFreeBuildSlot(player) {
  const used = occupiedBuildSlots(player);
  for (const s of personalSlotsFor(player)) {
    if (!used.has(String(s))) return s;
  }
  return null;
}

/**
 * 为新建筑分配格子：相同建筑可叠到已有同型格；否则取空位。
 */
function assignBuildingSlot(player, neu) {
  if (!neu) return false;
  const stack = findStackSlotFor(player, neu);
  if (stack != null) {
    neu.slot = stack;
    return true;
  }
  const free = nextFreeBuildSlot(player);
  if (free != null) {
    neu.slot = free;
    return true;
  }
  neu.slot = null;
  return false;
}

function normalizeBuildSlot(slot) {
  if (slot == null || slot === '') return 'none';
  if (slot === 'none' || slot === 0 || slot === '0') return 'none';
  if (typeof slot === 'string' && /^none:\d+$/.test(slot)) return slot;
  return 'none';
}

function maxFuncHandFor(player) {
  return MAX_FUNC_HAND + (Number(player && player.expandFuncSlots) || 0);
}

function maxResourceHandFor(player) {
  return (
    MAX_RESOURCE_HAND +
    (Number(player && player.expandResSlots) || 0) * EXPAND_RESOURCE_BONUS
  );
}

/** 村民住房容量（每间房子 2 人） */
function villagerCapacityFor(player) {
  return (Number(player && player.houses) || 0) * VILLAGERS_PER_HOUSE;
}

/** 剩余可繁殖空位：住房容量 − 村民数 */
function freeHousesFor(player) {
  const capacity = villagerCapacityFor(player);
  const villagers = Number(player && player.villagers) || 0;
  return Math.max(0, capacity - villagers);
}

/** 累计扩建次数（三选一，各栏独立计数之和） */
function expandCountFor(player) {
  if (!player) return 0;
  return (
    (Number(player.expandSlots) || 0) +
    (Number(player.expandFuncSlots) || 0) +
    (Number(player.expandResSlots) || 0)
  );
}

/** 常驻扩建造价：固定各 1，不随次数增加 */
function expandPermanentCost(_player) {
  return { wood: 1, stone: 1, food: 1, iron: 1 };
}

const EXPAND_DIRECTIONS = ['building', 'function', 'resource'];

function parseExpandDirection(payload) {
  const d = payload && payload.direction;
  return EXPAND_DIRECTIONS.includes(d) ? d : null;
}

function slotLabel(slot) {
  return isNoneSlot(slot) ? '无数字' : String(slot);
}

/** 两大公共区：资源 + 功能/建筑合区 */
const BOARD_AREAS = ['resource', 'special'];
const AREA_LABELS = {
  resource: '资源',
  special: '功能/建筑',
};

function emptyRes() {
  return { wood: 0, stone: 0, food: 0, iron: 0 };
}

function startRes() {
  return emptyRes();
}

function cloneRes(r) {
  return {
    wood: r.wood || 0,
    stone: r.stone || 0,
    food: r.food || 0,
    iron: r.iron || 0,
  };
}

function sumRes(r) {
  return RESOURCES.reduce((s, k) => s + (r[k] || 0), 0);
}

function syncResourceHandPending(player, game) {
  if (!player) return;
  // 建造阶段内再获得资源超上限不强制弃牌
  if (game && game.phase === 'build') {
    player.pendingDiscardRes = false;
    return;
  }
  if (player.skipSettleResourceDiscard) {
    player.pendingDiscardRes = false;
    return;
  }
  player.pendingDiscardRes =
    sumRes(player.resources) > maxResourceHandFor(player);
}

function syncFuncHandPending(player) {
  if (!player) return;
  if ((player.funcCards || []).length > maxFuncHandFor(player)) {
    player.pendingDiscardFunc = true;
  } else {
    player.pendingDiscardFunc = false;
  }
}

function playerNeedsBuildPhaseCardDiscard(player) {
  return Boolean(
    player && (player.pendingDiscardFunc || player.pendingDiscardBuild)
  );
}

function rejectIfBuildPhaseCardDiscardPending(player) {
  if (playerNeedsBuildPhaseCardDiscard(player)) {
    return { ok: false, error: '请先弃置超上限的功能卡或建筑' };
  }
  return null;
}

function syncAllDiscardPending(game) {
  for (const p of alivePlayers(game)) {
    syncResourceHandPending(p, game);
    syncFuncHandPending(p);
  }
}

function canPay(have, cost) {
  for (const k of RESOURCES) {
    if ((have[k] || 0) < (cost[k] || 0)) return false;
  }
  return true;
}

function pay(have, cost) {
  for (const k of RESOURCES) {
    have[k] = (have[k] || 0) - (cost[k] || 0);
  }
}

function addRes(have, gain) {
  for (const k of RESOURCES) {
    have[k] = (have[k] || 0) + (gain[k] || 0);
  }
}

function countBuiltWishWell(p) {
  return (p.buildings || []).filter(
    (b) => b.built && b.buildType === 'wishWell'
  ).length;
}

function countEternalThrone(p) {
  return (p.buildings || []).filter(
    (b) => b.built && b.buildType === 'eternalThrone'
  ).length;
}

function playersNeedingWishWell(game) {
  return alivePlayers(game).filter(
    (p) => (Number(p.pendingWishWellBonus) || 0) > 0
  );
}

function anyoneNeedsDiscard(game) {
  syncAllDiscardPending(game);
  return alivePlayers(game).some(
    (p) =>
      p.pendingDiscardFunc || p.pendingDiscardBuild || p.pendingDiscardRes
  );
}

function anyoneNeedsResourceDiscard(game) {
  for (const p of alivePlayers(game)) {
    syncResourceHandPending(p, game);
    if (p.pendingDiscardRes) return true;
  }
  return false;
}

function anyoneNeedsCardDiscard(game) {
  for (const p of alivePlayers(game)) {
    syncFuncHandPending(p);
    if (p.pendingDiscardFunc || p.pendingDiscardBuild) return true;
  }
  return false;
}

function playerNeedsSettleAct(p, scope) {
  if (!p) return false;
  if (scope === 'resource') return Boolean(p.pendingDiscardRes);
  if (scope === 'card') {
    return Boolean(p.pendingDiscardFunc || p.pendingDiscardBuild);
  }
  return Boolean(
    p.pendingDiscardRes || p.pendingDiscardFunc || p.pendingDiscardBuild
  );
}

function beginConcurrentDiscardPhase(game) {
  game.phase = 'settle_act';
  game.settleActScope = 'all';
  game.settleActPassed = {};
  game.currentPlayerId = null;
  syncAllDiscardPending(game);
  const discardNames = alivePlayers(game)
    .filter((p) => playerNeedsSettleAct(p, 'all'))
    .map((p) => p.name);
  pushLog(
    game,
    discardNames.length
      ? `—— 弃牌阶段（${discardNames.join('、')}）——`
      : '—— 弃牌阶段 ——'
  );
}

function tryFinishConcurrentDiscardPhase(game) {
  if (game.phase !== 'settle_act') return;
  for (const p of alivePlayers(game)) {
    syncFuncHandPending(p);
    syncResourceHandPending(p, game);
  }
  if (!anyoneNeedsDiscard(game)) {
    finishSettleActPhase(game);
  }
}

function applyPersonalProduceIfNeeded(game) {
  if (game.personalProduceApplied) return;
  const report = game.lastSettle;
  if (report) {
    applySettleBuildingProduce(game, report);
    logSettleRoundMvp(game);
  }
  game.personalProduceApplied = true;
}

/** 结算动画结束后：弃牌（全员并行）→ 个人产出+许愿井（全员并行）→ 囚徒弃牌（全员并行）→ 建造
 * （仅弃牌阶段检查资源上限；个人产出后不检查；建造阶段内再获得资源亦不强制弃牌）
 * 雇佣军在全员放置完毕、生产判定开始前单独处理，见 tryEnterPreSettleMercenaryOrSettle
 */
function advancePostSettlePipeline(game) {
  if (game.over) return;

  if (tryStartNextKeepOverflowChoice(game)) return;

  syncAllDiscardPending(game);

  if (anyoneNeedsDiscard(game)) {
    beginConcurrentDiscardPhase(game);
    return;
  }

  applyPersonalProduceIfNeeded(game);

  if (playersNeedingWishWell(game).length > 0) {
    beginWishWell(game);
    return;
  }

  if (anyoneNeedsPrisonerDiscard(game)) {
    beginPrisonerDiscardPhase(game);
    return;
  }

  beginBuild(game);
}

function tryEndRoundAfterBuild(game) {
  if (game.over) return;
  syncAllDiscardPending(game);
  if (anyoneNeedsCardDiscard(game)) {
    beginConcurrentDiscardPhase(game);
    return;
  }
  endRound(game);
}

function anyoneNeedsPrisonerDiscard(game) {
  const map = game.pendingPrisonerDiscards || {};
  return Object.keys(map).some((id) => (Number(map[id]) || 0) > 0);
}

/**
 * 囚徒困境：弃第一名骰子数量的资源；不足则全弃；无资源则无需弃。
 * 在进入/推进弃牌阶段时把待弃数量钳到实际持有量，避免卡死。
 */
function clampPrisonerDiscardsToOwned(game) {
  const map = game.pendingPrisonerDiscards || (game.pendingPrisonerDiscards = {});
  for (const id of Object.keys(map)) {
    const need = Number(map[id]) || 0;
    if (need <= 0) {
      delete map[id];
      continue;
    }
    const p = playerById(game, id);
    if (!p || p.left) {
      delete map[id];
      continue;
    }
    const have = sumRes(p.resources);
    if (have <= 0) {
      delete map[id];
      pushLog(
        game,
        `${p.name} 无资源可弃，跳过囚徒困境弃牌`
      );
    } else if (have < need) {
      map[id] = have;
      pushLog(
        game,
        `${p.name} 资源不足 ${need} 张，改为弃置全部 ${have} 张`
      );
    }
  }
}

function beginPrisonerDiscardPhase(game) {
  game.phase = 'event_discard';
  game.currentPlayerId = null;
  pushLog(game, '—— 事件弃牌：囚徒困境 ——');
  clampPrisonerDiscardsToOwned(game);
  ensurePrisonerDiscardPlayer(game);
}

function ensurePrisonerDiscardPlayer(game) {
  if (game.phase !== 'event_discard') return;
  clampPrisonerDiscardsToOwned(game);
  if (!anyoneNeedsPrisonerDiscard(game)) {
    game.currentPlayerId = null;
    advancePostSettlePipeline(game);
    return;
  }
  game.currentPlayerId = null;
}

function beginMercenaryPhase(game) {
  const q = game.pendingMercenaryQueue || [];
  if (!q.length) {
    finishMercenaryGate(game);
    return;
  }
  game.phase = 'event_mercenary';
  const cur = q[0];
  game.currentPlayerId = cur.playerId;
  game.mercenaryRoll = null;
  game.mercenaryPlaced = [];
  pushLog(
    game,
    `—— 雇佣军：${(playerById(game, cur.playerId) || {}).name || '?'} 请投掷并放置 ——`
  );
}

/** 雇佣军全部处理完：进入正式生产判定（结算） */
function finishMercenaryGate(game) {
  const gate = game.mercenaryGate;
  game.mercenaryGate = null;
  game.mercenaryRoll = null;
  game.mercenaryPlaced = [];
  game.pendingMercenaryQueue = [];
  if (gate === 'preSettle') {
    startSettle(game);
    return;
  }
  advancePostSettlePipeline(game);
}

/**
 * 全员放置后、抵消前的唯一第一名（强度并列则无人；中立独占第一也不触发）
 */
function uniqueFirstPlayerId(workers, boosts) {
  const strength = slotStrengthMap(workers, boosts);
  const entries = Object.entries(strength).filter(([, c]) => (Number(c) || 0) > 0);
  if (!entries.length) return null;
  let max = 0;
  for (const [, c] of entries) {
    if (c > max) max = c;
  }
  const tops = entries.filter(([, c]) => c === max);
  if (tops.length !== 1) return null;
  const pid = tops[0][0];
  if (pid === NEUTRAL_WORKER_ID) return null;
  return pid;
}

/** 全员放置完毕、生产判定前：收集雇佣军队列（仅唯一第一名） */
function queueMercenariesBeforeSettle(game) {
  game.pendingMercenaryQueue = [];
  const envs =
    (game.board && game.board.resource && game.board.resource.environments) ||
    {};
  for (const num of ENVIRONMENT_SLOT_NUMBERS) {
    const env = envs[num];
    if (!env || env.envType !== 'mercenaries') continue;
    const diceN = Number(env.mercenaryDice) || 0;
    if (diceN <= 0) continue;
    const workers = (game.board.resource.workers && game.board.resource.workers[num]) || {};
    const boosts =
      (game.board.resource.boosts && game.board.resource.boosts[num]) || {};
    const firstId = uniqueFirstPlayerId(workers, boosts);
    if (!firstId) {
      pushLog(
        game,
        `「${env.label}」：资源格 ${num} 无唯一第一名，效果不触发`
      );
      continue;
    }
    const p = playerById(game, firstId);
    game.pendingMercenaryQueue.push({
      playerId: firstId,
      envNumber: num,
      diceCount: diceN,
      label: env.label,
    });
    env.mercenaryDice = 0;
    pushLog(
      game,
      `「${env.label}」：${(p && p.name) || firstId} 为资源格 ${num} 唯一第一，可投掷雇佣骰 ${diceN} 枚`
    );
  }
}

/** 全员放置结束：先处理雇佣军，再进入生产判定（结算抵消与获资源） */
function tryEnterPreSettleMercenaryOrSettle(game) {
  queueMercenariesBeforeSettle(game);
  if ((game.pendingMercenaryQueue || []).length > 0) {
    game.mercenaryGate = 'preSettle';
    beginMercenaryPhase(game);
    return;
  }
  game.mercenaryGate = null;
  startSettle(game);
}

function beginBuildIfCompliant(game) {
  if (game.over) return;
  beginBuild(game);
}

function beginWishWell(game) {
  if (game.over) return;
  game.phase = 'wish_well';
  game.currentPlayerId = null;
  const names = playersNeedingWishWell(game).map((p) => p.name);
  pushLog(
    game,
    `—— 许愿井：${names.join('、')} 请选择资源 ——`
  );
}

function tryFinishWishWellPhase(game) {
  if (game.phase !== 'wish_well') return;
  if (playersNeedingWishWell(game).length === 0) {
    advancePostSettlePipeline(game);
  }
}

/**
 * 从资源板块某一数字格取得大份/小份。
 */
function grantBoardResourceShare(p, tiles, shareKey) {
  const byRes = Object.create(null);
  const labelsByRes = Object.create(null);
  for (const tile of tiles) {
    const amt = Number(tile[shareKey]) || 0;
    if (!amt || !tile.resource) continue;
    const r = tile.resource;
    byRes[r] = (byRes[r] || 0) + amt;
    if (!labelsByRes[r]) labelsByRes[r] = [];
    labelsByRes[r].push(tile.label || RESOURCE_LABELS[r] || r);
  }
  const detail = [];
  let total = 0;
  for (const r of RESOURCES) {
    if (!byRes[r]) continue;
    const amount = byRes[r];
    p.resources[r] = (p.resources[r] || 0) + amount;
    total += amount;
    detail.push({
      label: labelsByRes[r].join('+'),
      resource: r,
      amount,
    });
  }
  return { total, detail };
}

function mergeResourceGainDetail(target, absorbed) {
  if (!target || !absorbed || !absorbed.total) return;
  target.amount = (Number(target.amount) || 0) + absorbed.total;
  if (!target.detail) target.detail = [];
  for (const d of absorbed.detail || []) {
    const ex = target.detail.find((x) => x.resource === d.resource);
    if (ex) {
      ex.amount += d.amount;
      ex.label = [ex.label, d.label].filter(Boolean).join('+');
    } else {
      target.detail.push({ ...d });
    }
  }
}

function formatSettleResourceGainLog(num, gain, areaKey) {
  const rank = Number(gain.rank) || 1;
  const area =
    areaKey === 'special' ? '功能/建筑' : '资源';
  const resParts = (gain.detail || []).map(
    (d) =>
      `${d.amount}个${RESOURCE_LABELS[d.resource] || d.resource || '?'}`
  );
  const resStr = resParts.length
    ? resParts.join('、')
    : `${gain.amount || 0}个资源`;
  return `${area}区 ${num} 号格，${gain.name} 第${rank}名，获得${resStr}`;
}

function pushLog(game, text) {
  game.log.push({ at: Date.now(), text });
  if (game.log.length > 60) game.log.shift();
}

function pushProduceFx(game, payload) {
  game.lastProduceFx = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    at: Date.now(),
    ...payload,
  };
}

function pushPlayReveal(game, payload) {
  game.lastPlayReveal = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    at: Date.now(),
    ...payload,
  };
}

/** 取本次动作产生的具体日志（排除「发动功能」类泛化文案） */
function pickActionLogText(game, sinceLen) {
  const entries = game.log.slice(sinceLen);
  const specific = entries.filter(
    (e) => e && e.text && e.text.indexOf('发动功能') < 0
  );
  if (specific.length) return specific[specific.length - 1].text;
  const last = entries[entries.length - 1];
  return last && last.text ? last.text : '';
}

function playerById(game, id) {
  return game.players.find((p) => p.id === id) || null;
}

function alivePlayers(game) {
  return game.players.filter((p) => !p.left);
}

function seatIndex(game, playerId) {
  return game.players.findIndex((p) => p.id === playerId);
}

/** 从 startId 开始顺时针下一位存活玩家 */
function nextAlive(game, fromId) {
  const n = game.players.length;
  const start = seatIndex(game, fromId);
  if (start < 0) return null;
  for (let i = 1; i <= n; i++) {
    const p = game.players[(start + i) % n];
    if (!p.left) return p;
  }
  return null;
}

function rollDice(n) {
  const dice = [];
  for (let i = 0; i < n; i++) {
    dice.push(1 + Math.floor(Math.random() * 6));
  }
  return dice;
}

function idleVillagers(p) {
  const temp = Number(p && p.tempVillagers) || 0;
  return Math.max(0, (Number(p.villagers) || 0) + temp - (Number(p.dispatched) || 0));
}

function playerScore(p) {
  let s = Number(p.houseScore) || 0;
  for (const b of p.buildings || []) {
    if (b.built && b.score) s += b.score;
  }
  s += Number(p.bonusScore) || 0;
  s += stackAchievementScore(p);
  return s;
}

function checkWin(game) {
  if (game.over) return true;
  // 建造等阶段按回合顺序结算：先达到胜利分的唯一玩家立刻获胜
  let winner = null;
  const cur = playerById(game, game.currentPlayerId);
  if (cur && !cur.left && playerScore(cur) >= WIN_SCORE) {
    winner = cur;
  } else {
  for (const p of alivePlayers(game)) {
      if (playerScore(p) >= WIN_SCORE) {
        winner = p;
        break;
  }
    }
  }
  if (!winner) return false;
    game.over = true;
    game.phase = 'over';
  game.winners = [winner.id];
  pushLog(
    game,
    `有玩家达到 ${WIN_SCORE} 分，游戏结束！胜者：${winner.name}`
  );
    return true;
}

// ─── 板块摆放 ───────────────────────────────────────────

function emptySlotWorkers() {
  return { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
}

function emptyAreaBoard() {
  return {
    tiles: [], // { ...card, number }
    environments: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null }, // 1–6 事件牌卡位
    workers: emptySlotWorkers(), // number -> { playerId: physical die count }
    boosts: emptySlotWorkers(), // number -> { playerId: enhanced die count among workers }
  };
}

function emptyBoard() {
  return {
    resource: emptyAreaBoard(),
    special: emptyAreaBoard(),
  };
}

/** 去掉场上/手牌临时字段，放回弃牌堆用 */
function cleanCardForPile(card) {
  const {
    number,
    workers,
    slot,
    built,
    pending,
    faceDown,
    ...rest
  } = card || {};
  return { ...rest };
}

const DECK_KIND_LABEL = {
  resource: '资源',
  special: '功能/建筑',
  function: '功能',
  building: '建筑',
  environment: '事件',
};

/** 功能/建筑统一进合堆弃牌；事件牌独立 */
function normalizeDeckKind(kind) {
  if (kind === 'function' || kind === 'building') return 'special';
  if (kind === 'environment') return 'environment';
  return kind;
}

function deckKey(kind) {
  return `${normalizeDeckKind(kind)}Deck`;
}

function discardKey(kind) {
  return `${normalizeDeckKind(kind)}Discard`;
}

/** 抽牌堆空时，将旁置弃牌堆洗混后作为新抽牌堆 */
function ensureDeck(game, kind) {
  const nk = normalizeDeckKind(kind);
  const dk = deckKey(nk);
  const xk = discardKey(nk);
  if ((game[dk] || []).length > 0) return true;
  if (!(game[xk] || []).length) return false;
  game[dk] = shuffle(game[xk]);
  game[xk] = [];
  pushLog(
    game,
    `${DECK_KIND_LABEL[nk] || nk}抽牌堆已空，弃牌堆洗混后放回（${game[dk].length} 张）`
  );
  return true;
}

function pushToDiscard(game, kind, card) {
  if (!card) return;
  const nk = normalizeDeckKind(kind);
  if (!game[discardKey(nk)]) game[discardKey(nk)] = [];
  game[discardKey(nk)].push(cleanCardForPile(card));
}

function drawOne(game, kind) {
  if (!ensureDeck(game, kind)) return null;
  return game[deckKey(kind)].shift();
}

function peekSpecialTopKind(game) {
  const deck = game.specialDeck || [];
  if (!deck.length) return null;
  return deckKindOfTile(deck[0]);
}

/** 功能/建筑合区：奇数格明示，偶数格（2/4/6）暗置 */
function isBoardFaceDownNumber(number) {
  return number === 2 || number === 4 || number === 6;
}

/** 资源区卡位不再暗置（一律明示） */
function isResourceFaceDownOnSlot(/* number, cardIndexOnSlot */) {
  return false;
}

/** 依次放到 1~6，超出回绕（第 7 张→1，第 8 张→2…） */
function drawToArea(game, kind, count) {
  const slotCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const card = drawOne(game, kind);
    if (!card) break;
    const number = (i % 6) + 1;
    slotCounts[number] += 1;
    const cardIndexOnSlot = slotCounts[number];
    let faceDown = false;
    if (kind === 'special' && isBoardFaceDownNumber(number)) {
      faceDown = true;
    } else if (
      kind === 'resource' &&
      isResourceFaceDownOnSlot(number, cardIndexOnSlot)
    ) {
      faceDown = true;
    }
    tiles.push({
      ...card,
      number,
      faceDown,
      cardIndexOnSlot,
    });
  }
  return tiles;
}

function deckKindOfTile(tile) {
  if (!tile) return 'function';
  if (tile.kind === 'building' || tile.buildType) return 'building';
  if (tile.kind === 'function' || tile.funcType) return 'function';
  return tile.kind === 'resource' ? 'resource' : 'function';
}

function beginWelfareMinimumConcurrent(game) {
  if (game.pendingEventChoice) return false;
  const q = game.pendingWelfareMinimumQueue;
  if (!q || !q.length) return false;
  if (!game.pendingWelfareMinimumChoices) {
    game.pendingWelfareMinimumChoices = {};
  }
  const names = [];
  const label = (q[0] && q[0].label) || '低保户';
  while (q.length) {
    const item = q.shift();
    const count = item.count || 2;
    game.pendingWelfareMinimumChoices[item.playerId] = {
      ...item,
      needChoice: 'pickTwoResources',
      count,
      resume: 'welfareSetup',
    };
    const p = playerById(game, item.playerId);
    if (p) names.push(p.name);
  }
  game.phase = 'produce';
  game.awaitingProduceRoll = false;
  game.currentPlayerId = null;
  pushLog(
    game,
    `—— 低保户：${names.join('、')} 请选择「${label}」资源 ——`
  );
  return true;
}

function tryFinishWelfareMinimumConcurrent(game) {
  const pending = game.pendingWelfareMinimumChoices || {};
  if (Object.keys(pending).length > 0) return;
  if (game.pendingEventChoice) return;
  if (!game.roundProduceBegun) {
    beginProduce(game);
    game.roundProduceBegun = true;
  }
}

/** @deprecated 兼容旧测试路径 */
function tryStartNextWelfareMinimumChoice(game) {
  return beginWelfareMinimumConcurrent(game);
}

function tryStartNextKeepOverflowChoice(game) {
  if (game.over || game.pendingEventChoice) return false;
  const q = game.pendingKeepOverflowQueue;
  if (!q || !q.length) return false;
  const next = q.shift();
  const count = next.count || 2;
  game.pendingEventChoice = {
    playerId: next.playerId,
    needChoice: 'pickTwoResources',
    envType: next.envType,
    label: next.label,
    envNumber: next.envNumber,
    resume: 'keepOverflow',
    count,
  };
  game.currentPlayerId = next.playerId;
  const p = playerById(game, next.playerId);
  pushLog(
    game,
    `${p ? p.name : '?'} 请选择「${next.label}」的 ${count} 个资源`
  );
  return true;
}

function maybeBeginProduceAfterSetup(game) {
  if (beginWelfareMinimumConcurrent(game)) return;
  if (Object.keys(game.pendingWelfareMinimumChoices || {}).length > 0) return;
  if (game.pendingEventChoice) return;
  beginProduce(game);
  game.roundProduceBegun = true;
}

function drawEnvironmentBoard(game) {
  // 与资源/合堆相同：从抽牌堆依次抽取；抽空后由 ensureDeck 洗混弃牌堆
  game.barrenMarkerNumber = null;
  game.barrenMarkerArea = null;
  game.barrenMarkerOwnerId = null;

  const environments = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
  for (const num of ENVIRONMENT_SLOT_NUMBERS) {
    const card = drawOne(game, 'environment');
    if (!card) continue;
    const env = { ...card, number: num };
    setupEnvironmentOnBoard(game, env, num, {
      pushLog,
      drawOne,
      alivePlayers,
      playerScore,
    });
    environments[num] = env;
  }
  return environments;
}

function setupBoard(game) {
  const n = Math.max(0, game.round - 1);
  const resCount = Math.min(MAX_RESOURCE_BOARD_TILES, 6 + n);
  const specialCount = areaOpenSlotCount('special', game.round);

  game.board = emptyBoard();
  game.board.resource.tiles = drawToArea(game, 'resource', resCount);
  game.board.resource.environments = drawEnvironmentBoard(game);
  game.board.special.tiles = drawToArea(game, 'special', specialCount);

  const envOnBoard = ENVIRONMENT_SLOT_NUMBERS.filter(
    (num) => game.board.resource.environments[num]
  ).length;
  pushLog(
    game,
    `第 ${game.round} 轮摆放：资源 ${game.board.resource.tiles.length}、事件 ${envOnBoard}、功能/建筑 ${game.board.special.tiles.length}`
  );
}

function tilesOnNumber(areaBoard, number) {
  return (areaBoard.tiles || []).filter((t) => t.number === number);
}

function clearAllSlotWorkers(game) {
  for (const area of BOARD_AREAS) {
    game.board[area].workers = emptySlotWorkers();
    game.board[area].boosts = emptySlotWorkers();
  }
}

/** 清空工人后：按场上事件牌补回「以身入局」等上场中立骰（setupBoard 已放过，beginProduce 会清掉） */
function restoreEnvironmentNeutrals(game) {
  const envs =
    (game.board && game.board.resource && game.board.resource.environments) ||
    {};
  let restoredEachSlot = false;
  for (const num of ENVIRONMENT_SLOT_NUMBERS) {
    const env = envs[num];
    if (!env) continue;
    const setup = env.setup || (getEnvironmentDef(env.envType) || {}).setup;
    if (setup === 'neutral3') {
      addNeutral(game, 'resource', num, 3);
    } else if (setup === 'neutral2') {
      addNeutral(game, 'resource', num, 2);
    } else if (setup === 'neutralEachSlot' && !restoredEachSlot) {
      addNeutralEachSlot(game);
      restoredEachSlot = true;
    } else if (setup === 'neutralAdjacentSlots' || setup === 'neutralParitySlots') {
      addNeutralAdjacentSlots(game, num);
    }
  }
}

/** 为本回合骰子分配强化标记（剩余未派出的强化额度） */
function assignDiceBoostFlags(game, player, count) {
  if (!game.diceBoosted) game.diceBoosted = {};
  const avail = Math.max(
    0,
    (Number(player.enhancedDice) || 0) - (Number(player.enhancedPlaced) || 0)
  );
  const flags = [];
  for (let i = 0; i < count; i++) flags.push(i < avail);
  for (let i = flags.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [flags[i], flags[j]] = [flags[j], flags[i]];
  }
  game.diceBoosted[player.id] = flags;
}

function findPersonalBuilding(player, buildingId) {
  return (player.buildings || []).find((b) => b.id === buildingId) || null;
}

/** 回收未获取的公共板块到旁置弃牌堆（不立刻回抽牌堆底） */
function recycleBoard(game) {
  for (const t of game.board.resource.tiles) {
    pushToDiscard(game, 'resource', t);
  }
  const envs = (game.board.resource && game.board.resource.environments) || {};
  for (const num of ENVIRONMENT_SLOT_NUMBERS) {
    if (envs[num]) pushToDiscard(game, 'environment', envs[num]);
  }
  for (const t of game.board.special.tiles) {
    pushToDiscard(game, 'special', t);
  }
  game.board = emptyBoard();
}

// ─── 拉斯维加斯式抵消 ───────────────────────────────────

/**
 * 结算强度（半单位整数，÷2 为实际效力）：
 * 普通骰 = 2（1.0），强化骰 = 3（1.5）
 */
function slotStrengthMap(workers, boosts) {
  const out = {};
  for (const [pid, c] of Object.entries(workers || {})) {
    const n = Number(c) || 0;
    if (n <= 0) continue;
    const b = Math.min(Math.max(0, Number(boosts && boosts[pid]) || 0), n);
    out[pid] = n * 2 + b;
  }
  return out;
}

/**
 * 相同数量的阵营互相抵消。
 * 输入 { pid: count }，返回抵消后剩余 { pid: count }
 */
function cancelEqualCounts(workers) {
  const entries = Object.entries(workers).filter(([, c]) => c > 0);
  const byCount = new Map();
  for (const [pid, c] of entries) {
    if (!byCount.has(c)) byCount.set(c, []);
    byCount.get(c).push(pid);
  }
  const remain = {};
  for (const [c, pids] of byCount) {
    if (pids.length === 1) {
      remain[pids[0]] = c;
    }
    // 多个相同数量 → 全部抵消
  }
  return remain;
}

function rankedRemain(remain) {
  return Object.entries(remain)
    .map(([pid, count]) => ({ pid, count }))
    .sort((a, b) => b.count - a.count);
}

function workerDisplayName(game, pid) {
  if (pid === NEUTRAL_WORKER_ID) return NEUTRAL_WORKER_NAME;
  const p = playerById(game, pid);
  return p ? p.name : pid;
}

function mapRanked(game, remain, physical) {
  return rankedRemain(remain).map((r) => ({
    pid: r.pid,
    name: workerDisplayName(game, r.pid),
    count: r.count, // 派遣强度（抵消后，仅用于排名比较）
    dice: physical ? Number(physical[r.pid]) || 0 : 0, // 物理骰子枚数（效果判定用）
    neutral: r.pid === NEUTRAL_WORKER_ID,
  }));
}

/** 读取某格上某阵营的物理骰子枚数（workers 映射） */
function physicalDiceOnSlot(physical, pid) {
  return Number(physical && physical[pid]) || 0;
}

function cancelledEntries(before, remain) {
  const out = [];
  for (const [pid, count] of Object.entries(before || {})) {
    if (count > 0 && !remain[pid]) out.push({ pid, count });
  }
  return out;
}

function summarizeTiles(tiles) {
  return (tiles || []).map((t) => ({
    id: t.id,
    kind: t.kind,
    faceDown: Boolean(t.faceDown),
    label: t.label || null,
    resource: t.resource || null,
    large: t.large,
    small: t.small,
    funcType: t.funcType || null,
    buildType: t.buildType || null,
    cost: t.cost || null,
    produce: t.produce,
    score: t.score,
    rich: t.rich,
  }));
}

function tileLogLabel(t) {
  return t && t.faceDown ? '暗置' : (t && t.label) || '?';
}

/** 结算报告里的板块：暗置仅对取得者可见 */
function publicSettleTiles(tiles, claimedByPid, viewerId) {
  const reveal = claimedByPid && claimedByPid === viewerId;
  return (tiles || []).map((t) => {
    if (t.faceDown && !reveal) {
      return {
        id: t.id,
        kind: t.kind,
        faceDown: true,
        label: null,
        resource: null,
        large: null,
        small: null,
        funcType: null,
        buildType: null,
        cost: null,
        produce: null,
        score: null,
        rich: null,
      };
    }
    return {
      id: t.id,
      kind: t.kind,
      faceDown: false,
      label: t.label,
      resource: t.resource || null,
      large: t.large,
      small: t.small,
      funcType: t.funcType || null,
      buildType: t.buildType || null,
      cost: t.cost || null,
      produce: t.produce,
      score: t.score,
      rich: t.rich,
    };
  });
}

function publicLastSettle(report, viewerId) {
  if (!report) return null;
  return {
    ...report,
    slots: (report.slots || []).map((s) => ({
      ...s,
      tiles: publicSettleTiles(
        s.tiles,
        s.claimedBy && s.claimedBy.pid,
        viewerId
      ),
    })),
  };
}

function publicBuilding(b, isMe) {
  // 未建造建筑仅持有者可见；已建造建筑对所有人公开
  if (!isMe && !b.built) {
    return {
      id: b.id,
      faceDown: true,
      label: null,
      buildType: null,
      resource: null,
      rich: null,
      slot: b.slot,
      built: false,
      workers: b.workers || 0,
      cost: null,
      produce: null,
      score: null,
    };
  }
  return {
    id: b.id,
    faceDown: false,
    label: b.label,
    buildType: b.buildType,
    resource: b.resource,
    rich: b.rich,
    slot: b.slot,
    built: b.built,
    workers: b.workers || 0,
    cost: b.cost,
    produce: b.produce,
    score: b.score,
  };
}

// ─── 创建 / 回合推进 ─────────────────────────────────────

function createGameState(room) {
  resetUid(1);
  const players = room.players.map((p, i) => ({
    id: p.id,
    name: p.name,
    tag: p.tag || null,
    seat: i,
    left: false,
    villagers: START_VILLAGERS,
    houses: START_HOUSES,
    houseScore: 0, // 常驻建造房子获得的胜利点（与房子容量分开）
    dispatched: 0,
    voided: 0,
    enhancedDice: START_ENHANCED_DICE, // 已强化的村民/骰子数（永久，上限 MAX_ENHANCED_DICE，且不超过村民数）
    enhancedPlaced: 0, // 本轮已派出的强化骰数
    recruitPending: 0, // 下一轮生产开始时生效的临时村民数
    welfareHouses: 0, // 福利房提供容量但不计分
    caravanPending: false, // 商队来临：本建造回合结束前特殊兑换率
    tempVillagers: 0, // 本轮生产可用的临时村民（生产结束后清零）
    bonusScore: 0, // 事件等额外胜利点
    resources: startRes(),
    score: 0,
    funcCards: [],
    buildings: [], // { ...card, slot, built }
    roundGained: 0,
    roundBuiltHouse: false,
    roundBred: false,
    roundExpanded: false,
    pendingDiscardFunc: false,
    pendingDiscardBuild: null, // 总建筑达上限时需弃一张（已建或未建）腾位
    pendingDiscardRes: false, // 手牌资源超上限
    skipSettleResourceDiscard: false, // 吃不了兜着走：本轮结算后豁免资源弃牌
    pendingWishWellBonus: 0, // 本轮许愿井待选取资源次数
    expandSlots: 0, // 扩建建筑格后增加的无数字格数量
    expandFuncSlots: 0, // 扩建功能卡格后增加的上限
    expandResSlots: 0, // 扩建资源卡位次数（每次 +4 手牌资源上限）
  }));

  const game = {
    type: 'lasidao',
    phase: 'init_announce', // init_announce | produce | settle | build | over
    round: 1,
    over: false,
    winners: [],
    players,
    resourceDeck: buildResourceDeck(),
    specialDeck: buildSpecialDeck(),
    environmentDeck: buildEnvironmentDeck(),
    resourceDiscard: [],
    specialDiscard: [],
    environmentDiscard: [],
    board: emptyBoard(),
    barrenMarkerNumber: null,
    barrenMarkerArea: null,
    barrenMarkerOwnerId: null,
    pendingEventChoice: null,
    pendingRedrawChoice: null,
    pendingIllegalBuild: null,
    pendingTrade: null,
    pendingWelfareMinimumQueue: [],
    pendingWelfareMinimumChoices: {},
    pendingKeepOverflowQueue: [],
    pendingPrisonerDiscards: {},
    pendingMercenaryQueue: [],
    mercenaryRoll: null,
    mercenaryPlaced: [],
    mercenaryGate: null,
    // 生产阶段
    produceOrderStartId: null,
    currentPlayerId: null,
    lastPlacerId: null,
    lastBuilderId: null,
    dice: {}, // playerId -> number[]
    diceBoosted: {}, // playerId -> boolean[] 与 dice 对齐
    awaitingProduceRoll: false,
    remoteDiceMode: false,
    // 建造阶段
    buildPassed: {}, // playerId -> true 本轮声明跳过
    buildIdleLoops: 0,
    // 生产阶段派遣完毕顺序（用于确定建造阶段行动顺序）
    produceFinishOrder: [],
    // 先手投掷
    initRolls: {},
    log: [],
    lastSettle: null,
    settleAnimAcks: {},
    settleAnimUntil: 0,
  };

  //dealStartingBreedCards(game);
  // 开局自动投先手 → 宣布 → 再发牌
  startInitRoll(game);
  return game;
}

/** 开局每人一张「繁殖村民」（优先从合堆抽取） */
function dealStartingBreedCards(game) {
  for (const p of game.players || []) {
    let card = null;
    const idx = (game.specialDeck || []).findIndex(
      (c) => c.funcType === 'breed'
    );
    if (idx >= 0) {
      card = game.specialDeck.splice(idx, 1)[0];
    } else {
      card = makeFunc('breed');
    }
    p.funcCards.push(card);
  }
  pushLog(game, '开局：每人获得 1 张「繁殖村民」');
}

const INIT_ANNOUNCE_MS = 3800;
/** 结算动画最长等待（各客户端确认 + 超时兜底） */
const SETTLE_ANIM_MAX_MS = 60000;

function startInitRoll(game) {
  game.phase = 'init_announce';
  game.initRolls = {};
  game.pendingInitReveal = null;
  game.initAnnounceUntil = 0;
  autoResolveFirstPlayer(game);
}

/** 全体自动投骰，平局则全体重投，直到决出唯一先手；暂不发牌 */
function autoResolveFirstPlayer(game) {
  const alive = alivePlayers(game);
  let guard = 0;
  while (guard++ < 40) {
    const rolls = {};
    for (const p of alive) {
      rolls[p.id] = 1 + Math.floor(Math.random() * 6);
    }
    let best = -1;
    let winners = [];
    for (const p of alive) {
      const v = rolls[p.id];
      if (v > best) {
        best = v;
        winners = [p];
      } else if (v === best) {
        winners.push(p);
      }
    }
    if (winners.length > 1) {
      pushLog(
        game,
        `先手平局（${best} 点），${winners.map((p) => p.name).join('、')} 重投`
      );
      continue;
    }
    const first = winners[0];
    game.initRolls = rolls;
    game.produceOrderStartId = first.id;
    game.initAnnounceUntil = Date.now() + INIT_ANNOUNCE_MS;
    game.pendingInitReveal = {
      rolls: { ...rolls },
      firstPlayerId: first.id,
      best,
      announceUntil: game.initAnnounceUntil,
    };
    game.phase = 'init_announce';
    pushLog(game, `${first.name} 掷出 ${best}，成为第 1 轮先手`);
    return;
  }
  // 极端兜底
  const first = alive[0];
  const rolls = Object.fromEntries(alive.map((p) => [p.id, 1]));
  rolls[first.id] = 6;
  game.initRolls = rolls;
  game.produceOrderStartId = first.id;
  game.initAnnounceUntil = Date.now() + INIT_ANNOUNCE_MS;
  game.pendingInitReveal = {
    rolls: { ...rolls },
    firstPlayerId: first.id,
    best: 6,
    announceUntil: game.initAnnounceUntil,
  };
  game.phase = 'init_announce';
  pushLog(game, `${first.name} 成为第 1 轮先手`);
}

/** 先手宣布结束：布置牌桌并进入生产 */
function finishInitAnnounce(game) {
  if (!game || game.phase !== 'init_announce') return { ok: false };
  game.roundProduceBegun = false;
  setupBoard(game);
  maybeBeginProduceAfterSetup(game);
  game.pendingInitReveal = null;
  game.initAnnounceUntil = 0;
  return { ok: true };
}

function resolveInitRoll(game) {
  const alive = alivePlayers(game);
  let best = -1;
  let winners = [];
  for (const p of alive) {
    const v = game.initRolls[p.id];
    if (v == null) return;
    if (v > best) {
      best = v;
      winners = [p];
    } else if (v === best) {
      winners.push(p);
    }
  }
  if (winners.length > 1) {
    // 平局重投（手动模式遗留）
    game.initRolls = {};
    for (const p of alive) game.initRolls[p.id] = null;
    pushLog(
      game,
      `先手平局（${best} 点），${winners.map((p) => p.name).join('、')} 重投`
    );
    return;
  }
  const first = winners[0];
  game.produceOrderStartId = first.id;
  game.initAnnounceUntil = Date.now() + INIT_ANNOUNCE_MS;
  game.pendingInitReveal = {
    rolls: Object.fromEntries(
      alive.map((p) => [p.id, game.initRolls[p.id]])
    ),
    firstPlayerId: first.id,
    best,
    announceUntil: game.initAnnounceUntil,
  };
  game.phase = 'init_announce';
  pushLog(game, `${first.name} 掷出 ${best}，成为第 1 轮先手`);
}

function beginProduce(game) {
  game.phase = 'produce';
  game.roundProduceBegun = true;
  // 新一轮生产（非先手揭晓）时清掉先手揭晓残留
  if (game.round > 1) game.pendingInitReveal = null;
  game.initAnnounceUntil = 0;
  game.dice = {};
  game.diceBoosted = {};
  game.lastPlacerId = null;
  for (const p of alivePlayers(game)) {
    p.dispatched = 0;
    p.voided = 0;
    p.enhancedPlaced = 0;
    p.enhancedDice = Math.min(
      Number(p.enhancedDice) || 0,
      Number(p.villagers) || 0,
      MAX_ENHANCED_DICE
    );
    const grant = Number(p.recruitPending) || 0;
    p.tempVillagers = grant;
    p.recruitPending = 0;
    if (grant > 0) {
      pushLog(game, `${p.name} 征召生效：本轮生产临时村民 +${grant}`);
    }
    p.roundGained = 0;
    p.roundBuiltHouse = false;
    p.roundBred = false;
    p.roundExpanded = false;
  }
  // 清空各大区数字格工人（再补回事件牌上场中立骰）
  clearAllSlotWorkers(game);
  restoreEnvironmentNeutrals(game);
  for (const p of game.players) {
    for (const b of p.buildings) b.workers = 0;
  }

  game.currentPlayerId = game.produceOrderStartId;
  // 跳过已无空闲村民者
  advanceToNextProducer(game, true);
  if (game.phase === 'produce' && game.currentPlayerId) {
    const cur = playerById(game, game.currentPlayerId);
    pushLog(game, `生产阶段开始，轮到 ${cur ? cur.name : '?'}`);
    prepareProduceTurn(game);
  }
}

/** 进入某玩家的生产回合：等待手动投掷（或使用遥控骰子） */
function prepareProduceTurn(game) {
  const p = playerById(game, game.currentPlayerId);
  if (!p || p.left) return;
  game.awaitingProduceRoll = true;
  game.remoteDiceMode = false;
  game.dice[p.id] = [];
  if (!game.diceBoosted) game.diceBoosted = {};
  game.diceBoosted[p.id] = [];
}

function rollForCurrent(game) {
  const p = playerById(game, game.currentPlayerId);
  if (!p || p.left) return;
  const n = idleVillagers(p);
  game.awaitingProduceRoll = false;
  game.remoteDiceMode = false;
  if (n <= 0) {
    game.dice[p.id] = [];
    if (!game.diceBoosted) game.diceBoosted = {};
    game.diceBoosted[p.id] = [];
    return;
  }
  game.dice[p.id] = rollDice(n);
  assignDiceBoostFlags(game, p, n);
  const boostN = (game.diceBoosted[p.id] || []).filter(Boolean).length;
  pushLog(
    game,
    `${p.name} 投掷 ${n} 枚骰子：[${game.dice[p.id].join(', ')}]` +
      (boostN ? `（强化 ${boostN}）` : '')
  );
}

function anyIdleLeft(game) {
  return alivePlayers(game).some((p) => idleVillagers(p) > 0);
}

/**
 * @param {boolean} stayIfSelf 若当前已是可行动玩家则不推进
 */
function advanceToNextProducer(game, stayIfSelf) {
  if (!anyIdleLeft(game)) {
    tryEnterPreSettleMercenaryOrSettle(game);
    return;
  }
  const startId = game.currentPlayerId || game.produceOrderStartId;
  if (!startId) {
    tryEnterPreSettleMercenaryOrSettle(game);
    return;
  }
  let cur = playerById(game, startId);
  if (stayIfSelf && cur && !cur.left && idleVillagers(cur) > 0) {
    return;
  }
  const n = game.players.length;
  let id = startId;
  for (let i = 0; i < n; i++) {
    const next = nextAlive(game, id);
    if (!next) break;
    id = next.id;
    if (idleVillagers(next) > 0) {
      game.currentPlayerId = id;
      return;
    }
  }
  // 一圈都没人有空闲 → 结算（先雇佣军）
  tryEnterPreSettleMercenaryOrSettle(game);
}

function afterProduceAction(game, playerId) {
  game.lastPlacerId = playerId;
  const p = playerById(game, playerId);
  if (p && idleVillagers(p) <= 0) {
    const order = game.produceFinishOrder || (game.produceFinishOrder = []);
    if (!order.includes(playerId)) {
      order.push(playerId);
    }
  }
  if (!anyIdleLeft(game)) {
    tryEnterPreSettleMercenaryOrSettle(game);
    return;
  }
  advanceToNextProducer(game, false);
  if (game.phase === 'produce' && game.currentPlayerId) {
    prepareProduceTurn(game);
  }
}

// ─── 结算 ───────────────────────────────────────────────

function collectSettleBuildingReport(game, report) {
  for (const p of alivePlayers(game)) {
    for (const b of p.buildings) {
      if (!b.built || b.buildType !== 'produce') continue;
      const amt = b.produce || 0;
      if (amt <= 0) continue;
      report.buildings.push({
        pid: p.id,
        name: p.name,
        label: b.label,
        resource: b.resource,
        amount: amt,
      });
    }
  }
}

function applySettleBuildingProduce(game, report) {
  for (const entry of report.buildings || []) {
    const p = playerById(game, entry.pid);
    if (!p || !entry.resource) continue;
    const amt = Number(entry.amount) || 0;
    if (amt <= 0) continue;
    p.resources[entry.resource] = (p.resources[entry.resource] || 0) + amt;
    p.roundGained += amt;
  }
}

function logSettleRoundMvp(game) {
  let maxG = -1;
  let top = [];
  for (const p of alivePlayers(game)) {
    if (p.roundGained > maxG) {
      maxG = p.roundGained;
      top = [p];
    } else if (p.roundGained === maxG) {
      top.push(p);
    }
  }
  if (maxG > 0 && top.length === 1) {
    pushLog(
      game,
      `${top[0].name} 本轮获取资源最多（${maxG}）`
    );
  } else if (maxG > 0 && top.length > 1) {
    pushLog(
      game,
      `本轮资源并列最多（${maxG}）：${top.map((p) => p.name).join('、')}`
    );
  }
}

function beginSettleActPhase(game, scope) {
  const settleScope = scope || 'all';
  syncAllDiscardPending(game);
  if (!playerNeedsSettleActForScope(game, settleScope)) {
    advancePostSettlePipeline(game);
    return;
  }
  game.phase = 'settle_act';
  game.settleActScope = settleScope;
  game.settleActPassed = {};
  game.currentPlayerId = null;
  pushLog(
    game,
    settleScope === 'card'
      ? '—— 弃牌阶段：处理超上限功能/建筑卡 ——'
      : settleScope === 'resource'
        ? '—— 弃牌阶段：处理超上限资源 ——'
        : '—— 弃牌阶段 ——'
  );
}

function playerNeedsSettleActForScope(game, scope) {
  return alivePlayers(game).some((p) => playerNeedsSettleAct(p, scope));
}

function completeSettleAfterAnim(game) {
  if (!game || game.phase !== 'settle') return { ok: false };
  game.settleAnimAcks = {};
  game.settleAnimUntil = 0;
  game.personalProduceApplied = false;
  // 结算动画结束后再回收场上未取走的板块与工人骰子
  recycleBoard(game);
  clearAllSlotWorkers(game);
  for (const p of game.players) {
    for (const b of p.buildings || []) b.workers = 0;
  }
  // 生产结算结束后清空歉收标记
  game.barrenMarkerNumber = null;
  game.barrenMarkerArea = null;
  game.barrenMarkerOwnerId = null;
  advancePostSettlePipeline(game);
  return { ok: true };
}

function finishSettleAnim(game, playerId) {
  if (!game || game.phase !== 'settle') {
    return { ok: false, error: '当前不在结算动画阶段' };
  }
  const player = playerById(game, playerId);
  if (!player || player.left) {
    return { ok: false, error: '玩家无效' };
  }
  game.settleAnimAcks = game.settleAnimAcks || {};
  game.settleAnimAcks[playerId] = true;
  const alive = alivePlayers(game);
  if (alive.every((p) => game.settleAnimAcks[p.id])) {
    completeSettleAfterAnim(game);
  }
  return { ok: true };
}

function finishSettleAnimForce(game) {
  if (!game || game.phase !== 'settle') return { ok: false };
  game.settleAnimAcks = game.settleAnimAcks || {};
  for (const p of alivePlayers(game)) {
    game.settleAnimAcks[p.id] = true;
  }
  return completeSettleAfterAnim(game);
}

function startSettle(game) {
  game.phase = 'settle';
  game.currentPlayerId = null;
  game.dice = {};
  game.diceBoosted = {};
  game.pendingEventChoice = null;
  game.pendingPrisonerDiscards = {};
  game.pendingMercenaryQueue = [];
  game.pendingKeepOverflowQueue = [];
  game.mercenaryRoll = null;
  game.mercenaryPlaced = [];
  for (const p of alivePlayers(game)) {
    p.skipSettleResourceDiscard = false;
    const temp = Number(p.tempVillagers) || 0;
    if (temp > 0) {
      pushLog(game, `${p.name} 的 ${temp} 名临时村民在生产结束后消失`);
      p.tempVillagers = 0;
    }
  }
  const report = {
    at: Date.now(),
    round: game.round,
    slots: [],
    buildings: [],
  };
  pushLog(game, '—— 进入结算阶段 ——');

  for (const p of alivePlayers(game)) {
    p.pendingWishWellBonus = 0;
  }

  // 资源区：按数字格汇总派遣强度（强化骰计 1.5），最多者拿大份，第二拿小份
  const skipSecondShare = new Set();
  for (let num = 1; num <= 6; num++) {
    const workers = game.board.resource.workers[num] || {};
    const boosts =
      (game.board.resource.boosts && game.board.resource.boosts[num]) || {};
    const tiles = tilesOnNumber(game.board.resource, num);
    if (!tiles.length && !Object.keys(workers).length) continue;

    for (const tile of tiles) {
      if (tile.faceDown) tile.faceDown = false;
    }

    const before = slotStrengthMap(workers, boosts);
    const remain = cancelEqualCounts(before);
    const ranked = mapRanked(game, remain, workers);
    const gains = [];
    const barren = isBarrenMarkerOn(game, 'resource', num);

    // 事件牌：结算触发（在发放资源前）
    applyEnvironmentOnSettleSlot(game, {
      number: num,
      tiles,
      ranked,
      before,
      remain,
      physical: { ...workers },
      playerById,
      pushLog,
      syncResourceHandPending,
      skipSecondShare,
      alivePlayers,
      checkWin,
      takeEventSideCard,
    });

    if (!barren && ranked[0] && tiles.length && ranked[0].pid !== NEUTRAL_WORKER_ID) {
      const p = playerById(game, ranked[0].pid);
      if (p) {
        const got = grantBoardResourceShare(p, tiles, 'large');
        p.roundGained += got.total;
        gains.push({
          pid: p.id,
          name: p.name,
          amount: got.total,
          rank: 1,
          detail: got.detail,
        });
      }
    }
    if (
      !barren &&
      ranked[1] &&
      tiles.length &&
      !skipSecondShare.has(num) &&
      ranked[1].pid !== NEUTRAL_WORKER_ID
    ) {
      const p = playerById(game, ranked[1].pid);
      if (p) {
        const got = grantBoardResourceShare(p, tiles, 'small');
        p.roundGained += got.total;
        gains.push({
          pid: p.id,
          name: p.name,
          amount: got.total,
          rank: 2,
          detail: got.detail,
        });
      }
    } else if (!barren && ranked[1] && tiles.length && skipSecondShare.has(num)) {
      if (ranked[0] && ranked[0].pid !== NEUTRAL_WORKER_ID) {
        const p0 = playerById(game, ranked[0].pid);
        if (p0) {
          const absorbed = grantBoardResourceShare(p0, tiles, 'small');
          if (absorbed.total > 0) {
            p0.roundGained += absorbed.total;
            const firstGain = gains.find(
              (g) => g.pid === p0.id && g.rank === 1
            );
            if (firstGain) {
              mergeResourceGainDetail(firstGain, absorbed);
            } else {
              gains.push({
                pid: p0.id,
                name: p0.name,
                amount: absorbed.total,
                rank: 1,
                detail: absorbed.detail,
              });
            }
          }
          pushLog(
            game,
            `资源格 ${num}：一山不容二虎，第二名 ${ranked[1].name} 未获小份，` +
              `第一名 ${ranked[0].name} 额外获得小份`
          );
        }
      } else {
        pushLog(
          game,
          `资源格 ${num}：一山不容二虎，第二名 ${ranked[1].name} 未获得小份`
        );
      }
    }
    if (barren && (tiles.length || Object.keys(before).length)) {
      pushLog(game, `资源格 ${num}：颗粒无收标记生效，本格不发放资源`);
    }

    applyEnvironmentAfterShare(game, {
      number: num,
      ranked,
      gains,
      playerById,
      pushLog,
      syncResourceHandPending,
    });

    report.slots.push({
      area: 'resource',
      number: num,
      before,
      remain,
      cancelled: cancelledEntries(before, remain),
      ranked,
      tiles: summarizeTiles(tiles),
      gains,
      claimedBy: null,
      boosts: { ...boosts },
      physical: { ...workers },
      barren: Boolean(barren),
      barrenMarker: isBarrenMarkerOn(game, 'resource', num),
    });

    if (gains.length) {
      for (const g of gains) {
        pushLog(game, formatSettleResourceGainLog(num, g, 'resource'));
      }
    } else if (Object.keys(before).length && !barren) {
      pushLog(game, `资源格 ${num}：全部抵消，无人采集`);
    }
  }

  game.pendingPrisonerDiscards = game.pendingPrisonerDiscards || {};
  game.pendingMercenaryQueue = game.pendingMercenaryQueue || [];

  for (const p of alivePlayers(game)) {
    const n = countBuiltWishWell(p);
    if (n > 0) {
      p.pendingWishWellBonus = n;
      pushLog(
        game,
        `${p.name} 许愿井：生产阶段结束后可选择任意资源 +1 ×${n}`
      );
    }
  }

  // 功能/建筑合区：按数字格汇总强度，最多者按卡类型分别收取
  for (let num = 1; num <= 6; num++) {
    const workers = game.board.special.workers[num] || {};
    const boosts =
      (game.board.special.boosts && game.board.special.boosts[num]) || {};
    const tiles = tilesOnNumber(game.board.special, num);
    if (!tiles.length && !Object.keys(workers).length) continue;

    const before = slotStrengthMap(workers, boosts);
    const remain = cancelEqualCounts(before);
    const ranked = mapRanked(game, remain, workers);
    let claimedBy = null;
    const barren = isBarrenMarkerOn(game, 'special', num);

    if (!barren && ranked[0] && tiles.length) {
      const p = playerById(game, ranked[0].pid);
      if (p) {
        for (const tile of tiles) {
          if (deckKindOfTile(tile) === 'building') {
            takeBuildingCard(game, p, tile);
          } else {
            takeFunctionCard(game, p, tile);
          }
        }
        game.board.special.tiles = game.board.special.tiles.filter(
          (t) => t.number !== num
        );
        claimedBy = {
          pid: p.id,
          name: p.name,
          count: ranked[0].count,
          dice: physicalDiceOnSlot(workers, p.id),
        };
        const needsBuildPlacement = tiles.some((t) => {
          if (deckKindOfTile(t) !== 'building') return false;
          const { number: _n, ...card } = t;
          return !isInstantScoreBuilding(card);
        });
        pushLog(
          game,
          `${p.name} 以强度 ${ranked[0].count} 取得功能/建筑格 ${num} 全部卡：` +
            tiles.map(tileLogLabel).join('、') +
            (needsBuildPlacement ? '（建筑需选择格子放置）' : '')
        );
      }
    } else if (barren && (tiles.length || Object.keys(before).length)) {
      pushLog(game, `功能/建筑格 ${num}：颗粒无收标记生效，本格无人取得卡牌`);
    } else if (Object.keys(before).length) {
      pushLog(game, `功能/建筑格 ${num}：全部抵消，无人取得`);
    }

    report.slots.push({
      area: 'special',
      number: num,
      before,
      remain,
      cancelled: cancelledEntries(before, remain),
      ranked,
      tiles: summarizeTiles(tiles),
      gains: [],
      claimedBy,
      boosts: { ...boosts },
      physical: { ...workers },
      barren: Boolean(barren),
      barrenMarker: isBarrenMarkerOn(game, 'special', num),
    });
  }

  collectSettleBuildingReport(game, report);
  for (const entry of report.buildings || []) {
    if (!entry.resource) continue;
    const amt = Number(entry.amount) || 0;
    if (amt <= 0) continue;
    pushLog(
      game,
      `${entry.name} 的${entry.label}产出 ${amt} ${RESOURCE_LABELS[entry.resource] || entry.resource}`
    );
  }

  // 生产结算后、弃牌前：抵抗南蛮等（按名次从第一名起发分，达 15 立刻结束）
  applyResistBarbariansAfterSettle(game, report, {
    playerById,
    pushLog,
    checkWin,
  });
  applyKeepOverflowAfterSettle(game, report, {
    playerById,
    pushLog,
    syncResourceHandPending,
  });
  if (game.over) {
    game.lastSettle = report;
    return;
  }

  game.lastSettle = report;

  // 工人骰子与版面卡牌均保留至结算动画结束后回收（见 completeSettleAfterAnim）
  game.phase = 'settle';
  game.currentPlayerId = null;
  game.settleAnimAcks = {};
  game.settleAnimUntil = Date.now() + SETTLE_ANIM_MAX_MS;
  pushLog(game, '—— 结算动画播放中 ——');
}

function takeFunctionCard(game, player, tile) {
  const { number, ...card } = tile;
  if (grantInstantScoreBuilding(game, player, card)) {
    return;
  }
  receiveFunctionCard(game, player, card);
}

/** 入手功能卡（对持有者明示） */
function receiveFunctionCard(game, player, card) {
  player.funcCards.push({
    ...card,
    faceDown: false,
  });
  syncFuncHandPending(player);
}

function isInstantScoreBuilding(card) {
  return Boolean(
    card && (card.buildType === 'score1' || card.instantScore)
  );
}

/** 学堂等：入手即 +1 胜利点并进弃牌堆，不占建筑格 */
function grantInstantScoreBuilding(game, player, card) {
  if (!isInstantScoreBuilding(card)) {
    return false;
  }
  const pts = Math.max(1, Number(card.score) || 1);
  player.bonusScore = (Number(player.bonusScore) || 0) + pts;
  pushToDiscard(game, 'building', {
    ...card,
    faceDown: false,
    slot: null,
    built: false,
    workers: 0,
  });
  const stepText =
    `${player.name} 获得「${card.label || '学堂'}」：立刻 +${pts} 胜利点（置入弃牌堆）`;
  pushLog(game, stepText);
  pushPlayReveal(game, {
    kind: 'building',
    actorId: player.id,
    actorName: player.name,
    card: {
      id: card.id,
      label: card.label,
      buildType: card.buildType,
      score: pts,
    },
    stepText,
  });
  checkWin(game);
  return true;
}

function takeBuildingCard(game, player, tile) {
  const { number, ...card } = tile;
  if (grantInstantScoreBuilding(game, player, card)) {
    return;
  }
  // 入手后对持有者明示；他人在 publicBuilding 中仍看不到未建造内容
  const neu = {
    ...card,
    faceDown: false,
    slot: null,
    built: false,
    workers: 0,
  };
  if (!assignBuildingSlot(player, neu)) {
    const hasUnbuilt = (player.buildings || []).some((b) => !b.built);
    if (!hasUnbuilt) {
      pushToDiscard(game, 'building', neu);
      pushLog(
        game,
        `${player.name} 建筑格已满且均已建造，弃置刚获得的建筑「${neu.label || '?'}」（入弃牌堆）`
      );
      return;
    }
    queuePendingBuildCard(player, neu);
  } else {
    player.buildings.push(neu);
  }
}

function ensurePendingBuildQueue(player) {
  if (!player || !player.pendingDiscardBuild) return [];
  const pending = player.pendingDiscardBuild;
  if (Array.isArray(pending.newCards)) return pending.newCards;
  if (pending.newCard) {
    pending.newCards = [pending.newCard];
    return pending.newCards;
  }
  pending.newCards = [];
  return pending.newCards;
}

function queuePendingBuildCard(player, card) {
  if (!player || !card) return;
  if (!player.pendingDiscardBuild) {
    player.pendingDiscardBuild = { newCard: card, newCards: [card] };
    return;
  }
  const q = ensurePendingBuildQueue(player);
  q.push(card);
  player.pendingDiscardBuild.newCard = q[0] || null;
}

function popPendingBuildCard(player) {
  if (!player || !player.pendingDiscardBuild) return null;
  const q = ensurePendingBuildQueue(player);
  if (!q.length) {
    player.pendingDiscardBuild = null;
    return null;
  }
  const card = q.shift() || null;
  if (!q.length) {
    player.pendingDiscardBuild = null;
  } else {
    player.pendingDiscardBuild.newCard = q[0];
  }
  return card;
}

/** 幸运一抽等：发放暗置的功能/建筑牌 */
function takeEventSideCard(game, player, card) {
  if (!card) return;
  if (deckKindOfTile(card) === 'building') {
    takeBuildingCard(game, player, { ...card, number: undefined });
  } else {
    receiveFunctionCard(game, player, card);
  }
}

function finishPendingEventChoice(game) {
  const choice = game.pendingEventChoice;
  game.pendingEventChoice = null;
  if (!choice || !choice.playerId) return;
  // 雇佣军放置触发的派遣事件：选择完成后继续雇佣军流程，勿走生产推进
  if (choice.resume === 'mercenary') {
    continueAfterMercenaryDie(game);
    return;
  }
  if (choice.resume === 'welfareSetup') {
    tryFinishWelfareMinimumConcurrent(game);
    return;
  }
  if (choice.resume === 'keepOverflow') {
    if (tryStartNextKeepOverflowChoice(game)) return;
    advancePostSettlePipeline(game);
    return;
  }
  afterProduceAction(game, choice.playerId);
}

function actEventPickResource(game, player, payload) {
  const pending = game.pendingEventChoice;
  if (
    !pending ||
    pending.playerId !== player.id ||
    pending.needChoice !== 'pickResource'
  ) {
    return { ok: false, error: '当前无需选择资源' };
  }
  const resource = payload && payload.resource;
  if (!RESOURCES.includes(resource)) {
    return { ok: false, error: '请选择一种资源' };
  }
  player.resources[resource] = (player.resources[resource] || 0) + 1;
  player.roundGained = (player.roundGained || 0) + 1;
  syncResourceHandPending(player, game);
        pushLog(
          game,
    `${player.name}「${pending.label}」：获得 1 ${RESOURCE_LABELS[resource]}`
  );
  finishPendingEventChoice(game);
  return { ok: true };
}

function actEventPickTwoResources(game, player, payload) {
  const welfarePending =
    game.pendingWelfareMinimumChoices &&
    game.pendingWelfareMinimumChoices[player.id];
  const pending = welfarePending || game.pendingEventChoice;
  if (
    !pending ||
    (!welfarePending && pending.playerId !== player.id) ||
    pending.needChoice !== 'pickTwoResources'
  ) {
    return { ok: false, error: '当前无需选择资源' };
  }
  const amounts = (payload && payload.amounts) || {};
  let total = 0;
  const detail = [];
  for (const r of RESOURCES) {
    const n = Math.floor(Number(amounts[r]) || 0);
    if (n < 0) return { ok: false, error: '选择数量无效' };
    if (n > 0) {
      total += n;
      detail.push({ resource: r, amount: n });
    }
  }
  const count = pending.count || 2;
  if (total !== count) {
    return { ok: false, error: `请恰好选择 ${count} 个资源` };
  }
  for (const d of detail) {
    player.resources[d.resource] = (player.resources[d.resource] || 0) + d.amount;
    player.roundGained = (Number(player.roundGained) || 0) + d.amount;
  }
  syncResourceHandPending(player, game);
  pushLog(
    game,
    `${player.name}「${pending.label}」：获得 ` +
      detail
        .map((d) => `${d.amount} ${RESOURCE_LABELS[d.resource]}`)
        .join('、')
  );
  if (welfarePending) {
    delete game.pendingWelfareMinimumChoices[player.id];
    tryFinishWelfareMinimumConcurrent(game);
  } else {
    finishPendingEventChoice(game);
  }
  return { ok: true };
}

function actEventMoveBarrenMarker(game, player, payload) {
  const pending = game.pendingEventChoice;
  if (
    !pending ||
    pending.playerId !== player.id ||
    pending.needChoice !== 'moveBarrenMarker'
  ) {
    return { ok: false, error: '当前无需移动标记' };
  }
  const area = (payload && payload.area) || 'resource';
  const number = Number(payload && payload.number);
  if (!BOARD_AREAS.includes(area)) {
    return { ok: false, error: '请选择资源或功能/建筑区' };
  }
  if (!Number.isInteger(number) || number < 1 || number > 6) {
    return { ok: false, error: '请选择数字格 1–6' };
  }
  if (area === 'special' && number > areaOpenSlotCount('special', game.round)) {
    return { ok: false, error: '该功能/建筑区数字格尚未解锁' };
  }
  game.barrenMarkerArea = area;
  game.barrenMarkerNumber = number;
  game.barrenMarkerOwnerId = player.id;
  const areaLab = area === 'special' ? '功能/建筑' : '资源';
  pushLog(
    game,
    `${player.name}「${pending.label}」：将标记移到${areaLab}格 ${number}`
  );
  finishPendingEventChoice(game);
  return { ok: true };
}

function slotPlayerDieCounts(areaBoard, number, targetId) {
  const slotW = (areaBoard.workers && areaBoard.workers[number]) || {};
  const physical = Number(slotW[targetId]) || 0;
  if (physical <= 0) {
    return { physical: 0, normal: 0, enhanced: 0 };
  }
  const slotB = (areaBoard.boosts && areaBoard.boosts[number]) || {};
  const enhanced = Math.min(Math.max(0, Number(slotB[targetId]) || 0), physical);
  return { physical, normal: physical - enhanced, enhanced };
}

function removeOneDieFromBoardSlot(game, area, number, targetId, dieKind) {
  if (!BOARD_AREAS.includes(area)) {
    return { ok: false, error: '请选择资源/功能/建筑区' };
  }
  if (!Number.isInteger(number) || number < 1 || number > 6) {
    return { ok: false, error: '数字格无效' };
  }
  const areaBoard = game.board[area];
  const slotW = areaBoard.workers[number] || {};
  if ((slotW[targetId] || 0) < 1) {
    return { ok: false, error: '该格没有可移动的骰子' };
  }

  if (targetId === NEUTRAL_WORKER_ID) {
    slotW[targetId] -= 1;
    if (slotW[targetId] <= 0) delete slotW[targetId];
    return { ok: true, wasEnhanced: false };
  }

  const counts = slotPlayerDieCounts(areaBoard, number, targetId);
  let removeEnhanced = false;
  if (dieKind === true || dieKind === 'enhanced') {
    if (counts.enhanced < 1) {
      return { ok: false, error: '该格没有强化骰' };
    }
    removeEnhanced = true;
  } else if (dieKind === false || dieKind === 'normal') {
    if (counts.normal < 1) {
      return { ok: false, error: '该格没有普通骰' };
    }
    removeEnhanced = false;
  } else if (counts.normal > 0 && counts.enhanced > 0) {
    return { ok: false, error: '请选择普通骰或强化骰' };
  } else {
    removeEnhanced = counts.enhanced > 0;
  }

  slotW[targetId] -= 1;
  if (removeEnhanced) {
    if (!areaBoard.boosts) areaBoard.boosts = emptySlotWorkers();
    const slotB = areaBoard.boosts[number] || (areaBoard.boosts[number] = {});
    slotB[targetId] = Math.max(0, (Number(slotB[targetId]) || 0) - 1);
    if (slotB[targetId] <= 0) delete slotB[targetId];
    const owner = playerById(game, targetId);
    if (owner) {
      owner.enhancedPlaced = Math.max(
        0,
        (Number(owner.enhancedPlaced) || 0) - 1
      );
    }
  }
  if (slotW[targetId] <= 0) delete slotW[targetId];

  return { ok: true, wasEnhanced: removeEnhanced };
}

function placeOneDieOnBoardSlot(game, area, number, targetId, wasEnhanced) {
  if (!BOARD_AREAS.includes(area)) {
    return { ok: false, error: '请选择资源/功能/建筑区' };
  }
  if (!Number.isInteger(number) || number < 1 || number > 6) {
    return { ok: false, error: '数字格无效' };
  }
  if (area === 'special' && number > areaOpenSlotCount('special', game.round)) {
    return { ok: false, error: '该功能/建筑区数字格尚未解锁' };
  }
  const tiles = tilesOnNumber(game.board[area], number);
  if (!tiles.length) {
    return { ok: false, error: `${AREA_LABELS[area]}区 ${number} 号格没有板块` };
  }
  const areaBoard = game.board[area];
  const slotW = areaBoard.workers[number] || (areaBoard.workers[number] = {});
  slotW[targetId] = (slotW[targetId] || 0) + 1;
  if (wasEnhanced && targetId !== NEUTRAL_WORKER_ID) {
    if (!areaBoard.boosts) areaBoard.boosts = emptySlotWorkers();
    const slotB = areaBoard.boosts[number] || (areaBoard.boosts[number] = {});
    slotB[targetId] = (slotB[targetId] || 0) + 1;
    const owner = playerById(game, targetId);
    if (owner) {
      owner.enhancedPlaced = (Number(owner.enhancedPlaced) || 0) + 1;
    }
  }
  return { ok: true };
}

function teleportWorkerLabel(game, targetId) {
  if (targetId === NEUTRAL_WORKER_ID) return NEUTRAL_WORKER_NAME;
  const p = playerById(game, targetId);
  return p ? p.name : String(targetId);
}

function recallOneDieFromSlot(game, player, area, number, dieKind) {
  const pid = player.id;
  const removed = removeOneDieFromBoardSlot(game, area, number, pid, dieKind);
  if (!removed.ok) {
    if (removed.error === '该格没有可移动的骰子') {
      return { ok: false, error: '你在该格没有骰子' };
    }
    return removed;
  }
  const wasEnhanced = removed.wasEnhanced;

  const face = number;
  if (!game.dice[pid]) game.dice[pid] = [];
  game.dice[pid].push(face);
  if (!game.diceBoosted) game.diceBoosted = {};
  if (!game.diceBoosted[pid]) game.diceBoosted[pid] = [];
  game.diceBoosted[pid].push(wasEnhanced);

  player.dispatched = Math.max(0, (Number(player.dispatched) || 0) - 1);

  return { ok: true, face, wasEnhanced };
}

function actEventRecallDie(game, player, payload) {
  const pending = game.pendingEventChoice;
  if (
    !pending ||
    pending.playerId !== player.id ||
    pending.needChoice !== 'recallDie'
  ) {
    return { ok: false, error: '当前无需召回骰子' };
  }
  const area = payload && payload.area;
  const number = Number(payload && payload.number);
  const exArea = pending.excludeArea || 'resource';
  const exNum = Number(pending.excludeNumber != null ? pending.excludeNumber : pending.number);
  const justPlaced = Math.max(0, Number(pending.justPlacedCount) || 0);
  if (area === exArea && number === exNum) {
    const own =
      Number(((game.board[area].workers[number] || {})[player.id]) || 0);
    if (own <= justPlaced) {
      return { ok: false, error: '不可召回刚放置的骰子' };
    }
  }
  const dieKind =
    payload && typeof payload.enhanced === 'boolean' ? payload.enhanced : undefined;
  const recalled = recallOneDieFromSlot(game, player, area, number, dieKind);
  if (!recalled.ok) return recalled;
  pushProduceFx(game, {
    type: 'recall',
    actorId: player.id,
    area,
    number,
    face: recalled.face,
    enhanced: recalled.wasEnhanced,
        });
        pushLog(
          game,
    `${player.name}「${pending.label}」：从${AREA_LABELS[area]}区 ${number} 号格召回 1 枚骰子` +
      (recalled.wasEnhanced ? '（强化）' : '')
  );
  finishPendingEventChoice(game);
  return { ok: true };
}

function actEventTeleportFrom(game, player, payload) {
  const pending = game.pendingEventChoice;
  if (
    !pending ||
    pending.playerId !== player.id ||
    pending.needChoice !== 'teleportDie' ||
    pending.teleportStep !== 'from'
  ) {
    return { ok: false, error: '当前无需选择传送来源' };
  }
  const area = payload && payload.area;
  const number = Number(payload && payload.number);
  const targetId = payload && payload.targetId;
  if (!BOARD_AREAS.includes(area)) {
    return { ok: false, error: '请选择资源/功能/建筑区' };
  }
  if (!Number.isInteger(number) || number < 1 || number > 6) {
    return { ok: false, error: '数字格无效' };
  }
  if (!targetId) {
    return { ok: false, error: '请选择骰子归属' };
  }
  const slotW = (game.board[area].workers[number] || {});
  if ((slotW[targetId] || 0) < 1) {
    return { ok: false, error: '该格没有可传送的骰子' };
  }
  const dieKind =
    payload && typeof payload.enhanced === 'boolean'
      ? payload.enhanced
      : undefined;
  game.pendingEventChoice = {
    ...pending,
    teleportStep: 'to',
    fromArea: area,
    fromNumber: number,
    fromTargetId: targetId,
    fromDieKind: dieKind,
  };
  return { ok: true };
}

function actEventTeleportTo(game, player, payload) {
  const pending = game.pendingEventChoice;
  if (
    !pending ||
    pending.playerId !== player.id ||
    pending.needChoice !== 'teleportDie' ||
    pending.teleportStep !== 'to'
  ) {
    return { ok: false, error: '当前无需选择传送目标' };
  }
  const fromArea = pending.fromArea;
  const fromNumber = Number(pending.fromNumber);
  const fromTargetId = pending.fromTargetId;
  const toArea = payload && payload.area;
  const toNumber = Number(payload && payload.number);
  if (!BOARD_AREAS.includes(toArea)) {
    return { ok: false, error: '请选择资源/功能/建筑区' };
  }
  if (!Number.isInteger(toNumber) || toNumber < 1 || toNumber > 6) {
    return { ok: false, error: '数字格无效' };
  }
  if (fromArea === toArea && fromNumber === toNumber) {
    return { ok: false, error: '传送目标不能与来源相同' };
  }
  const removed = removeOneDieFromBoardSlot(
    game,
    fromArea,
    fromNumber,
    fromTargetId,
    pending.fromDieKind
  );
  if (!removed.ok) return removed;
  const placed = placeOneDieOnBoardSlot(
    game,
    toArea,
    toNumber,
    fromTargetId,
    removed.wasEnhanced
  );
  if (!placed.ok) {
    placeOneDieOnBoardSlot(
      game,
      fromArea,
      fromNumber,
      fromTargetId,
      removed.wasEnhanced
    );
    return placed;
  }
  pushProduceFx(game, {
    type: 'teleport',
    actorId: player.id,
    fromArea,
    fromNumber,
    toArea,
    number: toNumber,
    targetId: fromTargetId,
    enhanced: removed.wasEnhanced,
  });
  const teleportLabel = pending.label;
  pushLog(
    game,
    `${player.name}「${teleportLabel}」：将 ${teleportWorkerLabel(game, fromTargetId)} 的骰子从${AREA_LABELS[fromArea]}区 ${fromNumber} 号格传送到${AREA_LABELS[toArea]}区 ${toNumber} 号格` +
      (removed.wasEnhanced ? '（强化）' : '')
  );
  // 清传送 pending，再按落点触发派遣事件（与雇佣军落点一致；派遣者=发动传送的玩家）
  game.pendingEventChoice = null;
  const ev = applyEnvironmentOnDispatch(game, {
    player,
    area: toArea,
    number: toNumber,
    count: 1,
    pushLog,
    syncResourceHandPending,
  });
  if (ev && ev.needChoice) {
    game.pendingEventChoice = {
      ...ev,
      playerId: player.id,
    };
    pushLog(
      game,
      `${player.name} 传送落点触发「${ev.label}」，请完成事件选择`
    );
    return { ok: true, pendingEvent: game.pendingEventChoice };
  }
  afterProduceAction(game, player.id);
  return { ok: true };
}

function actEventMoveNeutral(game, player, payload) {
  const pending = game.pendingEventChoice;
  if (
    !pending ||
    pending.playerId !== player.id ||
    pending.needChoice !== 'moveNeutral'
  ) {
    return { ok: false, error: '当前无需移动中立骰' };
  }
  const toArea = payload && payload.area;
  const toNumber = Number(payload && payload.number);
  if (!BOARD_AREAS.includes(toArea)) {
    return { ok: false, error: '请选择资源或功能/建筑区' };
  }
  if (!Number.isInteger(toNumber) || toNumber < 1 || toNumber > 6) {
    return { ok: false, error: '请选择数字格 1–6' };
  }
  if (toArea === 'special' && toNumber > areaOpenSlotCount('special', game.round)) {
    return { ok: false, error: '该功能/建筑区数字格尚未解锁' };
  }
  const fromArea = pending.fromArea || 'resource';
  const fromNumber = Number(pending.fromNumber) || Number(pending.number);
  if (neutralCountOn(game, fromArea, fromNumber) <= 0) {
    return { ok: false, error: '本格已无中立骰' };
  }
  const fromW =
    game.board[fromArea].workers[fromNumber] ||
    (game.board[fromArea].workers[fromNumber] = {});
  fromW[NEUTRAL_WORKER_ID] -= 1;
  if (fromW[NEUTRAL_WORKER_ID] <= 0) delete fromW[NEUTRAL_WORKER_ID];
  const toW =
    game.board[toArea].workers[toNumber] ||
    (game.board[toArea].workers[toNumber] = {});
  toW[NEUTRAL_WORKER_ID] = (toW[NEUTRAL_WORKER_ID] || 0) + 1;
    pushLog(
      game,
    `${player.name}「${pending.label}」：中立骰 ${fromArea}${fromNumber} → ${toArea}${toNumber}`
  );
  finishPendingEventChoice(game);
  return { ok: true };
}

function actEventGatherNeutrals(game, player, payload) {
  const pending = game.pendingEventChoice;
  if (
    !pending ||
    pending.playerId !== player.id ||
    pending.needChoice !== 'gatherNeutrals'
  ) {
    return { ok: false, error: '当前无需集中中立骰' };
  }
  const fromArea = payload && payload.area;
  const fromNumber = Number(payload && payload.number);
  const toArea = pending.toArea || 'resource';
  const toNumber = Number(pending.toNumber != null ? pending.toNumber : pending.number);
  if (!BOARD_AREAS.includes(fromArea)) {
    return { ok: false, error: '请选择资源/功能/建筑区' };
  }
  if (!Number.isInteger(fromNumber) || fromNumber < 1 || fromNumber > 6) {
    return { ok: false, error: '数字格无效' };
  }
  if (fromArea === toArea && fromNumber === toNumber) {
    return { ok: false, error: '请选择其他板块' };
  }
  const moved = moveAllNeutralsBetweenSlots(
    game,
    fromArea,
    fromNumber,
    toArea,
    toNumber
  );
  if (!moved.ok) return moved;
  pushLog(
    game,
    `${player.name}「${pending.label}」：将${AREA_LABELS[fromArea]}区 ${fromNumber} 号格的 ${moved.count} 枚中立骰集中到${AREA_LABELS[toArea]}区 ${toNumber} 号格`
  );
  finishPendingEventChoice(game);
  return { ok: true };
}

function actMercenaryRoll(game, player) {
  if (game.phase !== 'event_mercenary') {
    return { ok: false, error: '当前不在雇佣军阶段' };
  }
  const cur = (game.pendingMercenaryQueue || [])[0];
  if (!cur || cur.playerId !== player.id) {
    return { ok: false, error: '未轮到你处理雇佣军' };
  }
  if (game.mercenaryRoll && game.mercenaryRoll.length) {
    return { ok: false, error: '已投掷过' };
  }
  const n = Number(cur.diceCount) || 2;
  game.mercenaryRoll = rollDice(n);
  game.mercenaryPlaced = [];
  pushLog(
    game,
    `${player.name} 雇佣军投掷：[${game.mercenaryRoll.join(', ')}]`
  );
  return { ok: true };
}

function actMercenaryPlace(game, player, payload) {
  if (game.phase !== 'event_mercenary') {
    return { ok: false, error: '当前不在雇佣军阶段' };
  }
  if (game.pendingEventChoice) {
    return { ok: false, error: '请先完成事件牌选择' };
  }
  const cur = (game.pendingMercenaryQueue || [])[0];
  if (!cur || cur.playerId !== player.id) {
    return { ok: false, error: '未轮到你处理雇佣军' };
  }
  const roll = game.mercenaryRoll || [];
  if (!roll.length) return { ok: false, error: '请先投掷' };
  const idx = Number(payload && payload.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= roll.length) {
    return { ok: false, error: '骰子序号无效' };
  }
  if ((game.mercenaryPlaced || []).includes(idx)) {
    return { ok: false, error: '该骰已处理' };
  }
  const face = roll[idx];
  const skip = Boolean(payload && payload.skip);
  game.mercenaryPlaced = [...(game.mercenaryPlaced || []), idx];

  if (!skip) {
    const area = payload.area || 'resource';
    if (!BOARD_AREAS.includes(area)) {
      return { ok: false, error: '请选择资源/功能/建筑区' };
    }
    const tiles = tilesOnNumber(game.board[area], face);
    if (!tiles.length) {
      return { ok: false, error: `${AREA_LABELS[area]}区 ${face} 号格没有板块` };
    }
    // 将雇佣骰实际放置到板块上，使其在结算阶段可被统计并正确显示
    const areaBoard = game.board[area];
    const slotW = areaBoard.workers[face] || (areaBoard.workers[face] = {});
    slotW[player.id] = (slotW[player.id] || 0) + 1;
    if (area === 'resource') {
      const got = grantBoardResourceShare(player, tiles, 'large');
      player.roundGained += got.total;
      syncResourceHandPending(player, game);
      pushLog(
        game,
        `${player.name} 雇佣军放置 ${face}：获得大份 +${got.total}`
      );
  } else {
      pushLog(
        game,
        `${player.name} 雇佣军放置 ${face}：${AREA_LABELS[area]}区`
      );
    }
    // 放到有「派遣触发」事件的格上时，同样触发
    const ev = applyEnvironmentOnDispatch(game, {
      player,
      area,
      number: face,
      count: 1,
      pushLog,
      syncResourceHandPending,
    });
    if (ev && ev.needChoice) {
      game.pendingEventChoice = {
        ...ev,
        playerId: player.id,
        resume: 'mercenary',
      };
      pushLog(
        game,
        `${player.name} 雇佣军放置触发「${ev.label}」，请完成事件选择`
      );
      return { ok: true, pendingEvent: game.pendingEventChoice };
    }
  } else {
    pushLog(game, `${player.name} 跳过雇佣军骰 ${face}`);
  }

  continueAfterMercenaryDie(game);
  return { ok: true };
}

/** 一枚雇佣骰处理完（含事件选择结束后）推进队列 */
function continueAfterMercenaryDie(game) {
  if (game.phase !== 'event_mercenary') return;
  if (game.pendingEventChoice) return;
  const roll = game.mercenaryRoll || [];
  if (game.mercenaryPlaced.length < roll.length) return;
  game.pendingMercenaryQueue.shift();
  game.mercenaryRoll = null;
  game.mercenaryPlaced = [];
  if ((game.pendingMercenaryQueue || []).length) {
    beginMercenaryPhase(game);
  } else {
    finishMercenaryGate(game);
  }
}

function actMercenarySkipAll(game, player) {
  if (game.phase !== 'event_mercenary') {
    return { ok: false, error: '当前不在雇佣军阶段' };
  }
  const cur = (game.pendingMercenaryQueue || [])[0];
  if (!cur || cur.playerId !== player.id) {
    return { ok: false, error: '未轮到你' };
  }
  pushLog(game, `${player.name} 跳过全部雇佣军放置`);
  game.pendingMercenaryQueue.shift();
  game.mercenaryRoll = null;
  game.mercenaryPlaced = [];
  if ((game.pendingMercenaryQueue || []).length) {
    beginMercenaryPhase(game);
  } else {
    finishMercenaryGate(game);
  }
  return { ok: true };
}

function actEventDiscard(game, player, payload) {
  if (game.phase !== 'event_discard') {
    return { ok: false, error: '当前不在事件弃牌阶段' };
  }
  const left = Number((game.pendingPrisonerDiscards || {})[player.id]) || 0;
  if (left <= 0) return { ok: false, error: '你无需弃牌' };

  // 无资源可弃：直接免除剩余（不足则全弃 / 无资源不用弃）
  if (sumRes(player.resources) <= 0) {
    delete game.pendingPrisonerDiscards[player.id];
    pushLog(game, `${player.name} 无资源可弃，跳过囚徒困境弃牌`);
    ensurePrisonerDiscardPlayer(game);
    return { ok: true };
  }

  const kind = payload && payload.kind;
  if (kind === 'resource') {
    const resource = payload.resource;
    if (!RESOURCES.includes(resource) || (player.resources[resource] || 0) < 1) {
      return { ok: false, error: '该资源不足' };
    }
    player.resources[resource] -= 1;
    pushLog(
      game,
      `${player.name} 囚徒困境弃置 1 ${RESOURCE_LABELS[resource]}`
    );
  } else {
    return { ok: false, error: '请选择弃置资源' };
  }

  game.pendingPrisonerDiscards[player.id] = left - 1;
  if (game.pendingPrisonerDiscards[player.id] <= 0) {
    delete game.pendingPrisonerDiscards[player.id];
  } else if (sumRes(player.resources) <= 0) {
    // 已把手牌弃光，剩余义务免除
    delete game.pendingPrisonerDiscards[player.id];
    pushLog(game, `${player.name} 资源已全部弃置，剩余弃牌免除`);
  }
  ensurePrisonerDiscardPlayer(game);
  return { ok: true };
}

function finishSettleActPhase(game) {
  if (game.over) return;
  advancePostSettlePipeline(game);
}

function ensureSettleActPlayer(game) {
  const alive = alivePlayers(game);
  const scope = game.settleActScope || 'all';
  if (!alive.length) {
    advancePostSettlePipeline(game);
    return;
  }
  if (alive.every((p) => game.settleActPassed[p.id])) {
    finishSettleActPhase(game);
    return;
  }
  let id = game.currentPlayerId;
  const n = game.players.length;
  for (let i = 0; i < n; i++) {
    const p = playerById(game, id);
    if (p && !p.left && !game.settleActPassed[p.id]) {
      if (playerNeedsSettleAct(p, scope)) {
        game.currentPlayerId = p.id;
        return;
      }
        game.settleActPassed[p.id] = true;
        const next = nextAlive(game, id);
        id = next ? next.id : id;
        continue;
    }
    const next = nextAlive(game, id);
    if (!next) break;
    id = next.id;
  }
  finishSettleActPhase(game);
}

function beginBuild(game) {
  if (game.over) return;
  game.phase = 'build';
  game.buildPassed = {};
  game.buildIdleLoops = 0;
  // 建造阶段获得的资源即使超上限也不再强制弃牌
  for (const p of alivePlayers(game)) {
    p.pendingDiscardRes = false;
  }
  // 按生产阶段派遣完毕顺序决定建造阶段行动顺序（第一个派遣完的先建造）
  const order = game.produceFinishOrder || [];
  let startId = order[0] || game.lastPlacerId || game.produceOrderStartId;
  game.currentPlayerId = startId;
  pushLog(game, '—— 进入建造阶段 ——');
  // 若起始玩家已离开，按顺序找下一个未离开的玩家
  const p = playerById(game, startId);
  if (!p || p.left) {
    advanceBuildTurn(game);
  }
  // 为每位玩家保存建造阶段初始快照，用于重置回合
  game.buildSnapshots = {};
  for (const pl of game.players) {
    game.buildSnapshots[pl.id] = makeBuildSnapshot(pl);
  }
}

function makeBuildSnapshot(player) {
  return JSON.parse(JSON.stringify({
    resources: player.resources,
    score: player.score,
    villagers: player.villagers,
    houses: player.houses,
    houseScore: Number(player.houseScore) || 0,
    dispatched: player.dispatched,
    funcCards: player.funcCards,
    buildings: player.buildings,
    roundBuiltHouse: player.roundBuiltHouse,
    roundBred: player.roundBred,
    roundExpanded: player.roundExpanded,
    expandSlots: player.expandSlots,
    expandFuncSlots: player.expandFuncSlots,
    expandResSlots: player.expandResSlots,
    pendingDiscardBuild: player.pendingDiscardBuild,
    pendingDiscardFunc: player.pendingDiscardFunc,
    pendingDiscardRes: player.pendingDiscardRes,
    pendingWishWellBonus: player.pendingWishWellBonus,
    roundGained: player.roundGained,
    enhancedDice: player.enhancedDice,
    recruitPending: player.recruitPending,
    welfareHouses: Number(player.welfareHouses) || 0,
    caravanPending: Boolean(player.caravanPending),
    tempVillagers: player.tempVillagers,
  }));
}

function actResetBuildTurn(game, player) {
  const snap = game.buildSnapshots[player.id];
  if (!snap) return { ok: false, error: '没有可用的重置状态' };

  const currentBldIds = new Set((player.buildings || []).map(b => b.id));
  const snapBldIds = new Set((snap.buildings || []).map(b => b.id));
  const currentFuncIds = new Set((player.funcCards || []).map(c => c.id));
  const snapFuncIds = new Set((snap.funcCards || []).map(c => c.id));

  // 回收旧建筑（snapshot 中有、当前无）
  for (const b of snap.buildings || []) {
    if (!currentBldIds.has(b.id)) {
      const idx = game.specialDiscard.findIndex(x => x.id === b.id);
      if (idx >= 0) game.specialDiscard.splice(idx, 1);
    }
  }
  // 清理新增建筑（snapshot 中无、当前有）→ 移入弃牌堆
  for (const b of player.buildings || []) {
    if (!snapBldIds.has(b.id)) {
      game.specialDiscard.push(cleanCardForPile(b));
    }
  }
  // 清理 pendingDiscardBuild 中的新卡（兼容单张与队列）
  if (player.pendingDiscardBuild) {
    const pendingCards = ensurePendingBuildQueue(player);
    const snapCards = (() => {
      const snapPending = snap.pendingDiscardBuild;
      if (!snapPending) return [];
      if (Array.isArray(snapPending.newCards)) return snapPending.newCards;
      return snapPending.newCard ? [snapPending.newCard] : [];
    })();
    const snapIds = new Set(snapCards.map((c) => c && c.id).filter(Boolean));
    for (const neu of pendingCards) {
      if (neu && neu.id && !snapIds.has(neu.id)) {
        game.specialDiscard.push(cleanCardForPile(neu));
      }
    }
  }

  // 回收旧功能卡
  for (const c of snap.funcCards || []) {
    if (!currentFuncIds.has(c.id)) {
      const idx = game.specialDiscard.findIndex(x => x.id === c.id);
      if (idx >= 0) game.specialDiscard.splice(idx, 1);
    }
  }
  // 清理新增功能卡
  for (const c of player.funcCards || []) {
    if (!snapFuncIds.has(c.id)) {
      game.specialDiscard.push(cleanCardForPile(c));
    }
  }

  // 恢复玩家个人状态
  player.resources = JSON.parse(JSON.stringify(snap.resources));
  player.score = snap.score;
  player.villagers = snap.villagers;
  player.houses = snap.houses != null ? snap.houses : START_HOUSES;
  player.houseScore = Number(snap.houseScore) || 0;
  player.dispatched = snap.dispatched;
  player.funcCards = JSON.parse(JSON.stringify(snap.funcCards));
  player.buildings = JSON.parse(JSON.stringify(snap.buildings));
  player.roundBuiltHouse = snap.roundBuiltHouse;
  player.roundBred = snap.roundBred;
  player.roundExpanded = snap.roundExpanded;
  player.expandSlots = snap.expandSlots;
  player.expandFuncSlots = snap.expandFuncSlots;
  player.expandResSlots = snap.expandResSlots;
  player.pendingDiscardBuild = snap.pendingDiscardBuild ? JSON.parse(JSON.stringify(snap.pendingDiscardBuild)) : null;
  player.pendingDiscardFunc = snap.pendingDiscardFunc;
  player.pendingDiscardRes = snap.pendingDiscardRes;
  player.roundGained = snap.roundGained;
  player.enhancedDice = Number(snap.enhancedDice) || 0;
  player.recruitPending = Number(snap.recruitPending) || 0;
  player.welfareHouses = Number(snap.welfareHouses) || 0;
  player.caravanPending = Boolean(snap.caravanPending);
  player.tempVillagers = Number(snap.tempVillagers) || 0;

  game.currentPlayerId = player.id;
  delete game.buildPassed[player.id];

  pushLog(game, `${player.name} 重置了本轮建造`);
  return { ok: true };
}

function hasPendingPlacement(p) {
  return (p.buildings || []).some((b) => !b.built && b.slot == null) ||
    Boolean(p.pendingDiscardBuild);
}

function advanceBuildTurn(game) {
  const alive = alivePlayers(game);
  if (!alive.length) {
    tryEndRoundAfterBuild(game);
    return;
  }
  if (alive.every((p) => game.buildPassed[p.id])) {
    tryEndRoundAfterBuild(game);
    return;
  }

  const order = game.produceFinishOrder || [];
  let startIdx = 0;
  if (game.currentPlayerId) {
    const idx = order.indexOf(game.currentPlayerId);
    if (idx >= 0) startIdx = idx;
  }

  for (let i = 1; i <= order.length; i++) {
    const pid = order[(startIdx + i) % order.length];
    if (game.buildPassed[pid]) continue;
    const p = playerById(game, pid);
    if (p && !p.left) {
      game.currentPlayerId = pid;
        return;
      }
  }

  // 后备：按座位顺序找未 pass 的存活玩家
  for (const p of alive) {
    if (!game.buildPassed[p.id]) {
      game.currentPlayerId = p.id;
      return;
    }
  }
  tryEndRoundAfterBuild(game);
}

function afterBuildAction(game, playerId, didRealAction) {
  game.lastBuilderId = playerId;
  if (checkWin(game)) return;
  if (didRealAction) {
    game.currentPlayerId = playerId;
    return;
  }
  const p = playerById(game, playerId);
  if (p) {
    p.caravanPending = false;
    const throneCount = countEternalThrone(p);
    if (throneCount > 0) {
      const gain = throneCount;
      p.bonusScore = (Number(p.bonusScore) || 0) + gain;
      pushLog(game, `${p.name} 的永恒王座生效，+${gain} 分`);
    }
  }
  game.buildPassed[playerId] = true;
  advanceBuildTurn(game);
}

function endRound(game) {
  if (game.over) return;
  pushLog(game, `—— 第 ${game.round} 轮结束 ——`);
  startNextRound(game);
}

function startNextRound(game) {
  // 收回工人
  for (const p of game.players) {
    p.dispatched = 0;
    p.voided = 0;
    for (const b of p.buildings) b.workers = 0;
  }
  recycleBoard(game);
  game.round += 1;
  game.personalProduceApplied = false;
  // 下一轮生产从本轮「最先派遣完毕」的玩家开始（与建造阶段先手一致）
  const nextProduceStart =
    (game.produceFinishOrder || [])[0] || game.produceOrderStartId;
  game.produceFinishOrder = [];
  game.produceOrderStartId = nextProduceStart;
  game.roundProduceBegun = false;
  setupBoard(game);
  maybeBeginProduceAfterSetup(game);
}

// ─── 动作处理 ───────────────────────────────────────────

function applyAction(game, playerId, action) {
  if (!game || game.over) return { ok: false, error: '游戏已结束' };
  const player = playerById(game, playerId);
  if (!player || player.left) return { ok: false, error: '玩家无效' };

  const type = action && action.type;
  const payload = (action && action.payload) || {};

  if (game.pendingTrade) {
    if (type === 'acceptTrade') {
      if (game.pendingTrade.toId !== playerId) {
        return { ok: false, error: '等待对方决定交易' };
      }
      return actAcceptTrade(game, player);
    }
    if (type === 'rejectTrade' || type === 'cancelTrade') {
      if (
        game.pendingTrade.toId !== playerId &&
        game.pendingTrade.fromId !== playerId
      ) {
        return { ok: false, error: '等待交易决定' };
      }
      return actRejectTrade(game, player);
    }
    return { ok: false, error: '等待交易决定' };
  }

  if (game.pendingRedrawChoice) {
    if (game.pendingRedrawChoice.playerId !== playerId) {
      return { ok: false, error: '等待其他玩家完成重抽选择' };
    }
    if (type === 'redrawPick') {
      return actRedrawPick(game, player, payload);
    }
    return { ok: false, error: '请先完成重抽选择' };
  }

  if (game.pendingIllegalBuild) {
    if (type === 'illegalBuildPick') {
      if (playerId !== game.pendingIllegalBuild.targetId) {
        return { ok: false, error: '请由目标玩家选择要拆除的建筑' };
      }
      return actIllegalBuildPick(game, player, payload);
    }
    if (type === 'cancelIllegalBuild') {
      return actCancelIllegalBuild(game, player);
    }
    return { ok: false, error: '等待目标玩家选择要拆除的建筑' };
  }

  // 派遣 / 结算后事件选择等（跨阶段，须先于 settle 阶段守卫）
  if (game.pendingWelfareMinimumChoices && game.pendingWelfareMinimumChoices[playerId]) {
    if (type === 'eventPickTwoResources') {
      return actEventPickTwoResources(game, player, payload);
    }
    return { ok: false, error: '请先完成低保户资源选择' };
  }

  if (game.pendingEventChoice) {
    if (game.pendingEventChoice.playerId !== playerId) {
      return { ok: false, error: '等待其他玩家完成事件选择' };
    }
    if (type === 'eventPickResource') {
      return actEventPickResource(game, player, payload);
    }
    if (type === 'eventPickTwoResources') {
      return actEventPickTwoResources(game, player, payload);
    }
    if (type === 'eventMoveBarrenMarker') {
      return actEventMoveBarrenMarker(game, player, payload);
    }
    if (type === 'eventMoveNeutral') {
      return actEventMoveNeutral(game, player, payload);
    }
    if (type === 'eventRecallDie') {
      return actEventRecallDie(game, player, payload);
    }
    if (type === 'eventTeleportFrom') {
      return actEventTeleportFrom(game, player, payload);
    }
    if (type === 'eventTeleportTo') {
      return actEventTeleportTo(game, player, payload);
    }
    if (type === 'eventGatherNeutrals') {
      return actEventGatherNeutrals(game, player, payload);
    }
    return { ok: false, error: '请先完成事件牌选择' };
  }

  if (game.phase === 'settle') {
    if (type === 'finishSettleAnim') {
      return finishSettleAnim(game, playerId);
    }
    return { ok: false, error: '结算动画播放中，请稍候' };
  }

  // 随时可用：集市、部分功能（在合法阶段校验）
  if (type === 'exchange') {
    return actExchange(game, player, payload);
  }
  if (type === 'proposeTrade') {
    return actProposeTrade(game, player, payload);
  }
  if (type === 'useFunc') {
    if (game.phase === 'build' && game.buildPassed[playerId]) {
      return { ok: false, error: '你已跳过本轮建造' };
    }
    return actUseFunc(game, player, payload);
  }
  if (type === 'discardFunc') {
    return actDiscardFunc(game, player, payload);
  }
  if (type === 'discardUnbuilt') {
    return actDiscardUnbuilt(game, player, payload);
  }
  if (type === 'discardPendingBuild') {
    return actDiscardPendingBuild(game, player);
  }
  if (type === 'discardResource') {
    return actDiscardResource(game, player, payload);
  }
  if (type === 'discardResources') {
    return actDiscardResources(game, player, payload);
  }
  if (type === 'placeBuildingSlot') {
    return actPlaceBuildingSlot(game, player, payload);
  }

  if (game.phase === 'init_announce') {
    return { ok: false, error: '正在宣布先手，请稍候' };
  }

  if (game.phase === 'init_roll') {
    if (type !== 'initRoll') return { ok: false, error: '请先投骰子比大小' };
    if (game.initRolls[playerId] != null) {
      return { ok: false, error: '你已经投过了' };
    }
    const v = 1 + Math.floor(Math.random() * 6);
    game.initRolls[playerId] = v;
    pushLog(game, `${player.name} 先手骰：${v}`);
    if (alivePlayers(game).every((p) => game.initRolls[p.id] != null)) {
      resolveInitRoll(game);
    }
    return { ok: true };
  }

  if (game.phase === 'produce') {
    if (game.currentPlayerId !== playerId) {
      return { ok: false, error: '还没轮到你' };
    }
    if (type === 'produceRoll') {
      if (!game.awaitingProduceRoll) {
        return { ok: false, error: '本回合已经投过/使用过遥控骰子' };
      }
      rollForCurrent(game);
      return { ok: true };
    }
    if (type === 'placeDice') return actPlaceDice(game, player, payload);
    if (type === 'voidSkip') return actVoidSkip(game, player, payload);
    return { ok: false, error: '生产阶段请投掷、放置骰子或跳过（爆骰换资源）' };
  }

  if (game.phase === 'settle_act') {
    if (type === 'pass') {
      if (playerNeedsSettleAct(player, game.settleActScope || 'all')) {
        return { ok: false, error: '请先处理弃牌后再跳过' };
      }
      return { ok: true };
    }
    return { ok: false, error: '弃牌阶段：请处理超上限弃牌' };
  }

  if (game.phase === 'wish_well') {
    if (type === 'allocateWishWell') {
      return actAllocateWishWell(game, player, payload);
    }
    return { ok: false, error: '请选择许愿井资源并确认' };
  }

  if (game.phase === 'event_mercenary') {
    if (type === 'mercenaryRoll') return actMercenaryRoll(game, player);
    if (type === 'mercenaryPlace') return actMercenaryPlace(game, player, payload);
    if (type === 'mercenarySkipAll') {
      if (game.pendingEventChoice) {
        return { ok: false, error: '请先完成事件牌选择' };
      }
      return actMercenarySkipAll(game, player);
    }
    return { ok: false, error: '雇佣军：请投掷、放置或跳过' };
  }

  if (game.phase === 'event_discard') {
    if (type === 'eventDiscard') return actEventDiscard(game, player, payload);
    return { ok: false, error: '请按囚徒困境要求弃牌' };
  }

  if (game.phase === 'build') {
    if (game.currentPlayerId !== playerId) {
      return { ok: false, error: '还没轮到你' };
    }
    if (game.buildPassed[playerId]) {
      return { ok: false, error: '你已跳过本轮建造' };
    }
    if (type === 'pass') {
      game.buildPassed[playerId] = true;
      pushLog(game, `${player.name} 跳过本轮建造（本阶段不再行动）`);
      afterBuildAction(game, playerId, false);
      return { ok: true };
    }
    if (type === 'construct') return actConstruct(game, player, payload);
    if (type === 'useFunc') return actUseFunc(game, player, payload);
    if (type === 'buildHousePermanent') return actBuildHousePermanent(game, player);
    if (type === 'breedPermanent') return actBreedPermanent(game, player);
    if (type === 'expandPermanent') return actExpandPermanent(game, player, payload);
    if (type === 'buyFuncCardPermanent') return actBuyFuncCardPermanent(game, player);
    if (type === 'resetBuildTurn') return actResetBuildTurn(game, player);
    return { ok: false, error: '建造阶段：建造建筑、使用功能卡、常驻功能或跳过' };
  }

  return { ok: false, error: '当前阶段无法操作' };
}

/** payload.alloc: { wood, stone, food, iron } 非负整数，合计 = pendingWishWellBonus */
function actAllocateWishWell(game, player, payload = {}) {
  const need = Number(player.pendingWishWellBonus) || 0;
  if (need <= 0) return { ok: false, error: '无需使用许愿井' };
  const raw = payload.alloc || payload;
  const counts = emptyRes();
  let sum = 0;
  for (const r of RESOURCES) {
    const n = Number(raw[r] || 0);
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, error: '分配数量无效' };
    }
    counts[r] = n;
    sum += n;
  }
  if (sum !== need) {
    return {
      ok: false,
      error: `需恰好选取 ${need} 次资源（当前 ${sum}）`,
    };
  }
  const parts = [];
  for (const r of RESOURCES) {
    if (!counts[r]) continue;
    player.resources[r] = (player.resources[r] || 0) + counts[r];
    player.roundGained += counts[r];
    parts.push(`${RESOURCE_LABELS[r]}+${counts[r]}`);
  }
  player.pendingWishWellBonus = 0;
  if (game.phase === 'build') {
    syncResourceHandPending(player, game);
  }
  pushLog(
    game,
    `${player.name} 许愿井：${parts.join('、') || '无'}`
  );
  if (game.phase === 'wish_well') {
    tryFinishWishWellPhase(game);
  }
  return { ok: true };
}

function actPlaceDice(game, player, payload) {
  game.pendingInitReveal = null;
  if (game.awaitingProduceRoll) {
    return { ok: false, error: '请先投掷或使用遥控骰子' };
  }
  const face = Number(payload.face);
  const area = payload.area; // 'resource' | 'special'
  const personalBuildingId = payload.buildingId || null;

  if (!Number.isInteger(face) || face < 1 || face > 6) {
    return { ok: false, error: '点数无效' };
  }
  const dice = game.dice[player.id] || [];
  const remote = Boolean(game.remoteDiceMode);
  let count;
  if (remote) {
    const wild = dice.filter((d) => d === 0).length;
    if (wild <= 0) return { ok: false, error: '没有可派遣的遥控骰子' };
    count = Number(payload.count);
    if (!Number.isInteger(count) || count < 1) count = wild;
    if (count > wild) {
      return { ok: false, error: `最多派遣 ${wild} 枚` };
    }
  } else {
  const matching = dice.filter((d) => d === face);
  if (!matching.length) {
    return { ok: false, error: '没有该点数的骰子' };
  }
    count = matching.length;
  }

  if (!BOARD_AREAS.includes(area)) {
    return { ok: false, error: '请选择资源/功能/建筑区' };
  }
  const areaBoard = game.board[area];
  const tiles = tilesOnNumber(areaBoard, face);
  if (!tiles.length) {
    return { ok: false, error: `${AREA_LABELS[area]}区点数 ${face} 没有板块` };
  }

  const slotW = areaBoard.workers[face] || (areaBoard.workers[face] = {});
  if (!areaBoard.boosts) areaBoard.boosts = emptySlotWorkers();
  const slotB = areaBoard.boosts[face] || (areaBoard.boosts[face] = {});

  const boostFlags = (game.diceBoosted && game.diceBoosted[player.id]) || [];
  let boostAdd = 0;
  if (remote) {
    let left = count;
    const nextDice = [];
    const nextBoost = [];
    for (let i = 0; i < dice.length; i++) {
      const d = dice[i];
      const b = Boolean(boostFlags[i]);
      if (d === 0 && left > 0) {
        left -= 1;
        if (b) boostAdd += 1;
        continue;
      }
      nextDice.push(d);
      nextBoost.push(b);
    }
    game.dice[player.id] = nextDice;
    if (!game.diceBoosted) game.diceBoosted = {};
    game.diceBoosted[player.id] = nextBoost;
  } else {
    const nextDice = [];
    const nextBoost = [];
    for (let i = 0; i < dice.length; i++) {
      const d = dice[i];
      const b = Boolean(boostFlags[i]);
      if (d === face) {
        if (b) boostAdd += 1;
        continue;
      }
      nextDice.push(d);
      nextBoost.push(b);
    }
    game.dice[player.id] = nextDice;
    if (!game.diceBoosted) game.diceBoosted = {};
    game.diceBoosted[player.id] = nextBoost;
  }

  slotW[player.id] = (slotW[player.id] || 0) + count;
  if (boostAdd > 0) {
    slotB[player.id] = (slotB[player.id] || 0) + boostAdd;
    player.enhancedPlaced = (Number(player.enhancedPlaced) || 0) + boostAdd;
  }
  player.dispatched += count;
  pushProduceFx(game, {
    type: 'dispatch',
    actorId: player.id,
    area,
    number: face,
    face,
    count,
    boostAdd,
  });
  pushLog(
    game,
    `${player.name} 派遣 ${count} 名村民到${AREA_LABELS[area]}区 ${face} 号格` +
      (boostAdd ? `（强化 ${boostAdd}）` : '') +
      (remote ? '（遥控）' : '')
  );
  // 事件牌：派遣触发（资源区 1–6）
  const ev = applyEnvironmentOnDispatch(game, {
    player,
    area,
    number: face,
    count,
    pushLog,
    syncResourceHandPending,
  });
  game.remoteDiceMode = false;
  if (ev && ev.needChoice) {
    game.pendingEventChoice = {
      ...ev,
      playerId: player.id,
    };
    pushLog(
      game,
      `${player.name} 触发「${ev.label}」，请完成事件选择`
    );
    return { ok: true, pendingEvent: game.pendingEventChoice };
  }
  afterProduceAction(game, player.id);
  return { ok: true };
}

function actVoidSkip(game, player, payload) {
  game.pendingInitReveal = null;
  if (game.awaitingProduceRoll) {
    return { ok: false, error: '请先投掷或使用遥控骰子' };
  }
  if (idleVillagers(player) <= 0) {
    return { ok: false, error: '没有可派遣的村民' };
  }
  const dice = game.dice[player.id] || [];
  if (!dice.length) {
    return { ok: false, error: '没有可跳过的骰子' };
  }

  const mode =
    payload && payload.mode === 'pay'
      ? 'pay'
      : payload && payload.mode === 'burn'
        ? 'burn'
        : payload && payload.resource
          ? 'burn'
          : null;
  if (!mode) {
    return { ok: false, error: '请选择跳过方式' };
  }

  if (mode === 'pay') {
    const totalOwn = RESOURCES.reduce(
      (s, k) => s + (Number(player.resources[k]) || 0),
      0
    );
    if (totalOwn < 2) {
      return { ok: false, error: '手牌资源不足 2 张' };
    }
    const amounts = payload.amounts || {};
    const total = RESOURCES.reduce(
      (s, k) => s + (Number(amounts[k]) || 0),
      0
    );
    if (total !== 2) {
      return { ok: false, error: '需弃置 2 张资源' };
    }
    for (const k of RESOURCES) {
      const n = Number(amounts[k]) || 0;
      if (n < 0) return { ok: false, error: '弃置数量无效' };
      if ((player.resources[k] || 0) < n) {
        return { ok: false, error: `${RESOURCE_LABELS[k]}不足` };
      }
    }
    for (const k of RESOURCES) {
      const n = Number(amounts[k]) || 0;
      if (n > 0) player.resources[k] -= n;
    }
    syncResourceHandPending(player, game);
    game.dice[player.id] = [];
    if (!game.diceBoosted) game.diceBoosted = {};
    game.diceBoosted[player.id] = [];
    game.awaitingProduceRoll = false;
    game.remoteDiceMode = false;
    const parts = RESOURCES.filter((k) => (Number(amounts[k]) || 0) > 0).map(
      (k) => `${amounts[k]} ${RESOURCE_LABELS[k]}`
    );
    pushLog(
      game,
      `${player.name} 弃置 ${parts.join('、')} 跳过本回合（不爆骰）`
    );
    afterProduceAction(game, player.id);
    return { ok: true };
  }

  const resource = payload && payload.resource;
  if (!resource || !RESOURCES.includes(resource)) {
    return { ok: false, error: '请选择要获得的资源' };
  }
  // 爆掉 1 枚未派遣骰子（本轮该村民不可再派出），并获得任意 1 资源
  const boostFlags = (game.diceBoosted && game.diceBoosted[player.id]) || [];
  if (boostFlags[0]) {
    player.enhancedPlaced = (Number(player.enhancedPlaced) || 0) + 1;
  }
  player.dispatched += 1;
  player.resources[resource] = (player.resources[resource] || 0) + 1;
  player.roundGained = (player.roundGained || 0) + 1;
  syncResourceHandPending(player, game);
  game.dice[player.id] = [];
  if (!game.diceBoosted) game.diceBoosted = {};
  game.diceBoosted[player.id] = [];
  game.awaitingProduceRoll = false;
  game.remoteDiceMode = false;
  pushLog(
    game,
    `${player.name} 爆掉 1 枚骰子，获得 1 ${RESOURCE_LABELS[resource]}，结束本回合`
  );
  afterProduceAction(game, player.id);
  return { ok: true };
}

function actConstruct(game, player, payload) {
  const block = rejectIfBuildPhaseCardDiscardPending(player);
  if (block) return block;
  const buildingId = payload.buildingId;
  const b = findPersonalBuilding(player, buildingId);
  if (!b) return { ok: false, error: '建筑不存在' };
  if (b.built) return { ok: false, error: '已经建造过了' };
  if (b.slot == null) b.slot = 'none';
  if (!canPay(player.resources, b.cost || {})) {
    return { ok: false, error: '资源不足' };
  }
  pay(player.resources, b.cost || {});
  b.built = true;
  b.faceDown = false; // 建造后公开
  let stepText =
    `${player.name} 建造了「${b.label}」` +
    (b.score ? `（+${b.score} 分）` : '');
  const stackKey = buildingStackKey(b);
  if (countBuiltByStackKey(player, stackKey) === STACK_ACHIEVEMENT_NEED) {
    stepText += `，获得成就「${stackAchievementLabel(player, stackKey)}」（+${STACK_ACHIEVEMENT_SCORE} 分）`;
  }
  pushLog(game, stepText);
  pushPlayReveal(game, {
    kind: 'building',
    actorId: player.id,
    actorName: player.name,
    card: {
      id: b.id,
      label: b.label,
      buildType: b.buildType,
      resource: b.resource,
      rich: b.rich,
    },
    stepText,
  });
  if (checkWin(game)) return { ok: true };
  afterBuildAction(game, player.id, true);
  return { ok: true };
}

function actPlaceBuildingSlot(game, player, payload) {
  const buildingId = payload.buildingId;
  let slot = normalizeBuildSlot(payload && payload.slot);

  const b = findPersonalBuilding(player, buildingId);
  if (!b) return { ok: false, error: '建筑不存在' };
  if (b.slot != null) return { ok: false, error: '已放置过格子' };

  const allowed = personalSlotsFor(player).map(String);
  if (!allowed.includes(String(slot))) {
    return { ok: false, error: '无效的建筑格' };
  }

  const onSlot = buildingsOnSlot(player, slot);
  if (onSlot.length > 0) {
    if (!canStackBuildingOnSlot(player, slot, b)) {
      return { ok: false, error: '该建筑格已被占用（仅相同建筑可叠放）' };
    }
  } else if (occupiedBuildSlotCount(player) >= maxBuildingsFor(player)) {
    return { ok: false, error: `建筑格已达上限 ${maxBuildingsFor(player)}` };
  }

  b.slot = slot;
  pushLog(game, `${player.name} 将「${b.label}」放置好`);
  return { ok: true };
}

function actDiscardUnbuilt(game, player, payload) {
  const scope = game.settleActScope || 'all';
  if (
    game.phase === 'settle_act' &&
    player.pendingDiscardRes &&
    (scope === 'resource' || scope === 'all')
  ) {
    return { ok: false, error: '请先处理资源手牌超上限弃置' };
  }
  const buildingId = payload.buildingId;
  const b = findPersonalBuilding(player, buildingId);
  if (!b) return { ok: false, error: '建筑不存在' };
  if (player.pendingDiscardBuild && b.built) {
    return { ok: false, error: '超上限时只能弃置未建造的建筑' };
  }

  const slotKeep = b.slot;
  const wasBuilt = !!b.built;
  // 建筑上的村民回收为空闲
  if ((b.workers || 0) > 0) {
    player.dispatched = Math.max(0, (player.dispatched || 0) - b.workers);
    b.workers = 0;
  }
  player.buildings = player.buildings.filter((x) => x.id !== buildingId);
  pushToDiscard(game, 'building', b);
  // 满上限 pending：弃后收下新卡，放到原格子
  if (player.pendingDiscardBuild) {
    const neu = popPendingBuildCard(player);
    if (neu) {
      neu.built = false;
      neu.workers = 0;
      if (!assignBuildingSlot(player, neu)) {
        if (
          slotKeep != null &&
          (buildingsOnSlot(player, slotKeep).length === 0 ||
            canStackBuildingOnSlot(player, slotKeep, neu))
        ) {
    neu.slot = slotKeep;
        } else {
          neu.slot = slotKeep != null ? slotKeep : nextFreeBuildSlot(player) || 'none';
        }
      }
    player.buildings.push(neu);
      let msg = `${player.name} 弃置${wasBuilt ? '已建' : '未建'}「${b.label}」（入弃牌堆），新建筑「${neu.label}」放到原格子`;
      if (wasBuilt && b.score) {
        msg += `，${b.label}被弃置，失去 +${b.score} 分`;
      }
      pushLog(game, msg);
    } else {
      let msg = `${player.name} 弃置${wasBuilt ? '已建' : '未建'}「${b.label}」` +
        (slotKeep != null
          ? `（格子 ${slotLabel(slotKeep)}）`
          : '') +
        '（入弃牌堆）';
      if (wasBuilt && b.score) {
        msg += `，${b.label}被弃置，失去 +${b.score} 分`;
      }
      pushLog(game, msg);
    }
  } else {
    let msg = `${player.name} 主动弃置${wasBuilt ? '已建' : '未建'}「${b.label}」` +
      (slotKeep != null
        ? `（格子 ${slotLabel(slotKeep)}）`
        : '') +
      '（入弃牌堆）';
    if (wasBuilt && b.score) {
      msg += `，${b.label}被弃置，失去 +${b.score} 分`;
    }
    pushLog(game, msg);
  }
  if (game.phase === 'settle_act') {
    maybeAdvanceAfterSettleActDiscard(game, player);
  }
  return { ok: true };
}

/** 建筑达上限：弃掉刚获得、尚未入手的建筑，保留现有建筑 */
function actDiscardPendingBuild(game, player) {
  const scope = game.settleActScope || 'all';
  if (
    game.phase === 'settle_act' &&
    player.pendingDiscardRes &&
    (scope === 'resource' || scope === 'all')
  ) {
    return { ok: false, error: '请先处理资源手牌超上限弃置' };
  }
  const pending = player.pendingDiscardBuild;
  const neu = pending ? pending.newCard : null;
  if (!neu) {
    return { ok: false, error: '没有待取舍的新建筑' };
  }
  popPendingBuildCard(player);
  pushToDiscard(game, 'building', neu);
    pushLog(
      game,
    `${player.name} 弃置刚获得的建筑「${neu.label || '?'}」（入弃牌堆），保留现有建筑`
  );
  if (game.phase === 'settle_act') {
    maybeAdvanceAfterSettleActDiscard(game, player);
  }
  return { ok: true };
}

function actDiscardResource(game, player, payload) {
  if (game.phase !== 'settle_act') {
    return { ok: false, error: '仅弃牌阶段可弃置超限资源' };
  }
  const scope = game.settleActScope || 'all';
  if (scope === 'card') {
    return { ok: false, error: '当前仅处理超上限卡牌' };
  }
  const resource = payload && payload.resource;
  if (!resource || !RESOURCES.includes(resource)) {
    return { ok: false, error: '请选择要丢弃的资源' };
  }
  if ((player.resources[resource] || 0) < 1) {
    return { ok: false, error: `${RESOURCE_LABELS[resource]}不足` };
  }
  player.resources[resource] -= 1;
  syncResourceHandPending(player, game);
  pushLog(
    game,
    `${player.name} 弃置 1 ${RESOURCE_LABELS[resource]}（手牌超上限）`
  );
  maybeAdvanceAfterResourceDiscard(game, player);
  return { ok: true };
}

/** 一次性弃置多种资源，合计须恰好等于超限数量 */
function actDiscardResources(game, player, payload) {
  if (game.phase !== 'settle_act') {
    return { ok: false, error: '仅弃牌阶段可弃置超限资源' };
  }
  const scope = game.settleActScope || 'all';
  if (scope === 'card') {
    return { ok: false, error: '当前仅处理超上限卡牌' };
  }
  const max = maxResourceHandFor(player);
  const need = sumRes(player.resources) - max;
  if (need <= 0) {
    player.pendingDiscardRes = false;
    return { ok: false, error: '当前无需弃置资源' };
  }
  const amounts = (payload && payload.amounts) || {};
  let total = 0;
  const detail = [];
  for (const r of RESOURCES) {
    const n = Math.floor(Number(amounts[r]) || 0);
    if (n < 0) return { ok: false, error: '弃置数量无效' };
    if (n > (player.resources[r] || 0)) {
      return { ok: false, error: `${RESOURCE_LABELS[r]}不足` };
    }
    if (n > 0) {
      total += n;
      detail.push({ resource: r, amount: n });
    }
  }
  if (total !== need) {
    return { ok: false, error: `请恰好弃置 ${need} 个资源` };
  }
  for (const d of detail) {
    player.resources[d.resource] -= d.amount;
  }
  syncResourceHandPending(player, game);
  pushLog(
    game,
    `${player.name} 弃置 ` +
      detail
        .map((d) => `${d.amount} ${RESOURCE_LABELS[d.resource]}`)
        .join('、') +
      `（手牌超上限）`
  );
  maybeAdvanceAfterResourceDiscard(game, player);
  return { ok: true };
}

function maybeAdvanceAfterSettleActDiscard(game, player) {
  const scope = game.settleActScope || 'all';
  if (game.phase !== 'settle_act') return;
  if (playerNeedsSettleAct(player, scope)) return;
  tryFinishConcurrentDiscardPhase(game);
}

function maybeAdvanceAfterResourceDiscard(game, player) {
  maybeAdvanceAfterSettleActDiscard(game, player);
}

function actDiscardFunc(game, player, payload) {
  const scope = game.settleActScope || 'all';
  if (
    game.phase === 'settle_act' &&
    player.pendingDiscardRes &&
    (scope === 'resource' || scope === 'all')
  ) {
    return { ok: false, error: '请先处理资源手牌超上限弃置' };
  }
  const cardId = payload.cardId;
  const idx = player.funcCards.findIndex((c) => c.id === cardId);
  if (idx < 0) return { ok: false, error: '功能卡不存在' };
  const [card] = player.funcCards.splice(idx, 1);
  pushToDiscard(game, 'function', card);
  syncFuncHandPending(player);
  pushLog(game, `${player.name} 弃置功能卡「${card.label}」（入弃牌堆）`);
  if (game.phase === 'settle_act') {
    maybeAdvanceAfterSettleActDiscard(game, player);
  }
  return { ok: true };
}

function countBuiltExchanges(player) {
  return (player.buildings || []).filter(
    (b) => b.built && b.buildType === 'exchange'
  ).length;
}

/** 集市兑换比例最多按 2 座计算（第 3 座起不再提升兑换，仅计成就加分） */
const MAX_EXCHANGE_EFFECT = 2;
/** 同类型建筑建成第 3 座：每种类型 +2 胜利点 */
const STACK_ACHIEVEMENT_NEED = 3;
const STACK_ACHIEVEMENT_SCORE = 2;
/** @deprecated 兼容旧导出/测试 */
const EXCHANGE_TITLE_NEED = STACK_ACHIEVEMENT_NEED;
const EXCHANGE_TITLE_SCORE = STACK_ACHIEVEMENT_SCORE;
const EXCHANGE_TITLE_ID = 'commerceTycoon';
const EXCHANGE_TITLE_LABEL = '商业巨擎';
const WISH_WELL_TITLE_ID = 'lampSpirit';
const WISH_WELL_TITLE_LABEL = '灯灵本灵';

function produceManagerTitle(resource) {
  const name = RESOURCE_LABELS[resource] || resource;
  return `${name}管理者`;
}

function countBuiltByStackKey(player, key) {
  return (player.buildings || []).filter(
    (b) => b.built && buildingStackKey(b) === key
  ).length;
}

function stackAchievementCounts(player) {
  const counts = {};
  for (const b of player.buildings || []) {
    if (!b.built) continue;
    const key = buildingStackKey(b);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function stackAchievementKeys(player) {
  const counts = stackAchievementCounts(player);
  return Object.keys(counts).filter((k) => counts[k] >= STACK_ACHIEVEMENT_NEED);
}

function stackAchievementScore(player) {
  return stackAchievementKeys(player).length * STACK_ACHIEVEMENT_SCORE;
}

function stackAchievementTitleId(key) {
  if (key === 'exchange') return EXCHANGE_TITLE_ID;
  if (key === 'wishWell') return WISH_WELL_TITLE_ID;
  if (key.startsWith('produce:')) {
    const resource = key.split(':')[1];
    return resource ? `produceManager:${resource}` : `stack3:${key}`;
  }
  return `stack3:${key}`;
}

function stackAchievementLabel(player, key) {
  if (key === 'exchange') return EXCHANGE_TITLE_LABEL;
  if (key === 'wishWell') return WISH_WELL_TITLE_LABEL;
  if (key.startsWith('produce:')) {
    const resource = key.split(':')[1];
    if (resource) return produceManagerTitle(resource);
  }
  const b = (player.buildings || []).find(
    (x) => x.built && buildingStackKey(x) === key
  );
  return b ? `${b.label}×3` : key;
}

function hasCommerceTycoon(player) {
  return countBuiltByStackKey(player, 'exchange') >= STACK_ACHIEVEMENT_NEED;
}

function commerceTycoonScore(player) {
  return hasCommerceTycoon(player) ? STACK_ACHIEVEMENT_SCORE : 0;
}

function playerTitles(player) {
  return stackAchievementKeys(player).map((key) => ({
    id: stackAchievementTitleId(key),
    stackKey: key,
    label: stackAchievementLabel(player, key),
    score: STACK_ACHIEVEMENT_SCORE,
  }));
}

function effectiveExchangeCount(player) {
  return Math.min(countBuiltExchanges(player), MAX_EXCHANGE_EFFECT);
}

/**
 * 集市兑换率：0座（默认银行）→3换1，1座→2换1，≥2座→1换1
 * 默认可混合资源；每个玩家独立按自己已建集市数量计算。
 */
function exchangeCostN(exchangeCount) {
  const n = Math.min(Number(exchangeCount) || 0, MAX_EXCHANGE_EFFECT);
  if (n === 0) return 3;
  if (n === 1) return 2;
  return 1;
}

/** 商队来临是否在本建造回合生效 */
function caravanExchangeActive(game, player) {
  return (
    game.phase === 'build' &&
    game.currentPlayerId === player.id &&
    Boolean(player.caravanPending) &&
    !(game.buildPassed && game.buildPassed[player.id])
  );
}

/** 当前玩家兑换所需同类资源数（含商队来临） */
function effectiveExchangeCost(player, game) {
  if (caravanExchangeActive(game, player)) {
    return 1;
  }
  return exchangeCostN(effectiveExchangeCount(player));
}

function normalizeTradeAmounts(obj) {
  const out = emptyRes();
  if (!obj || typeof obj !== 'object') return out;
  for (const r of RESOURCES) {
    out[r] = Math.max(0, Math.floor(Number(obj[r]) || 0));
  }
  return out;
}

function formatTradeRes(amounts) {
  const parts = [];
  for (const r of RESOURCES) {
    const n = Number(amounts && amounts[r]) || 0;
    if (n > 0) parts.push(`${n}${RESOURCE_LABELS[r]}`);
  }
  return parts.length ? parts.join('、') : '无';
}

function actProposeTrade(game, player, payload) {
  if (game.pendingTrade) {
    return { ok: false, error: '已有待处理交易' };
  }
  if (game.phase !== 'produce' && game.phase !== 'build') {
    return { ok: false, error: '仅可在生产或建造回合发起交易' };
  }
  if (game.currentPlayerId !== player.id) {
    return { ok: false, error: '仅可在自己的回合发起交易' };
  }
  if (game.phase === 'build' && game.buildPassed[player.id]) {
    return { ok: false, error: '你已跳过本轮建造' };
  }
  const targetId = payload && payload.targetId;
  if (!targetId || targetId === player.id) {
    return { ok: false, error: '请选择交易对象' };
  }
  const target = playerById(game, targetId);
  if (!target || target.left) {
    return { ok: false, error: '交易对象无效' };
  }
  const give = normalizeTradeAmounts(payload.give);
  const take = normalizeTradeAmounts(payload.take);
  if (sumRes(give) === 0 && sumRes(take) === 0) {
    return { ok: false, error: '交易内容不能为空' };
  }
  for (const r of RESOURCES) {
    if ((player.resources[r] || 0) < give[r]) {
      return { ok: false, error: `${RESOURCE_LABELS[r]}不足` };
    }
  }
  game.pendingTrade = {
    fromId: player.id,
    toId: target.id,
    give,
    take,
  };
  pushLog(
    game,
    `${player.name} 向 ${target.name} 发起交易：交出 ${formatTradeRes(
      give
    )}，获得 ${formatTradeRes(take)}`
  );
  return { ok: true };
}

function actAcceptTrade(game, player) {
  const trade = game.pendingTrade;
  if (!trade || trade.toId !== player.id) {
    return { ok: false, error: '没有待处理的交易' };
  }
  const from = playerById(game, trade.fromId);
  const to = player;
  if (!from || from.left) {
    game.pendingTrade = null;
    return { ok: false, error: '发起方已离开' };
  }
  for (const r of RESOURCES) {
    if ((from.resources[r] || 0) < (trade.give[r] || 0)) {
      return { ok: false, error: '发起方资源已变化，暂无法达成' };
    }
    if ((to.resources[r] || 0) < (trade.take[r] || 0)) {
      return { ok: false, error: '你的资源不足，无法达成交易' };
    }
  }
  for (const r of RESOURCES) {
    const g = trade.give[r] || 0;
    const t = trade.take[r] || 0;
    if (g > 0) {
      from.resources[r] -= g;
      to.resources[r] = (to.resources[r] || 0) + g;
    }
    if (t > 0) {
      to.resources[r] -= t;
      from.resources[r] = (from.resources[r] || 0) + t;
    }
  }
  syncResourceHandPending(from, game);
  syncResourceHandPending(to, game);
  pushLog(game, `${to.name} 接受了与 ${from.name} 的交易`);
  game.pendingTrade = null;
  return { ok: true };
}

function actRejectTrade(game, player) {
  const trade = game.pendingTrade;
  if (!trade) return { ok: false, error: '没有待处理的交易' };
  if (trade.toId !== player.id && trade.fromId !== player.id) {
    return { ok: false, error: '无权处理该交易' };
  }
  const from = playerById(game, trade.fromId);
  const to = playerById(game, trade.toId);
  if (player.id === trade.toId) {
    pushLog(game, `${to ? to.name : '玩家'} 拒绝了交易`);
  } else {
    pushLog(game, `${from ? from.name : '玩家'} 取消了交易`);
  }
  game.pendingTrade = null;
  return { ok: true };
}

function actExchange(game, player, payload) {
  const built = countBuiltExchanges(player);
  const exCount = effectiveExchangeCount(player);
  const caravan = caravanExchangeActive(game, player);
  const need = effectiveExchangeCost(player, game);
  const from = payload.from;
  const to = payload.to;

  // 兼容旧格式：单一资源字符串
  if (typeof from === 'string' && typeof to === 'string') {
    const count = Math.max(1, Math.floor(Number(payload.count) || 1));
    if (!RESOURCES.includes(from) || !RESOURCES.includes(to)) {
      return { ok: false, error: '资源类型无效' };
    }
    if (from === to) {
      return { ok: false, error: '换出与换入资源不能相同' };
    }
    const totalNeed = need * count;
    if ((player.resources[from] || 0) < totalNeed) {
      return {
        ok: false,
        error: `需要 ${totalNeed} 个${RESOURCE_LABELS[from]}${
          caravan
            ? '（商队来临 ' + need + '换1）'
            : exCount > 0
              ? '（集市生效 ' + exCount + ' 座）'
              : ''
        }`,
      };
    }
    player.resources[from] -= totalNeed;
    player.resources[to] = (player.resources[to] || 0) + count;
    const sourceLabel = caravan
      ? '商队来临（1换1）'
      : exCount > 0
        ? built > exCount
          ? `用集市（建成 ${built} 座，生效 ${exCount} 座，${need}换1）`
          : `用集市（${exCount}座，${need}换1）`
        : `银行兑换（${need}换1）`;
    const stepText = `${player.name} ${sourceLabel}：${totalNeed}${RESOURCE_LABELS[from]} → ${count}${RESOURCE_LABELS[to]}`;
    pushLog(game, stepText);
    pushPlayReveal(game, {
      kind: 'step',
      actorId: player.id,
      actorName: player.name,
      stepText,
    });
    return { ok: true };
  }

  // 新格式：多资源对象（from/to 按“张数”传递；默认可混合）
  if (typeof from !== 'object' || typeof to !== 'object' || from === null || to === null) {
    return { ok: false, error: '资源类型无效' };
  }

  const fromCounts = {};
  const toCounts = {};
  let totalFromCount = 0;
  let totalToCount = 0;
  for (const r of RESOURCES) {
    const fc = Math.max(0, Math.floor(Number(from[r]) || 0));
    const tc = Math.max(0, Math.floor(Number(to[r]) || 0));
    if (fc > 0 && tc > 0) {
      return { ok: false, error: `${RESOURCE_LABELS[r]} 不能同时换出和换入` };
    }
    fromCounts[r] = fc;
    toCounts[r] = tc;
    totalFromCount += fc;
    totalToCount += tc;
  }
  if (totalFromCount === 0 || totalToCount === 0) {
    return { ok: false, error: '请至少选择一种换出和一种换入资源' };
  }

  // 默认可混合：换出总张数 = need × 批次，换入总张数 = 批次
  if (totalFromCount % need !== 0) {
    return {
      ok: false,
      error: `换出总张数(${totalFromCount})必须是 ${need} 的倍数`,
    };
  }
  const batch = totalFromCount / need;
  if (totalToCount !== batch) {
    return {
      ok: false,
      error: `换入总数(${totalToCount})与可兑换数量(${batch})不相等`,
    };
  }

  for (const r of RESOURCES) {
    if ((player.resources[r] || 0) < fromCounts[r]) {
      return {
        ok: false,
        error: `${RESOURCE_LABELS[r]} 不足，需要 ${fromCounts[r]}`,
      };
    }
  }

  const fromParts = [];
  const toParts = [];
  for (const r of RESOURCES) {
    const fc = fromCounts[r];
    const tc = toCounts[r];
    if (fc > 0) {
      player.resources[r] = (player.resources[r] || 0) - fc;
      fromParts.push(`${fc}${RESOURCE_LABELS[r]}`);
    }
    if (tc > 0) {
      player.resources[r] = (player.resources[r] || 0) + tc;
      toParts.push(`${tc}${RESOURCE_LABELS[r]}`);
    }
  }

  const sourceLabel = caravan
    ? '商队来临（1换1）'
    : exCount > 0
      ? built > exCount
        ? `用集市（建成 ${built} 座，生效 ${exCount} 座，${need}换1）`
        : `用集市（${exCount}座，${need}换1）`
      : `银行兑换（${need}换1，可混合）`;
  const stepText = `${player.name} ${sourceLabel}：${fromParts.join('+')} → ${toParts.join('+')}`;
  pushLog(game, stepText);
  pushPlayReveal(game, {
    kind: 'step',
    actorId: player.id,
    actorName: player.name,
    stepText,
  });
  return { ok: true };
}

function returnFuncToDiscard(game, card) {
  pushToDiscard(game, 'function', card);
}

function actUseFunc(game, player, payload) {
  const cardId = payload.cardId;
  const idx = player.funcCards.findIndex((c) => c.id === cardId);
  if (idx < 0) return { ok: false, error: '功能卡不存在' };
  const card = player.funcCards[idx];
  const ft = card.funcType;

  // 时机校验
  const produceOnly = ['remoteDice', 'exile', 'banditRaid'];
  const buildOnly = ['harvest', 'robbery', 'illegalBuild', 'redraw', 'expand', 'enhance', 'recruit', 'freeExpand', 'welfareHouse', 'caravan'];

  if (produceOnly.includes(ft)) {
    if (game.phase !== 'produce') {
      return { ok: false, error: '该功能只能在生产阶段使用' };
    }
    if (game.currentPlayerId !== player.id) {
      return { ok: false, error: '还没轮到你' };
    }
  } else if (buildOnly.includes(ft)) {
    if (game.phase !== 'build') {
      return { ok: false, error: '该功能只能在建造阶段使用' };
    }
    if (game.currentPlayerId !== player.id) {
      return { ok: false, error: '还没轮到你' };
    }
    if (game.buildPassed[player.id]) {
      return { ok: false, error: '你已跳过本轮建造' };
    }
    const block = rejectIfBuildPhaseCardDiscardPending(player);
    if (block) return block;
  } else {
    return { ok: false, error: '未知功能' };
  }

  const logLen = game.log.length;
  let result;
  if (ft === 'harvest') result = useHarvest(game, player, payload);
  else if (ft === 'remoteDice') result = useRemoteDice(game, player, payload);
  else if (ft === 'exile') result = useExile(game, player, payload);
  else if (ft === 'redraw') {
    result = useRedraw(game, player, { ...payload, redrawCardId: cardId });
  }
  else if (ft === 'banditRaid') result = useBanditRaid(game, player, payload);
  else if (ft === 'expand') result = useExpand(game, player, payload);
  else if (ft === 'enhance') result = useEnhance(game, player, payload);
  else if (ft === 'recruit') result = useRecruit(game, player, payload);
  else if (ft === 'freeExpand') result = useFreeExpand(game, player, payload);
  else if (ft === 'welfareHouse') result = useWelfareHouse(game, player, payload);
  else if (ft === 'caravan') result = useCaravan(game, player, payload);
  else if (ft === 'robbery') result = useRobbery(game, player, payload);
  else if (ft === 'illegalBuild') {
    if (!hasIllegalBuildTarget(game)) {
      return { ok: false, error: '没有玩家持有已建造的建筑' };
    }
    result = useIllegalBuild(game, player, { ...payload, cardId });
  }
  else return { ok: false, error: '未知功能' };

  if (!result.ok) return result;
  if (result.awaitingPick) {
    return { ok: true };
  }

  player.funcCards.splice(idx, 1);
  returnFuncToDiscard(game, card);
  pushLog(game, `${player.name} 发动功能「${card.label}」`);
  pushPlayReveal(game, {
    kind: 'function',
    actorId: player.id,
    actorName: player.name,
    card: {
      id: card.id,
      label: card.label,
      funcType: ft,
    },
    stepText: pickActionLogText(game, logLen),
    afterFx: ft === 'exile' || ft === 'banditRaid' ? ft : null,
  });

  if (checkWin(game)) return { ok: true };

  // 推进阶段
  if (game.phase === 'build' && game.currentPlayerId === player.id) {
    afterBuildAction(game, player.id, true);
  }

  return { ok: true };
}

function useHarvest(game, player, payload) {
  const picks = payload.resources || payload.picks;
  if (!Array.isArray(picks) || picks.length !== 3) {
    return { ok: false, error: '请选择任意 3 个资源' };
  }
  for (const r of picks) {
    if (!RESOURCES.includes(r)) return { ok: false, error: '资源无效' };
    player.resources[r] = (player.resources[r] || 0) + 1;
  }
  return { ok: true };
}

function useRemoteDice(game, player, payload) {
  if (game.phase !== 'produce') {
    return { ok: false, error: '遥控骰子请在生产阶段、轮到你时使用' };
  }
  if (game.currentPlayerId !== player.id) {
    return { ok: false, error: '还没轮到你' };
  }
  if (game.remoteDiceMode) {
    return { ok: false, error: '已在遥控骰子模式中' };
  }

  // 投掷前：进入遥控模式（点数=0 表示任意）
  if (game.awaitingProduceRoll) {
    const n = idleVillagers(player);
    if (n <= 0) return { ok: false, error: '没有可派遣的村民' };
    game.awaitingProduceRoll = false;
    game.remoteDiceMode = true;
    game.dice[player.id] = Array(n).fill(0);
    assignDiceBoostFlags(game, player, n);
    pushLog(game, `${player.name} 使用遥控骰子（${n} 枚，可指定任意点数）`);
    return { ok: true };
  }

  // 投掷后：将当前剩余骰子改为任意点数（可对结果不满意后改写）
  const current = game.dice[player.id] || [];
  const n = current.length;
  if (n <= 0) {
    return { ok: false, error: '没有可改写的骰子' };
  }

  // 兼容旧接口：直接指定全部点数
  const dice = payload && payload.dice;
  if (Array.isArray(dice) && dice.length === n) {
    if (!dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) {
      return { ok: false, error: '骰子点数无效' };
    }
    game.remoteDiceMode = false;
    game.dice[player.id] = dice.map(Number);
    const prevBoost = (game.diceBoosted && game.diceBoosted[player.id]) || [];
    if (!game.diceBoosted) game.diceBoosted = {};
    game.diceBoosted[player.id] = prevBoost.slice(0, n);
    while (game.diceBoosted[player.id].length < n) {
      game.diceBoosted[player.id].push(false);
    }
    pushLog(game, `${player.name} 遥控骰子 → [${dice.join(', ')}]`);
    return { ok: true };
  }

  const prevBoost = (game.diceBoosted && game.diceBoosted[player.id]) || [];
  game.remoteDiceMode = true;
  game.dice[player.id] = Array(n).fill(0);
  if (!game.diceBoosted) game.diceBoosted = {};
  game.diceBoosted[player.id] = prevBoost.slice(0, n);
  while (game.diceBoosted[player.id].length < n) {
    game.diceBoosted[player.id].push(false);
  }
  pushLog(
    game,
    `${player.name} 使用遥控骰子改写剩余 ${n} 枚骰子（可指定任意点数）`
  );
  return { ok: true };
}

function useExile(game, player, payload) {
  if (game.phase !== 'produce') {
    return { ok: false, error: '驱逐只能在生产阶段、轮到你时使用' };
  }
  if (game.currentPlayerId !== player.id) {
    return { ok: false, error: '还没轮到你' };
  }
  if (payload && payload.buildingId) {
    return { ok: false, error: '驱逐仅可移动数字格上的骰子' };
  }

  const area = payload.area;
  const number = Number(payload.number);
  const toArea = payload.toArea;
  const toNumber = Number(payload.toNumber);
  const targetId = payload.targetId;
  const target = playerById(game, targetId);
  if (!target) return { ok: false, error: '目标玩家无效' };

  if (!BOARD_AREAS.includes(area) || !BOARD_AREAS.includes(toArea)) {
    return { ok: false, error: '请选择资源/功能/建筑区' };
  }
  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 6 ||
    !Number.isInteger(toNumber) ||
    toNumber < 1 ||
    toNumber > 6
  ) {
    return { ok: false, error: '数字格无效' };
  }
  if (area === toArea && number === toNumber) {
    return { ok: false, error: '目标板块不能与来源相同' };
  }
  if (targetId === NEUTRAL_WORKER_ID) {
    return { ok: false, error: '无法驱逐中立强盗' };
  }
  const slotW = game.board[area].workers[number] || {};
  if ((slotW[targetId] || 0) < 1) {
    return { ok: false, error: '该玩家在此数字格没有村民' };
  }

  const dieKind =
    payload && typeof payload.enhanced === 'boolean' ? payload.enhanced : undefined;
  const removed = removeOneDieFromBoardSlot(game, area, number, targetId, dieKind);
  if (!removed.ok) {
    return { ok: false, error: removed.error };
  }
  const placed = placeOneDieOnBoardSlot(
    game,
    toArea,
    toNumber,
    targetId,
    removed.wasEnhanced
  );
  if (!placed.ok) {
    placeOneDieOnBoardSlot(
      game,
      area,
      number,
      targetId,
      removed.wasEnhanced
    );
    return { ok: false, error: placed.error };
  }

  pushProduceFx(game, {
    type: 'exile',
    actorId: player.id,
    targetId,
    area,
    number,
    toArea,
    toNumber,
    enhanced: removed.wasEnhanced,
  });
  pushLog(
    game,
    `${player.name} 驱逐：将 ${target.name} 的骰子从${AREA_LABELS[area]}区 ${number} 号格移到${AREA_LABELS[toArea]}区 ${toNumber} 号格` +
      (removed.wasEnhanced ? '（强化）' : '')
  );
  return { ok: true };
}

/** 强盗来袭：在指定大区数字格放置 2 枚中立骰子（无消耗，参与抵消与名次） */
function useBanditRaid(game, player, payload) {
  if (game.phase !== 'produce') {
    return { ok: false, error: '强盗来袭只能在生产阶段、轮到你时使用' };
  }
  if (game.currentPlayerId !== player.id) {
    return { ok: false, error: '还没轮到你' };
  }
  const area = payload.area;
  const number = Number(payload.number);
  if (!BOARD_AREAS.includes(area)) {
    return { ok: false, error: '请选择资源/功能/建筑区' };
  }
  if (!Number.isInteger(number) || number < 1 || number > 6) {
    return { ok: false, error: '数字格无效' };
  }
  const areaBoard = game.board[area];
  const tiles = tilesOnNumber(areaBoard, number);
  if (!tiles.length) {
    return {
      ok: false,
      error: `${AREA_LABELS[area]}区 ${number} 号格没有板块`,
    };
  }
  const slotW = areaBoard.workers[number] || (areaBoard.workers[number] = {});
  slotW[NEUTRAL_WORKER_ID] =
    (slotW[NEUTRAL_WORKER_ID] || 0) + BANDIT_RAID_COUNT;
  pushProduceFx(game, {
    type: 'banditRaid',
    actorId: player.id,
    area,
    number,
    count: BANDIT_RAID_COUNT,
  });
  pushLog(
    game,
    `${player.name} 强盗来袭：在${AREA_LABELS[area]}区 ${number} 号格放置 ${BANDIT_RAID_COUNT} 枚中立骰子`
  );
  return { ok: true };
}

/** 抢劫：从目标玩家手牌中随机夺取 1 张资源卡 */
function stealableItems(player) {
  const items = [];
  if (!player) return items;
  for (const r of RESOURCES) {
    const n = Number(player.resources[r]) || 0;
    for (let i = 0; i < n; i++) {
      items.push({ kind: 'resource', resource: r });
    }
  }
  return items;
}

function stealableHandCount(player) {
  return stealableItems(player).length;
}

function applyRandomSteal(game, robber, target) {
  const pool = stealableItems(target);
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (pick.kind === 'resource') {
    const resource = pick.resource;
    if ((target.resources[resource] || 0) < 1) return null;
    target.resources[resource] -= 1;
    robber.resources[resource] = (robber.resources[resource] || 0) + 1;
    syncResourceHandPending(robber, game);
    return { kind: 'resource', label: RESOURCE_LABELS[resource] };
  }
  return null;
}

function normalizeRobberyTargets(payload) {
  if (!payload) return null;
  if (Array.isArray(payload.targets) && payload.targets.length === 2) {
    return payload.targets.map(String);
  }
  return null;
}

function countBuiltBuildings(player) {
  return (player.buildings || []).filter((b) => b.built).length;
}

function hasIllegalBuildTarget(game) {
  return alivePlayers(game).some((p) => countBuiltBuildings(p) > 0);
}

function revertBuildingToUnbuilt(player, b) {
  if ((b.workers || 0) > 0) {
    player.dispatched = Math.max(0, (player.dispatched || 0) - b.workers);
    b.workers = 0;
  }
  b.built = false;
  b.faceDown = false;
}

function useIllegalBuild(game, player, payload) {
  const targetId = payload.targetId || payload.target;
  const target = playerById(game, targetId);
  if (!target || target.left) {
    return { ok: false, error: '目标玩家无效' };
  }
  if (!countBuiltBuildings(target)) {
    return { ok: false, error: `${target.name} 没有已建造的建筑` };
  }
  if (game.pendingIllegalBuild) {
    return { ok: false, error: '请先完成待处理的拆迁' };
  }
  game.pendingIllegalBuild = {
    actorId: player.id,
    actorName: player.name,
    targetId: target.id,
    targetName: target.name,
    cardId: payload.cardId,
  };
  pushLog(
    game,
    `${player.name} 发动「拆迁」：请 ${target.name} 选择一座已建建筑变为未建造`
  );
  return { ok: true, awaitingPick: true };
}

function actCancelIllegalBuild(game, player) {
  const pending = game.pendingIllegalBuild;
  if (!pending) return { ok: false, error: '没有待处理的拆迁' };
  if (player.id !== pending.actorId) {
    return { ok: false, error: '仅发动者可取消拆迁' };
  }
  game.pendingIllegalBuild = null;
  pushLog(game, `${player.name} 取消了「拆迁」`);
  return { ok: true };
}

function actIllegalBuildPick(game, player, payload) {
  const pending = game.pendingIllegalBuild;
  if (!pending) return { ok: false, error: '没有待处理的拆迁' };
  if (player.id !== pending.targetId) {
    return { ok: false, error: '请由目标玩家选择建筑' };
  }
  const buildingId = payload.buildingId;
  const b = findPersonalBuilding(player, buildingId);
  if (!b || !b.built) {
    return { ok: false, error: '请选择一座已建造的建筑' };
  }
  const actor = playerById(game, pending.actorId);
  if (!actor || actor.left) {
    game.pendingIllegalBuild = null;
    return { ok: false, error: '发动者无效' };
  }
  const cardIdx = actor.funcCards.findIndex((c) => c.id === pending.cardId);
  if (cardIdx < 0) {
    game.pendingIllegalBuild = null;
    return { ok: false, error: '功能卡已失效' };
  }
  const card = actor.funcCards[cardIdx];
  const logLen = game.log.length;

  const scorePts = b.built ? Math.max(0, Number(b.score) || 0) : 0;
  const bankScore =
    scorePts > 0 && b.buildType === 'score2';
  if (bankScore) {
    player.bonusScore = (Number(player.bonusScore) || 0) + scorePts;
  }
  revertBuildingToUnbuilt(player, b);
  let stepText =
    `${player.name} 被 ${pending.actorName} 的「拆迁」拆除「${b.label}」，变为未建造`;
  if (bankScore) {
    stepText += `，已获 +${scorePts} 分保留（当前 ${playerScore(player)} 分，可再次建造得分）`;
  } else if (scorePts > 0) {
    stepText += `，失去 +${scorePts} 分（当前 ${playerScore(player)} 分）`;
  }
  pushLog(game, stepText);

  actor.funcCards.splice(cardIdx, 1);
  returnFuncToDiscard(game, card);
  pushPlayReveal(game, {
    kind: 'function',
    actorId: actor.id,
    actorName: actor.name,
    card: {
      id: card.id,
      label: card.label,
      funcType: 'illegalBuild',
    },
    stepText: pickActionLogText(game, logLen) || stepText,
  });

  game.pendingIllegalBuild = null;

  if (checkWin(game)) return { ok: true };

  if (game.phase === 'build' && game.currentPlayerId === pending.actorId) {
    afterBuildAction(game, pending.actorId, true);
  }
  return { ok: true };
}

function useRobbery(game, player, payload) {
  const targetIds = normalizeRobberyTargets(payload);
  if (!targetIds) {
    return { ok: false, error: '请选择两名抢劫目标' };
  }
  const targets = [];
  for (const tid of targetIds) {
    const target = playerById(game, tid);
    if (!target || target.left) {
      return { ok: false, error: '目标玩家无效' };
    }
    if (target.id === player.id) {
      return { ok: false, error: '不能抢劫自己' };
    }
    if (!stealableHandCount(target)) {
      return { ok: false, error: `${target.name} 没有可抢的手牌` };
    }
    if (
      targets.length === 1 &&
      targets[0].id === target.id &&
      stealableHandCount(target) < 2
    ) {
      return { ok: false, error: `${target.name} 手牌不足 2 张，不能重复选择` };
    }
    targets.push(target);
  }

  const parts = [];
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const stole = applyRandomSteal(game, player, target);
    if (stole) {
      parts.push(`从 ${target.name} 夺取「${stole.label}」`);
    } else {
      parts.push(`从 ${target.name} 未夺取到牌`);
    }
  }
  pushLog(game, `${player.name} 抢劫：${parts.join('；')}`);
    return { ok: true };
  }

function actBuildHousePermanent(game, player) {
  const block = rejectIfBuildPhaseCardDiscardPending(player);
  if (block) return block;
  if (player.roundBuiltHouse) {
    return { ok: false, error: '本回合已建造房子' };
  }
  if (!canPay(player.resources, BUILD_HOUSE_COST)) {
    return {
      ok: false,
      error: `需要 ${BUILD_HOUSE_COST.wood}木 ${BUILD_HOUSE_COST.stone}石 ${BUILD_HOUSE_COST.iron}铁`,
    };
  }
  pay(player.resources, BUILD_HOUSE_COST);
  player.houses = (Number(player.houses) || 0) + 1;
  player.houseScore = (Number(player.houseScore) || 0) + 1;
  player.roundBuiltHouse = true;
  const stepText = `${player.name} 建造房子，+1 房 +1 分（房子 ${player.houses}，空位 ${freeHousesFor(player)}，分数 ${playerScore(player)}）`;
  pushLog(game, stepText);
  pushPlayReveal(game, {
    kind: 'step',
    actorId: player.id,
    actorName: player.name,
    stepText,
  });
  if (checkWin(game)) return { ok: true };
  // 常驻功能不结束回合，保留玩家行动权
  game.lastBuilderId = player.id;
  return { ok: true };
}

function actBreedPermanent(game, player) {
  const block = rejectIfBuildPhaseCardDiscardPending(player);
  if (block) return block;
  if (player.roundBred) {
    return { ok: false, error: '本回合已繁殖村民' };
  }
  if (player.villagers >= MAX_VILLAGERS) {
    return { ok: false, error: `村民已达上限 ${MAX_VILLAGERS}` };
  }
  const free = freeHousesFor(player);
  if (free <= 0) {
    return {
      ok: false,
      error: `村民已达住房上限（容量 ${villagerCapacityFor(player)} / 村民 ${player.villagers}），请先建造房子`,
    };
  }
  const cost = breedFoodCost(player.villagers);
  if ((player.resources.food || 0) < cost) {
    return { ok: false, error: `需要 ${cost} 小麦` };
  }
  player.resources.food -= cost;
  player.villagers += 1;
  player.roundBred = true;
  const stepText = `${player.name} 繁殖村民（-${cost} 小麦），村民 ${player.villagers}（空位 ${freeHousesFor(player)}）`;
  pushLog(game, stepText);
  pushPlayReveal(game, {
    kind: 'step',
    actorId: player.id,
    actorName: player.name,
    stepText,
  });
  if (checkWin(game)) return { ok: true };
  // 常驻功能不结束回合，保留玩家行动权
  game.lastBuilderId = player.id;
  return { ok: true };
}

function actExpandPermanent(game, player, payload) {
  const block = rejectIfBuildPhaseCardDiscardPending(player);
  if (block) return block;
  if (player.roundExpanded) {
    return { ok: false, error: '本回合已扩建' };
  }
  const cost = expandPermanentCost(player);
  if (!canPay(player.resources, cost)) {
    return {
      ok: false,
      error: '需要各 1 木 1 石 1 麦 1 铁',
    };
  }
  pay(player.resources, cost);
  const result = useExpand(game, player, payload);
  if (!result.ok) {
    for (const k of RESOURCES) {
      player.resources[k] = (player.resources[k] || 0) + (cost[k] || 0);
    }
    return result;
  }
  player.roundExpanded = true;
  const stepText = pickActionLogText(game, game.log.length - 2);
  pushLog(
    game,
    `${player.name} 常驻扩建（-1 木 -1 石 -1 麦 -1 铁）`
  );
  pushPlayReveal(game, {
    kind: 'step',
    actorId: player.id,
    actorName: player.name,
    stepText: stepText || `${player.name} 常驻扩建（-1 木 -1 石 -1 麦 -1 铁）`,
  });
  if (checkWin(game)) return { ok: true };
  game.lastBuilderId = player.id;
  return { ok: true };
}

function useExpand(game, player, payload) {
  const direction = parseExpandDirection(payload);
  if (!direction) {
    return { ok: false, error: '请选择扩建栏位（建筑格 / 功能卡格 / 资源卡位）' };
  }

  if (direction === 'building') {
    player.expandSlots = (Number(player.expandSlots) || 0) + 1;
    pushLog(
      game,
      `${player.name} 扩建建筑格（建筑上限 ${maxBuildingsFor(player)}）`
    );
  } else if (direction === 'function') {
    player.expandFuncSlots = (Number(player.expandFuncSlots) || 0) + 1;
    pushLog(
      game,
      `${player.name} 扩建功能卡格（功能上限 ${maxFuncHandFor(player)}）`
    );
    if (player.funcCards.length > maxFuncHandFor(player)) {
      syncFuncHandPending(player);
    }
    } else {
    player.expandResSlots = (Number(player.expandResSlots) || 0) + 1;
    pushLog(
      game,
      `${player.name} 扩建资源卡位（资源上限 ${maxResourceHandFor(player)}）`
    );
  }
  return { ok: true };
}

/** 强化：将 1 枚未强化骰子强化（建造阶段）；已达上限 3 或全部已强化则无法发动 */
function useEnhance(game, player, _payload) {
  const villagers = Number(player.villagers) || 0;
  const cur = Number(player.enhancedDice) || 0;
  const cap = Math.min(villagers, MAX_ENHANCED_DICE);
  if (villagers <= 0 || cap <= 0) {
    return { ok: false, error: '没有可强化的骰子' };
  }
  if (cur >= MAX_ENHANCED_DICE) {
    return { ok: false, error: `强化骰已达上限 ${MAX_ENHANCED_DICE}` };
  }
  if (cur >= villagers) {
    return { ok: false, error: '全部骰子已强化，无法发动' };
  }
  player.enhancedDice = cur + 1;
  pushLog(
    game,
    `${player.name} 强化 1 枚骰子（${player.enhancedDice}/${MAX_ENHANCED_DICE}）`
  );
  return { ok: true };
}

/** 征召：建造阶段使用；下一轮生产获得临时村民，该生产阶段结束后消失 */
function useRecruit(game, player, _payload) {
  player.recruitPending =
    (Number(player.recruitPending) || 0) + RECRUIT_TEMP_VILLAGERS;
  pushLog(
    game,
    `${player.name} 发动征召：下一轮生产临时村民 +${RECRUIT_TEMP_VILLAGERS}（累计待生效 ${player.recruitPending}）`
  );
  return { ok: true };
}

/** 免费扩建：建造阶段使用；立即扩建一格，不消耗资源 */
function useFreeExpand(game, player, payload) {
  return useExpand(game, player, payload);
}

/** 福利房：建造阶段使用；+1 房子（不计分） */
function useWelfareHouse(game, player, _payload) {
  player.houses = (Number(player.houses) || 0) + 1;
  player.welfareHouses = (Number(player.welfareHouses) || 0) + 1;
  pushLog(
    game,
    `${player.name} 发动福利房：+1 房（不计分，房子 ${player.houses}，空位 ${freeHousesFor(player)}）`
  );
  return { ok: true };
}

/** 商队来临：建造阶段使用；本回合结束前可按 1:1 兑换；已建集市则 +1 胜利点 */
function useCaravan(game, player, _payload) {
  if (player.caravanPending) {
    return { ok: false, error: '商队效果已生效' };
  }
  player.caravanPending = true;
  const hasMarket = countBuiltExchanges(player) > 0;
  let logMsg = `${player.name} 发动商队来临：本回合结束前可按 1换1 兑换资源`;
  if (hasMarket) {
    player.bonusScore = (Number(player.bonusScore) || 0) + 1;
    logMsg += `，已建集市 +1 分（当前 ${playerScore(player)} 分）`;
    checkWin(game);
  }
  pushLog(game, logMsg);
  return { ok: true };
}

function giveSpecialDrawToPlayer(game, player, card) {
  if (deckKindOfTile(card) === 'building') {
    if (grantInstantScoreBuilding(game, player, card)) {
      return 'building-instant';
    }
    const neu = {
        ...card,
      faceDown: false,
        slot: null,
        built: false,
        workers: 0,
    };
    if (!assignBuildingSlot(player, neu)) {
      queuePendingBuildCard(player, neu);
    } else {
      player.buildings.push(neu);
    }
    return 'building';
  }
  receiveFunctionCard(game, player, card);
  return 'function';
}

function publicRedrawOption(card) {
  if (!card) return null;
  return {
    id: card.id,
    kind: card.kind,
    label: card.label,
    funcType: card.funcType || null,
    buildType: card.buildType || null,
    resource: card.resource || null,
    rich: card.rich != null ? card.rich : null,
    cost: card.cost || null,
  };
}

function useRedraw(game, player, payload) {
  const block = rejectIfBuildPhaseCardDiscardPending(player);
  if (block) return block;
  return startDrawPickOne(game, player, {
    source: 'redraw',
    redrawCardId: payload.redrawCardId || payload.cardId,
    logText: `${player.name} 重抽：翻开 ${SPECIAL_DRAW_PICK_COUNT} 张，请选择 1 张保留`,
  });
}

function actBuyFuncCardPermanent(game, player) {
  const block = rejectIfBuildPhaseCardDiscardPending(player);
  if (block) return block;
  if (!canPay(player.resources, BUY_FUNC_COST)) {
    return { ok: false, error: '需要 1 木 1 石 2 铁' };
  }
  pay(player.resources, BUY_FUNC_COST);
  const result = startDrawPickOne(game, player, {
    source: 'buyFunc',
    logText: `${player.name} 购买功能卡（-1 木 -1 石 -2 铁）：翻开 ${SPECIAL_DRAW_PICK_COUNT} 张，请选择 1 张保留`,
  });
  if (!result.ok) {
    for (const k of RESOURCES) {
      player.resources[k] =
        (player.resources[k] || 0) + (BUY_FUNC_COST[k] || 0);
    }
    return result;
  }
  game.lastBuilderId = player.id;
  return { ok: true, awaitingPick: true };
}

/** 功能/建筑合堆不足 needCount 张时，将剩余抽牌堆与弃牌堆合并洗混 */
function replenishSpecialDeckIfNeeded(game, needCount) {
  const dk = deckKey('special');
  const xk = discardKey('special');
  const deck = game[dk] || [];
  if (deck.length >= needCount) return true;
  const discard = game[xk] || [];
  if (!discard.length) return deck.length >= needCount;
  game[dk] = shuffle([...deck, ...discard]);
  game[xk] = [];
  pushLog(
    game,
    `功能/建筑合堆不足 ${needCount} 张，弃牌堆洗混后放回（${game[dk].length} 张）`
  );
  return game[dk].length >= needCount;
}

function startDrawPickOne(game, player, meta) {
  if (game.pendingRedrawChoice) {
    return { ok: false, error: '请先选择要保留的牌' };
  }
  if (!replenishSpecialDeckIfNeeded(game, SPECIAL_DRAW_PICK_COUNT)) {
    return {
      ok: false,
      error: `功能/建筑合堆不足 ${SPECIAL_DRAW_PICK_COUNT} 张`,
    };
  }
  const drawn = [];
  for (let i = 0; i < SPECIAL_DRAW_PICK_COUNT; i++) {
    const c = drawOne(game, 'special');
    if (!c) break;
    drawn.push(c);
  }
  if (drawn.length < SPECIAL_DRAW_PICK_COUNT) {
    for (let i = drawn.length - 1; i >= 0; i--) {
      game.specialDeck.unshift(drawn[i]);
    }
    return {
      ok: false,
      error: `功能/建筑合堆不足 ${SPECIAL_DRAW_PICK_COUNT} 张`,
    };
  }
  game.pendingRedrawChoice = {
    playerId: player.id,
    source: meta.source || 'redraw',
    redrawCardId: meta.redrawCardId || null,
    options: drawn,
  };
  if (meta.logText) pushLog(game, meta.logText);
  return { ok: true, awaitingPick: true };
}

function discardLabel(cards) {
  return (cards || [])
    .map((c) => `「${c.label || '?'}」`)
    .join('、');
}

function actRedrawPick(game, player, payload) {
  const pending = game.pendingRedrawChoice;
  if (!pending || pending.playerId !== player.id) {
    return { ok: false, error: '没有待选择的抽牌' };
  }
  const keepId = payload.keepId;
  const keep = (pending.options || []).find((c) => c.id === keepId);
  if (!keep) return { ok: false, error: '请选择要保留的牌' };
  const discardCards = (pending.options || []).filter((c) => c.id !== keepId);
  if (!discardCards.length) return { ok: false, error: '抽牌选项无效' };

  const logLen = game.log.length;
  const source = pending.source || 'redraw';
  const kind = giveSpecialDrawToPlayer(game, player, keep);
  syncFuncHandPending(player);
  for (const dc of discardCards) {
    pushToDiscard(game, 'special', dc);
  }
  const discardText = discardLabel(discardCards);
  const keepDesc =
    kind === 'building-instant'
      ? `「${keep.label || '?'}」即时效果`
      : `${kind === 'building' ? '建筑' : '功能'}「${keep.label || '?'}」`;

  if (pending.redrawCardId) {
    const redrawIdx = player.funcCards.findIndex(
      (c) => c.id === pending.redrawCardId
    );
    if (redrawIdx < 0) {
      game.pendingRedrawChoice = null;
      return { ok: false, error: '重抽功能卡已不在手牌' };
    }
    const redrawCard = player.funcCards.splice(redrawIdx, 1)[0];
    returnFuncToDiscard(game, redrawCard);
    pushLog(
      game,
      `${player.name} 重抽：保留${keepDesc}，弃置${discardText}`
    );
    pushLog(game, `${player.name} 发动功能「${redrawCard.label}」`);
    pushPlayReveal(game, {
      kind: 'function',
      actorId: player.id,
      actorName: player.name,
      card: {
        id: redrawCard.id,
        label: redrawCard.label,
        funcType: 'redraw',
      },
      stepText: pickActionLogText(game, logLen),
      afterFx: null,
    });
  } else if (source === 'buyFunc') {
    pushLog(
      game,
      `${player.name} 购买功能卡：保留${keepDesc}，弃置${discardText}`
    );
    if (kind !== 'building-instant') {
      pushPlayReveal(game, {
        kind: 'step',
        actorId: player.id,
        actorName: player.name,
        stepText: pickActionLogText(game, logLen),
      });
    }
  } else {
    pushLog(
      game,
      `${player.name} 抽牌：保留${keepDesc}，弃置${discardText}`
    );
  }

  game.pendingRedrawChoice = null;

  if (checkWin(game)) return { ok: true };
  if (game.phase === 'build' && game.currentPlayerId === player.id) {
    if (playerNeedsBuildPhaseCardDiscard(player)) {
      game.lastBuilderId = player.id;
    return { ok: true };
  }
    afterBuildAction(game, player.id, true);
  }
  return { ok: true };
}

// ─── 公开状态 / 超时 / 退出 ─────────────────────────────

function publicTile(t) {
  if (t && t.faceDown) {
    return {
      id: t.id,
      kind: t.kind,
      number: t.number,
      cardIndexOnSlot: t.cardIndexOnSlot != null ? t.cardIndexOnSlot : null,
      faceDown: true,
      label: null,
      resource: null,
      rich: null,
      large: null,
      small: null,
      funcType: null,
      buildType: null,
      cost: null,
      produce: null,
      score: null,
    };
  }
  return {
    id: t.id,
    kind: t.kind,
    label: t.label,
    number: t.number,
    cardIndexOnSlot: t.cardIndexOnSlot != null ? t.cardIndexOnSlot : null,
    faceDown: false,
    resource: t.resource || null,
    rich: t.rich,
    large: t.large,
    small: t.small,
    funcType: t.funcType || null,
    buildType: t.buildType || null,
    cost: t.cost || null,
    produce: t.produce,
    score: t.score,
  };
}

function publicEnvironment(env) {
  if (!env) return null;
  const def = getEnvironmentDef(env.envType);
  const sideCardKind = env.sideCard ? deckKindOfTile(env.sideCard) : null;
  return {
    id: env.id,
    kind: 'environment',
    label: env.label || (def && def.label) || env.envType,
    number: env.number,
    envType: env.envType || null,
    trigger: env.trigger || (def && def.trigger) || null,
    desc: env.desc || (def && def.desc) || '',
    setup: env.setup || (def && def.setup) || null,
    faceDown: false,
    placeholder: false,
    mercenaryDice: Number(env.mercenaryDice) || 0,
    stash: env.stash && !env.stashClaimed ? { ...env.stash } : null,
    stashClaimed: Boolean(env.stashClaimed),
    firstComeTier:
      env.firstComeTier != null ? Number(env.firstComeTier) : null,
    firstComeRequired:
      env.firstComeRequired != null ? Number(env.firstComeRequired) : null,
    hasSideCard: Boolean(env.sideCard),
    /** 幸运一抽暗置牌类型（仅 kind，不泄露正面） */
    sideCardKind,
  };
}

function publicArea(areaBoard) {
  const slots = [];
  for (let num = 1; num <= 6; num++) {
    const tiles = tilesOnNumber(areaBoard, num).map(publicTile);
    const workers = { ...(areaBoard.workers[num] || {}) };
    const boosts = {
      ...((areaBoard.boosts && areaBoard.boosts[num]) || {}),
    };
    const environment =
      areaBoard.environments && areaBoard.environments[num]
        ? publicEnvironment(areaBoard.environments[num])
        : null;
    if (
      !tiles.length &&
      !environment &&
      !Object.keys(workers).length &&
      !Object.keys(boosts).length
    ) {
      slots.push({ number: num, tiles: [], workers: {}, boosts: {}, environment: null });
      continue;
    }
    slots.push({ number: num, tiles, workers, boosts, environment });
  }
  const boostAll = {};
  for (let n = 1; n <= 6; n++) {
    boostAll[n] = { ...((areaBoard.boosts && areaBoard.boosts[n]) || {}) };
  }
  const environments = {};
  for (const num of ENVIRONMENT_SLOT_NUMBERS) {
    environments[num] =
      areaBoard.environments && areaBoard.environments[num]
        ? publicEnvironment(areaBoard.environments[num])
        : null;
  }
  return {
    tiles: (areaBoard.tiles || []).map(publicTile),
    environments,
    slots,
    workers: {
      1: { ...(areaBoard.workers[1] || {}) },
      2: { ...(areaBoard.workers[2] || {}) },
      3: { ...(areaBoard.workers[3] || {}) },
      4: { ...(areaBoard.workers[4] || {}) },
      5: { ...(areaBoard.workers[5] || {}) },
      6: { ...(areaBoard.workers[6] || {}) },
    },
    boosts: boostAll,
  };
}

function publicGameState(game, viewerId) {
  if (!game) return null;
  const me = viewerId ? playerById(game, viewerId) : null;

  return {
    type: 'lasidao',
    phase: game.phase,
    round: game.round,
    over: game.over,
    winners: (game.winners || []).slice(),
    currentPlayerId: game.currentPlayerId,
    produceOrderStartId: game.produceOrderStartId,
    lastPlacerId: game.lastPlacerId,
    lastBuilderId: game.lastBuilderId,
    resourceLabels: RESOURCE_LABELS,
    funcLabels: FUNC_TYPES,
    areaLabels: AREA_LABELS,
    neutralWorkerId: NEUTRAL_WORKER_ID,
    neutralWorkerName: NEUTRAL_WORKER_NAME,
    maxBuildings: MAX_BUILDINGS,
    maxVillagers: MAX_VILLAGERS,
    maxEnhancedDice: MAX_ENHANCED_DICE,
    winScore: WIN_SCORE,
    villagersPerHouse: VILLAGERS_PER_HOUSE,
    buildHouseCost: { ...BUILD_HOUSE_COST },
    buyFuncCost: { ...BUY_FUNC_COST },
    breedFoodPerVillager: BREED_FOOD_PER_VILLAGER,
    breedFoodPerHouse: BREED_FOOD_PER_VILLAGER, // 兼容性字段
    board: {
      resource: publicArea(game.board.resource),
      special: publicArea(game.board.special),
    },
    decksLeft: {
      resource: game.resourceDeck.length,
      special: (game.specialDeck || []).length,
      environment: (game.environmentDeck || []).length,
    },
    discardsLeft: {
      resource: (game.resourceDiscard || []).length,
      special: (game.specialDiscard || []).length,
      environment: (game.environmentDiscard || []).length,
    },
    specialDeckTopKind: peekSpecialTopKind(game),
    initRolls:
      game.phase === 'init_roll' || game.phase === 'init_announce'
        ? Object.fromEntries(
            Object.entries(game.initRolls || {}).map(([id, v]) => [
              id,
              game.phase === 'init_announce'
                ? v
                : id === viewerId
                  ? v
                  : v != null
                    ? true
                    : null,
            ])
          )
        : null,
    pendingInitReveal: game.pendingInitReveal
      ? {
          myRoll: game.pendingInitReveal.rolls[viewerId],
          rolls: { ...(game.pendingInitReveal.rolls || {}) },
          firstPlayerId: game.pendingInitReveal.firstPlayerId,
          best: game.pendingInitReveal.best,
          announceUntil: game.pendingInitReveal.announceUntil || game.initAnnounceUntil || 0,
        }
        : null,
    dice: me ? (game.dice[me.id] || []).slice() : [],
    diceBoosted: me
      ? ((game.diceBoosted && game.diceBoosted[me.id]) || []).slice()
      : [],
    awaitingProduceRoll: Boolean(
      game.phase === 'produce' && game.awaitingProduceRoll
    ),
    // 当前行动者的骰子（所有人可见，便于旁观）
    activeProduce:
      game.phase === 'produce' && game.currentPlayerId
        ? {
            playerId: game.currentPlayerId,
            awaitingRoll: Boolean(game.awaitingProduceRoll),
            remoteDiceMode: Boolean(game.remoteDiceMode),
            dice: (game.dice[game.currentPlayerId] || []).slice(),
            diceBoosted: (
              (game.diceBoosted && game.diceBoosted[game.currentPlayerId]) ||
              []
            ).slice(),
          }
        : null,
    remoteDiceMode: Boolean(
      game.phase === 'produce' &&
        game.remoteDiceMode &&
        game.currentPlayerId === viewerId
    ),
    lastSettle: publicLastSettle(game.lastSettle, viewerId),
    lastProduceFx: game.lastProduceFx ? { ...game.lastProduceFx } : null,
    lastPlayReveal: game.lastPlayReveal ? { ...game.lastPlayReveal } : null,
    settleAnimUntil:
      game.phase === 'settle' ? Number(game.settleAnimUntil) || 0 : 0,
    settleAnimPending: game.phase === 'settle',
    wishWellPending:
      game.phase === 'wish_well' || game.phase === 'settle_act'
        ? playersNeedingWishWell(game).map((p) => ({
            id: p.id,
            name: p.name,
          }))
        : [],
    settleDiscardPending:
      game.phase === 'settle_act'
        ? alivePlayers(game)
            .filter(
              (p) =>
                p.pendingDiscardFunc ||
                p.pendingDiscardBuild ||
                p.pendingDiscardRes
            )
            .map((p) => ({
              id: p.id,
              name: p.name,
              func: Boolean(p.pendingDiscardFunc),
              build: Boolean(p.pendingDiscardBuild),
              res: Boolean(p.pendingDiscardRes),
            }))
        : [],
    prisonerDiscardPending:
      game.phase === 'event_discard'
        ? Object.entries(game.pendingPrisonerDiscards || {})
            .filter(([, n]) => (Number(n) || 0) > 0)
            .map(([id, n]) => {
              const p = playerById(game, id);
              return {
                id,
                name: (p && p.name) || '?',
                count: Number(n) || 0,
              };
            })
        : [],
    barrenMarkerNumber:
      game.barrenMarkerNumber != null ? Number(game.barrenMarkerNumber) : null,
    barrenMarkerArea:
      game.barrenMarkerNumber != null
        ? game.barrenMarkerArea || 'resource'
        : null,
    barrenMarkerOwnerId:
      game.barrenMarkerNumber != null && game.barrenMarkerOwnerId
        ? game.barrenMarkerOwnerId
        : null,
    pendingRedrawChoice: game.pendingRedrawChoice
      ? {
          playerId: game.pendingRedrawChoice.playerId,
          source: game.pendingRedrawChoice.source || 'redraw',
          redrawCardId: game.pendingRedrawChoice.redrawCardId,
          forMe:
            Boolean(viewerId) &&
            game.pendingRedrawChoice.playerId === viewerId,
          options:
            viewerId === game.pendingRedrawChoice.playerId
              ? (game.pendingRedrawChoice.options || []).map(publicRedrawOption)
              : null,
        }
      : null,
    pendingIllegalBuild: game.pendingIllegalBuild
      ? {
          actorId: game.pendingIllegalBuild.actorId,
          actorName: game.pendingIllegalBuild.actorName,
          targetId: game.pendingIllegalBuild.targetId,
          targetName: game.pendingIllegalBuild.targetName,
          forMe:
            Boolean(viewerId) &&
            game.pendingIllegalBuild.targetId === viewerId,
          isActor:
            Boolean(viewerId) &&
            game.pendingIllegalBuild.actorId === viewerId,
        }
      : null,
    roundProduceBegun: Boolean(game.roundProduceBegun),
    pendingEventChoice: (() => {
      const welfare =
        game.pendingWelfareMinimumChoices &&
        viewerId &&
        game.pendingWelfareMinimumChoices[viewerId];
      if (welfare) {
        return {
          ...welfare,
          playerId: viewerId,
          forMe: true,
        };
      }
      if (game.pendingEventChoice) {
        return {
          ...game.pendingEventChoice,
          forMe:
            Boolean(viewerId) &&
            game.pendingEventChoice.playerId === viewerId,
        };
      }
      return null;
    })(),
    welfareMinimumPending: Object.entries(
      game.pendingWelfareMinimumChoices || {}
    ).map(([id, ch]) => ({
      id,
      name: (playerById(game, id) || {}).name || '?',
      count: ch.count || 2,
      label: ch.label,
      forMe: Boolean(viewerId) && viewerId === id,
    })),
    pendingTrade: game.pendingTrade
      ? (() => {
          const from = playerById(game, game.pendingTrade.fromId);
          const to = playerById(game, game.pendingTrade.toId);
          return {
            fromId: game.pendingTrade.fromId,
            toId: game.pendingTrade.toId,
            fromName: (from && from.name) || '?',
            toName: (to && to.name) || '?',
            give: cloneRes(game.pendingTrade.give),
            take: cloneRes(game.pendingTrade.take),
            forMe:
              Boolean(viewerId) && game.pendingTrade.toId === viewerId,
            isFrom:
              Boolean(viewerId) && game.pendingTrade.fromId === viewerId,
          };
        })()
      : null,
    pendingPrisonerDiscard: viewerId
      ? Number((game.pendingPrisonerDiscards || {})[viewerId]) || 0
      : 0,
    mercenary: game.phase === 'event_mercenary'
      ? {
          forMe:
            Boolean(viewerId) &&
            (game.pendingMercenaryQueue || [])[0] &&
            (game.pendingMercenaryQueue || [])[0].playerId === viewerId,
          queue: (game.pendingMercenaryQueue || []).map((q) => ({
            playerId: q.playerId,
            diceCount: q.diceCount,
            label: q.label,
            envNumber: q.envNumber,
          })),
          roll: (game.mercenaryRoll || []).slice(),
          placed: (game.mercenaryPlaced || []).slice(),
        }
      : null,
    log: game.log.slice(-60),
    players: game.players.map((p) => {
      const isMe = p.id === viewerId;
      return {
        id: p.id,
        name: p.name,
        tag: p.tag || null,
        left: Boolean(p.left),
        seat: p.seat,
        villagers: p.villagers,
        houses: Number(p.houses) || 0,
        freeHouses: freeHousesFor(p),
        dispatched: p.dispatched,
        idle: idleVillagers(p),
        enhancedDice: Number(p.enhancedDice) || 0,
        enhancedPlaced: Number(p.enhancedPlaced) || 0,
        tempVillagers: Number(p.tempVillagers) || 0,
        recruitPending: Number(p.recruitPending) || 0,
        welfareHouses: Number(p.welfareHouses) || 0,
        caravanPending: Boolean(p.caravanPending),
        bonusScore: Number(p.bonusScore) || 0,
        titles: playerTitles(p),
        commerceTycoon: hasCommerceTycoon(p),
        resources: cloneRes(p.resources),
        score: playerScore(p),
        roundGained: p.roundGained,
        roundBuiltHouse: Boolean(p.roundBuiltHouse),
        roundBred: Boolean(p.roundBred),
        roundExpanded: Boolean(p.roundExpanded),
        funcCount: p.funcCards.length,
        stealableCount: stealableHandCount(p),
        builtBuildingCount: countBuiltBuildings(p),
        // 功能手牌仅本人可见；他人只看数量（始终暗置）
        funcCards: isMe
          ? p.funcCards.map((c) => ({
              id: c.id,
              funcType: c.funcType,
              label: c.label,
              faceDown: false,
            }))
          : [],
        buildings: p.buildings.map((b) => publicBuilding(b, isMe)),
        expandSlots: Number(p.expandSlots) || 0,
        expandFuncSlots: Number(p.expandFuncSlots) || 0,
        expandResSlots: Number(p.expandResSlots) || 0,
        expandCount: expandCountFor(p),
        expandPermanentCost: expandPermanentCost(p),
        maxBuildings: maxBuildingsFor(p),
        maxFuncHand: maxFuncHandFor(p),
        maxResourceHand: maxResourceHandFor(p),
        buildPassed: Boolean(game.buildPassed && game.buildPassed[p.id]),
        // 他人只知是否待弃牌，不暴露待收建筑内容
        needsDiscardFunc: Boolean(p.pendingDiscardFunc),
        needsDiscardBuild: Boolean(p.pendingDiscardBuild),
        needsDiscardRes: Boolean(p.pendingDiscardRes),
        pendingDiscardFunc: isMe ? p.pendingDiscardFunc : false,
        pendingDiscardBuild: isMe ? p.pendingDiscardBuild : null,
        pendingDiscardRes: isMe ? p.pendingDiscardRes : false,
        pendingWishWellBonus: isMe
          ? Number(p.pendingWishWellBonus) || 0
          : 0,
        initRoll:
          game.phase === 'init_roll'
            ? isMe
              ? game.initRolls[p.id]
              : game.initRolls[p.id] != null
                ? 'done'
                : null
            : undefined,
      };
    }),
    me: me
      ? {
          id: me.id,
          canAct: canPlayerAct(game, me),
          phase: game.phase,
          dice: (game.dice[me.id] || []).slice(),
          awaitingProduceRoll: Boolean(game.awaitingProduceRoll),
          remoteDiceMode: Boolean(game.remoteDiceMode),
          hasRemoteDice: (me.funcCards || []).some(
            (c) => c.funcType === 'remoteDice'
          ),
          exchangeCount: effectiveExchangeCount(me),
          exchangeBuilt: countBuiltExchanges(me),
          exchangeCost: effectiveExchangeCost(me, game),
          caravanPending: Boolean(me.caravanPending),
          exchangeEffectCap: MAX_EXCHANGE_EFFECT,
          pendingDiscardFunc: me.pendingDiscardFunc,
          pendingDiscardBuild: me.pendingDiscardBuild,
          pendingDiscardRes: me.pendingDiscardRes,
          maxResourceHand: maxResourceHandFor(me),
          expandCount: expandCountFor(me),
          expandPermanentCost: expandPermanentCost(me),
          caravanPending: Boolean(me.caravanPending),
          pendingWishWellBonus: Number(me.pendingWishWellBonus) || 0,
          buildPassed: Boolean(game.buildPassed && game.buildPassed[me.id]),
          houses: Number(me.houses) || 0,
          freeHouses: freeHousesFor(me),
        }
      : null,
  };
}

function canPlayerAct(game, player) {
  if (!player || player.left || game.over) return false;
  if (game.pendingTrade) {
    return game.pendingTrade.toId === player.id;
  }
  if (
    game.pendingIllegalBuild &&
    game.pendingIllegalBuild.targetId === player.id
  ) {
    return true;
  }
  if (game.phase === 'settle_act') {
    return playerNeedsSettleAct(player, game.settleActScope || 'all');
  }
  if (game.phase === 'wish_well') {
    return (player.pendingWishWellBonus || 0) > 0;
  }
  if (game.phase === 'event_discard') {
    return (Number((game.pendingPrisonerDiscards || {})[player.id]) || 0) > 0;
  }
  if (
    game.pendingWelfareMinimumChoices &&
    game.pendingWelfareMinimumChoices[player.id]
  ) {
    return true;
  }
  if (hasPendingPlacement(player)) return true;
  if (game.phase === 'init_roll') {
    return game.initRolls[player.id] == null;
  }
  if (game.phase === 'init_announce') {
    return false;
  }
  if (game.currentPlayerId !== player.id) {
    // 随时：集市 / anytime 功能
    return false;
  }
  return true;
}

function getActingPlayerIds(game) {
  if (!game || game.over) return [];
  if (game.pendingTrade && game.pendingTrade.toId) {
    return [game.pendingTrade.toId];
  }
  if (game.pendingIllegalBuild && game.pendingIllegalBuild.targetId) {
    return [game.pendingIllegalBuild.targetId];
  }
  if (game.phase === 'init_roll') {
    return alivePlayers(game)
      .filter((p) => game.initRolls[p.id] == null)
      .map((p) => p.id);
  }
  if (game.phase === 'init_announce') {
    return [];
  }
  if (game.phase === 'settle') {
    return [];
  }
  if (game.phase === 'settle_act') {
    return alivePlayers(game)
      .filter(
        (p) =>
          p.pendingDiscardFunc ||
          p.pendingDiscardBuild ||
          p.pendingDiscardRes
      )
      .map((p) => p.id);
  }
  if (game.phase === 'wish_well') {
    return playersNeedingWishWell(game).map((p) => p.id);
  }
  if (game.phase === 'build') {
    const placementPending = alivePlayers(game)
      .filter(hasPendingPlacement)
      .map((p) => p.id);
    if (placementPending.length) {
      if (game.currentPlayerId && placementPending.includes(game.currentPlayerId)) {
        return [game.currentPlayerId];
      }
      return [placementPending[0]];
    }
  }
  if (Object.keys(game.pendingWelfareMinimumChoices || {}).length > 0) {
    return Object.keys(game.pendingWelfareMinimumChoices);
  }
  if (game.pendingRedrawChoice && game.pendingRedrawChoice.playerId) {
    return [game.pendingRedrawChoice.playerId];
  }
  if (game.pendingEventChoice && game.pendingEventChoice.playerId) {
    return [game.pendingEventChoice.playerId];
  }
  if (game.phase === 'event_mercenary') {
    const cur = (game.pendingMercenaryQueue || [])[0];
    return cur && cur.playerId ? [cur.playerId] : [];
  }
  if (game.phase === 'event_discard') {
    return Object.keys(game.pendingPrisonerDiscards || {}).filter(
      (id) => (Number(game.pendingPrisonerDiscards[id]) || 0) > 0
    );
  }
  if (
    ['produce', 'settle_act', 'build', 'event_mercenary', 'event_discard'].includes(
      game.phase
    ) &&
    game.currentPlayerId
  ) {
    return [game.currentPlayerId];
  }
  return [];
}

function forceTimeout(game, playerId) {
  const p = playerById(game, playerId);
  if (!p || game.over) return { ok: false, error: '无法超时处理' };

  if (game.pendingWelfareMinimumChoices && game.pendingWelfareMinimumChoices[playerId]) {
    const count =
      (game.pendingWelfareMinimumChoices[playerId] &&
        game.pendingWelfareMinimumChoices[playerId].count) ||
      2;
    return applyAction(game, playerId, {
      type: 'eventPickTwoResources',
      payload: { amounts: { wood: count } },
    });
  }

  if (
    game.phase === 'settle_act' &&
    p.pendingDiscardRes &&
    sumRes(p.resources) > maxResourceHandFor(p)
  ) {
    const pick = RESOURCES.find((r) => (p.resources[r] || 0) > 0);
    return applyAction(game, playerId, {
      type: 'discardResource',
      payload: { resource: pick },
    });
  }
  if (
    game.phase === 'settle_act' &&
    p.pendingDiscardFunc &&
    p.funcCards.length > maxFuncHandFor(p)
  ) {
    return applyAction(game, playerId, {
      type: 'discardFunc',
      payload: { cardId: p.funcCards[p.funcCards.length - 1].id },
    });
  }
  if (
    game.phase === 'build' &&
    game.currentPlayerId === playerId &&
    p.pendingDiscardFunc &&
    p.funcCards.length > maxFuncHandFor(p)
  ) {
    return applyAction(game, playerId, {
      type: 'discardFunc',
      payload: { cardId: p.funcCards[p.funcCards.length - 1].id },
    });
  }
  if (
    game.phase === 'build' &&
    game.currentPlayerId === playerId &&
    p.pendingDiscardBuild
  ) {
    const unbuilt = p.buildings.find((b) => !b.built);
    if (unbuilt) {
      return applyAction(game, playerId, {
        type: 'discardUnbuilt',
        payload: { buildingId: unbuilt.id },
      });
    }
    return applyAction(game, playerId, { type: 'discardPendingBuild' });
  }
  if (
    game.phase === 'settle_act' &&
    p.pendingDiscardBuild
  ) {
    const unbuilt = p.buildings.find((b) => !b.built);
    if (unbuilt) {
      return applyAction(game, playerId, {
        type: 'discardUnbuilt',
        payload: { buildingId: unbuilt.id },
      });
    }
    return applyAction(game, playerId, { type: 'discardPendingBuild' });
  }
  if (game.phase === 'wish_well' && (p.pendingWishWellBonus || 0) > 0) {
    const alloc = emptyRes();
    alloc.wood = Number(p.pendingWishWellBonus) || 0;
    return applyAction(game, playerId, {
      type: 'allocateWishWell',
      payload: { alloc },
    });
  }

  if (
    game.pendingRedrawChoice &&
    game.pendingRedrawChoice.playerId === playerId
  ) {
    const opt = (game.pendingRedrawChoice.options || [])[0];
    if (opt) {
      return applyAction(game, playerId, {
        type: 'redrawPick',
        payload: { keepId: opt.id },
      });
    }
  }

  if (
    game.pendingIllegalBuild &&
    game.pendingIllegalBuild.targetId === playerId
  ) {
    const built = (p.buildings || []).find((b) => b.built);
    if (built) {
      return applyAction(game, playerId, {
        type: 'illegalBuildPick',
        payload: { buildingId: built.id },
      });
    }
  }

  if (game.pendingTrade && game.pendingTrade.toId === playerId) {
    return applyAction(game, playerId, { type: 'rejectTrade', payload: {} });
  }

  if (
    game.pendingEventChoice &&
    game.pendingEventChoice.playerId === playerId
  ) {
    const need = game.pendingEventChoice.needChoice;
    if (need === 'pickResource') {
      return applyAction(game, playerId, {
        type: 'eventPickResource',
        payload: { resource: 'wood' },
      });
    }
    if (need === 'pickTwoResources') {
      const count = game.pendingEventChoice.count || 2;
      return applyAction(game, playerId, {
        type: 'eventPickTwoResources',
        payload: { amounts: { wood: count } },
      });
    }
    if (need === 'moveBarrenMarker') {
      return applyAction(game, playerId, {
        type: 'eventMoveBarrenMarker',
        payload: { number: Number(game.pendingEventChoice.envNumber) || 4 },
      });
    }
    if (need === 'moveNeutral') {
      return applyAction(game, playerId, {
        type: 'eventMoveNeutral',
        payload: {
          area: 'resource',
          number: Number(game.pendingEventChoice.envNumber) || 4,
        },
      });
    }
    if (need === 'recallDie') {
      const ch = game.pendingEventChoice;
      const exArea = ch.excludeArea || 'resource';
      const exNum = Number(
        ch.excludeNumber != null ? ch.excludeNumber : ch.number
      );
      for (const area of ['resource', 'special']) {
        const workers = (game.board[area] && game.board[area].workers) || {};
        for (let num = 1; num <= 6; num++) {
          const w = workers[num] || {};
          const own = Number(w[playerId]) || 0;
          if (own <= 0) continue;
          if (area === exArea && num === exNum) {
            const justPlaced = Math.max(0, Number(ch.justPlacedCount) || 0);
            if (own <= justPlaced) continue;
          }
          const ab = game.board[area];
          const physical = own;
          const boosted = Math.min(
            Number(
              (ab.boosts && ab.boosts[num] && ab.boosts[num][playerId]) || 0
            ),
            physical
          );
          const enhanced = boosted > 0 && physical - boosted <= 0;
          return applyAction(game, playerId, {
            type: 'eventRecallDie',
            payload: { area, number: num, enhanced },
          });
        }
      }
    }
    if (need === 'teleportDie') {
      const ch = game.pendingEventChoice;
      if (ch.teleportStep === 'to') {
        const fa = ch.fromArea;
        const fn = Number(ch.fromNumber);
        for (const area of BOARD_AREAS) {
          for (let num = 1; num <= 6; num++) {
            if (area === fa && num === fn) continue;
            if (
              area === 'special' &&
              num > areaOpenSlotCount('special', game.round)
            ) {
              continue;
            }
            const tiles = tilesOnNumber(game.board[area], num);
            if (!tiles.length) continue;
            return applyAction(game, playerId, {
              type: 'eventTeleportTo',
              payload: { area, number: num },
            });
          }
        }
      }
      for (const area of BOARD_AREAS) {
        const workers = (game.board[area] && game.board[area].workers) || {};
        for (let num = 1; num <= 6; num++) {
          const w = workers[num] || {};
          for (const [targetId, count] of Object.entries(w)) {
            if ((Number(count) || 0) > 0) {
              return applyAction(game, playerId, {
                type: 'eventTeleportFrom',
                payload: { area, number: num, targetId },
              });
            }
          }
        }
      }
    }
    if (need === 'gatherNeutrals') {
      const ch = game.pendingEventChoice;
      const toArea = ch.toArea || 'resource';
      const toNumber = Number(ch.toNumber != null ? ch.toNumber : ch.number);
      for (const area of ['resource', 'special']) {
        const workers = (game.board[area] && game.board[area].workers) || {};
        for (let num = 1; num <= 6; num++) {
          if (area === toArea && num === toNumber) continue;
          const w = workers[num] || {};
          if ((Number(w[NEUTRAL_WORKER_ID]) || 0) > 0) {
            return applyAction(game, playerId, {
              type: 'eventGatherNeutrals',
              payload: { area, number: num },
            });
          }
        }
      }
    }
  }

  if (game.phase === 'event_mercenary') {
    const cur = (game.pendingMercenaryQueue || [])[0];
    if (cur && cur.playerId === playerId) {
      return applyAction(game, playerId, {
        type: 'mercenarySkipAll',
        payload: {},
      });
    }
  }

  if (
    game.phase === 'event_discard' &&
    (Number((game.pendingPrisonerDiscards || {})[playerId]) || 0) > 0
  ) {
    const pick = RESOURCES.find((r) => (p.resources[r] || 0) > 0);
    if (pick) {
      return applyAction(game, playerId, {
        type: 'eventDiscard',
        payload: { kind: 'resource', resource: pick },
      });
    }
    // 无资源可弃：清零并推进
    delete game.pendingPrisonerDiscards[playerId];
    ensurePrisonerDiscardPlayer(game);
    return { ok: true };
  }

  const unplaced = (p.buildings || []).find((b) => !b.built && b.slot == null);
  if (unplaced) {
    const stack = findStackSlotFor(p, unplaced);
    const slot = stack != null ? stack : nextFreeBuildSlot(p);
    if (slot != null) {
      return applyAction(game, playerId, {
        type: 'placeBuildingSlot',
        payload: { buildingId: unplaced.id, slot },
      });
    }
  }

  if (game.phase === 'init_roll') {
    return applyAction(game, playerId, { type: 'initRoll', payload: {} });
  }
  if (game.phase === 'settle') {
    return finishSettleAnim(game, playerId);
  }
  if (game.phase === 'produce' && game.currentPlayerId === playerId) {
    if (game.awaitingProduceRoll) {
      return applyAction(game, playerId, { type: 'produceRoll', payload: {} });
    }
    return applyAction(game, playerId, {
      type: 'voidSkip',
      payload: { resource: 'wood' },
    });
  }
  if (
    (game.phase === 'settle_act' ||
      game.phase === 'build') &&
    game.currentPlayerId === playerId
  ) {
    return applyAction(game, playerId, { type: 'pass', payload: {} });
  }
  return { ok: true };
}

function onPlayerQuit(game, playerId) {
  if (!game || game.over) return;
  const p = playerById(game, playerId);
  if (!p) return;
  p.left = true;
  pushLog(game, `${p.name} 离开了游戏`);

  if (
    game.pendingTrade &&
    (game.pendingTrade.fromId === playerId ||
      game.pendingTrade.toId === playerId)
  ) {
    game.pendingTrade = null;
    pushLog(game, '交易因玩家离开而取消');
  }

  const alive = alivePlayers(game);
  if (alive.length < 2) {
    game.over = true;
    game.phase = 'over';
    game.winners = alive.map((x) => x.id);
    pushLog(game, '存活玩家不足，游戏结束');
    return;
  }

  if (game.phase === 'init_roll') {
    delete game.initRolls[playerId];
    if (alive.every((x) => game.initRolls[x.id] != null)) {
      resolveInitRoll(game);
    }
    return;
  }
  if (game.phase === 'init_announce') {
    // 宣布阶段仅更新存活名单；先手已定，发牌由计时器推进
    if (
      game.pendingInitReveal &&
      game.pendingInitReveal.firstPlayerId === playerId
    ) {
      // 先手离开：改由当前最高骰者担任（若并列取座位靠前）
      let best = -1;
      let pick = alive[0];
      for (const x of alive) {
        const v = (game.initRolls && game.initRolls[x.id]) || 0;
        if (v > best || (v === best && x.seat < pick.seat)) {
          best = v;
          pick = x;
        }
      }
      game.produceOrderStartId = pick.id;
      game.pendingInitReveal.firstPlayerId = pick.id;
      game.pendingInitReveal.best = best;
      pushLog(game, `先手离开，改由 ${pick.name} 先手`);
    }
    return;
  }

  if (game.phase === 'settle_act') {
    p.pendingDiscardRes = false;
    p.pendingDiscardFunc = false;
    p.pendingDiscardBuild = null;
    p.pendingWishWellBonus = 0;
    tryFinishConcurrentDiscardPhase(game);
  } else if (game.phase === 'wish_well') {
    p.pendingWishWellBonus = 0;
    tryFinishWishWellPhase(game);
  }

  if (game.pendingWelfareMinimumChoices && game.pendingWelfareMinimumChoices[playerId]) {
    delete game.pendingWelfareMinimumChoices[playerId];
    tryFinishWelfareMinimumConcurrent(game);
  }

  if (game.currentPlayerId === playerId) {
    if (game.phase === 'produce') {
      advanceToNextProducer(game, false);
      if (game.phase === 'produce' && game.currentPlayerId) {
        prepareProduceTurn(game);
      }
    } else if (game.phase === 'build') {
      game.buildPassed[playerId] = true;
      afterBuildAction(game, playerId, false);
    }
  }
}

module.exports = {
  createGameState,
  applyAction,
  publicGameState,
  getActingPlayerIds,
  forceTimeout,
  onPlayerQuit,
  finishInitAnnounce,
  finishSettleAnimForce,
  startSettle,
  INIT_ANNOUNCE_MS,
  SETTLE_ANIM_MAX_MS,
  // 测试导出
  cancelEqualCounts,
  slotStrengthMap,
  physicalDiceOnSlot,
  slotPlayerDieCounts,
  playerScore,
  exchangeCostN,
  effectiveExchangeCost,
  caravanExchangeActive,
  countBuiltExchanges,
  effectiveExchangeCount,
  MAX_EXCHANGE_EFFECT,
  STACK_ACHIEVEMENT_NEED,
  STACK_ACHIEVEMENT_SCORE,
  countBuiltByStackKey,
  stackAchievementKeys,
  stackAchievementScore,
  EXCHANGE_TITLE_NEED,
  EXCHANGE_TITLE_SCORE,
  EXCHANGE_TITLE_ID,
  EXCHANGE_TITLE_LABEL,
  hasCommerceTycoon,
  commerceTycoonScore,
  playerTitles,
  WIN_SCORE,
  VILLAGERS_PER_HOUSE,
  villagerCapacityFor,
  MAX_RESOURCE_BOARD_TILES,
  ENVIRONMENT_DECK_SIZE,
  ENVIRONMENT_DRAW_PER_ROUND,
  ENVIRONMENT_SLOT_NUMBERS,
  MAX_RESOURCE_HAND,
  MAX_ENHANCED_DICE,
  START_ENHANCED_DICE,
  ENHANCED_DIE_STRENGTH,
  RECRUIT_TEMP_VILLAGERS,
  EXPAND_RESOURCE_BONUS,
  maxResourceHandFor,
  expandCountFor,
  expandPermanentCost,
  maxBuildingsFor,
  occupiedBuildSlotCount,
  assignBuildingSlot,
  takeBuildingCard,
  buildingStackKey,
  findStackSlotFor,
  findExchangeStackSlot,
  nextFreeBuildSlot,
  freeHousesFor,
  stealableHandCount,
  countBuiltBuildings,
  hasIllegalBuildTarget,
  idleVillagers,
  areaOpenSlotCount,
  specialSlotUnlockRound,
  beginProduce,
  startSettle,
  tryEnterPreSettleMercenaryOrSettle,
  START_HOUSES,
  START_VILLAGERS,
};
