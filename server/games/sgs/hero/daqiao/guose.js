'use strict';
module.exports = {
  id: 'guose',
  name: '国色',
  desc: '出牌阶段，你可以将一张方块牌当【乐不思蜀】使用。',
  type: 'viewAs',
  triggers: ['phasePlay'],
  viewAs: {
    to: 'lebu',
    includeEquip: true,
    cardFilter(card) {
      return card && card.suit === 'diamond';
    },
  },
};
