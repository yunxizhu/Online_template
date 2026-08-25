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
  BUILD_HOUSE_COST,
  BREED_FOOD_PER_VILLAGER,
  breedFoodCost,
} = require('./decks');

const WIN_SCORE = 15;
const START_VILLAGERS = 3;
const START_HOUSES = 3;
const MAX_VILLAGERS = 15;
const MAX_FUNC_HAND = 3;
const MAX_BUILDINGS = 3;
const MAX_RESOURCE_HAND = 10;
/** 每位玩家最多拥有的强化骰数量 */
const MAX_ENHANCED_DICE = 3;
/** 征召：下一轮生产临时村民数量 */
const RECRUIT_TEMP_VILLAGERS = 3;
const EXPAND_RESOURCE_BONUS = 4;
/** 资源板块摆放上限（6 数字格 × 每格 3 张） */
const MAX_RESOURCE_BOARD_TILES = 18;

function isNoneSlot(slot) {
  return slot === 'none' || (typeof slot === 'string' && /^none(:\d+)?$/.test(slot));
}

function noneSlotList(player) {
  const n = Number(player && player.expandSlots) || 0;
  const out = ['none'];
  for (let i = 1; i <= n; i++) {
    out.push(`none:${i}`);
  }
  return out;
}

function personalSlotsFor(player) {
  return noneSlotList(player);
}

