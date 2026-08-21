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
  buildResourceDeck,
  buildFunctionDeck,
  buildBuildingDeck,
} = require('./decks');

const WIN_SCORE = 10;
const START_VILLAGERS = 3;
const MAX_VILLAGERS = 12;
const MAX_FUNC_HAND = 5;
const MAX_BUILDINGS = 6;

function isNoneSlot(slot) {
  return slot === 'none' || (typeof slot === 'string' && /^none(:\d+)?$/.test(slot));
}

function noneSlotList(player) {
  const n = 1 + (Number(player && player.expandSlots) || 0);
  const out = ['none'];
  for (let i = 1; i < n; i++) out.push(`none:${i}`);
  return out;
}

function personalSlotsFor(player) {
  return [1, 2, 3, 4, 5, 6, ...noneSlotList(player)];
}

function maxBuildingsFor(player) {
  return MAX_BUILDINGS + (Number(player && player.expandSlots) || 0);
}

function slotLabel(slot) {
  return isNoneSlot(slot) ? '无数字' : String(slot);
}

/** 三大公共区 */
const BOARD_AREAS = ['resource', 'function', 'building'];
const AREA_LABELS = {
  resource: '资源',
  function: '功能',
  building: '建筑',
};

function emptyRes() {
  return { wood: 0, stone: 0, food: 0, iron: 0 };
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

function countBuiltEfficiency(p) {
  return (p.buildings || []).filter(
    (b) => b.built && b.buildType === 'efficiency'
  ).length;
}

/**
 * 从资源板块某一数字格取得大份/小份（基础量；精炼装置加成稍后由玩家分配）。
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
  if (total > 0) p._boardResGainSettle = true;
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
  return Math.max(0, p.villagers - p.dispatched);
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
  const winners = [];
  for (const p of alivePlayers(game)) {
    if (playerScore(p) >= WIN_SCORE) winners.push(p.id);
  }
  if (winners.length) {
    game.over = true;
    game.phase = 'over';
    game.winners = winners;
    const names = winners
      .map((id) => {
        const p = playerById(game, id);
        return p ? p.name : id;
      })
      .join('、');
    pushLog(game, `有玩家达到 ${WIN_SCORE} 分，游戏结束！胜者：${names}`);
    return true;
  }
  return false;
}

// ─── 板块摆放 ───────────────────────────────────────────

function emptySlotWorkers() {
  return { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
}

function emptyAreaBoard() {
  return {
    tiles: [], // { ...card, number }
    workers: emptySlotWorkers(), // number -> { playerId: count }
  };
}

function emptyBoard() {
  return {
    resource: emptyAreaBoard(),
    function: emptyAreaBoard(),
    building: emptyAreaBoard(),
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
  function: '功能',
  building: '建筑',
};

function deckKey(kind) {
  return `${kind}Deck`;
}

function discardKey(kind) {
  return `${kind}Discard`;
}

/** 抽牌堆空时，将旁置弃牌堆洗混后作为新抽牌堆 */
function ensureDeck(game, kind) {
  const dk = deckKey(kind);
  const xk = discardKey(kind);
  if ((game[dk] || []).length > 0) return true;
  if (!(game[xk] || []).length) return false;
  game[dk] = shuffle(game[xk]);
  game[xk] = [];
  pushLog(
    game,
    `${DECK_KIND_LABEL[kind] || kind}抽牌堆已空，弃牌堆洗混后放回（${game[dk].length} 张）`
  );
  return true;
}

function pushToDiscard(game, kind, card) {
  if (!card) return;
  if (!game[discardKey(kind)]) game[discardKey(kind)] = [];
  game[discardKey(kind)].push(cleanCardForPile(card));
}

function drawOne(game, kind) {
  if (!ensureDeck(game, kind)) return null;
  return game[deckKey(kind)].shift();
}

/** 功能/建筑区：奇数格明示，偶数格暗置 */
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
      (kind === 'function' || kind === 'building') &&
      isBoardFaceDownNumber(number);
    tiles.push({
      ...card,
      number,
      faceDown,
    });
  }
  return tiles;
}

function setupBoard(game) {
  const n = Math.max(0, game.round - 1);
  const resCount = Math.min(12, 6 + n);
  const fnCount = Math.min(6, 2 + n);
  const bldCount = Math.min(6, 1 + n);

  game.board = emptyBoard();
  game.board.resource.tiles = drawToArea(game, 'resource', resCount);
  game.board.function.tiles = drawToArea(game, 'function', fnCount);
  game.board.building.tiles = drawToArea(game, 'building', bldCount);

  pushLog(
    game,
    `第 ${game.round} 轮摆放：资源 ${game.board.resource.tiles.length}、功能 ${game.board.function.tiles.length}、建筑 ${game.board.building.tiles.length}`
  );
}

function tilesOnNumber(areaBoard, number) {
  return (areaBoard.tiles || []).filter((t) => t.number === number);
}

function clearAllSlotWorkers(game) {
  for (const area of BOARD_AREAS) {
    game.board[area].workers = emptySlotWorkers();
  }
}

function findPersonalBuilding(player, buildingId) {
  return (player.buildings || []).find((b) => b.id === buildingId) || null;
}

