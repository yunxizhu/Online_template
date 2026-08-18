'use strict';

module.exports = {
  id: 'lianhuan',
  name: '连环',
  desc: '出牌阶段，你可以将一张梅花手牌当【铁索连环】使用。',
  type: 'viewAs',
  triggers: ['phasePlay'],
  viewAs: {
    to: 'tiesuo',
    includeEquip: false,
    cardFilter(card) {
      return card && card.suit === 'club';
    },
  },
};
