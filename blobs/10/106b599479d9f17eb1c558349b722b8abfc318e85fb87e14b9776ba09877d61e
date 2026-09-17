'use strict';
module.exports = {
  id: 'tiandu',
  name: '天妒',
  desc: '在你的判定牌生效后，你可以获得此牌。',
  type: 'trigger',
  triggers: ['afterJudge'],
  filter(ctx) {
    return Boolean(ctx.judgeCardId);
  },
  content(ctx) {
    const id = ctx.judgeCardId;
    ctx.game.discardPile = ctx.game.discardPile.filter((x) => x !== id);
    ctx.gainToHand(ctx.player, id);
    return { ok: true };
  },
};
