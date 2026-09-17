'use strict';
module.exports = {
  id: 'zhuiyi',
  name: '追忆',
  desc: '当你死亡时，你可以令一名其他角色（伤害来源除外）摸三张牌并回复1点体力。',
  type: 'trigger',
  triggers: ['onDeath'],
  filter(ctx) {
    const killerId = ctx.sourceId || ctx.killerId || null;
    return ctx
      .alivePlayers()
      .some((p) => p.id !== ctx.player.id && p.id !== killerId);
  },
  content(ctx) {
    const killerId = ctx.sourceId || ctx.killerId || null;
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'zhuiyi',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      killerId,
      message: '追忆：令一名其他角色（伤害来源除外）摸3张并回复1点体力',
      canPass: true,
    });
    return { ok: true };
  },
  onDeath(ctx) {
    return module.exports.content(ctx);
  },
};
