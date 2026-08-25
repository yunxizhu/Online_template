'use strict';

module.exports = {
  id: 'jushou',
  name: '据守',
  desc: '结束阶段，你可以摸五张牌，然后将武将牌翻面。',
  type: 'trigger',
  triggers: ['phaseEnd'],
  filter() {
    return true;
  },
  content(ctx) {
    ctx.draw(ctx.player, 5);
    ctx.player.turnedOver = !ctx.player.turnedOver;
    ctx.log(
      `${ctx.player.name} 将武将牌翻至${ctx.player.turnedOver ? '背面' : '正面'}`
    );
    return { ok: true };
  },
};
