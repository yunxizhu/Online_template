'use strict';

const engine = require('../engine');
const xz = require('../xianzhuMode');
const { IDENTITY } = require('../constants');

function room5() {
  return {
    gameMode: 'xianzhu',
    players: [1, 2, 3, 4, 5].map((i) => ({ id: 'p' + i, name: 'P' + i })),
  };
}

function pickAll(game) {
  const pool = require('../hero').GENERALS.map((g) => g.id);
  const used = new Set();
  for (const p of game.players) {
    const gid = pool.find((id) => !used.has(id));
    used.add(gid);
    game.generalChoices[p.id] = [gid];
    const r = engine.applyAction(game, p.id, {
      type: 'select_general',
      payload: { generalId: gid },
    });
    if (!r.ok) throw new Error(r.error);
  }
  // drain skill asks
  let g = 0;
  while (game.pending && g++ < 40) {
    const pend = game.pending;
    if (pend.type === 'skill_ask' || pend.type === 'skill_effect') {
      engine.applyAction(game, pend.askId, {
        type: 'respond',
        payload: { pass: true },
      });
    } else if (pend.type === 'pile_reorder') {
      engine.applyAction(game, pend.askId, {
        type: 'respond',
        payload: {
          topIds: (pend.cardIds || []).slice(),
          bottomIds: [],
        },
      });
    } else if (pend.type === 'discard') {
      const pl = game.players.find((x) => x.id === pend.playerId);
      engine.applyAction(game, pend.playerId, {
        type: 'respond',
        payload: { cardIds: pl.hand.slice(0, pend.count) },
      });
    } else break;
  }
}

function testDeckAndNoLordBonus() {
  const game = engine.createGameState(room5());
  if (game.mode !== 'xianzhu') throw new Error('mode');
  const counts = {};
  for (const p of game.players) {
    counts[p.identity] = (counts[p.identity] || 0) + 1;
  }
  if (counts.xianzhu !== 1 || counts.zhong !== 1 || counts.huangjin !== 1 || counts.fan !== 2) {
    throw new Error('身份构成错误 ' + JSON.stringify(counts));
  }
  const xzhu = game.players.find((p) => p.identity === 'xianzhu');
  if (!xzhu.identityRevealed) throw new Error('先主应亮明');
  pickAll(game);
  if (xzhu.maxHp !== require('../hero').getGeneral(xzhu.generalId).maxHp + 1) {
    throw new Error('先主应体力+1，got ' + xzhu.maxHp);
  }
  console.log('OK deck + xianzhu hp +1');
}

function testSuccessionZhong() {
  const game = engine.createGameState(room5());
  pickAll(game);
  const xzhu = game.players.find((p) => p.identity === 'xianzhu');
  const zhong = game.players.find((p) => p.identity === 'zhong');
  xzhu.hp = 1;
  engine.dealDamage(game, zhong.id, xzhu.id, 1);
  while (game.pending && game.pending.type === 'dying') {
    engine.applyAction(game, game.pending.askId, {
      type: 'respond',
      payload: { pass: true },
    });
  }
  if (!game.pending || game.pending.type !== 'succession') {
    throw new Error('应进入传位，got ' + (game.pending && game.pending.type));
  }
  const r = engine.applyAction(game, xzhu.id, {
    type: 'respond',
    payload: { targetId: zhong.id },
  });
  if (!r.ok) throw new Error(r.error);
  if (zhong.identity !== 'houzhu' || zhong.houzhuOrigin !== 'zhong') {
    throw new Error('忠臣应变后主');
  }
  if (!zhong.isLordSkillEnabled) throw new Error('后主应开主公技');
  const gMax = require('../hero').getGeneral(zhong.generalId).maxHp;
  if (zhong.maxHp !== gMax) {
    throw new Error('后主不应体力上限+1，got ' + zhong.maxHp);
  }
  console.log('OK succession zhong→houzhu');
}

function testHuangjinInfect() {
  const game = engine.createGameState(room5());
  pickAll(game);
  const hj = game.players.find((p) => p.identity === 'huangjin');
  const fan = game.players.find((p) => p.identity === 'fan');
  fan.hp = 4;
  fan.maxHp = 4;
  for (let i = 0; i < 3; i++) {
    engine.dealDamage(game, hj.id, fan.id, 1);
    // heal back to avoid death
    if (fan.hp < fan.maxHp) fan.hp = fan.maxHp;
    if (game.pending && game.pending.type === 'dying') {
      fan.hp = 1;
      clearPendingSafe(game);
    }
  }
  if (fan.identity !== 'huangjin') {
    throw new Error('应被感染为黄巾，marks=' + fan.huangjinMarks + ' id=' + fan.identity);
  }
  console.log('OK huangjin infect');
}

function clearPendingSafe(game) {
  while (game.pending && game.pending.type === 'dying') {
    engine.applyAction(game, game.pending.askId, {
      type: 'respond',
      payload: { pass: true },
    });
  }
}

function testWinHuangjin() {
  const game = engine.createGameState(room5());
  pickAll(game);
  for (const p of game.players) {
    if (p.identity !== 'huangjin') {
      p.alive = false;
      p.hp = 0;
      p.identityRevealed = true;
    }
  }
  // trigger check via dummy kill flow
  const { checkWinXianzhu } = xz;
  checkWinXianzhu(game, {
    endGame: (g, winners, reason) => {
      g.over = true;
      g.winners = winners;
      g.winReason = reason;
    },
  });
  if (!game.over || !String(game.winReason).includes('黄巾')) {
    throw new Error('黄巾独活应胜利');
  }
  console.log('OK huangjin win');
}

function testUprisingThreshold() {
  // 5 alive, 2 huangjin → floor(5/2)=2 → uprising
  if (!xz.shouldUprising({
    players: [
      { alive: true, identity: 'huangjin' },
      { alive: true, identity: 'huangjin' },
      { alive: true, identity: 'fan' },
      { alive: true, identity: 'fan' },
      { alive: true, identity: 'zhong' },
    ],
  })) {
    throw new Error('2/5 黄巾应起义');
  }
  console.log('OK uprising threshold');
}

try {
  testDeckAndNoLordBonus();
  testSuccessionZhong();
  testHuangjinInfect();
  testWinHuangjin();
  testUprisingThreshold();
  console.log('ALL XIANZHU SMOKES PASSED');
} catch (e) {
  console.error('FAIL', e);
  process.exit(1);
}
