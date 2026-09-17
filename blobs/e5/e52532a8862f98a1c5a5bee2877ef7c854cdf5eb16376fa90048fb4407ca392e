'use strict';
module.exports = {
  id: 'juxiang',
  name: '巨象',
  desc: '锁定技，【南蛮入侵】对你无效；当其他角色使用的【南蛮入侵】结算结束后，你获得之。',
  type: 'locked',
  canBeTarget(ctx) {
    if (ctx.cardName === '南蛮入侵') return false;
    return true;
  },
  triggers: ['afterAoeSettle'],
  filter(ctx) {
    return ctx.cardName === '南蛮入侵' && ctx.sourceId !== ctx.player.id;
  },
  content(ctx) {
    const cid = ctx.cardId;
    if (!cid) return { ok: true };
    ctx.game.discardPile = ctx.game.discardPile.filter((id) => id !== cid);
    if (ctx.game.drawPile) {
      ctx.game.drawPile = ctx.game.drawPile.filter((id) => id !== cid);
    }
    ctx.gainToHand(ctx.player, cid);
    ctx.log(ctx.player.name + ' 巨象获得【南蛮入侵】');
    return { ok: true };
  },
};
