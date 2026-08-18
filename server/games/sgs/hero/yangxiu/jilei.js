'use strict';
module.exports = {
  id: 'jilei',
  name: '鸡肋',
  desc: '若一个锦囊指定了包括你在内的多个目标，则你可以选择不接受这个锦囊的效果并摸一张牌。',
  type: 'trigger',
  triggers: ['whenTrickTarget'],
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
    ctx.log(ctx.player.name + ' 发动鸡肋，不接受此锦囊效果并摸一张牌');
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
