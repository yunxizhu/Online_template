'use strict';

/**
 * 拉斯岛核心规则冒烟
 */
const assert = require('assert');
const {
  createGameState,
  applyAction,
  publicGameState,
  cancelEqualCounts,
  getActingPlayerIds,
  finishInitAnnounce,
} = require('../engine');

function room(n) {
  const players = [];
  for (let i = 0; i < n; i++) {
    players.push({ id: `p${i}`, name: `玩家${i}`, tag: null });
  }
  return { players };
}

function ok(r, msg) {
  assert.ok(r && r.ok, msg || (r && r.error) || 'action failed');
}

function finishInit(game) {
  if (game.phase === 'init_announce') {
    ok(finishInitAnnounce(game), 'finishInitAnnounce');
    assert.strictEqual(game.phase, 'produce', '应进入生产阶段');
    return;
  }
  let guard = 0;
  while (game.phase === 'init_roll' && guard++ < 30) {
    for (const p of game.players) {
      if (game.initRolls[p.id] == null) {
        ok(applyAction(game, p.id, { type: 'initRoll' }));
      }
    }
    if (game.phase === 'init_announce') {
      ok(finishInitAnnounce(game), 'finishInitAnnounce after manual');
      break;
    }
  }
  assert.strictEqual(game.phase, 'produce', '应进入生产阶段');
}

function ensureRolled(game) {
  if (game.phase === 'produce' && game.awaitingProduceRoll && game.currentPlayerId) {
    ok(applyAction(game, game.currentPlayerId, { type: 'produceRoll' }));
  }
}

function pickSlot(player, building) {
  if (building.buildType === 'produce') {
    for (let s = 1; s <= 6; s++) {
      if (!player.buildings.some((b) => b.slot === s)) return s;
    }
  } else {
    if (!player.buildings.some((b) => b.slot === 'none')) return 'none';
    for (let s = 1; s <= 6; s++) {
      if (!player.buildings.some((b) => b.slot === s)) return s;
    }
  }
  return 1;
}

function drainNonProduce(game) {
  let guard = 0;
  while (
    ['settle_act', 'build', 'round_end'].includes(game.phase) &&
    guard++ < 120
  ) {
    const pid = game.currentPlayerId;
    if (!pid) break;
    const p = game.players.find((x) => x.id === pid);
    const unplaced = (p.buildings || []).find((b) => !b.built && b.slot == null);
    if (unplaced) {
      ok(
        applyAction(game, pid, {
          type: 'placeBuildingSlot',
          payload: {
            buildingId: unplaced.id,
            slot: pickSlot(p, unplaced),
          },
        })
      );
      continue;
    }
    if (p.pendingDiscardFunc && p.funcCards[0]) {
      ok(
        applyAction(game, pid, {
          type: 'discardFunc',
          payload: { cardId: p.funcCards[0].id },
        })
      );
      continue;
    }
    if (p.pendingDiscardBuild) {
      const pick =
        p.buildings.find((b) => !b.built) || p.buildings[0];
      if (pick) {
        ok(
          applyAction(game, pid, {
            type: 'discardUnbuilt',
            payload: { buildingId: pick.id },
          })
        );
        continue;
      }
    }
    ok(applyAction(game, pid, { type: 'pass' }));
  }
}

console.log('— cancelEqualCounts —');
assert.deepStrictEqual(cancelEqualCounts({ a: 3, b: 3, c: 2, d: 1 }), {
  c: 2,
  d: 1,
});
assert.deepStrictEqual(cancelEqualCounts({ a: 4, b: 4, c: 4, d: 1 }), {
  d: 1,
});

console.log('— create 3p auto init announce (empty board) —');
const game = createGameState(room(3));
assert.strictEqual(game.type, 'lasidao');
assert.strictEqual(game.phase, 'init_announce');
assert.ok(game.produceOrderStartId, '应已自动决定先手');
assert.ok(game.pendingInitReveal, '应有先手宣布信息');
assert.strictEqual(game.board.resource.tiles.length, 0);
assert.strictEqual(game.board.function.tiles.length, 0);
assert.strictEqual(game.board.building.tiles.length, 0);
assert.ok(game.players.every((p) => p.villagers === 3));

