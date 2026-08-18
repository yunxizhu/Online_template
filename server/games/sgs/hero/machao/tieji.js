'use strict';
module.exports = {
  id: 'tieji',
  name: '铁骑',
  desc: '当你使用【杀】指定目标后，你可以进行判定，目标须弃置一张与判定花色相同的牌，否则不能响应此杀。',
  type: 'trigger',
  triggers: ['afterShaSpecify'],
  filter() {
    return true;
  },
  content(ctx) {
    const jid = ctx.judge(ctx.player);
    if (!jid) return null;
    const jc = ctx.cardById(jid);
    ctx.game.discardPile.push(jid);
    ctx.log(
      ctx.player.name +
        ' 铁骑判定 ' +
        ctx.suitLabel(jc.suit) +
        jc.number
    );
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'tieji',
      playerId: ctx.player.id,
      askId: ctx.targetId,
      suit: jc.suit,
      shaPendingResume: true,
      message:
        '铁骑：请弃置一张' +
        ctx.suitLabel(jc.suit) +
        '牌，否则不能出闪',
      canPass: true,
    });
    return { ok: true };
  },
};