function maxBuildingsFor(player) {
  return MAX_BUILDINGS + (Number(player && player.expandSlots) || 0);
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

/** 空闲房子数：房子 − 村民（繁殖需要至少 1 间空房） */
function freeHousesFor(player) {
  const houses = Number(player && player.houses) || 0;
  const villagers = Number(player && player.villagers) || 0;
  return Math.max(0, houses - villagers);
}

/** 累计扩容次数（功能卡与常驻均计入，用于常驻扩容造价） */
function expandCountFor(player) {
  return (
    (Number(player && player.expandSlots) || 0) +
    (Number(player && player.expandFuncSlots) || 0) +
    (Number(player && player.expandResSlots) || 0)
  );
}

function expandPermanentCost(player) {
  const n = expandCountFor(player);
  const amt = 2 + n;
  return { wood: amt, stone: amt };
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

function syncResourceHandPending(player) {
  if (!player) return;
  player.pendingDiscardRes =
    sumRes(player.resources) > maxResourceHandFor(player);
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

function playersNeedingWishWell(game) {
  return alivePlayers(game).filter(
    (p) => (Number(p.pendingWishWellBonus) || 0) > 0
  );
}

function anyoneNeedsDiscard(game) {
  for (const p of alivePlayers(game)) {
    syncResourceHandPending(p);
  }
  return alivePlayers(game).some(
    (p) =>
      p.pendingDiscardFunc || p.pendingDiscardBuild || p.pendingDiscardRes
  );
}

function tryBeginDiscardOrNextRound(game) {
  if (anyoneNeedsDiscard(game)) {
    beginSettleActPhase(game);
  } else {
    endRound(game);
  }
}

function tryBeginWishWellOrBuild(game) {
  if (playersNeedingWishWell(game).length > 0) {
    beginWishWell(game);
  } else {
    beginBuild(game);
  }
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
    beginBuild(game);
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

function pushLog(game, text) {
  game.log.push({ at: Date.now(), text });
  if (game.log.length > 60) game.log.shift();
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
  let s = p.score || 0;
  for (const b of p.buildings || []) {
    if (b.built && b.score) s += b.score;
  }
  return s;
}

function checkWin(game) {
  if (game.over) return true;
  // 建造等阶段按回合顺序结算：先达到 15 分的唯一玩家立刻获胜
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
};

/** 功能/建筑统一进合堆弃牌 */
function normalizeDeckKind(kind) {
  if (kind === 'function' || kind === 'building') return 'special';
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

/** 依次放到 1~6，超出回绕（第 7 张→1，第 8 张→2…） */
function drawToArea(game, kind, count) {
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const card = drawOne(game, kind);
    if (!card) break;
    const number = (i % 6) + 1;
    const faceDown =
      kind === 'special' && isBoardFaceDownNumber(number);
    tiles.push({
      ...card,
      number,
      faceDown,
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

function setupBoard(game) {
  const n = Math.max(0, game.round - 1);
  const resCount = Math.min(MAX_RESOURCE_BOARD_TILES, 6 + n);
  const specialCount = Math.min(6, 2 + n);

  game.board = emptyBoard();
  game.board.resource.tiles = drawToArea(game, 'resource', resCount);
  game.board.special.tiles = drawToArea(game, 'special', specialCount);

  pushLog(
    game,
    `第 ${game.round} 轮摆放：资源 ${game.board.resource.tiles.length}、功能/建筑 ${game.board.special.tiles.length}`
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
  for (const t of game.board.special.tiles) {
    pushToDiscard(game, 'special', t);
  }
  game.board = emptyBoard();
}

// ─── 拉斯维加斯式抵消 ───────────────────────────────────

/**
 * 结算强度：普通骰 +1，强化骰 +2（= 骰数 + 强化数）
 * 输入 area 某数字格的 workers / boosts
 */
function slotStrengthMap(workers, boosts) {
  const out = {};
  for (const [pid, c] of Object.entries(workers || {})) {
    const n = Number(c) || 0;
    if (n <= 0) continue;
    const b = Math.min(Math.max(0, Number(boosts && boosts[pid]) || 0), n);
    out[pid] = n + b;
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

function mapRanked(game, remain) {
  return rankedRemain(remain).map((r) => ({
    pid: r.pid,
    name: workerDisplayName(game, r.pid),
    count: r.count,
    neutral: r.pid === NEUTRAL_WORKER_ID,
  }));
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
    dispatched: 0,
    voided: 0,
    enhancedDice: 0, // 已强化的村民/骰子数（永久，上限 MAX_ENHANCED_DICE，且不超过村民数）
    enhancedPlaced: 0, // 本轮已派出的强化骰数
    recruitPending: 0, // 下一轮生产开始时生效的临时村民数
    tempVillagers: 0, // 本轮生产可用的临时村民（生产结束后清零）
    resources: startRes(),
    score: 0,
    funcCards: [],
    buildings: [], // { ...card, slot, built }
    roundGained: 0,
    roundBuiltHouse: false,
    roundBred: false,
    pendingDiscardFunc: false,
    pendingDiscardBuild: null, // 总建筑达上限时需弃一张（已建或未建）腾位
    pendingDiscardRes: false, // 手牌资源超上限
    pendingWishWellBonus: 0, // 本轮许愿井待选取资源次数
    expandSlots: 0, // 扩容建筑格后增加的无数字格数量
    expandFuncSlots: 0, // 扩容功能卡格后增加的上限
    expandResSlots: 0, // 扩容资源卡位次数（每次 +4 手牌资源上限）
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
    resourceDiscard: [],
    specialDiscard: [],
    board: emptyBoard(),
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
const SETTLE_ANIM_MAX_MS = 120000;

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
  setupBoard(game);
  beginProduce(game);
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
  }
  // 清空各大区数字格工人
  clearAllSlotWorkers(game);
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
    startSettle(game);
    return;
  }
  const startId = game.currentPlayerId || game.produceOrderStartId;
  if (!startId) {
    startSettle(game);
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
  // 一圈都没人有空闲 → 结算
  startSettle(game);
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
    startSettle(game);
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
    pushLog(
      game,
      `${p.name} 的${entry.label}产出 ${amt} ${RESOURCE_LABELS[entry.resource]}`
    );
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

function beginSettleActPhase(game) {
  if (!anyoneNeedsDiscard(game)) {
    endRound(game);
    return;
  }
  game.phase = 'settle_act';
  game.settleActPassed = {};
  const order = game.produceFinishOrder || [];
  game.currentPlayerId =
    order[0] ||
    game.lastBuilderId ||
    game.lastPlacerId ||
    game.produceOrderStartId;
  if (!game.currentPlayerId) {
    endRound(game);
    return;
  }
  pushLog(game, '—— 弃牌阶段：处理功能/建筑超上限弃牌 ——');
  ensureSettleActPlayer(game);
}

function completeSettleAfterAnim(game) {
  if (!game || game.phase !== 'settle') return { ok: false };
  const report = game.lastSettle;
  if (report) {
    applySettleBuildingProduce(game, report);
    logSettleRoundMvp(game);
  }
  game.settleAnimAcks = {};
  game.settleAnimUntil = 0;
  tryBeginWishWellOrBuild(game);
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
  for (const p of alivePlayers(game)) {
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

  // 资源区：按数字格汇总派遣强度（强化骰计 2），最多者拿大份，第二拿小份
  for (let num = 1; num <= 6; num++) {
    const workers = game.board.resource.workers[num] || {};
    const boosts =
      (game.board.resource.boosts && game.board.resource.boosts[num]) || {};
    const tiles = tilesOnNumber(game.board.resource, num);
    if (!tiles.length && !Object.keys(workers).length) continue;

    const before = slotStrengthMap(workers, boosts);
    const remain = cancelEqualCounts(before);
    const ranked = mapRanked(game, remain);
    const gains = [];

    if (ranked[0] && tiles.length) {
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
    if (ranked[1] && tiles.length) {
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
    }

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
    });

    if (gains.length) {
      pushLog(
        game,
        `资源格 ${num}（${tiles.map((t) => t.label).join('、')}）：` +
          gains.map((g) => `${g.name}+${g.amount}`).join('，')
      );
    } else if (Object.keys(before).length) {
      pushLog(game, `资源格 ${num}：全部抵消，无人采集`);
    }
  }

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
    const ranked = mapRanked(game, remain);
    let claimedBy = null;

    if (ranked[0] && tiles.length) {
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
        claimedBy = { pid: p.id, name: p.name, count: ranked[0].count };
        const hasBuilding = tiles.some((t) => deckKindOfTile(t) === 'building');
        pushLog(
          game,
          `${p.name} 以强度 ${ranked[0].count} 取得功能/建筑格 ${num} 全部卡：` +
            tiles.map(tileLogLabel).join('、') +
            (hasBuilding ? '（建筑需选择格子放置）' : '')
        );
      }
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
    });
  }

  collectSettleBuildingReport(game, report);

  game.lastSettle = report;

  recycleBoard(game);

  game.phase = 'settle';
  game.currentPlayerId = null;
  game.settleAnimAcks = {};
  game.settleAnimUntil = Date.now() + SETTLE_ANIM_MAX_MS;
  pushLog(game, '—— 结算动画播放中 ——');
}

function takeFunctionCard(game, player, tile) {
  const { number, ...card } = tile;
  receiveFunctionCard(game, player, card);
}

/** 入手功能卡（对持有者明示） */
function receiveFunctionCard(game, player, card) {
  player.funcCards.push({
    ...card,
    faceDown: false,
  });
  if (player.funcCards.length > maxFuncHandFor(player)) {
    player.pendingDiscardFunc = true;
  }
}

function takeBuildingCard(game, player, tile) {
  const { number, ...card } = tile;
  // 入手后对持有者明示；他人在 publicBuilding 中仍看不到未建造内容
  const neu = {
    ...card,
    faceDown: false,
    slot: 'none',
    built: false,
    workers: 0,
  };
  if (player.buildings.length >= maxBuildingsFor(player)) {
    player.pendingDiscardBuild = { newCard: neu };
  } else {
    player.buildings.push(neu);
  }
}

function ensureSettleActPlayer(game) {
  const alive = alivePlayers(game);
  if (!alive.length) {
    endRound(game);
    return;
  }
  // 若所有人都跳过，进入下一轮
  if (alive.every((p) => game.settleActPassed[p.id])) {
    endRound(game);
    return;
  }
  let id = game.currentPlayerId;
  const n = game.players.length;
  for (let i = 0; i < n; i++) {
    const p = playerById(game, id);
    if (p && !p.left && !game.settleActPassed[p.id]) {
      // 还需处理弃牌
      if (
        p.pendingDiscardFunc ||
        p.pendingDiscardBuild ||
        p.pendingDiscardRes
      ) {
        game.currentPlayerId = p.id;
        return;
      }
      // 结算行动阶段不再有常驻功能卡可自动跳过；所有未处理 pending 的玩家都已返回
      game.settleActPassed[p.id] = true;
      const next = nextAlive(game, id);
      id = next ? next.id : id;
      continue;
    }
    const next = nextAlive(game, id);
    if (!next) break;
    id = next.id;
  }
  endRound(game);
}

function beginBuild(game) {
  if (game.over) return;
  game.phase = 'build';
  game.buildPassed = {};
  game.buildIdleLoops = 0;
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
    dispatched: player.dispatched,
    funcCards: player.funcCards,
    buildings: player.buildings,
    roundBuiltHouse: player.roundBuiltHouse,
    roundBred: player.roundBred,
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
  // 清理 pendingDiscardBuild 中的新卡
  if (player.pendingDiscardBuild && player.pendingDiscardBuild.newCard) {
    const neu = player.pendingDiscardBuild.newCard;
    if (!snap.pendingDiscardBuild || snap.pendingDiscardBuild.newCard?.id !== neu.id) {
      game.specialDiscard.push(cleanCardForPile(neu));
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
  player.dispatched = snap.dispatched;
  player.funcCards = JSON.parse(JSON.stringify(snap.funcCards));
  player.buildings = JSON.parse(JSON.stringify(snap.buildings));
  player.roundBuiltHouse = snap.roundBuiltHouse;
  player.roundBred = snap.roundBred;
  player.expandSlots = snap.expandSlots;
  player.expandFuncSlots = snap.expandFuncSlots;
  player.expandResSlots = snap.expandResSlots;
  player.pendingDiscardBuild = snap.pendingDiscardBuild ? JSON.parse(JSON.stringify(snap.pendingDiscardBuild)) : null;
  player.pendingDiscardFunc = snap.pendingDiscardFunc;
  player.pendingDiscardRes = snap.pendingDiscardRes;
  player.roundGained = snap.roundGained;
  player.enhancedDice = Number(snap.enhancedDice) || 0;
  player.recruitPending = Number(snap.recruitPending) || 0;
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
    endRound(game);
    return;
  }
  if (alive.every((p) => game.buildPassed[p.id])) {
    tryBeginDiscardOrNextRound(game);
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
  endRound(game);
}

function afterBuildAction(game, playerId, didRealAction) {
  game.lastBuilderId = playerId;
  if (checkWin(game)) return;
  if (didRealAction) {
    game.currentPlayerId = playerId;
    return;
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
  game.produceFinishOrder = []; // 新回合重新统计派遣顺序
  // 下一轮生产从「最后一个结束建造动作」的玩家开始
  game.produceOrderStartId =
    game.lastBuilderId || game.lastPlacerId || game.produceOrderStartId;
  setupBoard(game);
  beginProduce(game);
}

// ─── 动作处理 ───────────────────────────────────────────

function applyAction(game, playerId, action) {
  if (!game || game.over) return { ok: false, error: '游戏已结束' };
  const player = playerById(game, playerId);
  if (!player || player.left) return { ok: false, error: '玩家无效' };

  const type = action && action.type;
  const payload = (action && action.payload) || {};

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
  if (type === 'discardResource') {
    return actDiscardResource(game, player, payload);
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
    if (game.currentPlayerId !== playerId) {
      return { ok: false, error: '还没轮到你' };
    }
    if (type === 'pass') {
      if (
        player.pendingDiscardFunc ||
        player.pendingDiscardBuild ||
        player.pendingDiscardRes
      ) {
        return { ok: false, error: '请先处理弃牌后再跳过' };
      }
      game.settleActPassed[playerId] = true;
      const next = nextAlive(game, playerId);
      game.currentPlayerId = next ? next.id : playerId;
      ensureSettleActPlayer(game);
      return { ok: true };
    }
    return { ok: false, error: '弃牌阶段：请处理超上限弃牌或跳过' };
  }

  if (game.phase === 'wish_well') {
    if (type === 'allocateWishWell') {
      return actAllocateWishWell(game, player, payload);
    }
    return { ok: false, error: '请选择许愿井资源并确认' };
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
  pushLog(
    game,
    `${player.name} 派遣 ${count} 名村民到${AREA_LABELS[area]}区 ${face} 号格` +
      (boostAdd ? `（强化 ${boostAdd}）` : '') +
      (remote ? '（遥控）' : '')
  );
  game.remoteDiceMode = false;
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
    return { ok: false, error: '没有可爆掉的骰子' };
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
  syncResourceHandPending(player);
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
  const buildingId = payload.buildingId;
  const b = findPersonalBuilding(player, buildingId);
  if (!b) return { ok: false, error: '建筑不存在' };
  if (b.built) return { ok: false, error: '已经建造过了' };
  if (b.slot == null) b.slot = 'none';
  if (!canPay(player.resources, b.cost || {})) {
    return { ok: false, error: '资源不足' };
  }
  if (player.buildings.filter((b) => b.built).length >= maxBuildingsFor(player)) {
    return { ok: false, error: `已建建筑已达上限 ${maxBuildingsFor(player)}` };
  }
  pay(player.resources, b.cost || {});
  b.built = true;
  b.faceDown = false; // 建造后公开
  pushLog(
    game,
    `${player.name} 建造了「${b.label}」` +
      (b.score ? `（+${b.score} 分）` : '')
  );
  if (checkWin(game)) return { ok: true };
  afterBuildAction(game, player.id, true);
  return { ok: true };
}

function actPlaceBuildingSlot(game, player, payload) {
  const buildingId = payload.buildingId;
  let slot = payload.slot;
  if (slot == null || slot === '') slot = 'none';
  else if (slot === 'none' || slot === 0 || slot === '0') slot = 'none';
  else if (typeof slot === 'string' && /^none:\d+$/.test(slot)) {
    // keep none:N
  } else {
    // 数字格已不再使用，全部转为无数字格
    slot = 'none';
  }

  const b = findPersonalBuilding(player, buildingId);
  if (!b) return { ok: false, error: '建筑不存在' };
  if (b.slot != null) return { ok: false, error: '已放置过格子' };

  if (player.buildings.filter((x) => x.slot != null).length >= maxBuildingsFor(player)) {
    return { ok: false, error: `建筑已达上限 ${maxBuildingsFor(player)}` };
  }
  b.slot = slot;
  pushLog(
    game,
    `${player.name} 将「${b.label}」放置好`
  );
  return { ok: true };
}

function actDiscardUnbuilt(game, player, payload) {
  const buildingId = payload.buildingId;
  const b = findPersonalBuilding(player, buildingId);
  if (!b) return { ok: false, error: '建筑不存在' };

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
    const neu = player.pendingDiscardBuild.newCard;
    neu.slot = slotKeep;
    neu.built = false;
    neu.workers = 0;
    player.buildings.push(neu);
    player.pendingDiscardBuild = null;
    let msg = `${player.name} 弃置${wasBuilt ? '已建' : '未建'}「${b.label}」（入弃牌堆），新建筑「${neu.label}」放到原格子`;
    if (wasBuilt && b.buildType === 'score2' && b.score) {
      msg += `，宫殿被弃置，失去 +${b.score} 分`;
    }
    pushLog(game, msg);
  } else {
    let msg = `${player.name} 主动弃置${wasBuilt ? '已建' : '未建'}「${b.label}」` +
      (slotKeep != null
        ? `（格子 ${slotLabel(slotKeep)}）`
        : '') +
      '（入弃牌堆）';
    if (wasBuilt && b.buildType === 'score2' && b.score) {
      msg += `，宫殿被弃置，失去 +${b.score} 分`;
    }
    pushLog(game, msg);
  }
  if (
    game.phase === 'settle_act' &&
    !player.pendingDiscardFunc &&
    !player.pendingDiscardBuild &&
    !player.pendingDiscardRes &&
    game.currentPlayerId === player.id
  ) {
    game.settleActPassed[player.id] = true;
    const next = nextAlive(game, player.id);
    game.currentPlayerId = next ? next.id : player.id;
    ensureSettleActPlayer(game);
  }
  return { ok: true };
}

function actDiscardResource(game, player, payload) {
  if (game.phase !== 'settle_act') {
    return { ok: false, error: '仅弃牌阶段可弃置超限资源' };
  }
  const resource = payload && payload.resource;
  if (!resource || !RESOURCES.includes(resource)) {
    return { ok: false, error: '请选择要丢弃的资源' };
  }
  if ((player.resources[resource] || 0) < 1) {
    return { ok: false, error: `${RESOURCE_LABELS[resource]}不足` };
  }
  player.resources[resource] -= 1;
  syncResourceHandPending(player);
  pushLog(
    game,
    `${player.name} 弃置 1 ${RESOURCE_LABELS[resource]}（手牌超上限）`
  );
  if (
    game.phase === 'settle_act' &&
    !player.pendingDiscardFunc &&
    !player.pendingDiscardBuild &&
    !player.pendingDiscardRes &&
    game.currentPlayerId === player.id
  ) {
    game.settleActPassed[player.id] = true;
    const next = nextAlive(game, player.id);
    game.currentPlayerId = next ? next.id : player.id;
    ensureSettleActPlayer(game);
  }
  return { ok: true };
}

function actDiscardFunc(game, player, payload) {
  const cardId = payload.cardId;
  const idx = player.funcCards.findIndex((c) => c.id === cardId);
  if (idx < 0) return { ok: false, error: '功能卡不存在' };
  const [card] = player.funcCards.splice(idx, 1);
  pushToDiscard(game, 'function', card);
  if (player.funcCards.length <= maxFuncHandFor(player)) {
    player.pendingDiscardFunc = false;
  }
  pushLog(game, `${player.name} 弃置功能卡「${card.label}」（入弃牌堆）`);
  if (
    game.phase === 'settle_act' &&
    !player.pendingDiscardFunc &&
    !player.pendingDiscardBuild &&
    !player.pendingDiscardRes &&
    game.currentPlayerId === player.id
  ) {
    game.settleActPassed[player.id] = true;
    const next = nextAlive(game, player.id);
    game.currentPlayerId = next ? next.id : player.id;
    ensureSettleActPlayer(game);
  }
  return { ok: true };
}

function countBuiltExchanges(player) {
  return (player.buildings || []).filter(
    (b) => b.built && b.buildType === 'exchange'
  ).length;
}

/**
 * 集市兑换率：0座（默认银行）→4换1，1座→3换1，2座→2换1，≥3座→1换1
 * 每个玩家独立按自己已建集市数量计算。
 */
function exchangeCostN(exchangeCount) {
  const n = Number(exchangeCount) || 0;
  if (n === 0) return 4;
  if (n === 1) return 3;
  if (n === 2) return 2;
  return 1; // 3 座及以上
}

function actExchange(game, player, payload) {
  const exCount = countBuiltExchanges(player);
  const need = exchangeCostN(exCount);
  const from = payload.from;
  const to = payload.to;
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
      error: `需要 ${totalNeed} 个相同的${RESOURCE_LABELS[from]}${exCount > 0 ? '（当前持有 ' + exCount + ' 座集市）' : ''}`,
    };
  }
  player.resources[from] -= totalNeed;
  player.resources[to] = (player.resources[to] || 0) + count;
  const sourceLabel = exCount > 0 ? `用集市（${exCount}座，${need}换1）` : `银行兑换（${need}换1）`;
  pushLog(
    game,
    `${player.name} ${sourceLabel}：${totalNeed}${RESOURCE_LABELS[from]} → ${count}${RESOURCE_LABELS[to]}`
  );
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
  const buildOnly = ['harvest', 'robbery', 'redraw', 'expand', 'enhance', 'recruit'];

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
  } else {
    return { ok: false, error: '未知功能' };
  }

  let result;
  if (ft === 'harvest') result = useHarvest(game, player, payload);
  else if (ft === 'remoteDice') result = useRemoteDice(game, player, payload);
  else if (ft === 'exile') result = useExile(game, player, payload);
  else if (ft === 'redraw') result = useRedraw(game, player, payload);
  else if (ft === 'banditRaid') result = useBanditRaid(game, player, payload);
  else if (ft === 'expand') result = useExpand(game, player, payload);
  else if (ft === 'enhance') result = useEnhance(game, player, payload);
  else if (ft === 'recruit') result = useRecruit(game, player, payload);
  else if (ft === 'robbery') result = useRobbery(game, player, payload);
  else return { ok: false, error: '未知功能' };

  if (!result.ok) return result;

  player.funcCards.splice(idx, 1);
  returnFuncToDiscard(game, card);
  pushLog(game, `${player.name} 发动功能「${card.label}」`);

  if (checkWin(game)) return { ok: true };

  // 推进阶段
  if (game.phase === 'build' && game.currentPlayerId === player.id) {
    afterBuildAction(game, player.id, true);
  }

  return { ok: true };
}

function useHarvest(game, player, payload) {
  const picks = payload.resources || payload.picks;
  if (!Array.isArray(picks) || picks.length !== 2) {
    return { ok: false, error: '请选择任意 2 个资源' };
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
  // 优先：投掷前进入遥控模式（点数=0 表示任意）
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
  // 兼容：已投掷后改写全部点数
  const dice = payload.dice;
  const n = idleVillagers(player);
  if (!Array.isArray(dice) || dice.length !== n) {
    return { ok: false, error: `需要提供 ${n} 个骰子点数` };
  }
  if (!dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) {
    return { ok: false, error: '骰子点数无效' };
  }
  game.remoteDiceMode = false;
  game.dice[player.id] = dice.map(Number);
  assignDiceBoostFlags(game, player, n);
  pushLog(game, `${player.name} 遥控骰子 → [${dice.join(', ')}]`);
  return { ok: true };
}

function useExile(game, player, payload) {
  if (game.phase !== 'produce') {
    return { ok: false, error: '驱逐只能在生产阶段、轮到你时使用' };
  }
  if (game.currentPlayerId !== player.id) {
    return { ok: false, error: '还没轮到你' };
  }
  const area = payload.area;
  const number = Number(payload.number);
  const buildingId = payload.buildingId;
  const targetId = payload.targetId;
  const target = playerById(game, targetId);
  if (!target) return { ok: false, error: '目标玩家无效' };

  if (buildingId) {
    const owner = game.players.find((p) =>
      (p.buildings || []).some((b) => b.id === buildingId)
    );
    if (!owner) return { ok: false, error: '建筑不存在' };
    const b = findPersonalBuilding(owner, buildingId);
    if (!b || (b.workers || 0) < 1) return { ok: false, error: '该建筑没有村民' };
    if (owner.id !== targetId) return { ok: false, error: '目标不匹配' };
    b.workers -= 1;
    target.dispatched = Math.max(0, target.dispatched - 1);
    return { ok: true };
  }

  if (!BOARD_AREAS.includes(area)) {
    return { ok: false, error: '请选择资源/功能/建筑区' };
  }
  if (!Number.isInteger(number) || number < 1 || number > 6) {
    return { ok: false, error: '数字格无效' };
  }
  if (targetId === NEUTRAL_WORKER_ID) {
    return { ok: false, error: '无法驱逐中立强盗' };
  }
  const slotW = game.board[area].workers[number] || {};
  if ((slotW[targetId] || 0) < 1) {
    return { ok: false, error: '该玩家在此数字格没有村民' };
  }
  const slotB =
    (game.board[area].boosts && game.board[area].boosts[number]) || {};
  const physical = slotW[targetId];
  const boosted = Math.min(Number(slotB[targetId]) || 0, physical);
  const normal = physical - boosted;
  // 优先驱逐普通骰；无普通则驱逐强化骰
  if (normal > 0) {
    slotW[targetId] -= 1;
  } else {
    slotW[targetId] -= 1;
    if (game.board[area].boosts && game.board[area].boosts[number]) {
      game.board[area].boosts[number][targetId] = Math.max(0, boosted - 1);
      if (game.board[area].boosts[number][targetId] <= 0) {
        delete game.board[area].boosts[number][targetId];
      }
    }
  }
  if (slotW[targetId] <= 0) delete slotW[targetId];
  game.board[area].workers[number] = slotW;
  target.dispatched = Math.max(0, target.dispatched - 1);
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
  pushLog(
    game,
    `${player.name} 强盗来袭：在${AREA_LABELS[area]}区 ${number} 号格放置 ${BANDIT_RAID_COUNT} 枚中立骰子`
  );
  return { ok: true };
}

/** 抢劫：从目标玩家手中夺取 1 个指定资源 */
function useRobbery(game, player, payload) {
  const targetId = payload.targetId;
  const target = playerById(game, targetId);
  if (!target) return { ok: false, error: '目标玩家无效' };
  if (target.id === player.id) return { ok: false, error: '不能抢劫自己' };
  const resource = payload.resource;
  if (!RESOURCES.includes(resource)) return { ok: false, error: '资源类型无效' };
  if ((target.resources[resource] || 0) < 1) {
    return { ok: false, error: `目标玩家没有${RESOURCE_LABELS[resource]}` };
  }
  target.resources[resource] -= 1;
  player.resources[resource] = (player.resources[resource] || 0) + 1;
  pushLog(
    game,
    `${player.name} 抢劫 ${target.name}，夺走了 1 ${RESOURCE_LABELS[resource]}`
  );
  return { ok: true };
}

function actBuildHousePermanent(game, player) {
  if (!canPay(player.resources, BUILD_HOUSE_COST)) {
    return {
      ok: false,
      error: `需要 ${BUILD_HOUSE_COST.wood}木 ${BUILD_HOUSE_COST.stone}石 ${BUILD_HOUSE_COST.iron}铁`,
    };
  }
  pay(player.resources, BUILD_HOUSE_COST);
  player.houses = (Number(player.houses) || 0) + 1;
  player.score += 1;
  pushLog(
    game,
    `${player.name} 建造房子，+1 房 +1 分（房子 ${player.houses}，空闲 ${freeHousesFor(player)}，分数 ${playerScore(player)}）`
  );
  if (checkWin(game)) return { ok: true };
  // 常驻功能不结束回合，保留玩家行动权
  game.lastBuilderId = player.id;
  return { ok: true };
}

function actBreedPermanent(game, player) {
  if (player.villagers >= MAX_VILLAGERS) {
    return { ok: false, error: `村民已达上限 ${MAX_VILLAGERS}` };
  }
  const free = freeHousesFor(player);
  if (free <= 0) {
    return {
      ok: false,
      error: `没有空闲房子（房子 ${player.houses || 0} / 村民 ${player.villagers}），请先建造房子`,
    };
  }
  const cost = breedFoodCost(player.villagers);
  if ((player.resources.food || 0) < cost) {
    return { ok: false, error: `需要 ${cost} 小麦` };
  }
  player.resources.food -= cost;
  player.villagers += 1;
  pushLog(
    game,
    `${player.name} 繁殖村民（-${cost} 小麦），村民 ${player.villagers}（空闲房子 ${freeHousesFor(player)}）`
  );
  if (checkWin(game)) return { ok: true };
  // 常驻功能不结束回合，保留玩家行动权
  game.lastBuilderId = player.id;
  return { ok: true };
}

function actExpandPermanent(game, player, payload) {
  const cost = expandPermanentCost(player);
  if (!canPay(player.resources, cost)) {
    return {
      ok: false,
      error: `需要 ${cost.wood} 木 ${cost.stone} 石（已扩容 ${expandCountFor(player)} 次）`,
    };
  }
  pay(player.resources, cost);
  const result = useExpand(game, player, payload);
  if (!result.ok) {
    player.resources.wood = (player.resources.wood || 0) + cost.wood;
    player.resources.stone = (player.resources.stone || 0) + cost.stone;
    return result;
  }
  pushLog(
    game,
    `${player.name} 常驻扩容（-${cost.wood} 木 -${cost.stone} 石）`
  );
  if (checkWin(game)) return { ok: true };
  game.lastBuilderId = player.id;
  return { ok: true };
}

function useExpand(game, player, payload) {
  const dir = payload && payload.direction;
  if (dir === 'building') {
    player.expandSlots = (Number(player.expandSlots) || 0) + 1;
    pushLog(
      game,
      `${player.name} 扩容：建筑区 +1 无数字格（建筑上限 ${maxBuildingsFor(player)}）`
    );
  } else if (dir === 'function') {
    player.expandFuncSlots = (Number(player.expandFuncSlots) || 0) + 1;
    pushLog(
      game,
      `${player.name} 扩容：功能手牌上限 +1（当前 ${maxFuncHandFor(player)}）`
    );
    if (player.funcCards.length > maxFuncHandFor(player)) {
      player.pendingDiscardFunc = true;
    }
  } else if (dir === 'resource') {
    player.expandResSlots = (Number(player.expandResSlots) || 0) + 1;
    pushLog(
      game,
      `${player.name} 扩容：资源卡位 +1（手牌资源上限 ${maxResourceHandFor(player)}）`
    );
  } else {
    return {
      ok: false,
      error:
        '请选择扩容方向：building（建筑格）、function（功能卡格）或 resource（资源卡位）',
    };
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

function useRedraw(game, player, _payload) {
  const card = drawOne(game, 'special');
  if (!card) return { ok: false, error: '功能/建筑合堆与弃牌堆都已空' };
  if (deckKindOfTile(card) === 'building') {
    const neu = {
      ...card,
      faceDown: false,
      slot: 'none',
      built: false,
      workers: 0,
    };
    if (player.buildings.length >= maxBuildingsFor(player)) {
      player.pendingDiscardBuild = { newCard: neu };
    } else {
      player.buildings.push(neu);
    }
    pushLog(game, `${player.name} 重抽：合堆顶 → 建筑「${card.label || '?'}」`);
  } else {
    receiveFunctionCard(game, player, card);
    pushLog(game, `${player.name} 重抽：合堆顶 → 功能「${card.label || '?'}」`);
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

function publicArea(areaBoard) {
  const slots = [];
  for (let num = 1; num <= 6; num++) {
    const tiles = tilesOnNumber(areaBoard, num).map(publicTile);
    const workers = { ...(areaBoard.workers[num] || {}) };
    const boosts = {
      ...((areaBoard.boosts && areaBoard.boosts[num]) || {}),
    };
    if (
      !tiles.length &&
      !Object.keys(workers).length &&
      !Object.keys(boosts).length
    ) {
      slots.push({ number: num, tiles: [], workers: {}, boosts: {} });
      continue;
    }
    slots.push({ number: num, tiles, workers, boosts });
  }
  const boostAll = {};
  for (let n = 1; n <= 6; n++) {
    boostAll[n] = { ...((areaBoard.boosts && areaBoard.boosts[n]) || {}) };
  }
  return {
    tiles: (areaBoard.tiles || []).map(publicTile),
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
    buildHouseCost: { ...BUILD_HOUSE_COST },
    breedFoodPerVillager: BREED_FOOD_PER_VILLAGER,
    board: {
      resource: publicArea(game.board.resource),
      special: publicArea(game.board.special),
    },
    decksLeft: {
      resource: game.resourceDeck.length,
      special: (game.specialDeck || []).length,
    },
    discardsLeft: {
      resource: (game.resourceDiscard || []).length,
      special: (game.specialDiscard || []).length,
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
    settleAnimUntil:
      game.phase === 'settle' ? Number(game.settleAnimUntil) || 0 : 0,
    settleAnimPending: game.phase === 'settle',
    wishWellPending:
      game.phase === 'wish_well'
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
    log: game.log.slice(-20),
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
        resources: cloneRes(p.resources),
        score: playerScore(p),
        roundGained: p.roundGained,
        roundBuiltHouse: Boolean(p.roundBuiltHouse),
        roundBred: Boolean(p.roundBred),
        funcCount: p.funcCards.length,
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
          exchangeCount: countBuiltExchanges(me),
          exchangeCost: exchangeCostN(countBuiltExchanges(me)),
          pendingDiscardFunc: me.pendingDiscardFunc,
          pendingDiscardBuild: me.pendingDiscardBuild,
          pendingDiscardRes: me.pendingDiscardRes,
          maxResourceHand: maxResourceHandFor(me),
          expandCount: expandCountFor(me),
          expandPermanentCost: expandPermanentCost(me),
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
  if (
    game.phase === 'settle_act' &&
    (player.pendingDiscardFunc ||
      player.pendingDiscardBuild ||
      player.pendingDiscardRes)
  ) {
    return true;
  }
  if (game.phase === 'wish_well') {
    return (player.pendingWishWellBonus || 0) > 0;
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
    const discardPending = alivePlayers(game)
      .filter(
        (p) =>
          p.pendingDiscardFunc ||
          p.pendingDiscardBuild ||
          p.pendingDiscardRes
      )
      .map((p) => p.id);
    if (discardPending.length) {
      if (game.currentPlayerId && discardPending.includes(game.currentPlayerId)) {
        return [game.currentPlayerId];
      }
      return [discardPending[0]];
    }
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
  if (game.phase === 'wish_well') {
    return playersNeedingWishWell(game).map((p) => p.id);
  }
  if (
    ['produce', 'settle_act', 'build'].includes(game.phase) &&
    game.currentPlayerId
  ) {
    return [game.currentPlayerId];
  }
  return [];
}

function forceTimeout(game, playerId) {
  const p = playerById(game, playerId);
  if (!p || game.over) return { ok: false, error: '无法超时处理' };

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
    game.phase === 'settle_act' &&
    p.pendingDiscardBuild &&
    p.buildings.length
  ) {
    // 超时优先弃未建，否则弃任意一张腾位
    const pick =
      p.buildings.find((b) => !b.built) || p.buildings[0];
    return applyAction(game, playerId, {
      type: 'discardUnbuilt',
      payload: { buildingId: pick.id },
    });
  }
  if (game.phase === 'wish_well' && (p.pendingWishWellBonus || 0) > 0) {
    const alloc = emptyRes();
    alloc.wood = Number(p.pendingWishWellBonus) || 0;
    return applyAction(game, playerId, {
      type: 'allocateWishWell',
      payload: { alloc },
    });
  }

  const unplaced = (p.buildings || []).find((b) => !b.built && b.slot == null);
  if (unplaced) {
    // 自动放到第一个可用无格槽
    for (const slot of personalSlotsFor(p)) {
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

  if (game.currentPlayerId === playerId) {
    if (game.phase === 'produce') {
      advanceToNextProducer(game, false);
      if (game.phase === 'produce' && game.currentPlayerId) {
        prepareProduceTurn(game);
      }
    } else if (game.phase === 'settle_act') {
      game.settleActPassed[playerId] = true;
      const next = nextAlive(game, playerId);
      game.currentPlayerId = next ? next.id : null;
      ensureSettleActPlayer(game);
    } else if (game.phase === 'wish_well') {
      p.pendingWishWellBonus = 0;
      tryFinishWishWellPhase(game);
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
  INIT_ANNOUNCE_MS,
  SETTLE_ANIM_MAX_MS,
  // 测试导出
  cancelEqualCounts,
  playerScore,
  exchangeCostN,
  countBuiltExchanges,
  WIN_SCORE,
  MAX_RESOURCE_BOARD_TILES,
  MAX_RESOURCE_HAND,
  MAX_ENHANCED_DICE,
  RECRUIT_TEMP_VILLAGERS,
  EXPAND_RESOURCE_BONUS,
  maxResourceHandFor,
  expandCountFor,
  expandPermanentCost,
  freeHousesFor,
  idleVillagers,
  beginProduce,
  startSettle,
  START_HOUSES,
  START_VILLAGERS,
};
