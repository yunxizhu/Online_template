'use strict';
module.exports = {
  id: 'longdan',
  name: '龙胆',
  desc: '你可以将【杀】当【闪】、【闪】当【杀】使用或打出。',
  type: 'viewAs',
  triggers: ['needSha', 'needShan', 'phasePlay'],
  viewAs: {
    to: 'sha',
    includeEquip: false,
    cardFilter(card) {
      return card && card.name === '闪';
    },
  },
  viewAsAlt: {
    to: 'shan',
    includeEquip: false,
    cardFilter(card) {
      return (
        card &&
        (card.name === '杀' || card.name === '火杀' || card.name === '雷杀')
      );
    },
  },
};