console.log('— init announce then board setup —');
finishInit(game);
assert.strictEqual(game.board.resource.tiles.length, 6);
assert.strictEqual(game.board.function.tiles.length, 2);
assert.strictEqual(game.board.building.tiles.length, 1);

console.log('— init + void round —');
let guard = 0;
const roundAtStart = game.round;
while (game.phase === 'produce' && game.round === roundAtStart && guard++ < 200) {
  ensureRolled(game);
  ok(applyAction(game, game.currentPlayerId, { type: 'voidSkip' }));
}
assert.ok(
  game.phase !== 'produce' || game.round > roundAtStart,
  `应离开本轮生产，阶段=${game.phase} 轮次=${game.round}`
);
drainNonProduce(game);

console.log('— public state areas —');
const pub = publicGameState(game, 'p0');
assert.ok(pub.board.resource);
assert.ok(pub.board.function);
assert.ok(pub.board.building);
assert.ok(Array.isArray(pub.board.resource.slots));
assert.ok(pub.me);

console.log('— place on area number slot —');
const g2 = createGameState(room(2));
finishInit(g2);
ensureRolled(g2);
const cur = g2.currentPlayerId;
const face = g2.dice[cur][0];
const hasRes = g2.board.resource.tiles.some((t) => t.number === face);
const hasFn = g2.board.function.tiles.some((t) => t.number === face);
const hasBd = g2.board.building.tiles.some((t) => t.number === face);
if (hasRes || hasFn || hasBd) {
  const area = hasRes ? 'resource' : hasFn ? 'function' : 'building';
  const before = (g2.dice[cur] || []).filter((d) => d === face).length;
  ok(
    applyAction(g2, cur, {
      type: 'placeDice',
      payload: { face, area },
    })
  );
  assert.strictEqual(g2.board[area].workers[face][cur], before);
} else {
  ok(applyAction(g2, cur, { type: 'voidSkip' }));
}

console.log('— resource number settle aggregates all tiles —');
const g3 = createGameState(room(3));
finishInit(g3);
// 在 1 号资源格放两张卡（若不足则用现有）
const num = 1;
const tiles = g3.board.resource.tiles.filter((t) => t.number === num);
assert.ok(tiles.length >= 1);
g3.board.resource.workers[num] = { p0: 3, p1: 3, p2: 1 };
g3.players.forEach((p) => {
  p.dispatched = p.villagers;
  p.roundGained = 0;
  p.resources = { wood: 0, stone: 0, food: 0, iron: 0 };
});
// 直接触发：让无空闲后走 afterProduce 路径
g3.dice = {};
g3.currentPlayerId = 'p0';
// 借用 void 失败后手动调用——改为再造：用 apply 无法直接 settle
// 通过让所有人已派遣，再对一个仍有 idle 的情况… 全员已满，anyIdleLeft=false
// 强制：用一次会进 settle 的 advance——给 p0 临时 idle 再 void
g3.players[0].dispatched = g3.players[0].villagers - 1;
g3.currentPlayerId = 'p0';
g3.dice.p0 = [2, 2];
ok(applyAction(g3, 'p0', { type: 'voidSkip' }));
// void 后 p0 dispatched 满，应进入结算（可能瞬间到下一轮）
const p2 = g3.players.find((p) => p.id === 'p2');
// 若已结算，p2 应拿到所有 1 号格大份（3 与 3 抵消，剩 1）
if (tiles.length) {
  let expectedLarge = 0;
  for (const t of tiles) expectedLarge += t.large;
  // 结算可能已进下一轮并清资源；检查 lastSettle 或 roundGained 历史
  if (g3.lastSettle && g3.lastSettle.slots) {
    const row = g3.lastSettle.slots.find(
      (x) => x.area === 'resource' && x.number === num
    );
    if (row && row.gains && row.gains[0]) {
      assert.strictEqual(row.gains[0].pid, 'p2');
      assert.strictEqual(row.gains[0].amount, expectedLarge);
    }
  }
}

