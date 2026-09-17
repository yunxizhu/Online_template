'use strict';
module.exports = {
  id: 'kurou',
  name: '苦肉',
  desc: '出牌阶段，你可以失去1点体力，然后摸两张牌。',
  type: 'active',
  filter() {
    return true;
  },
  content(ctx) {
    ctx.loseHp(ctx.player.id, 1, { reason: '苦肉' });
    if (ctx.player.alive) ctx.draw(ctx.player, 2);
    return { ok: true };
  },
};
