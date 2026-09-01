'use strict';

/**
 * 卡拉斯坦核心规则冒烟
 */
const assert = require('assert');
const {
  createGameState,
  applyAction,
  publicGameState,
  cancelEqualCounts,
  getActingPlayerIds,
  finishInitAnnounce,
  startSettle,
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

function drainWelfareSetup(game) {
  let guard = 0;
  while (guard++ <= 50) {
    const pending = game.pendingWelfareMinimumChoices || {};
    const ids = Object.keys(pending);
    if (!ids.length && !(game.pendingWelfareMinimumQueue || []).length) {
      if (
        !game.pendingEventChoice ||
        game.pendingEventChoice.resume !== 'welfareSetup'
      ) {
        break;
      }
    }
    for (const id of ids) {
      const count = (pending[id] && pending[id].count) || 2;
      ok(
        applyAction(game, id, {
          type: 'eventPickTwoResources',
          payload: { amounts: { wood: count } },
        })
      );
    }
    if (
      game.pendingEventChoice &&
      game.pendingEventChoice.needChoice === 'pickTwoResources' &&
      game.pendingEventChoice.resume === 'welfareSetup'
    ) {
      const ch = game.pendingEventChoice;
      ok(
        applyAction(game, ch.playerId, {
          type: 'eventPickTwoResources',
          payload: { amounts: { wood: ch.count || 2 } },
        })
      );
    }
  }
}

function finishInit(game) {
  if (game.phase === 'init_announce') {
    ok(finishInitAnnounce(game), 'finishInitAnnounce');
    drainWelfareSetup(game);
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
  drainWelfareSetup(game);
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
    ['settle', 'settle_act', 'wish_well', 'build', 'event_mercenary', 'event_discard'].includes(
      game.phase
    ) &&
    guard++ < 200
  ) {
    if (game.pendingEventChoice) {
      const ch = game.pendingEventChoice;
      const pid = ch.playerId;
      if (ch.needChoice === 'pickResource') {
        ok(
          applyAction(game, pid, {
            type: 'eventPickResource',
            payload: { resource: 'wood' },
          })
        );
      } else if (ch.needChoice === 'pickTwoResources') {
        ok(
          applyAction(game, pid, {
            type: 'eventPickTwoResources',
            payload: { amounts: { wood: 2 } },
          })
        );
      } else if (ch.needChoice === 'moveBarrenMarker') {
        ok(
          applyAction(game, pid, {
            type: 'eventMoveBarrenMarker',
            payload: { number: ch.number || 4 },
          })
        );
      } else if (ch.needChoice === 'moveNeutral') {
        ok(
          applyAction(game, pid, {
            type: 'eventMoveNeutral',
            payload: { area: 'resource', number: 1 },
          })
        );
      } else if (ch.needChoice === 'recallDie') {
        let picked = null;
        const exArea = ch.excludeArea || 'resource';
        const exNum = Number(
          ch.excludeNumber != null ? ch.excludeNumber : ch.number
        );
        for (const area of ['resource', 'special']) {
          const workers = (game.board[area] && game.board[area].workers) || {};
          for (let num = 1; num <= 6; num++) {
            if (area === exArea && num === exNum) continue;
            const w = workers[num] || {};
            if ((w[pid] || 0) > 0) {
              picked = { area, number: num };
              break;
            }
          }
          if (picked) break;
        }
        if (!picked) break;
        const ab = game.board[picked.area];
        const wSlot = (ab.workers[picked.number] || {})[pid] || 0;
        const boosted = Math.min(
          Number(
            (ab.boosts &&
              ab.boosts[picked.number] &&
              ab.boosts[picked.number][pid]) ||
              0
          ),
          wSlot
        );
        const enhanced = boosted > 0 && wSlot - boosted <= 0;
        ok(
          applyAction(game, pid, {
            type: 'eventRecallDie',
            payload: { ...picked, enhanced },
          })
        );
      } else if (ch.needChoice === 'gatherNeutrals') {
        const toArea = ch.toArea || 'resource';
        const toNumber = Number(ch.toNumber != null ? ch.toNumber : ch.number);
        let picked = null;
        for (const area of ['resource', 'special']) {
          const workers = (game.board[area] && game.board[area].workers) || {};
          for (let num = 1; num <= 6; num++) {
            if (area === toArea && num === toNumber) continue;
            const w = workers[num] || {};
            if ((w.__neutral__ || 0) > 0) {
              picked = { area, number: num };
              break;
            }
          }
          if (picked) break;
        }
        if (!picked) break;
        ok(
          applyAction(game, pid, {
            type: 'eventGatherNeutrals',
            payload: picked,
          })
        );
      } else if (ch.needChoice === 'teleportDie') {
        if (ch.teleportStep === 'to') {
          const fa = ch.fromArea;
          const fn = Number(ch.fromNumber);
          let dest = null;
          for (const area of ['resource', 'special']) {
            for (let num = 1; num <= 6; num++) {
              if (area === fa && num === fn) continue;
              const tiles = (game.board[area].tiles || []).filter(
                (t) => t.number === num
              );
              if (!tiles.length) continue;
              dest = { area, number: num };
              break;
            }
            if (dest) break;
          }
          if (dest) {
            ok(
              applyAction(game, pid, {
                type: 'eventTeleportTo',
                payload: dest,
              })
            );
          }
        } else {
          let from = null;
          for (const area of ['resource', 'special']) {
            const workers = (game.board[area] && game.board[area].workers) || {};
            for (let num = 1; num <= 6; num++) {
              const w = workers[num] || {};
              for (const [targetId, count] of Object.entries(w)) {
                if ((Number(count) || 0) > 0) {
                  from = { area, number: num, targetId };
                  break;
                }
              }
              if (from) break;
            }
            if (from) break;
          }
          if (from) {
            ok(
              applyAction(game, pid, {
                type: 'eventTeleportFrom',
                payload: from,
              })
            );
          }
        }
      } else {
        break;
      }
      continue;
    }
    if (game.phase === 'event_mercenary') {
      const pid = game.currentPlayerId;
      if (!game.mercenaryRoll || !game.mercenaryRoll.length) {
        ok(applyAction(game, pid, { type: 'mercenaryRoll' }));
      }
      ok(applyAction(game, pid, { type: 'mercenarySkipAll' }));
      continue;
    }
    if (game.phase === 'event_discard') {
      let acted = false;
      for (const p of game.players) {
        if (p.left) continue;
        const left = Number((game.pendingPrisonerDiscards || {})[p.id]) || 0;
        if (left <= 0) continue;
        const res = ['wood', 'stone', 'food', 'iron'].find(
          (r) => (p.resources[r] || 0) > 0
        );
        if (res) {
          ok(
            applyAction(game, p.id, {
              type: 'eventDiscard',
              payload: { kind: 'resource', resource: res },
            })
          );
          acted = true;
        } else {
          delete game.pendingPrisonerDiscards[p.id];
        }
      }
      if (!acted) break;
      continue;
    }
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
    if (game.phase === 'settle_act') {
      let acted = false;
      for (const p of game.players) {
        if (p.left) continue;
        if (p.pendingDiscardRes) {
          const pick = ['wood', 'stone', 'food', 'iron'].find(
            (r) => (p.resources[r] || 0) > 0
          );
          if (pick) {
            ok(
              applyAction(game, p.id, {
                type: 'discardResource',
                payload: { resource: pick },
              })
            );
            acted = true;
            continue;
          }
        }
        if (p.pendingDiscardFunc && p.funcCards[0]) {
          ok(
            applyAction(game, p.id, {
              type: 'discardFunc',
              payload: { cardId: p.funcCards[0].id },
            })
          );
          acted = true;
          continue;
        }
        if (p.pendingDiscardBuild) {
          const pick = p.buildings.find((b) => !b.built);
          if (pick) {
            ok(
              applyAction(game, p.id, {
                type: 'discardUnbuilt',
                payload: { buildingId: pick.id },
              })
            );
          } else {
            ok(applyAction(game, p.id, { type: 'discardPendingBuild' }));
          }
          acted = true;
        }
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
assert.ok(game.players.every((p) => p.houses === 2));
assert.ok(game.players.every((p) => (p.houseScore || 0) === 0));
assert.ok(game.players.every((p) => p.enhancedDice === 1));
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

console.log('— voidSkip pays 2 resources without burning die —');
{
  const g = createGameState(room(2));
  finishInit(g);
  ensureRolled(g);
  const pid = g.currentPlayerId;
  const p = g.players.find((x) => x.id === pid);
  p.resources.wood = 2;
  p.resources.stone = 0;
  p.resources.food = 0;
  p.resources.iron = 0;
  const beforeDisp = p.dispatched || 0;
  ok(
    applyAction(g, pid, {
      type: 'voidSkip',
      payload: { mode: 'pay', amounts: { wood: 2, stone: 0, food: 0, iron: 0 } },
    })
  );
  assert.strictEqual(p.resources.wood, 0, '应弃置 2 木');
  assert.strictEqual(p.dispatched, beforeDisp, '弃资源跳过不应增加派遣');
  assert.ok((g.dice[pid] || []).length === 0, '骰子应清空');
  const g2 = createGameState(room(2));
  finishInit(g2);
  ensureRolled(g2);
  const p2 = g2.players.find((x) => x.id === g2.currentPlayerId);
  p2.resources.wood = 1;
  p2.resources.stone = 0;
  p2.resources.food = 0;
  p2.resources.iron = 0;
  const fail = applyAction(g2, g2.currentPlayerId, {
    type: 'voidSkip',
    payload: { mode: 'pay', amounts: { wood: 2 } },
  });
  assert.ok(!fail.ok, '资源不足时不应允许弃资源跳过');
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
  const keepCard = {
    id: 'rd_keep',
    kind: 'function',
    funcType: 'harvest',
    label: '丰收·留',
  };
  const dropCard = {
    id: 'rd_drop',
    kind: 'function',
    funcType: 'recruit',
    label: '征召·弃',
  };
  const dropCard2 = {
    id: 'rd_drop2',
    kind: 'function',
    funcType: 'enhance',
    label: '强化·弃2',
  };
  g.specialDeck.unshift(dropCard2, dropCard, keepCard);
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
  const beforeFn = p.funcCards.filter((c) => c.id !== 'fn_redraw_test').length;
  const beforeDisc = g.specialDiscard.length;
  ok(
    applyAction(g, p.id, {
      type: 'useFunc',
      payload: { cardId: 'fn_redraw_test' },
    })
  );
  assert.strictEqual(g.specialDeck.length, beforeSp - 3, '应抽走 3 张');
  assert.ok(g.pendingRedrawChoice, '应等待选择保留牌');
  assert.ok(
    p.funcCards.some((c) => c.id === 'fn_redraw_test'),
    '选择前应仍持有重抽卡'
  );
  ok(
    applyAction(g, p.id, {
      type: 'redrawPick',
      payload: { keepId: 'rd_keep' },
    })
  );
  assert.ok(!g.pendingRedrawChoice);
  assert.ok(!p.funcCards.some((c) => c.id === 'fn_redraw_test'), '重抽卡应已消耗');
  assert.strictEqual(
    p.funcCards.filter((c) => c.id === 'rd_keep').length,
    1,
    '应保留所选功能卡'
  );
  assert.ok(
    g.specialDiscard.some((c) => c.id === 'rd_drop'),
    '未选牌应进入弃牌堆'
  );
  assert.strictEqual(
    p.funcCards.length,
    beforeFn + 1,
    '手牌应净增 1 张功能卡'
  );
  assert.strictEqual(g.specialDiscard.length, beforeDisc + 3, '弃牌堆应增加重抽卡与2张未选牌');
  console.log('✓ redraw pick one of three');
}

console.log('— redraw reshuffle discard when deck low —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  const keepCard = {
    id: 'rd_rs_keep',
    kind: 'function',
    funcType: 'harvest',
    label: '丰收·洗',
  };
  const dropCard = {
    id: 'rd_rs_drop',
    kind: 'function',
    funcType: 'recruit',
    label: '征召·洗弃',
  };
  const dropCard2 = {
    id: 'rd_rs_drop2',
    kind: 'function',
    funcType: 'enhance',
    label: '强化·洗弃2',
  };
  g.specialDeck = [keepCard];
  g.specialDiscard = [dropCard2, dropCard];
  p.funcCards.push({
    id: 'fn_redraw_rs',
    kind: 'function',
    funcType: 'redraw',
    label: '重抽',
  });
  g.phase = 'build';
  g.currentPlayerId = p.id;
  g.buildPassed = {};
  ok(
    applyAction(g, p.id, {
      type: 'useFunc',
      payload: { cardId: 'fn_redraw_rs' },
    })
  );
  assert.strictEqual(g.specialDiscard.length, 0, '弃牌堆应已洗入抽牌堆');
  assert.ok(g.pendingRedrawChoice, '应等待选择保留牌');
  assert.strictEqual(g.pendingRedrawChoice.options.length, 3);
  ok(
    applyAction(g, p.id, {
      type: 'redrawPick',
      payload: { keepId: 'rd_rs_keep' },
    })
  );
  assert.ok(p.funcCards.some((c) => c.id === 'rd_rs_keep'));
  console.log('✓ redraw reshuffle discard when deck low');
}

console.log('— buy func card permanent —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  const keepCard = {
    id: 'buy_keep',
    kind: 'function',
    funcType: 'harvest',
    label: '丰收·购',
  };
  const dropCard = {
    id: 'buy_drop',
    kind: 'function',
    funcType: 'recruit',
    label: '征召·购弃',
  };
  const dropCard2 = {
    id: 'buy_drop2',
    kind: 'function',
    funcType: 'enhance',
    label: '强化·购弃2',
  };
  g.specialDeck.unshift(dropCard2, dropCard, keepCard);
  p.resources.wood = 1;
  p.resources.stone = 1;
  p.resources.iron = 2;
  g.phase = 'build';
  g.currentPlayerId = p.id;
  g.buildPassed = {};
  ok(applyAction(g, p.id, { type: 'buyFuncCardPermanent' }));
  assert.ok(g.pendingRedrawChoice && g.pendingRedrawChoice.source === 'buyFunc');
  assert.strictEqual(p.resources.wood, 0);
  assert.strictEqual(p.resources.stone, 0);
  assert.strictEqual(p.resources.iron, 0);
  ok(
    applyAction(g, p.id, {
      type: 'redrawPick',
      payload: { keepId: 'buy_keep' },
    })
  );
  assert.ok(!g.pendingRedrawChoice);
  assert.ok(p.funcCards.some((c) => c.id === 'buy_keep'));
  console.log('✓ buy func card permanent');
}

console.log('— buy func score1 instant —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  const school = {
    id: 'buy_school',
    kind: 'building',
    buildType: 'score1',
    label: '学堂(+1)',
    score: 1,
    instantScore: true,
    cost: {},
  };
  const drop1 = {
    id: 'buy_drop_a',
    kind: 'function',
    funcType: 'harvest',
    label: '丰收·弃',
  };
  const drop2 = {
    id: 'buy_drop_b',
    kind: 'function',
    funcType: 'recruit',
    label: '征召·弃',
  };
  g.specialDeck.unshift(drop2, drop1, school);
  p.resources = { wood: 1, stone: 1, food: 0, iron: 2 };
  p.bonusScore = 0;
  g.phase = 'build';
  g.currentPlayerId = p.id;
  g.buildPassed = {};
  const bldBefore = p.buildings.length;
  ok(applyAction(g, p.id, { type: 'buyFuncCardPermanent' }));
  ok(
    applyAction(g, p.id, {
      type: 'redrawPick',
      payload: { keepId: 'buy_school' },
    })
  );
  assert.strictEqual(p.bonusScore, 1, '学堂应立刻 +1 分');
  assert.strictEqual(p.buildings.length, bldBefore, '学堂不应进入建筑格');
  assert.ok(
    !p.buildings.some((b) => b.id === 'buy_school'),
    '建筑列表中不应有学堂'
  );
  assert.ok(
    (g.specialDiscard || []).some((c) => c.id === 'buy_drop_a'),
    '未选牌应入弃牌堆'
  );
  assert.ok(
    (g.specialDiscard || []).some((c) => c.id === 'buy_school'),
    '学堂应直接入合堆弃牌堆'
  );
  assert.ok(g.lastPlayReveal && g.lastPlayReveal.kind === 'building');
  assert.strictEqual(g.lastPlayReveal.card && g.lastPlayReveal.card.buildType, 'score1');
  console.log('✓ buy func score1 instant');
}

console.log('— special board score1 instant —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  const school = {
    id: 'board_school',
    kind: 'building',
    buildType: 'score1',
    label: '学堂(+1)',
    score: 1,
    instantScore: true,
    number: 1,
    faceDown: false,
    cardIndexOnSlot: 1,
  };
  g.board.special.tiles = [school];
  g.board.special.workers = {
    1: { p0: 3, p1: 1 },
    2: {},
    3: {},
    4: {},
    5: {},
    6: {},
  };
  g.board.special.boosts = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  p0.bonusScore = 0;
  const bldBefore = p0.buildings.length;
  startSettle(g);
  assert.strictEqual(p0.bonusScore, 1, '板块结算取得学堂应立刻 +1 分');
  assert.strictEqual(p0.buildings.length, bldBefore, '学堂不应进入建筑格');
  assert.ok(
    !p0.buildings.some((b) => b.id === 'board_school'),
    '建筑列表中不应有学堂'
  );
  assert.ok(
    (g.specialDiscard || []).some((c) => c.id === 'board_school'),
    '学堂应直接入合堆弃牌堆'
  );
  assert.ok(
    !g.board.special.tiles.some((t) => t.id === 'board_school'),
    '板块卡应被收走'
  );
  assert.ok(g.lastPlayReveal && g.lastPlayReveal.kind === 'building');
  assert.strictEqual(
    g.lastPlayReveal.card && g.lastPlayReveal.card.buildType,
    'score1'
  );
  console.log('✓ special board score1 instant');
}

console.log('— special board score1 instant faceDown —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  const school = {
    id: 'board_school_fd',
    kind: 'building',
    buildType: 'score1',
    label: '学堂(+1)',
    score: 1,
    instantScore: true,
    number: 2,
    faceDown: true,
    cardIndexOnSlot: 1,
  };
  g.board.special.tiles = [school];
  g.board.special.workers = {
    1: {},
    2: { p0: 2, p1: 1 },
    3: {},
    4: {},
    5: {},
    6: {},
  };
  g.board.special.boosts = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  p0.bonusScore = 0;
  startSettle(g);
  assert.strictEqual(p0.bonusScore, 1, '暗置学堂结算取得也应立刻 +1 分');
  assert.ok(
    (g.specialDiscard || []).some((c) => c.id === 'board_school_fd'),
    '暗置学堂应入弃牌堆'
  );
  console.log('✓ special board score1 instant faceDown');
}