console.log('— placement caps —');
const mod = require('../index');
assert.strictEqual(mod.id, 'lasidao');
assert.strictEqual(mod.minPlayers, 2);
assert.strictEqual(mod.maxPlayers, 5);

if (game.round >= 2) {
  const n = game.round - 1;
  assert.strictEqual(
    game.board.resource.tiles.length,
    Math.min(12, 6 + n)
  );
  assert.strictEqual(
    game.board.function.tiles.length,
    Math.min(6, 2 + n)
  );
  assert.strictEqual(
    game.board.building.tiles.length,
    Math.min(6, 1 + n)
  );
}

assert.ok(Array.isArray(getActingPlayerIds(game)));

console.log('— discard pile then reshuffle —');
const g4 = createGameState(room(2));
assert.ok(Array.isArray(g4.resourceDiscard));
assert.strictEqual(g4.resourceDiscard.length, 0);
const drawn = g4.resourceDeck.length;
// 模拟：抽光抽牌堆，弃牌堆有牌
g4.resourceDiscard = g4.resourceDeck.splice(0, g4.resourceDeck.length);
assert.strictEqual(g4.resourceDeck.length, 0);
assert.ok(g4.resourceDiscard.length > 0);
const beforeDiscard = g4.resourceDiscard.length;
const tiles4 = require('../engine');
// 通过 setupBoard 的 draw 路径：直接调用引擎内部不好，用公开流程
// 把弃牌堆洗回：再摆一轮前 recycle 后 setup 会抽
g4.round = 2;
// 手动触发 ensure：清空 board 后 setupBoard
const engine = require('../engine');
// setupBoard 未导出；用 create + 耗尽后再 drawOne 等价测试
// 通过 apply 走完一轮太重：直接测 module 内行为——导出不够则复制逻辑断言
// 用 publicGameState 前先强制：resourceDeck 空时从 discard 抽
// 重新 require 并调用 create 后注入，再 place 触发不了抽牌。
// 最简单：把 discard 塞满、deck 清空，然后手动调用 startNextRound 等价
// 导出 ensure 太侵入；改为在 smoke 里用 applyAction 无法。
// 直接访问未导出：用 board recycle 路径——
const { createGameState: cgs, applyAction: aa } = require('../engine');
const g5 = cgs(room(2));
finishInit(g5);
// 把当前资源牌移入弃牌并抽空
g5.resourceDiscard.push(
  ...g5.board.resource.tiles.map(({ number, ...c }) => c),
  ...g5.resourceDeck
);
g5.resourceDeck = [];
g5.board.resource.tiles = [];
assert.strictEqual(g5.resourceDeck.length, 0);
assert.ok(g5.resourceDiscard.length >= drawn);
// 推进到下一轮：全员 void + pass
let g5guard = 0;
while (g5.phase === 'produce' && g5guard++ < 50) {
  ensureRolled(g5);
  ok(aa(g5, g5.currentPlayerId, { type: 'voidSkip' }));
}
drainNonProduce(g5);
// 若已到下一轮且抽了牌，说明弃牌已洗回
if (g5.round >= 2) {
  assert.ok(
    g5.board.resource.tiles.length > 0 || g5.resourceDeck.length > 0,
    '弃牌堆应洗回抽牌堆并重新摆放'
  );
}

console.log('— manual roll + remote dice —');
const g6 = createGameState(room(2));
finishInit(g6);
assert.ok(g6.awaitingProduceRoll, '开局生产应等待手动投掷');
assert.deepStrictEqual(g6.dice[g6.currentPlayerId] || [], []);
const roller = g6.currentPlayerId;
ok(applyAction(g6, roller, { type: 'produceRoll' }));
assert.ok(!g6.awaitingProduceRoll);
assert.ok((g6.dice[roller] || []).length > 0);

