'use strict';
module.exports = {
  id: 'haoshi',
  name: '好施',
  desc: '摸牌阶段，你可以额外摸两张牌，若此时手牌数大于5，则将一半的手牌（向下取整）交给手牌最少的一名其他角色。',
  type: 'trigger',
  triggers: ['phaseDrawBonus', 'afterDraw'],
  filter(ctx) {
    if (ctx.trigger === 'phaseDrawBonus') return true;
    return Boolean(
      ctx.player.skillStates && ctx.player.skillStates.haoshiGive
    );
  },
  content(ctx) {
    if (ctx.trigger === 'phaseDrawBonus') {
      ctx._drawBonus = (ctx._drawBonus || 0) + 2;
      if (ctx.drawBonusRef) ctx.drawBonusRef.n += 2;
      ctx.player.skillStates = ctx.player.skillStates || {};
      ctx.player.skillStates.haoshiGive = true;
      ctx.markSkillUsed(ctx.player, 'haoshi');
      return { ok: true };
    }
    delete ctx.player.skillStates.haoshiGive;
    if (ctx.player.hand.length <= 5) return { ok: true };
    const give = Math.floor(ctx.player.hand.length / 2);
    if (give <= 0) return { ok: true };
    const others = ctx.alivePlayers().filter((p) => p.id !== ctx.player.id);
    if (!others.length) return { ok: true };
    const min = Math.min(...others.map((p) => p.hand.length));
    const candidates = others.filter((p) => p.hand.length === min);
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'haoshi',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      giveCount: give,
      candidateIds: candidates.map((p) => p.id),
      message:
        '好施：将 ' +
        give +
        ' 张手牌交给手牌最少的一名角色',
      canPass: true,
      minTargets: 1,
      maxTargets: 1,
    });
    return { ok: true };
  },
};
