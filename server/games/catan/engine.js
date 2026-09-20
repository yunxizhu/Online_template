'use strict';

const {
  RESOURCES,
  createBoard,
  emptyResources,
  countResources,
  cloneResources,
  addResources,
  subResources,
  hasResources,
} = require('./board');

const COST = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  dev: { wool: 1, grain: 1, ore: 1 },
};

const DEV_BAG = [
  ...Array(14).fill('knight'),
  ...Array(5).fill('victory'),
  ...Array(2).fill('roadBuilding'),
  ...Array(2).fill('yearOfPlenty'),
  ...Array(2).fill('monopoly'),
];

const MAX_ROADS = 15;
const MAX_SETTLEMENTS = 5;
const MAX_CITIES = 4;
const VP_TO_WIN = 10;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pushLog(game, text) {
  game.log.push({ at: Date.now(), text });
  if (game.log.length > 60) game.log.shift();
}

function playerById(game, id) {
  return game.players.find((p) => p.id === id) || null;
}

function currentPlayer(game) {
  return game.players[game.currentPlayerIndex] || null;
}

function isCurrent(game, playerId) {
  const p = currentPlayer(game);
  return p && p.id === playerId;
}

function buildingAt(game, vertexId) {
  return game.buildings[vertexId] || null;
}

function roadAt(game, edgeId) {
  return game.roads[edgeId] || null;
}

function settlementCount(game, playerId) {
  return Object.values(game.buildings).filter(
    (b) => b.playerId === playerId && b.kind === 'settlement'
  ).length;
}

function cityCount(game, playerId) {
  return Object.values(game.buildings).filter(
    (b) => b.playerId === playerId && b.kind === 'city'
  ).length;
}

function roadCount(game, playerId) {
  return Object.values(game.roads).filter((r) => r.playerId === playerId).length;
}

function vertexAdjacentToOwnRoad(game, vertexId, playerId) {
  const v = game.board.vertices[vertexId];
  if (!v) return false;
  for (const nb of v.neighbors) {
    const eid = edgeIdOf(vertexId, nb);
    const road = roadAt(game, eid);
    if (road && road.playerId === playerId) return true;
  }
  return false;
}

