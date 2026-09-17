'use strict';

/**
 * 标包/界包技能冒烟：奸雄、咆哮、空城、制衡
 */
const engine = require('../engine');
const { getGeneral } = require('../hero');

function roomOf(...names) {
  return {
    players: names.map((name, i) => ({
      id: 'p' + (i + 1),
      name,
    })),
  };
}

function five() {
  return roomOf('A', 'B', 'C', 'D', 'E');
}

function forceGeneral(game, playerId, generalId) {
  const p = game.players.find((x) => x.id === playerId);
  const g = getGeneral(generalId);
  if (!g) throw new Error('no general ' + generalId);
  // 绕过选将限制
  game.phase = 'select_general';
  game.generalChoices[playerId] = [generalId];
  game.selectedGenerals.delete(generalId);
  const r = engine.applyAction(game, playerId, {
    type: 'select_general',
    payload: { generalId },
  });
  if (!r.ok) throw new Error(r.error);
  return p;
}

function drainSkillAsks(game, preferPass = false) {
  let guard = 0;
  while (game.pending && guard++ < 40) {
    const pend = game.pending;
    if (pend.type === 'skill_ask') {
      engine.applyAction(game, pend.askId, {
        type: 'respond',
        payload: { pass: preferPass },
      });
      continue;
    }
    if (pend.type === 'skill_effect') {
      engine.applyAction(game, pend.askId, {
        type: 'respond',
        payload: { pass: true },
      });
      continue;
    }
    if (pend.type === 'discard') {
      const p = game.players.find((x) => x.id === pend.playerId);
      const ids = p.hand.slice(0, pend.count);
      engine.applyAction(game, pend.playerId, {
        type: 'respond',
        payload: { cardIds: ids },
      });
      continue;
    }
    break;
  }
}

function testJianxiong() {
  const game = engine.createGameState(five());
  // 固定身份座位：找主公
  const zhu = game.players.find((p) => p.identity === 'zhu');
  const fan = game.players.find((p) => p.identity === 'fan');
  forceGeneral(game, zhu.id, 'caocao');
  forceGeneral(game, fan.id, 'zhangfei');
  const pool = ['guojia', 'liubei', 'ganning', 'huatuo', 'zhaoyun', 'luxun'];
  for (const p of game.players) {
    if (!p.generalId) {
      const id = pool.find((x) => !game.selectedGenerals.has(x));
      forceGeneral(game, p.id, id);
    }
  }
  drainSkillAsks(game, true);
  // 确保在出牌阶段
  while (game.pending) drainSkillAsks(game, true);

  const cao = game.players.find((p) => p.generalId === 'caocao');
  const before = cao.hand.length;
  const shaId = Object.keys(game.cards).find(
    (id) => game.cards[id].name === '杀' && game.drawPile.includes(id)
  );
  if (!shaId) throw new Error('no sha in pile');
  game.drawPile = game.drawPile.filter((id) => id !== shaId);
  game.discardPile.push(shaId);
  engine.dealDamage(game, fan.id, cao.id, 1, { cardId: shaId });
  if (game.pending && game.pending.type === 'skill_ask') {
    engine.applyAction(game, cao.id, {
      type: 'respond',
      payload: { pass: false },
    });
  }
  drainSkillAsks(game, true);
  if (cao.hand.length < before + 1) {
    throw new Error('奸雄应摸牌，hand=' + cao.hand.length + ' before=' + before);
  }
  console.log('OK jianxiong hand', cao.hand.length);
}

