'use strict';
module.exports = {
  id: 'jilei',
  name: '鸡肋',
  desc: '当你成为锦囊牌的目标，且该锦囊指定了除你以外的至少一名角色为目标时，你可以摸一张牌，然后该锦囊对你无效。',
  type: 'trigger',
  triggers: ['whenTrickTarget'],
  askMessage: '鸡肋：是否摸一张牌，并使此锦囊对你无效？',
  filter(ctx) {
    const targets = ctx.targets || ctx.targetIds || [];
    return (
      Array.isArray(targets) &&
      targets.length > 1 &&
      targets.includes(ctx.player.id)
    );
  },
  content(ctx) {
    ctx.draw(ctx.player, 1);
    ctx.player.skillStates = ctx.player.skillStates || {};
    ctx.player.skillStates.jileiSkip = ctx.cardId || true;
    ctx.game._jileiSkip = ctx.game._jileiSkip || {};
    ctx.game._jileiSkip[ctx.player.id] = ctx.cardId || true;
    ctx.log(`${ctx.player.name} 发动【鸡肋】，摸 1 张且此锦囊对其无效`);
    return { ok: true, skipEffect: true };
  },
  canBeTarget(ctx) {
    if (
      ctx.player.skillStates &&
      ctx.player.skillStates.jileiSkip &&
      (ctx.player.skillStates.jileiSkip === true ||
        ctx.player.skillStates.jileiSkip === ctx.cardId)
    ) {
      return false;
    }
    if (ctx.game && ctx.game._jileiSkip && ctx.game._jileiSkip[ctx.player.id]) {
      const v = ctx.game._jileiSkip[ctx.player.id];
      if (v === true || v === ctx.cardId) return false;
    }
    return true;
  },
};
