'use strict';
module.exports = {
  id: 'jijiu',
  name: '急救',
  desc: '你的回合外，你可以将一张红色牌当【桃】使用。',
  type: 'viewAs',
  triggers: ['needTao'],
  filter(ctx) {
    const cur = ctx.game.players.find((p) => p.seat === ctx.game.turnSeat);
    return !cur || cur.id !== ctx.player.id;
  },
  viewAs: {
    to: 'tao',
    includeEquip: true,
    cardFilter(card) {
      return card && (card.suit === 'heart' || card.suit === 'diamond');
    },
  },
};