/** 回收未获取的公共板块到旁置弃牌堆（不立刻回抽牌堆底） */
function recycleBoard(game) {
  for (const t of game.board.resource.tiles) {
    pushToDiscard(game, 'resource', t);
  }
  for (const t of game.board.function.tiles) {
    pushToDiscard(game, 'function', t);
  }
  for (const t of game.board.building.tiles) {
    pushToDiscard(game, 'building', t);
  }
  game.board = emptyBoard();
}

// ─── 拉斯维加斯式抵消 ───────────────────────────────────

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
      faceDown: Boolean(t.faceDown),
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
  // 暗置建筑：仅持有者可见内容；建造后翻开
  if (b.faceDown && !isMe && !b.built) {
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
    faceDown: Boolean(b.faceDown),
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
    dispatched: 0,
    voided: 0,
    resources: emptyRes(),
    score: 0,
    funcCards: [],
    buildings: [], // { ...card, slot, built }
    roundGained: 0,
    pendingDiscardFunc: false,
    pendingDiscardBuild: null, // 总建筑达上限时需弃一张（已建或未建）腾位
    pendingEfficiencyBonus: 0, // 本轮从资源板块有获取时，待分配的精炼装置次数
    expandSlots: 0, // 「扩建」自动发动后增加的无数字格数量
  }));

  const game = {
    type: 'lasidao',
    phase: 'init_announce', // init_announce | produce | settle | build | round_end | over
    round: 1,
    over: false,
    winners: [],
    players,
    resourceDeck: buildResourceDeck(),
    functionDeck: buildFunctionDeck(),
    buildingDeck: buildBuildingDeck(),
    resourceDiscard: [],
    functionDiscard: [],
    buildingDiscard: [],
    board: emptyBoard(),
    // 生产阶段
    produceOrderStartId: null,
    currentPlayerId: null,
    lastPlacerId: null,
    lastBuilderId: null,
    dice: {}, // playerId -> number[]
    awaitingProduceRoll: false,
    remoteDiceMode: false,
    // 建造阶段
    buildPassed: {}, // playerId -> true 本轮声明跳过
    buildIdleLoops: 0,
    // 先手投掷
    initRolls: {},
    log: [],
    lastSettle: null,
  };

  // 开局自动投先手 → 宣布 → 再发牌
  startInitRoll(game);
  return game;
}

const INIT_ANNOUNCE_MS = 3800;

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
  game.lastPlacerId = null;
  for (const p of alivePlayers(game)) {
    p.dispatched = 0;
    p.voided = 0;
    p.roundGained = 0;
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
}

