'use strict';

module.exports = {
  id: 'huoji',
  name: '火计',
  desc: '出牌阶段，你可以将一张红色手牌当【火攻】使用。',
  type: 'viewAs',
  triggers: ['phasePlay'],
  viewAs: {
    to: 'huogong',
    includeEquip: false,
    cardFilter(card) {
      return card && (card.suit === 'heart' || card.suit === 'diamond');
    },
  },
};