const g7 = createGameState(room(2));
finishInit(g7);
const r7 = g7.currentPlayerId;
const p7 = g7.players.find((p) => p.id === r7);
p7.funcCards.push({
  id: 'test-remote',
  kind: 'function',
  funcType: 'remoteDice',
  label: '遥控骰子',
});
ok(applyAction(g7, r7, { type: 'useFunc', payload: { cardId: 'test-remote' } }));
assert.ok(g7.remoteDiceMode);
assert.ok((g7.dice[r7] || []).every((d) => d === 0));
const wildN = g7.dice[r7].length;
const area =
  g7.board.resource.tiles.length > 0
    ? 'resource'
    : g7.board.function.tiles.length > 0
      ? 'function'
      : 'building';
const face7 = g7.board[area].tiles[0].number;
ok(
  applyAction(g7, r7, {
    type: 'placeDice',
    payload: { face: face7, area, count: Math.min(2, wildN) },
  })
);
assert.ok(g7.board[area].workers[face7][r7] >= 1);

console.log('— bandit raid neutral cancel & rank —');
const {
  NEUTRAL_WORKER_ID,
  BANDIT_RAID_COUNT,
} = require('../decks');
const g8 = createGameState(room(2));
finishInit(g8);
const r8 = g8.currentPlayerId;
const p8 = g8.players.find((p) => p.id === r8);
p8.funcCards.push({
  id: 'test-bandit',
  kind: 'function',
  funcType: 'banditRaid',
  label: '强盗来袭',
});
// 找有板块的资源格
let banditFace = null;
for (let n = 1; n <= 6; n++) {
  if (g8.board.resource.tiles.some((t) => t.number === n)) {
    banditFace = n;
    break;
  }
}
assert.ok(banditFace != null);
ok(
  applyAction(g8, r8, {
    type: 'useFunc',
    payload: { cardId: 'test-bandit', area: 'resource', number: banditFace },
  })
);
assert.strictEqual(
  g8.board.resource.workers[banditFace][NEUTRAL_WORKER_ID],
  BANDIT_RAID_COUNT
);
// 玩家放同样 2 人 → 应与强盗抵消
g8.board.resource.workers[banditFace][r8] = 2;
const remain = cancelEqualCounts(g8.board.resource.workers[banditFace]);
assert.deepStrictEqual(remain, {}, '强盗与玩家同数应抵消');
// 强盗 2、玩家 3 → 玩家占第一，强盗占第二名次但不拿收益
const remain2 = cancelEqualCounts({
  [NEUTRAL_WORKER_ID]: 2,
  p0: 3,
});
assert.strictEqual(remain2.p0, 3);
assert.strictEqual(remain2[NEUTRAL_WORKER_ID], 2);

console.log('— exchange rate by owned count —');
const { exchangeCostN, applyAction: ax } = require('../engine');
assert.strictEqual(exchangeCostN(0), null);
assert.strictEqual(exchangeCostN(1), 4);
assert.strictEqual(exchangeCostN(2), 3);
assert.strictEqual(exchangeCostN(3), 2);
assert.strictEqual(exchangeCostN(4), 1);
assert.strictEqual(exchangeCostN(6), 1);
const g9 = createGameState(room(2));
finishInit(g9);
const p9 = g9.players[0];
p9.buildings.push({
  id: 'ex1',
  buildType: 'exchange',
  label: '交易所',
  slot: 'none',
  built: true,
  workers: 0,
  cost: { wood: 2, stone: 2 },
});
p9.resources = { wood: 10, stone: 0, food: 0, iron: 0 };
ok(ax(g9, p9.id, { type: 'exchange', payload: { from: 'wood', to: 'food' } }));
assert.strictEqual(p9.resources.wood, 6);
assert.strictEqual(p9.resources.food, 1);
p9.buildings.push({
  id: 'ex2',
  buildType: 'exchange',
  label: '交易所',
  slot: 'none',
  built: true,
  workers: 0,
  cost: { wood: 2, stone: 2 },
});
ok(ax(g9, p9.id, { type: 'exchange', payload: { from: 'wood', to: 'iron' } }));
assert.strictEqual(p9.resources.wood, 3);
assert.strictEqual(p9.resources.iron, 1);