console.log('— redraw overflow func hand —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  const max = 3;
  for (let i = 0; i < max; i++) {
    p.funcCards.push({
      id: 'fn_fill_' + i,
      kind: 'function',
      funcType: 'harvest',
      label: '填充' + i,
    });
  }
  const keepCard = {
    id: 'rd_of_keep',
    kind: 'function',
    funcType: 'harvest',
    label: '丰收·溢',
  };
  const dropCard = {
    id: 'rd_of_drop',
    kind: 'function',
    funcType: 'recruit',
    label: '征召·溢弃',
  };
  const dropCard2 = {
    id: 'rd_of_drop2',
    kind: 'function',
    funcType: 'enhance',
    label: '强化·溢弃2',
  };
  g.specialDeck.unshift(dropCard2, dropCard, keepCard);
  p.funcCards.push({
    id: 'fn_redraw_of',
    kind: 'function',
    funcType: 'redraw',
    label: '重抽',
  });
  g.phase = 'build';
  g.currentPlayerId = p.id;
  g.buildPassed = {};
  ok(
    applyAction(g, p.id, {
      type: 'useFunc',
      payload: { cardId: 'fn_redraw_of' },
    })
  );
  ok(
    applyAction(g, p.id, {
      type: 'redrawPick',
      payload: { keepId: 'rd_of_keep' },
    })
  );
  assert.ok(p.pendingDiscardFunc, '满手牌重抽后应待弃功能卡');
  assert.strictEqual(p.funcCards.length, max + 1);
  ok(
    applyAction(g, p.id, {
      type: 'discardFunc',
      payload: { cardId: 'fn_fill_0' },
    })
  );
  assert.ok(!p.pendingDiscardFunc);
  assert.strictEqual(p.funcCards.length, max);
  console.log('✓ redraw overflow func hand');
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
  const { areaOpenSlotCount } = require('../engine');
  assert.strictEqual(
    game.board.resource.tiles.length,
    Math.min(15, 6 + n)
  );
  assert.strictEqual(
    game.board.special.tiles.length,
    areaOpenSlotCount('special', game.round)
  );
}