function rollForCurrent(game) {
  const p = playerById(game, game.currentPlayerId);
  if (!p || p.left) return;
  const n = idleVillagers(p);
  game.awaitingProduceRoll = false;
  game.remoteDiceMode = false;
  if (n <= 0) {
    game.dice[p.id] = [];
    return;
  }
  game.dice[p.id] = rollDice(n);
  pushLog(
    game,
    `${p.name} 投掷 ${n} 枚骰子：[${game.dice[p.id].join(', ')}]`
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

function startSettle(game) {
  game.phase = 'settle';
  game.currentPlayerId = null;
  game.dice = {};
  const report = {
    at: Date.now(),
    round: game.round,
    slots: [],
    buildings: [],
    mvp: null,
  };
  pushLog(game, '—— 进入结算阶段 ——');

  for (const p of alivePlayers(game)) {
    p._boardResGainSettle = false;
    p.pendingEfficiencyBonus = 0;
  }

  // 资源区：按数字格汇总派遣，最多者拿该格全部资源卡的大份，第二拿全部小份
  for (let num = 1; num <= 6; num++) {
    const workers = game.board.resource.workers[num] || {};
    const tiles = tilesOnNumber(game.board.resource, num);
    if (!tiles.length && !Object.keys(workers).length) continue;

    const before = { ...workers };
    const remain = cancelEqualCounts(workers);
    game.board.resource.workers[num] = remain;
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
    const n = countBuiltEfficiency(p);
    if (p._boardResGainSettle && n > 0) {
      p.pendingEfficiencyBonus = n;
      pushLog(
        game,
        `${p.name} 因精炼装置可额外选取资源 +1 ×${n}（结算行动时分配）`
      );
    } else {
      p.pendingEfficiencyBonus = 0;
    }
    delete p._boardResGainSettle;
  }

  // 功能区：按数字格汇总，最多者拿走该格全部功能卡
  for (let num = 1; num <= 6; num++) {
    const workers = game.board.function.workers[num] || {};
    const tiles = tilesOnNumber(game.board.function, num);
    if (!tiles.length && !Object.keys(workers).length) continue;

    const before = { ...workers };
    const remain = cancelEqualCounts(workers);
    game.board.function.workers[num] = remain;
    const ranked = mapRanked(game, remain);
    let claimedBy = null;

    if (ranked[0] && tiles.length) {
      const p = playerById(game, ranked[0].pid);
      if (p) {
        for (const tile of tiles) takeFunctionCard(game, p, tile);
        game.board.function.tiles = game.board.function.tiles.filter(
          (t) => t.number !== num
        );
        claimedBy = { pid: p.id, name: p.name, count: ranked[0].count };
        pushLog(
          game,
          `${p.name} 以 ${ranked[0].count} 名村民取得功能格 ${num} 全部卡：` +
            tiles.map(tileLogLabel).join('、')
        );
      }
    } else if (Object.keys(before).length) {
      pushLog(game, `功能格 ${num}：全部抵消，无人取得`);
    }

    report.slots.push({
      area: 'function',
      number: num,
      before,
      remain,
      cancelled: cancelledEntries(before, remain),
      ranked,
      tiles: summarizeTiles(tiles),
      gains: [],
      claimedBy,
    });
  }

  // 建筑区：按数字格汇总，最多者拿走该格全部建筑卡
  for (let num = 1; num <= 6; num++) {
    const workers = game.board.building.workers[num] || {};
    const tiles = tilesOnNumber(game.board.building, num);
    if (!tiles.length && !Object.keys(workers).length) continue;

    const before = { ...workers };
    const remain = cancelEqualCounts(workers);
    game.board.building.workers[num] = remain;
    const ranked = mapRanked(game, remain);
    let claimedBy = null;

    if (ranked[0] && tiles.length) {
      const p = playerById(game, ranked[0].pid);
      if (p) {
        for (const tile of tiles) takeBuildingCard(game, p, tile);
        game.board.building.tiles = game.board.building.tiles.filter(
          (t) => t.number !== num
        );
        claimedBy = { pid: p.id, name: p.name, count: ranked[0].count };
        pushLog(
          game,
          `${p.name} 取得建筑格 ${num} 全部卡：` +
            tiles.map(tileLogLabel).join('、') +
            '（需选择格子放置）'
        );
      }
    } else if (Object.keys(before).length) {
      pushLog(game, `建筑格 ${num}：全部抵消，无人取得`);
    }

    report.slots.push({
      area: 'building',
      number: num,
      before,
      remain,
      cancelled: cancelledEntries(before, remain),
      ranked,
      tiles: summarizeTiles(tiles),
      gains: [],
      claimedBy,
    });
  }

  // 个人资源建筑产出
  for (const p of alivePlayers(game)) {
    for (const b of p.buildings) {
      if (!b.built || b.buildType !== 'produce') continue;
      if ((b.workers || 0) <= 0) continue;
      const amt = b.produce || 0;
      if (amt > 0) {
        p.resources[b.resource] = (p.resources[b.resource] || 0) + amt;
        p.roundGained += amt;
        report.buildings.push({
          pid: p.id,
          name: p.name,
          label: b.label,
          resource: b.resource,
          amount: amt,
        });
        pushLog(
          game,
          `${p.name} 的${b.label}产出 ${amt} ${RESOURCE_LABELS[b.resource]}`
        );
      }
    }
  }

  // 本轮获取资源最多者 +1 分（并列不得分）
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
    top[0].score += 1;
    report.mvp = { id: top[0].id, name: top[0].name, gained: maxG };
    pushLog(
      game,
      `${top[0].name} 本轮获取资源最多（${maxG}），获得 1 分（当前 ${playerScore(top[0])} 分）`
    );
    if (checkWin(game)) {
      game.lastSettle = report;
      return;
    }
  } else if (maxG > 0 && top.length > 1) {
    pushLog(
      game,
      `本轮资源并列最多（${maxG}）：${top.map((p) => p.name).join('、')}，无人得分`
    );
  }

  game.lastSettle = report;

  game.phase = 'settle_act';
  game.settleActPassed = {};
  game.currentPlayerId = game.lastPlacerId || game.produceOrderStartId;
  if (!game.currentPlayerId) {
    beginBuild(game);
    return;
  }
  pushLog(game, '结算行动：可分配效率加成、使用「建造房子」等，或跳过');
  ensureSettleActPlayer(game);
}

function takeFunctionCard(game, player, tile) {
  const { number, ...card } = tile;
  receiveFunctionCard(game, player, card);
}

/** 入手功能卡；「扩建」获得即自动发动，不占手牌 */
function receiveFunctionCard(game, player, card) {
  if (card.funcType === 'expand') {
    applyExpand(game, player, card);
    return;
  }
  player.funcCards.push(card);
  if (player.funcCards.length > MAX_FUNC_HAND) {
    player.pendingDiscardFunc = true;
  }
}

function applyExpand(game, player, card) {
  player.expandSlots = (Number(player.expandSlots) || 0) + 1;
  pushToDiscard(game, 'function', {
    id: card.id,
    kind: 'function',
    funcType: card.funcType,
    label: card.label || FUNC_TYPES.expand,
  });
  pushLog(
    game,
    `${player.name} 获得并自动发动「扩建」：建筑区 +1 无数字格（建筑上限 ${maxBuildingsFor(player)}）`
  );
}

function takeBuildingCard(game, player, tile) {
  const { number, ...card } = tile;
  // 保留 faceDown：暗置建筑仅持有者可见，建造后翻开
  const neu = {
    ...card,
    faceDown: Boolean(tile.faceDown),
    slot: null,
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
    beginBuild(game);
    return;
  }
  // 若所有人都跳过，进入建造
  if (alive.every((p) => game.settleActPassed[p.id])) {
    beginBuild(game);
    return;
  }
  let id = game.currentPlayerId;
  const n = game.players.length;
  for (let i = 0; i < n; i++) {
    const p = playerById(game, id);
    if (p && !p.left && !game.settleActPassed[p.id]) {
      // 还需处理弃牌 / 精炼装置加成
      if (
        p.pendingDiscardFunc ||
        p.pendingDiscardBuild ||
        (p.pendingEfficiencyBonus || 0) > 0
      ) {
        game.currentPlayerId = p.id;
        return;
      }
      // 若手中无结算可用卡，自动跳过
      const hasSettleCard = p.funcCards.some((c) => c.funcType === 'buildHouse');
      if (!hasSettleCard) {
        game.settleActPassed[p.id] = true;
        const next = nextAlive(game, id);
        id = next ? next.id : id;
        continue;
      }
      game.currentPlayerId = p.id;
      return;
    }
    const next = nextAlive(game, id);
    if (!next) break;
    id = next.id;
  }
  beginBuild(game);
}

function beginBuild(game) {
  if (game.over) return;
  game.phase = 'build';
  game.buildPassed = {};
  game.buildIdleLoops = 0;
  const startId = game.lastPlacerId || game.produceOrderStartId;
  game.currentPlayerId = startId;
  pushLog(game, '—— 进入建造阶段 ——');
  // 找到第一位需要行动（有弃牌/待放置/可建造/可发动功能）的玩家
  findNextBuilder(game, true);
}

function hasPendingPlacement(p) {
  return (p.buildings || []).some((b) => !b.built && b.slot == null) ||
    Boolean(p.pendingDiscardBuild);
}

function canBuildSomething(p) {
  if (p.pendingDiscardFunc || p.pendingDiscardBuild) return true;
  if (hasPendingPlacement(p)) return true;
  // 可支付建造未建建筑
  for (const b of p.buildings || []) {
    if (!b.built && b.slot != null && canPay(p.resources, b.cost || {})) {
      return true;
    }
  }
  // 可发动功能卡（轮次结束类在 round_end；此处允许 anytime + 建造阶段）
  for (const c of p.funcCards || []) {
    if (['remoteDice', 'exile', 'redraw', 'banditRaid', 'breed', 'harvest'].includes(c.funcType)) {
      if (c.funcType === 'breed' || c.funcType === 'harvest') continue; // 轮次结束
      return true;
    }
    if (c.funcType === 'buildHouse' && canPay(p.resources, { wood: 4, stone: 3, iron: 2 })) {
      return true;
    }
  }
  // 交易所
  if (
    (p.buildings || []).some(
      (b) => b.built && b.buildType === 'exchange'
    )
  ) {
    // 有资源可换时才算有动作——不强制，允许玩家手动 pass
  }
  return false;
}

function findNextBuilder(game, stayIfSelf) {
  const alive = alivePlayers(game);
  if (!alive.length) {
    endRound(game);
    return;
  }
  if (alive.every((p) => game.buildPassed[p.id])) {
    endRound(game);
    return;
  }

  let id = game.currentPlayerId || game.lastPlacerId || alive[0].id;
  if (!stayIfSelf) {
    const next = nextAlive(game, id);
    if (next) id = next.id;
  }

  const n = game.players.length;
  for (let step = 0; step < n; step++) {
    const p = playerById(game, id);
    if (p && !p.left && !game.buildPassed[p.id]) {
      if (
        !p.pendingDiscardFunc &&
        !p.pendingDiscardBuild &&
        !hasPendingPlacement(p) &&
        !canBuildSomething(p)
      ) {
        game.buildPassed[p.id] = true;
      } else {
        game.currentPlayerId = id;
        return;
      }
    }
    const next = nextAlive(game, id);
    if (!next) break;
    id = next.id;
  }

  if (alive.every((p) => game.buildPassed[p.id])) {
    endRound(game);
    return;
  }
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
  if (didRealAction) {
    // 有人行动后，清除所有 pass，继续循环
    game.buildPassed = {};
  }
  if (checkWin(game)) return;
  const next = nextAlive(game, playerId);
  game.currentPlayerId = next ? next.id : playerId;
  findNextBuilder(game, true);
}

function endRound(game) {
  if (game.over) return;
  game.phase = 'round_end';
  game.currentPlayerId = null;
  pushLog(game, `—— 第 ${game.round} 轮结束 ——`);

  // 轮次结束功能：繁殖 / 丰收 —— 玩家可在 UI 选择发动；这里进入 round_end 阶段让人操作
  // 为流畅：自动提示阶段，玩家用 useFunc；全员 pass 后进入下一轮
  game.roundEndPassed = {};
  const startId = game.lastBuilderId || game.lastPlacerId || game.produceOrderStartId;
  game.currentPlayerId = startId;
  ensureRoundEndPlayer(game);
}

function ensureRoundEndPlayer(game) {
  const alive = alivePlayers(game);
  if (alive.every((p) => game.roundEndPassed[p.id])) {
    startNextRound(game);
    return;
  }
  let id = game.currentPlayerId;
  const n = game.players.length;
  for (let i = 0; i < n; i++) {
    const p = playerById(game, id);
    if (p && !p.left && !game.roundEndPassed[p.id]) {
      const has =
        p.funcCards.some((c) => c.funcType === 'breed' || c.funcType === 'harvest') ||
        p.pendingDiscardFunc ||
        p.pendingDiscardBuild ||
        hasPendingPlacement(p);
      if (!has) {
        game.roundEndPassed[p.id] = true;
        const next = nextAlive(game, id);
        id = next ? next.id : id;
        continue;
      }
      game.currentPlayerId = p.id;
      return;
    }
    const next = nextAlive(game, id);
    if (!next) break;
    id = next.id;
  }
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

  // 随时可用：交易所、部分功能（在合法阶段校验）
  if (type === 'exchange') {
    return actExchange(game, player, payload);
  }
  if (type === 'useFunc') {
    return actUseFunc(game, player, payload);
  }
  if (type === 'discardFunc') {
    return actDiscardFunc(game, player, payload);
  }
  if (type === 'discardUnbuilt') {
    return actDiscardUnbuilt(game, player, payload);
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
    if (type === 'voidSkip') return actVoidSkip(game, player);
    return { ok: false, error: '生产阶段请投掷、放置骰子或虚空派遣' };
  }

  if (game.phase === 'settle_act') {
    if (type === 'allocateEfficiency') {
      return actAllocateEfficiency(game, player, payload);
    }
    if (game.currentPlayerId !== playerId) {
      return { ok: false, error: '还没轮到你' };
    }
    if ((player.pendingEfficiencyBonus || 0) > 0) {
      return { ok: false, error: '请先分配精炼装置加成' };
    }
    if (type === 'pass') {
      game.settleActPassed[playerId] = true;
      const next = nextAlive(game, playerId);
      game.currentPlayerId = next ? next.id : playerId;
      ensureSettleActPlayer(game);
      return { ok: true };
    }
    if (type === 'useFunc') return actUseFunc(game, player, payload);
    return { ok: false, error: '结算行动：分配效率加成、使用建造房子或跳过' };
  }

  if (game.phase === 'build') {
    if (game.currentPlayerId !== playerId) {
      return { ok: false, error: '还没轮到你' };
    }
    if (type === 'pass') {
      game.buildPassed[playerId] = true;
      afterBuildAction(game, playerId, false);
      return { ok: true };
    }
    if (type === 'construct') return actConstruct(game, player, payload);
    if (type === 'useFunc') return actUseFunc(game, player, payload);
    return { ok: false, error: '建造阶段：建造、用功能卡或跳过' };
  }

  if (game.phase === 'round_end') {
    if (game.currentPlayerId !== playerId) {
      return { ok: false, error: '还没轮到你' };
    }
    if (type === 'pass') {
      game.roundEndPassed[playerId] = true;
      const next = nextAlive(game, playerId);
      game.currentPlayerId = next ? next.id : playerId;
      ensureRoundEndPlayer(game);
      return { ok: true };
    }
    if (type === 'useFunc') return actUseFunc(game, player, payload);
    return { ok: false, error: '轮次结束：可繁殖/丰收或跳过' };
  }

  return { ok: false, error: '当前阶段无法操作' };
}

/** payload.alloc: { wood, stone, food, iron } 非负整数，合计 = pendingEfficiencyBonus */
function actAllocateEfficiency(game, player, payload = {}) {
  const need = Number(player.pendingEfficiencyBonus) || 0;
  if (need <= 0) return { ok: false, error: '无需分配效率加成' };
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
      error: `需恰好分配 ${need} 点加成（当前 ${sum}）`,
    };
  }
  const parts = [];
  for (const r of RESOURCES) {
    if (!counts[r]) continue;
    player.resources[r] = (player.resources[r] || 0) + counts[r];
    player.roundGained += counts[r];
    parts.push(`${RESOURCE_LABELS[r]}+${counts[r]}`);
  }
  player.pendingEfficiencyBonus = 0;
  pushLog(
    game,
    `${player.name} 精炼装置加成：${parts.join('、') || '无'}`
  );
  if (game.phase === 'settle_act') {
    // 无结算功能卡时自动跳过，避免卡在无「跳过」按钮的结算行动
    ensureSettleActPlayer(game);
  }
  return { ok: true };
}

