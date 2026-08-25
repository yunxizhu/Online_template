'use strict';

/**
 * 落英：其他角色的梅花牌因弃置或判定进入弃牌堆时，可获得之。
 * 引擎 emit afterClubToDiscard { player: 曹植, cardIds, fromPlayerId, reason }。
 */
module.exports = {
  id: 'luoying',
  name: '落英',
  desc: '当其他角色的梅花牌因弃置或判定而置入弃牌堆时，你可以获得之。',
  type: 'trigger',
  triggers: ['afterClubToDiscard'],
  filter(ctx) {
    if (!ctx.cardIds || !ctx.cardIds.length) return false;
    if (ctx.fromPlayerId && ctx.fromPlayerId === ctx.player.id) return false;
    return true;
  },
  content(ctx) {
    const ids = (ctx.cardIds || []).slice();
    ctx.setPending({
      type: 'card_reveal',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      shown: ids,
      skillId: 'luoying',
      skillName: '落英',
      title: '落英',
      message: `${ctx.player.name} 展示可获得的梅花牌`,
      _afterReveal: {
        kind: 'luoying_choice',
        playerId: ctx.player.id,
        cardIds: ids,
      },
    });
    return { ok: true };
  },
};
