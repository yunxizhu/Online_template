'use strict';
module.exports = {
  id: 'weimu',
  name: '帷幕',
  desc: '锁定技，你不能成为黑色锦囊牌的目标。',
  type: 'locked',
  canBeTarget(ctx) {
    const card = ctx.card || (ctx.cardId ? ctx.cardById(ctx.cardId) : null);
    const name = ctx.cardName;
    const trickNames = [
      '顺手牵羊',
      '过河拆桥',
      '决斗',
      '借刀杀人',
      '南蛮入侵',
      '万箭齐发',
      '乐不思蜀',
      '兵粮寸断',
      '闪电',
      '无中生有',
      '铁索连环',
      '火攻',
    ];
    const isTrick =
      (card && (card.type === 'trick' || card.type === 'delayed')) ||
      (name && trickNames.includes(name));
    if (!isTrick) return true;
    let color = null;
    if (card) color = ctx.suitColor(card.suit) || card.color;
    if (!color && ctx.cardColor) color = ctx.cardColor;
    if (color === 'black') return false;
    return true;
  },
};