function actPlaceDice(game, player, payload) {
  game.pendingInitReveal = null;
  if (game.awaitingProduceRoll) {
    return { ok: false, error: '请先投掷或使用遥控骰子' };
  }
  const face = Number(payload.face);
  const area = payload.area; // 'resource' | 'function' | 'building'
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

  if (personalBuildingId) {
    const b = findPersonalBuilding(player, personalBuildingId);
    if (!b || !b.built) return { ok: false, error: '建筑不存在或未建造' };
    if (b.slot !== face && b.slot !== Number(face)) {
      return { ok: false, error: '建筑格子点数不匹配' };
    }
    b.workers = (b.workers || 0) + count;
    if (remote) {
      let left = count;
      game.dice[player.id] = dice.filter((d) => {
        if (d === 0 && left > 0) {
          left -= 1;
          return false;
        }
        return true;
      });
    } else {
      game.dice[player.id] = dice.filter((d) => d !== face);
    }
    player.dispatched += count;
    pushLog(
      game,
      `${player.name} 派遣 ${count} 名村民（点数 ${face}）到自己的建筑` +
        (remote ? '（遥控）' : '')
    );
    game.remoteDiceMode = false;
    afterProduceAction(game, player.id);
    return { ok: true };
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
  slotW[player.id] = (slotW[player.id] || 0) + count;

  if (remote) {
    let left = count;
    game.dice[player.id] = dice.filter((d) => {
      if (d === 0 && left > 0) {
        left -= 1;
        return false;
      }
      return true;
    });
  } else {
    game.dice[player.id] = dice.filter((d) => d !== face);
  }
  player.dispatched += count;
  pushLog(
    game,
    `${player.name} 派遣 ${count} 名村民到${AREA_LABELS[area]}区 ${face} 号格` +
      (remote ? '（遥控）' : '')
  );
  game.remoteDiceMode = false;
  afterProduceAction(game, player.id);
  return { ok: true };
}

function actVoidSkip(game, player) {
  game.pendingInitReveal = null;
  if (idleVillagers(player) <= 0) {
    return { ok: false, error: '没有可派遣的村民' };
  }
  player.dispatched += 1;
  player.voided += 1;
  game.dice[player.id] = [];
  game.awaitingProduceRoll = false;
  game.remoteDiceMode = false;
  pushLog(game, `${player.name} 虚空派遣 1 名村民，跳过本回合`);
  afterProduceAction(game, player.id);
  return { ok: true };
}

function actConstruct(game, player, payload) {
  const buildingId = payload.buildingId;
  const b = findPersonalBuilding(player, buildingId);
  if (!b) return { ok: false, error: '建筑不存在' };
  if (b.built) return { ok: false, error: '已经建造过了' };
  if (b.slot == null) return { ok: false, error: '请先选择放置格子' };
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
  if (slot === 'none' || slot === 0 || slot === '0') slot = 'none';
  else if (typeof slot === 'string' && /^none:\d+$/.test(slot)) {
    // keep none:N
  } else slot = Number(slot);

  const allowedNone = noneSlotList(player);
  if (isNoneSlot(slot)) {
    if (!allowedNone.includes(slot)) {
      return { ok: false, error: '无数字格不足，需先使用「扩建」' };
    }
  } else if (!Number.isInteger(slot) || slot < 1 || slot > 6) {
    return { ok: false, error: '格子无效' };
  }

  const b = findPersonalBuilding(player, buildingId);
  if (!b) return { ok: false, error: '建筑不存在' };
  if (b.slot != null) return { ok: false, error: '已放置过格子' };
  if (isNoneSlot(slot) && b.buildType === 'produce') {
    return { ok: false, error: '生产建筑不能放在无数字格' };
  }
  if (player.buildings.some((x) => x.slot === slot)) {
    if (!payload.replace) {
      return { ok: false, error: '该格子已有建筑，可选择替换弃置' };
    }
    const occ = player.buildings.find((x) => x.slot === slot);
    if (occ) {
      if ((occ.workers || 0) > 0) {
        player.dispatched = Math.max(
          0,
          (player.dispatched || 0) - occ.workers
        );
        occ.workers = 0;
      }
      player.buildings = player.buildings.filter((x) => x.id !== occ.id);
      pushToDiscard(game, 'building', occ);
      pushLog(
        game,
        `${player.name} 弃置格子 ${slotLabel(slot)} 上的「${occ.label}」以放置新建筑`
      );
    }
  }
  if (player.buildings.filter((x) => x.slot != null).length >= maxBuildingsFor(player)) {
    return { ok: false, error: `建筑格子已达上限 ${maxBuildingsFor(player)}` };
  }
  b.slot = slot;
  pushLog(
    game,
    `${player.name} 将「${b.label}」放到格子 ${slotLabel(slot)}`
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
    pushLog(
      game,
      `${player.name} 弃置${wasBuilt ? '已建' : '未建'}「${b.label}」（入弃牌堆），新建筑「${neu.label}」放到原格子`
    );
  } else {
    pushLog(
      game,
      `${player.name} 主动弃置${wasBuilt ? '已建' : '未建'}「${b.label}」` +
        (slotKeep != null
          ? `（格子 ${slotLabel(slotKeep)}）`
          : '') +
        '（入弃牌堆）'
    );
  }
  return { ok: true };
}

function actDiscardFunc(game, player, payload) {
  const cardId = payload.cardId;
  const idx = player.funcCards.findIndex((c) => c.id === cardId);
  if (idx < 0) return { ok: false, error: '功能卡不存在' };
  const [card] = player.funcCards.splice(idx, 1);
  pushToDiscard(game, 'function', card);
  if (player.funcCards.length <= MAX_FUNC_HAND) {
    player.pendingDiscardFunc = false;
  }
  pushLog(game, `${player.name} 弃置功能卡「${card.label}」（入弃牌堆）`);
  return { ok: true };
}

function countBuiltExchanges(player) {
  return (player.buildings || []).filter(
    (b) => b.built && b.buildType === 'exchange'
  ).length;
}

/**
 * 交易所兑换率：持有 1→4换1，2→3换1，3→2换1，≥4→1换1
 * 每个玩家独立按自己已建交易所数量计算。
 */
function exchangeCostN(exchangeCount) {
  const n = Number(exchangeCount) || 0;
  if (n <= 0) return null;
  if (n === 1) return 4;
  if (n === 2) return 3;
  if (n === 3) return 2;
  return 1; // 4 座及以上
}

function actExchange(game, player, payload) {
  const exCount = countBuiltExchanges(player);
  const need = exchangeCostN(exCount);
  if (!need) return { ok: false, error: '没有已建造的交易所' };
  const from = payload.from;
  const to = payload.to;
  if (!RESOURCES.includes(from) || !RESOURCES.includes(to)) {
    return { ok: false, error: '资源类型无效' };
  }
  if ((player.resources[from] || 0) < need) {
    return {
      ok: false,
      error: `需要 ${need} 个相同的${RESOURCE_LABELS[from]}（当前持有 ${exCount} 座交易所）`,
    };
  }
  player.resources[from] -= need;
  player.resources[to] = (player.resources[to] || 0) + 1;
  pushLog(
    game,
    `${player.name} 用交易所（${exCount}座，${need}换1）：${need}${RESOURCE_LABELS[from]} → 1${RESOURCE_LABELS[to]}`
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
  const anytime = ['remoteDice', 'exile', 'redraw', 'banditRaid', 'expand'];
  const settleOnly = ['buildHouse'];
  const roundEndOnly = ['breed', 'harvest'];

  if (anytime.includes(ft)) {
    // ok any non-over phase
  } else if (settleOnly.includes(ft)) {
    if (game.phase !== 'settle_act' && game.phase !== 'build') {
      return { ok: false, error: '建造房子只能在结算/建造阶段使用' };
    }
  } else if (roundEndOnly.includes(ft)) {
    if (game.phase !== 'round_end') {
      return { ok: false, error: '该功能只能在轮次结束时使用' };
    }
  } else {
    return { ok: false, error: '未知功能' };
  }

  let result;
  if (ft === 'breed') result = useBreed(game, player);
  else if (ft === 'harvest') result = useHarvest(game, player, payload);
  else if (ft === 'remoteDice') result = useRemoteDice(game, player, payload);
  else if (ft === 'exile') result = useExile(game, player, payload);
  else if (ft === 'buildHouse') result = useBuildHouse(game, player);
  else if (ft === 'redraw') result = useRedraw(game, player, payload);
  else if (ft === 'banditRaid') result = useBanditRaid(game, player, payload);
  else if (ft === 'expand') result = useExpand(game, player);
  else return { ok: false, error: '未知功能' };

  if (!result.ok) return result;

  player.funcCards.splice(idx, 1);
  returnFuncToDiscard(game, card);
  pushLog(game, `${player.name} 发动功能「${card.label}」`);

  if (checkWin(game)) return { ok: true };

  // 推进阶段
  if (game.phase === 'settle_act' && game.currentPlayerId === player.id) {
    game.settleActPassed[player.id] = true;
    const next = nextAlive(game, player.id);
    game.currentPlayerId = next ? next.id : player.id;
    ensureSettleActPlayer(game);
  } else if (game.phase === 'build' && game.currentPlayerId === player.id) {
    afterBuildAction(game, player.id, true);
  } else if (game.phase === 'round_end' && game.currentPlayerId === player.id) {
    // 可继续用或之后 pass；不强制 pass
  }

  return { ok: true };
}

function useBreed(game, player) {
  if (player.villagers >= MAX_VILLAGERS) {
    return { ok: false, error: `村民已达上限 ${MAX_VILLAGERS}` };
  }
  const cost = player.villagers; // 第一次 3（初始村民数）
  if ((player.resources.food || 0) < cost) {
    return { ok: false, error: `需要 ${cost} 食物` };
  }
  player.resources.food -= cost;
  player.villagers += 1;
  pushLog(
    game,
    `${player.name} 繁殖村民（-${cost} 食物），村民 ${player.villagers}`
  );
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
  pushLog(game, `${player.name} 遥控骰子 → [${dice.join(', ')}]`);
  return { ok: true };
}

function useExile(game, player, payload) {
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
  slotW[targetId] -= 1;
  if (slotW[targetId] <= 0) delete slotW[targetId];
  game.board[area].workers[number] = slotW;
  target.dispatched = Math.max(0, target.dispatched - 1);
  return { ok: true };
}

/** 强盗来袭：在指定大区数字格放置 2 枚中立骰子（无消耗，参与抵消与名次） */
function useBanditRaid(game, player, payload) {
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

function useBuildHouse(game, player) {
  const cost = { wood: 4, stone: 3, iron: 2 };
  if (!canPay(player.resources, cost)) {
    return { ok: false, error: '需要 4木 3石 2铁' };
  }
  pay(player.resources, cost);
  player.score += 1;
  pushLog(
    game,
    `${player.name} 建造房子，+1 分（当前 ${playerScore(player)} 分）`
  );
  return { ok: true };
}

function useExpand(game, player) {
  player.expandSlots = (Number(player.expandSlots) || 0) + 1;
  pushLog(
    game,
    `${player.name} 扩建：建筑区 +1 无数字格（建筑上限 ${maxBuildingsFor(player)}）`
  );
  return { ok: true };
}

function useRedraw(game, player, payload) {
  const deck = payload.deck; // 'function' | 'building'
  if (deck === 'function') {
    const card = drawOne(game, 'function');
    if (!card) return { ok: false, error: '功能卡堆与弃牌堆都已空' };
    receiveFunctionCard(game, player, card);
    return { ok: true };
  }
  if (deck === 'building') {
    const card = drawOne(game, 'building');
    if (!card) return { ok: false, error: '建筑卡堆与弃牌堆都已空' };
    if (player.buildings.length >= maxBuildingsFor(player)) {
      player.pendingDiscardBuild = {
        newCard: { ...card, slot: null, built: false, workers: 0 },
      };
    } else {
      player.buildings.push({
        ...card,
        slot: null,
        built: false,
        workers: 0,
      });
    }
    return { ok: true };
  }
  return { ok: false, error: '请选择 function 或 building 卡堆' };
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
    if (!tiles.length && !Object.keys(workers).length) {
      slots.push({ number: num, tiles: [], workers: {} });
      continue;
    }
    slots.push({ number: num, tiles, workers });
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
    board: {
      resource: publicArea(game.board.resource),
      function: publicArea(game.board.function),
      building: publicArea(game.board.building),
    },
    decksLeft: {
      resource: game.resourceDeck.length,
      function: game.functionDeck.length,
      building: game.buildingDeck.length,
    },
    discardsLeft: {
      resource: (game.resourceDiscard || []).length,
      function: (game.functionDiscard || []).length,
      building: (game.buildingDiscard || []).length,
    },
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
          }
        : null,
    remoteDiceMode: Boolean(
      game.phase === 'produce' &&
        game.remoteDiceMode &&
        game.currentPlayerId === viewerId
    ),
    lastSettle: publicLastSettle(game.lastSettle, viewerId),
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
        dispatched: p.dispatched,
        idle: idleVillagers(p),
        resources: cloneRes(p.resources),
        score: playerScore(p),
        roundGained: p.roundGained,
        funcCount: p.funcCards.length,
        // 功能手牌仅本人可见；他人只看数量（暗置卡亦同）
        funcCards: isMe
          ? p.funcCards.map((c) => ({
              id: c.id,
              funcType: c.funcType,
              label: c.label,
              faceDown: Boolean(c.faceDown),
            }))
          : [],
        buildings: p.buildings.map((b) => publicBuilding(b, isMe)),
        expandSlots: Number(p.expandSlots) || 0,
        maxBuildings: maxBuildingsFor(p),
        pendingDiscardFunc: isMe ? p.pendingDiscardFunc : false,
        pendingDiscardBuild: isMe ? p.pendingDiscardBuild : null,
        pendingEfficiencyBonus: isMe
          ? Number(p.pendingEfficiencyBonus) || 0
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
          pendingEfficiencyBonus: Number(me.pendingEfficiencyBonus) || 0,
        }
      : null,
  };
}

