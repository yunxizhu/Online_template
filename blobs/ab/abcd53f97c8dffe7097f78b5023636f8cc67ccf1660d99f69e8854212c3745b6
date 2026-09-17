'use strict';

const sgs = require('..');
const engine = require('../engine');

function bootIdentity() {
  const room = {
    players: [
      { id: 'p1', name: '主公' },
      { id: 'p2', name: '忠臣' },
      { id: 'p3', name: '反贼甲' },
      { id: 'p4', name: '反贼乙' },
      { id: 'p5', name: '内奸' },
    ],
  };
  const game = sgs.createGameState(room);
  for (const p of game.players) {
    const r = sgs.applyAction(game, p.id, {
      type: 'select_general',
      payload: { generalId: game.generalChoices[p.id][0] },
    });
    if (!r.ok) throw new Error(r.error);
  }
  return game;
}

function findByIdentity(game, id) {
  return game.players.find((p) => p.identity === id);
}

function findFans(game) {
  return game.players.filter((p) => p.identity === 'fan');
}

// —— 1) 正常伤害击杀反贼：先翻身份，未终局则摸 3 ——
{
  const game = bootIdentity();
  const zhu = findByIdentity(game, 'zhu');
  const fan = findFans(game)[0];
  const before = zhu.hand.length;
  fan.hp = 1;
  engine.dealDamage(game, zhu.id, fan.id, 1);
  // 跳过求桃
  while (game.pending && game.pending.type === 'dying') {
    const r = sgs.applyAction(game, game.pending.askId, {
      type: 'respond',
      payload: { pass: true },
    });
    if (!r.ok) throw new Error(r.error);
  }
  if (fan.alive) throw new Error('fan should die');
  if (!fan.identityRevealed) throw new Error('identity should flip');
  if (!game.lastDeath || game.lastDeath.identity !== 'fan') {
    throw new Error('lastDeath fan');
  }
  if (game.over) throw new Error('should not end yet');
  if (zhu.hand.length !== before + 3) {
    throw new Error(`killer should draw 3, got ${zhu.hand.length - before}`);
  }
  console.log('OK identity: kill fan → reveal → draw 3');
}

// —— 2) 闪电击杀：有伤害无来源，不摸 3 ——
{
  const game = bootIdentity();
  const zhu = findByIdentity(game, 'zhu');
  const fan = findFans(game)[0];
  const before = zhu.hand.length;
  fan.hp = 2;
  engine.dealDamage(game, null, fan.id, 3, {
    nature: 'thunder',
    reason: 'shandian',
  });
  while (game.pending && game.pending.type === 'dying') {
    sgs.applyAction(game, game.pending.askId, {
      type: 'respond',
      payload: { pass: true },
    });
  }
  if (fan.alive) throw new Error('fan should die by lightning');
  if (fan.identityRevealed !== true) throw new Error('should reveal');
  if (zhu.hand.length !== before) {
    throw new Error('lightning kill must not grant draw 3');
  }
  console.log('OK identity: lightning kill → no draw 3');
}

// —— 3) 体力流失击杀：无伤害来源，不摸 3 ——
{
  const game = bootIdentity();
  const zhu = findByIdentity(game, 'zhu');
  const fan = findFans(game)[0];
  const before = zhu.hand.length;
  fan.hp = 1;
  engine.loseHp(game, fan.id, 1, { reason: '测试流失' });
  while (game.pending && game.pending.type === 'dying') {
    sgs.applyAction(game, game.pending.askId, {
      type: 'respond',
      payload: { pass: true },
    });
  }
  if (fan.alive) throw new Error('fan should die by loseHp');
  if (zhu.hand.length !== before) {
    throw new Error('loseHp kill must not grant draw 3');
  }
  console.log('OK identity: loseHp kill → no draw 3');
}

// —— 4) 击杀导致终局：先判胜负，不再摸 3 ——
{
  const game = bootIdentity();
  const zhu = findByIdentity(game, 'zhu');
  const fans = findFans(game);
  const nei = findByIdentity(game, 'nei');
  // 清掉其他反贼与内奸，只留一个反贼给主公杀 → 主忠胜利
  for (const f of fans.slice(1)) {
    f.alive = false;
    f.hp = 0;
    f.identityRevealed = true;
  }
  nei.alive = false;
  nei.hp = 0;
  nei.identityRevealed = true;

  const fan = fans[0];
  const before = zhu.hand.length;
  fan.hp = 1;
  engine.dealDamage(game, zhu.id, fan.id, 1);
  while (game.pending && game.pending.type === 'dying') {
    sgs.applyAction(game, game.pending.askId, {
      type: 'respond',
      payload: { pass: true },
    });
  }
  if (!game.over) throw new Error('game should end');
  if (zhu.hand.length !== before) {
    throw new Error('after game over should not draw 3');
  }
  console.log('OK identity: game ends before kill reward');
}

console.log('SGS IDENTITY DEATH SETTLEMENT OK');
