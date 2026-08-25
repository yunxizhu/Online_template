'use strict';

module.exports = {
  id: 'liegong',
  name: '烈弓',
  desc:
    '当你使用【杀】指定目标后：若你的手牌数不小于目标手牌数，此【杀】不可被【闪】响应；若你的体力值不大于目标体力值，此【杀】伤害+1。你使用的【杀】点数不小于你与目标的距离时，此【杀】无距离限制（引擎以 skillStates.liegongRange 记录点数）。',
  type: 'locked',
  triggers: ['afterUseSha', 'afterShaSpecify'],
  filter(ctx) {
    if (ctx.trigger === 'afterUseSha') return true;
    const target = ctx.getPlayer(ctx.targetId);
    if (!target) return false;
    const handOk = ctx.player.hand.length >= target.hand.length;
    const hpOk = ctx.player.hp <= target.hp;
    return handOk || hpOk;
  },
  content(ctx) {
    if (ctx.trigger === 'afterUseSha') {
      const card = ctx.cardById(ctx.cardId);
      ctx.player.skillStates = ctx.player.skillStates || {};
      ctx.player.skillStates.liegongRange = card ? card.number : 0;
      return { ok: true };
    }

    const target = ctx.getPlayer(ctx.targetId);
    if (!target || !ctx.game._shaPend) return { ok: true };

    if (ctx.player.hand.length >= target.hand.length) {
      ctx.game._shaPend.noShan = true;
      ctx.log(`${ctx.player.name} 烈弓：此【杀】不可被【闪】响应`);
    }
    if (ctx.player.hp <= target.hp) {
      ctx.game._shaPend.extraDamage =
        (ctx.game._shaPend.extraDamage || 0) + 1;
      ctx.log(`${ctx.player.name} 烈弓：此【杀】伤害+1`);
    }
    return { ok: true };
  },
};
