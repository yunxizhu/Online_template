'use strict';

const engine = require('../engine');
const { getGeneral } = require('../hero');

function five() {
  return {
    players: [1, 2, 3, 4, 5].map((i) => ({ id: 'p' + i, name: 'P' + i })),
  };
}

function forceGeneral(game, playerId, generalId) {
  game.phase = 'select_general';
  game.generalChoices[playerId] = [generalId];
  game.selectedGenerals.delete(generalId);
  const r = engine.applyAction(game, playerId, {
    type: 'select_general',
    payload: { generalId },
  });
  if (!r.ok) throw new Error(r.error);
}

function drain(game, preferPass = true) {
  let guard = 0;
  while (game.pending && guard++ < 60) {
    const pend = game.pending;
    if (pend.type === 'skill_ask') {
      engine.applyAction(game, pend.askId, {
        type: 'respond',
        payload: { pass: preferPass },
      });
      continue;
    }
    if (pend.type === 'pile_reorder') {
      const ids = pend.cardIds || [];
      const mid = Math.ceil(ids.length / 2);
      engine.applyAction(game, pend.askId, {
        type: 'respond',
        payload: {
          topIds: ids.slice(0, mid),
          bottomIds: ids.slice(mid),
        },
      });
      continue;
    }
    if (pend.type === 'skill_effect' || pend.type === 'wuxie') {
      engine.applyAction(game, pend.askId, {
        type: 'respond',
        payload: { pass: true },
      });
      continue;
    }
    if (pend.type === 'discard') {
      const p = game.players.find((x) => x.id === pend.playerId);
      engine.applyAction(game, pend.playerId, {
        type: 'respond',
        payload: { cardIds: p.hand.slice(0, pend.count) },
      });
      continue;
    }
    break;
  }
}

function bootWith(...pairs) {
  const game = engine.createGameState(five());
  const used = new Set();
  for (const [pid, gid] of pairs) {
    forceGeneral(game, pid, gid);
    used.add(gid);
  }
  const pool = getGeneral
    ? require('../hero').GENERALS.map((g) => g.id)
    : [];
  for (const p of game.players) {
    if (p.generalId) continue;
    const id = pool.find((x) => !used.has(x) && !game.selectedGenerals.has(x));
    forceGeneral(game, p.id, id);
    used.add(id);
  }
  drain(game, true);
  return game;
}

function testGuanxingReorder() {
  const game = bootWith(['p1', 'zhugeliang']);
  // 找到诸葛亮并强制准备阶段观星
  const zg = game.players.find((p) => p.generalId === 'zhugeliang');
  game.turnSeat = zg.seat;
  game.turnPhase = 'prepare';
  game.phase = 'playing';
  // 抽几张保证牌堆够
  while (game.drawPile.length < 5) {
    game.drawPile.push(...game.discardPile.splice(0, 5));
  }
  const top5 = game.drawPile.slice(0, 5);
  const skill = require('../hero/zhugeliang/guanxing');
  const { createCtx } = require('../hero/skillCtx');
  // 直接走 content 通过 apply 发动：用 skill_ask 路径不好，手动 set
  const before = game.drawPile.slice();
  game.drawPile = game.drawPile.slice(5);
  const watched = before.slice(0, 5);
  game.pending = {
    type: 'pile_reorder',
    playerId: zg.id,
    askId: zg.id,
    skillId: 'guanxing',
    skillName: '观星',
    cardIds: watched,
  };
  const topIds = [watched[2], watched[0]];
  const bottomIds = [watched[1], watched[3], watched[4]];
  const r = engine.applyAction(game, zg.id, {
    type: 'respond',
    payload: { topIds, bottomIds },
  });
  if (!r.ok) throw new Error(r.error);
  if (game.drawPile[0] !== topIds[0] || game.drawPile[1] !== topIds[1]) {
    throw new Error('堆顶顺序错误');
  }
  const n = game.drawPile.length;
  if (
    game.drawPile[n - 3] !== bottomIds[0] ||
    game.drawPile[n - 1] !== bottomIds[2]
  ) {
    throw new Error('堆底顺序错误');
  }
  console.log('OK guanxing pile_reorder');
}

