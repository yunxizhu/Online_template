'use strict';

/**
 * 恩怨：被其他角色回复则其摸牌；被其他角色伤害则其给红桃手牌否则失去体力。
 */
module.exports = {
  id: 'enyuan',
  name: '恩怨',
  desc: '锁定技，其他角色每令你回复 1 点体力，该角色摸一张牌；其他角色每对你造成一次伤害，须给你一张红桃手牌，否则失去 1 点体力。',
  type: 'locked',
  forced: true,
  triggers: ['afterRecover', 'afterDamage'],
  filter(ctx) {
    if (ctx.trigger === 'afterRecover') {
      return Boolean(ctx.sourceId && ctx.sourceId !== ctx.player.id);
    }
    if (ctx.trigger === 'afterDamage') {
      return Boolean(ctx.sourceId && ctx.sourceId !== ctx.player.id);
    }
    return false;
  },
  content(ctx) {
    if (ctx.trigger === 'afterRecover') {
      const src = ctx.getPlayer(ctx.sourceId);
      if (!src || !src.alive) return { ok: false };
      const n = Math.max(1, ctx.amount | 0);
      ctx.draw(src, n);
      ctx.log(src.name + ' 因恩怨摸 ' + n + ' 张牌');
      return { ok: true };
    }

    const src = ctx.getPlayer(ctx.sourceId);
    if (!src || !src.alive) return { ok: false };
    const hearts = src.hand.filter((id) => {
      const c = ctx.cardById(id);
      return c && c.suit === 'heart';
    });
    if (!hearts.length) {
      ctx.loseHp(src.id, 1, { reason: '恩怨' });
      ctx.log(src.name + ' 因恩怨失去 1 点体力');
      return { ok: true };
    }
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'enyuan',
      playerId: ctx.player.id,
      askId: src.id,
      sourceId: src.id,
      targetId: ctx.player.id,
      heartIds: hearts,
      message: '恩怨：交给 ' + ctx.player.name + ' 一张红桃手牌，否则失去 1 点体力',
      canPass: true,
    });
    return { ok: true };
  },
};
