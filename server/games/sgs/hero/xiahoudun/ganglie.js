'use strict';
module.exports = {
  id: 'ganglie',
  name: '刚烈',
  desc: '你每受到一次伤害，你可以进行判定：若结果为红色，则伤害来源受到你造成的1点伤害；若结果为黑色，你选择令伤害来源弃置一张牌。',
  type: 'trigger',
  triggers: ['afterDamage'],
  filter(ctx) {
    return Boolean(ctx.sourceId && ctx.getPlayer(ctx.sourceId));
  },
  content(ctx) {
    const jid = ctx.judge(ctx.player);
    if (!jid) return null;
    const jc = ctx.cardById(jid);
    ctx.game.discardPile.push(jid);
    const color = ctx.suitColor(jc.suit);
    ctx.log(
      ctx.player.name +
        ' 刚烈判定 ' +
        ctx.suitLabel(jc.suit) +
        jc.number +
        ' → ' +
        (color === 'red' ? '红色' : '黑色')
    );
    const src = ctx.getPlayer(ctx.sourceId);
    if (!src || !src.alive) return { ok: true };
    if (color === 'red') {
      ctx.dealDamage(ctx.player.id, src.id, 1);
    } else {
      ctx.setPending({
        type: 'skill_effect',
        skillId: 'ganglie',
        playerId: ctx.player.id,
        askId: ctx.player.id,
        sourceId: src.id,
        message: '刚烈：选择令伤害来源弃置的一张牌',
      });
    }
    return { ok: true };
  },
};
