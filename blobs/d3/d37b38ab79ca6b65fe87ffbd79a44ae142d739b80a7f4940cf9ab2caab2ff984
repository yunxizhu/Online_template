'use strict';
module.exports = {
  id: 'yingzi',
  name: '英姿',
  desc: '摸牌阶段，你可以额外摸一张牌。',
  type: 'trigger',
  triggers: ['phaseDrawBonus'],
  forced: false,
  filter() {
    return true;
  },
  content(ctx) {
    ctx._drawBonus = (ctx._drawBonus || 0) + 1;
    if (ctx.drawBonusRef) ctx.drawBonusRef.n += 1;
    return { ok: true };
  },
};
