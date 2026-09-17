'use strict';
module.exports = {
  id: 'fankui',
  name: '反馈',
  desc: '你每受到一次伤害，你可以获得伤害来源的一张牌。',
  type: 'trigger',
  triggers: ['afterDamage'],
  filter(ctx) {
    if (!ctx.sourceId) return false;
    const src = ctx.getPlayer(ctx.sourceId);
    if (!src || !src.alive) return false;
    const n =
      src.hand.length +
      Object.values(src.equips || {}).filter(Boolean).length;
    return n > 0;
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'fankui',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      sourceId: ctx.sourceId,
      message: '反馈：选择获得伤害来源的一张牌',
    });
    return { ok: true };
  },
};