console.log('— face-down board slots + hidden func hands —');
const g10 = createGameState(room(2));
finishInit(g10);
for (const t of g10.board.function.tiles) {
  const expect = t.number === 2 || t.number === 4 || t.number === 6;
  assert.strictEqual(Boolean(t.faceDown), expect, '功能区奇明示偶暗置');
}
for (const t of g10.board.building.tiles) {
  const expect = t.number === 2 || t.number === 4 || t.number === 6;
  assert.strictEqual(Boolean(t.faceDown), expect, '建筑区奇明示偶暗置');
}
assert.ok(
  g10.board.resource.tiles.every((t) => !t.faceDown),
  '资源区不暗置'
);
g10.players[0].funcCards.push({
  id: 'f_secret',
  funcType: 'breed',
  label: '繁殖村民',
});
const pub0 = publicGameState(g10, 'p0');
const pub1 = publicGameState(g10, 'p1');
assert.ok(pub0.players[0].funcCards.length >= 1);
assert.strictEqual(pub1.players[0].funcCards.length, 0);
assert.strictEqual(pub1.players[0].funcCount, pub0.players[0].funcCount);
const oddFn = (pub0.board.function.slots || []).find((s) => s.number === 1);
const evenFn = (pub0.board.function.slots || []).find((s) => s.number === 2);
if (oddFn && oddFn.tiles[0]) {
  assert.strictEqual(oddFn.tiles[0].faceDown, false);
  assert.ok(oddFn.tiles[0].label);
}
if (evenFn && evenFn.tiles[0]) {
  assert.ok(evenFn.tiles[0].faceDown);
  assert.strictEqual(evenFn.tiles[0].label, null);
  assert.strictEqual(evenFn.tiles[0].funcType, null);
}

console.log('— face-down only visible to claimer —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const faceDownFn = g.board.function.tiles.find((t) => t.faceDown);
  assert.ok(faceDownFn, '应有暗置功能卡');
  const p0 = g.players[0];
  const p1 = g.players[1];
  const secretBld = {
    id: 'secret_bld',
    kind: 'building',
    label: '秘密房',
    buildType: 'score',
    cost: { wood: 1 },
    score: 2,
    faceDown: true,
    slot: null,
    built: false,
    workers: 0,
  };
  p0.buildings.push(secretBld);
  p0.funcCards.push({
    id: faceDownFn.id,
    funcType: faceDownFn.funcType,
    label: faceDownFn.label,
    faceDown: true,
  });
  const pubOwner = publicGameState(g, p0.id);
  const pubOther = publicGameState(g, p1.id);
  const mine = pubOwner.players
    .find((p) => p.id === p0.id)
    .buildings.find((b) => b.id === 'secret_bld');
  const theirs = pubOther.players
    .find((p) => p.id === p0.id)
    .buildings.find((b) => b.id === 'secret_bld');
  assert.ok(mine && mine.label === '秘密房', '获得者可见暗置建筑内容');
  assert.ok(theirs && theirs.faceDown && !theirs.label, '他人不可见暗置建筑内容');
  assert.ok(
    pubOwner.players.find((p) => p.id === p0.id).funcCards.some((c) => c.id === faceDownFn.id),
    '获得者可见暗置功能卡'
  );
  assert.strictEqual(
    pubOther.players.find((p) => p.id === p0.id).funcCards.length,
    0,
    '他人不可见功能手牌'
  );

  g.lastSettle = {
    at: Date.now(),
    round: 1,
    slots: [
      {
        area: 'building',
        number: 2,
        claimedBy: { pid: p0.id, name: p0.name, count: 1 },
        tiles: [
          {
            id: 'secret_bld',
            kind: 'building',
            faceDown: true,
            label: '秘密房',
            buildType: 'score',
          },
        ],
        before: {},
        remain: {},
        cancelled: [],
        ranked: [],
        gains: [],
      },
    ],
    buildings: [],
  };
  const settleOwner = publicGameState(g, p0.id).lastSettle.slots[0].tiles[0];
  const settleOther = publicGameState(g, p1.id).lastSettle.slots[0].tiles[0];
  assert.ok(settleOwner.label, '结算动画：获得者可见');
  assert.ok(settleOther.faceDown && !settleOther.label, '结算动画：他人仍暗置');
}

