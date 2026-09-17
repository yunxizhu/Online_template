'use strict';
module.exports = {
  id: 'yajiao',
  name: '涯角',
  desc: '你于回合外使用或打出牌时，摸一张牌。',
  type: 'trigger',
  triggers: ['afterUseCardOutside', 'afterRespondCard'],
  forced: true,
  filter(ctx) {
    const cur = ctx.game.turnSeat;
    const me = ctx.player.seat;
    return cur !== me;
  },
  content(ctx) {
    ctx.draw(ctx.player, 1);
    return { ok: true };
  },
};
