'use strict';

const assert = require('assert');
const {
  forceTimeout,
  createGameState,
  finishInitAnnounce,
  applyAction,
} = require('../engine');
const { decideBotAction } = require('../bot');

function room(n) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: `p${i}`, name: `P${i}` });
  return { players };
}
function fin(g) {
  if (g.phase === 'init_announce') finishInitAnnounce(g);
}

{
  const g = createGameState(room(2));
  fin(g);
  const p = g.players[0];
  g.pendingEventChoice = {
    needChoice: 'gatherNeutrals',
    playerId: p.id,
    label: '围魏',
    toArea: 'resource',
    toNumber: 1,
    number: 1,
  };
  g.board.resource.workers = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  const r = forceTimeout(g, p.id);
  assert.ok(r.skippedEvent);
  assert.ok(!g.pendingEventChoice);
  console.log('✓ gather empty → skip');
}

{
  const g = createGameState(room(2));
  fin(g);
  const p = g.players[0];
  g.pendingEventChoice = {
    needChoice: 'recallDie',
    playerId: p.id,
    label: '召回',
    excludeArea: 'resource',
    excludeNumber: 1,
    justPlacedCount: 1,
    justPlacedEnhanced: 0,
  };
  g.board.resource.workers = {
    1: { [p.id]: 1 },
    2: {},
    3: {},
    4: {},
    5: {},
    6: {},
  };
  g.board.resource.boosts = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  forceTimeout(g, p.id);
  assert.ok(!g.pendingEventChoice);
  console.log('✓ recall none → skip');
}

{
  const g = createGameState(room(2));
  fin(g);
  const t = g.players[0];
  g.pendingIllegalBuild = { targetId: t.id, actorId: g.players[1].id };
  t.buildings = [];
  forceTimeout(g, t.id);
  assert.ok(!g.pendingIllegalBuild);
  console.log('✓ illegal no building → clear');
}

{
  const g = createGameState(room(2));
  fin(g);
  const t = g.players[0];
  g.pendingRobberyPick = { targetId: t.id, options: [] };
  forceTimeout(g, t.id);
  assert.ok(!g.pendingRobberyPick);
  console.log('✓ robbery no options → clear');
}

{
  const g = createGameState(room(2));
  fin(g);
  const b = g.players[0];
  g.phase = 'produce';
  g.currentPlayerId = b.id;
  g.awaitingProduceRoll = false;
  g.dice[b.id] = [];
  b.dispatched = b.villagers;
  const r = forceTimeout(g, b.id);
  assert.ok(r && r.ok);
  console.log('✓ produce no dice → advance', g.phase);
}

{
  const g = createGameState(room(2));
  fin(g);
  const bot = g.players[0];
  g.phase = 'produce';
  g.currentPlayerId = bot.id;
  g.awaitingProduceRoll = false;
  g.board.resource.tiles = [];
  for (let n = 1; n <= 6; n++) {
    g.board.resource.tiles.push({
      id: `r${n}`,
      kind: 'resource',
      resource: 'wood',
      large: 2,
      small: 1,
      number: n,
      label: '木',
    });
  }
  g.board.special.tiles = [
    { id: 's1', kind: 'function', funcType: 'enhance', label: '强化', number: 1 },
  ];
  g.board.resource.environments = {
    1: null,
    2: null,
    3: null,
    4: null,
    5: { id: 'e5', envType: 'teleport', label: '传送', trigger: 'dispatch' },
    6: null,
  };
  g.board.resource.workers = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  g.board.resource.boosts = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  bot.villagers = 5;
  bot.dispatched = 0;
  bot.enhancedDice = 1;
  bot.enhancedPlaced = 0;
  g.dice[bot.id] = [5, 5, 3];
  g.diceBoosted = { [bot.id]: [true, false, false] };
  let r = applyAction(g, bot.id, {
    type: 'placeDice',
    payload: { area: 'resource', face: 5, count: 2 },
  });
  assert.ok(r.ok);
  for (let i = 0; i < 4 && g.pendingEventChoice; i++) {
    const a = decideBotAction(g, bot.id, 'hard');
    if (!a) {
      forceTimeout(g, bot.id);
      break;
    }
    r = applyAction(g, bot.id, a);
    if (!r.ok) forceTimeout(g, bot.id);
  }
  assert.ok(
    !g.pendingEventChoice || g.pendingEventChoice.needChoice !== 'teleportDie'
  );
  console.log('✓ teleport mixed still ok');
}

{
  // unknown needChoice
  const g = createGameState(room(2));
  fin(g);
  const p = g.players[0];
  g.pendingEventChoice = {
    needChoice: 'weirdFutureChoice',
    playerId: p.id,
    label: '未来事件',
  };
  const r = forceTimeout(g, p.id);
  assert.ok(r.skippedEvent);
  assert.ok(!g.pendingEventChoice);
  console.log('✓ unknown needChoice → skip');
}

console.log('ALL FALLBACK OK');
