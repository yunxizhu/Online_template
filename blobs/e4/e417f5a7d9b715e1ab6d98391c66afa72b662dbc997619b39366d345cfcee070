'use strict';
module.exports = {
  id: 'wusheng',
  name: '武圣',
  desc: '你可以将一张红色牌当【杀】使用或打出；红桃杀不计入次数，方块杀无视距离。',
  type: 'viewAs',
  triggers: ['needSha', 'phasePlay'],
  viewAs: {
    to: 'sha',
    includeEquip: true,
    cardFilter(card) {
      return card && (card.suit === 'heart' || card.suit === 'diamond');
    },
  },
};
