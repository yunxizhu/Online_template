'use strict';
module.exports = {
  id: 'kongcheng',
  name: '空城',
  desc: '锁定技，没有手牌时不能成为【杀】或【决斗】的目标。',
  type: 'locked',
  canBeTarget(ctx) {
    if (ctx.player.hand.length > 0) return true;
    const n = ctx.cardName;
    if (n === '杀' || n === '火杀' || n === '雷杀' || n === '决斗') return false;
    return true;
  },
};
