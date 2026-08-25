'use strict';

module.exports = {
  id: 'kanpo',
  name: '看破',
  desc: '你可以将一张黑色手牌当【无懈可击】使用。',
  type: 'viewAs',
  triggers: ['needWuxie', 'phasePlay'],
  viewAs: {
    to: 'wuxie',
    includeEquip: false,
    cardFilter(card) {
      return card && (card.suit === 'spade' || card.suit === 'club');
    },
  },
};