function testVirtualJuedouWuxie() {
  const game = bootWith(['p1', 'lvbu']);
  const lvbu = game.players.find((p) => p.generalId === 'lvbu');
  const other = game.players.find((p) => p.id !== lvbu.id);
  game.phase = 'playing';
  game.turnPhase = 'play';
  // 直接虚拟决斗
  const { createTrickFlow } = require('../trickFlow');
  // engine already has trickFlow internal — use apply via skill effect path
  // 调用 public: use start through applyAction skill_effect liyu step
  game.pending = {
    type: 'skill_effect',
    skillId: 'liyu',
    playerId: lvbu.id,
    askId: lvbu.id,
    targetId: other.id,
    step: 'juedou',
    message: 'test',
  };
  const tid = game.players.find(
    (p) => p.id !== lvbu.id && p.id !== other.id
  ).id;
  const r = engine.applyAction(game, lvbu.id, {
    type: 'respond',
    payload: { targetId: tid },
  });
  if (!r.ok) throw new Error(r.error);
  if (!game.pending || game.pending.type !== 'wuxie') {
    throw new Error('虚拟决斗应先进入无懈窗，got ' + (game.pending && game.pending.type));
  }
  // 全员 skip 无懈
  drain(game, true);
  if (!game.pending || game.pending.type !== 'juedou') {
    throw new Error('无懈过后应进入决斗，got ' + (game.pending && game.pending.type));
  }
  console.log('OK liyu virtual juedou + wuxie');
}

function testHelpersOrder() {
  const { createTrickFlow } = require('../trickFlow');
  const game = engine.createGameState(five());
  // seats 0..4, lord seat 2
  const lord = game.players.find((p) => p.seat === 2);
  game.players.forEach((p) => {
    p.alive = true;
    p.country = p.seat % 2 === 0 ? '魏' : '蜀';
  });
  lord.country = '魏';
  // mock minimal trickFlow deps
  const tf = createTrickFlow({
    skillBus: { emit() {}, query() { return []; } },
    getPlayer: (g, id) => g.players.find((p) => p.id === id),
    cardById() {},
    discardCard() {},
    takeFromHand() {},
    setPending() {},
    clearPending() {},
    pushLog() {},
    nextAliveSeat(g, from) {
      const n = g.players.length;
      for (let i = 1; i <= n; i++) {
        const seat = (from + i) % n;
        const p = g.players.find((x) => x.seat === seat);
        if (p && p.alive) return seat;
      }
      return from;
    },
    resumeAfterSkill() {},
  });
  const helpers = tf.helpersFromNext(game, lord.id, '魏');
  // 下家 seat3 蜀跳过, seat4 魏, seat0 魏, seat1 蜀跳过 — 不应含 lord
  const seats = helpers.map(
    (id) => game.players.find((p) => p.id === id).seat
  );
  if (seats[0] !== 4 || seats[1] !== 0) {
    throw new Error('护驾询问顺序应从下家起: ' + seats.join(','));
  }
  if (helpers.includes(lord.id)) throw new Error('不应含主公自己');
  console.log('OK helpersFromNext order', seats.join('->'));
}

function testJizhiFilter() {
  const jizhi = require('../hero/huangyueying/jizhi');
  const normal = jizhi.filter({
    card: { type: 'trick', subtype: 'lebu' },
  });
  const delayedOk = jizhi.filter({
    card: { type: 'trick', subtype: 'shandian' },
  });
  const converted = jizhi.filter({
    card: { type: 'trick', subtype: 'guohe', _viewAs: 'qixi' },
  });
  if (!normal || !delayedOk) throw new Error('集智应触发延时锦囊');
  if (converted) throw new Error('集智不应触发转化锦囊');
  console.log('OK jizhi filter (非转化，含延时)');
}

try {
  testGuanxingReorder();
  testVirtualJuedouWuxie();
  testHelpersOrder();
  testJizhiFilter();
  require('./skills');
  console.log('ALL OPT SMOKES PASSED');
} catch (e) {
  console.error('FAIL', e);
  process.exit(1);
}
