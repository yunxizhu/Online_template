'use strict';

module.exports = {
  id: 'xuanhuo',
  name: '眩惑',
  desc: '出牌阶段限一次，你可以将一张红桃手牌交给一名其他角色，然后获得该角色的一张牌并交给除该角色外的另一名角色。',
  type: 'active',
  filter(ctx) {
    if (ctx.skillUsed(ctx.player, 'xuanhuo')) return false;
    return ctx.player.hand.some((id) => {
      const c = ctx.cardById(id);
      return c && c.suit === 'heart';
    });
  },
  content(ctx) {
    const cardId = ctx.payload && ctx.payload.cardId;
    const tid = ctx.payload && ctx.payload.targetId;
    if (!cardId || !tid) {
      ctx.setPending({
        type: 'skill_effect',
        skillId: 'xuanhuo',
        playerId: ctx.player.id,
        askId: ctx.player.id,
        step: 'give',
        message: '眩惑：交出一张红桃手牌并选择一名其他角色',
        canPass: true,
      });
      return { ok: true };
    }
    if (!ctx.player.hand.includes(cardId)) return { ok: false };
    const card = ctx.cardById(cardId);
    if (!card || card.suit !== 'heart') return { ok: false };
    const target = ctx.getPlayer(tid);
    if (!target || !target.alive || target.id === ctx.player.id) {
      return { ok: false };
    }
    ctx.takeHand(ctx.player, cardId);
    target.hand.push(cardId);
    ctx.markSkillUsed(ctx.player, 'xuanhuo');
    ctx.log(
      ctx.player.name + ' 眩惑将红桃交给 ' + target.name
    );

    const n =
      target.hand.length +
      Object.values(target.equips || {}).filter(Boolean).length;
    if (n <= 0) return { ok: true };

    ctx.setPending({
      type: 'skill_effect',
      skillId: 'xuanhuo',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      step: 'take',
      targetId: target.id,
      message: '眩惑：获得 ' + target.name + ' 的一张牌，再交给另一名角色',
    });
    return { ok: true };
  },
};
