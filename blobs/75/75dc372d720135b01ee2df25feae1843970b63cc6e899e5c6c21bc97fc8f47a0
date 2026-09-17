'use strict';
module.exports = {
  id: 'biyue',
  name: '闭月',
  desc: '回合结束阶段，你可以摸 n 张牌（n 为本回合全场受到的伤害总和，至少为 1）。',
  type: 'trigger',
  triggers: ['phaseEnd'],
  filter() {
    return true;
  },
  content(ctx) {
    const n = Math.max(1, ctx.game.turnDamageTotal || 0);
    ctx.draw(ctx.player, n);
    return { ok: true };
  },
};
