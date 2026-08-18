'use strict';
module.exports = {
  id: 'xiaoji',
  name: '枭姬',
  desc: '当你失去装备区里的一张牌时，你可以摸两张牌。',
  type: 'trigger',
  triggers: ['afterLoseEquip'],
  filter() {
    return true;
  },
  content(ctx) {
    ctx.draw(ctx.player, 2);
    return { ok: true };
  },
};
