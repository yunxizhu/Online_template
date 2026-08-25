'use strict';

const { limitedUsed, markLimitedUsed } = require('../_infra_helpers');

function runNiepan(ctx) {
  if (limitedUsed(ctx.player, 'niepan')) return { ok: false };
  markLimitedUsed(ctx.player, 'niepan');

  const p = ctx.player;
  for (const id of p.hand.slice()) {
    ctx.discard(p, id, 'hand');
  }
  for (const slot of Object.keys(p.equips || {})) {
    const eq = p.equips[slot];
    if (eq && eq.id) ctx.discard(p, eq.id, 'equip:' + slot);
  }
  for (const jid of (p.judges || []).slice()) {
    p.judges = p.judges.filter((x) => x !== jid);
    if (!ctx.game.discardPile.includes(jid)) ctx.game.discardPile.push(jid);
  }

  if (p.turnedOver) {
    p.turnedOver = false;
    ctx.log(`${p.name} 将武将牌翻回正面`);
  }
  if (p.chained) {
    p.chained = false;
    ctx.log(`${p.name} 解除横置`);
  }

  ctx.draw(p, 3);
  const to = Math.min(3, p.maxHp);
  if (p.hp < to) {
    ctx.recover(p, to - p.hp);
  } else {
    p.hp = to;
  }
  ctx.log(`${p.name} 涅槃：弃置所有牌，摸 3 张，体力回复至 ${to}`);
  return { ok: true };
}

module.exports = {
  id: 'niepan',
  name: '涅槃',
  desc: '限定技，当你处于濒死状态时，你可以弃置所有牌，重置武将牌，摸三张牌，然后将体力回复至 3 点。',
  type: 'trigger',
  triggers: ['dying'],
  filter(ctx) {
    return !limitedUsed(ctx.player, 'niepan');
  },
  onDying(ctx) {
    return runNiepan(ctx);
  },
  content(ctx) {
    return runNiepan(ctx);
  },
};
