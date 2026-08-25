'use strict';
const { factionCount } = require('../_infra_helpers');

module.exports = {
  id: 'yongsi',
  name: '庸肆',
  desc: '锁定技，摸牌阶段你多摸X张牌；你的手牌上限-X（X为场上势力数）。',
  type: 'locked',
  forced: true,
  triggers: ['phaseDrawBonus'],
  content(ctx) {
    const n = factionCount(ctx.game);
    if (ctx.drawBonusRef) ctx.drawBonusRef.n += n;
    else ctx._drawBonus = (ctx._drawBonus || 0) + n;
    ctx.log(ctx.player.name + ' 庸肆额外摸 ' + n + ' 张牌');
    return { ok: true };
  },
};