function canPlayerAct(game, player) {
  if (!player || player.left || game.over) return false;
  if (player.pendingDiscardFunc || player.pendingDiscardBuild) return true;
  if ((player.pendingEfficiencyBonus || 0) > 0) return true;
  if (hasPendingPlacement(player)) return true;
  if (game.phase === 'init_roll') {
    return game.initRolls[player.id] == null;
  }
  if (game.phase === 'init_announce') {
    return false;
  }
  if (game.currentPlayerId !== player.id) {
    // 随时：交易所 / anytime 功能
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
  // 必须处理弃牌的人
  const pending = alivePlayers(game)
    .filter(
      (p) =>
        p.pendingDiscardFunc ||
        p.pendingDiscardBuild ||
        (p.pendingEfficiencyBonus || 0) > 0 ||
        hasPendingPlacement(p)
    )
    .map((p) => p.id);
  if (pending.length) {
    // 当前玩家优先
    if (game.currentPlayerId && pending.includes(game.currentPlayerId)) {
      return [game.currentPlayerId];
    }
    return pending.slice(0, 1);
  }
  if (
    ['produce', 'settle_act', 'build', 'round_end'].includes(game.phase) &&
    game.currentPlayerId
  ) {
    return [game.currentPlayerId];
  }
  return [];
}

function forceTimeout(game, playerId) {
  const p = playerById(game, playerId);
  if (!p || game.over) return { ok: false, error: '无法超时处理' };

  if (p.pendingDiscardFunc && p.funcCards.length > MAX_FUNC_HAND) {
    return applyAction(game, playerId, {
      type: 'discardFunc',
      payload: { cardId: p.funcCards[p.funcCards.length - 1].id },
    });
  }
  if (p.pendingDiscardBuild && p.buildings.length) {
    // 超时优先弃未建，否则弃任意一张腾位
    const pick =
      p.buildings.find((b) => !b.built) || p.buildings[0];
    return applyAction(game, playerId, {
      type: 'discardUnbuilt',
      payload: { buildingId: pick.id },
    });
  }
  if ((p.pendingEfficiencyBonus || 0) > 0) {
    const alloc = emptyRes();
    alloc.wood = Number(p.pendingEfficiencyBonus) || 0;
    return applyAction(game, playerId, {
      type: 'allocateEfficiency',
      payload: { alloc },
    });
  }
  const unplaced = (p.buildings || []).find((b) => !b.built && b.slot == null);
  if (unplaced) {
    // 自动放到第一个空位
    for (const slot of personalSlotsFor(p)) {
      if (isNoneSlot(slot) && unplaced.buildType === 'produce') continue;
      if (p.buildings.some((b) => b.slot === slot)) continue;
      return applyAction(game, playerId, {
        type: 'placeBuildingSlot',
        payload: { buildingId: unplaced.id, slot },
      });
    }
  }

  if (game.phase === 'init_roll') {
    return applyAction(game, playerId, { type: 'initRoll', payload: {} });
  }
  if (game.phase === 'produce' && game.currentPlayerId === playerId) {
    if (game.awaitingProduceRoll) {
      return applyAction(game, playerId, { type: 'produceRoll', payload: {} });
    }
    return applyAction(game, playerId, { type: 'voidSkip', payload: {} });
  }
  if (
    (game.phase === 'settle_act' ||
      game.phase === 'build' ||
      game.phase === 'round_end') &&
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
    } else if (game.phase === 'build') {
      game.buildPassed[playerId] = true;
      afterBuildAction(game, playerId, false);
    } else if (game.phase === 'round_end') {
      game.roundEndPassed[playerId] = true;
      const next = nextAlive(game, playerId);
      game.currentPlayerId = next ? next.id : null;
      ensureRoundEndPlayer(game);
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
  INIT_ANNOUNCE_MS,
  // 测试导出
  cancelEqualCounts,
  playerScore,
  exchangeCostN,
  countBuiltExchanges,
  WIN_SCORE,
};
