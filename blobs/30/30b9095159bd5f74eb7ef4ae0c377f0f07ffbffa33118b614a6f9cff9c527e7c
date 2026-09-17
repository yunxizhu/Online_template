'use strict';
module.exports = {
  id: 'qianxun',
  name: '谦逊',
  desc: '锁定技，你不能成为【顺手牵羊】和【乐不思蜀】的目标。',
  type: 'locked',
  canBeTarget(ctx) {
    if (ctx.cardName === '顺手牵羊' || ctx.cardName === '乐不思蜀') return false;
    return true;
  },
};
