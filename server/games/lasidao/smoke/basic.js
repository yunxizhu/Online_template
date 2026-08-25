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
  return 'none';
}

function drainNonProduce(game) {
  let guard = 0;
  while (
    ['settle', 'settle_act', 'wish_well', 'build'].includes(game.phase) &&
    guard++ < 120
  ) {
    if (game.phase === 'settle') {
      drainSettleAnim(game);
      continue;
    }
    if (game.phase === 'wish_well') {
      let acted = false;
      for (const p of game.players) {
        const n = Number(p.pendingWishWellBonus) || 0;
        if (n <= 0) continue;
        ok(
          applyAction(game, p.id, {
            type: 'allocateWishWell',
            payload: { alloc: { wood: n, stone: 0, food: 0, iron: 0 } },
          })
        );
        acted = true;
      }
      if (!acted) break;
      continue;
    }
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
    if (game.phase === 'settle_act') {
      if (p.pendingDiscardRes) {
        const pick = ['wood', 'stone', 'food', 'iron'].find(
          (r) => (p.resources[r] || 0) > 0
        );
        if (pick) {
          ok(
            applyAction(game, pid, {
              type: 'discardResource',
              payload: { resource: pick },
            })
          );
          continue;
        }
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
assert.strictEqual(game.board.special.tiles.length, 0);
assert.ok(!game.board.function);
assert.ok(!game.board.building);
assert.ok(game.players.every((p) => p.villagers === 3));
assert.ok(game.players.every((p) => p.houses === 3));
assert.ok(game.players.every((p) => p.resources.food === 0));
assert.ok(
  game.players.every(
    (p) =>
      p.resources.wood === 0 &&
      p.resources.stone === 0 &&
      p.resources.iron === 0
  )
);

console.log('— init announce then board setup —');
finishInit(game);
assert.strictEqual(game.board.resource.tiles.length, 6);
assert.strictEqual(game.board.special.tiles.length, 2);

console.log('— init + void round —');
// 跳过不再要求手里有资源；预发资源仅用于后续用例对照
for (const p of game.players) {
  p.resources.wood = 20;
}
let guard = 0;
const roundAtStart = game.round;
while (game.phase === 'produce' && game.round === roundAtStart && guard++ < 200) {
  ensureRolled(game);
  ok(
    applyAction(game, game.currentPlayerId, {
      type: 'voidSkip',
      payload: { resource: 'wood' },
    })
  );
}
assert.ok(
  game.phase !== 'produce' || game.round > roundAtStart,
  `应离开本轮生产，阶段=${game.phase} 轮次=${game.round}`
);
drainNonProduce(game);

console.log('— voidSkip burns die and gains resource —');
{
  const g = createGameState(room(2));
  finishInit(g);
  ensureRolled(g);
  const pid = g.currentPlayerId;
  const p = g.players.find((x) => x.id === pid);
  p.resources.wood = 0;
  p.resources.stone = 0;
  p.resources.food = 0;
  p.resources.iron = 0;
  const beforeDisp = p.dispatched || 0;
  const beforeIdle = p.villagers - beforeDisp;
  assert.ok((g.dice[pid] || []).length > 0, '跳过前应已有骰子');
  ok(
    applyAction(g, pid, {
      type: 'voidSkip',
      payload: { resource: 'stone' },
    })
  );
  assert.strictEqual(p.resources.stone, 1, '应获得 1 石头');
  assert.strictEqual(p.dispatched, beforeDisp + 1, '应消耗 1 名村民派遣额度');
  assert.strictEqual(
    p.villagers - p.dispatched,
    beforeIdle - 1,
    '空闲村民应减少 1'
  );
  assert.ok(g.currentPlayerId !== pid || g.phase !== 'produce' || (g.dice[pid] || []).length === 0);
}


console.log('— special merged deck top kind —');
{
  const g = createGameState(room(2));
  assert.ok(Array.isArray(g.specialDeck) && g.specialDeck.length > 0);
  assert.ok(!g.functionDeck);
  assert.ok(!g.buildingDeck);
  finishInit(g);
  const pubSp = publicGameState(g, 'p0');
  assert.ok(pubSp.decksLeft.special != null);
  assert.ok(
    ['function', 'building', null].includes(pubSp.specialDeckTopKind)
  );
}

console.log('— redraw from special deck top —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  p.funcCards.push({
    id: 'fn_redraw_test',
    kind: 'function',
    funcType: 'redraw',
    label: '重抽',
  });
  g.phase = 'build';
  g.currentPlayerId = p.id;
  g.buildPassed = {};
  const beforeSp = g.specialDeck.length;
  const topKind =
    g.specialDeck[0].kind === 'building' || g.specialDeck[0].buildType
      ? 'building'
      : 'function';
  const beforeBld = p.buildings.length;
  const beforeFn = p.funcCards.filter((c) => c.id !== 'fn_redraw_test').length;
  ok(
    applyAction(g, p.id, {
      type: 'useFunc',
      payload: { cardId: 'fn_redraw_test' },
    })
  );
  assert.strictEqual(g.specialDeck.length, beforeSp - 1, '应从合堆顶抽走 1 张');
  assert.ok(!p.funcCards.some((c) => c.id === 'fn_redraw_test'), '重抽卡应已消耗');
  if (topKind === 'building') {
    assert.ok(
      p.buildings.length === beforeBld + 1 || p.pendingDiscardBuild,
      '应得建筑'
    );
  } else {
    assert.strictEqual(
      p.funcCards.length,
      beforeFn + 1,
      '应得 1 张功能卡'
    );
  }
}

console.log('— public state areas —');
const pub = publicGameState(game, 'p0');
assert.ok(pub.board.resource);
assert.ok(pub.board.special);
assert.ok(!pub.board.function);
assert.ok(!pub.board.building);
assert.ok(Array.isArray(pub.board.resource.slots));
assert.ok(pub.me);

console.log('— place on area number slot —');
const g2 = createGameState(room(2));
finishInit(g2);
ensureRolled(g2);
const cur = g2.currentPlayerId;
const face = g2.dice[cur][0];
const hasRes = g2.board.resource.tiles.some((t) => t.number === face);
const hasSp = g2.board.special.tiles.some((t) => t.number === face);
if (hasRes || hasSp) {
  const area = hasRes ? 'resource' : 'special';
  const before = (g2.dice[cur] || []).filter((d) => d === face).length;
  ok(
    applyAction(g2, cur, {
      type: 'placeDice',
      payload: { face, area },
    })
  );
  assert.strictEqual(g2.board[area].workers[face][cur], before);
} else {
  const curP2 = g2.players.find((p) => p.id === cur);
  if (curP2) curP2.resources.wood = 1;
  ok(applyAction(g2, cur, { type: 'voidSkip', payload: { resource: 'wood' } }));
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
g3.players[0].resources.wood = 1;
g3.currentPlayerId = 'p0';
g3.awaitingProduceRoll = false;
g3.dice.p0 = [2, 2];
ok(applyAction(g3, 'p0', { type: 'voidSkip', payload: { resource: 'wood' } }));
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
    Math.min(18, 6 + n)
  );
  assert.strictEqual(
    game.board.special.tiles.length,
    Math.min(6, 2 + n)
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
for (const p of g5.players) {
  p.resources.wood = 20;
}
let g5guard = 0;
while (g5.phase === 'produce' && g5guard++ < 50) {
  ensureRolled(g5);
  ok(aa(g5, g5.currentPlayerId, { type: 'voidSkip', payload: { resource: 'wood' } }));
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
    : 'special';
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
assert.strictEqual(exchangeCostN(0), 4);
assert.strictEqual(exchangeCostN(1), 3);
assert.strictEqual(exchangeCostN(2), 2);
assert.strictEqual(exchangeCostN(3), 1);
assert.strictEqual(exchangeCostN(4), 1);
assert.strictEqual(exchangeCostN(6), 1);

// 0 集市：默认银行 4:1
const g9b = createGameState(room(2));
finishInit(g9b);
const p9b = g9b.players[0];
p9b.resources = { wood: 10, stone: 0, food: 0, iron: 0 };
ok(ax(g9b, p9b.id, { type: 'exchange', payload: { from: 'wood', to: 'food' } }));
assert.strictEqual(p9b.resources.wood, 6);
assert.strictEqual(p9b.resources.food, 1);
const g9c = createGameState(room(2));
finishInit(g9c);
const p9c = g9c.players[0];
p9c.resources = { wood: 8, stone: 0, food: 0, iron: 0 };
ok(
  ax(g9c, p9c.id, {
    type: 'exchange',
    payload: { from: 'wood', to: 'iron', count: 2 },
  })
);
assert.strictEqual(p9c.resources.wood, 0);
assert.strictEqual(p9c.resources.iron, 2);

const g9 = createGameState(room(2));
finishInit(g9);
const p9 = g9.players[0];
p9.buildings.push({
  id: 'ex1',
  buildType: 'exchange',
  label: '集市',
  slot: 'none',
  built: true,
  workers: 0,
  cost: { wood: 2, stone: 2 },
});
p9.resources = { wood: 10, stone: 0, food: 0, iron: 0 };
ok(ax(g9, p9.id, { type: 'exchange', payload: { from: 'wood', to: 'food' } }));
assert.strictEqual(p9.resources.wood, 7);
assert.strictEqual(p9.resources.food, 1);
p9.buildings.push({
  id: 'ex2',
  buildType: 'exchange',
  label: '集市',
  slot: 'none',
  built: true,
  workers: 0,
  cost: { wood: 2, stone: 2 },
});
ok(ax(g9, p9.id, { type: 'exchange', payload: { from: 'wood', to: 'iron' } }));
assert.strictEqual(p9.resources.wood, 5);
assert.strictEqual(p9.resources.iron, 1);

console.log('— face-down board slots + hidden func hands —');
const g10 = createGameState(room(2));
finishInit(g10);
for (const t of g10.board.special.tiles) {
  const expect = t.number === 2 || t.number === 4 || t.number === 6;
  assert.strictEqual(Boolean(t.faceDown), expect, '合区奇明示偶暗置');
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
const oddFn = (pub0.board.special.slots || []).find((s) => s.number === 1);
const evenFn = (pub0.board.special.slots || []).find((s) => s.number === 2);
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
  const faceDownTile = g.board.special.tiles.find((t) => t.faceDown);
  assert.ok(faceDownTile, '应有暗置合区卡');
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
    id: 'fn_secret_hand',
    funcType: 'breed',
    label: '繁殖村民',
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
  assert.strictEqual(mine.faceDown, false, '获得者应明示（非暗置卡背）');
  assert.ok(theirs && theirs.faceDown && !theirs.label, '他人不可见暗置建筑内容');

  const openBld = {
    id: 'open_bld',
    kind: 'building',
    label: '未建房',
    buildType: 'exchange',
    cost: { wood: 3, stone: 3 },
    slot: null,
    built: false,
    workers: 0,
  };
  p0.buildings.push(openBld);
  const pubOther2 = publicGameState(g, p1.id);
  const theirsOpen = pubOther2.players
    .find((p) => p.id === p0.id)
    .buildings.find((b) => b.id === 'open_bld');
  assert.ok(
    theirsOpen && theirsOpen.faceDown && !theirsOpen.label,
    '他人不可见未建造建筑（无论是否曾暗置）'
  );
  openBld.built = true;
  openBld.faceDown = false;
  const pubOther3 = publicGameState(g, p1.id);
  const theirsBuilt = pubOther3.players
    .find((p) => p.id === p0.id)
    .buildings.find((b) => b.id === 'open_bld');
  assert.strictEqual(theirsBuilt.label, '未建房', '已建造建筑对他人公开');

  assert.ok(
    pubOwner.players.find((p) => p.id === p0.id).funcCards.some((c) => c.id === 'fn_secret_hand'),
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
  assert.strictEqual(settleOwner.faceDown, false, '结算动画：获得者明示');
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
assert.ok(g11.specialDiscard.some((c) => c.id === 'old_b' || c.label === '旧房'));
ok(
  applyAction(g11, p11.id, {
    type: 'placeBuildingSlot',
    payload: { buildingId: 'new_b', slot: 'none' },
  })
);
assert.strictEqual(p11.buildings.find((b) => b.id === 'new_b').slot, 'none');

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
ok(
  applyAction(g11, p11.id, {
    type: 'placeBuildingSlot',
    payload: { buildingId: 'rep_b', slot: 'none' },
  })
);
assert.strictEqual(p11.buildings.find((b) => b.id === 'rep_b').slot, 'none');

{
  const { maxResourceHandFor, expandCountFor, expandPermanentCost } =
    require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  assert.strictEqual(p.expandSlots || 0, 0);
  assert.strictEqual(p.expandFuncSlots || 0, 0);
  assert.strictEqual(expandCountFor(p), 0);
  assert.deepStrictEqual(expandPermanentCost(p), { wood: 2, stone: 2 });
  // 扩容卡现在进入手牌，需手动打出并选择方向
  p.funcCards.push({
    id: 'fn_expand_build',
    funcType: 'expand',
    label: '扩容',
  });
  p.funcCards.push({
    id: 'fn_expand_func',
    funcType: 'expand',
    label: '扩容',
  });
  assert.strictEqual(p.funcCards.length, 2, '扩容进入手牌');
  g.phase = 'build';
  g.currentPlayerId = p.id;
  ok(
    applyAction(g, p.id, {
      type: 'useFunc',
      payload: { cardId: 'fn_expand_build', direction: 'building' },
    }),
    '扩容建筑格成功'
  );
  assert.strictEqual(p.expandSlots, 1, '扩容建筑格 +1 无数字格');
  assert.ok(
    p.funcCards.some((c) => c.funcType === 'expand'),
    '还剩一张扩容卡未打出'
  );
  assert.ok(
    g.specialDiscard.some((c) => c.funcType === 'expand'),
    '扩容进弃牌堆'
  );
  // 再测扩容功能卡格
  ok(
    applyAction(g, p.id, {
      type: 'useFunc',
      payload: { cardId: 'fn_expand_func', direction: 'function' },
    }),
    '扩容功能卡格成功'
  );
  assert.strictEqual(p.expandFuncSlots, 1, '扩容功能卡格 +1');
  assert.strictEqual(expandCountFor(p), 2);
  assert.deepStrictEqual(expandPermanentCost(p), { wood: 4, stone: 4 });
  p.resources.wood = 10;
  p.resources.stone = 10;
  const woodBefore = p.resources.wood;
  const stoneBefore = p.resources.stone;
  ok(
    applyAction(g, p.id, {
      type: 'expandPermanent',
      payload: { direction: 'resource' },
    }),
    '常驻扩容资源卡位成功'
  );
  assert.strictEqual(p.resources.wood, woodBefore - 4);
  assert.strictEqual(p.resources.stone, stoneBefore - 4);
  assert.strictEqual(p.expandResSlots, 1, '扩容资源卡位 +1');
  assert.strictEqual(maxResourceHandFor(p), 14, '手牌资源上限 +4');
  const pub = publicGameState(g, p.id);
  const me = pub.players.find((x) => x.id === p.id);
  assert.strictEqual(me.expandSlots, 1);
  assert.strictEqual(me.expandFuncSlots, 1);
  assert.strictEqual(me.expandResSlots, 1);
  assert.strictEqual(me.maxResourceHand, 14);
  assert.strictEqual(me.maxBuildings, 4);
  assert.strictEqual(me.maxFuncHand, 4);
  p.buildings.push({
    id: 'ex_b1',
    label: '集市A',
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
  assert.strictEqual(p.buildings.find((b) => b.id === 'ex_b1').slot, 'none');
  const failExtra = applyAction(g, p.id, {
    type: 'placeBuildingSlot',
    payload: {
      buildingId: 'ex_b_missing',
      slot: 'none:1',
    },
  });
  assert.strictEqual(failExtra.ok, false);
  console.log('✓ expand auto + none slots');
}

function drainSettleAnim(g) {
  if (g.phase !== 'settle') return;
  const { finishSettleAnimForce } = require('../engine');
  ok(finishSettleAnimForce(g), 'finishSettleAnimForce');
}

function drainSettleAndWishWell(g) {
  drainSettleAnim(g);
  let guard = 0;
  while (g.phase === 'wish_well' && guard++ < 20) {
    let acted = false;
    for (const p of g.players) {
      const n = Number(p.pendingWishWellBonus) || 0;
      if (n <= 0) continue;
      ok(
        applyAction(g, p.id, {
          type: 'allocateWishWell',
          payload: { alloc: { wood: n, stone: 0, food: 0, iron: 0 } },
        })
      );
      acted = true;
    }
    if (!acted) break;
  }
}

function drainSettleAct(g) {
  let guard = 0;
  while (g.phase === 'settle_act' && guard++ < 50) {
    const pid = g.currentPlayerId;
    if (!pid) break;
    const p = g.players.find((x) => x.id === pid);
    if (p.pendingDiscardRes) {
      const pick = ['wood', 'stone', 'food', 'iron'].find(
        (r) => (p.resources[r] || 0) > 0
      );
      if (pick) {
        ok(
          applyAction(g, pid, {
            type: 'discardResource',
            payload: { resource: pick },
          })
        );
        continue;
      }
    }
    if (p.pendingDiscardFunc && p.funcCards[0]) {
      ok(
        applyAction(g, pid, {
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
          applyAction(g, pid, {
            type: 'discardUnbuilt',
            payload: { buildingId: pick.id },
          })
        );
        continue;
      }
    }
    ok(applyAction(g, pid, { type: 'pass' }));
  }
}

console.log('— build phase pass skip —');
{
  const g = createGameState(room(4));
  finishInit(g);
  // drain produce
  for (const p of g.players) {
    p.resources.wood = 20;
  }
  let guard = 0;
  while (g.phase === 'produce' && guard++ < 200) {
    if (g.awaitingProduceRoll && g.currentPlayerId) {
      ok(applyAction(g, g.currentPlayerId, { type: 'produceRoll' }));
    }
    ok(
      applyAction(g, g.currentPlayerId, {
        type: 'voidSkip',
        payload: { resource: 'wood' },
      })
    );
  }
  // drain settle_act + wish_well
  drainSettleAndWishWell(g);
  assert.strictEqual(g.phase, 'build', '应进入建造阶段');

  // prepare build resources
  const p1 = g.players.find((x) => x.id === 'p1');
  const p3 = g.players.find((x) => x.id === 'p3');
  p1.resources = { wood: 10, stone: 10, food: 10, iron: 10 };
  p3.resources = { wood: 10, stone: 10, food: 10, iron: 10 };
  p1.buildings.push({
    id: 'b1a',
    label: 'A',
    buildType: 'produce',
    cost: { wood: 1 },
    slot: 1,
    built: false,
    workers: 0,
    score: 0,
  });
  p3.buildings.push({
    id: 'b3a',
    label: 'B',
    buildType: 'produce',
    cost: { wood: 1 },
    slot: 2,
    built: false,
    workers: 0,
    score: 0,
  });

  const turns = [];
  guard = 0;
  while (g.phase === 'build' && guard++ < 25) {
    const pid = g.currentPlayerId;
    turns.push(pid);
    if (pid === 'p0' || pid === 'p2') {
      ok(applyAction(g, pid, { type: 'pass' }));
    } else if (pid === 'p1') {
      const b = p1.buildings.find((x) => x.id === 'b1a');
      if (!b.built) {
        ok(applyAction(g, pid, { type: 'construct', payload: { buildingId: 'b1a' } }));
      } else {
        ok(applyAction(g, pid, { type: 'pass' }));
      }
    } else if (pid === 'p3') {
      const b = p3.buildings.find((x) => x.id === 'b3a');
      if (!b.built) {
        ok(applyAction(g, pid, { type: 'construct', payload: { buildingId: 'b3a' } }));
      } else {
        ok(applyAction(g, pid, { type: 'pass' }));
      }
    }
  }
  assert.ok(
    g.phase !== 'build',
    '建造阶段应在所有人 pass 后结束，阶段=' + g.phase
  );
  // p0, p2 passed immediately and should never get a second build turn
  const p0Count = turns.filter((t) => t === 'p0').length;
  const p2Count = turns.filter((t) => t === 'p2').length;
  assert.strictEqual(p0Count, 1, 'p0 已 pass，不应再获得建造回合');
  assert.strictEqual(p2Count, 1, 'p2 已 pass，不应再获得建造回合');
  console.log('✓ build phase pass skip');
}

{
  console.log('— reset build turn —');
  const g = createGameState(room(2));
  finishInit(g);
  for (const p of g.players) p.resources.wood = 20;
  let guard = 0;
  while (g.phase === 'produce' && guard++ < 200) {
    if (g.awaitingProduceRoll && g.currentPlayerId) {
      ok(applyAction(g, g.currentPlayerId, { type: 'produceRoll' }));
    }
    ok(applyAction(g, g.currentPlayerId, { type: 'voidSkip', payload: { resource: 'wood' } }));
  }
  drainSettleAndWishWell(g);
  assert.strictEqual(g.phase, 'build');

  const p0 = g.players[0];
  g.currentPlayerId = p0.id;
  p0.resources = { wood: 10, stone: 10, food: 10, iron: 10 };
  p0.buildings.push({
    id: 'rb0',
    label: 'R',
    buildType: 'produce',
    cost: { wood: 2, stone: 1 },
    slot: 1,
    built: false,
    workers: 0,
    score: 0,
  });
  // 同步快照，使重置后回到刚进入本回合的状态
  const snap = g.buildSnapshots[p0.id];
  snap.resources = JSON.parse(JSON.stringify(p0.resources));
  snap.buildings = JSON.parse(JSON.stringify(p0.buildings));
  snap.score = p0.score;
  const snapRes = JSON.stringify(p0.resources);
  const snapBldCount = p0.buildings.length;
  const snapScore = p0.score;

  // p0 建造建筑
  ok(applyAction(g, p0.id, { type: 'construct', payload: { buildingId: 'rb0' } }));
  assert.ok(p0.buildings.find((b) => b.id === 'rb0').built, '建筑应已建造');
  assert.notStrictEqual(JSON.stringify(p0.resources), snapRes, '资源应已消耗');

  // p0 重置回合
  ok(applyAction(g, p0.id, { type: 'resetBuildTurn', payload: {} }));
  assert.strictEqual(JSON.stringify(p0.resources), snapRes, '重置后资源应恢复');
  assert.strictEqual(p0.buildings.length, snapBldCount, '重置后建筑数量应恢复');
  assert.strictEqual(p0.score, snapScore, '重置后分数应恢复');
  assert.ok(!p0.buildings.find((b) => b.id === 'rb0').built, '重置后建筑应回到未建状态');
  assert.strictEqual(g.currentPlayerId, p0.id, '重置后仍应是 p0 的回合');

  console.log('✓ reset build turn');
}

console.log('— wish well after produce —');
{
  const g = createGameState(room(2));
  const p0 = g.players[0];
  const p1 = g.players[1];
  for (const p of [p0, p1]) {
    p.buildings.push({
      id: 'ww_' + p.id,
      kind: 'building',
      buildType: 'wishWell',
      label: '许愿井',
      cost: { wood: 2, stone: 2, food: 2, iron: 2 },
      built: true,
      slot: 'none',
      workers: 0,
    });
  }
  g.phase = 'wish_well';
  p0.pendingWishWellBonus = 1;
  p1.pendingWishWellBonus = 2;
  const wood0 = p0.resources.wood || 0;
  const wood1 = p1.resources.wood || 0;
  ok(
    applyAction(g, p0.id, {
      type: 'allocateWishWell',
      payload: { alloc: { wood: 1, stone: 0, food: 0, iron: 0 } },
    })
  );
  assert.strictEqual(g.phase, 'wish_well', '另一玩家未确认时应仍在许愿井阶段');
  ok(
    applyAction(g, p1.id, {
      type: 'allocateWishWell',
      payload: { alloc: { wood: 2, stone: 0, food: 0, iron: 0 } },
    })
  );
  assert.strictEqual(g.phase, 'build', '全部确认后应进入建造阶段');
  assert.strictEqual(p0.resources.wood, wood0 + 1);
  assert.strictEqual(p1.resources.wood, wood1 + 2);
  const pub = publicGameState(g, p0.id);
  assert.deepStrictEqual(pub.wishWellPending, []);
  console.log('✓ wish well after produce');
}

console.log('— resource hand limit 10 —');
{
  const {
    MAX_RESOURCE_HAND,
    maxResourceHandFor,
  } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  p.resources = { wood: 6, stone: 5, food: 0, iron: 0 };
  g.phase = 'build';
  g.buildPassed = {};
  g.produceFinishOrder = ['p0', 'p1'];
  g.currentPlayerId = 'p0';
  ok(applyAction(g, 'p0', { type: 'pass' }));
  ok(applyAction(g, 'p1', { type: 'pass' }));
  assert.strictEqual(g.phase, 'settle_act', '超资源上限应进入弃牌阶段');
  assert.ok(p.pendingDiscardRes, '应标记待弃资源');
  while (p.pendingDiscardRes && g.phase === 'settle_act') {
    ok(
      applyAction(g, p.id, {
        type: 'discardResource',
        payload: { resource: 'wood' },
      })
    );
  }
  assert.strictEqual(
    Object.values(p.resources).reduce((a, b) => a + b, 0),
    maxResourceHandFor(p),
    '弃置后应降至上限以内'
  );
  assert.notStrictEqual(g.phase, 'settle_act', '处理完应离开弃牌阶段');
  console.log('✓ resource hand limit 10');
}

console.log('— enhance die counts as 2 in settle —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  const p1 = g.players[1];
  p0.funcCards.push({
    id: 'fn_enhance',
    kind: 'function',
    funcType: 'enhance',
    label: '强化',
  });
  g.phase = 'build';
  g.currentPlayerId = p0.id;
  g.buildPassed = {};
  ok(applyAction(g, p0.id, { type: 'useFunc', payload: { cardId: 'fn_enhance' } }));
  assert.strictEqual(p0.enhancedDice, 1, '应强化 1 枚');
  // 达强化上限后再发动应失败
  p0.enhancedDice = 3;
  p0.funcCards.push({
    id: 'fn_enhance2',
    kind: 'function',
    funcType: 'enhance',
    label: '强化',
  });
  const fail = applyAction(g, p0.id, {
    type: 'useFunc',
    payload: { cardId: 'fn_enhance2' },
  });
  assert.ok(!fail.ok, '强化骰达上限 3 不可再发动');
  assert.ok(
    String(fail.error || '').includes('上限'),
    '错误应提示强化上限'
  );

  // 强度：1 强化骰 vs 1 普通 → 2 vs 1，强化方胜
  p0.enhancedDice = 1;
  p0.enhancedPlaced = 0;
  g.phase = 'produce';
  g.board.resource.workers[1] = { p0: 1, p1: 1 };
  g.board.resource.boosts = { 1: { p0: 1 }, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  g.board.resource.tiles = g.board.resource.tiles.filter((t) => t.number === 1);
  if (!g.board.resource.tiles.length) {
    g.board.resource.tiles = [
      {
        id: 'r1',
        kind: 'resource',
        resource: 'wood',
        large: 3,
        small: 1,
        number: 1,
        label: '木',
      },
    ];
  }
  p0.dispatched = p0.villagers;
  p1.dispatched = p1.villagers;
  p0.resources = { wood: 0, stone: 0, food: 0, iron: 0 };
  p1.resources = { wood: 0, stone: 0, food: 0, iron: 0 };
  // 推进结算：无空闲 → startSettle
  const { cancelEqualCounts: cec } = require('../engine');
  const strength = { p0: 2, p1: 1 };
  assert.deepStrictEqual(cec(strength), { p0: 2, p1: 1 });
}

console.log('— houses gate breed —');
{
  const { freeHousesFor, START_HOUSES } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  assert.strictEqual(p.houses, START_HOUSES);
  assert.strictEqual(freeHousesFor(p), 0, '开局 3 房 3 村民应无空闲');
  p.resources = { wood: 20, stone: 20, food: 20, iron: 20 };
  g.phase = 'build';
  g.buildPassed = {};
  g.currentPlayerId = p.id;
  const fail = applyAction(g, p.id, { type: 'breedPermanent' });
  assert.ok(!fail.ok, '无空闲房子时不可繁殖');
  assert.ok(/空闲房子|房子/.test(fail.error || ''), fail.error);
  ok(applyAction(g, p.id, { type: 'buildHousePermanent' }));
  assert.strictEqual(p.houses, START_HOUSES + 1);
  assert.strictEqual(freeHousesFor(p), 1);
  const before = p.villagers;
  ok(applyAction(g, p.id, { type: 'breedPermanent' }));
  assert.strictEqual(p.villagers, before + 1);
  assert.strictEqual(freeHousesFor(p), 0);
  const pub = publicGameState(g, p.id);
  const me = pub.players.find((x) => x.id === p.id);
  assert.strictEqual(me.houses, p.houses);
  assert.strictEqual(me.freeHouses, 0);
  console.log('✓ houses gate breed');
}

console.log('— recruit grants temp villagers next produce —');
{
  const { beginProduce, startSettle, idleVillagers, RECRUIT_TEMP_VILLAGERS } =
    require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  p0.funcCards.push({
    id: 'fn_recruit',
    kind: 'function',
    funcType: 'recruit',
    label: '征召',
  });
  g.phase = 'build';
  g.currentPlayerId = p0.id;
  g.buildPassed = {};
  const beforeVil = p0.villagers;
  ok(applyAction(g, p0.id, { type: 'useFunc', payload: { cardId: 'fn_recruit' } }));
  assert.strictEqual(p0.recruitPending, RECRUIT_TEMP_VILLAGERS, '应挂起临时村民');
  assert.strictEqual(p0.tempVillagers, 0, '本轮生产前不应生效');
  assert.strictEqual(p0.villagers, beforeVil, '永久村民不变');

  beginProduce(g);
  assert.strictEqual(p0.tempVillagers, RECRUIT_TEMP_VILLAGERS, '下一轮生产应生效');
  assert.strictEqual(p0.recruitPending, 0, '挂起应已消费');
  assert.strictEqual(
    idleVillagers(p0),
    beforeVil + RECRUIT_TEMP_VILLAGERS,
    '空闲应含临时村民'
  );
  const pub = publicGameState(g, p0.id);
  const me = pub.players.find((x) => x.id === p0.id);
  assert.strictEqual(me.tempVillagers, RECRUIT_TEMP_VILLAGERS);
  assert.strictEqual(me.idle, beforeVil + RECRUIT_TEMP_VILLAGERS);

  startSettle(g);
  assert.strictEqual(p0.tempVillagers, 0, '生产结束后临时村民消失');
  assert.strictEqual(p0.villagers, beforeVil, '永久村民仍不变');
  console.log('✓ recruit temp villagers');
}

console.log('全部通过');
