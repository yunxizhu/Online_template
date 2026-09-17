'use strict';
module.exports = {
  id: 'zishou',
  name: '自守',
  desc: '摸牌阶段，你可以多摸X张牌（X为你已损失的体力值），然后跳过出牌阶段。',
  type: 'trigger',
  triggers: ['phaseDraw'],
  filter() {
    return true;
  },
  content(ctx) {
    const lost = Math.max(0, ctx.player.maxHp - ctx.player.hp);
    if (lost > 0) ctx.draw(ctx.player, lost);
    ctx.player.skipPlay = true;
    ctx.markSkillUsed(ctx.player, 'zishou');
    ctx.log(
      ctx.player.name +
        ' 发动自守' +
        (lost > 0 ? '，额外摸 ' + lost + ' 张牌' : '') +
        '，跳过出牌阶段'
    );
    return { ok: true };
  },
};
