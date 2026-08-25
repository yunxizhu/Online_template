'use strict';
module.exports = {
  id: 'qingguo',
  name: '倾国',
  desc: '你可以将一张黑色手牌当【闪】使用或打出。',
  type: 'viewAs',
  triggers: ['needShan'],
  viewAs: {
    to: 'shan',
    cardFilter(card) {
      return card && (card.suit === 'spade' || card.suit === 'club');
    },
  },
};
