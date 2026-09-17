'use strict';
module.exports = {
  id: 'lianying',
  name: '连营',
  desc: '当你使用或打出牌后，若你的手牌数为全场最少（或之一），你可以摸一张牌。',
  type: 'trigger',
  triggers: ['afterUseHand', 'afterRespondCard'],
  filter(ctx) {
    const mine = ctx.player.hand.length;
    const hands = ctx.alivePlayers().map((p) => p.hand.length);
    const min = Math.min(...hands);
    return mine <= min;
  },
  content(ctx) {
    ctx.draw(ctx.player, 1);
    return { ok: true };
  },
};
