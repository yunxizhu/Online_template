'use strict';
module.exports = {
  id: 'duanliang',
  name: '断粮',
  desc: '你可以将一张黑色基本牌或装备牌当【兵粮寸断】使用；你使用【兵粮寸断】的距离为2；当一名角色跳过摸牌阶段后，你可以摸一张牌。',
  type: 'viewAs',
  triggers: ['afterSkipDraw'],
  filter(ctx) {
    if (ctx.trigger === 'afterSkipDraw') return true;
    return true;
  },
  content(ctx) {
    if (ctx.trigger === 'afterSkipDraw') {
      ctx.draw(ctx.player, 1);
      return { ok: true };
    }
    return null;
  },
  viewAs: {
    to: 'bingliang',
    includeEquip: true,
    cardFilter(card) {
      if (!card) return false;
      const black = card.suit === 'spade' || card.suit === 'club';
      if (!black) return false;
      return card.type === 'basic' || card.type === 'equip';
    },
  },
  bingliangMaxDistance() {
    return 2;
  },
};