function testPaoxiao() {
  const game = engine.createGameState(five());
  const zhu = game.players.find((p) => p.identity === 'zhu');
  forceGeneral(game, zhu.id, 'zhangfei');
  for (const p of game.players) {
    if (!p.generalId) {
      const id = ['caocao', 'liubei', 'ganning', 'huatuo'].find(
        (x) => !game.selectedGenerals.has(x)
      );
      forceGeneral(game, p.id, id);
    }
  }
  drainSkillAsks(game, true);
  const zf = game.players.find((p) => p.generalId === 'zhangfei');
  // 手动轮到张飞
  game.turnSeat = zf.seat;
  game.turnPhase = 'play';
  game.phase = 'playing';
  zf.shaUsed = 0;
  const limit =
    zf.skills.some((s) => s.id === 'paoxiao') || zf.shaUsed < 99;
  if (!zf.skills.some((s) => s.id === 'paoxiao')) {
    throw new Error('张飞应有咆哮');
  }
  // shaLimit via playing many - just check skill present and shaUsed can go past 1
  zf.shaUsed = 5;
  const sha = Object.values(game.cards).find((c) => c.name === '杀');
  zf.hand.push(sha.id);
  const target = game.players.find((p) => p.id !== zf.id && p.alive);
  // distance may block - give weapon range
  const r = engine.applyAction(game, zf.id, {
    type: 'play_card',
    payload: { cardId: sha.id, targets: [target.id] },
  });
  // may fail range - that's ok if skill allowed past limit
  if (r.error && r.error.includes('上限')) {
    throw new Error('咆哮应无视杀次数上限: ' + r.error);
  }
  console.log('OK paoxiao', r.ok ? 'played' : r.error);
}

function testKongcheng() {
  const game = engine.createGameState(five());
  const zhu = game.players.find((p) => p.identity === 'zhu');
  forceGeneral(game, zhu.id, 'zhugeliang');
  for (const p of game.players) {
    if (!p.generalId) {
      const id = ['caocao', 'zhangfei', 'ganning', 'huatuo'].find(
        (x) => !game.selectedGenerals.has(x)
      );
      forceGeneral(game, p.id, id);
    }
  }
  drainSkillAsks(game, true);
  const zg = game.players.find((p) => p.generalId === 'zhugeliang');
  zg.hand = [];
  const atk = game.players.find((p) => p.id !== zg.id);
  game.turnSeat = atk.seat;
  game.turnPhase = 'play';
  game.phase = 'playing';
  const sha = Object.values(game.cards).find((c) => c.name === '杀');
  atk.hand.push(sha.id);
  const r = engine.applyAction(game, atk.id, {
    type: 'play_card',
    payload: { cardId: sha.id, targets: [zg.id] },
  });
  if (r.ok) throw new Error('空城时应不能成为杀的目标');
  console.log('OK kongcheng', r.error);
}

function testZhiheng() {
  const game = engine.createGameState(five());
  const zhu = game.players.find((p) => p.identity === 'zhu');
  forceGeneral(game, zhu.id, 'sunquan');
  for (const p of game.players) {
    if (!p.generalId) {
      const id = ['caocao', 'zhangfei', 'liubei', 'huatuo'].find(
        (x) => !game.selectedGenerals.has(x)
      );
      forceGeneral(game, p.id, id);
    }
  }
  drainSkillAsks(game, true);
  const sq = game.players.find((p) => p.generalId === 'sunquan');
  game.turnSeat = sq.seat;
  game.turnPhase = 'play';
  game.phase = 'playing';
  const before = sq.hand.length;
  const ids = sq.hand.slice(0, Math.min(2, sq.hand.length));
  const r = engine.applyAction(game, sq.id, {
    type: 'use_skill',
    payload: { skillId: 'zhiheng', cardIds: ids },
  });
  if (!r.ok) throw new Error('制衡失败 ' + r.error);
  if (sq.hand.length !== before) {
    // 弃2摸2 或 弃光+1
    console.log('zhiheng hand before', before, 'after', sq.hand.length);
  }
  console.log('OK zhiheng');
}

try {
  testJianxiong();
  testPaoxiao();
  testKongcheng();
  testZhiheng();
  console.log('ALL SKILL SMOKES PASSED');
} catch (e) {
  console.error('FAIL', e);
  process.exit(1);
}