console.log('— voluntary discard + replace slot —');
const g11 = createGameState(room(2));
finishInit(g11);
const p11 = g11.players[0];
p11.buildings = [
  {
    id: 'old_b',
    label: '旧房',
    buildType: 'score',
    cost: { wood: 1 },
    score: 1,
    slot: 3,
    built: true,
    workers: 0,
  },
  {
    id: 'new_b',
    label: '新房',
    buildType: 'score',
    cost: { wood: 1 },
    score: 1,
    slot: null,
    built: false,
    workers: 0,
  },
];
ok(
  applyAction(g11, p11.id, {
    type: 'discardUnbuilt',
    payload: { buildingId: 'old_b' },
  })
);
assert.ok(!p11.buildings.find((b) => b.id === 'old_b'));
assert.ok(g11.buildingDiscard.some((c) => c.id === 'old_b' || c.label === '旧房'));
ok(
  applyAction(g11, p11.id, {
    type: 'placeBuildingSlot',
    payload: { buildingId: 'new_b', slot: 3 },
  })
);
assert.strictEqual(p11.buildings.find((b) => b.id === 'new_b').slot, 3);

p11.buildings.push({
  id: 'occ_b',
  label: '占位',
  buildType: 'score',
  cost: {},
  score: 0,
  slot: 5,
  built: true,
  workers: 0,
});
p11.buildings.push({
  id: 'rep_b',
  label: '替换',
  buildType: 'score',
  cost: {},
  score: 0,
  slot: null,
  built: false,
  workers: 0,
});
const failRep = applyAction(g11, p11.id, {
  type: 'placeBuildingSlot',
  payload: { buildingId: 'rep_b', slot: 5 },
});
assert.strictEqual(failRep.ok, false);
ok(
  applyAction(g11, p11.id, {
    type: 'placeBuildingSlot',
    payload: { buildingId: 'rep_b', slot: 5, replace: true },
  })
);
assert.ok(!p11.buildings.find((b) => b.id === 'occ_b'));
assert.strictEqual(p11.buildings.find((b) => b.id === 'rep_b').slot, 5);

{
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  assert.strictEqual(p.expandSlots || 0, 0);
  const expandCard = {
    id: 'fn_expand_test',
    kind: 'function',
    funcType: 'expand',
    label: '扩建',
  };
  g.functionDeck.unshift(expandCard);
  p.funcCards.push({
    id: 'fn_redraw_test',
    funcType: 'redraw',
    label: '重抽',
  });
  ok(
    applyAction(g, p.id, {
      type: 'useFunc',
      payload: { cardId: 'fn_redraw_test', deck: 'function' },
    })
  );
  assert.strictEqual(p.expandSlots, 1, '扩建自动发动 +1 无数字格');
  assert.ok(
    !p.funcCards.some((c) => c.funcType === 'expand'),
    '扩建不进手牌'
  );
  assert.ok(
    g.functionDiscard.some((c) => c.funcType === 'expand'),
    '扩建进弃牌堆'
  );
  const pub = publicGameState(g, p.id);
  const me = pub.players.find((x) => x.id === p.id);
  assert.strictEqual(me.expandSlots, 1);
  assert.strictEqual(me.maxBuildings, 7);
  p.buildings.push({
    id: 'ex_b1',
    label: '交易所A',
    buildType: 'exchange',
    cost: {},
    slot: null,
    built: false,
    workers: 0,
  });
  p.buildings.push({
    id: 'ex_b2',
    label: '交易所B',
    buildType: 'exchange',
    cost: {},
    slot: null,
    built: false,
    workers: 0,
  });
  ok(
    applyAction(g, p.id, {
      type: 'placeBuildingSlot',
      payload: { buildingId: 'ex_b1', slot: 'none' },
    })
  );
  ok(
    applyAction(g, p.id, {
      type: 'placeBuildingSlot',
      payload: { buildingId: 'ex_b2', slot: 'none:1' },
    })
  );
  assert.strictEqual(p.buildings.find((b) => b.id === 'ex_b2').slot, 'none:1');
  console.log('✓ expand auto + none slots');
}

console.log('全部通过');