function edgeIdOf(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function canPlaceSettlement(game, playerId, vertexId, { setup }) {
  if (!game.board.vertices[vertexId]) return '无效顶点';
  if (buildingAt(game, vertexId)) return '该位置已有建筑';
  const v = game.board.vertices[vertexId];
  for (const nb of v.neighbors) {
    if (buildingAt(game, nb)) return '与其他定居点距离过近';
  }
  if (!setup) {
    if (settlementCount(game, playerId) >= MAX_SETTLEMENTS) return '定居点已用尽';
    if (!vertexAdjacentToOwnRoad(game, vertexId, playerId)) {
      return '定居点须连接自己的道路';
    }
  }
  return null;
}

function edgeTouchesPlayer(game, edgeId, playerId) {
  const e = game.board.edges[edgeId];
  if (!e) return false;
  for (const vid of e.vertices) {
    const b = buildingAt(game, vid);
    if (b && b.playerId === playerId) return true;
    const v = game.board.vertices[vid];
    for (const nb of v.neighbors) {
      const eid = edgeIdOf(vid, nb);
      if (eid === edgeId) continue;
      const road = roadAt(game, eid);
      if (road && road.playerId === playerId) return true;
    }
  }
  return false;
}

function canPlaceRoad(game, playerId, edgeId, { setup, free }) {
  if (!game.board.edges[edgeId]) return '无效边';
  if (roadAt(game, edgeId)) return '该处已有道路';
  if (roadCount(game, playerId) >= MAX_ROADS) return '道路已用尽';
  if (!edgeTouchesPlayer(game, edgeId, playerId)) {
    return '道路须连接自己的道路或建筑';
  }
  if (setup) {
    // 初始道路须紧贴刚放下的定居点
    const last = game.setupLastSettlement;
    if (!last || last.playerId !== playerId) return '请先放置定居点';
    const e = game.board.edges[edgeId];
    if (!e.vertices.includes(last.vertexId)) return '道路须紧贴刚放置的定居点';
  }
  if (!setup && !free) {
    if (!hasResources(playerById(game, playerId).resources, COST.road)) {
      return '资源不足';
    }
  }
  return null;
}

function playerPorts(game, playerId) {
  const owned = new Set();
  for (const [vid, b] of Object.entries(game.buildings)) {
    if (b.playerId === playerId) owned.add(vid);
  }
  const ports = [];
  for (const p of game.board.ports) {
    if (p.vertices.some((v) => owned.has(v))) ports.push(p);
  }
  return ports;
}

function bestBankRate(game, playerId, giveResource) {
  let rate = 4;
  for (const p of playerPorts(game, playerId)) {
    if (p.kind === 'any' && p.rate < rate) rate = p.rate;
    if (p.kind === giveResource && p.rate < rate) rate = p.rate;
  }
  return rate;
}

/** 最长连续道路（遇敌方建筑截断） */
function longestRoadLength(game, playerId) {
  const myEdges = Object.entries(game.roads)
    .filter(([, r]) => r.playerId === playerId)
    .map(([id]) => id);
  if (myEdges.length === 0) return 0;

  const adj = new Map(); // vertex -> edges
  for (const eid of myEdges) {
    const e = game.board.edges[eid];
    for (const vid of e.vertices) {
      if (!adj.has(vid)) adj.set(vid, []);
      adj.get(vid).push(eid);
    }
  }

  function blocked(vid, fromPlayer) {
    const b = buildingAt(game, vid);
    return b && b.playerId !== fromPlayer;
  }

  let best = 0;

  function dfs(eid, vid, visited) {
    best = Math.max(best, visited.size);
    if (blocked(vid, playerId)) return;
    const nextEdges = adj.get(vid) || [];
    for (const ne of nextEdges) {
      if (visited.has(ne)) continue;
      const edge = game.board.edges[ne];
      const nextVid = edge.vertices[0] === vid ? edge.vertices[1] : edge.vertices[0];
      visited.add(ne);
      dfs(ne, nextVid, visited);
      visited.delete(ne);
    }
  }

  for (const eid of myEdges) {
    const e = game.board.edges[eid];
    for (const start of e.vertices) {
      const visited = new Set([eid]);
      const other = e.vertices[0] === start ? e.vertices[1] : e.vertices[0];
      // 从 start 出发经过 eid 到 other，再继续
      if (!blocked(start, playerId)) {
        dfs(eid, other, visited);
      }
    }
  }
  return best;
}

function updateLongestRoad(game) {
  let bestLen = 0;
  let bestId = null;
  for (const p of game.players) {
    const len = longestRoadLength(game, p.id);
    p.roadLength = len;
    if (len > bestLen) {
      bestLen = len;
      bestId = p.id;
    } else if (len === bestLen) {
      bestId = null; // 并列不转移，下面单独处理
    }
  }
  // 重新扫：持有者若仍最长则保留；否则给唯一最长且 >=5 者
  const holder = game.longestRoadPlayerId;
  if (holder) {
    const holderLen = playerById(game, holder)?.roadLength || 0;
    if (holderLen >= 5) {
      const rivals = game.players.filter(
        (p) => p.id !== holder && p.roadLength > holderLen
      );
      if (rivals.length === 1) {
        game.longestRoadPlayerId = rivals[0].id;
      } else if (rivals.length === 0 && holderLen >= 5) {
        // keep
      } else if (rivals.length > 1) {
        // 多人并列超过：取消
        game.longestRoadPlayerId = null;
      }
    } else {
      game.longestRoadPlayerId = null;
    }
  }
  if (!game.longestRoadPlayerId) {
    const candidates = game.players.filter((p) => p.roadLength >= 5);
    if (candidates.length === 0) {
      game.longestRoadPlayerId = null;
    } else {
      const max = Math.max(...candidates.map((p) => p.roadLength));
      const tops = candidates.filter((p) => p.roadLength === max);
      game.longestRoadPlayerId = tops.length === 1 ? tops[0].id : null;
    }
  }
}

function updateLargestArmy(game) {
  const holder = game.largestArmyPlayerId;
  if (holder) {
    const hp = playerById(game, holder);
    const holderKnights = hp ? hp.knightsPlayed : 0;
    if (holderKnights >= 3) {
      const rivals = game.players.filter(
        (p) => p.id !== holder && p.knightsPlayed > holderKnights
      );
      if (rivals.length === 1) game.largestArmyPlayerId = rivals[0].id;
      else if (rivals.length > 1) game.largestArmyPlayerId = null;
    } else {
      game.largestArmyPlayerId = null;
    }
  }
  if (!game.largestArmyPlayerId) {
    const candidates = game.players.filter((p) => p.knightsPlayed >= 3);
    if (!candidates.length) {
      game.largestArmyPlayerId = null;
    } else {
      const max = Math.max(...candidates.map((p) => p.knightsPlayed));
      const tops = candidates.filter((p) => p.knightsPlayed === max);
      game.largestArmyPlayerId = tops.length === 1 ? tops[0].id : null;
    }
  }
}

function publicVp(game, p) {
  let vp = 0;
  for (const b of Object.values(game.buildings)) {
    if (b.playerId !== p.id) continue;
    vp += b.kind === 'city' ? 2 : 1;
  }
  if (game.longestRoadPlayerId === p.id) vp += 2;
  if (game.largestArmyPlayerId === p.id) vp += 2;
  return vp;
}

function totalVp(game, p) {
  return publicVp(game, p) + (p.victoryCards || 0);
}

function checkWin(game, playerId) {
  const p = playerById(game, playerId);
  if (!p) return;
  if (totalVp(game, p) >= VP_TO_WIN) {
    game.phase = 'gameOver';
    game.over = true;
    game.winnerId = p.id;
    pushLog(game, `${p.name} 达到 ${VP_TO_WIN} 胜利点，获胜！`);
  }
}

function giveAdjacentResources(game, playerId, vertexId) {
  const p = playerById(game, playerId);
  const v = game.board.vertices[vertexId];
  if (!p || !v) return;
  const gained = emptyResources();
  for (const hid of v.hexIds) {
    const tile = game.board.tiles[hid];
    if (!tile || !tile.resource) continue;
    if (tile.id === game.board.robberHexId) continue;
    gained[tile.resource] += 1;
  }
  addResources(p.resources, gained);
  const parts = RESOURCES.filter((k) => gained[k]).map((k) => `${resLabel(k)}×${gained[k]}`);
  if (parts.length) pushLog(game, `${p.name} 第二定居点获得 ${parts.join('、')}`);
}

function resLabel(k) {
  return { brick: '砖', lumber: '木', wool: '羊', grain: '麦', ore: '矿' }[k] || k;
}

function produce(game, roll) {
  for (const tile of game.board.tiles) {
    if (tile.number !== roll) continue;
    if (tile.id === game.board.robberHexId) continue;
    if (!tile.resource) continue;
    for (const [vid, b] of Object.entries(game.buildings)) {
      const v = game.board.vertices[vid];
      if (!v.hexIds.includes(tile.id)) continue;
      const p = playerById(game, b.playerId);
      if (!p) continue;
      const n = b.kind === 'city' ? 2 : 1;
      p.resources[tile.resource] += n;
    }
  }
}

function advanceSetup(game) {
  // setupOrder: 0..n-1 then n-1..0
  const n = game.players.length;
  game.setupStep += 1;
  if (game.setupStep >= n * 2) {
    game.phase = 'roll';
    game.currentPlayerIndex = 0;
    game.setupLastSettlement = null;
    pushLog(game, '初始布置结束，游戏开始');
    return;
  }
  if (game.setupStep < n) {
    game.currentPlayerIndex = game.setupStep;
  } else {
    game.currentPlayerIndex = n * 2 - 1 - game.setupStep;
  }
  game.phase = 'setupSettlement';
  game.setupLastSettlement = null;
}

function placeSettlement(game, playerId, vertexId, setup) {
  const err = canPlaceSettlement(game, playerId, vertexId, { setup });
  if (err) return { ok: false, error: err };
  const p = playerById(game, playerId);
  game.buildings[vertexId] = { playerId, kind: 'settlement' };
  if (!setup) {
    subResources(p.resources, COST.settlement);
  }
  pushLog(game, `${p.name} 建造了定居点`);
  if (setup) {
    game.setupLastSettlement = { playerId, vertexId };
    game.phase = 'setupRoad';
    if (game.setupStep >= game.players.length) {
      giveAdjacentResources(game, playerId, vertexId);
    }
  } else {
    updateLongestRoad(game);
    checkWin(game, playerId);
  }
  return { ok: true };
}

function placeRoad(game, playerId, edgeId, { setup, free }) {
  const err = canPlaceRoad(game, playerId, edgeId, { setup, free });
  if (err) return { ok: false, error: err };
  const p = playerById(game, playerId);
  game.roads[edgeId] = { playerId };
  if (!setup && !free) subResources(p.resources, COST.road);
  pushLog(game, `${p.name} 修建了道路`);
  updateLongestRoad(game);
  if (setup) {
    advanceSetup(game);
  } else if (game.roadBuildingLeft > 0 && game.roadBuildingPlayerId === playerId) {
    game.roadBuildingLeft -= 1;
    if (game.roadBuildingLeft <= 0) {
      game.roadBuildingPlayerId = null;
    }
  }
  checkWin(game, playerId);
  return { ok: true };
}

function startDiscardPhase(game) {
  game.pendingDiscards = {};
  let any = false;
  for (const p of game.players) {
    const total = countResources(p.resources);
    if (total > 7) {
      game.pendingDiscards[p.id] = Math.floor(total / 2);
      any = true;
    }
  }
  if (any) {
    game.phase = 'discard';
    pushLog(game, '有人资源超过 7，需要弃牌');
  } else {
    game.phase = 'robber';
  }
}

function afterAllDiscarded(game) {
  if (Object.keys(game.pendingDiscards).length === 0) {
    game.phase = 'robber';
  }
}

function stealRandom(game, fromId, toId) {
  const from = playerById(game, fromId);
  const to = playerById(game, toId);
  if (!from || !to) return null;
  const pool = [];
  for (const k of RESOURCES) {
    for (let i = 0; i < (from.resources[k] || 0); i++) pool.push(k);
  }
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  from.resources[pick] -= 1;
  to.resources[pick] += 1;
  return pick;
}

function playersAdjacentToHex(game, hexId) {
  const ids = new Set();
  for (const [vid, b] of Object.entries(game.buildings)) {
    const v = game.board.vertices[vid];
    if (v.hexIds.includes(hexId)) ids.add(b.playerId);
  }
  return [...ids];
}

function createGameState(room) {
  const board = createBoard();
  const players = room.players.map((p, i) => ({
    id: p.id,
    name: p.name,
    tag: p.tag || null,
    colorIndex: i,
    resources: emptyResources(),
    devCards: [],
    newDevCards: [],
    knightsPlayed: 0,
    victoryCards: 0,
    roadLength: 0,
  }));

  const game = {
    type: 'catan',
    board,
    buildings: {},
    roads: {},
    players,
    phase: 'setupSettlement',
    currentPlayerIndex: 0,
    setupStep: 0,
    setupLastSettlement: null,
    lastRoll: null,
    pendingDiscards: {},
    trade: null,
    roadBuildingLeft: 0,
    roadBuildingPlayerId: null,
    playedDevThisTurn: false,
    longestRoadPlayerId: null,
    largestArmyPlayerId: null,
    over: false,
    winnerId: null,
    log: [],
    devDeck: shuffle(DEV_BAG),
  };

  pushLog(game, '卡坦岛开局：请按座位顺序放置初始定居点与道路');
  return game;
}

function normalizeResMap(obj) {
  const o = emptyResources();
  if (!obj || typeof obj !== 'object') return o;
  for (const k of RESOURCES) {
    const n = Math.floor(Number(obj[k]) || 0);
    o[k] = n > 0 ? n : 0;
  }
  return o;
}

function applyAction(game, playerId, action) {
  if (!game || game.over) return { ok: false, error: '游戏已结束' };
  const type = action && action.type;
  const payload = (action && action.payload) || {};
  const p = playerById(game, playerId);
  if (!p) return { ok: false, error: '玩家不在局中' };

  switch (type) {
    case 'placeSettlement': {
      if (game.phase === 'setupSettlement') {
        if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
        return placeSettlement(game, playerId, String(payload.vertexId || ''), true);
      }
      if (game.phase !== 'main' || game.trade) return { ok: false, error: '当前不能建造' };
      if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
      if (!hasResources(p.resources, COST.settlement)) return { ok: false, error: '资源不足' };
      return placeSettlement(game, playerId, String(payload.vertexId || ''), false);
    }
    case 'placeRoad':
    case 'buildRoad': {
      const edgeId = String(payload.edgeId || '');
      if (game.phase === 'setupRoad') {
        if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
        return placeRoad(game, playerId, edgeId, { setup: true, free: true });
      }
      if (game.phase !== 'main' || game.trade) return { ok: false, error: '当前不能建造' };
      if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
      const free =
        game.roadBuildingLeft > 0 && game.roadBuildingPlayerId === playerId;
      return placeRoad(game, playerId, edgeId, { setup: false, free });
    }
    case 'buildCity': {
      if (game.phase !== 'main' || game.trade) return { ok: false, error: '当前不能建造' };
      if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
      const vertexId = String(payload.vertexId || '');
      const b = buildingAt(game, vertexId);
      if (!b || b.playerId !== playerId || b.kind !== 'settlement') {
        return { ok: false, error: '只能升级自己的定居点' };
      }
      if (cityCount(game, playerId) >= MAX_CITIES) return { ok: false, error: '城市已用尽' };
      if (!hasResources(p.resources, COST.city)) return { ok: false, error: '资源不足' };
      subResources(p.resources, COST.city);
      b.kind = 'city';
      pushLog(game, `${p.name} 升级为城市`);
      checkWin(game, playerId);
      return { ok: true };
    }
    case 'roll': {
      if (game.phase !== 'roll') return { ok: false, error: '现在不能掷骰' };
      if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
      const d1 = 1 + Math.floor(Math.random() * 6);
      const d2 = 1 + Math.floor(Math.random() * 6);
      const total = d1 + d2;
      game.lastRoll = { d1, d2, total };
      pushLog(game, `${p.name} 掷出 ${d1}+${d2}=${total}`);
      if (total === 7) {
        startDiscardPhase(game);
      } else {
        produce(game, total);
        game.phase = 'main';
      }
      return { ok: true };
    }
    case 'discard': {
      if (game.phase !== 'discard') return { ok: false, error: '无需弃牌' };
      const need = game.pendingDiscards[playerId];
      if (!need) return { ok: false, error: '你无需弃牌' };
      const discard = normalizeResMap(payload.resources);
      if (countResources(discard) !== need) {
        return { ok: false, error: `须弃掉 ${need} 张` };
      }
      if (!hasResources(p.resources, discard)) return { ok: false, error: '资源不足' };
      subResources(p.resources, discard);
      delete game.pendingDiscards[playerId];
      pushLog(game, `${p.name} 弃掉了 ${need} 张资源`);
      afterAllDiscarded(game);
      return { ok: true };
    }
    case 'moveRobber': {
      if (game.phase !== 'robber') return { ok: false, error: '现在不能移强盗' };
      if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
      const hexId = Number(payload.hexId);
      if (!Number.isInteger(hexId) || !game.board.tiles[hexId]) {
        return { ok: false, error: '无效地形' };
      }
      if (hexId === game.board.robberHexId) return { ok: false, error: '须移动强盗' };
      game.board.robberHexId = hexId;
      const victims = playersAdjacentToHex(game, hexId).filter((id) => id !== playerId);
      let stealFrom = payload.stealFromId != null ? String(payload.stealFromId) : null;
      if (victims.length === 0) {
        stealFrom = null;
      } else if (stealFrom) {
        if (!victims.includes(stealFrom)) return { ok: false, error: '无法掠夺该玩家' };
      } else if (victims.length === 1) {
        stealFrom = victims[0];
      } else {
        return { ok: false, error: '请选择掠夺对象', needSteal: victims };
      }
      if (stealFrom) {
        const got = stealRandom(game, stealFrom, playerId);
        const victim = playerById(game, stealFrom);
        if (got) {
          pushLog(game, `${p.name} 从 ${victim.name} 处抢走 1 张资源`);
        } else {
          pushLog(game, `${p.name} 移动了强盗（目标无资源）`);
        }
      } else {
        pushLog(game, `${p.name} 移动了强盗`);
      }
      game.phase = 'main';
      return { ok: true };
    }
    case 'buyDev': {
      if (game.phase !== 'main' || game.trade) return { ok: false, error: '当前不能购买' };
      if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
      if (!game.devDeck.length) return { ok: false, error: '发展卡已卖完' };
      if (!hasResources(p.resources, COST.dev)) return { ok: false, error: '资源不足' };
      subResources(p.resources, COST.dev);
      const card = game.devDeck.pop();
      p.newDevCards.push(card);
      if (card === 'victory') {
        p.victoryCards += 1;
        checkWin(game, playerId);
      }
      pushLog(game, `${p.name} 购买了一张发展卡`);
      return { ok: true };
    }
    case 'playKnight': {
      if (game.phase !== 'main' || game.trade) return { ok: false, error: '现在不能出牌' };
      if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
      if (game.playedDevThisTurn) return { ok: false, error: '本回合已出过发展卡' };
      const idx = p.devCards.indexOf('knight');
      if (idx < 0) return { ok: false, error: '没有骑士卡' };
      p.devCards.splice(idx, 1);
      p.knightsPlayed += 1;
      game.playedDevThisTurn = true;
      updateLargestArmy(game);
      pushLog(game, `${p.name} 打出骑士`);
      checkWin(game, playerId);
      game.phase = 'robber';
      return { ok: true };
    }
    case 'playRoadBuilding': {
      if (game.phase !== 'main' || game.trade) return { ok: false, error: '现在不能出牌' };
      if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
      if (game.playedDevThisTurn) return { ok: false, error: '本回合已出过发展卡' };
      const idx = p.devCards.indexOf('roadBuilding');
      if (idx < 0) return { ok: false, error: '没有修路卡' };
      p.devCards.splice(idx, 1);
      game.playedDevThisTurn = true;
      game.roadBuildingLeft = Math.min(2, MAX_ROADS - roadCount(game, playerId));
      game.roadBuildingPlayerId = playerId;
      pushLog(game, `${p.name} 打出道路建设`);
      if (game.roadBuildingLeft <= 0) {
        game.roadBuildingPlayerId = null;
      }
      return { ok: true };
    }
    case 'playYearOfPlenty': {
      if (game.phase !== 'main' || game.trade) return { ok: false, error: '现在不能出牌' };
      if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
      if (game.playedDevThisTurn) return { ok: false, error: '本回合已出过发展卡' };
      const idx = p.devCards.indexOf('yearOfPlenty');
      if (idx < 0) return { ok: false, error: '没有丰收卡' };
      const gain = normalizeResMap(payload.resources);
      if (countResources(gain) !== 2) return { ok: false, error: '须选择 2 份资源' };
      p.devCards.splice(idx, 1);
      game.playedDevThisTurn = true;
      addResources(p.resources, gain);
      pushLog(game, `${p.name} 打出丰收之年`);
      return { ok: true };
    }
    case 'playMonopoly': {
      if (game.phase !== 'main' || game.trade) return { ok: false, error: '现在不能出牌' };
      if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
      if (game.playedDevThisTurn) return { ok: false, error: '本回合已出过发展卡' };
      const idx = p.devCards.indexOf('monopoly');
      if (idx < 0) return { ok: false, error: '没有垄断卡' };
      const resource = String(payload.resource || '');
      if (!RESOURCES.includes(resource)) return { ok: false, error: '无效资源' };
      p.devCards.splice(idx, 1);
      game.playedDevThisTurn = true;
      let taken = 0;
      for (const other of game.players) {
        if (other.id === playerId) continue;
        const n = other.resources[resource] || 0;
        if (n > 0) {
          other.resources[resource] = 0;
          p.resources[resource] += n;
          taken += n;
        }
      }
      pushLog(game, `${p.name} 垄断了 ${resLabel(resource)}（获得 ${taken}）`);
      return { ok: true };
    }
    case 'bankTrade': {
      if (game.phase !== 'main' || game.trade) return { ok: false, error: '现在不能贸易' };
      if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
      const giveRes = String(payload.give || '');
      const wantRes = String(payload.want || '');
      if (!RESOURCES.includes(giveRes) || !RESOURCES.includes(wantRes)) {
        return { ok: false, error: '无效资源' };
      }
      if (giveRes === wantRes) return { ok: false, error: '不能换同种资源' };
      const rate = bestBankRate(game, playerId, giveRes);
      if ((p.resources[giveRes] || 0) < rate) return { ok: false, error: `需要 ${rate} 张 ${resLabel(giveRes)}` };
      p.resources[giveRes] -= rate;
      p.resources[wantRes] += 1;
      pushLog(game, `${p.name} 以 ${rate}:1 向银行换取 ${resLabel(wantRes)}`);
      return { ok: true };
    }
    case 'offerTrade': {
      if (game.phase !== 'main' || game.trade) return { ok: false, error: '现在不能贸易' };
      if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
      const give = normalizeResMap(payload.give);
      const want = normalizeResMap(payload.want);
      if (countResources(give) < 1 || countResources(want) < 1) {
        return { ok: false, error: '报价双方资源不能为空' };
      }
      if (!hasResources(p.resources, give)) return { ok: false, error: '你的资源不足' };
      let toPlayerId = payload.toPlayerId != null ? String(payload.toPlayerId) : null;
      let responders;
      if (toPlayerId) {
        if (toPlayerId === playerId) return { ok: false, error: '不能与自己交易' };
        if (!playerById(game, toPlayerId)) return { ok: false, error: '目标玩家不存在' };
        responders = [toPlayerId];
      } else {
        responders = game.players.filter((x) => x.id !== playerId).map((x) => x.id);
      }
      game.trade = {
        fromId: playerId,
        toPlayerId,
        give,
        want,
        responders,
        rejected: [],
      };
      game.phase = 'tradeResponse';
      pushLog(game, `${p.name} 发起了交易报价`);
      return { ok: true };
    }
    case 'cancelTrade': {
      if (!game.trade || game.trade.fromId !== playerId) {
        return { ok: false, error: '没有可取消的报价' };
      }
      game.trade = null;
      game.phase = 'main';
      pushLog(game, `${p.name} 取消了交易`);
      return { ok: true };
    }
    case 'respondTrade': {
      if (game.phase !== 'tradeResponse' || !game.trade) {
        return { ok: false, error: '没有待处理交易' };
      }
      const trade = game.trade;
      if (!trade.responders.includes(playerId)) {
        return { ok: false, error: '你不是报价对象' };
      }
      const accept = Boolean(payload.accept);
      if (!accept) {
        trade.rejected.push(playerId);
        trade.responders = trade.responders.filter((id) => id !== playerId);
        pushLog(game, `${p.name} 拒绝了交易`);
        if (trade.responders.length === 0) {
          game.trade = null;
          game.phase = 'main';
          pushLog(game, '交易未达成');
        }
        return { ok: true };
      }
      const from = playerById(game, trade.fromId);
      if (!from) return { ok: false, error: '发起方已离开' };
      if (!hasResources(from.resources, trade.give)) {
        game.trade = null;
        game.phase = 'main';
        return { ok: false, error: '发起方资源已不足' };
      }
      if (!hasResources(p.resources, trade.want)) {
        return { ok: false, error: '你的资源不足以完成交易' };
      }
      subResources(from.resources, trade.give);
      addResources(from.resources, trade.want);
      subResources(p.resources, trade.want);
      addResources(p.resources, trade.give);
      pushLog(game, `${from.name} 与 ${p.name} 完成交易`);
      game.trade = null;
      game.phase = 'main';
      return { ok: true };
    }
    case 'endTurn': {
      if (game.phase !== 'main' || game.trade) return { ok: false, error: '现在不能结束回合' };
      if (!isCurrent(game, playerId)) return { ok: false, error: '未轮到你' };
      if (game.roadBuildingLeft > 0 && game.roadBuildingPlayerId === playerId) {
        return { ok: false, error: '请先放完免费道路' };
      }
      // 新卡转入可用
      for (const pl of game.players) {
        if (pl.newDevCards.length) {
          pl.devCards.push(...pl.newDevCards);
          pl.newDevCards = [];
        }
      }
      game.playedDevThisTurn = false;
      game.roadBuildingLeft = 0;
      game.roadBuildingPlayerId = null;
      game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
      game.phase = 'roll';
      game.lastRoll = null;
      const next = currentPlayer(game);
      pushLog(game, `轮到 ${next.name}`);
      return { ok: true };
    }
    default:
      return { ok: false, error: `未知操作: ${type}` };
  }
}

function publicGameState(game, viewerId) {
  if (!game) return null;
  const me = viewerId ? playerById(game, viewerId) : null;

  const legal = {
    settlements: [],
    roads: [],
    cities: [],
    robberHexes: [],
  };

  if (me && !game.over) {
    if (game.phase === 'setupSettlement' && isCurrent(game, viewerId)) {
      for (const vid of Object.keys(game.board.vertices)) {
        if (!canPlaceSettlement(game, viewerId, vid, { setup: true })) {
          legal.settlements.push(vid);
        }
      }
    }
    if (game.phase === 'setupRoad' && isCurrent(game, viewerId)) {
      for (const eid of Object.keys(game.board.edges)) {
        if (!canPlaceRoad(game, viewerId, eid, { setup: true, free: true })) {
          legal.roads.push(eid);
        }
      }
    }
    if (game.phase === 'main' && isCurrent(game, viewerId) && !game.trade) {
      const freeRoad =
        game.roadBuildingLeft > 0 && game.roadBuildingPlayerId === viewerId;
      for (const eid of Object.keys(game.board.edges)) {
        if (!canPlaceRoad(game, viewerId, eid, { setup: false, free: freeRoad })) {
          legal.roads.push(eid);
        }
      }
      if (!freeRoad && hasResources(me.resources, COST.settlement)) {
        for (const vid of Object.keys(game.board.vertices)) {
          if (!canPlaceSettlement(game, viewerId, vid, { setup: false })) {
            legal.settlements.push(vid);
          }
        }
      }
      if (hasResources(me.resources, COST.city)) {
        for (const [vid, b] of Object.entries(game.buildings)) {
          if (b.playerId === viewerId && b.kind === 'settlement') {
            legal.cities.push(vid);
          }
        }
      }
    }
    if (game.phase === 'robber' && isCurrent(game, viewerId)) {
      for (const t of game.board.tiles) {
        if (t.id !== game.board.robberHexId) legal.robberHexes.push(t.id);
      }
    }
  }

  return {
    type: 'catan',
    phase: game.phase,
    over: game.over,
    winnerId: game.winnerId,
    currentPlayerId: currentPlayer(game)?.id || null,
    lastRoll: game.lastRoll,
    longestRoadPlayerId: game.longestRoadPlayerId,
    largestArmyPlayerId: game.largestArmyPlayerId,
    trade: game.trade,
    pendingDiscards: { ...game.pendingDiscards },
    roadBuildingLeft: game.roadBuildingLeft,
    roadBuildingPlayerId: game.roadBuildingPlayerId,
    playedDevThisTurn: game.playedDevThisTurn,
    devDeckLeft: game.devDeck.length,
    board: {
      tiles: game.board.tiles,
      ports: game.board.ports,
      robberHexId: game.board.robberHexId,
      vertices: game.board.vertices,
      edges: game.board.edges,
    },
    buildings: game.buildings,
    roads: game.roads,
    log: game.log.slice(-30),
    legal,
    costs: COST,
    players: game.players.map((pl) => {
      const isMe = viewerId && pl.id === viewerId;
      return {
        id: pl.id,
        name: pl.name,
        colorIndex: pl.colorIndex,
        resourceCount: countResources(pl.resources),
        resources: isMe ? cloneResources(pl.resources) : null,
        devCount: pl.devCards.length + pl.newDevCards.length,
        devCards: isMe ? pl.devCards.slice() : null,
        newDevCards: isMe ? pl.newDevCards.slice() : null,
        knightsPlayed: pl.knightsPlayed,
        victoryCards: isMe ? pl.victoryCards : undefined,
        publicVp: publicVp(game, pl),
        totalVp: isMe ? totalVp(game, pl) : publicVp(game, pl),
        roadLength: pl.roadLength,
        hasLongestRoad: game.longestRoadPlayerId === pl.id,
        hasLargestArmy: game.largestArmyPlayerId === pl.id,
        discardNeed: game.pendingDiscards[pl.id] || 0,
      };
    }),
    you: me
      ? {
          id: me.id,
          canRoll: game.phase === 'roll' && isCurrent(game, viewerId),
          canEndTurn:
            game.phase === 'main' &&
            isCurrent(game, viewerId) &&
            !game.trade &&
            !(game.roadBuildingLeft > 0 && game.roadBuildingPlayerId === viewerId),
          canBuyDev:
            game.phase === 'main' &&
            isCurrent(game, viewerId) &&
            !game.trade &&
            game.devDeck.length > 0 &&
            hasResources(me.resources, COST.dev),
          bankRates: Object.fromEntries(
            RESOURCES.map((r) => [r, bestBankRate(game, viewerId, r)])
          ),
        }
      : null,
  };
}

function getActingPlayerIds(game) {
  if (!game || game.over) return [];
  if (game.phase === 'discard') {
    return Object.keys(game.pendingDiscards);
  }
  if (game.phase === 'tradeResponse' && game.trade) {
    return game.trade.responders.slice();
  }
  const cur = currentPlayer(game);
  if (!cur) return [];
  if (
    game.phase === 'setupSettlement' ||
    game.phase === 'setupRoad' ||
    game.phase === 'roll' ||
    game.phase === 'robber' ||
    game.phase === 'main'
  ) {
    return [cur.id];
  }
  return [];
}

function randomDiscardHalf(game, playerId) {
  const p = playerById(game, playerId);
  const need = game.pendingDiscards[playerId];
  if (!p || !need) return { ok: true };
  const pool = [];
  for (const k of RESOURCES) {
    for (let i = 0; i < (p.resources[k] || 0); i++) pool.push(k);
  }
  shuffle(pool);
  const discard = emptyResources();
  for (let i = 0; i < need && i < pool.length; i++) discard[pool[i]] += 1;
  return applyAction(game, playerId, { type: 'discard', payload: { resources: discard } });
}

function forceTimeout(game, playerId) {
  if (!game || game.over) return { ok: true };
  const p = playerById(game, playerId);
  if (!p) return { ok: true };

  if (game.phase === 'discard' && game.pendingDiscards[playerId]) {
    return randomDiscardHalf(game, playerId);
  }

  if (game.phase === 'tradeResponse' && game.trade?.responders.includes(playerId)) {
    return applyAction(game, playerId, { type: 'respondTrade', payload: { accept: false } });
  }

  if (!isCurrent(game, playerId)) return { ok: true };

  if (game.phase === 'setupSettlement') {
    for (const vid of Object.keys(game.board.vertices)) {
      const r = placeSettlement(game, playerId, vid, true);
      if (r.ok) return r;
    }
    return { ok: false, error: '无合法定居点' };
  }
  if (game.phase === 'setupRoad') {
    for (const eid of Object.keys(game.board.edges)) {
      const r = placeRoad(game, playerId, eid, { setup: true, free: true });
      if (r.ok) return r;
    }
    return { ok: false, error: '无合法道路' };
  }
  if (game.phase === 'roll') {
    return applyAction(game, playerId, { type: 'roll', payload: {} });
  }
  if (game.phase === 'robber') {
    const desert = game.board.tiles.find((t) => t.terrain === 'desert');
    let hexId = desert ? desert.id : 0;
    if (hexId === game.board.robberHexId) {
      hexId = game.board.tiles.find((t) => t.id !== game.board.robberHexId)?.id ?? 0;
    }
    const victims = playersAdjacentToHex(game, hexId).filter((id) => id !== playerId);
    return applyAction(game, playerId, {
      type: 'moveRobber',
      payload: { hexId, stealFromId: victims[0] || null },
    });
  }
  if (game.phase === 'main') {
    if (game.trade && game.trade.fromId === playerId) {
      return applyAction(game, playerId, { type: 'cancelTrade', payload: {} });
    }
    if (game.roadBuildingLeft > 0 && game.roadBuildingPlayerId === playerId) {
      for (const eid of Object.keys(game.board.edges)) {
        const r = placeRoad(game, playerId, eid, { setup: false, free: true });
        if (r.ok) {
          if (game.roadBuildingLeft > 0) {
            // place another if possible
            for (const eid2 of Object.keys(game.board.edges)) {
              const r2 = placeRoad(game, playerId, eid2, { setup: false, free: true });
              if (r2.ok) break;
            }
          }
          return applyAction(game, playerId, { type: 'endTurn', payload: {} });
        }
      }
      game.roadBuildingLeft = 0;
      game.roadBuildingPlayerId = null;
    }
    return applyAction(game, playerId, { type: 'endTurn', payload: {} });
  }
  return { ok: true };
}

function onPlayerQuit(game, playerId) {
  if (!game || game.over) return;
  const idx = game.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return;
  const name = game.players[idx].name;
  game.players.splice(idx, 1);
  pushLog(game, `${name} 离开了游戏`);

  // 清理建筑/道路归属保留为孤儿？移除该玩家建筑道路
  for (const vid of Object.keys(game.buildings)) {
    if (game.buildings[vid].playerId === playerId) delete game.buildings[vid];
  }
  for (const eid of Object.keys(game.roads)) {
    if (game.roads[eid].playerId === playerId) delete game.roads[eid];
  }
  if (game.longestRoadPlayerId === playerId) game.longestRoadPlayerId = null;
  if (game.largestArmyPlayerId === playerId) game.largestArmyPlayerId = null;
  delete game.pendingDiscards[playerId];

  if (game.trade) {
    if (game.trade.fromId === playerId) {
      game.trade = null;
      if (game.phase === 'tradeResponse') game.phase = 'main';
    } else {
      game.trade.responders = game.trade.responders.filter((id) => id !== playerId);
      if (game.trade.responders.length === 0) {
        game.trade = null;
        game.phase = 'main';
      }
    }
  }

  if (game.players.length < 3) {
    game.over = true;
    game.phase = 'gameOver';
    game.winnerId = null;
    pushLog(game, '玩家不足 3 人，游戏结束');
    return;
  }

  if (game.currentPlayerIndex >= game.players.length) {
    game.currentPlayerIndex = 0;
  } else if (idx < game.currentPlayerIndex) {
    game.currentPlayerIndex -= 1;
  } else if (idx === game.currentPlayerIndex) {
    // 当前玩家离开：进入下一位的 roll（若在 setup 则推进）
    if (game.phase.startsWith('setup')) {
      // 简化：跳到下一位 setup
      if (game.currentPlayerIndex >= game.players.length) game.currentPlayerIndex = 0;
      game.phase = 'setupSettlement';
      game.setupLastSettlement = null;
    } else {
      game.phase = 'roll';
      game.playedDevThisTurn = false;
    }
  }

  updateLongestRoad(game);
  updateLargestArmy(game);
  afterAllDiscarded(game);
}

module.exports = {
  createGameState,
  applyAction,
  publicGameState,
  getActingPlayerIds,
  forceTimeout,
  onPlayerQuit,
  COST,
  RESOURCES,
  VP_TO_WIN,
};
