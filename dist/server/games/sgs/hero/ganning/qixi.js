'use strict';
module.exports = {
  id: 'qixi',
  name: '奇袭',
  desc: '出牌阶段，你可以将一张黑色牌当【过河拆桥】使用。',
  type: 'viewAs',
  triggers: ['phasePlay'],
  viewAs: {
    to: 'guohe',
    includeEquip: true,
    cardFilter(card) {
      return card && (card.suit === 'spade' || card.suit === 'club');
    },
  },
};
