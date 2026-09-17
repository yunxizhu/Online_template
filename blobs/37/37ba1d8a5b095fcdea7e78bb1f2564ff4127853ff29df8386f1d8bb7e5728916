'use strict';

module.exports = {
  id: 'shangshi',
  name: '伤逝',
  desc: '当你的手牌数小于 X 时，你可以将手牌摸至 X 张（X 为你已损失的体力值）。',
  type: 'trigger',
  triggers: ['afterLoseCard', 'afterDamage', 'afterRecover', 'afterLoseHp'],
  filter(ctx) {
    const lost = Math.max(0, ctx.player.maxHp - ctx.player.hp);
    return lost > 0 && ctx.player.hand.length < lost;
  },
  content(ctx) {
    const lost = Math.max(0, ctx.player.maxHp - ctx.player.hp);
    const n = lost - ctx.player.hand.length;
    if (n > 0) {
      ctx.draw(ctx.player, n);
      ctx.log(ctx.player.name + ' 伤逝摸至 ' + lost + ' 张手牌');
    }
    return { ok: true };
  },
};