console.log('— special area unlock every 2 rounds —');
{
  const { areaOpenSlotCount, specialSlotUnlockRound } = require('../engine');
  assert.strictEqual(specialSlotUnlockRound(1), 1);
  assert.strictEqual(specialSlotUnlockRound(2), 1);
  assert.strictEqual(specialSlotUnlockRound(3), 3);
  assert.strictEqual(specialSlotUnlockRound(4), 5);
  assert.strictEqual(specialSlotUnlockRound(5), 7);
  assert.strictEqual(specialSlotUnlockRound(6), 9);
  assert.strictEqual(areaOpenSlotCount('special', 1), 2);
  assert.strictEqual(areaOpenSlotCount('special', 2), 2);
  assert.strictEqual(areaOpenSlotCount('special', 3), 3);
  assert.strictEqual(areaOpenSlotCount('special', 5), 4);
  assert.strictEqual(areaOpenSlotCount('special', 9), 6);
  console.log('✓ special area unlock schedule');
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

console.log('— remote dice after roll —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const rid = g.currentPlayerId;
  const p = g.players.find((x) => x.id === rid);
  p.funcCards.push({
    id: 'test-remote-after',
    kind: 'function',
    funcType: 'remoteDice',
    label: '遥控骰子',
  });
  ok(applyAction(g, rid, { type: 'produceRoll' }));
  assert.ok(!g.awaitingProduceRoll);
  assert.ok((g.dice[rid] || []).length > 0);
  const before = (g.dice[rid] || []).slice();
  ok(
    applyAction(g, rid, {
      type: 'useFunc',
      payload: { cardId: 'test-remote-after' },
    })
  );
  assert.ok(g.remoteDiceMode, '投掷后使用应进入遥控模式');
  assert.strictEqual(g.dice[rid].length, before.length);
  assert.ok(g.dice[rid].every((d) => d === 0));
  console.log('✓ remote dice after roll');
}

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
const beforeBanditNeutral =
  (g8.board.resource.workers[banditFace] || {})[NEUTRAL_WORKER_ID] || 0;
ok(
  applyAction(g8, r8, {
    type: 'useFunc',
    payload: { cardId: 'test-bandit', area: 'resource', number: banditFace },
  })
  );
  assert.strictEqual(
  g8.board.resource.workers[banditFace][NEUTRAL_WORKER_ID],
  beforeBanditNeutral + BANDIT_RAID_COUNT
);
// 玩家放同样数量 → 应与强盗抵消
const neutralN = g8.board.resource.workers[banditFace][NEUTRAL_WORKER_ID];
g8.board.resource.workers[banditFace][r8] = neutralN;
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
assert.strictEqual(exchangeCostN(0), 3);
assert.strictEqual(exchangeCostN(1), 2);
assert.strictEqual(exchangeCostN(2), 1);
assert.strictEqual(exchangeCostN(3), 1);
assert.strictEqual(exchangeCostN(4), 1);
assert.strictEqual(exchangeCostN(6), 1);

// 0 集市：默认银行 3:1
const g9b = createGameState(room(2));
finishInit(g9b);
const p9b = g9b.players[0];
p9b.resources = { wood: 10, stone: 0, food: 0, iron: 0 };
ok(ax(g9b, p9b.id, { type: 'exchange', payload: { from: 'wood', to: 'food' } }));
assert.strictEqual(p9b.resources.wood, 7);
assert.strictEqual(p9b.resources.food, 1);
const g9c = createGameState(room(2));
finishInit(g9c);
const p9c = g9c.players[0];
p9c.resources = { wood: 6, stone: 0, food: 0, iron: 0 };
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
assert.strictEqual(p9.resources.wood, 8);
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
assert.strictEqual(p9.resources.wood, 7);
assert.strictEqual(p9.resources.iron, 1);

// 多资源混合兑换（2 集市 1:1）：3 张换出 → 3 张换入
p9.resources = { wood: 4, stone: 2, food: 0, iron: 0 };
ok(
  ax(g9, p9.id, {
    type: 'exchange',
    payload: {
      from: { wood: 2, stone: 1, food: 0, iron: 0 },
      to: { wood: 0, stone: 0, food: 2, iron: 1 },
    },
  })
);
assert.strictEqual(p9.resources.wood, 2);
assert.strictEqual(p9.resources.stone, 1);
assert.strictEqual(p9.resources.food, 2);
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
  '首轮各格仅一张资源卡，均明示'
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

p11.expandSlots = 1;
p11.buildings.push({
  id: 'rep_b',
  label: '替换',
  buildType: 'exchange',
  cost: {},
  score: 0,
  slot: null,
  built: false,
  workers: 0,
});
const failStackNonEx = applyAction(g11, p11.id, {
  type: 'placeBuildingSlot',
  payload: { buildingId: 'rep_b', slot: 'none' },
});
assert.strictEqual(failStackNonEx.ok, false, '不同建筑不可叠放');
ok(
  applyAction(g11, p11.id, {
    type: 'placeBuildingSlot',
    payload: { buildingId: 'rep_b', slot: 'none:1' },
  })
);
assert.strictEqual(p11.buildings.find((b) => b.id === 'rep_b').slot, 'none:1');

{
  const { maxResourceHandFor, expandCountFor, expandPermanentCost } =
    require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  assert.strictEqual(p.expandSlots || 0, 0);
  assert.strictEqual(p.expandFuncSlots || 0, 0);
  assert.strictEqual(expandCountFor(p), 0);
  assert.deepStrictEqual(expandPermanentCost(p), {
    wood: 1,
    stone: 1,
    food: 1,
    iron: 1,
  });
  // 扩建卡：三选一
  p.funcCards.push({
    id: 'fn_expand_1',
    funcType: 'expand',
    label: '扩建',
  });
  p.funcCards.push({
    id: 'fn_expand_2',
    funcType: 'expand',
    label: '扩建',
  });
  assert.strictEqual(p.funcCards.length, 2, '扩建进入手牌');
  g.phase = 'build';
  g.currentPlayerId = p.id;
  ok(
    applyAction(g, p.id, {
      type: 'useFunc',
      payload: { cardId: 'fn_expand_1', direction: 'building' },
    }),
    '扩建建筑格成功'
  );
  assert.strictEqual(p.expandSlots, 1, '建筑格 +1');
  assert.strictEqual(p.expandFuncSlots, 0, '功能卡格不变');
  assert.strictEqual(p.expandResSlots, 0, '资源卡位不变');
  assert.ok(
    p.funcCards.some((c) => c.funcType === 'expand'),
    '还剩一张扩建卡未打出'
  );
  assert.ok(
    g.specialDiscard.some((c) => c.funcType === 'expand'),
    '扩建进弃牌堆'
  );
  ok(
    applyAction(g, p.id, {
      type: 'useFunc',
      payload: { cardId: 'fn_expand_2', direction: 'function' },
    }),
    '扩建功能卡格成功'
  );
  assert.strictEqual(p.expandSlots, 1);
  assert.strictEqual(p.expandFuncSlots, 1);
  assert.strictEqual(p.expandResSlots, 0);
  assert.strictEqual(expandCountFor(p), 2);
  assert.deepStrictEqual(expandPermanentCost(p), {
    wood: 1,
    stone: 1,
    food: 1,
    iron: 1,
  });
  p.resources.wood = 1;
  p.resources.stone = 1;
  p.resources.food = 1;
  p.resources.iron = 1;
  ok(
    applyAction(g, p.id, {
      type: 'expandPermanent',
      payload: { direction: 'resource' },
    }),
    '常驻扩建成功'
  );
  assert.strictEqual(p.roundExpanded, true);
  const usedExpand = applyAction(g, p.id, {
    type: 'expandPermanent',
    payload: { direction: 'building' },
  });
  assert.ok(!usedExpand.ok, '本回合已扩建不可再扩建');
  assert.strictEqual(p.resources.wood, 0);
  assert.strictEqual(p.resources.stone, 0);
  assert.strictEqual(p.resources.food, 0);
  assert.strictEqual(p.resources.iron, 0);
  assert.strictEqual(p.expandSlots, 1);
  assert.strictEqual(p.expandFuncSlots, 1);
  assert.strictEqual(p.expandResSlots, 1);
  assert.strictEqual(maxResourceHandFor(p), 12 + 4, '手牌资源上限 +4');
  const pub = publicGameState(g, p.id);
  const me = pub.players.find((x) => x.id === p.id);
  assert.strictEqual(me.expandSlots, 1);
  assert.strictEqual(me.expandFuncSlots, 1);
  assert.strictEqual(me.expandResSlots, 1);
  assert.strictEqual(me.maxResourceHand, 16);
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

console.log('— free expand card —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  p.resources = { wood: 0, stone: 0, food: 0, iron: 0 };
  p.funcCards.push({
    id: 'fn_free_expand',
    kind: 'function',
    funcType: 'freeExpand',
    label: '免费扩建',
  });
  g.phase = 'build';
  g.currentPlayerId = 'p0';
  g.buildPassed = {};
  ok(
    applyAction(g, 'p0', {
      type: 'useFunc',
      payload: { cardId: 'fn_free_expand', direction: 'resource' },
    })
  );
  assert.strictEqual(p.expandResSlots, 1, '应扩建资源卡位');
  assert.ok(!p.funcCards.some((c) => c.id === 'fn_free_expand'), '功能卡应已打出');
  assert.strictEqual(p.resources.wood, 0, '不应扣资源');
  console.log('✓ free expand card');
}

console.log('— welfare house card —');
{
  const { playerScore, freeHousesFor } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  const scoreBefore = playerScore(p);
  p.funcCards.push({
    id: 'fn_welfare_house',
    kind: 'function',
    funcType: 'welfareHouse',
    label: '福利房',
  });
  g.phase = 'build';
  g.currentPlayerId = 'p0';
  g.buildPassed = {};
  ok(
    applyAction(g, 'p0', {
      type: 'useFunc',
      payload: { cardId: 'fn_welfare_house' },
    })
  );
  assert.strictEqual(p.houses, 3, '应增加 1 间房子');
  assert.strictEqual(p.welfareHouses, 1);
  assert.strictEqual(playerScore(p), scoreBefore, '福利房不应加分');
  assert.strictEqual(freeHousesFor(p), 3, '应增加 2 村民容量');
  console.log('✓ welfare house card');
}

console.log('— caravan card —');
{
  const { effectiveExchangeCost } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  p.resources = { wood: 4, stone: 0, food: 0, iron: 0 };
  p.funcCards.push({
    id: 'fn_caravan',
    kind: 'function',
    funcType: 'caravan',
    label: '商队来临',
  });
  g.phase = 'build';
  g.currentPlayerId = 'p0';
  g.buildPassed = {};
  ok(
    applyAction(g, 'p0', {
      type: 'useFunc',
      payload: { cardId: 'fn_caravan' },
    })
  );
  assert.strictEqual(p.caravanPending, true);
  assert.strictEqual(p.bonusScore, 0, '无集市不应加分');
  assert.strictEqual(effectiveExchangeCost(p, g), 1, '商队期间恒为 1:1');
  ok(
    applyAction(g, 'p0', {
      type: 'exchange',
      payload: { from: 'wood', to: 'food' },
    })
  );
  assert.strictEqual(p.resources.wood, 3);
  assert.strictEqual(p.resources.food, 1);

  p.buildings.push({
    id: 'ex_test',
    buildType: 'exchange',
    label: '集市',
    slot: 'none',
    built: true,
    workers: 0,
    cost: {},
  });
  assert.strictEqual(effectiveExchangeCost(p, g), 1, '商队期间仍为 1:1');
  p.resources.wood = 1;
  ok(
    applyAction(g, 'p0', {
      type: 'exchange',
      payload: { from: 'wood', to: 'iron' },
    })
  );
  assert.strictEqual(p.resources.wood, 0);
  assert.strictEqual(p.resources.iron, 1);

  ok(applyAction(g, 'p0', { type: 'pass' }));
  assert.strictEqual(p.caravanPending, false, '回合结束应清除商队效果');
  console.log('✓ caravan card');
}
{
  const { playerScore } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  p.buildings.push({
    id: 'ex_bonus',
    buildType: 'exchange',
    label: '集市',
    slot: 'none',
    built: true,
    workers: 0,
    cost: {},
  });
  p.funcCards.push({
    id: 'fn_caravan2',
    kind: 'function',
    funcType: 'caravan',
    label: '商队来临',
  });
  g.phase = 'build';
  g.currentPlayerId = 'p0';
  g.buildPassed = {};
  const scoreBefore = playerScore(p);
  ok(
    applyAction(g, 'p0', {
      type: 'useFunc',
      payload: { cardId: 'fn_caravan2' },
    })
  );
  assert.strictEqual(p.bonusScore, 1, '已建集市应 +1 分');
  assert.strictEqual(playerScore(p), scoreBefore + 1);
  console.log('✓ caravan market bonus');
}

{
  const g = createGameState(room(2));
  finishInit(g);
  const robber = g.players[0];
  const victim = g.players[1];
  victim.resources.wood = 2;
  victim.funcCards.push({
    id: 'v_func',
    funcType: 'harvest',
    label: '丰收',
  });
  robber.funcCards.push({
    id: 'rob_card',
    funcType: 'robbery',
    label: '抢劫',
  });
  g.phase = 'build';
  g.currentPlayerId = robber.id;
  const woodBefore = victim.resources.wood;
  const funcBefore = victim.funcCards.length;
  ok(
    applyAction(g, robber.id, {
      type: 'useFunc',
      payload: {
        cardId: 'rob_card',
        targets: [victim.id, victim.id],
      },
    }),
    '抢劫成功'
  );
  assert.ok(
    !robber.funcCards.some((c) => c.id === 'rob_card'),
    '抢劫卡应已打出'
  );
  assert.ok(
    woodBefore - victim.resources.wood + (funcBefore - victim.funcCards.length) >=
      1,
    '受害者应至少失去一张手牌'
  );
  const robberGain =
    robber.resources.wood +
    robber.resources.stone +
    robber.resources.food +
    robber.resources.iron +
    robber.funcCards.length +
    (robber.buildings || []).filter((b) => !b.built).length;
  assert.ok(robberGain >= 1, '抢劫者应获得至少一张牌');
  console.log('✓ robbery random steal twice');
}

{
  const g = createGameState(room(2));
  finishInit(g);
  const robber = g.players[0];
  const victim = g.players[1];
  victim.resources = { wood: 0, stone: 0, food: 0, iron: 0 };
  victim.funcCards = [];
  victim.buildings = [];
  robber.funcCards.push({
    id: 'rob_empty',
    funcType: 'robbery',
    label: '抢劫',
  });
  g.phase = 'build';
  g.currentPlayerId = robber.id;
  const fail = applyAction(g, robber.id, {
    type: 'useFunc',
    payload: {
      cardId: 'rob_empty',
      targets: [victim.id, victim.id],
    },
  });
  assert.ok(!fail.ok, '无手牌目标不可抢劫');
  assert.ok(/手牌/.test(fail.error || ''), fail.error);
  console.log('✓ robbery rejects empty hand');
}

console.log('— demolition unbuilds score building —');
{
  const { playerScore: scoreOf } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const actor = g.players[0];
  const victim = g.players[1];
  g.phase = 'build';
  g.currentPlayerId = actor.id;
  g.buildPassed = {};
  actor.funcCards.push({
    id: 'ib_card',
    funcType: 'illegalBuild',
    label: '拆迁',
    kind: 'function',
  });
  victim.buildings.push({
    id: 'pal_v',
    kind: 'building',
    buildType: 'score2',
    label: '宫殿',
    cost: {},
    score: 2,
    built: true,
    slot: 1,
    workers: 0,
    faceDown: false,
  });
  assert.strictEqual(scoreOf(victim), 2);
  ok(
    applyAction(g, actor.id, {
      type: 'useFunc',
      payload: { cardId: 'ib_card', targetId: victim.id },
    }),
    '拆迁选择目标'
  );
  assert.ok(g.pendingIllegalBuild);
  ok(
    applyAction(g, victim.id, {
      type: 'illegalBuildPick',
      payload: { buildingId: 'pal_v' },
    }),
    '目标选择建筑'
  );
  assert.strictEqual(scoreOf(victim), 2, '宫殿拆迁后已获分数应保留');
  const pal = victim.buildings.find((b) => b.id === 'pal_v');
  assert.ok(pal && !pal.built, '宫殿变为未建造');
  victim.resources = { wood: 9, stone: 9, food: 9, iron: 9 };
  g.currentPlayerId = victim.id;
  ok(
    applyAction(g, victim.id, {
      type: 'construct',
      payload: { buildingId: 'pal_v' },
    }),
    '宫殿应可再次建造'
  );
  assert.ok(pal.built, '宫殿应已再次建造');
  assert.strictEqual(scoreOf(victim), 4, '再次建造宫殿应再 +2 分');
  assert.ok(!actor.funcCards.some((c) => c.id === 'ib_card'), '拆迁卡已打出');
  console.log('✓ demolition keeps palace score and allows rebuild');
}

{
  const g = createGameState(room(2));
  finishInit(g);
  const actor = g.players[0];
  const victim = g.players[1];
  victim.buildings = [];
  actor.funcCards.push({
    id: 'ib_fail',
    funcType: 'illegalBuild',
    label: '拆迁',
    kind: 'function',
  });
  g.phase = 'build';
  g.currentPlayerId = actor.id;
  const fail = applyAction(g, actor.id, {
    type: 'useFunc',
    payload: { cardId: 'ib_fail', targetId: victim.id },
  });
  assert.ok(!fail.ok, '无已建建筑不可拆迁');
  assert.ok(/已建/.test(fail.error || ''), fail.error);
  console.log('✓ demolition rejects target without built buildings');
}

{
  const g = createGameState(room(2));
  finishInit(g);
  const actor = g.players[0];
  actor.funcCards.push({
    id: 'ib_prod',
    funcType: 'illegalBuild',
    label: '拆迁',
    kind: 'function',
  });
  g.phase = 'produce';
  g.currentPlayerId = actor.id;
  const fail = applyAction(g, actor.id, {
    type: 'useFunc',
    payload: { cardId: 'ib_prod', targetId: g.players[1].id },
  });
  assert.ok(!fail.ok, '生产阶段不可发动拆迁');
  assert.ok(/建造阶段/.test(fail.error || ''), fail.error);
  console.log('✓ demolition only usable in build phase');
}

console.log('— demolition self-target —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const actor = g.players[0];
  g.phase = 'build';
  g.currentPlayerId = actor.id;
  g.buildPassed = {};
  actor.funcCards.push({
    id: 'ib_self',
    funcType: 'illegalBuild',
    label: '拆迁',
    kind: 'function',
  });
  actor.buildings.push({
    id: 'pal_self',
    kind: 'building',
    buildType: 'score1',
    label: '神庙',
    cost: {},
    score: 1,
    built: true,
    slot: 1,
    workers: 0,
    faceDown: false,
  });
  ok(
    applyAction(g, actor.id, {
      type: 'useFunc',
      payload: { cardId: 'ib_self', targetId: actor.id },
    }),
    '拆迁可选择自己'
  );
  assert.ok(g.pendingIllegalBuild);
  assert.strictEqual(g.pendingIllegalBuild.targetId, actor.id);
  ok(
    applyAction(g, actor.id, {
      type: 'illegalBuildPick',
      payload: { buildingId: 'pal_self' },
    }),
    '自选拆迁建筑'
  );
  const pal = actor.buildings.find((b) => b.id === 'pal_self');
  assert.ok(pal && !pal.built, '自选拆迁后建筑变为未建造');
  assert.ok(!actor.funcCards.some((c) => c.id === 'ib_self'), '拆迁卡已打出');
  console.log('✓ demolition allows self-target');
}

console.log('— demolition cancel before building pick —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const actor = g.players[0];
  const victim = g.players[1];
  g.phase = 'build';
  g.currentPlayerId = actor.id;
  actor.funcCards.push({
    id: 'ib_cancel',
    funcType: 'illegalBuild',
    label: '拆迁',
    kind: 'function',
  });
  victim.buildings.push({
    id: 'pal_v2',
    kind: 'building',
    buildType: 'score1',
    label: '神庙',
    cost: {},
    score: 1,
    built: true,
    slot: 1,
    workers: 0,
    faceDown: false,
  });
  ok(
    applyAction(g, actor.id, {
      type: 'useFunc',
      payload: { cardId: 'ib_cancel', targetId: victim.id },
    }),
    '拆迁选择目标'
  );
  assert.ok(g.pendingIllegalBuild);
  ok(
    applyAction(g, actor.id, {
      type: 'cancelIllegalBuild',
      payload: {},
    }),
    '发动者可取消拆迁'
  );
  assert.ok(!g.pendingIllegalBuild);
  assert.ok(actor.funcCards.some((c) => c.id === 'ib_cancel'), '取消后卡牌保留');
  console.log('✓ demolition cancel retains card');
}

function drainSettleAnim(g) {
  if (g.phase !== 'settle') return;
  const { finishSettleAnimForce } = require('../engine');
  ok(finishSettleAnimForce(g), 'finishSettleAnimForce');
}

function drainPrisonerDiscard(g) {
  let guard = 0;
  while (g.phase === 'event_discard' && guard++ < 200) {
    let acted = false;
    for (const p of g.players) {
      if (p.left) continue;
      const left = Number((g.pendingPrisonerDiscards || {})[p.id]) || 0;
      if (left <= 0) continue;
      const res = ['wood', 'stone', 'food', 'iron'].find(
        (r) => (p.resources[r] || 0) > 0
      );
      if (res) {
        ok(
          applyAction(g, p.id, {
            type: 'eventDiscard',
            payload: { kind: 'resource', resource: res },
          })
        );
        acted = true;
      } else {
        delete g.pendingPrisonerDiscards[p.id];
      }
    }
    if (!acted) break;
  }
}

function drainSettleAndWishWell(g) {
  drainSettleAnim(g);
  drainSettleAct(g);
  drainPrisonerDiscard(g);
  drainWelfareSetup(g);
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
  while (g.phase === 'settle_act' && guard++ < 200) {
    let acted = false;
    for (const p of g.players) {
      if (p.left) continue;
      if (p.pendingDiscardRes) {
        const pick = ['wood', 'stone', 'food', 'iron'].find(
          (r) => (p.resources[r] || 0) > 0
        );
        if (pick) {
          ok(
            applyAction(g, p.id, {
              type: 'discardResource',
              payload: { resource: pick },
            })
          );
          acted = true;
          continue;
        }
      }
      if (p.pendingDiscardFunc && p.funcCards[0]) {
        ok(
          applyAction(g, p.id, {
            type: 'discardFunc',
            payload: { cardId: p.funcCards[0].id },
          })
        );
        acted = true;
        continue;
      }
      if (p.pendingDiscardBuild) {
        const pick = p.buildings.find((b) => !b.built);
        if (pick) {
          ok(
            applyAction(g, p.id, {
              type: 'discardUnbuilt',
              payload: { buildingId: pick.id },
            })
          );
        } else {
          ok(applyAction(g, p.id, { type: 'discardPendingBuild' }));
        }
        acted = true;
      }
    }
    if (!acted) break;
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

console.log('— settle act when building over cap —');
{
  const { finishSettleAnimForce } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  for (let i = 0; i < 3; i++) {
    p0.buildings.push({
      id: 'b_cap_' + i,
      kind: 'building',
      buildType: 'produce',
      resource: 'wood',
      rich: false,
      label: '木建筑·贫',
      cost: { stone: 1, iron: 1 },
      produce: 1,
      built: true,
      slot: 'none',
      workers: 0,
    });
  }
  p0.pendingDiscardBuild = {
    newCard: {
      id: 'b_new_settle',
      kind: 'building',
      buildType: 'exchange',
      label: '集市',
      cost: { wood: 2, stone: 2 },
      faceDown: false,
      slot: 'none',
      built: false,
      workers: 0,
    },
    newCards: [],
  };
  p0.pendingDiscardBuild.newCards.push(p0.pendingDiscardBuild.newCard);
  g.phase = 'settle';
  g.lastSettle = { at: Date.now(), round: g.round, slots: [], buildings: [] };
  ok(finishSettleAnimForce(g));
  assert.strictEqual(g.phase, 'settle_act', '卡牌超上限应进入弃牌阶段');
  assert.strictEqual(g.settleActScope, 'all');
  g.currentPlayerId = 'p0';
  g.settleActPassed = {};
  const pub = publicGameState(g, p0.id);
  assert.ok(pub.me.pendingDiscardBuild, '公开状态应含待取舍新建筑');
  ok(applyAction(g, p0.id, { type: 'discardPendingBuild' }));
  assert.strictEqual(p0.pendingDiscardBuild, null);
  assert.strictEqual(p0.buildings.length, 3);
  assert.strictEqual(g.phase, 'build', '卡牌弃完后应进入建造');
  console.log('✓ settle act when building over cap');
}

console.log('— building over cap discard rules —');
{
  const {
    takeBuildingCard,
    maxBuildingsFor,
  } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  for (let i = 0; i < maxBuildingsFor(p0); i++) {
    p0.buildings.push({
      id: 'b_full_' + i,
      kind: 'building',
      buildType: 'produce',
      resource: 'wood',
      label: '已满' + i,
      cost: { stone: 1, iron: 1 },
      built: true,
      slot: i === 0 ? 'none' : `none:${i}`,
      workers: 0,
    });
  }
  const beforeN = p0.buildings.length;
  takeBuildingCard(g, p0, {
    id: 'b_auto_discard',
    kind: 'building',
    buildType: 'exchange',
    label: '自动弃',
    cost: { wood: 1 },
  });
  assert.strictEqual(p0.pendingDiscardBuild, null, '均已建造时不应进入待取舍');
  assert.strictEqual(p0.buildings.length, beforeN, '已有建筑应保留');
  assert.ok(
    g.specialDiscard.some((c) => c.id === 'b_auto_discard'),
    '新建筑应入弃牌堆'
  );

  p0.buildings.push({
    id: 'b_unbuilt_keep',
    kind: 'building',
    buildType: 'exchange',
    label: '未建',
    cost: { wood: 1 },
    built: false,
    slot: null,
    workers: 0,
  });
  takeBuildingCard(g, p0, {
    id: 'b_pending_new',
    kind: 'building',
    buildType: 'exchange',
    label: '待收',
    cost: { wood: 1 },
  });
  assert.ok(p0.pendingDiscardBuild, '有未建建筑时应进入待取舍');
  assert.strictEqual(p0.pendingDiscardBuild.newCard.id, 'b_pending_new');

  const builtOne = p0.buildings.find((b) => b.built);
  g.phase = 'build';
  g.currentPlayerId = p0.id;
  let r = applyAction(g, p0.id, {
    type: 'discardUnbuilt',
    payload: { buildingId: builtOne.id },
  });
  assert.ok(!r.ok && /未建造/.test(r.error || ''), '超上限时不可弃已建建筑');
  ok(applyAction(g, p0.id, { type: 'discardPendingBuild' }));
  assert.strictEqual(p0.pendingDiscardBuild, null);
  assert.ok(!p0.buildings.some((b) => b.id === 'b_pending_new'));

  takeBuildingCard(g, p0, {
    id: 'b_pending_new2',
    kind: 'building',
    buildType: 'exchange',
    label: '待收2',
    cost: { wood: 1 },
  });
  assert.ok(p0.pendingDiscardBuild);
  ok(
    applyAction(g, p0.id, {
      type: 'discardUnbuilt',
      payload: { buildingId: 'b_unbuilt_keep' },
    })
  );
  assert.strictEqual(p0.pendingDiscardBuild, null);
  assert.ok(p0.buildings.some((b) => b.id === 'b_pending_new2'));
  console.log('✓ building over cap discard rules');
}

console.log('— settle act discard order + pending build queue —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  p0.resources = { wood: 13, stone: 0, food: 0, iron: 0 };
  p0.pendingDiscardRes = true;
  p0.funcCards = [
    { id: 'fn_over', kind: 'function', funcType: 'harvest', label: '丰收' },
  ];
  p0.pendingDiscardFunc = true;
  p0.pendingDiscardBuild = {
    newCard: {
      id: 'b_q_1',
      kind: 'building',
      buildType: 'exchange',
      label: '集市A',
      cost: { wood: 2, stone: 2 },
      faceDown: false,
      slot: null,
      built: false,
      workers: 0,
    },
    newCards: [],
  };
  p0.pendingDiscardBuild.newCards.push(p0.pendingDiscardBuild.newCard);
  p0.pendingDiscardBuild.newCards.push({
    id: 'b_q_2',
    kind: 'building',
    buildType: 'exchange',
    label: '集市B',
    cost: { wood: 2, stone: 2 },
    faceDown: false,
    slot: null,
    built: false,
    workers: 0,
  });
  g.phase = 'settle_act';
  g.settleActScope = 'resource';
  g.currentPlayerId = p0.id;
  g.settleActPassed = {};

  let r = applyAction(g, p0.id, {
    type: 'discardFunc',
    payload: { cardId: 'fn_over' },
  });
  assert.ok(!r.ok && /先处理资源/.test(r.error || ''), '应先弃资源');
  r = applyAction(g, p0.id, { type: 'discardPendingBuild' });
  assert.ok(!r.ok && /先处理资源/.test(r.error || ''), '应先弃资源');

  ok(
    applyAction(g, p0.id, {
      type: 'discardResources',
      payload: { amounts: { wood: 1, stone: 0, food: 0, iron: 0 } },
    })
  );
  assert.strictEqual(p0.pendingDiscardRes, false);
  assert.strictEqual(g.phase, 'settle_act', '资源弃完后应继续处理卡牌');
  assert.strictEqual(g.settleActScope, 'resource');

  ok(applyAction(g, p0.id, { type: 'discardPendingBuild' }));
  assert.ok(p0.pendingDiscardBuild && p0.pendingDiscardBuild.newCard, '应还有待取舍建筑');
  assert.strictEqual(p0.pendingDiscardBuild.newCard.id, 'b_q_2');
  ok(applyAction(g, p0.id, { type: 'discardPendingBuild' }));
  assert.strictEqual(p0.pendingDiscardBuild, null, '待取舍建筑应清空');

  ok(
    applyAction(g, p0.id, {
      type: 'discardFunc',
      payload: { cardId: 'fn_over' },
    })
  );
  assert.strictEqual(p0.pendingDiscardFunc, false);
  assert.strictEqual(g.phase, 'build', '卡牌弃完后应进入建造');
  console.log('✓ settle act discard order + pending build queue');
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

console.log('— resource hand limit 12 —');
{
  const { finishSettleAnimForce, maxResourceHandFor } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  p.resources = { wood: 7, stone: 6, food: 0, iron: 0 };
  g.phase = 'settle';
  g.lastSettle = { at: Date.now(), round: g.round, slots: [], buildings: [] };
  ok(finishSettleAnimForce(g));
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
  assert.strictEqual(g.phase, 'build', '弃牌完成后应进入建造阶段');
  console.log('✓ resource hand limit 12');
}

console.log('— building produce ignores resource overcap —');
{
  const { finishSettleAnimForce } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  p.resources = { wood: 11, stone: 0, food: 0, iron: 0 };
  g.phase = 'settle';
  g.lastSettle = {
    at: Date.now(),
    round: g.round,
    slots: [],
    buildings: [
      {
        pid: p.id,
        name: p.name,
        label: '木建筑',
        resource: 'wood',
        amount: 2,
      },
    ],
  };
  ok(finishSettleAnimForce(g));
  assert.strictEqual(p.resources.wood, 13, '应先完成弃牌阶段再个人产出');
  assert.strictEqual(g.phase, 'build', '个人产出后超上限不应再进入弃牌');
  assert.ok(!p.pendingDiscardRes, '个人产出后不应标记待弃资源');
  console.log('✓ building produce ignores resource overcap');
}

console.log('— build phase ignores resource overcap —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  p.resources = { wood: 11, stone: 0, food: 0, iron: 0 };
  p.funcCards.push({
    id: 'fn_harvest_oc',
    kind: 'function',
    funcType: 'harvest',
    label: '丰收',
  });
  g.phase = 'build';
  g.buildPassed = {};
  g.produceFinishOrder = ['p0', 'p1'];
  g.currentPlayerId = 'p0';
  ok(
    applyAction(g, p.id, {
      type: 'useFunc',
      payload: {
        cardId: 'fn_harvest_oc',
        resources: ['wood', 'wood', 'wood'],
      },
    })
  );
  assert.strictEqual(p.resources.wood, 14, '建造阶段可超过资源上限');
  assert.strictEqual(g.phase, 'build', '不应进入弃牌阶段');
  assert.ok(!p.pendingDiscardRes, '建造阶段不标记待弃资源');
  console.log('✓ build phase ignores resource overcap');
}

console.log('— enhance die counts as 1.5 in settle —');
{
  const { effectiveExchangeCost, slotStrengthMap, cancelEqualCounts: cec } =
    require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  const p1 = g.players[1];
  assert.strictEqual(p0.enhancedDice, 1, '开局自带 1 枚强化骰');
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
  assert.strictEqual(p0.enhancedDice, 2, '应再强化 1 枚');
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

  // 强度：1 强化骰 vs 1 普通 → 1.5 vs 1，强化方胜
  p0.enhancedDice = 1;
  p0.enhancedPlaced = 0;
  g.phase = 'produce';
  g.board.resource.workers[1] = { p0: 1, p1: 1 };
  g.board.resource.boosts = { 1: { p0: 1 }, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  const strength = slotStrengthMap(
    g.board.resource.workers[1],
    g.board.resource.boosts[1]
  );
  assert.deepStrictEqual(strength, { p0: 3, p1: 2 }, '1.5 vs 1.0（半单位）');
  assert.deepStrictEqual(cec(strength), { p0: 3, p1: 2 });
}

console.log('— houses gate breed —');
{
  const { freeHousesFor, START_HOUSES, villagerCapacityFor } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  assert.strictEqual(p.houses, START_HOUSES);
  assert.strictEqual(villagerCapacityFor(p), 4, '2 房 × 2 人/房');
  assert.strictEqual(freeHousesFor(p), 1, '开局 4 容量 3 村民应有 1 空位');
  p.resources = { wood: 20, stone: 20, food: 20, iron: 20 };
  g.phase = 'build';
  g.buildPassed = {};
  g.currentPlayerId = p.id;
  const before = p.villagers;
  // 住房已满时不可繁殖
  p.villagers = villagerCapacityFor(p);
  const noSlot = applyAction(g, p.id, { type: 'breedPermanent' });
  assert.ok(!noSlot.ok, '无空位时不可繁殖');
  p.villagers = before;
  ok(applyAction(g, p.id, { type: 'breedPermanent' }));
  assert.strictEqual(p.villagers, before + 1);
  assert.strictEqual(p.resources.food, 17, '繁殖消耗应等于当前村民数 3');
  assert.strictEqual(p.roundBred, true);
  const usedBreed = applyAction(g, p.id, { type: 'breedPermanent' });
  assert.ok(!usedBreed.ok, '本回合已繁殖不可再繁殖');
  ok(applyAction(g, p.id, { type: 'buildHousePermanent' }));
  assert.strictEqual(p.houses, START_HOUSES + 1);
  assert.strictEqual(p.houseScore, 1);
  assert.strictEqual(p.roundBuiltHouse, true);
  const usedHouse = applyAction(g, p.id, { type: 'buildHousePermanent' });
  assert.ok(!usedHouse.ok, '本回合已建房不可再建');
  // 重置回合次数后可再次繁殖（住房空位由建房提供）
  p.roundBred = false;
  ok(applyAction(g, p.id, { type: 'breedPermanent' }));
  assert.strictEqual(p.villagers, before + 2);
  assert.strictEqual(p.resources.food, 13, '4 村民繁殖消耗 4 小麦');
  const pub = publicGameState(g, p.id);
  const me = pub.players.find((x) => x.id === p.id);
  assert.strictEqual(me.houses, p.houses);
  assert.strictEqual(me.freeHouses, freeHousesFor(p));
  assert.strictEqual(me.roundBuiltHouse, true);
  assert.strictEqual(me.roundBred, true);
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

console.log('— next round production starts with first finisher —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const round1 = g.round;
  g.produceFinishOrder = ['p1', 'p0'];
  g.lastBuilderId = 'p0';
  g.phase = 'build';
  g.buildPassed = {};
  g.currentPlayerId = 'p1';
  ok(applyAction(g, 'p1', { type: 'pass' }));
  ok(applyAction(g, 'p0', { type: 'pass' }));
  assert.strictEqual(g.round, round1 + 1, '应进入下一轮');
  drainWelfareSetup(g);
  assert.strictEqual(g.phase, 'produce', '应进入生产阶段');
  assert.strictEqual(
    g.produceOrderStartId,
    'p1',
    '下一轮生产应从本轮最先派遣完毕的玩家开始'
  );
  assert.strictEqual(g.currentPlayerId, 'p1');
  console.log('✓ next round production starts with first finisher');
}

console.log('— environment deck —');
{
  const {
    ENVIRONMENT_DECK_SIZE,
    ENVIRONMENT_DRAW_PER_ROUND,
  } = require('../engine');
  const { ENVIRONMENT_CATALOG, environmentDeckSize } = require('../decks');
  assert.strictEqual(ENVIRONMENT_CATALOG.length, 15);
  assert.ok(
    ENVIRONMENT_CATALOG.every(
      (d) =>
        Number(d.count) > 0 &&
        (d.trigger === 'dispatch' ||
          d.trigger === 'settle' ||
          d.trigger === 'preSettle' ||
          d.trigger === 'setup')
    )
  );
  assert.strictEqual(
    environmentDeckSize(),
    ENVIRONMENT_CATALOG.reduce((s, d) => s + Number(d.count), 0)
  );
  const g = createGameState(room(2));
  finishInit(g);
  assert.strictEqual((g.environmentDeck || []).length, ENVIRONMENT_DECK_SIZE - ENVIRONMENT_DRAW_PER_ROUND);
  assert.ok(g.board.resource.environments);
  assert.strictEqual(g.board.resource.environments[4].kind, 'environment');
  const pub = publicGameState(g, 'p0');
  assert.ok(pub.board.resource.environments[4].trigger);
  assert.ok(pub.board.resource.environments[4].desc);
  console.log('✓ environment deck');
}

console.log('— event luckyDraw side card kind —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const buildingCard = {
    id: 'side_bld',
    kind: 'building',
    buildType: 'exchange',
    label: '集市',
    cost: { wood: 2, stone: 2 },
    faceDown: true,
  };
  g.board.resource.environments[5] = {
    id: 'env_lucky',
    kind: 'environment',
    label: '幸运一抽',
    envType: 'luckyDraw',
    trigger: 'settle',
    setup: 'sideCard',
    number: 5,
    sideCard: buildingCard,
  };
  const pub = publicGameState(g, 'p0');
  const env = pub.board.resource.environments[5];
  assert.strictEqual(env.hasSideCard, true);
  assert.strictEqual(env.sideCardKind, 'building');
  assert.strictEqual(env.label, '幸运一抽');
  assert.ok(!env.sideCard, '公开状态不泄露暗置牌正面');
  assert.ok(!('label' in (env.sideCard || {})), '无 sideCard 对象');
  console.log('✓ event luckyDraw side card kind');
}

console.log('— event enterFray places 3 neutrals —');
{
  const { beginProduce } = require('../engine');
  const { NEUTRAL_WORKER_ID } = require('../decks');
  const { neutralCountOn } = require('../environmentEffects');
  const g = createGameState(room(2));
  finishInit(g);
  g.board.resource.environments[4] = {
    id: 'env_fray',
    kind: 'environment',
    envType: 'enterFray',
    label: '以身入局',
    trigger: 'dispatch',
    setup: 'neutral3',
    number: 4,
  };
  for (const n of [1, 2, 3, 5, 6]) {
    delete g.board.resource.environments[n];
  }
  // 模拟 setupBoard 已放过、beginProduce 清空工人后再补回
  beginProduce(g);
  assert.strictEqual(
    neutralCountOn(g, 'resource', 4),
    3,
    'beginProduce 清空后须按事件牌补回 3 枚中立骰'
  );
  const pub = publicGameState(g, 'p0');
  assert.strictEqual(
    (pub.board.resource.workers[4] || {})[NEUTRAL_WORKER_ID],
    3,
    '公开状态应可见 3 枚中立骰'
  );
  console.log('✓ event enterFray places 3 neutrals');
}

console.log('— event prisoners dilemma neutrals —');
{
  const { beginProduce } = require('../engine');
  const { setupEnvironmentOnBoard, neutralCountOn } = require('../environmentEffects');
  const { NEUTRAL_WORKER_ID } = require('../decks');
  const g = createGameState(room(2));
  g.board.resource.environments[6] = {
    id: 'env_prisoner',
    kind: 'environment',
    envType: 'prisonersDilemma',
    label: '囚徒困境',
    trigger: 'settle',
    setup: 'neutral2',
    number: 6,
  };
  setupEnvironmentOnBoard(g, g.board.resource.environments[6], 6, {
    pushLog: () => {},
  });
  assert.strictEqual(
    neutralCountOn(g, 'resource', 6),
    2,
    '上场应放置 2 枚中立骰'
  );
  g.phase = 'produce';
  g.produceOrderStartId = g.players[0].id;
  beginProduce(g);
  assert.strictEqual(
    neutralCountOn(g, 'resource', 6),
    2,
    'beginProduce 清空后须补回 2 枚中立骰'
  );
  const pub = publicGameState(g, 'p0');
  assert.strictEqual(
    (pub.board.resource.workers[6] || {})[NEUTRAL_WORKER_ID],
    2,
    '公开状态应可见 2 枚中立骰'
  );
  console.log('✓ event prisoners dilemma neutrals');
}

console.log('— prisoners dilemma discard uses physical dice count —');
{
  const { startSettle } = require('../engine');
  const { NEUTRAL_WORKER_ID } = require('../decks');
  const g = createGameState(room(2));
  finishInit(g);
  g.board.resource.environments[6] = {
    id: 'env_pd',
    kind: 'environment',
    envType: 'prisonersDilemma',
    label: '囚徒困境',
    trigger: 'settle',
    setup: 'neutral2',
    number: 6,
  };
  g.board.resource.tiles = [
    {
      id: 'res_t6',
      kind: 'resource',
      resource: 'wood',
      large: 1,
      small: 1,
      number: 6,
      label: '木材',
    },
  ];
  g.board.resource.workers = {
    1: {}, 2: {}, 3: {}, 4: {}, 5: {},
    6: { [NEUTRAL_WORKER_ID]: 2 },
  };
  g.board.resource.boosts = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  const p0 = g.players[0];
  const p1 = g.players[1];
  startSettle(g);
  assert.strictEqual(
    Number((g.pendingPrisonerDiscards || {})[p0.id]) || 0,
    2,
    '仅 2 中立骰时各应弃 2 张而非 4 张'
  );
  assert.strictEqual(
    Number((g.pendingPrisonerDiscards || {})[p1.id]) || 0,
    2,
    '第二名玩家同样弃 2 张'
  );
  console.log('✓ prisoners dilemma n equals first-place dice not strength');
}

console.log('— event wei qi rescue zhao —');
{
  const { beginProduce } = require('../engine');
  const {
    setupEnvironmentOnBoard,
    neutralCountOn,
  } = require('../environmentEffects');
  const { NEUTRAL_WORKER_ID } = require('../decks');
  const g = createGameState(room(2));
  g.board.resource.environments[4] = {
    id: 'env_weiQiRescueZhao',
    kind: 'environment',
    envType: 'weiQiRescueZhao',
    label: '围魏救赵',
    trigger: 'dispatch',
    setup: 'neutralAdjacentSlots',
    number: 4,
  };
  setupEnvironmentOnBoard(g, g.board.resource.environments[4], 4, {
    pushLog: () => {},
  });
  // 事件在 4：周边为 1、5
  assert.strictEqual(neutralCountOn(g, 'resource', 1), 1);
  assert.strictEqual(neutralCountOn(g, 'special', 1), 1);
  assert.strictEqual(neutralCountOn(g, 'resource', 5), 1);
  assert.strictEqual(neutralCountOn(g, 'special', 5), 1);
  assert.strictEqual(neutralCountOn(g, 'resource', 2), 0, '非周边格不应放中立骰');
  assert.strictEqual(neutralCountOn(g, 'resource', 3), 0);
  assert.strictEqual(neutralCountOn(g, 'resource', 4), 0, '事件格自身不放');
  g.phase = 'produce';
  g.produceOrderStartId = g.players[0].id;
  beginProduce(g);
  assert.strictEqual(neutralCountOn(g, 'resource', 1), 1, 'beginProduce 后应恢复周边中立骰');
  assert.strictEqual(neutralCountOn(g, 'resource', 5), 1);
  assert.strictEqual(neutralCountOn(g, 'resource', 2), 0);

  const p0 = g.players[0];
  if (!g.board.resource.tiles.some((t) => t.number === 4)) {
    g.board.resource.tiles.push({
      id: 'res_r4_arrows',
      kind: 'resource',
      resource: 'wood',
      large: 2,
      small: 1,
      number: 4,
      label: '木头·贫',
    });
  }
  p0.dispatched = 1;
  g.currentPlayerId = 'p0';
  g.awaitingProduceRoll = false;
  g.dice = { p0: [4], p1: [] };
  g.diceBoosted = { p0: [false], p1: [] };
  const w5 = g.board.resource.workers[5] || (g.board.resource.workers[5] = {});
  w5[NEUTRAL_WORKER_ID] = 3;
  ok(applyAction(g, 'p0', { type: 'placeDice', payload: { face: 4, area: 'resource' } }));
  assert.ok(g.pendingEventChoice && g.pendingEventChoice.needChoice === 'gatherNeutrals');
  ok(
    applyAction(g, 'p0', {
      type: 'eventGatherNeutrals',
      payload: { area: 'resource', number: 5 },
    })
  );
  assert.ok(!g.pendingEventChoice);
  assert.strictEqual(neutralCountOn(g, 'resource', 5), 0);
  assert.strictEqual(neutralCountOn(g, 'resource', 4), 3, '玩家1枚+集中3枚');
  console.log('✓ event wei qi rescue zhao');
}

console.log('— prisoner discard after personal produce —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  const p1 = g.players[1];
  g.phase = 'wish_well';
  g.personalProduceApplied = true;
  g.produceFinishOrder = [p0.id, p1.id];
  g.currentPlayerId = null;
  p0.pendingDiscardRes = false;
  p1.pendingDiscardRes = false;
  p0.pendingWishWellBonus = 2;
  g.pendingPrisonerDiscards = { [p0.id]: 1 };
  ok(
    applyAction(g, p0.id, {
      type: 'allocateWishWell',
      payload: { alloc: { wood: 2, stone: 0, food: 0, iron: 0 } },
    })
  );
  assert.strictEqual(
    g.phase,
    'event_discard',
    '许愿井完成后应进入囚徒弃牌'
  );
  assert.strictEqual(p0.pendingWishWellBonus, 0, '许愿井应已结算');
  console.log('✓ prisoner discard after personal produce');
}

console.log('— prisoner discard skip when no/short resources —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  const p1 = g.players[1];
  // p0 无资源、待弃 3 → 应直接跳过并离开 event_discard
  p0.resources = { wood: 0, stone: 0, food: 0, iron: 0 };
  p1.resources = { wood: 0, stone: 0, food: 0, iron: 0 };
  g.personalProduceApplied = true;
  g.produceFinishOrder = [p0.id, p1.id];
  g.pendingPrisonerDiscards = { [p0.id]: 3 };
  g.phase = 'event_discard';
  g.currentPlayerId = p0.id;
  ok(applyAction(g, p0.id, { type: 'eventDiscard', payload: {} }));
  assert.ok(
    g.phase !== 'event_discard' ||
      !((g.pendingPrisonerDiscards || {})[p0.id] > 0),
    '无资源玩家不应卡在囚徒弃牌'
  );
  assert.ok(
    !(Number((g.pendingPrisonerDiscards || {})[p0.id]) > 0),
    '无资源时应清除待弃'
  );

  // p0 仅 1 木、待弃 3 → 钳成 1，弃完后进下一步
  const g2 = createGameState(room(2));
  finishInit(g2);
  const a = g2.players[0];
  const b = g2.players[1];
  a.resources = { wood: 1, stone: 0, food: 0, iron: 0 };
  b.resources = { wood: 0, stone: 0, food: 0, iron: 0 };
  g2.personalProduceApplied = true;
  g2.produceFinishOrder = [a.id, b.id];
  g2.pendingPrisonerDiscards = { [a.id]: 1 };
  g2.phase = 'event_discard';
  g2.currentPlayerId = a.id;
  ok(
    applyAction(g2, a.id, {
      type: 'eventDiscard',
      payload: { kind: 'resource', resource: 'wood' },
    })
  );
  assert.strictEqual(a.resources.wood, 0, '应弃掉仅有的 1 木');
  assert.ok(
    !(Number((g2.pendingPrisonerDiscards || {})[a.id]) > 0),
    '弃光后应清除待弃'
  );
  assert.ok(g2.phase !== 'event_discard', '弃完后应离开囚徒弃牌阶段');
  console.log('✓ prisoner discard skip when no/short resources');
}

console.log('— event welfare minimum lowest score —');
{
  const { playerScore } = require('../engine');
  const { setupEnvironmentOnBoard } = require('../environmentEffects');
  const g = createGameState(room(3));
  const p0 = g.players[0];
  const p1 = g.players[1];
  const p2 = g.players[2];
  p0.houseScore = 0;
  p0.bonusScore = 0;
  p1.houseScore = 2;
  p1.bonusScore = 0;
  p2.houseScore = 3;
  p2.bonusScore = 0;
  g.pendingWelfareMinimumQueue = [];
  setupEnvironmentOnBoard(
    g,
    {
      envType: 'welfareMinimum',
      label: '低保户',
      setup: 'lowestScoreTwo',
    },
    5,
    {
      pushLog: () => {},
      alivePlayers: () => g.players.filter((p) => !p.left),
      playerScore,
    }
  );
  assert.strictEqual(g.pendingWelfareMinimumQueue.length, 1);
  assert.strictEqual(g.pendingWelfareMinimumQueue[0].playerId, p0.id);
  assert.strictEqual(g.pendingWelfareMinimumQueue[0].count, 2, '第1轮低保户应为2张');

  p1.houseScore = 0;
  g.pendingWelfareMinimumQueue = [];
  setupEnvironmentOnBoard(
    g,
    {
      envType: 'welfareMinimum',
      label: '低保户',
      setup: 'lowestScoreTwo',
    },
    6,
    {
      pushLog: () => {},
      alivePlayers: () => g.players.filter((p) => !p.left),
      playerScore,
    }
  );
  assert.strictEqual(g.pendingWelfareMinimumQueue.length, 2);
  const tiedIds = new Set(g.pendingWelfareMinimumQueue.map((x) => x.playerId));
  assert.ok(tiedIds.has(p0.id) && tiedIds.has(p1.id));

  // 轮数 count 检查（确保唯一最低分）
  p1.houseScore = 5;
  g.pendingWelfareMinimumQueue = [];
  g.round = 5;
  setupEnvironmentOnBoard(
    g,
    {
      envType: 'welfareMinimum',
      label: '低保户',
      setup: 'lowestScoreTwo',
    },
    5,
    {
      pushLog: () => {},
      alivePlayers: () => g.players.filter((p) => !p.left),
      playerScore,
    }
  );
  assert.strictEqual(g.pendingWelfareMinimumQueue.length, 1);
  assert.strictEqual(g.pendingWelfareMinimumQueue[0].count, 3, '第5轮低保户应为3张');

  g.pendingWelfareMinimumQueue = [];
  g.round = 9;
  setupEnvironmentOnBoard(
    g,
    {
      envType: 'welfareMinimum',
      label: '低保户',
      setup: 'lowestScoreTwo',
    },
    5,
    {
      pushLog: () => {},
      alivePlayers: () => g.players.filter((p) => !p.left),
      playerScore,
    }
  );
  assert.strictEqual(g.pendingWelfareMinimumQueue.length, 1);
  assert.strictEqual(g.pendingWelfareMinimumQueue[0].count, 4, '第9轮低保户应为4张');

  // 完整流程：第5轮选择3个资源（使用全新实例避免状态污染）
  const g5 = createGameState(room(3));
  const q0 = g5.players[0];
  const q1 = g5.players[1];
  const q2 = g5.players[2];
  q0.houseScore = 0;
  q1.houseScore = 5;
  q2.houseScore = 6;
  g5.round = 5;
  g5.phase = 'init_announce';
  g5.produceOrderStartId = q0.id;
  g5.environmentDeck = [
    {
      id: 'env_wm',
      kind: 'environment',
      envType: 'welfareMinimum',
      label: '低保户',
      trigger: 'setup',
      setup: 'lowestScoreTwo',
    },
  ];
  g5.environmentDiscard = [];
  ok(finishInitAnnounce(g5));
  assert.ok(
    g5.pendingWelfareMinimumChoices &&
      g5.pendingWelfareMinimumChoices[q0.id],
    '最低分玩家应待选资源'
  );
  assert.strictEqual(
    g5.pendingWelfareMinimumChoices[q0.id].count,
    3,
    '第5轮应为3个资源'
  );
  assert.ok(!g5.roundProduceBegun, '选完资源前不应正式开始生产');
  // 只选2个应被拒绝
  const reject = applyAction(g5, q0.id, {
    type: 'eventPickTwoResources',
    payload: { amounts: { wood: 2 } },
  });
  assert.strictEqual(reject.ok, false, '第5轮选2个应被拒绝');
  ok(
    applyAction(g5, q0.id, {
      type: 'eventPickTwoResources',
      payload: { amounts: { wood: 2, stone: 1 } },
    })
  );
  assert.strictEqual(q0.resources.wood, 2);
  assert.strictEqual(q0.resources.stone, 1);
  assert.strictEqual(g5.phase, 'produce', '选完后应进入生产');
  console.log('✓ event welfare minimum lowest score');
}

console.log('— event mercenaries preSettle —');
{
  const {
    tryEnterPreSettleMercenaryOrSettle,
    finishSettleAnimForce,
  } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  // 并列第一：不触发
  g.board.resource.environments[4] = {
    id: 'env_merc',
    kind: 'environment',
    label: '雇佣军',
    envType: 'mercenaries',
    trigger: 'preSettle',
    setup: 'mercenary2',
    mercenaryDice: 2,
    number: 4,
  };
  g.board.resource.workers = {
    1: {}, 2: {}, 3: {},
    4: { p0: 2, p1: 2 },
    5: {}, 6: {},
  };
  g.board.resource.boosts = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  tryEnterPreSettleMercenaryOrSettle(g);
  assert.strictEqual(g.phase, 'settle', '并列第一应直接结算');
  assert.strictEqual(
    (g.pendingMercenaryQueue || []).length,
    0,
    '并列不入队'
  );
  assert.strictEqual(
    g.board.resource.environments[4].mercenaryDice,
    2,
    '未触发则保留雇佣骰'
  );
  if (g.phase === 'settle') finishSettleAnimForce(g);

  const g2 = createGameState(room(2));
  finishInit(g2);
  g2.board.resource.environments[5] = {
    id: 'env_merc2',
    kind: 'environment',
    label: '雇佣军',
    envType: 'mercenaries',
    trigger: 'preSettle',
    setup: 'mercenary2',
    mercenaryDice: 2,
    number: 5,
  };
  if (!g2.board.resource.tiles.some((t) => t.number === 3)) {
    g2.board.resource.tiles.push({
      id: 'res_m3',
      kind: 'resource',
      resource: 'wood',
      large: 3,
      small: 1,
      number: 3,
      label: '木·富',
    });
  }
  g2.board.resource.workers = {
    1: {}, 2: {}, 3: {}, 4: {},
    5: { p0: 3, p1: 1 },
    6: {},
  };
  g2.board.resource.boosts = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  tryEnterPreSettleMercenaryOrSettle(g2);
  assert.strictEqual(g2.phase, 'event_mercenary', '唯一第一应进入雇佣军');
  assert.strictEqual(g2.mercenaryGate, 'preSettle');
  assert.strictEqual(g2.currentPlayerId, 'p0');
  assert.strictEqual(g2.board.resource.environments[5].mercenaryDice, 0);
  ok(applyAction(g2, 'p0', { type: 'mercenaryRoll' }));
  assert.strictEqual((g2.mercenaryRoll || []).length, 2);
  // 强制点数便于断言
  g2.mercenaryRoll = [3, 3];
  const p0b = g2.players[0];
  const beforeRes = { ...(p0b.resources || {}) };
  ok(
    applyAction(g2, 'p0', {
      type: 'mercenaryPlace',
      payload: { index: 0, skip: false },
    })
  );
  const gained = ['wood', 'stone', 'food', 'iron'].reduce(
    (s, r) => s + ((p0b.resources[r] || 0) - (beforeRes[r] || 0)),
    0
  );
  assert.ok(gained > 0, '放置后应按对应格大份获资源');
  ok(
    applyAction(g2, 'p0', {
      type: 'mercenaryPlace',
      payload: { index: 1, skip: true },
    })
  );
  assert.strictEqual(g2.phase, 'settle', '雇佣军结束后进入结算');
  assert.strictEqual(g2.mercenaryGate, null);
  console.log('✓ event mercenaries preSettle');
}

console.log('— event mercenary place triggers dispatch env —');
{
  const {
    tryEnterPreSettleMercenaryOrSettle,
    finishSettleAnimForce,
  } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  g.board.resource.environments[5] = {
    id: 'env_merc2',
    kind: 'environment',
    label: '雇佣军',
    envType: 'mercenaries',
    trigger: 'preSettle',
    setup: 'mercenary2',
    mercenaryDice: 2,
    number: 5,
  };
  g.board.resource.environments[4] = {
    id: 'env_sky2',
    kind: 'environment',
    label: '晴空万里',
    envType: 'clearSky',
    trigger: 'dispatch',
    number: 4,
  };
  g.board.resource.workers = {
    1: {},
    2: {},
    3: {},
    4: {},
    5: { p0: 3, p1: 1 },
    6: {},
  };
  g.board.resource.boosts = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  if (!g.board.resource.tiles.some((t) => t.number === 4)) {
    g.board.resource.tiles.push({
      id: 'res_sky',
      kind: 'resource',
      resource: 'wood',
      large: 2,
      small: 1,
      number: 4,
      label: '木头·贫',
    });
  }
  tryEnterPreSettleMercenaryOrSettle(g);
  assert.strictEqual(g.phase, 'event_mercenary');
  ok(applyAction(g, 'p0', { type: 'mercenaryRoll' }));
  g.mercenaryRoll = [4, 1];
  ok(
    applyAction(g, 'p0', {
      type: 'mercenaryPlace',
      payload: { index: 0, skip: false },
    })
  );
  assert.ok(g.pendingEventChoice, '应触发晴空万里选择');
  assert.strictEqual(g.pendingEventChoice.needChoice, 'pickResource');
  assert.strictEqual(g.pendingEventChoice.resume, 'mercenary');
  assert.strictEqual(g.phase, 'event_mercenary', '选择期间仍停留雇佣军阶段');
  const p0 = g.players[0];
  const woodBefore = p0.resources.wood || 0;
  ok(
    applyAction(g, 'p0', {
      type: 'eventPickResource',
      payload: { resource: 'wood' },
    })
  );
  assert.strictEqual(p0.resources.wood, woodBefore + 1);
  assert.strictEqual(g.pendingEventChoice, null);
  assert.strictEqual(g.phase, 'event_mercenary', '还有一枚雇佣骰');
  ok(
    applyAction(g, 'p0', {
      type: 'mercenaryPlace',
      payload: { index: 1, skip: true },
    })
  );
  assert.strictEqual(g.phase, 'settle');
  if (g.phase === 'settle') finishSettleAnimForce(g);
  console.log('✓ event mercenary place triggers dispatch env');
}

console.log('— event clearSky pick resource —');
{
  const g = createGameState(room(2));
  finishInit(g);
  g.board.resource.environments[4] = {
    id: 'env_sky',
    kind: 'environment',
    label: '晴空万里',
    envType: 'clearSky',
    trigger: 'dispatch',
    number: 4,
  };
  if (!g.board.resource.tiles.some((t) => t.number === 4)) {
    g.board.resource.tiles.push({
      id: 'res_t4',
      kind: 'resource',
      resource: 'wood',
      large: 2,
      small: 1,
      number: 4,
      label: '木头·贫',
    });
  }
  g.phase = 'produce';
  g.currentPlayerId = 'p0';
  g.awaitingProduceRoll = false;
  g.dice = { p0: [4], p1: [] };
  g.diceBoosted = { p0: [false], p1: [] };
  const p0 = g.players[0];
  p0.resources.iron = 0;
  p0.dispatched = 0;
  ok(applyAction(g, 'p0', { type: 'placeDice', payload: { face: 4, area: 'resource' } }));
  assert.ok(g.pendingEventChoice && g.pendingEventChoice.needChoice === 'pickResource');
  ok(applyAction(g, 'p0', { type: 'eventPickResource', payload: { resource: 'iron' } }));
  assert.strictEqual(p0.resources.iron, 1);
  assert.ok(!g.pendingEventChoice);
  console.log('✓ event clearSky pick resource');
}

console.log('— event recall die —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  g.board.resource.environments[4] = {
    id: 'env_recall',
    kind: 'environment',
    label: '召回',
    envType: 'recall',
    trigger: 'dispatch',
    number: 4,
  };
  if (!g.board.resource.tiles.some((t) => t.number === 4)) {
    g.board.resource.tiles.push({
      id: 'res_r4',
      kind: 'resource',
      resource: 'wood',
      large: 2,
      small: 1,
      number: 4,
      label: '木头·贫',
    });
  }
  g.phase = 'produce';
  g.currentPlayerId = 'p0';
  g.awaitingProduceRoll = false;
  g.dice = { p0: [4], p1: [] };
  g.diceBoosted = { p0: [false], p1: [] };
  p0.dispatched = 0;

  // 仅本格刚放下：无可召回，应跳过
  ok(applyAction(g, 'p0', { type: 'placeDice', payload: { face: 4, area: 'resource' } }));
  assert.ok(!g.pendingEventChoice, '仅本格有刚放骰子时应跳过召回');
  assert.strictEqual((g.board.resource.workers[4] || {}).p0 || 0, 1, '刚放骰子应留在本格');

  g.board.resource.workers[1] = { p0: 1 };
  p0.dispatched = 2;
  g.dice = { p0: [4], p1: [] };
  g.diceBoosted = { p0: [false], p1: [] };
  g.phase = 'produce';
  g.currentPlayerId = 'p0';
  g.awaitingProduceRoll = false;
  ok(applyAction(g, 'p0', { type: 'placeDice', payload: { face: 4, area: 'resource' } }));
  assert.ok(g.pendingEventChoice && g.pendingEventChoice.needChoice === 'recallDie');
  assert.strictEqual(g.pendingEventChoice.excludeNumber, 4);
  assert.strictEqual(g.pendingEventChoice.justPlacedCount, 1);
  const onlyJustPlaced = applyAction(g, 'p0', {
    type: 'eventRecallDie',
    payload: { area: 'resource', number: 4 },
  });
  assert.ok(onlyJustPlaced.ok, '本格有旧骰子时应可召回 1 枚');
  assert.ok(!g.pendingEventChoice);
  assert.strictEqual((g.board.resource.workers[4] || {}).p0 || 0, 1, '刚放置的骰子应留在本格');
  assert.strictEqual((g.board.resource.workers[1] || {}).p0 || 0, 1, '其它格不受影响');
  assert.ok(g.dice.p0.includes(4), '召回的骰面应为 4 号格');
  assert.strictEqual(p0.dispatched, 2, '召回后已派遣数应减 1');

  g.board.resource.workers[3] = { [p0.id]: 2 };
  if (!g.board.resource.boosts) g.board.resource.boosts = {};
  g.board.resource.boosts[3] = { [p0.id]: 1 };
  g.pendingEventChoice = {
    playerId: p0.id,
    needChoice: 'recallDie',
    label: '召回',
    excludeArea: 'resource',
    excludeNumber: 4,
    justPlacedCount: 1,
  };
  const needPick = applyAction(g, p0.id, {
    type: 'eventRecallDie',
    payload: { area: 'resource', number: 3 },
  });
  assert.ok(!needPick.ok, '同格两种骰子须指定类型');
  ok(
    applyAction(g, p0.id, {
      type: 'eventRecallDie',
      payload: { area: 'resource', number: 3, enhanced: true },
    })
  );
  assert.strictEqual(g.board.resource.workers[3][p0.id], 1);
  assert.strictEqual((g.board.resource.boosts[3] || {})[p0.id] || 0, 0, '应召回强化骰');

  const g2 = createGameState(room(2));
  finishInit(g2);
  const p0b = g2.players[0];
  g2.board.resource.environments[5] = {
    id: 'env_recall2',
    kind: 'environment',
    label: '召回',
    envType: 'recall',
    trigger: 'dispatch',
    number: 5,
  };
  if (!g2.board.resource.tiles.some((t) => t.number === 5)) {
    g2.board.resource.tiles.push({
      id: 'res_r5',
      kind: 'resource',
      resource: 'stone',
      large: 2,
      small: 1,
      number: 5,
      label: '石头·贫',
    });
  }
  g2.phase = 'produce';
  g2.currentPlayerId = 'p0';
  g2.awaitingProduceRoll = false;
  g2.dice = { p0: [5], p1: [] };
  g2.diceBoosted = { p0: [false], p1: [] };
  p0b.dispatched = 0;
  ok(applyAction(g2, 'p0', { type: 'placeDice', payload: { face: 5, area: 'resource' } }));
  assert.ok(!g2.pendingEventChoice, '仅本格时应跳过召回过程');
  assert.strictEqual((g2.board.resource.workers[5] || {}).p0 || 0, 1);
  console.log('✓ event recall die');
}

console.log('— event teleport die —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  const p1 = g.players[1];
  g.board.resource.environments[4] = {
    id: 'env_tp',
    kind: 'environment',
    label: '传送',
    envType: 'teleport',
    trigger: 'dispatch',
    number: 4,
  };
  g.board.resource.environments[3] = {
    id: 'env_sky3',
    kind: 'environment',
    label: '晴空万里',
    envType: 'clearSky',
    trigger: 'dispatch',
    number: 3,
  };
  for (const num of [3, 4]) {
    if (!g.board.resource.tiles.some((t) => t.number === num)) {
      g.board.resource.tiles.push({
        id: 'res_tp' + num,
        kind: 'resource',
        resource: 'wood',
        large: 2,
        small: 1,
        number: num,
        label: '木头·贫',
      });
    }
  }
  g.board.resource.workers[1] = { p1: 1 };
  p1.dispatched = 1;
  p0.resources.iron = 0;
  p1.resources.iron = 0;
  g.phase = 'produce';
  g.currentPlayerId = 'p0';
  g.awaitingProduceRoll = false;
  g.dice = { p0: [4], p1: [] };
  g.diceBoosted = { p0: [false], p1: [] };
  p0.dispatched = 0;

  ok(applyAction(g, 'p0', { type: 'placeDice', payload: { face: 4, area: 'resource' } }));
  assert.ok(g.pendingEventChoice && g.pendingEventChoice.needChoice === 'teleportDie');
  assert.strictEqual(g.pendingEventChoice.teleportStep, 'from');
  ok(
    applyAction(g, 'p0', {
      type: 'eventTeleportFrom',
      payload: { area: 'resource', number: 1, targetId: 'p1' },
    })
  );
  assert.strictEqual(g.pendingEventChoice.teleportStep, 'to');
  ok(
    applyAction(g, 'p0', {
      type: 'eventTeleportTo',
      payload: { area: 'resource', number: 3 },
    })
  );
  assert.ok(
    g.pendingEventChoice && g.pendingEventChoice.needChoice === 'pickResource',
    '落点晴空万里应触发派遣效果'
  );
  assert.strictEqual(g.pendingEventChoice.playerId, 'p0');
  assert.strictEqual((g.board.resource.workers[1] || {}).p1 || 0, 0);
  assert.strictEqual((g.board.resource.workers[3] || {}).p1 || 0, 1);
  assert.strictEqual(p1.resources.iron || 0, 0);
  ok(
    applyAction(g, 'p0', {
      type: 'eventPickResource',
      payload: { resource: 'iron' },
    })
  );
  assert.ok(!g.pendingEventChoice);
  assert.strictEqual(p0.resources.iron || 0, 1, '传送发动者获得晴空万里资源');

  const g2 = createGameState(room(2));
  finishInit(g2);
  g2.board.resource.environments[5] = {
    id: 'env_tp2',
    kind: 'environment',
    label: '传送',
    envType: 'teleport',
    trigger: 'dispatch',
    number: 5,
  };
  if (!g2.board.resource.tiles.some((t) => t.number === 5)) {
    g2.board.resource.tiles.push({
      id: 'res_tp5',
      kind: 'resource',
      resource: 'stone',
      large: 2,
      small: 1,
      number: 5,
      label: '石头·贫',
    });
  }
  g2.phase = 'produce';
  g2.currentPlayerId = 'p0';
  g2.awaitingProduceRoll = false;
  g2.dice = { p0: [5], p1: [] };
  g2.diceBoosted = { p0: [false], p1: [] };
  ok(applyAction(g2, 'p0', { type: 'placeDice', payload: { face: 5, area: 'resource' } }));
  assert.ok(
    g2.pendingEventChoice && g2.pendingEventChoice.needChoice === 'teleportDie',
    '派遣后场上应有骰子可传送'
  );

  // 不成为最大者时不触发传送
  const g3 = createGameState(room(2));
  finishInit(g3);
  g3.board.resource.environments[5] = {
    id: 'env_tp3',
    kind: 'environment',
    label: '传送',
    envType: 'teleport',
    trigger: 'dispatch',
    number: 5,
  };
  if (!g3.board.resource.tiles.some((t) => t.number === 5)) {
    g3.board.resource.tiles.push({
      id: 'res_tp5b',
      kind: 'resource',
      resource: 'stone',
      large: 2,
      small: 1,
      number: 5,
      label: '石头·贫',
    });
  }
  g3.board.resource.workers[5] = { p1: 2 };
  g3.players[1].dispatched = 2;
  g3.phase = 'produce';
  g3.currentPlayerId = 'p0';
  g3.awaitingProduceRoll = false;
  g3.dice = { p0: [5], p1: [] };
  g3.diceBoosted = { p0: [false], p1: [] };
  ok(applyAction(g3, 'p0', { type: 'placeDice', payload: { face: 5, area: 'resource' } }));
  assert.ok(
    !g3.pendingEventChoice || g3.pendingEventChoice.needChoice !== 'teleportDie',
    '未成为最大者不应触发传送'
  );

  const { becameStrictSlotLeader } = require('../environmentEffects');
  assert.strictEqual(
    becameStrictSlotLeader({ __neutral__: 1, p0: 1 }, 'p0', 1),
    false,
    '与中立骰并列时不应视为成为最大者'
  );
  assert.strictEqual(
    becameStrictSlotLeader({ __neutral__: 1, p0: 2 }, 'p0', 1),
    true,
    '超过中立骰数应视为成为最大者'
  );

  const g4 = createGameState(room(2));
  finishInit(g4);
  g4.board.resource.environments[5] = {
    id: 'env_tp4',
    kind: 'environment',
    label: '传送',
    envType: 'teleport',
    trigger: 'dispatch',
    number: 5,
  };
  if (!g4.board.resource.tiles.some((t) => t.number === 5)) {
    g4.board.resource.tiles.push({
      id: 'res_tp5c',
      kind: 'resource',
      resource: 'stone',
      large: 2,
      small: 1,
      number: 5,
      label: '石头·贫',
    });
  }
  g4.board.resource.workers[5] = { __neutral__: 1 };
  g4.phase = 'produce';
  g4.currentPlayerId = 'p0';
  g4.awaitingProduceRoll = false;
  g4.dice = { p0: [5], p1: [] };
  g4.diceBoosted = { p0: [false], p1: [] };
  ok(applyAction(g4, 'p0', { type: 'placeDice', payload: { face: 5, area: 'resource' } }));
  assert.ok(
    !g4.pendingEventChoice || g4.pendingEventChoice.needChoice !== 'teleportDie',
    '未超过中立骰时不应触发传送'
  );

  console.log('✓ event teleport die');
}

console.log('— event fisherman leader again pick two —');
{
  const { becameStrictSlotLeader, becameLeaderAgain } = require('../environmentEffects');
  assert.strictEqual(
    becameStrictSlotLeader({ p0: 1 }, 'p0', 1),
    true,
    '首次成为最大者应触发'
  );
  assert.strictEqual(
    becameStrictSlotLeader({ p0: 2 }, 'p0', 1),
    false,
    '继续加码不重复触发'
  );
  assert.strictEqual(
    becameLeaderAgain({ p0: 3, p1: 2 }, 'p0', 2, {}),
    true,
    '重新成为最大者应触发'
  );

  const g = createGameState(room(2));
  finishInit(g);
  g.board.resource.environments[4] = {
    id: 'env_fish',
    kind: 'environment',
    label: '渔翁得利',
    envType: 'fishermanProfit',
    trigger: 'settle',
    dispatchAlso: true,
    number: 4,
  };
  if (!g.board.resource.tiles.some((t) => t.number === 4)) {
    g.board.resource.tiles.push({
      id: 'res_f4',
      kind: 'resource',
      resource: 'wood',
      large: 2,
      small: 1,
      number: 4,
      label: '木头·贫',
    });
  }
  g.phase = 'produce';
  g.currentPlayerId = 'p0';
  g.awaitingProduceRoll = false;
  g.dice = { p0: [4, 4], p1: [] };
  g.diceBoosted = { p0: [false, false], p1: [] };
  const p0 = g.players[0];
  p0.dispatched = 0;
  p0.resources.wood = 0;

  ok(applyAction(g, 'p0', { type: 'placeDice', payload: { face: 4, area: 'resource' } }));
  assert.ok(
    g.pendingEventChoice && g.pendingEventChoice.needChoice === 'pickTwoResources',
    '首次成为最大者应弹出选资源'
  );
  ok(
    applyAction(g, 'p0', {
      type: 'eventPickTwoResources',
      payload: { amounts: { wood: 1, stone: 1 } },
    })
  );
  assert.strictEqual(p0.resources.wood, 1);
  assert.strictEqual(p0.resources.stone, 1);
  assert.ok(!g.pendingEventChoice);
  console.log('✓ event fisherman leader again pick two');
}

console.log('— event oneMountain absorb second share —');
{
  const { startSettle } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  g.barrenMarkerNumber = null;
  g.barrenMarkerArea = null;
  g.board.resource.environments = {};
  g.board.resource.environments[5] = {
    id: 'env_mt',
    kind: 'environment',
    label: '一山不容二虎',
    envType: 'oneMountain',
    trigger: 'settle',
    number: 5,
  };
  g.board.resource.tiles = [
    {
      id: 'res_t5',
      kind: 'resource',
      resource: 'wood',
      large: 3,
      small: 2,
      number: 5,
      label: '木头·丰',
    },
  ];
  g.board.resource.workers = {
    1: {}, 2: {}, 3: {}, 4: {},
    5: { p0: 3, p1: 1 },
    6: {},
  };
  g.board.resource.boosts = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  const p0 = g.players[0];
  const p1 = g.players[1];
  p0.resources.wood = 0;
  p1.resources.wood = 0;
  startSettle(g);
  assert.strictEqual(p0.resources.wood, 5, '第一名应拿大份+小份');
  assert.strictEqual(p1.resources.wood, 0, '第二名不应拿小份');
  console.log('✓ event oneMountain absorb second share');
}

console.log('— event resistBarbarians VP —');
{
  const { startSettle } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  g.barrenMarkerNumber = null;
  g.barrenMarkerArea = null;
  g.board.resource.environments = {};
  g.board.resource.environments[5] = {
    id: 'env_rb',
    kind: 'environment',
    label: '抵抗南蛮',
    envType: 'resistBarbarians',
    trigger: 'settle',
    number: 5,
  };
  g.board.resource.tiles = [
    {
      id: 'res_t5b',
      kind: 'resource',
      resource: 'stone',
      large: 2,
      small: 1,
      number: 5,
      label: '石头·贫',
    },
  ];
  g.board.resource.workers = {
    1: {}, 2: {}, 3: {}, 4: {},
    5: { p0: 3, p1: 2 },
    6: {},
  };
  g.board.resource.boosts = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  const p0 = g.players[0];
  const p1 = g.players[1];
  // 模拟接近胜利：p0 先得分为 9，抵抗南蛮后应立刻获胜，p1 不再得分
  p0.bonusScore = 9;
  p1.bonusScore = 9;
  startSettle(g);
  assert.strictEqual(p0.bonusScore, 10, '第一名先获得抵抗南蛮分数');
  assert.ok(g.over, '第一名达 10 应立刻结束');
  assert.strictEqual(p1.bonusScore, 9, '游戏结束后第二名不再得分');
  console.log('✓ event resistBarbarians VP');
}

console.log('— event resistBarbarians requires 2 physical dice —');
{
  const { startSettle } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  g.board.resource.environments = {};
  g.board.resource.environments[3] = {
    id: 'env_rb1',
    kind: 'environment',
    label: '抵抗南蛮',
    envType: 'resistBarbarians',
    trigger: 'settle',
    number: 3,
  };
  g.board.resource.tiles = [
    {
      id: 'res_t3',
      kind: 'resource',
      resource: 'wood',
      large: 1,
      small: 1,
      number: 3,
      label: '木材',
    },
  ];
  g.board.resource.workers = {
    1: {}, 2: {}, 3: { p0: 1 }, 4: {}, 5: {}, 6: {},
  };
  g.board.resource.boosts = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  const p0 = g.players[0];
  p0.bonusScore = 0;
  startSettle(g);
  assert.strictEqual(p0.bonusScore, 0, '仅 1 骰时不应获得胜利点');
  console.log('✓ resistBarbarians skips single die');
}

{
  const { startSettle } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  g.board.resource.environments = {};
  g.board.resource.environments[3] = {
    id: 'env_rb2',
    kind: 'environment',
    label: '抵抗南蛮',
    envType: 'resistBarbarians',
    trigger: 'settle',
    number: 3,
  };
  g.board.resource.tiles = [
    {
      id: 'res_t3b',
      kind: 'resource',
      resource: 'wood',
      large: 1,
      small: 1,
      number: 3,
      label: '木材',
    },
  ];
  g.board.resource.workers = {
    1: {}, 2: {}, 3: { p0: 2 }, 4: {}, 5: {}, 6: {},
  };
  g.board.resource.boosts = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  const p0 = g.players[0];
  p0.bonusScore = 0;
  startSettle(g);
  assert.strictEqual(p0.bonusScore, 1, '剩余 2 骰时应获得胜利点');
  console.log('✓ resistBarbarians awards VP at 2 dice');
}

console.log('— dice-count effects ignore dispatch strength —');
{
  const { startSettle } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  g.board.resource.environments = {
    2: {
      id: 'env_pd_enh',
      kind: 'environment',
      envType: 'prisonersDilemma',
      label: '囚徒困境',
      trigger: 'settle',
      number: 2,
    },
    4: {
      id: 'env_rb_enh',
      kind: 'environment',
      envType: 'resistBarbarians',
      label: '抵抗南蛮',
      trigger: 'settle',
      number: 4,
    },
  };
  g.board.resource.tiles = [
    {
      id: 'res_t2',
      kind: 'resource',
      resource: 'wood',
      large: 1,
      small: 1,
      number: 2,
      label: '木材',
    },
    {
      id: 'res_t4',
      kind: 'resource',
      resource: 'stone',
      large: 1,
      small: 1,
      number: 4,
      label: '石头',
    },
  ];
  g.board.resource.workers = {
    1: {},
    2: { p0: 1 },
    3: {},
    4: { p0: 1 },
    5: {},
    6: {},
  };
  g.board.resource.boosts = {
    1: {},
    2: { p0: 1 },
    3: {},
    4: { p0: 1 },
    5: {},
    6: {},
  };
  const p0 = g.players[0];
  const p1 = g.players[1];
  p0.bonusScore = 0;
  startSettle(g);
  assert.strictEqual(
    Number((g.pendingPrisonerDiscards || {})[p1.id]) || 0,
    1,
    '1 枚强化骰第一名时囚徒困境 n 应为 1 而非强度 3'
  );
  assert.strictEqual(p0.bonusScore, 0, '1 枚骰不满足抵抗南蛮 ≥2');
  console.log('✓ dice-count effects use physical dice not strength');
}

console.log('— event keepOverflow skip discard —');
{
  const { startSettle, finishSettleAnimForce } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  g.board.resource.environments = {};
  g.board.resource.environments[4] = {
    id: 'env_ko',
    kind: 'environment',
    label: '吃不了兜着走',
    envType: 'keepOverflow',
    trigger: 'settle',
    number: 4,
  };
  g.board.resource.tiles = [
    {
      id: 'res_ko',
      kind: 'resource',
      resource: 'wood',
      large: 4,
      small: 2,
      number: 4,
      label: '木头·丰',
    },
  ];
  g.board.resource.workers = {
    1: {},
    2: {},
    3: {},
    4: { p0: 3, p1: 1 },
    5: {},
    6: {},
  };
  g.board.resource.boosts = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
  const p0 = g.players[0];
  const p1 = g.players[1];
  p0.resources = { wood: 10, stone: 0, food: 0, iron: 0 };
  p1.resources = { wood: 11, stone: 0, food: 0, iron: 0 };

  startSettle(g);
  assert.ok(p0.skipSettleResourceDiscard, '第一名应豁免资源弃牌');
  assert.strictEqual(p0.resources.wood, 14, '第一名应保留结算所得');
  assert.strictEqual(p1.resources.wood, 13, '第二名应获得小份');
  assert.ok(
    (g.pendingKeepOverflowQueue || []).some((q) => q.playerId === p0.id),
    '应排队等待任选资源'
  );
  ok(finishSettleAnimForce(g));
  assert.ok(
    g.pendingEventChoice &&
      g.pendingEventChoice.playerId === p0.id &&
      g.pendingEventChoice.needChoice === 'pickTwoResources',
    '动画结束后应弹出任选资源'
  );
  ok(
    applyAction(g, p0.id, {
      type: 'eventPickTwoResources',
      payload: { amounts: { wood: 2 } },
    })
  );
  assert.strictEqual(g.phase, 'settle_act', '选完资源后仍有玩家需弃牌时应进入弃牌阶段');
  assert.strictEqual(p0.pendingDiscardRes, false, '第一名仍无需弃资源');
  assert.strictEqual(p0.resources.wood, 16, '第一名应获得额外 2 资源');
  assert.ok(p1.pendingDiscardRes, '第二名仍需弃牌');
  while (p1.pendingDiscardRes && g.phase === 'settle_act') {
    ok(
      applyAction(g, p1.id, {
        type: 'discardResource',
        payload: { resource: 'wood' },
      })
    );
  }
  assert.strictEqual(p0.resources.wood, 16, '第一名超上限资源应保留');
  console.log('✓ event keepOverflow skip discard');
}

console.log('— event firstCome stash —');
{
  const { firstComeGrantTier, firstComeRequiredWorkers } = require('../environmentEffects');
  assert.strictEqual(firstComeGrantTier(1), 1);
  assert.strictEqual(firstComeGrantTier(4), 1);
  assert.strictEqual(firstComeGrantTier(5), 2);
  assert.strictEqual(firstComeGrantTier(9), 3);
  assert.strictEqual(firstComeRequiredWorkers(1), 2);
  assert.strictEqual(firstComeRequiredWorkers(4), 2);
  assert.strictEqual(firstComeRequiredWorkers(5), 3);
  assert.strictEqual(firstComeRequiredWorkers(9), 4);
  const g = createGameState(room(2));
  finishInit(g);
  g.board.resource.environments[4] = {
    id: 'env_fc',
    kind: 'environment',
    label: '先到先得',
    envType: 'firstCome',
    trigger: 'dispatch',
    setup: 'stashResources',
    firstComeTier: 1,
    firstComeRequired: 2,
    stash: { wood: 1, stone: 1, food: 1, iron: 1 },
    firstComeClaims: {},
    number: 4,
  };
  if (!g.board.resource.tiles.some((t) => t.number === 4)) {
    g.board.resource.tiles.push({
      id: 'res_fc',
      kind: 'resource',
      resource: 'wood',
      large: 2,
      small: 1,
      number: 4,
      label: '木头·贫',
    });
  }
  g.board.resource.workers[4] = { p0: 1 };
  g.phase = 'produce';
  g.currentPlayerId = 'p0';
  g.awaitingProduceRoll = false;
  g.dice = { p0: [4], p1: [] };
  g.diceBoosted = { p0: [false], p1: [] };
  const p0 = g.players[0];
  p0.resources = { wood: 0, stone: 0, food: 0, iron: 0 };
  p0.dispatched = 1;
  ok(applyAction(g, 'p0', { type: 'placeDice', payload: { face: 4, area: 'resource' } }));
  assert.strictEqual(g.board.resource.workers[4].p0, 2);
  assert.strictEqual(p0.resources.wood, 1);
  assert.strictEqual(p0.resources.stone, 1);
  assert.strictEqual(p0.resources.food, 1);
  assert.strictEqual(p0.resources.iron, 1);
  assert.strictEqual(g.board.resource.environments[4].firstComeClaims.p0, true);
  g.currentPlayerId = 'p0';
  g.awaitingProduceRoll = false;
  g.dice = { p0: [4, 4], p1: [] };
  g.diceBoosted = { p0: [false, false], p1: [] };
  p0.dispatched = 2;
  ok(applyAction(g, 'p0', { type: 'placeDice', payload: { face: 4, area: 'resource' } }));
  assert.strictEqual(g.board.resource.workers[4].p0, 4);
  assert.strictEqual(p0.resources.wood, 1, '达到 4 村民不应再次领奖');
  assert.strictEqual(g.board.resource.environments[4].firstComeClaims.p0, true);
  console.log('✓ event firstCome stash');
}

console.log('— event barren leader trigger —');
{
  const { becameStrictSlotLeader } = require('../environmentEffects');
  assert.strictEqual(becameStrictSlotLeader({ p0: 1 }, 'p0', 1), true);
  assert.strictEqual(becameStrictSlotLeader({ p0: 2 }, 'p0', 1), false);
  assert.strictEqual(becameStrictSlotLeader({ p0: 2, p1: 1 }, 'p1', 1), false);
  assert.strictEqual(becameStrictSlotLeader({ p0: 2, p1: 3 }, 'p1', 1), true);

  const g = createGameState(room(2));
  finishInit(g);
  g.board.resource.environments[5] = {
    id: 'env_bh',
    kind: 'environment',
    label: '颗粒无收',
    envType: 'barrenHarvest',
    trigger: 'dispatch',
    setup: 'marker',
    number: 5,
  };
  if (!g.board.resource.tiles.some((t) => t.number === 5)) {
    g.board.resource.tiles.push({
      id: 'res_bh',
      kind: 'resource',
      resource: 'wood',
      large: 2,
      small: 1,
      number: 5,
      label: '木头·贫',
    });
  }
  g.phase = 'produce';
  g.currentPlayerId = 'p0';
  g.awaitingProduceRoll = false;
  g.dice = { p0: [5], p1: [] };
  g.diceBoosted = { p0: [false], p1: [] };
  const p0 = g.players[0];
  p0.dispatched = 0;
  ok(
    applyAction(g, 'p0', { type: 'placeDice', payload: { face: 5, area: 'resource' } }),
    'first barren dispatch triggers'
  );
  assert.ok(g.pendingEventChoice);
  assert.strictEqual(g.pendingEventChoice.needChoice, 'moveBarrenMarker');
  ok(
    applyAction(g, 'p0', {
      type: 'eventMoveBarrenMarker',
      payload: { area: 'resource', number: 1 },
    })
  );
  assert.strictEqual(g.barrenMarkerOwnerId, 'p0');
  assert.strictEqual(g.barrenMarkerNumber, 1);
  g.pendingEventChoice = null;
  g.currentPlayerId = 'p0';
  g.awaitingProduceRoll = false;
  g.dice = { p0: [5], p1: [] };
  g.diceBoosted = { p0: [false], p1: [] };
  p0.dispatched = 1;
  ok(
    applyAction(g, 'p0', {
      type: 'placeDice',
      payload: { face: 5, area: 'resource' },
    }),
    'second dispatch same player'
  );
  assert.strictEqual(g.pendingEventChoice, null);
  console.log('✓ event barren leader trigger');
}

console.log('— event deck draws until empty then reshuffles discard —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const {
    ENVIRONMENT_DECK_SIZE,
    ENVIRONMENT_DRAW_PER_ROUND,
  } = require('../engine');
  const round1Cards = [1, 2, 3, 4, 5, 6]
    .map((n) => g.board.resource.environments[n])
    .filter(Boolean);
  assert.strictEqual(round1Cards.length, 6);
  const round1Ids = round1Cards.map((c) => c.id);
  for (const p of g.players) p.resources.wood = 20;
  let guard = 0;
  const r0 = g.round;
  while (g.phase === 'produce' && g.round === r0 && guard++ < 80) {
    if (g.pendingEventChoice) {
      const ch = g.pendingEventChoice;
      if (ch.needChoice === 'pickResource') {
        ok(applyAction(g, ch.playerId, { type: 'eventPickResource', payload: { resource: 'wood' } }));
      } else if (ch.needChoice === 'pickTwoResources') {
        ok(
          applyAction(g, ch.playerId, {
            type: 'eventPickTwoResources',
            payload: { amounts: { wood: 2 } },
          })
        );
      } else if (ch.needChoice === 'moveBarrenMarker') {
        ok(applyAction(g, ch.playerId, { type: 'eventMoveBarrenMarker', payload: { number: 4 } }));
      } else if (ch.needChoice === 'moveNeutral') {
        ok(applyAction(g, ch.playerId, { type: 'eventMoveNeutral', payload: { area: 'resource', number: 1 } }));
      } else if (ch.needChoice === 'recallDie') {
        const pid = ch.playerId;
        let picked = null;
        const exArea = ch.excludeArea || 'resource';
        const exNum = Number(
          ch.excludeNumber != null ? ch.excludeNumber : ch.number
        );
        for (const area of ['resource', 'special']) {
          const workers = (g.board[area] && g.board[area].workers) || {};
          for (let num = 1; num <= 6; num++) {
            if (area === exArea && num === exNum) continue;
            if (((workers[num] || {})[pid] || 0) > 0) {
              picked = { area, number: num };
              break;
            }
          }
          if (picked) break;
        }
        if (picked) {
          const ab = g.board[picked.area];
          const wSlot = ((ab.workers[picked.number] || {})[pid]) || 0;
          const boosted = Math.min(
            Number(
              (ab.boosts &&
                ab.boosts[picked.number] &&
                ab.boosts[picked.number][pid]) ||
                0
            ),
            wSlot
          );
          const enhanced = boosted > 0 && wSlot - boosted <= 0;
          ok(
            applyAction(g, pid, {
              type: 'eventRecallDie',
              payload: { ...picked, enhanced },
            })
          );
        }
      } else if (ch.needChoice === 'gatherNeutrals') {
        const toArea = ch.toArea || 'resource';
        const toNumber = Number(ch.toNumber != null ? ch.toNumber : ch.number);
        let picked = null;
        for (const area of ['resource', 'special']) {
          const workers = (g.board[area] && g.board[area].workers) || {};
          for (let num = 1; num <= 6; num++) {
            if (area === toArea && num === toNumber) continue;
            if (((workers[num] || {}).__neutral__ || 0) > 0) {
              picked = { area, number: num };
              break;
            }
          }
          if (picked) break;
        }
        if (picked) {
          ok(applyAction(g, pid, { type: 'eventGatherNeutrals', payload: picked }));
        }
      } else if (ch.needChoice === 'teleportDie') {
        const pid = ch.playerId;
        if (ch.teleportStep === 'to') {
          const fa = ch.fromArea;
          const fn = Number(ch.fromNumber);
          let dest = null;
          for (const area of ['resource', 'special']) {
            for (let num = 1; num <= 6; num++) {
              if (area === fa && num === fn) continue;
              const tiles = (g.board[area].tiles || []).filter(
                (t) => t.number === num
              );
              if (!tiles.length) continue;
              dest = { area, number: num };
              break;
            }
            if (dest) break;
          }
          if (dest) {
            ok(applyAction(g, pid, { type: 'eventTeleportTo', payload: dest }));
          }
        } else {
          let from = null;
          for (const area of ['resource', 'special']) {
            const workers = (g.board[area] && g.board[area].workers) || {};
            for (let num = 1; num <= 6; num++) {
              const w = workers[num] || {};
              for (const [targetId, count] of Object.entries(w)) {
                if ((Number(count) || 0) > 0) {
                  from = { area, number: num, targetId };
                  break;
                }
              }
              if (from) break;
            }
            if (from) break;
          }
          if (from) {
            ok(applyAction(g, pid, { type: 'eventTeleportFrom', payload: from }));
          }
        }
      }
      continue;
    }
    ensureRolled(g);
    ok(
      applyAction(g, g.currentPlayerId, {
        type: 'voidSkip',
        payload: { resource: 'wood' },
      })
    );
  }
  drainNonProduce(g);
  assert.ok(g.round > r0, '应进入下一轮');
  // 上一轮 6 张进弃牌，本轮再抽 6 张；不整堆重洗
  assert.strictEqual(
    (g.environmentDiscard || []).length,
    ENVIRONMENT_DRAW_PER_ROUND,
    '上一轮事件应在弃牌堆'
  );
  assert.strictEqual(
    (g.environmentDeck || []).length,
    ENVIRONMENT_DECK_SIZE - 2 * ENVIRONMENT_DRAW_PER_ROUND,
    '抽牌堆应继续减少，而非整堆重洗'
  );
  const discardIds = new Set((g.environmentDiscard || []).map((c) => c.id));
  for (const id of round1Ids) {
    assert.ok(discardIds.has(id), '上一轮事件牌应仍在弃牌堆（未洗回）');
  }
  const round2Ids = [1, 2, 3, 4, 5, 6]
    .map((n) => g.board.resource.environments[n] && g.board.resource.environments[n].id)
    .filter(Boolean);
  assert.strictEqual(round2Ids.length, 6);
  for (const id of round2Ids) {
    assert.ok(!discardIds.has(id), '本轮事件应来自抽牌堆而非弃牌堆');
  }
  console.log('✓ event deck draws until empty then reshuffles discard');
}

console.log('— event deck reshuffles discard when draw pile empty —');
{
  const g = createGameState(room(2));
  finishInit(g);
  // 抽牌堆仅留 1 张，其余进弃牌；再推进一轮时抽 6 张会触发洗混
  const rest = (g.environmentDeck || []).splice(
    0,
    Math.max(0, (g.environmentDeck || []).length - 1)
  );
  g.environmentDiscard.push(...rest);
  assert.strictEqual((g.environmentDeck || []).length, 1);
  const discardBefore = (g.environmentDiscard || []).length;
  assert.ok(discardBefore >= 5);
  for (const p of g.players) p.resources.wood = 20;
  let guard = 0;
  const r0 = g.round;
  while (g.phase === 'produce' && g.round === r0 && guard++ < 80) {
    if (g.pendingEventChoice) {
      const ch = g.pendingEventChoice;
      if (ch.needChoice === 'pickResource') {
        ok(applyAction(g, ch.playerId, { type: 'eventPickResource', payload: { resource: 'wood' } }));
      } else if (ch.needChoice === 'pickTwoResources') {
        ok(
          applyAction(g, ch.playerId, {
            type: 'eventPickTwoResources',
            payload: { amounts: { wood: 2 } },
          })
        );
      } else if (ch.needChoice === 'moveBarrenMarker') {
        ok(applyAction(g, ch.playerId, { type: 'eventMoveBarrenMarker', payload: { number: 4 } }));
      } else if (ch.needChoice === 'moveNeutral') {
        ok(
          applyAction(g, ch.playerId, {
            type: 'eventMoveNeutral',
            payload: { area: 'resource', number: 1 },
          })
        );
      } else if (ch.needChoice === 'recallDie') {
        const pid = ch.playerId;
        let picked = null;
        const exArea = ch.excludeArea || 'resource';
        const exNum = Number(
          ch.excludeNumber != null ? ch.excludeNumber : ch.number
        );
        for (const area of ['resource', 'special']) {
          const workers = (g.board[area] && g.board[area].workers) || {};
          for (let num = 1; num <= 6; num++) {
            if (area === exArea && num === exNum) continue;
            if (((workers[num] || {})[pid] || 0) > 0) {
              picked = { area, number: num };
              break;
            }
          }
          if (picked) break;
        }
        if (picked) {
          const ab = g.board[picked.area];
          const wSlot = ((ab.workers[picked.number] || {})[pid]) || 0;
          const boosted = Math.min(
            Number(
              (ab.boosts &&
                ab.boosts[picked.number] &&
                ab.boosts[picked.number][pid]) ||
                0
            ),
            wSlot
          );
          const enhanced = boosted > 0 && wSlot - boosted <= 0;
          ok(
            applyAction(g, pid, {
              type: 'eventRecallDie',
              payload: { ...picked, enhanced },
            })
          );
        } else {
          g.pendingEventChoice = null;
        }
      } else if (ch.needChoice === 'gatherNeutrals') {
        const pid = ch.playerId;
        const toArea = ch.toArea || 'resource';
        const toNumber = Number(ch.toNumber != null ? ch.toNumber : ch.number);
        let picked = null;
        for (const area of ['resource', 'special']) {
          const workers = (g.board[area] && g.board[area].workers) || {};
          for (let num = 1; num <= 6; num++) {
            if (area === toArea && num === toNumber) continue;
            if (((workers[num] || {}).__neutral__ || 0) > 0) {
              picked = { area, number: num };
              break;
            }
          }
          if (picked) break;
        }
        if (picked) {
          ok(applyAction(g, pid, { type: 'eventGatherNeutrals', payload: picked }));
        } else {
          g.pendingEventChoice = null;
        }
      } else if (ch.needChoice === 'teleportDie') {
        const pid = ch.playerId;
        if (ch.teleportStep === 'to') {
          const fa = ch.fromArea;
          const fn = Number(ch.fromNumber);
          let dest = null;
          for (const area of ['resource', 'special']) {
            for (let num = 1; num <= 6; num++) {
              if (area === fa && num === fn) continue;
              const tiles = (g.board[area].tiles || []).filter(
                (t) => t.number === num
              );
              if (!tiles.length) continue;
              dest = { area, number: num };
              break;
            }
            if (dest) break;
          }
          if (dest) {
            ok(applyAction(g, pid, { type: 'eventTeleportTo', payload: dest }));
          } else {
            g.pendingEventChoice = null;
          }
        } else {
          let from = null;
          for (const area of ['resource', 'special']) {
            const workers = (g.board[area] && g.board[area].workers) || {};
            for (let num = 1; num <= 6; num++) {
              const w = workers[num] || {};
              for (const [targetId, count] of Object.entries(w)) {
                if ((Number(count) || 0) > 0) {
                  from = { area, number: num, targetId };
                  break;
                }
              }
              if (from) break;
            }
            if (from) break;
          }
          if (from) {
            ok(applyAction(g, pid, { type: 'eventTeleportFrom', payload: from }));
          } else {
            g.pendingEventChoice = null;
          }
        }
      } else {
        g.pendingEventChoice = null;
      }
      continue;
    }
    ensureRolled(g);
    ok(
      applyAction(g, g.currentPlayerId, {
        type: 'voidSkip',
        payload: { resource: 'wood' },
      })
    );
  }
  drainNonProduce(g);
  assert.ok(g.round > r0, '应进入下一轮');
  const onBoard = [1, 2, 3, 4, 5, 6].filter(
    (n) => g.board.resource.environments[n]
  ).length;
  assert.strictEqual(onBoard, 6, '抽空后应洗弃牌堆并摆满 6 张事件');
  // recycle 后 discard=discardBefore+6，抽 1 张耗尽 deck，ensureDeck 洗入后抽 5，弃牌为空
  assert.strictEqual(
    (g.environmentDiscard || []).length,
    0,
    '抽空洗混后弃牌堆应已用尽'
  );
  assert.strictEqual(
    (g.environmentDeck || []).length,
    discardBefore + 1,
    '洗混后剩余应在抽牌堆'
  );
  console.log('✓ event deck reshuffles discard when draw pile empty');
}

console.log('— exchange stack same slot —');
{
  const { occupiedBuildSlotCount, assignBuildingSlot } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  p.expandSlots = 2; // 格：none / none:1 / none:2；上限 5
  p.buildings = [
    {
      id: 'prod1',
      buildType: 'produce',
      resource: 'wood',
      rich: false,
      label: 'P1',
      slot: null,
      built: false,
      workers: 0,
      cost: {},
    },
    {
      id: 'prod2',
      buildType: 'produce',
      resource: 'stone',
      rich: false,
      label: 'P2',
      slot: null,
      built: false,
      workers: 0,
      cost: {},
    },
    {
      id: 'ex1',
      buildType: 'exchange',
      label: '集市1',
      slot: null,
      built: false,
      workers: 0,
      cost: {},
    },
    {
      id: 'ex2',
      buildType: 'exchange',
      label: '集市2',
      slot: null,
      built: false,
      workers: 0,
      cost: {},
    },
  ];
  ok(
    applyAction(g, p.id, {
      type: 'placeBuildingSlot',
      payload: { buildingId: 'prod1', slot: 'none' },
    })
  );
  const failMix = applyAction(g, p.id, {
    type: 'placeBuildingSlot',
    payload: { buildingId: 'prod2', slot: 'none' },
  });
  assert.strictEqual(failMix.ok, false, '不同生产建筑不可叠放到已占格');
  ok(
    applyAction(g, p.id, {
      type: 'placeBuildingSlot',
      payload: { buildingId: 'prod2', slot: 'none:1' },
    })
  );
  ok(
    applyAction(g, p.id, {
      type: 'placeBuildingSlot',
      payload: { buildingId: 'ex1', slot: 'none:2' },
    })
  );
  ok(
    applyAction(g, p.id, {
      type: 'placeBuildingSlot',
      payload: { buildingId: 'ex2', slot: 'none:2' },
    }),
    '第二座集市应可叠同一格'
  );
  assert.strictEqual(
    p.buildings.filter((b) => String(b.slot) === 'none:2').length,
    2
  );
  assert.strictEqual(occupiedBuildSlotCount(p), 3, '叠放后仍占 3 格');

  const neu = {
    id: 'ex3',
    buildType: 'exchange',
    label: '集市3',
    slot: null,
    built: false,
    workers: 0,
    cost: {},
  };
  assert.ok(assignBuildingSlot(p, neu), '入手集市应自动叠到已有集市格');
  assert.strictEqual(neu.slot, 'none:2');
  console.log('✓ exchange stack same slot');
}

console.log('— palace stack same slot —');
{
  const { assignBuildingSlot } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  p.expandSlots = 1;
  p.buildings = [
    {
      id: 'pal1',
      buildType: 'score2',
      label: '宫殿1',
      score: 2,
      slot: null,
      built: false,
      workers: 0,
      cost: {},
    },
    {
      id: 'pal2',
      buildType: 'score2',
      label: '宫殿2',
      score: 2,
      slot: null,
      built: false,
      workers: 0,
      cost: {},
    },
  ];
  ok(
    applyAction(g, p.id, {
      type: 'placeBuildingSlot',
      payload: { buildingId: 'pal1', slot: 'none' },
    })
  );
  ok(
    applyAction(g, p.id, {
      type: 'placeBuildingSlot',
      payload: { buildingId: 'pal2', slot: 'none' },
    }),
    '第二座宫殿应可叠同一格'
  );
  assert.strictEqual(
    p.buildings.filter((b) => String(b.slot) === 'none').length,
    2
  );
  const neu = {
    id: 'pal3',
    buildType: 'score2',
    label: '宫殿3',
    score: 2,
    slot: null,
    built: false,
    workers: 0,
    cost: {},
  };
  assert.ok(assignBuildingSlot(p, neu), '入手宫殿应自动叠到已有宫殿格');
  assert.strictEqual(neu.slot, 'none');
  console.log('✓ palace stack same slot');
}

console.log('— resource face-down slots —');
{
  function isResourceFaceDownOnSlot(/* number, cardIndexOnSlot */) {
    return false;
  }
  function dealtResourceFaceDownPlan(count) {
    const slotCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const plan = [];
    for (let i = 0; i < count; i++) {
      const number = (i % 6) + 1;
      slotCounts[number] += 1;
      const cardIndexOnSlot = slotCounts[number];
      plan.push({
        number,
        cardIndexOnSlot,
        faceDown: isResourceFaceDownOnSlot(number, cardIndexOnSlot),
      });
    }
    return plan;
  }
  assert.ok(
    !dealtResourceFaceDownPlan(13).some(
      (x) => x.number === 1 && x.cardIndexOnSlot === 3 && x.faceDown
    ),
    '1 号格第 3 张不再暗置'
  );
  assert.ok(
    !dealtResourceFaceDownPlan(10).some(
      (x) => x.number === 4 && x.cardIndexOnSlot === 2 && x.faceDown
    ),
    '4 号格第 2 张不再暗置'
  );
  assert.ok(
    !dealtResourceFaceDownPlan(18).some((x) => x.faceDown),
    '资源区发牌一律明示'
  );

  const g = createGameState(room(2));
  finishInit(g);
  const hidden = {
    id: 'res_hidden',
    kind: 'resource',
    label: '暗木',
    resource: 'wood',
    large: 4,
    small: 1,
    number: 1,
    faceDown: true,
  };
  g.board.resource.tiles = [hidden];
  g.board.resource.workers[1] = { p0: 2 };
  for (const p of g.players) {
    p.dispatched = p.villagers;
    p.roundGained = 0;
    p.resources = { wood: 0, stone: 0, food: 0, iron: 0 };
  }
  startSettle(g);
  assert.ok(hidden.faceDown === false, '结算时应翻开暗置资源卡');
  const pub = publicGameState(g, 'p1');
  const shown = (pub.board.resource.tiles || []).find((t) => t.id === 'res_hidden');
  assert.ok(!shown || !shown.faceDown, '公开状态结算后资源卡应明示');
  const row = (g.lastSettle && g.lastSettle.slots || []).find(
    (x) => x.area === 'resource' && x.number === 1
  );
  assert.ok(row, '应有资源格 1 结算记录');
  const reportTile = (row.tiles || []).find((t) => t.id === 'res_hidden');
  assert.ok(reportTile && !reportTile.faceDown, '结算报告资源卡应翻开');
  assert.strictEqual(g.players[0].resources.wood, 4, '暗置资源应按大份结算');
  console.log('✓ resource face-down slots');
}

console.log('— player trade propose / accept / reject —');
{
  const g = createGameState(room(3));
  finishInit(g);
  const a = g.players[0];
  const b = g.players[1];
  const c = g.players[2];
  g.phase = 'build';
  g.buildPassed = {};
  g.produceFinishOrder = ['p0', 'p1', 'p2'];
  g.currentPlayerId = 'p0';
  a.resources = { wood: 3, stone: 1, food: 0, iron: 0 };
  b.resources = { wood: 0, stone: 2, food: 1, iron: 0 };
  c.resources = { wood: 5, stone: 5, food: 5, iron: 5 };

  ok(
    applyAction(g, a.id, {
      type: 'proposeTrade',
      payload: {
        targetId: b.id,
        give: { wood: 2, stone: 0, food: 0, iron: 0 },
        take: { wood: 0, stone: 1, food: 0, iron: 0 },
      },
    })
  );
  assert.ok(g.pendingTrade, '应进入待交易状态');
  assert.deepStrictEqual(getActingPlayerIds(g), [b.id], '仅目标可行动');
  const waitPub = publicGameState(g, c.id);
  assert.ok(waitPub.pendingTrade, '第三人应看到 pendingTrade');
  assert.ok(!waitPub.pendingTrade.forMe, '第三人不是决策方');

  const bad = applyAction(g, a.id, { type: 'pass', payload: {} });
  assert.ok(!bad.ok, '交易未决时发起方不能继续行动');

  ok(applyAction(g, b.id, { type: 'acceptTrade', payload: {} }));
  assert.ok(!g.pendingTrade, '接受后应清空交易');
  assert.strictEqual(a.resources.wood, 1);
  assert.strictEqual(a.resources.stone, 2);
  assert.strictEqual(b.resources.wood, 2);
  assert.strictEqual(b.resources.stone, 1);

  // 单方面给予 + 拒绝
  a.resources = { wood: 4, stone: 0, food: 0, iron: 0 };
  b.resources = { wood: 0, stone: 0, food: 0, iron: 0 };
  ok(
    applyAction(g, a.id, {
      type: 'proposeTrade',
      payload: {
        targetId: b.id,
        give: { wood: 3, stone: 0, food: 0, iron: 0 },
        take: { wood: 0, stone: 0, food: 0, iron: 0 },
      },
    })
  );
  const targetPub = publicGameState(g, b.id);
  assert.ok(targetPub.pendingTrade && targetPub.pendingTrade.forMe);
  assert.strictEqual(targetPub.pendingTrade.give.wood, 3);
  ok(applyAction(g, b.id, { type: 'rejectTrade', payload: {} }));
  assert.ok(!g.pendingTrade);
  assert.strictEqual(a.resources.wood, 4, '拒绝后资源不变');
  assert.strictEqual(b.resources.wood, 0);

  // 可发起对方库存不足的索取；接受失败时保留 pendingTrade
  a.resources = { wood: 2, stone: 0, food: 0, iron: 0 };
  b.resources = { wood: 0, stone: 0, food: 0, iron: 0 };
  ok(
    applyAction(g, a.id, {
      type: 'proposeTrade',
      payload: {
        targetId: b.id,
        give: { wood: 1, stone: 0, food: 0, iron: 0 },
        take: { wood: 0, stone: 2, food: 0, iron: 0 },
      },
    })
  );
  assert.ok(g.pendingTrade, '对方库存不足时仍可发起交易请求');
  const lackAccept = applyAction(g, b.id, { type: 'acceptTrade', payload: {} });
  assert.ok(!lackAccept.ok, '目标资源不足时不能接受');
  assert.ok(g.pendingTrade, '接受失败后仍保留待处理交易');
  ok(applyAction(g, b.id, { type: 'rejectTrade', payload: {} }));
  assert.ok(!g.pendingTrade);
  assert.strictEqual(a.resources.wood, 2, '拒绝后发起方资源不变');

  console.log('✓ player trade propose / accept / reject');
}

console.log('— exile moves die between slots —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  const p1 = g.players[1];
  g.phase = 'produce';
  g.currentPlayerId = p0.id;
  g.awaitingProduceRoll = false;
  g.dice = { [p0.id]: [1], [p1.id]: [] };
  p0.funcCards.push({
    id: 'fn_exile',
    kind: 'function',
    funcType: 'exile',
    label: '驱逐',
  });
  // ensure destination has a tile
  if (!g.board.resource.tiles.some((t) => t.number === 2)) {
    g.board.resource.tiles.push({
      id: 'res_ex_2',
      kind: 'resource',
      resource: 'wood',
      large: 2,
      small: 1,
      number: 2,
      label: '木头',
    });
  }
  if (!g.board.resource.tiles.some((t) => t.number === 5)) {
    g.board.resource.tiles.push({
      id: 'res_ex_5',
      kind: 'resource',
      resource: 'stone',
      large: 2,
      small: 1,
      number: 5,
      label: '石头',
    });
  }
  g.board.resource.workers[2] = { [p1.id]: 1 };
  p1.dispatched = 1;
  const beforeDisp = p1.dispatched;
  const bad = applyAction(g, p0.id, {
    type: 'useFunc',
    payload: {
      cardId: 'fn_exile',
      targetId: p1.id,
      area: 'resource',
      number: 2,
    },
  });
  assert.ok(!bad.ok, '缺少目标格应失败');
  ok(
    applyAction(g, p0.id, {
      type: 'useFunc',
      payload: {
        cardId: 'fn_exile',
        targetId: p1.id,
        area: 'resource',
        number: 2,
        toArea: 'resource',
        toNumber: 5,
      },
    })
  );
  assert.strictEqual((g.board.resource.workers[2] || {})[p1.id] || 0, 0);
  assert.strictEqual((g.board.resource.workers[5] || {})[p1.id] || 0, 1);
  assert.strictEqual(p1.dispatched, beforeDisp, '移格不改变已派遣数');
  console.log('✓ exile moves die between slots');
}

console.log('— exile picks enhanced die —');
{
  const g = createGameState(room(2));
  finishInit(g);
  const p0 = g.players[0];
  const p1 = g.players[1];
  g.phase = 'produce';
  g.currentPlayerId = p0.id;
  g.awaitingProduceRoll = false;
  g.dice = { [p0.id]: [1], [p1.id]: [] };
  p0.funcCards.push({
    id: 'fn_exile2',
    kind: 'function',
    funcType: 'exile',
    label: '驱逐',
  });
  if (!g.board.resource.tiles.some((t) => t.number === 2)) {
    g.board.resource.tiles.push({
      id: 'res_ex_2b',
      kind: 'resource',
      resource: 'wood',
      large: 2,
      small: 1,
      number: 2,
      label: '木头',
    });
  }
  if (!g.board.resource.tiles.some((t) => t.number === 5)) {
    g.board.resource.tiles.push({
      id: 'res_ex_5b',
      kind: 'resource',
      resource: 'stone',
      large: 2,
      small: 1,
      number: 5,
      label: '石头',
    });
  }
  g.board.resource.workers[2] = { [p1.id]: 2 };
  if (!g.board.resource.boosts) g.board.resource.boosts = {};
  g.board.resource.boosts[2] = { [p1.id]: 1 };
  p1.dispatched = 2;
  p1.enhancedPlaced = 1;
  const needPick = applyAction(g, p0.id, {
    type: 'useFunc',
    payload: {
      cardId: 'fn_exile2',
      targetId: p1.id,
      area: 'resource',
      number: 2,
      toArea: 'resource',
      toNumber: 5,
    },
  });
  assert.ok(!needPick.ok, '同格两种骰子须指定类型');
  ok(
    applyAction(g, p0.id, {
      type: 'useFunc',
      payload: {
        cardId: 'fn_exile2',
        targetId: p1.id,
        area: 'resource',
        number: 2,
        toArea: 'resource',
        toNumber: 5,
        enhanced: true,
      },
    })
  );
  assert.strictEqual((g.board.resource.workers[2] || {})[p1.id], 1);
  assert.strictEqual((g.board.resource.boosts[2] || {})[p1.id] || 0, 0);
  assert.strictEqual((g.board.resource.workers[5] || {})[p1.id], 1);
  assert.strictEqual((g.board.resource.boosts[5] || {})[p1.id] || 0, 1);
  assert.strictEqual(p1.enhancedPlaced, 1, '移走强化骰后 enhancedPlaced 不变');
  console.log('✓ exile picks enhanced die');
}

console.log('— stack achievement: 3 same buildings +2 VP each —');
{
  const { playerScore: scoreOf } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  g.phase = 'build';
  g.currentPlayerId = p.id;
  g.buildPassed = {};
  g.produceFinishOrder = [p.id, g.players[1].id];
  p.resources = { wood: 10, stone: 10, food: 10, iron: 10 };
  for (let i = 0; i < 3; i++) {
    p.buildings.push({
      id: 'ex_t_' + i,
      kind: 'building',
      buildType: 'exchange',
      label: '集市',
      cost: { wood: 1, stone: 1, food: 1 },
      produce: 0,
      score: 0,
      needsWorker: false,
      functionalOnly: true,
      built: false,
      workers: 0,
      slot: 1,
      faceDown: false,
    });
  }
  const base = scoreOf(p);
  ok(
    applyAction(g, p.id, {
      type: 'construct',
      payload: { buildingId: 'ex_t_0' },
    })
  );
  ok(
    applyAction(g, p.id, {
      type: 'construct',
      payload: { buildingId: 'ex_t_1' },
    })
  );
  assert.strictEqual(scoreOf(p), base, '两座集市不加成就分');
  assert.ok(!publicGameState(g, p.id).players.find((x) => x.id === p.id).commerceTycoon);
  ok(
    applyAction(g, p.id, {
      type: 'construct',
      payload: { buildingId: 'ex_t_2' },
    })
  );
  assert.strictEqual(scoreOf(p), base + 2, '第三座集市 +2 分');
  const mePub = publicGameState(g, p.id).players.find((x) => x.id === p.id);
  assert.ok(mePub.commerceTycoon);
  assert.ok((mePub.titles || []).some((t) => t.id === 'commerceTycoon'));
  // 弃掉一座后失去成就分
  const built = p.buildings.find((b) => b.built);
  p.buildings = p.buildings.filter((b) => b.id !== built.id);
  assert.strictEqual(scoreOf(p), base, '不足三座时失去成就分');
  console.log('✓ third market stack achievement +2 VP');
}

console.log('— stack achievement: 3 wish wells +2 VP —');
{
  const { playerScore: scoreOf } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  g.phase = 'build';
  g.currentPlayerId = p.id;
  g.buildPassed = {};
  g.produceFinishOrder = [p.id, g.players[1].id];
  p.resources = { wood: 10, stone: 10, food: 10, iron: 10 };
  for (let i = 0; i < 3; i++) {
    p.buildings.push({
      id: 'ww_t_' + i,
      kind: 'building',
      buildType: 'wishWell',
      label: '许愿井',
      cost: { wood: 1, stone: 1, food: 1, iron: 1 },
      produce: 0,
      score: 0,
      needsWorker: false,
      functionalOnly: true,
      built: false,
      workers: 0,
      slot: 2,
      faceDown: false,
    });
  }
  const base = scoreOf(p);
  ok(
    applyAction(g, p.id, {
      type: 'construct',
      payload: { buildingId: 'ww_t_0' },
    })
  );
  ok(
    applyAction(g, p.id, {
      type: 'construct',
      payload: { buildingId: 'ww_t_1' },
    })
  );
  assert.strictEqual(scoreOf(p), base, '两座许愿井不加成就分');
  ok(
    applyAction(g, p.id, {
      type: 'construct',
      payload: { buildingId: 'ww_t_2' },
    })
  );
  assert.strictEqual(scoreOf(p), base + 2, '第三座许愿井 +2 分');
  const mePub = publicGameState(g, p.id).players.find((x) => x.id === p.id);
  assert.ok((mePub.titles || []).some((t) => t.label === '灯灵本灵'));
  console.log('✓ third wish well stack achievement +2 VP');
}

console.log('— stack achievement: 3 food workshops → 小麦管理者 —');
{
  const { playerScore: scoreOf } = require('../engine');
  const g = createGameState(room(2));
  finishInit(g);
  const p = g.players[0];
  g.phase = 'build';
  g.currentPlayerId = p.id;
  g.buildPassed = {};
  g.produceFinishOrder = [p.id, g.players[1].id];
  p.resources = { wood: 10, stone: 10, food: 10, iron: 10 };
  for (let i = 0; i < 3; i++) {
    p.buildings.push({
      id: 'fd_t_' + i,
      kind: 'building',
      buildType: 'produce',
      resource: 'food',
      rich: false,
      label: '小麦建筑·贫',
      cost: { wood: 1, stone: 1 },
      produce: 1,
      score: 0,
      needsWorker: true,
      functionalOnly: false,
      built: false,
      workers: 0,
      slot: 3,
      faceDown: false,
    });
  }
  const base = scoreOf(p);
  ok(
    applyAction(g, p.id, {
      type: 'construct',
      payload: { buildingId: 'fd_t_0' },
    })
  );
  ok(
    applyAction(g, p.id, {
      type: 'construct',
      payload: { buildingId: 'fd_t_1' },
    })
  );
  ok(
    applyAction(g, p.id, {
      type: 'construct',
      payload: { buildingId: 'fd_t_2' },
    })
  );
  assert.strictEqual(scoreOf(p), base + 2, '第三座小麦工坊 +2 分');
  const mePub = publicGameState(g, p.id).players.find((x) => x.id === p.id);
  assert.ok((mePub.titles || []).some((t) => t.label === '小麦管理者'));
  console.log('✓ third food workshop stack achievement → 小麦管理者');
}

console.log('全部通过');
